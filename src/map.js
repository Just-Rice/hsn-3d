// 2D maps: pre-rendered per floor, used by the rotating minimap and the full map overlay.
import { inRect } from './geo.js';

export const MAP = { x0: -240, z0: -95, x1: 410, z1: 250, ppm: 3 };
const TYPE_COL = {
  class: '#e9dcc0', lab: '#d6e3e8', art: '#ead7c9', music: '#d9d7ee', lecture: '#e6c9c9', office: '#e2d8cc',
  media: '#c8dcea', theatre: '#caa3aa', dining: '#f0e2b8', kitchen: '#e2c4b8', lav: '#d4e6ea', locker: '#d2dfd6',
  pool: '#a9d8e6', gym: '#e6c89a', weights: '#c9c9c9', storage: '#d3d0ca', stair: '#aebbd6',
};

export function renderMaps(info, ext) {
  const W = Math.round((MAP.x1 - MAP.x0) * MAP.ppm), H = Math.round((MAP.z1 - MAP.z0) * MAP.ppm);
  const X = (x) => (x - MAP.x0) * MAP.ppm, Z = (z) => (z - MAP.z0) * MAP.ppm;
  const rect = (g, r) => g.fillRect(X(r[0]), Z(r[1]), (r[2] - r[0]) * MAP.ppm, (r[3] - r[1]) * MAP.ppm);
  const maps = [];
  for (let lv = 0; lv < 2; lv++) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    // site
    g.fillStyle = '#6f9a50';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#595c60';
    rect(g, [-128, MAP.z0, -117, MAP.z1]);
    rect(g, ext.lot);
    rect(g, ext.loop);
    rect(g, [-117, 52, -44, 60]);
    rect(g, [-117, 112, -44, 120]);
    rect(g, [30, 186, 148.8, 204]);
    g.fillStyle = '#6f9a50';
    rect(g, [-34, 62, -20, 110]);
    g.fillStyle = '#b9b2a4';
    rect(g, ext.cms);
    // stadium
    const s = ext.stadium;
    g.fillStyle = '#a4442f';
    roundRect(g, X(s.x - 96), Z(s.z - 46), 192 * MAP.ppm, 92 * MAP.ppm, 46 * MAP.ppm);
    g.fillStyle = '#2f8a3c';
    roundRect(g, X(s.x - 79), Z(s.z - 36.5), 158 * MAP.ppm, 73 * MAP.ppm, 36.5 * MAP.ppm);
    g.fillStyle = '#3f7a5a';
    rect(g, [30, -78, 30 + 4 * 19.3 - 1, -78 + 36.6]);
    // building footprint
    g.fillStyle = lv === 0 ? '#cfc7b6' : 'rgba(207,199,182,0.35)';
    for (const b of info.blockRects) rect(g, b.r);
    if (lv === 1) {
      g.fillStyle = '#cfc7b6';
      for (const r of info.level1Rects) rect(g, r);
    }
    g.fillStyle = '#7fae5c';
    rect(g, info.courtyard);
    // rooms
    for (const rm of info.rooms) {
      if (rm.level !== lv) continue;
      g.fillStyle = TYPE_COL[rm.type] || '#ddd';
      rect(g, rm.R);
      if (rm.type === 'stair') {
        g.save();
        g.beginPath();
        g.rect(X(rm.R[0]), Z(rm.R[1]), (rm.R[2] - rm.R[0]) * MAP.ppm, (rm.R[3] - rm.R[1]) * MAP.ppm);
        g.clip();
        g.strokeStyle = '#6e7fa5';
        g.lineWidth = 1;
        for (let t = -300; t < 300; t += 5) {
          g.beginPath();
          g.moveTo(X(rm.R[0]) + t, Z(rm.R[1]));
          g.lineTo(X(rm.R[0]) + t + 200, Z(rm.R[1]) + 200);
          g.stroke();
        }
        g.restore();
      }
    }
    // pool water
    if (lv === 0) {
      g.fillStyle = '#4fb3d4';
      rect(g, info.poolPit);
    }
    // walls
    g.strokeStyle = '#3a3530';
    g.lineWidth = 1.6;
    g.beginPath();
    for (const [axis, c0, p, q] of info.mapWalls[lv]) {
      if (axis === 'z') { g.moveTo(X(p), Z(c0)); g.lineTo(X(q), Z(c0)); }
      else { g.moveTo(X(c0), Z(p)); g.lineTo(X(c0), Z(q)); }
    }
    g.stroke();
    // labels
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const rm of info.rooms) {
      if (rm.level !== lv) continue;
      const w = (rm.R[2] - rm.R[0]) * MAP.ppm, h = (rm.R[3] - rm.R[1]) * MAP.ppm;
      if (rm.type === 'stair') continue;
      const cands = (rm.big ? [rm.name, rm.label] : [rm.label || (w > 60 && h > 14 ? rm.name : '')]).filter(Boolean);
      let text = '', fs = 0;
      for (const cand of cands) {
        fs = rm.big ? 13 : 10;
        g.font = `bold ${fs}px system-ui, sans-serif`;
        while (fs > 6 && g.measureText(cand).width > w - 2) {
          fs -= 1;
          g.font = `bold ${fs}px system-ui, sans-serif`;
        }
        if (g.measureText(cand).width <= w + 4) { text = cand; break; }
      }
      if (!text || h < 8) continue;
      g.fillStyle = '#2b2620';
      g.fillText(text, X(rm.cx), Z(rm.cz));
    }
    // site labels
    g.font = 'bold 13px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.save();
    g.translate(X(-122.5), Z(20));
    g.rotate(-Math.PI / 2);
    g.fillText('GROVERS MILL ROAD', 0, 0);
    g.restore();
    g.fillText('PARKING', X((ext.lot[0] + ext.lot[2]) / 2), Z(75));
    g.fillText('FOOTBALL STADIUM', X(s.x), Z(s.z));
    g.fillText('TENNIS', X(68), Z(-60));
    g.fillStyle = '#3a3530';
    g.fillText('COMMUNITY MIDDLE SCHOOL', X((ext.cms[0] + ext.cms[2]) / 2), Z((ext.cms[1] + ext.cms[3]) / 2));
    if (lv === 0) {
      g.fillStyle = '#1f3f8f';
      g.fillText('COURTYARD', X((info.courtyard[0] + info.courtyard[2]) / 2), Z((info.courtyard[1] + info.courtyard[3]) / 2));
      g.fillStyle = '#5a3d24';
      g.fillText('MAIN HALL', X(80), Z(wzMid(info)));
    }
    maps.push(c);
  }
  return { maps, X, Z };
}

