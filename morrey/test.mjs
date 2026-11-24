// Checks the mathematics that the Morrey page computes, through the page's own
// code (math.js). Run with: node morrey/test.mjs
import assert from "node:assert/strict";
import {
  I,
  J,
  U1,
  U2,
  WELL,
  WIGGLES,
  add,
  apply,
  average,
  bend,
  burkholder,
  conformal,
  convexMargin,
  deformSheet,
  det,
  detSq,
  diag,
  dm,
  dmHessian,
  dmLeast,
  dmProfile,
  frob,
  frob2,
  interfaceOf,
  laminate,
  laminateGap,
  makeSheet,
  mul,
  nearestRankOne,
  opNorm,
  outer,
  rank,
  rankOneMargin,
  rot,
  scale,
  stretch,
  sub,
  svd,
  testLines,
  threshold,
  twoWell,
  wiggleNodes,
} from "./math.js";

let seed = 20261124;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const ok = (msg) => console.log(`ok   ${msg}`);
const close = (x, y, tol, msg) => assert.ok(Math.abs(x - y) <= tol, `${msg}: ${x} vs ${y}`);
const randM = (r = 2) => [0, 0, 0, 0].map(() => (2 * rand() - 1) * r);

// ------------------------------------------------------------- 2 × 2 matrices

close(det([1, 2, 3, 4]), -2, 0, "det");
close(det(mul([1, 2, 3, 4], [0, 1, -1, 2])), det([1, 2, 3, 4]) * det([0, 1, -1, 2]), 1e-12, "det is multiplicative");
for (let i = 0; i < 200; i++) {
  const X = randM();
  const B = randM();
  const { z, w } = conformal(X);
  const rz = Math.hypot(...z);
  const rw = Math.hypot(...w);
  close(det(X), rz * rz - rw * rw, 1e-12, "det X = |z|² − |w|²");
  close(frob2(X), 2 * (rz * rz + rw * rw), 1e-12, "‖X‖² = 2(|z|² + |w|²)");
  const s = svd(X);
  close(opNorm(X), rz + rw, 1e-12, "|X| = |z| + |w|");
  close(s.s1 * s.s2, Math.abs(det(X)), 1e-10, "σ₁σ₂ = |det X|");
  // X = σ₁ u₁ v₁ᵀ + σ₂ u₂ v₂ᵀ.
  const R = add(outer(scale(s.u1, s.s1), s.v1), outer(scale(s.u2, s.s2), s.v2));
  for (let k = 0; k < 4; k++) close(R[k], X[k], 1e-10, "the SVD recomposes X");
  // det(X + B) = det X + ⟨cof X, B⟩ + det B.
  const c = [X[3], -X[2], -X[1], X[0]];
  close(det(add(X, B)), det(X) + c[0] * B[0] + c[1] * B[1] + c[2] * B[2] + c[3] * B[3] + det(B), 1e-10, "cofactor expansion");
}
ok("det, the conformal coordinates and the SVD agree on 200 random matrices");

assert.equal(rank([0, 0, 0, 0]), 0);
assert.equal(rank(outer([1, 2], [3, -1])), 1);
assert.equal(rank(outer([0.3, 0], [0, 1])), 1);
assert.equal(rank([1, 2, 2, 4]), 1);
assert.equal(rank(I), 2);
assert.equal(rank([1, 2, 3, 4]), 2);
assert.equal(rank([1, 2, 2, 4.001]), 2);
for (let i = 0; i < 200; i++) {
  const a = [2 * rand() - 1, 2 * rand() - 1];
  const n = [2 * rand() - 1, 2 * rand() - 1];
  assert.equal(rank(outer(a, n)), 1, "a ⊗ n has rank one");
  close(det(outer(a, n)), 0, 1e-15, "det(a ⊗ n) = 0");
  const X = randM();
  const R1 = nearestRankOne(X);
  assert.equal(rank(R1), 1);
  // The nearest rank-one matrix is σ₁u₁v₁ᵀ, at distance σ₂, and no rank-one matrix is nearer.
  close(frob(sub(X, R1)), svd(X).s2, 1e-10, "distance to the nearest rank-one matrix");
  for (let k = 0; k < 20; k++) {
    const b = [2 * rand() - 1, 2 * rand() - 1];
    const m = [2 * rand() - 1, 2 * rand() - 1];
    assert.ok(frob(sub(X, outer(b, m))) >= svd(X).s2 - 1e-12, "no rank-one matrix is nearer");
  }
}
ok("rank, a ⊗ n, and the nearest matrix of rank one (Eckart–Young)");

