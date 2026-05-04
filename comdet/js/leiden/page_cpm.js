/* Leiden-CPM page glue. Wires every stage of leiden-cpm.html via
 * COMDET.PAGE primitives + the kernel's recorded trace.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.LEIDEN || !COMDET.FIXTURE) {
    console.warn("[leiden page_cpm] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, L = C.LEIDEN, F = C.FIXTURE;

  // Top nav links via shared.js.
  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "leiden-cpm" });
  }

  // Run kernel once at default γ; rebuild on slider changes.
  let gamma = 0.05;
  let seed = 42;
  let result = runKernel(gamma);

  function runKernel(g) {
    const G = P.buildLeidenGraph();
    return L.optimisePartition(G, L.CPM(g), seed, { recordTrace: true });
  }

  // ── Stage 0: input fixture (planted GT) ─────────────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // ── Stage 1: singleton init ─────────────────────────────────────
  const singletonMembership = F.nodes.map(function (_, i) { return i; });
  P.renderFixture("g-singleton-cy", {
    membership: singletonMembership, pinned: true,
  });

  // ── Stage 2: local moving walker ────────────────────────────────
  // Use level-0 move events (the dominant pass on this small fixture).
  function buildMoveEvents() {
    return result.levels[0].moveTraces.map(function (t, i) {
      return Object.assign({ idx: i }, t);
    });
  }
  let moveEvents = buildMoveEvents();
  // Snapshot: stage 0 = singletons (pre-move), stage k>0 = post-move snapshot
  // of the level (kernel records this as finePostMove).
  function moveSnapshot(idx) {
    if (idx === 0) return singletonMembership;
    return Array.from(result.levels[0].finePostMove);
  }
  let moveCumulativeImprov = 0;
  let moveCount = 0;
  const moveStatusEl = document.getElementById("g-move-status");
  const moveStatsEl = document.getElementById("g-move-stats");
  const movePanelEl = document.getElementById("g-move-panel");
  const movePanelHostId = "g-move-panel";

  function moveEventStatus(ev) {
    if (!ev) return "stage 0 · singleton init · all 32 nodes alone";
    return "node " + ev.v + " &middot; visit " + (ev.idx + 1) + (ev.moved
      ? (' &middot; moved to comm ' + ev.toComm + ' (Δ = ' + ev.delta.toFixed(4) + ')')
      : ' &middot; stayed (no Δ > 0)');
  }
  function moveStatsHTML(idx) {
    moveCumulativeImprov = 0; moveCount = 0;
    for (let k = 0; k < idx; k++) {
      const t = moveEvents[k];
      if (t.moved) { moveCumulativeImprov += t.delta; moveCount += 1; }
    }
    return "moves: " + moveCount + " &middot; ΔH cum: " + moveCumulativeImprov.toFixed(3);
  }
  function moveCandPanel(idx, ev) {
    if (!ev) return '<div class="step-desc">Stage 0: every node is its own community. No candidate evaluation yet.</div>';
    const rows = ev.candidates.slice().sort(function (a, b) { return b.delta - a.delta; });
    let html = '<div class="step-desc">candidates for node ' + ev.v
      + ' &middot; current comm = ' + ev.fromComm + '</div>';
    html += '<table class="cand-table"><thead><tr><th>cand comm</th><th>Δ H</th><th>verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      const cls = (r.comm === ev.toComm && ev.moved) ? 'cand-pick'
                : (r.comm === ev.fromComm ? 'cand-from' : '');
      const verdict = (r.comm === ev.toComm && ev.moved) ? 'pick'
                    : (r.comm === ev.fromComm ? 'current' : '');
      html += '<tr class="' + cls + '"><td>' + r.comm + '</td><td>'
            + r.delta.toFixed(4) + '</td><td>' + verdict + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  let moveWalker = P.mountStepWalker({
    vizHostId: "g-move-cy",
    panelHostId: movePanelHostId,
    ctlPrefix: "g-move",
    events: moveEvents,
    snapshotAt: moveSnapshot,
    sidePanelHTML: moveCandPanel,
    onRender: function (idx, ev) {
      if (moveStatusEl) moveStatusEl.innerHTML = moveEventStatus(ev);
      if (moveStatsEl) moveStatsEl.innerHTML = moveStatsHTML(idx);
    },
  });

  // (γ slider wired below, after refine + final + agg are built.)

  // ── Stage 3: refinement walker ──────────────────────────────────
  function buildRefineEvents() {
    return result.levels[0].refineTraces.map(function (t, i) {
      return Object.assign({ idx: i }, t);
    });
  }
  let refineEvents = buildRefineEvents();
  function refineSnapshot(idx) {
    // Refinement starts from post-move; final = post-refine.
    if (idx === 0) return Array.from(result.levels[0].finePostMove);
    return Array.from(result.levels[0].finePostRefine);
  }
  const refineStatusEl = document.getElementById("g-refine-status");
  const refineStatsEl = document.getElementById("g-refine-stats");
  function refineEventStatus(ev) {
    if (!ev) return "starts from post-move partition · 32 refined singletons";
    return "node " + ev.v + " &middot; visit " + (ev.idx + 1) + (ev.moved
      ? (' &middot; merged into refined comm ' + ev.toComm)
      : ' &middot; stayed (no Δ ≥ 0)');
  }
  function refineStatsHTML(idx) {
    let merges = 0;
    for (let k = 0; k < idx; k++) if (refineEvents[k].moved) merges += 1;
    return "merges: " + merges;
  }
  let refineWalker = P.mountStepWalker({
    vizHostId: "g-refine-cy",
    panelHostId: "g-refine-panel",  // not in DOM; sidePanelHTML will no-op
    ctlPrefix: "g-refine",
    events: refineEvents,
    snapshotAt: refineSnapshot,
    sidePanelHTML: function () { return ""; },
    onRender: function (idx, ev) {
      if (refineStatusEl) refineStatusEl.innerHTML = refineEventStatus(ev);
      if (refineStatsEl) refineStatsEl.innerHTML = refineStatsHTML(idx);
    },
  });

  // ── Stage 4: aggregation animation ──────────────────────────────
  let aggHandle = null;
  function rebuildAggregation() {
    const host = document.getElementById("g-agg-cy");
    if (host) host.innerHTML = "";
    const capEl = document.getElementById("g-agg-cap");
    aggHandle = P.mountAggregation({
      vizHostId: "g-agg-cy",
      fineMembership: Array.from(result.levels[0].finePostRefine),
      capEl: capEl,
      playBtn: document.getElementById("g-agg-play"),
      resetBtn: document.getElementById("g-agg-reset"),
    });
  }
  rebuildAggregation();

  // ── Stage 5: final comparison ───────────────────────────────────
  function rebuildFinal() {
    const leidenHost = document.getElementById("g-final-leiden");
    const gtHost = document.getElementById("g-final-gt");
    if (leidenHost) leidenHost.innerHTML = "";
    if (gtHost) gtHost.innerHTML = "";
    const tbody = document.querySelector("#g-final-stats tbody");
    if (tbody) tbody.innerHTML = "";
    P.mountFinalCompare({
      leidenHostId: "g-final-leiden",
      gtHostId: "g-final-gt",
      statsTbody: tbody,
      membership: result.partition.membership(),
      hValue: result.quality,
      hValueEl: document.getElementById("g-final-H"),
      gammaEl: document.getElementById("g-final-gamma"),
      gamma: gamma,
    });
  }
  rebuildFinal();

  // ── γ slider (wired last so all walkers exist) ──────────────────
  const gIn = document.getElementById("g-move-gamma");
  const gOut = document.getElementById("g-move-gamma-out");
  if (gIn && gOut) {
    C.scrubSlider({
      input: gIn, output: gOut,
      format: function (v) { return Math.pow(10, +v).toPrecision(2); },
      onChange: function (v) {
        gamma = Math.pow(10, +v);
        result = runKernel(gamma);
        moveEvents = buildMoveEvents();
        moveWalker.controller.reconfigure(moveEvents.length + 1);
        moveWalker.controller.set(0);
        refineEvents = buildRefineEvents();
        refineWalker.controller.reconfigure(refineEvents.length + 1);
        refineWalker.controller.set(0);
        rebuildAggregation();
        rebuildFinal();
        if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
          MathJax.typesetPromise();
        }
      },
    });
    gIn.value = Math.log10(gamma);
    gOut.textContent = gamma.toPrecision(2);
  }

  if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
    MathJax.typesetPromise();
  }
})();
