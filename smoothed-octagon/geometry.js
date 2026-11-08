// The geometry of the playground.
//
// A shape is a centrally symmetric convex region about the origin, given by
// its gauge ‖w‖ = min{s > 0 : w ∈ sK}: a point w is inside K when ‖w‖ < 1.
// Two translates K + a and K + b overlap exactly when ‖a − b‖ < 2.
//
// The densest lattice packing of such a shape (Minkowski, Reinhardt, Mahler):
// among the affinely regular hexagons p, q, q − p, −p, −q, p − q inscribed in
// K, take one of least area 3 det(p, q). The copies K + 2(i p + j q) then form
// a densest lattice packing, of density area(K) / (4 det(p, q)), and each copy
// touches its six neighbours at the vertices of the hexagon. By Fejes Tóth's
// theorem no packing of the plane by copies of K does better.

export const SQRT2 = Math.SQRT2;
export const TAU = 2 * Math.PI;

// The four densities of the figure packing-densities.svg of the Lean project.
export const DELTA_DISK = Math.PI / Math.sqrt(12);
export const DELTA_REGULAR_OCTAGON = (4 + 4 * SQRT2) / (5 + 4 * SQRT2);
export const DELTA_SMOOTHED_14 = 0.906052;
export const DELTA_OCT = (8 - 4 * SQRT2 - Math.log(2)) / (2 * SQRT2 - 1);

export const det = (a, b) => a[0] * b[1] - a[1] * b[0];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const norm = (a) => Math.hypot(a[0], a[1]);

export function shoelace(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += det(pts[i], pts[(i + 1) % pts.length]);
  return s / 2;
}

// ------------------------------------------------------------------ shapes

// A convex polygon with its vertices counterclockwise and the origin inside.
// `sym` is the order of its rotational symmetry (2 for central symmetry).
export function polygonShape(verts, sym = 2, name = "polygon") {
  const n = verts.length;
  const A = new Float64Array(n);
  const B = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = verts[i];
    const [x1, y1] = verts[(i + 1) % n];
    const nx = y1 - y0;
    const ny = x0 - x1;
    const c = nx * x0 + ny * y0;
    A[i] = nx / c;
    B[i] = ny / c;
  }
  const gauge = (x, y) => {
    let m = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = A[i] * x + B[i] * y;
      if (v > m) m = v;
    }
    return m;
  };
  return {
    name,
    gauge,
    radialAt(th) {
      const c = Math.cos(th);
      const s = Math.sin(th);
      const g = gauge(c, s);
      return [c / g, s / g];
    },
    area: shoelace(verts),
    outline: verts,
    sym,
    breaks: verts.map(([x, y]) => Math.atan2(y, x)),
  };
}

