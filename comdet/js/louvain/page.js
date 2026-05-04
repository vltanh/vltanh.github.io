/* Louvain page glue. Walker over the Blondel 2008 algorithm:
 * Phase 1 (modularity sweep — full passes until quiet) and Phase 2
 * (aggregation), iterated until the graph stops shrinking.
 *
 * Reuses COMDET.PAGE primitives. Stage 2 walks every per-node visit
 * within Phase 1's first pass at level 0 (the longest sweep). Stage 3
 * shows the level-0 collapse. Stage 4 lets the user step through
 * higher-level passes. Stage 5 is the side-by-side final.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.LOUVAIN || !COMDET.FIXTURE) {
    console.warn("[louvain page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, LV = C.LOUVAIN, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "louvain" });
  }

  const seed = 42;
  function runKernel() {
    const G = LV.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    return LV.run(G, LV.Modularity(), seed, { recordTrace: true });
  }
  let result = runKernel();

  // ── Stage 0 + 1 ─────────────────────────────────────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });
  const singleton = F.nodes.map(function (_, i) { return i; });
  P.renderFixture("g-singleton-cy", { membership: singleton, pinned: true });

  // ── Stage 2: Phase 1 walker (level 0, all sweeps stitched) ──────
  // Build flat event list: every visit across every sweep at level 0.
  function buildPhase1Events() {
    const lv0 = result.levels[0];
    const events = [];
    let cumMoves = 0, cumDeltaQ = 0;
    lv0.sweeps.forEach(function (sw, swIdx) {
      sw.traces.forEach(function (t, vi) {
        events.push({
          sweepIdx: swIdx,
          visitInSweep: vi,
          totalSoFar: events.length + 1,
          isLastInSweep: vi === sw.traces.length - 1,
          nbMovesAfterSweep: cumMoves + sw.nbMoves,
          deltaQAfterSweep: cumDeltaQ + sw.totalImprov,
          v: t.v, fromComm: t.fromComm, toComm: t.toComm,
          moved: t.moved, delta: t.delta, candidates: t.candidates,
        });
      });
      cumMoves += sw.nbMoves;
      cumDeltaQ += sw.totalImprov;
    });
    return events;
  }
  const phase1Events = buildPhase1Events();

  // Compute per-event membership snapshot by replaying the sweeps.
  function computeSnapshots() {
    const Gloc = LV.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    const Pl = LV.Partition(Gloc, null, LV.Modularity());
    const snaps = [];
    const lv0 = result.levels[0];
    lv0.sweeps.forEach(function (sw) {
      sw.traces.forEach(function (t) {
        if (t.moved) Pl.moveNode(t.v, t.toComm);
        snaps.push(Array.from(Pl.membership()));
      });
    });
    return snaps;
  }
  const snapshots = computeSnapshots();
  function moveSnapshot(idx) {
    if (idx === 0) return singleton;
    return snapshots[idx - 1];
  }

  const moveStatusEl = document.getElementById("g-move-status");
  const moveStatsEl = document.getElementById("g-move-stats");
  const moveSweepEl = document.getElementById("g-move-sweep");

  function moveStatusHTML(idx, ev) {
    if (!ev) return "stage 0 · singleton init · 32 nodes alone";
    const verb = ev.moved
      ? (' &middot; moved to comm ' + ev.toComm + ' (Δ Q = ' + ev.delta.toFixed(4) + ')')
      : ' &middot; stayed (no Δ Q > 0)';
    return "node " + ev.v + " &middot; sweep " + (ev.sweepIdx + 1)
         + " · visit " + (ev.visitInSweep + 1) + verb;
  }
  function moveStatsHTML(idx, ev) {
    let mv = 0, dq = 0;
    for (let k = 0; k < idx; k++) {
      const e = phase1Events[k];
      if (e.moved) { mv += 1; dq += e.delta; }
    }
    return "sweep moves: " + mv + " &middot; Δ Q cum: " + dq.toFixed(4);
  }
  function moveCandPanel(idx, ev) {
    if (!ev) return '<div class="step-desc">Phase 1 starts at singletons (everyone their own community). No move evaluated yet.</div>';
    const rows = ev.candidates.slice().sort(function (a, b) { return b.delta - a.delta; });
    let html = '<div class="step-desc">candidates for node ' + ev.v
      + ' &middot; current comm = ' + ev.fromComm + '</div>';
    html += '<table class="cand-table"><thead><tr><th>cand comm</th><th>Δ Q</th><th>verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      const cls = (r.comm === ev.toComm && ev.moved) ? 'cand-pick'
                : (r.comm === ev.fromComm ? 'cand-from' : '');
      const verdict = (r.comm === ev.toComm && ev.moved) ? 'pick'
                    : (r.comm === ev.fromComm ? 'current'
                    : (r.delta <= 0 ? 'reject (≤0)' : ''));
      html += '<tr class="' + cls + '"><td>' + r.comm + '</td><td>'
            + r.delta.toFixed(4) + '</td><td>' + verdict + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  P.mountStepWalker({
    vizHostId: "g-move-cy",
    panelHostId: "g-move-panel",
    ctlPrefix: "g-move",
    events: phase1Events,
    snapshotAt: moveSnapshot,
    sidePanelHTML: moveCandPanel,
    onRender: function (idx, ev) {
      if (moveStatusEl) moveStatusEl.innerHTML = moveStatusHTML(idx, ev);
      if (moveStatsEl) moveStatsEl.innerHTML = moveStatsHTML(idx, ev);
      if (moveSweepEl) {
        const sweepNum = ev ? (ev.sweepIdx + 1) : 0;
        const totalSweeps = result.levels[0].sweeps.length;
        moveSweepEl.textContent = "sweep " + sweepNum + " / " + totalSweeps;
      }
    },
  });

  // ── Stage 3: Aggregation (level-0 collapse) ─────────────────────
  P.mountAggregation({
    vizHostId: "g-agg-cy",
    fineMembership: Array.from(result.levels[0].finePost),
    capEl: document.getElementById("g-agg-cap"),
    playBtn: document.getElementById("g-agg-play"),
    resetBtn: document.getElementById("g-agg-reset"),
  });

  // ── Stage 4: Higher-level passes summary ────────────────────────
  // Show a per-level table: vc-before, ncomm-found, vc-after, sweeps,
  // total moves at that level, ΔQ across the level.
  const levelTableEl = document.getElementById("g-levels-tbody");
  if (levelTableEl) {
    levelTableEl.innerHTML = "";
    result.levels.forEach(function (lv, i) {
      let totMoves = 0, totDQ = 0;
      lv.sweeps.forEach(function (sw) { totMoves += sw.nbMoves; totDQ += sw.totalImprov; });
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + i + '</td>' +
        '<td>' + lv.collapsedVcountBefore + '</td>' +
        '<td>' + lv.collapsedNcomm + '</td>' +
        '<td>' + lv.newCollapsedVcount + '</td>' +
        '<td>' + lv.sweeps.length + '</td>' +
        '<td>' + totMoves + '</td>' +
        '<td>' + totDQ.toFixed(4) + '</td>';
      levelTableEl.appendChild(tr);
    });
  }

  // ── Stage 5: Final compare ──────────────────────────────────────
  P.mountFinalCompare({
    leidenHostId: "g-final-louvain",
    gtHostId: "g-final-gt",
    statsTbody: document.querySelector("#g-final-stats tbody"),
    membership: result.partition.membership(),
    hValue: result.quality,
    hValueEl: document.getElementById("g-final-Q"),
  });

  // Detect internally disconnected communities (the Leiden Fig 2 case).
  function disconnectedComms(membership) {
    const idxById = P.indexById(F);
    const adj = new Map(); // node id -> [neighbour ids]
    F.nodes.forEach(function (id) { adj.set(id, []); });
    F.edges.forEach(function (e) {
      adj.get(e[0]).push(e[1]); adj.get(e[1]).push(e[0]);
    });
    const seen = new Set();
    const badComms = new Set();
    F.nodes.forEach(function (start) {
      if (seen.has(start)) return;
      const comm = membership[idxById[start]];
      // BFS within this comm.
      const q = [start]; seen.add(start);
      const found = [start];
      while (q.length) {
        const u = q.shift();
        adj.get(u).forEach(function (w) {
          if (seen.has(w)) return;
          if (membership[idxById[w]] !== comm) return;
          seen.add(w); q.push(w); found.push(w);
        });
      }
      // Total nodes in this comm.
      const allInComm = F.nodes.filter(function (id) {
        return membership[idxById[id]] === comm;
      });
      // If found < allInComm, we know this comm is disconnected. Mark
      // it once (the BFS will run separately on the other component
      // and we'd add it again, so use a Set).
      if (found.length < allInComm.length) badComms.add(comm);
    });
    return Array.from(badComms);
  }
  const badEl = document.getElementById("g-final-disconn");
  if (badEl) {
    const bad = disconnectedComms(result.partition.membership());
    if (bad.length === 0) {
      badEl.innerHTML = '<em>None.</em> On this small fixture, Louvain happens to land on a connected partition.';
    } else {
      badEl.innerHTML = 'communities <strong>' + bad.join(', ') + '</strong> are internally disconnected. '
        + 'These are the cases the paper Traag et al. 2019 measured at up to 16% on real benchmark networks; '
        + 'Leiden\'s refinement phase splits them automatically. See <a href="./leiden-cpm.html">Leiden-CPM</a>.';
    }
  }

  if (typeof MathJax !== "undefined" && MathJax.typesetPromise) MathJax.typesetPromise();
})();
