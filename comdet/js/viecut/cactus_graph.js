/* CactusGraph: minimal mutable_graph subset for cactus-stage consumers.
 *
 * [UPSTREAM VieCut/lib/data_structure/mutable_graph.h]
 * Mirrors the read methods balanced_cut_dfs + most_balanced::findCutFromCactus
 * call: edges_of, getEdgeTarget, getEdgeWeight, get_first_invalid_edge,
 * getReverseEdge, containedVertices, getOriginalNodes, n.
 *
 * Each cactus-node carries a list of original-graph node ids it contains
 * + a node-local edge list of {target, weight, rev}.
 *
 * Construction inputs are JSON-shaped (the same shape kernel_check.py
 * emits): { n, nodes:[{id, contained}], edges:[{u,v,weight}], adj:[[...]] }.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function CactusGraph(json, n_original) {
    this.n_orig = n_original;
    this.contained = json.nodes.map((nd) => nd.contained.slice());
    this.adj = json.adj.map((row) => row.map((e) => ({ ...e })));
    this._n = json.n;
  }
  CactusGraph.prototype.n = function () { return this._n; };
  CactusGraph.prototype.number_of_nodes = function () { return this._n; };
  CactusGraph.prototype.containedVertices = function (node) {
    return this.contained[node];
  };
  CactusGraph.prototype.edges_of = function (node) {
    const len = this.adj[node].length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = i;
    return out;
  };
  CactusGraph.prototype.getEdgeTarget = function (node, e) {
    return this.adj[node][e].target;
  };
  CactusGraph.prototype.getEdgeWeight = function (node, e) {
    return this.adj[node][e].weight;
  };
  CactusGraph.prototype.get_first_invalid_edge = function (node) {
    return this.adj[node].length;
  };
  CactusGraph.prototype.getReverseEdge = function (node, e) {
    return this.adj[node][e].rev;
  };
  CactusGraph.prototype.getOriginalNodes = function () { return this.n_orig; };

  NS.CactusGraph = CactusGraph;
})();
