// The Heilbronn playground: n points in the unit square, the triangles of
// least area, and the configurations that Lean proves optimal.
import { CASES } from "./cases.js";
import { analyse, assignment, clamp01, climb, climber, images, sameSet, scatter, sides, triangleName } from "./geometry.js";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

function make(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (k) => WORDS[k] || String(k);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const copy = (P) => P.map(([x, y]) => [x, y]);

// The least area counts as the proved value when it is this close to it.
const AT = 1e-9;

const board = $("board");
const layer = {
  fill: board.querySelector(".square-fill"),
  square: board.querySelector(".square"),
  grid: board.querySelector(".grid"),
  near: board.querySelector(".near"),
  tight: board.querySelector(".tight"),
  lines: board.querySelector(".lines"),
  focus: board.querySelector(".focus"),
  points: board.querySelector(".points"),
};

let C = CASES[0]; // the case on the board
let pts = []; // the points, in the order of C.names
let shapes = []; // their SVG elements
let imgs = []; // the distinct images of the optimal configuration
let state = null; // the analysis of pts
let sel = null;
let size = 600; // the side of the board, in pixels
let drag = null;
let glide = null; // the points on their way to a new position
let run = null; // Improve, while it runs
let result = null; // what the last Improve found, until the points move
let trail = null; // the least area after each step of the last Improve
let margin = 0.05; // the near triangles are within this fraction of the least
let focusTri = null; // the triangle picked in the list
let clampTimer = 0;

const PAD = 0.075; // the room around the square, in units of its side
const unit = () => size / (1 + 2 * PAD);
const X = (x) => (x + PAD) * unit();
const Y = (y) => (1 + PAD - y) * unit();
const H = () => C.value;
const Hn = () => `<i>H</i><sub>${C.n}</sub>`;

function toWorld(e) {
  const r = board.getBoundingClientRect();
  const k = r.width / (1 + 2 * PAD);
  return [(e.clientX - r.left) / k - PAD, 1 + PAD - (e.clientY - r.top) / k];
}

// ------------------------------------------------------------------ drawing

function drawSquare() {
  for (const el of [layer.fill, layer.square]) {
    el.setAttribute("x", X(0).toFixed(2));
    el.setAttribute("y", Y(1).toFixed(2));
    el.setAttribute("width", (X(1) - X(0)).toFixed(2));
    el.setAttribute("height", (Y(0) - Y(1)).toFixed(2));
  }
  layer.grid.replaceChildren();
  for (let j = 1; j < 10; j++) {
    const v = j / 10;
    const cls = j === 5 ? "major" : "minor";
    make("line", { x1: X(v), y1: Y(0), x2: X(v), y2: Y(1), class: cls }, layer.grid);
    make("line", { x1: X(0), y1: Y(v), x2: X(1), y2: Y(v), class: cls }, layer.grid);
  }
}

function buildPoints() {
  layer.points.replaceChildren();
  shapes = C.names.map((name, i) => {
    const g = make("g", { class: "pt" }, layer.points);
    const hit = make("circle", { class: "hit", r: 18 }, g);
    hit.dataset.i = i;
    const ring = make("circle", { class: "ring", r: 11 }, g);
    const dot = make("circle", { class: "dot", r: 5.5 }, g);
    const text = make("text", {}, g);
    text.textContent = name;
    return { g, hit, ring, dot, text };
  });
}

const polygon = (t) => t.map((i) => `${X(pts[i][0]).toFixed(2)},${Y(pts[i][1]).toFixed(2)}`).join(" ");

// A triple on a line, drawn as the segment between its two farthest points.
function segment(t, parent) {
  let best = [t[0], t[1]];
  let far = -1;
  for (const [a, b] of [
    [t[0], t[1]],
    [t[0], t[2]],
    [t[1], t[2]],
  ]) {
    const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
    if (d > far) {
      far = d;
      best = [a, b];
    }
  }
  const [a, b] = best;
  return make("line", { x1: X(pts[a][0]), y1: Y(pts[a][1]), x2: X(pts[b][0]), y2: Y(pts[b][1]) }, parent);
}

function drawTriangles() {
  layer.near.replaceChildren();
  layer.tight.replaceChildren();
  layer.lines.replaceChildren();
  if (state.collinear) for (const { t } of state.ties) segment(t, layer.lines);
  else for (const { t } of state.ties) make("polygon", { points: polygon(t) }, layer.tight);
  for (const { t } of state.near) make("polygon", { points: polygon(t) }, layer.near);
  drawFocus();
}

function drawFocus() {
  layer.focus.replaceChildren();
  if (!focusTri) return;
  if (state.collinear && state.ties.some(({ t }) => t.join() === focusTri.join())) segment(focusTri, layer.focus);
  else {
    const near = !state.ties.some(({ t }) => t.join() === focusTri.join());
    make("polygon", { points: polygon(focusTri), class: near ? "dashed" : "" }, layer.focus);
  }
}

// Where a point's name goes: outside the square for a point on a side, else
// in the widest gap between the directions to the other points.
function labelDirection(i) {
  const [x, y] = pts[i];
  const s = sides(pts[i], 1e-6);
  if (s.length) {
    const dx = s.includes("left") ? -1 : s.includes("right") ? 1 : 0;
    const dy = s.includes("bottom") ? -1 : s.includes("top") ? 1 : 0;
    const l = Math.hypot(dx, dy);
    return [dx / l, dy / l];
  }
  const angles = pts
    .filter((q, j) => j !== i && Math.hypot(q[0] - x, q[1] - y) > 1e-9)
    .map((q) => Math.atan2(q[1] - y, q[0] - x))
    .sort((a, b) => a - b);
  if (!angles.length) return [0.7, 0.7];
  let mid = angles[0] + Math.PI;
  let gap = -1;
  angles.forEach((a, k) => {
    const b = k + 1 < angles.length ? angles[k + 1] : angles[0] + 2 * Math.PI;
    if (b - a > gap) {
      gap = b - a;
      mid = (a + b) / 2;
    }
  });
  return [Math.cos(mid), Math.sin(mid)];
}

function drawPoints() {
  const font = Math.max(14, Math.min(20, size * 0.03));
  const off = font * 0.95;
  pts.forEach((p, i) => {
    const { g, hit, ring, dot, text } = shapes[i];
    const cx = X(p[0]).toFixed(2);
    const cy = Y(p[1]).toFixed(2);
    for (const c of [hit, ring, dot]) {
      c.setAttribute("cx", cx);
      c.setAttribute("cy", cy);
    }
    const [dx, dy] = labelDirection(i);
    text.setAttribute("x", (X(p[0]) + dx * off).toFixed(2));
    text.setAttribute("y", (Y(p[1]) - dy * off).toFixed(2));
    text.setAttribute("font-size", font.toFixed(1));
    g.classList.toggle("selected", i === sel);
  });
}

// ------------------------------------------------------------ the readouts

const fmt = (v) => (v === 0 ? "0" : v.toFixed(7));

function percent(least) {
  if (least >= H() - AT) return "100%";
  return `${(Math.floor((least / H()) * 10000) / 100).toFixed(2)}%`;
}

function currentImage() {
  return imgs.findIndex((im) => sameSet(pts, im.points, 1e-7));
}

function statusText() {
  const L = state.least;
  if (run) return { text: "Improving…" };
  if (result) return result;
  if (state.collinear) {
    const k = state.ties.length;
    const text =
      k === 1
        ? "Three of the points are on a line, so the least area is 0."
        : `${cap(word(k))} triples of points are on lines, so the least area is 0.`;
    return { text, cls: "zero" };
  }
  if (L >= H() - AT) {
    const k = currentImage();
    const which = k >= 0 ? `, ${imgs[k].symmetry.name}` : "";
    return { text: `At ${Hn()}, the largest possible: the configuration of ${C.found}${which}.`, cls: "good" };
  }
  return { text: `Below ${Hn()}, the largest possible.` };
}

function readout() {
  const L = state.least;
  const at = L >= H() - AT;
  $("least").textContent = fmt(L);
  $("pct").textContent = percent(L);
  $("meter").style.width = `${Math.min(100, (100 * L) / H()).toFixed(3)}%`;
  $("meter").parentElement.classList.toggle("full", at);
  $("board-least").textContent = fmt(L);
  $("board-pct").innerHTML = `· ${percent(L)} of ${Hn()}`;
  const s = statusText();
  const status = $("status");
  if (status.innerHTML !== s.text) status.innerHTML = s.text;
  status.className = `status ${s.cls || ""}`;
}

// The climb of the last Improve: the least area after each step, against the
// proved value.
function drawClimb() {
  const svg = $("climb");
  svg.toggleAttribute("hidden", !trail); // an SVG element has no hidden property
  if (!trail) return;
  const w = svg.getBoundingClientRect().width || 300;
  const h = 64;
  svg.setAttribute("viewBox", `0 0 ${w.toFixed(1)} ${h}`);
  svg.replaceChildren();
  const left = 26;
  const top = 8;
  const bottom = h - 6;
  const y = (v) => bottom - (Math.max(0, v) / H()) * (bottom - top);
  const steps = Math.max(trail.length - 1, 24);
  const x = (k) => left + (k / steps) * (w - left);
  make("line", { x1: left, y1: y(0), x2: w, y2: y(0), class: "base" }, svg);
  make("line", { x1: left, y1: y(H()), x2: w, y2: y(H()), class: "goal" }, svg);
  const label = make("text", { x: 0, y: y(H()) }, svg);
  label.innerHTML = `<tspan font-style="italic">H</tspan><tspan font-size="9" dy="3">${C.n}</tspan>`;
  const zero = make("text", { x: 0, y: y(0) }, svg);
  zero.textContent = "0";
  make("polyline", { points: trail.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" "), class: "path" }, svg);
}

