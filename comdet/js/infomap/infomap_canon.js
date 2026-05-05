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
 * the COMDET.INFOMAP_LEGACY surface for the page walker. This file
 * mounts COMDET.INFOMAP_CANON.
 */
(function () {
  "use strict";
  if (!window.COMDET || !window.COMDET.LOUVAIN) {
    console.warn("[infomap_canon] COMDET.LOUVAIN missing; load louvain.js first");
    return;
  }
  const C = window.COMDET;
  const LV = C.LOUVAIN;

  function plogp(p) {
    if (p <= 0) return 0;
    return p * Math.log2(p);
  }

  // ── libstdc++-style std::uniform_int_distribution<unsigned int> ────
  // For std::mt19937 (urngmin=0, urngmax=2^32-1) the 32-bit-output
  // path runs:
  //   urngrange = 2^32 - 1
  //   urange    = max - min
  //   uerange   = urange + 1
  //   scaling   = urngrange / uerange   (integer)
  //   past      = uerange * scaling
  //   loop: ret = mt19937(); reject if ret >= past
  //   return min + ret / scaling
  // The JS MT19937 raw() returns a uint32 already, matching std::mt19937.
  function uniformInt(rng, lo, hi) {
    if (hi <= lo) return lo;
    const urngrange = 0xFFFFFFFF;            // 2^32 - 1
    const urange = (hi - lo) >>> 0;
    const uerange = urange + 1;              // safe: urange < 2^32 in our usage
    // Use floor division for integers; JS double can hold (2^32-1) exactly.
    const scaling = Math.floor(urngrange / uerange);
    const past = uerange * scaling;
    let ret;
    do { ret = rng.raw() >>> 0; } while (ret >= past);
    return lo + Math.floor(ret / scaling);
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

    return {
      n: n,
      links: links,
      outEdges: outEdges,
      inEdges: inEdges,
      nodeFlow: nodeFlow,
      nodeEnter: nodeEnter,
      nodeExit: nodeExit,
      sumWeightedDegree: sumWeightedDegree,
    };
  }

  // ── Module flow data + MapEquation accumulators ───────────────────
  // Mirrors InfomapOptimizer + MapEquation state.
  function makePartition(g) {
    const n = g.n;
    const moduleOf = new Int32Array(n);
    const moduleMembers = new Int32Array(n);
    const moduleFlow      = new Float64Array(n); // flow + selfFlow for that module's leaf
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

    // MapEquation accumulators (calculateCodelengthTerms over modules):
    let nodeFlow_log_nodeFlow = 0;
    for (let v = 0; v < n; v++) nodeFlow_log_nodeFlow += plogp(g.nodeFlow[v]);
    let exitNetworkFlow = 0; // root-level exit flow; 0 for two-level full network
    let exitNetworkFlow_log_exitNetworkFlow = plogp(exitNetworkFlow);

    let enterFlow = exitNetworkFlow;
    let enter_log_enter = 0;
    let exit_log_exit = 0;
    let flow_log_flow = 0;
    for (let c = 0; c < n; c++) {
      flow_log_flow += plogp(moduleFlow[c] + moduleExitFlow[c]);
      enter_log_enter += plogp(moduleEnterFlow[c]);
      exit_log_exit += plogp(moduleExitFlow[c]);
      enterFlow += moduleEnterFlow[c];
    }
    let enterFlow_log_enterFlow = plogp(enterFlow);

    // Codelength = (enterFlow_log_enterFlow - enter_log_enter -
    //               exitNetworkFlow_log_exitNetworkFlow) +
    //              (-exit_log_exit + flow_log_flow - nodeFlow_log_nodeFlow)
    function codelength() {
      const indexCodelength = enterFlow_log_enterFlow - enter_log_enter
                            - exitNetworkFlow_log_exitNetworkFlow;
      const moduleCodelength = -exit_log_exit + flow_log_flow
                             - nodeFlow_log_nodeFlow;
      return indexCodelength + moduleCodelength;
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

      moduleMembers[oldM] -= 1;
      moduleMembers[newM] += 1;
      moduleOf[v] = newM;
    }

    return {
      n: function () { return n; },
      moduleOf: moduleOf,
      moduleMembers: moduleMembers,
      moduleFlow: moduleFlow,
      moduleEnterFlow: moduleEnterFlow,
      moduleExitFlow: moduleExitFlow,
      emptyModules: emptyModules,
      diffMove: diffMove,
      moveNode: moveNode,
      codelength: codelength,
      getEnterFlow: function () { return enterFlow; },
    };
  }

  // ── tryMoveEachNodeIntoBestModule (Louvain-style sweep) ───────────
  function tryMoveEach(P, g, rng, opts) {
    opts = opts || {};
    const isFirstLoop = !!opts.isFirstLoop;
    const tuneIterationLimit = opts.tuneIterationLimit | 0;
    const minImpr = 1e-10; // minimumSingleNodeCodelengthImprovement
    const dirty = opts.dirty;
    const order = getRandomizedIndexVector(rng, g.n);
    let nMoved = 0;

    // Reused across nodes: per-iter `clear()` is much cheaper than
    // allocating a fresh Map + Array per visit.
    const insertOrder = [];
    const dfMap = new Map();

    for (let i = 0; i < g.n; i++) {
      const v = order[i];
      if (!dirty[v]) continue;
      if (P.moduleMembers[P.moduleOf[v]] > 1
          && isFirstLoop && tuneIterationLimit !== 1) {
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
      // Randomize link order via canonical's getRandomizedIndexVector.
      const numLinks = insertOrder.length;
      const linkOrder = getRandomizedIndexVector(rng, numLinks);

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
      P.moveNode(v, bestModule,
                 oldEntry.deltaEnter, oldEntry.deltaExit,
                 bestEntry.deltaEnter, bestEntry.deltaExit);
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
        if (P.moduleMembers[bestModule] === 0) P.emptyModules.pop();
        if (P.moduleMembers[oldM] === 1) P.emptyModules.push(oldM);
        P.moveNode(w, bestModule, oDE, oDX, nDE, nDX);
        nMoved += 1;
        if (g.outEdges[w].length + g.inEdges[w].length > 1) {
          for (const e of g.outEdges[w]) dirty[e.v] = 1;
          for (const e of g.inEdges[w]) dirty[e.u] = 1;
        }
      }
    }
    return nMoved;
  }

  // optimizeActiveNetwork: loop tryMoveEach until no improvement.
  function optimizeActiveNetwork(P, g, rng, opts) {
    opts = opts || {};
    const loopLimit = opts.loopLimit != null ? opts.loopLimit : 10;
    const minImpr = 1e-10;
    const dirty = new Int8Array(g.n);
    for (let i = 0; i < g.n; i++) dirty[i] = 1;
    let coreLoopCount = 0;
    let numEffective = 0;
    let oldL = P.codelength();
    while (coreLoopCount < loopLimit) {
      coreLoopCount += 1;
      const nMoved = tryMoveEach(P, g, rng, {
        isFirstLoop: coreLoopCount === 1,
        tuneIterationLimit: opts.tuneIterationLimit | 0,
        dirty: dirty,
      });
      const newL = P.codelength();
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
  function applyMembership(P, g, target) {
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
  function findTopModulesRepeatedly(g, rng, opts) {
    opts = opts || {};
    const minImpr = 1e-10;
    const levels = [];
    let currentP = makePartition(g);
    optimizeActiveNetwork(currentP, g, rng, opts);
    let lastL = currentP.codelength();
    let aggregateMembership = renumberByEncounter(currentP.moduleOf, g.n);
    levels.push({
      membership: new Int32Array(aggregateMembership),
      L: lastL,
      ncomm: maxOf(aggregateMembership) + 1,
    });
    const aggLimit = opts.aggregationLimit != null ? opts.aggregationLimit : 30;
    for (let lvl = 1; lvl < aggLimit; lvl++) {
      const ncomm = maxOf(aggregateMembership) + 1;
      if (ncomm <= 1) break;
      const collapsedG = collapseGraph(g, aggregateMembership, ncomm,
                                       null);
      const collapsedP = makePartition(collapsedG);
      const eff = optimizeActiveNetwork(collapsedP, collapsedG, rng, opts);
      const newL = collapsedP.codelength();
      // Restore-on-no-improvement: if the super-network sweep didn't
      // strictly reduce the leaf-flat codelength (= the super-network's
      // current codelength once optimized), we keep the previous level's
      // membership and stop. Mirrors canonical's
      // restoreConsolidatedOptimizationPointIfNoImprovement.
      if (eff === 0 || newL >= lastL - minImpr) break;
      const next = new Int32Array(g.n);
      for (let v = 0; v < g.n; v++) {
        next[v] = collapsedP.moduleOf[aggregateMembership[v]];
      }
      aggregateMembership = renumberByEncounter(next, g.n);
      levels.push({
        membership: new Int32Array(aggregateMembership),
        L: newL,
        ncomm: maxOf(aggregateMembership) + 1,
      });
      lastL = newL;
    }
    return { membership: aggregateMembership, levels: levels, L: lastL };
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
  function collapseGraph(g, membership, ncomm, prevP) {
    const linkMap = new Map();
    for (const lk of g.links) {
      const cu = membership[lk.u];
      const cv = membership[lk.v];
      if (cu === cv) continue;
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
    // Sum leaf flows per module. For prev-level enter/exit, prefer
    // previous Partition's accumulators which already track what
    // moveNode + initEnterExitFlow produced.
    const nodeFlow  = new Float64Array(ncomm);
    const nodeEnter = new Float64Array(ncomm);
    const nodeExit  = new Float64Array(ncomm);
    for (let v = 0; v < g.n; v++) nodeFlow[membership[v]] += g.nodeFlow[v];
    if (prevP != null) {
      // Module accumulators from previous level may use module ids
      // that don't match the renumbered membership (renumberByEncounter
      // remaps to 0..K-1). Walk leaves, find their previous-level
      // module, and copy its accumulator under the renumbered id.
      // Since each leaf in the same renumbered module shared the same
      // previous-level module, copying once per renumbered id suffices.
      const seen = new Int8Array(ncomm);
      for (let v = 0; v < g.n; v++) {
        const c = membership[v];
        if (seen[c]) continue;
        const oldC = prevP.moduleOf[v];
        nodeEnter[c] = prevP.moduleEnterFlow[oldC];
        nodeExit[c]  = prevP.moduleExitFlow[oldC];
        seen[c] = 1;
      }
    } else {
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
    // Sort by (u, v) ASC so insertion-order is deterministic when the
    // optimizer's deltaFlow VectorMap accumulates contributions.
    links.sort(function (a, b) { return a.u - b.u || a.v - b.v; });
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
    const minImpr = 1e-10;
    const seedRenum = renumberByEncounter(seedMembership, g.n);
    let aggregateMembership = seedRenum;
    let lastL = (function () {
      const P = makePartition(g);
      applyMembership(P, g, seedRenum);
      return P.codelength();
    })();
    const aggLimit = opts.aggregationLimit != null
      ? opts.aggregationLimit : 30;
    for (let lvl = 0; lvl < aggLimit; lvl++) {
      const ncomm = maxOf(aggregateMembership) + 1;
      if (ncomm <= 1) break;
      const collapsedG = collapseGraph(g, aggregateMembership, ncomm, null);
      const collapsedP = makePartition(collapsedG);
      const eff = optimizeActiveNetwork(collapsedP, collapsedG, rng, opts);
      const newL = collapsedP.codelength();
      if (eff === 0 || newL >= lastL - minImpr) break;
      const next = new Int32Array(g.n);
      for (let v = 0; v < g.n; v++) {
        next[v] = collapsedP.moduleOf[aggregateMembership[v]];
      }
      aggregateMembership = renumberByEncounter(next, g.n);
      lastL = newL;
    }
    return { membership: aggregateMembership, L: lastL };
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
      const memberIds = members; // external ids = original compact indices
      const remap = new Map();
      members.forEach(function (v, i) { remap.set(v, i); });
      const subEdges = [];
      const memberSet = new Set(members);
      for (const lk of g.links) {
        if (memberSet.has(lk.u) && memberSet.has(lk.v)) {
          subEdges.push([remap.get(lk.u), remap.get(lk.v)]);
        }
      }
      const subRes = runInfomapCanonical(
        members.map(function (_, i) { return i; }),
        subEdges,
        { seed: opts.seed != null ? opts.seed : 1,
          aggregationLimit: 30,
          tuneIterationLimitOuter: 0 }
      );
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

  // ── Outer driver: partition() ──────────────────────────────────────
  // Two-level Infomap. Returns a leaf->top membership Map<id, comm>.
  function runInfomapCanonical(nodeIds, edges, opts) {
    opts = opts || {};
    const g = buildGraph(nodeIds, edges);
    const seed = opts.seed != null ? opts.seed : 1;
    const rng = LV.MT19937(seed >>> 0);
    const aggregationLimit = opts.aggregationLimit != null
      ? opts.aggregationLimit : 30;
    const tuneIterationLimit = opts.tuneIterationLimit != null
      ? opts.tuneIterationLimit : 0;
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
    optimizeActiveNetwork: optimizeActiveNetwork,
    findTopModulesRepeatedly: findTopModulesRepeatedly,
    collapseGraph: collapseGraph,
    runInfomapCanonical: runInfomapCanonical,
  };
})();
