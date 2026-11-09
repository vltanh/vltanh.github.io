// 5. A short history, from the repository's docs/prior-work.md. Each entry
// sets the best lower bound proved by then on the density of the densest
// packing of a centrally symmetric convex shape.
import { DELTA_DISK, DELTA_OCT, DELTA_REGULAR_OCTAGON } from "./geometry.js";
import { $, make } from "./common.js";

const ENTRIES = [
  {
    year: "1934",
    who: "Karl Reinhardt",
    text: "Asks which centrally symmetric convex shape packs worst, proves that a worst shape exists and has no corners, and leaves open which one it is. On the last page he proposes the regular octagon with each corner cut off by the hyperbola that touches its two sides and approaches the next two.",
    floor: null,
  },
  {
    year: "1946–47",
    who: "Kurt Mahler",
    text: "Proves that every such shape packs at least √3/2 ≈ 86.60%. Independently of Reinhardt, he shows that a worst shape exists and “is not an ellipse”, finds that among octagons the regular one is worst (“This result is rather surprising”), and builds the smoothed octagon: “possibly even its exact value.”",
    floor: Math.sqrt(3) / 2,
  },
  {
    year: "1949",
    who: "Walter Ledermann and Kurt Mahler",
    text: "Name the “smoothed octagon”. They find that the smoothed decagon packs better than it, “a result which seems to support Reinhardt’s conjecture”.",
    floor: Math.sqrt(3) / 2,
  },
  {
    year: "1950",
    who: "László Fejes Tóth",
    text: "Proves that for centrally symmetric shapes no packing beats the best lattice packing, so Reinhardt’s question about lattices is the question about all packings.",
    floor: Math.sqrt(3) / 2,
  },
  {
    year: "1961",
    who: "V. Ennola",
    text: "Raises the lower bound to 88%.",
    floor: 0.88,
  },
  {
    year: "1970",
    who: "P. P. Tammela",
    text: "Raises it to 89.2656%, the bound still listed in the 2017 Handbook of Discrete and Computational Geometry.",
    floor: 0.892656,
  },
  {
    year: "1986",
    who: "F. L. Nazarov",
    text: "Proves that the smoothed octagon is a local minimum: every shape close enough to it packs at least as densely.",
    floor: 0.892656,
  },
  {
    year: "2011, 2017",
    who: "Thomas Hales",
    text: "Recasts the problem in the calculus of variations, then as a problem of optimal control. He shows that the circle is not a minimizer, that a minimizer that is piecewise analytic is a smoothed polygon, and that the smoothed octagon is “a strict (micro) local minimum”. The smoothed octagon, and more generally every smoothed regular polygon with 6<i>k</i> + 2 sides, is a Pontryagin extremal of the control problem.",
    floor: 0.892656,
  },
  {
    year: "2024",
    who: "Thomas Hales and Koundinya Vajjha",
    text: "In the 283-page book <i>Packings of Smoothed Polygons</i>, prove Mahler’s first conjecture: a worst shape is a smoothed polygon with finitely many sides. The known extremals are the smoothed polygons with 8, 14, 20, … sides and their limit, the circle, and the octagon packs worst among them. A proof that no other extremals exist “would complete a proof of the Reinhardt conjecture”, which “remains open”.",
    floor: 0.892656,
  },
  {
    year: "2026",
    who: "Lean 4",
    text: "The conjecture is proved in Lean 4, with its equality case, building on Hales’s control problem and Hales and Vajjha’s book. ChatGPT Pro drafted the argument, and Claude Opus 5.5 wrote the Lean proof, on Lean formalizations of results of the book and of the Pontryagin maximum principle. Lean’s kernel checks every step.",
    floor: DELTA_OCT,
    lean: true,
  },
];

// the scale of the number line
const LO = 0.86;
const HI = 0.91;