// The regular polygon of inradius 1 with N sides, the first side's outer
// normal at the angle a0.
export function regularPolygon(N, a0 = 0, name) {
  const R = 1 / Math.cos(Math.PI / N);
  const verts = [];
  for (let k = 0; k < N; k++) {
    const a = a0 + ((k + 0.5) * TAU) / N;
    verts.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return polygonShape(verts, N, name || `regular ${N}-gon`);
}

export function diskShape(samples = 180) {
  const outline = [];
  for (let k = 0; k < samples; k++) outline.push([Math.cos((k * TAU) / samples), Math.sin((k * TAU) / samples)]);
  return {
    name: "disk",
    gauge: (x, y) => Math.hypot(x, y),
    radialAt: (th) => [Math.cos(th), Math.sin(th)],
    area: Math.PI,
    outline,
    sym: 12, // any order will do; the search then covers a twelfth of a turn
    breaks: [],
  };
}

// The regular N-gon of inradius 1, side k on the line x cos(kβ) + y sin(kβ) = 1
// (β = 2π/N), with its corners cut by hyperbolas. With d_k the distance to the
// line of side k, the corner of sides j and j + 1 is cut along the curve
//
//     d_{j−m} · d_{j+1+m} = c,
//
// a hyperbola whose asymptotes are the lines of the sides m steps beyond the
// corner: the next two sides for the octagon (m = 1), and m = k for the
// smoothed (6k + 2)-gon. Along a side at the corner the product is a quadratic
// that opens downward. At the corner itself it is c₀; its top value c_max is
// reached inside the side. So c = c₀ cuts nothing, c between c₀ and c_max cuts
// each corner along an arc that crosses the two sides, and c = c_max cuts
// along an arc that touches them: Reinhardt's smoothed polygon. The rounding
// t ∈ [0, 1] moves c from c₀ to c_max. For N = 8 and t = 1 this is the
// smoothed octagon, with c = √2/4: (1 − y)(√2 − x + y) = 1/2 at the corner of
// the sides x = 1 and x + y = √2.
export function roundedPolygon(N, t = 1, opts = {}) {
  const beta = TAU / N;
  const reach = opts.reach || (N % 6 === 2 ? (N - 2) / 6 : 1);
  const A = 1 - Math.cos(reach * beta);
  const s1 = Math.sin(reach * beta);
  const B = 1 - Math.cos((reach + 1) * beta);
  const s2 = Math.sin((reach + 1) * beta);
  // the product d_{j−m} d_{j+1+m} at the point of side j at the signed
  // distance u from the foot of its normal, towards the corner j
  const along = (u) => (A + u * s1) * (B - u * s2);
  const uCorner = Math.tan(beta / 2);
  const c0 = along(uCorner);
  const cMax = (A * s2 + B * s1) ** 2 / (4 * s1 * s2);
  const c = c0 + t * (cMax - c0);
  const lin = s1 * B - s2 * A;
  // where the arc meets side j: the root nearer the corner, a double root
  // (the tangency point) when c = c_max
  const uCut =
    t <= 0 ? uCorner : t >= 1 ? lin / (2 * s1 * s2) : (lin + Math.sqrt(Math.max(0, lin * lin + 4 * s1 * s2 * (A * B - c)))) / (2 * s1 * s2);
  const alpha = Math.max(0, beta / 2 - Math.atan(uCut)); // half the angle of an arc, seen from the centre
  const cs = [];
  const sn = [];
  for (let k = 0; k < N; k++) {
    cs.push(Math.cos(k * beta));
    sn.push(Math.sin(k * beta));
  }
  const at = (k) => ((k % N) + N) % N;
  const onArc = (x, y, j) => {
    const a = x * cs[at(j - reach)] + y * sn[at(j - reach)];
    const b = x * cs[at(j + 1 + reach)] + y * sn[at(j + 1 + reach)];
    const sum = a + b;
    // the first s > 0 with (1 − s a)(1 − s b) = c
    const s = (2 * (1 - c)) / (sum + Math.sqrt(Math.max(0, sum * sum - 4 * a * b * (1 - c))));
    return 1 / s;
  };
  const gauge = (x, y) => {
    if (x === 0 && y === 0) return 0;
    let th = Math.atan2(y, x);
    if (th < 0) th += TAU;
    let j = Math.floor(th / beta);
    if (j >= N) j = N - 1;
    const m = th - j * beta;
    if (alpha > 0 && Math.abs(m - beta / 2) < alpha) return onArc(x, y, j);
    return Math.max(x * cs[j] + y * sn[j], x * cs[at(j + 1)] + y * sn[at(j + 1)]);
  };
  const radialAt = (th) => {
    const u = [Math.cos(th), Math.sin(th)];
    const g = gauge(u[0], u[1]);
    return [u[0] / g, u[1] / g];
  };

  // The area, ½∮ r² dθ: the straight parts exactly, the arcs by Simpson's rule.
  let area = N * uCut;
  if (alpha > 0) {
    const M = opts.simpson || 400;
    const h = (2 * alpha) / M;
    let s = 0;
    for (let i = 0; i <= M; i++) {
      const th = beta / 2 - alpha + i * h;
      const r = 1 / gauge(Math.cos(th), Math.sin(th));
      s += (i === 0 || i === M ? 1 : i % 2 ? 4 : 2) * r * r;
    }
    area += (N * 0.5 * (s * h)) / 3;
  }

  // The outline for drawing: each arc sampled, the straight parts implicit.
  const arcSamples = opts.arcSamples || 24;
  const outline = [];
  for (let j = 0; j < N; j++) {
    const mid = j * beta + beta / 2;
    if (alpha === 0) outline.push(radialAt(mid));
    else for (let i = 0; i <= arcSamples; i++) outline.push(radialAt(mid - alpha + (2 * alpha * i) / arcSamples));
  }
  return {
    name: opts.name || `rounded ${N}-gon`,
    gauge,
    radialAt,
    area,
    outline,
    sym: N,
    breaks: [],
    N,
    reach,
    t,
    c,
    c0,
    cMax,
    alpha,
    uCut,
  };
}

export const smoothedOctagon = (opts) => roundedPolygon(8, 1, { name: "smoothed octagon", ...opts });

// ------------------------------------------------------- the densest lattice

// The affinely regular hexagon inscribed in the shape with the vertex p at the
// polar angle phi: q is the boundary point, less than half a turn ahead of p,
// with q − p on the boundary too. Returns p, q and det(p, q), a third of the
// hexagon's area.
export function hexagonAt(shape, phi) {
  const p = shape.radialAt(phi);
  let lo = phi;
  let hi = phi + Math.PI;
  for (let i = 0; i < 56; i++) {
    const mid = 0.5 * (lo + hi);
    const q = shape.radialAt(mid);
    if (shape.gauge(q[0] - p[0], q[1] - p[1]) < 1) lo = mid;
    else hi = mid;
  }
  const psi = 0.5 * (lo + hi);
  const q = shape.radialAt(psi);
  return { phi, psi, p, q, det: det(p, q) };
}

function goldenMin(f, a, b, iters = 64) {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < iters; i++) {
    if (f1.det <= f2.det) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(x2);
    }
  }
  return f1.det <= f2.det ? f1 : f2;
}

