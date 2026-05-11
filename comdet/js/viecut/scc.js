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

  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

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
      _trace(`[TRACE-SCC-S] root_push node:${start} dfsnum:${dfsnum[start]} `
             + `unfinished_n:${unfinished.length} roots_n:${roots.length}`);

      while (iteration_stack.length > 0) {
        const top = iteration_stack.pop();
        const cur = top[0];
        let cur_e = top[1];
        _trace(`[TRACE-SCC-S] frame current:${cur} current_edge:${cur_e} `
               + `stack_n:${iteration_stack.length}`);
        let recursed = false;
        while (cur_e < G.get_first_invalid_edge(cur)) {
          const ew = G.getEdgeWeight(cur, cur_e);
          let ef;
          if (fpid === UNDEFINED_NODE) {
            ef = G.getEdgeFlow(cur, cur_e);
          } else {
            ef = G.getEdgeFlow(cur, cur_e, fpid);
          }
          const full = ef === ew ? 1 : 0;
          if (full) {
            _trace(`[TRACE-SCC-S] edge current:${cur} e:${cur_e} skip:full `
                   + `ef:${ef} ew:${ew}`);
            cur_e++;
            continue;
          }
          const target = G.getEdgeTarget(cur, cur_e);
          const dfsnum_t = dfsnum[target];
          const comp_t = comp_num[target];
          _trace(`[TRACE-SCC-S] edge current:${cur} e:${cur_e} `
                 + `target:${target} dfsnum_t:${dfsnum_t} comp_t:${comp_t}`);
          if (dfsnum[target] === -1) {
            iteration_stack.push([cur, cur_e]);
            iteration_stack.push([target, 0]);
            dfsnum[target] = dfscount++;
            unfinished.push(target);
            roots.push(target);
            _trace(`[TRACE-SCC-S] descend target:${target} `
                   + `new_dfsnum:${dfsnum[target]} `
                   + `stack_n:${iteration_stack.length} `
                   + `unfinished_n:${unfinished.length} `
                   + `roots_n:${roots.length}`);
            recursed = true;
            break;
          } else if (comp_num[target] === -1) {
            let pops = 0;
            while (dfsnum[roots[roots.length - 1]] > dfsnum[target]) {
              roots.pop();
              pops++;
            }
            _trace(`[TRACE-SCC-S] back_edge target:${target} pops:${pops} `
                   + `roots_top_after:${roots.length === 0 ? 4294967295 : roots[roots.length - 1]}`);
          }
          cur_e++;
        }
        if (recursed) continue;

        const root_match = cur === roots[roots.length - 1] ? 1 : 0;
        _trace(`[TRACE-SCC-S] root_check current:${cur} `
               + `roots_top:${roots[roots.length - 1]} match:${root_match}`);
        if (root_match) {
          let w;
          blocksizes.push(0);
          do {
            w = unfinished.pop();
            comp_num[w] = comp_count;
            blocksizes[comp_count]++;
            _trace(`[TRACE-SCC-S] commit w:${w} comp:${comp_count} `
                   + `blocksize:${blocksizes[comp_count]}`);
          } while (w !== cur);
          comp_count++;
          roots.pop();
          _trace(`[TRACE-SCC-S] comp_done count:${comp_count} `
                 + `roots_n:${roots.length} `
                 + `unfinished_n:${unfinished.length}`);
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
