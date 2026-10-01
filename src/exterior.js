// The High School North campus, traced from a satellite view of 90 Grovers Mill Road.
//
// Every feature below is written in *satellite pixel* coordinates (sx right = east,
// sy down = south) and converted with sat(). The transform was calibrated so the model's
// footprint lands on the real building: the floor plan's top (A-wing) faces west, the main
// entrance faces south to the bus lane, the gyms are to the north. Sports facilities use
// regulation sizes at the positions measured on the photo.
import * as THREE from 'three';
import { Batches, GeoBuilder, hexToRGB, inRect, subtractRects, WHITE } from './geo.js';
import { rng, makeStadiumTexture, makeParkingTexture, textTexture } from './textures.js';
import { S, wx, wz, PORCH } from './layout.js';

const C = (h) => hexToRGB(h);
const MX = 0.557, MY = 0.605; // meters per satellite pixel (east-west, north-south)
export const sat = (sx, sy) => [110 * S + (857 - sy) * MY, 8 * S + (sx - 612) * MX];
export const satRect = (sx0, sy0, sx1, sy1) => {
  const [xa, za] = sat(sx0, sy1), [xb, zb] = sat(sx1, sy0);
  return [xa, za, xb, zb];
};

// point-in-polygon for [x,z] lists
function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function buildExterior(scene, world, info, T, M) {
  const B = new Batches();
  const R = rng(90);
  const avoid = info.blockRects.map((b) => [b.r[0] - 7, b.r[1] - 7, b.r[2] + 7, b.r[3] + 7]);
  const mapShapes = []; // for the 2D map: {kind, pts|r, color, width}
  const areas = []; // named outdoor places for the location readout, first match wins
  const paved = []; // [a, b, halfWidth] road and path segments, kept clear of trees

  // ------------------------------------------------------------------ helpers
  const up = [0, 1, 0];
  const triUp = (bb, a, b, c, y, color = WHITE) => {
    // orient CCW when seen from above
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const [p, q] = cross > 0 ? [c, b] : [b, c];
    bb.quad([[a[0], y, a[1]], [p[0], y, p[1]], [q[0], y, q[1]], [q[0], y, q[1]]], up, [[a[0], -a[1]], [p[0], -p[1]], [q[0], -q[1]], [q[0], -q[1]]], color);
  };
  const disc = (bb, cx, cz, r, y, color = WHITE, n = 20) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      triUp(bb, [cx, cz], [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r], y, color);
    }
  };
  // polyline strip in world coords
  const strip = (bb, pts, w, y, color = WHITE, joins = true) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * (w / 2), nz = (dx / L) * (w / 2);
      bb.quad([[ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz]], up,
        [[ax + nx, -(az + nz)], [bx + nx, -(bz + nz)], [bx - nx, -(bz - nz)], [ax - nx, -(az - nz)]], color);
      if (joins && i > 0) disc(bb, ax, az, w / 2, y, color, 16);
    }
  };
  const flat = (key, r, y, color = WHITE) => B.get(key).hquad(r[0], r[1], r[2], r[3], y, true, color);
  const road = (satPts, w, { center = false, edges = false, y = 0.03 } = {}) => {
    const pts = satPts.map(([sx, sy]) => sat(sx, sy));
    for (let i = 1; i < pts.length; i++) paved.push([pts[i - 1], pts[i], w / 2]);
    strip(B.get('asphalt'), pts, w, y);
    mapShapes.push({ kind: 'line', pts, width: w, color: '#5b5e62' });
    if (edges)
      for (const s of [-1, 1]) {
        const off = pts.map((p, i) => {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
          return [p[0] + (-dz / L) * (w / 2 - 0.35) * s, p[1] + (dx / L) * (w / 2 - 0.35) * s];
        });
        strip(B.get('decal'), off, 0.12, y + 0.012, C('#e8e8e2'), false);
      }
    if (center) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < L - 3; t += 9) {
          const u0 = t / L, u1 = (t + 3.5) / L;
          strip(B.get('decal'), [[ax + (bx - ax) * u0, az + (bz - az) * u0], [ax + (bx - ax) * u1, az + (bz - az) * u1]], 0.14, y + 0.012, C('#e7c34a'), false);
        }
      }
    }
    return pts;
  };
  const walk = (satPts, w = 2.4) => {
    const pts = satPts.map(([sx, sy]) => sat(sx, sy));
    for (let i = 1; i < pts.length; i++) paved.push([pts[i - 1], pts[i], w / 2]);
    strip(B.get('walk'), pts, w, 0.045, C('#d9d5cb'));
    mapShapes.push({ kind: 'line', pts, width: w, color: '#cfcac0' });
  };
  const box = (key, x0, y0, z0, x1, y1, z1, color = WHITE, collide = true, tag = 20) => {
    B.get(key).box(x0, y0, z0, x1, y1, z1, color);
    if (collide) world.add(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), tag);
  };

  // ------------------------------------------------------------------ ground
  const holes = [info.poolPit, info.house];
  for (const r of subtractRects([[-420, -560, 760, 640]], holes)) B.get('grass').hquad(r[0], r[1], r[2], r[3], 0, true);

  // ------------------------------------------------------------------ roads (traced)
  const GM_Y = 1040;
  road([[-600, GM_Y], [1900, GM_Y]], 11, { center: true, edges: true });
  mapShapes.push({ kind: 'label', at: sat(150, GM_Y), text: 'GROVERS MILL ROAD', color: '#ffffff', rot: 0 });
  // west access road -> cul-de-sac by the field house
  road([[309, GM_Y], [309, 700], [309, 612]], 7.5);
  { const [cx, cz] = sat(287, 582); disc(B.get('asphalt'), cx, cz, 15, 0.03); mapShapes.push({ kind: 'disc', at: [cx, cz], r: 15, color: '#5b5e62' }); paved.push([[cx, cz], [cx, cz], 15]); }
  road([[309, 612], [296, 596]], 7.5);
  // road between the track and the west lot, up the west side, around the north of the building
  road([[309, 668], [700, 668], [700, 505], [712, 490], [735, 484], [925, 484], [944, 494], [950, 512], [950, 598], [962, 606], [1058, 606], [1066, 620], [1066, 866], [1056, 886], [1034, 898], [962, 905]], 7);
  // bus lane along the south face, and the east entrance road
  road([[962, 905], [309, 905]], 8.5);
  road([[958, 905], [958, GM_Y]], 7.5);
  // drop-off lane inside the east loop
  road([[1066, 690], [1031, 702], [1031, 860], [1062, 878]], 5.5);
  // lot connectors
  road([[309, 780], [360, 780]], 7);
  road([[470, 668], [470, 690]], 7);
  road([[1066, 700], [1080, 700]], 7);
  road([[1066, 780], [1080, 780]], 7);

  // ------------------------------------------------------------------ parking lots (traced)
  const lots = [];
  const lotPlane = (r, aislesAlongZ) => {
    const lx = r[2] - r[0], lz = r[3] - r[1];
    const tex = makeParkingTexture();
    const g = new THREE.PlaneGeometry(aislesAlongZ ? lz : lx, aislesAlongZ ? lx : lz);
    g.rotateX(-Math.PI / 2);
    if (aislesAlongZ) g.rotateY(Math.PI / 2);
    tex.repeat.set((aislesAlongZ ? lz : lx) / 27, (aislesAlongZ ? lx : lz) / 18);
    const mesh = new THREE.Mesh(g, offset(new THREE.MeshStandardMaterial({ map: tex, normalMap: T.asphaltN, roughness: 0.8 }), -2));
    mesh.position.set((r[0] + r[2]) / 2, 0.035, (r[1] + r[3]) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
    lots.push(r);
    mapShapes.push({ kind: 'rect', r, color: '#5b5e62' });
    // curb
    B.get('concrete').box(r[0] - 0.3, 0, r[1] - 0.3, r[2] + 0.3, 0.12, r[1], C('#cfcac0'), 'Yzx');
    B.get('concrete').box(r[0] - 0.3, 0, r[3], r[2] + 0.3, 0.12, r[3] + 0.3, C('#cfcac0'), 'YZx');
  };
  // aisles run east-west on the photo = along world Z; bands are 18 m, stalls 2.7 m
  const [wlX0] = sat(0, 871), [wlZ0] = [sat(357, 0)[1]];
  const westLot = [wlX0, wlZ0, wlX0 + 6 * 18, wlZ0 + 47 * 2.7];
  lotPlane(westLot, true);
  areas.push({ name: 'Student Parking', r: westLot });
  const [slX0] = sat(0, 954);
  const southLot = [slX0, sat(335, 0)[1], slX0 + 18, sat(335, 0)[1] + 128 * 2.7];
  lotPlane(southLot, true);
  areas.push({ name: 'Bus Parking', r: southLot });
  const [elX0] = sat(0, 813);
  const eastLot = [elX0, sat(1078, 0)[1], elX0 + 6 * 18, sat(1078, 0)[1] + 39 * 2.7];
  lotPlane(eastLot, true);
  areas.push({ name: 'East Parking Lot', r: eastLot });
  // service yard east of the dining wing
  const yard = satRect(914, 655, 1000, 760);
  flat('asphalt', yard, 0.03);
  mapShapes.push({ kind: 'rect', r: yard, color: '#5b5e62' });
  areas.push({ name: 'Service Yard', r: yard });
  mapShapes.push({ kind: 'label', at: [(westLot[0] + westLot[2]) / 2, (westLot[1] + westLot[3]) / 2], text: 'PARKING', color: '#ffffff', size: 6 });
  mapShapes.push({ kind: 'label', at: [(eastLot[0] + eastLot[2]) / 2, (eastLot[1] + eastLot[3]) / 2], text: 'PARKING', color: '#ffffff', size: 6 });

  // cars
  const carColors = ['#b8322a', '#2c3e50', '#ecf0f1', '#7f8c8d', '#1f4e79', '#111111', '#9b8b6a', '#d5d8dc', '#5e3c6e', '#2f6b45', '#a7a9ac', '#243b5e'];
  const cars = [];
  const boxCars = []; // stand-ins until the car models load (see loadCars)
  const fillLot = (r, bands, stalls, p) => {
    for (let b = 0; b < bands; b++) {
      const x0 = r[0] + b * 18;
      for (let k = 0; k < stalls; k++) {
        const z = r[1] + 1.35 + k * 2.7;
        if (R() < p) cars.push({ x: x0 + 2.75, z, rot: Math.PI / 2 });
        if (R() < p) cars.push({ x: x0 + 18 - 2.75, z, rot: -Math.PI / 2 });
      }
    }
  };
  fillLot(westLot, 6, 47, 0.35);
  fillLot(eastLot, 6, 39, 0.45);
  for (let k = 40; k < 128; k++) if (R() < 0.55) cars.push({ x: southLot[0] + (R() < 0.5 ? 2.75 : 15.25), z: southLot[1] + 1.35 + k * 2.7, rot: Math.PI / 2 });
  for (let i = 0; i < 5; i++) {
    const [x, z] = sat(930 + (i % 2) * 20, 680 + i * 16);
    cars.push({ x, z, rot: 0, truck: true });
  }
  {
    const body = new THREE.BoxGeometry(1.8, 0.65, 4.5);
    body.translate(0, 0.6, 0);
    const cabin = new THREE.BoxGeometry(1.6, 0.55, 2.3);
    cabin.translate(0, 1.2, -0.2);
    const wheel = new THREE.CylinderGeometry(0.34, 0.34, 1.86, 14);
    wheel.rotateZ(Math.PI / 2);
    const bodyM = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.55 }), cars.length);
    const cabM = new THREE.InstancedMesh(cabin, new THREE.MeshStandardMaterial({ color: '#1b2530', roughness: 0.05, metalness: 0.4, envMapIntensity: 1.6 }), cars.length);
    const wheelM = new THREE.InstancedMesh(wheel, new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.8 }), cars.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), upv = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    cars.forEach((c, i) => {
      q.setFromAxisAngle(upv, c.rot);
      s.set(c.truck ? 1.2 : 1, c.truck ? 1.3 : 1, c.truck ? 1.3 : 1);
      m.compose(new THREE.Vector3(c.x, 0, c.z), q, s);
      bodyM.setMatrixAt(i, m);
      bodyM.setColorAt(i, col.set(c.truck ? '#f2f2f0' : carColors[Math.floor(R() * carColors.length)]));
      cabM.setMatrixAt(i, m);
      for (let k = 0; k < 2; k++) {
        const off = new THREE.Vector3(0, 0.34, k ? 1.4 : -1.4).applyQuaternion(q);
        m.compose(new THREE.Vector3(c.x + off.x, off.y, c.z + off.z), q, s);
        wheelM.setMatrixAt(i * 2 + k, m);
      }
      const hw = Math.abs(Math.sin(c.rot)) > 0.5 ? [2.25, 0.95] : [0.95, 2.25];
      world.add(c.x - hw[0], 0, c.z - hw[1], c.x + hw[0], 1.5, c.z + hw[1], 20);
    });
    for (const im of [bodyM, cabM, wheelM]) {
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
    boxCars.push(bodyM, cabM, wheelM);
  }
  // school buses: along the bus lane and parked in the south lot
  {
    const buses = [];
    for (let i = 0; i < 4; i++) { const [x, z] = sat(470 + i * 30, 900); buses.push({ x, z, rot: 0 }); }
    for (let i = 0; i < 8; i++) { const [x, z] = sat(438 + i * 17, 958); buses.push({ x, z, rot: 0.45 }); }
    const g = new GeoBuilder();
    const Y = C('#f2b705'), K = C('#1a1a1a'), Wd = C('#22303b');
    g.box(-1.25, 0.45, -5.9, 1.25, 3.0, 5.9, Y);
    g.box(-1.26, 1.7, -5.3, 1.26, 2.45, 5.2, Wd);
    g.box(-1.27, 1.05, -5.9, 1.27, 1.2, 5.9, K);
    g.box(-1.22, 0.45, -6.5, 1.22, 1.6, -5.9, Y);
    g.box(-1.1, 0.0, -5.0, 1.1, 0.45, -3.6, K);
    g.box(-1.1, 0.0, 2.8, 1.1, 0.45, 4.6, K);
    const geo = g.build();
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 }), buses.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), upv = new THREE.Vector3(0, 1, 0);
    buses.forEach((b, i) => {
      q.setFromAxisAngle(upv, b.rot);
      m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m4);
      const cs = Math.abs(Math.cos(b.rot)), sn = Math.abs(Math.sin(b.rot));
      const hx = 1.3 * cs + 6.5 * sn, hz = 1.3 * sn + 6.5 * cs;
      world.add(b.x - hx, 0, b.z - hz, b.x + hx, 3, b.z + hz, 20);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
  }
  // parking-lot light poles
  for (const r of [westLot, eastLot])
    for (let x = r[0] + 18; x < r[2] - 1; x += 36)
      for (let z = r[1] + 20; z < r[3] - 5; z += 40) {
        box('metal', x - 0.12, 0, z - 0.12, x + 0.12, 9, z + 0.12, WHITE, true);
        box('frame', x - 0.9, 9, z - 0.3, x + 0.9, 9.25, z + 0.3, WHITE, false);
        B.get('light').hquad(x - 0.8, z - 0.25, x + 0.8, z + 0.25, 8.99, false);
      }

  // ------------------------------------------------------------------ walks
  walk([[597, 690], [597, 900]]);
  walk([[585, 780], [612, 780]]);
  walk([[935, 830], [1031, 868]]);
  walk([[935, 792], [1031, 760]]);
  walk([[935, 740], [1031, 740]]);
  walk([[500, 668], [500, 648]], 3);
  walk([[712, 560], [728, 560]]);
  walk([[330, 668], [330, 1035]], 1.8);
  // entrance plaza between the porch and the bus lane
  {
    const [px0, pz0, px1, pz1] = [wx(PORCH[0]), wz(PORCH[1]), wx(PORCH[2]), wz(PORCH[3])];
    const [laneX] = sat(0, 899);
    const plaza = [laneX, pz0 - 12, px0, pz1 + 12];
    flat('walk', plaza, 0.05, C('#dcd8cf'));
    mapShapes.push({ kind: 'rect', r: plaza, color: '#d6d1c6' });
    // planters with shrubs flanking the plaza
    for (const z of [pz0 - 9, pz1 + 9]) {
      box('concrete', laneX + 2, 0, z - 1.6, px0 - 2, 0.55, z + 1.6, C('#c9c3b6'), true, 23);
      B.get('grass').hquad(laneX + 2.2, z - 1.4, px0 - 2.2, z + 1.4, 0.56, true);
    }
    avoid.push([laneX - 2, pz0 - 14, px1, pz1 + 14]);
    areas.push({ name: 'Front Entrance', r: [laneX - 6, pz0 - 30, px1 + 1, pz1 + 30] });
  }

  // ------------------------------------------------------------------ flagpole + monument signs
  const [fpX, fpZ] = sat(760, 893);
  box('metal', fpX - 0.09, 0, fpZ - 0.09, fpX + 0.09, 13, fpZ + 0.09, WHITE, true);
  box('concrete', fpX - 1.2, 0, fpZ - 1.2, fpX + 1.2, 0.3, fpZ + 1.2, C('#cfc9bc'), true, 23);
  const flag = makeFlag();
  flag.position.set(fpX, 11.4, fpZ + 0.06);
  flag.rotation.y = -Math.PI / 2;
  scene.add(flag);
  const monument = (sx, sy) => {
    const [x, z] = sat(sx, sy);
    B.get('brick').box(x - 0.7, 0, z - 3.4, x + 0.7, 0.75, z + 3.4);
    B.get('brick').box(x - 0.4, 0.75, z - 3.2, x + 0.4, 2.8, z + 3.2);
    B.get('paint').box(x - 0.5, 2.8, z - 3.3, x + 0.5, 2.95, z + 3.3, C('#d9d2c2'));
    world.add(x - 0.7, 0, z - 3.4, x + 0.7, 2.95, z + 3.4, 20);
    const tex = textTexture([
      { text: 'West Windsor-Plainsboro', size: 0.2 },
      { text: 'High School North', size: 0.24 },
      { text: '90 Grovers Mill Road', size: 0.13, weight: 'normal', color: '#ffffff' },
      { text: 'HOME OF THE KNIGHTS', size: 0.16, color: '#ffffff' },
    ], { w: 1024, h: 340, bg: '#1f3f8f', fg: '#d5dde8' });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.15 });
    for (const s of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.0), mat);
      pl.position.set(x + s * 0.41, 1.75, z);
      pl.rotation.y = (s * Math.PI) / 2;
      scene.add(pl);
    }
  };
  monument(985, 1016);
  monument(282, 1016);

  // ------------------------------------------------------------------ stadium (regulation track + field)
  const stadium = (() => {
    const [cx, cz] = sat(504.5, 568.5);
    const SW = 190, SH = 100; // texture footprint; field length along world Z
    const tex = makeStadiumTexture(SW, SH);
    const g = new THREE.PlaneGeometry(SW, SH);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(g, offset(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), -1));
    m.position.set(cx, 0.04, cz);
    m.receiveShadow = true;
    scene.add(m);
    avoid.push([cx - SH / 2 - 16, cz - SW / 2 - 14, cx + SH / 2 + 22, cz + SW / 2 + 6]);
    mapShapes.push({ kind: 'track', at: [cx, cz] });
    mapShapes.push({ kind: 'label', at: [cx, cz], text: 'KNIGHTS STADIUM', color: '#ffffff', size: 6 });
    areas.push({ name: 'Football Stadium', r: [cx - 62, cz - 104, cx + 64, cz + 100] });
    const trackHalfW = 46.3, trackHalfL = 88.5;
    // home grandstand + press box (north side, as on the photo)
    const gx0 = cx + trackHalfW + 2.5, rows = 12, depth = 0.85, rise = 0.42;
    const gz0 = cz - 24, gz1 = cz + 24;
    for (let i = 0; i < rows; i++) {
      const x0 = gx0 + i * depth, top = (i + 1) * rise;
      box('satin', x0, top - 0.1, gz0, x0 + depth, top, gz1, C(i % 2 ? '#b9bec3' : '#a9aeb3'), false);
      box('paint', x0 + depth - 0.06, 0, gz0, x0 + depth, top - 0.1, gz1, C('#6f757b'), false);
      world.add(x0, 0, gz0, x0 + depth, top, gz1, 21);
    }
    const gx1 = gx0 + rows * depth;
    box('paint', gx1, 0, gz0, gx1 + 0.08, rows * rise + 1.1, gz1, C('#6f757b'));
    for (const z of [gz0 - 1.4, gz1]) for (let i = 0; i < rows; i++) box('satin', gx0 + i * depth, 0, z, gx0 + (i + 1) * depth, (i + 1) * rise, z + 1.4, C('#8e949a'));
    // press box with a blue roof
    const pbY = rows * rise;
    box('paint', gx1 - 4, pbY, cz - 10, gx1 + 0.2, pbY + 3.2, cz + 10, C('#e7e1d4'));
    box('satin', gx1 - 4.02, pbY + 1.2, cz - 9.5, gx1 - 3.99, pbY + 2.6, cz + 9.5, C('#243746'), false);
    box('satin', gx1 - 4.4, pbY + 3.2, cz - 10.4, gx1 + 0.5, pbY + 3.5, cz + 10.4, C('#2a55b8'), false);
    box('paint', gx1, 0, cz - 10, gx1 + 0.2, pbY, cz + 10, C('#9aa0a6'));
    // visitor bleachers (south side)
    const vx0 = cx - trackHalfW - 1.5;
    for (let i = 0; i < 6; i++) {
      const x1 = vx0 - i * 0.8, top = (i + 1) * 0.42;
      box('satin', x1 - 0.8, top - 0.1, cz - 20, x1, top, cz + 20, C(i % 2 ? '#b9bec3' : '#a9aeb3'), false);
      world.add(x1 - 0.8, 0, cz - 20, x1, top, cz + 20, 21);
    }
    // goal posts at the ends of the field (field runs along Z)
    for (const s of [-1, 1]) {
      const gz = cz + s * (109.7 / 2);
      const y = C('#f2c230');
      box('satin', cx - 0.1, 0, gz - 0.1, cx + 0.1, 3.05, gz + 0.1, y);
      box('satin', cx - 2.83, 3.0, gz - 0.08, cx + 2.83, 3.1, gz + 0.08, y, false);
      for (const xx of [cx - 2.83, cx + 2.83]) box('satin', xx - 0.06, 3.0, gz - 0.06, xx + 0.06, 9.1, gz + 0.06, y, false);
    }
    // scoreboard beyond the west end zone
    const sbz = cz - trackHalfL - 8;
    box('satin', cx - 6, 0, sbz - 0.3, cx - 5.4, 6, sbz + 0.3, C('#555'));
    box('satin', cx + 5.4, 0, sbz - 0.3, cx + 6, 6, sbz + 0.3, C('#555'));
    box('satin', cx - 7, 6, sbz - 0.25, cx + 7, 11.5, sbz + 0.25, C('#1b1b1b'));
    const sbt = textTexture([
      { text: 'WW-P NORTH KNIGHTS', size: 0.17, color: '#d5dde8' },
      { text: 'KNIGHTS  21   GUESTS  14', size: 0.26, font: 'monospace', color: '#ff5533' },
      { text: 'QTR 4    DOWN 2', size: 0.18, font: 'monospace', color: '#ffffff' },
    ], { w: 1024, h: 400, bg: '#111', border: false });
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 5.3), new THREE.MeshBasicMaterial({ map: sbt }));
    sb.position.set(cx, 8.75, sbz + 0.27);
    scene.add(sb);
    // chain-link fence around the track
    const fx0 = cx - trackHalfW - 0.8, fx1 = cx + trackHalfW + 1.5, fz0 = cz - trackHalfL - 2, fz1 = cz + trackHalfL + 2;
    const fc = C('#5f666d');
    for (const [a0, a1, xx] of [[fz0, fz1, fx0]]) {
      box('satin', xx - 0.03, 1.1, a0, xx + 0.03, 1.16, cz - 21, fc, false);
      box('satin', xx - 0.03, 1.1, cz + 21, xx + 0.03, 1.16, a1, fc, false);
    }
    for (const zz of [fz0, fz1]) {
      box('satin', fx0, 1.1, zz - 0.03, fx1, 1.16, zz + 0.03, fc, false);
      world.add(fx0, 0, zz - 0.05, fx1, 1.16, zz + 0.05, 22);
    }
    // long-jump runway (red strip, south-east of the track)
    {
      const [jx, jz] = sat(665, 615);
      const gg = new THREE.PlaneGeometry(4, 40);
      gg.rotateX(-Math.PI / 2);
      const jm = new THREE.Mesh(gg, offset(new THREE.MeshStandardMaterial({ color: '#a4442f', roughness: 0.9 }), -2));
      jm.position.set(jx, 0.045, jz);
      jm.rotation.y = 0.95;
      jm.receiveShadow = true;
      scene.add(jm);
    }
    return { x: cx, z: cz, w: SW, h: SH };
  })();

  // ------------------------------------------------------------------ tennis courts (6, L-shaped)
  {
    const pad = C('#8a9ea3'), court = C('#2e5fa6'), line = C('#f5f5f5');
    const pads = [satRect(207, 690, 272, 758), satRect(152, 758, 274, 822)];
    for (const p of pads) { flat('decal', p, 0.04, pad); mapShapes.push({ kind: 'rect', r: p, color: '#8a9ea3' }); }
    const centers = [[225, 723], [253.5, 723], [170, 789], [198, 789], [226.8, 789], [254.5, 789]];
    for (const [sx, sy] of centers) {
      const [x, z] = sat(sx, sy);
      const hl = 11.885 + 2, hw = 5.485 + 1.5;
      B.get('decal').hquad(x - hl, z - hw, x + hl, z + hw, 0.045, true, court);
      mapShapes.push({ kind: 'rect', r: [x - hl, z - hw, x + hl, z + hw], color: '#2e5fa6' });
      const ln = (x0, z0, x1, z1) => B.get('decal').hquad(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), 0.05, true, line);
      const L = 11.885, Wd = 5.485, Ws = 4.115, SV = 6.4;
      ln(x - L, z - Wd, x + L, z - Wd + 0.05); ln(x - L, z + Wd - 0.05, x + L, z + Wd);
      ln(x - L, z - Ws, x + L, z - Ws + 0.05); ln(x - L, z + Ws - 0.05, x + L, z + Ws);
      ln(x - L, z - Wd, x - L + 0.05, z + Wd); ln(x + L - 0.05, z - Wd, x + L, z + Wd);
      ln(x - SV, z - Ws, x - SV + 0.05, z + Ws); ln(x + SV - 0.05, z - Ws, x + SV, z + Ws);
      ln(x - SV, z - 0.025, x + SV, z + 0.025);
      // net across the middle (courts run along world X)
      box('satin', x - 0.02, 0, z - Wd - 0.9, x + 0.02, 0.95, z + Wd + 0.9, C('#1c1c1c'));
      box('satin', x - 0.03, 0.92, z - Wd - 0.9, x + 0.03, 0.98, z + Wd + 0.9, C('#ffffff'), false);
      for (const zz of [z - Wd - 0.9, z + Wd + 0.9]) box('metal', x - 0.05, 0, zz - 0.05, x + 0.05, 1.07, zz + 0.05, WHITE, false);
    }
    // fence around the L
    const fenceMat = new THREE.MeshStandardMaterial({ color: '#1f2e2a', transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, roughness: 0.8 });
    const fence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, 3.2), fenceMat);
      f.position.set((x0 + x1) / 2, 1.6, (z0 + z1) / 2);
      f.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      scene.add(f);
      world.add(Math.min(x0, x1) - 0.05, 0, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, 3.2, Math.max(z0, z1) + 0.05, 22);
      for (let t = 0; t <= len; t += 3) {
        const px = x0 + ((x1 - x0) * t) / len, pz = z0 + ((z1 - z0) * t) / len;
        B.get('satin').box(px - 0.04, 0, pz - 0.04, px + 0.04, 3.25, pz + 0.04, C('#2b3431'));
      }
    };
    const [t0, b0] = pads;
    // outline of the L: bottom pad full, top pad above its right part; gate gap on the east side
    fence(b0[0], b0[1], b0[0], b0[3]);
    fence(b0[0], b0[1], b0[2], b0[1]);
    fence(b0[2], b0[1], b0[2], t0[1]);
    fence(t0[0], t0[1], t0[2], t0[1]);
    fence(t0[2], t0[1], t0[2], t0[3]);
    fence(b0[0], b0[3], t0[0], b0[3]);
    fence(t0[0], t0[3], t0[0], (t0[1] + t0[3]) / 2 + 1.5);
    fence(t0[0], (t0[1] + t0[3]) / 2 - 1.5, t0[0], t0[1]);
    avoid.push([b0[0] - 4, b0[1] - 4, t0[2] + 4, b0[3] + 4]);
    mapShapes.push({ kind: 'label', at: sat(213, 757), text: 'TENNIS', color: '#ffffff', size: 6 });
    areas.push({ name: 'Tennis Courts', r: [b0[0] - 3, b0[1] - 3, t0[2] + 3, b0[3] + 3] });
  }

  // ------------------------------------------------------------------ practice fields (north)
  {
    const r = satRect(40, 30, 790, 478);
    const tex = makeFieldsTexture();
    // canvas right = east (+Z), canvas top = north (+X)
    const g = new THREE.PlaneGeometry(r[3] - r[1], r[2] - r[0]);
    g.rotateX(-Math.PI / 2);
    g.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(g, offset(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, normalMap: T.grassN }), -1));
    m.position.set((r[0] + r[2]) / 2, 0.02, (r[1] + r[3]) / 2);
    m.receiveShadow = true;
    scene.add(m);
    mapShapes.push({ kind: 'fields', r, tex });
    mapShapes.push({ kind: 'label', at: sat(400, 238), text: 'PRACTICE FIELDS', color: '#ffffff', size: 7 });
    // soccer goals, softball backstops
    const goal = (sx, sy, facing) => {
      const [x, z] = sat(sx, sy);
      const w = 3.66, h = 2.44;
      const wc = C('#f4f4f4');
      box('satin', x - 0.06, 0, z - w - 0.06, x + 0.06, h, z - w + 0.06, wc, true, 24);
      box('satin', x - 0.06, 0, z + w - 0.06, x + 0.06, h, z + w + 0.06, wc, true, 24);
      box('satin', x - 0.06, h - 0.12, z - w, x + 0.06, h, z + w, wc, false);
      box('satin', x + facing * 1.8 - 0.04, 0, z - w, x + facing * 1.8 + 0.04, 0.08, z + w, wc, false);
    };
    for (const sx of [375, 494]) { goal(sx, 52, 1); goal(sx, 211, -1); }
    for (const sx of [343, 343]) { goal(sx - 0, 290, 0); }
    const backstop = (sx, sy) => {
      const [x, z] = sat(sx, sy);
      const mat = new THREE.MeshStandardMaterial({ color: '#2b3431', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
      const arc = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 5, 16, 1, true, Math.PI * 0.75, Math.PI * 0.5), mat);
      arc.position.set(x, 2.5, z);
      scene.add(arc);
      world.add(x - 9, 0, z - 6.5, x - 6, 5, z + 6.5, 24);
    };
    backstop(634, 212);
    backstop(598, 334);
    for (const [sx, sy] of [[620, 215], [590, 336]]) {
      const [x, z] = sat(sx, sy);
      box('satin', x - 3, 0, z - 1, x + 3, 0.45, z + 1, C('#6f757b'), true, 24);
    }
  }

  // lined practice field west of the stadium
  {
    const r = satRect(52, 548, 152, 652);
    const line = C('#f4f4f0');
    const ln = (x0, z0, x1, z1) => B.get('decal').hquad(x0, z0, x1, z1, 0.03, true, line);
    ln(r[0], r[1], r[2], r[1] + 0.12); ln(r[0], r[3] - 0.12, r[2], r[3]);
    ln(r[0], r[1], r[0] + 0.12, r[3]); ln(r[2] - 0.12, r[1], r[2], r[3]);
    for (let x = r[0] + 4.57; x < r[2] - 1; x += 4.57) ln(x - 0.06, r[1], x + 0.06, r[3]);
    mapShapes.push({ kind: 'rect', r, color: '#79a456' });
  }

  // ------------------------------------------------------------------ small buildings
  const gableHouse = (x, z, w, d, h, wallC, roofC, rotY = 0) => {
    const grp = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: wallC, roughness: 0.8 }));
    walls.position.y = h / 2;
    const roofG = new THREE.CylinderGeometry(0.01, w * 0.62, d * 1.02, 4, 1);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.56, h * 0.55, 4), new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.7 }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.hypot(w, d) * 1.45, 1, d / Math.hypot(w, d) * 1.45);
    roof.position.y = h + h * 0.27;
    roofG.dispose();
    grp.add(walls, roof);
    grp.position.set(x, 0, z);
    grp.rotation.y = rotY;
    grp.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    scene.add(grp);
    const hw = Math.max(w, d) / 2;
    world.add(x - hw, 0, z - hw, x + hw, h * 1.5, z + hw, 25);
  };
  { const [x0, z0, x1, z1] = satRect(234, 514, 272, 545); gableHouse((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 4.5, '#d9d2c2', '#3f7b62'); mapShapes.push({ kind: 'rect', r: [x0, z0, x1, z1], color: '#3f7b62' }); mapShapes.push({ kind: 'label', at: [(x0 + x1) / 2 - 12, (z0 + z1) / 2], text: 'FIELD HOUSE', color: '#ffffff', size: 4.5 }); areas.push({ name: 'Field House', r: [x0 - 8, z0 - 8, x1 + 8, z1 + 8] }); }
  { const [x, z] = sat(313, 538); gableHouse(x, z, 10, 12, 3.4, '#8f8a80', '#2f3336', 0.5); }
  { const r = satRect(977, 664, 1003, 699); box('brick', r[0], 0, r[1], r[2], 4, r[3]); box('roof', r[0], 4, r[1], r[2], 4.2, r[3], WHITE, false); mapShapes.push({ kind: 'rect', r, color: '#9b5b45' }); }
  { const r = satRect(965, 573, 988, 594); box('concrete', r[0], 0, r[1], r[2], 2.2, r[3], C('#b8b2a6')); }
  for (const [sx, sy, rot] of [[1225, 962, 0.2], [1266, 975, -0.1], [1245, 930, 0.35]]) { const [x, z] = sat(sx, sy); gableHouse(x, z, 10, 13, 5.5, '#e8e2d4', '#5a4a3f', rot); }
  // bus shelter at the east lot
  { const r = satRect(1185, 806, 1228, 812); box('satin', r[0], 2.6, r[1], r[2], 2.8, r[3], C('#c4552e'), false); for (const z of [r[1] + 0.3, r[3] - 0.3]) box('metal', r[0] + 0.3, 0, z - 0.06, r[0] + 0.42, 2.6, z + 0.06); }
  // Community Middle School, across Grovers Mill Road (stand-in massing)
  {
    const r = satRect(260, 1085, 700, 1210);
    const h = 8.2;
    box('brick', r[0], 0, r[1], r[2], h, r[3]);
    box('roof', r[0] + 0.3, h - 0.3, r[1] + 0.3, r[2] - 0.3, h, r[3] - 0.3, WHITE, false);
    B.get('paint').box(r[0] - 0.05, h, r[1] - 0.05, r[2] + 0.05, h + 0.15, r[3] + 0.05, C('#d9d2c2'));
    for (const y0 of [1.0, 5.0]) for (let z = r[1] + 4; z < r[3] - 4; z += 3.6) B.get('satin').box(r[2], y0, z, r[2] + 0.03, y0 + 1.6, z + 2.0, C('#243746'), 'X');
    const t = textTexture([{ text: 'COMMUNITY MIDDLE SCHOOL', size: 0.62 }], { w: 1400, h: 150, bg: '#2b3440', fg: '#ffffff', border: false });
    const sgn = new THREE.Mesh(new THREE.PlaneGeometry(16, 1.7), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
    sgn.position.set(r[2] + 0.05, 3.3, (r[1] + r[3]) / 2);
    sgn.rotation.y = Math.PI / 2;
    scene.add(sgn);
    mapShapes.push({ kind: 'rect', r, color: '#b9b2a4' });
    mapShapes.push({ kind: 'label', at: [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], text: 'COMMUNITY MIDDLE SCHOOL', color: '#3a3530' });
    avoid.push([r[0] - 6, r[1] - 6, r[2] + 6, r[3] + 6]);
    areas.push({ name: 'Community Middle School', r: [r[0] - 25, r[1] - 25, r[2] + 12, r[3] + 25] });
    road([[480, GM_Y], [480, 1085]], 7);
  }

  // ------------------------------------------------------------------ creek + woods
  const creek = [[905, -10], [912, 40], [935, 100], [965, 150], [1005, 200], [1045, 250], [1075, 300], [1095, 330], [1140, 352], [1210, 362], [1300, 368]].map(([a, b]) => sat(a, b));
  {
    const wm = offset(new THREE.MeshStandardMaterial({ color: '#3f5a55', roughness: 0.08, metalness: 0.1, envMapIntensity: 1.2 }), -2);
    const g = new GeoBuilder();
    strip(g, creek, 4.5, 0.06);
    const mesh = new THREE.Mesh(g.build(), wm);
    mesh.receiveShadow = true;
    scene.add(mesh);
    mapShapes.push({ kind: 'line', pts: creek, width: 4.5, color: '#4f7f8a' });
  }
  const woods = [[645, 0], [1290, 0], [1290, 375], [1200, 385], [1120, 445], [1060, 520], [990, 560], [955, 545], [940, 470], [790, 470], [780, 245], [660, 245], [650, 120]].map(([a, b]) => sat(a, b));
  mapShapes.push({ kind: 'poly', pts: woods, color: '#3e6b35' });

  // ------------------------------------------------------------------ trees
  const trees = [];
  const treeMeshes = []; // low-poly stand-ins until the tree sprites load (see loadTrees)
  const blocked = (x, z) => avoid.some((r) => inRect(r, x, z)) || lots.some((r) => inRect(r, x, z, 3)) || inRect(yard, x, z, 3) ||
    paved.some(([a, b, hw]) => segDist(x, z, a, b) < hw + 2.2);
  const tryTree = (x, z, s = 1, kind = null) => {
    if (blocked(x, z)) return false;
    trees.push({ x, z, s, h: 0.8 + R() * 0.6, kind: kind ?? (R() < 0.25 ? 1 : 0) });
    return true;
  };
  // woods: jittered grid inside the polygon, keeping the creek clear
  const nearCreek = (x, z) => creek.some((p, i) => i > 0 && segDist(x, z, creek[i - 1], p) < 4);
  {
    const xs = woods.map((p) => p[0]), zs = woods.map((p) => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 8.5)
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 8.5) {
        const px = x + (R() - 0.5) * 6, pz = z + (R() - 0.5) * 6;
        if (!inPoly(woods, px, pz) || nearCreek(px, pz)) continue;
        tryTree(px, pz, 1.1 + R() * 0.5, R() < 0.18 ? 1 : 0);
      }
  }
  // tree line along the west edge of the campus
  for (let sy = 0; sy < 1000; sy += 12) for (const sx of [12, 30]) { const [x, z] = sat(sx + R() * 8, sy + R() * 8); tryTree(x, z, 1 + R() * 0.4); }
  // clusters seen on the photo
  const clusters = [[250, 560, 14], [560, 480, 10], [620, 470, 10], [600, 520, 6], [650, 690, 8], [540, 890, 10], [410, 890, 8], [1048, 700, 5], [1048, 800, 5], [1100, 880, 14], [1200, 860, 18], [1150, 640, 8], [980, 900, 8], [880, 900, 6], [700, 560, 6], [200, 470, 6], [760, 720, 6], [980, 770, 6]];
  for (const [sx, sy, n] of clusters) for (let i = 0; i < n; i++) { const [x, z] = sat(sx + (R() - 0.5) * 50, sy + (R() - 0.5) * 30); tryTree(x, z, 0.8 + R() * 0.4); }
  {
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.2, 7);
    trunk.translate(0, 1.6, 0);
    const leafy = new THREE.IcosahedronGeometry(2.7, 1);
    const pos = leafy.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const k = 1 + Math.sin(v.x * 3.1 + v.z * 2.3) * 0.12 + Math.cos(v.y * 2.7) * 0.1;
      pos.setXYZ(i, v.x * k, v.y * k * 0.9, v.z * k);
    }
    leafy.computeVertexNormals();
    leafy.translate(0, 4.8, 0);
    const pine = new THREE.ConeGeometry(2.3, 6.8, 9);
    pine.translate(0, 5.1, 0);
    const trunkM = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#56402f', roughness: 0.95 }), trees.length);
    const leafM = new THREE.InstancedMesh(leafy, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), trees.length);
    const pineM = new THREE.InstancedMesh(pine, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), trees.length);
    let nl = 0, np = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), upv = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(upv, R() * 6.28);
      const k = t.s * t.h * 1.15;
      sc.set(k, k * (0.9 + R() * 0.3), k);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, sc);
      trunkM.setMatrixAt(i, m);
      if (t.kind === 1) {
        pineM.setMatrixAt(np, m);
        pineM.setColorAt(np++, col.setHSL(0.33 + R() * 0.05, 0.42, 0.18 + R() * 0.07));
      } else {
        leafM.setMatrixAt(nl, m);
        leafM.setColorAt(nl++, col.setHSL(0.2 + R() * 0.1, 0.42 + R() * 0.2, 0.24 + R() * 0.1));
      }
      world.add(t.x - 0.32 * k, 0, t.z - 0.32 * k, t.x + 0.32 * k, 3.2 * k, t.z + 0.32 * k, 24);
    });
    leafM.count = nl;
    pineM.count = np;
    for (const im of [trunkM, leafM, pineM]) {
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
    treeMeshes.push(trunkM, leafM, pineM);
  }
  // shrubs in mulch beds along the building's south face, as in the photos
  {
    const shrubs = [];
    const porchZone = [wx(PORCH[0]) - 3, wz(PORCH[1]) - 13, wx(PORCH[2]), wz(PORCH[3]) + 13];
    const bedOk = (x, z) => !inRect(porchZone, x, z) && !info.entrances.some((e) => Math.hypot(e.axis === 'x' ? e.c - x : 0, e.mid - z) < e.w);
    for (const { r } of info.blockRects) {
      if (r[0] > 12) continue;
      for (let z = r[1] + 1; z < r[3] - 1; z += 2.3) {
        const x = r[0] - 1.6;
        if (!bedOk(x, z)) continue;
        if (R() < 0.85) shrubs.push([x + (R() - 0.5) * 0.5, z]);
      }
      let start = null;
      for (let z = r[1] + 0.5; z <= r[3] - 0.5; z += 0.5) {
        const ok = bedOk(r[0] - 1.6, z);
        if (ok && start === null) start = z;
        const last = z + 0.5 > r[3] - 0.5;
        if (start !== null && (!ok || last)) {
          flat('decal', [r[0] - 2.8, start - 0.25, r[0] - 0.33, (ok ? z : z - 0.5) + 0.25], 0.035, C('#3b2b22'));
          start = null;
        }
      }
    }
    // a lumpy, clipped mound with a leafy surface (not a faceted ball)
    const g = new THREE.SphereGeometry(0.85, 28, 18);
    const pos = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      v.multiplyScalar(1 + 0.08 * Math.sin(n.x * 7.1 + n.y * 3.7) * Math.cos(n.z * 6.3 - n.y * 4.1) + 0.04 * Math.sin(n.x * 17 + n.z * 13 + n.y * 5));
      if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.25; // sits on the mulch, flat underneath
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    g.translate(0, 0.38, 0);
    // sphere UVs wrap once around, so repeat the 0.6 m leaf tile about 9 x 4.5 times
    const [fm, fn] = [T.foliage.clone(), T.foliageN.clone()];
    for (const t of [fm, fn]) { t.repeat.set(9, 4.5); t.needsUpdate = true; }
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: fm, normalMap: fn, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.85 }), shrubs.length);
    const mm = new THREE.Matrix4(), col = new THREE.Color();
    shrubs.forEach(([x, z], i) => {
      mm.makeScale(1 + R() * 0.4, 0.8 + R() * 0.4, 1 + R() * 0.4);
      mm.setPosition(x, 0, z);
      im.setMatrixAt(i, mm);
      im.setColorAt(i, col.setHSL(0.22 + R() * 0.07, 0.5, 0.3 + R() * 0.08));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
  }

  // ground-level layers are coplanar-ish, so push them apart in depth instead of in height
  const EM = { ...M, grass: offset(M.grass.clone(), 2), asphalt: offset(M.asphalt.clone(), -1), walk: offset(M.concrete.clone(), -2), decal: offset(M.paint.clone(), -3) };
  for (const m of B.toMeshes(EM)) scene.add(m);

  areas.push({ name: 'Practice Fields', r: satRect(40, 30, 650, 478) });
  areas.push({ name: 'Woods', poly: woods });
  areas.push({ name: 'Grovers Mill Road', r: [sat(0, GM_Y + 12)[0], -1e4, sat(0, GM_Y - 12)[0], 1e4] });
  areas.push({ name: 'Bus Loop', r: [sat(0, 912)[0], sat(300, 0)[1], sat(0, 898)[0], sat(970, 0)[1]] });
  const areaAt = (x, z) => areas.find((a) => (a.r ? inRect(a.r, x, z) : inPoly(a.poly, x, z)))?.name || 'Campus Grounds';

  const [spX, spZ] = [sat(0, 899)[0] + 3, wz(782)];
  return { flag, flagPos: [fpX, fpZ], stadium, lots: { westLot, eastLot, southLot, yard }, mapShapes, woods, areaAt, spawn: [spX, spZ], cars, boxCars, trees, treeMeshes };
}

