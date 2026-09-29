// 2D maps, drawn north-up. World +X is north and +Z is east, so a world point (x, z) sits at
// map coordinates (u, v) = (z, -x) in meters. Two pre-rendered layers: the whole campus at a
// low resolution, and each floor of the building at a higher one. Both the rotating minimap and
// the full map overlay draw them through a canvas transform in meters.
import { inRect } from './geo.js';

const SITE = { x0: -200, x1: 545, z0: -345, z1: 390, ppm: 2 };
const BLD = { x0: -4, x1: 238, z0: -6, z1: 192, ppm: 6 };
const TYPE_COL = {
  class: '#e9dcc0', lab: '#d6e3e8', art: '#ead7c9', music: '#d9d7ee', lecture: '#e6c9c9', office: '#e2d8cc',
  media: '#c8dcea', theatre: '#caa3aa', dining: '#f0e2b8', kitchen: '#e2c4b8', lav: '#d4e6ea', locker: '#d2dfd6',
  pool: '#a9d8e6', gym: '#e6c89a', weights: '#c9c9c9', storage: '#d3d0ca', stair: '#aebbd6',
};
// map-space (u = z, v = -x) extents of the campus layer, in meters
export const MAP_BOUNDS = { u0: SITE.z0, u1: SITE.z1, v0: -SITE.x1, v1: -SITE.x0 };
export const BUILDING_VIEW = { u0: BLD.z0, u1: BLD.z1, v0: -BLD.x1, v1: -BLD.x0 };

// canvas for a world rect, with its ctx transformed to map meters
function layer(L) {
  const c = document.createElement('canvas');
  c.width = Math.round((L.z1 - L.z0) * L.ppm);
  c.height = Math.round((L.x1 - L.x0) * L.ppm);
  const g = c.getContext('2d');
  g.setTransform(L.ppm, 0, 0, L.ppm, -L.z0 * L.ppm, L.x1 * L.ppm);
  return [c, g];
}
// fill a world rect [x0, z0, x1, z1] in map space
const fillW = (g, r) => g.fillRect(r[1], -r[2], r[3] - r[1], r[2] - r[0]);

