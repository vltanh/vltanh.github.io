/* Leiden kernel — faithful JS port of libleidenalg 0.12.0
 *
 * Source map (community-detection/libleidenalg/):
 *   src/Optimiser.cpp                     — outer driver, move_nodes, merge_nodes,
 *                                            move_nodes_constrained, merge_nodes_constrained
 *   src/MutableVertexPartition.cpp        — admin (csize, weights), move_node,
 *                                            from_coarse_partition, renumber
 *   src/GraphHelper.cpp                   — Graph wrapper + collapse_graph
 *                                            + Fisher-Yates shuffle + KL/KLL
 *   src/CPMVertexPartition.cpp            — CPM diff_move + quality
 *   src/ModularityVertexPartition.cpp     — Modularity diff_move + quality
 *
 * Default settings mirrored (Optimiser.cpp:18-24):
 *   consider_comms        = ALL_NEIGH_COMMS (=2)
 *   optimise_routine      = MOVE_NODES (=10)
 *   refine_routine        = MERGE_NODES (=11)
 *   refine_partition      = true
 *   consider_empty_community = true
 *   max_comm_size         = 0 (unlimited)
 *
 * RNG: MT19937 (mirrors igraph_rngtype_mt19937), Fisher-Yates direction
 * matches GraphHelper.cpp:35-41.
 */
