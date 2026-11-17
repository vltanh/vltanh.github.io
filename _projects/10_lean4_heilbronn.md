---
layout: page
title: Heilbronn's triangle problem in Lean 4
permalink: /projects/lean4-heilbronn/
description: A Lean 4 proof of how large the smallest triangle of nine points in the unit square can be, and that only one configuration reaches it, up to the symmetries of the square.
img: assets/img/lean4-heilbronn/front-optimal.svg
og_image: /assets/img/lean4-heilbronn/front-optimal.png
importance: 10
category: fun
project_intro: true
math: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/lean4-heilbronn
_styles: >-
  .highlight .err { color: inherit; background: none; border: none; }
---

Put $$n$$ points in a square of side $$1$$ and look at the triangles with corners at three of them. Some of these triangles are small, and if three of the points lie on a line, one has area $$0$$. How large can the smallest triangle be? The answer is the Heilbronn number $$H_n$$. Hans Heilbronn asked, around 1950, how fast $$H_n$$ goes to zero as $$n$$ grows, and guessed that it is at most a constant times $$1/n^2$$; János Komlós, János Pintz and Endre Szemerédi proved him wrong in 1982. For small $$n$$, the question is the exact value of $$H_n$$ and the configurations that reach it.

The exact values were known up to eight points, the last two by computer-assisted proofs. For nine, Comellas and Yebra found a configuration in 2002 whose smallest triangle has area $$(9\sqrt{65} - 55)/320$$, and later computations agreed with it to within their tolerances, but I found no proof that it is optimal. [This project](https://github.com/vltanh/lean4-heilbronn) proves in Lean 4 that

$$H_9 = \frac{9\sqrt{65} - 55}{320} = 0.0548760\ldots,$$

and that the configuration of Comellas and Yebra is the only one that reaches it, up to the symmetries of the square.

<div class="row justify-content-center">
  <div class="col-sm-10 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-heilbronn/front-optimal.svg" class="img-fluid" alt="The nine points of the optimal configuration in the unit square: A and H on the left side, B and C at the bottom, D and E on the right, F and G at the top, and O inside, with its eleven triangles of least area shaded in pairs of mirror images in the dashed anti-diagonal" caption="The optimal configuration of nine points. Its eleven triangles of least area are shaded, in pairs of mirror images in the dashed anti-diagonal." %}
  </div>
</div>

<p style="text-align:center; margin-top:1rem;"><a href="/heilbronn/">move the points yourself and try to beat it &rarr;</a></p>

## The configuration

Let $$p_0 = (15 - \sqrt{65})/40 \approx 0.17344$$, the smaller root of $$20x^2 - 15x + 2$$. The nine points are, side by side,

$$
\begin{alignedat}{2}
A &= (0,\ 4p_0 - \tfrac12), &\quad H &= (0,\ 1 - p_0), \\
B &= (p_0,\ 0), &\quad C &= (1 - \tfrac32 p_0,\ 0), \\
D &= (1,\ \tfrac32 p_0), &\quad E &= (1,\ 1 - p_0), \\
F &= (\tfrac32 - 4p_0,\ 1), &\quad G &= (p_0,\ 1), \\
O &= (1 - 2p_0,\ 2p_0).
\end{alignedat}
$$

Two lie on each side of the square, left, bottom, right and top, and one, $$O$$, inside. Eleven of the $$84$$ triangles have the least area, and the next smallest, $$CDO$$, is $$2.8\%$$ larger. The reflection in the anti-diagonal, $$(x, y) \mapsto (1 - y, 1 - x)$$, maps the configuration to itself, so the eight symmetries of the square turn it into four point sets: the configuration and its quarter turns.

## The statements

A point is a pair of real numbers, the square is closed, and the area of a triangle is half the absolute value of a determinant, so three points on a line make area $$0$$. The least area of nine points is the minimum over their $$84$$ triangles, and $$H_9$$ is the supremum of the least areas of nine points in the square. Two configurations are congruent when one, after its points are relabelled, is the image of the other under one of the eight symmetries of the square. With these definitions the project proves three theorems:

