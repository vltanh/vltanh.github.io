/* Shared compare-page factory for the two meta SBM pages
 * (sbm-flat-best, sbm-nested-best). Runs each variant from the same
 * seeded init.
 *
 * Σ across variants in this JS port is NOT directly commensurable: the
 * sparse-entropy formulas have systematic scale gaps (DC's `xlogx(e_r)`
 * dominates NDC's `e_r·log(n_r)` whenever e_r ≫ n_r), and the PP
 * `ppEdgesDl` is much smaller than DC/NDC `edgesDl`. Picking by raw
 * min-Σ would always favour the variant with fewer DL terms. Instead
 * we rank by ΔΣ vs the other variants and tag verdicts under
 * Peixoto 2017 §VII.A's Bayes-factor reading: |ΔΣ| < ~5 nats is
 * inconclusive, |ΔΣ| > ~10 nats is decisive.
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.PAGE || !COMDET.SBM
      || !COMDET.SBM.BlockState || !COMDET.LOUVAIN || !COMDET.FIXTURE) return;
  const C = COMDET, P = C.PAGE, SBM = C.SBM, F = C.FIXTURE, LV = C.LOUVAIN;

  const SBM_THRESHOLD = 5;     // nats; |ΔΣ| below this = inconclusive
  const SBM_DECISIVE = 10;     // nats; above this = decisive

  function mountComparePage(cfg) {
    const variants = cfg.variants;
    const K_SWEEPS = cfg.sweeps || 20;
    const INIT_B = cfg.initB || 8;
    const BETA = cfg.beta == null ? 1.0 : cfg.beta;

    if (C.linksRow && document.getElementById("links")) {
      document.getElementById("links").innerHTML = C.linksRow({ gen: cfg.gen });
    }

    const G = P.buildLeidenGraph();
    let seed = cfg.initialSeed == null ? 7 : cfg.initialSeed;
    let runs = null;

    function buildSharedInit(s) {
      const N = F.nodes.length;
      const rng = LV.MT19937(s >>> 0);
      const order = LV.range(N);
      LV.shuffle(order, rng);
      const init = new Int32Array(N);
      for (let i = 0; i < N; i++) init[order[i]] = i % INIT_B;
      return init;
    }
    function runOne(v, sharedInit) {
      const rng = LV.MT19937(seed >>> 0);
      const state = SBM.BlockState(G, Object.assign({ init: sharedInit }, v.opts));
      const S0 = state.entropy();
      const eq = SBM.equilibrate(state, rng, {
        sweeps: K_SWEEPS, beta: BETA, recordTrace: false,
      });
      return {
        id: v.id, label: v.label, color: v.color,
        S0: S0, Sfinal: state.entropy(),
        Bfinal: state.nonEmptyBlocks().length,
        membership: state.blockMembership(),
        series: eq.series,
      };
    }
    function buildRuns() {
      const init = buildSharedInit(seed);
      runs = variants.map(function (v) { return runOne(v, init); });
    }
    buildRuns();

    P.renderFixture("g-input-cy", { useGT: true, pinned: true });

    function verdictFor(r) {
      // ΔΣ vs each other variant; smallest gap to any variant (signed
      // such that negative = this variant is below).
      let bestEdge = Infinity;
      runs.forEach(function (other) {
        if (other.id === r.id) return;
        const gap = r.Sfinal - other.Sfinal;
        if (gap < bestEdge) bestEdge = gap;
      });
      if (bestEdge >= -SBM_THRESHOLD) {
        return "tied with neighbour (|ΔΣ| within " + SBM_THRESHOLD + " nats)";
      }
      if (bestEdge >= -SBM_DECISIVE) {
        return "below by " + (-bestEdge).toFixed(1) + " nats (suggestive)";
      }
      return "below by " + (-bestEdge).toFixed(1) + " nats (decisive)";
    }

    function renderPanels() {
      runs.forEach(function (r) {
        const hostId = "g-final-" + r.id;
        P.renderFixture(hostId, {
          membership: r.membership, pinned: true, nodeR: 8,
        });
        const cap = document.getElementById("g-cap-" + r.id);
        if (cap) {
          cap.innerHTML = r.label + " &middot; \\(\\Sigma = \\) "
            + r.Sfinal.toFixed(2) + " bits &middot; B = " + r.Bfinal;
        }
      });
      const tbody = document.querySelector("#g-cmp tbody");
      if (tbody) {
        tbody.innerHTML = runs.map(function (r) {
          return '<tr><td>' + r.label + '</td><td>'
            + r.S0.toFixed(2) + '</td><td>' + r.Sfinal.toFixed(2) + '</td><td>'
            + r.Bfinal + '</td><td>' + verdictFor(r) + '</td></tr>';
        }).join("");
      }
    }
    renderPanels();

    function mountTrace() {
      SBM.tracePlot({
        hostId: "g-eq-cy",
        traces: runs.map(function (r) {
          return {
            series: r.series, key: "S", label: r.label,
            color: r.color, axis: "left",
          };
        }),
        xMax: K_SWEEPS,
      });
    }
    mountTrace();

    P.wireSeedReroll({
      prefix: "g",
      initialSeed: seed,
      onReroll: function (newSeed) {
        seed = newSeed;
        buildRuns();
        renderPanels();
        mountTrace();
        if (C.retypeset) C.retypeset();
      },
    });

    if (C.retypeset) C.retypeset();
  }

  SBM.VARIANTS = {
    dc:  { id: "dc",  label: "DC",  color: "#7b9bd6", opts: { mode: "dc"  } },
    ndc: { id: "ndc", label: "NDC", color: "#e0a649", opts: { mode: "ndc" } },
    pp:  { id: "pp",  label: "PP",  color: "#8fbb70", opts: { mode: "pp"  } },
  };
  SBM.mountComparePage = mountComparePage;
})();