// The list of the smallest triangles; hovering or focusing one shows it.
let chipKey = "";
const CHIPS = 30;

function triangleList() {
  const ties = state.ties;
  const near = state.near;
  const k = ties.length;
  const m = `${+(margin * 100).toFixed(1)}%`;
  let count;
  if (state.collinear) count = `${cap(word(k))} ${k === 1 ? "triple" : "triples"} of points on a line, of area 0.`;
  else {
    count = `${cap(word(k))} ${k === 1 ? "triangle has" : "triangles have"} the least area`;
    count += near.length ? `, and ${word(near.length)} more ${near.length === 1 ? "is" : "are"} within ${m} of it.` : ".";
  }
  $("tri-count").textContent = count;

  const byName = (u, v) => u.t[0] - v.t[0] || u.t[1] - v.t[1] || u.t[2] - v.t[2];
  const list = [...[...ties].sort(byName).map((tri) => ({ ...tri, near: false })), ...near.map((tri) => ({ ...tri, near: true }))];
  const shown = list.slice(0, CHIPS);
  const key = shown.map((c) => `${c.t.join()}${c.near ? "n" : ""}`).join("|") + (state.collinear ? "z" : "") + list.length;
  const ul = $("chips");
  if (key !== chipKey) {
    chipKey = key;
    ul.replaceChildren();
    for (const c of shown) {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.className = state.collinear ? "zero" : c.near ? "near" : "";
      li.dataset.t = c.t.join();
      li.innerHTML = `${triangleName(c.t, C.names)}<span class="plus"></span>`;
      const on = () => {
        focusTri = c.t;
        li.classList.add("on");
        drawFocus();
      };
      const off = () => {
        if (focusTri && focusTri.join() === c.t.join()) focusTri = null;
        li.classList.remove("on");
        drawFocus();
      };
      li.addEventListener("pointerenter", on);
      li.addEventListener("pointerleave", off);
      li.addEventListener("focus", on);
      li.addEventListener("blur", off);
      ul.append(li);
    }
    if (list.length > CHIPS) {
      const li = document.createElement("li");
      li.className = "more";
      li.textContent = `and ${list.length - CHIPS} more`;
      ul.append(li);
    }
  }
  // the areas, which change without changing the list
  [...ul.children].forEach((li, idx) => {
    const c = shown[idx];
    if (!c) return;
    const plus = c.near ? ` +${((100 * (c.a - state.least)) / state.least).toFixed(1)}%` : "";
    const span = li.querySelector(".plus");
    if (span.textContent !== plus) span.textContent = plus;
    li.setAttribute("aria-label", `${triangleName(c.t, C.names)}, area ${fmt(c.a)}${plus ? `, ${plus.trim()} above the least` : ""}`);
    li.title = `area ${fmt(c.a)}`;
  });
}

