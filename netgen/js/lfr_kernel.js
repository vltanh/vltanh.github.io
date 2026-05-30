// LFR kernel: browser-loadable JS port of the FULL LFR unweighted_undirected
// pipeline (externals/lfr/unweighted_undirected/Sources/benchm.cpp).
//
// BYTE-EQUAL to the canonical binary under matching seed. Verified against
// tools/viz_check/lfr/fork/tracer_swapped (the instrumented canonical fork)
// across the 3-tier empirical panel + synthetic fixtures (0 mismatches).
//
//   RNG    : ported ran2 (Numerical Recipes L'Ecuyer combined two-LCG +
//            Bays-Durham 32-entry shuffle). NOT d3.randomLcg, NOT MT, NO
//            Gaussian/Box-Muller anywhere -- the binary draws only ran4().
//            The kernel threads ONE ran2 stream (seeded once, like the
//            binary's srand_file) through every stage; irand(n) =
//            trunc(ran4()*(n+1)). The page seeds runFullPipeline with an
//            integer `seed`, not a () -> [0,1) closure.
//   FP     : ported fdlibm pow/log/exp (jsPow/jsLog/jsExp), bit-identical to
//            the canonical tracer's TRACER_MODE math ports; sqrt = Math.sqrt.
//            Node's Math.pow is correctly-rounded and differs from glibc by
//            <=1 ulp on rare inputs, so the shared fdlibm port is mandatory.
//   Params : parsed through cast_string_to_double (digit-by-digit reparse via
//            pow(10,e)) to match the binary's last-ulp re-parse of CLI args.
//
// The page walker contract is preserved: runFullPipeline({..., traceTest:true})
// still emits perCluster[].{phase2Ops, phase3Ops, phase2FinalEn, nodes},
// mateOps / mateInitialEn / mateFinalEn, exactly as the lfr.html step walkers
// consume them.
//
// Conditional debug hooks fire iff globalThis.__LFR_HOOK / __LFR_PROBE /
// __LFR_HOOK_RAN4 / __LFR_HOOK_IRAND is a function; the kernel runs identically
// with no hook installed (the visualizer import path).
//
// Exposed as window.LFRKernel.
(function () {
  "use strict";

  // ===========================================================================
  // fdlibm ports: jsLog / jsExp / jsPow (bit-identical to fork/js_math_ports.h)
  // ===========================================================================
  const _f64 = new Float64Array(1);
  const _u32 = new Uint32Array(_f64.buffer); // little-endian: [0]=LO, [1]=HI
  function HI(x) { _f64[0] = x; return _u32[1]; }
  function LO(x) { _f64[0] = x; return _u32[0]; }
  function withHi(x, hi) { _f64[0] = x; _u32[1] = hi >>> 0; return _f64[0]; }
  function withLo(x, lo) { _f64[0] = x; _u32[0] = lo >>> 0; return _f64[0]; }
  function HIi(x) { _f64[0] = x; return _u32[1] | 0; }

  function jsLog(x) {
    const ln2_hi = 6.93147180369123816490e-01;
    const ln2_lo = 1.90821492927058770002e-10;
    const two54 = 1.80143985094819840000e+16;
    const Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01;
    const Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01;
    const Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01;
    const Lg7 = 1.479819860511658591e-01, zero = 0.0;
    let hfsq, f, s, z, R, w, t1, t2, dk, k, hx, i, j, lx;
    hx = HIi(x); lx = LO(x); k = 0;
    if (hx < 0x00100000) {
      if (((hx & 0x7fffffff) | lx) === 0) return -two54 / zero;
      if (hx < 0) return (x - x) / zero;
      k -= 54; x *= two54; hx = HIi(x);
    }
    if (hx >= 0x7ff00000) return x + x;
    k += (hx >> 20) - 1023; hx &= 0x000fffff;
    i = (hx + 0x95f64) & 0x100000;
    x = withHi(x, (hx | (i ^ 0x3ff00000)) >>> 0);
    k += (i >> 20); f = x - 1.0;
    if ((0x000fffff & (2 + hx)) < 3) {
      if (f === zero) { if (k === 0) return zero; else { dk = k; return dk * ln2_hi + dk * ln2_lo; } }
      R = f * f * (0.5 - 0.33333333333333333 * f);
      if (k === 0) return f - R; else { dk = k; return dk * ln2_hi - ((R - dk * ln2_lo) - f); }
    }
    s = f / (2.0 + f); dk = k; z = s * s; i = hx - 0x6147a; w = z * z; j = 0x6b851 - hx;
    t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
    t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
    i |= j; R = t2 + t1;
    if (i > 0) {
      hfsq = 0.5 * f * f;
      if (k === 0) return f - (hfsq - s * (hfsq + R));
      else return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
    } else {
      if (k === 0) return f - s * (f - R);
      else return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
    }
  }

  function jsExp(x) {
    const one = 1.0, halF = [0.5, -0.5], huge = 1.0e+300;
    const twom1000 = 9.33263618503218878990e-302;
    const o_threshold = 7.09782712893383973096e+02;
    const u_threshold = -7.45133219101941108420e+02;
    const ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
    const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
    const invln2 = 1.44269504088896338700e+00;
    const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03;
    const P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06;
    const P5 = 4.13813679705723846039e-08;
    let y, hi = 0.0, lo = 0.0, c, t, k = 0, xsb, hx;
    hx = HI(x); xsb = (hx >>> 31) & 1; hx &= 0x7fffffff;
    if (hx >= 0x40862E42) {
      if (hx >= 0x7ff00000) {
        if (((hx & 0xfffff) | LO(x)) !== 0) return x + x;
        else return (xsb === 0) ? x : 0.0;
      }
      if (x > o_threshold) return huge * huge;
      if (x < u_threshold) return twom1000 * twom1000;
    }
    if (hx > 0x3fd62e42) {
      if (hx < 0x3FF0A2B2) { hi = x - ln2HI[xsb]; lo = ln2LO[xsb]; k = 1 - xsb - xsb; }
      else { k = (invln2 * x + halF[xsb]) | 0; t = k; hi = x - t * ln2HI[0]; lo = t * ln2LO[0]; }
      x = hi - lo;
    } else if (hx < 0x3e300000) { if (huge + x > one) return one + x; }
    else k = 0;
    t = x * x;
    c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if (k === 0) return one - ((x * c) / (c - 2.0) - x);
    else y = one - ((lo - (x * c) / (2.0 - c)) - hi);
    if (k >= -1021) { y = withHi(y, (HI(y) + (k << 20)) >>> 0); return y; }
    else { y = withHi(y, (HI(y) + ((k + 1000) << 20)) >>> 0); return y * twom1000; }
  }

  function scalbn(x, n) { return x * Math.pow(2, n); }

  function jsPow(x, y) {
    const bp = [1.0, 1.5], dp_h = [0.0, 5.84962487220764160156e-01];
    const dp_l = [0.0, 1.35003920212974897128e-08];
    const zero = 0.0, one = 1.0, two53 = 9007199254740992.0;
    const huge = 1.0e300, tiny = 1.0e-300;
    const L1 = 5.99999999999994648725e-01, L2 = 4.28571428578550184252e-01;
    const L3 = 3.33333329818377432918e-01, L4 = 2.72728123808534006489e-01;
    const L5 = 2.30660745775561754067e-01, L6 = 2.06975017800338417784e-01;
    const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03;
    const P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06;
    const P5 = 4.13813679705723846039e-08, lg2 = 6.93147180559945286227e-01;
    const lg2_h = 6.93147182464599609375e-01, lg2_l = -1.90465429995776804525e-09;
    const ovt = 8.0085662595372944372e-0017, cp = 9.61796693925975554329e-01;
    const cp_h = 9.61796700954437255859e-01, cp_l = -7.02846165095275826516e-09;
    const ivln2_h = 1.44269502162933349609e+00, ivln2_l = 1.92596299112661746887e-08;
    const ivln2 = 1.44269504088896338700e+00;
    let z, ax, z_h, z_l, p_h, p_l, y1, t1, t2, r, s, t, u, v, w;
    let i, j, k, yisint, n, hx, hy, ix, iy, lx, ly;
    hx = HIi(x); lx = LO(x); hy = HIi(y); ly = LO(y);
    ix = hx & 0x7fffffff; iy = hy & 0x7fffffff;
    if ((iy | ly) === 0) return one;
    if (ix > 0x7ff00000 || ((ix === 0x7ff00000) && (lx !== 0)) ||
        iy > 0x7ff00000 || ((iy === 0x7ff00000) && (ly !== 0))) return x + y;
    yisint = 0;
    if (hx < 0) {
      if (iy >= 0x43400000) yisint = 2;
      else if (iy >= 0x3ff00000) {
        k = (iy >> 20) - 0x3ff;
        if (k > 20) { j = ly >>> (52 - k); if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1); }
        else if (ly === 0) { j = iy >> (20 - k); if ((j << (20 - k)) === iy) yisint = 2 - (j & 1); }
      }
    }
    if (ly === 0) {
      if (iy === 0x7ff00000) {
        if (((ix - 0x3ff00000) | lx) === 0) return y - y;
        else if (ix >= 0x3ff00000) return (hy >= 0) ? y : zero;
        else return (hy < 0) ? -y : zero;
      }
      if (iy === 0x3ff00000) { if (hy < 0) return one / x; else return x; }
      if (hy === 0x40000000) return x * x;
      if (hy === 0x3fe00000) { if (hx >= 0) return Math.sqrt(x); }
    }
    ax = Math.abs(x);
    if (lx === 0) {
      if (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000) {
        z = ax; if (hy < 0) z = one / z;
        if (hx < 0) {
          if (((ix - 0x3ff00000) | yisint) === 0) { z = (z - z) / (z - z); }
          else if (yisint === 1) z = -z;
        }
        return z;
      }
    }
    n = (hx >> 31) + 1;
    if ((n | yisint) === 0) return (x - x) / (x - x);
    s = one;
    if ((n | (yisint - 1)) === 0) s = -one;
    if (iy > 0x41e00000) {
      if (iy > 0x43f00000) {
        if (ix <= 0x3fefffff) return (hy < 0) ? huge * huge : tiny * tiny;
        if (ix >= 0x3ff00000) return (hy > 0) ? huge * huge : tiny * tiny;
      }
      if (ix < 0x3fefffff) return (hy < 0) ? s * huge * huge : s * tiny * tiny;
      if (ix > 0x3ff00000) return (hy > 0) ? s * huge * huge : s * tiny * tiny;
      t = ax - one;
      w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
      u = ivln2_h * t; v = t * ivln2_l - w * ivln2;
      t1 = u + v; t1 = withLo(t1, 0); t2 = v - (t1 - u);
    } else {
      let ss, s2, s_h, s_l, t_h, t_l;
      n = 0;
      if (ix < 0x00100000) { ax *= two53; n -= 53; ix = HIi(ax); }
      n += ((ix) >> 20) - 0x3ff; j = ix & 0x000fffff; ix = j | 0x3ff00000;
      if (j <= 0x3988E) k = 0; else if (j < 0xBB67A) k = 1;
      else { k = 0; n += 1; ix -= 0x00100000; }
      ax = withHi(ax, ix >>> 0);
      u = ax - bp[k]; v = one / (ax + bp[k]); ss = u * v; s_h = ss; s_h = withLo(s_h, 0);
      t_h = zero; t_h = withHi(t_h, ((((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18)) >>> 0));
      t_l = ax - (t_h - bp[k]); s_l = v * ((u - s_h * t_h) - s_h * t_l);
      s2 = ss * ss;
      r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
      r += s_l * (s_h + ss); s2 = s_h * s_h; t_h = 3.0 + s2 + r; t_h = withLo(t_h, 0);
      t_l = r - ((t_h - 3.0) - s2); u = s_h * t_h; v = s_l * t_h + t_l * ss;
      p_h = u + v; p_h = withLo(p_h, 0); p_l = v - (p_h - u);
      z_h = cp_h * p_h; z_l = cp_l * p_h + p_l * cp + dp_l[k]; t = n;
      t1 = (((z_h + z_l) + dp_h[k]) + t); t1 = withLo(t1, 0);
      t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
    }
    y1 = y; y1 = withLo(y1, 0);
    p_l = (y - y1) * t1 + y * t2; p_h = y1 * t1; z = p_l + p_h;
    j = HIi(z); i = LO(z) | 0;
    if (j >= 0x40900000) {
      if (((j - 0x40900000) | i) !== 0) return s * huge * huge;
      else { if (p_l + ovt > z - p_h) return s * huge * huge; }
    } else if ((j & 0x7fffffff) >= 0x4090cc00) {
      if (((j - 0xc090cc00) | i) !== 0) return s * tiny * tiny;
      else { if (p_l <= z - p_h) return s * tiny * tiny; }
    }
    i = j & 0x7fffffff; k = (i >> 20) - 0x3ff; n = 0;
    if (i > 0x3fe00000) {
      n = j + (0x00100000 >> (k + 1)); k = ((n & 0x7fffffff) >> 20) - 0x3ff; t = zero;
      t = withHi(t, (n & ~(0x000fffff >> k)) >>> 0);
      n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
      if (j < 0) n = -n; p_h -= t;
    }
    t = p_l + p_h; t = withLo(t, 0); u = t * lg2_h;
    v = (p_l - (t - p_h)) * lg2 + t * lg2_l; z = u + v; w = v - (z - u);
    t = z * z; t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    r = (z * t1) / (t1 - 2.0) - (w + z * w); z = one - (r - z);
    j = HIi(z); j += (n << 20);
    if ((j >> 20) <= 0) z = scalbn(z, n);
    else z = withHi(z, (HI(z) + (n << 20)) >>> 0);
    return s * z;
  }

  // ===========================================================================
  // cast.cpp: cast_string_to_double (digit-by-digit reparse) + cast_int
  // ===========================================================================
  function castStringToDouble(bIn) {
    let b = String(bIn).split("");
    let h = 0;
    if (b.length === 0) return null;
    let sign = 1;
    if (b[0] === "-") { b[0] = "0"; sign = -1; }
    let digits_before = 0;
    for (let i = 0; i < b.length; i++) { if (b[i] !== ".") digits_before++; else break; }
    let j = 0;
    while (j !== digits_before) {
      const number = b[j].charCodeAt(0) - 48;
      h += number * jsPow(10, digits_before - j - 1);
      if (number < 0 || number > 9) return null;
      j++;
    }
    j = digits_before + 1;
    while (j < b.length) {
      const number = b[j].charCodeAt(0) - 48;
      h += number * jsPow(10, digits_before - j);
      if (number < 0 || number > 9) return null;
      j++;
    }
    return sign * h;
  }
  function castInt(u) { let a = Math.trunc(u); if (u - a > 0.5) a++; return a; }

  // ===========================================================================
  // std container ports: OrderedIntSet (std::set<int>), IntMultimap
  // ===========================================================================
  class OrderedIntSet {
    constructor() { this.a = []; }
    _lb(x) { let lo = 0, hi = this.a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.a[m] < x) lo = m + 1; else hi = m; } return lo; }
    has(x) { const i = this._lb(x); return i < this.a.length && this.a[i] === x; }
    find(x) { return this.has(x); }
    insert(x) { const i = this._lb(x); if (i < this.a.length && this.a[i] === x) return { inserted: false }; this.a.splice(i, 0, x); return { inserted: true }; }
    erase(x) { const i = this._lb(x); if (i < this.a.length && this.a[i] === x) { this.a.splice(i, 1); return 1; } return 0; }
    get size() { return this.a.length; }
    values() { return this.a; }
    forEach(fn) { for (let i = 0; i < this.a.length; i++) fn(this.a[i]); }
    [Symbol.iterator]() { return this.a[Symbol.iterator](); }
  }
  class IntMultimap {
    constructor() { this.a = []; }
    _upperBoundKey(k) { let lo = 0, hi = this.a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.a[m][0] <= k) lo = m + 1; else hi = m; } return lo; }
    insert(k, v) { const i = this._upperBoundKey(k); this.a.splice(i, 0, [k, v]); return i; }
    insertHintEnd(k, v) { return this.insert(k, v); }
    get size() { return this.a.length; }
    entries() { return this.a; }
    eraseElem(elem) { const i = this.a.indexOf(elem); if (i >= 0) this.a.splice(i, 1); return i; }
  }

  // ===========================================================================
  // ran2 (Numerical Recipes) + ran4/irand facade
  // ===========================================================================
  const R2_IM1 = 2147483563, R2_IM2 = 2147483399, R2_AM = 1.0 / R2_IM1;
  const R2_IMM1 = R2_IM1 - 1, R2_IA1 = 40014, R2_IA2 = 40692;
  const R2_IQ1 = 53668, R2_IQ2 = 52774, R2_IR1 = 12211, R2_IR2 = 3791;
  const R2_NTAB = 32, R2_NDIV = 1 + Math.floor(R2_IMM1 / R2_NTAB);
  const R2_EPS = 1.2e-7, R2_RNMX = 1.0 - R2_EPS;

  class Ran2 {
    constructor() {
      this.idum2 = 123456789; this.iy = 0; this.iv = new Array(R2_NTAB).fill(0);
      this.seed_ = 1; this._draws = 0;
    }
    srand5(rank) { this.seed_ = rank | 0; }
    srandFile(seed) { if (seed < 1 || seed > R2_IM2) seed = 1; this.srand5(seed); }
    ran2() {
      let idum = this.seed_, j, k, temp;
      if (idum <= 0 || !this.iy) {
        if (-idum < 1) idum = 1 * idum; else idum = -idum;
        this.idum2 = idum;
        for (j = R2_NTAB + 7; j >= 0; j--) {
          k = Math.trunc(idum / R2_IQ1);
          idum = R2_IA1 * (idum - k * R2_IQ1) - k * R2_IR1;
          if (idum < 0) idum += R2_IM1;
          if (j < R2_NTAB) this.iv[j] = idum;
        }
        this.iy = this.iv[0];
      }
      k = Math.trunc(idum / R2_IQ1);
      idum = R2_IA1 * (idum - k * R2_IQ1) - k * R2_IR1;
      if (idum < 0) idum += R2_IM1;
      k = Math.trunc(this.idum2 / R2_IQ2);
      this.idum2 = R2_IA2 * (this.idum2 - k * R2_IQ2) - k * R2_IR2;
      if (this.idum2 < 0) this.idum2 += R2_IM2;
      j = Math.trunc(this.iy / R2_NDIV);
      this.iy = this.iv[j] - this.idum2;
      this.iv[j] = idum;
      if (this.iy < 1) this.iy += R2_IMM1;
      this.seed_ = idum;
      if ((temp = R2_AM * this.iy) > R2_RNMX) return R2_RNMX;
      else return temp;
    }
    ran4() {
      const r = this.ran2(); this._draws++;
      if (typeof globalThis.__LFR_HOOK_RAN4 === "function") globalThis.__LFR_HOOK_RAN4(r, this._draws);
      return r;
    }
    irand(n) {
      const u = this.ran4(); const v = Math.trunc(u * (n + 1));
      if (typeof globalThis.__LFR_HOOK_IRAND === "function") globalThis.__LFR_HOOK_IRAND(n, u, v, this._draws);
      return v;
    }
  }

  // RNG facade: real ran2, or an oracle-injected ran4() stream (L3 replay).
  class Rng {
    constructor(seed, oracle) {
      this.oracle = oracle || null; this.oi = 0;
      this.r = new Ran2();
      if (!this.oracle) this.r.srandFile(seed);
    }
    ran4() { if (this.oracle) return this.oracle[this.oi++]; return this.r.ran4(); }
    irand(n) {
      if (this.oracle) { const u = this.ran4(); return Math.trunc(u * (n + 1)); }
      return this.r.irand(n);
    }
    get draws() { return this.r._draws; }
  }

  function probe(tag, fields) {
    if (typeof globalThis.__LFR_PROBE === "function") globalThis.__LFR_PROBE(tag, fields);
  }

  // ===========================================================================
  // helpers
  // ===========================================================================
  function lowerBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < target) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function lowerBoundRange(arr, lo, hi, val) {
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < val) lo = m + 1; else hi = m; }
    return lo;
  }
  function deqIntSum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
  function maxElementIdx(a) { let mi = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[mi]) mi = i; return mi; }
  function minElementIdx(a) { let mi = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[mi]) mi = i; return mi; }

  // ===========================================================================
  // benchm.cpp: integral / average_degree / solve_dmin / integer_average
  // ===========================================================================
  function integral(a, b) {
    if (Math.abs(a + 1.0) > 1e-10) return (1.0 / (a + 1.0) * jsPow(b, a + 1.0));
    return jsLog(b);
  }
  function averageDegree(dmax, dmin, gamma) {
    return (1.0 / (integral(gamma, dmax) - integral(gamma, dmin))) *
           (integral(gamma + 1, dmax) - integral(gamma + 1, dmin));
  }
  function solveDmin(dmax, dmed, gamma) {
    let dmin_l = 1, dmin_r = dmax;
    let average_k1 = averageDegree(dmin_r, dmin_l, gamma);
    let average_k2 = dmin_r;
    if ((average_k1 - dmed > 0) || (average_k2 - dmed < 0)) return -1;
    while (Math.abs(average_k1 - dmed) > 1e-7) {
      const temp = averageDegree(dmax, ((dmin_r + dmin_l) / 2.0), gamma);
      if ((temp - dmed) * (average_k2 - dmed) > 0) { average_k2 = temp; dmin_r = ((dmin_r + dmin_l) / 2.0); }
      else { average_k1 = temp; dmin_l = ((dmin_r + dmin_l) / 2.0); }
    }
    return dmin_l;
  }
  function integerAverage(n, min, tau) {
    let a = 0;
    for (let h = min; h < n + 1; h++) a += jsPow((1.0 / h), tau);
    let pf = 0;
    for (let i = min; i < n + 1; i++) pf += 1 / a * jsPow((1.0 / i), tau) * i;
    return pf;
  }
  // combinatorics.cpp powerlaw cumulative
  function powerlawCum(n, min, tau) {
    const cum = []; let a = 0;
    for (let h = min; h < n + 1; h++) a += jsPow((1.0 / h), tau);
    let pf = 0;
    for (let i = min; i < n + 1; i++) { pf += 1 / a * jsPow((1.0 / i), tau); cum.push(pf); }
    return cum;
  }
  // Back-compat alias (page profiling cells use powerlawCumulative).
  function powerlawCumulative(n, min, tau) { return powerlawCum(n, min, tau); }

  // change_community_size(seq): merge two smallest communities.
  function changeCommunitySize(seq) {
    if (seq.length <= 2) return -1;
    let min1 = 0, min2 = 0;
    for (let i = 0; i < seq.length; i++) if (seq[i] <= seq[min1]) min1 = i;
    if (min1 === 0) min2 = 1;
    for (let i = 0; i < seq.length; i++) if (seq[i] <= seq[min2] && seq[i] > seq[min1]) min2 = i;
    seq[min1] += seq[min2];
    const c = seq[0]; seq[0] = seq[min2]; seq[min2] = c;
    seq.shift();
    return 0;
  }

  // they_are_mate(a,b,member_list): binary_search member_list[b] for any of a's.
  function theyAreMate(a, b, member_list) {
    const ma = member_list[a], mb = member_list[b];
    if (!ma || !mb) return false;
    for (let i = 0; i < ma.length; i++) {
      let lo = 0, hi = mb.length, target = ma[i];
      while (lo < hi) { const m = (lo + hi) >> 1; if (mb[m] < target) lo = m + 1; else hi = m; }
      if (lo < mb.length && mb[lo] === target) return true;
    }
    return false;
  }

  // ===========================================================================
  // build_bipartite_network -- benchm.cpp:208
  // ===========================================================================
  function buildBipartiteNetwork(member_matrix, member_numbers, num_seq, rng) {
    const en_in = [];
    for (let i = 0; i < member_numbers.length; i++) en_in.push(new OrderedIntSet());
    const en_out = [];
    for (let i = 0; i < num_seq.length; i++) en_out.push(new OrderedIntSet());

    const degree_node_out = new IntMultimap();
    for (let i = 0; i < num_seq.length; i++) degree_node_out.insert(num_seq[i], i);
    const degree_node_in = [];
    for (let i = 0; i < member_numbers.length; i++) degree_node_in.push([member_numbers[i], i]);
    degree_node_in.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));

    let itlastIdx = degree_node_in.length;
    while (itlastIdx !== 0) {
      itlastIdx--;
      const itlast = degree_node_in[itlastIdx];
      const dn = degree_node_out.a;
      let ititIdx = dn.length;
      const erasenda = [];
      for (let i = 0; i < itlast[0]; i++) {
        if (ititIdx !== 0) {
          ititIdx--;
          const itit = dn[ititIdx];
          en_in[itlast[1]].insert(itit[1]);
          en_out[itit[1]].insert(itlast[1]);
          erasenda.push(itit);
        } else { return -1; }
      }
      for (let i = 0; i < erasenda.length; i++) {
        if (erasenda[i][0] > 1) degree_node_out.insert(erasenda[i][0] - 1, erasenda[i][1]);
        degree_node_out.eraseElem(erasenda[i]);
      }
    }

    const degree_list = [];
    for (let kk = 0; kk < member_numbers.length; kk++)
      for (let k2 = 0; k2 < member_numbers[kk]; k2++) degree_list.push(kk);

    for (let run = 0; run < 10; run++)
      for (let node_a = 0; node_a < num_seq.length; node_a++)
        for (let krm = 0; krm < en_out[node_a].size; krm++) {
          const random_mate = degree_list[rng.irand(degree_list.length - 1)];
          if (!en_out[node_a].has(random_mate)) {
            const external_nodes = en_out[node_a].values().slice();
            const old_node = external_nodes[rng.irand(external_nodes.length - 1)];
            const not_common = [];
            for (const e of en_in[random_mate].values())
              if (!en_in[old_node].has(e)) not_common.push(e);
            if (not_common.length === 0) break;
            const node_h = not_common[rng.irand(not_common.length - 1)];
            en_out[node_a].insert(random_mate); en_out[node_a].erase(old_node);
            en_in[old_node].insert(node_h); en_in[old_node].erase(node_a);
            en_in[random_mate].insert(node_a); en_in[random_mate].erase(node_h);
            en_out[node_h].erase(random_mate); en_out[node_h].insert(old_node);
          }
        }

    member_matrix.length = 0;
    for (let i = 0; i < en_out.length; i++) member_matrix.push(en_out[i].values().slice());
    return 0;
  }

  // ===========================================================================
  // internal_degree_and_membership -- benchm.cpp:382
  // ===========================================================================
  function internalDegreeAndMembership(mixing_parameter, overlapping_nodes, max_mem_num,
    num_nodes, member_matrix, excess, defect, degree_seq, num_seq, internal_degree_seq,
    fixed_range, nmin, nmax, tau2, rng) {

    if (num_nodes < overlapping_nodes) return -1;
    member_matrix.length = 0; internal_degree_seq.length = 0;
    let max_degree_actual = 0;
    for (let i = 0; i < degree_seq.length; i++) {
      const interno = (1 - mixing_parameter) * degree_seq[i];
      let int_interno = Math.trunc(interno);
      if (rng.ran4() < (interno - int_interno)) int_interno++;
      if (excess) while ((int_interno / degree_seq[i] < (1 - mixing_parameter)) && (int_interno < degree_seq[i])) int_interno++;
      if (defect) while ((int_interno / degree_seq[i] > (1 - mixing_parameter)) && (int_interno > 0)) int_interno--;
      internal_degree_seq.push(int_interno);
      if (int_interno > max_degree_actual) max_degree_actual = int_interno;
    }

    const cumulative = powerlawCum(nmax, nmin, tau2);

    if (num_seq.length === 0) {
      let _num_ = 0;
      if (!fixed_range && (max_degree_actual + 1) > nmin) { _num_ = max_degree_actual + 1; num_seq.push(max_degree_actual + 1); }
      while (true) {
        const u = rng.ran4();
        const nn = lowerBound(cumulative, u) + nmin;
        if (nn + _num_ <= num_nodes + overlapping_nodes * (max_mem_num - 1)) { num_seq.push(nn); _num_ += nn; }
        else break;
      }
      const mi = minElementIdx(num_seq);
      num_seq[mi] += num_nodes + overlapping_nodes * (max_mem_num - 1) - _num_;
    }

    const member_numbers = [];
    for (let i = 0; i < overlapping_nodes; i++) member_numbers.push(max_mem_num);
    for (let i = overlapping_nodes; i < degree_seq.length; i++) member_numbers.push(1);

    if (buildBipartiteNetwork(member_matrix, member_numbers, num_seq, rng) === -1) return -1;

    const available = new Array(num_nodes).fill(0);
    for (let i = 0; i < member_matrix.length; i++)
      for (let j = 0; j < member_matrix[i].length; j++)
        available[member_matrix[i][j]] += member_matrix[i].length - 1;

    const available_nodes = [];
    for (let i = 0; i < num_nodes; i++) available_nodes.push(i);
    const map_nodes = new Array(num_nodes).fill(0);

    for (let i = degree_seq.length - 1; i >= 0; i--) {
      let try_this = rng.irand(available_nodes.length - 1);
      let kr = 0;
      while (internal_degree_seq[i] > available[available_nodes[try_this]]) {
        kr++;
        try_this = rng.irand(available_nodes.length - 1);
        if (kr === 3 * num_nodes) {
          if (changeCommunitySize(num_seq) === -1) return -1;
          return internalDegreeAndMembership(mixing_parameter, overlapping_nodes, max_mem_num,
            num_nodes, member_matrix, excess, defect, degree_seq, num_seq, internal_degree_seq,
            fixed_range, nmin, nmax, tau2, rng);
        }
      }
      map_nodes[available_nodes[try_this]] = i;
      available_nodes[try_this] = available_nodes[available_nodes.length - 1];
      available_nodes.pop();
    }

    for (let i = 0; i < member_matrix.length; i++)
      for (let j = 0; j < member_matrix[i].length; j++)
        member_matrix[i][j] = map_nodes[member_matrix[i][j]];
    for (let i = 0; i < member_matrix.length; i++) member_matrix[i].sort((a, b) => a - b);
    return 0;
  }

  // compute_internal_degree_per_node(d, m)
  function computeInternalDegreePerNode(d, m) {
    if (m <= 0) return [];
    const a = []; const d_i = Math.trunc(d / m);
    for (let i = 0; i < m; i++) a.push(d_i);
    for (let i = 0; i < d % m; i++) a[i]++;
    return a;
  }

  // ===========================================================================
  // build_subgraph -- benchm.cpp:719  (with phase2Ops / phase3Ops walker trace)
  // ===========================================================================
  function buildSubgraph(E, nodes, degrees, rng, trace) {
    if (degrees.length < 3) return -1;
    const en = [];
    for (let i = 0; i < nodes.length; i++) en.push(new OrderedIntSet());
    const phase2Ops = trace ? [] : null;
    const phase3Ops = trace ? [] : null;

    // phase 1: deterministic multimap seed
    const degree_node = new IntMultimap();
    for (let i = 0; i < degrees.length; i++) degree_node.insertHintEnd(degrees[i], i);
    while (degree_node.size > 0) {
      const dn = degree_node.a;
      let itlastIdx = dn.length - 1;
      const itlast = dn[itlastIdx];
      let ititIdx = itlastIdx;
      const erasenda = []; let inserted = 0;
      for (let i = 0; i < itlast[0]; i++) {
        if (ititIdx !== 0) {
          ititIdx--;
          const itit = dn[ititIdx];
          en[itlast[1]].insert(itit[1]); en[itit[1]].insert(itlast[1]);
          inserted++; erasenda.push(itit);
        } else break;
      }
      for (let i = 0; i < erasenda.length; i++) {
        if (erasenda[i][0] > 1) degree_node.insert(erasenda[i][0] - 1, erasenda[i][1]);
        degree_node.eraseElem(erasenda[i]);
      }
      degree_node.eraseElem(itlast);
    }

    // phase 2: 10 randomization passes
    const degree_list = [];
    for (let kk = 0; kk < degrees.length; kk++)
      for (let k2 = 0; k2 < degrees[kk]; k2++) degree_list.push(kk);

    for (let run = 0; run < 10; run++)
      for (let node_a = 0; node_a < degrees.length; node_a++)
        for (let krm = 0; krm < en[node_a].size; krm++) {
          let random_mate = degree_list[rng.irand(degree_list.length - 1)];
          while (random_mate === node_a) random_mate = degree_list[rng.irand(degree_list.length - 1)];
          if (en[node_a].insert(random_mate).inserted) {
            const out_nodes = [];
            for (const e of en[node_a].values()) if (e !== random_mate) out_nodes.push(e);
            const old_node = out_nodes[rng.irand(out_nodes.length - 1)];
            en[node_a].erase(old_node); en[random_mate].insert(node_a); en[old_node].erase(node_a);
            const not_common = [];
            for (const e of en[random_mate].values()) if ((old_node !== e) && (!en[old_node].has(e))) not_common.push(e);
            const node_h = not_common[rng.irand(not_common.length - 1)];
            en[random_mate].erase(node_h); en[node_h].erase(random_mate);
            en[node_h].insert(old_node); en[old_node].insert(node_h);
            if (phase2Ops) phase2Ops.push({
              run, nodeA: node_a, randomMate: random_mate, oldNode: old_node, nodeH: node_h,
              cuts: [
                [Math.min(nodes[node_a], nodes[old_node]), Math.max(nodes[node_a], nodes[old_node])],
                [Math.min(nodes[random_mate], nodes[node_h]), Math.max(nodes[random_mate], nodes[node_h])],
              ],
              places: [
                [Math.min(nodes[node_a], nodes[random_mate]), Math.max(nodes[node_a], nodes[random_mate])],
                [Math.min(nodes[old_node], nodes[node_h]), Math.max(nodes[old_node], nodes[node_h])],
              ],
            });
          }
        }

    let phase2FinalEn = null;
    if (trace) {
      phase2FinalEn = [];
      for (let i = 0; i < nodes.length; i++)
        for (const j of en[i].values()) if (i < j) phase2FinalEn.push([nodes[i], nodes[j]]);
    }

    // phase 3: insert into global E + multi-edge rewire
    const multiple_edge = [];
    for (let i = 0; i < en.length; i++) {
      for (const its of en[i].values()) if (i < its) {
        const already = !(E[nodes[i]].insert(nodes[its]).inserted);
        if (already) multiple_edge.push([nodes[i], nodes[its]]);
        else E[nodes[its]].insert(nodes[i]);
      }
    }
    let multipleResolved = 0, multipleDropped = 0;
    for (let i = 0; i < multiple_edge.length; i++) {
      const a = multiple_edge[i][0], b = multiple_edge[i][1];
      let stopper_ml = 0;
      while (true) {
        stopper_ml++;
        let random_mate = nodes[degree_list[rng.irand(degree_list.length - 1)]];
        while (random_mate === a || random_mate === b) random_mate = nodes[degree_list[rng.irand(degree_list.length - 1)]];
        if (!E[a].has(random_mate)) {
          const not_common = [];
          for (const e of E[random_mate].values()) {
            let lo = 0, hi = nodes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nodes[m] < e) lo = m + 1; else hi = m; }
            const inNodes = lo < nodes.length && nodes[lo] === e;
            if ((b !== e) && (!E[b].has(e)) && inNodes) not_common.push(e);
          }
          if (not_common.length > 0) {
            const node_h = not_common[rng.irand(not_common.length - 1)];
            E[random_mate].insert(a); E[random_mate].erase(node_h);
            E[node_h].erase(random_mate); E[node_h].insert(b);
            E[b].insert(node_h); E[a].insert(random_mate);
            if (phase3Ops) phase3Ops.push({
              dupEdge: [Math.min(a, b), Math.max(a, b)],
              cuts: [[Math.min(random_mate, node_h), Math.max(random_mate, node_h)]],
              places: [[Math.min(a, random_mate), Math.max(a, random_mate)], [Math.min(b, node_h), Math.max(b, node_h)]],
              success: true,
            });
            multipleResolved++;
            break;
          }
        }
        if (stopper_ml === 2 * E.length) {
          if (phase3Ops) phase3Ops.push({ dupEdge: [Math.min(a, b), Math.max(a, b)], cuts: [], places: [], success: false, reason: "stopper-exhausted" });
          multipleDropped++;
          break;
        }
      }
    }
    return { ok: 0, phase2Ops, phase2FinalEn, phase3Ops, multipleResolved, multipleDropped };
  }

  // ===========================================================================
  // build_subgraphs -- benchm.cpp:954
  // ===========================================================================
  function buildSubgraphsPipeline(E, member_matrix, member_list, link_list, internal_degree_seq, degree_seq, excess, defect, rng, trace) {
    E.length = 0; member_list.length = 0; link_list.length = 0;
    const num_nodes = degree_seq.length;
    for (let i = 0; i < num_nodes; i++) member_list.push([]);
    for (let i = 0; i < member_matrix.length; i++)
      for (let j = 0; j < member_matrix[i].length; j++)
        member_list[member_matrix[i][j]].push(i);

    for (let i = 0; i < member_list.length; i++) {
      let liin = [];
      for (let j = 0; j < member_list[i].length; j++) {
        liin = computeInternalDegreePerNode(internal_degree_seq[i], member_list[i].length);
        liin.push(degree_seq[i] - internal_degree_seq[i]);
      }
      link_list.push(liin);
    }

    for (let i = 0; i < member_matrix.length; i++) {
      let internal_cluster = 0;
      for (let j = 0; j < member_matrix[i].length; j++) {
        const ml = member_list[member_matrix[i][j]];
        const right_index = lowerBoundRange(ml, 0, ml.length, i);
        internal_cluster += link_list[member_matrix[i][j]][right_index];
      }
      if (internal_cluster % 2 !== 0) {
        let default_flag = false;
        if (excess) default_flag = true;
        else if (defect) default_flag = false;
        else if (rng.ran4() > 0.5) default_flag = true;
        if (default_flag) {
          for (let j = 0; j < member_matrix[i].length; j++) {
            const random_mate = member_matrix[i][rng.irand(member_matrix[i].length - 1)];
            const ml = member_list[random_mate];
            const right_index = lowerBoundRange(ml, 0, ml.length, i);
            if ((link_list[random_mate][right_index] < member_matrix[i].length - 1) &&
                (link_list[random_mate][link_list[random_mate].length - 1] > 0)) {
              link_list[random_mate][right_index]++;
              link_list[random_mate][link_list[random_mate].length - 1]--;
              break;
            }
          }
        } else {
          for (let j = 0; j < member_matrix[i].length; j++) {
            const random_mate = member_matrix[i][rng.irand(member_matrix[i].length - 1)];
            const ml = member_list[random_mate];
            const right_index = lowerBoundRange(ml, 0, ml.length, i);
            if (link_list[random_mate][right_index] > 0) {
              link_list[random_mate][right_index]--;
              link_list[random_mate][link_list[random_mate].length - 1]++;
              break;
            }
          }
        }
      }
    }

    for (let i = 0; i < num_nodes; i++) E.push(new OrderedIntSet());

    const perCluster = [];
    for (let i = 0; i < member_matrix.length; i++) {
      const internal_degree_i = [];
      for (let j = 0; j < member_matrix[i].length; j++) {
        const ml = member_list[member_matrix[i][j]];
        const right_index = lowerBoundRange(ml, 0, ml.length, i);
        internal_degree_i.push(link_list[member_matrix[i][j]][right_index]);
      }
      const sub = buildSubgraph(E, member_matrix[i], internal_degree_i, rng, trace);
      if (sub === -1) return -1;
      if (trace) perCluster.push({
        cluster: i, nodes: member_matrix[i].slice(),
        multipleResolved: sub.multipleResolved, multipleDropped: sub.multipleDropped,
        phase2Ops: sub.phase2Ops, phase2FinalEn: sub.phase2FinalEn, phase3Ops: sub.phase3Ops,
      });
    }
    return { perCluster };
  }

  // ===========================================================================
  // connect_all_the_parts -- benchm.cpp:1144  (with mateOps walker trace)
  // ===========================================================================
  function connectAllThePartsPipeline(E, member_list, link_list, rng, trace) {
    const degrees = [];
    for (let i = 0; i < link_list.length; i++) degrees.push(link_list[i][link_list[i].length - 1]);
    const mateOps = trace ? [] : null;

    const en = [];
    for (let i = 0; i < member_list.length; i++) en.push(new OrderedIntSet());

    const degree_node = new IntMultimap();
    for (let i = 0; i < degrees.length; i++) degree_node.insertHintEnd(degrees[i], i);
    while (degree_node.size > 0) {
      const dn = degree_node.a;
      let itlastIdx = dn.length - 1;
      const itlast = dn[itlastIdx];
      let ititIdx = itlastIdx;
      const erasenda = []; let inserted = 0;
      for (let i = 0; i < itlast[0]; i++) {
        if (ititIdx !== 0) {
          ititIdx--;
          const itit = dn[ititIdx];
          en[itlast[1]].insert(itit[1]); en[itit[1]].insert(itlast[1]);
          inserted++; erasenda.push(itit);
        } else break;
      }
      for (let i = 0; i < erasenda.length; i++) {
        if (erasenda[i][0] > 1) degree_node.insert(erasenda[i][0] - 1, erasenda[i][1]);
        degree_node.eraseElem(erasenda[i]);
      }
      degree_node.eraseElem(itlast);
    }

    const degree_list = [];
    for (let kk = 0; kk < degrees.length; kk++)
      for (let k2 = 0; k2 < degrees[kk]; k2++) degree_list.push(kk);

    for (let run = 0; run < 10; run++)
      for (let node_a = 0; node_a < degrees.length; node_a++)
        for (let krm = 0; krm < en[node_a].size; krm++) {
          let random_mate = degree_list[rng.irand(degree_list.length - 1)];
          while (random_mate === node_a) random_mate = degree_list[rng.irand(degree_list.length - 1)];
          if (en[node_a].insert(random_mate).inserted) {
            const out_nodes = [];
            for (const e of en[node_a].values()) if (e !== random_mate) out_nodes.push(e);
            const old_node = out_nodes[rng.irand(out_nodes.length - 1)];
            en[node_a].erase(old_node); en[random_mate].insert(node_a); en[old_node].erase(node_a);
            const not_common = [];
            for (const e of en[random_mate].values()) if ((old_node !== e) && (!en[old_node].has(e))) not_common.push(e);
            const node_h = not_common[rng.irand(not_common.length - 1)];
            en[random_mate].erase(node_h); en[node_h].erase(random_mate);
            en[node_h].insert(old_node); en[old_node].insert(node_h);
          }
        }

    let initialEn = null;
    if (trace) {
      initialEn = [];
      for (let i = 0; i < degrees.length; i++)
        for (const j of en[i].values()) if (i < j) initialEn.push([i, j]);
    }

    // mate-rewiring
    let var_mate = 0;
    for (let i = 0; i < degrees.length; i++)
      for (const itss of en[i].values()) if (theyAreMate(i, itss, member_list)) var_mate++;
    probe("CONNECT-EN", { en: en.map((s) => s.values().slice()) });

    let stopper_mate = 0;
    const mate_trooper = 10;
    while (var_mate > 0) {
      const best_var_mate = var_mate;
      // benchm.cpp:1377 trailing `break` exits ONLY for(its); for(a) continues
      // to a+1 (does NOT restart from a=0). Process one mate-pair per a.
      for (let a = 0; a < degrees.length; a++) {
        const itsArr = en[a].values();
        for (let ii = 0; ii < itsArr.length; ii++) {
          const its = itsArr[ii];
          if (theyAreMate(a, its, member_list)) {
            const b = its;
            let stopper_m = 0;
            while (true) {
              stopper_m++;
              let random_mate = degree_list[rng.irand(degree_list.length - 1)];
              while (random_mate === a || random_mate === b) random_mate = degree_list[rng.irand(degree_list.length - 1)];
              if (!(theyAreMate(a, random_mate, member_list)) && (!en[a].has(random_mate))) {
                const not_common = [];
                for (const e of en[random_mate].values()) if ((b !== e) && (!en[b].has(e))) not_common.push(e);
                if (not_common.length > 0) {
                  const node_h = not_common[rng.irand(not_common.length - 1)];
                  en[random_mate].erase(node_h); en[random_mate].insert(a);
                  en[node_h].erase(random_mate); en[node_h].insert(b);
                  en[b].erase(a); en[b].insert(node_h);
                  en[a].insert(random_mate); en[a].erase(b);
                  if (mateOps) mateOps.push({
                    a, b, randomMate: random_mate, nodeH: node_h,
                    cuts: [[Math.min(a, b), Math.max(a, b)], [Math.min(random_mate, node_h), Math.max(random_mate, node_h)]],
                    places: [[Math.min(a, random_mate), Math.max(a, random_mate)], [Math.min(b, node_h), Math.max(b, node_h)]],
                    varMateBefore: var_mate,
                  });
                  if (!theyAreMate(b, node_h, member_list)) var_mate -= 2;
                  if (theyAreMate(random_mate, node_h, member_list)) var_mate -= 2;
                  break;
                }
              }
              if (stopper_m === en[a].size) break;
            }
            break; // exit for(its); continue for(a)
          }
        }
      }
      if (var_mate === best_var_mate) { stopper_mate++; if (stopper_mate === mate_trooper) break; }
      else stopper_mate = 0;
    }

    for (let i = 0; i < en.length; i++)
      for (const its of en[i].values()) if (i < its) { E[i].insert(its); E[its].insert(i); }

    let finalEn = null;
    if (trace) {
      finalEn = [];
      for (let i = 0; i < degrees.length; i++)
        for (const j of en[i].values()) if (i < j) finalEn.push([i, j]);
    }
    return { mateRemaining: var_mate, mateOps, initialEn, finalEn };
  }

  function internalKin(E, member_list, i) {
    let v = 0;
    for (const itss of E[i].values()) if (theyAreMate(i, itss, member_list)) v++;
    return v;
  }
  function eraseLinksPipeline(E, member_list, excess, defect, mixing_parameter, rng) {
    const num_nodes = member_list.length;
    if (excess) {
      for (let i = 0; i < num_nodes; i++) {
        while ((E[i].size > 1) && (internalKin(E, member_list, i) / E[i].size < 1 - mixing_parameter)) {
          const deqar = [];
          for (const e of E[i].values()) if (!theyAreMate(i, e, member_list)) deqar.push(e);
          if (deqar.length === E[i].size) return -1;
          const random_mate = deqar[rng.irand(deqar.length - 1)];
          E[i].erase(random_mate); E[random_mate].erase(i);
        }
      }
    }
    if (defect) {
      for (let i = 0; i < num_nodes; i++)
        while ((E[i].size < E.length) && (internalKin(E, member_list, i) / E[i].size > 1 - mixing_parameter)) {
          const stopper_here = num_nodes; let stopper_ = 0;
          let random_mate = rng.irand(num_nodes - 1);
          while (((theyAreMate(i, random_mate, member_list)) || E[i].has(random_mate)) && (stopper_ < stopper_here)) {
            random_mate = rng.irand(num_nodes - 1); stopper_++;
          }
          if (stopper_ === stopper_here) return -1;
          E[i].insert(random_mate); E[random_mate].insert(i);
        }
    }
    return 0;
  }

  // ===========================================================================
  // benchmark() driver -- benchm.cpp:1673 (cclu path is unlikely -> omitted)
  // ===========================================================================
  function benchmark(p, rng, trace) {
    const { excess = false, defect = false } = p;
    const num_nodes = p.num_nodes, average_k = p.average_k, max_degree = p.max_degree;
    const tau = p.tau, tau2 = p.tau2, mixing_parameter = p.mixing_parameter;
    const overlapping_nodes = p.overlapping_nodes || 0;
    const overlap_membership = p.overlap_membership || 0;
    let nmin = p.nmin, nmax = p.nmax, fixed_range = p.fixed_range;

    probe("PARAMS", { num_nodes, average_k, max_degree, tau, tau2, mu: mixing_parameter, nmin, nmax, fixed_range, excess, defect });

    const dmin = solveDmin(max_degree, average_k, -tau);
    if (dmin === -1) return -1;
    let min_degree = Math.trunc(dmin);
    probe("DMIN", { dmin, min_degree });

    const media1 = integerAverage(max_degree, min_degree, tau);
    const media2 = integerAverage(max_degree, min_degree + 1, tau);
    probe("MDPAR", { media1, media2, bump: (Math.abs(media1 - average_k) > Math.abs(media2 - average_k)) ? 1 : 0 });
    if (Math.abs(media1 - average_k) > Math.abs(media2 - average_k)) min_degree++;

    if (!fixed_range) { nmax = max_degree; nmin = Math.max(Math.trunc(min_degree), 3); }

    const cumulative = powerlawCum(max_degree, min_degree, tau);
    const degree_seq = [];
    for (let i = 0; i < num_nodes; i++) {
      const u = rng.ran4();
      const idx = lowerBound(cumulative, u);
      const nn = idx + min_degree;
      probe("DEGDRAW", { i, u, idx, nn });
      degree_seq.push(nn);
    }
    degree_seq.sort((a, b) => a - b);
    const degsum = deqIntSum(degree_seq);
    probe("DEGSEQ", { sum: degsum, parity: degsum % 2, seq: degree_seq.slice() });
    if (degsum % 2 !== 0) {
      const mi = maxElementIdx(degree_seq);
      probe("DEGPAR", { parity_fix_idx: mi, before: degree_seq[mi] });
      degree_seq[mi]--;
    }

    const member_matrix = [], num_seq = [], internal_degree_seq = [];
    if (internalDegreeAndMembership(mixing_parameter, overlapping_nodes, overlap_membership,
        num_nodes, member_matrix, excess, defect, degree_seq, num_seq, internal_degree_seq,
        fixed_range, nmin, nmax, tau2, rng) === -1) return -1;

    const E = [], member_list = [], link_list = [];
    const subRes = buildSubgraphsPipeline(E, member_matrix, member_list, link_list, internal_degree_seq, degree_seq, excess, defect, rng, trace);
    if (subRes === -1) return -1;

    const connRes = connectAllThePartsPipeline(E, member_list, link_list, rng, trace);
    if (eraseLinksPipeline(E, member_list, excess, defect, mixing_parameter, rng) === -1) return -1;

    let edges_dir = 0;
    for (let i = 0; i < E.length; i++) edges_dir += E[i].size;
    const adj = E.map((s) => s.values().slice());
    const com = member_list.map((m) => m.slice());
    probe("FINAL", { num_nodes, edges_dir, adj, com });

    return {
      ok: true, adj, com, num_nodes, edges_dir,
      E, memberMatrix: member_matrix, memberList: member_list, linkList: link_list,
      degreeSeq: degree_seq, internalDegreeSeq: internal_degree_seq, numSeq: num_seq,
      perCluster: subRes.perCluster,
      mateRemaining: connRes.mateRemaining, mateOps: connRes.mateOps,
      mateInitialEn: connRes.initialEn, mateFinalEn: connRes.finalEn,
    };
  }

  // Parse CLI-style params through cast_string_to_double (matches the binary).
  function parseParams(raw) {
    return {
      num_nodes: castInt(castStringToDouble(String(raw.N))),
      average_k: castStringToDouble(String(raw.k)),
      max_degree: castInt(castStringToDouble(String(raw.maxk))),
      nmin: castInt(castStringToDouble(String(raw.minc))),
      nmax: castInt(castStringToDouble(String(raw.maxc))),
      mixing_parameter: castStringToDouble(String(raw.mu)),
      tau: castStringToDouble(String(raw.t1)),
      tau2: castStringToDouble(String(raw.t2)),
      overlapping_nodes: 0, overlap_membership: 0,
      fixed_range: true, excess: false, defect: false,
    };
  }

  // ===========================================================================
  // runFullPipeline -- page entry point. Byte-equal to the canonical binary
  // under the given integer `seed` (ran2 threaded through the whole pipeline).
  //
  // Inputs mirror gen.py's CLI build:
  //   { N, k_avg, max_k, t1, c_min, c_max, t2, mu, seed, traceTest }
  // `seed` is an integer (NOT a () -> [0,1) closure). For backward source
  // compatibility a legacy `rng` field is accepted: if it carries a `.__seed`
  // (set by the page's seededRan2 helper) that seed is used; otherwise the page
  // is expected to pass `seed` directly.
  //
  // Output (byte-equal final state + page-walker trace structures):
  //   { ok, E, memberList, memberMatrix, degrees, internal, external, sizes,
  //     assignment, perCluster[{nodes, phase2Ops, phase2FinalEn, phase3Ops}],
  //     mateRemaining, mateOps, mateInitialEn, mateFinalEn }
  // ===========================================================================
  function runFullPipeline(args) {
    const seed = (args.seed != null) ? (args.seed | 0)
      : (args.rng && args.rng.__seed != null ? (args.rng.__seed | 0) : 1);
    const p = parseParams({
      N: args.N, k: args.k_avg, maxk: args.max_k, minc: args.c_min,
      maxc: args.c_max, mu: args.mu, t1: args.t1, t2: args.t2,
    });
    const rng = new Rng(seed, args.oracle || null);
    const r = benchmark(p, rng, !!args.traceTest);
    if (r === -1) return { ok: false, stage: "benchmark" };

    // member_matrix index -> per-node assignment (single membership here).
    const assignment = new Array(r.num_nodes).fill(-1);
    r.memberMatrix.forEach((members, k) => members.forEach((nd) => { assignment[nd] = k; }));
    // external degree per node = last link_list entry.
    const external = r.linkList.map((l) => l[l.length - 1]);

    return {
      ok: true,
      E: r.E, memberList: r.memberList, memberMatrix: r.memberMatrix,
      degrees: r.degreeSeq, internal: r.internalDegreeSeq, external,
      sizes: r.memberMatrix.map((m) => m.length), assignment,
      perCluster: r.perCluster,
      mateRemaining: r.mateRemaining, mateOps: r.mateOps,
      mateInitialEn: r.mateInitialEn, mateFinalEn: r.mateFinalEn,
    };
  }

  // ===========================================================================
  // Page sub-stage illustration helpers (pedagogical; not on the byte-equal
  // canonical call path). They accept an integer `seed` and build a private
  // ran2 stream, so the page's earlier walkers (degree fit, internal split,
  // cluster sizes, assignment, per-pair config-model) stay reproducible.
  // ===========================================================================

  // benchm.cpp:1681-1730 degree-sequence sampler. Accepts seed (int).
  function sampleDegreeSequence(argsIn) {
    const { N, k_avg, max_k, t1 } = argsIn;
    const rng = makeStageRng(argsIn);
    const dmin = solveDmin(max_k, k_avg, -t1);
    if (dmin === -1) throw new Error(`solveDmin failed max_k=${max_k} k_avg=${k_avg} t1=${t1}`);
    let min_degree = Math.trunc(dmin);
    const m1 = integerAverage(max_k, min_degree, t1);
    const m2 = integerAverage(max_k, min_degree + 1, t1);
    if (Math.abs(m1 - k_avg) > Math.abs(m2 - k_avg)) min_degree++;
    const cumulative = powerlawCum(max_k, min_degree, t1);
    const degrees = new Array(N);
    for (let i = 0; i < N; i++) { const u = rng.ran4(); degrees[i] = lowerBound(cumulative, u) + min_degree; }
    degrees.sort((a, b) => a - b);
    let sum = 0; for (const x of degrees) sum += x;
    if (sum % 2 !== 0) { let mi = 0; for (let i = 1; i < degrees.length; i++) if (degrees[i] > degrees[mi]) mi = i; degrees[mi] -= 1; }
    return { degrees, min_degree, cumulative };
  }

  // benchm.cpp:405-441 per-node internal-degree split.
  function sampleInternalDegrees(argsIn) {
    const { degrees, mu, excess = false, defect = false } = argsIn;
    const rng = makeStageRng(argsIn);
    const internal = new Array(degrees.length), external = new Array(degrees.length);
    for (let i = 0; i < degrees.length; i++) {
      const d = degrees[i]; const interno = (1 - mu) * d;
      let intInterno = Math.trunc(interno);
      if (rng.ran4() < (interno - intInterno)) intInterno += 1;
      if (excess) while (intInterno / d < (1 - mu) && intInterno < d) intInterno += 1;
      if (defect) while (intInterno / d > (1 - mu) && intInterno > 0) intInterno -= 1;
      internal[i] = intInterno; external[i] = d - intInterno;
    }
    return { internal, external };
  }

  // benchm.cpp:444-480 cluster-size sampler.
  function sampleClusterSizes(argsIn) {
    const { N, max_internal_degree, c_min, c_max, t2, fixed_range = false, overlap_extra = 0 } = argsIn;
    const rng = makeStageRng(argsIn);
    const cumulative = powerlawCum(c_max, c_min, t2);
    const sizes = []; const cap = N + overlap_extra; let _num_ = 0;
    if (!fixed_range && (max_internal_degree + 1) > c_min) { sizes.push(max_internal_degree + 1); _num_ = max_internal_degree + 1; }
    while (true) {
      const u = rng.ran4(); const nn = lowerBound(cumulative, u) + c_min;
      if (nn + _num_ <= cap) { sizes.push(nn); _num_ += nn; } else break;
    }
    if (sizes.length > 0) { let mi = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] < sizes[mi]) mi = i; sizes[mi] += cap - _num_; }
    return { sizes, cumulative };
  }

  // Per-pair config-model walker support (page's stage-4 illustration on the
  // raw degree sequence). ran2-backed; preserves prePairs trace shape.
  function configModelPairStubs(argsIn) {
    const { stubs, traceTest } = argsIn;
    const rng = makeStageRng(argsIn);
    const work = stubs.slice();
    for (let i = work.length - 1; i > 0; i--) { const j = rng.irand(i); const t = work[i]; work[i] = work[j]; work[j] = t; }
    if (work.length % 2 !== 0) work.pop();
    const edges = []; let loops = 0; const seen = new Map();
    const prePairs = traceTest ? [] : null;
    for (let i = 0; i < work.length; i += 2) {
      const u = work[i], v = work[i + 1];
      edges.push([u, v]); if (u === v) loops += 1;
      const a = u <= v ? u : v, b = u <= v ? v : u, k = `${a},${b}`;
      const prevCount = seen.get(k) || 0; seen.set(k, prevCount + 1);
      if (prePairs) prePairs.push({ u, v, loop: u === v, multi: u !== v && prevCount > 0 });
    }
    let parallels = 0; seen.forEach((vv) => { if (vv > 1) parallels += vv - 1; });
    return { edges, stats: { loops, parallels }, prePairs };
  }

  // Generic 2-opt multigraph cleanup (page stage-4 illustration). ran2-backed.
  function cleanupMultigraph(argsIn) {
    const { edges, maxRetries = 10, traceTest } = argsIn;
    const rng = makeStageRng(argsIn);
    const validSet = new Set(); const valid = []; const invalid = [];
    const rewireOps = traceTest ? [] : null;
    edges.forEach(([u, v]) => {
      const a = u < v ? u : v, b = u < v ? v : u, key = `${a},${b}`;
      if (u === v || validSet.has(key)) invalid.push([u, v]);
      else { validSet.add(key); valid.push([a, b]); }
    });
    function tryRewire(badEdge) {
      const [u, v] = badEdge;
      if (valid.length === 0) { invalid.push([u, v]); if (rewireOps) rewireOps.push({ p1: [u, v], p2: null, newp1: null, newp2: null, success: false, reason: "no-valid-pool" }); return; }
      const idx = rng.irand(valid.length - 1);
      const [x, y] = valid[idx];
      let new_e1, new_e2;
      if (rng.ran4() < 0.5) { new_e1 = [Math.min(u, x), Math.max(u, x)]; new_e2 = [Math.min(v, y), Math.max(v, y)]; }
      else { new_e1 = [Math.min(u, y), Math.max(u, y)]; new_e2 = [Math.min(v, x), Math.max(v, x)]; }
      const k1 = `${new_e1[0]},${new_e1[1]}`, k2 = `${new_e2[0]},${new_e2[1]}`;
      if (new_e1[0] !== new_e1[1] && new_e2[0] !== new_e2[1] && !validSet.has(k1) && !validSet.has(k2) && k1 !== k2) {
        validSet.delete(`${x},${y}`); valid[idx] = valid[valid.length - 1]; valid.pop();
        validSet.add(k1); validSet.add(k2); valid.push(new_e1); valid.push(new_e2);
        if (rewireOps) rewireOps.push({ p1: [u, v], p2: [x, y], newp1: new_e1, newp2: new_e2, success: true });
      } else { invalid.push([u, v]); if (rewireOps) rewireOps.push({ p1: [u, v], p2: [x, y], newp1: new_e1, newp2: new_e2, success: false, reason: "collision" }); }
    }
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (invalid.length === 0) break;
      let lastRecycle = invalid.length, recycleCounter = lastRecycle;
      while (invalid.length > 0) {
        recycleCounter -= 1;
        if (recycleCounter < 0) { if (invalid.length < lastRecycle) { lastRecycle = invalid.length; recycleCounter = lastRecycle; } else break; }
        tryRewire(invalid.shift());
      }
    }
    return { kept: valid.slice(), dropped: invalid.slice(), rewireOps };
  }

  // Assignment-stage illustration (build_bipartite_network + remap). ran2-backed,
  // single membership. Mirrors the canonical control flow + draw order.
  function assignNodesToClusters(argsIn) {
    const { degrees, internalDegrees, sizes } = argsIn;
    const rng = makeStageRng(argsIn);
    const N = degrees.length, ncom = sizes.length;
    if (N === 0 || ncom === 0) return { assignment: [], memberMatrix: [], phases: { seed: [], swap: [], remap: [] }, ok: true };
    const member_matrix = [];
    const num_seq = sizes.slice();
    if (buildBipartiteNetwork(member_matrix, new Array(N).fill(1), num_seq, rng) === -1)
      return { assignment: new Array(N).fill(-1), memberMatrix: [], phases: { seed: [], swap: [], remap: [] }, ok: false };
    const seedAssign = new Array(N).fill(-1);
    member_matrix.forEach((members, k) => members.forEach((nd) => { seedAssign[nd] = k; }));

    const available = new Array(N).fill(0);
    for (let i = 0; i < member_matrix.length; i++)
      for (let j = 0; j < member_matrix[i].length; j++) available[member_matrix[i][j]] += member_matrix[i].length - 1;
    const available_nodes = []; for (let i = 0; i < N; i++) available_nodes.push(i);
    const map_nodes = new Array(N).fill(0);
    let ok = true;
    for (let i = degrees.length - 1; i >= 0; i--) {
      let try_this = rng.irand(available_nodes.length - 1); let kr = 0;
      while (internalDegrees[i] > available[available_nodes[try_this]]) {
        kr++; try_this = rng.irand(available_nodes.length - 1);
        if (kr === 3 * N) { ok = false; break; }
      }
      if (!ok) break;
      map_nodes[available_nodes[try_this]] = i;
      available_nodes[try_this] = available_nodes[available_nodes.length - 1]; available_nodes.pop();
    }
    const remapped = member_matrix.map((c) => c.map((s) => map_nodes[s]));
    remapped.forEach((c) => c.sort((a, b) => a - b));
    const assignment = new Array(N).fill(-1);
    remapped.forEach((members, k) => members.forEach((nd) => { assignment[nd] = k; }));
    return { assignment, memberMatrix: remapped, phases: { seed: seedAssign.slice(), swap: seedAssign.slice(), remap: assignment.slice() }, ok };
  }

  // Resolve a ran2 stream for a sub-stage helper from `seed` (int) or a legacy
  // d3-style closure carrying __seed. Falls back to seed 1.
  function makeStageRng(argsIn) {
    if (argsIn.rng2 instanceof Rng) return argsIn.rng2;
    let seed = 1;
    if (argsIn.seed != null) seed = argsIn.seed | 0;
    else if (typeof argsIn.rng === "function" && argsIn.rng.__seed != null) seed = argsIn.rng.__seed | 0;
    else if (typeof argsIn.rng === "number") seed = argsIn.rng | 0;
    return new Rng(seed, null);
  }

  // Helper the page uses to build a ran2-seeded stream tag (so legacy call
  // sites that pass `rng` can carry the integer seed).
  function seededRan2(seed) { const fn = () => { throw new Error("LFR uses ran2 via seed, not a [0,1) closure"); }; fn.__seed = seed | 0; return fn; }

  window.LFRKernel = {
    // math + helpers
    integral, averageDegree, solveDmin, integerAverage, powerlawCumulative,
    lowerBound, theyAreMate, computeInternalDegreePerNode, changeCommunitySize,
    castStringToDouble, castInt, jsPow, jsLog, jsExp,
    // RNG
    Ran2, Rng, seededRan2,
    // sub-stage illustrations
    sampleDegreeSequence, sampleInternalDegrees, sampleClusterSizes,
    configModelPairStubs, cleanupMultigraph, assignNodesToClusters,
    // canonical driver + byte-equal pipeline
    parseParams, benchmark, runFullPipeline,
  };
})();
