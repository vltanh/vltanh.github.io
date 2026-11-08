/* If Only They Voted: model core.
   Decodes a year's data, builds each race's electorate (800 demographic cells),
   solves the race's level shift so the full electorate reproduces the actual
   result, and sums over whichever cells the reader selects.
   Runs in the browser (window.Model) and in Node (module.exports) for tests. */
(function (root) {
  "use strict";
  var NC = 800;
  var RACE = new Uint8Array(NC), EDUC = new Uint8Array(NC), INC = new Uint8Array(NC),
      SEX = new Uint8Array(NC), AGE = new Uint8Array(NC), RS = new Uint8Array(NC);
  for (var c = 0; c < NC; c++) {
    var x = c;
    AGE[c] = x % 4; x = (x / 4) | 0;
    SEX[c] = x % 2; x = (x / 2) | 0;
    INC[c] = x % 5; x = (x / 5) | 0;
    EDUC[c] = x % 4; x = (x / 4) | 0;
    RACE[c] = x;
    RS[c] = RACE[c] * 2 + SEX[c];
  }
  var COORD = { race: RACE, educ: EDUC, inc: INC, sex: SEX, age: AGE };
  var DIM_ORDER = ["race", "educ", "inc", "sex", "age"];

  function bytes(b64) {
    var s = atob(b64), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  function expit(x) { return 1 / (1 + Math.exp(-x)); }

  function decodeEta(b64, scale) {
    var e = new Int16Array(bytes(b64).buffer), f = new Float64Array(e.length);
    for (var i = 0; i < e.length; i++) f[i] = e[i] / scale;
    return f;
  }

  // base: data/<year>/base.json (electorate composition shared by every office)
  function decodeBase(raw) {
    var q = new Uint16Array(bytes(raw.comp).buffer);
    var S = raw.compScale.length, comp = new Float64Array(S * NC);
    for (var s = 0; s < S; s++) {
      var sum = 0, o = s * NC;
      for (var c = 0; c < NC; c++) { var v = q[o + c] / 65535 * raw.compScale[s]; comp[o + c] = v; sum += v; }
      for (c = 0; c < NC; c++) comp[o + c] /= sum;
    }
    return { raw: raw, comp: comp, eta: {}, offices: {}, cache: {} };
  }

  // office: data/<year>/<office>.json (vote model + races for one office)
  function addOffice(Y, office, raw) {
    Y.eta[office] = decodeEta(raw.eta, Y.raw.etaScale);
    Y.offices[office] = raw;
    delete Y.cache[office];
    return Y;
  }

  // delta such that sum_c w[c] * expit(eta[off+c] + delta) == target
  function solveDelta(w, eta, off, target) {
    var d = 0;
    for (var it = 0; it < 80; it++) {
      var f = 0, g = 0;
      for (var c = 0; c < NC; c++) {
        var p = expit(eta[off + c] + d);
        f += w[c] * p; g += w[c] * p * (1 - p);
      }
      var step = (f - target) / Math.max(g, 1e-12);
      if (step > 2) step = 2; else if (step < -2) step = -2;
      d -= step;
      if (Math.abs(step) < 1e-10) break;
    }
    return d;
  }

  // Rake a state's electorate to a district's margins:
  // m = [race x sex (10), age (4), educ (4), income (5)], each block sums to 1
  var BLOCKS = [[RS, 10, 0], [AGE, 4, 10], [EDUC, 4, 14], [INC, 5, 18]];
  function rake(seed, m) {
    var x = Float64Array.from(seed);
    for (var it = 0; it < 50; it++) {
      var worst = 0;
      for (var b = 0; b < BLOCKS.length; b++) {
        var idx = BLOCKS[b][0], k = BLOCKS[b][1], o = BLOCKS[b][2];
        var cur = new Float64Array(k), c;
        for (c = 0; c < NC; c++) cur[idx[c]] += x[c];
        var f = new Float64Array(k);
        for (var j = 0; j < k; j++) {
          f[j] = cur[j] > 0 ? m[o + j] / cur[j] : 0;
          worst = Math.max(worst, Math.abs(cur[j] - m[o + j]));
        }
        for (c = 0; c < NC; c++) x[c] *= f[idx[c]];
      }
      if (worst < 1e-7) break;
    }
    var s = 0;
    for (c = 0; c < NC; c++) s += x[c];
    if (s > 0) for (c = 0; c < NC; c++) x[c] /= s;
    return x;
  }

  function prepareOffice(Y, office) {
    if (Y.cache[office]) return Y.cache[office];
    var raw = Y.offices[office];
    var eta = Y.eta[office];
    var units = raw.units.map(function (u) {
      var s = u.st, base = Y.comp.subarray(s * NC, (s + 1) * NC);
      var w = (office === "rep" && u.m) ? rake(base, u.m) : Float64Array.from(base);
      var N = u.modeled ? (u.d + u.r) : (u.est || u.t || u.d + u.r || 0);
      var p = null, dl = null;
      if (u.modeled) {
        dl = solveDelta(w, eta, s * NC, u.share);
        p = new Float64Array(NC);
        for (var c = 0; c < NC; c++) p[c] = expit(eta[s * NC + c] + dl);
      }
      return Object.assign({}, u, { w: w, p: p, N: N, dl: dl });
    });
    var A = new Float64Array(NC), B = new Float64Array(NC), ALL = new Float64Array(NC);
    units.forEach(function (u) {
      for (var c = 0; c < NC; c++) {
        var v = u.N * u.w[c];
        ALL[c] += v;
        if (u.p) { B[c] += v; A[c] += v * u.p[c]; }
      }
    });
    var prep = { units: units, A: A, B: B, ALL: ALL };
    Y.cache[office] = prep;
    return prep;
  }

  // sel: {race:[bool x5], educ:[x4], inc:[x5], sex:[x2], age:[x4]} -> Uint8Array mask
  function maskFor(sel, override) {
    var m = new Uint8Array(NC);
    for (var c = 0; c < NC; c++) {
      var ok = 1;
      for (var i = 0; i < DIM_ORDER.length && ok; i++) {
        var d = DIM_ORDER[i], v = COORD[d][c];
        if (override && override.dim === d) ok = v === override.k ? 1 : 0;
        else ok = sel[d][v] ? 1 : 0;
      }
      m[c] = ok;
    }
    return m;
  }

  function cellsOf(mask) {
    var out = [];
    for (var c = 0; c < NC; c++) if (mask[c]) out.push(c);
    return out;
  }

  function evaluate(prep, mask) {
    var cells = cellsOf(mask);
    return prep.units.map(function (u) {
      var sel = 0;
      for (var i = 0; i < cells.length; i++) sel += u.w[cells[i]];
      if (!u.p) return { fixed: true, win: u.win || null, share: null, sel: sel, votes: sel * u.N };
      var h = 0;
      for (i = 0; i < cells.length; i++) { var c = cells[i]; h += u.w[c] * u.p[c]; }
      var share = sel > 1e-12 ? h / sel : null;
      var win = share === null ? null : share > 0.5 ? "D" : share < 0.5 ? "R" : "T";
      return { fixed: false, share: share, sel: sel, votes: sel * u.N, win: win };
    });
  }

  function national(prep, mask) {
    var a = 0, b = 0, all = 0, ta = 0;
    for (var c = 0; c < NC; c++) {
      ta += prep.ALL[c];
      if (mask[c]) { a += prep.A[c]; b += prep.B[c]; all += prep.ALL[c]; }
    }
    return { share: b > 0 ? a / b : null, votes: all, frac: ta > 0 ? all / ta : 0, twoParty: b };
  }

  // Parts of a state: its congressional districts. For the House these are the races
  // themselves. For a statewide race (president, Senate, governor) each district gets
  // the state's vote model, its own mix of voters, and its lean in House races
  // (relative to the state), with one shift solved so the districts add up to the
  // actual statewide result. Needs the year's House data loaded (Y.offices.rep).
  function stateParts(Y, office, ui) {
    var rep = prepareOffice(Y, "rep");
    var prep = prepareOffice(Y, office);
    var u = prep.units[ui], s = u.st;
    var ds = rep.units.filter(function (d) { return d.st === s; });
    if (office === "rep") {
      return ds.map(function (d) { return { id: d.id, n: d.n, cx: d.cx, cy: d.cy, w: d.w, p: d.p, N: d.N, win: d.win, unit: d }; });
    }
    var tot = 0, acc = 0, leans = [];
    ds.forEach(function (d) {
      if (!d.p) return;
      var wt = d.est || d.N;
      tot += wt; acc += wt * d.dl; leans.push(d.dl);
    });
    var mean = tot ? acc / tot : 0;
    var hi = leans.length ? Math.max.apply(null, leans) - mean : 0, lo = leans.length ? Math.min.apply(null, leans) - mean : 0;
    var parts = ds.map(function (d) {
      // a House seat the other party didn't contest: lean at least as far as the state's most lopsided contested seat
      var lean = d.p ? d.dl - mean : d.win === "D" ? Math.max(hi, 0.8) : d.win === "R" ? Math.min(lo, -0.8) : 0;
      return { d: d, lean: lean, share: d.est || d.N || 1 };
    });
    var totS = parts.reduce(function (a, x) { return a + x.share; }, 0);
    parts.forEach(function (x) { x.share /= totS; });
    var off = s * NC, eta = Y.eta[office];
    var k = 0;
    if (u.p) {
      for (var it = 0; it < 80; it++) {
        var f = 0, g = 0;
        parts.forEach(function (x) {
          for (var c = 0; c < NC; c++) {
            var p = expit(eta[off + c] + k + x.lean), wc = x.share * x.d.w[c];
            f += wc * p; g += wc * p * (1 - p);
          }
        });
        var step = (f - u.share) / Math.max(g, 1e-12);
        if (step > 2) step = 2; else if (step < -2) step = -2;
        k -= step;
        if (Math.abs(step) < 1e-10) break;
      }
    }
    return parts.map(function (x) {
      var p = null;
      if (u.p) {
        p = new Float64Array(NC);
        for (var c = 0; c < NC; c++) p[c] = expit(eta[off + c] + k + x.lean);
      }
      return { id: x.d.id, n: x.d.n, cx: x.d.cx, cy: x.d.cy, w: x.d.w, p: p, N: u.N * x.share, win: u.win, unit: x.d };
    });
  }

  var api = { NC: NC, COORD: COORD, DIM_ORDER: DIM_ORDER, decodeBase: decodeBase, addOffice: addOffice, prepareOffice: prepareOffice,
              maskFor: maskFor, evaluate: evaluate, stateParts: stateParts, national: national, rake: rake, solveDelta: solveDelta };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Model = api;
})(typeof window !== "undefined" ? window : globalThis);
