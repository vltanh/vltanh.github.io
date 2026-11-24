// The Morrey page: every figure is drawn and every number computed here, from the
// mathematics in math.js.
import * as M from "./math.js";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function make(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function html(tag, attrs, parent, inner) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (inner !== undefined) e.innerHTML = inner;
  if (parent) parent.append(e);
  return e;
}

const empty = (g) => g.replaceChildren();

// A number with a true minus sign, and no "−0".
function num(x, d = 2) {
  if (!Number.isFinite(x)) return "∞";
  let s = x.toFixed(d);
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  return s.replace("-", "−");
}
const big = (n) => n.toLocaleString("en-US");
const short = (x) => num(x, 2).replace(/\.?0+$/, "");
const pts = (P) => P.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

// The drawing area of an SVG in CSS pixels, and the map from the world box to it.
function fitView(svg, box, pad = 12) {
  const w = svg.clientWidth || 300;
  const h = svg.clientHeight || 300;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const s = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  const ox = w / 2 - (s * (box.x0 + box.x1)) / 2;
  const oy = h / 2 + (s * (box.y0 + box.y1)) / 2;
  return {
    w,
    h,
    s,
    P: ([x, y]) => [ox + s * x, oy - s * y],
    inv: (px, py) => [(px - ox) / s, (oy - py) / s],
  };
}

function pointer(svg, e) {
  const r = svg.getBoundingClientRect();
  return [e.clientX - r.left - svg.clientLeft, e.clientY - r.top - svg.clientTop];
}

// Redraw a figure when its box changes size.
function onResize(el, draw) {
  new ResizeObserver(() => draw()).observe(el);
}

function animate(from, to, ms, step, done) {
  if (reduced() || ms <= 0) {
    step(to);
    if (done) done();
    return;
  }
  const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    step(M.lerp(from, to, ease(t)));
    if (t < 1) requestAnimationFrame(tick);
    else if (done) done();
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ drawing a matrix

const square = (A) => [[0, 0], M.apply(A, [1, 0]), M.apply(A, [1, 1]), M.apply(A, [0, 1])];
const isFlat = (A) => M.frob(A) > 1e-6 && Math.abs(M.det(A)) <= 1e-6 * Math.max(1, M.frob2(A));
const shapeClass = (A, extra = "") => `shape ${extra}${isFlat(A) ? " flat" : M.det(A) < 0 ? " flipped" : ""}`;

function arrow(g, P0, P1, label) {
  const a = make("g", { class: "arrow" }, g);
  const dx = P1[0] - P0[0];
  const dy = P1[1] - P0[1];
  const L = Math.hypot(dx, dy);
  if (L < 2) return a;
  const ux = dx / L;
  const uy = dy / L;
  const hl = Math.min(10, L * 0.45);
  const hw = hl * 0.48;
  const bx = P1[0] - ux * hl;
  const by = P1[1] - uy * hl;
  make("line", { x1: P0[0], y1: P0[1], x2: bx + ux, y2: by + uy }, a);
  make(
    "polygon",
    {
      points: pts([P1, [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]]),
    },
    a
  );
  if (label) {
    const t = make("text", { x: P1[0] + ux * 12 - 4, y: P1[1] + uy * 12 + 4 }, a);
    t.textContent = label;
  }
  return a;
}

// A square, deformed by a matrix, with its two arrows; the arrow tips can be dragged
// when the matrix is editable. opts: get, set, box, name, cls, editable, limit, onDrag.
function squareFigure(svg, opts) {
  const L = {
    grid: make("g", {}, svg),
    ref: make("g", {}, svg),
    shape: make("g", {}, svg),
    arrows: make("g", {}, svg),
    handles: make("g", {}, svg),
  };
  let view = null;
  const lim = opts.limit || [-0.8, 1.8];
  const tip = (A, col) => (col === 0 ? [A[0], A[2]] : [A[1], A[3]]);
  const which = ["first", "second"];
  const side = ["bottom", "left"];

  function setTip(col, p, how) {
    const A = opts.get().slice();
    const x = Math.round(clamp(p[0], lim[0], lim[1]) * 100) / 100;
    const y = Math.round(clamp(p[1], lim[0], lim[1]) * 100) / 100;
    if (col === 0) {
      A[0] = x;
      A[2] = y;
    } else {
      A[1] = x;
      A[3] = y;
    }
    opts.set(A, how);
  }

  const handles = [];
  if (opts.editable) {
    for (const col of [0, 1]) {
      const g = make("g", { class: "handle", tabindex: "0", role: "button", "aria-roledescription": "draggable point" }, L.handles);
      make("circle", { class: "hit", r: 18 }, g);
      make("circle", { class: "ring", r: 12 }, g);
      make("circle", { class: "knob", r: 6.5 }, g);
      let dragging = false;
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        g.setPointerCapture(e.pointerId);
        dragging = true;
        g.classList.add("dragging");
        svg.classList.add("dragging");
        g.focus({ preventScroll: true });
      });
      g.addEventListener("pointermove", (e) => {
        if (!dragging || !view) return;
        const [px, py] = pointer(svg, e);
        setTip(col, view.inv(px, py), "drag");
      });
      const stop = () => {
        dragging = false;
        g.classList.remove("dragging");
        svg.classList.remove("dragging");
        if (opts.onDrop) opts.onDrop();
      };
      g.addEventListener("pointerup", stop);
      g.addEventListener("pointercancel", stop);
      g.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 0.2 : 0.05;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
        if (!d) return;
        e.preventDefault();
        const t = tip(opts.get(), col);
        setTip(col, [t[0] + d[0], t[1] + d[1]], "key");
      });
      handles.push(g);
    }
  }

  function draw() {
    const A = opts.get();
    const box = typeof opts.box === "function" ? opts.box(A) : opts.box || { x0: -0.9, x1: 1.9, y0: -0.9, y1: 1.9 };
    view = fitView(svg, box, opts.pad ?? 10);
    const P = view.P;
    empty(L.grid);
    if (opts.grid !== false) {
      for (let k = Math.ceil(box.x0); k <= Math.floor(box.x1); k++) {
        make("line", { class: k === 0 ? "axis" : "gridline", x1: P([k, box.y0 - 9])[0], y1: 0, x2: P([k, 0])[0], y2: view.h }, L.grid);
      }
      for (let k = Math.ceil(box.y0); k <= Math.floor(box.y1); k++) {
        make("line", { class: k === 0 ? "axis" : "gridline", x1: 0, y1: P([0, k])[1], x2: view.w, y2: P([0, k])[1] }, L.grid);
      }
    }
    empty(L.ref);
    if (opts.ref !== false) make("polygon", { class: "ref", points: pts(square(opts.refMatrix ? opts.refMatrix() : M.I).map(P)) }, L.ref);
    empty(L.shape);
    make("polygon", { class: opts.shapeClass ? opts.shapeClass(A) : shapeClass(A, opts.cls || ""), points: pts(square(A).map(P)) }, L.shape);
    empty(L.arrows);
    const O = P([0, 0]);
    arrow(L.arrows, O, P(tip(A, 0)), opts.labels ? "1" : "");
    arrow(L.arrows, O, P(tip(A, 1)), opts.labels ? "2" : "");
    handles.forEach((g, col) => {
      const t = tip(A, col);
      const [x, y] = P(t);
      g.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      g.setAttribute(
        "aria-label",
        `Tip of the ${which[col]} arrow of ${opts.name}, where the ${side[col]} side goes: (${num(t[0])}, ${num(t[1])}). Move it with the arrow keys.`
      );
    });
  }
  onResize(svg, draw);
  return { draw };
}