// Which points are on which side, and whether a side is empty: then the
// points can be stretched toward it, which multiplies every area by the same
// factor, more than 1, so an optimal configuration touches every side.
const SIDES = [
  ["left", "on the left"],
  ["bottom", "at the bottom"],
  ["right", "on the right"],
  ["top", "at the top"],
];

const names = (ix) => ix.map((i) => `<i>${C.names[i]}</i>`).join(", ");

function whereText() {
  const on = { left: [], bottom: [], right: [], top: [] };
  const touched = new Set();
  const corner = [];
  const inside = [];
  pts.forEach((p, i) => {
    const s = sides(p);
    for (const side of s) touched.add(side);
    if (s.length > 1) corner.push(i);
    else if (s.length === 1) on[s[0]].push(i);
    else inside.push(i);
  });
  const parts = SIDES.filter(([k]) => on[k].length).map(([k, where]) => `${names(on[k])} ${where}`);
  if (corner.length) parts.push(`${names(corner)} at ${corner.length === 1 ? "a corner" : "corners"}`);
  let text = parts.length ? `On the sides: ${parts.join("; ")}.` : "No point is on a side.";
  if (inside.length) text += ` Inside: ${inside.length === pts.length ? "all of them" : names(inside)}.`;
  // Stretching toward an empty side multiplies every area by the same factor.
  const empty = SIDES.map(([k]) => k).filter((k) => !touched.has(k));
  if (state.least > 0 && empty.length === 4) text += " Stretching them toward any side would make every triangle larger.";
  else if (state.least > 0 && empty.length) {
    const list = empty.length === 1 ? `the ${empty[0]} side` : `the ${empty.slice(0, -1).join(", the ")} or the ${empty[empty.length - 1]} side`;
    text += ` No point is on ${list}, so stretching the points toward ${empty.length === 1 ? "it" : "one of them"} would make every triangle larger.`;
  }
  return text;
}

