// Room furnishings: classroom desks, lab benches, theatre seats, gym courts + bleachers,
// cafeteria tables, library stacks, lockers along the hallways, etc.
import * as THREE from 'three';
import { LEVEL_H, STAGE, rectW, wz, hy } from './layout.js';
import { Batches, GeoBuilder, hexToRGB, inRect, WHITE } from './geo.js';
import { rng, textTexture } from './textures.js';

// ---------------------------------------------------------------- instanced props
class Props {
  constructor() {
    this.types = new Map();
  }
  define(name, geometry, material) {
    this.types.set(name, { geometry, material, items: [] });
  }
  add(name, x, y, z, rot = 0, color = null, scale = null) {
    this.types.get(name).items.push({ x, y, z, rot, color, scale });
  }
  finalize(scene) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const [name, t] of this.types) {
      if (!t.items.length) continue;
      const mesh = new THREE.InstancedMesh(t.geometry, t.material, t.items.length);
      mesh.name = name;
      t.items.forEach((it, i) => {
        q.setFromAxisAngle(up, it.rot);
        p.set(it.x, it.y, it.z);
        if (it.scale) s.set(...it.scale);
        else s.set(1, 1, 1);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
        if (it.color) mesh.setColorAt(i, col.set(it.color));
        else if (mesh.instanceColor || t.items.some((o) => o.color)) mesh.setColorAt(i, col.set('#ffffff'));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
  }
}

// A meter of shelf: spines of varied width, height and color, 0.32 m tall
function booksTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 164;
  const g = c.getContext('2d');
  const r = rng(77);
  g.fillStyle = '#2a1e14';
  g.fillRect(0, 0, 512, 164);
  const cols = ['#8e2a2a', '#1f4f8f', '#2f6e45', '#c7962c', '#5a3f8a', '#e2dccb', '#2b2b2b', '#a85a2a', '#3f7f8f', '#7a1f3d'];
  for (let x = 0; x < 512; ) {
    const w = 10 + Math.floor(r() * 20);
    if (r() < 0.04) { x += w; continue; } // a gap on the shelf
    const h = 164 * (0.7 + r() * 0.3);
    const col = cols[Math.floor(r() * cols.length)];
    const lean = r() < 0.05 ? 3 : 0;
    g.fillStyle = col;
    g.fillRect(x + lean, 164 - h, w - 1, h);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x + lean, 164 - h, 2, h);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + lean + w - 3, 164 - h, 2, h);
    if (r() < 0.7) {
      g.fillStyle = r() < 0.5 ? 'rgba(235,215,150,0.85)' : 'rgba(255,255,255,0.7)';
      g.fillRect(x + lean + 2, 164 - h * 0.8, w - 5, 4);
      g.fillRect(x + lean + 2, 164 - h * 0.25, w - 5, 3);
    }
    x += w;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function protoGeo(fn) {
  const g = new GeoBuilder();
  fn(g);
  return g.build();
}

const C = (h) => hexToRGB(h);

