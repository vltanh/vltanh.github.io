/* CC page glue: drives a per-cluster BFS walker over the kernel trace. */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.CC || !COMDET.FIXTURE) {
    console.warn("[cc page] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "cc" });
  }

  const idxByNode = {};
  F.nodes.forEach(function (id, i) { idxByNode[id] = i; });

  // Run kernel over the planted GT (the canonical input shape: SBM-style
  // partitions whose clusters may be internally disconnected).
  const result = C.CC.runCC(F.gt);

  // Stage-0 input.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });

  // Walker: snapshots[0] = input partition; snapshots[k] = state after
  // processing event k-1. Once a cluster is split, every node inherits a
  // fresh output cluster id (size > 1) or -1 (singleton drop).
  const baseMembership = F.nodes.map(function (_, i) { return F.gt[i]; });
  const snapshots = [baseMembership.slice()];
  let nextOutId = 0;
  const cur = baseMembership.slice();
  result.events.forEach(function (ev) {
    ev.components.forEach(function (comp) {
      if (comp.length <= 1) {
        comp.forEach(function (id) { cur[idxByNode[id]] = -1; });
      } else {
        comp.forEach(function (id) { cur[idxByNode[id]] = 1000 + nextOutId; });
        nextOutId += 1;
      }
    });
    snapshots.push(cur.slice());
  });

  function snapshotAt(idx) { return snapshots[idx]; }

  function statusFor(ev) {
    if (!ev) return "stage 0 &middot; planted partition (4 clusters + outlier label)";
    const split = ev.components.length > 1;
    const sizes = ev.components.map(function (c) { return c.length; }).join(" + ");
    const verb = split
      ? "splits into " + ev.components.length + " components (" + sizes + ")"
      : "stays connected (" + sizes + " nodes)";
    return "cluster " + ev.clusterIn + " &middot; " + verb;
  }

  // Per-step tooltip prose — sourced from cc_dossier.md tooltip seed
  // table. Each phrase cites the canonical line that drives the
  // observed behaviour so instructor screenshots are honest.
  const TIP_FINALIZE = "Component complete. BFS root selected as the lowest unvisited node-id (components.c:144). Component id = current count of completed BFSes (components.c:179).";
  const TIP_EMIT     = "Cluster id assigned by WriteClusterQueue FIFO pop position (constrained.cpp:135-152). Within-cluster contents are node-id ASC by construction (constrained.h:403 bucket-fill loop).";

  function panelHTML(idx, ev) {
    if (!ev) {
      return '<div class="step-desc">Pre-walk. Each input cluster will be BFS-split into its connected pieces.</div>';
    }
    let html = '<div class="step-desc">cluster <b>' + ev.clusterIn + '</b> &middot; '
             + ev.nodes.length + ' nodes &middot; '
             + ev.components.length + ' connected component'
             + (ev.components.length === 1 ? '' : 's') + '</div>';
    html += '<table class="cand-table"><thead><tr><th>component</th><th>size</th><th>nodes</th></tr></thead><tbody>';
    ev.components.forEach(function (comp, i) {
      const drop = comp.length <= 1 ? ' (dropped)' : '';
      html += '<tr><td>' + (i + 1) + '</td><td>' + comp.length + drop + '</td><td>'
            + comp.slice().sort(function (a, b) { return a - b; }).join(', ')
            + '</td></tr>';
    });
    html += '</tbody></table>';
    const tip = ev.components.length > 1 ? TIP_FINALIZE : TIP_EMIT;
    html += '<div class="step-tip">' + tip + '</div>';
    return html;
  }

  P.mountStepWalker({
    vizHostId: "g-walk-cy",
    panelHostId: "g-walk-panel",
    ctlPrefix: "g-walk",
    events: result.events,
    snapshotAt: snapshotAt,
    sidePanelHTML: panelHTML,
    onRender: function (idx, ev) {
      const status = document.getElementById("g-walk-status");
      const stats = document.getElementById("g-walk-stats");
      if (status) status.innerHTML = statusFor(ev);
      if (stats) {
        let split = 0, drops = 0;
        for (let k = 0; k < idx; k++) {
          const e = result.events[k];
          if (e.components.length > 1) split += 1;
          e.components.forEach(function (c) { if (c.length <= 1) drops += c.length; });
        }
        stats.innerHTML = "splits: " + split + " &middot; dropped singletons: " + drops;
      }
    },
  });

  // Stage 5: final compare.
  const finalAssign = result.finalAssign;
  P.renderFixture("g-final-out", {
    membership: Array.from(finalAssign).map(function (v) { return v < 0 ? -1 : v; }),
    pinned: true, nodeR: 9,
  });
  P.renderFixture("g-final-gt", { useGT: true, pinned: true, nodeR: 9 });
  const summary = document.getElementById("g-final-summary");
  if (summary) {
    let kept = 0, dropped = 0;
    finalAssign.forEach(function (v) { if (v < 0) dropped += 1; else kept += 1; });
    summary.innerHTML = "input clusters: " + result.events.length
      + " &middot; output clusters: " + result.numClusters
      + " &middot; nodes kept: " + kept + " / dropped: " + dropped;
  }
})();
