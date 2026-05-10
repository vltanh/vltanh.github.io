/* Walker-page factory for the five per-variant SBM pages
 * (sbm-flat-{dc,ndc,pp}, sbm-nested-{dc,ndc}). One config call per
 * page; the rest is shared.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.SBM
      || !COMDET.SBM.BlockState || !COMDET.SBM.Graph
      || !COMDET.SBM.MT19937 || !COMDET.FIXTURE) return;
  const C = COMDET, P = C.PAGE, SBM = C.SBM, F = C.FIXTURE, U = SBM.UTIL;

  function mountWalkerPage(cfg) {
    const blockOpts = cfg.blockOpts;
    const K_SWEEPS = cfg.sweeps || 20;
    const INIT_B = cfg.initB || 8;
    const BETA = cfg.beta == null ? 1.0 : cfg.beta;

    if (C.linksRow && document.getElementById("links")) {
      document.getElementById("links").innerHTML = C.linksRow({ gen: cfg.gen });
    }

    // SBM owns its Graph + RNG; do not borrow from Leiden / Louvain.
    // SBM.Graph uses Peixoto's self-twice strength convention required
    // by Eq 43's dcDegreeConst. Built directly from the fixture so the
    // input layer is self-contained per repo convention.
    const G = SBM.Graph(F.nodes.length, F.edges, { correctSelfLoops: false });
    let seed = cfg.initialSeed == null ? 7 : cfg.initialSeed;
    let run = null;

    function buildRun(s) {
      const rng = SBM.MT19937(s >>> 0);
      const N = F.nodes.length;
      const init = U.makeBlockInit(rng, N, INIT_B);
      const state = SBM.BlockState(G, Object.assign({ init: init }, blockOpts));
      const initialMembership = state.blockMembership();
      const S0 = state.entropy();
      const eq = SBM.equilibrate(state, rng, {
        sweeps: K_SWEEPS, beta: BETA, recordCandidates: true,
      });
      // Replay accepted moves on a sibling state for per-event snapshots.
      // Rejected events leave the state unchanged; reuse the prior
      // snapshot reference instead of allocating a fresh copy.
      const replay = SBM.BlockState(G, Object.assign({ init: initialMembership }, blockOpts));
      const snapsMem = new Array(eq.traces.length + 1);
      const snapsS = new Float64Array(eq.traces.length + 1);
      snapsMem[0] = initialMembership;
      snapsS[0] = S0;
      for (let i = 0; i < eq.traces.length; i++) {
        const t = eq.traces[i];
        if (t.accepted) {
          replay.moveVertex(t.v, t.toS);
          snapsMem[i + 1] = replay.blockMembership();
          snapsS[i + 1] = replay.entropy();
        } else {
          snapsMem[i + 1] = snapsMem[i];
          snapsS[i + 1] = snapsS[i];
        }
      }
      return {
        traces: eq.traces, series: eq.series,
        snapsMem: snapsMem, snapsS: snapsS,
        initialMembership: initialMembership,
        finalMembership: state.blockMembership(),
        S0: S0, Sfinal: state.entropy(),
      };
    }
    run = buildRun(seed);

    P.renderFixture("g-input-cy", { useGT: true, pinned: true });
    P.renderFixture("g-init-cy", {
      membership: run.initialMembership, pinned: true,
    });
    setText("g-init-S0", run.S0.toFixed(2));
    setText("g-init-B0", String(INIT_B));

    function statusFor(idx, ev) {
      if (!ev) return "sweep 0 &middot; random init &middot; B<sub>0</sub> = " + INIT_B;
      const verb = ev.accepted ? "accepted" : "rejected";
      const dirn = ev.toS === ev.fromR
        ? " &middot; proposal = stay (no change)"
        : " &middot; propose " + ev.fromR + " &rarr; " + ev.toS
          + " &middot; ΔΣ = " + ev.dS.toFixed(3) + " &middot; " + verb;
      return "sweep " + (ev.sweep + 1) + " &middot; visit " + ev.v + dirn;
    }
    function statsFor(idx) {
      let acc = 0, rej = 0;
      for (let k = 0; k < idx; k++) {
        const t = run.traces[k];
        if (t.toS === t.fromR) continue;
        if (t.accepted) acc += 1; else rej += 1;
      }
      const total = acc + rej;
      const accRate = total > 0 ? (100 * acc / total).toFixed(0) : "·";
      return "accepted: " + acc + " &middot; rejected: " + rej
        + " &middot; rate: " + accRate + "% &middot; Σ = " + run.snapsS[idx].toFixed(2);
    }
    function candPanel(idx, ev) {
      if (!ev) return '<div class="step-desc">Sweep 0: random partition over B<sub>0</sub> = '
        + INIT_B + ' blocks. Step forward to see the first per-vertex MH proposal.</div>';
      return P.renderCandTable({
        rows: (ev.candidates || []).map(function (c) {
          return { s: c.s, _delta: c.dS };
        }),
        headerText: 'candidates for vertex ' + ev.v
                  + ' &middot; current block = ' + ev.fromR,
        entityHeader: 'cand block',
        metricHeader: 'ΔΣ',
        precision: 3,
        sort: 'asc',
        entityFor: function (r) { return r.s; },
        classFor: function (r) {
          if (r.s === ev.toS && ev.accepted) return 'cand-pick';
          if (r.s === ev.fromR) return 'cand-from';
          return '';
        },
        verdictFor: function (r) {
          if (r.s === ev.toS && ev.accepted) return 'picked + accepted';
          if (r.s === ev.toS) return 'picked, rejected';
          if (r.s === ev.fromR) return 'current';
          return '';
        },
      });
    }

    let mcmcWalker = P.mountStepWalker({
      vizHostId: "g-mcmc-cy",
      panelHostId: "g-mcmc-panel",
      ctlPrefix: "g-mcmc",
      events: run.traces,
      snapshotAt: function (idx) { return run.snapsMem[idx]; },
      sidePanelHTML: candPanel,
      onRender: function (idx, ev) {
        setText("g-mcmc-status", statusFor(idx, ev), true);
        setText("g-mcmc-stats",  statsFor(idx),    true);
      },
    });

    function mountEqPlot() {
      SBM.tracePlot({
        hostId: "g-eq-cy",
        traces: [
          { series: run.series, key: "S", label: "Σ", color: "#7b9bd6", primary: true, axis: "left" },
          { series: run.series, key: "B", label: "B", color: "#e0a649", axis: "right", step: true },
        ],
        xMax: K_SWEEPS,
      });
      setText("g-eq-S", run.S0.toFixed(2) + " → " + run.Sfinal.toFixed(2));
      setText("g-eq-B", INIT_B + " → " + run.series[run.series.length - 1].B);
    }
    mountEqPlot();

    function rebuildFinal() {
      const tbody = document.querySelector("#g-final-stats tbody");
      if (tbody) tbody.innerHTML = "";
      P.mountFinalCompare({
        leidenHostId: "g-final-sbm",
        gtHostId: "g-final-gt",
        statsTbody: tbody,
        membership: run.finalMembership,
        hValue: run.Sfinal,
        hValueEl: document.getElementById("g-final-S"),
      });
    }
    rebuildFinal();

    P.wireSeedReroll({
      prefix: "g",
      initialSeed: seed,
      onReroll: function (newSeed) {
        seed = newSeed;
        run = buildRun(seed);
        P.renderFixture("g-init-cy", {
          membership: run.initialMembership, pinned: true,
        });
        setText("g-init-S0", run.S0.toFixed(2));
        mcmcWalker.controller.reconfigure(run.traces.length + 1);
        mcmcWalker.controller.set(0);
        mountEqPlot();
        rebuildFinal();
        if (C.retypeset) C.retypeset();
      },
    });

    if (C.retypeset) C.retypeset();
  }

  function setText(id, html, asHTML) {
    const el = document.getElementById(id);
    if (!el) return;
    if (asHTML) el.innerHTML = html;
    else el.textContent = html;
  }

  SBM.mountWalkerPage = mountWalkerPage;
})();
