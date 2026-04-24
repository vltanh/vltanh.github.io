/* ═══════════════════════════════════════════════════════════════
   netgen/shared.js : shared data, constants, and helper widgets
   for all 7 generator pages and the index.

   Exposes window.NETGEN with:
     - POSITIONS, NODES, EDGES, CLUSTER_OF, MINCUTS, DEGREES
     - COLORS (palette tokens)
     - CY.baseStyle() and CY.baseElements(opts)
     - makeTooltip(cy, container)
     - scrubSlider({input, output, onChange, format})
     - stepController({prev, next, reset, label, total, onRender})
     - toggle({input, onChange})
     - linksRow({gen, hasIndex}) → HTML string for top pill bar
   ═══════════════════════════════════════════════════════════════ */

(function (global) {

// ── Shared input graph ────────────────────────────────────────
// 20 nodes: C1 (8), C2 (6), C3 (4), outliers 19, 20.
// Positions: outliers at origin, three clusters orbit around.

const POSITIONS = {
  // C1 cluster (top, 8 nodes, spread ~120 radius)
  1:  {x:    0, y: -190},
  2:  {x:  -55, y: -200},
  3:  {x:   50, y: -170},
  4:  {x:  -20, y: -240},
  5:  {x:  -90, y: -215},
  6:  {x:   80, y: -220},
  7:  {x:   40, y: -285},
  8:  {x:  -65, y: -295},
  // C2 cluster (bottom-right, 6 nodes, spread ~100)
  9:  {x:  205, y:  120},
  10: {x:  255, y:  150},
  11: {x:  170, y:  155},
  12: {x:  245, y:   85},
  13: {x:  290, y:  180},
  14: {x:  165, y:   95},
  // C3 cluster (bottom-left, 4 nodes, spread ~80)
  15: {x: -205, y:  120},
  16: {x: -220, y:  155},
  17: {x: -165, y:  165},
  18: {x: -185, y:   85},
  // Outliers near origin
  19: {x:  -30, y:  -10},
  20: {x:   30, y:   10},
};

const C1 = [1,2,3,4,5,6,7,8];
const C2 = [9,10,11,12,13,14];
const C3 = [15,16,17,18];
const OUT = [19,20];

const CLUSTER_OF = {};
C1.forEach(n => CLUSTER_OF[n] = "C1");
C2.forEach(n => CLUSTER_OF[n] = "C2");
C3.forEach(n => CLUSTER_OF[n] = "C3");
OUT.forEach(n => CLUSTER_OF[n] = "OUT");

const NODES = Object.keys(POSITIONS).map(Number);

// Edges grouped by provenance in the input:
const INTRA = {
  // C1 is dense: K_5 on {1..5} plus a small tail {6,7,8} attached.
  // Hubs 1 and 5 will dominate the degree tail so dedup and match_degree
  // bite visibly on SBM-family visualizations.
  C1: [
    [1,2],[1,3],[1,4],[1,5],[1,6],
    [2,3],[2,4],[2,5],[2,6],
    [3,4],[3,5],[3,7],
    [4,5],[4,8],
    [5,8],
    [6,7],[6,8],
    [7,8],
  ],
  // C2 is K_4 on {9..12} plus a trailing pair {13, 14}. Node 13 hangs
  // off the K_4 by edges (9,13) and (12,13); node 14 by (10,14) and
  // (11,14). The induced subgraph has min cut = 2, achieved by
  // isolating either node 13 or node 14.
  C2: [
    [9,10],[9,11],[9,12],[9,13],
    [10,11],[10,12],[10,14],
    [11,12],[11,14],
    [12,13],
  ],
  // C3 is deliberately sparse so its mincut is k=1.
  C3: [[15,16],[15,17],[16,18]],
};
const INTER = [
  [1,9], [2,10], [3,11], [5,12],   // C1-C2
  [9,15], [11,16],                   // C2-C3
  [1,15], [4,17],                    // C1-C3
];
const OUT_EDGES = [[19,1],[19,9],[20,5],[20,16],[19,20]];
// Total: 18 + 11 + 3 + 8 + 5 = 45 edges. Degrees: node 1 = 8 (biggest hub),
// nodes 5, 9 = 7; nodes 2, 3, 4, 11 = 6. Long tail of low-degree nodes.
// Dense C1 gives the SBM pages visible dedup loss, and match_degree has
// several residual stubs to fill.

// Flat input edge list with kind tags.
const EDGES = [
  ...INTRA.C1.map(([u,v])=>({u,v,kind:"intra-C1"})),
  ...INTRA.C2.map(([u,v])=>({u,v,kind:"intra-C2"})),
  ...INTRA.C3.map(([u,v])=>({u,v,kind:"intra-C3"})),
  ...INTER.map(([u,v])=>({u,v,kind:"inter"})),
  ...OUT_EDGES.map(([u,v])=>({u,v,kind:"outlier"})),
];

const DEGREES = {};
NODES.forEach(n => DEGREES[n] = 0);
EDGES.forEach(({u,v}) => { DEGREES[u]++; DEGREES[v]++; });

// Post-exclusion degrees: count only intra + inter edges (drop every
// outlier-incident edge). EC-SBM v1 + v2 both force outlier_mode=excluded
// at profile time, so their `degree.csv` + the phase-1 `topK` use these
// counts, not the full DEGREES above.
const DEGREES_EXCL = {};
NODES.forEach(n => DEGREES_EXCL[n] = 0);
EDGES.forEach(({u,v}) => {
  if (CLUSTER_OF[u] === "OUT" || CLUSTER_OF[v] === "OUT") return;
  DEGREES_EXCL[u]++; DEGREES_EXCL[v]++;
});

const MINCUTS = { C1: 3, C2: 2, C3: 1 };

// A concrete minimum edge cut set per cluster. Each one achieves the
// cluster's MINCUTS[c] by isolating the lowest-degree node inside the
// cluster. Useful for "best edge cut set" visualizations.
//   - C1 (k=3): isolate node 7 (intra-deg 3) via {(3,7),(6,7),(7,8)}
//   - C2 (k=2): isolate node 13 (intra-deg 2) via {(9,13),(12,13)}
//   - C3 (k=1): isolate node 18 (intra-deg 1) via {(16,18)}
// Each edge set is listed with lo-id first.
const MIN_CUT_EDGES = {
  C1: [[3,7],[6,7],[7,8]],
  C2: [[9,13],[12,13]],
  C3: [[16,18]],
};
// Node that gets isolated by the corresponding MIN_CUT_EDGES set.
const MIN_CUT_ISOLATE = { C1: 7, C2: 13, C3: 18 };

// Top-(k+1) nodes per cluster by degree desc, id asc tiebreak. Takes
// the degree map as an argument so EC-SBM pages (post-exclusion) and
// SBM / landing (full degrees) agree without forking.
function topK(cluster_nodes, k, degMap) {
  const d = degMap || DEGREES;
  return cluster_nodes
    .map(n => ({n, d: d[n]}))
    .sort((a,b) => (b.d - a.d) || (a.n - b.n))
    .slice(0, k+1)
    .map(o => o.n);
}
// Use POST-EXCLUSION degrees: v1 + v2 both profile under excluded mode,
// so their top-(k+1) core ranks match what gen_kec_core would produce
// on a real run.
const CORE_NODES = {
  C1: topK(C1, MINCUTS.C1, DEGREES_EXCL),  // 4 nodes
  C2: topK(C2, MINCUTS.C2, DEGREES_EXCL),  // 3 nodes
  C3: topK(C3, MINCUTS.C3, DEGREES_EXCL),  // 2 nodes
};

// K_{k+1} core edges (complete subgraph on CORE_NODES per cluster)
function cliqueEdges(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i+1; j < nodes.length; j++) {
      out.push([nodes[i], nodes[j]]);
    }
  }
  return out;
}
const CORE_EDGES = {
  C1: cliqueEdges(CORE_NODES.C1),   // 6 edges (K_4)
  C2: cliqueEdges(CORE_NODES.C2),   // 3 edges (K_3)
  C3: cliqueEdges(CORE_NODES.C3),   // 1 edge  (K_2)
};

