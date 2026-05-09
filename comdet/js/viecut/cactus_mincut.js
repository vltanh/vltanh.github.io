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

  // Walker hook (zero-cost when no harness installed). Gated via typeof
  // so production walker callers (cc/wcc/cm chained mincut) pay no
  // overhead. The kernel return value is byte-identical with vs without
  // the hook; verified by tools/viz_check/viecut/hooks_equiv.mjs.
  function emit(event, payload) {
    const h = (typeof globalThis !== "undefined") && globalThis.__VIECUT_HOOK;
    if (typeof h === "function") h(event, payload);
  }

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

    emit("init", { n: graphs[0].number_of_nodes(), m: graphs[0].number_of_edges(), mincut });

    const guaranteed_edges = [];
    const ge_ids = [];
    let previous_size = UNDEFINED_NODE;
    let outer_iter = 0;
    while (graphs[graphs.length - 1].number_of_nodes() * 1.01 < previous_size) {
      previous_size = graphs[graphs.length - 1].number_of_nodes();
      const current_graph = graphs[graphs.length - 1];
      const current_mincut = mincut;
      ge_ids.push(graphs.length - 1);
      guaranteed_edges.push([]);
      emit("outer_iter_start", { iter: outer_iter, n: current_graph.number_of_nodes(), mincut });

      emit("phase_A_start", { iter: outer_iter, n: current_graph.number_of_nodes(), mincut });
      const uf = NS.noi_minimum_cut.modified_capforest(current_graph, mincut + 1);
      emit("phase_A_end", { iter: outer_iter, uf_n: uf.n() });
      emit("phase_B_start", { iter: outer_iter });
      const ge_collected = [];
      for (let n = 0; n < current_graph.number_of_nodes(); n++) {
        const e0 = 0;
        if (current_graph.get_first_invalid_edge(n) - e0 === 1) {
          if (current_graph.getEdgeWeight(n, e0) === mincut && uf.n() > 1) {
            const t = current_graph.getEdgeTarget(n, e0);
            uf.Union(n, t);
            guaranteed_edges[guaranteed_edges.length - 1].push([n, t]);
            ge_collected.push([n, t]);
          }
        }
      }
      emit("phase_B_end", { iter: outer_iter, unions: ge_collected });
      emit("phase_D_start", { iter: outer_iter, kind: "post_NOI", uf_n: uf.n(), n_before: current_graph.number_of_nodes() });
      if (uf.n() < current_graph.number_of_nodes()) {
        const newg = NS.contraction.fromUnionFind(current_graph, uf, true);
        graphs.push(newg);
        mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
      }
      emit("phase_D_end", { iter: outer_iter, kind: "post_NOI", n_after: graphs[graphs.length - 1].number_of_nodes(), mincut });
      emit("phase_C_start", { iter: outer_iter, sub: "PR12" });
      const uf12 = NS.tests.prTests12(graphs[graphs.length - 1], mincut + 1, true);
      emit("phase_C_end", { iter: outer_iter, sub: "PR12", uf_n: uf12.n(), n_before: graphs[graphs.length - 1].number_of_nodes() });
      if (uf12.n() < graphs[graphs.length - 1].number_of_nodes()) {
        const g12 = NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf12, true);
        graphs.push(g12);
        mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
      }
      emit("phase_C_start", { iter: outer_iter, sub: "PR34" });
      const uf34 = NS.tests.prTests34(graphs[graphs.length - 1], mincut + 1, true);
      emit("phase_C_end", { iter: outer_iter, sub: "PR34", uf_n: uf34.n(), n_before: graphs[graphs.length - 1].number_of_nodes() });
      if (uf34.n() < graphs[graphs.length - 1].number_of_nodes()) {
        const g34 = NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf34, true);
        graphs.push(g34);
        mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
      }
      if (current_mincut > mincut) {
        guaranteed_edges.length = 0;
        ge_ids.length = 0;
      }
      emit("outer_iter_end", { iter: outer_iter, n_after: graphs[graphs.length - 1].number_of_nodes(), mincut });
      outer_iter++;
    }

    if (graphs[graphs.length - 1].number_of_nodes() > 1) {
      mincut = Math.min(
        mincut,
        NS.noi_minimum_cut.perform_minimum_cut(graphs[graphs.length - 1], true));
    }

    emit("phase_E_start", { mincut, n_in: graphs[graphs.length - 1].number_of_nodes() });
    const rc = new NS.RecursiveCactus(mincut);
    const out_graph = rc.flowMincut(graphs);
    emit("phase_E_end", { mincut, cactus_n: out_graph ? out_graph.number_of_nodes() : 0,
      cactus_edges: out_graph ? out_graph.number_of_edges() : 0 });
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
    emit("phase_F_start", { cactus_n: cactus.n(), sv, mincut: result.mincut });
    const dfs = NS.runBalancedCutDFS(cactus, result.mincut, sv);
    emit("phase_F_end", { dfs });
    const n_orig = cactus.getOriginalNodes();
    emit("phase_G_start", { dfs, n_orig });
    const inCut = NS.findBipartitionFromCactus(cactus, n_orig, dfs);
    const inP = [], outP = [];
    for (let i = 0; i < n_orig; i++) (inCut[i] ? inP : outP).push(i);
    emit("phase_G_end", { inP: inP.slice(), outP: outP.slice(), cutValue: result.mincut });
    return { cutValue: result.mincut, inPartition: inP, outPartition: outP,
             cactus: result.out_graph };
  }

  NS.cactus_mincut = cactus_mincut;
  NS.findAllMincuts = findAllMincuts;
})();
