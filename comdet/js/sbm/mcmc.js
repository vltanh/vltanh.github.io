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
      || !window.COMDET.LOUVAIN) return;
  const SBM = window.COMDET.SBM;
  const LV = window.COMDET.LOUVAIN;

  function mcmcSweep(state, rng, opts) {
    opts = opts || {};
    const beta = opts.beta == null ? 1.0 : +opts.beta;
    const recordTrace = !!opts.recordTrace;
    const recordCandidates = !!opts.recordCandidates;
    const N = state.N;
    const order = new Array(N);
    for (let v = 0; v < N; v++) order[v] = v;
    LV.shuffle(order, rng);

    const traces = recordTrace ? [] : null;
    let accepted = 0;

    for (let i = 0; i < order.length; i++) {
      const v = order[i];
      const fromR = state.blockOf(v);
      const cands = candidatePool(state, v);
      const pickIdx = rng.int(0, cands.length - 1);
      const toS = cands[pickIdx];

      let candDeltas = null;
      let dS;
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
      } else {
        dS = (toS === fromR) ? 0 : state.virtualMove(v, toS);
      }

      const accept = dS <= 0 || (rng.raw() / 0x100000000) < Math.exp(-beta * dS);
      const committed = accept && toS !== fromR;
      if (committed) {
        state.moveVertex(v, toS);
        accepted += 1;
      }
      if (recordTrace) {
        const entry = { v: v, fromR: fromR, toS: toS, dS: dS, accepted: committed };
        if (recordCandidates) entry.candidates = candDeltas;
        traces.push(entry);
      }
    }
    return { traces: traces, accepted: accepted };
  }

  function candidatePool(state, v) {
    const nonEmpty = state.nonEmptyBlocks();
    const cands = nonEmpty.slice();
    if (state.blockSize(state.blockOf(v)) > 1) {
      let maxId = -1;
      for (let i = 0; i < nonEmpty.length; i++) if (nonEmpty[i] > maxId) maxId = nonEmpty[i];
      cands.push(maxId + 1);
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
