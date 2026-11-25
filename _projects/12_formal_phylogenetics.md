---
layout: page
title: Formal Phylogenetics
permalink: /projects/formal-phylogenetics/
description: Lean 4 formalizations of papers on phylogenetics, each audited against the paper, grown as a tree of repositories, from a shared root library through hubs of inference and of theory to the papers.
img: assets/img/formal-phylogenetics/tree.png
og_image: /assets/img/formal-phylogenetics/og.png
importance: 12
category: work
project_intro: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - formal-phylogenetics/lean4-phylogenetics
---

Phylogenetics reconstructs evolutionary history from the DNA of living species. Its methods estimate an alignment of the sequences, a tree for each gene, the species tree inside which the gene trees evolve, or a phylogenetic network when species also exchange genes, by hybridization or gene flow. Many of these methods come with theorems: that the model identifies the tree or the network from the distribution of the data, and that the method recovers it as the data grow. The proofs mix combinatorics, probability and algebra, run over many pages and supplements, and are rarely checked line by line.

[This project](https://github.com/formal-phylogenetics) formalizes papers of the field in Lean 4, with Mathlib, and audits each one against its text. The formalization states every result of the paper, proves it by the paper's own argument wherever that argument works, and a report lists what is false as printed, which hypotheses are missing, which steps have gaps, and how each was repaired.

<div class="row justify-content-center">
  <div class="col-sm-12 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/formal-phylogenetics/tree.png" class="img-fluid" alt="The collection drawn as a fan-shaped tree from its root, lean4-phylogenetics: the hubs of theory on the left (combinatorics, algebraic, statistics, geometry) and the hubs of inference on the right (alignment, gene tree, species tree, network). Each hub is a coloured wedge whose branches split into families and end in a tip for each entry of its catalog; the formalized entries end in a bud." caption="The collection as a tree: the root, the hubs of theory on the left and of inference on the right, their families, and a tip for each entry of their catalogs. The tips that end in a bud are formalized." %}
  </div>
</div>

<p style="text-align:center; margin-top:1rem;"><a href="https://formal-phylogenetics.github.io/">open the catalogue at formal-phylogenetics.github.io &rarr;</a></p>

## The structure

The repositories form a tree, and each node holds what the repositories below it share.

- The root, [lean4-phylogenetics](https://github.com/formal-phylogenetics/lean4-phylogenetics), holds the library `Phylogenetics` that every repository requires: trees and networks, Kingman's coalescent, the multispecies coalescent and its network version, and concordance factors. It also holds the registry of the repositories, the conventions, the workflow, and the tools that check the collection and write its READMEs.
- The hubs branch from the root, in two kinds. A hub of inference gathers the methods that estimate one object: [alignments](https://github.com/formal-phylogenetics/lean4-phylo-alignment), [gene trees](https://github.com/formal-phylogenetics/lean4-phylo-gene-tree), [species trees](https://github.com/formal-phylogenetics/lean4-phylo-species-tree) or [phylogenetic networks](https://github.com/formal-phylogenetics/lean4-phylo-network). A hub of theory gathers the general results that the methods rest on: [combinatorics](https://github.com/formal-phylogenetics/lean4-phylo-combinatorics), [algebraic phylogenetics](https://github.com/formal-phylogenetics/lean4-phylo-algebraic), [statistical theory](https://github.com/formal-phylogenetics/lean4-phylo-statistics) and [geometry](https://github.com/formal-phylogenetics/lean4-phylo-geometry). Each hub holds a library for what its papers share, and a catalog of the papers to formalize, sorted into families, whose checklist is in the hub's README.
- A sub-hub branches from a hub when some of its papers share more with each other than with the rest: [the tree of blobs](https://github.com/formal-phylogenetics/lean4-phylo-tree-of-blobs) is a sub-hub of networks.
- The papers are the tips. Each paper has a repository of its own under its hub, with the paper's library, the audit report, the credits, and the files of an entry of the [Palomar registry](https://palomar-registry.org): a Challenge with the statements, which imports only Mathlib, and the Solution that proves them.

A definition or a result lives at the lowest node above every repository that uses it: in a paper's repository when only that paper uses it, in a hub's library when several of its papers do, and in the root when papers of several hubs do. Each repository requires the libraries above it at fixed commits, the same for the whole collection, so every formalization keeps building while the libraries grow.

The [catalogue](https://formal-phylogenetics.github.io/) reads the hubs' catalogs and shows every method, piece of software and theorem in them along time, with the citations between them.

## Verification

Lean's kernel checks every proof, and each repository's CI checks on every commit that its declarations depend only on Lean's standard axioms. No result of the literature is assumed. For the finished formalizations, independent AI agents checked the statements against the papers and compared the proofs with the papers' arguments. No person has reviewed the proofs.

## What's next

The catalogs list the papers still to formalize, from alignment methods to the geometry of tree space. Results that papers of several hubs use move up into the shared libraries.

## Contributors

Claude Opus 5.5, in Claude Code and with sub-agents, has written the statements, proofs, audits and documents since October 2026, following my skill for formalizing papers, [formalize-math-paper](/projects/formalize-math-paper/), and Codex made the first rounds of some of the papers. Claude Opus 5.5 also built the hubs and their catalogs from my lists of papers, with the citations checked against Crossref, and made the catalogue page and its tree, with the [impeccable](https://impeccable.style) skill. I chose the papers and directed the work. Each repository's `CREDITS.md` records who did what, and when.
