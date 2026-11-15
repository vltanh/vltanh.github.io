// The Princess and Monster playground. Built by build_strategy_page.py from strategy_page_template.html.
(async () => {
"use strict";
const DATA = await (async () => { const e = document.getElementById("strategy-data"); return e ? JSON.parse(e.textContent) : (await fetch("data.json")).json(); })();
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; }
const B = DATA.bounds;
const f4 = (v) => v.toFixed(4), f5 = (v) => v.toFixed(5);

/* ---------------------------------------------------------------- colour theme, shared with vltanh.me */
const THEMES = ["system", "light", "dark"];
const ICONS = {
  system: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" class="solid"/></svg>',
  light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z"/></svg>',
};
let theme = (() => { try { const t = localStorage.getItem("theme"); return THEMES.includes(t) ? t : "system"; } catch (e) { return "system"; } })();
function applyTheme() {
  const b = $("theme");
  if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  b.innerHTML = ICONS[theme]; b.title = `Colours: ${theme === "system" ? "as the system" : theme} (click to change)`; b.setAttribute("aria-label", `Colour theme: ${theme}`);
}
$("theme").addEventListener("click", () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; try { localStorage.setItem("theme", theme); } catch (e) {} applyTheme(); });
applyTheme();
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function rgb(hex) { const h = hex.replace("#", ""); const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); }

/* ---------------------------------------------------------------- the princess's plan: the nodal field, n = 512 */
const FN = DATA.field.n, FR = 2 * FN, FC = 4 * FN, DL = 1 / FR;
// Inline, the field is base64 of round(65535 G), row by row (time j, radius nodes along the row). On the site it is
// field.bin: each row as differences mod 65536 along the radius, gzip-compressed, which is 30 times smaller.
const FV = await (async () => {
  if (DATA.field.b64) { const s = atob(DATA.field.b64), n = s.length / 2, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8)) / 65535; return o; }
  let b = new Uint8Array(await (await fetch(DATA.field.file)).arrayBuffer());
  if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), n = b.byteLength / 2, o = new Float32Array(n);
  for (let i = 0, acc = 0; i < n; i++) { if (i % FN === 0) acc = 0; acc = (acc + v.getUint16(2 * i, true)) & 0xffff; o[i] = acc / 65535; }
  return o;
})();
function Gnode(j, k) { if (k <= 0) return 0; if (j > FC) { k -= j - FC; j = FC; if (k <= 0) return 0; } if (k > FR) return 1; return FV[j * FN + ((k - 1) >> 1)]; }
function Fnode(j, d) { if (d >= FR) return 1; if (d <= -FR) return 0; const g = Gnode(j, Math.abs(d)); return d >= 0 ? 0.5 * (1 + g) : 0.5 * (1 - g); }
const RK = DATA.ranks, NQ = RK.q.length, NT = RK.r[0].length, RDT = RK.dt;
const RAD = RK.r.map((row) => Float32Array.from(row, (v) => v / 10000));
const radAt = (q, t) => { const i = Math.max(0, t) / RDT, i0 = Math.min(NT - 1, Math.floor(i)), i1 = Math.min(NT - 1, i0 + 1), a = Math.min(1, i - i0); return RAD[q][i0] * (1 - a) + RAD[q][i1] * a; };

/* ---------------------------------------------------------------- the monster's plan */
const LAW = DATA.law, NB = LAW.mesh, LEV = LAW.levels;
const FAM = {
  sweep: { name: "Sweep", c: "--fam-sweep", desc: "Start at one end and run straight to the other. Any princess is met by time 2." },
  Sp: { name: "Near end first", c: "--fam-s", desc: "Start somewhere, run to the nearer end, then sweep back to the far end." },
  P1p: { name: "Turn at t + x = 1", c: "--fam-p", desc: "Run towards an end, turn back on the line t + x = 1, which is where a sweep from that end would be, then sweep to the far end and back." },
  P1m: { name: "Cross, then turn", c: "--fam-pm", desc: "Start on the other side, run through the centre, and turn back on the line t + x = 1." },
  Sm: { name: "Through to the far end", c: "--fam-sm", desc: "Start on the other side, run through the centre to the end, then sweep back." },
  Q: { name: "Turn just off 1", c: "--fam-q", desc: "One turn on a line t + x = b with b close to 1. Spreading the turns a little makes it harder to slip past." },
  T: { name: "Two turns", c: "--fam-t", desc: "Start near the centre, run out, turn back, then turn again to join a sweep from the other end. These paths are new in this research and lower the ceiling by about 0.0004." },
};
const KIND_FAM = { P1p: "P1p", Sp: "Sp", P1m: "P1m", Sm: "Sm", Qp: "Q", Qm: "Q", Tp: "T", Tm: "T" };
const FAM_ORDER = ["sweep", "Sp", "P1p", "P1m", "Sm", "Q", "T"];
const famMass = { sweep: LAW.sweep }; for (const k of FAM_ORDER.slice(1)) famMass[k] = 0;
for (const r of LAW.records) famMass[KIND_FAM[r[0]]] += r[r.length - 1];

