/* Leiden kernel — extends Louvain (js/louvain/louvain.js) with the
 * three pieces that distinguish Leiden from Louvain (Traag, Waltman +
 * van Eck 2019, libleidenalg 0.12.0):
 *
 *   1. CPM quality function (constant Potts model — eq. 2).
 *   2. moveNodes: fast-local-move with a FIFO queue + neighbour
 *      restabilisation (paper §"fast local move procedure").
 *   3. mergeNodesConstrained: refinement phase — re-partition each
 *      community in isolation from singletons, accepting any
 *      ΔH ≥ 0 within the constrained-membership filter.
 *   4. optimisePartition: outer driver — move + refine + aggregate,
 *      with the two-headed bookkeeping that labels each super-node
 *      by its pre-refinement community while collapsing on the
 *      refined sub-partition.
 *
 * Graph + MT19937 primitives come from COMDET.COMMON (js/common/common.js,
 * 2026-05-10 cross-algo isolation refactor). Before the refactor these
 * lived under COMDET.LOUVAIN and Leiden re-exported them onto
 * COMDET.LEIDEN; the re-export bridge is gone. Pages + harnesses that
 * previously read C.LEIDEN.Graph or C.LEIDEN.MT19937 now read
 * C.COMMON.Graph / C.COMMON.MT19937.
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.COMMON) {
    console.warn("[leiden] COMDET.COMMON missing; load common/common.js first");
    return;
  }
  const CC = window.COMDET.COMMON;

  // [TRACE-LD-MV] / [TRACE-LD-CAND] / [TRACE-LD-CACHE] probe gate.
  // Off in browser (window.LEIDEN_DUMP_PROBES undefined) so the production
  // walker emits nothing. Tracer harnesses set globalThis.LEIDEN_DUMP_PROBES
  // = true before importing leiden.js to enable per-cand + per-move admin +
  // per-cache-edge emissions that mirror the cpp instrumented fork
  // (community-detection/tools/viz_check/leiden/instrumented/
  // mutable_vertex_partition_traced.cpp + optimiser_traced.cpp).
  // Bit-exact hex emission via Float64 view so probes diff byte-for-byte
  // vs cpp's `_ld_mv_emit_hex` / `_ld_emit_hex`.
  const _ldProbeBuf = new Float64Array(1);
  const _ldProbeView = new BigUint64Array(_ldProbeBuf.buffer);
  function _ldHex(x) {
    _ldProbeBuf[0] = x;
    return _ldProbeView[0].toString(16).padStart(16, "0");
  }
  function _ldProbesEnabled() {
    return (typeof globalThis !== "undefined")
        && globalThis.LEIDEN_DUMP_PROBES === true;
  }
  // Tracer-visible pass counter. Mirrors cpp's `gTrace.passes.size() - 1`
  // which grows monotonically across move + refine passes at every level.
  // optimisePartition resets to 0; moveNodes/mergeNodesConstrained increment
  // on entry and stamp every per-candidate emission.
  let _ldPassIdx = 0;

  // Leiden-local Fisher-Yates shuffle that uses rng.intLemire (igraph's
  // Lemire-debiased bounded-int) so the JS production walker's RNG draw
  // sequence bit-equals libleidenalg under matching seed. LV.shuffle
  // uses rng.int (textbook rejection) which does NOT match igraph's
  // get_random_int; Louvain externals's tracer relies on the textbook
  // path so that side stays unchanged.
  function leidenShuffle(arr, rng, siteTag) {
    const _probe = _ldProbesEnabled();
    for (let idx = arr.length - 1; idx >= 1; idx--) {
      const j = rng.intLemire(0, idx);
      // [TRACE-LD-SHUFFLE] Mirrors cpp `_ld_traced_shuffle` in
      // optimiser_traced.cpp. Per-step `(idx, range, rand_idx)` tuple
      // closes P0 #10 (GraphHelper.cpp:37 get_random_int return) and
      // gives a per-call cross-check anchor for the Lemire mapping
      // (P0 #11; inner igraph_i_rng_get_uint32_bounded scalars unclosed
      // because libigraph is vendored upstream).
      if (_probe) {
        console.error(
          `[TRACE-LD-SHUFFLE] site=${siteTag || "?"} idx=${idx} range=${idx + 1} rand_idx=${j}`);
      }
      const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    }
  }
  // [TRACE-LD-LEMIRE] Per-Lemire-call probe wrapper. Closes P0 #11
  // (random.c:428-439 Lemire mapping). Walks the same algorithm as
  // common.js `intLemire` but emits every `(range, x, m, lo, threshold,
  // accept)` tuple per draw. NOT used by the production walker (it would
  // perturb the RNG stream); enabled only by tracer harnesses that set
  // LEIDEN_DUMP_LEMIRE=true and replace the rng.intLemire on a clone.
  // Off by default. Kept here for closure-completeness; cpp side cannot
  // mirror without editing vendored igraph, so cpp emits (range, return)
  // at the call-site via [TRACE-LD-SHUFFLE].
  function _ldLemireTrace(next, lo, hi) {
    if (hi === lo) {
      if (_ldProbesEnabled()) {
        console.error(`[TRACE-LD-LEMIRE] range=1 accept=1 result=${lo}`);
      }
      return lo;
    }
    const range = hi - lo + 1;
    if (range <= 0) return lo;
    const r64 = BigInt(range);
    const t = (1n << 32n) % r64;
    let m, l, x;
    let _attempt = 0;
    do {
      x = BigInt(next());
      m = x * r64;
      l = m & 0xffffffffn;
      if (_ldProbesEnabled()) {
        const accept = (l >= t) ? 1 : 0;
        console.error(
          `[TRACE-LD-LEMIRE] range=${range} attempt=${_attempt} x=${x.toString(16).padStart(8, "0")}`
          + ` m_hi=${(m >> 32n).toString(16).padStart(8, "0")}`
          + ` lo=${l.toString(16).padStart(8, "0")}`
          + ` threshold=${t.toString(16).padStart(8, "0")}`
          + ` accept=${accept}`);
      }
      _attempt++;
    } while (l < t);
    return lo + Number(m >> 32n);
  }

  // ── LeidenPartition: libleidenalg-shape Partition admin ──────────
  //
  // ┌────────────────────────────────────────────────────────────────┐
  // │ Why a second Partition factory?                                │
  // │                                                                │
  // │ Louvain came first (Blondel 2008; gen-louvain). The JS port    │
  // │ at comdet/js/louvain/louvain.js mirrors that canonical's       │
  // │ Modularity::in / Modularity::tot admin convention. Its         │
  // │ externals tracer at community-detection/tools/viz_check/       │
  // │ louvain depends on that convention bit-for-bit (54 × 9 cells   │
  // │ PASS, 3.49M visits, 0 mismatches).                             │
  // │                                                                │
  // │ Leiden (Traag-Waltman-van Eck 2019, libleidenalg 0.12.0)       │
  // │ came LATER. Its canonical uses a different admin algebra. To   │
  // │ keep BOTH tracers byte-equal to their respective canonicals,   │
  // │ Leiden ships its own Partition substrate. LeidenPartition is   │
  // │ defined HERE (in leiden.js) so the older louvain.js stays      │
  // │ unchanged for Louvain's externals tracer.                      │
  // └────────────────────────────────────────────────────────────────┘
  //
  // Algebra divergence table (LV.Partition  ←→  LeidenPartition):
  //
  // ┌──────────────────────────┬──────────────────────────┬──────────┐
  // │ Field                    │ LV.Partition (Louvain    │ LeidenP. │
  // │                          │  externals canonical)    │ (libld)  │
  // ├──────────────────────────┼──────────────────────────┼──────────┤
  // │ in[c] (intra-comm wt)    │ 2·intra_c + Σ selfloop  │ intra_c  │
  // ├──────────────────────────┼──────────────────────────┼──────────┤
  // │ neighComm self-loop      │ SKIPS (`if (u===v)       │ INCLUDES │
  // │                          │ continue`); accounted    │ in vComm │
  // │                          │ via nbSelfLoops(v) in    │ slot     │
  // │                          │ modRemove / modInsert    │          │
  // ├──────────────────────────┼──────────────────────────┼──────────┤
  // │ Move-node admin update   │ modRemove + modInsert:   │ Per-edge │
  // │                          │   in[c] ±= 2*dnc +       │ folded   │
  // │                          │           nbSelfLoops(v) │ mode loop│
  // │                          │                          │ with     │
  // │                          │                          │ int_wt = │
  // │                          │                          │ w/(2-dir)│
  // │                          │                          │ /(u==v?  │
  // │                          │                          │ 2 : 1)   │
  // ├──────────────────────────┼──────────────────────────┼──────────┤
  // │ renumber tiebreak        │ original-id ASC          │ csize    │
  // │                          │ (louvain.cpp:147-160)    │ DESC,    │
  // │                          │                          │ cnodes   │
  // │                          │                          │ DESC,    │
  // │                          │                          │ id ASC   │
  // │                          │                          │ (rank_   │
  // │                          │                          │  order)  │
  // ├──────────────────────────┼──────────────────────────┼──────────┤
  // │ Diff-move pattern        │ Modularity::gain after   │ Direct   │
  // │                          │ modRemove (Louvain       │ diff_old │
  // │                          │ post-remove form)        │ - diff_  │
  // │                          │                          │ new with │
  // │                          │                          │ +sw      │
  // │                          │                          │ explicit │
  // │                          │                          │ (cpp     │
  // │                          │                          │ pre-move │
  // │                          │                          │ form)    │
  // └──────────────────────────┴──────────────────────────┴──────────┘
  //
  // The two algebras AGREE at level 0 (input graphs have no self-loops
  // by construction in this codebase; if they did, the Graph
  // constructor still treats self-loops as a single adj entry +
  // single nbSelfLoops contribution, so both shapes encode the same
  // intra weight at the leaf level). They DIVERGE at level 1+: the
  // collapsed super-graph stores per-comm intra weight as super-node
  // self-loops, and Leiden's diff_move + quality formulas need
  // libleidenalg's `_total_weight_in_comm = intra_c` semantics to
  // reproduce cpp's per-visit dQ bit-for-bit.
  //
  // Source citations (cpp libleidenalg):
  //   move_node              MutableVertexPartition.cpp:540-736
  //   cache_neigh_communities                          :799-867
  //   rank_order_communities                           :370-417
  //   add_empty_community                              :508-532
  //   CPM diff_move          CPMVertexPartition.cpp:41-120
  //   Modularity diff_move   ModularityVertexPartition.cpp:35-120
  //
  // Used internally by Leiden moveNodes, mergeNodesConstrained,
  // optimisePartition. Exposed as COMDET.LEIDEN.Partition for browser
  // pages + tracer harnesses (kernel_check.mjs, self_rng_check.mjs).
  function LeidenPartition(graph, init, qualityFn) {
    const n = graph.vcount();
    const directed = graph.isDirected();
    let membership = new Int32Array(n);
    if (init) for (let i = 0; i < n; i++) membership[i] = init[i] | 0;
    else for (let i = 0; i < n; i++) membership[i] = i;
    let ncomm = 0;
    for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
    const size = n;

    let inC      = new Float64Array(ncomm);   // _total_weight_in_comm[c] = intra_c
    let totFromC = new Float64Array(ncomm);   // _total_weight_from_comm[c]
    let totToC   = new Float64Array(ncomm);   // _total_weight_to_comm[c]
    let csize    = new Float64Array(ncomm);
    let cnodes   = new Int32Array(ncomm);
    let totalWeightInAllComms = 0;
    let totalPossibleEdgesInAllComms = 0;
    const empties = [];

    // Per-visit cache for neighComm.
    let cachedWeight = new Float64Array(ncomm);
    for (let c = 0; c < ncomm; c++) cachedWeight[c] = -1;
    const neighPos = new Int32Array(size);
    let neighLast = 0;

    function emptiesAdd(c) { empties.push(c); }
    function emptiesRemove(c) {
      for (let i = empties.length - 1; i >= 0; i--) {
        if (empties[i] === c) { empties.splice(i, 1); return; }
      }
    }
    // [TRACE-LD-EMPTY] cpp empties-list probes are inlined at the call
    // sites in moveNode (ADD before push_back, ERASE_PRE before erase,
    // ERASE_POST after erase). Closes P0 #8 — LIFO order critical for
    // byte-equality. Mirrors cpp mutable_vertex_partition_traced.cpp
    // move_node empty-add + empty-erase sites.

    function rebuildAdmin() {
      ncomm = 0;
      for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
      inC      = new Float64Array(ncomm);
      totFromC = new Float64Array(ncomm);
      totToC   = new Float64Array(ncomm);
      csize    = new Float64Array(ncomm);
      cnodes   = new Int32Array(ncomm);
      const m = graph.ecount();
      // First pass: csize + cnodes from per-node loop (cpp init_admin
      // lines 161-168).
      for (let v = 0; v < n; v++) {
        const c = membership[v];
        csize[c]  += graph.nodeSize(v);
        cnodes[c] += 1;
      }
      // Second pass: totFromC, totToC, inC from per-edge loop. Order
      // matters for IEEE-754 rounding (cpp init_admin line 171-211).
      // For each edge (u, v, w):
      //   totFromC[u_comm] += w; totToC[v_comm] += w;
      //   undirected mirror: totFromC[v_comm] += w; totToC[u_comm] += w;
      //   intra (u_comm == v_comm): inC[u_comm] += w (FULL w even for
      //                              self-loop — cpp's init_admin
      //                              semantics; differs from move_node
      //                              mode-loop's w/2-per-self-loop net).
      for (let e = 0; e < m; e++) {
        const uv = graph.edge(e);
        const u = uv[0], vv = uv[1];
        const w = graph.edgeWeight(e);
        const cu = membership[u], cv = membership[vv];
        totFromC[cu] += w;
        totToC[cv]   += w;
        if (!directed) {
          totFromC[cv] += w;
          totToC[cu]   += w;
        }
        if (cu === cv) inC[cu] += w;
      }
      totalWeightInAllComms = 0;
      totalPossibleEdgesInAllComms = 0;
      empties.length = 0;
      for (let c = 0; c < ncomm; c++) {
        totalWeightInAllComms += inC[c];
        totalPossibleEdgesInAllComms += graph.possibleEdges(csize[c]);
        if (cnodes[c] === 0) emptiesAdd(c);
      }
      cachedWeight = new Float64Array(ncomm);
      for (let c = 0; c < ncomm; c++) cachedWeight[c] = -1;
      neighLast = 0;
    }
    rebuildAdmin();

    // libleidenalg cache_neigh_communities. JS adj stores self-loop
    // ONCE with full weight; cpp's IGRAPH_ALL stores self-loop TWICE
    // and halves each iteration. Both yield net w to
    // weight_to_comm[v_comm] for self-loop intra. Iterate once with
    // full weight per entry.
    function neighComm(v) {
      for (let i = 0; i < neighLast; i++) cachedWeight[neighPos[i]] = -1;
      neighLast = 0;
      const vComm = membership[v];
      neighPos[0] = vComm;
      cachedWeight[vComm] = 0;
      neighLast = 1;
      const adjN = graph.neighbours(v);
      const adjW = graph.neighbourWeights(v);
      // [TRACE-LD-CACHE] Mirrors cpp cache_neigh_communities (Mutable
      // VertexPartition.cpp:799-867). cpp uses mode=IGRAPH_ALL on
      // undirected graphs (line 988-990 short-circuit); JS port walks
      // adj once with full self-loop weight so encoded `mode=3` (ALL).
      // Probe emission walks the same iteration order as cpp.
      const _probe = _ldProbesEnabled();
      if (_probe) {
        console.error(`[TRACE-LD-CACHE] BEGIN v=${v} mode=3 degree=${adjN.length}`);
      }
      for (let i = 0; i < adjN.length; i++) {
        const u = adjN[i];
        const w = adjW[i];
        const c = membership[u];
        if (_probe) {
          // cpp halves self-loop under IGRAPH_ALL/LOOPS_TWICE (cpp:851-852);
          // JS adj has self-loop once with full weight, NO halving — net
          // contribution matches cpp. Probe self_halved=0 always (JS-side
          // convention) but emit pre/post bracketed exactly the same.
          const pre = cachedWeight[c] === -1 ? 0 : cachedWeight[c];
          const post = pre + w;
          console.error(
            `[TRACE-LD-CACHE] EDGE v=${v} idx=${i} u=${u} e=- comm=${c}`
            + ` w=${_ldHex(w)} self_halved=0 pre=${_ldHex(pre)} post=${_ldHex(post)}`);
        }
        if (cachedWeight[c] === -1) {
          cachedWeight[c] = 0;
          neighPos[neighLast++] = c;
        }
        cachedWeight[c] += w;
      }
      if (_probe) {
        console.error(`[TRACE-LD-CACHE] END v=${v} mode=3 ncached=${neighLast}`);
      }
    }

    function growArr(arr, newN) {
      const out = (arr instanceof Float64Array) ? new Float64Array(newN)
              : (arr instanceof Int32Array) ? new Int32Array(newN)
              : new Array(newN).fill(0);
      for (let i = 0; i < arr.length; i++) out[i] = arr[i];
      return out;
    }

    function growAdmin(newN) {
      if (newN <= ncomm) return;
      inC      = growArr(inC, newN);
      totFromC = growArr(totFromC, newN);
      totToC   = growArr(totToC, newN);
      csize    = growArr(csize, newN);
      cnodes   = growArr(cnodes, newN);
      const oldNcomm = ncomm;
      ncomm = newN;
      totalPossibleEdgesInAllComms += graph.possibleEdges(0) * (newN - oldNcomm);
      const newCW = new Float64Array(newN);
      for (let i = 0; i < cachedWeight.length; i++) newCW[i] = cachedWeight[i];
      for (let i = cachedWeight.length; i < newN; i++) newCW[i] = -1;
      cachedWeight = newCW;
    }

    function getEmptyCommunity() {
      if (empties.length > 0) return empties[empties.length - 1];
      // [TRACE-LD-ADDEMPTY] Mirrors cpp add_empty_community probe at
      // mutable_vertex_partition_traced.cpp:540. Emits (n_before, new_comm,
      // n_after, empties_size) so cpp ↔ JS branch parity is byte-exact.
      const _nb = ncomm;
      const newId = ncomm;
      growAdmin(newId + 1);
      emptiesAdd(newId);
      if (_ldProbesEnabled()) {
        console.error(
          `[TRACE-LD-ADDEMPTY] n_before=${_nb} new_comm=${newId}`
          + ` n_after=${ncomm} empties_size=${empties.length}`);
      }
      return newId;
    }

    // libleidenalg MutableVertexPartition::move_node (lines 540-736).
    // Per-edge folded mode loop: each adj entry contributes once.
    function moveNode(v, newComm) {
      const oldComm = membership[v];
      if (oldComm === newComm) return;
      if (newComm >= ncomm) {
        while (newComm >= ncomm) {
          growAdmin(ncomm + 1);
          emptiesAdd(ncomm - 1);
        }
      }
      const node_size = graph.nodeSize(v);
      const _probe = _ldProbesEnabled();
      // [TRACE-LD-MV] ENTRY: mirrors cpp's pre-update admin snapshot
      // (MutableVertexPartition.cpp:584-600). Field shape + order mirrors
      // the cpp `_ld_mv_emit_hex` block in
      // mutable_vertex_partition_traced.cpp move_node ENTRY probe.
      if (_probe) {
        console.error(
          `[TRACE-LD-MV] ENTRY v=${v} old=${oldComm} new=${newComm}`
          + ` nsize=${_ldHex(node_size)}`
          + ` csize_old=${_ldHex(csize[oldComm])}`
          + ` csize_new=${_ldHex(csize[newComm])}`
          + ` cnodes_old=${cnodes[oldComm]} cnodes_new=${cnodes[newComm]}`
          + ` tw_in_old=${_ldHex(inC[oldComm])}`
          + ` tw_in_new=${_ldHex(inC[newComm])}`
          + ` tw_from_old=${_ldHex(totFromC[oldComm])}`
          + ` tw_from_new=${_ldHex(totFromC[newComm])}`
          + ` tw_to_old=${_ldHex(totToC[oldComm])}`
          + ` tw_to_new=${_ldHex(totToC[newComm])}`
          + ` tw_all=${_ldHex(totalWeightInAllComms)}`
          + ` tpe_all=${_ldHex(totalPossibleEdgesInAllComms)}`
          + ` directed=${directed ? 1 : 0}`);
      }
      // Possible-edges delta (line 572). Pre-csize-update.
      const dirFactor = directed ? 1 : 2;
      const delta_pe = 2.0 * node_size * (csize[newComm] - csize[oldComm] + node_size) / dirFactor;
      // [TRACE-LD-MV] DELTA_PE: mirror cpp:572 analytic formula. Probe
      // emits BEFORE the += to keep symmetry with cpp probe order.
      if (_probe) {
        console.error(`[TRACE-LD-MV] DELTA_PE v=${v} delta_pe=${_ldHex(delta_pe)}`);
      }
      totalPossibleEdgesInAllComms += delta_pe;
      // Remove from old + maybe push to empties (lines 583-601).
      cnodes[oldComm] -= 1;
      csize[oldComm]  -= node_size;
      if (cnodes[oldComm] === 0) {
        // cpp probe emits "ADD" with pre_size/pre_list BEFORE push_back.
        if (_ldProbesEnabled()) {
          console.error(
            `[TRACE-LD-EMPTY] ADD v=${v} c=${oldComm} pre_size=${empties.length} pre_list=${empties.join(",")}`);
        }
        emptiesAdd(oldComm);
      }
      // Add to new (if was empty, remove from empties via reverse-iter).
      if (cnodes[newComm] === 0) {
        if (_ldProbesEnabled()) {
          console.error(
            `[TRACE-LD-EMPTY] ERASE_PRE v=${v} c=${newComm} pre_size=${empties.length} pre_list=${empties.join(",")}`);
        }
        emptiesRemove(newComm);
        if (_ldProbesEnabled()) {
          console.error(
            `[TRACE-LD-EMPTY] ERASE_POST v=${v} c=${newComm} post_size=${empties.length} post_list=${empties.join(",")}`);
        }
      }
      cnodes[newComm] += 1;
      csize[newComm]  += node_size;
      // Per cpp move_node mode loop (lines 638-722): runs IGRAPH_OUT +
      // IGRAPH_IN, each iteration applies int_weight = w/(2-directed)/
      // (u==v ? 2 : 1). Two passes are NOT equivalent to a single pass
      // with summed int_weight at IEEE-754 precision: `inC[c] -= w/2;
      // inC[c] -= w/2` and `inC[c] -= w` differ by sub-ulp, and that
      // difference accumulates across moves into a per-visit dQ bit-
      // mismatch. Mirror cpp's two-pass shape exactly.
      //
      // Pass 0 = OUT mode: updates totFromC[old/new] per-edge.
      // Pass 1 = IN mode:  updates totToC[old/new] per-edge.
      // Both passes apply the int_weight contribution to inC + tw_all.
      const adjN = graph.neighbours(v);
      const adjW = graph.neighbourWeights(v);
      const passes = directed ? 1 : 2;
      for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < adjN.length; i++) {
          const u = adjN[i];
          const w = adjW[i];
          const u_comm = membership[u];
          // cpp's get_neighbour_edges(v, IGRAPH_OUT/IN) under undirected
          // routes to IGRAPH_ALL with default IGRAPH_LOOPS_TWICE — every
          // self-loop appears TWICE per mode iteration (libleidenalg
          // GraphHelper.cpp:294). JS adj stores self-loops ONCE. Mirror
          // cpp by applying the per-edge contribution twice when u===v.
          const reps = (!directed && u === v) ? 2 : 1;
          for (let r = 0; r < reps; r++) {
            // [TRACE-LD-MV] EDGE: mirror cpp's per-edge probe. cpp encodes
            // mode as igraph_neimode_t (IGRAPH_OUT=1, IGRAPH_IN=2,
            // IGRAPH_ALL=3); pass=0 ↔ OUT, pass=1 ↔ IN. Probe fires
            // AFTER from/to update (matching cpp's probe point) and
            // BEFORE in-comm update.
            const int_weight = w / (directed ? 1 : 2) / (u === v ? 2 : 1);
            const intra_old = (oldComm === u_comm);
            const intra_new = ((newComm === u_comm) || (u === v));
            // Apply from/to update first (matches cpp).
            if (pass === 0) {
              totFromC[oldComm] -= w;
              totFromC[newComm] += w;
            } else {
              totToC[oldComm] -= w;
              totToC[newComm] += w;
            }
            if (_probe) {
              const modeTag = (pass === 0) ? 1 : 2;  // OUT=1, IN=2
              console.error(
                `[TRACE-LD-MV] EDGE v=${v} u=${u} e=- mode=${modeTag}`
                + ` u_comm=${u_comm}`
                + ` w=${_ldHex(w)}`
                + ` int_weight=${_ldHex(int_weight)}`
                + ` intra_old=${intra_old ? 1 : 0}`
                + ` intra_new=${intra_new ? 1 : 0}`
                + ` tw_from_old=${_ldHex(totFromC[oldComm])}`
                + ` tw_from_new=${_ldHex(totFromC[newComm])}`
                + ` tw_to_old=${_ldHex(totToC[oldComm])}`
                + ` tw_to_new=${_ldHex(totToC[newComm])}`
                + ` tw_in_old=${_ldHex(inC[oldComm])}`
                + ` tw_in_new=${_ldHex(inC[newComm])}`
                + ` tw_all=${_ldHex(totalWeightInAllComms)}`);
            }
            if (intra_old) {
              inC[oldComm] -= int_weight;
              totalWeightInAllComms -= int_weight;
            }
            if (intra_new) {
              inC[newComm] += int_weight;
              totalWeightInAllComms += int_weight;
            }
          }
        }
      }
      // [TRACE-LD-MV] EXIT: post-update admin tuple. Bookends ENTRY.
      if (_probe) {
        console.error(
          `[TRACE-LD-MV] EXIT v=${v} old=${oldComm} new=${newComm}`
          + ` csize_old=${_ldHex(csize[oldComm])}`
          + ` csize_new=${_ldHex(csize[newComm])}`
          + ` cnodes_old=${cnodes[oldComm]} cnodes_new=${cnodes[newComm]}`
          + ` tw_in_old=${_ldHex(inC[oldComm])}`
          + ` tw_in_new=${_ldHex(inC[newComm])}`
          + ` tw_from_old=${_ldHex(totFromC[oldComm])}`
          + ` tw_from_new=${_ldHex(totFromC[newComm])}`
          + ` tw_to_old=${_ldHex(totToC[oldComm])}`
          + ` tw_to_new=${_ldHex(totToC[newComm])}`
          + ` tw_all=${_ldHex(totalWeightInAllComms)}`
          + ` tpe_all=${_ldHex(totalPossibleEdgesInAllComms)}`
          + ` n_empty=${empties.length}`);
      }
      membership[v] = newComm;
    }

    function weightToComm(v, comm) {
      neighComm(v);
      const w = cachedWeight[comm];
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
      // Mirror libleidenalg merge_nodes_constrained ALL_NEIGH_COMMS
      // (Optimiser.cpp:1295-1310). cpp walks IGRAPH_ALL neighbours
      // (includes self-loop u=v under LOOPS_TWICE) and adds
      // membership[u] for any u with constrained[u] == constrained[v].
      // Self-loop encounter adds v_comm at adj-iteration position, NOT
      // at the end. Subsequent merge_nodes_constrained loop processes
      // c == v_comm via diff_move (returns 0) under `>=` tie-break:
      // any non-self c with d=0 BEFORE v_comm in adj order picks c;
      // any non-self c=0 AFTER v_comm reverts max_comm to v_comm.
      const adjN = graph.neighbours(v);
      const cv = constrained[v];
      const seen = new Set();
      for (let i = 0; i < adjN.length; i++) {
        const u = adjN[i];
        if (constrained[u] !== cv) continue;
        seen.add(membership[u]);
      }
      return Array.from(seen);
    }

    // libleidenalg renumber → rank_order_communities (csize-DESC +
    // cnodes-DESC + id-ASC).
    function renumber() {
      const surv = [];
      for (let c = 0; c < ncomm; c++) {
        if (cnodes[c] > 0) surv.push(c);
      }
      // [TRACE-LD-RANK] PRE: dump per-community (id, csize, cnodes) in
      // input order. Mirrors cpp mutable_vertex_partition_traced.cpp
      // rank_order_communities probe. Closes P0 #14. JS uses csize-DESC
      // + cnodes-DESC + id-ASC tiebreak (matches cpp `orderCSize`).
      // PRE emits ALL communities (including zero-cnodes) so the cpp
      // input row set matches; cpp emits all nb_comms rows, JS does same.
      if (_ldProbesEnabled()) {
        let pre = "";
        for (let c = 0; c < ncomm; c++) {
          pre += (c ? "," : "") + `(${c},${csize[c]},${cnodes[c]})`;
        }
        console.error(`[TRACE-LD-RANK] PRE nb_comms=${ncomm} rows=${pre}`);
      }
      surv.sort(function (A, B) {
        if (csize[A] !== csize[B]) return csize[B] - csize[A];
        if (cnodes[A] !== cnodes[B]) return cnodes[B] - cnodes[A];
        return A - B;
      });
      const remap = new Int32Array(ncomm);
      for (let c = 0; c < ncomm; c++) remap[c] = -1;
      for (let i = 0; i < surv.length; i++) remap[surv[i]] = i;
      // [TRACE-LD-RANK] POST: dump new_comm_id mapping. cpp emits all
      // nb_comms entries; for zero-cnode comms the cpp value is 0 (the
      // vector is default-init to 0 and never assigned). JS leaves
      // remap[c] = -1 for zero-cnode; emit cpp-shape (0 for dead) so
      // the diff is byte-equal under the cpp invariant.
      if (_ldProbesEnabled()) {
        let post = "";
        for (let c = 0; c < ncomm; c++) {
          const v = remap[c] === -1 ? 0 : remap[c];
          post += (c ? "," : "") + v;
        }
        console.error(`[TRACE-LD-RANK] POST nb_comms=${ncomm} remap=${post}`);
      }
      for (let v = 0; v < n; v++) membership[v] = remap[membership[v]];
      const newN = surv.length;
      const newIn   = new Float64Array(newN);
      const newFrom = new Float64Array(newN);
      const newTo   = new Float64Array(newN);
      const newCs   = new Float64Array(newN);
      const newCn   = new Int32Array(newN);
      for (let i = 0; i < newN; i++) {
        const oldId = surv[i];
        newIn[i]   = inC[oldId];
        newFrom[i] = totFromC[oldId];
        newTo[i]   = totToC[oldId];
        newCs[i]   = csize[oldId];
        newCn[i]   = cnodes[oldId];
      }
      inC = newIn; totFromC = newFrom; totToC = newTo;
      csize = newCs; cnodes = newCn;
      ncomm = newN;
      empties.length = 0;
      cachedWeight = new Float64Array(ncomm);
      for (let c = 0; c < ncomm; c++) cachedWeight[c] = -1;
      neighLast = 0;
    }

    return {
      graph: graph,
      membership: function () { return membership; },
      memberOf: function (v) { return membership[v]; },
      n: function () { return n; },
      ncomm: function () { return ncomm; },
      csize:  function (c) { return c < ncomm ? csize[c]  : 0; },
      cnodes: function (c) { return c < ncomm ? cnodes[c] : 0; },
      totalWeightInComm:    function (c) { return c < ncomm ? inC[c]      : 0; },
      totalWeightFromComm:  function (c) { return c < ncomm ? totFromC[c] : 0; },
      totalWeightToComm:    function (c) { return c < ncomm ? totToC[c]   : 0; },
      totalWeightInAllComms:        function () { return totalWeightInAllComms; },
      totalPossibleEdgesInAllComms: function () { return totalPossibleEdgesInAllComms; },
      moveNode: moveNode,
      renumber: renumber,
      renumberLeiden: renumber,    // alias (libleidenalg-shape already)
      weightToComm:   weightToComm,
      weightFromComm: weightFromComm,
      getNeighComms: getNeighComms,
      getNeighCommsConstrained: getNeighCommsConstrained,
      getEmptyCommunity: getEmptyCommunity,
      rebuildAdmin: rebuildAdmin,
      diffMove: function (v, target) { return qualityFn.diffMove(this, v, target); },
      quality:  function () { return qualityFn.quality(this); },
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

  // ── CPM quality (CPMVertexPartition.cpp:41-122) ─────────────────
  function CPM(resolution) {
    return {
      name: "CPM",
      resolution: resolution,
      diffMove: function (P, v, newComm) {
        const oldComm = P.memberOf(v);
        if (oldComm === newComm) return 0;
        const G = P.graph;
        const wToOld = P.weightToComm(v, oldComm);
        const wToNew = P.weightToComm(v, newComm);
        const wFromOld = P.weightFromComm(v, oldComm);
        const wFromNew = P.weightFromComm(v, newComm);
        const sw = G.nodeSelfWeight(v);
        const nv = G.nodeSize(v);
        const csizeOld = P.csize(oldComm);
        const csizeNew = P.csize(newComm);
        const correctSelfLoops = G.correctSelfLoops();
        const directed = G.isDirected();
        const oldEdges = directed ? (wToOld + wFromOld) : 2 * wToOld;
        const newEdges = directed ? (wToNew + wFromNew) : 2 * wToNew;
        const selfTerm = correctSelfLoops ? 1 : 0;
        const possNew = nv * (2 * csizeNew + nv - selfTerm);
        const possOldDelta = nv * (2 * (csizeOld - nv) + nv - selfTerm);
        // libleidenalg CPMVertexPartition.cpp:104-110: diff_old subtracts
        // self_weight (-sw); diff_new adds self_weight (+sw); diff = diff_new
        // - diff_old → effective +2*sw contribution. Earlier JS coded
        // (oldEdges + sw) which cancels sw on undirected paths with
        // node_self_weight > 0 (collapsed-graph aggregation regime). At
        // resolution = 0.0001, the missing +2*sw term flips sign on
        // beneficial super-node merges (e.g. CM's per-side recluster on
        // n=8 in-side merging {6,7} into {0..5} loses sign without it).
        const diff = (newEdges + sw) - (oldEdges - sw)
                   - this.resolution * (possNew - possOldDelta);
        const result = directed ? diff : diff / 2.0;
        // [TRACE-LD-CPM] Per-call term-by-term breakdown. Closes P0 #12.
        // Field order + naming mirrors cpp_cpm_vertex_partition_traced.cpp
        // probe so a single grep diff localises the divergent term. cpp
        // shapes its diff as `(diff_new - diff_old)` with explicit
        // `possible_edge_difference_{old,new}`; JS folded form
        // `(possNew - possOldDelta)` carries the same algebra. Recompute
        // the cpp-shape pe_old/pe_new + diff_old/diff_new from the same
        // inputs so cross-side diff is byte-exact under matching seed.
        if (_ldProbesEnabled()) {
          const pe_old_cpp = correctSelfLoops
            ? nv * (2.0 * csizeOld - nv)
            : nv * (2.0 * csizeOld - nv - 1.0);
          const pe_new_cpp = correctSelfLoops
            ? nv * (2.0 * csizeNew + nv)
            : nv * (2.0 * csizeNew + nv - 1.0);
          const diff_old_cpp = wToOld + wFromOld - sw
                             - this.resolution * pe_old_cpp;
          const diff_new_cpp = wToNew + wFromNew + sw
                             - this.resolution * pe_new_cpp;
          const diff_cpp = diff_new_cpp - diff_old_cpp;
          console.error(
            `[TRACE-LD-CPM] v=${v} old=${oldComm} new=${newComm}`
            + ` res=${_ldHex(this.resolution)}`
            + ` w_to_old=${_ldHex(wToOld)}`
            + ` w_to_new=${_ldHex(wToNew)}`
            + ` w_from_old=${_ldHex(wFromOld)}`
            + ` w_from_new=${_ldHex(wFromNew)}`
            + ` nsize=${_ldHex(nv)}`
            + ` csize_old=${_ldHex(csizeOld)}`
            + ` csize_new=${_ldHex(csizeNew)}`
            + ` self_weight=${_ldHex(sw)}`
            + ` ped_old=${_ldHex(pe_old_cpp)}`
            + ` ped_new=${_ldHex(pe_new_cpp)}`
            + ` diff_old=${_ldHex(diff_old_cpp)}`
            + ` diff_new=${_ldHex(diff_new_cpp)}`
            + ` diff=${_ldHex(diff_cpp)}`
            + ` csl=${correctSelfLoops ? 1 : 0}`);
        }
        return result;
      },
      quality: function (P) {
        let q = 0;
        const G = P.graph;
        const correctSelfLoops = G.correctSelfLoops();
        for (let c = 0; c < P.ncomm(); c++) {
          if (P.cnodes(c) === 0) continue;
          const ec = P.totalWeightInComm(c);
          const nc = P.csize(c);
          const selfTerm = correctSelfLoops ? 1 : 0;
          const poss = nc * (nc - selfTerm) / 2.0;
          q += ec - this.resolution * poss;
        }
        return q;
      },
    };
  }

  // ── LeidenMod quality (libleidenalg ModularityVertexPartition.cpp) ──
  // Mirrors libleidenalg's `ModularityVertexPartition::diff_move` +
  // `quality` byte-for-byte. Identical shape to canonMod() in
  // tools/viz_check/leiden/self_rng_check.mjs (canonical-anchored L4
  // closed on this qfn 2026-05-07). Differs from LV.Modularity (Louvain
  // admin algebra) in the m_orig scaling and the +sw / -k_x*K_x sign
  // structure. Required for byte-equal CM under --algorithm leiden-mod
  // (cm.cpp:19,71 routes to `ConstrainedClustering::GetCommunities` ->
  // `ModularityVertexPartition` inside libleidenalg).
  function LeidenMod() {
    return {
      name: "LeidenMod",
      resolution: 1.0,
      diffMove: function (P, v, newComm) {
        const oldComm = P.memberOf(v);
        if (oldComm === newComm) return 0;
        const Gp = P.graph;
        // libleidenalg's graph->total_weight() = sum of edge weights once.
        const m_orig = Gp.totalEdgeWeight();
        if (m_orig === 0) return 0;
        const directed = Gp.isDirected();
        const total_weight = m_orig * (directed ? 1.0 : 2.0);
        const w_to_old = P.weightToComm(v, oldComm);
        const w_from_old = P.weightFromComm(v, oldComm);
        const w_to_new = P.weightToComm(v, newComm);
        const w_from_new = P.weightFromComm(v, newComm);
        // igraph strength under default IGRAPH_LOOPS_TWICE: self-loops
        // counted twice for undirected. Graph.strengthLeiden returns
        // wDeg + nbSelfLoops (= cpp strength).
        const k_out = Gp.strengthLeiden(v);
        const k_in = directed ? Gp.strengthLeiden(v) : k_out;
        const sw = Gp.nodeSelfWeight(v);
        const K_out_old = P.totalWeightFromComm(oldComm);
        const K_in_old  = P.totalWeightToComm(oldComm);
        const K_out_new = P.totalWeightFromComm(newComm) + k_out;
        const K_in_new  = P.totalWeightToComm(newComm) + k_in;
        const diff_old = (w_to_old - k_out * K_in_old / total_weight)
                       + (w_from_old - k_in * K_out_old / total_weight);
        const diff_new = (w_to_new + sw - k_out * K_in_new / total_weight)
                       + (w_from_new + sw - k_in * K_out_new / total_weight);
        const diff = diff_new - diff_old;
        const m = directed ? m_orig : 2.0 * m_orig;
        const result = diff / m;
        // [TRACE-LD-MOD] Per-call term-by-term breakdown. Closes P0 #13.
        // Field order mirrors modularity_vertex_partition_traced.cpp probe
        // (cpp lines 42-119). 15 terms + result; one fprintf per call.
        if (_ldProbesEnabled()) {
          console.error(
            `[TRACE-LD-MOD] v=${v} old=${oldComm} new=${newComm}`
            + ` total_weight=${_ldHex(total_weight)}`
            + ` w_to_old=${_ldHex(w_to_old)}`
            + ` w_from_old=${_ldHex(w_from_old)}`
            + ` w_to_new=${_ldHex(w_to_new)}`
            + ` w_from_new=${_ldHex(w_from_new)}`
            + ` k_out=${_ldHex(k_out)}`
            + ` k_in=${_ldHex(k_in)}`
            + ` self_weight=${_ldHex(sw)}`
            + ` K_out_old=${_ldHex(K_out_old)}`
            + ` K_in_old=${_ldHex(K_in_old)}`
            + ` K_out_new=${_ldHex(K_out_new)}`
            + ` K_in_new=${_ldHex(K_in_new)}`
            + ` diff_old=${_ldHex(diff_old)}`
            + ` diff_new=${_ldHex(diff_new)}`
            + ` diff=${_ldHex(diff)}`
            + ` m=${_ldHex(m)}`
            + ` result=${_ldHex(result)}`);
        }
        return result;
      },
      quality: function (P) {
        const Gp = P.graph;
        const m_orig = Gp.totalEdgeWeight();
        if (m_orig === 0) return 0;
        const directed = Gp.isDirected();
        const m = directed ? m_orig : 2.0 * m_orig;
        let mod = 0;
        for (let c = 0; c < P.ncomm(); c++) {
          // LeidenPartition: totalWeightInComm IS intra_c directly
          // (libleidenalg convention). No /2 bridge.
          const w = P.totalWeightInComm(c);
          const w_out = P.totalWeightFromComm(c);
          const w_in = P.totalWeightToComm(c);
          mod += w - w_out * w_in / ((directed ? 1.0 : 4.0) * m_orig);
        }
        const q = (directed ? 1.0 : 2.0) * mod;
        return q / m;
      },
    };
  }

  // ── moveNodes (fast local move with queue) ──────────────────────
  // Optimiser.cpp:490-749 default path. Differs from Louvain's sweep
  // by maintaining a FIFO queue + re-pushing stable neighbours of any
  // moved node. Acceptance: max_improv starts at 10*EPS, so equality
  // = no move (matches Optimiser.cpp:643-644).
  function moveNodes(P, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const considerEmpty = opts.considerEmpty !== false;
    const n = P.n();
    const order = new Array(n);
    for (let v = 0; v < n; v++) order[v] = v;
    // Replay-mode: inject the canonical Optimiser's shuffled queue.
    // Used by tools/viz_check/leiden to byte-equal libleidenalg.
    if (opts.visitOrder) {
      const vo = opts.visitOrder;
      for (let v = 0; v < n && v < vo.length; v++) order[v] = vo[v];
    } else {
      leidenShuffle(order, rng, "move");
    }
    const queue = order.slice();
    const isStable = new Uint8Array(n);
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    let _moveCap = 0;
    // [TRACE-LD-CAND] pass_idx stamp mirrors cpp's gTrace.passes counter.
    const _probe = _ldProbesEnabled();
    const _passIdx = _ldPassIdx++;
    let _visitIdx = 0;
    while (queue.length > 0) {
      if (++_moveCap > n * 1000) {
        console.warn("[leiden] moveNodes visit-cap exceeded n*1000=" + (n*1000) + " visits; bailing");
        break;
      }
      const v = queue.shift();
      const vComm = P.memberOf(v);
      const cands = P.getNeighComms(v);
      if (cands.indexOf(vComm) < 0) cands.push(vComm);
      // [TRACE-LD-BRANCH] Closes P0 #20: JS always walks ALL_NEIGH_COMMS
      // path (default Leiden consider_comms). Probe records the branch
      // name + post-cc candidate count + cnodes(vComm) so the empty-comm
      // gate flip is unambiguous downstream.
      const _cnodes_vcomm = P.cnodes(vComm);
      if (_probe) {
        console.error(
          `[TRACE-LD-BRANCH] pass=${_passIdx} visit=${_visitIdx}`
          + ` v=${v} vcomm=${vComm} consider_comms=ALL_NEIGH_COMMS`
          + ` n_after_cc=${cands.length} cnodes_vcomm=${_cnodes_vcomm}`);
      }
      if (considerEmpty && _cnodes_vcomm > 1) {
        // [TRACE-LD-EMPTYGATE] Closes P0 #17 (add_empty_community branch
        // result at the use site) + part of #20 (empty-comm gate).
        // Pre-call snapshot of ncomm; getEmptyCommunity may grow.
        const _ncomm_pre = P.ncomm();
        const ec = P.getEmptyCommunity();
        if (cands.indexOf(ec) < 0) cands.push(ec);
        if (_probe) {
          const _ncomm_post = P.ncomm();
          console.error(
            `[TRACE-LD-EMPTYGATE] site=move pass=${_passIdx} visit=${_visitIdx}`
            + ` v=${v} vcomm=${vComm} cnodes_vcomm=${_cnodes_vcomm}`
            + ` n_comms_pre=${_ncomm_pre} empty_id=${ec} n_comms_post=${_ncomm_post}`
            + ` grew=${_ncomm_post > _ncomm_pre ? 1 : 0}`);
        }
      } else if (_probe && considerEmpty) {
        console.error(
          `[TRACE-LD-EMPTYGATE] site=move pass=${_passIdx} visit=${_visitIdx}`
          + ` v=${v} vcomm=${vComm} cnodes_vcomm=${_cnodes_vcomm} skipped=1`);
      }
      let maxComm = vComm;
      const _maxCommSizeGuard = false;  // JS Leiden default: max_comm_size=0
      let maxImprov = _maxCommSizeGuard ? -Infinity : 10 * Number.EPSILON;
      // [TRACE-LD-CAND] CANDS: full candidate list + initial max_improv.
      // Mirrors cpp probe site at Optimiser.cpp:701-789. Use the canonical
      // ALL_NEIGH_COMMS enumeration order (P.getNeighComms output, plus
      // vComm + empty appended). max_improv_branch echoes the cpp tag
      // (NEG_INF vs 10EPS, P0 #15).
      if (_probe) {
        const mi_branch = _maxCommSizeGuard ? "NEG_INF" : "10EPS";
        console.error(
          `[TRACE-LD-CAND] CANDS pass=${_passIdx} visit=${_visitIdx}`
          + ` v=${v} vcomm=${vComm} ncands=${cands.length}`
          + ` max_improv_branch=${mi_branch}`
          + ` max_improv_init=${_ldHex(maxImprov)}`
          + ` cands=${cands.join(",")}`);
      }
      const deltas = [];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        // Default Leiden path has no max_comm_size; no SKIP probe needed
        // here. cpp emits SKIP when 0 < max_comm_size && csize+nv > max
        // (Optimiser.cpp:807-809) — silent in this build.
        const d = (c === vComm) ? 0 : P.diffMove(v, c);
        // [TRACE-LD-CAND] DIFF: per-layer diff_move. Single-layer path
        // (default Leiden), so layer=0 + lw=1.0 always.
        if (_probe) {
          console.error(
            `[TRACE-LD-CAND] DIFF pass=${_passIdx} visit=${_visitIdx}`
            + ` v=${v} comm=${c} layer=0 lw=${_ldHex(1.0)}`
            + ` diff_move=${_ldHex(d)}`);
        }
        const possible_improv = d;  // single-layer: layer_weights[0] * d
        // [TRACE-LD-CAND] COMP: move_nodes uses `>` (cpp:820).
        const accepts = (possible_improv > maxImprov);
        if (_probe) {
          console.error(
            `[TRACE-LD-CAND] COMP pass=${_passIdx} visit=${_visitIdx}`
            + ` v=${v} comm=${c} pimprov=${_ldHex(possible_improv)}`
            + ` max_improv=${_ldHex(maxImprov)}`
            + ` accepts=${accepts ? 1 : 0}`);
        }
        deltas.push({ comm: c, delta: d });
        if (accepts) {
          maxImprov = possible_improv;
          maxComm = c;
        }
      }
      isStable[v] = 1;
      let moved = false;
      if (maxComm !== vComm) {
        totalImprov += maxImprov;
        P.moveNode(v, maxComm);
        moved = true;
        nbMoves += 1;
        const adjN = P.graph.neighbours(v);
        for (let j = 0; j < adjN.length; j++) {
          const u = adjN[j];
          // [TRACE-LD-RESTAB] Closes P0 #16: per-neighbour restabilisation
          // decision tuple. Mirrors cpp probe at Optimiser.cpp:889-903
          // (the `(u, is_node_stable[u], membership[u], pushed)` tuple).
          // JS short-circuit on `u === v` precedes the cpp `is_node_stable
          // && != maxComm && !fixed` test; emit the cpp-shape tuple. JS
          // has no is_membership_fixed surface for u, so fixed=0 always.
          const _was_stable = isStable[u] ? 1 : 0;
          const _in_new = (P.memberOf(u) === maxComm) ? 1 : 0;
          const _push = (u !== v) && _was_stable && !_in_new;
          if (_probe) {
            console.error(
              `[TRACE-LD-RESTAB] pass=${_passIdx} visit=${_visitIdx}`
              + ` v=${v} u=${u} was_stable=${_was_stable}`
              + ` in_new=${_in_new} fixed=0`
              + ` pushed=${_push ? 1 : 0} u_comm=${P.memberOf(u)}`);
          }
          if (u === v) continue;
          if (isStable[u] && P.memberOf(u) !== maxComm) {
            queue.push(u);
            isStable[u] = 0;
          }
        }
      }
      if (recordTrace) {
        const rec = { v: v, fromComm: vComm, toComm: maxComm,
                      moved: moved, delta: moved ? maxImprov : 0 };
        if (opts.recordCandidates) rec.candidates = deltas;
        traces.push(rec);
      }
      _visitIdx++;
    }
    return { totalImprov: totalImprov, nbMoves: nbMoves, traces: traces };
  }

  // ── mergeNodesConstrained (refinement) ──────────────────────────
  // Optimiser.cpp:1230-1437. Sweep nodes once, only considering
  // singletons in the refined partition, restricting candidates to
  // refined-comms within the constrained membership. Greedy ≥ accept.
  function mergeNodesConstrained(P, constrained, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const n = P.n();
    const order = new Array(n);
    for (let v = 0; v < n; v++) order[v] = v;
    leidenShuffle(order, rng, "merge_constrained");
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    const _probe = _ldProbesEnabled();
    const _passIdx = _ldPassIdx++;
    let _visitIdx = 0;
    for (let i = 0; i < n; i++) {
      const v = order[i];
      const vComm = P.memberOf(v);
      if (P.cnodes(vComm) !== 1) continue;
      const cands = P.getNeighCommsConstrained(v, constrained);
      // [TRACE-LD-BRANCH] Refine path also walks ALL_NEIGH_COMMS (refine
      // _consider_comms default). Closes P0 #20 on the refine side.
      if (_probe) {
        console.error(
          `[TRACE-LD-BRANCH] pass=${_passIdx} visit=${_visitIdx}`
          + ` v=${v} vcomm=${vComm} consider_comms=ALL_NEIGH_COMMS_REFINE`
          + ` n_after_cc=${cands.length} cnodes_vcomm=${P.cnodes(vComm)}`);
      }
      let maxComm = vComm;
      const _maxCommSizeGuard_r = false;  // JS Leiden refine default
      let maxImprov = _maxCommSizeGuard_r ? -Infinity : 0;
      // [TRACE-LD-CAND] CANDS: refine candidate list + initial max_improv.
      // Mirrors cpp probe at Optimiser.cpp:1342-1378 (merge_nodes_constrained
      // ALL_NEIGH_COMMS path). max_improv_branch=ZERO mirrors cpp's refine
      // initial threshold (P0 #15).
      if (_probe) {
        const mi_branch_r = _maxCommSizeGuard_r ? "NEG_INF" : "ZERO";
        console.error(
          `[TRACE-LD-CAND] CANDS pass=${_passIdx} visit=${_visitIdx}`
          + ` v=${v} vcomm=${vComm} ncands=${cands.length}`
          + ` max_improv_branch=${mi_branch_r}`
          + ` max_improv_init=${_ldHex(maxImprov)}`
          + ` cands=${cands.join(",")}`);
      }
      const deltas = [];
      for (let j = 0; j < cands.length; j++) {
        const c = cands[j];
        // Mirror cpp Optimiser.cpp:1374-1378 — every cand goes through
        // diff_move + `>=` compare. For c == v_comm, diff_move returns
        // 0 via cpp short-circuit (CPMVertexPartition.cpp:51 / Modular-
        // ityVertexPartition.cpp:46), `0 >= 0` updates max_comm = c.
        // JS canonCPM/canonMod return 0 the same way. Don't skip the
        // self case — order matters under `>=` tie-break.
        const d = P.diffMove(v, c);
        if (_probe) {
          console.error(
            `[TRACE-LD-CAND] DIFF pass=${_passIdx} visit=${_visitIdx}`
            + ` v=${v} comm=${c} layer=0 lw=${_ldHex(1.0)}`
            + ` diff_move=${_ldHex(d)}`);
        }
        const possible_improv = d;  // single-layer
        // refine uses `>=` (cpp:1374).
        const accepts = (possible_improv >= maxImprov);
        if (_probe) {
          console.error(
            `[TRACE-LD-CAND] COMP pass=${_passIdx} visit=${_visitIdx}`
            + ` v=${v} comm=${c} pimprov=${_ldHex(possible_improv)}`
            + ` max_improv=${_ldHex(maxImprov)}`
            + ` accepts=${accepts ? 1 : 0}`);
        }
        deltas.push({ comm: c, delta: d });
        if (accepts) {
          maxImprov = possible_improv;
          maxComm = c;
        }
      }
      let moved = false;
      if (maxComm !== vComm) {
        totalImprov += maxImprov;
        P.moveNode(v, maxComm);
        moved = true;
        nbMoves += 1;
      }
      if (recordTrace) {
        const rec = { v: v, fromComm: vComm, toComm: maxComm,
                      moved: moved, delta: moved ? maxImprov : 0 };
        if (opts.recordCandidates) rec.candidates = deltas;
        traces.push(rec);
      }
      _visitIdx++;
    }
    return { totalImprov: totalImprov, nbMoves: nbMoves, traces: traces };
  }

  // ── optimisePartition (Leiden outer driver) ─────────────────────
  // Optimiser.cpp:77-369 default path. move → refine → aggregate,
  // with refined sub-partition collapsed but labelled by pre-refinement
  // community ids (the two-headed bookkeeping that gives Leiden's
  // γ-connectivity guarantee).
  function optimisePartition(graph, qualityFn, seed, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const refinePartition = opts.refinePartition !== false;
    // Reset the tracer-visible pass counter so every optimisePartition
    // call starts at pass=0 (matches cpp `gTrace.passes` reset per
    // pipeline run via main_traced.cpp `leiden_trace_reset()`).
    _ldPassIdx = 0;
    // initialMembership: optional Int32Array | Array | null. When set,
    // LeidenPartition starts with the given membership (mirroring
    // canonical's chained `for i in [0, num_iter): optimise_partition(p)`
    // pattern where iter 2 continues from iter 1's partition state).
    // CM uses this to mirror constrained.h:359 num_iter=2.
    const initialMembership = opts.initialMembership || null;
    // maxOuterLevels: cap the multi-level aggregate loop. Stress-matrix
    // top-level byte-equal verification sets this to 1 so JS doesn't
    // burn time on inner-level moveNodes that hit the visit-cap due to
    // the deferred Partition admin algebra mismatch (audit row M).
    const maxOuterLevels = opts.maxOuterLevels != null
                         ? opts.maxOuterLevels : 100;
    // onLevelEntry: optional hook fired at level=0 (initial graph +
    // partition) and after each level transition (post-collapse swap).
    // Used by tracer harnesses to dump per-level graph + admin state for
    // byte-equal cross-check vs cpp. Inert when unset.
    const onLevelEntry = typeof opts.onLevelEntry === "function"
                       ? opts.onLevelEntry : null;
    const rng = CC.MT19937(seed >>> 0);
    let P = LeidenPartition(graph, initialMembership, qualityFn);
    const levels = [];
    let level = 0;
    let aggregateFurther = true;
    let collapsedGraph = graph;
    let collapsedP = P;
    if (onLevelEntry) onLevelEntry(0, collapsedGraph, collapsedP);
    let aggregateNodePerFine = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) aggregateNodePerFine[i] = i;
    let fineMembership = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) fineMembership[i] = collapsedP.memberOf(i);

    let _safety = 0;
    while (aggregateFurther) {
      if (++_safety > maxOuterLevels) {
        if (maxOuterLevels < 100)
          break;        // expected bound (e.g. stress mode)
        console.warn("[leiden] aggregate loop exceeded 100 levels; bailing out");
        break;
      }
      const prevVcount = collapsedGraph.vcount();
      const moveOut = moveNodes(collapsedP, rng, {
        recordTrace: recordTrace, considerEmpty: true,
      });
      // Mirror libleidenalg Optimiser.cpp:737 (move_nodes) +
      // MutableVertexPartition::renumber_communities (which routes to
      // rank_order_communities, csize-DESC + cnodes-DESC + id-ASC).
      // Using the Louvain original-id-ASC variant here desyncs collapsed-
      // graph node ids from cpp at every level transition, breaking
      // inner-level byte-equal claims.
      collapsedP.renumber();
      const memColl = collapsedP.membership();
      for (let v = 0; v < graph.vcount(); v++) {
        fineMembership[v] = memColl[aggregateNodePerFine[v]];
      }
      let subCollapsedP = null;
      let refineOut = null;
      if (refinePartition) {
        const initSing = new Int32Array(collapsedGraph.vcount());
        for (let i = 0; i < collapsedGraph.vcount(); i++) initSing[i] = i;
        subCollapsedP = LeidenPartition(collapsedGraph, initSing, qualityFn);
        const constr = collapsedP.membership();
        refineOut = mergeNodesConstrained(subCollapsedP, constr, rng, {
          recordTrace: recordTrace,
        });
      }
      const refinedP = refinePartition ? subCollapsedP : collapsedP;
      // Optimiser.cpp:1427 (merge_nodes_constrained renumber) + the
      // collapse step at :255 read sub-partition ids in csize-DESC
      // order. LeidenPartition's renumber IS csize-DESC.
      refinedP.renumber();
      const refinedNcomm = refinedP.ncomm();
      // Use libleidenalg-shape collapse (cpp Graph::collapse_graph at
      // GraphHelper.cpp:703-784). Each inter pair emitted ONCE, self-loop
      // emitted ONCE with weight = intra_c, so super-graph
      // nodeSelfWeight + adj-via-neighComm match cpp at level 1+.
      // [TRACE-LD-LG] Dump SUB + MAIN partition membership at the moment
      // collapseLeiden reads from them. Bit-equal with cpp's matching
      // SUB_MEM / MAIN_MEM probe localizes any pre-collapse divergence.
      if (onLevelEntry) {
        const subM = refinedP.membership();
        const mainM = collapsedP.membership();
        const _emit = function (kind, mem) {
          console.error(`[TRACE-LD-LG] ${kind} level=${level} n=${mem.length} ncomm=${kind === "SUB" ? refinedP.ncomm() : collapsedP.ncomm()}`);
          for (let v = 0; v < mem.length; v++) {
            console.error(`[TRACE-LD-LG] ${kind}_MEM level=${level} v=${v} c=${mem[v]}`);
          }
        };
        _emit("SUB", subM);
        _emit("MAIN", mainM);
      }
      const newCollapsed = collapsedGraph.collapseLeiden(refinedP.membership(), refinedNcomm);
      const newCollapsedMembership = new Int32Array(refinedNcomm);
      const seenSuper = new Uint8Array(refinedNcomm);
      const refMem = refinedP.membership();
      const collMem = collapsedP.membership();
      for (let u = 0; u < collapsedGraph.vcount(); u++) {
        const xi = refMem[u];
        if (!seenSuper[xi]) {
          newCollapsedMembership[xi] = collMem[u];
          seenSuper[xi] = 1;
        }
      }
      const newAggregate = new Int32Array(graph.vcount());
      for (let v = 0; v < graph.vcount(); v++) {
        newAggregate[v] = refMem[aggregateNodePerFine[v]];
      }
      aggregateNodePerFine = newAggregate;
      const newCollapsedP = LeidenPartition(newCollapsed, newCollapsedMembership, qualityFn);
      const finePostMove = new Int32Array(fineMembership);
      const finePostRefine = new Int32Array(graph.vcount());
      for (let v = 0; v < graph.vcount(); v++) {
        finePostRefine[v] = newAggregate[v];
      }
      levels.push({
        level: level,
        collapsedVcount: prevVcount,
        moveTraces: moveOut.traces,
        moveImprov: moveOut.totalImprov,
        moveCount: moveOut.nbMoves,
        refineTraces: refineOut ? refineOut.traces : [],
        refineImprov: refineOut ? refineOut.totalImprov : 0,
        refineCount: refineOut ? refineOut.nbMoves : 0,
        finePostMove: finePostMove,
        finePostRefine: finePostRefine,
        newCollapsedVcount: newCollapsed.vcount(),
      });
      // [TRACE-LD-AGG] Closes P0 #18. Decomposed short-circuit: cpp emits
      // `(any_unfixed, new_vcount, old_vcount, n_comms, new_lt_old, old_gt_ncomm)`
      // before the `&&` chain + final value after. JS Leiden has no
      // fixed-membership surface, so any_unfixed=1 always (mirrors cpp's
      // default-fixed-empty path). Field order matches cpp probe.
      const _ld_new_lt_old = newCollapsed.vcount() < prevVcount;
      const _ld_old_gt_ncomm = prevVcount > collapsedP.ncomm();
      if (_ldProbesEnabled()) {
        console.error(
          `[TRACE-LD-AGG] level=${level} any_unfixed=1`
          + ` new_vcount=${newCollapsed.vcount()} old_vcount=${prevVcount}`
          + ` n_comms=${collapsedP.ncomm()}`
          + ` new_lt_old=${_ld_new_lt_old ? 1 : 0}`
          + ` old_gt_ncomm=${_ld_old_gt_ncomm ? 1 : 0}`);
      }
      aggregateFurther = (newCollapsed.vcount() < prevVcount)
                      && (prevVcount > collapsedP.ncomm());
      if (_ldProbesEnabled()) {
        console.error(
          `[TRACE-LD-AGG] level=${level} final=${aggregateFurther ? 1 : 0}`);
      }
      collapsedGraph = newCollapsed;
      collapsedP = newCollapsedP;
      level += 1;
      if (onLevelEntry) onLevelEntry(level, collapsedGraph, collapsedP);
    }
    P.setMembership(fineMembership);
    // Final renumber: cpp Optimiser.cpp:357 calls
    // partitions[0]->renumber_communities() (csize-DESC).
    P.renumber();
    return { partition: P, levels: levels, quality: P.quality() };
  }

  // ── Public API: Leiden-specific algebra only ────────────────────
  // NOTE: COMDET.LEIDEN.Partition = LeidenPartition (libleidenalg-shape
  // admin), NOT the louvain-shape Partition (Louvain-Modularity-shape
  // admin). Browser pages + tracer harnesses calling
  // COMDET.LEIDEN.Partition get the libleidenalg-faithful algebra.
  //
  // Shared primitives (MT19937, shuffle, range, Graph) used to be
  // re-exported here from LOUVAIN. After the 2026-05-10 cross-algo
  // isolation refactor they live under COMDET.COMMON; callers read
  // them from there directly (no Leiden re-export bridge).
  window.COMDET.LEIDEN = {
    Partition: LeidenPartition,
    CPM: CPM,
    LeidenMod: LeidenMod,
    moveNodes: moveNodes,
    mergeNodesConstrained: mergeNodesConstrained,
    optimisePartition: optimisePartition,
  };
})();
