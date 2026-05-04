/* Infomap kernel: port of Rosvall + Bergstrom 2008 ("Maps of random
 * walks on complex networks reveal community structure", PNAS 105(4)).
 *
 * Faithful to the paper's algorithm, undirected unweighted variant
 * (the comdet 32-node fixture is undirected). Skips: smart-teleportation
 * teleportation parameter (τ = 0 for an undirected connected graph; the
 * stationary distribution reduces to p_α = d_α / (2m)) and weighted
 * edges (the fixture is binary).
 *
 * Pipeline:
 *   1. Stationary distribution p_α = d_α / (2m).
 *   2. Singleton init: every node a module; initial L(M) = H(P).
 *   3. Greedy pair-joining: iteratively merge the (i, j) pair giving
 *      the largest L decrease; loop until no merge improves.
 *   4. Tuning: single-node move pass; for each node, try moving to
 *      each neighbour-module, accept first move with ΔL < 0; loop
 *      until a sweep performs no moves. Greedy variant of the paper's
 *      heat-bath simulated-annealing refinement (paper §"Mapping
 *      Flow"; SI for the SA recipe). The ARI gap between greedy
 *      tuning and SA-tuning is small on small fixtures + the SA
 *      schedule has its own tuning knobs (T0, cooling rate); we ship
 *      greedy here and flag the divergence in docs.
 *   5. Sub-level recursion: for every module produced above, treat
 *      its induced subgraph as a fresh problem and recurse. Hierarchy
 *      stored as nested .submodules[].
 *
 * Map equation (paper Eq. 1):
 *   L(M) = q⤸ · H(Q) + Σᵢ p⊙ⁱ · H(Pⁱ)
 * where:
 *   q⤸    = total inter-module switching probability
 *   q_i⤸  = per-module exit probability
 *   π_i   = visit fraction of module i (Σ_{α∈i} p_α)
 *   p⊙ⁱ   = π_i + q_i⤸ (paper SI: total within-module-codeword frequency)
 *   H(Q)  = entropy of {q_i⤸ / q⤸}
 *   H(Pⁱ) = entropy of {p_α/p⊙ⁱ : α∈i} ∪ {q_i⤸ / p⊙ⁱ}
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.LOUVAIN) {
    console.warn("[infomap] COMDET.LOUVAIN missing; load louvain.js first");
    return;
  }
  const C = window.COMDET;
  const LV = C.LOUVAIN;

  function plogp(p) {
    if (p <= 0) return 0;
    return p * Math.log2(p);
  }

  // Wrap LOUVAIN.Graph + add the {ids, idx, adj, deg, m, n} shim that
  // greedyJoin/tune/subLevelPartition expect. LOUVAIN.Graph requires
  // 0..n-1 integer nodes, so map external ids to compact indices.
  function buildGraph(nodeIds, edges) {
    const n = nodeIds.length;
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    const compactEdges = [];
    edges.forEach(function (e) {
      const u = idx.get(e[0]); const v = idx.get(e[1]);
      if (u == null || v == null || u === v) return;
      compactEdges.push([u, v]);
    });
    const lg = LV.Graph(n, compactEdges, { correctSelfLoops: false });
    const adj = new Array(n);
    const deg = new Array(n);
    for (let i = 0; i < n; i++) {
      adj[i] = lg.neighbours(i);
      deg[i] = lg.degree(i);
    }
    return { n: n, ids: nodeIds, idx: idx, adj: adj, deg: deg,
             m: lg.totalWeight(), lg: lg };
  }

  // Stationary p_α = d_α / (2m) for connected undirected unweighted.
  function stationary(g) {
    if (g.m === 0) return new Array(g.n).fill(0);
    return g.deg.map(function (d) { return d / (2 * g.m); });
  }

  // ── Map-equation evaluator ──────────────────────────────────────
  // Given graph g, stationary p, and partition (Int array module-of-node),
  // compute L(M) plus per-module accumulators.
  function modulesOf(partition) {
    const out = new Map();
    for (let i = 0; i < partition.length; i++) {
      const c = partition[i];
      if (!out.has(c)) out.set(c, []);
      out.get(c).push(i);
    }
    return out;
  }

  function moduleAggregates(g, p, partition) {
    const mods = modulesOf(partition);
    const agg = new Map();
    mods.forEach(function (members, c) {
      let pi = 0;
      members.forEach(function (v) { pi += p[v]; });
      let qExit = 0;
      members.forEach(function (v) {
        if (g.deg[v] === 0) return;
        let out = 0;
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) {
          if (partition[nb[k]] !== c) out += 1;
        }
        qExit += p[v] * (out / g.deg[v]);
      });
      agg.set(c, { pi: pi, qExit: qExit, members: members });
    });
    let qTotal = 0;
    agg.forEach(function (a) { qTotal += a.qExit; });
    return { agg: agg, qTotal: qTotal };
  }

  function mapEquation(g, p, partition) {
    const out = moduleAggregates(g, p, partition);
    const { agg, qTotal } = out;
    // Stable form: qTotal·H(Q) = -Σᵢ plogp(qᵢ⤸) + plogp(qTotal).
    let qH = 0;
    if (qTotal > 0) {
      let s = 0;
      agg.forEach(function (a) { s += plogp(a.qExit); });
      qH = -(s - plogp(qTotal));
    }
    // p⊙ⁱ·H(Pⁱ) = -[Σ_{v∈i} plogp(p_v) + plogp(qᵢ⤸)] + plogp(p⊙ⁱ).
    let withinSum = 0;
    agg.forEach(function (a) {
      const pCircle = a.pi + a.qExit;
      if (pCircle <= 0) return;
      let s = 0;
      a.members.forEach(function (v) { s += plogp(p[v]); });
      s += plogp(a.qExit);
      withinSum += -(s - plogp(pCircle));
    });
    const L = qH + withinSum;
    return { L: L, qTotal: qTotal, agg: agg, withinSum: withinSum, indexSum: qH };
  }

  function greedyJoin(g, p, partition, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const traces = [];
    const part = partition.slice();
    let curr = mapEquation(g, p, part);

    while (true) {
      const pairKey = new Map();
      for (let v = 0; v < g.n; v++) {
        const cv = part[v];
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) {
          const cu = part[nb[k]];
          if (cu === cv) continue;
          const lo = Math.min(cv, cu), hi = Math.max(cv, cu);
          pairKey.set(lo + "|" + hi, { a: lo, b: hi });
        }
      }
      if (pairKey.size === 0) break;

      let bestDelta = 0;
      let bestPair = null;
      let bestNewL = curr.L;
      const cands = recordTrace ? [] : null;
      pairKey.forEach(function (pr) {
        const trial = part.slice();
        for (let v = 0; v < g.n; v++) if (trial[v] === pr.b) trial[v] = pr.a;
        const t = mapEquation(g, p, trial);
        const dL = t.L - curr.L;
        if (cands) cands.push({ a: pr.a, b: pr.b, dL: dL });
        if (dL < bestDelta) { bestDelta = dL; bestPair = pr; bestNewL = t.L; }
      });
      if (!bestPair) break;

      for (let v = 0; v < g.n; v++) if (part[v] === bestPair.b) part[v] = bestPair.a;
      if (recordTrace) {
        traces.push({
          merged: { a: bestPair.a, b: bestPair.b },
          dL: bestDelta,
          newL: bestNewL,
          candidates: cands.sort(function (x, y) { return x.dL - y.dL; }),
          partition: part.slice(),
        });
      }
      curr = { L: bestNewL };
    }
    return { partition: part, finalL: curr.L, traces: traces };
  }

  // Greedy single-node tuning. Paper SI canonical = heat-bath SA.
  function tune(g, p, partition, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const part = partition.slice();
    const traces = [];
    let currL = mapEquation(g, p, part).L;
    let pass = 0;
    while (true) {
      let movedThisPass = false;
      for (let v = 0; v < g.n; v++) {
        const cv = part[v];
        const candSet = new Set();
        candSet.add(cv);
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) candSet.add(part[nb[k]]);
        let bestDelta = 0; let bestComm = cv; let bestL = currL;
        const localCands = [];
        candSet.forEach(function (c) {
          if (c === cv) { localCands.push({ comm: c, dL: 0 }); return; }
          const trial = part.slice(); trial[v] = c;
          const newL = mapEquation(g, p, trial).L;
          const dL = newL - currL;
          localCands.push({ comm: c, dL: dL });
          if (dL < bestDelta) { bestDelta = dL; bestComm = c; bestL = newL; }
        });
        if (bestComm !== cv) {
          part[v] = bestComm;
          currL = bestL;
          movedThisPass = true;
        }
        if (recordTrace) {
          traces.push({
            v: v, fromComm: cv, toComm: bestComm,
            moved: bestComm !== cv, dL: bestDelta,
            candidates: localCands.sort(function (a, b) { return a.dL - b.dL; }),
            newL: currL,
          });
        }
      }
      pass += 1;
      if (!movedThisPass || pass > 40) break;
    }
    return { partition: part, finalL: currL, traces: traces, passes: pass };
  }

  // ── Sub-level recursion ─────────────────────────────────────────
  // For each module produced above, recurse on its induced subgraph.
  // Returns hierarchical structure: each top-level module carries a
  // .submodules array (or null if recursion produced a single sub).
  function subLevelPartition(g, p, partition, opts) {
    opts = opts || {};
    const maxDepth = opts.maxDepth != null ? opts.maxDepth : 3;
    const depth = opts.depth || 0;
    const out = {};
    if (depth >= maxDepth) return out;
    const mods = modulesOf(partition);
    mods.forEach(function (members, c) {
      if (members.length < 4) { out[c] = null; return; }
      const subIds = members.map(function (i) { return g.ids[i]; });
      const subEdges = [];
      const memberSet = new Set(members);
      for (let v = 0; v < g.n; v++) {
        if (!memberSet.has(v)) continue;
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) {
          if (memberSet.has(nb[k]) && v < nb[k]) {
            subEdges.push([g.ids[v], g.ids[nb[k]]]);
          }
        }
      }
      const subG = buildGraph(subIds, subEdges);
      // Stationary p_α = d_α/(2m) is the random-walk fixed point only on
      // a connected subgraph; on a reducible chain there is no unique
      // stationary. Run greedy+tune per connected component, then stitch
      // the sub-partitions into one labelling.
      const comps = subgraphComponents(subG);
      const subPartition = new Array(subG.n);
      let nextSubId = 0;
      let stitchedL = 0;
      comps.forEach(function (compIdx) {
        const compIds = compIdx.map(function (i) { return subG.ids[i]; });
        const compIdSet = new Set(compIds);
        const compEdges = subEdges.filter(function (e) {
          return compIdSet.has(e[0]) && compIdSet.has(e[1]);
        });
        const compG = buildGraph(compIds, compEdges);
        const compP = stationary(compG);
        const initSing = new Array(compG.n);
        for (let i = 0; i < compG.n; i++) initSing[i] = i;
        const j = greedyJoin(compG, compP, initSing, { recordTrace: false });
        const t = tune(compG, compP, j.partition, { recordTrace: false });
        const compRenum = renumber(t.partition);
        const startId = nextSubId;
        compIdx.forEach(function (subIdx, k) {
          subPartition[subIdx] = startId + compRenum[k];
        });
        let maxLocal = 0;
        compRenum.forEach(function (x) { if (x > maxLocal) maxLocal = x; });
        nextSubId += maxLocal + 1;
        stitchedL += t.finalL;
      });
      out[c] = {
        members: members.slice(),
        ids: subIds,
        subPartition: subPartition,
        subL: stitchedL,
        components: comps.length,
      };
      const distinct = new Set(subPartition);
      if (distinct.size > 1 && depth + 1 < maxDepth) {
        const subPdummy = stationary(subG);
        out[c].sub = subLevelPartition(subG, subPdummy, subPartition, {
          maxDepth: maxDepth, depth: depth + 1,
        });
      }
    });
    return out;
  }

  function subgraphComponents(subG) {
    const seen = new Uint8Array(subG.n);
    const comps = [];
    for (let s = 0; s < subG.n; s++) {
      if (seen[s]) continue;
      const comp = [];
      const q = [s];
      seen[s] = 1;
      while (q.length) {
        const v = q.shift();
        comp.push(v);
        const nb = subG.adj[v];
        for (let k = 0; k < nb.length; k++) {
          if (!seen[nb[k]]) { seen[nb[k]] = 1; q.push(nb[k]); }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  function renumber(partition) {
    const map = new Map();
    let next = 0;
    return partition.map(function (c) {
      if (!map.has(c)) { map.set(c, next++); }
      return map.get(c);
    });
  }

  // ── Outer driver ────────────────────────────────────────────────
  function runInfomap(nodeIds, edges, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const recurse = opts.recurse !== false;
    const g = buildGraph(nodeIds, edges);
    const p = stationary(g);

    // Singleton init.
    const initPart = new Array(g.n);
    for (let i = 0; i < g.n; i++) initPart[i] = i;
    const initL = mapEquation(g, p, initPart);

    // Greedy pair-joining.
    const joined = greedyJoin(g, p, initPart, { recordTrace: recordTrace });
    const joinedRenum = renumber(joined.partition);

    // Single-node tuning.
    const tuned = tune(g, p, joinedRenum, { recordTrace: recordTrace });
    const tunedRenum = renumber(tuned.partition);

    // Sub-level hierarchical recursion.
    const subLevel = recurse ? subLevelPartition(g, p, tunedRenum, {
      maxDepth: opts.maxDepth || 3,
    }) : {};

    // Final membership keyed by node id.
    const membership = new Map();
    nodeIds.forEach(function (id, i) { membership.set(id, tunedRenum[i]); });

    return {
      graph: g,
      stationary: p,
      initL: initL.L,
      joinPartition: joinedRenum,
      joinL: joined.finalL,
      joinTraces: joined.traces,
      tunePartition: tunedRenum,
      tuneL: tuned.finalL,
      tuneTraces: tuned.traces,
      tunePasses: tuned.passes,
      subLevel: subLevel,
      finalPartition: tunedRenum,
      finalL: tuned.finalL,
      membership: membership,
    };
  }

  // ── Public API ──────────────────────────────────────────────────
  C.INFOMAP = {
    buildGraph: buildGraph,
    stationary: stationary,
    mapEquation: mapEquation,
    moduleAggregates: moduleAggregates,
    plogp: plogp,
    greedyJoin: greedyJoin,
    tune: tune,
    subLevelPartition: subLevelPartition,
    runInfomap: runInfomap,
    renumber: renumber,
    runFixture: function (opts) {
      const F = C.FIXTURE;
      return runInfomap(F.nodes, F.edges, Object.assign({ recordTrace: true }, opts || {}));
    },
  };
})();
