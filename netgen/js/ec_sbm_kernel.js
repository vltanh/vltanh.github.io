// EC-SBM kernel: browser-loadable JS port of
// externals/ec-sbm/src/gen_kec_core.py + gen_outlier.py + gen_pso_core.py +
// graph_utils.py.
//
// CURRENT-CANONICAL kec-core (generateClusterBands / generateInternalEdgesBands):
//   phase 1: form a complete graph K_{k+1} on the top-(k+1) nodes by residual
//     degree (tie-break iid asc); each new node attaches to ALL already-
//     processed nodes (`for v in sorted(processed)`).
//   phase 2: each remaining node draws k distinct processed nodes in ONE
//     sample_by_availability call: a single weighted-WITHOUT-replacement
//     np.random.choice(size=weighted_count, replace=False, p=availability/sum)
//     over positive-residual candidates, then a uniform-without-replacement
//     fill over the exhausted ones. ensure_edge_capacity predicate is
//     `cu==cv ? probs[cu,cv]<2 : (probs[cu,cv]==0 || probs[cv,cu]==0)`
//     `|| int_deg[u]<=0 || int_deg[v]<=0`.
// Mutates `deg` (residual after the constructive pass) and `probs` (the
// block-pair edge budget after capacity inflation) in place, so the caller
// can reuse them as the input to the SBM overlay (v1) or the residual SBM
// (v2/v3).
//
// RNG family (audit A): the JS production walker uses ONE d3.randomLcg stream;
// canonical chains five RNG families (np MT19937 kec-choice, python MT19937,
// random.Random matcher, numpy PCG64 PSO, graph-tool internal). There is NO
// bit-equal family map. Byte-equality on the EC-SBM-specific DETERMINISTIC
// stages (kec-core, accumulate, rewire) is established by ORACLE-REPLAY: the
// canonical tracer emits resolved picks, the kernel replays them via __ORACLE
// (see tools/viz_check/ec_sbm/). The SBM-overlay leg defers to the SBM agent's
// gt.generate_sbm byte-equal result.
//
// Instrumentation: every state read/write/branch fires a guarded PROBE(tag,
// payload) hook; oracle-driven kec-core reads picks from __ORACLE. Both are
// zero-cost (short-circuit) when no harness installs globalThis.__HOOK /
// __ORACLE, so the in-browser walker behaves identically to an un-hooked port.
//
// LEGACY generateCluster / generateInternalEdges (greedy-then-single-pick) are
// KEPT for the existing page step-walker but are NOT byte-equal to current
// canonical (see ec_sbm_dossier.md). When the page is reworked, swap to
// generateClusterBands / generateInternalEdgesBands.
//
// Exposed as window.ECSBMKernel: normalizeEdge, edgeKey, sortByDegThenIid,
// weightedChoice, generateCluster + generateInternalEdges (legacy),
// generateClusterBands + generateInternalEdgesBands (CORRECTED),
// prepareV2SBMInputs (accumulate), rewireInvalidEdges,
// psoClusterEdges / inducedGlobalCcoeff / searchTForCluster (v3 PSO).
(function () {
  "use strict";

  // ── Instrumentation hooks (zero-cost when no harness installs __HOOK) ──
  // A verification harness sets globalThis.__HOOK = (tag, payload) => {...}
  // before loading this file. Production (browser) never sets it, so PROBE
  // short-circuits and the kernel behaves identically to the canonical
  // vltanh.github.io/netgen/js/ec_sbm_kernel.js.
  function PROBE(tag, payload) {
    if (typeof globalThis.__HOOK === "function") globalThis.__HOOK(tag, payload);
  }
  // Oracle injection: when an oracle cursor is installed the corrected
  // kec-core (generateClusterBands) reads recorded picks instead of drawing
  // from rng. Default null ⇒ self-RNG behaviour unchanged.
  function ORACLE() {
    return (typeof globalThis.__ORACLE === "object") ? globalThis.__ORACLE : null;
  }

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
      // Match canonical's `for v in sorted(processed_nodes)` (gen_kec_core.py
      // post-determinism fix): the per-edge ensure_edge_capacity sequence
      // depends on int_deg / probs state, so iteration order leaks into the
      // residual + inflate trace. Sorting iid-asc matches canonical exactly.
      const phase1Sorted = Array.from(processedSet).sort((a, b) => a - b);
      for (const v of phase1Sorted) {
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
    // Iterate cluster_iid asc so the per-cluster mutation order matches
    // canonical (post-determinism fix in externals/ec-sbm/src/gen_kec_core.py).
    const sortedCids = Array.from(clustering.keys()).sort((a, b) => a - b);
    for (const cid of sortedCids) {
      const clusterNodes = clustering.get(cid);
      const sub = generateCluster({
        clusterNodes, k: mcs[cid], deg, probs, node2cluster, rng, cid,
      });
      for (const [k, v] of sub.edges.entries()) allEdges.set(k, v);
      for (const t of sub.trace) allTrace.push(t);
      perCluster.set(cid, { edges: sub.edges, trace: sub.trace });
    }
    return { edges: allEdges, trace: allTrace, perCluster };
  }

  // ── CORRECTED kec-core port (current canonical) ───────────────────────
  // generate_cluster_bands as shipped TODAY in gen_kec_core.py: per
  // attaching node ONE weighted-without-replacement np.random.choice over
  // positive-residual processed candidates, then a uniform-without-
  // replacement fill; ensure_edge_capacity predicate is the cu==cv ? <2 :
  // (==0 or ==0) || int_deg<=0 form. The legacy generateCluster above is
  // KEPT for the existing page step-walker but is NOT byte-equal to current
  // canonical (see ec_sbm_dossier.md). Oracle-driven: __ORACLE supplies the
  // resolved picks (RNG family swap is a sanctioned divergence).
  function probsCGet(probs, r, c) {
    return (probs.get(`${r},${c}`) || 0);
  }
  function probsCAdd(probs, r, c, d) {
    const k = `${r},${c}`; probs.set(k, (probs.get(k) || 0) + d);
  }
  function generateClusterBands(args) {
    const { clusterNodes, k: kRaw, deg, probs, node2cluster, cid } = args;
    const n = clusterNodes.length;
    if (n === 0 || kRaw === 0) return { clique: new Map(), attach: new Map() };
    const k = Math.min(kRaw, n - 1);
    const intDeg = deg.slice();
    const ordered = clusterNodes.slice().sort((a, b) => {
      const da = intDeg[a], db = intDeg[b];
      if (da !== db) return db - da;
      return a - b;
    });
    const processed = [];
    const clique = new Map();
    const attach = new Map();
    let bucket = clique;
    const oracle = ORACLE();

    function ensureEdgeCapacity(u, v) {
      const cu = node2cluster.get(u), cv = node2cluster.get(v);
      let blockLow;
      if (cu === cv) blockLow = probsCGet(probs, cu, cv) < 2;
      else blockLow = probsCGet(probs, cu, cv) === 0 || probsCGet(probs, cv, cu) === 0;
      const degLow = intDeg[u] <= 0 || intDeg[v] <= 0;
      if (blockLow || degLow) {
        intDeg[u] += 1; intDeg[v] += 1;
        probsCAdd(probs, cu, cv, 1); probsCAdd(probs, cv, cu, 1);
        PROBE("inflate", { cid, u, v, cu, cv, blockLow, degLow });
      }
    }
    function applyEdge(u, v) {
      const [a, b] = normalizeEdge(u, v);
      bucket.set(`${a},${b}`, [a, b]);
      intDeg[u] -= 1; intDeg[v] -= 1;
      const cu = node2cluster.get(u), cv = node2cluster.get(v);
      probsCAdd(probs, cu, cv, -1); probsCAdd(probs, cv, cu, -1);
      PROBE("apply", { cid, u, v, idU: intDeg[u], idV: intDeg[v] });
    }
    function sampleByAvailability(candidates, sampleSize) {
      const availability = candidates.map((c) => Math.max(intDeg[c], 0));
      const nPos = availability.filter((a) => a > 0).length;
      const selected = [];
      const weightedCount = Math.min(sampleSize, nPos);
      if (weightedCount) {
        const rec = oracle.next("weighted_choice");
        PROBE("weighted_choice", { cid, picked: rec.picked.slice() });
        for (const p of rec.picked) selected.push(p);
      }
      const uniformCount = sampleSize - weightedCount;
      if (uniformCount) {
        const rec = oracle.next("uniform_choice");
        PROBE("uniform_choice", { cid, picked: rec.picked.slice() });
        for (const p of rec.picked) selected.push(p);
      }
      return selected;
    }

    let i = 0;
    while (i <= k) {
      const u = ordered[i];
      const rec = oracle.next("set_order");
      for (const v of rec.order) { ensureEdgeCapacity(u, v); applyEdge(u, v); }
      processed.push(u);
      i += 1;
    }
    bucket = attach;
    while (i < n) {
      const u = ordered[i];
      for (const v of sampleByAvailability(processed, k)) {
        ensureEdgeCapacity(u, v); applyEdge(u, v);
      }
      processed.push(u);
      i += 1;
    }
    for (let j = 0; j < deg.length; j++) deg[j] = intDeg[j];
    return { clique, attach };
  }
  function generateInternalEdgesBands(args) {
    const { clustering, mcs, deg, probs, node2cluster } = args;
    const all = new Map();
    const cids = Array.from(clustering.keys()).sort((a, b) => a - b);
    for (const cid of cids) {
      const bands = generateClusterBands({
        clusterNodes: clustering.get(cid), k: mcs[cid], deg, probs,
        node2cluster, cid,
      });
      for (const [k, v] of bands.clique) all.set(k, v);
      for (const [k, v] of bands.attach) all.set(k, v);
    }
    return all;
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
      PROBE("accum_block", { k, dk, eInter, diff });
      if (diff < 0) {
        const deficit = -diff;
        for (let i = 0; i < deficit; i++) {
          outDegs[nodesInK[i % nodesInK.length]] += 1;
        }
        probs[k][k] = 0;
        PROBE("accum_deficit", { k, deficit });
      } else {
        probs[k][k] = diff;
        if (probs[k][k] % 2 !== 0) {
          probs[k][k] += 1;
          outDegs[nodesInK[0]] += 1;
          PROBE("accum_parity_bump", { k, diag: probs[k][k] });
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
    const { edges, blocks, rng, maxRetries = 10, traceOps = false } = args;
    const validPool = {};
    const validSet = new Set();
    const invalidEdges = [];
    const ops = traceOps ? [] : null;
    // Oracle (audit A): under __ORACLE the per-step random.randrange(len(pool))
    // index and the A==B random.random()<0.5 coin are read from the canonical
    // tracer's recorded picks instead of drawing from rng, so the rewire
    // matches the canonical random.Random stream byte-for-byte (the JS
    // d3.randomLcg family is NOT bit-equal to python's MT19937). When no oracle
    // is installed (in-browser walker) the self-RNG path runs unchanged.
    const oracle = ORACLE();

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
    // initial_valid_set snapshot (graph_utils.py:66) for the canonical
    // (sbm_only, rewired) = (valid_set & initial, valid_set - initial) split.
    const initialValidSet = new Set(validSet);

    function processOneEdge(rawEdge) {
      const [u, v] = rawEdge;
      const k = bp(u, v);
      const pool = validPool[k];
      if (!pool || pool.length === 0) {
        invalidEdges.push([u, v]);
        return false;
      }
      const idx = oracle
        ? oracle.next("rewire_idx").idx
        : Math.floor(rng() * pool.length);
      PROBE("rewire_idx", { bp: k, idx, poolLen: pool.length });
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
        const coin = oracle ? oracle.next("rewire_coin").coin : (rng() < 0.5);
        PROBE("rewire_coin", { u, v, x, y, bp: k, coin });
        if (coin) {
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
        PROBE("rewire_swap", { p1: [u, v], p2: [x, y],
          newp1: new_e1.slice(), newp2: new_e2.slice(), bp: k, success: true });
        if (ops) ops.push({
          p1: [u, v], p2: [x, y],
          newp1: new_e1.slice(), newp2: new_e2.slice(),
          bp: k, success: true,
        });
      } else {
        invalidEdges.push([u, v]);
        PROBE("rewire_swap", { p1: [u, v], p2: [x, y],
          newp1: new_e1.slice(), newp2: new_e2.slice(), bp: k, success: false });
        if (ops) ops.push({
          p1: [u, v], p2: [x, y],
          newp1: new_e1.slice(), newp2: new_e2.slice(),
          bp: k, success: false,
        });
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
    // Canonical (graph_utils.py:123-124) partition: sbm_only = survivors that
    // were in the initial valid_set; rewired = swap-introduced edges. validSet
    // is the live final set (mutated in lockstep with the pools).
    const sbmOnly = [];
    const rewired = [];
    for (const key of validSet) {
      const [a, b] = key.split(",").map(Number);
      (initialValidSet.has(key) ? sbmOnly : rewired).push([a, b]);
    }
    const byEdge = (p, q) => (p[0] - q[0]) || (p[1] - q[1]);
    sbmOnly.sort(byEdge);
    rewired.sort(byEdge);
    return { kept, dropped: invalidEdges.slice(), ops: ops || [],
             sbmOnly, rewired };
  }

  // ── PSO branch (v3) ─────────────────────────────────────────
  // Faithful port of externals/ec-sbm/src/gen_pso_core.py: uniform-angular
  // PSO on a hyperbolic disk with `m` attachments per arrival. Used by v3's
  // stage-2 walker. Not byte-equal to canonical (different RNG; canonical
  // uses np.random.default_rng), but the construction logic — radial
  // schedule, hyperbolic distance, T==0 nearest-m branch, T>0 connection
  // probability + Efraimidis-Spirakis weighted sample — is identical.
  function hyperbolicDist(thetaI, rI, thetasJ, rsJ) {
    const out = new Array(thetasJ.length);
    const PI = Math.PI;
    for (let j = 0; j < thetasJ.length; j++) {
      const A = PI - Math.abs(PI - Math.abs(thetaI - thetasJ[j]));
      let arg = Math.cosh(rI) * Math.cosh(rsJ[j])
              - Math.sinh(rI) * Math.sinh(rsJ[j]) * Math.cos(A);
      if (arg < 1.0) arg = 1.0;
      out[j] = Math.acosh(arg);
    }
    return out;
  }

  // Efraimidis-Spirakis weighted sample without replacement: pick the k
  // indices with the smallest -log(U)/w keys. Falls back on uniform when
  // no positive weight; returns all positives when fewer than k exist.
  function efraimidisSample(weights, k, rng) {
    const n = weights.length;
    const pos = [];
    for (let i = 0; i < n; i++) if (weights[i] > 0) pos.push(i);
    if (pos.length === 0) {
      const idxs = [];
      const seen = new Set();
      while (idxs.length < Math.min(k, n)) {
        const r = Math.floor(rng() * n);
        if (!seen.has(r)) { seen.add(r); idxs.push(r); }
      }
      return idxs.sort((a, b) => a - b);
    }
    if (pos.length <= k) return pos.slice().sort((a, b) => a - b);
    const keys = new Array(n).fill(Infinity);
    for (const i of pos) {
      const u = rng();
      const ui = u <= 0 ? 1e-300 : u;
      keys[i] = -Math.log(ui) / weights[i];
    }
    const idxs = pos.slice().sort((a, b) => keys[a] - keys[b]).slice(0, k);
    return idxs.sort((a, b) => a - b);
  }

  function psoClusterEdges(N, m, T, gamma, rng) {
    if (N <= 1) return [];
    if (m < 1) throw new Error("m must be >= 1");
    if (gamma < 2) throw new Error("gamma must be >= 2");
    if (T < 0) throw new Error("T must be >= 0");
    m = Math.min(m, N - 1);

    const PI = Math.PI;
    const thetas = new Array(N);
    for (let i = 0; i < N; i++) thetas[i] = rng() * 2.0 * PI;
    const rs = new Array(N).fill(0);

    const beta = 1.0 / (gamma - 1.0);
    const edges = [];

    for (let t = 2; t <= N; t++) {
      for (let i = 1; i < t; i++) {
        rs[i - 1] = beta * (2.0 * Math.log(i)) + (1.0 - beta) * (2.0 * Math.log(t));
      }
      rs[t - 1] = 2.0 * Math.log(t);

      if (t - 1 <= m) {
        for (let v = 0; v < t - 1; v++) edges.push([v, t - 1]);
        continue;
      }

      const thetaT = thetas[t - 1], rT = rs[t - 1];
      const thetasJ = thetas.slice(0, t - 1);
      const rsJ = rs.slice(0, t - 1);
      const d = hyperbolicDist(thetaT, rT, thetasJ, rsJ);

      let partners;
      if (T === 0) {
        const idxs = d.map((_, i) => i).sort((a, b) => d[a] - d[b]).slice(0, m);
        partners = idxs.sort((a, b) => a - b);
      } else {
        const logT = Math.log(t);
        const sinTpi = Math.sin(T * PI);
        if (sinTpi === 0) {
          const idxs = d.map((_, i) => i).sort((a, b) => d[a] - d[b]).slice(0, m);
          partners = idxs.sort((a, b) => a - b);
        } else {
          let Rt;
          if (beta === 1.0) {
            Rt = 2.0 * logT - 2.0 * Math.log((2.0 * T * logT) / (sinTpi * m));
          } else {
            const inner = (2.0 * T * (1.0 - Math.exp(-(1.0 - beta) * logT)))
                        / (sinTpi * m * (1.0 - beta));
            Rt = 2.0 * logT - 2.0 * Math.log(inner);
          }
          const p = new Array(d.length);
          for (let i = 0; i < d.length; i++) {
            let z = (d[i] - Rt) / (2.0 * T);
            if (z > 700) z = 700;
            if (z < -700) z = -700;
            p[i] = 1.0 / (1.0 + Math.exp(z));
          }
          partners = efraimidisSample(p, m, rng);
        }
      }
      for (const v of partners) edges.push([v, t - 1]);
    }
    return edges;
  }

  function inducedGlobalCcoeff(N, edges) {
    if (N <= 2) return 0.0;
    const adj = [];
    for (let i = 0; i < N; i++) adj.push(new Set());
    for (const [u, v] of edges) {
      if (u === v) continue;
      adj[u].add(v); adj[v].add(u);
    }
    let triplets = 0;
    for (const s of adj) {
      const d = s.size;
      triplets += d * (d - 1) / 2;
    }
    if (triplets === 0) return 0.0;
    let triangles = 0;
    for (let u = 0; u < N; u++) {
      for (const v of adj[u]) {
        if (v <= u) continue;
        for (const w of adj[v]) {
          if (w > v && adj[u].has(w)) triangles += 1;
        }
      }
    }
    return 3.0 * triangles / triplets;
  }

  // Per-cluster bisection-and-secant T search. Mirrors src/npso/gen.py +
  // gen_clustered._search_T_secant: at each step, drive the simulated cc
  // toward target by shrinking the [t_min, t_max] bracket. Returns
  // { bestT, bestCc, bestEdges, iters } where iters is the [{T, cc, diff}]
  // record (one entry per evaluated T).
  function nextT(minT, maxT, fMinT, fMaxT) {
    const mid = minT + (maxT - minT) / 2.0;
    if (fMinT == null || fMaxT == null) return mid;
    if (fMinT * fMaxT > 0) return mid;
    const denom = fMaxT - fMinT;
    if (denom === 0) return mid;
    const Tsec = minT - fMinT * (maxT - minT) / denom;
    const margin = 0.05 * (maxT - minT);
    if (Tsec <= minT + margin || Tsec >= maxT - margin) return mid;
    return Tsec;
  }

  function searchTForCluster(args) {
    // n, m, gamma, target, rngFor(t,iter), maxIters, diffTol, stepTol,
    //   tMin, tMax, initialT
    const {
      n, m, gamma, target,
      maxIters = 30, diffTol = 0.01, stepTol = 1e-4,
      tMin = 0.01, tMax = 0.99, initialT = 0.5,
      rngFactory,
    } = args;
    if (n <= 1 || m < 1) {
      return { bestT: null, bestCc: 0, bestEdges: [], iters: [], m: 0 };
    }
    if (n <= m + 1) {
      const rng = rngFactory(initialT, 0);
      const edges = psoClusterEdges(n, m, initialT, gamma, rng);
      const cc = inducedGlobalCcoeff(n, edges);
      return {
        bestT: initialT, bestCc: cc, bestEdges: edges, m,
        iters: [{ T: initialT, ccoeff: cc, diff: Math.abs(cc - target),
                  note: "complete_graph" }],
      };
    }
    let fMin = null, fMax = null;
    let bestT = null, bestCc = null, bestDiff = null, bestEdges = null;
    let prevCc = null;
    let curMin = tMin, curMax = tMax;
    const iters = [];
    for (let it = 0; it < maxIters; it++) {
      const T = nextT(curMin, curMax, fMin, fMax);
      const rng = rngFactory(T, it);
      const edges = psoClusterEdges(n, m, T, gamma, rng);
      const cc = inducedGlobalCcoeff(n, edges);
      const diff = Math.abs(cc - target);
      iters.push({ T, ccoeff: cc, diff });
      if (bestCc === null || diff < bestDiff) {
        bestT = T; bestCc = cc; bestDiff = diff; bestEdges = edges;
      }
      if (bestDiff < diffTol) break;
      if (prevCc !== null && Math.abs(prevCc - cc) < stepTol) break;
      const fT = cc - target;
      if (fT < 0) { curMax = T; fMax = fT; }
      else        { curMin = T; fMin = fT; }
      prevCc = cc;
    }
    return { bestT, bestCc, bestEdges, iters, m };
  }

  window.ECSBMKernel = {
    normalizeEdge,
    edgeKey,
    sortByDegThenIid,
    weightedChoice,
    generateCluster,            // legacy (stale vs current canonical)
    generateInternalEdges,      // legacy
    generateClusterBands,       // CORRECTED current-canonical kec-core
    generateInternalEdgesBands, // CORRECTED
    prepareV2SBMInputs,
    rewireInvalidEdges,
    psoClusterEdges,
    inducedGlobalCcoeff,
    searchTForCluster,
  };
  // Expose the hook tag list for the coverage manifest / harness.
  window.__ECSBM_HOOKS = {
    tags: ["inflate", "apply", "weighted_choice", "uniform_choice",
           "accum_block", "accum_deficit", "accum_parity_bump",
           "rewire_idx", "rewire_swap", "rewire_coin"],
  };
})();
