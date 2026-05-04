"""Generate per-algorithm UC pages for the comdet gallery.

Each page mirrors netgen's per-generator pattern (typed-note paper aesthetic,
shared header/footer, stage placeholders) but ships under-construction until
its kernel port lands per Phase 4c of plan_state_system_extension.md.

Run from any cwd:
    python3 build_pages.py
"""

from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent

# Per-page manifest. (file, name, fullname, emoji, paper, code, blurb, stages,
#   math_intro). paper/code can be ("", "") to suppress.
PAGES = [
    {
        "file": "leiden-cpm.html",
        "name": "Leiden-CPM",
        "fullname": "Leiden with constant Potts model",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1038/s41598-019-41695-z", "Traag et al. 2019"),
        "code": ("https://github.com/vtraag/leidenalg", "leidenalg + libleidenalg"),
        "blurb": (
            "Leiden's local-move + refinement + aggregation loop, optimising the "
            "constant Potts model objective \\(H = -\\sum_c \\big(e_c - \\gamma \\binom{n_c}{2}\\big)\\). "
            "The resolution \\(\\gamma\\) is the only knob: high \\(\\gamma\\) splits, low merges. "
            "Refinement guarantees every output community is internally well-connected, the fix "
            "Louvain lacked."
        ),
        "stages": [
            ("Singleton init", "Every node starts in its own community; \\(H\\) computed."),
            ("Local moving", "Each node tries every neighbour's community; greatest \\(\\Delta H\\) wins, ties broken by RNG."),
            ("Refinement", "Each community gets re-partitioned in isolation under a constrained moving phase."),
            ("Aggregation", "Communities collapse to super-nodes; edges weighted by between-community sums."),
            ("Repeat", "Local-move + refine + aggregate on the aggregated graph until \\(\\Delta H = 0\\)."),
            ("Final", "Side-by-side with planted ground-truth + per-cluster stats."),
        ],
        "skip_render": True,  # hand-crafted blog page; do not regenerate
    },
    {
        "file": "leiden-mod.html",
        "name": "Leiden-Mod",
        "fullname": "Leiden with modularity",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1038/s41598-019-41695-z", "Traag et al. 2019"),
        "code": ("https://github.com/vtraag/leidenalg", "leidenalg + libleidenalg"),
        "blurb": (
            "Same Leiden optimiser, modularity objective \\(Q = \\frac{1}{2m}\\sum_{ij}\\big(A_{ij} - \\frac{k_i k_j}{2m}\\big)\\delta(c_i, c_j)\\). "
            "Inherits modularity's resolution limit: communities below \\(\\sqrt{2m}\\) get absorbed "
            "regardless of structure. Useful on small graphs, degrades on large sparse ones where "
            "the limit bites hardest."
        ),
        "stages": [
            ("Singleton init", "Every node a singleton; initial \\(Q = 0\\)."),
            ("Local moving", "Greedy \\(\\Delta Q\\) ascent over all single-node moves."),
            ("Refinement", "Per-community re-partition under modularity."),
            ("Aggregation", "Collapse to super-graph; iterate."),
            ("Final", "Output partition + \\(Q\\) value + ground-truth comparison."),
        ],
        "skip_render": True,  # hand-crafted blog page; do not regenerate
    },
    {
        "file": "louvain.html",
        "name": "Louvain",
        "fullname": "fast modularity optimisation",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1088/1742-5468/2008/10/P10008", "Blondel et al. 2008"),
        "code": ("https://sourceforge.net/projects/louvain/", "louvain-generic"),
        "blurb": (
            "The greedy ancestor of Leiden. Modularity \\(Q = \\frac{1}{2m}\\sum_{ij}\\big[A_{ij} - "
            "\\frac{k_i k_j}{2m}\\big]\\delta(c_i, c_j)\\). Two-phase pass: per-node \\(\\Delta Q\\) "
            "ascent until no positive single-node move remains, then collapse each community into a "
            "super-node and repeat. No refinement phase, so Louvain may produce internally disconnected "
            "communities (Traag et al. 2019, the gap Leiden fills)."
        ),
        "stages": [
            ("Singleton init", "Every node a singleton; \\(Q\\) starts at \\(-\\sum_c (k_c/2m)^2\\)."),
            ("Modularity sweep", "For each node in order: try every neighbour's community; greatest \\(\\Delta Q\\) wins; if no positive gain, stay. Repeat until no node moves."),
            ("Aggregation", "One super-node per community; super-edge weight = sum of original edges between communities. Self-loops carry intra-community weight."),
            ("Repeat", "Same sweep on the aggregated network. Iterate until \\(\\Delta Q = 0\\)."),
            ("Final", "Output partition + \\(Q\\) + per-cluster stats. Note any internally-disconnected communities."),
        ],
        "skip_render": True,  # hand-crafted blog page; do not regenerate
    },
    {
        "file": "infomap.html",
        "name": "Infomap",
        "fullname": "map equation on PageRank flow",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1073/pnas.0706851105", "Rosvall + Bergstrom 2008"),
        "code": ("https://github.com/mapequation/infomap", "infomap"),
        "blurb": (
            "Encode a random walk on \\(G\\) using a two-level prefix code. The map equation "
            "\\(L(M) = q_\\curvearrowright H(\\mathcal{Q}) + \\sum_i p_\\circlearrowright^i H(\\mathcal{P}^i)\\) "
            "balances between-module hops against within-module steps. Communities are flow traps; "
            "the optimum partition is the one whose codelength is shortest."
        ),
        "stages": [
            ("Flow calc", "Smart-teleportation PageRank gives the per-node stationary distribution."),
            ("Initial \\(L(M)\\)", "Singleton partition: \\(L(M) = H(P)\\), the entropy of node visits."),
            ("Greedy joining", "Pair-wise merge with the largest \\(\\Delta L\\); deque-based."),
            ("Tuning", "Fine + coarse passes escape locally-optimal merges."),
            ("Sub-level", "Recursive partition inside each module to add hierarchy levels."),
            ("Final", "Hierarchical partition + final \\(L(M)\\)."),
        ],
    },
    {
        "file": "ikc.html",
        "name": "IKC",
        "fullname": "iterative k-core decomposition",
        "emoji": "🐖",
        "paper": ("", ""),
        "code": ("https://networkit.github.io", "networkit CoreDecomposition"),
        "blurb": (
            "For decreasing \\(k\\): extract the \\(k\\)-core (maximal subgraph where every node "
            "has degree \\(\\ge k\\)), peel its connected components, gate each on a modularity "
            "threshold. Surviving components are clusters; nodes that never qualify drop. "
            "Tightest of the bunch on coverage, loosest on recall."
        ),
        "stages": [
            ("k-core peel", "Compute \\(k\\)-core for the largest \\(k\\) with surviving nodes."),
            ("Component split", "Weakly-connected components of the core become candidate clusters."),
            ("k-validity gate", "Reject components whose induced minimum degree drops below \\(k\\)."),
            ("Modularity gate", "Reject components below the modularity threshold."),
            ("Iterate", "Remove accepted clusters from the graph; decrement \\(k\\); repeat until empty."),
            ("Final", "Surviving clusters + dropped nodes; per-cluster size + density."),
        ],
    },
    {
        "file": "sbm-flat-dc.html",
        "name": "SBM-flat-dc",
        "fullname": "degree-corrected stochastic block model",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1103/PhysRevE.83.016107", "Karrer + Newman 2011"),
        "code": ("https://git.skewed.de/count0/graph-tool", "graph-tool"),
        "blurb": (
            "Posterior inference under \\(P(b \\mid G) \\propto P(G \\mid b)\\,P(b)\\) with a "
            "degree-corrected likelihood \\(P(G \\mid b) = \\prod_{rs} \\mathrm{Poisson}(e_{rs}; \\theta_r \\theta_s \\omega_{rs})\\). "
            "The deg-corr term \\(\\theta\\) absorbs degree heterogeneity so heavy-tailed nodes don't get "
            "their own block. graph-tool's multilevel MCMC alternates merge sweeps + Metropolis-Hastings."
        ),
        "stages": [
            ("Random init", "Random partition with \\(B\\) blocks; \\(e_{rs}\\) matrix built from input."),
            ("Description-length", "Compute \\(S = -\\ln P(G \\mid b) - \\ln P(b)\\); the SBM's loss."),
            ("Merge sweep", "Pairwise block merges with greedy \\(\\Delta S\\) descent."),
            ("MCMC sweep", "Per-node Metropolis-Hastings moves at \\(\\beta = \\infty\\)."),
            ("Multilevel", "Bisection over \\(B\\); winner caches; iterate to no-improvement."),
            ("Final", "Output partition + \\(S\\) entropy."),
        ],
    },
    {
        "file": "sbm-flat-ndc.html",
        "name": "SBM-flat-ndc",
        "fullname": "non-degree-corrected SBM",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1103/PhysRevE.83.016107", "Karrer + Newman 2011"),
        "code": ("https://git.skewed.de/count0/graph-tool", "graph-tool"),
        "blurb": (
            "Same multilevel MCMC over the SBM posterior, no degree correction. "
            "\\(P(G \\mid b) = \\prod_{rs} \\mathrm{Poisson}(e_{rs}; n_r n_s \\omega_{rs})\\) makes degree "
            "heterogeneity indistinguishable from block structure: hubs end up flagged as their own block. "
            "Pick this when degree variance carries community signal that deg-corr would factor out."
        ),
        "stages": [
            ("Random init", "Random partition; \\(e_{rs}\\) + \\(n_r\\) per block."),
            ("Description-length", "ndc \\(S\\) computed without degree-sequence term."),
            ("Merge sweep", "Same agglomerative descent."),
            ("MCMC sweep", "Per-node MH at \\(\\beta = \\infty\\)."),
            ("Multilevel", "Bisection over \\(B\\)."),
            ("Final", "Output + \\(S\\) + side-by-side with deg-corr partition for comparison."),
        ],
    },
    {
        "file": "sbm-flat-pp.html",
        "name": "SBM-flat-pp",
        "fullname": "planted-partition SBM",
        "emoji": "🐖",
        "paper": ("https://arxiv.org/abs/1705.10225", "Peixoto 2018 (Bayesian SBM)"),
        "code": ("https://git.skewed.de/count0/graph-tool", "graph-tool"),
        "blurb": (
            "Constrained SBM with one rate inside blocks (\\(\\omega_{\\text{in}}\\)) and one between "
            "(\\(\\omega_{\\text{out}}\\)). Strong assortativity prior; favours partitions where every block "
            "looks the same shape. Trips on networks where some blocks are sparse and others dense, but "
            "wins on networks where the planted-partition assumption actually holds."
        ),
        "stages": [
            ("Random init", "Partition + the two-parameter rate model."),
            ("DL", "Two-parameter \\(S\\) computation."),
            ("Merge sweep", "PP-constrained merges."),
            ("MCMC sweep", "PP-constrained MH at \\(\\beta = \\infty\\)."),
            ("Multilevel", "Bisection over \\(B\\)."),
            ("Final", "Output + \\(S\\) + the two rate fits."),
        ],
    },
    {
        "file": "sbm-nested-dc.html",
        "name": "SBM-nested-dc",
        "fullname": "hierarchical degree-corrected SBM",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1103/PhysRevX.4.011047", "Peixoto 2014 (hierarchical SBM)"),
        "code": ("https://git.skewed.de/count0/graph-tool", "graph-tool"),
        "blurb": (
            "Stack of flat deg-corrected SBMs. Level \\(l\\) treats level \\(l\\!-\\!1\\)'s block-graph as "
            "input. Defeats the resolution limit by encoding small-cluster structure at the lowest level "
            "and coarse cluster structure at higher ones. Ground-truth comparison uses the level-0 partition."
        ),
        "stages": [
            ("Level-0 init", "Standard flat-dc fit on the input graph."),
            ("Block-graph", "Build the super-graph: each block becomes a node, edges weighted by \\(e_{rs}\\)."),
            ("Level-1 fit", "Flat-dc on the super-graph; gives the next-level partition."),
            ("Recurse", "Repeat until the level fits a single block."),
            ("Joint MCMC", "Top-down sweeps re-balance level assignments holding others fixed."),
            ("Final", "Hierarchical partition + per-level \\(S\\) + level-0 vs. ground-truth ARI."),
        ],
    },
    {
        "file": "sbm-nested-ndc.html",
        "name": "SBM-nested-ndc",
        "fullname": "hierarchical non-degree-corrected SBM",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1103/PhysRevX.4.011047", "Peixoto 2014 (hierarchical SBM)"),
        "code": ("https://git.skewed.de/count0/graph-tool", "graph-tool"),
        "blurb": (
            "Hierarchical SBM without degree correction. Pairs the resolution-limit fix with the "
            "degree-blind likelihood. Hubs may form their own first-level blocks before getting absorbed "
            "up the hierarchy."
        ),
        "stages": [
            ("Level-0 init", "Flat-ndc fit on the input graph."),
            ("Block-graph", "Super-graph of level-0 blocks."),
            ("Level-1 fit", "Flat-ndc on the super-graph."),
            ("Recurse", "Up to a single-block apex."),
            ("Joint MCMC", "Hierarchical sweeps."),
            ("Final", "Levels + entropies + ARI vs ground-truth."),
        ],
    },
    {
        "file": "sbm-flat-best.html",
        "name": "SBM-flat-best",
        "fullname": "lowest-entropy flat SBM",
        "emoji": "🐖",
        "paper": ("", ""),
        "code": ("https://git.skewed.de/count0/graph-tool", "graph-tool meta"),
        "blurb": (
            "Runs flat-dc, flat-ndc, and flat-pp; picks the one whose model entropy \\(S\\) is lowest; "
            "symlinks downstream stats / acc paths to the winner. The default flat-SBM picker when "
            "there is no prior reason to prefer one variant over another."
        ),
        "stages": [
            ("Run flat-dc", "Full multilevel MCMC for dc."),
            ("Run flat-ndc", "Full multilevel MCMC for ndc."),
            ("Run flat-pp", "Full multilevel MCMC for pp."),
            ("Compare \\(S\\)", "Bar chart of three entropies."),
            ("Symlink winner", "best_model.txt + symlinked com.csv to the lowest-\\(S\\) variant."),
        ],
    },
    {
        "file": "sbm-nested-best.html",
        "name": "SBM-nested-best",
        "fullname": "lowest-entropy nested SBM",
        "emoji": "🐖",
        "paper": ("", ""),
        "code": ("https://git.skewed.de/count0/graph-tool", "graph-tool meta"),
        "blurb": (
            "Same selector for the nested family: nested-dc vs. nested-ndc, lowest entropy wins. "
            "Hierarchy preserved through the symlink so per-level inspection still resolves."
        ),
        "stages": [
            ("Run nested-dc", "Full hierarchical fit."),
            ("Run nested-ndc", "Full hierarchical fit."),
            ("Compare \\(S\\)", "Per-level entropies side by side."),
            ("Symlink winner", "Hierarchy preserved via realpath symlink."),
        ],
    },
    {
        "file": "cc.html",
        "name": "CC",
        "fullname": "connected-component split",
        "emoji": "🐖",
        "paper": ("", ""),
        "code": ("https://igraph.org", "igraph weakly_connected_components"),
        "blurb": (
            "Walk every cluster's induced subgraph; split each into weakly-connected components; "
            "each component becomes its own cluster in the output. No threshold, no model parameters: "
            "purely structural BFS that catches algorithms which assigned a label without checking "
            "connectivity (SBM is the usual culprit)."
        ),
        "stages": [
            ("Per-cluster BFS", "Traverse each cluster's induced subgraph + assign component IDs."),
            ("Split", "Each component &gt; 1 node becomes a new cluster; singletons drop."),
            ("Re-label", "Cluster IDs renumbered consecutively."),
            ("Final", "Side-by-side with input partition: which clusters got split + by how many pieces."),
        ],
    },
    {
        "file": "wcc.html",
        "name": "WCC",
        "fullname": "well-connected components",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1007/s41109-024-00658-8", "Park et al. 2024"),
        "code": ("https://github.com/MinhyukPark/constrained-clustering", "constrained-clustering MincutOnly"),
        "blurb": (
            "Stronger than CC. A cluster passes only if its mincut exceeds a connectedness threshold "
            "(\\(\\log_{10} n\\) on the log criterion, \\(0.2\\sqrt{n}\\) on sqrt). Anything weaker gets "
            "recursively mincut and split. VieCut's cactus algorithm runs the cuts in a single pass "
            "per cluster."
        ),
        "stages": [
            ("Per-cluster mincut", "VieCut cactus mincut on each cluster's induced subgraph."),
            ("Threshold check", "If \\(\\text{mincut} \\ge \\theta(n)\\), cluster passes; else split."),
            ("Recurse", "Each split half re-enters the queue."),
            ("Final", "Tightened partition + per-cluster mincut value side-by-side with the threshold."),
        ],
    },
    {
        "file": "cm.html",
        "name": "CM",
        "fullname": "connectivity modifier",
        "emoji": "🐖",
        "paper": ("https://doi.org/10.1007/s41109-024-00658-8", "Park et al. 2024"),
        "code": ("https://github.com/MinhyukPark/constrained-clustering", "constrained-clustering CM"),
        "blurb": (
            "WCC's recursive split, plus a re-run of the base algorithm (Leiden CPM or Mod) on each piece "
            "after the cut. Repeats to a fixed point: every output cluster ends up well-connected and "
            "locally-optimal under the base objective. Heaviest of the three post-procs; only wired with "
            "Leiden today."
        ),
        "stages": [
            ("Mincut", "VieCut cactus on each cluster."),
            ("Split if weak", "Same threshold as WCC; split when below."),
            ("Re-cluster", "Run base Leiden (CPM or Mod) on each split half."),
            ("Repeat", "Pieces re-enter the queue until every leaf cluster is well-connected + Leiden-stable."),
            ("Final", "Fixed-point partition + history.log of every split + re-cluster step."),
        ],
    },
]