function wzMid(info) {
  const z = info.zones.find((z) => z.name === 'Main Hall');
  return (z.R[1] + z.R[3]) / 2;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h);
  g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  g.closePath();
  g.fill();
}

// Rotating circular minimap
export function drawMinimap(ctx, size, mapCanvas, px, pz, camYaw, playerYaw, path, lv, dest) {
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#6f9a50';
  ctx.fillRect(0, 0, size, size);
  const zoom = 1.6;
  ctx.translate(r, r);
  ctx.rotate(camYaw);
  ctx.scale(zoom, zoom);
  ctx.translate(-(px - MAP.x0) * MAP.ppm, -(pz - MAP.z0) * MAP.ppm);
  ctx.drawImage(mapCanvas, 0, 0);
  if (path) drawPath(ctx, path, lv, 3 / zoom);
  if (dest) {
    ctx.fillStyle = '#ff3b6b';
    ctx.beginPath();
    ctx.arc((dest.x - MAP.x0) * MAP.ppm, (dest.z - MAP.z0) * MAP.ppm, 5 / zoom + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // player arrow (screen space, relative to camera heading)
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
  // north marker
  ctx.save();
  ctx.translate(r, r);
  ctx.rotate(camYaw);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -r + 11);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

export function drawPath(ctx, path, lv, w = 3) {
  ctx.strokeStyle = '#ff3b6b';
  ctx.lineWidth = w;
  ctx.setLineDash([w * 2, w * 1.5]);
  ctx.beginPath();
  let pen = false;
  for (const p of path.points) {
    const x = (p.x - MAP.x0) * MAP.ppm, y = (p.z - MAP.z0) * MAP.ppm;
    if (p.lv !== lv) { pen = false; continue; }
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function roomAtMap(info, lv, x, z) {
  return info.rooms.find((r) => r.level === lv && r.type !== 'stair' && inRect(r.R, x, z));
}
