/* SBM BlockState. Port of graph-tool's flat BlockState (release-2.98)
 * with three entropy modes: dc, ndc, pp (Zhang+Peixoto 2020).
 *
 * Total description length per Peixoto 2017 ch. 11 §V + §VI:
 *   Σ = sparse_entropy + edges_dl + partition_dl + [degree_dl]
 * (PP swaps sparse_entropy + edges_dl for ppLikelihood + ppEdgesDl.)
 *
 * Source pointers + per-formula derivation in
 *   community-detection/docs/algorithms/sbm.md
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.SBM || !window.COMDET.SBM.UTIL) return;
  const U = window.COMDET.SBM.UTIL;
  const safelog = U.safelog;
  const lbinom = U.lbinom, logChooseRep = U.logChooseRep;
  const lgamma = U.lgamma;

  const MODES = { DC: "dc", NDC: "ndc", PP: "pp" };

  function BlockState(graph, opts) {
    opts = opts || {};
    const mode = opts.mode || (opts.degCorr === false ? MODES.NDC : MODES.DC);
    const degCorr = mode === MODES.DC;
    const usePartitionDl = opts.partitionDl !== false;
    const useEdgesDl = opts.edgesDl !== false && mode !== MODES.PP;
    const useDegreeDl = opts.degreeDl !== false && degCorr;

    const N = graph.vcount();
    // E = sum of edge weights (each edge counted once). Per Peixoto
    // 2017 Eq 23 + graph-tool's get_edges_dl(B, E, g), edges_dl uses
    // the raw edge-weight sum, not the stub-pair sum (= 2E_w for
    // undirected, which is graph.totalWeight()). Mirrors cpp tracer's
    // `g.E += w per edge record`. At level 0 (unweighted) this equals
    // ecount(); at nested level >=1 each edge carries an e_rs weight,
    // so this is the multigraph total e_rs sum.
    const E = graph.totalEdgeWeight();

    // Per-vertex degree term sum_i log(k_i!) — appears in DC's
    // P(A|k,e,b) only (Eq 43 numerator). Constant in the partition b
    // but model-class-specific; including it makes Σ_dc commensurable
    // with Σ_ndc (which has no per-vertex k_i! factor) and Σ_pp.
    let dcDegreeConst = 0;
    for (let v = 0; v < N; v++) dcDegreeConst += lgamma(graph.strength(v) + 1);

    // Capacity = N, the maximum-possible block count. Pre-allocating
    // avoids ensureCapacity reallocations when MCMC opens fresh blocks.
    const B = N;
    const b = new Int32Array(N);
    const nr = new Int32Array(B);
    const er = new Float64Array(B);
    const ers = new Float64Array(B * B);
    let Bne = 0;
    // Incremental non-empty-block cache. neList[0..Bne-1] = active block
    // ids; neIdx[r] = position of r in neList (-1 if empty). Maintained
    // by moveVertex + rebuildFromMembership; rebuilt from scratch only
    // on full membership reset.
    const neList = new Int32Array(B);
    const neIdx = new Int32Array(B);

    function rebuildFromMembership() {
      const seen = new Map();
      let next = 0;
      for (let v = 0; v < N; v++) {
        const r = b[v];
        if (!seen.has(r)) seen.set(r, next++);
        b[v] = seen.get(r);
      }
      nr.fill(0); er.fill(0); ers.fill(0);
      for (let v = 0; v < N; v++) nr[b[v]] += 1;
      // Cross-block edges count once via u<v rule; internal edges
      // counted once and doubled below to match graph-tool's
      // "e_rr counts each internal edge twice" diagonal convention.
      for (let v = 0; v < N; v++) {
        const r = b[v];
        const nb = graph.neighbours(v);
        const eb = graph.neighbourEdges(v);
        for (let i = 0; i < nb.length; i++) {
          const u = nb[i];
          if (u <= v) continue;
          const w = graph.edgeWeight(eb[i]);
          const s = b[u];
          ers[r * B + s] += w;
          if (r !== s) ers[s * B + r] += w;
        }
        ers[r * B + r] += graph.nodeSelfWeight(v);
      }
      for (let r = 0; r < B; r++) ers[r * B + r] *= 2;
      Bne = 0;
      for (let r = 0; r < B; r++) neIdx[r] = -1;
      for (let r = 0; r < B; r++) {
        if (nr[r] > 0) {
          neIdx[r] = Bne;
          neList[Bne] = r;
          Bne += 1;
        }
        let row = 0;
        for (let s = 0; s < B; s++) row += ers[r * B + s];
        er[r] = row;
      }
    }

    if (opts.init) {
      for (let v = 0; v < N; v++) b[v] = opts.init[v] | 0;
    } else {
      for (let v = 0; v < N; v++) b[v] = v;
    }
    rebuildFromMembership();

    // Exact microcanonical entropy per Peixoto Eq 43 (DC) / Eq 22 (NDC),
    // simple graph, ignoring the partition-independent constants.
    // e_rr stored doubled (= 2·E_internal); e_rr!! = 2^{e_rr/2}·(e_rr/2)!.
    const LOG2 = Math.log(2);
    // Sorted neList prefix - reused by every nonempty-block iteration
    // below so the entropy/DL terms scan O(Bne) instead of O(B=N).
    function sortedNonEmpty() {
      const a = neList.slice(0, Bne);
      Array.prototype.sort.call(a, (x, y) => x - y);
      return a;
    }

    function exactEntropy() {
      const ne = sortedNonEmpty();
      let S = 0;
      for (let i = 0; i < ne.length; i++) {
        const r = ne[i];
        // vterm: DC = lgamma(e_r+1) (from -log(1/e_r!) in denominator);
        //        NDC = e_r·log(n_r) (from -log(1/n_r^{e_r})).
        S += degCorr ? lgamma(er[r] + 1) : er[r] * safelog(nr[r]);
        // eterm r==s undirected: -log(e_rr!!) for doubled e_rr.
        const e_rr_half = ers[r * B + r] / 2;
        S -= e_rr_half * LOG2 + lgamma(e_rr_half + 1);
        // eterm r!=s undirected: -log(e_rs!).
        for (let j = i + 1; j < ne.length; j++) {
          const s = ne[j];
          S -= lgamma(ers[r * B + s] + 1);
        }
      }
      return S;
    }
    function edgesDl() {
      const NB = (Bne * (Bne + 1)) / 2;
      return logChooseRep(NB, E);
    }
    function partitionDl() {
      const ne = sortedNonEmpty();
      let S = lgamma(N + 1);
      for (let i = 0; i < ne.length; i++) S -= lgamma(nr[ne[i]] + 1);
      S += lbinom(N - 1, Bne - 1) + Math.log(N);
      return S;
    }
    function degreeDlUniform() {
      const ne = sortedNonEmpty();
      let S = 0;
      for (let i = 0; i < ne.length; i++) {
        const r = ne[i];
        S += logChooseRep(nr[r], Math.round(er[r]));
      }
      return S;
    }
    // Exact PP microcanonical: P(A|E_in, E_out, b) = C(M_in, E_in)^-1 ·
    // C(M_out, E_out)^-1 (uniform over simple graphs with the two
    // exact edge counts). Same units as DC/NDC exact entropy.
    function ppLikelihood() {
      const ne = sortedNonEmpty();
      let Ein2 = 0, Min = 0, nTot = 0;
      for (let i = 0; i < ne.length; i++) {
        const r = ne[i];
        Ein2 += ers[r * B + r];
        Min += (nr[r] * (nr[r] - 1)) / 2;
        nTot += nr[r];
      }
      const Ein = Ein2 / 2;
      const Mtot = (nTot * (nTot - 1)) / 2;
      const Mout = Mtot - Min;
      const Eout = E - Ein;
      let S = 0;
      if (Min > 0 && Ein > 0 && Ein <= Min) S += lbinom(Min, Ein);
      if (Mout > 0 && Eout > 0 && Eout <= Mout) S += lbinom(Mout, Eout);
      return S;
    }
    function ppEdgesDl() {
      const ne = sortedNonEmpty();
      let Min = 0;
      for (let i = 0; i < ne.length; i++) {
        const r = ne[i];
        Min += (nr[r] * (nr[r] - 1)) / 2;
      }
      return Math.log(Math.min(E, Min) + 1);
    }

    function entropy() {
      let S;
      if (mode === MODES.PP) {
        S = ppLikelihood() + ppEdgesDl();
      } else {
        S = exactEntropy();
        if (useEdgesDl) S += edgesDl();
        if (degCorr)    S -= dcDegreeConst;
      }
      if (usePartitionDl) S += partitionDl();
      if (useDegreeDl)    S += degreeDlUniform();
      return S;
    }

    function moveVertex(v, s) {
      const r = b[v];
      if (r === s) return;
      const nb = graph.neighbours(v);
      const eb = graph.neighbourEdges(v);
      for (let i = 0; i < nb.length; i++) {
        const u = nb[i];
        if (u === v) continue;
        const w = graph.edgeWeight(eb[i]);
        const t = b[u];
        if (t === r) {
          ers[r * B + r] -= 2 * w; er[r] -= 2 * w;
        } else {
          ers[r * B + t] -= w; ers[t * B + r] -= w;
          er[r] -= w; er[t] -= w;
        }
        if (t === s) {
          ers[s * B + s] += 2 * w; er[s] += 2 * w;
        } else {
          ers[s * B + t] += w; ers[t * B + s] += w;
          er[s] += w; er[t] += w;
        }
      }
      const sw = graph.nodeSelfWeight(v);
      if (sw > 0) {
        ers[r * B + r] -= 2 * sw; er[r] -= 2 * sw;
        ers[s * B + s] += 2 * sw; er[s] += 2 * sw;
      }
      const wasROccupied = nr[r] > 0;
      const wasSOccupied = nr[s] > 0;
      nr[r] -= 1;
      nr[s] += 1;
      if (wasROccupied && nr[r] === 0) {
        // Pop r from neList: swap-with-last + decrement Bne.
        const pos = neIdx[r];
        Bne -= 1;
        const tail = neList[Bne];
        neList[pos] = tail;
        neIdx[tail] = pos;
        neIdx[r] = -1;
      }
      if (!wasSOccupied && nr[s] > 0) {
        neIdx[s] = Bne;
        neList[Bne] = s;
        Bne += 1;
      }
      b[v] = s;
    }

    // Subset-entropy: sum over only the entropy terms that involve
    // blocks r or s. Since moveVertex(v, s) with v in r changes only
    // er[r], er[s], nr[r], nr[s], e_rr, e_ss, e_rs, and e_rt / e_st
    // for every t, every other vterm/eterm is unchanged. Δ = subset
    // (after) - subset (before) is therefore exact for the sparse
    // entropy + degree-DL parts. partition_dl + edges_dl are computed
    // analytically below since they have closed-form O(1) deltas.
    function subsetEntropy(r, s) {
      let S = 0;
      // vterm(r) + vterm(s).
      if (nr[r] > 0) S += degCorr ? lgamma(er[r] + 1) : er[r] * safelog(nr[r]);
      if (nr[s] > 0) S += degCorr ? lgamma(er[s] + 1) : er[s] * safelog(nr[s]);
      // eterm(r,r), eterm(s,s).
      if (nr[r] > 0) {
        const e_rr_half = ers[r * B + r] / 2;
        S -= e_rr_half * LOG2 + lgamma(e_rr_half + 1);
      }
      if (nr[s] > 0 && s !== r) {
        const e_ss_half = ers[s * B + s] / 2;
        S -= e_ss_half * LOG2 + lgamma(e_ss_half + 1);
      }
      // eterm(r,s) (counted once, off-diagonal).
      if (r !== s) S -= lgamma(ers[r * B + s] + 1);
      // eterm(r,t) + eterm(s,t) for every other non-empty t. Iterate
      // the sorted neList prefix - on dnc B=N=906 but Bne~30, so the
      // inner loop drops from ~B per virtualMove to ~Bne. Sorting
      // (vs raw admin-order) keeps the summation order identical to
      // the pre-cache version that walked t=0..B-1, so dS values
      // stay byte-equal across the refactor.
      const ne = sortedNonEmpty();
      for (let i = 0; i < ne.length; i++) {
        const t = ne[i];
        if (t === r || t === s) continue;
        S -= lgamma(ers[r * B + t] + 1);
        S -= lgamma(ers[s * B + t] + 1);
      }
      return S;
    }

    function partitionDlSubset(rA, sA) {
      // partitionDl = lgamma(N+1) + lbinom(N-1, Bne-1) + log(N)
      //                                    - sum_r lgamma(nr[r]+1)
      // Capture only the rA + sA contributions to the final sum + the
      // closed-form Bne-dependent prefix. The constant lgamma(N+1) +
      // log(N) cancels in delta.
      let S = lbinom(N - 1, Bne - 1);
      if (nr[rA] > 0) S -= lgamma(nr[rA] + 1);
      if (nr[sA] > 0 && sA !== rA) S -= lgamma(nr[sA] + 1);
      return S;
    }

    function edgesDlSubset() {
      // edges_dl depends only on Bne (NB = Bne*(Bne+1)/2) + E. So Δ is
      // captured by Bne.
      const NB = (Bne * (Bne + 1)) / 2;
      return logChooseRep(NB, E);
    }

    function degreeDlSubset(rA, sA) {
      // degree_dl_uniform = sum over r of logChooseRep(nr[r], er[r]).
      // Only rA + sA contributions change.
      let S = 0;
      if (nr[rA] > 0) S += logChooseRep(nr[rA], Math.round(er[rA]));
      if (nr[sA] > 0 && sA !== rA) S += logChooseRep(nr[sA], Math.round(er[sA]));
      return S;
    }

    function ppSubset() {
      // PP entropy is global (depends on Σ_r e_rr / nr nationwide); no
      // closed-form analytic delta. Fall back to the full ppLikelihood
      // + ppEdgesDl recompute.
      let S = ppLikelihood() + ppEdgesDl();
      if (usePartitionDl) S += partitionDl();
      return S;
    }

    function subsetSE(rA, sA) {
      if (mode === MODES.PP) return ppSubset();
      let S = subsetEntropy(rA, sA);
      if (useEdgesDl) S += edgesDlSubset();
      if (usePartitionDl) S += partitionDlSubset(rA, sA);
      if (useDegreeDl)    S += degreeDlSubset(rA, sA);
      return S;
    }

    function virtualMove(v, s) {
      if (s === b[v]) return 0;
      const fromR = b[v];
      const before = subsetSE(fromR, s);
      moveVertex(v, s);
      const after = subsetSE(fromR, s);
      moveVertex(v, fromR);
      return after - before;
    }

    return {
      get N() { return N; },
      blockOf: function (v) { return b[v]; },
      blockSize: function (r) { return nr[r] | 0; },
      blockMembership: function () { return new Int32Array(b); },
      nonEmptyBlocks: function () {
        // Slice off the live prefix of the cached list. Caller gets a
        // detached Int32Array; mutations cannot corrupt the cache.
        return neList.slice(0, Bne);
      },
      entropy: entropy,
      virtualMove: virtualMove,
      moveVertex: moveVertex,
    };
  }

  window.COMDET.SBM.MODES = MODES;
  window.COMDET.SBM.BlockState = BlockState;
})();
