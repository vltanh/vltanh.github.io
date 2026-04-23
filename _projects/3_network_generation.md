---
layout: page
title: Synthetic Network Generators
permalink: /projects/network-generation/
description: A pipeline-unified gallery of community-aware synthetic network generators, each illustrated stage by stage on the same small example.
img: assets/img/netgen/feature.png
og_image: /assets/img/netgen/feature.png
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

Given an empirically observed network $$G$$ (undirected, unweighted, and simple graph) together with a community structure $$\mathcal{C}$$ on its nodes (either ground-truth or produced by a community-detection algorithm), we want to sample a family of networks that are *statistically similar* to $$G$$ and $$\mathcal{C}$$ without being identical. What "statistically similar" means differs from one generator to the next: each freezes a different summary of $$G$$ and $$\mathcal{C}$$, and randomises the rest.

This project wraps seven such generators under a single two-stage pipeline: one stage extracts a small statistical profile from the input, the other consumes the profile and samples a synthetic output. The pipeline is intentionally decoupled, so the same profile can feed different generators, and the same generator can be pointed at different profiles.

<div class="row justify-content-center">
  <div class="col-sm-12 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/netgen/feature.png" title="20-node synthetic example" class="img-fluid rounded z-depth-1" caption="The 20-node example used in every per-generator walkthrough: 18 clustered nodes across C1 (8), C2 (6), and C3 (4), plus 2 outliers. 45 edges total: 32 intra-cluster, 8 inter-cluster, 4 clustered-outlier, 1 outlier-outlier." %}
  </div>
</div>

<p style="text-align:center; margin-top:1rem;"><a href="/netgen/">open the interactive walkthrough &rarr;</a></p>

## Walk through them

Each generator has its own page: a vertical scroll that starts with the question the generator tries to answer, meets the shared input, walks through the stages one widget at a time, and ends with a plain note on what is preserved and what drifts.

**Block-model-based generators.** Central objects: the cluster assignment $$\mathcal{C}$$, the block-to-block edge-count matrix, and (as the variants here all use the degree-corrected SBM) the per-node degree sequence. Variants add further structural constraints (per-cluster edge connectivity) on top.

- [sbm](/netgen/sbm.html): the degree-corrected variant of the classic SBM. Keeps the cluster assignment $$\mathcal{C}$$, the block-to-block edge counts, and the per-node degree sequence; the rest is random. The baseline the other block-model variants build on.
- [ec-sbm-v1](/netgen/ec-sbm-v1.html): SBM with an edge-connectivity guarantee: each output cluster is at least as edge-connected as its input counterpart, delivered by stitching a hand-built $$k$$-edge-connected core into each cluster before sampling. Outliers are treated as singleton clusters, which effectively replicates the edges between them; a naive greedy matcher fills any residual degree deficit.
- [ec-sbm-v2](/netgen/ec-sbm-v2.html): same edge-connectivity guarantee as v1, with two changes. Treating outliers as singleton clusters, as v1 does, can accidentally regenerate community-like structure among them; v2 folds all outliers into a single block instead. Residual accounting is cleaner too: one SBM call, a block-preserving rewire, and a hybrid degree-matching pass.

**Mixing-parameter-based generators.** Central object: a single scalar setting the proportion of edges that cross cluster boundaries. Variants differ in what drives the degrees and cluster sizes.

- [lfr](/netgen/lfr.html): fits power laws to the degree distribution and the cluster sizes, resamples both from scratch, and discards the original. Mixing is the mean of a per-node fraction $$\mu$$; the long-standing community-detection benchmark.
- [abcd](/netgen/abcd.html): a faster, more tractable alternative to LFR. Takes the degree sequence and cluster sizes as given; a single global mixing parameter $$\xi$$ sets the proportion of edges that cross cluster boundaries.
- [abcd+o](/netgen/abcd+o.html): ABCD with an explicit outlier block. Outliers connect only outward and never to each other.

**Geometric generators.** Nodes placed in a latent geometric space; edges drawn from proximity. The only family here where clustering coefficient is a design goal rather than a side effect.

- [npso](/netgen/npso.html): embeds nodes on a hyperbolic disk and connects pairs that lie close in the geometry; a temperature knob trades clustering coefficient against randomness.

## Reproducibility

Every generator is deterministic: same seed plus same toolchain gives the same output. Small toolchain changes can shift the exact output for some methods, though each one's statistical properties stay intact.

Canonical hashes, a pinned toolchain snapshot, and the isolated benchmark harness all live in the [repo](https://github.com/vltanh/network-generation) under `examples/benchmark/`.

## Acknowledgements

- **`sbm`**: [graph-tool](https://graph-tool.skewed.de/) ([paper](https://doi.org/10.1103/PhysRevE.95.012317)).
- **`ec-sbm-v1`**: [illinois-or-research-analytics/ec-sbm](https://github.com/illinois-or-research-analytics/ec-sbm) ([paper](https://doi.org/10.1007/s41109-025-00701-2)); uses [python-mincut](https://github.com/vikramr2/python-mincut).
- **`ec-sbm-v2`**: extended from `ec-sbm-v1`; unpublished.
- **`abcd`**: [ABCDGraphGenerator.jl](https://github.com/bkamins/ABCDGraphGenerator.jl) ([paper](https://doi.org/10.1017/nws.2020.45)).
- **`abcd+o`**: [ABCDGraphGenerator.jl](https://github.com/bkamins/ABCDGraphGenerator.jl) ([paper](https://doi.org/10.1007/s41109-023-00552-9)).
- **`lfr`**: [LFRbenchmarks](https://github.com/andrealancichinetti/LFRbenchmarks) ([paper](https://doi.org/10.1103/PhysRevE.78.046110)).
- **`npso`**: [nPSO_model](https://github.com/biomedical-cybernetics/nPSO_model) ([paper](https://doi.org/10.1088/1367-2630/aac06f)).

Portions of the code, documentation, and visualizations were written with help from [Claude](https://www.anthropic.com/claude) via Claude Code.
