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

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "leiden-cpm" });
  }

  let gamma = 0.05;
  const seed = 42;
  let result = runKernel(gamma);

  function runKernel(g) {
    const G = P.buildLeidenGraph();
    return L.optimisePartition(G, L.CPM(g), seed, { recordTrace: true });
  }

  // Stage 1 + Stage 2: static input + singleton init.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });
  const singletonMem = F.nodes.map(function (_, i) { return i; });
  P.renderFixture("g-singleton-cy", { membership: singletonMem, pinned: true });

  // Stage 3: queue-init snapshot. Same singleton colouring as stage 2;
  // the framing differs (this is the queue's initial content, not the
  // partition's initial state). Page prose carries the contrast.
  P.renderFixture("g-qinit-cy", { membership: singletonMem, pinned: true });

  function tagEvents(traces) {
    return traces.map(function (t, i) { return Object.assign({ idx: i }, t); });
  }

  let moveEvents = tagEvents(result.levels[0].moveTraces);
  let refineEvents = tagEvents(result.levels[0].refineTraces);

  // Stage 4: live move-phase walker.
  const moveWalker = P.mountMoveWalker({
    vizHostId: "g-move-cy",
    panelHostId: "g-move-panel",
    ctlPrefix: "g-move",
    metric: "H",
    events: moveEvents,
    postMembership: Array.from(result.levels[0].finePostMove),
  });

  // Stage 9: live refinement walker.
  const refineWalker = P.mountRefineWalker({
    vizHostId: "g-refine-cy",
    ctlPrefix: "g-refine",
    events: refineEvents,
    preMembership: Array.from(result.levels[0].finePostMove),
    postMembership: Array.from(result.levels[0].finePostRefine),
  });

  function clearHost(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  }

  function rebuildSnapshots() {
    const postMove = Array.from(result.levels[0].finePostMove);
    const postRefine = Array.from(result.levels[0].finePostRefine);

    // Stage 5: re-queue worked example snapshot. Show post-move partition
    // (the eventual state that re-queue dynamics produces inside A's K_5).
    clearHost("g-restab-cy");
    P.renderFixture("g-restab-cy", { membership: postMove, pinned: true });

    // Stage 6: post-move snapshot.
    clearHost("g-postmove-cy");
    P.renderFixture("g-postmove-cy", { membership: postMove, pinned: true });
    setText("g-postmove-k", new Set(postMove).size);
    // ΔH cumulative at end of move phase + H_0=0:
    setText("g-postmove-H", (+result.levels[0].moveImprov).toFixed(3));

    // Stage 7: refinement-init snapshot. Each node coloured by its
    // move-phase community label (the constraint), even though refinement
    // restarts each as a singleton inside that boundary.
    clearHost("g-refine-init-cy");
    P.renderFixture("g-refine-init-cy", { membership: postMove, pinned: true });

    // Stage 10: post-refine snapshot.
    clearHost("g-postrefine-cy");
    P.renderFixture("g-postrefine-cy", { membership: postRefine, pinned: true });
    setText("g-postrefine-k", new Set(postRefine).size);

    // Stage 12: level-1 super-graph schematic.
    renderSuperGraph(postRefine);
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  function renderSuperGraph(postRefine) {
    const host = document.getElementById("g-l1-cy");
    if (!host || typeof d3 === "undefined") return;
    host.innerHTML = "";
    // One super-node per distinct community id in postRefine.
    // Compute super-edge weights between super-communities.
    const idxById = {};
    F.nodes.forEach(function (id, i) { idxById[id] = i; });
    const comms = Array.from(new Set(postRefine));
    const commIdx = {};
    comms.forEach(function (c, i) { commIdx[c] = i; });
    const K = comms.length;
    const W = {};       // inter-edge weight, key = "i,j" with i<j
    const Wself = new Array(K).fill(0); // intra-edge weight
    F.edges.forEach(function (e) {
      const ci = postRefine[idxById[e[0]]];
      const cj = postRefine[idxById[e[1]]];
      const a = commIdx[ci], b = commIdx[cj];
      if (a === b) { Wself[a] += 1; return; }
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const k = lo + "," + hi;
      W[k] = (W[k] || 0) + 1;
    });
    // Circular layout for super-nodes.
    const cx = 200, cy = 180, R = 130;
    const POS = comms.map(function (_, i) {
      const t = (i / K) * 2 * Math.PI - Math.PI / 2;
      return { x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) };
    });
    const vbW = 400, vbH = 360;
    const svg = d3.select(host).append("svg")
      .attr("class", "viz-svg")
      .attr("viewBox", "0 0 " + vbW + " " + vbH)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%").style("height", "100%")
      .style("display", "block");
    const gE = svg.append("g");
    const gN = svg.append("g");
    Object.keys(W).forEach(function (k) {
      const parts = k.split(","), i = +parts[0], j = +parts[1], w = W[k];
      gE.append("line")
        .attr("x1", POS[i].x).attr("y1", POS[i].y)
        .attr("x2", POS[j].x).attr("y2", POS[j].y)
        .attr("stroke", "#3a3f4a")
        .attr("stroke-width", Math.min(8, 1 + w * 0.6))
        .attr("opacity", 0.7);
    });
    // Super-nodes (radius scales with intra-weight + 1 for visibility).
    POS.forEach(function (p, i) {
      const r = 14 + Math.min(18, Math.sqrt(Wself[i]) * 3);
      gN.append("circle")
        .attr("cx", p.x).attr("cy", p.y).attr("r", r)
        .attr("fill", (function () {
          // Reuse partitionColor by querying via a temporary; just hash.
          const palette = ["#5fa0b3","#c9a14a","#7fa15b","#a37ab8","#c97c7c","#7b9bd6","#b89a6a","#6b9c8d"];
          return palette[i % palette.length];
        })())
        .attr("stroke", "#1b2033").attr("stroke-width", 1.5);
      gN.append("text")
        .attr("x", p.x).attr("y", p.y)
        .attr("text-anchor", "middle").attr("dominant-baseline", "central")
        .attr("font-family", "Special Elite, Courier New, monospace")
        .attr("font-size", 11).attr("fill", "#1b2033")
        .attr("pointer-events", "none")
        .text(String(comms[i]));
    });
    setText("g-l1-k", K);
    setText("g-l1-e", Object.keys(W).length);
  }

  rebuildSnapshots();

  function rebuildAggregation() {
    const host = document.getElementById("g-agg-cy");
    if (host) host.innerHTML = "";
    P.mountAggregation({
      vizHostId: "g-agg-cy",
      fineMembership: Array.from(result.levels[0].finePostRefine),
      capEl: document.getElementById("g-agg-cap"),
      playBtn: document.getElementById("g-agg-play"),
      resetBtn: document.getElementById("g-agg-reset"),
    });
  }
  rebuildAggregation();

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

  // γ slider: replays the full kernel run at a different resolution.
  const gIn = document.getElementById("g-move-gamma");
  const gOut = document.getElementById("g-move-gamma-out");
  if (gIn && gOut) {
    C.scrubSlider({
      input: gIn, output: gOut,
      format: function (v) { return Math.pow(10, +v).toPrecision(2); },
      onChange: function (v) {
        gamma = Math.pow(10, +v);
        result = runKernel(gamma);
        moveEvents = tagEvents(result.levels[0].moveTraces);
        moveWalker.controller.reconfigure(moveEvents.length + 1);
        moveWalker.controller.set(0);
        refineEvents = tagEvents(result.levels[0].refineTraces);
        refineWalker.controller.reconfigure(refineEvents.length + 1);
        refineWalker.controller.set(0);
        rebuildSnapshots();
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
