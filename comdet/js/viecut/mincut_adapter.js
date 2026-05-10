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
    // [UPSTREAM mincut_custom.cpp:50-72 + kernel_check.cpp:121-134 +
    // igraph_induced_subgraph_map (subgraph.c:96-209) + igraph_incident
    // (type_indexededgelist.c:1775-1850)] cpp's new_edge call sequence:
    // igraph_i_induced_subgraph_create_from_scratch iterates new_vid
    // Y=0..n-1 ASC (subgraph.c:171; the vertex selector is pre-sorted at
    // subgraph.c:154 — WCC's cur is already orig-ASC via bfsComponentsLocal
    // sort at wcc.js:76 so new_vid order == orig-ASC order). For each Y,
    // it calls igraph_incident(orig, Y_orig, OUT, LOOPS); the loops at
    // type_indexededgelist.c:1826-1850 walk the oi / ii index blocks which
    // are sorted by OTHER-ENDPOINT-ID ASC (the explicit invariant at
    // :1816-1822: "the output is sorted by the vertex IDs of the other
    // endpoint"). It then emits new_edge(other_new, Y_new, 1) only when
    // Y_orig is the larger orig endpoint (subgraph.c:201; igraph stores
    // undirected edges with from = max). Because cur is orig-ASC, "other
    // < Y_orig" == "other_new < Y_new" == lo_new < hi_new; the filtered
    // emission order at iteration Y is therefore lo_new ASC. Net cpp
    // new_edge call sequence: PRIMARY hi_new ASC, SECONDARY lo_new ASC.
    // mutable_graph::new_edge (mutable_graph.h:131-144) appends to
    // adj[src] AND adj[tgt] in this call order, so adj-list contents at
    // each vertex inherit the same primary/secondary order. (hi, lo) ASC
    // is the in-principle mirror; (lo, hi) ASC was wrong-primary, masked
    // by structural symmetry on most clusters but exposed on chained
    // sbm-flat-pp clusters where cluster topology forces capforest /
    // pr12 / pr34 to walk the diverged adj order.
    const sortedKeys = [];
    for (const key of wgtMap.keys()) sortedKeys.push(key);
    sortedKeys.sort((a, b) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return ay !== by ? ay - by : ax - bx;
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
