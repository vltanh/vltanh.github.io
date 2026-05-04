// Comdet specialized 32-node fixture. Hand-tuned to exercise every CD
// algorithm + every post-proc on a single small canvas.
//
// Composition (per plan §4c-bis):
//   A "core"      (12 nodes, 0..11): K_5 on {0,1,2,3,4} + 7-node periphery
//   B "bridge"    ( 8 nodes, 12..19): two K_4's joined by edge 15-16
//   C "disconn"   ( 6 nodes, 20..25): two disconnected 3-cycles
//   D "modular"   ( 4 nodes, 26..29): two 2-cliques + inter-edge + cross-A + cross-B
//   Outliers      ( 2 nodes, 30, 31): isolated + pendant (gt = -1)
//
// Mu (inter / total) ≈ 6 / 49 ≈ 0.122. 49 edges total.
// Source-of-truth for the comdet gallery + the CSV mirror at
// community-detection/examples/cd_fixture/{edge.csv, com.csv}.

(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};
  const COMDET = window.COMDET;

  const NODES = Array.from({ length: 32 }, (_, i) => i);

  // Per-node ground-truth (0..3 for A/B/C/D, -1 for outliers).
  const GT = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0..11  A
    1, 1, 1, 1, 1, 1, 1, 1,             // 12..19 B
    2, 2, 2, 2, 2, 2,                   // 20..25 C
    3, 3, 3, 3,                         // 26..29 D
    -1, -1,                             // 30, 31 outliers
  ];

  // Hand-tuned positions for an 800x600 canvas. Communities visually distinct
  // before any algorithm runs (per playbook_algo_page.md singleton-opener
  // carveout for comdet).
  const POSITIONS = [
    // A core K_5 (0..4), arranged in a ring around (200, 250).
    { id: 0,  x: 200, y: 250 }, // hub
    { id: 1,  x: 150, y: 200 },
    { id: 2,  x: 250, y: 200 },
    { id: 3,  x: 250, y: 300 },
    { id: 4,  x: 150, y: 300 },
    // A periphery (5..11), ringed outside the core.
    { id: 5,  x: 100, y: 250 },
    { id: 6,  x: 200, y: 150 },
    { id: 7,  x: 200, y: 350 },
    { id: 8,  x: 130, y: 160 },
    { id: 9,  x: 280, y: 240 },
    { id: 10, x: 280, y: 320 },
    { id: 11, x: 130, y: 340 },
    // B "bridge" two K_4's joined by 15-16.
    { id: 12, x: 540, y: 180 },
    { id: 13, x: 600, y: 180 },
    { id: 14, x: 540, y: 240 },
    { id: 15, x: 600, y: 240 },
    { id: 16, x: 660, y: 290 },
    { id: 17, x: 720, y: 290 },
    { id: 18, x: 660, y: 350 },
    { id: 19, x: 720, y: 350 },
    // C two disconnected 3-cycles.
    { id: 20, x: 130, y: 510 },
    { id: 21, x: 180, y: 480 },
    { id: 22, x: 180, y: 540 },
    { id: 23, x: 280, y: 510 },
    { id: 24, x: 330, y: 480 },
    { id: 25, x: 330, y: 540 },
    // D two 2-cliques bridging A-periphery + B-periphery.
    { id: 26, x: 380, y: 430 },
    { id: 27, x: 430, y: 430 },
    { id: 28, x: 480, y: 470 },
    { id: 29, x: 530, y: 470 },
    // Outliers.
    { id: 30, x: 720, y: 80  },
    { id: 31, x: 70,  y: 290 },
  ];

  // Edge list. Plan-prescribed structure; counts checked at end.
  const EDGES = [
    // A: K_5 on {0,1,2,3,4} (10 edges)
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 2], [1, 3], [1, 4],
    [2, 3], [2, 4],
    [3, 4],
    // A periphery to K_5 (10 edges)
    [5, 0], [6, 0], [7, 0],
    [8, 1], [8, 2],
    [9, 2], [9, 3],
    [10, 3], [10, 4],
    [11, 4],
    // B K_4 on {12,13,14,15} (6 edges)
    [12, 13], [12, 14], [12, 15], [13, 14], [13, 15], [14, 15],
    // B K_4 on {16,17,18,19} (6 edges)
    [16, 17], [16, 18], [16, 19], [17, 18], [17, 19], [18, 19],
    // B bridge (1 edge)
    [15, 16],
    // C two 3-cycles (6 edges)
    [20, 21], [21, 22], [22, 20],
    [23, 24], [24, 25], [25, 23],
    // D internal (3 edges)
    [26, 27], [28, 29], [27, 28],
    // Inter-community: A↔B (2 edges via hub)
    [0, 12], [0, 16],
    // Inter-community: A↔D (2 edges)
    [26, 5], [28, 7],
    // Inter-community: B↔D (2 edges)
    [27, 13], [29, 17],
    // Inter-community: A↔C (1 edge, connects C-cycle-1 into the main component)
    [20, 7],
    // Inter-community: B↔C (1 edge, connects C-cycle-2 into the main component)
    [23, 13],
    // Outlier 31 pendant on A periphery
    [31, 5],
    // Outlier 30 pendant on outlier 31 (chains 30 into the main component
    // while keeping it labelled as an outlier in the ground truth).
    [30, 31],
  ];

  // Sanity check.
  if (EDGES.length !== 52) {
    console.warn(`[comdet fixture] expected 52 edges, got ${EDGES.length}`);
  }

  COMDET.FIXTURE = {
    nodes: NODES,
    edges: EDGES,
    gt: GT,
    positions: POSITIONS,
  };

  // Variants placeholder (Phase 4c-bis stress_cc / low_modularity / scale_free
  // toggles). Default fixture is the only variant shipped today; add others as
  // separate const blocks when their per-page toggles land.
  COMDET.FIXTURE_VARIANTS = {
    default: COMDET.FIXTURE,
  };
})();