// Colliders are kept to what you would actually bump into: desk and table tops, counters,
// benches, shelving, bleachers. Chairs and stools don't collide, so rooms stay walkable.
export function buildFurniture(scene, world, info, T, M) {
  const B = new Batches();
  const props = new Props();
  const R = rng(2024);
  const paint = B.get('paint');

  // ---- prototypes (origin at floor, "front" of a seated person faces local -z)
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.55, ...o });
  const vc = std({ vertexColors: true, roughness: 0.45, metalness: 0.1 });
  props.define('desk', protoGeo((g) => {
    g.box(-0.36, 0.7, -0.27, 0.36, 0.74, 0.27, C('#c9a36b'));
    for (const [x, z] of [[-0.32, -0.23], [0.32, -0.23], [-0.32, 0.23], [0.32, 0.23]]) g.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.7, z + 0.02, C('#4a4a4a'));
    g.box(-0.3, 0.55, -0.22, 0.3, 0.58, 0.2, C('#555555'));
  }), vc);
  props.define('chair', protoGeo((g) => {
    g.box(-0.21, 0.42, -0.2, 0.21, 0.46, 0.2, WHITE);
    g.box(-0.21, 0.46, 0.17, 0.21, 0.86, 0.21, WHITE);
    for (const [x, z] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) g.box(x - 0.015, 0, z - 0.015, x + 0.015, 0.42, z + 0.015, C('#333333'));
  }), vc);
  props.define('stool', protoGeo((g) => {
    g.box(-0.17, 0.62, -0.17, 0.17, 0.66, 0.17, WHITE);
    for (const [x, z] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) g.box(x - 0.015, 0, z - 0.015, x + 0.015, 0.62, z + 0.015, C('#3a3a3a'));
    g.box(-0.14, 0.25, -0.14, 0.14, 0.27, 0.14, C('#3a3a3a'));
  }), vc);
  props.define('seat', protoGeo((g) => {
    g.box(-0.25, 0.4, -0.22, 0.25, 0.5, 0.18, WHITE);
    g.box(-0.25, 0.45, 0.14, 0.25, 1.0, 0.22, WHITE);
    g.box(-0.27, 0, -0.1, -0.24, 0.65, 0.2, C('#2b2b2b'));
    g.box(0.24, 0, -0.1, 0.27, 0.65, 0.2, C('#2b2b2b'));
  }), vc);
  props.define('cafTable', protoGeo((g) => {
    g.box(-1.2, 0.72, -0.4, 1.2, 0.76, 0.4, C('#e8e2d2'));
    g.box(-1.1, 0, -0.05, 1.1, 0.72, 0.05, C('#8a8f95'));
    for (const zz of [-0.72, 0.72]) {
      g.box(-1.15, 0.43, zz - 0.14, 1.15, 0.47, zz + 0.14, C('#2a55b8'));
      g.box(-1.0, 0, zz - 0.04, 1.0, 0.43, zz + 0.04, C('#8a8f95'));
    }
  }), vc);
  // locker unit: 0.31 wide, 1.85 tall, 0.4 deep; front = local +z
  {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 6; i++) g.fillRect(14, 14 + i * 7, 36, 3);
    for (let i = 0; i < 6; i++) g.fillRect(14, 200 + i * 7, 36, 3);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(48, 110, 6, 28);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, 60, 252);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.BoxGeometry(0.31, 1.85, 0.4);
    geo.translate(0, 0.925 + 0.1, 0);
    const plain = std({ color: '#ffffff', roughness: 0.38, metalness: 0.45 });
    const front = std({ map: tex, roughness: 0.38, metalness: 0.45 });
    props.define('locker', geo, [plain, plain, plain, plain, front, plain]);
  }

  // ---- helpers
  const baseOf = (rm) => (rm.level === 0 ? 0 : LEVEL_H);
  // local frame with front wall on `side`; u along the wall, v into the room
  const frameOf = (rm, side) => {
    const [x0, z0, x1, z1] = rm.R;
    switch (side) {
      case 'N': return { W: x1 - x0, D: z1 - z0, rot: 0, at: (u, v) => [x0 + u, z0 + v] };
      case 'S': return { W: x1 - x0, D: z1 - z0, rot: Math.PI, at: (u, v) => [x1 - u, z1 - v] };
      case 'W': return { W: z1 - z0, D: x1 - x0, rot: Math.PI / 2, at: (u, v) => [x0 + v, z1 - u] };
      default: return { W: z1 - z0, D: x1 - x0, rot: -Math.PI / 2, at: (u, v) => [x1 - v, z0 + u] };
    }
  };
  const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const isExterior = (rm, side) => {
    const [x0, z0, x1, z1] = rm.R;
    const pt = { N: [(x0 + x1) / 2, z0 - 0.6], S: [(x0 + x1) / 2, z1 + 0.6], W: [x0 - 0.6, (z0 + z1) / 2], E: [x1 + 0.6, (z0 + z1) / 2] }[side];
    if (inRect(info.courtyard, pt[0], pt[1])) return true;
    if (rm.level === 1) return !info.level1Rects.some((r) => inRect(r, pt[0], pt[1]));
    return !info.blockAt(pt[0], pt[1]);
  };
  const nearDoor = (rm, x, z, r = 1.7) =>
    rm.doorList.some((d) => {
      const [dx, dz] = d.axis === 'z' ? [d.mid, d.c] : [d.c, d.mid];
      return Math.hypot(x - dx, z - dz) < r;
    });
  // teaching wall: opposite the door unless that wall has windows, then a side wall
  // (falls back to a door wall rather than covering windows)
  const frontSide = (rm) => {
    const doorSides = new Set(rm.doorList.map((d) => d.side));
    const d0 = rm.doorList[0] ? rm.doorList[0].side : 'N';
    const cands = [opposite[d0], ...(d0 === 'N' || d0 === 'S' ? ['W', 'E'] : ['N', 'S'])];
    return cands.find((s) => !doorSides.has(s) && !isExterior(rm, s)) || cands.find((s) => !isExterior(rm, s)) || opposite[d0];
  };
  // box in local frame (u0..u1, v0..v1) -> world
  const fbox = (f, u0, u1, v0, v1, y0, y1, color, key = 'paint', collide = false, tag = 9) => {
    const [ax, az] = f.at(u0, v0), [bx, bz] = f.at(u1, v1);
    const X0 = Math.min(ax, bx), X1 = Math.max(ax, bx), Z0 = Math.min(az, bz), Z1 = Math.max(az, bz);
    B.get(key).box(X0, y0, Z0, X1, y1, Z1, color);
    if (collide) world.add(X0, y0, Z0, X1, y1, Z1, tag);
  };
  const place = (name, f, u, v, y, rotOff = 0, color = null, scale = null) => {
    const [x, z] = f.at(u, v);
    props.add(name, x, y, z, f.rot + rotOff, color, scale);
  };
  const deskCollider = (f, u, v, y, hw = 0.36, hd = 0.27, top = 0.74) => {
    const [ax, az] = f.at(u - hw, v - hd), [bx, bz] = f.at(u + hw, v + hd);
    world.add(Math.min(ax, bx), y, Math.min(az, bz), Math.max(ax, bx), y + top, Math.max(az, bz), 9);
  };
  const chairColors = ['#d9722b', '#2f7fb8', '#3f9a57', '#aeb6c1', '#b8433a', '#6b5ba8'];
  const whiteboard = (rm, f, y, w = 3.6) => {
    let u0 = (f.W - w) / 2, u1 = u0 + w;
    // slide or shrink it clear of any door on the same wall
    for (const d of rm.doorList) {
      const [a0, b0] = [f.at(u0, 0.1), f.at(u1, 0.1)];
      const onWall = d.axis === 'z' ? Math.abs(a0[1] - d.c) < 0.3 : Math.abs(a0[0] - d.c) < 0.3;
      if (!onWall) continue;
      const lo = d.axis === 'z' ? Math.min(a0[0], b0[0]) : Math.min(a0[1], b0[1]);
      const hi = d.axis === 'z' ? Math.max(a0[0], b0[0]) : Math.max(a0[1], b0[1]);
      if (d.b + 0.3 < lo || d.a - 0.3 > hi) continue;
      // door center in u
      const du = [0, f.W].map((uu) => f.at(uu, 0.1)).map((p) => (d.axis === 'z' ? p[0] : p[1]));
      const uc = ((d.mid - du[0]) / (du[1] - du[0])) * f.W;
      const hw = (d.b - d.a) / 2 + 0.35;
      if (uc > f.W / 2) { u1 = Math.min(u1, uc - hw); u0 = Math.max(0.5, u1 - w); }
      else { u0 = Math.max(u0, uc + hw); u1 = Math.min(f.W - 0.5, u0 + w); }
    }
    if (u1 - u0 < 1.2) return;
    fbox(f, u0 - 0.05, u1 + 0.05, 0.1, 0.13, y + 0.85, y + 2.15, C('#9aa1a8'));
    fbox(f, u0, u1, 0.1, 0.145, y + 0.9, y + 2.1, C('#fbfbfb'));
    fbox(f, u0, u1, 0.1, 0.2, y + 0.86, y + 0.9, C('#9aa1a8'));
  };
  // side walls of a frame: the u=0 wall and the u=W wall, as plan sides
  const SIDE_U0 = { N: 'W', S: 'E', W: 'S', E: 'N' };
  const corkboard = (rm, f, front, y) => {
    const v0 = f.D * 0.35, v1 = Math.min(f.D - 0.8, v0 + 2.2);
    if (v1 - v0 < 1) return;
    const doorSides = new Set(rm.doorList.map((d) => d.side));
    const s0 = SIDE_U0[front], s1 = opposite[s0];
    const side = [s0, s1].find((sd) => !doorSides.has(sd) && !isExterior(rm, sd));
    if (!side) return;
    const [ua, ub, uc] = side === s0 ? [0.1, 0.13, 0.135] : [f.W - 0.13, f.W - 0.1, f.W - 0.135];
    fbox(f, ua, ub, v0, v1, y + 1.0, y + 2.0, C('#b88b58'));
    for (let i = 0; i < 4; i++) {
      const pv = v0 + 0.2 + R() * (v1 - v0 - 0.6);
      const col = ['#f7f3e8', '#ffd966', '#9fd3f0', '#f4a6a6'][i % 4];
      const [pa, pb] = side === s0 ? [ub, uc] : [uc, ua];
      fbox(f, pa, pb, pv, pv + 0.3, y + 1.2 + R() * 0.4, y + 1.6 + R() * 0.3, C(col));
    }
  };
  const clock = (f, y) => place('clock', f, f.W / 2, f.D - 0.125, y + 2.55);
  // vertical quad on the plane v = vPlane of frame f, facing -v (side -1) or +v (side 1)
  const fquad = (f, key, u0, u1, vPlane, y0, y1, side, uv) => {
    const [ax, az] = f.at(u0, vPlane), [bx, bz] = f.at(u1, vPlane), [nx, nz] = f.at(u0, vPlane + side);
    if (Math.abs(ax - bx) > Math.abs(az - bz)) B.get(key).vquad('z', az, Math.min(ax, bx), Math.max(ax, bx), y0, y1, Math.sign(nz - az), WHITE, uv);
    else B.get(key).vquad('x', ax, Math.min(az, bz), Math.max(az, bz), y0, y1, Math.sign(nx - ax), WHITE, uv);
  };
  const fcollide = (f, u0, u1, v0, v1, y0, y1, tag = 9) => {
    const [ax, az] = f.at(u0, v0), [bx, bz] = f.at(u1, v1);
    world.add(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), tag);
  };
  const clockTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#222'; g.stroke();
    g.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(64 + Math.cos(a) * 50 - 2, 64 + Math.sin(a) * 50 - 2, 4, 4);
    }
    g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 30); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(92, 64); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  {
    const g = new THREE.CircleGeometry(0.17, 24);
    g.rotateY(Math.PI); // face local -z
    props.define('clock', g, new THREE.MeshBasicMaterial({ map: clockTex }));
  }

  // ---- per-room furnishing
  for (const rm of info.rooms) {
    const y = baseOf(rm);
    const d0 = rm.doorList[0];
    const doorSide = d0 ? d0.side : 'N';
    const [x0, z0, x1, z1] = rm.R;
    const w = x1 - x0, d = z1 - z0;
    switch (rm.type) {
      case 'class':
      case 'music': {
        const front = frontSide(rm);
        const f = frameOf(rm, front);
        whiteboard(rm, f, y, Math.min(3.8, f.W - 1.4));
        corkboard(rm, f, front, y);
        clock(f, y);
        const col = chairColors[rm.idx % chairColors.length];
        if (rm.type === 'music') {
          // chairs in arcs facing the front
          for (let row = 0; row < 3; row++) {
            const rad = 2.6 + row * 1.2;
            for (let a = -1.1; a <= 1.1; a += 0.62 / rad) {
              const u = f.W / 2 + Math.sin(a) * rad, v = 1.4 + Math.cos(a) * rad;
              if (u < 0.5 || u > f.W - 0.5 || v > f.D - 0.6) continue;
              place('chair', f, u, v, y, a, col);
            }
          }
          fbox(f, 0.4, 1.9, 0.3, 0.9, y, y + 1.1, C('#141414'), 'paint', true);
          break;
        }
        // teacher desk
        {
          const tu = nearDoor(rm, ...f.at(f.W - 1.65, 1.4), 2.4) ? 1.65 : f.W - 1.65;
          fbox(f, tu - 0.75, tu + 0.75, 1.0, 1.75, y, y + 0.76, C('#7a5634'), 'paint', true);
          fbox(f, tu - 0.72, tu + 0.72, 0.97, 1.78, y + 0.76, y + 0.79, C('#3b3632'));
          place('chair', f, tu, 2.1, y, Math.PI, '#444444');
        }
        // desks in pairs with 1 m aisles between pairs and 1 m between rows
        const pairW = 1.46, aisle = 1.0, dv = 1.55;
        const np = Math.max(1, Math.floor((f.W - 1.2 + aisle) / (pairW + aisle)));
        const nv = Math.floor((f.D - 3.4) / dv);
        const su = (f.W - (np * pairW + (np - 1) * aisle)) / 2;
        for (let i = 0; i < np; i++)
          for (const k of [0, 1]) {
            const u = su + i * (pairW + aisle) + 0.365 + k * 0.73;
            for (let j = 0; j < nv; j++) {
              const v = 2.7 + j * dv;
              if (nearDoor(rm, ...f.at(u, v), 1.9) || nearDoor(rm, ...f.at(u, v + 0.45), 1.9)) continue;
              place('desk', f, u, v, y);
              place('chair', f, u, v + 0.45, y, (R() - 0.5) * 0.25, col);
              deskCollider(f, u, v, y);
            }
          }
        break;
      }
      case 'lab': {
        const f = frameOf(rm, frontSide(rm));
        whiteboard(rm, f, y, Math.min(3.8, f.W - 1.4));
        clock(f, y);
        // demo bench
        fbox(f, f.W / 2 - 1.3, f.W / 2 + 1.3, 1.1, 1.85, y, y + 0.92, C('#2a2a2a'), 'paint', true);
        const rows = Math.floor((f.D - 3.4) / 2.0);
        for (let j = 0; j < rows; j++) {
          const v = 3.0 + j * 2.0;
          for (const [ua, ub] of [[0.9, f.W / 2 - 0.6], [f.W / 2 + 0.6, f.W - 0.9]]) {
            if (ub - ua < 1.2) continue;
            if ([ua, (ua + ub) / 2, ub].some((uu) => nearDoor(rm, ...f.at(uu, v + 0.4), 2.0))) continue;
            fbox(f, ua, ub, v, v + 0.75, y, y + 0.86, C('#e9e6dc'), 'paint', true);
            fbox(f, ua - 0.03, ub + 0.03, v - 0.03, v + 0.78, y + 0.86, y + 0.92, C('#1c1c1c'));
            for (let u = ua + 0.4; u < ub - 0.2; u += 0.75) place('stool', f, u, v + 1.1, y, 0, '#1f5fae');
            fbox(f, (ua + ub) / 2 - 0.03, (ua + ub) / 2 + 0.03, v + 0.3, v + 0.36, y + 0.92, y + 1.25, C('#b0b5ba'));
          }
        }
        // counter + fume hood on the back wall
        fbox(f, 0.6, f.W - 0.6, f.D - 0.75, f.D - 0.1, y, y + 0.9, C('#d8d2c4'), 'paint', true);
        fbox(f, 0.6, 2.0, f.D - 0.9, f.D - 0.1, y + 0.9, y + 2.3, C('#c9ced3'), 'paint', true);
        fbox(f, 0.7, 1.9, f.D - 0.92, f.D - 0.9, y + 1.05, y + 1.9, C('#2a3b48'));
        break;
      }
      case 'art': {
        const f = frameOf(rm, frontSide(rm));
        whiteboard(rm, f, y, Math.min(3, f.W - 1.4));
        for (let v = 2.6; v < f.D - 1.8; v += 2.4)
          for (let u = 1.6; u < f.W - 1.4; u += 3.0) {
            fbox(f, u - 0.9, u + 0.9, v - 0.6, v + 0.6, y + 0.7, y + 0.78, C('#d9c8a3'), 'paint', true);
            fbox(f, u - 0.8, u - 0.72, v - 0.5, v + 0.5, y, y + 0.7, C('#555'));
            fbox(f, u + 0.72, u + 0.8, v - 0.5, v + 0.5, y, y + 0.7, C('#555'));
            for (const du of [-0.5, 0.5]) {
              place('stool', f, u + du, v - 0.95, y, Math.PI, '#e0a030');
              place('stool', f, u + du, v + 0.95, y, 0, '#e0a030');
            }
          }
        fbox(f, 0.6, f.W - 0.6, f.D - 0.7, f.D - 0.1, y, y + 0.9, C('#cfc6b2'), 'paint', true);
        break;
      }
      case 'office': {
        const f = frameOf(rm, opposite[doorSide]);
        if (rm.name === 'Main Office') {
          // front counter facing the door
          const g = frameOf(rm, doorSide);
          fbox(g, 1.0, g.W - 1.0, 2.2, 2.8, y, y + 1.1, C('#8b6b4a'), 'paint', true);
          fbox(g, 0.9, g.W - 0.9, 2.15, 2.85, y + 1.1, y + 1.15, C('#d8cfbf'));
        }
        const n = Math.max(1, Math.min(6, Math.floor((f.W * f.D) / 14)));
        for (let i = 0; i < n; i++) {
          const u = 1.3 + ((i % 3) * (f.W - 2.6)) / 2;
          const v = 1.3 + Math.floor(i / 3) * 2.8;
          if (v > f.D - 1 || nearDoor(rm, ...f.at(u, v), 2.0) || nearDoor(rm, ...f.at(u, v + 0.75), 1.6)) continue;
          fbox(f, u - 0.75, u + 0.75, v - 0.4, v + 0.4, y, y + 0.75, C('#6e5238'), 'paint', true);
          fbox(f, u - 0.25, u + 0.25, v - 0.1, v + 0.1, y + 0.75, y + 1.05, C('#222'));
          place('chair', f, u, v + 0.75, y, 0, '#3c3c3c');
        }
        fbox(f, f.W - 0.6, f.W - 0.1, f.D - 1.6, f.D - 0.2, y, y + 1.35, C('#8f959b'), 'paint', true);
        break;
      }
      case 'media': {
        const f = frameOf(rm, doorSide); // door on the south: stacks toward the back
        // circulation desk near the entrance
        fbox(f, f.W / 2 - 2.5, f.W / 2 + 2.5, 3.0, 3.8, y, y + 1.05, C('#7a5634'), 'paint', true);
        // tables
        for (let v = 6; v < f.D * 0.5; v += 2.8)
          for (let u = 3; u < f.W - 2.5; u += 4) {
            fbox(f, u - 1.0, u + 1.0, v - 0.55, v + 0.55, y + 0.72, y + 0.77, C('#c9a36b'), 'paint', true);
            fbox(f, u - 0.9, u + 0.9, v - 0.05, v + 0.05, y, y + 0.72, C('#555'));
            for (const du of [-0.55, 0.55]) {
              place('chair', f, u + du, v - 0.85, y, Math.PI, '#2f7fb8');
              place('chair', f, u + du, v + 0.85, y, 0, '#2f7fb8');
            }
          }
        // double-sided bookshelves; the books are a spine texture on both faces
        for (let v = f.D * 0.55; v < f.D - 1.2; v += 1.9)
          for (let u = 1.5; u < f.W - 3; u += 5.5) {
            fbox(f, u, u + 4.5, v, v + 0.45, y, y + 1.7, C('#8b6b4a'), 'paint', true);
            fbox(f, u - 0.02, u + 4.52, v - 0.02, v + 0.47, y + 1.7, y + 1.74, C('#6e5238'));
            for (let s = 0; s < 4; s++) {
              const y0 = y + 0.07 + s * 0.4, off = R() * 8;
              fquad(f, 'books', u + 0.05, u + 4.45, v - 0.004, y0, y0 + 0.32, -1, [off, 0, off + 4.4, 1]);
              fquad(f, 'books', u + 0.05, u + 4.45, v + 0.454, y0, y0 + 0.32, 1, [off + 3, 0, off + 7.4, 1]);
            }
          }
        break;
      }
      case 'dining': {
        // tables in rows with walkable gaps; benches are low enough to step over
        const f = frameOf(rm, 'W');
        for (let v = 2.8; v < f.D - 1.8; v += 3.6)
          for (let u = 2.2; u < f.W - 1.8; u += 3.4) {
            if (nearDoor(rm, ...f.at(u, v), 2.6)) continue;
            place('cafTable', f, u, v, y, Math.PI / 2);
            fcollide(f, u - 0.4, u + 0.4, v - 1.2, v + 1.2, y, y + 0.76);
            for (const s of [-1, 1]) fcollide(f, u + s * 0.72 - 0.14, u + s * 0.72 + 0.14, v - 1.15, v + 1.15, y, y + 0.47);
          }
        break;
      }
      case 'kitchen': {
        const f = frameOf(rm, 'N');
        if (rm.name === 'Serving Line') {
          for (const u of [3.0, f.W - 3.6]) {
            fbox(f, u, u + 0.9, 3.5, f.D - 3.5, y, y + 0.92, C('#c7ccd1'), 'paint', true);
            fbox(f, u + 0.2, u + 0.25, 3.5, f.D - 3.5, y + 1.0, y + 1.45, C('#aac8d6'));
          }
        } else {
          // kitchen: counters on the far wall, a prep island, walk-in cooler in the corner
          const g = frameOf(rm, opposite[doorSide]);
          fbox(g, 0.2, g.W - 0.2, 0.2, 1.0, y, y + 0.92, C('#c7ccd1'), 'paint', true);
          if (g.D > 6) fbox(g, 3, g.W - 3, g.D / 2 - 0.6, g.D / 2 + 0.6, y, y + 0.92, C('#c7ccd1'), 'paint', true);
          if (g.W > 8) fbox(g, g.W - 3.4, g.W - 0.2, 1.2, 4.0, y, y + 2.4, C('#dfe3e6'), 'paint', true);
        }
        break;
      }
      case 'lav': {
        const f = frameOf(rm, opposite[doorSide]);
        const n = Math.max(1, Math.floor((f.W - 0.6) / 0.95));
        for (let i = 0; i <= n; i++) fbox(f, 0.3 + i * 0.95, 0.33 + i * 0.95, 0.1, 1.6, y + 0.3, y + 2.0, C('#6f8fa6'), 'paint', true);
        for (let i = 0; i < n; i++) {
          fbox(f, 0.33 + i * 0.95, 0.3 + (i + 1) * 0.95, 1.57, 1.6, y + 0.3, y + 2.0, C('#86a5ba'));
          fbox(f, 0.55 + i * 0.95, 1.05 + i * 0.95, 0.12, 0.6, y, y + 0.45, C('#f5f5f5'));
        }
        const cu1 = f.W / 2 - 1.0;
        if (f.D > 3.6 && cu1 - 0.4 > 1.2) {
          fbox(f, 0.4, cu1, f.D - 0.65, f.D - 0.1, y + 0.8, y + 0.88, C('#d7d2c6'), 'paint', true);
          fbox(f, 0.4, cu1, f.D - 0.13, f.D - 0.1, y + 1.1, y + 1.9, C('#dfeff5'));
        }
        break;
      }
      case 'locker':
      case 'weights': {
        const f = frameOf(rm, opposite[doorSide]);
        if (rm.type === 'weights') {
          for (let v = 2; v < f.D - 1.5; v += 2.6)
            for (let u = 1.5; u < f.W - 1.5; u += 3) {
              fbox(f, u - 0.2, u + 0.2, v - 0.7, v + 0.7, y, y + 0.45, C('#222'), 'paint', true);
              fbox(f, u - 1.1, u + 1.1, v - 0.8, v - 0.75, y + 1.0, y + 1.05, C('#9aa'));
              fbox(f, u - 1.0, u - 0.95, v - 1.0, v - 0.6, y, y + 1.6, C('#444'));
              fbox(f, u + 0.95, u + 1.0, v - 1.0, v - 0.6, y, y + 1.6, C('#444'));
            }
          break;
        }
        const lockerCol = rm.name.includes('Girls') ? '#aeb6c1' : '#2a55b8';
        for (let u = 0.4; u < f.W - 0.4; u += 0.32) place('locker', f, u, 0.33, y - 0.1, 0, lockerCol);
        fcollide(f, 0.25, f.W - 0.25, 0.1, 0.55, y, y + 2.0);
        for (let v = 2.2; v < f.D - 1.2; v += 2.4) fbox(f, 1.0, f.W - 1.0, v - 0.18, v + 0.18, y + 0.4, y + 0.46, C('#b98b52'), 'paint', true);
        break;
      }
      case 'storage': {
        if (rm.name === 'Backstage') break;
        const f = frameOf(rm, opposite[doorSide]);
        fbox(f, 0.2, f.W - 0.2, 0.1, 0.6, y, y + 2.0, C('#7d8288'), 'paint', true);
        for (let s = 0; s < 4; s++)
          for (let u = 0.4; u < f.W - 0.6; u += 0.7) if (R() < 0.7) fbox(f, u, u + 0.5, 0.15, 0.55, y + 0.05 + s * 0.5, y + 0.05 + s * 0.5 + 0.3, C('#b9936a'));
        break;
      }
      case 'lecture': {
        // curved rows around the front corner (southwest on the plan)
        const cx = x0 + 1.0, cz = z1 - 1.0;
        fbox(frameOf(rm, 'S'), w - 3.2, w - 2.4, 0.4, 1.0, y, y + 1.15, C('#6e5238'), 'paint', true);
        for (let rad = 4.0; rad < Math.min(w, d) * 1.05; rad += 1.25) {
          for (let a = 0.08; a < Math.PI / 2 - 0.05; a += 0.62 / rad) {
            const x = cx + Math.sin(a) * rad, z = cz - Math.cos(a) * rad;
            if (!inRect([x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5], x, z)) continue;
            // face toward the corner
            props.add('chair', x, y, z, Math.atan2(x - cx, z - cz), '#8a4040');
          }
        }
        const f = frameOf(rm, 'W');
        fbox(f, 0.8, 4.5, 0.1, 0.13, y + 0.9, y + 2.1, C('#fbfbfb'));
        break;
      }
      case 'gym':
        buildGym(rm);
        break;
      case 'theatre':
        buildTheatre(rm);
        break;
      case 'pool':
        buildPoolDeck(rm);
        break;
    }
  }

  // ---- lockers along hallway walls
  const roomsByLevel = [info.rooms.filter((r) => r.level === 0), info.rooms.filter((r) => r.level === 1)];
  const inAnyRoom = (lv, x, z) => roomsByLevel[lv].some((r) => inRect(r.R, x, z));
  const inLevel = (lv, x, z) => (lv === 1 ? info.level1Rects.some((r) => inRect(r, x, z)) : info.blockRects.some((b) => inRect(b.r, x, z)));
  const doorsOnLine = (lv, axis, c) => {
    const out = [];
    for (const r of roomsByLevel[lv]) for (const d of r.doorList) if (d.axis === axis && Math.abs(d.c - c) < 0.05) out.push([d.a - 0.45, d.b + 0.45]);
    for (const e of info.entrances) if (lv === 0 && e.axis === axis && Math.abs(e.c - c) < 0.05) out.push([e.a - 0.5, e.b + 0.5]);
    return out;
  };
  const stairRects = info.stairs.map((s) => s.R);
  for (const rm of info.rooms) {
    if (!['class', 'lab', 'art', 'music'].includes(rm.type)) continue;
    const y = baseOf(rm);
    const col = rm.idx % 2 ? '#2a55b8' : '#aeb6c1';
    for (const d of rm.doorList) {
      const [x0, z0, x1, z1] = rm.R;
      const horiz = d.axis === 'z';
      const a = horiz ? x0 : z0, b = horiz ? x1 : z1;
      // hallway must be at least 3m wide here
      const mid = (a + b) / 2;
      const probe = horiz ? [mid, d.c + d.out * 2.6] : [d.c + d.out * 2.6, mid];
      const probe2 = horiz ? [mid, d.c + d.out * 1.0] : [d.c + d.out * 1.0, mid];
      if (!inLevel(rm.level, ...probe) || inAnyRoom(rm.level, ...probe) || inAnyRoom(rm.level, ...probe2)) continue;
      const blocked = doorsOnLine(rm.level, d.axis, d.c);
      let runStart = null;
      const flush = (s, e) => {
        if (e - s < 0.6) return;
        const c0 = d.c + d.out * 0.1, c1 = d.c + d.out * 0.52;
        if (horiz) world.add(s, y, Math.min(c0, c1), e, y + 2.0, Math.max(c0, c1), 10);
        else world.add(Math.min(c0, c1), y, s, Math.max(c0, c1), y + 2.0, e, 10);
      };
      for (let t = a + 0.45; t < b - 0.45; t += 0.32) {
        const ok = !blocked.some(([ba, bb]) => t + 0.16 > ba && t - 0.16 < bb) &&
          !stairRects.some((sr) => inRect(sr, ...(horiz ? [t, d.c + d.out * 1.0] : [d.c + d.out * 1.0, t])));
        if (ok) {
          if (runStart === null) runStart = t - 0.16;
          const lx = horiz ? t : d.c + d.out * 0.31;
          const lz = horiz ? d.c + d.out * 0.31 : t;
          const rot = horiz ? (d.out > 0 ? 0 : Math.PI) : d.out > 0 ? Math.PI / 2 : -Math.PI / 2;
          props.add('locker', lx, y, lz, rot, col);
        } else if (runStart !== null) {
          flush(runStart, t - 0.16);
          runStart = null;
        }
      }
      if (runStart !== null) flush(runStart, b - 0.45);
    }
  }

  // ---- gyms
  function courtLines(cx, cz, len, wid, y, alongZ) {
    const lines = B.get('paint');
    const col = C('#f7f7f7');
    const P = (u, v) => (alongZ ? [cx + v, cz + u] : [cx + u, cz + v]); // u along length
    const seg = (u0, v0, u1, v1, t = 0.05) => {
      const [ax, az] = P(u0, v0), [bx, bz] = P(u1, v1);
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * t, nz = (dx / L) * t;
      lines.quad([[ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
    };
    const arc = (cu, cv, r, a0, a1) => {
      const n = 28;
      for (let i = 0; i < n; i++) {
        const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
        seg(cu + Math.cos(t0) * r, cv + Math.sin(t0) * r, cu + Math.cos(t1) * r, cv + Math.sin(t1) * r);
      }
    };
    const L2 = len / 2, W2 = wid / 2;
    seg(-L2, -W2, L2, -W2); seg(-L2, W2, L2, W2); seg(-L2, -W2, -L2, W2); seg(L2, -W2, L2, W2);
    seg(0, -W2, 0, W2);
    arc(0, 0, 1.8, 0, Math.PI * 2);
    for (const s of [-1, 1]) {
      const bu = s * L2;
      // key (painted)
      const [kx0, kz0] = P(bu, -2.45), [kx1, kz1] = P(bu - s * 5.8, 2.45);
      B.get('paint').hquad(Math.min(kx0, kx1), Math.min(kz0, kz1), Math.max(kx0, kx1), Math.max(kz0, kz1), y - 0.004, true, C('#2a55b8'));
      seg(bu, -2.45, bu - s * 5.8, -2.45); seg(bu, 2.45, bu - s * 5.8, 2.45); seg(bu - s * 5.8, -2.45, bu - s * 5.8, 2.45);
      arc(bu - s * 5.8, 0, 1.8, 0, Math.PI * 2);
      // three point line
      const hu = bu - s * 1.6;
      seg(bu, -6.7, hu, -6.7); seg(bu, 6.7, hu, 6.7);
      const a = Math.asin(6.7 / 6.75);
      if (s > 0) arc(hu, 0, 6.75, Math.PI - a, Math.PI + a);
      else arc(hu, 0, 6.75, -a, a);
    }
  }
  function hoop(x, z, y, facing, alongZ) {
    // facing: +1 / -1 direction toward the court center along the length axis
    const g = paint;
    const off = (u) => (alongZ ? [x, z + u * facing] : [x + u * facing, z]);
    const [bx, bz] = off(0);
    // backboard
    if (alongZ) g.box(bx - 0.9, y + 2.9, bz - 0.03, bx + 0.9, y + 3.95, bz + 0.03, C('#f4f4f4'));
    else g.box(bx - 0.03, y + 2.9, bz - 0.9, bx + 0.03, y + 3.95, bz + 0.9, C('#f4f4f4'));
    const [sx, sz] = off(-0.8);
    g.box(sx - 0.08, y + 3.9, sz - 0.08, sx + 0.08, y + 7.0, sz + 0.08, C('#555'));
    const [rx, rz] = off(0.38);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 6, 20), std({ color: '#e05a1c', metalness: 0.6, roughness: 0.35 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(rx, y + 3.05, rz);
    scene.add(rim);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.4, 12, 1, true), std({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    net.position.set(rx, y + 2.85, rz);
    scene.add(net);
  }
  function banner(x, y, z, rotY, lines, w = 3, h = 4) {
    const tex = textTexture(lines, { w: 256, h: 340, bg: '#1f3f8f', fg: '#e8edf4', font: 'Georgia, serif' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std({ map: tex, roughness: 0.85 }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
  }
  function buildGym(rm) {
    const [x0, z0, x1, z1] = rm.R;
    const main = rm.name === 'Main Gym';
    const y = 0.04;
    const alongZ = z1 - z0 >= x1 - x0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const len = main ? 28.6 : 24, wid = main ? 15.2 : 13;
    courtLines(cx, cz, len, wid, y, alongZ);
    const L2 = len / 2 + 1.2;
    if (alongZ) { hoop(cx, cz - L2, 0, 1, true); hoop(cx, cz + L2, 0, -1, true); }
    else { hoop(cx - L2, cz, 0, 1, false); hoop(cx + L2, cz, 0, -1, false); }
    // side hoops (cross courts) on the main gym
    if (main) {
      const wx0 = x0 + 0.25, wx1 = x1 - 0.25;
      for (const zz of [cz - 8, cz + 8]) {
        paint.box(wx1 - 0.05, 2.9, zz - 0.9, wx1, 3.95, zz + 0.9, C('#f4f4f4'));
      }
      // bleachers along the west wall (retractable, pulled out)
      const rows = 7, depth = 0.8, rise = 0.42;
      const cuts = rm.doorList.filter((dd) => dd.side === 'W').map((dd) => [dd.a - 1.5, dd.b + 1.5]);
      const spans = [];
      let s0 = z0 + 3;
      for (const [ca, cb] of cuts.sort((p, q) => p[0] - q[0])) {
        if (ca > s0 + 2) spans.push([s0, ca]);
        s0 = Math.max(s0, cb);
      }
      if (z1 - 3 > s0 + 2) spans.push([s0, z1 - 3]);
      for (const [sa, sb] of spans)
        for (let i = 0; i < rows; i++) {
          const bx1 = wx0 + (rows - i) * depth;
          const top = (i + 1) * rise;
          // each row only fills its own strip, so no faces overlap
          B.get('wood').box(i === rows - 1 ? wx0 : bx1 - depth, 0, sa, bx1, top, sb, C('#d8b27a'), 'XYzZ');
          world.add(wx0, 0, sa, bx1, top, sb, 11);
          paint.box(bx1, top - 0.4, sa, bx1 + 0.012, top - 0.02, sb, C('#2a55b8'), 'X');
        }
      banner(x1 - 0.15, 6.8, cz - 6, -Math.PI / 2, [{ text: 'WW-P', size: 0.25 }, { text: 'NORTH', size: 0.25 }, { text: 'KNIGHTS', size: 0.3 }]);
      banner(x1 - 0.15, 6.8, cz + 6, -Math.PI / 2, [{ text: 'HOME OF', size: 0.2 }, { text: 'THE', size: 0.15 }, { text: 'KNIGHTS', size: 0.3 }]);
      // scoreboard on the north wall
      const sb = textTexture([{ text: 'HOME  00   GUEST  00', size: 0.34, font: 'monospace', color: '#ff5533' }, { text: 'KNIGHTS', size: 0.3, color: '#d5dde8' }], { w: 1024, h: 320, bg: '#111', border: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.9), new THREE.MeshBasicMaterial({ map: sb }));
      m.position.set(cx, 6.5, z0 + 0.13);
      scene.add(m);
    } else {
      banner(x0 + 0.15, 5.5, cz, Math.PI / 2, [{ text: 'GO', size: 0.25 }, { text: 'KNIGHTS', size: 0.3 }], 3, 3.5);
    }
    // wall padding under the hoops
    for (const zz of alongZ ? [z0 + 0.14, z1 - 0.14] : []) paint.box(cx - 6, 0, zz - 0.05, cx + 6, 1.9, zz + 0.05, C('#2a55b8'));
  }

  function buildTheatre(rm) {
    const [x0, z0, x1] = rm.R;
    const houseTop = wz(hy(830)), houseBot = wz(hy(960));
    const floorY = (z) => (z <= houseTop ? 0 : z >= houseBot ? -1.4 : (-1.4 * (z - houseTop)) / (houseBot - houseTop));
    const aisle = 1.5;
    const secs = [[x0 + aisle, (x0 + x1) / 2 - 0.8], [(x0 + x1) / 2 + 0.8, x1 - aisle]];
    for (let z = houseTop + 0.6; z < houseBot - 0.2; z += 0.95) {
      const y = floorY(z + 0.3);
      for (const [a, b] of secs) {
        for (let x = a + 0.28; x < b - 0.2; x += 0.56) props.add('seat', x, y, z, Math.PI, '#8e1f2c');
        world.add(a, y - 0.2, z - 0.25, b, y + 0.85, z + 0.25, 12);
      }
    }
    // stage stairs at both sides of the orchestra
    const st = rectW(STAGE);
    for (const [sx0, sx1] of [[x0 + 2.4, x0 + 3.7], [x1 - 3.7, x1 - 2.4]]) {
      for (let k = 0; k < 4; k++) {
        const top = -1.4 + (k + 1) * 0.35;
        const za = st[1] - 0.45 * (4 - k);
        B.get('wood').box(sx0, -1.4, za, sx1, top, st[1], C('#3d2a1c'));
        world.add(sx0, -1.4, za, sx1, top, st[1], 13);
      }
    }
    // proscenium + curtains
    const stZ = st[1];
    const dark = C('#1d1a1a');
    paint.box(x0, 0, stZ - 0.1, x0 + 2.2, 10, stZ + 0.3, dark);
    paint.box(x1 - 2.2, 0, stZ - 0.1, x1, 10, stZ + 0.3, dark);
    paint.box(x0, 7.2, stZ - 0.1, x1, 14, stZ + 0.3, dark);
    world.add(x0, 0, stZ - 0.1, x0 + 2.2, 10, stZ + 0.3, 14);
    world.add(x1 - 2.2, 0, stZ - 0.1, x1, 10, stZ + 0.3, 14);
    const curtain = std({ color: '#7d1320', roughness: 0.95, side: THREE.DoubleSide });
    const pleat = (w, h) => {
      const g = new THREE.PlaneGeometry(w, h, 24, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.08);
      g.computeVertexNormals();
      return g;
    };
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(pleat(3.2, 7.1), curtain);
      m.position.set(s < 0 ? x0 + 2.2 + 1.6 : x1 - 2.2 - 1.6, 3.6, stZ + 0.6);
      scene.add(m);
    }
    const val = new THREE.Mesh(pleat(x1 - x0 - 4.4, 1.2), curtain);
    val.position.set((x0 + x1) / 2, 6.6, stZ + 0.35);
    scene.add(val);
    // cyclorama
    const cyc = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 1, 9), new THREE.MeshBasicMaterial({ color: '#3a4d7a' }));
    cyc.position.set((x0 + x1) / 2, 4.6, st[3] - 0.25);
    cyc.rotation.y = Math.PI;
    scene.add(cyc);
    // light pipes
    for (const zz of [z0 + 6, z0 + 14]) paint.box(x0 + 1, 8.6, zz - 0.05, x1 - 1, 8.7, zz + 0.05, C('#222'));
  }

  function buildPoolDeck(rm) {
    const [x0, , x1, z1] = rm.R;
    const pit = info.poolPit;
    // bleachers on the south deck
    const rows = 5, depth = 0.8, rise = 0.42;
    const xc = (x0 + x1) / 2;
    for (const [bxa, bxb] of [[x0 + 3, xc - 2.2], [xc + 2.2, x1 - 3]])
      for (let i = 0; i < rows; i++) {
        const bz0 = z1 - 0.15 - (rows - i) * depth;
        const top = (i + 1) * rise;
        B.get('paint').box(bxa, 0, bz0, bxb, top, i === rows - 1 ? z1 - 0.15 : bz0 + depth, C(i % 2 ? '#aeb6c1' : '#2a55b8'), 'xXYz');
        world.add(bxa, 0, bz0, bxb, top, z1 - 0.15, 11);
      }
    // lifeguard chair
    const lx = pit[0] - 1.6, lz = (pit[1] + pit[3]) / 2;
    paint.box(lx - 0.4, 0, lz - 0.4, lx + 0.4, 1.8, lz + 0.4, C('#f4f4f4'));
    paint.box(lx - 0.45, 1.8, lz - 0.45, lx + 0.45, 2.3, lz + 0.45, C('#d8352a'));
    world.add(lx - 0.45, 0, lz - 0.45, lx + 0.45, 2.3, lz + 0.45, 9);
    // banner
    banner(rm.R[0] + 0.15, 3.0, (rm.R[1] + rm.R[3]) / 2, Math.PI / 2, [{ text: 'KNIGHTS', size: 0.28 }, { text: 'SWIM', size: 0.22 }, { text: '& DIVE', size: 0.2 }], 2.4, 2.4);
  }

  // ---- materials + finalize
  const materials = { paint: M.paint, wood: M.wood, books: std({ map: booksTexture(), roughness: 0.75 }) };
  for (const m of B.toMeshes(materials)) scene.add(m);
  props.finalize(scene);
}
