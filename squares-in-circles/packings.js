// The optimal packings of one to eight unit squares in a circle, as stated in
// SquaresInCircles/Geometry.lean of github.com/vltanh/lean4-squares-in-circles,
// and the plane geometry the playground needs: corners, overlaps, solid moves
// and the smallest circle around a set of points.
//
// A square is {x, y, a, k}: its centre (x, y), its turn a in radians, and the
// index k of its colour. Lengths are in units of the side of the squares.

const H = Math.SQRT1_2; // √2/2
const QUARTER = Math.PI / 2;
const DEG = Math.PI / 180;

const square = (x, y, a = 0, extra = {}) => ({ x, y, a, ...extra });

// Six squares: Six.sStar, Six.tStar, Six.dStar and Six.qStar.
const A6 = (1466 + 1940 * H) / 267;
const B6 = (327 + 432 * H) / 712;
const S6 = (2 * B6) / (A6 + Math.sqrt(A6 * A6 - 4 * B6));
const T6 = (-20 + 30 * H) * S6 + 7 / 2 - (9 * H) / 2;
const D6 = 1 / 2 + H - T6;
const Q6 = 2 * S6 * S6 + 4 * S6 + 5 / 2;

// Seven squares: a centre of the middle column at height y lies in the disk
// exactly when |y| <= Seven.columnLimit.
const L7 = Math.sqrt(3) - 1 / 2;

// Eight squares: the stationary zero (q, y, t) of the five-corner chain,
// EightStatement.selected, found by Newton's method as in
// scripts/figures/fig_front.py, and the corners of the chain.
const Q8 = 3.9155341375174753;
const Y8 = -0.9206566780336811;
const T8 = 0.12363708643558009;
const C8 = Math.cos(T8);
const S8 = Math.sin(T8);
const X1 = Math.sqrt(Q8 - Y8 * Y8);
const X2 = Math.sqrt(Q8 - (Y8 + 2) ** 2);
const X3 = X2 - 3;
const Y3 = Math.sqrt(Q8 - X3 * X3);
const Y4 = Y3 - 2;
const X4 = -Math.sqrt(Q8 - Y4 * Y4);
const H1 = C8 * X1 + S8 * Y8 - 2 - C8;
const H2 = -S8 * X4 + C8 * Y4 - 1 - S8;
const inFrame = (a, b) => [C8 * a - S8 * b, S8 * a + C8 * b];
const Z_MAX = Math.sqrt(Q8 - (X2 - 1) ** 2) - 1 / 2; // T touches the circle
const ETA_MIN = -H2 - Math.sqrt(Q8 - (H1 + 2) ** 2); // G touches the circle
const ETA_MAX = -H2 - 13 / 12;

function seven(p) {
  return [
    square(1, -0.5),
    square(1, 0.5),
    square(-1, -0.5),
    square(-1, 0.5),
    square(0, p.bottom),
    square(0, p.middle),
    square(0, p.top),
  ].map((s, k) => ({ ...s, k }));
}

// The squares A, B, D, E, H, T, G and the central square K of the packing of
// parameters p = {x, y, turn (degrees), z, eta, mirror}, as in
// EightStatement.Parameters.model, reflected in the diagonal when p.mirror.
function eight(p) {
  const h = inFrame(H1 + 1 / 2, H2 + 1 / 2);
  const g = inFrame(H1 + 3 / 2, H2 + 1 / 2 + p.eta);
  const list = [
    ['A', X1 - 1 / 2, Y8 + 1 / 2, 0],
    ['B', X2 - 1 / 2, Y8 + 3 / 2, 0],
    ['D', X3 + 1 / 2, Y3 - 1 / 2, 0],
    ['E', X4 + 1 / 2, Y4 + 1 / 2, 0],
    ['H', h[0], h[1], T8],
    ['T', X2 - 3 / 2, p.z, 0],
    ['G', g[0], g[1], T8],
    ['K', p.x, p.y, p.turn * DEG],
  ];
  return list.map(([label, x, y, a], k) => (p.mirror ? { x: y, y: x, a: QUARTER - a, k, label } : { x, y, a, k, label }));
}

const TOL = 1e-7;
const sameTurn = (a, b) => Math.abs(normalTurn(a - b)) < TOL;
const sameSquare = (s, t) => Math.abs(s.x - t.x) < TOL && Math.abs(s.y - t.y) < TOL && sameTurn(s.a, t.a);

