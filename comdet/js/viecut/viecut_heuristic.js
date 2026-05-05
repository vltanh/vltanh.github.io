/* viecut: inexact mincut heuristic with label_propagation contraction.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/viecut.h]
 *
 * For n <= 10000 the heuristic loop is bypassed entirely and noi runs
 * directly. Cactus inputs we exercise (fixture32 + dnc clusters) all
 * fall under that bound, so this port omits the LP + findTrivialCuts
 * + contractGraph branch and delegates to noi for any non-trivial
 * graph.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function perform_minimum_cut_vc(G, indirect) {
    if (!G) return -1;
    let cut = G.getMinDegree();
    const graphs = [G];
    NS.minimum_cut_helpers.setInitialCutValues(graphs);
    // n <= 10000 short-circuit; LP loop skipped.
    if (graphs[graphs.length - 1].number_of_nodes() > 1) {
      cut = Math.min(
        cut, NS.noi_minimum_cut.perform_minimum_cut(graphs[graphs.length - 1], true));
    }
    if (!indirect) NS.minimum_cut_helpers.retrieveMinimumCut(graphs);
    return cut;
  }

  NS.viecut_heuristic = { perform_minimum_cut: perform_minimum_cut_vc };
})();
