/* Infomap page glue — wires every stage of infomap.html via COMDET.PAGE
 * primitives + the kernel's recorded trace.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.INFOMAP || !COMDET.FIXTURE) {
    console.warn("[infomap page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, I = C.INFOMAP, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "infomap" });
  }

  // Run kernel once.
  const result = I.runFixture({ recordTrace: true });
  const g = result.graph;
  const p = result.stationary;

  // Helper: index-by-id for fixture (mirror of P.indexById).
  const idxByNode = {};
  F.nodes.forEach(function (id, i) { idxByNode[id] = i; });

  function partitionToMembership(part) {
    const out = new Array(g.n);
    for (let i = 0; i < g.n; i++) out[i] = part[i];
    return out;
  }

  // Convenience: total H(P) for the readouts.
  let HP = 0;
  for (let i = 0; i < g.n; i++) {
    if (p[i] > 0) HP -= p[i] * Math.log2(p[i]);
  }

  // ── Stage 0: input fixture ──────────────────────────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // ── Stage 1: stationary distribution viz ────────────────────────
  // Render fixture with node radius scaled to p_α. Same colour as GT but
  // scale radius so high-flow nodes are visibly bigger.
  const flowViz = P.renderFixture("g-flow-cy", {
    useGT: true, pinned: true, nodeR: 12,
  });
  const pMax = p.reduce(function (s, x) { return Math.max(s, x); }, 0);
  if (flowViz) {
    F.nodes.forEach(function (id) {
      const i = idxByNode[id];
      const r = 6 + 14 * Math.sqrt(p[i] / pMax);
      flowViz.setNodeStyle(id, { r: r });
    });
  }
  const flowSummary = document.getElementById("g-flow-summary");
  if (flowSummary) {
    flowSummary.innerHTML = "max p<sub>α</sub> = " + pMax.toFixed(4) + " (node 0) &middot; H(P) = " + HP.toFixed(3) + " bits";
  }

  // Stationary bar chart.
  function renderFlowBar() {
    const bar = document.getElementById("g-flow-bar");
    if (!bar) return;
    bar.innerHTML = "";
    const ordered = F.nodes.slice().sort(function (a, b) { return a - b; });
    ordered.forEach(function (id) {
      const i = idxByNode[id];
      const cell = document.createElement("div");
      cell.className = "flow-cell";
      cell.title = "node " + id + " · p = " + p[i].toFixed(4) + " · degree " + g.deg[i];
      const v = document.createElement("div");
      v.className = "v";
      v.style.height = (100 * p[i] / pMax) + "%";
      cell.appendChild(v);
      const lab = document.createElement("span");
      lab.className = "lab";
      lab.textContent = id;
      cell.appendChild(lab);
      bar.appendChild(cell);
    });
  }
  renderFlowBar();

  // ── Stage 2: singleton init ─────────────────────────────────────
  const singletonMembership = F.nodes.map(function (_, i) { return i; });
  P.renderFixture("g-singleton-cy", {
    membership: singletonMembership, pinned: true,
  });
  const singletonLEl = document.getElementById("g-singleton-L");
  if (singletonLEl) singletonLEl.textContent = result.initL.toFixed(3);

  // ── Stage 3: greedy joining walker ──────────────────────────────
  // Snapshots: idx 0 = singleton; idx k = state after k merges.
  // Build per-step partition snapshots from the recorded join traces.
  const joinSnapshots = [];
  joinSnapshots.push(singletonMembership.slice());
  const cur = singletonMembership.slice();
  result.joinTraces.forEach(function (t) {
    const a = t.merged.a, b = t.merged.b;
    for (let v = 0; v < g.n; v++) if (cur[v] === b) cur[v] = a;
    joinSnapshots.push(cur.slice());
  });

  function joinSnapshotAt(idx) {
    return joinSnapshots[Math.min(idx, joinSnapshots.length - 1)];
  }

  function joinEventStatus(idx, ev) {
    if (!ev) return "stage 0 · singletons · " + g.n + " modules";
    return "merge " + (idx) + " &middot; modules " + ev.merged.a + " ⊕ " + ev.merged.b
         + " &middot; ΔL = " + ev.dL.toFixed(4);
  }
  function joinStatsHTML(idx) {
    if (idx === 0) return "L: " + result.initL.toFixed(3) + " &middot; ΔL: ·";
    const ev = result.joinTraces[idx - 1];
    return "L: " + ev.newL.toFixed(3) + " &middot; ΔL cum: " + (ev.newL - result.initL).toFixed(3);
  }
  function joinPanelHTML(idx, ev) {
    if (!ev) return '<div class="step-desc">Pre-merge. 32 singletons, \\(L_0 = ' + result.initL.toFixed(3) + '\\) bits.</div>';
    let html = '<div class="step-desc">candidate adjacent module pairs at step ' + (idx) + ' &middot; pick = (' + ev.merged.a + ', ' + ev.merged.b + ')</div>';
    html += '<table class="cand-table"><thead><tr><th>pair</th><th>ΔL</th><th>verdict</th></tr></thead><tbody>';
    const top = ev.candidates.slice(0, 8);
    top.forEach(function (c) {
      const isPick = c.a === ev.merged.a && c.b === ev.merged.b;
      const cls = isPick ? "cand-pick" : (c.dL >= 0 ? "cand-fail" : "");
      const verdict = isPick ? "pick" : (c.dL >= 0 ? "no gain" : "");
      html += '<tr class="' + cls + '">'
            + '<td>(' + c.a + ', ' + c.b + ')</td>'
            + '<td>' + c.dL.toFixed(4) + '</td>'
            + '<td>' + verdict + '</td>'
            + '</tr>';
    });
    if (ev.candidates.length > top.length) {
      html += '<tr><td colspan="3" style="text-align:center;color:var(--paper-3)">+ ' + (ev.candidates.length - top.length) + ' more</td></tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  const joinStatusEl = document.getElementById("g-join-status");
  const joinStatsEl = document.getElementById("g-join-stats");
  const joinLevelEl = document.getElementById("g-join-level");

  P.mountStepWalker({
    vizHostId: "g-join-cy",
    panelHostId: "g-join-panel",
    ctlPrefix: "g-join",
    events: result.joinTraces.map(function (t, i) {
      return Object.assign({ idx: i }, t);
    }),
    snapshotAt: joinSnapshotAt,
    sidePanelHTML: joinPanelHTML,
    onRender: function (idx, ev) {
      if (joinStatusEl) joinStatusEl.innerHTML = joinEventStatus(idx, ev);
      if (joinStatsEl) joinStatsEl.innerHTML = joinStatsHTML(idx);
      if (joinLevelEl) joinLevelEl.textContent = "step " + idx;
      const panel = document.getElementById("g-join-panel");
      if (panel && typeof MathJax !== "undefined" && MathJax.typesetPromise) {
        MathJax.typesetPromise([panel]);
      }
    },
  });

  // ── Stage 4: tuning walker ──────────────────────────────────────
  // Tuning starts from the post-join partition; events are per-node visits.
  const tuneStart = result.joinPartition.slice();
  const tuneSnapshots = [];
  tuneSnapshots.push(tuneStart.slice());
  const tcur = tuneStart.slice();
  result.tuneTraces.forEach(function (t) {
    if (t.moved) tcur[t.v] = t.toComm;
    tuneSnapshots.push(tcur.slice());
  });
  function tuneSnapshotAt(idx) {
    return tuneSnapshots[Math.min(idx, tuneSnapshots.length - 1)];
  }
  function tuneEventStatus(ev) {
    if (!ev) return "starts from post-join partition · " + (new Set(tuneStart).size) + " modules";
    return "node " + g.ids[ev.v] + " &middot; visit " + (ev.idx + 1) + (ev.moved
      ? (' &middot; moved to module ' + ev.toComm + ' (ΔL = ' + ev.dL.toFixed(4) + ')')
      : ' &middot; stayed (no Δ < 0)');
  }
  function tuneStatsHTML(idx) {
    let moves = 0; let dlc = 0;
    for (let k = 0; k < idx; k++) {
      const t = result.tuneTraces[k];
      if (t.moved) { moves += 1; dlc += t.dL; }
    }
    return "moves: " + moves + " &middot; ΔL cum: " + dlc.toFixed(4);
  }
  function tunePanelHTML(idx, ev) {
    if (!ev) return '<div class="step-desc">Pre-tuning. Starts from post-join partition.</div>';
    let html = '<div class="step-desc">candidate modules for node ' + g.ids[ev.v] + ' &middot; current = ' + ev.fromComm + '</div>';
    html += '<table class="cand-table"><thead><tr><th>cand module</th><th>ΔL</th><th>verdict</th></tr></thead><tbody>';
    ev.candidates.forEach(function (c) {
      const cls = (c.comm === ev.toComm && ev.moved) ? 'cand-pick'
                : (c.comm === ev.fromComm ? 'cand-from' : (c.dL >= 0 ? '' : ''));
      const verdict = (c.comm === ev.toComm && ev.moved) ? 'pick'
                    : (c.comm === ev.fromComm ? 'current' : (c.dL >= 0 ? 'no gain' : ''));
      html += '<tr class="' + cls + '"><td>' + c.comm + '</td><td>'
            + c.dL.toFixed(4) + '</td><td>' + verdict + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  const tuneStatusEl = document.getElementById("g-tune-status");
  const tuneStatsEl = document.getElementById("g-tune-stats");
  P.mountStepWalker({
    vizHostId: "g-tune-cy",
    panelHostId: "g-tune-panel",
    ctlPrefix: "g-tune",
    events: result.tuneTraces.map(function (t, i) {
      return Object.assign({ idx: i }, t);
    }),
    snapshotAt: tuneSnapshotAt,
    sidePanelHTML: tunePanelHTML,
    onRender: function (idx, ev) {
      if (tuneStatusEl) tuneStatusEl.innerHTML = tuneEventStatus(ev);
      if (tuneStatsEl) tuneStatsEl.innerHTML = tuneStatsHTML(idx);
    },
  });

  // ── Stage 5: hierarchy tree ─────────────────────────────────────
  function renderHier() {
    const tree = document.getElementById("g-hier-tree");
    if (!tree) return;
    tree.innerHTML = "";
    const flat = result.tunePartition;
    const mods = new Map();
    F.nodes.forEach(function (id, i) {
      const m = flat[i];
      if (!mods.has(m)) mods.set(m, []);
      mods.get(m).push(id);
    });
    const sortedMods = Array.from(mods.keys()).sort(function (a, b) {
      return mods.get(b).length - mods.get(a).length;
    });
    sortedMods.forEach(function (m) {
      const members = mods.get(m);
      const sub = result.subLevel[m];
      const r1 = document.createElement("div");
      r1.className = "row l1";
      const sw = document.createElement("span");
      sw.className = "swatch"; sw.style.background = P.partitionColor(m);
      r1.appendChild(sw);
      const txt = document.createElement("span");
      txt.innerHTML = "module " + m + " &middot; " + members.length + " nodes "
                     + '<span class="meta">{' + members.slice(0, 8).join(",")
                     + (members.length > 8 ? ",…" : "") + '}</span>';
      r1.appendChild(txt);
      tree.appendChild(r1);
      if (sub && sub.subPartition) {
        const subDistinct = new Set(sub.subPartition);
        if (subDistinct.size > 1) {
          // Group sub-partition by sub-id.
          const subMap = new Map();
          sub.subPartition.forEach(function (sm, idx) {
            if (!subMap.has(sm)) subMap.set(sm, []);
            subMap.get(sm).push(sub.ids[idx]);
          });
          subMap.forEach(function (mems, sm) {
            const r2 = document.createElement("div");
            r2.className = "row l2";
            r2.innerHTML = '↳ sub-module ' + sm + ' &middot; ' + mems.length + ' nodes '
                          + '<span class="meta">{' + mems.join(",") + '}</span>';
            tree.appendChild(r2);
          });
        } else {
          const r2 = document.createElement("div");
          r2.className = "row l2";
          r2.innerHTML = '↳ no internal split (subL = ' + sub.subL.toFixed(3) + ')';
          tree.appendChild(r2);
        }
      } else {
        const r2 = document.createElement("div");
        r2.className = "row l2";
        r2.innerHTML = '↳ atomic (size &lt; 4 → no recursion)';
        tree.appendChild(r2);
      }
    });
  }
  renderHier();

  // ── Stage 6: final compare ──────────────────────────────────────
  const memArr = partitionToMembership(result.tunePartition);
  P.mountFinalCompare({
    leidenHostId: "g-final-info",
    gtHostId: "g-final-gt",
    statsTbody: document.querySelector("#g-final-stats tbody"),
    membership: memArr,
  });

  // L_one = full graph one module: every step within one module ⇒ q = 0,
  // L = -Σ p log p = H(P).
  const L1 = HP;
  const setLab = function (id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setLab("g-final-L", result.finalL.toFixed(3));
  setLab("g-final-L2", result.finalL.toFixed(3));
  setLab("g-final-L0", result.initL.toFixed(3));
  setLab("g-final-L1", L1.toFixed(3));
  setLab("g-final-L3", result.finalL.toFixed(3));
  setLab("g-final-mods", new Set(result.finalPartition).size);

  if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
    MathJax.typesetPromise();
  }
})();
