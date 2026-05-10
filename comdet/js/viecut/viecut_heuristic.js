/* viecut: inexact mincut heuristic with label_propagation contraction.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/viecut.h]
 *
 * Two operating regimes:
 *   - n <= 10000: LP-loop is bypassed, noi runs directly. The current
 *     iter never enters the while-body because graphs.back().n_nodes
 *     is not > 10000.
 *   - n > 10000: LP-loop fires. Per iter:
 *       1. label_propagation::propagate_labels(G) -> cluster_mapping
 *       2. minimum_cut_helpers::remap_cluster(G, cluster_mapping) ->
 *          (mapping, reverse_mapping) compactified
 *       3. contraction::findTrivialCuts(G, &mapping, &reverse_mapping, cut)
 *       4. H = contraction::contractGraph(G, mapping, reverse_mapping)
 *          (copy=true default; routes through Vertexset or Sparse based
 *           on density)
 *       5. graphs.push_back(H); cut = updateCut(graphs, cut)
 *       6. uf12 = prTests12(graphs.back(), cut, find_all_cuts=false);
 *          graphs.push_back(fromUnionFind(graphs.back(), uf12, true));
 *          cut = updateCut(graphs, cut)
 *       7. uf34 = prTests34(graphs.back(), cut, find_all_cuts=false);
 *          graphs.push_back(fromUnionFind(graphs.back(), uf34, true));
 *          cut = updateCut(graphs, cut)
 *     Loop guard: graphs.back().n > 10000 AND (graphs.size==1 OR
 *     graphs.back().n < graphs[size-2].n) -> exits when n drops to
 *     <=10000 OR no shrink occurred.
 *
 * NOTE on prTests12/34 invocations: viecut.h calls them WITHOUT the
 * third `find_all_cuts` arg, so it defaults to false. cactus_mincut.h
 * passes `true`. Our JS prTests12/34 take `find_all_cuts` as 3rd arg;
 * we pass `false` here.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function emit(event, payload) {
    const h = (typeof globalThis !== "undefined") && globalThis.__VIECUT_HOOK;
    if (typeof h === "function") h(event, payload);
  }

  function perform_minimum_cut_vc(G, indirect) {
    if (!G) return -1;
    let cut = G.getMinDegree();
    const graphs = [G];
    NS.minimum_cut_helpers.setInitialCutValues(graphs);

    emit("vc_lp_loop_enter", { n: graphs[graphs.length - 1].number_of_nodes(),
                               min_deg: cut });

    let lp_iter = 0;
    while (graphs[graphs.length - 1].number_of_nodes() > 10000 &&
           (graphs.length === 1 ||
            (graphs[graphs.length - 1].number_of_nodes() <
             graphs[graphs.length - 2].number_of_nodes()))) {
      let GcurH = graphs[graphs.length - 1];
      emit("vc_lp_iter_start", { iter: lp_iter,
                                 n: GcurH.number_of_nodes(),
                                 m: GcurH.number_of_edges(),
                                 cut });

      // [UPSTREAM viecut.h:76] label_propagation lp; lp.propagate_labels(G)
      const cluster_mapping =
        NS.label_propagation.propagate_labels(GcurH);

      // [UPSTREAM viecut.h:78] remap_cluster
      const { mapping, reverse_mapping } =
        NS.minimum_cut_helpers.remap_cluster(GcurH, cluster_mapping);

      // [UPSTREAM viecut.h:83] findTrivialCuts (mutates mapping +
      // reverse_mapping in place; cut value passed by-value, so cpp's
      // local target_mindeg shadowing does not propagate back to caller).
      NS.contraction.findTrivialCuts(GcurH, mapping, reverse_mapping, cut);

      // [UPSTREAM viecut.h:86] contractGraph(G, mapping, reverse_mapping)
      // copy=true default. Density branch selects sparse vs vertexset.
      const H = NS.contraction.contractGraph(GcurH, mapping, reverse_mapping, true);
      graphs.push(H);
      cut = NS.minimum_cut_helpers.updateCut(graphs, cut);
      emit("vc_lp_contracted", { iter: lp_iter,
                                 n_after: graphs[graphs.length - 1].number_of_nodes(),
                                 cut });

      // [UPSTREAM viecut.h:93] tests::prTests12(graphs.back(), cut)
      // (no third arg -> find_all_cuts default false)
      const uf12 = NS.tests.prTests12(graphs[graphs.length - 1], cut, false);
      graphs.push(NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf12, true));
      cut = NS.minimum_cut_helpers.updateCut(graphs, cut);

      // [UPSTREAM viecut.h:97] tests::prTests34
      const uf34 = NS.tests.prTests34(graphs[graphs.length - 1], cut, false);
      graphs.push(NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf34, true));
      cut = NS.minimum_cut_helpers.updateCut(graphs, cut);

      emit("vc_lp_iter_end", { iter: lp_iter,
                               n_after: graphs[graphs.length - 1].number_of_nodes(),
                               cut });
      ++lp_iter;
    }

    emit("vc_lp_loop_exit", { iters: lp_iter,
                              n_final: graphs[graphs.length - 1].number_of_nodes(),
                              cut });

    if (graphs[graphs.length - 1].number_of_nodes() > 1) {
      cut = Math.min(
        cut, NS.noi_minimum_cut.perform_minimum_cut(graphs[graphs.length - 1], true));
    }
    if (!indirect) NS.minimum_cut_helpers.retrieveMinimumCut(graphs);
    return cut;
  }

  NS.viecut_heuristic = { perform_minimum_cut: perform_minimum_cut_vc };
})();
