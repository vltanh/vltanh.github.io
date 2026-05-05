/* heavy_edges: pre/post processing of cactus reduction.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/heavy_edges.h]
 *
 * Removes edges with wgt > mincut (contract the endpoints) and notes
 * mincut-weight edges from leaf vertices for re-insertion in the final
 * cactus. contractCycleEdges merges chains of degree-2 vertices into
 * cycles; reInsertCycles + reInsertVertices undo the reductions on the
 * final cactus.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_NODE = 0xffffffff;
  const UNDEFINED_EDGE = 0xffffffff;

  function HeavyEdges(mincut) { this.mincut = mincut; }

  HeavyEdges.prototype.removeHeavyEdges = function (G) {
    const cactusEdge = [];
    const contract = new Map();
    const markForCactus = [];
    for (let n = 0; n < G.number_of_nodes(); n++) {
      if (G.isEmpty(n)) continue;
      const ne = G.get_first_invalid_edge(n);
      for (let e = 0; e < ne; e++) {
        const wgt = G.getEdgeWeight(n, e);
        const target = G.getEdgeTarget(n, e);
        if (G.isEmpty(target)) continue;
        if (wgt > this.mincut) {
          const v1 = G.containedVertices(n)[0];
          const v2 = G.containedVertices(target)[0];
          const lo = Math.min(v1, v2);
          const hi = Math.max(v1, v2);
          if (!contract.has(lo)) contract.set(lo, [hi]);
          else contract.get(lo).push(hi);
        }
        if (wgt === this.mincut) {
          if (G.get_first_invalid_edge(n) === 1) {
            markForCactus.push(G.containedVertices(n)[0]);
          }
        }
      }
    }
    for (const [lowest, others] of contract) {
      const set = new Set();
      set.add(G.getCurrentPosition(lowest));
      for (const v of others) set.add(G.getCurrentPosition(v));
      if (set.size > 1) G.contractVertexSet(set);
    }
    for (const orig of markForCactus) {
      if (G.n() > 2) {
        const n = G.getCurrentPosition(orig);
        if (G.get_first_invalid_edge(n) !== 1) continue;
        const t = G.getEdgeTarget(n, 0);
        if (G.isEmpty(t)) continue;
        const vtx_in_t = G.containedVertices(t)[0];
        cactusEdge.push([vtx_in_t, G.containedVertices(n).slice()]);
        G.deleteVertex(n);
      }
    }
    return cactusEdge;
  };

  HeavyEdges.prototype.contractCycleEdges = function (G) {
    const cycleEdges = [];
    for (let n = 0; n < G.n(); n++) {
      if (G.get_first_invalid_edge(n) === 2
          && G.getWeightedNodeDegree(n) === this.mincut) {
        let n0 = G.getEdgeTarget(n, 0);
        let n1 = G.getEdgeTarget(n, 1);
        if (G.isEmpty(n0) || G.isEmpty(n1)) continue;
        const w0 = G.getEdgeWeight(n, 0);
        const w1 = G.getEdgeWeight(n, 1);
        let rev = 0;
        if (w1 > w0) { rev = 1; n0 = n1; }
        if (w1 < w0) { n1 = n0; }
        const p0 = G.containedVertices(n0)[0];
        const p1 = G.containedVertices(n1)[0];
        const contained = G.containedVertices(n).slice();
        G.setContainedVertices(n, []);
        for (const c of contained) G.setCurrentPosition(c, UNDEFINED_NODE);
        G.contractEdgeSparseTarget(n0, G.getReverseEdge(n, rev));
        cycleEdges.push([[p0, p1], contained]);
        n--;  // re-examine because indices may shift
      } else if (G.get_first_invalid_edge(n) === 2
                 && G.getEdgeWeight(n, 0) !== G.getEdgeWeight(n, 1)) {
        const h1 = G.getEdgeWeight(n, 0) < G.getEdgeWeight(n, 1);
        const heavier = h1 ? 1 : 0;
        const ngbr = G.getEdgeTarget(n, heavier);
        const rev = G.getReverseEdge(n, heavier);
        G.contractEdgeSparseTarget(ngbr, rev);
        n--;
      }
    }
    return cycleEdges;
  };

  HeavyEdges.prototype.reInsertCycles = function (G, toInsert) {
    for (let i = toInsert.length; i-- > 0; ) {
      const [pp, cont] = toInsert[i];
      const n0 = G.getCurrentPosition(pp[0]);
      const n1 = G.getCurrentPosition(pp[1]);
      const reIns = G.new_empty_node();
      if (n0 === n1) {
        G.new_edge_order(n0, reIns, this.mincut);
        G.setContainedVertices(reIns, cont);
        for (const v of cont) G.setCurrentPosition(v, reIns);
      } else {
        let e = UNDEFINED_EDGE;
        const ne = G.get_first_invalid_edge(n0);
        for (let arc = 0; arc < ne; arc++) {
          if (G.getEdgeTarget(n0, arc) === n1) { e = arc; break; }
        }
        if (e === UNDEFINED_EDGE) throw new Error("reInsertCycles: vertices not neighbours");
        G.new_edge_order(n0, reIns, this.mincut / 2);
        G.new_edge_order(n1, reIns, this.mincut / 2);
        const w01 = G.getEdgeWeight(n0, e);
        if (w01 === this.mincut / 2) G.deleteEdge(n0, e);
        else G.setEdgeWeight(n0, e, w01 - this.mincut / 2);
      }
      G.setContainedVertices(reIns, cont);
      for (const v of cont) G.setCurrentPosition(v, reIns);
    }
  };

  HeavyEdges.prototype.reInsertVertices = function (G, toInsert) {
    for (let i = toInsert.length; i-- > 0; ) {
      const [t, cont] = toInsert[i];
      const curr = G.getCurrentPosition(t);
      const vtx = G.new_empty_node();
      G.new_edge_order(curr, vtx, this.mincut);
      G.setContainedVertices(vtx, cont);
      for (const v of G.containedVertices(vtx)) G.setCurrentPosition(v, vtx);
    }
  };

  NS.HeavyEdges = HeavyEdges;
})();
