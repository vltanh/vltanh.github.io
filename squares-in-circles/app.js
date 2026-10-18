import { CASES, corners, enclosingCircle, hull, inDisk, isPacking, moveSquare, turnSquare, reach, scatter, slideArea, normalTurn, turnDegrees } from './packings.js';

const NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;
const QUARTER = Math.PI / 2;
const $ = (id) => document.getElementById(id);

function make(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

const NAMES = ['', 'One square', 'Two squares', 'Three squares', 'Four squares', 'Five squares', 'Six squares', 'Seven squares', 'Eight squares'];

const EXACT = ['', '√2/2', '√5/2', '5√17/16', '√2', '√(5/2)', '√<i>q</i><sub>6</sub>', '√13/2', '√<i>q</i><sub>8</sub>'];

const NOTES = [
  '',
  'One square fits only when it is centred, with all four corners on the circle. Turning it about the centre keeps the circle; moving it does not.',
  'Two squares side by side. The centre of the circle is the midpoint of the edge they share.',
  'The T: two squares side by side and a third on top, centred between them.',
  'The 2×2 block. The centre of the circle is the corner that all four squares share.',
  'The plus: one square on the centre of the circle and the other four against its sides.',
  'Five squares share one orientation and the sixth is turned by 45°. The radius is √<i>q</i><sub>6</sub>, where <i>q</i><sub>6</sub> ≈ 2.8512 is a root of a quartic, and the packing is still the only optimal one.',
  'Two columns of two, with a column of three between them. The three middle squares slide up and down, and the circle stays the same while each of them stays within √3 − 1/2 ≈ 1.232 of the centre.',
  'Five squares touch the circle with one corner each. <i>T</i> slides between <i>D</i> and <i>B</i>, <i>G</i> slides along <i>H</i>, and <i>K</i> moves and turns in the room the others leave, from about 4° to 79°. That makes five parameters, and the mirror images are optimal too. The radius has no closed form: its square <i>q</i><sub>8</sub> ≈ 3.9155 solves a system of three equations.',
];

// How the two radii without a simple closed form are found, in the terms of
// SquaresInCircles/Geometry.lean.
const MORE = {
  6: {
    title: 'How <i>R</i><sub>6</sub> is found',
    body: `<p>Put the central square at <span class="nw">(<i>s</i>, <i>s</i>)</span>, its neighbours above and to the right at <span class="nw">(<i>s</i>, <i>s</i> + 1)</span> and <span class="nw">(<i>s</i> + 1, <i>s</i>)</span>, those to the left and below at <span class="nw">(<i>s</i> − 1, <i>t</i>)</span> and <span class="nw">(<i>t</i>, <i>s</i> − 1)</span>, and the turned square at <span class="nw">(−<i>d</i>, −<i>d</i>)</span>. The circle about the origin passes through six points: the outer corners <span class="nw">(<i>s</i> + 1/2, <i>s</i> + 3/2)</span> and <span class="nw">(<i>s</i> − 3/2, <i>t</i> + 1/2)</span>, their mirror images in the diagonal, and the two outer vertices <span class="nw">(−<i>d</i> − <i>h</i>, −<i>d</i>)</span> and <span class="nw">(−<i>d</i>, −<i>d</i> − <i>h</i>)</span> of the turned square, where <span class="nw"><i>h</i> = √2/2</span>. The turned square touches the squares to its left and below it, so <span class="nw"><i>d</i> = 1/2 + <i>h</i> − <i>t</i></span>. With <i>q</i> the square of the radius,</p>
<p class="eq"><i>q</i> = <span class="nw">(<i>s</i> + 1/2)²</span> + <span class="nw">(<i>s</i> + 3/2)²</span><br><i>q</i> = <span class="nw">(<i>s</i> − 3/2)²</span> + <span class="nw">(<i>t</i> + 1/2)²</span><br><i>q</i> = <span class="nw">(<i>d</i> + <i>h</i>)²</span> + <i>d</i>².</p>
<p>Taking <i>q</i> out, the squares of <i>t</i> cancel, and <span class="nw"><i>t</i> = (30<i>h</i> − 20)<i>s</i></span> + <span class="nw">7/2 − 9<i>h</i>/2</span>. Then <i>s</i> is the smaller root of <span class="nw"><i>s</i>² − <i>As</i> + <i>B</i> = 0</span>, with <span class="nw"><i>A</i> = (1466 + 1940<i>h</i>)/267</span> and <span class="nw"><i>B</i> = (327 + 432<i>h</i>)/712</span>. So <span class="nw"><i>s</i> ≈ 0.084246</span>, <span class="nw"><i>t</i> ≈ 0.420227</span>, and <span class="nw"><i>q</i><sub>6</sub> = 2<i>s</i>² + 4<i>s</i> + 5/2 ≈ 2.851177</span>, a root of a quartic with integer coefficients: <span class="nw"><i>R</i><sub>6</sub> = √<i>q</i><sub>6</sub> ≈ 1.688543</span>.</p>`,
  },
  8: {
    title: 'How <i>R</i><sub>8</sub> is found',
    body: `<p>Take a circle of squared radius <i>q</i> about the origin. Put the lower right corner of <i>A</i> on it at height <i>y</i>, and stand <i>B</i> on <i>A</i> with its upper right corner on the circle. Stand <i>D</i> on <i>E</i>, one square's width to the left of <i>B</i> so that <i>T</i> fits between them, with the upper left corner of <i>D</i> and the lower left corner of <i>E</i> on the circle. Turn <i>H</i> and <i>G</i> by an angle <i>t</i>, with <i>H</i> touching <i>E</i>, and <i>G</i> beside <i>H</i> touching <i>A</i>. Then <i>q</i>, <i>y</i> and <i>t</i> fix <i>A</i>, <i>B</i>, <i>D</i>, <i>E</i> and <i>H</i>, and the corner <i>P</i> of <i>H</i> farthest from the centre sticks out of the circle by</p>
<p class="eq"><i>F</i><span class="nw">(<i>q</i>, <i>y</i>, <i>t</i>)</span> = |<i>P</i>|² − <i>q</i>.</p>
<p>The least radius is the least <i>q</i> for which some <i>y</i> and <i>t</i> make <i>F</i> = 0. There <i>F</i> is also stationary, so</p>
<p class="eq"><i>F</i> = ∂<i>F</i>/∂<i>y</i> = ∂<i>F</i>/∂<i>t</i> = 0,</p>
<p>three equations in <i>q</i>, <i>y</i> and <i>t</i> with exactly one solution in the range that matters, which the Lean statement takes as its definition of <i>q</i><sub>8</sub>. Solved numerically, <span class="nw"><i>q</i><sub>8</sub> ≈ 3.915534</span>, at <span class="nw"><i>y</i> ≈ −0.92066</span> and <span class="nw"><i>t</i> ≈ 7.0839°</span>: <span class="nw"><i>R</i><sub>8</sub> = √<i>q</i><sub>8</sub> ≈ 1.978771</span>.</p>`,
  },
};

const MODE_NOTES = {
  free: 'Every square moves, and the circle grows to hold them.',
  optimal: 'Only the squares that move in an optimal packing move, and only as far as it stays optimal. The faded squares are fixed.',
};

const board = $('board');
const layer = {
  grid: board.querySelector('.grid'),
  excess: board.querySelector('.excess'),
  minimum: board.querySelector('.minimum'),
  tracks: board.querySelector('.tracks'),
  squares: board.querySelector('.squares'),
  live: board.querySelector('.live'),
  marks: board.querySelector('.marks'),
  handle: board.querySelector('.handle'),
  stem: board.querySelector('.handle line'),
  knob: board.querySelector('.knob'),
};

let n = 8;
let mode = 'free';
let squares = [];
let shapes = [];
let sel = null;
let fam = null; // the parameters, while the squares form a packing of the family
let half = 3; // half the side of the board, in units
let size = 600; // the side of the board, in pixels
let drag = null;
let handleAxis = 0;
let blockedTimer = 0;
let anim = null; // the state of the animation while it runs
let glide = null; // the squares on their way back to the optimal packing
const sliders = {};

const unit = () => size / (2 * half);
const X = (x) => size / 2 + x * unit();
const Y = (y) => size / 2 - y * unit();
const bound = () => half - 0.04;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const family = () => CASES[n].family;
const optimal = () => mode === 'optimal';
const limit = () => (optimal() ? CASES[n].R : Infinity);
const place = (s) => ({ x: s.x, y: s.y, a: s.a });

// How square i may move: in the free mode anywhere, in the optimal mode as
// the family allows (see `mover` in packings.js).
const moverOf = (i) => (family() && fam ? family().mover(squares, i, fam) : null);
const movable = (i) => !optimal() || moverOf(i) !== null;
const turnable = (i) => !optimal() || Boolean(moverOf(i) && moverOf(i).free);

function toWorld(e) {
  const r = board.getBoundingClientRect();
  const k = r.width / (2 * half);
  return { x: (e.clientX - r.left - r.width / 2) / k, y: (r.top + r.height / 2 - e.clientY) / k };
}

// ------------------------------------------------------------------ drawing

function drawGrid() {
  layer.grid.replaceChildren();
  const m = Math.floor(2 * half);
  for (let j = -m; j <= m; j++) {
    const v = j / 2;
    const cls = j === 0 ? 'axis' : j % 2 === 0 ? 'major' : 'minor';
    make('line', { x1: X(v), y1: 0, x2: X(v), y2: size, class: cls }, layer.grid);
    make('line', { x1: 0, y1: Y(v), x2: size, y2: Y(v), class: cls }, layer.grid);
  }
}

function buildShapes(animate) {
  layer.squares.replaceChildren();
  shapes = squares.map((s, i) => {
    const g = make('g', { class: `sq c${s.label === 'K' ? 'k' : s.k}${animate ? ' enter' : ''}`, style: `--i:${i}` }, layer.squares);
    const poly = make('polygon', {}, g);
    poly.dataset.i = i;
    let text = null;
    if (s.label) {
      text = make('text', { class: 'label' }, g);
      text.textContent = s.label;
    }
    return { g, poly, text };
  });
}

const points = (pts) => pts.map(([x, y]) => `${X(x).toFixed(2)},${Y(y).toFixed(2)}`).join(' ');

function ring(cx, cy, r1, r2) {
  const circle = (r) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  return `${circle(r1)} ${circle(r2)}`;
}

// The region the central square of eight covers sliding without turning,
// which depends on its turn and on the other squares only.
const room = { key: '', loops: [] };

function roomOf(i) {
  const key = squares.map((s, j) => (j === i ? s.a.toFixed(9) : `${s.x.toFixed(9)} ${s.y.toFixed(9)} ${s.a.toFixed(9)}`)).join('|');
  if (key !== room.key) {
    room.key = key;
    room.loops = slideArea(squares, i);
  }
  return room.loops;
}

// In the optimal mode, each square that can move shows the region it can
// cover by sliding with the others held: a sliding square the band it slides
// in, the central square of eight the room it has at its present turn.
function drawTracks() {
  layer.tracks.replaceChildren();
  const f = family();
  if (!optimal() || !f || !fam || glide) return;
  squares.forEach((s, i) => {
    const m = f.mover(squares, i, fam);
    if (!m) return;
    if (m.free) {
      const d = roomOf(i)
        .map((loop) => `M ${points(loop).replaceAll(' ', ' L ')} Z`)
        .join(' ');
      const g = make('g', { class: `track c${s.label === 'K' ? 'k' : s.k}` }, layer.tracks);
      make('path', { d, 'fill-rule': 'evenodd' }, g);
      return;
    }
    const range = sliders[m.key] ? sliders[m.key].range : null;
    if (!range || range.hi - range.lo < 1e-6) return;
    const ends = [range.lo, range.hi].map((v) => f.build({ ...fam, [m.key]: v })[m.index]);
    const g = make('g', { class: `track c${s.k}` }, layer.tracks);
    make('polygon', { points: points(hull([...corners(ends[0]), ...corners(ends[1])])) }, g);
  });
}

function render() {
  const k = unit();
  squares.forEach((s, i) => {
    const { g, poly, text } = shapes[i];
    poly.setAttribute('points', points(corners(s)));
    poly.classList.toggle('selected', i === sel);
    g.classList.toggle('locked', !movable(i));
    if (text) {
      text.setAttribute('x', X(s.x).toFixed(2));
      text.setAttribute('y', Y(s.y).toFixed(2));
      text.setAttribute('font-size', (0.36 * k).toFixed(1));
    }
  });
  drawTracks();
  // Squares gliding home may pass through each other, and overlapping squares
  // are no packing: the circle and the radius then stay as they were.
  if (!glide || isPacking(squares)) drawCircle();

  // The knob turns the selected square; it sits on the side that faces up.
  const knob = sel !== null && turnable(sel);
  if (knob) {
    const s = squares[sel];
    handleAxis = [0, 1, 2, 3].reduce((b, j) => (Math.sin(s.a + j * QUARTER) > Math.sin(s.a + b * QUARTER) ? j : b), 0);
    const t = s.a + handleAxis * QUARTER;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    const from = 0.5 * k;
    const to = 0.5 * k + 22;
    layer.stem.setAttribute('x1', (X(s.x) + ux * from).toFixed(2));
    layer.stem.setAttribute('y1', (Y(s.y) - uy * from).toFixed(2));
    layer.stem.setAttribute('x2', (X(s.x) + ux * to).toFixed(2));
    layer.stem.setAttribute('y2', (Y(s.y) - uy * to).toFixed(2));
    layer.knob.setAttribute('cx', (X(s.x) + ux * to).toFixed(2));
    layer.knob.setAttribute('cy', (Y(s.y) - uy * to).toFixed(2));
  }
  layer.handle.style.display = knob ? '' : 'none';
}

// The smallest circle around the squares, the dashed circle of the least
// radius around the same centre, the corners on the circle, and the readout.
function drawCircle() {
  const k = unit();
  const pts = squares.flatMap(corners);
  const c = enclosingCircle(pts);
  const R = CASES[n].R;
  const extra = c.r - R;
  const best = extra < 5e-7;
  const cx = X(c.x);
  const cy = Y(c.y);
  for (const el of [layer.live, layer.minimum]) {
    el.setAttribute('cx', cx.toFixed(2));
    el.setAttribute('cy', cy.toFixed(2));
  }
  layer.live.setAttribute('r', (c.r * k).toFixed(2));
  layer.minimum.setAttribute('r', (R * k).toFixed(2));
  layer.excess.setAttribute('d', extra * k > 0.5 ? ring(cx, cy, c.r * k, R * k) : '');
  board.classList.toggle('optimal', best);

  // The corners on the circle, and its centre.
  layer.marks.replaceChildren();
  const seen = [];
  for (const p of pts) {
    if (Math.hypot(p[0] - c.x, p[1] - c.y) < c.r - 1e-7 * Math.max(1, c.r)) continue;
    if (seen.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)) continue;
    seen.push(p);
    make('circle', { cx: X(p[0]).toFixed(2), cy: Y(p[1]).toFixed(2), r: 3.2 }, layer.marks);
  }
  make('circle', { cx: cx.toFixed(2), cy: cy.toFixed(2), r: 2.6, class: 'centre' }, layer.marks);

  $('r-live').textContent = c.r.toFixed(6);
  $('r-extra').textContent = best ? '' : `+${extra.toFixed(6)} above it`;
  $('board-r').textContent = c.r.toFixed(6);
  $('board-extra').textContent = best ? '' : `+${extra.toFixed(6)}`;
  const status = best ? (family() ? 'At the least radius: an optimal packing, one of infinitely many.' : 'At the least radius: the optimal packing.') : 'Bigger than the least radius.';
  if ($('status').textContent !== status) $('status').textContent = status;
  $('status').classList.toggle('good', best);
}

