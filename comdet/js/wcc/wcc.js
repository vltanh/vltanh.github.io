/* WCC kernel: well-connectedness post-proc (Park 2025 / Vu-Le 2026).
 *
 * Faithful port of constrained_clustering MincutOnly with a non-zero
 * connectedness criterion (mincut_only.cpp:42-96 + the MinCutWorker
 * branch in mincut_only.h:39-132). Default threshold is log10(n) where
 * n is the *cluster* size, not the graph size; this mirrors the
 * IsWellConnected formula at constrained.h:427-471.
 *
 * Pipeline:
 *   1. RemoveInterClusterEdges + GetConnectedComponents on the input.
 *   2. Push each component (size > 1) onto the to-be-mincut queue.
 *   3. Pop clusters one at a time:
 *      a. ComputeMinCut on the induced subgraph.
 *      b. If cut > threshold(n_cluster) -> well-connected, emit.
 *      c. Else: split into in/out, run GetConnectedComponents on each
 *         side (per mincut_only.h:98-122), push every size>1 component
 *         back onto the queue.
 *   4. Continue until queue is empty.
 *
 * Threshold parser matches constrained.cpp:201-249:
 *   "0"            -> Simple branch (= CC; no recursion).
 *   "<C>log_<x>(n)" e.g. "1log_10(n)"  -> Logarithmic.
 *   "<C>n^<x>"     e.g. "0.2n^0.5"     -> Exponential.
 *   "piecewise"    -> bands at constrained.h:451-462.
 *
 * Output: { events, finalAssign, numClusters }. Each event records one
 * pop from the queue: the cluster pulled, its mincut result, the
 * threshold + verdict, and either the kept-cluster id (if well
 * connected) or the post-split components pushed back. Walker steps
 * over events 1:1.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  function bfsComponentsLocal(nodeIds, edges) {
    const n = nodeIds.length;
    if (n === 0) return [];
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    edges.forEach(function (e) {
      const u = idx.get(e[0]); const v = idx.get(e[1]);
      if (u == null || v == null || u === v) return;
      adj[u].push(v); adj[v].push(u);
    });
    const seen = new Uint8Array(n);
    const comps = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      seen[s] = 1;
      const queue = [s]; let head = 0;
      const comp = [];
      while (head < queue.length) {
        const u = queue[head++];
        comp.push(nodeIds[u]);
        const neigh = adj[u];
        for (let k = 0; k < neigh.length; k++) {
          const w = neigh[k];
          if (seen[w]) continue;
          seen[w] = 1; queue.push(w);
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  // Returns { kind, c, x, customString } where kind ∈
  // { "simple", "logarithmic", "exponential", "custom" }.
  function parseCriterion(spec) {
    spec = String(spec || "").trim();
    if (spec === "0") return { kind: "simple" };
    let m = spec.match(/^([0-9.]+)log_([0-9.]+)\(n\)$/);
    if (m) {
      const c = parseFloat(m[1]);
      const x = parseFloat(m[2]);
      // [UPSTREAM constrained.cpp:235] preLog = c / log(x) is precomputed
      // ONCE at startup; per-call threshold uses preLog * log(n) (one log,
      // one mul). The naive `c * log(n) / log(x)` (two logs, one mul, one
      // div) introduces rounding-order divergence vs canonical -- audit row
      // E. JS mirrors canonical's evaluation order via this preLog field.
      return { kind: "logarithmic", c: c, x: x, preLog: c / Math.log(x) };
    }
    m = spec.match(/^([0-9.]+)n\^([0-9.]+)$/);
    if (m) return { kind: "exponential", c: parseFloat(m[1]), x: parseFloat(m[2]) };
    if (spec === "piecewise") return { kind: "custom", customString: "piecewise" };
    return { kind: "custom", customString: spec };
  }

  function threshold(parsed, nCluster) {
    if (parsed.kind === "simple") return 0;
    if (parsed.kind === "logarithmic") {
      return parsed.preLog * Math.log(nCluster);
    }
    if (parsed.kind === "exponential") {
      return parsed.c * Math.pow(nCluster, parsed.x);
    }
    if (parsed.kind === "custom" && parsed.customString === "piecewise") {
      if (nCluster < 100) return 1;
      if (nCluster <= 500) return 2;
      if (nCluster <= 999) return 3;
      return Math.ceil(0.1 * Math.sqrt(nCluster));
    }
    return Infinity;
  }

  function isWellConnected(parsed, nCluster, cut) {
    if (parsed.kind === "simple") return cut >= 1;
    const t = threshold(parsed, nCluster);
    if (parsed.kind === "logarithmic") {
      const isClose = Math.abs(t - cut) <= 1e-9;
      return !isClose && t < cut;
    }
    if (parsed.kind === "exponential") {
      return t < cut;
    }
    if (parsed.kind === "custom" && parsed.customString === "piecewise") {
      return cut >= t;
    }
    return false;
  }

  function runWCC(membership, opts) {
    opts = opts || {};
    const F = opts.fixture || C.FIXTURE;
    const criterion = opts.criterion || "1log_10(n)";
    const parsed = parseCriterion(criterion);
    // Default backend prefers VieCut cactus mincut when available
    // (matches canonical constrained_clustering binary). Falls back to
    // Stoer-Wagner standin when only mincut.js is loaded.
    const mincutFn = opts.mincutFn
      || (C.MINCUT && (C.MINCUT.viecut || C.MINCUT.stoerWagner));
    if (!mincutFn) throw new Error("WCC: no mincut backend (load mincut.js first)");
    const trace = opts.trace ? [] : null;
    function tlog(line) { if (trace) trace.push(line); }
    // Replay-mode: caller supplies an oracle that returns the canonical
    // bipartition for a given cluster's nodeset (keyed by sorted node-id
    // string). When set, the JS kernel skips Stoer-Wagner and reads the
    // bipartition + cut value directly from the oracle. Used by the
    // tools/viz_check/wcc kernel cross-check.
    const cutOracle = opts.cutOracle || null;

    const nodeIdToIdx = new Map();
    F.nodes.forEach(function (id, i) { nodeIdToIdx.set(id, i); });

    // Stage 1: residual-graph CC (matches the binary at mincut_only.cpp:35-40).
    // RemoveInterClusterEdges keeps only intra-cluster edges; we then
    // run BFS over the whole residual graph in node-id order so the
    // initial queue is in the same order as igraph_connected_components.
    const intraEdges = [];
    for (let e = 0; e < F.edges.length; e++) {
      const a = F.edges[e][0], b = F.edges[e][1];
      const ca = membership[nodeIdToIdx.get(a)];
      const cb = membership[nodeIdToIdx.get(b)];
      if (ca === cb) intraEdges.push([a, b]);
    }
    const allComps = bfsComponentsLocal(F.nodes.slice(), intraEdges);
    tlog("STAGE_CC residual_edges=" + intraEdges.length + " components=" + allComps.length);
    allComps.forEach(function (c, i) {
      tlog("  comp[" + i + "] size=" + c.length + " nodes=" + c.slice(0, 12).join(",") + (c.length > 12 ? ",..." : ""));
    });

    // Per-input-cluster CC view for the walker UX.
    const buckets = new Map();
    F.nodes.forEach(function (id, i) {
      const c = membership[i];
      let arr = buckets.get(c);
      if (!arr) { arr = []; buckets.set(c, arr); }
      arr.push(id);
    });
    const initEvents = [];
    const cIds = Array.from(buckets.keys()).sort(function (a, b) { return a - b; });
    cIds.forEach(function (cid) {
      const ns = buckets.get(cid);
      const nsSet = new Set(ns);
      const compsForCid = allComps.filter(function (c) { return nsSet.has(c[0]); });
      initEvents.push({ clusterIn: cid, nodes: ns.slice(), components: compsForCid });
    });

    // Stage 2: single shared queue, mirroring the binary's worker
    // (mincut_only.h:39-132 + the round loop in mincut_only.cpp:51-95).
    // Single-threaded interpretation: keep popping from to_be_mincut
    // until empty. Each pop runs Stoer-Wagner; well-connected clusters
    // land on done_being_mincut in pop order; non-well-connected ones
    // get the connected components of each side pushed back in
    // (in-side first, then out-side).
    const queue = allComps.filter(function (c) { return c.length > 1; }).map(function (c) { return c.slice(); });
    tlog("STAGE_QUEUE init_size=" + queue.length);
    const carveEvents = [];
    const survivors = [];
    let safety = 0;
    let popIdx = 0;
    while (queue.length > 0) {
      if (safety++ > 50000) throw new Error("WCC: queue cap exceeded");
      const cur = queue.shift();
      const nSet = new Set(cur);
      const sub = [];
      for (let e = 0; e < intraEdges.length; e++) {
        const a = intraEdges[e][0], b = intraEdges[e][1];
        if (nSet.has(a) && nSet.has(b)) sub.push([a, b]);
      }
      const cutResult = cutOracle
        ? cutOracle(cur, sub)
        : mincutFn(cur.slice(), sub);
      const cutValue = cutResult.cutValue;
      const t = threshold(parsed, cur.length);
      const wellConn = isWellConnected(parsed, cur.length, cutValue);
      const ev = {
        cluster: cur.slice(),
        clusterSize: cur.length,
        cut: cutValue,
        threshold: t,
        wellConnected: wellConn,
        inPartition: cutResult.inPartition.slice(),
        outPartition: cutResult.outPartition.slice(),
        pushedBack: [],
      };
      tlog("POP " + popIdx + " n=" + cur.length + " cut=" + cutValue
         + " thr=" + t.toFixed(6) + " wc=" + wellConn
         + " in=" + cutResult.inPartition.length + " out=" + cutResult.outPartition.length);
      popIdx += 1;
      if (wellConn) {
        survivors.push(cur.slice());
        tlog("  KEEP nodes=" + cur.slice().sort(function(a,b){return a-b;}).slice(0,12).join(",") + (cur.length > 12 ? ",..." : ""));
      } else {
        // GetConnectedComponentsOnPartition (mincut_only.h:97-122):
        // induced subgraph on each side, BFS, push every size>1
        // component. Order: in-side components before out-side.
        if (cutResult.inPartition.length > 1) {
          const inComps = bfsComponentsLocal(cutResult.inPartition.slice(), sub);
          inComps.forEach(function (comp) {
            if (comp.length > 1) {
              queue.push(comp);
              ev.pushedBack.push(comp);
              tlog("  PUSH in size=" + comp.length);
            } else {
              tlog("  DROP in size=" + comp.length);
            }
          });
        }
        if (cutResult.outPartition.length > 1) {
          const outComps = bfsComponentsLocal(cutResult.outPartition.slice(), sub);
          outComps.forEach(function (comp) {
            if (comp.length > 1) {
              queue.push(comp);
              ev.pushedBack.push(comp);
              tlog("  PUSH out size=" + comp.length);
            } else {
              tlog("  DROP out size=" + comp.length);
            }
          });
        }
      }
      carveEvents.push(ev);
    }

    // Stage 3: relabel in survivor (= done-queue) order.
    const finalAssign = new Int32Array(F.nodes.length);
    for (let i = 0; i < finalAssign.length; i++) finalAssign[i] = -1;
    survivors.forEach(function (clust, outId) {
      clust.forEach(function (id) { finalAssign[nodeIdToIdx.get(id)] = outId; });
    });

    tlog("STAGE_DONE survivors=" + survivors.length + " total_pops=" + popIdx);
    return {
      criterion: criterion,
      parsed: parsed,
      cc: { events: initEvents, residualEdges: intraEdges, allComps: allComps },
      carve: { events: carveEvents },
      survivors: survivors,
      finalAssign: finalAssign,
      numClusters: survivors.length,
      trace: trace,
    };
  }

  C.WCC = {
    runWCC: runWCC,
    parseCriterion: parseCriterion,
    threshold: threshold,
    isWellConnected: isWellConnected,
    bfsComponents: bfsComponentsLocal,
  };
})();
