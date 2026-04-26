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
    const beta = 1 / (gamma - 1);
    const log_N = Math.log(N);
    const mu = [];
    for (let k = 0; k < C; k++) mu.push((2 * Math.PI * k) / C);
    const sigma = C > 0 ? (2 * Math.PI) / (6 * C) : 0;

    // Stream 1: angles. Single rng so component-pick + normal-draw
    // share state (matches MATLAB's `random(gmd, N)` shape — single
    // RNG, N component picks, N normal draws).
    const rngAngles = rngForSeed(seed);
    const angles = sampleAnglesGmd(N, mixingProportions, mu, sigma, rngAngles);
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

    return { POLAR, DISTS, U_NODE, ASSIGNED: commAssignment, MU: mu, SIGMA: sigma };
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
    const R_i = R_of_T_at(t, T, m, gamma);
    const inv2T = 1 / (2 * T);
    const thetaNew = emb.POLAR[t - 1].theta;
    const candidates = [];
    const weights = [];
    for (let j = 0; j < i; j++) {
      const otherId = j + 1;
      const r_other = 2 * beta * Math.log(otherId) + 2 * (1 - beta) * log_t;
      const d = hyperbolicDist(r_new, r_other, thetaNew - emb.POLAR[otherId - 1].theta);
      const p = 1 / (1 + Math.exp((d - R_i) * inv2T));
      candidates.push(otherId);
      weights.push(p);
    }
    if (candidates.length <= m) {
      const placed = candidates.map((c, k) => [
        Math.min(newNodeId, c), Math.max(newNodeId, c), weights[k],
      ]);
      const picks = candidates.map((c, k) => ({ node: c, p: weights[k] }));
      return { newNode: newNodeId, placed, picks, autoAll: true };
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
    sampleAnglesGmd,
    commFromAngles,
    freshUniforms,
    freshUniformsForArrival,
    computeEmbedding,
    computeArrival,
    edgesImpl3,
  };
})();
