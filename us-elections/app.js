/* If Only They Voted — page logic. The model itself (decoding, district electorates,
   pinning each race to its real result) lives in model.js. */
(function () {
  "use strict";
  var M = window.Model;

  var DIMS = [
    { key: "race", title: "Race & ethnicity", opts: ["White", "Black", "Hispanic", "Asian", "Other"],
      long: ["White, not Hispanic", "Black", "Hispanic or Latino", "Asian", "Other or multiracial"] },
    { key: "educ", title: "Education", tag: "Education", opts: ["HS or less", "Some college", "Bachelor's", "Postgrad"],
      long: ["High school or less", "Some college or an associate degree", "Bachelor's degree", "Graduate degree"] },
    { key: "inc", title: "Family income", tag: "Income", opts: ["Under $30k", "$30–50k", "$50–100k", "$100–150k", "$150k+"] },
    { key: "sex", title: "Gender", opts: ["Men", "Women"] },
    { key: "age", title: "Age", tag: "Age", opts: ["18–29", "30–44", "45–64", "65+"] }
  ];
  var OFFICES = [["pres", "President"], ["sen", "Senate"], ["rep", "House"], ["gov", "Governor"]];
  var SLUG = { pres: "president", sen: "senate", rep: "house", gov: "governor" };
  var VP_AFTER = { 2024: "R", 2022: "D", 2020: "D", 2018: "R", 2016: "R", 2014: "D", 2012: "D" };
  var OFFICIAL_EV = {
    2016: "Official electoral count: Trump 304, Clinton 227, after seven faithless electors and Trump's win in Maine's 2nd district. Here every state is winner-take-all."
  };

  var S = {
    meta: null, geo: null, years: {}, dgeo: {},
    year: null, office: null, focus: null, parts: null, pres: null, shade: true,
    picks: { race: [], educ: [], inc: [], sex: [], age: [] },
    prep: null, res: null, base: null, map: null, shown: {}, fresh: true
  };

  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = "http://www.w3.org/2000/svg";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function sv(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function getJSON(u) {
    return fetch(u).then(function (r) {
      if (!r.ok) throw new Error(u + " (" + r.status + ")");
      return r.json();
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ------------------------------------------------------------------ picks
  function sel() {
    var o = {};
    DIMS.forEach(function (d) {
      var p = S.picks[d.key];
      o[d.key] = d.opts.map(function (_, k) { return p.length === 0 || p.indexOf(k) >= 0; });
    });
    return o;
  }
  function anyPicks() {
    return DIMS.some(function (d) { var n = S.picks[d.key].length; return n > 0 && n < d.opts.length; });
  }
  function togglePick(dim, k) {
    var p = S.picks[dim], i = p.indexOf(k);
    if (i >= 0) p.splice(i, 1); else { p.push(k); p.sort(); }
    update();
  }

  // ------------------------------------------------------------------ formatting
  function fmtM(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M";
    if (v >= 1e3) return Math.round(v / 1e3) + "K";
    return String(Math.round(v));
  }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 1 : d) + "%"; }
  function marginTxt(share, names) {
    if (share == null) return "–";
    var m = (2 * share - 1) * 100, a = Math.abs(m);
    if (a < 0.05) return "Even";
    var who = m > 0 ? (names ? names[0] : "D") : (names ? names[1] : "R");
    return who + (names ? " +" : "+") + (a < 10 ? a.toFixed(1) : a.toFixed(0));
  }
  function stepOf(share) {
    var a = Math.abs(2 * share - 1) * 100;
    return a < 5 ? 1 : a < 15 ? 2 : a < 30 ? 3 : 4;
  }
  function fillFor(share, win) {
    if (share == null) {
      if (win === "D" || win === "R") return "var(--" + win.toLowerCase() + (S.shade ? "4" : "3") + ")";
      return "var(--empty)";
    }
    if (share === 0.5) return "var(--tie)";
    return "var(--" + (share > 0.5 ? "d" : "r") + (S.shade ? stepOf(share) : 3) + ")";
  }
  function inkFor(share, win) {
    if (share == null) return win === "D" || win === "R" ? "var(--on-" + win.toLowerCase() + (S.shade ? "4" : "3") + ")" : "var(--ink-2)";
    return "var(--on-" + (share > 0.5 ? "d" : "r") + (S.shade ? stepOf(share) : 3) + ")";
  }

  // ------------------------------------------------------------------ names
  function stName(i) { return S.meta.states[i][2]; }
  function stPo(i) { return S.meta.states[i][1]; }
  function Y() { return S.years[S.year]; }
  function officeData() { return Y().offices[S.office]; }
  function unitName(u) {
    if (S.office === "rep") return stPo(u.st) + "-" + (u.n === 0 ? "AL" : u.n);
    return stName(u.st) + (u.sp ? " (special)" : "");
  }
  function sideNames() { return S.office === "pres" ? S.meta.years[S.year].pres : ["Democrats", "Republicans"]; }
  function lastName(n) {
    n = String(n).replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();
    var parts = n.split(/\s+/), last = parts[parts.length - 1];
    if (/^[A-Z][A-Z'\-]+$/.test(last) && last.length > 2) last = last.charAt(0) + last.slice(1).toLowerCase();
    return last;
  }
  function candNames(u) {
    if (S.office === "pres") return S.meta.years[S.year].pres;
    return [u.dn ? lastName(u.dn) : "Democrat", u.rn ? lastName(u.rn) : "Republican"];
  }
  function partyTag(u) { return u.dp && !/^DEM/i.test(u.dp) ? "I" : "D"; }
  function officePhrase() {
    return { pres: "the " + S.year + " presidential election", sen: "the " + S.year + " Senate races",
             rep: "the " + S.year + " House elections", gov: "the " + S.year + " governor races" }[S.office];
  }

  // ------------------------------------------------------------------ loading
  function loadYear(y) {
    if (S.years[y]) return Promise.resolve(S.years[y]);
    return getJSON("data/" + y + "/base.json").then(function (raw) { S.years[y] = M.decodeBase(raw); return S.years[y]; });
  }
  function loadOffice(y, off) {
    return loadYear(y).then(function (Yr) {
      if (Yr.offices[off]) return Yr;
      return getJSON("data/" + y + "/" + off + ".json").then(function (raw) { M.addOffice(Yr, off, raw); return Yr; });
    });
  }
  function loadDistricts(y) {
    if (S.dgeo[y]) return Promise.resolve(S.dgeo[y]);
    return getJSON("data/" + y + "/districts.json").then(function (g) { S.dgeo[y] = g; return g; });
  }

  // ------------------------------------------------------------------ election pickers
  function renderPickers() {
    var ys = $("year");
    if (!ys.options.length) {
      Object.keys(S.meta.years).sort().reverse().forEach(function (y) { ys.appendChild(el("option", { value: y }, y)); });
    }
    ys.value = String(S.year);
    var os = $("office"), avail = S.meta.years[S.year].offices;
    os.innerHTML = "";
    OFFICES.forEach(function (o) {
      var opt = el("option", { value: o[0] }, o[1] + (avail.indexOf(o[0]) < 0 ? " (none in " + S.year + ")" : ""));
      if (avail.indexOf(o[0]) < 0) opt.disabled = true;
      os.appendChild(opt);
    });
    os.value = S.office;
    $("ballotCode").textContent = S.year + " · " + OFFICES.filter(function (o) { return o[0] === S.office; })[0][1];
  }

  function setElection(year, office) {
    var avail = S.meta.years[year].offices;
    if (avail.indexOf(office) < 0) office = avail.indexOf("pres") >= 0 ? "pres" : "sen";
    S.year = year;
    S.office = office;
    renderPickers();
    writeHash();
    $("mapbox").innerHTML = '<div class="loading">Counting ' + year + "…</div>";
    return loadOffice(year, office).then(function (Yr) {
      if (S.year !== year || S.office !== office) return;
      S.prep = M.prepareOffice(Yr, office);
      S.base = M.evaluate(S.prep, M.maskFor(allSel()));
      refocus();
      return buildMap().then(function () { update(); renderBench(Yr); });
    }).catch(showError);
  }
  function allSel() {
    var o = {};
    DIMS.forEach(function (d) { o[d.key] = d.opts.map(function () { return true; }); });
    return o;
  }
  function showError(e) {
    if (window.console) console.error(e);
    $("mapbox").innerHTML = '<div class="err">This election\'s data didn\'t load (' + esc(e.message) + "). Pick another year, or reload the page.</div>";
  }

  // ------------------------------------------------------------------ hash: #2024-president/race=2.3/sex=1
  function writeHash() {
    var parts = [S.year + "-" + SLUG[S.office]];
    if (S.focus) parts.push("in=" + stPo(S.focus.st));
    DIMS.forEach(function (d) { if (S.picks[d.key].length) parts.push(d.key + "=" + S.picks[d.key].join(".")); });
    try { history.replaceState(null, "", "#" + parts.join("/")); } catch (e) { /* ignore */ }
  }
  function readHash() {
    var h = decodeURIComponent((location.hash || "").slice(1));
    if (!h) return null;
    var parts = h.split("/"), m = /^(\d{4})-(president|senate|house|governor)$/.exec(parts[0]);
    var out = { year: null, office: null, picks: {} };
    if (m) {
      out.year = +m[1];
      out.office = { president: "pres", senate: "sen", house: "rep", governor: "gov" }[m[2]];
    }
    parts.slice(1).forEach(function (p) {
      var kv = p.split("="), d = DIMS.filter(function (x) { return x.key === kv[0]; })[0];
      if (kv[0] === "in") { out.inState = kv[1]; return; }
      if (!d || !kv[1]) return;
      out.picks[d.key] = kv[1].split(".").map(Number).filter(function (k) { return k >= 0 && k < d.opts.length; });
    });
    return out;
  }

  // ------------------------------------------------------------------ ballot
  function buildBallot() {
    var box = $("contests");
    DIMS.forEach(function (d) {
      var fs = el("fieldset", { "class": "contest" });
      fs.appendChild(el("legend", null, '<span class="contest-head"><b>' + esc(d.title) + "</b><small>Mark any number</small></span>"));
      d.opts.forEach(function (o, k) {
        var b = el("button", { type: "button", "class": "opt", "data-dim": d.key, "data-k": k, "aria-pressed": "false" },
          '<span class="oval" aria-hidden="true"></span><span class="lab">' + esc(o) + '</span><span class="pct" data-pct></span>' +
          '<span class="lean" aria-hidden="true"><i data-bar></i></span><span class="mg" data-mg></span>');
        b.addEventListener("click", function () { togglePick(d.key, k); });
        fs.appendChild(b);
      });
      box.appendChild(fs);
    });
    $("erase").addEventListener("click", function () {
      DIMS.forEach(function (d) { S.picks[d.key] = []; });
      update();
    });
  }
  function updateBallot() {
    var prep = S.prep, names = sideNames(), tot = 0, c;
    for (c = 0; c < M.NC; c++) tot += prep.ALL[c];
    var cur = sel();
    DIMS.forEach(function (d) {
      var coord = M.COORD[d.key];
      d.opts.forEach(function (o, k) {
        var b = document.querySelector('.opt[data-dim="' + d.key + '"][data-k="' + k + '"]');
        b.setAttribute("aria-pressed", String(S.picks[d.key].indexOf(k) >= 0));
        var share = 0;
        for (c = 0; c < M.NC; c++) if (coord[c] === k) share += prep.ALL[c];
        b.querySelector("[data-pct]").textContent = Math.round((share / tot) * 100) + "%";
        var nat = M.national(prep, M.maskFor(cur, { dim: d.key, k: k }));
        var bar = b.querySelector("[data-bar]"), mg = b.querySelector("[data-mg]");
        if (nat.share == null) { bar.style.width = "0"; mg.textContent = "–"; return; }
        var m = 2 * nat.share - 1, w = Math.min(Math.abs(m), 1) * 50;
        bar.style.width = w + "%";
        bar.style.left = m > 0 ? 50 - w + "%" : "50%";
        bar.style.background = m > 0 ? "var(--d3)" : "var(--r3)";
        mg.textContent = marginTxt(nat.share);
        b.title = (d.long ? d.long[k] : o) + ": " + pct(share / tot, 0) + " of " + S.year + " voters. With your other marks, " +
          names[0] + " " + pct(nat.share) + ", " + names[1] + " " + pct(1 - nat.share) + ".";
      });
    });
    $("erase").disabled = !DIMS.some(function (d) { return S.picks[d.key].length; });
  }

  function renderCounting(nat) {
    var box = $("counting");
    box.innerHTML = "";
    if (!anyPicks()) {
      box.innerHTML = '<span class="lead">Counting</span><span><b>every voter</b>, as in the actual result of ' + esc(officePhrase()) + '.</span><a class="jump" href="#ballot">Pick who counts ↓</a>';
      return;
    }
    box.appendChild(el("span", { "class": "lead" }, "Counting only"));
    DIMS.forEach(function (d) {
      var p = S.picks[d.key];
      if (!p.length || p.length === d.opts.length) return;
      p.forEach(function (k) {
        var chip = el("button", { type: "button", "class": "chip", "aria-label": "Stop counting only " + d.opts[k] },
          (d.tag ? "<small>" + esc(d.tag) + "</small>" : "") + esc(d.opts[k]) + '<span class="x" aria-hidden="true">×</span>');
        chip.addEventListener("click", function () { togglePick(d.key, k); });
        box.appendChild(chip);
      });
    });
    box.appendChild(el("span", null, "· " + pct(nat.frac) + " of " + S.year + " voters"));
    box.appendChild(el("a", { "class": "jump", href: "#ballot" }, "Change who counts ↓"));
  }

  // ------------------------------------------------------------------ totals & headline
  function notUp() { return officeData().notUp || []; }
  function totals(res) {
    var units = S.prep.units, t = { D: 0, R: 0, T: 0, I: 0 };
    if (S.office === "pres") {
      res.forEach(function (r, i) { var ev = units[i].ev; if (r.win === "D") t.D += ev; else if (r.win === "R") t.R += ev; else t.T += ev; });
      return t;
    }
    res.forEach(function (r) { if (r.win === "D") t.D++; else if (r.win === "R") t.R++; else t.T++; });
    notUp().forEach(function (n) { if (n.side === "D") t.D++; else if (n.side === "R") t.R++; else t.I++; });
    return t;
  }
  function N(key, v) { return '<span class="n" data-k="' + key + '" data-v="' + v + '">' + v + "</span>"; }
  function verdict(t) {
    var names = sideNames(), off = S.office;
    if (off === "pres") {
      if (t.D >= 270) return { side: "d", html: esc(names[0]) + " wins " + N("a", t.D) + "–" + N("b", t.R) };
      if (t.R >= 270) return { side: "r", html: esc(names[1]) + " wins " + N("a", t.R) + "–" + N("b", t.D) };
      return { side: "", html: "No one reaches 270: " + N("a", t.D) + "–" + N("b", t.R) };
    }
    if (off === "sen" && t.D + t.R + t.T + t.I < 100) {
      return { side: t.D > t.R ? "d" : "r", html: (t.D >= t.R ? "Democrats win " + N("a", t.D) : "Republicans win " + N("a", t.R)) + " of " + (t.D + t.R + t.T) + " races" };
    }
    if (off === "sen") {
      if (t.D > 50) return { side: "d", html: "Democrats control the Senate, " + N("a", t.D) + "–" + N("b", t.R) };
      if (t.R > 50) return { side: "r", html: "Republicans control the Senate, " + N("a", t.R) + "–" + N("b", t.D) };
      var vp = VP_AFTER[S.year];
      return { side: vp === "D" ? "d" : "r", html: "A " + N("a", 50) + "–" + N("b", 50) + " Senate, run by " + (vp === "D" ? "Democrats" : "Republicans") + " through the vice president" };
    }
    if (off === "rep") {
      if (t.D >= 218) return { side: "d", html: "Democrats win the House, " + N("a", t.D) + "–" + N("b", t.R) };
      if (t.R >= 218) return { side: "r", html: "Republicans win the House, " + N("a", t.R) + "–" + N("b", t.D) };
      return { side: "", html: "No House majority: " + N("a", t.D) + "–" + N("b", t.R) };
    }
    if (t.D >= t.R) return { side: t.D > t.R ? "d" : "", html: "Democrats hold " + N("a", t.D) + " governorships, Republicans " + N("b", t.R) };
    return { side: "r", html: "Republicans hold " + N("a", t.R) + " governorships, Democrats " + N("b", t.D) };
  }
  function actualText(t) {
    var names = sideNames();
    if (S.office === "pres") return t.D > t.R ? names[0] + " " + t.D + "–" + t.R : names[1] + " " + t.R + "–" + t.D;
    if (S.office === "gov") return "R " + t.R + ", D " + t.D + (t.I ? ", I " + t.I : "");
    return t.D >= t.R ? "D " + t.D + "–" + t.R : "R " + t.R + "–" + t.D;
  }

  function animateNums(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".n[data-k]"), function (span) {
      var key = root.id + span.dataset.k, to = +span.dataset.v, from = S.shown[key];
      S.shown[key] = to;
      if (reduceMotion || from == null || from === to || S.fresh) { span.textContent = to; return; }
      var t0 = performance.now(), dur = 380;
      (function step(now) {
        var x = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - x, 3);
        span.textContent = Math.round(from + (to - from) * e);
        if (x < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  // ------------------------------------------------------------------ update
  function update() {
    if (!S.prep) return;
    var mask = M.maskFor(sel());
    var res = M.evaluate(S.prep, mask);
    S.res = res;
    var t = totals(res), tb = totals(S.base), v = verdict(t), nat = M.national(S.prep, mask), names = sideNames();
    renderCounting(nat);
    $("headline").innerHTML = '<span class="' + v.side + '">' + v.html + "</span>";
    animateNums($("headline"));
    var f = [];
    if (anyPicks()) f.push("<span>Actual: <b>" + esc(actualText(tb)) + "</b></span>");
    f.push("<span>These voters: <b>" + pct(nat.frac) + "</b> of the ballots (≈" + fmtM(nat.votes) + ")</span>");
    if (nat.share != null) {
      var lab = S.office === "rep" ? "House vote, contested seats" : S.office === "pres" ? "Popular vote" : "Vote in these races";
      var a = names[0] === "Democrats" ? "D" : names[0], b = names[1] === "Republicans" ? "R" : names[1];
      f.push("<span>" + lab + ": <b>" + esc(a) + " " + pct(nat.share) + ", " + esc(b) + " " + pct(1 - nat.share) + "</b></span>");
    }
    if (anyPicks()) {
      var flips = 0;
      res.forEach(function (r, i) { if (!r.fixed && r.win && S.base[i].win && r.win !== S.base[i].win) flips++; });
      f.push("<span><b>" + flips + "</b> " + (flips === 1 ? "race changes hands" : "races change hands") + "</span>");
    }
    if (S.office === "pres" && OFFICIAL_EV[S.year]) f.push('<span class="note">' + esc(OFFICIAL_EV[S.year]) + "</span>");
    $("facts").innerHTML = f.join("");
    renderTally(res, t);
    if (S.focus && S.parts) updateStateView(mask); else recolor(res);
    renderKey(res);
    renderTable(res);
    updateBallot();
    writeHash();
    S.fresh = false;
  }

  // ------------------------------------------------------------------ tally (states or seats, sorted by margin)
  function renderTally(res, t) {
    var off = S.office, units = S.prep.units, names = sideNames(), nu = notUp();
    var segs = res.map(function (r, i) {
      return { i: i, w: off === "pres" ? units[i].ev : 1, r: r,
               s: r.share != null ? r.share : r.win === "D" ? 1.01 : r.win === "R" ? -0.01 : 0.5 };
    });
    segs.sort(function (a, b) { return b.s - a.s; });
    var nuD = nu.filter(function (n) { return n.side === "D"; }).length, nuR = nu.filter(function (n) { return n.side === "R"; }).length;
    var nuI = nu.length - nuD - nuR;
    var total = segs.reduce(function (a, s) { return a + s.w; }, 0) + nu.length;
    var svg = sv("svg", { viewBox: "0 0 1000 34", preserveAspectRatio: "none", role: "img",
                          "aria-label": "Seats sorted from most Democratic to most Republican" });
    var defs = sv("defs"), pat = sv("pattern", { id: "nuHatch", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pat.appendChild(sv("rect", { width: 2, height: 5, fill: "var(--card)", "fill-opacity": ".7" }));
    defs.appendChild(pat);
    svg.appendChild(defs);
    var x = 0, unit = 1000 / total, gap = total > 200 ? 0.35 : 1.2;
    function seg(w, fill, hatch, i) {
      var r = sv("rect", { x: x, y: 0, width: Math.max(w * unit - gap, 0.4), height: 34, fill: fill });
      if (i != null) { r.dataset.u = i; r.setAttribute("class", "u"); r.style.stroke = "none"; }
      svg.appendChild(r);
      if (hatch) svg.appendChild(sv("rect", { x: x, y: 0, width: Math.max(w * unit - gap, 0.4), height: 34, fill: "url(#nuHatch)" }));
      x += w * unit;
    }
    if (nuD) seg(nuD, "var(--d2)", true);
    segs.forEach(function (s) { seg(s.w, fillFor(s.r.share, s.r.win), false, s.i); });
    if (nuI) seg(nuI, "var(--tie)", true);
    if (nuR) seg(nuR, "var(--r2)", true);
    svg.appendChild(sv("line", { x1: 500, x2: 500, y1: -6, y2: 40, stroke: "var(--ink)", "stroke-width": 2 }));
    var need = { pres: "270 to win", sen: "51 for control", rep: "218 for control", gov: "" }[off];
    var dLab = off === "pres" ? names[0] : "Democrats", rLab = off === "pres" ? names[1] : "Republicans";
    var unitWord = off === "pres" ? "electoral votes" : off === "gov" ? "governors" : "seats";
    var dSub = unitWord + (nu.length ? ", incl. " + nuD + " not up" : ""), rSub = unitWord + (nu.length ? ", incl. " + nuR + " not up" : "");
    var box = $("tally");
    box.innerHTML = '<div class="tally-top"><div class="side d">' + esc(dLab) + " " + N("d", t.D) + "<small>" + esc(dSub) + "</small></div>" +
      '<div class="tally-mid">' + esc(need) + (nu.length ? '<span class="extra"><br>' + nu.length + " not up this year (hatched)</span>" : "") + "</div>" +
      '<div class="side r">' + N("r", t.R) + " " + esc(rLab) + "<small>" + esc(rSub) + "</small></div></div>";
    box.appendChild(svg);
    animateNums(box);
  }


  // ------------------------------------------------------------------ one state, district by district
  function bindOpen(root) {
    root.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-u]") : null;
      if (!t || t.dataset.u === "") return;
      openState(+t.dataset.u.split(",")[0]);
    });
  }
  function openState(ui) {
    var u = S.prep.units[ui];
    if (!u || stPo(u.st) === "DC") return;
    S.focus = { st: u.st, ui: S.office === "rep" ? null : ui };
    tip.hidden = true;
    buildMap().then(function () {
      update();
      $("mapbox").scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    }).catch(showError);
  }
  function closeState() {
    if (!S.focus) return;
    S.focus = null;
    S.parts = null;
    buildMap().then(update).catch(showError);
  }
  // keep the close-up when the year or office changes, if that state still has a race
  function refocus() {
    if (!S.focus) return;
    var st = S.focus.st, i = S.prep.units.findIndex(function (u) { return u.st === st && !u.sp; });
    if (i < 0) i = S.prep.units.findIndex(function (u) { return u.st === st; });
    if (i < 0) { S.focus = null; return; }
    S.focus.ui = S.office === "rep" ? null : i;
  }

  function buildStateView() {
    var st = S.focus.st, off = S.office, Yr = Y();
    return Promise.all([loadOffice(S.year, "rep"), loadDistricts(S.year)]).then(function (r) {
      var dg = r[1], box = $("mapbox");
      var ui = S.focus.ui != null ? S.focus.ui : S.prep.units.findIndex(function (u) { return u.st === st; });
      if (off === "rep") ui = M.prepareOffice(Yr, "rep").units.findIndex(function (u) { return u.st === st; });
      S.parts = M.stateParts(Yr, off, ui);
      box.innerHTML = "";
      var bar = el("div", { "class": "statebar" });
      var back = el("button", { type: "button", "class": "back" }, "&larr; All states");
      back.addEventListener("click", closeState);
      bar.appendChild(back);
      bar.appendChild(el("div", { "class": "st-title" }, "<h3>" + esc(stName(st)) + '</h3><span class="st-sum" id="stSum"></span>'));
      var races = S.prep.units.map(function (u, i) { return i; }).filter(function (i) { return S.prep.units[i].st === st; });
      if (off !== "rep" && races.length > 1) {
        var seg = el("div", { "class": "seg", role: "group", "aria-label": "Which race" });
        races.forEach(function (i) {
          var b = el("button", { type: "button", "aria-pressed": String(i === S.focus.ui) }, S.prep.units[i].sp ? "Special election" : "Regular election");
          b.addEventListener("click", function () { if (S.focus.ui !== i) { S.focus.ui = i; buildMap().then(update); } });
          seg.appendChild(b);
        });
        bar.appendChild(seg);
      }
      box.appendChild(bar);

      var svg = sv("svg", { "class": "statemap", role: "img", "aria-label": stName(st) + " by congressional district" });
      var defs = sv("defs");
      svg.appendChild(defs);
      var fips = S.meta.states[st][0];
      var districtD = Object.keys(dg).filter(function (id) { return id.slice(0, 2) === fips; }).map(function (id) { return dg[id]; });
      function drawBase(g) {
        g.appendChild(sv("path", { d: S.geo.states[st].d, "class": "stline" }));
        districtD.forEach(function (d) { g.appendChild(sv("path", { d: d, "class": "dline" })); });
      }
      var gBase = sv("g");
      drawBase(gBase);
      svg.appendChild(gBase);
      box.appendChild(svg);
      var B = gBase.getBBox();
      var parts = S.parts, n = parts.length;
      var totN = parts.reduce(function (a, p) { return a + p.N; }, 0);
      var k = Math.sqrt((0.15 * B.width * B.height) / (Math.PI * Math.max(totN, 1)));
      var r0 = parts.map(function (p) { return k * Math.sqrt(p.N); });
      var sf = Math.max(B.width, B.height) / 560;

      // packed clusters (a big city's districts) get a magnified inset beside the state
      var insets = findClusters(parts, r0, B);
      var inInset = new Array(n).fill(-1);
      insets.forEach(function (ins, q) { ins.m.forEach(function (i) { inInset[i] = q; }); });
      var tall = B.height > B.width * 0.9, gap = 0.05 * Math.max(B.width, B.height);
      if (tall) {
        insets.sort(function (a, b) { return a.cy - b.cy; });
        var y = B.y;
        insets.forEach(function (ins) { ins.x = B.x + B.width + gap; ins.y = Math.max(y, ins.cy - ins.h / 2); y = ins.y + ins.h + gap + 14 * (Math.max(B.width, B.height) / 560); });
      } else {
        insets.sort(function (a, b) { return a.cx - b.cx; });
        var x = B.x;
        insets.forEach(function (ins) { ins.y = B.y + B.height + gap; ins.x = Math.max(x, ins.cx - ins.w / 2); x = ins.x + ins.w + gap; });
      }
      insets.forEach(function (ins, q) { ins.m.forEach(function (i) { inInset[i] = q; }); });
      var gMarks = sv("g"), gC = sv("g"), gL = sv("g");
      svg.appendChild(gMarks);
      insets.forEach(function (ins, q) {
        ins.tx = ins.x + ins.pad - ins.bc.x0 * ins.mag;
        ins.ty = ins.y + ins.pad - ins.bc.y0 * ins.mag;
        var cid = "inset-clip-" + q;
        var cp = sv("clipPath", { id: cid });
        cp.appendChild(sv("rect", { x: ins.x, y: ins.y, width: ins.w, height: ins.h }));
        defs.appendChild(cp);
        var g = sv("g", { "class": "inset" });
        g.appendChild(sv("rect", { x: ins.x, y: ins.y, width: ins.w, height: ins.h, "class": "inset-frame" }));
        var gc = sv("g", { "clip-path": "url(#" + cid + ")" });
        var gt = sv("g", { transform: "translate(" + ins.tx.toFixed(2) + " " + ins.ty.toFixed(2) + ") scale(" + ins.mag.toFixed(3) + ")" });
        drawBase(gt);
        gc.appendChild(gt);
        g.appendChild(gc);
        var tag = sv("text", { x: ins.x + ins.w, y: ins.y + ins.h + 10 * sf, "class": "inset-tag", "text-anchor": "end", "font-size": (9 * sf).toFixed(2) });
        tag.textContent = "Zoomed in ×" + Math.round(ins.mag);
        g.appendChild(tag);
        svg.insertBefore(g, gMarks);
        // outline of the zoomed area on the state, joined to its inset
        var e = ins.pad / ins.mag;
        var mk = { x: ins.bc.x0 - e, y: ins.bc.y0 - e, w: ins.bc.x1 - ins.bc.x0 + 2 * e, h: ins.bc.y1 - ins.bc.y0 + 2 * e };
        gMarks.appendChild(sv("rect", { x: mk.x, y: mk.y, width: mk.w, height: mk.h, "class": "inset-mark" }));
        var from = tall ? [mk.x + mk.w, mk.y + mk.h / 2] : [mk.x + mk.w / 2, mk.y + mk.h];
        var to = tall ? [ins.x, ins.y + Math.min(ins.h / 2, 30 * sf)] : [ins.x + Math.min(ins.w / 2, 30 * sf), ins.y];
        gMarks.appendChild(sv("line", { x1: from[0], y1: from[1], x2: to[0], y2: to[1], "class": "inset-mark" }));
      });
      svg.appendChild(gC);
      svg.appendChild(gL);

      // where each circle wants to be: its district, or its district inside the inset
      S.focus.circles = parts.map(function (p, j) {
        var q = inInset[j], ax = p.cx, ay = p.cy;
        if (q >= 0) { ax = insets[q].tx + p.cx * insets[q].mag; ay = insets[q].ty + p.cy * insets[q].mag; }
        var c = sv("circle", { cx: ax, cy: ay, r: 0, "class": "u pc" + (off === "rep" && p.unit.key ? " key" : "") });
        c.dataset.p = j;
        gC.appendChild(c);
        var t = sv("text", { x: ax, y: ay, "class": "lbl plbl" });
        t.textContent = p.n === 0 ? "AL" : p.n;
        gL.appendChild(t);
        return { c: c, t: t, ax: ax, ay: ay, q: q };
      });
      S.focus.geom = { sf: sf, k: k, insets: insets };

      // frame everything at full size (every circle at its largest, laid out once)
      var nodes = layoutNodes(r0);
      var x0 = B.x, y0 = B.y, x1 = B.x + B.width, y1 = B.y + B.height;
      nodes.forEach(function (nd) { x0 = Math.min(x0, nd.x - nd.r); y0 = Math.min(y0, nd.y - nd.r); x1 = Math.max(x1, nd.x + nd.r); y1 = Math.max(y1, nd.y + nd.r); });
      insets.forEach(function (ins) { x0 = Math.min(x0, ins.x); y0 = Math.min(y0, ins.y); x1 = Math.max(x1, ins.x + ins.w); y1 = Math.max(y1, ins.y + ins.h + 13 * sf); });
      var pd = 0.03 * Math.max(x1 - x0, y1 - y0);
      svg.setAttribute("viewBox", [x0 - pd, y0 - pd, x1 - x0 + 2 * pd, y1 - y0 + 2 * pd].map(function (v) { return v.toFixed(2); }).join(" "));

      box.appendChild(el("ol", { "class": "parts", id: "partsList" }));
      bindHover(box);
      $("mapnote").textContent = (off === "rep"
        ? "Each circle is a House district, placed where it is and sized by the ballots counted there. Hover for the race."
        : "Each circle is a congressional district, sized by the ballots counted there. District results for this race are estimates: each district's mix of voters plus its lean in House races, adjusted so the districts add up to the real statewide result. A popular House member can tilt a district's estimate.") +
        (insets.length ? " Crowded city districts are drawn in a zoomed-in box." : "");
      renderLegend();
    });
  }

  function bboxOf(parts, ids) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    ids.forEach(function (i) { var p = parts[i]; b.x0 = Math.min(b.x0, p.cx); b.y0 = Math.min(b.y0, p.cy); b.x1 = Math.max(b.x1, p.cx); b.y1 = Math.max(b.y1, p.cy); });
    return b;
  }
  // Groups of districts whose circles would pile on top of each other (a city), small
  // enough that a magnified inset helps.
  function findClusters(parts, r0, B) {
    var n = parts.length;
    function near(i, j, f) { var dx = parts[i].cx - parts[j].cx, dy = parts[i].cy - parts[j].cy; return Math.sqrt(dx * dx + dy * dy) < (r0[i] + r0[j]) * f; }
    var cand = [];
    for (var i = 0; i < n; i++) {
      var c = 0;
      for (var j = 0; j < n; j++) if (j !== i && near(i, j, 1.0)) c++;
      if (c >= 2) cand.push(i);
    }
    var seen = {}, groups = [];
    cand.forEach(function (i) {
      if (seen[i]) return;
      var stack = [i], m = [];
      seen[i] = 1;
      while (stack.length) {
        var a = stack.pop();
        m.push(a);
        cand.forEach(function (b) { if (!seen[b] && near(a, b, 1.25)) { seen[b] = 1; stack.push(b); } });
      }
      groups.push(m);
    });
    var tall = B.height > B.width * 0.9;
    return groups.filter(function (m) {
      if (m.length < 4) return false;
      var bc = bboxOf(parts, m);
      return (bc.x1 - bc.x0) * (bc.y1 - bc.y0) < 0.08 * B.width * B.height;
    }).map(function (m) {
      // anything else whose center sits inside the zoomed area joins it
      var bb = bboxOf(parts, m), e = Math.max.apply(null, m.map(function (i) { return r0[i]; })) * 0.5;
      for (var i = 0; i < n; i++) {
        if (m.indexOf(i) >= 0) continue;
        var p = parts[i];
        if (p.cx >= bb.x0 - e && p.cx <= bb.x1 + e && p.cy >= bb.y0 - e && p.cy <= bb.y1 + e) m.push(i);
      }
      return m;
    }).filter(function (m, q, all) {
      return all.findIndex(function (o) { return o.some(function (i) { return m.indexOf(i) >= 0; }); }) === q;
    }).map(function (m) {
      var bc = bboxOf(parts, m);
      var rmax = Math.max.apply(null, m.map(function (i) { return r0[i]; }));
      var need = m.reduce(function (a, i) { return a + Math.PI * r0[i] * r0[i]; }, 0) / 0.3;
      var area = Math.max((bc.x1 - bc.x0) * (bc.y1 - bc.y0), rmax * rmax);
      var mag = Math.min(Math.max(Math.sqrt(need / area), 2), 16), pad = rmax * 1.15;
      var maxW = (tall ? 0.7 : 0.9) * B.width, maxH = (tall ? 0.9 : 0.6) * B.height;
      var w = (bc.x1 - bc.x0) * mag + 2 * pad, h = (bc.y1 - bc.y0) * mag + 2 * pad;
      var f = Math.min(1, (maxW - 2 * pad) / Math.max(w - 2 * pad, 1e-6), (maxH - 2 * pad) / Math.max(h - 2 * pad, 1e-6));
      if (f < 1) { mag = Math.max(mag * f, 1.5); w = (bc.x1 - bc.x0) * mag + 2 * pad; h = (bc.y1 - bc.y0) * mag + 2 * pad; }
      return { m: m, bc: bc, mag: mag, pad: pad, w: w, h: h, cx: (bc.x0 + bc.x1) / 2, cy: (bc.y0 + bc.y1) / 2 };
    });
  }

  function relax(nodes, pad) {
    for (var it = 0; it < 220; it++) {
      var moved = 0;
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          if (!a.r || !b.r) continue;
          var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
          var ov = a.r + b.r + pad - d;
          if (ov <= 0) continue;
          var wa = b.r / (a.r + b.r), wb = a.r / (a.r + b.r), ux = dx / d, uy = dy / d;
          a.x -= ux * ov * wa * 0.6; a.y -= uy * ov * wa * 0.6;
          b.x += ux * ov * wb * 0.6; b.y += uy * ov * wb * 0.6;
          moved += ov;
        }
      }
      nodes.forEach(function (nd) {
        nd.x += (nd.x0 - nd.x) * 0.02; nd.y += (nd.y0 - nd.y) * 0.02;
        if (nd.box) {  // stay inside the inset frame
          nd.x = Math.min(Math.max(nd.x, nd.box.x + nd.r), nd.box.x + nd.box.w - nd.r);
          nd.y = Math.min(Math.max(nd.y, nd.box.y + nd.r), nd.box.y + nd.box.h - nd.r);
        }
      });
      if (moved < 1e-3) break;
    }
  }
  // circles laid out separately on the state and in each inset
  function layoutNodes(radii) {
    var G = S.focus.geom, C = S.focus.circles;
    var nodes = C.map(function (o, j) {
      var ins = o.q >= 0 ? G.insets[o.q] : null;
      return { x: o.ax, y: o.ay, x0: o.ax, y0: o.ay, r: radii[j], box: ins ? { x: ins.x, y: ins.y, w: ins.w, h: ins.h } : null, q: o.q };
    });
    var groups = {};
    nodes.forEach(function (nd) { (groups[nd.q] = groups[nd.q] || []).push(nd); });
    Object.keys(groups).forEach(function (q) { relax(groups[q], 0.8 * G.sf); });
    return nodes;
  }

  function updateStateView(mask) {
    var parts = S.parts, G = S.focus.geom, off = S.office;
    var res = M.evaluate({ units: parts }, mask);
    S.pres = res;
    var radii = parts.map(function (p, j) { var v = res[j].votes; return v > 0 ? Math.max(G.k * Math.sqrt(v), 1.3 * G.sf) : 0; });
    var nodes = layoutNodes(radii);
    nodes.forEach(function (nd, j) {
      var o = S.focus.circles[j], r = res[j];
      o.c.setAttribute("cx", nd.x.toFixed(2)); o.c.setAttribute("cy", nd.y.toFixed(2)); o.c.setAttribute("r", nd.r.toFixed(2));
      o.c.style.cx = nd.x.toFixed(2) + "px"; o.c.style.cy = nd.y.toFixed(2) + "px"; o.c.style.r = nd.r.toFixed(2) + "px";
      o.c.setAttribute("fill", fillFor(r.share, r.win));
      var fs = Math.min(Math.max(nd.r * 0.75, 7 * G.sf), 13 * G.sf);
      o.t.setAttribute("x", nd.x.toFixed(2)); o.t.setAttribute("y", (nd.y + fs * 0.35).toFixed(2));
      o.t.setAttribute("font-size", fs.toFixed(2));
      o.t.setAttribute("fill", inkFor(r.share, r.win));
      o.t.style.display = nd.r < 6 * G.sf ? "none" : "";
    });
    var names = sideNames(), sum;
    if (off === "rep") {
      var dS = 0, rS = 0, D = 0, T = 0;
      res.forEach(function (r) {
        if (r.win === "D") dS++; else if (r.win === "R") rS++;
        if (r.share != null) { D += r.share * r.votes; T += r.votes; }
      });
      sum = "Among these voters: <b>D " + dS + ", R " + rS + "</b> seats" + (T ? " · House vote " + esc(marginTxt(D / T)) : "");
    } else {
      var u = S.prep.units[S.focus.ui], rr = S.res[S.focus.ui], cn = candNames(u);
      sum = (u.dn || u.rn) && off !== "pres" ? esc(cn[0]) + " v. " + esc(cn[1]) + " · " : "";
      sum += "Among these voters: <b>" + esc(marginTxt(rr.share, cn)) + "</b> · actual " + esc(marginTxt(u.share, cn));
    }
    $("stSum").innerHTML = sum;
    var list = $("partsList");
    list.innerHTML = "";
    parts.forEach(function (p, j) {
      var r = res[j];
      list.appendChild(el("li", { "data-p": j, tabindex: "0" },
        '<span class="nm">' + esc(stPo(p.unit.st) + "-" + (p.n === 0 ? "AL" : p.n)) + '</span><span class="res"><span class="dot" style="background:' +
        (r.share == null && !r.win ? "var(--empty)" : fillFor(r.share, r.win)) + '"></span>' + esc(r.fixed ? (r.win || "–") + " unopp." : marginTxt(r.share)) +
        '</span><span class="was">' + fmtM(r.votes) + "</span>"));
    });
  }

  function partTip(j) {
    var p = S.parts[j], r = S.pres[j], off = S.office, d = p.unit;
    var names = off === "rep" ? candNames(d) : off === "pres" ? sideNames() : candNames(S.prep.units[S.focus.ui]);
    var h = "<h4>" + esc(stName(d.st)) + " " + (p.n === 0 ? "at-large" : "District " + p.n) + (off === "rep" && d.key ? '<span class="tag">Key race</span>' : "") + "</h4>";
    h += "<div class='meta'>" + (off === "rep" ? "U.S. House" + (d.dn || d.rn ? " · " + esc(d.dn || "–") + " (" + partyTag(d) + ") v. " + esc(d.rn || "–") + " (R)" : "")
      : (off === "pres" ? "Presidential" : off === "sen" ? "Senate" : "Governor") + " vote in this district (estimate)") + "</div>";
    if (r.fixed) return h + "<div>" + (r.win ? (r.win === "D" ? "Democratic" : "Republican") + " either way: the other side had no real candidate." : "No certified result.") + "</div>";
    if (r.share == null) return h + "<div>Too few of these voters here to estimate.</div>";
    h += "<div class='row'><span>" + esc(names[0]) + " " + pct(r.share) + "</span><span>" + esc(names[1]) + " " + pct(1 - r.share) + "</span></div>" +
      "<div class='bar'><span style='width:" + r.share * 100 + "%;background:var(--d3)'></span><span style='flex:1;background:var(--r3)'></span></div>" +
      "<div class='row'><span>Among these voters</span><b>" + esc(marginTxt(r.share, names)) + "</b></div>";
    if (off === "rep") h += "<div class='row'><span>Actual result</span><span>" + esc(marginTxt(d.share, names)) + "</span></div>";
    return h + "<div class='foot'>Ballots counted here: ≈" + fmtM(r.votes) + " of " + fmtM(p.N) + " (" + pct(r.sel, 0) + ")</div>";
  }

  // ------------------------------------------------------------------ map
  function unitsByState() {
    var by = {};
    S.prep.units.forEach(function (u, i) { (by[u.st] = by[u.st] || []).push(i); });
    return by;
  }
  function enter(node, x, w) {
    if (reduceMotion) return;
    node.classList.add("enter");
    node.style.setProperty("--d", Math.round((x / w) * 420) + "ms");
  }

  function buildMap() {
    if (S.focus) return buildStateView();
    var off = S.office;
    var p = off === "rep" ? loadDistricts(S.year) : Promise.resolve(null);
    return p.then(function (dg) {
      var box = $("mapbox");
      box.innerHTML = "";
      var svg, shapes = [], labels = [];
      var by = unitsByState(), apport = Y().raw.apport;
      {
        var geo = S.geo;
        svg = sv("svg", { viewBox: "0 0 " + (geo.w + 40) + " " + geo.h, role: "img" });
        if (off === "rep") {
          var idIndex = {};
          S.prep.units.forEach(function (u, i) { idIndex[u.id] = i; });
          Object.keys(dg).forEach(function (id) {
            var path = sv("path", { d: dg[id], "class": "u" });
            if (idIndex[id] != null) path.dataset.u = idIndex[id];
            svg.appendChild(path);
            shapes.push({ el: path, u: idIndex[id] });
          });
          if (geo.state_mesh) svg.appendChild(sv("path", { d: geo.state_mesh, "class": "stateline" }));
          var kg = sv("g");
          S.prep.units.forEach(function (u) { if (u.key && dg[u.id]) kg.appendChild(sv("path", { d: dg[u.id], "class": "keyline", "stroke-width": 1.4 })); });
          svg.appendChild(kg);
          geo.states.forEach(function (s, st) {
            if (stPo(st) === "DC") return;
            var t = sv("text", { x: s.lx, y: s.ly + 3.5, "class": "lbl halo small-hide", "font-size": 10 });
            t.textContent = stPo(st);
            labels.push({ el: t, halo: true });
            svg.appendChild(t);
          });
        } else {
          var defs = sv("defs");
          svg.appendChild(defs);
          geo.states.forEach(function (s, st) {
            var us = by[st] || [], path = sv("path", { d: s.d, "class": "u" });
            if (us.length === 1) path.dataset.u = us[0];
            else if (us.length === 2) {
              path.dataset.u = us.join(",");
              var pat = sv("pattern", { id: "two-" + st, width: 10, height: 10, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
              pat.appendChild(sv("rect", { width: 5, height: 10 }));
              pat.appendChild(sv("rect", { x: 5, width: 5, height: 10 }));
              defs.appendChild(pat);
            } else { path.dataset.st = st; path.setAttribute("fill", "url(#noRace)"); }
            enter(path, s.lx, geo.w);
            svg.appendChild(path);
            shapes.push({ el: path, u: us.length ? us : null, pat: us.length === 2 ? "two-" + st : null });
          });
          var keyG = sv("g");
          geo.states.forEach(function (s, st) {
            if ((by[st] || []).some(function (i) { return S.prep.units[i].key; })) keyG.appendChild(sv("path", { d: s.d, "class": "keyline", "stroke-width": 1.8 }));
          });
          svg.appendChild(keyG);
          var callY = 168;
          var order = geo.states.map(function (s, st) { return st; }).sort(function (a, b) {
            var ia = geo.callouts.indexOf(stPo(a)), ib = geo.callouts.indexOf(stPo(b));
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a - b;
          });
          order.forEach(function (st) {
            var s = geo.states[st], po = stPo(st), us = by[st] || [];
            if (geo.callouts.indexOf(po) >= 0) {
              var g = sv("g", { "class": "callout" });
              var rect = sv("rect", { x: 938, y: callY, width: 64, height: 19, rx: 2, "class": "u" });
              if (us.length) rect.dataset.u = us.join(","); else { rect.dataset.st = st; rect.setAttribute("fill", "url(#noRace)"); }
              g.appendChild(rect);
              var t = sv("text", { x: 970, y: callY + 13.5, "class": "lbl", "font-size": 10.5 });
              t.textContent = po + (off === "pres" && us.length ? " " + S.prep.units[us[0]].ev : "");
              g.appendChild(t);
              svg.appendChild(g);
              shapes.push({ el: rect, u: us.length ? us : null, box: true });
              labels.push({ el: t, u: us[0], st: st });
              callY += 23;
              return;
            }
            var tx = sv("text", { x: s.lx, y: s.ly - (off === "pres" ? 1 : -3.5), "class": "lbl small-hide", "font-size": s.a < 900 ? 9 : 11 });
            tx.textContent = po;
            if (off === "pres" && us.length) {
              var ts = sv("tspan", { x: s.lx, dy: 10.5, "class": "n", "font-size": s.a < 900 ? 8.5 : 9.5 });
              ts.textContent = S.prep.units[us[0]].ev;
              tx.appendChild(ts);
            }
            svg.appendChild(tx);
            labels.push({ el: tx, u: us[0], st: st });
          });
        }
        $("mapnote").textContent = off === "rep"
          ? "Click a state to see its districts up close, as circles sized by the ballots counted in each."
          : "Click a state to see how each of its congressional districts votes, as circles sized by the ballots counted in each.";
      }
      var d2 = sv("defs"), nr = sv("pattern", { id: "noRace", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
      nr.appendChild(sv("rect", { width: 6, height: 6, fill: "var(--none)" }));
      nr.appendChild(sv("rect", { width: 1.6, height: 6, fill: "var(--none-line)" }));
      d2.appendChild(nr);
      svg.insertBefore(d2, svg.firstChild);
      svg.setAttribute("aria-label", "Map of " + officePhrase() + " among the counted voters");
      box.appendChild(svg);
      S.map = { svg: svg, shapes: shapes, labels: labels };
      bindHover(svg);
      bindOpen(svg);
      svg.classList.add("clickable");
      renderLegend();
    });
  }

  function recolor(res) {
    if (!S.map) return;
    S.map.shapes.forEach(function (s) {
      if (s.u == null) return;
      if (Array.isArray(s.u)) {
        if (s.u.length === 1 || s.box || !s.pat) { var r0 = res[s.u[0]]; s.el.setAttribute("fill", fillFor(r0.share, r0.win)); return; }
        var rects = document.getElementById(s.pat).querySelectorAll("rect");
        rects[0].setAttribute("fill", fillFor(res[s.u[0]].share, res[s.u[0]].win));
        rects[1].setAttribute("fill", fillFor(res[s.u[1]].share, res[s.u[1]].win));
        s.el.setAttribute("fill", "url(#" + s.pat + ")");
        return;
      }
      var r = res[s.u];
      s.el.setAttribute("fill", fillFor(r.share, r.win));
    });
    S.map.labels.forEach(function (l) {
      if (l.halo) return;
      if (l.u == null) { l.el.setAttribute("fill", "var(--ink-3)"); return; }
      l.el.setAttribute("fill", inkFor(res[l.u].share, res[l.u].win));
    });
  }

  function renderLegend() {
    var names = sideNames();
    var ramp = '<span class="ramp" aria-hidden="true">' + ["d4", "d3", "d2", "d1", "r1", "r2", "r3", "r4"].map(function (c) {
      return '<span style="background:var(--' + c + ')"></span>';
    }).join("") + "</span>";
    var html = '<div><div class="ramp-labels"><span>' + esc(names[0] === "Democrats" ? "D" : names[0]) + " +30</span><span>margin</span><span>+30 " +
      esc(names[1] === "Republicans" ? "R" : names[1]) + "</span></div>" + ramp + "</div>";
    html += '<span class="key-sw"><span class="sw key"></span>Key race</span>';
    if (S.focus) html += "<span>Circle area: ballots counted</span>";
    if (S.office !== "pres") html += '<span class="key-sw"><span class="sw none"></span>' + (S.office === "rep" ? "No voting seat (DC)" : "No race in " + S.year) + "</span>";
    $("legend").innerHTML = html;
  }

  // ------------------------------------------------------------------ key races & table
  function renderKey(res) {
    var units = S.prep.units, list = $("keyList"), keys = [];
    units.forEach(function (u, i) { if (u.key) keys.push(i); });
    keys.sort(function (a, b) { return Math.abs(units[a].share - 0.5) - Math.abs(units[b].share - 0.5); });
    var rule = { pres: "The states both campaigns fought over.", sen: "Races decided by fewer than 10 points.",
                 gov: "Races decided by fewer than 10 points.", rep: "Districts decided by fewer than 5 points." }[S.office];
    var flipped = keys.filter(function (i) { return res[i].win && res[i].win !== S.base[i].win; }).length;
    $("keyTitle").textContent = "Key races (" + keys.length + ")";
    $("keyHint").textContent = rule + (anyPicks() ? " " + flipped + " of " + keys.length + " change hands with these voters." : " Mark a group to see which ones change hands.");
    list.innerHTML = "";
    keys.forEach(function (i) {
      var u = units[i], r = res[i], flip = r.win && r.win !== S.base[i].win;
      var li = el("li", { "data-u": i, tabindex: "0" });
      li.innerHTML = '<span class="nm">' + esc(unitName(u)) + '</span><span class="was">was ' + esc(marginTxt(u.share)) + "</span>" +
        '<span class="res"><span class="dot" style="background:' + (r.share == null ? "var(--empty)" : fillFor(r.share)) + '"></span>' + esc(marginTxt(r.share)) +
        (flip ? ' <span class="flip" style="color:' + (r.win === "D" ? "var(--dpart)" : "var(--rpart)") + '">flips</span>' : "") + "</span>";
      list.appendChild(li);
    });
    if (!keys.length) list.innerHTML = '<li><span class="nm">No close races this year.</span></li>';
    if (!list.dataset.bound) { bindHover(list); bindOpen(list); list.dataset.bound = "1"; }
  }
  function renderTable(res) {
    var units = S.prep.units, off = S.office;
    var rows = units.map(function (u, i) { return { u: u, r: res[i], i: i }; });
    var key = function (x) { return x.r.share == null ? (x.r.win === "D" ? 2 : -1) : x.r.share; };
    rows.sort(function (a, b) { return key(b) - key(a); });
    $("tableSummary").textContent = "All " + units.length + " " + (off === "pres" ? "states" : off === "rep" ? "districts" : "races") + ", sorted by the result among these voters";
    var h = "<thead><tr><th>Race</th><th>Candidates</th><th class='num'>Actual</th><th class='num'>These voters</th><th class='num'>Ballots counted</th></tr></thead><tbody>";
    rows.forEach(function (x) {
      var u = x.u, r = x.r, n = candNames(u);
      var cand = off === "pres" ? "" : esc(n[0]) + " (" + partyTag(u) + ") v. " + esc(n[1]) + " (R)";
      var act = u.modeled ? marginTxt(u.share) : u.win ? u.win + ", unopposed by the other side" : "No certified result";
      var now = r.fixed ? "unchanged" : marginTxt(r.share);
      var flip = !r.fixed && r.win && r.win !== S.base[x.i].win ? " ↺" : "";
      h += "<tr><td>" + esc(unitName(u)) + (off === "pres" ? " (" + u.ev + ")" : "") + "</td><td>" + cand + "</td><td class='num'>" + esc(act) +
        "</td><td class='num'>" + esc(now) + flip + "</td><td class='num'>" + fmtM(r.votes) + "</td></tr>";
    });
    $("table").innerHTML = h + "</tbody>";
  }
  function renderBench(Yr) {
    var b = Yr.raw.benchmarks, box = $("benchBox");
    if (!b || !b.length) {
      box.innerHTML = "<h3>Benchmark check, " + S.year + "</h3><p>Pew has no validated-voter study for " + S.year + ", so national group results come from the CES model alone.</p>";
      return;
    }
    var h = "<h3>Benchmark check, " + S.year + "</h3><p>Democratic share of the two-party " + (S.year % 4 ? "House" : "presidential") +
      " vote, nationally. The model is fitted to CES, then brought in line with Pew's gaps between groups.</p>" +
      "<table class='bench'><thead><tr><th>Group</th><th class='num'>Pew</th><th class='num'>CES only</th><th class='num'>Here</th></tr></thead><tbody>";
    b.forEach(function (r) {
      h += "<tr><td>" + esc(r.g.split(": ")[1].replace("*", "")) + "</td><td class='num'>" + pct(r.pew) + "</td><td class='num'>" + pct(r.ces) + "</td><td class='num'>" + pct(r.model) + "</td></tr>";
    });
    box.innerHTML = h + "</tbody></table>";
  }

  // ------------------------------------------------------------------ tooltip
  var tip = $("tip");
  function unitTip(i) {
    var u = S.prep.units[i], r = S.res[i], b = S.base[i], off = S.office, names = candNames(u);
    var title = off === "rep" ? stName(u.st) + " " + (u.n === 0 ? "at-large" : "District " + u.n) : unitName(u);
    var meta = off === "pres" ? u.ev + " electoral votes" : off === "rep" ? "U.S. House" : (off === "sen" ? "Senate" : "Governor") + (u.sp ? ", special election" : "");
    var h = "<h4>" + esc(title) + (u.key ? '<span class="tag">Key race</span>' : "") + "</h4><div class='meta'>" + esc(meta) +
      (off !== "pres" && (u.dn || u.rn) ? " · " + esc(u.dn || "–") + " (" + partyTag(u) + ") v. " + esc(u.rn || "–") + " (R)" : "") + "</div>";
    if (r.fixed) return h + "<div>" + (u.win ? (u.win === "D" ? "Democratic" : "Republican") + " seat with no real opponent from the other side. It stays the same under every filter." : "No certified result.") + "</div>";
    if (r.share == null) return h + "<div>Too few of these voters here to estimate.</div>";
    h += "<div class='row'><span>" + esc(names[0]) + " " + pct(r.share) + "</span><span>" + esc(names[1]) + " " + pct(1 - r.share) + "</span></div>" +
      "<div class='bar'><span style='width:" + r.share * 100 + "%;background:var(--d3)'></span><span style='flex:1;background:var(--r3)'></span></div>" +
      "<div class='row'><span>Among these voters</span><b>" + esc(marginTxt(r.share, names)) + "</b></div>" +
      "<div class='row'><span>Actual result</span><span>" + esc(marginTxt(u.share, names)) + "</span></div>";
    if (r.win && b.win && r.win !== b.win) h += "<div class='row'><b style='color:" + (r.win === "D" ? "var(--dpart)" : "var(--rpart)") + "'>Flips to " + esc(r.win === "D" ? names[0] : names[1]) + "</b></div>";
    return h + "<div class='foot'>These voters: ≈" + fmtM(r.votes) + " of " + fmtM(u.N) + " two-party ballots (" + pct(r.sel, 0) + ")" + (u.note ? "<br>" + esc(u.note) : "") + "</div>";
  }
  function noRaceTip(st) {
    var off = S.office, here = notUp().filter(function (n) { return n.st === +st; });
    var h = "<h4>" + esc(stName(+st)) + "</h4>";
    if (off === "rep") return h + "<div>Washington, D.C. elects a non-voting delegate.</div>";
    if (stPo(+st) === "DC") return h + "<div>No " + (off === "sen" ? "Senate seats" : "governor") + ".</div>";
    h += "<div>No " + (off === "sen" ? "Senate" : "governor") + " race in " + S.year + ".</div>";
    if (here.length) h += "<div class='foot'>Not up: " + here.map(function (n) { return esc(n.who) + " (" + n.side + ")"; }).join(", ") + "</div>";
    return h;
  }
  function tipFor(target) {
    var t = target.closest ? target.closest("[data-u],[data-st],[data-p]") : null;
    if (!t) return null;
    if (t.dataset.p != null && S.parts && S.pres) return partTip(+t.dataset.p);
    if (t.dataset.u != null && t.dataset.u !== "") {
      var ids = t.dataset.u.split(",").map(Number);
      var html = ids.map(unitTip).join("<hr style='border:0;border-top:1px solid var(--rule);margin:8px 0'>");
      if ((S.office === "sen" || S.office === "gov") && ids.length) {
        var st = S.prep.units[ids[0]].st, nu = notUp().filter(function (n) { return n.st === st; });
        if (nu.length) html += "<div class='foot'>Not up this year: " + nu.map(function (n) { return esc(n.who) + " (" + n.side + ")"; }).join(", ") + "</div>";
      }
      return html;
    }
    return t.dataset.st != null ? noRaceTip(t.dataset.st) : null;
  }
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight, left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  function bindHover(root) {
    root.addEventListener("pointermove", function (ev) {
      if (ev.pointerType !== "mouse") return;
      var h = tipFor(ev.target);
      if (h) showTip(h, ev.clientX, ev.clientY); else tip.hidden = true;
    });
    root.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") tip.hidden = true; });
    root.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "mouse") return;
      var h = tipFor(ev.target);
      if (h) showTip(h, ev.clientX, ev.clientY); else tip.hidden = true;
    });
    root.addEventListener("focusin", function (ev) {
      var h = tipFor(ev.target);
      if (!h) return;
      var r = ev.target.getBoundingClientRect();
      showTip(h, r.left + r.width / 2, r.bottom);
    });
    root.addEventListener("focusout", function () { tip.hidden = true; });
  }
  document.addEventListener("scroll", function () { tip.hidden = true; }, { passive: true });
  document.addEventListener("pointerdown", function (ev) {
    if (!ev.target.closest || !ev.target.closest("[data-u],[data-st],[data-p]")) tip.hidden = true;
  });

  // ------------------------------------------------------------------ theme (shared with vltanh.me)
  var THEMES = ["system", "light", "dark"];
  var ICONS = {
    system: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" class="solid"/></svg>',
    light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></svg>',
    dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z"/></svg>'
  };
  function storedTheme() {
    try { var t = localStorage.getItem("theme"); return THEMES.indexOf(t) >= 0 ? t : "system"; } catch (e) { return "system"; }
  }
  function applyTheme(t) {
    if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    $("theme").innerHTML = ICONS[t];
    $("theme").title = "Colours: " + (t === "system" ? "as the system" : t) + " (click to change)";
    $("theme").setAttribute("aria-label", "Colour theme: " + t);
  }
  $("theme").addEventListener("click", function () {
    var t = THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length];
    try { localStorage.setItem("theme", t); } catch (e) { /* the choice lasts until the page is left */ }
    applyTheme(t);
  });
  applyTheme(storedTheme());

  // ------------------------------------------------------------------ boot
  $("year").addEventListener("change", function (ev) { S.fresh = true; setElection(+ev.target.value, S.office); });
  $("office").addEventListener("change", function (ev) { S.fresh = true; setElection(S.year, ev.target.value); });
  $("shade").addEventListener("change", function (ev) { S.shade = ev.target.checked; update(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && S.focus) closeState(); });
  window.addEventListener("hashchange", function () {
    var h = readHash();
    if (!h || !h.year || !S.meta.years[h.year]) return;
    DIMS.forEach(function (d) { S.picks[d.key] = h.picks[d.key] || []; });
    var si = h.inState ? S.meta.states.findIndex(function (x) { return x[1] === h.inState; }) : -1;
    var focusChanged = (si >= 0 ? si : null) !== (S.focus ? S.focus.st : null);
    if (focusChanged) { S.focus = si >= 0 ? { st: si, ui: null } : null; S.parts = null; }
    if (h.year !== S.year || h.office !== S.office) setElection(h.year, h.office);
    else if (focusChanged) { refocus(); buildMap().then(update).catch(showError); }
    else update();
  });

  Promise.all([getJSON("data/meta.json"), getJSON("data/geo.json")]).then(function (a) {
    S.meta = a[0];
    S.geo = a[1];
    buildBallot();
    var years = Object.keys(S.meta.years).map(Number).sort(function (x, y) { return y - x; });
    var h = readHash() || {};
    if (h.picks) DIMS.forEach(function (d) { S.picks[d.key] = h.picks[d.key] || []; });
    if (h.inState) {
      var si = S.meta.states.findIndex(function (x) { return x[1] === h.inState; });
      if (si >= 0) S.focus = { st: si, ui: null };
    }
    var y = h.year && S.meta.years[h.year] ? h.year : years[0];
    var off = h.office || (S.meta.years[y].offices.indexOf("pres") >= 0 ? "pres" : "sen");
    setElection(y, off);
  }).catch(showError);
})();
