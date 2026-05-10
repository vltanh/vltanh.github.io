/* MT19937 + libstdc++ uniform_int_distribution port for VieCut.
 *
 * [UPSTREAM VieCut/lib/tools/random_functions.h]
 * VieCut binds `std::mt19937` and uses `std::uniform_int_distribution<unsigned>`.
 * Bit-exact replication of libstdc++'s rejection sampling allows JS to
 * reproduce the canonical RNG sequence given the same seed.
 *
 * MT19937 state: 624 32-bit words; standard parameters per Matsumoto+
 * Nishimura 1998. seed init follows the C++ standard (Knuth LCG).
 *
 * uniform_int_distribution(lo, hi) returns lo + scale-and-reject from
 * the underlying generator's [0, 2^32) output. libstdc++ implementation
 * (bits/uniform_int_dist.h); see comments at the function below.
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  // ---- MT19937 ----------------------------------------------------------
  const N = 624;
  const M = 397;
  const MATRIX_A = 0x9908b0df >>> 0;
  const UPPER_MASK = 0x80000000 >>> 0;
  const LOWER_MASK = 0x7fffffff >>> 0;

  function MT19937(seed) {
    this.mt = new Uint32Array(N);
    this.idx = N + 1;
    if (seed !== undefined) this.seed(seed);
  }

  MT19937.prototype.seed = function (s) {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      // x = 1812433253 * (prev ^ (prev >> 30)) + i;
      // emulate 32-bit unsigned multiplication.
      const prev = this.mt[i - 1];
      const xored = (prev ^ (prev >>> 30)) >>> 0;
      // 1812433253 = 0x6c078965. Multiply via low/high 16-bit split.
      const lo = (xored & 0xffff) * 0x6c078965;
      const hi = ((xored >>> 16) * 0x6c078965) & 0xffff;
      this.mt[i] = ((((hi << 16) >>> 0) + lo + i) >>> 0);
    }
    this.idx = N;
  };

  MT19937.prototype.next = function () {
    if (this.idx >= N) {
      // generate N words at one time
      let kk;
      for (kk = 0; kk < N - M; kk++) {
        const y = ((this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK)) >>> 0;
        this.mt[kk] = (this.mt[kk + M] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0)) >>> 0;
      }
      for (; kk < N - 1; kk++) {
        const y = ((this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK)) >>> 0;
        this.mt[kk] = (this.mt[kk + (M - N)] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0)) >>> 0;
      }
      const y = ((this.mt[N - 1] & UPPER_MASK) | (this.mt[0] & LOWER_MASK)) >>> 0;
      this.mt[N - 1] = (this.mt[M - 1] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0)) >>> 0;
      this.idx = 0;
    }
    let y = this.mt[this.idx++];
    y = (y ^ (y >>> 11)) >>> 0;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y = (y ^ (y >>> 18)) >>> 0;
    return y >>> 0;
  };

  // mt19937 raw upper bound (2^32 - 1 + 1 == 2^32).
  const MT_RANGE = 0x100000000; // 2^32

  // ---- libstdc++ uniform_int_distribution<unsigned int>(lo, hi) ---------
  //
  // Reference: gcc/libstdc++/include/bits/uniform_int_dist.h, the
  // _S_nd helper. For range r = hi - lo + 1, urange = 2^32 - 1, and
  // urngrange = urange + 1 = 2^32 (the generator's range size):
  //
  //   if (r > urngrange): does not apply for r <= 2^32.
  //   else if (r == urngrange) return urng() + lo.
  //   else if (r == 1) return lo (single value).
  //   else:
  //       scaling = urngrange / r;       // floor
  //       past = r * scaling;            // rejection threshold
  //       loop: ret = urng();
  //             if (ret >= past) continue;  // reject
  //             return lo + (ret / scaling);
  //
  // (Equivalently scaling=floor(2^32 / r); past = r * scaling.)
  //
  // BigInt is used for 2^32 / r to keep precision; JS `Math.floor` on
  // doubles loses the low bit when 2^32 is involved.
  function uniformInt(rng, lo, hi) {
    const r = (hi - lo + 1) >>> 0;
    if (r === 0) {
      // r overflowed to 0 -> covers full 2^32 range.
      return ((rng.next() + lo) >>> 0);
    }
    if (r === 1) return lo;
    const rB = BigInt(r);
    const URB = BigInt(MT_RANGE); // 2^32
    const scaling = URB / rB;
    const past = scaling * rB;
    while (true) {
      const ret = BigInt(rng.next());
      if (ret < past) {
        return lo + Number(ret / scaling);
      }
    }
  }

  // ---- random_functions facade matching VieCut's static API ------------
  // [UPSTREAM tools/random_functions.h:27-28] static MersenneTwister m_mt;
  // libstdc++ std::mt19937() default-constructs with seed=5489 (default_seed).
  // Mirror so chained mincut calls (CM/WCC) without explicit setSeed produce
  // bit-equal RNG stream vs canonical (where mincut_custom.cpp:37 leaves
  // setSeed COMMENTED OUT and m_mt stays default-constructed for the run).
  let m_seed = 5489;
  let m_mt = new MT19937(5489);
  // Oracle queue: when set, next/nextInt/etc. consume from this queue
  // (each entry is { kind: "next"|"nextInt"|"nextBool"|"nextDouble", val })
  // instead of advancing the MT19937. Used by the random/deterministic
  // separation test: feed canonical C++'s RNG outputs into JS, verify
  // JS deterministic computation matches canonical's downstream output.
  let m_oracle = null;
  // Observer hook: side-effect-free callback invoked on every RNG call.
  // Read-only; never perturbs return value or generator state. Used by
  // the diff harness to collect a JS-side trace bit-comparable to
  // canonical's [TRACE-RNG] stderr stream. Inert when null.
  let m_observer = null;

  function setSeed(seed) {
    m_seed = seed;
    m_mt = new MT19937(seed);
    if (m_observer !== null) m_observer({ kind: "setSeed", seed: (seed >>> 0) });
  }
  function setOracle(queue) { m_oracle = queue; }
  function clearOracle() { m_oracle = null; }
  function setObserver(cb) { m_observer = cb; }
  function clearObserver() { m_observer = null; }

  function getSeed() { return m_seed; }
  function next() {
    let val;
    if (m_oracle !== null) {
      const e = m_oracle.shift();
      if (!e || e.kind !== "next")
        throw new Error(`oracle exhausted/wrong kind for next(): ${JSON.stringify(e)}`);
      val = e.val >>> 0;
    } else {
      val = m_mt.next();
    }
    if (m_observer !== null) m_observer({ kind: "next", val });
    return val;
  }
  function nextInt(lb, rb) {
    let val;
    if (m_oracle !== null) {
      const e = m_oracle.shift();
      if (!e || e.kind !== "nextInt")
        throw new Error(`oracle exhausted/wrong kind for nextInt(): ${JSON.stringify(e)}`);
      if (e.lb !== lb || e.rb !== rb) {
        throw new Error(`oracle nextInt range mismatch: oracle=(${e.lb},${e.rb}) caller=(${lb},${rb})`);
      }
      val = e.val;
    } else {
      val = uniformInt(m_mt, lb, rb);
    }
    if (m_observer !== null) m_observer({ kind: "nextInt", lb, rb, val });
    return val;
  }
  function nextBool() {
    let val;
    if (m_oracle !== null) {
      const e = m_oracle.shift();
      if (!e || e.kind !== "nextBool")
        throw new Error(`oracle wrong kind for nextBool(): ${JSON.stringify(e)}`);
      val = e.val;
    } else {
      val = uniformInt(m_mt, 0, 1) === 1;
    }
    if (m_observer !== null) m_observer({ kind: "nextBool", val });
    return val;
  }
  function nextDouble(lb, rb) {
    let val;
    if (m_oracle !== null) {
      const e = m_oracle.shift();
      if (!e || e.kind !== "nextDouble")
        throw new Error(`oracle wrong kind for nextDouble(): ${JSON.stringify(e)}`);
      val = e.val;
    } else {
      // libstdc++ uniform_real picks 53-bit fraction via two uint32 draws;
      // not used by cactus path. Provide a simple version for completeness.
      const a = m_mt.next() >>> 5;        // 27 bits
      const b = m_mt.next() >>> 6;        // 26 bits
      const u = (a * Math.pow(2, 26) + b) / Math.pow(2, 53);
      val = lb + u * (rb - lb);
    }
    if (m_observer !== null) m_observer({ kind: "nextDouble", lb, rb, val });
    return val;
  }

  // ---- libstdc++ std::shuffle (optimized Fisher-Yates branch) -----------
  //
  // [UPSTREAM gcc/libstdc++ bits/stl_algo.h:3719-3792]
  //   if (urngrange / urange >= urange) { optimized branch }
  //   else                              { generic uniform_int_distribution }
  // For our caller (permutate_vector_local on chunks of size <= 128, with
  // m_mt's urngrange = 2^32) the optimized branch is always taken
  // (2^32/128 = 2^25 >= 128 >= chunk_size).
  //
  //   __i = first + 1
  //   if (urange % 2 == 0) { iter_swap(i++, first + uniform_int(0,1)) }
  //   while (i != last) {
  //     swap_range = (i - first) + 1
  //     (p, q) = __gen_two_uniform_ints(swap_range, swap_range+1)
  //            = uniform_int(0, swap_range*(swap_range+1) - 1)
  //              -> (x / (swap_range+1), x % (swap_range+1))
  //     iter_swap(i++, first + p)
  //     iter_swap(i++, first + q)
  //   }
  //
  // `__gen_two_uniform_ints` is library-internal but documented at
  // bits/stl_algo.h:3704-3712: composes both ranges into one
  // uniform_int_distribution call and splits via div/mod.
  //
  // Note: cpp's std::shuffle calls m_mt() directly (NOT through
  // random_functions::next()), so the cpp `[TRACE-RNG] kind:next` lines
  // emitted from the LP path come from the instrumented sibling
  // `permutate_vector_local_traced` in viz_check/viecut/instrumented/include/coarsening/label_propagation.h
  // which routes the draws through `random_functions::next()` to make
  // them visible in the trace. JS mirrors by routing through the
  // module-level `next()` (observer fires per draw, lockstep with cpp).
  //
  // uniformIntViaNext: same algorithm as uniformInt() but uses our
  // module-level `next()` (which fires observer + consults oracle) so
  // every shuffle draw is visible to diff_harness lockstep.
  function uniformIntViaNext(lo, hi) {
    const r = (hi - lo + 1) >>> 0;
    if (r === 0) return ((next() + lo) >>> 0);
    if (r === 1) return lo;
    const rB = BigInt(r);
    const URB = BigInt(MT_RANGE);
    const scaling = URB / rB;
    const past = scaling * rB;
    while (true) {
      const ret = BigInt(next());
      if (ret < past) return lo + Number(ret / scaling);
    }
  }

  function shuffleRange(vec, lo, hi) {
    if (hi - lo < 2) return;
    const urange = hi - lo;
    let i = lo + 1;
    if ((urange & 1) === 0) {
      const pos = uniformIntViaNext(0, 1);
      const tmp = vec[i]; vec[i] = vec[lo + pos]; vec[lo + pos] = tmp;
      i++;
    }
    while (i < hi) {
      const swap_range = (i - lo) + 1;
      const hi2 = swap_range * (swap_range + 1) - 1;
      const x = uniformIntViaNext(0, hi2);
      const pp_first = Math.floor(x / (swap_range + 1));
      const pp_second = x % (swap_range + 1);
      let tmp = vec[i]; vec[i] = vec[lo + pp_first]; vec[lo + pp_first] = tmp;
      i++;
      tmp = vec[i]; vec[i] = vec[lo + pp_second]; vec[lo + pp_second] = tmp;
      i++;
    }
  }

  // [UPSTREAM tools/random_functions.h:86]
  // permutate_vector_local(&vec, init): if init then identity-fill; then
  // std::shuffle each contiguous chunk of 128.
  function permutate_vector_local(vec, init) {
    if (init) {
      for (let i = 0; i < vec.length; i++) vec[i] = i;
    }
    const localsize = 128;
    for (let i = 0; i < vec.length; i += localsize) {
      const end = Math.min(vec.length, i + localsize);
      shuffleRange(vec, i, end);
    }
  }

  NS.MT19937 = MT19937;
  NS.uniformInt = uniformInt;
  NS.random_functions = {
    setSeed, getSeed, setOracle, clearOracle, setObserver, clearObserver,
    next, nextInt, nextBool, nextDouble,
    permutate_vector_local,
    getMT: () => m_mt,
  };
})();
