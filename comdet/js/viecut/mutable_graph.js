/* mutable_graph: vertex-local adjacency with reverse-edge indices.
 *
 * [UPSTREAM VieCut/lib/data_structure/mutable_graph.h]
 *
 * Each vertex carries a vector of RevEdge {target, weight, reverse_edge,
 * flow, problem_id}. Edge IDs are vertex-local indices. Reverse-edge
 * pointers let contraction rewire adjacency lists without rebuilding.
 *
 * This port covers the read + edge-construction + contraction surface
 * the cactus pipeline exercises. Methods unused by cactus_mincut are
 * elided.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_NODE = 0xffffffff;

  function MutableGraph() {
    this.partition_index = [];
    this.vertices = [];          // vertices[n] = [{target, weight, rev, flow, pid}]
    this.weighted_degree = [];
    this.node_in_cut = [];
    this.current_position = [];
    this.contained_in_this = [];
    this.last_node = 0;
    this.num_edges = 0;
    this.partition_count = 0;
    this.original_nodes = 0;
  }

  MutableGraph.prototype.start_construction = function (n) {
    this.vertices = Array.from({ length: n }, () => []);
    this.weighted_degree = new Array(n).fill(0);
    this.partition_index = new Array(n).fill(0);
    this.node_in_cut = new Array(n).fill(false);
    this.current_position = new Array(n);
    this.original_nodes = n;
    this.contained_in_this = new Array(n);
    for (let i = 0; i < n; i++) {
      this.contained_in_this[i] = [i];
      this.current_position[i] = i;
    }
  };
  MutableGraph.prototype.resizePositions = function (n) {
    if (this.current_position.length < n) {
      while (this.current_position.length < n) this.current_position.push(0);
    }
    this.original_nodes = n;
  };
  MutableGraph.prototype.new_node = function () {
    if (this.last_node === this.vertices.length) {
      this.contained_in_this.push([this.last_node]);
      this.current_position.push(0);
      this.current_position[this.last_node] = this.vertices.length;
      this.vertices.push([]);
      this.partition_index.push(0);
      this.node_in_cut.push(false);
      this.weighted_degree.push(0);
    }
    return this.last_node++;
  };
  MutableGraph.prototype.new_empty_node = function () {
    if (this.last_node === this.vertices.length) {
      this.contained_in_this.push([]);
      this.vertices.push([]);
      this.partition_index.push(0);
      this.node_in_cut.push(false);
      this.weighted_degree.push(0);
    }
    return this.last_node++;
  };
  MutableGraph.prototype.new_edge = function (source, target, wgt) {
    if (wgt === undefined) wgt = 1;
    if (source < target) {
      const tgt_id = this.vertices[target].length;
      const src_id = this.vertices[source].length;
      this.vertices[source].push({ target, weight: wgt, rev: tgt_id,
                                   flow: 0, pid: 0 });
      this.vertices[target].push({ target: source, weight: wgt, rev: src_id,
                                   flow: 0, pid: 0 });
      this.num_edges += 2;
      this.weighted_degree[source] += wgt;
      this.weighted_degree[target] += wgt;
      return src_id;
    }
    return -1;
  };
  MutableGraph.prototype.new_edge_order = function (s, t, w) {
    if (s < t) this.new_edge(s, t, w);
    else if (s > t) this.new_edge(t, s, w);
  };
  MutableGraph.prototype.finish_construction = function () {
    this.last_node = this.vertices.length;
  };
  MutableGraph.prototype.number_of_nodes = function () { return this.vertices.length; };
  MutableGraph.prototype.n = function () { return this.vertices.length; };
  MutableGraph.prototype.number_of_edges = function () { return this.num_edges; };
  MutableGraph.prototype.m = function () { return this.num_edges; };
  MutableGraph.prototype.get_first_edge = function (_n) { return 0; };
  MutableGraph.prototype.get_first_invalid_edge = function (n) {
    return this.vertices[n].length;
  };
  MutableGraph.prototype.getNodeInCut = function (n) { return this.node_in_cut[n]; };
  MutableGraph.prototype.setNodeInCut = function (n, b) { this.node_in_cut[n] = b; };
  MutableGraph.prototype.getPartitionIndex = function (n) { return this.partition_index[n]; };
  MutableGraph.prototype.setPartitionIndex = function (n, p) { this.partition_index[n] = p; };
  MutableGraph.prototype.getUnweightedNodeDegree = function (n) {
    return this.vertices[n].length;
  };
  MutableGraph.prototype.getWeightedNodeDegree = function (n) {
    return this.weighted_degree[n];
  };
  MutableGraph.prototype.getMinDegree = function () {
    let m = Infinity;
    for (const w of this.weighted_degree) if (w < m) m = w;
    return m;
  };
  MutableGraph.prototype.getMaxDegree = function () {
    let m = -Infinity;
    for (const w of this.weighted_degree) if (w > m) m = w;
    return m;
  };
  MutableGraph.prototype.getOriginalNodes = function () { return this.original_nodes; };
  MutableGraph.prototype.setOriginalNodes = function (n) {
    this.original_nodes = n;
    while (this.current_position.length < n) this.current_position.push(0);
  };
  MutableGraph.prototype.sumOfEdgeWeights = function () {
    let s = 0;
    for (const w of this.weighted_degree) s += w;
    return s;
  };
  MutableGraph.prototype.getEdgeWeight = function (n, e) {
    return this.vertices[n][e].weight;
  };
  MutableGraph.prototype.numContainedVertices = function (n) {
    return this.contained_in_this[n].length;
  };
  MutableGraph.prototype.containedVertices = function (n) {
    return this.contained_in_this[n];
  };
  MutableGraph.prototype.setContainedVertices = function (n, v) {
    this.contained_in_this[n] = v.slice();
  };
  MutableGraph.prototype.addContainedVertex = function (n, v) {
    this.contained_in_this[n].push(v);
  };
  MutableGraph.prototype.setEdgeWeight = function (node, edge, weight) {
    const e = this.vertices[node][edge];
    const cur = e.weight;
    const target = e.target;
    const rev = e.rev;
    this.vertices[node][edge].weight = weight;
    this.vertices[target][rev].weight = weight;
    this.weighted_degree[node] += weight - cur;
    this.weighted_degree[target] += weight - cur;
  };
  MutableGraph.prototype.getEdgeTarget = function (n, e) {
    return this.vertices[n][e].target;
  };
  MutableGraph.prototype.getReverseEdge = function (n, e) {
    return this.vertices[n][e].rev;
  };
  MutableGraph.prototype.getCurrentPosition = function (n) {
    return this.current_position[n];
  };
  MutableGraph.prototype.setCurrentPosition = function (n, p) {
    this.current_position[n] = p;
  };
  MutableGraph.prototype.addEdgeFlow = function (n, e, addF, pid) {
    const re = this.vertices[n][e];
    if (re.pid === pid) re.flow += addF;
    else { re.flow = addF; re.pid = pid; }
  };
  MutableGraph.prototype.getEdgeFlow = function (n, e, pid) {
    const re = this.vertices[n][e];
    if (pid !== undefined) {
      if (re.pid === pid) return re.flow;
      re.flow = 0;
      re.pid = pid;
      return 0;
    }
    return re.flow;
  };

  MutableGraph.prototype.isEmpty = function (n) {
    return this.contained_in_this[n].length === 0;
  };

  // [UPSTREAM 368-409] deleteVertex with swap-and-pop reindexing.
  MutableGraph.prototype.deleteVertex = function (node) {
    this.last_node--;
    const back = this.number_of_nodes() - 1;
    if (node < back) {
      for (const v of this.contained_in_this[back]) {
        this.current_position[v] = node;
      }
      for (const v of this.contained_in_this[node]) {
        this.current_position[v] = back;
      }
      this.contained_in_this[node] = this.contained_in_this[back];
    }
    for (let e = 0; e < this.vertices[node].length; e++) {
      const re = this.vertices[node][e];
      this.weighted_degree[re.target] -= re.weight;
      this._internalDeleteEdge(re.target, re.rev);
      this.num_edges -= 2;
    }
    if (node < back) {
      for (let e = 0; e < this.vertices[back].length; e++) {
        const re = this.vertices[back][e];
        this.vertices[re.target][re.rev].target = node;
      }
      this.vertices[node] = this.vertices[back];
      this.weighted_degree[node] = this.weighted_degree[back];
      this.partition_index[node] = this.partition_index[back];
      this.node_in_cut[node] = this.node_in_cut[back];
    }
    this.vertices.pop();
    this.weighted_degree.pop();
    this.partition_index.pop();
    this.node_in_cut.pop();
    this.contained_in_this.pop();
  };

  // [UPSTREAM 516-564] contractEdgeSparseTarget
  MutableGraph.prototype.contractEdgeSparseTarget = function (node, edge) {
    const e = this.vertices[node][edge];
    const target = e.target;
    if (node === target + 1) return this.contractEdge(node, edge);
    this.last_node--;
    const ne_target = this.vertices[target].length;
    for (let ed = 0; ed < ne_target; ed++) {
      if (ed !== e.rev) {
        this.mergeEdgeSparse(node, target, ed);
      }
    }
    for (const n of this.contained_in_this[target]) {
      this.contained_in_this[node].push(n);
      this.current_position[n] = node;
    }
    this.contained_in_this[target] = [];
    const lastIdx = this.vertices.length - 1;
    for (const n of this.contained_in_this[lastIdx]) {
      this.contained_in_this[target].push(n);
      this.current_position[n] = target;
    }
    this._internalDeleteEdge(node, edge);
    this.num_edges -= 2;
    this.weighted_degree[node] -= e.weight;
    this.vertices[target] = this.vertices[lastIdx];
    this.weighted_degree[target] = this.weighted_degree[lastIdx];
    this.partition_index[target] = this.partition_index[lastIdx];
    this.node_in_cut[target] = this.node_in_cut[lastIdx];
    this.vertices.pop();
    this.weighted_degree.pop();
    this.partition_index.pop();
    this.node_in_cut.pop();
    this.contained_in_this.pop();
    // [UPSTREAM mutable_graph.h:516-564 contractEdgeSparseTarget] Same
    // target==lastIdx UB as contractEdge: when the deleted vertex was the
    // back, the remap loop would access out-of-range vertices[target].
    // No vertex moved, so the loop is a no-op; skip it.
    if (target !== lastIdx) {
      for (let ed = 0; ed < this.vertices[target].length; ed++) {
        const re = this.vertices[target][ed];
        this.vertices[re.target][re.rev].target = target;
      }
    }
    return target;
  };

  MutableGraph.prototype.resetContainedvertices = function () {
    this.original_nodes = this.vertices.length;
    for (let n = 0; n < this.vertices.length; n++) {
      this.current_position[n] = n;
      this.contained_in_this[n] = [n];
    }
  };

  MutableGraph.prototype.edges_of = function (node) {
    const len = this.vertices[node].length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = i;
    return out;
  };

  // [UPSTREAM 941-958] internal swap-and-pop deletion that maintains
  // reverse-edge invariants.
  MutableGraph.prototype._internalDeleteEdge = function (n, e) {
    const arr = this.vertices[n];
    if (arr.length > e + 1) {
      arr[e] = arr[arr.length - 1];
      arr.pop();
      const tgt = arr[e].target;
      const rev = arr[e].rev;
      this.vertices[tgt][rev].rev = e;
    } else {
      if (arr.length > 0) arr.pop();
      else throw new Error("delete edge from empty vertex");
    }
  };

  // [UPSTREAM 412-443] deleteEdge
  MutableGraph.prototype.deleteEdge = function (node, edge) {
    const e = this.vertices[node][edge];
    const target = e.target;
    const weight = e.weight;
    const rev = e.rev;
    if (this.get_first_invalid_edge(node) > edge + 1) {
      this.vertices[node][edge] =
        this.vertices[node][this.vertices[node].length - 1];
      this.vertices[node].pop();
      const newTgt = this.vertices[node][edge].target;
      const newRev = this.vertices[node][edge].rev;
      this.vertices[newTgt][newRev].rev = edge;
    } else {
      this.vertices[node].pop();
    }
    if (this.get_first_invalid_edge(target) > rev + 1) {
      this.vertices[target][rev] =
        this.vertices[target][this.vertices[target].length - 1];
      this.vertices[target].pop();
      const newTgt = this.vertices[target][rev].target;
      const newRev = this.vertices[target][rev].rev;
      this.vertices[newTgt][newRev].rev = rev;
    } else {
      this.vertices[target].pop();
    }
    this.weighted_degree[node] -= weight;
    this.weighted_degree[target] -= weight;
    this.num_edges -= 2;
  };

  // [UPSTREAM 445-471] mergeEdgeSparse: merge edge `target -> e_target`
  // into node's adjacency.
  MutableGraph.prototype.mergeEdgeSparse = function (node, target, ed) {
    const e_target = this.getEdgeTarget(target, ed);
    const e_weight = this.getEdgeWeight(target, ed);
    const del_rev = this.getReverseEdge(target, ed);
    let edge_found = false;
    for (let src_edge = 0; src_edge < this.vertices[node].length; src_edge++) {
      if (this.getEdgeTarget(node, src_edge) === e_target) {
        const r = this.getReverseEdge(node, src_edge);
        this.vertices[node][src_edge].weight += e_weight;
        this.vertices[e_target][r].weight += e_weight;
        this.weighted_degree[node] += e_weight;
        this.num_edges -= 2;
        this._internalDeleteEdge(e_target, del_rev);
        edge_found = true;
        break;
      }
    }
    if (!edge_found) {
      const newRev = this.vertices[node].length;
      this.vertices[e_target][del_rev].rev = newRev;
      this.vertices[e_target][del_rev].target = node;
      this.vertices[node].push({ target: e_target, weight: e_weight,
                                 rev: del_rev, flow: 0, pid: 0 });
      this.weighted_degree[node] += e_weight;
    }
  };

  // [UPSTREAM 566-658] contractEdge: collapse (node, edge) into one vtx.
  MutableGraph.prototype.contractEdge = function (node, edge) {
    this.last_node--;
    if (this.getEdgeTarget(node, edge) < node) {
      const re = this.getReverseEdge(node, edge);
      node = this.getEdgeTarget(node, edge);
      edge = re;
    }
    const e = this.vertices[node][edge];
    const target = e.target;
    let del_id = 0;
    let del_wgt = 0;

    const map = new Map();
    for (let ed = 0; ed < this.vertices[node].length; ed++) {
      if (ed !== edge) {
        const del_ed = this.vertices[node][ed];
        map.set(this.getEdgeTarget(node, ed),
                [del_ed.target, del_ed.rev, ed]);
      } else {
        del_wgt = this.vertices[node][ed].weight;
        del_id = ed;
      }
    }
    for (let ed = 0; ed < this.vertices[target].length; ed++) {
      if (ed !== e.rev) {
        const del_edge = this.vertices[target][ed];
        const e_target = this.getEdgeTarget(target, ed);
        if (map.has(e_target)) {
          const [tgt, rev, ed2] = map.get(e_target);
          this.vertices[node][ed2].weight += del_edge.weight;
          this.vertices[tgt][rev].weight += del_edge.weight;
          this.weighted_degree[node] += del_edge.weight;
          this.num_edges -= 2;
          this._internalDeleteEdge(del_edge.target, del_edge.rev);
        } else {
          this.vertices[e_target][del_edge.rev].rev =
            this.vertices[node].length;
          this.vertices[e_target][del_edge.rev].target = node;
          this.vertices[node].push({ target: e_target, weight: del_edge.weight,
                                     rev: del_edge.rev, flow: 0, pid: 0 });
          this.weighted_degree[node] += del_edge.weight;
        }
      }
    }

    for (const v of this.contained_in_this[target]) {
      this.contained_in_this[node].push(v);
      this.current_position[v] = node;
    }
    this.contained_in_this[target] = [];
    const lastIdx = this.vertices.length - 1;
    for (const v of this.contained_in_this[lastIdx]) {
      this.contained_in_this[target].push(v);
      this.current_position[v] = target;
    }
    this.vertices[target] = this.vertices[lastIdx];
    this.weighted_degree[target] = this.weighted_degree[lastIdx];
    this.partition_index[target] = this.partition_index[lastIdx];
    this.node_in_cut[target] = this.node_in_cut[lastIdx];
    this.vertices.pop();
    this.weighted_degree.pop();
    this.partition_index.pop();
    this.node_in_cut.pop();
    this.contained_in_this.pop();

    // [UPSTREAM mutable_graph.h:647-650] cpp iterates edges_of(target) to
    // remap reverse-edge .target pointers from the old back-position to the
    // new target slot. When target == lastIdx (the deleted vertex WAS the
    // back), no swap happened and vertices[target] is past-the-end after
    // pop_back; cpp's loop then dereferences UB memory. JS .pop() makes the
    // slot undefined and crashes. The loop is a no-op in this case (no
    // vertex moved); skip it explicitly.
    if (target !== lastIdx) {
      for (let ed = 0; ed < this.vertices[target].length; ed++) {
        const re = this.vertices[target][ed];
        this.vertices[re.target][re.rev].target = target;
      }
    }

    this._internalDeleteEdge(node, del_id);
    this.num_edges -= 2;
    this.weighted_degree[node] -= del_wgt;
    return target;
  };

  // [UPSTREAM 660-794] contractVertexSet: collapse a set into the smallest-id
  // vertex.
  MutableGraph.prototype.contractVertexSet = function (vertex_set) {
    let first = UNDEFINED_NODE;
    let idx = 0;
    const vec = [];
    for (const i of vertex_set) {
      if (i >= this.vertices.length) continue;
      if (i < first) { first = i; idx = vec.length; }
      vec.push(i);
    }
    if (vec.length <= 1) return;
    vec.splice(idx, 1);

    const edges = [];
    const map = new Map();
    for (let e = 0; e < this.vertices[first].length; e++) {
      const target = this.getEdgeTarget(first, e);
      if (!vertex_set.has(target)) {
        const ed_to_set = this.vertices[first][e];
        edges.push(ed_to_set);
        map.set(target, [ed_to_set.target, ed_to_set.rev, edges.length - 1]);
        this.vertices[ed_to_set.target][ed_to_set.rev].rev = edges.length - 1;
      } else {
        this.weighted_degree[first] -= this.vertices[first][e].weight;
        this.num_edges--;
      }
    }
    this.vertices[first] = edges;

    for (const n of vec) {
      if (n === first) continue;
      for (let e = 0; e < this.vertices[n].length; e++) {
        const target = this.getEdgeTarget(n, e);
        if (!vertex_set.has(target)) {
          const del_edge = this.vertices[n][e];
          if (map.has(target)) {
            const [tgt, rev, ed2] = map.get(target);
            this.vertices[first][ed2].weight += del_edge.weight;
            this.vertices[tgt][rev].weight += del_edge.weight;
            this.weighted_degree[first] += del_edge.weight;
            this.num_edges -= 2;
            if (this.vertices[tgt].length - 1 === rev) {
              map.set(target, [tgt, del_edge.rev, ed2]);
            }
            this._internalDeleteEdge(del_edge.target, del_edge.rev);
          } else {
            this.vertices[target][del_edge.rev].rev =
              this.vertices[first].length;
            this.vertices[target][del_edge.rev].target = first;
            this.vertices[first].push({ target, weight: del_edge.weight,
                                        rev: del_edge.rev, flow: 0, pid: 0 });
            this.weighted_degree[first] += del_edge.weight;
            map.set(target, [target, del_edge.rev,
                             this.vertices[first].length - 1]);
          }
        } else {
          this.num_edges--;
        }
      }
    }

    vec.sort((a, b) => b - a);
    for (const vtx of vec) {
      for (const v of this.contained_in_this[vtx]) {
        this.contained_in_this[first].push(v);
        this.current_position[v] = first;
      }
      this.contained_in_this[vtx] = [];
      if (vtx < this.vertices.length - 1) {
        const lastIdx = this.vertices.length - 1;
        for (const v of this.contained_in_this[lastIdx]) {
          this.contained_in_this[vtx].push(v);
          this.current_position[v] = vtx;
        }
        this.vertices[vtx] = this.vertices[lastIdx];
        this.weighted_degree[vtx] = this.weighted_degree[lastIdx];
        this.partition_index[vtx] = this.partition_index[lastIdx];
        this.node_in_cut[vtx] = this.node_in_cut[lastIdx];
        for (let ed = 0; ed < this.vertices[vtx].length; ed++) {
          const re = this.vertices[vtx][ed];
          this.vertices[re.target][re.rev].target = vtx;
        }
      }
      this.vertices.pop();
      this.weighted_degree.pop();
      this.partition_index.pop();
      this.node_in_cut.pop();
      this.contained_in_this.pop();
      this.last_node--;
    }
  };

  NS.MutableGraph = MutableGraph;
})();
