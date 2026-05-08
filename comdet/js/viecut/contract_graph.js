/* contraction::fromUnionFind + contractGraphSparse + contractGraphVertexset.
 *
 * [UPSTREAM VieCut/lib/coarsening/contract_graph.h]
 *
 * fromUnionFind: build mapping from uf->Find(n); call contractGraph.
 * contractGraph: pick sparse vs vertexset based on density.
 * contractGraphSparse: rebuild new mutable_graph; per-cluster collect
 * cross-cluster edge weights via unordered_set + emit new edges.
 *
 * `save_cut` config controls whether mapping is also stored in the
 * source graph's partition_index. We default true (the cactus pipeline
 * always wants partition_index to track contractions for retrieve).
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_NODE = 0xffffffff;

  function fromUnionFind(G, uf, copy) {
    if (copy === undefined) copy = false;
    if (uf.n() === G.n() && !copy) return G;

    const reverse_mapping = [];
    for (let i = 0; i < uf.n(); i++) reverse_mapping.push([]);
    const part = new Array(G.number_of_nodes()).fill(UNDEFINED_NODE);
    const mapping = new Array(G.n()).fill(UNDEFINED_NODE);
    let current_pid = 0;
    for (let n = 0; n < G.number_of_nodes(); n++) {
      const part_id = uf.Find(n);
      if (part[part_id] === UNDEFINED_NODE) part[part_id] = current_pid++;
      mapping[n] = part[part_id];
      G.setPartitionIndex(n, part[part_id]);
      const cv = G.containedVertices(n);
      reverse_mapping[part[part_id]].push(cv[0]);
    }
    return contractGraph(G, mapping, reverse_mapping, copy);
  }

  function contractGraph(G, mapping, reverse_mapping, copy) {
    const cn = reverse_mapping.length;
    if (cn * 2 > G.n() || !copy) {
      return contractGraphVertexset(G, mapping, reverse_mapping, copy);
    }
    return contractGraphSparse(G, mapping, reverse_mapping);
  }

  function contractGraphVertexset(G, mapping, reverse_mapping, copy) {
    let H;
    if (copy) {
      H = cloneGraph(G);
    } else {
      H = G;
    }
    for (let i = 0; i < reverse_mapping.length; i++) {
      if (reverse_mapping[i].length > 1) {
        // [UPSTREAM contract_graph.h:187 vtx_to_ctr std::unordered_set]
        // Mirrors cpp TRACER_MODE swap to std::set: id-ASC iteration so
        // contractVertexSet's vec walk + downstream edge-merge order
        // matches cpp byte-for-byte.
        const positions = [];
        for (const v of reverse_mapping[i]) {
          positions.push(H.getCurrentPosition(v));
        }
        positions.sort((a, b) => a - b);
        const set = new Set(positions);
        H.contractVertexSet(set);
      }
    }
    if (copy) {
      for (let i = 0; i < reverse_mapping.length; i++) {
        for (const v of reverse_mapping[i]) {
          G.setPartitionIndex(v, H.getCurrentPosition(v));
        }
      }
      H.resetContainedvertices();
    }
    return H;
  }

  function contractGraphSparse(G, mapping, reverse_mapping) {
    const weights = new Array(reverse_mapping.length).fill(0);
    const contracted = new NS.MutableGraph();
    contracted.start_construction(reverse_mapping.length);
    contracted.last_node = 0;
    for (let p = 0; p < reverse_mapping.length; p++) {
      const edge_positions = new Set();
      contracted.new_node();
      for (let node = 0; node < reverse_mapping[p].length; node++) {
        const n = reverse_mapping[p][node];
        const ne = G.get_first_invalid_edge(n);
        for (let e = 0; e < ne; e++) {
          if (G.getEdgeWeight(n, e) === 0) continue;
          const tgt = G.getEdgeTarget(n, e);
          const wgt = G.getEdgeWeight(n, e);
          const contracted_target = mapping[tgt];
          // mutable_graph branch: skip when contracted_target <= p (avoid
          // double-add of undirected edge)
          if (contracted_target <= p) continue;
          if (edge_positions.has(contracted_target)) {
            weights[contracted_target] += wgt;
          } else {
            edge_positions.add(contracted_target);
            weights[contracted_target] = wgt;
          }
        }
      }
      // [UPSTREAM contract_graph.h:258 edge_positions std::unordered_set]
      // Mirrors cpp TRACER_MODE swap to std::set: id-ASC iteration so
      // contracted's adjacency order matches cpp byte-for-byte.
      const sorted_positions = [...edge_positions].sort((a, b) => a - b);
      for (const tgt of sorted_positions) {
        contracted.new_edge(p, tgt, weights[tgt]);
      }
    }
    contracted.finish_construction();
    return contracted;
  }

  function cloneGraph(G) {
    const H = new NS.MutableGraph();
    H.partition_index = G.partition_index.slice();
    H.vertices = G.vertices.map((row) => row.map((e) => ({ ...e })));
    H.weighted_degree = G.weighted_degree.slice();
    H.node_in_cut = G.node_in_cut.slice();
    H.current_position = G.current_position.slice();
    H.contained_in_this = G.contained_in_this.map((arr) => arr.slice());
    H.last_node = G.last_node;
    H.num_edges = G.num_edges;
    H.partition_count = G.partition_count;
    H.original_nodes = G.original_nodes;
    return H;
  }

  NS.contraction = {
    fromUnionFind, contractGraph, contractGraphSparse, contractGraphVertexset,
    cloneGraph,
  };
})();
