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
  // C1 (top): planar embeddings on both halves. K_4 drawn as triangle
  // {1,3,4} with 2 inside, so the bridge endpoints 1 (top-right) and
  // 4 (bottom-right) sit on the K_4 boundary and the bridges (1,5),
  // (4,8) leave K_4 cleanly. Diamond is the 4-cycle 5-6-8-7 plus the
  // (6,7) diagonal; 5 is top, 8 is bottom, 6 and 7 are the side
  // vertices the diagonal connects.
  1:  {x: -218, y: -258},
  2:  {x: -342, y: -288},
  3:  {x: -401, y: -218},
  4:  {x: -306, y: -416},
  5:  {x:  -58, y: -254},
  6:  {x:   98, y: -375},
  7:  {x:  -63, y: -374},
  8:  {x:    7, y: -453},
  // C2 (bottom-right, 6 nodes): K_4 on {9,10,11,12} as a square,
  // 13 hangs off (9,12), 14 off (10,11) on opposite diagonals.
  9:  {x:  240, y:   74},
  10: {x:  408, y:   -6},
  11: {x:  227, y:  226},
  12: {x:  444, y:  129},
  13: {x:  355, y:  277},
  14: {x:  154, y:  284},
  // C3 (bottom-left, 4 nodes): triangle {15,16,17}, leaf 18 off 16.
  15: {x: -364, y:   88},
  17: {x: -398, y:  220},
  16: {x: -289, y:  250},
  18: {x: -186, y:  344},
  // Outliers in the middle, pulled off the C2 axis so they don't
  // read as a continuation of the 9-12-13 line.
  19: {x:  -95, y:   37},
  20: {x:   93, y: -107},
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
  // C1 is two halves of 4 joined by 2 bridges: K_4 on {1,2,3,4} and a
  // diamond (K_4 minus (5,8)) on {5,6,7,8}, bridged by (1,5) and (4,8).
  // Edge connectivity = 2 strictly (the bridge cut), and min internal
  // degree = 3, so the best cut set is NOT all edges of a single node.
  // This is the only cluster where the min cut is a "between halves"
  // bridge cut rather than an "isolate a leaf" cut.
  C1: [
    [1,2],[1,3],[1,4],[2,3],[2,4],[3,4],   // K_4 on {1,2,3,4}
    [5,6],[5,7],[6,7],[6,8],[7,8],          // diamond on {5,6,7,8}
    [1,5],[4,8],                             // 2 bridges
  ],
  // C2 is K_4 on {9..12} plus tails 13 and 14. 13 hangs off the K_4
  // by edges (9,13) and (12,13); 14 hangs off by (10,14) and (11,14).
  // Min cut = 2, achieved by isolating either 13 or 14 (single-node).
  C2: [
    [9,10],[9,11],[9,12],[9,13],
    [10,11],[10,12],[10,14],
    [11,12],[11,14],
    [12,13],
  ],
  // C3 has a triangle on {15,16,17} plus node 18 dangling off node 16.
  // Min cut = 1 (isolate 18 via (16,18)).
  C3: [[15,16],[15,17],[16,17],[16,18]],
};
const INTER = [
  [1,9], [2,10], [3,11], [5,12],   // C1-C2
  [9,15], [11,16],                   // C2-C3
  [1,15], [4,17],                    // C1-C3
];
const OUT_EDGES = [[19,1],[19,9],[20,5],[20,16],[19,20]];
// Total: 13 + 10 + 4 + 8 + 5 = 40 edges. Hubs after the rebalance:
// node 1 has full degree 7 (intra 4 + inter 2 + outlier 1), node 9 = 6,
// nodes 4 and 11 = 5. C1's bridge-cut topology drives the EC-SBM and
// SBM stories: K_3 core on the top-3 leaves residual stubs for attach
// and rewire, and attach can overshoot a hub's input degree if the
// heuristic concentrates partners on the K_3 nodes.

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

const MINCUTS = { C1: 2, C2: 2, C3: 1 };

// A concrete minimum edge cut set per cluster. C1's cut splits the
// cluster into two non-trivial halves (no single node is isolated);
// C2 and C3 isolate the lowest-degree node inside the cluster.
//   - C1 (k=2): bridge cut {(1,5),(4,8)} splits {1,2,3,4} | {5,6,7,8}
//   - C2 (k=2): isolate node 13 (intra-deg 2) via {(9,13),(12,13)}
//   - C3 (k=1): isolate node 18 (intra-deg 1) via {(16,18)}
// Each edge set is listed with lo-id first.
const MIN_CUT_EDGES = {
  C1: [[1,5],[4,8]],
  C2: [[9,13],[12,13]],
  C3: [[16,18]],
};
// Node that gets isolated by the corresponding MIN_CUT_EDGES set.
// C1 is null because its min cut splits two non-trivial halves rather
// than isolating a single node; consumers must handle null.
const MIN_CUT_ISOLATE = { C1: null, C2: 13, C3: 18 };

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
  edge_intra: {C1:"#3559a0", C2:"#b4741d", C3:"#4e7a3a", OUT:"#a04030"},
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

