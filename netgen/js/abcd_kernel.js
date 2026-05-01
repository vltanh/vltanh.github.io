// ABCD kernel: browser-loadable JS port of
// externals/abcd/src/graph_sampler.jl::populate_clusters + config_model
// (isCL=false, islocal=false). Outlier branch (hasoutliers=true) is also
// implemented; abcd+o reuses this kernel.
//
// Faithful to the canonical Julia source's deterministic logic:
//   - populate_clusters: feasibility-suffix outlier pick (when hasoutliers),
//     then per-vertex sweep of cluster slots with weighted assignment;
//   - config_model: per-cluster recycle pass (FIFO shift, inner-iter cap
//     = floor(stubs.length/2), randround for w_internal, parity-flip on
//     max-weight leader), then global pass (LIFO pop, rand_set picks from
//     valid pool with kept-set deletion), then a final cross-cluster swap
//     stage when residue persists (rand_set against the union edges).
//
// Randomness: caller passes a JS rng (() -> [0,1)). The trace consumers
// from tools/viz_check/abcd/kernel_check.mjs are mapped to rng calls:
//   uniform.value          -> rng()
//   uniform_int.value (1..n)-> 1 + Math.floor(rng() * n)
//   rand_set.element        -> uniform sample from a Set
//   randround(x)            -> floor(x) + (rng() < x - floor(x) ? 1 : 0)
//   shuffle.after           -> Fisher-Yates on the array in place
//   vertex_assign.picked    -> sample((j0+1):j, weights=slots[j0+1..j])
//   outlier_sample.picked   -> sample(idx:n, nout, replace=false) — uniform without replacement
//
// Byte-equality with Julia RNG is **not** the bar; the deterministic
// control flow + sort orders + recycle-loop semantics are.
//
// Exposed as window.ABCDKernel:
//   randround(x, rng)
//   sampleWeighted(items, weights, rng)
//   sampleWithoutReplacement(items, k, rng)
//   shuffleInPlace(arr, rng)
//   populateClusters({w, s, hasOutliers, mu, xi, rng})
//     -> Int[]  (1-based cluster ids per vertex)
//   configModel({clusters, w, s, hasOutliers, xi, rng})
//     -> { edges: [[a,b],...] (1-based, a<b) , wInternal, residueAfter,
//          stages: { perCluster: {...}, global: {...}, final: {...} } }
//   sampleAbcd({w, s, hasOutliers, xi, mu, rng}) -> { clusters, edges }
(function () {
  "use strict";

  function ekey(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }
  function epair(a, b) { return a < b ? [a, b] : [b, a]; }

  function randround(x, rng) {
    const d = Math.floor(x);
    return d + (rng() < (x - d) ? 1 : 0);
  }

  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Weighted sample with replacement, single draw. items + weights
  // arrays of equal length; weights non-negative; sum > 0.
  function sampleWeighted(items, weights, rng) {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return null;
    let r = rng() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  // Uniform without-replacement sample of k items from a list. Mirrors
  // StatsBase.sample(items, k; replace=false): Fisher-Yates of a copy,
  // take first k.
  function sampleWithoutReplacement(items, k, rng) {
    const a = items.slice();
    shuffleInPlace(a, rng);
    return a.slice(0, k);
  }

  // Uniform pick from a Set of "lo-hi" string keys. Returns [lo, hi].
  function sampleFromKeySet(set, rng) {
    const arr = Array.from(set);
    if (arr.length === 0) return null;
    const i = Math.floor(rng() * arr.length);
    return arr[i].split("-").map(Number);
  }

  // Mutating recycle-loop. State is { localEdges:Set, recycle:Array<[a,b]>,
  // lastRecycle, recycleCounter, stubsLen }. Each iteration shifts p1,
  // tries up to floor(stubsLen/2) inner picks of p2 + orientation, and
  // either commits a swap or pushes p1 back to the queue. Loop exits
  // when the stagnation counter shows no progress this pass.
  // Returns the per-op trace (same shape as configModel's rewireOps).
  // Both the in-line config-model rewire pass AND replayClusterRewire-
  // FromOps drive this same body so there is exactly one source of
  // truth for the canonical recycle semantics.
  function runClusterRewireLoop(state, rng) {
    const { localEdges, recycle, stubsLen } = state;
    let { lastRecycle, recycleCounter } = state;
    const ops = [];
    while (recycle.length > 0) {
      recycleCounter -= 1;
      if (recycleCounter < 0) {
        if (recycle.length < lastRecycle) {
          lastRecycle = recycle.length;
          recycleCounter = lastRecycle;
        } else break;
      }
      const p1 = recycle.shift();
      const fromRecycle = (2 * recycle.length) / Math.max(1, stubsLen);
      let success = false;
      let chosenP2 = null, chosenSrc = null, chosenNewp1 = null, chosenNewp2 = null;
      if (!(recycle.length === 0 && localEdges.size === 0)) {
        const innerIters = Math.floor(stubsLen / 2);
        for (let inner = 0; inner < innerIters; inner++) {
          const coin1 = rng();
          let usedRecycle, p2, recycleIdx = -1;
          if (coin1 < fromRecycle || localEdges.size === 0) {
            usedRecycle = true;
            recycleIdx = Math.floor(rng() * recycle.length);
            p2 = recycle[recycleIdx];
          } else {
            usedRecycle = false;
            const pick = sampleFromKeySet(localEdges, rng);
            p2 = epair(pick[0], pick[1]);
          }
          const coin2 = rng();
          let newp1, newp2;
          if (coin2 < 0.5) {
            newp1 = epair(p1[0], p2[0]);
            newp2 = epair(p1[1], p2[1]);
          } else {
            newp1 = epair(p1[0], p2[1]);
            newp2 = epair(p1[1], p2[0]);
          }
          let goodChoice;
          if (newp1[0] === newp2[0] && newp1[1] === newp2[1]) goodChoice = false;
          else if (newp1[0] === newp1[1] || localEdges.has(ekey(newp1[0], newp1[1]))) goodChoice = false;
          else if (newp2[0] === newp2[1] || localEdges.has(ekey(newp2[0], newp2[1]))) goodChoice = false;
          else goodChoice = true;
          if (goodChoice) {
            if (usedRecycle) {
              recycle[recycleIdx] = recycle[recycle.length - 1];
              recycle.pop();
            } else {
              localEdges.delete(ekey(p2[0], p2[1]));
            }
            success = true;
            chosenP2 = p2; chosenSrc = usedRecycle ? "recycle" : "valid";
            chosenNewp1 = newp1; chosenNewp2 = newp2;
            localEdges.add(ekey(newp1[0], newp1[1]));
            localEdges.add(ekey(newp2[0], newp2[1]));
            break;
          }
        }
      }
      ops.push({
        p1: p1.slice(), p2: chosenP2 ? chosenP2.slice() : null,
        newp1: chosenNewp1, newp2: chosenNewp2,
        src: chosenSrc, success,
      });
      if (!success) recycle.push(p1);
    }
    return ops;
  }

  // Build a rewire-state at the point right before `opsBefore.length`
  // ops have been applied to the cluster's pair-stage output. `prePairs`
  // is `[{ u, v, bad }]` in the order produced by the kernel's pair
  // pass (loop / multi entries seed the recycle queue, the rest seed
  // localEdges). `opsBefore` is the prior op trace (same shape kernel
  // emits) used to deterministically advance the state without
  // consuming any RNG.
  function buildRewireStateFromPrePairs(prePairs, opsBefore) {
    const localEdges = new Set();
    const recycle = [];
    prePairs.forEach(p => {
      if (p.bad) recycle.push(epair(p.u, p.v));
      else localEdges.add(ekey(p.u, p.v));
    });
    let lastRecycle = recycle.length;
    let recycleCounter = lastRecycle;
    const stubsLen = 2 * prePairs.length;
    function sameXY(e, p) {
      return (e[0] === p[0] && e[1] === p[1]) || (e[0] === p[1] && e[1] === p[0]);
    }
    for (const baseOp of (opsBefore || [])) {
      recycleCounter -= 1;
      if (recycleCounter < 0) {
        if (recycle.length < lastRecycle) {
          lastRecycle = recycle.length;
          recycleCounter = lastRecycle;
        } else break;
      }
      if (recycle.length === 0) break;
      const p1 = recycle.shift();
      if (baseOp.success && baseOp.p2) {
        if (baseOp.src === "recycle") {
          const idx = recycle.findIndex(e => sameXY(e, baseOp.p2));
          if (idx >= 0) {
            recycle[idx] = recycle[recycle.length - 1];
            recycle.pop();
          }
        } else {
          localEdges.delete(ekey(baseOp.p2[0], baseOp.p2[1]));
        }
        if (baseOp.newp1) localEdges.add(ekey(baseOp.newp1[0], baseOp.newp1[1]));
        if (baseOp.newp2) localEdges.add(ekey(baseOp.newp2[0], baseOp.newp2[1]));
      } else {
        recycle.push(p1);
      }
    }
    return { localEdges, recycle, lastRecycle, recycleCounter, stubsLen };
  }

  // Public entry point for per-cluster, per-op rewire reseeding. Holds
  // every op in `opsBefore` fixed (deterministic replay), then runs
  // the canonical recycle loop with `freshRng` from there. Returns the
  // new op trace from `opsBefore.length` onward.
  function replayClusterRewireFromOps(prePairs, opsBefore, freshRng) {
    const state = buildRewireStateFromPrePairs(prePairs, opsBefore);
    return runClusterRewireLoop(state, freshRng);
  }

  // Global-rewire canonical loop, factored from configModel so the page
  // walker can drive a fresh tail with a fresh rng from any prefix.
  // `globalEdges` Set + `recycle` queue describe the bg-pool state at
  // the entry point; `clusterEdgeKeys` is the cluster-post key set used
  // for the cross-duplicate check during placement.
  function runGlobalRewireLoop(state, clusterEdgeKeys, rng) {
    const { globalEdges, recycle, stubsLen } = state;
    let { lastRecycle, recycleCounter } = state;
    const ops = [];
    while (recycle.length > 0) {
      recycleCounter -= 1;
      if (recycleCounter < 0) {
        if (recycle.length < lastRecycle) {
          lastRecycle = recycle.length;
          recycleCounter = lastRecycle;
        } else break;
      }
      const p1 = recycle.pop();
      const fromRecycle = (2 * recycle.length) / Math.max(1, stubsLen);
      const coin1 = rng();
      let p2, chosenSrc;
      if (coin1 < fromRecycle) {
        const i = Math.floor(rng() * recycle.length);
        const tmp = recycle[i];
        recycle[i] = recycle[recycle.length - 1];
        recycle.pop();
        p2 = tmp; chosenSrc = "recycle";
      } else {
        const pick = sampleFromKeySet(globalEdges, rng);
        if (!pick) {
          ops.push({
            p1: p1.slice(), p2: null, newp1: null, newp2: null,
            src: null, success: false, reason: "no-valid-pool",
            placedNewp1: false, placedNewp2: false,
          });
          recycle.push(p1); continue;
        }
        p2 = epair(pick[0], pick[1]);
        globalEdges.delete(ekey(p2[0], p2[1]));
        chosenSrc = "valid";
      }
      const coin2 = rng();
      let newp1, newp2;
      if (coin2 < 0.5) {
        newp1 = epair(p1[0], p2[0]);
        newp2 = epair(p1[1], p2[1]);
      } else {
        newp1 = epair(p1[0], p2[1]);
        newp2 = epair(p1[1], p2[0]);
      }
      let placedNewp1 = false, placedNewp2 = false;
      for (const np of [newp1, newp2]) {
        const k = ekey(np[0], np[1]);
        if (np[0] === np[1] || globalEdges.has(k) || clusterEdgeKeys.has(k)) recycle.push(np);
        else { globalEdges.add(k); if (np === newp1) placedNewp1 = true; else placedNewp2 = true; }
      }
      ops.push({
        p1: p1.slice(), p2: p2.slice(), newp1, newp2,
        src: chosenSrc, success: placedNewp1 && placedNewp2,
        placedNewp1, placedNewp2,
      });
    }
    return ops;
  }

  // Build the global-rewire entry state from `globalPrePairs` (each entry
  // is `[a, b, loop, multi, crossDup]` in whichever id-space the caller
  // uses) and apply `opsBefore` deterministically (no rng draws). The
  // canonical loop pops from the recycle tail (LIFO), so replay does the
  // same. `clusterEdgeKeys` is unused during the deterministic advance —
  // recorded ops already encode the placement outcome — but is plumbed
  // through to the runner.
  function buildGlobalRewireStateFromPrePairs(globalPrePairs, opsBefore) {
    const globalEdges = new Set();
    const recycle = [];
    for (const p of globalPrePairs) {
      const a = p[0], b = p[1], loop = p[2], multi = p[3], crossDup = p[4];
      if (loop || multi || crossDup) recycle.push([a, b]);
      else globalEdges.add(ekey(a, b));
    }
    let lastRecycle = recycle.length;
    let recycleCounter = lastRecycle;
    const stubsLen = 2 * globalPrePairs.length;
    function sameXY(e, p) {
      return (e[0] === p[0] && e[1] === p[1]) || (e[0] === p[1] && e[1] === p[0]);
    }
    for (const op of (opsBefore || [])) {
      recycleCounter -= 1;
      if (recycleCounter < 0) {
        if (recycle.length < lastRecycle) {
          lastRecycle = recycle.length;
          recycleCounter = lastRecycle;
        } else break;
      }
      if (recycle.length === 0) break;
      recycle.pop();
      if (op.reason === "no-valid-pool" || !op.p2) {
        recycle.push(op.p1.slice());
        continue;
      }
      if (op.src === "recycle") {
        const idx2 = recycle.findIndex(e => sameXY(e, op.p2));
        if (idx2 >= 0) {
          recycle[idx2] = recycle[recycle.length - 1];
          recycle.pop();
        }
      } else {
        globalEdges.delete(ekey(op.p2[0], op.p2[1]));
      }
      if (op.newp1) {
        if (op.placedNewp1) globalEdges.add(ekey(op.newp1[0], op.newp1[1]));
        else recycle.push(op.newp1.slice());
      }
      if (op.newp2) {
        if (op.placedNewp2) globalEdges.add(ekey(op.newp2[0], op.newp2[1]));
        else recycle.push(op.newp2.slice());
      }
    }
    return { globalEdges, recycle, lastRecycle, recycleCounter, stubsLen };
  }

  // Public entry point for global-rewire per-op reseeding. Mirrors
  // replayClusterRewireFromOps but for the bg-pool stage. Returns the
  // new op trace from `opsBefore.length` onward.
  function replayGlobalRewireFromOps(globalPrePairs, clusterEdgeKeys, opsBefore, freshRng) {
    const state = buildGlobalRewireStateFromPrePairs(globalPrePairs, opsBefore);
    return runGlobalRewireLoop(state, clusterEdgeKeys, freshRng);
  }

  // populate_clusters: ports the Julia loop verbatim. w must be sorted
  // descending; s must be sorted descending too (s[0] is outlier mega-
  // cluster size when hasOutliers). mu/xi follow Julia's mul derivation.
  function populateClusters(args) {
    const { w, s, hasOutliers, mu, xi, rng } = args;
    const n = w.length;
    let mul;
    if (xi == null) {
      mul = 1.0 - mu;
    } else {
      let phi;
      if (hasOutliers) {
        const s0 = s[0];
        let sumSq = 0;
        for (let k = 1; k < s.length; k++) sumSq += (s[k] / (n - s0)) ** 2;
        phi = 1.0 - sumSq * (n - s0) * xi / ((n - s0) * xi + s0);
      } else {
        let sumSq = 0;
        for (const sl of s) sumSq += (sl / n) ** 2;
        phi = 1.0 - sumSq;
      }
      mul = 1.0 - xi * phi;
    }
    if (!(mul >= 0 && mul <= 1)) throw new Error(`mul out of range: ${mul}`);
    const slots = s.slice();
    const clusters = new Array(n).fill(-1);
    let stabu = new Set();
    if (hasOutliers) {
      const nout = s[0];
      const L = w.reduce((acc, d) => acc + Math.min(1.0, xi * d), 0);
      const threshold = L + nout - (L * nout) / n - 1.0;
      let idx = -1;
      for (let i = 0; i < n; i++) if (w[i] <= threshold) { idx = i; break; }
      if (idx === -1) throw new Error("no feasible outlier suffix");
      const feasible = [];
      for (let i = idx; i < n; i++) feasible.push(i);
      if (feasible.length < nout) throw new Error("not enough feasible outliers");
      const tabuIdx = sampleWithoutReplacement(feasible, nout, rng); // 0-based
      for (const i of tabuIdx) clusters[i] = 1;
      slots[0] = 0;
      stabu = new Set(tabuIdx);
    }
    const j0 = hasOutliers ? 1 : 0; // 1-based j0 boundary in Julia
    let j = j0; // tracks furthest cluster pointer (1-based)
    let tmpWsum = 0;
    const badWeights = [];
    for (let i = 0; i < n; i++) {
      if (stabu.has(i)) continue;
      const vw = w[i];
      // Advance j until at least one slot. Mirror canonical's bad_weights
      // tracking (graph_sampler.jl:120-122): if the next cluster is too
      // small for this vertex when we still have no slots, record the
      // weight as ξ-biased.
      while (j + 1 <= s.length && tmpWsum === 0) {
        if (mul * vw + 1 > s[j + 1 - 1]) badWeights.push(vw);
        j += 1;
        tmpWsum += slots[j - 1];
      }
      // Advance further while next cluster is large enough.
      while (j + 1 <= s.length && mul * vw + 1 <= s[j + 1 - 1]) {
        j += 1;
        tmpWsum += slots[j - 1];
      }
      if (j === j0) throw new Error(`no large-enough cluster for w=${vw}`);
      const items = [];
      const weights = [];
      for (let k = j0 + 1; k <= j; k++) {
        items.push(k);
        weights.push(slots[k - 1]);
      }
      let totalW = 0;
      for (const ww of weights) totalW += ww;
      if (totalW === 0) throw new Error(`no empty slot for w=${vw}`);
      const loc = sampleWeighted(items, weights, rng); // 1-based cluster id
      clusters[i] = loc;
      slots[loc - 1] -= 1;
      tmpWsum -= 1;
    }
    if (badWeights.length > 0 && typeof console !== "undefined" && console.warn) {
      console.warn(
        `ABCD populate_clusters: could not find a large enough cluster for vertices of weights `
        + `${badWeights.join(",")}. Resulting ξ may be slightly biased.`
      );
    }
    return clusters;
  }

  // config_model port. Mirrors graph_sampler.jl::config_model with the
  // hasoutliers branch zeroing wInternalRaw on cluster-1 members.
  // traceStages=true: returns a `stages` field with per-cluster + global +
  // final snapshots for page step-walkers. Trace recording does NOT consume
  // any rng draws so logic stays byte-equal with the untraced path.
  function configModel(args) {
    const { clusters, w: wIn, s, hasOutliers, xi, rng, traceStages, overrides } = args;
    // overrides.clusterStubsByCluster: { kernelClusterId(1-based) -> stubArray }
    //   When given for a cluster, the kernel uses that stub array verbatim
    //   instead of building+shuffling its own. Multiset must match wInternal
    //   exactly. Downstream stages (recycle, residue, global) keep using the
    //   rng — so re-rolling cluster prePairs cascades into different
    //   clusterPost and bgPre.
    // overrides.wInternalByVertex: 0-based array of pre-residue wInternal[v]
    //   When given, kernel skips randround / leader-bump rng draws and uses
    //   these values directly. Caller must source from a base run (no
    //   override) — the second pass then matches base's wInternal exactly,
    //   so changes in one cluster's recycle don't shift later clusters'
    //   randround state. clusterPre.length stays invariant across rerolls.
    const stubOverrides = (overrides && overrides.clusterStubsByCluster) || null;
    const wInOverride = (overrides && overrides.wInternalByVertex) || null;
    const w = wIn.slice();
    const numClusters = s.length;
    const clusterWeight = new Array(numClusters).fill(0);
    for (let i = 0; i < w.length; i++) clusterWeight[clusters[i] - 1] += w[i];
    const wInternalRaw = w.map(wi => wi * (1 - xi));
    if (hasOutliers) {
      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i] === 1) wInternalRaw[i] = 0;
      }
    }
    const clusterList = Array.from({ length: numClusters }, () => []);
    for (let i = 0; i < clusters.length; i++) {
      clusterList[clusters[i] - 1].push(i + 1); // 1-based vertex ids
    }
    const edges = new Set();
    const wInternal = new Array(w.length).fill(0);
    const stages = traceStages
      ? { perCluster: [], global: null, final: null }
      : null;

    for (let cidx0 = 0; cidx0 < numClusters; cidx0++) {
      const cluster = clusterList[cidx0];
      if (cluster.length === 0) {
        if (stages) stages.perCluster.push({
          cluster: cidx0 + 1, members: [], stubsShuffled: [],
          prePairs: [], postEdges: [], residueForwarded: 0,
        });
        continue;
      }
      // Find max-weight leader (0-based index into cluster).
      let maxIdx0 = 0, maxVal = -Infinity;
      for (let k = 0; k < cluster.length; k++) {
        const val = wInternalRaw[cluster[k] - 1];
        if (val > maxVal) { maxVal = val; maxIdx0 = k; }
      }
      let wsum = 0;
      for (let k = 0; k < cluster.length; k++) {
        if (k !== maxIdx0) {
          const r = wInOverride
            ? wInOverride[cluster[k] - 1]
            : randround(wInternalRaw[cluster[k] - 1], rng);
          wInternal[cluster[k] - 1] = r;
          wsum += r;
        }
      }
      if (wInOverride) {
        wInternal[cluster[maxIdx0] - 1] = wInOverride[cluster[maxIdx0] - 1];
      } else {
        const maxw = Math.floor(wInternalRaw[cluster[maxIdx0] - 1]);
        let bump;
        if (wsum % 2 !== 0) {
          bump = maxw % 2 === 0 ? 1 : 0;
        } else {
          bump = maxw % 2 !== 0 ? 1 : 0;
        }
        wInternal[cluster[maxIdx0] - 1] = maxw + bump;
      }
      if (wInternal[cluster[maxIdx0] - 1] > w[cluster[maxIdx0] - 1]) {
        w[cluster[maxIdx0] - 1] = wInternal[cluster[maxIdx0] - 1];
      }
      const stubs = [];
      for (const v of cluster) {
        for (let k = 0; k < wInternal[v - 1]; k++) stubs.push(v);
      }
      // Always consume the shuffle's rng draws so randround / recycle /
      // global stages downstream stay in lock-step with the no-override
      // run; only THEN overwrite stubs with the caller-supplied order.
      // Skipping the shuffle when override is set would shift the rng
      // state and change wInternal for later clusters.
      shuffleInPlace(stubs, rng);
      const stubOverride = stubOverrides && stubOverrides[cidx0 + 1];
      if (stubOverride) {
        for (let i = 0; i < stubs.length; i++) stubs[i] = stubOverride[i];
      }
      const stubsShuffledSnap = stubs.slice();
      // Snapshot wInternal[v] for cluster members BEFORE residue forwarding
      // (mutations below decrement wInternal for any forwarded residue stub).
      // Pages that surface the y/z weight split want the pre-forwarding value.
      const wInternalPreForwardSnap = stages
        ? cluster.map(v => wInternal[v - 1])
        : null;

      const localEdges = new Set();
      let recycle = [];
      const prePairsSnap = [];
      for (let i = 0; i + 1 < stubs.length; i += 2) {
        const a = stubs[i], b = stubs[i + 1];
        const e = epair(a, b);
        const k = ekey(a, b);
        const loop = a === b;
        const multi = !loop && localEdges.has(k);
        if (loop || multi) recycle.push(e);
        else localEdges.add(k);
        if (stages) prePairsSnap.push([a, b, loop, multi]);
      }
      const rewireState = {
        localEdges, recycle,
        lastRecycle: recycle.length,
        recycleCounter: recycle.length,
        stubsLen: stubs.length,
      };
      const loopOps = runClusterRewireLoop(rewireState, rng);
      const rewireOps = stages ? loopOps : null;
      for (const k of localEdges) edges.add(k);
      let residueForwarded = 0;
      const residueEntries = stages ? recycle.map(p => p.slice()) : null;
      for (const [a, b] of recycle) {
        wInternal[a - 1] -= 1;
        wInternal[b - 1] -= 1;
        residueForwarded += 2;
      }
      if (stages) stages.perCluster.push({
        cluster: cidx0 + 1,
        members: cluster.slice(),
        wInternalPreForward: wInternalPreForwardSnap,
        stubsShuffled: stubsShuffledSnap,
        prePairs: prePairsSnap,
        rewireOps,
        postEdges: Array.from(localEdges).map(k => k.split("-").map(Number)),
        residueForwarded,
        residueEntries,
      });
    }

    // Global stage.
    const stubs = [];
    for (let i = 0; i < w.length; i++) {
      for (let k = wInternal[i] + 1; k <= w[i]; k++) stubs.push(i + 1);
    }
    shuffleInPlace(stubs, rng);
    const globalStubsSnap = stages ? stubs.slice() : null;
    if (stubs.length % 2 === 1) {
      let maxi = 0;
      for (let i = 1; i < stubs.length; i++) {
        if (w[stubs[i] - 1] > w[stubs[maxi] - 1]) maxi = i;
      }
      const si = stubs[maxi];
      stubs.splice(maxi, 1);
      w[si - 1] -= 1;
    }
    const globalEdges = new Set();
    let recycle = [];
    const globalPrePairsSnap = [];
    for (let i = 0; i + 1 < stubs.length; i += 2) {
      const a = stubs[i], b = stubs[i + 1];
      const e = epair(a, b);
      const k = ekey(a, b);
      const loop = a === b;
      const multi = !loop && globalEdges.has(k);
      const crossDup = !loop && !multi && edges.has(k);
      if (loop || multi || crossDup) recycle.push(e);
      else globalEdges.add(k);
      if (stages) globalPrePairsSnap.push([a, b, loop, multi, crossDup]);
    }
    let lastRecycle = recycle.length;
    let recycleCounter = lastRecycle;
    const globalRewireOps = stages ? [] : null;
    while (recycle.length > 0) {
      recycleCounter -= 1;
      if (recycleCounter < 0) {
        if (recycle.length < lastRecycle) {
          lastRecycle = recycle.length;
          recycleCounter = lastRecycle;
        } else break;
      }
      const p1 = recycle.pop();
      const fromRecycle = (2 * recycle.length) / Math.max(1, stubs.length);
      const coin1 = rng();
      let p2, chosenSrc;
      if (coin1 < fromRecycle) {
        const i = Math.floor(rng() * recycle.length);
        const tmp = recycle[i];
        recycle[i] = recycle[recycle.length - 1];
        recycle.pop();
        p2 = tmp; chosenSrc = "recycle";
      } else {
        const pick = sampleFromKeySet(globalEdges, rng);
        if (!pick) {
          if (globalRewireOps) globalRewireOps.push({
            p1: p1.slice(), p2: null, newp1: null, newp2: null,
            src: null, success: false, reason: "no-valid-pool",
          });
          recycle.push(p1); continue;
        }
        p2 = epair(pick[0], pick[1]);
        globalEdges.delete(ekey(p2[0], p2[1]));
        chosenSrc = "valid";
      }
      const coin2 = rng();
      let newp1, newp2;
      if (coin2 < 0.5) {
        newp1 = epair(p1[0], p2[0]);
        newp2 = epair(p1[1], p2[1]);
      } else {
        newp1 = epair(p1[0], p2[1]);
        newp2 = epair(p1[1], p2[0]);
      }
      let placedNewp1 = false, placedNewp2 = false;
      for (const np of [newp1, newp2]) {
        const k = ekey(np[0], np[1]);
        if (np[0] === np[1] || globalEdges.has(k) || edges.has(k)) recycle.push(np);
        else { globalEdges.add(k); if (np === newp1) placedNewp1 = true; else placedNewp2 = true; }
      }
      if (globalRewireOps) globalRewireOps.push({
        p1: p1.slice(), p2: p2.slice(), newp1, newp2,
        src: chosenSrc, success: placedNewp1 && placedNewp2,
        placedNewp1, placedNewp2,
      });
    }
    for (const k of globalEdges) edges.add(k);
    if (stages) {
      stages.global = {
        stubsShuffled: globalStubsSnap,
        prePairs: globalPrePairsSnap,
        rewireOps: globalRewireOps,
        postEdges: Array.from(globalEdges).map(k => k.split("-").map(Number)),
        residueAfterRewire: recycle.length,
      };
    }

    // Final stage: any persistent residue rewires against the union edges.
    const finalEdgesSnap = stages ? Array.from(edges).map(k => k.split("-").map(Number)) : null;
    const finalRecycleSnap = stages ? recycle.map(p => p.slice()) : null;
    const finalRewireOps = stages ? [] : null;
    if (recycle.length > 0) {
      let lr = recycle.length;
      let rc = lr;
      while (recycle.length > 0) {
        rc -= 1;
        if (rc < 0) {
          if (recycle.length < lr) { lr = recycle.length; rc = lr; }
          else break;
        }
        const p1 = recycle.pop();
        const pick = sampleFromKeySet(edges, rng);
        if (!pick) { recycle.push(p1); break; }
        const x = epair(pick[0], pick[1]);
        edges.delete(ekey(x[0], x[1]));
        const p2 = x;
        const coin = rng();
        let newp1, newp2;
        if (coin < 0.5) {
          newp1 = epair(p1[0], p2[0]);
          newp2 = epair(p1[1], p2[1]);
        } else {
          newp1 = epair(p1[0], p2[1]);
          newp2 = epair(p1[1], p2[0]);
        }
        let keep1, keep2;
        for (const np of [newp1, newp2]) {
          const k = ekey(np[0], np[1]);
          const bad = (np[0] === np[1]) || edges.has(k);
          if (np === newp1) keep1 = !bad;
          else keep2 = !bad;
          if (bad) recycle.push(np);
          else edges.add(k);
        }
        if (finalRewireOps) {
          finalRewireOps.push({
            p1: p1.slice(), p2: p2.slice(),
            newp1: newp1.slice(), newp2: newp2.slice(),
            coin, keep1, keep2,
          });
        }
      }
    }

    const edgeArr = Array.from(edges).map(k => k.split("-").map(Number))
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    if (stages) {
      stages.final = {
        edgesBefore: finalEdgesSnap,
        recycleBefore: finalRecycleSnap,
        rewireOps: finalRewireOps,
        residueAfter: recycle.length,
        residueLeft: recycle.map(p => p.slice()),
      };
    }
    return {
      edges: edgeArr,
      wInternal,
      residueAfter: recycle.length,
      stages,
    };
  }

  function sampleAbcd(args) {
    const { w, s, hasOutliers = false, xi, mu, rng } = args;
    const clusters = populateClusters({ w, s, hasOutliers, mu, xi, rng });
    const cm = configModel({ clusters, w, s, hasOutliers, xi: xi != null ? xi : null, rng });
    return { clusters, edges: cm.edges, wInternal: cm.wInternal, residueAfter: cm.residueAfter };
  }

  window.ABCDKernel = {
    randround,
    shuffleInPlace,
    sampleWeighted,
    sampleWithoutReplacement,
    sampleFromKeySet,
    populateClusters,
    configModel,
    sampleAbcd,
    replayClusterRewireFromOps,
    replayGlobalRewireFromOps,
  };
})();
