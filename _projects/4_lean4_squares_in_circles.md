---
layout: page
title: Formalization of “Squares in Circles” in Lean 4
permalink: /projects/lean4-squares-in-circles/
description: Lean 4 proofs of the smallest circle that holds n unit squares, and of every packing that achieves it, for n = 1 to 7.
img: assets/img/lean4-squares-in-circles/front-optimal.svg
og_image: /assets/img/lean4-squares-in-circles/front-optimal.png
importance: 4
category: fun
project_intro: true
math: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/lean4-squares-in-circles
_styles: >-
  article table td { vertical-align: middle; }
---

This project started with a Reddit post of someone frying tofu, showing off how they had packed the squares into a round pan. They had reason to be proud, since packing squares into a circle is surprisingly hard.

The mathematical version asks how small a circle can be if it has to hold $$n$$ unit squares that don't overlap. Erich Friedman's [Packing Center](https://erich-friedman.github.io/packing/squincir/) collects the best packings anyone has found, and for most $$n$$ nobody has proved them optimal. This project settles the first seven cases in Lean 4, $$n = 1, \dots, 7$$, proving both the smallest radius and every packing that reaches it.

| $$n$$ |          optimal radius          |                                                                         an optimal packing                                                                          |
| :---: | :------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------------------------------------: |
|   1   |  $$\sqrt{2}/2 \approx 0.7071$$   |                             <img src="/assets/img/lean4-squares-in-circles/models/one.svg" width="160" alt="one square in its circle">                              |
|   2   |  $$\sqrt{5}/2 \approx 1.1180$$   |                        <img src="/assets/img/lean4-squares-in-circles/models/two.svg" width="160" alt="the 2 by 1 rectangle in its circle">                         |
|   3   | $$5\sqrt{17}/16 \approx 1.2885$$ |                               <img src="/assets/img/lean4-squares-in-circles/models/three.svg" width="160" alt="the T in its circle">                               |
|   4   |   $$\sqrt{2} \approx 1.4142$$    |                          <img src="/assets/img/lean4-squares-in-circles/models/four.svg" width="160" alt="the 2 by 2 block in its circle">                          |
|   5   |  $$\sqrt{5/2} \approx 1.5811$$   |                              <img src="/assets/img/lean4-squares-in-circles/models/five.svg" width="160" alt="the plus in its circle">                              |
|   6   |  $$\sqrt{q_*} \approx 1.6885$$   | <img src="/assets/img/lean4-squares-in-circles/models/six.svg" width="160" alt="a central square, four neighbours and a sixth square turned by 45°, in its circle"> |
|   7   |  $$\sqrt{13}/2 \approx 1.8028$$  |       <img src="/assets/img/lean4-squares-in-circles/models/seven.svg" width="160" alt="two columns of two squares beside a column of three, in its circle">        |

Six squares are the only case where the squares don't all share one orientation: five do, and the sixth is turned by 45°. The radius is $$\sqrt{q_*}$$, where $$q_* \approx 2.8512$$ is an irrational root of a quartic, and the packing is still the only optimal one.

Seven squares have infinitely many optimal packings. The three squares in the middle column can each slide up and down without changing the radius, and the proof covers every position.

## Why it's hard

A packing of $$n$$ squares (a centre and a rotation each) lives in $$3n$$ real dimensions, constrained by the disk and $$\binom{n}{2}$$ pairwise non-overlap conditions. Proving that the T is the best packing of three squares means covering all nine dimensions at once: no way of placing and turning three squares fits them in a smaller circle, and every way that fits them in the T's circle is congruent to the T.

## Prior work

One and two squares are folklore. For three, Montanher et al. (2019) enclosed the radius in an interval of width $$6 \cdot 10^{-14}$$ by interval branch and bound. Convincing, but it trusts C++ code and interval rounding, and gives neither the exact radius nor uniqueness, both of which this project proves. Four squares were Problem 6 of IMSC 2026, whose official solution proves the radius. An unpublished note by Wei Zhao, shared by Friedman, also proves that the 2×2 block is the only optimal packing, with the same quarter-circle argument used here. This proof was written without the note, but the note was also developed with Claude, so the two may not be independent. For five, six and seven squares, no earlier proof turned up. For six, Friedman's page gives the exact radius of the best known packing, found by David Ellsworth in 2023, and it agrees with the one proved here.

Proof assistants have verified other packing theorems, the Kepler conjecture in HOL Light and Isabelle and sphere packing in dimension 8 in Lean, but I found no earlier formal proof of an optimal packing of squares or circles in a circle or a square. More detail is in [docs/prior-work.md](https://github.com/vltanh/lean4-squares-in-circles/blob/main/docs/prior-work.md).

## The proof

Each proof takes an arbitrary packing of $$n$$ squares in the disk of radius $$R_n$$ and shows that it is congruent to the packing in the table. That disk is so tight that the squares crowd around its centre, and every proof comes down to how they share the room there.

One square fits in the disk of radius $$\sqrt2/2$$, half its diagonal, only if it is centred at the disk centre. Two squares in the disk of radius $$\sqrt5/2$$ have their centres within $$1/2$$ of the disk centre but, since they don't overlap, at least $$1$$ apart. So the centres sit exactly $$1/2$$ away on opposite sides, which makes the disk centre the midpoint of an edge the squares share: the 2×1 rectangle.

From three to six squares, the proofs measure that room on a small circle around the disk centre. Squares that don't overlap cover disjoint arcs of it, and at the optimal radius each square that doesn't contain the centre covers at least $$1/n$$ of the circle, so $$n$$ of them would use all of it. A square that contains the centre gets no such bound, and each case handles it separately.

For three squares, the hard step shows that no square contains the centre. Such a square can cover a little less than a third of the circle, but not much less, so the other two would have to cover almost exactly a third each. That puts both nearly where the top square of the T sits, and there they overlap. With no square containing the centre, each covers exactly a third, which only the squares of the T do. Four squares each cover at least a quarter, even one that contains the centre, so each covers exactly a quarter, which puts the disk centre at a corner of every square: the 2×2 block.

With five or six squares, a square that doesn't contain the centre covers more than $$1/n$$ of the circle, so one square must contain it. For five, that square sits exactly on the disk centre: otherwise, sliding it straight away from the centre would sweep out a fifth of the circle without touching the others, overfilling the circle again. The other four then sit against its sides, forming the plus.

For six squares, whose optimal packing has a turned square, the arcs only start the proof, and the rest is a balance of forces. Each pair of squares that touch in the optimal packing gives an inequality that keeps them apart, and with the right weights these inequalities act like forces that cancel on the central square and press the other five against the boundary. A disk of radius $$R_6$$ can just withstand them, so every contact holds, and the contacts fix the packing. Most of the proof shows that an arbitrary packing is separated the same way as the optimal one, so that the balance applies.

Seven squares need a different idea, because the arcs come up short. In the disk of radius $$R_7$$, a square that doesn't contain the centre can cover less than a sixth of any circle about the disk centre: even on the best one, of radius $$1$$, it may get only about 58° instead of 60°. Six arcs then leave room to spare, so the proof compares the squares two at a time. Every square that doesn't contain the centre reaches the circle of radius $$1$$ and gets a _marker_, a carefully chosen point of that circle in the square. Two such squares that don't overlap have markers at least a sixth of the circle apart, even when their arcs are short, and exactly a sixth apart only when they touch as in the optimal packing. This pair theorem is the longest proof in the library. Seven markers that far apart would need more than the whole circle, so one square contains the centre, and the other six markers sit exactly a sixth of the circle apart, at the corners of a regular hexagon. Neighbouring squares then touch as in the optimal packing, which rebuilds it up to the slides of the middle column.

The radius follows in every case: a packing in a smaller disk would also lie in the disk of radius $$R_n$$ with the same centre, so it would be one of these packings, but those have corners on the circle of radius $$R_n$$.

Lean checks every step, and nothing is assumed beyond Lean's three standard axioms. The repository is also set up for the [Palomar](https://palomar-registry.org/) registry, which replays the proofs through two more kernels, NanoDa and con-ron. The details are in [docs/proof/](https://github.com/vltanh/lean4-squares-in-circles/blob/main/docs/proof/README.md), an illustrated textbook with one chapter per case, where every result links to the Lean code that proves it.

## What's next

Every proof here comes down to how the squares share the room around the disk centre. That works because, at these sizes, at most one square sits in the middle and the rest form a single ring around it, so every square comes close to the centre.

Eight squares are the natural next case, since they still have that shape: in the best known packing, found by David W. Cantrell in 2002, one square covers the disk centre and the other seven surround it. But the ring is irregular. Two of the seven squares are turned against the rest, and some squares can still move, so the argument for seven squares, which ends in a regular hexagon, has nothing regular to land on. That packing is also not known to be optimal.

Larger packings eventually grow extra layers, and the outer squares never come near the centre. The same idea would then need one circle per layer, a budget on each, and an argument for how the squares split between the layers. That last part is where the cases multiply, since every extra square adds three dimensions and many new ways for the squares to touch.

## Contributors

ChatGPT 6 Pro and Claude Opus 5 and 5.5 wrote the proofs and the Lean code, and I directed and reviewed the work. Who did what, and when, is in [docs/contributors.md](https://github.com/vltanh/lean4-squares-in-circles/blob/main/docs/contributors.md).

## References

- Erich Friedman, [Squares in Circles](https://erich-friedman.github.io/packing/squincir/), Erich's Packing Center.
- T. Montanher, A. Neumaier, M. C. Markót, F. Domes, H. Schichl, [Rigorous packing of unit squares into a circle](https://doi.org/10.1007/s10898-018-0711-5), _Journal of Global Optimization_ 73 (2019), 547–565.
- T. Hales et al., [A formal proof of the Kepler conjecture](https://doi.org/10.1017/fmp.2017.1), _Forum of Mathematics, Pi_ 5 (2017), e2.
- S. Hariharan, C. Birkbeck, S. Lee, H. K. G. Ma, B. Mehta, A. Poiroux, M. Viazovska, [Progress in formalizing sphere packing in dimension 8](https://arxiv.org/abs/2604.23468), arXiv:2604.23468 (2026).