// ------------------------------------------------------------ the side panel

function showSelected(force = false) {
  const has = sel !== null;
  if (!force && document.activeElement && !document.activeElement.id.startsWith('sel-')) $('sel-blocked').hidden = true;
  $('selected').classList.toggle('none', !has);
  if (!has) {
    $('sel-name').textContent = 'No square selected';
    return;
  }
  const s = squares[sel];
  $('sel-name').innerHTML = s.label ? `Square <i>${s.label}</i>` : `Square ${sel + 1}`;
  let role = '';
  if (optimal()) {
    const m = moverOf(sel);
    role = m ? `It ${m.what}.` : family() ? 'It is fixed in every optimal packing.' : 'It is fixed: this packing is the only optimal one.';
  }
  $('sel-role').innerHTML = role;
  $('sel-role').hidden = !role;
  const values = { 'sel-x': s.x.toFixed(4), 'sel-y': s.y.toFixed(4), 'sel-a': turnDegrees(s.a).toFixed(2) };
  for (const [id, v] of Object.entries(values)) {
    $(id).readOnly = optimal();
    if (force || document.activeElement !== $(id)) {
      $(id).value = v;
      $(id).dataset.shown = v;
    }
  }
}

function format(v, p) {
  const text = p.unit ? `${v.toFixed(1)}${p.unit}` : v.toFixed(3);
  return /^-0\.0+°?$/.test(text) ? text.slice(1) : text;
}

