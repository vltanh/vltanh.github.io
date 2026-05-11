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
    const he = new NS.HeavyEdges(this.mincut);
    const cactusEdges = he.removeHeavyEdges(G);
    const cycleEdges = he.contractCycleEdges(G);
    G = this._internalRecursiveCactus(G, depth);
    he.reInsertCycles(G, cycleEdges);
    he.reInsertVertices(G, cactusEdges);
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

    const [s, e, tgt] = this._maximumWeightedFlowEdge(G);
    _trace("[TRACE-RC] flow_edge depth:", depth, " s:", s, " e:", e,
           " tgt:", tgt);
    const pr = new NS.PushRelabel();
    this.problem_id++;
    const [max_flow] = pr.solve_max_flow_min_cut(G, [s, tgt], 0, false, 0,
                                                 this.problem_id);
    _trace("[TRACE-RC] max_flow depth:", depth, " val:", max_flow,
           " mincut:", this.mincut);
    if (max_flow > this.mincut) {
      G.contractEdge(s, e);
      return this._recursiveCactus(G, depth + 1);
    }
    if (G.number_of_nodes() === 2) return G;

    const sccRes = NS.strong_components(G, this.problem_id);
    let v = sccRes.comp_num;
    const num_comp = sccRes.comp_count;
    const blocksizes = sccRes.blocksizes;

    if (num_comp === 2
        && (G.getWeightedNodeDegree(s) === this.mincut
            || G.getWeightedNodeDegree(tgt) === this.mincut)) {
      const ctr = G.getWeightedNodeDegree(s) === this.mincut ? s : tgt;
      const other = ctr === s ? tgt : s;
      const elementsInCtr = G.containedVertices(ctr).slice();
      const elementsInOther = G.containedVertices(other).slice();
      G.contractEdge(s, e);
      const contracted_v = G.getCurrentPosition(elementsInCtr[0]);
      G.setContainedVertices(contracted_v, elementsInOther);
      for (const n of elementsInOther) G.setCurrentPosition(n, contracted_v);
      const ret = this._recursiveCactus(G, depth + 1);
      const other_now = ret.getCurrentPosition(elementsInOther[0]);
      const new_node = ret.new_empty_node();
      ret.new_edge(other_now, new_node, this.mincut);
      ret.setContainedVertices(new_node, elementsInCtr);
      for (const n of elementsInCtr) ret.setCurrentPosition(n, new_node);
      return ret;
    }

    let STCactus = this._findSTCactus(v, G, s, num_comp);
    const g_n = G.n();
    for (let c = 0; c < num_comp; c++) {
      if (blocksizes[c] <= g_n / 2) {
        STCactus = this._mergeCactusWithComponent(STCactus, G, depth, c, v,
                                                  blocksizes[c]);
      }
    }
    for (let c = 0; c < num_comp; c++) {
      if (blocksizes[c] > g_n / 2) {
        STCactus = this._mergeCactusWithComponent(STCactus, G, depth, c, v,
                                                  blocksizes[c]);
      }
    }
    return STCactus;
  };

  RecursiveCactus.prototype._mergeCactusWithComponent = function (
    STCactus, G, depth, component, scc_result, blocksize) {
    let uncontracted_base_vertex = UNDEFINED_NODE;
    let contracted_base_vertex = UNDEFINED_NODE;
    let graph;
    if (blocksize <= G.n() / 2) {
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
          if (uncontracted_base_vertex === UNDEFINED_NODE
              && G.containedVertices(n).length > 0) {
            uncontracted_base_vertex = G.containedVertices(n)[0];
          }
          for (const con of G.containedVertices(n)) {
            graph.addContainedVertex(contained[contained.length - 1], con);
            graph.setCurrentPosition(con, contained[contained.length - 1]);
          }
        } else {
          contained.push(blocksize);
          if (contracted_base_vertex === UNDEFINED_NODE
              && G.containedVertices(n).length > 0) {
            contracted_base_vertex = G.containedVertices(n)[0];
          }
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
            if (contained[t] === blocksize) to_contracted += wgt;
            else if (contained[n] < contained[t]) {
              graph.new_edge(contained[n], contained[t], wgt);
            }
          }
          if (to_contracted > 0) {
            graph.new_edge(contained[n], blocksize, to_contracted);
          }
        }
      }
      graph.finish_construction();
    } else {
      const all_ctr = new Set();
      for (let i = 0; i < scc_result.length; i++) {
        if (scc_result[i] !== component) {
          all_ctr.add(i);
          if (contracted_base_vertex === UNDEFINED_NODE
              && G.containedVertices(i).length > 0) {
            contracted_base_vertex = G.containedVertices(i)[0];
          }
        } else {
          if (uncontracted_base_vertex === UNDEFINED_NODE
              && G.containedVertices(i).length > 0) {
            uncontracted_base_vertex = G.containedVertices(i)[0];
          }
        }
      }
      graph = G;
      graph.contractVertexSet(all_ctr);
    }
    const n_i = this._recursiveCactus(graph, depth + 1);
    const merge_vtx_in_cactus = STCactus.getCurrentPosition(uncontracted_base_vertex);
    const nibar = n_i.getCurrentPosition(contracted_base_vertex);
    STCactus = NS.graph_modification.mergeGraphs(STCactus, merge_vtx_in_cactus,
                                                 n_i, nibar, this.mincut);
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
    let max_degree = 0, s = UNDEFINED_NODE;
    for (let n = 0; n < G.number_of_nodes(); n++) {
      if (G.getWeightedNodeDegree(n) > max_degree && !G.isEmpty(n)) {
        max_degree = G.getWeightedNodeDegree(n);
        s = n;
      }
    }
    let t = UNDEFINED_NODE, e = UNDEFINED_EDGE, max_ngbr = 0;
    const ne = G.get_first_invalid_edge(s);
    for (let edge = 0; edge < ne; edge++) {
      const ngbr = G.getEdgeTarget(s, edge);
      if (G.getWeightedNodeDegree(ngbr) > max_ngbr && !G.isEmpty(ngbr)) {
        max_ngbr = G.getWeightedNodeDegree(ngbr);
        t = ngbr;
        e = edge;
      }
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
    let edge_found = false;
    while (!edge_found) {
      while (G.isEmpty(s)) {
        s = (s + 1) % G.n();
      }
      e = 0;
      while (e < G.get_first_invalid_edge(s)
             && G.isEmpty(G.getEdgeTarget(s, e))) e++;
      if (e < G.get_first_invalid_edge(s)) edge_found = true;
      else s = (s + 1) % G.n();
    }
    const tgt = G.getEdgeTarget(s, e);
    return [s, e, tgt];
  };

  NS.RecursiveCactus = RecursiveCactus;
})();
