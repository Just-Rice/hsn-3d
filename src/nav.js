// Grid A* over both floors; stairwells connect level 0 and level 1.
import { LEVEL_H } from './layout.js';
import { inRect } from './geo.js';

const CS = 0.5; // cell size (m)
const X0 = -50, Z0 = -12, X1 = 205, Z1 = 186;
const NX = Math.ceil((X1 - X0) / CS), NZ = Math.ceil((Z1 - Z0) / CS), N = NX * NZ;

export class NavGrid {
  constructor(world, info) {
    this.world = world;
    this.info = info;
    this.blocked = [new Uint8Array(N), new Uint8Array(N)];
    this.h = new Float32Array(N); // level-0 ground height
    this.portals = new Map(); // node -> [{to, cost}]
    this.build();
  }

  idx(x, z) {
    const i = Math.floor((x - X0) / CS), k = Math.floor((z - Z0) / CS);
    if (i < 0 || k < 0 || i >= NX || k >= NZ) return -1;
    return k * NX + i;
  }
  center(id) {
    const i = id % NX, k = (id - i) / NX;
    return [X0 + (i + 0.5) * CS, Z0 + (k + 0.5) * CS];
  }

  build() {
    const pad = 0.22;
    for (let lv = 0; lv < 2; lv++) {
      const feet = lv === 0 ? 0 : LEVEL_H;
      const bl = this.blocked[lv];
      for (const c of this.world.cols) {
        if (c.y1 <= feet + 0.55 || c.y0 >= feet + 1.7) continue;
        const i0 = Math.max(0, Math.floor((c.x0 - pad - X0) / CS)), i1 = Math.min(NX - 1, Math.floor((c.x1 + pad - X0) / CS));
        const k0 = Math.max(0, Math.floor((c.z0 - pad - Z0) / CS)), k1 = Math.min(NZ - 1, Math.floor((c.z1 + pad - Z0) / CS));
        for (let k = k0; k <= k1; k++)
          for (let i = i0; i <= i1; i++) {
            const cx = X0 + (i + 0.5) * CS, cz = Z0 + (k + 0.5) * CS;
            if (cx >= c.x0 - pad && cx <= c.x1 + pad && cz >= c.z0 - pad && cz <= c.z1 + pad) bl[k * NX + i] = 1;
          }
      }
    }
    // level-0 ground heights (pool pit, raked theatre floor, stage steps)
    const b0 = this.blocked[0];
    const terr = this.world.terrain.map((t) => t.r);
    for (let k = 0; k < NZ; k++)
      for (let i = 0; i < NX; i++) {
        const id = k * NX + i;
        const cx = X0 + (i + 0.5) * CS, cz = Z0 + (k + 0.5) * CS;
        if (terr.some((r) => inRect(r, cx, cz, 1))) this.h[id] = this.world.groundAt(cx, cz, 0, 0.5);
      }
    // level 1: only on the slab
    const b1 = this.blocked[1];
    const slabs = this.info.slabRects;
    for (let k = 0; k < NZ; k++)
      for (let i = 0; i < NX; i++) {
        const cx = X0 + (i + 0.5) * CS, cz = Z0 + (k + 0.5) * CS;
        if (!slabs.some((r) => inRect(r, cx, cz, 0.01))) b1[k * NX + i] = 1;
      }
    // pool pit is not a walkway
    const pit = this.info.poolPit;
    for (let k = 0; k < NZ; k++)
      for (let i = 0; i < NX; i++) {
        const cx = X0 + (i + 0.5) * CS, cz = Z0 + (k + 0.5) * CS;
        if (inRect(pit, cx, cz, 0.3)) b0[k * NX + i] = 1;
      }
    // stair portals
    for (const s of this.info.stairs) {
      const a = this.nearestFree(0, s.entry0[0], s.entry0[1], 4);
      const b = this.nearestFree(1, s.exit1[0], s.exit1[1], 4);
      if (a < 0 || b < 0) continue;
      const cost = s.D * 2 + s.W;
      const A = a, Bn = N + b;
      if (!this.portals.has(A)) this.portals.set(A, []);
      if (!this.portals.has(Bn)) this.portals.set(Bn, []);
      this.portals.get(A).push({ to: Bn, cost, stair: s });
      this.portals.get(Bn).push({ to: A, cost, stair: s });
      s.navA = A;
      s.navB = Bn;
    }
  }

