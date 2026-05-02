// match_degree kernel: browser-loadable JS port of src/match_degree.py.
//
// Faithful to the canonical Python source's deterministic logic for all
// five algorithms (greedy, true_greedy, random_greedy, rewire, hybrid):
//   - greedy: static max-heap; pop u; drain via sorted(non-neighbors)[:avail_k]
//     in a single burst; lazy-delete on stale heap entries.
//   - true_greedy: dynamic max-heap with re-push; pop u, pick single
//     argmax-degree v with id-asc tiebreak, push back updated residuals.
//   - random_greedy: weighted-random u (proportional to residual),
//     weighted-random v (proportional to residual on valid set).
//   - rewire: build sorted-by-iid stub list, shuffle, pair adjacent;
//     2-opt repair with coin-flipped recombination per src/match_degree.py.
//   - hybrid: rewire (keep residual on failure) → true_greedy fallback
//     on the leftover invalid-pair stubs.
//
// Randomness uses a JS-native rng callable (e.g. d3.randomLcg). Byte-
// equality with canonical's `random` module is **not** the bar; the
// deterministic control flow + sort orders + tie-breaks are.
//
// Lifted control flow from tools/viz_check/match_degree/kernel_check.mjs
// (the *Replay variants), with trace consumption replaced by rng() calls
// + canonical step-trace emission for the matcher.html walker.
//
// Exposed as window.MatchDegreeKernel:
//   runGreedy       (payload, opts) -> steps[]
//   runTrueGreedy   (payload, opts) -> steps[]
//   runRandomGreedy (payload, opts) -> steps[]
//   runRewire       (payload, opts) -> steps[]
//   runHybrid       (payload, opts) -> steps[]
//
// Where:
//   payload = { iids, deficit, baseAdj }
//     iids:    array of node iids the algorithm runs over
//     deficit: { iid: residual_target } (the per-node missing-stub count)
//     baseAdj: { iid: Set<iid> } existing adjacency
//   opts = { rng?, keepResidual?, initialState? }
//     rng:          () -> [0,1); required for non-deterministic algos
//     keepResidual: rewire-only; if true leave residual > 0 on failure
//     initialState: { residual, unplaced, edges, exitOrder } to resume from
//
// Each step is:
//   { action, residual, unplaced, edges, exitOrder, msg, ...extras }
// where extras include u/v/x/y/phase as appropriate and snapshots are
// already cloned (caller can store them as committed[] without copying).
(function () {
  "use strict";

  function cloneResidual(r) { const c = {}; for (const k in r) c[k] = r[k]; return c; }
  function cloneAdj(adj) {
    const c = {};
    for (const k in adj) c[k] = new Set(adj[k]);
    return c;
  }
  function residualSum(r) { let s = 0; for (const k in r) s += r[k]; return s; }
  function nodesWithResidual(r) {
    const out = [];
    for (const k in r) if (r[k] > 0) out.push(parseInt(k, 10));
    return out;
  }
  function normEdge(u, v) { return u < v ? [u, v] : [v, u]; }
  function edgeKey(u, v) { return Math.min(u, v) + "-" + Math.max(u, v); }

  // Common state init from payload + optional initialState.
  function initState(payload, initialState) {
    const residual = cloneResidual(initialState ? initialState.residual : payload.deficit);
    const unplaced = initialState ? Object.assign({}, initialState.unplaced)
                                  : (() => { const u = {}; payload.iids.forEach(n => { u[n] = 0; }); return u; })();
    const adj = cloneAdj(payload.baseAdj);
    const edges = initialState ? initialState.edges.slice() : [];
    edges.forEach(([u, v]) => { adj[u].add(v); adj[v].add(u); });
    const exitOrder = initialState ? (initialState.exitOrder || []).slice() : [];
    return { residual, unplaced, adj, edges, exitOrder };
  }

  function snapshot(action, fields, residual, unplaced, edges, exitOrder, msg) {
    return Object.assign({
      action,
      residual: cloneResidual(residual),
      unplaced: Object.assign({}, unplaced),
      edges: edges.slice(),
      exitOrder: exitOrder.slice(),
      msg,
    }, fields || {});
  }

  function maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState) {
    if (initialState) return;
    steps.push(snapshot("init", null, residual, unplaced, edges, exitOrder,
      `initial deficit: ${nodesWithResidual(residual).map(n => `${n}:${residual[n]}`).join(", ")}.`));
  }

  // ── greedy ─────────────────────────────────────────────────
  // Mirrors src/match_degree.py:match_missing_degrees_greedy.
  // Static heap, no re-push; pop u, drain via sorted(non-neighbors)[:avail_k]
  // in one burst. Deterministic; no rng. Lost stubs on avail_k < residual[u]
  // are silently dropped (no log) — that's the canonical "silent gridlock".
  // Step trace: one step per edge in the burst, then a gridlock_silent step
  // when residual[u] > 0 after the burst (counts dropped stubs).
  function runGreedy(payload, opts) {
    opts = opts || {};
    const initialState = opts.initialState;
    const initialDeficit = payload.deficit;
    const { residual, unplaced, adj, edges, exitOrder } = initState(payload, initialState);
    const steps = [];
    maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState);

    // available_node_set + available_node_degrees, keyed by iid.
    const availSet = new Set();
    const availDeg = {};
    for (const k in residual) {
      const u = parseInt(k, 10);
      if (residual[u] > 0) { availSet.add(u); availDeg[u] = residual[u]; }
    }
    // Initial heap (negDeg, n); no re-push.
    const heap = [];
    for (const n of availSet) heap.push([-availDeg[n], n]);
    heap.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

    function recordExit(n) { if (!exitOrder.includes(n)) exitOrder.push(n); }

    while (heap.length > 0) {
      const popped = heap.shift();
      const u = popped[1];
      if (!availSet.has(u)) continue; // lazy delete
      // sorted(non_neighbors) cap at avail_k.
      const invalid = new Set(adj[u]); invalid.add(u);
      const nonNeighbors = [];
      for (const n of availSet) if (!invalid.has(n)) nonNeighbors.push(n);
      nonNeighbors.sort((a, b) => a - b);
      const availK = Math.min(availDeg[u], nonNeighbors.length);
      for (let k = 0; k < availK; k++) {
        const v = nonNeighbors[k];
        adj[u].add(v); adj[v].add(u);
        edges.push([u, v]);
        residual[u] -= 1; residual[v] -= 1;
        availDeg[v] -= 1;
        if (availDeg[v] === 0) { availSet.delete(v); delete availDeg[v]; }
        if (residual[u] === 0) recordExit(u);
        if (residual[v] === 0 && (initialDeficit[v] || 0) > 0) recordExit(v);
        steps.push(snapshot("add", { u, v },
          residual, unplaced, edges, exitOrder,
          `pop u=${u} (drain burst, k=${availK}). step ${k + 1}/${availK}: sorted non-neighbors → v=${v}; added (${u}, ${v}).`));
      }
      // Silent gridlock if u has residual leftover (avail_k < residual[u]).
      if (residual[u] > 0) {
        const lost = residual[u];
        unplaced[u] = (unplaced[u] || 0) + lost;
        residual[u] = 0;
        recordExit(u);
        steps.push(snapshot("gridlock_silent", { u },
          residual, unplaced, edges, exitOrder,
          `u=${u}: ${lost} stub(s) silently dropped after the burst (avail_k < residual). canonical greedy logs nothing.`));
      }
      availSet.delete(u);
      delete availDeg[u];
    }

    steps.push(snapshot("done", null, residual, unplaced, edges, exitOrder,
      `done. ${edges.length} edge(s) placed; ${residualSum(unplaced)} stub(s) abandoned (silent in greedy).`));
    return steps;
  }

  // ── true_greedy ───────────────────────────────────────────
  // Mirrors src/match_degree.py:match_missing_degrees_true_greedy. Dynamic
  // heap with re-push after every edge; lazy-delete on stale tuples; v
  // chosen via argmax(current_degrees[x], -x) — degree desc, id asc.
  function runTrueGreedy(payload, opts) {
    opts = opts || {};
    const initialState = opts.initialState;
    const initialDeficit = payload.deficit;
    const { residual, unplaced, adj, edges, exitOrder } = initState(payload, initialState);
    const steps = [];
    maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState);

    const currentDeg = {}; // iid → live residual (canonical's current_degrees)
    for (const k in residual) {
      const u = parseInt(k, 10);
      if (residual[u] > 0) currentDeg[u] = residual[u];
    }
    const heap = [];
    for (const n in currentDeg) heap.push([-currentDeg[n], parseInt(n, 10)]);
    heap.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

    function heapPush(item) {
      heap.push(item);
      heap.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    }
    function recordExit(n) { if (!exitOrder.includes(n)) exitOrder.push(n); }

    while (heap.length > 0) {
      const [negDeg, u] = heap.shift();
      const degU = -negDeg;
      if (currentDeg[u] === undefined || currentDeg[u] !== degU) continue;
      const invalid = adj[u];
      const validTargets = [];
      for (const k in currentDeg) {
        const n = parseInt(k, 10);
        if (n === u) continue;
        if (invalid.has(n)) continue;
        validTargets.push(n);
      }
      if (validTargets.length === 0) {
        const lost = residual[u];
        unplaced[u] = (unplaced[u] || 0) + lost;
        residual[u] = 0;
        delete currentDeg[u];
        recordExit(u);
        steps.push(snapshot("gridlock_logged", { u },
          residual, unplaced, edges, exitOrder,
          `u=${u} starved: ${lost} stub(s) unplaced. WARN logged.`));
        continue;
      }
      // v = max(valid_targets, key=lambda x: (current_degrees[x], -x))
      let v = null, vDeg = -1;
      for (const n of validTargets) {
        const d = currentDeg[n];
        if (d > vDeg || (d === vDeg && (v === null || n < v))) { v = n; vDeg = d; }
      }
      adj[u].add(v); adj[v].add(u);
      edges.push([u, v]);
      residual[u] -= 1; residual[v] -= 1;
      currentDeg[u] -= 1; currentDeg[v] -= 1;
      if (residual[u] === 0) recordExit(u);
      if (residual[v] === 0 && (initialDeficit[v] || 0) > 0) recordExit(v);
      if (currentDeg[u] > 0) heapPush([-currentDeg[u], u]);
      else delete currentDeg[u];
      if (currentDeg[v] > 0) heapPush([-currentDeg[v], v]);
      else if (currentDeg[v] !== undefined) delete currentDeg[v];
      steps.push(snapshot("add", { u, v },
        residual, unplaced, edges, exitOrder,
        `pop u=${u}; argmax over current_degrees picks v=${v} (deg ${vDeg}); added (${u}, ${v}).`));
    }
    steps.push(snapshot("done", null, residual, unplaced, edges, exitOrder,
      `done. ${edges.length} edge(s) placed; ${residualSum(unplaced)} stub(s) logged as gridlocked.`));
    return steps;
  }

  // ── random_greedy ─────────────────────────────────────────
  // Mirrors src/match_degree.py:match_missing_degrees_random_greedy.
  // Weighted-random u (proportional to residual). Weighted-random v
  // (proportional to residual on valid set). No degree-based bias; relies
  // entirely on residual mass. Same control flow as the page algo, just
  // canonical-faithful in that it uses random.choices semantics (weighted
  // bisect) — JS rng + cumulative weights mirror that.
  function runRandomGreedy(payload, opts) {
    opts = opts || {};
    if (!opts.rng) throw new Error("runRandomGreedy: opts.rng required");
    const rng = opts.rng;
    const initialState = opts.initialState;
    const initialDeficit = payload.deficit;
    const { residual, unplaced, adj, edges, exitOrder } = initState(payload, initialState);
    const steps = [];
    maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState);

    function weightedPick(items, weights) {
      let total = 0;
      for (const w of weights) total += w;
      if (total <= 0) return -1;
      let r = rng() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return items.length - 1;
    }
    function recordExit(n) { if (!exitOrder.includes(n)) exitOrder.push(n); }

    // available_degrees + available_nodes (canonical: insertion-order list).
    const availDeg = {};
    const availNodes = [];
    const sortedKeys = Object.keys(residual)
      .map(k => parseInt(k, 10))
      .filter(k => residual[k] > 0)
      .sort((a, b) => a - b);
    for (const k of sortedKeys) { availDeg[k] = residual[k]; availNodes.push(k); }

    let safety = 5000;
    while (availNodes.length > 0 && safety-- > 0) {
      const weights = availNodes.map(n => availDeg[n]);
      const uIdx = weightedPick(availNodes, weights);
      if (uIdx < 0) break;
      const u = availNodes[uIdx];
      const invalid = adj[u];
      const validTargets = [];
      for (const n of availNodes) {
        if (n === u) continue;
        if (invalid.has(n)) continue;
        validTargets.push(n);
      }
      if (validTargets.length === 0) {
        const lost = residual[u];
        unplaced[u] = (unplaced[u] || 0) + lost;
        residual[u] = 0;
        const i = availNodes.indexOf(u);
        if (i >= 0) availNodes.splice(i, 1);
        delete availDeg[u];
        recordExit(u);
        steps.push(snapshot("gridlock_logged", { u },
          residual, unplaced, edges, exitOrder,
          `u=${u} starved: ${lost} stub(s) abandoned. WARN logged.`));
        continue;
      }
      const vWeights = validTargets.map(n => availDeg[n]);
      const vIdx = weightedPick(validTargets, vWeights);
      const v = validTargets[vIdx];
      adj[u].add(v); adj[v].add(u);
      edges.push([u, v]);
      residual[u] -= 1; residual[v] -= 1;
      availDeg[u] -= 1; availDeg[v] -= 1;
      if (availDeg[u] === 0) {
        const i = availNodes.indexOf(u); if (i >= 0) availNodes.splice(i, 1);
        delete availDeg[u];
      }
      if (availDeg[v] === 0) {
        const i = availNodes.indexOf(v); if (i >= 0) availNodes.splice(i, 1);
        delete availDeg[v];
      }
      if (residual[u] === 0) recordExit(u);
      if (residual[v] === 0 && (initialDeficit[v] || 0) > 0) recordExit(v);
      steps.push(snapshot("add", { u, v },
        residual, unplaced, edges, exitOrder,
        `weighted-random u=${u} (residual ${residual[u] + 1}); weighted-random v=${v} from ${validTargets.length} valid; added (${u}, ${v}).`));
    }
    steps.push(snapshot("done", null, residual, unplaced, edges, exitOrder,
      `done. ${edges.length} edge(s) placed; ${residualSum(unplaced)} stub(s) logged as gridlocked.`));
    return steps;
  }

  // ── rewire ────────────────────────────────────────────────
  // Mirrors src/match_degree.py:match_missing_degrees_rewire +
  // graph_utils.run_rewire_attempts. Stubs sorted by iid; Fisher-Yates
  // shuffle; pair adjacent. Invalid pairs (self-loop, parallel, pre-
  // existing) queued for repair. Repair: 2-opt swap with coin-flipped
  // recombination — picks a random valid edge (idx) and either
  //   (e1[0], e2[0]) + (e1[1], e2[1])   if rng() < 0.5
  // or
  //   (e1[0], e2[1]) + (e1[1], e2[0])   otherwise.
  // Both new edges must be valid; otherwise requeue. Up to 10 attempts.
  // keepResidual=true (hybrid): leave residual + invalid for phase 2.
  function _runRewireCore(payload, opts, residual, unplaced, adj, edges, exitOrder, steps, initialDeficit) {
    const rng = opts.rng;
    function recordExit(n) { if (!exitOrder.includes(n)) exitOrder.push(n); }
    function isValid(e, validEdges) {
      const [a, b] = e;
      if (a === b) return false;
      if (validEdges.has(edgeKey(a, b))) return false;
      if (adj[a] && adj[a].has(b)) return false;
      return true;
    }
    // Stubs in canonical sorted-iid order.
    const sortedIids = Object.keys(residual)
      .map(k => parseInt(k, 10))
      .sort((a, b) => a - b);
    const stubs = [];
    for (const u of sortedIids) {
      for (let i = 0; i < residual[u]; i++) stubs.push(u);
    }
    if (stubs.length % 2 !== 0) stubs.pop();
    // Fisher-Yates (Python random.shuffle: i in [n-1..1], j = randrange(i+1)).
    for (let i = stubs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [stubs[i], stubs[j]] = [stubs[j], stubs[i]];
    }
    steps.push(snapshot("shuffle", null, residual, unplaced, edges, exitOrder,
      `phase 1: built ${stubs.length} stubs and shuffled. order: [${stubs.join(", ")}].`));

    // Initial pairing.
    const validEdges = new Set();
    const invalidEdges = [];
    for (let i = 0; i + 1 < stubs.length; i += 2) {
      const u = stubs[i], v = stubs[i + 1];
      const e = normEdge(u, v);
      const key = edgeKey(u, v);
      if (u === v || validEdges.has(key) || (adj[u] && adj[u].has(v))) {
        invalidEdges.push(e);
        steps.push(snapshot("pair_invalid", { u, v }, residual, unplaced, edges, exitOrder,
          `phase 1 pair (${u}, ${v}): ${u === v ? "self-loop" : (validEdges.has(key) ? "duplicate this pass" : "already adjacent")}; queued for repair.`));
      } else {
        validEdges.add(key);
        adj[u].add(v); adj[v].add(u);
        edges.push(e);
        residual[u] -= 1; residual[v] -= 1;
        if (residual[u] === 0 && (initialDeficit[u] || 0) > 0) recordExit(u);
        if (residual[v] === 0 && (initialDeficit[v] || 0) > 0) recordExit(v);
        steps.push(snapshot("add", { u, v }, residual, unplaced, edges, exitOrder,
          `phase 1 pair (${u}, ${v}): valid; added.`));
      }
    }
    // valid_pool = sorted(valid_edges).
    const validPool = [];
    for (const k of Array.from(validEdges).sort((a, b) => {
      const [a1, a2] = a.split("-").map(Number);
      const [b1, b2] = b.split("-").map(Number);
      return (a1 - b1) || (a2 - b2);
    })) {
      const [u, v] = k.split("-").map(Number);
      validPool.push([u, v]);
    }
    // run_rewire_attempts: max_retries=10 outer loop with progress check.
    const MAX = 10;
    let attempt = 0;
    for (; attempt < MAX && invalidEdges.length > 0; attempt++) {
      let lastRecycle = invalidEdges.length;
      let recycle = lastRecycle;
      while (invalidEdges.length > 0) {
        recycle--;
        if (recycle < 0) {
          if (invalidEdges.length < lastRecycle) {
            lastRecycle = invalidEdges.length;
            recycle = lastRecycle;
          } else {
            break;
          }
        }
        const e1 = invalidEdges.shift();
        if (validPool.length === 0) {
          invalidEdges.push(e1);
          steps.push(snapshot("repair_skip", { u: e1[0], v: e1[1] }, residual, unplaced, edges, exitOrder,
            `attempt ${attempt + 1}: invalid (${e1[0]}, ${e1[1]}); valid pool empty, abort.`));
          break;
        }
        const idx = Math.floor(rng() * validPool.length);
        const e2 = validPool[idx];
        const coin = rng();
        let newE1, newE2;
        if (coin < 0.5) {
          newE1 = normEdge(e1[0], e2[0]);
          newE2 = normEdge(e1[1], e2[1]);
        } else {
          newE1 = normEdge(e1[0], e2[1]);
          newE2 = normEdge(e1[1], e2[0]);
        }
        const k1 = edgeKey(newE1[0], newE1[1]);
        const k2 = edgeKey(newE2[0], newE2[1]);
        if (isValid(newE1, validEdges) && isValid(newE2, validEdges) && k1 !== k2) {
          // Drop e2 from valid bookkeeping + adjacency + edges.
          validEdges.delete(edgeKey(e2[0], e2[1]));
          adj[e2[0]].delete(e2[1]); adj[e2[1]].delete(e2[0]);
          // edges list: find and remove e2
          const eIdx = edges.findIndex(([a, b]) => (a === e2[0] && b === e2[1]) || (a === e2[1] && b === e2[0]));
          if (eIdx >= 0) edges.splice(eIdx, 1);
          // valid_pool[idx] = valid_pool[-1]; valid_pool.pop()
          validPool[idx] = validPool[validPool.length - 1];
          validPool.pop();
          // Add new edges.
          validEdges.add(k1); validEdges.add(k2);
          adj[newE1[0]].add(newE1[1]); adj[newE1[1]].add(newE1[0]);
          adj[newE2[0]].add(newE2[1]); adj[newE2[1]].add(newE2[0]);
          edges.push(newE1); edges.push(newE2);
          validPool.push(newE1); validPool.push(newE2);
          // residuals: e1 was invalid (not yet placed), so e1's stubs become placed.
          residual[e1[0]] -= 1; residual[e1[1]] -= 1;
          if (residual[e1[0]] === 0 && (initialDeficit[e1[0]] || 0) > 0) recordExit(e1[0]);
          if (residual[e1[1]] === 0 && (initialDeficit[e1[1]] || 0) > 0) recordExit(e1[1]);
          steps.push(snapshot("repair_swap",
            { u: e1[0], v: e1[1], x: e2[0], y: e2[1] },
            residual, unplaced, edges, exitOrder,
            `attempt ${attempt + 1}: 2-opt swap. invalid (${e1[0]}, ${e1[1]}) + valid (${e2[0]}, ${e2[1]}) → (${newE1[0]}, ${newE1[1]}) + (${newE2[0]}, ${newE2[1]}); coin=${coin < 0.5 ? "lo" : "hi"}.`));
        } else {
          invalidEdges.push(e1);
          steps.push(snapshot("repair_fail",
            { u: e1[0], v: e1[1], x: e2[0], y: e2[1] },
            residual, unplaced, edges, exitOrder,
            `attempt ${attempt + 1}: tried (${e2[0]}, ${e2[1]}); swap blocked; requeue (${e1[0]}, ${e1[1]}).`));
        }
      }
    }
    return { invalidEdges, validEdges };
  }

  function runRewire(payload, opts) {
    opts = opts || {};
    if (!opts.rng) throw new Error("runRewire: opts.rng required");
    const keepResidual = !!opts.keepResidual;
    const initialState = opts.initialState;
    const initialDeficit = payload.deficit;
    const { residual, unplaced, adj, edges, exitOrder } = initState(payload, initialState);
    const steps = [];
    maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState);
    const { invalidEdges } = _runRewireCore(payload, opts, residual, unplaced, adj, edges, exitOrder, steps, initialDeficit);
    if (invalidEdges.length > 0 && !keepResidual) {
      // Standalone: convert leftover into unplaced + record exit.
      const lostMap = {};
      for (const k in residual) {
        const u = parseInt(k, 10);
        if (residual[u] > 0) {
          lostMap[u] = residual[u];
          unplaced[u] = (unplaced[u] || 0) + residual[u];
          residual[u] = 0;
          if (!exitOrder.includes(u)) exitOrder.push(u);
        }
      }
      steps.push(snapshot("gridlock_logged", null, residual, unplaced, edges, exitOrder,
        `${invalidEdges.length} pair(s) unresolved after 10 attempts. WARN: ${Object.entries(lostMap).map(([k, v]) => `${k}:${v}`).join(", ")}.`));
    }
    steps.push(snapshot("done", null, residual, unplaced, edges, exitOrder,
      `done. ${edges.length} edge(s) placed; ${residualSum(residual) + residualSum(unplaced)} stub(s) ${keepResidual ? "left for phase 2" : "abandoned"}.`));
    return steps;
  }

  // ── hybrid ────────────────────────────────────────────────
  // rewire (keepResidual=true) → true_greedy on whatever residual remains.
  // Mirrors src/match_degree.py:match_missing_degrees_hybrid.
  function runHybrid(payload, opts) {
    opts = opts || {};
    if (!opts.rng) throw new Error("runHybrid: opts.rng required");
    const phase1 = runRewire(payload, Object.assign({}, opts, { keepResidual: true }));
    while (phase1.length && phase1[phase1.length - 1].action === "done") phase1.pop();
    phase1.forEach(s => { s.phase = 1; });
    const last = phase1[phase1.length - 1];
    const phase1State = last
      ? { residual: last.residual, unplaced: last.unplaced, edges: last.edges, exitOrder: last.exitOrder }
      : { residual: payload.deficit, unplaced: {}, edges: [], exitOrder: [] };
    let phase2;
    if (residualSum(phase1State.residual) === 0) {
      phase2 = [snapshot("phase2_skip", { phase: 2 },
        phase1State.residual, phase1State.unplaced, phase1State.edges, phase1State.exitOrder,
        "phase 1 (rewire) drained the deficit completely. phase 2 (true_greedy) skipped.")];
    } else {
      const handoff = snapshot("phase2_start", { phase: 2 },
        phase1State.residual, phase1State.unplaced, phase1State.edges, phase1State.exitOrder,
        `phase 1 (rewire) left ${residualSum(phase1State.residual)} stub(s) unplaced. handing off to true_greedy.`);
      const tg = runTrueGreedy(payload, { initialState: phase1State });
      tg.forEach(s => { s.phase = 2; });
      phase2 = [handoff].concat(tg);
    }
    return phase1.concat(phase2);
  }

  // ── cluster-preserving helpers ─────────────────────────────
  // bp = (min_block, max_block) over node iids. bpBudget is keyed
  // "min-max" -> remaining edges allowed in that block-pair. The CP
  // variants mirror src/match_degree.py:cluster_preserving_* by
  // filtering candidate partners on a positive remaining budget and
  // decrementing on accept.
  function bpKey(b, u, v) {
    const a = b[u], c = b[v];
    return Math.min(a, c) + "-" + Math.max(a, c);
  }
  function bpAvail(bpBudget, key) {
    return (bpBudget[key] || 0) > 0;
  }
  function cloneBudget(bp) {
    const out = {};
    for (const k in bp) out[k] = bp[k];
    return out;
  }

  // ── cluster_preserving_greedy ──────────────────────────────
  // Mirrors src/match_degree.py:match_missing_degrees_cluster_preserving_greedy.
  // Same heap-and-set scaffolding as runGreedy; partners filtered by
  // bpBudget>0; on accept decrement bpBudget for that bp.
  function runClusterPreservingGreedy(payload, opts) {
    opts = opts || {};
    const initialState = opts.initialState;
    const initialDeficit = payload.deficit;
    if (!payload.b || !payload.bpBudget) {
      throw new Error("runClusterPreservingGreedy: payload.b and payload.bpBudget required");
    }
    const b = payload.b;
    const bpBudget = cloneBudget(payload.bpBudget);
    const { residual, unplaced, adj, edges, exitOrder } = initState(payload, initialState);
    const steps = [];
    maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState);

    const availSet = new Set();
    const availDeg = {};
    for (const k in residual) {
      const u = parseInt(k, 10);
      if (residual[u] > 0) { availSet.add(u); availDeg[u] = residual[u]; }
    }
    const heap = [];
    for (const n of availSet) heap.push([-availDeg[n], n]);
    heap.sort((a, bb) => (a[0] - bb[0]) || (a[1] - bb[1]));

    function recordExit(n) { if (!exitOrder.includes(n)) exitOrder.push(n); }

    while (heap.length > 0) {
      const popped = heap.shift();
      const u = popped[1];
      if (!availSet.has(u)) continue;
      const invalid = new Set(adj[u]); invalid.add(u);
      let candidates = [];
      for (const n of availSet) if (!invalid.has(n)) candidates.push(n);
      candidates.sort((a, bb) => a - bb);
      candidates = candidates.filter(n => bpAvail(bpBudget, bpKey(b, u, n)));
      const availK = Math.min(availDeg[u], candidates.length);
      for (let k = 0; k < availK; k++) {
        const v = candidates[k];
        const key = bpKey(b, u, v);
        if (!bpAvail(bpBudget, key)) continue;
        adj[u].add(v); adj[v].add(u);
        edges.push([u, v]);
        residual[u] -= 1; residual[v] -= 1;
        bpBudget[key] -= 1;
        availDeg[v] -= 1;
        if (availDeg[v] === 0) { availSet.delete(v); delete availDeg[v]; }
        if (residual[u] === 0) recordExit(u);
        if (residual[v] === 0 && (initialDeficit[v] || 0) > 0) recordExit(v);
        steps.push(snapshot("add", { u, v, bp: key, bpRemaining: bpBudget[key] },
          residual, unplaced, edges, exitOrder,
          `pop u=${u} (cp burst, k=${availK}). step ${k + 1}/${availK}: bp ${key} → v=${v}; remaining ${bpBudget[key]}.`));
      }
      if (residual[u] > 0) {
        const lost = residual[u];
        unplaced[u] = (unplaced[u] || 0) + lost;
        residual[u] = 0;
        recordExit(u);
        steps.push(snapshot("gridlock_silent", { u },
          residual, unplaced, edges, exitOrder,
          `u=${u}: ${lost} stub(s) silently dropped (cp burst found no in-budget partner).`));
      }
      availSet.delete(u);
      delete availDeg[u];
    }
    steps.push(snapshot("done", null, residual, unplaced, edges, exitOrder,
      `done. ${edges.length} edge(s) placed; ${residualSum(unplaced)} stub(s) abandoned.`));
    return steps;
  }

  // ── cluster_preserving_true_greedy ─────────────────────────
  // Mirrors src/match_degree.py:match_missing_degrees_cluster_preserving_true_greedy.
  function runClusterPreservingTrueGreedy(payload, opts) {
    opts = opts || {};
    const initialState = opts.initialState;
    const initialDeficit = payload.deficit;
    if (!payload.b || !payload.bpBudget) {
      throw new Error("runClusterPreservingTrueGreedy: payload.b and payload.bpBudget required");
    }
    const b = payload.b;
    const bpBudget = cloneBudget(payload.bpBudget);
    const { residual, unplaced, adj, edges, exitOrder } = initState(payload, initialState);
    const steps = [];
    maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState);

    const currentDeg = {};
    for (const k in residual) {
      const u = parseInt(k, 10);
      if (residual[u] > 0) currentDeg[u] = residual[u];
    }
    const heap = [];
    for (const n in currentDeg) heap.push([-currentDeg[n], parseInt(n, 10)]);
    heap.sort((a, bb) => (a[0] - bb[0]) || (a[1] - bb[1]));
    function heapPush(item) { heap.push(item); heap.sort((a, bb) => (a[0] - bb[0]) || (a[1] - bb[1])); }
    function recordExit(n) { if (!exitOrder.includes(n)) exitOrder.push(n); }

    while (heap.length > 0) {
      const [negDeg, u] = heap.shift();
      const degU = -negDeg;
      if (currentDeg[u] === undefined || currentDeg[u] !== degU) continue;
      const invalid = adj[u];
      const validTargets = [];
      for (const k in currentDeg) {
        const n = parseInt(k, 10);
        if (n === u) continue;
        if (invalid.has(n)) continue;
        if (!bpAvail(bpBudget, bpKey(b, u, n))) continue;
        validTargets.push(n);
      }
      if (validTargets.length === 0) {
        const lost = residual[u];
        unplaced[u] = (unplaced[u] || 0) + lost;
        residual[u] = 0;
        delete currentDeg[u];
        recordExit(u);
        steps.push(snapshot("gridlock_logged", { u },
          residual, unplaced, edges, exitOrder,
          `u=${u} starved: no in-budget partner; ${lost} stub(s) unplaced.`));
        continue;
      }
      let v = null, vDeg = -1;
      for (const n of validTargets) {
        const d = currentDeg[n];
        if (d > vDeg || (d === vDeg && (v === null || n < v))) { v = n; vDeg = d; }
      }
      const key = bpKey(b, u, v);
      adj[u].add(v); adj[v].add(u);
      edges.push([u, v]);
      residual[u] -= 1; residual[v] -= 1;
      currentDeg[u] -= 1; currentDeg[v] -= 1;
      bpBudget[key] -= 1;
      if (residual[u] === 0) recordExit(u);
      if (residual[v] === 0 && (initialDeficit[v] || 0) > 0) recordExit(v);
      if (currentDeg[u] > 0) heapPush([-currentDeg[u], u]); else delete currentDeg[u];
      if (currentDeg[v] > 0) heapPush([-currentDeg[v], v]);
      else if (currentDeg[v] !== undefined) delete currentDeg[v];
      steps.push(snapshot("add", { u, v, bp: key, bpRemaining: bpBudget[key] },
        residual, unplaced, edges, exitOrder,
        `pop u=${u}; argmax with bp filter picks v=${v} (deg ${vDeg}, bp ${key}); remaining ${bpBudget[key]}.`));
    }
    steps.push(snapshot("done", null, residual, unplaced, edges, exitOrder,
      `done. ${edges.length} edge(s) placed; ${residualSum(unplaced)} stub(s) gridlocked.`));
    return steps;
  }

  // ── cluster_preserving_random_greedy ───────────────────────
  // Mirrors src/match_degree.py:match_missing_degrees_cluster_preserving_random_greedy.
  function runClusterPreservingRandomGreedy(payload, opts) {
    opts = opts || {};
    if (!opts.rng) throw new Error("runClusterPreservingRandomGreedy: opts.rng required");
    const rng = opts.rng;
    const initialState = opts.initialState;
    const initialDeficit = payload.deficit;
    if (!payload.b || !payload.bpBudget) {
      throw new Error("runClusterPreservingRandomGreedy: payload.b and payload.bpBudget required");
    }
    const b = payload.b;
    const bpBudget = cloneBudget(payload.bpBudget);
    const { residual, unplaced, adj, edges, exitOrder } = initState(payload, initialState);
    const steps = [];
    maybeInitStep(steps, residual, unplaced, edges, exitOrder, initialState);

    function weightedPick(items, weights) {
      let total = 0;
      for (const w of weights) total += w;
      if (total <= 0) return -1;
      let r = rng() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return items.length - 1;
    }
    function recordExit(n) { if (!exitOrder.includes(n)) exitOrder.push(n); }

    const availDeg = {};
    const availNodes = [];
    const sortedKeys = Object.keys(residual)
      .map(k => parseInt(k, 10))
      .filter(k => residual[k] > 0)
      .sort((a, bb) => a - bb);
    for (const k of sortedKeys) { availDeg[k] = residual[k]; availNodes.push(k); }

    let safety = 5000;
    while (availNodes.length > 0 && safety-- > 0) {
      const weights = availNodes.map(n => availDeg[n]);
      const uIdx = weightedPick(availNodes, weights);
      if (uIdx < 0) break;
      const u = availNodes[uIdx];
      const invalid = adj[u];
      const validTargets = [];
      for (const n of availNodes) {
        if (n === u) continue;
        if (invalid.has(n)) continue;
        if (!bpAvail(bpBudget, bpKey(b, u, n))) continue;
        validTargets.push(n);
      }
      if (validTargets.length === 0) {
        const lost = residual[u];
        unplaced[u] = (unplaced[u] || 0) + lost;
        residual[u] = 0;
        const i = availNodes.indexOf(u);
        if (i >= 0) availNodes.splice(i, 1);
        delete availDeg[u];
        recordExit(u);
        steps.push(snapshot("gridlock_logged", { u },
          residual, unplaced, edges, exitOrder,
          `u=${u} starved (no in-budget partner): ${lost} stub(s).`));
        continue;
      }
      const vWeights = validTargets.map(n => availDeg[n]);
      const vIdx = weightedPick(validTargets, vWeights);
      const v = validTargets[vIdx];
      const key = bpKey(b, u, v);
      adj[u].add(v); adj[v].add(u);
      edges.push([u, v]);
      residual[u] -= 1; residual[v] -= 1;
      availDeg[u] -= 1; availDeg[v] -= 1;
      bpBudget[key] -= 1;
      if (availDeg[u] === 0) { const i = availNodes.indexOf(u); if (i >= 0) availNodes.splice(i, 1); delete availDeg[u]; }
      if (availDeg[v] === 0) { const i = availNodes.indexOf(v); if (i >= 0) availNodes.splice(i, 1); delete availDeg[v]; }
      if (residual[u] === 0) recordExit(u);
      if (residual[v] === 0 && (initialDeficit[v] || 0) > 0) recordExit(v);
      steps.push(snapshot("add", { u, v, bp: key, bpRemaining: bpBudget[key] },
        residual, unplaced, edges, exitOrder,
        `weighted u=${u}; weighted v=${v} from ${validTargets.length} in-budget; bp ${key} remaining ${bpBudget[key]}.`));
    }
    steps.push(snapshot("done", null, residual, unplaced, edges, exitOrder,
      `done. ${edges.length} edge(s) placed; ${residualSum(unplaced)} stub(s) gridlocked.`));
    return steps;
  }

  window.MatchDegreeKernel = {
    cloneResidual,
    cloneAdj,
    residualSum,
    nodesWithResidual,
    runGreedy,
    runTrueGreedy,
    runRandomGreedy,
    runRewire,
    runHybrid,
    runClusterPreservingGreedy,
    runClusterPreservingTrueGreedy,
    runClusterPreservingRandomGreedy,
  };
})();
