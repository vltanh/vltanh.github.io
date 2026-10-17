---
layout: page
title: Chess Monte Carlo Simulation
permalink: /projects/chess-monte-carlo-simulation/
description: Tracking the 2026 Candidates with dynamic player strength, one million simulated tournaments per round.
img: assets/img/chess/title.png
og_image: /assets/img/chess/title.png
importance: 1
category: fun
project_intro: true
icons:
  - file: cplusplus/cplusplus-original.svg
    site: devicons
  - file: python/python-original.svg
    site: devicons
repository:
  - vltanh/chess-monte-carlo
---

Inspired by a Reddit post on tournament modeling, I built a Chess Monte Carlo simulation engine to track the 2026 Candidates. Static pre-tournament ratings can go stale over a high-pressure, three-week event, so the model treats player strength as dynamic and updates ratings in real time as games are played.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/title.png" title="Candidates 2026 dashboard title view" class="img-fluid rounded z-depth-1" caption="Dashboard landing page for the 2026 Candidates Open: live round indicator, tournament metadata, and navigation between the Monte Carlo Simulation and Scenario Explorer views." %}
    </div>
</div>

## Live dashboards

- [FIDE Candidates 2026 (Open)](/chess-mc/candidates2026.html)
- [FIDE Candidates 2026 (Women)](/chess-mc/candidateswomen2026.html)

## The simulation engine

The engine is written in C++ and simulates the rest of the tournament one million times after each round.

- Form extrapolation finds players on an upswing from velocity trends in their Classical, Rapid, and Blitz histories, and credits momentum across all three time controls instead of reading only the headline classical number.
- Dynamic aggression replaces fixed draw rates with rates that depend on the standings: a leader's incentive to draw rises near the finish line, trailing contenders must take risks, and eliminated players may coast toward safer play.
- I tuned the hyperparameters with Optuna against historical data from the 2022 and 2024 Candidates, looking for the Pareto balance between per-game accuracy and final-leaderboard accuracy.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/pareto_front.png" title="Optuna Pareto front over game Brier vs. rank RPS" class="img-fluid rounded z-depth-1" caption="10,000 Optuna trials on the 2022 and 2024 Candidates, plotted by normalized game Brier against normalized rank RPS. The starred trial on the frontier is the configuration shipped in production." %}
    </div>
</div>

## Monte Carlo simulation

The interactive dashboard shows the tournament's "multiverse", the full distribution of futures consistent with what has happened so far.

The win-probability timeline tracks each player's chance of winning the tournament round by round, so you can see the exact moment a leader pulls away or a contender collapses.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/winning_chance_evo.png" title="Win-probability evolution across rounds" class="img-fluid rounded z-depth-1" caption="Win probability for each player, round by round. Breakaways and collapses show up as divergences from the pack." %}
    </div>
</div>

The rank distribution heatmap goes past "who wins?" to show where each player is likely to finish, which picks out players who are safe in the top half even when the title is out of reach.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/rank_distribution.png" title="Rank distribution heatmap" class="img-fluid rounded z-depth-1" caption="Probability of finishing in each rank after a given round. Rows sum to 100%, so players locked into the top half stand out even when the title is out of reach." %}
    </div>
</div>

## The Scenario Explorer

The Scenario Explorer is an interactive decision tree for "what if?" questions about the rest of the tournament.

Before exploring branches, the engine works out who is still mathematically alive. A 4-phase algorithm (max reachable points, then a per-game guaranteed floor, then 1M uniform samples, then exhaustive DFS) separates contenders from eliminated players, so the tree only branches on outcomes that matter. A naive max-points check is not enough. In the figure below, Divya and Tan Zhongyi could on paper climb from 5 to the leader's current 7 in the two remaining rounds, but the fixed Round 13 and 14 pairings already guarantee the leader at least 7.5, so the deeper phases rule them out.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/contention.png" title="Contender determination: who is still mathematically alive" class="img-fluid rounded z-depth-1" caption="Title race with 2 rounds remaining in the Women's section. Bars show each player's max reachable points against the leader's current 7. Divya and Tan Zhongyi sit at 5 and could arithmetically climb to 7 in 2 rounds, but the Round 13 pairing guarantees the eventual leader at least 7.5, so neither can finish on top." %}
    </div>
</div>

In the decision tree you navigate branches of hypothetical results and watch how specific outcomes change each player's remaining win conditions, which shows which games carry the tournament.

For trailing players, a miracle-path search uses a weighted random path sampler to find likely revival routes first, then falls back to exhaustive DFS for low-probability scenarios or forced tiebreak paths.

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/chess/scenario_explorer.png" title="Scenario explorer: decision tree with hypothetical results" class="img-fluid rounded z-depth-1" caption="Branching tree for a single pairing with two rounds remaining. Each outcome (1-0, 1/2-1/2, 0-1) forks into updated scenarios, and walking the tree shows the exact winning path for each player." %}
    </div>
</div>

## Acknowledgements

- Inspired by [Thomas Dondorf](https://github.com/thomasdondorf)'s Reddit posts on Candidates simulations.
- Tournament schedules and live results via the [Lichess broadcast API](https://lichess.org/api).
- Player ratings and rating histories via [FIDE](https://ratings.fide.com/).
- Model design and C++/Python implementation developed with help from [Google Gemini](https://gemini.google.com/) and [Anthropic Claude](https://claude.ai/).
- Interactive dashboard designed with [Claude](https://claude.ai/) via the [`/frontend-design`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/) skill.
