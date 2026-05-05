/* Tarjan strongly_connected_components on residual graphs.
 *
 * [UPSTREAM VieCut/lib/algorithms/misc/strongly_connected_components.h]
 *
 * Used by recursive_cactus to partition contracted graph into SCCs of
 * the residual (skips edges with full flow). The fpid argument routes
 * through mutable_graph::getEdgeFlow(node, edge, fpid) to read flow
 * scoped to a specific problem id.
 *
 * Returns { comp_num: int[], comp_count: int, blocksizes: int[] }.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_NODE = 0xffffffff;

  function strong_components(G, fpid) {
    if (fpid === undefined) fpid = UNDEFINED_NODE;
    const n = G.number_of_nodes();
    const dfsnum = new Int32Array(n).fill(-1);
    const comp_num = new Int32Array(n).fill(-1);
    const blocksizes = [];
    const unfinished = [];
    const roots = [];
    const iteration_stack = [];
    let dfscount = 0;
    let comp_count = 0;

    function explicit_scc_dfs(start) {
      iteration_stack.push([start, 0]);
      dfsnum[start] = dfscount++;
      unfinished.push(start);
      roots.push(start);

      while (iteration_stack.length > 0) {
        const top = iteration_stack.pop();
        const cur = top[0];
        let cur_e = top[1];
        let recursed = false;
        while (cur_e < G.get_first_invalid_edge(cur)) {
          // edges with full flow drop out of residual.
          let edge_full;
          if (fpid === UNDEFINED_NODE) {
            edge_full = G.getEdgeFlow(cur, cur_e) === G.getEdgeWeight(cur, cur_e);
          } else {
            edge_full = G.getEdgeFlow(cur, cur_e, fpid) === G.getEdgeWeight(cur, cur_e);
          }
          if (edge_full) { cur_e++; continue; }
          const target = G.getEdgeTarget(cur, cur_e);
          if (dfsnum[target] === -1) {
            iteration_stack.push([cur, cur_e]);
            iteration_stack.push([target, 0]);
            dfsnum[target] = dfscount++;
            unfinished.push(target);
            roots.push(target);
            recursed = true;
            break;
          } else if (comp_num[target] === -1) {
            while (dfsnum[roots[roots.length - 1]] > dfsnum[target]) roots.pop();
          }
          cur_e++;
        }
        if (recursed) continue;

        if (cur === roots[roots.length - 1]) {
          let w;
          blocksizes.push(0);
          do {
            w = unfinished.pop();
            comp_num[w] = comp_count;
            blocksizes[comp_count]++;
          } while (w !== cur);
          comp_count++;
          roots.pop();
        }
      }
    }

    for (let node = 0; node < n; node++) {
      if (dfsnum[node] === -1) explicit_scc_dfs(node);
    }
    return { comp_num: Array.from(comp_num), comp_count, blocksizes };
  }

  NS.strong_components = strong_components;
})();
