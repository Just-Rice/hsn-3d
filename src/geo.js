// Lightweight geometry batcher: accumulates boxes/quads with world-space UVs (in meters)
// and optional vertex colors, then emits one BufferGeometry per material.
import * as THREE from 'three';

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.n = 0;
  }

  _v(x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
  }

  // 4 corners (CCW seen from the front), normal, uv per corner
  quad(p, n, uvs, color = WHITE) {
    const b = this.n;
    for (let i = 0; i < 4; i++) this._v(p[i][0], p[i][1], p[i][2], n[0], n[1], n[2], uvs[i][0], uvs[i][1], color);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }

  // Axis-aligned box. faces: string subset of 'xXyYzZ' (lower = negative side). Default all.
  box(x0, y0, z0, x1, y1, z1, color = WHITE, faces = 'xXyYzZ', uvOff = 0) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const o = uvOff;
    if (faces.includes('X'))
      this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0],
        [[-z1 + o, y0], [-z0 + o, y0], [-z0 + o, y1], [-z1 + o, y1]], color);
    if (faces.includes('x'))
      this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0],
        [[z0 + o, y0], [z1 + o, y0], [z1 + o, y1], [z0 + o, y1]], color);
    if (faces.includes('Z'))
      this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1],
        [[x0 + o, y0], [x1 + o, y0], [x1 + o, y1], [x0 + o, y1]], color);
    if (faces.includes('z'))
      this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1],
        [[-x1 + o, y0], [-x0 + o, y0], [-x0 + o, y1], [-x1 + o, y1]], color);
    if (faces.includes('Y'))
      this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0],
        [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], color);
    if (faces.includes('y'))
      this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0],
        [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], color);
  }

  // Horizontal quad facing up (or down)
  hquad(x0, z0, x1, z1, y, up = true, color = WHITE) {
    if (up) this.quad([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], color);
    else this.quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], color);
  }

  // Vertical quad on a wall. axis 'x': plane x=c spanning z in [a,b]; 'z': plane z=c spanning x.
  // facing: +1 / -1 along the plane normal. uv: explicit [u0,v0,u1,v1] or null for meters.
  vquad(axis, c, a, b, y0, y1, facing, color = WHITE, uv = null) {
    const U = uv ? [uv[0], uv[2]] : null;
    const V = uv ? [uv[1], uv[3]] : [y0, y1];
    if (axis === 'x') {
      if (facing > 0) {
        // looking toward -x, right is -z: left edge is z=b
        const u = U || [-b, -a];
        this.quad([[c, y0, b], [c, y0, a], [c, y1, a], [c, y1, b]], [1, 0, 0], [[u[0], V[0]], [u[1], V[0]], [u[1], V[1]], [u[0], V[1]]], color);
      } else {
        const u = U || [a, b];
        this.quad([[c, y0, a], [c, y0, b], [c, y1, b], [c, y1, a]], [-1, 0, 0], [[u[0], V[0]], [u[1], V[0]], [u[1], V[1]], [u[0], V[1]]], color);
      }
    } else {
      if (facing > 0) {
        const u = U || [a, b];
        this.quad([[a, y0, c], [b, y0, c], [b, y1, c], [a, y1, c]], [0, 0, 1], [[u[0], V[0]], [u[1], V[0]], [u[1], V[1]], [u[0], V[1]]], color);
      } else {
        const u = U || [-b, -a];
        this.quad([[b, y0, c], [a, y0, c], [a, y1, c], [b, y1, c]], [0, 0, -1], [[u[0], V[0]], [u[1], V[0]], [u[1], V[1]], [u[0], V[1]]], color);
      }
    }
  }

  // Sloped floor quad (height varies along z): y0 at z0, y1 at z1
  slopeZ(x0, z0, x1, z1, y0, y1, color = WHITE) {
    const dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy);
    const n = [0, dz / len, -dy / len];
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y0, z0], [x0, y0, z0]], n, [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], color);
  }

  get empty() {
    return this.n === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const WHITE = [1, 1, 1];

export function hexToRGB(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// Pool of builders keyed by material name
export class Batches {
  constructor() {
    this.map = new Map();
  }
  get(key) {
    let b = this.map.get(key);
    if (!b) {
      b = new GeoBuilder();
      this.map.set(key, b);
    }
    return b;
  }
  toMeshes(materials, { castShadow = true, receiveShadow = true } = {}) {
    const out = [];
    for (const [key, b] of this.map) {
      if (b.empty) continue;
      const mat = materials[key];
      if (!mat) throw new Error('No material for batch ' + key);
      const m = new THREE.Mesh(b.build(), mat);
      m.name = key;
      m.castShadow = castShadow && !mat.userData.noShadow;
      m.receiveShadow = receiveShadow;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      out.push(m);
    }
    return out;
  }
}

// rect subtraction: returns list of rects covering a minus b
export function subtractRect(a, b) {
  const [ax0, az0, ax1, az1] = a;
  const [bx0, bz0, bx1, bz1] = b;
  if (bx1 <= ax0 || bx0 >= ax1 || bz1 <= az0 || bz0 >= az1) return [a];
  const out = [];
  if (bz0 > az0) out.push([ax0, az0, ax1, bz0]);
  if (bz1 < az1) out.push([ax0, bz1, ax1, az1]);
  const z0 = Math.max(az0, bz0), z1 = Math.min(az1, bz1);
  if (bx0 > ax0) out.push([ax0, z0, bx0, z1]);
  if (bx1 < ax1) out.push([bx1, z0, ax1, z1]);
  return out;
}

export function subtractRects(rects, holes) {
  let cur = rects.slice();
  for (const h of holes) {
    const next = [];
    for (const r of cur) next.push(...subtractRect(r, h));
    cur = next;
  }
  return cur.filter((r) => r[2] - r[0] > 1e-3 && r[3] - r[1] > 1e-3);
}

export const inRect = (r, x, z, m = 0) => x >= r[0] - m && x <= r[2] + m && z >= r[1] - m && z <= r[3] + m;
