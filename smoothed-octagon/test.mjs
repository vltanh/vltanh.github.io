// Checks the densest lattice packings computed by geometry.js against the
// known densities. Run with: node smoothed-octagon/test.mjs
import assert from "node:assert/strict";
import {
  DELTA_DISK,
  DELTA_OCT,
  DELTA_REGULAR_OCTAGON,
  DELTA_SMOOTHED_14,
  SQRT2,
  densestLattice,
  diskShape,
  hexagonAt,
  isConvex,
  leastGauge,
  mul,
  regularPolygon,
  roundedPolygon,
  smoothedOctagon,
  symmetricPolygon,
  polygonShape,
  shoelace,
  solidMove,
  separate,
  det,
  norm,
  sub,
  add,
} from "./geometry.js";
import { SHAPES } from "./pack.js";

const cases = [
  ["disk", diskShape(), DELTA_DISK],
  ["square", regularPolygon(4), 1],
  ["regular hexagon", regularPolygon(6), 1],
  ["regular octagon", regularPolygon(8), DELTA_REGULAR_OCTAGON],
  ["smoothed 14-gon", roundedPolygon(14, 1), DELTA_SMOOTHED_14],
  ["smoothed octagon", smoothedOctagon(), DELTA_OCT],
];

let failed = 0;
for (const [name, shape, expected] of cases) {
  const t0 = performance.now();
  const r = densestLattice(shape);
  const ms = performance.now() - t0;
  const ok = Math.abs(r.density - expected) < 5e-6;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(17)} ${r.density.toFixed(7)}  expected ${expected.toFixed(7)}  (${ms.toFixed(0)} ms)`);
  // The lattice of the hexagon is admissible: copies at 2p, 2q touch, none overlap.
  const g = leastGauge(shape, mul(r.p, 2), mul(r.q, 2));
  assert.ok(Math.abs(g - 2) < 1e-6, `${name}: the copies touch (least gauge ${g})`);
}

// The smoothed regular (6k + 2)-gons, drawn here as regular polygons whose
// corners are cut by hyperbolas asymptotic to the lines k sides beyond the
// corner, against the densities of the project's numeric model, which builds
// them from the trajectories of Hales's control problem
// (scripts/figures/octagon.py, SmoothedPolygon(k).density()). Each also has a
// continuum of densest packings: all its inscribed hexagons have one area.
const MODEL = [0.9024141829971578, 0.9060517532039851, 0.9066066235063395, 0.9067656455168379, 0.9068275491313229, 0.9068565024252699];
MODEL.forEach((expected, i) => {
  const k = i + 1;
  const P = roundedPolygon(6 * k + 2, 1);
  const d = densestLattice(P).density;
  const ok = Math.abs(d - expected) < 1e-8;
  if (!ok) failed++;
  const dets = [];
  for (let j = 0; j < 40; j++) dets.push(hexagonAt(P, (j / 40) * Math.PI).det);
  assert.ok(Math.max(...dets) - Math.min(...dets) < 1e-9, `the smoothed ${6 * k + 2}-gon slides`);
  console.log(`${ok ? "ok  " : "FAIL"} smoothed ${String(6 * k + 2).padStart(2)}-gon (k = ${k})  ${d.toFixed(10)}  model ${expected.toFixed(10)}`);
});
for (let i = 1; i < MODEL.length; i++) assert.ok(MODEL[i] > MODEL[i - 1] && MODEL[i] < DELTA_DISK);

// The smoothed octagon: its area, the corner arc, and the continuum of densest
// packings (every inscribed affinely regular hexagon has the same area).
const K = smoothedOctagon();
const fine = smoothedOctagon({ arcSamples: 4000 });
assert.ok(Math.abs(K.area - shoelace(fine.outline)) < 1e-8, `area ${K.area} against ${shoelace(fine.outline)}`);
assert.ok(Math.abs(K.c - SQRT2 / 4) < 1e-14, `c = ${K.c}`);
const T1 = [1, 1 - 1 / SQRT2];
const T2 = [SQRT2 - 0.5, 0.5];
for (const T of [T1, T2]) assert.ok(Math.abs(K.gauge(...T) - 1) < 1e-12, "the tangency points are on the boundary");
assert.ok(Math.abs((1 - T1[1]) * (SQRT2 - T1[0] + T1[1]) - 0.5) < 1e-14);
assert.ok(Math.abs(K.uCut * 2 - (2 - SQRT2)) < 1e-12, "straight part 2 − √2");
const dets = [];
for (let i = 0; i < 50; i++) dets.push(hexagonAt(K, (i / 50) * Math.PI).det);
assert.ok(Math.max(...dets) - Math.min(...dets) < 1e-9, "every inscribed hexagon has the same area");
const Ko = regularPolygon(8);
const detsO = [];
for (let i = 0; i < 50; i++) detsO.push(hexagonAt(Ko, (i / 50) * Math.PI).det);
assert.ok(Math.max(...detsO) - Math.min(...detsO) > 1e-3, "the regular octagon has no such continuum");
assert.equal(roundedPolygon(8, 0).alpha, 0);
assert.ok(Math.abs(roundedPolygon(8, 0).area - 8 * (SQRT2 - 1)) < 1e-12);

// Mahler (1947): no centrally symmetric octagon packs worse than the regular one.
let rng = 7;
const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
let lowest = Infinity;
for (let trial = 0; trial < 300; trial++) {
  const half = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 4 + (rand() - 0.5) * 0.5;
    const r = 1 + (rand() - 0.5) * 0.3;
    half.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const verts = symmetricPolygon(half);
  if (!isConvex(verts)) continue;
  lowest = Math.min(lowest, densestLattice(polygonShape(verts)).density);
}
assert.ok(lowest > DELTA_REGULAR_OCTAGON - 1e-7, `an octagon below the regular one: ${lowest}`);
console.log(`lowest of the random octagons: ${lowest.toFixed(6)}`);

// Section 1: the shape buttons go from the best packer to the worst, by the
// densities the page computes, and end on the smoothed octagon.
const dens = SHAPES.map((s) => s.best.density);
for (let i = 1; i < dens.length; i++) assert.ok(dens[i] <= dens[i - 1] + 1e-9, `shape ${SHAPES[i].key} out of order`);
assert.equal(SHAPES[SHAPES.length - 1].key, "smoothed");
console.log(`ok   shape order: ${SHAPES.map((s) => `${s.name} ${(100 * s.best.density).toFixed(2)}%`).join(", ")}`);

// Section 3: regular polygons with more corners than the octagon still pack
// better than the disk (the 20-gon is a starting shape); the octagon is the
// exception.
for (const [n, expected] of [
  [10, 0.91372],
  [12, 0.928203],
  [14, 0.907466],
  [16, 0.909017],
  [20, 0.907339],
  [24, 0.912115],
  [32, 0.907127],
]) {
  const d = densestLattice(regularPolygon(n)).density;
  assert.ok(Math.abs(d - expected) < 1e-6 && d > DELTA_DISK, `regular ${n}-gon: ${d}`);
}
assert.ok(densestLattice(regularPolygon(8)).density < DELTA_DISK);
console.log("ok   regular 10- to 32-gons pack better than the disk (20-gon 0.907339), the octagon worse");

// Section 1: the copies are solid. Random drags of either lattice vector, from
// the densest packing, short and long, towards the centre and away, never let
// two copies overlap (every lattice vector has gauge at least 2), never give
// a density above the densest, and still let the copies slide.
for (const [name, shape, best] of [
  ["disk", diskShape(), DELTA_DISK],
  ["square", regularPolygon(4), 1],
  ["regular hexagon", regularPolygon(6), 1],
  ["regular octagon", regularPolygon(8), DELTA_REGULAR_OCTAGON],
  ["smoothed 14-gon", roundedPolygon(14, 1), DELTA_SMOOTHED_14],
  ["smoothed octagon", smoothedOctagon(), DELTA_OCT],
]) {
  const r = densestLattice(shape);
  let B = [mul(r.p, 2), mul(r.q, 2)];
  assert.ok(leastGauge(shape, B[0], B[1]) >= 2 - 1e-9, `${name}: the densest packing is a packing`);
  let moved = 0;
  let worst = Infinity;
  let densest = 0;
  for (let k = 0; k < 1500; k++) {
    const i = k % 2;
    const a = rand() * 2 * Math.PI;
    const len = [0.05, 0.4, 2, 6][Math.floor(rand() * 4)];
    const target = k % 7 === 0 ? [0, 0] : add(B[i], [len * Math.cos(a), len * Math.sin(a)]);
    const before = B[i];
    B = solidMove(shape, B, i, target, { maxLen: 4.4 });
    const g = leastGauge(shape, B[0], B[1]);
    worst = Math.min(worst, g);
    densest = Math.max(densest, shape.area / Math.abs(det(B[0], B[1])));
    if (norm(sub(B[i], before)) > 0.01) moved++;
    assert.ok(g >= 2 - 1e-11, `${name}: copies overlap after move ${k} (least gauge ${g})`);
    assert.ok(norm(B[i]) <= 4.4 + 1e-9);
  }
  assert.ok(densest <= r.density + 1e-9 && Math.abs(r.density - best) < 5e-6, `${name}: density ${densest} above the densest ${best}`);
  assert.ok(moved > 300, `${name}: the copies hardly move (${moved})`);
  // no jumping: from the densest packing, a copy dragged through the middle
  // copy to the far side stays on its own side
  const D = [mul(r.p, 2), mul(r.q, 2)];
  const far = solidMove(shape, D, 0, mul(D[0], -1));
  assert.ok(norm(sub(far[0], D[0])) < norm(D[0]), `${name}: a copy jumped over the middle one`);
  // pulling overlapping copies apart
  const S = separate(shape, [mul(D[0], 0.8), mul(D[1], 0.8)]);
  assert.ok(leastGauge(shape, S[0], S[1]) >= 2 - 1e-9);
  console.log(`ok   solid ${name.padEnd(17)} least gauge ${worst.toFixed(12)}, highest density ${densest.toFixed(6)}, ${moved}/1500 moves`);
}

if (failed) {
  console.error(`${failed} densities off`);
  process.exit(1);
}
console.log("all checks passed");
