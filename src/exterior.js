// Site around the building: Grovers Mill Road, bus loop + parking, flagpole, monument sign,
// football stadium (turf field + track + bleachers), tennis courts, Community Middle School
// across the road, trees.
//
// Site layout is an approximation: the paper plans only cover the building itself.
import * as THREE from 'three';
import { Batches, hexToRGB, inRect, subtractRects, WHITE } from './geo.js';
import { rng, makeStadiumTexture, makeParkingTexture, textTexture } from './textures.js';
import { wx, wz, PORCH } from './layout.js';

const C = (h) => hexToRGB(h);

export function buildExterior(scene, world, info, T) {
  const B = new Batches();
  const R = rng(90);
  const paint = B.get('paint');
  const avoid = []; // rects where trees must not go
  const bld = info.blockRects.map((b) => b.r);
  avoid.push(...bld.map((r) => [r[0] - 6, r[1] - 6, r[2] + 6, r[3] + 6]));

  // ---- ground
  // ground plane with holes where the floor drops below grade (pool, raked theatre house)
  for (const r of subtractRects([[-700, -720, 900, 880]], [info.poolPit, info.house])) B.get('grass').hquad(r[0], r[1], r[2], r[3], 0, true);

  // flat ground layers sit a few cm up so they never depth-fight the grass from a distance
  const flat = (key, x0, z0, x1, z1, y = 0.012, color = WHITE) => B.get(key).hquad(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y + 0.02, true, color);
  const stripe = (x0, z0, x1, z1, color, y = 0.02) => paint.hquad(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y + 0.025, true, C(color));

  // ---- Grovers Mill Road (runs along the front of the site)
  const roadX0 = -128, roadX1 = -117;
  flat('asphalt', roadX0, -500, roadX1, 700, 0.01);
  stripe(roadX0 + 0.3, -500, roadX0 + 0.45, 700, '#eeeeee');
  stripe(roadX1 - 0.45, -500, roadX1 - 0.3, 700, '#eeeeee');
  for (let z = -500; z < 700; z += 9) stripe((roadX0 + roadX1) / 2 - 0.08, z, (roadX0 + roadX1) / 2 + 0.08, z + 4.5, '#d5dde8');
  avoid.push([roadX0 - 4, -600, roadX1 + 4, 800]);
  // sidewalk along the road
  flat('concrete', roadX1 + 2, -500, roadX1 + 4, 700, 0.014, C('#d8d4ca'));

  // ---- entrance drives + bus loop in front of the main entrance
  const porch = [wx(PORCH[0]), wz(PORCH[1]), wx(PORCH[2]), wz(PORCH[3])];
  const loop = [-44, 50, -10, 122];
  const island = [-34, 62, -20, 110];
  flat('asphalt', loop[0], loop[1], loop[2], loop[3], 0.013);
  // raised grass island with a curb (walkable: it's a low step)
  B.get('grass').hquad(island[0], island[1], island[2], island[3], 0.14, true);
  paint.box(island[0] - 0.15, 0, island[1] - 0.15, island[2] + 0.15, 0.14, island[3] + 0.15, C('#cfcac0'), 'xXzZ');
  for (const [a, b, c, d] of [[island[0] - 0.15, island[1] - 0.15, island[2] + 0.15, island[1]], [island[0] - 0.15, island[3], island[2] + 0.15, island[3] + 0.15], [island[0] - 0.15, island[1], island[0], island[3]], [island[2], island[1], island[2] + 0.15, island[3]]])
    paint.hquad(a, b, c, d, 0.141, true, C('#cfcac0'));
  world.add(island[0] - 0.15, 0, island[1] - 0.15, island[2] + 0.15, 0.14, island[3] + 0.15, 26);
  for (const z of [56, 116]) {
    flat('asphalt', roadX1, z - 4, loop[0], z + 4, 0.012);
    stripe(roadX1, z - 0.08, loop[0], z + 0.08, '#d5dde8', 0.02);
  }
  // front walk from loop to the porch + along the building
  flat('concrete', loop[2], porch[1] + 1, porch[0], porch[3] - 1, 0.016, C('#dcd8cf'));
  flat('concrete', -2.5, 15, 1.0, 150, 0.015, C('#d6d2c8'));
  avoid.push([loop[0] - 3, loop[1] - 3, 0, loop[3] + 3], [roadX1, 50, loop[0], 62], [roadX1, 110, loop[0], 122]);

  // ---- main parking lot
  // stall rows: texture u runs along the aisles (27m tile), v across (18m = stall+aisle+stall)
  const lotPlane = (r, aislesAlongZ) => {
    const lx = r[2] - r[0], lz = r[3] - r[1];
    const tex = makeParkingTexture();
    const g = new THREE.PlaneGeometry(aislesAlongZ ? lz : lx, aislesAlongZ ? lx : lz);
    g.rotateX(-Math.PI / 2);
    if (aislesAlongZ) g.rotateY(Math.PI / 2);
    tex.repeat.set((aislesAlongZ ? lz : lx) / 27, (aislesAlongZ ? lx : lz) / 18);
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    mesh.position.set((r[0] + r[2]) / 2, 0.03, (r[1] + r[3]) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const lot = [-108, -30, -54, -30 + 77 * 2.7];
  lotPlane(lot, true);
  flat('asphalt', lot[2], 20, loop[0], 150, 0.0105);
  avoid.push([lot[0] - 3, lot[1] - 3, loop[0], lot[3] + 3]);
  // cars
  const carColors = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#1f4e79', '#111111', '#b7950b', '#d5d8dc', '#6c3483', '#1e8449'];
  const cars = [];
  for (let col = 0; col < Math.floor((lot[2] - lot[0]) / 18); col++) {
    const cx0 = lot[0] + col * 18;
    for (let z = lot[1] + 1.35; z < lot[3] - 1.35; z += 2.7) {
      for (const cx of [cx0 + 2.75, cx0 + 18 - 2.75]) if (R() < 0.62) cars.push({ x: cx, z, color: carColors[Math.floor(R() * carColors.length)], rot: cx === cx0 + 2.75 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  // staff lot behind the theatre / dining
  const lot2 = [30, 186, 30 + 44 * 2.7, 204];
  lotPlane(lot2, false);
  flat('asphalt', 60, 150, 70, 186, 0.0105);
  for (let x = lot2[0] + 1.35; x < lot2[2] - 1.35; x += 2.7) for (const z of [lot2[1] + 2.75, lot2[3] - 2.75]) if (R() < 0.5) cars.push({ x, z, color: carColors[Math.floor(R() * carColors.length)], rot: z < (lot2[1] + lot2[3]) / 2 ? Math.PI : 0 });
  avoid.push([lot2[0] - 3, lot2[1] - 3, lot2[2] + 3, lot2[3] + 3], [58, 145, 72, 182]);
  // car meshes (instanced body + cabin + wheels)
  {
    const body = new THREE.BoxGeometry(1.8, 0.7, 4.4);
    body.translate(0, 0.55, 0);
    const cabin = new THREE.BoxGeometry(1.6, 0.55, 2.3);
    cabin.translate(0, 1.17, -0.2);
    const wheel = new THREE.CylinderGeometry(0.33, 0.33, 1.84, 12);
    wheel.rotateZ(Math.PI / 2);
    const bodyM = new THREE.InstancedMesh(body, new THREE.MeshPhongMaterial({ shininess: 80 }), cars.length);
    const cabM = new THREE.InstancedMesh(cabin, new THREE.MeshPhongMaterial({ color: '#223344', shininess: 100, specular: '#99aabb' }), cars.length);
    const wheelM = new THREE.InstancedMesh(wheel, new THREE.MeshLambertMaterial({ color: '#1a1a1a' }), cars.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    cars.forEach((c, i) => {
      q.setFromAxisAngle(up, c.rot);
      m.compose(new THREE.Vector3(c.x, 0, c.z), q, s);
      bodyM.setMatrixAt(i, m);
      bodyM.setColorAt(i, col.set(c.color));
      cabM.setMatrixAt(i, m);
      for (let k = 0; k < 2; k++) {
        const off = new THREE.Vector3(0, 0.33, k ? 1.35 : -1.35).applyQuaternion(q);
        m.compose(new THREE.Vector3(c.x + off.x, off.y, c.z + off.z), q, s);
        wheelM.setMatrixAt(i * 2 + k, m);
      }
      const hw = Math.abs(Math.sin(c.rot)) > 0.5 ? [2.2, 0.9] : [0.9, 2.2];
      world.add(c.x - hw[0], 0, c.z - hw[1], c.x + hw[0], 1.45, c.z + hw[1], 20);
    });
    for (const im of [bodyM, cabM, wheelM]) {
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
  }

  // ---- flagpole + flag on the island
  const flagPole = [(island[0] + island[2]) / 2, 74];
  paint.box(flagPole[0] - 0.08, 0, flagPole[1] - 0.08, flagPole[0] + 0.08, 12, flagPole[1] + 0.08, C('#d9dde0'));
  world.add(flagPole[0] - 0.1, 0, flagPole[1] - 0.1, flagPole[0] + 0.1, 12, flagPole[1] + 0.1, 20);
  const flag = makeFlag();
  flag.position.set(flagPole[0] + 0.05, 10.3, flagPole[1]);
  scene.add(flag);

  // ---- monument sign on the island
  {
    const sx = (island[0] + island[2]) / 2, sz = 100;
    B.get('brick').box(sx - 0.6, 0, sz - 3.2, sx + 0.6, 0.7, sz + 3.2);
    B.get('brick').box(sx - 0.35, 0.7, sz - 3.0, sx + 0.35, 2.6, sz + 3.0);
    paint.box(sx - 0.45, 2.6, sz - 3.1, sx + 0.45, 2.75, sz + 3.1, C('#d9d2c2'));
    world.add(sx - 0.6, 0, sz - 3.2, sx + 0.6, 2.75, sz + 3.2, 20);
    const tex = textTexture([
      { text: 'West Windsor-Plainsboro', size: 0.2 },
      { text: 'High School North', size: 0.24 },
      { text: '90 Grovers Mill Road', size: 0.13, weight: 'normal', color: '#ffffff' },
      { text: 'HOME OF THE KNIGHTS', size: 0.16, color: '#ffffff' },
    ], { w: 1024, h: 340, bg: '#1f3f8f', fg: '#e8edf4' });
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    for (const s of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.8), mat);
      pl.position.set(sx + s * 0.36, 1.65, sz);
      pl.rotation.y = s * Math.PI / 2;
      scene.add(pl);
    }
  }

  // ---- football stadium
  const SW = 190, SH = 100;
  const scx = 300, scz = 70;
  {
    const tex = makeStadiumTexture(SW, SH);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(scx, 0.035, scz);
    m.receiveShadow = true;
    scene.add(m);
    avoid.push([scx - SW / 2 - 4, scz - SH / 2 - 22, scx + SW / 2 + 4, scz + SH / 2 + 26]);
    // home bleachers (south side) — walkable steps
    const bz = scz + SH / 2 - 2, rows = 14, depth = 0.85, rise = 0.42;
    const bx0 = scx - 45, bx1 = scx + 45;
    for (let i = 0; i < rows; i++) {
      const z0 = bz + i * depth, top = (i + 1) * rise;
      B.get('paint').box(bx0, top - 0.12, z0, bx1, top, z0 + depth, C(i % 2 ? '#b9bec3' : '#a8adb2'));
      B.get('paint').box(bx0, 0, z0 + depth - 0.06, bx1, top - 0.12, z0 + depth, C('#6f757b'), 'zZ');
      world.add(bx0, 0, z0, bx1, top, z0 + depth, 21);
    }
    // back rail + press box
    const bzEnd = bz + rows * depth;
    paint.box(bx0, rows * rise, bzEnd - 0.05, bx1, rows * rise + 1.1, bzEnd, C('#6f757b'));
    world.add(bx0, 0, bzEnd - 0.05, bx1, rows * rise + 1.1, bzEnd, 21);
    paint.box(scx - 9, rows * rise, bzEnd, scx + 9, rows * rise + 3.2, bzEnd + 4, C('#e7e1d4'));
    paint.box(scx - 9, rows * rise + 1.2, bzEnd - 0.01, scx + 9, rows * rise + 2.6, bzEnd, C('#27394a'), 'z');
    paint.box(scx - 9.3, rows * rise + 3.2, bzEnd - 0.3, scx + 9.3, rows * rise + 3.5, bzEnd + 4.3, C('#1f3f8f'));
    paint.box(scx - 9, 0, bzEnd, scx + 9, rows * rise, bzEnd + 4, C('#9aa0a6'));
    world.add(scx - 9, 0, bzEnd, scx + 9, rows * rise + 3.5, bzEnd + 4, 21);
    // bleacher side stairs
    for (const sx of [bx0 - 1.4, bx1]) {
      for (let i = 0; i < rows; i++) {
        const z0 = bz + i * depth, top = (i + 1) * rise;
        paint.box(sx, 0, z0, sx + 1.4, top, z0 + depth, C('#8e949a'));
        world.add(sx, 0, z0, sx + 1.4, top, z0 + depth, 21);
      }
    }
    // visitor bleachers (north), smaller
    const vz = scz - SH / 2 + 2;
    for (let i = 0; i < 7; i++) {
      const z1 = vz - i * depth, top = (i + 1) * rise;
      paint.box(scx - 30, top - 0.12, z1 - depth, scx + 30, top, z1, C(i % 2 ? '#b9bec3' : '#a8adb2'));
      paint.box(scx - 30, 0, z1 - depth, scx + 30, top - 0.12, z1 - depth + 0.06, C('#6f757b'), 'zZ');
      world.add(scx - 30, 0, z1 - depth, scx + 30, top, z1, 21);
    }
    // goal posts
    const fieldHalf = 109.7 / 2;
    for (const s of [-1, 1]) {
      const gx = scx + s * fieldHalf;
      const y = C('#d5dde8');
      paint.box(gx - 0.1, 0, scz - 0.1, gx + 0.1, 3.05, scz + 0.1, y);
      paint.box(gx - 0.08, 3.0, scz - 2.83, gx + 0.08, 3.1, scz + 2.83, y);
      for (const zz of [scz - 2.83, scz + 2.83]) paint.box(gx - 0.06, 3.0, zz - 0.06, gx + 0.06, 9.1, zz + 0.06, y);
      world.add(gx - 0.12, 0, scz - 0.12, gx + 0.12, 3.1, scz + 0.12, 21);
    }
    // light towers
    for (const [lx, lz] of [[scx - 60, scz - SH / 2 - 8], [scx + 60, scz - SH / 2 - 8], [scx - 60, scz + SH / 2 + 18], [scx + 60, scz + SH / 2 + 18]]) {
      paint.box(lx - 0.3, 0, lz - 0.3, lx + 0.3, 24, lz + 0.3, C('#9aa0a6'));
      paint.box(lx - 2.5, 24, lz - 0.6, lx + 2.5, 26.2, lz + 0.6, C('#6f757b'));
      paint.box(lx - 2.3, 24.2, lz + (lz < scz ? 0.6 : -0.62), lx + 2.3, 26, lz + (lz < scz ? 0.62 : -0.6), C('#fffbe8'));
      world.add(lx - 0.3, 0, lz - 0.3, lx + 0.3, 24, lz + 0.3, 21);
    }
    // scoreboard at the east end
    const sbx = scx + SW / 2 - 3;
    paint.box(sbx - 0.3, 0, scz - 6, sbx + 0.3, 6, scz - 5.4, C('#555'));
    paint.box(sbx - 0.3, 0, scz + 5.4, sbx + 0.3, 6, scz + 6, C('#555'));
    paint.box(sbx - 0.25, 6, scz - 7, sbx + 0.25, 11.5, scz + 7, C('#1b1b1b'));
    world.add(sbx - 0.35, 0, scz - 7, sbx + 0.35, 11.5, scz + 7, 21);
    const sbt = textTexture([
      { text: 'WW-P NORTH KNIGHTS', size: 0.17, color: '#d5dde8' },
      { text: 'KNIGHTS  21   GUESTS  14', size: 0.26, font: 'monospace', color: '#ff5533' },
      { text: 'QTR 4    DOWN 2', size: 0.18, font: 'monospace', color: '#ffffff' },
    ], { w: 1024, h: 400, bg: '#111', border: false });
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 5.3), new THREE.MeshBasicMaterial({ map: sbt }));
    sb.position.set(sbx - 0.27, 8.75, scz);
    sb.rotation.y = -Math.PI / 2;
    scene.add(sb);
    // fence (low) around the track
    const fx0 = scx - SW / 2 + 2, fx1 = scx + SW / 2 - 2, fz0 = scz - SH / 2 + 1, fz1 = scz + SH / 2 - 2.5;
    const fenceC = C('#5f666d');
    for (const [a0, a1, zz] of [[fx0, fx1, fz0], [fx0, bx0 - 2, fz1], [bx1 + 2, fx1, fz1]]) {
      paint.box(a0, 1.1, zz - 0.03, a1, 1.16, zz + 0.03, fenceC);
      for (let x = a0; x <= a1; x += 2.5) paint.box(x - 0.03, 0, zz - 0.03, x + 0.03, 1.16, zz + 0.03, fenceC);
    }
    for (const xx of [fx0, fx1]) {
      paint.box(xx - 0.03, 1.1, fz0, xx + 0.03, 1.16, fz1, fenceC);
      for (let z = fz0; z <= fz1; z += 2.5) paint.box(xx - 0.03, 0, z - 0.03, xx + 0.03, 1.16, z + 0.03, fenceC);
    }
    // path from the gym exits to the stadium
    flat('concrete', 176, 120, 208, 124, 0.016, C('#d6d2c8'));
  }

  // ---- tennis courts (north of the academic wing)
  {
    const tx0 = 30, tz0 = -78;
    const cw = 18.3, cl = 36.6;
    for (let i = 0; i < 4; i++) {
      const x0 = tx0 + i * (cw + 1);
      flat('paint', x0, tz0, x0 + cw, tz0 + cl, 0.02, C('#3f7a5a'));
      paint.hquad(x0 + 3.2, tz0 + 6.4, x0 + cw - 3.2, tz0 + cl - 6.4, 0.025, true, C('#35628f'));
      const ln = (a, b, c, d) => stripe(a, b, c, d, '#ffffff', 0.03);
      ln(x0 + 3.2, tz0 + 6.4, x0 + 3.28, tz0 + cl - 6.4);
      ln(x0 + cw - 3.28, tz0 + 6.4, x0 + cw - 3.2, tz0 + cl - 6.4);
      ln(x0 + 3.2, tz0 + 6.4, x0 + cw - 3.2, tz0 + 6.48);
      ln(x0 + 3.2, tz0 + cl - 6.48, x0 + cw - 3.2, tz0 + cl - 6.4);
      ln(x0 + cw / 2 - 0.04, tz0 + 12.8, x0 + cw / 2 + 0.04, tz0 + cl - 12.8);
      ln(x0 + 3.2, tz0 + 12.8, x0 + cw - 3.2, tz0 + 12.88);
      ln(x0 + 3.2, tz0 + cl - 12.88, x0 + cw - 3.2, tz0 + cl - 12.8);
      // net
      paint.box(x0 + 2.5, 0, tz0 + cl / 2 - 0.02, x0 + cw - 2.5, 0.95, tz0 + cl / 2 + 0.02, C('#1c1c1c'));
      paint.box(x0 + 2.5, 0.92, tz0 + cl / 2 - 0.03, x0 + cw - 2.5, 0.98, tz0 + cl / 2 + 0.03, C('#ffffff'));
      world.add(x0 + 2.5, 0, tz0 + cl / 2 - 0.05, x0 + cw - 2.5, 0.98, tz0 + cl / 2 + 0.05, 22);
    }
    const x1 = tx0 + 4 * (cw + 1) - 1;
    const fence = new THREE.MeshLambertMaterial({ color: '#334', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const fenceMesh = (w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), fence);
    for (const [x, z, w, rot] of [[(tx0 + x1) / 2, tz0 - 1, x1 - tx0 + 2, 0], [(tx0 + x1) / 2, tz0 + cl + 1, x1 - tx0 + 2, 0], [tx0 - 1, tz0 + cl / 2, cl + 2, Math.PI / 2], [x1 + 1, tz0 + cl / 2, cl + 2, Math.PI / 2]]) {
      const f = fenceMesh(w, 3);
      f.position.set(x, 1.5, z);
      f.rotation.y = rot;
      scene.add(f);
      if (rot === 0) world.add(x - w / 2, 0, z - 0.05, x + w / 2, 3, z + 0.05, 22);
      else world.add(x - 0.05, 0, z - w / 2, x + 0.05, 3, z + w / 2, 22);
    }
    avoid.push([tx0 - 6, tz0 - 6, x1 + 6, tz0 + cl + 6]);
    flat('concrete', 52, tz0 + cl + 1, 55, 1.2, 0.016, C('#d6d2c8'));
  }

  // ---- courtyard: benches + a few trees
  const cy = info.courtyard;
  {
    flat('concrete', cy[0] + 0.2, (cy[1] + cy[3]) / 2 - 1.2, cy[2] - 0.2, (cy[1] + cy[3]) / 2 + 1.2, 0.02, C('#cfc9bd'));
    for (let i = 0; i < 5; i++) {
      const bx = cy[0] + 5 + i * ((cy[2] - cy[0] - 10) / 4);
      const bz = (cy[1] + cy[3]) / 2 + 2.2;
      paint.box(bx - 0.9, 0.42, bz - 0.25, bx + 0.9, 0.48, bz + 0.25, C('#8b5a2b'));
      paint.box(bx - 0.8, 0, bz - 0.2, bx - 0.7, 0.42, bz + 0.2, C('#444'));
      paint.box(bx + 0.7, 0, bz - 0.2, bx + 0.8, 0.42, bz + 0.2, C('#444'));
      world.add(bx - 0.9, 0, bz - 0.25, bx + 0.9, 0.48, bz + 0.25, 23);
    }
  }

  // ---- Community Middle School, across Grovers Mill Road (simplified massing)
  const cms = [-230, 5, -152, 118];
  {
    const [x0, z0, x1, z1] = cms, h = 5.2;
    B.get('brick').box(x0, 0, z0, x1, h, z1);
    B.get('roof').box(x0 + 0.3, h - 0.3, z0 + 0.3, x1 - 0.3, h - 0.05, z1 - 0.3, WHITE, 'Y');
    paint.box(x0 - 0.05, h, z0 - 0.05, x1 + 0.05, h + 0.14, z1 + 0.05, C('#d9d2c2'));
    world.add(x0, 0, z0, x1, h, z1, 25);
    for (let z = z0 + 3; z < z1 - 3; z += 3.4) {
      if (z > 56 && z < 66) continue;
      paint.box(x1, 1.0, z, x1 + 0.03, 2.4, z + 1.9, C('#27394a'), 'X');
    }
    paint.box(x1, 0, 57, x1 + 0.35, 2.7, 65, C('#3a3029'));
    paint.box(x1 + 0.01, 0.05, 58, x1 + 0.37, 2.5, 64, C('#5d7d93'), 'X');
    const t = textTexture([{ text: 'COMMUNITY MIDDLE SCHOOL', size: 0.62 }], { w: 1400, h: 150, bg: '#2b3440', fg: '#ffffff', border: false });
    const sgn = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.5), new THREE.MeshBasicMaterial({ map: t }));
    sgn.position.set(x1 + 0.05, 3.7, 61);
    sgn.rotation.y = Math.PI / 2;
    scene.add(sgn);
    flat('asphalt', x1, 57, roadX0, 65, 0.012);
    avoid.push([x0 - 5, z0 - 5, roadX0, z1 + 5]);
  }

  // ---- trees (instanced)
  const trees = [];
  const tryTree = (x, z, s = 1) => {
    if (avoid.some((r) => inRect(r, x, z))) return;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5)) return;
    trees.push({ x, z, s, h: 0.8 + R() * 0.6, kind: R() < 0.35 ? 1 : 0 });
  };
  for (let i = 0; i < 1400 && trees.length < 320; i++) tryTree(-220 + R() * 640, -200 + R() * 520, 1);
  // along the road
  for (let z = -150; z < 330; z += 14) tryTree(roadX1 + 7 + R() * 2, z + R() * 4);
  // courtyard trees
  for (const t of [[cy[0] + 8, cy[1] + 3.5], [cy[2] - 8, cy[1] + 3.5], [(cy[0] + cy[2]) / 2, cy[3] - 2]]) trees.push({ x: t[0], z: t[1], s: 0.6, h: 0.8, kind: 0 });
  {
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
    trunk.translate(0, 1.5, 0);
    const leafy = new THREE.IcosahedronGeometry(2.6, 1);
    leafy.translate(0, 4.6, 0);
    const pine = new THREE.ConeGeometry(2.3, 6.5, 8);
    pine.translate(0, 5.0, 0);
    const trunkM = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: '#5a4030' }), trees.length);
    const leafM = new THREE.InstancedMesh(leafy, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), trees.length);
    const pineM = new THREE.InstancedMesh(pine, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), trees.length);
    let nl = 0, np = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, R() * 6.28);
      const k = t.s * t.h * 1.2;
      sc.set(k, k, k);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, sc);
      trunkM.setMatrixAt(i, m);
      if (t.kind === 1) {
        pineM.setMatrixAt(np, m);
        pineM.setColorAt(np++, col.setHSL(0.33 + R() * 0.05, 0.45, 0.2 + R() * 0.08));
      } else {
        leafM.setMatrixAt(nl, m);
        leafM.setColorAt(nl++, col.setHSL(0.22 + R() * 0.1, 0.45 + R() * 0.2, 0.27 + R() * 0.1));
      }
      world.add(t.x - 0.3 * k, 0, t.z - 0.3 * k, t.x + 0.3 * k, 3 * k, t.z + 0.3 * k, 24);
    });
    leafM.count = nl;
    pineM.count = np;
    for (const im of [trunkM, leafM, pineM]) {
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
  }

  // ---- shrubs along the front of the building
  {
    const shrubs = [];
    for (let z = 12; z < 150; z += 2.2) if (!(z > 74 && z < 102) && R() < 0.8) shrubs.push([-1.6 + R() * 0.4, z]);
    const g = new THREE.IcosahedronGeometry(0.8, 0);
    g.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), shrubs.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    shrubs.forEach(([x, z], i) => {
      m.makeScale(1 + R() * 0.4, 0.8 + R() * 0.4, 1 + R() * 0.4);
      m.setPosition(x, 0, z);
      im.setMatrixAt(i, m);
      im.setColorAt(i, col.setHSL(0.28 + R() * 0.06, 0.5, 0.25 + R() * 0.07));
    });
    im.castShadow = true;
    scene.add(im);
  }

  const materials = {
    paint: new THREE.MeshLambertMaterial({ vertexColors: true }),
    asphalt: new THREE.MeshLambertMaterial({ map: T.asphalt }),
    concrete: new THREE.MeshLambertMaterial({ map: T.concrete, vertexColors: true }),
    grass: new THREE.MeshLambertMaterial({ map: T.grass }),
    brick: new THREE.MeshLambertMaterial({ map: T.brick }),
    roof: new THREE.MeshLambertMaterial({ map: T.roof }),
  };
  for (const m of B.toMeshes(materials)) scene.add(m);

  return { flag, stadium: { x: scx, z: scz, w: SW, h: SH }, lot, loop, cms };
}

function makeFlag() {
  const c = document.createElement('canvas');
  c.width = 380;
  c.height = 200;
  const g = c.getContext('2d');
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#b22234';
    g.fillRect(0, (i * 200) / 13, 380, 200 / 13 + 1);
  }
  g.fillStyle = '#3c3b6e';
  g.fillRect(0, 0, 152, (7 * 200) / 13);
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 9; r++)
    for (let k = 0; k < (r % 2 ? 5 : 6); k++) {
      const x = 12 + k * 25 + (r % 2 ? 12 : 0), y = 8 + r * 11.5;
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(2.8, 1.5, 16, 6);
  geo.translate(1.4, 0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
  mesh.userData.base = geo.attributes.position.array.slice();
  mesh.userData.wave = (time) => {
    const p = geo.attributes.position, b = mesh.userData.base;
    for (let i = 0; i < p.count; i++) {
      const x = b[i * 3];
      p.setZ(i, Math.sin(x * 2.2 - time * 4) * 0.18 * (x / 2.8));
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return mesh;
}
