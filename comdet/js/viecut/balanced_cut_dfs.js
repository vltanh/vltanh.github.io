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
    function findVertexWeight(node) { return G.containedVertices(node).length; }
    function lighterBlock(w) { return Math.min(w, totalWeight() - w); }

    function investigateCycle(t, start) {
      const cycle_vertices = [t];
      const cycle_weight = [subtree_weight[t]];
      while (cycle_vertices[cycle_vertices.length - 1] !== start) {
        const par = parent[cycle_vertices[cycle_vertices.length - 1]];
        cycle_weight.push(
          subtree_weight[par]
          - subtree_weight[cycle_vertices[cycle_vertices.length - 1]]);
        cycle_vertices.push(par);
      }
      cycle_weight[cycle_weight.length - 1] =
        totalWeight()
        - subtree_weight[cycle_vertices[cycle_vertices.length - 2]];

      const length = cycle_weight.length;
      let back = length;
      let front = 1;
      let in_weight = cycle_weight[0];
      while (back <= 2 * length) {
        if (lighterBlock(in_weight) >= best_weight) {
          best_weight = lighterBlock(in_weight);
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
        }
        if (in_weight * 2 >= totalWeight()) {
          in_weight -= cycle_weight[((back) % length + length) % length];
          back++;
        } else {
          in_weight += cycle_weight[((front) % length + length) % length];
          front++;
        }
      }
    }

    function checkForCycles(node) {
      for (const t of outgoing_cycles[node]) investigateCycle(t, node);
    }

    const stack = [];
    function pushFrame(node) {
      status[node] = ACTIVE;
      if (G.get_first_invalid_edge(node) === 1 && node !== start_vertex) {
        subtree_weight[node] = findVertexWeight(node);
        status[node] = FINISHED;
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
        if (lighterBlock(subtree_weight[t]) > best_weight
            && G.getEdgeWeight(f.node, e) === mincut) {
          best_in_cycle = false;
          best_n = f.node; best_e = e;
          best_weight = lighterBlock(subtree_weight[t]);
        }
        f.children_weight += subtree_weight[t];
        f.awaiting = -1;
        f.edgeIdx++;
        continue;
      }
      if (f.edgeIdx >= G.get_first_invalid_edge(f.node)) {
        if (status[f.node] === CYCLE) checkForCycles(f.node);
        subtree_weight[f.node] = f.children_weight + findVertexWeight(f.node);
        status[f.node] = FINISHED;
        stack.pop();
        continue;
      }
      const e = f.edgeIdx;
      const t = G.getEdgeTarget(f.node, e);
      switch (status[t]) {
        case UNDISCOVERED:
          parent[t] = f.node;
          if (G.get_first_invalid_edge(t) === 1 && t !== start_vertex) {
            status[t] = ACTIVE;
            subtree_weight[t] = findVertexWeight(t);
            status[t] = FINISHED;
            if (lighterBlock(subtree_weight[t]) > best_weight
                && G.getEdgeWeight(f.node, e) === mincut) {
              best_in_cycle = false;
              best_n = f.node; best_e = e;
              best_weight = lighterBlock(subtree_weight[t]);
            }
            f.children_weight += subtree_weight[t];
            f.edgeIdx++;
          } else {
            status[t] = ACTIVE;
            stack.push({ node: t, edgeIdx: 0, children_weight: 0, awaiting: -1 });
            f.awaiting = e;
          }
          break;
        case ACTIVE:
        case CYCLE:
          if (parent[f.node] !== t) {
            status[t] = CYCLE;
            outgoing_cycles[t].push(f.node);
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
