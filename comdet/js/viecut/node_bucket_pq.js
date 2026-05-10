/* Bucket-bounded max-priority queue with node-keyed lookup.
 * [UPSTREAM VieCut/lib/data_structure/priority_queues/node_bucket_pq.h]
 *
 * Holds at most num_nodes elements. gain in [-gain_span, +gain_span].
 * deleteMax / increaseKey / decreaseKey / contains all O(1) amortised.
 * Bucket pop is LIFO (back-of-vector).
 *
 * Used at two sites:
 *   - recursive_cactus.js findSTCactus: residual-DT max-key sweep.
 *   - push_relabel.js m_Q: discharge queue keyed by distance label.
 *     Upstream uses maxNodeHeap there; NodeBucketPQ matches at our size
 *     budget (distance bounded by 2*n) and is already loaded.
 *
 * The NOI bstack pq variant ("bstack" config string) maps to this class
 * in cpp but is never triggered by constrained-clustering's call shape
 * (pq config default = "default", which auto-picks fifo_node_bucket_pq
 * for mincut < 10000); see community-detection/viecut/pq_variants.md.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_COUNT = -1;

  function NodeBucketPQ(num_nodes, gain_span) {
    this.m_elements = 0;
    this.m_gain_span = gain_span;
    this.m_max_idx = 0;
    this.m_buckets = [];
    for (let i = 0; i < 2 * gain_span + 1; i++) this.m_buckets.push([]);
    // queue_index[node] = [in-bucket-idx, gain]; in-bucket-idx === -1 means absent.
    this.m_queue_index = new Array(num_nodes);
    for (let i = 0; i < num_nodes; i++) this.m_queue_index[i] = [UNDEFINED_COUNT, 0];
  }
  NodeBucketPQ.prototype.size = function () { return this.m_elements; };
  NodeBucketPQ.prototype.empty = function () { return this.m_elements === 0; };
  NodeBucketPQ.prototype.maxValue = function () { return this.m_max_idx - this.m_gain_span; };
  NodeBucketPQ.prototype.getKey = function (node) { return this.m_queue_index[node][1]; };
  NodeBucketPQ.prototype.contains = function (node) {
    return this.m_queue_index[node][0] !== UNDEFINED_COUNT;
  };
  NodeBucketPQ.prototype.gain = function (node) {
    return this.contains(node) ? this.m_queue_index[node][1] : 0;
  };
  NodeBucketPQ.prototype.insert = function (node, gain) {
    const address = gain + this.m_gain_span;
    if (address > this.m_max_idx) this.m_max_idx = address;
    this.m_buckets[address].push(node);
    this.m_queue_index[node][0] = this.m_buckets[address].length - 1;
    this.m_queue_index[node][1] = gain;
    this.m_elements++;
  };
  NodeBucketPQ.prototype.maxElement = function () {
    const buck = this.m_buckets[this.m_max_idx];
    return buck[buck.length - 1];
  };
  NodeBucketPQ.prototype.deleteMax = function () {
    const buck = this.m_buckets[this.m_max_idx];
    const node = buck[buck.length - 1];
    buck.pop();
    this.m_queue_index[node][0] = UNDEFINED_COUNT;
    if (buck.length === 0) {
      while (this.m_max_idx !== 0) {
        this.m_max_idx--;
        if (this.m_buckets[this.m_max_idx].length > 0) break;
      }
    }
    this.m_elements--;
    return node;
  };
  NodeBucketPQ.prototype.deleteNode = function (node) {
    const in_bucket_idx = this.m_queue_index[node][0];
    const old_gain = this.m_queue_index[node][1];
    const address = old_gain + this.m_gain_span;
    const buck = this.m_buckets[address];
    if (buck.length > 1) {
      const back = buck[buck.length - 1];
      this.m_queue_index[back][0] = in_bucket_idx;
      buck[in_bucket_idx] = back;
      buck.pop();
    } else {
      buck.pop();
      if (address === this.m_max_idx) {
        while (this.m_max_idx !== 0) {
          this.m_max_idx--;
          if (this.m_buckets[this.m_max_idx].length > 0) break;
        }
      }
    }
    this.m_elements--;
    this.m_queue_index[node][0] = UNDEFINED_COUNT;
  };
  NodeBucketPQ.prototype.changeKey = function (node, new_gain) {
    this.deleteNode(node);
    this.insert(node, new_gain);
  };
  NodeBucketPQ.prototype.increaseKey = function (n, g) { this.changeKey(n, g); };
  NodeBucketPQ.prototype.decreaseKey = function (n, g) { this.changeKey(n, g); };

  NS.NodeBucketPQ = NodeBucketPQ;
})();
