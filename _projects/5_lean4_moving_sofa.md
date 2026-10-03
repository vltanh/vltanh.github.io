---
layout: page
title: Optimality and uniqueness of Gerver's sofa in Lean 4
permalink: /projects/lean4-moving-sofa/
description: Lean 4 proofs that Gerver's sofa is the largest shape that can be carried around the corner of a hallway, and that it is the only one, up to rigid motions.
img: assets/img/lean4-moving-sofa/hallway.svg
og_image: /assets/img/lean4-moving-sofa/hallway.png
importance: 5
category: fun
project_intro: true
math: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/lean4-moving-sofa
---

Anyone who has moved a couch knows the moment: the hallway turns a corner, and the couch has to pivot to get around it. Leo Moser turned this into a mathematical question in 1966. A _moving sofa_ is a connected shape in the plane that can be moved, by sliding and turning, through a hallway of width $$1$$ with a right-angled corner. How large can its area be?

<div class="row justify-content-center">
  <div class="col-sm-8 mt-3 mt-md-0">
    <img src="/assets/img/lean4-moving-sofa/gerver-moving.gif" class="img-fluid rounded" alt="Gerver's sofa slides along the horizontal side of an L-shaped hallway of unit width, turns the corner, and leaves along the vertical side">
  </div>
</div>
<div class="caption">Gerver's sofa going around the corner. The animation is computed from the same definitions as the proofs.</div>

The best shape known is Gerver's sofa, found by Joseph Gerver in 1992, of area $$2.2195\ldots$$. Its boundary is made of 18 pieces of curves, and it is the sofa above. In 2024, Jineon Baek proved that no moving sofa is larger. This project checks that proof in Lean 4, and adds two results of its own:

- **Optimality.** Baek's whole proof, 119 pages long, is formalized, together with the results it takes from the literature and a theorem on the structure of Gerver's sofa that the paper states without proof.
- **Uniqueness.** Every moving sofa of maximum area is Gerver's sofa, after a rotation and a translation. Baek's paper does not prove this, and Google DeepMind's [formal-conjectures](https://github.com/google-deepmind/formal-conjectures/blob/main/FormalConjectures/Wikipedia/MovingSofa.lean) lists it as an open problem. As far as I know, this is its first proof.
- **The bridge.** formal-conjectures states the problem with definitions of its own. The project proves that they describe the same sofas, the same maximum area and the same Gerver's sofa as Baek's, so its statements, the open one included, follow.

## Why it's hard

A moving sofa is any connected shape that has some motion through the hallway, so the problem optimizes over infinitely many shapes and motions at once. For a long time there was no way to write down the area of a general sofa: every derivation of Gerver's sofa assumed its shape in advance and showed that small changes don't increase its area. That is evidence of a local maximum, not a proof of a global one.

Baek's proof gets around this with an upper bound. For a well-behaved sofa it builds a larger region whose area $$\mathcal{Q}$$ can be computed, and that bound is a concave function of the sofa. A concave function's local maximum is a global one, and Gerver's sofa is a local maximum of $$\mathcal{Q}$$, where the bound equals the area. Most of the paper shows that a largest sofa is well behaved enough for the bound to apply.

## Prior work

Hammersley found a sofa of area $$\pi/2 + 2/\pi \approx 2.2074$$ in 1968 and showed that no sofa is larger than $$2\sqrt2$$. Gerver's sofa came in 1992, with Gerver's conjecture that it is optimal. Dan Romik derived it from a system of differential equations in 2018 and found its exact description; Kallus and Romik proved by computer that no sofa has area above $$2.37$$. Baek's [preprint](https://arxiv.org/abs/2411.19826) closed the gap in 2024.

Two other Lean formalizations of Baek's proof appeared shortly before this one, by [Dean Cureton](https://github.com/deancureton/MovingSofa) and by [Ruifeng Cao](https://github.com/RuifengCao/sofa-formal). Both prove formal-conjectures' statement that Gerver's sofa has the maximum area. This one differs in stating the theorem with Baek's own definitions, in proving the uniqueness, and in checking the paper itself: the repository's [report](https://github.com/vltanh/lean4-moving-sofa/blob/main/REPORT.md) lists the statements that needed a correction. All of them have an evident fix, and every result of the paper holds.

## The proof

