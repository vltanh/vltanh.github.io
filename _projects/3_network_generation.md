---
layout: page
title: Synthetic Network Generators
permalink: /projects/network-generation/
description: Seven synthetic-network generators under one pipeline. Each page walks through the algorithm step by step on a small synthetic graph.
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

This project wraps seven synthetic-network generators under one two-stage pipeline. Stage 1 reads an empirical network plus a reference clustering and extracts a statistical profile. Stage 2 consumes the profile and samples a synthetic graph from a parametric model. The two stages are decoupled: the same profile can feed multiple generators, and the same generator can consume different profiles.

The question each generator answers is "given an empirical network G, what does the synthetic G' guarantee to look like?". Some statistics are preserved exactly (node count, block structure, cluster sizes), some hold only in expectation (global mixing fraction, degree distribution), and some are pursued via a search that does not always converge (clustering coefficient under nPSO).

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/netgen/title.svg" title="Small synthetic network used in all 7 visualizations" class="img-fluid rounded z-depth-1" caption="The 20-node shared synthetic graph: cluster C1 (azure), C2 (amber), C3 (mint), and two background outliers (red). All seven interactive visualizations animate their algorithm on this same input, so that the differences in what each generator preserves become visible side by side." %}
    </div>
</div>

## Interactive visualizations

One HTML per generator, self-contained, step-by-step through the default-settings algorithm on the small synthetic above.

- [sbm](/netgen/sbm.html): degree-corrected micro-SBM via graph-tool, then self-loop and parallel-edge cleanup.
- [ec-sbm-v1](/netgen/ec-sbm-v1.html): K_{k+1} cores for per-cluster edge-connectivity, then SBM overlay, then outlier SBM, then heap-greedy degree matching.
- [ec-sbm-v2](/netgen/ec-sbm-v2.html): constructive cores only, then residual SBM with block-preserving rewire, then hybrid degree matcher.
- [abcd](/netgen/abcd.html): ABCD configuration-model hybrid with per-node mixing split by global ξ.
- [abcd+o](/netgen/abcd+o.html): ABCD with explicit outlier mega-cluster as cluster_id=1 and an OO-exclusion constraint.
- [lfr](/netgen/lfr.html): fit-and-resample power laws on degrees and cluster sizes, then configuration-model hybrid with mean-μ split.
- [npso](/netgen/npso.html): hyperbolic-disk embedding with a secant-over-midpoint temperature search to match the input's global clustering coefficient.

## The generators at a glance

| Generator   | Model family                                        | Stage-2 sampler                                                       |
| ----------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| sbm         | Degree-corrected stochastic block model             | `graph_tool.generate_sbm`                                             |
| ec-sbm-v1   | SBM + edge-connectivity guarantee + outlier SBM     | K_{k+1} cores + full-SBM overlay + separate outlier SBM + heap greedy |
| ec-sbm-v2   | SBM + edge-connectivity guarantee + residual SBM    | Constructive cores + residual SBM + block-preserving rewire + hybrid  |
| abcd        | Artificial Benchmark for Community Detection        | `ABCDGraphGenerator.jl`                                               |
| abcd+o      | ABCD with explicit outliers                         | `ABCDGraphGenerator.jl` (n_outliers > 0)                              |
| lfr         | Lancichinetti-Fortunato-Radicchi benchmark          | `unweighted_undirected/benchmark` (C++)                               |
| npso        | Non-uniform popularity-similarity optimisation      | `nPSO_model` (MATLAB), wrapped in a secant search over temperature    |

## Guarantees summary

| Property                                | sbm  | ec-sbm-v1 | ec-sbm-v2 | abcd | abcd+o | lfr  | npso |
| --------------------------------------- | ---- | --------- | --------- | ---- | ------ | ---- | ---- |
| Number of nodes                         | ✓    | ✓         | ✓         | ✓    | ✓      | ✓    | ✓    |
| Cluster sizes                           | ✓    | ✓         | ✓         | ✓    | ✓      | —    | —    |
| Degree sequence                         | ≈    | ≈         | ≈         | ≈    | ≈      | —    | —    |
| Block structure (input partition)       | ✓    | ✓         | ✓         | —    | —      | —    | —    |
| Inter-cluster edge counts               | ≈    | ≈         | ≈         | —    | —      | —    | —    |
| Per-cluster edge connectivity ≥ k       | —    | ✓         | ✓         | —    | —      | —    | —    |
| Global mixing ξ                         | —    | —         | —         | ≈    | ≈      | —    | —    |
| Mean per-node mixing μ                  | —    | —         | —         | —    | —      | ≈    | —    |
| Global clustering coefficient           | —    | —         | —         | —    | —      | —    | ≈*   |
| Outliers identifiable in output         | —    | —         | —         | —    | ✓      | —    | ✓    |
| Byte-reproducible from `--seed`         | ✓    | ✓         | ✓         | ✓    | ✓      | ✓    | ✓    |

✓ preserved exactly, ≈ targeted with perturbation, — not a model parameter. ≈* targets global clustering coefficient via secant search; when the model's achievable range does not include the input's value (e.g. on a very highly-clustered input) the output is the best achieved rather than a match.

## Design

- **Two-stage pipeline.** Stage 1 extracts a profile. Stage 2 samples from a parametric model. Both stages cache their outputs via a hash-based done-file scheme so reruns at unchanged inputs are free.
- **Seven simple CLIs** plus a small number of shared modules (profile primitives, graph utilities, degree matching, edgelist combining) that the per-generator wrappers compose.
- **Determinism.** All seven generators are byte-reproducible under a fixed `--seed` on a fixed toolchain. `PYTHONHASHSEED=0` is load-bearing for the graph-tool-based generators because set/dict iteration order affects the sampler's internal trajectory.
- **Outlier semantics.** Three modes (`excluded`, `singleton`, `combined`) plus an optional drop of outlier-outlier edges. Each generator picks the default that fits its sampler's constraints.
- **Benchmarked under an isolated cgroup.** `scripts/benchmark/bench_isolated.sh` pins CPU via `taskset`, caps memory via `systemd-run --user --scope`, and samples cgroup memory per second. Byte-identity holds across all 100 kept runs per generator on this laptop.

## Acknowledgements

- Algorithms: the degree-corrected SBM literature (Karrer & Newman); the ABCD model (Kamiński, Prałat, Théberge); the LFR benchmark (Lancichinetti, Fortunato, Radicchi); the nPSO model (Muscoloni & Cannistraci).
- Implementations: [`graph-tool`](https://graph-tool.skewed.de/), [`ABCDGraphGenerator.jl`](https://github.com/bkamins/ABCDGraphGenerator.jl), the LFR C++ benchmark binary, the [`nPSO_model`](https://github.com/biomedical-cybernetics/nPSO_model) MATLAB package, [`networkit`](https://github.com/networkit/networkit), [`powerlaw`](https://pypi.org/project/powerlaw/), [`pymincut`](https://github.com/llekha/pymincut).
- Code and visualizations developed with help from [**Anthropic Claude**](https://claude.ai/) and the [`/frontend-design`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/) skill.
