// 1. Pack it yourself: copies of a shape on a lattice spanned by two vectors
// that the reader drags, with the density live. The copies are solid: a drag
// stops where two copies of the packing meet and slides along the contact,
// so no two copies ever overlap (see solidMove in geometry.js).
import {
  add,
  densestLattice,
  det,
  diskShape,
  hexagonAt,
  isPacking,
  latticePoints,
  mul,
  norm,
  reduce,
  regularPolygon,
  roundedPolygon,
  separate,
  smoothedOctagon,
  solidMove,
  sub,
} from "./geometry.js";
import { $, Board, make, pct, tween } from "./common.js";

export const SHAPES = [
  {
    key: "disk",
    name: "Disk",
    shape: diskShape(),
    note: "Six disks around each one, in a honeycomb pattern. They cover π/√12 of the plane, and no packing of disks does better.",
  },
  {
    key: "square",
    name: "Square",
    shape: regularPolygon(4),
    note: "Squares tile the plane, leaving nothing uncovered. Sliding one row along the next keeps the tiling.",
  },
  {
    key: "hexagon",
    name: "Hexagon",
    shape: regularPolygon(6),
    note: "Regular hexagons tile the plane too, and so does every hexagon whose opposite sides are parallel and equal.",
  },
  {
    key: "octagon",
    name: "Octagon",
    shape: regularPolygon(8),
    note: "The regular octagon packs a little worse than the disk, which Mahler called “rather surprising” in 1947. He also proved that no centrally symmetric octagon packs worse.",
  },
  {
    key: "smoothed14",
    name: "Smoothed 14-gon",
    shape: roundedPolygon(14, 1, { name: "smoothed 14-gon" }),
    note: "The next smoothed polygon in Hales’s family after the octagon: a regular 14-gon with its corners cut by hyperbolas. It covers a little less than the regular octagon and more than the smoothed octagon.",
  },
  {
    key: "smoothed",
    name: "Smoothed octagon",
    shape: smoothedOctagon(),
    note: "Reinhardt’s smoothed octagon: its densest packing covers (8 − 4√2 − log 2)/(2√2 − 1) of the plane. He conjectured in 1934 that no centrally symmetric convex shape does worse.",
  },
];

// A basis of the lattice spanned by u and v that is reduced, positively
// oriented, and has its first vector nearest to the direction of the x-axis.
function niceBasis(u, v) {
  let [a, b] = reduce(u, v);
  if (det(a, b) < 0) b = mul(b, -1);
  const cands = [
    [a, b],
    [b, mul(a, -1)],
    [mul(a, -1), mul(b, -1)],
    [mul(b, -1), a],
  ];
  cands.sort((x, y) => Math.abs(Math.atan2(x[0][1], x[0][0])) - Math.abs(Math.atan2(y[0][1], y[0][0])));
  return cands[0];
}

for (const s of SHAPES) {
  s.best = densestLattice(s.shape);
  // every position of a smoothed polygon's sliding family is densest; start
  // from the one of the project's figures, in which copies side by side share
  // an edge
  if (s.key.startsWith("smoothed")) s.best = { ...hexagonAt(s.shape, 0), density: s.best.density };
  [s.b1, s.b2] = separate(s.shape, niceBasis(mul(s.best.p, 2), mul(s.best.q, 2)));
  s.radius = Math.max(...s.shape.outline.map(norm));
}

const MAX_LEN = 4.4; // keeps the two copies on the board

