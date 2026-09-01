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
    const h = typeof globalThis !== "undefined" && globalThis.__VIECUT_HOOK;
    if (typeof h === "function") h(event, payload);
  }

  // Per byte-equal-tracer "Tracer prints stay" discipline: optional probes
  // mirroring canonical [TRACE-CM-*] tags. Guarded by globalThis.__VIECUT_TRACE__
  // so production walker is unaffected.
  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

  const UNDEFINED_NODE = 0xffffffff;

  function findAllMincuts(graphs, known_mincut) {
    if (!graphs.length || !graphs[graphs.length - 1]) {
      return { mincut: -1, out_graph: null };
    }
    let mincut = graphs[graphs.length - 1].getMinDegree();
    if (known_mincut === undefined || known_mincut === UNDEFINED_NODE) {
      mincut = NS.viecut_heuristic.perform_minimum_cut(graphs[graphs.length - 1], true);
    } else {
      mincut = known_mincut;
    }
    NS.minimum_cut_helpers.setInitialCutValues(graphs);

    emit("init", { n: graphs[0].number_of_nodes(), m: graphs[0].number_of_edges(), mincut });

    const guaranteed_edges = [];
    const ge_ids = [];
    let previous_size = UNDEFINED_NODE;
    let outer_iter = 0;
    while (true) {
      // [TRACE-CM] outer-while FP product n*1.01 BEFORE+AFTER mult.
      const nn = graphs[graphs.length - 1].number_of_nodes();
      const nn_d = nn;
      const nn_x_101 = nn_d * 1.01;
      const cont = nn_x_101 < previous_size ? 1 : 0;
      _trace(
        `[TRACE-CM] outer_guard loop_iter:${outer_iter} n:${nn} ` +
          `nn_d:${nn_d.toFixed(6)} nn_x_101:${nn_x_101.toFixed(6)} ` +
          `prev:${previous_size} cont:${cont}`
      );
      if (!cont) break;
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
      // [TRACE-CM-D1] degree-1 cleanup per-node (T4).
      for (let n = 0; n < current_graph.number_of_nodes(); n++) {
        const fie = current_graph.get_first_invalid_edge(n);
        const deg_diff = fie; // e0 = 0
        const deg1 = deg_diff === 1 ? 1 : 0;
        const w = deg1 ? current_graph.getEdgeWeight(n, 0) : 0;
        const wgt_eq_mc = deg1 && w === mincut ? 1 : 0;
        const ufn_gt1 = uf.n() > 1 ? 1 : 0;
        const take = deg1 && wgt_eq_mc && ufn_gt1 ? 1 : 0;
        const t = take ? current_graph.getEdgeTarget(n, 0) : 0;
        if (take) {
          uf.Union(n, t);
          guaranteed_edges[guaranteed_edges.length - 1].push([n, t]);
          ge_collected.push([n, t]);
        }
        _trace(
          `[TRACE-CM-D1] iter:${outer_iter} n:${n} fie:${fie} ` +
            `deg:${deg_diff} wgt:${w} mc:${mincut} deg1:${deg1} ` +
            `wgt_eq_mc:${wgt_eq_mc} ufn_gt1:${ufn_gt1} ` +
            `take:${take} t:${t}`
        );
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
      {
        let line = `[TRACE-CM] pr12_uf iter:${outer_iter} members`;
        const nn = graphs[graphs.length - 1].n();
        for (let v = 0; v < nn; v++) line += ` ${v}->${uf12.Find(v)}`;
        _trace(line);
      }
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

    const noi_branch = graphs[graphs.length - 1].number_of_nodes() > 1 ? 1 : 0;
    _trace(`[TRACE-CM] noi_branch n_after_outer:${graphs[graphs.length - 1].number_of_nodes()} ` + `take:${noi_branch}`);
    if (noi_branch) {
      mincut = Math.min(mincut, NS.noi_minimum_cut.perform_minimum_cut(graphs[graphs.length - 1], true));
      _trace(`[TRACE-CM] noi_result mincut:${mincut}`);
    }

    emit("phase_E_start", { mincut, n_in: graphs[graphs.length - 1].number_of_nodes() });
    const rc = new NS.RecursiveCactus(mincut);
    const out_graph = rc.flowMincut(graphs);
    emit("phase_E_end", { mincut, cactus_n: out_graph ? out_graph.number_of_nodes() : 0, cactus_edges: out_graph ? out_graph.number_of_edges() : 0 });
    NS.minimum_cut_helpers.setVertexLocations(out_graph, graphs, ge_ids, guaranteed_edges, mincut);

    // [TRACE-CM-SVL] per-vertex partition assignment AFTER setVertexLocations
    // (cactus_mincut.h:173).
    if (out_graph) {
      _trace(`[TRACE-CM-SVL] out_graph_n:${out_graph.n()} ` + `graphs_n:${graphs.length}`);
      for (let v = 0; v < out_graph.n(); v++) {
        let line = `[TRACE-CM-SVL] node:${v} contained:`;
        for (const cv of out_graph.containedVertices(v)) line += `${cv},`;
        _trace(line);
      }
    }

    return { mincut, out_graph };
  }

  // High-level wrapper matching the cutOracle contract used by WCC + CM.
  // Returns { cutValue, inPartition, outPartition }.
  function cactus_mincut(G, opts) {
    if (!opts) opts = {};
    // [UPSTREAM main.cpp:125,138] the full binary seeds MT19937 with 0 once;
    // [mincut_custom.cpp:37] does not re-seed, so state persists across cuts.
    // Only re-seed here when a caller explicitly requests a standalone run;
    // chained WCC/CM calls keep the process-evolved state.
    if (opts.seed !== undefined) {
      NS.random_functions.setSeed(opts.seed);
    }
    const graphs = [G];
    const result = findAllMincuts(graphs, opts.known_mincut);
    const mc_eq_0 = result.mincut === 0 ? 1 : 0;
    _trace(`[TRACE-MB] mincut_zero_check mincut:${result.mincut} ` + `eq0:${mc_eq_0}`);
    if (result.mincut <= 0 || !result.out_graph) {
      return { cutValue: result.mincut, inPartition: graphs[0].containedVertices(0).slice(), outPartition: [] };
    }
    const cactus = result.out_graph;
    const sv = NS.random_functions.nextInt(0, cactus.n() - 1);
    emit("phase_F_start", { cactus_n: cactus.n(), sv, mincut: result.mincut });
    const dfs = NS.runBalancedCutDFS(cactus, result.mincut, sv);
    emit("phase_F_end", { dfs });
    const n_orig = cactus.getOriginalNodes();
    emit("phase_G_start", { dfs, n_orig });
    const inCut = NS.findBipartitionFromCactus(cactus, n_orig, dfs);
    const inP = [],
      outP = [];
    for (let i = 0; i < n_orig; i++) (inCut[i] ? inP : outP).push(i);
    // [TRACE-MB-FE] T29 final edge collection — iterate the original graph
    // to mirror canonical most_balanced_minimum_cut.h:90-98.
    const origG = graphs[0];
    for (let on = 0; on < origG.number_of_nodes(); on++) {
      const ne = origG.get_first_invalid_edge(on);
      for (let oe = 0; oe < ne; oe++) {
        const ot = origG.getEdgeTarget(on, oe);
        const in_on = inCut[on] ? 1 : 0;
        const in_ot = inCut[ot] ? 1 : 0;
        const diff = in_on !== in_ot ? 1 : 0;
        _trace(`[TRACE-MB-FE] on:${on} oe:${oe} ot:${ot} ` + `in_on:${in_on} in_ot:${in_ot} diff:${diff} ` + `emit:${diff}`);
      }
    }
    emit("phase_G_end", { inP: inP.slice(), outP: outP.slice(), cutValue: result.mincut });
    return { cutValue: result.mincut, inPartition: inP, outPartition: outP, cactus: result.out_graph };
  }

  NS.cactus_mincut = cactus_mincut;
  NS.findAllMincuts = findAllMincuts;
})();
