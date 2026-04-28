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
// Stages now covered (full canonical pipeline):
//   - solve_dmin / integer_average / powerlaw cumulative / parity
//   - cluster-size sampler + max_internal_degree+1 seed branch
//   - sampleInternalDegrees (Bernoulli + excess/defect ratchets)
//   - assignNodesToClusters (build_bipartite_network +
//     internal_degree_and_membership remap)
//   - computeInternalDegreePerNode (split internal degree across
//     memberships, lines 665-684)
//   - buildSubgraph (per-cluster phases 1+2+3: deterministic multimap
//     seed + 10 randomization passes + multi-edge rewire,
//     lines 719-948)
//   - buildSubgraphsLinkList (parity bump per cluster + per-node
//     link_list construction, lines 954-1097)
//   - connectAllTheParts (global external config model + mate rewire,
//     lines 1144-1413)
//   - eraseLinks (excess/defect drift correction, lines 1443-1537)
//   - runFullPipeline (faithful benchmark driver)
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
    const { stubs, rng, traceTest } = args;
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
    const prePairs = traceTest ? [] : null;
    for (let i = 0; i < work.length; i += 2) {
      const u = work[i], v = work[i + 1];
      edges.push([u, v]);
      if (u === v) loops += 1;
      const a = u <= v ? u : v;
      const b = u <= v ? v : u;
      const k = `${a},${b}`;
      const prevCount = seen.get(k) || 0;
      seen.set(k, prevCount + 1);
      if (prePairs) prePairs.push({
        u, v, loop: u === v, multi: u !== v && prevCount > 0,
      });
    }
    let parallels = 0;
    seen.forEach(v => { if (v > 1) parallels += v - 1; });
    return { edges, stats: { loops, parallels }, prePairs };
  }

  // Generic 2-opt cleanup of self-loops + parallel edges (no block-pair
  // restriction; that's what makes this LFR-specific). Mirrors the
  // multi-edge rewire pass in benchm.cpp's build_subgraph (lines 858-939).
  // edges: multigraph as [[u,v],...]. Returns kept simple edges + dropped.
  function cleanupMultigraph(args) {
    const { edges, rng, maxRetries = 10, traceTest } = args;
    const validSet = new Set();
    const valid = [];
    const invalid = [];
    const rewireOps = traceTest ? [] : null;

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
        if (rewireOps) rewireOps.push({
          p1: [u, v], p2: null, newp1: null, newp2: null,
          success: false, reason: "no-valid-pool",
        });
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
        if (rewireOps) rewireOps.push({
          p1: [u, v], p2: [x, y], newp1: new_e1, newp2: new_e2,
          success: true,
        });
      } else {
        invalid.push([u, v]);
        if (rewireOps) rewireOps.push({
          p1: [u, v], p2: [x, y], newp1: new_e1, newp2: new_e2,
          success: false, reason: "collision",
        });
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
    return { kept: valid.slice(), dropped: invalid.slice(), rewireOps };
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

  // Faithful port of benchm.cpp:665-684 (compute_internal_degree_per_node).
  // Splits internal degree d across m memberships: floor(d/m) for all,
  // with the first (d % m) entries getting +1.
  function computeInternalDegreePerNode(d, m) {
    if (m <= 0) return [];
    const di = Math.floor(d / m);
    const out = new Array(m).fill(di);
    const rem = d % m;
    for (let i = 0; i < rem; i++) out[i] += 1;
    return out;
  }

  // Helper: do nodes i and j share at least one community?
  // Mirrors benchm.cpp's they_are_mate(i, j, member_list). member_list[i]
  // is a sorted ascending array of cluster indices node i belongs to.
  function theyAreMate(i, j, memberList) {
    const a = memberList[i], b = memberList[j];
    if (!a || !b) return false;
    let p = 0, q = 0;
    while (p < a.length && q < b.length) {
      if (a[p] === b[q]) return true;
      if (a[p] < b[q]) p += 1; else q += 1;
    }
    return false;
  }

  // Faithful port of benchm.cpp's build_subgraph (lines 719-948).
  // nodes:    array of global node ids (size n)
  // degrees:  per-position internal degree (size n; sum even)
  // rng:      () -> [0, 1)
  // E:        deque<set<int>> — pre-existing global adjacency keyed by
  //           the same node ids as `nodes` (mutated in place; new
  //           internal links added via E[u].add(v) + E[v].add(u))
  // Returns { ok: bool, multipleResolved: int, multipleDropped: int }.
  // Phase 1 (lines 762-806): deterministic multimap-based seed by
  // degree desc; tie-break by multimap insertion order. Phase 2
  // (lines 818-853): 10 randomization passes via 4-way swap. Phase 3
  // (lines 858-939): rewire any multi-edges that emerge when merging
  // into E; drop after 2*|E[i]| stagnation.
  function buildSubgraph(args) {
    const { nodes, degrees, rng, E } = args;
    const n = nodes.length;
    if (degrees.length < 3 || n < 3) {
      // canonical errors out: "communities should have only 2 nodes"
      return { ok: false, multipleResolved: 0, multipleDropped: 0 };
    }
    // en[i] = local adjacency of cluster-internal index i (0..n-1)
    const en = [];
    for (let i = 0; i < n; i++) en.push(new Set());

    // ---- Phase 1: deterministic multimap seed ----
    // Canonical std::multimap<int,int> sorted by key asc. We model with
    // an array of [degree, idx] entries in sorted order; equal-key
    // entries preserve insertion order. Insertions during the loop
    // re-insert at the right slot; deletions remove specific entries.
    let dn = [];
    for (let i = 0; i < degrees.length; i++) dn.push([degrees[i], i]);
    dn.sort((a, b) => (a[0] - b[0]));  // asc; equal keys stable
    while (dn.length > 0) {
      // itlast = last entry (highest degree)
      const last = dn[dn.length - 1];
      let itit = dn.length - 1;          // start at itlast, then --
      const erasenda = [];
      let inserted = 0;
      for (let i = 0; i < last[0]; i++) {
        if (itit !== 0) {
          itit -= 1;
          en[last[1]].add(dn[itit][1]);
          en[dn[itit][1]].add(last[1]);
          inserted += 1;
          erasenda.push(itit);
        } else {
          break;
        }
      }
      // Erase erasenda (sorted by itit asc; we built them descending so
      // sort to remove highest first to preserve indices).
      erasenda.sort((a, b) => b - a);
      const reinsert = [];
      erasenda.forEach(idx => {
        const ent = dn[idx];
        if (ent[0] > 1) reinsert.push([ent[0] - 1, ent[1]]);
        dn.splice(idx, 1);
      });
      // Re-insert with stable sort (preserves canonical multimap order).
      reinsert.forEach(ent => {
        let lo = 0, hi = dn.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (dn[mid][0] <= ent[0]) lo = mid + 1; else hi = mid;
        }
        dn.splice(lo, 0, ent);
      });
      // Erase itlast (now at the very end; after splice'ing erasenda
      // it still sits at end since we removed strictly lower indices).
      // Re-find: it was at original last position. After splices, it
      // should still be at dn.length - 1 if it wasn't included in
      // erasenda. We never push itlast index into erasenda.
      // Find the [last[0], last[1]] entry and remove it.
      for (let i = dn.length - 1; i >= 0; i--) {
        if (dn[i][0] === last[0] && dn[i][1] === last[1]) {
          dn.splice(i, 1);
          break;
        }
      }
    }

    // ---- Phase 2: 10 randomization passes ----
    const degreeList = [];
    for (let kk = 0; kk < degrees.length; kk++)
      for (let k2 = 0; k2 < degrees[kk]; k2++) degreeList.push(kk);

    for (let run = 0; run < 10; run++) {
      for (let nodeA = 0; nodeA < degrees.length; nodeA++) {
        const enA = en[nodeA];
        const enASize = enA.size;
        for (let krm = 0; krm < enASize; krm++) {
          let randomMate = degreeList[Math.floor(rng() * degreeList.length)];
          while (randomMate === nodeA) {
            randomMate = degreeList[Math.floor(rng() * degreeList.length)];
          }
          if (en[nodeA].has(randomMate)) continue;
          // The Set.add returns true if newly added. Canonical semantics:
          // "if (en[node_a].insert(random_mate).second)" — only proceed
          // if it WAS inserted (i.e. wasn't there). We checked above so
          // proceed.
          en[nodeA].add(randomMate);
          // out_nodes = en[nodeA] minus {randomMate}
          const outNodes = [];
          en[nodeA].forEach(v => { if (v !== randomMate) outNodes.push(v); });
          const oldNode = outNodes[Math.floor(rng() * outNodes.length)];
          en[nodeA].delete(oldNode);
          en[randomMate].add(nodeA);
          en[oldNode].delete(nodeA);
          // not_common: nodes in en[randomMate] not in en[oldNode] AND
          // not equal to oldNode
          const notCommon = [];
          en[randomMate].forEach(v => {
            if (v !== oldNode && !en[oldNode].has(v)) notCommon.push(v);
          });
          // canonical doesn't gate this on size but does irand on the
          // result; if empty, this is a runtime error in canonical.
          // Defensive: skip the swap if notCommon empty.
          if (notCommon.length === 0) {
            // Roll back: re-add oldNode to nodeA, remove randomMate
            en[nodeA].add(oldNode);
            en[randomMate].delete(nodeA);
            en[oldNode].add(nodeA);
            en[nodeA].delete(randomMate);
            continue;
          }
          const nodeH = notCommon[Math.floor(rng() * notCommon.length)];
          en[randomMate].delete(nodeH);
          en[nodeH].delete(randomMate);
          en[nodeH].add(oldNode);
          en[oldNode].add(nodeH);
        }
      }
    }

    // ---- Phase 3: insert into global E + multi-edge rewire ----
    const multipleEdges = [];
    for (let i = 0; i < n; i++) {
      const ui = nodes[i];
      en[i].forEach(j => {
        if (i < j) {
          const uj = nodes[j];
          if (E[ui].has(uj)) {
            multipleEdges.push([ui, uj]);
          } else {
            E[ui].add(uj);
            E[uj].add(ui);
          }
        }
      });
    }

    // Multi-edge rewire (lines 878-939). sortedNodes hoisted out of the
    // retry loop — was being recomputed per attempt (perf bug L4).
    const sortedNodes = nodes.slice().sort((x, y) => x - y);
    let multipleResolved = 0;
    let multipleDropped = 0;
    multipleEdges.forEach(([a, b]) => {
      let stopperMl = 0;
      const stopperLimit = 2 * E.length;
      while (true) {
        stopperMl += 1;
        let randomMateGlobal = nodes[degreeList[Math.floor(rng() * degreeList.length)]];
        while (randomMateGlobal === a || randomMateGlobal === b) {
          randomMateGlobal = nodes[degreeList[Math.floor(rng() * degreeList.length)]];
        }
        if (!E[a].has(randomMateGlobal)) {
          // not_common: nodes in E[randomMateGlobal] not equal to b,
          // not in E[b], AND in nodes (binary_search on sorted nodes).
          const notCommon = [];
          E[randomMateGlobal].forEach(v => {
            if (v === b || E[b].has(v)) return;
            // binary search v in sortedNodes
            let lo = 0, hi = sortedNodes.length;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (sortedNodes[mid] < v) lo = mid + 1; else hi = mid;
            }
            if (lo < sortedNodes.length && sortedNodes[lo] === v) {
              notCommon.push(v);
            }
          });
          if (notCommon.length > 0) {
            const nodeHGlobal = notCommon[Math.floor(rng() * notCommon.length)];
            E[randomMateGlobal].add(a);
            E[randomMateGlobal].delete(nodeHGlobal);
            E[nodeHGlobal].delete(randomMateGlobal);
            E[nodeHGlobal].add(b);
            E[b].add(nodeHGlobal);
            E[a].add(randomMateGlobal);
            multipleResolved += 1;
            break;
          }
        }
        if (stopperMl === stopperLimit) {
          multipleDropped += 1;
          break;
        }
      }
    });

    return { ok: true, multipleResolved, multipleDropped };
  }

  // Faithful port of benchm.cpp's build_subgraphs (lines 954-1140):
  // builds member_list (per-node sorted cluster ids), link_list (per-node
  // [intra_each_cluster..., external]) with parity-bump per cluster, then
  // calls buildSubgraph on every cluster and merges into global E.
  // Returns { E, memberList, linkList, perCluster: [{multipleResolved, multipleDropped}, ...] }.
  // E is initialised here; caller passes empty.
  function buildSubgraphs(args) {
    const {
      memberMatrix, internalDegreeSeq, degreeSeq, rng, excess, defect,
    } = args;
    const numNodes = degreeSeq.length;
    const E = [];
    for (let i = 0; i < numNodes; i++) E.push(new Set());

    // member_list[i] = sorted cluster ids that contain node i.
    const memberList = [];
    for (let i = 0; i < numNodes; i++) memberList.push([]);
    for (let k = 0; k < memberMatrix.length; k++) {
      for (let j = 0; j < memberMatrix[k].length; j++) {
        memberList[memberMatrix[k][j]].push(k);
      }
    }
    memberList.forEach(m => m.sort((a, b) => a - b));

    // link_list[i] = per-cluster internal degree (one entry per cluster
    // node i belongs to, in member_list[i] order) followed by external
    // degree as the last entry.
    const linkList = [];
    for (let i = 0; i < numNodes; i++) {
      // Canonical (benchm.cpp:984-997) clears `liin` inside
      // compute_internal_degree_per_node every j iteration, so the outer
      // j-loop is effectively a no-op: only the last iter's split survives.
      // Final shape: m internal entries + 1 external. Compute once.
      const split = computeInternalDegreePerNode(
        internalDegreeSeq[i], memberList[i].length,
      );
      const liin = split.slice();
      liin.push(degreeSeq[i] - internalDegreeSeq[i]);
      linkList.push(liin);
    }

    // Per-cluster parity bump (lines 1015-1097): if internal stub count
    // sum is odd, shift one stub from external to internal (or reverse
    // under defect) at a random member of the cluster. Canonical chooses
    // direction by excess flag → up; defect → down; else coin flip.
    for (let k = 0; k < memberMatrix.length; k++) {
      let internalCluster = 0;
      for (let j = 0; j < memberMatrix[k].length; j++) {
        const nodeId = memberMatrix[k][j];
        // right_index = position of cluster k in memberList[nodeId]
        const rightIndex = memberList[nodeId].indexOf(k);
        internalCluster += linkList[nodeId][rightIndex];
      }
      if (internalCluster % 2 !== 0) {
        let defaultFlag = false;
        if (excess) defaultFlag = true;
        else if (defect) defaultFlag = false;
        else if (rng() > 0.5) defaultFlag = true;
        if (defaultFlag) {
          // bump up: find a member whose intra+1 still <= cluster_size-1
          // AND whose external > 0
          for (let j = 0; j < memberMatrix[k].length; j++) {
            const randomMate = memberMatrix[k][
              Math.floor(rng() * memberMatrix[k].length)
            ];
            const rightIndex = memberList[randomMate].indexOf(k);
            const intraVal = linkList[randomMate][rightIndex];
            const extVal = linkList[randomMate][linkList[randomMate].length - 1];
            if (intraVal < memberMatrix[k].length - 1 && extVal > 0) {
              linkList[randomMate][rightIndex] += 1;
              linkList[randomMate][linkList[randomMate].length - 1] -= 1;
              break;
            }
          }
        } else {
          for (let j = 0; j < memberMatrix[k].length; j++) {
            const randomMate = memberMatrix[k][
              Math.floor(rng() * memberMatrix[k].length)
            ];
            const rightIndex = memberList[randomMate].indexOf(k);
            if (linkList[randomMate][rightIndex] > 0) {
              linkList[randomMate][rightIndex] -= 1;
              linkList[randomMate][linkList[randomMate].length - 1] += 1;
              break;
            }
          }
        }
      }
    }

    // Per-cluster build via buildSubgraph.
    const perCluster = [];
    for (let k = 0; k < memberMatrix.length; k++) {
      const internalDegreeI = [];
      for (let j = 0; j < memberMatrix[k].length; j++) {
        const nodeId = memberMatrix[k][j];
        const rightIndex = memberList[nodeId].indexOf(k);
        internalDegreeI.push(linkList[nodeId][rightIndex]);
      }
      const sub = buildSubgraph({
        nodes: memberMatrix[k].slice(),
        degrees: internalDegreeI,
        rng, E,
      });
      perCluster.push(sub);
    }

    return { E, memberList, linkList, perCluster };
  }

  // Faithful port of benchm.cpp:1144-1413 connect_all_the_parts.
  // Treats external degrees (link_list[i].last()) as a separate
  // configuration model graph (deterministic seed + 10 swaps), then
  // mate-rewires to break any same-cluster external edges.
  // Mutates E in place (adds external links).
  // Returns { mateRemaining: int, swappedAway: int }.
  function connectAllTheParts(args) {
    const { E, memberList, linkList, rng, mateTrooper = 10 } = args;
    const numNodes = linkList.length;
    const degrees = linkList.map(l => l[l.length - 1]);

    const en = [];
    for (let i = 0; i < numNodes; i++) en.push(new Set());

    // Phase 1: deterministic multimap seed (same as buildSubgraph
    // phase 1 but on the global node set with external degrees).
    let dn = [];
    for (let i = 0; i < numNodes; i++) dn.push([degrees[i], i]);
    dn.sort((a, b) => a[0] - b[0]);
    while (dn.length > 0) {
      const last = dn[dn.length - 1];
      let itit = dn.length - 1;
      const erasenda = [];
      for (let i = 0; i < last[0]; i++) {
        if (itit !== 0) {
          itit -= 1;
          en[last[1]].add(dn[itit][1]);
          en[dn[itit][1]].add(last[1]);
          erasenda.push(itit);
        } else {
          break;
        }
      }
      erasenda.sort((a, b) => b - a);
      const reinsert = [];
      erasenda.forEach(idx => {
        const ent = dn[idx];
        if (ent[0] > 1) reinsert.push([ent[0] - 1, ent[1]]);
        dn.splice(idx, 1);
      });
      reinsert.forEach(ent => {
        let lo = 0, hi = dn.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (dn[mid][0] <= ent[0]) lo = mid + 1; else hi = mid;
        }
        dn.splice(lo, 0, ent);
      });
      for (let i = dn.length - 1; i >= 0; i--) {
        if (dn[i][0] === last[0] && dn[i][1] === last[1]) {
          dn.splice(i, 1);
          break;
        }
      }
    }

    // Phase 2: 10 randomization passes (lines 1228-1271).
    const degreeList = [];
    for (let kk = 0; kk < degrees.length; kk++)
      for (let k2 = 0; k2 < degrees[kk]; k2++) degreeList.push(kk);

    for (let run = 0; run < 10; run++) {
      for (let nodeA = 0; nodeA < numNodes; nodeA++) {
        const enASize = en[nodeA].size;
        for (let krm = 0; krm < enASize; krm++) {
          let randomMate = degreeList[Math.floor(rng() * degreeList.length)];
          while (randomMate === nodeA) {
            randomMate = degreeList[Math.floor(rng() * degreeList.length)];
          }
          if (en[nodeA].has(randomMate)) continue;
          en[nodeA].add(randomMate);
          const outNodes = [];
          en[nodeA].forEach(v => { if (v !== randomMate) outNodes.push(v); });
          const oldNode = outNodes[Math.floor(rng() * outNodes.length)];
          en[nodeA].delete(oldNode);
          en[randomMate].add(nodeA);
          en[oldNode].delete(nodeA);
          const notCommon = [];
          en[randomMate].forEach(v => {
            if (v !== oldNode && !en[oldNode].has(v)) notCommon.push(v);
          });
          if (notCommon.length === 0) {
            en[nodeA].add(oldNode);
            en[randomMate].delete(nodeA);
            en[oldNode].add(nodeA);
            en[nodeA].delete(randomMate);
            continue;
          }
          const nodeH = notCommon[Math.floor(rng() * notCommon.length)];
          en[randomMate].delete(nodeH);
          en[nodeH].delete(randomMate);
          en[nodeH].add(oldNode);
          en[oldNode].add(nodeH);
        }
      }
    }

    // Phase 3: mate-rewire loop (lines 1278-1390). Until var_mate is 0
    // or stagnated for `mateTrooper` rounds.
    function countMate() {
      let v = 0;
      for (let i = 0; i < numNodes; i++) {
        en[i].forEach(j => {
          if (theyAreMate(i, j, memberList)) v += 1;
        });
      }
      return v;
    }
    let varMate = countMate();
    let stopperMate = 0;
    while (varMate > 0) {
      const bestVarMate = varMate;
      // Canonical sweeps every `a`; for each `a` with a mate-neighbor, run
      // one rewire attempt (success or stopper) and `break` the neighbor
      // loop — but `for(a)` continues. Stagnation is declared only after a
      // full pass over all `a`s leaves var_mate unchanged.
      for (let a = 0; a < numNodes; a++) {
        const enA = Array.from(en[a]);
        for (let bi = 0; bi < enA.length; bi++) {
          const b = enA[bi];
          if (!theyAreMate(a, b, memberList)) continue;
          let stopperM = 0;
          while (true) {
            stopperM += 1;
            let randomMate = degreeList[Math.floor(rng() * degreeList.length)];
            while (randomMate === a || randomMate === b) {
              randomMate = degreeList[Math.floor(rng() * degreeList.length)];
            }
            if (!theyAreMate(a, randomMate, memberList) && !en[a].has(randomMate)) {
              const notCommon = [];
              en[randomMate].forEach(v => {
                if (v !== b && !en[b].has(v)) notCommon.push(v);
              });
              if (notCommon.length > 0) {
                const nodeH = notCommon[Math.floor(rng() * notCommon.length)];
                en[randomMate].delete(nodeH);
                en[randomMate].add(a);
                en[nodeH].delete(randomMate);
                en[nodeH].add(b);
                en[b].delete(a);
                en[b].add(nodeH);
                en[a].add(randomMate);
                en[a].delete(b);
                if (!theyAreMate(b, nodeH, memberList)) varMate -= 2;
                if (theyAreMate(randomMate, nodeH, memberList)) varMate -= 2;
                break;
              }
            }
            if (stopperM === en[a].size) break;
          }
          break;
        }
      }
      if (varMate === bestVarMate) {
        stopperMate += 1;
        if (stopperMate === mateTrooper) break;
      } else {
        stopperMate = 0;
      }
    }

    // Merge en into E.
    for (let i = 0; i < numNodes; i++) {
      en[i].forEach(j => {
        if (i < j) {
          E[i].add(j);
          E[j].add(i);
        }
      });
    }
    return { mateRemaining: varMate };
  }

  // Faithful port of benchm.cpp:1443-1537 erase_links.
  // Drift-correct per-node mu_i toward (1 - mixing_parameter) by
  // dropping (excess) or adding (defect) edges. No-op when neither
  // flag is set.
  function eraseLinks(args) {
    const { E, memberList, excess, defect, mu, rng } = args;
    const numNodes = memberList.length;
    let erasAddTimes = 0;

    function internalKin(i) {
      let v = 0;
      E[i].forEach(j => { if (theyAreMate(i, j, memberList)) v += 1; });
      return v;
    }

    if (excess) {
      for (let i = 0; i < numNodes; i++) {
        while (E[i].size > 1 && internalKin(i) / E[i].size < 1 - mu) {
          erasAddTimes += 1;
          const deqar = [];
          E[i].forEach(v => {
            if (!theyAreMate(i, v, memberList)) deqar.push(v);
          });
          if (deqar.length === E[i].size) return { ok: false, erasAddTimes };
          const randomMate = deqar[Math.floor(rng() * deqar.length)];
          E[i].delete(randomMate);
          E[randomMate].delete(i);
        }
      }
    }
    if (defect) {
      for (let i = 0; i < numNodes; i++) {
        while (E[i].size < E.length && internalKin(i) / E[i].size > 1 - mu) {
          erasAddTimes += 1;
          const stopperHere = numNodes;
          let stopper = 0;
          let randomMate = Math.floor(rng() * numNodes);
          while (
            (theyAreMate(i, randomMate, memberList) || E[i].has(randomMate))
            && stopper < stopperHere
          ) {
            randomMate = Math.floor(rng() * numNodes);
            stopper += 1;
          }
          if (stopper === stopperHere) return { ok: false, erasAddTimes };
          E[i].add(randomMate);
          E[randomMate].add(i);
        }
      }
    }
    return { ok: true, erasAddTimes };
  }

  // Faithful port of benchm.cpp:170-202 (change_community_size).
  // Merges the smallest two communities and replaces a slot at index 0;
  // returns -1 when |seq| <= 2 (un-recoverable). Mutates seq in place.
  function changeCommunitySize(seq) {
    if (seq.length <= 2) return -1;
    let min1 = 0;
    for (let i = 0; i < seq.length; i++) if (seq[i] <= seq[min1]) min1 = i;
    let min2 = min1 === 0 ? 1 : 0;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] <= seq[min2] && seq[i] > seq[min1]) min2 = i;
    }
    seq[min1] += seq[min2];
    const c = seq[0];
    seq[0] = seq[min2];
    seq[min2] = c;
    seq.shift();
    return 0;
  }

  // Top-level driver mirroring benchm.cpp's `benchmark` pipeline:
  //   resample degrees → resample sizes → split internal → assign nodes
  //   → build subgraphs → connect parts → erase links.
  // Faithful to canonical: when assignNodesToClusters cannot satisfy
  // degree feasibility within 3*N retries, run change_community_size
  // and retry (canonical line 614 recursion). Bounded retries here.
  // Returns the full final adjacency, memberList, linkList, and stage
  // diagnostics so the page can render any intermediate stage.
  function runFullPipeline(args) {
    const {
      N, k_avg, max_k, t1, c_min, c_max, t2, mu, rng,
      excess = false, defect = false,
      maxResizeAttempts = 8,
    } = args;
    const dseq = sampleDegreeSequence({ N, k_avg, max_k, t1, rng });
    const split = sampleInternalDegrees({
      degrees: dseq.degrees, mu, rng, excess, defect,
    });
    const maxIntDeg = split.internal.length ? Math.max(0, ...split.internal) : 0;
    const cs = sampleClusterSizes({
      N, max_internal_degree: maxIntDeg, c_min, c_max, t2, rng,
      fixed_range: false, overlap_extra: 0,
    });
    let sizes = cs.sizes.slice();
    let assignRes = null;
    let resized = 0;
    while (resized <= maxResizeAttempts) {
      assignRes = assignNodesToClusters({
        degrees: dseq.degrees,
        internalDegrees: split.internal,
        sizes,
        rng,
      });
      if (assignRes.ok) break;
      if (changeCommunitySize(sizes) === -1) break;
      resized += 1;
    }
    if (!assignRes.ok) return { ok: false, stage: "assign", resized };
    const subRes = buildSubgraphs({
      memberMatrix: assignRes.memberMatrix,
      internalDegreeSeq: split.internal,
      degreeSeq: dseq.degrees,
      rng, excess, defect,
    });
    const connRes = connectAllTheParts({
      E: subRes.E, memberList: subRes.memberList, linkList: subRes.linkList,
      rng,
    });
    const eraseRes = eraseLinks({
      E: subRes.E, memberList: subRes.memberList,
      excess, defect, mu, rng,
    });
    return {
      ok: true,
      degrees: dseq.degrees,
      sizes,
      internal: split.internal,
      external: split.external,
      assignment: assignRes.assignment,
      memberMatrix: assignRes.memberMatrix,
      memberList: subRes.memberList,
      linkList: subRes.linkList,
      E: subRes.E,
      perCluster: subRes.perCluster,
      mateRemaining: connRes.mateRemaining,
      erasAddTimes: eraseRes.erasAddTimes,
      resized,
    };
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

    // Order nodes by degree desc, id desc on tie. Canonical (benchm.cpp:602)
    // iterates `i=N-1..0` over an asc-sorted degree_seq, so within a tied
    // run of length L starting at position p the visit order is
    // (p+L-1, p+L-2, ..., p) — i.e. high-id first.
    const nodeOrder = [];
    for (let i = 0; i < N; i++) nodeOrder.push(i);
    nodeOrder.sort((a, b) => (degrees[b] - degrees[a]) || (b - a));

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
    computeInternalDegreePerNode,
    theyAreMate,
    buildSubgraph,
    buildSubgraphs,
    connectAllTheParts,
    eraseLinks,
    changeCommunitySize,
    runFullPipeline,
  };
})();
