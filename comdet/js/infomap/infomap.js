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
  if (!window.COMDET || !window.COMDET.COMMON) {
    console.warn("[infomap] COMDET.COMMON missing; load common/common.js first");
    return;
  }
  const C = window.COMDET;
  // Graph + MT19937 now live under COMDET.COMMON (cross-algo isolation
  // refactor 2026-05-10). Before that they were reached via COMDET.LOUVAIN
  // and Infomap loaded louvain.js as a substrate; that dep is gone.
  const CC = C.COMMON;

  function plogp(p) {
    if (p <= 0) return 0;
    return p * Math.log2(p);
  }

  // Wrap COMDET.COMMON.Graph + add the {ids, idx, adj, deg, m, n}
  // shim that greedyJoin/tune/subLevelPartition expect. COMMON.Graph
  // requires 0..n-1 integer nodes, so map external ids to compact
  // indices.
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
    const lg = CC.Graph(n, compactEdges, { correctSelfLoops: false });
    const adj = new Array(n);
    const deg = new Array(n);
    for (let i = 0; i < n; i++) {
      adj[i] = lg.neighbours(i);
      deg[i] = lg.degree(i);
    }
    return { n: n, ids: nodeIds, idx: idx, adj: adj, deg: deg,
             m: lg.totalWeight() };
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

  // Heat-bath simulated-annealing refinement (Rosvall+Bergstrom 2008,
  // SI eq. S6 + S8). For each node visit, pick the neighbour-module
  // proposal proportional to exp(-ΔL/T); decrease T geometrically. At
  // T → 0 this reduces to greedy. Recovers from greedy local minima.
  //
  // Determinism: a seed-driven MT19937 governs the proposal pick. The
  // seed defaults to 0 so a re-run reproduces the same trace.
  function saRefine(g, p, partition, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const T0 = opts.T0 != null ? opts.T0 : 0.5;
    const Tmin = opts.Tmin != null ? opts.Tmin : 1e-3;
    const cooling = opts.cooling != null ? opts.cooling : 0.85;
    const passesMax = opts.passesMax != null ? opts.passesMax : 40;
    const _CC = window.COMDET && window.COMDET.COMMON;
    const rng = _CC ? _CC.MT19937((opts.seed | 0) >>> 0) : null;
    function rand() {
      if (rng) return rng.raw() / 0x100000000;
      return Math.random();
    }
    const part = partition.slice();
    const traces = [];
    let currL = mapEquation(g, p, part).L;
    let pass = 0;
    let T = T0;
    while (T >= Tmin && pass < passesMax) {
      let movedThisPass = false;
      for (let v = 0; v < g.n; v++) {
        const cv = part[v];
        const candSet = new Set();
        candSet.add(cv);
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) candSet.add(part[nb[k]]);
        // Compute ΔL for every candidate.
        const cands = [];
        candSet.forEach(function (c) {
          if (c === cv) { cands.push({ comm: c, dL: 0, newL: currL }); return; }
          const trial = part.slice(); trial[v] = c;
          const newL = mapEquation(g, p, trial).L;
          cands.push({ comm: c, dL: newL - currL, newL: newL });
        });
        // Heat-bath weights w_i = exp(-ΔL_i / T). Subtract min to
        // avoid underflow at low T (standard Boltzmann trick).
        let dlMin = Infinity;
        for (let i = 0; i < cands.length; i++) if (cands[i].dL < dlMin) dlMin = cands[i].dL;
        let wsum = 0;
        const ws = cands.map(function (c) {
          const w = Math.exp(-(c.dL - dlMin) / T);
          wsum += w;
          return w;
        });
        let r = rand() * wsum;
        let pick = cands.length - 1;
        for (let i = 0; i < cands.length; i++) {
          r -= ws[i];
          if (r <= 0) { pick = i; break; }
        }
        const chosen = cands[pick];
        if (chosen.comm !== cv) {
          part[v] = chosen.comm;
          currL = chosen.newL;
          movedThisPass = true;
        }
        if (recordTrace) {
          traces.push({
            v: v, fromComm: cv, toComm: chosen.comm,
            moved: chosen.comm !== cv, dL: chosen.dL,
            T: T,
            candidates: cands.sort(function (a, b) { return a.dL - b.dL; }),
            newL: currL,
          });
        }
      }
      pass += 1;
      T *= cooling;
      if (!movedThisPass && T < T0 * 0.5) break;
    }
    // Final greedy pass at T → 0 to lock in the best local optimum
    // (paper SI: SA cools then converges deterministically).
    let frozen = false;
    while (!frozen) {
      frozen = true;
      for (let v = 0; v < g.n; v++) {
        const cv = part[v];
        const candSet = new Set();
        candSet.add(cv);
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) candSet.add(part[nb[k]]);
        let bestComm = cv, bestL = currL, bestDelta = 0;
        const finalCands = [];
        candSet.forEach(function (c) {
          if (c === cv) { finalCands.push({ comm: c, dL: 0, newL: currL }); return; }
          const trial = part.slice(); trial[v] = c;
          const newL = mapEquation(g, p, trial).L;
          const dL = newL - currL;
          finalCands.push({ comm: c, dL: dL, newL: newL });
          if (dL < bestDelta) { bestDelta = dL; bestComm = c; bestL = newL; }
        });
        if (bestComm !== cv) {
          part[v] = bestComm;
          currL = bestL;
          frozen = false;
        }
        if (recordTrace) {
          traces.push({
            v: v, fromComm: cv, toComm: bestComm,
            moved: bestComm !== cv, dL: bestDelta,
            T: 0,
            candidates: finalCands.sort(function (a, b) { return a.dL - b.dL; }),
            newL: currL,
          });
        }
      }
      pass += 1;
      if (pass > passesMax + 10) break;
    }
    return { partition: part, finalL: currL, traces: traces, passes: pass };
  }

  // Greedy single-node tuning. Equivalent to saRefine at T → 0.
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
      // CC over filtered g.adj using memberSet — no parent buildGraph
      // needed. comps is array of g-index arrays.
      const memberSet = new Set(members);
      const comps = componentsByMember(g, members, memberSet);
      const subIds = members.map(function (i) { return g.ids[i]; });
      const subIdxOfG = new Map();
      members.forEach(function (gi, k) { subIdxOfG.set(gi, k); });
      const subPartition = new Array(members.length);
      let nextSubId = 0;
      let stitchedL = 0;
      comps.forEach(function (compGIdx) {
        const compIds = compGIdx.map(function (gi) { return g.ids[gi]; });
        const compIdSet = new Set(compIds);
        // Stationary p = d/(2m) is the random-walk fixed point only on
        // a connected chain; per-component run keeps it valid.
        const compEdges = [];
        compGIdx.forEach(function (gi) {
          const nb = g.adj[gi];
          for (let k = 0; k < nb.length; k++) {
            const u = nb[k];
            if (memberSet.has(u) && gi < u && compIdSet.has(g.ids[u])) {
              compEdges.push([g.ids[gi], g.ids[u]]);
            }
          }
        });
        const compG = buildGraph(compIds, compEdges);
        const compP = stationary(compG);
        const initSing = new Array(compG.n);
        for (let i = 0; i < compG.n; i++) initSing[i] = i;
        const j = greedyJoin(compG, compP, initSing, { recordTrace: false });
        const t = tune(compG, compP, j.partition, { recordTrace: false });
        const compRenum = renumber(t.partition);
        const startId = nextSubId;
        compGIdx.forEach(function (gi, k) {
          subPartition[subIdxOfG.get(gi)] = startId + compRenum[k];
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
      // Recursive descent only needs another buildGraph if it splits.
      const distinct = new Set(subPartition);
      if (distinct.size > 1 && depth + 1 < maxDepth) {
        const subEdges = [];
        members.forEach(function (gi, ki) {
          const nb = g.adj[gi];
          for (let k = 0; k < nb.length; k++) {
            const u = nb[k];
            if (memberSet.has(u) && gi < u) subEdges.push([g.ids[gi], g.ids[u]]);
          }
        });
        const subG = buildGraph(subIds, subEdges);
        const subP = stationary(subG);
        out[c].sub = subLevelPartition(subG, subP, subPartition, {
          maxDepth: maxDepth, depth: depth + 1,
        });
      }
    });
    return out;
  }

  // BFS over members (g-indices) using g.adj filtered by memberSet.
  function componentsByMember(g, members, memberSet) {
    const seen = new Set();
    const comps = [];
    members.forEach(function (s) {
      if (seen.has(s)) return;
      const comp = [];
      const q = [s];
      seen.add(s);
      while (q.length) {
        const v = q.shift();
        comp.push(v);
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) {
          const u = nb[k];
          if (memberSet.has(u) && !seen.has(u)) { seen.add(u); q.push(u); }
        }
      }
      comps.push(comp);
    });
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

    // Refinement: greedy single-node tuner is the practical default
    // (Rosvall-Bergstrom 2008 §2 mentions "fast greedy" as the
    // production heuristic). Set opts.refine = "sa" to enable the heat
    // -bath simulated-annealing refinement from the paper SI; it can
    // escape greedy local minima on dense networks but typically lands
    // worse on small fixtures because greedyJoin is already near-
    // optimal there. SA is deterministic per opts.seed.
    const refineMode = opts.refine || "greedy";
    const refined = (refineMode === "sa")
      ? saRefine(g, p, joinedRenum, {
          recordTrace: recordTrace,
          seed: opts.seed != null ? opts.seed : 0,
          T0: opts.T0, Tmin: opts.Tmin, cooling: opts.cooling,
        })
      : tune(g, p, joinedRenum, { recordTrace: recordTrace });
    const tunedRenum = renumber(refined.partition);
    const tuned = refined;

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
    saRefine: saRefine,
    subLevelPartition: subLevelPartition,
    runInfomap: runInfomap,
    renumber: renumber,
    runFixture: function (opts) {
      const F = C.FIXTURE;
      return runInfomap(F.nodes, F.edges, Object.assign({ recordTrace: true }, opts || {}));
    },
  };
})();
