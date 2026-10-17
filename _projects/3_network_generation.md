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
math: true
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

Given a network $$G$$ (undirected, unweighted, simple) with a community structure $$\mathcal{C}$$ on its nodes, we want to sample a family of networks that are _statistically similar_ to $$G$$ and $$\mathcal{C}$$ without being identical. $$\mathcal{C}$$ can be ground truth or the output of a community-detection algorithm; the generator does not care which. Each generator has its own meaning of "statistically similar": it freezes a different summary of $$G$$ and $$\mathcal{C}$$ and randomises the rest.

Scoring a community-detection algorithm needs networks with a checkable answer. An empirical network has only one labelling, which may itself be wrong, and it is a sample of one. Synthetic networks fix this: each generator emits a network together with its ground-truth clustering, for as many seeds, sizes, and noise levels as the test needs.

This project runs seven such generators through one shared pipeline. One stage profiles the input to extract the parameters a generator needs, the next samples a synthetic network from that profile, and an optional post-processing tail aligns the output back to the input. Because the stages are decoupled, one profile can feed different generators, and one generator can run on different profiles.

<div class="row justify-content-center">
  <div class="col-sm-12 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/netgen/feature.png" title="20-node synthetic example" class="img-fluid rounded z-depth-1" caption="The 20-node example used in every per-generator walkthrough: 18 clustered nodes across C1 (8), C2 (6), and C3 (4), plus 2 outliers. 40 edges total: 27 intra-cluster, 8 inter-cluster, 4 clustered-outlier, 1 outlier-outlier." %}
  </div>
</div>

<p style="text-align:center; margin-top:1rem;"><a href="/netgen/">open the interactive walkthrough &rarr;</a></p>

## Walk through them

Each generator has its own scrolling page: the question it tries to answer, the shared input, the stages one widget at a time, and a note on what is preserved and what drifts.

Generators treat nodes inside a non-trivial community differently from nodes that stand alone, so two labels recur:

- **clustered**: node that belongs to a community of size $$\geq 2$$.
- **outlier**: node that is unclustered, or the sole member of a singleton community.

**Block-model generators** are built on the cluster assignment $$\mathcal{C}$$, the block-to-block edge-count matrix, and the per-node degree sequence. All of them use the degree-corrected SBM, and the variants add further structural constraints (per-cluster edge connectivity) on top.

- [sbm](/netgen/sbm.html): the degree-corrected version of the classic SBM, and the baseline the other block-model variants build on. It keeps exactly those three summaries and randomises the rest.
- [ec-sbm-v1](/netgen/ec-sbm-v1.html): SBM with an edge-connectivity guarantee. Before sampling, a hand-built $$k$$-edge-connected core is stitched into each cluster, so every output cluster is at least as edge-connected as its input counterpart. Outliers are treated as singleton clusters, which replicates the edges between them, and a naive greedy matcher fills any residual degree deficit.
- [ec-sbm-v2](/netgen/ec-sbm-v2.html): the same edge-connectivity guarantee as v1, with two changes. Treating outliers as singleton clusters can accidentally regenerate community-like structure among them, so v2 folds all outliers into a single block. Residual accounting is also simpler: one SBM call, a block-preserving rewire, and a hybrid degree-matching pass.

**Mixing-parameter generators** are built on one scalar, the fraction of edges that cross cluster boundaries. They differ in where the degrees and cluster sizes come from: resampled from a power law, or taken as given.

- [lfr](/netgen/lfr.html): the long-standing community-detection benchmark. It fits power laws to the degree distribution and the cluster sizes, resamples both from scratch, and discards the originals. Mixing is the mean of a per-node fraction $$\mu$$.
- [abcd](/netgen/abcd.html): a faster, more tractable alternative to LFR. It takes the degree sequence and cluster sizes as given, and a single global mixing parameter $$\xi$$ sets the proportion of edges that cross cluster boundaries.
- [abcd+o](/netgen/abcd+o.html): ABCD with an explicit outlier block. The sampler picks the outlier set at random, and outlier-outlier edges are not expected.

**Geometric generators** place nodes in a latent geometric space and draw edges by proximity. This is the only family here that targets clustering coefficient directly; in the others it is a side effect.

- [npso](/netgen/npso.html): embeds nodes on a hyperbolic disk and connects pairs that lie close in the geometry; a temperature knob trades clustering coefficient against randomness.

## Pipeline

Every generator runs the same three stages.

1. **Profile.** Read $$G$$ and $$\mathcal{C}$$, extract only the summary the generator needs (block edge counts, degree sequence, mixing parameter, power-law fits, etc.), and write it out as the only input to the generate stage.
2. **Generate.** Sample a fresh graph from the profile. This stage runs standalone and never reads the original network.
3. **Post-process.** Up to three optional steps. _Match-degree_ rewires the generated edges so the output degree sequence matches the input (see the [degree-matcher comparison](/netgen/matcher.html)). _Simplify_ collapses parallel edges and drops self-loops. _Singleton drop_ removes size-1 clusters and relabels each one's lone node as an outlier.

## Reproducibility

Every generator is deterministic: the same seed and the same toolchain give the same output. For some methods, small toolchain changes can shift the exact output, but the statistical properties stay intact.

Canonical hashes, a pinned toolchain snapshot, and the isolated benchmark harness are in the [repo](https://github.com/vltanh/network-generation) under `examples/benchmark/`.

## Acknowledgements

- **`sbm`**: [graph-tool](https://graph-tool.skewed.de/) ([paper](https://doi.org/10.1103/PhysRevE.95.012317)).
- **`ec-sbm-v1`**: [illinois-or-research-analytics/ec-sbm](https://github.com/illinois-or-research-analytics/ec-sbm) ([paper](https://doi.org/10.1007/s41109-025-00701-2)); uses [python-mincut](https://github.com/vikramr2/python-mincut).
- **`ec-sbm-v2`**: extended from `ec-sbm-v1`; unpublished.
- **`abcd`**: [ABCDGraphGenerator.jl](https://github.com/bkamins/ABCDGraphGenerator.jl) ([paper](https://doi.org/10.1017/nws.2020.45)).
- **`abcd+o`**: [ABCDGraphGenerator.jl](https://github.com/bkamins/ABCDGraphGenerator.jl) ([paper](https://doi.org/10.1007/s41109-023-00552-9)).
- **`lfr`**: [LFRbenchmarks](https://github.com/andrealancichinetti/LFRbenchmarks) ([paper](https://doi.org/10.1103/PhysRevE.78.046110)).
- **`npso`**: [nPSO_model](https://github.com/biomedical-cybernetics/nPSO_model) ([paper](https://doi.org/10.1088/1367-2630/aac06f)).

Portions of the code, documentation, and visualizations were written with help from [Claude](https://www.anthropic.com/claude) via Claude Code.
