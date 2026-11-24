// The mathematics of the Morrey page: 2 × 2 matrices, laminates, the energies,
// their second derivatives along lines, and sheets held at their edge.
// A matrix [[a, b], [c, d]] is the array [a, b, c, d]. Its first column (a, c) is
// the image of the bottom side of the unit square, its second (b, d) that of the
// left side.

export const I = [1, 0, 0, 1];

export const det = (M) => M[0] * M[3] - M[1] * M[2];
export const add = (M, N) => M.map((x, i) => x + N[i]);
export const sub = (M, N) => M.map((x, i) => x - N[i]);
export const scale = (M, s) => M.map((x) => x * s);
export const lerp = (M, N, t) => M.map((x, i) => x + (N[i] - x) * t);
export const frob2 = (M) => M[0] * M[0] + M[1] * M[1] + M[2] * M[2] + M[3] * M[3];
export const frob = (M) => Math.sqrt(frob2(M));
export const dot = (M, N) => M[0] * N[0] + M[1] * N[1] + M[2] * N[2] + M[3] * N[3];
export const mul = (M, N) => [M[0] * N[0] + M[1] * N[2], M[0] * N[1] + M[1] * N[3], M[2] * N[0] + M[3] * N[2], M[2] * N[1] + M[3] * N[3]];
export const apply = (M, [x, y]) => [M[0] * x + M[1] * y, M[2] * x + M[3] * y];
// det(X + B) = det X + ⟨cof X, B⟩ + det B.
export const cof = (M) => [M[3], -M[2], -M[1], M[0]];
// a ⊗ n, the matrix x ↦ a (n · x).
export const outer = (a, n) => [a[0] * n[0], a[0] * n[1], a[1] * n[0], a[1] * n[1]];
export const rot = (theta) => [Math.cos(theta), -Math.sin(theta), Math.sin(theta), Math.cos(theta)];
export const diag = (x, y) => [x, 0, 0, y];
export const J = [1, 0, 0, -1];

const hyp = Math.hypot;
const unit = (v) => {
  const r = hyp(v[0], v[1]);
  return r > 0 ? [v[0] / r, v[1] / r] : [1, 0];
};

// The singular value decomposition M = σ₁ u₁ v₁ᵀ + σ₂ u₂ v₂ᵀ, with σ₁ ≥ σ₂ ≥ 0.
// In conformal coordinates M acts as ζ ↦ zζ + w ζ̄, and σ₁ = |z| + |w|,
// σ₂ = ||z| − |w||.
export function conformal(M) {
  const [a, b, c, d] = M;
  return { z: [(a + d) / 2, (c - b) / 2], w: [(a - d) / 2, (b + c) / 2] };
}

export function svd(M) {
  const { z, w } = conformal(M);
  const rz = hyp(z[0], z[1]);
  const rw = hyp(w[0], w[1]);
  const s1 = rz + rw;
  const s2 = Math.abs(rz - rw);
  // MᵀM = [[p, q], [q, r]]; its eigenvectors are the right singular vectors.
  const p = M[0] * M[0] + M[2] * M[2];
  const q = M[0] * M[1] + M[2] * M[3];
  const r = M[1] * M[1] + M[3] * M[3];
  const ang = 0.5 * Math.atan2(2 * q, p - r);
  const v1 = [Math.cos(ang), Math.sin(ang)];
  const v2 = [-v1[1], v1[0]];
  const Mv1 = apply(M, v1);
  const Mv2 = apply(M, v2);
  const u1 = s1 > 1e-15 ? [Mv1[0] / s1, Mv1[1] / s1] : [1, 0];
  const u2 = s2 > 1e-15 ? [Mv2[0] / s2, Mv2[1] / s2] : [-u1[1], u1[0]];
  return { s1, s2, u1, u2, v1, v2 };
}

export const opNorm = (M) => svd(M).s1;

// 0, 1 or 2: the rank of M, with a tolerance relative to the size of M.
export function rank(M, tol = 1e-9) {
  const { s1, s2 } = svd(M);
  if (s1 <= tol) return 0;
  if (s2 <= tol * Math.max(1, s1)) return 1;
  return 2;
}

// The nearest matrix of rank at most one, in the Euclidean norm: σ₁ u₁ v₁ᵀ.
export function nearestRankOne(M) {
  const { s1, u1, v1 } = svd(M);
  return outer([s1 * u1[0], s1 * u1[1]], v1);
}

