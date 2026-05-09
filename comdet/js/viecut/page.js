/* viecut.html walker glue.
 *
 * Captures the gated __VIECUT_HOOK event stream from the kernel as it
 * runs cactus_mincut on a small purpose-built fixture, then exposes a
 * phase-navigated step walker on the page.
 *
 * The fixture (8 nodes, 12 edges) is two K3 triangles {0,1,2} and
 * {3,4,5} connected by a 2-edge bridge {(2,3),(2,6),(3,7)}+pendants.
 * Tailored so every phase fires:
 *   A NOI capforest  - some r_v + w == mincut unions (early contractions)
 *   B degree-1       - pendants 6,7 with edge weight 1 == mincut
 *   C PR12+34        - triangles trigger Padberg-Rinaldi tests
 *   D contract       - successive uf shrinkage
 *   E recursive_cactus + push_relabel - non-trivial cactus build
 *   F balanced DFS   - cactus has multiple tree edges to compare
 *   G most-balanced BFS - in/out partition recovery
 */
(function () {
  "use strict";
  if (!window.COMDET || !COMDET.VIECUT) {
    console.warn("[viecut page] missing COMDET.VIECUT");
    return;
  }
  const C = COMDET, V = C.VIECUT;

  // ── fixture ─────────────────────────────────────────────────────
  // 8 nodes, edges weighted 1. mincut = 1 (the bridge 2-3, plus the
  // pendant edges). Cactus encodes all minimum cuts.
  const FX = {
    n: 8,
    edges: [
      [0,1,1],[0,2,1],[1,2,1],            // K3 on {0,1,2}
      [3,4,1],[3,5,1],[4,5,1],            // K3 on {3,4,5}
      [2,3,1],                            // bridge
      [2,6,1],                            // pendant 6
      [3,7,1],                            // pendant 7
      [0,4,1],                            // extra cross-bridge to give push-relabel work
      [1,5,1],                            // extra cross-bridge
    ],
    pos: [
      { id: 0, x:  60, y:  90 },
      { id: 1, x:  60, y: 210 },
      { id: 2, x: 160, y: 150 },
      { id: 3, x: 280, y: 150 },
      { id: 4, x: 380, y:  90 },
      { id: 5, x: 380, y: 210 },
      { id: 6, x: 160, y:  40 },
      { id: 7, x: 280, y: 260 },
    ],
  };

  // ── kernel run with hook capture ────────────────────────────────
  const events = [];
  globalThis.__VIECUT_HOOK = function (event, payload) {
    // shallow-clone payloads so later kernel mutations don't leak.
    events.push({ event, payload: shallow(payload), idx: events.length });
  };
  function shallow(o) {
    if (o == null || typeof o !== "object") return o;
    if (Array.isArray(o)) return o.slice();
    const out = {};
    for (const k in o) {
      const v = o[k];
      out[k] = (v && typeof v === "object" && !Array.isArray(v)) ? v
             : (Array.isArray(v) ? v.slice() : v);
    }
    return out;
  }

  // Build mutable_graph + run.
  const G = new V.MutableGraph();
  G.start_construction(FX.n);
  // Build edge list + adjacency in node-id ASC order for byte-equal canon.
  const edgesByMin = FX.edges.slice().sort(function (a, b) {
    const la = Math.min(a[0],a[1]), ha = Math.max(a[0],a[1]);
    const lb = Math.min(b[0],b[1]), hb = Math.max(b[0],b[1]);
    if (la !== lb) return la - lb;
    return ha - hb;
  });
  for (const [u,v,w] of edgesByMin) G.new_edge(u, v, w);
  G.finish_construction();
  V.random_functions.setSeed(0);
  let cmResult;
  try {
    cmResult = V.cactus_mincut(G, { seed: 0 });
  } catch (err) {
    console.error("[viecut page] kernel error", err);
    cmResult = null;
  }
  globalThis.__VIECUT_HOOK = null;

  // ── phase index ─────────────────────────────────────────────────
  // Group events by top-level phase + maintain a flat ordering for the
  // step walker. PHASES is the ordered list shown as nav chips.
  const PHASES = [
    { id: "init",    label: "Setup",                   key: "init" },
    { id: "A",       label: "A · NOI capforest",       key: "phase_A" },
    { id: "B",       label: "B · degree-1 cleanup",    key: "phase_B" },
    { id: "C",       label: "C · PR12 + PR34",         key: "phase_C" },
    { id: "D",       label: "D · contract",            key: "phase_D" },
    { id: "E",       label: "E · recursive_cactus",    key: "phase_E" },
    { id: "F",       label: "F · balanced DFS",        key: "phase_F" },
    { id: "G",       label: "G · most-balanced BFS",   key: "phase_G" },
  ];
  // Map each event index → phase id by scanning for phase_X_start / _end markers.
  const eventPhase = new Array(events.length).fill("init");
  let curPhase = "init";
  events.forEach(function (ev, i) {
    if (ev.event === "init") curPhase = "init";
    else if (ev.event === "noi_init" || ev.event === "noi_pop") curPhase = "A";
    else if (ev.event === "phase_A_start" || ev.event === "phase_A_end") curPhase = "A";
    else if (ev.event === "phase_B_start" || ev.event === "phase_B_end") curPhase = "B";
    else if (ev.event === "phase_C_start" || ev.event === "phase_C_end") curPhase = "C";
    else if (ev.event === "phase_D_start" || ev.event === "phase_D_end") curPhase = "D";
    else if (ev.event === "phase_E_start" || ev.event === "phase_E_end") curPhase = "E";
    else if (ev.event === "phase_F_start" || ev.event === "phase_F_end" || ev.event === "bcd_best") curPhase = "F";
    else if (ev.event === "phase_G_start" || ev.event === "phase_G_end" || ev.event === "mb_init" || ev.event === "mb_visit") curPhase = "G";
    eventPhase[i] = curPhase;
  });
  const phaseStart = {};
  PHASES.forEach(function (p) { phaseStart[p.id] = -1; });
  eventPhase.forEach(function (pid, i) {
    if (phaseStart[pid] === -1) phaseStart[pid] = i;
  });

  // ── DOM render ──────────────────────────────────────────────────
  const inputHost = document.getElementById("g-input");
  const cactusHost = document.getElementById("g-cactus");
  const stateHost = document.getElementById("g-state");
  const proseHost = document.getElementById("g-prose");
  const stepLabel = document.getElementById("g-step-label");
  const phaseLabel = document.getElementById("g-phase-label");
  const chipsHost = document.getElementById("g-chips");
  const summaryHost = document.getElementById("g-summary");

  if (!inputHost || !proseHost) {
    console.warn("[viecut page] missing DOM mounts");
    return;
  }

  // Render the input graph as an SVG.
  function renderGraph(host, opts) {
    opts = opts || {};
    const W = 460, H = 300;
    host.innerHTML = "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "vc-graph");
    host.appendChild(svg);
    // edges
    for (const [u,v] of FX.edges) {
      const pu = FX.pos[u], pv = FX.pos[v];
      const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", pu.x); ln.setAttribute("y1", pu.y);
      ln.setAttribute("x2", pv.x); ln.setAttribute("y2", pv.y);
      ln.setAttribute("class", "vc-edge"
        + (opts.highlightEdges && opts.highlightEdges.some(function(e){
            return (e[0]===u && e[1]===v) || (e[0]===v && e[1]===u);
          }) ? " vc-edge-hot" : ""));
      svg.appendChild(ln);
    }
    // nodes
    for (let i = 0; i < FX.n; i++) {
      const p = FX.pos[i];
      const cls = "vc-node"
        + (opts.activeNode === i ? " vc-node-active" : "")
        + (opts.unionedSet && opts.unionedSet.has(i) ? " vc-node-uni" : "")
        + (opts.inSet && opts.inSet.has(i) ? " vc-node-in" :
           opts.outSet && opts.outSet.has(i) ? " vc-node-out" : "");
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", p.x); c.setAttribute("cy", p.y);
      c.setAttribute("r", 14); c.setAttribute("class", cls);
      svg.appendChild(c);
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", p.x); t.setAttribute("y", p.y + 4);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "vc-label");
      t.textContent = String(i);
      svg.appendChild(t);
    }
  }

  // Render cactus tree (built incrementally; the kernel emits the final
  // cactus after phase E).
  function renderCactus(host) {
    if (!host) return;
    host.innerHTML = "";
    if (!cmResult || !cmResult.cactus) {
      host.innerHTML = '<div class="vc-empty">cactus emitted after Phase E</div>';
      return;
    }
    const cactus = cmResult.cactus;
    const cn = cactus.n();
    const W = 460, H = 220;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "vc-cactus");
    host.appendChild(svg);
    // simple radial layout
    const cx = W/2, cy = H/2, r = Math.min(W, H)/2 - 30;
    const cpos = [];
    for (let i = 0; i < cn; i++) {
      const a = (i / cn) * 2 * Math.PI - Math.PI/2;
      cpos.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    // edges
    const drawn = new Set();
    for (let v = 0; v < cn; v++) {
      const ne = cactus.get_first_invalid_edge(v);
      for (let e = 0; e < ne; e++) {
        const t = cactus.getEdgeTarget(v, e);
        const key = Math.min(v,t) + "-" + Math.max(v,t);
        if (drawn.has(key)) continue;
        drawn.add(key);
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", cpos[v].x); ln.setAttribute("y1", cpos[v].y);
        ln.setAttribute("x2", cpos[t].x); ln.setAttribute("y2", cpos[t].y);
        ln.setAttribute("class", "vc-cedge");
        svg.appendChild(ln);
      }
    }
    // nodes
    for (let i = 0; i < cn; i++) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", cpos[i].x); c.setAttribute("cy", cpos[i].y);
      c.setAttribute("r", 12); c.setAttribute("class", "vc-cnode");
      svg.appendChild(c);
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", cpos[i].x); t.setAttribute("y", cpos[i].y + 4);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "vc-clabel");
      t.textContent = String(i);
      svg.appendChild(t);
      // contained vertices subscript
      const contained = cactus.containedVertices(i);
      if (contained && contained.length > 0) {
        const ct = document.createElementNS("http://www.w3.org/2000/svg", "text");
        ct.setAttribute("x", cpos[i].x); ct.setAttribute("y", cpos[i].y + 26);
        ct.setAttribute("text-anchor", "middle");
        ct.setAttribute("class", "vc-csub");
        ct.textContent = "{" + contained.join(",") + "}";
        svg.appendChild(ct);
      }
    }
  }

  // ── per-event renderers ─────────────────────────────────────────
  function renderEvent(idx) {
    const phase = eventPhase[idx];
    if (phaseLabel) {
      const p = PHASES.find(function (x) { return x.id === phase; });
      phaseLabel.textContent = p ? p.label : phase;
    }
    if (chipsHost) {
      Array.from(chipsHost.querySelectorAll(".vc-chip")).forEach(function (el) {
        el.classList.toggle("vc-chip-on", el.dataset.phase === phase);
      });
    }
    const ev = events[idx];
    if (!ev) return;

    let opts = {};
    let prose = "";
    let stateHTML = "";

    if (ev.event === "init") {
      prose = "<p>Setup. Input graph: " + ev.payload.n + " nodes, " + ev.payload.m
        + " edges. Initial mincut estimate (min-degree heuristic): "
        + "<b>" + ev.payload.mincut + "</b>.</p>"
        + "<p>The algorithm now alternates contraction phases until the graph "
        + "shrinks by less than 1%, then runs the cactus build (Phase E) and "
        + "tie-break selection (Phases F + G).</p>";
    } else if (ev.event === "noi_init") {
      opts.activeNode = ev.payload.starting_node;
      prose = "<p>Phase A starts. Capforest contraction picks a random start vertex "
        + "(here <b>" + ev.payload.starting_node + "</b>, drawn from RNG). "
        + "It then runs a priority-queue traversal: pop the highest-priority node, "
        + "scan its neighbours, accumulate <code>r_v[t]</code> per neighbour. "
        + "When <code>r_v[t] + w &ge; mincut</code>, union the two endpoints "
        + "(this contraction is provably safe).</p>";
    } else if (ev.event === "noi_pop") {
      opts.activeNode = ev.payload.current_node;
      const unions = ev.payload.unions || [];
      opts.unionedSet = new Set();
      unions.forEach(function (u) { opts.unionedSet.add(u[0]); opts.unionedSet.add(u[1]); });
      const updates = ev.payload.updates || [];
      let upHTML = updates.map(function (u) {
        return "<li>edge to <b>" + u.tgt + "</b>: r_v += " + u.w
          + " &rarr; <code>" + u.new_rv + "</code>"
          + (u.unioned ? " <span class='vc-tag vc-tag-go'>UNION</span>" : "")
          + "</li>";
      }).join("");
      prose = "<p>Pop node <b>" + ev.payload.current_node + "</b> from PQ. "
        + "Scan its " + updates.length + " unvisited neighbour(s):</p>"
        + (upHTML ? "<ul>" + upHTML + "</ul>" : "<p><em>no unvisited neighbours.</em></p>");
      stateHTML = "<div class='vc-state-row'><b>r_v</b>: "
        + ev.payload.r_v.map(function (v, i) {
            return "<span class='vc-cell'>" + i + ":" + v + "</span>";
          }).join("") + "</div>"
        + "<div class='vc-state-row'><b>uf.n</b>: " + ev.payload.uf_n + " components</div>";
    } else if (ev.event === "phase_A_start" || ev.event === "phase_A_end") {
      prose = "<p>Phase A " + (ev.event.endsWith("start") ? "starts" : "ends")
        + " on iter " + ev.payload.iter + "."
        + (ev.event.endsWith("end") ? " Capforest collapsed " + (FX.n - ev.payload.uf_n)
            + " unions; uf has " + ev.payload.uf_n + " components." : "")
        + "</p>";
    } else if (ev.event === "phase_B_start") {
      prose = "<p>Phase B: degree-1 cleanup. Each node with exactly one edge whose "
        + "weight equals the current mincut estimate gets unioned with its neighbour. "
        + "Such an edge is itself a minimum cut (cuts the leaf off), so contracting "
        + "doesn't lose any cuts of size mincut.</p>";
    } else if (ev.event === "phase_B_end") {
      const u = ev.payload.unions || [];
      prose = "<p>Phase B end. Degree-1 unions performed: " + u.length + ".</p>"
        + (u.length ? "<ul>" + u.map(function(uu){
            return "<li>node <b>" + uu[0] + "</b> &harr; <b>" + uu[1] + "</b></li>";
          }).join("") + "</ul>" : "");
      opts.unionedSet = new Set();
      u.forEach(function (uu) { opts.unionedSet.add(uu[0]); opts.unionedSet.add(uu[1]); });
    } else if (ev.event === "phase_C_start") {
      prose = "<p>Phase C: Padberg-Rinaldi tests (" + ev.payload.sub + "). "
        + "Triangle-based contractions: PR12 finds pairs whose edge weight already "
        + "matches the local mincut bound (so they can be safely merged); PR34 looks "
        + "at higher-order patterns. Both are heuristic contractions that preserve "
        + "all minimum cuts.</p>";
    } else if (ev.event === "phase_C_end") {
      prose = "<p>Phase C " + ev.payload.sub + " end. uf.n = " + ev.payload.uf_n
        + " components on graph of " + ev.payload.n_before + " nodes.</p>";
    } else if (ev.event === "phase_D_start") {
      prose = "<p>Phase D: contract via union-find. Build a smaller graph where each "
        + "uf component becomes a single super-node; sum edge weights within. The next "
        + "outer iteration runs on this contracted graph.</p>";
    } else if (ev.event === "phase_D_end") {
      const ratio = ev.payload.n_after / Math.max(1, FX.n);
      prose = "<p>Phase D end. Graph went " + (FX.n) + " &rarr; " + ev.payload.n_after
        + " nodes (" + (ratio*100).toFixed(0) + "% of original). "
        + "Outer-while continues if shrinkage exceeds 1%.</p>";
    } else if (ev.event === "phase_E_start") {
      prose = "<p>Phase E: recursive cactus build. Pick (s, t) by max combined "
        + "weighted degree, run push-relabel max-flow. If max_flow &gt; mincut, "
        + "contract (s,t) and recurse. Else, decompose into strongly-connected "
        + "components and assemble cactus per ST-cut block sizes (findSTCactus + "
        + "mergeCactusWithComponent). The output is a tree-of-cycles where every "
        + "minimum cut is encoded.</p>";
    } else if (ev.event === "phase_E_end") {
      prose = "<p>Phase E end. Cactus built: <b>" + ev.payload.cactus_n
        + "</b> super-nodes, <b>" + ev.payload.cactus_edges + "</b> edges. "
        + "(The cactus appears in the panel below.)</p>";
    } else if (ev.event === "phase_F_start") {
      prose = "<p>Phase F: balanced DFS over the cactus. Walk the tree, accumulate "
        + "subtree weights, and at every tree edge check if cutting it would yield "
        + "the most balanced split seen so far. Cycle edges use a sliding-window "
        + "investigation. DFS start vertex (RNG-drawn): "
        + "<b>" + ev.payload.sv + "</b>.</p>";
    } else if (ev.event === "phase_F_end") {
      const d = ev.payload.dfs;
      prose = "<p>Phase F end. Best edge: cactus node <b>" + d.best_n
        + "</b>, edge index " + d.best_e + ". Best balanced weight: <b>"
        + d.best_weight + "</b>. In cycle: " + (d.best_in_cycle ? "yes" : "no") + ".</p>";
    } else if (ev.event === "phase_G_start") {
      prose = "<p>Phase G: BFS over the cactus from the cut endpoints, blocked by "
        + "their reverses. Every cactus node visited contributes its contained "
        + "original-graph vertices to the in-partition; the rest go to out.</p>";
    } else if (ev.event === "mb_init") {
      prose = "<p>BFS roots: <b>" + ev.payload.n1 + "</b>, <b>" + ev.payload.n2
        + "</b>. Blocked: " + ev.payload.rev_n1 + ", " + ev.payload.rev_n2 + ".</p>";
    } else if (ev.event === "mb_visit") {
      const c = ev.payload.contained || [];
      prose = "<p>Visit cactus node <b>" + ev.payload.cactus_node + "</b>; mark "
        + c.length + " original vertex/vertices into in-partition: "
        + c.map(function (v){ return "<b>" + v + "</b>"; }).join(", ") + ".</p>";
      opts.inSet = new Set(c);
    } else if (ev.event === "phase_G_end") {
      prose = "<p>Done. Cut value: <b>" + ev.payload.cutValue + "</b>. In-partition: "
        + ev.payload.inP.length + " nodes. Out-partition: " + ev.payload.outP.length
        + " nodes.</p>";
      opts.inSet = new Set(ev.payload.inP);
      opts.outSet = new Set(ev.payload.outP);
    } else if (ev.event === "bcd_best") {
      prose = "<p>Balanced DFS best-edge update. Cactus node <b>" + ev.payload.node
        + "</b> &rarr; <b>" + ev.payload.target + "</b>. Lighter-block weight: "
        + ev.payload.weight + ". Kind: " + ev.payload.kind + ".</p>";
    }
    renderGraph(inputHost, opts);
    if (proseHost) proseHost.innerHTML = prose;
    if (stateHost) stateHost.innerHTML = stateHTML;
    if (stepLabel) stepLabel.textContent = (idx + 1) + " / " + events.length;
  }

  // ── chips ───────────────────────────────────────────────────────
  if (chipsHost) {
    chipsHost.innerHTML = "";
    PHASES.forEach(function (p) {
      const fired = phaseStart[p.id] >= 0;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "vc-chip" + (fired ? "" : " vc-chip-skip");
      el.dataset.phase = p.id;
      el.textContent = p.label;
      if (fired) {
        el.addEventListener("click", function () {
          state.idx = phaseStart[p.id];
          renderEvent(state.idx);
        });
      } else {
        el.title = "phase did not fire on this fixture";
      }
      chipsHost.appendChild(el);
    });
  }

  // ── step controls ───────────────────────────────────────────────
  const state = { idx: 0 };
  function go(d) {
    const next = Math.max(0, Math.min(events.length - 1, state.idx + d));
    state.idx = next;
    renderEvent(next);
  }
  const prevBtn = document.getElementById("g-prev");
  const nextBtn = document.getElementById("g-next");
  const firstBtn = document.getElementById("g-first");
  const lastBtn = document.getElementById("g-last");
  if (prevBtn) prevBtn.addEventListener("click", function () { go(-1); });
  if (nextBtn) nextBtn.addEventListener("click", function () { go(+1); });
  if (firstBtn) firstBtn.addEventListener("click", function () { state.idx = 0; renderEvent(0); });
  if (lastBtn)  lastBtn.addEventListener("click", function () { state.idx = events.length - 1; renderEvent(events.length - 1); });

  // ── summary ─────────────────────────────────────────────────────
  if (summaryHost) {
    if (cmResult) {
      summaryHost.innerHTML = "<b>Result:</b> mincut = <b>" + cmResult.cutValue
        + "</b>, in-partition has " + cmResult.inPartition.length + " nodes ("
        + cmResult.inPartition.join(", ") + "), out-partition has "
        + cmResult.outPartition.length + " nodes ("
        + cmResult.outPartition.join(", ") + ").";
    } else {
      summaryHost.innerHTML = "<em>kernel error; see console.</em>";
    }
  }

  // ── initial render ──────────────────────────────────────────────
  renderEvent(0);
  renderCactus(cactusHost);

})();
