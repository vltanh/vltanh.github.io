/* cactus_mincut: top-level driver. findAllMincuts orchestrates VIECUT
 * heuristic + capforest contractions + Padberg-Rinaldi tests + flowMincut
 * + most_balanced_minimum_cut.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/cactus_mincut.h]
 *
 * Public API: COMDET.VIECUT.cactus_mincut(G, opts) -> {
 *   cutValue, inPartition, outPartition, cactus  // mutable_graph
 * }
 *
 * G is a COMDET.VIECUT.MutableGraph. opts.seed sets the std::mt19937
 * seed for capforest start_vertex + max-flow problem ids + balanced
 * DFS start; opts.known_mincut pre-supplies a cut value to skip the
 * VIECUT bound. The bipartition is always selected via balanced DFS
 * over the cactus.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_NODE = 0xffffffff;

  function findAllMincuts(graphs, known_mincut) {
    if (!graphs.length || !graphs[graphs.length - 1]) {
      return { mincut: -1, out_graph: null };
    }
    let mincut = graphs[graphs.length - 1].getMinDegree();
    if (known_mincut === undefined || known_mincut === UNDEFINED_NODE) {
      mincut = NS.viecut_heuristic.perform_minimum_cut(
        graphs[graphs.length - 1], true);
    } else {
      mincut = known_mincut;
    }
    NS.minimum_cut_helpers.setInitialCutValues(graphs);

    const guaranteed_edges = [];
    const ge_ids = [];
    let previous_size = UNDEFINED_NODE;
    while (graphs[graphs.length - 1].number_of_nodes() * 1.01 < previous_size) {
      previous_size = graphs[graphs.length - 1].number_of_nodes();
      const current_graph = graphs[graphs.length - 1];
      const current_mincut = mincut;
      ge_ids.push(graphs.length - 1);
      guaranteed_edges.push([]);

      const uf = NS.noi_minimum_cut.modified_capforest(current_graph, mincut + 1);
      for (let n = 0; n < current_graph.number_of_nodes(); n++) {
        const e0 = 0;
        if (current_graph.get_first_invalid_edge(n) - e0 === 1) {
          if (current_graph.getEdgeWeight(n, e0) === mincut && uf.n() > 1) {
            const t = current_graph.getEdgeTarget(n, e0);
            uf.Union(n, t);
            guaranteed_edges[guaranteed_edges.length - 1].push([n, t]);
          }
        }
      }
      if (uf.n() < current_graph.number_of_nodes()) {
        const newg = NS.contraction.fromUnionFind(current_graph, uf, true);
        graphs.push(newg);
        mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
      }
      const uf12 = NS.tests.prTests12(graphs[graphs.length - 1], mincut + 1, true);
      if (uf12.n() < graphs[graphs.length - 1].number_of_nodes()) {
        const g12 = NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf12, true);
        graphs.push(g12);
        mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
      }
      const uf34 = NS.tests.prTests34(graphs[graphs.length - 1], mincut + 1, true);
      if (uf34.n() < graphs[graphs.length - 1].number_of_nodes()) {
        const g34 = NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf34, true);
        graphs.push(g34);
        mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
      }
      if (current_mincut > mincut) {
        guaranteed_edges.length = 0;
        ge_ids.length = 0;
      }
    }

    if (graphs[graphs.length - 1].number_of_nodes() > 1) {
      mincut = Math.min(
        mincut,
        NS.noi_minimum_cut.perform_minimum_cut(graphs[graphs.length - 1], true));
    }

    const rc = new NS.RecursiveCactus(mincut);
    const out_graph = rc.flowMincut(graphs);
    NS.minimum_cut_helpers.setVertexLocations(
      out_graph, graphs, ge_ids, guaranteed_edges, mincut);

    return { mincut, out_graph };
  }

  // High-level wrapper matching the cutOracle contract used by WCC + CM.
  // Returns { cutValue, inPartition, outPartition }.
  function cactus_mincut(G, opts) {
    if (!opts) opts = {};
    // [UPSTREAM mincut_custom.cpp:37] setSeed COMMENTED OUT; m_mt persists
    // across mincut calls for the run. Only re-seed when caller explicitly
    // requests it (standalone tests pass opts.seed; chained WCC/CM calls
    // do not, so m_mt stays in its run-evolved state matching cpp).
    if (opts.seed !== undefined) {
      NS.random_functions.setSeed(opts.seed);
    }
    const graphs = [G];
    const result = findAllMincuts(graphs, opts.known_mincut);
    if (result.mincut <= 0 || !result.out_graph) {
      return { cutValue: result.mincut,
               inPartition: graphs[0].containedVertices(0).slice(),
               outPartition: [] };
    }
    const cactus = result.out_graph;
    const sv = NS.random_functions.nextInt(0, cactus.n() - 1);
    const dfs = NS.runBalancedCutDFS(cactus, result.mincut, sv);
    const n_orig = cactus.getOriginalNodes();
    const inCut = NS.findBipartitionFromCactus(cactus, n_orig, dfs);
    const inP = [], outP = [];
    for (let i = 0; i < n_orig; i++) (inCut[i] ? inP : outP).push(i);
    return { cutValue: result.mincut, inPartition: inP, outPartition: outP,
             cactus: result.out_graph };
  }

  NS.cactus_mincut = cactus_mincut;
  NS.findAllMincuts = findAllMincuts;
})();
