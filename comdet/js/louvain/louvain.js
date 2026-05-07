/* Louvain kernel — JS port faithful to externals/louvain (Blondel 2008
 * et al., gen-louvain v0.3 src/louvain.cpp + modularity.cpp +
 * graph_binary.cpp). The JS code structure mirrors the canonical
 * cpp source, not the paper: every per-step computation lands on the
 * same arithmetic operands in the same order so a JS-MT19937 + double-
 * precision build of the canonical (community-detection/tools/viz_check/
 * louvain/instrumented/louvain_l4_tracer.cpp) produces bit-identical
 * per-visit output under matching seed.
 *
 * What this file owns:
 *   - MT19937 RNG (JS port; the cpp tracer's libc rand is replaced
 *     with the same MT19937 to make L4 bit-equality reachable).
 *   - Fisher-Yates shuffle (mirrors canonical louvain.cpp:222-229
 *     loop direction: i from 0 to n-2; rand_pos = mt(qual->size-i)+i).
 *   - Graph (mirrors canonical Graph from graph_binary.cpp + .h:
 *     adj is per-node neighbour list with both directions for non-self
 *     edges and one entry for self-loops; weighted_degree(v) sums adj
 *     weights so a self-loop contributes ONCE; total_weight at level 0
 *     equals 2m for unweighted undirected, doubles per level).
 *   - Modularity admin (mirrors canonical Modularity::in/tot from
 *     modularity.h + .cpp: in[c] = 2·intra_c + Σ self-loops,
 *     tot[c] = Σ weighted_degree of constituents; remove + insert update
 *     by subtracting / adding 2·dnc + nb_selfloops(node) and
 *     weighted_degree(node)).
 *   - Sweep: for each v in shuffled order, neigh_comm(v) populates
 *     neigh_pos[0..neigh_last] with neigh_pos[0]=vComm and weight 0;
 *     remove(v, vComm, neigh_weight[vComm]); pick best gain via strict
 *     `> best_increase` (init 0); insert(v, best_comm, neigh_weight[best]).
 *   - Run: while improvement, level loop with partition2graph_binary
 *     renumber-by-original-id-ASC + canonical aggregation (per-direction
 *     iteration => super-self-loop weight = 2·intra_c).
 *
 * Leiden (js/leiden/leiden.js) extends this substrate:
 *   - Adds the CPM quality function (size-penalty objective).
 *   - Replaces sweep with moveNodes (FIFO queue + neighbour
 *     restabilisation, paper §"fast local move procedure").
 *   - Inserts mergeNodesConstrained between local-move and aggregation
 *     (the refinement phase that guarantees γ-connectivity).
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
      // int(lo, hi) — rejection sampling on [lo, hi]. Used by Louvain
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
    // Per-node adjacency: each non-self edge appears in BOTH endpoint
    // lists; self-loop appears in one list ONCE. Mirrors canonical
    // graph_binary's links[] layout.
    const adjE = new Array(n);
    const adjN = new Array(n);
    const adjW = new Array(n);
    for (let i = 0; i < n; i++) { adjE[i] = []; adjN[i] = []; adjW[i] = []; }
    for (let e = 0; e < m; e++) {
      const u = eu[e], v = ev[e], w = ew[e];
      adjE[u].push(e); adjN[u].push(v); adjW[u].push(w);
      if (u !== v) {
        adjE[v].push(e); adjN[v].push(u); adjW[v].push(w);
      }
    }
    if (sortAdj) {
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
      neighbours: function (v) { return adjN[v]; },
      neighbourEdges: function (v) { return adjE[v]; },
      neighbourWeights: function (v) { return adjW[v]; },
      possibleEdges: function (sz) {
        let p = directed ? sz * sz : (sz * (sz - 1)) / 2;
        if (correctSelfLoops) p += sz;
        return p;
      },
      // Canonical partition2graph_binary (louvain.cpp:147-211): renumber
      // surviving comms by ORIGINAL-id-ASC; for each comm c, walk every
      // constituent v's adj list, accumulate per-target-comm weights into
      // a sorted map; emit edges. Each non-self pair appears TWICE in
      // the output adj (once from each endpoint's walk) → super-edge
      // weight as stored is total contribution from one side, but the
      // emitted graph stores both directions like graph_binary. For
      // intra (cu==cv): m[c] accumulates 2·intra_c (each intra edge
      // contributes from both u's and v's walks). For inter (cu!=cv):
      // m_at_cu[cv] accumulates inter_{c,c'} from cu-side; m_at_cv[cu]
      // accumulates the same from cv-side, so the new graph has both
      // directions stored correctly.
      collapse: function (membership, ncomm) {
        // Step 1 — comm renumber by original-id-ASC. Mirrors
        // louvain.cpp:147-160.
        const renumber = new Int32Array(ncomm);
        for (let c = 0; c < ncomm; c++) renumber[c] = -1;
        for (let v = 0; v < n; v++) renumber[membership[v]] = 1;
        let last = 0;
        for (let i = 0; i < ncomm; i++) {
          if (renumber[i] !== -1) renumber[i] = last++;
        }
        const nbc = last;
        // Step 2 — comm_nodes[c] = list of constituents.
        const commNodes = new Array(nbc);
        for (let c = 0; c < nbc; c++) commNodes[c] = [];
        const newSizes = new Array(nbc).fill(0);
        for (let v = 0; v < n; v++) {
          const nc = renumber[membership[v]];
          commNodes[nc].push(v);
          newSizes[nc] += nodeSizes[v];
        }
        // Step 3 — for each new comm c, walk constituents' adj; bucket
        // weights by target-new-comm using a sorted map (canonical
        // std::map<int, long double> iteration order = key-ascending).
        // Emit one entry per (c, target) pair.
        const newEdges = [];
        for (let c = 0; c < nbc; c++) {
          // Map<int_target_comm, double_weight_sum> — aggregate first,
          // then iterate in key-ASC order to mirror canonical std::map.
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
          // Iterate bucket in key-ASC order (canonical std::map order).
          const targets = Array.from(bucket.keys()).sort(function (a, b) { return a - b; });
          for (let t = 0; t < targets.length; t++) {
            const tc = targets[t];
            const w = bucket.get(tc);
            newEdges.push([c, tc, w]);
          }
        }
        // Note: each non-self pair (c, tc) appears TWICE in newEdges
        // (once with c=A,tc=B and once with c=B,tc=A) so the new graph
        // builder produces a both-directions adj layout that matches
        // canonical graph_binary. Self-loops appear ONCE per comm with
        // weight = 2·intra_c (canonical's m[c] captures both directions
        // of intra edges).
        return Graph(nbc, newEdges, {
          directed: directed,
          correctSelfLoops: correctSelfLoops,
          nodeSizes: newSizes,
          collapsed: true,  // signal that adj is pre-doubled
          sortAdj: sortAdj, // propagate to collapsed graph
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
              let w_e = ew[e];
              if (from === to && !directed) w_e = w_e / 2;
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

  // ── Modularity admin (canonical Quality + Modularity) ──────────
  // The Partition holds membership + Modularity::in / tot vectors per
  // canonical modularity.h:42-89. remove(v, c, dnc) and insert(v, c, dnc)
  // mutate in[c] / tot[c] exactly as canonical does. neigh_comm(v) fills
  // a per-Partition scratch (neigh_pos / neigh_weight / neigh_last) so
  // sweep can reuse it without reallocation.
  //
  // ┌─────────────────────────────────────────────────────────────────┐
  // │ Two Partition substrates                                        │
  // │                                                                 │
  // │ This LV.Partition is the OLDER substrate, faithful to the       │
  // │ Louvain externals canonical (Blondel 2008, gen-louvain v0.3 —   │
  // │ modularity.h Modularity::in/tot/gain). It uses the              │
  // │ Louvain-Modularity convention:                                  │
  // │                                                                 │
  // │   in[c]  = 2·intra_c + Σ self-loops                             │
  // │   tot[c] = Σ weighted_degree(constituents)                      │
  // │                                                                 │
  // │ neighComm fills neigh_weight[neighbour-comm] for non-self       │
  // │ adj entries only; self-loop weight is folded into modRemove /   │
  // │ modInsert separately via nbSelfLoops(v):                        │
  // │                                                                 │
  // │   modRemove(v, c, dnc):  in[c] -= 2*dnc + nbSelfLoops(v)        │
  // │   modInsert(v, c, dnc):  in[c] += 2*dnc + nbSelfLoops(v)        │
  // │                                                                 │
  // │ Louvain's externals tracer at tools/viz_check/louvain depends   │
  // │ on this convention bit-for-bit; do NOT change it.               │
  // │                                                                 │
  // │ Leiden was added later (libleidenalg 0.12.0; Traag-Waltman-     │
  // │ van Eck 2019). Its canonical (libleidenalg                      │
  // │ MutableVertexPartition.cpp) uses a DIFFERENT convention:        │
  // │                                                                 │
  // │   _total_weight_in_comm[c] = intra_c                            │
  // │       (non-self intra contributes w; self-loop contributes      │
  // │        w/2 for undirected per move_node mode-loop algebra at    │
  // │        line 695)                                                │
  // │   cache_neigh_communities INCLUDES self-loop in                 │
  // │   weight_to_comm[v_comm] (cpp halves the IGRAPH_ALL twice-      │
  // │   listed self-loop entry; net = w; libleidenalg's diff_move     │
  // │   then uses (w_to_old + w_from_old - sw) / (w_to_new +          │
  // │   w_from_new + sw) per CPMVertexPartition.cpp:90-101 +          │
  // │   ModularityVertexPartition.cpp:95-101).                        │
  // │                                                                 │
  // │ The two algebras agree at level 0 (no self-loops in input       │
  // │ graphs) but diverge at level 1+ where collapsed super-nodes     │
  // │ carry intra-comm weight as self-loops. To keep both Louvain     │
  // │ and Leiden tracers byte-equal to their respective canonicals,   │
  // │ we ship two Partition factories:                                │
  // │                                                                 │
  // │   LV.Partition       (this file) — Louvain-shape, used by       │
  // │                                    LV.sweep + LV.run.           │
  // │   COMDET.LEIDEN.Partition         — libleidenalg-shape,         │
  // │                  defined in comdet/js/leiden/leiden.js          │
  // │                  (LeidenPartition factory). Used by Leiden's    │
  // │                  moveNodes + mergeNodesConstrained +            │
  // │                  optimisePartition.                             │
  // │                                                                 │
  // │ See leiden_dossier.md "Two Partition substrates" for the full   │
  // │ algebra divergence table.                                       │
  // └─────────────────────────────────────────────────────────────────┘
  function Partition(graph, init, qualityFn) {
    const n = graph.vcount();
    let membership = new Int32Array(n);
    if (init) for (let i = 0; i < n; i++) membership[i] = init[i] | 0;
    else for (let i = 0; i < n; i++) membership[i] = i;
    let ncomm = 0;
    for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
    // size = number of nodes (canonical Quality::size); equals n.
    const size = n;

    // Canonical Modularity::in[c] = 2·intra_c + Σ self-loops in c.
    // Canonical Modularity::tot[c] = Σ weighted_degree of constituents.
    let inC  = new Float64Array(ncomm);
    let totC = new Float64Array(ncomm);
    let csize = new Float64Array(ncomm);
    let cnodes = new Int32Array(ncomm);
    let totalWeightInAllComms = 0;
    let totalPossibleEdgesInAllComms = 0;
    const empties = [];

    // Per-visit scratch buffers for neigh_comm. neigh_weight is sized
    // to ncomm and lazily reset between calls via the trail in
    // neigh_pos[0..neigh_last]. Mirrors canonical louvain.h:50-52.
    let neighWeight = new Float64Array(ncomm);
    for (let c = 0; c < ncomm; c++) neighWeight[c] = -1;
    const neighPos = new Int32Array(size);
    let neighLast = 0;

    function emptiesAdd(c) { empties.push(c); }
    function emptiesRemove(c) {
      for (let i = empties.length - 1; i >= 0; i--) {
        if (empties[i] === c) { empties.splice(i, 1); return; }
      }
    }

    function rebuildAdmin() {
      ncomm = 0;
      for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
      inC  = new Float64Array(ncomm);
      totC = new Float64Array(ncomm);
      csize = new Float64Array(ncomm);
      cnodes = new Int32Array(ncomm);
      // canonical init (modularity.cpp:46-50): in[i] = nb_selfloops(i),
      // tot[i] = weighted_degree(i) for the SINGLETON case. For non-
      // singleton init we have to play back insert/remove from singleton
      // to target — easier to recompute directly:
      //   in[c] = 2·intra_c + Σ self-loops in c
      //   tot[c] = Σ weighted_degree(v) for v in c
      const m = graph.ecount();
      for (let v = 0; v < n; v++) {
        const c = membership[v];
        csize[c] += graph.nodeSize(v);
        cnodes[c] += 1;
        totC[c] += graph.weightedDegree(v);
      }
      for (let e = 0; e < m; e++) {
        const uv = graph.edge(e);
        const u = uv[0], v = uv[1];
        const w = graph.edgeWeight(e);
        const cu = membership[u], cv = membership[v];
        if (u === v) {
          // Self-loop: contributes nb_selfloops(u) to in[c]. The
          // graph stores it ONCE in adj.
          if (cu === cv) inC[cu] += w;
        } else if (cu === cv) {
          // Non-self intra: each direction in canonical adj would add
          // the dnc that hits this edge once on each side. Mirroring
          // canonical's accumulator: the edge contributes 2w to in[cu]
          // (once when u is inserted into c (dnc carries v's
          // contribution), once when v is inserted (dnc carries u's
          // contribution)).
          inC[cu] += 2 * w;
        }
      }
      totalPossibleEdgesInAllComms = 0;
      totalWeightInAllComms = 0;
      empties.length = 0;
      for (let c = 0; c < ncomm; c++) {
        totalWeightInAllComms += inC[c];
        totalPossibleEdgesInAllComms += graph.possibleEdges(csize[c]);
        if (cnodes[c] === 0) emptiesAdd(c);
      }
      // Resize neigh-comm scratch.
      neighWeight = new Float64Array(ncomm);
      for (let c = 0; c < ncomm; c++) neighWeight[c] = -1;
      neighLast = 0;
    }
    rebuildAdmin();

    // ─────── Canonical neigh_comm (louvain.cpp:78-105) ────────
    // Fills neigh_pos[0..neigh_last] with the distinct neighbour comms
    // of `node`. neigh_pos[0] is ALWAYS vComm with neigh_weight 0; the
    // rest are first-seen non-self nbrs in adj iteration order. Cleans
    // up the previous trail before populating.
    function neighComm(node) {
      // Reset the previous trail.
      for (let i = 0; i < neighLast; i++) neighWeight[neighPos[i]] = -1;
      neighLast = 0;
      // Slot 0 = vComm with weight 0.
      const vComm = membership[node];
      neighPos[0] = vComm;
      neighWeight[vComm] = 0;
      neighLast = 1;
      // Walk node's adj. Self-loops skipped (counted via nb_selfloops in
      // remove/insert, not in dnc).
      const adjN = graph.neighbours(node);
      const adjW = graph.neighbourWeights(node);
      for (let i = 0; i < adjN.length; i++) {
        const neigh = adjN[i];
        if (neigh === node) continue;
        const nc = membership[neigh];
        const nw = adjW[i];
        if (neighWeight[nc] === -1) {
          neighWeight[nc] = 0;
          neighPos[neighLast++] = nc;
        }
        neighWeight[nc] += nw;
      }
    }

    // ─────── Canonical Modularity::remove (modularity.h:60-68) ───
    function modRemove(node, comm, dnc) {
      inC[comm]  -= 2 * dnc + graph.nbSelfLoops(node);
      totC[comm] -= graph.weightedDegree(node);
      // membership stays at `comm` until insert restores it; canonical
      // sets n2c[node] = -1 between remove and insert. Skip the -1
      // marker since JS callers don't observe membership during the
      // gap window.
      cnodes[comm] -= 1;
      csize[comm] -= graph.nodeSize(node);
      totalPossibleEdgesInAllComms -= graph.possibleEdges(csize[comm] + graph.nodeSize(node));
      totalPossibleEdgesInAllComms += graph.possibleEdges(csize[comm]);
      totalWeightInAllComms -= 2 * dnc + graph.nbSelfLoops(node);
      if (cnodes[comm] === 0) emptiesAdd(comm);
    }
    function modInsert(node, comm, dnc) {
      // Fresh comm id — grow admin.
      if (comm >= ncomm) growAdmin(comm + 1);
      inC[comm]  += 2 * dnc + graph.nbSelfLoops(node);
      totC[comm] += graph.weightedDegree(node);
      cnodes[comm] += 1;
      totalPossibleEdgesInAllComms -= graph.possibleEdges(csize[comm]);
      csize[comm] += graph.nodeSize(node);
      totalPossibleEdgesInAllComms += graph.possibleEdges(csize[comm]);
      membership[node] = comm;
      totalWeightInAllComms += 2 * dnc + graph.nbSelfLoops(node);
      emptiesRemove(comm);
    }
    // ─────── Canonical Modularity::gain (modularity.h:80-88) ─────
    function modGain(node, comm, dnc, w_degree) {
      const m2 = graph.totalWeight();
      return dnc - totC[comm] * w_degree / m2;
    }

    function growAdmin(newN) {
      if (newN <= ncomm) return;
      inC = grow(inC, newN);
      totC = grow(totC, newN);
      csize = grow(csize, newN);
      cnodes = grow(cnodes, newN);
      const oldNcomm = ncomm;
      ncomm = newN;
      totalPossibleEdgesInAllComms += graph.possibleEdges(0) * (newN - oldNcomm);
      // Resize + reset neigh-comm scratch tail.
      const newNW = new Float64Array(newN);
      for (let i = 0; i < neighWeight.length; i++) newNW[i] = neighWeight[i];
      for (let i = neighWeight.length; i < newN; i++) newNW[i] = -1;
      neighWeight = newNW;
    }

    function grow(typedArr, newN) {
      const out = (typedArr instanceof Float64Array) ? new Float64Array(newN)
              : (typedArr instanceof Int32Array) ? new Int32Array(newN)
              : new Array(newN).fill(0);
      for (let i = 0; i < typedArr.length; i++) out[i] = typedArr[i];
      return out;
    }

    function getEmptyCommunity() {
      if (empties.length > 0) {
        return empties[empties.length - 1];
      }
      const newId = ncomm;
      growAdmin(newId + 1);
      emptiesAdd(newId);
      return newId;
    }

    // moveNode is a thin wrapper around remove + insert for callers
    // (Leiden) that prefer the high-level "move v to target" verb.
    // Internally: do a neigh_comm scan to find dnc to vComm and dnc
    // to target, then remove + insert. This duplicates the scan
    // sweep already does, so Louvain.sweep does NOT call moveNode —
    // it calls remove + insert directly. moveNode is the legacy
    // surface kept for Leiden's refinement code path.
    function moveNode(v, target) {
      const old = membership[v];
      if (old === target) return;
      neighComm(v);
      const dncOld = neighWeight[old] === -1 ? 0 : neighWeight[old];
      const dncNew = neighWeight[target] === -1 ? 0 : neighWeight[target];
      modRemove(v, old, dncOld);
      modInsert(v, target, dncNew);
    }

    // weightToComm / weightFromComm / getNeighComms: caller-visible
    // accessors that build a full neighbour-cache for v. Used by Leiden
    // diffMove (which needs ΔQ vs target without the remove-then-gain
    // pattern). For Louvain.sweep we use neigh_comm / neigh_weight
    // directly.
    function weightToComm(v, comm) {
      neighComm(v);
      const w = neighWeight[comm];
      return w === -1 ? 0 : w;
    }
    function weightFromComm(v, comm) { return weightToComm(v, comm); }
    function getNeighComms(v) {
      neighComm(v);
      const out = new Array(neighLast);
      for (let i = 0; i < neighLast; i++) out[i] = neighPos[i];
      return out;
    }
    function getNeighCommsConstrained(v, constrained) {
      const adjN = graph.neighbours(v);
      const cv = constrained[v];
      const seen = new Set();
      for (let i = 0; i < adjN.length; i++) {
        const u = adjN[i];
        if (u === v) continue;
        if (constrained[u] !== cv) continue;
        seen.add(membership[u]);
      }
      return Array.from(seen);
    }

    // renumber: canonical partition2graph_binary's renumber by
    // ORIGINAL-id-ASC (louvain.cpp:147-160). Surviving comms get new
    // contiguous ids preserving original-id order.
    function renumber() {
      const remap = new Int32Array(ncomm);
      for (let c = 0; c < ncomm; c++) remap[c] = -1;
      for (let v = 0; v < n; v++) remap[membership[v]] = 1;
      let last = 0;
      const order = [];
      for (let c = 0; c < ncomm; c++) {
        if (remap[c] !== -1) {
          remap[c] = last++;
          order.push(c);
        }
      }
      applyRenumberOrder(remap, order);
    }

    // renumberLeiden: libleidenalg's MutableVertexPartition::
    // renumber_communities() routes to rank_order_communities
    // (MutableVertexPartition.cpp:370-417) which sorts surviving comms
    // via orderCSize (GraphHelper.cpp:16-28): primary csize DESC,
    // secondary cnodes DESC, tertiary original-id ASC. Largest comm
    // becomes new id 0. Differs from Louvain's original-id-ASC
    // convention; Leiden code paths must use this variant so collapsed-
    // graph node ids match cpp's at every level transition.
    function renumberLeiden() {
      const surv = [];
      for (let c = 0; c < ncomm; c++) {
        if (cnodes[c] > 0) surv.push(c);
      }
      surv.sort(function (A, B) {
        if (csize[A] !== csize[B]) return csize[B] - csize[A];
        if (cnodes[A] !== cnodes[B]) return cnodes[B] - cnodes[A];
        return A - B;
      });
      const remap = new Int32Array(ncomm);
      for (let c = 0; c < ncomm; c++) remap[c] = -1;
      for (let i = 0; i < surv.length; i++) remap[surv[i]] = i;
      applyRenumberOrder(remap, surv);
    }

    // Shared admin-rewrite given a remap[old]→new and an order[new]→old
    // (used by both renumber + renumberLeiden).
    function applyRenumberOrder(remap, order) {
      for (let v = 0; v < n; v++) membership[v] = remap[membership[v]];
      const newN = order.length;
      const newIn = new Float64Array(newN);
      const newTot = new Float64Array(newN);
      const newCsize = new Float64Array(newN);
      const newCnodes = new Int32Array(newN);
      for (let i = 0; i < newN; i++) {
        const oldId = order[i];
        newIn[i] = inC[oldId];
        newTot[i] = totC[oldId];
        newCsize[i] = csize[oldId];
        newCnodes[i] = cnodes[oldId];
      }
      inC = newIn; totC = newTot;
      csize = newCsize; cnodes = newCnodes;
      ncomm = newN;
      empties.length = 0;
      neighWeight = new Float64Array(ncomm);
      for (let c = 0; c < ncomm; c++) neighWeight[c] = -1;
      neighLast = 0;
    }

    // ─── Public surface ────────────────────────────────────
    return {
      graph: graph,
      membership: function () { return membership; },
      memberOf: function (v) { return membership[v]; },
      n: function () { return n; },
      ncomm: function () { return ncomm; },
      csize: function (c) { return c < ncomm ? csize[c] : 0; },
      cnodes: function (c) { return c < ncomm ? cnodes[c] : 0; },
      // in[c] / tot[c] are canonical Modularity admin. The legacy
      // names totalWeightInComm / totalWeightToComm / totalWeightFromComm
      // are kept as aliases so Leiden + page glue keep working.
      totalWeightInComm:    function (c) { return c < ncomm ? inC[c] : 0; },
      totalWeightToComm:    function (c) { return c < ncomm ? totC[c] : 0; },
      totalWeightFromComm:  function (c) { return c < ncomm ? totC[c] : 0; },
      totalWeightInAllComms: function () { return totalWeightInAllComms; },
      totalPossibleEdgesInAllComms: function () { return totalPossibleEdgesInAllComms; },
      moveNode: moveNode,
      renumberLeiden: renumberLeiden,
      // Canonical sweep primitives — exposed so the outer driver does
      // remove/gain/insert per the canonical body.
      neighComm: neighComm,
      neighWeight: function (c) {
        const w = neighWeight[c];
        return w === -1 ? 0 : w;
      },
      neighPos: function (i) { return neighPos[i]; },
      neighLast: function () { return neighLast; },
      modRemove: modRemove,
      modInsert: modInsert,
      modGain: modGain,
      // Legacy accessors — keep Leiden + page diffMove paths alive.
      weightToComm: weightToComm,
      weightFromComm: weightFromComm,
      getNeighComms: getNeighComms,
      getNeighCommsConstrained: getNeighCommsConstrained,
      getEmptyCommunity: getEmptyCommunity,
      renumber: renumber,
      rebuildAdmin: rebuildAdmin,
      diffMove: function (v, target) { return qualityFn.diffMove(this, v, target); },
      quality: function () { return qualityFn.quality(this); },
      qualityFn: qualityFn,
      setMembership: function (m) {
        for (let i = 0; i < n; i++) membership[i] = m[i] | 0;
        rebuildAdmin();
      },
      fromCoarsePartition: function (coarse, mapping) {
        for (let v = 0; v < n; v++) membership[v] = coarse[mapping[v]];
        rebuildAdmin();
      },
    };
  }

  // ── Modularity quality function ─────────────────────────────────
  // Mirrors libleidenalg ModularityVertexPartition byte-for-byte
  // (ModularityVertexPartition.cpp:35-120 diff_move +
  //  ModularityVertexPartition.cpp:129-162 quality):
  //   total_weight = graph.total_weight() * (2 - directed)
  //   diff_old = (w_to_old - k_out*K_in_old/tw) + (w_from_old - k_in*K_out_old/tw)
  //   diff_new = (w_to_new + sw - k_out*K_in_new/tw) + (w_from_new + sw - k_in*K_out_new/tw)
  //   m = directed ? graph.total_weight() : 2*graph.total_weight()
  //   return (diff_new - diff_old) / m
  //
  // JS Graph.totalWeight() returns Σ weighted_degree = 2*m_cpp for
  // undirected (where m_cpp = libleidenalg Graph::total_weight() = Σ
  // edge weights). Halve to recover m_cpp.
  //
  // Used only via Partition.diffMove path (Leiden's moveNodes /
  // mergeNodesConstrained route here when LEIDEN.Modularity is the
  // qualityFn). Louvain's sweep uses modGain (Modularity::gain after
  // remove) directly and is unaffected.
  //
  // The Modularity.totalWeightInComm convention requires explanation:
  // Partition.rebuildAdmin stores inC[c] = 2*intra_c + Σ self-loops
  // (Louvain Modularity::in convention; lines 388/380). cpp libleidenalg
  // stores _total_weight_in_comm[c] = intra_c + (self-loops contribute
  // w/2 per move_node:695). On collapsed graphs both end up effectively
  // = intra_c + self-loop weight via different per-edge accumulators.
  // For top-level (no self-loops), JS inC = 2*intra_c, cpp = intra_c —
  // halve to bridge in the quality sum.
  function Modularity() {
    return {
      name: "Modularity",
      resolution: 1.0,
      diffMove: function (P, v, newComm) {
        const oldComm = P.memberOf(v);
        if (oldComm === newComm) return 0;
        const G = P.graph;
        const m_orig = G.totalWeight() / 2;            // = m_cpp
        if (m_orig <= 0) return 0;
        const directed = G.isDirected();
        const total_weight = m_orig * (2.0 - (directed ? 1 : 0));
        const wToOld = P.weightToComm(v, oldComm);
        const wFromOld = P.weightFromComm(v, oldComm);
        const wToNew = P.weightToComm(v, newComm);
        const wFromNew = P.weightFromComm(v, newComm);
        const k_out = G.weightedDegree(v);
        const k_in = directed ? G.weightedDegree(v) : k_out;
        const sw = G.nodeSelfWeight(v);
        const K_out_old = P.totalWeightFromComm(oldComm);
        const K_in_old  = P.totalWeightToComm(oldComm);
        const K_out_new = P.totalWeightFromComm(newComm) + k_out;
        const K_in_new  = P.totalWeightToComm(newComm) + k_in;
        const diff_old = (wToOld - k_out * K_in_old / total_weight)
                       + (wFromOld - k_in * K_out_old / total_weight);
        const diff_new = (wToNew + sw - k_out * K_in_new / total_weight)
                       + (wFromNew + sw - k_in * K_out_new / total_weight);
        const diff = diff_new - diff_old;
        const m = directed ? m_orig : 2.0 * m_orig;
        return diff / m;
      },
      quality: function (P) {
        const G = P.graph;
        const m_orig = G.totalWeight() / 2;
        if (m_orig <= 0) return 0;
        const directed = G.isDirected();
        const m = directed ? m_orig : 2.0 * m_orig;
        let mod = 0;
        for (let c = 0; c < P.ncomm(); c++) {
          // inC convention bridge: see header comment.
          const w = P.totalWeightInComm(c) / 2;
          const w_out = P.totalWeightFromComm(c);
          const w_in = P.totalWeightToComm(c);
          mod += w - w_out * w_in / ((directed ? 1.0 : 4.0) * m_orig);
        }
        const q = (2.0 - (directed ? 1 : 0)) * mod;
        return q / m;
      },
    };
  }

  // ── Louvain sweep (canonical louvain.cpp:213-280 one_level body) ─
  // For each node in shuffled order: neigh_comm fills the trail
  // including vComm at slot 0; remove(v from vComm); pick best gain
  // by strict `> best_increase` over neigh_pos[0..neigh_last); insert
  // into best_comm.
  function sweep(P, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const n = P.n();
    const order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    if (opts.visitOrder) {
      for (let i = 0; i < n; i++) order[i] = opts.visitOrder[i];
    } else {
      shuffle(order, rng);
    }
    let nbMoves = 0;
    let totalImprov = 0;
    const traces = [];
    for (let i = 0; i < n; i++) {
      const v = order[i];
      const vComm = P.memberOf(v);
      const wDeg = P.graph.weightedDegree(v);
      // neigh_comm sets neigh_pos[0]=vComm, weight 0; rest = first-seen
      // distinct neighbour comms.
      P.neighComm(v);
      const neighLast = P.neighLast();
      // Canonical remove(v, vComm, neigh_weight[vComm]). neigh_comm
      // initialised neigh_weight[vComm] to 0 + accumulated the weights
      // from v to non-self neighbours that are CURRENTLY in vComm — at
      // singleton init that's 0, but inside a sweep where prior visits
      // have moved nodes into vComm it's strictly positive.
      P.modRemove(v, vComm, P.neighWeight(vComm));
      let bestComm = vComm;
      // Mirror canonical louvain.cpp:253-263: best_nblinks starts at 0
      // and only updates alongside best_comm when a candidate beats
      // best_increase. When no candidate yields strict-positive gain the
      // pair (best_comm = vComm, best_nblinks = 0) is what gets passed
      // into insert.
      let bestNblinks = 0;
      let bestIncrease = 0;
      const deltas = [];
      for (let j = 0; j < neighLast; j++) {
        const c = P.neighPos(j);
        const dnc = P.neighWeight(c);
        const inc = P.modGain(v, c, dnc, wDeg);
        if (recordTrace) deltas.push({ comm: c, delta: inc });
        if (inc > bestIncrease) {
          bestIncrease = inc;
          bestComm = c;
          bestNblinks = dnc;
        }
      }
      P.modInsert(v, bestComm, bestNblinks);
      const moved = bestComm !== vComm;
      if (moved) {
        nbMoves += 1;
        totalImprov += bestIncrease;
      }
      if (recordTrace) {
        traces.push({
          v: v, fromComm: vComm, toComm: bestComm,
          moved: moved,
          // Canonical gain returned in unnormalized units (gain * m2);
          // expose as ΔQ-in-Q-units (gain / m2) so trace consumers see
          // a small float, matching prior page wiring.
          delta: moved ? (bestIncrease / P.graph.totalWeight()) : 0,
          // delta_gain holds the raw gain value (unnormalized) for
          // consumers that need the canonical bit-equal compare.
          deltaGain: moved ? bestIncrease : 0,
          candidates: deltas,
        });
      }
    }
    return { totalImprov: totalImprov, nbMoves: nbMoves, traces: traces };
  }

  function phase1(graph, qualityFn, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const P = Partition(graph, null, qualityFn);
    const sweeps = [];
    // Canonical louvain.cpp:221-229: random_order is computed ONCE per
    // level, shuffled in place, then reused for every pass in the
    // do/while. JS mirrors that — shuffle once, inject the same
    // visitOrder into every sweep call.
    const n = P.n();
    const visitOrder = new Array(n);
    for (let i = 0; i < n; i++) visitOrder[i] = i;
    if (opts.visitOrder) {
      for (let i = 0; i < n; i++) visitOrder[i] = opts.visitOrder[i];
    } else {
      shuffle(visitOrder, rng);
    }
    let pass = 0;
    let curQ = qualityFn.quality(P);
    while (true) {
      const before = curQ;
      const out = sweep(P, rng, { recordTrace: recordTrace, visitOrder: visitOrder });
      const after = qualityFn.quality(P);
      sweeps.push(out);
      pass += 1;
      if (out.nbMoves === 0 || (after - before) <= 1e-6 || pass > 50) break;
      curQ = after;
    }
    return { partition: P, sweeps: sweeps };
  }

  // run: outer level loop. partition2graph_binary already happens inside
  // Graph.collapse with renumber-by-original-id-ASC.
  function run(graph, qualityFn, seed, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const rng = MT19937(seed >>> 0);
    const levels = [];
    let collapsedG = graph;
    let aggregateMap = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) aggregateMap[i] = i;
    let fineMembership = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) fineMembership[i] = i;
    let level = 0;
    while (true) {
      const prevVcount = collapsedG.vcount();
      const p1 = phase1(collapsedG, qualityFn, rng, { recordTrace: recordTrace });
      const collP = p1.partition;
      // Renumber by original-id-ASC (canonical partition2graph_binary
      // step 1) before composing fineMembership + collapsing.
      collP.renumber();
      const memColl = collP.membership();
      for (let v = 0; v < graph.vcount(); v++) {
        fineMembership[v] = memColl[aggregateMap[v]];
      }
      const collapsedNcomm = collP.ncomm();
      const newCollapsed = collapsedG.collapse(memColl, collapsedNcomm);
      const newAggregate = new Int32Array(graph.vcount());
      for (let v = 0; v < graph.vcount(); v++) {
        newAggregate[v] = memColl[aggregateMap[v]];
      }
      aggregateMap = newAggregate;
      levels.push({
        level: level,
        sweeps: p1.sweeps,
        collapsedVcountBefore: prevVcount,
        collapsedNcomm: collapsedNcomm,
        finePost: new Int32Array(fineMembership),
        newCollapsedVcount: newCollapsed.vcount(),
      });
      if (newCollapsed.vcount() >= prevVcount || newCollapsed.vcount() <= 1) break;
      collapsedG = newCollapsed;
      level += 1;
      if (level > 30) break;
    }
    const P = Partition(graph, fineMembership, qualityFn);
    P.renumber();
    return { partition: P, levels: levels, quality: P.quality() };
  }

  window.COMDET.LOUVAIN = {
    MT19937: MT19937,
    shuffle: shuffle,
    range: range,
    Graph: Graph,
    Partition: Partition,
    Modularity: Modularity,
    sweep: sweep,
    run: run,
  };
})();
