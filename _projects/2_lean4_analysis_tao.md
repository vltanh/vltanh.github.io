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
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/lean4-analysis-tao
---

This project is an ongoing attempt to formalize Terence Tao's [_Analysis I_](https://terrytao.wordpress.com/books/analysis-i/) in [Lean 4](https://lean-lang.org/), following the book's development as faithfully as possible. It covers the main text (definitions, lemmas, theorems) and the end-of-section exercises.

The aim is to paraphrase the book without rewriting it. Definitions appear in the order Tao introduces them, lemmas and theorems keep his numbering, and proofs in the main-text files reproduce Tao's argument rather than a slicker one. A reader should be able to hold the book in one hand and the corresponding file in the other and follow them line by line.

Lean is a _proof assistant_: a programming language in which proofs are written precisely enough for a computer to check every step, so a proof it accepts has no hand-waving and no hidden gaps.

## Tao's own version

Tao has since started [a Lean companion to _Analysis I_](https://github.com/teorth/analysis). It began later than this project but is far more advanced, and it is the canonical reference. This project is mostly a personal learning exercise, kept as an alternative take and not a competitor.

The scope differs in two ways. Tao's companion uses the textbook definitions only at the start and switches to Mathlib's standard definitions from Chapter 3 onward, so it doubles as an introduction to Mathlib. This project imports nothing outside Lean's core at any point, which leads to different design choices. Tao also leaves the end-of-section exercises as `sorry` for readers to fill in; this project formalizes the solutions too.

## No outside libraries

Lean comes with a large library, [Mathlib](https://leanprover-community.github.io/), that already contains most of undergraduate mathematics, including the results Tao spends the book building up. The project does not use it. Tao constructs everything from the axioms up, and the project does the same, building each piece from scratch in the order the book introduces it.

## Rules

Everything is explicit. The project allows no silent inference, no dot-projection shortcuts, no automation tactics that close a goal in one opaque step, no unnamed intermediate facts, and no inline proof blocks buried inside larger expressions. The rules cover scope and faithfulness to the book, a tight tactic whitelist, explicitness in every application, naming, the shape of each proof step, and formatting, and each of them keeps every move visible, named and canonical.

The cost is verbosity, and it buys two things. A reader can follow any proof top to bottom without running type inference in their head. And because every step takes one of a small number of canonical forms, the whole corpus works as structured training data. The full rulebook is in the [repository README](https://github.com/vltanh/lean4-analysis-tao#style).

## Progress

The up-to-date checklist is in the [project README](https://github.com/vltanh/lean4-analysis-tao#progress).

## Acknowledgements

- The book itself: Terence Tao, [_Analysis I_](https://terrytao.wordpress.com/books/analysis-i/).
- The [Lean](https://lean-lang.org/) and [Mathlib](https://leanprover-community.github.io/) communities, for the language, the tooling, and for showing what a modern proof assistant can look like.
- AI assistance from [GitHub Copilot](https://github.com/features/copilot), [Google Gemini](https://gemini.google.com/) and [Anthropic Claude](https://claude.ai/) during formalization.
