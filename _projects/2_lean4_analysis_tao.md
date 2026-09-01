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

This project is an ongoing attempt to formalize Terence Tao's [_Analysis I_](https://terrytao.wordpress.com/books/analysis-i/) in [Lean 4](https://lean-lang.org/), following the book's development as faithfully as possible. Both the main text (definitions, lemmas, theorems) and the end-of-section exercises are in scope.

The guiding aim is to **paraphrase the book, not rewrite it**. Definitions appear in the order Tao introduces them, lemmas and theorems keep his numbering, and proofs in the main-text files reproduce the argument Tao gives rather than a slicker alternative. A reader should be able to open the book in one hand and the corresponding file in the other, and follow them line by line.

Lean is a _proof assistant_: a programming language in which mathematical proofs can be written down so precisely that a computer can check every step. If the computer accepts the proof, you know the argument is airtight, with no hand-waving and no hidden gaps.

## Tao's own version

Tao himself has since started [a Lean companion to _Analysis I_](https://github.com/teorth/analysis), which began later than this project but is far more advanced and is the canonical reference. This project is mostly a personal learning exercise, kept around as an alternative take rather than a competitor.

Two main differences in scope. First, Tao's companion uses textbook definitions only at the start, then transitions to Mathlib's standard definitions from Chapter 3 onward, so it doubles as an introduction to Mathlib. This project keeps the from-scratch rule in force throughout: nothing outside Lean's core is ever imported, all the way through, which naturally leads to different design choices from Tao's. Second, Tao deliberately leaves the end-of-section exercises as `sorry` for readers to fill in, whereas this project also formalizes the exercise solutions.

## No outside libraries

Lean comes with a large library called [Mathlib](https://leanprover-community.github.io/) that already contains most of undergraduate mathematics, including the very results Tao spends his book building up. The project deliberately does not use it.

Tao constructs everything from the axioms up, so the project does the same: each piece is built from scratch, in the same order the book introduces it.

## Rules

One idea runs through the whole project: **everything is explicit**. No silent inference, no dot-projection shortcuts, no automation tactics that discharge goals in one opaque step, no unnamed intermediate facts, no inline proof blocks buried inside larger expressions. The rules fall into a handful of buckets (scope and faithfulness to the book, a tight tactic whitelist, explicitness in every application, naming, the shape of each proof step, and formatting), but the spirit is always the same: every move is visible, named, and canonical.

The cost is verbosity. The payoff is twofold. A reader can walk any proof top to bottom without running type inference in their head. And because every step takes one of a small number of canonical forms, the whole corpus is usable as structured training data. The full rulebook lives in the [repository README](https://github.com/vltanh/lean4-analysis-tao#style).

## Progress

The up-to-date checklist lives on the [project README](https://github.com/vltanh/lean4-analysis-tao#progress).

## Acknowledgements

- The book itself: Terence Tao, [_Analysis I_](https://terrytao.wordpress.com/books/analysis-i/).
- The [**Lean**](https://lean-lang.org/) and [**Mathlib**](https://leanprover-community.github.io/) communities for the language, the tooling, and for showing what a modern proof assistant can look like.
- AI assistance from [**GitHub Copilot**](https://github.com/features/copilot), [**Google Gemini**](https://gemini.google.com/), and [**Anthropic Claude**](https://claude.ai/) during formalization.