// ── Color palette (canvas + doodle) ──────────────────────────
// Cluster fills are medium-value "colored-pencil" tones so dark
// pen-ink labels stay legible on top. Edge-stage tokens stay
// saturated-dark for contrast on cream paper.
const COLORS = {
  C1: "#7b9bd6", C2: "#e0a649", C3: "#8fbb70", OUT: "#e07c6a",
  edge_intra: {C1:"#3559a0", C2:"#b4741d", C3:"#4e7a3a"},
  edge_inter: "#3a3f4a",
  edge_stage2: "#567ad8",
  edge_stage3: "#7e468f",
  edge_stage4: "#6b6a54",
  edge_drop:   "#c92a2a",
  faint: "#9a947a",
  paper:"#1b2033", paper_2:"#2f3a54", paper_3:"#6b6a54", paper_4:"#9a947a",
  ink:"#f3ecd7", ink_2:"#ede4c9",
  azure:"#2a4aa8", azure_2:"#3d66c5", azure_3:"#567ad8",
  cobalt:"#1a3478", mint:"#4e7a3a", amber:"#c7801e", orchid:"#7e468f",
  signal:"#c92a2a",
  hl_yellow:"#f6e15a",
};

// ── VIZ: d3-force graph helper ───────────────────────────────
// Replaces the old Cytoscape-backed CY. Each stage graph mounts
// an <svg> inside its .graph-canvas container, runs a force sim
// anchored to preset POSITIONS so the layout "remembers" where
// each node lives while still allowing drag + reflow.
//
// Returned handle exposes a compact API. CSS classes `.dashed`,
// `.hi`, `.fade`, `.dim`, `.core`, `.newly`, `.thick` on the
// .viz-edge / .viz-node elements drive styling (see shared.css).
const VIZ = {
  init(containerId, opts = {}) {
    if (typeof d3 === "undefined") {
      console.warn("[netgen] d3 not loaded; VIZ.init cannot run");
      return null;
    }
    // Container setup. Caller may pass an existing d3 SVG selection
    // via opts.svg (useful when a stage page pre-renders decorations
    // into the svg and wants VIZ to append its layers on top).
    let host = null, svg = null;
    if (opts.svg) {
      svg = opts.svg;
      host = svg.node().parentElement;
    } else {
      host = document.getElementById(containerId);
      if (!host) return null;
      host.innerHTML = "";
      svg = d3.select(host).append("svg")
        .attr("class", "viz-svg")
        .attr("viewBox", "-320 -340 640 680")
        .attr("preserveAspectRatio", "xMidYMid meet");
    }
    const includeOutliers = opts.includeOutliers !== false;
    const posSrc = opts.positions || POSITIONS;
    const nodeR  = opts.nodeR != null ? opts.nodeR : 13;
    // pinned: node positions are authoritative (semantic, e.g., nPSO's
    // polar-encoded disk). We set fx/fy to homeX/homeY so the force
    // simulation cannot push nodes off their home. Drag temporarily
    // frees them; drag-end animates the snap back to home.
    const pinned = !!opts.pinned;

    const nodesData = NODES
      .filter(n => includeOutliers || CLUSTER_OF[n] !== "OUT")
      .filter(n => posSrc[n] != null)
      .map(id => {
        const hx = posSrc[id].x, hy = posSrc[id].y;
        return {
          id: String(id),
          cluster: CLUSTER_OF[id],
          color: opts.nodeColor ? opts.nodeColor(id) : COLORS[CLUSTER_OF[id]],
          r: nodeR,
          homeX: hx,
          homeY: hy,
          x: hx,
          y: hy,
          fx: pinned ? hx : null,
          fy: pinned ? hy : null,
          cls: "",
        };
      });
    const nodeById = {};
    nodesData.forEach(n => { nodeById[n.id] = n; });
    const links = [];

    function normEdge(e, idx) {
      const u = String(e.u), v = String(e.v);
      const src = nodeById[u], tgt = nodeById[v];
      if (!src || !tgt) return null;
      return {
        id: e.id || ("e-" + u + "-" + v + "-" + idx),
        source: src,
        target: tgt,
        u, v,
        color: e.color || COLORS.edge_stage2,
        w: (e.w == null ? 1.6 : e.w),
        kind: e.kind || null,
        cls: e.classes || "",
      };
    }

    const gLinks = svg.append("g").attr("class", "viz-edges");
    // Each node lives in its own <g.viz-node-group> containing the
    // circle + optional label. This per-node grouping gives correct
    // z-order: a node's own label sits in front of its own circle,
    // but neighbouring nodes' circles paint on top of that label when
    // they overlap (DOM order determines SVG paint order). Avoids the
    // need for a halo on labels.
    const gNodes = svg.append("g").attr("class", "viz-nodes");

    const showLabels = !!opts.showLabels;
    const labelTextFn = typeof opts.labelText === "function" ? opts.labelText : (d => d.id);
    let onNodeTap = null, onEdgeTap = null;
    let onNodeEnter = null, onNodeLeave = null;
    let onEdgeEnter = null, onEdgeLeave = null;

    const sim = d3.forceSimulation(nodesData)
      .force("link",    d3.forceLink([]).id(d => d.id).distance(55).strength(0.12))
      .force("charge",  d3.forceManyBody().strength(-45))
      .force("collide", d3.forceCollide(16))
      .force("x",       d3.forceX(d => d.homeX).strength(0.22))
      .force("y",       d3.forceY(d => d.homeY).strength(0.22))
      .alpha(0.35).alphaDecay(0.04);

    function classStr(base, extra) { return extra ? (base + " " + extra).trim() : base; }

    function draw() {
      computeDupIndices();
      const linkSel = gLinks.selectAll("path.viz-edge").data(links, d => d.id);
      linkSel.exit().remove();
      const linkEnter = linkSel.enter().append("path")
        .attr("class", d => classStr("viz-edge", d.cls))
        .attr("fill", "none")
        .attr("stroke", d => d.color)
        .attr("stroke-width", d => d.w)
        .style("cursor", "pointer")
        .on("click",      function (ev, d) { if (onEdgeTap) onEdgeTap(d, ev); })
        .on("mouseenter", function (ev, d) { if (onEdgeEnter) onEdgeEnter(d, ev); })
        .on("mouseleave", function (ev, d) { if (onEdgeLeave) onEdgeLeave(d, ev); });
      linkEnter.merge(linkSel)
        .attr("class", d => classStr("viz-edge", d.cls))
        .attr("stroke", d => d.color)
        .attr("stroke-width", d => d.w);

      const groupSel = gNodes.selectAll("g.viz-node-group").data(nodesData, d => d.id);
      groupSel.exit().remove();
      const groupEnter = groupSel.enter().append("g").attr("class", "viz-node-group");
      groupEnter.append("circle")
        .attr("class", d => classStr("viz-node", d.cls))
        .attr("r", d => d.r)
        .attr("fill", d => d.color)
        .attr("stroke", "#1b2033")
        .attr("stroke-width", 1.5)
        .style("cursor", "grab")
        .call(d3.drag()
          .on("start", function (ev, d) { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; d3.select(this).interrupt("snapback"); d3.select(this).style("cursor", "grabbing"); })
          .on("drag",  function (ev, d) { d.fx = ev.x; d.fy = ev.y; })
          .on("end",   function (ev, d) {
            if (!ev.active) sim.alphaTarget(0);
            d3.select(this).style("cursor", "grab");
            if (pinned) {
              const sx = d.fx, sy = d.fy, ex = d.homeX, ey = d.homeY;
              d3.select(this)
                .transition("snapback").duration(420)
                .tween("snap", () => (t) => {
                  d.fx = sx + (ex - sx) * t;
                  d.fy = sy + (ey - sy) * t;
                  sim.alpha(0.1);
                })
                .on("end.snap", () => { d.fx = d.homeX; d.fy = d.homeY; });
            } else {
              d.fx = null; d.fy = null;
            }
          }))
        .on("click",      function (ev, d) { if (onNodeTap) onNodeTap(d, ev); })
        .on("mouseenter", function (ev, d) { if (onNodeEnter) onNodeEnter(d, ev); })
        .on("mouseleave", function (ev, d) { if (onNodeLeave) onNodeLeave(d, ev); });
      if (showLabels) {
        groupEnter.append("text")
          .attr("class", "viz-label")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("pointer-events", "none");
      }
      const groups = groupEnter.merge(groupSel);
      groups.select("circle.viz-node")
        .attr("class", d => classStr("viz-node", d.cls))
        .attr("fill", d => d.color)
        .attr("r", d => d.r);
      if (showLabels) {
        groups.select("text.viz-label").text(labelTextFn);
      }

      sim.force("link").links(links);
      sim.alpha(0.3).restart();
    }

    function computeDupIndices() {
      // Group duplicate edges by unordered endpoint pair. Self-loops
      // group by node id. Each link gets .dupIdx in [0, total-1] and
      // .dupTotal so edgePath can fan them out.
      const groups = {};
      links.forEach(l => {
        const a = l.source.id, b = l.target.id;
        const key = (a === b) ? ("L|" + a) : (a < b ? (a + "|" + b) : (b + "|" + a));
        (groups[key] = groups[key] || []).push(l);
      });
      Object.keys(groups).forEach(k => {
        const arr = groups[k];
        arr.forEach((l, i) => { l.dupIdx = i; l.dupTotal = arr.length; });
      });
    }
    function edgePath(d) {
      if (d.source === d.target) {
        // self-loop rendered as small upward arc; multiple loops on the
        // same node fan out in alternating widths.
        const x = d.source.x, y = d.source.y;
        const rBase = 18, step = 7;
        const r = rBase + (d.dupIdx || 0) * step;
        return "M" + x + "," + y + " C" + (x - r) + "," + (y - r * 2.2) + " " + (x + r) + "," + (y - r * 2.2) + " " + (x + 0.01) + "," + (y - 0.01);
      }
      const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
      const total = d.dupTotal || 1;
      if (total <= 1) return "M" + sx + "," + sy + "L" + tx + "," + ty;
      // Parallel edges: quadratic bezier through a midpoint shifted
      // perpendicular by a per-duplicate amount. The perpendicular must
      // be computed from a CANONICAL direction (lower id → higher id),
      // not d.source → d.target, because two duplicate links may list
      // endpoints in opposite orders; using source/target directly flips
      // the perpendicular and makes both arcs land on the same side.
      // Spread scales with edge length so short edges still visibly
      // separate and long edges do not arc wildly.
      const lo = d.source.id < d.target.id ? d.source : d.target;
      const hi = d.source.id < d.target.id ? d.target : d.source;
      const cdx = hi.x - lo.x, cdy = hi.y - lo.y;
      const len = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
      const nx = -cdy / len, ny = cdx / len;
      const centered = (d.dupIdx || 0) - (total - 1) / 2;
      const spread = Math.max(22, Math.min(42, len * 0.18));
      const mx = (lo.x + hi.x) / 2 + nx * centered * spread * 2;
      const my = (lo.y + hi.y) / 2 + ny * centered * spread * 2;
      return "M" + sx + "," + sy + " Q" + mx + "," + my + " " + tx + "," + ty;
    }
    sim.on("tick", () => {
      gLinks.selectAll("path.viz-edge").attr("d", edgePath);
      gNodes.selectAll("g.viz-node-group > circle.viz-node").attr("cx", d => d.x).attr("cy", d => d.y);
      if (showLabels) gNodes.selectAll("g.viz-node-group > text.viz-label").attr("x", d => d.x).attr("y", d => d.y);
    });

    // Initial edges
    (opts.edges || []).forEach((e, i) => {
      const l = normEdge(e, i);
      if (l) links.push(l);
    });
    draw();

    const handle = {
      svg, sim, nodesData, links, nodeById,

      setEdges(edges) {
        links.length = 0;
        (edges || []).forEach((e, i) => { const l = normEdge(e, i); if (l) links.push(l); });
        draw();
      },
      addEdges(edges) {
        (edges || []).forEach((e, i) => { const l = normEdge(e, links.length + i); if (l) links.push(l); });
        draw();
      },
      addEdge(edge) { handle.addEdges([edge]); },
      removeEdges(pred) {
        let keep;
        if (pred == null)                 keep = [];
        else if (typeof pred === "string") keep = links.filter(l => l.id !== pred);
        else if (Array.isArray(pred))      keep = links.filter(l => !pred.includes(l.id));
        else if (typeof pred === "function") keep = links.filter(l => !pred(l));
        else keep = links;
        links.length = 0; keep.forEach(l => links.push(l));
        draw();
      },
      clearEdges() { handle.removeEdges(null); },
      hasEdge(id) { return !!links.find(l => l.id === id); },
      getEdge(id) { return links.find(l => l.id === id); },

      addEdgeClass(id, cls) {
        const e = links.find(l => l.id === id); if (!e) return;
        if (!(" " + e.cls + " ").includes(" " + cls + " ")) e.cls = (e.cls + " " + cls).trim();
        draw();
      },
      removeEdgeClass(id, cls) {
        const e = links.find(l => l.id === id); if (!e) return;
        e.cls = e.cls.split(/\s+/).filter(c => c && c !== cls).join(" ");
        draw();
      },
      toggleEdgeClass(id, cls, on) { on ? handle.addEdgeClass(id, cls) : handle.removeEdgeClass(id, cls); },
      addAllEdgeClass(cls)    { links.forEach(e => e.cls = (e.cls + " " + cls).trim()); draw(); },
      clearAllEdgeClass(cls)  { links.forEach(e => e.cls = e.cls.split(/\s+/).filter(c => c && c !== cls).join(" ")); draw(); },
      eachEdge(fn)            { links.forEach(l => fn(l)); },

      addNodeClass(id, cls) {
        const n = nodeById[String(id)]; if (!n) return;
        if (!(" " + n.cls + " ").includes(" " + cls + " ")) n.cls = (n.cls + " " + cls).trim();
        draw();
      },
      removeNodeClass(id, cls) {
        const n = nodeById[String(id)]; if (!n) return;
        n.cls = n.cls.split(/\s+/).filter(c => c && c !== cls).join(" ");
        draw();
      },
      clearAllNodeClass(cls) { nodesData.forEach(n => n.cls = n.cls.split(/\s+/).filter(c => c && c !== cls).join(" ")); draw(); },
      eachNode(fn) { nodesData.forEach(n => fn(n)); },
      setNodeStyle(id, patch) {
        const n = nodeById[String(id)]; if (!n) return;
        if (patch.color) n.color = patch.color;
        if (patch.r != null) n.r = patch.r;
        draw();
      },

      animateEdgeOpacityByClass(cls, target, durMs = 300) {
        gLinks.selectAll("path.viz-edge")
          .filter(function (d) { return (" " + d.cls + " ").includes(" " + cls + " "); })
          .transition().duration(durMs)
          .style("opacity", target);
      },

      onEdgeTap(fn)     { onEdgeTap   = fn; },
      onNodeTap(fn)     { onNodeTap   = fn; },
      onNodeHoverEnter(fn) { onNodeEnter = fn; },
      onNodeHoverLeave(fn) { onNodeLeave = fn; },
      onEdgeHoverEnter(fn) { onEdgeEnter = fn; },
      onEdgeHoverLeave(fn) { onEdgeLeave = fn; },

      fit()    {},
      resize() {},
    };

    return handle;
  },
};
// Back-compat alias: old pages that still reference NETGEN.CY.init
// will just get the new VIZ init.
const CY = VIZ;

