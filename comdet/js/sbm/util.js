/* SBM math helpers ported from graph-tool's
 * src/graph/inference/support/util.hh (lgamma, lbinom, xlogx, safelog).
 */
(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};
  const NS = window.COMDET;

  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function lbinom(N, k) {
    if (k < 0 || k > N) return -Infinity;
    if (k === 0 || k === N) return 0;
    return lgamma(N + 1) - lgamma(k + 1) - lgamma(N - k + 1);
  }

  function logChooseRep(n, k) {
    if (n <= 0) return k === 0 ? 0 : -Infinity;
    return lbinom(n + k - 1, k);
  }

  function xlogx(x)  { return x > 0 ? x * Math.log(x) : 0; }
  function safelog(x) { return x > 0 ? Math.log(x) : 0; }

  NS.SBM = NS.SBM || {};
  NS.SBM.UTIL = {
    lgamma: lgamma, lbinom: lbinom, logChooseRep: logChooseRep,
    xlogx: xlogx, safelog: safelog,
  };
})();
