/* CC kernel: connected-component split (Park 2025 / Vu-Le 2026).
 *
 * Faithful port of constrained_clustering MincutOnly run with
 * --connectedness-criterion 0 (mincut_only.cpp:42-46 short-circuits the
 * recursive cut + threshold loop and emits each connected component as
 * its own output cluster).
 *
 * The binary keeps the CC + WCC paths in one binary; CC = Simple branch.
 *   1. RemoveInterClusterEdges (constrained.h:122-151): drop every edge
 *      whose endpoints carry different cluster ids.
 *   2. igraph_i_connected_components_weak (components.c:95-201): BFS
 *      from each unvisited node in node-id ASC; assign membership[v] =
 *      no_of_components at first encounter.
 *   3. Bucket-fill (constrained.h:403-411): iterate node_id = 0..N-1;
 *      push into per-cid bucket if csize[cid] > 1 (drops singletons).
 *   4. std::map<int,vector<int>> flush (constrained.h:415-417): yields
 *      components in cid-ASC iteration order (= BFS-discovery order
 *      since cid is assigned by an incrementing counter at BFS open).
 *   5. WriteClusterQueue (constrained.cpp:135-152): FIFO pop assigns
 *      cluster_id 0,1,... in pop order; each cluster's contents are
 *      already node-id ASC by construction.
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
 *
 * Tracer probes (gate: globalThis.CC_DUMP_PROBES === true) emit
 * stderr-format [TRACE-CC] lines that mirror the cpp instrumented
 * fork at tools/viz_check/cc/instrumented/kernel_check.cpp so per-step
 * trajectory can be diffed byte-for-byte under matching input.
 * Disabled by default; the production walker emits nothing.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  // [TRACE-CC] probe gate. Off in browser (window.CC_DUMP_PROBES
  // undefined) so the production walker emits nothing. Tracer harnesses
  // set globalThis.CC_DUMP_PROBES = true before importing cc.js to
  // enable per-RIE-edge + per-BFS-root + per-pop + per-neighbor + per-
  // membership-write + per-bucket-node + per-comp-flush + per-WCQ-pop
  // emissions that mirror tools/viz_check/cc/instrumented/kernel_check.cpp.
  function _ccProbesEnabled() {
    return (typeof globalThis !== "undefined")
        && globalThis.CC_DUMP_PROBES === true;
  }
  function _ccLog(msg) {
    if (typeof console !== "undefined" && console.error) {
      console.error(msg);
    }
  }

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

  // [UPSTREAM type_indexededgelist.c:891-1010, igraph_neighbors] cpp's
  // igraph_neighbors(IGRAPH_ALL) for an undirected graph returns the
  // neighbor list with `to <= v` first (out-edges sorted asc) then
  // `from > v` next (in-edges sorted asc). Equivalently, for a simple
  // graph, just ascending. We re-sort the per-node adjacency in
  // ascending order to mirror cpp byte-for-byte under the tracer's
  // CCW_NEIGHS / CCW_VISIT probes.
  function sortAdjForIgraphOrder(adj) {
    for (let i = 0; i < adj.length; i++) {
      adj[i].sort(function (a, b) { return a - b; });
    }
  }

  // [UPSTREAM components.c:95-201] igraph_i_connected_components_weak
  // verbatim port. Returns (membership, csize). Per-BFS-step probes
  // mirror the cpp instrumented fork:
  //   CCW_ROOT     - components.c:144-157 per-root open.
  //   CCW_NEIGHS   - components.c:161-163 igraph_neighbors dump.
  //   CCW_VISIT    - components.c:165-167 per-neighbor scan.
  //   CCW_MEMBER   - components.c:155 (root) + :174 (expand).
  //   CCW_COMP_DONE- components.c:179-182 FINALIZE_COMP.
  function ccWeak(n, adj) {
    const _probe = _ccProbesEnabled();
    const already = new Uint8Array(n);
    const membership = new Int32Array(n);
    const csize = [];
    let no_of_components = 0;
    for (let first_node = 0; first_node < n; first_node++) {
      if (already[first_node]) continue;
      already[first_node] = 1;
      let act_component_size = 1;
      membership[first_node] = no_of_components;
      if (_probe) {
        _ccLog(`[TRACE-CC] CCW_ROOT first=${first_node} `
             + `comp_id=${no_of_components} size=1`);
        _ccLog(`[TRACE-CC] CCW_MEMBER node=${first_node} `
             + `comp_id=${no_of_components} source=root`);
      }
      const q = [first_node];
      let head = 0;
      let pop_pos = 0;
      let first_in_comp = first_node;
      let last_in_comp = first_node;
      while (head < q.length) {
        const act_node = q[head++];
        const neigh = adj[act_node];
        const nei_count = neigh.length;
        if (_probe) {
          let ids = "[";
          for (let i = 0; i < nei_count; i++) {
            if (i) ids += ",";
            ids += neigh[i];
          }
          ids += "]";
          _ccLog(`[TRACE-CC] CCW_NEIGHS act=${act_node} `
               + `count=${nei_count} ids=${ids}`);
        }
        for (let i = 0; i < nei_count; i++) {
          const neighbor = neigh[i];
          const alreadyBit = already[neighbor];
          if (_probe) {
            _ccLog(`[TRACE-CC] CCW_VISIT act=${act_node} pop_pos=${pop_pos} `
                 + `nei=${neighbor} already=${alreadyBit ? 1 : 0} `
                 + `comp_id=${no_of_components}`);
          }
          if (alreadyBit) continue;
          q.push(neighbor);
          already[neighbor] = 1;
          act_component_size++;
          membership[neighbor] = no_of_components;
          if (_probe) {
            _ccLog(`[TRACE-CC] CCW_MEMBER node=${neighbor} `
                 + `comp_id=${no_of_components} source=expand`);
          }
          last_in_comp = neighbor;
        }
        pop_pos++;
      }
      if (_probe) {
        _ccLog(`[TRACE-CC] CCW_COMP_DONE comp_id=${no_of_components} `
             + `size=${act_component_size} first=${first_in_comp} `
             + `last=${last_in_comp}`);
      }
      no_of_components++;
      csize.push(act_component_size);
    }
    return { membership: membership, csize: csize,
             no_of_components: no_of_components };
  }

  // Legacy export wrapper. Callers (page walker, kernel_check.mjs comp
  // compare) expect per-component node-id-ASC lists; we reconstruct via
  // the same bucket-fill loop the canonical uses, then map back to the
  // caller's nodeIds[] domain.
  function bfsComponents(nodeIds, edges) {
    const n = nodeIds.length;
    if (n === 0) return [];
    const built = buildAdj(nodeIds, edges);
    const adj = built.adj;
    sortAdjForIgraphOrder(adj);
    const w = ccWeak(n, adj);
    // [UPSTREAM constrained.h:403-411] bucket-fill loop. Mirrors the
    // canonical per-node iteration; this version preserves ALL
    // components (singleton filter happens in runCC where it matters).
    const buckets = new Map();
    for (let node_id = 0; node_id < n; node_id++) {
      const c = w.membership[node_id];
      let arr = buckets.get(c);
      if (!arr) { arr = []; buckets.set(c, arr); }
      arr.push(nodeIds[node_id]);
    }
    const cids = Array.from(buckets.keys()).sort(function (a, b) {
      return a - b;
    });
    const out = [];
    for (let i = 0; i < cids.length; i++) out.push(buckets.get(cids[i]));
    return out;
  }

  function runCC(membership, opts) {
    opts = opts || {};
    const F = opts.fixture || C.FIXTURE;
    const _probe = _ccProbesEnabled();
    const nodeIdToIdx = new Map();
    F.nodes.forEach(function (id, i) { nodeIdToIdx.set(id, i); });
    const trace = opts.trace ? [] : null;
    function tlog(s) { if (trace) trace.push(s); }

    // [UPSTREAM constrained.h:122-151] RemoveInterClusterEdges. Per-edge
    // RIE_EDGE probe mirrors the cpp loop's per-iteration record. JS
    // walks F.edges in input order = canonical's CSV row order =
    // igraph_ess_all(IGRAPH_EDGEORDER_ID) order.
    const intraEdges = [];
    let kept_count = 0;
    let removed_count = 0;
    for (let e = 0; e < F.edges.length; e++) {
      const a = F.edges[e][0], b = F.edges[e][1];
      const ia = nodeIdToIdx.get(a);
      const ib = nodeIdToIdx.get(b);
      const ca = (ia != null) ? membership[ia] : -2147483648;
      const cb = (ib != null) ? membership[ib] : -2147483648;
      const from_has = ia != null;
      const to_has   = ib != null;
      const kept = (from_has && to_has && ca === cb);
      if (kept) {
        intraEdges.push([a, b]);
        kept_count++;
      } else {
        removed_count++;
      }
      if (_probe) {
        // [UPSTREAM type_indexededgelist.c:282-288] For undirected graphs
        // igraph stores edges with `from = max(a,b), to = min(a,b)` (the
        // input is swapped iff a <= b). IGRAPH_FROM/TO returns the stored
        // pair, so the JS probe must mirror the same canonicalisation for
        // RIE_EDGE to bit-match cpp; `ca` / `cb` follow from/to identity.
        const inA = (ia != null) ? ia : -2147483648;
        const inB = (ib != null) ? ib : -2147483648;
        let fromId, toId, caOut, cbOut;
        if (inA > inB) { fromId = inA; toId = inB; caOut = ca; cbOut = cb; }
        else           { fromId = inB; toId = inA; caOut = cb; cbOut = ca; }
        _ccLog(`[TRACE-CC] RIE_EDGE from=${fromId} to=${toId} `
             + `ca=${caOut} cb=${cbOut} kept=${kept ? 1 : 0}`);
      }
    }
    if (_probe) {
      _ccLog(`[TRACE-CC] RIE_SUM kept=${kept_count} removed=${removed_count}`);
    }

    // [UPSTREAM components.c:95-201] BFS in node-id ASC over residual
    // graph. Builds adj over F.nodes[i] -> i indexing so the
    // first_node = 0..n-1 loop maps cleanly. Per-node neighbor list is
    // sorted ascending to match cpp's igraph_neighbors return order
    // ([UPSTREAM type_indexededgelist.c:891-1010] out + in concat with
    // each side sorted asc; for a simple undirected graph this collapses
    // to one ascending list).
    const n = F.nodes.length;
    const built = buildAdj(F.nodes, intraEdges);
    const adj = built.adj;
    sortAdjForIgraphOrder(adj);
    const w = ccWeak(n, adj);

    // [UPSTREAM constrained.h:403-411] bucket-fill loop. Per-node probe
    // mirrors cpp BUCKET record; emits the keep/drop flag (csize > 1)
    // for every node iteration. This collapses BFS-discovery order to
    // node-id-ASC contents per the canonical's std::map<int,...>
    // bucket fill.
    const buckets = new Map();
    for (let node_id = 0; node_id < n; node_id++) {
      const c = w.membership[node_id];
      const cs = w.csize[c];
      const kept = cs > 1;
      if (kept) {
        let arr = buckets.get(c);
        if (!arr) { arr = []; buckets.set(c, arr); }
        arr.push(node_id);
      }
      if (_probe) {
        _ccLog(`[TRACE-CC] BUCKET node_id=${node_id} comp_id=${c} `
             + `cs=${cs} kept=${kept ? 1 : 0}`);
      }
    }

    // [UPSTREAM constrained.h:415-417] std::map iteration in cid ASC.
    // Per-flush probe mirrors cpp COMP_FLUSH record. Output components
    // are accumulated in cid-ASC order (= BFS-discovery order since cid
    // is assigned by an incrementing counter at BFS open).
    const cids = Array.from(buckets.keys()).sort(function (a, b) {
      return a - b;
    });
    const allCompsByIdx = [];
    for (let i = 0; i < cids.length; i++) {
      const members = buckets.get(cids[i]);
      if (_probe) {
        const firstM = members.length ? members[0] : -1;
        const lastM = members.length ? members[members.length - 1] : -1;
        _ccLog(`[TRACE-CC] COMP_FLUSH comp_id=${cids[i]} `
             + `size=${members.length} first=${firstM} last=${lastM}`);
      }
      allCompsByIdx.push(members);
    }

    // Map back to F.nodes[id] for the page walker / replay (preserves
    // legacy allComps contract of original-node-id contents).
    const allComps = allCompsByIdx.map(function (memberIdxs) {
      return memberIdxs.map(function (idx) { return F.nodes[idx]; });
    });

    tlog("STAGE_REMOVE intra_edges=" + intraEdges.length + " (of " + F.edges.length + ")");
    tlog("STAGE_COMPONENTS count=" + allComps.length);
    allComps.forEach(function (c, i) {
      tlog("  comp[" + i + "] size=" + c.length);
    });

    // Walker events: for UX we still group components by input cluster
    // (one event per input cluster). The output cluster ids assigned to
    // size>1 components follow the residual-graph component order so
    // they match the binary's WriteClusterQueue output.
    const inBuckets = new Map();
    F.nodes.forEach(function (id, i) {
      const c = membership[i];
      let arr = inBuckets.get(c);
      if (!arr) { arr = []; inBuckets.set(c, arr); }
      arr.push(id);
    });
    const events = [];
    const inCIds = Array.from(inBuckets.keys()).sort(function (a, b) {
      return a - b;
    });
    inCIds.forEach(function (cid) {
      const ns = inBuckets.get(cid);
      const nsSet = new Set(ns);
      const compsForCid = allComps.filter(function (c) {
        return nsSet.has(c[0]);
      });
      events.push({ clusterIn: cid, nodes: ns.slice(), components: compsForCid });
    });

    // [UPSTREAM constrained.cpp:135-152] WriteClusterQueue FIFO pop.
    // Per-pop WCQ_POP probe mirrors cpp record. JS iterates allComps in
    // cid-ASC = BFS-discovery order which equals canonical's queue pop
    // order under the same input.
    const finalAssign = new Int32Array(F.nodes.length);
    for (let i = 0; i < finalAssign.length; i++) finalAssign[i] = -1;
    let outId = 0;
    allCompsByIdx.forEach(function (memberIdxs) {
      // singleton drop happened at bucket-fill (cs>1 filter); every
      // element here has length > 1.
      if (memberIdxs.length <= 1) return;
      for (let k = 0; k < memberIdxs.length; k++) {
        finalAssign[memberIdxs[k]] = outId;
      }
      if (_probe) {
        const firstM = memberIdxs[0];
        const lastM = memberIdxs[memberIdxs.length - 1];
        _ccLog(`[TRACE-CC] WCQ_POP cluster_id=${outId} `
             + `size=${memberIdxs.length} first=${firstM} last=${lastM}`);
      }
      outId += 1;
    });
    if (_probe) {
      _ccLog(`[TRACE-CC] WriteClusterQueue out_clusters=${outId}`);
    }

    tlog("STAGE_DONE numClusters=" + outId);
    return { events: events, finalAssign: finalAssign, numClusters: outId,
             allComps: allComps, residualEdges: intraEdges,
             trace: trace };
  }

  C.CC = { runCC: runCC, bfsComponents: bfsComponents };
})();