// The densest lattice packing: the inscribed affinely regular hexagon of least
// area, searched on a grid of polar angles for p (with the corners of a
// polygon added), then refined about the lowest local minima. Returns the
// hexagon (p, q, det) and the density area / (4 det); the lattice of centres
// is spanned by 2p and 2q.
export function densestLattice(shape, opts = {}) {
  const n = opts.grid || 240;
  const span = TAU / Math.max(2, shape.sym);
  const grid = [];
  for (let i = 0; i < n; i++) grid.push((i * span) / n);
  for (const b of shape.breaks || []) grid.push((((b % span) + span) % span) * (1 - 1e-12));
  grid.sort((a, b) => a - b);
  const f = (phi) => hexagonAt(shape, phi);
  const vals = grid.map(f);
  const m = vals.length;
  const mins = [];
  for (let i = 0; i < m; i++) {
    const a = vals[(i - 1 + m) % m].det;
    const b = vals[(i + 1) % m].det;
    if (vals[i].det <= a && vals[i].det <= b) mins.push(i);
  }
  mins.sort((i, j) => vals[i].det - vals[j].det);
  let best = vals[mins[0]];
  for (const i of mins.slice(0, opts.refine || 8)) {
    const lo = i === 0 ? grid[m - 1] - span : grid[i - 1];
    const hi = i === m - 1 ? grid[0] + span : grid[i + 1];
    const r = goldenMin(f, lo, hi);
    if (r.det < best.det) best = r;
  }
  return { ...best, density: shape.area / (4 * best.det) };
}

// The density of the lattice packing with copies of the shape at the points of
// the lattice spanned by v1 and v2 (counting overlaps twice, if any).
export const latticeDensity = (shape, v1, v2) => shape.area / Math.abs(det(v1, v2));

// ----------------------------------------------------------------- lattices

// A Lagrange-reduced basis of the lattice spanned by u and v: the first vector
// is a shortest one.
export function reduce(u, v) {
  let a = u;
  let b = v;
  if (norm(a) > norm(b)) [a, b] = [b, a];
  for (let k = 0; k < 64; k++) {
    const m = Math.round(dot(a, b) / dot(a, a));
    if (m === 0) break;
    b = sub(b, mul(a, m));
    if (norm(b) < norm(a)) [a, b] = [b, a];
    else break;
  }
  return [a, b];
}

// The lattice points i u + j v in the rectangle [x0, x1] × [y0, y1].
export function latticePoints(u, v, x0, x1, y0, y1) {
  const [a, b] = reduce(u, v);
  const D = det(a, b);
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ];
  const ci = corners.map((w) => det(w, b) / D);
  const cj = corners.map((w) => det(a, w) / D);
  const out = [];
  for (let i = Math.floor(Math.min(...ci)) - 1; i <= Math.ceil(Math.max(...ci)) + 1; i++) {
    for (let j = Math.floor(Math.min(...cj)) - 1; j <= Math.ceil(Math.max(...cj)) + 1; j++) {
      const x = i * a[0] + j * b[0];
      const y = i * a[1] + j * b[1];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push([x, y]);
    }
  }
  return out;
}

// The largest distance from the centre to the boundary, with a margin: a
// lattice vector w with ‖w‖ < 2 has length below twice this.
const radiusOf = (shape) => {
  if (shape.radius === undefined) shape.radius = 1.01 * Math.max(...shape.outline.map(norm)) + 1e-6;
  return shape.radius;
};

// The nonzero lattice vectors w = c₀u + c₁v with |w| ≤ R, one of each pair ±w,
// with their integer coefficients (c₀, c₁), enumerated through a reduced
// basis so that none is missed.
export function latticeVectors(u, v, R) {
  const [a, b] = reduce(u, v);
  const D = Math.abs(det(a, b));
  const Duv = det(u, v);
  const mi = Math.ceil((R * norm(b)) / D);
  const mj = Math.ceil((R * norm(a)) / D);
  const out = [];
  for (let i = 0; i <= mi; i++) {
    for (let j = -mj; j <= mj; j++) {
      if (i === 0 && j <= 0) continue;
      const w = [i * a[0] + j * b[0], i * a[1] + j * b[1]];
      if (norm(w) > R) continue;
      out.push({ w, c: [Math.round(det(w, v) / Duv), Math.round(det(u, w) / Duv)] });
    }
  }
  return out;
}