Baek's proof narrows down what a largest sofa can look like until the upper bound applies.

<div class="row justify-content-center">
  <div class="col-sm-9 mt-3 mt-md-0">
    <img src="/assets/img/lean4-moving-sofa/gerver-sofa.svg" class="img-fluid" alt="Gerver's sofa between the lines y = 0 and y = 1, with the arch of its niche traced by the inner corner of the moving hallway">
  </div>
</div>
<div class="caption">Gerver's sofa, seen from the sofa as the hallway moves around it. The inner corner of the hallway traces the arch underneath (orange), its rotation path.</div>

Seen from the sofa, the hallway rotates and slides around it, and the sofa fits inside every position of the hallway. A largest sofa can be taken to be _monotone_: the intersection of the hallways that touch it from outside. Such a sofa is a convex _cap_ minus the _niche_ carved out by the inner corner, so the problem becomes one about convex bodies. Next, a largest sofa is a limit of polygons whose opposite sides balance in length, an idea of Gerver's that Baek repairs, because Gerver's argument could disconnect the sofa. Balance gives room for a full right-angle turn, and a differential inequality on the balanced sides then shows that the corner's path, the arch above, never loops back. For such sofas, Baek encloses the sofa in a region shaped like Gerver's sofa, and its area $$\mathcal{Q}$$ is a quadratic function of three convex bodies. Mamikon's theorem on swept areas makes it concave, and Romik's differential equations show that no direction increases it at Gerver's sofa, which is therefore its maximum.

## Uniqueness

Optimality does not give uniqueness for free. Baek's argument proves the needed properties only for one particular largest sofa, a limit of polygons chosen by compactness, not for an arbitrary largest sofa. The uniqueness proof redoes those steps for any largest sofa. It approximates the given sofa's cap by polygons that maximize area minus a penalty for straying from it, and passes the polygons' balance conditions to the limit as curvature bounds. These give the given sofa the right-angle turn and the non-looping corner path, so Baek's bound applies to it. Equality in the bound then forces equality in each of Mamikon's swept areas, which pins the cap down to Gerver's, up to a horizontal shift. Finally, Gerver's sofa is the closure of its interior, so a closed set inside it with the same area is all of it. ChatGPT Pro 6 found this argument; it has not been peer reviewed, and Lean checks every step of the formal proof.

## Verification

Lean checks every proof, and nothing is assumed beyond Lean's three standard axioms. The theorems are restated in a self-contained file, with copies of the definitions in Mathlib's vocabulary, and [Comparator](https://github.com/leanprover/comparator) checks that the proofs prove exactly those statements. The project is registered in the [Palomar registry](https://palomar-registry.org/entry.html?id=PALOMAR-2026-10-02-000008) as PALOMAR-2026-10-02-000008, whose check replays the proofs through the kernels NanoDa and con-ron as well. The proofs are written out in [docs/proof/](https://github.com/vltanh/lean4-moving-sofa/blob/main/docs/proof/README.md), an illustrated textbook in which every result links to the Lean code that proves it.

## Contributors

Claude Opus 5.5 formalized Baek's paper, wrote the audit of the paper, and completed the uniqueness proof and the bridge from Lean drafts by ChatGPT Pro 6, which also wrote the uniqueness argument. I directed the work. The agents followed my skill for formalizing papers, [formalize-math-paper](/projects/formalize-math-paper/); the repository's [contributors page](https://github.com/vltanh/lean4-moving-sofa/blob/main/docs/contributors.md) records who did what, and how long each part took.

## References

- L. Moser, Problem 66-11, Moving furniture through a hallway, _SIAM Review_ 8 (1966), 381.
- J. L. Gerver, [On moving a sofa around a corner](https://doi.org/10.1007/BF02414066), _Geometriae Dedicata_ 42 (1992), 267–283.
- D. Romik, [Differential equations and exact solutions in the moving sofa problem](https://doi.org/10.1080/10586458.2016.1270858), _Experimental Mathematics_ 27 (2018), 316–330.
- Y. Kallus, D. Romik, [Improved upper bounds in the moving sofa problem](https://doi.org/10.1016/j.aim.2018.10.022), _Advances in Mathematics_ 340 (2018), 960–982.
- J. Baek, [Optimality of Gerver's sofa](https://arxiv.org/abs/2411.19826), arXiv:2411.19826 (2024).
