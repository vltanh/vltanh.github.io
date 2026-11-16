// The cases proved in the Lean library lean4-heilbronn, one entry per number
// of points n: the value H_n, the optimal configuration as stated in
// Heilbronn/Geometry.lean (its points in the proof's order, with the proof's
// names), the starting position, who found the configuration, and the texts
// of the page. A new case is a new entry; the page draws a button for each
// case once there are two, and test.mjs checks each entry.
import { assignment } from "./geometry.js";

const SQRT65 = Math.sqrt(65);

// The points of `from`, reordered so that the k-th goes to to[k] with the
// least movement: a starting position whose names match the optimal ones.
const matched = (from, to) => assignment(from, to).map((i) => from[i]);

// The 3 × 3 grid: eight lines of three points, so the least area is 0.
const GRID = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => [x, y]));

// p₀ = (15 − √65)/40, the smaller root of 20x² − 15x + 2 (Nine.p₀).
const p0 = (15 - SQRT65) / 40;
const NINE = [
  [0, 4 * p0 - 1 / 2],
  [p0, 0],
  [1 - (3 * p0) / 2, 0],
  [1, (3 * p0) / 2],
  [1, 1 - p0],
  [3 / 2 - 4 * p0, 1],
  [p0, 1],
  [0, 1 - p0],
  [1 - 2 * p0, 2 * p0],
];

const p = "<i>p</i><sub>0</sub>";
const pt = (name, x, y) => `<i>${name}</i> = <span class="nw">(${x}, ${y})</span>`;

export const CASES = [
  {
    n: 9,
    title: "Nine points",
    value: (9 * SQRT65 - 55) / 320,
    exact: "(9√65 − 55)/320",
    names: ["A", "B", "C", "D", "E", "F", "G", "H", "O"],
    optimal: NINE,
    start: matched(GRID, NINE),
    startName: "the 3 × 3 grid",
    found: "Comellas and Yebra",
    note: `<p>Comellas and Yebra found this configuration in 2002, by simulated annealing followed by an analytic refinement, and gave no proof that it is optimal. Two points lie on each side of the square and one, <i>O</i>, inside. Eleven of its 84 triangles have the least area <i>H</i><sub>9</sub>: <i>ABC</i>, <i>ABH</i>, <i>ADO</i>, <i>AGH</i>, <i>BEO</i>, <i>CFO</i>, <i>CGO</i>, <i>DEF</i>, <i>DHO</i>, <i>EFG</i> and <i>FGH</i>. The next smallest, <i>CDO</i>, is 2.8% larger.</p>
<p>The reflection in the anti-diagonal, <span class="nw">(<i>x</i>, <i>y</i>) ↦ (1 − <i>y</i>, 1 − <i>x</i>)</span>, swaps <i>A</i> and <i>F</i>, <i>B</i> and <i>E</i>, <i>C</i> and <i>D</i>, <i>G</i> and <i>H</i>, and leaves <i>O</i> in place, so it maps the configuration to itself. The eight symmetries of the square therefore give four point sets: the configuration and its quarter turns.</p>`,
    more: {
      title: "The coordinates",
      body: `<p>With ${p} = (15 − √65)/40 ≈ 0.17344, the smaller root of <span class="nw">20<i>x</i>² − 15<i>x</i> + 2</span>,</p>
<p class="eq">${pt("A", "0", `4${p} − 1/2`)}, &nbsp;${pt("B", p, "0")}, &nbsp;${pt("C", `1 − 3${p}/2`, "0")},<br>${pt("D", "1", `3${p}/2`)}, &nbsp;${pt("E", "1", `1 − ${p}`)}, &nbsp;${pt("F", `3/2 − 4${p}`, "1")},<br>${pt("G", p, "1")}, &nbsp;${pt("H", "0", `1 − ${p}`)}, &nbsp;${pt("O", `1 − 2${p}`, `2${p}`)}.</p>
<p>These are the points of <code>Nine.optimalConfiguration</code> in <code>Heilbronn/Geometry.lean</code>, in its order.</p>`,
    },
    proved: `<p>The Lean library proves that <i>H</i><sub>9</sub> = (9√65 − 55)/320 (the theorem <code>Heilbronn.Nine.heilbronn_number</code>), and that nine points in the square have least triangle area <i>H</i><sub>9</sub> exactly when, after relabelling, they are the image of this configuration under one of the eight symmetries of the square (<code>Heilbronn.Nine.optimal_configurations</code>). The proof is complete and rests on Lean's three standard axioms alone. The definitions and the statements are in the <a href="https://github.com/vltanh/lean4-heilbronn/blob/main/README.md">README</a>.</p>`,
  },
];