// ── Tooltip helper (rich node + edge stats) ──────────────────
// Pre-compute intra/inter degree + local clustering coefficient
// from the canonical EDGES, so every page gets the same figures
// landing uses.
const __adj = {};
NODES.forEach(n => { __adj[n] = new Set(); });
EDGES.forEach(({u, v}) => { __adj[u].add(v); __adj[v].add(u); });
const __intraDeg = {}, __interDeg = {}, __localCC = {};
NODES.forEach(n => { __intraDeg[n] = 0; __interDeg[n] = 0; });
EDGES.forEach(({u, v}) => {
  const same = CLUSTER_OF[u] === CLUSTER_OF[v] && CLUSTER_OF[u] !== "OUT";
  if (same) { __intraDeg[u]++; __intraDeg[v]++; }
  else      { __interDeg[u]++; __interDeg[v]++; }
});
NODES.forEach(n => {
  const nbrs = [...__adj[n]];
  const k = nbrs.length;
  if (k < 2) { __localCC[n] = 0; return; }
  let tri = 0;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    if (__adj[nbrs[i]].has(nbrs[j])) tri++;
  }
  __localCC[n] = (2 * tri) / (k * (k - 1));
});
function __edgeKind(u, v) {
  const cu = CLUSTER_OF[u], cv = CLUSTER_OF[v];
  if (cu === "OUT" && cv === "OUT") return "outlier-outlier";
  if (cu === "OUT" || cv === "OUT") return "clustered-outlier";
  if (cu === cv) return "intra-cluster (" + cu + ")";
  return "inter-cluster (" + cu + ", " + cv + ")";
}