const trim = (v) => String(+v.toFixed(6));

function showPoints(force = false) {
  $("where").innerHTML = whereText();
  const has = sel !== null;
  $("selected").classList.toggle("none", !has);
  if (!has) {
    $("sel-name").textContent = "The points";
    return;
  }
  $("sel-name").innerHTML = `Point <i>${C.names[sel]}</i>`;
  const values = { "sel-x": trim(pts[sel][0]), "sel-y": trim(pts[sel][1]) };
  for (const [id, v] of Object.entries(values)) {
    if (force || document.activeElement !== $(id)) {
      $(id).value = v;
      $(id).dataset.shown = v;
    }
  }
  const s = sides(pts[sel]);
  const place = s.length > 1 ? "At a corner" : s.length ? `On the ${s[0]} side` : "Inside the square";
  const mine = state.ties.filter(({ t }) => t.includes(sel)).length;
  const k = state.ties.length;
  let role;
  if (state.collinear)
    role = !mine
      ? "on no line of three points"
      : k === 1
        ? "on the line of three points"
        : `on ${word(mine)} of the ${word(k)} lines of three points`;
  else if (k === 1) role = mine ? "a corner of the smallest triangle" : "not a corner of the smallest triangle";
  else role = mine ? `a corner of ${word(mine)} of the ${word(k)} smallest triangles` : `not a corner of any of the ${word(k)} smallest triangles`;
  $("sel-role").innerHTML = `${place}, and ${role}.`;
}

function thumbsPressed() {
  const k = currentImage();
  [...$("images").children].forEach((b, j) => b.setAttribute("aria-pressed", j === k ? "true" : "false"));
}

function update() {
  state = analyse(pts, margin);
  if (focusTri && !state.ties.concat(state.near).some(({ t }) => t.join() === focusTri.join())) focusTri = null;
  drawTriangles();
  drawPoints();
  readout();
  triangleList();
  showPoints();
  thumbsPressed();
}

// After the points move by hand: what Improve found no longer holds.
function moved() {
  result = null;
  trail = null;
  drawClimb();
  update();
}