(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};

  // ── MT19937 ─────────────────────────────────────────────────────
  // Standard Matsumoto-Nishimura 32-bit state machine; igraph's wrapper
  // uses MT19937 the same way. Bit-equivalent integer draws via rejection
  // sampling matching igraph_rng_get_integer's [lo, hi] inclusive contract.
  function MT19937(seed) {
    const N = 624;
    const mt = new Uint32Array(N);
    let mti = N + 1;
    function init(s) {
      mt[0] = s >>> 0;
      for (let i = 1; i < N; i++) {
        const t = (mt[i - 1] ^ (mt[i - 1] >>> 30)) >>> 0;
        // 1812433253 * t + i, modulo 2^32 via Math.imul split
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
      // [lo, hi] inclusive — igraph uses rejection sampling (see
      // igraph_rng_get_integer); same shape here.
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

  // Fisher-Yates per GraphHelper.cpp:35-41 (descending idx).
  function shuffle(arr, rng) {
    for (let idx = arr.length - 1; idx >= 1; idx--) {
      const j = rng.int(0, idx);
      const t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    }
  }

  function range(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    return a;
  }

  // ── Graph ────────────────────────────────────────────────────────
  // Simple undirected (currently). Edges: array of [u, v, weight?].
  // Node sizes default to 1; node self-weights default to 0.
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
    // Adjacency: per-node list of edge ids (undirected: present on both ends).
    const adjE = new Array(n);
    const adjN = new Array(n);
    for (let i = 0; i < n; i++) { adjE[i] = []; adjN[i] = []; }
    for (let e = 0; e < m; e++) {
      const u = eu[e], v = ev[e];
      adjE[u].push(e); adjN[u].push(v);
      if (u !== v) { adjE[v].push(e); adjN[v].push(u); }
    }
    const nodeSelfWeights = new Float64Array(n);
    for (let e = 0; e < m; e++) {
      if (eu[e] === ev[e]) nodeSelfWeights[eu[e]] += ew[e];
    }
    // Strength = sum of incident weights (self-loop counted once).
    const strength = new Float64Array(n);
    for (let e = 0; e < m; e++) {
      strength[eu[e]] += ew[e];
      if (eu[e] !== ev[e]) strength[ev[e]] += ew[e];
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
        // Graph::possible_edges (GraphHelper.cpp:323): n*(n-1)/2 undirected,
        // n*n directed; +n if correct_self_loops.
        let p = directed ? sz * sz : (sz * (sz - 1)) / 2;
        if (correctSelfLoops) p += sz;
        return p;
      },
      // Aggregation. Mirrors Graph::collapse_graph (GraphHelper.cpp:703-785).
      // Returns { graph, nodeSizes }.
      collapse: function (membership, ncomm) {
        // For each pair (a,b), accumulate weight; self-loops handled per
        // canonical (halved on undirected).
        const wmap = new Map(); // key = a*ncomm+b (a<=b for undirected)
        for (let e = 0; e < m; e++) {
          const a = membership[eu[e]];
          const b = membership[ev[e]];
          let w = ew[e];
          if (eu[e] === ev[e] && !directed) w *= 0.5;
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
        return new Graph(ncomm, newEdges, {
          directed: directed,
          correctSelfLoops: correctSelfLoops,
          nodeSizes: newSizes,
        });
      },
    };
  }

  // ── MutableVertexPartition (base admin) ──────────────────────────
  function Partition(graph, init, qualityFn) {
    const n = graph.vcount();
    let membership = new Int32Array(n);
    if (init) for (let i = 0; i < n; i++) membership[i] = init[i] | 0;
    else for (let i = 0; i < n; i++) membership[i] = i;
    let ncomm = 0;
    for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
    let csize = new Float64Array(ncomm);     // sum of node_size in comm
    let cnodes = new Int32Array(ncomm);      // node count
    let totalWeightInComm = new Float64Array(ncomm);
    let totalWeightToComm = new Float64Array(ncomm);
    let totalWeightFromComm = new Float64Array(ncomm);
    let totalPossibleEdgesInAllComms = 0;
    let totalWeightInAllComms = 0;
    const empties = []; // queue of empty community ids

    function rebuildAdmin() {
      ncomm = 0;
      for (let i = 0; i < n; i++) if (membership[i] + 1 > ncomm) ncomm = membership[i] + 1;
      csize = new Float64Array(ncomm);
      cnodes = new Int32Array(ncomm);
      totalWeightInComm = new Float64Array(ncomm);
      totalWeightToComm = new Float64Array(ncomm);
      totalWeightFromComm = new Float64Array(ncomm);
      for (let v = 0; v < n; v++) {
        csize[membership[v]] += graph.nodeSize(v);
        cnodes[membership[v]] += 1;
      }
      // Sum edge weights per (membership[u], membership[v]).
      const m = graph.ecount();
      const directed = graph.isDirected();
      for (let e = 0; e < m; e++) {
        const uv = graph.edge(e);
        const u = uv[0], v = uv[1];
        const cu = membership[u], cv = membership[v];
        const w = graph.edgeWeight(e);
        if (cu === cv) {
          totalWeightInComm[cu] += w;
        }
        // To-comm / from-comm: directed sees direction; undirected counts both.
        if (directed) {
          totalWeightFromComm[cu] += w;
          totalWeightToComm[cv] += w;
        } else {
          totalWeightFromComm[cu] += w;
          totalWeightToComm[cv] += w;
          if (cu !== cv) {
            totalWeightFromComm[cv] += w;
            totalWeightToComm[cu] += w;
          }
        }
      }
      totalPossibleEdgesInAllComms = 0;
      totalWeightInAllComms = 0;
      empties.length = 0;
      for (let c = 0; c < ncomm; c++) {
        totalWeightInAllComms += totalWeightInComm[c];
        totalPossibleEdgesInAllComms += graph.possibleEdges(csize[c]);
        if (cnodes[c] === 0) empties.push(c);
      }
    }
    rebuildAdmin();

    function moveNode(v, target) {
      const old = membership[v];
      if (old === target) return;
      // Need to update totalWeightInComm/from/to admin per-edge.
      const directed = graph.isDirected();
      const adjE = graph.neighbourEdges(v);
      const adjN = graph.neighbours(v);
      const sw = graph.nodeSelfWeight(v);
      // Subtract self-loop contribution from old (re-add to new).
      // canonical: see MutableVertexPartition::move_node (MVP.cpp:540-740).
      // We accumulate per-edge contribution and adjust admin.
      for (let i = 0; i < adjE.length; i++) {
        const e = adjE[i];
        const uv = graph.edge(e);
        const other = (uv[0] === v) ? uv[1] : uv[0];
        const w = graph.edgeWeight(e);
        const cother = membership[other];
        // Self-loops shouldn't double-count; canonical halves them on undirected.
        if (other === v) {
          // self-loop: removed from old's in-weight, added to new's
          const wEff = directed ? w : w; // canonical splits via correctSelfLoops; we keep simple
          totalWeightInComm[old] -= wEff;
          totalWeightFromComm[old] -= wEff;
          totalWeightToComm[old] -= wEff;
          continue;
        }
        // edge u-other, where u currently in `old`.
        if (directed) {
          // undirected branch: skip
          if (uv[0] === v) {
            // outgoing: w from old→cother
            totalWeightFromComm[old] -= w;
            totalWeightToComm[cother] -= w;
            if (cother === old) totalWeightInComm[old] -= w;
          } else {
            totalWeightToComm[old] -= w;
            totalWeightFromComm[cother] -= w;
            if (cother === old) totalWeightInComm[old] -= w;
          }
        } else {
          // undirected: each edge contributes to both endpoints' admin.
          totalWeightFromComm[old] -= w;
          totalWeightToComm[old] -= w;
          if (cother === old) {
            totalWeightInComm[old] -= w;
            // also the symmetric admin on cother (= old) is subtracted same way
            totalWeightFromComm[cother] -= w;
            totalWeightToComm[cother] -= w;
          } else {
            totalWeightFromComm[cother] -= w;
            totalWeightToComm[cother] -= w;
          }
        }
      }
      // Update csize / cnodes
      csize[old] -= graph.nodeSize(v);
      cnodes[old] -= 1;
      // Possible-edges admin (used by Surprise; recompute incrementally).
      totalPossibleEdgesInAllComms -= graph.possibleEdges(csize[old] + graph.nodeSize(v));
      totalPossibleEdgesInAllComms += graph.possibleEdges(csize[old]);
      // Move membership.
      membership[v] = target;
      // Grow arrays if target >= ncomm.
      if (target >= ncomm) {
        const newN = target + 1;
        csize = grow(csize, newN);
        cnodes = grow(cnodes, newN);
        totalWeightInComm = grow(totalWeightInComm, newN);
        totalWeightToComm = grow(totalWeightToComm, newN);
        totalWeightFromComm = grow(totalWeightFromComm, newN);
        totalPossibleEdgesInAllComms += graph.possibleEdges(0) * (newN - ncomm);
        ncomm = newN;
      }
      totalPossibleEdgesInAllComms -= graph.possibleEdges(csize[target]);
      csize[target] += graph.nodeSize(v);
      cnodes[target] += 1;
      totalPossibleEdgesInAllComms += graph.possibleEdges(csize[target]);
      // Re-add edge contributions for the new community.
      for (let i = 0; i < adjE.length; i++) {
        const e = adjE[i];
        const uv = graph.edge(e);
        const other = (uv[0] === v) ? uv[1] : uv[0];
        const w = graph.edgeWeight(e);
        const cother = membership[other];
        if (other === v) {
          totalWeightInComm[target] += w;
          totalWeightFromComm[target] += w;
          totalWeightToComm[target] += w;
          continue;
        }
        if (directed) {
          if (uv[0] === v) {
            totalWeightFromComm[target] += w;
            totalWeightToComm[cother] += w;
            if (cother === target) totalWeightInComm[target] += w;
          } else {
            totalWeightToComm[target] += w;
            totalWeightFromComm[cother] += w;
            if (cother === target) totalWeightInComm[target] += w;
          }
        } else {
          totalWeightFromComm[target] += w;
          totalWeightToComm[target] += w;
          if (cother === target) {
            totalWeightInComm[target] += w;
            totalWeightFromComm[cother] += w;
            totalWeightToComm[cother] += w;
          } else {
            totalWeightFromComm[cother] += w;
            totalWeightToComm[cother] += w;
          }
        }
      }
      // Track empties.
      if (cnodes[old] === 0 && empties.indexOf(old) < 0) empties.push(old);
      const idx = empties.indexOf(target);
      if (idx >= 0) empties.splice(idx, 1);
      // Recompute totalWeightInAllComms (cheap enough for our N).
      totalWeightInAllComms = 0;
      for (let c = 0; c < ncomm; c++) totalWeightInAllComms += totalWeightInComm[c];
    }

    function grow(typedArr, newN) {
      const out = (typedArr instanceof Float64Array) ? new Float64Array(newN)
              : (typedArr instanceof Int32Array) ? new Int32Array(newN)
              : new Array(newN).fill(0);
      for (let i = 0; i < typedArr.length; i++) out[i] = typedArr[i];
      return out;
    }

    function getEmptyCommunity() {
      if (empties.length > 0) return empties[0];
      // Add new empty community.
      const newId = ncomm;
      csize = grow(csize, newId + 1);
      cnodes = grow(cnodes, newId + 1);
      totalWeightInComm = grow(totalWeightInComm, newId + 1);
      totalWeightToComm = grow(totalWeightToComm, newId + 1);
      totalWeightFromComm = grow(totalWeightFromComm, newId + 1);
      ncomm += 1;
      empties.push(newId);
      totalPossibleEdgesInAllComms += graph.possibleEdges(0);
      return newId;
    }

    // weight_to_comm — sum of edge weights from neighbours in `comm` to v.
    // (canonical lazy-cache; we recompute for simplicity since N is small.)
    function weightToComm(v, comm) {
      let s = 0;
      const adjE = graph.neighbourEdges(v);
      for (let i = 0; i < adjE.length; i++) {
        const e = adjE[i];
        const uv = graph.edge(e);
        const other = (uv[0] === v) ? uv[1] : uv[0];
        if (other === v) continue; // self-loops handled by node_self_weight
        if (membership[other] === comm) s += graph.edgeWeight(e);
      }
      return s;
    }
    function weightFromComm(v, comm) {
      // Undirected: same as weightToComm.
      if (!graph.isDirected()) return weightToComm(v, comm);
      let s = 0;
      const adjE = graph.neighbourEdges(v);
      for (let i = 0; i < adjE.length; i++) {
        const e = adjE[i];
        const uv = graph.edge(e);
        if (uv[1] === v && uv[0] !== v && membership[uv[0]] === comm) {
          s += graph.edgeWeight(e);
        }
      }
      return s;
    }

    // Distinct neighbour communities of v (excludes v's own iff caller wants).
    function getNeighComms(v) {
      const adjN = graph.neighbours(v);
      const seen = new Set();
      for (let i = 0; i < adjN.length; i++) {
        if (adjN[i] === v) continue;
        seen.add(membership[adjN[i]]);
      }
      return Array.from(seen);
    }

    // Constrained variant: only neighbours sharing v's constrained community.
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
      // Sort by descending csize; remap membership.
      const order = [];
      for (let c = 0; c < ncomm; c++) if (cnodes[c] > 0) order.push(c);
      order.sort(function (a, b) { return csize[b] - csize[a]; });
      const remap = new Int32Array(ncomm);
      for (let i = 0; i < order.length; i++) remap[order[i]] = i;
      for (let v = 0; v < n; v++) membership[v] = remap[membership[v]];
      rebuildAdmin();
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
      qualityName: qualityFn.name,
      qualityFn: qualityFn,
      // Iteration over communities (for collapse).
      communityList: function () {
        const out = [];
        for (let c = 0; c < ncomm; c++) if (cnodes[c] > 0) out.push(c);
        return out;
      },
      // Coarse-from-fine: rebuild membership[v] = coarse_membership[fine_to_super[v]]
      fromCoarsePartition: function (coarse, mapping) {
        for (let v = 0; v < n; v++) membership[v] = coarse[mapping[v]];
        rebuildAdmin();
      },
      // Set membership directly (rare).
      setMembership: function (m) {
        for (let i = 0; i < n; i++) membership[i] = m[i] | 0;
        rebuildAdmin();
      },
    };
  }

  // ── Quality functions ────────────────────────────────────────────
  // CPMVertexPartition::diff_move (CPMVertexPartition.cpp:41-110).
  function CPM(resolution) {
    return {
      name: "CPM",
      resolution: resolution,
      // diff_move: H' - H where H = -sum_c (e_c - γ * (n_c choose 2))
      diffMove: function (P, v, newComm) {
        const oldComm = P.memberOf(v);
        if (oldComm === newComm) return 0;
        const G = P.graph;
        const wToOld = P.weightToComm(v, oldComm);
        const wToNew = P.weightToComm(v, newComm);
        const wFromOld = P.weightFromComm(v, oldComm);
        const wFromNew = P.weightFromComm(v, newComm);
        const sw = G.nodeSelfWeight(v);
        const nv = G.nodeSize(v);
        const csizeOld = P.csize(oldComm);
        const csizeNew = P.csize(newComm);
        const correctSelfLoops = G.correctSelfLoops();
        // From canonical CPMVertexPartition.cpp:
        //   diff = (w_to_new + w_from_new + sw)
        //        - γ * nv * (2*csize_new + nv - (correct?1:0))
        //        - (w_to_old + w_from_old + sw)
        //        + γ * nv * (2*(csize_old - nv) + nv - (correct?1:0))
        // For undirected graphs canonical sums w_to + w_from then halves;
        // here we follow the same form (w_from = w_to undirected).
        const directed = G.isDirected();
        const oldEdges = directed ? (wToOld + wFromOld) : 2 * wToOld;
        const newEdges = directed ? (wToNew + wFromNew) : 2 * wToNew;
        const selfTerm = correctSelfLoops ? 1 : 0;
        const possNew = nv * (2 * csizeNew + nv - selfTerm);
        const possOldDelta = nv * (2 * (csizeOld - nv) + nv - selfTerm);
        const diff = (newEdges + sw) - (oldEdges + sw)
                   - this.resolution * (possNew - possOldDelta);
        // canonical halves on undirected to count edge once
        return directed ? diff : diff / 2.0;
      },
      quality: function (P) {
        // H = sum_c [e_c - γ * (n_c choose 2)] (canonical writes this with sign
        // such that maximisation matches Leiden direction)
        let q = 0;
        const G = P.graph;
        const correctSelfLoops = G.correctSelfLoops();
        for (let c = 0; c < P.ncomm(); c++) {
          if (P.cnodes(c) === 0) continue;
          const ec = P.totalWeightInComm(c);
          const nc = P.csize(c);
          const selfTerm = correctSelfLoops ? 1 : 0;
          const poss = nc * (nc - selfTerm) / 2.0;
          q += ec - this.resolution * poss;
        }
        return q;
      },
    };
  }

  // ModularityVertexPartition::diff_move (ModularityVertexPartition.cpp:35-128).
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
        const sw = G.nodeSelfWeight(v);
        // Canonical: diff_old = (w_to_old - kv * K_old / W); same for new.
        const Kold = P.totalWeightFromComm(oldComm); // proxy (undirected)
        const Knew = P.totalWeightFromComm(newComm);
        const diffOld = wToOld - kv * (Kold - kv) / W;
        const diffNew = wToNew - kv * Knew / W;
        const diff = (diffNew - diffOld) * (G.isDirected() ? 1 : 2);
        return diff / W;
      },
      quality: function (P) {
        // Q = (1/W) * sum_c [e_c - K_c^2 / W]  (undirected; W = 2m)
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

  // ── Optimiser ────────────────────────────────────────────────────
  // Faithful to Optimiser.cpp default flow: move_nodes for outer local
  // sweep, merge_nodes_constrained for refinement, collapse → repeat.

  // move_nodes (7-arg) — single layer, ALL_NEIGH_COMMS, with empty-community
  // option. Returns { totalImprov, traces } where traces is an array of
  // per-visit records (for the walker).
  function moveNodes(P, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const considerEmpty = opts.considerEmpty !== false;
    const n = P.n();
    const order = [];
    for (let v = 0; v < n; v++) order.push(v);
    shuffle(order, rng);
    const queue = order.slice(); // deque
    const isStable = new Uint8Array(n);
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    while (queue.length > 0) {
      const v = queue.shift();
      const vComm = P.memberOf(v);
      // Candidate communities = neighbour comms ∪ vComm (canonical includes
      // current via the maxImprov starting at vComm).
      const cands = P.getNeighComms(v);
      if (cands.indexOf(vComm) < 0) cands.push(vComm);
      if (considerEmpty && P.cnodes(vComm) > 1) {
        const ec = P.getEmptyCommunity();
        if (cands.indexOf(ec) < 0) cands.push(ec);
      }
      let maxComm = vComm;
      let maxImprov = 10 * Number.EPSILON; // canonical: positive required
      const deltas = [];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
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
      isStable[v] = 1;
      let moved = false;
      if (maxComm !== vComm) {
        totalImprov += maxImprov;
        P.moveNode(v, maxComm);
        moved = true;
        nbMoves += 1;
        // Re-queue stable neighbours not in maxComm.
        const adjN = P.graph.neighbours(v);
        for (let j = 0; j < adjN.length; j++) {
          const u = adjN[j];
          if (u === v) continue;
          if (isStable[u] && P.memberOf(u) !== maxComm) {
            queue.push(u);
            isStable[u] = 0;
          }
        }
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

  // merge_nodes_constrained — refinement (only on singleton comms within a
  // refined comm; ties accepted via >=). Mirrors Optimiser.cpp:1230-1437.
  function mergeNodesConstrained(P, constrained, rng, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const n = P.n();
    const order = [];
    for (let v = 0; v < n; v++) order.push(v);
    shuffle(order, rng);
    let totalImprov = 0;
    let nbMoves = 0;
    const traces = [];
    for (let i = 0; i < n; i++) {
      const v = order[i];
      const vComm = P.memberOf(v);
      // Only act on singletons (canonical: cnodes(vComm) == 1).
      if (P.cnodes(vComm) !== 1) continue;
      const cands = P.getNeighCommsConstrained(v, constrained);
      if (cands.indexOf(vComm) < 0) cands.push(vComm);
      let maxComm = vComm;
      let maxImprov = 0; // canonical: 0, ties accepted (>=)
      const deltas = [];
      for (let j = 0; j < cands.length; j++) {
        const c = cands[j];
        if (c === vComm) {
          deltas.push({ comm: c, delta: 0 });
          continue;
        }
        const d = P.diffMove(v, c);
        deltas.push({ comm: c, delta: d });
        if (d >= maxImprov) {
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

  // optimise_partition — driver: move + refine + aggregate, repeat until
  // collapsed graph stops shrinking. Mirrors Optimiser.cpp:77-369 default path.
  function optimisePartition(graph, qualityFn, seed, opts) {
    opts = opts || {};
    const recordTrace = !!opts.recordTrace;
    const refinePartition = opts.refinePartition !== false;
    const rng = MT19937(seed >>> 0);
    let P = Partition(graph, null, qualityFn);
    const levels = []; // per-level snapshots for the walker
    let level = 0;
    let aggregateFurther = true;
    let collapsedGraph = graph;
    let collapsedP = P;
    // Track fine-to-coarse mapping per level (so we can project back).
    let aggregateNodePerFine = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) aggregateNodePerFine[i] = i;
    // The "fine" partition mirrors collapsedP's membership but on original nodes.
    let fineMembership = new Int32Array(graph.vcount());
    for (let i = 0; i < graph.vcount(); i++) fineMembership[i] = collapsedP.memberOf(i);

    while (aggregateFurther) {
      const prevVcount = collapsedGraph.vcount();
      // 5.1.1 Local move on collapsed graph.
      const moveOut = moveNodes(collapsedP, rng, {
        recordTrace: recordTrace,
        considerEmpty: true,
      });
      // 5.1.2 Project collapsed result down to fine.
      // fineMembership[v] = collapsedP.memberOf(aggregateNodePerFine[v])
      const memColl = collapsedP.membership();
      for (let v = 0; v < graph.vcount(); v++) {
        fineMembership[v] = memColl[aggregateNodePerFine[v]];
      }
      // 5.1.3 Refinement (default true): start sub_collapsed at singletons.
      let subCollapsedP = null;
      let refineOut = null;
      if (refinePartition) {
        const initSing = new Int32Array(collapsedGraph.vcount());
        for (let i = 0; i < collapsedGraph.vcount(); i++) initSing[i] = i;
        subCollapsedP = Partition(collapsedGraph, initSing, qualityFn);
        // Refinement constrained to collapsedP's communities.
        const constr = collapsedP.membership();
        refineOut = mergeNodesConstrained(subCollapsedP, constr, rng, {
          recordTrace: recordTrace,
        });
      }
      // 5.1.4 Aggregation:
      //   New super-graph from sub_collapsed_partitions (or collapsed if no refine).
      //   But: new_collapsed_membership tracks the ORIGINAL comm-id (collapsedP),
      //   not refined sub-comm-id. Mapping: for each refined super-node ξ in
      //   sub_collapsed, take any constituent fine node u, set
      //   new_collapsed_membership[ξ] = collapsedP.memberOf(u).
      const refinedP = refinePartition ? subCollapsedP : collapsedP;
      // Renumber refinedP to consecutive ids.
      refinedP.renumber();
      const refinedNcomm = refinedP.ncomm();
      const newCollapsed = collapsedGraph.collapse(
        refinedP.membership(),
        refinedNcomm
      );
      // Compute new_collapsed_membership: for each refined super-node ξ,
      // pick any node in ξ → collapsedP.memberOf(node) as the seed comm.
      // (When refine_partition=false, sub == coll, so this is identity.)
      const newCollapsedMembership = new Int32Array(refinedNcomm);
      const seenSuper = new Uint8Array(refinedNcomm);
      const refMem = refinedP.membership();
      const collMem = collapsedP.membership();
      for (let u = 0; u < collapsedGraph.vcount(); u++) {
        const xi = refMem[u];
        if (!seenSuper[xi]) {
          newCollapsedMembership[xi] = collMem[u];
          seenSuper[xi] = 1;
        }
      }
      // Update fine-to-super mapping: aggregateNodePerFine[v] = refMem[aggregateNodePerFine_old[v]]
      const newAggregate = new Int32Array(graph.vcount());
      for (let v = 0; v < graph.vcount(); v++) {
        newAggregate[v] = refMem[aggregateNodePerFine[v]];
      }
      aggregateNodePerFine = newAggregate;
      // Build new collapsedP.
      const newCollapsedP = Partition(newCollapsed, newCollapsedMembership, qualityFn);
      // Snapshot for walker.
      // fineMembership at this point reflects post-move (pre-refine) on the
      // original graph; record both pre + post.
      const finePostMove = new Int32Array(fineMembership);
      // Project refined down to fine (refMem on collapsed → fine).
      const finePostRefine = new Int32Array(graph.vcount());
      for (let v = 0; v < graph.vcount(); v++) {
        finePostRefine[v] = refMem[collMem[aggregateNodePerFine_at_level_start(v, level, levels)]];
      }
      // Simpler: project via collapsed membership before re-aggregation.
      for (let v = 0; v < graph.vcount(); v++) {
        // The pre-aggregation finest mapping was the OLD aggregateNodePerFine.
        // We already overwrote it — use newAggregate (which == refMem ∘ old).
        finePostRefine[v] = newAggregate[v];
      }
      levels.push({
        level: level,
        collapsedVcount: prevVcount,
        moveTraces: moveOut.traces,
        moveImprov: moveOut.totalImprov,
        moveCount: moveOut.nbMoves,
        refineTraces: refineOut ? refineOut.traces : [],
        refineImprov: refineOut ? refineOut.totalImprov : 0,
        refineCount: refineOut ? refineOut.nbMoves : 0,
        finePostMove: finePostMove,
        finePostRefine: finePostRefine,
        newCollapsedVcount: newCollapsed.vcount(),
      });
      // 5.1.5 Termination check.
      aggregateFurther = (newCollapsed.vcount() < prevVcount)
                      && (prevVcount > collapsedP.ncomm());
      collapsedGraph = newCollapsed;
      collapsedP = newCollapsedP;
      level += 1;
    }
    // Final renumber on the projected fine partition.
    P.setMembership(fineMembership);
    P.renumber();
    return {
      partition: P,
      levels: levels,
      quality: P.quality(),
    };
  }

  // Helper used above (no-op fallback; the in-place projection works).
  function aggregateNodePerFine_at_level_start(v, lvl, levels) { return v; }

  // ── Public API ───────────────────────────────────────────────────
  window.COMDET.LEIDEN = {
    MT19937: MT19937,
    shuffle: shuffle,
    range: range,
    Graph: Graph,
    Partition: Partition,
    CPM: CPM,
    Modularity: Modularity,
    moveNodes: moveNodes,
    mergeNodesConstrained: mergeNodesConstrained,
    optimisePartition: optimisePartition,
    // Convenience: run on COMDET.FIXTURE with given quality + seed.
    runFixture: function (quality, seed) {
      const F = window.COMDET.FIXTURE;
      const G = Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
      return optimisePartition(G, quality, seed >>> 0, { recordTrace: true });
    },
  };
})();
