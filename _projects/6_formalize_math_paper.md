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

[formalize-math-paper](https://github.com/vltanh/formalize-math-paper) is an [Agent Skill](https://agentskills.io): instructions, reference guides and scripts that an AI coding agent loads when you ask it to formalize a mathematics paper in [Lean 4](https://lean-lang.org/) with [Mathlib](https://leanprover-community.github.io/). It works with any agent that reads the `SKILL.md` format, among them Claude Code, OpenAI Codex, Gemini CLI, Google Antigravity, GitHub Copilot and Cursor. An arXiv link is enough to start.

Agents can now write a lot of Lean, but a formalization is only worth something if its statements say what the paper says and its proofs check the paper's arguments. Left alone, an agent drifts: it restates a theorem in a slightly weaker form when the proof gets hard, adds a hypothesis that makes a step go through, swaps the paper's argument for one that is easier to formalize, guesses a Mathlib lemma name, or declares an axiom and moves on. The skill is the discipline that keeps a long formalization honest, written down so that an agent follows it from start to finish.

## The workflow

<div class="row justify-content-center">
  <div class="col-sm-12 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/formalize-math-paper/workflow.svg" class="img-fluid" alt="The ten phases of the skill, in two rows of five boxes joined by arrows: configure, inventory, project, statements; stage 1 and stage 2, the proofs; verify and cleanup; audit and package" %}
  </div>
</div>

The agent first searches for newer versions of the paper (a later arXiv version, the published version, errata) and for earlier formalizations of it. It then reads the whole paper, preferably its TeX source, and records every result, constant and citation, with the typos it suspects. It sets up a Lean project and states every result before proving any, and a second agent checks each statement against the TeX source.

Only then do the proofs start: first everything the paper proves (Stage 1), then the results it cites (Stage 2). Each proof follows the paper's own argument, with the same intermediate claims, constructions and cited results. It departs from the paper only when it must: the paper's step is wrong, needs mathematics that Lean lacks, or has no meaning in the formalization's representation. A shorter or more elegant proof is not a reason. Every departure is reported, with its reason, in the code, the report and the metadata. A cited result that no Lean library can support becomes a visible hypothesis of the theorems that use it, and the formalization says plainly that it is conditional. Large formalizations are split among sub-agents by file, and every statement is then compared with the reviewed baseline, so that no agent can quietly change one.

Then come the checks. Every declaration may use only Lean's three standard axioms. A route check compares, for every numbered result, the results its formal proof uses with the results the paper's proof cites, read from the TeX source, and a reader other than the provers compares the proofs with the paper's. [Comparator](https://github.com/leanprover/comparator) confirms that the proofs prove exactly the statements of record. The cleanup that follows removes unused hypotheses and warnings without changing any proof's argument.

The agent then writes an audit of the paper, `REPORT.md`, with every error, gap and redundant hypothesis it found and every departure from the paper's proofs, each checked against the TeX source by a reader other than the one who found it. The report ends with _What's next_: what later work has proved, from a dated search that gives each source's status (published, preprint, withdrawn or disputed); ways to extend, generalize or strengthen the paper's results, each with what would have to be proved; and where the paper's proofs could be simpler. Since the formal proofs must follow the paper's arguments, a simpler argument that an agent finds along the way is not used but recorded, checked, and reported there. Later work that corrects the paper counts as a finding of the audit. All along, the agent keeps a run log, and `CREDITS.md` reports how the formalization was made: the procedure, the agents and models, the time and the effort. Finally it packages the project for the [Palomar registry](https://palomar-registry.org) and, with your permission, publishes it and runs Palomar's preflight.

## Principles

A few rules carry most of the weight:

- The paper is the source of truth for statements and arguments, and Lean judges correctness. A statement never changes to make a proof go through; if the paper's statement is false, the agent stops and shows you the counterexample.
- A formalization checks the paper's proofs, not only its claims. Each proof follows the paper's argument, and departs from it only when it must, saying where and why.
- A formalization nobody compiled is a draft. Names and signatures are checked against the pinned Mathlib, never guessed.
- Cited results are proved like everything else; "standard" and "routine" still need proofs.
- Every choice of representation gets a lemma that connects it to the paper's object.
- Report faithfully: a skipped step, a failing proof, a changed statement or a departure from the paper's proof is said, not smoothed over.

## Example: the moving sofa

The skill was used for, and refined on, the [formalization of Baek's proof that Gerver's sofa is optimal](/projects/lean4-moving-sofa/). Baek's paper is 119 pages long. Following the skill, one coordinating Claude Opus 5.5 agent and 19 sub-agents formalized every numbered result of the paper and the results it cites, and wrote the audit, in about four hours of wall-clock time. The same procedure then turned ChatGPT Pro 6's uncompiled Lean draft of a new uniqueness proof into a complete formal proof. The repository, [vltanh/lean4-moving-sofa](https://github.com/vltanh/lean4-moving-sofa), shows the Challenge and Solution, the audit, the [run log](https://github.com/vltanh/lean4-moving-sofa/blob/main/docs/contributors.md), and the Palomar packaging. It was made with earlier versions of the skill; later versions added the route check, the report's What's next section and `CREDITS.md`.

## Install

With the [`skills`](https://github.com/vercel-labs/skills) installer:

```sh
npx skills add vltanh/formalize-math-paper -g
```

The [README](https://github.com/vltanh/formalize-math-paper#install) explains how to install it by hand and where each agent looks for skills.