// ----------------------------------------------------------------- gliding

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Moves the points to the place `target`, each by the least it can. With
// `keep` the points keep their names; otherwise each takes the name of the
// place it goes to, as in the optimal configuration.
function glideTo(target, keep) {
  stopImprove();
  finishGlide();
  const order = assignment(pts, target);
  let to;
  if (keep) {
    to = new Array(pts.length);
    order.forEach((i, k) => (to[i] = [...target[k]]));
  } else {
    pts = order.map((i) => pts[i]);
    to = copy(target);
    if (sel !== null) sel = order.indexOf(sel);
  }
  result = null;
  trail = null;
  drawClimb();
  if (reducedMotion()) {
    pts = to;
    update();
    return;
  }
  glide = { from: copy(pts), to, start: performance.now(), ms: 650 };
  requestAnimationFrame(glideFrame);
}

function glideFrame(now) {
  if (!glide) return;
  const t = Math.min(1, (now - glide.start) / glide.ms);
  const e = ease(t);
  pts = glide.from.map((p, i) => [p[0] + (glide.to[i][0] - p[0]) * e, p[1] + (glide.to[i][1] - p[1]) * e]);
  if (t < 1) {
    update();
    requestAnimationFrame(glideFrame);
  } else finishGlide();
}

// Ends a glide at once, with every point in its place.
function finishGlide() {
  if (!glide) return;
  pts = glide.to;
  glide = null;
  update();
}

// ----------------------------------------------------------------- Improve
//
// Each step of the climb (geometry.js) is shown as a short glide, as long as
// the move is; the chart gets the least area after each step.

const STEP_MS = 170;

function startImprove() {
  finishGlide();
  run = { c: climber(pts), tween: null };
  result = null;
  trail = [state.least];
  $("improve").textContent = "Stop";
  $("improve").setAttribute("aria-pressed", "true");
  update();
  drawClimb();
  requestAnimationFrame(improveFrame);
}

function stopImprove(found = null) {
  if (!run) return;
  if (run.tween) pts = run.tween.to;
  run = null;
  result = found;
  $("improve").textContent = "Improve";
  $("improve").setAttribute("aria-pressed", "false");
  update();
  drawClimb();
}

function improveFrame(now) {
  if (!run) return;
  const c = run.c;
  if (run.tween) {
    const { from, to, start, ms } = run.tween;
    const s = Math.min(1, (now - start) / ms);
    pts = from.map((p, i) => [p[0] + (to[i][0] - p[0]) * s, p[1] + (to[i][1] - p[1]) * s]);
    if (s >= 1) {
      run.tween = null;
      pts = copy(to);
      trail.push(c.least);
      drawClimb();
    }
    update();
  } else {
    // Steps that the trust region turns down move nothing: take them at once.
    const before = copy(c.P);
    const t0 = performance.now();
    let far = 0;
    while (!c.done && c.steps < 4000 && performance.now() - t0 < 12) {
      climb(c);
      far = Math.max(...c.P.map((p, i) => Math.hypot(p[0] - before[i][0], p[1] - before[i][1])));
      if (far > 0) break;
    }
    if (far > 0) {
      const px = far * unit();
      if (reducedMotion() || px < 1) {
        pts = copy(c.P);
        trail.push(c.least);
        drawClimb();
        update();
      } else run.tween = { from: before, to: copy(c.P), start: now, ms: Math.min(STEP_MS, (STEP_MS * px) / 20) };
    }
    if (!run.tween && (c.done || c.steps >= 4000)) {
      const at = c.least >= H() - AT;
      const text = at
        ? `Improve reached ${Hn()}, the largest possible.`
        : `Improve stopped at a local maximum, ${percent(c.least)} of ${Hn()}: no small move of the points makes the smallest triangle larger.`;
      stopImprove({ text, cls: at ? "good" : "" });
      return;
    }
  }
  requestAnimationFrame(improveFrame);
}

// ------------------------------------------------------- the optimal images

function mini(P, svgClass) {
  const s = 64;
  const m = 4;
  const k = s - 2 * m;
  const svg = make("svg", { viewBox: `0 0 ${s} ${s}`, class: `mini ${svgClass || ""}`, "aria-hidden": "true" });
  make("rect", { x: m, y: m, width: k, height: k, class: "frame" }, svg);
  for (const { t } of analyse(P).ties) {
    make("polygon", { points: t.map((i) => `${(m + P[i][0] * k).toFixed(2)},${(m + (1 - P[i][1]) * k).toFixed(2)}`).join(" ") }, svg);
  }
  for (const [x, y] of P) make("circle", { cx: (m + x * k).toFixed(2), cy: (m + (1 - y) * k).toFixed(2), r: 2.3 }, svg);
  return svg;
}