function buildFamily() {
  const box = $('sliders');
  box.replaceChildren();
  for (const key of Object.keys(sliders)) delete sliders[key];
  const f = family();
  $('family').classList.toggle('unique', !f);
  $('mirror').hidden = !(f && f.mirror);
  if (!f) return;
  for (const p of f.params) {
    const row = document.createElement('label');
    row.className = 'slider';
    const name = document.createElement('span');
    name.className = 'name';
    name.innerHTML = p.label.replace(/\b([A-Z])\b/g, '<i>$1</i>');
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: p.min, max: p.max, step: p.step });
    const out = document.createElement('output');
    const ends = document.createElement('span');
    ends.className = 'ends';
    ends.innerHTML = '<span></span><span></span>';
    row.append(name, input, out, ends);
    box.append(row);
    input.addEventListener('input', () => {
      finishGlide();
      if (!fam) return;
      stopAnimation();
      fam = { ...fam, [p.key]: reach(f, fam, p.key, +input.value, p.step, limit()) };
      applyFamily();
    });
    sliders[p.key] = { input, out, ends, p, range: null };
  }
}

// Each slider spans the values its parameter can take with the others held,
// from where a square meets another, or in the optimal mode the circle, on one
// side to where it does on the other, so its range changes with the others.
// In the free mode its track shows where the circle stays at its least (green)
// and where it grows (red). A parameter that cannot move has its knob in the
// middle of a disabled slider.
const SAMPLES = 160;
const THUMB = 18;

