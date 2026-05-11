/* heavy_edges: pre/post processing of cactus reduction.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/heavy_edges.h]
 *
 * Removes edges with wgt > mincut (contract the endpoints) and notes
 * mincut-weight edges from leaf vertices for re-insertion in the final
 * cactus. contractCycleEdges merges chains of degree-2 vertices into
 * cycles; reInsertCycles + reInsertVertices undo the reductions on the
 * final cactus.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_NODE = 0xffffffff;
  const UNDEFINED_EDGE = 0xffffffff;

  // Per byte-equal-tracer playbook discipline "Tracer prints stay": stderr
  // probes for removeHeavyEdges + contractCycleEdges. Mirror canonical
  // [TRACE-HE] / [TRACE-HE-EDGE] / [TRACE-HE-GROUP] / [TRACE-HE-MARK] /
  // [TRACE-HE-CYC] from instrumented heavy_edges.h. Guarded by
  // globalThis.__VIECUT_TRACE__ so production walker is unaffected.
  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

  function HeavyEdges(mincut) { this.mincut = mincut; }

  HeavyEdges.prototype.removeHeavyEdges = function (G) {
    _trace(`[TRACE-HE] removeHeavyEdges entry n_before:${G.n()} `
           + `m_before:${G.number_of_edges()} mincut:${this.mincut}`);
    const cactusEdge = [];
    const contract = new Map();
    const markForCactus = [];
    for (let n = 0; n < G.number_of_nodes(); n++) {
      if (G.isEmpty(n)) continue;
      const ne = G.get_first_invalid_edge(n);
      for (let e = 0; e < ne; e++) {
        const wgt = G.getEdgeWeight(n, e);
        const target = G.getEdgeTarget(n, e);
        if (G.isEmpty(target)) continue;
        const t23_gt = wgt > this.mincut ? 1 : 0;
        const t24_eq = wgt === this.mincut ? 1 : 0;
        if (t23_gt) {
          const v1 = G.containedVertices(n)[0];
          const v2 = G.containedVertices(target)[0];
          const lo = Math.min(v1, v2);
          const hi = Math.max(v1, v2);
          const insertion = !contract.has(lo) ? 1 : 0;
          if (insertion) contract.set(lo, [hi]);
          else contract.get(lo).push(hi);
          _trace(`[TRACE-HE-EDGE] n:${n} e:${e} wgt:${wgt} target:${target} `
                 + `branch:gt v1:${v1} v2:${v2} min:${lo} max:${hi} `
                 + `insertion:${insertion} contract_size:${contract.size}`);
        }
        if (t24_eq) {
          const first_inv = G.get_first_invalid_edge(n);
          const deg1 = first_inv === 1 ? 1 : 0;
          if (deg1) {
            const v0 = G.containedVertices(n)[0];
            markForCactus.push(v0);
            _trace(`[TRACE-HE-EDGE] n:${n} e:${e} wgt:${wgt} target:${target} `
                   + `branch:eq deg1:1 first_inv:${first_inv} v0:${v0} `
                   + `mark_size:${markForCactus.length}`);
          } else {
            _trace(`[TRACE-HE-EDGE] n:${n} e:${e} wgt:${wgt} target:${target} `
                   + `branch:eq deg1:0 first_inv:${first_inv}`);
          }
        }
      }
    }
    _trace(`[TRACE-HE] removeHeavyEdges contract_map_size:${contract.size} `
           + `mark_size:${markForCactus.length}`);
    let group_idx = 0;
    for (const [lowest, others] of contract) {
      const set = new Set();
      set.add(G.getCurrentPosition(lowest));
      for (const v of others) set.add(G.getCurrentPosition(v));
      // Set members traced id-ASC sorted (read-only) to mirror canonical
      // TracerSet iteration emission; the runtime Set is consumed by
      // contractVertexSet which applies its own id-ASC sort internally
      // (see contract_graph.js row-H closure).
      const setSorted = Array.from(set).sort((a, b) => a - b);
      _trace(`[TRACE-HE-GROUP] idx:${group_idx} lowest:${lowest} `
             + `others_n:${others.length} vtxset_size:${set.size} `
             + `vtxset:[${setSorted.join(",")}]`);
      if (set.size > 1) G.contractVertexSet(set);
      group_idx++;
    }
    for (const orig of markForCactus) {
      if (G.n() > 2) {
        const n = G.getCurrentPosition(orig);
        if (G.get_first_invalid_edge(n) !== 1) continue;
        const t = G.getEdgeTarget(n, 0);
        if (G.isEmpty(t)) continue;
        const vtx_in_t = G.containedVertices(t)[0];
        _trace(`[TRACE-HE-MARK] orig:${orig} curr_n:${n} t:${t} `
               + `vtx_in_t:${vtx_in_t} n_before_del:${G.n()}`);
        cactusEdge.push([vtx_in_t, G.containedVertices(n).slice()]);
        G.deleteVertex(n);
      }
    }
    _trace(`[TRACE-HE] removeHeavyEdges exit n_after:${G.n()} `
           + `m_after:${G.number_of_edges()} `
           + `cactusEdge_size:${cactusEdge.length}`);
    return cactusEdge;
  };

  HeavyEdges.prototype.contractCycleEdges = function (G) {
    _trace(`[TRACE-HE] contractCycleEdges entry n_before:${G.n()} `
           + `m_before:${G.number_of_edges()} mincut:${this.mincut}`);
    const cycleEdges = [];
    for (let n = 0; n < G.n(); n++) {
      const first_inv = G.get_first_invalid_edge(n);
      const wdeg = (first_inv === 2) ? G.getWeightedNodeDegree(n) : -1;
      const primary = (first_inv === 2 && wdeg === this.mincut);
      if (primary) {
        let n0 = G.getEdgeTarget(n, 0);
        let n1 = G.getEdgeTarget(n, 1);
        const n0_empty = G.isEmpty(n0) ? 1 : 0;
        const n1_empty = G.isEmpty(n1) ? 1 : 0;
        if (n0_empty || n1_empty) {
          _trace(`[TRACE-HE-CYC] n:${n} branch:primary skip_empty `
                 + `n0:${n0} n1:${n1} n0e:${n0_empty} n1e:${n1_empty}`);
          continue;
        }
        const w0 = G.getEdgeWeight(n, 0);
        const w1 = G.getEdgeWeight(n, 1);
        let rev = 0;
        const t25_gt = w1 > w0 ? 1 : 0;
        const t26_lt = w1 < w0 ? 1 : 0;
        const orig_n0 = n0, orig_n1 = n1;
        if (t25_gt) { rev = 1; n0 = n1; }
        if (t26_lt) { n1 = n0; }
        const p0 = G.containedVertices(n0)[0];
        const p1 = G.containedVertices(n1)[0];
        const contained = G.containedVertices(n).slice();
        G.setContainedVertices(n, []);
        for (const c of contained) G.setCurrentPosition(c, UNDEFINED_NODE);
        _trace(`[TRACE-HE-CYC] n:${n} branch:primary first_inv:${first_inv} `
               + `wdeg:${wdeg} orig_n0:${orig_n0} orig_n1:${orig_n1} `
               + `w0:${w0} w1:${w1} t25_gt:${t25_gt} t26_lt:${t26_lt} `
               + `rev:${rev} n0:${n0} n1:${n1} p0:${p0} p1:${p1} `
               + `contained_n:${contained.length}`);
        G.contractEdgeSparseTarget(n0, G.getReverseEdge(n, rev));
        cycleEdges.push([[p0, p1], contained]);
      } else if (first_inv === 2
                 && G.getEdgeWeight(n, 0) !== G.getEdgeWeight(n, 1)) {
        const w0 = G.getEdgeWeight(n, 0);
        const w1 = G.getEdgeWeight(n, 1);
        const h1 = w0 < w1 ? 1 : 0;
        const heavier = h1 ? 1 : 0;
        const ngbr = G.getEdgeTarget(n, heavier);
        const rev = G.getReverseEdge(n, heavier);
        _trace(`[TRACE-HE-CYC] n:${n} branch:alt first_inv:${first_inv} `
               + `w0:${w0} w1:${w1} h1:${h1} heavier:${heavier} `
               + `ngbr:${ngbr} rev:${rev}`);
        G.contractEdgeSparseTarget(ngbr, rev);
      } else {
        if (first_inv === 2) {
          _trace(`[TRACE-HE-CYC] n:${n} branch:none first_inv:${first_inv} `
                 + `wdeg:${wdeg} mincut:${this.mincut}`);
        }
      }
    }
    _trace(`[TRACE-HE] contractCycleEdges exit n_after:${G.n()} `
           + `m_after:${G.number_of_edges()} `
           + `cycleEdges_size:${cycleEdges.length}`);
    return cycleEdges;
  };

  HeavyEdges.prototype.reInsertCycles = function (G, toInsert) {
    for (let i = toInsert.length; i-- > 0; ) {
      const [pp, cont] = toInsert[i];
      const n0 = G.getCurrentPosition(pp[0]);
      const n1 = G.getCurrentPosition(pp[1]);
      const reIns = G.new_empty_node();
      if (n0 === n1) {
        G.new_edge_order(n0, reIns, this.mincut);
      } else {
        let e = UNDEFINED_EDGE;
        const ne = G.get_first_invalid_edge(n0);
        for (let arc = 0; arc < ne; arc++) {
          if (G.getEdgeTarget(n0, arc) === n1) { e = arc; break; }
        }
        if (e === UNDEFINED_EDGE) throw new Error("reInsertCycles: vertices not neighbours");
        G.new_edge_order(n0, reIns, this.mincut / 2);
        G.new_edge_order(n1, reIns, this.mincut / 2);
        const w01 = G.getEdgeWeight(n0, e);
        if (w01 === this.mincut / 2) G.deleteEdge(n0, e);
        else G.setEdgeWeight(n0, e, w01 - this.mincut / 2);
      }
      G.setContainedVertices(reIns, cont);
      for (const v of cont) G.setCurrentPosition(v, reIns);
    }
  };

  HeavyEdges.prototype.reInsertVertices = function (G, toInsert) {
    for (let i = toInsert.length; i-- > 0; ) {
      const [t, cont] = toInsert[i];
      const curr = G.getCurrentPosition(t);
      const vtx = G.new_empty_node();
      G.new_edge_order(curr, vtx, this.mincut);
      G.setContainedVertices(vtx, cont);
      for (const v of cont) G.setCurrentPosition(v, vtx);
    }
  };

  NS.HeavyEdges = HeavyEdges;
})();