export function renderMaps(info, ext) {
  // ---------------------------------------------------------------- campus layer
  const [site, g] = layer(SITE);
  g.fillStyle = '#6f9a50';
  g.fillRect(SITE.z0, -SITE.x1, SITE.z1 - SITE.z0, SITE.x1 - SITE.x0);
  const order = { poly: 0, fields: 1 };
  const shapes = [...ext.mapShapes].sort((a, b) => (order[a.kind] ?? 2) - (order[b.kind] ?? 2));
  const labels = [];
  for (const s of shapes) {
    if (s.kind === 'label') { labels.push(s); continue; }
    g.fillStyle = s.color;
    g.strokeStyle = s.color;
    if (s.kind === 'rect') fillW(g, s.r);
    else if (s.kind === 'poly') {
      g.beginPath();
      s.pts.forEach(([x, z], i) => (i ? g.lineTo(z, -x) : g.moveTo(z, -x)));
      g.closePath();
      g.fill();
    } else if (s.kind === 'line') {
      g.lineWidth = s.width;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      s.pts.forEach(([x, z], i) => (i ? g.lineTo(z, -x) : g.moveTo(z, -x)));
      g.stroke();
    } else if (s.kind === 'disc') {
      g.beginPath();
      g.arc(s.at[1], -s.at[0], s.r, 0, Math.PI * 2);
      g.fill();
    } else if (s.kind === 'fields') {
      // the texture is laid out like the photo: right = east (+z), down = south (-x)
      g.drawImage(s.tex.image, s.r[1], -s.r[2], s.r[3] - s.r[1], s.r[2] - s.r[0]);
    } else if (s.kind === 'track') {
      const [cx, cz] = s.at;
      const oval = (hl, hw, col) => {
        g.fillStyle = col;
        g.beginPath();
        g.roundRect(cz - hl, -cx - hw, hl * 2, hw * 2, hw);
        g.fill();
      };
      oval(88.9, 46.8, '#b8b2a6');
      oval(88.5, 46.3, '#a4442f');
      oval(78.7, 36.5, '#3f8a3a');
      g.fillStyle = '#1f3f8f';
      g.fillRect(cz - 54.9, -cx - 24.4, 9.1, 48.8);
      g.fillRect(cz + 45.8, -cx - 24.4, 9.1, 48.8);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 0.4;
      g.strokeRect(cz - 54.9, -cx - 24.4, 109.8, 48.8);
      for (let yd = -50; yd <= 50; yd += 10) {
        g.beginPath();
        g.moveTo(cz + yd * 0.9144, -cx - 24.4);
        g.lineTo(cz + yd * 0.9144, -cx + 24.4);
        g.stroke();
      }
    }
  }
  // building footprint, so the campus view shows the school when zoomed out
  g.fillStyle = '#cfc7b6';
  for (const b of info.blockRects) fillW(g, b.r);
  g.fillStyle = '#7fae5c';
  fillW(g, info.courtyard);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const s of labels) {
    g.save();
    g.translate(s.at[1], -s.at[0]);
    if (s.rot) g.rotate(s.rot);
    g.font = `bold ${s.size || 7}px system-ui, sans-serif`;
    g.lineWidth = 1.6;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.strokeText(s.text, 0, 0);
    g.fillStyle = s.color;
    g.fillText(s.text, 0, 0);
    g.restore();
  }

  // ---------------------------------------------------------------- floors
  const floors = [];
  for (let lv = 0; lv < 2; lv++) {
    const [c, f] = layer(BLD);
    f.fillStyle = lv === 0 ? '#cfc7b6' : 'rgba(150,146,138,0.9)';
    for (const b of info.blockRects) fillW(f, b.r);
    if (lv === 1) {
      f.fillStyle = '#cfc7b6';
      for (const r of info.level1Rects) fillW(f, r);
    }
    f.fillStyle = '#7fae5c';
    fillW(f, info.courtyard);
    for (const rm of info.rooms) {
      if (rm.level !== lv) continue;
      f.fillStyle = TYPE_COL[rm.type] || '#ddd';
      fillW(f, rm.R);
      if (rm.type === 'stair') {
        f.save();
        f.beginPath();
        f.rect(rm.R[1], -rm.R[2], rm.R[3] - rm.R[1], rm.R[2] - rm.R[0]);
        f.clip();
        f.strokeStyle = '#6e7fa5';
        f.lineWidth = 0.18;
        for (let t = -40; t < 40; t += 0.8) {
          f.beginPath();
          f.moveTo(rm.R[1] + t, -rm.R[2]);
          f.lineTo(rm.R[1] + t + 30, -rm.R[2] + 30);
          f.stroke();
        }
        f.restore();
      }
    }
    if (lv === 0) {
      f.fillStyle = '#4fb3d4';
      fillW(f, info.poolPit);
    }
    // walls: [axis, c, p, q]; axis 'z' is the plane z = c spanning x in [p, q]
    f.strokeStyle = '#3a3530';
    f.lineWidth = 0.3;
    f.lineCap = 'square';
    f.beginPath();
    for (const [axis, c0, p, q] of info.mapWalls[lv]) {
      if (axis === 'z') { f.moveTo(c0, -p); f.lineTo(c0, -q); }
      else { f.moveTo(p, -c0); f.lineTo(q, -c0); }
    }
    f.stroke();
    // labels, turned to run along the long side of narrow rooms
    f.textAlign = 'center';
    f.textBaseline = 'middle';
    for (const rm of info.rooms) {
      if (rm.level !== lv || rm.type === 'stair') continue;
      const w = rm.R[3] - rm.R[1], h = rm.R[2] - rm.R[0];
      const vertical = h > w * 1.25 && w < 9;
      const span = vertical ? h : w, thick = vertical ? w : h;
      const cands = (rm.big ? [rm.name, rm.label] : [rm.label || (span > 10 && thick > 2.5 ? rm.name : '')]).filter(Boolean);
      let text = '', fs = 0;
      for (const cand of cands) {
        fs = rm.big ? 2.4 : 1.8;
        f.font = `bold ${fs}px system-ui, sans-serif`;
        while (fs > 1.1 && f.measureText(cand).width > span - 0.4) {
          fs -= 0.1;
          f.font = `bold ${fs}px system-ui, sans-serif`;
        }
        if (f.measureText(cand).width <= span + 0.6) { text = cand; break; }
      }
      if (!text || thick < fs * 0.9) continue;
      f.save();
      f.translate(rm.cz, -rm.cx);
      if (vertical) f.rotate(-Math.PI / 2);
      f.fillStyle = '#2b2620';
      f.fillText(text, 0, 0);
      f.restore();
    }
    if (lv === 0) {
      f.font = 'bold 2.6px system-ui, sans-serif';
      f.fillStyle = '#1f3f8f';
      const cy = info.courtyard;
      f.fillText('COURTYARD', (cy[1] + cy[3]) / 2, -(cy[0] + cy[2]) / 2);
      const mh = info.zones.find((z) => z.name === 'Main Hall');
      if (mh) {
        f.save();
        f.translate((mh.R[1] + mh.R[3]) / 2, -(mh.R[0] * 0.3 + mh.R[2] * 0.7));
        f.rotate(-Math.PI / 2);
        f.fillStyle = '#5a3d24';
        f.fillText('MAIN HALL', 0, 0);
        f.restore();
      }
    }
    floors.push(c);
  }
  return { site, floors };
}