// The heights of the middle column, when the squares form a column packing.
function readSeven(squares) {
  const model = seven({ bottom: -1, middle: 0, top: 1 });
  for (let k = 0; k < 4; k++) if (!sameSquare(squares[k], model[k])) return null;
  const middle = squares.slice(4);
  if (!middle.every((s) => Math.abs(s.x) < TOL && sameTurn(s.a, 0))) return null;
  const [bottom, mid, top] = middle.map((s) => s.y).sort((u, v) => u - v);
  return { bottom, middle: mid, top };
}

// The parameters of the squares, when they form a packing of the family.
function readEight(squares) {
  const model = eight({ x: 0, y: 0, turn: 0, z: 1, eta: 0, mirror: false });
  for (const mirror of [false, true]) {
    const get = (label) => {
      const s = squares.find((q) => q.label === label);
      return mirror ? { x: s.y, y: s.x, a: QUARTER - s.a } : s;
    };
    if (!['A', 'B', 'D', 'E', 'H'].every((L, k) => sameSquare(get(L), model[k]))) continue;
    const t = get('T');
    if (Math.abs(t.x - (X2 - 3 / 2)) > TOL || !sameTurn(t.a, 0)) continue;
    const g = get('G');
    if (!sameTurn(g.a, T8) || Math.abs(C8 * g.x + S8 * g.y - (H1 + 3 / 2)) > TOL) continue;
    const k = get('K');
    return { x: k.x, y: k.y, turn: turnDegrees(k.a), z: t.y, eta: -S8 * g.x + C8 * g.y - (H2 + 1 / 2), mirror };
  }
  return null;
}

// A family is described by its parameters; `optimal` is the range of a
// parameter over which the packing stays in the optimal disk, the others held.
// How square i moves in the optimal packings of a family: null when it is
// fixed, {free} when it moves and turns among the others, or the parameter
// `key` it slides by, with the index of the square in build() and `of`, the
// value of the parameter when the square is centred at c.
const SEVEN = {
  build: seven,
  read: readSeven,
  mover(squares, i) {
    if (i < 4) return null;
    const rank = [4, 5, 6].sort((u, v) => squares[u].y - squares[v].y).indexOf(i);
    return { key: ['bottom', 'middle', 'top'][rank], index: 4 + rank, of: (c) => c.y, what: 'slides along the middle column' };
  },
  // Uniform on the column packings: the gaps of the three heights below
  // 2·columnLimit − 2 are uniform.
  sample(p, random) {
    const [a, b, c] = [random(), random(), random()].map((u) => -L7 + u * (2 * L7 - 2)).sort((u, v) => u - v);
    return { ...p, bottom: a, middle: b + 1, top: c + 2 };
  },
  defaults: { bottom: -1, middle: 0, top: 1 },
  params: [
    { key: 'top', label: 'top', min: -1.75, max: 1.75, step: 0.001, optimal: [-L7, L7] },
    { key: 'middle', label: 'middle', min: -1.75, max: 1.75, step: 0.001, optimal: [-L7, L7] },
    { key: 'bottom', label: 'bottom', min: -1.75, max: 1.75, step: 0.001, optimal: [-L7, L7] },
  ],
};

const EIGHT = {
  build: eight,
  read: readEight,
  mover(squares, i, p) {
    const un = (c) => (p.mirror ? { x: c.y, y: c.x } : c);
    switch (squares[i].label) {
      case 'K':
        return { free: true, what: 'moves and turns in the room the others leave' };
      case 'T':
        return { key: 'z', index: 5, of: (c) => un(c).y, what: 'slides between <i>D</i> and <i>B</i>' };
      case 'G':
        return { key: 'eta', index: 6, of: (c) => -S8 * un(c).x + C8 * un(c).y - (H2 + 1 / 2), what: 'slides along <i>H</i>' };
      default:
        return null;
    }
  },
  // Uniform on the packings of one mirror image, by rejection from the box
  // of the five ranges.
  sample(p, random) {
    for (let tries = 0; tries < 50000; tries++) {
      const q = { ...p };
      for (const r of this.params) q[r.key] = r.optimal[0] + random() * (r.optimal[1] - r.optimal[0]);
      const squares = eight(q);
      if (isPacking(squares) && inDisk(squares, Math.sqrt(Q8))) return q;
    }
    return p;
  },
  // A packing of the family that leaves the central square room to move.
  defaults: { x: 0.04, y: -0.01, turn: 40, z: 1.3, eta: -0.4, mirror: false },
  mirror: true,
  params: [
    { key: 'x', label: 'K, across', min: -0.12, max: 0.24, step: 0.0005, optimal: [-0.12, 0.24] },
    { key: 'y', label: 'K, up', min: -0.4, max: 0.14, step: 0.0005, optimal: [-0.4, 0.14] },
    // The turns of K in the optimal packings, about 4° to 73°, form one
    // interval in [0°, 90°) but not in [-45°, 45°).
    { key: 'turn', label: 'K, turn', min: 0, max: 90, step: 0.05, unit: '°', optimal: [0, 90], turns: 'K' },
    { key: 'z', label: 'T, height', min: 7 / 12, max: Z_MAX + 0.5, step: 0.001, optimal: [7 / 12, Z_MAX] },
    { key: 'eta', label: 'G, along H', min: ETA_MIN - 0.5, max: ETA_MAX, step: 0.001, optimal: [ETA_MIN, ETA_MAX] },
  ],
};

