/* ═══════════════════════════════════════════════════════════════
   netgen/_shared.js — shared data, constants, and helper widgets
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
  // C1 cluster (top)
  1:  {x:    0, y: -145},
  2:  {x:  -32, y: -130},
  3:  {x:   30, y: -125},
  4:  {x:  -12, y: -175},
  5:  {x:  -58, y: -160},
  6:  {x:   50, y: -165},
  7:  {x:   28, y: -200},
  8:  {x:  -40, y: -205},
  // C2 cluster (bottom-right)
  9:  {x:  155, y:   90},
  10: {x:  190, y:  115},
  11: {x:  130, y:  120},
  12: {x:  185, y:   65},
  13: {x:  215, y:  140},
  14: {x:  125, y:   75},
  // C3 cluster (bottom-left)
  15: {x: -155, y:   90},
  16: {x: -195, y:  115},
  17: {x: -125, y:  120},
  18: {x: -140, y:   65},
  // Outliers (origin)
  19: {x:  -25, y:   -5},
  20: {x:   25, y:    5},
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
  C1: [[1,2],[1,3],[1,4],[2,3],[2,4],[3,4],[1,5],[2,6],[3,7],[4,8],[5,6],[7,8]],
  C2: [[9,10],[9,11],[10,11],[9,12],[10,13],[11,14],[12,14]],
  C3: [[15,16],[15,17],[16,18]],
};
const INTER = [
  [1,9], [2,10], [5,12],      // C1-C2
  [9,15], [11,16],             // C2-C3
  [1,15], [4,17],              // C1-C3
];
const OUT_EDGES = [[19,3],[19,10],[20,16],[20,5]];

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

// ── Color palette ────────────────────────────────────────────
const COLORS = {
  C1: "#78b4ff", C2: "#ffc66b", C3: "#6bffc9", OUT: "#ff6b7a",
  edge_intra: {C1:"#78b4ff", C2:"#ffc66b", C3:"#6bffc9"},
  edge_inter: "#3a66cc",
  edge_stage2: "#a0ccff",
  edge_stage3: "#c38bff",
  edge_stage4: "#8494be",
  edge_drop:   "#ff6b7a",
  faint: "#4e5f8a",
  paper:"#f4f6fb", paper_2:"#c0cceb", paper_3:"#8494be",
  ink:"#0b1120", ink_2:"#121a36",
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
          "width": "data(size)",
          "height": "data(size)",
          "border-width": 1.5,
          "border-color": "#121a36",
          "label": lblOn ? "data(id)" : "",
          "font-family": "JetBrains Mono, monospace",
          "font-size": 10,
          "color": "#f4f6fb",
          "text-valign": "center",
          "text-halign": "center",
          "text-outline-color": "#0b1120",
          "text-outline-width": 2,
          "overlay-padding": 6,
          "transition-property": "background-color, opacity, border-color, width, height",
          "transition-duration": 180,
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
          "curve-style": "straight",
          "opacity": 0.85,
          "transition-property": "line-color, opacity, width, line-style",
          "transition-duration": 180,
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
          size: 22,
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
      autoungrabify: true,
    });
    cy.fit(undefined, 30);
    window.addEventListener("resize", () => cy.resize(), { passive: true });
    return cy;
  },
};

// ── Tooltip helper ───────────────────────────────────────────
function makeTooltip(cy, container) {
  const tip = document.createElement("div");
  tip.className = "cy-tooltip";
  container.appendChild(tip);
  cy.on("mouseover", "node", e => {
    const n = e.target;
    const id = n.id();
    const cl = CLUSTER_OF[id] || "?";
    const deg = DEGREES[id];
    tip.innerHTML = `node <b>${id}</b> &middot; ${cl} &middot; deg ${deg}`;
    tip.classList.add("on");
    const { x, y } = n.renderedPosition();
    tip.style.left = (x + 14) + "px";
    tip.style.top = (y - 14) + "px";
  });
  cy.on("mouseout", "node", () => tip.classList.remove("on"));
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

// ── Site-link bar HTML ───────────────────────────────────────
function linksRow(opts = {}) {
  const {
    gen,           // 'sbm', 'ec-sbm-v1', etc., or null for main page
    hasIndex = true,
  } = opts;
  const REPO = "https://github.com/vltanh/network-generation";
  const PROJECT = "https://vltanh.me/projects/network-generation/";
  const links = [];
  if (gen) {
    links.push({
      text: "algorithm notes",
      href: `${REPO}/blob/main/docs/algorithms/${gen}.md`,
      ext: true,
      primary: true,
    });
  } else {
    links.push({
      text: "algorithm docs",
      href: `${REPO}/tree/main/docs/algorithms`,
      ext: true,
      primary: true,
    });
  }
  if (hasIndex) {
    links.push({ text: "all generators", href: "./", ext: false, primary: false });
  }
  links.push({ text: "project page", href: PROJECT, ext: false, primary: true });
  links.push({
    text: "source",
    href: REPO,
    ext: true,
    primary: false,
    icon: `<svg height="12" width="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
  });
  return `<nav class="site-links" aria-label="site links">${
    links.map(l => {
      const ext = l.ext ? ' target="_blank" rel="noopener"' : "";
      const cls = "site-link" + (l.primary ? "" : " ghost");
      const icon = l.icon || "";
      return `<a class="${cls}" href="${l.href}"${ext}>${icon}${l.text}</a>`;
    }).join("")
  }</nav>`;
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
