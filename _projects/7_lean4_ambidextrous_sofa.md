---
layout: page
title: Optimality and uniqueness of Romik's ambidextrous sofa in Lean 4
permalink: /projects/lean4-ambidextrous-sofa/
description: A Lean 4 proof that Romik's ambidextrous sofa is the largest shape that can turn both right and left around the corner of a hallway, and that it is the only one, up to rigid motions.
img: assets/img/lean4-ambidextrous-sofa/hallways.svg
og_image: /assets/img/lean4-ambidextrous-sofa/hallways.png
importance: 7
category: fun
project_intro: true
math: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/lean4-ambidextrous-sofa
---

The [moving sofa problem](/projects/lean4-moving-sofa/) asks for the largest shape that can be carried around the corner of a hallway of width $$1$$ that turns right. Its _ambidextrous_ variant asks for a shape that, from the same starting position, can also go around the corner of a hallway that turns left. A sofa that has to fit both ways must be smaller.

<div class="row justify-content-center">
  <div class="col-sm-8 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-ambidextrous-sofa/ambidextrous-moving.gif" class="img-fluid rounded mx-auto d-block" width="480" avoid_scaling=true alt="Romik's ambidextrous sofa slides along a hallway, turns right at the first corner, slides down, and turns left at the second corner" caption="Romik's ambidextrous sofa in a hallway that turns right, then left. The animation is computed from the same definitions as the proofs." %}
  </div>
</div>

In 2016 Dan Romik built a shape for this problem out of differential equations, and proposed it as a likely solution. Its area is

$$M = 1 + 4Y^2 + \arctan Y = 1.64495\ldots,$$

where $$Y = 0.2980\ldots$$ is the positive root of $$4Y^3 + 3Y = 1$$. This project proves in Lean 4 that Romik's sofa is optimal, and that every ambidextrous sofa of area $$M$$ is Romik's sofa after a rotation and a translation.

## The problem

The plane is $$\mathbb{R}^2$$, and the area of a set is its Lebesgue measure. Both hallways come in along the arm $$(-\infty, 1] \times [0, 1]$$. The one that turns right leaves along $$[0, 1] \times (-\infty, 1]$$, and the one that turns left along $$[0, 1] \times [0, \infty)$$. An ambidextrous sofa is a compact connected set that moves through both hallways by two continuous rigid motions, starting with the same orientation. The motions may pause, turn back, and turn through any angle.

The common starting orientation matters. Gerver's sofa, the answer to the ordinary problem, is symmetric in a vertical line, so after a half turn it would pass the left-turning hallway too, and without that condition the answer would be Gerver's area $$2.2195\ldots$$.

<div class="row justify-content-center">
  <div class="col-sm-9 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-ambidextrous-sofa/romik-sofa.svg" class="img-fluid" alt="Romik's ambidextrous sofa between the lines y = 0 and y = 1: its convex hull, dashed, without the two niches, in orange" caption="Romik's sofa (blue) is its convex hull (dashed) without two niches (orange), carved out by the inner corners of the two hallways as they turn around it." %}
  </div>
</div>

Romik's sofa is given by the support function of its convex hull, an explicit formula in three phases. Two open regions are removed from the hull: the niche swept by the inner corner of the right-turning hallway as the hallway turns about the sofa, and its mirror image for the left-turning hallway. The sofa is symmetric in the line $$y = 1/2$$, so uniqueness up to rotations and translations is uniqueness up to congruence.

## The results

The project states nine theorems, in a file that imports only Mathlib. The main ones are:

- Every ambidextrous sofa has area at most $$M$$.
- An ambidextrous sofa has area $$M$$ if and only if it is a rotated and translated copy of Romik's sofa.
- In an ambidextrous sofa of area $$M$$, each of the two motions turns the sofa through a full quarter turn at some moment.

The others check the construction: Romik's sofa and its copies are ambidextrous sofas, its area is $$M$$, its convex hull is the body given by its support function, $$4Y^3 + 3Y = 1$$ has exactly one positive root, and $$M$$ equals Romik's closed form

$$\sqrt[3]{3 + 2\sqrt2} + \sqrt[3]{3 - 2\sqrt2} - 1 + \arctan\left(\tfrac12\left(\sqrt[3]{\sqrt2 + 1} - \sqrt[3]{\sqrt2 - 1}\right)\right).$$

## The proof

A sofa whose motions turn it by at most $$\pi/4$$ has area at most $$\sqrt2 < M$$, so the proof can keep, for each motion, an angle in $$(\pi/4, \pi/2]$$ through which the sofa has turned. After moving the sofa into the strip $$0 \le y \le 1$$, its convex hull splits into an upper _cap_ $$U$$ and a lower cap, whose reflection is $$V$$. The area of the sofa is at most $$P_\alpha(U) + P_\gamma(V)$$, where the _score_ $$P_\alpha$$ of a cap is the area under its roof over the two outer quarters of its projection, minus the part of the middle half that the hallway's inner corner sweeps while the hallway turns by $$\alpha$$.