const axisSquares = (centres) => () => centres.map(([x, y], k) => square(x, y, 0, { k }));

export const CASES = [
  null,
  { n: 1, R: H, exact: '√2/2', squares: axisSquares([[0, 0]]) },
  {
    n: 2,
    R: Math.sqrt(5) / 2,
    exact: '√5/2',
    squares: axisSquares([
      [-1 / 2, 0],
      [1 / 2, 0],
    ]),
  },
  {
    n: 3,
    R: (5 * Math.sqrt(17)) / 16,
    exact: '5√17/16',
    squares: axisSquares([
      [-1 / 2, -5 / 16],
      [1 / 2, -5 / 16],
      [0, 11 / 16],
    ]),
  },
  {
    n: 4,
    R: Math.SQRT2,
    exact: '√2',
    squares: axisSquares([
      [1 / 2, 1 / 2],
      [-1 / 2, 1 / 2],
      [-1 / 2, -1 / 2],
      [1 / 2, -1 / 2],
    ]),
  },
  {
    n: 5,
    R: Math.sqrt(5 / 2),
    exact: '√(5/2)',
    squares: axisSquares([
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]),
  },
  {
    n: 6,
    R: Math.sqrt(Q6),
    exact: '√q₆',
    q: Q6,
    squares: () => [
      ...axisSquares([
        [S6, S6],
        [S6, S6 + 1],
        [S6 + 1, S6],
        [S6 - 1, T6],
        [T6, S6 - 1],
      ])(),
      square(-D6, -D6, Math.PI / 4, { k: 5 }),
    ],
  },
  { n: 7, R: Math.sqrt(13) / 2, exact: '√13/2', family: SEVEN, squares: () => seven(SEVEN.defaults) },
  { n: 8, R: Math.sqrt(Q8), exact: '√q₈', q: Q8, family: EIGHT, squares: () => eight(EIGHT.defaults) },
];

// ------------------------------------------------------------------ geometry

// The turn a, modulo a quarter turn, in [-π/4, π/4).
export function normalTurn(a) {
  return a - QUARTER * Math.floor(a / QUARTER + 1 / 2);
}

// The turn a in degrees, modulo a quarter turn, in [0, 90).
export function turnDegrees(a) {
  const d = (normalTurn(a) / DEG + 90) % 90;
  return d > 90 - 1e-9 ? 0 : d;
}

export function corners(s) {
  const c = Math.cos(s.a) / 2;
  const n = Math.sin(s.a) / 2;
  return [
    [s.x + c - n, s.y + n + c],
    [s.x - c - n, s.y - n + c],
    [s.x - c + n, s.y - n - c],
    [s.x + c + n, s.y + n - c],
  ];
}

const halfWidth = (s, nx, ny) => (Math.abs(nx * Math.cos(s.a) + ny * Math.sin(s.a)) + Math.abs(-nx * Math.sin(s.a) + ny * Math.cos(s.a))) / 2;

// Squares whose interiors overlap by at most EPS along some axis count as
// touching, so that rounding never reads a contact as an overlap.
export const EPS = 1e-9;