function Ppath(a, b) { const v = [[0, a]]; if (b > a + 1e-12) v.push([(b - a) / 2, (a + b) / 2]); const [t, x] = v[v.length - 1]; v.push([t + x + 1, -1], [t + x + 3, 1]); return v; }
function Tpath(c, u) { const v = [[0, c]]; if (u > c + 1e-12) v.push([(u - c) / 2, (u + c) / 2]); v.push([(1 + u) / 2, (u - 1) / 2], [2, 1], [4, -1]); return v; }
const mirror = (v) => v.map(([t, x]) => [t, -x]);
function posAt(v, t) { if (t <= v[0][0]) return v[0][1]; for (let i = 1; i < v.length; i++) if (t <= v[i][0]) { const [t0, x0] = v[i - 1], [t1, x1] = v[i]; return t1 > t0 ? x0 + (x1 - x0) * (t - t0) / (t1 - t0) : x1; } return v[v.length - 1][1]; }
function recPath(r, u = 0.5, w = 0.5) {          // one path of a bin of the plan, at fractions (u, w) of its ranges
  const k = r[0], x = (r[1] + u) / NB;
  if (k === "P1p") return Ppath(x, 1);
  if (k === "Sp") return Ppath(x, 2 - x);
  if (k === "P1m") return Ppath(-x, 1);
  if (k === "Sm") return Ppath(-x, 2 + x);
  if (k === "Qp" || k === "Qm") { const a = k === "Qp" ? x : -x, b = (NB - LEV + r[2] + w) / NB; return Ppath(a, Math.min(Math.max(b, Math.abs(a)), 2 - a)); }
  const c = k === "Tp" ? x : -x, uu = (r[2] + w) / NB; return Tpath(c, Math.max(uu, Math.abs(c)));
}
const PN = DATA.page_law.N, PB = DATA.page_law.bound;
const ATOMS = (() => {                           // the plan placed on the grid 1/PN by the trapezoid rule, exactly as in the proof
  const r = PN / NB, end = (t) => (t === 0 || t === r ? 1 : 2), map = new Map();
  const add = (kind, s, l, w) => { const key = kind + s + "," + l; map.set(key, (map.get(key) || 0) + w); };
  add("P", PN, PN, LAW.sweep * 4 * r * r);
  for (const rec of LAW.records) {
    const k = rec[0], i = rec[1], m = rec[rec.length - 1];
    for (let t = 0; t <= r; t++) {
      const a = i * r + t;
      if (k === "P1p") add("P", a, PN, m * 2 * r * end(t));
      else if (k === "Sp") add("P", a, 2 * PN - a, m * 2 * r * end(t));
      else if (k === "P1m") add("P", -a, PN, m * 2 * r * end(t));
      else if (k === "Sm") add("P", -a, 2 * PN + a, m * 2 * r * end(t));
      else for (let u = 0; u <= r; u++) {
        const w = m * end(t) * end(u);
        if (k === "Qp" || k === "Qm") add("P", k === "Qp" ? a : -a, (NB - LEV + rec[2]) * r + u, w);
        else add("T", k === "Tp" ? a : -a, rec[2] * r + u, w);
      }
    }
  }
  const out = [];
  for (const [key, w] of map) { const kind = key[0], [s, l] = key.slice(1).split(",").map(Number), v = kind === "P" ? Ppath(s / PN, l / PN) : Tpath(s / PN, l / PN); out.push({ v, w: w / 2 }, { v: mirror(v), w: w / 2 }); }
  return out;
})();
const TOTAL = LAW.sweep + LAW.records.reduce((s, r) => s + r[r.length - 1], 0);
const WSUM = ATOMS.reduce((s, a) => s + a.w, 0);
function sampleMonster(oneSide = false) {
  let z = Math.random() * TOTAL; const side = oneSide || Math.random() < 0.5 ? 1 : -1;
  const pick = (v, fam) => ({ v: side > 0 ? v : mirror(v), fam });
  if ((z -= LAW.sweep) < 0) return pick(Ppath(1, 1), "sweep");
  for (const r of LAW.records) if ((z -= r[r.length - 1]) < 0) return pick(recPath(r, Math.random(), Math.random()), KIND_FAM[r[0]]);
  return pick(Ppath(1, 1), "sweep");
}
function meet(xs, h, v) {                        // first meeting of a trail (positions every h, straight between) with a monster path
  const last = xs.length - 1, X = (k) => xs[k < last ? k : last];
  const XP = (t) => { const k = Math.floor(t / h), a = t / h - k; return X(k) * (1 - a) + X(k + 1) * a; };
  let pt = 0, pd = X(0) - v[0][1];
  if (Math.abs(pd) < 1e-12) return 0;
  let k = 1;
  for (let i = 1; i < v.length; i++) {        // both paths are straight between consecutive sample and turning times
    const t0 = v[i - 1][0], x0 = v[i - 1][1], t1 = v[i][0], sl = t1 > t0 ? (v[i][1] - x0) / (t1 - t0) : 0;
    for (; k * h < t1; k++) {
      const t = k * h, dd = X(k) - (x0 + sl * (t - t0));
      if (dd === 0 || (dd > 0) !== (pd > 0)) return pt + (t - pt) * pd / (pd - dd);
      pt = t; pd = dd;
    }
    const dd = XP(t1) - v[i][1];                // at the monster's turn: he can pass her and come back within one sample step
    if (dd === 0 || (dd > 0) !== (pd > 0)) return pt + (t1 - pt) * pd / (pd - dd);
    pt = t1; pd = dd;
  }
  return v[v.length - 1][0];
}
function stepMeet(tA, xA, tB, xB, v) {           // the same for one step of a live round; null if no meeting
  let pt = tA, pd = xA - posAt(v, tA);
  const times = []; for (const q of v) if (q[0] > tA && q[0] < tB) times.push(q[0]); times.push(tB);
  for (const t of times) {
    const dd = xA + (xB - xA) * (t - tA) / (tB - tA) - posAt(v, t);
    if (dd === 0 || (dd > 0) !== (pd > 0)) return pt + (t - pt) * pd / (pd - dd);
    pt = t; pd = dd;
  }
  return null;
}
const planAverage = (xs, h) => { let s = 0; for (const a of ATOMS) s += a.w * meet(xs, h, a.v); return s / WSUM; };
// a traced staircase, followed just inside the far corners of its cells: its centre path delayed by
// a little less than half a cell, so that it crosses every grid line just before the corner
function demoX(p, t) {
  const n = p.d.length - 1, u = Math.max(0, t * 2 * p.N - 0.999), j = Math.min(n, Math.floor(u)), a = Math.min(1, u - j);
  return (p.d[j] * (1 - a) + p.d[Math.min(n, j + 1)] * a) / (2 * p.N);
}

/* ---------------------------------------------------------------- a monster path against her plan, on the grid of her plan */
const ev = (x) => 2 * Math.round(x * FN);
function latticeMoves(kind, a, b) {
  const run = (d0, legs) => { const m = []; for (const [dir, n] of legs) for (let i = 0; i < n; i++) m.push(dir); return { d0, m }; };
  if (kind === "P") { const a2 = ev(a), b2 = Math.min(Math.max(ev(b), Math.abs(a2)), 2 * FR - a2), n1 = (b2 - a2) / 2, x1 = a2 + n1; return run(a2, [[1, n1], [-1, x1 + FR], [1, 2 * FR]]); }
  const c2 = ev(a), u2 = Math.min(Math.max(ev(b), Math.abs(c2)), FR), n1 = (u2 - c2) / 2, x1 = c2 + n1, n2 = (FR + c2) / 2, x2 = x1 - n2;
  return run(c2, [[1, n1], [-1, n2], [1, FR - x2], [-1, 2 * FR]]);
}
function latticeRun(kind, a, b) {
  const { d0, m } = latticeMoves(kind, a, b), n = m.length + 1, A = new Float32Array(n), Bv = new Float32Array(n);
  let d = d0, lo = Fnode(0, d0), hi = lo, cost = 0, k;
  A[0] = lo; Bv[0] = hi;
  for (k = 1; k < n; k++) {
    d += m[k - 1]; const f = Fnode(k, d), w0 = hi - lo; lo = Math.min(lo, f); hi = Math.max(hi, f);
    cost += (k - 0.5) * DL * ((hi - lo) - w0); A[k] = lo; Bv[k] = hi;            // what this step catches, at its middle
    if (hi - lo >= 1 - 1e-9) { k++; break; }
  }
  return { A, B: Bv, n: k, cost, f0: A[0] };
}
function caughtAt(run, theta) {
  const { A, B: Bv, n, f0 } = run, ok = theta >= f0 ? (k) => Bv[k] >= theta : (k) => A[k] <= theta;
  if (!ok(n - 1)) return Infinity;
  let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (ok(mid)) hi = mid; else lo = mid + 1; }
  return lo * DL;
}
const BEST_COST = DATA.costs.minimum;

