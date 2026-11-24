---
layout: page
title: Morrey's problem in Lean 4
permalink: /projects/lean4-morrey/
description: Lean 4 formalizations of three papers on Morrey's problem, whether rank-one convexity implies quasiconvexity, and a proof that it does for isotropic, positively homogeneous energies on 2 × 2 matrices.
img: assets/img/lean4-morrey/front.svg
og_image: /assets/img/lean4-morrey/front.png
importance: 11
category: fun
project_intro: true
math: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/lean4-morrey
_styles: >-
  .highlight .err { color: inherit; background: none; border: none; }
---

An elastic material settles where its energy is least. Describe a deformation of a sheet by its gradient, the $$2 \times 2$$ matrix that says how each small square of the sheet is stretched, and the material by an energy $$F$$ of that matrix. In 1952 Charles Morrey found the condition on $$F$$ under which the total energy behaves well, _quasiconvexity_: no wiggle of a sheet held at its edge lowers its energy. It ranges over infinitely many wiggles and is hard to check. _Rank-one convexity_ asks only that no layering of two deformations lowers the energy, and it can be checked one line at a time. Quasiconvexity implies it, and Morrey asked whether the converse holds.

For maps with three or more components it does not, by an example of Vladimír Šverák from 1992, and two preprints of 2026 claim the same for two components and three or more variables. For maps of the plane to itself, $$2 \times 2$$ matrices, the question is open. A positive answer there would prove Iwaniec's conjecture of 1982 in complex analysis, as Astala, Iwaniec, Prause and Saksman showed in 2012.

[This project](https://github.com/vltanh/lean4-morrey) formalizes three papers on the problem in Lean 4: Šverák's, a claimed proof of the $$2 \times 2$$ case by Pablo Pedregal, and a preprint of Gabriele Cassese. It also proves a theorem of its own on the $$2 \times 2$$ case, for isotropic, homogeneous energies.

<div class="row justify-content-center">
  <div class="col-sm-10 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-morrey/front.svg" class="img-fluid" alt="A sheet split into ten layers that alternate between two deformations A and C, whose difference has rank one: the layers meet along straight blue interfaces without a gap, and a square grid drawn on the sheet bends into a zigzag at each interface. Beside it, the two deformations as deformed squares, and their difference, which squashes a square flat onto a blue segment." caption="Layers of two deformations, A and C, whose difference has rank one: it squashes a square flat onto a segment. The layers meet without a gap exactly when that happens." %}
  </div>
</div>

<p style="text-align:center; margin-top:1rem;"><a href="/morrey/">drag the layers yourself, and see the problem explained &rarr;</a></p>

## The papers

