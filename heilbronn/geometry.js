// The geometry of the playground: triangle areas, the least area and the
// triangles that attain it, the symmetries of the square, and the local search
// of Improve. Points are pairs [x, y] in the unit square; nothing here touches
// the page, so test.mjs runs the same code in Node.

// Areas below ZERO count as 0: the three points are on a line. Areas within
// TIE of the least count as attaining it.
export const ZERO = 1e-12;
export const TIE = 1e-10;

// The triples i < j < k of n points, in lexicographic order.
const tripleCache = new Map();
export function triples(n) {
  if (!tripleCache.has(n)) {
    const list = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) list.push([i, j, k]);
    tripleCache.set(n, list);
  }
  return tripleCache.get(n);
}

// Twice the signed area of the triangle pqr, as in triangleArea of
// Heilbronn/Geometry.lean before the absolute value.
export const det = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
export const area = (p, q, r) => Math.abs(det(p, q, r)) / 2;

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Every triangle of the configuration, smallest first, with the least area,
// the triangles that attain it (`ties`) and those within the fraction
// `margin` above it (`near`). When three points are on a line the least area
// is 0, and the triangles of area 0 are the collinear triples.
export function analyse(P, margin = 0) {
  const tris = triples(P.length).map((t) => ({ t, a: area(P[t[0]], P[t[1]], P[t[2]]) }));
  tris.sort((u, v) => u.a - v.a || u.t[0] - v.t[0] || u.t[1] - v.t[1] || u.t[2] - v.t[2]);
  const least = tris[0].a < ZERO ? 0 : tris[0].a;
  const ties = [];
  const near = [];
  for (const tri of tris) {
    if (least === 0 ? tri.a < ZERO : tri.a <= least + TIE) ties.push(tri);
    else if (least > 0 && tri.a <= least * (1 + margin) + TIE) near.push(tri);
    else break;
  }
  return { tris, least, ties, near, collinear: least === 0 };
}

export const leastArea = (P) => analyse(P).least;

// The name of a triangle from the names of its points, in the order of the
// points: ABC, CGO.
export const triangleName = (t, names) => t.map((i) => names[i]).join("");

// ------------------------------------------------------- the square's symmetries
//
// The eight symmetries of the square [0, 1]², the quarter turns first (turning
// counterclockwise about the centre), then the four reflections.
export const SYMMETRIES = [
  { key: "id", name: "as in the proof", short: "as proved", map: ([x, y]) => [x, y] },
  { key: "r90", name: "turned a quarter", short: "¼ turn", map: ([x, y]) => [1 - y, x] },
  { key: "r180", name: "turned a half", short: "½ turn", map: ([x, y]) => [1 - x, 1 - y] },
  { key: "r270", name: "turned three quarters", short: "¾ turn", map: ([x, y]) => [y, 1 - x] },
  { key: "v", name: "reflected left to right", short: "mirrored", map: ([x, y]) => [1 - x, y] },
  { key: "h", name: "reflected top to bottom", short: "flipped", map: ([x, y]) => [x, 1 - y] },
  { key: "d", name: "reflected in the diagonal", short: "diagonal", map: ([x, y]) => [y, x] },
  { key: "a", name: "reflected in the anti-diagonal", short: "anti-diagonal", map: ([x, y]) => [1 - y, 1 - x] },
];

// Whether P and Q are the same set of points, up to eps, in any order.
export function sameSet(P, Q, eps = 1e-9) {
  if (P.length !== Q.length) return false;
  const used = new Array(Q.length).fill(false);
  for (const p of P) {
    const j = Q.findIndex((q, k) => !used[k] && Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps);
    if (j < 0) return false;
    used[j] = true;
  }
  return true;
}

// The distinct point sets among the eight images of P, each with the first
// symmetry that gives it; a point keeps its index, so its name, in each image.
export function images(P) {
  const out = [];
  for (const s of SYMMETRIES) {
    const Q = P.map(s.map);
    if (!out.some((o) => sameSet(o.points, Q))) out.push({ symmetry: s, points: Q });
  }
  return out;
}