// Draws the campus and one floor. ctx must already map 1 unit to 1 m of map space.
export function drawLayers(ctx, maps, lv) {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(maps.site, SITE.z0, -SITE.x1, SITE.z1 - SITE.z0, SITE.x1 - SITE.x0);
  ctx.drawImage(maps.floors[lv], BLD.z0, -BLD.x1, BLD.z1 - BLD.z0, BLD.x1 - BLD.x0);
}

// Rotating circular minimap; the camera heading points up.
export function drawMinimap(ctx, size, maps, px, pz, camYaw, playerYaw, path, lv, dest) {
  const r = size / 2;
  const zoom = size / 38; // px per meter: about 19 m radius
  const rot = camYaw + Math.PI / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#6f9a50';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(r, r);
  ctx.rotate(rot);
  ctx.scale(zoom, zoom);
  ctx.translate(-pz, px);
  drawLayers(ctx, maps, lv);
  if (path) drawPath(ctx, path, lv, 0.6);
  if (dest) {
    ctx.fillStyle = '#ff3b6b';
    ctx.beginPath();
    ctx.arc(dest.z, -dest.x, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // player arrow (screen space, relative to the camera heading)
  ctx.save();
  ctx.translate(r, r);
  ctx.rotate(camYaw - playerYaw);
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(7, 7);
  ctx.lineTo(0, 3);
  ctx.lineTo(-7, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // north marker rides the rim and stays upright
  const nx = r + Math.sin(rot) * (r - 12), ny = r - Math.cos(rot) * (r - 12);
  ctx.fillStyle = 'rgba(10,16,32,0.8)';
  ctx.beginPath();
  ctx.arc(nx, ny, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', nx, ny + 0.5);
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// route polyline, in map meters
export function drawPath(ctx, path, lv, w = 0.6) {
  ctx.strokeStyle = '#ff3b6b';
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.setLineDash([w * 2, w * 1.5]);
  ctx.beginPath();
  let pen = false;
  for (const p of path.points) {
    if (p.lv !== lv) { pen = false; continue; }
    if (!pen) { ctx.moveTo(p.z, -p.x); pen = true; } else ctx.lineTo(p.z, -p.x);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function roomAtMap(info, lv, x, z) {
  return info.rooms.find((r) => r.level === lv && r.type !== 'stair' && inRect(r.R, x, z));
}
