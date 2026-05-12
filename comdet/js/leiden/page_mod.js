/* Leiden-Mod page glue. Same kernel + helpers as Leiden-CPM, swapped to
 * the Modularity quality function (no γ slider).
 *
 * Per-step viz: every algorithmic step (queue init, first visit, mid-queue
 * snapshot, move convergence, refine init, refine sweep, post-refine,
 * aggregation, level-1 entry, outer-loop level table, final) lands on its
 * own host container; the move + refine walkers stay on the main
 * g-move-cy / g-refine-cy frames.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.LEIDEN || !COMDET.FIXTURE) {
    console.warn("[leiden page_mod] missing prerequisites");
    return;
  }
  const C = COMDET, P = C.PAGE, L = C.LEIDEN, F = C.FIXTURE;

  if (C.linksRow && document.getElementById("links")) {
    document.getElementById("links").innerHTML = C.linksRow({ gen: "leiden-mod" });
  }

  const seed = 42;
  const G = P.buildLeidenGraph();
  // L.LeidenMod mirrors libleidenalg ModularityVertexPartition; it matches
  // the LeidenPartition admin algebra used inside optimisePartition.
  const result = L.optimisePartition(G, L.LeidenMod(), seed, { recordTrace: true });

  const n = F.nodes.length;
  const singletonMembership = F.nodes.map(function (_, i) { return i; });

  // Stage 0 + Stage 1.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });
  P.renderFixture("g-singleton-cy", { membership: singletonMembership, pinned: true });

  // Stage 2 · queue init. Same partition state as Stage 1 (every node still
  // alone in its own community); separate viz frame keeps the page cadence
  // one-step-per-stage.
  P.renderFixture("g-queue-init-cy", { membership: singletonMembership, pinned: true });

  function tagEvents(traces) {
    return traces.map(function (t, i) { return Object.assign({ idx: i }, t); });
  }

  // Stage 4 · the move-phase step walker. Plays per-visit trace events from
  // level-0 moveTraces; postMembership colours the final state.
  P.mountMoveWalker({
    vizHostId: "g-move-cy",
    panelHostId: "g-move-panel",
    ctlPrefix: "g-move",
    metric: "Q",
    events: tagEvents(result.levels[0].moveTraces),
    postMembership: Array.from(result.levels[0].finePostMove),
  });

  // Stage 5 · mid-queue snapshot. Replay the first half of moveTraces
  // onto a fresh singleton membership so the static panel shows what the
  // partition looks like midway through the pass. The kernel records every
  // visit, including no-op ones; we slice at floor(half) to give a
  // representative midpoint.
  function midPassMembership(moveTraces) {
    const mem = singletonMembership.slice();
    const cut = Math.floor(moveTraces.length / 2);
    for (let i = 0; i < cut; i++) {
      const ev = moveTraces[i];
      if (ev && ev.moved && ev.v != null && ev.toComm != null) {
        // Same labelling convention the kernel uses internally; the cap
        // matches LeidenPartition.cnodes() admin tally bookkeeping but
        // since we're rendering only, raw to-community ids are fine.
        mem[ev.v] = ev.toComm;
      }
    }
    return mem;
  }
  P.renderFixture("g-move-mid-cy", {
    membership: midPassMembership(result.levels[0].moveTraces),
    pinned: true,
  });
  const midStatusEl = document.getElementById("g-move-mid-stats");
  if (midStatusEl) {
    midStatusEl.textContent = "trace cut at "
      + Math.floor(result.levels[0].moveTraces.length / 2)
      + " / " + result.levels[0].moveTraces.length + " visits";
  }

  // Stage 6 · post-move partition (move-phase fixed point on level 0).
  P.renderFixture("g-move-post-cy", {
    membership: Array.from(result.levels[0].finePostMove),
    pinned: true,
  });

  // Stage 7 · refinement init. Each node is back to its own refined
  // singleton; colour rim by the constrained move-phase label.
  P.renderFixture("g-refine-init-cy", {
    membership: Array.from(result.levels[0].finePostMove),
    pinned: true,
  });

  // Stage 9 · refinement step walker.
  P.mountRefineWalker({
    vizHostId: "g-refine-cy",
    ctlPrefix: "g-refine",
    events: tagEvents(result.levels[0].refineTraces),
    preMembership: Array.from(result.levels[0].finePostMove),
    postMembership: Array.from(result.levels[0].finePostRefine),
  });

  // Stage 10 · post-refine partition.
  P.renderFixture("g-refine-post-cy", {
    membership: Array.from(result.levels[0].finePostRefine),
    pinned: true,
  });

  // Stage 11 · aggregation.
  P.mountAggregation({
    vizHostId: "g-agg-cy",
    fineMembership: Array.from(result.levels[0].finePostRefine),
    capEl: document.getElementById("g-agg-cap"),
    playBtn: document.getElementById("g-agg-play"),
    resetBtn: document.getElementById("g-agg-reset"),
  });

  // Stage 12 · level-1 entry. The super-graph after the first collapse;
  // we paint the original 32 nodes with their move-phase community label
  // from level 0 (each super-node carries pre-refinement labels via the
  // two-label trick). Visually this is the same colouring as stage 6, but
  // the stage's role on the page is "this is what level 1 starts from".
  P.renderFixture("g-level1-cy", {
    membership: Array.from(result.levels[0].finePostMove),
    pinned: true,
  });
  const level1Cap = document.getElementById("g-level1-cap");
  if (level1Cap && result.levels[0]) {
    level1Cap.textContent =
      "n=" + result.levels[0].newCollapsedVcount
      + " super-nodes · inherits pre-refine labels";
  }

  // Stage 13 · outer-loop level table.
  function fillLevelTable() {
    const tbody = document.querySelector("#g-levels-stats tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    result.levels.forEach(function (lvl, i) {
      const ncomm = countUnique(lvl.finePostMove);
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + i + "</td>"
        + "<td>" + lvl.collapsedVcount + "</td>"
        + "<td>" + ncomm + "</td>"
        + "<td>" + lvl.newCollapsedVcount + "</td>"
        + "<td>" + lvl.moveCount + "</td>"
        + "<td>" + lvl.refineCount + "</td>";
      tbody.appendChild(tr);
    });
  }
  function countUnique(arr) {
    const s = new Set();
    for (let i = 0; i < arr.length; i++) s.add(arr[i]);
    return s.size;
  }
  fillLevelTable();

  // Stage 14 · final.
  P.mountFinalCompare({
    leidenHostId: "g-final-leiden",
    gtHostId: "g-final-gt",
    statsTbody: document.querySelector("#g-final-stats tbody"),
    membership: result.partition.membership(),
    hValue: result.quality,
    hValueEl: document.getElementById("g-final-Q"),
  });

  if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
    MathJax.typesetPromise();
  }
})();