// The symmetries that map P to itself as a set, with the permutation of the
// points each one induces: perm[i] is the index of the image of point i.
export function stabilizer(P, eps = 1e-9) {
  const out = [];
  for (const s of SYMMETRIES) {
    const Q = P.map(s.map);
    if (!sameSet(P, Q, eps)) continue;
    const perm = Q.map((q) => P.findIndex((p) => Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps));
    out.push({ symmetry: s, perm });
  }
  return out;
}

// Where a point is: on which sides of the square (two at a corner), or inside.
export function sides([x, y], eps = 1e-9) {
  const out = [];
  if (x <= eps) out.push("left");
  if (x >= 1 - eps) out.push("right");
  if (y <= eps) out.push("bottom");
  if (y >= 1 - eps) out.push("top");
  return out;
}

// ---------------------------------------------------------------- assignment
//
// The order that sends the point from[order[k]] to the place to[k] with the
// least sum of squared distances, by dynamic programming over the subsets of
// the points (n ≤ 16 or so).
export function assignment(from, to) {
  const n = from.length;
  const N = 1 << n;
  const cost = new Float64Array(N).fill(Infinity);
  const prev = new Int16Array(N).fill(-1);
  cost[0] = 0;
  for (let mask = 0; mask < N; mask++) {
    if (cost[mask] === Infinity) continue;
    let k = 0;
    for (let m = mask; m; m &= m - 1) k++;
    if (k === n) continue;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const c = cost[mask] + (from[i][0] - to[k][0]) ** 2 + (from[i][1] - to[k][1]) ** 2;
      if (c < cost[mask | (1 << i)]) {
        cost[mask | (1 << i)] = c;
        prev[mask | (1 << i)] = i;
      }
    }
  }
  const order = new Array(n);
  let mask = N - 1;
  for (let k = n - 1; k >= 0; k--) {
    const i = prev[mask];
    order[k] = i;
    mask &= ~(1 << i);
  }
  return order;
}

// n random points in the square, no two closer than `gap` when that can be
// had in a few hundred tries.
export function scatter(n, rand = Math.random, gap = 0.12) {
  const P = [];
  for (let tries = 0; P.length < n; tries++) {
    const p = [0.02 + 0.96 * rand(), 0.02 + 0.96 * rand()];
    const g = tries < 400 ? gap : 0;
    if (P.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= g)) P.push(p);
  }
  return P;
}

// ------------------------------------------------------------------- Improve
//
// Sequential linear programming with a trust region. At each step every
// triangle's area is replaced by its linearization in the moves of the points
// (the area is half the absolute value of a quadratic, and the linear part of
// the signed area, with the present sign, never exceeds the area), and a
// linear program finds the moves, each coordinate by at most r and keeping
// the points in the square, that raise the least of these linear areas the
// most. A step that raises the true least area by a fair part of the gain
// promised is kept, and r grows; otherwise r shrinks. The climb ends where no
// move raises the least area: at a local maximum, which need not be the
// largest.

// Maximizes c·x subject to Ax ≤ b and x ≥ 0, with b ≥ 0 so that x = 0 is
// feasible, by the simplex method on a dense tableau with Bland's rule.
export function simplex(A, b, c, maxIter = 5000) {
  const m = A.length;
  const n = c.length;
  const W = n + m + 1;
  const T = new Float64Array((m + 1) * W);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) T[i * W + j] = A[i][j];
    T[i * W + n + i] = 1;
    T[i * W + W - 1] = b[i];
  }
  for (let j = 0; j < n; j++) T[m * W + j] = -c[j];
  const basis = Array.from({ length: m }, (_, i) => n + i);
  const EPS = 1e-12;
  for (let it = 0; it < maxIter; it++) {
    let e = -1;
    for (let j = 0; j < n + m; j++)
      if (T[m * W + j] < -EPS) {
        e = j;
        break;
      }
    if (e < 0) break;
    let l = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      const v = T[i * W + e];
      if (v > EPS) {
        const ratio = T[i * W + W - 1] / v;
        if (ratio < best - 1e-15 || (Math.abs(ratio - best) <= 1e-15 && basis[i] < basis[l])) {
          best = ratio;
          l = i;
        }
      }
    }
    if (l < 0) return null; // unbounded
    const pv = T[l * W + e];
    for (let j = 0; j < W; j++) T[l * W + j] /= pv;
    for (let i = 0; i <= m; i++) {
      if (i === l) continue;
      const f = T[i * W + e];
      if (f === 0) continue;
      for (let j = 0; j < W; j++) T[i * W + j] -= f * T[l * W + j];
    }
    basis[l] = e;
  }
  const x = new Array(n).fill(0);
  basis.forEach((v, i) => {
    if (v < n) x[v] = T[i * W + W - 1];
  });
  return { x, value: T[m * W + W - 1] };
}