/* ---------------------------------------------------------------- what the visitor tried, for part 5 */
const TRIED = { p: [], m: [] };
let refreshSqueeze = () => {};
function remember(side, name, v) { const list = TRIED[side], i = list.findIndex((e) => e.name === name); if (i >= 0) list.splice(i, 1); list.push({ name, v, you: true }); if (list.length > 8) list.shift(); refreshSqueeze(); }

/* ---------------------------------------------------------------- a board in space and time: position across, time up */
class Board {
  constructor(svg, { tmax = 2.5, aspect = 1.1, xr = [-1, 1], onResize } = {}) {
    Object.assign(this, { svg, tmax, aspect, xr, onResize, pad: { l: 36, r: 12, t: 14, b: 34 } });
    this.measure();
    let pending = 0;
    new ResizeObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { const w = this.w; this.measure(); if (w !== this.w && this.onResize) this.onResize(); }); }).observe(svg);
  }
  measure() {
    this.w = Math.max(240, Math.round(this.svg.getBoundingClientRect().width) || 560); this.h = Math.round(this.w * this.aspect);
    this.svg.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`); this.svg.style.aspectRatio = `${this.w} / ${this.h}`;
    this.iw = this.w - this.pad.l - this.pad.r; this.ih = this.h - this.pad.t - this.pad.b;
  }
  X(x) { return this.pad.l + (x - this.xr[0]) / (this.xr[1] - this.xr[0]) * this.iw; }
  Y(t) { return this.pad.t + (1 - t / this.tmax) * this.ih; }
  toWorld(e) { const r = this.svg.getBoundingClientRect(), s = this.w / r.width; const px = (e.clientX - r.left) * s, py = (e.clientY - r.top) * s; return { x: this.xr[0] + (px - this.pad.l) / this.iw * (this.xr[1] - this.xr[0]), t: (1 - (py - this.pad.t) / this.ih) * this.tmax }; }
  frame(g, xlab = "position in the corridor") {
    const grid = el("g", { class: "grid" }, g), [x0, x1] = this.xr, dx = (x1 - x0) / 4;
    for (let i = 0; i <= 4; i++) { const x = x0 + dx * i; el("line", { x1: this.X(x), x2: this.X(x), y1: this.Y(0), y2: this.Y(this.tmax), class: Math.abs(x) < 1e-9 ? "axis" : "" }, grid); el("text", { x: this.X(x), y: this.h - 16, class: "tick mid" }, g).textContent = Math.abs(x) < 1e-9 ? "0" : (x > 0 ? String(x) : "−" + (-x)); }
    const step = this.tmax > 3.2 ? 1 : 0.5;
    for (let t = 0; t <= this.tmax + 1e-9; t += step) { el("line", { x1: this.X(x0), x2: this.X(x1), y1: this.Y(t), y2: this.Y(t), class: t === 0 ? "axis" : "" }, grid); el("text", { x: this.pad.l - 6, y: this.Y(t) + 4, class: "tick end" }, g).textContent = String(t); }
    el("text", { x: this.X(x0) + 6, y: this.Y(this.tmax) + 14, class: "axis-name" }, g).textContent = "time ↑";
    el("text", { x: this.X(x1), y: this.h - 2, class: "axis-name tick end" }, g).textContent = xlab;
  }
  d(v, tEnd = Infinity) { let s = `M${this.X(v[0][1]).toFixed(1)} ${this.Y(v[0][0]).toFixed(1)}`; for (let i = 1; i < v.length; i++) { if (v[i][0] >= tEnd) { s += `L${this.X(posAt(v, tEnd)).toFixed(1)} ${this.Y(tEnd).toFixed(1)}`; break; } s += `L${this.X(v[i][1]).toFixed(1)} ${this.Y(v[i][0]).toFixed(1)}`; } return s; }
  dSamples(xs, h, k0, k1, sign = 1) { let s = ""; for (let k = k0; k <= k1; k++) s += (k === k0 ? "M" : "L") + this.X(sign * xs[k]).toFixed(1) + " " + this.Y(k * h).toFixed(1); return s; }
  clip(id) { const cp = el("clipPath", { id }, el("defs", {}, this.svg)); el("rect", { x: this.X(this.xr[0]), y: this.Y(this.tmax), width: this.iw, height: this.ih }, cp); return `url(#${id})`; }
}
function shadeImage(board) {                     // where the princess tends to be, as an image
  const nx = Math.min(300, Math.round(board.iw)), nt = Math.min(340, Math.round(board.ih));
  const cv = document.createElement("canvas"); cv.width = nx; cv.height = nt;
  const cx = cv.getContext("2d"), img = cx.createImageData(nx, nt), [r, g, b] = rgb(css("--princess"));
  for (let j = 0; j < nt; j++) {
    const t = (1 - (j + 0.5) / nt) * board.tmax, jj = Math.round(t * FR);
    for (let i = 0; i < nx; i++) {
      const x = -1 + 2 * (i + 0.5) / nx; let k = Math.floor(Math.abs(x) * FR); if ((k + jj) % 2) k -= 1;
      const dens = 0.25 * (Gnode(jj, k + 2) - Gnode(jj, k)) * FR, a = Math.max(0, Math.min(1, (Math.log10(dens + 1e-9) + 1.3) / 2.6)), o = 4 * (j * nx + i);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = Math.round(110 * a);
    }
  }
  cx.putImageData(img, 0, 0); return cv.toDataURL();
}

/* ================================================================ 1. hide from the monster */
(() => {
  const svg = $("hide-board"), H = 1 / (2 * PN), SPEED = 0.32;     // time step of the round; game time per second
  const S = { phase: "ready", x0: 0.35, xs: [0.35], target: 0.35, monster: null, caughtAt: null, demo: null, rounds: [], raf: 0, last: 0, keys: { l: false, r: false } };
  const board = new Board(svg, { tmax: 3, aspect: 1.15, onResize: draw });
  const now = () => (S.xs.length - 1) * H;
  function draw() {
    board.tmax = Math.max(3, Math.ceil((now() + 0.35) * 2) / 2);
    svg.innerHTML = ""; board.frame(el("g", {}, svg));
    const layer = el("g", { "clip-path": board.clip("hide-clip") }, svg), t = now(), xn = S.xs[S.xs.length - 1];
    if (S.phase !== "ready") el("path", { d: board.dSamples(S.xs, H, 0, S.xs.length - 1), class: "trail" }, layer);
    if (S.phase === "running") {
      el("line", { x1: board.X(-1), x2: board.X(1), y1: board.Y(t), y2: board.Y(t), class: "nowline" }, layer);
      if (!S.demo) el("circle", { cx: board.X(S.target), cy: board.Y(t), r: 7, class: "target" }, layer);
    }
    if (S.phase === "caught") {
      el("path", { d: board.d(S.monster.v), class: "mpath ghost" }, layer);
      el("path", { d: board.d(S.monster.v, S.caughtAt), class: "mpath" }, layer);
      const mx = posAt(S.monster.v, S.caughtAt), right = mx > 0.3;
      el("circle", { cx: board.X(mx), cy: board.Y(S.caughtAt), r: 11, class: "meet-ring" }, layer);
      el("circle", { cx: board.X(mx), cy: board.Y(S.caughtAt), r: 5, class: "meet" }, layer);
      el("text", { x: board.X(mx) + (right ? -16 : 16), y: board.Y(S.caughtAt) - 12, class: "label c", "text-anchor": right ? "end" : "start" }, layer).textContent = `caught at t = ${S.caughtAt.toFixed(2)}`;
      const m0 = S.monster.v[0][1]; el("text", { x: board.X(m0) + (m0 > 0.5 ? -8 : 8), y: board.Y(0) - 8, class: "label m", "text-anchor": m0 > 0.5 ? "end" : "start" }, layer).textContent = "the monster";
    }
    if (S.phase === "ready") {
      el("circle", { cx: board.X(S.x0), cy: board.Y(0), r: 12, class: "me-ring" }, svg);
      el("circle", { cx: board.X(S.x0), cy: board.Y(0), r: 7, class: "me" }, svg);
      const lx = Math.max(board.X(-0.8), Math.min(board.X(0.8), board.X(S.x0)));
      el("text", { x: lx, y: board.Y(0) - 20, class: "label p", "text-anchor": "middle" }, svg).textContent = "you start here";
    } else if (S.phase === "running") el("circle", { cx: board.X(xn), cy: board.Y(t), r: 6, class: "me" }, svg);
  }
  function panel() {
    const big = $("hide-big"), least = $("hide-least"), status = $("hide-status"), rd = $("hide-board-readout"), btn = $("hide-start");
    if (S.phase === "ready") { big.textContent = "Ready"; least.textContent = `You start at x = ${S.x0.toFixed(2)}.`; status.textContent = ""; rd.textContent = "ready"; btn.textContent = "Start"; }
    else if (S.phase === "running") { big.textContent = `t = ${now().toFixed(2)}`; least.textContent = S.demo ? "Following a best path." : "Still hidden. Keep moving."; status.textContent = ""; rd.textContent = `t = ${now().toFixed(2)}`; btn.textContent = "Stop"; }
    else {
      big.textContent = `Caught at ${S.caughtAt.toFixed(2)}`; rd.textContent = `caught at ${S.caughtAt.toFixed(2)}`;
      least.textContent = `By a path of the kind “${FAM[S.monster.fam].name.toLowerCase()}”.`;
      status.textContent = S.caughtAt > PB ? "A lucky round: longer than any path's average can be." : "Sooner than the best possible average.";
      btn.textContent = "Play again";
    }
    const n = S.rounds.length;
    $("hide-tally").textContent = n ? `${n} round${n > 1 ? "s" : ""} played; on average they lasted ${(S.rounds.reduce((s, v) => s + v, 0) / n).toFixed(2)}.` : "";
  }
  function showPlan() {
    let ext;
    if (S.demo) { ext = []; for (let k = 0; k * H < 5.5; k++) ext.push(S.demo.sign * demoX(S.demo, k * H)); }      // the whole traced path
    else { ext = S.xs.slice(); const last = ext[ext.length - 1]; while (ext.length * H < 5.5) ext.push(last); }   // after the round you stand still
    const avg = planAverage(ext, H);
    $("hide-plan-big").textContent = f4(avg);
    $("hide-plan-least").textContent = S.demo
      ? `This path was traced by the program behind the ceiling. It averages ${f5(avg)}; no path can do better than ${f5(PB)}.`
      : `Counting the rest of your time as standing still. No path can do better than ${f5(PB)}${PB - avg < 0.003 ? ", and you came close." : "."}`;
    remember("p", S.demo ? "A best path, traced by the program" : `Your round ${S.rounds.length}`, avg);
  }
  function start(demo = null) {
    cancelAnimationFrame(S.raf);
    S.demo = demo; S.monster = sampleMonster(); S.caughtAt = null;
    if (demo) S.x0 = demo.sign * demo.d[0] / (2 * demo.N);
    S.xs = [S.x0]; S.target = S.x0; S.phase = "running"; S.last = 0; $("hide-plan").hidden = true;
    if (Math.abs(posAt(S.monster.v, 0) - S.x0) < 1e-9) { S.caughtAt = 0; finish(); return; }
    draw(); panel(); S.raf = requestAnimationFrame(tick);
  }
  function finish() {
    S.phase = "caught"; S.rounds.push(S.caughtAt); cancelAnimationFrame(S.raf); draw(); panel();
    $("hide-plan").hidden = false; $("hide-plan-big").textContent = "…"; $("hide-plan-least").textContent = "Working out the average over all of his paths.";
    setTimeout(showPlan, 30);
  }
  function tick(ts) {
    if (S.phase !== "running") return;
    const dt = S.last ? Math.min(0.05, (ts - S.last) / 1000) : 0; S.last = ts;
    if (S.keys.l) S.target = Math.max(-1, S.target - 1.2 * dt);
    if (S.keys.r) S.target = Math.min(1, S.target + 1.2 * dt);
    for (let steps = Math.round(dt * SPEED / H); steps > 0; steps--) {
      const k = S.xs.length, t = k * H, x = S.xs[k - 1];
      let nx = S.demo ? S.demo.sign * demoX(S.demo, t) : x + Math.max(-H, Math.min(H, S.target - x));
      nx = Math.max(-1, Math.min(1, nx)); S.xs.push(nx);
      const hit = stepMeet(t - H, x, t, nx, S.monster.v);
      if (hit !== null) { S.caughtAt = hit; finish(); return; }
    }
    draw(); panel(); S.raf = requestAnimationFrame(tick);
  }
  let dragging = false;
  const clampX = (x) => Math.max(-1, Math.min(1, x));
  svg.addEventListener("pointerdown", (e) => { const w = board.toWorld(e); if (S.phase === "ready") { dragging = true; svg.setPointerCapture(e.pointerId); S.x0 = clampX(w.x); draw(); panel(); } else if (S.phase === "running") S.target = clampX(w.x); });
  svg.addEventListener("pointermove", (e) => { const w = board.toWorld(e); if (S.phase === "ready" && dragging) { S.x0 = clampX(w.x); draw(); panel(); } else if (S.phase === "running") S.target = clampX(w.x); });
  svg.addEventListener("pointerup", () => { dragging = false; });
  svg.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (S.phase !== "running") { toReady(); start(); } return; }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault(); const s = e.key === "ArrowLeft" ? -1 : 1;
    if (S.phase === "ready") { S.x0 = clampX(S.x0 + s * (e.shiftKey ? 0.1 : 0.02)); draw(); panel(); }
    else if (S.phase === "running") { if (s < 0) S.keys.l = true; else S.keys.r = true; }
  });
  svg.addEventListener("keyup", (e) => { if (e.key === "ArrowLeft") S.keys.l = false; if (e.key === "ArrowRight") S.keys.r = false; });
  function toReady() { S.phase = "ready"; S.xs = [S.x0]; $("hide-plan").hidden = true; }
  $("hide-start").addEventListener("click", () => {
    if (S.phase === "running") { cancelAnimationFrame(S.raf); toReady(); draw(); panel(); return; }
    toReady(); start(); svg.focus({ preventScroll: true });
  });
  $("hide-demo").addEventListener("click", () => {
    const r = Math.abs(S.x0); let best = DATA.best_responses[0];
    for (const p of DATA.best_responses) if (Math.abs(p.r0 - r) < Math.abs(best.r0 - r)) best = p;
    toReady(); start({ d: best.d, N: best.N, sign: S.x0 < 0 ? -1 : 1 });
  });
  $("hide-best").textContent = f4(PB);
  draw(); panel();
})();

