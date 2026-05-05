/* graph_modification: mergeGraphs + canonizeCactus + isCNCR.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/graph_modification.h]
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function mergeGraphs(G1, v1, G2, v2, mincut) {
    const v1_n = G1.number_of_nodes();
    if (G2.number_of_nodes() === 1) return G1;
    if (G1.number_of_nodes() === 1) return G2;

    G1.setContainedVertices(v1, []);
    for (let i = 0; i < G2.number_of_nodes(); i++) {
      if (i === v2) {
        for (const c of G2.containedVertices(i)) {
          if (G1.getCurrentPosition(c) === v1) {
            G1.setCurrentPosition(c, v1);
            G1.addContainedVertex(v1, c);
          }
        }
      } else {
        const v = G1.new_empty_node();
        for (const c of G2.containedVertices(i)) {
          G1.setCurrentPosition(c, v);
        }
        G1.setContainedVertices(v, G2.containedVertices(i));
      }
    }
    for (let n = 0; n < G2.number_of_nodes(); n++) {
      let new_id = n + v1_n - (n > v2 ? 1 : 0);
      if (n === v2) new_id = v1;
      const ne = G2.get_first_invalid_edge(n);
      for (let e = 0; e < ne; e++) {
        const t = G2.getEdgeTarget(n, e);
        if (t !== v2) {
          const t_id = t + v1_n - (t > v2 ? 1 : 0);
          G1.new_edge(new_id, t_id, G2.getEdgeWeight(n, e));
        }
      }
    }
    if (G1.isEmpty(v1)) canonizeCactus(G1, v1, mincut);
    return G1;
  }

  function canonizeCactus(cactus, vertex, mincut) {
    let junctions = 0;
    const neighbors_tree = [];
    const neighbors_cycle = [];
    const ne = cactus.get_first_invalid_edge(vertex);
    for (let e = 0; e < ne; e++) {
      const wgt = cactus.getEdgeWeight(vertex, e);
      if (wgt === mincut) {
        neighbors_tree.push([cactus.getEdgeTarget(vertex, e),
                             cactus.getReverseEdge(vertex, e), e]);
      } else {
        neighbors_cycle.push([cactus.getEdgeTarget(vertex, e),
                              cactus.getReverseEdge(vertex, e)]);
      }
      junctions += wgt;
    }
    if (junctions % mincut !== 0) {
      throw new Error("canonizeCactus: not even cycled");
    }
    junctions = Math.floor(junctions / mincut);
    if (junctions === 2 && neighbors_tree.length > 0) {
      const ed = neighbors_tree[0][2];
      cactus.contractEdge(vertex, ed);
      return true;
    }
    if (junctions === 3) {
      const pairs = [];
      while (neighbors_cycle.length > 2) {
        const neighbors = new Map();
        for (let i = 1; i < neighbors_cycle.length; i++) {
          neighbors.set(neighbors_cycle[i][0], i);
        }
        const q = [neighbors_cycle[0][0]];
        let qhead = 0;
        const seen = new Uint8Array(cactus.number_of_nodes());
        seen[vertex] = 1;
        let matched = false;
        while (qhead < q.length && !matched) {
          const n = q[qhead++];
          const ne2 = cactus.get_first_invalid_edge(n);
          for (let e = 0; e < ne2; e++) {
            const tgt = cactus.getEdgeTarget(n, e);
            if (neighbors.has(tgt)) {
              pairs.push([neighbors_cycle[0], neighbors_cycle[neighbors.get(tgt)]]);
              neighbors_cycle.splice(neighbors.get(tgt), 1);
              neighbors_cycle.shift();
              matched = true;
              break;
            }
            if (!seen[tgt]) { q.push(tgt); seen[tgt] = 1; }
          }
        }
      }
      if (neighbors_cycle.length === 2) {
        pairs.push([neighbors_cycle[0], neighbors_cycle[1]]);
      }
      const new_nodes = [];
      for (const p of pairs) {
        new_nodes.push(cactus.new_empty_node());
        cactus.new_edge_order(new_nodes[new_nodes.length - 1],
                              p[0][0], mincut / 2);
        cactus.new_edge_order(new_nodes[new_nodes.length - 1],
                              p[1][0], mincut / 2);
      }
      for (const n of neighbors_tree) new_nodes.push(n[0]);
      cactus.new_edge_order(new_nodes[0], new_nodes[1], mincut / 2);
      cactus.new_edge_order(new_nodes[0], new_nodes[2], mincut / 2);
      cactus.new_edge_order(new_nodes[1], new_nodes[2], mincut / 2);
      cactus.deleteVertex(vertex);
      return true;
    }
    return false;
  }

  function isCNCR(G, mincut) {
    for (let n = 0; n < G.number_of_nodes(); n++) {
      if (G.isEmpty(n)) {
        let deg = 0, num = 0;
        const ne = G.get_first_invalid_edge(n);
        for (let e = 0; e < ne; e++) { deg += G.getEdgeWeight(n, e); num++; }
        if (deg % mincut !== 0) return false;
        const ratio = Math.floor(deg / mincut);
        if (ratio === 3) return false;
        if (ratio === 2 && num < 4) return false;
      }
    }
    return true;
  }

  NS.graph_modification = { mergeGraphs, canonizeCactus, isCNCR };
})();
