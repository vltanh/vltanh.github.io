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
      LV.shuffle(order, rng);
    }
    const queue = order.slice();
    const isStable = new Uint8Array(n);
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    while (queue.length > 0) {
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
        traces.push({
          v: v, fromComm: vComm, toComm: maxComm,
          moved: moved, delta: moved ? maxImprov : 0,
          candidates: deltas,
        });
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
    LV.shuffle(order, rng);
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
        traces.push({
          v: v, fromComm: vComm, toComm: maxComm,
          moved: moved, delta: moved ? maxImprov : 0,
          candidates: deltas,
        });
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
    const rng = LV.MT19937(seed >>> 0);
    let P = LV.Partition(graph, null, qualityFn);
    const levels = [];
    let level = 0;
    let aggregateFurther = true;
    let collapsedGraph = graph;
    let collapsedP = P;
    let aggregateNodePerFine = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) aggregateNodePerFine[i] = i;
    let fineMembership = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) fineMembership[i] = collapsedP.memberOf(i);

    while (aggregateFurther) {
      const prevVcount = collapsedGraph.vcount();
      const moveOut = moveNodes(collapsedP, rng, {
        recordTrace: recordTrace, considerEmpty: true,
      });
      const memColl = collapsedP.membership();
      for (let v = 0; v < graph.vcount(); v++) {
        fineMembership[v] = memColl[aggregateNodePerFine[v]];
      }
      let subCollapsedP = null;
      let refineOut = null;
      if (refinePartition) {
        const initSing = new Int32Array(collapsedGraph.vcount());
        for (let i = 0; i < collapsedGraph.vcount(); i++) initSing[i] = i;
        subCollapsedP = LV.Partition(collapsedGraph, initSing, qualityFn);
        const constr = collapsedP.membership();
        refineOut = mergeNodesConstrained(subCollapsedP, constr, rng, {
          recordTrace: recordTrace,
        });
      }
      const refinedP = refinePartition ? subCollapsedP : collapsedP;
      refinedP.renumber();
      const refinedNcomm = refinedP.ncomm();
      const newCollapsed = collapsedGraph.collapse(refinedP.membership(), refinedNcomm);
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
      const newCollapsedP = LV.Partition(newCollapsed, newCollapsedMembership, qualityFn);
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
    P.renumber();
    return { partition: P, levels: levels, quality: P.quality() };
  }

  // ── Public API: re-export Louvain primitives + add Leiden bits ──
  window.COMDET.LEIDEN = {
    // Re-exports from Louvain (so existing callers work unchanged).
    MT19937: LV.MT19937,
    shuffle: LV.shuffle,
    range: LV.range,
    Graph: LV.Graph,
    Partition: LV.Partition,
    Modularity: LV.Modularity,
    // Leiden-specific.
    CPM: CPM,
    moveNodes: moveNodes,
    mergeNodesConstrained: mergeNodesConstrained,
    optimisePartition: optimisePartition,
  };
})();
