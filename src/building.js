// Builds the school: walls with door and window openings, floors, ceilings, switchback stairs,
// the brick exterior skin with real window openings and parapets, roofs, the natatorium,
// entrances and room signs.
import * as THREE from 'three';
import {
  BLOCKS, ROOMS, ENTRANCES, COURTYARD, PORCH, POOL, STAGE, LEVEL_H, SLAB, CEIL2, DOOR_H, hy,
  rectW, wx, wz, ZONES,
} from './layout.js';
import { Batches, subtractRects, hexToRGB, inRect, WHITE } from './geo.js';
import { LabelAtlas, rng, textTexture } from './textures.js';
import { packLightmaps } from './lightmap.js';

const WT = 0.2; // interior wall thickness
const SK = 0.32; // exterior brick skin thickness
const PARAPET = 0.6;
const L1_TOP = CEIL2[1] + 0.05;
const EPS = 0.06;
// window sill/head per level: the real facade has small strip windows, in pairs
const WIN = [[1.05, 2.3], [LEVEL_H + 1.05, LEVEL_H + 2.3]];
const WIN_W = 1.35, WIN_GAP = 0.4;
const ENTRY_H = 2.7;

const CARPETS = ['#6f84ad', '#9a6b4a', '#5d8f7c', '#8b6aa0', '#8f8a4a', '#a85f55', '#4f7d99', '#b08a3e'];

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