/* ================================================================ 2. catch the princess */
const describeM = (kind, a, b) => kind === "P"
  ? (Math.abs(a - 1) < 1e-9 && Math.abs(b - 1) < 1e-9 ? "Sweep from an end" : `Start ${a.toFixed(2)}, turn at t + x = ${b.toFixed(2)}`)
  : `Start ${a.toFixed(2)}, turns at t + x = ${b.toFixed(2)} and t − x = 1`;
(() => {
  const svg = $("hunt-board"), S = { kind: "P", a: 0.3, b: 1.0, run: null, phase: "ready", tau: 0, hunt: null, shade: false, hunts: [] };
  let shade = "", shadeKey = "", raf = 0;
  const board = new Board(svg, { tmax: 2.5, aspect: 1.1, onResize: () => { shadeKey = ""; draw(); } });
  const verts = () => (S.kind === "P" ? Ppath(S.a, S.b) : Tpath(S.a, S.b));
  function clampAB() {
    if (S.kind === "P") { S.a = Math.max(-1, Math.min(1, S.a)); S.b = Math.max(Math.abs(S.a), Math.min(2 - S.a, S.b)); }
    else { S.a = Math.max(-0.95, Math.min(0.95, S.a)); S.b = Math.max(Math.abs(S.a), Math.min(1, S.b)); }
  }
  function knob(name, cx, cy) { const k = el("g", { class: "handle", "data-k": name }, svg); el("circle", { cx, cy, r: 18, class: "hit" }, k); el("circle", { cx, cy, r: 8, class: "knob" }, k); }
  function draw() {
    const end = S.hunt && S.phase !== "ready" ? S.hunt.tc : 0;
    board.tmax = Math.max(2.5, Math.ceil((end + 0.4) * 2) / 2);
    svg.innerHTML = ""; board.frame(el("g", {}, svg));
    if (S.shade) { const key = board.w + "|" + board.tmax + css("--princess"); if (key !== shadeKey) { shade = shadeImage(board); shadeKey = key; } el("image", { href: shade, x: board.X(-1), y: board.Y(board.tmax), width: board.iw, height: board.ih, preserveAspectRatio: "none" }, svg); }
    const layer = el("g", { "clip-path": board.clip("hunt-clip") }, svg), v = verts();
    if (S.kind === "T") el("path", { d: `M${board.X(-1)} ${board.Y(0)}L${board.X(1)} ${board.Y(2)}`, class: "sweepline" }, layer);
    if (S.phase === "ready") el("path", { d: board.d(v), class: "mpath" }, layer);
    else {
      const tau = S.phase === "running" ? S.tau : S.hunt.tc;
      el("path", { d: board.d(v), class: "mpath ghost" }, layer);
      el("path", { d: board.d(v, tau), class: "mpath" }, layer);
      if (S.phase === "running") el("circle", { cx: board.X(posAt(v, tau)), cy: board.Y(tau), r: 6, class: "mdot" }, layer);
      else {
        const { q, s, tc } = S.hunt, kc = Math.min(NT - 1, Math.round(tc / RDT));
        el("path", { d: board.dSamples(RAD[q], RDT, 0, kc, s), class: "trail" }, layer);
        const px = s * radAt(q, tc), right = px > 0.3;
        el("circle", { cx: board.X(px), cy: board.Y(tc), r: 11, class: "meet-ring" }, layer);
        el("circle", { cx: board.X(px), cy: board.Y(tc), r: 5, class: "meet" }, layer);
        el("text", { x: board.X(px) + (right ? -16 : 16), y: board.Y(tc) - 12, class: "label c", "text-anchor": right ? "end" : "start" }, layer).textContent = `caught at t = ${tc.toFixed(2)}`;
        const x0 = s * RAD[q][0]; el("text", { x: board.X(x0), y: board.Y(0) - 10, class: "label p", "text-anchor": x0 > 0.6 ? "end" : x0 < -0.6 ? "start" : "middle" }, layer).textContent = "she started here";
      }
    }
    if (S.phase !== "running") {
      const corner = S.b > S.a + 1e-9 ? v[1] : v[0];
      knob("start", board.X(S.a), board.Y(0)); knob("turn", board.X(corner[1]), board.Y(corner[0]));
    }
  }
  function panel() {
    const c = S.run.cost, gap = c - BEST_COST, st = $("hunt-status");
    $("hunt-avg").textContent = f4(c);
    $("hunt-avg-least").textContent = `The fastest path we know takes ${f4(BEST_COST)}: start at −0.89 and turn at t + x = 1.`;
    if (gap < 3e-5) { st.textContent = "As fast as any path we know."; st.className = "status good"; }
    else if (gap < 1e-3) { st.textContent = `Only ${gap.toFixed(4)} slower than the fastest. Her plan makes many paths almost equally good.`; st.className = "status good"; }
    else { st.textContent = `${gap.toFixed(3)} slower than the fastest.`; st.className = "status"; }
    if (S.phase === "caught") { $("hunt-big").textContent = `Caught at ${S.hunt.tc.toFixed(2)}`; $("hunt-least").textContent = `She started at x = ${(S.hunt.s * RAD[S.hunt.q][0]).toFixed(2)}.`; $("hunt-board-readout").textContent = `caught at ${S.hunt.tc.toFixed(2)}`; }
    else if (S.phase === "running") { $("hunt-big").textContent = `t = ${S.tau.toFixed(2)}`; $("hunt-least").textContent = "Hunting."; $("hunt-board-readout").textContent = `t = ${S.tau.toFixed(2)}`; }
    else { $("hunt-big").textContent = "Ready"; $("hunt-least").textContent = "Choose a path, then press Hunt."; $("hunt-board-readout").textContent = f4(c); }
    const n = S.hunts.length;
    $("hunt-tally").textContent = n ? `${n} hunt${n > 1 ? "s" : ""} with this path; on average she was caught at ${(S.hunts.reduce((a, b) => a + b, 0) / n).toFixed(2)}.` : "";
    $("hunt-two").setAttribute("aria-pressed", String(S.kind === "T"));
    $("hunt-shade").setAttribute("aria-pressed", String(S.shade));
  }
  function triedList() {
    const list = TRIED.m.slice(-6).reverse();
    $("hunt-tried").innerHTML = list.map((e) => `<li><span>${e.name}</span><span>${f4(e.v)}</span></li>`).join("");
    $("hunt-tried-note").hidden = list.length > 0;
  }
  function changed() { cancelAnimationFrame(raf); clampAB(); S.run = latticeRun(S.kind, S.a, S.b); S.phase = "ready"; S.hunt = null; S.hunts = []; draw(); panel(); }
  function pickHunt() { const q = Math.floor(Math.random() * NQ), s = Math.random() < 0.5 ? 1 : -1; return { q, s, tc: caughtAt(S.run, 0.5 * (1 + s * RK.q[q])) }; }
  function record() { remember("m", describeM(S.kind, S.a, S.b), S.run.cost); triedList(); }
  function hunt() {
    cancelAnimationFrame(raf); S.hunt = pickHunt(); record();
    if (reduced()) { S.phase = "caught"; S.hunts.push(S.hunt.tc); draw(); panel(); return; }
    S.phase = "running"; S.tau = 0; let last = 0;
    const step = (ts) => { const dt = last ? (ts - last) / 1000 : 0; last = ts; S.tau = Math.min(S.hunt.tc, S.tau + 0.9 * dt); if (S.tau >= S.hunt.tc) { S.phase = "caught"; S.hunts.push(S.hunt.tc); draw(); panel(); return; } draw(); panel(); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  $("hunt-go").addEventListener("click", hunt);
  $("hunt-ten").addEventListener("click", () => { cancelAnimationFrame(raf); for (let i = 0; i < 10; i++) { S.hunt = pickHunt(); S.hunts.push(S.hunt.tc); } record(); S.phase = "caught"; draw(); panel(); });
  let drag = null;
  svg.addEventListener("pointerdown", (e) => { const h = e.target.closest(".handle"); if (!h) return; drag = h.dataset.k; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return; const w = board.toWorld(e);
    if (drag === "start") S.a = Math.max(-1, Math.min(1, w.x)); else S.b = S.a + 2 * Math.max(0, ((w.x - S.a) + w.t) / 2);
    S.a = Math.round(S.a * 512) / 512; S.b = Math.round(S.b * 512) / 512; changed();
  });
  svg.addEventListener("pointerup", () => { drag = null; });
  svg.addEventListener("keydown", (e) => {
    const step = (e.shiftKey ? 32 : 4) / 512;
    if (e.key === "ArrowLeft") S.a -= step; else if (e.key === "ArrowRight") S.a += step; else if (e.key === "ArrowUp") S.b += step; else if (e.key === "ArrowDown") S.b -= step;
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); hunt(); return; } else return;
    e.preventDefault(); changed();
  });
  for (const [name, kind, a, b] of [["Sweep", "P", 1, 1], ["Fastest known", "P", -0.890625, 1], ["Turn early", "P", 0, 0.5], ["Two turns", "T", 0.25, 0.921875]]) {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "small"; btn.textContent = name; btn.addEventListener("click", () => { Object.assign(S, { kind, a, b }); changed(); }); $("hunt-presets").append(btn);
  }
  $("hunt-two").addEventListener("click", () => { S.kind = S.kind === "P" ? "T" : "P"; if (S.kind === "T") { S.a = Math.max(-0.5, Math.min(0.5, S.a)); S.b = Math.min(S.b, 0.92); } changed(); });
  $("hunt-shade").addEventListener("click", () => { S.shade = !S.shade; draw(); panel(); });
  $("hunt-best-inline").textContent = f4(BEST_COST);
  changed(); triedList();
})();

