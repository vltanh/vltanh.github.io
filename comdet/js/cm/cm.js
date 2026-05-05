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
  if (!C.WCC || !C.MINCUT || !C.LEIDEN) return;

  function bfsComponents(nodeIds, edges) {
    return C.WCC.bfsComponents(nodeIds, edges);
  }

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
  function runBaseAlgo(nodes, edges, algorithm, resolution, seed) {
    const n = nodes.length;
    if (n <= 1) return [nodes.slice()];
    const idx = new Map();
    nodes.forEach(function (id, i) { idx.set(id, i); });
    const compEdges = edges.map(function (e) {
      return [idx.get(e[0]), idx.get(e[1])];
    });
    const G = C.LEIDEN.Graph(n, compEdges, { correctSelfLoops: false });
    let qfn;
    if (algorithm === "leiden-cpm") qfn = C.LEIDEN.CPM(resolution);
    else if (algorithm === "leiden-mod" || algorithm === "louvain") qfn = C.LEIDEN.Modularity();
    else throw new Error("CM: unsupported algorithm '" + algorithm + "'");
    const result = C.LEIDEN.optimisePartition(G, qfn, seed >>> 0);
    const mem = result.partition.membership();
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const c = mem[i];
      let arr = buckets.get(c);
      if (!arr) { arr = []; buckets.set(c, arr); }
      arr.push(nodes[i]);
    }
    return Array.from(buckets.values());
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
    const trace = opts.trace ? [] : null;
    function tlog(s) { if (trace) trace.push(s); }

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
    allComps.forEach(function (comp) {
      const firstNodeIdx = nodeIdToIdx.get(comp[0]);
      const origCid = membership[firstNodeIdx];
      const origSize = clusterIdToNodes.get(origCid).length;
      const subSize = comp.length;
      let parentClusterId = -1;
      let currentClusterId;
      if (origSize === subSize) {
        currentClusterId = origCid;
      } else {
        if (!parentToChild[-1]) parentToChild[-1] = [];
        if (parentToChild[-1].indexOf(origCid) < 0) parentToChild[-1].push(origCid);
        parentClusterId = origCid;
        currentClusterId = nextId++;
      }
      if (!parentToChild[parentClusterId]) parentToChild[parentClusterId] = [];
      parentToChild[parentClusterId].push(currentClusterId);
      toBeMincut.push({ nodes: comp.slice(), id: currentClusterId });
    });

    events.push({ kind: "init", initialQueue: toBeMincut.map(function (q) {
      return { nodes: q.nodes.slice(), id: q.id };
    }) });

    const survivors = [];
    let round = 0;
    let safety = 0;
    while (toBeMincut.length > 0) {
      if (safety++ > 5000) throw new Error("CM: round cap exceeded");
      const toBeClustered = [];

      while (toBeMincut.length > 0) {
        const cur = toBeMincut.shift();
        const ns = cur.nodes;
        const sub = inducedEdges(ns, F.edges);
        const cutResult = cutOracle
          ? cutOracle(ns, sub)
          : mincutFn(ns.slice(), sub.map(function (e) { return [e[0], e[1]]; }));
        const wc = C.WCC.isWellConnected(parsed, ns.length, cutResult.cutValue);
        const ev = {
          kind: "mincut",
          round: round,
          id: cur.id,
          nodes: ns.slice(),
          clusterSize: ns.length,
          cut: cutResult.cutValue,
          threshold: C.WCC.threshold(parsed, ns.length),
          wellConnected: wc,
          inPartition: cutResult.inPartition.slice(),
          outPartition: cutResult.outPartition.slice(),
        };
        events.push(ev);
        if (wc) {
          survivors.push({ nodes: ns.slice(), id: cur.id });
          continue;
        }
        // Re-cluster each side > 1 with the base algo.
        const sides = [cutResult.inPartition, cutResult.outPartition];
        sides.forEach(function (side) {
          if (side.length <= 1) return;
          const sideEdges = inducedEdges(side, F.edges);
          const partition = baseAlgoFn
            ? baseAlgoFn(side, sideEdges, { round: round, parentId: cur.id, parentNodes: ns.slice(), algorithm: algorithm, resolution: resolution, seed: seed })
            : runBaseAlgo(side, sideEdges, algorithm, resolution, seed);
          tlog("    RECLUSTER parent=" + cur.id + " side_size=" + side.length + " -> " + partition.length + " comm(s)");
          // RemoveInterClusterEdges + connected components per partition.
          partition.forEach(function (clust) {
            const clustEdges = inducedEdges(clust, sideEdges);
            const comps = bfsComponents(clust, clustEdges);
            comps.forEach(function (comp) {
              if (comp.length <= 1) return;
              toBeClustered.push({ nodes: comp.slice(), parent: cur.id });
            });
          });
        });
        events.push({
          kind: "recluster",
          round: round,
          parentId: cur.id,
          baseAlgo: algorithm,
          baseResolution: resolution,
          children: toBeClustered.slice().filter(function (q) { return q.parent === cur.id; })
            .map(function (q) { return q.nodes.slice(); }),
        });
      }

      // Move to-be-clustered into next round's mincut queue with fresh ids.
      toBeClustered.forEach(function (q) {
        const newId = nextId++;
        if (!parentToChild[q.parent]) parentToChild[q.parent] = [];
        parentToChild[q.parent].push(newId);
        toBeMincut.push({ nodes: q.nodes, id: newId });
      });
      events.push({ kind: "round-end", round: round, queueSize: toBeMincut.length });
      round += 1;
    }

    // Build finalAssign (consecutive 0-indexed in the order survivors land).
    const finalAssign = new Int32Array(F.nodes.length);
    for (let i = 0; i < finalAssign.length; i++) finalAssign[i] = -1;
    survivors.forEach(function (s, outId) {
      s.nodes.forEach(function (id) { finalAssign[nodeIdToIdx.get(id)] = outId; });
    });

    tlog("STAGE_DONE survivors=" + survivors.length + " rounds=" + round);
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
      trace: trace,
    };
  }

  C.CM = { runCM: runCM };
})();
