(function () {
  "use strict";
  if (!window.COMDET || !COMDET.SBM || !COMDET.SBM.mountWalkerPage) return;
  COMDET.SBM.mountWalkerPage({
    gen: "sbm-flat-dc",
    blockOpts: { mode: "dc" },
  });
})();