function buildImages() {
  imgs = images(C.optimal);
  const box = $("images");
  box.replaceChildren();
  box.style.gridTemplateColumns = `repeat(${Math.min(4, imgs.length)}, minmax(0, 1fr))`;
  imgs.forEach((im, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb";
    b.setAttribute("aria-label", `The optimal configuration, ${im.symmetry.name}`);
    b.append(mini(im.points));
    const cap = document.createElement("span");
    cap.textContent = im.symmetry.short;
    b.append(cap);
    b.addEventListener("click", () => glideTo(imgs[k].points, false));
    box.append(b);
  });
  const count = imgs.length;
  $("images-note").innerHTML =
    `These ${word(count)} point sets reach ${Hn()}. They are the images of one configuration under the eight symmetries of the square, and Lean proves that no other set of ${word(C.n)} points does.`;
}

// Optimal places the image nearest the points; pressed again, the next one.
function optimal() {
  const k = currentImage();
  let next = 0;
  if (k >= 0) next = (k + 1) % imgs.length;
  else {
    let best = Infinity;
    imgs.forEach((im, j) => {
      const order = assignment(pts, im.points);
      const cost = order.reduce((s, i, q) => s + (pts[i][0] - im.points[q][0]) ** 2 + (pts[i][1] - im.points[q][1]) ** 2, 0);
      if (cost < best - 1e-12) {
        best = cost;
        next = j;
      }
    });
  }
  glideTo(imgs[next].points, false);
}

// ---------------------------------------------------------------- the cases

function choose(c, push = true) {
  stopImprove();
  finishGlide();
  C = c;
  for (const b of document.querySelectorAll(".case")) b.setAttribute("aria-pressed", +b.dataset.n === C.n ? "true" : "false");
  $("case-name").textContent = C.title;
  $("case-note").innerHTML = C.note;
  $("case-more").hidden = !C.more;
  if (C.more) {
    $("case-more-title").innerHTML = C.more.title;
    $("case-more-body").innerHTML = C.more.body;
  }
  $("case-proved").innerHTML = C.proved;
  $("reset").title = `Back to the start: ${C.startName}`;
  $("value").innerHTML = `${Hn()} = ${C.exact} ≈ ${C.value.toFixed(7)}`;
  board.setAttribute("aria-label", `${word(C.n)} points in the unit square, and the smallest triangles they make`);
  buildPoints();
  buildImages();
  pts = copy(C.start);
  sel = null;
  focusTri = null;
  chipKey = "";
  result = null;
  trail = null;
  drawClimb();
  update();
  if (push) writeHash();
}

function writeHash() {
  window.history.replaceState(null, "", `#n=${C.n}`);
}

function caseButtons() {
  const nav = $("cases");
  nav.hidden = CASES.length < 2;
  for (const c of CASES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "case";
    b.dataset.n = c.n;
    b.setAttribute("aria-label", c.title);
    b.append(mini(c.optimal));
    const cap = document.createElement("span");
    cap.innerHTML = `<i>n</i> = ${c.n}`;
    b.append(cap);
    b.addEventListener("click", () => choose(c));
    nav.append(b);
  }
}

// ------------------------------------------------------------- interaction

board.addEventListener("pointerdown", (e) => {
  const i = e.target.dataset && e.target.dataset.i !== undefined ? +e.target.dataset.i : null;
  board.classList.add("pointer");
  board.focus({ preventScroll: true, focusVisible: false });
  if (i === null) {
    sel = null;
    update();
    return;
  }
  stopImprove();
  finishGlide();
  sel = i;
  const [x, y] = toWorld(e);
  drag = { i, dx: x - pts[i][0], dy: y - pts[i][1] };
  board.setPointerCapture(e.pointerId);
  board.classList.add("dragging");
  e.preventDefault();
  update();
});