function makeTooltip(handle, container) {
  const tip = document.createElement("div");
  tip.className = "cy-tooltip";
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(tip);
  function place(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    let x = clientX - rect.left + 14;
    let y = clientY - rect.top + 14;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > rect.width - 8)  x = clientX - rect.left - tw - 12;
    if (y + th > rect.height - 8) y = clientY - rect.top - th - 8;
    tip.style.left = x + "px";
    tip.style.top  = y + "px";
  }
  handle.onNodeHoverEnter(function (d, ev) {
    const id = parseInt(d.id, 10);
    const cl = CLUSTER_OF[id];
    const type = cl === "OUT" ? "outlier" : "clustered";
    const clLabel = cl === "OUT" ? "(none)" : cl;
    const dTot = DEGREES[id] || 0;
    const dInt = __intraDeg[id] || 0;
    const dExt = __interDeg[id] || 0;
    const cc   = __localCC[id] || 0;
    const mu   = dTot > 0 ? dExt / dTot : 0;
    tip.innerHTML =
      '<div class="hd">node ' + id + ' &middot; ' + type + '</div>' +
      '<div>cluster <b>' + clLabel + '</b></div>' +
      '<div>degree <b>' + dTot + '</b> <span class="dim">(intra ' + dInt + ', inter ' + dExt + ')</span></div>' +
      '<div>local cc <b>' + cc.toFixed(2) + '</b></div>' +
      '<div>&mu;<sub>i</sub> <b>' + mu.toFixed(2) + '</b></div>';
    tip.classList.add("on");
    place(ev.clientX, ev.clientY);
  });
  handle.onNodeHoverLeave(function () { tip.classList.remove("on"); });
  handle.onEdgeHoverEnter(function (d, ev) {
    const src = d.source.id, tgt = d.target.id;
    const kind = __edgeKind(parseInt(src, 10), parseInt(tgt, 10));
    tip.innerHTML =
      '<div class="hd">edge</div>' +
      '<div><b>' + src + '</b>, <b>' + tgt + '</b></div>' +
      '<div class="dim">' + kind + '</div>';
    tip.classList.add("on");
    place(ev.clientX, ev.clientY);
  });
  handle.onEdgeHoverLeave(function () { tip.classList.remove("on"); });
  return tip;
}

