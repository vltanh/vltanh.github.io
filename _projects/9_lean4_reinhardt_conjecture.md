---
layout: page
title: Toward the Reinhardt conjecture in Lean 4
permalink: /projects/lean4-reinhardt-conjecture/
description: A Lean 4 proof, in progress, that Reinhardt's smoothed octagon packs the plane worst among centrally symmetric convex shapes.
img: assets/img/lean4-reinhardt-conjecture/octagon-tiling.svg
og_image: /assets/img/lean4-reinhardt-conjecture/octagon-tiling.png
importance: 9
category: fun
project_intro: true
math: true
icons:
  - file: assets/img/icons/lean_logo.svg
repository:
  - vltanh/lean4-smoothed-octagon
---

Copies of a disk, packed as tightly as possible, cover $$\pi/\sqrt{12} = 90.69\ldots\%$$ of the plane, while squares and regular hexagons cover all of it. In 1934 Karl Reinhardt conjectured that among centrally symmetric convex shapes, those that look the same after a half turn, the one that packs worst is the _smoothed octagon_, a regular octagon whose corners are cut off by arcs of hyperbolas. Its densest packing has density

$$\delta_{\mathrm{oct}} = \frac{8 - 4\sqrt2 - \log 2}{2\sqrt2 - 1} = 0.902414\ldots,$$

and he conjectured that it is the only worst shape, up to affine maps. Kurt Mahler reached the same octagon independently in 1947. The conjecture is still open, and the Lean 4 proof that this project is writing is not finished.

<div class="row justify-content-center">
  <div class="col-sm-8 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-reinhardt-conjecture/worst-packer.gif" class="img-fluid rounded mx-auto d-block" width="500" avoid_scaling=true alt="Copies of the smoothed octagon in a densest packing, sliding past each other while each keeps touching its neighbours" caption="The smoothed octagon in its densest packing. The copies slide through a continuum of densest packings, and each keeps touching its six neighbours." %}
  </div>
</div>

<p style="text-align:center; margin-top:1rem;"><a href="/smoothed-octagon/">pack shapes yourself and try to beat the octagon &rarr;</a></p>

## The smoothed octagon

Take the regular octagon whose sides lie on the lines $$x \cos(k\pi/4) + y \sin(k\pi/4) = 1$$, $$k = 0, \dots, 7$$. At each corner, extend the two sides next to the corner's sides, and replace the corner by an arc of the curve along which the product of the distances $$d$$ and $$d'$$ to these two lines is $$\sqrt2/4$$. The curve is a hyperbola with the two lines as asymptotes. At the corner of the sides $$x = 1$$ and $$x + y = \sqrt2$$, it is

$$(1 - y)(\sqrt2 - x + y) = \tfrac12,$$

and it touches the two sides at $$(1, 1 - 1/\sqrt2)$$ and $$(\sqrt2 - \tfrac12, \tfrac12)$$. The constant $$\sqrt2/4$$ is the one for which the curve touches both sides without crossing them, so the boundary has no corners left. Each side keeps a straight middle part of length $$2 - \sqrt2$$.

<div class="row justify-content-center">
  <div class="col-sm-10 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-reinhardt-conjecture/octagon-construction.svg" class="img-fluid" alt="A regular octagon with one corner rounded by the hyperbola that touches the two sides at the corner and approaches the lines of the next two sides, with the corner magnified" caption="One corner of the regular octagon, cut off by the hyperbola that touches its two sides and approaches the next two (dashed). The product of the distances to the two dashed lines is constant along the curve." %}
  </div>
</div>

For a centrally symmetric convex shape, László Fejes Tóth proved in 1950 that no packing beats the best lattice packing, where the copies sit at the points of a grid of parallelograms. The best lattice packing comes from the hexagon of least area among the affine images of a regular hexagon inscribed in the shape, and the copies touch at its corners. The regular octagon already packs worse than the disk, which Mahler called "rather surprising", and rounding its corners makes it worse still. Unlike the disk's, the smoothed octagon's densest packings come in a continuum: every such hexagon inscribed in it has the same area.

