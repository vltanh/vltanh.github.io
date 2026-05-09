/* SBM MT19937. Matsumoto-Nishimura 32-bit Mersenne Twister, ported
 * verbatim from comdet/js/louvain/louvain.js's MT19937 (same algorithm,
 * SBM-namespaced for self-containment per repo convention).
 *
 * The cpp tracer at community-detection/tools/viz_check/sbm/instrumented/
 * flat_traced.cpp uses std::mt19937 which seeds with the same Knuth
 * recurrence (1812433253) and produces byte-equal 32-bit raw outputs
 * under matching seed. SBM.MT19937 is the JS-side bit-equal twin.
 *
 * int(lo, hi): rejection-sample on [lo, hi]. Mirrors the cpp tracer's
 * JSRng::intRange (flat_traced.cpp:49-56): range = hi-lo+1, limit =
 * floor(2^32/range)*range, draw raw() until r < limit, return lo +
 * (r % range). Used by mcmcSweep for proposal pick + by SBM.UTIL.shuffle
 * for backward Fisher-Yates.
 */
(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};
  if (!window.COMDET.SBM) window.COMDET.SBM = {};

  function MT19937(seed) {
    const N = 624;
    const mt = new Uint32Array(N);
    let mti = N + 1;
    function init(s) {
      mt[0] = s >>> 0;
      for (let i = 1; i < N; i++) {
        const t = (mt[i - 1] ^ (mt[i - 1] >>> 30)) >>> 0;
        const lo = (t & 0xffff), hi = (t >>> 16);
        const m = (1812433253 * lo + (((1812433253 * hi) & 0xffff) << 16)) >>> 0;
        mt[i] = (m + i) >>> 0;
      }
      mti = N;
    }
    function next() {
      if (mti >= N) {
        for (let i = 0; i < N; i++) {
          const y = ((mt[i] & 0x80000000) | (mt[(i + 1) % N] & 0x7fffffff)) >>> 0;
          let v = (mt[(i + 397) % N] ^ (y >>> 1)) >>> 0;
          if (y & 1) v = (v ^ 0x9908b0df) >>> 0;
          mt[i] = v;
        }
        mti = 0;
      }
      let y = mt[mti++];
      y = (y ^ (y >>> 11)) >>> 0;
      y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
      y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
      y = (y ^ (y >>> 18)) >>> 0;
      return y;
    }
    init(seed >>> 0);
    return {
      // Snapshot mt + mti, draw k raw uint32 outputs, restore. Mirrors
      // the cpp tracer's std::mt19937 peek used at boundary diagnostics.
      peek: function (k) {
        const mtSave = new Uint32Array(mt);
        const mtiSave = mti;
        const out = new Array(k);
        for (let i = 0; i < k; i++) out[i] = next() >>> 0;
        for (let i = 0; i < N; i++) mt[i] = mtSave[i];
        mti = mtiSave;
        return out;
      },
      int: function (lo, hi) {
        const range = hi - lo + 1;
        if (range <= 0) return lo;
        const limit = Math.floor(0x100000000 / range) * range;
        let r;
        do { r = next(); } while (r >= limit);
        return lo + (r % range);
      },
      seed: function (s) { init(s >>> 0); },
      raw: next,
    };
  }

  window.COMDET.SBM.MT19937 = MT19937;
})();
