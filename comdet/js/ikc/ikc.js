/* IKC kernel: Iterative k-core Clustering (Wedell et al. 2022).
 * Port of community-detection/src/ikc/run_ikc.py:103-204.
 *
 * Modularity gate computes the paper formula but defaults to canonical
 * pass-through (run_ikc.py:280 short-circuits to POSITIVE_VALUE = 1);
 * `opts.canonicalGate = false` enforces mod(s) > 0 instead.
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.LOUVAIN) {
    console.warn("[ikc] COMDET.LOUVAIN missing; load louvain.js first");
    return;
  }
  const C = window.COMDET;
  const LV = C.LOUVAIN;

  // External node ids (potentially non-contiguous after IKC peels nodes
  // out of the residual). Build LOUVAIN.Graph over compacted indices,
  // then expose adjacency as a Map<originalId, Set<originalId>> shim
  // since IKC's coreNumbers / connectedComponents / kValid all key off
  // original ids.
  function buildAdj(nodeIds, edges) {
    const n = nodeIds.length;
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    const compactEdges = [];
    edges.forEach(function (e) {
      if (e[0] === e[1]) return;
      const u = idx.get(e[0]), v = idx.get(e[1]);
      if (u == null || v == null) return;
      compactEdges.push([u, v]);
    });
    const lg = LV.Graph(n, compactEdges, { correctSelfLoops: false });
    const adj = new Map();
    nodeIds.forEach(function (id, i) {
      const nb = lg.neighbours(i);
      const set = new Set();
      for (let k = 0; k < nb.length; k++) set.add(nodeIds[nb[k]]);
      adj.set(id, set);
    });
    return adj;
  }

  function inducedEdges(nodeIds, edges) {
    const set = new Set(nodeIds);
    return edges.filter(function (e) { return set.has(e[0]) && set.has(e[1]); });
  }

  // Batagelj-Zaversnik linear-time core decomposition. Bucket queue
  // ordered by current degree; pop a node, assign its current degree
  // as core number, decrement neighbour degrees and slide them down a
  // bucket. O(V + E) total.
  function coreNumbers(nodeIds, edges) {
    const n = nodeIds.length;
    const adj = buildAdj(nodeIds, edges);
    const deg = new Map();
    let maxDeg = 0;
    nodeIds.forEach(function (id) {
      const d = adj.get(id).size;
      deg.set(id, d);
      if (d > maxDeg) maxDeg = d;
    });
    const bin = new Array(maxDeg + 1).fill(0);
    nodeIds.forEach(function (id) { bin[deg.get(id)] += 1; });
    let start = 0;
    for (let d = 0; d <= maxDeg; d++) {
      const c = bin[d]; bin[d] = start; start += c;
    }
    const order = new Array(n);
    const pos = new Map();
    nodeIds.forEach(function (id) {
      const d = deg.get(id);
      order[bin[d]] = id;
      pos.set(id, bin[d]);
      bin[d] += 1;
    });
    for (let d = maxDeg; d > 0; d--) bin[d] = bin[d - 1];
    bin[0] = 0;
    const core = new Map();
    for (let i = 0; i < n; i++) {
      const v = order[i];
      core.set(v, deg.get(v));
      adj.get(v).forEach(function (u) {
        if (deg.get(u) <= deg.get(v)) return;
        const du = deg.get(u);
        const pu = pos.get(u);
        const pw = bin[du];
        const w = order[pw];
        if (u !== w) {
          order[pu] = w; order[pw] = u;
          pos.set(u, pw); pos.set(w, pu);
        }
        bin[du] += 1;
        deg.set(u, du - 1);
      });
    }
    let mx = 0;
    core.forEach(function (v) { if (v > mx) mx = v; });
    return { core: core, max: mx };
  }

  function connectedComponents(nodeIds, edges) {
    const adj = buildAdj(nodeIds, edges);
    const seen = new Set();
    const comps = [];
    nodeIds.forEach(function (s) {
      if (seen.has(s)) return;
      const comp = [];
      const q = [s];
      seen.add(s);
      while (q.length) {
        const v = q.shift();
        comp.push(v);
        adj.get(v).forEach(function (u) {
          if (!seen.has(u)) { seen.add(u); q.push(u); }
        });
      }
      comps.push(comp);
    });
    return comps;
  }

  // Within the kcore subgraph (subEdges), every component node must
  // have degree >= kFloor (run_ikc.py:264-275).
  function kValid(component, subEdges, kFloor) {
    const set = new Set(component);
    const deg = new Map();
    component.forEach(function (v) { deg.set(v, 0); });
    subEdges.forEach(function (e) {
      if (set.has(e[0]) && set.has(e[1])) {
        deg.set(e[0], deg.get(e[0]) + 1);
        deg.set(e[1], deg.get(e[1]) + 1);
      }
    });
    let pass = true;
    deg.forEach(function (d) { if (d < kFloor) pass = false; });
    return pass;
  }

  // Paper formula (Wedell 2022 §2.2.2):
  //   mod(s) = l_s / L - (d_s / (2L))^2
  // l_s = intra-edges, d_s = sum of intra-degrees, L = original graph
  // edge count. Canonical run_ikc.py:280 returns 1 instead.
  function clusterModularity(component, fullEdges) {
    const L = fullEdges.length;
    if (L === 0) return 0;
    const set = new Set(component);
    let lS = 0;
    let dS = 0;
    fullEdges.forEach(function (e) {
      const a = set.has(e[0]);
      const b = set.has(e[1]);
      if (a && b) { lS += 1; dS += 2; }
      else if (a || b) { dS += 1; }
    });
    return (lS / L) - Math.pow(dS / (2 * L), 2);
  }

  // Iteration-scoped batch modularity. One O(E_full) sweep over
  // fullEdges bins each edge into the (compMembership[u], compMembership[v])
  // cell; per-component (l_s, d_s) is then O(1). compMembership maps each
  // component-member node to its component index; nodes outside any
  // current component map to -1.
  function batchModularities(components, fullEdges, fullL) {
    if (fullL === 0) return components.map(function () { return 0; });
    const memberOf = new Map();
    components.forEach(function (comp, ci) {
      comp.forEach(function (id) { memberOf.set(id, ci); });
    });
    const lS = new Float64Array(components.length);
    const dS = new Float64Array(components.length);
    fullEdges.forEach(function (e) {
      const ca = memberOf.has(e[0]) ? memberOf.get(e[0]) : -1;
      const cb = memberOf.has(e[1]) ? memberOf.get(e[1]) : -1;
      if (ca === cb && ca !== -1) { lS[ca] += 1; dS[ca] += 2; }
      else {
        if (ca !== -1) dS[ca] += 1;
        if (cb !== -1) dS[cb] += 1;
      }
    });
    const out = new Array(components.length);
    for (let i = 0; i < components.length; i++) {
      out[i] = (lS[i] / fullL) - Math.pow(dS[i] / (2 * fullL), 2);
    }
    return out;
  }

  // ── Outer loop ──────────────────────────────────────────────────
  function runIKC(nodeIds, fullEdges, opts) {
    opts = opts || {};
    const kFloor = opts.kFloor != null ? opts.kFloor : 4;
    // canonicalGate = true → match run_ikc.py:280 (mod always passes);
    // false → enforce paper's mod > 0 gate. Default mirrors shipped.
    const canonicalGate = opts.canonicalGate !== false;

    const remaining = new Set(nodeIds);
    const accepted = []; // {iteration, k, members, modularity}
    const iterations = [];
    let it = 0;
    const dropped = []; // singleton / k-invalid nodes
    while (remaining.size > 0) {
      const remList = nodeIds.filter(function (id) { return remaining.has(id); });
      const remEdges = inducedEdges(remList, fullEdges);
      const cn = coreNumbers(remList, remEdges);
      const maxK = cn.max;

      const itRec = {
        iteration: it,
        residualNodes: remList.slice(),
        residualEdges: remEdges.slice(),
        coreNumbers: Array.from(cn.core.entries()),
        maxK: maxK,
        kcoreNodes: [],
        kcoreEdges: [],
        components: [], // per-component {nodes, kValid, mod, accepted, fateReason}
        accepted: [],   // accepted clusters this iteration
        bailed: false,
      };

      if (maxK < kFloor) {
        // Bail: residual nodes become singletons / dropped.
        itRec.bailed = true;
        remList.forEach(function (id) {
          dropped.push(id);
          remaining.delete(id);
        });
        iterations.push(itRec);
        break;
      }

      // Extract (max_k)-core subgraph.
      const kcoreNodes = remList.filter(function (id) { return cn.core.get(id) >= maxK; });
      const kcoreEdges = inducedEdges(kcoreNodes, remEdges);
      itRec.kcoreNodes = kcoreNodes;
      itRec.kcoreEdges = kcoreEdges;

      const components = connectedComponents(kcoreNodes, kcoreEdges);
      const mods = batchModularities(components, fullEdges, fullEdges.length);
      components.forEach(function (comp, cIdx) {
        const okK = kValid(comp, kcoreEdges, kFloor);
        const mod = mods[cIdx];
        const okMod = canonicalGate ? true : (mod > 0);
        const cRec = {
          nodes: comp.slice(),
          kValid: okK,
          modularity: mod,
          modularityPass: okMod,
          accepted: okK && okMod,
          fateReason: null,
        };
        if (cRec.accepted) {
          cRec.fateReason = "accepted";
          accepted.push({ iteration: it, k: maxK, members: comp.slice(), modularity: mod });
          itRec.accepted.push(cRec);
          comp.forEach(function (id) { remaining.delete(id); });
        } else if (!okK) {
          cRec.fateReason = "failed k-valid";
          comp.forEach(function (id) {
            dropped.push(id);
            remaining.delete(id);
          });
        } else {
          cRec.fateReason = "failed modularity";
          comp.forEach(function (id) {
            dropped.push(id);
            remaining.delete(id);
          });
        }
        itRec.components.push(cRec);
      });
      iterations.push(itRec);
      it += 1;
      if (it > 100) break; // safety
    }

    // Build final membership: cluster_id 0..K-1 for accepted, -1 for dropped.
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

  // ── Public API ──────────────────────────────────────────────────
  C.IKC = {
    buildAdj: buildAdj,
    inducedEdges: inducedEdges,
    coreNumbers: coreNumbers,
    connectedComponents: connectedComponents,
    kValid: kValid,
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
