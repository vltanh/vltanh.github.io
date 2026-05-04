// Shared hero force-directed viz used by per-algorithm UC pages.
// Reads COMDET.FIXTURE; renders the 32-node fixture with cluster colours
// + drag perturbation. No tooltip on UC pages (kept lean); landing's
// inline tooltip script is the full version.
(function () {
  if (!window.COMDET || !window.COMDET.FIXTURE) return;
  if (!document.getElementById("shared-graph-svg")) return;
  const FIX = COMDET.FIXTURE;
  const COL = {
    0: "#7b9bd6", 1: "#e0a649", 2: "#8fbb70", 3: "#b07ac9",
    OUT: "#e07c6a",
  };
  const CLUSTER_OF = {};
  FIX.nodes.forEach((id, i) => {
    const c = FIX.gt[i];
    CLUSTER_OF[id] = c >= 0 ? c : "OUT";
  });

  const POS = {};
  FIX.positions.forEach(p => { POS[p.id] = { x: p.x, y: p.y }; });
  const xs = FIX.positions.map(p => p.x);
  const ys = FIX.positions.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 30;
  const vbW = (maxX - minX) + pad * 2;
  const vbH = (maxY - minY) + pad * 2;
  const offX = pad - minX;
  const offY = pad - minY;

  const svg = d3.select("#shared-graph-svg")
    .attr("viewBox", `0 0 ${vbW} ${vbH}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const simNodes = FIX.nodes.map(id => {
    const p = POS[id];
    return {
      id,
      x: p.x + offX, y: p.y + offY,
      homeX: p.x + offX, homeY: p.y + offY,
      cluster: CLUSTER_OF[id],
    };
  });
  const idx = {};
  simNodes.forEach(n => { idx[n.id] = n; });

  function edgeColor(u, v) {
    const cu = CLUSTER_OF[u], cv = CLUSTER_OF[v];
    if (cu === "OUT" && cv === "OUT") return "#c92a2a";
    if (cu === "OUT" || cv === "OUT") return "#7e468f";
    if (cu === cv) {
      return ({ 0: "#3559a0", 1: "#b4741d", 2: "#4e7a3a", 3: "#7e468f" })[cu];
    }
    return "#3a3f4a";
  }
  const simLinks = FIX.edges.map(([u, v]) => ({
    source: idx[u], target: idx[v], color: edgeColor(u, v),
  }));

  const link = svg.append("g").selectAll("line").data(simLinks).join("line")
    .attr("stroke", d => d.color).attr("stroke-width", 1.5)
    .attr("stroke-linecap", "round").attr("opacity", 0.82);

  const node = svg.append("g").selectAll("circle").data(simNodes).join("circle")
    .attr("r", 11).attr("fill", d => COL[d.cluster] || COL.OUT)
    .attr("stroke", "#1b2033").attr("stroke-width", 1.5)
    .style("cursor", "grab");

  const label = svg.append("g").selectAll("text").data(simNodes).join("text")
    .attr("text-anchor", "middle").attr("dominant-baseline", "central")
    .attr("font-family", "Special Elite, Courier New, monospace")
    .attr("font-size", 9).attr("fill", "#1b2033")
    .attr("pointer-events", "none").text(d => d.id);

  const sim = d3.forceSimulation(simNodes)
    .force("link", d3.forceLink(simLinks).distance(45).strength(0.18))
    .force("charge", d3.forceManyBody().strength(-55))
    .force("collide", d3.forceCollide(14))
    .force("x", d3.forceX(d => d.homeX).strength(0.20))
    .force("y", d3.forceY(d => d.homeY).strength(0.20))
    .alpha(0.45).alphaDecay(0.035);

  sim.on("tick", () => {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("cx", d => d.x).attr("cy", d => d.y);
    label.attr("x", d => d.x).attr("y", d => d.y);
  });

  node.call(d3.drag()
    .on("start", function (e, d) {
      if (!e.active) sim.alphaTarget(0.35).restart();
      d.fx = d.x; d.fy = d.y;
      d3.select(this).style("cursor", "grabbing");
    })
    .on("drag", function (e, d) { d.fx = e.x; d.fy = e.y; })
    .on("end", function (e, d) {
      if (!e.active) sim.alphaTarget(0);
      d.fx = null; d.fy = null;
      d3.select(this).style("cursor", "grab");
    }));
})();
