/* Leiden walker — netgen-style: COMDET.VIZ + COMDET.stepController +
 * COMDET.mountGxPanel + COMDET.scrubSlider, all primitives from
 * comdet/shared.js. One node-visit per step across move + refine phases for
 * every level. Resolution slider rebuilds + replays. UC banner stays per
 * feedback_keep_uc_banner.md.
 *
 * Mount opts:
 *   vizHostId   — id of div hosting the COMDET.VIZ.init canvas
 *   panelHostId — same as vizHostId; mountGxPanel anchors here
 *   ctlPrefix   — id namespace for stepController buttons + step-label spans
 *   resolution  — initial γ (CPM only); pass null for Modularity
 *   seed        — RNG seed (default 42)
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const L = C.LEIDEN;
  const CC = C.COMMON;
  if (!L || !CC) return;

  // Timeline event = one node-visit (move or refine phase).
  function buildTimeline(result) {
    const events = [];
    result.levels.forEach(function (lv, lvi) {
      lv.moveTraces.forEach(function (t, k) {
        events.push({ level: lvi, phase: "move", visitIdx: k, trace: t,
          finePostMove: lv.finePostMove, finePostRefine: lv.finePostRefine });
      });
      lv.refineTraces.forEach(function (t, k) {
        events.push({ level: lvi, phase: "refine", visitIdx: k, trace: t,
          finePostMove: lv.finePostMove, finePostRefine: lv.finePostRefine });
      });
    });
    return events;
  }

  // Per-event fine-membership snapshot. Coarse approx: post-move snapshot for
  // every move event in level L, post-refine snapshot for refine events.
  // Sufficient for a 32-node fixture; per-event-exact would need replaying
  // moveNodes one-step-at-a-time.
  function buildSnapshots(result) {
    const snaps = [];
    result.levels.forEach(function (lv) {
      const post = Array.from(lv.finePostMove);
      for (let k = 0; k < lv.moveTraces.length; k++) snaps.push(post);
      const ref = Array.from(lv.finePostRefine);
      for (let k = 0; k < lv.refineTraces.length; k++) snaps.push(ref);
    });
    return snaps;
  }

  // Cluster colour palette: cycle netgen's outlier_palette + cluster slots.
  function colorOf(c) {
    if (c == null || c < 0) return C.COLORS.OUT || "#888";
    // Try cluster-c1..c4 first, then outlier palette.
    const slots = [
      C.COLORS.C1 || "#7b9bd6",
      C.COLORS.C2 || "#e0a649",
      C.COLORS.C3 || "#8fbb70",
      "#b07ac9",
    ];
    if (c < slots.length) return slots[c];
    const outlier = C.COLORS.outlier_palette || ["#7e468f", "#5fa0b3", "#a3b56b", "#c98a8a"];
    return outlier[(c - slots.length) % outlier.length];
  }

  function mount(opts) {
    const F = C.FIXTURE;
    if (!F) { console.warn("[leiden walker] COMDET.FIXTURE missing"); return; }
    let resolution = (opts.resolution != null) ? +opts.resolution : null;
    let seed = (opts.seed != null) ? (opts.seed >>> 0) : 42;
    // L.LeidenMod = libleidenalg ModularityVertexPartition, matches the
    // LeidenPartition admin algebra used by optimisePartition.
    // L.Modularity (Louvain shape) reads totalWeightInComm under Louvain
    // semantics and would produce wrong dQ on LeidenPartition.
    let qualityFn = (resolution != null) ? L.CPM(resolution) : L.LeidenMod();

    // Fixture → COMDET.VIZ-friendly inputs.
    const POSITIONS = {};
    F.positions.forEach(function (p) { POSITIONS[p.id] = { x: p.x, y: p.y }; });
    const NODES = F.nodes;
    const EDGES = F.edges.map(function (e) {
      return { u: e[0], v: e[1], kind: "intra" };
    });

    // Mount COMDET.VIZ.
    const viz = C.VIZ.init(opts.vizHostId, {
      positions: POSITIONS,
      nodes: NODES,
      edges: EDGES,
      includeOutliers: true,
      pinned: false,
      animated: false,
      nodeR: 13,
      nodeColor: function () { return "#888"; },
      // Outlier kind — show all nodes, no special suppression.
    });
    viz.setEdges(EDGES, { duration: 0 });

    // Initial state: every node singleton.
    const initialMembership = NODES.map(function (id) { return id; });

    // Replay run, build timeline + snapshots.
    let result, timeline, snapshots;
    function rebuild() {
      const G = CC.Graph(NODES.length, F.edges, { correctSelfLoops: false });
      result = L.optimisePartition(G, qualityFn, seed, { recordTrace: true });
      timeline = buildTimeline(result);
      snapshots = buildSnapshots(result);
    }
    rebuild();

    // Build candidate-table HTML for a given event.
    function candTableHTML(ev) {
      if (!ev) return '<div class="dim">no candidate detail at stage 0</div>';
      const t = ev.trace;
      const rows = t.candidates.slice().sort(function (a, b) { return b.delta - a.delta; });
      let html = '<table class="wcand"><thead><tr><th>cand</th><th>Δ</th><th></th></tr></thead><tbody>';
      rows.forEach(function (r) {
        const cls = (r.comm === t.toComm) ? 'wcand-pick'
                  : (r.comm === t.fromComm ? 'wcand-from' : '');
        const tag = (r.comm === t.toComm) ? '✓'
                  : (r.comm === t.fromComm ? 'from' : '');
        html += '<tr class="' + cls + '"><td>' + r.comm + '</td><td>'
              + r.delta.toFixed(4) + '</td><td>' + tag + '</td></tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function stageReadoutHTML(idx) {
      if (idx === 0) {
        return '<div class="winfo-line">stage 00 · singleton init</div>'
             + '<div class="winfo-line"><span class="dim">'
             + NODES.length + ' nodes, ' + NODES.length
             + ' singleton communities</span></div>';
      }
      const ev = timeline[idx - 1];
      const t = ev.trace;
      const phaseLabel = ev.phase === "move" ? "local moving" : "refinement";
      const verb = t.moved ? "moved" : "stayed";
      const deltaStr = t.moved ? ("Δ = " + t.delta.toFixed(4)) : "Δ ≤ 0";
      const arrow = t.moved ? (' · → comm ' + t.toComm) : "";
      return '<div class="winfo-line">level ' + ev.level + ' · ' + phaseLabel
           + ' · visit ' + (ev.visitIdx + 1) + '</div>'
           + '<div class="winfo-line">node <strong>' + t.v + '</strong> ' + verb
           + ' · ' + deltaStr + arrow + '</div>';
    }

    // Mount info + candidate side panel via mountGxPanel.
    const panelPrefix = opts.ctlPrefix + "-side";
    C.mountGxPanel({
      hostId: opts.panelHostId,
      prefix: panelPrefix,
      title: "node-visit",
      bodyHTML:
        '<div id="' + panelPrefix + '-info" class="walker-info"></div>' +
        '<div id="' + panelPrefix + '-cand" class="walker-cand"></div>',
      maxWidth: 280,
      viz: viz,
    });

    // Render at idx.
    function renderAt(idx) {
      const mem = (idx === 0) ? initialMembership : snapshots[idx - 1];
      // Update node colours.
      NODES.forEach(function (id, i) {
        const c = mem[i];
        viz.setNodeStyle(id, { color: colorOf(c) });
        viz.removeNodeClass(id, "hi");
        viz.removeNodeClass(id, "dim");
      });
      // Highlight the focus node.
      if (idx > 0) {
        const ev = timeline[idx - 1];
        viz.addNodeClass(ev.trace.v, "hi");
      }
      // Update side panel.
      const infoEl = document.getElementById(panelPrefix + "-info");
      const candEl = document.getElementById(panelPrefix + "-cand");
      if (infoEl) infoEl.innerHTML = stageReadoutHTML(idx);
      if (candEl) candEl.innerHTML = (idx === 0)
        ? '<div class="dim">no candidate detail at stage 0</div>'
        : candTableHTML(timeline[idx - 1]);
    }

    // Wire stepController. total = timeline.length (visits) + 1 (singleton init).
    let ctl = C.stepController({
      total: timeline.length + 1,
      prevBtn: document.getElementById(opts.ctlPrefix + "-prev"),
      nextBtn: document.getElementById(opts.ctlPrefix + "-next"),
      resetBtn: document.getElementById(opts.ctlPrefix + "-reset"),
      endBtn: document.getElementById(opts.ctlPrefix + "-end"),
      labelCur: document.getElementById(opts.ctlPrefix + "-cur"),
      labelTotal: document.getElementById(opts.ctlPrefix + "-total"),
      onRender: function (idx) { renderAt(idx); },
      keyboard: false,
    });

    // Optional: γ slider for CPM.
    if (resolution != null) {
      const gIn = document.getElementById(opts.ctlPrefix + "-gamma");
      const gOut = document.getElementById(opts.ctlPrefix + "-gamma-out");
      if (gIn && gOut) {
        C.scrubSlider({
          input: gIn, output: gOut,
          format: function (v) { return Math.pow(10, v).toPrecision(2); },
          onChange: function (v) {
            resolution = Math.pow(10, v);
            qualityFn = L.CPM(resolution);
            rebuild();
            ctl.reconfigure(timeline.length + 1);
          },
        });
        gIn.value = Math.log10(resolution);
        gOut.textContent = resolution.toPrecision(2);
      }
    }

    renderAt(0);
    return { viz: viz, controller: ctl };
  }

  C.LEIDEN_WALKER = { mount: mount };
})();
