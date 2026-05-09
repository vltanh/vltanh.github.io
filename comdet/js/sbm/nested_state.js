/* NestedBlockState. Hierarchical SBM state composed of multiple
 * flat BlockStates, one per level. Level l > 0 is a flat BlockState
 * on the level-(l-1) block-multigraph (vertices = nonempty level-(l-1)
 * blocks, edges = level-(l-1) e_rs counts as weighted undirected
 * edges with self-loops). Upper levels are always NDC; level 0 uses
 * the user-supplied mode (dc/ndc/pp).
 *
 * Self-consistent nested entropy = sum_l levels[l].entropy(). The
 * formula is NOT byte-equal to graph-tool's NestedBlockState.entropy
 * (which uses dense + multigraph eterm + a Lrecdx coupling between
 * levels per nested_blockmodel.py:359 + graph_blockmodel_entropy.hh
 * :140). The viz_check tracer pairs this JS leg with a C++ tracer
 * that runs the identical formula under std::mt19937, so cpp + JS
 * replay byte-equal across all levels.
 *
 * SBM.buildLevelGraph is exported as a tracer hook so the JS replay
 * leg can drive the same per-sweep e_rs propagation cpp does. It
 * is not part of the public NestedBlockState surface.
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.SBM
      || !window.COMDET.SBM.BlockState
      || !window.COMDET.SBM.Graph) return;
  const SBM = window.COMDET.SBM;

  // Build a level-(l+1) (graph, init) pair from a level-l (graph, state).
  // Edges of the new graph carry the e_rs counts of the parent state
  // (self-loops carry e_rr/2; off-diagonals carry e_rs as-is). Vertices
  // are renumbered to 0..Bne_l-1 via the nonEmpty[i] -> i remap. The
  // hierarchy entry b_{l+1} is keyed on parent block ids; relabel it
  // so the new BlockState's init aligns with the compacted ids.
  function buildLevelGraph(parentGraph, parentState, b_next) {
    const N = parentGraph.vcount();
    const mem = parentState.blockMembership();
    const ers = new Map();
    // Pair encoding: assumes block ids < 2^20 = ~1M. Comdet pages run
    // on ~1k vertex fixtures; bumping to a longer key (or a string)
    // is the lift if larger graphs ever land here.
    const KEY_MUL = 1 << 20;
    function key(r, s) { return r < s ? r * KEY_MUL + s : s * KEY_MUL + r; }
    for (let v = 0; v < N; v++) {
      const r = mem[v];
      const nb = parentGraph.neighbours(v);
      const nbE = parentGraph.neighbourEdges(v);
      for (let i = 0; i < nb.length; i++) {
        const u = nb[i];
        if (u <= v) continue;
        const w = parentGraph.edgeWeight(nbE[i]);
        const s = mem[u];
        const k = key(r, s);
        ers.set(k, (ers.get(k) || 0) + w);
      }
      const sw = parentGraph.nodeSelfWeight(v);
      if (sw > 0) {
        const k = key(r, r);
        ers.set(k, (ers.get(k) || 0) + sw);
      }
    }
    const nonEmpty = parentState.nonEmptyBlocks();
    const Bne = nonEmpty.length;
    const remap = new Int32Array(N + 1);
    for (let i = 0; i < remap.length; i++) remap[i] = -1;
    for (let i = 0; i < Bne; i++) remap[nonEmpty[i]] = i;
    const edges = [];
    for (const [k, w] of ers) {
      const r = Math.floor(k / KEY_MUL), s = k % KEY_MUL;
      const rr = remap[r], ss = remap[s];
      if (rr < 0 || ss < 0) continue;
      edges.push([rr, ss, w]);
    }
    const newGraph = SBM.Graph(Bne, edges, { correctSelfLoops: false });
    const init = new Int32Array(Bne);
    // OOB parent ids (mid-mcmc "open new block" candidates) coerce to 0;
    // cpp's flat_traced.cpp:buildLevelGraph defaults the same way.
    for (let i = 0; i < Bne; i++) init[i] = (b_next[nonEmpty[i]] | 0);
    return { graph: newGraph, init: init };
  }

  function NestedBlockState(graph, opts) {
    opts = opts || {};
    const mode = opts.mode || "dc";
    const hierarchy = opts.hierarchy;
    if (!hierarchy || hierarchy.length === 0)
      throw new Error("NestedBlockState requires opts.hierarchy = [b0, b1, ...]");

    const graphs = [graph];
    const states = [SBM.BlockState(graph, { mode: mode, init: hierarchy[0] })];
    for (let l = 1; l < hierarchy.length; l++) {
      const built = buildLevelGraph(graphs[l - 1], states[l - 1], hierarchy[l]);
      graphs.push(built.graph);
      states.push(SBM.BlockState(built.graph, { mode: "ndc", init: built.init }));
    }

    function entropy() {
      let S = 0;
      for (let l = 0; l < states.length; l++) S += states[l].entropy();
      return S;
    }
    function levelEntropy(l) { return states[l].entropy(); }
    function level(l) { return states[l]; }
    function levelGraph(l) { return graphs[l]; }
    function levelMembership(l) { return states[l].blockMembership(); }

    return {
      get nLevels() { return states.length; },
      level: level,
      levelGraph: levelGraph,
      levelMembership: levelMembership,
      levelEntropy: levelEntropy,
      entropy: entropy,
    };
  }

  SBM.NestedBlockState = NestedBlockState;
  SBM.buildLevelGraph = buildLevelGraph;
})();
