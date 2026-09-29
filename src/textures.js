// Procedural canvas textures (no image assets needed).
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// meters: world size covered by one texture tile (UVs are in meters)
function toTexture(canvas, meters, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  const [mx, my] = Array.isArray(meters) ? meters : [meters, meters];
  t.repeat.set(1 / mx, 1 / my);
  return t;
}

function speckle(g, w, h, n, colors, r, sizeMin = 1, sizeMax = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = sizeMin + r() * (sizeMax - sizeMin);
    g.fillRect(r() * w, r() * h, s, s);
  }
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return '#' + c.getHexString();
}

export function makeTextures() {
  const r = rng(1997);
  const T = {};

  // --- Brick (running bond), 2.4m tile
  {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#b9ab98';
    g.fillRect(0, 0, 512, 512);
    const rows = 36, cols = 12, bh = 512 / rows, bw = 512 / cols;
    const base = ['#8a3f2e', '#94472f', '#7e392a', '#9a4f36', '#733325', '#a0553a', '#86412f'];
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * bw * 0.5;
      for (let x = -1; x <= cols; x++) {
        g.fillStyle = shade(base[Math.floor(r() * base.length)], (r() - 0.5) * 0.06);
        g.fillRect(x * bw + off + 1.2, y * bh + 1.2, bw - 2.4, bh - 2.4);
      }
    }
    speckle(g, 512, 512, 5000, ['rgba(0,0,0,0.12)', 'rgba(255,230,200,0.08)'], r);
    T.brick = toTexture(c, 2.4);
  }

  // --- Painted concrete block (interior walls), 2.4m tile, white so vertex colors tint it
  {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, 512, 512);
    speckle(g, 512, 512, 7000, ['rgba(0,0,0,0.035)', 'rgba(255,255,255,0.5)'], r);
    g.strokeStyle = 'rgba(0,0,0,0.10)';
    g.lineWidth = 2;
    const rows = 12, cols = 6, bh = 512 / rows, bw = 512 / cols;
    for (let y = 0; y < rows; y++) {
      g.beginPath();
      g.moveTo(0, y * bh);
      g.lineTo(512, y * bh);
      g.stroke();
      const off = (y % 2) * bw * 0.5;
      for (let x = 0; x <= cols; x++) {
        g.beginPath();
        g.moveTo(x * bw + off, y * bh);
        g.lineTo(x * bw + off, (y + 1) * bh);
        g.stroke();
      }
    }
    T.block = toTexture(c, 2.4);
  }

  // --- Vinyl composition tile hallway floor, 2.4m tile (8x8 tiles of 30cm)
  {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    const n = 8, s = 512 / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const alt = (x + y) % 2 === 0;
        g.fillStyle = alt ? '#e4dccb' : '#d8ceb9';
        if ((x * 7 + y * 3) % 23 === 0) g.fillStyle = '#9fae8f';
        g.fillRect(x * s, y * s, s, s);
      }
    }
    speckle(g, 512, 512, 9000, ['rgba(90,80,60,0.25)', 'rgba(255,255,255,0.35)', 'rgba(60,90,60,0.18)'], r, 1, 3);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke();
    }
    T.tile = toTexture(c, 2.4);
  }

  // --- Carpet (white base, tinted per room with vertex colors), 1m
  {
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 14000, ['rgba(0,0,0,0.13)', 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.06)'], r, 1, 2);
    T.carpet = toTexture(c, 1.0);
  }

  // --- Hardwood gym floor, 4m tile
  {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    const strips = 40, sh = 512 / strips;
    for (let y = 0; y < strips; y++) {
      let x = -r() * 200;
      while (x < 512) {
        const len = 90 + r() * 180;
        g.fillStyle = shade('#c8955b', (r() - 0.5) * 0.08);
        g.fillRect(x, y * sh, len - 1, sh - 0.6);
        x += len;
      }
    }
    speckle(g, 512, 512, 3000, ['rgba(90,50,20,0.10)'], r, 1, 4);
    T.wood = toTexture(c, 4.0);
  }

  // --- Ceramic tile (restrooms, pool deck, kitchen), 1.2m
  {
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#bdbdb8';
    g.fillRect(0, 0, 256, 256);
    const n = 8, s = 256 / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        g.fillStyle = shade('#f1efe8', (r() - 0.5) * 0.04);
        g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
      }
    T.ceramic = toTexture(c, 1.2);
  }

  // --- Acoustic ceiling tile (2'x4'), 2.4m
  {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#f2f0ea';
    g.fillRect(0, 0, 512, 512);
    speckle(g, 512, 512, 12000, ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.05)'], r, 1, 2);
    g.fillStyle = '#c9c6bd';
    const cw = 512 / 4, ch = 512 / 2;
    for (let i = 0; i <= 4; i++) g.fillRect(i * cw - 2, 0, 4, 512);
    for (let i = 0; i <= 2; i++) g.fillRect(0, i * ch - 2, 512, 4);
    T.ceiling = toTexture(c, 2.4);
  }

  // --- Concrete, 3m
  {
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#a9a7a1';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 9000, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.12)'], r, 1, 3);
    T.concrete = toTexture(c, 3.0);
  }

  // --- Asphalt, 4m
  {
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#3c3e41';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 12000, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.08)', 'rgba(120,120,120,0.2)'], r, 1, 2);
    T.asphalt = toTexture(c, 4.0);
  }

  // --- Grass, 6m
  {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#5b8a3a';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${40 + r() * 40},${90 + r() * 50},${20 + r() * 30},0.25)`;
      g.beginPath();
      g.arc(r() * 512, r() * 512, 20 + r() * 60, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 16000; i++) {
      g.strokeStyle = r() < 0.5 ? 'rgba(30,70,20,0.35)' : 'rgba(150,190,90,0.3)';
      const x = r() * 512, y = r() * 512;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
      g.stroke();
    }
    T.grass = toTexture(c, 6.0);
  }

  // --- Roof membrane / gravel, 4m
  {
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#8f8d88';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 14000, ['rgba(0,0,0,0.18)', 'rgba(255,255,255,0.15)', 'rgba(120,100,80,0.2)'], r, 1, 3);
    T.roof = toTexture(c, 4.0);
  }

  // --- Pool water, 4m (animated offset)
  {
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#3aa6c9';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 400; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.15})`;
      g.lineWidth = 1 + r() * 2;
      const x = r() * 256, y = r() * 256;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + 10, y - 6, x + 20, y + 6, x + 30 + r() * 20, y);
      g.stroke();
    }
    T.water = toTexture(c, 4.0);
  }

  return T;
}