function span(slider) {
  const f = family();
  const { input, p } = slider;
  const step = (p.max - p.min) / 200;
  const lo = reach(f, fam, p.key, p.min, step, limit());
  const hi = reach(f, fam, p.key, p.max, step, limit());
  slider.range = { lo, hi };
  const stuck = hi - lo < 1e-6;
  const [from, to] = slider.ends.children;
  from.textContent = stuck ? '' : format(lo, p);
  to.textContent = stuck ? 'held by its neighbours' : format(hi, p);
  input.disabled = stuck;
  input.min = stuck ? lo - 1 : lo;
  input.max = stuck ? lo + 1 : hi;
  input.step = stuck ? 'any' : (hi - lo) / 1000;
  input.style.removeProperty('--track');
  if (stuck || optimal()) return;
  const w = input.getBoundingClientRect().width;
  const pct = (v) => {
    const t = (v - lo) / (hi - lo);
    return w > THUMB ? ((THUMB / 2 + t * (w - THUMB)) / w) * 100 : t * 100;
  };
  const fits = (v) => inDisk(f.build({ ...fam, [p.key]: v }), CASES[n].R);
  const stops = [];
  let start = lo;
  let good = fits(lo);
  for (let k = 1; k <= SAMPLES; k++) {
    const v = lo + ((hi - lo) * k) / SAMPLES;
    const g = k === SAMPLES ? !good : fits(v);
    if (g !== good) {
      const a = start === lo ? 0 : pct(start);
      const b = k === SAMPLES ? 100 : pct(v);
      stops.push(`${good ? 'var(--band)' : 'var(--grow)'} ${a.toFixed(2)}% ${b.toFixed(2)}%`);
      start = v;
      good = g;
    }
  }
  input.style.setProperty('--track', `linear-gradient(to right, ${stops.join(', ')})`);
}

// The sliders show the parameters; `full` also recomputes their ranges.
function syncSliders(full = true) {
  const f = family();
  if (!f) return;
  $('family').classList.toggle('off', !fam);
  for (const slider of Object.values(sliders)) {
    const { input, out, p } = slider;
    if (!fam) {
      input.disabled = true;
      out.textContent = '–';
      for (const e of slider.ends.children) e.textContent = '';
      slider.range = null;
      input.style.removeProperty('--track');
      continue;
    }
    if (full) span(slider);
    input.value = fam[p.key];
    out.textContent = format(fam[p.key], p);
  }
  $('mirror').disabled = !fam;
  $('mirror').setAttribute('aria-pressed', fam && fam.mirror ? 'true' : 'false');
}

