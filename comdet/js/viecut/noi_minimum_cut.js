/* noi_minimum_cut + modified_capforest.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/noi_minimum_cut.h]
 *
 * Capforest contraction repeatedly applies modified_capforest +
 * fromUnionFind until n <= 2 or mincut == 0. PQ choice mirrors VieCut's
 * "default" config: fifo_node_bucket_pq (FIFO bucket pop), matching
 * canonical noi_minimum_cut.h:95-100 selectPq() for n*mincut not
 * exceeding the heap-switch threshold.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function emit(event, payload) {
    const h = (typeof globalThis !== "undefined") && globalThis.__VIECUT_HOOK;
    if (typeof h === "function") h(event, payload);
  }

  function modified_capforest(G, mincut) {
    const n = G.number_of_nodes();
    const uf = new NS.UnionFind(n);
    const span = Math.max(1, mincut + 1);
    const pq = new NS.FifoNodeBucketPQ(n, span);
    const visited = new Uint8Array(n);
    const seen = new Uint8Array(n);
    const r_v = new Array(n).fill(0);

    const starting_node = NS.random_functions.next() % n;
    let current_node = starting_node;
    pq.insert(current_node, 0);
    emit("noi_init", { n, mincut, starting_node });

    while (!pq.empty()) {
      current_node = pq.deleteMax();
      visited[current_node] = 1;
      const popped_unions = [];
      const popped_updates = [];
      const ne = G.get_first_invalid_edge(current_node);
      for (let e = 0; e < ne; e++) {
        const tgt = G.getEdgeTarget(current_node, e);
        if (visited[tgt]) continue;
        const w = G.getEdgeWeight(current_node, e);
        let increase = false;
        let unioned = false;
        if (r_v[tgt] < mincut || mincut === 0) {
          increase = true;
          if ((r_v[tgt] + w) >= mincut) {
            uf.Union(current_node, tgt);
            unioned = true;
            popped_unions.push([current_node, tgt]);
          }
        }
        r_v[tgt] += w;
        const new_rv = Math.min(r_v[tgt], mincut);
        popped_updates.push({ tgt, w, new_rv, unioned });
        if (seen[tgt]) {
          if (increase && !visited[tgt]) pq.increaseKey(tgt, new_rv);
        } else {
          seen[tgt] = 1;
          pq.insert(tgt, new_rv);
        }
      }
      emit("noi_pop", { current_node, updates: popped_updates, unions: popped_unions,
        r_v: r_v.slice(), uf_n: uf.n() });
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
