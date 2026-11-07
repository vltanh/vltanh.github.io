// 4. The sliding packings. For every boundary point p of a centrally
// symmetric convex shape there is an inscribed affinely regular hexagon
// p, q, q − p, …, and the copies at the lattice spanned by 2p and 2q form a
// packing in which each copy touches six others. Moving p along the boundary
// slides the copies. For the smoothed octagon the hexagon's area never
// changes, so every position is a densest packing.
import { densestLattice, diskShape, hexagonAt, latticePoints, mul, norm, regularPolygon, smoothedOctagon, sub } from "./geometry.js";
import { $, Board, make, pct, reducedMotion } from "./common.js";

const SAMPLES = 240;
const PERIOD = 9000; // milliseconds for one slide

const SHAPES = [
  {
    key: "smoothed",
    name: "Smoothed octagon",
    short: "Smoothed",
    color: "oct",
    shape: smoothedOctagon(),
    note: "The density never changes: every position is a densest packing, and the copies keep their orientation. Greg Egan animated this family in 2014.",
  },
  {
    key: "octagon",
    name: "Regular octagon",
    short: "Octagon",
    color: "reg",
    shape: regularPolygon(8),
    note: "The copies still touch six others all the way, but the density dips as they slide, and only isolated positions are densest.",
  },
  {
    key: "disk",
    name: "Disk",
    short: "Disk",
    color: "disk",
    shape: diskShape(),
    note: "The density never changes, but nothing new happens: the whole honeycomb only turns about the middle disk. Disks have a single densest lattice packing, up to turning it.",
  },
];

for (const s of SHAPES) {
  // the slide starts at a densest packing (for the smoothed octagon, the one
  // in which copies side by side share an edge) and ends at the same lattice
  const start = s.key === "smoothed" ? hexagonAt(s.shape, 0) : densestLattice(s.shape);
  s.phi0 = start.phi;
  s.phi1 = start.psi;
  s.radius = Math.max(...s.shape.outline.map(norm));
  s.curve = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const h = hexagonAt(s.shape, s.phi0 + (i / SAMPLES) * (s.phi1 - s.phi0));
    s.curve.push(s.shape.area / (4 * h.det));
  }
}

// the chart's range of densities
const LO = 0.89;
const HI = 0.91;

export function initSlide() {
  const svg = $("slide-board");
  const layer = { defs: svg.querySelector("defs"), copies: svg.querySelector(".copies"), marks: svg.querySelector(".marks") };
  const board = new Board(svg, { cx: 0, cy: 0, half: 3.7 }, () => draw());
  const shapeDef = make("path", { id: "slide-shape" }, layer.defs);
  const chart = $("slide-chart");
  const range = $("slide-t");

  let cur = SHAPES[0];
  let t = 0;
  let playing = false;
  let raf = 0;
  let last = 0;

  function draw() {
    const phi = cur.phi0 + t * (cur.phi1 - cur.phi0);
    const h = hexagonAt(cur.shape, phi);
    const u = mul(h.p, 2);
    const v = mul(h.q, 2);
    shapeDef.setAttribute("d", board.localPath(cur.shape.outline));
    layer.copies.replaceChildren();
    layer.marks.replaceChildren();
    const [x0, x1, y0, y1] = board.bounds(cur.radius + 0.1);
    const ring = [u, v, sub(v, u), mul(u, -1), mul(v, -1), sub(u, v)];
    const isRing = (c) => ring.some((r) => Math.hypot(r[0] - c[0], r[1] - c[1]) < 1e-9);
    for (const c of latticePoints(u, v, x0, x1, y0, y1)) {
      const cls = Math.hypot(c[0], c[1]) < 1e-9 ? "copy home" : isRing(c) ? "copy ring" : "copy";
      make("use", { href: "#slide-shape", x: board.X(c[0]).toFixed(2), y: board.Y(c[1]).toFixed(2), class: cls }, layer.copies);
    }
    for (const c of [h.p, h.q, sub(h.q, h.p), mul(h.p, -1), mul(h.q, -1), sub(h.p, h.q)])
      make("circle", { cx: board.X(c[0]), cy: board.Y(c[1]), r: 3.6, class: "contact" }, layer.marks);
    const d = cur.shape.area / (4 * h.det);
    $("slide-density").textContent = pct(d);
    $("slide-board-density").textContent = pct(d);
    $("slide-best").textContent = pct(Math.max(...cur.curve));
    range.value = String(Math.round(t * 1000));
    range.setAttribute("aria-valuetext", `${Math.round(t * 100)}% of the slide, density ${pct(d)}`);
    drawChart(d);
    svg.setAttribute(
      "aria-label",
      `A packing of the ${cur.name.toLowerCase()} in which each copy touches six others, covering ${pct(d)} of the plane`
    );
  }

  function drawChart(d) {
    chart.replaceChildren();
    const W = 320;
    const H = 150;
    const L = 44;
    const R = 8;
    const T = 10;
    const B = 26;
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const X = (s) => L + s * (W - L - R);
    const Y = (y) => T + ((HI - y) / (HI - LO)) * (H - T - B);
    for (const y of [0.89, 0.895, 0.9, 0.905, 0.91]) {
      make("line", { x1: L, x2: W - R, y1: Y(y), y2: Y(y), class: "gridline" }, chart);
      const tx = make("text", { x: L - 6, y: Y(y) + 4, class: "tick end" }, chart);
      tx.textContent = `${(100 * y).toFixed(1)}%`;
    }
    for (const [s, label] of [
      [0, "start"],
      [1, "one slide"],
    ]) {
      const tx = make("text", { x: X(s), y: H - 8, class: `tick ${s ? "end" : "start"}` }, chart);
      tx.textContent = label;
    }
    for (const s of SHAPES) {
      const pts = s.curve.map((y, i) => `${i ? "L" : "M"}${X(i / SAMPLES).toFixed(1)} ${Y(y).toFixed(1)}`).join("");
      make("path", { d: pts, class: `series ${s.color}${s === cur ? " current" : ""}` }, chart);
    }
    make("line", { x1: X(t), x2: X(t), y1: T, y2: H - B, class: "cursor" }, chart);
    make("circle", { cx: X(t), cy: Y(d), r: 4.5, class: `dotmark ${cur.color}` }, chart);
  }

  function frame(now) {
    if (!playing) return;
    t = (t + (now - last) / PERIOD) % 1;
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function play(on) {
    playing = on;
    $("slide-play").setAttribute("aria-pressed", String(on));
    $("slide-play").textContent = on ? "Pause" : "Play";
    cancelAnimationFrame(raf);
    if (on) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function choose(s) {
    cur = s;
    for (const b of document.querySelectorAll("#slide-shapes .mode")) b.setAttribute("aria-pressed", String(b.dataset.key === s.key));
    $("slide-note").textContent = s.note;
    draw();
  }

  for (const s of SHAPES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode";
    b.dataset.key = s.key;
    b.textContent = s.short;
    b.setAttribute("aria-label", s.name);
    b.addEventListener("click", () => choose(s));
    $("slide-shapes").append(b);
  }
  range.addEventListener("input", () => {
    play(false);
    t = +range.value / 1000;
    draw();
  });
  $("slide-play").addEventListener("click", () => play(!playing));

  // play while the board is on screen, unless motion is reduced
  if (!reducedMotion() && "IntersectionObserver" in window) {
    let auto = true;
    new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && auto) play(true);
        else if (!e.isIntersecting && playing) play(false);
      }
    }).observe(svg);
    range.addEventListener("input", () => (auto = false));
    $("slide-play").addEventListener("click", () => (auto = playing));
  }
  choose(cur);
}