export function buildBuilding(scene, world, T, M) {
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
    return b.roof - 0.3; // interior walls run up to the underside of the roof deck
  };
  const ceil0 = (b) => (b.levels === 2 ? CEIL2[0] : b.ceil);

  const rooms = [];
  ROOMS.forEach((list, level) =>
    list.forEach((rm) => {
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
        const width = w !== undefined ? parseFloat(w) : rm.big ? 2.0 : 1.2;
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
  // ceiling height seen from a point (Infinity where the space is open to the roof)
  const ceilAt = (level, x, z) => {
    const b = blockAt(x, z);
    if (!b || stairRects.some((sr) => inRect(sr, x, z, 0.05))) return Infinity;
    if (inRect(rectW(COURTYARD), x, z)) return Infinity;
    return level === 1 ? CEIL2[1] : ceil0(b);
  };

  const entrances = ENTRANCES.map((e) => {
    const horiz = e.dir === 'N' || e.dir === 'S';
    const c = horiz ? wz(e.at[1]) : wx(e.at[0]);
    const mid = horiz ? wx(e.at[0]) : wz(e.at[1]);
    const out = e.dir === 'N' || e.dir === 'W' ? -1 : 1;
    return { ...e, axis: horiz ? 'z' : 'x', c, a: mid - e.w / 2, b: mid + e.w / 2, mid, out };
  });

  // ------------------------------------------------------------------ helpers
  const lineKey = (axis, c) => axis + '|' + Math.round(c * 1000);
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
  // [lo,hi] minus a list of [a,b] openings
  const solidSpans = (lo, hi, holes) => {
    let spans = [[lo, hi]];
    for (const [a, b] of holes) {
      const next = [];
      for (const [s, e] of spans) {
        if (b <= s || a >= e) { next.push([s, e]); continue; }
        if (a > s) next.push([s, a]);
        if (b < e) next.push([b, e]);
      }
      spans = next;
    }
    return spans.filter(([s, e]) => e - s > 0.01);
  };

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
        cb(axis, c, p, q, out, P(axis, c - out * EPS, m), P(axis, c + out * EPS, m));
      }
    }
  }
  const level1Rects = blocks[0].R;
  const onLevel = (lv, x, z) => (lv === 1 ? level1Rects.some((r) => inRect(r, x, z)) : !!blockAt(x, z));

  // ------------------------------------------------------------------ exterior runs + windows
  // A run is a stretch of block edge with constant heights inside/outside; skin covers hOut..hIn.
  const topOf = (b) => b.roof;
  const runs = [];
  for (const { r, b } of blockRects) {
    const local = [];
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      let hOut = 0;
      for (const br of blockRects) if (br.r !== r && inRect(br.r, outPt[0], outPt[1])) hOut = Math.max(hOut, br.b === b ? topOf(b) + PARAPET : topOf(br.b));
      const hIn = topOf(b) + PARAPET;
      if (hIn <= hOut + 0.01) return;
      const last = local[local.length - 1];
      if (last && last.axis === axis && Math.abs(last.c - c) < 1e-6 && last.hOut === hOut && Math.abs(last.q - p) < 1e-4) last.q = q;
      else local.push({ axis, c, p, q, out, hOut, hIn, b, openings: [] });
    });
    runs.push(...local);
  }
  // windows go in bays between the rooms that touch the facade, one or more per bay
  const windowsByLine = [new Map(), new Map()];
  const windows = [];
  for (const run of runs) {
    const { axis, c, p, q, out, hOut, hIn, b } = run;
    if (hOut === 0)
      for (const e of entrances)
        if (e.axis === axis && Math.abs(e.c - c) < 0.05 && e.b > p && e.a < q) run.openings.push({ a: e.a, b: e.b, y0: 0, y1: ENTRY_H, entrance: true });
    if (b.windows === false) continue;
    for (let lv = 0; lv < (b.levels === 2 ? 2 : 1); lv++) {
      const [y0, y1] = WIN[lv];
      if (hOut > y0 - 0.3 || hIn < y1 + 0.6) continue;
      const cuts = new Set([p, q]);
      for (const rm of rooms) {
        if (rm.level !== lv) continue;
        const [x0, z0, x1, z1] = rm.R;
        const onLine = axis === 'z' ? Math.abs(z0 - c) < 0.05 || Math.abs(z1 - c) < 0.05 : Math.abs(x0 - c) < 0.05 || Math.abs(x1 - c) < 0.05;
        if (!onLine) continue;
        const [a, bb] = axis === 'z' ? [x0, x1] : [z0, z1];
        if (bb <= p || a >= q) continue;
        cuts.add(Math.max(p, a));
        cuts.add(Math.min(q, bb));
      }
      const pts = [...cuts].sort((m, n) => m - n);
      for (let i = 0; i < pts.length - 1; i++) {
        const u0 = pts[i], u1 = pts[i + 1], len = u1 - u0;
        if (len < 2.8) continue;
        const inPt = P(axis, c - out * 0.6, (u0 + u1) / 2);
        if (!onLevel(lv, inPt[0], inPt[1])) continue;
        if (stairRects.some((sr) => inRect(sr, inPt[0], inPt[1]))) continue;
        // one pair of windows per ~6 m of wall, or a single window in a narrow bay
        const n = Math.max(1, Math.floor((len - 0.6) / 6.2));
        const pitch = (len - 0.4) / n;
        const pair = pitch >= 2 * WIN_W + WIN_GAP + 0.9;
        if (!pair && pitch < WIN_W + 0.9) continue;
        for (let k = 0; k < n; k++) {
          const m = u0 + 0.2 + pitch * (k + 0.5);
          const spans = pair ? [[m - WIN_GAP / 2 - WIN_W, m - WIN_GAP / 2], [m + WIN_GAP / 2, m + WIN_GAP / 2 + WIN_W]] : [[m - WIN_W / 2, m + WIN_W / 2]];
          if (run.openings.some((o) => o.entrance && spans[spans.length - 1][1] > o.a - 0.6 && spans[0][0] < o.b + 0.6)) continue;
          for (const [a, bw] of spans) {
            const w = { axis, c, out, a, b: bw, y0, y1, lv };
            run.openings.push(w);
            windows.push(w);
            const key = lineKey(axis, c);
            if (!windowsByLine[lv].has(key)) windowsByLine[lv].set(key, []);
            windowsByLine[lv].get(key).push(w);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ interior walls
  const segs = [new Map(), new Map()];
  const group = (level, axis, c) => {
    const k = lineKey(axis, c);
    let g = segs[level].get(k);
    if (!g) segs[level].set(k, (g = { axis, c, items: [], doors: [], wins: windowsByLine[level].get(k) || [] }));
    return g;
  };
  for (const rm of rooms) {
    const [x0, z0, x1, z1] = rm.R;
    const sides = { N: ['z', z0, x0, x1], S: ['z', z1, x0, x1], W: ['x', x0, z0, z1], E: ['x', x1, z0, z1] };
    for (const s of 'NSWE') {
      if (rm.type === 'stair' && rm.open === s) continue;
      const [axis, c, a, b] = sides[s];
      group(rm.level, axis, c).items.push({ a, b });
    }
    for (const d of rm.doorList) group(rm.level, d.axis, d.c).doors.push({ a: d.a, b: d.b });
  }
  for (const { r } of blockRects)
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      if (!blockAt(...outPt)) group(0, axis, c).items.push({ a: p, b: q });
    });
  for (const r of level1Rects)
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      if (!level1Rects.some((rr) => inRect(rr, outPt[0], outPt[1]))) group(1, axis, c).items.push({ a: p, b: q });
    });
  for (const e of entrances) group(0, e.axis, e.c).doors.push({ a: e.a, b: e.b, entrance: true });

  const levelWallH = (level, axis, c, m) => {
    if (level === 1) return L1_TOP - LEVEL_H;
    const [x1, z1] = P(axis, c - 0.3, m);
    const [x2, z2] = P(axis, c + 0.3, m);
    return Math.max(wallTop0(x1, z1), wallTop0(x2, z2));
  };
  const wallColor = [hexToRGB('#ece4d3'), hexToRGB('#e2e9e6')];
  const baseCol = hexToRGB('#3b3733');
  const mapWalls = [[], []];
  const doorways = [];
  for (let level = 0; level < 2; level++) {
    const base = level === 0 ? 0 : LEVEL_H;
    for (const g of segs[level].values()) {
      const bps = new Set();
      g.items.forEach((it) => { bps.add(it.a); bps.add(it.b); });
      g.doors.forEach((d) => { bps.add(d.a); bps.add(d.b); });
      g.wins.forEach((w) => { bps.add(w.a); bps.add(w.b); });
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
        const holes = [];
        let door = false;
        for (const d of g.doors) if (d.a <= m && d.b >= m) { holes.push([base, base + (d.entrance ? ENTRY_H : DOOR_H)]); door = true; }
        for (const w of g.wins) if (w.a <= m && w.b >= m) holes.push([w.y0, w.y1]);
        const sig = holes.map((hh) => hh.join(',')).join(';');
        const last = pieces[pieces.length - 1];
        if (last && last.sig === sig && Math.abs(last.h - h) < 1e-3 && Math.abs(last.q - p) < 1e-4) last.q = q;
        else pieces.push({ p, q, h, holes, sig, door });
      }
      for (let i = 0; i < pieces.length; i++) {
        const pc = pieces[i];
        const prev = i > 0 && Math.abs(pieces[i - 1].q - pc.p) < 1e-4 ? pieces[i - 1] : null;
        const next = i < pieces.length - 1 && Math.abs(pieces[i + 1].p - pc.q) < 1e-4 ? pieces[i + 1] : null;
        const solidFull = pc.holes.length === 0;
        // extend full walls half a thickness into corners, never into an opening
        const p = pc.p - (solidFull && (!prev || prev.holes.length === 0) ? WT / 2 : 0);
        const q = pc.q + (solidFull && (!next || next.holes.length === 0) ? WT / 2 : 0);
        // wall above the ceilings on both sides is never seen: keep it (for shadows) but
        // out of the lightmapped batch
        const [mx, mz] = P(g.axis, g.c, (pc.p + pc.q) / 2);
        const off = WT / 2 + 0.25;
        const split = Math.max(...(g.axis === 'z' ? [[mx, mz - off], [mx, mz + off]] : [[mx - off, mz], [mx + off, mz]]).map(([x, z]) => ceilAt(level, x, z))) + 0.02;
        for (const [s, e] of solidSpans(base, base + pc.h, pc.holes)) {
          if (s < split) segBox(B.get('wall'), g.axis, g.c, p, q, -WT / 2, WT / 2, s, Math.min(e, split), wallColor[level]);
          if (e > split) segBox(B.get('wallHidden'), g.axis, g.c, p, q, -WT / 2, WT / 2, Math.max(s, split), e, wallColor[level]);
          segCollider(g.axis, g.c, p, q, -WT / 2, WT / 2, s, e);
          if (Math.abs(s - base) < 1e-3) {
            // vinyl base on both faces
            segBox(B.get('satin'), g.axis, g.c, pc.p, pc.q, WT / 2, WT / 2 + 0.012, s, s + 0.1, baseCol, g.axis === 'z' ? 'ZY' : 'XY');
            segBox(B.get('satin'), g.axis, g.c, pc.p, pc.q, -WT / 2 - 0.012, -WT / 2, s, s + 0.1, baseCol, g.axis === 'z' ? 'zY' : 'xY');
          }
        }
        if (!pc.door) mapWalls[level].push([g.axis, g.c, pc.p, pc.q]);
        else if (!g.doors.some((d) => d.entrance && d.a <= (pc.p + pc.q) / 2 && d.b >= (pc.p + pc.q) / 2)) doorways.push({ level, axis: g.axis, c: g.c, p: pc.p, q: pc.q });
      }
    }
  }

  // door frames
  const frameCol = hexToRGB('#5b4a3a');
  for (const d of doorways) {
    const base = d.level === 0 ? 0 : LEVEL_H;
    const bb = B.get('satin');
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
        const t0 = inward * (WT / 2 + 0.01), t1 = inward * (WT / 2 + lw - 0.06);
        if (d.axis === 'z') {
          const x0 = Math.min(h0, h0 + sgn * 0.05), x1 = Math.max(h0, h0 + sgn * 0.05);
          B.get('satin').box(x0, base + 0.01, d.c + Math.min(t0, t1), x1, base + DOOR_H - 0.04, d.c + Math.max(t0, t1), col);
          world.add(x0, base, d.c + Math.min(t0, t1), x1, base + DOOR_H, d.c + Math.max(t0, t1), 2);
        } else {
          const z0 = Math.min(h0, h0 + sgn * 0.05), z1 = Math.max(h0, h0 + sgn * 0.05);
          B.get('satin').box(d.c + Math.min(t0, t1), base + 0.01, z0, d.c + Math.max(t0, t1), base + DOOR_H - 0.04, z1, col);
          world.add(d.c + Math.min(t0, t1), base, z0, d.c + Math.max(t0, t1), base + DOOR_H, z1, 2);
        }
      }
      const label = rm.big ? rm.name.toUpperCase() : rm.label || rm.name;
      if (!label) continue;
      const uv = atlas.get(label, rm.big ? 'big' : 'room');
      const sw = rm.big ? 2.4 : 1.0, sh = sw / 4;
      const y0 = base + DOOR_H + 0.16;
      const off = d.c + d.out * (WT / 2 + 0.035);
      B.get('sign').vquad(d.axis, off, d.mid - sw / 2, d.mid + sw / 2, y0, y0 + sh, d.out, WHITE, uv);
    }
  }

  // ------------------------------------------------------------------ stairs
  const stairInfo = [];
  const railGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
  const stepCol = hexToRGB('#cfd2d4');
  const treadCol = [hexToRGB('#8e9296'), hexToRGB('#858a8e')];
  const nose = hexToRGB('#e0b030');
  for (const st of stairs) {
    const [x0, z0, x1, z1] = st.R;
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
    const landing = Math.min(2.0, D * 0.28);
    const F = D - landing;
    const n = 12, tread = F / n, rise = LEVEL_H / (2 * n);
    const half = W / 2;
    const step = (s0, s1, t0, t1, top, k, noseAt) => {
      boxST(s0, s1, t0, t1, 0, top - 0.03, 'paint', stepCol);
      boxST(s0, s1, t0, t1, top - 0.03, top, 'concrete', treadCol[k % 2], false);
      boxST(noseAt, noseAt + 0.05, t0, t1, top, top + 0.006, 'satin', nose, false);
    };
    for (let k = 1; k <= n; k++) {
      step((k - 1) * tread, k * tread, 0.02, half - 0.1, k * rise, k, (k - 1) * tread);
      step(F - k * tread, F - (k - 1) * tread, half + 0.1, W - 0.02, LEVEL_H / 2 + k * rise, k, F - k * tread);
    }
    boxST(F, D, 0.02, W - 0.02, 0, LEVEL_H / 2 - 0.03, 'paint', stepCol);
    boxST(F, D, 0.02, W - 0.02, LEVEL_H / 2 - 0.03, LEVEL_H / 2, 'concrete', treadCol[0], false);
    boxST(0, F, half - 0.1, half + 0.1, 0, L1_TOP, 'wall', wallColor[0]);
    // sloped handrails on both faces of the center wall
    const rail = (sA, sB, yA, yB, t) => {
      const [ax, az] = toXZ(sA, t), [bx, bz] = toXZ(sB, t);
      const va = new THREE.Vector3(ax, yA, az), vb = new THREE.Vector3(bx, yB, bz);
      const m = new THREE.Mesh(railGeo, M.metal);
      m.scale.set(1, va.distanceTo(vb), 1);
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      m.castShadow = true;
      scene.add(m);
    };
    rail(0, F, 0.9 + rise, LEVEL_H / 2 + 0.9, half - 0.14);
    rail(F, 0, LEVEL_H / 2 + 0.9 + rise, LEVEL_H + 0.9, half + 0.14);
    // guard rail on the upper floor across the lower flight's opening
    boxST(0.02, 0.1, 0.02, half - 0.1, LEVEL_H, LEVEL_H + 1.05, 'metal', WHITE);
    for (let t = 0.1; t < half - 0.1; t += 0.5) boxST(0.03, 0.09, t, t + 0.04, LEVEL_H, LEVEL_H + 1.05, 'metal', WHITE, false);
    const uv = atlas.get('STAIRS', 'stair');
    const [sx, sz] = toXZ(-0.02, half);
    const outDir = -frame.sd;
    for (const base of [0, LEVEL_H]) {
      const y0 = base + 2.45;
      if (frame.sAxis === 'x') B.get('sign').vquad('x', sx + outDir * 0.12, sz - 0.6, sz + 0.6, y0, y0 + 0.3, outDir, WHITE, uv);
      else B.get('sign').vquad('z', sz + outDir * 0.12, sx - 0.6, sx + 0.6, y0, y0 + 0.3, outDir, WHITE, uv);
    }
    // walking line up the switchback, for routes: [x, z, height]
    const via = [
      [...toXZ(0.25, half / 2), 0],
      [...toXZ(F, half / 2), LEVEL_H / 2],
      [...toXZ(F + landing / 2, half / 2), LEVEL_H / 2],
      [...toXZ(F + landing / 2, half * 1.5), LEVEL_H / 2],
      [...toXZ(F, half * 1.5), LEVEL_H / 2],
      [...toXZ(F / 2, half * 1.5), LEVEL_H * 0.75],
      [...toXZ(0.25, half * 1.5), LEVEL_H],
    ];
    stairInfo.push({ id: st.id, R: st.R, open: st.open, entry0: toXZ(-0.9, half / 2), exit1: toXZ(-0.9, half + half / 2), D, W, via });
  }

  // ------------------------------------------------------------------ floors
  const theatreRoom = rooms.find((r) => r.type === 'theatre');
  const H_BACK = wz(hy(830)), H_RAKE = wz(hy(960)), H_FRONT = wz(hy(990));
  const house = [theatreRoom.R[0], H_BACK, theatreRoom.R[2], H_FRONT];
  const houseFloor = (z) => (z <= H_BACK ? 0 : z >= H_RAKE ? -1.4 : (-1.4 * (z - H_BACK)) / (H_RAKE - H_BACK));
  const poolPit = [wx(POOL.cx) - POOL.len / 2, wz(POOL.cy) - POOL.wid / 2, wx(POOL.cx) + POOL.len / 2, wz(POOL.cy) + POOL.wid / 2];
  world.addTerrain(poolPit, () => -1.7);
  world.addTerrain(house, (x, z) => houseFloor(z));

  // hallway floors: rooms draw their own floor on top, so leave those areas out
  const roomFloors = (lv) => rooms.filter((rm) => rm.level === lv && rm.type !== 'stair').map((rm) => rm.R);
  const floorHoles0 = [poolPit, house, ...roomFloors(0)];
  for (const { r } of blockRects)
    for (const fr of subtractRects([r], floorHoles0)) B.get('floorTile').hquad(fr[0], fr[1], fr[2], fr[3], 0.02, true);
  const slabRects = subtractRects(level1Rects, stairRects);
  const floorHoles1 = roomFloors(1);
  for (const r of slabRects) {
    // the slab's underside sits above the 1st-floor ceiling, so only its top and edges are drawn
    B.get('paint').box(r[0], LEVEL_H - SLAB, r[1], r[2], LEVEL_H + 0.02, r[3], hexToRGB('#d9d6cf'), 'xXzZ');
    for (const fr of subtractRects([r], floorHoles1)) B.get('floorTile').hquad(fr[0], fr[1], fr[2], fr[3], LEVEL_H + 0.02, true, hexToRGB('#f4f0e8'));
    world.add(r[0], LEVEL_H - SLAB, r[1], r[2], LEVEL_H, r[3], 4);
  }
  rooms.forEach((rm, i) => {
    if (rm.type === 'stair' || rm.type === 'theatre') return;
    const [key, color] = floorStyle(rm, i + (rm.label ? rm.label.charCodeAt(rm.label.length - 1) : 0));
    const y = (rm.level === 0 ? 0 : LEVEL_H) + 0.035;
    const rects = rm.type === 'pool' ? subtractRects([rm.R], [poolPit]) : [rm.R];
    for (const r of rects) B.get(key).hquad(r[0], r[1], r[2], r[3], y, true, hexToRGB(color));
  });
  {
    const [x0, z0, x1] = theatreRoom.R;
    const carpet = hexToRGB('#6e2530');
    B.get('carpet').hquad(x0, z0, x1, H_BACK, 0.035, true, carpet);
    B.get('carpet').slopeZ(x0, H_BACK, x1, H_RAKE, 0.035, -1.365, carpet);
    B.get('carpet').hquad(x0, H_RAKE, x1, H_FRONT, -1.365, true, carpet);
    const st = rectW(STAGE);
    B.get('stage').hquad(st[0], st[1], st[2], st[3], 0.035, true, hexToRGB('#5a3b25'));
    B.get('paint').box(x0, -1.4, H_FRONT - 0.02, x1, 0.035, H_FRONT + 0.02, hexToRGB('#1b1b1b'), 'z');
    B.get('wall').box(x0 + WT / 2 - 0.02, -1.45, H_BACK, x0 + WT / 2, 0.05, H_FRONT, wallColor[0], 'X');
    B.get('wall').box(x1 - WT / 2, -1.45, H_BACK, x1 - WT / 2 + 0.02, 0.05, H_FRONT, wallColor[0], 'x');
  }
  {
    const [x0, z0, x1, z1] = poolPit;
    const tileBlue = hexToRGB('#8fcfe0');
    B.get('ceramic').hquad(x0, z0, x1, z1, -1.7, true, tileBlue);
    B.get('ceramic').box(x0 - 0.05, -1.75, z0 - 0.05, x0, 0.04, z1 + 0.05, tileBlue, 'X');
    B.get('ceramic').box(x1, -1.75, z0 - 0.05, x1 + 0.05, 0.04, z1 + 0.05, tileBlue, 'x');
    B.get('ceramic').box(x0, -1.75, z0 - 0.05, x1, 0.04, z0, tileBlue, 'Z');
    B.get('ceramic').box(x0, -1.75, z1, x1, 0.04, z1 + 0.05, tileBlue, 'z');
    const cp = hexToRGB('#f4f4f0');
    B.get('satin').box(x0 - 0.35, 0.02, z0 - 0.35, x1 + 0.35, 0.06, z0, cp, 'YzZ');
    B.get('satin').box(x0 - 0.35, 0.02, z1, x1 + 0.35, 0.06, z1 + 0.35, cp, 'YzZ');
    B.get('satin').box(x0 - 0.35, 0.02, z0, x0, 0.06, z1, cp, 'YxX');
    B.get('satin').box(x1, 0.02, z0, x1 + 0.35, 0.06, z1, cp, 'YxX');
    const lanes = 6, lw = (z1 - z0) / lanes;
    for (let i = 0; i < lanes; i++) {
      const zc = z0 + lw * (i + 0.5);
      B.get('paint').box(x0 + 1.5, -1.695, zc - 0.13, x1 - 1.5, -1.69, zc + 0.13, hexToRGB('#1c2f5a'), 'Y');
    }
    for (let k = 0; k < 4; k++) {
      const top = -1.7 + (k + 1) * 0.42;
      const sx0 = x0 + 0.02, sx1 = x0 + 0.02 + (4 - k) * 0.45;
      B.get('ceramic').box(sx0, -1.7, z1 - 1.6, sx1, top, z1 - 0.02, hexToRGB('#e8f3f6'));
      world.add(sx0, -1.7, z1 - 1.6, sx1, top, z1 - 0.02, 5);
    }
  }

  // ------------------------------------------------------------------ ceilings + lights
  const lightB = B.get('light');
  const lightCenters = [];
  const addLights = (r, y, spacing = 4.2) => {
    const nx = Math.max(1, Math.floor((r[2] - r[0]) / spacing));
    const nz = Math.max(1, Math.floor((r[3] - r[1]) / spacing));
    const sx = (r[2] - r[0]) / nx, sz = (r[3] - r[1]) / nz;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const cx = r[0] + sx * (i + 0.5), cz = r[1] + sz * (j + 0.5);
        // lens just below a slightly larger metal trim ring
        lightB.hquad(cx - 0.3, cz - 0.6, cx + 0.3, cz + 0.6, y - 0.022, false);
        B.get('satin').box(cx - 0.35, y - 0.02, cz - 0.65, cx + 0.35, y - 0.004, cz + 0.65, hexToRGB('#d9dcdf'), 'yxXzZ');
        lightCenters.push([cx, y, cz]);
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
  for (const { r, b } of blockRects)
    forEachEdgeInterval(r, (axis, c, p, q, out, inPt, outPt) => {
      const ob = blockAt(...outPt);
      if (!ob || ob === b) return;
      const cin = ceil0(b), cout = ceil0(ob);
      if (cout <= cin + 0.01) return;
      segBox(B.get('wall'), axis, c, p, q, -0.05, 0.05, cin, cout + 0.02, wallColor[0]);
    });

  // ------------------------------------------------------------------ exterior skin with openings
  const copeCol = hexToRGB('#3a2c26'); // dark metal parapet cap
  const bandCol = hexToRGB('#bfb6a6'); // thin light band at the second floor
  const sillCol = hexToRGB('#5e2a21'); // brick rowlock sills
  const frameB = B.get('frame');
  const glassB = B.get('glass');
  const outsideAll = (x, z) => !blockRects.some((br) => inRect(br.r, x, z));
  for (const run of runs) {
    const { axis, c, p, q, out, hOut, hIn, b } = run;
    // stretch the skin around outside corners only (never into the building)
    const extP = outsideAll(...P(axis, c + out * SK * 0.5, p - SK * 0.5)) ? SK : 0;
    const extQ = outsideAll(...P(axis, c + out * SK * 0.5, q + SK * 0.5)) ? SK : 0;
    const p0 = p - extP, q0 = q + extQ;
    const bps = new Set([p0, q0]);
    for (const o of run.openings) { bps.add(o.a); bps.add(o.b); }
    const pts = [...bps].sort((m, n) => m - n);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], bq = pts[i + 1];
      if (bq - a < 0.005) continue;
      const m = (a + bq) / 2;
      const holes = run.openings.filter((o) => o.a <= m && o.b >= m).map((o) => [o.y0, o.y1]);
      for (const [s, e] of solidSpans(hOut, hIn, holes)) {
        segBox(B.get('brick'), axis, c, a, bq, 0, out * SK, s, e);
        segCollider(axis, c, a, bq, 0, out * SK, s, e);
      }
    }
    segBox(B.get('paint'), axis, c, p0 - 0.04, q0 + 0.04, -out * 0.04, out * (SK + 0.06), hIn, hIn + 0.14, copeCol);
    if (b.levels === 2 && hOut < 4.0) segBox(B.get('paint'), axis, c, p0 - 0.02, q0 + 0.02, out * SK, out * (SK + 0.03), 4.02, 4.14, bandCol, axis === 'z' ? (out > 0 ? 'ZyY' : 'zyY') : out > 0 ? 'XyY' : 'xyY');
    // water table (darker brick course) at the base
    if (hOut === 0) segBox(B.get('paint'), axis, c, p0, q0, out * SK, out * (SK + 0.03), 0, 0.45, hexToRGB('#5d2c22'), axis === 'z' ? (out > 0 ? 'ZY' : 'zY') : out > 0 ? 'XY' : 'xY');
  }
  // window glazing, frames and sills
  for (const w of windows) {
    const { axis, c, out, a, b: bw, y0, y1 } = w;
    const gc = c + out * SK * 0.55;
    glassB.vquad(axis, gc, a, bw, y0, y1, out);
    segCollider(axis, c, a, bw, out * SK * 0.5, out * SK * 0.6, y0, y1, 15);
    const f0 = out * SK * 0.45, f1 = out * SK * 0.7;
    segBox(frameB, axis, c, a, a + 0.06, f0, f1, y0, y1);
    segBox(frameB, axis, c, bw - 0.06, bw, f0, f1, y0, y1);
    segBox(frameB, axis, c, a, bw, f0, f1, y1 - 0.06, y1);
    segBox(frameB, axis, c, a, bw, f0, f1, y0, y0 + 0.06);
    segBox(frameB, axis, c, a, bw, f0, f1, y0 + (y1 - y0) * 0.62 - 0.025, y0 + (y1 - y0) * 0.62 + 0.025);
    // brick sill outside, painted stool inside
    segBox(B.get('paint'), axis, c, a - 0.05, bw + 0.05, out * SK * 0.7, out * (SK + 0.05), y0 - 0.1, y0, sillCol);
    segBox(B.get('satin'), axis, c, a - 0.05, bw + 0.05, -out * (WT / 2 + 0.1), out * SK * 0.45, y0 - 0.03, y0, hexToRGB('#f1efe9'));
  }

  // ------------------------------------------------------------------ roofs + rooftop units
  for (const { r, b } of blockRects) {
    B.get('roof').box(r[0], b.roof - 0.3, r[1], r[2], b.roof, r[3], WHITE, 'Yy');
    world.add(r[0], b.roof - 0.3, r[1], r[2], b.roof, r[3], 16);
  }
  const hvac = hexToRGB('#b9bcbf');
  for (const b of blocks) {
    for (const r of b.R) {
      const area = (r[2] - r[0]) * (r[3] - r[1]);
      const n = Math.min(6, Math.floor(area / 900));
      for (let i = 0; i < n; i++) {
        const w = 2 + R() * 3, d = 2 + R() * 3, h = 1 + R() * 1.4;
        const cx = r[0] + 3 + R() * Math.max(0.1, r[2] - r[0] - 6 - w);
        const cz = r[1] + 3 + R() * Math.max(0.1, r[3] - r[1] - 6 - d);
        B.get('satin').box(cx, b.roof, cz, cx + w, b.roof + h, cz + d, hvac);
        B.get('frame').box(cx + 0.3, b.roof + h, cz + 0.3, cx + w - 0.3, b.roof + h + 0.05, cz + d - 0.3);
      }
    }
  }

  // ------------------------------------------------------------------ pool water + lane ropes
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(poolPit[2] - poolPit[0], poolPit[3] - poolPit[1], 1, 1),
    new THREE.MeshStandardMaterial({ map: T.water.clone(), normalMap: T.waterN.clone(), normalScale: new THREE.Vector2(0.35, 0.35), color: '#9fe3f5', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.78, depthWrite: false, envMapIntensity: 1.3 }),
  );
  for (const t of [water.material.map, water.material.normalMap]) {
    t.repeat.set((poolPit[2] - poolPit[0]) / 4, (poolPit[3] - poolPit[1]) / 4);
    t.needsUpdate = true;
  }
  water.rotation.x = -Math.PI / 2;
  water.position.set((poolPit[0] + poolPit[2]) / 2, -0.22, (poolPit[1] + poolPit[3]) / 2);
  water.renderOrder = 2;
  scene.add(water);
  {
    const lanes = 6, lw = (poolPit[3] - poolPit[1]) / lanes;
    const ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, poolPit[2] - poolPit[0] - 0.2, 8);
    ropeGeo.rotateZ(Math.PI / 2);
    const mats = [new THREE.MeshStandardMaterial({ color: '#d8352a', roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: '#2b58c9', roughness: 0.5 })];
    for (let i = 1; i < lanes; i++) {
      const rope = new THREE.Mesh(ropeGeo, mats[i % 2]);
      rope.position.set((poolPit[0] + poolPit[2]) / 2, -0.2, poolPit[1] + lw * i);
      scene.add(rope);
    }
    for (let i = 0; i < lanes; i++) {
      const zc = poolPit[1] + lw * (i + 0.5);
      const x = poolPit[2] + 0.55;
      B.get('satin').box(x - 0.3, 0.02, zc - 0.3, x + 0.3, 0.75, zc + 0.3, hexToRGB('#e9ecef'));
      B.get('satin').box(x - 0.32, 0.72, zc - 0.32, x + 0.32, 0.78, zc + 0.32, hexToRGB('#1f5fae'));
      world.add(x - 0.3, 0, zc - 0.3, x + 0.3, 0.78, zc + 0.3, 7);
    }
  }

  // ------------------------------------------------------------------ entrances (sliding glass doors)
  const doorMat = new THREE.MeshStandardMaterial({ color: '#b9d2de', roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 2 });
  const slidingDoors = [];
  for (const e of entrances) {
    const fb = B.get('frame');
    const o0 = -WT / 2, o1 = e.out * (SK - 0.02);
    segBox(fb, e.axis, e.c, e.a - 0.12, e.a, o0, o1, 0, ENTRY_H);
    segBox(fb, e.axis, e.c, e.b, e.b + 0.12, o0, o1, 0, ENTRY_H);
    segBox(fb, e.axis, e.c, e.a - 0.12, e.b + 0.12, o0, o1, ENTRY_H - 0.15, ENTRY_H);
    const half = (e.b - e.a) / 2;
    const panels = [];
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(e.axis === 'z' ? half : 0.05, ENTRY_H - 0.2, e.axis === 'z' ? 0.05 : half);
      const m = new THREE.Mesh(g, doorMat);
      m.renderOrder = 3;
      scene.add(m);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(e.axis === 'z' ? half : 0.06, 0.08, e.axis === 'z' ? 0.06 : half), M.frame);
      fr.position.y = -(ENTRY_H - 0.2) / 2 + 0.04;
      m.add(fr);
      panels.push({ m, side });
    }
    const [cx, cz] = P(e.axis, e.c + e.out * 0.12, e.mid);
    slidingDoors.push({ e, panels, cx, cz, half, open: 0 });
    const uv = atlas.get('EXIT', 'exit');
    B.get('sign').vquad(e.axis, e.c - e.out * (WT / 2 + 0.03), e.mid - 0.4, e.mid + 0.4, ENTRY_H + 0.08, ENTRY_H + 0.28, -e.out, WHITE, uv);
    const [px, pz] = P(e.axis, e.c + e.out * (SK + 1.6), e.mid);
    const hw = e.b - e.a + 1.6;
    if (e.axis === 'z') B.get('concrete').hquad(px - hw / 2, pz - 1.6, px + hw / 2, pz + 1.6, 0.045, true, hexToRGB('#d6d2c8'));
    else B.get('concrete').hquad(px - 1.6, pz - hw / 2, px + 1.6, pz + hw / 2, 0.045, true, hexToRGB('#d6d2c8'));
  }
  const updateDoors = (px, pz, dt) => {
    for (const d of slidingDoors) {
      const dist = Math.hypot(px - d.cx, pz - d.cz);
      const target = dist < 4.5 ? 1 : 0;
      d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 2.2);
      const ease = d.open * d.open * (3 - 2 * d.open);
      for (const p of d.panels) {
        const shift = p.side * (d.half / 2 + ease * d.half * 0.92);
        const [x, z] = P(d.e.axis, d.e.c + d.e.out * 0.12, d.e.mid + shift);
        p.m.position.set(x, (ENTRY_H - 0.2) / 2 + 0.02, z);
      }
    }
  };
  updateDoors(1e9, 1e9, 10);

  // ------------------------------------------------------------------ porch canopy (main entrance)
  {
    // From the photo of the front: a flat-roofed portico with round white columns, a brick
    // fascia with a dark metal cap, and the school name in small metal letters.
    const [x0, z0, x1, z1] = rectW(PORCH);
    const fy0 = 3.6, fy1 = 4.75;
    B.get('brick').box(x0, fy0, z0, x1 + SK, fy1, z1, WHITE, 'xzZ');
    B.get('paint').box(x0 - 0.04, fy1, z0 - 0.04, x1 + SK, fy1 + 0.16, z1 + 0.04, copeCol);
    B.get('paint').box(x0 - 0.02, fy0 + 0.28, z0 - 0.02, x1, fy0 + 0.36, z1 + 0.02, bandCol, 'xzZ');
    B.get('roof').box(x0 + 0.1, fy1, z0 + 0.1, x1, fy1 + 0.05, z1 - 0.1, WHITE, 'Y');
    B.get('paint').hquad(x0 + 0.02, z0 + 0.02, x1, z1 - 0.02, fy0, false, hexToRGB('#e9e6de')); // soffit
    world.add(x0, fy0, z0, x1 + SK, fy1, z1, 6);
    const colGeo = new THREE.CylinderGeometry(0.32, 0.32, fy0, 24);
    colGeo.translate(0, fy0 / 2, 0);
    const colMat = new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.45 });
    const nCol = 5;
    for (let i = 0; i < nCol; i++) {
      const cz = z0 + 0.7 + ((z1 - z0 - 1.4) * i) / (nCol - 1);
      const cx = x0 + 0.7;
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(cx, 0, cz);
      col.castShadow = col.receiveShadow = true;
      scene.add(col);
      B.get('paint').box(cx - 0.4, 0, cz - 0.4, cx + 0.4, 0.12, cz + 0.4, hexToRGB('#d8d4ca'));
      world.add(cx - 0.33, 0, cz - 0.33, cx + 0.33, fy0, cz + 0.33, 8);
    }
    // soffit downlights
    for (let z = z0 + 2; z < z1 - 1; z += 3) lightB.hquad(x0 + 2.2, z - 0.25, x0 + 2.7, z + 0.25, fy0 - 0.01, false);
    B.get('concrete').hquad(x0 - 1.5, z0 - 1, x1, z1 + 1, 0.05, true, hexToRGB('#dcd8cf'));
    const tex = textTexture([{ text: 'WEST WINDSOR-PLAINSBORO HIGH SCHOOL NORTH', size: 0.7, font: 'Arial, Helvetica, sans-serif', weight: '600' }], { w: 2048, h: 110, bg: 'rgba(0,0,0,0)', fg: '#e9e4d8', border: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(12, z1 - z0 - 2), 0.42), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.35, metalness: 0.6 }));
    sign.position.set(x0 - 0.012, (fy0 + 0.36 + fy1) / 2 + 0.02, (z0 + z1) / 2);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
  }

  // ------------------------------------------------------------------ meshes
  const materials = {
    ...M,
    wallHidden: M.wall,
    sign: new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.45, emissive: '#ffffff', emissiveMap: atlas.texture, emissiveIntensity: 0.35 }),
  };
  materials.sign.userData.noShadow = true;
  // lightmap UVs for the big surfaces; each atlas page gets its own copy of the material
  const lightmap = packLightmaps(B);
  const lightmapped = [];
  for (const key of B.map.keys()) {
    const at = key.indexOf('@');
    if (at < 0) continue;
    const mat = materials[key.slice(0, at)].clone();
    materials[key] = mat;
    lightmapped.push({ mat, page: +key.slice(at + 1) });
  }
  for (const m of B.toMeshes(materials)) scene.add(m);

  const zones = ZONES.map((z) => ({ ...z, R: rectW(z.r) }));
  return {
    rooms, stairs: stairInfo, blocks, blockRects, zones, entrances, mapWalls, water, poolPit, house, atlas, windows,
    courtyard: rectW(COURTYARD), level1Rects, slabRects, updateDoors, blockAt, materials, lightCenters,
    lightmap, lightmapped,
  };
}
