/* IKC kernel: Iterative k-core Clustering (Wedell et al. 2022).
 * Port of community-detection/src/ikc/run_ikc.py:103-204.
 *
 * Modularity gate computes the paper formula but defaults to canonical
 * pass-through (run_ikc.py:280 short-circuits to POSITIVE_VALUE = 1);
 * `opts.canonicalGate = false` enforces mod(s) > 0 instead.
 *
 * Internals operate on compact 0..n-1 indices via Int32Array adjacency;
 * external API takes / returns original node ids.
 *
 * Hook gating (gold-standard byte-equal-tracer playbook):
 *   The same file serves as production browser walker AND verification
 *   JS-tracer. When `globalThis.__IKC_HOOK` is undefined the helper is a
 *   zero-cost no-op (one typeof check + early return). When a harness
 *   installs a function on `globalThis.__IKC_HOOK` before requiring this
 *   file, every site populates the trace schema at
 *   community-detection/tools/viz_check/ikc/TRACE_SCHEMA.md.
 *
 *   Behaviour invariant: kernel return value MUST be byte-identical with
 *   vs without the hook installed. See test_hook_equivalence.mjs.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;

  // Hook emit helper. Cheap when no harness installed (single typeof
  // check + early return); fires the harness callback when one is set.
  function __ikc_hook(eventName, payload) {
    const h = (typeof globalThis !== "undefined" && globalThis.__IKC_HOOK);
    if (typeof h === "function") h(eventName, payload);
  }

  // Compact a (nodeIds, edges) pair into Int32Array CSR-ish adjacency.
  // Returns {n, ids, idx, adjN, adjStarts, m} where adjN is a flat
  // Int32Array of neighbour-indices and adjStarts[i] is the offset of
  // node i's neighbour list (length = adjStarts[i+1] - adjStarts[i]).
  //
  // Per-node neighbour lists are sorted ASC. This makes BFS in
  // connectedComponentsCompact a "lex-smallest BFS" (deterministic
  // function of the residual node-set + adjacency, independent of edge
  // insertion order). The TRACE_SCHEMA's members_iter_order is defined
  // as lex-smallest BFS so JS + canonical-tracer (which sorts components
  // similarly post-getComponents) agree on a single canonical order.
  function compactSubgraph(nodeIds, edges) {
    const n = nodeIds.length;
    const idx = new Map();
    nodeIds.forEach(function (id, i) { idx.set(id, i); });
    let m = 0;
    const eu = [];
    const ev = [];
    edges.forEach(function (e) {
      if (e[0] === e[1]) return;
      const u = idx.get(e[0]); const v = idx.get(e[1]);
      if (u == null || v == null) return;
      eu.push(u); ev.push(v); m += 1;
    });
    const eU = new Int32Array(eu);
    const eV = new Int32Array(ev);
    const deg = new Int32Array(n);
    for (let i = 0; i < m; i++) { deg[eU[i]] += 1; deg[eV[i]] += 1; }
    const adjStarts = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) adjStarts[i + 1] = adjStarts[i] + deg[i];
    const adjN = new Int32Array(adjStarts[n]);
    const cursor = new Int32Array(n);
    for (let i = 0; i < m; i++) {
      const u = eU[i], v = eV[i];
      adjN[adjStarts[u] + cursor[u]++] = v;
      adjN[adjStarts[v] + cursor[v]++] = u;
    }
    // Sort each node's neighbour list ASC for lex-smallest BFS.
    for (let i = 0; i < n; i++) {
      const lo = adjStarts[i], hi = adjStarts[i + 1];
      if (hi - lo > 1) {
        const slice = adjN.subarray(lo, hi);
        slice.sort();
      }
    }
    return { n: n, ids: nodeIds, idx: idx, adjN: adjN, adjStarts: adjStarts,
             m: m, eU: eU, eV: eV };
  }

  function nbStart(g, i) { return g.adjStarts[i]; }
  function nbEnd(g, i)   { return g.adjStarts[i + 1]; }

  // Batagelj-Zaversnik linear-time core decomposition over compact
  // indices. Bucket queue ordered by current degree; pop a node, assign
  // its current degree as core number, slide neighbour positions when
  // their degree decreases. O(V + E).
  function coreNumbersCompact(g) {
    const n = g.n;
    if (n === 0) return { core: new Int32Array(0), max: 0 };
    const deg = new Int32Array(n);
    let maxDeg = 0;
    for (let i = 0; i < n; i++) {
      deg[i] = nbEnd(g, i) - nbStart(g, i);
      if (deg[i] > maxDeg) maxDeg = deg[i];
    }
    const bin = new Int32Array(maxDeg + 1);
    for (let i = 0; i < n; i++) bin[deg[i]] += 1;
    let start = 0;
    for (let d = 0; d <= maxDeg; d++) {
      const c = bin[d]; bin[d] = start; start += c;
    }
    const order = new Int32Array(n);
    const pos = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const d = deg[i];
      order[bin[d]] = i; pos[i] = bin[d]; bin[d] += 1;
    }
    for (let d = maxDeg; d > 0; d--) bin[d] = bin[d - 1];
    bin[0] = 0;
    const core = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const v = order[i];
      core[v] = deg[v];
      const lo = nbStart(g, v), hi = nbEnd(g, v);
      for (let k = lo; k < hi; k++) {
        const u = g.adjN[k];
        if (deg[u] <= deg[v]) continue;
        const du = deg[u], pu = pos[u], pw = bin[du], w = order[pw];
        if (u !== w) {
          order[pu] = w; order[pw] = u; pos[u] = pw; pos[w] = pu;
        }
        bin[du] += 1;
        deg[u] = du - 1;
      }
    }
    let mx = 0;
    for (let i = 0; i < n; i++) if (core[i] > mx) mx = core[i];
    return { core: core, max: mx };
  }

  // Lex-smallest BFS over the (mask-restricted) compact graph. Outer
  // scan is ascending compact id; per-node neighbour list is already
  // sorted ASC (compactSubgraph + buildResidualG both sort). BFS frontier
  // expansion therefore visits the smallest-id unseen neighbour first.
  function connectedComponentsCompact(g, mask) {
    const n = g.n;
    const seen = new Uint8Array(n);
    const comps = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      if (mask && !mask[s]) { seen[s] = 1; continue; }
      const comp = [];
      let head = 0;
      comp.push(s); seen[s] = 1;
      while (head < comp.length) {
        const v = comp[head++];
        const lo = nbStart(g, v), hi = nbEnd(g, v);
        for (let k = lo; k < hi; k++) {
          const u = g.adjN[k];
          if (seen[u]) continue;
          if (mask && !mask[u]) continue;
          seen[u] = 1; comp.push(u);
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  // Within the kcore subgraph (compact), every component node must
  // have degree >= kFloor counting only neighbours in the same kcore.
  // Implemented via a Uint8 mask of kcore membership; per-node degree
  // is the count of neighbours whose mask-bit is set.
  //
  // Returns {ok: bool, failingId: int | null} so the trace can record
  // the first failing compact id (component-local) for the tracer's
  // k_valid_failing_compact_id field.
  function kValidCompact(g, component, kcoreMask, kFloor) {
    for (let i = 0; i < component.length; i++) {
      const v = component[i];
      let d = 0;
      const lo = nbStart(g, v), hi = nbEnd(g, v);
      for (let k = lo; k < hi; k++) {
        if (kcoreMask[g.adjN[k]]) d += 1;
      }
      if (d < kFloor) return { ok: false, failingId: v };
    }
    return { ok: true, failingId: null };
  }

  // Iteration-scoped batch modularity. One O(E_full) sweep over fullEU/EV
  // bins each edge by (memberOf[u], memberOf[v]). Per-component (l_s, d_s)
  // is then O(1). memberOf is Int32Array(globalN) initialised to -1.
  function batchModularitiesCompact(components, memberOf, fullEU, fullEV, fullL) {
    if (fullL === 0) return components.map(function () { return 0; });
    const lS = new Float64Array(components.length);
    const dS = new Float64Array(components.length);
    for (let i = 0; i < fullEU.length; i++) {
      const ca = memberOf[fullEU[i]];
      const cb = memberOf[fullEV[i]];
      if (ca !== -1) dS[ca] += 1;
      if (cb !== -1) dS[cb] += 1;
      if (ca !== -1 && ca === cb) lS[ca] += 1;
    }
    const out = new Array(components.length);
    for (let i = 0; i < components.length; i++) {
      out[i] = (lS[i] / fullL) - Math.pow(dS[i] / (2 * fullL), 2);
    }
    return out;
  }

  // Build residual subgraph (compact 0..remCount-1) with sorted-ASC
  // neighbour lists. The compaction is identity-on-residual (old-id-asc),
  // matching canonical's getCompactedGraph(getContinuousNodeIds(graph)).
  function buildResidualG(globalN, remEU, remEV, localOfGlobal, remCount) {
    const remDeg = new Int32Array(remCount);
    for (let i = 0; i < remEU.length; i++) {
      remDeg[localOfGlobal[remEU[i]]] += 1;
      remDeg[localOfGlobal[remEV[i]]] += 1;
    }
    const remStarts = new Int32Array(remCount + 1);
    for (let i = 0; i < remCount; i++) remStarts[i + 1] = remStarts[i] + remDeg[i];
    const remAdjN = new Int32Array(remStarts[remCount]);
    const cursor = new Int32Array(remCount);
    for (let i = 0; i < remEU.length; i++) {
      const lu = localOfGlobal[remEU[i]], lv = localOfGlobal[remEV[i]];
      remAdjN[remStarts[lu] + cursor[lu]++] = lv;
      remAdjN[remStarts[lv] + cursor[lv]++] = lu;
    }
    // Sort each node's neighbour list ASC for lex-smallest BFS.
    for (let i = 0; i < remCount; i++) {
      const lo = remStarts[i], hi = remStarts[i + 1];
      if (hi - lo > 1) {
        const slice = remAdjN.subarray(lo, hi);
        slice.sort();
      }
    }
    return { n: remCount, ids: null, idx: null,
             adjN: remAdjN, adjStarts: remStarts, m: remEU.length };
  }

  function runIKC(nodeIds, fullEdges, opts) {
    opts = opts || {};
    const kFloor = opts.kFloor != null ? opts.kFloor : 4;
    const canonicalGate = opts.canonicalGate !== false;
    const fixture = opts.fixture != null ? opts.fixture : null;

    // Top-level compaction (stable globalIdx for fullEdges). compactSubgraph
    // already filtered self-loops + missing-endpoint edges into top.eU/top.eV
    // in original edge order; reuse those instead of re-walking fullEdges.
    const top = compactSubgraph(nodeIds, fullEdges);
    const globalN = top.n;
    const fullEU = top.eU;
    const fullEV = top.eV;
    const fullL = top.m;

    // G8 prep: directional out-degree per global compact id, mirroring
    // canonical's `orig_graph.degree(u)` (NetworKit directed-graph degree
    // is out-degree). Canonical's bail-iter modularity at run_ikc.py:118-120
    // uses this. Source of edge directionality = CSV row order preserved
    // in top.eU (source) / top.eV (target).
    const fullOutDeg = new Int32Array(globalN);
    for (let i = 0; i < fullEU.length; i++) fullOutDeg[fullEU[i]] += 1;

    // Tracer init event: fixture name + post-self-loop n/m + node id map.
    __ikc_hook("init", {
      fixture: fixture,
      k_floor: kFloor,
      n_orig: nodeIds.length,
      m_orig: top.m,
      node_id_map: nodeIds.map(function (id, i) {
        return { orig: String(id), compact: i };
      }),
    });

    const remaining = new Uint8Array(globalN); remaining.fill(1);
    const accepted = []; // {iteration, k, members:originalIds, modularity}
    const acceptedTrace = []; // {max_k_at_acceptance, members_compact_in_orig_id} for "final" hook
    const iterations = [];
    let it = 0;
    const dropped = []; // originalIds
    let terminated = null;

    while (true) {
      let remCount = 0;
      for (let i = 0; i < globalN; i++) if (remaining[i]) remCount += 1;
      if (remCount === 0) break;

      // Build residual edge list (compact-global ids) from fullE + mask.
      const remEU = []; const remEV = [];
      for (let i = 0; i < top.m; i++) {
        if (remaining[fullEU[i]] && remaining[fullEV[i]]) {
          remEU.push(fullEU[i]); remEV.push(fullEV[i]);
        }
      }
      // Compact the residual into its own [0..remCount-1] index space.
      const localOfGlobal = new Int32Array(globalN); localOfGlobal.fill(-1);
      const globalOfLocal = new Int32Array(remCount);
      let li = 0;
      for (let gi = 0; gi < globalN; gi++) {
        if (!remaining[gi]) continue;
        localOfGlobal[gi] = li; globalOfLocal[li] = gi; li += 1;
      }
      const remG = buildResidualG(globalN, remEU, remEV, localOfGlobal, remCount);

      // Tracer iter_start: residual_compact_ids_sorted is always
      // [0,1,...,remCount-1] because the recompaction is identity-on-residual.
      const residualCompactIdsSorted = new Array(remCount);
      for (let i = 0; i < remCount; i++) residualCompactIdsSorted[i] = i;
      __ikc_hook("iter_start", {
        iter: it,
        residual_n_before: remCount,
        residual_m_before: remEU.length,
        residual_compact_ids_sorted: residualCompactIdsSorted,
      });

      const cn = coreNumbersCompact(remG);
      const maxK = cn.max;

      const residualOrigIds = new Array(remCount);
      for (let i = 0; i < remCount; i++) residualOrigIds[i] = nodeIds[globalOfLocal[i]];
      const itRec = {
        iteration: it,
        residualNodes: residualOrigIds,
        residualEdges: [], // populated below
        coreNumbers: null,
        maxK: maxK,
        kcoreNodes: [],
        kcoreEdges: [],
        components: [],
        accepted: [],
        bailed: false,
      };
      // Original-id residualEdges + coreNumbers map for trace consumers.
      const remOrigEdges = new Array(remEU.length);
      for (let i = 0; i < remEU.length; i++) {
        remOrigEdges[i] = [nodeIds[remEU[i]], nodeIds[remEV[i]]];
      }
      itRec.residualEdges = remOrigEdges;
      const cnPairs = new Array(remCount);
      for (let i = 0; i < remCount; i++) cnPairs[i] = [residualOrigIds[i], cn.core[i]];
      itRec.coreNumbers = cnPairs;

      if (maxK < kFloor) {
        itRec.bailed = true;
        terminated = "max_k_below_floor";
        // Emit max_k event for the bailed iter so the trace is uniform.
        const coreNumbersSortedBail = new Array(remCount);
        for (let i = 0; i < remCount; i++) coreNumbersSortedBail[i] = [i, cn.core[i]];
        __ikc_hook("max_k", {
          iter: it,
          max_k: maxK,
          kcore_n: 0,
          kcore_m: 0,
          kcore_compact_ids_sorted: [],
          core_numbers_sorted: coreNumbersSortedBail,
        });
        // G8: bail-iter (d/(2L))^2 FP primitive (run_ikc.py:118-120).
        // Mirror canonical's per-node modularity computation exactly:
        //   d = orig_graph.degree(u) — NetworKit directed out-degree.
        //   ratio = d / (2 * L) — IEEE-754 double division (Python `/`).
        //   ratio**2 in Python with exponent==2 byte-equals plain ratio*ratio
        //   (verified on CPython 3.11; both go through fp_mul, not libm pow).
        //   We use ratio*ratio here for the same reason — avoids Math.pow's
        //   libm path drift; verified V8 byte-equal to Python on the same
        //   inputs. See audit row D + tracer_coverage_gaps.md G8.
        const bailPerNodeModularity = [];
        const twoL = 2 * fullL;
        for (let i = 0; i < remCount; i++) {
          const gi = globalOfLocal[i];
          const d = fullOutDeg[gi];
          const ratio = twoL !== 0 ? d / twoL : 0.0;
          const ratioSq = ratio * ratio;
          const negSq = -1 * ratioSq;
          bailPerNodeModularity.push({
            compact_id: i,
            orig_compact_id: gi,
            d: d,
            two_L: twoL,
            ratio: ratio,
            ratio_squared: ratioSq,
            neg_ratio_squared: negSq,
          });
        }
        __ikc_hook("bail_per_node_modularity", {
          iter: it,
          bail_L: fullL,
          bail_per_node_modularity: bailPerNodeModularity,
        });
        for (let i = 0; i < remCount; i++) {
          dropped.push(residualOrigIds[i]);
          remaining[globalOfLocal[i]] = 0;
        }
        __ikc_hook("iter_end", {
          iter: it,
          nodes_to_remove_sorted: [],
          kept_clusters_this_iter: 0,
          terminated: terminated,
        });
        iterations.push(itRec);
        break;
      }

      // (max_k)-core extraction.
      const kcoreMask = new Uint8Array(remCount);
      for (let i = 0; i < remCount; i++) if (cn.core[i] >= maxK) kcoreMask[i] = 1;
      const kcoreNodesLocal = [];
      const kcoreNodesOrig = [];
      const kcoreCompactIdsSorted = [];
      for (let i = 0; i < remCount; i++) {
        if (kcoreMask[i]) {
          kcoreNodesLocal.push(i);
          kcoreNodesOrig.push(residualOrigIds[i]);
          kcoreCompactIdsSorted.push(i);
        }
      }
      let kcoreM = 0;
      const kcoreEdgesOrig = [];
      // G2: directional in/out degree per kcore-subgraph node, mirroring
      // canonical's subgraph.degreeIn / subgraph.degreeOut. Computed from
      // remEU/remEV (CSV-direction preserved by compactSubgraph) restricted
      // to edges both of whose endpoints are kcore members. Indexed by
      // residual-compact-id (= subgraph-local id since subgraphFromNodes
      // preserves ids).
      const kcoreDegIn = new Int32Array(remCount);
      const kcoreDegOut = new Int32Array(remCount);
      for (let i = 0; i < remEU.length; i++) {
        const lu = localOfGlobal[remEU[i]], lv = localOfGlobal[remEV[i]];
        if (kcoreMask[lu] && kcoreMask[lv]) {
          kcoreEdgesOrig.push([nodeIds[remEU[i]], nodeIds[remEV[i]]]);
          kcoreM += 1;
          kcoreDegOut[lu] += 1;
          kcoreDegIn[lv] += 1;
        }
      }
      itRec.kcoreNodes = kcoreNodesOrig;
      itRec.kcoreEdges = kcoreEdgesOrig;

      // Tracer max_k event.
      const coreNumbersSorted = new Array(remCount);
      for (let i = 0; i < remCount; i++) coreNumbersSorted[i] = [i, cn.core[i]];
      __ikc_hook("max_k", {
        iter: it,
        max_k: maxK,
        kcore_n: kcoreNodesLocal.length,
        kcore_m: kcoreM,
        kcore_compact_ids_sorted: kcoreCompactIdsSorted,
        core_numbers_sorted: coreNumbersSorted,
      });

      const compsLocal = connectedComponentsCompact(remG, kcoreMask);

      // Build memberOf:Int32Array(globalN) for batch modularity. Each
      // local-comp node maps to its component index; everything else -1.
      const memberOf = new Int32Array(globalN); memberOf.fill(-1);
      compsLocal.forEach(function (compLocal, ci) {
        compLocal.forEach(function (li) { memberOf[globalOfLocal[li]] = ci; });
      });
      const mods = batchModularitiesCompact(compsLocal, memberOf, fullEU, fullEV, fullL);

      const nodesToRemoveThisIter = [];
      // G9: per-component accumulator mirror of canonical's nodes_to_remove
      // set. Canonical does `nodes_to_remove.update(component)` after each
      // branch decision (run_ikc.py:151, 160, 165). JS pushes to
      // nodesToRemoveThisIter inside each branch below; we snapshot a
      // sorted view after each component closes so the per-component
      // accumulator growth is visible in the trace.
      const nodesToRemoveSetGlobal = new Uint8Array(globalN);
      let keptClustersThisIter = 0;

      compsLocal.forEach(function (compLocal, cIdx) {
        const kvRes = kValidCompact(remG, compLocal, kcoreMask, kFloor);
        const okK = kvRes.ok;
        const mod = mods[cIdx];
        const okMod = canonicalGate ? true : (mod > 0);
        const compOrig = compLocal.map(function (li) { return residualOrigIds[li]; });

        // G2: build k_valid_loop_scope mirroring canonical's
        // subgraph.iterNodes() loop. Iteration scope = every residual-compact
        // node id 0..remCount-1 where kcoreMask is set (since subgraph
        // = kcore-subgraph; subgraphFromNodes preserves ids). For each
        // such node, in_component = (memberOf[globalOfLocal[i]] == cIdx),
        // degIn/degOut from the per-iter kcoreDegIn/kcoreDegOut arrays,
        // sum from their addition, and check_result = "skipped" (not in
        // component) | "ok" | "fail" (first failing) | "post_break_unvisited"
        // (after the canonical break short-circuits — JS records the
        // subgraph node anyway for trace-scope visibility, matching the
        // canonical-tracer's full-scope emission).
        const kValidLoopScope = [];
        let scopeOk = true;
        let scopeFailing = null;
        for (let scopeIdx = 0; scopeIdx < remCount; scopeIdx++) {
          if (!kcoreMask[scopeIdx]) continue;
          const inComp = (memberOf[globalOfLocal[scopeIdx]] === cIdx);
          const din = kcoreDegIn[scopeIdx];
          const dout = kcoreDegOut[scopeIdx];
          const s = din + dout;
          let check;
          if (!inComp) {
            check = "skipped";
          } else if (scopeOk) {
            if (s < kFloor) {
              check = "fail";
              scopeOk = false;
              scopeFailing = scopeIdx;
            } else {
              check = "ok";
            }
          } else {
            check = "post_break_unvisited";
          }
          kValidLoopScope.push({
            subgraph_id: scopeIdx,
            in_component: inComp,
            degIn: din,
            degOut: dout,
            sum: s,
            check_result: check,
          });
        }
        const cRec = {
          nodes: compOrig,
          kValid: okK,
          modularity: mod,
          modularityPass: okMod,
          accepted: okK && okMod,
          fateReason: null,
        };
        // Tracer per-component event.
        const membersIterOrder = compLocal.slice();
        const membersSorted = compLocal.slice().sort(function (a, b) { return a - b; });
        // canonicalGate: mirror dead-gate constant (modular_value=1.0).
        // canonicalGate=false: emit the paper formula value but tracer
        // schema fixes modular_value at 1.0 since dead-gate output is the
        // contract; the gate result lives in modular_pos / kept.
        const modularValue = canonicalGate ? 1.0 : mod;
        let fateReason;
        if (cRec.accepted) {
          cRec.fateReason = "accepted";
          fateReason = "accepted";
          accepted.push({ iteration: it, k: maxK, members: compOrig.slice(), modularity: mod });
          itRec.accepted.push(cRec);
          // accepted_canonical_order entry (compact-at-acceptance ids).
          acceptedTrace.push({
            max_k_at_acceptance: maxK,
            members_compact_in_orig_id: compLocal.slice(),
          });
          compLocal.forEach(function (li) {
            remaining[globalOfLocal[li]] = 0;
            nodesToRemoveThisIter.push(li);
            nodesToRemoveSetGlobal[globalOfLocal[li]] = 1;
          });
          keptClustersThisIter += 1;
        } else if (!okK) {
          cRec.fateReason = "failed k-valid";
          fateReason = "failed k-valid";
          compLocal.forEach(function (li) {
            dropped.push(residualOrigIds[li]);
            remaining[globalOfLocal[li]] = 0;
            nodesToRemoveThisIter.push(li);
            nodesToRemoveSetGlobal[globalOfLocal[li]] = 1;
          });
        } else {
          cRec.fateReason = "failed modularity";
          fateReason = "failed modularity";
          compLocal.forEach(function (li) {
            dropped.push(residualOrigIds[li]);
            remaining[globalOfLocal[li]] = 0;
            nodesToRemoveThisIter.push(li);
            nodesToRemoveSetGlobal[globalOfLocal[li]] = 1;
          });
        }
        itRec.components.push(cRec);
        // G9: snapshot the nodes_to_remove accumulator after this
        // component's update branch closes (mirror of run_ikc.py:151/160/165
        // `nodes_to_remove.update(component)`). Sorted view = same field
        // as canonical's nodes_to_remove_after_update_sorted; the mutation
        // sequence across components is exposed by the iteration of
        // comp_idx 0,1,2,... in the trace.
        const nodesToRemoveAfterUpdateSorted = [];
        for (let gi = 0; gi < globalN; gi++) {
          if (nodesToRemoveSetGlobal[gi]) {
            nodesToRemoveAfterUpdateSorted.push(localOfGlobal[gi]);
          }
        }
        nodesToRemoveAfterUpdateSorted.sort(function (a, b) { return a - b; });
        __ikc_hook("component", {
          iter: it,
          comp_idx: cIdx,
          comp_n: compLocal.length,
          members_iter_order: membersIterOrder,
          members_sorted: membersSorted,
          k_valid: okK,
          k_valid_failing_compact_id: kvRes.failingId,
          k_valid_loop_scope: kValidLoopScope,
          modular_value: modularValue,
          modular_pos: okMod,
          kept: cRec.accepted,
          fate_reason: fateReason,
          nodes_to_remove_after_update_sorted: nodesToRemoveAfterUpdateSorted,
        });
      });
      // iter_end
      const nodesRemoveSorted = nodesToRemoveThisIter.slice().sort(function (a, b) { return a - b; });
      __ikc_hook("iter_end", {
        iter: it,
        nodes_to_remove_sorted: nodesRemoveSorted,
        kept_clusters_this_iter: keptClustersThisIter,
        terminated: null,
      });
      iterations.push(itRec);
      it += 1;
      if (it > 100) break;
    }

    // Final membership map keyed by original id; -1 = dropped/singleton.
    const membership = new Map();
    accepted.forEach(function (cl, ci) {
      cl.members.forEach(function (id) { membership.set(id, ci); });
    });
    nodeIds.forEach(function (id) {
      if (!membership.has(id)) membership.set(id, -1);
    });

    // Tracer final event. Schema's `members_compact_in_orig_id` is the
    // compact-at-acceptance ids mapped back to ORIG names via
    // node_id_map (canonical writes the orig name as a string; JS
    // string-coerces for round-trip parity with the diff harness).
    const acceptedCanonicalOrder = acceptedTrace.map(function (e, idx) {
      const cl = accepted[idx];
      return {
        max_k_at_acceptance: e.max_k_at_acceptance,
        members_compact_in_orig_id: cl.members.map(function (origId) {
          return String(origId);
        }),
      };
    });
    // Match canonical run_ikc.py's `len(final_clusters)`: every accepted
    // cluster + every node that ended up unaccepted (bail residual + every
    // failed-gate component, all appended as singletons in canonical's
    // final_clusters list before print_clusters filters size <= 1).
    const nClustersPre = accepted.length + dropped.length;
    let csvLines = 0;
    let nClustersPost = 0;
    accepted.forEach(function (cl) {
      if (cl.members.length > 1) {
        csvLines += cl.members.length;
        nClustersPost += 1;
      }
    });
    __ikc_hook("final", {
      n_final_clusters_pre_singleton_filter: nClustersPre,
      n_final_clusters_post_singleton_filter: nClustersPost,
      csv_lines: csvLines,
      accepted_canonical_order: acceptedCanonicalOrder,
    });

    return {
      kFloor: kFloor,
      canonicalGate: canonicalGate,
      iterations: iterations,
      accepted: accepted,
      dropped: dropped,
      membership: membership,
    };
  }

  // External-API coreNumbers: takes original ids, returns a Map<id, k>.
  // Used by ikc/page.js to render the stage-1 viz independently of runIKC.
  function coreNumbers(nodeIds, edges) {
    const g = compactSubgraph(nodeIds, edges);
    const cn = coreNumbersCompact(g);
    const core = new Map();
    for (let i = 0; i < g.n; i++) core.set(g.ids[i], cn.core[i]);
    return { core: core, max: cn.max };
  }

  // External-API connectedComponents: takes original ids, returns array
  // of arrays of original ids.
  function connectedComponents(nodeIds, edges) {
    const g = compactSubgraph(nodeIds, edges);
    const compsLocal = connectedComponentsCompact(g, null);
    return compsLocal.map(function (comp) {
      return comp.map(function (li) { return g.ids[li]; });
    });
  }

  function inducedEdges(nodeIds, edges) {
    const set = new Set(nodeIds);
    return edges.filter(function (e) { return set.has(e[0]) && set.has(e[1]); });
  }

  function clusterModularity(component, fullEdges) {
    const L = fullEdges.length;
    if (L === 0) return 0;
    const set = new Set(component);
    let lS = 0, dS = 0;
    fullEdges.forEach(function (e) {
      const a = set.has(e[0]); const b = set.has(e[1]);
      if (a && b) { lS += 1; dS += 2; }
      else if (a || b) { dS += 1; }
    });
    return (lS / L) - Math.pow(dS / (2 * L), 2);
  }

  C.IKC = {
    inducedEdges: inducedEdges,
    coreNumbers: coreNumbers,
    connectedComponents: connectedComponents,
    clusterModularity: clusterModularity,
    runIKC: runIKC,
    runFixture: function (kFloor, canonicalGate) {
      const F = C.FIXTURE;
      return runIKC(F.nodes, F.edges, {
        kFloor: kFloor != null ? kFloor : 4,
        canonicalGate: canonicalGate !== false,
      });
    },
  };
})();
