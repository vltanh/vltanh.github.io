/* CC kernel: connected-component split (Park 2025 / Vu-Le 2026).
 *
 * Faithful port of constrained_clustering MincutOnly run with
 * --connectedness-criterion 0 (mincut_only.cpp:42-46 short-circuits the
 * recursive cut + threshold loop and emits each connected component as
 * its own output cluster).
 *
 * The binary keeps the CC + WCC paths in one binary; CC = Simple branch.
 *   1. RemoveInterClusterEdges (constrained.h: drop every edge whose
 *      endpoints carry different cluster ids).
 *   2. GetConnectedComponents on the residual graph (igraph_connected_
 *      components IGRAPH_WEAK).
 *   3. Drop singleton components (constrained.h:409 size > 1).
 *   4. WriteClusterQueue assigns 0-indexed consecutive ids in queue
 *      iteration order. We mirror that by sorting input cluster ids
 *      ascending and walking BFS components in discovery order.
 *
 * Inputs / outputs:
 *   runCC(membership, opts) -> {
 *     events: [ { clusterIn, nodes, components: [[ids]...] } ],
 *     finalAssign: Int32Array per fixture index, -1 = dropped,
 *     numClusters,
 *   }
 *
 * `membership` is a per-fixture-index array of cluster ids. opts.fixture
 * defaults to COMDET.FIXTURE.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  function buildAdj(nodeIds, edges) {
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    const n = nodeIds.length;
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    for (let e = 0; e < edges.length; e++) {
      const u = idx.get(edges[e][0]);
      const v = idx.get(edges[e][1]);
      if (u == null || v == null || u === v) continue;
      adj[u].push(v); adj[v].push(u);
    }
    return { idx: idx, adj: adj };
  }

  function bfsComponents(nodeIds, edges) {
    const n = nodeIds.length;
    if (n === 0) return [];
    const built = buildAdj(nodeIds, edges);
    const adj = built.adj;
    const seen = new Uint8Array(n);
    const comps = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      seen[s] = 1;
      const queue = [s];
      let head = 0;
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

  function runCC(membership, opts) {
    opts = opts || {};
    const F = opts.fixture || C.FIXTURE;
    const nodeIdToIdx = new Map();
    F.nodes.forEach(function (id, i) { nodeIdToIdx.set(id, i); });
    const trace = opts.trace ? [] : null;
    function tlog(s) { if (trace) trace.push(s); }

    // Match the binary (mincut_only.cpp:35-45): build the residual graph
    // by RemoveInterClusterEdges, then GetConnectedComponents over the
    // whole graph. igraph_connected_components labels components in node
    // BFS-root order, which is node id 0..N-1 sequence.
    const intraEdges = [];
    for (let e = 0; e < F.edges.length; e++) {
      const a = F.edges[e][0], b = F.edges[e][1];
      const ca = membership[nodeIdToIdx.get(a)];
      const cb = membership[nodeIdToIdx.get(b)];
      if (ca === cb) intraEdges.push([a, b]);
    }
    // BFS components in node-id order: root selection iterates F.nodes in
    // order; each returned component is the BFS tree from its root.
    // Within each component sort by node-id ascending to mirror the
    // canonical's per-node iteration in constrained.h:402-411 (the loop
    // walks node_id = 0..vcount-1 and pushes into component_id_to_member
    // _vector_map[cid], so per-component contents are node-id-sorted).
    const orderedNodes = F.nodes.slice();
    const allComps = bfsComponents(orderedNodes, intraEdges)
      .map(function (c) { return c.slice().sort(function (a, b) { return a - b; }); });
    tlog("STAGE_REMOVE intra_edges=" + intraEdges.length + " (of " + F.edges.length + ")");
    tlog("STAGE_COMPONENTS count=" + allComps.length);
    allComps.forEach(function (c, i) {
      tlog("  comp[" + i + "] size=" + c.length);
    });

    // Walker events: for UX we still group components by input cluster
    // (one event per input cluster). The output cluster ids assigned to
    // size>1 components follow the residual-graph component order so
    // they match the binary's WriteClusterQueue output.
    const buckets = new Map();
    F.nodes.forEach(function (id, i) {
      const c = membership[i];
      let arr = buckets.get(c);
      if (!arr) { arr = []; buckets.set(c, arr); }
      arr.push(id);
    });
    const events = [];
    const cIds = Array.from(buckets.keys()).sort(function (a, b) { return a - b; });
    cIds.forEach(function (cid) {
      const ns = buckets.get(cid);
      const nsSet = new Set(ns);
      const compsForCid = allComps.filter(function (c) {
        return nsSet.has(c[0]);
      });
      events.push({ clusterIn: cid, nodes: ns.slice(), components: compsForCid });
    });

    const finalAssign = new Int32Array(F.nodes.length);
    for (let i = 0; i < finalAssign.length; i++) finalAssign[i] = -1;
    let outId = 0;
    allComps.forEach(function (comp) {
      if (comp.length <= 1) return;
      for (let k = 0; k < comp.length; k++) {
        finalAssign[nodeIdToIdx.get(comp[k])] = outId;
      }
      outId += 1;
    });

    tlog("STAGE_DONE numClusters=" + outId);
    return { events: events, finalAssign: finalAssign, numClusters: outId,
             allComps: allComps, residualEdges: intraEdges,
             trace: trace };
  }

  C.CC = { runCC: runCC, bfsComponents: bfsComponents };
})();