// ------------------------------------------------------------------ laminates

// The interfaces of a laminate of A and C are perpendicular to n. When C − A = a ⊗ n
// the layers fit; otherwise n is the direction for which the mismatch along an
// interface is least: the interface runs along the right singular vector v₂ of
// C − A, and the mismatch per unit of interface is σ₂. The sign of n follows prev.
export function interfaceOf(A, C, prev = [0, 1]) {
  const D = sub(C, A);
  const s = svd(D);
  let n = [-s.v2[1], s.v2[0]];
  if (s.s1 < 1e-9) n = unit(prev);
  if (n[0] * prev[0] + n[1] * prev[1] < 0) n = [-n[0], -n[1]];
  const a = apply(D, n); // C − A = a ⊗ n exactly when the mismatch is 0
  return { n, a, mismatch: s.s1 < 1e-9 ? 0 : s.s2, size: s.s1 };
}

// Clip a convex polygon by the half-plane {x : k · x ≥ c}.
function clip(poly, k, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i];
    const Q = poly[(i + 1) % poly.length];
    const fp = k[0] * P[0] + k[1] * P[1] - c;
    const fq = k[0] * Q[0] + k[1] * Q[1] - c;
    if (fp >= 0) out.push(P);
    if (fp * fq < 0) {
      const t = fp / (fp - fq);
      out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
    }
  }
  return out;
}

// The laminate of A and C in the square window [−1, 1]², with `count` layers of
// equal width across it, perpendicular to n. Each layer k is deformed by its matrix
// M_k (A or C) and moved by b_k so that neighbouring layers agree at the middle of
// their common interface; the middle layer keeps the centre of the window fixed.
// Returns the layers (their reference polygon, matrix and image) and, for each
// interface, its image from either side.
export function laminate(A, C, n, count, half = 1) {
  const win = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  // The extent of the window along n.
  const ext = half * (Math.abs(n[0]) + Math.abs(n[1]));
  const w = (2 * ext) / count;
  const t = [-n[1], n[0]];
  const layers = [];
  for (let k = 0; k < count; k++) {
    const lo = -ext + k * w;
    let poly = clip(win, n, lo);
    poly = clip(poly, [-n[0], -n[1]], -(lo + w));
    layers.push({ k, lo, hi: lo + w, M: k % 2 === 0 ? A : C, poly, b: [0, 0] });
  }
  const mid = Math.floor(count / 2);
  for (let k = mid + 1; k < count; k++) {
    const p = [layers[k].lo * n[0], layers[k].lo * n[1]];
    const d = apply(sub(layers[k - 1].M, layers[k].M), p);
    layers[k].b = [layers[k - 1].b[0] + d[0], layers[k - 1].b[1] + d[1]];
  }
  for (let k = mid - 1; k >= 0; k--) {
    const p = [layers[k].hi * n[0], layers[k].hi * n[1]];
    const d = apply(sub(layers[k + 1].M, layers[k].M), p);
    layers[k].b = [layers[k + 1].b[0] + d[0], layers[k + 1].b[1] + d[1]];
  }
  const map = (L, x) => {
    const y = apply(L.M, x);
    return [y[0] + L.b[0], y[1] + L.b[1]];
  };
  for (const L of layers) L.image = L.poly.map((x) => map(L, x));
  // The interfaces, clipped to the window: the segment {x · n = s} ∩ window.
  const interfaces = [];
  for (let k = 1; k < count; k++) {
    const s = layers[k].lo;
    // Endpoints: intersect the line s n + τ t with the window.
    let tmin = -Infinity;
    let tmax = Infinity;
    for (let i = 0; i < 2; i++) {
      const p0 = s * n[i];
      if (Math.abs(t[i]) < 1e-12) continue;
      const a1 = (-half - p0) / t[i];
      const a2 = (half - p0) / t[i];
      tmin = Math.max(tmin, Math.min(a1, a2));
      tmax = Math.min(tmax, Math.max(a1, a2));
    }
    if (!(tmax > tmin)) continue;
    const e1 = [s * n[0] + tmin * t[0], s * n[1] + tmin * t[1]];
    const e2 = [s * n[0] + tmax * t[0], s * n[1] + tmax * t[1]];
    interfaces.push({
      k,
      ref: [e1, e2],
      below: [map(layers[k - 1], e1), map(layers[k - 1], e2)],
      above: [map(layers[k], e1), map(layers[k], e2)],
    });
  }
  return { layers, interfaces, width: w };
}

