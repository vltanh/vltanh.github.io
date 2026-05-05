/* Louvain kernel — primitives + Blondel et al. 2008 fast unfolding.
 *
 * This file owns the shared graph-partition substrate that BOTH Louvain
 * and Leiden build on:
 *   - MT19937 RNG
 *   - Fisher-Yates shuffle
 *   - Graph wrapper (adjacency cache, totalWeight, collapse, possibleEdges)
 *   - MutableVertexPartition (admin: csize, total_weight_*, neighbour cache,
 *     moveNode, getEmptyCommunity, renumber, fromCoarsePartition, ...)
 *   - Modularity quality function
 *
 * Plus the Louvain-specific outer driver (Blondel 2008):
 *   - sweep(P, rng): one full pass over every node in shuffled order;
 *     each visit picks the candidate community with the largest strictly
 *     positive ΔQ (greedy, no acceptance of ties).
 *   - run(graph, q, seed): sweep until quiet, aggregate, repeat until
 *     the aggregation step doesn't shrink the graph.
 *
 * Leiden (js/leiden/leiden.js) extends this substrate by:
 *   - Adding the CPM quality function (size-penalty objective).
 *   - Replacing sweep with moveNodes (FIFO queue + neighbour
 *     restabilisation, paper §"fast local move procedure").
 *   - Inserting mergeNodesConstrained between local-move and aggregation
 *     (the refinement phase that guarantees γ-connectivity).
 *   - Aggregating from the refined sub-partition while keeping the
 *     pre-refinement community labels.
 */