function familyNote() {
  const f = family();
  const note = $('family-note');
  if (!f) {
    $('family-title').textContent = 'The only one';
    note.textContent = optimal()
      ? 'Nothing can move in this mode: this is the only optimal packing, up to turning it about the centre.'
      : 'This is the only optimal packing, up to turning it about the centre, so moving any square makes the circle bigger.';
    return;
  }
  $('family-title').textContent = n === 7 ? 'Heights of the middle squares' : 'The five parameters';
  if (!fam) {
    note.textContent = 'A square has left the family, so the sliders are off. Reset brings the squares back.';
    return;
  }
  const legend = optimal()
    ? 'Each slider spans what its parameter can do with the others held, so moving one changes the ranges of the others.'
    : '<span class="key band"></span>the circle stays at its least <span class="key grow"></span>it grows. Each slider spans what its parameter can do with the others held.';
  const turn = n === 8 ? ' To turn <i>K</i> far, drag its knob on the board: it shifts to make room.' : '';
  note.innerHTML = legend + turn;
}

// Moves the squares to the packing of the parameters fam, each square keeping
// its colour: in seven squares the middle three keep their order of height.
function placeFamily() {
  const next = family().build(fam);
  if (n === 7) {
    for (let k = 0; k < 4; k++) Object.assign(squares[k], place(next[k]));
    [4, 5, 6].sort((i, j) => squares[i].y - squares[j].y).forEach((i, r) => Object.assign(squares[i], place(next[4 + r])));
  } else next.forEach((s, k) => Object.assign(squares[k], place(s)));
}

function applyFamily() {
  placeFamily();
  syncSliders();
  familyNote();
  render();
  showSelected();
}

// After a square moves: read the parameters back, if any, and redraw.
function changed() {
  const f = family();
  if (f) {
    fam = f.read(squares);
    syncSliders();
  }
  familyNote();
  render();
  showSelected();
}

// Square i moved toward the centre (x, y), or turned toward a: anywhere in
// the free mode; in the optimal mode a sliding square follows its parameter,
// and the central square of eight moves among the others, which stay put.
function moveTo(i, x, y) {
  if (!movable(i)) return;
  const m = optimal() ? moverOf(i) : null;
  if (m && !m.free) {
    const p = family().params.find((q) => q.key === m.key);
    fam = { ...fam, [m.key]: reach(family(), fam, m.key, m.of({ x, y }), p.step, limit()) };
    applyFamily();
    return;
  }
  squares[i] = moveSquare(squares, i, x, y, bound());
  changed();
}

function turnTo(i, a) {
  if (!turnable(i)) return;
  squares[i] = turnSquare(squares, i, a, bound());
  changed();
}

// ---------------------------------------------------------------- animation
//
// In the optimal mode the families of seven and eight squares wander: each
// sliding square keeps a speed and turns back where it meets a square or the
// circle, and the central square of eight drifts and turns among the others.

const SPEED = { 7: 0.12, 8: 0.05 };

function wander(dt) {
  const f = family();
  const speed = SPEED[n];
  let free = -1;
  const keys = new Set();
  squares.forEach((s, i) => {
    const m = f.mover(squares, i, fam);
    if (m && m.free) free = i;
    else if (m) keys.add(m.key);
  });
  for (const key of keys) {
    const p = f.params.find((q) => q.key === key);
    let v = anim.v[key] || (Math.random() < 0.5 ? -speed : speed);
    v = Math.sign(v) * Math.min(1.5 * speed, Math.max(0.4 * speed, Math.abs(v) + (Math.random() - 0.5) * speed * dt * 4));
    const target = fam[key] + v * dt;
    const got = reach(f, fam, key, target, p.step, limit());
    if (Math.abs(got - target) > 1e-12) v = -v;
    fam = { ...fam, [key]: got };
    anim.v[key] = v;
  }
  placeFamily();
  if (free < 0) return;
  const k = anim.k || (anim.k = { dir: Math.random() * 2 * Math.PI, w: (Math.random() < 0.5 ? -12 : 12) * DEG });
  k.dir += (Math.random() - 0.5) * 6 * dt;
  const s = squares[free];
  const x = s.x + Math.cos(k.dir) * speed * dt;
  const y = s.y + Math.sin(k.dir) * speed * dt;
  squares[free] = moveSquare(squares, free, x, y, bound());
  if (Math.hypot(squares[free].x - x, squares[free].y - y) > 0.5 * speed * dt) k.dir = Math.random() * 2 * Math.PI;
  const a = squares[free].a + k.w * dt;
  squares[free] = turnSquare(squares, free, a, bound());
  if (Math.abs(squares[free].a - a) > 1e-12) k.w = -k.w;
}

function frame(now) {
  if (!anim) return;
  if (!optimal() || !family() || !fam) return stopAnimation();
  const dt = Math.min(0.05, (now - anim.last) / 1000);
  anim.last = now;
  wander(dt);
  fam = family().read(squares);
  syncSliders();
  render();
  showSelected();
  requestAnimationFrame(frame);
}