```lean
theorem optimal_value : IsGreatest (minAreaValues 9) ((9 * Real.sqrt 65 - 55) / 320)

theorem heilbronn_number : heilbronnNumber 9 = (9 * Real.sqrt 65 - 55) / 320

theorem optimal_configurations (P : Fin 9 → Point) (hP : ∀ i, P i ∈ unitSquare) :
    minTriangleArea P = (9 * Real.sqrt 65 - 55) / 320 ↔ Congruent P optimalConfiguration
```

The first says that some nine points in the square have least area $$(9\sqrt{65} - 55)/320$$ and none have more, the second that this is the supremum $$H_9$$, and the third that nine points in the square reach it exactly when they are congruent to the configuration of Comellas and Yebra. All the definitions are in one file, and the [README](https://github.com/vltanh/lean4-heilbronn#definitions) states them in full.

## The proof, in brief

Some configuration has the largest least area, since the square is compact. Take one. No affine map of determinant greater than $$1$$ can keep it in the square, since that would make every triangle larger. So every side of the square carries a point, and the points on two opposite sides, projected onto one of those sides, have overlapping ranges. Shears preserve area, and with them the configuration can be brought into one of five families, by the corners of the square it occupies.

<div class="row justify-content-center">
  <div class="col-sm-12 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-heilbronn/families.svg" class="img-fluid" alt="Five unit squares with the points each family fixes: N with six points on the sides and no corner; C1 with one corner and four points on the sides; C2 with two opposite corners and four points on the sides; Type II with two adjacent corners and two points on the sides; Type III with three corners" caption="The five families. Each square shows the points that the normalization places on the sides and at the corners (blue); the free points can lie anywhere in the square." %}
  </div>
</div>

- **Corners.** Two opposite corners (C2), two adjacent corners (Type II) and three corners (Type III) all force a triangle smaller than $$H_9$$. The proofs combine bounds on hulls that hold several of the points (a triangle with two of the points inside it has area at least $$4 + 2\sqrt3$$ times the least area, for instance) with long case analyses.
- **One corner.** Family C1 is split by how many points lie in the triangle cut off at the occupied corner: three or more is impossible, and none, one or two each force a triangle smaller than $$H_9$$.
- **No corner.** Family N, the family of the optimal configuration, takes most of the work. It is split by the number of points on the sides. With eight, a sharp inequality on eleven triangles, the eleven of least area in the optimal configuration, gives at most $$H_9$$, with equality only at the optimal configuration. With seven, a chain of exclusions and one cover of certificates force a smaller triangle. With six, the proof turns on the hexagon they span and on where the other three points sit: inside it, or in the caps between it and the square.
- **Certificates.** Many cases end with a polynomial certificate. In the case at hand, some affine expressions in the coordinates are nonnegative, and so is the amount by which each triangle exceeds the area to beat. The certificate gives positive weights to products of these, and the weighted sum expands to a polynomial that is negative on the whole unit cube, so the case cannot happen. The weights were found by linear programming outside Lean, and Lean's kernel expands and checks every one of them: 434,402 weighted products in all.
- **Equality.** The configurations that reach $$H_9$$ end in the sharp inequality on eleven triangles, which leaves only the optimal configuration. That configuration is a strict local maximum, so the shears of the normalization were trivial, and the original nine points are congruent to it.

The proof uses no optimizer, no floating-point bound and no theorem from outside Mathlib.

## Verification

Lean's kernel checks every proof, assuming nothing beyond Lean's three standard axioms, `propext`, `Classical.choice` and `Quot.sound`. No proof uses `native_decide`, which would trust compiled code: the certificates are evaluated by the kernel itself. Most of the library's 398 modules are kernel checks of certificate trees, and each tree is checked one subtree at a time, so that no module needs more than 2.4 GB of memory. A full build takes about 21 minutes with twelve threads.

