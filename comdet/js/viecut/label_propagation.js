/* label_propagation: 2-pass label-propagation clustering used by viecut.h's
 * heuristic-bound LP-loop on n>10000.
 *
 * [UPSTREAM VieCut/lib/coarsening/label_propagation.h]
 *
 * Per-iter: for each n in G->nodes() walked in `permutation` order, scan
 * adjacency, accumulate per-block weight in hash_vec[block]; pick the
 * heaviest block (random tie-break via random_functions::next() % 2).
 * Two iters by default (upstream `iterations = 2`).
 *
 * RNG sites:
 *   - permutate_vector_local(perm, true) at line 52: shuffles `perm` in
 *     contiguous chunks of 128 elements via std::shuffle. Mirrored in JS
 *     by NS.permutate_vector_local in random.js (libstdc++-faithful
 *     optimized Fisher-Yates).
 *   - random_functions::next() % 2 at line 78: tie-break on equal-weight
 *     blocks. JS mirrors via NS.random_functions.next() & 1 (same modulo
 *     semantics on uint32).
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function propagate_labels(G) {
    const n = G.number_of_nodes();
    const cluster_id = new Array(n);
    const permutation = new Array(n);
    // hash_vec[block] = { first: EdgeWeight, second: NodeID }; "second"
    // is the vertex that last wrote into the slot, used to lazy-reset
    // first to 0 without scanning the whole array.
    const hash_vec = new Array(n);
    for (let i = 0; i < n; i++) {
      cluster_id[i] = i;
      hash_vec[i] = { first: 0, second: 0 };
    }

    // [UPSTREAM label_propagation.h:52]
    // permutate_vector_local(&permutation, true) — init perm to identity
    // then std::shuffle each chunk of 128.
    NS.random_functions.permutate_vector_local(permutation, true);

    const iterations = 2;
    for (let j = 0; j < iterations; j++) {
      // [UPSTREAM label_propagation.h:60] for (NodeID node : G->nodes())
      for (let node = 0; node < n; node++) {
        const nn = permutation[node];
        let max_block = cluster_id[nn];
        let max_value = 0;
        const ne = G.get_first_invalid_edge(nn);
        for (let e = 0; e < ne; e++) {
          const target = G.getEdgeTarget(nn, e);
          const block = cluster_id[target];
          // [UPSTREAM label_propagation.h:69] lazy-reset hash_vec[block].
          if (hash_vec[block].second !== nn) {
            hash_vec[block].first = 0;
            hash_vec[block].second = nn;
          }
          hash_vec[block].first += G.getEdgeWeight(nn, e);
          // [UPSTREAM label_propagation.h:76-81]
          // strictly heavier OR (equal AND next() % 2 == 1)
          if (hash_vec[block].first > max_value ||
              (hash_vec[block].first === max_value &&
               (NS.random_functions.next() % 2))) {
            max_value = hash_vec[block].first;
            max_block = block;
          }
        }
        cluster_id[nn] = max_block;
      }
    }
    return cluster_id;
  }

  NS.label_propagation = { propagate_labels };
})();