// ------------------------------------------------------------------ the hero: layers

const hero = {
  A: [1.05, 0.3, -0.05, 0.95],
  C: null,
  n: [0, 1],
  count: 8,
};
hero.C0 = M.add(hero.A, M.outer([-0.72, 0.16], [Math.cos(1.31), Math.sin(1.31)]));
hero.C = hero.A.slice();

const lamSvg = $("lam");
const lamLayer = {
  layers: make("g", {}, lamSvg),
  marks: make("g", {}, lamSvg),
};

function heroState() {
  const f = M.interfaceOf(hero.A, hero.C, hero.n);
  const fits = f.size > 1e-9 && f.mismatch <= 1e-7 * (1 + f.size);
  const same = f.size <= 1e-9;
  return { f, fits, same };
}

function drawLam() {
  const { f, fits, same } = heroState();
  hero.n = f.n;
  const lam = M.laminate(hero.A, hero.C, f.n, hero.count);
  let ex = 1.05;
  let ey = 1.05;
  for (const L of lam.layers) {
    for (const [x, y] of L.image) {
      ex = Math.max(ex, Math.abs(x));
      ey = Math.max(ey, Math.abs(y));
    }
  }
  const v = fitView(lamSvg, { x0: -ex, x1: ex, y0: -ey, y1: ey }, 22);
  empty(lamLayer.layers);
  empty(lamLayer.marks);
  let lattice = "";
  for (const L of lam.layers) {
    if (L.image.length < 3) continue;
    make("polygon", { class: `layer ${L.k % 2 === 0 ? "a" : "c"}`, points: pts(L.image.map(v.P)) }, lamLayer.layers);
    // The lines of a square grid drawn on the sheet, as each layer carries them.
    for (let k = 1; k < 12; k++) {
      const c = -1 + k / 6;
      for (const dir of [0, 1]) {
        const seg = clipLine(L.poly, dir === 0 ? [c, -2] : [-2, c], dir === 0 ? [0, 1] : [1, 0]);
        if (!seg) continue;
        const [a, b] = seg.map((x) => {
          const y = M.apply(L.M, x);
          return v.P([y[0] + L.b[0], y[1] + L.b[1]]);
        });
        lattice += `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`;
      }
    }
  }
  if (lattice) make("path", { class: "lattice", d: lattice }, lamLayer.layers);
  if (!same) {
    for (const g of lam.interfaces) {
      if (fits) {
        make(
          "line",
          { class: "seam", x1: v.P(g.below[0])[0], y1: v.P(g.below[0])[1], x2: v.P(g.below[1])[0], y2: v.P(g.below[1])[1] },
          lamLayer.marks
        );
      } else {
        make("polygon", { class: "crack", points: pts([g.below[0], g.below[1], g.above[1], g.above[0]].map(v.P)) }, lamLayer.marks);
      }
    }
  }
}

const matA = squareFigure($("matA"), {
  name: "A",
  cls: "a",
  editable: true,
  get: () => hero.A,
  set: (A, how) => {
    hero.A = magnet(A, hero.C, how, "A");
    drawHero();
  },
});
const matC = squareFigure($("matC"), {
  name: "C",
  cls: "c",
  editable: true,
  get: () => hero.C,
  set: (C, how) => {
    hero.C = magnet(C, hero.A, how, "C");
    drawHero();
  },
});
const matD = squareFigure($("matD"), {
  name: "C − A",
  editable: false,
  grid: false,
  get: () => M.sub(hero.C, hero.A),
  shapeClass: (D) => (heroState().fits ? "shape flat" : "shape ghost"),
  box: (D) => {
    let e = 0.6;
    for (const [x, y] of square(D)) e = Math.max(e, Math.abs(x), Math.abs(y));
    return { x0: -e, x1: e, y0: -e, y1: e };
  },
  pad: 8,
});

// The part of the line p + s d (s ∈ ℝ) inside a convex polygon, or null.
function clipLine(poly, p, d) {
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i];
    const Q = poly[(i + 1) % poly.length];
    // inward normal of the edge PQ, for a counter-clockwise polygon
    const nx = -(Q[1] - P[1]);
    const ny = Q[0] - P[0];
    const num0 = nx * (p[0] - P[0]) + ny * (p[1] - P[1]);
    const den = nx * d[0] + ny * d[1];
    if (Math.abs(den) < 1e-14) {
      if (num0 < 0) return null;
      continue;
    }
    const s = -num0 / den;
    if (den > 0) lo = Math.max(lo, s);
    else hi = Math.min(hi, s);
  }
  if (!(hi > lo + 1e-12)) return null;
  return [
    [p[0] + lo * d[0], p[1] + lo * d[1]],
    [p[0] + hi * d[0], p[1] + hi * d[1]],
  ];
}

// While a tip is dragged, a matrix close to fitting clicks into place.
function magnet(X, other, how, which) {
  if (how !== "drag") return X;
  const D = which === "C" ? M.sub(X, other) : M.sub(other, X);
  const s = M.svd(D);
  if (s.s1 > 0.08 && s.s2 < 0.045) {
    const R = M.nearestRankOne(D);
    return which === "C" ? M.add(other, R) : M.sub(other, R);
  }
  return X;
}

let lastHeroStatus = "";
function drawHero() {
  drawLam();
  matA.draw();
  matC.draw();
  matD.draw();
  const { f, fits, same } = heroState();
  let s;
  if (same) {
    s = "<i>C</i> equals <i>A</i>: the sheet is deformed the same way everywhere.";
  } else if (fits) {
    s =
      '<span class="fit">The layers fit.</span> <i>C</i> − <i>A</i> has rank one: it squashes the square flat (blue), and the interfaces run along the one direction it crushes to nothing.';
  } else {
    s = `<span class="bad">The layers do not fit.</span> <i>C</i> − <i>A</i> has rank two, so every interface opens a crack at one end and overlaps at the other. The gap grows by ${num(
      f.mismatch
    )} per unit of length.`;
  }
  if (s !== lastHeroStatus) {
    $("lam-status").innerHTML = s;
    lastHeroStatus = s;
  }
}

onResize(lamSvg, drawLam);

$("lam-count").addEventListener("input", () => {
  hero.count = +$("lam-count").value;
  $("lam-count-out").textContent = hero.count;
  drawLam();
});
$("lam-count-out").textContent = hero.count;

$("lam-fit").addEventListener("click", () => {
  const D = M.sub(hero.C, hero.A);
  const target = M.add(hero.A, M.nearestRankOne(D));
  animate(
    hero.C.slice(),
    target,
    450,
    (C) => {
      hero.C = C;
      drawHero();
    },
    () => {
      hero.C = target;
      drawHero();
    }
  );
});