// The least gauge of a nonzero lattice vector. Two copies K + x and K + y of
// the lattice packing overlap exactly when ‖x − y‖ < 2, and x − y is a lattice
// vector, so this checks every pair of copies at once: they overlap when it is
// below 2 and the closest touch when it equals 2.
export function leastGauge(shape, u, v) {
  if (Math.abs(det(u, v)) < 1e-9) return 0;
  let best = Infinity;
  for (const { w } of latticeVectors(u, v, 2 * radiusOf(shape))) {
    const g = shape.gauge(w[0], w[1]);
    if (g < best) best = g;
  }
  return best;
}

export const SOLID_TOL = 1e-11;
export const isPacking = (shape, u, v) => leastGauge(shape, u, v) >= 2 - SOLID_TOL;

// Pulls the copies apart, scaling the lattice about the origin, until no two
// overlap.
export function separate(shape, basis) {
  const g = leastGauge(shape, basis[0], basis[1]);
  if (g >= 2 - SOLID_TOL) return basis;
  const f = (2 / g) * (1 + 1e-12);
  return [mul(basis[0], f), mul(basis[1], f)];
}

// Moves the basis vector i of a lattice packing (copies of the shape at the
// points of the lattice spanned by `basis`) towards `target`, with the copies
// solid: no two copies of the packing ever overlap. The move goes in short
// steps, so that no copy can jump over another; each step stops where two
// copies meet (by bisection) and slides the rest of the step along the
// contact. Returns the new basis, which is a packing if the old one was.
export function solidMove(shape, basis, i, target, opts = {}) {
  const step = opts.step || 0.03;
  const maxLen = opts.maxLen || Infinity;
  const R = 2 * radiusOf(shape);
  let B = [basis[0], basis[1]];
  const at = (x) => (i === 0 ? [x, B[1]] : [B[0], x]);
  const ok = (b) => norm(b[i]) <= maxLen && isPacking(shape, b[0], b[1]);
  // the furthest point towards `to` on the segment from B[i] that keeps a packing
  const reach = (to) => {
    if (ok(at(to))) return to;
    const from = B[i];
    const d = sub(to, from);
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 44; k++) {
      const mid = (lo + hi) / 2;
      if (ok(at(add(from, mul(d, mid))))) lo = mid;
      else hi = mid;
    }
    return add(from, mul(d, lo));
  };
  // the unit normal, in the plane of vector i, of the contact that blocks the
  // move to `to`: among the pairs of copies in contact whose offset depends on
  // vector i, the one the move would push deepest
  const blocking = (to) => {
    const delta = sub(to, B[i]);
    let best = null;
    for (const { w, c } of latticeVectors(B[0], B[1], R)) {
      const k = c[i];
      if (!k || shape.gauge(w[0], w[1]) > 2 + 1e-6) continue;
      const g1 = shape.gauge(w[0] + k * delta[0], w[1] + k * delta[1]);
      if (!best || g1 < best.g1) best = { w, k, g1 };
    }
    if (!best) return null;
    const { w, k } = best;
    const e = 1e-7 * Math.max(1, norm(w));
    const gx = (shape.gauge(w[0] + e, w[1]) - shape.gauge(w[0] - e, w[1])) / (2 * e);
    const gy = (shape.gauge(w[0], w[1] + e) - shape.gauge(w[0], w[1] - e)) / (2 * e);
    const n = mul([gx, gy], Math.sign(k));
    const l = norm(n);
    return l > 0 ? mul(n, 1 / l) : null;
  };
  for (let iter = 0; iter < (opts.maxSteps || 600); iter++) {
    const rest = sub(target, B[i]);
    const len = norm(rest);
    if (len < 1e-10) break;
    const to = len > step ? add(B[i], mul(rest, step / len)) : target;
    let p = reach(to);
    if (norm(sub(p, to)) > 1e-13) {
      B = at(p);
      const n = blocking(to);
      if (n) {
        const r = sub(to, p);
        const along = sub(r, mul(n, dot(r, n)));
        if (norm(along) > 1e-13) p = reach(add(p, along));
      }
    }
    const gain = len - norm(sub(target, p));
    B = at(p);
    if (gain < 1e-10) break;
  }
  return B;
}

// --------------------------------------------- centrally symmetric polygons

// The polygon v_0, …, v_{m−1}, −v_0, …, −v_{m−1} from its first half.
export const symmetricPolygon = (half) => [...half, ...half.map(([x, y]) => [-x, -y])];

// Strictly convex and counterclockwise, with every turn at least `eps`.
export function isConvex(verts, eps = 1e-3) {
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const c = verts[(i + 2) % n];
    const e1 = sub(b, a);
    const e2 = sub(c, b);
    if (norm(e1) < 0.05) return false;
    if (det(e1, e2) < eps * norm(e1) * norm(e2)) return false;
  }
  return true;
}
