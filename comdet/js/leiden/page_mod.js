/* Leiden-Mod page glue. Same kernel + helpers as Leiden-CPM, swapped to
 * the Modularity quality function (no γ slider).
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

  // Stage 0 + Stage 1.
  P.renderFixture("g-input-cy", { useGT: true, pinned: true });
  P.renderFixture("g-singleton-cy", {
    membership: F.nodes.map(function (_, i) { return i; }),
    pinned: true,
  });

  function tagEvents(traces) {
    return traces.map(function (t, i) { return Object.assign({ idx: i }, t); });
  }

  P.mountMoveWalker({
    vizHostId: "g-move-cy",
    panelHostId: "g-move-panel",
    ctlPrefix: "g-move",
    metric: "Q",
    events: tagEvents(result.levels[0].moveTraces),
    postMembership: Array.from(result.levels[0].finePostMove),
  });

  P.mountRefineWalker({
    vizHostId: "g-refine-cy",
    ctlPrefix: "g-refine",
    events: tagEvents(result.levels[0].refineTraces),
    preMembership: Array.from(result.levels[0].finePostMove),
    postMembership: Array.from(result.levels[0].finePostRefine),
  });

  P.mountAggregation({
    vizHostId: "g-agg-cy",
    fineMembership: Array.from(result.levels[0].finePostRefine),
    capEl: document.getElementById("g-agg-cap"),
    playBtn: document.getElementById("g-agg-play"),
    resetBtn: document.getElementById("g-agg-reset"),
  });

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
