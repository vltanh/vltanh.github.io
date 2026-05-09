/* CM page glue: drives the cut + recluster walker over the kernel trace.
 *
 * Layout:
 *   stage 0 — input fixture
 *   stage 1 — round walker (live state panels: round + queues + survivors)
 *             + per-event scrubber + play/pause + per-pop OR per-round
 *               granularity toggle
 *             + base / resolution / criterion / seed pickers (rerun on change)
 *   stage 2 — lineage tree (parent_to_child_map as a d3 hierarchy that
 *             grows alongside the walker)
 *   stage 3 — edge case callouts (static)
 *   stage 4 — final output vs ground truth + history listing
 *
 * State simulator: the kernel emits init + mincut + recluster + round-end
 * events. The page replays them sequentially to derive per-step
 * { round, toBeMincut, toBeClustered, survivors, lineageEdges } so each
 * scrub position can render the queues + survivors deck + lineage
 * highlight.
 *
 * Tooltip prose sourced from cm_dossier.md (per-step seed table).
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.CM || !COMDET.FIXTURE) {
    console.warn("[cm page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, F = C.FIXTURE;
  const d3 = window.d3;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "cm" });
  }

  const idxByNode = {};
  F.nodes.forEach(function (id, i) { idxByNode[id] = i; });

  // ── URL-state hooks ──────────────────────────────────────────────
  // ?seed=N + ?base=leiden-cpm + ?res=0.0001 + ?crit=1log_10(n)
  function readURL() {
    const u = new URLSearchParams(window.location.search);
    const seedRaw = parseInt(u.get("seed"), 10);
    return {
      seed: Number.isFinite(seedRaw) ? seedRaw : 0,
      base: u.get("base") || "leiden-cpm",
      res:  parseFloat(u.get("res") || "0.0001"),
      crit: u.get("crit") || "1log_10(n)",
    };
  }
  function writeURL(opts) {
    const u = new URLSearchParams(window.location.search);
    u.set("seed", String(opts.seed));
    u.set("base", opts.base);
    u.set("res",  String(opts.res));
    u.set("crit", opts.crit);
    window.history.replaceState(null, "", "?" + u.toString());
  }

  // ── Picker UI sync from URL ──────────────────────────────────────
  const elBase = document.getElementById("cm-base");
  const elRes  = document.getElementById("cm-res");
  const elCrit = document.getElementById("cm-crit");
  const elSeed = document.getElementById("cm-seed");

  function applyPickersFromURL() {
    const u = readURL();
    if (elBase) elBase.value = u.base;
    if (elRes)  elRes.value  = String(u.res);
    if (elCrit) elCrit.value = u.crit;
    if (elSeed) elSeed.value = String(u.seed);
    return u;
  }
  let cur = applyPickersFromURL();
  writeURL(cur);

  // Stage 0: input.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // ── Per-step state simulator ─────────────────────────────────────
  // Walks the kernel trace and produces, for each filtered walker step,
  // the queue + survivor + lineage state at that point.
  function simulateState(allEvents) {
    // Walker visible events = mincut + recluster (init + round-end are
    // bookkeeping, mirrored into state implicitly).
    const walkerEvents = allEvents.filter(function (e) {
      return e.kind === "mincut" || e.kind === "recluster";
    });

    // states[0] = pre-walk (pre-init); states[i+1] = state AFTER processing
    // the i-th walker event in original-event order.
    const states = [];
    let round = 0;
    let toBeMincut = [];
    let toBeClustered = [];
    let survivors = [];
    // lineageNodes: { id -> { id, round, parent, children, status } }
    const nodes = new Map();
    // lineageEdges: array of { from, to, round, addedAt (walker idx) }
    const edges = [];
    let nextSyntheticRound = 0;
    // Walker-idx pointer that advances when we replay a mincut/recluster.
    let walkerIdx = 0;

    function pushState() {
      states.push({
        round: round,
        toBeMincut: toBeMincut.map(function (q) { return { id: q.id, n: q.nodes.length, nodes: q.nodes.slice() }; }),
        toBeClustered: toBeClustered.map(function (q) { return { id: q.id, parent: q.parent, n: q.nodes.length, nodes: q.nodes.slice() }; }),
        survivors: survivors.map(function (s) { return { id: s.id, n: s.nodes.length, nodes: s.nodes.slice() }; }),
        currentEvent: walkerIdx > 0 ? walkerEvents[walkerIdx - 1] : null,
        nodes: cloneNodeMap(nodes),
        edges: edges.slice(),
      });
    }
    function cloneNodeMap(m) {
      const out = new Map();
      m.forEach(function (v, k) { out.set(k, Object.assign({}, v, { children: v.children.slice() })); });
      return out;
    }

    function ensureNode(id, round, parent, status) {
      if (!nodes.has(id)) {
        nodes.set(id, { id: id, round: round, parent: parent, children: [], status: status || "internal" });
      }
      return nodes.get(id);
    }

    // Pre-walk snapshot.
    pushState();

    let curMincut = null; // remember the just-popped mincut event so the
                          // matching recluster can be matched by parent id

    for (let ei = 0; ei < allEvents.length; ei++) {
      const ev = allEvents[ei];
      if (ev.kind === "init") {
        ev.initialQueue.forEach(function (q) {
          toBeMincut.push({ id: q.id, nodes: q.nodes.slice() });
          ensureNode(q.id, 0, null, "internal");
        });
        // No state push — init is silent.
      } else if (ev.kind === "mincut") {
        // Find + remove the popped cluster from toBeMincut.
        const popIdx = toBeMincut.findIndex(function (q) { return q.id === ev.id; });
        if (popIdx >= 0) toBeMincut.splice(popIdx, 1);
        curMincut = ev;
        if (ev.wellConnected) {
          survivors.push({ id: ev.id, nodes: ev.nodes.slice() });
          const n = ensureNode(ev.id, round, null, "internal");
          n.status = "surv";
        }
        walkerIdx++;
        pushState();
      } else if (ev.kind === "recluster") {
        // Children pushed with parent=cur.id. The recluster event already
        // carries children arrays; assign provisional ids = parent+"."+i.
        // The fresh ids are assigned at round-end drain (event below).
        ev.children.forEach(function (childNodes) {
          toBeClustered.push({ id: null, parent: ev.parentId, nodes: childNodes.slice() });
        });
        // Lineage: do NOT add edges yet — child ids are pending fresh-id
        // assignment at round-end. The round-end drain will create edges
        // in the same order as toBeClustered append.
        walkerIdx++;
        pushState();
      } else if (ev.kind === "round-end") {
        // Drain toBeClustered into next round's toBeMincut.
        // Fresh ids: same order as the kernel's nextId++ sequence. The
        // kernel result.parentToChild has the canonical mapping; we need
        // it to recover the assigned ids. But the kernel gives us
        // parentToChild already populated. For the lineage we just
        // need the order of pushes to match kernel order.
        // Approach: scan parentToChild for each parent in push-order,
        // popping ids one at a time as we drain.
        const parentCounters = new Map();
        toBeClustered.forEach(function (q) {
          const p = q.parent;
          const list = currentParentToChild.get(p) || [];
          const c = parentCounters.get(p) || 0;
          // Skip ids already consumed in earlier rounds for this parent.
          const consumedSoFar = parentConsumed.get(p) || 0;
          const freshId = list[consumedSoFar + c];
          q.id = (freshId != null) ? freshId : -(1 + ei);
          parentCounters.set(p, c + 1);
          edges.push({ from: p, to: q.id, round: round, addedAt: walkerIdx });
          ensureNode(q.id, round + 1, p, "internal");
          const parNode = nodes.get(p);
          if (parNode) parNode.children.push(q.id);
          // dropped (size 1) annotation
          if (q.nodes.length <= 1) {
            const child = nodes.get(q.id);
            if (child) child.status = "dropped";
          }
        });
        // Update parentConsumed counters.
        parentCounters.forEach(function (v, p) {
          parentConsumed.set(p, (parentConsumed.get(p) || 0) + v);
        });
        toBeClustered.forEach(function (q) {
          toBeMincut.push({ id: q.id, nodes: q.nodes });
        });
        toBeClustered = [];
        round++;
        // Don't pushState — the immediately-prior state covers post-recluster
        // pre-round-drain. The first mincut of the new round will reflect the
        // drain. But we need the "round" counter visible to UIs immediately,
        // so we update the LAST state in place.
        if (states.length > 0) {
          states[states.length - 1].round = round;
          states[states.length - 1].toBeMincut = toBeMincut.map(function (q) {
            return { id: q.id, n: q.nodes.length, nodes: q.nodes.slice() };
          });
          states[states.length - 1].toBeClustered = [];
        }
      }
    }

    return { walkerEvents: walkerEvents, states: states, lineage: { nodes: nodes, edges: edges } };
  }

  // Rebuild hooks: re-run kernel on any picker change, swap snapshots +
  // walker controller's total + render fresh.
  let walkerCtl = null;
  let walkerRender = null;
  let walkerViz = null;
  let curStates = null;
  let curWalkerEvents = null;
  let curResult = null;
  // Per-parent consumption counter for lineage child-id resolution.
  let currentParentToChild = new Map();
  let parentConsumed = new Map();

  function buildSnapshots(walkerEvents, states) {
    // Per walker step: which chunks should the graph show.
    const initialChunks = [];
    states[0].toBeMincut.forEach(function (q) { initialChunks.push(q.nodes.slice()); });
    let chunks = initialChunks.slice();
    const baseMem = F.nodes.map(function () { return -1; });
    function membershipOf(c) {
      const out = baseMem.slice();
      c.forEach(function (chunk, ci) {
        chunk.forEach(function (id) {
          const ix = idxByNode[id];
          if (ix != null) out[ix] = ci;
        });
      });
      return out;
    }
    const snapshots = [membershipOf(chunks)];
    walkerEvents.forEach(function (ev) {
      if (ev.kind === "recluster") {
        const childUnion = new Set();
        ev.children.forEach(function (c) { c.forEach(function (id) { childUnion.add(id); }); });
        let target = -1;
        for (let k = 0; k < chunks.length; k++) {
          const setK = new Set(chunks[k]);
          let hits = 0;
          childUnion.forEach(function (id) { if (setK.has(id)) hits++; });
          if (hits === childUnion.size && hits > 0) { target = k; break; }
        }
        if (target >= 0) {
          const before = chunks.slice(0, target);
          const after = chunks.slice(target + 1);
          const fresh = ev.children.map(function (c) { return c.slice(); });
          chunks = before.concat(after).concat(fresh);
        }
      }
      snapshots.push(membershipOf(chunks));
    });
    return snapshots;
  }

  // ── Status + prose ───────────────────────────────────────────────
  const TIP_MINCUT_KEEP = "VieCut cactus mincut returned cut. Threshold passed (cut > pre_log * log(n)) — cluster joins survivors. <code>cm.h:77-81</code>, <code>constrained.h:431-433</code>.";
  const TIP_MINCUT_FAIL = "VieCut cactus mincut returned cut below threshold. Cluster fails the well-connected check; both cut sides head to the base algorithm next. <code>cm.h:77-81</code>, <code>constrained.h:431-433</code>.";
  const TIP_RECLUSTER   = "Each side &gt; 1 re-clustered via the base algorithm. Returned communities pushed into <code>to_be_clustered</code> with the original cluster's id as parent; fresh ids assigned at round-end drain. <code>cm.h:137 &rarr; constrained.h:301-323</code>, <code>cm.cpp:90-92</code>.";

  function statusFor(state) {
    if (!state || !state.currentEvent) return "stage 0 &middot; planted partition (pre-walk)";
    const ev = state.currentEvent;
    if (ev.kind === "mincut") {
      return "round " + ev.round + " &middot; mincut id=" + ev.id
        + " (n=" + ev.clusterSize + ", cut=" + ev.cut
        + ", thr=" + ev.threshold.toFixed(3) + ") &middot; "
        + (ev.wellConnected ? "kept &rarr; survivor" : "fail &rarr; recluster next");
    }
    return "round " + ev.round + " &middot; recluster parent=" + ev.parentId
      + " (" + ev.baseAlgo + ") &middot; " + ev.children.length + " child cluster(s)";
  }

  function panelHTML(state) {
    if (!state || !state.currentEvent) {
      return '<div class="step-desc">Press <b>next</b> to begin. The walker pops one cluster from <code>to_be_mincut</code>, runs the cactus mincut, checks the threshold, and either accepts the cluster as a survivor or hands both cut sides to the base algorithm.</div>';
    }
    const ev = state.currentEvent;
    if (ev.kind === "mincut") {
      let html = '<div class="step-desc">cluster id <b>' + ev.id
               + '</b> &middot; size <b>' + ev.clusterSize
               + '</b> &middot; mincut <b>' + ev.cut
               + '</b> vs threshold <b>' + ev.threshold.toFixed(3)
               + '</b> &middot; verdict: <b>'
               + (ev.wellConnected ? 'well-connected (kept)' : 'not well-connected (cut + recluster)')
               + '</b></div>';
      html += '<table class="cand-table"><thead><tr><th>side</th><th>size</th><th>nodes</th></tr></thead><tbody>';
      [["in", ev.inPartition], ["out", ev.outPartition]].forEach(function (pair) {
        html += '<tr><td>' + pair[0] + '</td><td>' + pair[1].length + '</td><td>'
              + pair[1].slice().sort(function (a, b) { return a - b; }).join(', ')
              + '</td></tr>';
      });
      html += '</tbody></table>';
      html += '<div class="step-tip">' + (ev.wellConnected ? TIP_MINCUT_KEEP : TIP_MINCUT_FAIL) + '</div>';
      return html;
    }
    let html = '<div class="step-desc">parent cluster id <b>' + ev.parentId
             + '</b> reclustered with <b>' + ev.baseAlgo
             + '</b> at resolution ' + ev.baseResolution
             + ' &middot; produced <b>' + ev.children.length
             + '</b> child cluster(s)</div>';
    html += '<table class="cand-table"><thead><tr><th>child</th><th>size</th><th>nodes</th></tr></thead><tbody>';
    ev.children.forEach(function (c, i) {
      html += '<tr><td>' + (i + 1) + '</td><td>' + c.length + '</td><td>'
            + c.slice().sort(function (a, b) { return a - b; }).join(', ')
            + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="step-tip">' + TIP_RECLUSTER + '</div>';
    return html;
  }

  // ── Side state panels ────────────────────────────────────────────
  function renderQueueCard(elId, items, surv, currentId) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (items.length === 0) {
      el.innerHTML = '<div class="empty">empty</div>';
      return;
    }
    el.innerHTML = items.map(function (it) {
      const sorted = it.nodes.slice().sort(function (a, b) { return a - b; });
      const cls = (surv ? " surv" : "") + (currentId != null && it.id === currentId ? " cur" : "");
      const idLabel = (it.id == null) ? "?" : it.id;
      return '<div class="row' + cls + '"><span class="cid">' + idLabel + '</span> n=' + it.n + ' [' + sorted.join(",") + ']</div>';
    }).join("");
  }

  function renderRoundPanel(state) {
    const r = document.getElementById("cm-round-num");
    const m = document.getElementById("cm-q-mincut");
    const c = document.getElementById("cm-q-clust");
    const s = document.getElementById("cm-q-surv");
    if (r) r.textContent = state.round;
    if (m) m.textContent = state.toBeMincut.length;
    if (c) c.textContent = state.toBeClustered.length;
    if (s) s.textContent = state.survivors.length;
    const curId = (state.currentEvent && state.currentEvent.kind === "mincut") ? state.currentEvent.id : null;
    renderQueueCard("cm-state-mincut", state.toBeMincut, false, curId);
    renderQueueCard("cm-state-clust",  state.toBeClustered, false, null);
    renderQueueCard("cm-state-surv",   state.survivors, true, null);
  }

  // ── Lineage tree (d3) ────────────────────────────────────────────
  // Build a virtual root with edges to every initial cluster id whose
  // parent is null. Then render via d3.tree() once per re-run; per-step
  // update only updates highlight classes.
  let lineageBuilt = null; // { root, nodeSel, linkSel }
  function buildLineageTree(finalState) {
    const host = document.getElementById("cm-lineage-svg");
    if (!host || !d3) return;
    host.innerHTML = "";

    // Root virtual node.
    const all = Array.from(finalState.nodes.values());
    if (all.length === 0) {
      host.innerHTML = '<div style="color: var(--paper-3); font-style: italic; padding: .4rem;">no clusters yet &mdash; run the walker.</div>';
      lineageBuilt = null;
      return;
    }
    const data = { id: "root", children: [] };
    const byId = new Map();
    all.forEach(function (n) {
      byId.set(n.id, { id: n.id, n: n, children: [] });
    });
    all.forEach(function (n) {
      const node = byId.get(n.id);
      n.children.forEach(function (cid) {
        const c = byId.get(cid);
        if (c) node.children.push(c);
      });
    });
    // Roots = nodes with no parent attribution = those at round 0 OR
    // those whose parent is not in the map.
    all.forEach(function (n) {
      if (n.parent == null || !byId.has(n.parent)) {
        data.children.push(byId.get(n.id));
      }
    });

    const root = d3.hierarchy(data);
    const nodeCount = root.descendants().length;
    const depth = root.height + 1;
    const W = Math.max(640, nodeCount * 30);
    const H = Math.max(200, depth * 70);
    const treeLayout = d3.tree().size([W - 40, H - 60]);
    treeLayout(root);

    const svg = d3.select(host).append("svg")
      .attr("width", W).attr("height", H)
      .attr("viewBox", "0 0 " + W + " " + H);
    const g = svg.append("g").attr("transform", "translate(20, 30)");

    g.append("g").selectAll("path.ln-link")
      .data(root.links().filter(function (l) { return l.source.data.id !== "root"; }))
      .enter()
      .append("path")
      .attr("class", "ln-link")
      .attr("d", d3.linkVertical().x(function (d) { return d.x; }).y(function (d) { return d.y; }));

    const nodeG = g.append("g").selectAll("g.ln-node")
      .data(root.descendants().filter(function (d) { return d.data.id !== "root"; }))
      .enter()
      .append("g")
      .attr("class", "ln-node")
      .attr("data-cid", function (d) { return d.data.id; })
      .attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });

    nodeG.append("circle").attr("r", 8);
    nodeG.append("text")
      .attr("dy", "-0.9em").attr("text-anchor", "middle")
      .text(function (d) { return d.data.id; });

    lineageBuilt = { root: root, nodeSel: nodeG, host: host };
  }

  function updateLineageHighlight(state) {
    if (!lineageBuilt) return;
    const survIds = new Set(state.survivors.map(function (s) { return s.id; }));
    const inFlightIds = new Set();
    state.toBeMincut.forEach(function (q) { inFlightIds.add(q.id); });
    state.toBeClustered.forEach(function (q) { if (q.id != null) inFlightIds.add(q.id); });
    const curId = (state.currentEvent && state.currentEvent.kind === "mincut") ? state.currentEvent.id
                 : (state.currentEvent && state.currentEvent.kind === "recluster") ? state.currentEvent.parentId
                 : null;

    lineageBuilt.nodeSel.attr("class", function (d) {
      const cid = d.data.id;
      const node = d.data.n;
      let cls = "ln-node";
      if (survIds.has(cid)) cls += " surv";
      else if (inFlightIds.has(cid)) cls += " pending";
      else if (node && node.status === "dropped") cls += " dropped";
      if (cid === curId) cls += " cur";
      return cls;
    });
  }

  // ── Run + wire ───────────────────────────────────────────────────
  function runAndMount() {
    cur = applyPickersFromURL();
    writeURL(cur);
    if (C.MINCUT && C.MINCUT.viecut && typeof C.MINCUT.viecut.setSeed === "function") {
      C.MINCUT.viecut.setSeed(cur.seed);
    }
    let result;
    try {
      result = C.CM.runCM(F.gt, {
        criterion: cur.crit, algorithm: cur.base, resolution: cur.res, seed: cur.seed,
      });
    } catch (e) {
      console.error("[cm page] runCM failed", e);
      const status = document.getElementById("g-walk-status");
      if (status) status.textContent = "kernel error: " + e.message;
      return;
    }
    curResult = result;

    // Reset lineage helpers (consumed by simulator).
    currentParentToChild = new Map();
    parentConsumed = new Map();
    Object.keys(result.parentToChild).forEach(function (pid) {
      currentParentToChild.set(parseInt(pid, 10), result.parentToChild[pid].slice());
      // Treat string "-1" key as -1 number too.
      if (pid === "-1") currentParentToChild.set(-1, result.parentToChild[pid].slice());
    });

    const sim = simulateState(result.events);
    curWalkerEvents = sim.walkerEvents;
    curStates = sim.states;
    const snapshots = buildSnapshots(curWalkerEvents, curStates);

    // Initial lineage build (final state).
    buildLineageTree(curStates[curStates.length - 1]);

    function snapshotAt(idx) { return snapshots[idx]; }

    const walker = P.mountStepWalker({
      vizHostId: "g-walk-cy",
      panelHostId: "g-walk-panel",
      ctlPrefix: "g-walk",
      events: curWalkerEvents,
      snapshotAt: snapshotAt,
      sidePanelHTML: function (idx) {
        const state = curStates[idx];
        return panelHTML(state);
      },
      onRender: function (idx) {
        const state = curStates[idx] || curStates[0];
        const status = document.getElementById("g-walk-status");
        const stats = document.getElementById("g-walk-stats");
        if (status) status.innerHTML = statusFor(state);
        if (stats) {
          let surv = 0, recl = 0;
          for (let k = 0; k < idx; k++) {
            const e = curWalkerEvents[k];
            if (e.kind === "mincut" && e.wellConnected) surv++;
            if (e.kind === "recluster") recl++;
          }
          stats.innerHTML = "survivors: " + surv + " &middot; reclusters: " + recl;
        }
        renderRoundPanel(state);
        updateLineageHighlight(state);
        const scrub = document.getElementById("cm-scrub");
        if (scrub) {
          scrub.value = String(idx);
          scrub.max = String(curStates.length - 1);
        }
      },
    });
    walkerCtl = walker.controller;
    walkerRender = walker.render;
    walkerViz = walker.viz;

    // Stage 4: final compare.
    P.renderFixture("g-final-out", {
      membership: Array.from(result.finalAssign), pinned: true, nodeR: 9,
    });
    P.renderFixture("g-final-gt", { useGT: true, pinned: true, nodeR: 9 });
    const summary = document.getElementById("g-final-summary");
    if (summary) {
      let kept = 0, dropped = 0;
      result.finalAssign.forEach(function (v) { if (v < 0) dropped++; else kept++; });
      summary.innerHTML = "survivors: " + result.numClusters
        + " &middot; nodes kept: " + kept + " / dropped: " + dropped
        + " &middot; criterion: " + result.criterion
        + " &middot; base algorithm: " + result.algorithm
        + " (resolution=" + result.resolution + ")";
    }
    const histEl = document.getElementById("g-history");
    if (histEl) {
      const keys = Object.keys(result.parentToChild).filter(function (k) { return k !== "-1"; });
      if (keys.length === 0) {
        histEl.innerHTML = '<em>no splits or reclusters fired on this fixture &middot; every input cluster passed the threshold.</em>';
      } else {
        let html = '<b>cluster history</b> (parent &rarr; children):<br>';
        keys.forEach(function (pid) {
          html += pid + ' &rarr; [' + result.parentToChild[pid].join(', ') + ']<br>';
        });
        histEl.innerHTML = html;
      }
    }
  }

  // ── Picker change handlers ───────────────────────────────────────
  function pickerChange() {
    const u = readURL();
    const next = {
      seed: parseInt(elSeed.value, 10) || 0,
      base: elBase.value,
      res:  parseFloat(elRes.value),
      crit: elCrit.value,
    };
    if (next.seed === u.seed && next.base === u.base && next.res === u.res && next.crit === u.crit) return;
    writeURL(next);
    // Tear down + rebuild walker. mountStepWalker creates new
    // controller — buttons still bound to old listeners. To avoid
    // double-binding, mountStepWalker's handlers stay live; the controller
    // rerenders via reconfigureKeep when total changes.
    // Simpler approach: reload the page so DOM event handlers reset.
    window.location.search = "?" + new URLSearchParams(next).toString();
  }
  if (elBase) elBase.addEventListener("change", pickerChange);
  if (elRes)  elRes.addEventListener("change",  pickerChange);
  if (elCrit) elCrit.addEventListener("change", pickerChange);
  if (elSeed) elSeed.addEventListener("change", pickerChange);

  // ── Scrubber ─────────────────────────────────────────────────────
  const elScrub = document.getElementById("cm-scrub");
  if (elScrub) {
    elScrub.addEventListener("input", function () {
      if (!walkerCtl) return;
      walkerCtl.set(parseInt(elScrub.value, 10) || 0);
    });
  }

  // ── Play/pause ───────────────────────────────────────────────────
  const elPlay = document.getElementById("cm-play");
  let playTimer = null;
  let playSpeedMs = 800;
  function setPlayLabel(playing) {
    if (elPlay) elPlay.textContent = playing ? "pause" : "play";
  }
  function stopPlay() {
    if (playTimer != null) clearInterval(playTimer);
    playTimer = null;
    setPlayLabel(false);
  }
  function startPlay() {
    if (!walkerCtl) return;
    if (playTimer != null) return;
    setPlayLabel(true);
    playTimer = setInterval(function () {
      if (!walkerCtl) { stopPlay(); return; }
      const cur = walkerCtl.idx;
      const total = walkerCtl.total;
      const elGran = document.getElementById("cm-gran-round");
      const granRound = elGran && elGran.checked;
      let target = cur + 1;
      if (granRound && curStates) {
        // Skip to the next state where round increments.
        const curRound = curStates[cur] ? curStates[cur].round : 0;
        for (let i = cur + 1; i < curStates.length; i++) {
          if (curStates[i].round !== curRound) { target = i; break; }
          if (i === curStates.length - 1) target = i;
        }
      }
      if (target >= total) {
        walkerCtl.set(total - 1);
        stopPlay();
        return;
      }
      walkerCtl.set(target);
    }, playSpeedMs);
  }
  if (elPlay) {
    elPlay.addEventListener("click", function () {
      if (playTimer) stopPlay(); else startPlay();
    });
  }

  // ── Granularity toggle: per-pop ↔ per-round ──────────────────────
  // Affects `next` button: chained jump to the next round-end state.
  const elNext = document.getElementById("g-walk-next");
  const elPrev = document.getElementById("g-walk-prev");
  if (elNext) {
    elNext.addEventListener("click", function (ev) {
      const elGran = document.getElementById("cm-gran-round");
      if (!elGran || !elGran.checked || !walkerCtl || !curStates) return;
      // intercept default next: jump to next-round state
      ev.stopImmediatePropagation();
      const cur = walkerCtl.idx;
      const total = walkerCtl.total;
      const curRound = curStates[cur] ? curStates[cur].round : 0;
      let target = total - 1;
      for (let i = cur + 1; i < curStates.length; i++) {
        if (curStates[i].round !== curRound) { target = i; break; }
      }
      walkerCtl.set(Math.min(total - 1, target));
    }, true);
  }
  if (elPrev) {
    elPrev.addEventListener("click", function (ev) {
      const elGran = document.getElementById("cm-gran-round");
      if (!elGran || !elGran.checked || !walkerCtl || !curStates) return;
      ev.stopImmediatePropagation();
      const cur = walkerCtl.idx;
      const curRound = curStates[cur] ? curStates[cur].round : 0;
      let target = 0;
      for (let i = cur - 1; i >= 0; i--) {
        if (curStates[i].round !== curRound) { target = i; break; }
      }
      walkerCtl.set(Math.max(0, target));
    }, true);
  }

  // Stop play on any manual interaction.
  ["g-walk-next", "g-walk-prev", "g-walk-reset", "g-walk-end", "cm-scrub"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", function () { if (id !== "cm-play") stopPlay(); });
  });

  // ── Boot ─────────────────────────────────────────────────────────
  runAndMount();
})();
