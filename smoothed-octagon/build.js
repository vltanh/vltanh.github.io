// 2. Build the smoothed octagon: from the regular octagon, one corner at a
// time. The corner of the sides x = 1 and x + y = √2 is cut by the curve
// d · d′ = c, where d = 1 − y is the distance to the line y = 1 and
// d′ = (√2 − x + y)/√2 the distance to the line x − y = √2, the lines of the
// next two sides. At c = √2/4 the curve touches both sides of the corner.
import { SQRT2, densestLattice, hexagonAt, regularPolygon, roundedPolygon } from "./geometry.js";
import { $, Board, make, pct, tween } from "./common.js";

const OCTAGON = regularPolygon(8);
const OCTAGON_DENSITY = densestLattice(OCTAGON).density;
const C = [1 + SQRT2, 1]; // where the two dashed lines meet
const CORNER = [1, SQRT2 - 1];

const VIEWS = {
  whole: { cx: 0, cy: 0, half: 1.42 },
  wedge: { cx: 1.18, cy: 0.42, half: 1.42 },
  corner: { cx: 0.985, cy: 0.395, half: 0.2 },
};

const STEPS = [
  {
    title: "A regular octagon",
    view: "whole",
    text: "Start with a regular octagon, all eight sides at distance 1 from the centre. Its densest packing covers 90.62% of the plane, less than disks do.",
  },
  {
    title: "Two dashed lines",
    view: "wedge",
    text: "Pick a corner. Its two sides each have a neighbouring side beyond the corner. Extend those two sides into the dashed lines; they meet at the point <i>C</i>.",
  },
  {
    title: "A curve of constant product",
    view: "wedge",
    text: "The orange curve is made of the points whose distances <i>d</i> and <i>d</i>′ to the two dashed lines multiply to √2/4 ≈ 0.3536. Drag the point along it: as one distance shrinks, the other grows. The curve, a hyperbola, comes ever closer to the dashed lines and never meets them.",
  },
  {
    title: "Cut the corner",
    view: "corner",
    text: "With the product √2/4, the curve just touches the two sides of the corner, at <i>T</i><sub>1</sub> and <i>T</i><sub>2</sub>. Cutting the corner off along the curve between them leaves a boundary with no corner. With a smaller product (move the slider), the curve crosses the sides and the cut leaves two smaller corners.",
  },
  {
    title: "All eight corners",
    view: "whole",
    text: "Cutting all eight corners the same way gives Reinhardt’s smoothed octagon. Each side keeps a straight middle part of length 2 − √2 ≈ 0.586, and each corner loses a sliver about 0.023 deep. Its densest packing covers 90.24% of the plane. As the slider rounds the corners, the density falls the whole way.",
  },
];

// The point of the curve d · d′ = c at the distance d from the line y = 1.
const onCurve = (d, c) => [SQRT2 + 1 - d - (SQRT2 * c) / d, 1 - d];

