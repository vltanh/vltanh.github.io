// 3. Try to beat it: a centrally symmetric convex polygon that the reader
// edits, with the density of its densest lattice packing computed live.
import {
  DELTA_DISK,
  DELTA_OCT,
  DELTA_REGULAR_OCTAGON,
  add,
  densestLattice,
  isConvex,
  mul,
  norm,
  polygonShape,
  sub,
  symmetricPolygon,
} from "./geometry.js";
import { $, Board, load, make, pct, save } from "./common.js";

const STORE = "smoothed-octagon-lowest";
const MAX_R = 2.05;
const BEST_DECAGON = 3.62173 / 4; // Ledermann and Mahler (1949), Q = 3.62173…

// The scale of densities under the board readout.
const LO = 0.9;
const HI = 0.91;

function regularHalf(m) {
  const R = 1 / Math.cos(Math.PI / (2 * m));
  const half = [];
  for (let k = 0; k < m; k++) {
    const a = ((k + 0.5) * Math.PI) / m; // the sides horizontal and vertical when they can be
    half.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return half;
}

export function initBeat() {
  const svg = $("beat-board");
  const g = (cls) => svg.querySelector(`.${cls}`);
  const layer = { grid: g("grid"), neighbours: g("neighbours"), shape: g("shape"), hexagon: g("hexagon"), handles: g("handles") };
  const board = new Board(svg, { cx: 0, cy: 0, half: 2.6 }, () => draw());

  let m = 4;
  let half = regularHalf(m);
  let sel = null;
  let drag = null;
  let result = null;
  let showPacking = true;
  let lowest = load(STORE);
  if (!lowest || typeof lowest.density !== "number" || !Array.isArray(lowest.half)) lowest = null;

  const verts = () => symmetricPolygon(half);

  function compute() {
    result = densestLattice(polygonShape(verts()));
    if (!lowest || result.density < lowest.density - 1e-9) {
      lowest = { density: result.density, half: half.map((p) => [...p]) };
      save(STORE, lowest);
    }
  }

  const validHalf = (h) => {
    const v = symmetricPolygon(h);
    return h.every((p) => norm(p) <= MAX_R) && isConvex(v, 0.02);
  };

  // Moves vertex i (and its opposite) towards the target as far as the
  // polygon stays convex, then slides it along the line that stopped it.
  function moveTo(i, target) {
    const at = (p) => half.map((q, j) => (j === i ? p : q));
    if (validHalf(at(target))) {
      half = at(target);
      return;
    }
    const n = 2 * m;
    const V = verts();
    const P = (j) => V[(((i + j) % n) + n) % n];
    const reach = (from, to) => {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 28; k++) {
        const mid = (lo + hi) / 2;
        if (validHalf(at(add(from, mul(sub(to, from), mid))))) lo = mid;
        else hi = mid;
      }
      return add(from, mul(sub(to, from), lo));
    };
    const stopAt = reach(half[i], target);
    let best = stopAt;
    let gap = norm(sub(target, stopAt));
    const rest = sub(target, stopAt);
    for (const dir of [sub(P(1), P(-1)), sub(P(-1), P(-2)), sub(P(2), P(1))]) {
      const l = norm(dir);
      if (l < 1e-9) continue;
      const u = mul(dir, 1 / l);
      const slid = reach(stopAt, add(stopAt, mul(u, rest[0] * u[0] + rest[1] * u[1])));
      const e = norm(sub(target, slid));
      if (e < gap - 1e-9) {
        gap = e;
        best = slid;
      }
    }
    half = at(best);
  }

  function drawGrid() {
    layer.grid.replaceChildren();
    const [x0, x1, y0, y1] = board.bounds();
    for (let x = Math.ceil(x0 * 2) / 2; x <= x1; x += 0.5)
      make("line", { x1: board.X(x), y1: 0, x2: board.X(x), y2: board.size, class: Math.abs(x) < 1e-9 ? "axis" : "minor" }, layer.grid);
    for (let y = Math.ceil(y0 * 2) / 2; y <= y1; y += 0.5)
      make("line", { x1: 0, y1: board.Y(y), x2: board.size, y2: board.Y(y), class: Math.abs(y) < 1e-9 ? "axis" : "minor" }, layer.grid);
  }

  function draw() {
    drawGrid();
    layer.neighbours.replaceChildren();
    layer.shape.replaceChildren();
    layer.hexagon.replaceChildren();
    layer.handles.replaceChildren();
    const V = verts();
    const { p, q } = result;
    const hex = [p, q, sub(q, p), mul(p, -1), mul(q, -1), sub(p, q)];
    if (showPacking) {
      for (const c of hex) {
        const shift = mul(c, 2);
        make("path", { d: board.path(V.map((x) => add(x, shift))), class: "neighbour" }, layer.neighbours);
      }
    }
    make("path", { d: board.path(V), class: "poly" }, layer.shape);
    if (showPacking) {
      make("path", { d: board.path(hex), class: "hex" }, layer.hexagon);
      for (const c of hex) make("circle", { cx: board.X(c[0]), cy: board.Y(c[1]), r: 3.4, class: "contact" }, layer.hexagon);
    }
    V.forEach((x, j) => {
      const i = j % m;
      const twin = j >= m;
      const h = make("g", { class: `handle${sel === i ? " selected" : ""}${twin ? " twin" : ""}` }, layer.handles);
      const hit = make("circle", { cx: board.X(x[0]), cy: board.Y(x[1]), r: 17, class: "hit" }, h);
      hit.dataset.i = i;
      hit.dataset.twin = twin ? "1" : "";
      make("circle", { cx: board.X(x[0]), cy: board.Y(x[1]), r: 6.5, class: "knob" }, h);
    });
    readout();
  }

  function marker(id, d) {
    const el = $(id);
    const s = Math.max(0, Math.min(1, (d - LO) / (HI - LO)));
    el.style.left = `${(100 * s).toFixed(2)}%`;
    el.classList.toggle("off-scale", d > HI);
  }

  function readout() {
    const d = result.density;
    $("beat-density").textContent = pct(d, 3);
    $("beat-board-density").textContent = pct(d, 3);
    $("beat-lowest").textContent = lowest ? pct(lowest.density, 3) : "–";
    $("beat-show-lowest").disabled = !lowest;
    marker("beat-you", d);
    if (lowest) marker("beat-low", lowest.density);
    $("beat-low").hidden = !lowest;
    const status = $("beat-status");
    status.classList.remove("good");
    const n = 2 * m;
    let msg;
    if (n <= 6) msg = `Every centrally symmetric ${n === 4 ? "parallelogram" : "hexagon"} tiles the plane, so it covers all of it. Try more corners.`;
    else if (d < DELTA_OCT - 1e-7)
      msg = "Below the smoothed octagon? That would disprove the conjecture, so a rounding error in this page is far more likely.";
    else if (d < BEST_DECAGON - 1e-6) {
      msg = "Worse than any octagon or decagon can be, and still above the smoothed octagon.";
      status.classList.add("good");
    } else if (d < DELTA_REGULAR_OCTAGON - 1e-6) {
      msg = "Worse than every octagon. Keep going.";
      status.classList.add("good");
    } else if (n === 8 && d < DELTA_REGULAR_OCTAGON + 1e-6)
      msg = "The regular octagon: Mahler proved that no centrally symmetric octagon packs worse.";
    else if (d < DELTA_DISK) msg = "Worse than the disk, but not worse than the regular octagon.";
    else msg = "Packs better than the disk. Drag the corners to make it pack worse.";
    status.textContent = msg;
    svg.setAttribute("aria-label", `A centrally symmetric polygon with ${n} corners whose densest packing covers ${pct(d, 3)} of the plane`);
  }

  function setCorners(k) {
    m = k / 2;
    half = regularHalf(m);
    sel = null;
    for (const b of document.querySelectorAll("#beat-corners .mode")) b.setAttribute("aria-pressed", String(+b.dataset.n === k));
    compute();
    draw();
  }

  function randomize() {
    for (let tries = 0; tries < 400; tries++) {
      const h = regularHalf(m).map(([x, y], k) => {
        const a = Math.atan2(y, x) + (Math.random() - 0.5) * (Math.PI / m) * 0.7;
        const r = norm([x, y]) * (0.8 + Math.random() * 0.45);
        void k;
        return [r * Math.cos(a), r * Math.sin(a)];
      });
      if (validHalf(h)) {
        half = h;
        break;
      }
    }
    compute();
    draw();
  }

  svg.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!t.dataset || t.dataset.i === undefined) {
      sel = null;
      draw();
      return;
    }
    sel = +t.dataset.i;
    const twin = t.dataset.twin === "1";
    drag = { i: sel, sign: twin ? -1 : 1, off: sub(board.toWorld(e), mul(half[sel], twin ? -1 : 1)) };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging", "pointer");
    svg.focus({ preventScroll: true, focusVisible: false });
    e.preventDefault();
    draw();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    moveTo(drag.i, mul(sub(board.toWorld(e), drag.off), drag.sign));
    compute();
    draw();
  });
  const end = () => {
    drag = null;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("blur", () => svg.classList.remove("pointer"));
  svg.addEventListener("keydown", (e) => {
    svg.classList.remove("pointer");
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (e.key === "Enter" || e.key === " ") sel = sel === null ? 0 : (sel + 1) % m;
    else if (e.key === "Escape") sel = null;
    else if (sel !== null && arrows[e.key]) {
      moveTo(sel, add(half[sel], mul(arrows[e.key], e.shiftKey ? 0.1 : 0.01)));
      compute();
    } else return;
    e.preventDefault();
    draw();
  });

  for (const b of document.querySelectorAll("#beat-corners .mode")) b.addEventListener("click", () => setCorners(+b.dataset.n));
  $("beat-reset").addEventListener("click", () => setCorners(2 * m));
  $("beat-random").addEventListener("click", randomize);
  $("beat-show-lowest").addEventListener("click", () => {
    if (!lowest) return;
    half = lowest.half.map((p) => [...p]);
    m = half.length;
    for (const b of document.querySelectorAll("#beat-corners .mode")) b.setAttribute("aria-pressed", String(+b.dataset.n === 2 * m));
    sel = null;
    compute();
    draw();
  });
  $("beat-packing").addEventListener("click", (e) => {
    showPacking = !showPacking;
    e.currentTarget.setAttribute("aria-pressed", String(showPacking));
    draw();
  });

  marker("beat-mark-oct", DELTA_OCT);
  marker("beat-mark-dec", BEST_DECAGON);
  marker("beat-mark-reg", DELTA_REGULAR_OCTAGON);
  marker("beat-mark-disk", DELTA_DISK);
  setCorners(8);
}
