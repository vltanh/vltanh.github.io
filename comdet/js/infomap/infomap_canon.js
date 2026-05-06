/* Canonical-style Infomap port. Mirrors community-detection/infomap C++:
 *   - InfomapBase::partition outer loop (findTopModulesRepeatedly +
 *     alternating fineTune / coarseTune until no improvement).
 *   - InfomapOptimizer<MapEquation>::optimizeActiveNetwork (Louvain-
 *     style per-vertex sweep with map-equation closed-form ΔL,
 *     strongest-connected-module preference, single-connected-pair
 *     pull, first-loop guard, dirty bit).
 *   - MapEquation::getDeltaCodelengthOnMovingNode (closed-form
 *     plogp(...) algebra; updateCodelengthOnMovingNode for incremental
 *     accumulator updates).
 *
 * Scope: undirected unweighted networks (the comdet 32-node fixture
 * + dnc + matching the Infomap two-level mode used by canonical_run.py).
 * Self-loops not supported (none in the fixtures). Markov time = 1.
 *
 * RNG: LOUVAIN.MT19937 + a libstdc++-style uniform_int_distribution
 * rejection sampler so randInt(min, max) and getRandomizedIndexVector
 * match canonical Infomap (Random.h) byte-for-byte. The canonical
 * Infomap binary built in this repo uses libstdc++; matching that on
 * Pop!_OS x86_64 is the goal. Other libstdc++ versions / libc++ may
 * differ in uniform_int_distribution semantics.
 *
 * The legacy paper-faithful 2008 port (greedy pair-join + greedy tune
 * + heat-bath SA refinement) lives in infomap.js and is preserved as
 * the COMDET.INFOMAP surface for the page walker. This file mounts
 * COMDET.INFOMAP_CANON.
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.LOUVAIN) {
    console.warn("[infomap_canon] COMDET.LOUVAIN missing; load louvain.js first");
    return;
  }
  const C = window.COMDET;
  const LV = C.LOUVAIN;

  // plogp's log2 must match the cpp tracer's bit-equal log2 on the kernel
  // hot path. glibc std::log2 + V8 Math.log2 drift by 1 ulp on roughly 1 in
  // 1e5 inputs (verified at tools/viz_check/infomap/L2_log2/). Route through
  // jsLog2(x) = x===1 ? 0 : Math.log(x) * Math.LOG2E so cpp's matching path
  // (fdlibm __ieee754_log * Math.LOG2E + log2(1)=0 special) hits the same bits.
  function jsLog2(x) {
    if (x === 1.0) return 0.0;
    return Math.log(x) * Math.LOG2E;
  }
  function plogp(p) {
    if (p <= 0) return 0;
    return p * jsLog2(p);
  }

  // ── libstdc++ std::uniform_int_distribution<unsigned int>(lo, hi) ──
  // For std::mt19937 (__urngrange == UINT32_MAX), libstdc++ routes through
  // _S_nd<uint64>(g, range): Lemire's debiased multiplication
  // (uniform_int_dist.h:244-270). Always consumes >= 1 raw mt() call,
  // including when lo == hi (range == 1).
  //   range    = hi - lo + 1
  //   product  = uint64(g()) * uint64(range)
  //   low      = uint32(product)
  //   if low < range:
  //     threshold = 2^32 % range          // == (-range) % range under uint32
  //     while low < threshold: redraw
  //   ret      = uint32(product >> 32)
  //   return lo + ret
  // Verified bit-equal vs libstdc++ at L1 (tools/viz_check/infomap/L1_uniform_int)
  // across 9 seeds × 100k draws.
  function uniformInt(rng, lo, hi) {
    const range = ((hi - lo) >>> 0) + 1;
    const r64 = BigInt(range);
    const t = (1n << 32n) % r64;
    let product = BigInt(rng.raw() >>> 0) * r64;
    let low = product & 0xFFFFFFFFn;
    if (low < r64) {
      while (low < t) {
        product = BigInt(rng.raw() >>> 0) * r64;
        low = product & 0xFFFFFFFFn;
      }
    }
    return lo + Number(product >> 32n);
  }

  // Mirror Random::getRandomizedIndexVector (Random.h):
  //   for i = 0..n-1: order[i] = i
  //   for i = 0..n-1: swap(order[i], order[i + randInt(0, n-i-1)])
  function getRandomizedIndexVector(rng, n) {
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = 0; i < n; i++) {
      const j = i + uniformInt(rng, 0, n - i - 1);
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order;
  }

  // ── Graph ──────────────────────────────────────────────────────────
  // Build a directed adjacency representation that mirrors canonical
  // Infomap's after-FlowCalculator state for an undirected unweighted
  // network with --two-level. For each undirected edge (u, v) (u != v):
  //   - link.flow = 2 / (2m) = 1/m   (FlowCalculator::calcUndirectedFlow
  //     doubles non-self-loop link weights; sumWeightedDegree = 2m)
  //   - node.flow = node.enterFlow = node.exitFlow = deg(v) / (2m)
  //   - InfomapBase::initEnterExitFlow then redistributes flow per
  //     halfFlow in both directions: node.exitFlow = node.enterFlow =
  //     sum_{e adj v} link.flow / 2 = deg(v) / (2m)  (same value, just
  //     re-derived).
  //   - The optimizer iterates BOTH outEdges and inEdges of v (so each
  //     undirected edge contributes deltaExit (when v is source) AND
  //     deltaEnter (when v is target), summed). To match this from a
  //     canonical pypi run we store edges in a single arbitrary
  //     direction (mirroring std::map<source, target> insertion).
  //
  // The caller passes:
  //   nodeIds: array of arbitrary external node ids
  //   edges:   array of [u_id, v_id] pairs (directed-as-stored;
  //            duplicates accumulate)
  function buildGraph(nodeIds, edges) {
    const n = nodeIds.length;
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });

    // Aggregate edge weights by (src, tgt). Canonical's StateNetwork::
    // addLink accumulates duplicate (u, v) link weights.
    const linkMap = new Map();
    edges.forEach(function (e) {
      const u = idx.get(e[0]); const v = idx.get(e[1]);
      if (u == null || v == null || u === v) return;
      const key = u + "|" + v;
      const w = (e.length > 2) ? +e[2] : 1.0;
      if (linkMap.has(key)) {
        linkMap.set(key, linkMap.get(key) + w);
      } else {
        linkMap.set(key, w);
      }
    });

    // Iterate edges in (src, tgt) ASC order so the optimizer's
    // deltaFlow VectorMap insertion order is deterministic; canonical
    // uses std::map keyed by id, sorted ASC.
    const ents = Array.from(linkMap.entries()).map(function (kv) {
      const [s, t] = kv[0].split("|");
      return [+s, +t, kv[1]];
    });
    ents.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    let sumWeightedDegree = 0;
    for (const [, , w] of ents) sumWeightedDegree += 2 * w;

    // FlowCalculator::calcUndirectedFlow:
    //   link.flow = 2 * w / sumWeightedDegree (for non-self-loops)
    //   node.flow = deg(v) / sumWeightedDegree
    const nodeFlow = new Float64Array(n);
    const links = [];
    for (const [u, v, w] of ents) {
      nodeFlow[u] += w / sumWeightedDegree;
      nodeFlow[v] += w / sumWeightedDegree;
      links.push({ u: u, v: v, weight: w,
                   flow: 2.0 * w / sumWeightedDegree });
    }

    const outEdges = new Array(n);
    const inEdges  = new Array(n);
    for (let i = 0; i < n; i++) { outEdges[i] = []; inEdges[i] = []; }
    for (const lk of links) {
      outEdges[lk.u].push(lk);
      inEdges[lk.v].push(lk);
    }

    // InfomapBase::initEnterExitFlow for undirected: node.enter =
    // node.exit = sum of halfFlow over incident edges = nodeFlow on
    // the leaf graph with no self-loops.
    const nodeEnter = new Float64Array(n);
    const nodeExit  = new Float64Array(n);
    for (let v = 0; v < n; v++) {
      nodeEnter[v] = nodeFlow[v];
      nodeExit[v]  = nodeFlow[v];
    }

    // Pre-compute leaf-level nodeFlow_log_nodeFlow constant. cpp's
    // MapEquation::initNetwork sets this once over the leaf graph and
    // holds constant across every super-net level inside
    // findTopModulesRepeatedly. Stored on graph so all makePartition
    // calls (incl. those on collapsedG) read the same value.
    let leafNFLNF = 0;
    for (let v = 0; v < n; v++) leafNFLNF += plogp(nodeFlow[v]);
    return {
      n: n,
      links: links,
      outEdges: outEdges,
      inEdges: inEdges,
      nodeFlow: nodeFlow,
      nodeEnter: nodeEnter,
      nodeExit: nodeExit,
      sumWeightedDegree: sumWeightedDegree,
      exitNetworkFlow: 0,
      leafNodeFlowLogNodeFlow: leafNFLNF,
    };
  }

  // Build a sub-graph that inherits parent leaf flows + edge flows
  // verbatim. Per cpp's generateSubNetwork (InfomapBase.cpp:874): clones
  // parent leaf FlowData (flow, enterFlow, exitFlow) verbatim; does NOT
  // re-run initEnterExitFlow on the sub-network. So sub-leaf.enterFlow
  // = parent_leaf.enterFlow = parent.nodeFlow (for undirected with no
  // self-loops where nodeEnter/nodeExit/nodeFlow all equal parent's
  // 0.5 * Σ_incident link.flow). Crucially this means sub-leaf.enterFlow
  // includes parent's cross-module-edge contributions, NOT just
  // sub-incident edges. Recomputing from sub-edges only gives a smaller
  // value (half it for leaves with all parent edges within the module,
  // less for leaves with cross-module edges) and trips per-visit ΔL
  // tie-breaks differently from cpp.
  // exitNetworkFlow is the parent module's exitFlow — propagates into
  // sub-Infomap MapEquation as the constant exitNetworkFlow term.
  function buildSubGraph(parentG, members, exitNetworkFlow, parentFlow) {
    const n = members.length;
    const inv = new Map();
    members.forEach(function (v, i) { inv.set(v, i); });
    const nodeFlow = new Float64Array(n);
    const nodeEnter = new Float64Array(n);
    const nodeExit = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      nodeFlow[i]  = parentG.nodeFlow[members[i]];
      nodeEnter[i] = parentG.nodeEnter[members[i]];
      nodeExit[i]  = parentG.nodeExit[members[i]];
    }
    const linkObjs = [];
    for (const lk of parentG.links) {
      if (!inv.has(lk.u) || !inv.has(lk.v)) continue;
      linkObjs.push({ u: inv.get(lk.u), v: inv.get(lk.v),
                      weight: lk.weight, flow: lk.flow });
    }
    // Don't sort by (sub.u, sub.v): cpp's generateSubNetwork iterates
    // parent's outEdges in PARENT's encounter order and adds to sub-leaf
    // v's outEdges in that order. Preserving parentG.links iteration
    // order (= parent's (u, v) ASC) matches cpp when members[] are in
    // parent encounter order; sorting by sub's (u, v) only matches when
    // members[] are in sub-monotonic-with-parent order (= v-order).
    const outEdges = new Array(n);
    const inEdges = new Array(n);
    for (let i = 0; i < n; i++) { outEdges[i] = []; inEdges[i] = []; }
    for (const lk of linkObjs) {
      outEdges[lk.u].push(lk);
      inEdges[lk.v].push(lk);
    }
    // Sub-Infomap leafNodeFlowLogNodeFlow = sum over sub-leaves of
    // plogp(parent's nodeFlow). cpp's MapEquation::initNetwork(parent)
    // does the same.
    let leafNFLNF = 0;
    for (let v = 0; v < n; v++) leafNFLNF += plogp(nodeFlow[v]);
    return {
      n: n,
      links: linkObjs,
      outEdges: outEdges,
      inEdges: inEdges,
      nodeFlow: nodeFlow,
      nodeEnter: nodeEnter,
      nodeExit: nodeExit,
      sumWeightedDegree: parentG.sumWeightedDegree,
      exitNetworkFlow: exitNetworkFlow || 0,
      leafNodeFlowLogNodeFlow: leafNFLNF,
      // cpp's parent.data.flow at sub-Infomap entry comes from the running
      // tracker (m_moduleFlowData[m_orig].flow). Caller threads it; otherwise
      // oneLevelCodelength sums g.nodeFlow as a fallback (close, not bit-equal).
      parentFlow: (parentFlow != null) ? +parentFlow : null,
    };
  }

  // ── Module flow data + MapEquation accumulators ───────────────────
  // Mirrors InfomapOptimizer + MapEquation state. opts.nodeFlowLogNodeFlow
  // overrides the per-active-node sum used in the codelength formula;
  // canonical's MapEquation::nodeFlow_log_nodeFlow is the LEAF-level
  // sum_v plogp(p_v), held constant across all aggregation levels in
  // findTopModulesRepeatedly's super-net iterations. Pass the leaf
  // constant when seeding a super-level partition.
  function makePartition(g, opts) {
    opts = opts || {};
    const n = g.n;
    const moduleOf = new Int32Array(n);
    const moduleMembers = new Int32Array(n);
    const moduleFlow      = new Float64Array(n);
    const moduleEnterFlow = new Float64Array(n);
    const moduleExitFlow  = new Float64Array(n);
    const emptyModules = []; // stack of empty module ids for reuse
    // Singleton init: each node is its own module.
    for (let v = 0; v < n; v++) {
      moduleOf[v] = v;
      moduleMembers[v] = 1;
      moduleFlow[v] = g.nodeFlow[v];
      // Per-node enter/exit flow comes from initEnterExitFlow at leaf
      // level (= nodeFlow) or from the previous aggregation level's
      // module accumulators when the graph is a super-network.
      moduleEnterFlow[v] = g.nodeEnter[v];
      moduleExitFlow[v]  = g.nodeExit[v];
    }

    // MapEquation accumulators (calculateCodelengthTerms over modules).
    // cpp's MapEquation::initNetwork pins nodeFlow_log_nodeFlow to the
    // sum of plogp(leaf.flow) over leaves at Infomap-session entry, then
    // holds it constant across every super-net level inside
    // findTopModulesRepeatedly. JS mirrors this via g.leafNodeFlowLogNodeFlow
    // (set by buildGraph + buildSubGraph + propagated by collapseGraph).
    // Without this pin, makePartition recomputes from g.nodeFlow at every
    // super-net level — at supernet g.nodeFlow holds super-vertex flows,
    // not leaves, so the constant becomes wrong + breaks the multi-level
    // restoreConsolidatedOptimizationPointIfNoImprovement check.
    let nodeFlow_log_nodeFlow;
    if (opts.nodeFlowLogNodeFlow != null) {
      nodeFlow_log_nodeFlow = +opts.nodeFlowLogNodeFlow;
    } else if (g.leafNodeFlowLogNodeFlow != null) {
      nodeFlow_log_nodeFlow = +g.leafNodeFlowLogNodeFlow;
    } else {
      nodeFlow_log_nodeFlow = 0;
      for (let v = 0; v < n; v++) nodeFlow_log_nodeFlow += plogp(g.nodeFlow[v]);
    }
    let exitNetworkFlow = opts.exitNetworkFlow != null
      ? +opts.exitNetworkFlow
      : (g.exitNetworkFlow != null ? +g.exitNetworkFlow : 0);
    let exitNetworkFlow_log_exitNetworkFlow = plogp(exitNetworkFlow);

    // cpp MapEquation::calculateCodelengthTerms (MapEquation.h:313-333):
    // enterFlow = 0; loop sums node.data.enterFlow over active network;
    // THEN enterFlow += exitNetworkFlow at the end. Mirror that order
    // exactly: for sub-Infomap (exitNetworkFlow != 0) the final addition
    // ordering changes the bit-result by up to 1 ulp.
    let enterFlow = 0;
    let enter_log_enter = 0;
    let exit_log_exit = 0;
    let flow_log_flow = 0;
    for (let c = 0; c < n; c++) {
      flow_log_flow += plogp(moduleFlow[c] + moduleExitFlow[c]);
      enter_log_enter += plogp(moduleEnterFlow[c]);
      exit_log_exit += plogp(moduleExitFlow[c]);
      enterFlow += moduleEnterFlow[c];
    }
    enterFlow += exitNetworkFlow;
    let enterFlow_log_enterFlow = plogp(enterFlow);
    if (typeof globalThis.__INFOMAP_INIT_DUMP === 'function') {
      const idx = enterFlow_log_enterFlow - enter_log_enter - exitNetworkFlow_log_exitNetworkFlow;
      const mod = -exit_log_exit + flow_log_flow - nodeFlow_log_nodeFlow;
      globalThis.__INFOMAP_INIT_DUMP(n, idx + mod, idx, mod, enter_log_enter, exit_log_exit, flow_log_flow, nodeFlow_log_nodeFlow, exitNetworkFlow, exitNetworkFlow_log_exitNetworkFlow);
    }

    // Codelength = (enterFlow_log_enterFlow - enter_log_enter -
    //               exitNetworkFlow_log_exitNetworkFlow) +
    //              (-exit_log_exit + flow_log_flow - nodeFlow_log_nodeFlow)
    function codelength() {
      return indexCodelength() + moduleCodelength();
    }
    function indexCodelength() {
      return enterFlow_log_enterFlow - enter_log_enter
             - exitNetworkFlow_log_exitNetworkFlow;
    }
    function moduleCodelength() {
      return -exit_log_exit + flow_log_flow - nodeFlow_log_nodeFlow;
    }

    // Closed-form ΔL on moving v into newM (per
    // MapEquation::getDeltaCodelengthOnMovingNode).
    function diffMove(v, oldM, newM, oldDeltaEnter, oldDeltaExit,
                      newDeltaEnter, newDeltaExit) {
      const deltaEEOld = oldDeltaEnter + oldDeltaExit;
      const deltaEENew = newDeltaEnter + newDeltaExit;
      const delta_enter = plogp(enterFlow + deltaEEOld - deltaEENew)
                        - enterFlow_log_enterFlow;
      const efOld = moduleEnterFlow[oldM];
      const efNew = moduleEnterFlow[newM];
      const xfOld = moduleExitFlow[oldM];
      const xfNew = moduleExitFlow[newM];
      const fOld  = moduleFlow[oldM];
      const fNew  = moduleFlow[newM];
      const ven   = g.nodeEnter[v]; // node.data.enterFlow
      const vex   = g.nodeExit[v];  // node.data.exitFlow
      const vfl   = g.nodeFlow[v];  // node.data.flow

      const delta_enter_log_enter
        = -plogp(efOld) - plogp(efNew)
        + plogp(efOld - ven + deltaEEOld)
        + plogp(efNew + ven - deltaEENew);

      const delta_exit_log_exit
        = -plogp(xfOld) - plogp(xfNew)
        + plogp(xfOld - vex + deltaEEOld)
        + plogp(xfNew + vex - deltaEENew);

      const delta_flow_log_flow
        = -plogp(xfOld + fOld)
        - plogp(xfNew + fNew)
        + plogp(xfOld + fOld - vex - vfl + deltaEEOld)
        + plogp(xfNew + fNew + vex + vfl - deltaEENew);

      return delta_enter - delta_enter_log_enter
             - delta_exit_log_exit + delta_flow_log_flow;
    }

    // Apply v -> newM and update accumulators per
    // MapEquation::updateCodelengthOnMovingNode.
    function moveNode(v, newM, oldDeltaEnter, oldDeltaExit,
                      newDeltaEnter, newDeltaExit) {
      const oldM = moduleOf[v];
      if (newM === oldM) return;
      const deltaEEOld = oldDeltaEnter + oldDeltaExit;
      const deltaEENew = newDeltaEnter + newDeltaExit;

      // [DEBUG] capture pre values for move-probe.
      const _probe = (typeof globalThis.__INFOMAP_MOVE_PROBE === 'function');
      const _oMep = _probe ? moduleEnterFlow[oldM] : 0;
      const _oMxp = _probe ? moduleExitFlow[oldM]  : 0;
      const _oMfp = _probe ? moduleFlow[oldM]      : 0;
      const _nMep = _probe ? moduleEnterFlow[newM] : 0;
      const _nMxp = _probe ? moduleExitFlow[newM]  : 0;
      const _nMfp = _probe ? moduleFlow[newM]      : 0;

      enterFlow -= moduleEnterFlow[oldM] + moduleEnterFlow[newM];
      enter_log_enter -= plogp(moduleEnterFlow[oldM]) + plogp(moduleEnterFlow[newM]);
      exit_log_exit -= plogp(moduleExitFlow[oldM]) + plogp(moduleExitFlow[newM]);
      flow_log_flow -= plogp(moduleExitFlow[oldM] + moduleFlow[oldM])
                     + plogp(moduleExitFlow[newM] + moduleFlow[newM]);

      // moduleFlowData[oldM] -= current.data; (FlowData -= subtracts
      // flow + enterFlow + exitFlow component-wise)
      moduleFlow[oldM]      -= g.nodeFlow[v];
      moduleEnterFlow[oldM] -= g.nodeEnter[v];
      moduleExitFlow[oldM]  -= g.nodeExit[v];
      moduleFlow[newM]      += g.nodeFlow[v];
      moduleEnterFlow[newM] += g.nodeEnter[v];
      moduleExitFlow[newM]  += g.nodeExit[v];

      moduleEnterFlow[oldM] += deltaEEOld;
      moduleExitFlow[oldM]  += deltaEEOld;
      moduleEnterFlow[newM] -= deltaEENew;
      moduleExitFlow[newM]  -= deltaEENew;

      enterFlow += moduleEnterFlow[oldM] + moduleEnterFlow[newM];
      enter_log_enter += plogp(moduleEnterFlow[oldM]) + plogp(moduleEnterFlow[newM]);
      exit_log_exit += plogp(moduleExitFlow[oldM]) + plogp(moduleExitFlow[newM]);
      flow_log_flow += plogp(moduleExitFlow[oldM] + moduleFlow[oldM])
                     + plogp(moduleExitFlow[newM] + moduleFlow[newM]);
      enterFlow_log_enterFlow = plogp(enterFlow);

      if (_probe) {
        globalThis.__INFOMAP_MOVE_PROBE(oldM,
          _oMep, _oMxp, _oMfp, _nMep, _nMxp, _nMfp,
          moduleEnterFlow[oldM], moduleExitFlow[oldM], moduleFlow[oldM],
          moduleEnterFlow[newM], moduleExitFlow[newM], moduleFlow[newM],
          deltaEEOld, deltaEENew,
          oldDeltaEnter, oldDeltaExit, newDeltaEnter, newDeltaExit,
          g.nodeEnter[v], g.nodeExit[v], g.nodeFlow[v]);
      }

      moduleMembers[oldM] -= 1;
      moduleMembers[newM] += 1;
      moduleOf[v] = newM;
    }

    return {
      moduleOf: moduleOf,
      moduleMembers: moduleMembers,
      moduleFlow: moduleFlow,
      moduleEnterFlow: moduleEnterFlow,
      moduleExitFlow: moduleExitFlow,
      emptyModules: emptyModules,
      diffMove: diffMove,
      moveNode: moveNode,
      codelength: codelength,
      indexCodelength: indexCodelength,
      moduleCodelength: moduleCodelength,
      enterFlow: function () { return enterFlow; },
      enterLogEnter: function () { return enter_log_enter; },
      exitLogExit: function () { return exit_log_exit; },
      flowLogFlow: function () { return flow_log_flow; },
      nodeFlowLogNodeFlow: function () { return nodeFlow_log_nodeFlow; },
    };
  }

  // ── tryMoveEachNodeIntoBestModule (Louvain-style sweep) ───────────
  // Random-oracle hooks: opts.visitOrder injects canonical's
  // post-randomization visit sequence; opts.linkOrders injects the
  // per-non-skipped-visit module-link permutation. opts.onVisit is
  // called once per iteration of the outer for-loop with
  // (v, moved, newM, L_after) — used by kernel_check.mjs to diff
  // JS's deterministic decision against canonical's.
  function tryMoveEach(P, g, rng, opts) {
    opts = opts || {};
    if (typeof globalThis.__INFOMAP_CALL_BEGIN === 'function') {
      globalThis.__INFOMAP_CALL_BEGIN(g.n);
    }
    const isFirstLoop = !!opts.isFirstLoop;
    const tuneIterationLimit = opts.tuneIterationLimit | 0;
    const minImpr = 1e-16; // minimumSingleNodeCodelengthImprovement (cpp io/Config.h)
    const dirty = opts.dirty;
    const order = opts.visitOrder
      ? opts.visitOrder
      : getRandomizedIndexVector(rng, g.n);
    const linkOrdersOracle = opts.linkOrders || null;
    let linkOrdersIdx = 0;
    const onVisit = opts.onVisit || (typeof globalThis.__INFOMAP_ONVISIT === 'function' ? globalThis.__INFOMAP_ONVISIT : null);
    let nMoved = 0;

    // Reused across nodes: per-iter `clear()` is much cheaper than
    // allocating a fresh Map + Array per visit.
    const insertOrder = [];
    const dfMap = new Map();

    for (let i = 0; i < g.n; i++) {
      const v = order[i];
      if (!dirty[v]) {
        if (onVisit) onVisit(v, false, P.moduleOf[v], P.codelength(), P.indexCodelength(), P.moduleCodelength(), P.enterFlow(), P.enterLogEnter(), P.exitLogExit(), P.flowLogFlow(), P.nodeFlowLogNodeFlow());
        continue;
      }
      if (P.moduleMembers[P.moduleOf[v]] > 1
          && isFirstLoop && tuneIterationLimit !== 1) {
        if (onVisit) onVisit(v, false, P.moduleOf[v], P.codelength(), P.indexCodelength(), P.moduleCodelength(), P.enterFlow(), P.enterLogEnter(), P.exitLogExit(), P.flowLogFlow(), P.nodeFlowLogNodeFlow());
        continue;
      }
      // Build deltaFlow: module -> {deltaExit, deltaEnter}.
      // Insertion order matters (canonical's VectorMap iterates in
      // insertion order before randomized link enumeration).
      insertOrder.length = 0;
      dfMap.clear();
      for (const e of g.outEdges[v]) {
        const mod = P.moduleOf[e.v];
        const r = dfMap.get(mod);
        if (r === undefined) {
          const ne = { module: mod, deltaExit: e.flow, deltaEnter: 0 };
          dfMap.set(mod, ne);
          insertOrder.push(ne);
        } else {
          r.deltaExit += e.flow;
        }
      }
      for (const e of g.inEdges[v]) {
        const mod = P.moduleOf[e.u];
        const r = dfMap.get(mod);
        if (r === undefined) {
          const ne = { module: mod, deltaExit: 0, deltaEnter: e.flow };
          dfMap.set(mod, ne);
          insertOrder.push(ne);
        } else {
          r.deltaEnter += e.flow;
        }
      }
      // For not moving (canonical: deltaFlow.add(current.index, {0,0})).
      const oldM = P.moduleOf[v];
      let oldEntry = dfMap.get(oldM);
      if (oldEntry === undefined) {
        oldEntry = { module: oldM, deltaExit: 0, deltaEnter: 0 };
        dfMap.set(oldM, oldEntry);
        insertOrder.push(oldEntry);
      }
      // Option to move to empty module if not alone.
      if (P.moduleMembers[oldM] > 1 && P.emptyModules.length > 0) {
        const em = P.emptyModules[P.emptyModules.length - 1];
        if (!dfMap.has(em)) {
          const ne = { module: em, deltaExit: 0, deltaEnter: 0 };
          dfMap.set(em, ne);
          insertOrder.push(ne);
        }
      }
      // Randomize link order via canonical's getRandomizedIndexVector
      // unless the caller injected canonical's order via the oracle.
      const numLinks = insertOrder.length;
      const linkOrder = linkOrdersOracle
        ? linkOrdersOracle[linkOrdersIdx++]
        : getRandomizedIndexVector(rng, numLinks);
      if (linkOrdersOracle && linkOrder && linkOrder.length !== numLinks) {
        throw new Error(
          `link-order oracle size mismatch at v=${v}: js insertOrder=${numLinks} oracle=${linkOrder.length}`
        );
      }

      let bestModule = oldM;
      let bestDelta = 0;
      let bestEntry = oldEntry;
      let strongestModule = oldM;
      let strongestExit = oldEntry.deltaExit; // 0 initially
      let strongestDelta = 0;
      let strongestEntry = oldEntry;

      for (let k = 0; k < numLinks; k++) {
        const j = linkOrder[k];
        const entry = insertOrder[j];
        const otherM = entry.module;
        if (otherM === oldM) continue;
        const dL = P.diffMove(v, oldM, otherM,
                              oldEntry.deltaEnter, oldEntry.deltaExit,
                              entry.deltaEnter, entry.deltaExit);
        if (dL < bestDelta - minImpr) {
          bestDelta = dL; bestModule = otherM; bestEntry = entry;
        }
        if (entry.deltaExit > strongestExit) {
          strongestExit = entry.deltaExit;
          strongestModule = otherM;
          strongestDelta = dL;
          strongestEntry = entry;
        }
      }
      // Prefer strongest connected module on tie.
      if (strongestModule !== bestModule
          && strongestDelta <= bestDelta + minImpr) {
        bestModule = strongestModule;
        bestEntry = strongestEntry;
      }
      if (bestModule === oldM) {
        dirty[v] = 0;
        if (onVisit) onVisit(v, false, oldM, P.codelength(), P.indexCodelength(), P.moduleCodelength(), P.enterFlow(), P.enterLogEnter(), P.exitLogExit(), P.flowLogFlow(), P.nodeFlowLogNodeFlow());
        continue;
      }
      // Apply move + maintain emptyModules.
      if (P.moduleMembers[bestModule] === 0) {
        // popped: top of empty stack must equal bestModule.
        P.emptyModules.pop();
      }
      if (P.moduleMembers[oldM] === 1) {
        P.emptyModules.push(oldM);
      }
      if (opts.onMoveDeltas) {
        opts.onMoveDeltas(v, oldM, bestModule,
                          oldEntry.deltaEnter, oldEntry.deltaExit,
                          bestEntry.deltaEnter, bestEntry.deltaExit);
      }
      // Optional deltas oracle: caller can override JS's computed
      // (oldEnter, oldExit, newEnter, newExit) for the moveNode update
      // step. Used by kernel_check.mjs to feed canonical's recorded
      // deltas so accumulator state stays bit-aligned across hundreds
      // of moves; JS's diffMove + best-pick decisions are still
      // independently validated via onVisit.
      let pOldDE = oldEntry.deltaEnter, pOldDX = oldEntry.deltaExit;
      let pNewDE = bestEntry.deltaEnter, pNewDX = bestEntry.deltaExit;
      if (opts.deltasOracle) {
        const o = opts.deltasOracle.next();
        if (o) { pOldDE = o.oDE; pOldDX = o.oDX; pNewDE = o.nDE; pNewDX = o.nDX; }
      }
      P.moveNode(v, bestModule, pOldDE, pOldDX, pNewDE, pNewDX);
      nMoved += 1;

      // Mark neighbours dirty + check single-connected pull-along.
      let nodeInOldModule = -1;
      let numLinkedInOld = 0;
      for (const e of g.outEdges[v]) {
        const u = e.v;
        dirty[u] = 1;
        if (P.moduleOf[u] === oldM) {
          nodeInOldModule = u;
          numLinkedInOld += 1;
        }
      }
      for (const e of g.inEdges[v]) {
        const u = e.u;
        dirty[u] = 1;
        if (P.moduleOf[u] === oldM) {
          nodeInOldModule = u;
          numLinkedInOld += 1;
        }
      }
      // Move single connected node to same module.
      if (numLinkedInOld === 1 && P.moduleMembers[oldM] === 1) {
        if (opts.onPairPull) opts.onPairPull(v, nodeInOldModule, oldM, bestModule);
        const w = nodeInOldModule;
        // Build deltaFlow for w restricted to oldM and bestModule.
        let oDE = 0, oDX = 0, nDE = 0, nDX = 0;
        for (const e of g.outEdges[w]) {
          if (P.moduleOf[e.v] === oldM) oDX += e.flow;
          else if (P.moduleOf[e.v] === bestModule) nDX += e.flow;
        }
        for (const e of g.inEdges[w]) {
          if (P.moduleOf[e.u] === oldM) oDE += e.flow;
          else if (P.moduleOf[e.u] === bestModule) nDE += e.flow;
        }
        if (opts.deltasOracle) {
          const o = opts.deltasOracle.next();
          if (o) { oDE = o.oDE; oDX = o.oDX; nDE = o.nDE; nDX = o.nDX; }
        }
        if (P.moduleMembers[bestModule] === 0) P.emptyModules.pop();
        if (P.moduleMembers[oldM] === 1) P.emptyModules.push(oldM);
        P.moveNode(w, bestModule, oDE, oDX, nDE, nDX);
        nMoved += 1;
        if (g.outEdges[w].length + g.inEdges[w].length > 1) {
          for (const e of g.outEdges[w]) dirty[e.v] = 1;
          for (const e of g.inEdges[w]) dirty[e.u] = 1;
        }
      }
      if (onVisit) onVisit(v, true, bestModule, P.codelength(), P.indexCodelength(), P.moduleCodelength(), P.enterFlow(), P.enterLogEnter(), P.exitLogExit(), P.flowLogFlow(), P.nodeFlowLogNodeFlow());
    }
    return nMoved;
  }

  // optimizeActiveNetwork: loop tryMoveEach until no improvement.
  // opts.boundaryLog: optional fn(label, info) called at each
  // tryMoveEach call boundary. Used by L4_rng_consume_diff to localize
  // RNG-consumption divergence vs cpp tracer.
  function optimizeActiveNetwork(P, g, rng, opts) {
    opts = opts || {};
    const loopLimit = opts.loopLimit != null ? opts.loopLimit : 10;
    const minImpr = 1e-10;
    const dirty = new Int8Array(g.n);
    for (let i = 0; i < g.n; i++) dirty[i] = 1;
    let coreLoopCount = 0;
    let numEffective = 0;
    let oldL = P.codelength();
    const log = opts.boundaryLog || null;
    // canonical's isFirstLoop is `m_tuneIterationIndex == 0 &&
    // isFullNetwork()` (= aggregationLevel == 0 + isMain), NOT
    // coreLoopCount-dependent. caller pins this via opts.isFirstLoop.
    const isFirstLoopFlag = opts.isFirstLoop !== undefined ? !!opts.isFirstLoop : true;
    while (coreLoopCount < loopLimit) {
      coreLoopCount += 1;
      if (log) log("tryMoveEach.begin", { fl: isFirstLoopFlag, n: g.n }, rng);
      const nMoved = tryMoveEach(P, g, rng, {
        isFirstLoop: isFirstLoopFlag,
        tuneIterationLimit: opts.tuneIterationLimit | 0,
        dirty: dirty,
        onVisit: opts.onVisit,
      });
      const newL = P.codelength();
      if (log) log("tryMoveEach.end", { nMoved, newL });
      if (nMoved === 0 || newL >= oldL - minImpr) break;
      numEffective += 1;
      oldL = newL;
    }
    return numEffective;
  }

  // Apply a target leaf->module mapping to a singleton-init Partition,
  // computing per-leaf deltaEnter/deltaExit and committing each move
  // via P.moveNode. After all moves, P.emptyModules is rebuilt from
  // moduleMembers (canonical maintains it incrementally with
  // pop_back/push_back, but the post-hoc rebuild is O(n) total + lets
  // applyMembership share one path instead of three near-duplicates).
  // opts.deltasOracle: optional, popped once per non-identity move
  // to override JS-computed (oDE, oDX, nDE, nDX) with canonical's
  // recorded values. Used by kernel_check.mjs to keep accumulator
  // state bit-aligned with canonical's running tracker through the
  // moveActiveNodesToPredefinedModules path.
  function applyMembership(P, g, target, opts) {
    opts = opts || {};
    const oracle = opts.deltasOracle || null;
    for (let v = 0; v < g.n; v++) {
      const t = target[v];
      const oldM = P.moduleOf[v];
      if (t === oldM) continue;
      let oDE = 0, oDX = 0, nDE = 0, nDX = 0;
      for (const e of g.outEdges[v]) {
        const cu = P.moduleOf[e.v];
        if (cu === oldM) oDX += e.flow;
        else if (cu === t) nDX += e.flow;
      }
      for (const e of g.inEdges[v]) {
        const cu = P.moduleOf[e.u];
        if (cu === oldM) oDE += e.flow;
        else if (cu === t) nDE += e.flow;
      }
      if (oracle) {
        const o = oracle.next();
        if (o) { oDE = o.oDE; oDX = o.oDX; nDE = o.nDE; nDX = o.nDX; }
      }
      P.moveNode(v, t, oDE, oDX, nDE, nDX);
    }
    P.emptyModules.length = 0;
    for (let c = 0; c < g.n; c++) {
      if (P.moduleMembers[c] === 0) P.emptyModules.push(c);
    }
  }

  // ── Multi-level findTopModulesRepeatedly + collapse ────────────────
  // After optimizeActiveNetwork on the leaf network, collapse modules
  // into super-nodes (each super-node = one module) and re-optimize on
  // the super-network. Repeat until <= 1 module or no further progress.
  // Returns the final leaf->top mapping + composed-via-renumber chain.
  // canonical Infomap sets loopLimit=20 (instead of 10) when
  // m_aggregationLevel > 0 OR m_isCoarseTune is true. This function
  // forwards a per-level isCoarseTune flag (opts.isCoarseTune) and
  // bumps loopLimit on iteration 1+.
  function findTopModulesRepeatedly(g, rng, opts) {
    opts = opts || {};
    const minImpr = 1e-16; // minimumSingleNodeCodelengthImprovement (restoreConsolidatedOptimizationPointIfNoImprovement)
    const levels = [];
    const baseLoopLimit = opts.loopLimit != null ? opts.loopLimit : 10;
    const isCoarseTune = !!opts.isCoarseTune;
    const log = opts.boundaryLog || null;
    let currentP = makePartition(g);
    // aggregation_level == 0 path: use base loopLimit unless coarseTune.
    // isFirstLoop = (tuneIterationIndex == 0 && isFullNetwork). caller
    // forwards opts.isFirstLoopOuter; default true for the very first
    // findTopModulesRepeatedly invocation (tuneIterationIndex == 0).
    if (log) log("findTopModulesRepeatedly.level0", { n: g.n });
    const flOuter = opts.isFirstLoopOuter !== undefined ? !!opts.isFirstLoopOuter : true;
    optimizeActiveNetwork(currentP, g, rng, {
      loopLimit: isCoarseTune ? 20 : baseLoopLimit,
      tuneIterationLimit: opts.tuneIterationLimit | 0,
      isFirstLoop: flOuter,
      boundaryLog: log,
    });
    let lastL = currentP.codelength();
    let aggregateMembership = renumberByEncounter(currentP.moduleOf, g.n);
    levels.push({
      membership: new Int32Array(aggregateMembership),
      L: lastL,
      ncomm: maxOf(aggregateMembership) + 1,
    });
    const aggLimit = opts.aggregationLimit != null ? opts.aggregationLimit : 30;
    // D3: at each level transition, supply the previous level's per-cluster
    // enterFlow / exitFlow read off the running tracker. Cpp's consolidate
    // Modules: `new InfoNode(m_moduleFlowData[moduleIndex])` — inherits the
    // tracker. Cross-edge fallback drifts by O(FP) accumulated through
    // moves and trips strongest-connected tie-breaks differently from cpp.
    // srcG = graph to aggregate FROM at next level. Starts at leaf graph;
    // becomes prev-level collapsedG at lvl 2+. Mirrors cpp's
    // consolidateModules iterating the ACTIVE network (= prev-level
    // super-vertices), NOT the leaf graph. JS used to iterate g.links
    // (always leaves) at every level, which produces sums in different
    // order than cpp once lvl >= 2 — drift compounds per level.
    let srcG = g;
    let prevP = currentP;
    // srcGMembership[v] = leaf v's vertex-ID inside srcG at the CURRENT
    // iter's level. Used to index prevP's running tracker (indexed by
    // srcG-scope vertex IDs). At lvl=0 (initial), srcG = leaf graph,
    // srcGMembership[v] = v. After each successful iter, srcGMembership
    // = aggregateMembership BEFORE the renumber-of-next-level (i.e. =
    // current-level cluster IDs).
    let srcGMembership = new Int32Array(g.n);
    for (let v = 0; v < g.n; v++) srcGMembership[v] = v;
    for (let lvl = 1; lvl < aggLimit; lvl++) {
      const ncomm = maxOf(aggregateMembership) + 1;
      if (ncomm <= 1) break;
      // srcToTgt: srcG vertex ID -> tgt-level cluster ID. At lvl 1
      // srcG = leaves and srcToTgt = aggregateMembership. At lvl 2+ srcG
      // = prev collapsedG and srcToTgt = renumberByEncounter applied to
      // prevP.moduleOf.
      const srcToTgt = (lvl === 1)
        ? aggregateMembership
        : renumberByEncounter(prevP.moduleOf, srcG.n);
      const collapsedG = collapseGraph(srcG, srcToTgt, ncomm, prevP);
      const collapsedP = makePartition(collapsedG);
      if (log) log("findTopModulesRepeatedly.lvl", { lvl, n: collapsedG.n });
      const eff = optimizeActiveNetwork(collapsedP, collapsedG, rng, {
        loopLimit: 20,
        tuneIterationLimit: opts.tuneIterationLimit | 0,
        isFirstLoop: false,
        boundaryLog: log,
      });
      const newL = collapsedP.codelength();
      if (newL >= lastL - minImpr) break;
      // Compose leaf->aggregate chain. aggregateMembership[v] is leaf v's
      // current-level cluster (in [0, ncomm)); collapsedP.moduleOf maps
      // current-level cluster -> next-level module. srcToTgt is NOT in
      // this chain — it was the input map (srcG-vertex -> current cluster)
      // used by collapseGraph to AGGREGATE edges; the leaf->cluster chain
      // is independent.
      const nextLeaf = new Int32Array(g.n);
      for (let v = 0; v < g.n; v++) {
        nextLeaf[v] = collapsedP.moduleOf[aggregateMembership[v]];
      }
      // srcGMembership for NEXT iter = leaf v -> srcG-vertex at next iter
      // = leaf v's CURRENT-LEVEL cluster ID = aggregateMembership BEFORE
      // the renumber-of-next-level update. Capture before overwriting.
      const oldAgg = aggregateMembership;
      aggregateMembership = renumberByEncounter(nextLeaf, g.n);
      levels.push({
        membership: new Int32Array(aggregateMembership),
        L: newL,
        ncomm: maxOf(aggregateMembership) + 1,
      });
      lastL = newL;
      srcG = collapsedG;
      prevP = collapsedP;
      srcGMembership = oldAgg;
    }
    // topModuleOrigOf[c] = the prev-level original module ID for
    // renumbered top-module c. Used by coarseTuneFaithful to look up
    // parentModuleExit / parentModuleEnter from prevP's running tracker
    // (= cpp's m_moduleFlowData[m_orig].exitFlow at consolidate).
    let topModuleOrigOf = null;
    if (prevP != null) {
      const ncomm = maxOf(aggregateMembership) + 1;
      topModuleOrigOf = new Int32Array(ncomm);
      const seen = new Int8Array(ncomm);
      for (let v = 0; v < g.n; v++) {
        const c = aggregateMembership[v];
        if (seen[c]) continue;
        topModuleOrigOf[c] = prevP.moduleOf[srcGMembership[v]];
        seen[c] = 1;
      }
    }
    return { membership: aggregateMembership, levels: levels, L: lastL,
             partition: prevP, topModuleOrigOf: topModuleOrigOf };
  }

  // Collapse: build super-graph where each module is a single node.
  // Intra-module link weight is dropped (canonical's optimizer ignores
  // self-loops); inter-module link weight is summed per (cu, cv) pair.
  // Super-node v's flow = sum of leaf flows in module v = π_module.
  // Super-node v's enterFlow = exitFlow = q_module⤸ = sum of
  // inter-module link flows leaving the module — equivalently, the
  // module's accumulated exit flow tracked by P.moduleExitFlow.
  // Pass `prevP` to inherit per-module accumulated flows from the
  // previous level's Partition. If absent, recompute from the leaf
  // graph + membership.
  function collapseGraph(g, membership, ncomm, prevP, prevMembership) {
    // Canonical's InfomapOptimizer::consolidateModules aggregates
    // inter-module edges under the sorted pair (min, max) when
    // isUndirectedClustering() is true. Without the sort, leaf edges
    // with mirrored (cu, cv) vs (cv, cu) on different leaves get split
    // into two super-edges instead of summed; the resulting super-net
    // diverges from canonical's.
    //
    // Edge insertion order into outEdges/inEdges must match cpp's
    // moduleLinks std::map iteration: (m1_orig, m2_orig) ASC where
    // m_orig is the ORIGINAL module ID at the previous level (NOT the
    // renumber-by-encounter ID JS uses internally). Without this sort,
    // tryMoveEach's deltaFlow accumulation hits same edges in different
    // order between cpp + JS, producing 1-ulp drift in deltaEnter /
    // deltaExit (sums of edge.flow over modules in different orders).
    //
    // origOf[c] for renumbered c gives the original module ID. Built
    // from prevP/prevMembership the same way nodeFlow et al. above.
    const origOf = new Int32Array(ncomm);
    {
      const seen = new Int8Array(ncomm);
      for (let v = 0; v < g.n; v++) {
        const c = membership[v];
        if (seen[c]) continue;
        if (prevP != null) {
          const sv = prevMembership != null ? prevMembership[v] : v;
          origOf[c] = prevP.moduleOf[sv];
        } else {
          origOf[c] = c;
        }
        seen[c] = 1;
      }
    }
    // Aggregate edges keyed by (orig_min, orig_max) pair — exactly cpp's
    // moduleLinks std::map<NodePair, double> keyed by ORIGINAL module IDs.
    // The swap below uses ORIGINAL IDs for the min/max comparison: cpp's
    // `if (m1 > m2) std::swap(m1, m2)` operates on m_orig values, NOT on
    // any renumbered position. JS renumbered IDs may not preserve the
    // orig-ID order, so swapping by renumbered would put the source
    // edge on the wrong side (outEdges vs inEdges) of v's adjacency.
    const linkMap = new Map();
    for (const lk of g.links) {
      let cu = membership[lk.u];
      let cv = membership[lk.v];
      if (cu === cv) continue;
      // Swap so cu's ORIGINAL id < cv's. Mirrors cpp's moduleLinks insert
      // with (m1, m2) sorted by orig.
      if (origOf[cu] > origOf[cv]) { const t = cu; cu = cv; cv = t; }
      const key = cu + "|" + cv;
      const w = lk.weight;
      const f = lk.flow;
      if (linkMap.has(key)) {
        const r = linkMap.get(key);
        r.weight += w; r.flow += f;
      } else {
        linkMap.set(key, { u: cu, v: cv, weight: w, flow: f });
      }
    }
    // cpp's InfomapOptimizer::consolidateModules creates
    //   `new InfoNode(m_moduleFlowData[moduleIndex])`
    // which COPIES the entire FlowData struct (flow + enterFlow +
    // exitFlow + teleport... fields) from the running tracker. Mirror
    // this exactly: super-vertex's flow / enter / exit ALL come from
    // prevP's running tracker, not from a fresh leaf-sum. Otherwise
    // FP sum-order between the running tracker (move-order) and the
    // direct leaf sum (v-id order) drifts by up to ~1 ulp per accumulated
    // term, which compounds at every aggregation level.
    const nodeFlow  = new Float64Array(ncomm);
    const nodeEnter = new Float64Array(ncomm);
    const nodeExit  = new Float64Array(ncomm);
    if (prevP != null) {
      // Module accumulators from previous level may use module ids
      // that don't match the renumbered membership (renumberByEncounter
      // remaps to 0..K-1). Walk leaves, find their previous-level
      // module, and copy its accumulator under the renumbered id.
      //   prevMembership == null  -> prevP is leaf-indexed (lvl 1 case;
      //     prevP.moduleOf[v] gives the leaf's prev-level module).
      //   prevMembership != null  -> prevP is super-net-indexed (lvl 2+);
      //     prevMembership[v] gives the super-net vertex id at prevP's
      //     scope, then prevP.moduleOf[sv] gives the prev-level module.
      const seen = new Int8Array(ncomm);
      for (let v = 0; v < g.n; v++) {
        const c = membership[v];
        if (seen[c]) continue;
        const sv = prevMembership != null ? prevMembership[v] : v;
        const oldC = prevP.moduleOf[sv];
        nodeFlow[c]  = prevP.moduleFlow[oldC];
        nodeEnter[c] = prevP.moduleEnterFlow[oldC];
        nodeExit[c]  = prevP.moduleExitFlow[oldC];
        seen[c] = 1;
      }
    } else {
      // No prevP available: fall back to direct leaf sum (only used
      // when collapseGraph is called outside the standard
      // findTopModulesRepeatedly path, e.g. from coarseTuneFaithful's
      // sub-module super-net). cpp's InfomapBase::aggregateFlowValues
      // FromLeafToRoot does this too when the running tracker isn't
      // available.
      for (let v = 0; v < g.n; v++) nodeFlow[membership[v]] += g.nodeFlow[v];
      // First-level fallback: enterFlow = exitFlow = sum of inter-module
      // half-link-flows on each module's leaves. Mirrors canonical
      // InfomapBase::aggregateFlowValuesFromLeafToRoot for the
      // isUndirectedClustering branch.
      for (const lk of g.links) {
        const cu = membership[lk.u];
        const cv = membership[lk.v];
        if (cu === cv) continue;
        // For undirected: half of link.flow exits cu, half enters cu;
        // and the same for cv. canonical InfomapBase::aggregateFlow
        // ValuesFromLeafToRoot for isUndirectedClustering does
        // halfFlow on both source + target.
        const half = lk.flow * 0.5;
        nodeExit[cu]  += half;
        nodeEnter[cu] += half;
        nodeExit[cv]  += half;
        nodeEnter[cv] += half;
      }
    }
    const outEdges = new Array(ncomm);
    const inEdges  = new Array(ncomm);
    for (let i = 0; i < ncomm; i++) { outEdges[i] = []; inEdges[i] = []; }
    const links = Array.from(linkMap.values());
    // Sort by (origOf[u], origOf[v]) ASC to match cpp's moduleLinks
    // std::map iteration order at consolidate-time. Each new outEdge /
    // inEdge is appended in this order; tryMoveEach's deltaFlow
    // accumulation iterates outEdges/inEdges in this order, so cpp + JS
    // accumulate edge.flow contributions to deltaExit / deltaEnter in
    // the SAME order — preventing 1-ulp drift in deltaEnter / deltaExit
    // sums when a module aggregates flow from multiple super-edges.
    links.sort(function (a, b) {
      const ao = origOf[a.u], bo = origOf[b.u];
      if (ao !== bo) return ao - bo;
      return origOf[a.v] - origOf[b.v];
    });
    for (const lk of links) {
      outEdges[lk.u].push(lk);
      inEdges[lk.v].push(lk);
    }
    return {
      n: ncomm,
      links: links,
      outEdges: outEdges,
      inEdges: inEdges,
      nodeFlow: nodeFlow,
      nodeEnter: nodeEnter,
      nodeExit: nodeExit,
      sumWeightedDegree: g.sumWeightedDegree,
      exitNetworkFlow: g.exitNetworkFlow != null ? g.exitNetworkFlow : 0,
      // Inherit leaf-constant from parent graph: cpp's super-net keeps
      // nodeFlow_log_nodeFlow at leaf-level value through every level.
      leafNodeFlowLogNodeFlow: g.leafNodeFlowLogNodeFlow != null
        ? g.leafNodeFlowLogNodeFlow : 0,
    };
  }

  function maxOf(arr) {
    let m = -1;
    for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
  }

  // Renumber so cluster ids appear 0..K-1 in node-iteration order.
  function renumberByEncounter(membership, n) {
    const map = new Map();
    let next = 0;
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = membership[i];
      if (!map.has(c)) map.set(c, next++);
      out[i] = map.get(c);
    }
    return out;
  }

  // findTopModulesRepeatedly starting from a non-singleton leaf
  // membership. Mirrors what canonical does after fineTune: the first
  // iteration of the while-loop sees haveModules() == true and
  // setActiveNetworkFromChildrenOfRoot (super-modules) — equivalent
  // here to collapsing leaves by `seedMembership` then continuing the
  // multi-level Louvain.
  function findTopModulesRepeatedlyFromPartition(g, seedMembership, rng, opts) {
    opts = opts || {};
    const minImpr = 1e-16; // minimumSingleNodeCodelengthImprovement (restoreConsolidatedOptimizationPointIfNoImprovement)
    const log = opts.boundaryLog || null;
    const seedRenum = renumberByEncounter(seedMembership, g.n);
    let aggregateMembership = seedRenum;
    let lastL = (function () {
      const P = makePartition(g);
      applyMembership(P, g, seedRenum);
      return P.codelength();
    })();
    const aggLimit = opts.aggregationLimit != null
      ? opts.aggregationLimit : 30;
    // First level here mirrors canonical's setActiveNetworkFromChildrenOfRoot
    // path (haveModules() == true) — aggregationLevel becomes 0 then > 0
    // as we collapse. isFirstLoop = (tuneIterationIndex == 0 &&
    // isFullNetwork()). Caller passes opts.isFirstLoopOuter for the
    // very first level.
    const flOuter = opts.isFirstLoopOuter !== undefined ? !!opts.isFirstLoopOuter : false;
    // Track leaf -> srcG-vertex chain for topModuleOrigOf computation.
    let srcGMembership = new Int32Array(g.n);
    for (let v = 0; v < g.n; v++) srcGMembership[v] = v;
    // D3: at each collapse, supply previous-level partition's per-cluster
    // running tracker. opts.seedPrevP / opts.seedPrevMembership let the
    // caller (e.g. coarseTuneFaithful Phase 6) seed lvl 0's prevP with
    // a post-coarseTune super-net partition, mirroring cpp's behaviour
    // where the running tracker carries through consolidateModules(true)
    // into the next findTopModulesRepeatedly. Without this seed, lvl 0
    // falls back to direct-sum + half-flow (loses up to ~3 ulp per
    // module enter/exit term).
    let prevP = opts.seedPrevP != null ? opts.seedPrevP : null;
    let prevMembership = opts.seedPrevMembership != null
      ? opts.seedPrevMembership : null;
    for (let lvl = 0; lvl < aggLimit; lvl++) {
      const ncomm = maxOf(aggregateMembership) + 1;
      if (ncomm <= 1) break;
      if (log) log("findTopFromPartition.lvl", { lvl, n: ncomm });
      const collapsedG = collapseGraph(g, aggregateMembership, ncomm,
                                       prevP, prevMembership);
      const collapsedP = makePartition(collapsedG);
      // First lvl here = aggregationLevel 0 from this call's perspective;
      // subsequent lvls > 0. isFirstLoop tracks (tuneIterationIndex==0 &&
      // aggregationLevel==0).
      const isFirstLoopThis = flOuter && lvl === 0;
      const eff = optimizeActiveNetwork(collapsedP, collapsedG, rng, {
        ...opts, boundaryLog: log, isFirstLoop: isFirstLoopThis,
      });
      const newL = collapsedP.codelength();
      // canonical break is purely codelength-based (mirrors
      // restoreConsolidatedOptimizationPointIfNoImprovement). Drop the
      // eff === 0 early break for parity with findTopModulesRepeatedly.
      if (newL >= lastL - minImpr) break;
      // See note in findTopModulesRepeatedly: prevMembership for lvl+1 =
      // pre-update aggregateMembership at this iteration.
      prevMembership = new Int32Array(aggregateMembership);
      prevP = collapsedP;
      const next = new Int32Array(g.n);
      for (let v = 0; v < g.n; v++) {
        next[v] = collapsedP.moduleOf[aggregateMembership[v]];
      }
      const oldAgg = aggregateMembership;
      aggregateMembership = renumberByEncounter(next, g.n);
      lastL = newL;
      srcGMembership = oldAgg;
    }
    let topModuleOrigOf = null;
    if (prevP != null) {
      const ncomm = maxOf(aggregateMembership) + 1;
      topModuleOrigOf = new Int32Array(ncomm);
      const seen = new Int8Array(ncomm);
      for (let v = 0; v < g.n; v++) {
        const c = aggregateMembership[v];
        if (seen[c]) continue;
        topModuleOrigOf[c] = prevP.moduleOf[srcGMembership[v]];
        seen[c] = 1;
      }
    }
    return { membership: aggregateMembership, L: lastL, partition: prevP,
             topModuleOrigOf: topModuleOrigOf };
  }

  // ── fineTune ──────────────────────────────────────────────────────
  // Project leaves through current top-modules (as their initial
  // partition) and re-optimize on the leaf graph. Mirrors canonical's
  // fineTune: setActiveFromLeafs + initPartition (singleton) +
  // moveActiveNodesToPredefinedModules(modules) + optimizeActiveNetwork.
  // Returns the new membership + L.
  function fineTune(g, leafToTop, rng, opts) {
    opts = opts || {};
    const P = makePartition(g);
    applyMembership(P, g, leafToTop);
    optimizeActiveNetwork(P, g, rng, opts);
    const newMembership = renumberByEncounter(P.moduleOf, g.n);
    return { membership: newMembership, L: P.codelength(), partition: P };
  }

  // ── coarseTune ────────────────────────────────────────────────────
  // For each top-module, run a fresh two-level Infomap on its induced
  // subgraph to find sub-modules; then collapse leaves by sub-module
  // and continue the multi-level Louvain on this finer starting
  // point. Mirrors canonical's coarseTune at a coarse level (skipping
  // the explicit consolidate-then-move-back-to-old-modules dance: we
  // just run optimizeActiveNetwork on the collapsed sub-module super-
  // graph, which finds the same regrouping into top-modules).
  function coarseTune(g, leafToTop, rng, opts) {
    opts = opts || {};
    const ncomm = maxOf(leafToTop) + 1;
    // Group leaves by top-module + induce sub-Infomap per top-module.
    const groups = new Array(ncomm);
    for (let i = 0; i < ncomm; i++) groups[i] = [];
    for (let v = 0; v < g.n; v++) groups[leafToTop[v]].push(v);

    // Sub-module assignment per leaf, with offset accumulator so the
    // sub-module ids across top-modules are disjoint.
    const subOf = new Int32Array(g.n);
    let offset = 0;
    for (let c = 0; c < ncomm; c++) {
      const members = groups[c];
      if (members.length < 2) {
        for (const v of members) subOf[v] = offset;
        offset += 1;
        continue;
      }
      // Build sub-graph: relabel members to 0..k-1, collect edges.
      const remap = new Map();
      members.forEach(function (v, i) { remap.set(v, i); });
      const subEdges = [];
      for (const lk of g.links) {
        if (remap.has(lk.u) && remap.has(lk.v)) {
          subEdges.push([remap.get(lk.u), remap.get(lk.v)]);
        }
      }
      const subIds = Array.from({ length: members.length }, (_, i) => i);
      const subRes = runInfomapCanonical(subIds, subEdges, {
        seed: opts.seed != null ? opts.seed : 1,
        aggregationLimit: 30,
        tuneIterationLimitOuter: 0,
      });
      // Project sub-Infomap's membership back onto leaves with offset.
      let maxSub = 0;
      for (let i = 0; i < members.length; i++) {
        const s = subRes.finalPartition[i];
        if (s > maxSub) maxSub = s;
        subOf[members[i]] = offset + s;
      }
      offset += maxSub + 1;
    }
    // Re-run findTopModulesRepeatedlyFromPartition seeded with sub-
    // module membership. This discovers the regrouping of sub-modules
    // into top-modules at a finer resolution than the original
    // multi-level pass.
    return findTopModulesRepeatedlyFromPartition(g, subOf, rng, opts);
  }

  // ── Faithful outer driver: mirrors InfomapBase::partition ───────────
  // Closer mirror of community-detection/infomap/src/core/InfomapBase.cpp
  // partition() at line 1043-1137. Key semantics relative to the original
  // runInfomapCanonical:
  //   - Compound improvement gate: (newL <= oldL - 1e-10) && (newL <
  //     oldL - initialL * 1e-5).
  //   - coarseTune sub-Infomap runs with twoLevel=true + tuneIterationLimit=1.
  //   - optimizeActiveNetwork loopLimit becomes 20 when m_aggregationLevel>0
  //     OR m_isCoarseTune is true (coarseTune sub-Infomap path).
  //   - fineTune calls restore-on-no-improvement when
  //     numEffectiveLoops == 0 (preserves the prior consolidated state).
  //   - One-module bail-out if the partition's codelength exceeds the
  //     one-level codelength (everything in one module).
  function oneLevelCodelength(g) {
    // Mirrors cpp MapEquation<>::calcCodelengthOnModuleOfLeafNodes(m_root)
    // (MapEquation.h:263). cpp's m_oneLevelCodelength = calcCodelength(m_root)
    // is computed at init() when m_root has each leaf as a direct child;
    // calcCodelength dispatches to calcCodelengthOnModuleOfLeafNodes since
    // m_root.isLeafModule(). Closed-form for "m_root is the only module
    // containing all leaves":
    //   T = parent.flow + parent.exitFlow
    //   indexLength = -SUM(plogp(leaf.flow / T)) - plogp(parentExit / T)
    //   L = T * indexLength
    // For top-level: parent.flow = 1, parent.exitFlow = 0 -> L collapses
    // to -SUM(plogp(leaf.flow)). For sub-Infomap: parent's flow + exit are
    // inherited from the parent module's running tracker (g.parentFlow /
    // g.exitNetworkFlow respectively); without these JS's all-in-one path
    // double-counts q via `enterFlow += exitNetworkFlow` and over-shoots
    // the baseline by ~q*log(q), flipping the bail-out gate vs cpp.
    let parentFlow;
    if (g.parentFlow != null) {
      parentFlow = +g.parentFlow;
    } else {
      parentFlow = 0;
      for (let v = 0; v < g.n; v++) parentFlow += g.nodeFlow[v];
    }
    const parentExit = g.exitNetworkFlow != null ? +g.exitNetworkFlow : 0;
    const T = parentFlow + parentExit;
    if (T < 1e-16) return 0.0;
    let indexLength = 0;
    for (let v = 0; v < g.n; v++) {
      indexLength -= plogp(g.nodeFlow[v] / T);
    }
    indexLength -= plogp(parentExit / T);
    return T * indexLength;
  }

  function fineTuneFaithful(g, leafToTop, rng, opts) {
    opts = opts || {};
    const log = opts.boundaryLog || null;
    if (log) log("fineTune.begin", { n: g.n });
    const P = makePartition(g);
    applyMembership(P, g, leafToTop);
    const beforeL = P.codelength();
    const numEff = optimizeActiveNetwork(P, g, rng, opts);
    if (numEff === 0) {
      // Restore-on-no-improvement: re-apply leafToTop to clear any
      // exploratory partial moves. canonical sets the optimizer state
      // back to the pre-sweep consolidated point.
      const P2 = makePartition(g);
      applyMembership(P2, g, leafToTop);
      return { membership: renumberByEncounter(P2.moduleOf, g.n),
               L: P2.codelength(), numEffectiveLoops: 0, partition: P2 };
    }
    return { membership: renumberByEncounter(P.moduleOf, g.n),
             L: P.codelength(), numEffectiveLoops: numEff, partition: P };
  }

  function coarseTuneFaithful(g, leafToTop, rng, opts) {
    opts = opts || {};
    const log = opts.boundaryLog || null;
    const ncomm = maxOf(leafToTop) + 1;
    const groups = new Array(ncomm);
    for (let i = 0; i < ncomm; i++) groups[i] = [];
    // Cpp's coarseTune iterates `for (auto& node : m_root)` then
    // generateSubNetwork iterates `for (auto& node : parent)`. Parent's
    // children() order = order leaves were added during the prior multi-
    // level findTop's consolidate chain (= tree-traversal order, NOT
    // v-order). To match cpp's per-leaf active-id mapping at sub-Infomap
    // entry, opts.leafOrderOracle (when supplied) provides cpp's leaf
    // order per top-module: array indexed by c whose entry is the v-list
    // cpp would iterate. Falls back to v-order.
    const leafOracle = opts.leafOrderOracle || null;
    if (leafOracle) {
      for (let c = 0; c < ncomm; c++) {
        const oracleC = leafOracle[c] != null ? leafOracle[c] : leafOracle[String(c)];
        if (oracleC) {
          for (const v of oracleC) groups[c].push(v);
        } else {
          for (let v = 0; v < g.n; v++) {
            if (leafToTop[v] === c) groups[c].push(v);
          }
        }
      }
      if (typeof globalThis.__INFOMAP_ORACLE_APPLIED === "function") {
        globalThis.__INFOMAP_ORACLE_APPLIED(groups);
      }
    } else {
      for (let v = 0; v < g.n; v++) groups[leafToTop[v]].push(v);
    }

    // Per-top-module exitFlow = parent's exitNetworkFlow for sub-Infomap.
    // cpp's parent.data.exitFlow at sub-Infomap entry comes from the
    // RUNNING TRACKER m_moduleFlowData[m_orig].exitFlow snapshotted at
    // consolidate (NOT a fresh recompute from cross-edges). Per-move
    // updates accumulate FP rounding that diverges from a fresh sum
    // by O(1 ulp), and that drift propagates into every plogp call inside
    // the sub-Infomap.
    //
    // opts.parentPartition + opts.parentTopModuleOrigOf provide the
    // running tracker. parentPartition.moduleExitFlow[parentTopModule
    // OrigOf[c]] = cpp's m_moduleFlowData snapshot for top-module c.
    // Fall back to the fresh-recompute path only when the running
    // tracker is unavailable (e.g., direct external call).
    const parentModuleExit = new Float64Array(ncomm);
    const parentModuleFlow = new Float64Array(ncomm);
    let haveParentFlow = false;
    if (opts.parentPartition != null && opts.parentTopModuleOrigOf != null) {
      const pP = opts.parentPartition;
      const pOrig = opts.parentTopModuleOrigOf;
      for (let c = 0; c < ncomm; c++) {
        parentModuleExit[c] = pP.moduleExitFlow[pOrig[c]];
        parentModuleFlow[c] = pP.moduleFlow[pOrig[c]];
      }
      haveParentFlow = true;
    } else {
      for (const lk of g.links) {
        const cu = leafToTop[lk.u];
        const cv = leafToTop[lk.v];
        if (cu === cv) continue;
        const half = lk.flow * 0.5;
        parentModuleExit[cu] += half;
        parentModuleExit[cv] += half;
      }
    }

    // Phase 1: per top-module sub-Infomap. Mirrors canonical's
    // InfomapBase::coarseTune lines 1442-1466 (subInfomap.setTwoLevel(true).
    // setTuneIterationLimit(1)).
    const subOf = new Int32Array(g.n);
    let offset = 0;
    // [TRACE-IM coarseTune sub probe] only emit when this is the main
    // coarseTune (opts.isMain not explicitly false). Sub-Infomap with
    // setTwoLevel(true) shouldn't recurse into coarseTune anyway.
    const csProbe = (opts.isCoarseTuneMain !== false)
                    && (typeof globalThis.__INFOMAP_COARSETUNE_SUB === "function")
                    ? globalThis.__INFOMAP_COARSETUNE_SUB : null;
    for (let c = 0; c < ncomm; c++) {
      const members = groups[c];
      if (members.length < 2) {
        for (const v of members) subOf[v] = offset;
        offset += 1;
        if (csProbe) csProbe(c, members.length, members.length, 1, offset, true);
        continue;
      }
      // D2: build sub-graph that inherits parent leaf nodeFlow + edge
      // flows verbatim (cpp's generateSubNetwork clones leaf FlowData;
      // re-runs initEnterExitFlow on the sub-network). Without this the
      // sub-Infomap re-normalises flows so they sum to 1 within the sub
      // and ΔL magnitudes / decisions diverge from cpp.
      const exitNetworkFlow = parentModuleExit != null
        ? parentModuleExit[c] : 0;
      const subParentFlow = haveParentFlow ? parentModuleFlow[c] : null;
      const subG = buildSubGraph(g, members, exitNetworkFlow, subParentFlow);
      const subIds = Array.from({ length: members.length }, (_, i) => i);
      // canonical's getSubInfomap creates a fresh InfomapBase whose
      // InfomapConfig ctor re-seeds m_rand from the same
      // seedToRandomNumberGenerator (Config.seedToRandomNumberGenerator,
      // = the original CLI --seed). Each sub-Infomap thus starts with
      // the same RNG state as the top-level run. Pass a FRESH MT19937
      // here, NOT the parent rng. (D1 fix.)
      const subSeed = opts.seed != null ? opts.seed : 1;
      const subRes = runInfomapFaithful(subIds, [], {
        seed: subSeed,
        rng: LV.MT19937(subSeed >>> 0), // fresh per sub-Infomap (cpp parity)
        presetGraph: subG,              // D2: inherit parent flows
        twoLevel: true,
        tuneIterationLimit: 1,
        aggregationLimit: 30,
        isMain: false,                  // sub-Infomap analog of cpp's
                                        // setIsMain(false); affects
                                        // isFirstLoop() inside.
        boundaryLog: log,
      });
      let maxSub = 0;
      for (let i = 0; i < members.length; i++) {
        const s = subRes.finalPartition[i];
        if (s > maxSub) maxSub = s;
        subOf[members[i]] = offset + s;
      }
      const kSub = maxSub + 1;
      offset += kSub;
      if (csProbe) csProbe(c, members.length, members.length, kSub, offset, false);
    }

    // Phase 2: project leaves to sub-modules (canonical lines 1472-1480
    // moveActiveNodesToPredefinedModules(subModules)). Deterministic; no
    // RNG.
    const PsubLeaf = makePartition(g);
    applyMembership(PsubLeaf, g, subOf);

    // Phase 3: collapse leaves -> sub-modules super-net (canonical's
    // consolidateModules(true)). Build a super-graph where each sub-
    // module is a node. Then move sub-modules to former top-modules
    // (canonical lines 1490-1500: moveActiveNodesToPredefinedModules(
    // modules)). Deterministic; no RNG.
    const subRenum = renumberByEncounter(subOf, g.n);
    const numSub = maxOf(subRenum) + 1;
    const subToTop = new Int32Array(numSub);
    {
      // Each sub-module's parent top-module = the leafToTop of any leaf
      // in that sub-module. Take the first leaf encountered per sub.
      const seen = new Int8Array(numSub);
      for (let v = 0; v < g.n; v++) {
        const s = subRenum[v];
        if (!seen[s]) { subToTop[s] = leafToTop[v]; seen[s] = 1; }
      }
    }

    // Pass PsubLeaf as prevP — its running tracker has the leaf-level
    // module accumulators after applyMembership(subOf). cpp's Phase 3
    // consolidateModules(true) creates sub-module super-vertices with
    // .data = m_moduleFlowData[m_orig] (running tracker after Phase 2's
    // moveActiveNodesToPredefinedModules). Without this, fallback path
    // recomputes from cross-edge half-flows + drifts O(1 ulp) from cpp.
    const collapsedG = collapseGraph(g, subRenum, numSub, PsubLeaf);
    const collapsedP = makePartition(collapsedG);
    // Move sub-modules to their former top-modules. After this,
    // collapsedP.moduleOf == subToTop.
    applyMembership(collapsedP, collapsedG, subToTop);

    // Phase 4: optimizeActiveNetwork at the sub-module level (canonical
    // line 1504). RNG-consuming. isCoarseTune=true -> loopLimit=20.
    // Capture numEff: cpp's partition() outer loop only calls
    // findTopModulesRepeatedly after coarseTune when coarseTune returned
    // numEffectiveLoops > 0 (InfomapBase.cpp:1080). When numEff == 0
    // cpp coarseTune returns 0 and partition()'s isImprovement gate
    // kicks in directly without an extra findTop. JS must gate Phase 6
    // identically — without this gate, Phase 6 runs an extra full
    // multi-level Louvain pass that cpp never executes, drifting
    // partition + L from cpp on long trajectories.
    if (log) log("coarseTune.subModuleOpt", { n: collapsedG.n });
    const phase4NumEff = optimizeActiveNetwork(collapsedP, collapsedG, rng, {
      loopLimit: 20,
      tuneIterationLimit: opts.tuneIterationLimit | 0,
      isFirstLoop: false,
      boundaryLog: log,
    });

    // Phase 5: project optimized sub-module-of-sub-modules back to
    // leaves to produce the new leaf->top membership.
    const newLeafToTop = new Int32Array(g.n);
    for (let v = 0; v < g.n; v++) {
      newLeafToTop[v] = collapsedP.moduleOf[subRenum[v]];
    }
    const newRenum = renumberByEncounter(newLeafToTop, g.n);

    // Phase 6: continue with findTopModulesRepeatedlyFromPartition on
    // the new leaf-level membership (canonical's findTopModulesRepeatedly
    // call after coarseTune in partition()).
    //
    // Pass post-Phase-5 collapsedP as the seed prevP. cpp's
    // consolidateModules(true) at end of coarseTune leaves m_moduleFlowData
    // populated with the running tracker for each top-module. The next
    // findTopModulesRepeatedly's setActiveNetworkFromChildrenOfRoot +
    // initPartition reads m_moduleFlowData verbatim. JS must mirror by
    // inheriting collapsedP's moduleFlow / moduleEnter / moduleExit at
    // lvl 0 of the post-coarseTune collapse, NOT recomputing via the
    // fallback direct-sum + half-flow path.
    if (phase4NumEff === 0) {
      // Mirror cpp: skip post-coarseTune findTop; return current
      // post-Phase-5 mapping + current L. Compute L via fresh Partition
      // since we don't have the running tracker for the projected leaf
      // membership directly.
      const finalP = makePartition(g);
      applyMembership(finalP, g, newRenum);
      return { membership: newRenum, L: finalP.codelength(),
               partition: finalP, topModuleOrigOf: null,
               numEffectiveLoops: 0 };
    }
    const res = findTopModulesRepeatedlyFromPartition(g, newRenum, rng, {
      ...opts, isFirstLoopOuter: false,
      seedPrevP: collapsedP,
      seedPrevMembership: subRenum,
    });
    res.numEffectiveLoops = phase4NumEff;
    return res;
  }

  // Faithful mirror of InfomapBase::partition (two-level path).
  function runInfomapFaithful(nodeIds, edges, opts) {
    opts = opts || {};
    // D2: caller can supply a preset graph (used by coarseTuneFaithful
    // to feed a sub-graph that inherits parent leaf flows).
    const g = opts.presetGraph != null ? opts.presetGraph
                                       : buildGraph(nodeIds, edges);
    const seed = opts.seed != null ? opts.seed : 1;
    // Allow caller to inject an existing rng (for sub-Infomap recursion
    // inside coarseTune). canonical re-uses m_rand at every level —
    // matching that means propagating the same MT19937 instance.
    const rng = opts.rng != null ? opts.rng : LV.MT19937(seed >>> 0);
    const aggregationLimit = opts.aggregationLimit != null
      ? opts.aggregationLimit : 30;
    const tuneIterationLimit = opts.tuneIterationLimit | 0;
    const minImpr = 1e-10;
    const minRelTuneImpr = 1e-5;
    const log = opts.boundaryLog || null;

    // Compute one-level codelength up front (for the bail-out check).
    const oneLevelL = oneLevelCodelength(g);

    // First findTopModulesRepeatedly. canonical's isFirstLoop() ==
    // (m_tuneIterationIndex == 0 && isFullNetwork()) where
    // isFullNetwork() == m_isMain && m_aggregationLevel == 0. For the
    // top-level Infomap m_isMain == true; for sub-Infomap inside
    // coarseTune m_isMain == false. opts.isMain (default true) toggles
    // this so sub-Infomap's tryMoveEach sees isFirstLoop == false even
    // at aggregation_level == 0.
    const isMain = opts.isMain !== undefined ? !!opts.isMain : true;
    if (log) log("partition.firstFindTop", { n: g.n });
    let r = findTopModulesRepeatedly(g, rng, {
      aggregationLimit: aggregationLimit, loopLimit: 10,
      isFirstLoopOuter: isMain,
      tuneIterationLimit: tuneIterationLimit,
      boundaryLog: log,
    });
    let leafToTop = r.membership;
    let lastL = r.L;
    let lastPartition = r.partition;
    let lastTopModuleOrigOf = r.topModuleOrigOf;
    const initialL = oneLevelL;

    let doFineTune = true;
    let coarseTuned = false;
    let tuneIdx = 0;
    while (true) {
      if (typeof globalThis.__INFOMAP_LOOP_ITER === "function") {
        globalThis.__INFOMAP_LOOP_ITER(tuneIdx, doFineTune, coarseTuned, maxOf(leafToTop) + 1, lastL);
      }
      if (maxOf(leafToTop) + 1 <= 1) break;
      tuneIdx += 1;
      // canonical's `(m_tuneIterationIndex + 1) != tuneIterationLimit`:
      // when tuneIterationLimit == 0 (default), the unsigned compare
      // is always true (effectively unlimited). When > 0, terminate
      // after that many iterations.
      if (tuneIterationLimit !== 0 && tuneIdx === tuneIterationLimit) break;
      let res;
      // tuneIdx > 0 -> isFirstLoopOuter=false for all calls inside.
      if (doFineTune) {
        if (log) log("partition.fineTune.iter", { tuneIdx });
        const ft = fineTuneFaithful(g, leafToTop, rng, {
          aggregationLimit: aggregationLimit, loopLimit: 10,
          tuneIterationLimit: tuneIterationLimit,
          isFirstLoop: false,
          boundaryLog: log,
        });
        if (ft.numEffectiveLoops > 0) {
          if (log) log("partition.findTopAfterFine", { tuneIdx });
          // Pass fineTune's leaf-level Partition as seedPrevP so
          // findTopModulesRepeatedlyFromPartition's lvl 0 collapseGraph
          // inherits the running tracker (mirrors cpp's
          // consolidateModules at end of fineTune copying
          // m_moduleFlowData into the next-level super-vertices).
          res = findTopModulesRepeatedlyFromPartition(g, ft.membership, rng, {
            aggregationLimit: aggregationLimit, loopLimit: 10,
            isFirstLoopOuter: false,
            boundaryLog: log,
            seedPrevP: ft.partition,
          });
        } else {
          res = { membership: leafToTop, L: lastL };
        }
      } else {
        coarseTuned = true;
        if (log) log("partition.coarseTune.iter", { tuneIdx });
        res = coarseTuneFaithful(g, leafToTop, rng, {
          aggregationLimit: aggregationLimit, loopLimit: 10,
          seed: seed,
          isFirstLoopOuter: false,
          boundaryLog: log,
          // cpp's parent.data.exitFlow at sub-Infomap entry =
          // m_moduleFlowData[m_orig].exitFlow snapshot from the prev
          // findTopModulesRepeatedly's last consolidate. JS mirrors via
          // lastPartition (= last successful Partition before break) +
          // lastTopModuleOrigOf (= orig-id-of renumbered top-module).
          parentPartition: lastPartition,
          parentTopModuleOrigOf: lastTopModuleOrigOf,
          // Oracle: per-top-module leaf-order from cpp tracer (when
          // running under verification harness). When null, JS falls
          // back to v-order which matches cpp on most trajectories.
          leafOrderOracle: opts.leafOrderOracleByCoarseTuneCall != null
            ? opts.leafOrderOracleByCoarseTuneCall(tuneIdx)
            : null,
        });
      }
      const newL = res.L;
      // Compound improvement gate: BOTH absolute AND relative.
      const absImpr = newL <= lastL - minImpr;
      const relImpr = newL < lastL - initialL * minRelTuneImpr;
      const isImprovement = absImpr && relImpr;
      if (!isImprovement) {
        if (coarseTuned) break;
      } else {
        leafToTop = res.membership;
        lastL = newL;
        lastPartition = res.partition;
        lastTopModuleOrigOf = res.topModuleOrigOf;
      }
      if (typeof globalThis.__INFOMAP_TUNE_END === "function") {
        globalThis.__INFOMAP_TUNE_END(tuneIdx, doFineTune ? "fine" : "coarse",
          isImprovement, Array.from(leafToTop), lastL);
      }
      doFineTune = !doFineTune;
    }

    // One-module bail-out. Mirrors cpp InfomapBase::partition lines
    // 1109-1124. Cpp also requires haveNonTrivialModules (= at least
    // one top-module with > 1 leaf). Without that gate, JS would bail
    // on a partition where every leaf is in its own singleton module
    // even though cpp wouldn't, drifting K_top vs cpp on tiny networks.
    const partitionFinal = makePartition(g);
    applyMembership(partitionFinal, g, leafToTop);
    const finalL = partitionFinal.codelength();
    let haveNonTrivialModules = false;
    {
      const sizes = new Int32Array(maxOf(leafToTop) + 1);
      for (let v = 0; v < g.n; v++) sizes[leafToTop[v]]++;
      for (let c = 0; c < sizes.length; c++) {
        if (sizes[c] > 1) { haveNonTrivialModules = true; break; }
      }
      if (maxOf(leafToTop) + 1 <= 1) haveNonTrivialModules = false;
    }
    if (typeof globalThis.__INFOMAP_SUBRUN === "function") {
      globalThis.__INFOMAP_SUBRUN({
        n: g.n, isMain: isMain, oneLevelL: oneLevelL, finalL: finalL,
        haveNonTrivialModules: haveNonTrivialModules,
        kBeforeBail: maxOf(leafToTop) + 1,
        bailedOut: !opts.preferModularSolution && haveNonTrivialModules && finalL > oneLevelL,
      });
    }
    if (!opts.preferModularSolution && haveNonTrivialModules
        && finalL > oneLevelL) {
      const target = new Int32Array(g.n);
      for (let v = 0; v < g.n; v++) target[v] = 0;
      const membership = new Map();
      nodeIds.forEach(function (id, i) { membership.set(id, 0); });
      return {
        graph: g, finalPartition: target, finalL: oneLevelL,
        membership: membership, bailedOut: true,
      };
    }
    const renumbered = renumberByEncounter(leafToTop, g.n);
    const membership = new Map();
    nodeIds.forEach(function (id, i) { membership.set(id, renumbered[i]); });
    return {
      graph: g, finalPartition: renumbered, finalL: finalL,
      membership: membership, bailedOut: false,
    };
  }

  // ── Outer driver: partition() ──────────────────────────────────────
  // Two-level Infomap. Returns a leaf->top membership Map<id, comm>.
  function runInfomapCanonical(nodeIds, edges, opts) {
    opts = opts || {};
    const g = buildGraph(nodeIds, edges);
    const seed = opts.seed != null ? opts.seed : 1;
    const rng = LV.MT19937(seed >>> 0);
    const aggregationLimit = opts.aggregationLimit != null
      ? opts.aggregationLimit : 30;
    // findTopModulesRepeatedly does one full multi-level Louvain pass.
    let r = findTopModulesRepeatedly(g, rng, {
      aggregationLimit: aggregationLimit,
      loopLimit: 10,
    });
    let leafToTop = r.membership;
    let lastL = r.L;
    // Outer loop alternating fineTune/coarseTune per
    // InfomapBase::partition. fineTune projects leaves through current
    // top-modules + reoptimizes; coarseTune runs sub-Infomap per top-
    // module to refine. Loop until neither pass strictly improves.
    const minImpr = 1e-10;
    const maxOuter = opts.tuneIterationLimitOuter != null
      ? opts.tuneIterationLimitOuter : 20;
    let doFineTune = true;
    let coarseTuned = false;
    for (let it = 0; it < maxOuter; it++) {
      let res;
      if (doFineTune) {
        const ft = fineTune(g, leafToTop, rng, {
          aggregationLimit: aggregationLimit, loopLimit: 10,
        });
        res = findTopModulesRepeatedlyFromPartition(g, ft.membership, rng, {
          aggregationLimit: aggregationLimit, loopLimit: 10,
        });
      } else {
        coarseTuned = true;
        res = coarseTune(g, leafToTop, rng, {
          aggregationLimit: aggregationLimit, loopLimit: 10,
          seed: seed,
        });
      }
      const newL = res.L;
      const isImprovement = newL <= lastL - minImpr;
      if (!isImprovement) {
        if (coarseTuned) break;
      } else {
        leafToTop = res.membership;
        lastL = newL;
      }
      doFineTune = !doFineTune;
    }
    const partitionFinal = makePartition(g);
    applyMembership(partitionFinal, g, leafToTop);
    const L = partitionFinal.codelength();
    const membership = new Map();
    nodeIds.forEach(function (id, i) { membership.set(id, leafToTop[i]); });
    return {
      graph: g,
      finalPartition: leafToTop,
      finalL: L,
      membership: membership,
    };
  }

  // ── Public API ──────────────────────────────────────────────────
  C.INFOMAP_CANON = {
    plogp: plogp,
    uniformInt: uniformInt,
    getRandomizedIndexVector: getRandomizedIndexVector,
    buildGraph: buildGraph,
    makePartition: makePartition,
    applyMembership: applyMembership,
    tryMoveEach: tryMoveEach,
    optimizeActiveNetwork: optimizeActiveNetwork,
    findTopModulesRepeatedly: findTopModulesRepeatedly,
    collapseGraph: collapseGraph,
    runInfomapCanonical: runInfomapCanonical,
    runInfomapFaithful: runInfomapFaithful,
  };
})();
