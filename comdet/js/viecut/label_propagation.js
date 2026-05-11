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

  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

  function propagate_labels(G) {
    const n = G.number_of_nodes();
    _trace(`[TRACE-LP] entry n:${n}`);
    const cluster_id = new Array(n);
    const permutation = new Array(n);
    const hash_vec = new Array(n);
    for (let i = 0; i < n; i++) {
      cluster_id[i] = i;
      hash_vec[i] = { first: 0, second: 0 };
    }

    NS.random_functions.permutate_vector_local(permutation, true);
    _trace(`[TRACE-LP] perm_done size:${permutation.length} `
           + `first:${permutation[0]} last:${permutation[permutation.length - 1]}`);

    const iterations = 2;
    for (let j = 0; j < iterations; j++) {
      _trace(`[TRACE-LP] iter_start j:${j}`);
      for (let node = 0; node < n; node++) {
        const nn = permutation[node];
        let max_block = cluster_id[nn];
        let max_value = 0;
        const ne = G.get_first_invalid_edge(nn);
        for (let e = 0; e < ne; e++) {
          const target = G.getEdgeTarget(nn, e);
          const block = cluster_id[target];
          const stale = hash_vec[block].second !== nn ? 1 : 0;
          const before = hash_vec[block].first;
          if (stale) {
            hash_vec[block].first = 0;
            hash_vec[block].second = nn;
          }
          const before_add = hash_vec[block].first;
          const w = G.getEdgeWeight(nn, e);
          hash_vec[block].first += w;
          const after_add = hash_vec[block].first;
          const mv_before = max_value;
          const mb_before = max_block;
          const strict_gt = hash_vec[block].first > max_value ? 1 : 0;
          const eq = hash_vec[block].first === max_value ? 1 : 0;
          let tie_take = 0;
          let consumed_next = 0;
          if (strict_gt) {
            max_value = hash_vec[block].first;
            max_block = block;
          } else if (eq) {
            const r = NS.random_functions.next();
            consumed_next = 1;
            tie_take = (r % 2) !== 0 ? 1 : 0;
            if (tie_take) {
              max_value = hash_vec[block].first;
              max_block = block;
            }
            const r_hex = ("00000000" + (r >>> 0).toString(16)).slice(-8);
            _trace(`[TRACE-LP-TIE] j:${j} node:${node} n:${nn} e:${e} `
                   + `tgt:${target} block:${block} rng:0x${r_hex} `
                   + `mod2:${r % 2} take:${tie_take}`);
          }
          _trace(`[TRACE-LP-E] j:${j} node:${node} n:${nn} e:${e} `
                 + `tgt:${target} block:${block} stale:${stale} `
                 + `hv_before_reset:${before} hv_before_add:${before_add} `
                 + `w:${w} hv_after:${after_add} `
                 + `mv_before:${mv_before} mb_before:${mb_before} `
                 + `strict_gt:${strict_gt} `
                 + `eq:${eq} consumed_next:${consumed_next} `
                 + `tie_take:${tie_take} mv_after:${max_value} `
                 + `mb_after:${max_block}`);
        }
        cluster_id[nn] = max_block;
        _trace(`[TRACE-LP-N] j:${j} node:${node} n:${nn} `
               + `cluster_id_after:${cluster_id[nn]}`);
      }
    }
    _trace(`[TRACE-LP] exit n:${n}`);
    return cluster_id;
  }

  NS.label_propagation = { propagate_labels };
})();
