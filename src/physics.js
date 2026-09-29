// Collision world: vertically-extruded axis-aligned boxes in a spatial hash, plus
// "terrain" regions that change the base ground height (pool, sloped theatre floor).

const CELL = 4;
const key = (ix, iz) => (ix + 2000) * 5000 + (iz + 2000);

export class CollisionWorld {
  constructor() {
    this.cols = [];
    this.grid = new Map();
    this.terrain = [];
    this.stamp = 0;
    this.marks = [];
  }

  // Box collider. y0/y1 = bottom/top.
  add(x0, y0, z0, x1, y1, z1, tag = 0) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const c = { x0, y0, z0, x1, y1, z1, tag, id: this.cols.length };
    this.cols.push(c);
    this.marks.push(0);
    const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
    const iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = key(ix, iz);
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(c);
      }
    return c;
  }

  // Calls cb(collider) for colliders whose cells overlap the query rect (deduped).
  query(x0, z0, x1, z1, cb) {
    const s = ++this.stamp;
    const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
    const iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const a = this.grid.get(key(ix, iz));
        if (!a) continue;
        for (const c of a) {
          if (this.marks[c.id] === s) continue;
          this.marks[c.id] = s;
          cb(c);
        }
      }
  }

  // terrain region: rect + function (x,z)->y
  addTerrain(rect, fn) {
    this.terrain.push({ r: rect, fn });
  }

  base(x, z) {
    for (const t of this.terrain) {
      const r = t.r;
      if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return t.fn(x, z);
    }
    return 0;
  }

  // Highest walkable surface under (x,z) not higher than feet+step
  groundAt(x, z, feet, step) {
    let g = this.base(x, z);
    const lim = feet + step;
    this.query(x, z, x, z, (c) => {
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return;
      if (c.y1 <= lim && c.y1 > g) g = c.y1;
    });
    return g;
  }

  // Lowest ceiling above head start
  ceilingAt(x, z, from) {
    let m = Infinity;
    this.query(x, z, x, z, (c) => {
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return;
      if (c.y0 >= from && c.y0 < m) m = c.y0;
    });
    return m;
  }

  // Push a circle (x,z,r) out of blocking boxes. Returns [x,z].
  resolve(x, z, r, feet, height, step) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(x - r, z - r, x + r, z + r, (c) => {
        if (c.y1 <= feet + step || c.y0 >= feet + height) return;
        const cx = Math.max(c.x0, Math.min(x, c.x1));
        const cz = Math.max(c.z0, Math.min(z, c.z1));
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d;
          x += (dx / d) * push;
          z += (dz / d) * push;
        } else {
          // center inside the box: push out along the smallest penetration
          const px0 = x - c.x0 + r, px1 = c.x1 - x + r, pz0 = z - c.z0 + r, pz1 = c.z1 - z + r;
          const m = Math.min(px0, px1, pz0, pz1);
          if (m === px0) x = c.x0 - r;
          else if (m === px1) x = c.x1 + r;
          else if (m === pz0) z = c.z0 - r;
          else z = c.z1 + r;
        }
        moved = true;
      });
      if (!moved) break;
    }
    return [x, z];
  }

  // Is there a sharp terrain rise (pool edge) around the circle?
  terrainBlocked(x, z, r, feet, step) {
    if (!this.terrain.length) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (this.base(x + Math.cos(a) * r, z + Math.sin(a) * r) > feet + step) return true;
    }
    return false;
  }

  // March a ray from a to b; returns fraction [0..1] of first hit (point-in-box test).
  raycast(ax, ay, az, bx, by, bz, pad = 0.2) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.max(2, Math.ceil(len / 0.15));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      let hit = false;
      this.query(x - pad, z - pad, x + pad, z + pad, (c) => {
        if (hit) return;
        if (x >= c.x0 - pad && x <= c.x1 + pad && z >= c.z0 - pad && z <= c.z1 + pad && y >= c.y0 - pad && y <= c.y1 + pad) hit = true;
      });
      if (hit || y < this.base(x, z) + 0.15) return Math.max(0, (i - 1) / steps);
    }
    return 1;
  }
}