// Big one-off texture for the stadium: track + turf field with yard lines.
// Covers `W` x `H` meters; field length runs along the canvas X axis.
export function makeStadiumTexture(W, H) {
  const ppm = 12; // pixels per meter
  const c = makeCanvas(Math.round(W * ppm), Math.round(H * ppm));
  const g = c.getContext('2d');
  const r = rng(42);
  const X = (m) => m * ppm;
  // grass surround
  g.fillStyle = '#4f7f35';
  g.fillRect(0, 0, c.width, c.height);
  const cx = W / 2, cy = H / 2;
  // track: stadium shape, straight 84.4m, inner radius 36.5m, 8 lanes of 1.22m
  const straight = 84.4, rin = 36.5, lanes = 8, lw = 1.22;
  const rout = rin + lanes * lw;
  const stadiumPath = (rad) => {
    g.beginPath();
    g.moveTo(X(cx - straight / 2), X(cy - rad));
    g.lineTo(X(cx + straight / 2), X(cy - rad));
    g.arc(X(cx + straight / 2), X(cy), X(rad), -Math.PI / 2, Math.PI / 2);
    g.lineTo(X(cx - straight / 2), X(cy + rad));
    g.arc(X(cx - straight / 2), X(cy), X(rad), Math.PI / 2, Math.PI * 1.5);
    g.closePath();
  };
  stadiumPath(rout + 0.5);
  g.fillStyle = '#b8b2a6';
  g.fill();
  stadiumPath(rout);
  g.fillStyle = '#a4442f';
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 1.2;
  for (let i = 0; i <= lanes; i++) {
    stadiumPath(rin + i * lw);
    g.stroke();
  }
  // infield turf
  stadiumPath(rin);
  g.fillStyle = '#2f8a3c';
  g.fill();
  // mowing stripes on the field (turf is artificial but painted stripes look nice)
  const fieldL = 109.7, fieldW = 48.8;
  const fx0 = cx - fieldL / 2, fy0 = cy - fieldW / 2;
  for (let i = 0; i < 22; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    g.fillRect(X(fx0 + i * 5), X(fy0 - 3), X(5), X(fieldW + 6));
  }
  // end zones (royal blue / silver)
  g.fillStyle = '#1f3f8f';
  g.fillRect(X(fx0), X(fy0), X(9.14), X(fieldW));
  g.fillRect(X(fx0 + fieldL - 9.14), X(fy0), X(9.14), X(fieldW));
  g.save();
  g.fillStyle = '#d5dde8';
  g.font = `bold ${X(5.2)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.translate(X(fx0 + 4.57), X(cy));
  g.rotate(-Math.PI / 2);
  g.fillText('KNIGHTS', 0, 0);
  g.restore();
  g.save();
  g.fillStyle = '#d5dde8';
  g.font = `bold ${X(5.2)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.translate(X(fx0 + fieldL - 4.57), X(cy));
  g.rotate(Math.PI / 2);
  g.fillText('KNIGHTS', 0, 0);
  g.restore();
  // yard lines
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.6;
  g.strokeRect(X(fx0), X(fy0), X(fieldL), X(fieldW));
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = X(fx0 + 9.14 + yd * 0.9144);
    g.beginPath();
    g.moveTo(x, X(fy0));
    g.lineTo(x, X(fy0 + fieldW));
    g.stroke();
  }
  // hash marks
  for (let yd = 1; yd < 100; yd++) {
    const x = X(fx0 + 9.14 + yd * 0.9144);
    for (const hy of [0.6, 18.4, 29.8, fieldW - 0.6]) {
      g.beginPath();
      g.moveTo(x, X(fy0 + hy - 0.3));
      g.lineTo(x, X(fy0 + hy + 0.3));
      g.stroke();
    }
  }
  // numbers
  g.fillStyle = '#ffffff';
  g.font = `bold ${X(1.8)}px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let yd = 10; yd <= 90; yd += 10) {
    const n = yd <= 50 ? yd : 100 - yd;
    const x = X(fx0 + 9.14 + yd * 0.9144);
    g.fillText(String(n), x, X(fy0 + 8));
    g.save();
    g.translate(x, X(fy0 + fieldW - 8));
    g.rotate(Math.PI);
    g.fillText(String(n), 0, 0);
    g.restore();
  }
  // midfield logo
  g.beginPath();
  g.arc(X(cx), X(cy), X(4.2), 0, Math.PI * 2);
  g.fillStyle = '#d5dde8';
  g.fill();
  g.beginPath();
  g.arc(X(cx), X(cy), X(3.6), 0, Math.PI * 2);
  g.fillStyle = '#1f3f8f';
  g.fill();
  g.fillStyle = '#d5dde8';
  g.font = `bold ${X(3.6)}px Georgia, serif`;
  g.fillText('N', X(cx), X(cy) + X(0.2));
  speckle(g, c.width, c.height, 30000, ['rgba(0,0,0,0.05)'], r, 1, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Parking lot stripes texture: one row of stalls, 2.7m wide stalls, 5.5m deep each side
export function makeParkingTexture() {
  const c = makeCanvas(512, 512), g = c.getContext('2d');
  const r = rng(7);
  g.fillStyle = '#3a3c3f';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 14000, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.07)'], r, 1, 2);
  // tile = 27m (along aisle) x 18m (stall 5.5 + aisle 7 + stall 5.5)
  const ppmX = 512 / 27, ppmY = 512 / 18;
  g.fillStyle = 'rgba(245,245,235,0.85)';
  for (let i = 0; i <= 10; i++) {
    const x = i * 2.7 * ppmX;
    g.fillRect(x - 1, 0, 2.5, 5.5 * ppmY);
    g.fillRect(x - 1, 512 - 5.5 * ppmY, 2.5, 5.5 * ppmY);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / 27, 1 / 18);
  return t;
}

// Label atlas for room signs (256x64 cells).
export class LabelAtlas {
  constructor(size = 2048, cw = 256, ch = 64) {
    this.canvas = makeCanvas(size, size);
    this.g = this.canvas.getContext('2d');
    this.size = size;
    this.cw = cw;
    this.ch = ch;
    this.cols = size / cw;
    this.map = new Map();
    this.n = 0;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }
  // returns [u0,v0,u1,v1]
  get(text, style = 'room') {
    const key = style + '|' + text;
    if (this.map.has(key)) return this.map.get(key);
    const i = this.n++;
    const cx = (i % this.cols) * this.cw, cy = Math.floor(i / this.cols) * this.ch;
    const g = this.g;
    const bg = style === 'big' ? '#15306e' : style === 'stair' ? '#2d3b55' : style === 'exit' ? '#b3261e' : '#1f3f8f';
    g.fillStyle = bg;
    g.fillRect(cx, cy, this.cw, this.ch);
    g.strokeStyle = style === 'exit' ? '#ffffff' : '#d5dde8';
    g.lineWidth = 4;
    g.strokeRect(cx + 4, cy + 4, this.cw - 8, this.ch - 8);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let fs = 40;
    g.font = `bold ${fs}px "Trebuchet MS", Arial, sans-serif`;
    while (g.measureText(text).width > this.cw - 24 && fs > 14) {
      fs -= 2;
      g.font = `bold ${fs}px "Trebuchet MS", Arial, sans-serif`;
    }
    g.fillText(text, cx + this.cw / 2, cy + this.ch / 2 + 2);
    const uv = [cx / this.size, 1 - (cy + this.ch) / this.size, (cx + this.cw) / this.size, 1 - cy / this.size];
    this.map.set(key, uv);
    this.texture.needsUpdate = true;
    return uv;
  }
}

// Generic text panel texture
export function textTexture(lines, { w = 1024, h = 256, bg = '#1f3f8f', fg = '#ffffff', accent = '#d5dde8', font = 'Georgia, serif', border = true } = {}) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = accent;
    g.lineWidth = h * 0.04;
    g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h * 0.1 > 0 ? h - h * 0.1 : h);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((s, l) => s + (l.size || 0.3), 0);
  let y = (h - total * h) / 2;
  for (const l of lines) {
    const size = (l.size || 0.3) * h;
    let fs = size * 0.8;
    g.font = `${l.weight || 'bold'} ${fs}px ${l.font || font}`;
    while (g.measureText(l.text).width > w * 0.92 && fs > 8) {
      fs -= 2;
      g.font = `${l.weight || 'bold'} ${fs}px ${l.font || font}`;
    }
    g.fillStyle = l.color || fg;
    g.fillText(l.text, w / 2, y + size / 2);
    y += size;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