WALKER_CSS = """
.walker-wrap {
  max-width: var(--span-wide);
  margin: 0 auto 1.5rem;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(220px, 1fr);
  gap: 1.4rem;
}
.walker-graph {
  background: var(--ink-2);
  border: 1.5px solid var(--paper);
  border-radius: 2px;
  padding: 1rem 1.1rem 1.2rem;
  box-shadow: 3px 3px 0 rgba(27,32,51,.15);
  position: relative;
}
.walker-graph::before, .walker-graph::after {
  content: ""; position: absolute;
  top: -9px; width: 50px; height: 16px;
  background: var(--tape-tan); opacity: .82;
  border: 1px solid rgba(139,117,65,.4);
  box-shadow: 0 1px 2px rgba(27,32,51,.15);
  pointer-events: none;
}
.walker-graph::before { left: 14px; transform: rotate(-4deg); }
.walker-graph::after  { right: 14px; transform: rotate(3deg); }
.walker-graph svg {
  display: block; width: 100%; height: auto;
  background: transparent;
}
.walker-side { display: flex; flex-direction: column; gap: 1rem; }
.walker-info {
  background: var(--ink-2);
  border: 1.5px solid var(--paper);
  border-radius: 2px;
  padding: .85rem 1rem;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: .92rem; line-height: 1.5;
  color: var(--paper);
  box-shadow: 2.5px 3px 0 rgba(27,32,51,.18);
}
.walker-info .winfo-line { margin: .15rem 0; }
.walker-info .winfo-line .dim { color: var(--paper-3); }
.walker-cand {
  background: var(--ink-2);
  border: 1.5px solid var(--paper);
  border-radius: 2px;
  padding: .8rem .95rem .9rem;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: .8rem;
  color: var(--paper-2);
  box-shadow: 2.5px 3px 0 rgba(27,32,51,.18);
  max-height: 320px;
  overflow-y: auto;
}
.walker-cand table.wcand { width: 100%; border-collapse: collapse; }
.walker-cand table.wcand th {
  text-align: left;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: .72rem; color: var(--paper-3);
  letter-spacing: .12em; text-transform: uppercase;
  border-bottom: 1px dashed var(--paper-4);
  padding: .15rem .35rem;
}
.walker-cand table.wcand td {
  padding: .15rem .35rem;
  font-size: .82rem;
  color: var(--paper);
}
.walker-cand table.wcand tr.wcand-pick { background: rgba(95,160,179,.25); }
.walker-cand table.wcand tr.wcand-from { color: var(--paper-3); }
.walker-controls {
  max-width: var(--span-wide);
  margin: 0 auto 2.5rem;
  display: flex; gap: .55rem; align-items: center; flex-wrap: wrap;
  font-family: 'Special Elite', 'Courier New', monospace;
}
.walker-controls .wbtn {
  background: var(--ink-2);
  border: 1.5px solid var(--paper);
  color: var(--paper);
  padding: .4rem .7rem;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: .8rem;
  letter-spacing: .04em;
  border-radius: 2px;
  cursor: pointer;
  box-shadow: 1.5px 1.8px 0 rgba(27,32,51,.18);
  transition: transform .12s ease, box-shadow .12s ease;
}
.walker-controls .wbtn:hover {
  transform: translate(-1px, -1px);
  box-shadow: 2.5px 2.8px 0 rgba(27,32,51,.22);
}
.walker-controls .wbtn:active {
  transform: translate(0.5px, 0.5px);
  box-shadow: 0.5px 0.8px 0 rgba(27,32,51,.18);
}
.walker-controls .wbtn.play {
  background: var(--cobalt); color: white;
}
.walker-controls .wslider { flex: 1; min-width: 180px; accent-color: var(--cobalt); }
.walker-controls .wres-wrap {
  display: inline-flex; align-items: center; gap: .4rem;
  margin-left: 1rem;
  background: rgba(237,228,201,.55);
  padding: .25rem .55rem;
  border: 1px solid var(--paper-3);
  border-radius: 2px;
  font-size: .8rem;
}
.walker-controls .wres-val { color: var(--cobalt); }
.walker-controls .wres-slider { width: 110px; accent-color: var(--cobalt); }
@media (max-width: 760px) { .walker-wrap { grid-template-columns: 1fr; } }
"""

