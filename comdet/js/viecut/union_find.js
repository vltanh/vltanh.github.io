/* union_find with rank + path compression.
 * [UPSTREAM VieCut/lib/data_structure/union_find.h]
 */
(function () {
  "use strict";
  if (!window.COMDET) return;
  const C = window.COMDET;
  const NS = (C.VIECUT = C.VIECUT || {});

  function UnionFind(n) {
    this.parent = new Int32Array(n);
    this.rank = new Int32Array(n);
    this.m_n = n;
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  UnionFind.prototype.Find = function (x) {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    // path compression
    let cur = x;
    while (this.parent[cur] !== r) {
      const nxt = this.parent[cur];
      this.parent[cur] = r;
      cur = nxt;
    }
    return r;
  };
  UnionFind.prototype.Union = function (lhs, rhs) {
    const sl = this.Find(lhs);
    const sr = this.Find(rhs);
    if (sl !== sr) {
      if (this.rank[sl] < this.rank[sr]) {
        this.parent[sl] = sr;
      } else {
        this.parent[sr] = sl;
        if (this.rank[sl] === this.rank[sr]) this.rank[sl]++;
      }
      this.m_n--;
      return true;
    }
    return false;
  };
  UnionFind.prototype.n = function () { return this.m_n; };

  NS.UnionFind = UnionFind;
})();
