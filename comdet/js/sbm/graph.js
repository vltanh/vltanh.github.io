/* SBM Graph. Faithful port of the cpp tracer's Graph struct
 * (community-detection/tools/viz_check/sbm/instrumented/flat_traced.cpp,
 * lines 284-352 + 798-825) with the Peixoto 2017 doubled-diagonal
 * convention for self-loops:
 *
 *   strength[v] = sum over edges incident to v with each self-loop
 *                 contributing 2*w (vs 1*w for non-self per endpoint).
 *
 * Mirrors flat_traced.cpp:340 (`g.strength[u] += 2.0` for self-loop)
 * and flat_traced.cpp:815 (`out.g.strength[rr] += 2.0 * w` for level-
 * 1+ aggregated self-loops). Per Peixoto 2017 Eq 43, the DC-SBM degree
 * sequence k_v matches strength(v) under this convention.
 *
 * Diverges from comdet/js/louvain/louvain.js Graph.strength (which
 * counts self-loops ONCE: that mirrors gen-louvain's
 * graph_binary.h:130-143 weighted_degree). The two algorithms ship
 * with their own Graph because their canonicals disagree on the
 * self-loop convention.
 *
 * Adjacency layout (matches cpp tracer):
 *   - Each non-self edge appears in BOTH endpoint lists with weight w.
 *   - Each self-loop appears ONCE in its endpoint's list with weight w.
 *   - selfW[v] accumulates per-node self-loop weight (raw, not doubled).
 *   - nodeSelfWeight(v) returns selfW[v]; consumers (block_state.js)
 *     apply the doubling at the e_rr accumulator step (Peixoto Eq 22's
 *     2 e_rr in the diagonal entropy term).
 *
 * Surface restricted to what SBM block_state / nested_state actually
 * touch: vcount, ecount, totalEdgeWeight, neighbours, neighbourEdges,
 * neighbourWeights, edgeWeight, nodeSelfWeight, strength, edge.
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.SBM) return;

  function Graph(n, edges, opts) {
    opts = opts || {};
    const directed = !!opts.directed;
    const correctSelfLoops = !!opts.correctSelfLoops;
    const m = edges.length;
    const eu = new Int32Array(m);
    const ev = new Int32Array(m);
    const ew = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      eu[i] = edges[i][0] | 0;
      ev[i] = edges[i][1] | 0;
      ew[i] = edges[i].length > 2 ? +edges[i][2] : 1.0;
    }
    const adjE = new Array(n);
    const adjN = new Array(n);
    const adjW = new Array(n);
    for (let i = 0; i < n; i++) { adjE[i] = []; adjN[i] = []; adjW[i] = []; }
    // Self-loop accumulator (raw, not doubled). Mirrors cpp tracer's
    // selfW[v] (flat_traced.cpp:288).
    const selfW = new Float64Array(n);
    // strength[v]: self-twice convention. Mirrors cpp tracer's
    // strength[v] (flat_traced.cpp:289 + 340 / 346-347).
    const strength = new Float64Array(n);
    for (let e = 0; e < m; e++) {
      const u = eu[e], v = ev[e], w = ew[e];
      adjE[u].push(e); adjN[u].push(v); adjW[u].push(w);
      if (u === v) {
        selfW[u] += w;
        strength[u] += 2 * w;          // Peixoto self-loop doubled.
      } else {
        adjE[v].push(e); adjN[v].push(u); adjW[v].push(w);
        strength[u] += w;
        strength[v] += w;
      }
    }
    // totalEdgeWeight: sum over edges, each once. Used for edges_dl
    // (Peixoto 2017 Eq 23 / get_edges_dl(B, E, g)).
    let totalEdgeWeight = 0;
    for (let e = 0; e < m; e++) totalEdgeWeight += ew[e];

    return {
      vcount: function () { return n; },
      ecount: function () { return m; },
      isDirected: function () { return directed; },
      correctSelfLoops: function () { return correctSelfLoops; },
      edge: function (e) { return [eu[e], ev[e]]; },
      edgeWeight: function (e) { return ew[e]; },
      nodeSelfWeight: function (v) { return selfW[v]; },
      neighbours: function (v) { return adjN[v]; },
      neighbourEdges: function (v) { return adjE[v]; },
      neighbourWeights: function (v) { return adjW[v]; },
      strength: function (v) { return strength[v]; },
      totalEdgeWeight: function () { return totalEdgeWeight; },
    };
  }

  window.COMDET.SBM.Graph = Graph;
})();
