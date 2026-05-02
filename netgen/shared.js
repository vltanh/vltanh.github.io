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
  1:  {x: -186, y: -148},
  2:  {x: -123, y: -229},
  3:  {x: -299, y: -165},
  4:  {x: -146, y: -364},
  5:  {x:   28, y: -205},
  6:  {x:  108, y: -262},
  7:  {x:  -89, y: -160},
  8:  {x:   26, y: -329},
  // C2 (bottom-right, 6 nodes): K_4 on {9,10,11,12} as a square,
  // 13 hangs off (9,12), 14 off (10,11) on opposite diagonals.
  9:  {x:  183, y:   49},
  10: {x:  285, y:   78},
  11: {x:  201, y:  184},
  12: {x:  346, y:   38},
  13: {x:  306, y:  220},
  14: {x:  202, y:  252},
  // C3 (bottom-left, 4 nodes): triangle {15,16,17}, leaf 18 off 16.
  15: {x: -255, y:  135},
  17: {x: -352, y:  171},
  16: {x: -218, y:  205},
  18: {x: -132, y:  260},
  // Outliers in the middle, pulled off the C2 axis so they don't
  // read as a continuation of the 9-12-13 line.
  19: {x: -117, y:   30},
  20: {x:   57, y:  -18},
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
  C1: "#7b9bd6", C2: "#e0a649", C3: "#8fbb70", OUT: "#9e7ec4",
  edge_intra: {C1:"#3559a0", C2:"#b4741d", C3:"#4e7a3a", OUT:"#7d5da2"},
  // Distinct hues for size-1 singleton clusters under outlier_mode=
  // singleton (npso, abcd, lfr). Index by appearance order.
  outlier_palette: ["#9e7ec4", "#6fa6b0", "#c49a6c", "#78a06f"],
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
// spoke_layer (SBM stub-matcher + every rewire walker) paints bridges
// using a shared SVG dasharray choreography. Three primitives keep the
// grow / retract / colorize phases consistent across every caller:
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
    // Settled bad edges (collisions) render solid red — dedup is the
    // step that flips them to dashed (see sbm dedup viz).
    const t = pathSel.transition(tName).duration(duration);
    if (ease) t.ease(ease);
    t.attr("stroke", finalColor)
      .attr("stroke-width", finalWidth)
      .attr("stroke-dasharray", null);
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
    const fitOpts = {
      positions: opts.positions || POSITIONS,
      includeIds: opts.includeOutliers === false
        ? NODES.filter(n => CLUSTER_OF[n] !== "OUT")
        : NODES,
      pad: opts.pad,
      padRight: opts.padRight,
    };
    if (opts.svg) {
      svg = opts.svg;
      host = svg.node().parentElement;
    } else {
      host = document.getElementById(containerId);
      if (!host) return null;
      host.innerHTML = "";
      svg = d3.select(host).append("svg")
        .attr("class", "viz-svg")
        .attr("viewBox", fitViewBoxAttr(fitOpts))
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
    // animated: enter/exit fades for nodes + edges; node fill/r updates
    // tween instead of snap; pair with handle.animateNodesToHome for
    // tweened position changes when caller mutates homeX/homeY.
    // The first draw runs without animation so the initial state lands
    // instantly (useful when callers immediately set classes like .future
    // that would otherwise fight the enter fade).
    const animated = !!opts.animated;
    const animDur  = (typeof opts.animDur === "number") ? opts.animDur : 320;
    // animateInitial: include the very first draw in the animation gate.
    // Off by default so callers that synchronously stamp .future (or
    // similar hide-classes) right after init don't flicker through a
    // visible enter ramp before the class lands.
    const animateFirst = !!opts.animateInitial;
    let drewOnce = false;
    // Per-call enter pacing for the next draw triggered by setEdges /
    // addEdges. setEdges({ enterDelay, enterStagger, enterFromId }) lets
    // a caller hold newly-entering edges off for a beat, stagger them,
    // and grow each one as a stroke from a specified endpoint instead of
    // a flat opacity fade. enterFromId picks which endpoint anchors the
    // grow: edges where source.id === enterFromId grow forward (from
    // path start), edges where target.id === enterFromId grow reversed
    // (from path end). Other edges fall back to opacity fade.
    let nextEnterDelay = 0;
    let nextEnterStagger = 0;
    let nextEnterFromId = null;
    // Mirror knobs for exits: edges leaving the link set can retract
    // their stroke toward a designated endpoint instead of fading. Pair
    // exitFromId with the same id as enterFromId on a reroll to get the
    // "old picks pull back into the arrival, then new picks sprout out"
    // sequence. exitStagger lets the retract march one edge at a time.
    let nextExitDelay = 0;
    let nextExitStagger = 0;
    let nextExitFromId = null;
    let nextEnterDur = 0;
    let nextExitDur = 0;

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
          cls: opts.nodeClass ? (opts.nodeClass(id) || "") : "",
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
        // Per-edge anchor for grow/retract animations. When set, both
        // enter (grow) and exit (retract) collapse the far endpoint
        // toward this id. Lets a single setEdges call animate many
        // edges concurrently, each anchored to a different node — e.g.
        // a multi-arrival "To End" jump in impl3 where every new
        // arrival's m edges sprout from its own arrival end.
        anchorId: e.anchorId != null ? String(e.anchorId) : null,
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
    // Pinned layouts (every nPSO disk, every gen page that snaps nodes
    // to a fixed POSITIONS map) override fx/fy so charge / collide /
    // clusterRepel produce zero motion — running them costs O(n²) per
    // tick for nothing. Drop them entirely and keep the sim parked at
    // alpha 0; we drive paint manually via paint() and a one-shot
    // sim.tick() / direct attr writes.
    const sim = d3.forceSimulation(nodesData);
    // Pinned sims park at alpha=0 with the timer stopped, so the d3
    // dispatcher never fires "tick.*" listeners. Overlay layers (spoke
    // layer, mountBlockGraph's block rects, etc.) bind to "tick.<name>"
    // and would freeze on drag without a synchronous fan-out hook.
    // Wrap sim.on so every named tick subscription is recorded; the
    // pinned drag handler invokes the recorded callbacks after each
    // paint() so overlays follow the dragged node.
    const _tickNames = new Set();
    const _origOn = sim.on.bind(sim);
    sim.on = function (typename, callback) {
      if (arguments.length >= 2 && typeof typename === "string") {
        typename.split(/\s+/).forEach(function (tn) {
          const m = /^tick\.(.+)$/.exec(tn);
          if (!m) return;
          if (callback == null) _tickNames.delete(m[1]);
          else _tickNames.add(m[1]);
        });
      }
      return _origOn.apply(sim, arguments);
    };
    function fireTickOverlays() {
      _tickNames.forEach(function (name) {
        const fn = _origOn("tick." + name);
        if (fn) fn.call(sim, sim);
      });
    }
    if (pinned) {
      sim.alpha(0).alphaDecay(1).alphaMin(1).stop();
    } else {
      sim
        .force("link",    d3.forceLink([]).id(d => d.id).distance(55).strength(0.12))
        .force("charge",  d3.forceManyBody().strength(-45))
        .force("collide", d3.forceCollide(16))
        .force("x",       d3.forceX(d => d.homeX).strength(0.22))
        .force("y",       d3.forceY(d => d.homeY).strength(0.22))
        .force("clusterRepel", clusterRepel)
        .alpha(0.35).alphaDecay(0.04);
    }
    function bumpSim(a) {
      // Wakes the sim only when there are actual forces to run; pinned
      // sims paint manually via paint() instead.
      if (!pinned) sim.alpha(a == null ? 0.3 : a).restart();
    }

    function classStr(base, extra) { return extra ? (base + " " + extra).trim() : base; }

    function deferUntilVisible(fn) {
      if (!host || typeof IntersectionObserver === "undefined") { fn(); return; }
      // Fire only once the host is comfortably within the viewport (top
      // edge has crossed past 20% from the top). At page load every disk
      // below the fold is off-screen, so the animation waits for the
      // user to actually scroll near it; a partially visible panel still
      // gets held off so the user catches the start of the fade.
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const rect = host.getBoundingClientRect();
      const enterMargin = vh * 0.2;
      if (rect.top < vh - enterMargin && rect.bottom > enterMargin && rect.width > 0) {
        requestAnimationFrame(fn);
        return;
      }
      const obs = new IntersectionObserver((es) => {
        if (es.some(e => e.isIntersecting)) { obs.disconnect(); fn(); }
      }, { threshold: 0.35 });
      obs.observe(host);
    }

    function draw() {
      computeDupIndices();
      const isFirstDraw = !drewOnce;
      const useAnim = animated && (drewOnce || animateFirst);
      drewOnce = true;
      const enterRunners = [];
      const linkSel = gLinks.selectAll("path.viz-edge").data(links, d => d.id);
      const linkExit = linkSel.exit();
      if (useAnim) {
        const xd = nextExitDelay, xs = nextExitStagger, xFromIdFallback = nextExitFromId;
        const xDur = nextExitDur > 0 ? nextExitDur : animDur;
        linkExit.style("pointer-events", "none");
        linkExit.each(function (d, i) {
          const node = this;
          let fromSrc = null;
          // Per-edge anchorId wins over the call-wide fallback so a
          // single setEdges call can retract many edges, each toward
          // its own anchor.
          const xFromId = d.anchorId != null ? d.anchorId : xFromIdFallback;
          if (xFromId != null) {
            if (String(d.source.id) === String(xFromId)) fromSrc = true;
            else if (String(d.target.id) === String(xFromId)) fromSrc = false;
          }
          const sel = d3.select(node);
          const tr = sel.transition("vizLinkExit")
            .delay(xd + xs * i)
            .duration(xDur)
            .ease(d3.easeCubicInOut);
          if (fromSrc === null) {
            tr.style("opacity", 0).remove();
          } else {
            // Path-shrink retract: collapse the far endpoint toward
            // fromId. Endpoints are clipped to the node circle borders
            // via clampedBoundaryEdge so the stroke never crosses the
            // node interior — that's what made edges visible inside
            // low-opacity (.future) nodes mid-retract. The clamp scales
            // r1, r2 down by Lraw / (r1+r2) when the lerped distance
            // is shorter than r1+r2 so the offsets never invert.
            tr.attrTween("d", function () {
              const sx0 = d.source.x, sy0 = d.source.y;
              const ex0 = d.target.x, ey0 = d.target.y;
              const r1 = (d.source && d.source.r) || nodeR;
              const r2 = (d.target && d.target.r) || nodeR;
              return function (k) {
                let sx, sy, ex, ey;
                if (fromSrc) {
                  sx = sx0; sy = sy0;
                  ex = sx0 + (ex0 - sx0) * (1 - k);
                  ey = sy0 + (ey0 - sy0) * (1 - k);
                } else {
                  ex = ex0; ey = ey0;
                  sx = ex0 + (sx0 - ex0) * (1 - k);
                  sy = ey0 + (sy0 - ey0) * (1 - k);
                }
                return clampedBoundaryEdge(sx, sy, ex, ey, r1, r2);
              };
            }).remove();
          }
        });
      } else {
        linkExit.remove();
      }
      const linkEnter = linkSel.enter().append("path")
        .attr("class", d => classStr("viz-edge", d.cls))
        .attr("fill", "none")
        .attr("stroke", d => d.color)
        .attr("stroke-width", d => d.w)
        .style("cursor", "pointer")
        .on("click",      function (ev, d) { if (onEdgeTap) onEdgeTap(d, ev); })
        .on("mouseenter", function (ev, d) { if (onEdgeEnter) onEdgeEnter(d, ev); })
        .on("mouseleave", function (ev, d) { if (onEdgeLeave) onEdgeLeave(d, ev); });
      if (useAnim) {
        linkEnter.style("opacity", 0);
        const ed = nextEnterDelay, es = nextEnterStagger, fromIdFallback = nextEnterFromId;
        const eDur = nextEnterDur > 0 ? nextEnterDur : animDur;
        enterRunners.push(() => {
          linkEnter.each(function (d, i) {
            const node = this;
            let fromSrc = null;
            const fromId = d.anchorId != null ? d.anchorId : fromIdFallback;
            if (fromId != null) {
              if (String(d.source.id) === String(fromId)) fromSrc = true;
              else if (String(d.target.id) === String(fromId)) fromSrc = false;
            }
            const sel = d3.select(node);
            const tr = sel.transition("vizLinkEnter")
              .delay(ed + es * i)
              .duration(eDur)
              .ease(d3.easeCubicOut);
            if (fromSrc === null) {
              tr.style("opacity", 1)
                .on("end", function () { d3.select(this).style("opacity", null); });
            } else {
              // Path-extend grow, mirror of the path-shrink retract.
              // Endpoints clipped to node circle borders via
              // clampedBoundaryEdge — same reason as the retract path:
              // a raw centre-to-centre stroke shows through low-opacity
              // (.future) nodes during the grow.
              tr.attrTween("d", function () {
                const sx0 = d.source.x, sy0 = d.source.y;
                const ex0 = d.target.x, ey0 = d.target.y;
                const r1 = (d.source && d.source.r) || nodeR;
                const r2 = (d.target && d.target.r) || nodeR;
                d3.select(node).style("opacity", null);
                return function (k) {
                  let sx, sy, ex, ey;
                  if (fromSrc) {
                    sx = sx0; sy = sy0;
                    ex = sx0 + (ex0 - sx0) * k;
                    ey = sy0 + (ey0 - sy0) * k;
                  } else {
                    ex = ex0; ey = ey0;
                    sx = ex0 + (sx0 - ex0) * k;
                    sy = ey0 + (sy0 - ey0) * k;
                  }
                  return clampedBoundaryEdge(sx, sy, ex, ey, r1, r2);
                };
              })
              .on("end", function () {
                this.setAttribute("d", edgePath(d));
                d3.select(this).style("opacity", null);
              });
            }
          });
        });
      }
      linkEnter.merge(linkSel)
        .attr("class", d => classStr("viz-edge", d.cls))
        .attr("stroke", d => d.color)
        .attr("stroke-width", d => d.w);

      const groupSel = gNodes.selectAll("g.viz-node-group").data(nodesData, d => d.id);
      const groupExit = groupSel.exit();
      if (useAnim) {
        groupExit.style("pointer-events", "none")
          .transition("vizGroupExit").duration(animDur)
          .style("opacity", 0)
          .remove();
      } else {
        groupExit.remove();
      }
      // Set the initial inline opacity at element-creation time so the
      // CSS `transition: opacity` rule on `.viz-node-group` does NOT
      // fire on first mount: setting style.opacity = "0" *after*
      // append + class assignment counts as a property change and the
      // browser tweens 1 → 0 (visible flash-then-fade-back). Pre-setting
      // it inside the append factory locks the initial computed value
      // to 0 and the CSS transition stays silent.
      // Initial opacity is governed by a class set at element-creation
      // time (`.viz-hidden`). Setting via class — not inline style —
      // means the very first computed opacity is 0 from the first paint;
      // when we later remove the class the CSS transition rule fires
      // cleanly from 0 → 1. Pre-setting via inline style instead led to
      // a perceptible 1→0 flash on first mount in some browsers.
      const groupEnter = groupSel.enter().append(useAnim
        ? function () {
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("class", "viz-node-group viz-hidden");
            return g;
          }
        : function () {
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("class", "viz-node-group");
            return g;
          });
      groupEnter.append("circle")
        .attr("class", d => classStr("viz-node", d.cls))
        .attr("r", d => useAnim ? 0 : d.r)
        .attr("fill", d => d.color)
        .attr("stroke", "#1b2033")
        .attr("stroke-width", 1.5)
        .style("cursor", "grab")
        .call(d3.drag()
          .on("start", function (ev, d) {
            if (!ev.active && !pinned) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
            d3.select(this).interrupt("snapback").style("cursor", "grabbing");
          })
          .on("drag",  function (ev, d) {
            d.fx = ev.x; d.fy = ev.y;
            if (pinned) {
              d.x = ev.x; d.y = ev.y;
              paint();
              // sim.tick() advances state but does NOT dispatch the
              // "tick" event (d3-force only dispatches from the timer
              // step). Pinned sims have the timer stopped, so we fan
              // out to every recorded "tick.<name>" listener manually.
              fireTickOverlays();
            }
          })
          .on("end",   function (ev, d) {
            if (!ev.active && !pinned) sim.alphaTarget(0);
            d3.select(this).style("cursor", "grab");
            if (pinned) {
              const sx = d.fx, sy = d.fy, ex = d.homeX, ey = d.homeY;
              d3.select(this)
                .transition("snapback").duration(420)
                .tween("snap", () => (t) => {
                  d.fx = sx + (ex - sx) * t;
                  d.fy = sy + (ey - sy) * t;
                  d.x  = d.fx; d.y = d.fy;
                  paint();
                  fireTickOverlays();
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
      const circles = groups.select("circle.viz-node")
        .attr("class", d => classStr("viz-node", d.cls));
      // Cache DOM refs on each datum so paint() can iterate without
      // repeated selectAll queries. Rebuilt on every draw so enter/exit
      // refs stay in sync.
      groups.each(function (d) {
        d.__group = this;
        // Always select by class — pages may insert halo circles as the
        // group's first child (fd-heat does this), so a firstChild
        // shortcut would cache the halo as the viz-node circle and
        // paint() would write cx/cy to the wrong element.
        d.__circle = this.querySelector("circle.viz-node");
        if (showLabels) d.__label = this.querySelector("text.viz-label");
      });
      linkEnter.merge(linkSel).each(function (d) { d.__path = this; });
      if (useAnim) {
        // Fade-in is CSS-driven: removing .viz-hidden lets the
        // .viz-node-group transition rule tween opacity 0 → 1 over its
        // own duration. The circle radius tween is also delegated to the
        // CSS `transition: r .22s ease` rule on .viz-node — setting r
        // via attr triggers the CSS transition automatically.
        enterRunners.push(() => {
          groupEnter.each(function () { this.classList.remove("viz-hidden"); });
          circles.attr("fill", d => d.color).attr("r", d => d.r);
        });
      } else {
        circles
          .attr("fill", d => d.color)
          .attr("r", d => d.r);
      }
      if (showLabels) {
        groups.select("text.viz-label").text(labelTextFn);
      }

      if (!pinned) {
        sim.force("link").links(links);
        sim.alpha(0.3).restart();
      } else {
        // Pinned layouts repaint exactly once per draw — no force ticks
        // are running so the path/circle attrs would otherwise stay stale
        // after a setEdges or class change.
        paint();
      }
      // Paint order is set by initial DOM append: decorations (added by
      // page before VIZ.init) → gLinks → gNodes → page overlays. We do
      // NOT lower/raise here — that would move gLinks before any layers
      // the page appended (e.g. fd-heat's heat-cell layer) and bury
      // edges under them.

      // First-draw enters fire only when host enters the viewport. Page
      // load runs every disk's draw synchronously, so without this the
      // 320 ms transitions on below-the-fold disks complete before the
      // user scrolls to them.
      if (enterRunners.length) {
        if (isFirstDraw && animateFirst) {
          deferUntilVisible(() => enterRunners.forEach(fn => fn()));
        } else {
          enterRunners.forEach(fn => fn());
        }
      }
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
    // Straight edge clipped to node circle borders, with offsets that
    // shrink proportionally when the raw distance is shorter than
    // r1+r2. The plain makeEdge formula (sx = p1 + r1·û, ex = p2 − r2·û)
    // inverts in that regime — start ends up past target, end ends up
    // before source — which the user sees as a tiny mis-oriented stub
    // stuck inside the anchor node during retract / grow tweens.
    function clampedBoundaryEdge(sx, sy, ex, ey, r1, r2) {
      const dx = ex - sx, dy = ey - sy;
      const Lraw = Math.hypot(dx, dy);
      if (Lraw < 1e-3) return "M" + sx + "," + sy;
      const ux = dx / Lraw, uy = dy / Lraw;
      const totalR = r1 + r2;
      const k = totalR > 0 && Lraw < totalR ? Lraw / totalR : 1;
      const off1 = r1 * k, off2 = r2 * k;
      const psx = sx + ux * off1, psy = sy + uy * off1;
      const pex = ex - ux * off2, pey = ey - uy * off2;
      return "M" + psx + "," + psy + " L" + pex + "," + pey;
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
    // Hot path: paint() is called every animation frame by
    // animateNodesToHome's rAF loop, with up to four disks running
    // concurrently. Direct iteration over the cached link / node data
    // arrays + DOM refs (populated in draw()) avoids the per-frame
    // selectAll + each + multi-name d3.active overhead. The transition
    // skip uses d3's internal `__transition` map: any pending/running
    // schedule on a path means a tween already owns the `d` attribute,
    // so paint defers.
    function paint() {
      for (let i = 0; i < links.length; i++) {
        const l = links[i];
        const path = l.__path;
        if (!path) continue;
        if (path.__transition) continue;
        path.setAttribute("d", edgePath(l));
      }
      for (let i = 0; i < nodesData.length; i++) {
        const n = nodesData[i];
        if (n.__circle) {
          n.__circle.setAttribute("cx", n.x);
          n.__circle.setAttribute("cy", n.y);
        }
        if (showLabels && n.__label) {
          n.__label.setAttribute("x", n.x);
          n.__label.setAttribute("y", n.y);
        }
      }
    }
    sim.on("tick", paint);

    // Initial edges
    (opts.edges || []).forEach((e, i) => {
      const l = normEdge(e, i);
      if (l) links.push(l);
    });
    draw();

    const handle = {
      svg, sim, nodesData, links, nodeById,

      // Force a draw without piping data through setEdges. Used by
      // callers that mutated cls/r in-place via eachNode and need the
      // circle/edge attrs to flush.
      redraw() { draw(); },

      setEdges(edges, edgeOpts) {
        const onSettled = edgeOpts && edgeOpts.onSettled;
        if (edgeOpts) {
          nextEnterDelay    = edgeOpts.enterDelay    || 0;
          nextEnterStagger  = edgeOpts.enterStagger  || 0;
          nextEnterFromId   = edgeOpts.enterFromId   != null ? edgeOpts.enterFromId : null;
          nextEnterDur      = edgeOpts.enterDur      || 0;
          nextExitDelay     = edgeOpts.exitDelay     || 0;
          nextExitStagger   = edgeOpts.exitStagger   || 0;
          nextExitFromId    = edgeOpts.exitFromId    != null ? edgeOpts.exitFromId : null;
          nextExitDur       = edgeOpts.exitDur       || 0;
        }
        links.length = 0;
        (edges || []).forEach((e, i) => { const l = normEdge(e, i); if (l) links.push(l); });
        draw();
        nextEnterDelay = 0;
        nextEnterStagger = 0;
        nextEnterFromId = null;
        nextEnterDur = 0;
        nextExitDelay = 0;
        nextExitStagger = 0;
        nextExitFromId = null;
        nextExitDur = 0;
        if (onSettled) {
          // rAF-poll d3's per-element __transition map: empty on every
          // path means every queued enter / exit transition has finished
          // (or was never scheduled). Fires the callback exactly when
          // the edge layer is settled, so callers can chain "A then B
          // then C" without computing hand-rolled timing budgets.
          const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
          const tick = () => {
            const paths = gLinks.selectAll("path.viz-edge").nodes();
            let pending = false;
            for (let i = 0; i < paths.length; i++) {
              if (paths[i].__transition) { pending = true; break; }
            }
            if (!pending) { onSettled(); return; }
            // Safety fuse: 30 s of un-cleared __transition is broken.
            const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
            if (now - start > 30000) { onSettled(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      addEdges(edges, edgeOpts) {
        if (edgeOpts) {
          nextEnterDelay    = edgeOpts.enterDelay    || 0;
          nextEnterStagger  = edgeOpts.enterStagger  || 0;
          nextEnterFromId   = edgeOpts.enterFromId   != null ? edgeOpts.enterFromId : null;
        }
        (edges || []).forEach((e, i) => { const l = normEdge(e, links.length + i); if (l) links.push(l); });
        draw();
        nextEnterDelay = 0;
        nextEnterStagger = 0;
        nextEnterFromId = null;
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

      // Snap fx/fy/x/y to (homeX, homeY) for every node. For first mount
      // and on jumps (e.g., re-embedding) where a tween isn't meaningful.
      snapNodesToHome() {
        nodesData.forEach(n => {
          if (n.fx != null) n.fx = n.homeX;
          if (n.fy != null) n.fy = n.homeY;
          n.x = n.homeX; n.y = n.homeY;
        });
        if (pinned) paint();
        else sim.alpha(0.05);
      },

      // Tween fx/fy from current to (homeX, homeY) for every node whose
      // home was repointed by the caller. Pair with edits like
      //   nodesData.forEach(n => { n.homeX = ...; n.homeY = ...; });
      //   viz.animateNodesToHome();
      // For pinned layouts; for free-running sims this still tweens the
      // pin but the sim will release fx/fy on its own forces afterwards.
      // opts.polar = true: interpolate in (r, θ) about the origin instead
      // of cartesian, so a same-radius move orbits at constant r rather
      // than cutting a chord through the disk centre.
      animateNodesToHome(arg) {
        let dur = animDur, polar = false, onEnd = null;
        if (typeof arg === "number") dur = arg;
        else if (arg && typeof arg === "object") {
          if (typeof arg.durMs === "number") dur = arg.durMs;
          polar = !!arg.polar;
          if (typeof arg.onEnd === "function") onEnd = arg.onEnd;
        }
        const targets = [];
        nodesData.forEach(n => {
          const sx = n.fx != null ? n.fx : n.x;
          const sy = n.fy != null ? n.fy : n.y;
          const dx = n.homeX - sx, dy = n.homeY - sy;
          if (dx * dx + dy * dy < 0.25) {
            if (n.fx != null) n.fx = n.homeX;
            if (n.fy != null) n.fy = n.homeY;
            n.x = n.homeX; n.y = n.homeY;
            return;
          }
          const tgt = { n, sx, sy, ex: n.homeX, ey: n.homeY };
          if (polar) {
            tgt.sr = Math.hypot(sx, sy);
            tgt.er = Math.hypot(n.homeX, n.homeY);
            // atan2 collapses to 0 at the origin, which would spiral the
            // path when one endpoint sits at r ≈ 0. Pin the degenerate
            // angle to the other endpoint's angle so the move is a clean
            // radial slide along a single ray.
            const EPS = 1e-3;
            const sAtO = tgt.sr < EPS, eAtO = tgt.er < EPS;
            let sa = sAtO ? null : Math.atan2(sy, sx);
            let ea = eAtO ? null : Math.atan2(n.homeY, n.homeX);
            if (sa == null && ea == null) { sa = 0; ea = 0; }
            else if (sa == null) sa = ea;
            else if (ea == null) ea = sa;
            tgt.sa = sa;
            // Shortest-arc unwrap: keep |ea − sa| ≤ π.
            let da = ea - sa;
            while (da >  Math.PI) da -= 2 * Math.PI;
            while (da < -Math.PI) da += 2 * Math.PI;
            tgt.da = da;
          }
          targets.push(tgt);
        });
        if (!targets.length) { if (onEnd) onEnd(); return; }
        // Off-screen hosts snap directly: rAF tweening on disks the user
        // can't see is pure cost. Re-check visibility cheaply via a
        // bounding-rect intersection.
        if (host && typeof window !== "undefined") {
          const rect = host.getBoundingClientRect();
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          if (rect.bottom < 0 || rect.top > vh) {
            targets.forEach(({ n, ex, ey }) => {
              if (n.fx != null) n.fx = ex;
              if (n.fy != null) n.fy = ey;
              n.x = ex; n.y = ey;
            });
            if (pinned) paint();
            if (onEnd) onEnd();
            return;
          }
        }
        const ease = (typeof d3 !== "undefined" && d3.easeCubicInOut) || ((t) => t);
        const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
        function step() {
          const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
          const t = Math.min(1, (now - start) / dur);
          const e = ease(t);
          targets.forEach((tgt) => {
            let nx, ny;
            if (polar) {
              const r = tgt.sr + (tgt.er - tgt.sr) * e;
              const a = tgt.sa + tgt.da * e;
              nx = r * Math.cos(a);
              ny = r * Math.sin(a);
            } else {
              nx = tgt.sx + (tgt.ex - tgt.sx) * e;
              ny = tgt.sy + (tgt.ey - tgt.sy) * e;
            }
            const n = tgt.n;
            if (n.fx != null) n.fx = nx;
            if (n.fy != null) n.fy = ny;
            n.x = nx; n.y = ny;
          });
          if (pinned) paint();
          else sim.alpha(0.2);
          if (t < 1) requestAnimationFrame(step);
          else {
            targets.forEach(({ n, ex, ey }) => {
              if (n.fx != null) n.fx = ex;
              if (n.fy != null) n.fy = ey;
              n.x = ex; n.y = ey;
            });
            if (pinned) paint();
            if (onEnd) onEnd();
          }
        }
        if (!pinned) sim.alpha(0.3).restart();
        requestAnimationFrame(step);
      },

      onEdgeTap(fn)     { onEdgeTap   = fn; },
      onNodeTap(fn)     { onNodeTap   = fn; },
      onNodeHoverEnter(fn) { onNodeEnter = fn; },
      onNodeHoverLeave(fn) { onNodeLeave = fn; },
      onEdgeHoverEnter(fn) { onEdgeEnter = fn; },
      onEdgeHoverLeave(fn) { onEdgeLeave = fn; },

      fit()    {},
      resize() {},
      // Width of the viewBox without padRight (positions + 2*pad). Used
      // by mountGxPanel's px -> viewBox-units conversion so the math
      // is anchored to a constant baseline, not the current padded vb.
      get naturalVbWidth() {
        const baseFit = Object.assign({}, fitOpts, { padRight: 0 });
        const vbStr = fitViewBoxAttr(baseFit);
        const parts = vbStr.split(/\s+/).map(Number);
        return parts[2];
      },
      // Recompute the viewBox with a new padRight (in viewBox units).
      // mountGxPanel calls this after measuring its panel so the graph
      // reserves exactly enough right slack for the current panel size.
      setPadRight(padRightUnits) {
        fitOpts.padRight = padRightUnits;
        svg.attr("viewBox", fitViewBoxAttr(fitOpts));
        if (pinned) paint();
        else sim.alpha(0.3).restart();
      },
    };

    return handle;
  },
};
// Back-compat alias: old pages that still reference NETGEN.CY.init
// will just get the new VIZ init.
const CY = VIZ;

// ── Tooltip helper (rich node + edge stats) ──────────────────
// Pre-compute intra/inter degree from the canonical EDGES.
const __intraDeg = {}, __interDeg = {};
NODES.forEach(n => { __intraDeg[n] = 0; __interDeg[n] = 0; });
EDGES.forEach(({u, v}) => {
  const same = CLUSTER_OF[u] === CLUSTER_OF[v] && CLUSTER_OF[u] !== "OUT";
  if (same) { __intraDeg[u]++; __intraDeg[v]++; }
  else      { __interDeg[u]++; __interDeg[v]++; }
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
    const mu   = dTot > 0 ? dExt / dTot : 0;
    tip.innerHTML =
      '<div class="hd">node ' + id + ' &middot; ' + type + '</div>' +
      '<div>cluster <b>' + clLabel + '</b></div>' +
      '<div>degree <b>' + dTot + '</b> <span class="dim">(intra ' + dInt + ', inter ' + dExt + ')</span></div>' +
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

// onRandStep can return this sentinel to tell stepController not to
// render — handler already painted (e.g. drove playMany directly).
const SKIP_SENTINEL = "skip";

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
    getLocked, randStepDisabledAt,
  } = opts;
  const useKeys = opts.keyboard !== false;
  const randAtStart = !!opts.randAtStart;
  let total = opts.total;
  let idx = 0;
  // snapDepth: handler-scoped snap-mode counter. When > 0, every render
  // fired inside the handler passes snap=true to onRender, so walker
  // render functions route through spokes.snapToState (or equivalent)
  // instead of the animated path. The rand-all click and the to-start
  // / to-end nav buttons wrap their work in withSnap; rand-step + prev
  // + next leave it 0 (animated render).
  let snapDepth = 0;
  function withSnap(fn) { snapDepth++; try { fn(); } finally { snapDepth--; } }
  function isLocked() { return !!(getLocked && getLocked()); }
  function refreshButtons() {
    const locked = isLocked();
    const atStart = (idx <= 0);
    const atEnd = (idx >= total - 1);
    if (prevBtn) prevBtn.disabled = locked || atStart;
    if (nextBtn) nextBtn.disabled = locked || atEnd;
    if (resetBtn) resetBtn.disabled = locked || atStart;
    if (endBtn)   endBtn.disabled   = locked || atEnd;
    const randStepBlocked = !!(randStepDisabledAt && randStepDisabledAt(idx));
    if (randStepBtn) randStepBtn.disabled = locked || (atStart && !randAtStart) || randStepBlocked;
    if (randAllBtn)  randAllBtn.disabled  = locked || (atStart && !randAtStart);
  }
  function render() {
    if (labelCur) labelCur.textContent = idx;
    if (labelTotal) labelTotal.textContent = total - 1;
    refreshButtons();
    if (onRender) onRender(idx, snapDepth > 0);
  }
  prevBtn && prevBtn.addEventListener("click", () => { if (!isLocked() && idx>0) { idx--; render(); } });
  nextBtn && nextBtn.addEventListener("click", () => { if (!isLocked() && idx<total-1) { idx++; render(); } });
  resetBtn && resetBtn.addEventListener("click", () => { if (!isLocked()) withSnap(() => { idx = 0; render(); }); });
  endBtn && endBtn.addEventListener("click", () => { if (!isLocked()) withSnap(() => { idx = total-1; render(); }); });
  randStepBtn && randStepBtn.addEventListener("click", () => {
    if (isLocked()) return;
    // onRandStep return values:
    //   NETGEN.SKIP  — handler ran its own render (e.g. drove an
    //                  animated swap directly via spokes.playMany);
    //                  controller stays out of the render path.
    //   truthy       — snap-render (jump, no animation).
    //   falsy        — animated render (default).
    const ret = onRandStep ? onRandStep(idx) : false;
    if (ret === SKIP_SENTINEL) return;
    if (ret) withSnap(render);
    else render();
  });
  randAllBtn && randAllBtn.addEventListener("click", () => {
    if (isLocked()) return;
    withSnap(() => {
      if (onRandAll) onRandAll(idx);
      render();
    });
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
    // Multi-step jump that flags onRender(snap=true) — same effect as
    // ToStart / ToEnd, used by cluster-nav arrows so cpair / bgpair
    // route through playManyDiff instead of single-step snapOrSync.
    setSnap: (i) => { withSnap(() => { idx = Math.max(0, Math.min(total-1, i)); render(); }); },
    rerender: () => render(),
    refreshButtons: () => refreshButtons(),
    // Callers that regenerate their data (e.g. nPSO's trajectory on a
    // random-button reroll) can swap `total` and reset idx without
    // reconstructing the controller.
    reconfigure: (newTotal) => { total = newTotal; idx = 0; render(); },
    // Atomic swap of total + idx, single render. Used by random-all
    // handlers that want to keep the cursor near its prior position.
    reconfigureKeep: (newTotal, newIdx) => {
      total = newTotal;
      idx = Math.max(0, Math.min(total - 1, newIdx));
      render();
    },
    // Silent total + idx update — no render, no label refresh.
    // Caller wants to drive rendering itself (e.g. an animated
    // rand-step that needs to call playMany directly). Refreshes
    // button enable state since total/idx affect it.
    setTotalIdxSilent: (newTotal, newIdx) => {
      total = newTotal;
      idx = Math.max(0, Math.min(total - 1, newIdx));
      refreshButtons();
    },
  };
}

// Click handler for floating .gx-panel overlays. Each panel ships
//   <button id="<prefix>-toggle"> + <span id="<prefix>-arrow">
//   <div   id="<prefix>-body">
// so passing the prefix is enough to wire collapse / expand.
function bindPanelToggle(prefix) {
  const btn = document.getElementById(prefix + "-toggle");
  if (!btn) return;
  btn.addEventListener("click", function () {
    const body = document.getElementById(prefix + "-body");
    const arrow = document.getElementById(prefix + "-arrow");
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    if (arrow) arrow.innerHTML = open ? "&#9656;" : "&#9662;";
  });
}

// Mount a floating .gx-panel into a .graph-canvas. opts:
//   hostId       (required) id of the .graph-canvas
//   prefix       (required) id namespace for toggle / arrow / body
//   title        text on the toggle button
//   bodyHTML     HTML inserted into the body div
//   maxWidth     optional CSS for the wrapper
//   viz          optional NETGEN.VIZ handle. When provided, the helper
//                measures its own width post-mount and asks viz to
//                reserve a matching padRight (viewBox units), so the
//                graph never gets pushed under the panel regardless of
//                panel size. Re-runs on window resize.
// Returns the wrapper element.
function mountGxPanel(opts) {
  const host = document.getElementById(opts.hostId);
  if (!host) return null;
  const wrap = document.createElement("div");
  wrap.id = opts.prefix + "-panel";
  wrap.className = "gx-panel";
  if (opts.maxWidth) wrap.style.maxWidth = opts.maxWidth;
  wrap.innerHTML =
    '<button id="' + opts.prefix + '-toggle" class="gx-panel-toggle" type="button">'
    + (opts.title || "")
    + ' <span id="' + opts.prefix + '-arrow">&#9662;</span></button>'
    + '<div id="' + opts.prefix + '-body">' + (opts.bodyHTML || "") + '</div>';
  host.appendChild(wrap);
  bindPanelToggle(opts.prefix);
  if (opts.viz && opts.viz.setPadRight) {
    const sync = () => {
      const hostW = host.clientWidth;
      const wrapW = wrap.offsetWidth;
      if (!hostW || !wrapW) return;
      // Solve for padRight (units) so that the panel's px footprint
      // covers exactly padRight units of the final viewBox:
      //   panelPx / hostW == padRight / (naturalVb + padRight)
      //   => padRight = panelPx * naturalVb / (hostW - panelPx)
      // Using just (naturalVb / hostW) underestimates because the
      // viewBox grows once padRight is added.
      const baseW = (opts.viz.naturalVbWidth) || 1;
      const px = wrapW + 16;
      const denom = Math.max(1, hostW - px);
      const units = px * baseW / denom;
      opts.viz.setPadRight(units);
    };
    requestAnimationFrame(sync);
    window.addEventListener("resize", sync);
    // ResizeObserver catches every wrap resize — toggle collapse / expand,
    // browser zoom, font load. More reliable than the toggle-click path
    // since it fires AFTER layout, not before.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => sync());
      ro.observe(wrap);
    } else {
      const toggleBtn = document.getElementById(opts.prefix + "-toggle");
      if (toggleBtn) toggleBtn.addEventListener("click", () => {
        requestAnimationFrame(() => requestAnimationFrame(sync));
      });
    }
  }
  return wrap;
}

// Standard 5-cluster list for the singleton input opener: 3 real
// clusters (C1, C2, C3) + one entry per node in OUT, each painted from
// the shared outlier_palette. Every gen page can reuse this verbatim
// for its g-shared-input opener; pages with custom singleton ids /
// colours are free to build the list themselves.
function defaultSingletonClusters() {
  const pal = COLORS.outlier_palette;
  const out = [
    { id: "C1", nodes: C1, color: COLORS.C1, isOutlier: false },
    { id: "C2", nodes: C2, color: COLORS.C2, isOutlier: false },
    { id: "C3", nodes: C3, color: COLORS.C3, isOutlier: false },
  ];
  OUT.forEach((n, i) => {
    out.push({ id: "S" + n, nodes: [n], color: pal[i % pal.length], isOutlier: true });
  });
  return out;
}

// Build the universal "outliers-as-singletons" input opener: 5 dashed
// rings (3 real clusters + 2 singletons), neutral grey edges, per-
// singleton colour from a shared palette. Used by every gen page that
// runs profile under outlier_mode=singleton (npso, abcd, lfr, ...).
//
// opts:
//   hostId        DOM id of the .graph-canvas host
//   tooltipHostId optional; defaults to hostId without the "-cy" suffix
//   clusters      [{ id, nodes, color, isOutlier }, ...] — same shape
//                 nPSO's CLUSTER_DEFS uses
//   edges         optional array of {u,v} edges. Default: NETGEN.EDGES
//                 in faint grey.
//
// Returns the viz instance.
function singletonOpener(opts) {
  const host = document.getElementById(opts.hostId);
  if (!host) return null;
  host.innerHTML = "";
  const svg = d3.select(host).append("svg")
    .attr("class", "viz-svg")
    .attr("viewBox", fitViewBoxAttr())
    .attr("preserveAspectRatio", "xMidYMid meet");
  const colourOf = {};
  opts.clusters.forEach(cd => cd.nodes.forEach(n => { colourOf[n] = cd.color; }));
  const layer = svg.append("g").attr("class", "block-rects");
  const rects = opts.clusters.map(cd => {
    const rect = layer.append("rect")
      .attr("rx", 10).attr("ry", 10)
      .attr("fill", cd.color).attr("fill-opacity", 0.07)
      .attr("stroke", cd.color).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "7 5")
      .attr("opacity", 0.92);
    const label = layer.append("text")
      .attr("class", "block-ring-label")
      .attr("text-anchor", "start")
      .attr("fill", cd.color)
      .attr("opacity", 0.95)
      .style("font-family", "Caveat Brush, cursive")
      .style("font-size", "18px")
      .text(cd.label != null ? cd.label : cd.id);
    return { cd, rect, label };
  });
  const edgesIn = opts.edges || EDGES.map(e => ({
    u: e.u, v: e.v, color: COLORS.paper_3, w: 0.9,
  }));
  const viz = VIZ.init(opts.hostId, {
    svg, showLabels: true, includeOutliers: true,
    edges: edgesIn,
    nodeColor: (id) => colourOf[parseInt(id, 10)] || COLORS.paper_3,
  });
  const tipHost = document.getElementById(opts.tooltipHostId || opts.hostId.replace(/-cy$/, ""));
  if (tipHost) makeTooltip(viz, tipHost);
  function syncRects() {
    rects.forEach(r => {
      const isSingleton = r.cd.nodes.length === 1;
      const padX = isSingleton ? 18 : 30;
      const padY = isSingleton ? 18 : 34;
      let mx = Infinity, MX = -Infinity, my = Infinity, MY = -Infinity;
      r.cd.nodes.forEach(id => {
        const n = viz.nodeById[String(id)];
        if (!n) return;
        if (n.x < mx) mx = n.x; if (n.x > MX) MX = n.x;
        if (n.y < my) my = n.y; if (n.y > MY) MY = n.y;
      });
      if (!isFinite(mx)) return;
      let x = mx - padX, y = my - padY;
      let w = (MX - mx) + 2 * padX, h = (MY - my) + 2 * padY;
      const labelW = r.label.node().getComputedTextLength
        ? r.label.node().getComputedTextLength() : 0;
      const wanted = labelW + 14;
      if (w < wanted) {
        const cx = (mx + MX) / 2;
        w = wanted;
        x = cx - w / 2;
      }
      r.rect.attr("x", x).attr("y", y).attr("width", w).attr("height", h);
      // Label above the rect's top edge so a singleton's lone node
      // (centered inside its ring) cannot obscure the cluster name.
      r.label.attr("x", x + 6).attr("y", y - 6);
    });
  }
  syncRects();
  viz.sim.on("tick.blockRects", syncRects);
  return viz;
}
// Spoke-layer snap-or-sync: the universal render router for any walker
// whose match-edges are owned by NETGEN.spokeLayer. Pass the snap flag
// from onRender(idx, snap) straight through.
function snapOrSync(spokes, state, snap) {
  if (snap && spokes && spokes.snapToState) spokes.snapToState(state);
  else if (spokes && spokes.syncState) spokes.syncState(state);
}

// Diff two placed-style entry lists by id, with u/v change detection
// for stable-id swaps (RandStep that mutates endpoints under a stable
// op id). Returns { removes, adds } mapped through opts.placedEntry
// (identity if absent).
function diffPlacedById(beforeList, afterList, placedEntry) {
  const map = placedEntry || function (e) { return e; };
  const beforeById = new Map((beforeList || []).map(function (e) { return [e.id, e]; }));
  const afterById  = new Map((afterList  || []).map(function (e) { return [e.id, e]; }));
  const removes = [], adds = [];
  beforeById.forEach(function (be, id) {
    const ae = afterById.get(id);
    if (!ae) removes.push(map(be));
    else if (ae.u !== be.u || ae.v !== be.v) {
      removes.push(map(be));
      adds.push(map(ae));
    }
  });
  afterById.forEach(function (ae, id) {
    if (!beforeById.has(id)) adds.push(map(ae));
  });
  return { removes, adds };
}

// Single-call alternative to snapToState for multi-step jumps (ToStart
// / ToEnd / RandAll): every changed entry animates concurrently in one
// chained rewind→forward sequence (SBM g3 pattern). Removes-only
// stays on playMany (rewind) — simplify's dashify-fade is the wrong
// gesture for ToStart/RandAll, which should mirror Back through every
// placement.
//
// opts:
//   placedEntry  entry → spoke-layer placed shape (identity if absent)
//   byNode       passed to playMany
//   onEmpty      callback for the no-diff case
//   onDone       callback when playMany settles (also fires on empty diff)
function playManyDiff(spokes, beforeList, afterList, opts) {
  const o = opts || {};
  const done = o.onDone || function () {};
  const { removes, adds } = diffPlacedById(beforeList, afterList, o.placedEntry);
  if (removes.length === 0 && adds.length === 0) {
    if (o.onEmpty) o.onEmpty();
    done();
    return false;
  }
  const passOpts = o.byNode ? { byNode: o.byNode } : undefined;
  spokes.playMany(removes, adds, done, passOpts);
  return true;
}

// Walk a list of pair entries {u, v, loop, ...} and tag each with
// bad-ness driven by in-render dup detection: first occurrence is the
// kept edge, every later occurrence is a parallel. Self-loops are
// always bad. Optional isExtraBad callback handles cross-bucket dups
// (e.g. bg pair landing on a cluster edge).
//
//   pairs       array of {u, v, loop?, ...} entries
//   idPrefix    e.g. "cp-" — placed-edge id is `${idPrefix}${i}`
//   goodColor   string or (e) => string for the kept-edge stroke
//   badColor    stroke for parallels / self-loops
//   keyOf       (u, v) => string canonical pair key
//   isExtraBad  optional (e, key) => bool for upstream-flagged dups
//
// Returns the placed[] array each walker hands to spoke_layer's
// syncState / snapToState. Drop-in replacement for the per-page seenKey
// loops; ensures the e.multi flag (which the kernel sets on BOTH
// copies of a parallel) is never used to decide bad-ness.
function walkerMarkPlaced(pairs, opts) {
  const { idPrefix, goodColor, badColor, keyOf, isExtraBad } = opts;
  const seen = {};
  const out = [];
  for (let i = 0; i < pairs.length; i++) {
    const e = pairs[i];
    const k = keyOf(e.u, e.v);
    const wasSeen = !!seen[k];
    seen[k] = (seen[k] || 0) + 1;
    const bad = !!e.loop || wasSeen || (isExtraBad ? !!isExtraBad(e, k) : false);
    out.push({
      u: e.u, v: e.v,
      color: bad ? badColor : (typeof goodColor === "function" ? goodColor(e) : goodColor),
      id: idPrefix + i,
      bad,
    });
  }
  return out;
}

// Companion to walkerMarkPlaced: classify the "just" pair (the active
// pair at step idx, 1-indexed). Returns { e, bad, key } or null when
// idx <= 0. Same parallel-by-prefix rule, same extra-bad escape hatch.
function walkerMarkJust(pairs, idx, opts) {
  if (idx <= 0) return null;
  const { keyOf, isExtraBad } = opts;
  const e = pairs[idx - 1];
  const k = keyOf(e.u, e.v);
  let parallel = false;
  for (let i = 0; i < idx - 1; i++) {
    if (keyOf(pairs[i].u, pairs[i].v) === k) { parallel = true; break; }
  }
  const bad = !!e.loop || parallel || (isExtraBad ? !!isExtraBad(e, k) : false);
  return { e, bad, key: k };
}

// ── Walker markup + wiring ───────────────────────────────────
// Standard 2-row block:
//   row 1 (random):  random step | random all   <stepLabel>
//   row 2 (nav):     to start | back | next | to end   <cursorLabel>
// Button ids are derived from prefix:
//   {prefix}-rand-step, {prefix}-rand-all,
//   {prefix}-start, {prefix}-prev, {prefix}-next, {prefix}-end
// Cursor output element id defaults to {prefix}-cur, total {prefix}-total.
// opts:
//   prefix       (required) id namespace
//   stepLabel    optional inline caption next to random row
//   cursor       cursor caption HTML (default: "step <output id> / <span id>")
//   deterministic  if true, omit the random row entirely
//   randStepText, randAllText, primary='next' override label/primary
//   noRandStep   if true, drop just random-step button (e.g. shared-tau panel)
function walkerRow(opts) {
  const {
    prefix,
    stepLabel = "",
    cursor,
    deterministic = false,
    randStepText = "random step",
    randAllText = "random all",
    noRandStep = false,
  } = opts;
  const cur = `<output id="${prefix}-cur">0</output>`;
  const tot = `<span id="${prefix}-total">0</span>`;
  const cursorHtml = cursor != null ? cursor : `step ${cur} / ${tot}`;
  const randRow = deterministic
    ? ""
    : (
      '<div class="widget-row tight">'
      + (noRandStep ? "" : `<button class="btn" id="${prefix}-rand-step" type="button">${randStepText}</button>`)
      + `<button class="btn" id="${prefix}-rand-all" type="button">${randAllText}</button>`
      + (stepLabel ? `<span class="step-label">${stepLabel}</span>` : "")
      + '</div>'
    );
  const navRow =
    '<div class="widget-row tight">'
    + `<button class="btn" id="${prefix}-start" type="button">to start</button>`
    + `<button class="btn" id="${prefix}-prev" type="button">back</button>`
    + `<button class="btn primary" id="${prefix}-next" type="button">next</button>`
    + `<button class="btn" id="${prefix}-end" type="button">to end</button>`
    + `<span class="step-label">${cursorHtml}</span>`
    + '</div>';
  return randRow + navRow;
}

// Resolve walker buttons by prefix and forward to stepController.
// Returns whatever stepController returned (idx getter, set, reconfigure...).
// Caller passes the same callbacks stepController accepts; ids are auto-
// resolved off the prefix. Pass curId/totId to override (default
// {prefix}-cur, {prefix}-total).
function wireWalker(opts) {
  const {
    prefix,
    total,
    onRender, onRandStep, onRandAll, getLocked,
    keyboard, randAtStart,
    curId, totId,
    randStepDisabledAt,
  } = opts;
  const $ = (suffix) => document.getElementById(`${prefix}-${suffix}`);
  return stepController({
    total,
    prevBtn: $("prev"), nextBtn: $("next"),
    resetBtn: $("start"), endBtn: $("end"),
    randStepBtn: $("rand-step"), randAllBtn: $("rand-all"),
    labelCur: document.getElementById(curId || `${prefix}-cur`),
    labelTotal: document.getElementById(totId || `${prefix}-total`),
    onRender, onRandStep, onRandAll, getLocked, keyboard, randAtStart,
    randStepDisabledAt,
  });
}

// ── Reroll walker ─────────────────────────────────────────────
// Higher-level wrapper around wireWalker. Adds three behaviours
// every reroll-bearing walker needs:
//
//   1. RandStep[idx-1..end] / RandAll[0..end] semantics — driver
//      doesn't enforce a kernel contract; page supplies handlers
//      that mutate its own override / trace store. After each
//      handler, driver re-syncs total via totalForCurrent() and
//      runs onAfterRand{Step,All}(idx, newTotal) so the page can
//      publish to its event bus (cross-figure sync).
//   2. was-at-end cursor — RandAll captures `idx === ctl.total-1`
//      pre-handler; if true, post-handler cursor lands on the new
//      last step (newTotal-1). Mid-walk cursor stays at idx,
//      auto-clamped by reconfigureKeep when newTotal shrinks.
//      RandStep keeps idx silently via setTotalIdxSilent; the
//      page's onRandStep is responsible for driving its own
//      animation (return "skip" to bypass controller render).
//   3. Drop-stale gate convention — randStepDisabledAt defaults
//      to (idx) => idx >= totalForCurrent() - 1, matching the
//      "no op range to spin" rule. Page can override.
//
// Page contract:
//   prefix:           DOM id prefix (g-bgpair, g-cpair, ...)
//   total / totalForCurrent: initial total + live total accessor
//   onRender(step, snap): page paints viz + labels + descriptions
//   onRandStep(idx) / onRandAll(idx): page's reroll handlers.
//     Same return-value semantics as stepController:
//       "skip"  — handler ran its own render (e.g. playMany)
//       truthy  — snap-render
//       falsy   — animated render
//     For RandAll the driver always wraps in withSnap (per
//     stepController's randAllBtn handler), so the return value
//     is ignored except to suppress double-render.
//   onAfterRandStep(idx, newTotal) / onAfterRandAll(idx, newTotal):
//     fired after the handler + total/idx sync. Page publishes
//     cross-figure events here (downstream walker reconfigKeep).
//   trackEndCursor: bool, default true. False → mid-walk semantics
//     even at the last step (RandAll keeps idx, lets reconfigureKeep
//     clamp).
function rerollWalker(opts) {
  const {
    prefix, total,
    totalForCurrent = () => total,
    onRender,
    onRandStep, onRandAll,
    onAfterRandStep, onAfterRandAll,
    trackEndCursor = true,
    getLocked, keyboard, randAtStart, curId, totId,
    randStepDisabledAt,
  } = opts;
  let ctl = null;
  const wrappedRandStep = onRandStep ? (idx) => {
    const ret = onRandStep(idx);
    if (ctl) {
      const newTotal = totalForCurrent();
      if (newTotal !== ctl.total) ctl.setTotalIdxSilent(newTotal, idx);
      if (onAfterRandStep) onAfterRandStep(idx, newTotal);
    }
    return ret;
  } : undefined;
  // RandAll: handler mutates page state; driver silently updates total
  // + idx (was-at-end → newTotal-1, else clamp). stepController's
  // randAllBtn click then fires its own render() under withSnap, which
  // paints the new state. Driver does NOT render itself — that would
  // double-render with the controller's post-handler render.
  const wrappedRandAll = onRandAll ? (idx) => {
    const wasAtEnd = trackEndCursor && ctl && idx === ctl.total - 1;
    const ret = onRandAll(idx);
    if (ctl) {
      const newTotal = totalForCurrent();
      const newIdx = Math.max(0, Math.min(newTotal - 1, wasAtEnd ? newTotal - 1 : idx));
      ctl.setTotalIdxSilent(newTotal, newIdx);
      if (onAfterRandAll) onAfterRandAll(newIdx, newTotal);
    }
    return ret;
  } : undefined;
  ctl = wireWalker({
    prefix, total,
    onRender,
    onRandStep: wrappedRandStep,
    onRandAll: wrappedRandAll,
    getLocked, keyboard, randAtStart, curId, totId,
    randStepDisabledAt,
  });
  return ctl;
}

// ── Rewire stateAtStep factory ────────────────────────────────
// Shared construction for rewire walkers (cluster-rewire, bg-rewire,
// any future ec-sbm / lfr rewire). Builds the per-step edge list:
//   1. prePairs seed the list, with bad-flag inferred from
//      loop / multi / crossDup.
//   2. ops in [0..k) mutate the list via the walker-specific applyOp.
//   3. Drop-stale step (k > ops.length) filters bad entries — the
//      recycle-queue leftovers at canonical exit.
//
// Page contract:
//   prePairsOf(R)        — array of pre-pairs (cluster-pre / bg-pre);
//                          may apply a page-side override.
//   opsOf(R)             — array of ops (with effectiveOps semantics).
//   idPrefix             — "cr" / "br" for stable per-entry ids.
//   applyOp(list, op, i, idPrefix) — mutate list in place per the op
//                          (kernel-specific cut + place; cluster vs
//                          bg semantics differ on no-op handling and
//                          newp placement flags).
//   entryDecorator(entry, prePair) — attach extra fields (e.g.
//                          `cluster` for cluster-rewire; identity for
//                          bg-rewire).
function makeRewireStateAtStep(opts) {
  const { prePairsOf, opsOf, idPrefix, applyOp, entryDecorator } = opts;
  const decorate = entryDecorator || ((e) => e);
  return function stateAtStep(R, k) {
    const ops = opsOf(R);
    const list = [];
    const seenKey = new Set();
    prePairsOf(R).forEach(function (e, i) {
      const key = keyOf(e.u, e.v);
      const isLoop = !!e.loop;
      const isMulti = !!e.multi || (!isLoop && seenKey.has(key));
      const isCrossDup = !!e.crossDup;
      if (!isLoop && !isMulti && !isCrossDup) seenKey.add(key);
      list.push(decorate({
        u: e.u, v: e.v,
        bad: isLoop || isMulti || isCrossDup,
        id: idPrefix + "-pre-" + i,
      }, e));
    });
    const opsToApply = Math.min(k, ops.length);
    for (let i = 0; i < opsToApply; i++) {
      applyOp(list, ops[i], i, idPrefix);
    }
    // Drop-stale filter: opts.keepBadAtDropStale=true tells the
    // walker to leave bad entries on screen at the drop-stale step
    // (used when those entries don't actually disappear from the
    // pipeline — they get forwarded to a later stage).
    if (k > ops.length && !opts.keepBadAtDropStale) {
      return list.filter(function (e) { return !e.bad; });
    }
    return list;
  };
}

// ── Rewire render factory ─────────────────────────────────────
// Shared render(step, snap) for any rewire walker (cluster-rewire,
// bg-rewire, abcd+o equivalents, lfr, ec-sbm). Handles:
//   - total + cur DOM updates
//   - paintLabelDesc dispatch
//   - backdrop (optional) prefix on placed
//   - snap vs animated branch (adjacency check)
//   - playMany / simplify split (drop-stale = simplify)
//
// Page contract:
//   viz                       cytoscape viz handle
//   spokes                    spokeLayer.attach handle
//   prefix                    DOM id prefix ("g-crewire", "g-bgrewire")
//   R()                       realization getter
//   opsOf(R)                  current op trace
//   stateAtStep(R, k)         (typically from makeRewireStateAtStep)
//   placedEntry(e)            edge → spoke-layer placed entry
//   paintLabelDesc(step, ops, isDropStale)
//   backdropOf(R)             optional → noSlot prefix on placed
//   getLastStep / setLastStep accessors for the walker's lastStep
//
// Returns render(step). isDropStale = step > opsOf(R).length.
function makeRewireRender(opts) {
  const {
    viz, spokes, prefix, R: getR, opsOf, stateAtStep,
    placedEntry, paintLabelDesc, backdropOf,
    getLastStep, setLastStep,
    byNodeFromList,
  } = opts;
  const totalEl = document.getElementById(prefix + "-total");
  const curEl = document.getElementById(prefix + "-cur");
  const noopFn = function () {};
  // Tracks the last rendered list — the honest before-state for diffs.
  // RandAll mutates ops without moving the cursor, so stateAtStep(R,
  // lastStep) post-reroll no longer matches what's currently painted;
  // the rendered list is what playMany has to retract from.
  let lastRendered = null;
  let firstRender = true;
  function render(step, snap) {
    const R = getR();
    const ops = opsOf(R);
    const total = 2 + ops.length;
    if (totalEl) totalEl.textContent = String(total - 1);
    if (curEl) curEl.textContent = String(step);
    if (viz && viz.setEdges) viz.setEdges([]);
    const isDropStale = step > ops.length;
    paintLabelDesc(step, ops, isDropStale);

    const afterList  = stateAtStep(R, step);
    const byNode = byNodeFromList(afterList);
    const backdrop = backdropOf ? backdropOf(R) : [];

    // First mount: seed state instantly so the page doesn't open with a
    // forward grow of the entire pre-rewire snapshot.
    if (firstRender) {
      spokes.snapToState({
        byNode,
        placed: backdrop.concat(afterList.map(placedEntry)),
        just: null, justSeq: step,
      });
      lastRendered = afterList;
      firstRender = false;
      setLastStep(step);
      return;
    }

    const lastStep = getLastStep();
    const adjacent = step === lastStep + 1 || step === lastStep - 1;

    // Multi-step jump or RandAll-driven snap: SBM g3 pattern — diff
    // the live rendered list against the new target, animate every
    // changed entry concurrently in one chained rewind→forward.
    if (!adjacent || snap) {
      // Two-stage when crossing into drop-stale: place all rewire ops
      // first, then chain the residue cut. Reads as "build, then trim"
      // instead of fusing both into one bulk diff that hides the cut.
      const opsAppliedStep = ops.length;
      const crossesDropStale = isDropStale
        && (lastRendered === null || (getLastStep() <= opsAppliedStep));
      if (crossesDropStale) {
        const opsApplied = stateAtStep(R, opsAppliedStep);
        const opsByNode = byNodeFromList(opsApplied);
        playManyDiff(spokes, lastRendered || [], opsApplied, {
          placedEntry, byNode: opsByNode,
          onEmpty: function () {
            spokes.snapToState({
              byNode: opsByNode,
              placed: backdrop.concat(opsApplied.map(placedEntry)),
              just: null, justSeq: opsAppliedStep,
            });
          },
          onDone: function () {
            playManyDiff(spokes, opsApplied, afterList, {
              placedEntry, byNode,
              onEmpty: function () {
                spokes.snapToState({
                  byNode,
                  placed: backdrop.concat(afterList.map(placedEntry)),
                  just: null, justSeq: step,
                });
              },
            });
            lastRendered = afterList;
          },
        });
        lastRendered = opsApplied;
        setLastStep(step);
        return;
      }
      playManyDiff(spokes, lastRendered || [], afterList, {
        placedEntry, byNode,
        onEmpty: function () {
          spokes.snapToState({
            byNode,
            placed: backdrop.concat(afterList.map(placedEntry)),
            just: null, justSeq: step,
          });
        },
      });
      lastRendered = afterList;
      setLastStep(step);
      return;
    }

    const beforeList = stateAtStep(R, lastStep);
    const beforeIds = new Set(beforeList.map(function (e) { return e.id; }));
    const afterIds  = new Set(afterList.map(function (e) { return e.id; }));
    const removes = beforeList.filter(function (e) { return !afterIds.has(e.id); }).map(placedEntry);
    const adds    = afterList.filter(function (e) { return !beforeIds.has(e.id); }).map(placedEntry);

    if (removes.length > 0 && adds.length === 0 && !opts.forcePlayManyOnRemovesOnly) {
      spokes.simplify(removes, noopFn, { byNode });
    } else {
      spokes.playMany(removes, adds, noopFn, { byNode });
    }
    lastRendered = afterList;
    setLastStep(step);
  }
  // Page handlers that drive their own playMany (e.g. RandStep with a
  // custom desc) sync the renderer's diff baseline by calling
  // render.setLastRendered(afterList) after their dispatch.
  render.setLastRendered = function (list) { lastRendered = list; };
  return render;
}

// ── Cluster-post backdrop helper ──────────────────────────────
// Build the noSlot placed-prefix every walker that paints cluster-
// post in faded grey/cluster-color behind its own edges (bg-pair,
// bg-rewire, lfr's bg-equivalent, ec-sbm v2 etc.) needs.
//   const backdrop = NETGEN.clusterPostBackdrop(R, {
//     idPrefix: "bp-cluster-",
//     colorOf: e => CLUSTER_COLOR_OF[e.cluster] || COL.edge_stage2,
//   });
// Then prefix it onto state.placed so it paints behind active edges
// while sharing dupInfo for symmetric fan-out at colliding (u,v).
function clusterPostBackdrop(R, opts) {
  const idPrefix = (opts && opts.idPrefix) || "backdrop-";
  const colorOf  = (opts && opts.colorOf)  || function (e) { return e.color || "#888"; };
  const w        = (opts && opts.w != null) ? opts.w : 1.2;
  const opacity  = (opts && opts.opacity != null) ? opts.opacity : 0.45;
  return (R.clusterPost || []).map(function (e, i) {
    return {
      u: e.u, v: e.v,
      color: colorOf(e),
      w: w, opacity: opacity, id: idPrefix + i, noSlot: true,
    };
  });
}

// ── Cluster-rewire / bg-rewire applyOp presets ───────────────
// Both run kernel ops over a stateful edge list; cluster-rewire is
// no-op on failure (kernel inner loop tries every candidate; if none
// clears, p1 is requeued without cutting), bg-rewire always cuts
// (when op has p2) and flags rejected newps as bad (recycle queue).
//
// abcdClusterRewireApplyOp: copies op.cluster onto pushed newp entries.
// abcdBgRewireApplyOp: bad iff !op.placedNewp{1,2}; optional `tagFn(np)`
// adds extra fields (e.g. ABCD+o's isOO/isCO from R.outliers).
function abcdClusterRewireApplyOp(list, op, oi, idPrefix) {
  if (!op || !op.success) return;
  const cuts = op.p2 ? [op.p1, op.p2] : [op.p1];
  const picks = spokeLayerHandle().pickCutsByEndpoints(list, cuts);
  picks.forEach(function (p) {
    const idx = list.indexOf(p);
    if (idx >= 0) list.splice(idx, 1);
  });
  if (op.newp1) list.push({
    u: op.newp1[0], v: op.newp1[1], cluster: op.cluster,
    bad: false, id: idPrefix + "-op" + oi + "-1",
  });
  if (op.newp2) list.push({
    u: op.newp2[0], v: op.newp2[1], cluster: op.cluster,
    bad: false, id: idPrefix + "-op" + oi + "-2",
  });
}
function abcdBgRewireApplyOp(tagFn) {
  return function (list, op, i, idPrefix) {
    if (!op || !op.p2) return;
    const picks = spokeLayerHandle().pickCutsByEndpoints(list, [op.p1, op.p2]);
    picks.forEach(function (p) {
      const idx = list.indexOf(p);
      if (idx >= 0) list.splice(idx, 1);
    });
    function push(np, placed, suffix) {
      if (!np) return;
      const entry = {
        u: np[0], v: np[1],
        bad: !placed, id: idPrefix + "-op" + i + "-" + suffix,
      };
      if (tagFn) Object.assign(entry, tagFn(np));
      list.push(entry);
    }
    push(op.newp1, op.placedNewp1, "1");
    push(op.newp2, op.placedNewp2, "2");
  };
}
// Lazy spoke-layer accessor: shared.js loads before js/spoke_layer.js,
// so referencing NETGEN.spokeLayer at module-eval time is undefined.
// Defer resolution to call time when both modules are loaded.
function spokeLayerHandle() { return (typeof window !== "undefined" ? window : global).NETGEN.spokeLayer; }

// ── ABCD-kernel adapters ──────────────────────────────────────
// Helpers shared by abcd / abcd+o for ABCDKernel.replay* invocations.
//
// clusterPrePairsByName: filter R.clusterPre to one cluster, flag
// loop / multi (recompute multi against per-cluster seenKey).
function clusterPrePairsByName(R, cname) {
  const out = [];
  const seenKey = new Set();
  R.clusterPre.forEach(function (e) {
    if (e.cluster !== cname) return;
    const key = keyOf(e.u, e.v);
    const isLoop = !!e.loop;
    const isMulti = !!e.multi || (!isLoop && seenKey.has(key));
    if (!isLoop && !isMulti) seenKey.add(key);
    out.push({ u: e.u, v: e.v, bad: isLoop || isMulti });
  });
  return out;
}
// globalPrePairsTuples: shape effectiveBgPre into the [u,v,loop,multi,
// crossDup] tuple ABCDKernel.replayGlobalRewireFromOps expects.
function globalPrePairsTuples(bgPre) {
  return bgPre.map(function (e) {
    return [e.u, e.v, !!e.loop, !!e.multi, !!e.crossDup];
  });
}
// clusterEdgeEkeys: cluster-post key set in the kernel's `${min}-${max}`
// format. Page's keyOf uses `|`, kernel uses `-`; this matches kernel
// so its `Set.has` succeeds.
function clusterEdgeEkeys(clusterPost) {
  const s = new Set();
  clusterPost.forEach(function (e) {
    const a = e.u < e.v ? e.u : e.v;
    const b = e.u < e.v ? e.v : e.u;
    s.add(a + "-" + b);
  });
  return s;
}

// ── Cluster-rewire range reroller ─────────────────────────────
// Re-spin the global op range [startG..endG-1] across every cluster
// touched by that range. Ops at positions < startG stay verbatim
// (opsBefore prefix); ops at positions >= startG draw fresh from a
// per-cluster RNG. clusterSeed orders fresh RNG per cluster by first-
// touch global op position so byte-identical overrides land regardless
// of walker entry (RandAll[1..k] vs RandStep[k..end] over same span).
//
// storeShape:
//   "byCluster" — return object keyed by cluster name (abcd's
//     opsOverride; consumed by an effectiveOps that merges per-cluster).
//   "flat"      — return flat array preserving baseOps' first-touch
//     cluster visit order (abcd+o's clusterRewireOpsOverride; consumed
//     by an effectiveOps that returns the array verbatim).
function rerollClusterRewireRange(opts) {
  const baseOps = opts.baseOps;
  const lo = Math.max(0, opts.startG);
  const hi = Math.min(opts.endG, baseOps.length);
  if (lo >= hi) return null;
  const opsBeforeByCluster = {};
  const clusterOrder = [];
  const seenInRange = new Set();
  for (let g = 0; g < hi; g++) {
    const c = baseOps[g].cluster;
    if (g < lo) {
      (opsBeforeByCluster[c] = opsBeforeByCluster[c] || []).push(baseOps[g]);
    } else if (!seenInRange.has(c)) {
      seenInRange.add(c);
      clusterOrder.push(c);
    }
  }
  const next = Object.assign({}, opts.currentByCluster || {});
  if (opts.storeShape === "flat") {
    const baseByCluster = {};
    baseOps.forEach(function (o) {
      (baseByCluster[o.cluster] = baseByCluster[o.cluster] || []).push(o);
    });
    Object.keys(baseByCluster).forEach(function (c) {
      if (!seenInRange.has(c)) next[c] = baseByCluster[c].slice();
    });
  }
  clusterOrder.forEach(function (cname, clusterSeed) {
    const opsBefore = opsBeforeByCluster[cname] || [];
    const prePairs = opts.prePairsByName(opts.R, cname);
    const fresh = opts.rngFor(clusterSeed);
    const newOps = opts.replayFromOps(prePairs, opsBefore, fresh);
    newOps.forEach(function (o) { o.cluster = cname; });
    next[cname] = opsBefore.concat(newOps);
  });
  if (opts.storeShape === "flat") {
    const visitOrder = [];
    const visited = new Set();
    baseOps.forEach(function (o) {
      if (!visited.has(o.cluster)) { visited.add(o.cluster); visitOrder.push(o.cluster); }
    });
    const flat = [];
    visitOrder.forEach(function (c) {
      (next[c] || []).forEach(function (o) { flat.push(o); });
    });
    return flat;
  }
  return next;
}

// ── ABCD cross-cluster final-swap re-roll ────────────────────
// Page-side replay of the kernel's final-stage rewire loop.
// Mirrors abcd_kernel.js:687-727 byte-for-byte. Used by abcd +
// abcd+o pages for local re-roll on the final-swap walker:
// applies ops [0..lo-1] deterministically using their stored
// (p2, coin, keep1, keep2), then runs fresh-rng loop from `lo`
// onward against the same fairness counter.
//
// opts:
//   edgesBefore   [[u,v], ...] from R.finalEdgesBefore
//   recycleBefore [[u,v], ...] from R.finalRecycleBefore
//   baseOps       current effective op list (includes any prior override)
//   lo            re-roll starts at op index `lo`
//   rng           fresh PRNG for ops [lo..end]
//
// Returns the new ops list (length may differ from baseOps if the
// fresh rng converges in fewer or more iterations).
function replayFinalSwap(opts) {
  const baseOps = opts.baseOps || [];
  const cap = Math.max(0, Math.min(opts.lo | 0, baseOps.length));
  const rng = opts.rng;
  const epair = (a, b) => a < b ? [a, b] : [b, a];
  const ek = (a, b) => a < b ? a + "-" + b : b + "-" + a;
  const edges = new Set();
  (opts.edgesBefore || []).forEach(([a, b]) => edges.add(ek(a, b)));
  const recycle = (opts.recycleBefore || []).map(p => p.slice());
  const out = [];
  for (let i = 0; i < cap; i++) {
    const op = baseOps[i];
    recycle.pop();
    edges.delete(ek(op.p2[0], op.p2[1]));
    [["newp1", "keep1"], ["newp2", "keep2"]].forEach(([nk, kk]) => {
      const np = op[nk];
      if (op[kk]) edges.add(ek(np[0], np[1]));
      else recycle.push(np.slice());
    });
    out.push({ p1: op.p1.slice(), p2: op.p2.slice(),
      newp1: op.newp1.slice(), newp2: op.newp2.slice(),
      coin: op.coin, keep1: op.keep1, keep2: op.keep2 });
  }
  let lr = recycle.length;
  let rc = lr;
  while (recycle.length > 0) {
    rc -= 1;
    if (rc < 0) {
      if (recycle.length < lr) { lr = recycle.length; rc = lr; }
      else break;
    }
    const p1 = recycle.pop();
    const arr = Array.from(edges);
    if (arr.length === 0) { recycle.push(p1); break; }
    const pickKey = arr[Math.floor(rng() * arr.length)];
    const p2 = pickKey.split("-").map(Number);
    edges.delete(pickKey);
    const coin = rng();
    let newp1, newp2;
    if (coin < 0.5) {
      newp1 = epair(p1[0], p2[0]);
      newp2 = epair(p1[1], p2[1]);
    } else {
      newp1 = epair(p1[0], p2[1]);
      newp2 = epair(p1[1], p2[0]);
    }
    let keep1, keep2;
    [newp1, newp2].forEach((np, i) => {
      const k = ek(np[0], np[1]);
      const bad = (np[0] === np[1]) || edges.has(k);
      if (i === 0) keep1 = !bad; else keep2 = !bad;
      if (bad) recycle.push(np);
      else edges.add(k);
    });
    out.push({ p1: p1.slice(), p2: p2.slice(),
      newp1: newp1.slice(), newp2: newp2.slice(),
      coin, keep1, keep2 });
  }
  return out;
}

// ── Cross-figure cursor follow rule ──────────────────────────
// Convention: when an upstream figure rerolls, downstream walkers
// reset to step 0 — UNLESS they were parked at the last step, in
// which case they follow to the new last step (drop-stale or final
// op). Lets the user RandAll an early stage and walk fresh through
// each downstream stage, while preserving "settled" views.
function followCursor(ctl, newTotal) {
  const wasAtEnd = ctl.idx >= ctl.total - 1;
  const target = wasAtEnd ? newTotal - 1 : 0;
  if (newTotal === ctl.total && target === ctl.idx) return;
  ctl.reconfigureKeep(newTotal, target);
}

// ── Page event bus ───────────────────────────────────────────
// Per-page publish/subscribe hub for cross-figure sync. Each
// downstream walker that depends on an upstream walker's reroll
// subscribes to the event the upstream publishes from its
// onAfterRand{Step,All}. Event names are page-defined (e.g.
// "stubChanged", "clusterPreChanged", "bgPreChanged").
//
//   const bus = NETGEN.makePageBus();
//   bus.subscribe("stubChanged", reconfigKeep);
//   bus.publish("stubChanged");
//
// Replaces ad-hoc onStubChanged / onUChanged listener arrays.
function makePageBus() {
  const subs = {};
  return {
    subscribe(name, fn) { (subs[name] = subs[name] || []).push(fn); },
    publish(name, payload) {
      (subs[name] || []).forEach((fn) => fn(payload));
    },
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
  // Highlight = dim-everything-else + thicken focus borders. Hovering a
  // graph node or a bar row dims every other node, every non-incident
  // edge, and every other row, while the focus node + its incident
  // edges + the matching row pick up the .hi class for a thicker
  // stroke (positive emphasis, paired with the negative dim).
  function focusOn(id) {
    const sid = String(id);
    viz.eachNode(function (n) {
      if (String(n.id) === sid) viz.addNodeClass(n.id, "hi");
      else viz.addNodeClass(n.id, "dim");
    });
    viz.eachEdge(function (e) {
      const su = String(e.source.id != null ? e.source.id : e.source);
      const sv = String(e.target.id != null ? e.target.id : e.target);
      if (su === sid || sv === sid) viz.addEdgeClass(e.id, "hi");
      else viz.addEdgeClass(e.id, "dim");
    });
    gBars.selectAll(sel).each(function () {
      if (this.getAttribute(attr) === sid) this.classList.add("hi");
      else this.classList.add("dim");
    });
  }
  function focusClear() {
    viz.eachNode(function (n) {
      viz.removeNodeClass(n.id, "dim");
      viz.removeNodeClass(n.id, "hi");
    });
    viz.eachEdge(function (e) {
      viz.removeEdgeClass(e.id, "dim");
      viz.removeEdgeClass(e.id, "hi");
    });
    gBars.selectAll(sel).each(function () {
      this.classList.remove("dim");
      this.classList.remove("hi");
    });
  }
  gBars.on("mouseover", function (ev) {
    const el = ev.target.closest(sel);
    if (el) focusOn(el.getAttribute(attr));
  });
  gBars.on("mouseout", function (ev) {
    const el = ev.target.closest(sel);
    if (el) focusClear();
  });
  viz.onNodeHoverEnter(function (d) { focusOn(d.id); });
  viz.onNodeHoverLeave(function () { focusClear(); });
}

// Group-level variant of bindRowNodeHover: hovering a row tied to a
// cluster (data-name="C1" / "S19" / ...) dims everything outside the
// cluster's node set and lights everything inside it. Hovering a node
// resolves its cluster via opts.nameOfNode(id) and reuses the same
// focus. opts:
//   gBars         d3 selection containing the rows
//   viz           NETGEN.VIZ instance
//   nodesByName   { <name>: [nodeId, ...] }
//   nameOfNode    optional (id) => name; default reads from CLUSTER_OF
//                 if you set opts.useClusterOf=true
//   rowSelector   default ".cs-bar-row"
//   idAttr        default "data-name"
function bindClusterRowHover(gBars, viz, opts) {
  const sel = (opts && opts.rowSelector) || ".cs-bar-row";
  const attr = (opts && opts.idAttr) || "data-name";
  const nodesByName = opts.nodesByName;
  const nameOfNode = opts.nameOfNode;
  function focusOn(name) {
    const ids = (nodesByName && nodesByName[name]) || [];
    const set = new Set(ids.map(String));
    viz.eachNode(function (n) {
      if (set.has(String(n.id))) viz.addNodeClass(n.id, "hi");
      else viz.addNodeClass(n.id, "dim");
    });
    viz.eachEdge(function (e) {
      const su = String(e.source.id != null ? e.source.id : e.source);
      const sv = String(e.target.id != null ? e.target.id : e.target);
      if (set.has(su) && set.has(sv)) viz.addEdgeClass(e.id, "hi");
      else viz.addEdgeClass(e.id, "dim");
    });
    gBars.selectAll(sel).each(function () {
      if (this.getAttribute(attr) === name) this.classList.add("hi");
      else this.classList.add("dim");
    });
  }
  function focusClear() {
    viz.eachNode(function (n) {
      viz.removeNodeClass(n.id, "dim");
      viz.removeNodeClass(n.id, "hi");
    });
    viz.eachEdge(function (e) {
      viz.removeEdgeClass(e.id, "dim");
      viz.removeEdgeClass(e.id, "hi");
    });
    gBars.selectAll(sel).each(function () {
      this.classList.remove("dim");
      this.classList.remove("hi");
    });
  }
  gBars.on("mouseover", function (ev) {
    const el = ev.target.closest(sel);
    if (el) focusOn(el.getAttribute(attr));
  });
  gBars.on("mouseout", function (ev) {
    const el = ev.target.closest(sel);
    if (el) focusClear();
  });
  if (nameOfNode) {
    viz.onNodeHoverEnter(function (d) { focusOn(nameOfNode(parseInt(d.id, 10))); });
    viz.onNodeHoverLeave(function () { focusClear(); });
  }
}

// Canonical unordered-pair key: min|max of the two endpoints. Used by
// every walker that detects parallels / cross-stage dups via a Set.
function keyOf(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

// Generic walker suffix-reseed primitive. SBM's urn+budget reseedFrom
// is the reference shape; ABCD / ABCD+o / LFR stub-pool walkers and
// matcher's algo-replay walkers all reduce to the same three-step
// pattern: fresh state -> replay kept prefix -> sample fresh tail.
function reseedSuffix(spec) {
  const state = spec.makeFreshState();
  spec.replayPrefix(state, spec.prefix);
  return spec.sampleTail(state, spec.rng || Math.random);
}

// Config-model stub-pool specialisation of reseedSuffix. Every stub-
// pool caller (ABCD cluster + bg, ABCD+o cluster + bg, LFR config-
// model) shares the same state shape: a remaining-stub Map keyed by
// member + a localEdges Set of accepted-good keys. Caller supplies
// only the per-pair classify() — the part that actually varies.
//
// spec:
//   layout    { members[], wIn[], numPairs }
//   prefix    kept pair entries (each with u, v, and optional
//             loop / multi / crossDup flags consumed by replay)
//   classify  (a, b, ctx) -> new pair entry; ctx exposes
//             { localEdges: Set, add: key => void } so the caller
//             can detect parallels and accept good edges
//   rng       optional
//
// Returns the new tail (array of classify() outputs).
function stubPoolReseed(spec) {
  const lay = spec.layout;
  return reseedSuffix({
    prefix: spec.prefix,
    rng: spec.rng,
    makeFreshState: () => {
      const remaining = new Map();
      lay.members.forEach((v, i) => remaining.set(v, lay.wIn[i]));
      return { remaining, localEdges: new Set() };
    },
    replayPrefix: (s, prefix) => prefix.forEach(p => {
      s.remaining.set(p.u, (s.remaining.get(p.u) || 0) - 1);
      s.remaining.set(p.v, (s.remaining.get(p.v) || 0) - 1);
      if (!p.loop && !p.multi && !p.crossDup) s.localEdges.add(keyOf(p.u, p.v));
    }),
    sampleTail: (s, rng) => {
      const tail = [];
      lay.members.forEach(v => {
        const cnt = s.remaining.get(v) || 0;
        for (let k = 0; k < cnt; k++) tail.push(v);
      });
      for (let i = tail.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [tail[i], tail[j]] = [tail[j], tail[i]];
      }
      const ctx = { localEdges: s.localEdges, add: k => s.localEdges.add(k) };
      const out = [];
      for (let i = 0; i + 1 < tail.length; i += 2) {
        out.push(spec.classify(tail[i], tail[i + 1], ctx));
      }
      return out;
    },
  });
}

// ── Export ────────────────────────────────────────────────────
global.NETGEN = {
  POSITIONS, NODES, EDGES, CLUSTER_OF, DEGREES, DEGREES_EXCL, MINCUTS,
  MIN_CUT_EDGES, MIN_CUT_ISOLATE,
  C1, C2, C3, OUT, INTRA, INTER, OUT_EDGES,
  CORE_NODES, CORE_EDGES, topK, cliqueEdges,
  COLORS, CY, VIZ,
  makeTooltip, scrubSlider, stepController, walkerRow, wireWalker, rerollWalker, makePageBus, makeRewireStateAtStep, makeRewireRender, clusterPostBackdrop, followCursor, clusterPrePairsByName, globalPrePairsTuples, clusterEdgeEkeys, rerollClusterRewireRange, replayFinalSwap, abcdClusterRewireApplyOp, abcdBgRewireApplyOp, snapOrSync, diffPlacedById, playManyDiff, singletonOpener, defaultSingletonClusters, bindPanelToggle, mountGxPanel, walkerMarkPlaced, walkerMarkJust, reseedSuffix, stubPoolReseed, keyOf, toggle,
  SKIP: SKIP_SENTINEL,
  linksRow, kinSection,
  fitViewBoxAttr,
  retypeset,
  bindRowNodeHover, bindClusterRowHover,
  EdgePaths,
  BridgeAnim,
};

})(window);
