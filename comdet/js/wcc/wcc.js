/* WCC kernel: well-connectedness post-proc (Park 2025 / Vu-Le 2026).
 *
 * Faithful port of constrained_clustering MincutOnly with a non-zero
 * connectedness criterion (mincut_only.cpp:42-96 + the MinCutWorker
 * branch in mincut_only.h:39-132). Default threshold is log10(n) where
 * n is the *cluster* size, not the graph size; this mirrors the
 * IsWellConnected formula at constrained.h:427-471.
 *
 * Pipeline:
 *   1. RemoveInterClusterEdges + GetConnectedComponents on the input.
 *   2. Push each component (size > 1) onto the to-be-mincut queue.
 *   3. Pop clusters one at a time:
 *      a. ComputeMinCut on the induced subgraph.
 *      b. If cut > threshold(n_cluster) -> well-connected, emit.
 *      c. Else: split into in/out, run GetConnectedComponents on each
 *         side (per mincut_only.h:98-122), push every size>1 component
 *         back onto the queue.
 *   4. Continue until queue is empty.
 *
 * Threshold parser matches constrained.cpp:201-249:
 *   "0"            -> Simple branch (= CC; no recursion).
 *   "<C>log_<x>(n)" e.g. "1log_10(n)"  -> Logarithmic.
 *   "<C>n^<x>"     e.g. "0.2n^0.5"     -> Exponential.
 *   "piecewise"    -> bands at constrained.h:451-462.
 *
 * Output: { events, finalAssign, numClusters }. Each event records one
 * pop from the queue: the cluster pulled, its mincut result, the
 * threshold + verdict, and either the kept-cluster id (if well
 * connected) or the post-split components pushed back. Walker steps
 * over events 1:1.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  // [TRACE-WCC-*] probe gate. Off in browser (window.WCC_DUMP_PROBES
  // undefined) so the production walker emits nothing. Tracer harnesses
  // set globalThis.WCC_DUMP_PROBES = true before importing wcc.js to
  // enable per-pop + per-side admin emissions that mirror the cpp
  // instrumented kernel (tools/viz_check/wcc/instrumented/kernel_check.cpp
  // [TRACE-WCC-POP-CUR/SUB/LOCAL/OUT/IWC/SIDE-IN/SIDE-COMPS/QUEUE-TAIL]
  // and STAGE_CC [TRACE-WCC-CC-EDGES/CC-MEMBER/CC-OUT/IDMAP]). Closes
  // gap 21 (no __HOOK in JS) by giving the production walker a tracer-
  // visible structured emission path while preserving zero overhead off
  // the tracer harness. Bit-exact hex emission via Float64 view so
  // probes diff byte-for-byte vs cpp.
  const _wccProbeBuf = new Float64Array(1);
  const _wccProbeView = new BigUint64Array(_wccProbeBuf.buffer);
  function _wccHex(x) {
    _wccProbeBuf[0] = x;
    return _wccProbeView[0].toString(16).padStart(16, "0");
  }
  function _wccProbesEnabled() {
    return (typeof globalThis !== "undefined")
        && globalThis.WCC_DUMP_PROBES === true;
  }
  // FNV-1a-style hash for integer vectors. Mirrors the cpp tracer's
  // `hash_int_vec` (kernel_check.cpp). Order-sensitive.
  function _wccHashIntVec(v) {
    let h = 0xcbf29ce484222325n;
    const P = 0x100000001b3n;
    for (let i = 0; i < v.length; i++) {
      h ^= BigInt((v[i] | 0) >>> 0);
      h = (h * P) & 0xffffffffffffffffn;
    }
    h ^= BigInt(v.length >>> 0);
    h = (h * P) & 0xffffffffffffffffn;
    return h.toString(16).padStart(16, "0");
  }
  function _wccHashEdgeList(es) {
    let h = 0xcbf29ce484222325n;
    const P = 0x100000001b3n;
    for (let i = 0; i < es.length; i++) {
      h ^= BigInt((es[i][0] | 0) >>> 0);
      h = (h * P) & 0xffffffffffffffffn;
      h ^= BigInt((es[i][1] | 0) >>> 0);
      h = (h * P) & 0xffffffffffffffffn;
    }
    h ^= BigInt((es.length * 17) >>> 0);
    h = (h * P) & 0xffffffffffffffffn;
    return h.toString(16).padStart(16, "0");
  }
  // RNG state fingerprint of VieCut's m_mt at probe time. Mirrors cpp's
  // mt_state_hash() (which FNV-hashes mt19937's operator<< serialization).
  // We hash the Uint32Array directly; result will NOT match cpp byte-for-
  // byte (different serialization format), but DOES match across JS calls
  // and surfaces drift between consecutive pops. The cpp side emits its
  // own serialized form; harness compares delta-pattern (changed/unchanged
  // across pops), not absolute values.
  function _wccRngStateHash() {
    if (!C.VIECUT || !C.VIECUT.random_functions
        || !C.VIECUT.random_functions.getMT) return "unavailable";
    const mt = C.VIECUT.random_functions.getMT();
    if (!mt || !mt.mt) return "unavailable";
    let h = 0xcbf29ce484222325n;
    const P = 0x100000001b3n;
    for (let i = 0; i < mt.mt.length; i++) {
      h ^= BigInt(mt.mt[i] >>> 0);
      h = (h * P) & 0xffffffffffffffffn;
    }
    h ^= BigInt((mt.idx | 0) >>> 0);
    h = (h * P) & 0xffffffffffffffffn;
    return h.toString(16).padStart(16, "0");
  }

  function bfsComponentsLocal(nodeIds, edges) {
    const n = nodeIds.length;
    if (n === 0) return [];
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    edges.forEach(function (e) {
      const u = idx.get(e[0]); const v = idx.get(e[1]);
      if (u == null || v == null || u === v) return;
      adj[u].push(v); adj[v].push(u);
    });
    const seen = new Uint8Array(n);
    const comps = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      seen[s] = 1;
      const queue = [s]; let head = 0;
      const comp = [];
      while (head < queue.length) {
        const u = queue[head++];
        comp.push(nodeIds[u]);
        const neigh = adj[u];
        for (let k = 0; k < neigh.length; k++) {
          const w = neigh[k];
          if (seen[w]) continue;
          seen[w] = 1; queue.push(w);
        }
      }
      // [UPSTREAM constrained.h:393-419 GetConnectedComponents] cpp
      // bucket-fills via `for node_id = 0..vcount-1` and pushes node_id
      // into `component_id_to_member_vector_map[cid]`. Each component's
      // member vector is therefore in NODE-ASC order (per induced-subgraph
      // local id, which is ASC of input vertex selector). VieCut's local
      // id 0 = nodeIds[0] in the adapter, so component vertex order
      // determines RNG-input ordering through the cactus build. Without
      // this sort, JS feeds VieCut in BFS-discovery order while cpp feeds
      // ASC, producing different cactus origin-mapping at chained pops
      // (audit row L for WCC).
      comp.sort(function (a, b) { return a - b; });
      comps.push(comp);
    }
    return comps;
  }

  // Returns { kind, c, x, customString } where kind ∈
  // { "simple", "logarithmic", "exponential", "custom" }.
  function parseCriterion(spec) {
    spec = String(spec || "").trim();
    if (spec === "0") return { kind: "simple" };
    let m = spec.match(/^([0-9.]+)log_([0-9.]+)\(n\)$/);
    if (m) {
      const c = parseFloat(m[1]);
      const x = parseFloat(m[2]);
      // [UPSTREAM constrained.cpp:235] preLog = c / log(x) is precomputed
      // ONCE at startup; per-call threshold uses preLog * log(n) (one log,
      // one mul). The naive `c * log(n) / log(x)` (two logs, one mul, one
      // div) introduces rounding-order divergence vs canonical -- audit row
      // E. JS mirrors canonical's evaluation order via this preLog field.
      return { kind: "logarithmic", c: c, x: x, preLog: c / Math.log(x) };
    }
    m = spec.match(/^([0-9.]+)n\^([0-9.]+)$/);
    if (m) return { kind: "exponential", c: parseFloat(m[1]), x: parseFloat(m[2]) };
    if (spec === "piecewise") return { kind: "custom", customString: "piecewise" };
    return { kind: "custom", customString: spec };
  }

  function threshold(parsed, nCluster) {
    if (parsed.kind === "simple") return 0;
    if (parsed.kind === "logarithmic") {
      return parsed.preLog * Math.log(nCluster);
    }
    if (parsed.kind === "exponential") {
      return parsed.c * Math.pow(nCluster, parsed.x);
    }
    if (parsed.kind === "custom" && parsed.customString === "piecewise") {
      if (nCluster < 100) return 1;
      if (nCluster <= 500) return 2;
      if (nCluster <= 999) return 3;
      return Math.ceil(0.1 * Math.sqrt(nCluster));
    }
    return Infinity;
  }

  function isWellConnected(parsed, nCluster, cut) {
    if (parsed.kind === "simple") return cut >= 1;
    const t = threshold(parsed, nCluster);
    if (parsed.kind === "logarithmic") {
      const isClose = Math.abs(t - cut) <= 1e-9;
      return !isClose && t < cut;
    }
    if (parsed.kind === "exponential") {
      return t < cut;
    }
    if (parsed.kind === "custom" && parsed.customString === "piecewise") {
      return cut >= t;
    }
    return false;
  }

  function runWCC(membership, opts) {
    opts = opts || {};
    const F = opts.fixture || C.FIXTURE;
    const criterion = opts.criterion || "1log_10(n)";
    const parsed = parseCriterion(criterion);
    // Default backend prefers VieCut cactus mincut when available
    // (matches canonical constrained_clustering binary). Falls back to
    // Stoer-Wagner standin when only mincut.js is loaded.
    const mincutFn = opts.mincutFn
      || (C.MINCUT && (C.MINCUT.viecut || C.MINCUT.stoerWagner));
    if (!mincutFn) throw new Error("WCC: no mincut backend (load mincut.js first)");
    const trace = opts.trace ? [] : null;
    function tlog(line) { if (trace) trace.push(line); }
    // Replay-mode: caller supplies an oracle that returns the canonical
    // bipartition for a given cluster's nodeset (keyed by sorted node-id
    // string). When set, the JS kernel skips Stoer-Wagner and reads the
    // bipartition + cut value directly from the oracle. Used by the
    // tools/viz_check/wcc kernel cross-check.
    const cutOracle = opts.cutOracle || null;

    const _probe = _wccProbesEnabled();

    // [TRACE-WCC-FP-PRIM] gap 24 — Exponential (c*pow(n,x)) + piecewise
    // (ceil(0.1*sqrt(n))) primitives swept once at runWCC entry so
    // Math.pow / Math.ceil / Math.sqrt vs std::pow / std::ceil / std::sqrt
    // divergence becomes visible BEFORE the WCC pipeline runs (the
    // current tracer hardcodes Logarithmic but the JS port supports all
    // four branches). Mirrors the cpp side at kernel_check.cpp.
    if (_probe) {
      const probeNs = [10, 50, 100, 250, 500, 1000, 5000, 10000, 50000];
      probeNs.forEach(function (n) {
        const pow05 = Math.pow(n, 0.5);
        const pow2 = Math.pow(n, 2.0);
        const sqrtN = Math.sqrt(n);
        const ceilV = Math.ceil(0.1 * pow05);
        console.error(
          `[TRACE-WCC-FP-PRIM] n=${n} pow_05_bits=0x${_wccHex(pow05)} pow_2_bits=0x${_wccHex(pow2)} sqrt_bits=0x${_wccHex(sqrtN)} ceil_01pow05_bits=0x${_wccHex(ceilV)}`);
      });
    }

    const nodeIdToIdx = new Map();
    F.nodes.forEach(function (id, i) { nodeIdToIdx.set(id, i); });

    // Stage 1: residual-graph CC (matches the binary at mincut_only.cpp:35-40).
    // RemoveInterClusterEdges keeps only intra-cluster edges; we then
    // run BFS over the whole residual graph in node-id order so the
    // initial queue is in the same order as igraph_connected_components.
    const intraEdges = [];
    for (let e = 0; e < F.edges.length; e++) {
      const a = F.edges[e][0], b = F.edges[e][1];
      const ca = membership[nodeIdToIdx.get(a)];
      const cb = membership[nodeIdToIdx.get(b)];
      if (ca === cb) intraEdges.push([a, b]);
    }
    // [TRACE-WCC-CC-EDGES] gap 13 — post-RemoveInterClusterEdges residual
    // adjacency hash. cpp uses igraph EID order; JS uses input CSV order.
    // The hash will only match cpp under matching edge-iteration order;
    // mismatch here points at gap 15 (id-map iteration) divergence.
    if (_probe) {
      console.error(
        `[TRACE-WCC-CC-EDGES] resid_m=${intraEdges.length} resid_hash=0x${_wccHashEdgeList(intraEdges)}`);
    }
    const allComps = bfsComponentsLocal(F.nodes.slice(), intraEdges);
    if (_probe) {
      // [TRACE-WCC-CC-MEMBER] gap 14 — JS uses BFS roots in node-id-ASC;
      // we synthesize a membership vector from allComps + the dropped
      // singletons (size 1 comps). Mirror's cpp's membership emission
      // (which uses igraph's IGRAPH_WEAK).
      const nNodes = F.nodes.length;
      // Build comp-id-per-node by iterating allComps in their stored order.
      // Singletons land last (their nodes aren't in any size>1 comp).
      const cidVec = new Array(nNodes).fill(-1);
      let cid = 0;
      const seen = new Set();
      allComps.forEach(function (c) {
        c.forEach(function (id) {
          cidVec[nodeIdToIdx.get(id)] = cid;
          seen.add(id);
        });
        cid++;
      });
      // Trail singletons (per-node, in F.nodes order).
      const szList = allComps.map(c => c.length);
      F.nodes.forEach(function (id, i) {
        if (!seen.has(id)) {
          cidVec[i] = cid;
          szList.push(1);
          cid++;
        }
      });
      console.error(
        `[TRACE-WCC-CC-MEMBER] n_components=${cid} cid_hash=0x${_wccHashIntVec(cidVec)} sz_hash=0x${_wccHashIntVec(szList)}`);
      // [TRACE-WCC-CC-OUT] gap 14 (continued) — post-csize>1 filter,
      // per-CC size + first-node + hash. cpp emits same shape.
      allComps.forEach(function (c, i) {
        const first = c.length > 0 ? c[0] : -1;
        console.error(
          `[TRACE-WCC-CC-OUT] cc=${i} size=${c.length} first=${first} hash=0x${_wccHashIntVec(c)}`);
      });
    }
    tlog("STAGE_CC residual_edges=" + intraEdges.length + " components=" + allComps.length);
    allComps.forEach(function (c, i) {
      tlog("  comp[" + i + "] size=" + c.length + " nodes=" + c.slice(0, 12).join(",") + (c.length > 12 ? ",..." : ""));
    });

    // Per-input-cluster CC view for the walker UX.
    const buckets = new Map();
    F.nodes.forEach(function (id, i) {
      const c = membership[i];
      let arr = buckets.get(c);
      if (!arr) { arr = []; buckets.set(c, arr); }
      arr.push(id);
    });
    const initEvents = [];
    const cIds = Array.from(buckets.keys()).sort(function (a, b) { return a - b; });
    cIds.forEach(function (cid) {
      const ns = buckets.get(cid);
      const nsSet = new Set(ns);
      const compsForCid = allComps.filter(function (c) { return nsSet.has(c[0]); });
      initEvents.push({ clusterIn: cid, nodes: ns.slice(), components: compsForCid });
    });

    // Stage 2: single shared queue, mirroring the binary's worker
    // (mincut_only.h:39-132 + the round loop in mincut_only.cpp:51-95).
    // Single-threaded interpretation: keep popping from to_be_mincut
    // until empty. Each pop runs Stoer-Wagner; well-connected clusters
    // land on done_being_mincut in pop order; non-well-connected ones
    // get the connected components of each side pushed back in
    // (in-side first, then out-side).
    const queue = allComps.filter(function (c) { return c.length > 1; }).map(function (c) { return c.slice(); });
    tlog("STAGE_QUEUE init_size=" + queue.length);
    if (_probe) {
      console.error(`[TRACE-WCC-ROUND] enter init_queue_size=${queue.length} threads=1`);
    }
    const carveEvents = [];
    const survivors = [];
    let safety = 0;
    let popIdx = 0;
    while (queue.length > 0) {
      if (safety++ > 50000) throw new Error("WCC: queue cap exceeded");
      // [TRACE-WCC-POP-CUR] gap 1, 8 — cluster size source + RNG state +
      // queue head/tail snapshot at entry.
      if (_probe) {
        const cur0 = queue[0];
        const first = cur0.length > 0 ? cur0[0] : -1;
        const last = cur0.length > 0 ? cur0[cur0.length - 1] : -1;
        console.error(
          `[TRACE-WCC-POP-CUR] pop=${popIdx} rng_pre=0x${_wccRngStateHash()} queue_pre=${queue.length} cur_size=${cur0.length} cluster_hash=0x${_wccHashIntVec(cur0)} first=${first} last=${last}`);
      }
      const cur = queue.shift();
      const nSet = new Set(cur);
      const sub = [];
      for (let e = 0; e < intraEdges.length; e++) {
        const a = intraEdges[e][0], b = intraEdges[e][1];
        if (nSet.has(a) && nSet.has(b)) sub.push([a, b]);
      }
      // [TRACE-WCC-POP-SUB] gap 2, 3, 23 — induced subgraph metadata +
      // idmap hash + self-loop/multi-edge assertion. JS builds adjacency
      // on-demand inside bfsComponentsLocal; here we emit the same shape
      // cpp does (sub_n, sub_m, edge-list hash). idmap in cpp is the
      // OUTPUT of igraph_induced_subgraph_map; JS's analog is the
      // `cur` array itself (cur[i] = orig_id at local i since JS doesn't
      // remap). We emit cur.slice() as the idmap.
      if (_probe) {
        let nSelfloops = 0;
        const edgeKeys = new Map();
        let nMulti = 0;
        for (let e = 0; e < sub.length; e++) {
          const a = sub[e][0], b = sub[e][1];
          if (a === b) nSelfloops++;
          const lo = a < b ? a : b, hi = a < b ? b : a;
          const k = lo + "," + hi;
          const c = (edgeKeys.get(k) || 0) + 1;
          edgeKeys.set(k, c);
          if (c === 2) nMulti++;
        }
        console.error(
          `[TRACE-WCC-POP-SUB] pop=${popIdx} sub_n=${cur.length} sub_m=${sub.length} sub_edge_hash=0x${_wccHashEdgeList(sub)} idmap_hash=0x${_wccHashIntVec(cur)} n_selfloops=${nSelfloops} n_multi=${nMulti}`);
      }
      const cutResult = cutOracle
        ? cutOracle(cur, sub)
        : mincutFn(cur.slice(), sub);
      const cutValue = cutResult.cutValue;
      // [TRACE-WCC-POP-LOCAL] gap 4, 12 — in/out partition BEFORE idmap
      // translation. JS mincutFn already returns orig-ids (the JS port
      // doesn't remap to local ids internally; it does idx→id translation
      // inside mincut_adapter.js). We mirror cpp's emission shape using
      // ORIG-IDs on both sides — the harness compares hashes; if cpp and
      // JS partition the cluster identically, the hashes match modulo
      // the local-vs-orig id space.
      if (_probe) {
        // Build local-id arrays by remapping orig-ids through the cur
        // ordering (cur[i] = orig_id at local i).
        const idxOf = new Map();
        cur.forEach((id, i) => idxOf.set(id, i));
        const inLocal = cutResult.inPartition.map(id => idxOf.get(id));
        const outLocal = cutResult.outPartition.map(id => idxOf.get(id));
        console.error(
          `[TRACE-WCC-POP-LOCAL] pop=${popIdx} cut=${cutValue} in_local_size=${inLocal.length} in_local_hash=0x${_wccHashIntVec(inLocal)} out_local_size=${outLocal.length} out_local_hash=0x${_wccHashIntVec(outLocal)}`);
        // gap 8 — RNG state after ComputeMinCut. Drift relative to
        // rng_pre localises this pop's RNG consumption.
        console.error(
          `[TRACE-WCC-POP-OUT] pop=${popIdx} rng_post=0x${_wccRngStateHash()}`);
      }
      // [UPSTREAM constrained.h:430 + constrained.cpp:235] Threshold splits
      // into TWO sub-terms so the row-E (FP composition order) audit is
      // localizable to either operand by the diff harness, not just the
      // final product. preLog cached once in parseCriterion (mirrors
      // pre_computed_log = c / std::log(x); cpp line 235); log_n = log of
      // current cluster size; threshold = preLog * log_n (one mul, two
      // operands; NOT `c * log(n) / log(x)` which would be 3 ops with
      // different rounding accumulation). isWellConnected() recomputes via
      // threshold() for backward compat with non-trace callers; we surface
      // the sub-terms here for the byte-equal harness.
      let preLogForEv = NaN;
      let logNForEv = NaN;
      if (parsed.kind === "logarithmic") {
        preLogForEv = parsed.preLog;
        logNForEv = Math.log(cur.length);
      }
      const t = threshold(parsed, cur.length);
      const wellConn = isWellConnected(parsed, cur.length, cutValue);
      // [TRACE-WCC-IWC] gaps 5, 6, 7 — emit is_close + abs delta bits +
      // log_n bits at the IsWellConnected site. Mirrors cpp tracer
      // IsWellConnectedLog probe. Uses cluster_size = inPartition.length +
      // outPartition.length (canonical's in_size + out_size at
      // constrained.h:430). For single-connected induced subgraph this
      // equals cur.length; for disconnected mincut return it can differ.
      if (_probe && parsed.kind === "logarithmic") {
        const inSize = cutResult.inPartition.length;
        const outSize = cutResult.outPartition.length;
        const nIwc = inSize + outSize;
        const logNIwc = Math.log(nIwc);
        const thrIwc = parsed.preLog * logNIwc;
        const cutDbl = cutValue;  // JS Number already double
        const diff = thrIwc - cutDbl;
        const absdiff = Math.abs(diff);
        const isClose = absdiff <= 1e-9;
        const wc = !isClose && thrIwc < cutDbl;
        console.error(
          `[TRACE-WCC-IWC] pop=${popIdx} in_size=${inSize} out_size=${outSize} n_iwc=${nIwc} log_n_iwc_bits=0x${_wccHex(logNIwc)} cut=${cutValue} cut_dbl_bits=0x${_wccHex(cutDbl)} thr_bits=0x${_wccHex(thrIwc)} diff_bits=0x${_wccHex(diff)} abs_bits=0x${_wccHex(absdiff)} is_close=${isClose ? 1 : 0} wc=${wc ? 1 : 0}`);
      }
      const ev = {
        cluster: cur.slice(),
        clusterSize: cur.length,
        cut: cutValue,
        preLog: preLogForEv,
        logN: logNForEv,
        threshold: t,
        wellConnected: wellConn,
        inPartition: cutResult.inPartition.slice(),
        outPartition: cutResult.outPartition.slice(),
        pushedBack: [],
      };
      tlog("POP " + popIdx + " n=" + cur.length + " cut=" + cutValue
         + " thr=" + t.toFixed(6) + " wc=" + wellConn
         + " in=" + cutResult.inPartition.length + " out=" + cutResult.outPartition.length);
      // [TRACE-WCC] mirror cpp POP probe — adds pre_log_const flag.
      if (_probe) {
        const preLogBits = (parsed.kind === "logarithmic")
          ? _wccHex(parsed.preLog) : "NaN";
        const logNBits = (parsed.kind === "logarithmic")
          ? _wccHex(Math.log(cur.length)) : "NaN";
        console.error(
          `[TRACE-WCC] POP idx=${popIdx} n=${cur.length} cut=${cutValue} pre_log_bits=0x${preLogBits} log_n_bits=0x${logNBits} thr_bits=0x${_wccHex(t)} wc=${wellConn ? "true" : "false"} in=${cutResult.inPartition.length} out=${cutResult.outPartition.length} pre_log_const=1`);
      }
      popIdx += 1;
      if (wellConn) {
        survivors.push(cur.slice());
        tlog("  KEEP nodes=" + cur.slice().sort(function(a,b){return a-b;}).slice(0,12).join(",") + (cur.length > 12 ? ",..." : ""));
      } else {
        // GetConnectedComponentsOnPartition (mincut_only.h:97-122):
        // induced subgraph on each side, BFS, push every size>1
        // component. Order: in-side components before out-side.
        function emitSidePushBack(sideTag, sidePartition) {
          if (sidePartition.length <= 1) return;
          // [TRACE-WCC-SIDE-IN] gap 16 — per-side induced subgraph hash +
          // idmap. JS analog: side_idmap = sidePartition itself (orig-ids
          // in the order they were emitted by VieCut's getNodeInCut).
          // side_edge_hash is over the BFS sub-edges restricted to side.
          if (_probe) {
            const sideSet = new Set(sidePartition);
            const sideEdges = [];
            for (let e = 0; e < sub.length; e++) {
              const a = sub[e][0], b = sub[e][1];
              if (sideSet.has(a) && sideSet.has(b)) sideEdges.push([a, b]);
            }
            console.error(
              `[TRACE-WCC-SIDE-IN] pop=${popIdx - 1} side=${sideTag} side_local_size=${sidePartition.length} side_n=${sidePartition.length} side_m=${sideEdges.length} side_edge_hash=0x${_wccHashEdgeList(sideEdges)} side_idmap_hash=0x${_wccHashIntVec(sidePartition)}`);
          }
          const sideComps = bfsComponentsLocal(sidePartition.slice(), sub);
          // [TRACE-WCC-SIDE-COMPS] gap 17 — raw comp count + sizes
          // BEFORE the size>1 filter. bfsComponentsLocal returns all
          // comps; we filter below in the push step (mirrors cpp).
          if (_probe) {
            const szLine = sideComps.map(c => "sz=" + c.length).join(" ");
            console.error(
              `[TRACE-WCC-SIDE-COMPS] pop=${popIdx - 1} side=${sideTag} n_comps=${sideComps.length} ${szLine}`);
          }
          sideComps.forEach(function (comp) {
            if (comp.length > 1) {
              queue.push(comp);
              ev.pushedBack.push(comp);
              tlog("  PUSH " + sideTag + " size=" + comp.length);
              if (_probe) {
                console.error(
                  `[TRACE-WCC]   PUSH ${sideTag} size=${comp.length} hash=0x${_wccHashIntVec(comp)}`);
              }
            } else {
              tlog("  DROP " + sideTag + " size=" + comp.length);
              if (_probe) {
                console.error(
                  `[TRACE-WCC]   DROP ${sideTag} size=${comp.length}`);
              }
            }
          });
        }
        emitSidePushBack("in", cutResult.inPartition);
        emitSidePushBack("out", cutResult.outPartition);
        // [TRACE-WCC-QUEUE-TAIL] gap 18 — queue tail snapshot after this
        // pop's push-back. Localises divergent push-back order at the
        // very next pop rather than one downstream.
        if (_probe) {
          let tailHash = "0000000000000000";
          let tailFirst = -1, tailLast = -1;
          if (queue.length > 0) {
            const tail = queue[queue.length - 1];
            tailHash = _wccHashIntVec(tail);
            if (tail.length > 0) { tailFirst = tail[0]; tailLast = tail[tail.length - 1]; }
          }
          console.error(
            `[TRACE-WCC-QUEUE-TAIL] pop=${popIdx - 1} queue_post=${queue.length} tail_hash=0x${tailHash} tail_first=${tailFirst} tail_last=${tailLast}`);
        }
      }
      carveEvents.push(ev);
    }
    if (_probe) {
      console.error(`[TRACE-WCC-ROUND] exit total_pops=${popIdx}`);
    }

    // Stage 3: relabel in survivor (= done-queue) order.
    const finalAssign = new Int32Array(F.nodes.length);
    for (let i = 0; i < finalAssign.length; i++) finalAssign[i] = -1;
    survivors.forEach(function (clust, outId) {
      clust.forEach(function (id) { finalAssign[nodeIdToIdx.get(id)] = outId; });
    });

    tlog("STAGE_DONE survivors=" + survivors.length + " total_pops=" + popIdx);
    return {
      criterion: criterion,
      parsed: parsed,
      cc: { events: initEvents, residualEdges: intraEdges, allComps: allComps },
      carve: { events: carveEvents },
      survivors: survivors,
      finalAssign: finalAssign,
      numClusters: survivors.length,
      trace: trace,
    };
  }

  C.WCC = {
    runWCC: runWCC,
    parseCriterion: parseCriterion,
    threshold: threshold,
    isWellConnected: isWellConnected,
    bfsComponents: bfsComponentsLocal,
  };
})();
