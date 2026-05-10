/* minimum_cut_helpers: setInitialCutValues + updateCut + retrieveMinimumCut +
 * setVertexLocations.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/minimum_cut_helpers.h]
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function minimumIndex(G) {
    const mindeg = G.getMinDegree();
    for (let n = 0; n < G.number_of_nodes(); n++) {
      if (G.getWeightedNodeDegree(n) === mindeg) return n;
    }
    return 0;
  }

  function setInitialCutValues(graphs) {
    const G0 = graphs[0];
    const Glast = graphs[graphs.length - 1];
    const mi = minimumIndex(Glast);
    for (let idx = 0; idx < G0.number_of_nodes(); idx++) {
      G0.setNodeInCut(idx, idx === mi);
    }
  }

  function updateCut(graphs, previous_mincut) {
    const new_graph = graphs[graphs.length - 1];
    if (new_graph.number_of_nodes() > 1) {
      if (new_graph.getMinDegree() < previous_mincut) {
        const mi = minimumIndex(new_graph);
        const G0 = graphs[0];
        for (let idx = 0; idx < G0.number_of_nodes(); idx++) {
          let coarseID = idx;
          for (let lv = 0; lv < graphs.length - 1; lv++) {
            coarseID = graphs[lv].getPartitionIndex(coarseID);
          }
          G0.setNodeInCut(idx, coarseID === mi);
        }
      }
      return Math.min(previous_mincut, new_graph.getMinDegree());
    }
    return previous_mincut;
  }

  function retrieveMinimumCut(graphs) {
    const G = graphs[0];
    for (let n = 0; n < G.number_of_nodes(); n++) {
      G.setPartitionIndex(n, G.getNodeInCut(n) ? 0 : 1);
    }
  }

  function setVertexLocations(out_graph, graphs, ge_ids, g_edges, mincut) {
    out_graph.setOriginalNodes(graphs[0].number_of_nodes());
    for (let n = 0; n < out_graph.number_of_nodes(); n++) {
      out_graph.setContainedVertices(n, []);
    }
    for (let n = 0; n < graphs[graphs.length - 1].number_of_nodes(); n++) {
      graphs[graphs.length - 1].setPartitionIndex(
        n, out_graph.getCurrentPosition(n));
    }
    let g_id = ge_ids.length - 1;
    for (let i = graphs.length; i-- > 0 && graphs.length > 1; ) {
      if (i < graphs.length - 1) {
        for (let n = 0; n < graphs[i].number_of_nodes(); n++) {
          const index = graphs[i].getPartitionIndex(n);
          const id_new = graphs[i + 1].getPartitionIndex(index);
          graphs[i].setPartitionIndex(n, id_new);
        }
      }
      if (g_id !== -1 && i === ge_ids[g_id]) {
        for (const e of g_edges[g_id]) {
          const new_node = out_graph.new_empty_node();
          const neighbour = graphs[i].getPartitionIndex(e[1]);
          out_graph.new_edge_order(new_node, neighbour, mincut);
          graphs[i].setPartitionIndex(e[0], new_node);
        }
        g_id--;
      }
    }
    for (let n = 0; n < graphs[0].number_of_nodes(); n++) {
      const position = graphs[0].getPartitionIndex(n);
      out_graph.setCurrentPosition(n, position);
      out_graph.addContainedVertex(position, n);
    }
  }

  // [UPSTREAM minimum_cut_helpers.h:118-148] remap_cluster.
  // Compactify cluster_id labels into [0..k) by encounter order:
  //   for n in G.nodes(): if part[cluster_id[n]] is UNDEFINED then assign
  //   the next compact id; mapping[n] = part[cluster_id[n]];
  //   reverse_mapping[mapping[n]].push(n).
  // Mirrors cpp's std::unordered_map<PartitionID,PartitionID> remap with
  // a flat `part` vector keyed by raw cluster id (size = n, because
  // cluster_ids are in [0, n)). Encounter-order is node-id ASC since
  // upstream iterates `G->nodes()`; JS mirrors via `for n in [0..n)`.
  function remap_cluster(G, cluster_id) {
    const n = G.number_of_nodes();
    const mapping = new Array(n);
    const reverse_mapping = [];
    const UNDEFINED_NODE = 0xffffffff;
    const part = new Array(n).fill(UNDEFINED_NODE);
    let cur_no_clusters = 0;
    for (let node = 0; node < n; node++) {
      const cur_cluster = cluster_id[node];
      if (part[cur_cluster] === UNDEFINED_NODE) {
        part[cur_cluster] = cur_no_clusters++;
        reverse_mapping.push([]);
      }
      mapping[node] = part[cur_cluster];
      G.setPartitionIndex(node, part[cur_cluster]);
      reverse_mapping[part[cur_cluster]].push(node);
    }
    return { mapping, reverse_mapping };
  }

  NS.minimum_cut_helpers = {
    setInitialCutValues, updateCut, retrieveMinimumCut, setVertexLocations,
    minimumIndex, remap_cluster,
  };
})();
