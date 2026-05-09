/* WCC page glue: drives the recursive cut walker over the kernel trace.
 *
 * Deepened (2026-05-09): per-pop drill-down with phase strip + cut-vs-
 * threshold gauge + queue/survivor state panels + appended record table
 * + live threshold criterion picker + edge-case callouts. Layman page
 * per feedback_doc_vs_page_split.md; technical content in
 * docs/algorithms/wcc.md. Kernel (comdet/js/wcc/wcc.js) untouched —
 * byte-equal vs constrained-clustering MincutOnly preserved.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.WCC || !COMDET.FIXTURE) {
    console.warn("[wcc page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "wcc" });
  }

  const idxByNode = {};
  F.nodes.forEach(function (id, i) { idxByNode[id] = i; });

  // Seed-in-URL: ?seed=N reproduces a specific run. WCC has no RNG of
  // its own but chains VieCut's MT19937 via the mincut adapter, so the
  // same seed produces the same per-pop bipartition orientation on
  // tied cuts. Default seed=0 matches mincut_custom.cpp's default.
  const urlParams = new URLSearchParams(window.location.search);
  const urlSeed = parseInt(urlParams.get("seed"), 10);
  const seed = Number.isFinite(urlSeed) ? urlSeed : 0;
  if (!urlParams.has("seed")) {
    urlParams.set("seed", String(seed));
    window.history.replaceState(null, "", "?" + urlParams.toString());
  }

  // Stage 0: input. Mounted once, persists across criterion changes.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // Threshold criterion picker — re-runs the kernel and re-mounts the
  // walker live. Default value pulls from URL ?criterion=spec if
  // provided, else log_10(n).
  const criterionSelect = document.getElementById("wcc-criterion");
  const criterionInput = (urlParams.get("criterion") || "1log_10(n)").trim();
  if (criterionSelect) {
    let matched = false;
    for (let i = 0; i < criterionSelect.options.length; i++) {
      if (criterionSelect.options[i].value === criterionInput) {
        criterionSelect.selectedIndex = i; matched = true; break;
      }
    }
    if (!matched) criterionSelect.selectedIndex = 0;
    criterionSelect.addEventListener("change", function () {
      const next = criterionSelect.value;
      const p2 = new URLSearchParams(window.location.search);
      p2.set("criterion", next);
      window.history.replaceState(null, "", "?" + p2.toString());
      runAndMount(next);
    });
  }

  // Pretty-printed formula label. Pulled from the criterion string.
  function formulaLabel(spec) {
    spec = String(spec || "").trim();
    if (spec === "0") return "f(n) = 0  (= CC; no recursion)";
    if (spec === "piecewise") return "f(n) = piecewise (1, 2, 3, ceil(0.1·sqrt(n)))";
    let m = spec.match(/^([0-9.]+)log_([0-9.]+)\(n\)$/);
    if (m) return "f(n) = " + m[1] + " · log<sub>" + m[2] + "</sub>(n)";
    m = spec.match(/^([0-9.]+)n\^([0-9.]+)$/);
    if (m) return "f(n) = " + m[1] + " · n<sup>" + m[2] + "</sup>";
    return "f(n) = " + spec;
  }

  // ───────────────────────────────────────────────────────────────────
  // Phase strip: 5 phases per pop. Order mirrors the kernel's per-pop
  // execution: pull → mincut → threshold → verdict → action. Visual
  // order doubles as a checklist for instructors describing one pop
  // step-by-step.
  const PHASES = [
    { id: "pull",    label: "pull cluster", n: "1" },
    { id: "mincut",  label: "mincut",       n: "2" },
    { id: "thr",     label: "threshold",    n: "3" },
    { id: "verdict", label: "verdict",      n: "4" },
    { id: "action",  label: "action",       n: "5" },
  ];
  function phaseStripHTML(verdict) {
    return '<div class="wcc-phases">'
      + PHASES.map(function (ph) {
        const cls = "wcc-phase on"
          + (ph.id === "verdict" && verdict === "keep" ? " verdict-keep" : "")
          + (ph.id === "verdict" && verdict === "push" ? " verdict-push" : "")
          + (ph.id === "action"  && verdict === "keep" ? " verdict-keep" : "")
          + (ph.id === "action"  && verdict === "push" ? " verdict-push" : "");
        return '<div class="' + cls + '">'
          + '<span class="ph-num">step ' + ph.n + '</span>'
          + '<span class="ph-label">' + ph.label + '</span>'
          + '</div>';
      }).join("")
      + '</div>';
  }

  // Cut-vs-threshold gauge. The bar is symmetric around the threshold
  // (centered at 50%). The cut marker sits at:
  //   ratio = cut / max(2*threshold, cut*2)  (clipped 0..100%)
  // so cut=threshold lands at exactly 50%, cut=0 at far-left, cut=2*thr
  // at far-right. Epsilon zone is the centered amber sliver.
  function gaugeHTML(cut, thr) {
    const denom = Math.max(2 * Math.max(thr, 0.001), Math.max(cut * 1.2, 0.001));
    const ratio = Math.max(0, Math.min(1, cut / denom));
    const pct = (ratio * 100).toFixed(1);
    return '<div class="wcc-gauge">'
      + '<div class="gauge-cap">cut <b>' + cut + '</b> vs threshold <b>' + thr.toFixed(3) + '</b>'
      + (Math.abs(thr - cut) <= 1e-9 ? ' &middot; within 1e-9 epsilon' : '') + '</div>'
      + '<div class="gauge-bar">'
      + '  <div class="gauge-thr"></div>'
      + '  <div class="gauge-marker" style="left:' + pct + '%"></div>'
      + '</div>'
      + '<div class="gauge-axis"><span>0</span><span><b>thr</b></span><span>~2&middot;thr</span></div>'
      + '</div>';
  }

  // Threshold formula box: shows pre_log * log(n) = thr with concrete
  // numbers, so the instructor can read off the substitution.
  function thresholdBoxHTML(parsed, n, thr) {
    if (parsed.kind === "logarithmic") {
      const innerLog = Math.log(n);
      return '<div class="step-tip">threshold = '
        + parsed.c + ' &middot; log<sub>' + parsed.x + '</sub>(' + n + ') = '
        + parsed.c + ' / ln(' + parsed.x + ') &middot; ln(' + n + ') = '
        + parsed.preLog.toFixed(4) + ' &middot; ' + innerLog.toFixed(4) + ' = '
        + thr.toFixed(4) + '</div>';
    }
    if (parsed.kind === "exponential") {
      return '<div class="step-tip">threshold = '
        + parsed.c + ' &middot; ' + n + '<sup>' + parsed.x + '</sup> = '
        + thr.toFixed(4) + '</div>';
    }
    if (parsed.kind === "simple") {
      return '<div class="step-tip">simple branch: cut &ge; 1 ⇒ keep, else split</div>';
    }
    return '<div class="step-tip">threshold(n=' + n + ') = ' + thr.toFixed(4) + '</div>';
  }

  // ───────────────────────────────────────────────────────────────────
  // CC pre-pass mini-grid: per-input-cluster card showing the cluster
  // id, size, and which connected components the bucket split into.
  function renderCC(result) {
    const ccHost = document.getElementById("g-cc-summary");
    if (!ccHost) return;
    let html = "";
    result.cc.events.forEach(function (ev) {
      const split = ev.components.length > 1;
      html += '<div class="wcc-cc-card">'
        + '<div class="cc-id">cluster <b>' + ev.clusterIn + '</b></div>'
        + '<div class="cc-meta">' + ev.nodes.length + ' nodes &middot; '
        + ev.components.length + ' component'
        + (ev.components.length === 1 ? '' : 's')
        + (split ? ' (split)' : '')
        + '</div><div>';
      ev.components.forEach(function (comp, i) {
        html += '<span class="cc-comp' + (split ? ' split' : '') + '">'
          + 'c' + i + ' &middot; n=' + comp.length + '</span>';
      });
      html += '</div></div>';
    });
    ccHost.innerHTML = html;
  }

  // ───────────────────────────────────────────────────────────────────
  // Queue + survivor panels: replay the kernel's queue evolution up to
  // a given pop index. Re-derived per render (no incremental state) so
  // back/scrub stays consistent.
  function deriveQueueState(initialQueue, events, popIdxBeforeNext) {
    // Initial queue = surviving CC components (size > 1) in node-id-ASC
    // order (mirror of the kernel's wcc.js:201).
    const queue = initialQueue.map(function (c) { return c.slice(); });
    const survivors = [];
    for (let i = 0; i < popIdxBeforeNext; i++) {
      const ev = events[i];
      queue.shift();
      if (ev.wellConnected) {
        survivors.push(ev.cluster.slice());
      } else {
        ev.pushedBack.forEach(function (comp) { queue.push(comp.slice()); });
      }
    }
    return { queue: queue, survivors: survivors };
  }

  function chunkColor(chunk) {
    // Use min node-id mod palette as a stable colour for visual tracking.
    if (!chunk.length) return "#888";
    const m = chunk.reduce(function (a, b) { return Math.min(a, b); }, chunk[0]);
    return P.partitionColor(m % 10);
  }

  function chipHTML(chunk, opts) {
    opts = opts || {};
    const color = chunkColor(chunk);
    const label = "n=" + chunk.length;
    const cls = "wcc-chip"
      + (opts.head ? " head" : "")
      + (opts.kept ? " kept" : "")
      + (opts.fresh ? " fresh" : "");
    return '<span class="' + cls + '" title="' + chunk.slice().sort(function(a,b){return a-b;}).join(",") + '">'
      + '<span class="swatch" style="background:' + color + '"></span>'
      + label + '</span>';
  }

  function renderQueuePanel(qstate, currentEv) {
    const queueChips = document.getElementById("wcc-queue-chips");
    const queueCount = document.getElementById("wcc-queue-count");
    const survChips = document.getElementById("wcc-survivor-chips");
    const survCount = document.getElementById("wcc-survivor-count");
    if (queueChips) {
      if (qstate.queue.length === 0) {
        queueChips.innerHTML = '<span class="wcc-chip-empty">queue empty</span>';
      } else {
        // Highlight the head (= what the next "next pop" pulls). When
        // currentEv is set we're rendering the post-pop state; head is
        // genuinely the next-up cluster.
        queueChips.innerHTML = qstate.queue.map(function (c, i) {
          return chipHTML(c, { head: i === 0 });
        }).join("");
      }
    }
    if (queueCount) queueCount.textContent = String(qstate.queue.length);
    if (survChips) {
      if (qstate.survivors.length === 0) {
        survChips.innerHTML = '<span class="wcc-chip-empty">no survivors yet</span>';
      } else {
        survChips.innerHTML = qstate.survivors.map(function (c, i) {
          return chipHTML(c, { kept: true, fresh: currentEv && currentEv.wellConnected && i === qstate.survivors.length - 1 });
        }).join("");
      }
    }
    if (survCount) survCount.textContent = String(qstate.survivors.length);
  }

  // ───────────────────────────────────────────────────────────────────
  // Per-pop record table: prefilled row-per-pop, current row highlighted
  // via class swap, future rows rendered greyed-out so the instructor
  // can preview "what's coming". Append-mode in spirit (rows visible
  // only up to current index would feel jumpier).
  function renderRecordTable(events, parsed, currentIdx) {
    const tbody = document.querySelector("#wcc-record-table tbody");
    if (!tbody) return;
    let html = "";
    events.forEach(function (ev, i) {
      const cls = (i === currentIdx - 1) ? "cur"
                : (i < currentIdx - 1) ? (ev.wellConnected ? "kept" : "push")
                : "future";
      html += '<tr class="' + cls + '">'
        + '<td>' + (i + 1) + '</td>'
        + '<td class="num">' + ev.clusterSize + '</td>'
        + '<td class="num">' + ev.cut + '</td>'
        + '<td class="num">' + ev.threshold.toFixed(3) + '</td>'
        + '<td>' + (ev.wellConnected ? 'KEEP' : 'PUSH') + '</td>'
        + '<td class="num">' + (ev.wellConnected ? '0' : ev.pushedBack.length) + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = html;
    // Auto-scroll the current row into view.
    if (currentIdx > 0) {
      const cur = tbody.querySelector("tr.cur");
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Per-step prose: phase-conditional. Rendered below the cand-table
  // in the side panel. Cites canonical lines per dossier seed table
  // (constrained.h:430-432, mincut_only.h:97-122).
  const TIP_KEEP = "Cut value c clears threshold t = pre_log &middot; log(n), strict and outside the 1e-9 epsilon (constrained.h:430-432). Cluster moves to the survivor list in FIFO pop order (constrained.cpp:135-152).";
  const TIP_PUSH = "Cut value c does not clear threshold t (within or below). Split at the cut: take connected components on each side, push every size&gt;1 component back onto the queue. In-side components first, then out-side (mincut_only.h:97-122).";
  const TIP_DISCONNECTED = "Mincut returned 0 — the induced subgraph is disconnected. Threshold trivially loses. Both sides become their own queue entries.";
  const TIP_EPSILON = "cut equals threshold within 1e-9. constrained.h:431's <code>is_close</code> guard treats this as not well-connected: split rather than keep. Triggers on n=10, 100, 1000 with <code>1log_10(n)</code>.";

  function panelHTML(idx, ev, parsed) {
    if (!ev) {
      return '<div class="step-desc">Press <b>next pop</b> to drain the queue. Stage starts with the surviving CC components from stage 1.</div>';
    }
    const verdict = ev.wellConnected ? "keep" : "push";

    let html = '';
    // Phase strip on top.
    html += phaseStripHTML(verdict);

    // Verdict badge + cut/thr summary.
    html += '<div style="display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin:.35rem 0 .55rem">';
    html += '<span class="wcc-verdict ' + verdict + '">'
      + (ev.wellConnected ? 'keep' : 'split + push back')
      + '</span>';
    html += '<span style="font-family:\'Special Elite\',monospace;font-size:.78rem;color:var(--paper-2)">'
      + 'cluster size <b>' + ev.clusterSize + '</b></span>';
    html += '</div>';

    // Threshold formula box.
    if (parsed) html += thresholdBoxHTML(parsed, ev.clusterSize, ev.threshold);

    // Cut-vs-threshold gauge.
    html += gaugeHTML(ev.cut, ev.threshold);

    // In/out partition table.
    html += '<table class="cand-table" style="margin-top:.4rem"><thead><tr><th>side</th><th>size</th><th>nodes</th></tr></thead><tbody>';
    [["in", ev.inPartition], ["out", ev.outPartition]].forEach(function (pair) {
      html += '<tr><td>' + pair[0] + '</td><td>' + pair[1].length + '</td><td>'
            + pair[1].slice().sort(function (a, b) { return a - b; }).join(', ')
            + '</td></tr>';
    });
    html += '</tbody></table>';

    // Phase-conditional prose.
    let tip = ev.wellConnected ? TIP_KEEP : TIP_PUSH;
    let tipCls = ev.wellConnected ? "keep" : "push";
    if (!ev.wellConnected && ev.cut === 0) tip = TIP_DISCONNECTED;
    else if (!ev.wellConnected && Math.abs(ev.threshold - ev.cut) <= 1e-9) tip = TIP_EPSILON;
    html += '<div class="step-tip ' + tipCls + '">' + tip + '</div>';

    return html;
  }

  // ───────────────────────────────────────────────────────────────────
  // Walker re-mount on criterion change. We tear down the prior step
  // controller's listeners (the controller object is the only piece
  // that holds references; we simply overwrite the host innerHTML for
  // the side panel + viz). The kernel re-runs cleanly because runWCC
  // takes membership + opts and is pure.

  let lastController = null;
  function runAndMount(criterionSpec) {
    // Re-seed VieCut RNG so the run is reproducible across criterion
    // changes (the URL ?seed= param is the source of truth).
    if (C.MINCUT && C.MINCUT.viecut && typeof C.MINCUT.viecut.setSeed === "function") {
      C.MINCUT.viecut.setSeed(seed);
    }
    const result = C.WCC.runWCC(F.gt, { criterion: criterionSpec });
    const parsed = result.parsed;

    // Update formula label.
    const fl = document.getElementById("wcc-formula");
    if (fl) fl.innerHTML = formulaLabel(criterionSpec);

    // Stage 1: CC pre-pass cards.
    renderCC(result);

    // Flatten the carve trace into per-pop events for the walker.
    const flat = [];
    result.carve.events.forEach(function (rt) {
      rt.events.forEach(function (ev) { flat.push(ev); });
    });

    // Initial queue snapshot: surviving CC components (size > 1).
    // Mirrors wcc.js:201.
    const initialQueue = [];
    result.cc.events.forEach(function (ev) {
      ev.components.forEach(function (comp) { if (comp.length > 1) initialQueue.push(comp.slice()); });
    });

    // Walker membership snapshots: track surviving partition + queued
    // chunks. snapshot[k] reflects state after event k-1.
    const baseMem = F.nodes.map(function () { return -1; });
    const chunks = initialQueue.map(function (c) { return c.slice(); });
    const chunkOf = {};
    chunks.forEach(function (chunk, ci) {
      chunk.forEach(function (id) { chunkOf[id] = ci; });
    });
    const chunkSurvived = chunks.map(function () { return false; });
    function renderMem() {
      const out = baseMem.slice();
      F.nodes.forEach(function (id, i) {
        const c = chunkOf[id];
        out[i] = (c == null) ? -1 : c;
      });
      return out;
    }
    const snapshots = [renderMem()];
    flat.forEach(function (ev) {
      const sortedEv = ev.cluster.slice().sort(function (a, b) { return a - b; });
      const targetKey = sortedEv.join(",");
      let ci = -1;
      for (let k = 0; k < chunks.length; k++) {
        if (chunkSurvived[k]) continue;
        const sortedCh = chunks[k].slice().sort(function (a, b) { return a - b; });
        if (sortedCh.join(",") === targetKey) { ci = k; break; }
      }
      if (ev.wellConnected && ci >= 0) {
        chunkSurvived[ci] = true;
      } else if (ci >= 0) {
        ev.pushedBack.forEach(function (comp) {
          const newCi = chunks.length;
          chunks.push(comp.slice());
          chunkSurvived.push(false);
          comp.forEach(function (id) { chunkOf[id] = newCi; });
        });
        chunks[ci] = [];
        chunkSurvived[ci] = false;
      }
      snapshots.push(renderMem());
    });

    function snapshotAt(idx) { return snapshots[idx]; }

    function statusFor(idx, ev) {
      if (!ev) return "stage 0 &middot; planted partition (pre-walk)";
      const wc = ev.wellConnected ? "passes" : "fails";
      return "pop " + idx + " &middot; n=" + ev.clusterSize + " &middot; cut=" + ev.cut
        + " &middot; thr=" + ev.threshold.toFixed(3)
        + " &middot; " + wc;
    }

    // Mount walker.
    lastController = P.mountStepWalker({
      vizHostId: "g-walk-cy",
      panelHostId: "g-walk-panel",
      ctlPrefix: "g-walk",
      events: flat,
      snapshotAt: snapshotAt,
      sidePanelHTML: function (idx, ev) { return panelHTML(idx, ev, parsed); },
      onRender: function (idx, ev) {
        const status = document.getElementById("g-walk-status");
        const stats = document.getElementById("g-walk-stats");
        const lvl = document.getElementById("g-walk-level");
        if (status) status.innerHTML = statusFor(idx, ev);
        if (lvl) lvl.textContent = idx === 0 ? "step 0" : ("pop " + idx);
        if (stats) {
          let survivors = 0, pushes = 0;
          for (let k = 0; k < idx; k++) {
            const e = flat[k];
            if (e.wellConnected) survivors += 1;
            else pushes += e.pushedBack.length;
          }
          stats.innerHTML = "survivors: " + survivors + " &middot; pushes: " + pushes;
        }

        // Queue + survivor + record table panels, re-derived from
        // pop-index. idx==0 = pre-walk; idx>0 = state AFTER pop idx
        // (kernel has popped idx clusters by this point).
        const qstate = deriveQueueState(initialQueue, flat, idx);
        renderQueuePanel(qstate, idx > 0 ? flat[idx - 1] : null);
        renderRecordTable(flat, parsed, idx);
      },
    });

    // Stage 3: final compare.
    P.renderFixture("g-final-out", {
      membership: Array.from(result.finalAssign), pinned: true, nodeR: 9,
    });
    P.renderFixture("g-final-gt", { useGT: true, pinned: true, nodeR: 9 });
    const summary = document.getElementById("g-final-summary");
    if (summary) {
      let kept = 0, dropped = 0;
      result.finalAssign.forEach(function (v) { if (v < 0) dropped += 1; else kept += 1; });
      summary.innerHTML = "survivors: " + result.numClusters
        + " &middot; nodes kept: " + kept + " / dropped: " + dropped
        + " &middot; criterion: " + result.criterion;
    }
  }

  // First render.
  runAndMount(criterionInput);
})();