// ------------------------------------------------------------- laminates

// C − A = a ⊗ n: the layers fit, with interfaces perpendicular to n.
for (let i = 0; i < 100; i++) {
  const A = randM(1.2);
  const th = 2 * Math.PI * rand();
  const n0 = [Math.cos(th), Math.sin(th)];
  const a0 = [2 * rand() - 1, 2 * rand() - 1];
  const C = add(A, outer(a0, n0));
  const f = interfaceOf(A, C, n0);
  close(f.mismatch, 0, 1e-9, "no mismatch for a rank-one difference");
  close(Math.abs(f.n[0] * n0[0] + f.n[1] * n0[1]), 1, 1e-9, "the interface normal is n");
  const D = outer(f.a, f.n);
  for (let k = 0; k < 4; k++) close(D[k], sub(C, A)[k], 1e-9, "C − A = a ⊗ n");
  const lam = laminate(A, C, f.n, 2 + Math.floor(rand() * 20));
  close(laminateGap(lam), 0, 1e-9, "the layers meet without a gap");
}
// A difference of rank two leaves a gap; the gap along an interface of length ℓ is σ₂ ℓ / 2
// at each end, since the layers are pinned at its middle.
for (let i = 0; i < 100; i++) {
  const A = randM(1.2);
  const C = add(A, randM(0.8));
  const f = interfaceOf(A, C);
  const s = svd(sub(C, A));
  close(f.mismatch, s.s2, 1e-12, "the mismatch is σ₂");
  assert.ok(f.mismatch > 0);
  const lam = laminate(A, C, f.n, 8);
  for (const g of lam.interfaces) {
    const len = Math.hypot(g.ref[1][0] - g.ref[0][0], g.ref[1][1] - g.ref[0][1]);
    const mid = [(g.ref[0][0] + g.ref[1][0]) / 2, (g.ref[0][1] + g.ref[1][1]) / 2];
    for (let e = 0; e < 2; e++) {
      const gap = Math.hypot(g.below[e][0] - g.above[e][0], g.below[e][1] - g.above[e][1]);
      const half = Math.hypot(g.ref[e][0] - mid[0], g.ref[e][1] - mid[1]);
      // The layers are pinned at the point of the interface nearest the centre, so the gap
      // grows linearly with the distance from it: |D t| = σ₂ per unit length.
      const pin = (() => {
        const t = [-f.n[1], f.n[0]];
        const s0 = g.ref[e][0] * f.n[0] + g.ref[e][1] * f.n[1];
        return Math.abs((g.ref[e][0] - s0 * f.n[0]) * t[0] + (g.ref[e][1] - s0 * f.n[1]) * t[1]);
      })();
      close(gap, s.s2 * pin, 1e-9, "the gap is σ₂ times the distance from the pinned point");
      assert.ok(half <= len);
    }
  }
}
// Any other interface direction is worse.
for (let i = 0; i < 100; i++) {
  const D = randM(1);
  const s = svd(D);
  for (let k = 0; k < 20; k++) {
    const th = 2 * Math.PI * rand();
    const t = [Math.cos(th), Math.sin(th)];
    assert.ok(Math.hypot(...apply(D, t)) >= s.s2 - 1e-12, "σ₂ is the least mismatch");
  }
}
ok("laminates: C − A = a ⊗ n exactly when the layers fit, with interfaces perpendicular to n");

// ------------------------------------------------------------- energies

const DM = (g) => dm(g);
for (let i = 0; i < 200; i++) {
  const X = randM();
  const g = 2 * rand() - 1;
  const Q = rot(2 * Math.PI * rand());
  const R = rot(2 * Math.PI * rand());
  const lam = 0.1 + 3 * rand();
  const QXR = mul(mul(Q, X), R);
  close(DM(g)(QXR), DM(g)(X), 1e-9 * (1 + Math.abs(DM(g)(X))), "f_γ is isotropic");
  close(DM(g)(scale(X, lam)), lam ** 4 * DM(g)(X), 1e-9 * (1 + lam ** 4 * Math.abs(DM(g)(X))), "f_γ is 4-homogeneous");
  // f_{−γ}(X) = f_γ(JX): only |γ| matters.
  close(DM(-g)(X), DM(g)(mul(J, X)), 1e-9 * (1 + Math.abs(DM(g)(X))), "f_{−γ} is the mirror image of f_γ");
  // f_γ(A) = |A|⁴ h(det A / |A|²) with the operator norm.
  const s1 = opNorm(X);
  close(DM(g)(X), s1 ** 4 * dmProfile(g, det(X) / (s1 * s1)), 1e-9 * (1 + Math.abs(DM(g)(X))), "f_γ from its profile");
  for (const p of [1.5, 3, 4]) {
    const Bp = burkholder(p);
    close(Bp(QXR), Bp(X), 1e-9 * (1 + Math.abs(Bp(X))), "B_p is isotropic");
    close(Bp(scale(X, lam)), lam ** p * Bp(X), 1e-9 * (1 + lam ** p * Math.abs(Bp(X))), "B_p is p-homogeneous");
  }
  close(stretch(QXR), stretch(X), 1e-9, "‖A‖² is isotropic");
  close(detSq(QXR), detSq(X), 1e-9, "(det A)² is isotropic");
}
ok("f_γ, B_p, ‖A‖² and (det A)² are isotropic and homogeneous; f_{−γ}(A) = f_γ(JA)");

