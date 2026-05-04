/* Stoer-Wagner global minimum cut for small undirected unweighted graphs.
 *
 * Standin for VieCut's cactus mincut on the gallery's 32-node fixture.
 * `reference_wcc_paper.md` notes Stoer-Wagner is sufficient for the
 * gallery's purposes; for size-1 cuts (the regime CC/WCC actually
 * exercise) the two backends agree. We do not attempt the cactus
 * structure or balanced-cut tie-break that VieCut adds.
 *
 * Adjacency representation: node-keyed Map<int, Map<int, weight>>. Self
 * loops are filtered on insert. Multi-edges accumulate weight.
 *
 * Public API:
 *   COMDET.MINCUT.stoerWagner(nodeIds, edges, [opts]) -> {
 *     cutValue: int,
 *     inPartition: number[],   // node ids on one side of the cut
 *     outPartition: number[],  // node ids on the other side
 *     phases: [ { s, t, cut, mergedSide } ],   // for the page walker
 *   }
 *
 * Worst case O(V*E). Re-runs are deterministic (no RNG). For n < 2 the
 * function returns a sentinel cut value of Infinity per VieCut behaviour
 * on disconnected pieces; the caller should not invoke mincut on a
 * disconnected subgraph in the first place.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  function buildAdj(nodeIds, edges) {
    const adj = new Map();
    nodeIds.forEach(function (id) { adj.set(id, new Map()); });
    edges.forEach(function (e) {
      const u = e[0], v = e[1];
      if (u === v) return;
      if (!adj.has(u) || !adj.has(v)) return;
      adj.get(u).set(v, (adj.get(u).get(v) || 0) + 1);
      adj.get(v).set(u, (adj.get(v).get(u) || 0) + 1);
    });
    return adj;
  }

  function stoerWagner(nodeIds, edges) {
    const n = nodeIds.length;
    if (n < 2) {
      return {
        cutValue: Infinity,
        inPartition: nodeIds.slice(),
        outPartition: [],
        phases: [],
      };
    }
    const adj = buildAdj(nodeIds, edges);
    // mergedSet[v] = list of original ids absorbed into super-node v.
    const mergedSet = new Map();
    nodeIds.forEach(function (id) { mergedSet.set(id, [id]); });

    let alive = nodeIds.slice();
    let bestCut = Infinity;
    let bestSide = null;
    const phases = [];

    while (alive.length > 1) {
      const start = alive[0];
      const added = new Set([start]);
      const order = [start];
      const w = new Map();
      alive.forEach(function (v) { if (v !== start) w.set(v, 0); });
      const sNeigh = adj.get(start);
      sNeigh.forEach(function (val, key) {
        if (w.has(key)) w.set(key, val);
      });

      while (added.size < alive.length) {
        let pick = null, pickW = -Infinity;
        for (let i = 0; i < alive.length; i++) {
          const v = alive[i];
          if (added.has(v)) continue;
          const wv = w.get(v) || 0;
          if (wv > pickW) { pickW = wv; pick = v; }
        }
        order.push(pick);
        added.add(pick);
        const pNeigh = adj.get(pick);
        pNeigh.forEach(function (val, key) {
          if (added.has(key)) return;
          if (!w.has(key)) return;
          w.set(key, (w.get(key) || 0) + val);
        });
      }

      const t = order[order.length - 1];
      const s = order[order.length - 2];
      const cutValue = w.get(t) || 0;
      const tSide = mergedSet.get(t).slice();

      phases.push({ s: s, t: t, cut: cutValue, mergedSide: tSide.slice() });

      if (cutValue < bestCut) {
        bestCut = cutValue;
        bestSide = tSide.slice();
      }

      // Merge t into s: combine adjacency, drop t.
      const sNeighMap = adj.get(s);
      const tNeighMap = adj.get(t);
      tNeighMap.forEach(function (val, key) {
        if (key === s) return;
        const cur = sNeighMap.get(key) || 0;
        sNeighMap.set(key, cur + val);
        const nb = adj.get(key);
        if (nb) {
          const prev = nb.get(t) || 0;
          nb.delete(t);
          nb.set(s, (nb.get(s) || 0) + prev);
        }
      });
      sNeighMap.delete(t);
      adj.delete(t);
      mergedSet.set(s, mergedSet.get(s).concat(mergedSet.get(t)));
      mergedSet.delete(t);
      alive = alive.filter(function (v) { return v !== t; });
    }

    const sideSet = new Set(bestSide);
    const inPart = [], outPart = [];
    nodeIds.forEach(function (id) {
      if (sideSet.has(id)) inPart.push(id);
      else outPart.push(id);
    });
    return {
      cutValue: bestCut,
      inPartition: inPart,
      outPartition: outPart,
      phases: phases,
    };
  }

  C.MINCUT = { stoerWagner: stoerWagner };
})();