function toggleAnimation(on = !anim) {
  if (on) finishGlide();
  if (on && !anim) {
    anim = { last: performance.now(), v: {}, k: null };
    requestAnimationFrame(frame);
  } else if (!on && anim) {
    anim = null;
    changed();
  }
  $('animate').textContent = anim ? 'Stop' : 'Animate';
  $('animate').setAttribute('aria-pressed', anim ? 'true' : 'false');
}

const stopAnimation = () => toggleAnimation(false);

// ---------------------------------------------------------------- the cases

function reset(animate = false) {
  const fresh = CASES[n].squares();
  if (animate || fresh.length !== squares.length) {
    squares = fresh;
    buildShapes(animate);
  } else fresh.forEach((s, k) => Object.assign(squares[k], s));
  fam = family() ? { ...family().defaults } : null;
  sel = null;
  changed();
}

// Reset glides the squares back to the optimal packing without letting them
// overlap. When straight lines keep them apart, they take those. Otherwise
// they spread out from the centre of their circle, which keeps squares apart,
// until any two centres are at least 2 apart; they cross to the places of the
// packing spread out the same way, in straight lines and in step, matched to
// make the sum of the squared distances least, which keeps the circles of
// radius √2/2 around them apart whatever their turns (Turpin, Michael and
// Kumar, CAPT, 2014); and they close in on the packing. The board zooms out
// while they are spread. The squares of eight take the letters of the places
// they go to.

