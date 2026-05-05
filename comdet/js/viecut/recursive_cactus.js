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

  function RecursiveCactus(mincut) {
    this.mincut = mincut;
    this.problem_id = NS.random_functions.next();
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
    const pr = new NS.PushRelabel();
    this.problem_id++;
    const [max_flow] = pr.solve_max_flow_min_cut(G, [s, tgt], 0, false, 0,
                                                 this.problem_id);
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
    for (let n = 0; n < G.number_of_nodes(); n++) {
      const ne = G.get_first_invalid_edge(n);
      for (let e = 0; e < ne; e++) {
        const t = G.getEdgeTarget(n, e);
        const wgt = G.getEdgeWeight(n, e);
        const ctr = v[t];
        if (v[n] > ctr) {
          const e_ctr = ctr - (ctr > v[n] ? 1 : 0);
          const wgt_ctr = wgt + contract.getEdgeWeight(v[n], e_ctr);
          contract.setEdgeWeight(v[n], e_ctr, wgt_ctr);
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
    while (i < contract.number_of_nodes() - 1) {
      let cycle_degree = 0;
      const curr_cycle = new Set();
      let nLocal = rev_node_mapping[i];
      while ((cycle_degree === 0 || cycle_degree === this.mincut)
             && (i + 1 < contract.number_of_nodes())) {
        nLocal = rev_node_mapping[i];
        const ne_n = contract.get_first_invalid_edge(nLocal);
        for (let e = 0; e < ne_n; e++) {
          const tgt = contract.getEdgeTarget(nLocal, e);
          const wgt = contract.getEdgeWeight(nLocal, e);
          if (curr_cycle.has(tgt)) cycle_degree -= wgt;
          else cycle_degree += wgt;
        }
        if (cycle_degree === this.mincut) {
          i++;
          curr_cycle.add(nLocal);
        }
      }
      if (curr_cycle.size > 0) {
        A.push([]);
        order.push(true);
        for (let vIdx = i - curr_cycle.size; vIdx < i; vIdx++) {
          A[A.length - 1].push(vIdx);
        }
      } else {
        i++;
        B.push(node_mapping[nLocal]);
        order.push(false);
      }
    }
    order.push(false);
    B.push(num_vertices - 1);
    let previous = 0;
    let a_index = 0, b_index = 0;
    for (let idx = 0; idx < (A.length + B.length - 1); idx++) {
      if (order[idx]) {
        for (let j = 0; j < A[a_index].length; j++) {
          if (j > 0) {
            stcactus.new_edge_order(A[a_index][j - 1], A[a_index][j],
                                    this.mincut / 2);
          } else {
            stcactus.new_edge_order(previous, A[a_index][0], this.mincut / 2);
          }
          if (j === A[a_index].length - 1) {
            let next;
            if (order[idx + 1] === true) next = stcactus.new_empty_node();
            else next = B[b_index];
            stcactus.new_edge_order(A[a_index][j], next, this.mincut / 2);
            stcactus.new_edge_order(previous, next, this.mincut / 2);
            previous = next;
          }
        }
        a_index++;
      } else {
        if (!order[idx + 1]) {
          stcactus.new_edge_order(B[b_index], B[b_index + 1], this.mincut);
        }
        previous = B[b_index];
        b_index++;
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
    let edge_found = false;
    let e = 0;
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