- **Šverák (1992).** The formalization proves every step of his example, a quartic polynomial on $$3 \times 2$$ matrices, including the steps left to the reader. It found no false statement.
- **Pedregal.** In his preprint ([arXiv:1905.06571v5](https://arxiv.org/abs/1905.06571v5)), the formalization refutes Proposition 7.1, Corollary 7.2 and the summary of Step 2 of the proof by an explicit counterexample, checked in Lean, and proves the rest of Sections 3 to 7 but one claim. It states the main theorems without proof, so the claim is neither proved nor refuted.
- **Cassese (2026).** The preprint ([arXiv:2608.03488v3](https://arxiv.org/abs/2608.03488v3)) claims a negative answer for maps from $$\mathbb{R}^m$$ to $$\mathbb{R}^2$$ with $$m \ge 3$$. The repository audits it with a Lean formalization that covers every result the preprint proves, with the results it cites from probability and harmonic analysis formalized in three packages, [lean4-banach-probability](https://github.com/vltanh/lean4-banach-probability), [lean4-harmonic-analysis](https://github.com/vltanh/lean4-harmonic-analysis) and [lean4-calculus-of-variations](https://github.com/vltanh/lean4-calculus-of-variations). It found no false statement, and filled the gaps it came across.

## A theorem for isotropic, homogeneous energies

An energy $$F$$ is _isotropic_ if $$F(QAR) = F(A)$$ for all rotations $$Q$$ and $$R$$, and _positively $$p$$-homogeneous_ if $$F(\lambda A) = \lambda^p F(A)$$ for $$\lambda > 0$$.

**Theorem A.** Let $$p > 0$$. Every isotropic, positively $$p$$-homogeneous, rank-one convex energy on $$2 \times 2$$ matrices is quasiconvex.

```lean
namespace HomogeneousIsotropic

variable {p : ℝ} {F : Matrix (Fin 2) (Fin 2) ℝ → ℝ}

theorem quasiconvex_of_rankOneConvex_of_isotropic (hp : 0 < p) (hiso : IsIsotropic F)
    (hhom : IsPosHomogeneous p F) (hrc : RankOneConvex F) : Quasiconvex F
```

For $$p \ge 2$$, an energy with the three properties that is never negative is even polyconvex, a convex function of the matrix and its determinant, and so quasiconvex by the classical argument. This answers Question 1.7 of André Guerra and Jan Kristensen (2022). For $$p > 2$$ an energy that is negative somewhere is not polyconvex, so the energies whose quasiconvexity was in question take negative values somewhere. Among them are the Burkholder function, whose quasiconvexity implies Iwaniec's conjecture, and the energies $$f_\gamma$$ of Dacorogna and Marcellini with $$1 < \lvert\gamma\rvert \le 2/\sqrt3$$, whose quasiconvexity Dacorogna's book left open. By Theorem A these $$f_\gamma$$ are quasiconvex, as a 2026 preprint of Bruno and Pasqualotto also claims. The [explainer](/morrey/) has more on these energies and the results for each range of $$p$$.

The proof uses one result from outside, the quasiconvexity of the truncated determinant, claimed as Theorem 1 of the preprint of Agazzi et al. on Iwaniec's conjecture and audited with a Lean formalization, [lean4-iwaniec](https://github.com/vltanh/lean4-iwaniec). A [paper](https://github.com/vltanh/lean4-morrey/blob/main/docs/HomogeneousIsotropic/paper/main.pdf) in the repository writes up the proof.

## Verification

Lean's kernel checks every proof, with Lean and Mathlib `v4.36.0-rc2`, and an audit script checks that every declaration, in the packages too, depends only on Lean's three standard axioms. Comparator, the checker of the [Palomar registry](https://palomar-registry.org), accepts the Solution of each paper and of Theorem A against its Challenge, under Lean's kernel and the independent NanoDa kernel. The four entries are packaged for Palomar but not yet submitted. Independent AI agents checked the statements and the proofs against the papers. No person has reviewed the proofs or the paper.

## What's next

Theorem A needs both symmetries, and the general $$2 \times 2$$ case, still open, remains the target. The paper on Theorem A, rewritten after an AI agent reviewed it, has not been refereed again.

## Contributors

Claude Opus 5.5, in Claude Code, formalized the three papers on 21 and 22 November 2026 with sub-agents, following my skill for formalizing papers, [formalize-math-paper](/projects/formalize-math-paper/), and wrote the three packages behind Cassese's formalization. Theorem A comes from research that I directed with ChatGPT Chat 6 Extra High and Claude, recorded in pull request 1 of the repository; the argument for energies that change sign is ChatGPT's. Claude Fable 5.2 wrote the Lean proof, the Palomar files and the paper on 23 and 24 November, and in the same session Claude Opus 5.5 agents made lean4-iwaniec. Claude Opus 5.5 also made the last changes to the proof and the paper, and wrote the explainer and the figures. The earlier Lean formalizations by Conti, Dolzmann and Dondl and by Cassese were not consulted, though searches displayed parts of both. I chose the problems and directed the work. The `CREDITS.md` files record who did what, and when.

## References

- C. B. Morrey, Jr., [Quasi-convexity and the lower semicontinuity of multiple integrals](https://doi.org/10.2140/pjm.1952.2.25), _Pacific Journal of Mathematics_ 2 (1952), 25–53.
- B. Dacorogna, P. Marcellini, A counterexample in the vectorial calculus of variations, in _Material Instabilities in Continuum Mechanics_ (Edinburgh, 1985–1986), Oxford University Press (1988), 77–83.
- V. Šverák, [Rank-one convexity does not imply quasiconvexity](https://doi.org/10.1017/S0308210500015080), _Proceedings of the Royal Society of Edinburgh_ 120A (1992), 185–189.
- B. Dacorogna, [Direct Methods in the Calculus of Variations](https://doi.org/10.1007/978-0-387-55249-1), 2nd ed., Springer (2008), Theorem 5.51.
- K. Astala, T. Iwaniec, I. Prause, E. Saksman, [Burkholder integrals, Morrey's problem and quasiconformal mappings](https://doi.org/10.1090/S0894-0347-2011-00718-2), _Journal of the American Mathematical Society_ 25 (2012), 507–531.
- A. Guerra, J. Kristensen, [Automatic quasiconvexity of homogeneous isotropic rank-one convex integrands](https://arxiv.org/abs/2112.10563), _Archive for Rational Mechanics and Analysis_ 245 (2022), 479–500.
- P. Pedregal, [Morrey's conjecture: rank-one convexity implies quasi-convexity for two-dimensional, two-component maps](https://arxiv.org/abs/1905.06571v5), arXiv:1905.06571v5 (2026).
- G. Cassese, [A solution to Morrey's problem in $$\mathbb{R}^{2 \times m}$$](https://arxiv.org/abs/2608.03488v3), arXiv:2608.03488v3 (2026).
- A. Agazzi, G. Bruno, A. Guerra, F. Pasqualotto, a counterexample on $$2 \times 4$$ matrices, [arXiv:2608.12298](https://arxiv.org/abs/2608.12298) (2026).
- G. Bruno, F. Pasqualotto, [Quasiconvexity for the Dacorogna–Marcellini energy](https://arxiv.org/abs/2608.06367), arXiv:2608.06367 (2026).
- A. Agazzi et al., [Sharp higher integrability theory, Part I: the $$L^p$$-norm of the Beurling–Ahlfors transform](https://arxiv.org/abs/2609.28311), arXiv:2609.28311 (2026).
