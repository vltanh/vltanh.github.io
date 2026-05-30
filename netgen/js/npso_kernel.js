// nPSO kernel: browser-loadable JS port of externals/npso/nPSO_model.m
// (the gmdistribution branch — i.e. the nPSO2 variant that src/npso/
// invokes by default).
//
// Faithful to the canonical MATLAB source's deterministic logic:
//   - mod-2π angle wrapping (matches MATLAB's `mod(x, 2*pi)`)
//   - comm assignment via the exact MATLAB form
//       min(pi - abs(pi - abs(theta - mu)))
//   - per-arrival radial coord  r_t = 2β·log(t)
//     and existing-arrival popularity-fading update
//       r_i(t) = 2β·log(i) + 2(1-β)·log(t)
//   - hyperbolic distance via the same closed form (with imaginary
//     cleanup falling back to |r_u - r_v|)
//   - R(T) with the β=1 vs general branches (line-for-line with run_npso.m)
//   - implementation-3 weighted sampling without replacement per arrival
//
// Randomness is JS-native (d3.randomLcg + d3.randomNormal). The page
// does not byte-match MATLAB output; the bar is structural-faithfulness
// of the deterministic part. The harness has its own faithful-replay
// check (tools/viz_check/npso/) for byte-equality against MATLAB.
//
// Exposed as window.NPSOKernel:
//   computeEmbedding({N, m, gamma, C, mixingProportions, seed}) ->
//     { POLAR, DISTS, U_NODE, ASSIGNED, MU, SIGMA }
//   R_of_T(T, m, N, gamma) -> R
//   R_of_T_at(t, T, m, gamma) -> R_t   (1-based arrival t)
//   edgesImpl3({T, emb, m, N, gamma, U_NODE_override?}) -> [[u,v],...]
//   computeArrival(i, T, emb, m, gamma) ->
//     { newNode, placed: [[u,v,p],...], picks: [{node, p},...], autoAll }
//   freshUniforms(N, m, seed) -> [[u11,u12,...,u1m],...,[uN1,...,uNm]]
//   freshUniformsForArrival(i, m, seed) -> [u1,...,um]
//
// Where `emb` is whatever computeEmbedding returns; node ids are 1..N
// (MATLAB-style 1-based) so they line up with arrival rank.
(function () {
  "use strict";

  // Zero-cost debug hook. Inert unless a verification harness installs
  // globalThis.__HOOK (typeof guard). Lets tools/viz_check/npso bit-compare
  // every per-step probe against the MATLAB swapped-build tracer without
  // perturbing page behaviour. Tags mirror npso_tracer.m [TRACE-NPSO-*].
  function HOOK(tag, obj) {
    if (typeof globalThis !== "undefined"
        && typeof globalThis.__HOOK === "function") globalThis.__HOOK(tag, obj);
  }

  function modTwoPi(a) {
    let t = a % (2 * Math.PI);
    if (t < 0) t += 2 * Math.PI;
    return t;
  }

  // MATLAB form: pi - abs(pi - abs(theta - mu)) yields the wrap-around
  // angular distance in [0, pi]. argmin picks nearest mu.
  function angDistMatlab(theta, mu) {
    return Math.PI - Math.abs(Math.PI - Math.abs(theta - mu));
  }

  function R_of_T(T, m, N, gamma) {
    const beta = 1 / (gamma - 1);
    const log_N = Math.log(N);
    const s = Math.sin(Math.PI * T);
    if (s <= 0) return Infinity;
    if (Math.abs(beta - 1) < 1e-9) {
      return 2 * log_N - 2 * Math.log((2 * T * log_N) / (s * m));
    }
    const num = 2 * T * (1 - Math.exp(-(1 - beta) * log_N));
    const den = s * m * (1 - beta);
    return 2 * log_N - 2 * Math.log(num / den);
  }

  function R_of_T_at(t, T, m, gamma) {
    const beta = 1 / (gamma - 1);
    if (t < 2) return Infinity;
    const lnT = Math.log(t);
    const s = Math.sin(Math.PI * T);
    if (s <= 0) return Infinity;
    if (Math.abs(beta - 1) < 1e-9) {
      return 2 * lnT - 2 * Math.log((2 * T * lnT) / (s * m));
    }
    const num = 2 * T * (1 - Math.exp(-(1 - beta) * lnT));
    const den = s * m * (1 - beta);
    return 2 * lnT - 2 * Math.log(num / den);
  }

  // Hyperbolic distance, line-for-line port of nPSO_model.m's
  // hyperbolic_dist subroutine. The cosh-cosh - sinh-sinh-cos form
  // can fall below 1 due to floating-point near-coincident points,
  // producing an imaginary acosh; canonical replaces those with the
  // radial separation lower bound.
  function hyperbolicDist(ru, rv, dtheta) {
    let dth = Math.abs(dtheta);
    if (dth > Math.PI) dth = 2 * Math.PI - dth;
    const val = Math.cosh(ru) * Math.cosh(rv)
              - Math.sinh(ru) * Math.sinh(rv) * Math.cos(dth);
    if (val <= 1) return Math.abs(ru - rv);
    if (!Number.isFinite(val)) return Math.abs(ru - rv);
    return Math.acosh(val);
  }

  // d3.randomLcg + d3.randomNormal combo. The caller passes a seed; we
  // build the rng + a normal sampler chained off it.
  function rngForSeed(seed) {
    return d3.randomLcg(seed);
  }

  // Build a Gaussian-mixture sampler shaped like MATLAB's
  // `random(gmd, N)`. Equal sigma across components (sigma = 2π/(6C)),
  // mu_k = 2π·k/C.
  //
  // Per draw: pick component k with probability mixingProportions[k]
  // (cumulative inverse-CDF), then sample N(mu[k], sigma).
  function sampleAnglesGmd(N, mixingProportions, mu, sigma, rng) {
    const cum = [];
    {
      let acc = 0;
      for (const p of mixingProportions) { acc += p; cum.push(acc); }
    }
    const total = cum[cum.length - 1];
    const normalSrc = d3.randomNormal.source(rng);
    const samplers = mu.map(m => normalSrc(m, sigma));
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      const u = rng() * total;
      let k = cum.length - 1;
      for (let kk = 0; kk < cum.length; kk++) {
        if (u <= cum[kk]) { k = kk; break; }
      }
      out[i] = modTwoPi(samplers[k]());
      HOOK("ANG", { i: i + 1, u, kpick: k + 1, theta: out[i] });
    }
    return out;
  }

  // -------------------------------------------------------------------
  // nPSO3 mixture build — port of
  //   externals/npso/create_mixture_gaussian_gamma_pdf.m
  // plus the cell-path angular sampler (nPSO_model.m line 119). Optional
  // path: only invoked when the caller asks for model "nPSO3". The nPSO2
  // (gmd) default path above is unchanged.
  // -------------------------------------------------------------------
  const MIX3_N = 10000;       // evenly spaced grid points over [0,2pi)
  const MIX3_E = 0.0001;      // truncation threshold
  const LN_SQRT_2PI = 0.9189385332046727;     // gampdf saddle
  const LN_SQRT_2PI_SE = 0.9189385332046728;  // stirlerr table fallback

  // MATLAB stats/stats/normpdf.m: exp(-0.5*((x-mu)/sigma)^2)/(sqrt(2pi)*sigma)
  function normpdf(x, mu, sigma) {
    const t = (x - mu) / sigma;
    return Math.exp(-0.5 * (t * t)) / (Math.sqrt(2 * Math.PI) * sigma);
  }
  const STIRLERR_SFE = [
    0, 1.534264097200273e-01, 8.106146679532726e-02, 5.481412105191765e-02,
    4.134069595540929e-02, 3.316287351993629e-02, 2.767792568499834e-02,
    2.374616365629750e-02, 2.079067210376509e-02, 1.848845053267319e-02,
    1.664469118982119e-02, 1.513497322191738e-02, 1.387612882307075e-02,
    1.281046524292023e-02, 1.189670994589177e-02, 1.110455975820868e-02,
    1.041126526197210e-02, 9.799416126158803e-03, 9.255462182712733e-03,
    8.768700134139385e-03, 8.330563433362871e-03, 7.934114564314021e-03,
    7.573675487951841e-03, 7.244554301320383e-03, 6.942840107209530e-03,
    6.665247032707682e-03, 6.408994188004207e-03, 6.171712263039458e-03,
    5.951370112758848e-03, 5.746216513010116e-03, 5.554733551962801e-03];
  const SE_S0 = 8.333333333333333e-02, SE_S1 = 2.777777777777778e-03,
        SE_S2 = 7.936507936507937e-04, SE_S3 = 5.952380952380952e-04,
        SE_S4 = 8.417508417508418e-04;
  function gammaln(x) {
    const g = 607 / 128;
    const c = [0.99999999999999709182, 57.156235665862923517, -59.597960355475491248,
      14.136097974741747174, -0.49191381609762019978, 0.33994649984811888699e-4,
      0.46523628927048575665e-4, -0.98374475304879564677e-4, 0.15808870322491248884e-3,
      -0.21026444172410488319e-3, 0.21743961811521264320e-3, -0.16431810653676389022e-3,
      0.84418223983852743293e-4, -0.26190838401581408670e-4, 0.36899182659531622704e-5];
    if (x <= 0) return NaN;
    const xx = x - 1; let a = c[0]; const tt = xx + g + 0.5;
    for (let i = 1; i < c.length; i++) a += c[i] / (xx + i);
    return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(tt) - tt + Math.log(a);
  }
  function stirlerr(n) {
    const n2 = 2 * n;
    if (n <= 15) {
      if (n2 === Math.round(n2)) return STIRLERR_SFE[n2];
      return gammaln(n + 1) - (n + 0.5) * Math.log(n) + n - LN_SQRT_2PI_SE;
    }
    const nn = n * n;
    if (n <= 35) return (SE_S0 - (SE_S1 - (SE_S2 - (SE_S3 - SE_S4 / nn) / nn) / nn) / nn) / n;
    if (n <= 80) return (SE_S0 - (SE_S1 - (SE_S2 - SE_S3 / nn) / nn) / nn) / n;
    if (n <= 500) return (SE_S0 - (SE_S1 - SE_S2 / nn) / nn) / n;
    return (SE_S0 - SE_S1 / nn) / n;
  }
  function binodeviance(x, np) {
    if (Math.abs(x - np) < 0.1 * (x + np)) {
      let s = ((x - np) * (x - np)) / (x + np);
      const v = (x - np) / (x + np);
      let ej = 2 * x * v, j = 0;
      while (true) {
        ej = ej * v * v; j = j + 1;
        const s1 = s + ej / (2 * j + 1);
        if (s1 === s) break;
        s = s1;
      }
      return s;
    }
    return x * Math.log(x / np) + np - x;
  }
  function gampdf_f(z, a) {
    const REALMIN = 2.2250738585072014e-308;
    if (a <= REALMIN * z) return Math.exp(-z);
    if (z < REALMIN * a) return Math.exp(a * Math.log(z) - z - gammaln(a + 1));
    return Math.exp(-LN_SQRT_2PI - 0.5 * Math.log(a) - stirlerr(a) - binodeviance(a, z));
  }
  function gampdf(x, a, b) {
    if (a < 0 || b <= 0 || Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(x)) return NaN;
    const z0 = x / b;
    if (z0 === 0 && a === 1 && b > 0) return 1 / b;
    if (z0 === 0 && a < 1 && b > 0) return Infinity;
    if (!(z0 > 0 && z0 < Infinity && a > 0 && a < Infinity && b > 0)) return 0;
    const z = z0, a1 = a - 1;
    if (a1 < 0) return gampdf_f(z, a1 + 1) * Math.exp(Math.log(a1 + 1) - Math.log(z)) / b;
    return gampdf_f(z, a1) / b;
  }
  function argminAbs(target, x) {
    let best = 0, bestV = Math.abs(target - x[0]);
    for (let q = 1; q < x.length; q++) {
      const v = Math.abs(target - x[q]);
      if (v < bestV) { bestV = v; best = q; }
    }
    return best;
  }
  // Fisher-Yates of [1..n], n-1 uniform draws (j = floor(rng()*(i+1))).
  function lcgRandperm(n, rng) {
    const perm = new Array(n);
    for (let i = 0; i < n; i++) perm[i] = i + 1;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    return perm;
  }
  // count weighted-with-replacement draws (0-based indices).
  function lcgWeightedSample(weights, count, rng) {
    const n = weights.length, cum = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += weights[i]; cum[i] = acc; }
    const total = cum[n - 1], out = new Array(count);
    for (let c = 0; c < count; c++) {
      const u = rng() * total;
      let k = n - 1;
      for (let kk = 0; kk < n; kk++) { if (u <= cum[kk]) { k = kk; break; } }
      out[c] = k;
    }
    return out;
  }

  function createMixtureGaussianGammaPdf(C, rng) {
    const TWO_PI = 2 * Math.PI;
    const mu = new Array(C);
    for (let k = 0; k < C; k++) mu[k] = (TWO_PI * k) / C;
    const sigma = TWO_PI / C / 6;
    const a = 2, b = 1 / C;
    const half = Math.ceil(C / 2), len = 2 * half;
    const base = new Array(len);
    for (let i = 0; i < half; i++) base[i] = 1;
    for (let i = half; i < len; i++) base[i] = 0;
    const perm = lcgRandperm(len, rng);
    const mixture = perm.map((p) => base[p - 1]).slice(0, C);

    const n = MIX3_N, e = MIX3_E;
    const x = new Array(n);
    for (let i = 0; i < n; i++) x[i] = (TWO_PI * i) / n;
    const y = new Array(n).fill(0);

    for (let i = 0; i < C; i++) {
      const isGauss = mixture[i] === 1;
      const yi = new Array(n);
      for (let q = 0; q < n; q++) yi[q] = isGauss ? normpdf(x[q], mu[i], sigma) : gampdf(x[q], a, b);
      let left = yi[0], right = yi[n - 1], j = 1;
      while (left > e) {
        let y2first = 0;
        for (let q = 0; q < n; q++) {
          const x2 = -j * TWO_PI + ((-(j - 1) * TWO_PI - -j * TWO_PI) * q) / n;
          const v = isGauss ? normpdf(x2, mu[i], sigma) : gampdf(x2, a, b);
          yi[q] += v; if (q === 0) y2first = v;
        }
        left = y2first; j = j + 1;
      }
      j = 1;
      while (right > e) {
        let y2last = 0;
        for (let q = 0; q < n; q++) {
          const x2 = j * TWO_PI + (((j + 1) * TWO_PI - j * TWO_PI) * q) / n;
          const v = isGauss ? normpdf(x2, mu[i], sigma) : gampdf(x2, a, b);
          yi[q] += v; if (q === n - 1) y2last = v;
        }
        right = y2last; j = j + 1;
      }
      if (!isGauss) {
        const t1 = argminAbs(a * b, x) + 1, t2 = argminAbs(mu[i], x) + 1;
        let d = t2 - t1;
        if (d > 0) {
          const temp = yi.slice();
          for (let q = 1; q <= d; q++) yi[q - 1] = temp[(n - d + q) - 1];
          for (let q = d + 1, r = 1; q <= t2; q++, r++) yi[q - 1] = temp[r - 1];
          for (let q = t2 + 1, r = t1 + 1; q <= n; q++, r++) yi[q - 1] = temp[r - 1];
        } else if (d < 0) {
          const dd = Math.abs(d), temp = yi.slice();
          for (let q = 1, r = dd + 1; q <= t2; q++, r++) yi[q - 1] = temp[r - 1];
          for (let q = t2 + 1, r = t1 + 1; q <= n - dd; q++, r++) yi[q - 1] = temp[r - 1];
          for (let q = n - dd + 1, r = 1; q <= n; q++, r++) yi[q - 1] = temp[r - 1];
        }
        const coin = rng();
        if (coin > 0.5) {
          const temp = yi.slice();
          if (t2 > n / 2) {
            for (let q = t2, r = t2; q >= 2 * t2 - n; q--, r++) yi[q - 1] = temp[r - 1];
            for (let q = t2, r = t2; q <= n; q++, r--) yi[q - 1] = temp[r - 1];
            for (let q = 1, r = 2 * t2 - n - 1; q <= 2 * t2 - n - 1; q++, r--) yi[q - 1] = temp[r - 1];
          } else {
            for (let q = 2 * t2 - 1, r = 1; q >= t2; q--, r++) yi[q - 1] = temp[r - 1];
            for (let q = t2, r = t2; q >= 1; q--, r++) yi[q - 1] = temp[r - 1];
            for (let q = 2 * t2, r = n; q <= n; q++, r--) yi[q - 1] = temp[r - 1];
          }
          HOOK("REFL3", { comp: i + 1, coin, xmu2: t2, branch: t2 > n / 2 ? 1 : 0 });
        } else {
          HOOK("REFL3", { comp: i + 1, coin, xmu2: t2, branch: -1 });
        }
      }
      for (let q = 0; q < n; q++) y[q] += yi[q];
    }
    for (let q = 0; q < n; q++) y[q] = y[q] / C;
    let ysum = 0; for (let q = 0; q < n; q++) ysum += y[q];
    HOOK("MIX3", { C, ysum });
    return { x, y, mu };
  }

  function sampleAnglesCell(N, gridAngles, gridProb, rng) {
    const idxs = lcgWeightedSample(gridProb, N, rng);
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      const idx = idxs[i];
      out[i] = modTwoPi(gridAngles[idx]);
      HOOK("ANG3", { i: i + 1, idx: idx + 1, theta: out[i] });
    }
    return out;
  }

  function commFromAngles(angles, mu) {
    const N = angles.length;
    const C = mu.length;
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      let bestK = 0;
      let bestD = Infinity;
      for (let k = 0; k < C; k++) {
        const d = angDistMatlab(angles[i], mu[k]);
        if (d < bestD) { bestD = d; bestK = k; }
      }
      out[i] = bestK + 1; // MATLAB 1-based
      HOOK("COMM", { i: i + 1, comm: out[i], bestD });
    }
    return out;
  }

  // Pre-draw per-arrival uniforms used by impl-3 weighted-without-
  // replace. Decoupled from the angular RNG stream so T-scrub stays
  // continuous when the page is recomputing edges per slider step.
  function freshUniforms(N, m, seed) {
    const rng = d3.randomLcg(seed);
    const out = [];
    for (let i = 0; i < N; i++) {
      const us = new Array(m);
      for (let k = 0; k < m; k++) us[k] = rng();
      out.push(us);
    }
    return out;
  }

  function freshUniformsForArrival(_i, m, seed) {
    const rng = d3.randomLcg(seed);
    const us = new Array(m);
    for (let k = 0; k < m; k++) us[k] = rng();
    return us;
  }

  // computeEmbedding: returns the full bundle the page needs.
  //
  // Inputs:
  //   N (int), m (int), gamma (float), C (int),
  //   mixingProportions (vector len C, sums to 1),
  //   seed (int).
  //
  // Output bundle:
  //   POLAR    -> array length N (0-based by arrival index t-1):
  //               { theta, r_hyp }
  //   DISTS    -> map keyed `${i}-${j}` (1-based, i<j) -> hyperbolic dist
  //   U_NODE   -> N-by-m uniforms for impl-3 picks (per-arrival)
  //   ASSIGNED -> array length N: 1-based cluster index per arrival
  //   MU       -> array length C: cluster centers (radians)
  //   SIGMA    -> scalar: per-component stdev
  function computeEmbedding(opts) {
    const { N, m, gamma, C, mixingProportions, seed } = opts;
    const model = (opts.model || "nPSO2").toUpperCase();
    const beta = 1 / (gamma - 1);
    const log_N = Math.log(N);
    const mu = [];
    for (let k = 0; k < C; k++) mu.push((2 * Math.PI * k) / C);
    const sigma = C > 0 ? (2 * Math.PI) / (6 * C) : 0;

    // Stream 1: angles. Single rng so component-pick + normal-draw
    // share state (matches MATLAB's `random(gmd, N)` shape — single
    // RNG, N component picks, N normal draws). Model selects the path:
    //   nPSO1 = equal weights 1/C (gmd), nPSO2 = caller weights (gmd),
    //   nPSO3 = Gaussian/Gamma mixture cell path (randperm + reflection
    //           coins drawn on this same stream before the angular draw).
    const rngAngles = rngForSeed(seed);
    let angles, MIX = null;
    if (model === "NPSO3") {
      MIX = createMixtureGaussianGammaPdf(C, rngAngles);
      angles = sampleAnglesCell(N, MIX.x, MIX.y, rngAngles);
    } else {
      const weights = model === "NPSO1"
        ? new Array(C).fill(1 / C)
        : mixingProportions;
      angles = sampleAnglesGmd(N, weights, mu, sigma, rngAngles);
    }
    const commAssignment = commFromAngles(angles, mu);

    const POLAR = new Array(N);
    for (let t = 1; t <= N; t++) {
      const r_hyp = 2 * beta * Math.log(t) + 2 * (1 - beta) * log_N;
      POLAR[t - 1] = { theta: angles[t - 1], r_hyp };
    }

    const DISTS = {};
    for (let i = 1; i <= N; i++) {
      for (let j = i + 1; j <= N; j++) {
        DISTS[`${i}-${j}`] = hyperbolicDist(
          POLAR[i - 1].r_hyp, POLAR[j - 1].r_hyp,
          POLAR[i - 1].theta - POLAR[j - 1].theta,
        );
      }
    }

    // Stream 2: edge uniforms. Separate seed offset so angle-redraws
    // don't shift the edge stream.
    const U_NODE = freshUniforms(N, m, seed * 31 + 7);

    return { POLAR, DISTS, U_NODE, ASSIGNED: commAssignment, MU: mu, SIGMA: sigma, MIX };
  }

  // computeArrival(i, ...): picks for arrival index i (0-based).
  // Mirrors the per-arrival inner loop of nPSO_model.m's `for t = 2:N`.
  // For i == 0 (first arrival), no picks. For i in [1..m] (the seed
  // K_{m+1}), connects to all earlier arrivals. For i > m, picks m
  // predecessors via impl-3 weighted-without-replace.
  //
  // Distances are recomputed at arrival time t = i+1 using
  // popularity-faded radii r_j(t) = 2β·log(j) + 2(1-β)·log(t) for
  // every j ≤ t — line-for-line with nPSO_model.m's update at the
  // top of each iteration. emb.DISTS is final-state (t=N) and is
  // only used for visualisation outside this function.
  function computeArrival(i, T, emb, m, gamma) {
    const newNodeId = i + 1; // 1-based
    if (i === 0) {
      return { newNode: newNodeId, placed: [], picks: [], autoAll: true };
    }
    const t = newNodeId;
    const beta = 1 / (gamma - 1);
    const log_t = Math.log(t);
    const r_new = 2 * log_t;
    const R_i = T === 0 ? Infinity : R_of_T_at(t, T, m, gamma);
    const inv2T = T === 0 ? Infinity : 1 / (2 * T);
    const thetaNew = emb.POLAR[t - 1].theta;
    const candidates = [];
    const weights = [];
    const dists = [];
    for (let j = 0; j < i; j++) {
      const otherId = j + 1;
      const r_other = 2 * beta * Math.log(otherId) + 2 * (1 - beta) * log_t;
      const d = hyperbolicDist(r_new, r_other, thetaNew - emb.POLAR[otherId - 1].theta);
      candidates.push(otherId);
      dists.push(d);
      if (T !== 0) {
        weights.push(1 / (1 + Math.exp((d - R_i) * inv2T)));
      } else {
        weights.push(0);
      }
    }
    if (candidates.length <= m) {
      const placed = candidates.map((c, k) => [
        Math.min(newNodeId, c), Math.max(newNodeId, c), weights[k],
      ]);
      const picks = candidates.map((c, k) => ({ node: c, p: weights[k] }));
      HOOK("ALL", { t, npred: candidates.length });
      return { newNode: newNodeId, placed, picks, autoAll: true };
    }
    if (T === 0) {
      // connect to the m hyperbolically closest (nPSO_model.m T==0 branch).
      // MATLAB sort(d) is stable ascending; ties keep lower original index.
      const order = candidates
        .map((c, q) => ({ c, d: dists[q], q }))
        .sort((p1, p2) => (p1.d - p2.d) || (p1.q - p2.q));
      const picks = [];
      for (let c = 0; c < m; c++) {
        picks.push({ node: order[c].c, p: 0 });
        HOOK("T0", { t, c: c + 1, d: order[c].d, idx: order[c].q + 1, node: order[c].c });
      }
      const placed = picks.map(x => [
        Math.min(newNodeId, x.node), Math.max(newNodeId, x.node), x.p,
      ]);
      return { newNode: newNodeId, placed, picks, autoAll: false };
    }
    const us = emb.U_NODE[i];
    const wcopy = weights.slice();
    const ccopy = candidates.slice();
    const picks = [];
    for (let c = 0; c < m; c++) {
      let sum = 0;
      for (const w of wcopy) sum += w;
      if (sum <= 0) break;
      const u = us[c] * sum;
      let acc = 0;
      let idx = 0;
      for (let jj = 0; jj < wcopy.length; jj++) {
        acc += wcopy[jj];
        if (acc >= u) { idx = jj; break; }
      }
      HOOK("PICK", { t, c: c + 1, s: sum, u, idx: idx + 1, node: ccopy[idx] });
      picks.push({ node: ccopy[idx], p: wcopy[idx] });
      ccopy.splice(idx, 1);
      wcopy.splice(idx, 1);
    }
    const placed = picks.map(x => [
      Math.min(newNodeId, x.node), Math.max(newNodeId, x.node), x.p,
    ]);
    return { newNode: newNodeId, placed, picks, autoAll: false };
  }

  function edgesImpl3(opts) {
    const { T, emb, m, N, gamma, U_NODE_override } = opts;
    const used = U_NODE_override || emb.U_NODE;
    const localEmb = U_NODE_override
      ? Object.assign({}, emb, { U_NODE: used })
      : emb;
    const out = [];
    for (let i = 0; i < N; i++) {
      const a = computeArrival(i, T, localEmb, m, gamma);
      a.placed.forEach(p => out.push([p[0], p[1]]));
    }
    return out;
  }

  window.NPSOKernel = {
    R_of_T,
    R_of_T_at,
    hyperbolicDist,
    modTwoPi,
    angDistMatlab,
    normpdf,
    gampdf,
    stirlerr,
    binodeviance,
    createMixtureGaussianGammaPdf,
    sampleAnglesGmd,
    sampleAnglesCell,
    commFromAngles,
    freshUniforms,
    freshUniformsForArrival,
    computeEmbedding,
    computeArrival,
    edgesImpl3,
  };
})();
