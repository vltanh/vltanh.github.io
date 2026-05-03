# matcher.html viz port plan

## Goal

Bring `vltanh.github.io/netgen/matcher.html` walker visualizations
in line with the rest of the netgen pages:

1. Top-right side panel for the deficit input panel (same layout as
   `sbm.html` g4/g5 — graph on left, bars/heatmap on right inside a
   `<div class="g-with-side">` shell).
2. Spoke-style stub-pair animation across every walker (the
   `NETGEN.rewireSpokeSwapAnimate` primitive that `abcd_kernel.js`,
   `ec_sbm_kernel.js`, and `lfr_kernel.js` already use).
3. Uniform per-walker control row: `RandStep | RandAll | ToStart |
   Back | Next | ToEnd`. Today the deterministic walkers omit the
   Rand buttons; the request is to add them and have RandStep/RandAll
   reseed the animation while keeping the algorithm output
   deterministic.

## Current state of the page (2026-05-03)

Text restructure already shipped:

* Four merged family sections, each with the global walker
  followed by an `<h3>cluster-preserving twin</h3>` block and the
  CP walker.
* New `stackable matchers` section.
* New `case study · dnc` section with the four-config table.
* All `<div class="pseudo">` blocks removed.
* `algorithm · hybrid` and `algorithm · cluster_preserving_hybrid`
  sections removed; the `g-hybrid` and `g-cphybrid` JS bindings in
  the trailing inline `<script>` are gone too.

JS bindings still in place (`vltanh.github.io/netgen/js/match_degree_kernel.js`):

* `runGreedy`, `runTrueGreedy`, `runRandomGreedy`, `runRewire`
* `runClusterPreservingGreedy`, `runClusterPreservingTrueGreedy`,
  `runClusterPreservingRandomGreedy`,
  `runClusterPreservingRewire`
* `runHybrid`, `runClusterPreservingHybrid` (defined but no longer
  bound to a section; can be deleted, or kept as helpers if a future
  stack-walker needs them).

Eight walker DOM blocks still live in `matcher.html`, all using the
`graph` / `graph-canvas` shell + `widget-row tight` controls. The
input deficit panel (`g-input`) uses the same shell but with bars
rendered as a Cytoscape overlay on the right side of the canvas via
`NETGEN.VIZ.init`'s `padRight: 340` trick. The reference sbm.html g4
panel uses a separate `<svg>` inside a `g-with-side` flex layout.

## Reference implementations

* **Right-panel layout**: `sbm.html` sections `g-stage4` and
  `g-stage5`. The pattern is `<div class="graph g-with-side">` with
  `<div class="side-body">` containing `<div class="graph-canvas"
  id="..."></div>` on the left and `<div class="side-right">` with an
  `<svg>` on the right. CSS is already in `matcher.html`'s `<style>`
  block (the `g-with-side` rules at lines 14–34).
* **Spoke animation primitive**: `NETGEN.rewireSpokeSwapAnimate` in
  `vltanh.github.io/netgen/shared.js`. Used by `abcd_kernel.js`,
  `ec_sbm_kernel.js`, and `lfr_kernel.js`. Memory note:
  `viz_rewire_spoke_swap.md` is the reference for how a per-op
  rewire viz wires up to it; `viz_edge_primitives.md` covers the
  underlying `EdgePaths` + `BridgeAnim` primitives.
* **Pinned simulation requirement**: every overlay-animated viz must
  pass `pinned: true` to `NETGEN.VIZ.init`. Memory note:
  `feedback_pin_per_op_viz.md`.
* **Locking convention** (every randomness-affecting control locks
  prior steps and randomises everything from the current step
  through the end): memory note
  `feedback_matcher_reroll_ux.md`.

## Per-walker port playbook (apply 8x)

Adapted from `playbook_kernel_js_port.md`. Per walker:

1. **Replace step renderer** — swap the current per-step DOM
   manipulation in `match_degree_kernel.js` for a
   `NETGEN.rewireSpokeSwapAnimate` call. Each step's animation is
   `pickU → pickV → grow edge → colorize`. For greedy, the
   per-source burst becomes a sequence of single-edge animations
   chained via the existing `animLocked` event-bus pattern (memory:
   `feedback_viz_chain_lock.md`).
2. **Standardise control row** — add `RandStep` and `RandAll`
   buttons to every walker. For deterministic walkers (greedy,
   true_greedy, cluster_preserving_greedy,
   cluster_preserving_true_greedy), `RandStep` re-runs the current
   step's animation (visual reseed only, output unchanged);
   `RandAll` re-runs from start (same output, fresh visual).
3. **Verify** — open `localhost:8080/matcher.html` (memory:
   `feedback_viz_verification.md`), step through every walker, click
   every button. Compare each step's text caption to the prior
   walker's caption — the algorithm output must not have shifted.
4. **Drop UC marks** — the page-level `<div class="wip-banner">` and
   the matcher's row in the landing page UC card. Memory:
   `feedback_keep_uc_banner.md`.

## Input deficit panel port

Move the deficit bars from the Cytoscape overlay (`padRight: 340`
trick) into a separate `<svg>` inside a `g-with-side` shell:

1. Wrap `g-input` graph + a new `g-input-side` SVG in a
   `<div class="side-body">`.
2. Render the bars in d3 directly into the SVG, indexed by node id.
3. Keep the same data source (the SBM-style stub pairing on the
   20-node fixture) and the same re-roll button.
4. Per-walker bars currently rendered as Cytoscape overlays inside
   each walker's canvas should follow the same pattern, so every
   walker becomes a `g-with-side` shell.

## Order of work

1. Input deficit panel (one-off).
2. Walker template factor: introduce a single
   `setupSpokeAlgoSection(...)` helper that takes the algo function
   + an order/randomness mode and produces the full DOM + spoke
   animation hookup. The current `setupAlgoSection` becomes its
   internal callee.
3. Port walkers in this order (smallest scope to largest):
   `greedy → cluster_preserving_greedy → true_greedy →
   cluster_preserving_true_greedy → random_greedy →
   cluster_preserving_random_greedy → rewire →
   cluster_preserving_rewire`.
4. Drop the dead `runHybrid` + `runClusterPreservingHybrid` JS
   functions (or keep them with a comment if there is a planned
   future stack walker).
5. Drop UC banner + landing UC mark.

## Verification checkpoints

After every two ported walkers, open the page and:

* Confirm the deficit panel still re-rolls and resets every walker.
* Confirm the new walker's per-step caption matches what the
  current production matcher does on the same toy deficit.
* Confirm RandStep / RandAll behave per the locking convention.
* Confirm no console errors.

## Out of scope

* The `--remap` illustrative panel at the bottom of the page
  (already a static d3 SVG, no spoke animation needed).
* `runHybrid` / `runClusterPreservingHybrid` rewrite — those are
  removed at the page level, keep or delete in JS at the porter's
  discretion.
* Any kernel.js change that would alter algorithm output —
  byte-identical results across the port is the contract; only the
  animation changes.

## Files to touch

* `vltanh.github.io/netgen/matcher.html` — DOM shell changes per
  walker, button row updates, input deficit panel layout.
* `vltanh.github.io/netgen/js/match_degree_kernel.js` — replace
  step renderers with `rewireSpokeSwapAnimate` calls.
* `vltanh.github.io/netgen/index.html` — drop matcher's UC card
  entry once the port is done.

## Estimated effort

3–6 hours of focused JS work + visual verification. Per-walker
porting is mechanical once the first one lands; the input panel
port is a one-off.
