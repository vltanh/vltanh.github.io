// 3. Try to beat it: the reader edits a centrally symmetric convex polygon and
// sees its densest lattice packing, recomputed live, around it. The goal is a
// shape whose densest packing covers less than the smoothed octagon's 90.24%,
// which would contradict Reinhardt's conjecture.
import {
  DELTA_DISK,
  DELTA_OCT,
  DELTA_REGULAR_OCTAGON,
  add,
  densestLattice,
  det,
  dot,
  isConvex,
  latticePoints,
  mul,
  norm,
  polygonShape,
  regularPolygon,
  smoothedOctagon,
  sub,
  symmetricPolygon,
} from "./geometry.js";
import { $, Board, load, make, pct, save } from "./common.js";

const STORE = "smoothed-octagon-lowest";
const MAX_R = 2.05; // keeps the shape on the board
const EPS = 0.02; // the least sine of the turn at a corner
const MIN_PAIRS = 2;
const MAX_PAIRS = 16;
const BEST_DECAGON = 3.62173 / 4; // Ledermann and Mahler (1949), Q = 3.62173…

const firstHalf = (verts) => verts.slice(0, verts.length / 2).map((p) => [...p]);

const PRESETS = [
  { key: "square", name: "Square", half: () => firstHalf(regularPolygon(4).outline) },
  { key: "hexagon", name: "Hexagon", half: () => firstHalf(regularPolygon(6).outline) },
  { key: "octagon", name: "Octagon", half: () => firstHalf(regularPolygon(8).outline) },
  { key: "round", name: "Round", half: () => firstHalf(regularPolygon(20).outline) },
  { key: "near", name: "Near Reinhardt’s", half: () => firstHalf(smoothedOctagon({ arcSamples: 2 }).outline) },
];

// the scale of the gauge
const LO = 0.898;
const HI = 0.91;

