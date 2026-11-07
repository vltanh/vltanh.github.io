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
} from "./geometry.js";

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

if (failed) {
  console.error(`${failed} densities off`);
  process.exit(1);
}
console.log("all checks passed");