// Swaps the box stand-in cars for Kenney's Car Kit models (CC0, assets/models/cars), one
// instanced mesh per model. The low-poly kit is chunky, so it is stretched to real proportions.
export async function loadCars(scene, ext, base = 'assets/models/cars/') {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const loader = new GLTFLoader();
  const everyday = ['sedan', 'sedan-sports', 'suv', 'suv-luxury', 'hatchback-sports', 'van'];
  const protos = {};
  await Promise.all([...everyday, 'truck', 'delivery'].map(async (t) => {
    const gltf = await loader.loadAsync(`${base}${t}.glb`);
    gltf.scene.updateMatrixWorld(true);
    const geos = [];
    let mat = null;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      geos.push(g.index ? g : g.toNonIndexed());
      mat = mat || o.material;
    });
    mat.roughness = 0.4;
    mat.metalness = 0.2;
    protos[t] = { geo: mergeGeometries(geos), mat };
  }));
  const R = rng(7);
  const groups = new Map();
  for (const c of ext.cars) {
    const t = c.truck ? (R() < 0.5 ? 'truck' : 'delivery') : everyday[Math.floor(R() * everyday.length)];
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(c);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1.3, 1.6, 1.8), truckScale = new THREE.Vector3(1.45, 1.8, 2.1);
  for (const [t, list] of groups) {
    const { geo, mat } = protos[t];
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((c, i) => {
      q.setFromAxisAngle(up, c.rot);
      m4.compose(new THREE.Vector3(c.x, 0, c.z), q, c.truck ? truckScale : scale);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
  }
  for (const m of ext.boxCars) m.visible = false;
}

// Swaps the low-poly trees for crossed billboards of Poly Haven tree models, pre-rendered in
// Blender (tools/bake/tree_sprites.py, assets/trees). Two sprite views per tree, at right
// angles; normals point up so they shade like foliage lit from above.
export async function loadTrees(scene, ext, base = 'assets/trees/') {
  const meta = await (await fetch(base + 'trees.json')).json();
  const tex = await new THREE.TextureLoader().loadAsync(base + 'trees.webp');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.95, envMapIntensity: 0.6 });
  const rows = meta.rows;
  const cross = (row) => {
    const pos = [], nor = [], uv = [], idx = [];
    for (let k = 0; k < 2; k++) {
      const u0 = k / 2, u1 = (k + 1) / 2, v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows;
      const corners = k === 0 ? [[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0]] : [[0, 0, 0.5], [0, 0, -0.5], [0, 1, -0.5], [0, 1, 0.5]];
      const b = pos.length / 3;
      corners.forEach((c, i) => {
        pos.push(...c);
        nor.push(0, 1, 0);
        uv.push(i === 0 || i === 3 ? u0 : u1, i < 2 ? v0 : v1);
      });
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  };
  const R = rng(11);
  const groups = meta.trees.map(() => []);
  const fir = meta.trees.findIndex((t) => /fir|pine/.test(t.name));
  const broad = meta.trees.map((t, i) => i).filter((i) => i !== fir);
  for (const t of ext.trees) {
    const row = t.kind === 1 && fir >= 0 ? fir : broad[Math.floor(R() * broad.length)];
    groups[row].push(t);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  groups.forEach((list, row) => {
    if (!list.length) return;
    const info = meta.trees[row];
    const im = new THREE.InstancedMesh(cross(row), mat, list.length);
    list.forEach((t, i) => {
      // tall enough to read as campus shade trees: about 8-16 m
      const h = (row === fir ? 11 : 9.5) * t.s * t.h * 1.1;
      const k = h / info.height;
      q.setFromAxisAngle(up, R() * Math.PI);
      m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(info.span * k, info.span * k, info.span * k));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, col.setHSL(0.25 + (R() - 0.5) * 0.06, 0.25, 0.42 + R() * 0.12).lerp(new THREE.Color(1, 1, 1), 0.72));
    });
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
  });
  for (const m of ext.treeMeshes) m.visible = false;
}