// The Hessian formula against finite differences.
for (let i = 0; i < 100; i++) {
  const X = randM(1);
  const B = randM(1);
  const g = 2 * rand() - 1;
  const H = dmHessian(g, X);
  let q = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) q += B[r] * H[r][c] * B[c];
  close(q, bend(DM(g), X, B, 0, 1e-4), 1e-4 * (1 + Math.abs(q)), "D²f_γ[B, B]");
}
ok("the second derivative of f_γ along a line matches finite differences");

// Nonnegativity: ‖A‖² ≥ 2|det A|, so f_γ ≥ 0 exactly when |γ| ≤ 1.
for (let i = 0; i < 2000; i++) {
  const X = randM();
  assert.ok(frob2(X) >= 2 * Math.abs(det(X)) - 1e-12);
  assert.ok(DM(1)(X) >= -1e-12 && DM(-1)(X) >= -1e-12);
}
assert.ok(DM(1.001)(I) < 0 && DM(-1.001)(J) < 0, "f_γ(I) = 4(1 − γ) < 0 for γ > 1");
close(dmLeast(1), 0, 1e-12, "the least value of f_1 on |A| = 1 is 0");
assert.ok(dmLeast(0.999) > 0 && dmLeast(1.001) < 0);
ok("f_γ ≥ 0 exactly when |γ| ≤ 1");

// ------------------------------------------------------------- the thresholds of f_γ

const gc = threshold((g) => convexMargin(g).value, 0, 1.5);
const gr = threshold((g) => rankOneMargin(g, 360, 180).value, 0, 1.5);
close(gc, (2 * Math.sqrt(2)) / 3, 1e-6, "convex exactly when |γ| ≤ 2√2/3");
close(gr, 2 / Math.sqrt(3), 1e-6, "rank-one convex exactly when |γ| ≤ 2/√3");
// Finer, near the threshold: the least eigenvalue changes sign there.
assert.ok(rankOneMargin(2 / Math.sqrt(3) - 1e-3).value >= 0);
assert.ok(rankOneMargin(2 / Math.sqrt(3) + 1e-3).value < 0);
assert.ok(convexMargin((2 * Math.sqrt(2)) / 3 - 1e-6).value >= 0);
assert.ok(convexMargin((2 * Math.sqrt(2)) / 3 + 1e-6).value < 0);
ok(
  `thresholds by bisection: convex up to ${gc.toFixed(7)} (2√2/3 = ${((2 * Math.sqrt(2)) / 3).toFixed(7)}), rank-one convex up to ${gr.toFixed(7)} (2/√3 = ${(2 / Math.sqrt(3)).toFixed(7)})`
);

