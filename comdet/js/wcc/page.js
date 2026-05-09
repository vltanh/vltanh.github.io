/* WCC page glue: drives the recursive cut walker over the kernel trace. */
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
  if (C.MINCUT && C.MINCUT.viecut && typeof C.MINCUT.viecut.setSeed === "function") {
    C.MINCUT.viecut.setSeed(seed);
  }
  // Reflect the seed back into the URL so the link is copy-paste-able
  // even if no ?seed= was passed. history.replaceState avoids a back-
  // button trap.
  if (!urlParams.has("seed")) {
    urlParams.set("seed", String(seed));
    window.history.replaceState(null, "", "?" + urlParams.toString());
  }

  const result = C.WCC.runWCC(F.gt, { criterion: "1log_10(n)" });

  // Stage 0: input.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // Stage 1: CC pre-pass summary.
  const ccSummary = document.getElementById("g-cc-summary");
  if (ccSummary) {
    let html = "";
    result.cc.events.forEach(function (ev) {
      const split = ev.components.length > 1 ? " (split " + ev.components.length + ")" : "";
      html += '<div>cluster <b>' + ev.clusterIn + '</b> &middot; '
            + ev.nodes.length + ' nodes &middot; '
            + ev.components.length + ' connected component'
            + (ev.components.length === 1 ? '' : 's')
            + split + '</div>';
    });
    ccSummary.innerHTML = html;
  }

  // Flatten the carve trace into per-pop events for the walker.
  const flat = [];
  result.carve.events.forEach(function (rt) {
    rt.events.forEach(function (ev) { flat.push(ev); });
  });

  // Walker membership snapshots: track the surviving partition + queued
  // chunks. snapshot[k] reflects state after event k-1.
  const baseMem = F.nodes.map(function () { return -1; });
  // Seed every pre-CC component as its own pending colour.
  const initialChunks = [];
  result.cc.events.forEach(function (ev) {
    ev.components.forEach(function (comp) { if (comp.length > 1) initialChunks.push(comp.slice()); });
  });
  // Walk simulation: maintain a chunkOf[id] = chunk-index map (into a
  // growing palette) so component colour shifts as carves happen.
  const chunks = initialChunks.slice();
  const chunkOf = {};
  chunks.forEach(function (chunk, ci) {
    chunk.forEach(function (id) { chunkOf[id] = ci; });
  });
  const chunkSurvived = chunks.map(function () { return false; });
  const snapshots = [renderMem()];
  function renderMem() {
    const out = baseMem.slice();
    F.nodes.forEach(function (id, i) {
      const c = chunkOf[id];
      out[i] = (c == null) ? -1 : c;
    });
    return out;
  }
  flat.forEach(function (ev) {
    // Find the chunk being processed (must be a chunk whose nodes match
    // ev.cluster). Pick the lowest-index chunk that has not survived yet
    // and whose set equals ev.cluster.
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
      // Replace ci with the pushed-back components (each its own new chunk).
      ev.pushedBack.forEach(function (comp) {
        const newCi = chunks.length;
        chunks.push(comp.slice());
        chunkSurvived.push(false);
        comp.forEach(function (id) { chunkOf[id] = newCi; });
      });
      // Original chunk is "consumed" — purge it (set chunkOf entries).
      chunks[ci] = [];
      chunkSurvived[ci] = false;
    }
    snapshots.push(renderMem());
  });

  function snapshotAt(idx) { return snapshots[idx]; }

  function statusFor(ev) {
    if (!ev) return "stage 0 &middot; planted partition (pre-walk)";
    const wc = ev.wellConnected ? "passes" : "fails";
    return "n=" + ev.clusterSize + " &middot; cut=" + ev.cut
      + " &middot; thr=" + ev.threshold.toFixed(3)
      + " &middot; " + wc + " &middot; "
      + (ev.wellConnected
          ? 'kept'
          : ('split into ' + (ev.pushedBack.length || 'no surviving') + ' chunk(s)'));
  }

  // Per-step tooltip prose — sourced from wcc_dossier.md tooltip seed
  // table. Each phrase cites the canonical line driving the observed
  // behaviour. Threshold value injected at render time.
  const TIP_KEEP = "Cut value c exceeds threshold t = pre_log * log(n) (constrained.h:430-432). Cluster kept as survivor. Survivor index = FIFO pop order in WriteClusterQueue (constrained.cpp:135-152).";
  const TIP_PUSH = "Cut value c ≤ threshold t (within 1e-9 epsilon). Split into in/out partitions, find connected components per side, push every size>1 component back onto queue (in-side before out-side; mincut_only.h:97-122).";

  function panelHTML(idx, ev) {
    if (!ev) {
      return '<div class="step-desc">Press <b>next pop</b> to drain the queue.</div>';
    }
    let html = '<div class="step-desc">cluster size <b>' + ev.clusterSize
             + '</b> &middot; mincut <b>' + ev.cut + '</b> vs threshold <b>'
             + ev.threshold.toFixed(3) + '</b> &middot; verdict: <b>'
             + (ev.wellConnected ? 'well-connected' : 'cut + recurse') + '</b></div>';
    html += '<table class="cand-table"><thead><tr><th>side</th><th>size</th><th>nodes</th></tr></thead><tbody>';
    [["in", ev.inPartition], ["out", ev.outPartition]].forEach(function (pair) {
      html += '<tr><td>' + pair[0] + '</td><td>' + pair[1].length + '</td><td>'
            + pair[1].slice().sort(function (a, b) { return a - b; }).join(', ')
            + '</td></tr>';
    });
    html += '</tbody></table>';
    const tip = ev.wellConnected ? TIP_KEEP : TIP_PUSH;
    html += '<div class="step-tip">' + tip + '</div>';
    return html;
  }

  P.mountStepWalker({
    vizHostId: "g-walk-cy",
    panelHostId: "g-walk-panel",
    ctlPrefix: "g-walk",
    events: flat,
    snapshotAt: snapshotAt,
    sidePanelHTML: panelHTML,
    onRender: function (idx, ev) {
      const status = document.getElementById("g-walk-status");
      const stats = document.getElementById("g-walk-stats");
      if (status) status.innerHTML = statusFor(ev);
      if (stats) {
        let survivors = 0, pushes = 0;
        for (let k = 0; k < idx; k++) {
          const e = flat[k];
          if (e.wellConnected) survivors += 1;
          else pushes += e.pushedBack.length;
        }
        stats.innerHTML = "survivors: " + survivors + " &middot; pushes: " + pushes;
      }
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
})();