/* ================================================================ 3. the monster's plan, one side */
(() => {
  const svg = $("mplan-board"); let pick = null, drawn = [], anim = 0;
  const board = new Board(svg, { tmax: 4, aspect: 1.25, onResize: draw });
  const maxM = Math.max(...LAW.records.map((r) => r[r.length - 1]));
  function draw() {
    svg.innerHTML = ""; board.frame(el("g", {}, svg));
    const layer = el("g", { "clip-path": board.clip("mplan-clip") }, svg);
    for (const r of LAW.records) {
      const f = KIND_FAM[r[0]]; if (pick && pick !== f) continue;
      const op = Math.min(0.9, (0.1 + 0.55 * Math.sqrt(r[r.length - 1] / maxM)) * (pick ? 1.5 : 1));
      el("path", { d: board.d(recPath(r)), class: "cloud", style: `stroke:var(${FAM[f].c});opacity:${op}` }, layer);
    }
    if (!pick || pick === "sweep") el("path", { d: board.d(Ppath(1, 1)), class: "cloud", style: `stroke:var(${FAM.sweep.c});opacity:0.85;stroke-width:2.6` }, layer);
    for (const p of drawn) el("path", { d: board.d(p.v, p.upto), class: "cloud drawn", style: `stroke:var(${FAM[p.fam].c})` }, layer);
  }
  function key() {
    const ul = $("mplan-key"); ul.innerHTML = "";
    for (const f of FAM_ORDER) {
      const li = document.createElement("li"), b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-pressed", String(pick === f));
      b.innerHTML = `<span class="sw" style="--c:var(${FAM[f].c})"></span><span>${FAM[f].name}</span><span class="v">${(100 * famMass[f]).toFixed(1)} %</span>`;
      b.addEventListener("click", () => { pick = pick === f ? null : f; key(); draw(); });
      li.append(b); ul.append(li);
    }
    $("mplan-desc").textContent = pick ? FAM[pick].desc : "Pick a kind to see only those paths and what they are for.";
  }
  function drawOne(animate) {
    let s; do { s = sampleMonster(true); } while (pick && s.fam !== pick);
    for (const p of drawn) p.upto = Infinity;
    const end = s.v[s.v.length - 1][0], item = { v: s.v, fam: s.fam, upto: animate && !reduced() ? 0 : Infinity };
    drawn.push(item); if (drawn.length > 40) drawn.shift();
    $("mplan-last").textContent = `Drawn: ${FAM[s.fam].name.toLowerCase()}, starting at x = ${s.v[0][1].toFixed(2)}.`;
    if (item.upto === 0) { cancelAnimationFrame(anim); let last = 0; const go = (ts) => { const dt = last ? (ts - last) / 1000 : 0; last = ts; item.upto += 2.2 * dt; draw(); if (item.upto < end) anim = requestAnimationFrame(go); else { item.upto = Infinity; draw(); } }; anim = requestAnimationFrame(go); }
  }
  $("mplan-draw").addEventListener("click", () => drawOne(true));
  $("mplan-many").addEventListener("click", () => { cancelAnimationFrame(anim); for (let i = 0; i < 25; i++) drawOne(false); draw(); $("mplan-last").textContent = "Drew 25 paths. About fifteen of them are the sweep, drawn on top of each other."; });
  $("mplan-clear").addEventListener("click", () => { cancelAnimationFrame(anim); drawn = []; $("mplan-last").textContent = ""; draw(); });
  key(); draw();
})();

