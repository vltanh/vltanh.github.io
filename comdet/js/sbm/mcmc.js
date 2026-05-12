/* SBM Metropolis-Hastings sweep. Port of graph-tool's mcmc_sweep
 * (release-2.98 src/graph/inference/loops/mcmc_loop.hh:104-200) with
 * the canonical c→∞ proposal limit (uniform over current candidates).
 *
 * Algorithm + departures from canonical in
 *   community-detection/docs/algorithms/sbm.md §"MCMC sweep"
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.SBM
      || !window.COMDET.SBM.BlockState
      || !window.COMDET.SBM.UTIL) return;
  const SBM = window.COMDET.SBM;
  const U = SBM.UTIL;

  function mcmcSweep(state, rng, opts) {
    opts = opts || {};
    const beta = opts.beta == null ? 1.0 : +opts.beta;
    const recordTrace = !!opts.recordTrace;
    const recordCandidates = !!opts.recordCandidates;
    // [TRACE-SBM-PROBES] When true (set by tools/viz_check/sbm/
    // self_rng_check.mjs) extend each trace entry with pickIdx +
    // subsetSE_before/after + expArg/expVal probes that mirror cpp
    // flat_traced.cpp's `runSweep` per-visit emit. No effect on
    // production walker semantics. Mirrors gap-audit items 2, 3, 5.
    const recordProbes = !!opts.recordProbes;
    const proposalOracle = opts.proposalOracle || null;
    const visitOrderInj = opts.visitOrder || null;
    const N = state.N;
    let order;
    if (visitOrderInj) {
      // Replaces the shuffled-identity order; bypasses rng draws.
      order = Array.from(visitOrderInj);
    } else {
      order = new Array(N);
      for (let v = 0; v < N; v++) order[v] = v;
      // Backward Fisher-Yates via SBM.UTIL.shuffle (mirrors cpp tracer's
      // jsShuffle at flat_traced.cpp:62).
      U.shuffle(order, rng);
    }

    const traces = recordTrace ? [] : null;
    let accepted = 0;

    // [TRACE-SBM-DRAWS] gap-audit item 4 (row B). When `recordProbes`
    // is set the harness uses `rng.drawCount` (added in rng.js) to
    // record the per-visit raw() delta. Capability gated on the RNG
    // surfacing the counter; production walker RNGs that don't expose
    // it fall back to undefined (probe omitted), so the change is
    // backward-compatible.
    const hasDrawCount = recordProbes && typeof rng.drawCount === "function";
    for (let i = 0; i < order.length; i++) {
      const drawsBefore = hasDrawCount ? rng.drawCount() : 0;
      const v = order[i];
      const fromR = state.blockOf(v);
      const cands = candidatePool(state, v);
      let pickIdx, toS, oracleVerdict = null;
      if (proposalOracle) {
        // Oracle bypasses pick + accept draws.
        oracleVerdict = proposalOracle(v, i, cands);
        toS = oracleVerdict.to_block;
        pickIdx = cands.indexOf(toS);
      } else {
        // [TRACE-SBM-PICKIDX] gap-audit item 5 (rows C, J). pickIdx
        // is the rng.int output that maps the uniform draw to a cand
        // slot; recording it separates "cands ordering drift" from
        // "RNG distribution mapping drift" when toS diverges vs cpp.
        pickIdx = rng.int(0, cands.length - 1);
        toS = cands[pickIdx];
      }

      let candDeltas = null;
      let dS, subsetBefore = 0, subsetAfter = 0;
      if (recordCandidates) {
        candDeltas = new Array(cands.length);
        let pickedDelta = 0;
        for (let j = 0; j < cands.length; j++) {
          const c = cands[j];
          const d = c === fromR ? 0 : state.virtualMove(v, c);
          candDeltas[j] = { s: c, dS: d };
          if (j === pickIdx) pickedDelta = d;
        }
        dS = pickedDelta;
      } else if (recordProbes && toS !== fromR) {
        // [TRACE-SBM-SUBSETSE] gap-audit item 2 (row M). Capture
        // subsetSE before/after via virtualMoveTraced; same number of
        // moveVertex calls + same operand order as virtualMove, so
        // dS bits stay byte-equal to the non-probe path.
        const vm = state.virtualMoveTraced(v, toS);
        dS = vm.dS;
        subsetBefore = vm.before;
        subsetAfter = vm.after;
      } else {
        dS = (toS === fromR) ? 0 : state.virtualMove(v, toS);
      }

      // [TRACE-SBM-ACCEPT-FP] gap-audit item 3 (rows D, F). Lift
      // acceptU + expArg + expVal out of the inline `||` so probes
      // can record them without changing short-circuit semantics
      // (when dS<=0 the rng draw still elides and accept=true).
      let accept;
      let acceptU = 0, expArg = 0, expVal = 1;
      if (proposalOracle) {
        accept = !!oracleVerdict.accept;
      } else if (dS <= 0) {
        accept = true;
      } else {
        acceptU = rng.raw() / 0x100000000;
        expArg = -beta * dS;
        expVal = Math.exp(expArg);
        accept = acceptU < expVal;
      }
      const committed = accept && toS !== fromR;
      if (committed) {
        state.moveVertex(v, toS);
        accepted += 1;
      }
      if (recordTrace) {
        const entry = {
          v: v, fromR: fromR, toS: toS,
          cands: cands.slice(), dS: dS, accept: accept, accepted: committed,
        };
        if (recordCandidates) entry.candidates = candDeltas;
        if (recordProbes) {
          entry.pickIdx = pickIdx;
          entry.subsetSE_before = subsetBefore;
          entry.subsetSE_after = subsetAfter;
          entry.acceptU = acceptU;
          entry.expArg = expArg;
          entry.expVal = expVal;
          if (hasDrawCount) entry.rng_draws = rng.drawCount() - drawsBefore;
        }
        traces.push(entry);
      }
    }
    return { traces: traces, accepted: accepted };
  }

  function candidatePool(state, v) {
    // Array.from() - nonEmptyBlocks returns Int32Array (no push()).
    const nonEmpty = state.nonEmptyBlocks();
    const cands = Array.from(nonEmpty);
    if (state.blockSize(state.blockOf(v)) > 1) {
      let maxId = -1;
      for (let i = 0; i < cands.length; i++) if (cands[i] > maxId) maxId = cands[i];
      const freshId = maxId + 1;
      // Ensure the fresh-block id is a live slot. Mirrors graph-tool
      // `get_empty_block` (graph_blockmodel.hh:1513-1528) which calls
      // `add_block()` when `_empty_groups.empty()`, and the cpp tracer
      // (tools/viz_check/sbm/instrumented/flat_traced.cpp `candidatePool`
      // post-2026-05-12 revert+redo).
      if (freshId >= state.B) {
        state.addBlock(freshId - state.B + 1);
      }
      cands.push(freshId);
    }
    return cands;
  }

  function equilibrate(state, rng, opts) {
    opts = opts || {};
    const sweeps = opts.sweeps || 50;
    const recordTrace = opts.recordTrace !== false;
    const allTraces = recordTrace ? [] : null;
    const series = [{
      sweep: 0, S: state.entropy(), B: state.nonEmptyBlocks().length, accepted: 0,
    }];
    for (let i = 0; i < sweeps; i++) {
      const out = mcmcSweep(state, rng, {
        beta: opts.beta, recordTrace: recordTrace,
        recordCandidates: opts.recordCandidates,
      });
      if (recordTrace) {
        for (let t = 0; t < out.traces.length; t++) {
          out.traces[t].sweep = i;
          allTraces.push(out.traces[t]);
        }
      }
      series.push({
        sweep: i + 1, S: state.entropy(),
        B: state.nonEmptyBlocks().length,
        accepted: out.accepted,
      });
    }
    return { traces: allTraces, series: series };
  }

  SBM.mcmcSweep = mcmcSweep;
  SBM.equilibrate = equilibrate;
  SBM.candidatePool = candidatePool;
})();