// The shortest translation of P that ends its overlap with Q, by separating
// axes, or null when the open squares are disjoint.
export function push(P, Q) {
  const dx = P.x - Q.x;
  const dy = P.y - Q.y;
  let best = null;
  for (const a of [P.a, P.a + QUARTER, Q.a, Q.a + QUARTER]) {
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    const d = nx * dx + ny * dy;
    const depth = halfWidth(P, nx, ny) + halfWidth(Q, nx, ny) - Math.abs(d);
    if (depth <= EPS) return null;
    if (!best || depth < best.depth) {
      const sign = d < 0 ? -1 : 1;
      best = { depth, x: sign * nx * depth, y: sign * ny * depth };
    }
  }
  return best;
}

// Whether every corner lies in the closed disk of radius R about the origin,
// up to rounding.
export function inDisk(squares, R) {
  const r2 = R * R + 1e-9;
  return squares.every((s) => corners(s).every(([x, y]) => x * x + y * y <= r2));
}

export function isPacking(squares) {
  for (let i = 0; i < squares.length; i++) for (let j = i + 1; j < squares.length; j++) if (push(squares[i], squares[j])) return false;
  return true;
}

// Keeps the square inside the box [-bound, bound]².
function keepIn(s, bound) {
  const e = (Math.abs(Math.cos(s.a)) + Math.abs(Math.sin(s.a))) / 2;
  s.x = Math.min(bound - e, Math.max(-bound + e, s.x));
  s.y = Math.min(bound - e, Math.max(-bound + e, s.y));
}

// Moves are computed in the plane of the centre of the moving square: for a
// turn a, each other square Q forbids the open convex polygon of centres where
// the moving square would overlap Q, the hull of the differences of their
// corners. The depth of a centre in that polygon is the depth of the overlap.

export function hull(points) {
  const p = [...points].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const cross = (o, u, v) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const lower = [];
  const upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function obstacles(squares, i, a) {
  const shape = corners({ x: 0, y: 0, a });
  const out = [];
  for (let j = 0; j < squares.length; j++) {
    if (j === i) continue;
    const pts = [];
    for (const q of corners(squares[j])) for (const k of shape) pts.push([q[0] - k[0], q[1] - k[1]]);
    out.push(hull(pts));
  }
  return out;
}

// The least distance from c to the lines of the edges of the counterclockwise
// polygon h: positive inside, negative outside.
function depth(h, c) {
  let d = Infinity;
  for (let k = 0; k < h.length; k++) {
    const u = h[k];
    const v = h[(k + 1) % h.length];
    const ex = v[0] - u[0];
    const ey = v[1] - u[1];
    d = Math.min(d, (ex * (c[1] - u[1]) - ey * (c[0] - u[0])) / Math.hypot(ex, ey));
  }
  return d;
}

const blocked = (polys, c) => polys.some((h) => depth(h, c) > EPS);

function closest(c, u, v) {
  const ex = v[0] - u[0];
  const ey = v[1] - u[1];
  const t = Math.max(0, Math.min(1, ((c[0] - u[0]) * ex + (c[1] - u[1]) * ey) / (ex * ex + ey * ey)));
  return [u[0] + t * ex, u[1] + t * ey];
}

function meet(u, v, p, q) {
  const rx = v[0] - u[0];
  const ry = v[1] - u[1];
  const sx = q[0] - p[0];
  const sy = q[1] - p[1];
  const d = rx * sy - ry * sx;
  if (Math.abs(d) < 1e-14) return null;
  const t = ((p[0] - u[0]) * sy - (p[1] - u[1]) * sx) / d;
  const w = ((p[0] - u[0]) * ry - (p[1] - u[1]) * rx) / d;
  return t < -1e-12 || t > 1 + 1e-12 || w < -1e-12 || w > 1 + 1e-12 ? null : [u[0] + t * rx, u[1] + t * ry];
}

// The free centre nearest to c within distance `reach`, or null. It is c, a
// point of an edge of a forbidden polygon, or a crossing of two such edges.
function nearestFree(polys, c, reach = 0.1) {
  if (!blocked(polys, c)) return c;
  const near = polys.filter((h) => depth(h, c) > -reach);
  const edges = near.flatMap((h, m) => h.map((u, k) => [u, h[(k + 1) % h.length], m]));
  const candidates = edges.map(([u, v]) => closest(c, u, v));
  for (let e = 0; e < edges.length; e++) {
    for (let f = e + 1; f < edges.length; f++) {
      if (edges[e][2] === edges[f][2]) continue;
      const x = meet(edges[e][0], edges[e][1], edges[f][0], edges[f][1]);
      if (x) candidates.push(x);
    }
  }
  const d2 = (p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
  candidates.sort((p, q) => d2(p) - d2(q));
  for (const p of candidates) {
    if (d2(p) > reach * reach) break;
    if (!blocked(polys, p)) return p;
  }
  return null;
}

// Square i moved toward the centre (x, y) in small steps: each step goes to
// the free place nearest to where it aimed, so the square stops at the other
// squares and slides along them.
export function moveSquare(squares, i, x, y, bound) {
  let p = { ...squares[i] };
  const polys = obstacles(squares, i, p.a);
  const dx = x - p.x;
  const dy = y - p.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.02));
  for (let k = 0; k < steps; k++) {
    const q = nearestFree(polys, [p.x + dx / steps, p.y + dy / steps], 0.05);
    if (!q) break;
    const r = { ...p, x: q[0], y: q[1] };
    keepIn(r, bound);
    if (blocked(polys, [r.x, r.y])) break;
    p = r;
  }
  return p;
}

