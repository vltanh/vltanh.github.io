---
layout: page
title: formalize-math-paper, an agent skill for formalizing papers in Lean 4
permalink: /projects/formalize-math-paper/
description: An Agent Skill that guides an AI coding agent through formalizing a mathematics paper in Lean 4, from reading the paper to an audited project ready for the Palomar registry.
img: assets/img/formalize-math-paper/workflow.svg
og_image: /assets/img/formalize-math-paper/workflow.png
importance: 6
category: fun
project_intro: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/formalize-math-paper
---

[formalize-math-paper](https://github.com/vltanh/formalize-math-paper) is an [Agent Skill](https://agentskills.io): instructions, guides and scripts that an AI coding agent loads to formalize a mathematics paper in [Lean 4](https://lean-lang.org/) with [Mathlib](https://leanprover-community.github.io/). It works with any agent that reads `SKILL.md` (Claude Code, Codex, Gemini CLI, Antigravity, Copilot, Cursor), and an arXiv link is enough to start.

Left alone, an agent drifts: it weakens a theorem when the proof gets hard, adds a hypothesis, swaps the paper's argument for an easier one, guesses a Mathlib name, or declares an axiom and moves on. The skill keeps a long formalization from drifting this way.

## The workflow

<div class="row justify-content-center">
  <div class="col-sm-12 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/formalize-math-paper/workflow.svg" class="img-fluid" alt="The ten phases of the skill, in two rows of five boxes joined by arrows: configure, inventory, project, statements; stage 1 and stage 2, the proofs; verify and cleanup; audit and package" %}
  </div>
</div>

- **Read.** Find later versions, errata and earlier formalizations; read the TeX source; record every result, constant, citation and suspected typo.
- **Set up.** Three libraries, in layers: `Basic` for general mathematics, filed as Mathlib would file it; `External` for the cited results, stated in their sources' terms; and the paper's own results.
- **State.** Every result is stated before any is proved, and a second agent checks each statement against the TeX.
- **Prove.** First what the paper proves, then what it cites, each by the paper's own argument. A proof departs only when the paper's step is wrong, needs mathematics Lean lacks, or has no meaning in the formalization, and every departure is reported. A cited result out of reach becomes a visible hypothesis, and the result is reported as conditional.
- **Check.** Proofs use only Lean's three standard axioms. A route check compares each proof's dependencies with what the paper's proof cites, [Comparator](https://github.com/leanprover/comparator) confirms the statements of record, and cleanup removes unused hypotheses without changing any argument.
- **Report.** `REPORT.md` audits the paper (errors, gaps, missing and redundant hypotheses, departures, each confirmed by a second reader), places it in the literature, and lists what's next. `CREDITS.md` records the agents, models, time and effort.
- **Next paper.** A private `NEXT.md`, kept out of git, asks what paper you could write next. It keeps only directions that would be papers of their own and works the best few through to the step where the paper's method stops, with attempts, evidence and partial results, each marked as proved, checked or conjectured.
- **Package.** Write the [Palomar](https://palomar-registry.org) files and, with your permission, publish and run the preflight.

## Principles

- The paper is the source of truth; Lean judges correctness. A statement never changes to make a proof go through.
- Proofs follow the paper's arguments, and every departure is necessary and reported.
- A formalization nobody compiled is a draft. Mathlib names are checked, never guessed.
- "Standard" and "routine" still need proofs.
- A skipped step, a failing proof or a changed statement is reported.

## Examples

- [The moving sofa](/projects/lean4-moving-sofa/): Baek's 119-page proof that Gerver's sofa is optimal, with one agent and 19 sub-agents in about four hours, on an early version of the skill.
- [lean4-adr11](https://github.com/vltanh/lean4-adr11): Allman, Degnan and Rhodes (2011), identifying the species tree from unrooted gene trees. Made in 6.4 hours; no result of the paper is wrong.
- [lean4-ecsbm](https://github.com/vltanh/lean4-ecsbm): the two theorems of the EC-SBM network generator (2025), in 1.5 hours; every proof follows the paper's.
- [lean4-camus](https://github.com/vltanh/lean4-camus): the optimality of CAMUS (2026), made with Codex and then Claude. Claims of Sections 2.4 and 3.2 fail as printed; Theorem 1 holds.
- [lean4-markman25-hodge-abelian-fourfolds](https://github.com/vltanh/lean4-markman25-hodge-abelian-fourfolds): Markman's Weil classes on abelian sixfolds and the Hodge conjecture for abelian fourfolds, conditional on its sheaf theory and cited results on cycles. Eleven statements are false as printed or misprinted, and corrected.
- [lean4-power-of-few-sparse](https://github.com/vltanh/lean4-power-of-few-sparse): two papers of Tran and Vu on majority dynamics on `G(n, p)`. Three theorems are false as printed; Lean proves counterexamples and corrected versions.

The skill was first written down from earlier work such as [lean4-graham-rearrangement-conjecture](https://github.com/vltanh/lean4-graham-rearrangement-conjecture) (Pham and Sauermann, 2026): a ChatGPT draft that Claude made compile and audited on the day the skill began.

Thank you to the authors of these papers: Jineon Baek; Elizabeth S. Allman, James H. Degnan and John A. Rhodes; James Willson and Tandy Warnow; Eyal Markman; BaoLinh Tran and Van Vu; and Huy Tuan Pham and Lisa Sauermann. I formalized and audited your papers, and published the results, without asking you first. I apologize for that.

## Versions

A major version changes what the skill delivers. The last of each series is a [release](https://github.com/vltanh/formalize-math-paper/releases): [3.0.0](https://github.com/vltanh/formalize-math-paper/releases/tag/v3.0.0), the current one, adds `NEXT.md` and the `External` library; [2.5.1](https://github.com/vltanh/formalize-math-paper/releases/tag/v2.5.1) has the report's literature and what's next, `CREDITS.md` and `Basic`; [1.4.0](https://github.com/vltanh/formalize-math-paper/releases/tag/v1.4.0) has the workflow, Palomar packaging and proofs that follow the paper's.

## Install

```sh
npx skills add vltanh/formalize-math-paper -g
```

The [README](https://github.com/vltanh/formalize-math-paper#install) covers installing by hand and where each agent looks for skills.
