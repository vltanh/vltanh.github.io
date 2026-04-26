// SBM kernel: browser-loadable JS port of gt.generate_sbm
// (graph-tool's micro-canonical degree-corrected SBM with
// micro_ers=true, micro_degs=true).
//
// Faithful to graph-tool's UrnSampler<Value, false> kernel: per-block
// stub urn (node id repeated k_u times); for each (r, s) pair with
// r <= s, draw e_{rs} stubs without replacement; r==s diagonal claims
// floor(e_{rr}/2) edges, each consuming two stubs from urn[r]; output
// is a multigraph (loops + parallels emerge naturally).
//
// Sampling op is swap-with-last + pop, matching the C++ kernel in
// tools/sbm/kernel_check.cpp. The harness `tools/viz_check/sbm/
// kernel_check.mjs` byte-matches both the C++ kernel and a fresh JS
// replay; this kernel is the same algorithm exposed for the page.
//
// Randomness: caller passes a JS rng (() -> [0,1)); seeded externally.
// Byte-equality with graph-tool's RNG is not the bar; structural
// faithfulness is.
//
// Exposed as window.SBMKernel:
//   popRandomFromUrn(urn, rng) -> [value, index]
//   popAt(urn, i) -> value     (replay; mutates urn the same way)
//   buildBlockPairs(numBlocks) -> [[r, s], ...] with r <= s, row-major
//   buildPairBudget(eRs, blockPairs) -> { "r|s": edges_to_draw }
//   sampleMicroSBM({blocks, degrees, eRs, numBlocks, rng}) ->
//     { edges, trace, stats } where trace[k] = {bp:[r,s], aIdx, bIdx,
//       u, v, intra, loop, multi}
//   buildTraceFrom(urns, budget, blockPairs, seenPairs, rng) -> trace
//   replayTrace(urns, budget, seenPairs, prefixTrace) ->
//     mutates inputs to post-prefix state for mid-walk reseed
(function () {
  "use strict";

  function popRandomFromUrn(urn, rng) {
    const i = Math.floor(rng() * urn.length);
    const v = urn[i];
    urn[i] = urn[urn.length - 1];
    urn.pop();
    return [v, i];
  }

  function popAt(urn, i) {
    const v = urn[i];
    urn[i] = urn[urn.length - 1];
    urn.pop();
    return v;
  }

  function buildBlockPairs(numBlocks) {
    const out = [];
    for (let r = 0; r < numBlocks; r++) {
      for (let s = r; s < numBlocks; s++) out.push([r, s]);
    }
    return out;
  }

  function buildPairBudget(eRs, blockPairs) {
    // eRs[r][s] = total stub-count from block r into block s; symmetric.
    // For r==s pair, edges = floor(eRs[r][r] / 2). For r!=s, edges = eRs[r][s].
    const out = {};
    blockPairs.forEach(([r, s]) => {
      const c = eRs[r][s] || 0;
      out[`${r}|${s}`] = c === 0 ? 0 : (r === s ? Math.floor(c / 2) : c);
    });
    return out;
  }

  // Build trace forward from (urns, budget, seenPairs, rng), mutating
  // urns + budget + seenPairs in place. Each entry in the returned trace
  // covers one edge (one diagonal-pair-draw or one off-diagonal pair).
  // Element types in `urns[r]` are opaque (the kernel only inspects
  // `.node` to detect loops + dedup). Page passes `{node, geomIdx}`
  // objects so the spoke renderer can highlight which stub got consumed;
  // harness passes raw integers.
  function buildTraceFrom(urns, budget, blockPairs, seenPairs, rng) {
    const out = [];
    for (let bpi = 0; bpi < blockPairs.length; bpi++) {
      const [r, s] = blockPairs[bpi];
      let left = budget[`${r}|${s}`];
      // has_n check matching graph-tool's UrnSampler<_, false>::has_n
      // (kernel_check.cpp:168-175): the pair claims `ers` stubs from each
      // urn (ers = mrs off-diagonal, 2*mrs on-diagonal). Throw upfront so
      // malformed inputs surface loudly instead of silently producing a
      // truncated edge set.
      if (left > 0) {
        const ers = (r === s) ? 2 * left : left;
        if (urns[r].length < ers) {
          throw new Error(`SBM has_n: urn r=${r} size=${urns[r].length} < ers=${ers}`);
        }
        if (r !== s && urns[s].length < ers) {
          throw new Error(`SBM has_n: urn s=${s} size=${urns[s].length} < ers=${ers}`);
        }
      }
      while (left > 0) {
        const [a, ia] = popRandomFromUrn(urns[r], rng);
        const [b, ib] = popRandomFromUrn(r === s ? urns[r] : urns[s], rng);
        const u = (a && a.node !== undefined) ? a.node : a;
        const v = (b && b.node !== undefined) ? b.node : b;
        const loop = u === v;
        const lo = Math.min(u, v), hi = Math.max(u, v);
        const key = `${lo}|${hi}`;
        const prev = seenPairs.get(key) || 0;
        const multi = !loop && prev >= 1;
        seenPairs.set(key, prev + 1);
        out.push({ bp: [r, s], a, b, aIdx: ia, bIdx: ib, u, v, intra: r === s, loop, multi });
        left -= 1;
      }
    }
    return out;
  }

  // Replay a prefix of a previously-recorded trace into fresh urns +
  // budget + seenPairs to bring them to the post-prefix state. Mid-walk
  // reseed uses this to restore state then call buildTraceFrom for the
  // tail with a new rng. Recorded indices are valid because swap-with-
  // last is deterministic given the index.
  function replayTrace(urns, budget, seenPairs, prefixTrace) {
    for (const t of prefixTrace) {
      const [r, s] = t.bp;
      popAt(urns[r], t.aIdx);
      popAt(r === s ? urns[r] : urns[s], t.bIdx);
      budget[`${r}|${s}`] -= 1;
      if (!t.loop) {
        const lo = Math.min(t.u, t.v), hi = Math.max(t.u, t.v);
        const key = `${lo}|${hi}`;
        seenPairs.set(key, (seenPairs.get(key) || 0) + 1);
      }
    }
  }

  function buildIntegerUrns(blocks, degrees, numBlocks) {
    const urns = [];
    for (let r = 0; r < numBlocks; r++) urns.push([]);
    for (let v = 0; v < blocks.length; v++) {
      const r = blocks[v];
      for (let k = 0; k < degrees[v]; k++) urns[r].push(v);
    }
    return urns;
  }

  // Top-level sampler: returns the full edge multigraph + the trace +
  // dedup stats. urns built from {blocks, degrees}; eRs is the symmetric
  // edge-count matrix. Mirrors gt.generate_sbm(micro_ers=true,
  // micro_degs=true) on (k, e) pairs that satisfy the equality form
  // (sum_{u: b_u=r} k_u == sum_s e_{rs}).
  function sampleMicroSBM(args) {
    const { blocks, degrees, eRs, numBlocks, rng } = args;
    const urns = buildIntegerUrns(blocks, degrees, numBlocks);
    const blockPairs = buildBlockPairs(numBlocks);
    const budget = buildPairBudget(eRs, blockPairs);
    const seen = new Map();
    const trace = buildTraceFrom(urns, budget, blockPairs, seen, rng);
    const edges = trace.map(t => [t.u, t.v]);
    const loops = trace.filter(t => t.loop).length;
    const multi = trace.filter(t => t.multi).length;
    return {
      edges,
      trace,
      stats: { preEdges: trace.length, postEdges: trace.length - loops - multi, nLoops: loops, nParallels: multi },
    };
  }

  window.SBMKernel = {
    popRandomFromUrn,
    popAt,
    buildBlockPairs,
    buildPairBudget,
    buildIntegerUrns,
    buildTraceFrom,
    replayTrace,
    sampleMicroSBM,
  };
})();
