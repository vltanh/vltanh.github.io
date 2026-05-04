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

  // Stage 0 + Stage 1: static input + singleton init.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });
  P.renderFixture("g-singleton-cy", {
    membership: F.nodes.map(function (_, i) { return i; }),
    pinned: true,
  });

  function tagEvents(traces) {
    return traces.map(function (t, i) { return Object.assign({ idx: i }, t); });
  }

  let moveEvents = tagEvents(result.levels[0].moveTraces);
  let refineEvents = tagEvents(result.levels[0].refineTraces);

  const moveWalker = P.mountMoveWalker({
    vizHostId: "g-move-cy",
    panelHostId: "g-move-panel",
    ctlPrefix: "g-move",
    metric: "H",
    events: moveEvents,
    postMembership: Array.from(result.levels[0].finePostMove),
  });

  const refineWalker = P.mountRefineWalker({
    vizHostId: "g-refine-cy",
    ctlPrefix: "g-refine",
    events: refineEvents,
    preMembership: Array.from(result.levels[0].finePostMove),
    postMembership: Array.from(result.levels[0].finePostRefine),
  });

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

  // ── Paper Fig 2: disconnected-community demo ────────────────────
  mountFig2();

  function mountFig2() {
    const host = document.getElementById("g-fig2-cy");
    const rightLabel = document.getElementById("g-fig2-right");
    if (!host || typeof d3 === "undefined") return;
    host.innerHTML = "";
    // Geometry: 7 nodes (0..6), 0 in centre, 1-3 left fan, 4-6 right fan,
    // a "rest of network" cluster below 0 with 5 dim nodes.
    // Coordinates picked to match the paper's Fig 2 layout.
    const NODES = [
      { id: 0, x: 200, y: 130, label: "0" },
      { id: 1, x: 110, y:  90, label: "1" },
      { id: 2, x:  85, y: 140, label: "2" },
      { id: 3, x: 110, y: 190, label: "3" },
      { id: 4, x: 290, y:  90, label: "4" },
      { id: 5, x: 315, y: 140, label: "5" },
      { id: 6, x: 290, y: 190, label: "6" },
      // "rest of network" — dim nodes below; 0 connects to several.
      { id: 100, x: 130, y: 290, label: "", dim: true },
      { id: 101, x: 175, y: 320, label: "", dim: true },
      { id: 102, x: 220, y: 330, label: "", dim: true },
      { id: 103, x: 265, y: 320, label: "", dim: true },
      { id: 104, x: 305, y: 290, label: "", dim: true },
    ];
    // Edges within the red community + node 0's bridges to the rest.
    const EDGES = [
      // strong inter-side connections via node 0
      { u: 0, v: 1, kind: "thick" },
      { u: 0, v: 2, kind: "thick" },
      { u: 0, v: 3, kind: "thick" },
      { u: 0, v: 4, kind: "thick" },
      { u: 0, v: 5, kind: "thick" },
      { u: 0, v: 6, kind: "thick" },
      // weak left-side internal
      { u: 1, v: 2, kind: "thin" },
      { u: 2, v: 3, kind: "thin" },
      // weak right-side internal
      { u: 4, v: 5, kind: "thin" },
      { u: 5, v: 6, kind: "thin" },
      // node 0 to rest of network
      { u: 0, v: 100, kind: "ext" },
      { u: 0, v: 101, kind: "ext" },
      { u: 0, v: 102, kind: "ext" },
      { u: 0, v: 103, kind: "ext" },
      { u: 0, v: 104, kind: "ext" },
      // rest of network internal
      { u: 100, v: 101, kind: "rest" },
      { u: 101, v: 102, kind: "rest" },
      { u: 102, v: 103, kind: "rest" },
      { u: 103, v: 104, kind: "rest" },
    ];

    const vbW = 400, vbH = 380;
    const svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + vbW + " " + vbH)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%").style("height", "auto").style("display", "block");

    // Group hulls (red community + rest community + a "node 0 destination" cluster)
    const hullG = svg.append("g").attr("class", "hulls");
    const linkG = svg.append("g").attr("class", "links");
    const nodeG = svg.append("g").attr("class", "nodes");

    function strokeFor(e, state) {
      if (e.kind === "thick") return "#1b2033";
      if (e.kind === "thin")  return "#1b2033";
      if (e.kind === "ext")   return state === "before" ? "#9a947a" : "#1b2033";
      if (e.kind === "rest")  return "#9a947a";
      return "#9a947a";
    }
    function widthFor(e) {
      if (e.kind === "thick") return 3;
      if (e.kind === "thin")  return 1.4;
      return 1;
    }
    function dashFor(e, state) {
      if (e.kind === "ext")  return state === "before" ? "3 3" : "0";
      if (e.kind === "rest") return "3 3";
      return "0";
    }
    function nodeFill(id, state) {
      if (id >= 100) return "#d6cfb5";
      if (state === "before") return "#c97c7c";
      // After node-0-moves: 0 turns blue, rest stay red.
      return id === 0 ? "#7b9bd6" : "#c97c7c";
    }
    function hullsFor(state) {
      // Red community = nodes 1-6 always; node 0 is in red before, blue after.
      // Blue community appears only in 'after' state; we draw it as a circle
      // around the rest-of-network cluster + node 0.
      const out = [];
      // Red hull
      const redIds = state === "before" ? [0,1,2,3,4,5,6] : [1,2,3,4,5,6];
      out.push({ ids: redIds, fill: "rgba(201,124,124,0.18)", stroke: "rgba(201,124,124,0.55)" });
      if (state === "after") {
        // Blue hull: node 0 + rest-of-network
        const blueIds = [0, 100, 101, 102, 103, 104];
        out.push({ ids: blueIds, fill: "rgba(123,155,214,0.18)", stroke: "rgba(123,155,214,0.55)" });
      }
      return out;
    }
    function hullPath(ids) {
      // Convex hull via d3.polygonHull; pad outward.
      const pts = ids.map(function (id) {
        const n = NODES.find(function (x) { return x.id === id; });
        return [n.x, n.y];
      });
      if (pts.length < 3) {
        // single edge or vertex → make a circle
        const c = pts.reduce(function (a, p) { return [a[0]+p[0], a[1]+p[1]]; }, [0,0]);
        c[0] /= pts.length; c[1] /= pts.length;
        const r = 36;
        return "M" + (c[0]+r) + "," + c[1]
             + " A" + r + "," + r + " 0 1 0 " + (c[0]-r) + "," + c[1]
             + " A" + r + "," + r + " 0 1 0 " + (c[0]+r) + "," + c[1] + " Z";
      }
      const hull = d3.polygonHull(pts);
      const cx = d3.mean(hull, function (p) { return p[0]; });
      const cy = d3.mean(hull, function (p) { return p[1]; });
      // Inflate outward by ~22 units.
      const padded = hull.map(function (p) {
        const dx = p[0] - cx, dy = p[1] - cy;
        const len = Math.hypot(dx, dy);
        const k = (len + 22) / Math.max(len, 1);
        return [cx + dx * k, cy + dy * k];
      });
      return d3.line().curve(d3.curveCardinalClosed.tension(0.6))(padded);
    }
    function render(state) {
      // Hulls
      const hulls = hullsFor(state);
      const hSel = hullG.selectAll("path").data(hulls);
      hSel.exit().remove();
      hSel.enter().append("path").merge(hSel)
        .transition().duration(450)
        .attr("d", function (h) { return hullPath(h.ids); })
        .attr("fill", function (h) { return h.fill; })
        .attr("stroke", function (h) { return h.stroke; })
        .attr("stroke-width", 1.5);
      // Links
      const lSel = linkG.selectAll("line").data(EDGES);
      lSel.enter().append("line").merge(lSel)
        .attr("x1", function (e) { return NODES.find(function (n) { return n.id === e.u; }).x; })
        .attr("y1", function (e) { return NODES.find(function (n) { return n.id === e.u; }).y; })
        .attr("x2", function (e) { return NODES.find(function (n) { return n.id === e.v; }).x; })
        .attr("y2", function (e) { return NODES.find(function (n) { return n.id === e.v; }).y; })
        .transition().duration(350)
        .attr("stroke", function (e) { return strokeFor(e, state); })
        .attr("stroke-width", widthFor)
        .attr("stroke-dasharray", function (e) { return dashFor(e, state); })
        .attr("opacity", 0.9);
      // Nodes
      const nSel = nodeG.selectAll("circle").data(NODES);
      nSel.enter().append("circle").merge(nSel)
        .attr("cx", function (n) { return n.x; })
        .attr("cy", function (n) { return n.y; })
        .attr("r", function (n) { return n.dim ? 6 : 11; })
        .attr("stroke", "#1b2033").attr("stroke-width", 1.5)
        .transition().duration(400)
        .attr("fill", function (n) { return nodeFill(n.id, state); });
      const tSel = nodeG.selectAll("text").data(NODES.filter(function (n) { return n.label; }));
      tSel.enter().append("text").merge(tSel)
        .attr("x", function (n) { return n.x; })
        .attr("y", function (n) { return n.y; })
        .attr("text-anchor", "middle").attr("dominant-baseline", "central")
        .attr("font-family", "Special Elite, Courier New, monospace")
        .attr("font-size", 9).attr("fill", "#1b2033")
        .attr("pointer-events", "none")
        .text(function (n) { return n.label; });
      // Right label
      if (rightLabel) {
        rightLabel.textContent = state === "before"
          ? "after · node 0 moved · the red community is now two pieces"
          : "node 0 left · 1-3 and 4-6 no longer reach each other inside red";
      }
    }
    let state = "before";
    render(state);
    document.getElementById("g-fig2-play").addEventListener("click", function () {
      state = "after"; render(state);
    });
    document.getElementById("g-fig2-reset").addEventListener("click", function () {
      state = "before"; render(state);
    });
  }

  if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
    MathJax.typesetPromise();
  }
})();