export function initBuild() {
  const svg = $("build-board");
  const g = (cls) => svg.querySelector(`.${cls}`);
  const layer = {
    grid: g("grid"),
    shape: g("shape"),
    ghosts: g("ghosts"),
    octagon: g("octagon"),
    lines: g("lines"),
    curve: g("curve"),
    arc: g("arc"),
    drops: g("drops"),
    marks: g("marks"),
    point: g("point"),
  };
  const board = new Board(svg, VIEWS.whole, () => draw());

  let step = 0;
  let t = 1; // the rounding: the product c runs from the corner's value to √2/4
  let d = 2 ** -0.75; // the point on the curve, by its distance to y = 1
  let K = roundedPolygon(8, t);
  let density = densestLattice(K).density;
  let stopView = () => {};
  let dragging = false;
  let pending = 0;

  const c = () => K.c;
  const visible = (cls) => STEPS[step].show.includes(cls);
  STEPS[0].show = ["octagon"];
  STEPS[1].show = ["octagon", "lines", "C"];
  STEPS[2].show = ["octagon", "lines", "C", "curve", "point"];
  STEPS[3].show = ["octagon", "lines", "C", "curve", "point", "cut", "touch"];
  STEPS[4].show = ["shape", "ghosts"];

  function drawGrid() {
    layer.grid.replaceChildren();
    const [x0, x1, y0, y1] = board.bounds();
    const span = 2 * board.view.half;
    const unit = span > 1.5 ? 0.5 : 0.1;
    for (let x = Math.ceil(x0 / unit) * unit; x <= x1; x += unit) {
      const cls = Math.abs(x) < 1e-9 ? "axis" : "minor";
      make("line", { x1: board.X(x), y1: 0, x2: board.X(x), y2: board.size, class: cls }, layer.grid);
    }
    for (let y = Math.ceil(y0 / unit) * unit; y <= y1; y += unit) {
      const cls = Math.abs(y) < 1e-9 ? "axis" : "minor";
      make("line", { x1: 0, y1: board.Y(y), x2: board.size, y2: board.Y(y), class: cls }, layer.grid);
    }
  }

  // the cut-off part of corner j, between the arc and the corner
  function cutRegion(j) {
    const rot = ([x, y]) => {
      const a = (j * Math.PI) / 4;
      return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    };
    const arc = [];
    const M = 40;
    for (let i = 0; i <= M; i++) arc.push(K.radialAt(Math.PI / 8 - K.alpha + (2 * K.alpha * i) / M));
    return [...arc.reverse(), CORNER].map(rot);
  }

  function label(text, x, y, cls = "") {
    const el = make("text", { x, y, class: `label ${cls}` }, layer.marks);
    el.innerHTML = text;
    return el;
  }

  function draw() {
    const k = board.k;
    drawGrid();
    for (const l of Object.values(layer)) if (l !== layer.grid) l.replaceChildren();
    const [x0, x1, y0, y1] = board.bounds(0.2);

    if (visible("octagon")) make("path", { d: board.path(OCTAGON.outline), class: "octagon-fill" }, layer.octagon);
    if (visible("shape")) {
      make("path", { d: board.path(OCTAGON.outline), class: "octagon-ghost" }, layer.octagon);
      make("path", { d: board.path(K.outline), class: "smoothed" }, layer.shape);
    }
    if (visible("ghosts") && K.alpha > 0) for (let j = 0; j < 8; j++) make("path", { d: board.path(cutRegion(j)), class: "cut" }, layer.ghosts);
    if (visible("cut") && K.alpha > 0) make("path", { d: board.path(cutRegion(0)), class: "cut" }, layer.ghosts);

    if (visible("lines")) {
      // y = 1 and x − y = √2, drawn across the view
      make("line", { x1: board.X(x0), y1: board.Y(1), x2: board.X(x1), y2: board.Y(1), class: "asymptote" }, layer.lines);
      make("line", { x1: board.X(y0 + SQRT2), y1: board.Y(y0), x2: board.X(y1 + SQRT2), y2: board.Y(y1), class: "asymptote" }, layer.lines);
      // the two sides at the corner, and the two sides they continue
      const sides = [
        [
          [1, SQRT2 - 1],
          [1, 1 - SQRT2],
        ],
        [
          [1, SQRT2 - 1],
          [SQRT2 - 1, 1],
        ],
      ];
      for (const s of sides) make("path", { d: board.path(s, false), class: "corner-side" }, layer.lines);
      const next = [
        [
          [SQRT2 - 1, 1],
          [1 - SQRT2, 1],
        ],
        [
          [1, 1 - SQRT2],
          [SQRT2 - 1, -1],
        ],
      ];
      for (const s of next) make("path", { d: board.path(s, false), class: "next-side" }, layer.lines);
    }
    if (visible("C")) {
      make("circle", { cx: board.X(C[0]), cy: board.Y(C[1]), r: 4, class: "dot" }, layer.marks);
      label('<tspan font-style="italic">C</tspan>', board.X(C[0]) + 8, board.Y(C[1]) - 9);
    }

    if (visible("curve")) {
      // the whole branch, dashed, and the arc kept between the cut points, solid
      const pts = [];
      for (let i = 0; i <= 240; i++) {
        const dd = 0.02 * Math.exp((i / 240) * Math.log(4 / 0.02));
        const p = onCurve(dd, c());
        if (p[0] > x0 - 2 && p[1] > y0 - 2) pts.push(p);
      }
      make("path", { d: board.path(pts, false), class: "branch" }, layer.curve);
      if (visible("cut") && K.alpha > 0) {
        const arc = [];
        for (let i = 0; i <= 60; i++) arc.push(K.radialAt(Math.PI / 8 - K.alpha + (2 * K.alpha * i) / 60));
        make("path", { d: board.path(arc, false), class: "arc" }, layer.arc);
      }
    }

    if (visible("point")) {
      const P = onCurve(d, c());
      const foot1 = [P[0], 1];
      const s = (P[0] - P[1] - SQRT2) / 2;
      const foot2 = [P[0] - s, P[1] + s];
      make("line", { x1: board.X(P[0]), y1: board.Y(P[1]), x2: board.X(foot1[0]), y2: board.Y(foot1[1]), class: "drop" }, layer.drops);
      make("line", { x1: board.X(P[0]), y1: board.Y(P[1]), x2: board.X(foot2[0]), y2: board.Y(foot2[1]), class: "drop" }, layer.drops);
      for (const f of [foot1, foot2]) make("circle", { cx: board.X(f[0]), cy: board.Y(f[1]), r: 2.5, class: "foot" }, layer.drops);
      const m1 = [(P[0] + foot1[0]) / 2, (P[1] + foot1[1]) / 2];
      const m2 = [(P[0] + foot2[0]) / 2, (P[1] + foot2[1]) / 2];
      if (Math.abs(board.Y(P[1]) - board.Y(1)) > 22) label('<tspan font-style="italic">d</tspan>', board.X(m1[0]) - 8, board.Y(m1[1]), "end");
      if (Math.hypot(board.X(P[0]) - board.X(foot2[0]), board.Y(P[1]) - board.Y(foot2[1])) > 22)
        label('<tspan font-style="italic">d</tspan>′', board.X(m2[0]) + 7, board.Y(m2[1]) + 12);
      make("circle", { cx: board.X(P[0]), cy: board.Y(P[1]), r: 16, class: "grab" }, layer.point);
      make("circle", { cx: board.X(P[0]), cy: board.Y(P[1]), r: 7, class: "knob" }, layer.point);
    }

    if (visible("touch") && K.alpha > 0) {
      const T1 = [1, K.uCut];
      const T2 = [(1 + K.uCut) / SQRT2, (1 - K.uCut) / SQRT2];
      const tangent = t > 0.9999;
      for (const [T, name, dx, dy, anchor] of [
        [T1, tangent ? '<tspan font-style="italic">T</tspan><tspan dy="4" font-size="0.75em">1</tspan>' : "", 12, 14, "start"],
        [T2, tangent ? '<tspan font-style="italic">T</tspan><tspan dy="4" font-size="0.75em">2</tspan>' : "", -12, -8, "end"],
      ]) {
        make("circle", { cx: board.X(T[0]), cy: board.Y(T[1]), r: 4.5, class: tangent ? "dot touch" : "dot cross" }, layer.marks);
        if (name) label(name, board.X(T[0]) + dx, board.Y(T[1]) + dy, anchor === "end" ? "end" : "");
      }
    }
    readout();
    svg.setAttribute("aria-label", `${STEPS[step].title}: step ${step + 1} of ${STEPS.length}`);
    void k;
  }

  function readout() {
    const s = STEPS[step];
    $("build-step-title").textContent = s.title;
    $("build-step-text").innerHTML = s.text;
    $("build-count").textContent = `Step ${step + 1} of ${STEPS.length}`;
    for (const b of document.querySelectorAll("#build-dots button")) b.setAttribute("aria-current", String(+b.dataset.step === step));
    $("build-back").disabled = step === 0;
    $("build-next").disabled = step === STEPS.length - 1;
    const product = visible("point");
    $("build-product").hidden = !product;
    $("build-density").hidden = product;
    $("build-rounding").hidden = !visible("cut") && !visible("ghosts");
    if (product) {
      const dd = c() / d;
      $("build-d").textContent = d.toFixed(3);
      $("build-d2").textContent = dd.toFixed(3);
      $("build-cval").textContent = c().toFixed(4);
      $("build-cnote").innerHTML = t > 0.9999 ? "= √2/4, all along the curve" : "all along the curve, less than √2/4";
    } else {
      const shown = step === 0 ? OCTAGON_DENSITY : density;
      $("build-dval").textContent = pct(shown);
      $("build-dnote").textContent =
        step === 0
          ? "Disks cover 90.69%."
          : t > 0.9999
            ? "No shape of this kind does worse: Reinhardt conjectured it, and it is now proved in Lean 4."
            : `The regular octagon covers ${pct(OCTAGON_DENSITY)}, the smoothed octagon 90.24%.`;
    }
    $("build-c").value = String(Math.round(t * 1000));
    $("build-c-out").textContent = c().toFixed(4);
  }

  function goTo(n, animate = true) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    const target = VIEWS[STEPS[step].view];
    const from = { ...board.view };
    stopView();
    if (!animate) {
      board.view = { ...target };
      draw();
      return;
    }
    stopView = tween(650, (s) => {
      const lh = Math.log(from.half) + (Math.log(target.half) - Math.log(from.half)) * s;
      board.view = { cx: from.cx + (target.cx - from.cx) * s, cy: from.cy + (target.cy - from.cy) * s, half: Math.exp(lh) };
      draw();
    });
    draw();
  }

  function setRounding(v) {
    t = v;
    K = roundedPolygon(8, t);
    if (!pending)
      pending = requestAnimationFrame(() => {
        pending = 0;
        density = densestLattice(K).density;
        readout();
      });
    draw();
  }

  // the point follows the pointer along the curve
  function nearest(w) {
    let best = d;
    let bd = Infinity;
    for (let i = 0; i <= 400; i++) {
      const dd = 0.03 * Math.exp((i / 400) * Math.log(3.5 / 0.03));
      const p = onCurve(dd, c());
      const e = (p[0] - w[0]) ** 2 + (p[1] - w[1]) ** 2;
      if (e < bd) {
        bd = e;
        best = dd;
      }
    }
    return best;
  }

  svg.addEventListener("pointerdown", (e) => {
    if (!visible("point")) return;
    if (!e.target.classList.contains("grab") && !e.target.classList.contains("knob") && !e.target.classList.contains("branch")) return;
    dragging = true;
    d = nearest(board.toWorld(e));
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging");
    e.preventDefault();
    draw();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    d = nearest(board.toWorld(e));
    draw();
  });
  const end = () => {
    dragging = false;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  const dots = $("build-dots");
  STEPS.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.step = i;
    b.setAttribute("aria-label", `Step ${i + 1}: ${s.title}`);
    b.textContent = String(i + 1);
    b.addEventListener("click", () => goTo(i));
    dots.append(b);
  });
  $("build-back").addEventListener("click", () => goTo(step - 1));
  $("build-next").addEventListener("click", () => goTo(step + 1));
  $("build-c").addEventListener("input", (e) => setRounding(+e.target.value / 1000));

  // the smoothed polygons with 6k + 2 sides, k = 1, 2, 3; every inscribed
  // hexagon of the kind that gives a lattice packing has the same area, so
  // any one of them gives the density
  for (const k of [1, 2, 3]) {
    const P = roundedPolygon(6 * k + 2, 1);
    const li = document.createElement("li");
    const t = make("svg", { viewBox: "-1.12 -1.12 2.24 2.24", "aria-hidden": "true" }, li);
    make("path", { d: `${P.outline.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(4)} ${(-y).toFixed(4)}`).join("")}Z`, class: "thumb" }, t);
    const cap = document.createElement("span");
    cap.innerHTML = `<i>k</i> = ${k}, ${6 * k + 2} sides<br>${pct(P.area / (4 * hexagonAt(P, 0).det))}`;
    li.append(cap);
    $("family").append(li);
  }

  goTo(0, false);
}
