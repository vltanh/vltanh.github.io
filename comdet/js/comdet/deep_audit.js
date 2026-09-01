(function (global) {
  "use strict";

  const REPO = "https://github.com/vltanh/community-detection/blob/main/";
  const SITE = "https://github.com/vltanh/vltanh.github.io/blob/main/comdet/";

  const papers = {
    leiden: {
      label: "Traag, Waltman & van Eck 2019 · Leiden",
      url: "https://www.nature.com/articles/s41598-019-41695-z",
    },
    cpm: {
      label: "Traag, Van Dooren & Nesterov 2011 · CPM",
      url: "https://journals.aps.org/pre/abstract/10.1103/PhysRevE.84.016114",
    },
    louvain: {
      label: "Blondel et al. 2008 · Louvain",
      url: "https://iopscience.iop.org/article/10.1088/1742-5468/2008/10/P10008",
    },
    infomap: {
      label: "Rosvall & Bergstrom 2008 · map equation",
      url: "https://www.pnas.org/doi/10.1073/pnas.0706851105",
    },
    ikc: {
      label: "Wedell et al. 2022 · IKC / kmp",
      url: "https://direct.mit.edu/qss/article/3/1/108/108297/Center-periphery-structure-in-research",
    },
    sbm: {
      label: "Peixoto 2017 · Bayesian SBM inference",
      url: "https://arxiv.org/abs/1705.10225",
    },
    dc: {
      label: "Karrer & Newman 2011 · degree correction",
      url: "https://journals.aps.org/pre/abstract/10.1103/PhysRevE.83.016107",
    },
    nested: {
      label: "Peixoto 2014 · nested SBM",
      url: "https://journals.aps.org/prx/abstract/10.1103/PhysRevX.4.011047",
    },
    pp: {
      label: "Zhang & Peixoto 2020 · assortative PP",
      url: "https://journals.aps.org/prresearch/abstract/10.1103/PhysRevResearch.2.043271",
    },
    park: {
      label: "Park et al. 2024 · well-connected clusters",
      url: "https://journals.plos.org/complexsystems/article?id=10.1371/journal.pcsy.0000009",
    },
    parkSbm: {
      label: "Park et al. 2025 · improved SBM clustering",
      url: "https://doi.org/10.1007/978-3-031-82435-7_9",
    },
    vulele: {
      label: "Vu-Le et al. 2026 · connectivity modification",
      url: "https://doi.org/10.1007/s41109-025-00747-2",
    },
    viecut: {
      label: "Henzinger et al. 2018 · practical minimum cut",
      url: "https://doi.org/10.1137/1.9781611975055.5",
    },
    exactMincut: {
      label: "Henzinger et al. 2019 · exact shared-memory mincut",
      url: "https://doi.org/10.1109/IPDPS.2019.00013",
    },
    cactus: {
      label: "Henzinger et al. 2020 · all global mincuts",
      url: "https://doi.org/10.4230/LIPIcs.ESA.2020.59",
    },
  };

  function src(label, path) {
    return { label: label, url: REPO + path };
  }

  function pageSrc(label, path) {
    return { label: label, url: SITE + path };
  }

  function external(label, url) {
    return { label: label, url: url };
  }

  const audits = {
    "leiden-cpm": {
      title: "Leiden · constant Potts model",
      verdict: "Kernel-faithful · shortened schedule",
      tone: "qualified",
      papers: [papers.cpm, papers.leiden],
      paper:
        "CPM rewards internal edge weight and penalizes every possible within-group pair by γ. Leiden adds local moving, constrained refinement, and aggregation. The paper’s strongest asymptotic guarantees depend on randomized refinement and convergence, not on a single greedy iteration.",
      production:
        "run_leiden.py calls leidenalg.CPMVertexPartition with the requested resolution, seed 1234 by default, and n_iterations=2. It then drops singleton communities and renumbers the survivors.",
      walker:
        "The browser records every queue pop, candidate ΔH, accepted move, re-queued neighbor, refined merge, and collapse for one libleidenalg-shaped optimisePartition call. Its default is seed 42 and γ=0.05; the displayed undirected ΔH is divided by two relative to the doubled C++ bookkeeping convention.",
      gaps: [
        "One outer iteration here versus two in the shipped Python wrapper.",
        "Greedy refinement mirrors libleidenalg, but not the paper’s randomized refinement; uniform γ-density and subset-optimality therefore are not claims this trace can make.",
        "Seed zero is a special C++ case; the default nonzero page seed avoids that mismatch.",
      ],
      sources: [
        src("production wrapper", "src/leiden/run_leiden.py"),
        src("technical audit", "docs/algorithms/leiden.md"),
        pageSrc("walker kernel", "js/leiden/leiden.js"),
      ],
    },
    "leiden-mod": {
      title: "Leiden · modularity",
      verdict: "Kernel-faithful · shortened schedule",
      tone: "qualified",
      papers: [papers.leiden, papers.louvain],
      paper:
        "Leiden optimizes the same degree-corrected null-model modularity used by Louvain, then refines before aggregation so communities satisfy progressively stronger connectivity properties. It improves the optimizer; it does not remove modularity’s resolution limit.",
      production:
        "run_leiden.py selects leidenalg.ModularityVertexPartition, seed 1234, and two outer iterations, then omits singleton outputs. There is no resolution parameter in this wrapper branch.",
      walker:
        "The page exposes the exact local-move queue and greedy refinement mechanics for one iteration at seed 42. Candidate scores use maintained community totals and the same positive-gain threshold as the port.",
      gaps: [
        "The walker stops after one outer iteration; the wrapper defaults to two and the paper describes iteration to stability.",
        "Greedy refinement gives the libleidenalg behavior, not the randomized-paper trajectory or its strongest asymptotic guarantees.",
        "A better optimizer cannot recover small communities hidden by modularity’s global null model.",
      ],
      sources: [
        src("production wrapper", "src/leiden/run_leiden.py"),
        src("technical audit", "docs/algorithms/leiden.md"),
        pageSrc("walker kernel", "js/leiden/leiden.js"),
      ],
    },
    louvain: {
      title: "Louvain modularity",
      verdict: "Algorithm-faithful · different trajectory",
      tone: "qualified",
      papers: [papers.louvain],
      paper:
        "The original method alternates greedy node moves with community aggregation until no level improves modularity. It offers speed and a hierarchy, but no internal-connectivity guarantee for a reported community.",
      production:
        "The wrapper drives the vendored convert → louvain → hierarchy executables, reads the deepest level, then removes singleton communities. Reproducible runs intercept upstream srand(time+pid) with an LD_PRELOAD seed shim; arithmetic and shuffling remain the C++ libc-rand/long-double path.",
      walker:
        "The browser mirrors singleton initialization, neighbor-community enumeration, strict positive moves, full sweeps, renumbering, aggregation, and projection. It uses MT19937 and JavaScript numbers, so its per-node route is validated against a tracer shaped like the browser—not against the unmodified executable under the same numeric seed.",
      gaps: [
        "Matching seed numbers do not imply matching visit orders: libc rand and MT19937 are different streams.",
        "The browser displays every fixture node; the production CSV drops singleton clusters.",
        "The final modularity story is faithful, but exact move-by-move identity with upstream gen-louvain is not claimed.",
      ],
      sources: [
        src("production wrapper", "src/louvain/run_louvain.py"),
        src("seed shim", "src/louvain/seed_shim/louvain_seed_preload.c"),
        src("technical audit", "docs/algorithms/louvain.md"),
        pageSrc("walker kernel", "js/louvain/louvain.js"),
      ],
    },
    infomap: {
      title: "Infomap",
      verdict: "Conceptual paper trace · not production trace",
      tone: "warning",
      papers: [papers.infomap],
      paper:
        "The map equation compresses a random walk with an index codebook between modules and local codebooks within modules. The 2008 algorithm used greedy joins plus simulated-annealing-style refinement and recursive submodule search.",
      production:
        "run_infomap.py constructs Infomap() with v2.9.2 defaults and calls run(). The maintained engine performs a modern multilevel top-module search with randomized single-node moves, fine tuning, coarse tuning, safeguards, and its own default RNG/configuration path.",
      walker:
        "The page teaches stationary flow, the two-level code length, adjacent-module joins, greedy node tuning, and hierarchy formation. It is deliberately a 2008-paper-style port; its greedy tuning is also simpler than the paper’s heat-bath annealing.",
      gaps: [
        "The production optimizer is Infomap 2.9.2, not the animated pair-join procedure.",
        "Fine/coarse tuning, modern aggregation limits, random candidate ordering, and one-module safeguards are absent from the visible walker.",
        "A documented fixture reaches only about ARI 0.29 between the paper port and maintained binary; the page must be read as an objective explainer, not a binary replay.",
      ],
      sources: [
        src("production wrapper", "src/infomap/run_infomap.py"),
        external("vendored engine", "https://github.com/mapequation/infomap/blob/cc3bf2c/src/core/InfomapBase.cpp"),
        src("technical audit", "docs/algorithms/infomap.md"),
        pageSrc("paper walker", "js/infomap/infomap.js"),
      ],
    },
    ikc: {
      title: "Iterative k-core clustering",
      verdict: "Shipped Stage 1 exact · paper pipeline partial",
      tone: "qualified",
      papers: [papers.ikc],
      paper:
        "The paper’s kmp pipeline iteratively extracts maximum-core components, applies k-validity and modularity validity, and later uses p-validity/periphery assignment. Its scientific object is a center–periphery clustering, not only a core peel.",
      production:
        "src/ikc/run_ikc.py ships the IKC core-extraction stage. It computes residual core numbers, takes components at the current maximum k, enforces k-validity, emits accepted components, and repeats. The modular() function immediately returns a positive constant; p-validity is not implemented.",
      walker:
        "The default trace follows that shipped Stage-1 behavior, including a partial partition. A separate strict-paper toggle evaluates the modularity formula for teaching, but that toggle is not the production run.",
      gaps: [
        "The hard-coded positive modularity return makes the production modularity gate dead code.",
        "p-validity and the later periphery assignment from kmp are outside src/ikc.",
        "Unassigned low-core nodes are an intended output shape here, not missing renderer data.",
      ],
      sources: [
        src("production implementation", "src/ikc/run_ikc.py"),
        src("technical audit", "docs/algorithms/ikc.md"),
        pageSrc("walker kernel", "js/ikc/ikc.js"),
      ],
    },
    "sbm-flat-best": {
      title: "Flat SBM selector",
      verdict: "Comparison demo · not a selector surrogate",
      tone: "warning",
      papers: [papers.sbm, papers.dc, papers.pp],
      paper:
        "Bayesian model selection compares complete description lengths under explicitly defined, commensurate model priors. Lower entropy is evidence only when the fitted states use the intended likelihoods and coding conventions.",
      production:
        "Three independent graph-tool runs write state.entropy() for flat DC, NDC, and PPBlockState. choose_best_sbm.py reads those canonical files, applies idxmin, and symlinks the winning com.csv.",
      walker:
        "The page gives all three educational JavaScript kernels the same random B=8 initialization and 20-sweep budget, then compares their simplified objectives. Those curves explain how assumptions change a search; their absolute Σ values are not the values consumed by choose_best_sbm.py.",
      gaps: [
        "Do not use the browser winner as a prediction of the production selector.",
        "The three JavaScript objectives do not reproduce graph-tool’s full priors, proposals, multilevel merge moves, or initialization.",
        "A fixed short sweep budget measures transient optimizer behavior as well as model fit.",
      ],
      sources: [
        src("canonical fits", "src/sbm/run_sbm.py"),
        src("selector", "src/sbm/choose_best_sbm.py"),
        src("technical audit", "docs/algorithms/sbm.md"),
        pageSrc("comparison glue", "js/sbm/compare_page.js"),
      ],
    },
    "sbm-flat-dc": {
      title: "Flat degree-corrected SBM",
      verdict: "Pedagogical fork · objective-shaped",
      tone: "warning",
      papers: [papers.dc, papers.sbm],
      paper:
        "Degree correction conditions on heterogeneous vertex degrees so blocks represent mixing patterns rather than merely degree classes. Bayesian inference jointly pays for the partition, edge counts, and degree sequence.",
      production:
        "run_sbm.py calls graph-tool minimize_blockmodel_dl with BlockState(deg_corr=True), after removing parallel edges and self-loops and seeding NumPy plus graph-tool. The minimizer uses multilevel agglomeration and graph-tool’s canonical proposal machinery.",
      walker:
        "The browser maintains DC sufficient statistics and exact lgamma-based description terms, proposes uniformly among a fixed B=8 block set, and accepts with a symmetric Metropolis rule over short sweeps.",
      gaps: [
        "graph-tool uses neighbor-informed proposals with a Hastings correction; the page uses uniform proposals and no correction.",
        "graph-tool’s default sweep entropy approximation and multilevel merge search are absent.",
        "MT19937, random B=8 initialization, and exact lgamma arithmetic make the path a validated educational fork, not graph-tool parity.",
      ],
      sources: [
        src("production wrapper", "src/sbm/run_sbm.py"),
        src("technical audit", "docs/algorithms/sbm.md"),
        pageSrc("browser state", "js/sbm/block_state.js"),
        pageSrc("browser MCMC", "js/sbm/mcmc.js"),
      ],
    },
    "sbm-flat-ndc": {
      title: "Flat non-degree-corrected SBM",
      verdict: "Pedagogical fork · objective-shaped",
      tone: "warning",
      papers: [papers.sbm],
      paper:
        "The traditional SBM gives vertices in one block a shared connection-rate profile. Without degree correction, within-block degree homogeneity is part of the hypothesis and hubs can drive extra blocks.",
      production:
        "run_sbm.py calls graph-tool minimize_blockmodel_dl with BlockState(deg_corr=False). The returned state and canonical state.entropy() are what the pipeline writes and compares.",
      walker:
        "The page exposes block sizes, edge-count updates, every candidate ΔΣ, and Metropolis decisions for a fixed B=8 educational chain using exact combinatorial terms.",
      gaps: [
        "Uniform block proposals replace graph-tool’s neighbor-informed proposal and Hastings ratio.",
        "The fixed initialization and sweep count omit graph-tool’s multilevel search over the number of blocks.",
        "The visible entropy trajectory is useful within this fork only; it is not the production entropy.txt.",
      ],
      sources: [
        src("production wrapper", "src/sbm/run_sbm.py"),
        src("technical audit", "docs/algorithms/sbm.md"),
        pageSrc("browser state", "js/sbm/block_state.js"),
        pageSrc("browser MCMC", "js/sbm/mcmc.js"),
      ],
    },
    "sbm-flat-pp": {
      title: "Flat planted-partition SBM",
      verdict: "Different PP model · conceptual only",
      tone: "warning",
      papers: [papers.pp],
      paper:
        "The assortative planted-partition model compresses block interactions into within-group and between-group structure. Zhang and Peixoto’s formulation includes degree information and priors needed for Bayesian model comparison.",
      production:
        "run_sbm.py asks graph-tool to minimize with PPBlockState. That state’s entropy includes the graph, in/out edge totals, partition, and degree sequence under graph-tool’s non-uniform planted-partition model.",
      walker:
        "The browser uses a simpler two-rate assortative objective over the shared B=8 educational sampler. It communicates the within-versus-between constraint well, but it is not graph-tool PPBlockState.",
      gaps: [
        "The browser’s two-rate likelihood and graph-tool’s degree-aware PPBlockState are materially different statistical models.",
        "The proposal, prior, initialization, and multilevel minimization gaps from the other SBM pages also apply.",
        "Its Σ must not be compared numerically with production PP entropy or treated as a Bayes factor.",
      ],
      sources: [
        src("production wrapper", "src/sbm/run_sbm.py"),
        external("vendored PP state", "https://git.skewed.de/count0/graph-tool/-/blob/3ac28ebc/src/graph_tool/inference/planted_partition.py"),
        src("technical audit", "docs/algorithms/sbm.md"),
        pageSrc("browser PP model", "js/sbm/block_state.js"),
      ],
    },
    "sbm-nested-best": {
      title: "Nested SBM selector",
      verdict: "Qualitative hierarchy comparison",
      tone: "warning",
      papers: [papers.nested, papers.dc],
      paper:
        "A nested SBM recursively models block-edge-count graphs, paying for every hierarchy level. Model selection can compare degree-corrected and traditional hierarchies only through their complete canonical description lengths.",
      production:
        "Two graph-tool minimize_nested_blockmodel_dl runs produce nested DC and NDC states; the selector compares their state.entropy() files and returns level-0 blocks from the winning hierarchy.",
      walker:
        "The page runs two simplified NestedBlockState forks from the same base initialization and emphasizes level-0 traces. Upper levels are rebuilt for explanation, not sampled with graph-tool’s coupled multilevel optimizer.",
      gaps: [
        "The browser verdict is not the value chosen by nested_best_pipeline.sh.",
        "Only level 0 has a full move walker; upper-level evidence is qualitative.",
        "Canonical hierarchy priors and cross-level coupling are simplified, so absolute Σ values are not selector inputs.",
      ],
      sources: [
        src("canonical fits", "src/sbm/run_sbm.py"),
        src("nested selector", "src/sbm/nested_best_pipeline.sh"),
        src("technical audit", "docs/algorithms/sbm.md"),
        pageSrc("comparison glue", "js/sbm/compare_page.js"),
      ],
    },
    "sbm-nested-dc": {
      title: "Nested degree-corrected SBM",
      verdict: "Level-0 teaching fork · hierarchy qualitative",
      tone: "warning",
      papers: [papers.nested, papers.dc],
      paper:
        "The nested degree-corrected SBM models heterogeneous node degrees at the base and recursively models the block multigraph above it, avoiding the flat SBM’s resolution limit through hierarchical priors.",
      production:
        "run_sbm.py calls minimize_nested_blockmodel_dl with deg_corr=True and writes the base-level blocks plus the entropy of the complete graph-tool hierarchy.",
      walker:
        "The page gives a detailed base-level DC move trace, then constructs explanatory upper block graphs. The JavaScript NestedBlockState uses its own simplified hierarchy entropy and schedule.",
      gaps: [
        "The base sampler retains the uniform-proposal, no-Hastings, exact-lgamma, fixed-B departures.",
        "Upper levels are not a move-by-move port of graph-tool’s nested optimization.",
        "The final page hierarchy should be interpreted structurally, not as the canonical posterior trajectory.",
      ],
      sources: [
        src("production wrapper", "src/sbm/run_sbm.py"),
        src("technical audit", "docs/algorithms/sbm.md"),
        pageSrc("nested state", "js/sbm/nested_state.js"),
        pageSrc("base walker", "js/sbm/walker_page.js"),
      ],
    },
    "sbm-nested-ndc": {
      title: "Nested non-degree-corrected SBM",
      verdict: "Level-0 teaching fork · hierarchy qualitative",
      tone: "warning",
      papers: [papers.nested, papers.sbm],
      paper:
        "The nested traditional SBM recursively describes block interactions while retaining degree homogeneity as part of each base-block hypothesis. Hierarchical coding regularizes the number and scale of blocks.",
      production:
        "run_sbm.py calls minimize_nested_blockmodel_dl with deg_corr=False and writes level-0 membership plus the full graph-tool hierarchy entropy.",
      walker:
        "The page animates the simplified non-degree-corrected level-0 sampler and renders the resulting block graphs above it; it does not animate canonical upper-level optimization.",
      gaps: [
        "Uniform proposals, no Hastings term, fixed random B=8, and no canonical merge moves change the base trajectory.",
        "The hierarchy cost omits or simplifies graph-tool’s cross-level prior coupling.",
        "Upper-level diagrams explain nesting but do not certify graph-tool parity.",
      ],
      sources: [
        src("production wrapper", "src/sbm/run_sbm.py"),
        src("technical audit", "docs/algorithms/sbm.md"),
        pageSrc("nested state", "js/sbm/nested_state.js"),
        pageSrc("base walker", "js/sbm/walker_page.js"),
      ],
    },
    cc: {
      title: "Connected-components repair",
      verdict: "Binary-faithful deterministic core",
      tone: "good",
      papers: [papers.park, papers.parkSbm, papers.vulele],
      paper:
        "CC is a baseline inside the connectivity-modification papers, not a separately proposed detector: delete edges between existing labels, split each label into connected components, and retain nontrivial pieces.",
      production:
        "src/cc/pipeline.sh invokes constrained-clustering MincutOnly with criterion 0. The binary strips cross-label edges, seeds a FIFO with connected components, accepts connected pieces immediately, drops singleton pieces, and assigns output labels by queue order.",
      walker:
        "The page follows the same deterministic strip → BFS components → singleton removal → emit path. There is no mincut or RNG decision when the threshold is zero.",
      gaps: [
        "Connectedness is weak: one bridge is enough for a cluster to survive unchanged.",
        "The wrapper records --seed metadata but the MincutOnly CLI receives no seed; this is behaviorally irrelevant for CC’s no-mincut path.",
        "Singleton components disappear from production com.csv even though the page keeps them visible as rejected nodes.",
      ],
      sources: [
        src("pipeline wrapper", "src/cc/pipeline.sh"),
        external(
          "binary core",
          "https://github.com/MinhyukPark/constrained-clustering/blob/873dfe51985277c1896f3e5b557cef5fabcc4721/src/mincut_only.cpp"
        ),
        src("technical audit", "docs/algorithms/cc.md"),
        pageSrc("walker", "js/cc/page.js"),
      ],
    },
    wcc: {
      title: "Well-connected clusters",
      verdict: "Binary-core faithful at production seed 0",
      tone: "qualified",
      papers: [papers.park, papers.parkSbm, papers.vulele],
      paper:
        "WCC recursively tests whether a cluster’s global mincut exceeds f(n), splitting failures until every retained piece passes. The papers specify the mathematical criterion; the binary fixes strictness, tie behavior, queue order, backend, and singleton handling.",
      production:
        "The wrapper defaults to f(n)=log10(n). main.cpp seeds VieCut’s MT19937 once with 0 before MincutOnly; mincut calls then share and advance that state. The cactus backend returns a most-balanced minimum cut, a 1e-9 equality band fails the strict test, and singleton cut sides are discarded.",
      walker:
        "The page reproduces the single-thread FIFO recursion and VieCut handoff. Its default seed 0 matches process startup; a nonzero URL/control seed is a teaching experiment, not a value the shipped wrapper passes to the binary.",
      gaps: [
        "The pipeline accepts --seed and records it in metadata, but never forwards it; production is hard-coded to seed 0.",
        "With multiple worker threads, completion order can change output label IDs even when the unlabeled partition is stable.",
        "The paper does not specify the binary’s 1e-9 fail band or most-balanced cactus tie-break.",
      ],
      sources: [
        src("pipeline wrapper", "src/wcc/pipeline.sh"),
        external(
          "seed initialization",
          "https://github.com/MinhyukPark/constrained-clustering/blob/873dfe51985277c1896f3e5b557cef5fabcc4721/src/main.cpp"
        ),
        external(
          "threshold core",
          "https://github.com/MinhyukPark/constrained-clustering/blob/873dfe51985277c1896f3e5b557cef5fabcc4721/includes/constrained.h"
        ),
        src("technical audit", "docs/algorithms/wcc.md"),
        pageSrc("walker", "js/wcc/page.js"),
      ],
    },
    cm: {
      title: "Connectivity modifier",
      verdict: "Binary core only · not full paper pipeline",
      tone: "warning",
      papers: [papers.park, papers.vulele],
      paper:
        "CM tests a candidate with a mincut, re-clusters each failing side with the base detector, and repeats over the lineage. The experimental paper pipeline also uses log10(n), degree-band pruning, a minimum-size B filter, and analysis-side tree/fate logic.",
      production:
        "src/cm/pipeline.sh calls the C++ core with an existing clustering, one of three accepted base algorithms, cactus mincut, and wrapper default 0.2√n—even though the binary default and paper rule are log10(n). main.cpp seeds VieCut once with 0; each base re-clustering worker receives seed 0. The wrapper’s --seed is metadata only.",
      walker:
        "The page traces the shipped binary core with pruning off: strip, mincut, pass-or-recluster, child queue, and history. It intentionally keeps every binary survivor and does not apply the external degree-band prune, B=11 filter, or analysis fate classification.",
      gaps: [
        "The page opens on the paper’s log10(n) trace, while the repository wrapper defaults to 0.2√n; the selector labels both and they produce different fixture outcomes.",
        "Paper-level pruning, minimum-size filtering, and some tree analyses live outside constrained_clustering and are absent from the walker.",
        "The page’s seed control is educational; neither CM pipeline.sh nor the binary exposes that seed to users.",
      ],
      sources: [
        src("pipeline wrapper", "src/cm/pipeline.sh"),
        external("binary loop", "https://github.com/MinhyukPark/constrained-clustering/blob/873dfe51985277c1896f3e5b557cef5fabcc4721/src/cm.cpp"),
        external(
          "seed initialization",
          "https://github.com/MinhyukPark/constrained-clustering/blob/873dfe51985277c1896f3e5b557cef5fabcc4721/src/main.cpp"
        ),
        src("technical audit", "docs/algorithms/cm.md"),
        pageSrc("walker", "js/cm/page.js"),
      ],
    },
    viecut: {
      title: "VieCut exact mincut / cactus path",
      verdict: "Exact primitive port · deployment boundary matters",
      tone: "qualified",
      papers: [papers.viecut, papers.exactMincut, papers.cactus],
      paper:
        "Three papers are needed here. ALENEX 2018 motivates practical contraction/near-mincut machinery; IPDPS 2019 covers shared-memory exact minimum cuts; ESA 2020 covers the cactus representation of all global minimum cuts used to choose a most-balanced tie.",
      production:
        "MinCutCustom converts each induced igraph component into a VieCut mutable_graph, forces every edge weight to 1, enables find_most_balanced_cut/save_cut/set_node_in_cut, and fixes threads=1. main.cpp seeds MT19937 once with 0 for the whole WCC/CM process; calls do not reseed. cactus_mincut is the default, with NOI selectable.",
      walker:
        "The page traces the exact cactus route: upper bounds, certified contractions, push-relabel probes, residual SCCs, cactus construction, and balanced-cut DFS. Its eight-node fixture is unit-weighted and deliberately exposes internal layers; it is a primitive trace, not a recursive community-detection result.",
      gaps: [
        "The previously cited ALENEX DOI ended in .6; the VieCut paper is .5. The exact shared-memory paper is IPDPS 2019, and the cactus path needs the ESA 2020 paper.",
        "VieCut supports weighted graphs, but the deployed MinCutCustom wrapper discards input weights and inserts weight 1.",
        "mincut_custom.cpp compares from_node with target_node while target_node is still -1, so endpoint sorting never occurs; endpoints are merely reversed, which is harmless for the undirected graph but is a real source defect.",
        "Container iteration order can alter equal-cut trajectories; exact cut value and selected balance are the robust claims, not universal byte identity with every compiler/runtime.",
      ],
      sources: [
        external(
          "deployment adapter",
          "https://github.com/MinhyukPark/constrained-clustering/blob/873dfe51985277c1896f3e5b557cef5fabcc4721/src/mincut_custom.cpp"
        ),
        external("process seed", "https://github.com/MinhyukPark/constrained-clustering/blob/873dfe51985277c1896f3e5b557cef5fabcc4721/src/main.cpp"),
        external("cactus driver", "https://github.com/MinhyukPark/VieCut/blob/bc51bc18/lib/algorithms/global_mincut/cactus/cactus_mincut.h"),
        src("technical audit", "docs/algorithms/viecut.md"),
        pageSrc("walker driver", "js/viecut/cactus_mincut.js"),
      ],
    },
  };

  const order = [
    "leiden-cpm",
    "leiden-mod",
    "louvain",
    "infomap",
    "ikc",
    "sbm-flat-best",
    "sbm-flat-dc",
    "sbm-flat-ndc",
    "sbm-flat-pp",
    "sbm-nested-best",
    "sbm-nested-dc",
    "sbm-nested-ndc",
    "cc",
    "wcc",
    "cm",
    "viecut",
  ];

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function links(items, className) {
    return items
      .map(function (item) {
        return '<a class="' + className + '" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.label) + "</a>";
      })
      .join("");
  }

  function pageKey() {
    const file = (global.location.pathname.split("/").pop() || "").replace(/\.html$/, "");
    return file || "index";
  }

  function renderAudit(key, audit) {
    const section = document.createElement("section");
    section.className = "deep-audit deep-audit--" + audit.tone;
    section.id = "implementation-audit";
    section.setAttribute("aria-labelledby", "implementation-audit-title");
    section.innerHTML =
      '<div class="deep-audit__top"><div><span class="deep-audit__eyebrow">deep audit · paper → shipped code → visualization</span>' +
      '<h2 id="implementation-audit-title">What this page actually proves</h2></div>' +
      '<span class="deep-audit__verdict">' +
      escapeHtml(audit.verdict) +
      "</span></div>" +
      '<div class="deep-audit__chain">' +
      '<article><span class="deep-audit__step">01 · original paper</span><p>' +
      escapeHtml(audit.paper) +
      '</p><div class="deep-audit__links">' +
      links(audit.papers, "deep-audit__paper") +
      "</div></article>" +
      '<article><span class="deep-audit__step">02 · shipped implementation</span><p>' +
      escapeHtml(audit.production) +
      "</p></article>" +
      '<article><span class="deep-audit__step">03 · this walker</span><p>' +
      escapeHtml(audit.walker) +
      "</p></article>" +
      "</div>" +
      '<div class="deep-audit__limits"><h3>Material gaps found in the audit</h3><ul>' +
      audit.gaps
        .map(function (gap) {
          return "<li>" + escapeHtml(gap) + "</li>";
        })
        .join("") +
      "</ul></div>" +
      '<div class="deep-audit__sourcebar"><span>read the evidence</span>' +
      links(audit.sources, "deep-audit__source") +
      '<a class="deep-audit__source deep-audit__ledger-link" href="./audit.html#' +
      key +
      '">all 16 audit verdicts</a></div>';
    return section;
  }

  function mountAlgorithmAudit() {
    const key = pageKey();
    const audit = audits[key];
    const main = document.querySelector("main.page");
    if (!audit || !main || main.querySelector(".deep-audit")) return;
    const section = renderAudit(key, audit);
    const guide = main.querySelector(".lesson-guide");
    const anchor = guide ? guide.nextSibling : main.querySelector(".hook, .algo-meta, section.stage");
    main.insertBefore(section, anchor);
  }

  function mountLedger() {
    if (pageKey() !== "audit") return;
    const target = document.querySelector("#audit-ledger");
    if (!target) return;
    target.innerHTML = order
      .map(function (key, index) {
        const audit = audits[key];
        return (
          '<article class="audit-ledger__row" id="' +
          key +
          '"><div class="audit-ledger__number">' +
          String(index + 1).padStart(2, "0") +
          '</div><div class="audit-ledger__body"><div class="audit-ledger__heading"><h2><a href="./' +
          key +
          '.html#implementation-audit">' +
          escapeHtml(audit.title) +
          '</a></h2><span class="deep-audit__verdict">' +
          escapeHtml(audit.verdict) +
          "</span></div><p><strong>Production:</strong> " +
          escapeHtml(audit.production) +
          "</p><p><strong>Walker:</strong> " +
          escapeHtml(audit.walker) +
          "</p><details><summary>" +
          audit.gaps.length +
          " material audit finding" +
          (audit.gaps.length === 1 ? "" : "s") +
          "</summary><ul>" +
          audit.gaps
            .map(function (gap) {
              return "<li>" + escapeHtml(gap) + "</li>";
            })
            .join("") +
          '</ul><div class="deep-audit__links">' +
          links(audit.papers, "deep-audit__paper") +
          links(audit.sources, "deep-audit__source") +
          "</div></details></div></article>"
        );
      })
      .join("");
  }

  global.COMDET_DEEP_AUDIT = { audits: audits, order: order };
  mountAlgorithmAudit();
  mountLedger();
})(window);