(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};

  // ── MT19937 ─────────────────────────────────────────────────────
  // Matsumoto-Nishimura 32-bit state machine. Seed via int32; integer
  // draws on [lo, hi] use rejection sampling to match the canonical
  // igraph contract.
  function MT19937(seed) {
    const N = 624;
    const mt = new Uint32Array(N);
    let mti = N + 1;
    function init(s) {
      mt[0] = s >>> 0;
      for (let i = 1; i < N; i++) {
        const t = (mt[i - 1] ^ (mt[i - 1] >>> 30)) >>> 0;
        const lo = (t & 0xffff), hi = (t >>> 16);
        const m = (1812433253 * lo + (((1812433253 * hi) & 0xffff) << 16)) >>> 0;
        mt[i] = (m + i) >>> 0;
      }
      mti = N;
    }
    function next() {
      if (mti >= N) {
        for (let i = 0; i < N; i++) {
          const y = ((mt[i] & 0x80000000) | (mt[(i + 1) % N] & 0x7fffffff)) >>> 0;
          let v = (mt[(i + 397) % N] ^ (y >>> 1)) >>> 0;
          if (y & 1) v = (v ^ 0x9908b0df) >>> 0;
          mt[i] = v;
        }
        mti = 0;
      }
      let y = mt[mti++];
      y = (y ^ (y >>> 11)) >>> 0;
      y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
      y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
      y = (y ^ (y >>> 18)) >>> 0;
      return y;
    }
    init(seed >>> 0);
    return {
      int: function (lo, hi) {
        const range = hi - lo + 1;
        if (range <= 0) return lo;
        const limit = Math.floor(0x100000000 / range) * range;
        let r;
        do { r = next(); } while (r >= limit);
        return lo + (r % range);
      },
      seed: function (s) { init(s >>> 0); },
      raw: next,
    };
  }

  function shuffle(arr, rng) {
    for (let idx = arr.length - 1; idx >= 1; idx--) {
      const j = rng.int(0, idx);
      const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    }
  }
  function range(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }

  // ── Graph ────────────────────────────────────────────────────────
  function Graph(n, edges, opts) {
    opts = opts || {};
    const directed = !!opts.directed;
    const correctSelfLoops = !!opts.correctSelfLoops;
    const nodeSizes = opts.nodeSizes ? opts.nodeSizes.slice()
                                     : new Array(n).fill(1);
    const m = edges.length;
    const eu = new Int32Array(m);
    const ev = new Int32Array(m);
    const ew = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      eu[i] = edges[i][0] | 0;
      ev[i] = edges[i][1] | 0;
      ew[i] = edges[i].length > 2 ? +edges[i][2] : 1.0;
    }
    const adjE = new Array(n);
    const adjN = new Array(n);
    for (let i = 0; i < n; i++) { adjE[i] = []; adjN[i] = []; }
    for (let e = 0; e < m; e++) {
      const u = eu[e], v = ev[e];
      adjE[u].push(e); adjN[u].push(v);
      if (u !== v) { adjE[v].push(e); adjN[v].push(u); }
    }
    const nodeSelfWeights = new Float64Array(n);
    for (let e = 0; e < m; e++) if (eu[e] === ev[e]) nodeSelfWeights[eu[e]] += ew[e];
    const strength = new Float64Array(n);
    for (let e = 0; e < m; e++) {
      // Standard convention: undirected self-loop contributes 2*w to
      // strength (the looped end counts at both endpoints).
      strength[eu[e]] += ew[e];
      strength[ev[e]] += ew[e];
    }
    let totalWeight = 0;
    for (let e = 0; e < m; e++) totalWeight += ew[e];
    return {
      vcount: function () { return n; },
      ecount: function () { return m; },
      isDirected: function () { return directed; },
      correctSelfLoops: function () { return correctSelfLoops; },
      edge: function (e) { return [eu[e], ev[e]]; },
      edgeWeight: function (e) { return ew[e]; },
      nodeSize: function (v) { return nodeSizes[v]; },
      nodeSelfWeight: function (v) { return nodeSelfWeights[v]; },
      degree: function (v) { return adjN[v].length; },
      strength: function (v) { return strength[v]; },
      totalWeight: function () { return totalWeight; },
      neighbours: function (v) { return adjN[v]; },
      neighbourEdges: function (v) { return adjE[v]; },
      possibleEdges: function (sz) {
        let p = directed ? sz * sz : (sz * (sz - 1)) / 2;
        if (correctSelfLoops) p += sz;
        return p;
      },
      collapse: function (membership, ncomm) {
        const wmap = new Map();
        for (let e = 0; e < m; e++) {
          const a = membership[eu[e]];
          const b = membership[ev[e]];
          const w = ew[e];
          let lo = a, hi = b;
          if (!directed && lo > hi) { lo = b; hi = a; }
          const key = lo * ncomm + hi;
          wmap.set(key, (wmap.get(key) || 0) + w);
        }
        const newEdges = [];
        wmap.forEach(function (w, key) {
          const lo = Math.floor(key / ncomm), hi = key % ncomm;
          newEdges.push([lo, hi, w]);
        });
        const newSizes = new Array(ncomm).fill(0);
        for (let v = 0; v < n; v++) newSizes[membership[v]] += nodeSizes[v];
        return Graph(ncomm, newEdges, {
          directed: directed,
          correctSelfLoops: correctSelfLoops,
          nodeSizes: newSizes,
        });
      },
    };
  }

  // ── Partition ────────────────────────────────────────────────────
  function Partition(graph, init, qualityFn) {
    const n = graph.vcount();
    let membership = new Int32Array(n);
    if (init) for (let i = 0; i < n; i++) membership[i] = init[i] | 0;
    else for (let i = 0; i < n; i++) membership[i] = i;
    let ncomm = 0;
    for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
    let csize = new Float64Array(ncomm);
    let cnodes = new Int32Array(ncomm);
    let totalWeightInComm = new Float64Array(ncomm);
    let totalWeightToComm = new Float64Array(ncomm);
    let totalWeightFromComm = new Float64Array(ncomm);
    let totalPossibleEdgesInAllComms = 0;
    let totalWeightInAllComms = 0;
    const empties = new Set();
    // Per-node neighbour-comm cache: when caller asks about v's
    // neighbour communities or weights repeatedly (which every
    // diff_move loop does), populate once and reuse until v moves
    // or the cache is invalidated. Mirrors libleidenalg
    // cache_neigh_communities (MutableVertexPartition.cpp:799).
    let cacheV = -1;
    let cacheNeighComms = [];     // list of distinct neighbour comms of cacheV
    const cacheWeightsTo = new Map();   // comm -> weight from neighbours in comm to v
    const cacheWeightsFrom = new Map(); // comm -> weight from v to neighbours in comm

    function rebuildAdmin() {
      ncomm = 0;
      for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
      const directed = graph.isDirected();
      csize = new Float64Array(ncomm);
      cnodes = new Int32Array(ncomm);
      totalWeightInComm = new Float64Array(ncomm);
      totalWeightToComm = new Float64Array(ncomm);
      // For undirected graphs totalWeightFromComm[c] always equals
      // totalWeightToComm[c] (every edge's weight is counted in both
      // by symmetry). Alias the storage so writes to either side update
      // both views; halves the per-move admin work without changing the
      // numbers any reader sees.
      totalWeightFromComm = directed ? new Float64Array(ncomm) : totalWeightToComm;
      for (let v = 0; v < n; v++) {
        csize[membership[v]] += graph.nodeSize(v);
        cnodes[membership[v]] += 1;
      }
      const m = graph.ecount();
      for (let e = 0; e < m; e++) {
        const uv = graph.edge(e);
        const u = uv[0], v = uv[1];
        const cu = membership[u], cv = membership[v];
        const w = graph.edgeWeight(e);
        if (cu === cv) totalWeightInComm[cu] += w;
        if (directed) {
          totalWeightFromComm[cu] += w;
          totalWeightToComm[cv] += w;
        } else {
          // Per-endpoint convention: each edge endpoint contributes w
          // to its comm's to-array slot. Intra ⇒ both endpoints in the
          // same comm ⇒ to[c] += 2w. Inter ⇒ to[a] += w, to[b] += w.
          // Result: totalWeightToComm[c] = strength_sum_c =
          // 2*intra_c + inter_c, which is what Modularity().diffMove
          // and quality treat as Kc.
          totalWeightToComm[cu] += w;
          totalWeightToComm[cv] += w;
        }
      }
      totalPossibleEdgesInAllComms = 0;
      totalWeightInAllComms = 0;
      empties.clear();
      for (let c = 0; c < ncomm; c++) {
        totalWeightInAllComms += totalWeightInComm[c];
        totalPossibleEdgesInAllComms += graph.possibleEdges(csize[c]);
        if (cnodes[c] === 0) empties.add(c);
      }
      invalidateCache();
    }

    function invalidateCache() {
      cacheV = -1;
      cacheNeighComms.length = 0;
      cacheWeightsTo.clear();
      cacheWeightsFrom.clear();
    }

    function cacheNeighbours(v) {
      if (cacheV === v) return;
      cacheV = v;
      cacheNeighComms.length = 0;
      cacheWeightsTo.clear();
      cacheWeightsFrom.clear();
      const directed = graph.isDirected();
      const adjE = graph.neighbourEdges(v);
      const seen = new Set();
      for (let i = 0; i < adjE.length; i++) {
        const e = adjE[i];
        const uv = graph.edge(e);
        const other = (uv[0] === v) ? uv[1] : uv[0];
        if (other === v) continue; // self-loop carried by node_self_weight
        const c = membership[other];
        if (!seen.has(c)) {
          seen.add(c);
          cacheNeighComms.push(c);
        }
        const w = graph.edgeWeight(e);
        if (directed) {
          if (uv[1] === v) {
            cacheWeightsTo.set(c, (cacheWeightsTo.get(c) || 0) + w);
          } else {
            cacheWeightsFrom.set(c, (cacheWeightsFrom.get(c) || 0) + w);
          }
        } else {
          cacheWeightsTo.set(c, (cacheWeightsTo.get(c) || 0) + w);
        }
      }
    }
    rebuildAdmin();

    function moveNode(v, target) {
      const old = membership[v];
      if (old === target) return;
      const directed = graph.isDirected();
      const adjE = graph.neighbourEdges(v);
      let deltaInAll = 0;

      // Phase A: subtract v's contribution from `old`. Per-edge logic
      // inlined for hot-path perf; closure-style helper extraction
      // measured a 2× kernel slowdown so we keep the explicit branches.
      // Undirected branch uses the single-write to-only pattern (from
      // aliases to in storage; halving the writes per edge versus the
      // canonical four-write pattern lands the same numeric values
      // because rebuildAdmin uses the matching single-write pattern).
      for (let i = 0; i < adjE.length; i++) {
        const e = adjE[i];
        const uv = graph.edge(e);
        const other = (uv[0] === v) ? uv[1] : uv[0];
        const w = graph.edgeWeight(e);
        if (other === v) {
          totalWeightInComm[old] -= w;
          totalWeightFromComm[old] -= w;
          totalWeightToComm[old] -= w;
          deltaInAll -= w;
          continue;
        }
        const cother = membership[other];
        if (directed) {
          if (uv[0] === v) {
            totalWeightFromComm[old] -= w;
            totalWeightToComm[cother] -= w;
            if (cother === old) { totalWeightInComm[old] -= w; deltaInAll -= w; }
          } else {
            totalWeightToComm[old] -= w;
            totalWeightFromComm[cother] -= w;
            if (cother === old) { totalWeightInComm[old] -= w; deltaInAll -= w; }
          }
        } else {
          // Per-endpoint convention (mirror rebuildAdmin): subtract w
          // from to[old] for v's endpoint, and -w from to[cother] for
          // the other endpoint. Intra (cother == old) ⇒ both writes
          // hit to[old] ⇒ -2w net.
          totalWeightToComm[old] -= w;
          totalWeightToComm[cother] -= w;
          if (cother === old) {
            totalWeightInComm[old] -= w;
            deltaInAll -= w;
          }
        }
      }
      // Phase B: relocate v's csize / cnodes; grow arrays if `target` is
      // a fresh community id. For undirected the from-storage aliases
      // to-storage so a fresh allocation must re-establish the alias.
      csize[old] -= graph.nodeSize(v);
      cnodes[old] -= 1;
      totalPossibleEdgesInAllComms -= graph.possibleEdges(csize[old] + graph.nodeSize(v));
      totalPossibleEdgesInAllComms += graph.possibleEdges(csize[old]);
      membership[v] = target;
      if (target >= ncomm) {
        const newN = target + 1;
        csize = grow(csize, newN);
        cnodes = grow(cnodes, newN);
        totalWeightInComm = grow(totalWeightInComm, newN);
        totalWeightToComm = grow(totalWeightToComm, newN);
        totalWeightFromComm = directed
          ? grow(totalWeightFromComm, newN)
          : totalWeightToComm;
        totalPossibleEdgesInAllComms += graph.possibleEdges(0) * (newN - ncomm);
        ncomm = newN;
      }
      totalPossibleEdgesInAllComms -= graph.possibleEdges(csize[target]);
      csize[target] += graph.nodeSize(v);
      cnodes[target] += 1;
      totalPossibleEdgesInAllComms += graph.possibleEdges(csize[target]);
      // Phase C: add v's contribution to `target`. Same inlined per-edge
      // shape as Phase A with sign flipped and vComm = target.
      for (let i = 0; i < adjE.length; i++) {
        const e = adjE[i];
        const uv = graph.edge(e);
        const other = (uv[0] === v) ? uv[1] : uv[0];
        const w = graph.edgeWeight(e);
        if (other === v) {
          totalWeightInComm[target] += w;
          totalWeightFromComm[target] += w;
          totalWeightToComm[target] += w;
          deltaInAll += w;
          continue;
        }
        const cother = membership[other];
        if (directed) {
          if (uv[0] === v) {
            totalWeightFromComm[target] += w;
            totalWeightToComm[cother] += w;
            if (cother === target) { totalWeightInComm[target] += w; deltaInAll += w; }
          } else {
            totalWeightToComm[target] += w;
            totalWeightFromComm[cother] += w;
            if (cother === target) { totalWeightInComm[target] += w; deltaInAll += w; }
          }
        } else {
          totalWeightToComm[target] += w;
          totalWeightToComm[cother] += w;
          if (cother === target) {
            totalWeightInComm[target] += w;
            deltaInAll += w;
          }
        }
      }
      if (cnodes[old] === 0) empties.add(old);
      empties.delete(target);
      totalWeightInAllComms += deltaInAll;
      invalidateCache();
    }

    function grow(typedArr, newN) {
      const out = (typedArr instanceof Float64Array) ? new Float64Array(newN)
              : (typedArr instanceof Int32Array) ? new Int32Array(newN)
              : new Array(newN).fill(0);
      for (let i = 0; i < typedArr.length; i++) out[i] = typedArr[i];
      return out;
    }

    function getEmptyCommunity() {
      if (empties.size > 0) {
        // Pick any empty id (insertion order via Set iterator).
        const it = empties.values();
        return it.next().value;
      }
      const newId = ncomm;
      csize = grow(csize, newId + 1);
      cnodes = grow(cnodes, newId + 1);
      totalWeightInComm = grow(totalWeightInComm, newId + 1);
      totalWeightToComm = grow(totalWeightToComm, newId + 1);
      totalWeightFromComm = graph.isDirected()
        ? grow(totalWeightFromComm, newId + 1)
        : totalWeightToComm;
      ncomm += 1;
      empties.add(newId);
      totalPossibleEdgesInAllComms += graph.possibleEdges(0);
      // Cache lists comm ids; growing the comm list does not change v's
      // neighbour comms, so the cache stays valid. No invalidation here.
      return newId;
    }

    function weightToComm(v, comm) {
      cacheNeighbours(v);
      return cacheWeightsTo.get(comm) || 0;
    }
    function weightFromComm(v, comm) {
      if (!graph.isDirected()) return weightToComm(v, comm);
      cacheNeighbours(v);
      return cacheWeightsFrom.get(comm) || 0;
    }

    function getNeighComms(v) {
      cacheNeighbours(v);
      return cacheNeighComms;
    }
    function getNeighCommsConstrained(v, constrained) {
      const adjN = graph.neighbours(v);
      const cv = constrained[v];
      const seen = new Set();
      for (let i = 0; i < adjN.length; i++) {
        const u = adjN[i];
        if (u === v) continue;
        if (constrained[u] !== cv) continue;
        seen.add(membership[u]);
      }
      return Array.from(seen);
    }

    function renumber() {
      // Sort surviving comm ids by descending csize, then permute the
      // admin tables in place. Avoids the full per-edge re-accumulation
      // that rebuildAdmin would do.
      const order = [];
      for (let c = 0; c < ncomm; c++) if (cnodes[c] > 0) order.push(c);
      order.sort(function (a, b) { return csize[b] - csize[a]; });
      const remap = new Int32Array(ncomm);
      for (let i = 0; i < order.length; i++) remap[order[i]] = i;
      for (let v = 0; v < n; v++) membership[v] = remap[membership[v]];
      const newN = order.length;
      const directed = graph.isDirected();
      const newCsize = new Float64Array(newN);
      const newCnodes = new Int32Array(newN);
      const newIn = new Float64Array(newN);
      const newTo = new Float64Array(newN);
      const newFrom = directed ? new Float64Array(newN) : null;
      for (let i = 0; i < newN; i++) {
        const oldId = order[i];
        newCsize[i] = csize[oldId];
        newCnodes[i] = cnodes[oldId];
        newIn[i] = totalWeightInComm[oldId];
        newTo[i] = totalWeightToComm[oldId];
        if (directed) newFrom[i] = totalWeightFromComm[oldId];
      }
      csize = newCsize; cnodes = newCnodes;
      totalWeightInComm = newIn;
      totalWeightToComm = newTo;
      totalWeightFromComm = directed ? newFrom : newTo;
      ncomm = newN;
      empties.clear();
      // totalWeightInAllComms + totalPossibleEdgesInAllComms unchanged
      // by a permutation that drops empty communities only (those have
      // csize=0, so possibleEdges(0) contribution is zero anyway).
      invalidateCache();
    }

    return {
      graph: graph,
      membership: function () { return membership; },
      memberOf: function (v) { return membership[v]; },
      n: function () { return n; },
      ncomm: function () { return ncomm; },
      csize: function (c) { return csize[c]; },
      cnodes: function (c) { return cnodes[c]; },
      totalWeightInComm: function (c) { return totalWeightInComm[c]; },
      totalWeightToComm: function (c) { return totalWeightToComm[c]; },
      totalWeightFromComm: function (c) { return totalWeightFromComm[c]; },
      totalWeightInAllComms: function () { return totalWeightInAllComms; },
      totalPossibleEdgesInAllComms: function () { return totalPossibleEdgesInAllComms; },
      moveNode: moveNode,
      weightToComm: weightToComm,
      weightFromComm: weightFromComm,
      getNeighComms: getNeighComms,
      getNeighCommsConstrained: getNeighCommsConstrained,
      getEmptyCommunity: getEmptyCommunity,
      renumber: renumber,
      rebuildAdmin: rebuildAdmin,
      diffMove: function (v, target) { return qualityFn.diffMove(this, v, target); },
      quality: function () { return qualityFn.quality(this); },
      qualityFn: qualityFn,
      setMembership: function (m) {
        for (let i = 0; i < n; i++) membership[i] = m[i] | 0;
        rebuildAdmin();
      },
      fromCoarsePartition: function (coarse, mapping) {
        for (let v = 0; v < n; v++) membership[v] = coarse[mapping[v]];
        rebuildAdmin();
      },
    };
  }

  // ── Modularity quality (paper §1 eq 1, ΔQ from §2 eq 2) ─────────
  function Modularity() {
    return {
      name: "Modularity",
      resolution: 1.0,
      diffMove: function (P, v, newComm) {
        const oldComm = P.memberOf(v);
        if (oldComm === newComm) return 0;
        const G = P.graph;
        const m = G.totalWeight();
        if (m <= 0) return 0;
        const W = G.isDirected() ? m : 2 * m;
        const kv = G.strength(v);
        const wToOld = P.weightToComm(v, oldComm);
        const wToNew = P.weightToComm(v, newComm);
        const Kold = P.totalWeightFromComm(oldComm);
        const Knew = P.totalWeightFromComm(newComm);
        const diffOld = wToOld - kv * (Kold - kv) / W;
        const diffNew = wToNew - kv * Knew / W;
        const diff = (diffNew - diffOld) * (G.isDirected() ? 1 : 2);
        return diff / W;
      },
      quality: function (P) {
        const G = P.graph;
        const m = G.totalWeight();
        if (m <= 0) return 0;
        const W = G.isDirected() ? m : 2 * m;
        let q = 0;
        for (let c = 0; c < P.ncomm(); c++) {
          if (P.cnodes(c) === 0) continue;
          const ec = P.totalWeightInComm(c);
          const Kc = P.totalWeightFromComm(c);
          q += (G.isDirected() ? ec : 2 * ec) - (Kc * Kc) / W;
        }
        return q / W;
      },
    };
  }

  // ── Louvain sweep + phase1 + run ────────────────────────────────
  // sweep(P, rng): one full pass over every node. Greedy strict-positive
  // ΔQ pick (Blondel: ΔQ > 0). No queue, no neighbour restabilisation.
  function sweep(P, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const n = P.n();
    const order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    // Replay-mode: caller can inject the canonical's exact visit order
    // (e.g. gen-louvain's random_order vector). When set, JS skips its
    // own shuffle so per-visit moves are deterministic vs canonical.
    if (opts.visitOrder) {
      for (let i = 0; i < n; i++) order[i] = opts.visitOrder[i];
    } else {
      shuffle(order, rng);
    }
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    for (let i = 0; i < n; i++) {
      const v = order[i];
      const vComm = P.memberOf(v);
      const cands = P.getNeighComms(v);
      if (cands.indexOf(vComm) < 0) cands.push(vComm);
      let maxComm = vComm;
      let maxImprov = 0;             // strict positive (Blondel paper)
      const deltas = [];
      for (let j = 0; j < cands.length; j++) {
        const c = cands[j];
        if (c === vComm) {
          deltas.push({ comm: c, delta: 0 });
          continue;
        }
        const d = P.diffMove(v, c);
        deltas.push({ comm: c, delta: d });
        if (d > maxImprov) {
          maxImprov = d;
          maxComm = c;
        }
      }
      let moved = false;
      if (maxComm !== vComm) {
        totalImprov += maxImprov;
        P.moveNode(v, maxComm);
        moved = true;
        nbMoves += 1;
      }
      if (recordTrace) {
        traces.push({
          v: v, fromComm: vComm, toComm: maxComm,
          moved: moved, delta: moved ? maxImprov : 0,
          candidates: deltas,
        });
      }
    }
    return { totalImprov: totalImprov, nbMoves: nbMoves, traces: traces };
  }

  function phase1(graph, qualityFn, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const P = Partition(graph, null, qualityFn);
    const sweeps = [];
    let pass = 0;
    while (true) {
      const out = sweep(P, rng, { recordTrace: recordTrace });
      sweeps.push(out);
      pass += 1;
      if (out.nbMoves === 0 || pass > 50) break;
    }
    return { partition: P, sweeps: sweeps };
  }

  function run(graph, qualityFn, seed, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const rng = MT19937(seed >>> 0);
    const levels = [];
    let collapsedG = graph;
    let aggregateMap = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) aggregateMap[i] = i;
    let fineMembership = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) fineMembership[i] = i;
    let level = 0;
    while (true) {
      const prevVcount = collapsedG.vcount();
      const p1 = phase1(collapsedG, qualityFn, rng, { recordTrace: recordTrace });
      const collP = p1.partition;
      collP.renumber();
      const memColl = collP.membership();
      for (let v = 0; v < graph.vcount(); v++) {
        fineMembership[v] = memColl[aggregateMap[v]];
      }
      const collapsedNcomm = collP.ncomm();
      const newCollapsed = collapsedG.collapse(memColl, collapsedNcomm);
      const newAggregate = new Int32Array(graph.vcount());
      for (let v = 0; v < graph.vcount(); v++) {
        newAggregate[v] = memColl[aggregateMap[v]];
      }
      aggregateMap = newAggregate;
      levels.push({
        level: level,
        sweeps: p1.sweeps,
        collapsedVcountBefore: prevVcount,
        collapsedNcomm: collapsedNcomm,
        finePost: new Int32Array(fineMembership),
        newCollapsedVcount: newCollapsed.vcount(),
      });
      if (newCollapsed.vcount() >= prevVcount || newCollapsed.vcount() <= 1) break;
      collapsedG = newCollapsed;
      level += 1;
      if (level > 30) break;
    }
    const P = Partition(graph, fineMembership, qualityFn);
    P.renumber();
    return { partition: P, levels: levels, quality: P.quality() };
  }

  window.COMDET.LOUVAIN = {
    MT19937: MT19937,
    shuffle: shuffle,
    range: range,
    Graph: Graph,
    Partition: Partition,
    Modularity: Modularity,
    sweep: sweep,
    run: run,
  };
})();