// The largest gap between the two images of an interface point, over all interfaces.
export function laminateGap(lam) {
  let g = 0;
  for (const f of lam.interfaces) {
    for (let i = 0; i < 2; i++) g = Math.max(g, hyp(f.below[i][0] - f.above[i][0], f.below[i][1] - f.above[i][1]));
  }
  return g;
}

// ------------------------------------------------------------------ energies

// The Dacorogna–Marcellini energy f_γ(A) = ‖A‖²(‖A‖² − 2γ det A), ‖·‖ Euclidean.
export const dm = (gamma) => (M) => {
  const N = frob2(M);
  return N * (N - 2 * gamma * det(M));
};

// The Burkholder function B_p(A) = (|1 − 2/p| |A|² + det A) |A|^{p−2}, operator norm.
export const burkholder = (p) => (M) => {
  const s = opNorm(M);
  if (s === 0) return 0;
  return (Math.abs(1 - 2 / p) * s * s + det(M)) * Math.pow(s, p - 2);
};

export const stretch = (M) => frob2(M);
export const detSq = (M) => det(M) ** 2;
export const powNorm = (p) => (M) => Math.pow(frob(M), p);
// An energy that is not isotropic: the squared length of the image of the bottom side.
export const bottomStretch = (M) => M[0] * M[0] + M[2] * M[2];

// A crystal with two preferred shapes U₁ = I + d and U₂ = I − d, d = a ⊗ n of rank one.
export const WELL = outer([0.3, 0], [0, 1]);
export const U1 = add(I, WELL);
export const U2 = sub(I, WELL);
export const twoWell = (M) => Math.min(frob2(sub(M, U1)), frob2(sub(M, U2)));

// The profile of f_γ on the matrices diag(1, s), |s| ≤ 1, whose operator norm is 1:
// h(s) = f_γ(diag(1, s)); and f_γ(A) = |A|⁴ h(det A / |A|²).
export const dmProfile = (gamma, s) => (1 + s * s) * (1 + s * s - 2 * gamma * s);

// ------------------------------------------------------------------ lines

// The second derivative of t ↦ F(A + tB), by central differences.
export function bend(F, A, B, t = 0, h = 1e-3) {
  const at = (s) => F(add(A, scale(B, s)));
  return (at(t + h) - 2 * at(t) + at(t - h)) / (h * h);
}

