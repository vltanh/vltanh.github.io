/* Shared comdet page helpers. Used by every per-algorithm page.
 *
 * Note: COMDET.VIZ from shared.js is a verbatim netgen port keyed off
 * netgen's 20-node fixture (POSITIONS / NODES / CLUSTER_OF). The comdet
 * gallery uses its own 32-node fixture (COMDET.FIXTURE), so we ship a
 * thin VIZ-shaped wrapper here that mimics the relevant API surface
 * (setNodeStyle, addNodeClass, removeNodeClass, addEdgeClass,
 * eachEdge, animateEdgeOpacityByClass, setEdges) on top of d3 + the
 * 32-node fixture.
 *
 * Exposes COMDET.PAGE with:
 *   renderFixture(hostId, opts)
 *   recolour(viz, fixture, membership)
 *   focusNode(viz, fixture, nodeId, ringClass?)
 *   mountStepWalker(opts)
 *   mountAggregation(opts)
 *   mountFinalCompare(opts)
 *   computeClusterStats(membership, fixture?)
 *   renderStatsTable(tbody, membership, fixture?)
 *   buildLeidenGraph(fixture?)
 *   indexById(fixture)
 *   partitionColor(c)
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  // ── Palette ─────────────────────────────────────────────────────
  function partitionColor(c) {
    if (c == null || c < 0) return "#888";
    const slots = ["#7b9bd6", "#e0a649", "#8fbb70", "#b07ac9"];
    if (c < slots.length) return slots[c];
    const outlier = ["#7e468f", "#5fa0b3", "#a3b56b", "#c98a8a",
                     "#9384bf", "#d39362", "#7c9c7c", "#bf7ca5",
                     "#5e8aa8", "#bda04a", "#82a890", "#a07b9c"];
    return outlier[(c - slots.length) % outlier.length];
  }

  function indexById(fixture) {
    const idx = {};
    fixture.nodes.forEach(function (id, i) { idx[id] = i; });
    return idx;
  }

  // ── Mini-VIZ ────────────────────────────────────────────────────
  // d3-based renderer for the 32-node fixture with COMDET.VIZ-style API.
  function renderFixture(hostId, opts) {
    opts = opts || {};
    const F = C.FIXTURE;
    const host = document.getElementById(hostId);
    if (!host || typeof d3 === "undefined") return null;
    host.innerHTML = "";
    const idxById = indexById(F);
    const useGT = !!opts.useGT;
    const membership = opts.membership || (useGT ? F.gt : null);
    const colorFn = opts.colorFn || function (id) {
      if (membership) {
        const i = idxById[id];
        return partitionColor(membership[i]);
      }
      return "#888";
    };
    const nodeR = opts.nodeR || 12;
    const showLabels = opts.showLabels !== false;

    const xs = F.positions.map(function (p) { return p.x; });
    const ys = F.positions.map(function (p) { return p.y; });
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const pad = opts.pad || 30;
    const vbW = (maxX - minX) + pad * 2;
    const vbH = (maxY - minY) + pad * 2;
    const offX = pad - minX, offY = pad - minY;

    const svg = d3.select(host).append("svg")
      .attr("class", "viz-svg")
      .attr("viewBox", "0 0 " + vbW + " " + vbH)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%").style("height", "100%")
      .style("display", "block");

    // Build node + edge data.
    const POS = {};
    F.positions.forEach(function (p) { POS[p.id] = { x: p.x + offX, y: p.y + offY }; });
    const nodesData = F.nodes.map(function (id, i) {
      return {
        id: id, idx: i, x: POS[id].x, y: POS[id].y,
        homeX: POS[id].x, homeY: POS[id].y,
        color: colorFn(id),
        cls: new Set(),
      };
    });
    const nodeById = {};
    nodesData.forEach(function (n) { nodeById[n.id] = n; });
    const linksData = F.edges.map(function (e, i) {
      return {
        id: "e-" + i,
        source: nodeById[e[0]],
        target: nodeById[e[1]],
        u: e[0], v: e[1],
        cls: new Set(),
      };
    });

    const gLinks = svg.append("g").attr("class", "links");
    const gNodes = svg.append("g").attr("class", "nodes");
    const gLabels = svg.append("g").attr("class", "labels");

    const link = gLinks.selectAll("line").data(linksData).join("line")
      .attr("class", function (d) { return "viz-edge"; })
      .attr("x1", function (d) { return d.source.x; })
      .attr("y1", function (d) { return d.source.y; })
      .attr("x2", function (d) { return d.target.x; })
      .attr("y2", function (d) { return d.target.y; })
      .attr("stroke", "#3a3f4a")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.65);

    const node = gNodes.selectAll("circle").data(nodesData).join("circle")
      .attr("class", "viz-node")
      .attr("cx", function (d) { return d.x; })
      .attr("cy", function (d) { return d.y; })
      .attr("r", nodeR)
      .attr("fill", function (d) { return d.color; })
      .attr("stroke", "#1b2033")
      .attr("stroke-width", 1.5)
      .style("cursor", "grab");

    let label = null;
    if (showLabels) {
      label = gLabels.selectAll("text").data(nodesData).join("text")
        .attr("x", function (d) { return d.x; })
        .attr("y", function (d) { return d.y; })
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-family", "Special Elite, Courier New, monospace")
        .attr("font-size", Math.max(8, Math.round(nodeR * 0.7)))
        .attr("fill", "#1b2033")
        .attr("pointer-events", "none")
        .text(function (d) { return d.id; });
    }

    // Optional drag (default off when pinned).
    if (!opts.pinned) {
      node.call(d3.drag()
        .on("drag", function (e, d) {
          d.x = e.x; d.y = e.y;
          d3.select(this).attr("cx", d.x).attr("cy", d.y);
          if (label) label.filter(function (lab) { return lab.id === d.id; })
                          .attr("x", d.x).attr("y", d.y);
          link.filter(function (l) { return l.source.id === d.id || l.target.id === d.id; })
              .attr("x1", function (l) { return l.source.x; })
              .attr("y1", function (l) { return l.source.y; })
              .attr("x2", function (l) { return l.target.x; })
              .attr("y2", function (l) { return l.target.y; });
        })
        .on("end", function (e, d) {
          // Snap back home.
          d.x = d.homeX; d.y = d.homeY;
          d3.select(this).transition().duration(220).attr("cx", d.x).attr("cy", d.y);
        }));
    }

    function classAdd(d, c) { d.cls.add(c); }
    function classRemove(d, c) { d.cls.delete(c); }
    function classOf(d) { return Array.from(d.cls).join(" "); }

    function nodeStrokeFor(d) {
      if (d.cls.has("hi")) return "#c7801e";
      return "#1b2033";
    }
    function nodeWidthFor(d) {
      if (d.cls.has("hi")) return 3.4;
      return 1.5;
    }
    function nodeOpacityFor(d) {
      if (d.cls.has("dim")) return 0.28;
      return 1.0;
    }
    function edgeStrokeFor(d) {
      if (d.cls.has("pick")) return "#5fa0b3";
      if (d.cls.has("dim")) return "#3a3f4a";
      return "#3a3f4a";
    }
    function edgeOpacityFor(d) {
      if (d.cls.has("dim")) return 0.18;
      return 0.65;
    }

    function repaintNode(d) {
      const sel = node.filter(function (x) { return x.id === d.id; });
      sel.attr("stroke", nodeStrokeFor(d))
         .attr("stroke-width", nodeWidthFor(d))
         .attr("opacity", nodeOpacityFor(d));
    }
    function repaintEdge(d) {
      const sel = link.filter(function (x) { return x.id === d.id; });
      sel.attr("stroke", edgeStrokeFor(d))
         .attr("opacity", edgeOpacityFor(d));
    }

    return {
      svg: svg.node(),
      nodes: nodesData,
      links: linksData,
      nodeById: nodeById,
      setNodeStyle: function (id, style) {
        const d = nodeById[id]; if (!d) return;
        if (style.color != null) {
          d.color = style.color;
          node.filter(function (x) { return x.id === id; })
              .transition().duration(220).attr("fill", d.color);
        }
        if (style.r != null) {
          node.filter(function (x) { return x.id === id; }).attr("r", style.r);
        }
      },
      addNodeClass: function (id, cls) {
        const d = nodeById[id]; if (!d) return;
        classAdd(d, cls); repaintNode(d);
      },
      removeNodeClass: function (id, cls) {
        const d = nodeById[id]; if (!d) return;
        classRemove(d, cls); repaintNode(d);
      },
      eachNode: function (fn) { nodesData.forEach(fn); },
      addEdgeClass: function (id, cls) {
        const d = linksData.find(function (e) { return e.id === id; });
        if (!d) return;
        classAdd(d, cls); repaintEdge(d);
      },
      removeEdgeClass: function (id, cls) {
        const d = linksData.find(function (e) { return e.id === id; });
        if (!d) return;
        classRemove(d, cls); repaintEdge(d);
      },
      eachEdge: function (fn) {
        linksData.forEach(function (e) { fn({ id: e.id, source: e.source, target: e.target }); });
      },
      animateEdgeOpacityByClass: function (cls, target, durMs) {
        link.transition().duration(durMs || 300)
            .attr("opacity", function (d) { return d.cls.has(cls) ? target : edgeOpacityFor(d); });
      },
      setEdges: function () { /* fixture is static; no-op */ },
    };
  }

  function recolour(viz, fixture, membership) {
    if (!viz) return;
    const idxById = indexById(fixture);
    // Diff-based: only call setNodeStyle on nodes whose colour actually
    // changed since the last recolour. setNodeStyle drives a 220ms d3
    // transition on every call, so skipping no-op repaints is the
    // visible-perf win.
    if (!viz._lastColours) viz._lastColours = {};
    const last = viz._lastColours;
    fixture.nodes.forEach(function (id) {
      const i = idxById[id];
      const colour = partitionColor(membership[i]);
      if (last[id] === colour) return;
      last[id] = colour;
      viz.setNodeStyle(id, { color: colour });
    });
  }

  function focusNode(viz, fixture, nodeId, ringClass) {
    if (!viz) return;
    fixture.nodes.forEach(function (id) {
      viz.removeNodeClass(id, "hi");
      viz.removeNodeClass(id, "dim");
    });
    if (nodeId == null) return;
    viz.addNodeClass(nodeId, ringClass || "hi");
    const neigh = new Set([nodeId]);
    fixture.edges.forEach(function (e) {
      if (e[0] === nodeId) neigh.add(e[1]);
      if (e[1] === nodeId) neigh.add(e[0]);
    });
    fixture.nodes.forEach(function (id) {
      if (!neigh.has(id)) viz.addNodeClass(id, "dim");
    });
  }

  // ── Step walker ─────────────────────────────────────────────────
  function mountStepWalker(opts) {
    const F = C.FIXTURE;
    const events = opts.events || [];
    const total = events.length + 1; // +1 for stage 0 init
    const ctlPrefix = opts.ctlPrefix;

    const initialMem = opts.snapshotAt
      ? opts.snapshotAt(0)
      : F.nodes.map(function (_, i) { return i; });
    const viz = renderFixture(opts.vizHostId, {
      membership: initialMem, pinned: true, nodeR: opts.nodeR || 12,
    });
    const panelEl = document.getElementById(opts.panelHostId);

    function render(idx) {
      const mem = opts.snapshotAt(idx);
      recolour(viz, F, mem);
      const ev = (idx === 0) ? null : events[idx - 1];
      focusNode(viz, F, (ev && ev.v != null) ? ev.v : null, "hi");
      if (typeof opts.onRender === "function") opts.onRender(idx, ev);
      if (panelEl && typeof opts.sidePanelHTML === "function") {
        panelEl.innerHTML = opts.sidePanelHTML(idx, ev);
      }
    }

    const ctl = C.stepController({
      total: total,
      prevBtn: document.getElementById(ctlPrefix + "-prev"),
      nextBtn: document.getElementById(ctlPrefix + "-next"),
      resetBtn: document.getElementById(ctlPrefix + "-reset"),
      endBtn: document.getElementById(ctlPrefix + "-end"),
      // Optional random-row buttons; omit in markup to keep the
      // walker deterministic (existing pages without rerolls keep
      // their behaviour because document.getElementById returns null
      // and stepController treats null as "no button").
      randStepBtn: document.getElementById(ctlPrefix + "-rand-step"),
      randAllBtn:  document.getElementById(ctlPrefix + "-rand-all"),
      labelCur: document.getElementById(ctlPrefix + "-cur"),
      labelTotal: document.getElementById(ctlPrefix + "-total"),
      onRender: render,
      onRandStep: typeof opts.onRandStep === "function" ? opts.onRandStep : null,
      onRandAll:  typeof opts.onRandAll  === "function" ? opts.onRandAll  : null,
      randStepDisabledAt: opts.randStepDisabledAt,
      randAtStart: !!opts.randAtStart,
      keyboard: false,
    });

    return { viz: viz, controller: ctl, render: render };
  }

  // ── Aggregation viz ─────────────────────────────────────────────
  function mountAggregation(opts) {
    const F = C.FIXTURE;
    const fineMembership = opts.fineMembership;
    const idxById = indexById(F);
    const viz = renderFixture(opts.vizHostId, {
      membership: fineMembership, pinned: true,
    });
    let collapsed = false;

    function play() {
      if (collapsed) return;
      viz.eachEdge(function (e) { viz.addEdgeClass(e.id, "dim"); });
      const sup = new Map();
      F.edges.forEach(function (e) {
        const a = fineMembership[idxById[e[0]]];
        const b = fineMembership[idxById[e[1]]];
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (lo === hi) return;
        const k = lo + "|" + hi;
        sup.set(k, (sup.get(k) || 0) + 1);
      });
      const commCent = {};
      F.nodes.forEach(function (id) {
        const c = fineMembership[idxById[id]];
        const p = F.positions.find(function (pp) { return pp.id === id; });
        if (!commCent[c]) commCent[c] = { x: 0, y: 0, n: 0 };
        commCent[c].x += p.x; commCent[c].y += p.y; commCent[c].n += 1;
      });
      Object.keys(commCent).forEach(function (k) {
        commCent[k].x /= commCent[k].n;
        commCent[k].y /= commCent[k].n;
      });
      const supN = Object.keys(commCent).length;
      const supE = sup.size;
      if (opts.capEl) opts.capEl.textContent = "after · super-graph (n = " + supN + ", e = " + supE + ")";
      collapsed = true;
    }
    function reset() {
      viz.eachEdge(function (e) { viz.removeEdgeClass(e.id, "dim"); });
      if (opts.capEl) opts.capEl.textContent = "after · super-graph (n = ·)";
      collapsed = false;
    }
    // Use onclick = ... so re-mounts replace the previous handler instead
    // of stacking listeners. Re-mount happens on γ-slider rebuild in the
    // CPM page; without this, every slider tick added another play handler.
    if (opts.playBtn) opts.playBtn.onclick = play;
    if (opts.resetBtn) opts.resetBtn.onclick = reset;
    return { viz: viz, play: play, reset: reset };
  }

  // ── Final comparison ────────────────────────────────────────────
  function mountFinalCompare(opts) {
    renderFixture(opts.leidenHostId, {
      membership: opts.membership, pinned: true, nodeR: 9,
    });
    renderFixture(opts.gtHostId, {
      useGT: true, pinned: true, nodeR: 9,
    });
    if (opts.hValueEl != null && opts.hValue != null) {
      opts.hValueEl.textContent = (+opts.hValue).toFixed(3);
    }
    if (opts.gammaEl != null && opts.gamma != null) {
      opts.gammaEl.textContent = (+opts.gamma).toPrecision(2);
    }
    if (opts.statsTbody) renderStatsTable(opts.statsTbody, opts.membership);
  }

  function computeClusterStats(membership, fixture) {
    fixture = fixture || C.FIXTURE;
    const idxById = indexById(fixture);
    const stats = new Map();
    fixture.nodes.forEach(function (id, i) {
      const c = membership[i];
      if (!stats.has(c)) stats.set(c, { comm: c, size: 0, edgesIn: 0, edgesOut: 0 });
      stats.get(c).size += 1;
    });
    fixture.edges.forEach(function (e) {
      const a = membership[idxById[e[0]]];
      const b = membership[idxById[e[1]]];
      if (a === b) {
        stats.get(a).edgesIn += 1;
      } else {
        stats.get(a).edgesOut += 1;
        stats.get(b).edgesOut += 1;
      }
    });
    const out = Array.from(stats.values()).sort(function (a, b) { return b.size - a.size; });
    out.forEach(function (s) {
      const denom = (2 * s.edgesIn + s.edgesOut);
      s.conductance = denom > 0 ? s.edgesOut / denom : 0;
    });
    return out;
  }

  function renderStatsTable(tbody, membership, fixture) {
    tbody.innerHTML = "";
    const stats = computeClusterStats(membership, fixture);
    stats.forEach(function (s) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="swatch"><span style="background:' + partitionColor(s.comm) + '"></span></td>' +
        '<td>' + s.comm + '</td>' +
        '<td>' + s.size + '</td>' +
        '<td>' + s.edgesIn + '</td>' +
        '<td>' + s.edgesOut + '</td>' +
        '<td>' + s.conductance.toFixed(3) + '</td>';
      tbody.appendChild(tr);
    });
  }

  function buildLeidenGraph(fixture) {
    fixture = fixture || C.FIXTURE;
    return C.LEIDEN.Graph(fixture.nodes.length, fixture.edges,
      { correctSelfLoops: false });
  }

  // ── Leiden / Louvain walker wrappers ─────────────────────────────
  // Both algorithms walk a list of (node-visit) events that share the
  // same shape: { v, fromComm, toComm, moved, delta, candidates }. The
  // page glue differs only in (a) the metric symbol shown in the cum
  // line ("Q" for Modularity, "H" for CPM), and (b) which kernel result
  // the events come from. mountMoveWalker + mountRefineWalker collect
  // the shared boilerplate.
  function mountMoveWalker(opts) {
    const F = C.FIXTURE;
    const metric = opts.metric || "H";       // "H" (CPM) or "Q" (Modularity)
    const events = opts.events;
    const initialMembership = opts.initialMembership
      || F.nodes.map(function (_, i) { return i; });
    const postMembership = opts.postMembership;     // membership at end of phase
    const statusEl = document.getElementById(opts.ctlPrefix + "-status");
    const statsEl = document.getElementById(opts.ctlPrefix + "-stats");
    const onExtra = opts.onExtraRender || function () {};

    function snapshotAt(idx) {
      if (idx === 0) return initialMembership;
      return postMembership;
    }
    function eventStatus(ev) {
      if (!ev) return "stage 0 · singleton init · all " + F.nodes.length + " nodes alone";
      const tail = ev.moved
        ? (' &middot; moved to comm ' + ev.toComm
            + ' (Δ' + metric + ' = ' + ev.delta.toFixed(4) + ')')
        : ' &middot; stayed (no Δ' + metric + ' > 0)';
      return "node " + ev.v + " &middot; visit " + ((ev.idx != null ? ev.idx : 0) + 1) + tail;
    }
    function statsHTML(idx) {
      let cum = 0, n = 0;
      for (let k = 0; k < idx; k++) {
        const e = events[k];
        if (e.moved) { cum += e.delta; n += 1; }
      }
      return "moves: " + n + " &middot; Δ" + metric + " cum: " + cum.toFixed(4);
    }
    function candPanelHTML(idx, ev) {
      if (!ev) return '<div class="step-desc">Stage 0: every node is its own community. No candidate evaluation yet.</div>';
      const rows = ev.candidates.slice().sort(function (a, b) { return b.delta - a.delta; });
      let html = '<div class="step-desc">candidates for node ' + ev.v
        + ' &middot; current comm = ' + ev.fromComm + '</div>';
      html += '<table class="cand-table"><thead><tr><th>cand comm</th><th>Δ ' + metric
            + '</th><th>verdict</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        const isPick = (r.comm === ev.toComm && ev.moved);
        const isFrom = (r.comm === ev.fromComm);
        const cls = isPick ? 'cand-pick' : (isFrom ? 'cand-from' : '');
        const verdict = isPick ? 'pick' : (isFrom ? 'current' : '');
        html += '<tr class="' + cls + '"><td>' + r.comm + '</td><td>'
              + r.delta.toFixed(4) + '</td><td>' + verdict + '</td></tr>';
      });
      html += '</tbody></table>';
      return html;
    }
    return mountStepWalker({
      vizHostId: opts.vizHostId,
      panelHostId: opts.panelHostId,
      ctlPrefix: opts.ctlPrefix,
      events: events,
      snapshotAt: snapshotAt,
      sidePanelHTML: candPanelHTML,
      onRender: function (idx, ev) {
        if (statusEl) statusEl.innerHTML = eventStatus(ev);
        if (statsEl) statsEl.innerHTML = statsHTML(idx);
        onExtra(idx, ev);
      },
    });
  }

  function mountRefineWalker(opts) {
    const F = C.FIXTURE;
    const events = opts.events;
    const preMembership = opts.preMembership;       // membership at refine start
    const postMembership = opts.postMembership;     // membership at refine end
    const statusEl = document.getElementById(opts.ctlPrefix + "-status");
    const statsEl = document.getElementById(opts.ctlPrefix + "-stats");

    function snapshotAt(idx) {
      if (idx === 0) return preMembership;
      return postMembership;
    }
    function eventStatus(ev) {
      if (!ev) return "starts from post-move partition · " + F.nodes.length + " refined singletons";
      const tail = ev.moved
        ? (' &middot; merged into refined comm ' + ev.toComm)
        : ' &middot; stayed (no Δ ≥ 0)';
      return "node " + ev.v + " &middot; visit " + ((ev.idx != null ? ev.idx : 0) + 1) + tail;
    }
    function statsHTML(idx) {
      let merges = 0;
      for (let k = 0; k < idx; k++) if (events[k].moved) merges += 1;
      return "merges: " + merges;
    }
    return mountStepWalker({
      vizHostId: opts.vizHostId,
      panelHostId: opts.panelHostId || (opts.ctlPrefix + "-panel"),
      ctlPrefix: opts.ctlPrefix,
      events: events,
      snapshotAt: snapshotAt,
      sidePanelHTML: function () { return ""; },
      onRender: function (idx, ev) {
        if (statusEl) statusEl.innerHTML = eventStatus(ev);
        if (statsEl) statsEl.innerHTML = statsHTML(idx);
      },
    });
  }

  // ── Reusable candidate table renderer ────────────────────────────
  // Three call sites (louvain/page.js moveCandPanel, leiden/page_cpm.js
  // moveCandPanel, sbm/walker_page.js candPanel) render an essentially
  // identical <table class="cand-table"> with metric-specific labels.
  // This factory takes the per-row data + per-row classification hooks
  // and emits the shared HTML.
  function renderCandTable(opts) {
    const rows = (opts.rows || []).slice();
    if (opts.sort === "asc")  rows.sort(function (a, b) { return a._delta - b._delta; });
    if (opts.sort === "desc") rows.sort(function (a, b) { return b._delta - a._delta; });
    let html = "";
    if (opts.headerText) html += '<div class="step-desc">' + opts.headerText + '</div>';
    html += '<table class="cand-table"><thead><tr><th>' + (opts.entityHeader || "candidate")
         + '</th><th>' + (opts.metricHeader || "Δ") + '</th><th>verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      const cls = (opts.classFor && opts.classFor(r)) || "";
      const verdict = (opts.verdictFor && opts.verdictFor(r)) || "";
      const label = opts.entityFor ? opts.entityFor(r) : String(r._label != null ? r._label : "");
      const fmt = (opts.precision != null ? opts.precision : 4);
      html += '<tr class="' + cls + '"><td>' + label + '</td><td>'
            + r._delta.toFixed(fmt) + '</td><td>' + verdict + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  // ── Seed reroll wiring (sbm walker_page + sbm compare_page) ──────
  // Identical pattern: button #<prefix>-reroll bumps seed by 1; input
  // #<prefix>-seed accepts a manual value. onReroll receives the new
  // seed integer.
  function wireSeedReroll(opts) {
    const prefix = opts.prefix || "g";
    const btn = document.getElementById(prefix + "-reroll");
    const inp = document.getElementById(prefix + "-seed");
    let seed = (opts.initialSeed | 0) || 0;
    if (inp) inp.value = String(seed);
    function fire(newSeed) {
      seed = (newSeed | 0) || 0;
      if (inp) inp.value = String(seed);
      if (typeof opts.onReroll === "function") opts.onReroll(seed);
    }
    if (btn) btn.addEventListener("click", function () { fire(seed + 1); });
    if (inp) inp.addEventListener("change", function () {
      fire(parseInt(inp.value, 10) | 0);
    });
    return { getSeed: function () { return seed; }, set: fire };
  }

  C.PAGE = {
    partitionColor: partitionColor,
    indexById: indexById,
    renderFixture: renderFixture,
    recolour: recolour,
    focusNode: focusNode,
    mountStepWalker: mountStepWalker,
    mountMoveWalker: mountMoveWalker,
    mountRefineWalker: mountRefineWalker,
    mountAggregation: mountAggregation,
    mountFinalCompare: mountFinalCompare,
    computeClusterStats: computeClusterStats,
    renderStatsTable: renderStatsTable,
    buildLeidenGraph: buildLeidenGraph,
    renderCandTable: renderCandTable,
    wireSeedReroll: wireSeedReroll,
  };
})();