// The gradient of the area of triangle (i, j, k), in the 2n coordinates, for
// the sign s of its signed area.
function areaGradient(P, [i, j, k], s, g) {
  const [p, q, r] = [P[i], P[j], P[k]];
  const h = s / 2;
  g[2 * i] = h * (q[1] - r[1]);
  g[2 * i + 1] = h * (r[0] - q[0]);
  g[2 * j] = h * (r[1] - p[1]);
  g[2 * j + 1] = h * (p[0] - r[0]);
  g[2 * k] = h * (p[1] - q[1]);
  g[2 * k + 1] = h * (q[0] - p[0]);
}

// The moves d (2n coordinates, each within r and keeping the points in the
// square) that maximize the least linearized area, and the gain promised.
function linearStep(P, r) {
  const n = P.length;
  const T = triples(n);
  const a = T.map((t) => area(P[t[0]], P[t[1]], P[t[2]]));
  const least = Math.min(...a);
  // Variables: d⁺ (2n), d⁻ (2n) and the gain t; d = d⁺ − d⁻.
  const N = 4 * n + 1;
  const A = [];
  const b = [];
  const g = new Array(2 * n);
  T.forEach((t, idx) => {
    // Triangles far above the least cannot become the least within r.
    if (a[idx] - least > 6 * r) return;
    g.fill(0);
    areaGradient(P, t, det(P[t[0]], P[t[1]], P[t[2]]) < 0 ? -1 : 1, g);
    const row = new Array(N).fill(0);
    for (let j = 0; j < 2 * n; j++) {
      row[j] = -g[j];
      row[2 * n + j] = g[j];
    }
    row[N - 1] = 1;
    A.push(row);
    b.push(a[idx] - least);
  });
  for (let j = 0; j < 2 * n; j++) {
    const x = P[j >> 1][j & 1];
    const up = new Array(N).fill(0);
    up[j] = 1;
    A.push(up);
    b.push(Math.max(0, Math.min(r, 1 - x)));
    const down = new Array(N).fill(0);
    down[2 * n + j] = 1;
    A.push(down);
    b.push(Math.max(0, Math.min(r, x)));
  }
  // A small cost on the moves keeps them no longer than they need to be.
  const c = new Array(N).fill(-1e-7);
  c[N - 1] = 1;
  const sol = simplex(A, b, c);
  if (!sol) return null;
  const d = [];
  for (let j = 0; j < 2 * n; j++) d.push(sol.x[j] - sol.x[2 * n + j]);
  return { d, gain: sol.x[N - 1], least };
}

export const R_MAX = 0.04;

export function climber(P) {
  return { P: P.map((p) => [...p]), r: 0.02, least: leastArea(P), steps: 0, done: false };
}

// One step of the climb; returns the climber, with done set at a local
// maximum.
export function climb(c) {
  if (c.done) return c;
  c.steps++;
  const s = linearStep(c.P, c.r);
  if (!s || s.gain < 1e-14) {
    c.done = true;
    return c;
  }
  const next = c.P.map(([x, y], i) => [clamp01(x + s.d[2 * i]), clamp01(y + s.d[2 * i + 1])]);
  const least = leastArea(next);
  const rho = (least - s.least) / s.gain;
  if (rho > 0.1) {
    c.P = next;
    c.least = least;
    if (rho > 0.75) c.r = Math.min(R_MAX, 2 * c.r);
  } else c.r /= 4;
  if (rho < 0.25 && rho > 0.1) c.r /= 2;
  if (c.r < 1e-11) c.done = true;
  return c;
}