export function initHistory() {
  const list = $("timeline");
  const line = $("history-line");
  let sel = ENTRIES.length - 1;

  ENTRIES.forEach((e, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "event";
    b.dataset.i = i;
    b.innerHTML = `<span class="year">${e.year}</span><span class="who">${e.who}</span><span class="what">${e.text}</span>`;
    b.addEventListener("click", () => select(i));
    li.append(b);
    list.append(li);
  });

  function drawLine() {
    line.replaceChildren();
    // drawn at the size it is shown, so that the text keeps its size
    const W = Math.max(280, Math.round(line.getBoundingClientRect().width) || 640);
    const narrow = W < 480;
    const L = 16;
    const R = 16;
    const base = 92;
    const H = base + 62;
    line.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const X = (d) => L + ((d - LO) / (HI - LO)) * (W - L - R);
    const floor = ENTRIES[sel].floor;
    if (floor) {
      make("rect", { x: X(LO), y: base - 7, width: X(floor) - X(LO), height: 14, class: "proved" }, line);
      make("rect", { x: X(floor), y: base - 7, width: X(DELTA_OCT) - X(floor), height: 14, class: "open" }, line);
    } else make("rect", { x: X(LO), y: base - 7, width: X(DELTA_OCT) - X(LO), height: 14, class: "open" }, line);
    make("line", { x1: X(LO), x2: X(HI), y1: base, y2: base, class: "axis" }, line);
    for (let d = LO; d <= HI + 1e-9; d += 0.01) {
      make("line", { x1: X(d), x2: X(d), y1: base + 7, y2: base + 12, class: "tick-mark" }, line);
      const t = make("text", { x: X(d), y: base + 28, class: "tick" }, line);
      t.textContent = `${Math.round(100 * d)}%`;
    }
    // each label sits left of its own leader, and the leaders to its right
    // start higher up, so no leader crosses a label
    const marks = [
      [DELTA_DISK, "disk", "disk", -66],
      [DELTA_REGULAR_OCTAGON, narrow ? "octagon" : "regular octagon", "reg", -46],
      [DELTA_OCT, "smoothed octagon", "oct", -26],
    ];
    for (const [d, name, cls, dy] of marks) {
      make("line", { x1: X(d), x2: X(d), y1: base + dy - 5, y2: base, class: `mark ${cls}` }, line);
      make("circle", { cx: X(d), cy: base, r: 4, class: `mark-dot ${cls}` }, line);
      const t = make("text", { x: X(d) - 5, y: base + dy, class: `mark-label ${cls}` }, line);
      t.textContent = `${name} ${(100 * d).toFixed(2)}%`;
    }
    if (floor) {
      make("line", { x1: X(floor), x2: X(floor), y1: base - 12, y2: base + 36, class: "floor" }, line);
      const t = make("text", { x: X(floor) + (floor < 0.875 ? 6 : -6), y: base + 52, class: `floor-label ${floor < 0.875 ? "start" : ""}` }, line);
      t.textContent = `proved: at least ${(100 * floor).toFixed(floor === 0.88 ? 0 : 2)}%`;
    } else {
      const t = make("text", { x: X(LO) + 2, y: base + 52, class: "floor-label start" }, line);
      t.textContent = "no lower bound proved yet";
    }
  }

  function select(i) {
    sel = i;
    list.querySelectorAll(".event").forEach((b, j) => {
      b.setAttribute("aria-current", String(j === i));
    });
    const e = ENTRIES[i];
    $("history-caption").textContent = e.lean
      ? `The Lean proof closes the gap: every centrally symmetric convex shape packs at least ${(100 * DELTA_OCT).toFixed(2)}% of the plane, as Reinhardt conjectured.`
      : e.floor
        ? `By ${e.year.split(/[–,]/)[0]}, every centrally symmetric convex shape was known to pack at least ${(100 * e.floor).toFixed(e.floor === 0.88 ? 0 : 2)}% of the plane. The conjecture says ${(100 * DELTA_OCT).toFixed(2)}%, and the gap between was open.`
        : `In ${e.year} no lower bound was known yet. The conjecture says ${(100 * DELTA_OCT).toFixed(2)}%.`;
    drawLine();
  }

  select(sel);
  let width = 0;
  new ResizeObserver(() => {
    const w = Math.round(line.getBoundingClientRect().width);
    if (w !== width) {
      width = w;
      drawLine();
    }
  }).observe(line);
}
