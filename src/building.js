// Builds the school: walls with door openings, floors, ceilings, switchback stairs, the brick
// exterior skin with windows and parapets, roofs, the natatorium, entrances and room signs.
import * as THREE from 'three';
import {
  BLOCKS, ROOMS, ENTRANCES, COURTYARD, PORCH, POOL_PIT, STAGE, LEVEL_H, SLAB, CEIL2, DOOR_H,
  rectW, wx, wz, ZONES,
} from './layout.js';
import { Batches, subtractRects, hexToRGB, inRect, WHITE } from './geo.js';
import { LabelAtlas, rng, textTexture } from './textures.js';

const WT = 0.2; // interior wall thickness
const SK = 0.32; // exterior brick skin thickness
const PARAPET = 0.6;
const L1_TOP = CEIL2[1] + 0.05;
const EPS = 0.06;

const CARPETS = ['#7086b0', '#9a6b4a', '#5d8f7c', '#8b6aa0', '#8f8a4a', '#a85f55', '#4f7d99', '#b08a3e'];

export function floorStyle(room, idx) {
  switch (room.type) {
    case 'class': return ['carpet', CARPETS[idx % CARPETS.length]];
    case 'lab': return ['floorTile', '#d3d7d9'];
    case 'office': return ['carpet', '#7f7568'];
    case 'media': return ['carpet', '#44708f'];
    case 'lecture': return ['carpet', '#8a4040'];
    case 'music': return ['carpet', '#56659a'];
    case 'art': return ['concrete', '#c9c3b6'];
    case 'theatre': return ['carpet', '#6e2530'];
    case 'dining': return ['floorTile', '#efe2c4'];
    case 'kitchen': return ['ceramic', '#c77b62'];
    case 'lav': return ['ceramic', '#dfe7ea'];
    case 'locker': return ['ceramic', '#cfd6d2'];
    case 'pool': return ['ceramic', '#e7eef0'];
    case 'gym': return ['wood', '#ffffff'];
    case 'weights': return ['carpet', '#353535'];
    case 'stair': return ['concrete', '#b8b8b8'];
    default: return ['concrete', '#bdbab2'];
  }
}

