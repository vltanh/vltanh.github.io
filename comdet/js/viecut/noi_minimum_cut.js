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

  // Per byte-equal-tracer playbook discipline "Tracer prints stay": stderr
  // probes for capforest pop loop. Mirror canonical [TRACE-CAP] / [TRACE-CAP-EDGE]
  // from instrumented/include/algorithms/global_mincut/noi_minimum_cut.h.
  // Guarded by globalThis.__VIECUT_TRACE__ so production walker is unaffected.
  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

  function modified_capforest(G, mincut) {
    const n = G.number_of_nodes();
    _trace(`[TRACE-CAP] entry n:${n} mincut:${mincut}`);
    const uf = new NS.UnionFind(n);
    const span = Math.max(1, mincut + 1);
    const pq = new NS.FifoNodeBucketPQ(n, span);
    const visited = new Uint8Array(n);
    const seen = new Uint8Array(n);
    const r_v = new Array(n).fill(0);

    const starting_raw = NS.random_functions.next();
    const starting_node = starting_raw % n;
    _trace(`[TRACE-CAP] start mod_n:${n} start:${starting_node}`);
    // raw next() hex for cross-side check of post-modulus shape
    const raw_hex = ("00000000" + (starting_raw >>> 0).toString(16)).slice(-8);
    _trace(`[TRACE-CAP] start_raw raw:0x${raw_hex} mod_n:${n} `
           + `start:${starting_node}`);
    let current_node = starting_node;
    pq.insert(current_node, 0);
    emit("noi_init", { n, mincut, starting_node });

    let pop_slot = 0;
    while (!pq.empty()) {
      current_node = pq.deleteMax();
      visited[current_node] = 1;
      _trace(`[TRACE-CAP] pop slot:${pop_slot} node:${current_node} `
             + `r_v:${r_v[current_node]} seen:${seen[current_node]}`);
      pop_slot++;
      const popped_unions = [];
      const popped_updates = [];
      const ne = G.get_first_invalid_edge(current_node);
      for (let e = 0; e < ne; e++) {
        const tgt = G.getEdgeTarget(current_node, e);
        if (visited[tgt]) continue;
        const w = G.getEdgeWeight(current_node, e);
        const rv_before = r_v[tgt];
        const t1_lt = rv_before < mincut ? 1 : 0;
        const t1_mc0 = mincut === 0 ? 1 : 0;
        let increase = false;
        let unioned = false;
        const rv_plus_w = rv_before + w;
        const t2_ge = rv_plus_w >= mincut ? 1 : 0;
        if (rv_before < mincut || mincut === 0) {
          increase = true;
          if ((rv_before + w) >= mincut) {
            uf.Union(current_node, tgt);
            unioned = true;
            popped_unions.push([current_node, tgt]);
          }
        }
        r_v[tgt] += w;
        const rv_after = r_v[tgt];
        const new_rv = Math.min(r_v[tgt], mincut);
        popped_updates.push({ tgt, w, new_rv, unioned });
        const seen_before = seen[tgt] ? 1 : 0;
        let pq_op = "none";
        if (seen[tgt]) {
          if (increase && !visited[tgt]) {
            pq.increaseKey(tgt, new_rv);
            pq_op = "increaseKey";
          }
        } else {
          seen[tgt] = 1;
          pq.insert(tgt, new_rv);
          pq_op = "insert";
        }
        _trace(`[TRACE-CAP-EDGE] node:${current_node} e:${e} tgt:${tgt} `
               + `w:${w} rv_before:${rv_before} t1_lt:${t1_lt} `
               + `t1_mc0:${t1_mc0} increase:${increase ? 1 : 0} `
               + `rv_plus_w:${rv_plus_w} t2_ge:${t2_ge} `
               + `union:${unioned ? 1 : 0} rv_after:${rv_after} `
               + `new_rv:${new_rv} seen_before:${seen_before} `
               + `pq_op:${pq_op}`);
      }
      emit("noi_pop", { current_node, updates: popped_updates, unions: popped_unions,
        r_v: r_v.slice(), uf_n: uf.n() });
    }
    _trace(`[TRACE-CAP] exit uf_n:${uf.n()}`);
    return uf;
  }

  function perform_minimum_cut_noi(G, indirect) {
    if (!G) return -1;
    const graphs = [G];
    let mincut = G.getMinDegree();
    NS.minimum_cut_helpers.setInitialCutValues(graphs);
    // [TRACE-NOI] outer perform_minimum_cut entry + per-iter
    // (noi_minimum_cut.h:61-83).
    _trace(`[TRACE-NOI] outer_entry G_n:${G.number_of_nodes()} `
           + `indirect:${indirect ? 1 : 0} initial_mincut:${mincut}`);
    let noi_iter = 0;
    while (graphs[graphs.length - 1].number_of_nodes() > 2 && mincut > 0) {
      _trace(`[TRACE-NOI] outer_iter:${noi_iter} `
             + `n_before:${graphs[graphs.length - 1].number_of_nodes()} `
             + `mincut_before:${mincut}`);
      const uf = modified_capforest(graphs[graphs.length - 1], mincut);
      graphs.push(NS.contraction.fromUnionFind(graphs[graphs.length - 1], uf, true));
      const mc_pre = mincut;
      mincut = NS.minimum_cut_helpers.updateCut(graphs, mincut);
      _trace(`[TRACE-NOI] outer_iter:${noi_iter} `
             + `n_after:${graphs[graphs.length - 1].n()} `
             + `uf_n:${uf.n()} mincut:${mincut} mincut_before:${mc_pre}`);
      noi_iter++;
    }
    _trace(`[TRACE-NOI] outer_exit `
           + `n_final:${graphs[graphs.length - 1].number_of_nodes()} `
           + `mincut:${mincut} iters:${noi_iter}`);
    if (!indirect) NS.minimum_cut_helpers.retrieveMinimumCut(graphs);
    return mincut;
  }

  NS.noi_minimum_cut = {
    perform_minimum_cut: perform_minimum_cut_noi,
    modified_capforest,
  };
})();
