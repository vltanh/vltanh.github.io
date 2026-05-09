/* CM page glue: drives the cut + recluster walker over the kernel trace. */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.CM || !COMDET.FIXTURE) {
    console.warn("[cm page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "cm" });
  }

  const idxByNode = {};
  F.nodes.forEach(function (id, i) { idxByNode[id] = i; });

  // Seed-in-URL: ?seed=N reproduces a specific run. CM chains TWO RNG
  // streams: VieCut's MT19937 (mincut backend) + Leiden's igraph MT19937
  // (recluster). Both seeded to the same value so the trace is fully
  // reproducible. Default seed=0 matches cm.cpp's hardcoded value.
  const urlParams = new URLSearchParams(window.location.search);
  const urlSeed = parseInt(urlParams.get("seed"), 10);
  const seed = Number.isFinite(urlSeed) ? urlSeed : 0;
  if (C.MINCUT && C.MINCUT.viecut && typeof C.MINCUT.viecut.setSeed === "function") {
    C.MINCUT.viecut.setSeed(seed);
  }
  if (!urlParams.has("seed")) {
    urlParams.set("seed", String(seed));
    window.history.replaceState(null, "", "?" + urlParams.toString());
  }

  const result = C.CM.runCM(F.gt, {
    criterion: "1log_10(n)", algorithm: "leiden-cpm", resolution: 0.0001, seed: seed,
  });

  // Stage 0: input.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // Filter to events that should drive the walker (skip "init" and
  // "round-end" which are bookkeeping). Keep mincut + recluster events.
  const events = result.events.filter(function (e) {
    return e.kind === "mincut" || e.kind === "recluster";
  });

  // Build snapshots: each chunk in the queue gets its own colour. After
  // a recluster event, the parent chunk is replaced by its children.
  // After a "well-connected" mincut, the chunk is marked as a survivor
  // (still gets its own colour but stops moving).
  const initialChunks = [];
  result.events[0].initialQueue.forEach(function (q) {
    initialChunks.push(q.nodes.slice());
  });
  let chunks = initialChunks.slice();
  const baseMem = F.nodes.map(function () { return -1; });
  function membershipOf() {
    const out = baseMem.slice();
    chunks.forEach(function (chunk, ci) {
      chunk.forEach(function (id) { out[idxByNode[id]] = ci; });
    });
    return out;
  }
  const snapshots = [membershipOf()];
  events.forEach(function (ev) {
    if (ev.kind === "mincut") {
      // No chunk change unless we're going to recluster (reclustering is
      // a separate event).
      if (ev.wellConnected) {
        // Cluster survives — leave its chunk in place.
      }
      // Else we'll see a "recluster" event next that supplies children.
    } else if (ev.kind === "recluster") {
      // Find chunk matching ev.children's union (they all share parent).
      const childUnion = new Set();
      ev.children.forEach(function (c) { c.forEach(function (id) { childUnion.add(id); }); });
      // Identify the chunk whose nodes are a superset of childUnion.
      let target = -1;
      for (let k = 0; k < chunks.length; k++) {
        const setK = new Set(chunks[k]);
        let hits = 0;
        childUnion.forEach(function (id) { if (setK.has(id)) hits += 1; });
        if (hits === childUnion.size && hits > 0) { target = k; break; }
      }
      if (target >= 0) {
        // Replace target chunk: remove parent, append children.
        const before = chunks.slice(0, target);
        const after = chunks.slice(target + 1);
        const fresh = ev.children.map(function (c) { return c.slice(); });
        chunks = before.concat(after).concat(fresh);
      }
    }
    snapshots.push(membershipOf());
  });

  function snapshotAt(idx) { return snapshots[idx]; }

  function statusFor(ev) {
    if (!ev) return "stage 0 &middot; planted partition (pre-walk)";
    if (ev.kind === "mincut") {
      return "round " + ev.round + " &middot; mincut (n=" + ev.clusterSize
        + ", cut=" + ev.cut + ", thr=" + ev.threshold.toFixed(3) + ")"
        + " &middot; " + (ev.wellConnected ? "kept" : "fail &rarr; recluster");
    }
    return "round " + ev.round + " &middot; recluster (parent " + ev.parentId
      + ", base " + ev.baseAlgo + ") &middot; "
      + ev.children.length + " child cluster(s)";
  }

  function panelHTML(idx, ev) {
    if (!ev) return '<div class="step-desc">Press <b>next event</b> to begin.</div>';
    if (ev.kind === "mincut") {
      let html = '<div class="step-desc">cluster size <b>' + ev.clusterSize
               + '</b> &middot; mincut <b>' + ev.cut + '</b> vs threshold <b>'
               + ev.threshold.toFixed(3) + '</b> &middot; verdict: <b>'
               + (ev.wellConnected ? 'well-connected' : 'cut + recluster') + '</b></div>';
      html += '<table class="cand-table"><thead><tr><th>side</th><th>size</th><th>nodes</th></tr></thead><tbody>';
      [["in", ev.inPartition], ["out", ev.outPartition]].forEach(function (pair) {
        html += '<tr><td>' + pair[0] + '</td><td>' + pair[1].length + '</td><td>'
              + pair[1].slice().sort(function (a, b) { return a - b; }).join(', ')
              + '</td></tr>';
      });
      html += '</tbody></table>';
      return html;
    }
    let html = '<div class="step-desc">parent cluster id <b>' + ev.parentId
             + '</b> reclustered with <b>' + ev.baseAlgo
             + '</b> at resolution ' + ev.baseResolution
             + ' &middot; produced <b>' + ev.children.length
             + '</b> child cluster(s)</div>';
    html += '<table class="cand-table"><thead><tr><th>child</th><th>size</th><th>nodes</th></tr></thead><tbody>';
    ev.children.forEach(function (c, i) {
      html += '<tr><td>' + (i + 1) + '</td><td>' + c.length + '</td><td>'
            + c.slice().sort(function (a, b) { return a - b; }).join(', ')
            + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  P.mountStepWalker({
    vizHostId: "g-walk-cy",
    panelHostId: "g-walk-panel",
    ctlPrefix: "g-walk",
    events: events,
    snapshotAt: snapshotAt,
    sidePanelHTML: panelHTML,
    onRender: function (idx, ev) {
      const status = document.getElementById("g-walk-status");
      const stats = document.getElementById("g-walk-stats");
      if (status) status.innerHTML = statusFor(ev);
      if (stats) {
        let surv = 0, recl = 0;
        for (let k = 0; k < idx; k++) {
          const e = events[k];
          if (e.kind === "mincut" && e.wellConnected) surv += 1;
          if (e.kind === "recluster") recl += 1;
        }
        stats.innerHTML = "survivors: " + surv + " &middot; reclusters: " + recl;
      }
    },
  });

  // Stage 2: final compare.
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
      + " &middot; criterion: " + result.criterion
      + " &middot; base algorithm: " + result.algorithm
      + " (resolution=" + result.resolution + ")";
  }
  const histEl = document.getElementById("g-history");
  if (histEl) {
    const keys = Object.keys(result.parentToChild);
    if (keys.length === 0) {
      histEl.innerHTML = '<em>no splits or reclusters fired on this fixture &middot; every input cluster passed the threshold.</em>';
    } else {
      let html = '<b>cluster history</b> (parent &rarr; children):<br>';
      keys.forEach(function (pid) {
        html += pid + ' &rarr; [' + result.parentToChild[pid].join(', ') + ']<br>';
      });
      histEl.innerHTML = html;
    }
  }
})();
