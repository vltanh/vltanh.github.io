(function () {
  "use strict";
  if (!window.COMDET || !COMDET.SBM || !COMDET.SBM.mountComparePage) return;
  const V = COMDET.SBM.VARIANTS;
  COMDET.SBM.mountComparePage({
    gen: "sbm-flat-best",
    variants: [V.dc, V.ndc, V.pp],
  });
})();
