// abcd_walkers.js — shared mounter functions for the abcd / abcd+o
// walker stages. Both pages run the same canonical-stochastic kernel
// (abcd_kernel.js) and need identical viz primitives; the differences
// (outlier mega-cluster, drop_oo, node-color override for sampler-picked
// outliers) are isolated to the cfg the page hands the factory.
(function () {
  const NS = window.NETGEN || (window.NETGEN = {});

  // mountFinalSwapWalker — cross-cluster final swap viz.
  // cfg fields:
  //   hostId         viz host element id (without "-cy"); buttons share this prefix.
  //                  Walker reads {hostId}-cur / -total / -stage / -desc.
  //   getR           () => current realization with finalEdgesBefore,
  //                  finalRecycleBefore, finalRewireOps, finalResidueLeft.
  //   positions      optional positions map handed to NETGEN.VIZ.init.
  //   nodeColorOf    (nid, R) => fill color for circle + spoke layer.
  //   edgeColorOf    (u, v, R) => non-bad edge color.
  //   dropColor      bad-edge color (red).
  //   stubSeedFn     () => integer seed driving replay rng.
  //   rerollNonceBase, rerollNonceMul: optional, default to abcd's seed shape.
  //   busSubscriptions: array of arrays; each gets reconfigReset pushed in.
  //   syncOverride   optional (ops, R) => void; called whenever the
  //                  module-scoped override is set or cleared. Lets the
  //                  page mirror the override into deg-cmp tracking.
  //   notifyChanged  optional () => void; called after replay or after
  //                  reconfigReset. Lets the page fire downstream bus.
  NS.mountFinalSwapWalker = function (cfg) {
    const {
      hostId,
      getR,
      positions,
      nodeColorOf,
      edgeColorOf,
      dropColor,
      stubSeedFn,
      rerollNonceBase = 6151,
      rerollNonceMul = 53,
      busSubscriptions = [],
      syncOverride,
      notifyChanged,
    } = cfg;

    const host = document.getElementById(hostId + "-cy");
    if (!host) return null;
    const prefix = hostId;
    const keyOf = NS.keyOf;
    const COL_DROP = dropColor;

    const viz = NS.VIZ.init(hostId + "-cy", {
      showLabels: true, edges: [], pinned: true,
      positions,
      nodeColor: (id) => nodeColorOf(parseInt(id, 10), getR()),
    });
    const spokes = NS.spokeLayer.attach(viz, {});

    function pickColor(u, v) { return edgeColorOf(u, v, getR()); }
    function makeEntry(u, v, id, bad) {
      return { u, v, id, bad,
        color: bad ? COL_DROP : pickColor(u, v), badColor: COL_DROP };
    }

    let finalSwapOpsOverride = null;
    let finalRerollNonce = 0;
    function effectiveFinalOps(R) {
      return finalSwapOpsOverride || R.finalRewireOps || [];
    }
    function applyOp(list, op, i, edgeIdByKey) {
      for (let j = list.length - 1; j >= 0; j--) {
        const e = list[j];
        if (!e.bad) continue;
        if ((e.u === op.p1[0] && e.v === op.p1[1])
            || (e.u === op.p1[1] && e.v === op.p1[0])) {
          list.splice(j, 1); break;
        }
      }
      const p2k = keyOf(op.p2[0], op.p2[1]);
      const p2id = edgeIdByKey.get(p2k);
      if (p2id != null) {
        for (let j = list.length - 1; j >= 0; j--) {
          if (list[j].id === p2id) { list.splice(j, 1); break; }
        }
        edgeIdByKey.delete(p2k);
      }
      const id1 = "fs-op" + i + "-1";
      const id2 = "fs-op" + i + "-2";
      list.push(makeEntry(op.newp1[0], op.newp1[1], id1, !op.keep1));
      list.push(makeEntry(op.newp2[0], op.newp2[1], id2, !op.keep2));
      if (op.keep1) edgeIdByKey.set(keyOf(op.newp1[0], op.newp1[1]), id1);
      if (op.keep2) edgeIdByKey.set(keyOf(op.newp2[0], op.newp2[1]), id2);
    }
    function stateAtStep(R, k) {
      const list = [];
      const edgeIdByKey = new Map();
      (R.finalEdgesBefore || []).forEach(([a, b], i) => {
        const e = makeEntry(a, b, "fs-pre-" + i, false);
        list.push(e); edgeIdByKey.set(keyOf(a, b), e.id);
      });
      (R.finalRecycleBefore || []).forEach(([a, b], i) => {
        const e = makeEntry(a, b, "fs-rec-" + i, true);
        list.push(e);
      });
      const ops = effectiveFinalOps(R);
      if (k > ops.length) {
        ops.forEach((op, i) => applyOp(list, op, i, edgeIdByKey));
        return list.filter(e => !e.bad);
      }
      const cap = Math.min(k, ops.length);
      for (let i = 0; i < cap; i++) applyOp(list, ops[i], i, edgeIdByKey);
      return list;
    }
    function byNodeFromList(list) {
      const cnt = {};
      list.forEach(e => {
        cnt[e.u] = (cnt[e.u] || 0) + 1;
        cnt[e.v] = (cnt[e.v] || 0) + 1;
      });
      const R = getR();
      const out = {};
      viz.eachNode(n => {
        out[n.id] = { count: cnt[n.id] || 0,
          color: nodeColorOf(parseInt(n.id, 10), R) };
      });
      return out;
    }

    function replayFinalSwap(lo) {
      const R = getR();
      finalRerollNonce += 1;
      finalSwapOpsOverride = NS.replayFinalSwap({
        edgesBefore: R.finalEdgesBefore,
        recycleBefore: R.finalRecycleBefore,
        baseOps: effectiveFinalOps(R),
        lo,
        rng: d3.randomLcg(stubSeedFn() * rerollNonceBase
                           + finalRerollNonce * rerollNonceMul
                           + (lo | 0) * 17),
      });
      if (syncOverride) syncOverride(effectiveFinalOps(R), R);
      if (notifyChanged) notifyChanged();
    }

    let lastStep = 0;
    function render(step, snap) {
      const R = getR();
      const ops = effectiveFinalOps(R);
      const totalOps = ops.length;
      const total = totalOps + 2;
      if (step >= total) step = total - 1;
      document.getElementById(prefix + "-cur").textContent = String(step);
      document.getElementById(prefix + "-total").textContent = String(total - 1);
      const labelEl = document.getElementById(prefix + "-stage");
      const descEl = document.getElementById(prefix + "-desc");

      if (totalOps === 0) {
        spokes.snapToState({ byNode: {}, placed: [], just: null, justSeq: 0 });
        labelEl.textContent = "no final-stage activity";
        descEl.innerHTML = '<span class="st">empty</span> &middot; the bg-rewire loop emptied its recycle list, so this stage never fired.';
        lastStep = step;
        return;
      }
      const after = stateAtStep(R, step);
      const byNode = byNodeFromList(after);
      const adjacent = step === lastStep + 1 || step === lastStep - 1;
      if (!adjacent || snap) {
        spokes.snapToState({ byNode, placed: after, just: null, justSeq: step });
      } else {
        const before = stateAtStep(R, lastStep);
        const beforeIds = new Set(before.map(e => e.id));
        const afterIds = new Set(after.map(e => e.id));
        const removes = before.filter(e => !afterIds.has(e.id));
        const adds = after.filter(e => !beforeIds.has(e.id));
        if (removes.length === 0 && adds.length === 0) {
          spokes.snapToState({ byNode, placed: after, just: null, justSeq: step });
        } else if (removes.length > 0 && adds.length === 0) {
          spokes.simplify(removes, () => {}, { byNode });
        } else if (removes.length === 0 && adds.length > 0
                   && lastStep === total - 1 && step === total - 2
                   && spokes.unsimplify) {
          spokes.unsimplify(adds, () => {}, { byNode });
        } else {
          spokes.playMany(removes, adds, () => {}, { byNode });
        }
      }
      lastStep = step;

      const isDropStale = step > totalOps;
      if (step === 0) {
        const recBefore = (R.finalRecycleBefore || []).length;
        labelEl.textContent = "pre-final · " + recBefore + " bad edges in recycle";
        descEl.innerHTML = '<span class="st">pre-final</span> &middot; ' + totalOps +
          " op" + (totalOps === 1 ? "" : "s") + " ahead. Solid red = recycle entries the bg-rewire loop could not resolve.";
      } else if (isDropStale) {
        const dropped = (R.finalResidueLeft || []).length;
        labelEl.textContent = "drop stale · " + dropped + " edge" + (dropped === 1 ? "" : "s") + " dropped";
        descEl.innerHTML = '<span class="st">drop stale</span> &middot; ' +
          "Bad edges that survived every final-stage attempt are dropped from the output. This is the only place in the pipeline where a residue actually leaves the model.";
      } else {
        const op = ops[step - 1];
        const status = (op.keep1 && op.keep2)
          ? "both swap halves placed"
          : (op.keep1 || op.keep2)
            ? "one half placed, the other recycled"
            : "both halves recycled (no progress this op)";
        const recNow = after.filter(e => e.bad).length;
        labelEl.textContent = "op " + step + " / " + totalOps;
        descEl.innerHTML = '<span class="st">op ' + step + '</span> &middot; ' +
          "Pop <code>" + op.p1.join("&ndash;") + "</code> from recycle, draw partner <code>" + op.p2.join("&ndash;") +
          "</code> from the union; place <code>" + op.newp1.join("&ndash;") + "</code> + <code>" + op.newp2.join("&ndash;") +
          "</code>. " + status + ". Recycle now has " + recNow + " entries.";
      }
    }
    function totalForCurrent() {
      return effectiveFinalOps(getR()).length + 2;
    }

    const toEntry = (e) => ({
      u: e.u, v: e.v, id: e.id, bad: !!e.bad,
      color: e.bad ? COL_DROP : pickColor(e.u, e.v),
      badColor: COL_DROP,
    });

    let ctl = NS.rerollWalker({
      prefix,
      total: totalForCurrent(),
      totalForCurrent,
      onRender: render,
      randStepDisabledAt: (idx) => idx >= totalForCurrent() - 1,
      onRandStep: idx => {
        if (idx <= 0) return;
        const R = getR();
        const beforeList = stateAtStep(R, idx);
        const oldOp = effectiveFinalOps(R)[idx - 1];
        replayFinalSwap(idx - 1);
        const newTotal = totalForCurrent();
        if (idx > newTotal - 2) {
          ctl.reconfigureKeep(newTotal, Math.max(0, newTotal - 2));
          return;
        }
        const afterList = stateAtStep(R, idx);
        const labelEl = document.getElementById(prefix + "-stage");
        const descEl = document.getElementById(prefix + "-desc");
        const newOp = effectiveFinalOps(R)[idx - 1];
        if (labelEl && descEl && newOp) {
          const status = (newOp.keep1 && newOp.keep2)
            ? "both swap halves placed"
            : (newOp.keep1 || newOp.keep2)
              ? "one half placed, the other recycled"
              : "both halves recycled (no progress this op)";
          const undoBit = oldOp ? "Undo prior swap, then " : "";
          labelEl.textContent = "op " + idx + " · re-rolled · " + status;
          descEl.innerHTML = '<span class="st">op ' + idx + '</span> &middot; ' +
            undoBit + "pop <code>" + newOp.p1.join("&ndash;") +
            "</code> from recycle, draw partner <code>" + newOp.p2.join("&ndash;") +
            "</code> from the union; place <code>" + newOp.newp1.join("&ndash;") +
            "</code> + <code>" + newOp.newp2.join("&ndash;") + "</code>. " + status + ".";
        }
        const beforeById = new Map(beforeList.map(e => [e.id, e]));
        const afterById = new Map(afterList.map(e => [e.id, e]));
        const removes = [], adds = [];
        beforeById.forEach((be, id) => {
          const ae = afterById.get(id);
          if (!ae) removes.push(toEntry(be));
          else if (ae.u !== be.u || ae.v !== be.v) {
            removes.push(toEntry(be)); adds.push(toEntry(ae));
          }
        });
        afterById.forEach((ae, id) => {
          if (!beforeById.has(id)) adds.push(toEntry(ae));
        });
        viz.clearAllNodeClass("dim");
        viz.clearAllNodeClass("pick");
        const byNode = byNodeFromList(afterList);
        spokes.playMany(removes, adds, () => {}, { byNode });
        lastStep = idx;
        ctl.setTotalIdxSilent(newTotal, idx);
        return NS.SKIP;
      },
      onRandAll: () => {
        replayFinalSwap(0);
        ctl.reconfigureKeep(totalForCurrent(), 0);
      },
    });

    function reconfigReset() {
      lastStep = 0;
      finalSwapOpsOverride = null;
      if (syncOverride) syncOverride(effectiveFinalOps(getR()), getR());
      ctl.reconfigure(totalForCurrent());
      if (notifyChanged) notifyChanged();
    }
    busSubscriptions.forEach(bus => bus.push(reconfigReset));
    reconfigReset();
    return {
      ctl,
      reconfigReset,
      effectiveFinalOps: () => effectiveFinalOps(getR()),
    };
  };

  // mountClusterPairWalker — per-pair cluster spoke walker.
  // cfg fields:
  //   hostId            "g-cpair"
  //   getR              () => realization with clusterPre + clusterStubLayouts
  //   positions         optional positions map
  //   nodeColorOf       (id) => color for node fill + spoke colour
  //   clusterColorOf    (cname) => intra-edge colour
  //   stage2Color, dropColor, mintColor : palette
  //   stubSeedFn        () => integer driving rng seeds
  //   pairOverride      module-scope object the factory mutates per-key
  //   fireClusterPreChanged ()
  //   resetEpoch        ()  (typically `overrideEpoch++` cache buster)
  //   busSubscriptions  array of bus arrays for reTotalReset listener
  //   navBoundariesFn   optional () => [boundary indices]
  //   introDesc         string for step 0
  //   stepDescFn        (cur, j, totalLen) => string for steps > 0
  NS.mountClusterPairWalker = function (cfg) {
    const {
      hostId, getR, positions, nodeColorOf, clusterColorOf,
      stage2Color, dropColor, mintColor,
      stubSeedFn, pairOverride, fireClusterPreChanged, resetEpoch,
      busSubscriptions = [],
      navBoundariesFn,
      introDesc,
      stepDescFn,
    } = cfg;
    const keyOf = NS.keyOf;
    const viz = NS.VIZ.init(hostId + "-cy", {
      showLabels: true, edges: [], pinned: true,
      positions,
      nodeColor: (id) => nodeColorOf(parseInt(id, 10)),
    });
    let lockOverride = false;
    let ctl = null;
    function setRandLock(locked) {
      lockOverride = locked;
      if (ctl) ctl.refreshButtons();
    }
    const spokes = NS.spokeLayer.attach(viz, { onLockChange: setRandLock });
    function totalFromR(R) { return 1 + R.clusterPre.length; }
    let cpairRerollNonce = 0;

    function rollPair(R, idx) {
      let lay = null, l = 0;
      for (const c of R.clusterStubLayouts) {
        if (idx >= c.startInClusterPre && idx < c.startInClusterPre + c.numPairs) {
          lay = c; l = idx - c.startInClusterPre; break;
        }
      }
      if (!lay) return { snap: false };
      const prefix = R.clusterPre.slice(lay.startInClusterPre, lay.startInClusterPre + l);
      cpairRerollNonce += 1;
      const fresh = d3.randomLcg(stubSeedFn() * 8191 + cpairRerollNonce * 41 + idx * 113);
      const newTail = NS.stubPoolReseed({
        layout: lay, prefix, rng: fresh,
        classify: (a, b, ctx) => {
          const loop = (a === b);
          const k = keyOf(a, b);
          const multi = !loop && ctx.localEdges.has(k);
          if (!loop && !multi) ctx.add(k);
          return { u: a, v: b, cluster: lay.cname, loop, multi };
        },
      });
      newTail.forEach((np, i) => { pairOverride[lay.startInClusterPre + l + i] = np; });
      fireClusterPreChanged();
      spokes.markReroll();
      return { snap: false };
    }

    function rollAllPairs() {
      for (const k in pairOverride) delete pairOverride[k];
      cpairRerollNonce += 1;
      const Rfresh = getR();
      Rfresh.clusterStubLayouts.forEach((lay, i) => {
        const fresh = d3.randomLcg(stubSeedFn() * 8191 + cpairRerollNonce * 41 + i * 113);
        const newTail = NS.stubPoolReseed({
          layout: lay, prefix: [], rng: fresh,
          classify: (a, b, ctx) => {
            const loop = (a === b);
            const k = keyOf(a, b);
            const multi = !loop && ctx.localEdges.has(k);
            if (!loop && !multi) ctx.add(k);
            return { u: a, v: b, cluster: lay.cname, loop, multi };
          },
        });
        newTail.forEach((np, i) => { pairOverride[lay.startInClusterPre + i] = np; });
      });
      fireClusterPreChanged();
      spokes.markReroll();
    }

    function render(step, snap) {
      const R = getR();
      const total = 1 + R.clusterPre.length;
      if (step >= total) step = total - 1;
      viz.setEdges([]);
      const cfgByNode = NS.spokeLayer.byNodeFromEdges(viz, R.clusterPre,
        n => nodeColorOf(parseInt(n.id, 10)));
      // Outliers carry zero cluster stubs; defensively zero their counts.
      if (R.outliers) {
        R.outliers.forEach(nid => { if (cfgByNode[nid]) cfgByNode[nid].count = 0; });
      }
      const placed = NS.walkerMarkPlaced(R.clusterPre.slice(0, Math.max(0, step - 1)), {
        idPrefix: "cp-",
        goodColor: (e) => clusterColorOf(e.cluster) || stage2Color,
        badColor: dropColor,
        keyOf,
      });
      let just = null;
      let bridgeColor = mintColor;
      const j = NS.walkerMarkJust(R.clusterPre, step, { keyOf });
      if (j) {
        bridgeColor = clusterColorOf(j.e.cluster) || stage2Color;
        just = {
          u: j.e.u, v: j.e.v, color: bridgeColor, bad: j.bad,
          badColor: j.bad ? dropColor : null,
        };
      }
      NS.snapOrSync(spokes, { byNode: cfgByNode, placed, just, justSeq: step, bridgeColor }, snap);

      const totEl = document.getElementById(hostId + "-total");
      const curEl = document.getElementById(hostId + "-cur");
      if (totEl) totEl.textContent = String(total - 1);
      if (curEl) curEl.textContent = String(step);
      let label, desc;
      if (step === 0) {
        label = "stubs ready";
        desc = introDesc;
      } else {
        const cur = j.e;
        const tag = cur.loop ? " (self-loop)" : (j.bad ? " (parallel)" : "");
        label = "cluster pair " + step + " / " + R.clusterPre.length;
        desc = (stepDescFn ? stepDescFn(cur, j, R.clusterPre.length, tag) :
                "Stubs of <b>" + cur.u + "</b> and <b>" + cur.v + "</b> pair up inside <code>" + cur.cluster + "</code>" + tag + ".");
      }
      document.getElementById(hostId + "-stage").textContent = label;
      const descEl = document.getElementById(hostId + "-desc");
      descEl.innerHTML = '<span class="st">' + label + "</span> &middot; " + desc;
      NS.retypeset(descEl);
    }

    const R0 = getR();
    ctl = NS.rerollWalker({
      prefix: hostId,
      total: totalFromR(R0),
      totalForCurrent: () => totalFromR(getR()),
      getLocked: () => lockOverride,
      onRender: render,
      onRandStep: idx => {
        if (idx <= 0) return false;
        return rollPair(getR(), idx - 1).snap;
      },
      onRandAll: idx => {
        if (idx <= 0) return;
        rollAllPairs();
      },
    });

    function reTotalReset() {
      for (const k in pairOverride) delete pairOverride[k];
      if (resetEpoch) resetEpoch();
      ctl.reconfigure(totalFromR(getR()));
    }
    busSubscriptions.forEach(bus => bus.push(reTotalReset));

    if (navBoundariesFn) {
      attachNav({
        ctl, hostId, prefix: hostId,
        curElId: hostId + "-cur",
        getLocked: () => lockOverride,
        boundariesFn: navBoundariesFn,
      });
    }
    return { ctl, reTotalReset };
  };

  // Shared cluster-nav (‹/› arrows). Identical logic in both abcd and
  // abcd+o; lifted here so factories can wire it without each page
  // redefining it.
  function attachNav(opts) {
    const { ctl, hostId, prefix, getLocked, boundariesFn, curElId } = opts;
    const host = document.getElementById(hostId + "-cy");
    if (!host) return;
    function mkBtn(side, label, aria) {
      const b = document.createElement("button");
      b.className = "cluster-nav cluster-nav-" + side;
      b.id = prefix + "-cluster-" + side;
      b.type = "button";
      b.setAttribute("aria-label", aria);
      b.textContent = label;
      return b;
    }
    const prev = mkBtn("prev", "‹", "previous cluster");
    const next = mkBtn("next", "›", "next cluster");
    host.appendChild(prev);
    host.appendChild(next);
    function refresh() {
      prev.disabled = ctl.idx <= 0;
      next.disabled = ctl.idx >= ctl.total - 1;
    }
    function jump(forward) {
      if (getLocked && getLocked()) return;
      const starts = boundariesFn();
      if (!starts.length) return;
      const cur = ctl.idx;
      let target;
      if (forward) {
        target = starts.find(s => s > cur);
        if (target == null) target = ctl.total - 1;
      } else {
        const earlier = starts.filter(s => s < cur);
        target = earlier.length ? earlier[earlier.length - 1] : 0;
      }
      ctl.set(target);
      refresh();
    }
    prev.addEventListener("click", () => jump(false));
    next.addEventListener("click", () => jump(true));
    const curEl = document.getElementById(curElId);
    if (curEl && typeof MutationObserver !== "undefined") {
      new MutationObserver(refresh).observe(curEl, { childList: true, characterData: true });
    }
    refresh();
  }
  NS.attachClusterNav = attachNav;
})();
