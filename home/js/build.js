// Turns layout.js into meshes, lights and collision boxes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GRID, WALL_H, GARAGE_H, HOUSE, GARAGE, ROOMS, OPENINGS, FURNITURE, STREET_Z, SIDEWALK_Z, YARD } from './layout.js';

const TEX = '../assets/textures/';
const CARS = '../assets/models/cars/';

// ---------- textures and materials ----------

const loader = new THREE.TextureLoader();

function photo(file, { srgb = false } = {}) {
  const t = loader.load(TEX + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Lap siding: boards 0.15 m tall, one 1.2 m tile.
const sidingTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 32) {
    g.fillStyle = '#d6cbb3';
    g.fillRect(0, y + 28, s, 4);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(0, y, s, 3);
  }
});

// Floor tile: 0.6 m squares, two per 1.2 m tile.
const tileTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#f2f1ed';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#b9b4aa';
  g.fillRect(0, 0, s, 3);
  g.fillRect(0, 0, 3, s);
  g.fillRect(s / 2 - 2, 0, 4, s);
  g.fillRect(0, s / 2 - 2, s, 4);
});

// Garage door: horizontal panel grooves.
const grooveTex = canvasTex(128, (g, s) => {
  g.fillStyle = '#f2f1ec';
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 32) {
    g.fillStyle = '#b8b5ad';
    g.fillRect(0, y, s, 3);
  }
});

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });

const M = {
  drywall: std('#efeadf', { roughness: 0.95 }),
  siding: std('#f6ecdb', { map: sidingTex }),
  wood: std('#7b5536', { roughness: 0.55 }),
  light: std('#d2b48c', { roughness: 0.6 }),
  white: std('#f5f5f2'),
  trim: std('#fbfaf6', { roughness: 0.5 }),
  frontDoor: std('#2b4a7a', { roughness: 0.5 }),
  door: std('#f1ece2', { roughness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({ color: '#a9d3ee', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false }),
  bedding: std('#dfe6ee', { roughness: 0.95 }),
  fabric: std('#4e6f8e', { roughness: 1 }),
  counter: std('#d8d5cf', { roughness: 0.3 }),
  steel: std('#b9c0c8', { roughness: 0.3, metalness: 0.8 }),
  dark: std('#2b2d33', { roughness: 0.35 }),
  tub: std('#f4f5f4', { roughness: 0.25 }),
  plant: std('#3f7a3a', { roughness: 0.9 }),
  rugBlue: std('#5b718f', { roughness: 1 }),
  rugGray: std('#8f8c86', { roughness: 1 }),
  roof: std('#4a4f57', { roughness: 0.85, side: THREE.DoubleSide }),
  garageDoor: std('#ffffff', { map: grooveTex, roughness: 0.6, side: THREE.DoubleSide }),
  trunk: std('#5b4331'),
  leaves: std('#4f7f3d', { flatShading: true, roughness: 0.9 }),
  shrub: std('#3c6b35', { roughness: 0.9 }),
  mailbox: std('#2f4f7a'),
  // Photo textures from the repo's CC0 set (see assets/textures/CREDITS.md).
  carpet: std('#d4cfc4', { map: photo('carpet.jpg', { srgb: true }), normalMap: photo('carpet_n.jpg'), roughness: 1 }),
  woodFloor: std('#ffffff', { map: photo('wood.jpg', { srgb: true }), normalMap: photo('wood_n.jpg'), roughness: 0.6 }),
  tileFloor: std('#ffffff', { map: tileTex, roughness: 0.35 }),
  concrete: std('#ffffff', { map: photo('concrete.jpg', { srgb: true }), normalMap: photo('concrete_n.jpg'), roughness: 0.9 }),
  ceiling: std('#ffffff', { map: photo('ceiling.jpg', { srgb: true }), normalMap: photo('ceiling_n.jpg'), roughness: 1, side: THREE.DoubleSide }),
  lawn: std('#ffffff', { map: photo('grass.jpg', { srgb: true }), normalMap: photo('grass_n.jpg'), roughness: 1 }),
  asphalt: std('#ffffff', { map: photo('asphalt.jpg', { srgb: true }), normalMap: photo('asphalt_n.jpg'), roughness: 0.95 }),
  fixture: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 2 }),
};
const FLOOR_MAT = { carpet: M.carpet, wood: M.woodFloor, tile: M.tileFloor, concrete: M.concrete };
const FLOOR_TILE = { carpet: 2, wood: 2, tile: 1.2, concrete: 3 };

