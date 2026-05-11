/* balanced_cut_dfs: most-balanced minimum cut over a cactus tree.
 *
 * [UPSTREAM VieCut/lib/algorithms/global_mincut/cactus/balanced_cut_dfs.h]
 *
 * Recursive C++ DFS translated to an explicit-stack iterative form to
 * avoid blowing the JS call stack on deep cacti. Frame state is
 * {node, edgeIdx, children_weight, awaiting} where `awaiting` records
 * which edge's recursion we're parked on.
 *
 * Public API: COMDET.VIECUT.runBalancedCutDFS(G, mincut, start_vertex)
 * Returns { best_n, best_e, best_n2, best_e2, best_in_cycle, best_weight }.
 * If best_in_cycle is true, best_n2/best_e2 carry the cycle's other cut
 * edge; otherwise best_n2 == best_n and best_e2 == best_e (tree edge).
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

  // Per byte-equal-tracer "Tracer prints stay" discipline: probes mirroring
  // canonical [TRACE-BCD-*] tags from balanced_cut_dfs.h.
  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

  // [UPSTREAM common/definitions.h:50-55] DFSVertexStatus
  const UNDISCOVERED = 0;
  const ACTIVE = 1;
  const CYCLE = 2;
  const FINISHED = 3;

  function runBalancedCutDFS(G, mincut, start_vertex) {
    const n = G.n();
    const status = new Int8Array(n);
    const subtree_weight = new Array(n).fill(-1);
    const parent = new Array(n).fill(-1);
    const outgoing_cycles = Array.from({ length: n }, () => []);

    let best_in_cycle = false;
    let best_n = 0, best_e = 0, best_n2 = 0, best_e2 = 0, best_weight = 0;

    function totalWeight() { return G.getOriginalNodes(); }
    function findVertexWeight(node) {
      // optimize_conductance is false in cc/wcc/cm path; JS port omits the
      // weighted branch entirely.
      const result = G.containedVertices(node).length;
      _trace(`[TRACE-BCD-VW] n:${node} oc:0 w:${result}`);
      return result;
    }
    function lighterBlock(w) {
      const tw = totalWeight();
      const result = Math.min(w, tw - w);
      _trace(`[TRACE-BCD-LB] w:${w} tw:${tw} tw_minus_w:${tw - w} `
             + `lighter:${result}`);
      return result;
    }

    function investigateCycle(t, start) {
      _trace(`[TRACE-BCD-IC] enter t:${t} start:${start}`);
      const cycle_vertices = [t];
      const cycle_weight = [subtree_weight[t]];
      while (cycle_vertices[cycle_vertices.length - 1] !== start) {
        const par = parent[cycle_vertices[cycle_vertices.length - 1]];
        const cvb = cycle_vertices[cycle_vertices.length - 1];
        const delta = subtree_weight[par] - subtree_weight[cvb];
        _trace(`[TRACE-BCD-IC] walk par:${par} cv_back:${cvb} `
               + `subtree_par:${subtree_weight[par]} `
               + `subtree_back:${subtree_weight[cvb]} delta:${delta}`);
        cycle_weight.push(delta);
        cycle_vertices.push(par);
      }
      const cw_final =
        totalWeight()
        - subtree_weight[cycle_vertices[cycle_vertices.length - 2]];
      cycle_weight[cycle_weight.length - 1] = cw_final;
      _trace(`[TRACE-BCD-IC] cycle_built length:${cycle_weight.length} `
             + `cw_back_final:${cw_final}`);

      const length = cycle_weight.length;
      let back = length;
      let front = 1;
      let in_weight = cycle_weight[0];
      let sw_step = 0;
      while (back <= 2 * length) {
        const lb = lighterBlock(in_weight);
        const t21 = lb >= best_weight ? 1 : 0;
        _trace(`[TRACE-BCD-IC] sw step:${sw_step} back:${back} front:${front} `
               + `in_w:${in_weight} lb:${lb} best_w:${best_weight} t21:${t21}`);
        if (t21) {
          best_weight = lb;
          best_in_cycle = true;
          const fn = cycle_vertices[((front - 1) % length + length) % length];
          const ftgt = cycle_vertices[((front) % length + length) % length];
          const fne = G.get_first_invalid_edge(fn);
          for (let e = 0; e < fne; e++) {
            if (G.getEdgeTarget(fn, e) === ftgt) {
              best_n = fn; best_e = e; break;
            }
          }
          const bn = cycle_vertices[((back - 1) % length + length) % length];
          const btgt = cycle_vertices[((back) % length + length) % length];
          const bne = G.get_first_invalid_edge(bn);
          for (let e = 0; e < bne; e++) {
            if (G.getEdgeTarget(bn, e) === btgt) {
              best_n2 = bn; best_e2 = e; break;
            }
          }
          _trace(`[TRACE-BCD-IC] best_update best_n:${best_n} `
                 + `best_e:${best_e} best_n2:${best_n2} best_e2:${best_e2} `
                 + `best_w:${best_weight}`);
        }
        const tw = totalWeight();
        const inw2 = in_weight * 2;
        const t22 = inw2 >= tw ? 1 : 0;
        const in_before = in_weight;
        if (t22) {
          in_weight -= cycle_weight[((back) % length + length) % length];
          back++;
        } else {
          in_weight += cycle_weight[((front) % length + length) % length];
          front++;
        }
        _trace(`[TRACE-BCD-IC] sw_dir step:${sw_step} inw2:${inw2} `
               + `tw:${tw} t22:${t22} in_before:${in_before} `
               + `in_after:${in_weight} back:${back} front:${front}`);
        sw_step++;
      }
      _trace(`[TRACE-BCD-IC] exit best_n:${best_n} best_e:${best_e} `
             + `best_n2:${best_n2} best_e2:${best_e2} best_w:${best_weight}`);
    }

    function checkForCycles(node) {
      for (const t of outgoing_cycles[node]) investigateCycle(t, node);
    }

    const stack = [];
    function pushFrame(node) {
      status[node] = ACTIVE;
      const fie = G.get_first_invalid_edge(node);
      const leaf = (fie === 1 && node !== start_vertex) ? 1 : 0;
      const vw_leaf = leaf ? findVertexWeight(node) : 0;
      _trace(`[TRACE-BCD-P] enter n:${node} fie:${fie} `
             + `start:${start_vertex} leaf:${leaf} vw_leaf:${vw_leaf}`);
      if (leaf) {
        subtree_weight[node] = vw_leaf;
        status[node] = FINISHED;
        _trace(`[TRACE-BCD-P] leaf_exit n:${node} `
               + `subtree_weight:${subtree_weight[node]}`);
        return;
      }
      stack.push({ node, edgeIdx: 0, children_weight: 0, awaiting: -1 });
    }

    pushFrame(start_vertex);

    while (stack.length > 0) {
      const f = stack[stack.length - 1];
      if (f.awaiting >= 0) {
        const e = f.awaiting;
        const t = G.getEdgeTarget(f.node, e);
        const lb = lighterBlock(subtree_weight[t]);
        const w = G.getEdgeWeight(f.node, e);
        const t20 = (lb > best_weight && w === mincut) ? 1 : 0;
        _trace(`[TRACE-BCD-P] und_post n:${f.node} e:${e} t:${t} `
               + `subtree_t:${subtree_weight[t]} lb:${lb} `
               + `best_w:${best_weight} w:${w} mc:${mincut} `
               + `t20_update:${t20}`);
        if (t20) {
          best_in_cycle = false;
          best_n = f.node; best_e = e;
          best_weight = lb;
          emit("bcd_best", { node: f.node, edge: e, target: t, weight: best_weight, kind: "tree" });
        }
        const cw_before = f.children_weight;
        f.children_weight += subtree_weight[t];
        _trace(`[TRACE-BCD-P] cw_acc n:${f.node} t:${t} `
               + `cw_before:${cw_before} subtree_t:${subtree_weight[t]} `
               + `cw_after:${f.children_weight}`);
        f.awaiting = -1;
        f.edgeIdx++;
        continue;
      }
      if (f.edgeIdx >= G.get_first_invalid_edge(f.node)) {
        if (status[f.node] === CYCLE) checkForCycles(f.node);
        const vw = findVertexWeight(f.node);
        subtree_weight[f.node] = f.children_weight + vw;
        _trace(`[TRACE-BCD-P] exit n:${f.node} cw:${f.children_weight} `
               + `vw:${vw} subtree_weight:${subtree_weight[f.node]}`);
        status[f.node] = FINISHED;
        stack.pop();
        continue;
      }
      const e = f.edgeIdx;
      const t = G.getEdgeTarget(f.node, e);
      _trace(`[TRACE-BCD-P] edge n:${f.node} e:${e} t:${t} `
             + `status_t:${status[t]}`);
      switch (status[t]) {
        case UNDISCOVERED:
          parent[t] = f.node;
          if (G.get_first_invalid_edge(t) === 1 && t !== start_vertex) {
            // Inline leaf-recursion: emit cpp-equivalent enter + leaf_exit
            // for the child frame, then the post-recursion update for the
            // current frame.
            const child_fie = G.get_first_invalid_edge(t);
            _trace(`[TRACE-BCD-P] enter n:${t} fie:${child_fie} `
                   + `start:${start_vertex} leaf:1 `
                   + `vw_leaf:${G.containedVertices(t).length}`);
            status[t] = ACTIVE;
            subtree_weight[t] = findVertexWeight(t);
            status[t] = FINISHED;
            _trace(`[TRACE-BCD-P] leaf_exit n:${t} `
                   + `subtree_weight:${subtree_weight[t]}`);
            const lb = lighterBlock(subtree_weight[t]);
            const w = G.getEdgeWeight(f.node, e);
            const t20 = (lb > best_weight && w === mincut) ? 1 : 0;
            _trace(`[TRACE-BCD-P] und_post n:${f.node} e:${e} t:${t} `
                   + `subtree_t:${subtree_weight[t]} lb:${lb} `
                   + `best_w:${best_weight} w:${w} mc:${mincut} `
                   + `t20_update:${t20}`);
            if (t20) {
              best_in_cycle = false;
              best_n = f.node; best_e = e;
              best_weight = lb;
            }
            const cw_before = f.children_weight;
            f.children_weight += subtree_weight[t];
            _trace(`[TRACE-BCD-P] cw_acc n:${f.node} t:${t} `
                   + `cw_before:${cw_before} subtree_t:${subtree_weight[t]} `
                   + `cw_after:${f.children_weight}`);
            f.edgeIdx++;
          } else {
            status[t] = ACTIVE;
            stack.push({ node: t, edgeIdx: 0, children_weight: 0, awaiting: -1 });
            // Emit cpp-equivalent enter line for the new child frame.
            _trace(`[TRACE-BCD-P] enter n:${t} `
                   + `fie:${G.get_first_invalid_edge(t)} `
                   + `start:${start_vertex} leaf:0 vw_leaf:0`);
            f.awaiting = e;
          }
          break;
        case ACTIVE:
        case CYCLE:
          if (parent[f.node] !== t) {
            status[t] = CYCLE;
            outgoing_cycles[t].push(f.node);
            _trace(`[TRACE-BCD-P] cycle_mark n:${f.node} t:${t} `
                   + `oc_size:${outgoing_cycles[t].length}`);
          }
          f.edgeIdx++;
          break;
        default:
          f.edgeIdx++;
          break;
      }
    }

    if (best_in_cycle) {
      const r2 = G.getEdgeTarget(best_n2, best_e2);
      const e2r = G.getReverseEdge(best_n2, best_e2);
      return {
        best_n, best_e,
        best_n2: r2, best_e2: e2r,
        best_in_cycle: true, best_weight,
      };
    }
    return {
      best_n, best_e,
      best_n2: best_n, best_e2: best_e,
      best_in_cycle: false, best_weight,
    };
  }

  NS.runBalancedCutDFS = runBalancedCutDFS;
})();