  nearestFree(lv, x, z, maxR = 12, within = null) {
    const c = this.idx(x, z);
    if (c < 0) return -1;
    const bl = this.blocked[lv];
    if (!bl[c]) return c;
    const ci = c % NX, ck = (c - ci) / NX;
    for (let r = 1; r <= maxR / CS; r++) {
      let best = -1, bd = Infinity;
      for (let dk = -r; dk <= r; dk++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
          const i = ci + di, k = ck + dk;
          if (i < 0 || k < 0 || i >= NX || k >= NZ) continue;
          const id = k * NX + i;
          if (bl[id]) continue;
          if (within) {
            const [px, pz] = this.center(id);
            if (!inRect(within, px, pz, -0.2)) continue;
          }
          const d = di * di + dk * dk;
          if (d < bd) { bd = d; best = id; }
        }
      if (best >= 0) return best;
    }
    return -1;
  }

  // returns { points: [{lv,x,z,h}], length } or null
  find(lv0, x0, z0, lv1, x1, z1, targetRect = null) {
    const s = this.nearestFree(lv0, x0, z0, 6);
    const g = this.nearestFree(lv1, x1, z1, 14, targetRect);
    if (s < 0 || g < 0) return null;
    const start = lv0 * N + s, goal = lv1 * N + g;
    const [gx, gz] = this.center(g);
    if (!this.G) {
      this.G = new Float32Array(2 * N);
      this.came = new Int32Array(2 * N);
      this.seen = new Uint32Array(2 * N);
      this.done = new Uint32Array(2 * N);
      this.gen = 0;
    }
    const G = this.G, came = this.came, seen = this.seen, done = this.done;
    const gen = ++this.gen;
    const oct = (ax, az, bx, bz) => {
      const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    // stairs-aware heuristic: a node on the other floor must pass through some stairwell
    const links = this.info.stairs.filter((st) => st.navA !== undefined).map((st) => {
      const [ax, az] = this.center(st.navA), [bx, bz] = this.center(st.navB - N);
      return { a: [ax, az], b: [bx, bz], cost: st.D * 2 + st.W };
    });
    const hfun = (node) => {
      const lv = node >= N ? 1 : 0;
      const [x, z] = this.center(node - lv * N);
      if (lv === lv1) return oct(x, z, gx, gz);
      let best = Infinity;
      for (const l of links) {
        const [p, q] = lv === 0 ? [l.a, l.b] : [l.b, l.a];
        const v = oct(x, z, p[0], p[1]) + l.cost + oct(q[0], q[1], gx, gz);
        if (v < best) best = v;
      }
      return best;
    };
    const heap = new MinHeap();
    G[start] = 0;
    seen[start] = gen;
    came[start] = -1;
    heap.push(start, hfun(start));
    const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let iter = 0, found = false;
    const relax = (node, ng, from) => {
      if (seen[node] !== gen || ng < G[node]) {
        seen[node] = gen;
        G[node] = ng;
        came[node] = from;
        heap.push(node, ng + hfun(node));
      }
    };
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (done[cur] === gen) continue;
      done[cur] = gen;
      if (++iter > 300000) return null;
      const lv = cur >= N ? 1 : 0;
      const id = cur - lv * N;
      const i = id % NX, k = (id - i) / NX;
      const bl = this.blocked[lv];
      for (const [di, dk, w] of D8) {
        const ni = i + di, nk = k + dk;
        if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue;
        const nid = nk * NX + ni;
        if (bl[nid]) continue;
        if (di && dk && (bl[k * NX + ni] || bl[nk * NX + i])) continue;
        if (lv === 0 && Math.abs(this.h[nid] - this.h[id]) > 0.75) continue;
        relax(lv * N + nid, G[cur] + w * CS, cur);
      }
      const ps = this.portals.get(cur);
      if (ps) for (const p of ps) relax(p.to, G[cur] + p.cost, cur);
    }
    if (!found) return null;
    const out = [];
    for (let n = goal; n >= 0; n = came[n]) {
      const lv = n >= N ? 1 : 0;
      const [x, z] = this.center(n - lv * N);
      out.push({ lv, x, z, h: lv ? LEVEL_H : this.h[n - lv * N] });
      if (n === start) break;
    }
    out.reverse();
    return { points: simplify(out), length: G[goal] };
  }
}

function simplify(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    if (a.lv !== b.lv || b.lv !== c.lv) { out.push(b); continue; }
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6 || Math.abs(b.h - a.h) > 0.05) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