// The order of the squares that matches square order[k] to place k with the
// least sum of squared distances.
function assignment(from, to) {
  let best = null;
  let bestCost = Infinity;
  const used = new Array(from.length).fill(false);
  const order = [];
  const visit = (k, cost) => {
    if (cost >= bestCost) return;
    if (k === to.length) {
      best = order.slice();
      bestCost = cost;
      return;
    }
    for (let i = 0; i < from.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      order.push(i);
      visit(k + 1, cost + (from[i].x - to[k].x) ** 2 + (from[i].y - to[k].y) ** 2);
      order.pop();
      used[i] = false;
    }
  };
  visit(0, 0);
  return best;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const between = (f, g, t) => ({ x: f.x + (g.x - f.x) * t, y: f.y + (g.y - f.y) * t, a: f.a + (g.a - f.a) * t });
const closest = (pts) => {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) d = Math.min(d, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return d;
};
const clear = (pose) => [...Array(200)].every((_, k) => isPacking(pose((k + 1) / 200)));

// The way from the poses `from` to the places `home`: the order of the squares
// by place, their poses at time t in [0, 1], and the duration in ms.
function planHome(from, home) {
  const turned = (f, h) => f.a + normalTurn(h.a - f.a);
  let order = assignment(from, home);
  let start = order.map((i) => from[i]);
  const end = home.map((h, k) => ({ x: h.x, y: h.y, a: turned(start[k], h) }));
  const straight = (t) => start.map((f, k) => between(f, end[k], ease(t)));
  const far = Math.max(...start.map((f, k) => Math.hypot(f.x - end[k].x, f.y - end[k].y) + 0.5 * Math.abs(f.a - end[k].a)));
  if (from.length < 2 || clear(straight)) return { order, pose: straight, duration: 300 + 450 * Math.min(1, far / 1.5) };

  const c = enclosingCircle(from.flatMap(corners));
  const out = Math.max(1, 2.02 / closest(from));
  const back = 2.02 / closest(home);
  const spread = from.map((f) => ({ x: c.x + out * (f.x - c.x), y: c.y + out * (f.y - c.y) }));
  const spreadHome = home.map((h) => ({ x: back * h.x, y: back * h.y }));
  order = assignment(spread, spreadHome);
  start = order.map((i) => from[i]);
  const a = order.map((i) => spread[i]);
  const turns = start.map((f, k) => turned(f, home[k]));
  const pose = (t) =>
    start.map((f, k) => {
      if (t < 0.28) {
        const l = 1 + (out - 1) * ease(t / 0.28);
        return { x: c.x + l * (f.x - c.x), y: c.y + l * (f.y - c.y), a: f.a };
      }
      if (t < 0.72) {
        const e = ease((t - 0.28) / 0.44);
        return { x: a[k].x + (spreadHome[k].x - a[k].x) * e, y: a[k].y + (spreadHome[k].y - a[k].y) * e, a: f.a + (turns[k] - f.a) * e };
      }
      const l = back - (back - 1) * ease((t - 0.72) / 0.28);
      return { x: l * home[k].x, y: l * home[k].y, a: turns[k] };
    });
  return clear(pose) ? { order, pose, duration: 1400 } : null;
}

function glideHome() {
  stopAnimation();
  finishGlide();
  const home = CASES[n].squares();
  const plan = planHome(squares.map(place), home);
  if (!plan) return reset();
  squares = plan.order.map((i) => squares[i]);
  shapes = plan.order.map((i) => shapes[i]);
  shapes.forEach(({ poly }, k) => (poly.dataset.i = k));
  if (n === 8) {
    squares.forEach((s, k) => {
      s.k = home[k].k;
      s.label = home[k].label;
      shapes[k].g.setAttribute('class', `sq c${s.label === 'K' ? 'k' : s.k}`);
      shapes[k].text.textContent = s.label;
    });
  }
  glide = { plan, home, start: performance.now(), view: half };
  sel = null;
  fam = family() ? { ...family().defaults } : null;
  syncSliders();
  familyNote();
  board.classList.add('gliding');
  requestAnimationFrame(glideFrame);
}

function glideFrame(now) {
  if (!glide) return;
  const t = Math.min(1, (now - glide.start) / glide.plan.duration);
  glide.plan.pose(t).forEach((p, k) => Object.assign(squares[k], p));
  // Zoom out to keep the spread squares on the board.
  const reach = Math.max(...squares.flatMap(corners).map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  const view = Math.max(glide.view, reach + 0.15);
  if (Math.abs(view - half) > 1e-9) {
    half = view;
    drawGrid();
  }
  render();
  if (t < 1) requestAnimationFrame(glideFrame);
  else finishGlide();
}

// Ends a glide at once, with every square in its place.
function finishGlide() {
  if (!glide) return;
  squares.forEach((s, k) => Object.assign(s, place(glide.home[k])));
  half = glide.view;
  glide = null;
  board.classList.remove('gliding');
  drawGrid();
  changed();
}

// The free mode scatters the squares; the optimal mode draws a random packing
// of the family, keeping its mirror image.
function shuffle() {
  finishGlide();
  if (optimal()) {
    if (!family() || !fam) return;
    fam = family().sample(fam, Math.random);
    applyFamily();
    return;
  }
  scatter(n, bound()).forEach((s, k) => Object.assign(squares[k], place(s)));
  sel = null;
  changed();
}

function isOptimal() {
  const c = enclosingCircle(squares.flatMap(corners));
  return c.r - CASES[n].R < 5e-7 && (!family() || family().read(squares) !== null);
}

// Shuffle needs a family in the optimal mode; Animate moves only the families.
function actions() {
  $('shuffle').disabled = optimal() && !family();
  const still = !optimal() || !family();
  $('animate').disabled = still;
  $('animate').title = still ? 'Animate moves the optimal packings of seven and eight squares, in the optimal mode.' : '';
}

function setMode(m, push = true) {
  stopAnimation();
  finishGlide();
  mode = m;
  for (const b of document.querySelectorAll('.mode')) b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
  board.classList.toggle('restricted', optimal());
  $('mode-note').textContent = MODE_NOTES[mode];
  actions();
  if (squares.length) {
    if (optimal() && !isOptimal()) glideHome();
    else changed();
  }
  if (push) writeHash();
}

function choose(m, push = true) {
  stopAnimation();
  finishGlide();
  n = m;
  half = 1.3 * CASES[n].R + 0.5;
  for (const b of document.querySelectorAll('.case')) b.setAttribute('aria-pressed', +b.dataset.n === n ? 'true' : 'false');
  $('case-name').textContent = NAMES[n];
  $('case-note').innerHTML = NOTES[n];
  $('case-more').hidden = !MORE[n];
  if (MORE[n]) {
    $('case-more-title').innerHTML = MORE[n].title;
    $('case-more-body').innerHTML = MORE[n].body;
  }
  $('r-min').innerHTML = `<span class="formula"><i>R</i><sub>${n}</sub> = ${EXACT[n]} ≈ ${CASES[n].R.toFixed(6)}</span>`;
  board.setAttribute('aria-label', `${NAMES[n]} and the smallest circle around them`);
  actions();
  buildFamily();
  drawGrid();
  reset(true);
  if (push) writeHash();
}

function writeHash() {
  history.replaceState(null, '', `#n=${n}${optimal() ? '&optimal' : ''}`);
}

function thumbnails() {
  const nav = $('cases');
  for (let m = 1; m <= 8; m++) {
    const c = CASES[m];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'case';
    b.dataset.n = m;
    b.setAttribute('aria-label', `${NAMES[m]}`);
    const s = 64;
    const k = s / (2 * c.R * 1.1);
    const svg = make('svg', { viewBox: `0 0 ${s} ${s}`, 'aria-hidden': 'true' }, b);
    make('circle', { cx: s / 2, cy: s / 2, r: c.R * k, class: 'thumb-circle' }, svg);
    for (const q of c.squares()) {
      const g = make('g', { class: `sq c${q.label === 'K' ? 'k' : q.k}` }, svg);
      make('polygon', { points: corners(q).map(([x, y]) => `${(s / 2 + x * k).toFixed(2)},${(s / 2 - y * k).toFixed(2)}`).join(' ') }, g);
    }
    const cap = document.createElement('span');
    cap.innerHTML = `<i>n</i> = ${m}`;
    b.append(cap);
    b.addEventListener('click', () => choose(m));
    nav.append(b);
  }
}

// ------------------------------------------------------------- interaction

board.addEventListener('pointerdown', (e) => {
  stopAnimation();
  finishGlide();
  const w = toWorld(e);
  if (e.target === layer.knob && sel !== null) {
    drag = { kind: 'turn', axis: handleAxis };
  } else if (e.target.dataset && e.target.dataset.i !== undefined) {
    sel = +e.target.dataset.i;
    drag = movable(sel) ? { kind: 'move', dx: w.x - squares[sel].x, dy: w.y - squares[sel].y } : null;
  } else {
    sel = null;
    drag = null;
    render();
    showSelected();
    return;
  }
  if (drag) {
    board.setPointerCapture(e.pointerId);
    board.classList.add('dragging');
  }
  board.classList.add('pointer');
  e.preventDefault();
  // Focus the board for the keys, without the ring meant for keyboard focus.
  board.focus({ preventScroll: true, focusVisible: false });
  render();
  showSelected();
});

board.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const w = toWorld(e);
  const s = squares[sel];
  if (drag.kind === 'move') moveTo(sel, w.x - drag.dx, w.y - drag.dy);
  else {
    let target = s.a + wrap(Math.atan2(w.y - s.y, w.x - s.x) - (s.a + drag.axis * QUARTER));
    // Snap to the axes and the diagonals, unless Alt is held.
    const t = normalTurn(target);
    const snap = Math.round(t / (45 * DEG)) * 45 * DEG;
    if (!e.altKey && Math.abs(t - snap) < 1.2 * DEG) target += snap - t;
    turnTo(sel, target);
  }
});

