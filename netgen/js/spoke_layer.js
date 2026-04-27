// Stub-spoke + bridge layer for config-model pair-stage visualizations.
// Owned by abcd / abcd+o / lfr cluster + bg pairing stages.
//
// Caller contract: pass the active and prior pairs every render via
// syncState({ byNode, placed, just, justSeq, bridgeColor }):
//   byNode[nid] = { count, color }     // total stubs per node, base spoke colour
//   placed      = [{ u, v, color, id, bad? }, ...]   // pairs already drawn
//   just        = { u, v, color, bad? } | null       // animating pair (u may === v)
//   justSeq     = step index (monotonic)             // used for rewind detection
//   bridgeColor = optional override for the active bridge stroke
// The layer owns every paint of stubs + active bridge + persistent
// pair edges; the caller's viz.setEdges should only carry backdrop
// edges (e.g. faded cluster-post in the bg phase), never pair edges.

window.NETGEN = window.NETGEN || {};
NETGEN.spokeLayer = (function () {
  function shortDelta(a0, a1) {
    let d = a1 - a0;
    while (d > Math.PI)  d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }
  function evenAngles(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push((i / n) * 2 * Math.PI - Math.PI / 2);
    return out;
  }
  function pickClosestIdx(angles, target) {
    let best = 0, bestD = Infinity;
    angles.forEach((a, i) => {
      const d = Math.abs(shortDelta(a, target));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function attach(viz, opts) {
    opts = opts || {};
    const onLockChange = opts.onLockChange || function () {};
    const spokeOuter   = opts.spokeLen != null ? opts.spokeLen : 16;
    const fanCap       = opts.fanCap != null ? opts.fanCap : 14;
    const showCounter  = !!opts.showCounter;

    const onActiveChange = opts.onActiveChange || function () {};
    const onSettle       = opts.onSettle       || function () {};
    let lockTimer = null;
    let animating = false;
    // Default dim + pick: during the active animation, the active u/v
    // get .pick (mint outline), every other node gets .dim. Both
    // classes are stripped on settle so the page reverts to whatever
    // baseline its onSettle callback applies (matcher's deficit-driven
    // dim, etc.). Pages with no baseline pass no onSettle and end up
    // with everything undimmed.
    function applyActiveDimPick(just) {
      viz.clearAllNodeClass("pick");
      viz.clearAllNodeClass("dim");
      if (!just) return;
      viz.eachNode(function (n) {
        if (String(n.id) !== String(just.u) && String(n.id) !== String(just.v)) {
          viz.addNodeClass(n.id, "dim");
        }
      });
      viz.addNodeClass(just.u, "pick");
      if (String(just.u) !== String(just.v)) viz.addNodeClass(just.v, "pick");
    }
    function clearActiveDimPick() {
      viz.clearAllNodeClass("pick");
      viz.clearAllNodeClass("dim");
    }
    function lockFor(ms) {
      const wasAnimating = animating;
      animating = true;
      onLockChange(true);
      if (!wasAnimating) {
        applyActiveDimPick(state.just);
        onActiveChange(true, state.just);
      }
      if (lockTimer) clearTimeout(lockTimer);
      lockTimer = setTimeout(function () {
        lockTimer = null;
        animating = false;
        onLockChange(false);
        clearActiveDimPick();
        onActiveChange(false, null);
        onSettle();
        renderPlaced();
      }, ms);
    }

    // Layer order: placed-edges < bridges < spokes < counter < nodes.
    const placedLayer = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-placed");
    const bridgeLayer = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-bridges");
    const spokeLayer  = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-spokes");
    const countLayer  = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-counter");

    let state = { byNode: {}, placed: [], just: null, justSeq: null, bridgeColor: null };
    let lastKey = "";
    let lastSeq = -1;
    let token = 0;
    let assigned = {};   // nid -> { count, color, angles[], free[], partnerOf[], justIdx?[], justPartner? }

    function nodeR(nid) {
      const node = viz.nodeById[String(nid)];
      return (node && node.r) || 13;
    }
    function lenScale(count) {
      return count > fanCap ? Math.sqrt(fanCap / count) : 1;
    }
    function partnerDir(nid, partnerId) {
      const node = viz.nodeById[String(nid)];
      const partner = viz.nodeById[String(partnerId)];
      if (!node || !partner) return 0;
      return Math.atan2(partner.y - node.y, partner.x - node.x);
    }
    function freeSlots(nid) {
      const a = assigned[nid];
      if (!a) return [];
      const out = [];
      for (let i = 0; i < a.count; i++) if (a.free[i]) out.push(i);
      return out;
    }

    function recompute() {
      assigned = {};
      const byN = state.byNode || {};
      Object.keys(byN).forEach(function (nid) {
        const cfg = byN[nid];
        const count = cfg.count | 0;
        if (count <= 0) { assigned[nid] = null; return; }
        assigned[nid] = {
          count: count,
          color: cfg.color,
          angles: evenAngles(count),
          free: new Array(count).fill(true),
          partnerOf: new Array(count).fill(null),
        };
      });
      // Greedy chronological assignment of placed pairs.
      (state.placed || []).forEach(function (p) { assignPair(p, false); });
      if (state.just) assignPair(state.just, true);
    }

    function assignPair(p, isJust) {
      // Slot overrides: caller may pin slotU / slotV (e.g. SBM picks
      // exact stub indices via kernel trace). When set, skip greedy
      // partner-aim and consume that exact slot.
      if (p.u === p.v) {
        const a = assigned[p.u];
        if (!a) return;
        let i1 = (p.slotU != null && a.free[p.slotU]) ? p.slotU : null;
        let i2 = (p.slotV != null && a.free[p.slotV]) ? p.slotV : null;
        if (i1 == null || i2 == null) {
          const free = freeSlots(p.u);
          if (free.length < 2) return;
          if (i1 == null) i1 = free[0];
          if (i2 == null) i2 = free[Math.min(free.length - 1, Math.floor(free.length / 2))];
          if (i1 === i2) return;
        }
        if (isJust) {
          a.justIdx = [i1, i2]; a.justPartner = p.u;
        } else {
          a.free[i1] = false; a.free[i2] = false;
          a.partnerOf[i1] = p.v; a.partnerOf[i2] = p.u;
          p.slotU = i1; p.slotV = i2;
        }
        return;
      }
      const au = assigned[p.u], av = assigned[p.v];
      if (!au || !av) return;
      let iu = (p.slotU != null && au.free[p.slotU]) ? p.slotU : null;
      let iv = (p.slotV != null && av.free[p.slotV]) ? p.slotV : null;
      if (iu == null || iv == null) {
        const fu = freeSlots(p.u), fv = freeSlots(p.v);
        if (fu.length === 0 || fv.length === 0) return;
        const dirU = partnerDir(p.u, p.v);
        const dirV = partnerDir(p.v, p.u);
        if (iu == null) iu = fu[pickClosestIdx(fu.map(function (i) { return au.angles[i]; }), dirU)];
        if (iv == null) iv = fv[pickClosestIdx(fv.map(function (i) { return av.angles[i]; }), dirV)];
      }
      if (isJust) {
        au.justIdx = [iu]; av.justIdx = [iv];
        au.justPartner = p.v; av.justPartner = p.u;
      } else {
        au.free[iu] = false; av.free[iv] = false;
        au.partnerOf[iu] = p.v; av.partnerOf[iv] = p.u;
        p.slotU = iu; p.slotV = iv;
      }
    }

    function liveAngleForJust(nid) {
      const a = assigned[nid];
      if (!a || !a.justIdx || a.justIdx.length === 0) return null;
      if (state.just && state.just.u === state.just.v) return null;
      return partnerDir(nid, a.justPartner);
    }

    // Effective angle of a slot: rest if free, partner-direction if
    // consumed (so the placed edge runs straight from tip to tip),
    // partner-direction if active-just (so the orbit lands here and
    // the bridge anchors there). Self-loop slots stay at rest since
    // the partner is the node itself.
    function effectiveAngle(nid, slotIdx) {
      const a = assigned[nid];
      if (!a) return 0;
      const restA = a.angles[slotIdx];
      const isJust = a.justIdx && a.justIdx.indexOf(slotIdx) >= 0;
      if (isJust) {
        if (state.just && state.just.u === state.just.v) return restA;
        return partnerDir(nid, a.justPartner);
      }
      const partner = a.partnerOf[slotIdx];
      if (partner != null && String(partner) !== String(nid)) {
        return partnerDir(nid, partner);
      }
      return restA;
    }

    function spokeTip(nid, slotIdx, opt) {
      const node = viz.nodeById[String(nid)];
      const a = assigned[nid];
      if (!node || !a) return null;
      const angle = (opt && opt.angle != null) ? opt.angle : a.angles[slotIdx];
      const r0 = nodeR(nid);
      const r1 = r0 + spokeOuter * lenScale(a.count);
      return {
        x1: node.x + Math.cos(angle) * r0,
        y1: node.y + Math.sin(angle) * r0,
        x2: node.x + Math.cos(angle) * r1,
        y2: node.y + Math.sin(angle) * r1,
        angle: angle, r0: r0, r1: r1,
        nodeX: node.x, nodeY: node.y,
      };
    }

    function syncState(s) {
      const myToken = ++token;
      spokeLayer.selectAll("line.sp-spoke").interrupt();
      bridgeLayer.selectAll("path.sp-bridge").interrupt();
      const newKey = s.just ? (s.just.u + "/" + s.just.v + "@" + (s.justSeq || "")) : "";
      const sameStep = (s.justSeq != null && s.justSeq === lastSeq);
      const isReroll = sameStep && lastKey !== "" && lastKey !== newKey;
      const stepDelta = (s.justSeq != null && lastSeq >= 0) ? (s.justSeq - lastSeq) : 1;
      const wasJump = Math.abs(stepDelta) > 1;
      const isStepBack = (stepDelta === -1) && lastKey !== "";
      const shouldRewind = isReroll || isStepBack;

      if (shouldRewind) {
        const willOrbit = newKey !== "" && !wasJump && !isStepBack;
        lockFor(520 + (willOrbit ? 1500 : 0));
        runRewind(function () {
          if (myToken !== token) return;
          state = s; lastKey = newKey; lastSeq = s.justSeq;
          recompute(); render(willOrbit);
        });
        return;
      }
      state = s;
      const fresh = newKey !== "" && newKey !== lastKey && !wasJump;
      lastKey = newKey; lastSeq = s.justSeq;
      if (fresh) lockFor(1500);
      recompute(); render(fresh);
    }

    function runRewind(done) {
      bridgeLayer.selectAll("path.sp-bridge")
        .interrupt("bridge")
        .transition("rewindBridge").duration(220).attr("opacity", 0);
      spokeLayer.selectAll("line.sp-spoke.just")
        .interrupt("orbit")
        .transition("rewindFade").duration(220).attr("opacity", 0.85);
      setTimeout(done, 240);
    }

    function render(animate) {
      renderSpokes(animate);
      renderPlaced();
      renderBridge(animate);
      renderCounter();
    }

    function renderSpokes(animate) {
      const data = [];
      Object.keys(assigned).forEach(function (nid) {
        const a = assigned[nid];
        if (!a) return;
        for (let i = 0; i < a.count; i++) {
          const isJust = !!(a.justIdx && a.justIdx.indexOf(i) >= 0);
          const isConsumed = !a.free[i] && !isJust;
          data.push({
            id: nid + ":" + i, nid: nid, slot: i,
            color: a.color, isJust: isJust, consumed: isConsumed,
          });
        }
      });
      const sel = spokeLayer.selectAll("line.sp-spoke").data(data, function (d) { return d.id; });
      sel.exit().remove();
      const ent = sel.enter().append("line")
        .attr("class", "sp-spoke")
        .attr("stroke-linecap", "round");
      const merged = ent.merge(sel)
        .attr("class", function (d) {
          return "sp-spoke" + (d.isJust ? " just" : "") + (d.consumed ? " consumed" : "");
        })
        .attr("stroke", function (d) { return d.color; })
        .attr("stroke-width", function (d) { return d.isJust ? 2.8 : 2.4; })
        .attr("opacity", function (d) { return d.isJust ? 1 : (d.consumed ? 0.22 : 0.92); });
      // Snap non-active spokes to their effective angle (rest if free,
      // partner-direction if consumed).
      merged.filter(function (d) { return !d.isJust; }).each(function (d) {
        const t = spokeTip(d.nid, d.slot, { angle: effectiveAngle(d.nid, d.slot) });
        if (!t) return;
        d3.select(this).attr("x1", t.x1).attr("y1", t.y1).attr("x2", t.x2).attr("y2", t.y2);
      });
      // Active spoke: orbit from rest to live-aim, then live tick keeps it.
      const justSel = merged.filter(function (d) { return d.isJust; });
      if (animate) {
        justSel.each(function (d) {
          const a = assigned[d.nid];
          if (!a) return;
          const restA = a.angles[d.slot];
          const liveA = liveAngleForJust(d.nid);
          if (liveA == null) {
            // Self-loop: no orbit; snap rest.
            const t = spokeTip(d.nid, d.slot);
            d3.select(this).attr("x1", t.x1).attr("y1", t.y1).attr("x2", t.x2).attr("y2", t.y2);
            return;
          }
          const r0 = nodeR(d.nid);
          const r1 = r0 + spokeOuter * lenScale(a.count);
          const node = viz.nodeById[String(d.nid)];
          d3.select(this)
            .interrupt("orbit")
            .transition("orbit").duration(700).ease(d3.easeCubicInOut)
            .attrTween("x1", function () { return function (k) { return node.x + Math.cos(restA + shortDelta(restA, liveA) * k) * r0; }; })
            .attrTween("y1", function () { return function (k) { return node.y + Math.sin(restA + shortDelta(restA, liveA) * k) * r0; }; })
            .attrTween("x2", function () { return function (k) { return node.x + Math.cos(restA + shortDelta(restA, liveA) * k) * r1; }; })
            .attrTween("y2", function () { return function (k) { return node.y + Math.sin(restA + shortDelta(restA, liveA) * k) * r1; }; });
        });
      } else {
        justSel.each(function (d) {
          const a = assigned[d.nid];
          let angle = a.angles[d.slot];
          const liveA = liveAngleForJust(d.nid);
          if (liveA != null) angle = liveA;
          const t = spokeTip(d.nid, d.slot, { angle: angle });
          d3.select(this).attr("x1", t.x1).attr("y1", t.y1).attr("x2", t.x2).attr("y2", t.y2);
        });
      }
    }

    function placedPath(d) {
      if (d.u === d.v) {
        if (d.slotU == null || d.slotV == null) return "";
        const e1 = spokeTip(d.u, d.slotU, { angle: effectiveAngle(d.u, d.slotU) });
        const e2 = spokeTip(d.v, d.slotV, { angle: effectiveAngle(d.v, d.slotV) });
        if (!e1 || !e2) return "";
        const node = viz.nodeById[String(d.u)];
        const mx = (e1.x1 + e2.x1) / 2, my = (e1.y1 + e2.y1) / 2;
        const dx = mx - node.x, dy = my - node.y;
        const dist = Math.hypot(dx, dy) || 1;
        const push = nodeR(d.u) * 1.6;
        const cx = mx + (dx / dist) * push, cy = my + (dy / dist) * push;
        return "M" + e1.x1 + "," + e1.y1 + " Q" + cx + "," + cy + " " + e2.x1 + "," + e2.y1;
      }
      if (d.slotU == null || d.slotV == null) return "";
      const eu = spokeTip(d.u, d.slotU, { angle: effectiveAngle(d.u, d.slotU) });
      const ev = spokeTip(d.v, d.slotV, { angle: effectiveAngle(d.v, d.slotV) });
      if (!eu || !ev) return "";
      return "M" + eu.x1 + "," + eu.y1 + " L" + ev.x1 + "," + ev.y1;
    }

    function renderPlaced() {
      // During the active animation, every placed edge whose neither
      // endpoint is in the active pair fades. After the animation
      // settles, all edges restore to full opacity.
      const j = animating && state.just ? state.just : null;
      const sel = placedLayer.selectAll("path.sp-placed-edge").data(state.placed, function (d) { return d.id || (d.u + "-" + d.v); });
      sel.exit().remove();
      const ent = sel.enter().append("path")
        .attr("class", "sp-placed-edge").attr("fill", "none")
        .attr("stroke-linecap", "round").attr("stroke-width", 1.6);
      ent.merge(sel)
        .attr("stroke", function (d) { return d.color; })
        .attr("opacity", function (d) {
          if (!j) return 1;
          const incident = String(d.u) === String(j.u) || String(d.u) === String(j.v)
                        || String(d.v) === String(j.u) || String(d.v) === String(j.v);
          return incident ? 1 : 0.18;
        })
        .attr("d", placedPath);
    }

    function bridgeEndpoint(nid, slotIdx) {
      return spokeTip(nid, slotIdx, { angle: effectiveAngle(nid, slotIdx) });
    }

    function bridgePath(d) {
      if (d.isLoop) {
        const a = assigned[d.u];
        if (!a || !a.justIdx || a.justIdx.length < 2) return "";
        const e1 = bridgeEndpoint(d.u, a.justIdx[0]);
        const e2 = bridgeEndpoint(d.u, a.justIdx[1]);
        if (!e1 || !e2) return "";
        const node = viz.nodeById[String(d.u)];
        const mx = (e1.x1 + e2.x1) / 2, my = (e1.y1 + e2.y1) / 2;
        const dx = mx - node.x, dy = my - node.y;
        const dist = Math.hypot(dx, dy) || 1;
        const push = nodeR(d.u) * 1.6;
        const cx = mx + (dx / dist) * push, cy = my + (dy / dist) * push;
        return "M" + e1.x1 + "," + e1.y1 + " Q" + cx + "," + cy + " " + e2.x1 + "," + e2.y1;
      }
      const au = assigned[d.u], av = assigned[d.v];
      if (!au || !av || !au.justIdx || !av.justIdx) return "";
      const eu = bridgeEndpoint(d.u, au.justIdx[0]);
      const ev = bridgeEndpoint(d.v, av.justIdx[0]);
      if (!eu || !ev) return "";
      return "M" + eu.x1 + "," + eu.y1 + " L" + ev.x1 + "," + ev.y1;
    }

    function renderBridge(animate) {
      const data = [];
      if (state.just) {
        data.push({
          id: "bridge",
          color: state.bridgeColor || state.just.color || "#4e7a3a",
          u: state.just.u, v: state.just.v,
          isLoop: state.just.u === state.just.v,
        });
      }
      const sel = bridgeLayer.selectAll("path.sp-bridge").data(data, function (d) { return d.id; });
      sel.exit().interrupt("bridge").remove();
      const ent = sel.enter().append("path")
        .attr("class", "sp-bridge").attr("fill", "none")
        .attr("stroke-linecap", "round")
        .attr("stroke-dasharray", "4 4")
        .attr("stroke-width", 2.6).attr("opacity", 0);
      const merged = ent.merge(sel)
        .attr("stroke", function (d) { return d.color; })
        .attr("d", bridgePath);
      if (animate) {
        // Bridge shows AFTER the orbit (700ms): dashed in (280ms), then
        // solidify (360ms). Stays solid as the persistent edge — the
        // next syncState will re-key it as a placed edge.
        merged
          .attr("opacity", 0)
          .attr("stroke-dasharray", "4 4")
          .transition("bridge").delay(700).duration(280).attr("opacity", 1)
          .transition("bridge").duration(360).attr("stroke-dasharray", null);
      } else {
        merged.attr("opacity", 1).attr("stroke-dasharray", null);
      }
    }

    function renderCounter() {
      if (!showCounter) {
        countLayer.selectAll("text.sp-count").remove();
        return;
      }
      const data = [];
      Object.keys(assigned).forEach(function (nid) {
        const a = assigned[nid];
        if (!a) return;
        let consumed = 0;
        for (let i = 0; i < a.count; i++) {
          const isJust = a.justIdx && a.justIdx.indexOf(i) >= 0;
          if (!a.free[i] && !isJust) consumed++;
        }
        data.push({ id: nid, consumed: consumed, total: a.count, color: a.color });
      });
      const sel = countLayer.selectAll("text.sp-count").data(data, function (d) { return d.id; });
      sel.exit().remove();
      const ent = sel.enter().append("text")
        .attr("class", "sp-count")
        .attr("text-anchor", "middle")
        .attr("font-size", "9px")
        .attr("font-family", "ui-monospace, SFMono-Regular, Menlo, monospace")
        .attr("pointer-events", "none");
      ent.merge(sel)
        .attr("fill", function (d) { return d.color; })
        .text(function (d) { return d.consumed + "/" + d.total; })
        .each(function (d) {
          const node = viz.nodeById[String(d.id)];
          if (!node) return;
          const a = assigned[d.id];
          const off = nodeR(d.id) + spokeOuter * lenScale(a.count) + 9;
          d3.select(this).attr("x", node.x).attr("y", node.y + off);
        });
    }

    // Tick: live-update spoke / bridge / placed / counter from current
    // node positions. Active spoke recomputes live partner-aim.
    viz.sim.on("tick.spokeLayer", function () {
      spokeLayer.selectAll("line.sp-spoke").each(function (d) {
        const a = assigned[d.nid];
        if (!a) return;
        const trans = d3.active(this, "orbit") || d3.active(this, "rewindFade");
        if (trans) return;
        const t = spokeTip(d.nid, d.slot, { angle: effectiveAngle(d.nid, d.slot) });
        if (!t) return;
        d3.select(this).attr("x1", t.x1).attr("y1", t.y1).attr("x2", t.x2).attr("y2", t.y2);
      });
      placedLayer.selectAll("path.sp-placed-edge").attr("d", placedPath);
      bridgeLayer.selectAll("path.sp-bridge").each(function (d) {
        if (d3.active(this, "bridge") || d3.active(this, "rewindBridge")) return;
        d3.select(this).attr("d", bridgePath(d));
      });
      countLayer.selectAll("text.sp-count").each(function (d) {
        const node = viz.nodeById[String(d.id)];
        const a = assigned[d.id];
        if (!node || !a) return;
        const off = nodeR(d.id) + spokeOuter * lenScale(a.count) + 9;
        d3.select(this).attr("x", node.x).attr("y", node.y + off);
      });
    });

    return {
      syncState: syncState,
      rerender: function () { recompute(); render(false); },
      isAnimating: function () { return animating; },
    };
  }

  return { attach: attach };
})();
