/* COMDET.VIECUT entry shim.
 *
 * Exposes the full cactus-mincut surface:
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
 *   COMDET.VIECUT.cactus_mincut(G, opts)  // full pipeline
 *
 * `bipartitionFromCactusWithSweep` is the helper used by tracers when
 * canonical's start_vertex is unknowable (RNG state divergence between
 * canonical's pre-DFS calls and the JS port). It sweeps start_vertex
 * 0..n-1 and returns the first match (exact or bit-flipped).
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