const endDrag = () => {
  drag = null;
  board.classList.remove('dragging');
};
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);

board.addEventListener(
  'wheel',
  (e) => {
    if (sel === null || !turnable(sel) || !e.target.dataset || +e.target.dataset.i !== sel) return;
    e.preventDefault();
    const d = (e.shiftKey ? 0.1 : 1) * DEG * Math.sign(e.deltaY || e.deltaX);
    turnTo(sel, squares[sel].a - d);
  },
  { passive: false },
);

board.addEventListener('blur', () => board.classList.remove('pointer'));

board.addEventListener('keydown', (e) => {
  board.classList.remove('pointer');
  finishGlide();
  const big = e.shiftKey;
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (e.key === 'Enter' || e.key === ' ') {
    sel = sel === null ? 0 : (sel + 1) % squares.length;
    render();
    showSelected();
  } else if (e.key === 'Escape') {
    sel = null;
    render();
    showSelected();
  } else if (sel !== null && arrows[e.key]) {
    stopAnimation();
    const d = big ? 0.1 : 0.01;
    moveTo(sel, squares[sel].x + d * arrows[e.key][0], squares[sel].y + d * arrows[e.key][1]);
  } else if (sel !== null && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    stopAnimation();
    turnTo(sel, squares[sel].a + (big ? 15 : 1) * DEG * (e.code === 'BracketLeft' ? 1 : -1));
  } else return;
  e.preventDefault();
});

for (const id of ['sel-x', 'sel-y', 'sel-a']) {
  const input = $(id);
  const commit = () => {
    // Enter and the change event that follows it commit the same value once.
    if (input.readOnly || input.value === input.dataset.shown) return;
    const v = parseFloat(input.value.replace('−', '-'));
    if (sel === null || !Number.isFinite(v)) return showSelected(true);
    stopAnimation();
    const s = squares[sel];
    let missed;
    if (id === 'sel-a') {
      // The nearer way round to the typed turn.
      const d = ((((v - turnDegrees(s.a)) % 90) + 135) % 90) - 45;
      const target = s.a + d * DEG;
      squares[sel] = turnSquare(squares, sel, target, bound());
      missed = Math.abs(squares[sel].a - target) > 1e-9;
    } else {
      const [x, y] = id === 'sel-x' ? [v, s.y] : [s.x, v];
      squares[sel] = moveSquare(squares, sel, x, y, bound());
      missed = Math.hypot(squares[sel].x - x, squares[sel].y - y) > 1e-9;
    }
    changed();
    showSelected(true);
    clearTimeout(blockedTimer);
    $('sel-blocked').hidden = !missed;
    if (missed) blockedTimer = setTimeout(() => ($('sel-blocked').hidden = true), 4000);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
  });
}

for (const b of document.querySelectorAll('.mode')) {
  b.addEventListener('click', () => setMode(b.dataset.mode));
}
$('mirror').addEventListener('click', () => {
  finishGlide();
  if (!fam) return;
  fam = { ...fam, mirror: !fam.mirror };
  applyFamily();
});
$('reset').addEventListener('click', glideHome);
$('shuffle').addEventListener('click', shuffle);
$('animate').addEventListener('click', () => toggleAnimation());

// The colour theme, shared with the rest of vltanh.me through the same stored
// setting: system, light or dark, in that cycle.
const THEMES = ['system', 'light', 'dark'];
const ICONS = {
  system: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" class="solid"/></svg>',
  light:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z"/></svg>',
};

function storedTheme() {
  try {
    const t = localStorage.getItem('theme');
    return THEMES.includes(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('theme').innerHTML = ICONS[t];
  $('theme').title = `Colours: ${t === 'system' ? 'as the system' : t} (click to change)`;
  $('theme').setAttribute('aria-label', `Colour theme: ${t}`);
}

$('theme').addEventListener('click', () => {
  const t = THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length];
  try {
    localStorage.setItem('theme', t);
  } catch {
    // Without storage the choice lasts until the page is left.
  }
  applyTheme(t);
});
applyTheme(storedTheme());

function measure() {
  size = board.getBoundingClientRect().width || 600;
  board.setAttribute('viewBox', `0 0 ${size} ${size}`);
}

new ResizeObserver(() => {
  measure();
  drawGrid();
  if (fam) syncSliders();
  render();
}).observe(board);

const fromHash = () => {
  const m = +(location.hash.match(/n=(\d)/) || [])[1];
  return { n: m >= 1 && m <= 8 ? m : 8, mode: /optimal/.test(location.hash) ? 'optimal' : 'free' };
};

function follow(push) {
  const h = fromHash();
  setMode(h.mode, push);
  choose(h.n, push);
}

thumbnails();
measure();
follow(false);
window.addEventListener('hashchange', () => follow(false));