/* ================================================================ 4. the princess's plan, one side */
(() => {
  const GROUPS = [
    { id: "wait", name: "Wait at the centre", c: "--g1", desc: "Run to the centre and wait there until time 1, when the two sweeps meet in the middle, then run back out." },
    { id: "pass", name: "Pass close to the centre", c: "--g2", desc: "Come within a few hundredths of the centre just before time 1, then run back out." },
    { id: "turn", name: "Turn back on the way in", c: "--g3", desc: "Run in, then turn back somewhere between a tenth and a half of the way from the centre." },
    { id: "stay", name: "Stay near the end", c: "--g4", desc: "Make only a short trip inward from the end, then return." },
  ];
  const group = RAD.map((r) => { let mn = 1, wait = false; for (let k = 0; k < NT; k++) { mn = Math.min(mn, r[k]); if (r[k] < 0.004) wait = true; } return wait ? "wait" : mn < 0.06 ? "pass" : mn < 0.5 ? "turn" : "stay"; });
  const colour = (q) => `var(${GROUPS.find((g) => g.id === group[q]).c})`;
  const svg = $("pplan-board"), strip = $("pplan-strip"), clock = $("pplan-clock");
  const board = new Board(svg, { tmax: 2.2, aspect: 1.0, xr: [0, 1], onResize: draw });
  let pick = null, playing = false, raf = 0;
  function draw() {
    const t = parseFloat(clock.value), kmax = Math.min(NT - 1, Math.round(board.tmax / RDT));
    svg.innerHTML = ""; board.frame(el("g", {}, svg), "distance from the centre");
    const layer = el("g", { "clip-path": board.clip("pplan-clip") }, svg);
    el("path", { d: `M${board.X(1)} ${board.Y(0)}L${board.X(0)} ${board.Y(1)}L${board.X(1)} ${board.Y(2)}`, class: "sweepline" }, layer);
    el("text", { x: board.X(0.62), y: board.Y(0.43), class: "label soft" }, layer).textContent = "sweep from this end";
    el("text", { x: board.X(0.36), y: board.Y(1.5), class: "label soft" }, layer).textContent = "sweep from the other end";
    for (let q = 0; q < NQ; q++) el("path", { d: board.dSamples(RAD[q], RDT, 0, kmax), class: "route" + (pick ? (group[q] === pick ? " on" : " dim") : ""), style: `stroke:${colour(q)}` }, layer);
    el("line", { x1: board.X(0), x2: board.X(1), y1: board.Y(t), y2: board.Y(t), class: "nowline" }, layer);
    for (let q = 0; q < NQ; q++) if (!pick || group[q] === pick) el("circle", { cx: board.X(radAt(q, t)), cy: board.Y(t), r: 3.4, class: "rdot", style: `fill:${colour(q)}` }, layer);
    drawStrip(t);
  }
  function drawStrip(t) {
    const W = board.w, H = 80, X = (x) => board.X(x);
    strip.setAttribute("viewBox", `0 0 ${W} ${H}`); strip.style.aspectRatio = `${W} / ${H}`; strip.innerHTML = "";
    el("line", { x1: X(0), x2: X(1), y1: 52, y2: 52, class: "strip-axis" }, strip);
    for (const x of [0, 0.5, 1]) el("text", { x: X(x), y: 74, class: "tick mid" }, strip).textContent = String(x);
    el("text", { x: X(0), y: 15, class: "axis-name" }, strip).textContent = `the corridor at t = ${t.toFixed(2)}, one side: a dot for each route`;
    const xs = RAD.map((_, q) => radAt(q, t)), rows = new Map();
    for (let q = 0; q < NQ; q++) {
      if (pick && group[q] !== pick) continue;
      const key = Math.round(xs[q] * 120), n = rows.get(key) || 0; rows.set(key, n + 1);
      el("circle", { cx: X(xs[q]), cy: 46 - 6 * (n % 4), r: 3.4, class: "rdot", style: `fill:${colour(q)}` }, strip);
    }
    const sweeps = []; if (t <= 1) sweeps.push(1 - t); if (t >= 1 && t <= 2) sweeps.push(t - 1);
    for (const x of sweeps) el("path", { d: `M${X(x)} 54 l-6 10 h12 z`, style: "fill:var(--monster)" }, strip);
    const near = xs.filter((x) => x < 0.05).length;
    $("pplan-now").textContent = `At t = ${t.toFixed(2)}, ${Math.round(100 * near / NQ)} % of her routes are within 0.05 of the centre.` + (sweeps.length ? " The red marker is a sweep." : "");
    $("pplan-clock-out").textContent = t.toFixed(2);
  }
  function key() {
    const ul = $("pplan-key"); ul.innerHTML = "";
    for (const g of GROUPS) {
      const share = group.filter((x) => x === g.id).length / NQ;
      const li = document.createElement("li"), b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-pressed", String(pick === g.id));
      b.innerHTML = `<span class="sw" style="--c:var(${g.c})"></span><span>${g.name}</span><span class="v">${Math.round(100 * share)} %</span>`;
      b.addEventListener("click", () => { pick = pick === g.id ? null : g.id; key(); draw(); });
      li.append(b); ul.append(li);
    }
    $("pplan-desc").textContent = pick ? GROUPS.find((g) => g.id === pick).desc : "Pick a kind to see only those routes.";
  }
  clock.addEventListener("input", draw);
  const play = $("pplan-play");
  play.addEventListener("click", () => {
    if (playing) { playing = false; play.textContent = "Run the clock"; return; }
    if (reduced()) { clock.value = 2.2; draw(); return; }
    if (parseFloat(clock.value) >= 2.19) clock.value = 0;
    playing = true; play.textContent = "Pause"; let last = 0;
    const step = (ts) => { if (!playing) return; const dt = last ? (ts - last) / 1000 : 0; last = ts; const v = Math.min(2.2, parseFloat(clock.value) + 0.35 * dt); clock.value = v; draw(); if (v >= 2.2) { playing = false; play.textContent = "Run the clock"; return; } raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  });
  key(); draw();
})();

/* ================================================================ 5. squeezing the answer */
(() => {
  const H = 1 / (2 * PN), lo = 1.4205, hi = 1.4255, X = (v) => 80 + (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo) * 840;
  const still = (x) => [x];
  const runInWaitOut = () => { const xs = []; for (let k = 0; k * H < 5.5; k++) { const t = k * H; xs.push(t < 0.5 ? 0.5 - t : t < 1 ? 0 : Math.min(1, t - 1)); } return xs; };
  const PRESETS_P = [["Stand still at the centre", () => still(0)], ["Stand still near an end, at 0.9", () => still(0.9)], ["Run to the centre, wait, leave at time 1", runInWaitOut]];
  const PRESETS_M = [["Sweep from an end", "P", 1, 1], ["Fastest known: start −0.89, turn at t + x = 1", "P", -0.890625, 1], ["Two turns", "T", 0.25, 0.921875], ["Near end first, from 0.3", "P", 0.3, 1.7], ["Turn early, at t + x = 0.5", "P", 0, 0.5]];
  const base = { p: [], m: PRESETS_M.map(([name, kind, a, b]) => ({ name, v: latticeRun(kind, a, b).cost })) };
  let pending = PRESETS_P.length + 1;
  function draw() {
    const svg = $("squeeze-line"), all = { p: base.p.concat(TRIED.p), m: base.m.concat(TRIED.m) };
    let s = `<rect x="${X(B.lower_dec)}" y="22" width="${X(B.upper_dec) - X(B.lower_dec)}" height="190" class="bandr"/>`;
    s += `<line x1="${X(lo)}" x2="${X(hi)}" y1="117" y2="117" class="axisl"/>`;
    for (let i = 0; i <= 5; i++) { const v = lo + 0.001 * i; if (Math.min(Math.abs(X(v) - X(B.lower_dec)), Math.abs(X(v) - X(B.upper_dec))) < 24) continue; s += `<line x1="${X(v)}" x2="${X(v)}" y1="112" y2="122" class="axisl"/><text x="${X(v)}" y="138" class="t">${v.toFixed(4)}</text>`; }
    s += `<line x1="${X(B.lower_dec)}" x2="${X(B.lower_dec)}" y1="22" y2="212" class="floor"/><line x1="${X(B.upper_dec)}" x2="${X(B.upper_dec)}" y1="22" y2="212" class="ceil"/>`;
    s += `<text x="${X(B.lower_dec) - 8}" y="16" class="lab p" text-anchor="end">her floor ${f5(B.lower_dec)}</text><text x="${X(B.upper_dec) + 8}" y="16" class="lab m">his ceiling ${f5(B.upper_dec)}</text>`;
    s += `<text x="${(X(B.lower_dec) + X(B.upper_dec)) / 2}" y="232" class="lab g" text-anchor="middle">the answer is in here</text>`;
    s += `<text x="8" y="26" class="side">princess paths ↑</text><text x="8" y="226" class="side">monster paths ↓</text>`;
    const place = (list, cls, y0, dir) => {
      const used = [];
      list.forEach((e, i) => {
        const x = X(e.v); let lvl = 0; while (used.some((u) => u.l === lvl && Math.abs(u.x - x) < 13)) lvl++; used.push({ x, l: lvl });
        const y = y0 + dir * 14 * (lvl % 5), col = cls === "dp" ? "--princess" : "--monster";
        if (e.v < lo) s += `<text x="${X(lo) - 10}" y="${y + 4}" class="off" text-anchor="end" style="fill:var(${col})">${e.v.toFixed(2)} ←</text>`;
        if (e.v > hi) s += `<text x="${X(hi) + 10}" y="${y + 4}" class="off" style="fill:var(${col})">→ ${e.v.toFixed(2)}</text>`;
        s += `<circle id="sq-${cls}-${i}" cx="${x}" cy="${y}" r="6" class="${cls}${e.you ? " you" : ""}"/>`;
      });
    };
    place(all.p, "dp", 98, -1); place(all.m, "dm", 156, 1);
    svg.innerHTML = s;
    const row = (cls, c, e, i) => `<li tabindex="0" data-dot="sq-${cls}-${i}"><span class="dot${e.you ? " you" : ""}" style="--c:var(${c})"></span><span>${e.name}${e.you ? " (you)" : ""}</span><span class="v">${f4(e.v)}</span></li>`;
    const ranked = (list, desc) => list.map((e, i) => [e, i]).sort((a, b) => (desc ? b[0].v - a[0].v : a[0].v - b[0].v));
    $("squeeze-p").innerHTML = ranked(all.p, true).map(([e, i]) => row("dp", "--princess", e, i)).join("") + (pending > 0 ? `<li class="wait"><span></span><span>Working out a few more…</span><span></span></li>` : "");
    $("squeeze-m").innerHTML = ranked(all.m, false).map(([e, i]) => row("dm", "--monster", e, i)).join("");
    for (const li of document.querySelectorAll(".lists li[data-dot]")) {
      const on = () => { const d = document.getElementById(li.dataset.dot); if (d) d.classList.add("hl"); };
      const off = () => { const d = document.getElementById(li.dataset.dot); if (d) d.classList.remove("hl"); };
      li.addEventListener("mouseenter", on); li.addEventListener("mouseleave", off); li.addEventListener("focus", on); li.addEventListener("blur", off);
    }
  }
  refreshSqueeze = draw;
  const facts = [
    ["--princess", `<strong>Her floor, ${f5(B.lower_dec)}.</strong> Her plan, refined, proves that no monster can be sure of catching her faster than this on average. Two separate programs agree on it; a third, independent check has not been finished.`],
    ["--monster", `<strong>His ceiling, ${f5(B.upper_dec)}.</strong> His plan, on a fine grid, proves that no princess can be sure of hiding longer than this on average. The proof is written out and the computation is exact, done by two separate programs, but no one else has checked it yet.`],
    ["--ink-3", `On this page his plan is placed on a coarser grid, so that your averages can be worked out in the browser; there its ceiling is ${f5(PB)}. Her plan is used on the grid of its proof, where the fastest path we know takes ${f5(BEST_COST)}.`],
    ["--ink", `Before this research the answer was known to be between ${f5(B.lower_old_dec)} and ${f5(B.upper_old_dec)}. Better plans on finer grids suggest it is about 1.4240, close to his ceiling. That is a guess, not a proof.`],
  ];
  $("squeeze-facts").innerHTML = facts.map(([c, t]) => `<li style="--c:var(${c})">${t}</li>`).join("");
  draw();
  // the princess presets need the average over all of his paths: work them out one at a time once the part is near
  let started = false;
  const work = () => {
    if (started) return; started = true;
    const jobs = PRESETS_P.map(([name, f]) => () => base.p.push({ name, v: planAverage(f(), H) }));
    jobs.push(() => {
      const p = DATA.best_responses.reduce((a, b) => (Math.abs(b.r0 - 0.6) < Math.abs(a.r0 - 0.6) ? b : a)), xs = [];
      for (let k = 0; k * H < 5.5; k++) xs.push(demoX(p, k * H));
      base.p.push({ name: "A best path, traced by the program", v: planAverage(xs, H) });
    });
    const next = () => { const job = jobs.shift(); if (!job) return; job(); pending--; draw(); setTimeout(next, 20); };
    setTimeout(next, 20);
  };
  if ("IntersectionObserver" in window) { const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); work(); } }, { rootMargin: "600px" }); io.observe($("squeeze")); } else work();
})();

$("lede-lo").textContent = f5(B.lower_dec); $("lede-hi").textContent = f5(B.upper_dec);
})();
