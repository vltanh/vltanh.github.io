/* Louvain kernel. JS port faithful to externals/louvain (Blondel 2008
 * et al., gen-louvain v0.3 src/louvain.cpp + modularity.cpp +
 * graph_binary.cpp). The JS code structure mirrors the canonical
 * cpp source, not the paper: every per-step computation lands on the
 * same arithmetic operands in the same order so a JS-MT19937 + double-
 * precision build of the canonical (community-detection/tools/viz_check/
 * louvain/instrumented/louvain_l4_tracer.cpp) produces bit-identical
 * per-visit output under matching seed.
 *
 * What this file owns:
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
 * What this file CONSUMES from COMDET.COMMON (js/common/common.js):
 *   - MT19937 RNG (JS port; the cpp tracer's libc rand is replaced
 *     with the same MT19937 to make L4 bit-equality reachable).
 *   - Fisher-Yates shuffle (mirrors canonical louvain.cpp:222-229
 *     loop direction: i from 0 to n-2; rand_pos = mt(qual->size-i)+i).
 *   - Graph (mirrors canonical Graph from graph_binary.cpp + .h:
 *     adj is per-node neighbour list with both directions for non-self
 *     edges and one entry for self-loops; weighted_degree(v) sums adj
 *     weights so a self-loop contributes ONCE; total_weight at level 0
 *     equals 2m for unweighted undirected, doubles per level).
 * These primitives moved out of LOUVAIN's namespace into COMMON on
 * 2026-05-10 (cross-algo isolation refactor); they are not Louvain-
 * specific (Leiden + both Infomap ports also consume them). The
 * COMDET.LOUVAIN namespace now exports only Louvain-specific algebra
 * (Partition, Modularity, sweep, run). Common primitives are reached
 * via COMDET.COMMON; see cross_algo_isolation_audit.md.
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
  if (!window.COMDET || !window.COMDET.COMMON) {
    console.warn("[louvain] COMDET.COMMON missing; load common/common.js first");
    return;
  }
  // Pull shared primitives (MT19937, shuffle, range, Graph) from
  // COMDET.COMMON. Same function references; renamed to local consts
  // so the rest of the file reads exactly as before the extraction.
  const CC = window.COMDET.COMMON;
  const MT19937 = CC.MT19937;
  const shuffle = CC.shuffle;
  const range = CC.range;
  const Graph = CC.Graph;


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
  // │ This LV.Partition is the older substrate, faithful to the      │
  // │ Louvain externals canonical (Blondel 2008, gen-louvain v0.3:   │
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
  // │   LV.Partition       (this file): Louvain-shape, used by       │
  // │                                    LV.sweep + LV.run.           │
  // │   COMDET.LEIDEN.Partition         : libleidenalg-shape,         │
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
      // to target. Easier to recompute directly:
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
      // Fresh comm id: grow admin.
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

    // moveNode is a thin wrapper around remove + insert for the page-side
    // trace replay (page.js rebuildPhase1Trace). Internally: neighComm to
    // find dnc to old/target, then remove + insert. The Louvain sweep
    // does NOT call moveNode (it calls remove + insert directly to avoid
    // the duplicated neighComm scan).
    function moveNode(v, target) {
      const old = membership[v];
      if (old === target) return;
      neighComm(v);
      const dncOld = neighWeight[old] === -1 ? 0 : neighWeight[old];
      const dncNew = neighWeight[target] === -1 ? 0 : neighWeight[target];
      modRemove(v, old, dncOld);
      modInsert(v, target, dncNew);
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

    // Shared admin-rewrite given a remap[old]→new and an order[new]→old.
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
      // Canonical Modularity admin (modularity.h::in/tot). totalWeightInComm
      // = in[c] = 2·intra_c + Σ self-loops; totalWeightToComm = tot[c] =
      // Σ weighted_degree of constituents.
      totalWeightInComm: function (c) { return c < ncomm ? inC[c] : 0; },
      totalWeightToComm: function (c) { return c < ncomm ? totC[c] : 0; },
      moveNode: moveNode,
      // Canonical sweep primitives. Exposed so the outer driver does
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
      renumber: renumber,
      rebuildAdmin: rebuildAdmin,
      quality: function () { return qualityFn.quality(this); },
    };
  }

  // ── Modularity quality function ─────────────────────────────────
  // Louvain's sweep computes per-visit ΔQ inline via Partition.modGain
  // (canonical Modularity::gain after remove). The quality() entry here
  // is the absolute-Q evaluator called by phase1's level-convergence
  // gate + the page's per-level Q_after readout.
  function Modularity() {
    return {
      quality: function (P) {
        // Mirrors externals/louvain Modularity::quality()
        // (modularity.cpp:58-71) byte-for-byte:
        //   q = 0
        //   for c: if tot[c] > 0: q += in[c] - (tot[c] * tot[c]) / m2
        //   q /= m2
        // Operand order matches cpp exactly so per-c sub-ulp drift is
        // bit-identical with the L4 tracer at every accumulation step.
        // P.totalWeightInComm(c) returns canonical in[c] (= 2·intra_c +
        // Σ self-loops, set by Partition.rebuildAdmin per canonical
        // Modularity::in convention). P.totalWeightToComm(c) returns
        // tot[c] (Σ weighted_degree of c's constituents). m2 =
        // graph.totalWeight() (= 2m for undirected, doubles per level
        // because canonical's partition2graph_binary emits per-direction
        // = 2·intra self-loops + per-direction inter).
        const G = P.graph;
        const m2 = G.totalWeight();
        if (m2 <= 0) return 0;
        let q = 0;
        for (let c = 0; c < P.ncomm(); c++) {
          const tot = P.totalWeightToComm(c);
          if (tot > 0) {
            const inv = P.totalWeightInComm(c);
            q += inv - (tot * tot) / m2;
          }
        }
        return q / m2;
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
      // [TRACE-LV-VISIT-PRE] kv + nb_selfloops + pre-remove in_/tot_.
      // P0 probes (audit row M / F / J inputs). Read BEFORE neighComm +
      // modRemove so the snapshot reflects the partition state going
      // into the move decision.
      const selfLoop = P.graph.nbSelfLoops(v);
      const inCfromPre  = recordTrace ? P.totalWeightInComm(vComm) : 0;
      const totCfromPre = recordTrace ? P.totalWeightToComm(vComm) : 0;
      // neigh_comm sets neigh_pos[0]=vComm, weight 0; rest = first-seen
      // distinct neighbour comms.
      P.neighComm(v);
      const neighLast = P.neighLast();
      // Canonical remove(v, vComm, neigh_weight[vComm]). neigh_comm
      // initialised neigh_weight[vComm] to 0 + accumulated the weights
      // from v to non-self neighbours that are CURRENTLY in vComm: at
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
        // [TRACE-LV-CANDS] per-candidate (comm, dnc, gain) in neigh_pos
        // iteration order = vComm at slot 0 + first-seen distinct
        // neighbour comms. P0 probe — winner-matching is insufficient
        // when loser-set differs (audit row J site-1 + row H).
        if (recordTrace) deltas.push({ comm: c, dnc: dnc, gain: inc, delta: inc });
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
          // Running-tracker probes (audit row M / general admin). Read
          // post-modInsert; mirrors cpp tracer's inC_*_bits / totC_*_bits.
          // For no-move case (bestComm === vComm) both pairs coincide.
          inCfrom: P.totalWeightInComm(vComm),
          inCto: P.totalWeightInComm(bestComm),
          totCfrom: P.totalWeightToComm(vComm),
          totCto: P.totalWeightToComm(bestComm),
          // P0 probes (audit row F + J + M). kv = weighted_degree(v)
          // direct operand of modGain; selfLoop folded into modRemove /
          // modInsert; dncBest is the neigh_weight[bestComm] value
          // passed into modInsert (distinct from bestIncrease — drove
          // c4c63ef9 closure on gnm_5000_p002); inCfromPre / totCfromPre
          // = source-comm admin BEFORE modRemove (the remove input).
          kv: wDeg,
          selfLoop: selfLoop,
          dncBest: bestNblinks,
          inCfromPre: inCfromPre,
          totCfromPre: totCfromPre,
        });
      }
    }
    return { totalImprov: totalImprov, nbMoves: nbMoves, traces: traces };
  }

  function phase1(graph, qualityFn, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const P = Partition(graph, null, qualityFn);
    // [TRACE-LV-LEVEL-ADMIN-ENTRY] P0 probe #8 — full in_/tot_ vectors
    // at level entry. P.Partition has just been singleton-initialised
    // (membership[i] = i; inC[i] = nb_selfloops(i); totC[i] =
    // weighted_degree(i) per rebuildAdmin). Length = ncomm = n. Audit
    // rows K + M. Captured before any sweep so the canonical singleton
    // init is observable and bit-comparable against cpp tracer's
    // Modularity::in/tot at the same boundary.
    let inBitsEntry = null;
    let totBitsEntry = null;
    if (recordTrace) {
      const nc = P.ncomm();
      inBitsEntry = new Float64Array(nc);
      totBitsEntry = new Float64Array(nc);
      for (let ci = 0; ci < nc; ci++) {
        inBitsEntry[ci]  = P.totalWeightInComm(ci);
        totBitsEntry[ci] = P.totalWeightToComm(ci);
      }
    }
    const sweeps = [];
    // Canonical louvain.cpp:221-229: random_order is computed ONCE per
    // level, shuffled in place, then reused for every pass in the
    // do/while. JS mirrors that: shuffle once, inject the same
    // visitOrder into every sweep call.
    const n = P.n();
    const visitOrder = new Array(n);
    for (let i = 0; i < n; i++) visitOrder[i] = i;
    if (opts.visitOrder) {
      for (let i = 0; i < n; i++) visitOrder[i] = opts.visitOrder[i];
    } else {
      shuffle(visitOrder, rng);
    }
    // Canonical externals/louvain one_level (louvain.cpp:235-277):
    //   do { ... } while (nb_moves > 0 && new_qual - cur_qual > eps_impr);
    // No pass cap. Canonical converges naturally by either (a) zero
    // moves or (b) Q-gain ≤ eps. Earlier JS code carried a `pass > 50`
    // cap that diverged from canonical on large graphs (e.g. empirical
    // google n=15763 needs 69 L0 passes to converge); removed for byte-
    // equal vs canonical-faithful tracer.
    let curQ = qualityFn.quality(P);
    while (true) {
      const before = curQ;
      const out = sweep(P, rng, { recordTrace: recordTrace, visitOrder: visitOrder });
      const after = qualityFn.quality(P);
      out.qualityAfter = after;
      // [TRACE-LV-PASS] curQual snapshot at pass entry — operand B of
      // the do/while gate (`new_qual - cur_qual > eps_impr`). Audit row
      // F + tie-break site-2. `before` is exactly cur_qual in canonical
      // (cpp louvain.cpp:236: `cur_qual = new_qual;` at top of do-body
      // mirrors JS `before = curQ` at top of while-body).
      out.curQual = before;
      sweeps.push(out);
      if (out.nbMoves === 0 || (after - before) <= 1e-6) break;
      curQ = after;
    }
    // [TRACE-LV-LEVEL-ADMIN-EXIT] P0 probe #8 — full in_/tot_ vectors
    // at level exit, AFTER the level converges + BEFORE renumber +
    // collapse. Indices still in pre-renumber comm-id space (matches
    // cpp tracer's snapshot taken before partition2graph_binary).
    // Length = ncomm. Audit rows K + M + L.
    let inBitsExit = null;
    let totBitsExit = null;
    if (recordTrace) {
      const nc = P.ncomm();
      inBitsExit = new Float64Array(nc);
      totBitsExit = new Float64Array(nc);
      for (let ci = 0; ci < nc; ci++) {
        inBitsExit[ci]  = P.totalWeightInComm(ci);
        totBitsExit[ci] = P.totalWeightToComm(ci);
      }
    }
    return {
      partition: P,
      sweeps: sweeps,
      inBitsEntry: inBitsEntry,
      totBitsEntry: totBitsEntry,
      inBitsExit: inBitsExit,
      totBitsExit: totBitsExit,
    };
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
      const totalWeightPre = collapsedG.totalWeight();
      const newCollapsed = collapsedG.collapse(memColl, collapsedNcomm);
      const totalWeightPost = newCollapsed.totalWeight();
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
        // Probes (audit row N / multi-level flag).
        totalWeightPre: totalWeightPre,
        totalWeightPost: totalWeightPost,
        nAfterCollapse: newCollapsed.vcount(),
        // P0 #8 probes (audit row K / L / M). Per-level full in_/tot_
        // vectors at entry + exit, captured inside phase1 before the
        // renumber + collapse step. Length = n_before for this level.
        inBitsEntry: p1.inBitsEntry,
        totBitsEntry: p1.totBitsEntry,
        inBitsExit: p1.inBitsExit,
        totBitsExit: p1.totBitsExit,
      });
      if (newCollapsed.vcount() >= prevVcount || newCollapsed.vcount() <= 1) break;
      collapsedG = newCollapsed;
      level += 1;
      // Canonical externals/louvain main_louvain.cpp:275-310 has no
      // level cap; the do/while terminates on improvement=false.
      // Removed prior `level > 30` safety cap for byte-equal parity.
    }
    const P = Partition(graph, fineMembership, qualityFn);
    P.renumber();
    return { partition: P, levels: levels, quality: P.quality() };
  }

  // Louvain-specific algebra only. Shared primitives (MT19937, shuffle,
  // range, Graph) live under COMDET.COMMON since 2026-05-10 (cross-algo
  // isolation refactor). Pages / harnesses that previously read
  // LV.MT19937 / LV.Graph / etc. now read COMDET.COMMON.* directly.
  window.COMDET.LOUVAIN = {
    Partition: Partition,
    Modularity: Modularity,
    sweep: sweep,
    run: run,
  };
})();