// ---------- geometry helpers ----------

// Scale the UVs of a box or plane so the texture repeats once per `tile` meters.
function boxGeo(w, h, d, tile = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z, four vertices each.
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * du / tile, uv.getY(i) * dv / tile);
      }
    }
    uv.needsUpdate = true;
  }
  return g;
}

function planeGeo(w, h, tile = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  if (tile) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tile);
    uv.needsUpdate = true;
  }
  return g;
}

// A rectangle in plan [x0, z0, x1, z1] as a flat mesh at height y.
function flat(rect, y, material, tile = 0, parent) {
  const [x0, z0, x1, z1] = rect;
  const m = new THREE.Mesh(planeGeo(x1 - x0, z1 - z0, tile), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Axis-aligned box from min/max corners.
function boxMesh(min, max, material, parent, { tile = 0, cast = true } = {}) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  const m = new THREE.Mesh(boxGeo(w, h, d, tile), material);
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Deterministic random so the yard looks the same on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- walls ----------

// Walls between rooms and between a room and the outside, one segment per
// run along a grid line. axis 'x' is a wall along x at z = c; 'z' along z at x = c.
function wallSegments() {
  const NX = Math.round((GARAGE.x1) / GRID);
  const NZ = Math.round(HOUSE.z1 / GRID);
  const id = new Int16Array(NX * NZ).fill(-1);
  ROOMS.forEach((r, ri) => {
    const [x0, z0, x1, z1] = r.rect;
    for (let k = Math.round(z0 / GRID); k < Math.round(z1 / GRID); k++) {
      for (let i = Math.round(x0 / GRID); i < Math.round(x1 / GRID); i++) id[i + k * NX] = ri;
    }
  });
  const at = (i, k) => (i < 0 || k < 0 || i >= NX || k >= NZ ? -1 : id[i + k * NX]);

  const segs = [];
  const scan = (count, pairAt, axis, lineAt) => {
    for (let line = 0; line <= count.lines; line++) {
      let run = null;
      const flush = () => { if (run) segs.push(run); run = null; };
      for (let s = 0; s < count.span; s++) {
        const [p, q] = pairAt(line, s);
        if (p === q) { flush(); continue; }
        if (run && run.p === p && run.q === q) run.b = (s + 1) * GRID;
        else { flush(); run = { axis, c: line * GRID, a: s * GRID, b: (s + 1) * GRID, p, q }; }
      }
      flush();
    }
  };
  // Walls along x: between row k-1 (below) and row k (above).
  scan({ lines: NZ, span: NX }, (k, i) => [at(i, k - 1), at(i, k)], 'x');
  // Walls along z: between column i-1 (left) and column i (right).
  scan({ lines: NX, span: NZ }, (i, k) => [at(i - 1, k), at(i, k)], 'z');
  for (const s of segs) s.ext = s.p === -1 || s.q === -1;
  return segs;
}

function holesFor(seg, used) {
  const holes = [];
  for (const op of OPENINGS) {
    if (op.axis !== seg.axis || Math.abs(op.c - seg.c) > 0.01) continue;
    const a0 = Math.max(seg.a, op.a), a1 = Math.min(seg.b, op.b);
    if (a1 - a0 < 1e-3) continue;
    used.add(op);
    const bottom = op.kind === 'arch' ? 0 : (op.bottom ?? 0);
    const top = op.kind === 'arch' ? WALL_H : (op.top ?? 2.1);
    holes.push({ a0, a1, bottom, top, op });
  }
  return holes.sort((u, v) => u.a0 - v.a0);
}

// Splits one wall segment into boxes around its openings.
function wallBoxes(seg, holes) {
  const t = seg.ext ? 0.24 : 0.12;
  const out = [];
  const box = (u0, u1, y0, y1) => {
    if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return;
    const half = t / 2;
    out.push(seg.axis === 'x'
      ? { min: [u0, y0, seg.c - half], max: [u1, y1, seg.c + half] }
      : { min: [seg.c - half, y0, u0], max: [seg.c + half, y1, u1] });
  };
  let cur = seg.a - t / 2;
  for (const h of holes) {
    box(cur, h.a0, 0, WALL_H);
    if (h.bottom > 0) box(h.a0, h.a1, 0, h.bottom);
    if (h.top < WALL_H) box(h.a0, h.a1, h.top, WALL_H);
    cur = h.a1;
  }
  box(cur, seg.b + t / 2, 0, WALL_H);
  return { boxes: out, t };
}

// ---------- openings ----------

function trimBox(axis, c, min, max, parent) {
  // Trim is a thin box on the wall line; for x walls min/max are [x, y] pairs.
  const half = 0.07;
  if (axis === 'x') boxMesh([min[0], min[1], c - half], [max[0], max[1], c + half], M.trim, parent);
  else boxMesh([c - half, min[1], min[0]], [c + half, max[1], max[0]], M.trim, parent);
}

function buildWindow(op, parent) {
  const { axis, c, a, b } = op;
  const bottom = op.bottom ?? 0.9;
  const top = op.top ?? 2.1;
  const pane = axis === 'x'
    ? [[a, bottom, c - 0.02], [b, top, c + 0.02]]
    : [[c - 0.02, bottom, a], [c + 0.02, top, b]];
  boxMesh(pane[0], pane[1], M.glass, parent, { cast: false });
  // Frame: four bars inside the opening, plus a center mullion.
  const bar = 0.06;
  const mid = (a + b) / 2;
  const bars = [
    [a, bottom, a + bar, top],
    [b - bar, bottom, b, top],
    [a, bottom, b, bottom + bar],
    [a, top - bar, b, top],
    [mid - bar / 2, bottom, mid + bar / 2, top],
  ];
  for (const [u0, y0, u1, y1] of bars) {
    if (axis === 'x') boxMesh([u0, y0, c - 0.05], [u1, y1, c + 0.05], M.trim, parent);
    else boxMesh([c - 0.05, y0, u0], [c + 0.05, y1, u1], M.trim, parent);
  }
}

// Swinging door: a leaf pivots on its hinge side. Closed, it blocks the opening.
function buildDoor(op, world, house) {
  const { axis, c, a, b } = op;
  const H = 2.08;
  const L = b - a - 0.02;
  const pivot = new THREE.Group();
  const material = op.id === 'front' ? M.frontDoor : M.door;
  const geo = axis === 'x' ? boxGeo(L, H, 0.045) : boxGeo(0.045, H, L);
  geo.translate(axis === 'x' ? L / 2 : 0, H / 2, axis === 'x' ? 0 : L / 2);
  const leaf = new THREE.Mesh(geo, material);
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  pivot.add(leaf);
  pivot.position.set(axis === 'x' ? a + 0.01 : c, 0, axis === 'x' ? c : a + 0.01);
  house.add(pivot);
  // Trim around the opening.
  trimBox(axis, c, [a - 0.06, 0], [a, 2.2], house);
  trimBox(axis, c, [b, 0], [b + 0.06, 2.2], house);
  trimBox(axis, c, [a - 0.06, 2.1], [b + 0.06, 2.2], house);

  const collider = addCollider(
    axis === 'x' ? [a, 0, c - 0.05] : [c - 0.05, 0, a],
    axis === 'x' ? [b, H + 0.02, c + 0.05] : [c + 0.05, H + 0.02, b],
    world,
  );
  const mid = (a + b) / 2;
  world.doors.push({
    kind: 'swing',
    pivot,
    collider,
    angle: 0,
    target: 0,
    openAngle: axis === 'x' ? -Math.PI / 2 : Math.PI / 2,
    pos: axis === 'x' ? [mid, c] : [c, mid],
    open: false,
    id: op.id,
    label: op.id === 'front' ? 'front door' : 'door',
  });
}

// Garage door: the panel slides up and fades out when opened.
function buildGarageDoor(op, world, house) {
  const { axis, c, a, b } = op;
  const top = op.top ?? 2.3;
  const panel = new THREE.Group();
  const geo = axis === 'x' ? boxGeo(b - a, top, 0.1, 1) : boxGeo(0.1, top, b - a, 1);
  const mat = M.garageDoor.clone();
  mat.transparent = true;
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  panel.add(m);
  panel.position.set(axis === 'x' ? (a + b) / 2 : c, top / 2, axis === 'x' ? c : (a + b) / 2);
  house.add(panel);
  const collider = addCollider(
    axis === 'x' ? [a, 0, c - 0.1] : [c - 0.1, 0, a],
    axis === 'x' ? [b, top, c + 0.1] : [c + 0.1, top, b],
    world,
  );
  world.doors.push({
    kind: 'lift', panel, mat, collider, lift: 0, target: 0, top,
    pos: axis === 'x' ? [(a + b) / 2, c] : [c, (a + b) / 2],
    open: false, id: op.id, label: 'garage door',
  });
}

function addCollider(min, max, world) {
  const c = { min, max, active: true };
  world.colliders.push(c);
  return c;
}

// ---------- roofs ----------

// A hip roof over a rectangle, with an overhang. Built from triangles.
function hipRoofGeometry([x0, z0, x1, z1], eave, pitch) {
  const o = 0.45;
  const ax0 = x0 - o, ax1 = x1 + o, az0 = z0 - o, az1 = z1 + o;
  const W = ax1 - ax0, D = az1 - az0;
  const run = Math.min(W, D) / 2;
  const R = eave + pitch * run;
  const A = [ax0, eave, az0], B = [ax1, eave, az0], C = [ax1, eave, az1], Dd = [ax0, eave, az1];
  const tris = [];
  if (W >= D) {
    const h = D / 2, m = (az0 + az1) / 2;
    const P = [ax0 + h, R, m], Q = [ax1 - h, R, m];
    tris.push(A, B, Q, A, Q, P, Dd, C, Q, Dd, Q, P, B, C, Q, A, Dd, P);
  } else {
    const h = W / 2, m = (ax0 + ax1) / 2;
    const P = [m, R, az0 + h], Q = [m, R, az1 - h];
    tris.push(A, P, Q, A, Q, Dd, B, C, Q, B, Q, P, A, B, P, Dd, C, Q);
  }
  const pos = new Float32Array(tris.flat());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- furniture ----------

function bedBoxes(r, head) {
  const [x0, z0, x1, z1] = r;
  const t = 0.08;
  const headRect = {
    x0: [x0, z0, x0 + t, z1], x1: [x1 - t, z0, x1, z1],
    z0: [x0, z0, x1, z0 + t], z1: [x0, z1 - t, x1, z1],
  }[head];
  return [
    { b: [x0, 0, z0, x1, 0.35, z1], m: 'wood' },
    { b: [x0 + 0.03, 0.35, z0 + 0.03, x1 - 0.03, 0.6, z1 - 0.03], m: 'bedding' },
    { b: [headRect[0], 0, headRect[1], headRect[2], 1.0, headRect[3]], m: 'wood' },
  ];
}

function sofaBoxes(r, back) {
  const [x0, z0, x1, z1] = r;
  const t = 0.22;
  const b = {
    x0: [[x0, 0, z0, x0 + t, 0.9, z1]], x1: [[x1 - t, 0, z0, x1, 0.9, z1]],
    z0: [[x0, 0, z0, x1, 0.9, z0 + t]], z1: [[x0, 0, z1 - t, x1, 0.9, z1]],
  }[back];
  const seat = back === 'x0' ? [x0 + t, z0, x1, z1] : back === 'x1' ? [x0, z0, x1 - t, z1] : back === 'z0' ? [x0, z0 + t, x1, z1] : [x0, z0, x1, z1 - t];
  return [
    ...b.map((bb) => ({ b: bb, m: 'fabric' })),
    { b: [seat[0], 0, seat[1], seat[2], 0.45, seat[3]], m: 'fabric' },
  ];
}

function chairBoxes(r, back) {
  const [x0, z0, x1, z1] = r;
  const t = 0.08;
  const b = {
    x0: [x0, 0.45, z0, x0 + t, 0.95, z1], x1: [x1 - t, 0.45, z0, x1, 0.95, z1],
    z0: [x0, 0.45, z0, x1, 0.95, z0 + t], z1: [x0, 0.45, z1 - t, x1, 0.95, z1],
  }[back];
  return [
    { b: [x0, 0, z0, x1, 0.45, z1], m: 'fabric' },
    { b, m: 'fabric' },
  ];
}

function tableBoxes([x0, z0, x1, z1], h = 0.75) {
  const leg = 0.07;
  const top = { b: [x0, h - 0.05, z0, x1, h, z1], m: 'light' };
  const legs = [[x0, z0], [x1 - leg, z0], [x0, z1 - leg], [x1 - leg, z1 - leg]].map(([x, z]) => ({
    b: [x, 0, z, x + leg, h - 0.05, z + leg], m: 'light',
  }));
  return [top, ...legs];
}

function buildFurniture(world, house) {
  const add = (b, m, solid = true) => {
    boxMesh([b[0], b[1], b[2]], [b[3], b[4], b[5]], M[m] || M.wood, house);
    if (solid) addCollider([b[0], b[1], b[2]], [b[3], b[4], b[5]], world);
  };
  for (const f of FURNITURE) {
    if (f.t === 'box') add(f.b, f.m, f.solid !== false);
    else if (f.t === 'rug') flat(f.r, 0.012, M[f.m], 2, house);
    else if (f.t === 'bed') {
      for (const part of bedBoxes(f.r, f.head)) add(part.b, part.m);
    } else if (f.t === 'sofa') {
      for (const part of sofaBoxes(f.r, f.back)) add(part.b, part.m);
    } else if (f.t === 'chair') {
      for (const part of chairBoxes(f.r, f.back)) add(part.b, part.m);
    } else if (f.t === 'table') {
      for (const part of tableBoxes(f.r)) add(part.b, part.m);
    }
  }
}

// ---------- cars ----------

function loadCar(file, targetX, targetZ, world, house) {
  new GLTFLoader().load(CARS + file, (gltf) => {
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) root.rotation.y = Math.PI / 2;
    const car = new THREE.Group();
    car.add(root);
    house.add(car);
    const s = 4.7 / Math.max(size.x, size.z);
    car.scale.setScalar(s);
    car.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(car);
    const c = b2.getCenter(new THREE.Vector3());
    car.position.set(targetX - c.x, -b2.min.y, targetZ - c.z);
    car.updateMatrixWorld(true);
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const b3 = new THREE.Box3().setFromObject(car);
    addCollider([b3.min.x, 0, b3.min.z], [b3.max.x, Math.min(b3.max.y, 1.6), b3.max.z], world);
  });
}

// ---------- yard ----------

function buildYard(world, scene) {
  const yard = new THREE.Group();
  scene.add(yard);
  const big = 160;
  // Grass runs under everything. Pavement sits on top of it.
  const lawn = new THREE.Mesh(planeGeo(2 * big, 2 * big, 4), M.lawn);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  yard.add(lawn);

  flat([-big, STREET_Z - 8, big, STREET_Z], 0, M.asphalt, 4, yard);
  flat([-big, STREET_Z, big, SIDEWALK_Z], 0.0, M.concrete, 3, yard);
  // Concrete slabs: driveway, front walk, stoop and back patio.
  const conc = [YARD.driveway, YARD.walk, YARD.stoop, YARD.patio];
  for (const r of conc) flat(r, 0.002, M.concrete, 3, yard);

  // Curb and mailbox.
  const [mx, mz] = YARD.mailbox;
  boxMesh([mx - 0.03, 0, mz - 0.03], [mx + 0.03, 1.0, mz + 0.03], M.wood, yard);
  boxMesh([mx - 0.2, 1.0, mz - 0.1], [mx + 0.2, 1.25, mz + 0.1], M.mailbox, yard);
  addCollider([mx - 0.05, 0, mz - 0.05], [mx + 0.05, 1.0, mz + 0.05], world);

  // Shrubs along the foundation.
  const r = rng(7);
  for (const [sx, sz] of YARD.shrubs) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + r() * 0.2, 1), M.shrub);
    s.position.set(sx, 0.45, sz);
    s.scale.y = 0.85;
    s.castShadow = true;
    yard.add(s);
    addCollider([sx - 0.5, 0, sz - 0.5], [sx + 0.5, 0.9, sz + 0.5], world);
  }

  // Trees: a trunk and a lumpy canopy, sized randomly.
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  for (const [tx, tz] of YARD.trees) {
    const h = 2.4 + r() * 1.2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, h, 8), M.trunk);
    trunk.position.set(tx, h / 2, tz);
    trunk.castShadow = true;
    yard.add(trunk);
    const size = 2.0 + r() * 1.0;
    const crown = new THREE.Mesh(canopyGeo, M.leaves);
    crown.scale.set(size, size * 1.15, size);
    crown.position.set(tx, h + size * 0.45, tz);
    crown.castShadow = true;
    yard.add(crown);
    addCollider([tx - 0.22, 0, tz - 0.22], [tx + 0.22, 2.5, tz + 0.22], world);
  }
  return yard;
}

