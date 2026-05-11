/* Goldberg-Tarjan push-relabel max-flow.
 *
 * [UPSTREAM VieCut/lib/algorithms/flow/push_relabel.h]
 *
 * limited=false, parallel_flows=false instantiation. FIFO queue
 * (max-heap by distance label) + global relabel (BFS from sink) +
 * gap heuristic.
 *
 * problem_id scopes flow on the underlying mutable_graph so multiple
 * sequential max-flow calls share the same graph without zeroing
 * flows; mutable_graph::getEdgeFlow(n, e, pid) returns 0 for stale pid.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const WORK_OP_RELABEL = 9;
  const GLOBAL_UPDATE_FRQ = 0.51;
  const WORK_NODE_TO_EDGES = 4;

  // [TRACE-PR-*] probes mirror canonical push_relabel.h (sibling fork).
  // Guarded by globalThis.__VIECUT_TRACE__.
  function _trace(line) {
    if (typeof globalThis !== "undefined" && globalThis.__VIECUT_TRACE__) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(line + "\n");
      }
    }
  }

  function PushRelabel() { this.m_current_iteration = 0; }

  PushRelabel.prototype._addEdgeFlow = function (n, e, f) {
    this.m_G.addEdgeFlow(n, e, f, this.m_problemid);
  };
  PushRelabel.prototype._getEdgeFlow = function (n, e) {
    return this.m_G.getEdgeFlow(n, e, this.m_problemid);
  };

  PushRelabel.prototype._init = function (G, sources, source) {
    this.m_current_iteration++;
    const n = G.n();
    if (!this.m_excess || this.m_excess.length < n) {
      this.m_excess = new Array(n).fill(0);
      this.m_distance = new Array(n).fill(0);
      this.m_active = new Array(n).fill(false);
      this.m_count = new Array(2 * n).fill(0);
      this.m_bfstouched = new Array(n).fill(false);
    }
    for (let i = 0; i < n; i++) {
      this.m_excess[i] = 0;
      this.m_distance[i] = 0;
      this.m_active[i] = false;
      this.m_bfstouched[i] = false;
    }
    for (let i = 0; i < this.m_count.length; i++) this.m_count[i] = 0;
    // m_Q is a max-priority queue keyed by distance label. Upstream uses
    // maxNodeHeap; NodeBucketPQ matches at our size budget (distance is
    // bounded by 2*n) and is already loaded.
    this.m_Q = new NS.NodeBucketPQ(n, 2 * n + 1);
    this.m_count[0] = G.number_of_nodes() - 1;
    this.m_count[G.number_of_nodes()] = 1;

    const flow_source = sources[source];
    this.m_distance[flow_source] = G.number_of_nodes();
    for (const s of sources) this.m_active[s] = true;

    const ne = G.get_first_invalid_edge(flow_source);
    for (let e = 0; e < ne; e++) {
      this.m_excess[flow_source] += G.getEdgeWeight(flow_source, e);
      this._push(flow_source, e, G.n());
    }
  };

  PushRelabel.prototype._global_relabeling = function (sources, source, initial) {
    const G = this.m_G;
    const flow_source = sources[source];
    for (let i = 0; i < this.m_bfstouched.length; i++) this.m_bfstouched[i] = false;

    if (!initial) {
      for (let nx = 0; nx < G.number_of_nodes(); nx++) {
        this.m_distance[nx] = Math.max(this.m_distance[nx], G.number_of_nodes());
      }
    }
    const Q = [];
    let qhead = 0;
    for (const sink of sources) {
      if (sink === flow_source) {
        this.m_distance[sink] = G.n();
        continue;
      }
      Q.push(sink);
      this.m_bfstouched[sink] = true;
      this.m_count[this.m_distance[sink]]--;
      this.m_count[0]++;
      this.m_distance[sink] = 0;
    }
    this.m_bfstouched[flow_source] = true;
    while (qhead < Q.length) {
      const node = Q[qhead++];
      const ne = G.get_first_invalid_edge(node);
      for (let e = 0; e < ne; e++) {
        const target = G.getEdgeTarget(node, e);
        if (this.m_bfstouched[target]) continue;
        const rev_e = G.getReverseEdge(node, e);
        const cap = G.getEdgeWeight(target, rev_e);
        const flow = this._getEdgeFlow(target, rev_e);
        if (initial || (cap - flow) > 0) {
          this.m_count[this.m_distance[target]]--;
          this.m_distance[target] = this.m_distance[node] + 1;
          this.m_count[this.m_distance[target]]++;
          Q.push(target);
          this.m_bfstouched[target] = true;
        }
      }
    }
  };

  PushRelabel.prototype._push = function (source, e, sourceDistance) {
    const target = this.m_G.getEdgeTarget(source, e);
    // T16 (push_relabel.h:148): non-strict <=.
    const t16 = sourceDistance <= this.m_distance[target] ? 1 : 0;
    _trace(`[TRACE-PR-PUSH] src:${source} e:${e} tgt:${target} `
           + `sdist:${sourceDistance} dist_tgt:${this.m_distance[target]} `
           + `t16_block:${t16}`);
    if (t16) return;
    const capacity = this.m_G.getEdgeWeight(source, e);
    const flow = this._getEdgeFlow(source, e);
    const amount = Math.min(capacity - flow, this.m_excess[source]);
    _trace(`[TRACE-PR-PUSH] src:${source} tgt:${target} cap:${capacity} `
           + `flow:${flow} excess:${this.m_excess[source]} amount:${amount}`);
    if (amount === 0) return;
    const rev_e = this.m_G.getReverseEdge(source, e);
    this._addEdgeFlow(source, e, amount);
    this._addEdgeFlow(target, rev_e, -amount);
    this.m_excess[source] -= amount;
    this.m_excess[target] += amount;
    // limited=false in our instantiation, so T18 not exercised; emit no-op.
    this._enqueue(target);
  };

  PushRelabel.prototype._enqueue = function (target) {
    if (this.m_active[target]) return;
    if (this.m_excess[target] > 0) {
      this.m_active[target] = true;
      this.m_Q.insert(target, this.m_distance[target]);
    }
  };

  PushRelabel.prototype._popMax = function () {
    return this.m_Q.deleteMax();
  };

  PushRelabel.prototype._discharge = function (node) {
    const nodeDist = this.m_distance[node];
    const ne = this.m_G.get_first_invalid_edge(node);
    for (let e = 0; e < ne; e++) {
      if (this.m_excess[node] === 0) break;
      this._push(node, e, nodeDist);
    }
    if (this.m_excess[node] > 0) {
      // T17 (push_relabel.h:202): m_count[d]==1 && d<n.
      const count_eq_1 = this.m_count[this.m_distance[node]] === 1 ? 1 : 0;
      const dist_lt_n = this.m_distance[node] < this.m_G.number_of_nodes() ? 1 : 0;
      const t17 = (count_eq_1 && dist_lt_n) ? 1 : 0;
      _trace(`[TRACE-PR-DC] node:${node} dist:${this.m_distance[node]} `
             + `count:${this.m_count[this.m_distance[node]]} `
             + `n:${this.m_G.number_of_nodes()} count_eq_1:${count_eq_1} `
             + `dist_lt_n:${dist_lt_n} t17_gap:${t17}`);
      if (t17) {
        this._gap_heuristic(this.m_distance[node]);
      } else {
        this._relabel(node);
      }
    }
  };

  PushRelabel.prototype._gap_heuristic = function (level) {
    const G = this.m_G;
    for (let nx = 0; nx < G.number_of_nodes(); nx++) {
      if (this.m_distance[nx] < level) continue;
      this.m_count[this.m_distance[nx]]--;
      this.m_distance[nx] = Math.max(this.m_distance[nx], G.n());
      this.m_count[this.m_distance[nx]]++;
      this._enqueue(nx);
    }
  };

  PushRelabel.prototype._relabel = function (node) {
    this.m_work += WORK_OP_RELABEL;
    this.m_count[this.m_distance[node]]--;
    this.m_distance[node] = 2 * this.m_G.number_of_nodes();
    const ne = this.m_G.get_first_invalid_edge(node);
    for (let e = 0; e < ne; e++) {
      if (this.m_G.getEdgeWeight(node, e) - this._getEdgeFlow(node, e) > 0) {
        const target = this.m_G.getEdgeTarget(node, e);
        this.m_distance[node] = Math.min(
          this.m_distance[node], this.m_distance[target] + 1);
      }
      this.m_work++;
    }
    this.m_count[this.m_distance[node]]++;
    this._enqueue(node);
  };

  PushRelabel.prototype._computeSourceSet = function (sources, curr_source) {
    const source_set = [];
    const src = sources[curr_source];
    const G = this.m_G;
    for (let nx = 0; nx < G.number_of_nodes(); nx++) this.m_bfstouched[nx] = false;

    const Q = [];
    let qhead = 0;
    for (const tgt of sources) {
      if (tgt === src) continue;
      Q.push(tgt);
      this.m_bfstouched[tgt] = true;
    }
    while (qhead < Q.length) {
      const node = Q[qhead++];
      const ne = G.get_first_invalid_edge(node);
      for (let e = 0; e < ne; e++) {
        const rev_e = G.getReverseEdge(node, e);
        const edge_source = G.getEdgeTarget(node, e);
        const resCap = G.getEdgeWeight(edge_source, rev_e)
          - this._getEdgeFlow(edge_source, rev_e);
        if (resCap > 0 && !this.m_bfstouched[edge_source]) {
          Q.push(edge_source);
          this.m_bfstouched[edge_source] = true;
        }
      }
    }
    const Qsrc = [src];
    let qsrc_head = 0;
    source_set.push(src);
    this.m_bfstouched[src] = true;
    while (qsrc_head < Qsrc.length) {
      const node = Qsrc[qsrc_head++];
      const ne = G.get_first_invalid_edge(node);
      for (let e = 0; e < ne; e++) {
        const n2 = G.getEdgeTarget(node, e);
        if (!this.m_bfstouched[n2]) {
          source_set.push(n2);
          this.m_bfstouched[n2] = true;
          Qsrc.push(n2);
        }
      }
    }
    return source_set;
  };

  PushRelabel.prototype.solve_max_flow_min_cut = function (
    G, sources, curr_source, compute_source_set, limit, problem_id) {
    if (limit === undefined) limit = 0;
    if (problem_id === undefined) {
      problem_id = NS.random_functions.nextInt(0, 0xfffffffe);
    }
    _trace(`[TRACE-PR] solve_entry G_n:${G.n()} curr_source:${curr_source} `
           + `sources_n:${sources.length} limit:${limit} `
           + `problem_id:${problem_id}`);
    this.m_G = G;
    this.m_work = 0;
    this.m_num_relabels = 0;
    this.m_gaps = 0;
    this.m_pushes = 0;
    this.m_global_updates = 1;
    this.m_problemid = problem_id;
    this.m_limit = limit;
    this.m_limitreached = false;

    const src = sources[curr_source];
    this._init(G, sources, curr_source);
    this._global_relabeling(sources, curr_source, true);
    const work_todo = WORK_NODE_TO_EDGES * G.number_of_nodes() + G.number_of_edges();

    let pr_iter = 0;
    while (!this.m_Q.empty()) {
      const v = this._popMax();
      this.m_active[v] = false;
      _trace(`[TRACE-PR] main_pop iter:${pr_iter} v:${v} `
             + `dist:${this.m_distance[v]} excess:${this.m_excess[v]}`);
      this._discharge(v);
      if (this.m_work > GLOBAL_UPDATE_FRQ * work_todo) {
        this._global_relabeling(sources, curr_source, false);
        this.m_work = 0;
        this.m_global_updates = (this.m_global_updates || 1) + 1;
      }
      pr_iter++;
    }

    let total_flow = 0;
    for (const nx of sources) if (nx !== src) total_flow += this.m_excess[nx];

    let source_set = [];
    if (compute_source_set) source_set = this._computeSourceSet(sources, curr_source);

    _trace(`[TRACE-PR] solve_exit total_flow:${total_flow}`);
    return [total_flow, source_set];
  };

  NS.PushRelabel = PushRelabel;
})();
