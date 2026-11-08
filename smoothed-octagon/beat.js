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
import { $, Board, make, pct } from "./common.js";

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
  { key: "20gon", name: "20-gon", half: () => firstHalf(regularPolygon(20).outline) },
  { key: "near", name: "Near Reinhardt’s", half: () => firstHalf(smoothedOctagon({ arcSamples: 2 }).outline) },
];

// The gauge: a scale from 89.6% to 91% (where the shapes worth comparing
// lie), then a break, then 91% to 100% compressed, so that every density a
// shape can have, up to the 100% of a tiling, has a place on it.
const LO = 0.896;
const HI = 0.91;

export function drawGauge(gauge, d) {
  gauge.replaceChildren();
  const W = Math.max(240, Math.round(gauge.getBoundingClientRect().width) || 340);
  const H = 116;
  const M = 6; // the margin kept clear around everything drawn
  const L = M + 12; // 89.6%, right of the arrowhead at the left end
  const R = 24; // room for the 100% label right of the axis' end
  const axis = 66;
  const GAP = 12;
  gauge.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const B = L + 0.84 * (W - L - R); // where the axis breaks, at 91%
  const X = (x) => {
    const v = Math.min(1, Math.max(LO, x));
    return v <= HI ? L + ((v - LO) / (HI - LO)) * (B - L) : B + GAP + ((v - HI) / (1 - HI)) * (W - R - B - GAP);
  };
  // every label, with its halo, is kept the margin inside the gauge
  const text = (str, x, y, cls) => {
    const t = make("text", { x, y, class: cls }, gauge);
    t.textContent = str;
    const b = t.getBBox();
    if (b.width && b.x < M) t.setAttribute("x", x + M - b.x);
    else if (b.width && b.x + b.width > W - M) t.setAttribute("x", x - (b.x + b.width - (W - M)));
    return t;
  };
  // the axis goes on to the left, towards worse packers: an arrowhead inside
  // the margin, and the zone below the smoothed octagon starting after it
  make("rect", { x: M + 9, y: axis - 6, width: X(DELTA_OCT) - (M + 9), height: 12, class: "zone" }, gauge);
  make("path", { d: `M${M} ${axis}l9 -4.5v9z`, class: "arrowhead" }, gauge);
  make("line", { x1: M + 8, x2: B, y1: axis, y2: axis, class: "axis" }, gauge);
  make("line", { x1: B + GAP, x2: X(1), y1: axis, y2: axis, class: "axis" }, gauge);
  // the axis ends at 100%, the most any packing covers: an end cap, no arrow
  make("line", { x1: X(1), x2: X(1), y1: axis - 6, y2: axis + 6, class: "axis end-cap" }, gauge);
  for (const x of [B + 2, B + GAP - 2]) make("line", { x1: x - 3, x2: x + 3, y1: axis + 5, y2: axis - 5, class: "axis" }, gauge);
  for (const [t, label] of [
    [0.9, "90%"],
    [0.905, "90.5%"],
    [0.91, "91%"],
    [1, "100%"],
  ]) {
    const x = t === HI ? B : X(t);
    make("line", { x1: x, x2: x, y1: axis + 6, y2: axis + 10, class: "tick-mark" }, gauge);
    text(label, x, axis + 24, "tick");
  }
  // each label sits left of its own leader, and the leaders to its right start higher
  for (const [x, name, cls, y] of [
    [DELTA_DISK, "disk 90.69%", "disk", 14],
    [DELTA_REGULAR_OCTAGON, "regular octagon 90.62%", "reg", 31],
    [DELTA_OCT, "smoothed octagon", "oct", 48],
  ]) {
    make("line", { x1: X(x), x2: X(x), y1: y - 5, y2: axis + 6, class: `mark ${cls}` }, gauge);
    // left of its leader and clear of it; a little smaller where room is short
    const t = make("text", { x: X(x) - 5, y, class: `mark-label ${cls}` }, gauge);
    t.textContent = name;
    for (let size = 12.5; size >= 9.5 && t.getBBox().x < M; size -= 0.5) t.style.fontSize = `${size}px`;
  }
  text("← packs worse, the goal", M, axis + 40, "hint-label start");
  make("circle", { cx: X(d), cy: axis, r: 7, class: "you" }, gauge);
}

export function initBeat() {
  const svg = $("beat-board");
  const g = (cls) => svg.querySelector(`.${cls}`);
  const layer = { defs: svg.querySelector("defs"), copies: g("copies"), shape: g("shape"), marks: g("marks"), handles: g("handles") };
  const board = new Board(svg, { cx: 0, cy: 0, half: 3 }, () => draw());
  const copyDef = make("path", { id: "beat-copy" }, layer.defs);
  const gauge = $("beat-gauge");

  let H = PRESETS[2].half(); // the first half of the corners, counterclockwise
  let preset = "octagon";
  let sel = null; // the corner pair last grabbed, joined through the centre
  let drag = null;
  let result = null;

  const verts = (h = H) => symmetricPolygon(h);
  const valid = (h) => h.length >= MIN_PAIRS && h.every((p) => norm(p) <= MAX_R) && isConvex(symmetricPolygon(h), EPS);

  function compute() {
    result = densestLattice(polygonShape(verts()));
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

  function readout() {
    const d = result.density;
    $("beat-density").textContent = pct(d, 3);
    $("beat-board-density").textContent = pct(d, 3);
    $("beat-count").textContent = `${2 * H.length} corners`;
    $("beat-fewer").disabled = H.length <= MIN_PAIRS;
    $("beat-more").disabled = H.length >= MAX_PAIRS;
    for (const b of document.querySelectorAll("#beat-presets .mode")) b.setAttribute("aria-pressed", String(b.dataset.key === preset));
    drawGauge(gauge, d);
    const status = $("beat-status");
    status.classList.remove("good");
    const n = 2 * H.length;
    let msg;
    if (n <= 6) msg = `A ${n === 4 ? "parallelogram" : "hexagon"} like this tiles the plane and leaves no gaps. Add corners.`;
    else if (preset === "20gon")
      msg =
        "The regular 20-gon packs better than the disk, as do the regular polygons with 10, 12, 14, 16, 24 and 32 corners; the regular octagon is the exception. Drag the corners to make the gaps bigger.";
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
    svg.classList.add("dragging");
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
  new ResizeObserver(() => result && drawGauge(gauge, result.density)).observe(gauge);

  usePreset(PRESETS[2]);
}