export function initBeat() {
  const svg = $("beat-board");
  const g = (cls) => svg.querySelector(`.${cls}`);
  const layer = { defs: svg.querySelector("defs"), copies: g("copies"), shape: g("shape"), marks: g("marks"), handles: g("handles") };
  const board = new Board(svg, { cx: 0, cy: 0, half: 3 }, () => draw());
  const copyDef = make("path", { id: "beat-copy" }, layer.defs);
  const gauge = $("beat-gauge");

  let H = PRESETS[2].half(); // the first half of the corners, counterclockwise
  let preset = "octagon";
  let sel = null; // the corner pair the keys move
  let drag = null;
  let result = null;
  let lowest = load(STORE);
  if (!lowest || typeof lowest.density !== "number" || !Array.isArray(lowest.half)) lowest = null;

  const verts = (h = H) => symmetricPolygon(h);
  const valid = (h) => h.length >= MIN_PAIRS && h.every((p) => norm(p) <= MAX_R) && isConvex(symmetricPolygon(h), EPS);

  function compute() {
    result = densestLattice(polygonShape(verts()));
    // only shapes the reader made count, not the starting shapes
    if (preset === null && H.length > 3 && (!lowest || result.density < lowest.density - 1e-9)) {
      lowest = { density: result.density, half: H.map((p) => [...p]) };
      save(STORE, lowest);
    }
  }

  // Moves corner i (and its opposite) towards the target as far as the shape
  // stays convex, then slides it along the line that stopped it.
  function moveTo(i, target) {
    const at = (p) => H.map((q, j) => (j === i ? p : q));
    if (valid(at(target))) {
      H = at(target);
      return;
    }
    const n = 2 * H.length;
    const V = verts();
    const P = (j) => V[(((i + j) % n) + n) % n];
    const reach = (from, to) => {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 28; k++) {
        const mid = (lo + hi) / 2;
        if (valid(at(add(from, mul(sub(to, from), mid))))) lo = mid;
        else hi = mid;
      }
      return add(from, mul(sub(to, from), lo));
    };
    const stopAt = reach(H[i], target);
    let best = stopAt;
    let gap = norm(sub(target, stopAt));
    const rest = sub(target, stopAt);
    for (const dir of [sub(P(1), P(-1)), sub(P(-1), P(-2)), sub(P(2), P(1))]) {
      const l = norm(dir);
      if (l < 1e-9) continue;
      const u = mul(dir, 1 / l);
      const slid = reach(stopAt, add(stopAt, mul(u, dot(rest, u))));
      const e = norm(sub(target, slid));
      if (e < gap - 1e-9) {
        gap = e;
        best = slid;
      }
    }
    H = at(best);
  }

  // Adds a pair of corners on edge j of the whole polygon, at its point x
  // pushed slightly outwards so that the shape stays convex, and the opposite
  // corner on the opposite edge. Returns the index of the new corner in the
  // first half, or null when there is no room.
  function insertAt(j, x) {
    const m = H.length;
    if (m >= MAX_PAIRS) return null;
    const V = verts();
    const a = V[j];
    const d = sub(V[(j + 1) % (2 * m)], a);
    const len = norm(d);
    const out = [d[1] / len, -d[0] / len];
    for (const f of [0.05, 0.025, 0.012]) {
      const p = add(x, mul(out, f * len));
      const h = H.map((q) => [...q]);
      const k = j < m ? j + 1 : j - m + 1;
      h.splice(k, 0, j < m ? p : mul(p, -1));
      if (valid(h)) {
        H = h;
        return k;
      }
    }
    return null;
  }

  // the button that adds corners puts them on the longest edge with room
  function addCorners() {
    const V = verts();
    const n = V.length;
    const order = V.map((p, j) => [j, norm(sub(V[(j + 1) % n], p))]).sort((x, y) => y[1] - x[1]);
    for (const [j] of order) {
      const k = insertAt(j, mul(add(V[j], V[(j + 1) % n]), 0.5));
      if (k !== null) return k;
    }
    return null;
  }

  // the button that removes corners takes the flattest pair
  function removeCorners(i = null) {
    if (H.length <= MIN_PAIRS) return;
    const V = verts();
    const n = V.length;
    const turn = (k) => {
      const e1 = sub(V[k], V[(k - 1 + n) % n]);
      const e2 = sub(V[(k + 1) % n], V[k]);
      return Math.atan2(det(e1, e2), dot(e1, e2));
    };
    const order = i !== null ? [i] : H.map((_, k) => k).sort((x, y) => turn(x) - turn(y));
    for (const k of order) {
      const h = H.filter((_, j) => j !== k);
      if (valid(h)) {
        H = h;
        return;
      }
    }
  }

  function draw() {
    layer.copies.replaceChildren();
    layer.shape.replaceChildren();
    layer.marks.replaceChildren();
    layer.handles.replaceChildren();
    const V = verts();
    copyDef.setAttribute("d", board.localPath(V));
    const R = Math.max(...V.map(norm));
    const u = mul(result.p, 2);
    const v = mul(result.q, 2);
    const [x0, x1, y0, y1] = board.bounds(R + 0.1);
    for (const c of latticePoints(u, v, x0, x1, y0, y1)) {
      if (Math.hypot(c[0], c[1]) < 1e-9) continue;
      make("use", { href: "#beat-copy", x: board.X(c[0]).toFixed(2), y: board.Y(c[1]).toFixed(2), class: "copy" }, layer.copies);
    }
    make("path", { d: board.path(V), class: "poly" }, layer.shape);
    // where the middle shape touches its six neighbours
    for (const c of [result.p, result.q, sub(result.q, result.p)])
      for (const s of [1, -1]) make("circle", { cx: board.X(s * c[0]), cy: board.Y(s * c[1]), r: 3, class: "contact" }, layer.marks);
    // the selected pair, joined through the centre
    if (sel !== null && sel < H.length) {
      const p = H[sel];
      make("line", { x1: board.X(p[0]), y1: board.Y(p[1]), x2: board.X(-p[0]), y2: board.Y(-p[1]), class: "pair-line" }, layer.marks);
      make("circle", { cx: board.X(0), cy: board.Y(0), r: 2.5, class: "centre" }, layer.marks);
    }
    // smaller handles where corners crowd
    let gapPx = Infinity;
    V.forEach((x, j) => (gapPx = Math.min(gapPx, norm(sub(V[(j + 1) % V.length], x)) * board.k)));
    const r = Math.max(3.5, Math.min(9, board.k * 0.09, 0.42 * gapPx));
    V.forEach((x, j) => {
      const cls = `handle${sel === j % H.length ? " selected" : ""}${j >= H.length ? " twin" : ""}`;
      make("circle", { cx: board.X(x[0]), cy: board.Y(x[1]), r, class: cls }, layer.handles);
    });
    readout();
  }

  function drawGauge(d) {
    gauge.replaceChildren();
    const W = Math.max(260, Math.round(gauge.getBoundingClientRect().width) || 340);
    const L = 10;
    const R = 14;
    const axis = 66;
    gauge.setAttribute("viewBox", `0 0 ${W} 108`);
    const X = (x) => L + ((Math.min(HI, Math.max(LO, x)) - LO) / (HI - LO)) * (W - L - R);
    make("rect", { x: X(LO), y: axis - 6, width: X(DELTA_OCT) - X(LO), height: 12, class: "zone" }, gauge);
    make("line", { x1: X(LO), x2: X(HI), y1: axis, y2: axis, class: "axis" }, gauge);
    for (const [t, label, cls] of [
      [0.9, "90%", ""],
      [0.905, "90.5%", ""],
      [0.91, "91%", " end"],
    ]) {
      make("line", { x1: X(t), x2: X(t), y1: axis + 6, y2: axis + 10, class: "tick-mark" }, gauge);
      const tx = make("text", { x: X(t), y: axis + 24, class: `tick${cls}` }, gauge);
      tx.textContent = label;
    }
    // each label sits left of its own leader, and the leaders to its right start higher
    for (const [x, name, cls, y] of [
      [DELTA_DISK, "disk 90.69%", "disk", 14],
      [DELTA_REGULAR_OCTAGON, "regular octagon 90.62%", "reg", 31],
      [DELTA_OCT, "smoothed octagon", "oct", 48],
    ]) {
      make("line", { x1: X(x), x2: X(x), y1: y - 5, y2: axis + 6, class: `mark ${cls}` }, gauge);
      const tx = make("text", { x: X(x) - 4, y, class: `mark-label ${cls}` }, gauge);
      tx.textContent = name;
    }
    const hint = make("text", { x: X(LO), y: axis + 40, class: "hint-label start" }, gauge);
    hint.textContent = "← packs worse, the goal";
    if (lowest) make("path", { d: `M${X(lowest.density)} ${axis + 7}l-5 8h10z`, class: "best-mark" }, gauge);
    const cx = X(d);
    make("circle", { cx, cy: axis, r: 7, class: "you" }, gauge);
    if (d > HI) make("path", { d: `M${cx + 9} ${axis - 5}l6 5l-6 5`, class: "off" }, gauge);
  }

  function readout() {
    const d = result.density;
    $("beat-density").textContent = pct(d, 3);
    $("beat-board-density").textContent = pct(d, 3);
    $("beat-count").textContent = `${2 * H.length} corners`;
    $("beat-fewer").disabled = H.length <= MIN_PAIRS;
    $("beat-more").disabled = H.length >= MAX_PAIRS;
    $("beat-lowest").textContent = lowest ? pct(lowest.density, 3) : "none yet";
    $("beat-show-lowest").disabled = !lowest;
    $("beat-forget").disabled = !lowest;
    for (const b of document.querySelectorAll("#beat-presets .mode")) b.setAttribute("aria-pressed", String(b.dataset.key === preset));
    drawGauge(d);
    const status = $("beat-status");
    status.classList.remove("good");
    const n = 2 * H.length;
    let msg;
    if (n <= 6) msg = `A ${n === 4 ? "parallelogram" : "hexagon"} like this tiles the plane and leaves no gaps. Add corners.`;
    else if (d < DELTA_OCT - 1e-7) msg = "Below 90.24% would disprove Reinhardt’s conjecture, so a rounding error in this page is far more likely.";
    else if (d < DELTA_OCT + 0.001) {
      msg = "Within 0.1 points of the smoothed octagon. Nazarov proved in 1986 that shapes close enough to it pack at least as densely as it does.";
      status.classList.add("good");
    } else if (d < BEST_DECAGON - 1e-6) {
      msg = "Worse than any octagon or decagon can pack, and still above the smoothed octagon.";
      status.classList.add("good");
    } else if (d < DELTA_REGULAR_OCTAGON - 1e-6) {
      msg = "Worse than any octagon can pack. Keep going.";
      status.classList.add("good");
    } else if (n === 8 && d < DELTA_REGULAR_OCTAGON + 1e-6)
      msg = "The regular octagon. Mahler proved that no octagon of this kind packs worse, so add corners.";
    else if (d < DELTA_DISK) msg = "Worse than the disk, but not yet worse than the regular octagon.";
    else msg = "This packs better than the disk. Drag the corners to make the orange gaps bigger.";
    status.textContent = msg;
    svg.setAttribute("aria-label", `A centrally symmetric shape with ${n} corners in its densest packing, which covers ${pct(d, 3)} of the plane`);
  }

  function update() {
    compute();
    draw();
  }

  function usePreset(p) {
    preset = p.key;
    H = p.half();
    sel = null;
    update();
  }

  // the corner or the edge under the pointer
  function hit(e) {
    const w = board.toWorld(e);
    const V = verts();
    const k = board.k;
    let best = null;
    V.forEach((x, j) => {
      const dpx = norm(sub(x, w)) * k;
      if (dpx < 24 && (!best || dpx < best.d)) best = { kind: "corner", d: dpx, i: j % H.length, twin: j >= H.length };
    });
    if (best) return best;
    for (let j = 0; j < V.length; j++) {
      const a = V[j];
      const ab = sub(V[(j + 1) % V.length], a);
      const t = Math.max(0.15, Math.min(0.85, dot(sub(w, a), ab) / dot(ab, ab)));
      const x = add(a, mul(ab, t));
      if (norm(sub(x, w)) * k < 14) return { kind: "edge", j, x };
    }
    return null;
  }

  svg.addEventListener("pointerdown", (e) => {
    const h = hit(e);
    const w = board.toWorld(e);
    if (!h) {
      sel = null;
      draw();
      return;
    }
    if (h.kind === "edge") {
      const k = insertAt(h.j, h.x);
      if (k === null) return;
      preset = null;
      sel = k;
      compute();
      // the corner under the pointer is the new one or its twin
      const sign = h.j < H.length - 1 ? 1 : -1;
      drag = { i: k, sign, off: sub(w, mul(H[k], sign)) };
    } else {
      sel = h.i;
      const sign = h.twin ? -1 : 1;
      drag = { i: h.i, sign, off: sub(w, mul(H[h.i], sign)) };
    }
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging", "pointer");
    svg.focus({ preventScroll: true, focusVisible: false });
    e.preventDefault();
    draw();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) {
      const h = hit(e);
      svg.classList.toggle("over-corner", Boolean(h && h.kind === "corner"));
      svg.classList.toggle("over-edge", Boolean(h && h.kind === "edge"));
      return;
    }
    preset = null;
    moveTo(drag.i, mul(sub(board.toWorld(e), drag.off), drag.sign));
    update();
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
    if (e.key === "Enter" || e.key === " ") sel = sel === null ? 0 : (sel + 1) % H.length;
    else if (e.key === "Escape") sel = null;
    else if (sel !== null && arrows[e.key]) {
      preset = null;
      moveTo(sel, add(H[sel], mul(arrows[e.key], e.shiftKey ? 0.1 : 0.01)));
      compute();
    } else if (sel !== null && (e.key === "Delete" || e.key === "Backspace")) {
      preset = null;
      removeCorners(sel);
      sel = null;
      compute();
    } else if (e.key === "+" || e.key === "=") {
      preset = null;
      sel = addCorners();
      compute();
    } else return;
    e.preventDefault();
    draw();
  });

  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode";
    b.dataset.key = p.key;
    b.textContent = p.name;
    b.addEventListener("click", () => usePreset(p));
    $("beat-presets").append(b);
  }
  $("beat-more").addEventListener("click", () => {
    preset = null;
    sel = addCorners();
    update();
  });
  $("beat-fewer").addEventListener("click", () => {
    preset = null;
    removeCorners();
    sel = null;
    update();
  });
  $("beat-show-lowest").addEventListener("click", () => {
    if (!lowest) return;
    H = lowest.half.map((p) => [...p]);
    preset = null;
    sel = null;
    update();
  });
  $("beat-forget").addEventListener("click", () => {
    lowest = null;
    save(STORE, null);
    draw();
  });
  new ResizeObserver(() => result && drawGauge(result.density)).observe(gauge);

  usePreset(PRESETS[2]);
}