// Random matrices and directions from a generator rand() in [0, 1).
export const randomMatrix = (rand, r = 1.5) => [0, 0, 0, 0].map(() => (2 * rand() - 1) * r);
export function randomDirection(rand) {
  const B = [0, 0, 0, 0].map(() => gauss(rand));
  return scale(B, 1 / frob(B));
}
export function randomRankOne(rand) {
  const a = rand() * 2 * Math.PI;
  const b = rand() * 2 * Math.PI;
  return outer([Math.cos(a), Math.sin(a)], [Math.cos(b), Math.sin(b)]);
}
function gauss(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Test F along `count` random lines t ↦ F(A + tB), |t| ≤ 1: the number of lines along
// which it bends down, and the line where it bends down most. A negative second
// difference F(t − h) − 2F(t) + F(t + h) < 0 proves that F is not convex on the line,
// and catches kinks as well as smooth bends.
export function testLines(F, rand, { count = 2000, rankOne = false, r = 1.5, steps = 40 } = {}) {
  let bad = 0;
  let worst = null;
  const h = 2 / steps;
  const f = new Float64Array(steps + 1);
  for (let i = 0; i < count; i++) {
    const A = randomMatrix(rand, r);
    const B = rankOne ? randomRankOne(rand) : randomDirection(rand);
    let big = 0;
    for (let k = 0; k <= steps; k++) {
      f[k] = F(add(A, scale(B, -1 + k * h)));
      big = Math.max(big, Math.abs(f[k]));
    }
    // A relative tolerance, so that rounding along a flat line is not a failure.
    const tol = 1e-9 * (1 + big);
    let least = Infinity;
    let at = 0;
    for (let k = 1; k < steps; k++) {
      const d = (f[k - 1] - 2 * f[k] + f[k + 1]) / (h * h);
      if (d < least) {
        least = d;
        at = -1 + k * h;
      }
    }
    if (least * h * h < -tol) {
      bad++;
      if (!worst || least < worst.least) worst = { A: add(A, scale(B, at)), B, least };
    }
  }
  return { count, bad, worst };
}

// --------------------------------------------- the thresholds of f_γ, from second derivatives

// The quadratic form B ↦ D²f_γ(X)[B, B], as a symmetric 4 × 4 matrix on the entries
// of B. With N = ‖X‖², D = det X, c = cof X, and det B = bᵀKb/2:
// D²f[B, B] = 8⟨X, B⟩² + 4N‖B‖² − 2γ(2D‖B‖² + 4⟨X, B⟩⟨c, B⟩ + 2N det B).
export function dmHessian(gamma, X) {
  const N = frob2(X);
  const D = det(X);
  const c = cof(X);
  const K = [
    [0, 0, 0, 1],
    [0, 0, -1, 0],
    [0, -1, 0, 0],
    [1, 0, 0, 0],
  ];
  const H = [];
  for (let i = 0; i < 4; i++) {
    H.push([]);
    for (let j = 0; j < 4; j++) {
      H[i][j] = 8 * X[i] * X[j] + (i === j ? 4 * N - 4 * gamma * D : 0) - 2 * gamma * (2 * (X[i] * c[j] + c[i] * X[j]) + N * K[i][j]);
    }
  }
  return H;
}

// The eigenvalues and eigenvectors of a symmetric matrix, by Jacobi rotations.
export function eigSym(S) {
  const n = S.length;
  const a = S.map((r) => r.slice());
  const v = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = cs * akp - sn * akq;
          a[k][q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = cs * apk - sn * aqk;
          a[q][k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = cs * vkp - sn * vkq;
          v[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  const values = a.map((r, i) => r[i]);
  const vectors = values.map((_, j) => v.map((r) => r[j]));
  return { values, vectors };
}

// By isotropy, the matrices X = diag(cos θ, sin θ) are enough: every matrix is
// Q diag(σ₁, ±σ₂) R with rotations Q, R, and f_γ and its second derivatives are
// unchanged by them and scale with |X|.
const diagAt = (theta) => diag(Math.cos(theta), Math.sin(theta));

// The least of D²f_γ(X)[B, B] over |X| = |B| = 1: negative exactly when f_γ is not convex.
export function convexMargin(gamma, steps = 720) {
  let best = { value: Infinity };
  for (let i = 0; i < steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const X = diagAt(theta);
    const { values, vectors } = eigSym(dmHessian(gamma, X));
    let j = 0;
    for (let k = 1; k < 4; k++) if (values[k] < values[j]) j = k;
    if (values[j] < best.value) best = { value: values[j], X, B: vectors[j] };
  }
  return best;
}

// The least of D²f_γ(X)[a ⊗ n, a ⊗ n] over |X| = |a| = |n| = 1. For fixed X and n
// it is aᵀMa with M = 8ppᵀ + (4N − 4γD)I − 4γ(pqᵀ + qpᵀ), p = Xn, q = (cof X)n.
export function rankOneMargin(gamma, steps = 360, nsteps = 360) {
  let best = { value: Infinity };
  for (let i = 0; i < steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const X = diagAt(theta);
    const N = frob2(X);
    const D = det(X);
    const c = cof(X);
    for (let j = 0; j < nsteps; j++) {
      const beta = (Math.PI * j) / nsteps;
      const n = [Math.cos(beta), Math.sin(beta)];
      const p = apply(X, n);
      const q = apply(c, n);
      const m00 = 8 * p[0] * p[0] + 4 * N - 4 * gamma * D - 8 * gamma * p[0] * q[0];
      const m11 = 8 * p[1] * p[1] + 4 * N - 4 * gamma * D - 8 * gamma * p[1] * q[1];
      const m01 = 8 * p[0] * p[1] - 4 * gamma * (p[0] * q[1] + q[0] * p[1]);
      const tr = (m00 + m11) / 2;
      const dd = Math.sqrt(((m00 - m11) / 2) ** 2 + m01 * m01);
      const lmin = tr - dd;
      if (lmin < best.value) {
        // The eigenvector of the least eigenvalue.
        const a = Math.abs(m01) > 1e-14 ? unit([m01, lmin - m00]) : m00 <= m11 ? [1, 0] : [0, 1];
        best = { value: lmin, X, n, a, B: outer(a, n) };
      }
    }
  }
  return best;
}

// The least value of f_γ on |A| = 1 (operator norm): the least of the profile.
export function dmLeast(gamma, steps = 2000) {
  let least = Infinity;
  for (let i = 0; i <= steps; i++) least = Math.min(least, dmProfile(gamma, -1 + (2 * i) / steps));
  return least;
}

// The γ ≥ 0 at which a margin changes sign, by bisection on [lo, hi].
export function threshold(margin, lo, hi, iters = 40) {
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (margin(mid) >= 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ the sheet

// The unit square, cut into N × N cells, each cell into two triangles. A wiggle φ is
// given by its values at the nodes and is affine on each triangle, so the integrals
// below are exact for the piecewise affine map u(x) = A x + φ(x). φ is zero at the
// nodes of the edge, so u = A x on the edge.
export function makeSheet(N) {
  const nodes = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) nodes.push([i / N, j / N]);
  const id = (i, j) => j * (N + 1) + i;
  const tris = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // Alternate the diagonals, so that the triangulation has no preferred direction.
      if ((i + j) % 2 === 0) {
        tris.push([id(i, j), id(i + 1, j), id(i + 1, j + 1)]);
        tris.push([id(i, j), id(i + 1, j + 1), id(i, j + 1)]);
      } else {
        tris.push([id(i, j), id(i + 1, j), id(i, j + 1)]);
        tris.push([id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
      }
    }
  }
  return { N, nodes, tris, id };
}

const SMOOTH = (x, y) => (Math.sin(Math.PI * x) * Math.sin(Math.PI * y)) ** 2;

// The wiggles, as functions of the node (x, y) and its indices, vanishing on the edge.
export const WIGGLES = {
  bulge: {
    name: "Bulge",
    at: ([x, y]) => {
      const b = 1.6 * SMOOTH(x, y);
      return [(x - 0.5) * b, (y - 0.5) * b];
    },
  },
  swirl: {
    name: "Swirl",
    at: ([x, y]) => {
      const b = 1.1 * SMOOTH(x, y);
      return [-(y - 0.5) * b, (x - 0.5) * b];
    },
  },
  ripples: {
    name: "Ripples",
    at: ([x, y]) => {
      const b = Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
      return [0.035 * Math.sin(6 * Math.PI * y) * b, 0.035 * Math.sin(6 * Math.PI * x) * b];
    },
  },
  layers: {
    name: "Layers",
    // A zigzag in y with slopes ±1 and corners on the grid lines, so that inside the
    // sheet ∇φ = ±WELL exactly, cut off linearly over two cells at the edge.
    at: ([x, y], N) => {
      const h = 1 / N;
      const period = 4 * h;
      const s = ((y % period) + period) % period;
      const zig = s <= 2 * h ? s : period - s;
      const edge = Math.min(x, 1 - x, y, 1 - y);
      const cut = Math.min(1, edge / (2 * h));
      return [WELL[1] * zig * cut, 0];
    },
  },
};

// The node displacements of a wiggle at amplitude s.
export function wiggleNodes(sheet, key, s) {
  const f = WIGGLES[key].at;
  return sheet.nodes.map(([x, y]) => {
    const edge = x === 0 || y === 0 || x === 1 || y === 1;
    if (edge) return [0, 0];
    const v = f([x, y], sheet.N);
    return [s * v[0], s * v[1]];
  });
}

// The gradient of the affine map on a triangle with reference corners P and images Q.
export function triGradient(P, Q) {
  const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
  const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1]];
  const f1 = [Q[1][0] - Q[0][0], Q[1][1] - Q[0][1]];
  const f2 = [Q[2][0] - Q[0][0], Q[2][1] - Q[0][1]];
  const dt = e1[0] * e2[1] - e1[1] * e2[0];
  // G [e1 e2] = [f1 f2], so G = [f1 f2] [e1 e2]⁻¹.
  const inv = [e2[1] / dt, -e2[0] / dt, -e1[1] / dt, e1[0] / dt];
  return mul([f1[0], f2[0], f1[1], f2[1]], inv);
}

// The deformed sheet: node images, the gradient on each triangle, and the averages
// over the sheet of each energy (all triangles have the same area).
export function deformSheet(sheet, A, disp) {
  const pos = sheet.nodes.map((x, k) => {
    const y = apply(A, x);
    return [y[0] + disp[k][0], y[1] + disp[k][1]];
  });
  const grads = sheet.tris.map((t) =>
    triGradient(
      t.map((k) => sheet.nodes[k]),
      t.map((k) => pos[k])
    )
  );
  return { pos, grads };
}

export const average = (grads, F) => grads.reduce((s, G) => s + F(G), 0) / grads.length;