// ── Scrub slider ─────────────────────────────────────────────
function scrubSlider(opts) {
  const { input, output, onChange, format } = opts;
  function fire() {
    const v = parseFloat(input.value);
    if (output) output.value = format ? format(v) : v.toFixed(2);
    if (onChange) onChange(v);
  }
  input.addEventListener("input", fire);
  fire();
}

// ── Step-controller ──────────────────────────────────────────
function stepController(opts) {
  const { prevBtn, nextBtn, resetBtn, labelCur, labelTotal, onRender } = opts;
  let total = opts.total;
  let idx = 0;
  function render() {
    if (labelCur) labelCur.textContent = idx;
    if (labelTotal) labelTotal.textContent = total - 1;
    if (prevBtn) prevBtn.disabled = (idx <= 0);
    if (nextBtn) nextBtn.disabled = (idx >= total - 1);
    if (onRender) onRender(idx);
  }
  prevBtn && prevBtn.addEventListener("click", () => { if (idx>0) { idx--; render(); } });
  nextBtn && nextBtn.addEventListener("click", () => { if (idx<total-1) { idx++; render(); } });
  resetBtn && resetBtn.addEventListener("click", () => { idx = 0; render(); });
  // keyboard: ←, →, space
  document.addEventListener("keydown", (ev) => {
    if (ev.target.tagName === "INPUT") return;
    if (ev.key === "ArrowLeft") { if (idx>0) { idx--; render(); } }
    else if (ev.key === "ArrowRight" || ev.key === " ") {
      if (idx<total-1) { idx++; render(); ev.preventDefault(); }
    }
  });
  render();
  return {
    get idx() { return idx; },
    set: (i) => { idx = Math.max(0, Math.min(total-1, i)); render(); },
    // Callers that regenerate their data (e.g. nPSO's trajectory on a
    // random-button reroll) can swap `total` and reset idx without
    // reconstructing the controller.
    reconfigure: (newTotal) => { total = newTotal; idx = 0; render(); },
  };
}

