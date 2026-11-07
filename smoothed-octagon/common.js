// Helpers shared by the boards of the playground.

export const NS = "http://www.w3.org/2000/svg";
export const $ = (id) => document.getElementById(id);

export function make(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

export const pct = (d, digits = 2) => `${(100 * d).toFixed(digits)}%`;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A square SVG board whose viewBox is its size in pixels, showing the world
// square of centre (cx, cy) and half side `half`, with y pointing up.
export class Board {
  constructor(svg, view, onResize) {
    this.svg = svg;
    this.view = { ...view };
    this.size = 600;
    this.onResize = onResize;
    this.measure();
    new ResizeObserver(() => {
      const before = this.size;
      this.measure();
      if (this.size !== before && this.onResize) this.onResize();
    }).observe(svg);
  }

  measure() {
    this.size = this.svg.getBoundingClientRect().width || 600;
    this.svg.setAttribute("viewBox", `0 0 ${this.size} ${this.size}`);
  }

  get k() {
    return this.size / (2 * this.view.half);
  }

  X(x) {
    return this.size / 2 + (x - this.view.cx) * this.k;
  }

  Y(y) {
    return this.size / 2 - (y - this.view.cy) * this.k;
  }

  // the world rectangle in view, widened by `pad`
  bounds(pad = 0) {
    const { cx, cy, half } = this.view;
    return [cx - half - pad, cx + half + pad, cy - half - pad, cy + half + pad];
  }

  toWorld(e) {
    const r = this.svg.getBoundingClientRect();
    const k = r.width / (2 * this.view.half);
    return [this.view.cx + (e.clientX - r.left - r.width / 2) / k, this.view.cy + (r.top + r.height / 2 - e.clientY) / k];
  }

  // a path through world points
  path(pts, close = true) {
    if (!pts.length) return "";
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${this.X(x).toFixed(2)} ${this.Y(y).toFixed(2)}`).join("");
    return close ? `${d}Z` : d;
  }

  // a path through world points relative to the origin, in pixels, for <use>
  localPath(pts) {
    const k = this.k;
    return `${pts.map(([x, y], i) => `${i ? "L" : "M"}${(x * k).toFixed(2)} ${(-y * k).toFixed(2)}`).join("")}Z`;
  }
}

// Animates f(s), s from 0 to 1, over `ms` milliseconds (at once when motion
// is reduced). Returns a function that stops it.
export function tween(ms, f, done) {
  if (reducedMotion()) {
    f(1);
    if (done) done();
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const step = (now) => {
    const s = Math.min(1, (now - t0) / ms);
    f(s < 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s));
    if (s < 1) raf = requestAnimationFrame(step);
    else if (done) done();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

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

function applyTheme(button, t) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  button.innerHTML = ICONS[t];
  button.title = `Colours: ${t === "system" ? "as the system" : t} (click to change)`;
  button.setAttribute("aria-label", `Colour theme: ${t}`);
}

export function themeToggle(button) {
  button.addEventListener("click", () => {
    const t = THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length];
    try {
      localStorage.setItem("theme", t);
    } catch {
      // Without storage the choice lasts until the page is left.
    }
    applyTheme(button, t);
  });
  applyTheme(button, storedTheme());
}

// Per-viewer storage, which may be missing or blocked.
export function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the value lasts until the page is left.
  }
}