board.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const [x, y] = toWorld(e);
  pts[drag.i] = [clamp01(x - drag.dx), clamp01(y - drag.dy)];
  moved();
});

const endDrag = () => {
  drag = null;
  board.classList.remove("dragging");
};
board.addEventListener("pointerup", endDrag);
board.addEventListener("pointercancel", endDrag);
board.addEventListener("blur", () => board.classList.remove("pointer"));

board.addEventListener("keydown", (e) => {
  board.classList.remove("pointer");
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const n = pts.length;
  if (e.key === "Enter" || e.key === " ") {
    sel = sel === null ? (e.shiftKey ? n - 1 : 0) : (sel + (e.shiftKey ? n - 1 : 1)) % n;
    update();
  } else if (e.key === "Escape") {
    sel = null;
    update();
  } else if (sel !== null && arrows[e.key]) {
    stopImprove();
    finishGlide();
    const d = e.shiftKey ? 0.1 : 0.01;
    pts[sel] = [clamp01(pts[sel][0] + d * arrows[e.key][0]), clamp01(pts[sel][1] + d * arrows[e.key][1])];
    moved();
  } else return;
  e.preventDefault();
});

// A typed coordinate: a number, or a fraction such as 1/3.
function parse(text) {
  const s = text.replaceAll("−", "-").trim();
  const f = s.match(/^(-?\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  if (f) return +f[1] / +f[2];
  return /^-?\d*\.?\d+(e-?\d+)?$/i.test(s) ? +s : NaN;
}

for (const id of ["sel-x", "sel-y"]) {
  const input = $(id);
  const commit = () => {
    // Enter and the change event that follows it commit the same value once.
    if (input.value === input.dataset.shown) return;
    const v = parse(input.value);
    if (sel === null || !Number.isFinite(v)) return showPoints(true);
    stopImprove();
    finishGlide();
    const c = clamp01(v);
    pts[sel] = id === "sel-x" ? [c, pts[sel][1]] : [pts[sel][0], c];
    moved();
    showPoints(true);
    clearTimeout(clampTimer);
    $("sel-clamped").hidden = c === v;
    if (c !== v) clampTimer = setTimeout(() => ($("sel-clamped").hidden = true), 4000);
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
  });
}

$("margin").addEventListener("input", () => {
  margin = +$("margin").value / 100;
  $("margin-out").textContent = `${$("margin").value}%`;
  update();
});

$("reset").addEventListener("click", () => glideTo(C.start, false));
$("shuffle").addEventListener("click", () => glideTo(scatter(pts.length), true));
$("improve").addEventListener("click", () => (run ? stopImprove() : startImprove()));
$("optimal").addEventListener("click", optimal);
$("optimal").title = "Place the optimal configuration; press again for the next of its images";

// The colour theme, shared with the rest of vltanh.me through the same stored
// setting: system, light or dark, in that cycle.
const THEMES = ["system", "light", "dark"];
const ICONS = {
  system: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" class="solid"/></svg>',
  light:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z"/></svg>',
};

function storedTheme() {
  try {
    const t = localStorage.getItem("theme");
    return THEMES.includes(t) ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(t) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $("theme").innerHTML = ICONS[t];
  $("theme").title = `Colours: ${t === "system" ? "as the system" : t} (click to change)`;
  $("theme").setAttribute("aria-label", `Colour theme: ${t}`);
}

$("theme").addEventListener("click", () => {
  const t = THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length];
  try {
    localStorage.setItem("theme", t);
  } catch {
    // Without storage the choice lasts until the page is left.
  }
  applyTheme(t);
});
applyTheme(storedTheme());

function measure() {
  size = board.getBoundingClientRect().width || 600;
  board.setAttribute("viewBox", `0 0 ${size} ${size}`);
}

new ResizeObserver(() => {
  measure();
  drawSquare();
  update();
  drawClimb();
}).observe(board);

const fromHash = () => {
  const m = +(location.hash.match(/n=(\d+)/) || [])[1];
  return CASES.find((c) => c.n === m) || CASES[0];
};

$("margin-out").textContent = `${$("margin").value}%`;
margin = +$("margin").value / 100;
caseButtons();
measure();
drawSquare();
choose(fromHash(), false);
window.addEventListener("hashchange", () => choose(fromHash(), false));