// The distance from the free centre c to the nearest forbidden polygon.
function room(polys, c) {
  let best = Infinity;
  for (const h of polys) {
    for (let k = 0; k < h.length; k++) {
      const q = closest(c, h[k], h[(k + 1) % h.length]);
      best = Math.min(best, Math.hypot(q[0] - c[0], q[1] - c[1]));
    }
  }
  return best;
}

const DIRECTIONS = [...Array(8)].map((_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

// In a tight place, the free centre c moved a little toward more room.
function centre(polys, c) {
  let r = room(polys, c);
  if (r > 0.05) return c;
  for (let it = 0; it < 3; it++) {
    let best = null;
    for (const [ux, uy] of DIRECTIONS) {
      const q = [c[0] + 0.001 * ux, c[1] + 0.001 * uy];
      if (blocked(polys, q)) continue;
      const rq = room(polys, q);
      if (rq > r + 1e-12 && (!best || rq > best[1])) best = [q, rq];
    }
    if (!best) break;
    [c, r] = best;
  }
  return c;
}

// Square i turned toward the turn a in small steps. A square that meets
// another moves to the nearest place where it fits, first sliding there at its
// old turn when that place is not right beside it, and stops when there is
// none. In a tight place it also drifts toward more room as it turns, like a
// key in a lock, so that it follows the wide part of the gap.
export function turnSquare(squares, i, a, bound) {
  let p = { ...squares[i] };
  const da = a - p.a;
  const steps = Math.max(1, Math.ceil(Math.abs(da) / (0.25 * DEG)));
  const others = squares.slice();
  for (let k = 0; k < steps; k++) {
    const b = p.a + da / steps;
    const polys = obstacles(squares, i, b);
    let q = nearestFree(polys, [p.x, p.y]);
    if (!q) break;
    if (Math.hypot(q[0] - p.x, q[1] - p.y) > 0.004) {
      others[i] = p;
      const r = moveSquare(others, i, q[0], q[1], bound);
      if (Math.hypot(r.x - q[0], r.y - q[1]) > 1e-9) break;
    }
    q = centre(polys, q);
    const r = { ...p, x: q[0], y: q[1], a: b };
    keepIn(r, bound);
    if (Math.hypot(r.x - q[0], r.y - q[1]) > 1e-12) break;
    p = r;
  }
  return p;
}

// The test whether a centre for square i, turned by a, is blocked: each
// forbidden polygon is packed as the inward unit normals and offsets of its
// edges, and a centre is blocked when it lies more than EPS inside all the
// edges of one polygon.
function blocker(squares, i, a) {
  const polys = obstacles(squares, i, a);
  const planes = new Float64Array(polys.reduce((m, h) => m + 3 * h.length, 0));
  const ends = [];
  let at = 0;
  for (const h of polys) {
    for (let k = 0; k < h.length; k++) {
      const u = h[k];
      const v = h[(k + 1) % h.length];
      const l = Math.hypot(v[0] - u[0], v[1] - u[1]);
      planes[at] = -(v[1] - u[1]) / l;
      planes[at + 1] = (v[0] - u[0]) / l;
      planes[at + 2] = planes[at] * u[0] + planes[at + 1] * u[1];
      at += 3;
    }
    ends.push(at);
  }
  return (x, y) => {
    let first = 0;
    for (const end of ends) {
      let all = true;
      for (let e = first; e < end; e += 3) {
        if (planes[e] * x + planes[e + 1] * y - planes[e + 2] <= EPS) {
          all = false;
          break;
        }
      }
      if (all) return true;
      first = end;
    }
    return false;
  };
}

// The region square i covers sliding among the others without turning: the
// free centres on a fine grid around it, the run of them that holds its own
// centre, each row of that run giving the hull of the squares at its two
// ends, all painted on a raster whose outline is returned as loops.
export function slideArea(squares, i, step = 0.005, cell = 0.006) {
  const s = squares[i];
  const blockedAt = blocker(squares, i, s.a);
  let bx0 = s.x;
  let bx1 = s.x;
  let by0 = s.y;
  let by1 = s.y;
  for (let u = -20; u <= 20; u++) {
    for (let v = -20; v <= 20; v++) {
      const x = s.x + 0.03 * u;
      const y = s.y + 0.03 * v;
      if (blockedAt(x, y)) continue;
      bx0 = Math.min(bx0, x);
      bx1 = Math.max(bx1, x);
      by0 = Math.min(by0, y);
      by1 = Math.max(by1, y);
    }
  }
  bx0 -= 0.04;
  by0 -= 0.04;
  const MX = Math.ceil((bx1 + 0.04 - bx0) / step) + 1;
  const MY = Math.ceil((by1 + 0.04 - by0) / step) + 1;
  const free = new Uint8Array(MX * MY);
  for (let v = 0; v < MY; v++) for (let u = 0; u < MX; u++) free[v * MX + u] = blockedAt(bx0 + u * step, by0 + v * step) ? 0 : 1;
  // The run of free centres that holds the square's own centre, or the
  // nearest free centre to it.
  const u0 = Math.round((s.x - bx0) / step);
  const v0 = Math.round((s.y - by0) / step);
  let seed = -1;
  for (let r = 0; r <= 3 && seed < 0; r++) {
    for (let dv = -r; dv <= r && seed < 0; dv++) {
      for (let du = -r; du <= r && seed < 0; du++) {
        const u = u0 + du;
        const v = v0 + dv;
        if (u >= 0 && v >= 0 && u < MX && v < MY && free[v * MX + u]) seed = v * MX + u;
      }
    }
  }
  if (seed < 0) return [];
  const stack = [seed];
  free[seed] = 2;
  while (stack.length) {
    const c = stack.pop();
    const u = c % MX;
    for (const d of [u > 0 ? c - 1 : -1, u < MX - 1 ? c + 1 : -1, c >= MX ? c - MX : -1, c < MX * (MY - 1) ? c + MX : -1]) {
      if (d >= 0 && free[d] === 1) {
        free[d] = 2;
        stack.push(d);
      }
    }
  }
  const x0 = bx0 - 0.75;
  const y0 = by0 - 0.75;
  const NX = Math.ceil((MX * step + 1.5) / cell) + 1;
  const NY = Math.ceil((MY * step + 1.5) / cell) + 1;
  const raster = new Uint8Array(NX * NY);
  const paint = (poly) => {
    const ys = poly.map((q) => q[1]);
    const jlo = Math.max(0, Math.floor((Math.min(...ys) - y0) / cell));
    const jhi = Math.min(NY - 1, Math.ceil((Math.max(...ys) - y0) / cell));
    for (let j = jlo; j <= jhi; j++) {
      const y = y0 + (j + 0.5) * cell;
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < poly.length; k++) {
        const [ax, ay] = poly[k];
        const [bx, by] = poly[(k + 1) % poly.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
      }
      const ilo = Math.max(0, Math.ceil((lo - x0) / cell - 0.5));
      const ihi = Math.min(NX - 1, Math.floor((hi - x0) / cell - 0.5));
      for (let k = ilo; k <= ihi; k++) raster[j * NX + k] = 1;
    }
  };
  const shape = corners({ x: 0, y: 0, a: s.a });
  for (let v = 0; v < MY; v++) {
    for (let u = 0; u < MX; u++) {
      if (free[v * MX + u] !== 2) continue;
      let w = u;
      while (w + 1 < MX && free[v * MX + w + 1] === 2) w++;
      const ends = [bx0 + u * step, bx0 + w * step].flatMap((x) => shape.map(([kx, ky]) => [x + kx, by0 + v * step + ky]));
      paint(hull(ends));
      u = w;
    }
  }
  return outline(raster, NX, NY, x0, y0, cell);
}

// The boundary of the painted cells of a raster, as loops through the
// midpoints of its edges.
function outline(raster, NX, NY, x0, y0, cell) {
  const on = (u, v) => u >= 0 && v >= 0 && u < NX && v < NY && raster[v * NX + u] === 1;
  const W = NY + 2;
  const next = new Map();
  const add = (ax, ay, bx, by) => {
    const key = ax * W + ay;
    if (!next.has(key)) next.set(key, []);
    next.get(key).push([bx, by]);
  };
  for (let v = 0; v < NY; v++) {
    for (let u = 0; u < NX; u++) {
      if (!on(u, v)) continue;
      if (!on(u, v - 1)) add(u, v, u + 1, v);
      if (!on(u + 1, v)) add(u + 1, v, u + 1, v + 1);
      if (!on(u, v + 1)) add(u + 1, v + 1, u, v + 1);
      if (!on(u - 1, v)) add(u, v + 1, u, v);
    }
  }
  const loops = [];
  for (const [key, list] of next) {
    while (list.length) {
      const sx = Math.floor(key / W);
      const sy = key % W;
      const loop = [[sx, sy]];
      let [cx, cy] = list.pop();
      while (cx !== sx || cy !== sy) {
        loop.push([cx, cy]);
        const out = next.get(cx * W + cy);
        if (!out || !out.length) break;
        [cx, cy] = out.pop();
      }
      if (loop.length < 4) continue;
      const mid = loop.map((p, k) => {
        const q = loop[(k + 1) % loop.length];
        return [x0 + ((p[0] + q[0]) / 2) * cell, y0 + ((p[1] + q[1]) / 2) * cell];
      });
      loops.push(mid.filter((p, k) => {
        const a = mid[(k + mid.length - 1) % mid.length];
        const b = mid[(k + 1) % mid.length];
        return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-12;
      }));
    }
  }
  return loops;
}

// The value of params[key] reached on the way to `value` while the squares of
// the family still form a packing, in the disk of radius R if one is given:
// the first contact, found by bisection.
export function reach(family, params, key, value, step, R = Infinity) {
  const from = params[key];
  const at = (v) => {
    const squares = family.build({ ...params, [key]: v });
    return isPacking(squares) && (R === Infinity || inDisk(squares, R));
  };
  const steps = Math.max(1, Math.ceil(Math.abs(value - from) / step));
  let good = from;
  for (let k = 1; k <= steps; k++) {
    const v = from + ((value - from) * k) / steps;
    if (at(v)) {
      good = v;
      continue;
    }
    let lo = good;
    let hi = v;
    for (let it = 0; it < 44; it++) {
      const mid = (lo + hi) / 2;
      if (at(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  return good;
}

// n squares at random places and turns in the box [-bound, bound]², none
// overlapping.
export function scatter(n, bound, random = Math.random) {
  for (let spread = 0.75; ; spread = Math.min(1, spread + 0.05)) {
    const squares = [];
    for (let tries = 0; squares.length < n && tries < 4000; tries++) {
      const r = bound * spread - 0.75;
      const s = { x: (2 * random() - 1) * r, y: (2 * random() - 1) * r, a: (random() - 0.5) * QUARTER, k: squares.length };
      if (squares.every((t) => !push(s, t) && Math.hypot(s.x - t.x, s.y - t.y) > 1.2)) squares.push(s);
    }
    if (squares.length === n) return squares;
  }
}

// The smallest circle containing the points, by the incremental form of
// Welzl's algorithm.
export function enclosingCircle(points) {
  const inside = (c, p) => Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r + 1e-12;
  let c = { x: points[0][0], y: points[0][1], r: 0 };
  for (let i = 1; i < points.length; i++) {
    if (inside(c, points[i])) continue;
    c = { x: points[i][0], y: points[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(c, points[j])) continue;
      c = circle2(points[i], points[j]);
      for (let k = 0; k < j; k++) if (!inside(c, points[k])) c = circle3(points[i], points[j], points[k]);
    }
  }
  return c;
}

function circle2(a, b) {
  const x = (a[0] + b[0]) / 2;
  const y = (a[1] + b[1]) / 2;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}

function circle3(a, b, c) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const cx = c[0] - a[0];
  const cy = c[1] - a[1];
  const d = 2 * (bx * cy - by * cx);
  if (Math.abs(d) < 1e-14) return [circle2(a, b), circle2(a, c), circle2(b, c)].reduce((p, q) => (p.r > q.r ? p : q));
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return { x: a[0] + ux, y: a[1] + uy, r: Math.hypot(ux, uy) };
}