// ---------- house ----------

export function buildHouse(scene) {
  const world = { colliders: [], doors: [], roomLights: [], fixtures: [], roof: new THREE.Group() };
  scene.add(world.roof);
  const house = new THREE.Group();
  scene.add(house);
  const used = new Set();

  // Walls, from the room rectangles and the openings.
  for (const seg of wallSegments()) {
    const holes = holesFor(seg, used);
    const { boxes } = wallBoxes(seg, holes);
    // BoxGeometry face order is +x, -x, +y, -y, +z, -z. Only the outside face
    // of an exterior wall gets siding; the inside faces stay drywall.
    const faces = Array(6).fill(M.drywall);
    if (seg.ext) {
      if (seg.axis === 'x') faces[seg.p === -1 ? 5 : 4] = M.siding;
      else faces[seg.p === -1 ? 1 : 0] = M.siding;
    }
    for (const b of boxes) {
      boxMesh(b.min, b.max, seg.ext ? faces : M.drywall, house, { tile: seg.ext ? 1.2 : 0 });
      addCollider(b.min, b.max, world);
    }
  }
  for (const op of OPENINGS) {
    if (!used.has(op)) console.warn('Opening did not match a wall:', op);
  }

  // Openings: doors, windows, the garage door, and trim.
  for (const op of OPENINGS) {
    if (op.kind === 'door') buildDoor(op, world, house);
    else if (op.kind === 'window') buildWindow(op, house);
    else if (op.kind === 'garage') buildGarageDoor(op, world, house);
  }

  // Floors and ceilings, one per room.
  for (const room of ROOMS) {
    const h = room.garage ? GARAGE_H : WALL_H;
    flat(room.rect, 0.004, FLOOR_MAT[room.floor], FLOOR_TILE[room.floor], house);
    const [x0, z0, x1, z1] = room.rect;
    const ceil = new THREE.Mesh(planeGeo(x1 - x0, z1 - z0, 2), M.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
    ceil.castShadow = true;
    ceil.receiveShadow = true;
    house.add(ceil);

    // Ceiling fixture and a point light for each room.
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), M.fixture);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(cx, h - 0.02, cz);
    house.add(disc);
    world.fixtures.push(disc);
    const light = new THREE.PointLight('#ffe9c8', 0, 11, 1.6);
    light.position.set(cx, h - 0.35, cz);
    house.add(light);
    world.roomLights.push({ light, base: room.garage ? 26 : 22 });
  }

  buildFurniture(world, house);

  // Roofs. They are hidden while the player is inside (see main.js).
  const roofOf = (r, eave, pitch) => {
    const m = new THREE.Mesh(hipRoofGeometry(r, eave, pitch), M.roof);
    m.castShadow = true;
    m.receiveShadow = true;
    world.roof.add(m);
  };
  roofOf([HOUSE.x0, HOUSE.z0, HOUSE.x1, HOUSE.z1], WALL_H, 0.3);
  roofOf([GARAGE.x0, GARAGE.z0, GARAGE.x1, GARAGE.z1], GARAGE_H, 0.3);

  // Cars in the garage (stock models from the repo's assets).
  loadCar('sedan.glb', 14.5, 3.0, world, house);
  loadCar('suv.glb', 18.0, 3.0, world, house);

  buildYard(world, scene);

  world.setLights = (on) => {
    for (const { light, base } of world.roomLights) light.intensity = on ? base : 0;
    for (const f of world.fixtures) f.material = on ? M.fixture : M.drywall;
  };
  world.rooms = ROOMS;
  return world;
}

// Advances doors and the garage door toward their targets.
export function updateDoors(world, dt) {
  const k = Math.min(1, dt * 5);
  for (const d of world.doors) {
    if (d.kind === 'swing') {
      d.angle += (d.target - d.angle) * k;
      d.pivot.rotation.y = d.angle;
    } else {
      d.lift += (d.target - d.lift) * k;
      d.panel.position.y = d.top / 2 + d.lift * 0.6;
      d.mat.opacity = 1 - d.lift;
      d.panel.visible = d.lift < 0.98;
    }
  }
}

export function toggleDoor(d) {
  d.open = !d.open;
  d.target = d.open ? 1 : 0;
  if (d.kind === 'swing') {
    d.target = d.open ? d.openAngle : 0;
    d.collider.active = !d.open;
  } else {
    d.collider.active = !d.open;
  }
}