let heroSeed = 99;
const heroRand = () => (heroSeed = (heroSeed * 16807) % 2147483647) / 2147483647;
$("lam-other").addEventListener("click", () => {
  let target;
  let tries = 0;
  do {
    target = M.add(hero.A, M.randomMatrix(heroRand, 0.6));
    tries++;
  } while (
    tries < 200 &&
    (M.svd(M.sub(target, hero.A)).s2 < 0.08 || M.svd(M.sub(target, hero.A)).s2 > 0.22 || target.some((x) => x < -0.8 || x > 1.8))
  );
  animate(hero.C.slice(), target, 450, (C) => {
    hero.C = C;
    drawHero();
  });
});

// The opening: C moves away from A, and the layers open into a zigzag.
drawHero();
setTimeout(
  () =>
    animate(
      hero.A.slice(),
      hero.C0,
      1300,
      (C) => {
        hero.C = C;
        drawHero();
      },
      () => {
        hero.C = hero.C0.slice();
        drawHero();
      }
    ),
  reduced() ? 0 : 350
);

// ------------------------------------------------------------------ a matrix is a deformed square

const sq = { A: [1.4, 0.45, 0.2, 0.9] };
function writeMatrix(el, A) {
  el.innerHTML = [A[0], A[1], A[2], A[3]].map((x) => `<span>${num(x)}</span>`).join("");
}
const sqFig = squareFigure($("sq"), {
  name: "A",
  editable: true,
  labels: true,
  limit: [-1.1, 1.9],
  box: { x0: -1.2, x1: 2.0, y0: -1.2, y1: 2.0 },
  get: () => sq.A,
  set: (A) => {
    sq.A = A;
    drawSq();
  },
});
let lastSqNote = "";
function drawSq() {
  sqFig.draw();
  const A = sq.A;
  writeMatrix($("sq-matrix"), A);
  const d = M.det(A);
  $("sq-area").innerHTML = `Area factor det <i>A</i> = <b>${num(d)}</b>`;
  let note;
  if (M.frob(A) < 1e-9) note = "The square is crushed to a point: <i>A</i> = 0.";
  else if (isFlat(A)) note = '<span class="fit">Squashed flat onto a segment: <i>A</i> has rank one.</span>';
  else if (d < 0) note = "Negative: the square is turned over, as in a mirror.";
  else if (Math.abs(d - 1) < 0.005) note = "The area is unchanged.";
  else note = d > 1 ? `The area is multiplied by ${num(d)}.` : `The area shrinks to ${num(d * 100, 0)}% of the square's.`;
  if (note !== lastSqNote) {
    $("sq-note").innerHTML = note;
    lastSqNote = note;
  }
}
for (const b of document.querySelectorAll("#square ~ figure .presets button")) {
  if (!b.closest("figure").contains($("sq"))) continue;
  b.addEventListener("click", () => {
    const target = b.dataset.m.split(",").map(Number);
    animate(sq.A.slice(), target, 350, (A) => {
      sq.A = A;
      drawSq();
    });
  });
}
drawSq();

// ------------------------------------------------------------------ energy of a sheet

const en = { N: 12, sel: [7, 4], bend: 1 };
// A smooth deformation of the unit square, with a bend amplitude.
const enMap = ([x, y], s) => [
  x + s * (0.1 * Math.sin(2 * Math.PI * y) + 0.16 * x * y),
  y + s * (0.22 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y) - 0.08 * x + 0.06 * Math.sin(3 * x)),
];
function enGrad(p, s) {
  const h = 1e-5;
  const a = enMap([p[0] + h, p[1]], s);
  const b = enMap([p[0] - h, p[1]], s);
  const c = enMap([p[0], p[1] + h], s);
  const d = enMap([p[0], p[1] - h], s);
  return [(a[0] - b[0]) / (2 * h), (c[0] - d[0]) / (2 * h), (a[1] - b[1]) / (2 * h), (c[1] - d[1]) / (2 * h)];
}
const enSvg = $("en");
const enL = {
  cells: make("g", {}, enSvg),
  mesh: make("path", { class: "mesh" }, enSvg),
  frame: make("path", { class: "frame" }, enSvg),
  sel: make("path", { class: "sel" }, enSvg),
};
enL.cells.setAttribute("class", "cells");
let enView = null;
// The colour scale: fixed, from the cheapest to the dearest square at the largest bend.
const enScale = (() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < en.N; j++) {
    for (let i = 0; i < en.N; i++) {
      const F = M.stretch(enGrad([(i + 0.5) / en.N, (j + 0.5) / en.N], 1.5));
      lo = Math.min(lo, F, 2);
      hi = Math.max(hi, F);
    }
  }
  return { lo: lo * 0.9, hi };
})();
function drawEn() {
  const N = en.N;
  const s = en.bend;
  const pos = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.push(enMap([i / N, j / N], s));
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const p = enMap([i / N, j / N], 1.5);
      x0 = Math.min(x0, p[0], 0);
      x1 = Math.max(x1, p[0], 1);
      y0 = Math.min(y0, p[1], 0);
      y1 = Math.max(y1, p[1], 1);
    }
  }
  enView = fitView(enSvg, { x0, x1, y0, y1 }, 16);
  const P = enView.P;
  const id = (i, j) => j * (N + 1) + i;
  const K = 9;
  const paths = Array.from({ length: K }, () => []);
  let total = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const F = M.stretch(enGrad([(i + 0.5) / N, (j + 0.5) / N], s));
      total += F;
      const k = clamp(Math.floor((K * (F - enScale.lo)) / (enScale.hi - enScale.lo)), 0, K - 1);
      const q = [pos[id(i, j)], pos[id(i + 1, j)], pos[id(i + 1, j + 1)], pos[id(i, j + 1)]].map(P);
      paths[k].push(`M${pts(q).replace(/ /g, "L")}Z`);
    }
  }
  empty(enL.cells);
  paths.forEach((d, k) => {
    if (d.length) make("path", { class: "lvl", "fill-opacity": (0.05 + (0.62 * (k + 0.5)) / K).toFixed(3), d: d.join("") }, enL.cells);
  });
  let mesh = "";
  for (let j = 0; j <= N; j++) mesh += "M" + pts(Array.from({ length: N + 1 }, (_, i) => P(pos[id(i, j)]))).replace(/ /g, "L");
  for (let i = 0; i <= N; i++) mesh += "M" + pts(Array.from({ length: N + 1 }, (_, j) => P(pos[id(i, j)]))).replace(/ /g, "L");
  enL.mesh.setAttribute("d", mesh);
  const edge = [];
  for (let i = 0; i <= N; i++) edge.push(pos[id(i, 0)]);
  for (let j = 1; j <= N; j++) edge.push(pos[id(N, j)]);
  for (let i = N - 1; i >= 0; i--) edge.push(pos[id(i, N)]);
  for (let j = N - 1; j >= 1; j--) edge.push(pos[id(0, j)]);
  enL.frame.setAttribute("d", `M${pts(edge.map(P)).replace(/ /g, "L")}Z`);
  const [si, sj] = en.sel;
  const q = [pos[id(si, sj)], pos[id(si + 1, sj)], pos[id(si + 1, sj + 1)], pos[id(si, sj + 1)]].map(P);
  enL.sel.setAttribute("d", `M${pts(q).replace(/ /g, "L")}Z`);
  const G = enGrad([(si + 0.5) / N, (sj + 0.5) / N], s);
  enZoom.draw();
  $("en-cost").innerHTML = `This small square: <span class="matrix" style="font-size:0.95rem">${[G[0], G[1], G[2], G[3]]
    .map((x) => `<span>${num(x)}</span>`)
    .join("")}</span><br />its cost <i>F</i> = <b>${num(M.stretch(G))}</b>`;
  $("en-total").innerHTML = `Average cost per small square: <b>${num(total / (N * N))}</b>`;
}
const enZoom = squareFigure($("en-zoom"), {
  name: "the small square",
  editable: false,
  get: () => enGrad([(en.sel[0] + 0.5) / en.N, (en.sel[1] + 0.5) / en.N], en.bend),
  box: { x0: -0.5, x1: 1.9, y0: -0.5, y1: 1.9 },
});
onResize(enSvg, drawEn);
function pickCell(e) {
  if (!enView) return;
  const [px, py] = pointer(enSvg, e);
  const w = enView.inv(px, py);
  let best = null;
  let bd = Infinity;
  for (let j = 0; j < en.N; j++) {
    for (let i = 0; i < en.N; i++) {
      const c = enMap([(i + 0.5) / en.N, (j + 0.5) / en.N], en.bend);
      const d = Math.hypot(c[0] - w[0], c[1] - w[1]);
      if (d < bd) {
        bd = d;
        best = [i, j];
      }
    }
  }
  if (best && bd < 1.5 / en.N && (best[0] !== en.sel[0] || best[1] !== en.sel[1])) {
    en.sel = best;
    drawEn();
  }
}
enSvg.addEventListener("pointermove", pickCell);
enSvg.addEventListener("pointerdown", pickCell);
enSvg.addEventListener("keydown", (e) => {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (!d) return;
  e.preventDefault();
  en.sel = [clamp(en.sel[0] + d[0], 0, en.N - 1), clamp(en.sel[1] + d[1], 0, en.N - 1)];
  drawEn();
});
$("en-bend").addEventListener("input", () => {
  en.bend = +$("en-bend").value;
  $("en-bend-out").textContent = num(en.bend);
  drawEn();
});
$("en-bend-out").textContent = num(en.bend);

