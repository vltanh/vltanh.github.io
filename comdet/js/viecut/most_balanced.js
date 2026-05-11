/* most_balanced::findCutFromCactus: BFS over the cactus to extract the
 * bipartition selected by balanced_cut_dfs.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/most_balanced_minimum_cut.h:25-113]
 *
 * Public API: COMDET.VIECUT.findBipartitionFromCactus(cactus, n_orig, dfsOut)
 * Returns Int8Array bipartition indexed by original-graph node id.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function emit(event, payload) {
    const h = (typeof globalThis !== "undefined") && globalThis.__VIECUT_HOOK;
    if (typeof h === "function") h(event, payload);
  }

  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

  function findBipartitionFromCactus(cactus, n_orig, dfsOut) {
    const { best_n, best_e, best_n2, best_e2 } = dfsOut;
    const n1 = best_n;
    const n2 = best_n2;
    const rev_n1 = cactus.getEdgeTarget(n1, best_e);
    const rev_n2 = cactus.getEdgeTarget(n2, best_e2);

    const inCut = new Int8Array(n_orig);
    const checked = new Uint8Array(cactus.n());
    const q = [n1];
    let qhead = 0;
    checked[n1] = 1;
    if (n1 !== n2) {
      q.push(n2);
      checked[n2] = 1;
    }
    checked[rev_n1] = 1;
    checked[rev_n2] = 1;

    emit("mb_init", { n1, n2, rev_n1, rev_n2 });
    while (qhead < q.length) {
      const top = q[qhead++];
      const contained = cactus.containedVertices(top).slice();
      for (const v of contained) inCut[v] = 1;
      emit("mb_visit", { cactus_node: top, contained });
      const ne = cactus.get_first_invalid_edge(top);
      for (let e = 0; e < ne; e++) {
        const t = cactus.getEdgeTarget(top, e);
        const ck = checked[t] ? 1 : 0;
        _trace(`[TRACE-MB-BFE] top:${top} e:${e} t:${t} `
               + `checked_before:${ck} push:${1 - ck}`);
        if (!checked[t]) {
          q.push(t);
          checked[t] = 1;
        }
      }
    }
    return inCut;
  }

  NS.findBipartitionFromCactus = findBipartitionFromCactus;
})();
