/* recursive_cactus: build the cactus tree from min ST-cuts.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/recursive_cactus.h]
 *
 * flowMincut wraps recursiveCactus with heavy_edges pre/post.
 * recursiveCactus alternates noi capforest + prTests12 + prTests34
 * contractions then picks (s,t) with maximumWeightedFlowEdge + runs
 * push_relabel. If max_flow > mincut, contract (s,t) + recurse. Else
 * SCC the residual + assemble cactus per ST-cut block sizes.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_NODE = 0xffffffff;
  const UNDEFINED_EDGE = 0xffffffff;

  // Per byte-equal-tracer playbook discipline "Tracer prints stay": optional
  // bisection probes around recursive_cactus build chain. Guarded by global
  // __VIECUT_TRACE__ so production walker is unaffected when not set.
  function _trace() {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      const line = Array.prototype.join.call(arguments, "");
      process.stderr.write(line + "\n");
    }
  }

  function RecursiveCactus(mincut) {
    // [UPSTREAM recursive_cactus.h:52] Default ctor leaves problem_id
    // unset; flowMincut() initialises it from random_functions::next().
    // The mincut-arg ctor (line 53) DOES draw an RNG value, but
    // cactus_mincut.h:76 uses the default ctor + setMincut(), so the
    // JS port follows that path. Calling next() here would advance the
    // RNG one extra step relative to canonical and break byte-equal
    // start_vertex selection in balanced_cut_dfs.
    this.mincut = mincut;
    this.problem_id = 0;
  }

  RecursiveCactus.prototype.setMincut = function (m) { this.mincut = m; };

  RecursiveCactus.prototype.flowMincut = function (graphs) {
    this.problem_id = NS.random_functions.next();
    const last = graphs[graphs.length - 1];
    let in_graph = NS.contraction.cloneGraph(last);
    const out_graph = this._recursiveCactus(in_graph, 0);
    return out_graph;
  };

  RecursiveCactus.prototype._recursiveCactus = function (G, depth) {
    // [TRACE-RC-W] wrapper probes mirror canonical recursive_cactus.h:102-111.
    _trace(`[TRACE-RC-W] enter depth:${depth} n_in:${G.n()} `
           + `m_in:${G.number_of_edges()} mincut:${this.mincut}`);
    const he = new NS.HeavyEdges(this.mincut);
    const cactusEdges = he.removeHeavyEdges(G);
    _trace(`[TRACE-RC-W] after_removeHeavy depth:${depth} n:${G.n()} `
           + `m:${G.number_of_edges()} cactusEdges_n:${cactusEdges.length}`);
    const cycleEdges = he.contractCycleEdges(G);
    _trace(`[TRACE-RC-W] after_contractCycle depth:${depth} n:${G.n()} `
           + `m:${G.number_of_edges()} cycleEdges_n:${cycleEdges.length}`);
    G = this._internalRecursiveCactus(G, depth);
    _trace(`[TRACE-RC-W] after_internal depth:${depth} n:${G.n()} `
           + `m:${G.number_of_edges()}`);
    he.reInsertCycles(G, cycleEdges);
    _trace(`[TRACE-RC-W] after_reInsertCycles depth:${depth} n:${G.n()} `
           + `m:${G.number_of_edges()}`);
    for (let gn = 0; gn < G.number_of_nodes(); gn++) {
      let line = `[TRACE-RC-W]  reInsCyc_contained[${gn}]:`;
      for (const cv of G.containedVertices(gn)) line += `${cv},`;
      _trace(line);
    }
    he.reInsertVertices(G, cactusEdges);
    _trace(`[TRACE-RC-W] after_reInsertVerts depth:${depth} n:${G.n()} `
           + `m:${G.number_of_edges()}`);
    for (let gn = 0; gn < G.number_of_nodes(); gn++) {
      let line = `[TRACE-RC-W]  reInsVtx_contained[${gn}]:`;
      for (const cv of G.containedVertices(gn)) line += `${cv},`;
      _trace(line);
    }
    _trace(`[TRACE-RC-W] exit depth:${depth} n_out:${G.n()} `
           + `m_out:${G.number_of_edges()}`);
    return G;
  };

  RecursiveCactus.prototype._internalRecursiveCactus = function (G, depth) {
    _trace("[TRACE-RC] internalRecursiveCactus depth:", depth,
           " n:", G.n(), " m:", G.number_of_edges(),
           " problem_id:", this.problem_id);
    if (depth % 10 === 0) {
      let previous = UNDEFINED_NODE;
      while (previous > G.n()) {
        previous = G.n();
        const uf = NS.noi_minimum_cut.modified_capforest(G, this.mincut + 1);
        G = NS.contraction.fromUnionFind(G, uf);
        const uf12 = NS.all_cut_local_red.allCutsPrTests12(G, this.mincut);
        G = NS.contraction.fromUnionFind(G, uf12);
        const uf34 = NS.all_cut_local_red.allCutsPrTests34(G, this.mincut);
        G = NS.contraction.fromUnionFind(G, uf34);
      }
    }
    if (G.number_of_nodes() === 1 || G.number_of_edges() === 0) return G;

    // [TRACE-RC] edge_selection — cpp picks per cfg->edge_selection; JS
    // hard-defaults to maximumWeightedFlowEdge (heavy_vertex semantics).
    _trace(`[TRACE-RC] edge_selection depth:${depth} es:heavy_vertex`);
    const [s, e, tgt] = this._maximumWeightedFlowEdge(G);
    _trace("[TRACE-RC] flow_edge depth:", depth, " s:", s, " e:", e,
           " tgt:", tgt);
    const pr = new NS.PushRelabel();
    const pid_before = this.problem_id;
    this.problem_id++;
    _trace(`[TRACE-RC] problem_id depth:${depth} pid_before:${pid_before} `
           + `pid_after:${this.problem_id}`);
    const [max_flow] = pr.solve_max_flow_min_cut(G, [s, tgt], 0, false, 0,
                                                 this.problem_id);
    _trace("[TRACE-RC] max_flow depth:", depth, " val:", max_flow,
           " mincut:", this.mincut);
    const mf_gt_mc = max_flow > this.mincut ? 1 : 0;
    _trace(`[TRACE-RC] mf_branch depth:${depth} mf:${max_flow} `
           + `mincut:${this.mincut} gt:${mf_gt_mc}`);
    if (mf_gt_mc) {
      G.contractEdge(s, e);
      _trace(`[TRACE-RC] contractEdge depth:${depth} n_after:${G.n()} `
             + `m_after:${G.number_of_edges()}`);
      return this._recursiveCactus(G, depth + 1);
    }
    const eq_2 = G.number_of_nodes() === 2 ? 1 : 0;
    _trace(`[TRACE-RC] n2_branch depth:${depth} n:${G.n()} eq2:${eq_2}`);
    if (eq_2) return G;

    const sccRes = NS.strong_components(G, this.problem_id);
    let v = sccRes.comp_num;
    const num_comp = sccRes.comp_count;
    const blocksizes = sccRes.blocksizes;
    const deg_s = G.getWeightedNodeDegree(s);
    const deg_t = G.getWeightedNodeDegree(tgt);
    const nc_eq_2 = num_comp === 2 ? 1 : 0;
    const deg_s_eq_mc = deg_s === this.mincut ? 1 : 0;
    const deg_t_eq_mc = deg_t === this.mincut ? 1 : 0;
    const sc_branch = nc_eq_2 && (deg_s_eq_mc || deg_t_eq_mc) ? 1 : 0;
    _trace(`[TRACE-RC] singleton_branch depth:${depth} num_comp:${num_comp} `
           + `nc_eq_2:${nc_eq_2} deg_s:${deg_s} deg_t:${deg_t} `
           + `mc:${this.mincut} deg_s_eq_mc:${deg_s_eq_mc} `
           + `deg_t_eq_mc:${deg_t_eq_mc} take:${sc_branch}`);

    if (sc_branch) {
      const ctr = deg_s_eq_mc ? s : tgt;
      const other = ctr === s ? tgt : s;
      const elementsInCtr = G.containedVertices(ctr).slice();
      const elementsInOther = G.containedVertices(other).slice();
      _trace(`[TRACE-RC] singleton ctr:${ctr} other:${other} `
             + `elemCtr_n:${elementsInCtr.length} `
             + `elemOther_n:${elementsInOther.length} `
             + `elemCtr:[${elementsInCtr.join(",")}] `
             + `elemOther:[${elementsInOther.join(",")}]`);
      G.contractEdge(s, e);
      _trace(`[TRACE-RC] singleton after_contract n:${G.n()} `
             + `m:${G.number_of_edges()}`);
      const contracted_v = G.getCurrentPosition(elementsInCtr[0]);
      G.setContainedVertices(contracted_v, elementsInOther);
      _trace(`[TRACE-RC] singleton contracted_v:${contracted_v} `
             + `setContained_n:${elementsInOther.length}`);
      let set_pos_idx = 0;
      for (const n of elementsInOther) {
        G.setCurrentPosition(n, contracted_v);
        _trace(`[TRACE-RC] singleton setCurrPos idx:${set_pos_idx++} `
               + `n:${n} pos:${contracted_v}`);
      }
      const ret = this._recursiveCactus(G, depth + 1);
      const other_now = ret.getCurrentPosition(elementsInOther[0]);
      const new_node = ret.new_empty_node();
      _trace(`[TRACE-RC] singleton other_now:${other_now} `
             + `new_node:${new_node} ret_n:${ret.n()} `
             + `ret_m:${ret.number_of_edges()}`);
      ret.new_edge(other_now, new_node, this.mincut);
      ret.setContainedVertices(new_node, elementsInCtr);
      let set_pos2_idx = 0;
      for (const n of elementsInCtr) {
        ret.setCurrentPosition(n, new_node);
        _trace(`[TRACE-RC] singleton ctr_setCurrPos idx:${set_pos2_idx++} `
               + `n:${n} pos:${new_node}`);
      }
      return ret;
    }

    let STCactus = this._findSTCactus(v, G, s, num_comp);
    const g_n = G.n();
    _trace(`[TRACE-RC] block_iter_init depth:${depth} num_comp:${num_comp} `
           + `g_n:${g_n.toFixed(6)} g_n_half:${(g_n / 2).toFixed(6)}`);
    for (let c = 0; c < num_comp; c++) {
      const bs_d = blocksizes[c];
      const small = bs_d <= g_n / 2 ? 1 : 0;
      _trace(`[TRACE-RC] block_iter_small depth:${depth} c:${c} `
             + `blocksize:${blocksizes[c]} bs_d:${bs_d.toFixed(6)} `
             + `le_half:${small}`);
      if (small) {
        STCactus = this._mergeCactusWithComponent(STCactus, G, depth, c, v,
                                                  blocksizes[c]);
      }
    }
    for (let c = 0; c < num_comp; c++) {
      const bs_d = blocksizes[c];
      const big = bs_d > g_n / 2 ? 1 : 0;
      _trace(`[TRACE-RC] block_iter_big depth:${depth} c:${c} `
             + `blocksize:${blocksizes[c]} bs_d:${bs_d.toFixed(6)} `
             + `gt_half:${big}`);
      if (big) {
        STCactus = this._mergeCactusWithComponent(STCactus, G, depth, c, v,
                                                  blocksizes[c]);
      }
    }
    return STCactus;
  };

  RecursiveCactus.prototype._mergeCactusWithComponent = function (
    STCactus, G, depth, component, scc_result, blocksize) {
    // [TRACE-RC-MC] mirror canonical recursive_cactus.h:228-356.
    const g_n_half = G.n() / 2;
    const bs_le_half = blocksize <= g_n_half ? 1 : 0;
    _trace(`[TRACE-RC-MC] enter depth:${depth} component:${component} `
           + `blocksize:${blocksize} STCactus_n:${STCactus.n()} `
           + `G_n:${G.n()} g_n_half:${g_n_half.toFixed(6)} `
           + `bs_le_half:${bs_le_half}`);
    let uncontracted_base_vertex = UNDEFINED_NODE;
    let contracted_base_vertex = UNDEFINED_NODE;
    let graph;
    if (bs_le_half) {
      _trace(`[TRACE-RC-MC] arm:small depth:${depth} blocksize:${blocksize} `
             + `G_n:${G.n()}`);
      graph = new NS.MutableGraph();
      graph.start_construction(blocksize + 1);
      graph.last_node = 0;
      graph.setOriginalNodes(G.getOriginalNodes());
      graph.new_empty_node();
      for (let n = 0; n < graph.number_of_nodes(); n++) {
        graph.setContainedVertices(n, []);
      }
      const contained = [];
      let vtx = 0;
      for (let n = 0; n < G.number_of_nodes(); n++) {
        if (scc_result[n] === component) {
          graph.new_empty_node();
          contained.push(vtx++);
          const first_un = (uncontracted_base_vertex === UNDEFINED_NODE
                            && G.containedVertices(n).length > 0) ? 1 : 0;
          if (first_un) {
            uncontracted_base_vertex = G.containedVertices(n)[0];
          }
          _trace(`[TRACE-RC-MC-N] n:${n} arm:eq_comp `
                 + `slot:${contained[contained.length - 1]} `
                 + `first_un:${first_un} ubv:${uncontracted_base_vertex}`);
          for (const con of G.containedVertices(n)) {
            graph.addContainedVertex(contained[contained.length - 1], con);
            graph.setCurrentPosition(con, contained[contained.length - 1]);
          }
        } else {
          contained.push(blocksize);
          const first_ct = (contracted_base_vertex === UNDEFINED_NODE
                            && G.containedVertices(n).length > 0) ? 1 : 0;
          if (first_ct) {
            contracted_base_vertex = G.containedVertices(n)[0];
          }
          _trace(`[TRACE-RC-MC-N] n:${n} arm:neq_comp slot:${blocksize} `
                 + `first_ct:${first_ct} cbv:${contracted_base_vertex}`);
          for (const con of G.containedVertices(n)) {
            graph.addContainedVertex(blocksize, con);
            graph.setCurrentPosition(con, blocksize);
          }
        }
      }
      for (let n = 0; n < G.number_of_nodes(); n++) {
        if (contained[n] !== blocksize) {
          let to_contracted = 0;
          const ne = G.get_first_invalid_edge(n);
          for (let e = 0; e < ne; e++) {
            const t = G.getEdgeTarget(n, e);
            const wgt = G.getEdgeWeight(n, e);
            const tc_before = to_contracted;
            const t_is_blk = contained[t] === blocksize ? 1 : 0;
            const n_lt_t = contained[n] < contained[t] ? 1 : 0;
            if (t_is_blk) {
              to_contracted += wgt;
              _trace(`[TRACE-RC-MC-E] n:${n} e:${e} t:${t} wgt:${wgt} `
                     + `branch:to_contracted cn:${contained[n]} `
                     + `ct:${contained[t]} tc_before:${tc_before} `
                     + `tc_after:${to_contracted}`);
            } else if (n_lt_t) {
              graph.new_edge(contained[n], contained[t], wgt);
              _trace(`[TRACE-RC-MC-E] n:${n} e:${e} t:${t} wgt:${wgt} `
                     + `branch:new_edge cn:${contained[n]} `
                     + `ct:${contained[t]} tc:${to_contracted}`);
            } else {
              _trace(`[TRACE-RC-MC-E] n:${n} e:${e} t:${t} wgt:${wgt} `
                     + `branch:skip cn:${contained[n]} ct:${contained[t]}`);
            }
          }
          const tc_gt_0 = to_contracted > 0 ? 1 : 0;
          if (tc_gt_0) {
            graph.new_edge(contained[n], blocksize, to_contracted);
          }
          _trace(`[TRACE-RC-MC-N-DONE] n:${n} tc:${to_contracted} `
                 + `emit_to_blk:${tc_gt_0}`);
        }
      }
      graph.finish_construction();
      _trace(`[TRACE-RC-MC] small_after_build n:${graph.n()} `
             + `m:${graph.number_of_edges()}`);
    } else {
      _trace(`[TRACE-RC-MC] arm:big depth:${depth} blocksize:${blocksize} `
             + `G_n:${G.n()}`);
      const all_ctr = new Set();
      for (let i = 0; i < scc_result.length; i++) {
        if (scc_result[i] !== component) {
          all_ctr.add(i);
          const first_ct = (contracted_base_vertex === UNDEFINED_NODE
                            && G.containedVertices(i).length > 0) ? 1 : 0;
          if (first_ct) {
            contracted_base_vertex = G.containedVertices(i)[0];
          }
          _trace(`[TRACE-RC-MC-I] i:${i} arm:neq_comp insert `
                 + `all_ctr_size:${all_ctr.size} `
                 + `first_ct:${first_ct} cbv:${contracted_base_vertex}`);
        } else {
          const first_un = (uncontracted_base_vertex === UNDEFINED_NODE
                            && G.containedVertices(i).length > 0) ? 1 : 0;
          if (first_un) {
            uncontracted_base_vertex = G.containedVertices(i)[0];
          }
          _trace(`[TRACE-RC-MC-I] i:${i} arm:eq_comp skip `
                 + `first_un:${first_un} ubv:${uncontracted_base_vertex}`);
        }
      }
      // [TRACE-RC-MC] all_ctr dump — JS port iterates the Set in id-ASC
      // sorted order to mirror canonical TracerSet std::set iteration
      // under TRACER_MODE.
      const all_ctr_sorted = Array.from(all_ctr).sort((a, b) => a - b);
      _trace(`[TRACE-RC-MC] all_ctr_dump size:${all_ctr.size} `
             + `members:[${all_ctr_sorted.join(",")}] `
             + `G_n_before:${G.n()} G_m_before:${G.number_of_edges()}`);
      graph = G;
      graph.contractVertexSet(all_ctr);
      _trace(`[TRACE-RC-MC] after_contractVertexSet n:${graph.n()} `
             + `m:${graph.number_of_edges()}`);
    }
    _trace(`[TRACE-RC-MC] before_recurse depth:${depth} graph_n:${graph.n()} `
           + `m:${graph.number_of_edges()} ubv:${uncontracted_base_vertex} `
           + `cbv:${contracted_base_vertex}`);
    const n_i = this._recursiveCactus(graph, depth + 1);
    const merge_vtx_in_cactus = STCactus.getCurrentPosition(uncontracted_base_vertex);
    const nibar = n_i.getCurrentPosition(contracted_base_vertex);
    _trace(`[TRACE-RC-MC] merge_args depth:${depth} STCactus_n:${STCactus.n()} `
           + `n_i_n:${n_i.n()} merge_vtx:${merge_vtx_in_cactus} `
           + `nibar:${nibar} mincut:${this.mincut}`);
    STCactus = NS.graph_modification.mergeGraphs(STCactus, merge_vtx_in_cactus,
                                                 n_i, nibar, this.mincut);
    _trace(`[TRACE-RC-MC] after_merge STCactus_n:${STCactus.n()} `
           + `STCactus_m:${STCactus.number_of_edges()}`);
    return STCactus;
  };

  RecursiveCactus.prototype._findSTCactus = function (v, G, s, num_comp) {
    const contract = new NS.MutableGraph();
    contract.start_construction(num_comp);
    contract.last_node = 0;
    const contained = G.containedVertices(s)[0];
    contract.setOriginalNodes(G.getOriginalNodes());
    for (let n = 0; n < num_comp; n++) {
      contract.new_node();
      contract.setContainedVertices(n, []);
    }
    for (let n = 0; n < G.getOriginalNodes(); n++) {
      const pos = G.getCurrentPosition(n);
      if (pos < G.n()) {
        const n_in_contract = v[G.getCurrentPosition(n)];
        contract.addContainedVertex(n_in_contract, n);
        contract.setCurrentPosition(n, n_in_contract);
      }
    }
    for (let n = 0; n < contract.number_of_nodes(); n++) {
      for (let m = 0; m < contract.number_of_nodes(); m++) {
        if (n < m) contract.new_edge(n, m, 0);
      }
    }
    // [TRACE-STC-Q] quotient-edge accumulator (recursive_cactus.h:392-403).
    // Mirror canonical composite-arithmetic chain: e_ctr index + wgt_ctr
    // accumulator. Emit BEFORE+AFTER per byte-equal-tracer "Extensive
    // printout" discipline.
    for (let n = 0; n < G.number_of_nodes(); n++) {
      const ne = G.get_first_invalid_edge(n);
      for (let e = 0; e < ne; e++) {
        const t = G.getEdgeTarget(n, e);
        const wgt = G.getEdgeWeight(n, e);
        const ctr = v[t];
        const v_n = v[n];
        const gate = v_n > ctr;
        if (gate) {
          const ctr_gt_vn = ctr > v_n ? 1 : 0;
          const e_ctr = ctr - ctr_gt_vn;
          const wgt_ctr_before = contract.getEdgeWeight(v_n, e_ctr);
          const wgt_ctr = wgt + wgt_ctr_before;
          contract.setEdgeWeight(v_n, e_ctr, wgt_ctr);
          _trace(`[TRACE-STC-Q] n:${n} e:${e} t:${t} wgt:${wgt} `
                 + `v_n:${v_n} ctr:${ctr} gate:1 ctr_gt_vn:${ctr_gt_vn} `
                 + `e_ctr:${e_ctr} wgt_ctr_before:${wgt_ctr_before} `
                 + `wgt_ctr_after:${wgt_ctr}`);
        } else {
          _trace(`[TRACE-STC-Q] n:${n} e:${e} t:${t} wgt:${wgt} `
                 + `v_n:${v_n} ctr:${ctr} gate:0`);
        }
      }
    }
    contract.finish_construction();
    const stcactus = new NS.MutableGraph();
    const num_vertices = contract.n();
    stcactus.start_construction(num_vertices);
    stcactus.last_node = 0;
    stcactus.resizePositions(contract.getOriginalNodes());
    s = contract.getCurrentPosition(contained);
    const pq = new NS.NodeBucketPQ(num_vertices, this.mincut + 1);
    for (let n = 0; n < num_vertices; n++) {
      stcactus.new_node();
      if (n !== s) pq.insert(n, 0);
    }
    const ne_s = contract.get_first_invalid_edge(s);
    for (let e = 0; e < ne_s; e++) {
      const tgt = contract.getEdgeTarget(s, e);
      pq.increaseKey(tgt, contract.getEdgeWeight(s, e));
    }
    const node_mapping = new Array(contract.number_of_nodes()).fill(0);
    const rev_node_mapping = new Array(contract.number_of_nodes()).fill(0);
    stcactus.setContainedVertices(0, contract.containedVertices(s));
    node_mapping[s] = 0;
    for (const vv of stcactus.containedVertices(0)) {
      stcactus.setCurrentPosition(vv, 0);
    }
    for (let n = 1; n < num_vertices; n++) {
      const next = pq.deleteMax();
      const ne_next = contract.get_first_invalid_edge(next);
      for (let e = 0; e < ne_next; e++) {
        const tgt = contract.getEdgeTarget(next, e);
        const wgt = pq.getKey(tgt);
        if (pq.contains(tgt)) {
          const new_wgt = wgt + contract.getEdgeWeight(next, e);
          pq.increaseKey(tgt, Math.min(new_wgt, this.mincut));
        }
      }
      node_mapping[next] = n;
      rev_node_mapping[n] = next;
      stcactus.setContainedVertices(n, contract.containedVertices(next));
      for (const vv of stcactus.containedVertices(n)) {
        stcactus.setCurrentPosition(vv, n);
      }
    }
    stcactus.finish_construction();

    const A = [], B = [], order = [];
    let i = 1;
    B.push(0);
    order.push(false);
    // [TRACE-STC-SEG] cycle segmentation loop (recursive_cactus.h:455-477).
    while (i < contract.number_of_nodes() - 1) {
      let cycle_degree = 0;
      const curr_cycle = new Set();
      let nLocal = rev_node_mapping[i];
      let outer_step = 0;
      while ((cycle_degree === 0 || cycle_degree === this.mincut)
             && (i + 1 < contract.number_of_nodes())) {
        nLocal = rev_node_mapping[i];
        _trace(`[TRACE-STC-SEG] outer_i:${i} outer_step:${outer_step} `
               + `n:${nLocal} cycle_degree_before:${cycle_degree} `
               + `curr_cycle_size:${curr_cycle.size}`);
        const ne_n = contract.get_first_invalid_edge(nLocal);
        for (let e = 0; e < ne_n; e++) {
          const tgt = contract.getEdgeTarget(nLocal, e);
          const wgt = contract.getEdgeWeight(nLocal, e);
          const in_cycle = curr_cycle.has(tgt) ? 1 : 0;
          const cd_before = cycle_degree;
          if (in_cycle) cycle_degree -= wgt;
          else cycle_degree += wgt;
          _trace(`[TRACE-STC-SEG-E] outer_i:${i} n:${nLocal} e:${e} `
                 + `tgt:${tgt} wgt:${wgt} in_cycle:${in_cycle} `
                 + `cd_before:${cd_before} cd_after:${cycle_degree}`);
        }
        const eq_mc = cycle_degree === this.mincut ? 1 : 0;
        if (eq_mc) {
          i++;
          curr_cycle.add(nLocal);
        }
        _trace(`[TRACE-STC-SEG] outer_step:${outer_step} n:${nLocal} `
               + `cd_after_loop:${cycle_degree} eq_mc:${eq_mc} `
               + `i_after:${i} curr_cycle_size_after:${curr_cycle.size}`);
        outer_step++;
      }
      if (curr_cycle.size > 0) {
        A.push([]);
        order.push(true);
        _trace(`[TRACE-STC-SEG] commit_cycle A_idx:${A.length - 1} `
               + `B_idx:${B.length} size:${curr_cycle.size} `
               + `vstart:${i - curr_cycle.size} vend:${i}`);
        for (let vIdx = i - curr_cycle.size; vIdx < i; vIdx++) {
          A[A.length - 1].push(vIdx);
        }
      } else {
        i++;
        B.push(node_mapping[nLocal]);
        order.push(false);
        _trace(`[TRACE-STC-SEG] commit_tree A_idx:${A.length} `
               + `B_idx:${B.length - 1} node_mapping:${node_mapping[nLocal]} `
               + `i_after:${i}`);
      }
    }
    order.push(false);
    B.push(num_vertices - 1);
    let previous = 0;
    let a_index = 0, b_index = 0;
    // [TRACE-STC-OUT] output cactus edge emission (recursive_cactus.h:495-530).
    for (let idx = 0; idx < (A.length + B.length - 1); idx++) {
      const order_i = order[idx];
      const order_next = (idx + 1 < order.length)
        ? (order[idx + 1] ? 1 : 0) : 0;
      _trace(`[TRACE-STC-OUT] i:${idx} order_i:${order_i ? 1 : 0} `
             + `order_next:${order_next} previous:${previous} `
             + `a_index:${a_index} b_index:${b_index} `
             + `A_size:${A.length} B_size:${B.length}`);
      if (order_i) {
        const A_n = A[a_index].length;
        for (let j = 0; j < A_n; j++) {
          if (j > 0) {
            _trace(`[TRACE-STC-OUT-E] i:${idx} j:${j} kind:within `
                   + `u:${A[a_index][j - 1]} v:${A[a_index][j]} `
                   + `w:${Math.floor(this.mincut / 2)}`);
            stcactus.new_edge_order(A[a_index][j - 1], A[a_index][j],
                                    this.mincut / 2);
          } else {
            _trace(`[TRACE-STC-OUT-E] i:${idx} j:${j} kind:from_prev `
                   + `u:${previous} v:${A[a_index][0]} `
                   + `w:${Math.floor(this.mincut / 2)}`);
            stcactus.new_edge_order(previous, A[a_index][0], this.mincut / 2);
          }
          if (j === A_n - 1) {
            let next;
            const next_is_cycle = (order[idx + 1] === true) ? 1 : 0;
            if (next_is_cycle) next = stcactus.new_empty_node();
            else next = B[b_index];
            _trace(`[TRACE-STC-OUT-E] i:${idx} j:${j} kind:to_next `
                   + `u:${A[a_index][j]} v:${next} `
                   + `w:${Math.floor(this.mincut / 2)} `
                   + `next_is_cycle:${next_is_cycle} `
                   + `previous_before:${previous}`);
            stcactus.new_edge_order(A[a_index][j], next, this.mincut / 2);
            _trace(`[TRACE-STC-OUT-E] i:${idx} j:${j} kind:prev_to_next `
                   + `u:${previous} v:${next} `
                   + `w:${Math.floor(this.mincut / 2)}`);
            stcactus.new_edge_order(previous, next, this.mincut / 2);
            previous = next;
          }
        }
        a_index++;
        _trace(`[TRACE-STC-OUT] i:${idx} kind:cycle_done `
               + `a_index_after:${a_index} previous_after:${previous}`);
      } else {
        if (!order[idx + 1]) {
          _trace(`[TRACE-STC-OUT-E] i:${idx} kind:tree `
                 + `u:${B[b_index]} v:${B[b_index + 1]} w:${this.mincut}`);
          stcactus.new_edge_order(B[b_index], B[b_index + 1], this.mincut);
        }
        previous = B[b_index];
        b_index++;
        _trace(`[TRACE-STC-OUT] i:${idx} kind:tree_done `
               + `b_index_after:${b_index} previous_after:${previous}`);
      }
    }
    stcactus.finish_construction();
    return stcactus;
  };

  RecursiveCactus.prototype._maximumWeightedFlowEdge = function (G) {
    // [TRACE-RC-WFE] mirror canonical recursive_cactus.h:547-579.
    let max_degree = 0, s = UNDEFINED_NODE;
    for (let n = 0; n < G.number_of_nodes(); n++) {
      const d = G.getWeightedNodeDegree(n);
      const empty = G.isEmpty(n) ? 1 : 0;
      const gt = (d > max_degree && !empty) ? 1 : 0;
      if (gt) { max_degree = d; s = n; }
      _trace(`[TRACE-RC-WFE] maxWFE n:${n} wdeg:${d} `
             + `max_before:${max_degree} empty:${empty} gt:${gt} s:${s}`);
    }
    let t = UNDEFINED_NODE, e = UNDEFINED_EDGE, max_ngbr = 0;
    const ne = G.get_first_invalid_edge(s);
    for (let edge = 0; edge < ne; edge++) {
      const ngbr = G.getEdgeTarget(s, edge);
      const d = G.getWeightedNodeDegree(ngbr);
      const empty = G.isEmpty(ngbr) ? 1 : 0;
      const gt = (d > max_ngbr && !empty) ? 1 : 0;
      if (gt) { max_ngbr = d; t = ngbr; e = edge; }
      _trace(`[TRACE-RC-WFE] maxWFE_ngbr s:${s} edge:${edge} ngbr:${ngbr} `
             + `wdeg:${d} max_before:${max_ngbr} empty:${empty} `
             + `gt:${gt} t:${t} e:${e}`);
    }
    if (t === UNDEFINED_NODE) return this._findFlowEdge(G);
    return [s, e, t];
  };

  RecursiveCactus.prototype._findFlowEdge = function (G) {
    let s = NS.random_functions.nextInt(0, G.n() - 1);
    // [UPSTREAM recursive_cactus.h:584-586] cpp draws nextInt(0, max_edge)
    // where max_edge = get_first_invalid_edge(s) - 1; the value is discarded
    // by the inner `e = 0` assignment but the RNG draw matters for stream
    // parity per audit row B. Mirror the discard.
    const max_edge = G.get_first_invalid_edge(s) - 1;
    let e = NS.random_functions.nextInt(0, max_edge);
    _trace(`[TRACE-RC-FFE] entry s:${s} max_edge:${max_edge} e:${e} `
           + `G_n:${G.n()}`);
    let edge_found = false;
    let step = 0;
    while (!edge_found) {
      while (G.isEmpty(s)) {
        _trace(`[TRACE-RC-FFE] step:${step} skip_empty_s s:${s}`);
        s = (s + 1) % G.n();
      }
      e = 0;
      while (e < G.get_first_invalid_edge(s)
             && G.isEmpty(G.getEdgeTarget(s, e))) e++;
      const fie_ok = e < G.get_first_invalid_edge(s) ? 1 : 0;
      _trace(`[TRACE-RC-FFE] step:${step} s:${s} e:${e} `
             + `fie:${G.get_first_invalid_edge(s)} found:${fie_ok}`);
      if (fie_ok) edge_found = true;
      else s = (s + 1) % G.n();
      step++;
    }
    const tgt = G.getEdgeTarget(s, e);
    _trace(`[TRACE-RC-FFE] exit s:${s} e:${e} tgt:${tgt}`);
    return [s, e, tgt];
  };

  NS.RecursiveCactus = RecursiveCactus;
})();
