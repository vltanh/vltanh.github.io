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
  if (!window.COMDET || !COMDET.PAGE || !COMDET.LOUVAIN || !COMDET.COMMON || !COMDET.FIXTURE) {
    console.warn("[louvain page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, LV = C.LOUVAIN, CC = C.COMMON, F = C.FIXTURE;

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
    const G = CC.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
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
    const Gloc = CC.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
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
    const Gloc = CC.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
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

  // ── Per-sweep snapshot membership ───────────────────────────────
  // The kernel records per-visit traces inside `lv0.sweeps`. To replay
  // the partition at the end of sweep k, walk every accepted move in
  // sweeps 0..k and apply it to a singleton Partition. The result is a
  // membership snapshot identical to what the kernel produced internally.
  function sweepCloseMembership(res, swIdx) {
    const G = CC.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    const Pl = LV.Partition(G, null, LV.Modularity());
    const lv0 = res.levels[0];
    for (let k = 0; k <= swIdx && k < lv0.sweeps.length; k++) {
      lv0.sweeps[k].traces.forEach(function (t) {
        if (t.moved) Pl.moveNode(t.v, t.toComm);
      });
    }
    return Array.from(Pl.membership());
  }

  function sweepStats(res, swIdx) {
    const sw = res.levels[0].sweeps[swIdx];
    if (!sw) return { moves: 0, dq: 0 };
    return { moves: sw.nbMoves, dq: sw.totalImprov };
  }

  // ── Stage 2 / 3 mounters: per-sweep static frames ───────────────
  function mountSweepFrame(hostId, swIdx, res, captions) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = "";
    const lv0 = res.levels[0];
    if (swIdx >= lv0.sweeps.length) {
      // Sweep does not exist on this seed. Render the post-phase-1
      // membership and surface a "phase 1 finished earlier" tag.
      P.renderFixture(hostId, {
        membership: Array.from(lv0.finePost), pinned: true,
      });
      if (captions.movesEl) captions.movesEl.textContent = "n/a";
      if (captions.dqEl) captions.dqEl.textContent = "phase 1 already converged";
      return;
    }
    const mem = sweepCloseMembership(res, swIdx);
    P.renderFixture(hostId, { membership: mem, pinned: true });
    const s = sweepStats(res, swIdx);
    if (captions.movesEl) captions.movesEl.textContent = String(s.moves);
    if (captions.dqEl)    captions.dqEl.textContent    = s.dq.toFixed(4);
  }

  function mountStage2(res) {
    mountSweepFrame("g-sweep1-cy", 0, res, {
      movesEl: document.getElementById("g-sweep1-mv"),
      dqEl:    document.getElementById("g-sweep1-dq"),
    });
  }
  function mountStage3_sweep(res) {
    mountSweepFrame("g-sweep2-cy", 1, res, {
      movesEl: document.getElementById("g-sweep2-mv"),
      dqEl:    document.getElementById("g-sweep2-dq"),
    });
  }

  // ── Stage 5: worked candidate-enumeration example ───────────────
  // Pick the first accepted move on sweep 1 whose candidate set has at
  // least two non-trivial entries. Render the visited node's local
  // graph with the candidate set highlighted, plus a side table.
  function pickCandWorkedExample(res) {
    const lv0 = res.levels[0];
    if (!lv0 || !lv0.sweeps.length) return null;
    const sw0 = lv0.sweeps[0];
    for (let i = 0; i < sw0.traces.length; i++) {
      const t = sw0.traces[i];
      if (t.moved && t.candidates && t.candidates.length >= 2) return t;
    }
    return sw0.traces.find(function (t) { return t.candidates && t.candidates.length; }) || null;
  }

  function pickTieExample(res) {
    // Scan every sweep at level 0 for a candidate set where two distinct
    // candidates score within 1e-9 of each other (effective tie under
    // strict >). Returns the trace + the colliding pair, or a fallback
    // visit highlighting that genuine ties are rare on this fixture.
    const lv0 = res.levels[0];
    if (!lv0) return null;
    for (let s = 0; s < lv0.sweeps.length; s++) {
      const traces = lv0.sweeps[s].traces;
      for (let i = 0; i < traces.length; i++) {
        const t = traces[i];
        const cands = (t.candidates || []).filter(function (c) { return c.comm !== t.fromComm; });
        for (let a = 0; a < cands.length; a++) {
          for (let b = a + 1; b < cands.length; b++) {
            if (Math.abs(cands[a].gain - cands[b].gain) < 1e-9 &&
                cands[a].gain > 0) {
              return { trace: t, pair: [cands[a], cands[b]] };
            }
          }
        }
      }
    }
    return null;
  }

  function renderCandFrame(hostId, tableId, captionId, nodeLabelId, trace, mode) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = "";
    if (!trace) {
      P.renderFixture(hostId, { pinned: true });
      const cap = document.getElementById(captionId);
      if (cap) cap.textContent = "no qualifying visit on this seed";
      const tableEl = document.getElementById(tableId);
      if (tableEl) tableEl.innerHTML = "";
      return;
    }
    // Highlight v + the candidate communities by colouring their members.
    const candComms = new Set((trace.candidates || []).map(function (c) { return c.comm; }));
    const initialMem = sweepCloseMembership(res_for(trace), trace.sweepIdx != null ? trace.sweepIdx - 1 : -1);
    // Fallback: singleton init colours each node as its own community.
    const mem = (initialMem && initialMem.length === F.nodes.length)
      ? initialMem
      : F.nodes.map(function (_, i) { return i; });
    const viz = P.renderFixture(hostId, { membership: mem, pinned: true });
    if (viz) {
      P.focusNode(viz, F, trace.v, "hi");
    }
    const cap = document.getElementById(captionId);
    if (cap) {
      const verdict = trace.moved
        ? ("picked comm " + trace.toComm + " with Δ Q = " + (trace.delta || 0).toFixed(4))
        : "no candidate cleared Δ Q > 0 — stayed in place";
      cap.textContent = verdict;
    }
    if (nodeLabelId) {
      const lab = document.getElementById(nodeLabelId);
      if (lab) lab.textContent = String(trace.v);
    }
    const tableEl = document.getElementById(tableId);
    if (tableEl) {
      const m2 = (function () {
        let tw = 0; F.edges.forEach(function () { tw += 1; }); return 2 * tw;
      })();
      const rows = (trace.candidates || []).slice().sort(function (a, b) { return b.gain - a.gain; });
      let html = '<table class="cand-table"><thead><tr><th>cand comm</th><th>Δ Q (gain / m)</th><th>verdict</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        const isPick  = (r.comm === trace.toComm && trace.moved);
        const isFrom  = (r.comm === trace.fromComm);
        const cls = isPick ? "cand-pick" : (isFrom ? "cand-from" : "");
        let verdict;
        if (mode === "tie") {
          const tiePair = (trace.__tiePair || []).map(function (c) { return c.comm; });
          if (isPick) verdict = "pick (earlier in adj order)";
          else if (tiePair.indexOf(r.comm) >= 0) verdict = "tied (loses on order)";
          else if (isFrom) verdict = "current (Δ Q = 0)";
          else verdict = r.gain <= 0 ? "reject (≤ 0)" : "";
        } else {
          verdict = isPick ? "pick" : (isFrom ? "current (Δ Q = 0)" : (r.gain <= 0 ? "reject (≤ 0)" : ""));
        }
        const dq = (r.gain / m2);
        html += '<tr class="' + cls + '"><td>' + r.comm + '</td><td>'
              + dq.toFixed(4) + '</td><td>' + verdict + '</td></tr>';
      });
      html += "</tbody></table>";
      tableEl.innerHTML = html;
    }
  }

  // Reach-back to the active result from inside renderCandFrame without
  // threading res through every layer. Module-scoped `result` holds the
  // currently-applied kernel output.
  function res_for(_trace) { return result; }

  function mountStage5(res) {
    const trace = pickCandWorkedExample(res);
    if (trace) trace.sweepIdx = (function () {
      const lv0 = res.levels[0];
      for (let s = 0; s < lv0.sweeps.length; s++) {
        if (lv0.sweeps[s].traces.indexOf(trace) >= 0) return s;
      }
      return 0;
    })();
    renderCandFrame("g-cand-cy", "g-cand-table", "g-cand-caption", "g-cand-node", trace, "cand");
  }
  function mountStage6(res) {
    const tie = pickTieExample(res);
    if (!tie) {
      // No exact tie on this seed; show the closest-near-tie pair from
      // the candidate-worked example with an explanatory caption.
      const trace = pickCandWorkedExample(res);
      if (trace) {
        trace.__tiePair = [];
        trace.sweepIdx = 0;
      }
      renderCandFrame("g-tie-cy", "g-tie-table", "g-tie-caption", "g-tie-node", trace, "tie");
      const cap = document.getElementById("g-tie-caption");
      if (cap) cap.textContent = "no exact tie on this seed. Showing the first visit; gains differ but the order rule would still pick earlier-in-adjacency on a true tie.";
      return;
    }
    tie.trace.__tiePair = tie.pair;
    tie.trace.sweepIdx = (function () {
      const lv0 = res.levels[0];
      for (let s = 0; s < lv0.sweeps.length; s++) {
        if (lv0.sweeps[s].traces.indexOf(tie.trace) >= 0) return s;
      }
      return 0;
    })();
    renderCandFrame("g-tie-cy", "g-tie-table", "g-tie-caption", "g-tie-node", tie.trace, "tie");
  }

  // ── Stages 8 / 9: super-graph renderers ─────────────────────────
  // A super-graph is a tiny weighted multi-loop graph (one super-node
  // per community at the level, self-loop weight = intra-edge mass,
  // super-edge weight = inter-comm mass). We render it as a circular
  // layout SVG: node radius scales with intra-weight, edge width with
  // inter-weight, self-loops show as a small arc on the super-node.
  function renderSuperGraph(hostId, supN, supEdges, supSelf, captionEl, stateEl, captionText, stateText) {
    const host = document.getElementById(hostId);
    if (!host || typeof d3 === "undefined") return;
    host.innerHTML = "";
    if (supN <= 0) {
      if (captionEl) captionEl.textContent = captionText || "no super-graph";
      return;
    }
    const vbW = 400, vbH = 320;
    const cx = vbW / 2, cy = vbH / 2;
    const R = Math.min(vbW, vbH) / 2 - 50;
    const POS = [];
    for (let i = 0; i < supN; i++) {
      const t = (supN === 1) ? 0 : (i / supN) * 2 * Math.PI - Math.PI / 2;
      POS.push({ x: (supN === 1 ? cx : cx + R * Math.cos(t)),
                 y: (supN === 1 ? cy : cy + R * Math.sin(t)) });
    }
    const svg = d3.select(host).append("svg")
      .attr("class", "viz-svg")
      .attr("viewBox", "0 0 " + vbW + " " + vbH)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%").style("height", "100%")
      .style("display", "block");
    const gE = svg.append("g");
    const gN = svg.append("g");
    const gL = svg.append("g");
    supEdges.forEach(function (e) {
      const a = POS[e.lo], b = POS[e.hi];
      gE.append("line")
        .attr("x1", a.x).attr("y1", a.y).attr("x2", b.x).attr("y2", b.y)
        .attr("stroke", "#3a3f4a")
        .attr("stroke-width", Math.min(8, 1 + Math.sqrt(e.w) * 1.2))
        .attr("opacity", 0.7);
      gL.append("text")
        .attr("x", (a.x + b.x) / 2).attr("y", (a.y + b.y) / 2 - 6)
        .attr("text-anchor", "middle")
        .attr("font-family", "Special Elite, Courier New, monospace")
        .attr("font-size", 10).attr("fill", "#9b8a5a")
        .text(String(e.w));
    });
    POS.forEach(function (p, i) {
      const self = supSelf[i] || 0;
      const r = 14 + Math.min(20, Math.sqrt(self) * 3);
      gN.append("circle")
        .attr("cx", p.x).attr("cy", p.y).attr("r", r)
        .attr("fill", P.partitionColor(i))
        .attr("stroke", "#1b2033").attr("stroke-width", 1.5);
      if (self > 0) {
        // Self-loop arc: small loop hanging off the node, labelled with weight.
        const lr = Math.max(7, Math.min(14, Math.sqrt(self) * 1.3));
        const lx = p.x + r + lr * 0.6, ly = p.y - r;
        gN.append("circle")
          .attr("cx", lx).attr("cy", ly).attr("r", lr)
          .attr("fill", "none")
          .attr("stroke", "#9b8a5a").attr("stroke-width", 1.4)
          .attr("opacity", 0.85);
        gL.append("text")
          .attr("x", lx).attr("y", ly + 3)
          .attr("text-anchor", "middle")
          .attr("font-family", "Special Elite, Courier New, monospace")
          .attr("font-size", 10).attr("fill", "#9b8a5a")
          .text(String(self));
      }
      gN.append("text")
        .attr("x", p.x).attr("y", p.y)
        .attr("text-anchor", "middle").attr("dominant-baseline", "central")
        .attr("font-family", "Special Elite, Courier New, monospace")
        .attr("font-size", 11).attr("fill", "#1b2033")
        .attr("pointer-events", "none")
        .text(String(i));
    });
    if (captionEl) captionEl.textContent = captionText || ("super-graph: n = " + supN + ", e = " + supEdges.length);
    if (stateEl)   stateEl.textContent   = stateText || "";
  }

  // Compute the level-k super-graph signature (super-node count, intra
  // weights, inter weights) from res.levels[k] by collapsing the
  // pre-level partition through Graph.collapse.
  function levelSuperSignature(res, k) {
    const lv = res.levels[k];
    if (!lv) return null;
    // Build collapsedG_k by replaying every level up to k.
    let G = CC.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    for (let i = 0; i < k; i++) {
      const lvI = res.levels[i];
      const Pi = LV.Partition(G, null, LV.Modularity());
      // Use the kernel's recorded post-level membership at this level
      // to set the partition; renumber by original-id-ASC mirrors the
      // kernel's collapse step.
      const memI = (function () {
        // Per-level local membership: recover by composing finePost[i]
        // back to the entering super-graph node ids. Easier: replay
        // every move from sw0..swEnd at level i. The trace's `v` ids
        // index into the entering super-graph, so we replay on Pi.
        lvI.sweeps.forEach(function (sw) {
          sw.traces.forEach(function (t) {
            if (t.moved) Pi.moveNode(t.v, t.toComm);
          });
        });
        Pi.renumber();
        return Pi.membership();
      })();
      G = G.collapse(memI, Pi.ncomm());
    }
    // Now G is the entering super-graph for level k. Build the level-k
    // super-graph signature by inspecting G's edges directly.
    const supN = G.vcount();
    const supSelf = new Array(supN).fill(0);
    const supEdgeMap = {};
    for (let e = 0; e < G.ecount(); e++) {
      const pair = G.edge(e), u = pair[0], v = pair[1], w = G.edgeWeight(e);
      if (u === v) { supSelf[u] += w; continue; }
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = lo + "|" + hi;
      supEdgeMap[key] = (supEdgeMap[key] || 0) + w;
    }
    const supEdges = Object.keys(supEdgeMap).map(function (key) {
      const parts = key.split("|");
      return { lo: +parts[0], hi: +parts[1], w: supEdgeMap[key] };
    });
    return { supN: supN, supSelf: supSelf, supEdges: supEdges };
  }

  function mountStage8(res) {
    const sig = levelSuperSignature(res, 1);
    if (!sig) {
      // Phase 1 at level 0 converged with no merges, so no level-1
      // super-graph exists. Show a single-node placeholder.
      renderSuperGraph("g-sg1-cy", 0, [], [],
        document.getElementById("g-sg1-meta"), null,
        "level-0 produced no merges &middot; no level-1 super-graph",
        null);
      return;
    }
    const meta = "n = " + sig.supN + " &middot; super-edges = " + sig.supEdges.length;
    renderSuperGraph("g-sg1-cy", sig.supN, sig.supEdges, sig.supSelf,
      document.getElementById("g-sg1-meta"), null, meta, null);
  }

  function mountStage9(res) {
    // Level-2 entering super-graph if it exists.
    const sig = levelSuperSignature(res, 2);
    const lv1 = res.levels[1];
    const lv2 = res.levels[2];
    if (!sig || !lv2) {
      // Level 1 was the deepest level. Render the level-1 outcome with a
      // "termination" caption.
      const sig1 = levelSuperSignature(res, 1);
      const note = lv1
        ? "level-1 sweep did not produce further merges &middot; aggregation terminated"
        : "phase 1 at level 0 already terminated";
      if (sig1) {
        renderSuperGraph("g-sg2-cy", sig1.supN, sig1.supEdges, sig1.supSelf,
          document.getElementById("g-sg2-meta"),
          document.getElementById("g-sg2-state"),
          "n = " + sig1.supN + " (no further collapse)",
          note);
      } else {
        renderSuperGraph("g-sg2-cy", 0, [], [],
          document.getElementById("g-sg2-meta"),
          document.getElementById("g-sg2-state"),
          "no super-graph",
          note);
      }
      return;
    }
    const meta = "n = " + sig.supN + " &middot; super-edges = " + sig.supEdges.length;
    renderSuperGraph("g-sg2-cy", sig.supN, sig.supEdges, sig.supSelf,
      document.getElementById("g-sg2-meta"),
      document.getElementById("g-sg2-state"),
      meta, "level 2 active");
  }

  // ── NMI / ARI ───────────────────────────────────────────────────
  // Standard external clustering measures (Vinh, Epps, Bailey 2010).
  // Both pass through a contingency table built from the two label
  // vectors over the same n nodes.
  function contingency(a, b) {
    const n = a.length;
    const rows = new Map();
    for (let i = 0; i < n; i++) {
      const ka = a[i], kb = b[i];
      if (!rows.has(ka)) rows.set(ka, new Map());
      const r = rows.get(ka);
      r.set(kb, (r.get(kb) || 0) + 1);
    }
    return rows;
  }
  function nmi(a, b) {
    const n = a.length;
    const C = contingency(a, b);
    const rowSum = new Map(), colSum = new Map();
    C.forEach(function (row, ka) {
      let rs = 0;
      row.forEach(function (v, kb) {
        rs += v;
        colSum.set(kb, (colSum.get(kb) || 0) + v);
      });
      rowSum.set(ka, rs);
    });
    let Hx = 0, Hy = 0, I = 0;
    rowSum.forEach(function (v) { const p = v / n; if (p > 0) Hx -= p * Math.log(p); });
    colSum.forEach(function (v) { const p = v / n; if (p > 0) Hy -= p * Math.log(p); });
    C.forEach(function (row, ka) {
      row.forEach(function (v, kb) {
        if (v === 0) return;
        const pij = v / n, pi = rowSum.get(ka) / n, pj = colSum.get(kb) / n;
        I += pij * Math.log(pij / (pi * pj));
      });
    });
    if (Hx + Hy <= 0) return 1;
    return (2 * I) / (Hx + Hy);
  }
  function ari(a, b) {
    const n = a.length;
    const C = contingency(a, b);
    function c2(x) { return x * (x - 1) / 2; }
    let sumIJ = 0;
    const rowSum = new Map(), colSum = new Map();
    C.forEach(function (row, ka) {
      let rs = 0;
      row.forEach(function (v, kb) {
        rs += v;
        sumIJ += c2(v);
        colSum.set(kb, (colSum.get(kb) || 0) + v);
      });
      rowSum.set(ka, rs);
    });
    let sumI = 0, sumJ = 0;
    rowSum.forEach(function (v) { sumI += c2(v); });
    colSum.forEach(function (v) { sumJ += c2(v); });
    const t3 = (sumI * sumJ) / c2(n);
    const denom = 0.5 * (sumI + sumJ) - t3;
    if (denom === 0) return 1;
    return (sumIJ - t3) / denom;
  }

  // ── Stage 3, 4, 5 mounters (idempotent: tear down host DOM first) ─
  // Historical names: mountStage3/4/5 below correspond to stages 7/10/11
  // in the post-2026-05-12 14-stage layout. Kept under their old names to
  // minimise downstream churn in the page's apply flow.
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
    const G0 = CC.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
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

  function mountStage5_final(res) {
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
    // NMI / ARI against planted ground-truth.
    const pred = res.partition.membership();
    const gt = F.gt;
    const predArr = Array.from(pred);
    const nmiEl = document.getElementById("g-final-nmi");
    const ariEl = document.getElementById("g-final-ari");
    if (nmiEl) nmiEl.textContent = nmi(predArr, gt).toFixed(3);
    if (ariEl) ariEl.textContent = ari(predArr, gt).toFixed(3);
  }

  function mountStage12(res) {
    // Render the input fixture, coloured by Louvain's final partition,
    // with disconnected communities flagged in the chrome.
    const host = document.getElementById("g-disc-cy");
    if (host) host.innerHTML = "";
    const mem = Array.from(res.partition.membership());
    const viz = P.renderFixture("g-disc-cy", { membership: mem, pinned: true });
    const bad = disconnectedComms(mem);
    const stateEl = document.getElementById("g-disc-state");
    if (stateEl) {
      stateEl.textContent = bad.length === 0
        ? "no disconnected community on this seed"
        : (bad.length + " disconnected community" + (bad.length > 1 ? "ies" : ""));
    }
    // Highlight every node sitting inside a disconnected community.
    if (bad.length > 0 && viz) {
      const badSet = new Set(bad);
      F.nodes.forEach(function (id, i) {
        if (badSet.has(mem[i])) viz.addNodeClass(id, "hi");
      });
    }
    const badEl = document.getElementById("g-final-disconn");
    if (badEl) {
      if (bad.length === 0) {
        badEl.innerHTML = '<em>None on this seed.</em> On this small fixture Louvain happens to land on a connected partition. Re-roll the seed in stage 4 to inspect runs where a disconnect surfaces.';
      } else {
        badEl.innerHTML = 'Communities <strong>' + bad.join(', ') + '</strong> are internally disconnected: the planted graph has no path between two pieces sharing the same label. '
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

    mountStage2(res);        // sweep 1 snapshot
    mountStage3_sweep(res);  // sweep 2 snapshot
    mountStage5(res);        // candidate-enumeration worked example
    mountStage6(res);        // tie-break worked example
    mountStage3(res);        // L0→L1 aggregation viz
    mountStage8(res);        // phase 1 on level-1 super-graph
    mountStage9(res);        // L1→L2 aggregation viz (or termination)
    mountStage4(res);        // level table
    mountStage5_final(res);  // final partition + NMI/ARI
    mountStage12(res);       // connectivity-failure stage

    if (typeof MathJax !== "undefined" && MathJax.typesetPromise) MathJax.typesetPromise();
  }

  // ── Initial run ─────────────────────────────────────────────────
  applyResult(runKernel(seed));
})();
