// EC-SBM kernel: browser-loadable JS port of
// externals/ec-sbm/src/gen_kec_core.py::generate_internal_edges.
//
// Builds a k-edge-connected core per cluster via the canonical two-phase
// scheme:
//   phase 1: form a complete graph K_{k+1} on the top-(k+1) nodes by
//     residual degree (tie-break iid asc),
//   phase 2: each remaining node attaches to k earlier nodes,
//     greedy-by-residual-degree first, then degree-weighted
//     np.random.choice fallback.
// Mutates `deg` (residual after the constructive pass) and `probs` (the
// block-pair edge budget after capacity inflation) in place, mirroring
// canonical's mutation semantics so the caller can reuse them as the
// input to the SBM overlay (v1) or the residual SBM (v2).
//
// Faithful divergence from canonical (documented):
// - Phase 1's `for v in processed_nodes` iterates a Python set, which
//   the canonical pipeline runs under PYTHONHASHSEED=0 for repro
//   (per ec_sbm_externals_hash_bugs.md). The JS port uses an
//   insertion-order Set; iteration order matches Python's
//   PYTHONHASHSEED=0 by coincidence for small inputs but is not
//   guaranteed. Acceptable since the page's bar is structural
//   faithfulness, not byte-equality.
//
// Randomness: caller passes a JS rng (() -> [0,1)). Phase 2 fallback
// uses a degree-weighted draw equivalent to np.random.choice(p=weights).
//
// Exposed as window.ECSBMKernel:
//   normalizeEdge(u, v) -> [a, b]                       (canonical edge form)
//   sortByDegThenIid(nodes, deg) -> sorted copy
//   weightedChoice(items, weights, rng) -> item         (np.random.choice port)
//   generateCluster(args) -> { edges, trace }
//     args = { clusterNodes, k, deg, probs, node2cluster, rng }
//   generateInternalEdges(args) -> { edges, trace, perCluster }
//     args = { clustering, mcs, deg, probs, node2cluster, rng }
//
// `trace` is a flat list of step descriptors used by the page step
// walker:
//   { stage: "phase1", cid, u, v }                       complete-graph rung
//   { stage: "phase2-greedy", cid, u, v }               greedy attach
//   { stage: "phase2-weighted", cid, u, v, candidates } np.random.choice fallback
//   { stage: "phase2-skip-zero", cid, u, v }            int_deg[v]==0 skip
//   { stage: "inflate", u, v, cu, cv }                  ensure_edge_capacity bumped budget
(function () {
  "use strict";

  function normalizeEdge(u, v) { return u <= v ? [u, v] : [v, u]; }
  function edgeKey(u, v) { const [a, b] = normalizeEdge(u, v); return `${a},${b}`; }

  function sortByDegThenIid(nodes, intDeg) {
    return nodes.slice().sort((a, b) => {
      const da = intDeg[a], db = intDeg[b];
      if (da !== db) return db - da;        // desc by deg
      return a - b;                          // tie-break iid asc
    });
  }

  // np.random.choice(list_cands, p=weights) port. Cumulative-sum + binary
  // search over a uniform draw. weights are non-negative and sum to 1.
  function weightedChoice(items, weights, rng) {
    const cum = new Array(weights.length);
    let s = 0;
    for (let i = 0; i < weights.length; i++) {
      s += weights[i];
      cum[i] = s;
    }
    if (s === 0) {
      return items[Math.floor(rng() * items.length)];
    }
    const r = rng() * s;
    for (let i = 0; i < items.length; i++) {
      if (r < cum[i]) return items[i];
    }
    return items[items.length - 1];
  }

  function probsGet(probs, r, c) {
    return probs[r] && probs[r][c] ? probs[r][c] : 0;
  }
  function probsAdd(probs, r, c, delta) {
    if (!probs[r]) probs[r] = [];
    probs[r][c] = (probs[r][c] || 0) + delta;
  }

  function generateCluster(args) {
    const { clusterNodes, k: kRaw, deg, probs, node2cluster, rng } = args;
    const trace = [];
    const edges = new Map();
    const n = clusterNodes.length;
    if (n === 0 || kRaw === 0) return { edges, trace };
    const k = Math.min(kRaw, n - 1);

    const intDeg = deg.slice();
    const ordered = sortByDegThenIid(clusterNodes, intDeg);

    const processedSet = new Set();

    function ensureEdgeCapacity(u, v) {
      const cu = node2cluster.get(u), cv = node2cluster.get(v);
      if (probsGet(probs, cu, cv) === 0 || intDeg[v] === 0) {
        intDeg[u] += 1;
        intDeg[v] += 1;
        probsAdd(probs, cu, cv, 1);
        probsAdd(probs, cv, cu, 1);
        trace.push({ stage: "inflate", u, v, cu, cv });
      }
    }
    function applyEdge(u, v) {
      const [a, b] = normalizeEdge(u, v);
      edges.set(`${a},${b}`, [a, b]);
      intDeg[u] -= 1;
      intDeg[v] -= 1;
      const cu = node2cluster.get(u), cv = node2cluster.get(v);
      probsAdd(probs, cu, cv, -1);
      probsAdd(probs, cv, cu, -1);
    }

    let i = 0;
    while (i <= k) {
      const u = ordered[i];
      // canonical iterates `for v in processed_nodes`; insertion-order Set
      // mirrors PYTHONHASHSEED=0 iteration for the inputs we care about.
      for (const v of processedSet) {
        ensureEdgeCapacity(u, v);
        applyEdge(u, v);
        trace.push({ stage: "phase1", cid: args.cid, u, v });
      }
      processedSet.add(u);
      i += 1;
    }
    while (i < n) {
      const u = ordered[i];
      const processedOrdered = sortByDegThenIid(
        Array.from(processedSet), intDeg,
      );
      const candidates = new Set(processedSet);
      let ii = 0, iii = 0;
      while (ii < k && iii < processedOrdered.length) {
        const v = processedOrdered[iii];
        iii += 1;
        ensureEdgeCapacity(u, v);
        if (intDeg[v] === 0) {
          trace.push({ stage: "phase2-skip-zero", cid: args.cid, u, v });
          continue;
        }
        applyEdge(u, v);
        candidates.delete(v);
        trace.push({ stage: "phase2-greedy", cid: args.cid, u, v });
        ii += 1;
      }
      while (ii < k) {
        const listCands = Array.from(candidates).sort((a, b) => a - b);
        let degSum = 0;
        for (const c of listCands) degSum += deg[c];
        const weights = degSum > 0
          ? listCands.map((c) => deg[c] / degSum)
          : listCands.map(() => 1 / listCands.length);
        const v = weightedChoice(listCands, weights, rng);
        ensureEdgeCapacity(u, v);
        applyEdge(u, v);
        candidates.delete(v);
        trace.push({
          stage: "phase2-weighted", cid: args.cid, u, v,
          candidates: listCands.slice(),
        });
        ii += 1;
      }
      processedSet.add(u);
      i += 1;
    }
    for (let j = 0; j < deg.length; j++) deg[j] = intDeg[j];
    return { edges, trace };
  }

  function generateInternalEdges(args) {
    const { clustering, mcs, deg, probs, node2cluster, rng } = args;
    const allEdges = new Map();
    const allTrace = [];
    const perCluster = new Map();
    for (const [cid, clusterNodes] of clustering.entries()) {
      const sub = generateCluster({
        clusterNodes, k: mcs[cid], deg, probs, node2cluster, rng, cid,
      });
      for (const [k, v] of sub.edges.entries()) allEdges.set(k, v);
      for (const t of sub.trace) allTrace.push(t);
      perCluster.set(cid, { edges: sub.edges, trace: sub.trace });
    }
    return { edges: allEdges, trace: allTrace, perCluster };
  }

  // Faithful port of externals/ec-sbm/src/gen_outlier.py::_accumulate_all
  // for v2 residual-SBM input prep. Returns { probs, out_degs } where
  //   - probs is the inter-block edge-count matrix from orig (deduped),
  //     diagonals rebalanced so |sum stubs| in block k matches inter-row
  //     sum, padded for parity if needed.
  //   - out_degs is per-iid post-residual stub count (orig - exist).
  // exist edges with iids outside node universe are silently skipped.
  function prepareV2SBMInputs(args) {
    const { numIids, blocks, numBlocks, origEdges, existEdges } = args;
    const probs = Array.from({length: numBlocks},
      () => new Array(numBlocks).fill(0));
    const outDegs = new Array(numIids).fill(0);

    function dedup(pairs) {
      const seen = new Set();
      const out = [];
      pairs.forEach(([u, v]) => {
        const a = u < v ? u : v;
        const b = u < v ? v : u;
        const key = `${a},${b}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push([a, b]);
      });
      return out;
    }

    const origDedup = dedup(origEdges);
    origDedup.forEach(([u, v]) => { outDegs[u] += 1; outDegs[v] += 1; });

    if (existEdges && existEdges.length) {
      const existDedup = dedup(existEdges);
      existDedup.forEach(([u, v]) => {
        if (u < 0 || u >= numIids || v < 0 || v >= numIids) return;
        outDegs[u] = Math.max(0, outDegs[u] - 1);
        outDegs[v] = Math.max(0, outDegs[v] - 1);
      });
    }

    origDedup.forEach(([u, v]) => {
      const bu = blocks[u], bv = blocks[v];
      if (bu !== bv) {
        probs[bu][bv] += 1;
        probs[bv][bu] += 1;
      }
    });

    const rowSums = probs.map(r => r.reduce((a, b) => a + b, 0));
    for (let k = 0; k < numBlocks; k++) {
      const nodesInK = [];
      for (let i = 0; i < numIids; i++) if (blocks[i] === k) nodesInK.push(i);
      if (nodesInK.length === 0) continue;
      let dk = 0;
      nodesInK.forEach(i => { dk += outDegs[i]; });
      const eInter = rowSums[k];
      const diff = dk - eInter;
      if (diff < 0) {
        const deficit = -diff;
        for (let i = 0; i < deficit; i++) {
          outDegs[nodesInK[i % nodesInK.length]] += 1;
        }
        probs[k][k] = 0;
      } else {
        probs[k][k] = diff;
        if (probs[k][k] % 2 !== 0) {
          probs[k][k] += 1;
          outDegs[nodesInK[0]] += 1;
        }
      }
    }
    return { probs, outDegs };
  }

  // Faithful port of externals/ec-sbm/src/gen_outlier.py::rewire_invalid_edges
  // (block-preserving 2-opt). Edges = list of [u, v] iid pairs (multigraph
  // including self-loops + duplicates). Returns { kept, dropped } where
  //   kept is the simple edgelist after rewire passes,
  //   dropped is what could not be resolved within maxRetries.
  // Faithful divergence: canonical iterates a Python defaultdict of bp
  // → list; the JS port uses a plain object keyed by `${a}|${b}`. Pop
  // semantics match canonical (swap-with-last).
  function rewireInvalidEdges(args) {
    const { edges, blocks, rng, maxRetries = 10 } = args;
    const validPool = {};
    const validSet = new Set();
    const invalidEdges = [];

    function bp(u, v) {
      const a = blocks[u] <= blocks[v] ? blocks[u] : blocks[v];
      const b = blocks[u] <= blocks[v] ? blocks[v] : blocks[u];
      return `${a}|${b}`;
    }

    edges.forEach(([u, v]) => {
      const a = u < v ? u : v;
      const b = u < v ? v : u;
      const key = `${a},${b}`;
      if (u === v || validSet.has(key)) {
        invalidEdges.push([u, v]);
      } else {
        const k = bp(u, v);
        if (!validPool[k]) validPool[k] = [];
        validSet.add(key);
        validPool[k].push([a, b]);
      }
    });

    function processOneEdge(rawEdge) {
      const [u, v] = rawEdge;
      const k = bp(u, v);
      const pool = validPool[k];
      if (!pool || pool.length === 0) {
        invalidEdges.push([u, v]);
        return false;
      }
      const idx = Math.floor(rng() * pool.length);
      const [x, y] = pool[idx];
      const [A, B] = k.split("|").map(Number);

      let new_e1, new_e2;
      if (A !== B) {
        const u_A = blocks[u] === A ? u : v;
        const u_B = blocks[u] === A ? v : u;
        const x_A = blocks[x] === A ? x : y;
        const x_B = blocks[x] === A ? y : x;
        const a1 = u_A < x_B ? u_A : x_B, b1 = u_A < x_B ? x_B : u_A;
        const a2 = x_A < u_B ? x_A : u_B, b2 = x_A < u_B ? u_B : x_A;
        new_e1 = [a1, b1];
        new_e2 = [a2, b2];
      } else {
        let a1, b1, a2, b2;
        if (rng() < 0.5) {
          a1 = u < x ? u : x; b1 = u < x ? x : u;
          a2 = v < y ? v : y; b2 = v < y ? y : v;
        } else {
          a1 = u < y ? u : y; b1 = u < y ? y : u;
          a2 = v < x ? v : x; b2 = v < x ? x : v;
        }
        new_e1 = [a1, b1];
        new_e2 = [a2, b2];
      }
      const k1 = `${new_e1[0]},${new_e1[1]}`;
      const k2 = `${new_e2[0]},${new_e2[1]}`;
      if (
        new_e1[0] !== new_e1[1] && new_e2[0] !== new_e2[1] &&
        !validSet.has(k1) && !validSet.has(k2) && k1 !== k2
      ) {
        const xyKey = `${x},${y}`;
        validSet.delete(xyKey);
        pool[idx] = pool[pool.length - 1];
        pool.pop();
        validSet.add(k1); validSet.add(k2);
        pool.push(new_e1); pool.push(new_e2);
      } else {
        invalidEdges.push([u, v]);
      }
      return false;
    }

    // Faithful port of run_rewire_attempts: stagnation-aware retry loop.
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (invalidEdges.length === 0) break;
      let lastRecycle = invalidEdges.length;
      let recycleCounter = lastRecycle;
      while (invalidEdges.length > 0) {
        recycleCounter -= 1;
        if (recycleCounter < 0) {
          if (invalidEdges.length < lastRecycle) {
            lastRecycle = invalidEdges.length;
            recycleCounter = lastRecycle;
          } else {
            break;
          }
        }
        const e = invalidEdges.shift();
        processOneEdge(e);
      }
    }

    const kept = [];
    Object.keys(validPool).forEach(k => {
      validPool[k].forEach(e => kept.push(e.slice()));
    });
    return { kept, dropped: invalidEdges.slice() };
  }

  window.ECSBMKernel = {
    normalizeEdge,
    edgeKey,
    sortByDegThenIid,
    weightedChoice,
    generateCluster,
    generateInternalEdges,
    prepareV2SBMInputs,
    rewireInvalidEdges,
  };
})();
