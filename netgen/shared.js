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
  // C2 is K_4 on {9..12} plus {13,14}.
  C2: [
    [9,10],[9,11],[9,12],[9,13],
    [10,11],[10,12],[10,14],
    [11,12],[11,14],
    [12,13],
    [13,14],
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

const MINCUTS = { C1: 3, C2: 2, C3: 1 };

// Top-(k+1) nodes per cluster by degree desc, id asc tiebreak
function topK(cluster_nodes, k) {
  return cluster_nodes
    .map(n => ({n, d: DEGREES[n]}))
    .sort((a,b) => (b.d - a.d) || (a.n - b.n))
    .slice(0, k+1)
    .map(o => o.n);
}
const CORE_NODES = {
  C1: topK(C1, MINCUTS.C1),  // 4 nodes
  C2: topK(C2, MINCUTS.C2),  // 3 nodes
  C3: topK(C3, MINCUTS.C3),  // 2 nodes
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

// ── Cytoscape defaults ───────────────────────────────────────
const CY = {
  baseStyle(opts = {}) {
    // opts: { showLabels (bool): show numeric labels on nodes. }
    const lblOn = !!opts.showLabels;
    return [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "background-gradient-stop-colors": (ele) => {
            const c = ele.data("color") || "#7b9bd6";
            return `${c} ${c}`;
          },
          "width": "data(size)",
          "height": "data(size)",
          "border-width": 2,
          "border-color": "#1b2033",
          "border-opacity": 1,
          "label": lblOn ? "data(id)" : "",
          "font-family": "Special Elite, Courier New, monospace",
          "font-size": 11,
          "font-weight": "400",
          "color": "#1b2033",
          "text-valign": "center",
          "text-halign": "center",
          "text-outline-color": "#f3ecd7",
          "text-outline-width": 1.5,
          "overlay-padding": 6,
          "overlay-opacity": 0,
          "transition-property": "background-color, opacity, border-color, border-width, width, height",
          "transition-duration": 220,
          "transition-timing-function": "ease-in-out",
        },
      },
      {
        selector: "node.dim",
        style: { "opacity": 0.25 },
      },
      {
        selector: "node.hi",
        style: { "border-color": COLORS.paper, "border-width": 2.5 },
      },
      {
        selector: "node.core",
        style: { "border-color": COLORS.paper, "border-width": 2 },
      },
      {
        selector: "edge",
        style: {
          "width": "data(w)",
          "line-color": "data(color)",
          "curve-style": "bezier",
          "control-point-step-size": 25,
          "line-cap": "round",
          "opacity": 0.82,
          "transition-property": "line-color, opacity, width, line-style",
          "transition-duration": 220,
          "transition-timing-function": "ease-in-out",
        },
      },
      {
        selector: "edge.dim",
        style: { "opacity": 0.2 },
      },
      {
        selector: "edge.hidden",
        style: { "opacity": 0 },
      },
      {
        selector: "edge.dashed",
        style: { "line-style": "dashed" },
      },
      {
        selector: "edge.thick",
        style: { "width": 3.5 },
      },
    ];
  },

  baseElements(opts = {}) {
    // opts: { includeOutliers (bool, default true), nodeColor(n) → color override,
    //         edges: [{u,v,color,w,classes?}] }
    const includeOutliers = opts.includeOutliers !== false;
    const nodes = NODES
      .filter(n => includeOutliers || CLUSTER_OF[n] !== "OUT")
      .map(n => ({
        data: {
          id: String(n),
          color: opts.nodeColor ? opts.nodeColor(n) : COLORS[CLUSTER_OF[n]],
          size: 26,
        },
        position: { x: POSITIONS[n].x, y: POSITIONS[n].y },
      }));
    const edges = (opts.edges || []).map((e, i) => ({
      data: {
        id: e.id || `e-${e.u}-${e.v}-${i}`,
        source: String(e.u), target: String(e.v),
        color: e.color || COLORS.edge_stage2,
        w: e.w == null ? 1.6 : e.w,
      },
      classes: e.classes || "",
    }));
    return [...nodes, ...edges];
  },

  init(containerId, opts = {}) {
    const cy = cytoscape({
      container: document.getElementById(containerId),
      style: CY.baseStyle(opts),
      elements: CY.baseElements(opts),
      layout: { name: "preset" },
      minZoom: 0.5, maxZoom: 2.5,
      wheelSensitivity: 0.25,
      autounselectify: true,
      autoungrabify: false,
    });
    cy.fit(undefined, 40);
    window.addEventListener("resize", () => {
      cy.resize();
      cy.fit(undefined, 40);
    }, { passive: true });
    return cy;
  },
};

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

function makeTooltip(cy, container) {
  const tip = document.createElement("div");
  tip.className = "cy-tooltip";
  container.appendChild(tip);
  function place(rx, ry) {
    const rect = container.getBoundingClientRect();
    let x = rx + 14, y = ry + 14;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > rect.width - 8)  x = rx - tw - 12;
    if (y + th > rect.height - 8) y = ry - th - 8;
    tip.style.left = x + "px";
    tip.style.top  = y + "px";
  }
  cy.on("mouseover", "node", e => {
    const n = e.target;
    const id = parseInt(n.id(), 10);
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
    const { x, y } = n.renderedPosition();
    place(x, y);
  });
  cy.on("mouseover", "edge", e => {
    const edge = e.target;
    const src = edge.source().id();
    const tgt = edge.target().id();
    const kind = __edgeKind(parseInt(src, 10), parseInt(tgt, 10));
    tip.innerHTML =
      '<div class="hd">edge</div>' +
      '<div><b>' + src + '</b>, <b>' + tgt + '</b></div>' +
      '<div class="dim">' + kind + '</div>';
    tip.classList.add("on");
    const mid = edge.midpoint ? edge.midpoint() : null;
    const rp = mid && mid.x != null ? mid : edge.renderedBoundingBox();
    const rx = rp.x != null ? rp.x : (rp.x1 + rp.x2) / 2;
    const ry = rp.y != null ? rp.y : (rp.y1 + rp.y2) / 2;
    place(rx, ry);
  });
  cy.on("mouseout", "node edge", () => tip.classList.remove("on"));
  cy.on("pan zoom", () => tip.classList.remove("on"));
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
  const { prevBtn, nextBtn, resetBtn, labelCur, labelTotal, total, onRender } = opts;
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
  return { get idx() { return idx; }, set: (i) => { idx = Math.max(0, Math.min(total-1, i)); render(); } };
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
  POSITIONS, NODES, EDGES, CLUSTER_OF, DEGREES, MINCUTS,
  C1, C2, C3, OUT, INTRA, INTER, OUT_EDGES,
  CORE_NODES, CORE_EDGES, topK, cliqueEdges,
  COLORS, CY,
  makeTooltip, scrubSlider, stepController, toggle,
  linksRow, kinSection,
};

})(window);
