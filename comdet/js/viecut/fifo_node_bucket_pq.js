/* Bucket-bounded FIFO max-priority queue with node-keyed lookup.
 *
 * [UPSTREAM VieCut/lib/data_structure/priority_queues/fifo_node_bucket_pq.h]
 *
 * Differences from NodeBucketPQ: bucket pop is FIFO (front-of-deque),
 * not LIFO (back-of-vector). Canonical noi default selects this PQ
 * when configuration::pq == "default" (most code paths).
 *
 * Bucket entries are addressed by global index = m_bucket_offset +
 * deque-local index, so deleteNode can locate an entry without scanning.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  const UNDEFINED_COUNT = -1;

  function FifoNodeBucketPQ(num_nodes, gain_span) {
    this.m_elements = 0;
    this.m_gain_span = gain_span;
    this.m_max_idx = 0;
    const sz = 2 * gain_span + 1;
    this.m_buckets = new Array(sz);
    this.m_bucket_head = new Int32Array(sz);
    this.m_bucket_offset = new Int32Array(sz);
    for (let i = 0; i < sz; i++) this.m_buckets[i] = [];
    // queue_index[node] = [global-idx (offset+local), gain]; -1 = absent.
    this.m_queue_index = new Array(num_nodes);
    for (let i = 0; i < num_nodes; i++) this.m_queue_index[i] = [UNDEFINED_COUNT, 0];
  }
  FifoNodeBucketPQ.prototype.size = function () { return this.m_elements; };
  FifoNodeBucketPQ.prototype.empty = function () { return this.m_elements === 0; };
  FifoNodeBucketPQ.prototype.maxValue = function () { return this.m_max_idx - this.m_gain_span; };
  FifoNodeBucketPQ.prototype.getKey = function (node) { return this.m_queue_index[node][1]; };
  FifoNodeBucketPQ.prototype.contains = function (node) {
    return this.m_queue_index[node][0] !== UNDEFINED_COUNT;
  };
  FifoNodeBucketPQ.prototype.gain = function (node) {
    return this.contains(node) ? this.m_queue_index[node][1] : 0;
  };
  // Bucket model: array + head pointer simulates std::deque. Deque-local
  // index k of an element corresponds to array index head + k. global_idx
  // stored on each node = bucket_offset + deque_local; both head and
  // bucket_offset increment lockstep on every front-pop.
  FifoNodeBucketPQ.prototype.insert = function (node, gain) {
    const address = gain + this.m_gain_span;
    if (address > this.m_max_idx) this.m_max_idx = address;
    const buck = this.m_buckets[address];
    const head = this.m_bucket_head[address];
    const deque_local = buck.length - head;       // pre-push deque len
    buck.push(node);
    this.m_queue_index[node][0] = deque_local + this.m_bucket_offset[address];
    this.m_queue_index[node][1] = gain;
    this.m_elements++;
  };
  FifoNodeBucketPQ.prototype.maxElement = function () {
    const buck = this.m_buckets[this.m_max_idx];
    return buck[this.m_bucket_head[this.m_max_idx]];
  };
  FifoNodeBucketPQ.prototype.deleteMax = function () {
    const buck = this.m_buckets[this.m_max_idx];
    const head = this.m_bucket_head[this.m_max_idx];
    const node = buck[head];
    this.m_bucket_offset[this.m_max_idx]++;
    this.m_bucket_head[this.m_max_idx] = head + 1;
    this.m_queue_index[node][0] = UNDEFINED_COUNT;
    if (this.m_bucket_head[this.m_max_idx] === buck.length) {
      this.m_buckets[this.m_max_idx] = [];
      this.m_bucket_head[this.m_max_idx] = 0;
      while (this.m_max_idx !== 0) {
        this.m_max_idx--;
        const b2 = this.m_buckets[this.m_max_idx];
        if (b2.length - this.m_bucket_head[this.m_max_idx] > 0) break;
      }
    }
    this.m_elements--;
    return node;
  };
  FifoNodeBucketPQ.prototype.deleteNode = function (node) {
    const global_idx = this.m_queue_index[node][0];
    const old_gain = this.m_queue_index[node][1];
    const address = old_gain + this.m_gain_span;
    const buck = this.m_buckets[address];
    const head = this.m_bucket_head[address];
    const deque_local = global_idx - this.m_bucket_offset[address];
    const arr_idx = head + deque_local;
    this.m_bucket_offset[address]++;
    const live = buck.length - head;
    if (live > 1) {
      // Upstream pattern: swap front with target, pop_front. Front node's
      // global_idx becomes (old_offset + 0) but offset incremented to
      // old_offset+1, so its new deque_local = -1. To preserve invariant
      // the queue_index update sets front's first to the deleted node's
      // OLD global_idx, which after offset++ corresponds to deque_local =
      // deque_local - 1. Net effect: front survives, target evicted.
      this.m_queue_index[buck[head]][0] = global_idx;
      const tmp = buck[arr_idx];
      buck[arr_idx] = buck[head];
      buck[head] = tmp;
      this.m_bucket_head[address] = head + 1;
    } else {
      this.m_bucket_head[address] = head + 1;
      if (this.m_bucket_head[address] === buck.length) {
        this.m_buckets[address] = [];
        this.m_bucket_head[address] = 0;
      }
      if (address === this.m_max_idx) {
        while (this.m_max_idx !== 0) {
          this.m_max_idx--;
          const b2 = this.m_buckets[this.m_max_idx];
          if (b2.length - this.m_bucket_head[this.m_max_idx] > 0) break;
        }
      }
    }
    this.m_elements--;
    this.m_queue_index[node][0] = UNDEFINED_COUNT;
  };
  FifoNodeBucketPQ.prototype.changeKey = function (node, new_gain) {
    this.deleteNode(node);
    this.insert(node, new_gain);
  };
  FifoNodeBucketPQ.prototype.increaseKey = function (n, g) { this.changeKey(n, g); };
  FifoNodeBucketPQ.prototype.decreaseKey = function (n, g) { this.changeKey(n, g); };

  NS.FifoNodeBucketPQ = FifoNodeBucketPQ;
})();