// ── Edge path primitives ─────────────────────────────────────
// Single source of truth for the SVG `d` strings that draw edges.
// Every edge-drawing site (VIZ.edgePath, spoke_layer's placedPath +
// fanPath, the rewire-spoke animator's straightBoundaryPath +
// selfLoopPath + placeBridgeViaStubs) routes here so a self-loop
// drawn during animation has the same shape as the one painted by
// the static viz once the animation commits.
//
//   makeEdge(p1, p2, r1, r2)
//     Straight boundary segment: M (p1 + r1*û) L (p2 - r2*û)
//   makeParallelEdge(p1, p2, dupIdx, dupTotal, r1, r2)
//     Quadratic Q-bezier through a perpendicular control. When dupTotal
//     <= 1 collapses to the same chord as makeEdge.
//   makeSelfLoop(p, r0, opts?)
//     Two-quadratic teardrop: M start_left  Q ctrl_left  apex
//                                            Q ctrl_right end_right
//     Endpoints sit on the node boundary at the loop tangents; the apex
//     sits directly above the node centre. opts.rOffset (default 8)
//     scales the bulge; pages drawing parallel self-loops bump it per
//     dupIdx so the loops don't stack.
//   makeSelfLoopHalf(p, r0, side, opts?)
//     Single half (side -1 = left, +1 = right) used by spoke_layer to
//     paint each half independently.
const EdgePaths = (function () {
  const LOOP_OFFX = 1.1;
  const LOOP_OFFY = 2.0;
  const LOOP_TANGENT_START = Math.atan2(-LOOP_OFFY, -LOOP_OFFX);
  const LOOP_TANGENT_END   = Math.atan2(-LOOP_OFFY,  LOOP_OFFX);
  const LOOP_R_OFFSET = 8;
  function loopApex(p, r0, rOffset) {
    const r = r0 + (rOffset != null ? rOffset : LOOP_R_OFFSET);
    return { x: p.x, y: p.y - r * LOOP_OFFY };
  }
  function makeSelfLoopHalf(p, r0, side, opts) {
    opts = opts || {};
    const rOffset = opts.rOffset != null ? opts.rOffset : LOOP_R_OFFSET;
    const r = r0 + rOffset;
    const apex = loopApex(p, r0, rOffset);
    const cx = p.x + side * r * LOOP_OFFX;
    const cy = p.y - r * LOOP_OFFY;
    const tangent = side < 0 ? LOOP_TANGENT_START : LOOP_TANGENT_END;
    const sx = p.x + Math.cos(tangent) * r0;
    const sy = p.y + Math.sin(tangent) * r0;
    return "M" + sx + "," + sy + " Q" + cx + "," + cy + " " + apex.x + "," + apex.y;
  }
  function makeSelfLoop(p, r0, opts) {
    opts = opts || {};
    const rOffset = opts.rOffset != null ? opts.rOffset : LOOP_R_OFFSET;
    const r = r0 + rOffset;
    const apex = loopApex(p, r0, rOffset);
    const sx = p.x + Math.cos(LOOP_TANGENT_START) * r0;
    const sy = p.y + Math.sin(LOOP_TANGENT_START) * r0;
    const ex = p.x + Math.cos(LOOP_TANGENT_END) * r0;
    const ey = p.y + Math.sin(LOOP_TANGENT_END) * r0;
    const cxL = p.x - r * LOOP_OFFX, cyL = p.y - r * LOOP_OFFY;
    const cxR = p.x + r * LOOP_OFFX, cyR = p.y - r * LOOP_OFFY;
    return "M" + sx + "," + sy +
           " Q" + cxL + "," + cyL + " " + apex.x + "," + apex.y +
           " Q" + cxR + "," + cyR + " " + ex + "," + ey;
  }
  function makeEdge(p1, p2, r1, r2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const sx = p1.x + ux * r1, sy = p1.y + uy * r1;
    const ex = p2.x - ux * r2, ey = p2.y - uy * r2;
    return "M" + sx + "," + sy + " L" + ex + "," + ey;
  }
  function makeParallelEdgeCentered(p1, p2, centered, r1, r2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const spread = Math.max(22, Math.min(42, len * 0.18));
    const mx = (p1.x + p2.x) / 2 + nx * centered * spread * 2;
    const my = (p1.y + p2.y) / 2 + ny * centered * spread * 2;
    const dxs = mx - p1.x, dys = my - p1.y;
    const ds = Math.hypot(dxs, dys) || 1;
    const sx = p1.x + (dxs / ds) * (r1 || 0);
    const sy = p1.y + (dys / ds) * (r1 || 0);
    const dxe = mx - p2.x, dye = my - p2.y;
    const de = Math.hypot(dxe, dye) || 1;
    const ex = p2.x + (dxe / de) * (r2 || 0);
    const ey = p2.y + (dye / de) * (r2 || 0);
    return "M" + sx + "," + sy + " Q" + mx + "," + my + " " + ex + "," + ey;
  }
  function makeParallelEdge(p1, p2, dupIdx, dupTotal, r1, r2) {
    const centered = dupTotal <= 1 ? 0 : (dupIdx - (dupTotal - 1) / 2);
    return makeParallelEdgeCentered(p1, p2, centered, r1, r2);
  }
  return {
    LOOP_OFFX, LOOP_OFFY, LOOP_TANGENT_START, LOOP_TANGENT_END, LOOP_R_OFFSET,
    loopApex, makeSelfLoop, makeSelfLoopHalf,
    makeEdge, makeParallelEdge, makeParallelEdgeCentered,
  };
})();

