/* IKC kernel: Iterative k-core Clustering (Wedell et al. 2022).
 * Port of community-detection/src/ikc/run_ikc.py:103-204.
 *
 * Modularity gate computes the paper formula but defaults to canonical
 * pass-through (run_ikc.py:280 short-circuits to POSITIVE_VALUE = 1);
 * `opts.canonicalGate = false` enforces mod(s) > 0 instead.
 *
 * Internals operate on compact 0..n-1 indices via Int32Array adjacency;
 * external API takes / returns original node ids.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  // Compact a (nodeIds, edges) pair into Int32Array CSR-ish adjacency.
  // Returns {n, ids, idx, adjN, adjStarts, m} where adjN is a flat
  // Int32Array of neighbour-indices and adjStarts[i] is the offset of
  // node i's neighbour list (length = adjStarts[i+1] - adjStarts[i]).
  function compactSubgraph(nodeIds, edges) {
    const n = nodeIds.length;
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    let m = 0;
    const eu = [];
    const ev = [];
    edges.forEach(function (e) {
      if (e[0] === e[1]) return;
      const u = idx.get(e[0]); const v = idx.get(e[1]);
      if (u == null || v == null) return;
      eu.push(u); ev.push(v); m += 1;
    });
    const deg = new Int32Array(n);
    for (let i = 0; i < m; i++) { deg[eu[i]] += 1; deg[ev[i]] += 1; }
    const adjStarts = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) adjStarts[i + 1] = adjStarts[i] + deg[i];
    const adjN = new Int32Array(adjStarts[n]);
    const cursor = new Int32Array(n);
    for (let i = 0; i < m; i++) {
      const u = eu[i], v = ev[i];
      adjN[adjStarts[u] + cursor[u]++] = v;
      adjN[adjStarts[v] + cursor[v]++] = u;
    }
    return { n: n, ids: nodeIds, idx: idx, adjN: adjN, adjStarts: adjStarts, m: m };
  }

  function nbStart(g, i) { return g.adjStarts[i]; }
  function nbEnd(g, i)   { return g.adjStarts[i + 1]; }

  // Batagelj-Zaversnik linear-time core decomposition over compact
  // indices. Bucket queue ordered by current degree; pop a node, assign
  // its current degree as core number, slide neighbour positions when
  // their degree decreases. O(V + E).
  function coreNumbersCompact(g) {
    const n = g.n;
    if (n === 0) return { core: new Int32Array(0), max: 0 };
    const deg = new Int32Array(n);
    let maxDeg = 0;
    for (let i = 0; i < n; i++) {
      deg[i] = nbEnd(g, i) - nbStart(g, i);
      if (deg[i] > maxDeg) maxDeg = deg[i];
    }
    const bin = new Int32Array(maxDeg + 1);
    for (let i = 0; i < n; i++) bin[deg[i]] += 1;
    let start = 0;
    for (let d = 0; d <= maxDeg; d++) {
      const c = bin[d]; bin[d] = start; start += c;
    }
    const order = new Int32Array(n);
    const pos = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const d = deg[i];
      order[bin[d]] = i; pos[i] = bin[d]; bin[d] += 1;
    }
    for (let d = maxDeg; d > 0; d--) bin[d] = bin[d - 1];
    bin[0] = 0;
    const core = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const v = order[i];
      core[v] = deg[v];
      const lo = nbStart(g, v), hi = nbEnd(g, v);
      for (let k = lo; k < hi; k++) {
        const u = g.adjN[k];
        if (deg[u] <= deg[v]) continue;
        const du = deg[u], pu = pos[u], pw = bin[du], w = order[pw];
        if (u !== w) {
          order[pu] = w; order[pw] = u; pos[u] = pw; pos[w] = pu;
        }
        bin[du] += 1;
        deg[u] = du - 1;
      }
    }
    let mx = 0;
    for (let i = 0; i < n; i++) if (core[i] > mx) mx = core[i];
    return { core: core, max: mx };
  }

  function connectedComponentsCompact(g, mask) {
    const n = g.n;
    const seen = new Uint8Array(n);
    const comps = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      if (mask && !mask[s]) { seen[s] = 1; continue; }
      const comp = [];
      let head = 0;
      comp.push(s); seen[s] = 1;
      while (head < comp.length) {
        const v = comp[head++];
        const lo = nbStart(g, v), hi = nbEnd(g, v);
        for (let k = lo; k < hi; k++) {
          const u = g.adjN[k];
          if (seen[u]) continue;
          if (mask && !mask[u]) continue;
          seen[u] = 1; comp.push(u);
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  // Within the kcore subgraph (compact), every component node must
  // have degree >= kFloor counting only neighbours in the same kcore.
  // Implemented via a Uint8 mask of kcore membership; per-node degree
  // is the count of neighbours whose mask-bit is set.
  function kValidCompact(g, component, kcoreMask, kFloor) {
    for (let i = 0; i < component.length; i++) {
      const v = component[i];
      let d = 0;
      const lo = nbStart(g, v), hi = nbEnd(g, v);
      for (let k = lo; k < hi; k++) {
        if (kcoreMask[g.adjN[k]]) d += 1;
      }
      if (d < kFloor) return false;
    }
    return true;
  }

  // Iteration-scoped batch modularity. One O(E_full) sweep over fullEU/EV
  // bins each edge by (memberOf[u], memberOf[v]). Per-component (l_s, d_s)
  // is then O(1). memberOf is Int32Array(globalN) initialised to -1.
  function batchModularitiesCompact(components, memberOf, fullEU, fullEV, fullL) {
    if (fullL === 0) return components.map(function () { return 0; });
    const lS = new Float64Array(components.length);
    const dS = new Float64Array(components.length);
    for (let i = 0; i < fullEU.length; i++) {
      const ca = memberOf[fullEU[i]];
      const cb = memberOf[fullEV[i]];
      if (ca !== -1) dS[ca] += 1;
      if (cb !== -1) dS[cb] += 1;
      if (ca !== -1 && ca === cb) lS[ca] += 1;
    }
    const out = new Array(components.length);
    for (let i = 0; i < components.length; i++) {
      out[i] = (lS[i] / fullL) - Math.pow(dS[i] / (2 * fullL), 2);
    }
    return out;
  }

  function runIKC(nodeIds, fullEdges, opts) {
    opts = opts || {};
    const kFloor = opts.kFloor != null ? opts.kFloor : 4;
    const canonicalGate = opts.canonicalGate !== false;

    // Top-level compaction (stable globalIdx for fullEdges).
    const top = compactSubgraph(nodeIds, fullEdges);
    const globalN = top.n;
    const fullEU = new Int32Array(top.m);
    const fullEV = new Int32Array(top.m);
    let fillI = 0;
    fullEdges.forEach(function (e) {
      if (e[0] === e[1]) return;
      const u = top.idx.get(e[0]); const v = top.idx.get(e[1]);
      if (u == null || v == null) return;
      fullEU[fillI] = u; fullEV[fillI] = v; fillI += 1;
    });
    const fullL = top.m;

    const remaining = new Uint8Array(globalN); remaining.fill(1);
    const accepted = []; // {iteration, k, members:originalIds, modularity}
    const iterations = [];
    let it = 0;
    const dropped = []; // originalIds

    while (true) {
      let remCount = 0;
      for (let i = 0; i < globalN; i++) if (remaining[i]) remCount += 1;
      if (remCount === 0) break;

      // Build residual edge list (compact-global ids) from fullE + mask.
      const remEU = []; const remEV = [];
      for (let i = 0; i < top.m; i++) {
        if (remaining[fullEU[i]] && remaining[fullEV[i]]) {
          remEU.push(fullEU[i]); remEV.push(fullEV[i]);
        }
      }
      // Compact the residual into its own [0..remCount-1] index space.
      const localOfGlobal = new Int32Array(globalN); localOfGlobal.fill(-1);
      const globalOfLocal = new Int32Array(remCount);
      let li = 0;
      for (let gi = 0; gi < globalN; gi++) {
        if (!remaining[gi]) continue;
        localOfGlobal[gi] = li; globalOfLocal[li] = gi; li += 1;
      }
      const remDeg = new Int32Array(remCount);
      for (let i = 0; i < remEU.length; i++) {
        remDeg[localOfGlobal[remEU[i]]] += 1;
        remDeg[localOfGlobal[remEV[i]]] += 1;
      }
      const remStarts = new Int32Array(remCount + 1);
      for (let i = 0; i < remCount; i++) remStarts[i + 1] = remStarts[i] + remDeg[i];
      const remAdjN = new Int32Array(remStarts[remCount]);
      const cursor = new Int32Array(remCount);
      for (let i = 0; i < remEU.length; i++) {
        const lu = localOfGlobal[remEU[i]], lv = localOfGlobal[remEV[i]];
        remAdjN[remStarts[lu] + cursor[lu]++] = lv;
        remAdjN[remStarts[lv] + cursor[lv]++] = lu;
      }
      const remG = { n: remCount, ids: null, idx: null,
                     adjN: remAdjN, adjStarts: remStarts, m: remEU.length };

      const cn = coreNumbersCompact(remG);
      const maxK = cn.max;

      const residualOrigIds = new Array(remCount);
      for (let i = 0; i < remCount; i++) residualOrigIds[i] = nodeIds[globalOfLocal[i]];
      const itRec = {
        iteration: it,
        residualNodes: residualOrigIds,
        residualEdges: [], // populated below
        coreNumbers: null,
        maxK: maxK,
        kcoreNodes: [],
        kcoreEdges: [],
        components: [],
        accepted: [],
        bailed: false,
      };
      // Original-id residualEdges + coreNumbers map for trace consumers.
      const remOrigEdges = new Array(remEU.length);
      for (let i = 0; i < remEU.length; i++) {
        remOrigEdges[i] = [nodeIds[remEU[i]], nodeIds[remEV[i]]];
      }
      itRec.residualEdges = remOrigEdges;
      const cnPairs = new Array(remCount);
      for (let i = 0; i < remCount; i++) cnPairs[i] = [residualOrigIds[i], cn.core[i]];
      itRec.coreNumbers = cnPairs;

      if (maxK < kFloor) {
        itRec.bailed = true;
        for (let i = 0; i < remCount; i++) {
          dropped.push(residualOrigIds[i]);
          remaining[globalOfLocal[i]] = 0;
        }
        iterations.push(itRec);
        break;
      }

      // (max_k)-core extraction.
      const kcoreMask = new Uint8Array(remCount);
      for (let i = 0; i < remCount; i++) if (cn.core[i] >= maxK) kcoreMask[i] = 1;
      const kcoreNodesLocal = [];
      const kcoreNodesOrig = [];
      for (let i = 0; i < remCount; i++) {
        if (kcoreMask[i]) {
          kcoreNodesLocal.push(i);
          kcoreNodesOrig.push(residualOrigIds[i]);
        }
      }
      const kcoreEdgesOrig = [];
      for (let i = 0; i < remEU.length; i++) {
        const lu = localOfGlobal[remEU[i]], lv = localOfGlobal[remEV[i]];
        if (kcoreMask[lu] && kcoreMask[lv]) {
          kcoreEdgesOrig.push([nodeIds[remEU[i]], nodeIds[remEV[i]]]);
        }
      }
      itRec.kcoreNodes = kcoreNodesOrig;
      itRec.kcoreEdges = kcoreEdgesOrig;

      const compsLocal = connectedComponentsCompact(remG, kcoreMask);

      // Build memberOf:Int32Array(globalN) for batch modularity. Each
      // local-comp node maps to its component index; everything else -1.
      const memberOf = new Int32Array(globalN); memberOf.fill(-1);
      compsLocal.forEach(function (compLocal, ci) {
        compLocal.forEach(function (li) { memberOf[globalOfLocal[li]] = ci; });
      });
      const mods = batchModularitiesCompact(compsLocal, memberOf, fullEU, fullEV, fullL);

      compsLocal.forEach(function (compLocal, cIdx) {
        const okK = kValidCompact(remG, compLocal, kcoreMask, kFloor);
        const mod = mods[cIdx];
        const okMod = canonicalGate ? true : (mod > 0);
        const compOrig = compLocal.map(function (li) { return residualOrigIds[li]; });
        const cRec = {
          nodes: compOrig,
          kValid: okK,
          modularity: mod,
          modularityPass: okMod,
          accepted: okK && okMod,
          fateReason: null,
        };
        if (cRec.accepted) {
          cRec.fateReason = "accepted";
          accepted.push({ iteration: it, k: maxK, members: compOrig.slice(), modularity: mod });
          itRec.accepted.push(cRec);
          compLocal.forEach(function (li) { remaining[globalOfLocal[li]] = 0; });
        } else if (!okK) {
          cRec.fateReason = "failed k-valid";
          compLocal.forEach(function (li) {
            dropped.push(residualOrigIds[li]);
            remaining[globalOfLocal[li]] = 0;
          });
        } else {
          cRec.fateReason = "failed modularity";
          compLocal.forEach(function (li) {
            dropped.push(residualOrigIds[li]);
            remaining[globalOfLocal[li]] = 0;
          });
        }
        itRec.components.push(cRec);
      });
      iterations.push(itRec);
      it += 1;
      if (it > 100) break;
    }

    // Final membership map keyed by original id; -1 = dropped/singleton.
    const membership = new Map();
    accepted.forEach(function (cl, ci) {
      cl.members.forEach(function (id) { membership.set(id, ci); });
    });
    nodeIds.forEach(function (id) {
      if (!membership.has(id)) membership.set(id, -1);
    });

    return {
      kFloor: kFloor,
      canonicalGate: canonicalGate,
      iterations: iterations,
      accepted: accepted,
      dropped: dropped,
      membership: membership,
    };
  }

  // External-API coreNumbers: takes original ids, returns a Map<id, k>.
  // Used by ikc/page.js to render the stage-1 viz independently of runIKC.
  function coreNumbers(nodeIds, edges) {
    const g = compactSubgraph(nodeIds, edges);
    const cn = coreNumbersCompact(g);
    const core = new Map();
    for (let i = 0; i < g.n; i++) core.set(g.ids[i], cn.core[i]);
    return { core: core, max: cn.max };
  }

  // External-API connectedComponents: takes original ids, returns array
  // of arrays of original ids.
  function connectedComponents(nodeIds, edges) {
    const g = compactSubgraph(nodeIds, edges);
    const compsLocal = connectedComponentsCompact(g, null);
    return compsLocal.map(function (comp) {
      return comp.map(function (li) { return g.ids[li]; });
    });
  }

  function inducedEdges(nodeIds, edges) {
    const set = new Set(nodeIds);
    return edges.filter(function (e) { return set.has(e[0]) && set.has(e[1]); });
  }

  function clusterModularity(component, fullEdges) {
    const L = fullEdges.length;
    if (L === 0) return 0;
    const set = new Set(component);
    let lS = 0, dS = 0;
    fullEdges.forEach(function (e) {
      const a = set.has(e[0]); const b = set.has(e[1]);
      if (a && b) { lS += 1; dS += 2; }
      else if (a || b) { dS += 1; }
    });
    return (lS / L) - Math.pow(dS / (2 * L), 2);
  }

  C.IKC = {
    inducedEdges: inducedEdges,
    coreNumbers: coreNumbers,
    connectedComponents: connectedComponents,
    clusterModularity: clusterModularity,
    runIKC: runIKC,
    runFixture: function (kFloor, canonicalGate) {
      const F = C.FIXTURE;
      return runIKC(F.nodes, F.edges, {
        kFloor: kFloor != null ? kFloor : 4,
        canonicalGate: canonicalGate !== false,
      });
    },
  };
})();
