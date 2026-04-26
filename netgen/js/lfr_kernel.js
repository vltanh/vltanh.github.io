// LFR kernel: browser-loadable JS port of LFR's degree-sequence
// sampler + cluster-size sampler stages. Faithful to
// externals/lfr/unweighted_undirected/Sources/benchm.cpp.
//
// Stages covered (line-for-line ports of benchm.cpp):
//   - solve_dmin (bisection over the average-degree integral)
//   - integer_average parity test (min vs min+1)
//   - powerlaw cumulative + lower_bound integer sampler
//   - degree-sequence parity correction (sum even)
//   - cluster-size sampler with the max_degree+1 seed branch
//
// Stages NOT yet covered (defer to follow-up):
//   - internal/external degree split + global mu (per benchm.cpp:
//     `internal_degree=(1-mu)*degree_seq[i] + Bernoulli(frac)`)
//   - per-cluster + global config-model edge sampling
//     (`build_subgraph`, `build_subgraphs`)
//   - rewire passes (`internal_kin`, `erase_link`, `arrange`)
//
// Randomness: caller passes a JS rng (() -> [0,1)). Page uses
// d3.randomLcg + per-stage seed; byte-equality with LFR's ran4() is
// not the bar.
//
// Existing harness: tools/viz_check/lfr/kernel_check.mjs already
// verifies the degree-sequence stage byte-equal vs the canonical
// instrumented binary. The body below is the same implementation,
// re-exposed as window.LFRKernel for the page.
//
// Exposed as window.LFRKernel:
//   integral(a, b)
//   averageDegree(dmax, dmin, gamma)
//   solveDmin(dmax, dmed, gamma)
//   integerAverage(n, min, tau)
//   powerlawCumulative(n, min, tau)
//   lowerBound(arr, target)
//   sampleDegreeSequence({ N, k_avg, max_k, t1, rng }) ->
//     { degrees, min_degree, cumulative }
//   sampleClusterSizes({ N, max_internal_degree, c_min, c_max, t2,
//                        rng, fixed_range, overlap_extra }) ->
//     { sizes, cumulative }
(function () {
  "use strict";

  function integral(a, b) {
    if (Math.abs(a + 1) > 1e-10) return (1 / (a + 1)) * Math.pow(b, a + 1);
    return Math.log(b);
  }

  function averageDegree(dmax, dmin, gamma) {
    return (
      (1 / (integral(gamma, dmax) - integral(gamma, dmin))) *
      (integral(gamma + 1, dmax) - integral(gamma + 1, dmin))
    );
  }

  function solveDmin(dmax, dmed, gamma) {
    let dmin_l = 1;
    let dmin_r = dmax;
    let avg1 = averageDegree(dmin_r, dmin_l, gamma);
    let avg2 = dmin_r;
    if (avg1 - dmed > 0 || avg2 - dmed < 0) return -1;
    while (Math.abs(avg1 - dmed) > 1e-7) {
      const mid = (dmin_r + dmin_l) / 2;
      const temp = averageDegree(dmax, mid, gamma);
      if ((temp - dmed) * (avg2 - dmed) > 0) {
        avg2 = temp;
        dmin_r = mid;
      } else {
        avg1 = temp;
        dmin_l = mid;
      }
    }
    return dmin_l;
  }

  function integerAverage(n, min, tau) {
    let a = 0;
    for (let h = min; h < n + 1; h++) a += Math.pow(1 / h, tau);
    let pf = 0;
    for (let i = min; i < n + 1; i++) pf += (1 / a) * Math.pow(1 / i, tau) * i;
    return pf;
  }

  function powerlawCumulative(n, min, tau) {
    let a = 0;
    for (let h = min; h < n + 1; h++) a += Math.pow(1 / h, tau);
    const cum = [];
    let pf = 0;
    for (let i = min; i < n + 1; i++) {
      pf += (1 / a) * Math.pow(1 / i, tau);
      cum.push(pf);
    }
    return cum;
  }

  function lowerBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Faithful port of benchm.cpp:1681-1730 (the degree-sequence sampler):
  //   solve_dmin → trunc → integer_average parity → powerlaw cumulative
  //   → per-node lower_bound sample → sort asc → parity correction.
  function sampleDegreeSequence(args) {
    const { N, k_avg, max_k, t1, rng } = args;
    const dmin = solveDmin(max_k, k_avg, -t1);
    if (dmin === -1) {
      throw new Error(
        `solveDmin failed for max_k=${max_k} k_avg=${k_avg} t1=${t1}`,
      );
    }
    let min_degree = Math.trunc(dmin);
    const m1 = integerAverage(max_k, min_degree, t1);
    const m2 = integerAverage(max_k, min_degree + 1, t1);
    if (Math.abs(m1 - k_avg) > Math.abs(m2 - k_avg)) min_degree++;

    const cumulative = powerlawCumulative(max_k, min_degree, t1);

    const degrees = new Array(N);
    for (let i = 0; i < N; i++) {
      const u = rng();
      const idx = lowerBound(cumulative, u);
      degrees[i] = idx + min_degree;
    }
    degrees.sort((a, b) => a - b);
    let sum = 0;
    for (const x of degrees) sum += x;
    if (sum % 2 !== 0) {
      let maxIdx = 0;
      for (let i = 1; i < degrees.length; i++) {
        if (degrees[i] > degrees[maxIdx]) maxIdx = i;
      }
      degrees[maxIdx] -= 1;
    }
    return { degrees, min_degree, cumulative };
  }

  // Faithful port of benchm.cpp:444-480 (cluster-size sampler):
  //   powerlaw(nmax, nmin, tau2, cumulative);
  //   if !fixed_range && max_internal_degree+1 > nmin:
  //     seed num_seq with max_internal_degree+1
  //   while true: nn = lower_bound(cum) + nmin; accept if total <= cap;
  //   top up smallest cluster by deficit.
  // overlap_extra = `overlapping_nodes * (max_mem_num - 1)` (0 in our
  // wrapper's non-overlapping mode).
  function sampleClusterSizes(args) {
    const {
      N, max_internal_degree, c_min, c_max, t2, rng,
      fixed_range = false, overlap_extra = 0,
    } = args;
    const cumulative = powerlawCumulative(c_max, c_min, t2);
    const sizes = [];
    const cap = N + overlap_extra;
    let _num_ = 0;
    if (!fixed_range && (max_internal_degree + 1) > c_min) {
      sizes.push(max_internal_degree + 1);
      _num_ = max_internal_degree + 1;
    }
    while (true) {
      const u = rng();
      const idx = lowerBound(cumulative, u);
      const nn = idx + c_min;
      if (nn + _num_ <= cap) {
        sizes.push(nn);
        _num_ += nn;
      } else {
        break;
      }
    }
    if (sizes.length > 0) {
      let minIdx = 0;
      for (let i = 1; i < sizes.length; i++) {
        if (sizes[i] < sizes[minIdx]) minIdx = i;
      }
      sizes[minIdx] += cap - _num_;
    }
    return { sizes, cumulative };
  }

  window.LFRKernel = {
    integral,
    averageDegree,
    solveDmin,
    integerAverage,
    powerlawCumulative,
    lowerBound,
    sampleDegreeSequence,
    sampleClusterSizes,
  };
})();