WALKER_BLOCK = """<div class="walker-wrap">
  <div class="walker-graph">
    <svg id="walker-svg" aria-label="{name} walker"></svg>
  </div>
  <div class="walker-side">
    <div id="walker-info" class="walker-info"></div>
    <div id="walker-cand" class="walker-cand"></div>
  </div>
</div>

<div class="walker-controls" id="walker-controls"></div>"""


PAGE_TPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>{name} &middot; {fullname} | Community Detection Algorithms</title>
<link rel="shortcut icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>{emoji}</text></svg>">
<meta name="description" content="{name} ({fullname}). Walked stage by stage on the shared 32-node fixture.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..900,30..100;1,9..144,300..900,30..100&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Caveat+Brush&family=Special+Elite&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./shared.css">
<style>
body {{
  font-family: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  font-variation-settings: normal;
}}
.hdr h1 {{ transform: rotate(-1.2deg); }}
.hdr .sub {{
  font-family: 'IBM Plex Sans', sans-serif;
  font-style: normal;
  color: var(--paper-2);
  line-height: 1.55;
}}
.uc-banner {{
  max-width: var(--span-medium);
  margin: 0 auto 2.4rem;
  padding: 1rem 1.3rem;
  background: var(--hl-yellow);
  border: 1.5px solid var(--signal);
  border-radius: 2px;
  position: relative;
  transform: rotate(-.5deg);
  box-shadow: 2px 2.5px 0 rgba(27,32,51,.18);
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: .95rem; line-height: 1.55;
  color: var(--paper-2);
}}
.uc-banner::before {{
  content: "under construction";
  position: absolute;
  top: -10px; left: 16px;
  transform: rotate(-2deg);
  font-family: 'Caveat Brush', cursive;
  font-size: .9rem;
  color: var(--signal);
  background: var(--hl-yellow);
  padding: .15rem .55rem;
  border: 1px solid var(--signal);
  border-radius: 2px;
  letter-spacing: .04em;
  box-shadow: 1px 1px 0 rgba(27,32,51,.18);
}}
.uc-banner strong {{ color: var(--paper); font-weight: 500; }}
.algo-meta {{
  max-width: var(--span-prose);
  margin: 0 auto 2.5rem;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 1.02rem; line-height: 1.7;
  color: var(--paper-2);
}}
.algo-meta em {{
  color: var(--paper);
  font-style: italic;
  background: linear-gradient(180deg, transparent 58%, rgba(246,225,90,.5) 58%, rgba(246,225,90,.5) 92%, transparent 92%);
  padding: 0 .15em;
}}
.algo-refs {{
  display: flex; gap: 1.3rem; flex-wrap: wrap;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: .76rem; letter-spacing: .14em;
  color: var(--paper-3);
  margin-top: 1.1rem;
}}
.algo-refs a {{
  color: var(--paper-3);
  text-transform: uppercase;
  border-bottom: 1px dashed var(--paper-3);
  padding-bottom: 1px;
  background: none;
  transition: color .18s, border-color .18s;
}}
.algo-refs a:hover {{
  color: var(--signal);
  border-bottom-color: var(--signal);
}}
.algo-refs .ref-label {{
  color: var(--paper-4);
  margin-right: .35rem;
  text-transform: uppercase;
}}