// The same thresholds by random lines, on both sides of each.
const lines = (g, rankOne) => testLines(DM(g), rand, { count: 4000, rankOne, r: 1.5 });
const below = (x) => x - 0.01;
const above = (x) => x + 0.01;
for (const g of [0, 0.5, below((2 * Math.sqrt(2)) / 3)]) assert.equal(lines(g, false).bad, 0, `f_${g} is convex along random lines`);
for (const g of [1, 1.05, above((2 * Math.sqrt(2)) / 3)]) assert.ok(lines(g, false).bad > 0, `f_${g} bends down along some line`);
for (const g of [0.9, 1, 1.1, below(2 / Math.sqrt(3))]) assert.equal(lines(g, true).bad, 0, `f_${g} is convex along random rank-one lines`);
// Above 2/√3 the bad rank-one lines are rare; the worst line found by the margin bends down.
{
  const g = above(2 / Math.sqrt(3));
  const m = rankOneMargin(g);
  assert.ok(m.value < 0);
  assert.ok(bend(DM(g), m.X, m.B) < 0, "f_γ bends down along the worst rank-one line");
  assert.ok(lines(g, true).bad + testLines(DM(g), rand, { count: 40000, rankOne: true, r: 1.5 }).bad > 0, "random rank-one lines find it too");
}
// Along rank-one lines, det is affine; so (det A)² is a convex parabola there.
for (let i = 0; i < 200; i++) {
  const X = randM();
  const B = outer([2 * rand() - 1, 2 * rand() - 1], [2 * rand() - 1, 2 * rand() - 1]);
  close(det(add(X, scale(B, 2))) - 2 * det(add(X, B)) + det(X), 0, 1e-12, "det is affine on rank-one lines");
}
assert.equal(testLines(detSq, rand, { count: 4000, rankOne: true }).bad, 0);
assert.ok(testLines(detSq, rand, { count: 4000 }).bad > 0, "(det A)² is not convex");
assert.equal(testLines(stretch, rand, { count: 4000 }).bad, 0, "‖A‖² is convex");
// The crystal with two wells bends down on the rank-one line between them.
assert.equal(rank(sub(U1, U2)), 1);
assert.ok(bend(twoWell, I, WELL) < 0, "the two-well energy is not rank-one convex");
ok("convexity along random lines and rank-one lines, on both sides of each threshold");

// ------------------------------------------------------------- the sheet

const sheet = makeSheet(24);
const shapes = Object.keys(WIGGLES);
const frames = [I, diag(1.3, 0.8), [1, 0.5, 0, 1], [0.9, -0.4, 0.3, 1.1], [1, 0, 0, -1]];
let worstNull = 0;
for (const A of frames) {
  for (const key of shapes) {
    for (const s of [0.25, 0.5, 1, 1.5]) {
      const disp = wiggleNodes(sheet, key, s);
      const { grads, pos } = deformSheet(sheet, A, disp);
      // The edge is held in the uniform deformation A.
      sheet.nodes.forEach((x, k) => {
        if (x[0] === 0 || x[1] === 0 || x[0] === 1 || x[1] === 1) {
          const y = apply(A, x);
          close(pos[k][0], y[0], 0, "the edge is fixed");
          close(pos[k][1], y[1], 0, "the edge is fixed");
        }
      });
      // The average gradient is A, and the average of det is det A: a null Lagrangian.
      for (let k = 0; k < 4; k++)
        close(
          average(grads, (G) => G[k]),
          A[k],
          1e-12,
          "∫∇u = A"
        );
      const avgDet = average(grads, det);
      worstNull = Math.max(worstNull, Math.abs(avgDet - det(A)));
      close(avgDet, det(A), 1e-12, `the average of det(A + ∇φ) is det A (${key}, s = ${s})`);
      // Quasiconvexity of the energies that are: no wiggle saves energy.
      for (const F of [stretch, detSq, DM(0.5), DM(1), DM(1.1), DM(2 / Math.sqrt(3) - 1e-9)]) {
        assert.ok(average(grads, F) >= F(A) - 1e-12 * (1 + Math.abs(F(A))), "the wiggle does not save energy");
      }
    }
  }
}
ok(`null Lagrangian: the average of det(A + ∇φ) equals det A to within ${worstNull.toExponential(1)} for every wiggle`);
ok("for the quasiconvex energies, no wiggle of the page saves energy");

// The layers wiggle at amplitude 1: inside, ∇u = U₁ or U₂ exactly, and the crystal saves energy.
{
  const disp = wiggleNodes(sheet, "layers", 1);
  const { grads } = deformSheet(sheet, I, disp);
  const inner = sheet.tris
    .map((t, k) => ({ t, k }))
    .filter(({ t }) => t.every((n) => Math.min(...sheet.nodes[n], 1 - sheet.nodes[n][0], 1 - sheet.nodes[n][1]) >= 2 / 24 - 1e-12));
  for (const { k } of inner) close(twoWell(grads[k]), 0, 1e-12, "inside, the layers are in the wells");
  const avg = average(grads, twoWell);
  assert.ok(avg < twoWell(I), "the layers save energy");
  ok(`two wells: the uniform sheet costs ${twoWell(I).toFixed(4)}, the layers ${avg.toFixed(4)} on average`);
}

// Homogeneity of ‖A‖^p, used for the slider.
for (const p of [0.5, 1, 2, 3.3]) {
  const X = randM();
  close(Math.pow(frob(scale(X, 2)), p), 2 ** p * Math.pow(frob(X), p), 1e-9, "‖λA‖^p = λ^p ‖A‖^p");
}
ok("all checks passed");