// ── Toggle widget ────────────────────────────────────────────
function toggle(opts) {
  const { input, onChange } = opts;
  input.addEventListener("change", () => onChange(input.checked));
  onChange(input.checked);
}

// ── Top-nav bar (per-gen pages) ──────────────────────────────
// Landing handles its own nav inline. Generator pages get a
// flex bar: back-arrow on the left, small icon links (notes,
// source) on the right. Rendered into <div id="links"></div>
// which should sit at the very top of <main class="page">.
function linksRow(opts = {}) {
  const { gen } = opts;
  if (!gen) return "";
  const REPO = "https://github.com/vltanh/network-generation";
  const NOTES = `${REPO}/blob/main/docs/algorithms/${gen}.md`;
  return (
    '<div class="top-nav">'
    + '<a class="back-nav" href="./" aria-label="back to all generators">'
    +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>'
    +   '<span>back</span>'
    + '</a>'
    + '<nav class="top-icons" aria-label="generator links">'
    +   '<a href="' + NOTES + '" target="_blank" rel="noopener" aria-label="algorithm notes">'
    +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5v15A1.5 1.5 0 0 0 5.5 21H20V5H5.5A1.5 1.5 0 0 1 4 4.5Z"/><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v2"/><path d="M8 8h8M8 11.5h8M8 15h6"/></svg>'
    +     '<span>notes</span>'
    +   '</a>'
    +   '<a href="' + REPO + '" target="_blank" rel="noopener" aria-label="github repository">'
    +     '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'
    +     '<span>source</span>'
    +   '</a>'
    + '</nav>'
    + '</div>'
  );
}