.shared-graph {{
  max-width: var(--span-wide); margin: 0 auto 3rem;
  background: var(--ink-2); border: 1.5px solid var(--paper);
  border-radius: 2px; padding: 1.4rem 1.5rem;
  box-shadow: 3px 3px 0 rgba(27,32,51,.15);
  position: relative;
}}
.shared-graph::before, .shared-graph::after {{
  content: ""; position: absolute;
  top: -9px; width: 50px; height: 16px;
  background: var(--tape-tan); opacity: .82;
  border: 1px solid rgba(139,117,65,.4);
  box-shadow: 0 1px 2px rgba(27,32,51,.15);
  pointer-events: none;
}}
.shared-graph::before {{ left: 14px; transform: rotate(-4deg); }}
.shared-graph::after  {{ right: 14px; transform: rotate(3deg); }}
.shared-graph .graph-caption {{
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: .76rem;
  color: var(--paper-2);
  border-bottom: 1px dashed rgba(139,117,65,.4);
  padding-bottom: .6rem;
  margin-bottom: .9rem;
  line-height: 1.45;
}}
.shared-graph .graph-caption .st {{
  color: var(--azure);
  letter-spacing: .12em;
  text-transform: uppercase;
  margin-right: .4rem;
}}
.shared-graph svg {{
  display: block; width: 100%; height: auto;
  cursor: grab; touch-action: none;
}}
.shared-graph svg:active {{ cursor: grabbing; }}