export function buildBuilding(scene, world, T) {
  const B = new Batches();
  const atlas = new LabelAtlas();
  const R = rng(99);

  // ------------------------------------------------------------------ data prep
  const blocks = BLOCKS.map((b) => ({ ...b, R: b.rects.map(rectW) }));
  const blockRects = [];
  blocks.forEach((b) => b.R.forEach((r) => blockRects.push({ r, b })));
  const blockAt = (x, z) => {
    for (const br of blockRects) if (inRect(br.r, x, z)) return br.b;
    return null;
  };
  const wallTop0 = (x, z) => {
    const b = blockAt(x, z);
    if (!b) return 0;
    if (b.levels === 2) return LEVEL_H;
    return b.ceil + 0.03;
  };
  const ceil0 = (b) => (b.levels === 2 ? CEIL2[0] : b.ceil);

  const rooms = [];
  ROOMS.forEach((list, level) =>
    list.forEach((rm, i) => {
      const Rw = rectW(rm.r);
      const room = {
        ...rm, level, R: Rw, idx: rooms.length,
        name: rm.name || (rm.type === 'stair' ? 'Stairwell' : rm.label ? 'Room ' + rm.label : 'Room'),
        cx: (Rw[0] + Rw[2]) / 2, cz: (Rw[1] + Rw[3]) / 2,
        doorList: [],
      };
      for (const spec of rm.doors) {
        const [side, f, w] = spec.split(':');
        const frac = f !== undefined ? parseFloat(f) : 0.5;
        const width = w !== undefined ? parseFloat(w) : rm.big ? 2.0 : 1.1;
        const horiz = side === 'N' || side === 'S';
        const a = horiz ? Rw[0] : Rw[1], b = horiz ? Rw[2] : Rw[3];
        const c = side === 'N' ? Rw[1] : side === 'S' ? Rw[3] : side === 'W' ? Rw[0] : Rw[2];
        const out = side === 'N' || side === 'W' ? -1 : 1;
        const mid = a + frac * (b - a);
        room.doorList.push({ side, axis: horiz ? 'z' : 'x', c, a: mid - width / 2, b: mid + width / 2, mid, out, width });
      }
      rooms.push(room);
    }),
  );
  const stairs = rooms.filter((r) => r.type === 'stair' && r.level === 0);
  const stairRects = stairs.map((s) => s.R);

  const entrances = ENTRANCES.map((e) => {
    const horiz = e.dir === 'N' || e.dir === 'S';
    const c = horiz ? wz(e.at[1]) : wx(e.at[0]);
    const mid = horiz ? wx(e.at[0]) : wz(e.at[1]);
    const out = e.dir === 'N' || e.dir === 'W' ? -1 : 1;
    return { ...e, axis: horiz ? 'z' : 'x', c, a: mid - e.w / 2, b: mid + e.w / 2, mid, out };
  });

  // ------------------------------------------------------------------ helpers
  const lineKey = (axis, c) => axis + '|' + Math.round(c * 1000);
  // point helper: along-line coordinate m on line (axis,c) -> [x,z]
  const P = (axis, c, m) => (axis === 'z' ? [m, c] : [c, m]);
  // box spanning a line segment: axis 'z' => x in [p,q], z in [c+o0,c+o1]
  const segBox = (bb, axis, c, p, q, o0, o1, y0, y1, color, faces) => {
    if (axis === 'z') bb.box(p, y0, c + Math.min(o0, o1), q, y1, c + Math.max(o0, o1), color, faces);
    else bb.box(c + Math.min(o0, o1), y0, p, c + Math.max(o0, o1), y1, q, color, faces);
  };
  const segCollider = (axis, c, p, q, o0, o1, y0, y1, tag = 1) => {
    if (axis === 'z') world.add(p, y0, c + Math.min(o0, o1), q, y1, c + Math.max(o0, o1), tag);
    else world.add(c + Math.min(o0, o1), y0, p, c + Math.max(o0, o1), y1, q, tag);
  };

  // Boundary pieces of a union of rects: calls cb(axis, c, p, q, out, insidePt, outsidePt, rect)
  const allXs = [...new Set(blockRects.flatMap((b) => [b.r[0], b.r[2]]))].sort((a, b) => a - b);
  const allZs = [...new Set(blockRects.flatMap((b) => [b.r[1], b.r[3]]))].sort((a, b) => a - b);
  function forEachEdgeInterval(rect, cb) {
    const sides = [
      ['z', rect[1], rect[0], rect[2], -1],
      ['z', rect[3], rect[0], rect[2], 1],
      ['x', rect[0], rect[1], rect[3], -1],
      ['x', rect[2], rect[1], rect[3], 1],
    ];
    for (const [axis, c, a, b, out] of sides) {
      const bps = [a, ...(axis === 'z' ? allXs : allZs).filter((v) => v > a + 1e-6 && v < b - 1e-6), b];
      for (let i = 0; i < bps.length - 1; i++) {
        const p = bps[i], q = bps[i + 1];
        if (q - p < 1e-4) continue;
        const m = (p + q) / 2;
        const inPt = P(axis, c - out * EPS, m), outPt = P(axis, c + out * EPS, m);
        cb(axis, c, p, q, out, inPt, outPt);
      }
    }
  }

  // ------------------------------------------------------------------ walls
  const segs = [new Map(), new Map()];
  const addWallItem = (level, axis, c, a, b, h) => {
    const k = lineKey(axis, c);
    let g = segs[level].get(k);
    if (!g) segs[level].set(k, (g = { axis, c, items: [], doors: [] }));
    g.items.push({ a, b, h });
  };
  const addDoorItem = (level, axis, c, a, b) => {
    const k = lineKey(axis, c);
    let g = segs[level].get(k);
    if (!g) segs[level].set(k, (g = { axis, c, items: [], doors: [] }));
    g.doors.push({ a, b });
  };
  const levelWallH = (level, axis, c, m) => {
    if (level === 1) return L1_TOP - LEVEL_H;
    const [x1, z1] = P(axis, c - 0.3, m);
    const [x2, z2] = P(axis, c + 0.3, m);
    return Math.max(wallTop0(x1, z1), wallTop0(x2, z2));
  };

  for (const rm of rooms) {
    const [x0, z0, x1, z1] = rm.R;
    const sides = { N: ['z', z0, x0, x1], S: ['z', z1, x0, x1], W: ['x', x0, z0, z1], E: ['x', x1, z0, z1] };
    for (const s of 'NSWE') {
      if (rm.type === 'stair' && rm.open === s) continue;
      const [axis, c, a, b] = sides[s];
      addWallItem(rm.level, axis, c, a, b, -1); // height resolved per piece
    }
    for (const d of rm.doorList) addDoorItem(rm.level, d.axis, d.c, d.a, d.b);
  }
  // level perimeters
  const level1Rects = blocks[0].R;
  for (const { r } of blockRects)
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      if (!blockAt(...outPt)) addWallItem(0, axis, c, p, q, -1);
    });
  for (const r of level1Rects)
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      if (!level1Rects.some((rr) => inRect(rr, outPt[0], outPt[1]))) addWallItem(1, axis, c, p, q, -1);
    });
  for (const e of entrances) addDoorItem(0, e.axis, e.c, e.a, e.b);

  const wallColor = [hexToRGB('#efe6d2'), hexToRGB('#e2ebe3')];
  const mapWalls = [[], []];
  const doorways = []; // for door frames: {level, axis, c, p, q}
  for (let level = 0; level < 2; level++) {
    const base = level === 0 ? 0 : LEVEL_H;
    for (const g of segs[level].values()) {
      const bps = new Set();
      g.items.forEach((it) => { bps.add(it.a); bps.add(it.b); });
      g.doors.forEach((d) => { bps.add(d.a); bps.add(d.b); });
      if (level === 0) {
        const lo = Math.min(...g.items.map((it) => it.a)), hi = Math.max(...g.items.map((it) => it.b));
        for (const v of g.axis === 'z' ? allXs : allZs) if (v > lo && v < hi) bps.add(v);
      }
      const pts = [...bps].sort((a, b) => a - b);
      const pieces = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        if (q - p < 0.005) continue;
        const m = (p + q) / 2;
        if (!g.items.some((it) => it.a <= m && it.b >= m)) continue;
        const h = levelWallH(level, g.axis, g.c, m);
        if (h <= 0.01) continue;
        const door = g.doors.some((d) => d.a <= m && d.b >= m);
        const last = pieces[pieces.length - 1];
        if (last && last.door === door && Math.abs(last.h - h) < 1e-3 && Math.abs(last.q - p) < 1e-4) last.q = q;
        else pieces.push({ p, q, h, door });
      }
      for (let i = 0; i < pieces.length; i++) {
        const pc = pieces[i];
        const prevDoor = i > 0 && pieces[i - 1].door && Math.abs(pieces[i - 1].q - pc.p) < 1e-4;
        const nextDoor = i < pieces.length - 1 && pieces[i + 1].door && Math.abs(pieces[i + 1].p - pc.q) < 1e-4;
        const bb = B.get('wall');
        if (!pc.door) {
          const p = pc.p - (prevDoor ? 0 : WT / 2), q = pc.q + (nextDoor ? 0 : WT / 2);
          segBox(bb, g.axis, g.c, p, q, -WT / 2, WT / 2, base, base + pc.h, wallColor[level]);
          segCollider(g.axis, g.c, p, q, -WT / 2, WT / 2, base, base + pc.h);
          mapWalls[level].push([g.axis, g.c, pc.p, pc.q]);
        } else {
          if (pc.h > DOOR_H + 0.01) {
            segBox(bb, g.axis, g.c, pc.p, pc.q, -WT / 2, WT / 2, base + DOOR_H, base + pc.h, wallColor[level]);
            segCollider(g.axis, g.c, pc.p, pc.q, -WT / 2, WT / 2, base + DOOR_H, base + pc.h);
          }
          doorways.push({ level, axis: g.axis, c: g.c, p: pc.p, q: pc.q });
        }
      }
    }
  }

  // door frames
  const frameCol = hexToRGB('#5b4a3a');
  for (const d of doorways) {
    const base = d.level === 0 ? 0 : LEVEL_H;
    const bb = B.get('paint');
    const o = WT / 2 + 0.03;
    segBox(bb, d.axis, d.c, d.p - 0.08, d.p, -o, o, base, base + DOOR_H + 0.08, frameCol);
    segBox(bb, d.axis, d.c, d.q, d.q + 0.08, -o, o, base, base + DOOR_H + 0.08, frameCol);
    segBox(bb, d.axis, d.c, d.p - 0.08, d.q + 0.08, -o, o, base + DOOR_H, base + DOOR_H + 0.08, frameCol);
  }

  // door leaves (swung open into the room) + signs
  const doorCol = { class: '#a8743f', lab: '#a8743f', office: '#8a6a45', default: '#2a55b8' };
  for (const rm of rooms) {
    if (rm.type === 'stair') continue;
    const base = rm.level === 0 ? 0 : LEVEL_H;
    const col = hexToRGB(doorCol[rm.type] || doorCol.default);
    for (const d of rm.doorList) {
      const inward = -d.out;
      const leaves = d.width >= 1.6 ? [d.a, d.b] : [d.a];
      const lw = d.width >= 1.6 ? d.width / 2 : d.width;
      for (const hinge of leaves) {
        const sgn = hinge === d.a ? 1 : -1;
        const h0 = hinge + sgn * 0.02;
        const t0 = inward * (WT / 2), t1 = inward * (WT / 2 + lw - 0.05);
        // leaf lies perpendicular to the wall, hugging the jamb
        if (d.axis === 'z') {
          const x0 = Math.min(h0, h0 + sgn * 0.05), x1 = Math.max(h0, h0 + sgn * 0.05);
          B.get('paint').box(x0, base + 0.01, d.c + Math.min(t0, t1), x1, base + DOOR_H - 0.04, d.c + Math.max(t0, t1), col);
          world.add(x0, base, d.c + Math.min(t0, t1), x1, base + DOOR_H, d.c + Math.max(t0, t1), 2);
        } else {
          const z0 = Math.min(h0, h0 + sgn * 0.05), z1 = Math.max(h0, h0 + sgn * 0.05);
          B.get('paint').box(d.c + Math.min(t0, t1), base + 0.01, z0, d.c + Math.max(t0, t1), base + DOOR_H - 0.04, z1, col);
          world.add(d.c + Math.min(t0, t1), base, z0, d.c + Math.max(t0, t1), base + DOOR_H, z1, 2);
        }
      }
      // sign above the door on the hallway side
      const label = rm.big ? rm.name.toUpperCase() : rm.label || rm.name;
      if (!label) continue;
      const style = rm.big ? 'big' : 'room';
      const uv = atlas.get(label, style);
      const sw = rm.big ? 2.4 : 1.0, sh = sw / 4;
      const y0 = base + DOOR_H + 0.14;
      const off = d.c + d.out * (WT / 2 + 0.035);
      B.get('sign').vquad(d.axis === 'z' ? 'z' : 'x', off, d.mid - sw / 2, d.mid + sw / 2, y0, y0 + sh, d.out, WHITE, uv);
    }
  }

  // ------------------------------------------------------------------ stairs
  const stairInfo = [];
  const stairCol = [hexToRGB('#9aa0a6'), hexToRGB('#8a9096')];
  const nose = hexToRGB('#e0b030');
  for (const st of stairs) {
    const [x0, z0, x1, z1] = st.R;
    // local frame: s = distance from the open edge inward, t = lateral
    let frame;
    if (st.open === 'E') frame = { s0: x1, sd: -1, t0: z0, td: 1, D: x1 - x0, W: z1 - z0, sAxis: 'x' };
    else if (st.open === 'W') frame = { s0: x0, sd: 1, t0: z0, td: 1, D: x1 - x0, W: z1 - z0, sAxis: 'x' };
    else if (st.open === 'S') frame = { s0: z1, sd: -1, t0: x0, td: 1, D: z1 - z0, W: x1 - x0, sAxis: 'z' };
    else frame = { s0: z0, sd: 1, t0: x0, td: 1, D: z1 - z0, W: x1 - x0, sAxis: 'z' };
    const { D, W } = frame;
    const toXZ = (s, t) => {
      const sv = frame.s0 + frame.sd * s, tv = frame.t0 + frame.td * t;
      return frame.sAxis === 'x' ? [sv, tv] : [tv, sv];
    };
    const boxST = (s0, s1, t0, t1, y0, y1, key, col, collide = true) => {
      const [ax, az] = toXZ(s0, t0), [bx, bz] = toXZ(s1, t1);
      const X0 = Math.min(ax, bx), X1 = Math.max(ax, bx), Z0 = Math.min(az, bz), Z1 = Math.max(az, bz);
      B.get(key).box(X0, y0, Z0, X1, y1, Z1, col);
      if (collide) world.add(X0, y0, Z0, X1, y1, Z1, 3);
    };
    const landing = Math.min(1.8, D * 0.28);
    const F = D - landing;
    const n = 12, tread = F / n, rise = LEVEL_H / (2 * n);
    const half = W / 2;
    for (let k = 1; k <= n; k++) {
      // lane A: up from the open edge (level 0) toward the landing
      boxST((k - 1) * tread, k * tread, 0.02, half - 0.1, 0, k * rise, 'stair', stairCol[k % 2]);
      boxST((k - 1) * tread, (k - 1) * tread + 0.05, 0.02, half - 0.1, k * rise, k * rise + 0.012, 'paint', nose, false);
      // lane B: from the landing back up to level 1 at the open edge
      boxST(F - k * tread, F - (k - 1) * tread, half + 0.1, W - 0.02, 0, LEVEL_H / 2 + k * rise, 'stair', stairCol[k % 2]);
      boxST(F - k * tread, F - k * tread + 0.05, half + 0.1, W - 0.02, LEVEL_H / 2 + k * rise, LEVEL_H / 2 + k * rise + 0.012, 'paint', nose, false);
    }
    boxST(F, D, 0.02, W - 0.02, 0, LEVEL_H / 2, 'stair', stairCol[0]);
    // center wall between flights
    boxST(0, F, half - 0.1, half + 0.1, 0, L1_TOP, 'wall', wallColor[0]);
    // guard rail on the upper floor across the lower flight's opening
    boxST(0.02, 0.1, 0.02, half - 0.1, LEVEL_H, LEVEL_H + 1.05, 'metal', WHITE);
    for (let t = 0.1; t < half - 0.1; t += 0.5) boxST(0.03, 0.09, t, t + 0.04, LEVEL_H, LEVEL_H + 1.05, 'metal', WHITE, false);
    // stair sign
    const uv = atlas.get('STAIRS', 'stair');
    const [sx, sz] = toXZ(-0.02, half);
    const axisOfOpen = frame.sAxis === 'x' ? 'x' : 'z';
    const outDir = -frame.sd;
    for (const base of [0, LEVEL_H]) {
      const y0 = base + 2.45;
      if (axisOfOpen === 'x') B.get('sign').vquad('x', sx + outDir * 0.12, sz - 0.6, sz + 0.6, y0, y0 + 0.3, outDir, WHITE, uv);
      else B.get('sign').vquad('z', sz + outDir * 0.12, sx - 0.6, sx + 0.6, y0, y0 + 0.3, outDir, WHITE, uv);
    }
    const entry0 = toXZ(-0.9, half / 2);
    const exit1 = toXZ(-0.9, half + half / 2);
    stairInfo.push({ id: st.id, R: st.R, open: st.open, entry0, exit1, D, W });
  }

  // ------------------------------------------------------------------ floors
  const theatreRoom = rooms.find((r) => r.type === 'theatre');
  const house = [theatreRoom.R[0], wz(830), theatreRoom.R[2], wz(990)];
  const houseFloor = (z) => {
    const a = wz(830), b = wz(960);
    if (z <= a) return 0;
    if (z >= b) return -1.4;
    return (-1.4 * (z - a)) / (b - a);
  };
  const poolPit = rectW(POOL_PIT);
  world.addTerrain(poolPit, () => -1.7);
  world.addTerrain(house, (x, z) => houseFloor(z));

  const floorHoles0 = [poolPit, house];
  for (const { r } of blockRects)
    for (const fr of subtractRects([r], floorHoles0)) B.get('floorTile').hquad(fr[0], fr[1], fr[2], fr[3], 0.02, true, hexToRGB('#ffffff'));
  // second floor slab
  const slabRects = subtractRects(level1Rects, stairRects);
  for (const r of slabRects) {
    B.get('floorTile').box(r[0], LEVEL_H - SLAB, r[1], r[2], LEVEL_H + 0.02, r[3], hexToRGB('#f4f0e8'), 'YxXzZ');
    world.add(r[0], LEVEL_H - SLAB, r[1], r[2], LEVEL_H, r[3], 4);
  }
  // room floor overlays
  rooms.forEach((rm, i) => {
    if (rm.type === 'stair' || rm.type === 'theatre') return;
    const [key, color] = floorStyle(rm, i + (rm.label ? rm.label.charCodeAt(rm.label.length - 1) : 0));
    const y = (rm.level === 0 ? 0 : LEVEL_H) + 0.035;
    const rects = rm.type === 'pool' ? subtractRects([rm.R], [poolPit]) : [rm.R];
    for (const r of rects) B.get(key).hquad(r[0], r[1], r[2], r[3], y, true, hexToRGB(color));
  });
  // theatre: back aisle, raked house, orchestra floor, stage
  {
    const [x0, z0, x1] = theatreRoom.R;
    const carpet = hexToRGB('#6e2530');
    B.get('carpet').hquad(x0, z0, x1, wz(830), 0.035, true, carpet);
    B.get('carpet').slopeZ(x0, wz(830), x1, wz(960), 0.035, -1.365, carpet);
    B.get('carpet').hquad(x0, wz(960), x1, wz(990), -1.365, true, carpet);
    const st = rectW(STAGE);
    B.get('wood').hquad(st[0], st[1], st[2], st[3], 0.035, true, hexToRGB('#5a3b25'));
    // stage front + house side walls below grade
    B.get('paint').box(x0, -1.4, wz(990) - 0.02, x1, 0.035, wz(990) + 0.02, hexToRGB('#1b1b1b'), 'z');
    B.get('wall').box(x0 + WT / 2 - 0.02, -1.45, wz(830), x0 + WT / 2, 0.05, wz(990), wallColor[0], 'X');
    B.get('wall').box(x1 - WT / 2, -1.45, wz(830), x1 - WT / 2 + 0.02, 0.05, wz(990), wallColor[0], 'x');
  }
  // pool pit
  {
    const [x0, z0, x1, z1] = poolPit;
    const tileBlue = hexToRGB('#9fd3e0');
    B.get('ceramic').hquad(x0, z0, x1, z1, -1.7, true, tileBlue);
    B.get('ceramic').box(x0 - 0.05, -1.75, z0 - 0.05, x0, 0.04, z1 + 0.05, tileBlue, 'X');
    B.get('ceramic').box(x1, -1.75, z0 - 0.05, x1 + 0.05, 0.04, z1 + 0.05, tileBlue, 'x');
    B.get('ceramic').box(x0, -1.75, z0 - 0.05, x1, 0.04, z0, tileBlue, 'Z');
    B.get('ceramic').box(x0, -1.75, z1, x1, 0.04, z1 + 0.05, tileBlue, 'z');
    // coping
    const cp = hexToRGB('#f4f4f0');
    B.get('paint').box(x0 - 0.35, 0.02, z0 - 0.35, x1 + 0.35, 0.06, z0, cp, 'YzZ');
    B.get('paint').box(x0 - 0.35, 0.02, z1, x1 + 0.35, 0.06, z1 + 0.35, cp, 'YzZ');
    B.get('paint').box(x0 - 0.35, 0.02, z0, x0, 0.06, z1, cp, 'YxX');
    B.get('paint').box(x1, 0.02, z0, x1 + 0.35, 0.06, z1, cp, 'YxX');
    // lane stripes on the bottom (6 lanes along x)
    const lanes = 6, lw = (z1 - z0) / lanes;
    for (let i = 0; i < lanes; i++) {
      const zc = z0 + lw * (i + 0.5);
      B.get('paint').box(x0 + 1.5, -1.695, zc - 0.13, x1 - 1.5, -1.69, zc + 0.13, hexToRGB('#1c2f5a'), 'Y');
    }
    // exit steps in one corner
    for (let k = 0; k < 4; k++) {
      const top = -1.7 + (k + 1) * 0.42;
      const sx0 = x0 + 0.02, sx1 = x0 + 0.02 + (4 - k) * 0.45;
      B.get('ceramic').box(sx0, -1.7, z1 - 1.6, sx1, top, z1 - 0.02, hexToRGB('#e8f3f6'));
      world.add(sx0, -1.7, z1 - 1.6, sx1, top, z1 - 0.02, 5);
    }
  }

  // ------------------------------------------------------------------ ceilings + lights
  const lightB = B.get('light');
  const addLights = (r, y, spacing = 4.2) => {
    const nx = Math.max(1, Math.floor((r[2] - r[0]) / spacing));
    const nz = Math.max(1, Math.floor((r[3] - r[1]) / spacing));
    const sx = (r[2] - r[0]) / nx, sz = (r[3] - r[1]) / nz;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const cx = r[0] + sx * (i + 0.5), cz = r[1] + sz * (j + 0.5);
        lightB.hquad(cx - 0.3, cz - 0.6, cx + 0.3, cz + 0.6, y - 0.012, false);
      }
  };
  for (const { r, b } of blockRects) {
    const y = ceil0(b);
    const rects = b.levels === 2 ? subtractRects([r], stairRects) : [r];
    const tall = y > 5;
    for (const cr of rects) {
      B.get(tall ? 'deck' : 'ceiling').box(cr[0], y, cr[1], cr[2], y + 0.08, cr[3], WHITE, 'y');
      world.add(cr[0], y, cr[1], cr[2], y + 0.08, cr[3], 6);
      addLights(cr, y, tall ? 7 : 4.2);
    }
    if (b.levels === 2) {
      B.get('ceiling').box(r[0], CEIL2[1], r[1], r[2], CEIL2[1] + 0.08, r[3], WHITE, 'y');
      world.add(r[0], CEIL2[1], r[1], r[2], CEIL2[1] + 0.08, r[3], 6);
      addLights(r, CEIL2[1]);
    }
  }
  // soffits where ceiling heights change between blocks
  for (const { r, b } of blockRects)
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      const ob = blockAt(...outPt);
      if (!ob || ob === b) return;
      const cin = ceil0(b), cout = ceil0(ob);
      if (cout <= cin + 0.01) return;
      segBox(B.get('wall'), axis, c, p, q, -0.05, 0.05, cin, cout + 0.02, wallColor[0]);
    });

  // ------------------------------------------------------------------ exterior skin
  const topOf = (b) => b.roof;
  const brickB = B.get('brick');
  const glassB = B.get('glass');
  const frameB = B.get('frame');
  const winInB = B.get('winIn');
  const copeCol = hexToRGB('#d9d2c2');
  for (const { r, b } of blockRects) {
    // gather runs along each edge with constant (hOut, hIn)
    const runs = [];
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      let hOut = 0;
      // a neighbouring rect of the same block continues the building: no skin there
      for (const br of blockRects) if (br.r !== r && inRect(br.r, outPt[0], outPt[1])) hOut = Math.max(hOut, br.b === b ? topOf(b) + PARAPET : topOf(br.b));
      const hIn = topOf(b) + PARAPET;
      if (hIn <= hOut + 0.01) return;
      const last = runs[runs.length - 1];
      if (last && last.axis === axis && Math.abs(last.c - c) < 1e-6 && last.hOut === hOut && Math.abs(last.q - p) < 1e-4) last.q = q;
      else runs.push({ axis, c, p, q, out, hOut, hIn });
    });
    for (const run of runs) {
      const { axis, c, p, q, out, hOut, hIn } = run;
      const ents = hOut === 0 ? entrances.filter((e) => e.axis === axis && Math.abs(e.c - c) < 0.05 && e.b > p && e.a < q) : [];
      // pieces between entrances
      let cur = p - SK;
      const cuts = ents.map((e) => [e.a, e.b]).sort((a, b) => a[0] - b[0]);
      for (const [a, bnd] of cuts) {
        segBox(brickB, axis, c, cur, a, 0, out * SK, hOut, hIn);
        segCollider(axis, c, cur, a, 0, out * SK, hOut, hIn);
        segBox(brickB, axis, c, a, bnd, 0, out * SK, 2.7, hIn);
        cur = bnd;
      }
      segBox(brickB, axis, c, cur, q + SK, 0, out * SK, hOut, hIn);
      segCollider(axis, c, cur, q + SK, 0, out * SK, hOut, hIn);
      // coping
      segBox(B.get('paint'), axis, c, p - SK - 0.04, q + SK + 0.04, -out * 0.04, out * (SK + 0.06), hIn, hIn + 0.14, copeCol);
      // band at second-floor line
      if (b.levels === 2 && hOut < 4.0) segBox(B.get('paint'), axis, c, p - SK - 0.02, q + SK + 0.02, out * SK, out * (SK + 0.05), 4.0, 4.45, copeCol, axis === 'z' ? (out > 0 ? 'ZyY' : 'zyY') : out > 0 ? 'XyY' : 'xyY');
      // windows
      if (b.windows === false) continue;
      const rowsY = [[0.95, 2.45, 0]];
      if (b.levels === 2) rowsY.push([5.15, 6.75, 1]);
      for (const [y0, y1, lv] of rowsY) {
        if (hOut > y0 - 0.3 || hIn < y1 + 0.6) continue;
        const len = q - p - 1.6;
        if (len < 1.6) continue;
        const spacing = 3.2, ww = 1.8;
        const n = Math.max(1, Math.floor(len / spacing));
        const st = p + 0.8 + (len - (n - 1) * spacing) / 2;
        for (let i = 0; i < n; i++) {
          const m = st + i * spacing;
          if (lv === 0 && ents.some((e) => m + ww / 2 > e.a - 0.5 && m - ww / 2 < e.b + 0.5)) continue;
          const inPt = P(axis, c - out * 0.5, m);
          if (stairRects.some((sr) => inRect(sr, inPt[0], inPt[1]))) continue;
          const a = m - ww / 2, bb = m + ww / 2;
          const face = c + out * (SK + 0.012);
          glassB.vquad(axis, face, a, bb, y0, y1, out);
          // frame
          segBox(frameB, axis, c, a - 0.07, a, out * SK, out * (SK + 0.06), y0 - 0.07, y1 + 0.07);
          segBox(frameB, axis, c, bb, bb + 0.07, out * SK, out * (SK + 0.06), y0 - 0.07, y1 + 0.07);
          segBox(frameB, axis, c, a, bb, out * SK, out * (SK + 0.06), y0 - 0.07, y0);
          segBox(frameB, axis, c, a, bb, out * SK, out * (SK + 0.06), y1, y1 + 0.07);
          segBox(frameB, axis, c, a, bb, out * SK, out * (SK + 0.035), (y0 + y1) / 2 - 0.03, (y0 + y1) / 2 + 0.03);
          // sill
          segBox(B.get('paint'), axis, c, a - 0.1, bb + 0.1, out * SK, out * (SK + 0.12), y0 - 0.16, y0 - 0.07, copeCol);
          // interior view of the window
          if (hOut === 0 || lv === 1) winInB.vquad(axis, c - out * (WT / 2 + 0.014), a, bb, y0, y1, -out);
        }
      }
    }
  }

  // ------------------------------------------------------------------ roofs + rooftop units
  const roofB = B.get('roof');
  for (const { r, b } of blockRects) {
    roofB.box(r[0], b.roof - 0.3, r[1], r[2], b.roof, r[3], WHITE, 'Y');
  }
  const hvac = hexToRGB('#b9bcbf');
  for (const b of blocks) {
    for (const r of b.R) {
      const area = (r[2] - r[0]) * (r[3] - r[1]);
      const n = Math.min(6, Math.floor(area / 700));
      for (let i = 0; i < n; i++) {
        const w = 2 + R() * 3, d = 2 + R() * 3, h = 1 + R() * 1.4;
        const cx = r[0] + 3 + R() * Math.max(0.1, r[2] - r[0] - 6 - w);
        const cz = r[1] + 3 + R() * Math.max(0.1, r[3] - r[1] - 6 - d);
        B.get('paint').box(cx, b.roof, cz, cx + w, b.roof + h, cz + d, hvac);
      }
    }
  }

  // water surface
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(poolPit[2] - poolPit[0], poolPit[3] - poolPit[1], 1, 1),
    new THREE.MeshPhongMaterial({ map: T.water.clone(), color: '#bfefff', transparent: true, opacity: 0.72, shininess: 120, specular: '#ffffff', depthWrite: false }),
  );
  water.material.map.repeat.set((poolPit[2] - poolPit[0]) / 4, (poolPit[3] - poolPit[1]) / 4);
  water.material.map.needsUpdate = true;
  water.rotation.x = -Math.PI / 2;
  water.position.set((poolPit[0] + poolPit[2]) / 2, -0.22, (poolPit[1] + poolPit[3]) / 2);
  water.renderOrder = 2;
  scene.add(water);
  // lane ropes
  {
    const lanes = 6, lw = (poolPit[3] - poolPit[1]) / lanes;
    const ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, poolPit[2] - poolPit[0] - 0.2, 6);
    ropeGeo.rotateZ(Math.PI / 2);
    const mats = [new THREE.MeshLambertMaterial({ color: '#d8352a' }), new THREE.MeshLambertMaterial({ color: '#2b58c9' })];
    for (let i = 1; i < lanes; i++) {
      const rope = new THREE.Mesh(ropeGeo, mats[i % 2]);
      rope.position.set((poolPit[0] + poolPit[2]) / 2, -0.2, poolPit[1] + lw * i);
      scene.add(rope);
    }
    // starting blocks
    for (let i = 0; i < lanes; i++) {
      const zc = poolPit[1] + lw * (i + 0.5);
      const x = poolPit[2] + 0.55;
      B.get('paint').box(x - 0.3, 0.02, zc - 0.3, x + 0.3, 0.75, zc + 0.3, hexToRGB('#e9ecef'));
      B.get('paint').box(x - 0.32, 0.72, zc - 0.32, x + 0.32, 0.78, zc + 0.32, hexToRGB('#1f5fae'));
      world.add(x - 0.3, 0, zc - 0.3, x + 0.3, 0.78, zc + 0.3, 7);
    }
  }

  // ------------------------------------------------------------------ entrances (sliding glass doors)
  const doorMat = new THREE.MeshPhongMaterial({ color: '#9fc6d8', transparent: true, opacity: 0.42, shininess: 100, specular: '#ffffff', depthWrite: false });
  const slidingDoors = [];
  for (const e of entrances) {
    const outerFace = e.out * (SK - 0.05);
    const fb = B.get('frame');
    // frame (storefront) around the opening
    segBox(fb, e.axis, e.c, e.a - 0.12, e.a, -WT / 2, outerFace + e.out * 0.1, 0, 2.7);
    segBox(fb, e.axis, e.c, e.b, e.b + 0.12, -WT / 2, outerFace + e.out * 0.1, 0, 2.7);
    segBox(fb, e.axis, e.c, e.a - 0.12, e.b + 0.12, -WT / 2, outerFace + e.out * 0.1, 2.55, 2.7);
    // transom glass
    // door leaves: two sliding panels
    const half = (e.b - e.a) / 2;
    const panels = [];
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(e.axis === 'z' ? half : 0.05, 2.5, e.axis === 'z' ? 0.05 : half);
      const m = new THREE.Mesh(g, doorMat);
      m.renderOrder = 3;
      scene.add(m);
      panels.push({ m, side });
    }
    const [cx, cz] = P(e.axis, e.c + e.out * 0.12, e.mid);
    slidingDoors.push({ e, panels, cx, cz, half, open: 0 });
    // exit sign inside
    const uv = atlas.get('EXIT', 'exit');
    B.get('sign').vquad(e.axis, e.c - e.out * (WT / 2 + 0.03), e.mid - 0.4, e.mid + 0.4, 2.75, 2.95, -e.out, WHITE, uv);
    // concrete pad outside
    const [px, pz] = P(e.axis, e.c + e.out * (SK + 1.6), e.mid);
    const hw = e.b - e.a + 1.6;
    if (e.axis === 'z') B.get('concrete').hquad(px - hw / 2, pz - 1.6, px + hw / 2, pz + 1.6, 0.03, true, hexToRGB('#d6d2c8'));
    else B.get('concrete').hquad(px - 1.6, pz - hw / 2, px + 1.6, pz + hw / 2, 0.03, true, hexToRGB('#d6d2c8'));
  }
  const updateDoors = (px, pz, dt) => {
    for (const d of slidingDoors) {
      const dist = Math.hypot(px - d.cx, pz - d.cz);
      const target = dist < 4.2 ? 1 : 0;
      d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 2.4);
      for (const p of d.panels) {
        const shift = p.side * (d.half / 2 + d.open * d.half * 0.92);
        const m = d.e.mid + shift;
        const [x, z] = P(d.e.axis, d.e.c + d.e.out * 0.12, m);
        p.m.position.set(x, 1.27, z);
      }
    }
  };
  updateDoors(1e9, 1e9, 10);

  // ------------------------------------------------------------------ porch canopy (main entrance)
  {
    const pr = rectW(PORCH);
    const [x0, z0, x1, z1] = pr;
    B.get('paint').box(x0, 3.4, z0, x1 + SK, 4.35, z1, hexToRGB('#e7e1d4'));
    B.get('roof').box(x0 + 0.1, 4.35, z0 + 0.1, x1, 4.4, z1 - 0.1, WHITE, 'Y');
    world.add(x0, 3.4, z0, x1, 4.35, z1, 6);
    const colC = hexToRGB('#e7e1d4');
    for (const cz of [z0 + 0.6, (z0 + z1) / 2 - 2.6, (z0 + z1) / 2 + 2.6, z1 - 0.6])
      for (const cx of [x0 + 0.6, (x0 + x1) / 2]) {
        B.get('paint').box(cx - 0.3, 0, cz - 0.3, cx + 0.3, 3.4, cz + 0.3, colC);
        world.add(cx - 0.3, 0, cz - 0.3, cx + 0.3, 3.4, cz + 0.3, 8);
      }
    B.get('concrete').hquad(x0 - 1, z0 - 1, x1, z1 + 1, 0.03, true, hexToRGB('#dcd8cf'));
    const tex = textTexture([{ text: 'WEST WINDSOR-PLAINSBORO HIGH SCHOOL NORTH', size: 0.62 }], { w: 2048, h: 220, bg: '#1f3f8f', fg: '#e8edf4', border: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0 - 0.4, 0.8), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(x0 - 0.01, 3.87, (z0 + z1) / 2);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
  }

  // ------------------------------------------------------------------ materials + meshes
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const materials = {
    wall: lam({ map: T.block, vertexColors: true }),
    brick: lam({ map: T.brick }),
    floorTile: lam({ map: T.tile, vertexColors: true }),
    carpet: lam({ map: T.carpet, vertexColors: true }),
    wood: lam({ map: T.wood, vertexColors: true }),
    ceramic: lam({ map: T.ceramic, vertexColors: true }),
    concrete: lam({ map: T.concrete, vertexColors: true }),
    stair: lam({ map: T.concrete, vertexColors: true }),
    ceiling: lam({ map: T.ceiling, vertexColors: true, emissive: '#8f8b82', emissiveMap: T.ceiling }),
    deck: lam({ color: '#6c7178', emissive: '#34383e' }),
    roof: lam({ map: T.roof }),
    paint: lam({ vertexColors: true }),
    frame: lam({ color: '#3a3029' }),
    metal: new THREE.MeshPhongMaterial({ color: '#8d949a', shininess: 60 }),
    glass: new THREE.MeshPhongMaterial({ color: '#27394a', specular: '#9fb8cc', shininess: 90 }),
    winIn: new THREE.MeshBasicMaterial({ color: '#cfe4f2' }),
    light: new THREE.MeshBasicMaterial({ color: '#fffdf2' }),
    sign: new THREE.MeshBasicMaterial({ map: atlas.texture }),
  };
  materials.light.userData.noShadow = true;
  materials.sign.userData.noShadow = true;
  materials.winIn.userData.noShadow = true;
  materials.ceiling.userData.noShadow = true;
  for (const m of B.toMeshes(materials)) scene.add(m);

  // zones for location readout
  const zones = ZONES.map((z) => ({ ...z, R: rectW(z.r) }));

  return {
    rooms, stairs: stairInfo, blocks, blockRects, zones, entrances, mapWalls, water, poolPit, house, atlas,
    courtyard: rectW(COURTYARD), level1Rects, slabRects, updateDoors, blockAt, materials,
  };
}