export function initPack() {
  const svg = $("pack-board");
  const layer = {
    defs: svg.querySelector("defs"),
    copies: svg.querySelector(".copies"),
    arrows: svg.querySelector(".arrows"),
    movers: svg.querySelector(".movers"),
  };
  const board = new Board(svg, { cx: 0, cy: 0, half: 4.2 }, () => draw());

  let cur = SHAPES[5];
  let v = [cur.b1, cur.b2];
  let sel = null; // the vector the keys move
  let drag = null;
  let stop = () => {};

  const shapeDefs = make("path", { id: "pack-shape" }, layer.defs);

  // Moves vector i towards the target; the copies stop and slide at contact.
  function moveTo(i, target) {
    v = solidMove(cur.shape, v, i, target, { maxLen: MAX_LEN });
  }

  function draw() {
    const k = board.k;
    shapeDefs.setAttribute("d", board.localPath(cur.shape.outline));
    layer.copies.replaceChildren();
    layer.arrows.replaceChildren();
    layer.movers.replaceChildren();

    const [x0, x1, y0, y1] = board.bounds(cur.radius + 0.1);
    const pts = latticePoints(v[0], v[1], x0, x1, y0, y1);
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;
    for (const c of pts) {
      if (near(c, v[0]) || near(c, v[1])) continue;
      make(
        "use",
        { href: "#pack-shape", x: board.X(c[0]).toFixed(2), y: board.Y(c[1]).toFixed(2), class: near(c, [0, 0]) ? "copy home" : "copy" },
        layer.copies
      );
    }

    // the two copies that the reader moves, and the vectors to them
    v.forEach((w, i) => {
      const g = make("g", { class: `mover c${i + 1}${sel === i ? " selected" : ""}` }, layer.movers);
      const u = make("use", { href: "#pack-shape", x: board.X(w[0]).toFixed(2), y: board.Y(w[1]).toFixed(2) }, g);
      u.dataset.i = i;
      const len = norm(w) * k;
      const head = Math.min(9, len / 3);
      const ux = (w[0] * k) / len;
      const uy = (-w[1] * k) / len;
      const ax = board.X(0);
      const ay = board.Y(0);
      const bx = board.X(w[0]);
      const by = board.Y(w[1]);
      make("line", { x1: ax, y1: ay, x2: bx - ux * head * 0.8, y2: by - uy * head * 0.8, class: `arrow c${i + 1}` }, layer.arrows);
      make(
        "path",
        {
          d: `M${bx} ${by}L${bx - ux * head - uy * head * 0.45} ${by - uy * head + ux * head * 0.45}L${bx - ux * head + uy * head * 0.45} ${by - uy * head - ux * head * 0.45}Z`,
          class: `head c${i + 1}`,
        },
        layer.arrows
      );
      make("circle", { cx: bx, cy: by, r: 3.2, class: `tip c${i + 1}` }, layer.arrows);
    });
    make("circle", { cx: board.X(0), cy: board.Y(0), r: 3.2, class: "tip origin" }, layer.arrows);
    readout();
  }

  function readout() {
    const d = cur.shape.area / Math.abs(det(v[0], v[1]));
    $("pack-density").textContent = pct(d);
    $("pack-board-density").textContent = pct(d);
    $("pack-best").textContent = pct(cur.best.density);
    const status = $("pack-status");
    status.classList.remove("good");
    if (d > cur.best.density - 5e-5) {
      status.textContent = `A densest packing: no packing of the ${cur.name.toLowerCase()} covers more.`;
      status.classList.add("good");
    } else status.textContent = `A packing, with ${pct(1 - d)} of the plane left uncovered.`;
    svg.setAttribute("aria-label", `Copies of the ${cur.name.toLowerCase()} on a lattice, covering ${pct(d)} of the plane`);
  }

  // The basis of the densest lattice nearest to the present vectors.
  function nearestBest() {
    const cands = [];
    for (let p = -2; p <= 2; p++) for (let q = -2; q <= 2; q++) if (p || q) cands.push(add(mul(cur.b1, p), mul(cur.b2, q)));
    const D = det(cur.b1, cur.b2);
    let best = [cur.b1, cur.b2];
    let cost = Infinity;
    for (const a of cands) {
      for (const b of cands) {
        if (Math.abs(det(a, b) - D) > 1e-9 * Math.abs(D)) continue;
        const c = norm(sub(a, v[0])) + norm(sub(b, v[1]));
        if (c < cost) {
          cost = c;
          best = [a, b];
        }
      }
    }
    return best;
  }

  function glideTo(target) {
    stop();
    const from = v;
    stop = tween(
      450,
      (s) => {
        // a straight path between two packings may pass through overlaps:
        // each frame is pulled apart as far as needed
        v = separate(cur.shape, [add(from[0], mul(sub(target[0], from[0]), s)), add(from[1], mul(sub(target[1], from[1]), s))]);
        draw();
      },
      () => {
        v = isPacking(cur.shape, target[0], target[1]) ? target : separate(cur.shape, target);
        draw();
      }
    );
  }

  function choose(s) {
    stop();
    cur = s;
    v = [s.b1, s.b2];
    for (const b of document.querySelectorAll("#shapes .shape")) b.setAttribute("aria-pressed", String(b.dataset.key === s.key));
    $("pack-shape-name").textContent = s.name;
    $("pack-shape-note").textContent = s.note;
    draw();
  }

  // the thumbnails of the shapes
  const nav = $("shapes");
  for (const s of SHAPES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "shape";
    b.dataset.key = s.key;
    b.setAttribute("aria-pressed", "false");
    const t = make("svg", { viewBox: "-1.6 -1.6 3.2 3.2", "aria-hidden": "true" }, b);
    make("path", { d: `${s.shape.outline.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(3)} ${(-y).toFixed(3)}`).join("")}Z`, class: "thumb" }, t);
    const cap = document.createElement("span");
    cap.className = "shape-name";
    cap.textContent = s.name;
    const dens = document.createElement("span");
    dens.className = "shape-density";
    dens.textContent = pct(s.best.density);
    b.append(cap, dens);
    b.addEventListener("click", () => choose(s));
    nav.append(b);
  }

  svg.addEventListener("pointerdown", (e) => {
    const i = e.target.dataset ? e.target.dataset.i : undefined;
    if (i === undefined) {
      sel = null;
      draw();
      return;
    }
    stop();
    sel = +i;
    const w = board.toWorld(e);
    drag = { i: sel, off: sub(w, v[sel]) };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging", "pointer");
    svg.focus({ preventScroll: true, focusVisible: false });
    e.preventDefault();
    draw();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    moveTo(drag.i, sub(board.toWorld(e), drag.off));
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
    if (e.key === "Enter" || e.key === " ") sel = sel === 0 ? 1 : 0;
    else if (e.key === "Escape") sel = null;
    else if (sel !== null && arrows[e.key]) {
      stop();
      const d = e.shiftKey ? 0.1 : 0.02;
      moveTo(sel, add(v[sel], mul(arrows[e.key], d)));
    } else return;
    e.preventDefault();
    draw();
  });

  $("pack-densest").addEventListener("click", () => glideTo(nearestBest()));
  $("pack-spread").addEventListener("click", () => {
    const f = Math.min(1.18, MAX_LEN / Math.max(norm(v[0]), norm(v[1])));
    glideTo([mul(v[0], f), mul(v[1], f)]);
  });

  choose(cur);
}