.stage-list {{
  max-width: var(--span-wide);
  margin: 0 auto 3rem;
  display: grid; gap: 1.2rem;
}}
.stage-card {{
  background: var(--ink-2);
  border: 1.5px solid var(--paper);
  border-radius: 2px;
  padding: 1.05rem 1.3rem 1.15rem;
  position: relative;
  box-shadow: 2.5px 3px 0 rgba(27,32,51,.18);
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(0, 1fr) auto;
  gap: 1.1rem;
  align-items: center;
}}
.stage-card:nth-of-type(odd)  {{ transform: rotate(-.3deg); }}
.stage-card:nth-of-type(even) {{ transform: rotate(.25deg); }}
.stage-card::before {{
  content: ""; position: absolute;
  top: -8px; left: 50%;
  transform: translateX(-50%) rotate(-2deg);
  width: 46px; height: 14px;
  background: var(--tape-tan); opacity: .85;
  border: 1px solid rgba(139,117,65,.4);
  box-shadow: 0 1px 2px rgba(27,32,51,.15);
}}
.stage-num {{
  font-family: 'Caveat Brush', cursive;
  font-size: 1.6rem;
  color: var(--cobalt);
  letter-spacing: .04em;
  transform: rotate(-2deg);
  display: inline-block;
}}
.stage-name {{
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: 1.05rem;
  color: var(--paper);
  letter-spacing: .02em;
}}
.stage-desc {{
  font-family: 'IBM Plex Sans', sans-serif;
  color: var(--paper-2);
  font-size: .92rem;
  line-height: 1.5;
  margin-top: .3rem;
}}
.stage-pending {{
  font-family: 'Caveat Brush', cursive;
  color: var(--signal);
  font-size: .9rem;
  letter-spacing: .02em;
  transform: rotate(2deg);
  white-space: nowrap;
  align-self: end;
  padding: .15rem .45rem;
  background: var(--hl-yellow);
  border: 1px solid var(--signal);
  border-radius: 2px;
  box-shadow: 1px 1px 0 rgba(27,32,51,.18);
}}
@media (max-width: 600px) {{
  .stage-card {{
    grid-template-columns: auto 1fr;
  }}
  .stage-pending {{
    grid-column: 1 / -1;
    justify-self: start;
  }}
}}

