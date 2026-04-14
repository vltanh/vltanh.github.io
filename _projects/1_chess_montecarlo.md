---
layout: page
title: Chess Monte Carlo Simulation
permalink: /projects/chess-monte-carlo-simulation/
description: Tracking the 2026 Candidates with dynamic player strength, one million simulated tournaments per round.
img: assets/img/chess/title.png
importance: 1
category: fun
project_intro: true
icons:
  - file: cplusplus/cplusplus-original.svg
    site: devicons
  - file: python/python-original.svg
    site: devicons
repository:
  - vltanh/chess-monte-carlo-simulation
---

Inspired by a Reddit post on tournament modeling, I built a Chess Monte Carlo simulation engine to track the 2026 Candidates. The goal was to move beyond the limitations of static pre-tournament ratings, which can quickly become outdated in a high-pressure, three-week event. Instead, the model treats player strength as **dynamic**, letting ratings update in real time as games are played.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/title.png" title="Candidates 2026 dashboard title view" class="img-fluid rounded z-depth-1" caption="Dashboard landing page for the 2026 Candidates Open: live round indicator, tournament metadata, and navigation between the Monte Carlo Simulation and Scenario Explorer views." %}
    </div>
</div>

## Live Dashboards

- [FIDE Candidates 2026 - Open](/assets/chess/candidates2026.html)
- [FIDE Candidates 2026 - Women](/assets/chess/candidateswomen2026.html)

## The Simulation Engine

The core is built in **C++**, simulating the remainder of the tournament **one million times after each round**. Key features:

- **Form extrapolation.** The engine identifies players on an upswing by analyzing velocity trends across their Classical, Rapid, and Blitz histories, giving credit to those entering with genuine momentum across all three time controls, not just the headline classical number.
- **Dynamic aggression.** Instead of fixed draw rates, the model adjusts based on standings: a leader's incentive to draw rises near the finish line, trailing contenders must take risks, and eliminated players may coast toward safer play.
- **Hyperparameter tuning.** I used Optuna to calibrate the engine against historical data from the 2022 and 2024 Candidates, finding the Pareto balance between per-game accuracy and final-leaderboard accuracy.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/pareto_front.png" title="Optuna Pareto front over game Brier vs. rank RPS" class="img-fluid rounded z-depth-1" caption="10,000 Optuna trials on the 2022 and 2024 Candidates, plotted by normalized game Brier against normalized rank RPS. The starred trial on the frontier is the configuration shipped in production." %}
    </div>
</div>

## Monte Carlo Simulation

The results live on an interactive dashboard that visualizes the tournament's "multiverse": not a single forecast but the full distribution of futures consistent with what has happened so far.

**Win-probability timeline.** Each player's chance of winning the tournament is tracked round by round, so it's easy to see the exact moment a leader pulls away or a contender collapses.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/winning_chance_evo.png" title="Win-probability evolution across rounds" class="img-fluid rounded z-depth-1" caption="Win probability for each player tracked round by round, making breakaways and collapses visible as clean divergences from the pack." %}
    </div>
</div>

**Rank distribution heatmap.** Beyond "who wins?", the dashboard shows the full distribution of where each player is likely to finish, useful for spotting players who are safe in the top half even if the title itself is out of reach.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/rank_distribution.png" title="Rank distribution heatmap" class="img-fluid rounded z-depth-1" caption="Probability of finishing in each rank after a given round. Rows sum to 100%, making it easy to spot players locked into the top half even when the title is out of reach." %}
    </div>
</div>

## The Scenario Explorer

The centerpiece of the dashboard is the Scenario Explorer: an interactive decision tree for asking "what if?" questions about the rest of the tournament.

**Contender determination.** Before exploring branches, the engine resolves who is still mathematically alive. A 4-phase algorithm (max-reachable points → per-game guaranteed floor → 1M uniform sampling → exhaustive DFS) separates genuine contenders from players who have been eliminated, so the tree only branches on outcomes that actually matter. A naive max-points check is not enough: in the figure below, Divya and Tan Zhongyi can still climb from 5 to the leader's current 7 in the two remaining rounds on paper, but the fixed Round 13 and 14 pairings already guarantee the leader at least 7.5, so the deeper phases correctly rule them out.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/contention.png" title="Contender determination: who is still mathematically alive" class="img-fluid rounded z-depth-1" caption="Title race with 2 rounds remaining in the Women's section. Bars show each player's max reachable points against the leader's current 7. Divya and Tan Zhongyi sit at 5 and could arithmetically climb to 7 in 2 rounds, but the Round 13 pairing guarantees the eventual leader at least 7.5, so neither of them can actually finish on top." %}
    </div>
</div>

**Interactive decision trees.** Navigate branches of hypothetical results and watch how specific outcomes reshape the remaining win conditions for each player, turning an abstract probability distribution into a concrete story about which games carry the tournament.

**Miracle-path search.** For trailing players, a weighted random path sampler looks for likely revival routes first, then falls back to exhaustive DFS for low-probability scenarios or forced tiebreak paths.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/scenario_explorer.png" title="Scenario explorer: decision tree with hypothetical results" class="img-fluid rounded z-depth-1" caption="Branching tree for a single pairing with two rounds remaining. Each outcome (1-0, 1/2-1/2, 0-1) forks into updated per-player win probabilities, letting you walk the tree to see exactly which results keep a contender alive." %}
    </div>
</div>

## Acknowledgements

- Inspired by [Thomas Dondorf](https://github.com/thomasdondorf)'s Reddit posts on Candidates simulations.
- Tournament schedules and live results via the [Lichess broadcast API](https://lichess.org/api).
- Player ratings and rating histories via [FIDE](https://ratings.fide.com/).
- Model design and C++/Python implementation developed with help from [**Google Gemini**](https://gemini.google.com/) and [**Anthropic Claude**](https://claude.ai/).
- Interactive dashboard designed with [**Claude**](https://claude.ai/) via the [`/frontend-design`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/) skill.