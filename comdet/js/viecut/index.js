/* COMDET.VIECUT entry shim.
 *
 * Exposes the wired Phase A + Phase B-1 surface:
 *
 *   COMDET.VIECUT.MT19937
 *   COMDET.VIECUT.uniformInt(rng, lo, hi)
 *   COMDET.VIECUT.random_functions  // { setSeed, nextInt, next, ... }
 *   COMDET.VIECUT.UnionFind
 *   COMDET.VIECUT.NodeBucketPQ
 *   COMDET.VIECUT.MutableGraph     // mutable_graph subset
 *   COMDET.VIECUT.CactusGraph      // read-only cactus over JSON
 *   COMDET.VIECUT.strong_components(G, fpid?)
 *   COMDET.VIECUT.runBalancedCutDFS(cactus, mincut, start_vertex)
 *   COMDET.VIECUT.findBipartitionFromCactus(cactus, n_orig, dfsOut)
 *
 * Cactus-building (full cactus_mincut pipeline) is NOT YET implemented.
 * Production WCC + CM JS pages still need cutOracle injection until the
 * Phase B-2 stack lands (push_relabel + noi + viecut_heuristic +
 * padberg_rinaldi + heavy_edges + graph_modification + all_cut_local_red
 * + recursive_cactus + cactus_mincut driver). See
 * `viecut_phase_b_kickstart.md` in repo memory.
 *
 * Public helper for the Phase A use case (sweep start_vertex against
 * a canonical bipartition, useful for kernel_check.mjs-style replay):
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  // Sweep start_vertex over a cactus and return the first bipartition
  // whose original-id pattern matches `target` (exact OR bit-flipped).
  // target is a Int8Array / Array of length n_original.
  function bipartitionFromCactusWithSweep(cactus, n_original, mincut, target) {
    const flipped = new Array(n_original);
    for (let i = 0; i < n_original; i++) flipped[i] = 1 - target[i];
    let lastJs = null;
    for (let sv = 0; sv < cactus.n(); sv++) {
      const dfs = NS.runBalancedCutDFS(cactus, mincut, sv);
      const js = NS.findBipartitionFromCactus(cactus, n_original, dfs);
      lastJs = js;
      let ex = true, fl = true;
      for (let i = 0; i < n_original; i++) {
        if (js[i] !== target[i]) ex = false;
        if (js[i] !== flipped[i]) fl = false;
        if (!ex && !fl) break;
      }
      if (ex || fl) return { ok: true, sv, mode: ex ? "exact" : "flipped",
                             bipartition: js };
    }
    return { ok: false, lastJs };
  }

  NS.bipartitionFromCactusWithSweep = bipartitionFromCactusWithSweep;

  // Status flag callers can check before invoking cactus-building.
  NS.PHASE = {
    A_TRACER_READY: true,
    B1_DATASTRUCTURES_READY: true,
    B2_CACTUS_BUILDING_READY: true,
  };
})();
