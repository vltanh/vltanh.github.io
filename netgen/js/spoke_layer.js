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
    // via opts.timings.<key>.
    // Forward sequence: orbit → grow → fan → colorize.
    //   orbit    : spoke rotates rest → partner-aim, in build colour.
    //   grow     : dashed bridge draws inward from each spoke tip,
    //              meeting at midpoint. Just-spoke fades out during
    //              the last portion of this phase (handoff: spoke tip
    //              becomes the leading edge of the growing stub).
    //   fan      : parallels make room, bridge slides to its slot.
    //              No-op for non-parallel.
    //   colorize : dashed-black → settled appearance. Non-bad goes to
    //              solid cluster / inter colour. Bad stays dashed and
    //              goes red.
    // Step-back mirrors this in reverse:
    //   uncolor  : settled → dashed-black (runs first, while still
    //              dimmed).
    //   fan-in   : bridge un-fans, placed parallels collapse to
    //              collinear.
    //   retract  : bridge stubs shrink back into the node centres,
    //              just-spoke fades in during the last portion (the
    //              stubs hand off to the spoke tip as they shrink).
    //   orbit    : spoke rotates partner-aim → rest.
    const T = Object.assign({
      orbit:        260,
      bridgeGrow:   280,
      justFade:     180,   // duration of the just-spoke crossfade with grow / retract
      fan:          480,
      colorize:     280,
      spokeRetract: 200,   // self-loop only: spoke length shrinks from r0+spokeOuter to r0 between orbit and grow
      rewindUncolor:280,
      rewindFanIn:  480,
      rewindBridge: 280,
      rewindOrbit:  260,
      rewindIdle:   40,
    }, opts.timings || {});
    // Build-phase colour: bridge + just-spoke wear this from orbit
    // through fan. Colorize crossfades to the type colour. Override
    // via opts.buildColor if a page wants a different "in flight"
    // shade.
    const buildColor = opts.buildColor || "#1b2033";
    // Orbit duration scales linearly with angular distance so the
    // visible angular speed stays roughly constant. baseDuration is
    // calibrated for a π/2 swing (≈ partner-to-rest typical case);
    // tighter swings (parallel-second-pick where the closest slot is
    // already gone) get less time, wider swings get more, capped to
    // keep the animation snappy at both extremes.
    function scaleOrbitDuration(baseDuration, delta) {
      const ref = Math.PI / 2;
      const frac = Math.min(1.5, Math.max(0.35, Math.abs(delta) / ref));
      return Math.round(baseDuration * frac);
    }
    // Buffer between the longest just-spoke orbit and the bridge
    // start so the spoke has visibly settled at partner-aim before
    // the bridge stub takes over.
    const ORBIT_BRIDGE_BUFFER = 60;
    // Per-render value: the longest orbit (in ms) among the active
    // just-spokes plus ORBIT_BRIDGE_BUFFER. Updated before lockFor /
    // render(true) by computeBridgeStartMs. Default falls back to
    // T.orbit for jump-renders / non-just states.
    let bridgeStartMs = T.orbit;
    function computeBridgeStartMs() {
      let maxOrbit = 0;
      Object.keys(assigned).forEach(function (nid) {
        const a = assigned[nid];
        if (!a || !a.justIdx) return;
        a.justIdx.forEach(function (slot) {
          const restA = a.angles[slot];
          const liveA = effectiveAngle(nid, slot);
          if (liveA == null) return;
          const delta = shortDelta(restA, liveA);
          if (Math.abs(delta) < 1e-3) return;
          const ms = scaleOrbitDuration(T.orbit, delta);
          if (ms > maxOrbit) maxOrbit = ms;
        });
      });
      return (maxOrbit > 0 ? maxOrbit : T.orbit) + ORBIT_BRIDGE_BUFFER;
    }
    function isSelfLoopJust() { return !!(state.just && state.just.u === state.just.v); }
    function t_bridgeStart() { return bridgeStartMs; }
    // For self-loops the four phases are: orbit → spoke retract →
    // bridge grow → colorize. Non-loop has no spoke retract and adds
    // a fan phase between grow and colorize.
    function t_growStart()   { return t_bridgeStart() + (isSelfLoopJust() ? T.spokeRetract : 0); }
    function t_growEnd()     { return t_growStart() + T.bridgeGrow; }
    function t_justFade()    { return Math.max(t_growStart(), t_growEnd() - T.justFade); }
    function t_fan()         { return t_growEnd(); }
    function t_colorize()    { return t_fan() + (isSelfLoopJust() ? 0 : T.fan); }
    function t_total()       { return t_colorize() + T.colorize; }

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
        // while the bridge was front-and-centre). Type-colour recolour
        // (cluster blue / bad red) is handled by the colorize phase
        // BEFORE this lockTimer fires, so the un-dim runs after the
        // bridge already wears its final colour.
        renderPlaced();
        onSettle();
      }, ms);
    }

    // Layer order: placed-edges < bridges < spokes < counter < nodes.
    const placedLayer = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-placed");
    const bridgeLayer = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-bridges");
    const spokeLayer  = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-spokes");
    const countLayer  = viz.svg.insert("g", "g.viz-nodes").attr("class", "sp-counter");
    // Defensive: any code that re-appends g.viz-nodes (e.g. a viz
    // refresh) would push it back into the middle of the children
    // and break paint order. Re-assert "all spoke layers before
    // viz-nodes" once at attach time and after every render.
    function ensureLayerOrder() {
      const svgEl = viz.svg.node();
      const vizNodes = viz.svg.select("g.viz-nodes").node();
      if (!vizNodes || !svgEl) return;
      [placedLayer, bridgeLayer, spokeLayer, countLayer].forEach(function (layer) {
        const node = layer.node();
        if (node && node.parentNode === svgEl && node.nextSibling !== vizNodes) {
          svgEl.insertBefore(node, vizNodes);
        }
      });
    }
    ensureLayerOrder();

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

    // Self-loop primitives live in NETGEN.EdgePaths; this layer paints
    // each half of the teardrop independently so the placed-loop arc
    // can grow out of one stub while the other half stays inert.
    const EP = NETGEN.EdgePaths;
    const LOOP_OFFX         = EP.LOOP_OFFX;
    const LOOP_OFFY         = EP.LOOP_OFFY;
    const LOOP_TANGENT_START = EP.LOOP_TANGENT_START;
    const LOOP_TANGENT_END   = EP.LOOP_TANGENT_END;

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
      bridgeLayer.selectAll("path.sp-bridge").interrupt("colorize");
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
        const rewindTotal = T.rewindUncolor + T.rewindFanIn + T.rewindBridge + T.rewindOrbit + T.rewindIdle;
        lockFor(rewindTotal + (willOrbit ? t_total() : 0));
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
      recompute();
      if (fresh) {
        bridgeStartMs = computeBridgeStartMs();
        lockFor(t_total());
      }
      render(fresh);
    }

    function runRewind(done) {
      // Reverse-play the forward animation in four phases:
      //   1. uncolor    (T.rewindUncolor): settled bridge crossfades
      //                                    back to dashed build-black.
      //                                    Mirror of the forward
      //                                    colorize step that ran
      //                                    last.
      //   2. fan-in     (T.rewindFanIn):   bridge un-fans from its
      //                                    slot back to collinear,
      //                                    placed parallels collapse
      //                                    out of their fanned slots,
      //                                    just-spoke fades back in.
      //   3. bridge     (T.rewindBridge):  collinear bridge retracts
      //                                    into the node centres.
      //   4. orbit      (T.rewindOrbit):   active just-spoke orbits
      //                                    from partner / loop tangent
      //                                    back to rest.
      bridgeLayer.selectAll("path.sp-bridge")
        .interrupt("bridge").interrupt("bridgeFan").interrupt("colorize");
      // Phase 1 · uncolor. Settled bridge crossfades back to the
      // build appearance: build-black stroke at active thickness.
      // Build is SOLID (forward grow uses an all-zero-gap dash
      // pattern, never visibly dashed); a settled bad bridge that's
      // currently "4 4" dashed is flipped to solid synchronously at
      // uncolor start so reverse mirrors forward — no dashed period
      // on Back that doesn't exist on Next.
      bridgeLayer.selectAll("path.sp-bridge")
        .attr("stroke-dasharray", null)
        .transition("colorize").duration(T.rewindUncolor).ease(d3.easeCubicInOut)
        .attr("stroke", buildColor)
        .attr("stroke-width", 2.6);
      // Dim placed edges so the active bridge stays the focus, mirror
      // of forward where renderPlaced sees animating=true and applies
      // opacity 0.18. lockTimer's renderPlaced() will restore them at
      // settle.
      placedLayer.selectAll("path.sp-placed-edge").attr("opacity", 0.18);
      schedulePhase(T.rewindUncolor, function () { runRewindFanIn(done); });
    }

    function runRewindFanIn(done) {
      // Just-spokes stay invisible through fan-in; they fade back in
      // during the first portion of the retract phase (mirror of the
      // forward justFade at the END of grow).
      spokeLayer.selectAll("line.sp-spoke.just")
        .interrupt("justFade")
        .attr("opacity", 0)
        .attr("stroke", buildColor);
      // Reverse fan-in is the time-mirror of forward fan: tween from
      // the with-just (fanT=1) layout back to no-just (fanT=0). Same
      // attrTween reasoning as forward — chord-cut + tick-race.
      placedLayer.selectAll("path.sp-placed-edge")
        .interrupt("fan")
        .transition("fan").duration(T.rewindFanIn).ease(d3.easeCubicInOut)
        .attrTween("d", function (d) {
          const f = placedPathTween(d);
          return function (k) { return f(1 - k); };
        })
        .on("end.fanFlag", function () { placedFanCollapsed = true; });
      const isSelfLoop = state.just && state.just.u === state.just.v;
      if (!isSelfLoop) {
        bridgeLayer.selectAll("path.sp-bridge")
          .transition("bridgeFan").duration(T.rewindFanIn).ease(d3.easeCubicInOut)
          .attrTween("d", function (d) {
            const f = bridgePathTween(d);
            return function (k) { return f(1 - k); };
          })
          .on("end.fanFlag", function () { bridgeCollinear = true; });
      } else {
        bridgeCollinear = true;
      }
      placedFanCollapsed = false; // tween starts from with-just layout
      bridgeCollinear    = false;
      schedulePhase(T.rewindFanIn, function () { runRewindRetract(done); });
    }

    function runRewindRetract(done) {
      // Just-spokes fade in during the first portion of retract —
      // mirror of forward grow's justFade-out at the end. Spokes
      // appear right as the bridge starts shrinking; the visual is
      // "stub shrinks back into the spoke tip".
      spokeLayer.selectAll("line.sp-spoke.just")
        .interrupt("justFade")
        .transition("justFade").duration(T.justFade).ease(d3.easeCubicInOut)
        .attr("opacity", 1);
      bridgeLayer.selectAll("path.sp-bridge").each(function (d) {
        const len = (this.getTotalLength && this.getTotalLength()) || 100;
        const sel = d3.select(this);
        if (d.isLoop) {
          // Self-loop half: retract the dashoffset to full length so
          // the bridge fully shrinks toward the node.
          sel
            .attr("stroke-dasharray", len + " " + len)
            .attr("stroke-dashoffset", 0)
            .transition("rewindBridge").duration(T.rewindBridge).ease(d3.easeCubicIn)
            .attr("stroke-dashoffset", len);
        } else {
          // Two-way retract: dasharray "stub gap stub" with stub
          // shrinking from L/2 to 0 so the bridge fully disappears at
          // each node. The just-spoke beneath remains visible and
          // takes over the visual.
          const halfLen = len / 2;
          // 4-value pattern (even count) so SVG doesn't auto-double the
          // 3-value form into "stub 0 stub stub 0 stub" — that doubling
          // injects a `stub`-wide GAP at length 2*stub which clips the
          // far end of the path once it stretches past straight_len
          // (e.g. once the bridge curves into its fan slot).
          sel
            .attr("stroke-dashoffset", 0)
            .attr("stroke-dasharray", halfLen + " 0 " + halfLen + " 0")
            .transition("rewindBridge").duration(T.rewindBridge).ease(d3.easeCubicIn)
            .attrTween("stroke-dasharray", function () {
              return function (k) {
                const stub = halfLen * (1 - k);
                const gap  = len - 2 * stub;
                return stub + " " + gap + " " + stub + " 0";
              };
            });
        }
      });
      // After the bridge has fully retracted, orbit each just-spoke
      // back from its current effective angle to the slot's rest
      // angle. Visibility was restored at the top of runRewind.
      setTimeout(function () {
        // First pass: capture (restA, fromA) for every just-spoke. We
        // defer clearing justIdx until each spoke's orbit transition
        // ends (.on("end")) — clearing it pre-orbit risks a one-frame
        // gap between the synchronous clear and the transition's first
        // rAF in which tick.spokeLayer reads effectiveAngle as restA
        // (slot looks free), snaps the spoke to rest, then the
        // transition starts from fromA again, snapping it back. The
        // visible artifact is a quick rest → partner-aim → orbit to
        // rest stutter at orbit-start.
        const orbits = [];
        spokeLayer.selectAll("line.sp-spoke.just").each(function (d) {
          const a = assigned[d.nid];
          if (!a) return;
          orbits.push({
            el: this,
            d: d,
            a: a,
            restA: a.angles[d.slot],
            fromA: effectiveAngle(d.nid, d.slot),
          });
        });
        function clearJust(info) {
          const a = info.a;
          if (!a.justIdx) return;
          a.justIdx = a.justIdx.filter(function (i) { return i !== info.d.slot; });
          if (a.justIdx.length === 0) { a.justIdx = null; a.justPartner = null; }
        }
        orbits.forEach(function (info) {
          const { el, d, a, restA, fromA } = info;
          if (fromA == null || Math.abs(shortDelta(fromA, restA)) < 1e-3) {
            clearJust(info);
            return;
          }
          const node = viz.nodeById[String(d.nid)];
          const r0 = nodeR(d.nid);
          const r1 = r0 + spokeOuterFor(d.nid, d.slot) * lenScale(a.count);
          const delta = shortDelta(fromA, restA);
          const orbitMs = scaleOrbitDuration(T.rewindOrbit, delta);
          d3.select(el)
            .interrupt("orbit")
            .transition("orbit").duration(orbitMs).ease(d3.easeCubicInOut)
            .attrTween("x1", function () { return function (k) { return node.x + Math.cos(fromA + delta * k) * r0; }; })
            .attrTween("y1", function () { return function (k) { return node.y + Math.sin(fromA + delta * k) * r0; }; })
            .attrTween("x2", function () { return function (k) { return node.x + Math.cos(fromA + delta * k) * r1; }; })
            .attrTween("y2", function () { return function (k) { return node.y + Math.sin(fromA + delta * k) * r1; }; })
            .on("end", function () { clearJust(info); });
        });
      }, T.rewindBridge);
      setTimeout(done, T.rewindBridge + T.rewindOrbit + T.rewindIdle);
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
        // bridgeStartMs was already computed by syncState before
        // lockFor — phase delays below honour the actual longest
        // just-spoke orbit so the bridge stub never starts forming
        // before the spoke has settled at partner-aim.
        renderSpokes(true);
        renderPlaced();         // existing parallels stay collinear under the bridge
        renderBridge(true);     // bridge stubs grow inward from each spoke tip
        renderCounter();
        if (isSelfLoop) {
          // Self-loop sequence: orbit → spoke retract → grow →
          // colorize. Spoke shrinks length-to-zero between orbit and
          // grow; bridge halves then emerge from the node centre to
          // tell the loop story on their own.
          schedulePhase(t_bridgeStart(), function () {
            spokeLayer.selectAll("line.sp-spoke.just").each(function () {
              const sel = d3.select(this);
              const x1 = +sel.attr("x1");
              const y1 = +sel.attr("y1");
              sel.interrupt("justFade")
                .transition("justFade").duration(T.spokeRetract).ease(d3.easeCubicIn)
                .attr("x2", x1).attr("y2", y1)
                .attr("opacity", 0);
            });
          });
          // No fan for self-loop. Mark the layout flags as resolved
          // immediately so tick / subsequent renders don't think a
          // fan is pending.
          schedulePhase(t_growEnd(), function () {
            placedFanCollapsed = false;
            bridgeCollinear = false;
          });
        } else {
          // Just-spoke fades out during the last portion of grow, so
          // the bridge stubs visually take over from the spoke tips
          // (handoff: tip → growing stub).
          schedulePhase(t_justFade(), function () {
            spokeLayer.selectAll("line.sp-spoke.just")
              .transition("justFade").duration(T.justFade).ease(d3.easeCubicInOut)
              .attr("opacity", 0);
          });
          // Fan: parallels + bridge slide into their with-just slots.
          // attrTween (rather than plain .attr) so the perpendicular
          // fan offset interpolates as a real arc — string-interp on
          // d would cut a chord through the node — and so a tick-race
          // can't snap d to the fanned value before the transition's
          // first frame.
          schedulePhase(t_fan(), function () {
            placedLayer.selectAll("path.sp-placed-edge")
              .transition("fan").duration(T.fan).ease(d3.easeCubicInOut)
              .attrTween("d", function (d) { return placedPathTween(d); })
              .on("end.fanFlag", function () { placedFanCollapsed = false; });
            bridgeLayer.selectAll("path.sp-bridge")
              .transition("bridgeFan").duration(T.fan).ease(d3.easeCubicInOut)
              .attrTween("d", function (d) { return bridgePathTween(d); })
              .on("end.fanFlag", function () { bridgeCollinear = false; });
          });
        }
        // Colorize: bridge has fanned to its slot in build-colour
        // (dashed black). Now crossfade to the settled appearance:
        //   non-bad → solid + cluster colour
        //   bad     → still dashed + bad colour (red)
        // Runs before the lockTimer fires (so before the un-dim) by
        // virtue of t_total() = t_colorize() + T.colorize.
        schedulePhase(t_colorize(), function () {
          const j = state.just;
          if (!j) return;
          const finalColor = (j.bad && j.badColor) ? j.badColor
                            : (state.bridgeColor || j.color);
          const finalDash = j.bad ? "4 4" : null;
          const sel = bridgeLayer.selectAll("path.sp-bridge");
          sel.transition("colorize").duration(T.colorize).ease(d3.easeCubicInOut)
            .attr("stroke", finalColor)
            .attr("stroke-dasharray", finalDash)
            .attr("stroke-width", 1.6);
        });
      } else {
        placedFanCollapsed = false;
        bridgeCollinear = false;
        renderSpokes(false);
        renderPlaced();
        renderBridge(false);
        renderCounter();
        // Jump-render bridge appearance is handled inside renderBridge:
        // bad → dashed + bad colour, non-bad → solid + cluster colour.
      }
      ensureLayerOrder();
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
      // Just-spokes wear the build colour during animate=true (they
      // belong to the bridge that's being built / un-built). On a
      // jump render they're hidden anyway, so colour doesn't matter.
      const justStroke = animate ? buildColor : (state.bridgeColor || (state.just && state.just.color) || buildColor);
      const merged = ent.merge(sel)
        .attr("class", function (d) {
          return "sp-spoke" + (d.isJust ? " just" : "") + (d.consumed ? " consumed" : "");
        })
        .attr("stroke", function (d) { return d.isJust ? justStroke : d.color; })
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
          // Constant angular velocity: T.orbit covers a π/2 swing;
          // scale duration by the actual angular distance so a tiny
          // hop doesn't over-and-back the same easing curve and a
          // large swing doesn't whip past at the same total duration.
          const delta = shortDelta(restA, liveA);
          const orbitMs = scaleOrbitDuration(T.orbit, delta);
          d3.select(this)
            .interrupt("orbit")
            .transition("orbit").duration(orbitMs).ease(d3.easeCubicInOut)
            .attrTween("x1", function () { return function (k) { return node.x + Math.cos(restA + delta * k) * r0; }; })
            .attrTween("y1", function () { return function (k) { return node.y + Math.sin(restA + delta * k) * r0; }; })
            .attrTween("x2", function () { return function (k) { return node.x + Math.cos(restA + delta * k) * r1; }; })
            .attrTween("y2", function () { return function (k) { return node.y + Math.sin(restA + delta * k) * r1; }; });
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
    // dupTotal <= 1 ⇒ collinear straight, dupIdx ignored.
    const fanPath = EP.makeParallelEdge;
    // Same as fanPath but takes the perpendicular fan offset directly,
    // so callers can interpolate `centered` smoothly during the fan
    // animation (each tween-step recomputes endpoints from the current
    // Q-control direction → endpoints stay on the node boundary,
    // instead of cutting a chord through the node).
    const fanPathCentered = EP.makeParallelEdgeCentered;

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

    // For a non-loop placed edge: returns a function (fanT) → path d
    // that linearly interpolates the perpendicular fan offset between
    // the no-just layout (fanT=0) and the with-just layout (fanT=1).
    // Used by the fan transition's attrTween so endpoints stay on the
    // node boundary throughout (string interpolation cuts a chord).
    function placedPathTween(d) {
      if (d.u === d.v) {
        const fixed = placedPath(d);
        return function () { return fixed; };
      }
      const nu = viz.nodeById[String(d.u)];
      const nv = viz.nodeById[String(d.v)];
      if (!nu || !nv) return function () { return ""; };
      const swap = String(d.u) > String(d.v);
      const a = swap ? nv : nu, b = swap ? nu : nv;
      const ra = swap ? nodeR(d.v) : nodeR(d.u), rb = swap ? nodeR(d.u) : nodeR(d.v);
      const k = pairKey(d.u, d.v);
      const grpNoJust = dupInfoNoJust[k] || { total: 1 };
      const grpWithJust = dupInfo[k] || { total: 1 };
      const idx = d._dupIdx != null ? d._dupIdx : 0;
      const cFrom = grpNoJust.total <= 1 ? 0 : (idx - (grpNoJust.total - 1) / 2);
      const cTo   = grpWithJust.total <= 1 ? 0 : (idx - (grpWithJust.total - 1) / 2);
      const ax = a.x, ay = a.y, bx = b.x, by = b.y;
      return function (k) {
        const c = cFrom + (cTo - cFrom) * k;
        return fanPathCentered({ x: ax, y: ay }, { x: bx, y: by }, c, ra, rb);
      };
    }
    function bridgePathTween(d) {
      if (d.isLoop) {
        const fixed = loopHalfPath(d, d.side);
        return function () { return fixed; };
      }
      const nu = viz.nodeById[String(d.u)];
      const nv = viz.nodeById[String(d.v)];
      if (!nu || !nv) return function () { return ""; };
      const swap = String(d.u) > String(d.v);
      const a = swap ? nv : nu, b = swap ? nu : nv;
      const ra = swap ? nodeR(d.v) : nodeR(d.u), rb = swap ? nodeR(d.u) : nodeR(d.v);
      const k = pairKey(d.u, d.v);
      const grp = dupInfo[k] || { total: 1 };
      const targetIdx = state.just && state.just._dupIdx != null ? state.just._dupIdx : (grp.total - 1);
      // From: collinear (centered=0). To: target slot in the with-just
      // fan (centered = idx - (total-1)/2).
      const cTo = grp.total <= 1 ? 0 : (targetIdx - (grp.total - 1) / 2);
      const ax = a.x, ay = a.y, bx = b.x, by = b.y;
      return function (k) {
        const c = cTo * k;
        return fanPathCentered({ x: ax, y: ay }, { x: bx, y: by }, c, ra, rb);
      };
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
        .attr("stroke-dasharray", function (d) { return d.bad ? "4 4" : null; })
        .attr("opacity", dim ? 0.18 : 1)
        .attr("d", placedPath);
    }

    function bridgeEndpoint(nid, slotIdx) {
      return spokeTip(nid, slotIdx, { angle: effectiveAngle(nid, slotIdx) });
    }

    function loopApex(d) {
      const nu = viz.nodeById[String(d.u)];
      return EP.loopApex(nu, nodeR(d.u));
    }
    function loopHalfPath(d, side) {
      const nu = viz.nodeById[String(d.u)];
      return EP.makeSelfLoopHalf(nu, nodeR(d.u), side);
    }
    function bridgePath(d) {
      const nu = viz.nodeById[String(d.u)];
      const nv = viz.nodeById[String(d.v)];
      if (!nu || !nv) return "";
      if (d.isLoop) return EP.makeSelfLoop(nu, nodeR(d.u));
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
        const j = state.just;
        const isLoop = j.u === j.v;
        const settledColor = state.bridgeColor || j.color || "#4e7a3a";
        const settledBad = !!j.bad;
        const buildStroke = animate ? buildColor : ((settledBad && j.badColor) ? j.badColor : settledColor);
        // During animate=true, the bridge is born in build colour
        // (dashed black). The colorize phase later swaps it to the
        // settled colour (cluster solid for non-bad, bad-red dashed
        // for collisions). For animate=false (jump-render), skip the
        // build phase and paint the settled appearance directly.
        const baseRow = { color: buildStroke, finalColor: (settledBad && j.badColor) ? j.badColor : settledColor, bad: settledBad, u: j.u, v: j.v };
        if (isLoop) {
          data.push(Object.assign({ id: "bridgeL", isLoop: true, side: -1 }, baseRow));
          data.push(Object.assign({ id: "bridgeR", isLoop: true, side: +1 }, baseRow));
        } else {
          data.push(Object.assign({ id: "bridge", isLoop: false }, baseRow));
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
        // Reset to build-phase thickness — a persistent bridge from
        // a prior step settled to 1.6, but a new build cycle wants
        // 2.6 throughout grow / fan, dropping to 1.6 only at colorize.
        merged.attr("stroke-width", 2.6);
        merged.each(function (d) {
          const sel = d3.select(this);
          if (d.isLoop) {
            // Self-loop half: each half grows outward from the node
            // toward the apex via stroke-dashoffset.
            const len = this.getTotalLength ? this.getTotalLength() : 100;
            sel
              .attr("opacity", 1)
              .attr("stroke-dasharray", len + " " + len)
              .attr("stroke-dashoffset", len)
              .transition("bridge").delay(t_growStart())
              .duration(T.bridgeGrow)
              .ease(d3.easeCubicOut)
              .attr("stroke-dashoffset", 0);
          } else {
            // Straight bridge: stubs draw inward from each spoke tip,
            // meeting at midpoint. Reverse of retract — dasharray
            // "0 len 0" (nothing drawn) → "halfLen 0 halfLen" (full
            // path drawn from both ends).
            const len = this.getTotalLength ? this.getTotalLength() : 100;
            const halfLen = len / 2;
            // 4-value pattern (see retract for why) keeps the path
            // fully stroked even after fan stretches it past
            // straight_len; with a 3-value pattern SVG auto-doubles
            // and injects a gap that clips the far end.
            sel
              .attr("opacity", 1)
              .attr("stroke-dashoffset", 0)
              .attr("stroke-dasharray", "0 " + len + " 0 0")
              .transition("bridge").delay(t_growStart())
              .duration(T.bridgeGrow).ease(d3.easeCubicOut)
              .attrTween("stroke-dasharray", function () {
                return function (k) {
                  const stub = halfLen * k;
                  const gap  = len - 2 * stub;
                  return stub + " " + gap + " " + stub + " 0";
                };
              });
          }
        });
      } else {
        merged.each(function (d) {
          const sel = d3.select(this);
          if (d.isLoop) {
            const len = this.getTotalLength ? this.getTotalLength() : 100;
            sel.attr("opacity", 1)
              .attr("stroke-dasharray", d.bad ? "4 4" : (len + " " + len))
              .attr("stroke-dashoffset", 0)
              .attr("stroke-width", 1.6);
          } else {
            sel.attr("opacity", 1)
              .attr("stroke-dasharray", d.bad ? "4 4" : null)
              .attr("stroke-width", 1.6);
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

    // Bypass-animation update: kill any in-flight transition, swap
    // state, jump-render. For reroll buttons (random-step, random-all)
    // where running the full rewind + forward pipeline reads as
    // "going back then re-doing the step" instead of a quick re-spin
    // of the dice. Caller is responsible for passing the new state
    // object exactly as syncState expects.
    function snapToState(s) {
      const myToken = ++token;
      spokeLayer.selectAll("line.sp-spoke").interrupt();
      spokeLayer.selectAll("line.sp-spoke").interrupt("orbit");
      spokeLayer.selectAll("line.sp-spoke").interrupt("justFade");
      bridgeLayer.selectAll("path.sp-bridge").interrupt();
      bridgeLayer.selectAll("path.sp-bridge").interrupt("bridge");
      bridgeLayer.selectAll("path.sp-bridge").interrupt("bridgeFan");
      bridgeLayer.selectAll("path.sp-bridge").interrupt("rewindBridge");
      bridgeLayer.selectAll("path.sp-bridge").interrupt("colorize");
      placedLayer.selectAll("path.sp-placed-edge").interrupt("fan");
      clearPhaseTimers();
      if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
      animating = false;
      onLockChange(false);
      clearActiveDimPick();
      onActiveChange(false, null);
      state = s;
      lastKey = s.just ? (s.just.u + "/" + s.just.v + "@" + (s.justSeq || "")) : "";
      lastSeq = s.justSeq;
      recompute();
      render(false);
      // myToken used to keep interface symmetric with syncState; no
      // pending callbacks reference it, but bumping ensures any
      // late-firing rewind callback from a prior run no-ops.
      void myToken;
    }
    return {
      syncState: syncState,
      snapToState: snapToState,
      rerender: function () { recompute(); render(false); },
      isAnimating: function () { return animating; },
    };
  }

  return { attach: attach };
})();