// ── Kin-cards helper ─────────────────────────────────────────
function kinSection(opts) {
  // opts: { title, siblings: [{gen, label, diff}] }
  const { title = "related generators", siblings } = opts;
  const cards = siblings.map(s => `
    <a class="kin-card" href="./${s.gen}.html">
      <div class="name">${s.label}</div>
      <div class="diff">${s.diff}</div>
    </a>`).join("");
  return `<section class="kin"><h2>${title}</h2><div class="kin-grid">${cards}</div></section>`;
}

// ── Auto-inject back-to-top FAB on every page ────────────────
function injectBackToTop() {
  if (typeof document === "undefined") return;
  if (document.querySelector(".back-to-top")) return;
  const btt = document.createElement("button");
  btt.className = "back-to-top";
  btt.setAttribute("aria-label", "back to top");
  btt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20 Q 11 13 12 5"/><path d="M7 10 Q 9 8 12 5 Q 15 8 17 10"/></svg>';
  btt.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.body.appendChild(btt);
  window.addEventListener("scroll", () => {
    btt.classList.toggle("on", window.scrollY > 420);
  }, { passive: true });
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectBackToTop);
  } else {
    injectBackToTop();
  }
}

// ── Export ────────────────────────────────────────────────────
global.NETGEN = {
  POSITIONS, NODES, EDGES, CLUSTER_OF, DEGREES, DEGREES_EXCL, MINCUTS,
  MIN_CUT_EDGES, MIN_CUT_ISOLATE,
  C1, C2, C3, OUT, INTRA, INTER, OUT_EDGES,
  CORE_NODES, CORE_EDGES, topK, cliqueEdges,
  COLORS, CY, VIZ,
  makeTooltip, scrubSlider, stepController, toggle,
  linksRow, kinSection,
};

})(window);