// ------------------------------------------------------------------ line plots

// F along the line t ↦ A + tB, t in [t0, t1], with the deformed squares at five
// values of t above the graph. Where the graph bends down it is red; with
// opts.negative, the region below zero is shaded red. Returns whether it bends down.
function drawLinePlot(svg, F, A, B, [t0, t1], opts = {}) {
  const w = svg.clientWidth || 400;
  const h = svg.clientHeight || 260;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  empty(svg);
  const glyphs = opts.glyphs !== false;
  const gh = glyphs ? Math.min(64, h * 0.3) : 0;
  const L = 14;
  const R = w - 14;
  const T = gh + 10;
  const Bm = h - (opts.axis ? 24 : 12);
  const n = 180;
  const ts = [];
  const fs = [];
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    ts.push(t);
    fs.push(F(M.add(A, M.scale(B, t))));
  }
  let lo = Math.min(...fs);
  let hi = Math.max(...fs);
  if (opts.level !== undefined) {
    lo = Math.min(lo, opts.level);
    hi = Math.max(hi, opts.level);
  }
  if (opts.negative) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < 1e-9) {
    hi += 0.5;
    lo -= 0.5;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const X = (t) => L + ((R - L) * (t - t0)) / (t1 - t0);
  const Y = (f) => Bm - ((Bm - T) * (f - lo)) / (hi - lo);
  // the deformed squares
  if (glyphs) {
    const gts = [0, 1, 2, 3, 4].map((k) => t0 + ((t1 - t0) * (k + 0.5)) / 5);
    const mats = gts.map((t) => M.add(A, M.scale(B, t)));
    let ext = 0.5;
    for (const X2 of mats) {
      const c = M.apply(X2, [0.5, 0.5]);
      for (const p of square(X2)) ext = Math.max(ext, Math.abs(p[0] - c[0]), Math.abs(p[1] - c[1]));
    }
    const sc = Math.min((gh / 2 - 5) / ext, ((R - L) / 10 - 3) / ext, 26);
    gts.forEach((t, k) => {
      make("line", { class: "guide", x1: X(t), y1: gh, x2: X(t), y2: Bm }, svg);
      const X2 = mats[k];
      const c = M.apply(X2, [0.5, 0.5]);
      const P = ([x, y]) => [X(t) + sc * (x - c[0]), gh / 2 + 3 - sc * (y - c[1])];
      make("polygon", { class: `glyph${isFlat(X2) ? " flat" : M.det(X2) < 0 ? " flipped" : ""}`, points: pts(square(X2).map(P)) }, svg);
    });
    make("line", { class: "base", x1: 0, y1: gh + 2, x2: w, y2: gh + 2 }, svg);
  }
  if (opts.negative && lo < 0) make("rect", { class: "neg", x: L, y: Y(0), width: R - L, height: Math.max(0, Bm - Y(0)) }, svg);
  if (lo < 0 && hi > 0) make("line", { class: "zero", x1: L, y1: Y(0), x2: R, y2: Y(0) }, svg);
  if (opts.level !== undefined) make("line", { class: "level", x1: L, y1: Y(opts.level), x2: R, y2: Y(opts.level) }, svg);
  const line = ts.map((t, k) => [X(t), Y(fs[k])]);
  make("polyline", { class: "curve", points: pts(line) }, svg);
  // Where the second difference is negative, the graph bends down.
  const tol = 1e-9 * (1 + Math.max(...fs.map(Math.abs)));
  let bad = false;
  let run = [];
  const runs = [];
  for (let k = 1; k < n; k++) {
    const d2 = fs[k - 1] - 2 * fs[k] + fs[k + 1];
    if (d2 < -tol) {
      bad = true;
      if (!run.length) run.push(line[k - 1]);
      run.push(line[k]);
    } else if (run.length) {
      run.push(line[k]);
      runs.push(run);
      run = [];
    }
  }
  if (run.length) {
    run.push(line[n]);
    runs.push(run);
  }
  for (const r of runs) make("polyline", { class: "curve bad", points: pts(r) }, svg);
  if (opts.dot !== undefined) {
    const f = F(M.add(A, M.scale(B, opts.dot)));
    make("circle", { class: "dot", cx: X(opts.dot), cy: Y(f), r: 5 }, svg);
  }
  if (opts.axis) {
    for (const [t, lab] of opts.axis) {
      const anchor = t === t0 ? "start" : t === t1 ? "end" : "middle";
      const tx = make("text", { x: t === t0 ? L - 4 : t === t1 ? R + 4 : X(t), y: h - 7, "text-anchor": anchor }, svg);
      tx.textContent = lab;
    }
  }
  return { bad };
}