// ── Bridge animation primitives ─────────────────────────────
// Both spoke_layer (SBM stub-matcher) and rewireSpokeSwapAnimate
// paint bridges using the same SVG dasharray choreography. Three
// shared primitives live here so the two layers can never drift:
//   bridgeGrow    : 0-len → full-length (dashoffset for self-loop,
//                   4-value stub-gap-stub for straight bridges).
//   bridgeRetract : the time-mirror of bridgeGrow.
//   bridgeColorize: settled-style crossfade (stroke + dasharray +
//                   width). Used at the end of the build sequence.
const BridgeAnim = (function () {
  function lengthOf(node) { return (node.getTotalLength && node.getTotalLength()) || 100; }
  function grow(pathSel, opts) {
    opts = opts || {};
    const isLoop = !!opts.isLoop;
    const duration = opts.duration != null ? opts.duration : 300;
    const ease = opts.ease || (typeof d3 !== "undefined" ? d3.easeCubicOut : null);
    const tName = opts.transitionName || "grow";
    pathSel.each(function () {
      const sel = d3.select(this);
      const len = lengthOf(this);
      if (isLoop) {
        sel.attr("stroke-dasharray", len + " " + len)
          .attr("stroke-dashoffset", len);
        const t = sel.transition(tName).duration(duration);
        if (ease) t.ease(ease);
        if (opts.delay) t.delay(opts.delay);
        t.attr("stroke-dashoffset", 0);
      } else {
        const halfLen = len / 2;
        sel.attr("stroke-dashoffset", 0)
          .attr("stroke-dasharray", "0 " + len + " 0 0");
        const t = sel.transition(tName).duration(duration);
        if (ease) t.ease(ease);
        if (opts.delay) t.delay(opts.delay);
        t.attrTween("stroke-dasharray", function () {
          return function (k) {
            const stub = halfLen * k;
            const gap = len - 2 * stub;
            return stub + " " + gap + " " + stub + " 0";
          };
        });
      }
    });
  }
  function retract(pathSel, opts) {
    opts = opts || {};
    const isLoop = !!opts.isLoop;
    const duration = opts.duration != null ? opts.duration : 280;
    const ease = opts.ease || (typeof d3 !== "undefined" ? d3.easeCubicIn : null);
    const tName = opts.transitionName || "retract";
    pathSel.each(function () {
      const sel = d3.select(this);
      const len = lengthOf(this);
      if (isLoop) {
        sel.attr("stroke-dasharray", len + " " + len)
          .attr("stroke-dashoffset", 0);
        const t = sel.transition(tName).duration(duration);
        if (ease) t.ease(ease);
        t.attr("stroke-dashoffset", len);
      } else {
        const halfLen = len / 2;
        sel.attr("stroke-dashoffset", 0)
          .attr("stroke-dasharray", halfLen + " 0 " + halfLen + " 0");
        const t = sel.transition(tName).duration(duration);
        if (ease) t.ease(ease);
        t.attrTween("stroke-dasharray", function () {
          return function (k) {
            const stub = halfLen * (1 - k);
            const gap = len - 2 * stub;
            return stub + " " + gap + " " + stub + " 0";
          };
        });
      }
    });
  }
  function colorize(pathSel, opts) {
    opts = opts || {};
    const duration = opts.duration != null ? opts.duration : 220;
    const ease = opts.ease || (typeof d3 !== "undefined" ? d3.easeCubicInOut : null);
    const tName = opts.transitionName || "colorize";
    const finalColor = opts.color;
    const finalWidth = opts.width != null ? opts.width : 1.6;
    const dasharray = opts.bad ? "4 4" : null;
    const t = pathSel.transition(tName).duration(duration);
    if (ease) t.ease(ease);
    t.attr("stroke", finalColor)
      .attr("stroke-width", finalWidth)
      .attr("stroke-dasharray", dasharray);
    return t;
  }
  return { grow, retract, colorize };
})();

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
        .attr("viewBox", fitViewBoxAttr({
          positions: opts.positions || POSITIONS,
          includeIds: opts.includeOutliers === false
            ? NODES.filter(n => CLUSTER_OF[n] !== "OUT")
            : NODES,
          pad: opts.pad,
          padRight: opts.padRight,
        }))
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

    // Cluster repulsion: nodes from different clusters push each other
    // away when their centroids drift close. Pinned nodes (fx/fy set)
    // ignore the velocity update so this is a no-op for static layouts;
    // free-running sims (matcher input panel, future generative pages)
    // get cluster separation for free.
    function clusterRepel(alpha) {
      const REACH = 80;
      const STR  = 0.45;
      for (let i = 0; i < nodesData.length; i++) {
        const a = nodesData[i];
        for (let j = i + 1; j < nodesData.length; j++) {
          const b = nodesData[j];
          if (a.cluster && a.cluster === b.cluster) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 === 0 || d2 > REACH * REACH) continue;
          const dist = Math.sqrt(d2);
          const f = (REACH - dist) * STR * alpha / dist;
          a.vx -= dx * f;
          a.vy -= dy * f;
          b.vx += dx * f;
          b.vy += dy * f;
        }
      }
    }
    const sim = d3.forceSimulation(nodesData)
      .force("link",    d3.forceLink([]).id(d => d.id).distance(55).strength(0.12))
      .force("charge",  d3.forceManyBody().strength(-45))
      .force("collide", d3.forceCollide(16))
      .force("x",       d3.forceX(d => d.homeX).strength(0.22))
      .force("y",       d3.forceY(d => d.homeY).strength(0.22))
      .force("clusterRepel", clusterRepel)
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
      const r1 = (d.source && d.source.r) || nodeR;
      const r2 = (d.target && d.target.r) || nodeR;
      if (d.source === d.target) {
        // rOffset bumped per dupIdx so parallel self-loops on the same
        // node nest one above the next instead of stacking.
        const rOffset = 8 + (d.dupIdx || 0) * 7;
        return EdgePaths.makeSelfLoop(d.source, r1, { rOffset });
      }
      const total = d.dupTotal || 1;
      if (total <= 1) return EdgePaths.makeEdge(d.source, d.target, r1, r2);
      const lo = d.source.id < d.target.id ? d.source : d.target;
      const hi = d.source.id < d.target.id ? d.target : d.source;
      // dupIdx is canonical-orientation aware; centered offset uses lo→hi.
      const centered = (d.dupIdx || 0) - (total - 1) / 2;
      const lor = lo === d.source ? r1 : r2;
      const hir = hi === d.source ? r1 : r2;
      return EdgePaths.makeParallelEdgeCentered(lo, hi, centered, lor, hir);
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
        else if (typeof pred === "function") keep = links.filter(l => !pred(l.id));
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
// opts (all optional unless noted):
//   total            (required) number of steps including step 0
//   prevBtn, nextBtn, resetBtn (= "to start"), endBtn (= "to end")
//   randStepBtn, randAllBtn    walker locking rule per
//                              feedback_matcher_reroll_ux.md:
//                              randStep mid-walk only reseeds current
//                              step, randAll reseeds everything
//   labelCur, labelTotal       output spans for "k / N"
//   onRender(idx)              called on every state change
//   onRandStep(idx)            invoked on random-step button click
//   onRandAll()                invoked on random-all button click
//   keyboard: true             enable arrow + space keybinds (default true)
function stepController(opts) {
  const {
    prevBtn, nextBtn, resetBtn, endBtn,
    randStepBtn, randAllBtn,
    labelCur, labelTotal,
    onRender, onRandStep, onRandAll,
    getLocked,
  } = opts;
  const useKeys = opts.keyboard !== false;
  let total = opts.total;
  let idx = 0;
  function isLocked() { return !!(getLocked && getLocked()); }
  function refreshButtons() {
    const locked = isLocked();
    const atStart = (idx <= 0);
    const atEnd = (idx >= total - 1);
    if (prevBtn) prevBtn.disabled = locked || atStart;
    if (nextBtn) nextBtn.disabled = locked || atEnd;
    if (resetBtn) resetBtn.disabled = locked || atStart;
    if (endBtn)   endBtn.disabled   = locked || atEnd;
    // No active step at idx 0 → nothing to reroll.
    if (randStepBtn) randStepBtn.disabled = locked || atStart;
    if (randAllBtn)  randAllBtn.disabled  = locked || atStart;
  }
  function render() {
    if (labelCur) labelCur.textContent = idx;
    if (labelTotal) labelTotal.textContent = total - 1;
    refreshButtons();
    if (onRender) onRender(idx);
  }
  prevBtn && prevBtn.addEventListener("click", () => { if (!isLocked() && idx>0) { idx--; render(); } });
  nextBtn && nextBtn.addEventListener("click", () => { if (!isLocked() && idx<total-1) { idx++; render(); } });
  resetBtn && resetBtn.addEventListener("click", () => { if (!isLocked()) { idx = 0; render(); } });
  endBtn && endBtn.addEventListener("click", () => { if (!isLocked()) { idx = total-1; render(); } });
  randStepBtn && randStepBtn.addEventListener("click", () => {
    if (isLocked()) return;
    if (onRandStep) onRandStep(idx);
    render();
  });
  randAllBtn && randAllBtn.addEventListener("click", () => {
    if (isLocked()) return;
    if (onRandAll) onRandAll();
    render();
  });
  // keyboard: ←, →, space, home, end
  if (useKeys) {
    document.addEventListener("keydown", (ev) => {
      if (ev.target.tagName === "INPUT") return;
      if (isLocked()) return;
      if (ev.key === "ArrowLeft") { if (idx>0) { idx--; render(); } }
      else if (ev.key === "ArrowRight" || ev.key === " ") {
        if (idx<total-1) { idx++; render(); ev.preventDefault(); }
      }
      else if (ev.key === "Home") { if (idx>0) { idx = 0; render(); } }
      else if (ev.key === "End")  { if (idx<total-1) { idx = total-1; render(); } }
    });
  }
  render();
  return {
    get idx() { return idx; },
    get total() { return total; },
    set: (i) => { idx = Math.max(0, Math.min(total-1, i)); render(); },
    rerender: () => render(),
    refreshButtons: () => refreshButtons(),
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

// ── Auto-fit viewBox helper ───────────────────────────────────
// Compute a square viewBox that wraps the supplied positions with a
// margin large enough for block-rect dashes + node labels. Pages drop
// hardcoded viewBox literals and call this so a fixture move (POSITIONS
// change in shared.js) does not require touching each page's viewBox.
//
// opts:
//   positions: id → {x, y}. Default: NETGEN.POSITIONS.
//   includeIds: array of ids to wrap. Default: NETGEN.NODES.
//   pad: extra margin around the bbox (default 42; covers makeBlockRects'
//        padX/padY of 34/38 plus a small label/halo allowance). Tighter
//        framing keeps the graph readable on mobile, where a generous
//        pad shrinks every node well below thumb-target size.
function fitViewBoxAttr(opts) {
  opts = opts || {};
  const positions = opts.positions || POSITIONS;
  const ids = opts.includeIds || NODES;
  const pad = opts.pad != null ? opts.pad : 42;
  const padRight = opts.padRight || 0;  // extra right slack — leaves room for a top-right overlay panel without nodes flowing under it
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  ids.forEach(id => {
    const p = positions[id];
    if (!p) return;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  if (!isFinite(minX)) return "-320 -320 640 640";
  let x = minX - pad, y = minY - pad;
  let w = (maxX - minX) + 2 * pad + padRight;
  let h = (maxY - minY) + 2 * pad;
  // With padRight, leave the viewBox at its natural (wider) aspect
  // — squaring would also pad the vertical axis, shrinking the
  // graph inside its host. Without padRight, square out so x/y
  // scales match (page CSS sets aspect-ratio: 1/1 in some layouts).
  if (padRight > 0) {
    return `${x} ${y} ${w} ${h}`;
  }
  const side = Math.max(w, h);
  x -= (side - w) / 2;
  y -= (side - h) / 2;
  return `${x} ${y} ${side} ${side}`;
}

// 3-phase rewire-swap animator shared by every walker that pairs the
// edge-switch animation with a per-op trace. opts: { viz, before,
// after, cuts, places, four, edgeIdPrefix, settle }.
//   before / after: edge arrays (each entry { u, v, color, w, id, classes })
//                   for the state before / after the swap. Caller
//                   builds these from the kernel trace.
//   cuts:           [[u,v], ...] edges being removed by this op.
//   places:         [[u,v], ...] edges being added by this op.
//   four:           array of node ids participating (2 or 4).
//   edgeIdPrefix:   string used to prefix the swap-cut / swap-place
//                   ids so they don't collide across panels.
//   settle:         optional callback after the final settle frame.
// Returns a cancel handle: { cancel() }. Calling cancel before the
// animation finishes drops the timers and snaps to `after`.
function rewireSwapAnimate(opts) {
  const { viz, before, after, cuts, places, four, edgeIdPrefix } = opts;
  const settle = opts.settle || function () {};
  const ID = edgeIdPrefix || "swap";
  // Each cut bridge wears the EXACT style of its before-state edge
  // (red-dashed if the edge was a self-loop / parallel / collision,
  // settled colour solid if the edge was a sacrificed valid edge).
  // Each place bridge wears the EXACT style of its after-state edge.
  // No build / colorize crossfade: the cut retracts at canonical
  // before-style, the place grows at canonical after-style.
  const PHASE1 = 500;        // hold cut edges in their before-style
  const PHASE_RETRACT = 320; // T.rewindBridge equivalent
  const PHASE_GROW    = 320; // T.bridgeGrow equivalent
  const PHASE3 = 160;        // settle

  // Look up before / after edge styles by canonical key. Each cut's
  // bridge picks up the matching before-edge's color + classes; each
  // place's bridge picks up the after-edge's. Class 'cm-bad' or 'pick'
  // means the edge renders as red-dashed in the page edge layer, so
  // the bridge mirrors that with stroke-dasharray "4 4". Width comes
  // from the matched edge too so the visual is continuous when the
  // viz edge layer hands off to the bridge layer.
  const cutKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
  const beforeByKey = {};
  (before || []).forEach(e => { beforeByKey[cutKey(e.u, e.v)] = e; });
  const afterByKey = {};
  (after || []).forEach(e => { afterByKey[cutKey(e.u, e.v)] = e; });
  function isBadEdge(e) {
    if (!e) return false;
    const cls = e.classes || "";
    return cls.indexOf("cm-bad") >= 0 || cls.indexOf("pick") >= 0;
  }
  function styleFor(e) {
    return {
      color: (e && e.color) || "#1a3478",
      width: (e && e.w) || 1.5,
      dashed: isBadEdge(e),
    };
  }
  const cutStyles = (cuts || []).map(c => styleFor(beforeByKey[cutKey(c[0], c[1])]));
  const placeStyles = (places || []).map(p => styleFor(afterByKey[cutKey(p[0], p[1])]));

  const cutKeys = new Set(cuts.map(c => cutKey(c[0], c[1])));
  const beforeMinusCuts = before.filter(e => !cutKeys.has(cutKey(e.u, e.v)));

  // Phase 1: hide cut edges in viz. Dim everything except the active
  // 4 (no border outline, just the lack of dim). Cut edges get
  // re-rendered as red-dashed bridges in the overlay layer below so
  // they wear the canonical "bad edge" style spoke_layer uses.
  viz.setEdges(beforeMinusCuts);
  if (viz.clearAllNodeClass) {
    viz.clearAllNodeClass("dim");
    viz.clearAllNodeClass("pick");
  }
  const fourSet = new Set((four || []).map(x => String(x)));
  if (viz.eachNode) {
    viz.eachNode(n => {
      if (!fourSet.has(String(n.id))) viz.addNodeClass(n.id, "dim");
    });
  }
  if (viz.eachEdge) {
    viz.eachEdge(e => viz.addEdgeClass(e.id, "dim-strong"));
  }

  // Phase 2: port spoke_layer's bridge retract + grow technique
  // verbatim. Each cut edge becomes an SVG <path> whose
  // stroke-dasharray retracts from "halfLen 0 halfLen 0" (full path
  // drawn) to "0 len 0 0" (nothing) — same attrTween closure as
  // spoke_layer's runRewindRetract. Each place edge is then drawn as
  // a fresh <path> and grown in reverse: "0 len 0 0" → "halfLen 0
  // halfLen 0", same attrTween closure as spoke_layer's renderBridge
  // animate path. Both phases reuse the helper buildBridge() below.
  function nodeXY(id) {
    const n = viz.nodeById[String(id)];
    return n ? { x: n.x, y: n.y, r: (n.r || 13) } : { x: 0, y: 0, r: 13 };
  }
  // Path along the line from u to v starting + ending at each node's
  // boundary (so the dasharray retract collapses INTO the node centres
  // visibly, not into a midpoint floating in space).
  function bridgePath(u, v) {
    const a = nodeXY(u), b = nodeXY(v);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const sx = a.x + (dx / len) * a.r;
    const sy = a.y + (dy / len) * a.r;
    const ex = b.x - (dx / len) * b.r;
    const ey = b.y - (dy / len) * b.r;
    return "M" + sx + "," + sy + " L" + ex + "," + ey;
  }

  let t1 = null, t2 = null, t3 = null, t4 = null;
  let layer = null;
  let cutPaths = [];
  let placePaths = [];

  // Spawn the overlay layer + cut bridges immediately. Phase 1 just
  // holds them visible (each in its before-edge style) before retract.
  const svg = viz.svg;
  if (svg) {
    layer = svg.insert("g", "g.viz-nodes")
      .attr("class", "rewire-bridge-anim")
      .attr("pointer-events", "none");
    cuts.forEach((c, k) => {
      const s = cutStyles[k];
      const path = layer.append("path")
        .attr("d", bridgePath(c[0], c[1]))
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", s.width)
        .attr("stroke-dasharray", s.dashed ? "4 4" : null)
        .attr("stroke-linecap", "round")
        .attr("opacity", 1);
      cutPaths.push({ path, style: s });
    });
  }

  // PHASE 2a (RETRACT): cut bridges shrink via the same 4-value
  // stroke-dasharray attrTween spoke_layer uses on its rewind. For a
  // dashed (bad) edge we use a dashoffset retract so the dashes stay
  // visible; for a solid edge we use the stub-shrink dasharray. Both
  // techniques mirror spoke_layer.js's two retract paths verbatim.
  t1 = setTimeout(() => {
    cutPaths.forEach(({ path, style }) => {
      const node = path.node();
      const len = (node && node.getTotalLength) ? node.getTotalLength() : 100;
      const halfLen = len / 2;
      if (style.dashed) {
        // Dashed retract: dashoffset slides full dash pattern off the
        // path. Path length stays "0 → len" via dashoffset; the dashes
        // wear the bad-red appearance throughout.
        path
          .attr("stroke-dasharray", len + " " + len)
          .attr("stroke-dashoffset", 0)
          .transition("rewindBridge").duration(PHASE_RETRACT).ease(d3.easeCubicIn)
          .attr("stroke-dashoffset", len);
      } else {
        // Solid retract: 4-value stub-gap-stub-0 attrTween.
        path
          .attr("stroke-dashoffset", 0)
          .attr("stroke-dasharray", halfLen + " 0 " + halfLen + " 0")
          .transition("rewindBridge").duration(PHASE_RETRACT).ease(d3.easeCubicIn)
          .attrTween("stroke-dasharray", function () {
            return function (k2) {
              const stub = halfLen * (1 - k2);
              const gap = len - 2 * stub;
              return stub + " " + gap + " " + stub + " 0";
            };
          });
      }
    });
  }, PHASE1);

  // PHASE 2b (GROW, simultaneous): place bridges grow via the inverse.
  // Each bridge wears its after-edge's settled style throughout. No
  // build colour, no colorize — same as the cut retract: the bridge
  // already looks like the canonical edge. Grow technique matches
  // spoke_layer's renderBridge animate path.
  t2 = setTimeout(() => {
    if (!layer) return;
    cutPaths.forEach(({ path }) => path.remove());
    cutPaths = [];
    places.forEach((p, k) => {
      const s = placeStyles[k];
      const path = layer.append("path")
        .attr("d", bridgePath(p[0], p[1]))
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", s.width)
        .attr("stroke-linecap", "round")
        .attr("opacity", 1);
      const node = path.node();
      const len = (node && node.getTotalLength) ? node.getTotalLength() : 100;
      const halfLen = len / 2;
      if (s.dashed) {
        // Dashed grow: dashoffset slides dash pattern back onto path.
        path
          .attr("stroke-dasharray", len + " " + len)
          .attr("stroke-dashoffset", len)
          .transition("bridgeGrow").duration(PHASE_GROW).ease(d3.easeCubicOut)
          .attr("stroke-dashoffset", 0);
      } else {
        // Solid grow: stub grows 0 → halfLen.
        path
          .attr("stroke-dashoffset", 0)
          .attr("stroke-dasharray", "0 " + len + " 0 0")
          .transition("bridgeGrow").duration(PHASE_GROW).ease(d3.easeCubicOut)
          .attrTween("stroke-dasharray", function () {
            return function (k2) {
              const stub = halfLen * k2;
              const gap = len - 2 * stub;
              return stub + " " + gap + " " + stub + " 0";
            };
          });
      }
      placePaths.push(path);
    });
  }, PHASE1 + PHASE_RETRACT);

  // Phase 3: settle. Replace the bridge layer with the after-state
  // edges (which sit at exactly the same coords as the grown bridges)
  // and un-dim. The bridge layer fades out to mask any pixel seam.
  t4 = setTimeout(() => {
    viz.setEdges(after);
    if (viz.clearAllNodeClass) {
      viz.clearAllNodeClass("dim");
      viz.clearAllNodeClass("pick");
    }
    if (layer) {
      layer.transition().duration(PHASE3).attr("opacity", 0)
        .on("end", function () { layer.remove(); layer = null; });
    }
    settle();
  }, PHASE1 + PHASE_RETRACT + PHASE_GROW);

  return {
    cancel() {
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (t3) clearTimeout(t3);
      if (t4) clearTimeout(t4);
      if (layer) { layer.remove(); layer = null; }
      viz.setEdges(after);
      if (viz.clearAllNodeClass) {
        viz.clearAllNodeClass("dim");
        viz.clearAllNodeClass("pick");
        viz.clearAllNodeClass("swap-pick");
      }
    },
  };
}

// Spoke-style rewire-swap animator. Drop-in replacement for callers
// that want the SBM stub-matcher feel (spoke_layer.js phase shape) on
// a per-op rewire. Each cut bridge runs through the back-rewind (uncolor
// → retract → just-spoke fade-in → orbit to rest) and each new bridge
// runs through the forward grow (orbit from rest → bridge stubs grow
// → meet at midpoint → colorize). Stubs are conserved across the swap:
// the same stub at node u that was paired with v in a cut is the stub
// that pairs with the new partner in a place. The rest of the graph
// stays static (viz.setEdges keeps every non-affected edge at full
// opacity throughout).
//
// opts (mostly compatible with rewireSwapAnimate):
//   viz             : NETGEN.VIZ instance
//   cuts            : [[u, v], ...] in order
//   places          : [[u, v], ...] in order
//   before / after  : edge arrays for the settled state on either side
//                     (each entry { u, v, color, classes? }); used to
//                     read each cut's badness + canonical colour and to
//                     paint each new edge's settled colour.
//   four            : participant ids; viz dim/pick is applied by the
//                     caller for the duration of the animation
//   settle          : optional callback after the final commit frame
function rewireSpokeSwapAnimate(opts) {
  const { viz, cuts, places, before, after } = opts;
  const settle = opts.settle || function () {};
  // Phase durations. Match spoke_layer.js T defaults but trimmed so the
  // full sequence reads as one continuous swap, not four chained pulses.
  const T = {
    uncolor:      220,
    retract:      280,
    spokeFade:    160,
    orbitHold:    120,
    orbitFwd:     360,
    grow:         300,
    colorize:     220,
    fade:         140,
  };
  const SPOKE_LEN = 16;
  const BUILD_COLOR = "#1b2033";
  const BAD_COLOR = "#a92020";

  function nodeXY(id) {
    const n = viz.nodeById[String(id)];
    return n ? { x: n.x, y: n.y, r: (n.r || 13) } : { x: 0, y: 0, r: 13 };
  }
  function dirAngle(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x);
  }
  function shortDelta(a0, a1) {
    return Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
  }

  const cutKey = (a, b) => (String(a) < String(b) ? a + "|" + b : b + "|" + a);
  const beforeByKey = {};
  (before || []).forEach(e => { beforeByKey[cutKey(e.u, e.v)] = e; });
  const afterByKey = {};
  (after || []).forEach(e => { afterByKey[cutKey(e.u, e.v)] = e; });
  function isBadEdge(e) {
    if (!e) return false;
    const cls = e.classes || "";
    return cls.indexOf("cm-bad") >= 0 || cls.indexOf("pick") >= 0;
  }
  function styleFor(e) {
    return {
      color: (e && e.color) || "#1a3478",
      bad: isBadEdge(e),
    };
  }
  const cutMeta = (cuts || []).map(c => Object.assign({ u: c[0], v: c[1] }, styleFor(beforeByKey[cutKey(c[0], c[1])])));
  const placeMeta = (places || []).map(p => Object.assign({ u: p[0], v: p[1] }, styleFor(afterByKey[cutKey(p[0], p[1])])));

  // Stub graph: each cut endpoint is one stub. For self-loop cuts, both
  // stubs sit at the same node and use the loop-tangent angles. Stubs
  // are matched 1:1 with place endpoints (each place consumes 2 stubs:
  // one per endpoint). Greedy: walk places in order, take the first
  // unpaired stub at each endpoint.
  const LOOP_TANGENT_START = EdgePaths.LOOP_TANGENT_START;
  const LOOP_TANGENT_END   = EdgePaths.LOOP_TANGENT_END;
  const stubs = [];
  cutMeta.forEach((c, ci) => {
    if (c.u === c.v) {
      stubs.push({ node: c.u, oldPartner: c.u, oldEdge: ci, oldAngle: LOOP_TANGENT_START, paired: false });
      stubs.push({ node: c.v, oldPartner: c.v, oldEdge: ci, oldAngle: LOOP_TANGENT_END,   paired: false });
    } else {
      stubs.push({ node: c.u, oldPartner: c.v, oldEdge: ci, paired: false });
      stubs.push({ node: c.v, oldPartner: c.u, oldEdge: ci, paired: false });
    }
  });
  stubs.forEach(s => {
    if (s.oldAngle == null) {
      const me = nodeXY(s.node), other = nodeXY(s.oldPartner);
      s.oldAngle = dirAngle(me, other);
    }
    // Rest angle: rotate 90° outward from the cut direction so each
    // stub visibly leaves its old partner without snapping all stubs
    // to the same heading. The sign of the rotation is picked so that
    // stubs at the same node go to opposite sides when feasible (avoids
    // overlap on self-loops + close pairs).
    const sign = (s.oldEdge % 2 === 0) ? 1 : -1;
    s.restAngle = s.oldAngle + sign * Math.PI / 2;
    while (s.restAngle >  Math.PI) s.restAngle -= 2 * Math.PI;
    while (s.restAngle < -Math.PI) s.restAngle += 2 * Math.PI;
  });
  function takeStub(nodeId) {
    for (const s of stubs) {
      if (s.node === nodeId && !s.paired) { s.paired = true; return s; }
    }
    return null;
  }
  // Each place pairs 2 stubs. If a stub is missing (e.g. cuts and
  // places don't have matched cardinality), we synthesise a fresh one.
  const placePairs = placeMeta.map(p => {
    const s1 = takeStub(p.u) || { node: p.u, oldAngle: null, restAngle: null, _synth: true };
    const s2 = takeStub(p.v) || { node: p.v, oldAngle: null, restAngle: null, _synth: true };
    s1.newPartner = p.v; s1.newEdge = p;
    s2.newPartner = p.u; s2.newEdge = p;
    if (p.u === p.v) {
      // Self-loop place: both stubs sit at the same node. Aim them
      // along the loop tangents so the orbit ends with the two stubs
      // hugging the node above-left + above-right, exactly where a
      // selfLoopPath teardrop starts and ends.
      s1.newAngle = LOOP_TANGENT_START;
      s2.newAngle = LOOP_TANGENT_END;
    } else {
      const me1 = nodeXY(s1.node), part1 = nodeXY(s1.newPartner);
      const me2 = nodeXY(s2.node), part2 = nodeXY(s2.newPartner);
      s1.newAngle = dirAngle(me1, part1);
      s2.newAngle = dirAngle(me2, part2);
    }
    if (s1._synth) { s1.oldAngle = s1.newAngle; s1.restAngle = s1.newAngle + Math.PI / 2; }
    if (s2._synth) { s2.oldAngle = s2.newAngle; s2.restAngle = s2.newAngle + Math.PI / 2; }
    return { p, s1, s2 };
  });

  function spokeBase(s) {
    const me = nodeXY(s.node);
    return { x: me.x + Math.cos(s._currA) * me.r, y: me.y + Math.sin(s._currA) * me.r };
  }
  // Cap the stub so its tip cannot cross close to its partner's node
  // boundary. Without the cap, close-by node pairs end up with stubs
  // that poke past their partner's node, producing a visible jiggle
  // as the bridge grows underneath. Cap is the min over old + new
  // partners so it stays consistent through the orbit.
  function capForPartner(me, pid) {
    const partner = nodeXY(pid);
    const D = Math.hypot(partner.x - me.x, partner.y - me.y);
    // Stub tip lands exactly at the midpoint between the two boundaries
    // when partner is closer than 2 * SPOKE_LEN away, so a pair of
    // stubs across the bridge meets cleanly at the centre.
    return Math.max(2, Math.min(SPOKE_LEN, (D - me.r - partner.r) / 2));
  }
  function spokeEffectiveLen(s) {
    if (s._cachedEff != null) return s._cachedEff;
    const me = nodeXY(s.node);
    const oldCap = (s.oldPartner != null && s.oldPartner !== s.node) ? capForPartner(me, s.oldPartner) : SPOKE_LEN;
    const newCap = (s.newPartner != null && s.newPartner !== s.node) ? capForPartner(me, s.newPartner) : SPOKE_LEN;
    s._cachedEff = Math.min(oldCap, newCap);
    return s._cachedEff;
  }
  function spokeTip(s) {
    const me = nodeXY(s.node);
    const r = me.r + spokeEffectiveLen(s);
    return { x: me.x + Math.cos(s._currA) * r, y: me.y + Math.sin(s._currA) * r };
  }

  // Spawn the overlay layer. Layer order: cut bridges < stubs < new
  // bridges, all in front of the existing viz edges (still painted by
  // viz.setEdges) but behind the node group so node circles cover the
  // stub bases cleanly.
  const layer = viz.svg.insert("g", "g.viz-nodes")
    .attr("class", "rewire-spoke-anim")
    .attr("pointer-events", "none");
  const cutLayer   = layer.append("g").attr("class", "rs-cuts");
  const stubLayer  = layer.append("g").attr("class", "rs-stubs");
  const placeLayer = layer.append("g").attr("class", "rs-places");

  function straightBoundaryPath(uid, vid) {
    const a = nodeXY(uid), b = nodeXY(vid);
    return EdgePaths.makeEdge(a, b, a.r, b.r);
  }
  function placeBridgeViaStubs(s1, s2) {
    // Bridge endpoints anchor on the node boundary along the new-
    // partner aim. Stubs sit on top boundary-out; they fade during
    // grow so the bridge is anchored before the stubs disappear.
    const me1 = nodeXY(s1.node), me2 = nodeXY(s2.node);
    const a = { x: me1.x + Math.cos(s1._currA) * me1.r, y: me1.y + Math.sin(s1._currA) * me1.r };
    const b = { x: me2.x + Math.cos(s2._currA) * me2.r, y: me2.y + Math.sin(s2._currA) * me2.r };
    return "M" + a.x + "," + a.y + " L" + b.x + "," + b.y;
  }

  // Hide cut edges from viz so the overlay's cut bridges are the only
  // copy on screen; everything else stays painted by viz at full opacity
  // (no whole-graph dim). Mirrors rewireSwapAnimate's beforeMinusCuts.
  // Pages that own edges via a non-viz layer (e.g. spokeLayer in
  // matcher.html) pass manageEdges: false and handle hide / show
  // themselves via opts.onCutsHidden / opts.onPlacesShown hooks.
  const manageEdges = opts.manageEdges !== false;
  if (manageEdges && before) {
    const cutKeys = new Set((cuts || []).map(c => cutKey(c[0], c[1])));
    const beforeMinusCuts = before.filter(e => !cutKeys.has(cutKey(e.u, e.v)));
    viz.setEdges(beforeMinusCuts);
  }
  if (typeof opts.onCutsHidden === "function") opts.onCutsHidden();

  // Initial appearance: cut bridges painted at their before-style
  // (settled colour, dashed if bad). Stubs hidden until after retract.
  const cutSel = cutLayer.selectAll("path").data(cutMeta).enter().append("path")
    .attr("d", function (c) {
      const me = nodeXY(c.u);
      return c.u === c.v ? EdgePaths.makeSelfLoop(me, me.r) : straightBoundaryPath(c.u, c.v);
    })
    .attr("fill", "none")
    .attr("stroke", c => c.bad ? BAD_COLOR : c.color)
    .attr("stroke-width", 1.6)
    .attr("stroke-dasharray", c => c.bad ? "4 4" : null)
    .attr("stroke-linecap", "round");
  // Stubs start at their oldAngle; opacity 0 until just-fade.
  stubs.forEach(s => { s._currA = s.oldAngle; });
  const stubSel = stubLayer.selectAll("line").data(stubs).enter().append("line")
    .attr("class", "rs-stub")
    .attr("x1", s => spokeBase(s).x)
    .attr("y1", s => spokeBase(s).y)
    .attr("x2", s => spokeTip(s).x)
    .attr("y2", s => spokeTip(s).y)
    .attr("stroke", BUILD_COLOR)
    .attr("stroke-width", 2.4)
    .attr("stroke-linecap", "round")
    .attr("opacity", 0);

  const TIMERS = [];
  let cancelled = false;
  function later(ms, fn) {
    TIMERS.push(setTimeout(function () {
      if (cancelled) return;
      fn();
    }, ms));
  }

  // Phase 1 (uncolor): cut bridge → build colour, dash off, slight
  // thicken. Mirror spoke_layer.js's runRewind phase 1.
  cutSel.transition("uncolor").duration(T.uncolor).ease(d3.easeCubicInOut)
    .attr("stroke", BUILD_COLOR)
    .attr("stroke-dasharray", null)
    .attr("stroke-width", 2.6);

  // Phase 2 (retract): cut bridges shrink to their endpoints via the
  // 4-value stub-gap-stub dash pattern. Stubs fade in during the last
  // half of the retract so the visual handoff (bridge tip → spoke
  // tip) has no gap.
  later(T.uncolor, function () {
    BridgeAnim.retract(cutSel, { duration: T.retract });
    stubSel.transition("stubFade").delay(T.retract * 0.5).duration(T.spokeFade)
      .attr("opacity", 1);
  });

  // Phase 3 (orbit hold): stubs sit at oldAngle for a brief beat so the
  // viewer can read the decomposed state before the partner swing
  // starts. No actual tween, just dwell.
  later(T.uncolor + T.retract, function () {
    cutSel.transition("cutFade").duration(80).attr("opacity", 0).remove();
  });

  // Phase 4 (orbit-to-new): stubs swing in one continuous arc from
  // their old-partner aim straight to their new-partner aim. Picking a
  // synthetic "rest" mid-position landed stubs on arbitrary headings
  // that overlapped neighbouring nodes; a single fluid swing reads as
  // "stub keeps the same owner, partner changes" without that artifact.
  const tForward = T.uncolor + T.retract + T.orbitHold;
  later(tForward, function () {
    stubSel.transition("orbitFwd").duration(T.orbitFwd).ease(d3.easeCubicInOut)
      .attrTween("x1", function (s) {
        if (s.newAngle == null) return function () { return d3.select(this).attr("x1"); };
        const me = nodeXY(s.node);
        const start = s.oldAngle, delta = shortDelta(start, s.newAngle);
        return function (k) {
          s._currA = start + delta * k;
          return me.x + Math.cos(s._currA) * me.r;
        };
      })
      .attrTween("y1", function (s) {
        if (s.newAngle == null) return function () { return d3.select(this).attr("y1"); };
        const me = nodeXY(s.node);
        const start = s.oldAngle, delta = shortDelta(start, s.newAngle);
        return function (k) { return me.y + Math.sin(start + delta * k) * me.r; };
      })
      .attrTween("x2", function (s) {
        if (s.newAngle == null) return function () { return d3.select(this).attr("x2"); };
        const me = nodeXY(s.node);
        const start = s.oldAngle, delta = shortDelta(start, s.newAngle);
        const r = me.r + spokeEffectiveLen(s);
        return function (k) { return me.x + Math.cos(start + delta * k) * r; };
      })
      .attrTween("y2", function (s) {
        if (s.newAngle == null) return function () { return d3.select(this).attr("y2"); };
        const me = nodeXY(s.node);
        const start = s.oldAngle, delta = shortDelta(start, s.newAngle);
        const r = me.r + spokeEffectiveLen(s);
        return function (k) { return me.y + Math.sin(start + delta * k) * r; };
      });
  });

  // Phase 4.5 (spoke retract, self-loop place only): mirrors SBM's
  // spoke_layer self-loop sequence — orbit → spoke retract → grow.
  // The two stubs hugging the same node first shrink length to zero
  // and fade out, then the loop teardrop emerges from the node
  // centre. Without this, both spokes stay visible while the loop
  // grows over them and reads as a chord through the node.
  const SPOKE_RETRACT_MS = 200;
  const loopStubs = new Set();
  placePairs.forEach(function (pp) {
    if (pp.s1.node === pp.s2.node) { loopStubs.add(pp.s1); loopStubs.add(pp.s2); }
  });
  const hasLoopPlace = loopStubs.size > 0;
  const tRetract = tForward + T.orbitFwd;
  if (hasLoopPlace) {
    later(tRetract, function () {
      stubSel.filter(function (s) { return loopStubs.has(s); })
        .interrupt("stubOut")
        .transition("loopRetract").duration(SPOKE_RETRACT_MS).ease(d3.easeCubicIn)
        .attr("x2", function () { return d3.select(this).attr("x1"); })
        .attr("y2", function () { return d3.select(this).attr("y1"); })
        .attr("opacity", 0)
        .remove();
    });
  }

  // Phase 5 (bridge grow): for each place, draw a path between its two
  // stub-tips and animate the same 4-value stub-gap-stub pattern in
  // reverse (mirror of retract). Stubs fade out as the bridge stitches
  // them together — the spoke tip becomes the bridge endpoint.
  const tGrow = tRetract + (hasLoopPlace ? SPOKE_RETRACT_MS : 0);
  function appendBridgePath(d) {
    return placeLayer.append("path")
      .attr("d", d)
      .attr("fill", "none")
      .attr("stroke", BUILD_COLOR)
      .attr("stroke-width", 2.6)
      .attr("stroke-linecap", "round");
  }
  later(tGrow, function () {
    placePairs.forEach(function (pp) {
      const isLoop = pp.s1.node === pp.s2.node;
      if (isLoop) {
        const me = nodeXY(pp.s1.node);
        pp._paths = [-1, +1].map(function (side) {
          return appendBridgePath(EdgePaths.makeSelfLoopHalf(me, me.r, side));
        });
        pp._paths.forEach(function (p) { BridgeAnim.grow(p, { isLoop: true, duration: T.grow }); });
      } else {
        const path = appendBridgePath(placeBridgeViaStubs(pp.s1, pp.s2));
        BridgeAnim.grow(path, { isLoop: false, duration: T.grow });
        pp._paths = [path];
      }
    });
    // Non-loop stubs fade across grow so they hand off to the bridge.
    // Self-loop stubs were already retracted + removed in phase 4.5.
    stubSel.filter(function (s) { return !loopStubs.has(s); })
      .transition("stubOut").duration(T.grow).ease(d3.easeCubicInOut)
      .attr("opacity", 0)
      .remove();
  });

  // Phase 6 (colorize): newly grown bridges crossfade to settled style
  // AND tween their endpoints from stub-tip (r0 + SPOKE_LEN) to node
  // boundary (r0). The grow phase paints the bridge from stub-tip to
  // stub-tip so the handoff from spoke to bridge has no seam, but that
  // leaves a visible SPOKE_LEN gap between the bridge end and the node
  // circle once the spokes have faded. Snapping endpoints down to the
  // boundary here lands the overlay on the same coords viz.setEdges
  // (or spokeLayer.placedPath) will paint at commit, so no jump.
  const tColor = tGrow + T.grow;
  later(tColor, function () {
    placePairs.forEach(function (pp) {
      const paths = pp._paths || [];
      if (!paths.length) return;
      const isLoop = pp.p.u === pp.p.v;
      const finalColor = pp.p.bad ? BAD_COLOR : pp.p.color;
      paths.forEach(function (path) {
        const t = BridgeAnim.colorize(path, {
          duration: T.colorize, color: finalColor, bad: pp.p.bad,
        });
        if (!isLoop) {
          const fromD = placeBridgeViaStubs(pp.s1, pp.s2);
          const toD = straightBoundaryPath(pp.p.u, pp.p.v);
          t.attrTween("d", function () { return d3.interpolateString(fromD, toD); });
        }
      });
    });
  });

  // Phase 7 (commit): viz takes ownership in the same frame the
  // overlay disappears. Crossfading the overlay down would blend with
  // viz's CSS opacity 0.82 and read as a dim flash; popping the
  // overlay synchronously instead hands off cleanly.
  const tCommit = tColor + T.colorize;
  later(tCommit, function () {
    if (manageEdges && after) viz.setEdges(after);
    if (typeof opts.onPlacesShown === "function") opts.onPlacesShown();
    layer.remove();
    settle();
  });

  return {
    cancel: function () {
      cancelled = true;
      TIMERS.forEach(function (id) { clearTimeout(id); });
      TIMERS.length = 0;
      try { layer.remove(); } catch (e) {}
    },
  };
}

// Static-state fallback for runRewireOpStep: replace the canvas edges
// + dim every node except `four`. Pages pass their own clearDimPick /
// dimAllExcept since those wrap viz-instance helpers per stage.
function dimSettleFallback(viz, clearDimPick, dimAllExcept) {
  return function (edges, four) {
    viz.setEdges(edges);
    clearDimPick(viz);
    if (four && four.length) dimAllExcept(viz, four);
  };
}

// Default fourFor: collect node ids from the standard four pair fields.
function fourFromOp(op) {
  const f = new Set();
  [op && op.p1, op && op.p2, op && op.newp1, op && op.newp2].forEach(p => {
    if (p) { f.add(p[0]); f.add(p[1]); }
  });
  return [...f];
}

// Per-op rewire walker driver. Forward (step === lastStep+1) plays the
// 2-opt swap via rewireSpokeSwapAnimate; backward (step === lastStep-1)
// plays the same animation with cuts + places swapped; everything else
// settles to the static state via fallback().
//
// Pre-cancels any in-flight prevTimer so consecutive clicks don't stack
// overlays. placesFor must already filter partial-success ops (e.g.
// via op.placedNewp1) so the helper can rely on places.length > 0.
//
// Returns the new settle-timer handle (or null if no animation ran).
// Caller stores it and passes it back as opts.prevTimer next time.
function runRewireOpStep(opts) {
  const {
    viz, step, lastStep, ops, buildEdges, cutsFor, placesFor,
    setLock, prevTimer,
  } = opts;
  const fourFor = opts.fourFor || fourFromOp;
  const fallback = opts.fallback || function () {};
  if (prevTimer) prevTimer.cancel();
  function play(beforeIdx, afterIdx, cuts, places, op) {
    const four = fourFor(op);
    setLock(true);
    return NETGEN.rewireSpokeSwapAnimate({
      viz,
      before: buildEdges(beforeIdx),
      after: buildEdges(afterIdx),
      cuts, places, four,
      settle: function () { setLock(false); },
    });
  }
  const fwdOp = step > 0 ? ops[step - 1] : null;
  const fwdPlaces = (step === lastStep + 1 && fwdOp && fwdOp.success) ? placesFor(fwdOp) : null;
  if (fwdPlaces && fwdPlaces.length > 0) {
    return play(step - 1, step, cutsFor(fwdOp), fwdPlaces, fwdOp);
  }
  const undone = (step === lastStep - 1 && lastStep > 0) ? ops[lastStep - 1] : null;
  const undonePlaces = (undone && undone.success) ? placesFor(undone) : null;
  if (undonePlaces && undonePlaces.length > 0) {
    return play(lastStep, step, undonePlaces, cutsFor(undone), undone);
  }
  fallback(buildEdges(step), fwdOp ? fourFor(fwdOp) : []);
  return null;
}

// MathJax retypeset on a single element or list. No-op if MathJax not loaded.
function retypeset(target) {
  if (!(window.MathJax && window.MathJax.typesetPromise)) return;
  const list = Array.isArray(target) ? target : [target];
  window.MathJax.typesetPromise(list).catch(function () {});
}

// Bidirectional row↔node hover linkage. Each row child of `gBars` carries
// a [data-id] attribute matching a viz node id; hovering either side
// toggles the row's `.hot` class and the node's `.ringed` viz class.
function bindRowNodeHover(gBars, viz, opts) {
  const sel = (opts && opts.rowSelector) || ".deg-bar-row";
  const attr = (opts && opts.idAttr) || "data-id";
  function setRowHot(id, on) {
    gBars.select(sel + "[" + attr + '="' + id + '"]').classed("hot", on);
  }
  gBars.on("mouseover", function (ev) {
    const el = ev.target.closest(sel);
    if (!el) return;
    const id = el.getAttribute(attr);
    setRowHot(id, true);
    viz.addNodeClass(id, "ringed");
  });
  gBars.on("mouseout", function (ev) {
    const el = ev.target.closest(sel);
    if (!el) return;
    const id = el.getAttribute(attr);
    setRowHot(id, false);
    viz.removeNodeClass(id, "ringed");
  });
  viz.onNodeHoverEnter(function (d) { setRowHot(d.id, true); viz.addNodeClass(d.id, "ringed"); });
  viz.onNodeHoverLeave(function (d) { setRowHot(d.id, false); viz.removeNodeClass(d.id, "ringed"); });
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
  fitViewBoxAttr,
  retypeset,
  bindRowNodeHover,
  rewireSwapAnimate,
  rewireSpokeSwapAnimate,
  runRewireOpStep,
  fourFromOp,
  dimSettleFallback,
  EdgePaths,
  BridgeAnim,
};

})(window);