.back-link {{
  display: inline-flex; align-items: center; gap: .35rem;
  font-family: 'Special Elite', 'Courier New', monospace;
  font-size: .74rem; letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--paper-3);
  border-bottom: 1px dashed var(--paper-3);
  padding-bottom: 1px;
  transition: color .18s, border-color .18s;
}}
.back-link:hover {{
  color: var(--signal);
  border-bottom-color: var(--signal);
}}
.back-row {{
  max-width: var(--span-wide);
  margin: 0 auto 1.8rem;
}}
{walker_css}
</style>
</head>
<body>
<main class="page">

<div class="back-row">
  <a class="back-link" href="./">&larr; back to gallery</a>
</div>

<header class="hdr">
  <div class="kicker">algorithm &middot; {fullname}</div>
  <h1>{name_html}</h1>
  <p class="sub">{sub}</p>
</header>

<div class="uc-banner">
  {uc_html}
</div>

<section class="algo-meta">
  <p>{blurb}</p>
  <div class="algo-refs">
    {refs_html}
  </div>
</section>

{stage_section}

<footer class="ack">
  <p class="tools">drawn with <a href="https://d3js.org" target="_blank" rel="noopener">d3</a></p>
  <p class="credit">typed by vltanh, doodled with Claude</p>
</footer>