// A figure that tests an energy along lines: any lines, or lines of rank one.
function lineProbe(fig, opts) {
  const plotBox = html("div", { class: "probe-main" }, fig);
  const svg = make("svg", { class: "plot", role: "img", "aria-label": opts.label }, plotBox);
  const side = html("div", { class: "probe-side" }, fig);
  let energy = opts.energies[0];
  if (opts.energies.length > 1) {
    const fs = html("fieldset", { class: "seg" }, side);
    html("legend", {}, fs, "Energy");
    const box = html("div", { class: "opts" }, fs);
    for (const e of opts.energies) {
      const lab = html("label", {}, box);
      const inp = html("input", { type: "radio", name: `${fig.id}-energy`, value: e.key }, lab);
      if (e === energy) inp.checked = true;
      html("span", {}, lab, e.name);
      inp.addEventListener("change", () => {
        energy = e;
        tested = null;
        if (e.line) line = { ...e.line };
        draw();
      });
    }
  }
  const acts = html("div", { class: "actions" }, side);
  const another = html("button", { type: "button" }, acts, opts.rankOne ? "Another rank-one line" : "Another line");
  const test = html("button", { type: "button" }, acts, `Test ${big(opts.count || 5000)} ${opts.rankOne ? "rank-one " : ""}lines`);
  const status = html("p", { class: "status", "aria-live": "polite" }, side);
  html("figcaption", {}, fig, opts.caption);
  let line = { ...(energy.line || opts.line) };
  let tested = null;
  let seed = opts.seed || 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  function draw() {
    const { bad } = drawLinePlot(svg, energy.F, line.A, line.B, line.range, {
      dot: 0,
      axis: [
        [line.range[0], `t = ${short(line.range[0])}`],
        [0, "0"],
        [line.range[1], short(line.range[1])],
      ],
    });
    const word = opts.rankOne ? "rank-one convex" : "convex";
    let s = bad
      ? `<span class="bad">It bends down</span> where the curve is red, so ${energy.short} is not ${word}.`
      : `<span class="good">It never bends down</span> along this line.`;
    if (tested) {
      const lines = `${opts.rankOne ? "rank-one " : ""}lines`;
      s +=
        tested.bad === 0
          ? ` Tested ${big(tested.count)} random ${lines}: <span class="good">it never bends down along any of them</span>.`
          : ` Tested ${big(tested.count)} random ${lines}: <span class="bad">it bends down along ${big(tested.bad)} of them</span>; the plot shows the worst.`;
    }
    status.innerHTML = s;
  }
  another.addEventListener("click", () => {
    tested = null;
    const A = M.randomMatrix(rand, 1.2);
    const B = opts.rankOne ? M.randomRankOne(rand) : M.randomDirection(rand);
    line = { A, B, range: [-1, 1] };
    draw();
  });
  test.addEventListener("click", () => {
    tested = M.testLines(energy.F, rand, { count: opts.count || 5000, rankOne: !!opts.rankOne });
    if (tested.worst) line = { A: tested.worst.A, B: tested.worst.B, range: [-0.6, 0.6] };
    draw();
  });
  onResize(svg, draw);
  return { draw };
}

const DET_LINE = { A: M.I, B: [1, 0, 0, -1], range: [-1.25, 1.25] };
lineProbe($("probe-convex"), {
  label: "The energy along a straight path between deformations",
  line: DET_LINE,
  energies: [
    { key: "stretch", name: "Stretch", short: "the stretch", F: M.stretch },
    { key: "area", name: "Area squared", short: "(det <i>A</i>)²", F: M.detSq },
  ],
  seed: 11,
  caption:
    "The energy along the path <i>A</i> + <i>tB</i>, with the deformed square at five points of the path drawn above the graph. Here <i>A</i> is the square at rest and <i>B</i> stretches one way while squeezing the other. The dot marks <i>A</i>.",
});

lineProbe($("probe-rank"), {
  label: "The energy along a path whose direction has rank one",
  rankOne: true,
  energies: [
    { key: "area", name: "Area squared", short: "(det <i>A</i>)²", F: M.detSq, line: { A: M.I, B: [1, 0, 0, 0], range: [-1.6, 0.6] } },
    { key: "wells", name: "Crystal", short: "the crystal", F: M.twoWell, line: { A: M.I, B: [0, 1, 0, 0], range: [-0.7, 0.7] } },
  ],
  seed: 23,
  caption:
    "The energy along a path whose direction <i>B</i> has rank one. For the area squared, <i>B</i> widens the square sideways: the area factor changes at a steady rate, and the energy is a bowl. The crystal has two preferred shapes, two shears apart; along the shear between them, its energy dips.",
});

// ------------------------------------------------------------------ sheets held at the edge

const SHEET_N = 24;
const sheetGrid = M.makeSheet(SHEET_N);

function choice(fs, name, items, value, onChange) {
  const box = html("div", { class: "opts" }, fs);
  for (const it of items) {
    const lab = html("label", {}, box);
    const inp = html("input", { type: "radio", name, value: it.key }, lab);
    if (it.key === value) inp.checked = true;
    html("span", {}, lab, it.name);
    inp.addEventListener("change", () => onChange(it.key));
  }
}

const FRAMES = {
  rest: { name: "Rest", A: M.I },
  stretched: { name: "Stretched", A: M.diag(1.3, 0.8) },
  sheared: { name: "Sheared", A: [1, 0.5, 0, 1] },
};
const SHAPES = Object.entries(M.WIGGLES).map(([key, w]) => ({ key, name: w.name }));

// Draw a deformed sheet. mode "energy" shades each triangle by F, on the scale
// [lo, hi]; mode "fold" shades the triangles that are turned over.
function sheetDrawer(svg) {
  const L = {
    fill: make("g", {}, svg),
    mesh: make("path", { class: "mesh" }, svg),
    frame: make("path", { class: "frame" }, svg),
  };
  return function draw({ A, disp, box, mode, F, lo, hi }) {
    const v = fitView(svg, box, 14);
    const { pos, grads } = M.deformSheet(sheetGrid, A, disp);
    const P = pos.map(v.P);
    empty(L.fill);
    if (mode === "energy") {
      const K = 10;
      const paths = Array.from({ length: K }, () => []);
      sheetGrid.tris.forEach((t, k) => {
        const f = F(grads[k]);
        const lvl = clamp(Math.floor((K * (f - lo)) / (hi - lo || 1)), 0, K - 1);
        paths[lvl].push(
          `M${P[t[0]][0].toFixed(1)},${P[t[0]][1].toFixed(1)}L${P[t[1]][0].toFixed(1)},${P[t[1]][1].toFixed(1)}L${P[t[2]][0].toFixed(1)},${P[t[2]][1].toFixed(1)}Z`
        );
      });
      paths.forEach((d, k) => {
        if (d.length) make("path", { class: "lvl", "fill-opacity": (0.04 + (0.66 * (k + 0.5)) / K).toFixed(3), d: d.join("") }, L.fill);
      });
    } else {
      const d = [];
      sheetGrid.tris.forEach((t, k) => {
        if (M.det(grads[k]) < 0)
          d.push(
            `M${P[t[0]][0].toFixed(1)},${P[t[0]][1].toFixed(1)}L${P[t[1]][0].toFixed(1)},${P[t[1]][1].toFixed(1)}L${P[t[2]][0].toFixed(1)},${P[t[2]][1].toFixed(1)}Z`
          );
      });
      if (d.length) make("path", { class: "fold", d: d.join("") }, L.fill);
    }
    const N = SHEET_N;
    const id = (i, j) => j * (N + 1) + i;
    let mesh = "";
    for (let j = 0; j <= N; j++) mesh += "M" + pts(Array.from({ length: N + 1 }, (_, i) => P[id(i, j)])).replace(/ /g, "L");
    for (let i = 0; i <= N; i++) mesh += "M" + pts(Array.from({ length: N + 1 }, (_, j) => P[id(i, j)])).replace(/ /g, "L");
    L.mesh.setAttribute("d", mesh);
    L.frame.setAttribute("d", `M${pts(square(A).map(v.P)).replace(/ /g, "L")}Z`);
    return grads;
  };
}