The proof is packaged for the [Palomar registry](https://palomar-registry.org) but not yet submitted. A Challenge file that imports only Mathlib restates the definitions word for word and states the three theorems, and Comparator, Palomar's checker, confirms that the library proves exactly those statements, replaying the proofs through Lean's kernel and the independent NanoDa kernel. Palomar's own preflight passes on its standard runner in about four and a half hours, most of it spent replaying the certificates.

## Prior work

Comellas and Yebra found the configuration in 2002, by simulated annealing followed by an analytic refinement, and wrote that they had no proof that it is optimal. In 2017 Chen, Xu and Zeng bounded $$H_9$$ between $$(9\sqrt{65} - 55)/320$$ and $$0.054878314$$ by a branch and bound on GPUs, an interval rather than the exact value. Mixed-integer optimization then found the value within solver tolerances: Monji, Modir and Kocuk in 2025, and Sudermann-Merx in 2026, whose preprint claimed a proof in its first version and withdrew the claim in later ones. I found no exact proof of $$H_9$$ before this one, and none that its optimal configuration is unique.

The smaller cases were proved for five and six points by Yang, Zhang and Zeng around 1992, for seven by Zeng and Chen in [2011](https://doi.org/10.1007/978-3-642-21046-4_11) and for eight by Dehbi and Zeng in [2022](https://doi.org/10.1007/s11424-022-1220-7), the last two with the help of a computer. In Lean, Tej Stead's [heilbronn-convex-3-8](https://palomar-registry.org/entry.html?id=PALOMAR-2026-09-02-000012&version=1) proves the values for three to eight points of a different problem, where the points are measured against the area of their own convex hull instead of a fixed square. I found no earlier formal proof of a Heilbronn number of the square. More detail, with references, is in [docs/prior-work.md](https://github.com/vltanh/lean4-heilbronn/blob/main/docs/prior-work.md).

## What's next

The library treats each number of points as a case of its own, with its own folder and its own Palomar entry, and nine points is the first. Ten points is next. The best configuration known, also found by Comellas and Yebra, has least area $$0.0465374\ldots$$, the real root of $$3456x^3 - 1764x^2 + 268x - 9$$. As for nine points before this project, the evidence that it is optimal is numerical.

## Contributors

ChatGPT 6 Pro wrote the first draft of the proof, in the ChatGPT chat, from 14 to 15 November 2026; the draft is archived in the repository, and the Lean proof stands on its own. Claude Opus 5.5, in Claude Code, wrote the Lean proof on 15 November, following my skill for formalizing papers, [formalize-math-paper](/projects/formalize-math-paper/), with up to twelve sub-agents proving parts of it at once. The last `sorry` was closed seven hours after the session began. The next day Claude made the build fit Palomar's memory limits and consolidated the library, and it also wrote the figures, the playground and the documentation. I chose the problem and directed the work. Who did what, and when, is in [docs/contributors.md](https://github.com/vltanh/lean4-heilbronn/blob/main/docs/contributors.md).

## References

- J. Komlós, J. Pintz, E. Szemerédi, [A lower bound for Heilbronn's problem](https://doi.org/10.1112/jlms/s2-25.1.13), _Journal of the London Mathematical Society_ (2) 25 (1982), 13–24.
- F. Comellas, J. L. A. Yebra, [New lower bounds for Heilbronn numbers](https://doi.org/10.37236/1623), _Electronic Journal of Combinatorics_ 9 (2002), R6.
- L. Chen, Y. Xu, Z. Zeng, [Searching approximate global optimal Heilbronn configurations of nine points in the unit square via GPGPU computing](https://doi.org/10.1007/s10898-016-0453-1), _Journal of Global Optimization_ 68 (2017), 147–167.
- A. Monji, A. Modir, B. Kocuk, [Solving the Heilbronn triangle problem using global optimization methods](https://arxiv.org/abs/2512.14505), arXiv:2512.14505 (2025).
- N. Sudermann-Merx, [From global optimization to exact coordinates: Heilbronn's triangle problem on the unit square using mixed-integer nonlinear optimization](https://arxiv.org/abs/2603.11107), arXiv:2603.11107 (2026).
