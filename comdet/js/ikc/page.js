/* IKC page glue — wires every stage of ikc.html to the kernel trace. */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.IKC || !COMDET.FIXTURE) {
    console.warn("[ikc page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, I = C.IKC, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "ikc" });
  }

  // Run kernel once at default kFloor / canonical gate; rebuild on toggles.
  let kFloor = 2;
  let canonicalGate = true;
  let result = I.runFixture(kFloor, canonicalGate);

  // ── Stage 0: input fixture ──────────────────────────────────────
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // ── Stage 1: core-decomposition viz + k slider ──────────────────
  const fullCN = I.coreNumbers(F.nodes, F.edges);
  const fullCoreOf = {};
  fullCN.core.forEach(function (v, k) { fullCoreOf[k] = v; });

  // Palette for core levels: low core dim, high core saturated.
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
  if (coresSlider) {
    coresSlider.min = 1;
    coresSlider.max = fullCN.max;
    coresSlider.value = fullCN.max;
    coresSlider.addEventListener("input", function () {
      coreHighlight = +coresSlider.value;
      coresRender();
      renderCoreBar();
    });
  }

  // ── Stage 2: outer-loop walker ──────────────────────────────────
  // Per-iteration snapshot: each node either accepted into a prior or
  // current cluster (cluster id), dropped (-1 ⇒ singleton), residual
  // (-2), or being processed in current kcore (component id, encoded
  // as 1000 + comp_idx for a temporary pseudo-cluster).
  function snapshotAt(idx) {
    // idx = 0 means "before iteration 0"; idx = K means after iteration K-1.
    const snap = {};
    F.nodes.forEach(function (id) { snap[id] = -2; });
    let acceptedSeen = 0;
    for (let i = 0; i < idx; i++) {
      const it = result.iterations[i];
      it.accepted.forEach(function (cRec) {
        cRec.nodes.forEach(function (id) { snap[id] = acceptedSeen; });
        acceptedSeen += 1;
      });
      it.components.forEach(function (cRec) {
        if (!cRec.accepted) {
          cRec.nodes.forEach(function (id) { snap[id] = -1; });
        }
      });
      if (it.bailed) {
        it.residualNodes.forEach(function (id) {
          if (snap[id] === -2) snap[id] = -1;
        });
      }
    }
    return { snap: snap, acceptedSoFar: acceptedSeen };
  }

  function colorForState(s) {
    if (s === -2) return "#3a3f4a"; // residual
    if (s === -1) return "#202533"; // dropped/singleton
    return P.partitionColor(s);
  }

  // Build viz host once.
  const loopViz = P.renderFixture("g-loop-cy", { pinned: true,
    colorFn: function () { return "#3a3f4a"; },
  });

  function renderIter(idx) {
    const ev = result.iterations[idx - 1] || null;
    const { snap, acceptedSoFar } = snapshotAt(idx);
    // Decide which nodes belong to the "current iteration" highlight.
    const inKcore = new Set(ev ? ev.kcoreNodes : []);
    const compOf = new Map();
    if (ev) {
      ev.components.forEach(function (cRec, i) {
        cRec.nodes.forEach(function (id) { compOf.set(id, { idx: i, rec: cRec }); });
      });
    }
    F.nodes.forEach(function (id) {
      let color;
      if (snap[id] >= 0) color = colorForState(snap[id]);
      else if (snap[id] === -1) color = colorForState(-1);
      else if (inKcore.has(id) && ev) {
        const c = compOf.get(id);
        if (c) {
          color = c.rec.accepted ? P.partitionColor(acceptedSoFar + ev.accepted.indexOf(c.rec))
                : "#9a947a";
        } else color = "#3a3f4a";
      } else color = colorForState(snap[id]);
      loopViz.setNodeStyle(id, { color: color });
      // Dim non-residual nodes that aren't part of an accepted cluster yet.
      loopViz.removeNodeClass(id, "dim");
      loopViz.removeNodeClass(id, "hi");
      if (snap[id] === -1) loopViz.addNodeClass(id, "dim");
      if (ev && inKcore.has(id)) loopViz.addNodeClass(id, "hi");
    });
    // Status / stats / level pill.
    const lv = document.getElementById("g-loop-level");
    const st = document.getElementById("g-loop-status");
    const ss = document.getElementById("g-loop-stats");
    if (lv) lv.textContent = ev ? ("it " + ev.iteration) : "init";
    if (st) {
      if (!ev) st.innerHTML = "all 32 nodes residual &middot; pre-iteration 0";
      else if (ev.bailed) st.innerHTML = "K* = " + ev.maxK + " &lt; k_floor &middot; bailed &middot; " + ev.residualNodes.length + " nodes drop";
      else st.innerHTML = "K* = " + ev.maxK + " &middot; kcore = " + ev.kcoreNodes.length + " nodes &middot; " + ev.components.length + " component(s)";
    }
    if (ss) {
      let acc = 0, drop = 0;
      for (let i = 0; i < idx; i++) {
        result.iterations[i].accepted.forEach(function (c) { acc += c.nodes.length; });
        result.iterations[i].components.forEach(function (c) { if (!c.accepted) drop += c.nodes.length; });
        if (result.iterations[i].bailed) drop += result.iterations[i].residualNodes.length;
      }
      ss.innerHTML = "accepted: " + acc + " &middot; dropped: " + drop;
    }
    renderLoopPanel(idx, ev, acceptedSoFar);
  }

  function renderLoopPanel(idx, ev, acceptedSoFar) {
    const panel = document.getElementById("g-loop-panel");
    if (!panel) return;
    if (!ev) {
      panel.innerHTML = '<div class="step-desc">Pre-iteration. Residual = full graph (32 nodes). Click "next iteration" to compute the first \\(K^*\\)-core.</div>';
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
    if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
      MathJax.typesetPromise([target]);
    }
  }

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
    rebuildLoopController();
    loopCtl.set(0);
    rebuildFinal();
    if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
      MathJax.typesetPromise();
    }
  }

  const kIn = document.getElementById("g-loop-k");
  const kOut = document.getElementById("g-loop-k-out");
  if (kIn && kOut) {
    kIn.addEventListener("input", function () {
      kFloor = +kIn.value;
      kOut.textContent = kFloor;
      rerun();
    });
  }

  const strictBox = document.getElementById("g-loop-strict-mod");
  if (strictBox) {
    strictBox.addEventListener("change", function () {
      canonicalGate = !strictBox.checked;
      rerun();
    });
  }

  if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
    MathJax.typesetPromise();
  }
})();