<div class="row justify-content-center">
  <div class="col-sm-8 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-ambidextrous-sofa/cap-score.svg" class="img-fluid" alt="The upper cap U of the hull of Romik's sofa: its roof over the projection I, the two outer quarters in green and the niche over the middle half J in orange" caption="The score of a cap: the area under the roof over the outer quarters of its projection (green), minus the niche over the middle half (orange). For Romik's cap it is M/2." %}
  </div>
</div>

The main step bounds the score of a single cap: $$P_\alpha(U) \le M/2$$, with equality only for $$\alpha = \pi/2$$ and $$U$$ a translate of Romik's cap. For a full quarter turn, a cap of maximal score exists by compactness, and approximating it by polygons gives it curvature densities and conditions at its endpoints. A tilted middle roof is then ruled out, and a horizontal one is compared with a functional whose maximum $$M/2$$ is reached only at Romik's cap. For a partial turn, the score keeps the whole outgoing wall of the hallway, which makes it strictly smaller. Two of these exclusions use the bound $$2.2199$$ on the ordinary problem, which comes from Jineon Baek's theorem that Gerver's sofa is optimal.

If the sofa has area $$M$$, both caps have score $$M/2$$. Then both motions make a full quarter turn and both caps are Romik's, and an exact identity for the area lost recovers the sofa from its caps.

A [draft paper](https://github.com/vltanh/lean4-ambidextrous-sofa/blob/main/docs/paper/main.pdf), 109 pages long, writes the proof out by hand.

## Prior work

Leo Moser posed the moving sofa problem in 1966, and the ambidextrous variant goes back to John Conway, G. C. Shephard and others. Kiyoshi Maruyama computed polygonal approximations in 1971, and Philip Gibbs found a shape of area $$1.64495$$ numerically in 2014. Romik derived his sofa from differential equations in 2016 and noted that it matches Gibbs's shape; he called it "a highly plausible candidate" for the solution. Georgiev, Gómez-Serrano, Tao and Wagner listed the problem as open in 2025, as Problem 6.63 of _Mathematical exploration and discovery at scale_.

The proof uses Baek's theorem through its Lean formalization in [lean4-moving-sofa](/projects/lean4-moving-sofa/). A pull request to Google DeepMind's [formal-conjectures](https://github.com/google-deepmind/formal-conjectures/pull/6424) states the problem in Lean, and other repositories give upper bounds for it, among them Devin O'Keefe's bound $$1.765$$, proved with a checker written in Lean. The repository's [prior-work page](https://github.com/vltanh/lean4-ambidextrous-sofa/blob/main/docs/prior-work.md) gives the references.

## Verification

Lean checks every proof, and nothing is assumed beyond Lean's three standard axioms. The nine theorems are stated in a self-contained Challenge file, and [Comparator](https://github.com/leanprover/comparator) checks, with Lean's kernel and with NanoDa, that the Solution proves exactly those statements. The project is registered in the [Palomar registry](https://palomar-registry.org/entry?id=PALOMAR-2026-10-13-000003) as PALOMAR-2026-10-13-000003. No person has checked the proofs; Lean's kernel checks all of them.

## Contributors

ChatGPT Pro 6 found the proof and wrote a first Lean draft of it. Claude Opus 5.5 made the draft compile, simplified it, and wrote the Challenge, the Solution and the documentation, following my skill for formalizing papers, [formalize-math-paper](/projects/formalize-math-paper/). Codex (GPT-6) wrote the paper and revised it together with the Lean proofs. I directed the work. The repository's [credits page](https://github.com/vltanh/lean4-ambidextrous-sofa/blob/main/docs/CREDITS.md) records how each part was done.

## References

- L. Moser, Problem 66-11, Moving furniture through a hallway, _SIAM Review_ 8 (1966), 381.
- J. L. Gerver, [On moving a sofa around a corner](https://doi.org/10.1007/BF02414066), _Geometriae Dedicata_ 42 (1992), 267–283.
- D. Romik, [Differential equations and exact solutions in the moving sofa problem](https://doi.org/10.1080/10586458.2016.1270858), _Experimental Mathematics_ 27 (2018), 316–330.
- Y. Kallus, D. Romik, [Improved upper bounds in the moving sofa problem](https://doi.org/10.1016/j.aim.2018.10.022), _Advances in Mathematics_ 340 (2018), 960–982.
- J. Baek, [Optimality of Gerver's sofa](https://arxiv.org/abs/2411.19826), arXiv:2411.19826 (2024).
- B. Georgiev, J. Gómez-Serrano, T. Tao, A. Z. Wagner, [Mathematical exploration and discovery at scale](https://arxiv.org/abs/2511.02864), arXiv:2511.02864 (2025).
