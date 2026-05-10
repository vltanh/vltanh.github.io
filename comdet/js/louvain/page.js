/* Louvain page glue. Walker over the Blondel 2008 algorithm:
 * Phase 1 (modularity sweep, full passes until quiet) and Phase 2
 * (aggregation), iterated until the graph stops shrinking.
 *
 * Reroll convention follows netgen's matcher / SBM / nPSO walkers
 * (feedback_matcher_reroll_ux.md + feedback_randall_in_stage.md):
 *   - random step  : bump per-step seed; re-run kernel; clamp cursor
 *                    to MIN(idx-1, newTotal-1) so the user keeps the
 *                    same approximate position. Strict in-stage
 *                    [idx-1..end] preservation isn't possible because
 *                    Louvain.run threads a single RNG instance through
 *                    every level; new shuffle = new trajectory from
 *                    visit 0. Documented relaxation.
 *   - random all   : bump global seed; re-run kernel; cursor lands on
 *                    visit 0 (start of run) so the user can step
 *                    through the new trajectory.
 *
 * Stages 3, 4, 5 are deterministic functions of `result`; they tear
 * down + remount on every reroll so the user sees consistent state
 * across the page.
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

  // ?seed=N URL parameter for pedagogical reproducibility per the
  // dossier. Falls back to default 42 when absent / non-integer so
  // the static landing card stays deterministic.
  const urlSeed = (function () {
    const m = /[?&]seed=(-?\d+)/.exec(window.location.search || "");
    if (!m) return 42;
    const v = parseInt(m[1], 10);
    return Number.isFinite(v) ? v : 42;
  })();
  let seed = urlSeed;
  let result = null;
  // Mutable arrays captured by the stage-2 walker's closure. Reroll
  // mutates these in place + calls ctl.reconfigureKeep so the closure
  // picks up the new content without re-mounting.
  const phase1Events = [];
  const snapshots = [];
  let walker = null;        // { viz, controller, render }

  function runKernel(s) {
    const G = LV.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    return LV.run(G, LV.Modularity(), s, { recordTrace: true });
  }

  // ── Stage 0 + 1 (static, never reroll-driven) ──────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });
  const singleton = F.nodes.map(function (_, i) { return i; });
  P.renderFixture("g-singleton-cy", { membership: singleton, pinned: true });

  // Compute Q_0 from the kernel rather than hardcoding it in the
  // chrome caption. Q_0 = -Σ_v (k_v / 2m)^2 for the singleton
  // partition; this gets the value bit-correct from the very build
  // shipped under the page so future fixture changes update the
  // caption automatically.
  (function () {
    const Gloc = LV.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    const Pl = LV.Partition(Gloc, null, LV.Modularity());
    const Q0 = LV.Modularity().quality(Pl);
    const out = document.getElementById("g-q0");
    if (out) out.textContent = Q0.toFixed(4);
  })();

  // ── Per-result derivation: rebuild phase1 events + snapshots ────
  function rebuildPhase1Trace(res) {
    phase1Events.length = 0;
    snapshots.length = 0;
    const lv0 = res.levels[0];
    let cumMoves = 0, cumDeltaQ = 0;
    lv0.sweeps.forEach(function (sw, swIdx) {
      sw.traces.forEach(function (t, vi) {
        phase1Events.push({
          sweepIdx: swIdx,
          visitInSweep: vi,
          totalSoFar: phase1Events.length + 1,
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
    // Snapshots: replay phase-1 sweeps to capture per-visit membership.
    const Gloc = LV.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    const Pl = LV.Partition(Gloc, null, LV.Modularity());
    lv0.sweeps.forEach(function (sw) {
      sw.traces.forEach(function (t) {
        if (t.moved) Pl.moveNode(t.v, t.toComm);
        snapshots.push(Array.from(Pl.membership()));
      });
    });
  }

  function moveSnapshot(idx) {
    if (idx === 0) return singleton;
    return snapshots[idx - 1];
  }

  // ── Stage 2 status / stats / sweep label renderers ──────────────
  const moveStatusEl = document.getElementById("g-move-status");
  const moveStatsEl  = document.getElementById("g-move-stats");
  const moveSweepEl  = document.getElementById("g-move-sweep");
  const moveSeedEl   = document.getElementById("g-move-seed");

  function moveStatusHTML(idx, ev) {
    if (!ev) return "stage 0 · singleton init · 32 nodes alone";
    const verb = ev.moved
      ? (' &middot; moved to comm ' + ev.toComm + ' (Δ Q = ' + ev.delta.toFixed(4) + ')')
      : ' &middot; stayed (no Δ Q > 0)';
    return "node " + ev.v + " &middot; sweep " + (ev.sweepIdx + 1)
         + " · visit " + (ev.visitInSweep + 1) + verb;
  }
  function moveStatsHTML(idx) {
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

  // ── Stage 3, 4, 5 mounters (idempotent: tear down host DOM first) ─
  function mountStage3(res) {
    const host = document.getElementById("g-agg-cy");
    if (host) host.innerHTML = "";
    const cap = document.getElementById("g-agg-cap");
    if (cap) cap.textContent = "after · super-graph (n = ·)";
    P.mountAggregation({
      vizHostId: "g-agg-cy",
      fineMembership: Array.from(res.levels[0].finePost),
      capEl: cap,
      playBtn: document.getElementById("g-agg-play"),
      resetBtn: document.getElementById("g-agg-reset"),
    });
  }

  function mountStage4(res) {
    const tbody = document.getElementById("g-levels-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    // Compute absolute Q at each level by replaying moves up to that
    // level + scoring on the original graph. The level table now shows
    // both ΔQ for the level and Q_after, so the resolution-limit story
    // (Q monotonically rises while planted-recovery quality drops) is
    // visible in numbers, not just inferred from prose.
    const G0 = LV.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    const Q = LV.Modularity();
    let cumQ = Q.quality(LV.Partition(G0, null, Q));  // Q_0
    res.levels.forEach(function (lv, i) {
      let totMoves = 0, totDQ = 0;
      lv.sweeps.forEach(function (sw) { totMoves += sw.nbMoves; totDQ += sw.totalImprov; });
      const Pcheck = LV.Partition(G0, Array.from(lv.finePost), Q);
      const Qabs = Q.quality(Pcheck);
      cumQ = Qabs;
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + i + '</td>' +
        '<td>' + lv.collapsedVcountBefore + '</td>' +
        '<td>' + lv.collapsedNcomm + '</td>' +
        '<td>' + lv.newCollapsedVcount + '</td>' +
        '<td>' + lv.sweeps.length + '</td>' +
        '<td>' + totMoves + '</td>' +
        '<td>' + totDQ.toFixed(4) + '</td>' +
        '<td>' + Qabs.toFixed(4) + '</td>';
      tbody.appendChild(tr);
    });
  }

  function disconnectedComms(membership) {
    const idxById = P.indexById(F);
    const adj = new Map();
    F.nodes.forEach(function (id) { adj.set(id, []); });
    F.edges.forEach(function (e) {
      adj.get(e[0]).push(e[1]); adj.get(e[1]).push(e[0]);
    });
    const seen = new Set();
    const badComms = new Set();
    F.nodes.forEach(function (start) {
      if (seen.has(start)) return;
      const comm = membership[idxById[start]];
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
      const allInComm = F.nodes.filter(function (id) {
        return membership[idxById[id]] === comm;
      });
      if (found.length < allInComm.length) badComms.add(comm);
    });
    return Array.from(badComms);
  }

  function mountStage5(res) {
    document.getElementById("g-final-louvain").innerHTML = "";
    document.getElementById("g-final-gt").innerHTML = "";
    P.mountFinalCompare({
      leidenHostId: "g-final-louvain",
      gtHostId: "g-final-gt",
      statsTbody: document.querySelector("#g-final-stats tbody"),
      membership: res.partition.membership(),
      hValue: res.quality,
      hValueEl: document.getElementById("g-final-Q"),
    });
    const badEl = document.getElementById("g-final-disconn");
    if (badEl) {
      const bad = disconnectedComms(res.partition.membership());
      if (bad.length === 0) {
        badEl.innerHTML = '<em>None.</em> On this small fixture, Louvain happens to land on a connected partition.';
      } else {
        badEl.innerHTML = 'communities <strong>' + bad.join(', ') + '</strong> are internally disconnected. '
          + 'These are the cases the paper Traag et al. 2019 measured at up to 16% on real benchmark networks; '
          + "Leiden's refinement phase splits them automatically. See <a href=\"./leiden-cpm.html\">Leiden-CPM</a>.";
      }
    }
  }

  // ── Apply a fresh kernel result across every stage ──────────────
  function applyResult(res, opts) {
    opts = opts || {};
    result = res;
    rebuildPhase1Trace(res);
    if (moveSeedEl) moveSeedEl.textContent = String(seed);

    if (!walker) {
      walker = P.mountStepWalker({
        vizHostId: "g-move-cy",
        panelHostId: "g-move-panel",
        ctlPrefix: "g-move",
        events: phase1Events,
        snapshotAt: moveSnapshot,
        sidePanelHTML: moveCandPanel,
        onRender: function (idx, ev) {
          if (moveStatusEl) moveStatusEl.innerHTML = moveStatusHTML(idx, ev);
          if (moveStatsEl)  moveStatsEl.innerHTML  = moveStatsHTML(idx);
          if (moveSweepEl) {
            const sweepNum = ev ? (ev.sweepIdx + 1) : 0;
            const totalSweeps = result.levels[0].sweeps.length;
            moveSweepEl.textContent = "sweep " + sweepNum + " / " + totalSweeps;
          }
        },
        onRandStep: function (idx) {
          // Bump per-step seed; re-run; clamp cursor to MIN(idx-1, newTotal-1).
          // Strict [idx-1..end] preservation isn't possible because Louvain.run
          // threads a single RNG instance; new seed = new shuffle from visit 0.
          seed = (seed + 1009) | 0;
          applyResult(runKernel(seed), { keepIdx: Math.max(0, idx - 1) });
          return true;  // snap-render; applyResult already called controller.set
        },
        onRandAll: function () {
          seed = (seed + 1) | 0;
          applyResult(runKernel(seed), { keepIdx: 0 });
        },
        randStepDisabledAt: function (idx) { return idx <= 0; },
      });
    } else {
      // In-place re-bind: phase1Events + snapshots already mutated;
      // controller picks them up via closure on next render.
      const newTotal = phase1Events.length + 1;
      const targetIdx = (typeof opts.keepIdx === "number")
        ? Math.max(0, Math.min(newTotal - 1, opts.keepIdx))
        : 0;
      walker.controller.reconfigureKeep(newTotal, targetIdx);
    }

    mountStage3(res);
    mountStage4(res);
    mountStage5(res);

    if (typeof MathJax !== "undefined" && MathJax.typesetPromise) MathJax.typesetPromise();
  }

  // ── Initial run ─────────────────────────────────────────────────
  applyResult(runKernel(seed));
})();
