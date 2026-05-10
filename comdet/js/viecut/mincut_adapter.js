/* COMDET.MINCUT.viecut: MINCUT-API-shaped wrapper around the cactus
 * mincut pipeline, drop-in replacement for COMDET.MINCUT.stoerWagner.
 *
 * Production WCC + CM gallery walkers read mincut via mincutFn(nodeIds,
 * edges) and expect { cutValue, inPartition, outPartition }. This file
 * registers a viecut-backed implementation that matches the canonical
 * VieCut binary's cactus + most-balanced bipartition (verified by the
 * 4-leg kernel_check.py against fixture32 + dnc).
 *
 * Caller usage:
 *   COMDET.WCC.run(membership, { mincutFn: COMDET.MINCUT.viecut, ... })
 *
 * Self-loops in the input edge list are filtered (matching SW's
 * convention). Multi-edges accumulate weight in a (u,v) -> count map
 * before being emitted as a single weighted mutable_graph edge.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  if (!C.VIECUT || !C.VIECUT.cactus_mincut) return;
  const M = (C.MINCUT = C.MINCUT || {});

  function viecut(nodeIds, edges, opts) {
    opts = opts || {};
    const n = nodeIds.length;
    if (n < 2) {
      return { cutValue: Infinity,
               inPartition: nodeIds.slice(), outPartition: [], phases: [] };
    }
    const idToIdx = new Map();
    nodeIds.forEach((id, i) => idToIdx.set(id, i));

    const G = new C.VIECUT.MutableGraph();
    G.start_construction(n);
    G.last_node = n;
    // Accumulate weight per (u,v) pair; mutable_graph::new_edge takes
    // wgt directly (no internal merge), so build a dedup map first.
    const wgtMap = new Map();
    for (const ed of edges) {
      const a = idToIdx.get(ed[0]);
      const b = idToIdx.get(ed[1]);
      if (a === undefined || b === undefined) continue;
      if (a === b) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const key = lo + "," + hi;
      wgtMap.set(key, (wgtMap.get(key) || 0) + 1);
    }
    // [UPSTREAM mincut_custom.cpp:50-72 + igraph_induced_subgraph_map]
    // cpp reads edges via igraph_induced_subgraph_map which canonicalizes
    // edges; the resulting mutable_graph adj lists are neighbour-ID ASC
    // per node. mutable_graph.h:131-144 new_edge(src, tgt) only fires on
    // src < tgt, appending to adj[src] then adj[tgt]; insertion order
    // determines adj iteration. To mirror cpp's ASC adj, sort wgtMap
    // entries by (lo, hi) ASC before adding. Without this, JS adj lists
    // follow input edge order, producing different capforest / pr12 / pr34
    // contractions on the same input. Root cause of WCC pseed=1
    // FAIL_HARD on whole-graph clusters.
    const sortedKeys = [];
    for (const key of wgtMap.keys()) sortedKeys.push(key);
    sortedKeys.sort((a, b) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return ax !== bx ? ax - bx : ay - by;
    });
    for (const key of sortedKeys) {
      const [lo, hi] = key.split(",").map(Number);
      G.new_edge(lo, hi, wgtMap.get(key));
    }
    G.finish_construction();

    // [UPSTREAM mincut_custom.cpp:37] setSeed COMMENTED OUT; chained mincut
    // calls share m_mt state for the run. Pass through opts.seed only when
    // caller explicitly provides one (standalone tracer); chained WCC/CM
    // calls leave it unset so cactus_mincut keeps prior RNG state.
    const cactusOpts = (opts.seed !== undefined) ? { seed: opts.seed } : {};
    const result = C.VIECUT.cactus_mincut(G, cactusOpts);
    const inP = result.inPartition.map((i) => nodeIds[i]);
    const outP = result.outPartition.map((i) => nodeIds[i]);
    return { cutValue: result.cutValue, inPartition: inP, outPartition: outP,
             phases: [] };
  }

  M.viecut = viecut;
  // [UPSTREAM tools/random_functions.h:187-191] expose setSeed so kernel
  // verification harnesses can pin the chained-mincut RNG state to the
  // tracer's argv seed (cpp tracer calls random_functions::setSeed(seed)
  // at startup; JS must mirror to get bit-equal start_vertex per pop).
  // Production walkers don't call this; m_mt persists at default 5489.
  M.viecut.setSeed = function (s) { C.VIECUT.random_functions.setSeed(s); };
})();
