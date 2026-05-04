/* IKC kernel: Iterative k-core Clustering (Wedell et al. 2022).
 * Port of community-detection/src/ikc/run_ikc.py:103-204.
 *
 * Modularity gate computes the paper formula but defaults to canonical
 * pass-through (run_ikc.py:280 short-circuits to POSITIVE_VALUE = 1);
 * `opts.canonicalGate = false` enforces mod(s) > 0 instead.
 */
(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};
  const C = window.COMDET;

  function buildAdj(nodeIds, edges) {
    const adj = new Map();
    nodeIds.forEach(function (id) { adj.set(id, new Set()); });
    edges.forEach(function (e) {
      if (e[0] === e[1]) return;
      if (!adj.has(e[0]) || !adj.has(e[1])) return;
      adj.get(e[0]).add(e[1]);
      adj.get(e[1]).add(e[0]);
    });
    return adj;
  }

  function inducedEdges(nodeIds, edges) {
    const set = new Set(nodeIds);
    return edges.filter(function (e) { return set.has(e[0]) && set.has(e[1]); });
  }

  // Iterative-peel core decomposition (Batagelj-Zaversnik output).
  function coreNumbers(nodeIds, edges) {
    const adj = buildAdj(nodeIds, edges);
    const deg = new Map();
    nodeIds.forEach(function (id) { deg.set(id, adj.get(id).size); });
    const remaining = new Set(nodeIds);
    const core = new Map();
    let k = 0;
    while (remaining.size > 0) {
      let m = Infinity;
      remaining.forEach(function (v) {
        const d = deg.get(v);
        if (d < m) m = d;
      });
      if (m > k) k = m;
      const queue = [];
      remaining.forEach(function (v) {
        if (deg.get(v) <= k) queue.push(v);
      });
      while (queue.length) {
        const v = queue.pop();
        if (!remaining.has(v)) continue;
        core.set(v, k);
        remaining.delete(v);
        adj.get(v).forEach(function (u) {
          if (!remaining.has(u)) return;
          const du = deg.get(u) - 1;
          deg.set(u, du);
          if (du <= k) queue.push(u);
        });
      }
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
      components.forEach(function (comp) {
        const okK = kValid(comp, kcoreEdges, kFloor);
        const mod = clusterModularity(comp, fullEdges);
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