function offset(mat, f) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = f;
  mat.polygonOffsetUnits = f * 4;
  return mat;
}

function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}

// Practice fields north of the stadium, drawn in satellite pixel space (sx 40..790, sy 30..478).
function makeFieldsTexture() {
  const k = 2.6;
  const W = Math.round(750 * k), H = Math.round(448 * k);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const X = (sx) => (sx - 40) * k, Y = (sy) => (sy - 30) * k;
  const r = rng(5);
  g.fillStyle = '#6a9a45';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${60 + r() * 60},${110 + r() * 50},${40 + r() * 30},0.12)`;
    g.beginPath();
    g.arc(r() * W, r() * H, 10 + r() * 60, 0, Math.PI * 2);
    g.fill();
  }
  const line = (lw = 2.2) => { g.strokeStyle = 'rgba(250,250,245,0.92)'; g.lineWidth = lw; };
  const mow = (x0, y0, x1, y1, vertical) => {
    for (let i = 0; ; i++) {
      const s = i * 10 * k;
      if (vertical ? X(x0) + s > X(x1) : Y(y0) + s > Y(y1)) break;
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      if (vertical) g.fillRect(X(x0) + s, Y(y0), 10 * k, Y(y1) - Y(y0));
      else g.fillRect(X(x0), Y(y0) + s, X(x1) - X(x0), 10 * k);
    }
  };
  const soccer = (x0, y0, x1, y1, vertical) => {
    mow(x0, y0, x1, y1, !vertical);
    line();
    g.strokeRect(X(x0), Y(y0), X(x1) - X(x0), Y(y1) - Y(y0));
    const cx = (X(x0) + X(x1)) / 2, cy = (Y(y0) + Y(y1)) / 2;
    g.beginPath();
    if (vertical) { g.moveTo(X(x0), cy); g.lineTo(X(x1), cy); } else { g.moveTo(cx, Y(y0)); g.lineTo(cx, Y(y1)); }
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 16.5 * k, 0, Math.PI * 2);
    g.stroke();
    const bw = 40 * k * 0.9, bd = 16.5 * k * 0.9;
    if (vertical) {
      g.strokeRect(cx - bw / 2, Y(y0), bw, bd);
      g.strokeRect(cx - bw / 2, Y(y1) - bd, bw, bd);
    } else {
      g.strokeRect(X(x0), cy - bw / 2, bd, bw);
      g.strokeRect(X(x1) - bd, cy - bw / 2, bd, bw);
    }
  };
  const hockey = (x0, y0, x1, y1) => {
    mow(x0, y0, x1, y1, true);
    line();
    g.strokeRect(X(x0), Y(y0), X(x1) - X(x0), Y(y1) - Y(y0));
    const cy = (Y(y0) + Y(y1)) / 2, cx = (X(x0) + X(x1)) / 2;
    g.beginPath(); g.moveTo(cx, Y(y0)); g.lineTo(cx, Y(y1)); g.stroke();
    for (const [x, dir] of [[X(x0), 1], [X(x1), -1]]) {
      g.beginPath();
      g.arc(x, cy, 26 * k, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
      g.stroke();
    }
  };
  const diamond = (hx, hy, a0, a1, rad) => {
    // dirt infield sector, grass beyond, foul lines
    g.fillStyle = '#c9a27a';
    g.beginPath();
    g.moveTo(X(hx), Y(hy));
    g.arc(X(hx), Y(hy), rad * k, a0, a1);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(120,80,40,0.15)';
    for (let i = 0; i < 300; i++) g.fillRect(X(hx) + (r() - 0.5) * rad * k * 1.4, Y(hy) + (r() - 0.5) * rad * k * 1.4, 2, 2);
    line(2);
    for (const a of [a0, a1]) {
      g.beginPath();
      g.moveTo(X(hx), Y(hy));
      g.lineTo(X(hx) + Math.cos(a) * rad * 1.9 * k, Y(hy) + Math.sin(a) * rad * 1.9 * k);
      g.stroke();
    }
    const mid = (a0 + a1) / 2;
    g.fillStyle = '#b48c62';
    g.beginPath();
    g.arc(X(hx) + Math.cos(mid) * rad * 0.55 * k, Y(hy) + Math.sin(mid) * rad * 0.55 * k, 4 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    for (const [dx, dy] of [[0, 0], [Math.cos(a0) * 0.45, Math.sin(a0) * 0.45], [Math.cos(a1) * 0.45, Math.sin(a1) * 0.45], [Math.cos(mid) * 0.64, Math.sin(mid) * 0.64]])
      g.fillRect(X(hx) + dx * rad * k - 3, Y(hy) + dy * rad * k - 3, 6, 6);
  };
  soccer(318, 48, 432, 215, true);
  soccer(436, 48, 552, 215, true);
  soccer(250, 245, 435, 335, false);
  soccer(255, 365, 435, 460, false);
  hockey(50, 245, 245, 355);
  hockey(50, 365, 245, 470);
  diamond(632, 210, Math.PI, Math.PI * 1.5, 75);
  diamond(598, 332, Math.PI * 1.25, Math.PI * 1.75, 60);
  diamond(238, 108, Math.PI, Math.PI * 1.5, 30);
  // striped practice field
  mow(665, 250, 770, 430, false);
  line(2);
  g.strokeRect(X(668), Y(252), X(768) - X(668), Y(428) - Y(252));
  for (let y = 252; y < 428; y += 9) { g.beginPath(); g.moveTo(X(668), Y(y)); g.lineTo(X(768), Y(y)); g.stroke(); }
  // gravel paths between the fields
  g.strokeStyle = 'rgba(220,210,190,0.75)';
  g.lineWidth = 3 * k;
  for (const [a, b, cc, d] of [[45, 235, 650, 235], [45, 360, 250, 360], [250, 40, 250, 470], [437, 240, 437, 470], [655, 240, 655, 470], [45, 40, 45, 470]]) {
    g.beginPath(); g.moveTo(X(a), Y(b)); g.lineTo(X(cc), Y(d)); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
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
      g.beginPath();
      g.arc(12 + k * 25 + (r % 2 ? 12 : 0), 8 + r * 11.5, 3, 0, Math.PI * 2);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(2.8, 1.5, 16, 6);
  geo.translate(1.4, 0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 }));
  mesh.castShadow = true;
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
