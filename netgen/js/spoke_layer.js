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
    return Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
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
    // Animation phase durations (ms). Caller may override any of these
    // via opts.timings.<key>. Total active-pair animation lasts
    // orbit + bridgeFadeIn + bridgeSolid + fan. The fan phase runs
    // both the existing parallels and the new bridge to their
    // with-just slots simultaneously, after the bridge has fully
    // solidified.
    const T = Object.assign({
      orbit:        165,   // active spoke rotates from rest to partner
      bridgeFadeIn: 105,   // dashed bridge fades in (collinear)
      bridgeSolid:  105,   // dashed → solid (still collinear)
      justFade:     120,   // active just-spoke fades out before the fan
      fan:          210,   // every parallel + bridge fans into its slot
      rewindBridge: 120,   // step-back: bridge fades out
      rewindFade:   120,   // step-back: just-spoke fades back
      rewindIdle:   135,   // step-back: settle delay before re-animate
    }, opts.timings || {});
    function t_bridgeStart() { return T.orbit; }
    function t_justFade()    { return T.orbit + T.bridgeFadeIn + T.bridgeSolid; }
    function t_fan()         { return t_justFade() + T.justFade; }
    function t_total()       { return t_fan() + T.fan; }

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
      viz.clearAllNodeClass("dim");
      if (!just) return;
      // Dim every node except the active pair. The dim alone is
      // enough; no pick outline is added.
      viz.eachNode(function (n) {
        if (String(n.id) !== String(just.u) && String(n.id) !== String(just.v)) {
          viz.addNodeClass(n.id, "dim");
        }
      });
    }
    function clearActiveDimPick() {
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
        // Animation done: restore placed-edge opacity (they were dimmed
        // while the bridge was front-and-centre).
        renderPlaced();
        // Bad-pair recolor: bridge stroked the cluster colour all
        // through the animation; on settle, fade to the caller's
        // badColor so the user sees "the pair landed, but it is a
        // collision".
        if (state.just && state.just.bad && state.just.badColor) {
          bridgeLayer.selectAll("path.sp-bridge")
            .transition("badStroke").duration(T.fan).ease(d3.easeCubicInOut)
            .attr("stroke", state.just.badColor);
        }
        onSettle();
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
    let dupInfo = {};    // pairKey -> { total, idx[] } for fanning parallel placed edges
    function pairKey(u, v) { return String(u) < String(v) ? u + "|" + v : v + "|" + u; }

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

    let dupInfoNoJust = {};
    // Two fan flags drive the placed / bridge `d` interpretation across
    // the animation phases. Flipping them mid-animation + transitioning
    // d on the affected layer produces the staged fan-out: existing
    // parallels step aside before the bridge appears, then the bridge
    // slides into its slot once it has solidified.
    let placedFanCollapsed = false;   // true → render placed at the no-just layout
    let bridgeCollinear    = false;   // true → render bridge as straight line, no fan
    let phaseTimers        = [];
    function clearPhaseTimers() {
      phaseTimers.forEach(function (id) { clearTimeout(id); });
      phaseTimers = [];
    }
    function schedulePhase(ms, fn) {
      phaseTimers.push(setTimeout(fn, ms));
    }
    function recompute() {
      assigned = {};
      dupInfo = {};
      dupInfoNoJust = {};
      const placed = state.placed || [];
      const justKey = state.just ? pairKey(state.just.u, state.just.v) : null;
      placed.forEach(function (p) {
        const k = pairKey(p.u, p.v);
        if (!dupInfo[k]) dupInfo[k] = { total: 0 };
        p._dupIdx = dupInfo[k].total;
        dupInfo[k].total += 1;
      });
      // Snapshot the no-just fan layout: same indices, count without
      // the active just. Used while the animation is running so the
      // existing parallels do not jump aside before the new bridge
      // settles.
      Object.keys(dupInfo).forEach(function (k) {
        dupInfoNoJust[k] = { total: dupInfo[k].total };
      });
      if (justKey) {
        if (!dupInfo[justKey]) dupInfo[justKey] = { total: 0 };
        state.just._dupIdx = dupInfo[justKey].total;
        dupInfo[justKey].total += 1;
      }
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
          // Slot pairing for a self-loop. Prefer a slot in the same
          // half as each loop tangent: cos(a) <= 0 = left half goes
          // with LOOP_TANGENT_START, cos(a) > 0 = right half goes
          // with LOOP_TANGENT_END. This keeps each orbit on its own
          // side instead of swinging across the node. Falls back to
          // any free slot when one half is empty.
          const leftSlots  = free.filter(function (i) { return Math.cos(a.angles[i]) <= 0; });
          const rightSlots = free.filter(function (i) { return Math.cos(a.angles[i]) >  0; });
          if (i1 == null) {
            const pool = leftSlots.length ? leftSlots : free;
            i1 = pool[pickClosestIdx(pool.map(function (i) { return a.angles[i]; }), LOOP_TANGENT_START)];
          }
          if (i2 == null) {
            const remaining = free.filter(function (i) { return i !== i1; });
            const rightRemain = remaining.filter(function (i) { return Math.cos(a.angles[i]) > 0; });
            const pool = rightRemain.length ? rightRemain : remaining;
            i2 = pool[pickClosestIdx(pool.map(function (i) { return a.angles[i]; }), LOOP_TANGENT_END)];
          }
          if (i1 === i2) return;
        }
        if (isJust) {
          a.justIdx = [i1, i2]; a.justPartner = p.u;
        } else {
          a.free[i1] = false; a.free[i2] = false;
          a.partnerOf[i1] = p.v; a.partnerOf[i2] = p.u;
          a.consumedLoopSide = a.consumedLoopSide || {};
          a.consumedLoopSide[i1] = 0;
          a.consumedLoopSide[i2] = 1;
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

    // Self-loop tear-drop. Two quadratic halves from node to apex,
    // each with a control at (±OFFX, -OFFY) relative to the node
    // centre. apex y = -OFFY so both halves' tangents at the apex
    // are horizontal — they meet without a kink. OFFX widens the
    // bulge, OFFY raises the top.
    const LOOP_OFFX = 1.1;
    const LOOP_OFFY = 2.0;
    const LOOP_TANGENT_START = Math.atan2(-LOOP_OFFY, -LOOP_OFFX);
    const LOOP_TANGENT_END   = Math.atan2(-LOOP_OFFY,  LOOP_OFFX);

    // Effective angle of a slot: rest if free, partner-direction if
    // consumed / active-just, loop-tangent if the active pair is a
    // self-loop. Consumed self-loop slots also stay at the loop
    // tangent so the placed-loop arc grows out of them.
    function effectiveAngle(nid, slotIdx) {
      const a = assigned[nid];
      if (!a) return 0;
      const restA = a.angles[slotIdx];
      const isJust = a.justIdx && a.justIdx.indexOf(slotIdx) >= 0;
      if (isJust) {
        if (state.just && state.just.u === state.just.v) {
          const which = a.justIdx.indexOf(slotIdx);
          return which === 0 ? LOOP_TANGENT_START : LOOP_TANGENT_END;
        }
        return partnerDir(nid, a.justPartner);
      }
      const partner = a.partnerOf[slotIdx];
      if (partner != null && String(partner) !== String(nid)) {
        return partnerDir(nid, partner);
      }
      // Consumed self-loop slot: pin to the loop's tangent direction.
      // partnerOf was set to the node itself by assignPair, so we
      // recover "which side" via the consumedLoopSide map.
      if (partner != null && a.consumedLoopSide && a.consumedLoopSide[slotIdx] != null) {
        return a.consumedLoopSide[slotIdx] === 0 ? LOOP_TANGENT_START : LOOP_TANGENT_END;
      }
      return restA;
    }

    // Self-loop just-spokes use a shorter outer length so the bridge
    // half — which curves outward almost immediately — covers them as
    // it grows.
    const SELF_LOOP_SPOKE_LEN = 5;
    function spokeOuterFor(nid, slotIdx) {
      const a = assigned[nid];
      const isJust = a && a.justIdx && a.justIdx.indexOf(slotIdx) >= 0;
      if (isJust && state.just && state.just.u === state.just.v) return SELF_LOOP_SPOKE_LEN;
      return spokeOuter;
    }
    function spokeTip(nid, slotIdx, opt) {
      const node = viz.nodeById[String(nid)];
      const a = assigned[nid];
      if (!node || !a) return null;
      const angle = (opt && opt.angle != null) ? opt.angle : a.angles[slotIdx];
      const r0 = nodeR(nid);
      const r1 = r0 + spokeOuterFor(nid, slotIdx) * lenScale(a.count);
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
      spokeLayer.selectAll("line.sp-spoke").interrupt("orbit");
      spokeLayer.selectAll("line.sp-spoke").interrupt("rewindFade");
      spokeLayer.selectAll("line.sp-spoke").interrupt("justFade");
      bridgeLayer.selectAll("path.sp-bridge").interrupt();
      bridgeLayer.selectAll("path.sp-bridge").interrupt("bridge");
      bridgeLayer.selectAll("path.sp-bridge").interrupt("bridgeFan");
      bridgeLayer.selectAll("path.sp-bridge").interrupt("rewindBridge");
      bridgeLayer.selectAll("path.sp-bridge").interrupt("badStroke");
      placedLayer.selectAll("path.sp-placed-edge").interrupt("fan");
      const newKey = s.just ? (s.just.u + "/" + s.just.v + "@" + (s.justSeq || "")) : "";
      const sameStep = (s.justSeq != null && s.justSeq === lastSeq);
      const isReroll = sameStep && lastKey !== "" && lastKey !== newKey;
      const stepDelta = (s.justSeq != null && lastSeq >= 0) ? (s.justSeq - lastSeq) : 1;
      const wasJump = Math.abs(stepDelta) > 1;
      const isStepBack = (stepDelta === -1) && lastKey !== "";
      const shouldRewind = isReroll || isStepBack;

      if (shouldRewind) {
        const willOrbit = newKey !== "" && !wasJump && !isStepBack;
        lockFor(T.rewindIdle + (willOrbit ? t_total() : 0));
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
      if (fresh) lockFor(t_total());
      recompute(); render(fresh);
    }

    function runRewind(done) {
      bridgeLayer.selectAll("path.sp-bridge")
        .interrupt("bridge")
        .transition("rewindBridge").duration(T.rewindBridge).attr("opacity", 0);
      spokeLayer.selectAll("line.sp-spoke.just")
        .interrupt("orbit")
        .transition("rewindFade").duration(T.rewindFade).attr("opacity", 0.85);
      setTimeout(done, T.rewindIdle);
    }

    function render(animate) {
      clearPhaseTimers();
      // Animate path: orbit → placed fan-out → bridge fade-in
      // collinear → solidify → bridge fans into its slot. Phase
      // durations live in the T constant. Non-animate path: jump
      // straight to the with-just layout, no transitions.
      const isSelfLoop = state.just && state.just.u === state.just.v;
      if (animate) {
        placedFanCollapsed = true;
        bridgeCollinear = true;
        renderSpokes(true);
        renderPlaced();         // existing parallels stay collinear under the bridge
        renderBridge(true);     // bridge fades in collinear over the parallel
        renderCounter();
        // Just-spoke fades out before the fan. It has been pointing at
        // the node-to-node line; clearing it first prevents the lag
        // when the bridge curves away.
        if (isSelfLoop) {
          // Self-loop: spoke orbits to its tangent during the orbit
          // phase, then fades while the bridge half grows out of the
          // same point. The two together read as the spoke extending
          // outward into the loop arc.
          schedulePhase(t_bridgeStart(), function () {
            spokeLayer.selectAll("line.sp-spoke.just")
              .transition("justFade").duration(T.bridgeFadeIn).ease(d3.easeCubicInOut)
              .attr("opacity", 0);
          });
        } else {
          schedulePhase(t_justFade(), function () {
            spokeLayer.selectAll("line.sp-spoke.just")
              .transition("justFade").duration(T.justFade).ease(d3.easeCubicInOut)
              .attr("opacity", 0);
          });
        }
        // Fan: existing parallels + new bridge slide outward into their
        // with-just slots together, after the just-spoke is gone. The
        // self-loop branch has no fan — its two halves already landed
        // at the apex during the bridge phase.
        schedulePhase(t_fan(), function () {
          placedFanCollapsed = false;
          bridgeCollinear = false;
          placedLayer.selectAll("path.sp-placed-edge")
            .transition("fan").duration(T.fan).ease(d3.easeCubicInOut)
            .attr("d", placedPath);
          if (!isSelfLoop) {
            bridgeLayer.selectAll("path.sp-bridge")
              .transition("bridgeFan").duration(T.fan).ease(d3.easeCubicInOut)
              .attr("d", bridgePath);
          }
        });
      } else {
        placedFanCollapsed = false;
        bridgeCollinear = false;
        renderSpokes(false);
        renderPlaced();
        renderBridge(false);
        renderCounter();
        // Jump render lands in the post-settle state, so a bad just
        // shows the badColor stroke immediately rather than the
        // mid-animation cluster colour.
        if (state.just && state.just.bad && state.just.badColor) {
          bridgeLayer.selectAll("path.sp-bridge").attr("stroke", state.just.badColor);
        }
      }
    }

    function renderSpokes(animate) {
      // Consumed slots are represented by the placed edge itself; the
      // stub graphic would just trail the edge once it fans into a
      // curve. Render only free + active-just spokes.
      const data = [];
      Object.keys(assigned).forEach(function (nid) {
        const a = assigned[nid];
        if (!a) return;
        for (let i = 0; i < a.count; i++) {
          const isJust = !!(a.justIdx && a.justIdx.indexOf(i) >= 0);
          const isConsumed = !a.free[i] && !isJust;
          if (isConsumed) continue;
          data.push({
            id: nid + ":" + i, nid: nid, slot: i,
            color: a.color, isJust: isJust, consumed: false,
          });
        }
      });
      const sel = spokeLayer.selectAll("line.sp-spoke").data(data, function (d) { return d.id; });
      sel.exit().remove();
      const ent = sel.enter().append("line")
        .attr("class", "sp-spoke")
        .attr("stroke-linecap", "round");
      const bridgeStroke = state.bridgeColor || (state.just && state.just.color) || null;
      const merged = ent.merge(sel)
        .attr("class", function (d) {
          return "sp-spoke" + (d.isJust ? " just" : "") + (d.consumed ? " consumed" : "");
        })
        .attr("stroke", function (d) { return d.isJust && bridgeStroke ? bridgeStroke : d.color; })
        .attr("stroke-width", function (d) { return d.isJust ? 2.6 : 2.4; })
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
      if (!animate) {
        // Jump render: settled state = bridge already fanned, the
        // active just-spoke would be a leftover stub pointing at the
        // node-to-node line. Hide it.
        justSel.attr("opacity", 0);
      }
      if (animate) {
        justSel.each(function (d) {
          const a = assigned[d.nid];
          if (!a) return;
          const restA = a.angles[d.slot];
          const liveA = effectiveAngle(d.nid, d.slot);
          if (liveA == null || Math.abs(shortDelta(restA, liveA)) < 1e-3) {
            const t = spokeTip(d.nid, d.slot, { angle: liveA != null ? liveA : restA });
            d3.select(this).attr("x1", t.x1).attr("y1", t.y1).attr("x2", t.x2).attr("y2", t.y2);
            return;
          }
          const r0 = nodeR(d.nid);
          const r1 = r0 + spokeOuterFor(d.nid, d.slot) * lenScale(a.count);
          const node = viz.nodeById[String(d.nid)];
          d3.select(this)
            .interrupt("orbit")
            .transition("orbit").duration(T.orbit).ease(d3.easeCubicInOut)
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

    // Quadratic-bezier fan. p1 / p2 are node centres; r1 / r2 are
    // their radii. The Q control sits perpendicular to the centre
    // line by an offset chosen from dupIdx / dupTotal. Endpoints
    // shift outward from centre along the tangent direction (centre
    // → control) by the node radius so the visible curve starts at
    // the node boundary instead of the centre, keeping the inside
    // of the circle clean even when the node is dimmed.
    function fanPath(p1, p2, dupIdx, dupTotal, r1, r2) {
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const centered = dupTotal <= 1 ? 0 : (dupIdx - (dupTotal - 1) / 2);
      const spread = Math.max(22, Math.min(42, len * 0.18));
      const mx = (p1.x + p2.x) / 2 + nx * centered * spread * 2;
      const my = (p1.y + p2.y) / 2 + ny * centered * spread * 2;
      const dxs = mx - p1.x, dys = my - p1.y;
      const ds = Math.hypot(dxs, dys) || 1;
      const sx = p1.x + (dxs / ds) * (r1 || 0);
      const sy = p1.y + (dys / ds) * (r1 || 0);
      const dxe = mx - p2.x, dye = my - p2.y;
      const de = Math.hypot(dxe, dye) || 1;
      const ex = p2.x + (dxe / de) * (r2 || 0);
      const ey = p2.y + (dye / de) * (r2 || 0);
      return "M" + sx + "," + sy + " Q" + mx + "," + my + " " + ex + "," + ey;
    }

    function placedPath(d) {
      const nu = viz.nodeById[String(d.u)];
      const nv = viz.nodeById[String(d.v)];
      if (!nu || !nv) return "";
      if (d.u === d.v) {
        // Combined two-halves path so the placed shape matches the
        // bridge halves the animation lands on (no morph at commit).
        return loopHalfPath(d, -1) + " " + loopHalfPath(d, +1);
      }
      // Canonical orientation by node id: parallels stored as (u,v)
      // and (v,u) need the same perpendicular axis so dupIdx maps to
      // opposite sides instead of stacking on one.
      const swap = String(d.u) > String(d.v);
      const a = swap ? nv : nu, b = swap ? nu : nv;
      const ra = swap ? nodeR(d.v) : nodeR(d.u), rb = swap ? nodeR(d.u) : nodeR(d.v);
      const k = pairKey(d.u, d.v);
      const grp = (placedFanCollapsed ? dupInfoNoJust[k] : dupInfo[k]) || { total: 1 };
      const idx = d._dupIdx != null ? d._dupIdx : 0;
      return fanPath({ x: a.x, y: a.y }, { x: b.x, y: b.y }, idx, grp.total, ra, rb);
    }

    function renderPlaced() {
      // During the active animation, every placed edge dims so the
      // new bridge stands alone. After the animation settles, all
      // restore to full opacity.
      const dim = animating && !!state.just;
      const sel = placedLayer.selectAll("path.sp-placed-edge").data(state.placed, function (d) { return d.id || (d.u + "-" + d.v); });
      sel.exit().remove();
      const ent = sel.enter().append("path")
        .attr("class", "sp-placed-edge").attr("fill", "none")
        .attr("stroke-linecap", "round").attr("stroke-width", 1.6);
      ent.merge(sel)
        .attr("stroke", function (d) { return d.color; })
        .attr("opacity", dim ? 0.18 : 1)
        .attr("d", placedPath);
    }

    function bridgeEndpoint(nid, slotIdx) {
      return spokeTip(nid, slotIdx, { angle: effectiveAngle(nid, slotIdx) });
    }

    function loopApex(d) {
      const nu = viz.nodeById[String(d.u)];
      const r = nodeR(d.u) + 8;
      // Apex sits at the same y as the two side controls. With this
      // alignment, each half's tangent at the apex is horizontal, so
      // the two halves meet without a kink.
      return { x: nu.x, y: nu.y - r * LOOP_OFFY };
    }
    function loopHalfPath(d, side) {
      const nu = viz.nodeById[String(d.u)];
      const r = nodeR(d.u) + 8;
      const apex = loopApex(d);
      const cx = nu.x + side * r * LOOP_OFFX;
      const cy = nu.y - r * LOOP_OFFY;
      return "M" + nu.x + "," + nu.y + " Q" + cx + "," + cy + " " + apex.x + "," + apex.y;
    }
    function bridgePath(d) {
      const nu = viz.nodeById[String(d.u)];
      const nv = viz.nodeById[String(d.v)];
      if (!nu || !nv) return "";
      if (d.isLoop) {
        const r = nodeR(d.u) + 8;
        const x = nu.x, y = nu.y;
        return "M" + x + "," + y + " C" + (x - r * LOOP_OFFX) + "," + (y - r * LOOP_OFFY)
             + " " + (x + r * LOOP_OFFX) + "," + (y - r * LOOP_OFFY) + " " + (x + 0.01) + "," + (y - 0.01);
      }
      const swap = String(d.u) > String(d.v);
      const a = swap ? nv : nu, b = swap ? nu : nv;
      const ra = swap ? nodeR(d.v) : nodeR(d.u), rb = swap ? nodeR(d.u) : nodeR(d.v);
      if (bridgeCollinear) {
        return fanPath({ x: a.x, y: a.y }, { x: b.x, y: b.y }, 0, 1, ra, rb);
      }
      const k = pairKey(d.u, d.v);
      const grp = dupInfo[k] || { total: 1 };
      const idx = state.just && state.just._dupIdx != null ? state.just._dupIdx : (grp.total - 1);
      return fanPath({ x: a.x, y: a.y }, { x: b.x, y: b.y }, idx, grp.total, ra, rb);
    }

    function renderBridge(animate) {
      const data = [];
      if (state.just) {
        const isLoop = state.just.u === state.just.v;
        const color = state.bridgeColor || state.just.color || "#4e7a3a";
        if (isLoop) {
          data.push({ id: "bridgeL", color, u: state.just.u, v: state.just.v, isLoop: true, side: -1 });
          data.push({ id: "bridgeR", color, u: state.just.u, v: state.just.v, isLoop: true, side: +1 });
        } else {
          data.push({ id: "bridge", color, u: state.just.u, v: state.just.v, isLoop: false });
        }
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
        .attr("d", function (d) { return d.isLoop ? loopHalfPath(d, d.side) : bridgePath(d); });
      if (animate) {
        merged.each(function (d) {
          const sel = d3.select(this);
          if (d.isLoop) {
            // Each half "grows" outward from the node toward the apex
            // via stroke-dashoffset. Two halves meet in the middle.
            const len = this.getTotalLength ? this.getTotalLength() : 100;
            sel
              .attr("opacity", 1)
              .attr("stroke-dasharray", len + " " + len)
              .attr("stroke-dashoffset", len)
              .transition("bridge").delay(t_bridgeStart())
              .duration(T.bridgeFadeIn + T.bridgeSolid)
              .ease(d3.easeCubicOut)
              .attr("stroke-dashoffset", 0);
          } else {
            sel
              .attr("opacity", 0)
              .attr("stroke-dasharray", "4 4")
              .transition("bridge").delay(t_bridgeStart()).duration(T.bridgeFadeIn).attr("opacity", 1)
              .transition("bridge").duration(T.bridgeSolid).attr("stroke-dasharray", null);
          }
        });
      } else {
        merged.each(function (d) {
          const sel = d3.select(this);
          if (d.isLoop) {
            const len = this.getTotalLength ? this.getTotalLength() : 100;
            sel.attr("opacity", 1).attr("stroke-dasharray", len + " " + len).attr("stroke-dashoffset", 0);
          } else {
            sel.attr("opacity", 1).attr("stroke-dasharray", null);
          }
        });
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
        const trans = d3.active(this, "orbit") || d3.active(this, "rewindFade") || d3.active(this, "justFade");
        if (trans) return;
        const t = spokeTip(d.nid, d.slot, { angle: effectiveAngle(d.nid, d.slot) });
        if (!t) return;
        d3.select(this).attr("x1", t.x1).attr("y1", t.y1).attr("x2", t.x2).attr("y2", t.y2);
      });
      placedLayer.selectAll("path.sp-placed-edge").each(function (d) {
        if (d3.active(this, "fan")) return;
        d3.select(this).attr("d", placedPath(d));
      });
      bridgeLayer.selectAll("path.sp-bridge").each(function (d) {
        if (d3.active(this, "bridge") || d3.active(this, "rewindBridge") || d3.active(this, "bridgeFan")) return;
        d3.select(this).attr("d", d.isLoop ? loopHalfPath(d, d.side) : bridgePath(d));
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
