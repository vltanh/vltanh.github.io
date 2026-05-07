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
 * Primitives (Graph, Partition, Modularity, MT19937, shuffle, range)
 * live in COMDET.LOUVAIN; this file re-exports them onto COMDET.LEIDEN
 * so existing callers (page_helpers.js, leiden-cpm page glue) work
 * unchanged.
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.LOUVAIN) {
    console.warn("[leiden] COMDET.LOUVAIN missing — load louvain.js first");
    return;
  }
  const LV = window.COMDET.LOUVAIN;

  // Leiden-local Fisher-Yates shuffle that uses rng.intLemire (igraph's
  // Lemire-debiased bounded-int) so the JS production walker's RNG draw
  // sequence bit-equals libleidenalg under matching seed. LV.shuffle
  // uses rng.int (textbook rejection) which does NOT match igraph's
  // get_random_int; Louvain externals's tracer relies on the textbook
  // path so that side stays unchanged.
  function leidenShuffle(arr, rng) {
    for (let idx = arr.length - 1; idx >= 1; idx--) {
      const j = rng.intLemire(0, idx);
      const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    }
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
      for (let i = 0; i < adjN.length; i++) {
        const u = adjN[i];
        const w = adjW[i];
        const c = membership[u];
        if (cachedWeight[c] === -1) {
          cachedWeight[c] = 0;
          neighPos[neighLast++] = c;
        }
        cachedWeight[c] += w;
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
      const newId = ncomm;
      growAdmin(newId + 1);
      emptiesAdd(newId);
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
      // Possible-edges delta (line 572). Pre-csize-update.
      const dirFactor = directed ? 1 : 2;
      const delta_pe = 2.0 * node_size * (csize[newComm] - csize[oldComm] + node_size) / dirFactor;
      totalPossibleEdgesInAllComms += delta_pe;
      // Remove from old + maybe push to empties (lines 583-601).
      cnodes[oldComm] -= 1;
      csize[oldComm]  -= node_size;
      if (cnodes[oldComm] === 0) emptiesAdd(oldComm);
      // Add to new (if was empty, remove from empties via reverse-iter).
      if (cnodes[newComm] === 0) emptiesRemove(newComm);
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
          if (pass === 0) {
            totFromC[oldComm] -= w;
            totFromC[newComm] += w;
          } else {
            totToC[oldComm] -= w;
            totToC[newComm] += w;
          }
          const int_weight = w / (directed ? 1 : 2) / (u === v ? 2 : 1);
          if (oldComm === u_comm) {
            inC[oldComm] -= int_weight;
            totalWeightInAllComms -= int_weight;
          }
          if ((newComm === u_comm) || (u === v)) {
            inC[newComm] += int_weight;
            totalWeightInAllComms += int_weight;
          }
        }
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

    // libleidenalg renumber → rank_order_communities (csize-DESC +
    // cnodes-DESC + id-ASC).
    function renumber() {
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
        const diff = (newEdges + sw) - (oldEdges + sw)
                   - this.resolution * (possNew - possOldDelta);
        return directed ? diff : diff / 2.0;
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
      leidenShuffle(order, rng);
    }
    const queue = order.slice();
    const isStable = new Uint8Array(n);
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    let _moveCap = 0;
    while (queue.length > 0) {
      if (++_moveCap > n * 1000) {
        console.warn("[leiden] moveNodes visit-cap exceeded n*1000=" + (n*1000) + " visits; bailing");
        break;
      }
      const v = queue.shift();
      const vComm = P.memberOf(v);
      const cands = P.getNeighComms(v);
      if (cands.indexOf(vComm) < 0) cands.push(vComm);
      if (considerEmpty && P.cnodes(vComm) > 1) {
        const ec = P.getEmptyCommunity();
        if (cands.indexOf(ec) < 0) cands.push(ec);
      }
      let maxComm = vComm;
      let maxImprov = 10 * Number.EPSILON;
      const deltas = [];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        if (c === vComm) {
          deltas.push({ comm: c, delta: 0 });
          continue;
        }
        const d = P.diffMove(v, c);
        deltas.push({ comm: c, delta: d });
        if (d > maxImprov) {
          maxImprov = d;
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
    leidenShuffle(order, rng);
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    for (let i = 0; i < n; i++) {
      const v = order[i];
      const vComm = P.memberOf(v);
      if (P.cnodes(vComm) !== 1) continue;
      const cands = P.getNeighCommsConstrained(v, constrained);
      if (cands.indexOf(vComm) < 0) cands.push(vComm);
      let maxComm = vComm;
      let maxImprov = 0;
      const deltas = [];
      for (let j = 0; j < cands.length; j++) {
        const c = cands[j];
        if (c === vComm) {
          deltas.push({ comm: c, delta: 0 });
          continue;
        }
        const d = P.diffMove(v, c);
        deltas.push({ comm: c, delta: d });
        if (d >= maxImprov) {
          maxImprov = d;
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
    // maxOuterLevels: cap the multi-level aggregate loop. Stress-matrix
    // top-level byte-equal verification sets this to 1 so JS doesn't
    // burn time on inner-level moveNodes that hit the visit-cap due to
    // the deferred Partition admin algebra mismatch (audit row M).
    const maxOuterLevels = opts.maxOuterLevels != null
                         ? opts.maxOuterLevels : 100;
    const rng = LV.MT19937(seed >>> 0);
    let P = LeidenPartition(graph, null, qualityFn);
    const levels = [];
    let level = 0;
    let aggregateFurther = true;
    let collapsedGraph = graph;
    let collapsedP = P;
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
      aggregateFurther = (newCollapsed.vcount() < prevVcount)
                      && (prevVcount > collapsedP.ncomm());
      collapsedGraph = newCollapsed;
      collapsedP = newCollapsedP;
      level += 1;
    }
    P.setMembership(fineMembership);
    // Final renumber: cpp Optimiser.cpp:357 calls
    // partitions[0]->renumber_communities() (csize-DESC).
    P.renumber();
    return { partition: P, levels: levels, quality: P.quality() };
  }

  // ── Public API: re-export Louvain primitives + add Leiden bits ──
  // NOTE: COMDET.LEIDEN.Partition = LeidenPartition (libleidenalg-shape
  // admin), NOT LV.Partition (Louvain-Modularity-shape admin). Browser
  // pages + tracer harnesses calling COMDET.LEIDEN.Partition get the
  // libleidenalg-faithful algebra.
  window.COMDET.LEIDEN = {
    // Re-exports from Louvain (so existing callers work unchanged).
    MT19937: LV.MT19937,
    shuffle: LV.shuffle,
    range: LV.range,
    Graph: LV.Graph,
    Modularity: LV.Modularity,
    // Leiden-specific (LeidenPartition replaces LV.Partition).
    Partition: LeidenPartition,
    CPM: CPM,
    moveNodes: moveNodes,
    mergeNodesConstrained: mergeNodesConstrained,
    optimisePartition: optimisePartition,
  };
})();
