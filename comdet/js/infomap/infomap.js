/* Infomap kernel — port of Rosvall + Bergstrom 2008 ("Maps of random
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
 *   4. Tuning: single-node move pass — for each node, try moving to
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
  if (!window.COMDET) window.COMDET = {};
  const C = window.COMDET;

  // ── Math utilities ──────────────────────────────────────────────
  // Shannon entropy bits: -p log2 p; defined as 0 when p == 0.
  function plogp(p) {
    if (p <= 0) return 0;
    return p * Math.log2(p);
  }

  // ── Graph view ──────────────────────────────────────────────────
  function buildGraph(nodeIds, edges) {
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    const n = nodeIds.length;
    const adj = []; // adj[i] = array of neighbour indices (no self-loops)
    for (let i = 0; i < n; i++) adj.push([]);
    edges.forEach(function (e) {
      if (e[0] === e[1]) return;
      const u = idx.get(e[0]); const v = idx.get(e[1]);
      if (u == null || v == null) return;
      adj[u].push(v); adj[v].push(u);
    });
    const deg = adj.map(function (a) { return a.length; });
    const m = deg.reduce(function (s, d) { return s + d; }, 0) / 2;
    return { n: n, ids: nodeIds, idx: idx, adj: adj, deg: deg, m: m };
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
    // Returns Map<commId, { pi, qExit }> + total q.
    const mods = modulesOf(partition);
    const agg = new Map();
    mods.forEach(function (members, c) {
      let pi = 0;
      members.forEach(function (v) { pi += p[v]; });
      // q_c⤸ = sum over v in c, p_v * (out_v / d_v) where out_v = #neighbours not in c.
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
    // Index-code entropy: -Σ_i (q_i⤸ / qTotal) log2(q_i⤸ / qTotal), times qTotal.
    // Equivalent: qTotal * H(Q) = Σ_i plogp(q_i / qTotal) * (-1) * qTotal.
    // Use the numerically stabler form in bits:
    //   qTotal * H(Q) = -Σ_i plogp(q_i⤸) + plogp(qTotal)  (when qTotal > 0)
    let qH = 0;
    if (qTotal > 0) {
      let s = 0;
      agg.forEach(function (a) { s += plogp(a.qExit); });
      qH = -(s - plogp(qTotal));
      // qH = qTotal * H(Q)
    }
    // Within-module codeword entropies:
    //   p⊙ⁱ = π_i + q_i⤸
    //   p⊙ⁱ · H(Pⁱ) = -[ Σ_{v∈i} plogp(p_v) + plogp(q_i⤸) ] + plogp(p⊙ⁱ)
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

  // ── Greedy pair-joining ─────────────────────────────────────────
  // At each step, find the (i, j) pair of modules with at least one
  // edge between them whose merge gives the largest ΔL decrease;
  // merge if ΔL < 0; halt otherwise. Returns the per-step trace.
  function greedyJoin(g, p, partition, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const traces = [];
    const part = partition.slice();
    let curr = mapEquation(g, p, part);

    while (true) {
      // Build set of inter-module edges → unique unordered (a, b) pairs.
      const pairKey = new Map(); // "a|b" → {a,b}
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
      let bestL = curr.L;
      pairKey.forEach(function (pr) {
        const trial = part.slice();
        for (let v = 0; v < g.n; v++) if (trial[v] === pr.b) trial[v] = pr.a;
        const t = mapEquation(g, p, trial);
        const dL = t.L - curr.L;
        if (dL < bestDelta) { bestDelta = dL; bestPair = pr; bestL = t.L; }
      });

      if (!bestPair) break;
      // Apply the merge.
      const cands = [];
      pairKey.forEach(function (pr) {
        const trial = part.slice();
        for (let v = 0; v < g.n; v++) if (trial[v] === pr.b) trial[v] = pr.a;
        cands.push({ a: pr.a, b: pr.b, dL: mapEquation(g, p, trial).L - curr.L });
      });
      for (let v = 0; v < g.n; v++) if (part[v] === bestPair.b) part[v] = bestPair.a;
      const newL = mapEquation(g, p, part);
      if (recordTrace) {
        traces.push({
          merged: { a: bestPair.a, b: bestPair.b },
          dL: bestDelta,
          newL: newL.L,
          candidates: cands.sort(function (x, y) { return x.dL - y.dL; }),
          partition: part.slice(),
        });
      }
      curr = newL;
    }
    return { partition: part, finalL: curr.L, traces: traces };
  }

  // ── Single-node tuning ──────────────────────────────────────────
  // Greedy node-move: for each node, try moving to each neighbour
  // module, accept first move with ΔL < 0; sweep until idempotent.
  // Greedy variant of paper's heat-bath SA tuning.
  function tune(g, p, partition, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const part = partition.slice();
    const traces = [];
    let curr = mapEquation(g, p, part);
    let pass = 0;
    while (true) {
      let movedThisPass = false;
      for (let v = 0; v < g.n; v++) {
        const cv = part[v];
        // Candidate set: distinct neighbour-module ids (including cv).
        const cands = new Set();
        cands.add(cv);
        const nb = g.adj[v];
        for (let k = 0; k < nb.length; k++) cands.add(part[nb[k]]);
        let bestDelta = 0; let bestComm = cv; let bestL = curr.L;
        const localCands = [];
        cands.forEach(function (c) {
          if (c === cv) { localCands.push({ comm: c, dL: 0 }); return; }
          const trial = part.slice(); trial[v] = c;
          const t = mapEquation(g, p, trial);
          const dL = t.L - curr.L;
          localCands.push({ comm: c, dL: dL });
          if (dL < bestDelta) { bestDelta = dL; bestComm = c; bestL = t.L; }
        });
        if (bestComm !== cv) {
          part[v] = bestComm;
          curr = mapEquation(g, p, part);
          movedThisPass = true;
          if (recordTrace) {
            traces.push({
              v: v, fromComm: cv, toComm: bestComm,
              moved: true, dL: bestDelta,
              candidates: localCands.sort(function (a, b) { return a.dL - b.dL; }),
              newL: curr.L,
            });
          }
        } else if (recordTrace) {
          traces.push({
            v: v, fromComm: cv, toComm: cv,
            moved: false, dL: 0,
            candidates: localCands.sort(function (a, b) { return a.dL - b.dL; }),
            newL: curr.L,
          });
        }
      }
      pass += 1;
      if (!movedThisPass || pass > 40) break;
    }
    return { partition: part, finalL: curr.L, traces: traces, passes: pass };
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
      const subP = stationary(subG);
      const initSing = new Array(subG.n);
      for (let i = 0; i < subG.n; i++) initSing[i] = i;
      const j = greedyJoin(subG, subP, initSing, { recordTrace: false });
      const t = tune(subG, subP, j.partition, { recordTrace: false });
      // Renumber the sub-partition before recursing.
      const renumbered = renumber(t.partition);
      out[c] = {
        members: members.slice(),
        ids: subIds,
        subPartition: renumbered,
        subL: t.finalL,
      };
      // Recurse only if recursion produced a non-trivial split.
      const distinct = new Set(renumbered);
      if (distinct.size > 1 && depth + 1 < maxDepth) {
        out[c].sub = subLevelPartition(subG, subP, renumbered, {
          maxDepth: maxDepth, depth: depth + 1,
        });
      }
    });
    return out;
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