// The box that holds the sheet for every amplitude up to sMax.
function sheetBox(A, shape, sMax) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const disp = M.wiggleNodes(sheetGrid, shape, sMax);
  sheetGrid.nodes.forEach((x, k) => {
    const y = M.apply(A, x);
    for (const s of [0, 1]) {
      const p = [y[0] + s * disp[k][0], y[1] + s * disp[k][1]];
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
  });
  return { x0, x1, y0, y1 };
}

// Quasiconvexity: the average energy of a rippled sheet against the uniform one.
const QC_ENERGIES = [
  { key: "stretch", name: "Stretch", F: M.stretch },
  { key: "area", name: "Area squared", F: M.detSq },
  { key: "wells", name: "Crystal", F: M.twoWell },
  { key: "dm", name: "<i>f</i><sub>1.1</sub>", F: M.dm(1.1) },
];
const qc = { energy: "stretch", shape: "swirl", frame: "rest", amp: 1 };
const qcDraw = sheetDrawer($("qc-sheet"));
choice($("qc-energy"), "qc-energy", QC_ENERGIES, qc.energy, (k) => {
  qc.energy = k;
  drawQc(true);
});
choice($("qc-shape"), "qc-shape", SHAPES, qc.shape, (k) => {
  qc.shape = k;
  drawQc(true);
});
choice(
  $("qc-frame"),
  "qc-frame",
  Object.entries(FRAMES).map(([key, f]) => ({ key, name: f.name })),
  qc.frame,
  (k) => {
    qc.frame = k;
    drawQc(true);
  }
);
let qcCache = null;
function drawQc(fresh) {
  const A = FRAMES[qc.frame].A;
  const F = QC_ENERGIES.find((e) => e.key === qc.energy).F;
  const sMax = 1.5;
  if (fresh || !qcCache) {
    // The curve of the average against the amplitude, and a fixed colour scale.
    const curve = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= 30; k++) {
      const s = (sMax * k) / 30;
      const { grads } = M.deformSheet(sheetGrid, A, M.wiggleNodes(sheetGrid, qc.shape, s));
      curve.push([s, M.average(grads, F)]);
      if (k === 30 || k === 20) {
        for (const G of grads) {
          const f = F(G);
          lo = Math.min(lo, f);
          hi = Math.max(hi, f);
        }
      }
    }
    lo = Math.min(lo, F(A));
    qcCache = { curve, lo, hi: Math.max(hi, F(A) + 1e-6), box: sheetBox(A, qc.shape, sMax) };
  }
  const disp = M.wiggleNodes(sheetGrid, qc.shape, qc.amp);
  const grads = qcDraw({ A, disp, box: qcCache.box, mode: "energy", F, lo: qcCache.lo, hi: qcCache.hi });
  const avg = M.average(grads, F);
  const F0 = F(A);
  drawQcPlot(F0, avg);
  const tol = 1e-9 * (1 + Math.abs(F0));
  let s = `Uniform sheet: <b>${num(F0, 4)}</b>. Rippled: <b>${num(avg, 4)}</b> on average. `;
  if (qc.amp === 0) s += "With amplitude zero the sheet is uniform.";
  else if (avg < F0 - tol) s += '<span class="bad">The ripple saves energy</span>, so this energy is not quasiconvex.';
  else s += '<span class="good">The ripple costs more</span>, as quasiconvexity demands.';
  $("qc-status").innerHTML = s;
}
function drawQcPlot(F0, avg) {
  const svg = $("qc-plot");
  const w = svg.clientWidth || 300;
  const h = svg.clientHeight || 130;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  empty(svg);
  const c = qcCache.curve;
  let lo = Math.min(F0, ...c.map((p) => p[1]));
  let hi = Math.max(F0, ...c.map((p) => p[1]));
  const pad = (hi - lo || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const X = (s) => 12 + ((w - 24) * s) / 1.5;
  const Y = (f) => h - 22 - ((h - 34) * (f - lo)) / (hi - lo);
  make("line", { class: "level", x1: 12, y1: Y(F0), x2: w - 12, y2: Y(F0) }, svg);
  make("polyline", { class: "curve", points: pts(c.map(([s, f]) => [X(s), Y(f)])) }, svg);
  // red where the ripple saves energy
  const tol = 1e-9 * (1 + Math.abs(F0));
  const below = [];
  let run = [];
  c.forEach(([s, f]) => {
    if (f < F0 - tol) run.push([X(s), Y(f)]);
    else if (run.length) {
      below.push(run);
      run = [];
    }
  });
  if (run.length) below.push(run);
  for (const r of below) if (r.length > 1) make("polyline", { class: "curve bad", points: pts(r) }, svg);
  make("circle", { class: "dot", cx: X(qc.amp), cy: Y(avg), r: 5 }, svg);
  const t1 = make("text", { x: 12, y: h - 6 }, svg);
  t1.textContent = "amplitude 0";
  const t2 = make("text", { x: w - 12, y: h - 6, "text-anchor": "end" }, svg);
  t2.textContent = "1.5";
}
$("qc-amp").addEventListener("input", () => {
  qc.amp = +$("qc-amp").value;
  $("qc-amp-out").textContent = num(qc.amp);
  drawQc(false);
});
$("qc-amp-out").textContent = num(qc.amp);
onResize($("qc-sheet"), () => drawQc(false));
onResize($("qc-plot"), () => qcCache && drawQc(false));

// Polyconvexity: the area factor averages to det A, whatever the ripple.
const pc = { shape: "bulge", frame: "rest", amp: 0.7 };
const pcDraw = sheetDrawer($("pc-sheet"));
choice($("pc-shape"), "pc-shape", SHAPES, pc.shape, (k) => {
  pc.shape = k;
  drawPc();
});
choice(
  $("pc-frame"),
  "pc-frame",
  Object.entries(FRAMES).map(([key, f]) => ({ key, name: f.name })),
  pc.frame,
  (k) => {
    pc.frame = k;
    drawPc();
  }
);
function drawPc() {
  const A = FRAMES[pc.frame].A;
  const disp = M.wiggleNodes(sheetGrid, pc.shape, pc.amp);
  const grads = pcDraw({ A, disp, box: sheetBox(A, pc.shape, 1.8), mode: "fold" });
  const avgDet = M.average(grads, M.det);
  const avgStretch = M.average(grads, M.stretch);
  const folded = grads.filter((G) => M.det(G) < 0).length / grads.length;
  const same = Math.abs(avgDet - M.det(A)) < 1e-9;
  $("pc-figures").innerHTML = `
    <dt>Average area factor</dt><dd><b>${num(avgDet, 6)}</b></dd>
    <dt>Area factor of the frame, det <i>A</i></dt><dd>${num(M.det(A), 6)}<small class="${same ? "good" : "bad"}">${same ? "equal" : "different"}</small></dd>
    <dt>Average stretch</dt><dd><b>${num(avgStretch, 4)}</b></dd>
    <dt>Stretch of the frame</dt><dd>${num(M.stretch(A), 4)}</dd>
    <dt>Folded part of the sheet</dt><dd>${num(folded * 100, 1)}%</dd>`;
}
$("pc-amp").addEventListener("input", () => {
  pc.amp = +$("pc-amp").value;
  $("pc-amp-out").textContent = num(pc.amp);
  drawPc();
});
$("pc-amp-out").textContent = num(pc.amp);
onResize($("pc-sheet"), drawPc);

// ------------------------------------------------------------------ isotropy

const ISO_A = [1.3, 0.35, -0.1, 0.75];
const F11 = M.dm(1.1);
const iso = { r: 35, q: -20 };
const isoFig = squareFigure($("iso-sq"), {
  name: "QAR",
  editable: false,
  get: () => M.mul(M.mul(M.rot((iso.q * Math.PI) / 180), ISO_A), M.rot((iso.r * Math.PI) / 180)),
  refMatrix: () => M.rot((iso.r * Math.PI) / 180),
  box: { x0: -1.9, x1: 1.9, y0: -1.9, y1: 1.9 },
});
function drawIso() {
  isoFig.draw();
  const X = M.mul(M.mul(M.rot((iso.q * Math.PI) / 180), ISO_A), M.rot((iso.r * Math.PI) / 180));
  const a = F11(X);
  const b = M.bottomStretch(X);
  const same = (x, y) => Math.abs(x - y) < 1e-9;
  const mark = (ok) => (ok ? '<small class="good">unchanged</small>' : '<small class="bad">changed</small>');
  $("iso-figures").innerHTML = `
    <dt><i>f</i><sub>1.1</sub></dt><dd><b>${num(a, 4)}</b>${mark(same(a, F11(ISO_A)))}</dd>
    <dt>stretch of the bottom side</dt><dd><b>${num(b, 4)}</b>${mark(same(b, M.bottomStretch(ISO_A)))}</dd>`;
  $("iso-r-out").textContent = `${num(iso.r, 0)}°`;
  $("iso-q-out").textContent = `${num(iso.q, 0)}°`;
}
for (const k of ["r", "q"]) {
  $(`iso-${k}`).addEventListener("input", () => {
    iso[k] = +$(`iso-${k}`).value;
    drawIso();
  });
}
drawIso();

// ------------------------------------------------------------------ homogeneity

const HOM_A = [1.1, 0.3, 0.1, 0.9];
const hom = { l: 1.5, p: 4 };
function drawHom() {
  const svg = $("hom-plot");
  const w = svg.clientWidth || 300;
  const h = svg.clientHeight || 300;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  empty(svg);
  const F = M.powNorm(hom.p);
  const F0 = F(HOM_A);
  // the squares, in the top part
  const top = h * 0.42;
  const ext = 2 * Math.max(...square(HOM_A).map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  const sc = Math.min((top - 16) / ext, (w * 0.5) / ext);
  const O = [w * 0.38, top - 6];
  const P = ([x, y]) => [O[0] + sc * x, O[1] - sc * y];
  make("polygon", { class: "shape ghost", points: pts(square(HOM_A).map(P)) }, svg);
  const LA = M.scale(HOM_A, hom.l);
  make("polygon", { class: "shape", points: pts(square(LA).map(P)) }, svg);
  arrow(svg, P([0, 0]), P([LA[0], LA[2]]));
  arrow(svg, P([0, 0]), P([LA[1], LA[3]]));
  // the curve λ ↦ λ^p F(A)
  const L0 = 16;
  const R0 = w - 16;
  const T0 = top + 14;
  const B0 = h - 26;
  const lmax = 2;
  const fmax = Math.pow(lmax, hom.p) * F0;
  const X = (l) => L0 + ((R0 - L0) * l) / lmax;
  const Y = (f) => B0 - ((B0 - T0) * f) / fmax;
  make("line", { class: "axis", x1: L0, y1: B0, x2: R0, y2: B0 }, svg);
  const c = [];
  for (let k = 0; k <= 120; k++) {
    const l = (lmax * k) / 120;
    c.push([X(l), Y(Math.pow(l, hom.p) * F0)]);
  }
  make("polyline", { class: "curve hom", points: pts(c) }, svg);
  make("line", { class: "zero", x1: X(1), y1: T0, x2: X(1), y2: B0 }, svg);
  const val = F(LA);
  make("circle", { class: "dot", cx: X(hom.l), cy: Y(val), r: 5 }, svg);
  for (const [l, lab] of [
    [0, "λ = 0"],
    [1, "1"],
    [2, "2"],
  ]) {
    const t = make("text", { x: X(l), y: h - 8, "text-anchor": l === 0 ? "start" : l === 2 ? "end" : "middle" }, svg);
    t.textContent = lab;
  }
  $("hom-read").innerHTML = `<i>F</i>(<i>λA</i>) = <b>${num(val, 3)}</b><br /><i>λ</i><sup><i>p</i></sup> <i>F</i>(<i>A</i>) = ${num(
    hom.l
  )}<sup>${num(hom.p, 1)}</sup> × ${num(F0, 3)} = <b>${num(Math.pow(hom.l, hom.p) * F0, 3)}</b>`;
  $("hom-l-out").textContent = num(hom.l);
  $("hom-p-out").textContent = num(hom.p, 1);
}
for (const k of ["l", "p"]) {
  $(`hom-${k}`).addEventListener("input", () => {
    hom[k] = +$(`hom-${k}`).value;
    drawHom();
  });
}
onResize($("hom-plot"), drawHom);

// ------------------------------------------------------------------ rank-one convexity of f_1.1

{
  const m = M.rankOneMargin(1.1, 90, 90);
  lineProbe($("probe-h3"), {
    label: "f 1.1 along a rank-one line",
    rankOne: true,
    line: { A: m.X, B: m.B, range: [-0.6, 0.6] },
    energies: [{ key: "dm", name: "f 1.1", short: "<i>f</i><sub>1.1</sub>", F: F11 }],
    seed: 37,
    caption:
      "The path starts on the rank-one line along which <i>f</i><sub>1.1</sub> comes closest to bending down. It still curves upward, as it does along every rank-one line.",
  });
}

// ------------------------------------------------------------------ the sign

const sign = { A: M.I.slice() };
const signFig = squareFigure($("sign-sq"), {
  name: "A",
  editable: true,
  limit: [-1.1, 1.9],
  box: { x0: -1.2, x1: 2.0, y0: -1.2, y1: 2.0 },
  get: () => sign.A,
  set: (A) => {
    sign.A = A;
    drawSign();
  },
  shapeClass: (A) => (F11(A) < 0 ? "shape flipped" : "shape"),
});
let lastSign = "";
function drawSign() {
  signFig.draw();
  const f = F11(sign.A);
  const s =
    f < -1e-12
      ? `<i>f</i><sub>1.1</sub>(<i>A</i>) = <b class="bad">${num(f, 3)}</b>: <span class="bad">negative</span>.`
      : `<i>f</i><sub>1.1</sub>(<i>A</i>) = <b>${num(f, 3)}</b>: nonnegative.`;
  if (s !== lastSign) {
    $("sign-read").innerHTML = s;
    lastSign = s;
  }
}
for (const b of $("sign-sq").closest("figure").querySelectorAll(".presets button")) {
  b.addEventListener("click", () => {
    const target = b.dataset.m.split(",").map(Number);
    animate(sign.A.slice(), target, 350, (A) => {
      sign.A = A;
      drawSign();
    });
  });
}
drawSign();

// ------------------------------------------------------------------ the table of results

function drawTable() {
  const p = +$("tab-p").value;
  $("tab-p-out").textContent = num(p);
  for (const tr of $("results").tBodies[0].rows) {
    const lo = +tr.dataset.lo;
    const hi = tr.dataset.hi === "Infinity" ? Infinity : +tr.dataset.hi;
    const open = tr.dataset.open || "";
    const okLo = open === "both" || open === "lo" ? p > lo : p >= lo;
    const okHi = open === "both" ? p < hi : p <= hi;
    tr.classList.toggle("on", okLo && okHi);
  }
}
$("tab-p").addEventListener("input", drawTable);
drawTable();

// ------------------------------------------------------------------ the Dacorogna–Marcellini family

const G_CONVEX = (2 * Math.SQRT2) / 3;
const G_POLY = 1;
const G_RANK = 2 / Math.sqrt(3);
const dmState = { g: 1.1 };

function drawGammaLine() {
  const svg = $("gamma-line");
  const w = svg.clientWidth || 400;
  const h = svg.clientHeight || 64;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  empty(svg);
  const L = 14;
  const R = w - 14;
  const X = (g) => L + ((R - L) * g) / 1.4;
  const y = h / 2;
  make("line", { class: "track", x1: X(0), y1: y, x2: X(1.4), y2: y }, svg);
  const marks = [
    [G_CONVEX, "2√2/3", -12, "end"],
    [G_POLY, "1", 22, "middle"],
    [G_RANK, "2/√3", -12, "start"],
  ];
  for (const [g, lab, dy, anchor] of marks) {
    make("line", { class: "tick", x1: X(g), y1: y - 9, x2: X(g), y2: y + 9 }, svg);
    const t = make("text", { x: X(g) + (anchor === "end" ? 3 : anchor === "start" ? -3 : 0), y: y + dy, "text-anchor": anchor }, svg);
    t.textContent = lab;
  }
  const t0 = make("text", { x: X(0), y: y + 22, "text-anchor": "start" }, svg);
  t0.textContent = "0";
  make("circle", { class: "now", cx: X(dmState.g), cy: y, r: 6.5 }, svg);
}

function drawDm() {
  const g = dmState.g;
  $("gamma-out").textContent = num(g, 3);
  drawGammaLine();
  const F = M.dm(g);
  const yes = '<span class="mark good" aria-hidden="true">✓</span>';
  const no = '<span class="mark bad" aria-hidden="true">✗</span>';
  const row = (ok, name, why) => `<li>${ok ? yes : no}<span><span class="vh">${ok ? "Yes" : "No"}: </span>${name}<small>${why}</small></span></li>`;
  $("dm-props").innerHTML = [
    row(g <= G_CONVEX, "convex", "exactly when |<i>γ</i>| ≤ 2√2/3"),
    row(g <= G_POLY, "polyconvex", "exactly when |<i>γ</i>| ≤ 1"),
    row(g <= G_RANK, "quasiconvex", "exactly when rank-one convex, by Theorem A"),
    row(g <= G_RANK, "rank-one convex", "exactly when |<i>γ</i>| ≤ 2/√3"),
    row(g <= G_POLY, "nonnegative", "exactly when |<i>γ</i>| ≤ 1"),
  ].join("");
  drawLinePlot($("dm-profile"), F, M.diag(1, 0), M.diag(0, 1), [-1, 1], {
    negative: true,
    axis: [
      [-1, "s = −1"],
      [0, "0"],
      [1, "1"],
    ],
  });
  const r1 = M.rankOneMargin(g, 90, 120);
  drawLinePlot($("dm-r1"), F, r1.X, r1.B, [-0.5, 0.5], { dot: 0, negative: true });
  const cv = M.convexMargin(g, 360);
  drawLinePlot($("dm-gen"), F, cv.X, cv.B, [-0.5, 0.5], { dot: 0, negative: true });
}
$("gamma").addEventListener("input", () => {
  dmState.g = +$("gamma").value;
  drawDm();
});
onResize($("dm"), drawDm);

// The thresholds again, from the second derivatives, once the page has settled.
setTimeout(() => {
  const gc = M.threshold((g) => M.convexMargin(g, 720).value, 0.5, 1.4, 34);
  const gr = M.threshold((g) => M.rankOneMargin(g, 360, 180).value, 0.5, 1.4, 34);
  const least = (g) => M.dmLeast(g, 4000);
  const gn = M.threshold(least, 0.5, 1.4, 34);
  $("dm-computed").innerHTML =
    `This page recomputes the thresholds from the second derivatives and the values of <i>f<sub>γ</sub></i>: it stops being convex at <i>γ</i> = ${gc.toFixed(
      5
    )}, rank-one convex at ${gr.toFixed(5)}, and nonnegative at ${gn.toFixed(5)}.`;
}, 600);

// ------------------------------------------------------------------ the colour theme

// Shared with the rest of vltanh.me through the same stored setting: system, light
// or dark, in that cycle.
const THEMES = ["system", "light", "dark"];
const ICONS = {
  system: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" class="solid"/></svg>',
  light:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z"/></svg>',
};

function storedTheme() {
  try {
    const t = localStorage.getItem("theme");
    return THEMES.includes(t) ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(t) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $("theme").innerHTML = ICONS[t];
  $("theme").title = `Colours: ${t === "system" ? "as the system" : t} (click to change)`;
  $("theme").setAttribute("aria-label", `Colour theme: ${t}`);
}

$("theme").addEventListener("click", () => {
  const t = THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length];
  try {
    localStorage.setItem("theme", t);
  } catch {
    // Without storage the choice lasts until the page is left.
  }
  applyTheme(t);
});
applyTheme(storedTheme());
