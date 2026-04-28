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
    const { clusters, w: wIn, s, hasOutliers, xi, rng, traceStages } = args;
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
          const r = randround(wInternalRaw[cluster[k] - 1], rng);
          wInternal[cluster[k] - 1] = r;
          wsum += r;
        }
      }
      const maxw = Math.floor(wInternalRaw[cluster[maxIdx0] - 1]);
      let bump;
      if (wsum % 2 !== 0) {
        bump = maxw % 2 === 0 ? 1 : 0;
      } else {
        bump = maxw % 2 !== 0 ? 1 : 0;
      }
      wInternal[cluster[maxIdx0] - 1] = maxw + bump;
      if (wInternal[cluster[maxIdx0] - 1] > w[cluster[maxIdx0] - 1]) {
        w[cluster[maxIdx0] - 1] = wInternal[cluster[maxIdx0] - 1];
      }
      const stubs = [];
      for (const v of cluster) {
        for (let k = 0; k < wInternal[v - 1]; k++) stubs.push(v);
      }
      shuffleInPlace(stubs, rng);
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
      let lastRecycle = recycle.length;
      let recycleCounter = lastRecycle;
      const rewireOps = stages ? [] : null;
      while (recycle.length > 0) {
        recycleCounter -= 1;
        if (recycleCounter < 0) {
          if (recycle.length < lastRecycle) {
            lastRecycle = recycle.length;
            recycleCounter = lastRecycle;
          } else break;
        }
        const p1 = recycle.shift();
        const fromRecycle = (2 * recycle.length) / Math.max(1, stubs.length);
        let success = false;
        let chosenP2 = null, chosenSrc = null, chosenNewp1 = null, chosenNewp2 = null;
        if (!(recycle.length === 0 && localEdges.size === 0)) {
          const innerIters = Math.floor(stubs.length / 2);
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
        if (rewireOps) rewireOps.push({
          p1: p1.slice(), p2: chosenP2 ? chosenP2.slice() : null,
          newp1: chosenNewp1, newp2: chosenNewp2,
          src: chosenSrc, success,
        });
        if (!success) recycle.push(p1);
      }
      for (const k of localEdges) edges.add(k);
      let residueForwarded = 0;
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
        for (const np of [newp1, newp2]) {
          const k = ekey(np[0], np[1]);
          if (np[0] === np[1] || edges.has(k)) recycle.push(np);
          else edges.add(k);
        }
      }
    }

    const edgeArr = Array.from(edges).map(k => k.split("-").map(Number))
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    if (stages) {
      stages.final = { residueAfter: recycle.length };
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
  };
})();
