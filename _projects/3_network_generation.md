---
layout: page
title: Synthetic Network Generators
permalink: /projects/network-generation/
description: Seven classic generators under one pipeline, each one illustrated step by step on the same small example so that what they preserve and what they throw away is visible side by side.
img: assets/img/netgen/title.svg
og_image: /assets/img/netgen/title.svg
importance: 3
category: work
project_intro: true
icons:
  - file: python/python-original.svg
    site: devicons
  - file: cplusplus/cplusplus-original.svg
    site: devicons
  - file: julia/julia-original.svg
    site: devicons
repository:
  - vltanh/network-generation
---

This project started from a simple question: given a real network $$G$$, what does a *synthetic twin* $$G'$$ of it actually mean? There is no single answer. Each generator in the community-detection literature freezes a different set of things about $$G$$ and rolls the dice on everything else. Pick your generator by picking what you think matters.

I wrapped seven of these generators under a single two-stage pipeline: one stage extracts a tiny statistical profile from $$G$$, the other consumes the profile and samples a synthetic $$G'$$. The pipeline is intentionally decoupled, so the same profile can feed different generators, and the same generator can be pointed at different profiles.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/netgen/title.svg" title="Small synthetic network used across the visualizations" class="img-fluid rounded z-depth-1" caption="The 20-node synthetic I use in every visualization: cluster C1 (azure), C2 (amber), C3 (mint), and two background outliers (red). Same graph across all seven pages, so what each generator preserves and what it throws away becomes visible side by side." %}
    </div>
</div>

## Walk through them

One page per generator. Each page is a vertical scroll, Feynman style: start with the question the generator answers, meet the input, walk through the stages with one interactive widget per stage, end with an honest table of what was kept and what drifted.

The SBM family keeps your node IDs and your block assignment through the pipeline. The configuration-model family (ABCD, ABCD+o, LFR) and nPSO do not: the output graphs have fresh IDs drawn from fresh distributions, and the clusters coincide with yours only by accident.

**SBM family (block structure preserved).**

- [sbm](/netgen/sbm.html): the cookie cutter. Keep the block matrix and the degrees; roll the dice on everything else.
- [ec-sbm-v1](/netgen/ec-sbm-v1.html): SBM with a provably $$k$$-edge-connected core per cluster. Four stages.
- [ec-sbm-v2](/netgen/ec-sbm-v2.html): the cleaner successor. One SBM call instead of two, plus a block-preserving 2-opt rewire.

**Configuration-model family (global mixing, no block structure preserved).**

- [abcd](/netgen/abcd.html): every person has a bundle of friendship stubs; a single knob $$\xi$$ decides the fraction that leave the cluster.
- [abcd+o](/netgen/abcd+o.html): ABCD with a first-class outlier block.
- [lfr](/netgen/lfr.html): fit a power law, resample, throw the original away.

**Geometric (clustering coefficient targeted).**

- [npso](/netgen/npso.html): nodes live on a hyperbolic disk; one temperature knob controls how triangle-heavy the output is.

Or browse the [`/netgen/` landing page](/netgen/) which groups them the same way.

## Why these seven

Each of the seven sits at a distinct point in the "what would you like to preserve" space:

- **Exact degrees and exact block structure**: sbm and the ec-sbm variants. They are the only ones that keep your partition.
- **Exact degrees, aggregate mixing only**: abcd and abcd+o. These are the modern benchmarks that take your degree sequence as is.
- **Parametric distributional match**: lfr. Fits power laws to your graph, then produces a fresh sample that looks distributionally similar but shares no node-level detail with your input.
- **Triangle density**: npso. The only one of the seven that aims for a high clustering coefficient, via a geometric embedding instead of stub-pairing.

No generator here targets *all* of those at once. Degree-corrected SBM output looks almost tree-like even when the input is richly clustered; nPSO's hyperbolic geometry gets the triangles but resamples the degrees from a power law. Closing that gap is active research territory, and ec-sbm's constructive first stage is one attempt.

## On reproducibility

All seven generators are byte-reproducible under a fixed `--seed` on a fixed toolchain. Small host changes (minor graph-tool bumps, Julia patch versions) can shift SBM-family hashes while leaving the ABCD / LFR / nPSO hashes stable, so I pin toolchain versions in the benchmark harness. The distributional guarantees that define each generator survive host changes even when the bytes do not.

## Acknowledgements

- **`sbm`**: [graph-tool](https://graph-tool.skewed.de/).
- **`ec-sbm-v1`**: [illinois-or-research-analytics/ec-sbm](https://github.com/illinois-or-research-analytics/ec-sbm); uses [python-mincut](https://github.com/vikramr2/python-mincut).
- **`ec-sbm-v2`**: extended from `ec-sbm-v1`.
- **`abcd` / `abcd+o`**: [ABCDGraphGenerator.jl](https://github.com/bkamins/ABCDGraphGenerator.jl).
- **`lfr`**: [LFR benchmark](https://www.santofortunato.net/resources).
- **`npso`**: [nPSO_model](https://github.com/biomedical-cybernetics/nPSO_model).

Portions of the code, documentation, and visualizations were written with help from [Claude](https://www.anthropic.com/claude) via Claude Code.
