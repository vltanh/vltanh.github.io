/* sbm-nested-best page glue. 17-stage layout: each stage owns its own
 * <div class="graph"> viz frame. The DC + NDC chains run from one shared
 * seeded init; per-stage dioramas use the resulting traces + per-level
 * partitions. Live walkers (stage 6 level-0 MH, stage 8 level-1 MH) drive
 * step controllers; the rest are static d3 dioramas redrawn on reroll.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.SBM
      || !COMDET.SBM.BlockState || !COMDET.SBM.Graph
      || !COMDET.SBM.MT19937 || !COMDET.SBM.NestedBlockState
      || !COMDET.SBM.buildLevelGraph || !COMDET.FIXTURE) return;

  const C = COMDET, P = C.PAGE, SBM = C.SBM, F = C.FIXTURE, U = SBM.UTIL;

  const VARIANTS = [
    SBM.VARIANTS ? SBM.VARIANTS.dc  : { id: "dc",  label: "DC",  color: "#7b9bd6", opts: { mode: "dc"  } },
    SBM.VARIANTS ? SBM.VARIANTS.ndc : { id: "ndc", label: "NDC", color: "#e0a649", opts: { mode: "ndc" } },
  ];

  const K_SWEEPS = 20;
  const INIT_B = 8;
  const BETA = 1.0;
  const N_LEVELS_BUDGET = 4;
  const SBM_THRESHOLD = 5;
  const SBM_DECISIVE = 10;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "sbm-nested-best" });
  }

  const G0 = SBM.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
  let seed = 7;
  let state = null;

  // ── Chain build ────────────────────────────────────────────────
  function buildSharedInit(s) {
    const rng = SBM.MT19937(s >>> 0);
    return U.makeBlockInit(rng, F.nodes.length, INIT_B);
  }
  function runVariantFull(v, sharedInit) {
    // Single-level walker run (DC chain owns the live level-0 walker
    // on stage 6). Records traces + per-event candidates.
    const rng = SBM.MT19937(seed >>> 0);
    const N = F.nodes.length;
    const init = sharedInit.slice();
    const flat = SBM.BlockState(G0, Object.assign({ init: init }, v.opts));
    const initialMembership = flat.blockMembership();
    const S0_level0 = flat.entropy();
    const eq = SBM.equilibrate(flat, rng, {
      sweeps: K_SWEEPS, beta: BETA,
      recordTrace: true, recordCandidates: true,
    });
    // Replay accepted moves on a sibling state to snapshot per-event memberships.
    const replay = SBM.BlockState(G0, Object.assign({ init: initialMembership }, v.opts));
    const snapsMem = new Array(eq.traces.length + 1);
    const snapsS = new Float64Array(eq.traces.length + 1);
    snapsMem[0] = initialMembership;
    snapsS[0] = S0_level0;
    for (let i = 0; i < eq.traces.length; i++) {
      const t = eq.traces[i];
      if (t.accepted) {
        replay.moveVertex(t.v, t.toS);
        snapsMem[i + 1] = replay.blockMembership();
        snapsS[i + 1] = replay.entropy();
      } else {
        snapsMem[i + 1] = snapsMem[i];
        snapsS[i + 1] = snapsS[i];
      }
    }
    // Build the post-chain nested hierarchy by stacking flat BlockStates
    // over the level-0 mode partition.
    const finalLevel0Mem = flat.blockMembership();
    const hierarchy = [finalLevel0Mem];
    for (let l = 1; l < N_LEVELS_BUDGET; l++) {
      // Initial level-l membership is "every level-l vertex alone"
      // (singleton init); the per-level chain then merges down.
      // Use a long-enough Int32Array; NestedBlockState reads the size
      // from the parent's Bne and reads only that many slots.
      hierarchy.push(new Int32Array(N).map(function (_, i) { return i; }));
    }
    const nested = SBM.NestedBlockState(G0, { mode: v.opts.mode, hierarchy: hierarchy });
    // Per-level chain: one MH sweep per level per outer iteration. The
    // page mounts this for the per-level Σ trace + level-1 walker. The
    // chain runs round-robin: sweep level l, rebuild level l+1, sweep
    // level l+1, ... up to top.
    const perLevelSeries = []; // array of {l, sweep, S, B}
    for (let l = 0; l < nested.nLevels; l++) {
      perLevelSeries.push({ l: l, samples: [{ sweep: 0, S: nested.levelEntropy(l), B: nested.level(l).nonEmptyBlocks().length }] });
    }
    // Drive K_LEVEL_SWEEPS outer iterations of single-level sweeps so the
    // per-level trace has interesting shape. The level-0 chain on the
    // live walker is its own run; we re-build a parallel one here so the
    // per-level trace is consistent with the DC walker's level-0 series.
    const K_LEVEL_SWEEPS = 12;
    const rngL = SBM.MT19937((seed >>> 0) ^ 0xA5A5);
    // Capture a level-1 trace from the same shared init at the time the
    // level-0 chain reaches mid-equilibration (after the first 4 sweeps).
    // The level-1 walker uses that captured snapshot.
    let level1Walker = null;
    for (let it = 0; it < K_LEVEL_SWEEPS; it++) {
      for (let l = 0; l < nested.nLevels; l++) {
        const sub = nested.level(l);
        const out = SBM.mcmcSweep(sub, rngL, {
          beta: BETA, recordTrace: (l === 1 && it === 4),
          recordCandidates: (l === 1 && it === 4),
        });
        if (l === 1 && it === 4 && out.traces && out.traces.length) {
          // Snapshot the level-1 graph + initial membership + accepted-replay
          // membership trail so stage 8 can drive its walker without
          // mutating the live nested state.
          const subGraph = nested.levelGraph(l);
          const initMem = sub.blockMembership();
          const replaySub = SBM.BlockState(subGraph, { mode: "ndc", init: initMem });
          const subSnapsMem = new Array(out.traces.length + 1);
          subSnapsMem[0] = initMem;
          for (let i = 0; i < out.traces.length; i++) {
            const t = out.traces[i];
            // Roll-back: undo the post-sweep state to the pre-trace state
            // before applying the trace. But since `sub` was mutated by
            // mcmcSweep, we walk the trace on `replaySub` (which started
            // from initMem) instead. moveVertex commits permanently, so
            // we only commit accepted moves (matches the production
            // walker's snapshot convention).
            if (t.accepted) {
              replaySub.moveVertex(t.v, t.toS);
              subSnapsMem[i + 1] = replaySub.blockMembership();
            } else {
              subSnapsMem[i + 1] = subSnapsMem[i];
            }
          }
          // Stable per-stage record. Per-vertex coords for the level-1
          // walker are computed at mount time off subGraph.
          level1Walker = {
            graph: subGraph,
            traces: out.traces,
            snapsMem: subSnapsMem,
          };
        }
        // Record per-level samples after this single sweep. The outer
        // sweep counter is `it+1`; each level got one sweep this iteration.
        const samp = perLevelSeries[l];
        samp.samples.push({
          sweep: it + 1,
          S: sub.entropy(),
          B: sub.nonEmptyBlocks().length,
        });
      }
    }
    return {
      id: v.id,
      label: v.label,
      color: v.color,
      // Level-0 chain (drives stage 6 + stage 12 trace).
      traces: eq.traces,
      series: eq.series,
      snapsMem: snapsMem,
      snapsS: snapsS,
      initialMembership: initialMembership,
      finalMembership: flat.blockMembership(),
      S0: S0_level0,
      Sfinal: flat.entropy(),
      Bfinal: flat.nonEmptyBlocks().length,
      // Nested chain (drives stage 11 per-level trace + stage 13 nested Σ).
      nested: nested,
      Snested: nested.entropy(),
      perLevelSeries: perLevelSeries,
      nLevels: nested.nLevels,
      level1Walker: level1Walker,
    };
  }

  function buildRuns() {
    const init = buildSharedInit(seed);
    state = {
      sharedInit: init,
      runs: VARIANTS.map(function (v) { return runVariantFull(v, init); }),
    };
    state.dc = state.runs[0];
    state.ndc = state.runs[1];
  }

  // ── Stage 0 input + reroll ──────────────────────────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  function setText(id, t, asHTML) {
    const el = document.getElementById(id);
    if (!el) return;
    if (asHTML) el.innerHTML = t; else el.textContent = t;
  }

  // ── d3 mini-helpers ─────────────────────────────────────────────
  function clearHost(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
    return el;
  }
  function mkSVG(host, vbW, vbH) {
    return d3.select(host).append("svg")
      .attr("class", "viz-svg")
      .attr("viewBox", "0 0 " + vbW + " " + vbH)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%").style("height", "100%").style("display", "block");
  }
  function partitionColor(c) {
    return P.partitionColor ? P.partitionColor(c) : "#888";
  }

  // ── Stage 1 · resolution-limit curves ───────────────────────────
  function mountResLim() {
    const host = clearHost("g-reslim-cy");
    if (!host) return;
    const W = 720, H = 220, ML = 56, MR = 96, MT = 18, MB = 36;
    const svg = mkSVG(host, W, H);
    // log-log: N from 10 to 1e6.
    const xs = [];
    for (let lN = 1; lN <= 6; lN += 0.1) xs.push(Math.pow(10, lN));
    const flat = xs.map(function (n) { return Math.sqrt(n); });
    const nested = xs.map(function (n) { return n / Math.log(n); });
    const yMin = 1, yMax = 1e6;
    const xMin = xs[0], xMax = xs[xs.length - 1];
    const xScale = d3.scaleLog().domain([xMin, xMax]).range([ML, W - MR]);
    const yScale = d3.scaleLog().domain([yMin, yMax]).range([H - MB, MT]);
    const xAx = d3.axisBottom(xScale).ticks(6, ".0e");
    const yAx = d3.axisLeft(yScale).ticks(6, ".0e");
    svg.append("g").attr("class", "viz-axis")
      .attr("transform", "translate(0," + (H - MB) + ")").call(xAx);
    svg.append("g").attr("class", "viz-axis")
      .attr("transform", "translate(" + ML + ",0)").call(yAx);
    function plot(arr, color, label) {
      const gen = d3.line()
        .x(function (_, i) { return xScale(xs[i]); })
        .y(function (v) { return yScale(v); });
      svg.append("path").datum(arr).attr("d", gen)
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
      const lastX = xs[xs.length - 1], lastY = arr[arr.length - 1];
      svg.append("text").attr("x", xScale(lastX) + 6).attr("y", yScale(lastY))
        .attr("fill", color).style("font-size", "11px")
        .style("font-family", "'Special Elite', monospace")
        .text(label);
    }
    plot(flat,   "#7b9bd6", "flat √N");
    plot(nested, "#e0a649", "nested N/log N");
    // Mark fixture N = 32.
    svg.append("line")
      .attr("x1", xScale(32)).attr("x2", xScale(32))
      .attr("y1", MT).attr("y2", H - MB)
      .attr("stroke", "#c98a8a").attr("stroke-width", 1).attr("stroke-dasharray", "3 3");
    svg.append("text").attr("x", xScale(32) + 4).attr("y", MT + 12)
      .attr("fill", "#c98a8a").style("font-size", "10px")
      .style("font-family", "'Special Elite', monospace")
      .text("N = 32 (fixture)");
  }

  // ── Stage 2 · level-stack triptych ──────────────────────────────
  function drawAbstractGraph(hostId, graph, membership, opts) {
    opts = opts || {};
    const host = clearHost(hostId);
    if (!host || !graph) return;
    const N = graph.vcount();
    const W = 280, H = 200;
    const svg = mkSVG(host, W, H);
    // Circular layout for the abstract block-multigraph stages.
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.36;
    const pts = [];
    for (let v = 0; v < N; v++) {
      const a = (2 * Math.PI * v) / Math.max(1, N) - Math.PI / 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    // Edges (weight encoded in stroke width).
    const edges = [];
    for (let v = 0; v < N; v++) {
      const nb = graph.neighbours(v);
      const nbE = graph.neighbourEdges(v);
      for (let i = 0; i < nb.length; i++) {
        const u = nb[i];
        if (u <= v) continue;
        edges.push({ u: v, v: u, w: graph.edgeWeight(nbE[i]) });
      }
      const sw = graph.nodeSelfWeight(v);
      if (sw > 0) edges.push({ u: v, v: v, w: sw, self: true });
    }
    const maxW = edges.reduce(function (m, e) { return Math.max(m, e.w); }, 1);
    edges.forEach(function (e) {
      const t = (e.w / maxW) * 2.4 + 0.6;
      if (e.self) {
        const p = pts[e.u];
        svg.append("circle")
          .attr("cx", p.x).attr("cy", p.y - 9)
          .attr("r", 5).attr("fill", "none")
          .attr("stroke", "var(--paper-3)").attr("stroke-width", t);
      } else {
        svg.append("line")
          .attr("x1", pts[e.u].x).attr("y1", pts[e.u].y)
          .attr("x2", pts[e.v].x).attr("y2", pts[e.v].y)
          .attr("stroke", "var(--paper-3)").attr("stroke-width", t).attr("stroke-opacity", 0.7);
      }
    });
    pts.forEach(function (p, v) {
      svg.append("circle")
        .attr("cx", p.x).attr("cy", p.y).attr("r", opts.nodeR || 10)
        .attr("fill", membership ? partitionColor(membership[v]) : "#888")
        .attr("stroke", "var(--paper)").attr("stroke-width", 1.2);
      if (opts.labels !== false) {
        svg.append("text").attr("x", p.x).attr("y", p.y + 3)
          .attr("text-anchor", "middle")
          .style("font-size", "9px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper)").text(v);
      }
    });
  }
  function mountStack() {
    const dc = state.dc;
    // Level 0: render the fixture coloured by level-0 mode partition.
    P.renderFixture("g-stack-cy0", {
      membership: dc.finalMembership, pinned: true, nodeR: 7, showLabels: false,
    });
    setText("g-stack-cap0", "level 0 · N₀ = " + F.nodes.length
      + " · B = " + dc.Bfinal);
    // Level 1 + 2: pull from nested DC.
    const g1 = dc.nested.levelGraph(1);
    const m1 = dc.nested.levelMembership(1);
    drawAbstractGraph("g-stack-cy1", g1, m1, { nodeR: 11 });
    setText("g-stack-cap1", "level 1 · N₁ = " + g1.vcount()
      + " · B = " + dc.nested.level(1).nonEmptyBlocks().length);
    if (dc.nested.nLevels >= 3) {
      const g2 = dc.nested.levelGraph(2);
      const m2 = dc.nested.levelMembership(2);
      drawAbstractGraph("g-stack-cy2", g2, m2, { nodeR: 11 });
      setText("g-stack-cap2", "level 2 · N₂ = " + g2.vcount()
        + " · B = " + dc.nested.level(2).nonEmptyBlocks().length);
    } else {
      clearHost("g-stack-cy2");
      setText("g-stack-cap2", "level 2 · degenerate (Bne = 1)");
    }
  }

  // ── Stage 3 · per-level Σ bars ──────────────────────────────────
  function mountDLBars() {
    const host = clearHost("g-dl-cy");
    if (!host) return;
    const W = 720, H = 200, ML = 56, MR = 32, MT = 18, MB = 36;
    const svg = mkSVG(host, W, H);
    const runs = state.runs;
    const L = Math.max.apply(null, runs.map(function (r) { return r.nLevels; }));
    const groups = [];
    for (let l = 0; l < L; l++) {
      groups.push({
        label: "level " + l,
        vals: runs.map(function (r) {
          const lvl = r.nested.levelEntropy(l < r.nLevels ? l : 0);
          return l < r.nLevels ? lvl : 0;
        }),
      });
    }
    const gW = (W - ML - MR) / groups.length;
    const bW = gW / (runs.length + 1);
    const yMax = Math.max(0.1, d3.max(groups, function (g) { return d3.max(g.vals); }));
    const yScale = d3.scaleLinear().domain([0, yMax * 1.1]).range([H - MB, MT]);
    const yAx = d3.axisLeft(yScale).ticks(5);
    svg.append("g").attr("class", "viz-axis")
      .attr("transform", "translate(" + ML + ",0)").call(yAx);
    svg.append("text").attr("x", ML - 38).attr("y", MT + 4)
      .attr("fill", "var(--paper-3)").style("font-size", "10px")
      .style("font-family", "'Special Elite', monospace").text("Σₗ [nats]");
    groups.forEach(function (g, gi) {
      const gx = ML + gi * gW;
      g.vals.forEach(function (v, vi) {
        const x = gx + bW * 0.5 + vi * bW;
        const y = yScale(v);
        svg.append("rect").attr("x", x).attr("y", y).attr("width", bW * 0.8)
          .attr("height", H - MB - y).attr("fill", runs[vi].color)
          .attr("stroke", "var(--paper)").attr("stroke-width", 0.5);
        svg.append("text").attr("x", x + bW * 0.4).attr("y", y - 4)
          .attr("text-anchor", "middle").style("font-size", "9px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper-3)").text(v.toFixed(1));
      });
      svg.append("text").attr("x", gx + gW / 2).attr("y", H - MB + 14)
        .attr("text-anchor", "middle").style("font-size", "10px")
        .style("font-family", "'Special Elite', monospace")
        .style("fill", "var(--paper-3)").text(g.label);
    });
    // Legend.
    runs.forEach(function (r, i) {
      svg.append("rect").attr("x", W - MR - 86).attr("y", MT + i * 14)
        .attr("width", 12).attr("height", 8).attr("fill", r.color);
      svg.append("text").attr("x", W - MR - 70).attr("y", MT + i * 14 + 8)
        .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
        .style("fill", "var(--paper)").text(r.label);
    });
  }

  // ── Stage 4 · init level-0 partition ────────────────────────────
  function mountInit0() {
    P.renderFixture("g-init0-cy", {
      membership: state.sharedInit, pinned: true, nodeR: 11,
    });
    setText("g-init0-B0", String(INIT_B));
    setText("g-init0-S", state.dc.S0.toFixed(2));
  }

  // ── Stage 5 · round-robin click navigation ──────────────────────
  function mountRoundRobin() {
    const track = document.getElementById("g-rr-track");
    if (!track) return;
    track.querySelectorAll(".step").forEach(function (el) {
      el.style.cursor = "pointer";
      el.onclick = function () {
        const anchor = el.getAttribute("data-anchor");
        if (!anchor) return;
        const tgt = document.getElementById(anchor);
        if (tgt && tgt.scrollIntoView) tgt.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
  }

  // ── Stage 6 · level-0 MH walker ─────────────────────────────────
  let mhWalker = null;
  function mountMH0() {
    const dc = state.dc;
    function statusFor(idx, ev) {
      if (!ev) return "sweep 0 &middot; random init &middot; B<sub>0</sub> = " + INIT_B;
      const verb = ev.accepted ? "accepted" : "rejected";
      const dirn = ev.toS === ev.fromR
        ? " &middot; proposal = stay (no change)"
        : " &middot; propose " + ev.fromR + " &rarr; " + ev.toS
          + " &middot; ΔΣ₀ = " + ev.dS.toFixed(3) + " &middot; " + verb;
      return "sweep " + (ev.sweep + 1) + " &middot; visit " + ev.v + dirn;
    }
    function statsFor(idx) {
      let acc = 0, rej = 0;
      for (let k = 0; k < idx; k++) {
        const t = dc.traces[k];
        if (t.toS === t.fromR) continue;
        if (t.accepted) acc += 1; else rej += 1;
      }
      const total = acc + rej;
      const accRate = total > 0 ? (100 * acc / total).toFixed(0) : "·";
      return "accepted: " + acc + " &middot; rejected: " + rej
        + " &middot; rate: " + accRate + "% &middot; Σ₀ = " + dc.snapsS[idx].toFixed(2);
    }
    function candPanel(idx, ev) {
      if (!ev) return '<div class="step-desc">Sweep 0: random partition over B<sub>0</sub> = '
        + INIT_B + ' blocks. Step forward to see the first per-vertex MH proposal.</div>';
      return P.renderCandTable({
        rows: (ev.candidates || []).map(function (c) { return { s: c.s, _delta: c.dS }; }),
        headerText: 'candidates for vertex ' + ev.v + ' &middot; current block = ' + ev.fromR,
        entityHeader: 'cand block',
        metricHeader: 'ΔΣ₀',
        precision: 3,
        sort: 'asc',
        entityFor: function (r) { return r.s; },
        classFor: function (r) {
          if (r.s === ev.toS && ev.accepted) return 'cand-pick';
          if (r.s === ev.fromR) return 'cand-from';
          return '';
        },
        verdictFor: function (r) {
          if (r.s === ev.toS && ev.accepted) return 'picked + accepted';
          if (r.s === ev.toS) return 'picked, rejected';
          if (r.s === ev.fromR) return 'current';
          return '';
        },
      });
    }
    mhWalker = P.mountStepWalker({
      vizHostId: "g-mh0-cy",
      panelHostId: "g-mh0-panel",
      ctlPrefix: "g-mh0",
      events: dc.traces,
      snapshotAt: function (idx) { return dc.snapsMem[idx]; },
      sidePanelHTML: candPanel,
      onRender: function (idx, ev) {
        setText("g-mh0-status", statusFor(idx, ev), true);
        setText("g-mh0-stats",  statsFor(idx),    true);
      },
    });
  }

  // ── Stage 7 · level 0 → level 1 rebuild diorama ─────────────────
  function mountRebuild01() {
    const dc = state.dc;
    P.renderFixture("g-rebuild01-cy0", {
      membership: dc.finalMembership, pinned: true, nodeR: 7, showLabels: false,
    });
    const g1 = dc.nested.levelGraph(1);
    const m1 = dc.nested.levelMembership(1);
    drawAbstractGraph("g-rebuild01-cy1", g1, m1, { nodeR: 12 });
    let nE = 0, nSelf = 0;
    for (let v = 0; v < g1.vcount(); v++) {
      const nb = g1.neighbours(v);
      for (let i = 0; i < nb.length; i++) if (nb[i] > v) nE++;
      if (g1.nodeSelfWeight(v) > 0) nSelf++;
    }
    setText("g-rebuild01-stats",
      "Bne[0] = " + dc.Bfinal + " &rarr; N[1] = " + g1.vcount()
      + " &middot; level-1 edges: " + nE + " &middot; level-1 self-loops: " + nSelf, true);
  }

  // ── Stage 8 · level-1 MH walker (captured snapshot) ─────────────
  let mh1Walker = null;
  function mountMH1() {
    const dc = state.dc;
    const cap = dc.level1Walker;
    const hostId = "g-mh1-cy";
    const host = clearHost(hostId);
    if (!host) return;
    if (!cap || !cap.traces.length) {
      // No moves in the captured sweep (level-1 graph too small).
      setText("g-mh1-status", "level-1 sweep had no MH proposals (Bne[1] &le; 1)", true);
      setText("g-mh1-stats", "·", true);
      const ctl = document.getElementById("g-mh1-next");
      if (ctl) ctl.disabled = true;
      const ctl2 = document.getElementById("g-mh1-end"); if (ctl2) ctl2.disabled = true;
      const ctl3 = document.getElementById("g-mh1-prev"); if (ctl3) ctl3.disabled = true;
      const ctl4 = document.getElementById("g-mh1-reset"); if (ctl4) ctl4.disabled = true;
      setText("g-mh1-cur", "0"); setText("g-mh1-total", "0");
      return;
    }
    // Render the level-1 graph with the current snapshot membership.
    const N1 = cap.graph.vcount();
    const W = 560, H = 240;
    const svg = mkSVG(host, W, H);
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.35;
    const pts = [];
    for (let v = 0; v < N1; v++) {
      const a = (2 * Math.PI * v) / Math.max(1, N1) - Math.PI / 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    const edgesG = svg.append("g").attr("class", "edges");
    const nodesG = svg.append("g").attr("class", "nodes");
    const focusG = svg.append("g").attr("class", "focus");
    function drawEdges() {
      edgesG.selectAll("*").remove();
      for (let v = 0; v < N1; v++) {
        const nb = cap.graph.neighbours(v);
        const nbE = cap.graph.neighbourEdges(v);
        for (let i = 0; i < nb.length; i++) {
          const u = nb[i];
          if (u <= v) continue;
          const w = cap.graph.edgeWeight(nbE[i]);
          edgesG.append("line")
            .attr("x1", pts[v].x).attr("y1", pts[v].y)
            .attr("x2", pts[u].x).attr("y2", pts[u].y)
            .attr("stroke", "var(--paper-3)").attr("stroke-width", Math.min(4, w * 0.7 + 0.6))
            .attr("stroke-opacity", 0.7);
        }
        const sw = cap.graph.nodeSelfWeight(v);
        if (sw > 0) {
          edgesG.append("circle")
            .attr("cx", pts[v].x).attr("cy", pts[v].y - 11)
            .attr("r", 6).attr("fill", "none")
            .attr("stroke", "var(--paper-3)").attr("stroke-width", Math.min(3, sw * 0.5 + 0.6));
        }
      }
    }
    function render(idx, ev) {
      const mem = cap.snapsMem[idx];
      drawEdges();
      nodesG.selectAll("circle").remove();
      nodesG.selectAll("text").remove();
      pts.forEach(function (p, v) {
        nodesG.append("circle")
          .attr("cx", p.x).attr("cy", p.y).attr("r", 14)
          .attr("fill", partitionColor(mem[v]))
          .attr("stroke", "var(--paper)").attr("stroke-width", 1.3);
        nodesG.append("text").attr("x", p.x).attr("y", p.y + 4)
          .attr("text-anchor", "middle").style("font-size", "10px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper)").text(v);
      });
      focusG.selectAll("*").remove();
      if (ev && ev.v != null) {
        const p = pts[ev.v];
        focusG.append("circle")
          .attr("cx", p.x).attr("cy", p.y).attr("r", 19)
          .attr("fill", "none").attr("stroke", "var(--cobalt)")
          .attr("stroke-width", 2).attr("stroke-dasharray", "3 3");
      }
      const verb = ev ? (ev.accepted ? "accepted" : "rejected") : null;
      if (!ev) {
        setText("g-mh1-status", "level-1 visit 0 &middot; pre-sweep snapshot", true);
        setText("g-mh1-stats", "Bne[1] = " + cap.graph.vcount(), true);
      } else {
        const dirn = ev.toS === ev.fromR
          ? "stay (no change)"
          : ev.fromR + " &rarr; " + ev.toS + " &middot; ΔΣ₁ = " + ev.dS.toFixed(3) + " &middot; " + verb;
        setText("g-mh1-status", "level-1 visit " + (idx) + " &middot; vertex " + ev.v + " &middot; " + dirn, true);
        setText("g-mh1-stats", "moves: " + idx + " / " + cap.traces.length, true);
      }
    }
    mh1Walker = C.stepController({
      total: cap.traces.length + 1,
      prevBtn:  document.getElementById("g-mh1-prev"),
      nextBtn:  document.getElementById("g-mh1-next"),
      resetBtn: document.getElementById("g-mh1-reset"),
      endBtn:   document.getElementById("g-mh1-end"),
      labelCur: document.getElementById("g-mh1-cur"),
      labelTotal: document.getElementById("g-mh1-total"),
      onRender: function (idx) {
        const ev = idx === 0 ? null : cap.traces[idx - 1];
        render(idx, ev);
      },
      keyboard: false,
    });
  }

  // ── Stage 9 · level 1 → level 2 rebuild + sweep ─────────────────
  function mountRebuild12() {
    const dc = state.dc;
    const g1 = dc.nested.levelGraph(1);
    const m1 = dc.nested.levelMembership(1);
    drawAbstractGraph("g-rebuild12-cy1", g1, m1, { nodeR: 11 });
    if (dc.nested.nLevels >= 3) {
      const g2 = dc.nested.levelGraph(2);
      const m2 = dc.nested.levelMembership(2);
      drawAbstractGraph("g-rebuild12-cy2", g2, m2, { nodeR: 13 });
      setText("g-rebuild12-stats",
        "N[1] = " + g1.vcount() + " &middot; N[2] = " + g2.vcount()
        + " &middot; B[2] = " + dc.nested.level(2).nonEmptyBlocks().length, true);
    } else {
      clearHost("g-rebuild12-cy2");
      setText("g-rebuild12-stats",
        "N[1] = " + g1.vcount() + " &middot; level 2 degenerate (single block)", true);
    }
  }

  // ── Stage 10 · merge cascade diorama ────────────────────────────
  function mountPercolate() {
    const host = clearHost("g-perc-cy");
    if (!host) return;
    const W = 720, H = 260;
    const svg = mkSVG(host, W, H);
    // Two-panel diorama: before vs after merge. Show 4 level-0 blocks
    // and 3 level-1 super-vertices on left; on right show 3 level-0
    // blocks (block 3 absorbed into block 1) and 2 level-1 super-vertices.
    const beforeBlocks = [
      { id: 0, x: 90,  y: 70 }, { id: 1, x: 170, y: 70 },
      { id: 2, x: 90,  y: 170 }, { id: 3, x: 170, y: 170 },
    ];
    const beforeSup = [
      { id: 0, x: 290, y: 90, members: [0, 1] },
      { id: 1, x: 290, y: 180, members: [2, 3] },
    ];
    const afterBlocks = [
      { id: 0, x: 460, y: 70 }, { id: 1, x: 540, y: 70 },
      { id: 2, x: 500, y: 170 },
    ];
    const afterSup = [
      { id: 0, x: 660, y: 90, members: [0, 1] },
      { id: 1, x: 660, y: 180, members: [2] },
    ];
    function panel(blocks, sups, lbl0, lbl1, blockOffset) {
      blocks.forEach(function (b) {
        svg.append("circle").attr("cx", b.x).attr("cy", b.y).attr("r", 18)
          .attr("fill", partitionColor(b.id + (blockOffset || 0)))
          .attr("stroke", "var(--paper)").attr("stroke-width", 1.2);
        svg.append("text").attr("x", b.x).attr("y", b.y + 4)
          .attr("text-anchor", "middle").style("font-size", "11px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper)").text(b.id);
      });
      sups.forEach(function (s) {
        s.members.forEach(function (m) {
          const src = blocks[m];
          svg.append("line").attr("x1", src.x).attr("y1", src.y)
            .attr("x2", s.x).attr("y2", s.y)
            .attr("stroke", "var(--paper-3)").attr("stroke-opacity", 0.5)
            .attr("stroke-dasharray", "3 2");
        });
        svg.append("circle").attr("cx", s.x).attr("cy", s.y).attr("r", 22)
          .attr("fill", "rgba(123,155,214,0.18)").attr("stroke", "var(--cobalt)")
          .attr("stroke-width", 1.4);
        svg.append("text").attr("x", s.x).attr("y", s.y + 4)
          .attr("text-anchor", "middle").style("font-size", "10px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper)").text("S" + s.id);
      });
      svg.append("text").attr("x", (blocks[0].x + sups[sups.length-1].x) / 2)
        .attr("y", H - 14).attr("text-anchor", "middle")
        .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
        .style("fill", "var(--paper-3)").text(lbl0);
    }
    panel(beforeBlocks, beforeSup, "before · 4 level-0 blocks, 2 level-1 super-blocks");
    panel(afterBlocks,  afterSup,  "after · 3 level-0 blocks (block 3 emptied), level-1 graph shrinks");
    // Arrow between panels.
    const arrowY = H / 2;
    svg.append("line").attr("x1", 340).attr("y1", arrowY).attr("x2", 430).attr("y2", arrowY)
      .attr("stroke", "var(--paper)").attr("stroke-width", 1.4);
    svg.append("polygon").attr("points", "430," + arrowY + " 420," + (arrowY-5) + " 420," + (arrowY+5))
      .attr("fill", "var(--paper)");
    svg.append("text").attr("x", 385).attr("y", arrowY - 8).attr("text-anchor", "middle")
      .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper-3)").text("MH sweep + rebuild");
    setText("g-perc-b0a", "4");
    setText("g-perc-b0b", "3");
  }

  // ── Stage 11 · per-level Σ trace ────────────────────────────────
  function mountConv() {
    const host = clearHost("g-conv-cy");
    if (!host) return;
    const dc = state.dc;
    const W = 720, H = 240, ML = 56, MR = 96, MT = 18, MB = 36;
    const svg = mkSVG(host, W, H);
    const levels = dc.perLevelSeries;
    let yMin = Infinity, yMax = -Infinity, xMax = 0;
    levels.forEach(function (s) {
      s.samples.forEach(function (p) {
        if (p.S < yMin) yMin = p.S;
        if (p.S > yMax) yMax = p.S;
        if (p.sweep > xMax) xMax = p.sweep;
      });
    });
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMax - yMin < 1) yMax = yMin + 1;
    const xScale = d3.scaleLinear().domain([0, xMax]).range([ML, W - MR]);
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([H - MB, MT]);
    svg.append("g").attr("class", "viz-axis")
      .attr("transform", "translate(0," + (H - MB) + ")").call(d3.axisBottom(xScale).ticks(6));
    svg.append("g").attr("class", "viz-axis")
      .attr("transform", "translate(" + ML + ",0)").call(d3.axisLeft(yScale).ticks(5));
    const dashes = ["0", "5 3", "2 3"];
    const palette = ["#7b9bd6", "#e0a649", "#8fbb70", "#b07ac9"];
    levels.forEach(function (s, i) {
      const gen = d3.line()
        .x(function (p) { return xScale(p.sweep); })
        .y(function (p) { return yScale(p.S); });
      svg.append("path").datum(s.samples).attr("d", gen)
        .attr("fill", "none").attr("stroke", palette[i % palette.length])
        .attr("stroke-width", 1.8).attr("stroke-dasharray", dashes[i % dashes.length]);
      const last = s.samples[s.samples.length - 1];
      svg.append("text").attr("x", W - MR + 6).attr("y", yScale(last.S) + 3)
        .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
        .style("fill", palette[i % palette.length])
        .text("level " + s.l + " · " + last.S.toFixed(1));
    });
    svg.append("text").attr("x", ML - 40).attr("y", MT + 4)
      .attr("fill", "var(--paper-3)").style("font-size", "10px")
      .style("font-family", "'Special Elite', monospace").text("Σₗ [nats]");
    svg.append("text").attr("x", W - MR).attr("y", H - 6)
      .attr("text-anchor", "end").style("font-size", "10px")
      .style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper-3)").text("outer iteration");
  }

  // ── Stage 12 · DC vs NDC trace ──────────────────────────────────
  function mountEqTrace() {
    SBM.tracePlot({
      hostId: "g-eq-cy",
      traces: state.runs.map(function (r) {
        return { series: r.series, key: "S", label: r.label, color: r.color, axis: "left" };
      }),
      xMax: K_SWEEPS,
    });
  }

  // ── Stage 13 · final partitions + dendrogram + verdict table ────
  function verdictFor(r, all) {
    let bestEdge = Infinity;
    all.forEach(function (other) {
      if (other.id === r.id) return;
      const gap = r.Snested - other.Snested;
      if (gap < bestEdge) bestEdge = gap;
    });
    if (bestEdge >= -SBM_THRESHOLD) return "tied with neighbour (|ΔΣ| within " + SBM_THRESHOLD + " nats)";
    if (bestEdge >= -SBM_DECISIVE) return "below by " + (-bestEdge).toFixed(1) + " nats (suggestive)";
    return "below by " + (-bestEdge).toFixed(1) + " nats (decisive)";
  }
  function mountFinal() {
    state.runs.forEach(function (r) {
      P.renderFixture("g-final-" + r.id, {
        membership: r.finalMembership, pinned: true, nodeR: 8,
      });
      const cap = document.getElementById("g-cap-" + r.id);
      if (cap) {
        cap.innerHTML = r.label + " &middot; \\(\\Sigma_{\\text{nested}} = \\) "
          + r.Snested.toFixed(2) + " nats &middot; B = " + r.Bfinal;
      }
    });
    const tbody = document.querySelector("#g-cmp tbody");
    if (tbody) {
      tbody.innerHTML = state.runs.map(function (r) {
        return '<tr><td>' + r.label + '</td><td>'
          + r.S0.toFixed(2) + '</td><td>' + r.Snested.toFixed(2) + '</td><td>'
          + r.Bfinal + '</td><td>' + r.nLevels + '</td><td>' + verdictFor(r, state.runs) + '</td></tr>';
      }).join("");
    }
    mountDendrogram();
  }

  // Per-vertex dendrogram (one column per variant).
  function mountDendrogram() {
    const host = clearHost("g-dendro-cy");
    if (!host) return;
    const W = 720, H = 220;
    const svg = mkSVG(host, W, H);
    const runs = state.runs;
    const colW = W / runs.length;
    const N = F.nodes.length;
    runs.forEach(function (r, ri) {
      // Build per-leaf path: leaf -> level-0 block -> level-1 block -> ...
      const paths = [];
      for (let v = 0; v < N; v++) {
        const p = [v];
        let cur = v;
        for (let l = 0; l < r.nLevels; l++) {
          const mem = r.nested.levelMembership(l);
          cur = mem[cur];
          p.push(cur);
        }
        paths.push(p);
      }
      const depth = r.nLevels + 1;
      const x0 = ri * colW + 18, x1 = (ri + 1) * colW - 18;
      const layerY = [];
      for (let d = 0; d < depth; d++) {
        layerY.push(H - 30 - d * ((H - 60) / (depth - 1)));
      }
      const leafX = function (i) { return x0 + (x1 - x0) * (i / Math.max(1, N - 1)); };
      // Bottom row labels.
      svg.append("text").attr("x", (x0 + x1) / 2).attr("y", H - 6)
        .attr("text-anchor", "middle").style("font-size", "10px")
        .style("font-family", "'Special Elite', monospace")
        .style("fill", r.color).text(r.label + " hierarchy · leaf = input vertex");
      // Draw lines + dots layer by layer.
      // First compute, for each (layer, block id), the median leaf-x of
      // all leaves under it.
      const layerBlockX = [];
      for (let d = 0; d < depth; d++) {
        const groups = new Map();
        for (let i = 0; i < N; i++) {
          const b = paths[i][d];
          if (!groups.has(b)) groups.set(b, []);
          groups.get(b).push(i);
        }
        const m = new Map();
        groups.forEach(function (members, b) {
          let sum = 0;
          members.forEach(function (i) { sum += leafX(i); });
          m.set(b, sum / members.length);
        });
        layerBlockX.push(m);
      }
      // Draw vertical and horizontal connectors.
      for (let d = 0; d < depth - 1; d++) {
        const lx = layerBlockX[d], ux = layerBlockX[d + 1];
        // Group leaves at layer d by their parent block at layer d+1.
        const parentGroups = new Map();
        lx.forEach(function (_, b) {
          // Find the parent block at d+1 by looking up any leaf under
          // block b at layer d.
          let parent = null;
          for (let i = 0; i < N; i++) {
            if (paths[i][d] === b) { parent = paths[i][d + 1]; break; }
          }
          if (parent == null) return;
          if (!parentGroups.has(parent)) parentGroups.set(parent, []);
          parentGroups.get(parent).push(b);
        });
        parentGroups.forEach(function (children, parent) {
          const px = ux.get(parent), py = layerY[d + 1];
          children.forEach(function (b) {
            const cx = lx.get(b), cy = layerY[d];
            svg.append("path")
              .attr("d", "M" + cx + "," + cy + " V" + ((cy + py) / 2)
                + " H" + px + " V" + py)
              .attr("class", "dendro-line");
          });
        });
      }
      // Leaf dots.
      for (let i = 0; i < N; i++) {
        svg.append("circle").attr("cx", leafX(i)).attr("cy", layerY[0])
          .attr("r", 2.4).attr("class", "dendro-node")
          .attr("fill", partitionColor(F.gt[i]));
      }
      // Block dots at higher layers (size grows with members).
      for (let d = 1; d < depth; d++) {
        layerBlockX[d].forEach(function (cx, b) {
          let count = 0;
          for (let i = 0; i < N; i++) if (paths[i][d] === b) count++;
          svg.append("circle").attr("cx", cx).attr("cy", layerY[d])
            .attr("r", Math.min(7, 2 + Math.sqrt(count) * 0.7))
            .attr("class", "dendro-node")
            .attr("fill", r.color).attr("fill-opacity", 0.4 + Math.min(0.5, count / N));
        });
      }
      // Layer labels.
      for (let d = 0; d < depth; d++) {
        svg.append("text").attr("x", x0 - 8).attr("y", layerY[d] + 3)
          .attr("text-anchor", "end").style("font-size", "9px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper-3)")
          .text(d === 0 ? "leaf" : "level " + (d - 1));
      }
    });
  }

  // ── Stage 14 · resolution-limit lift bar comparison ─────────────
  function mountLimitBar() {
    const host = clearHost("g-limitbar-cy");
    if (!host) return;
    const W = 720, H = 200, ML = 56, MR = 32, MT = 18, MB = 36;
    const svg = mkSVG(host, W, H);
    const Ns = [32, 1000, 10000, 100000];
    const flat = Ns.map(function (n) { return Math.sqrt(n); });
    const nested = Ns.map(function (n) { return n / Math.log(n); });
    const planted = 4;
    const groups = Ns.length;
    const gW = (W - ML - MR) / groups;
    const bW = gW / 4;
    const yMax = Math.max.apply(null, nested) * 1.08;
    const yScale = d3.scaleLog().domain([1, yMax]).range([H - MB, MT]);
    svg.append("g").attr("class", "viz-axis")
      .attr("transform", "translate(" + ML + ",0)").call(d3.axisLeft(yScale).ticks(5, ".0e"));
    Ns.forEach(function (n, gi) {
      const gx = ML + gi * gW;
      [
        { v: flat[gi],   color: "#7b9bd6", off: 0.6, label: "flat" },
        { v: nested[gi], color: "#e0a649", off: 1.7, label: "nested" },
      ].forEach(function (b) {
        const x = gx + bW * b.off;
        const y = yScale(b.v);
        svg.append("rect").attr("x", x).attr("y", y).attr("width", bW)
          .attr("height", H - MB - y).attr("fill", b.color).attr("stroke", "var(--paper)").attr("stroke-width", 0.4);
        svg.append("text").attr("x", x + bW/2).attr("y", y - 3)
          .attr("text-anchor", "middle").style("font-size", "9px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper-3)").text(Math.round(b.v));
      });
      // Planted bar (only at N = 32; reference line in others).
      if (n === 32) {
        const x = gx + bW * 2.8;
        const y = yScale(planted);
        svg.append("rect").attr("x", x).attr("y", y).attr("width", bW * 0.7)
          .attr("height", H - MB - y).attr("fill", "#c98a8a").attr("stroke", "var(--paper)").attr("stroke-width", 0.4);
        svg.append("text").attr("x", x + bW * 0.35).attr("y", y - 3)
          .attr("text-anchor", "middle").style("font-size", "9px")
          .style("font-family", "'Special Elite', monospace")
          .style("fill", "var(--paper-3)").text("B*=4");
      }
      svg.append("text").attr("x", gx + gW / 2).attr("y", H - MB + 14)
        .attr("text-anchor", "middle").style("font-size", "10px")
        .style("font-family", "'Special Elite', monospace")
        .style("fill", "var(--paper-3)").text("N = " + n);
    });
    // Legend.
    svg.append("rect").attr("x", W - MR - 80).attr("y", MT).attr("width", 12).attr("height", 8).attr("fill", "#7b9bd6");
    svg.append("text").attr("x", W - MR - 64).attr("y", MT + 8)
      .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper)").text("flat");
    svg.append("rect").attr("x", W - MR - 80).attr("y", MT + 14).attr("width", 12).attr("height", 8).attr("fill", "#e0a649");
    svg.append("text").attr("x", W - MR - 64).attr("y", MT + 22)
      .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper)").text("nested");
  }

  // ── Stage 15 · three uses triptych ──────────────────────────────
  function mountUses() {
    const dc = state.dc;
    // Coarsen: just the level-1 graph coloured by level-1 block id.
    const g1 = dc.nested.levelGraph(1);
    const m1 = dc.nested.levelMembership(1);
    drawAbstractGraph("g-uses-coarse", g1, m1, { nodeR: 12 });
    // Drill down: pick the largest level-0 block under the largest
    // level-1 super-block, render the induced subgraph.
    drawDrillDown("g-uses-drill", dc);
    // Multi-scale: render fixture coloured by level-1 super-block id
    // (every level-0 vertex inherits its super-block colour).
    drawMultiScale("g-uses-multi", dc);
  }
  function drawDrillDown(hostId, dc) {
    const host = clearHost(hostId);
    if (!host) return;
    const W = 280, H = 160;
    const svg = mkSVG(host, W, H);
    // Find the largest level-0 block.
    const mem0 = dc.finalMembership;
    const counts = new Map();
    for (let v = 0; v < mem0.length; v++) {
      counts.set(mem0[v], (counts.get(mem0[v]) || 0) + 1);
    }
    let biggest = null, bigN = -1;
    counts.forEach(function (c, b) { if (c > bigN) { bigN = c; biggest = b; } });
    // Render the induced subgraph in a compact circular layout.
    const members = [];
    for (let v = 0; v < mem0.length; v++) if (mem0[v] === biggest) members.push(v);
    const N = members.length;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.35;
    const pts = members.map(function (_, i) {
      const a = (2 * Math.PI * i) / Math.max(1, N) - Math.PI / 2;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    const idxOfMember = new Map();
    members.forEach(function (v, i) { idxOfMember.set(v, i); });
    F.edges.forEach(function (e) {
      const aIdx = F.nodes.indexOf(e[0]);
      const bIdx = F.nodes.indexOf(e[1]);
      if (idxOfMember.has(aIdx) && idxOfMember.has(bIdx)) {
        const pa = pts[idxOfMember.get(aIdx)], pb = pts[idxOfMember.get(bIdx)];
        svg.append("line").attr("x1", pa.x).attr("y1", pa.y).attr("x2", pb.x).attr("y2", pb.y)
          .attr("stroke", "var(--paper-3)").attr("stroke-opacity", 0.6);
      }
    });
    pts.forEach(function (p, i) {
      svg.append("circle").attr("cx", p.x).attr("cy", p.y).attr("r", 7)
        .attr("fill", partitionColor(biggest)).attr("stroke", "var(--paper)").attr("stroke-width", 1);
    });
    svg.append("text").attr("x", W / 2).attr("y", H - 6).attr("text-anchor", "middle")
      .style("font-size", "9px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper-3)").text("level-0 block " + biggest + " · " + bigN + " vertices");
  }
  function drawMultiScale(hostId, dc) {
    const host = clearHost(hostId);
    if (!host) return;
    // Colour every level-0 vertex by its level-1 super-block id.
    const mem0 = dc.finalMembership;
    const mem1 = dc.nested.levelMembership(1);
    const projected = mem0.map(function (b0) { return mem1[b0] || 0; });
    P.renderFixture(hostId, { membership: projected, pinned: true, nodeR: 6, showLabels: false });
  }

  // ── Stage 16 · failure-mode diorama ─────────────────────────────
  function mountFail() {
    const host = clearHost("g-fail-cy");
    if (!host) return;
    const W = 720, H = 220;
    const svg = mkSVG(host, W, H);
    // Left panel: a flat-pp level-0 block partition shown as a 2x2 e-matrix collapsed to (Ein, Eout).
    svg.append("text").attr("x", 110).attr("y", 30).attr("text-anchor", "middle")
      .style("font-family", "'Fraunces', serif").style("fill", "var(--paper)")
      .text("level 0 (PP)");
    // Two-cell aggregated matrix.
    svg.append("rect").attr("x", 50).attr("y", 50).attr("width", 60).attr("height", 60)
      .attr("fill", "rgba(123,155,214,0.3)").attr("stroke", "var(--paper)");
    svg.append("text").attr("x", 80).attr("y", 84).attr("text-anchor", "middle")
      .style("font-size", "11px").style("fill", "var(--paper)")
      .style("font-family", "'Special Elite', monospace").text("E_in");
    svg.append("rect").attr("x", 110).attr("y", 50).attr("width", 60).attr("height", 60)
      .attr("fill", "rgba(224,166,73,0.3)").attr("stroke", "var(--paper)");
    svg.append("text").attr("x", 140).attr("y", 84).attr("text-anchor", "middle")
      .style("font-size", "11px").style("fill", "var(--paper)")
      .style("font-family", "'Special Elite', monospace").text("E_out");
    svg.append("text").attr("x", 110).attr("y", 130).attr("text-anchor", "middle")
      .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper-3)").text("two scalars · per-pair e_{rs} discarded");
    // Arrow.
    svg.append("line").attr("x1", 220).attr("y1", H/2).attr("x2", 320).attr("y2", H/2)
      .attr("stroke", "var(--paper)").attr("stroke-width", 1.4);
    svg.append("polygon").attr("points", "320," + (H/2) + " 310," + (H/2 - 5) + " 310," + (H/2 + 5))
      .attr("fill", "var(--paper)");
    svg.append("text").attr("x", 270).attr("y", H/2 - 8).attr("text-anchor", "middle")
      .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper-3)").text("rebuild?");
    // Right panel: red box.
    svg.append("rect").attr("x", 380).attr("y", 50).attr("width", 280).attr("height", 120)
      .attr("fill", "rgba(201,138,138,0.15)").attr("stroke", "#c98a8a")
      .attr("stroke-width", 1.6).attr("stroke-dasharray", "5 3");
    svg.append("text").attr("x", 520).attr("y", 85).attr("text-anchor", "middle")
      .style("font-family", "'Fraunces', serif").style("fill", "#c98a8a")
      .text("level 1 graph: undefined");
    svg.append("text").attr("x", 520).attr("y", 110).attr("text-anchor", "middle")
      .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper-3)").text("no per-pair e_{rs} to use as edge weights");
    svg.append("text").attr("x", 520).attr("y", 128).attr("text-anchor", "middle")
      .style("font-size", "10px").style("font-family", "'Special Elite', monospace")
      .style("fill", "var(--paper-3)").text("PP nested chain has no canonical form");
  }

  // ── Mount everything ────────────────────────────────────────────
  function remount() {
    mountResLim();
    mountStack();
    mountDLBars();
    mountInit0();
    mountRoundRobin();
    mountMH0();
    mountRebuild01();
    mountMH1();
    mountRebuild12();
    mountPercolate();
    mountConv();
    mountEqTrace();
    mountFinal();
    mountLimitBar();
    mountUses();
    mountFail();
  }

  buildRuns();
  remount();

  // ── Reroll ──────────────────────────────────────────────────────
  P.wireSeedReroll({
    prefix: "g",
    initialSeed: seed,
    onReroll: function (newSeed) {
      seed = newSeed;
      buildRuns();
      remount();
      if (C.retypeset) C.retypeset();
    },
  });

  if (C.retypeset) C.retypeset();
})();