<script src="./js/fixture.js"></script>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>
window.MathJax = {{
  tex: {{
    inlineMath: [['\\\\(', '\\\\)'], ['$', '$'], ['$$', '$$']],
    displayMath: [['\\\\[', '\\\\]']]
  }},
  chtml: {{ scale: 1.0 }}
}};
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
{tail_scripts}

</body>
</html>
"""

UC_TEXT = (
    "The full per-stage walker for {name} is pending the Phase 4c kernel port. "
    "Today the page surfaces the input fixture and the planned stage list; "
    "interactive widgets land per-stage as the JS port reaches feature parity "
    "with canonical (see the active plan's Phase 4c verification matrix)."
)


def render_page(spec):
    name_html = spec["name"]
    sub = (
        f"One algorithm in the gallery: {spec['fullname']}. Walked stage by "
        "stage on the shared 32-node fixture, side by side with the planted "
        "ground truth."
    )
    refs = []
    if spec["paper"][0]:
        refs.append(
            f'<span><span class="ref-label">paper</span><a href="{spec["paper"][0]}" target="_blank" rel="noopener">{spec["paper"][1]}</a></span>'
        )
    if spec["code"][0]:
        refs.append(
            f'<span><span class="ref-label">code</span><a href="{spec["code"][0]}" target="_blank" rel="noopener">{spec["code"][1]}</a></span>'
        )
    refs_html = "\n    ".join(refs)

    walker = spec.get("walker")
    if walker:
        # Draft walker — UC banner stays per feedback_keep_uc_banner.md.
        uc_html = (
            f'<strong>Walker draft.</strong> {walker.get("uc_text", "")}'
        )
        stage_section = WALKER_BLOCK.format(name=spec["name"])
        kernel_scripts = "\n".join(
            f'<script src="{s}"></script>' for s in walker.get("scripts", [])
        )
        mount_js = walker.get("mount_js", "")
        tail_scripts = (
            kernel_scripts
            + "\n<script>\n"
            "window.addEventListener(\"DOMContentLoaded\", function () {\n"
            f"  {mount_js}\n"
            "});\n</script>"
        )
        walker_css = WALKER_CSS
    else:
        uc_html = f'<strong>Walker pending.</strong> {UC_TEXT.format(name=spec["name"])}'
        stages = []
        for i, (sname, sdesc) in enumerate(spec["stages"], 1):
            stages.append(
                f"""<article class="stage-card">
    <div><span class="stage-num">{i:02d}</span></div>
    <div>
      <div class="stage-name">{sname}</div>
      <div class="stage-desc">{sdesc}</div>
    </div>
    <span class="stage-pending">pending port</span>
  </article>"""
            )
        stages_html = "\n  ".join(stages)
        stage_section = (
            '<figure class="shared-graph">\n'
            '  <div class="graph-caption">\n'
            '    <span class="st">stage 0</span> input fixture &middot; '
            '32 nodes, 49 edges, 4 planted communities + 2 outliers\n'
            '  </div>\n'
            '  <svg id="shared-graph-svg" aria-label="32-node specialized fixture"></svg>\n'
            '</figure>\n\n'
            '<section class="stage-list" aria-label="planned walker stages">\n'
            f'  {stages_html}\n'
            '</section>'
        )
        tail_scripts = '<script src="./js/landing_hero.js"></script>'
        walker_css = ""

    return PAGE_TPL.format(
        name=spec["name"],
        name_html=name_html,
        fullname=spec["fullname"],
        emoji=spec["emoji"],
        sub=sub,
        uc_html=uc_html,
        blurb=spec["blurb"],
        refs_html=refs_html,
        stage_section=stage_section,
        tail_scripts=tail_scripts,
        walker_css=walker_css,
    )


HERO_JS = """// Shared hero force-directed viz used by per-algorithm UC pages.
// Reads COMDET.FIXTURE; renders the 32-node fixture with cluster colours
// + drag perturbation. No tooltip on UC pages (kept lean); landing's
// inline tooltip script is the full version.
(function () {
  if (!window.COMDET || !window.COMDET.FIXTURE) return;
  if (!document.getElementById("shared-graph-svg")) return;
  const FIX = COMDET.FIXTURE;
  const COL = {
    0: "#7b9bd6", 1: "#e0a649", 2: "#8fbb70", 3: "#b07ac9",
    OUT: "#e07c6a",
  };
  const CLUSTER_OF = {};
  FIX.nodes.forEach((id, i) => {
    const c = FIX.gt[i];
    CLUSTER_OF[id] = c >= 0 ? c : "OUT";
  });

  const POS = {};
  FIX.positions.forEach(p => { POS[p.id] = { x: p.x, y: p.y }; });
  const xs = FIX.positions.map(p => p.x);
  const ys = FIX.positions.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 30;
  const vbW = (maxX - minX) + pad * 2;
  const vbH = (maxY - minY) + pad * 2;
  const offX = pad - minX;
  const offY = pad - minY;

  const svg = d3.select("#shared-graph-svg")
    .attr("viewBox", `0 0 ${vbW} ${vbH}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const simNodes = FIX.nodes.map(id => {
    const p = POS[id];
    return {
      id,
      x: p.x + offX, y: p.y + offY,
      homeX: p.x + offX, homeY: p.y + offY,
      cluster: CLUSTER_OF[id],
    };
  });
  const idx = {};
  simNodes.forEach(n => { idx[n.id] = n; });

  function edgeColor(u, v) {
    const cu = CLUSTER_OF[u], cv = CLUSTER_OF[v];
    if (cu === "OUT" || cv === "OUT") return "#7e468f";
    if (cu === cv) {
      return ({ 0: "#3559a0", 1: "#b4741d", 2: "#4e7a3a", 3: "#7e468f" })[cu];
    }
    return "#3a3f4a";
  }
  const simLinks = FIX.edges.map(([u, v]) => ({
    source: idx[u], target: idx[v], color: edgeColor(u, v),
  }));

  const link = svg.append("g").selectAll("line").data(simLinks).join("line")
    .attr("stroke", d => d.color).attr("stroke-width", 1.5)
    .attr("stroke-linecap", "round").attr("opacity", 0.82);

  const node = svg.append("g").selectAll("circle").data(simNodes).join("circle")
    .attr("r", 11).attr("fill", d => COL[d.cluster] || COL.OUT)
    .attr("stroke", "#1b2033").attr("stroke-width", 1.5)
    .style("cursor", "grab");

  const label = svg.append("g").selectAll("text").data(simNodes).join("text")
    .attr("text-anchor", "middle").attr("dominant-baseline", "central")
    .attr("font-family", "Special Elite, Courier New, monospace")
    .attr("font-size", 9).attr("fill", "#1b2033")
    .attr("pointer-events", "none").text(d => d.id);

  const sim = d3.forceSimulation(simNodes)
    .force("link", d3.forceLink(simLinks).distance(45).strength(0.18))
    .force("charge", d3.forceManyBody().strength(-55))
    .force("collide", d3.forceCollide(14))
    .force("x", d3.forceX(d => d.homeX).strength(0.20))
    .force("y", d3.forceY(d => d.homeY).strength(0.20))
    .alpha(0.45).alphaDecay(0.035);

  sim.on("tick", () => {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("cx", d => d.x).attr("cy", d => d.y);
    label.attr("x", d => d.x).attr("y", d => d.y);
  });

  node.call(d3.drag()
    .on("start", function (e, d) {
      if (!e.active) sim.alphaTarget(0.35).restart();
      d.fx = d.x; d.fy = d.y;
      d3.select(this).style("cursor", "grabbing");
    })
    .on("drag", function (e, d) { d.fx = e.x; d.fy = e.y; })
    .on("end", function (e, d) {
      if (!e.active) sim.alphaTarget(0);
      d.fx = null; d.fy = null;
      d3.select(this).style("cursor", "grab");
    }));
})();
"""


def main():
    js_dir = OUT_DIR / "js"
    js_dir.mkdir(exist_ok=True)
    (js_dir / "landing_hero.js").write_text(HERO_JS)
    print(f"Wrote {js_dir / 'landing_hero.js'}")
    n = 0
    for spec in PAGES:
        if spec.get("skip_render"):
            print(f"Skipped {spec['file']} (hand-crafted)")
            continue
        out = OUT_DIR / spec["file"]
        out.write_text(render_page(spec))
        print(f"Wrote {out}")
        n += 1
    print(f"\n{n} pages generated.")


if __name__ == "__main__":
    main()
