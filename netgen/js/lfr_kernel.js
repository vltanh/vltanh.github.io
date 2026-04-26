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
//   - rewire passes (`internal_kin`, `erase_link`, `arrange`) for
//     drift-correcting per-node mu_i toward the global target after
//     the per-cluster + global config-model edges are placed
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

  // Faithful port of benchm.cpp:405-441: per-node internal-degree split.
  // For each degree d, internal = floor((1-mu)*d) + Bernoulli(frac), then
  // ratchet up under `excess` or down under `defect` until d_int / d
  // crosses the (1-mu) threshold. External = d - internal.
  function sampleInternalDegrees(args) {
    const { degrees, mu, rng, excess = false, defect = false } = args;
    const internal = new Array(degrees.length);
    const external = new Array(degrees.length);
    for (let i = 0; i < degrees.length; i++) {
      const d = degrees[i];
      const interno = (1 - mu) * d;
      let intInterno = Math.floor(interno);
      if (rng() < (interno - intInterno)) intInterno += 1;
      if (excess) {
        while (intInterno / d < (1 - mu) && intInterno < d) intInterno += 1;
      }
      if (defect) {
        while (intInterno / d > (1 - mu) && intInterno > 0) intInterno -= 1;
      }
      internal[i] = intInterno;
      external[i] = d - intInterno;
    }
    return { internal, external };
  }

  // Configuration-model stub matcher. Given a list of stubs (each entry =
  // a node iid; node iid u repeated d_u times), pair them uniformly at
  // random; emit a multigraph edge per pair. Returns
  //   { edges: [[u, v], ...], stats: { loops, parallels } }
  // before dedup. Caller threads the result through cleanupMultigraph
  // for the rewire step.
  function configModelPairStubs(args) {
    const { stubs, rng } = args;
    const work = stubs.slice();
    // Fisher-Yates shuffle, then walk pairs.
    for (let i = work.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = work[i]; work[i] = work[j]; work[j] = t;
    }
    if (work.length % 2 !== 0) work.pop();  // odd parity: drop last stub
    const edges = [];
    let loops = 0;
    const seen = new Map();
    for (let i = 0; i < work.length; i += 2) {
      const u = work[i], v = work[i + 1];
      edges.push([u, v]);
      if (u === v) loops += 1;
      const a = u <= v ? u : v;
      const b = u <= v ? v : u;
      const k = `${a},${b}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    let parallels = 0;
    seen.forEach(v => { if (v > 1) parallels += v - 1; });
    return { edges, stats: { loops, parallels } };
  }

  // Generic 2-opt cleanup of self-loops + parallel edges (no block-pair
  // restriction; that's what makes this LFR-specific). Mirrors the
  // multi-edge rewire pass in benchm.cpp's build_subgraph (lines 858-939).
  // edges: multigraph as [[u,v],...]. Returns kept simple edges + dropped.
  function cleanupMultigraph(args) {
    const { edges, rng, maxRetries = 10 } = args;
    const validSet = new Set();
    const valid = [];
    const invalid = [];

    edges.forEach(([u, v]) => {
      const a = u < v ? u : v;
      const b = u < v ? v : u;
      const key = `${a},${b}`;
      if (u === v || validSet.has(key)) {
        invalid.push([u, v]);
      } else {
        validSet.add(key);
        valid.push([a, b]);
      }
    });

    function tryRewire(badEdge) {
      const [u, v] = badEdge;
      if (valid.length === 0) {
        invalid.push([u, v]);
        return;
      }
      const idx = Math.floor(rng() * valid.length);
      const [x, y] = valid[idx];
      let new_e1, new_e2;
      if (rng() < 0.5) {
        new_e1 = [Math.min(u, x), Math.max(u, x)];
        new_e2 = [Math.min(v, y), Math.max(v, y)];
      } else {
        new_e1 = [Math.min(u, y), Math.max(u, y)];
        new_e2 = [Math.min(v, x), Math.max(v, x)];
      }
      const k1 = `${new_e1[0]},${new_e1[1]}`;
      const k2 = `${new_e2[0]},${new_e2[1]}`;
      if (
        new_e1[0] !== new_e1[1] && new_e2[0] !== new_e2[1] &&
        !validSet.has(k1) && !validSet.has(k2) && k1 !== k2
      ) {
        const xyKey = `${x},${y}`;
        validSet.delete(xyKey);
        valid[idx] = valid[valid.length - 1];
        valid.pop();
        validSet.add(k1); validSet.add(k2);
        valid.push(new_e1); valid.push(new_e2);
      } else {
        invalid.push([u, v]);
      }
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (invalid.length === 0) break;
      let lastRecycle = invalid.length;
      let recycleCounter = lastRecycle;
      while (invalid.length > 0) {
        recycleCounter -= 1;
        if (recycleCounter < 0) {
          if (invalid.length < lastRecycle) {
            lastRecycle = invalid.length;
            recycleCounter = lastRecycle;
          } else {
            break;
          }
        }
        tryRewire(invalid.shift());
      }
    }
    return { kept: valid.slice(), dropped: invalid.slice() };
  }

  // Top-level config-model pipeline used by the page: from per-node
  // degree sequence, build the stub list, pair-shuffle, cleanup. Returns
  // simple edges + drop count. Matches the structural shape of LFR's
  // build_subgraph minus the deterministic seed phase (which is a
  // micro-optimisation; the randomized output is uniformly distributed
  // over simple graphs given enough retries).
  function buildConfigModelGraph(args) {
    const { degrees, rng, maxRetries = 10 } = args;
    const stubs = [];
    for (let i = 0; i < degrees.length; i++) {
      for (let k = 0; k < degrees[i]; k++) stubs.push(i);
    }
    const { edges, stats } = configModelPairStubs({ stubs, rng });
    const { kept, dropped } = cleanupMultigraph({ edges, rng, maxRetries });
    return { edges: kept, dropped, stats };
  }

  // Faithful port of benchm.cpp's cluster-assignment pipeline:
  //   - build_bipartite_network (lines 208-378): greedy bipartite seed
  //     by capacity-desc + 10 random-swap passes
  //   - internal_degree_and_membership node-id remap (lines 579-651):
  //     for each node from highest to lowest degree, pick a random
  //     available bipartite slot whose capacity supports the node's
  //     internal degree (retry up to 3*N times before signalling
  //     change_community_size on caller).
  //
  // Specialised for the page's wrapper: max_mem_num=1, overlapping=0
  // (member_numbers[i] = 1 for all i). This collapses the bipartite
  // greedy seed to a per-community fill in num_seq-desc order, and
  // each node ends up in exactly one community.
  //
  // Inputs:
  //   degrees:         per-node total degree (page-id-keyed)
  //   internalDegrees: per-node target internal degree
  //   sizes:           per-cluster capacity num_seq[k]
  //   rng:             () -> [0, 1)
  //   maxAttempts:     remap retries per node before giving up
  //                    (defaults to 3 * N, matching canonical)
  //   randomizationPasses: how many of the 10 canonical swap passes
  //                    to record snapshots for (default 10)
  //
  // Output:
  //   {
  //     assignment: [cluster_idx per node iid],
  //     memberMatrix: [[node_iid, ...] per cluster],
  //     phases: { seed, swap, remap }, each is a snapshot of `assignment`
  //     after that phase (suitable for the page step walker).
  //     ok: bool. False if remap couldn't satisfy degree feasibility
  //          (caller can rebuild num_seq and retry).
  //   }
  //
  // Faithful divergence: canonical's randomization-pass loop iterates
  // a Python deque/set under PYTHONHASHSEED=0; the JS port uses
  // insertion-order Set + indexed array. Same control flow + same
  // number of rng() draws per pass, distinct realizations.
  function assignNodesToClusters(args) {
    const {
      degrees,
      internalDegrees,
      sizes,
      rng,
      maxAttempts,
      randomizationPasses = 10,
    } = args;
    const N = degrees.length;
    const ncom = sizes.length;
    if (N === 0 || ncom === 0) {
      return {
        assignment: [], memberMatrix: [], phases: {
          seed: [], swap: [], remap: [],
        }, ok: true,
      };
    }

    // Phase 1: bipartite greedy seed.
    // Canonical iterates degree_node_in from end (highest member_numbers
    // value) backward; for member_numbers[i]=1 this reduces to walking
    // node ids high-to-low and giving each node the highest-capacity
    // remaining community. Tie-break: stable insertion order in the
    // capacity multimap (canonical std::multimap is RB-tree, so equal
    // keys preserve insertion order).
    const enOut = sizes.map(() => []);    // per-cluster node list
    const enIn = new Array(N).fill(-1);   // per-node cluster
    const remainingCap = sizes.slice();
    // priority list: pairs (cap, cluster_idx). Re-inserts after decrement.
    function popHighestCap() {
      let bestIdx = -1, bestCap = -1, bestK = -1;
      for (let k = 0; k < remainingCap.length; k++) {
        if (remainingCap[k] > bestCap || (remainingCap[k] === bestCap && k > bestK)) {
          bestCap = remainingCap[k];
          bestK = k;
        }
      }
      if (bestCap <= 0) return -1;
      remainingCap[bestK] -= 1;
      return bestK;
    }
    for (let i = N - 1; i >= 0; i--) {
      const k = popHighestCap();
      if (k === -1) {
        // canonical returns -1 (over-subscribed); page wrapper should
        // not hit this since sum(sizes) == N (cluster-size sampler tops
        // up smallest cluster by deficit).
        return {
          assignment: enIn.slice(), memberMatrix: enOut.map(c => c.slice()),
          phases: { seed: enIn.slice(), swap: enIn.slice(), remap: enIn.slice() },
          ok: false,
        };
      }
      enIn[i] = k;
      enOut[k].push(i);
    }
    const seedSnapshot = enIn.slice();

    // Phase 2: 10 randomization passes (canonical lines 319-359).
    // For each (run, cluster k, krm < |enOut[k]|): draw a random node
    // from degree_list (which under member_numbers[i]=1 is just
    // [0,1,...,N-1]); if that random_mate is NOT already in cluster k,
    // execute a 4-way swap that preserves all degree constraints.
    const degreeList = [];
    for (let i = 0; i < N; i++) degreeList.push(i);  // member_numbers=1

    for (let run = 0; run < randomizationPasses; run++) {
      for (let k = 0; k < ncom; k++) {
        const cap = enOut[k].length;
        for (let krm = 0; krm < cap; krm++) {
          const randomMate = degreeList[Math.floor(rng() * degreeList.length)];
          // canonical: irand(L-1) in [0, L-1] inclusive; JS floor(rng()*L)
          // gives [0, L-1] inclusive. Same range.
          if (enIn[randomMate] === k) continue;
          if (enOut[k].indexOf(randomMate) >= 0) continue;
          // pick old_node from enOut[k]
          const externalNodes = enOut[k];
          const oldNode = externalNodes[Math.floor(rng() * externalNodes.length)];
          // not_common = communities in en_in[random_mate] but not in
          // en_in[old_node]. For member_numbers=1, en_in[i] holds one
          // value, so not_common is at most {en_in[random_mate]}.
          // canonical iterates en_in[random_mate]; the only element is
          // a community c. If c !== en_in[old_node] (i.e. c !== k since
          // old_node is in k), c qualifies; else not_common empty.
          const cMate = enIn[randomMate];
          if (cMate === k) continue;  // same community, skip
          if (cMate === enIn[oldNode]) {
            // not_common empty; canonical breaks out of this entire
            // (run, node_a, krm) loop level. JS port mirrors with break.
            break;
          }
          const nodeH = randomMate;
          // 4-way swap (canonical lines 345-356).
          // node_a = community k; we transplant random_mate INTO k and
          // bounce old_node OUT of k INTO node_h's previous community.
          const cOld = enIn[oldNode];   // = k (since oldNode in k)
          const cMate2 = enIn[nodeH];   // = cMate
          // remove old_node from k, put random_mate (=nodeH) in
          const oi = enOut[k].indexOf(oldNode);
          if (oi >= 0) enOut[k][oi] = nodeH;
          // remove nodeH from cMate, put oldNode in
          const hi = enOut[cMate2].indexOf(nodeH);
          if (hi >= 0) enOut[cMate2][hi] = oldNode;
          enIn[nodeH] = k;
          enIn[oldNode] = cMate2;
        }
      }
    }
    const swapSnapshot = enIn.slice();

    // Phase 3: degree-feasibility node remap (canonical lines 579-651).
    // For each node in degrees-desc order, pick a random
    // available bipartite slot whose `available[slot] >=
    // internal_degree[node]`. `available[slot] = sum_k (size_k - 1)
    // for k in en_in[slot]`; for member_numbers=1, available[slot] =
    // size_{en_in[slot]} - 1.
    const slotIndices = [];
    for (let s = 0; s < N; s++) slotIndices.push(s);
    const slotAvailable = slotIndices.map(s => sizes[enIn[s]] - 1);
    const mapNodes = new Array(N).fill(0);
    const cap = maxAttempts == null ? 3 * N : maxAttempts;

    // Order nodes by degree desc, id asc on tie.
    const nodeOrder = [];
    for (let i = 0; i < N; i++) nodeOrder.push(i);
    nodeOrder.sort((a, b) => (degrees[b] - degrees[a]) || (a - b));

    let ok = true;
    const availPool = slotIndices.slice();
    for (let oi = 0; oi < nodeOrder.length; oi++) {
      const i = nodeOrder[oi];
      const intDeg = internalDegrees[i];
      let tryThis = Math.floor(rng() * availPool.length);
      let kr = 0;
      while (intDeg > slotAvailable[availPool[tryThis]]) {
        kr += 1;
        tryThis = Math.floor(rng() * availPool.length);
        if (kr === cap) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      mapNodes[availPool[tryThis]] = i;
      availPool[tryThis] = availPool[availPool.length - 1];
      availPool.pop();
    }

    // Apply remap: member_matrix[k][j] = mapNodes[member_matrix[k][j]].
    const memberMatrix = enOut.map(c => c.map(s => mapNodes[s]));
    // sort members within each cluster (canonical line 656)
    memberMatrix.forEach(c => c.sort((a, b) => a - b));
    // build per-node assignment
    const assignment = new Array(N).fill(-1);
    memberMatrix.forEach((members, k) => {
      members.forEach(n => { assignment[n] = k; });
    });

    return {
      assignment,
      memberMatrix,
      phases: {
        seed: seedSnapshot,
        swap: swapSnapshot,
        remap: assignment.slice(),
      },
      ok,
    };
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
    sampleInternalDegrees,
    configModelPairStubs,
    cleanupMultigraph,
    buildConfigModelGraph,
    assignNodesToClusters,
  };
})();
