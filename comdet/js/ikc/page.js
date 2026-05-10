/* IKC page glue: wires every stage of ikc.html to the kernel trace. */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.IKC || !COMDET.FIXTURE) {
    console.warn("[ikc page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, I = C.IKC, F = C.FIXTURE;

  // Snapshot states (used by snapshotAt + renderIter).
  const ST = { RESIDUAL: -2, DROPPED: -1 };

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "ikc" });
  }

  let kFloor = 2;
  let canonicalGate = true;
  let result = I.runFixture(kFloor, canonicalGate);

  // ── Stage 0: input fixture ──────────────────────────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // ── Stage 1: core-decomposition viz + k slider ──────────────────
  const fullCN = I.coreNumbers(F.nodes, F.edges);
  const fullCoreOf = {};
  fullCN.core.forEach(function (v, k) { fullCoreOf[k] = v; });

  const corePalette = ["#3a3f4a", "#7c8aa6", "#5fa0b3", "#e0a649", "#c97c7c", "#7b9bd6"];
  function coreColor(level, highlight) {
    const base = corePalette[Math.min(level, corePalette.length - 1)] || "#888";
    if (highlight == null) return base;
    return level >= highlight ? base : "#3a3f4a";
  }

  let coreHighlight = fullCN.max;
  const coresViz = P.renderFixture("g-cores-cy", {
    pinned: true,
    colorFn: function (id) { return coreColor(fullCoreOf[id], coreHighlight); },
  });

  function coresRender() {
    F.nodes.forEach(function (id) {
      coresViz.setNodeStyle(id, { color: coreColor(fullCoreOf[id], coreHighlight) });
      const inLevel = fullCoreOf[id] >= coreHighlight;
      if (inLevel) {
        coresViz.removeNodeClass(id, "dim");
      } else {
        coresViz.addNodeClass(id, "dim");
      }
    });
    const kEl = document.getElementById("g-cores-k");
    const cntEl = document.getElementById("g-cores-count");
    if (kEl) kEl.textContent = coreHighlight;
    if (cntEl) {
      let n = 0;
      F.nodes.forEach(function (id) { if (fullCoreOf[id] >= coreHighlight) n += 1; });
      cntEl.textContent = n;
    }
  }
  coresRender();

  function renderCoreBar() {
    const bar = document.getElementById("g-cores-bar");
    if (!bar) return;
    const counts = {};
    F.nodes.forEach(function (id) {
      const k = fullCoreOf[id];
      counts[k] = (counts[k] || 0) + 1;
    });
    const ks = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    bar.innerHTML = "";
    ks.forEach(function (k) {
      const cell = document.createElement("div");
      cell.className = "cell" + (k >= coreHighlight ? " active" : "");
      cell.dataset.k = k;
      cell.innerHTML = '<span class="lab">k = ' + k + '</span><span class="n">' + counts[k] + '</span>';
      cell.addEventListener("click", function () {
        coreHighlight = +cell.dataset.k;
        const slider = document.getElementById("g-cores-slider");
        if (slider) slider.value = coreHighlight;
        coresRender();
        renderCoreBar();
      });
      bar.appendChild(cell);
    });
  }
  renderCoreBar();

  const coresSlider = document.getElementById("g-cores-slider");
  const coresOut = document.getElementById("g-cores-k");
  if (coresSlider && coresOut) {
    coresSlider.min = 1;
    coresSlider.max = fullCN.max;
    coresSlider.value = fullCN.max;
    coresOut.textContent = fullCN.max;
    C.scrubSlider({
      input: coresSlider, output: coresOut,
      onChange: function (v) {
        coreHighlight = +v;
        coresRender();
        renderCoreBar();
      },
    });
  }

  // ── Stage 2: outer-loop walker ──────────────────────────────────
  // Per-iteration snapshot encoding (per-node):
  //   ST.RESIDUAL : not yet processed
  //   ST.DROPPED  : k-validity fail / mod fail / bail singleton
  //   >= 0        : accepted-cluster id
  //
  // snapshots[i] = state after applying iterations[0..i-1]; index 0 = empty.
  // Built once per rerun; renderIter looks up by idx instead of re-walking
  // the iteration prefix every scrub tick.
  let snapshots = [];
  function buildSnapshots() {
    snapshots = [];
    const snap = {};
    F.nodes.forEach(function (id) { snap[id] = ST.RESIDUAL; });
    let acceptedSeen = 0;
    let accTotal = 0, dropTotal = 0;
    snapshots.push({
      snap: Object.assign({}, snap),
      acceptedSoFar: acceptedSeen,
      acc: accTotal,
      drop: dropTotal,
    });
    for (let i = 0; i < result.iterations.length; i++) {
      const it = result.iterations[i];
      it.accepted.forEach(function (cRec) {
        cRec.nodes.forEach(function (id) { snap[id] = acceptedSeen; });
        acceptedSeen += 1;
        accTotal += cRec.nodes.length;
      });
      it.components.forEach(function (cRec) {
        if (!cRec.accepted) {
          cRec.nodes.forEach(function (id) { snap[id] = ST.DROPPED; });
          dropTotal += cRec.nodes.length;
        }
      });
      if (it.bailed) {
        it.residualNodes.forEach(function (id) {
          if (snap[id] === ST.RESIDUAL) snap[id] = ST.DROPPED;
        });
        dropTotal += it.residualNodes.length;
      }
      snapshots.push({
        snap: Object.assign({}, snap),
        acceptedSoFar: acceptedSeen,
        acc: accTotal,
        drop: dropTotal,
      });
    }
  }
  function snapshotAt(idx) { return snapshots[idx]; }

  function colorForState(s) {
    if (s === ST.RESIDUAL) return "#3a3f4a";
    if (s === ST.DROPPED)  return "#202533";
    return P.partitionColor(s);
  }

  const loopViz = P.renderFixture("g-loop-cy", {
    pinned: true,
    colorFn: function () { return "#3a3f4a"; },
  });

  function renderIter(idx) {
    const ev = result.iterations[idx - 1] || null;
    const { snap, acceptedSoFar, acc, drop } = snapshotAt(idx);
    const inKcore = new Set(ev ? ev.kcoreNodes : []);
    const compOf = new Map();
    if (ev) {
      ev.components.forEach(function (cRec, i) {
        cRec.nodes.forEach(function (id) { compOf.set(id, { idx: i, rec: cRec }); });
      });
    }
    F.nodes.forEach(function (id) {
      const s = snap[id];
      let color;
      if (ev && inKcore.has(id) && s === ST.RESIDUAL) {
        const c = compOf.get(id);
        color = (c && c.rec.accepted)
          ? P.partitionColor(acceptedSoFar + ev.accepted.indexOf(c.rec))
          : "#9a947a";
      } else {
        color = colorForState(s);
      }
      loopViz.setNodeStyle(id, { color: color });
      loopViz.removeNodeClass(id, "dim");
      loopViz.removeNodeClass(id, "hi");
      if (s === ST.DROPPED) loopViz.addNodeClass(id, "dim");
      if (ev && inKcore.has(id)) loopViz.addNodeClass(id, "hi");
    });
    // Status / stats / level pill.
    const lv = document.getElementById("g-loop-level");
    const st = document.getElementById("g-loop-status");
    const ss = document.getElementById("g-loop-stats");
    if (lv) lv.textContent = ev ? ("it " + ev.iteration) : "init";
    if (st) {
      if (!ev) st.innerHTML = "all " + F.nodes.length + " nodes residual &middot; pre-iteration 0";
      else if (ev.bailed) st.innerHTML = "K* = " + ev.maxK + " &lt; k_floor &middot; bailed &middot; " + ev.residualNodes.length + " nodes drop";
      else st.innerHTML = "K* = " + ev.maxK + " &middot; kcore = " + ev.kcoreNodes.length + " nodes &middot; " + ev.components.length + " component(s)";
    }
    if (ss) {
      ss.innerHTML = "accepted: " + acc + " &middot; dropped: " + drop;
    }
    // Per-iter readout strip.
    const rn = document.getElementById("g-loop-rn");
    const rm = document.getElementById("g-loop-rm");
    const kcm = document.getElementById("g-loop-kcm");
    const kept = document.getElementById("g-loop-kept");
    const term = document.getElementById("g-loop-term");
    if (!ev) {
      if (rn) rn.textContent = F.nodes.length;
      if (rm) rm.textContent = F.edges.length;
      if (kcm) kcm.textContent = "·";
      if (kept) kept.textContent = "·";
      if (term) term.textContent = "·";
    } else {
      if (rn) rn.textContent = ev.residualNodes.length;
      if (rm) rm.textContent = ev.residualEdges.length;
      if (kcm) kcm.textContent = ev.bailed ? 0 : ev.kcoreEdges.length;
      if (kept) kept.textContent = ev.accepted.length;
      if (term) {
        if (ev.bailed) term.textContent = "K* < k_floor";
        else if (idx === result.iterations.length) term.textContent = "residual empty";
        else term.textContent = "running";
      }
    }
    renderLoopPanel(idx, ev, acceptedSoFar);
  }

  function renderLoopPanel(idx, ev, acceptedSoFar) {
    const panel = document.getElementById("g-loop-panel");
    if (!panel) return;
    if (!ev) {
      panel.innerHTML = '<div class="step-desc">Pre-iteration. Residual = full graph (' + F.nodes.length + ' nodes). Click "next iteration" to compute the first \\(K^*\\)-core.</div>';
      retypeset(panel);
      return;
    }
    if (ev.bailed) {
      panel.innerHTML = '<div class="step-desc">Iteration ' + ev.iteration + ': residual\'s \\(K^* = ' + ev.maxK + '\\) is below \\(k_{\\mathrm{floor}} = ' + result.kFloor + '\\). Loop bails. The remaining ' + ev.residualNodes.length + ' nodes drop into the singleton bucket.</div>';
      retypeset(panel);
      return;
    }
    let html = '<div class="step-desc">Iteration ' + ev.iteration + ': residual\'s \\(K^* = ' + ev.maxK + '\\). The ' + ev.kcoreNodes.length + '-node \\(K^*\\)-core splits into ' + ev.components.length + ' component(s).</div>';
    html += '<table class="cand-table"><thead><tr><th>component</th><th>size</th><th>k-valid</th><th>mod</th><th>verdict</th></tr></thead><tbody>';
    let acceptedCounter = acceptedSoFar;
    ev.components.forEach(function (cRec, i) {
      let cls;
      let verdict;
      if (cRec.accepted) {
        cls = "cand-pick";
        verdict = "accepted &middot; cluster " + acceptedCounter;
        acceptedCounter += 1;
      } else {
        cls = "cand-fail";
        verdict = cRec.fateReason;
      }
      html += '<tr class="' + cls + '">'
            + '<td>{' + cRec.nodes.slice(0, 6).join(",") + (cRec.nodes.length > 6 ? ",…" : "") + '}</td>'
            + '<td>' + cRec.nodes.length + '</td>'
            + '<td>' + (cRec.kValid ? '✓' : '✗') + '</td>'
            + '<td>' + cRec.modularity.toFixed(3) + '</td>'
            + '<td>' + verdict + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';
    panel.innerHTML = html;
    retypeset(panel);
  }

  function retypeset(target) {
    if (typeof MathJax === "undefined" || !MathJax.typesetPromise) return;
    if (target) MathJax.typesetPromise([target]);
    else MathJax.typesetPromise();
  }

  buildSnapshots();

  let loopCtl = null;
  function rebuildLoopController() {
    const total = result.iterations.length + 1; // +1 = pre-iteration init
    if (loopCtl) loopCtl.reconfigure(total);
    else loopCtl = C.stepController({
      total: total,
      prevBtn: document.getElementById("g-loop-prev"),
      nextBtn: document.getElementById("g-loop-next"),
      resetBtn: document.getElementById("g-loop-reset"),
      endBtn: document.getElementById("g-loop-end"),
      labelCur: document.getElementById("g-loop-cur"),
      labelTotal: document.getElementById("g-loop-total"),
      onRender: renderIter,
      keyboard: false,
    });
  }
  rebuildLoopController();

  // ── Stage 3: final partition + GT ───────────────────────────────
  function rebuildFinal() {
    const ikcHost = document.getElementById("g-final-ikc");
    const gtHost = document.getElementById("g-final-gt");
    if (ikcHost) ikcHost.innerHTML = "";
    if (gtHost) gtHost.innerHTML = "";
    const tbody = document.querySelector("#g-final-stats tbody");
    if (tbody) tbody.innerHTML = "";
    const memArr = F.nodes.map(function (id) { return result.membership.get(id); });
    P.mountFinalCompare({
      leidenHostId: "g-final-ikc",
      gtHostId: "g-final-gt",
      statsTbody: tbody,
      membership: memArr,
    });
    const kEl = document.getElementById("g-final-k");
    const accEl = document.getElementById("g-final-acc");
    const dropEl = document.getElementById("g-final-drop");
    if (kEl) kEl.textContent = result.kFloor;
    if (accEl) accEl.textContent = result.accepted.length;
    if (dropEl) dropEl.textContent = result.dropped.length;
  }
  rebuildFinal();

  // ── k_floor slider + strict-mod toggle ──────────────────────────
  function rerun() {
    result = I.runFixture(kFloor, canonicalGate);
    buildSnapshots();
    rebuildLoopController();
    loopCtl.set(0);
    rebuildFinal();
    retypeset();
  }

  const kIn = document.getElementById("g-loop-k");
  const kOut = document.getElementById("g-loop-k-out");
  if (kIn && kOut) {
    C.scrubSlider({
      input: kIn, output: kOut,
      onChange: function (v) {
        kFloor = +v;
        rerun();
      },
    });
  }

  const strictBox = document.getElementById("g-loop-strict-mod");
  if (strictBox) {
    strictBox.addEventListener("change", function () {
      canonicalGate = !strictBox.checked;
      rerun();
    });
  }

  retypeset();
})();
