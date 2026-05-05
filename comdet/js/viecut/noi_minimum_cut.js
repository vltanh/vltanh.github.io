/* noi_minimum_cut + modified_capforest.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/noi_minimum_cut.h]
 *
 * Capforest contraction repeatedly applies modified_capforest +
 * fromUnionFind until n <= 2 or mincut == 0. PQ choice mirrors VieCut's
 * default: bucket queue (we use NodeBucketPQ; canonical may pick
 * fifo_node_bucket_pq for default. Both correct, may differ on tie
 * order; flagged as a possible byte-equal divergence.)
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function modified_capforest(G, mincut) {
    const n = G.number_of_nodes();
    const uf = new NS.UnionFind(n);
    const span = Math.max(1, mincut + 1);
    const pq = new NS.NodeBucketPQ(n, span);
    const visited = new Uint8Array(n);
    const seen = new Uint8Array(n);
    const r_v = new Array(n).fill(0);

    const starting_node = NS.random_functions.next() % n;
    let current_node = starting_node;
    pq.insert(current_node, 0);

    while (!pq.empty()) {
      current_node = pq.deleteMax();
      visited[current_node] = 1;
      const ne = G.get_first_invalid_edge(current_node);
      for (let e = 0; e < ne; e++) {
        const tgt = G.getEdgeTarget(current_node, e);
        if (visited[tgt]) continue;
        const w = G.getEdgeWeight(current_node, e);
        let increase = false;
        if (r_v[tgt] < mincut || mincut === 0) {
          increase = true;
          if ((r_v[tgt] + w) >= mincut) {
            uf.Union(current_node, tgt);
          }
        }
        r_v[tgt] += w;
        const new_rv = Math.min(r_v[tgt], mincut);
        if (seen[tgt]) {
          if (increase && !visited[tgt]) pq.increaseKey(tgt, new_rv);
        } else {
          seen[tgt] = 1;
          pq.insert(tgt, new_rv);
        }
      }
    }
    return uf;
  }

  function perform_minimum_cut_noi(G, indirect) {
    if (!G) return -1;
    const graphs = [G];
    let mincut = G.getMinDegree();
    NS.minimum_cut_helpers.setInitialCutValues(graphs);
    while (graphs[graphs.length - 1].number_of_nodes() > 2 && mincut > 0) {
      const uf = modified_capforest(graphs[graphs.length - 1], mincut);
      graphs.push(NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf, true));
      mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
    }
    if (!indirect) NS.minimum_cut_helpers.retrieveMinimumCut(graphs);
    return mincut;
  }

  NS.noi_minimum_cut = {
    perform_minimum_cut: perform_minimum_cut_noi,
    modified_capforest,
  };
})();
