/* tests::prTests12 + prTests34 + all_cut_local_red.
 *
 * [UPSTREAM VieCut/lib/coarsening/contraction_tests.h prTests12/34]
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/all_cut_local_red.h]
 *
 * prTests12 (find_all_cuts=false) merges:
 *   - any edge of weight >= mincut
 *   - any edge whose 2*weight > deg(source) or > deg(target)
 *
 * prTests34 merges triangles whose two heaviest edges sum to >= mincut,
 * or whose vertex pair has 2*(w1+w3) > deg(n) and 2*(w1+w2) > deg(tgt).
 *
 * allCutsPrTests12 / 34 (cactus version) preserve singleton mincut by
 * skipping when an incident vertex has degree == mincut.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function prTests12(G, limit, find_all_cuts) {
    if (find_all_cuts === undefined) find_all_cuts = false;
    const n = G.number_of_nodes();
    const uf = new NS.UnionFind(n);
    const contracted = new Uint8Array(n);
    for (let nx = 0; nx < n; nx++) {
      const n_wgt = G.getWeightedNodeDegree(nx);
      const ne = G.get_first_invalid_edge(nx);
      for (let e = 0; e < ne; e++) {
        const t = G.getEdgeTarget(nx, e);
        const wgt = G.getEdgeWeight(nx, e);
        const target = uf.Find(t);
        const t_wgt = G.getWeightedNodeDegree(t);
        const source = uf.Find(nx);

        if (wgt >= limit) {
          uf.Union(source, target);
          contracted[nx] = 1; contracted[t] = 1;
        }
        if (!find_all_cuts || (n_wgt >= limit && t_wgt >= limit)) {
          if (2 * wgt > n_wgt && (!find_all_cuts || !contracted[nx])) {
            contracted[nx] = 1; contracted[t] = 1;
            uf.Union(nx, t);
          }
          if (2 * wgt > t_wgt && (!find_all_cuts || !contracted[t])) {
            contracted[nx] = 1; contracted[t] = 1;
            uf.Union(nx, t);
          }
        }
      }
    }
    return uf;
  }

  function prTests34(G, weight_limit, find_all_cuts) {
    if (find_all_cuts === undefined) find_all_cuts = false;
    const n = G.number_of_nodes();
    const uf = new NS.UnionFind(n);
    const marked_first = new Int32Array(n).fill(-1);
    const marked_second = new Int32Array(n).fill(-1);
    const finished = new Uint8Array(n);
    const contracted = new Uint8Array(n);

    for (let nx = 0; nx < n; nx++) {
      if (finished[nx]) continue;
      finished[nx] = 1;
      const ne = G.get_first_invalid_edge(nx);
      for (let e = 0; e < ne; e++) {
        const tgt = G.getEdgeTarget(nx, e);
        if (tgt > nx) {
          marked_first[tgt] = nx;
          marked_second[tgt] = e;
        }
      }
      const deg_n = G.getWeightedNodeDegree(nx);
      for (let e1 = 0; e1 < ne; e1++) {
        const tgt = G.getEdgeTarget(nx, e1);
        const deg_tgt = G.getWeightedNodeDegree(tgt);
        if (finished[tgt]) {
          marked_first[tgt] = -1;
          marked_second[tgt] = -1;
          continue;
        }
        const w1 = G.getEdgeWeight(nx, e1);
        finished[tgt] = 1;
        let wgt_sum = w1;
        if (tgt > nx) {
          const ne2 = G.get_first_invalid_edge(tgt);
          for (let e2 = 0; e2 < ne2; e2++) {
            const tgt2 = G.getEdgeTarget(tgt, e2);
            if (marked_second[tgt2] === -1) continue;
            if (marked_first[tgt2] !== nx) continue;
            const w2 = G.getEdgeWeight(tgt, e2);
            const w3 = G.getEdgeWeight(nx, marked_second[tgt2]);
            wgt_sum += Math.min(w2, w3);
            const contractible_one_cut =
              !find_all_cuts && 2 * (w1 + w3) >= deg_n
              && 2 * (w1 + w2) >= deg_tgt;
            const contractible_all_cuts =
              find_all_cuts
              && 2 * (w1 + w3) > deg_n && 2 * (w1 + w2) > deg_tgt
              && deg_n >= weight_limit && deg_tgt >= weight_limit;
            if ((contractible_one_cut || contractible_all_cuts)
                && !contracted[nx] && !contracted[tgt]) {
              uf.Union(nx, tgt);
              contracted[nx] = 1; contracted[tgt] = 1;
            }
          }
          if (wgt_sum >= weight_limit) {
            uf.Union(nx, tgt);
            contracted[nx] = 1; contracted[tgt] = 1;
          }
          marked_first[tgt] = -1;
          marked_second[tgt] = -1;
        }
      }
    }
    return uf;
  }

  function allCutsPrTests12(G, limit) {
    const n = G.number_of_nodes();
    const uf = new NS.UnionFind(n);
    const degrees = new Array(n);
    for (let i = 0; i < n; i++) degrees[i] = G.getWeightedNodeDegree(i);
    for (let nx = 0; nx < n; nx++) {
      const ne = G.get_first_invalid_edge(nx);
      for (let e = 0; e < ne; e++) {
        const target = uf.Find(G.getEdgeTarget(nx, e));
        const source = uf.Find(nx);
        const wgt = G.getEdgeWeight(nx, e);
        if (target !== source
            && (wgt > limit || 2 * wgt > degrees[source]
                || 2 * wgt > degrees[target])
            && degrees[source] > limit && degrees[target] > limit) {
          const new_w = degrees[source] + degrees[target] - (2 * wgt);
          degrees[source] = new_w;
          degrees[target] = new_w;
          uf.Union(source, target);
        }
      }
    }
    return uf;
  }

  function allCutsPrTests34(G, weight_limit) {
    const n = G.number_of_nodes();
    const uf = new NS.UnionFind(n);
    const marked = new Int32Array(n).fill(-1);
    const finished = new Uint8Array(n);
    const contracted = new Uint8Array(n);
    for (let nx = 0; nx < n; nx++) {
      if (finished[nx]) continue;
      finished[nx] = 1;
      const ne = G.get_first_invalid_edge(nx);
      for (let e = 0; e < ne; e++) {
        const tgt = G.getEdgeTarget(nx, e);
        if (tgt > nx) marked[tgt] = e;
      }
      const deg_n = G.getWeightedNodeDegree(nx);
      for (let e1 = 0; e1 < ne; e1++) {
        const tgt = G.getEdgeTarget(nx, e1);
        const deg_tgt = G.getWeightedNodeDegree(tgt);
        if (finished[tgt]) { marked[tgt] = -1; continue; }
        finished[tgt] = 1;
        let wgt_sum = G.getEdgeWeight(nx, e1);
        if (tgt > nx) {
          const ne2 = G.get_first_invalid_edge(tgt);
          for (let e2 = 0; e2 < ne2; e2++) {
            const tgt2 = G.getEdgeTarget(tgt, e2);
            if (marked[tgt2] === -1) continue;
            if (marked[tgt2] >= G.get_first_invalid_edge(nx)
                || marked[tgt2] < G.get_first_edge(nx)) continue;
            const w1 = G.getEdgeWeight(nx, e1);
            const w2 = G.getEdgeWeight(tgt, e2);
            const w3 = G.getEdgeWeight(nx, marked[tgt2]);
            wgt_sum += Math.min(w2, w3);
            const contractible =
              2 * (w1 + w3) > deg_n && 2 * (w1 + w2) > deg_tgt
              && deg_n > weight_limit && deg_tgt > weight_limit;
            if (contractible && !contracted[nx] && !contracted[tgt]) {
              uf.Union(nx, tgt);
              contracted[nx] = 1; contracted[tgt] = 1;
            }
          }
          if (wgt_sum > weight_limit) {
            uf.Union(nx, tgt);
            contracted[nx] = 1; contracted[tgt] = 1;
          }
          marked[tgt] = -1;
        }
      }
    }
    return uf;
  }

  NS.tests = { prTests12, prTests34 };
  NS.all_cut_local_red = { allCutsPrTests12, allCutsPrTests34 };
})();