<div class="row justify-content-center">
  <div class="col-sm-8 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-reinhardt-conjecture/packing-densities.svg" class="img-fluid" alt="Densest packings of the disk, the regular octagon, the smoothed 14-gon and the smoothed octagon, with densities 0.906900, 0.906164, 0.906052 and 0.902414" caption="The disk, the regular octagon, the smoothed 14-gon and the smoothed octagon, all of inradius 1, each in front of its densest packing." %}
  </div>
</div>

The smoothed 14-gon in the figure belongs to the same family as the octagon. Hales showed in 2017 that the smoothed regular polygons with $$6k + 2$$ sides, $$8, 14, 20, \dots$$, are all Pontryagin extremals of his control problem: they satisfy the conditions that Pontryagin's maximum principle sets for a worst shape. Their densities increase with $$k$$ towards the disk's $$\pi/\sqrt{12}$$, and the octagon's is the least: $$0.902414$$ for $$k = 1$$, $$0.906052$$ for $$k = 2$$, just below the regular octagon's $$0.906164$$, and $$0.906607$$ for $$k = 3$$. Hales and Vajjha found no other extremals, and they wrote in 2024 that "a proof that no other extremals exist would complete a proof of the Reinhardt conjecture".

## The statements

The definitions and statements are in a Challenge file that imports only Mathlib, copied word for word from [lean4-smoothed-polygon](https://github.com/vltanh/lean4-smoothed-polygon), a formalization of Hales and Vajjha's book _Packings of Smoothed Polygons_ on which this project builds. The density of a shape is the supremum of the densities of packings of the plane by congruent copies of it. The four theorems say:

- every centrally symmetric convex disk has greatest packing density at least $$\delta_{\mathrm{oct}}$$;
- equality holds exactly for the images of the smoothed octagon under invertible affine maps;
- every trajectory of Hales's control problem with the boundary conditions costs at least $$\sqrt{12}\,\delta_{\mathrm{oct}}$$;
- the smoothed octagon, defined from its trajectory, has area $$\sqrt{12}\,\delta_{\mathrm{oct}}$$ and density $$\delta_{\mathrm{oct}}$$.

## The proof, in brief

Following Thomas Hales, the problem becomes a problem of optimal control on $$\mathrm{SL}_2(\mathbb{R})$$. A worst shape, normalized so that the hexagon of its densest packing is regular, is traced by six points that slide along its boundary, and its area is the cost of the trajectory they follow. Conversely, every trajectory of cost below $$\pi$$ bounds such a shape.

<div class="row justify-content-center">
  <div class="col-sm-8 mt-3 mt-md-0">
    {% include figure.liquid path="assets/img/lean4-reinhardt-conjecture/multipoint.gif" class="img-fluid rounded mx-auto d-block" width="520" avoid_scaling=true alt="The six contact points of the smoothed octagon moving around its boundary, with the six neighbouring copies of its densest packing" caption="The six points where the smoothed octagon touches its neighbours move around its boundary through one period of its trajectory, and the six neighbouring copies move with them." %}
  </div>
</div>

The proof has five stages. The foundations show that the conjecture is equivalent to a lower bound on the cost of every admissible trajectory, and that a worst shape gives a global minimizer of the control problem. The reduction shows that a global minimizer stays in a compact part of the state space, satisfies Pontryagin's maximum principle (proved in Lean in [lean4-optimal-control](https://github.com/vltanh/lean4-optimal-control)), switches between the three vertices of the control simplex finitely many times, and is normal. Read around a period, the switches then fall into five classes when there are six or more pieces, and each class is excluded. A period with at most five pieces costs at least $$\sqrt{12}\,\delta_{\mathrm{oct}}$$, with equality only for the octagon's four-piece control with equal durations. Finally, a worst shape has the octagon's trajectory, so it is a linear image of the octagon.

## Status

The proof is not finished. The informal proof that the project formalizes was written by ChatGPT Pro, in notes that rely in part on interval arithmetic computed in C++, and it has not been peer reviewed. In Lean, the main theorem is proved from the stages below, under two named hypotheses: Hales and Vajjha's compactness theorem (Theorem 5.0.2 of their book), until its formalization in lean4-smoothed-polygon is complete, and seven interval-arithmetic covers used in two of the five cases, stated as the C++ programs certify them. As of 7 November 2026:

| Stage                                      | State                               |
| :----------------------------------------- | :---------------------------------- |
| Foundations                                | proved                              |
| Reduction to a finite normal period        | proved, given Theorem 5.0.2         |
| Splitting periods into five classes        | proved                              |
| Excluding two of the classes               | in progress                         |
| Excluding a third class                    | stated                              |
| Excluding the last two classes             | stated, from the interval covers    |
| Periods with at most five pieces           | proved from four lemmas in progress |
| Equality and its converse                  | proved                              |
| The four statements, from the stages above | proved                              |

The project will restate the Challenge in a Solution file once no `sorry` and no hypothesis remain.

## Prior work

Reinhardt posed the problem in 1934 and proposed the smoothed octagon. Mahler, independently, proved in 1946 that every centrally symmetric convex shape packs at least $$\sqrt3/2$$, and in 1947 that a worst shape exists and that among octagons the regular one is worst; he built the smoothed octagon as "possibly even" the answer. Walter Ledermann and Mahler named it in 1949. Fejes Tóth reduced the problem to lattice packings in 1950. V. Ennola and P. P. Tammela raised the lower bound to $$0.88$$ in 1961 and to $$0.892656$$ in 1970, and F. L. Nazarov proved in 1986 that the smoothed octagon is a local minimum. Hales recast the problem in the calculus of variations in 2011 and as optimal control in 2017, and in 2024 Hales and Koundinya Vajjha proved in _Packings of Smoothed Polygons_ that a worst shape is a smoothed polygon with finitely many sides, Mahler's first conjecture, adding that Reinhardt's conjecture "remains open". Chapters 2–4, 6 and 7 of their book are formalized in Lean in lean4-smoothed-polygon, and the repository's prior-work notes give the full history with references.

## Contributors

ChatGPT Pro wrote the informal proof, with its computer-assisted parts. Claude Opus 5.5, in Claude Code, writes the Lean formalization, the figures and the documentation, and made the playground. I direct the work. The geometric and control-theoretic foundations come from lean4-smoothed-polygon and lean4-optimal-control.

## References

- K. Reinhardt, [Über die dichteste gitterförmige Lagerung kongruenter Bereiche in der Ebene und eine besondere Art konvexer Kurven](https://doi.org/10.1007/BF02940676), _Abhandlungen aus dem Mathematischen Seminar der Universität Hamburg_ 10 (1934), 216–230.
- K. Mahler, [On the area and the densest packing of convex domains](https://dwc.knaw.nl/DL/publications/PU00018299.pdf), _Proceedings of the Koninklijke Nederlandse Akademie van Wetenschappen_ 50 (1947), 108–118.
- K. Mahler, [On the minimum determinant and the circumscribed hexagons of a convex domain](https://dwc.knaw.nl/DL/publications/PU00018367.pdf), _Proceedings of the Koninklijke Nederlandse Akademie van Wetenschappen_ 50 (1947), 692–703.
- W. Ledermann, K. Mahler, [On lattice points in a convex decagon](https://doi.org/10.1007/BF02395026), _Acta Mathematica_ 81 (1949), 319–351.
- L. Fejes Tóth, [Some packing and covering theorems](http://acta.bibl.u-szeged.hu/13588/), _Acta Scientiarum Mathematicarum (Szeged)_ 12 A (1950), 62–67.
- P. P. Tammela, [An estimate of the critical determinant of a two-dimensional convex symmetric domain](https://www.mathnet.ru/eng/ivm3798), _Izvestiya Vysshikh Uchebnykh Zavedenii. Matematika_ 1970, no. 12, 103–107.
- F. L. Nazarov, [Reinhardt's problem of lattice packings of convex domains: local extremality of the Reinhardt octagon](https://doi.org/10.1007/BF01727653), _Journal of Soviet Mathematics_ 43 (1988), 2687–2693.
- T. C. Hales, [On the Reinhardt conjecture](https://arxiv.org/abs/1103.4518), _Vietnam Journal of Mathematics_ 39 (2011), 287–307.
- T. Hales, [The Reinhardt conjecture as an optimal control problem](https://arxiv.org/abs/1703.01352), arXiv:1703.01352 (2017).
- T. Hales, K. Vajjha, [Packings of smoothed polygons](https://arxiv.org/abs/2405.04331), arXiv:2405.04331 (2024).
