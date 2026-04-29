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
        if (!a || !a.justSlots) return;
        a.justSlots.forEach(function (jsEntry) {
          const restA = a.angles[jsEntry.slot];
          const liveA = effectiveAngle(nid, jsEntry.slot);
          if (liveA == null) return;
          const delta = shortDelta(restA, liveA);
          if (Math.abs(delta) < 1e-3) return;
          const ms = scaleOrbitDuration(T.orbit, delta);
          if (ms > maxOrbit) maxOrbit = ms;
        });
      });
      return (maxOrbit > 0 ? maxOrbit : T.orbit) + ORBIT_BRIDGE_BUFFER;
    }
    // All-loops only: the spoke-retract phase (between orbit and grow)
    // is exclusive to self-loops and has no fan phase. With multiple
    // justs in flight (e.g. rewire's 2 places), we go through the
    // non-loop sequence (orbit → grow → fan → colorize) unless EVERY
    // just is a self-loop.
    function isSelfLoopJust() {
      const js = justList();
      return js.length > 0 && js.every(function (j) { return j.u === j.v; });
    }
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
    function applyActiveDimPick(justs) {
      viz.clearAllNodeClass("dim");
      const list = Array.isArray(justs) ? justs : (justs ? [justs] : []);
      if (!list.length) return;
      const active = new Set();
      list.forEach(function (j) { active.add(String(j.u)); active.add(String(j.v)); });
      // Dim every node except active endpoints. Dim alone; no pick
      // outline is added.
      viz.eachNode(function (n) {
        if (!active.has(String(n.id))) viz.addNodeClass(n.id, "dim");
      });
    }
    function clearActiveDimPick() {
      viz.clearAllNodeClass("dim");
    }
    function lockFor(ms, dimOverride) {
      const wasAnimating = animating;
      animating = true;
      onLockChange(true);
      if (!wasAnimating) {
        const dimList = dimOverride !== undefined ? dimOverride : state.justs;
        applyActiveDimPick(dimList);
        onActiveChange(true, firstJust());
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

    let state = { byNode: {}, placed: [], justs: [], justSeq: null, bridgeColor: null };
    function justList() { return state.justs || []; }
    function firstJust() { const js = justList(); return js.length ? js[0] : null; }
    function hasJust() { return justList().length > 0; }
    // Interrupt every named transition that may be in flight on the
    // spoke / bridge / placed selections. Called at the top of any
    // entry point that mutates state (syncState / snapToState /
    // playMany) so a half-finished animation never leaks attribute
    // setters into the new render.
    function interruptAll() {
      const sp = spokeLayer.selectAll("line.sp-spoke");
      sp.interrupt();
      sp.interrupt("orbit");
      sp.interrupt("rewindFade");
      sp.interrupt("justFade");
      const br = bridgeLayer.selectAll("path.sp-bridge");
      br.interrupt();
      br.interrupt("bridge");
      br.interrupt("bridgeFan");
      br.interrupt("rewindBridge");
      br.interrupt("colorize");
      placedLayer.selectAll("path.sp-placed-edge").interrupt("fan");
    }
    let lastKey = "";
    let lastSeq = -1;
    let token = 0;
    // markReroll() sets this; the next syncState consumes it and forces
    // the rewind+forward path even if newKey === lastKey (which happens
    // on any reroll that re-derives the same (u, v) — common for self-
    // loops where (a, a) is order-symmetric).
    let pendingReroll = false;
    let assigned = {};   // nid -> { count, color, angles[], free[], partnerOf[], justSlots: [{slot, partner, isLoop, loopSide?, edgeId}] }
    function slotAvailable(a, slot) {
      if (!a || !a.free[slot]) return false;
      if (a.justSlots && a.justSlots.some(function (js) { return js.slot === slot; })) return false;
      return true;
    }
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
      for (let i = 0; i < a.count; i++) {
        if (!a.free[i]) continue;
        if (a.justSlots && a.justSlots.some(function (js) { return js.slot === i; })) continue;
        out.push(i);
      }
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
      const justs = justList();
      // dupInfoNoJust = the fan layout without active justs (existing
      // parallels stay collinear while the bridge animates); dupInfo
      // includes the justs and is the layout the bridge fans into.
      placed.forEach(function (p) {
        const k = pairKey(p.u, p.v);
        if (!dupInfo[k]) { dupInfo[k] = { total: 0 }; dupInfoNoJust[k] = { total: 0 }; }
        p._dupIdx = dupInfo[k].total;
        dupInfo[k].total += 1;
        dupInfoNoJust[k].total += 1;
      });
      justs.forEach(function (j) {
        const k = pairKey(j.u, j.v);
        if (!dupInfo[k]) dupInfo[k] = { total: 0 };
        j._dupIdx = dupInfo[k].total;
        dupInfo[k].total += 1;
      });
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
          justSlots: [],
        };
      });
      // Greedy chronological assignment of placed pairs.
      (state.placed || []).forEach(function (p) { assignPair(p, false); });
      justs.forEach(function (j) { assignPair(j, true); });
    }

    function assignPair(p, isJust) {
      // Slot overrides: caller may pin slotU / slotV (e.g. SBM picks
      // exact stub indices via kernel trace). When set, skip greedy
      // partner-aim and consume that exact slot.
      const edgeId = p.id || (p.u + ":" + p.v);
      if (p.u === p.v) {
        const a = assigned[p.u];
        if (!a) return;
        let i1 = (p.slotU != null && slotAvailable(a, p.slotU)) ? p.slotU : null;
        let i2 = (p.slotV != null && slotAvailable(a, p.slotV)) ? p.slotV : null;
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
          a.justSlots.push({ slot: i1, partner: p.u, isLoop: true, loopSide: 0, edgeId: edgeId });
          a.justSlots.push({ slot: i2, partner: p.u, isLoop: true, loopSide: 1, edgeId: edgeId });
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
      let iu = (p.slotU != null && slotAvailable(au, p.slotU)) ? p.slotU : null;
      let iv = (p.slotV != null && slotAvailable(av, p.slotV)) ? p.slotV : null;
      if (iu == null || iv == null) {
        const fu = freeSlots(p.u), fv = freeSlots(p.v);
        if (fu.length === 0 || fv.length === 0) return;
        const dirU = partnerDir(p.u, p.v);
        const dirV = partnerDir(p.v, p.u);
        if (iu == null) iu = fu[pickClosestIdx(fu.map(function (i) { return au.angles[i]; }), dirU)];
        if (iv == null) iv = fv[pickClosestIdx(fv.map(function (i) { return av.angles[i]; }), dirV)];
      }
      if (isJust) {
        au.justSlots.push({ slot: iu, partner: p.v, isLoop: false, edgeId: edgeId });
        av.justSlots.push({ slot: iv, partner: p.u, isLoop: false, edgeId: edgeId });
      } else {
        au.free[iu] = false; av.free[iv] = false;
        au.partnerOf[iu] = p.v; av.partnerOf[iv] = p.u;
        p.slotU = iu; p.slotV = iv;
      }
    }

    // Self-loop primitives live in NETGEN.EdgePaths; this layer paints
    // each half of the teardrop independently so the placed-loop arc
    // can grow out of one stub while the other half stays inert.
    const EP = NETGEN.EdgePaths;
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
      const jsEntry = a.justSlots && a.justSlots.find(function (js) { return js.slot === slotIdx; });
      if (jsEntry) {
        if (jsEntry.isLoop) {
          return jsEntry.loopSide === 0 ? LOOP_TANGENT_START : LOOP_TANGENT_END;
        }
        return partnerDir(nid, jsEntry.partner);
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
      if (a && a.justSlots) {
        const js = a.justSlots.find(function (e) { return e.slot === slotIdx; });
        if (js && js.isLoop) return SELF_LOOP_SPOKE_LEN;
      }
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

    function normalizeJusts(s) {
      // Accept either s.justs (array, multi-just) or s.just (singular,
      // back-compat for cluster-pairing / SBM / matcher). Returns a
      // fresh array; assigns synthetic ids when caller didn't provide
      // one (multi-just renderBridge keys by edgeId).
      let list;
      if (s.justs) list = s.justs.slice();
      else if (s.just) list = [s.just];
      else list = [];
      list.forEach(function (j, i) {
        if (j.id == null) j.id = "j" + i + "_" + j.u + "_" + j.v;
      });
      return list;
    }
    function justsKey(list, justSeq) {
      if (!list.length) return "";
      return list.map(function (j) { return j.u + "/" + j.v; }).join("|") + "@" + (justSeq || "");
    }
    function syncState(s) {
      const myToken = ++token;
      interruptAll();
      const justsIn = normalizeJusts(s);
      const newKey = justsKey(justsIn, s.justSeq);
      const sameStep = (s.justSeq != null && s.justSeq === lastSeq);
      const forceReroll = pendingReroll;
      pendingReroll = false;
      const isReroll = forceReroll || (sameStep && lastKey !== "" && lastKey !== newKey);
      const stepDelta = (s.justSeq != null && lastSeq >= 0) ? (s.justSeq - lastSeq) : 1;
      const wasJump = Math.abs(stepDelta) > 1;
      const isStepBack = (stepDelta === -1) && lastKey !== "";
      const shouldRewind = isReroll || isStepBack;
      const sNorm = Object.assign({}, s, { justs: justsIn });

      if (shouldRewind) {
        const willOrbit = newKey !== "" && !wasJump && !isStepBack;
        const rewindTotal = T.rewindUncolor + T.rewindFanIn + T.rewindBridge + T.rewindOrbit + T.rewindIdle;
        lockFor(rewindTotal + (willOrbit ? t_total() : 0));
        runRewind(function () {
          if (myToken !== token) return;
          state = sNorm; lastKey = newKey; lastSeq = s.justSeq;
          recompute(); render(willOrbit);
        });
        return;
      }
      state = sNorm;
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
      const isSelfLoop = isSelfLoopJust();
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
        NETGEN.BridgeAnim.retract(d3.select(this), {
          isLoop: d.isLoop,
          duration: T.rewindBridge,
          transitionName: "rewindBridge",
        });
      });
      // After the bridge has fully retracted, orbit each just-spoke
      // back from its current effective angle to the slot's rest
      // angle. Visibility was restored at the top of runRewind.
      setTimeout(function () {
        // First pass: capture (restA, fromA) for every just-spoke. We
        // defer clearing each justSlots entry until that spoke's orbit
        // transition ends (.on("end")) — clearing it pre-orbit risks a
        // one-frame gap between the synchronous clear and the
        // transition's first rAF in which tick.spokeLayer reads
        // effectiveAngle as restA (slot looks free), snaps the spoke
        // to rest, then the transition starts from fromA again,
        // snapping it back. The visible artifact is a quick
        // rest → partner-aim → orbit to rest stutter at orbit-start.
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
          if (!a.justSlots) return;
          a.justSlots = a.justSlots.filter(function (e) { return e.slot !== info.d.slot; });
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
      const isSelfLoop = isSelfLoopJust();
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
          if (!hasJust()) return;
          // Per-bridge colorize: each bridge data row carries its own
          // finalColor + bad flag, so multi-just renders settle each
          // bridge independently (e.g. one cluster-blue + one bad-red
          // when a rewire produces a parallel collision).
          bridgeLayer.selectAll("path.sp-bridge").each(function (d) {
            NETGEN.BridgeAnim.colorize(d3.select(this), {
              duration: T.colorize,
              color: d.finalColor || d.color,
              bad: !!d.bad,
            });
          });
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
          const isJust = !!(a.justSlots && a.justSlots.some(function (js) { return js.slot === i; }));
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
      const j0 = firstJust();
      const justStroke = animate ? buildColor : (state.bridgeColor || (j0 && j0.color) || buildColor);
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
          const angle = effectiveAngle(d.nid, d.slot);
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
      const targetIdx = d._dupIdx != null ? d._dupIdx : (grp.total - 1);
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
      const dim = animating && hasJust();
      const sel = placedLayer.selectAll("path.sp-placed-edge").data(state.placed, function (d) { return d.id || (d.u + "-" + d.v); });
      sel.exit().remove();
      const ent = sel.enter().append("path")
        .attr("class", "sp-placed-edge").attr("fill", "none")
        .attr("stroke-linecap", "round").attr("stroke-width", 1.6);
      ent.merge(sel)
        .attr("stroke", function (d) { return d.color; })
        .attr("stroke-width", 1.6)
        // Bad placed edges paint solid red. Dashed-red is reserved for
        // the dedup animation (see playDedup): solid → dashed → fade.
        .attr("stroke-dasharray", null)
        .attr("opacity", dim ? 0.18 : 1)
        .attr("d", placedPath);
    }

    function loopROffset(d) {
      // Stack parallel self-loops outward by dupIdx so a 2nd or 3rd
      // self-loop on the same node doesn't paint over the 1st.
      const idx = (d && d._dupIdx) || 0;
      return 8 + 10 * idx;
    }
    function loopHalfPath(d, side) {
      const nu = viz.nodeById[String(d.u)];
      return EP.makeSelfLoopHalf(nu, nodeR(d.u), side, { rOffset: loopROffset(d) });
    }
    function bridgePath(d) {
      const nu = viz.nodeById[String(d.u)];
      const nv = viz.nodeById[String(d.v)];
      if (!nu || !nv) return "";
      // Self-loop bridge: bridgeL + bridgeR each carry one half so the
      // two arcs grow inward from each tangent toward the apex (the
      // SBM stub-matcher aesthetic — two halves meet at the top).
      if (d.isLoop) return EP.makeSelfLoopHalf(nu, nodeR(d.u), d.side, { rOffset: loopROffset(d) });
      const swap = String(d.u) > String(d.v);
      const a = swap ? nv : nu, b = swap ? nu : nv;
      const ra = swap ? nodeR(d.v) : nodeR(d.u), rb = swap ? nodeR(d.u) : nodeR(d.v);
      if (bridgeCollinear) {
        return fanPath({ x: a.x, y: a.y }, { x: b.x, y: b.y }, 0, 1, ra, rb);
      }
      const k = pairKey(d.u, d.v);
      const grp = dupInfo[k] || { total: 1 };
      const idx = d._dupIdx != null ? d._dupIdx : (grp.total - 1);
      return fanPath({ x: a.x, y: a.y }, { x: b.x, y: b.y }, idx, grp.total, ra, rb);
    }

    function renderBridge(animate) {
      const data = [];
      justList().forEach(function (j) {
        const isLoop = j.u === j.v;
        const settledColor = state.bridgeColor || j.color || "#4e7a3a";
        const settledBad = !!j.bad;
        const buildStroke = animate ? buildColor : ((settledBad && j.badColor) ? j.badColor : settledColor);
        // During animate=true, the bridge is born in build colour
        // (dashed black). The colorize phase later swaps it to the
        // settled colour (cluster solid for non-bad, bad-red dashed
        // for collisions). For animate=false (jump-render), skip the
        // build phase and paint the settled appearance directly.
        const edgeId = j.id;
        const baseRow = {
          color: buildStroke,
          finalColor: (settledBad && j.badColor) ? j.badColor : settledColor,
          bad: settledBad, badColor: j.badColor,
          u: j.u, v: j.v,
          _dupIdx: j._dupIdx || 0,
          edgeId: edgeId,
        };
        if (isLoop) {
          data.push(Object.assign({ id: "bridgeL_" + edgeId, isLoop: true, side: -1 }, baseRow));
          data.push(Object.assign({ id: "bridgeR_" + edgeId, isLoop: true, side: +1 }, baseRow));
        } else {
          data.push(Object.assign({ id: "bridge_" + edgeId, isLoop: false }, baseRow));
        }
      });
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
        merged.attr("opacity", 1).attr("stroke-width", 2.6);
        merged.each(function (d) {
          NETGEN.BridgeAnim.grow(d3.select(this), {
            isLoop: d.isLoop,
            duration: T.bridgeGrow,
            delay: t_growStart(),
            transitionName: "bridge",
          });
        });
      } else {
        // Snap-render: bad and non-bad both settle solid. Dashed is
        // reserved for the dedup viz; collisions in the walker stay
        // solid red so the dashed pattern does not collide with the
        // "about to be removed" semantic.
        merged.each(function (d) {
          const sel = d3.select(this);
          if (d.isLoop) {
            const len = this.getTotalLength ? this.getTotalLength() : 100;
            sel.attr("opacity", 1)
              .attr("stroke-dasharray", len + " " + len)
              .attr("stroke-dashoffset", 0)
              .attr("stroke-width", 1.6);
          } else {
            sel.attr("opacity", 1)
              .attr("stroke-dasharray", null)
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
          const isJust = a.justSlots && a.justSlots.some(function (js) { return js.slot === i; });
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
      // Bumping `token` invalidates any late-firing rewind callback
      // queued by a previous syncState / playMany call; without this,
      // a stale callback could overwrite the snap state mid-render.
      ++token;
      interruptAll();
      clearPhaseTimers();
      if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
      animating = false;
      onLockChange(false);
      clearActiveDimPick();
      onActiveChange(false, null);
      const justsIn = normalizeJusts(s);
      state = Object.assign({}, s, { justs: justsIn });
      lastKey = justsKey(justsIn, s.justSeq);
      lastSeq = s.justSeq;
      pendingReroll = false;
      recompute();
      render(false);
    }
    // Run a multi-edge swap as a single rewind+forward sequence:
    //   removes: placed edges that should dissolve (rewind animation,
    //            played in parallel across all entries).
    //   adds:    new edges that grow forward (parallel grow + fan +
    //            colorize, also in parallel).
    // Caller's state.placed must already contain `removes` at call
    // time. After settle, state.placed has removes stripped and adds
    // appended, and state.justs is empty. Single onDone fires once
    // the whole sequence settles. Either side can be empty:
    //   removes=[], adds=[A,B] → forward-only (orbit→grow→fan→colorize).
    //   removes=[A,B], adds=[] → rewind-only (colour-back→fan-in→retract→orbit).
    function playMany(removes, adds, onDone) {
      const myToken = ++token;
      interruptAll();
      clearPhaseTimers();

      const removesList = (removes || []).slice();
      const addsList = (adds || []).slice();
      removesList.forEach(function (r, i) {
        if (r.id == null) r.id = "rm" + i + "_" + r.u + "_" + r.v;
      });
      addsList.forEach(function (a, i) {
        if (a.id == null) a.id = "ad" + i + "_" + a.u + "_" + a.v;
      });
      const removeIds = new Set(removesList.map(function (e) { return e.id; }));
      const currentPlaced = state.placed || [];
      const placedSansRemoves = currentPlaced.filter(function (p) {
        return !removeIds.has(p.id);
      });

      const willRewind = removesList.length > 0;
      const willForward = addsList.length > 0;
      const dimUnion = removesList.concat(addsList);

      // No-op if both sides empty: just fire onDone.
      if (!willRewind && !willForward) {
        if (onDone) onDone();
        return;
      }

      // Forward-only: skip rewind. Promote adds to justs, run forward.
      if (!willRewind) {
        state = Object.assign({}, state, { placed: placedSansRemoves, justs: addsList });
        recompute();
        bridgeStartMs = computeBridgeStartMs();
        lockFor(t_total(), dimUnion);
        render(true);
        setTimeout(function () {
          if (myToken !== token) return;
          const finalPlaced = placedSansRemoves.concat(addsList);
          state = Object.assign({}, state, { placed: finalPlaced, justs: [] });
          lastKey = ""; lastSeq = state.justSeq;
          recompute();
          render(false);
          if (onDone) onDone();
        }, t_total());
        return;
      }

      // With-rewind path: snap to "removes are the active justs that
      // just finished settling" — bridges painted in their final
      // colour at thin width, just-spokes hidden — then runRewind
      // animates them out.
      state = Object.assign({}, state, { placed: placedSansRemoves, justs: removesList });
      recompute();
      const rewindTotal = T.rewindUncolor + T.rewindFanIn + T.rewindBridge + T.rewindOrbit + T.rewindIdle;
      lockFor(rewindTotal + (willForward ? t_total() : 0), dimUnion);
      // Snap-render with-just layout so renderBridge creates the
      // bridge DOM elements at the with-removes layout.
      render(false);
      // Repaint bridges as post-colorize (settled): full opacity, thin
      // stroke, final colour. runRewind uncolor phase will animate
      // back to buildColor from here.
      bridgeLayer.selectAll("path.sp-bridge").each(function (d) {
        const sel = d3.select(this);
        const stroke = d.bad && d.badColor ? d.badColor : (d.finalColor || d.color);
        sel.attr("opacity", 1).attr("stroke-width", 1.6).attr("stroke", stroke);
        if (d.bad) sel.attr("stroke-dasharray", "4 4");
      });
      runRewind(function () {
        if (myToken !== token) return;
        if (!willForward) {
          state = Object.assign({}, state, { placed: placedSansRemoves, justs: [] });
          lastKey = ""; lastSeq = state.justSeq;
          recompute();
          render(false);
          if (onDone) onDone();
          return;
        }
        // Forward phase: swap removes → adds as the active justs.
        state = Object.assign({}, state, { placed: placedSansRemoves, justs: addsList });
        recompute();
        bridgeStartMs = computeBridgeStartMs();
        render(true);
        setTimeout(function () {
          if (myToken !== token) return;
          const finalPlaced = placedSansRemoves.concat(addsList);
          state = Object.assign({}, state, { placed: finalPlaced, justs: [] });
          lastKey = ""; lastSeq = state.justSeq;
          recompute();
          render(false);
          if (onDone) onDone();
        }, t_total());
      });
    }

    // Dedup-style removal animation. Each entry in `removes`:
    //   1. transitions stroke-dasharray solid → "4 4" (220ms),
    //   2. fades opacity 1 → 0 (280ms, starts at end of dashify),
    //   3. survivor parallels at the same (u, v) key fan in to fill
    //      the slot (480ms tween from with-removes layout to without).
    // Commits state.placed -= removes at the end; single onDone fires
    // when the whole sequence settles. No forward grow phase.
    function playDedup(removes, onDone) {
      const myToken = ++token;
      interruptAll();
      clearPhaseTimers();
      const removesList = (removes || []).slice();
      removesList.forEach(function (r, i) {
        if (r.id == null) r.id = "rmd" + i + "_" + r.u + "_" + r.v;
      });
      if (removesList.length === 0) {
        if (onDone) onDone();
        return;
      }
      const removeIds = new Set(removesList.map(function (r) { return r.id; }));
      const currentPlaced = state.placed || [];
      const survivingPlaced = currentPlaced.filter(function (p) { return !removeIds.has(p.id); });

      const T = { dashify: 220, fade: 320, idle: 80 };
      const total = T.dashify + T.fade + T.idle;
      lockFor(total, removesList);

      // Affected pair-keys (those losing >=1 entry) drive the survivor
      // fan-in tween scope.
      const affectedKeys = {};
      removesList.forEach(function (r) {
        const k = pairKey(r.u, r.v);
        affectedKeys[k] = (affectedKeys[k] || 0) + 1;
      });
      // dupInfo currently reflects state.placed + state.justs (the
      // "with-removes" layout). Snapshot it for the fan-in tween's
      // "from" frame.
      const dupInfoFrom = {};
      Object.keys(dupInfo).forEach(function (k) {
        dupInfoFrom[k] = { total: dupInfo[k].total };
      });
      // Compute the "to" layout: walk survivors in placed order,
      // assigning each a post-removal _dupIdxAfter at its key.
      const dupInfoTo = {};
      survivingPlaced.forEach(function (p) {
        const k = pairKey(p.u, p.v);
        if (!dupInfoTo[k]) dupInfoTo[k] = { total: 0 };
        p._dupIdxAfter = dupInfoTo[k].total;
        dupInfoTo[k].total += 1;
      });
      const survivorIds = new Set(survivingPlaced.map(function (p) { return p.id; }));

      // Phase 1: dashify the removes (solid → 4 4 dasharray). Stroke
      // colour stays — bad-flagged removes are already red, non-bad
      // get the same dashed cue for visual consistency with the dedup
      // primitive.
      const removeSel = placedLayer.selectAll("path.sp-placed-edge").filter(function (d) {
        return removeIds.has(d.id);
      });
      removeSel.transition("dedupDash").duration(T.dashify).ease(d3.easeCubicInOut)
        .attr("stroke-dasharray", "4 4");

      // Phase 2 (starts at end of dashify): fade removes; fan-in
      // survivors at affected keys in parallel.
      schedulePhase(T.dashify, function () {
        if (myToken !== token) return;
        removeSel.transition("dedupFade").duration(T.fade).ease(d3.easeCubicInOut)
          .attr("opacity", 0);
        placedLayer.selectAll("path.sp-placed-edge")
          .filter(function (d) {
            const k = pairKey(d.u, d.v);
            return survivorIds.has(d.id) && affectedKeys[k];
          })
          .transition("dedupFanIn").duration(T.fade).ease(d3.easeCubicInOut)
          .attrTween("d", function (d) {
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
            const grpFrom = dupInfoFrom[k] || { total: 1 };
            const grpTo = dupInfoTo[k] || { total: 1 };
            const idxFrom = d._dupIdx != null ? d._dupIdx : 0;
            const idxTo = d._dupIdxAfter != null ? d._dupIdxAfter : 0;
            const cFrom = grpFrom.total <= 1 ? 0 : (idxFrom - (grpFrom.total - 1) / 2);
            const cTo   = grpTo.total   <= 1 ? 0 : (idxTo   - (grpTo.total   - 1) / 2);
            const ax = a.x, ay = a.y, bx = b.x, by = b.y;
            return function (kk) {
              const c = cFrom + (cTo - cFrom) * kk;
              return fanPathCentered({ x: ax, y: ay }, { x: bx, y: by }, c, ra, rb);
            };
          });
      });

      // Phase 3 (commit): drop removes from state, recompute, snap-
      // render so the placed layout matches the post-fan-in state.
      schedulePhase(T.dashify + T.fade, function () {
        if (myToken !== token) return;
        state = Object.assign({}, state, { placed: survivingPlaced, justs: [] });
        lastKey = ""; lastSeq = state.justSeq;
        recompute();
        render(false);
        if (onDone) onDone();
      });
    }

    return {
      syncState: syncState,
      snapToState: snapToState,
      playMany: playMany,
      playDedup: playDedup,
      markReroll: function () { pendingReroll = true; },
      rerender: function () { recompute(); render(false); },
      isAnimating: function () { return animating; },
    };
  }

  // Shared byNode helper for callers that drive `attach`. Counts edge
  // incidence per node from any iterable that exposes forEach(e => ...)
  // — Array, Map, Set of {u,v} entries all work. Returns the
  // { nodeId: { count, color } } shape that syncState / snapToState /
  // playMany expect on `state.byNode`. `colorFor` is either a function
  // (id) => color or a constant string; defaults to the node's own
  // viz colour.
  function byNodeFromEdges(viz, edges, colorFor) {
    const counts = {};
    if (edges && typeof edges.forEach === "function") {
      edges.forEach(function (e) {
        if (!e) return;
        counts[e.u] = (counts[e.u] || 0) + 1;
        counts[e.v] = (counts[e.v] || 0) + 1;
      });
    }
    const colorFn = (typeof colorFor === "function")
      ? colorFor
      : function (n) { return colorFor != null ? colorFor : n.color; };
    const out = {};
    viz.eachNode(function (n) {
      out[n.id] = { count: counts[n.id] || 0, color: colorFn(n) };
    });
    return out;
  }

  // Generic cut-picker for rewire walkers. Given the current placed
  // list and an array of cut endpoint pairs (each [u, v]), returns
  // the specific placed entries to remove. Selection rule:
  //   1. Prefer the bad-flagged copy of (u, v).
  //   2. Among matches of the same bad-ness, prefer the LATER-added
  //      copy (higher index in `placed`).
  //   3. Each placed entry is picked at most once per call.
  // Cut pairs that have no matching placed entry are silently skipped
  // (the cut would be a no-op visually anyway).
  function pickCutsByEndpoints(placed, cutPairs) {
    const used = new Set();
    const out = [];
    function sameXY(e, p) {
      return (e.u === p[0] && e.v === p[1]) || (e.u === p[1] && e.v === p[0]);
    }
    (cutPairs || []).forEach(function (p) {
      if (!p) return;
      let pickIdx = -1;
      let pickIsBad = false;
      // Latest-first scan: first bad match wins immediately. Otherwise
      // remember the latest non-bad and keep scanning in case an
      // earlier index still holds a bad copy.
      for (let i = placed.length - 1; i >= 0; i--) {
        if (used.has(i)) continue;
        const e = placed[i];
        if (!sameXY(e, p)) continue;
        if (e.bad) { pickIdx = i; pickIsBad = true; break; }
        if (pickIdx < 0) { pickIdx = i; }
      }
      if (pickIdx >= 0) {
        used.add(pickIdx);
        out.push(placed[pickIdx]);
      }
    });
    return out;
  }

  return {
    attach: attach,
    byNodeFromEdges: byNodeFromEdges,
    pickCutsByEndpoints: pickCutsByEndpoints,
  };
})();
