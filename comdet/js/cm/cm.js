/* CM kernel: Connectivity Modifier (Park 2024).
 *
 * Faithful port of constrained_clustering CM (cm.cpp + includes/cm.h).
 *
 * Mechanics differ from WCC: when a mincut is not well-connected, CM
 * does NOT split into the two cut halves and recurse. Instead, both
 * halves (each side > 1) are passed to a base algorithm (Leiden CPM /
 * Mod / Louvain) which re-clusters the half. The communities returned
 * by the base algo are then queued for the next mincut round. This is
 * the whole point of CM: rather than keeping the mincut bipartition,
 * the base algo decides how each cut half should be re-partitioned.
 *
 * Pipeline (cm.cpp:3-105):
 *   1. Bucket input membership; remove inter-cluster edges; take
 *      connected components. Each non-trivial component enters the
 *      to-be-mincut queue with a (possibly new) cluster id.
 *   2. Round loop:
 *      a. Drain to_be_mincut: for each cluster, ComputeMinCut on its
 *         induced subgraph; if well-connected, push to
 *         done_being_clustered with the inherited id.
 *      b. Else: for each side with size > 1, RunClusterOnPartition
 *         (= Leiden / Louvain on the induced subgraph), then
 *         RemoveInterClusterEdges + GetConnectedComponents. Push each
 *         component into to_be_clustered with the parent id.
 *   3. After draining: move to_be_clustered → to_be_mincut, assigning
 *      fresh consecutive ids and recording parent → child links.
 *   4. Terminate when to_be_clustered is empty after a round.
 *
 * `--prune` (cm.h:76-121) is intentionally not ported: cm/pipeline.sh
 * does not enable it (per audit_constrained_clustering_binary.md), so
 * the canonical deployment never sees it. Trivial 1-vs-(n-1) cuts
 * therefore go through the base-algo recluster branch as well.
 *
 * Defaults (matching cm/pipeline.sh):
 *   criterion = "0.2n^0.5"  (cm/pipeline.sh default; Park 2024 paper
 *                            uses 1log_10(n), set criterion explicitly
 *                            to mirror the paper).
 *   algorithm = "leiden-cpm"
 *   resolution = 0.0001 (the only base-algo knob shipped today).
 *
 * Output:
 *   {
 *     events: [
 *       { kind: "init",    initialQueue: [...]      } // stage-1 bucket result
 *       { kind: "mincut",  ... mincut + verdict ... }
 *       { kind: "recluster", ... base-algo split ...}
 *       { kind: "round-end", round, queueSize }
 *     ],
 *     survivors:    [[ids],...],       // final clusters
 *     finalAssign:  Int32Array,        // per fixture index, -1 = dropped
 *     numClusters:  int,
 *     parentToChild: { id: [childIds] } // CM history
 *   }
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  if (!C.WCC || !C.MINCUT || !C.LEIDEN || !C.COMMON || !C.LOUVAIN) return;

  function bfsComponents(nodeIds, edges) {
    return C.WCC.bfsComponents(nodeIds, edges);
  }

  // [P0-Gap6] parent_to_child deep clone for snapshot hook. Mirrors cpp
  // emit_ptc_snapshot's parent-id ASC iteration order so JS hook payload
  // can be bit-compared by self_rng_check.
  function cloneParentToChild(ptc) {
    // parentToChild uses numeric keys (incl. -1) coerced to strings via
    // object indexing. Sort numerically to mirror std::map<int,...> ASC.
    const keys = Object.keys(ptc).map(Number).sort(function (a, b) { return a - b; });
    const rows = [];
    keys.forEach(function (k) { rows.push({ parent: k, children: (ptc[k] || []).slice() }); });
    return rows;
  }

  // [P0-Gap2] cumulative RNG draw counters. Updated from upstream hooks
  // (__CM_HOOK_LD_BEGIN/END count callbacks set by self_rng_check). The
  // counters live on globalThis so the harness controls reset.

  function inducedEdges(nodes, edgesAll) {
    const set = new Set(nodes);
    const out = [];
    for (let e = 0; e < edgesAll.length; e++) {
      const a = edgesAll[e][0], b = edgesAll[e][1];
      if (set.has(a) && set.has(b)) out.push([a, b]);
    }
    return out;
  }

  // Run the base algorithm on a vertex set + its induced edges. Returns
  // the resulting partition as a list of clusters (each = [original ids]).
  // [UPSTREAM constrained.h:301-324, 359] RunLeidenAndUpdatePartition runs
  // `for (int i = 0; i < num_iter; i++) optimiser.optimise_partition(part);`
  // with num_iter = 2 (constrained.h:359). JS mirrors via two
  // optimisePartition calls; the 2nd call seeds membership from the 1st's
  // result via opts.initialMembership (canonical libleidenalg's iter 2
  // continues from iter 1's partition state).
  //
  // CAVEAT: canonical also continues the RNG state across iters (one
  // Optimiser instance, one RNG). JS re-seeds the RNG on each
  // optimisePartition call (new MT19937 from seed). This is a SANCTIONED
  // RNG-stream divergence; the canonical-tracer must mirror by re-seeding
  // before iter 2 to keep both sides aligned (see kernel_check.cpp).
  function runBaseAlgo(nodes, edges, algorithm, resolution, seed, hookCtx) {
    const n = nodes.length;
    if (n <= 1) return [nodes.slice()];
    const idx = new Map();
    nodes.forEach(function (id, i) { idx.set(id, i); });
    const compEdges = edges.map(function (e) {
      return [idx.get(e[0]), idx.get(e[1])];
    });
    // sortAdj:true mirrors libleidenalg's igraph_lazy_adjlist iteration
    // order (chain Leiden audit row H closure). Required for byte-equal
    // greedy pick under matching seed across nested optimise_partition.
    const G = C.COMMON.Graph(n, compEdges, { correctSelfLoops: false, sortAdj: true });
    // [UPSTREAM constrained.h:335-391] GetCommunities branches on algorithm:
    //   "leiden-cpm"  -> CPMVertexPartition(resolution)
    //   "leiden-mod"  -> ModularityVertexPartition (libleidenalg shape)
    //   "louvain"     -> Louvain's Modularity (Louvain wrapper; not in CM
    //                    deployment per pipeline.sh default).
    let qfn;
    if (algorithm === "leiden-cpm") qfn = C.LEIDEN.CPM(resolution);
    else if (algorithm === "leiden-mod") qfn = C.LEIDEN.LeidenMod();
    // LEIDEN.Modularity used to re-export LV.Modularity; after the
    // 2026-05-10 cross-algo isolation refactor it's reached via
    // C.LOUVAIN.Modularity (Louvain-shape) directly.
    else if (algorithm === "louvain") qfn = C.LOUVAIN.Modularity();
    else throw new Error("CM: unsupported algorithm '" + algorithm + "'");
    // [P0-Gap2 / P0-Gap9] LD_RESEED + LD_BEGIN/END hook (mirrors
    // [TRACE-CM] LD_RESEED probe in kernel_check.cpp). JS re-seeds the
    // MT19937 on every optimisePartition call; canonical-tracer does
    // the same (sanctioned divergence from unmodified canonical that
    // continues RNG state across iter1->iter2).
    if (typeof globalThis.__CM_HOOK_LD_RESEED === "function") {
      globalThis.__CM_HOOK_LD_RESEED({ ctx: hookCtx, iter: 1, seed: seed >>> 0 });
    }
    if (typeof globalThis.__CM_HOOK_LD_BEGIN === "function") {
      globalThis.__CM_HOOK_LD_BEGIN({ ctx: hookCtx, iter: 1, n: n });
    }
    // iter 1.
    let result = C.LEIDEN.optimisePartition(G, qfn, seed >>> 0);
    // [P0-Gap1] iter-1 membership snapshot.
    const iter1Mem = result.partition.membership();
    if (typeof globalThis.__CM_HOOK_LD_ITER_END === "function") {
      globalThis.__CM_HOOK_LD_ITER_END({
        ctx: hookCtx, iter: 1, mem: Array.from(iter1Mem),
        n_comm: result.partition.nCommunities ? result.partition.nCommunities() :
                (new Set(Array.from(iter1Mem))).size,
      });
    }
    if (typeof globalThis.__CM_HOOK_LD_END === "function") {
      globalThis.__CM_HOOK_LD_END({ ctx: hookCtx, iter: 1 });
    }
    // iter 2: same seed (RNG re-seeded), but starting partition =
    // iter 1's result. Mirrors canonical's `for i in [0,2)` chain.
    if (typeof globalThis.__CM_HOOK_LD_RESEED === "function") {
      globalThis.__CM_HOOK_LD_RESEED({ ctx: hookCtx, iter: 2, seed: seed >>> 0 });
    }
    if (typeof globalThis.__CM_HOOK_LD_BEGIN === "function") {
      globalThis.__CM_HOOK_LD_BEGIN({ ctx: hookCtx, iter: 2, n: n });
    }
    result = C.LEIDEN.optimisePartition(G, qfn, seed >>> 0, {
      initialMembership: iter1Mem,
    });
    const mem = result.partition.membership();
    if (typeof globalThis.__CM_HOOK_LD_ITER_END === "function") {
      globalThis.__CM_HOOK_LD_ITER_END({
        ctx: hookCtx, iter: 2, mem: Array.from(mem),
        n_comm: result.partition.nCommunities ? result.partition.nCommunities() :
                (new Set(Array.from(mem))).size,
      });
    }
    if (typeof globalThis.__CM_HOOK_LD_END === "function") {
      globalThis.__CM_HOOK_LD_END({ ctx: hookCtx, iter: 2 });
    }
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const c = mem[i];
      let arr = buckets.get(c);
      if (!arr) { arr = []; buckets.set(c, arr); }
      arr.push(nodes[i]);
    }
    return {
      clusters: Array.from(buckets.values()),
      // [P0-Gap1] iter1 membership returned for tracer-side mirror; the
      // pre-existing caller signature was `Array<Array<id>>` so legacy
      // callers fall back to `.clusters` via the wrapper below.
      iter1Membership: Array.from(iter1Mem),
      finalMembership: Array.from(mem),
    };
  }

  // Legacy-shape adapter that preserves the pre-P0 cluster-array signature
  // for callers that don't read iter1Membership (e.g. injected baseAlgoFn).
  function runBaseAlgoClusters(nodes, edges, algorithm, resolution, seed, hookCtx) {
    const r = runBaseAlgo(nodes, edges, algorithm, resolution, seed, hookCtx);
    // Preserve the old return shape (Array<Array<id>>) but attach the iter1
    // membership as a side property so __CM_HOOK_RECLUSTER can pick it up.
    const arr = r.clusters;
    arr.iter1Membership = r.iter1Membership;
    arr.finalMembership = r.finalMembership;
    return arr;
  }

  function runCM(membership, opts) {
    opts = opts || {};
    const F = opts.fixture || C.FIXTURE;
    const criterion = opts.criterion || "0.2n^0.5";
    const parsed = C.WCC.parseCriterion(criterion);
    const algorithm = opts.algorithm || "leiden-cpm";
    const resolution = opts.resolution != null ? opts.resolution : 0.0001;
    const seed = opts.seed != null ? (opts.seed >>> 0) : 0;
    // Default backend prefers VieCut cactus mincut when available
    // (matches canonical constrained_clustering binary). Falls back to
    // Stoer-Wagner standin when only mincut.js is loaded.
    const mincutFn = opts.mincutFn
      || (C.MINCUT && (C.MINCUT.viecut || C.MINCUT.stoerWagner));
    const baseAlgoFn = opts.baseAlgoFn || null; // optional injection
    // Replay-mode oracle: keyed by sorted-cluster-ids string, returns
    // { cutValue, inPartition, outPartition }. Used by tools/viz_check/cm
    // to feed canonical mincut bipartitions deterministically.
    const cutOracle = opts.cutOracle || null;

    const events = [];
    const nodeIdToIdx = new Map();
    F.nodes.forEach(function (id, i) { nodeIdToIdx.set(id, i); });

    // Stage 1: residual-graph CC + lineage id assignment per cm.cpp:25-57.
    // Build cluster_id_to_node_id_map (orig partition by cluster id),
    // build residual graph by RemoveInterClusterEdges, take connected
    // components in node-id BFS-root order.
    const clusterIdToNodes = new Map();
    F.nodes.forEach(function (id, i) {
      const c = membership[i];
      let arr = clusterIdToNodes.get(c);
      if (!arr) { arr = []; clusterIdToNodes.set(c, arr); }
      arr.push(id);
    });
    let nextId = 0;
    clusterIdToNodes.forEach(function (_, cid) {
      if (cid + 1 > nextId) nextId = cid + 1;
    });

    const intraEdgesAll = [];
    for (let e = 0; e < F.edges.length; e++) {
      const a = F.edges[e][0], b = F.edges[e][1];
      const ca = membership[nodeIdToIdx.get(a)];
      const cb = membership[nodeIdToIdx.get(b)];
      if (ca === cb) intraEdgesAll.push([a, b]);
    }
    const allComps = bfsComponents(F.nodes.slice(), intraEdgesAll)
      .map(function (c) { return c.slice().sort(function (a, b) { return a - b; }); })
      .filter(function (c) { return c.length > 1; });

    const parentToChild = {};
    let toBeMincut = [];

    // [UPSTREAM cm.cpp:30-57] for each component: if the component is
    // the entire original cluster, keep cid; else assign a fresh id +
    // record (parent=-1, child=orig_cid) once + (parent=orig_cid,
    // child=fresh_id).
    //
    // [P0-Gap3] INIT_LINEAGE per-component 8-tuple hook
    // (__CM_HOOK_INIT_LINEAGE). Mirrors [TRACE-CM] INIT_LINEAGE probe in
    // kernel_check.cpp. Surfaces (comp_idx, first_node, orig_cid,
    // orig_size, sub_size, branch, parent_cid, current_cid, ptc snapshots)
    // for cross-side bit-equality.
    allComps.forEach(function (comp, compIdx) {
      const firstNode = comp[0];
      const firstNodeIdx = nodeIdToIdx.get(firstNode);
      const origCid = membership[firstNodeIdx];
      const origSize = clusterIdToNodes.get(origCid).length;
      const subSize = comp.length;
      let parentClusterId = -1;
      let currentClusterId;
      let branch;
      if (origSize === subSize) {
        currentClusterId = origCid;
        branch = "keep";
      } else {
        if (!parentToChild[-1]) parentToChild[-1] = [];
        if (parentToChild[-1].indexOf(origCid) < 0) parentToChild[-1].push(origCid);
        parentClusterId = origCid;
        currentClusterId = nextId++;
        branch = "fresh";
      }
      if (!parentToChild[parentClusterId]) parentToChild[parentClusterId] = [];
      parentToChild[parentClusterId].push(currentClusterId);
      if (typeof globalThis.__CM_HOOK_INIT_LINEAGE === "function") {
        globalThis.__CM_HOOK_INIT_LINEAGE({
          comp_idx: compIdx,
          first_node: firstNode,
          orig_cid: origCid,
          orig_size: origSize,
          sub_size: subSize,
          branch: branch,
          parent_cid: parentClusterId,
          current_cid: currentClusterId,
          ptc_neg1_after: (parentToChild[-1] || []).slice(),
          ptc_parent_after: parentToChild[parentClusterId].slice(),
        });
      }
      toBeMincut.push({ nodes: comp.slice(), id: currentClusterId });
    });
    // [P0-Gap6] post-init parent_to_child snapshot hook.
    if (typeof globalThis.__CM_HOOK_PTC_SNAPSHOT === "function") {
      globalThis.__CM_HOOK_PTC_SNAPSHOT({
        phase: "after_init",
        ptc: cloneParentToChild(parentToChild),
      });
    }

    events.push({ kind: "init", initialQueue: toBeMincut.map(function (q) {
      return { nodes: q.nodes.slice(), id: q.id };
    }) });

    const survivors = [];
    let round = 0;
    let safety = 0;
    while (toBeMincut.length > 0) {
      if (safety++ > 5000) throw new Error("CM: round cap exceeded");
      const toBeClustered = [];

      let popIdx = 0;
      while (toBeMincut.length > 0) {
        const cur = toBeMincut.shift();
        const ns = cur.nodes;
        const sub = inducedEdges(ns, F.edges);
        // [P0-Gap2] VC_BEGIN/END hooks. Mirrors [TRACE-CM] VC_BEGIN/END
        // canonical probes; downstream filter counts upstream [TRACE-VC]
        // events between BEGIN and END to get per-pop k_mincut draws.
        if (typeof globalThis.__CM_HOOK_VC_BEGIN === "function") {
          globalThis.__CM_HOOK_VC_BEGIN({
            round: round, pop_idx: popIdx, cid: cur.id, n: ns.length,
          });
        }
        const cutResult = cutOracle
          ? cutOracle(ns, sub)
          : mincutFn(ns.slice(), sub.map(function (e) { return [e[0], e[1]]; }));
        if (typeof globalThis.__CM_HOOK_VC_END === "function") {
          globalThis.__CM_HOOK_VC_END({
            round: round, pop_idx: popIdx, cut: cutResult.cutValue,
            in_size: cutResult.inPartition.length,
            out_size: cutResult.outPartition.length,
          });
        }
        const wc = C.WCC.isWellConnected(parsed, ns.length, cutResult.cutValue);
        // [P0-Gap7] threshold decomposition surfaced for the pop record.
        // pre_log is precomputed by parseCriterion; log_n is the FP
        // primitive output (Math.log or jsLog via WCC.threshold internals).
        const log_n = parsed && parsed.preLog != null && typeof Math.log === "function"
          ? Math.log(ns.length) : null;
        const threshold = C.WCC.threshold(parsed, ns.length);
        if (typeof globalThis.__CM_HOOK_THR_DECOMP === "function") {
          globalThis.__CM_HOOK_THR_DECOMP({
            round: round, pop_idx: popIdx, n: ns.length,
            pre_log: parsed && parsed.preLog,
            log_n: log_n,
            threshold: threshold,
          });
        }
        const ev = {
          kind: "mincut",
          round: round,
          id: cur.id,
          pop_idx: popIdx,
          nodes: ns.slice(),
          clusterSize: ns.length,
          cut: cutResult.cutValue,
          threshold: threshold,
          log_n: log_n,
          wellConnected: wc,
          inPartition: cutResult.inPartition.slice(),
          outPartition: cutResult.outPartition.slice(),
        };
        events.push(ev);
        if (typeof globalThis.__CM_HOOK_POP === "function") {
          globalThis.__CM_HOOK_POP({ ...ev });
        }
        if (wc) {
          survivors.push({ nodes: ns.slice(), id: cur.id });
          // [P0-Gap5] cpp always emits POP_SINGLETON_COUNT; mirror that for
          // wc=true pops with count=0 (no recluster -> no pushes).
          if (typeof globalThis.__CM_HOOK_POP_SINGLETON_COUNT === "function") {
            globalThis.__CM_HOOK_POP_SINGLETON_COUNT({
              round: round, pop_idx: popIdx, count: 0,
            });
          }
          popIdx++;
          continue;
        }
        // Re-cluster each side > 1 with the base algo.
        const sides = [cutResult.inPartition, cutResult.outPartition];
        let popSingletonCount = 0;
        const reclusterIter1 = { in: null, out: null };
        sides.forEach(function (side, sideIdx) {
          const sideName = sideIdx === 0 ? "in" : "out";
          if (side.length <= 1) return;
          const sideEdges = inducedEdges(side, F.edges);
          const hookCtx = {
            round: round, pop_idx: popIdx, cid: cur.id, side: sideName,
            parentNodes: ns.slice(),
            algorithm: algorithm, resolution: resolution, seed: seed,
          };
          const partition = baseAlgoFn
            ? baseAlgoFn(side, sideEdges, hookCtx)
            : runBaseAlgoClusters(side, sideEdges, algorithm, resolution, seed, hookCtx);
          // [P0-Gap1] iter-1 membership captured on the legacy-shape
          // return adapter; surfaced via __CM_HOOK_RECLUSTER for cross-side
          // bit-equality (mirrors cpp PopRecord.in_leiden_membership_iter1).
          if (partition && partition.iter1Membership) {
            reclusterIter1[sideName] = partition.iter1Membership.slice();
          }
          // RemoveInterClusterEdges + connected components per partition.
          // [UPSTREAM cm.h:138-148] canonical pushes every translated
          // component into to_be_clustered regardless of size; no size>1
          // filter at this site.
          partition.forEach(function (clust) {
            const clustEdges = inducedEdges(clust, sideEdges);
            const comps = bfsComponents(clust, clustEdges);
            comps.forEach(function (comp) {
              // [P0-Gap5] singleton-incidence probe. Per-push is_singleton
              // flag surfaced via __CM_HOOK_PUSH so self_rng_check can
              // assert per-pop singleton counts independently of cell
              // pass/fail.
              const isSingleton = comp.length === 1;
              if (isSingleton) popSingletonCount++;
              if (typeof globalThis.__CM_HOOK_PUSH === "function") {
                globalThis.__CM_HOOK_PUSH({
                  round: round, pop_idx: popIdx, side: sideName,
                  size: comp.length, is_singleton: isSingleton,
                  nodes: comp.slice(),
                });
              }
              toBeClustered.push({ nodes: comp.slice(), parent: cur.id });
            });
          });
        });
        if (typeof globalThis.__CM_HOOK_POP_SINGLETON_COUNT === "function") {
          globalThis.__CM_HOOK_POP_SINGLETON_COUNT({
            round: round, pop_idx: popIdx, count: popSingletonCount,
          });
        }
        events.push({
          kind: "recluster",
          round: round,
          parentId: cur.id,
          pop_idx: popIdx,
          baseAlgo: algorithm,
          baseResolution: resolution,
          inLeidenIter1: reclusterIter1.in,
          outLeidenIter1: reclusterIter1.out,
          children: toBeClustered.slice().filter(function (q) { return q.parent === cur.id; })
            .map(function (q) { return q.nodes.slice(); }),
        });
        popIdx++;
      }

      // [UPSTREAM cm.cpp:83-95] cpp emits `terminal` snapshot + breaks
      // when to_be_clustered.empty() AFTER the drain phase; otherwise
      // emits per-assignment END_ROUND_DRAIN + after_round_N snapshot
      // then continues. Mirror that semantic exactly so PTC_SNAPSHOT
      // count matches.
      if (toBeClustered.length === 0) {
        events.push({ kind: "round-end", round: round, queueSize: 0 });
        // [P0-Gap6] terminal parent_to_child snapshot.
        if (typeof globalThis.__CM_HOOK_PTC_SNAPSHOT === "function") {
          globalThis.__CM_HOOK_PTC_SNAPSHOT({
            phase: "terminal",
            ptc: cloneParentToChild(parentToChild),
          });
        }
        break;
      }
      // [P0-Gap4] END_ROUND_DRAIN per-assignment hook. Mirrors [TRACE-CM]
      // END_ROUND_DRAIN canonical probe (per-fresh_id record + ptc state).
      if (typeof globalThis.__CM_HOOK_END_ROUND_DRAIN_BEGIN === "function") {
        globalThis.__CM_HOOK_END_ROUND_DRAIN_BEGIN({
          round: round, drain_size: toBeClustered.length,
        });
      }
      const freshIdsAssigned = [];
      toBeClustered.forEach(function (q, drainIdx) {
        const newId = nextId++;
        if (!parentToChild[q.parent]) parentToChild[q.parent] = [];
        parentToChild[q.parent].push(newId);
        toBeMincut.push({ nodes: q.nodes, id: newId });
        freshIdsAssigned.push(newId);
        if (typeof globalThis.__CM_HOOK_END_ROUND_DRAIN === "function") {
          globalThis.__CM_HOOK_END_ROUND_DRAIN({
            round: round, drain_idx: drainIdx,
            parent_cid: q.parent, fresh_id: newId,
            ptc_size_after: Object.keys(parentToChild).length,
            ptc_parent_after: parentToChild[q.parent].slice(),
          });
        }
      });
      if (typeof globalThis.__CM_HOOK_END_ROUND_DRAIN_END === "function") {
        globalThis.__CM_HOOK_END_ROUND_DRAIN_END({
          round: round, fresh_ids: freshIdsAssigned,
        });
      }
      // [P0-Gap6] per-round parent_to_child snapshot. cpp emits
      // `after_round_<round>` BEFORE `round++`, so use the pre-increment
      // value to match.
      if (typeof globalThis.__CM_HOOK_PTC_SNAPSHOT === "function") {
        globalThis.__CM_HOOK_PTC_SNAPSHOT({
          phase: "after_round_" + round,
          ptc: cloneParentToChild(parentToChild),
        });
      }
      events.push({ kind: "round-end", round: round, queueSize: toBeMincut.length });
      round += 1;
    }

    // Build finalAssign (consecutive 0-indexed in the order survivors land).
    const finalAssign = new Int32Array(F.nodes.length);
    for (let i = 0; i < finalAssign.length; i++) finalAssign[i] = -1;
    survivors.forEach(function (s, outId) {
      s.nodes.forEach(function (id) { finalAssign[nodeIdToIdx.get(id)] = outId; });
    });

    return {
      criterion: criterion,
      parsed: parsed,
      algorithm: algorithm,
      resolution: resolution,
      events: events,
      survivors: survivors.map(function (s) { return { nodes: s.nodes.slice(), id: s.id }; }),
      finalAssign: finalAssign,
      numClusters: survivors.length,
      parentToChild: parentToChild,
    };
  }

  C.CM = { runCM: runCM };
})();
