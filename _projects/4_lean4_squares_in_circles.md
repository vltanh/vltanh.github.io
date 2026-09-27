---
layout: page
title: Formalization of “Squares in Circles” in Lean 4
permalink: /projects/lean4-squares-in-circles/
description: Lean 4 proofs of the smallest circle that holds n unit squares, and of every packing that achieves it, for n = 1 to 5 and n = 7.
img: assets/img/lean4-squares-in-circles/front-optimal.svg
og_image: /assets/img/lean4-squares-in-circles/front-optimal.png
importance: 4
category: fun
project_intro: true
math: true
icons:
  - file: assets/img/lean4-analysis-tao/lean_logo.svg
repository:
  - vltanh/lean4-squares-in-circles
_styles: >-
  article table td { vertical-align: middle; }
---

This project started with a Reddit post of someone frying tofu, showing off how they had packed the squares into a round pan. They had reason to be proud, since packing squares into a circle is surprisingly hard.

The mathematical version asks how small a circle can be if it has to hold $$n$$ unit squares that don't overlap. Erich Friedman's [Packing Center](https://erich-friedman.github.io/packing/squincir/) collects the best packings anyone has found, and for most $$n$$ nobody has proved them optimal. This project settles six cases in Lean 4, $$n = 1, \dots, 5$$ and $$n = 7$$, proving both the smallest radius and every packing that reaches it.

| $$n$$ |          optimal radius          |                                                                   an optimal packing                                                                   |
| :---: | :------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------: |
|   1   |  $$\sqrt{2}/2 \approx 0.7071$$   |                       <img src="/assets/img/lean4-squares-in-circles/models/one.svg" width="160" alt="one square in its circle">                       |
|   2   |  $$\sqrt{5}/2 \approx 1.1180$$   |                  <img src="/assets/img/lean4-squares-in-circles/models/two.svg" width="160" alt="the 2 by 1 rectangle in its circle">                  |
|   3   | $$5\sqrt{17}/16 \approx 1.2885$$ |                        <img src="/assets/img/lean4-squares-in-circles/models/three.svg" width="160" alt="the T in its circle">                         |
|   4   |   $$\sqrt{2} \approx 1.4142$$    |                   <img src="/assets/img/lean4-squares-in-circles/models/four.svg" width="160" alt="the 2 by 2 block in its circle">                    |
|   5   |  $$\sqrt{5/2} \approx 1.5811$$   |                       <img src="/assets/img/lean4-squares-in-circles/models/five.svg" width="160" alt="the plus in its circle">                        |
|   7   |  $$\sqrt{13}/2 \approx 1.8028$$  | <img src="/assets/img/lean4-squares-in-circles/models/seven.svg" width="160" alt="two columns of two squares beside a column of three, in its circle"> |

Seven squares have infinitely many optimal packings. The three squares in the middle column can each slide up and down without changing the radius, and the proof covers every position.

## Why it's hard

A packing of $$n$$ squares (a centre and a rotation each) lives in $$3n$$ real dimensions, constrained by the disk and $$\binom{n}{2}$$ pairwise non-overlap conditions. Proving that the T is the best packing of three squares means covering all nine dimensions at once: no way of placing and turning three squares fits them in a smaller circle, and every way that fits them in the T's circle is the T itself, up to rotation.

## Prior work

One and two squares are folklore. For three, Montanher et al. (2019) enclosed the radius in an interval of width $$6 \cdot 10^{-14}$$ by interval branch and bound. Convincing, but it trusts C++ code and interval rounding, and gives neither the exact radius nor uniqueness, both of which this project proves. Four squares were Problem 6 of IMSC 2026, whose official solution proves the radius. An unpublished note by Wei Zhao, shared by Friedman, also proves that the 2×2 block is the only optimal packing, with the same quarter-circle argument used here. This proof was written without the note, but the note was also developed with Claude, so the two may not be independent. For five and seven squares, no earlier proof turned up.

Proof assistants have verified other packing theorems, the Kepler conjecture in HOL Light and Isabelle and sphere packing in dimension 8 in Lean, but I found no earlier formal proof of an optimal packing of squares or circles in a circle or a square. More detail is in [docs/prior-work.md](https://github.com/vltanh/lean4-squares-in-circles/blob/main/docs/prior-work.md).

## The proof

For three to five squares, the argument is an _angle budget_. Every square without the disk centre strictly inside it covers at least $$2\pi/n$$ of a small circle around the centre (the centre may still lie on its edge), and squares that don't overlap can't cover more than the whole circle between them. A square with the centre strictly inside may cover less than $$2\pi/n$$, so each case handles it separately. For three squares this is the hardest step: such a square would leave the other two no positions except ones where they overlap, so the centre is never strictly inside a square. In the T it sits on the edge between the two lower squares. With that settled, the budget pins every arc to exactly $$2\pi/n$$ for three and four squares, which rebuilds the optimal packing; for five, it leaves room only for a square centred at the disk centre, which forces the plus.

Seven squares need a different idea. Each square without the disk centre strictly inside it gets a _marker_, a direction from the centre computed from where the square sits, and in the optimal disk two such squares that don't overlap have markers at least $$\pi/3$$ apart. That step is the longest proof in the library. Seven markers that far apart would need $$7\pi/3$$, more than a full turn, so one square has the centre strictly inside it, and the other six markers sit exactly $$\pi/3$$ apart, a regular hexagon that rebuilds the packing up to the heights of the middle column.

The lower bound follows the same way in every case. A packing in a smaller disk would also be a packing in the optimal disk, so it would have to be one of the optimal packings. Their outer corners touch the optimal circle, so none of them fits in a smaller disk.

Lean checks every step, and nothing is assumed beyond Lean's three standard axioms. The repository is also set up for the [Palomar](https://palomar-registry.org/) registry, which replays the proofs through two more kernels, NanoDa and con-ron. Readers who want the details can find them in [docs/proof/](https://github.com/vltanh/lean4-squares-in-circles/blob/main/docs/proof/README.md), an illustrated textbook with one chapter per case, where every result links to the Lean code that proves it.

## What's next

Six squares are next, and they break the pattern. In every packing above, all the squares share one orientation; in the best known packing of six, five do and the sixth is turned by 45°. The angle budget and the markers still help, but they no longer finish the job on their own. The argument splits into a long list of ways the six squares can touch, each needing its own inequality, and it isn't even known yet whether that packing is the only optimal one. There's some partial progress, but no proof yet.

Eight squares and up are further off, though the method might stretch that far. Every proof here draws one small circle around the disk centre and adds up how much of it the squares cover. That works because, at these sizes, at most one square sits in the middle and the rest form a single ring around it, so every square reaches the circle. With more squares, the packing grows extra layers, and the outer squares never come near a small circle at the centre. Extending the budget would take one circle per layer, a budget on each, and an argument for how the squares split between the layers. That last part is where the cases multiply, since every extra square adds three dimensions and many new ways for the squares to touch.

## Contributors

ChatGPT 6 Pro and Claude Opus 5 and 5.5 wrote the proofs and the Lean code, and I directed and reviewed the work. Who did what, and when, is in [docs/contributors.md](https://github.com/vltanh/lean4-squares-in-circles/blob/main/docs/contributors.md).

## References

- Erich Friedman, [Squares in Circles](https://erich-friedman.github.io/packing/squincir/), Erich's Packing Center.
- T. Montanher, A. Neumaier, M. C. Markót, F. Domes, H. Schichl, [Rigorous packing of unit squares into a circle](https://doi.org/10.1007/s10898-018-0711-5), _Journal of Global Optimization_ 73 (2019), 547–565.
- T. Hales et al., [A formal proof of the Kepler conjecture](https://doi.org/10.1017/fmp.2017.1), _Forum of Mathematics, Pi_ 5 (2017), e2.
- S. Hariharan, C. Birkbeck, S. Lee, H. K. G. Ma, B. Mehta, A. Poiroux, M. Viazovska, [Progress in formalizing sphere packing in dimension 8](https://arxiv.org/abs/2604.23468), arXiv:2604.23468 (2026).
