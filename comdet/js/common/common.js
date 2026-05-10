/* Shared comdet primitives — RNG + Graph + helpers used by multiple
 * community-detection algorithm kernels (Louvain, Leiden, Infomap).
 *
 * Extracted verbatim from louvain.js (commit pre-refactor); these
 * primitives are not Louvain-specific — they are shared infrastructure
 * that several kernels consume. Owning them under COMDET.COMMON keeps
 * each algo's namespace (LOUVAIN / LEIDEN / INFOMAP / INFOMAP_CANON)
 * focused on the algebra it actually owns and removes the historical
 * "infomap imports LV.Graph / LV.MT19937", "leiden re-exports
 * LV.MT19937 / LV.shuffle / LV.range / LV.Graph" cross-algo coupling
 * (audit: community-detection/cross_algo_isolation_audit.md, 2026-05-10).
 *
 * SBM has its own Graph + MT19937 + shuffle (different self-loop +
 * shuffle-direction conventions, see sbm/util.js:38-49); SBM does NOT
 * consolidate here. VieCut / CC / IKC are self-contained and likewise
 * untouched.
 *
 * Move = rename, NOT re-implement: every byte of source is identical
 * to the version that lived under window.COMDET.LOUVAIN before the
 * refactor. Louvain's L4 bit-equal tracer, Leiden's self_rng_check, and
 * Infomap's self_rng_check all depend on the existing semantics.
 */
