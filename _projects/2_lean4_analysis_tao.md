---
layout: page
title: Formalization of Tao's Analysis I in Lean 4
permalink: /projects/lean4-analysis-tao/
description: A from-the-axioms-up Lean 4 formalization of Terence Tao's Analysis I, covering both the main text and the exercises with no outside libraries.
img: assets/img/lean4-analysis-tao/978-981-19-7261-4.jpeg
og_image: /assets/img/lean4-analysis-tao/978-981-19-7261-4.jpeg
importance: 2
category: fun
project_intro: true
icons:
  - file: assets/img/lean4-analysis-tao/lean_logo.svg
repository:
  - vltanh/lean4-analysis-tao
---

This project is an ongoing attempt to formalize Terence Tao's [*Analysis I*](https://terrytao.wordpress.com/books/analysis-i/) in [Lean 4](https://lean-lang.org/), following the book's development as faithfully as possible. Both the main text (definitions, lemmas, theorems) and the end-of-section exercises are in scope.

Lean is a *proof assistant*: a programming language in which mathematical proofs can be written down so precisely that a computer can check every step. If the computer accepts the proof, you know the argument is airtight, with no hand-waving and no hidden gaps.

## Tao's own version

Tao himself has since started [a Lean companion to *Analysis I*](https://github.com/teorth/analysis), which began later than this project but is far more advanced and is the canonical reference. This project is mostly a personal learning exercise, kept around as an alternative take rather than a competitor.

Two main differences in scope. First, Tao's companion uses textbook definitions only at the start, then transitions to Mathlib's standard definitions from Chapter 3 onward, so it doubles as an introduction to Mathlib. This project keeps the from-scratch rule in force throughout: nothing outside Lean's core is ever imported, all the way through, which naturally leads to different design choices from Tao's. Second, Tao deliberately leaves the end-of-section exercises as `sorry` for readers to fill in, whereas this project also formalizes the exercise solutions.

## No outside libraries

Lean comes with a large library called [Mathlib](https://leanprover-community.github.io/) that already contains most of undergraduate mathematics, including the very results Tao spends his book building up. The project deliberately does not use it.

Tao constructs everything from the axioms up, so the project does the same: each piece is built from scratch, in the same order the book introduces it. A reader should be able to open a section of the book and the matching file side by side, and find them walking in step.

## Style rules

Proofs in this repo follow a few deliberate constraints.

- **Paraphrase, don't replace.** When the book gives a proof, the Lean version uses the same argument, even if a shorter one exists. Exercise solutions are free to prove the result any way, but should reach first for the tools the book has already introduced.
- **No silent shortcuts.** Lean can infer missing pieces from the surrounding hypotheses, but the proofs here spell everything out anyway. It is more typing, but a reader can follow each step without having to reconstruct what Lean inferred on their behalf.
- **Name every fact.** Every intermediate result gets a descriptive label, which makes longer proofs easier to follow and keeps nested steps from blurring together.

## Progress

The up-to-date checklist lives on the [project README](https://github.com/vltanh/lean4-analysis-tao#progress).

## Acknowledgements

- The book itself: Terence Tao, [*Analysis I*](https://terrytao.wordpress.com/books/analysis-i/).
- The [**Lean**](https://lean-lang.org/) and [**Mathlib**](https://leanprover-community.github.io/) communities for the language, the tooling, and for showing what a modern proof assistant can look like.
- AI assistance from [**GitHub Copilot**](https://github.com/features/copilot), [**Google Gemini**](https://gemini.google.com/), and [**Anthropic Claude**](https://claude.ai/) during formalization.
