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
})();