(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};

  // ── MT19937 ─────────────────────────────────────────────────────
  // Matsumoto-Nishimura 32-bit. Same module the cpp tracer uses (the
  // canonical libc rand is substituted out in the L4 tracer build so
  // both sides share a single deterministic RNG family).
  function MT19937(seed) {
    const N = 624;
    const mt = new Uint32Array(N);
    let mti = N + 1;
    function init(s) {
      mt[0] = s >>> 0;
      for (let i = 1; i < N; i++) {
        const t = (mt[i - 1] ^ (mt[i - 1] >>> 30)) >>> 0;
        const lo = (t & 0xffff), hi = (t >>> 16);
        const m = (1812433253 * lo + (((1812433253 * hi) & 0xffff) << 16)) >>> 0;
        mt[i] = (m + i) >>> 0;
      }
      mti = N;
    }
    function next() {
      if (mti >= N) {
        for (let i = 0; i < N; i++) {
          const y = ((mt[i] & 0x80000000) | (mt[(i + 1) % N] & 0x7fffffff)) >>> 0;
          let v = (mt[(i + 397) % N] ^ (y >>> 1)) >>> 0;
          if (y & 1) v = (v ^ 0x9908b0df) >>> 0;
          mt[i] = v;
        }
        mti = 0;
      }
      let y = mt[mti++];
      y = (y ^ (y >>> 11)) >>> 0;
      y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
      y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
      y = (y ^ (y >>> 18)) >>> 0;
      return y;
    }
    init(seed >>> 0);
    return {
      // peek(k): return next k raw uint32 outputs without consuming.
      // Snapshots mt + mti, draws k, restores. Used by L4 RNG-state
      // diff diagnostics to compare RNG state at boundary points
      // against the cpp tracer's std::mt19937 peek (uses the same
      // copy-and-draw idiom).
      peek: function (k) {
        const mtSave = new Uint32Array(mt);
        const mtiSave = mti;
        const out = new Array(k);
        for (let i = 0; i < k; i++) out[i] = next() >>> 0;
        for (let i = 0; i < N; i++) mt[i] = mtSave[i];
        mti = mtiSave;
        return out;
      },
      // int(lo, hi): rejection sampling on [lo, hi]. Used by Louvain
      // shuffle. Matches the cpp tracer's int_inclusive helper bit-for-
      // bit (range = hi-lo+1; limit = floor(2^32/range)*range).
      int: function (lo, hi) {
        const range = hi - lo + 1;
        if (range <= 0) return lo;
        const limit = Math.floor(0x100000000 / range) * range;
        let r;
        do { r = next(); } while (r >= limit);
        return lo + (r % range);
      },
      // Lemire's debiased multiplication. Used by Leiden so its
      // int(lo, hi) draws bit-equal to igraph's igraph_rng_get_integer
      // (which uses Lemire). Independent from Louvain's plain int().
      //
      // Rejection threshold = 2^32 % range. cpp computes via uint32
      // wrap: `(-range) % range` where -range underflows to 2^32-range
      // and the C `%` gives `(2^32-range) % range = 2^32 % range`. JS
      // BigInt arithmetic has no fixed bit width: `(-r64) % r64` of a
      // negative BigInt returns a negative-or-zero remainder (truncated-
      // toward-zero modulo), giving the wrong threshold (0 for any
      // range that divides exactly into -range/range, which is always
      // since BigInt(-range)/BigInt(range) = -1n exact). The correct
      // form below uses (1n << 32n) % r64 directly. Without it, JS
      // never rejects while cpp rejects at rate range/2^32, desyncing
      // the shuffle stream on graphs where any draw lands in cpp's
      // reject window (probability ≈ n*range/2^32 per shuffle).
      intLemire: function (lo, hi) {
        if (hi === lo) return lo;
        const range = hi - lo + 1;
        if (range <= 0) return lo;
        const r64 = BigInt(range);
        const t = (1n << 32n) % r64;
        let m, l;
        do {
          const x = BigInt(next());
          m = x * r64;
          l = m & 0xffffffffn;
        } while (l < t);
        return lo + Number(m >> 32n);
      },
      seed: function (s) { init(s >>> 0); },
      raw: next,
    };
  }

  // Canonical louvain.cpp:222-229. i runs forward from 0 to n-2;
  // rand_pos = rng.int(i, n-1); swap arr[i] with arr[rand_pos].
  // Cpp tracer mirrors this loop direction exactly.
  function shuffle(arr, rng) {
    const n = arr.length;
    for (let i = 0; i < n - 1; i++) {
      const rand_pos = rng.int(i, n - 1);
      const t = arr[i]; arr[i] = arr[rand_pos]; arr[rand_pos] = t;
    }
  }
  function range(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }

  // ── Graph ────────────────────────────────────────────────────────
  // Mirrors canonical externals/louvain/src/graph_binary.{h,cpp}:
  //   - adj per node stores neighbour list with self-loop ONCE and
  //     every non-self edge in BOTH directions.
  //   - weighted_degree(v) = Σ over adj weights → self-loop counts once.
  //   - total_weight = Σ_v weighted_degree(v) → equals 2m for unweighted
  //     undirected at level 0, doubles per level because canonical's
  //     partition2graph_binary emits each pair in both directions.
  function Graph(n, edges, opts) {
    opts = opts || {};
    const directed = !!opts.directed;
    const correctSelfLoops = !!opts.correctSelfLoops;
    // sortAdj: true sorts each node's adjacency by neighbour-id ASC,
    // mirroring igraph_lazy_adjlist iteration order. Required for byte-
    // equal greedy-pick vs libleidenalg under matching seed (greedy
    // ties pick the lowest-id neighbour-comm first). Default off so
    // Louvain's canonical insertion-order adjacency stays unchanged.
    const sortAdj = !!opts.sortAdj;
    const nodeSizes = opts.nodeSizes ? opts.nodeSizes.slice()
                                     : new Array(n).fill(1);
    const m = edges.length;
    const eu = new Int32Array(m);
    const ev = new Int32Array(m);
    const ew = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      eu[i] = edges[i][0] | 0;
      ev[i] = edges[i][1] | 0;
      ew[i] = edges[i].length > 2 ? +edges[i][2] : 1.0;
    }
    // sortAdj=true implies igraph-canonical mode: cpp's igraph stores
    // undirected edges with the larger vertex id as `from` (verified
    // empirically via libleidenalg adjnoun trace; all 425 stored edges
    // have from >= to). collapseLeiden's `if (from !== v) continue`
    // filter then keeps only the higher-id-side per underlying edge,
    // which determines which super-node iteration emits the collapsed
    // edge. Without this normalization, JS splits a super-pair into
    // two separate level-N+1 edges where cpp emits one combined edge.
    if (!directed && sortAdj) {
      for (let i = 0; i < m; i++) {
        if (eu[i] < ev[i]) { const t = eu[i]; eu[i] = ev[i]; ev[i] = t; }
      }
    }
    // Per-node adjacency: each non-self edge appears in BOTH endpoint
    // lists; self-loop appears in one list ONCE. Mirrors canonical
    // graph_binary's links[] layout. If preBuiltAdj is supplied
    // (canonical-faithful collapse path) it is consumed directly,
    // bypassing the edge-push round-trip, required for level-1+
    // collapsed graphs to mirror externals/louvain partition2graph_binary
    // which writes per-comm adj directly from std::map<int,double> (key-
    // ASC, per-direction-ONCE) without going through an edge list.
    let adjE, adjN, adjW;
    if (opts.preBuiltAdj) {
      adjN = opts.preBuiltAdj.adjN;
      adjW = opts.preBuiltAdj.adjW;
      adjE = opts.preBuiltAdj.adjE
        || adjN.map(function (lst) { return lst.map(function () { return -1; }); });
    } else {
      adjE = new Array(n);
      adjN = new Array(n);
      adjW = new Array(n);
      for (let i = 0; i < n; i++) { adjE[i] = []; adjN[i] = []; adjW[i] = []; }
      for (let e = 0; e < m; e++) {
        const u = eu[e], v = ev[e], w = ew[e];
        adjE[u].push(e); adjN[u].push(v); adjW[u].push(w);
        if (u !== v) {
          adjE[v].push(e); adjN[v].push(u); adjW[v].push(w);
        }
      }
    }
    if (sortAdj && !opts.preBuiltAdj) {
      for (let v = 0; v < n; v++) {
        const idxs = adjN[v].map(function (_, i) { return i; });
        idxs.sort(function (a, b) {
          if (adjN[v][a] !== adjN[v][b]) return adjN[v][a] - adjN[v][b];
          return adjE[v][a] - adjE[v][b];
        });
        adjN[v] = idxs.map(function (i) { return adjN[v][i]; });
        adjE[v] = idxs.map(function (i) { return adjE[v][i]; });
        adjW[v] = idxs.map(function (i) { return adjW[v][i]; });
      }
    }
    // weighted_degree(v) = Σ over adj entries (self-loop counted once).
    // Mirrors canonical Graph::weighted_degree (graph_binary.h:130-143).
    const wDeg = new Float64Array(n);
    for (let v = 0; v < n; v++) {
      let s = 0;
      for (let i = 0; i < adjW[v].length; i++) s += adjW[v][i];
      wDeg[v] = s;
    }
    // nb_selfloops(v): weight of v's self-loop entry, or 0 if none.
    // For unweighted, returns 1 per the canonical convention. For our
    // case all edges have explicit weights so just return the stored
    // self-loop weight.
    const nbSelfLoops = new Float64Array(n);
    for (let e = 0; e < m; e++) if (eu[e] === ev[e]) nbSelfLoops[eu[e]] += ew[e];
    // total_weight = Σ_v weighted_degree(v). Mirrors graph_binary.cpp:91-92.
    let totalWeight = 0;
    for (let v = 0; v < n; v++) totalWeight += wDeg[v];
    // totalEdgeWeight = Σ_e edge_weight(e). Mirrors libleidenalg
    // Graph::total_weight() (sum over edges, each once). Differs from
    // totalWeight() by Σ_self_loop w because totalWeight counts self
    // loops once but non-self edges twice (per Louvain canonical).
    // Use this when porting Modularity formulas that need cpp's m_orig.
    let totalEdgeWeight = 0;
    for (let e = 0; e < m; e++) totalEdgeWeight += ew[e];

    return {
      vcount: function () { return n; },
      ecount: function () { return m; },
      isDirected: function () { return directed; },
      correctSelfLoops: function () { return correctSelfLoops; },
      edge: function (e) { return [eu[e], ev[e]]; },
      edgeWeight: function (e) { return ew[e]; },
      nodeSize: function (v) { return nodeSizes[v]; },
      nodeSelfWeight: function (v) { return nbSelfLoops[v]; },
      nbSelfLoops: function (v) { return nbSelfLoops[v]; },
      degree: function (v) { return adjN[v].length; },
      weightedDegree: function (v) { return wDeg[v]; },
      strength: function (v) { return wDeg[v]; },  // alias (Louvain conv: self once)
      // strengthLeiden(v) = wDeg[v] + nbSelfLoops[v]. Mirrors igraph's
      // strength(v) under default IGRAPH_LOOPS_TWICE (used by libleiden-
      // alg's Modularity / partition admin: cpp counts self-loop edges
      // TWICE in strength for undirected graphs, so the contribution of
      // a self-loop with weight w is 2*w to strength). Used by Leiden's
      // canonMod adapter + LeidenPartition rebuildAdmin.
      strengthLeiden: function (v) { return wDeg[v] + nbSelfLoops[v]; },
      totalWeight: function () { return totalWeight; },
      totalEdgeWeight: function () { return totalEdgeWeight; },
      neighbours: function (v) { return adjN[v]; },
      neighbourEdges: function (v) { return adjE[v]; },
      neighbourWeights: function (v) { return adjW[v]; },
      possibleEdges: function (sz) {
        let p = directed ? sz * sz : (sz * (sz - 1)) / 2;
        if (correctSelfLoops) p += sz;
        return p;
      },
      // Canonical partition2graph_binary (externals/louvain
      // louvain.cpp:147-211): renumber surviving comms by ORIGINAL-id-
      // ASC; for each comm c, walk every constituent v's adj list,
      // accumulate per-target-comm weights into a std::map<int,double>
      // (key-ASC iteration); emit g2.links/weights = m's flat slice.
      // adj[c] post-emission = m's keys in target-id-ASC order; each
      // non-self pair (a,b) appears in adj[a] ONCE (from a's m) and
      // adj[b] ONCE (from b's m). Self-loops appear ONCE in adj[c] with
      // weight = 2·intra_c (a's adj iteration finds b and vice versa
      // both contribute w to bucket[a][a] when (a,b) is intra-a).
      //
      // To mirror this layout in JS we build the new Graph DIRECTLY
      // from per-comm bucket maps (bypassing the edge-push round-trip
      // through the Graph constructor, which would double inter pairs).
      collapse: function (membership, ncomm) {
        // Step 1. Comm renumber by original-id-ASC. Mirrors
        // louvain.cpp:147-160.
        const renumber = new Int32Array(ncomm);
        for (let c = 0; c < ncomm; c++) renumber[c] = -1;
        for (let v = 0; v < n; v++) renumber[membership[v]] = 1;
        let last = 0;
        for (let i = 0; i < ncomm; i++) {
          if (renumber[i] !== -1) renumber[i] = last++;
        }
        const nbc = last;
        // Step 2. comm_nodes[c] = list of constituents (push-order).
        const commNodes = new Array(nbc);
        for (let c = 0; c < nbc; c++) commNodes[c] = [];
        const newSizes = new Array(nbc).fill(0);
        for (let v = 0; v < n; v++) {
          const nc = renumber[membership[v]];
          commNodes[nc].push(v);
          newSizes[nc] += nodeSizes[v];
        }
        // Step 3. Per-comm bucket; emit per-direction-once into
        // direct adj. Flat eu/ev/ew is built per-comm slice mirroring
        // canonical g2's flat links/weights output.
        const newAdjN = new Array(nbc);
        const newAdjW = new Array(nbc);
        const newAdjE = new Array(nbc);
        for (let c = 0; c < nbc; c++) { newAdjN[c] = []; newAdjW[c] = []; newAdjE[c] = []; }
        const newEu = [];
        const newEv = [];
        const newEw = [];
        for (let c = 0; c < nbc; c++) {
          const bucket = new Map();
          const constituents = commNodes[c];
          for (let i = 0; i < constituents.length; i++) {
            const v = constituents[i];
            const av = adjN[v];
            const aw = adjW[v];
            for (let k = 0; k < av.length; k++) {
              const targetNew = renumber[membership[av[k]]];
              bucket.set(targetNew, (bucket.get(targetNew) || 0) + aw[k]);
            }
          }
          const targets = Array.from(bucket.keys()).sort(function (a, b) { return a - b; });
          for (let t = 0; t < targets.length; t++) {
            const tc = targets[t];
            const w = bucket.get(tc);
            newAdjN[c].push(tc);
            newAdjW[c].push(w);
            newAdjE[c].push(newEu.length);
            newEu.push(c);
            newEv.push(tc);
            newEw.push(w);
          }
        }
        // Build the new Graph from pre-built adj. Edge list mirrors
        // canonical's flat per-comm slice (each (c, target) appears once
        // per c's emission; pair (c0, c1) appears twice across the flat
        // list = once from c0's slice as (c0,c1) and once from c1's
        // slice as (c1,c0), but each per-node adj has the entry only
        // ONCE = canonical layout).
        const collapsedEdges = [];
        for (let i = 0; i < newEu.length; i++) collapsedEdges.push([newEu[i], newEv[i], newEw[i]]);
        return Graph(nbc, collapsedEdges, {
          directed: directed,
          correctSelfLoops: correctSelfLoops,
          nodeSizes: newSizes,
          collapsed: true,
          sortAdj: sortAdj,
          preBuiltAdj: { adjN: newAdjN, adjW: newAdjW, adjE: newAdjE },
        });
      },
      // libleidenalg-shape collapse (Graph::collapse_graph,
      // GraphHelper.cpp:703-784). Walks each underlying edge ONCE, bucketing:
      //   self-loop  (u==v, cu==cv): += w/2 to (cu, cu)  (cpp halves
      //                                  the IGRAPH_OUT-listed self-loop
      //                                  per line 743-744)
      //   non-self intra (u!=v, cu==cv): += w to (cu, cu)
      //   non-self inter (cu!=cv): += w to (cu, cv)  (single emission;
      //                              cpp's `if (from != v) continue` at
      //                              line 734-737 skips the cv-side walk)
      // Emits ONE edge per (c, t) pair. Graph constructor's u!=v branch
      // gives both-side adj for inter; self-loops list ONCE in adj with
      // edge weight = intra_c (matching cpp's igraph_create result).
      // `nodeSelfWeight(super_c)` then equals intra_c (matching cpp's
      // `node_self_weight` from the single self-loop edge).
      //
      // Differs from .collapse() (Louvain canonical convention) which
      // emits each inter pair TWICE and self-loop with weight 2·intra_c
      // for compatibility with gen-louvain's partition2graph_binary.
      collapseLeiden: function (membership, ncomm) {
        // Renumber surviving comms preserving incoming order (caller
        // expected to have run Partition.renumberLeiden, csize-DESC).
        const renumber = new Int32Array(ncomm);
        for (let c = 0; c < ncomm; c++) renumber[c] = -1;
        for (let v = 0; v < n; v++) renumber[membership[v]] = 1;
        let last = 0;
        for (let i = 0; i < ncomm; i++) if (renumber[i] !== -1) renumber[i] = last++;
        const nbc = last;
        // commNodes[c] = constituents of c, in node-id ASC order
        // (matching cpp's MutableVertexPartition::get_communities which
        // pushes nodes in ASC iteration of `for v=0..n-1`).
        const commNodes = new Array(nbc);
        for (let c = 0; c < nbc; c++) commNodes[c] = [];
        const newSizes = new Array(nbc).fill(0);
        for (let v = 0; v < n; v++) {
          const nc = renumber[membership[v]];
          commNodes[nc].push(v);
          newSizes[nc] += nodeSizes[v];
        }
        // Mirror cpp Graph::collapse_graph (GraphHelper.cpp:703-784)
        // exactly so the resulting edge-insertion order in the new
        // Graph matches cpp's igraph_create order; subsequent init_admin
        // sums then match bit-for-bit.
        // Outer loop: v_comm = 0..nbc-1 (ASC).
        // Inner loop: per constituent v of v_comm in ASC order, walk
        // adjE[v] (edge ids) in adj order. For each edge: skip if
        // from-endpoint != v (cpp's `if (from != v) continue`).
        // Self-loop weight halved for undirected. neighbour_communities
        // pushed in first-encounter order. Edges emitted in
        // (v_comm, u_comm-encounter) order.
        const newEdges = [];
        const ewAccum = new Float64Array(nbc);
        const ewAdded = new Uint8Array(nbc);
        const neighList = [];
        for (let v_comm = 0; v_comm < nbc; v_comm++) {
          const constituents = commNodes[v_comm];
          neighList.length = 0;
          for (let i = 0; i < constituents.length; i++) {
            const v = constituents[i];
            const aE = adjE[v];
            for (let k = 0; k < aE.length; k++) {
              const e = aE[k];
              const from = eu[e], to = ev[e];
              if (from !== v) continue;
              const u_comm = renumber[membership[to]];
              // No halving for self-loops here. cpp halves because its
              // IGRAPH_LOOPS_TWICE inclist iteration hits each self-loop
              // edge twice per vertex (so two w/2 contributions sum to
              // w). JS Graph stores self-loops ONCE in adj, no double
              // hit, no compensating halve. Net contribution is w on
              // both sides.
              const w_e = ew[e];
              if (!ewAdded[u_comm]) {
                ewAdded[u_comm] = 1;
                neighList.push(u_comm);
              }
              ewAccum[u_comm] += w_e;
            }
          }
          for (let i = 0; i < neighList.length; i++) {
            const u_comm = neighList[i];
            newEdges.push([v_comm, u_comm, ewAccum[u_comm]]);
            ewAccum[u_comm] = 0;
            ewAdded[u_comm] = 0;
          }
        }
        return Graph(nbc, newEdges, {
          directed: directed,
          correctSelfLoops: correctSelfLoops,
          nodeSizes: newSizes,
          collapsed: true,
          sortAdj: sortAdj,    // propagate (cpp's level-1+ adj sorts ASC)
        });
      },
    };
  }

  window.COMDET.COMMON = {
    MT19937: MT19937,
    shuffle: shuffle,
    range: range,
    Graph: Graph,
  };
})();
