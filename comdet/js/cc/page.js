/* CC page glue: 5-phase walker over the kernel trace.
 *
 * Phases (each = one or more frames):
 *   1. cross-edge highlight: paint inter-cluster edges red.
 *   2. RemoveInterClusterEdges: fade red edges out.
 *   3. BFS components: per component, root pick + frontier expand + complete.
 *   4. csize > 1 filter: grey out singletons.
 *   5. cluster id assignment: show node -> cluster_id mapping.
 *
 * Frame schema:
 *   { phase: 1..5, label, prose, vizState, panelState }
 * vizState carries per-node + per-edge class assignments derived for
 * each frame; the renderer applies them by diff against the previous
 * frame so transitions stay smooth.
 *
 * The kernel (cc.js) is byte-equal to canonical and untouched here. The
 * walker re-derives BFS level structure for animation purposes only;
 * level decomposition does not affect kernel output.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.CC || !COMDET.FIXTURE) {
    console.warn("[cc page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "cc" });
  }

  const idxByNode = {};
  F.nodes.forEach(function (id, i) { idxByNode[id] = i; });

  // Run kernel on planted GT.
  const result = C.CC.runCC(F.gt);

  // ── Stage 0: input fixture (GT colors) ─────────────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // ── Phase frame computation ─────────────────────────────────────
  // Identify cross-cluster edges + intra-cluster edges (one pass).
  const crossEdgeIdx = [];
  const intraEdgeIdx = [];
  F.edges.forEach(function (e, i) {
    const ca = F.gt[idxByNode[e[0]]];
    const cb = F.gt[idxByNode[e[1]]];
    if (ca === cb) intraEdgeIdx.push(i); else crossEdgeIdx.push(i);
  });

  // BFS levels for animation: re-derive per-component (root,
  // levels[]). Component contents come from the kernel (allComps),
  // so the discovery order matches byte-equal output.
  function adjList(nodeIds, edgeIdxList) {
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    const adj = nodeIds.map(function () { return []; });
    edgeIdxList.forEach(function (ei) {
      const e = F.edges[ei];
      const u = idx.get(e[0]), v = idx.get(e[1]);
      if (u == null || v == null || u === v) return;
      adj[u].push(v); adj[v].push(u);
    });
    return { idx: idx, adj: adj };
  }

  // Run a single global BFS over all 32 nodes restricted to intraEdges,
  // matching cc.js bfsComponents behaviour. Capture per-component:
  //   root (lowest-unvisited node id at pop time)
  //   levels: [[root], [neighbours], [their neighbours], ...]
  //   members: same as kernel allComps (sorted ASC).
  const orderedNodes = F.nodes.slice();
  const built = adjList(orderedNodes, intraEdgeIdx);
  const adj = built.adj;
  const seen = new Uint8Array(orderedNodes.length);
  const compsAnimated = [];
  for (let s = 0; s < orderedNodes.length; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    const root = orderedNodes[s];
    const levels = [[root]];
    let frontier = [s];
    const members = [root];
    while (frontier.length > 0) {
      const next = [];
      for (let k = 0; k < frontier.length; k++) {
        const u = frontier[k];
        const ne = adj[u];
        for (let j = 0; j < ne.length; j++) {
          const w = ne[j];
          if (seen[w]) continue;
          seen[w] = 1; next.push(w); members.push(orderedNodes[w]);
        }
      }
      if (next.length > 0) levels.push(next.map(function (i) { return orderedNodes[i]; }));
      frontier = next;
    }
    compsAnimated.push({ root: root, levels: levels, members: members.slice().sort(function (a,b){return a-b;}) });
  }

  // Derive output-cluster assignments: id-walk per kernel order.
  // out_cid[node_id] = -1 if dropped, else 0..K-1.
  const outCid = {};
  F.nodes.forEach(function (id) { outCid[id] = -1; });
  let nextOutId = 0;
  compsAnimated.forEach(function (c) {
    if (c.members.length <= 1) return;
    c.members.forEach(function (id) { outCid[id] = nextOutId; });
    c.assignedOutId = nextOutId;
    nextOutId += 1;
  });
  const outClusterCount = nextOutId;

  // Build the frames array.
  // Each frame carries a pure description of (a) viz state, (b) panel state.
  // visited[]: Set of node ids visited so far (Phase 3+).
  // currentFrontier: nodes lit yellow this frame.
  // currentRoot: highlighted with root style.
  // queue: BFS queue as of this frame (head = next pop).
  // compsCompleted: list of component members assigned a color so far.
  //   Each completed comp shows in its assigned color (out_cid color).
  const frames = [];

  function pushFrame(f) { frames.push(f); }

  // Phase 1: cross-edges highlighted, intra-edges normal.
  pushFrame({
    phase: 1,
    label: "spot the cross-cluster edges",
    prose: "Edges crossing between input clusters are painted red. Everything else stays. The algorithm reads input membership and marks these for removal.",
    visited: new Set(),
    queue: [],
    crossActive: true,
    crossDimmed: false,
    membership: F.nodes.map(function (id, i) { return F.gt[i]; }),
    completedComps: [],
    counters: { crossEdges: crossEdgeIdx.length, intraEdges: intraEdgeIdx.length, comps: 0, dropped: 0, kept: 0 },
  });

  // Phase 2: cross-edges fade.
  pushFrame({
    phase: 2,
    label: "drop the cross edges",
    prose: "RemoveInterClusterEdges fades the red edges out of the residual graph. The remaining graph (intra-cluster edges only) is what BFS will traverse.",
    visited: new Set(),
    queue: [],
    crossActive: false,
    crossDimmed: true,
    membership: F.nodes.map(function (id, i) { return F.gt[i]; }),
    completedComps: [],
    counters: { crossEdges: crossEdgeIdx.length, intraEdges: intraEdgeIdx.length, comps: 0, dropped: 0, kept: 0 },
  });

  // Phase 3: BFS components. Per component:
  //   root pick frame
  //   per BFS level frame
  //   complete frame (all members get color of out_cid)
  // The membership shown in viz: nodes in completed comps wear the
  // component's assigned color (or grey if dropped); nodes in the
  // current component show the BFS root/frontier highlight; nodes not
  // yet visited stay neutral (paper-3).
  const visitedCum = new Set();
  const completedSoFar = [];

  function nodeMembership(currentComp) {
    // Build a per-node membership int. Use a special palette key:
    //   completed comp -> its assigned out_cid (final color)
    //   current comp visited -> sentinel index 100 + comp_idx (yellow tint via assigned out id)
    //   not yet -> -2 (grey).
    const m = new Array(F.nodes.length).fill(-2);
    completedSoFar.forEach(function (c) {
      const cid = c.assignedOutId != null ? c.assignedOutId : -1;
      c.members.forEach(function (id) { m[idxByNode[id]] = cid; });
    });
    if (currentComp) {
      const cid = currentComp.assignedOutId != null ? currentComp.assignedOutId : -1;
      currentComp.members.forEach(function (id) {
        // Only color visited nodes of the current comp.
        if (visitedCum.has(id)) m[idxByNode[id]] = cid;
      });
    }
    return m;
  }

  compsAnimated.forEach(function (comp, ci) {
    // Root pick frame.
    visitedCum.add(comp.root);
    const queueAtRoot = [comp.root];
    pushFrame({
      phase: 3,
      label: "BFS root pick · comp " + (ci + 1),
      prose: "Pick the lowest-id node not yet in any component. That seeds the BFS. For component " + (ci + 1) + " the root is node " + comp.root + ".",
      visited: new Set(visitedCum),
      currentRoot: comp.root,
      currentFrontier: new Set([comp.root]),
      currentMembers: new Set(comp.members),
      queue: queueAtRoot.slice(),
      crossActive: false,
      crossDimmed: true,
      membership: nodeMembership(comp),
      completedComps: completedSoFar.slice(),
      counters: { crossEdges: crossEdgeIdx.length, intraEdges: intraEdgeIdx.length, comps: completedSoFar.length, dropped: completedSoFar.filter(function (c) { return c.members.length <= 1; }).length, kept: completedSoFar.filter(function (c) { return c.members.length > 1; }).length },
    });

    // Per-level expand frames (skip level 0; root already shown).
    let queue = queueAtRoot.slice();
    for (let L = 1; L < comp.levels.length; L++) {
      const lvl = comp.levels[L];
      lvl.forEach(function (id) { visitedCum.add(id); queue.push(id); });
      pushFrame({
        phase: 3,
        label: "BFS level " + L + " · comp " + (ci + 1),
        prose: "Expand the frontier: every neighbour of a previously-visited node that is not yet visited gets added. " + lvl.length + " new node" + (lvl.length === 1 ? "" : "s") + " this level.",
        visited: new Set(visitedCum),
        currentRoot: comp.root,
        currentFrontier: new Set(lvl),
        currentMembers: new Set(comp.members),
        queue: queue.slice(),
        crossActive: false,
        crossDimmed: true,
        membership: nodeMembership(comp),
        completedComps: completedSoFar.slice(),
        counters: { crossEdges: crossEdgeIdx.length, intraEdges: intraEdgeIdx.length, comps: completedSoFar.length, dropped: completedSoFar.filter(function (c) { return c.members.length <= 1; }).length, kept: completedSoFar.filter(function (c) { return c.members.length > 1; }).length },
      });
    }

    // Comp-complete frame: queue drains, comp added to completedSoFar.
    completedSoFar.push(comp);
    const sizeStr = comp.members.length === 1 ? "1 node (singleton)" : comp.members.length + " nodes";
    pushFrame({
      phase: 3,
      label: "comp " + (ci + 1) + " done · " + sizeStr,
      prose: "Component " + (ci + 1) + " is complete: " + sizeStr + ". Members: " + comp.members.join(", ") + ". The BFS queue is empty; pick the next root.",
      visited: new Set(visitedCum),
      currentRoot: null,
      currentFrontier: new Set(),
      currentMembers: new Set(comp.members),
      queue: [],
      crossActive: false,
      crossDimmed: true,
      membership: nodeMembership(null),
      completedComps: completedSoFar.slice(),
      counters: { crossEdges: crossEdgeIdx.length, intraEdges: intraEdgeIdx.length, comps: completedSoFar.length, dropped: completedSoFar.filter(function (c) { return c.members.length <= 1; }).length, kept: completedSoFar.filter(function (c) { return c.members.length > 1; }).length },
    });
  });

  // Phase 4: csize > 1 filter.
  // Singletons grey out (membership -2 for those nodes).
  const filteredMem = new Array(F.nodes.length).fill(-2);
  let droppedCount = 0;
  completedSoFar.forEach(function (c) {
    if (c.members.length <= 1) {
      droppedCount += c.members.length;
      c.members.forEach(function (id) { filteredMem[idxByNode[id]] = -2; });
    } else {
      c.members.forEach(function (id) { filteredMem[idxByNode[id]] = c.assignedOutId; });
    }
  });
  pushFrame({
    phase: 4,
    label: "filter csize > 1",
    prose: "Components of size 1 are dropped (singletons): " + droppedCount + " node" + (droppedCount === 1 ? "" : "s") + " greyed. Components of size 2 or more keep their color.",
    visited: new Set(visitedCum),
    currentRoot: null,
    currentFrontier: new Set(),
    queue: [],
    crossActive: false,
    crossDimmed: true,
    membership: filteredMem.slice(),
    completedComps: completedSoFar.slice(),
    counters: { crossEdges: crossEdgeIdx.length, intraEdges: intraEdgeIdx.length, comps: completedSoFar.length, dropped: droppedCount, kept: F.nodes.length - droppedCount },
    droppedSingletons: completedSoFar.filter(function (c) { return c.members.length <= 1; }).map(function (c) { return c.members[0]; }),
  });

  // Phase 5: assign cluster ids (FIFO order). The membership = filteredMem.
  pushFrame({
    phase: 5,
    label: "assign cluster ids (FIFO)",
    prose: "WriteClusterQueue assigns 0-indexed ids in queue-pop order. " + outClusterCount + " output cluster" + (outClusterCount === 1 ? "" : "s") + " total. Each kept component gets the next id.",
    visited: new Set(visitedCum),
    currentRoot: null,
    currentFrontier: new Set(),
    queue: [],
    crossActive: false,
    crossDimmed: true,
    membership: filteredMem.slice(),
    completedComps: completedSoFar.slice(),
    counters: { crossEdges: crossEdgeIdx.length, intraEdges: intraEdgeIdx.length, comps: completedSoFar.length, dropped: droppedCount, kept: F.nodes.length - droppedCount, outClusters: outClusterCount },
    showAssignment: true,
  });

  // ── Phase strip rendering ───────────────────────────────────────
  const PHASE_LABELS = {
    1: "1 · spot",
    2: "2 · drop",
    3: "3 · BFS",
    4: "4 · filter",
    5: "5 · assign",
  };
  const phaseStrip = document.getElementById("g-walk-phases");
  let phaseChips = {};
  if (phaseStrip) {
    Object.keys(PHASE_LABELS).forEach(function (p) {
      const chip = document.createElement("button");
      chip.className = "phase-chip";
      chip.type = "button";
      chip.setAttribute("role", "tab");
      chip.dataset.phase = p;
      chip.innerHTML = '<span class="num">' + p + '</span><span>' + PHASE_LABELS[p].split("· ")[1] + '</span>';
      chip.addEventListener("click", function () {
        // Jump to first frame of this phase.
        for (let i = 0; i < frames.length; i++) {
          if (frames[i].phase === parseInt(p, 10)) { ctl.set(i); return; }
        }
      });
      phaseStrip.appendChild(chip);
      phaseChips[p] = chip;
    });
  }

  // ── Mount viz ───────────────────────────────────────────────────
  const viz = P.renderFixture("g-walk-cy", {
    membership: F.nodes.map(function (id, i) { return F.gt[i]; }),
    pinned: true, nodeR: 12,
  });

  // Edge id helper: matches page_helpers' "e-<idx>" naming.
  function edgeId(i) { return "e-" + i; }

  // ── Frame renderer ──────────────────────────────────────────────
  function applyFrame(f) {
    // Edges: cross-edges either red ("pick" used as red) or dimmed.
    crossEdgeIdx.forEach(function (i) {
      viz.removeEdgeClass(edgeId(i), "pick");
      viz.removeEdgeClass(edgeId(i), "dim");
      if (f.crossActive) viz.addEdgeClass(edgeId(i), "pick");
      if (f.crossDimmed) viz.addEdgeClass(edgeId(i), "dim");
    });
    // Intra-edges: always normal except phase 1 (could highlight, but
    // current decision is to keep neutral so cross-edges pop).
    intraEdgeIdx.forEach(function (i) {
      viz.removeEdgeClass(edgeId(i), "dim");
    });
    // Recolor nodes per membership. Use partitionColor for kept,
    // grey (-2 sentinel = -1 → partitionColor returns "#888") for not yet / dropped.
    P.recolour(viz, F, f.membership);
    // Highlight ring on root + frontier.
    F.nodes.forEach(function (id) {
      viz.removeNodeClass(id, "hi");
      viz.removeNodeClass(id, "dim");
    });
    if (f.currentRoot != null) viz.addNodeClass(f.currentRoot, "hi");
    if (f.currentFrontier && f.currentFrontier.size > 0) {
      f.currentFrontier.forEach(function (id) {
        if (id !== f.currentRoot) viz.addNodeClass(id, "hi");
      });
    }
  }

  function statusFor(f) {
    return '<span class="phase-tag">phase ' + f.phase + '</span>' + f.label;
  }

  function statsFor(f) {
    const c = f.counters || {};
    return "comps: " + (c.comps || 0) + " &middot; kept: " + (c.kept || 0) + " &middot; dropped: " + (c.dropped || 0);
  }

  // visited bitmap: 32 cells, .lit if visited, .frontier if in current
  // frontier, .root if current root.
  const bitmapEl = document.getElementById("g-walk-bitmap");
  function renderBitmap(f) {
    if (!bitmapEl) return;
    bitmapEl.innerHTML = "";
    F.nodes.forEach(function (id) {
      const cell = document.createElement("div");
      cell.className = "bitmap-cell";
      if (f.visited && f.visited.has(id)) cell.classList.add("lit");
      if (f.currentFrontier && f.currentFrontier.has(id)) cell.classList.add("frontier");
      if (f.currentRoot === id) cell.classList.add("root");
      cell.textContent = id;
      bitmapEl.appendChild(cell);
    });
  }

  // BFS queue display: head highlighted; show up to 16 entries.
  const queueEl = document.getElementById("g-walk-queue");
  function renderQueue(f) {
    if (!queueEl) return;
    if (!f.queue || f.queue.length === 0) {
      queueEl.innerHTML = '<span style="color:var(--paper-4)">empty</span>';
      return;
    }
    const parts = f.queue.map(function (id, i) {
      if (i === 0) return '<span class="head">' + id + '</span>';
      return '<span>' + id + '</span>';
    });
    queueEl.innerHTML = "[ " + parts.join(", ") + " ]";
  }

  // Counters strip.
  const countEl = document.getElementById("g-walk-counters");
  function renderCounters(f) {
    if (!countEl) return;
    const c = f.counters || {};
    const items = [
      { k: "cross edges", v: c.crossEdges },
      { k: "intra edges", v: c.intraEdges },
      { k: "comps found", v: c.comps },
      { k: "kept", v: c.kept },
      { k: "dropped", v: c.dropped },
    ];
    if (c.outClusters != null) items.push({ k: "out clusters", v: c.outClusters });
    countEl.innerHTML = items.map(function (it) {
      return '<span class="item">' + it.k + ': <span class="v">' + it.v + '</span></span>';
    }).join("");
  }

  // comp_id table: 32 rows in 2-column layout (16 each).
  const compTblBody = document.querySelector("#g-walk-comp tbody");
  function renderCompTable(f) {
    if (!compTblBody) return;
    compTblBody.innerHTML = "";
    // Build component_id per node from completedComps + currentMembers.
    const cidPerNode = {};
    F.nodes.forEach(function (id) { cidPerNode[id] = "·"; });
    (f.completedComps || []).forEach(function (c, ci) {
      c.members.forEach(function (id) { cidPerNode[id] = ci + 1; });
    });
    if (f.currentMembers) {
      // For active comp during BFS, list node_id with its (in-progress)
      // comp-index = completedComps.length + 1.
      const ci = (f.completedComps || []).length + 1;
      f.currentMembers.forEach(function (id) {
        if (f.visited && f.visited.has(id) && cidPerNode[id] === "·") {
          cidPerNode[id] = ci;
        }
      });
    }
    // 16 rows × 2 columns.
    for (let r = 0; r < 16; r++) {
      const tr = document.createElement("tr");
      const id1 = F.nodes[r], id2 = F.nodes[r + 16];
      const cid1 = cidPerNode[id1], cid2 = cidPerNode[id2];
      const colorOf = function (id) {
        const mIdx = idxByNode[id];
        return P.partitionColor ? P.partitionColor(f.membership[mIdx]) : "#888";
      };
      tr.innerHTML =
        '<td><span class="swatch" style="background:' + colorOf(id1) + '"></span>' + id1 + '</td>' +
        '<td>' + cid1 + '</td>' +
        '<td><span class="swatch" style="background:' + colorOf(id2) + '"></span>' + id2 + '</td>' +
        '<td>' + cid2 + '</td>';
      compTblBody.appendChild(tr);
    }
  }

  function renderTip(f) {
    const tip = document.getElementById("g-walk-tip");
    if (tip) tip.textContent = f.prose;
  }

  function refreshPhaseChips(f) {
    Object.keys(phaseChips).forEach(function (p) {
      const chip = phaseChips[p];
      const pn = parseInt(p, 10);
      chip.classList.remove("active", "done");
      if (pn === f.phase) chip.classList.add("active");
      else if (pn < f.phase) chip.classList.add("done");
    });
  }

  // ── Mount step controller ───────────────────────────────────────
  const total = frames.length;
  const ctl = C.stepController({
    total: total,
    prevBtn: document.getElementById("g-walk-prev"),
    nextBtn: document.getElementById("g-walk-next"),
    resetBtn: document.getElementById("g-walk-reset"),
    endBtn: document.getElementById("g-walk-end"),
    labelCur: document.getElementById("g-walk-cur"),
    labelTotal: document.getElementById("g-walk-total"),
    onRender: function (idx) {
      const f = frames[idx];
      if (!f) return;
      applyFrame(f);
      const status = document.getElementById("g-walk-status");
      const stats = document.getElementById("g-walk-stats");
      const level = document.getElementById("g-walk-level");
      const prose = document.getElementById("g-walk-prose");
      if (status) status.innerHTML = statusFor(f);
      if (stats) stats.innerHTML = statsFor(f);
      if (level) level.textContent = "frame " + idx;
      if (prose) prose.innerHTML = '<span class="phase-tag">phase ' + f.phase + '</span>' + f.label;
      renderBitmap(f);
      renderQueue(f);
      renderCounters(f);
      renderCompTable(f);
      renderTip(f);
      refreshPhaseChips(f);
    },
    keyboard: false,
  });

  // ── Stage 3: final compare ──────────────────────────────────────
  const finalAssign = result.finalAssign;
  P.renderFixture("g-final-out", {
    membership: Array.from(finalAssign).map(function (v) { return v < 0 ? -1 : v; }),
    pinned: true, nodeR: 9,
  });
  P.renderFixture("g-final-gt", { useGT: true, pinned: true, nodeR: 9 });
  const summary = document.getElementById("g-final-summary");
  if (summary) {
    let kept = 0, dropped = 0;
    finalAssign.forEach(function (v) { if (v < 0) dropped += 1; else kept += 1; });
    summary.innerHTML = "input clusters: " + result.events.length
      + " &middot; output clusters: " + result.numClusters
      + " &middot; nodes kept: " + kept + " / dropped: " + dropped;
  }
})();
