// Checks the numbers the playground shows against what the Lean library
// proves, through the page's own code (cases.js and geometry.js).
// Run with: node heilbronn/test.mjs
import assert from "node:assert/strict";
import { CASES } from "./cases.js";
import {
  analyse,
  area,
  assignment,
  climb,
  climber,
  images,
  leastArea,
  sameSet,
  scatter,
  sides,
  simplex,
  stabilizer,
  SYMMETRIES,
  triangleName,
  triples,
} from "./geometry.js";

let rng = 20261115;
const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
const ok = (msg) => console.log(`ok   ${msg}`);

// ------------------------------------------------------------- nine points

const C = CASES.find((c) => c.n === 9);
const H9 = (9 * Math.sqrt(65) - 55) / 320;
const names = (tris) => tris.map(({ t }) => triangleName(t, C.names)).sort();
const ELEVEN = ["ABC", "ABH", "ADO", "AGH", "BEO", "CFO", "CGO", "DEF", "DHO", "EFG", "FGH"];

assert.equal(C.value, H9);
assert.equal(C.value.toFixed(7), "0.0548760");
assert.equal(C.exact, "(9√65 − 55)/320");
assert.deepEqual(C.names, ["A", "B", "C", "D", "E", "F", "G", "H", "O"]);
ok(`H9 = ${C.exact} = ${C.value.toFixed(10)}`);

// The configuration of Heilbronn/Geometry.lean, from p₀ = (15 − √65)/40.
const p0 = (15 - Math.sqrt(65)) / 40;
assert.ok(Math.abs(20 * p0 * p0 - 15 * p0 + 2) < 1e-15, "p₀ is a root of 20x² − 15x + 2");
assert.equal(p0.toFixed(5), "0.17344");
const expected = [
  [0, 4 * p0 - 0.5],
  [p0, 0],
  [1 - 1.5 * p0, 0],
  [1, 1.5 * p0],
  [1, 1 - p0],
  [1.5 - 4 * p0, 1],
  [p0, 1],
  [0, 1 - p0],
  [1 - 2 * p0, 2 * p0],
];
C.optimal.forEach((p, i) => assert.ok(Math.abs(p[0] - expected[i][0]) < 1e-15 && Math.abs(p[1] - expected[i][1]) < 1e-15, C.names[i]));
for (const [x, y] of C.optimal) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);

// Two points on each side and O inside, as the page's note says.
const where = C.optimal.map((p) => sides(p).join());
assert.deepEqual(where, ["left", "bottom", "bottom", "right", "right", "top", "top", "left", ""]);
ok("the points: A, H left; B, C bottom; D, E right; F, G top; O inside");

// The least area and the eleven triangles that attain it; the next is CDO.
const s = analyse(C.optimal, 0.05);
assert.equal(triples(9).length, 84);
assert.ok(Math.abs(s.least - H9) < 1e-15, `least ${s.least}`);
assert.equal(s.least.toFixed(7), "0.0548760");
assert.deepEqual(names(s.ties), ELEVEN);
for (const { a } of s.ties) assert.ok(Math.abs(a - H9) < 1e-15);
assert.deepEqual(names(s.near), ["CDO"]);
const cdo = s.near[0].a;
assert.equal(((100 * (cdo - s.least)) / s.least).toFixed(1), "2.8");
const gap = s.tris[12].a / s.least;
assert.ok(gap > 1.3, "the thirteenth smallest is far above");
assert.ok(!s.collinear);
ok(`least area ${s.least.toFixed(16)}, attained by exactly ${ELEVEN.join(" ")}; CDO is +2.8%, the next +${((gap - 1) * 100).toFixed(0)}%`);

// The eight symmetries: the same least area and the same eleven triangles
// (the points keep their names), and four distinct point sets.
for (const g of SYMMETRIES) {
  const Q = C.optimal.map(g.map);
  for (const [x, y] of Q) assert.ok(x >= -1e-15 && x <= 1 + 1e-15 && y >= -1e-15 && y <= 1 + 1e-15);
  const t = analyse(Q);
  assert.ok(Math.abs(t.least - H9) < 1e-15, `${g.name}: ${t.least}`);
  assert.deepEqual(names(t.ties), ELEVEN, g.name);
}
ok("all eight images: least area H9, the same eleven triangles");

const imgs = images(C.optimal);
assert.equal(imgs.length, 4);
assert.deepEqual(
  imgs.map((im) => im.symmetry.key),
  ["id", "r90", "r180", "r270"]
);
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(!sameSet(imgs[i].points, imgs[j].points, 1e-6));
for (const g of SYMMETRIES) assert.equal(imgs.filter((im) => sameSet(im.points, C.optimal.map(g.map))).length, 1, g.name);
ok(`four distinct point sets, shown as ${imgs.map((im) => im.symmetry.short).join(", ")}`);

// The configuration's own symmetry: the identity and the anti-diagonal, which
// swaps A↔F, B↔E, C↔D, G↔H and fixes O.
const stab = stabilizer(C.optimal);
assert.deepEqual(
  stab.map((x) => x.symmetry.key),
  ["id", "a"]
);
const swap = stab[1].perm.map((j) => C.names[j]).join("");
assert.equal(swap, "FEDCBAHGO");
ok("its symmetry: the anti-diagonal, A↔F, B↔E, C↔D, G↔H, O fixed");

// The figure's mirror pairs (scripts/nine/figure.py in the Lean library).
const mirror = (n) =>
  [...n]
    .map((c) => swap[C.names.indexOf(c)])
    .sort()
    .join("");
for (const n of ELEVEN) assert.ok(ELEVEN.includes(mirror(n)), n);
assert.deepEqual(
  ELEVEN.filter((n) => mirror(n) === n),
  ["BEO"]
);
ok("the eleven triangles: five mirror pairs and BEO");

// The start: the 3 × 3 grid, eight lines of three points, least area 0.
const g = analyse(C.start);
assert.ok(g.collinear && g.least === 0);
assert.equal(g.ties.length, 8);
assert.deepEqual([...C.start].map(([x, y]) => `${x},${y}`).sort(), ["0,0", "0,0.5", "0,1", "0.5,0", "0.5,0.5", "0.5,1", "1,0", "1,0.5", "1,1"]);
ok("the start: the 3 × 3 grid, least area 0 on eight lines");

// ------------------------------------------------- nothing beats the bound

// Random configurations, and the local search from them: never above H9,
// and every step of the climb keeps the points in the square and never lowers
// the least area.
let top = 0;
for (let k = 0; k < 20000; k++) top = Math.max(top, leastArea(scatter(9, rand, 0)));
assert.ok(top < H9);
let climbs = 0;
let best = 0;
for (let k = 0; k < 60; k++) {
  const c = climber(scatter(9, rand));
  let last = c.least;
  while (!c.done && c.steps < 4000) {
    climb(c);
    assert.ok(c.least >= last - 1e-15, "the climb went down");
    last = c.least;
    for (const [x, y] of c.P) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
  }
  assert.ok(Math.abs(c.least - leastArea(c.P)) < 1e-15);
  assert.ok(c.least <= H9 + 1e-15, `above H9: ${c.least}`);
  best = Math.max(best, c.least);
  climbs++;
}
ok(`20000 random configurations, best ${(top / H9).toFixed(3)} of H9; ${climbs} climbs, best ${(best / H9).toFixed(3)} of H9, none above`);

// From near the optimal configuration, Improve climbs back to H9 exactly.
let back = 0;
for (let k = 0; k < 40; k++) {
  const P = C.optimal.map(([x, y]) => [Math.min(1, Math.max(0, x + 0.03 * (2 * rand() - 1))), Math.min(1, Math.max(0, y + 0.03 * (2 * rand() - 1)))]);
  const c = climber(P);
  while (!c.done && c.steps < 4000) climb(c);
  if (Math.abs(c.least - H9) < 1e-12) {
    back++;
    assert.ok(
      imgs.some((im) => sameSet(c.P, im.points, 1e-6)),
      "back at an optimal point set"
    );
  }
}
assert.ok(back >= 38, `only ${back} of 40 climbed back`);
ok(`Improve, from the optimal configuration moved by up to 0.03: ${back} of 40 back at H9 to 1e-12`);

// ------------------------------------------------------------- the helpers

// The simplex method on a small known program: max 3x + 2y, x + y ≤ 4, x + 3y ≤ 6, x ≤ 3.
const lp = simplex(
  [
    [1, 1],
    [1, 3],
    [1, 0],
  ],
  [4, 6, 3],
  [3, 2]
);
assert.ok(Math.abs(lp.value - 11) < 1e-12 && Math.abs(lp.x[0] - 3) < 1e-12 && Math.abs(lp.x[1] - 1) < 1e-12);

// The assignment against every permutation, for six points.
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
for (let k = 0; k < 30; k++) {
  const from = scatter(6, rand, 0);
  const to = scatter(6, rand, 0);
  const cost = (o) => o.reduce((s, i, q) => s + (from[i][0] - to[q][0]) ** 2 + (from[i][1] - to[q][1]) ** 2, 0);
  const brute = Math.min(...perms([0, 1, 2, 3, 4, 5]).map(cost));
  const o = assignment(from, to);
  assert.deepEqual([...o].sort(), [0, 1, 2, 3, 4, 5]);
  assert.ok(Math.abs(cost(o) - brute) < 1e-12);
}
assert.equal(area([0, 0], [1, 0], [0, 1]), 0.5);
ok("simplex, assignment and area");

// Every case: points in the square, names and start of the right length, and
// the value attained by the optimal configuration.
for (const c of CASES) {
  assert.equal(c.optimal.length, c.n);
  assert.equal(c.names.length, c.n);
  assert.equal(c.start.length, c.n);
  for (const key of ["title", "exact", "startName", "found", "note", "proved"]) assert.ok(c[key], `n = ${c.n}: ${key}`);
  assert.ok(Math.abs(leastArea(c.optimal) - c.value) < 1e-13, `n = ${c.n}`);
  for (const P of [c.optimal, c.start]) for (const [x, y] of P) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
}
ok(`the cases: ${CASES.map((c) => `n = ${c.n}`).join(", ")}`);
console.log("all checks passed");
