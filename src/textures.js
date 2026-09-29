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

// Tangent-space normal map from a grayscale height canvas (tiles seamlessly).
function normalFromHeight(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const g = out.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => src[((((y + h) % h) * w + ((x + w) % w)) << 2)] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) << 2;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return out;
}

// Draw a color canvas and a matching height canvas, return { map, normal }
function surface(size, meters, drawColor, drawHeight, strength = 2) {
  const [w, h] = Array.isArray(size) ? size : [size, size];
  const c = makeCanvas(w, h), g = c.getContext('2d');
  drawColor(g, w, h);
  const out = { map: toTexture(c, meters) };
  if (drawHeight) {
    const hc = makeCanvas(w, h), hg = hc.getContext('2d');
    hg.fillStyle = '#808080';
    hg.fillRect(0, 0, w, h);
    drawHeight(hg, w, h);
    out.normal = toTexture(normalFromHeight(hc, strength), meters, { srgb: false });
  }
  return out;
}

function noise(g, w, h, n, r, a = 0.25, sMin = 1, sMax = 3) {
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${a * r()})`;
    const s = sMin + r() * (sMax - sMin);
    g.fillRect(r() * w, r() * h, s, s);
  }
}

export function makeTextures() {
  const r = rng(1997);
  const T = {};
  const put = (name, sf) => {
    T[name] = sf.map;
    if (sf.normal) T[name + 'N'] = sf.normal;
  };

  // --- Brick (running bond), 2.4m tile
  {
    const rows = 36, cols = 12, S = 512, bh = S / rows, bw = S / cols;
    const base = ['#8a3f2e', '#94472f', '#7e392a', '#9a4f36', '#733325', '#a0553a', '#86412f'];
    const tones = [];
    for (let y = 0; y < rows; y++) for (let x = -1; x <= cols; x++) tones.push(shade(base[Math.floor(r() * base.length)], (r() - 0.5) * 0.07));
    put('brick', surface(S, 2.4, (g) => {
      g.fillStyle = '#b3a592';
      g.fillRect(0, 0, S, S);
      let k = 0;
      for (let y = 0; y < rows; y++) {
        const off = (y % 2) * bw * 0.5;
        for (let x = -1; x <= cols; x++) {
          g.fillStyle = tones[k++];
          g.fillRect(x * bw + off + 1.4, y * bh + 1.4, bw - 2.8, bh - 2.8);
        }
      }
      speckle(g, S, S, 6000, ['rgba(0,0,0,0.14)', 'rgba(255,230,200,0.08)'], r);
    }, (g) => {
      g.fillStyle = '#303030';
      g.fillRect(0, 0, S, S);
      for (let y = 0; y < rows; y++) {
        const off = (y % 2) * bw * 0.5;
        for (let x = -1; x <= cols; x++) {
          g.fillStyle = '#c8c8c8';
          g.fillRect(x * bw + off + 1.6, y * bh + 1.6, bw - 3.2, bh - 3.2);
        }
      }
      noise(g, S, S, 9000, r, 0.2);
    }, 3));
  }

  // --- Painted concrete block (interior walls), white so vertex colors tint it
  {
    const S = 512, rows = 12, cols = 6, bh = S / rows, bw = S / cols;
    const joints = (g, col, lw) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      for (let y = 0; y < rows; y++) {
        g.beginPath(); g.moveTo(0, y * bh); g.lineTo(S, y * bh); g.stroke();
        const off = (y % 2) * bw * 0.5;
        for (let x = 0; x <= cols; x++) {
          g.beginPath(); g.moveTo(x * bw + off, y * bh); g.lineTo(x * bw + off, (y + 1) * bh); g.stroke();
        }
      }
    };
    put('block', surface(S, 2.4, (g) => {
      g.fillStyle = '#f4f1ea';
      g.fillRect(0, 0, S, S);
      speckle(g, S, S, 7000, ['rgba(0,0,0,0.03)', 'rgba(255,255,255,0.5)'], r);
      joints(g, 'rgba(0,0,0,0.08)', 2);
    }, (g) => {
      noise(g, S, S, 12000, r, 0.35, 1, 3);
      joints(g, '#2a2a2a', 3);
    }, 2.2));
  }

  // --- Vinyl composition tile hallway floor, 2.4m tile (8x8 tiles of 30cm)
  {
    const S = 512, n = 8, s = S / n;
    put('tile', surface(S, 2.4, (g) => {
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.fillStyle = (x + y) % 2 === 0 ? '#e6dfcf' : '#d9d0bc';
          if ((x * 7 + y * 3) % 23 === 0) g.fillStyle = '#8fa4c2';
          g.fillRect(x * s, y * s, s, s);
        }
      speckle(g, S, S, 9000, ['rgba(90,80,60,0.22)', 'rgba(255,255,255,0.35)', 'rgba(60,70,110,0.15)'], r, 1, 3);
      g.strokeStyle = 'rgba(0,0,0,0.10)';
      g.lineWidth = 1;
      for (let i = 0; i <= n; i++) {
        g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, S); g.stroke();
        g.beginPath(); g.moveTo(0, i * s); g.lineTo(S, i * s); g.stroke();
      }
    }, (g) => {
      g.strokeStyle = '#404040';
      g.lineWidth = 2;
      for (let i = 0; i <= n; i++) {
        g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, S); g.stroke();
        g.beginPath(); g.moveTo(0, i * s); g.lineTo(S, i * s); g.stroke();
      }
    }, 1.5));
  }

  // --- Carpet (white base, tinted per room), 1m
  put('carpet', surface(256, 1.0, (g) => {
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 14000, ['rgba(0,0,0,0.13)', 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.06)'], r, 1, 2);
  }, (g) => noise(g, 256, 256, 20000, r, 0.6, 1, 2), 2.5));

  // --- Hardwood gym floor, 4m tile
  {
    const S = 512, strips = 40, sh = S / strips;
    const planks = [];
    for (let y = 0; y < strips; y++) {
      let x = -r() * 200;
      while (x < S) {
        const len = 90 + r() * 180;
        planks.push([x, y * sh, len, shade('#c8955b', (r() - 0.5) * 0.09)]);
        x += len;
      }
    }
    put('wood', surface(S, 4.0, (g) => {
      for (const [x, y, len, col] of planks) {
        g.fillStyle = col;
        g.fillRect(x, y, len - 1, sh - 0.6);
      }
      speckle(g, S, S, 3000, ['rgba(90,50,20,0.10)'], r, 1, 4);
    }, (g) => {
      g.fillStyle = '#c0c0c0';
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#505050';
      for (const [x, y, len] of planks) {
        g.fillRect(x + len - 1.5, y, 1.5, sh);
        g.fillRect(x, y + sh - 0.8, len, 0.8);
      }
    }, 1.2));
  }

  // --- Ceramic tile (restrooms, pool deck, kitchen), 1.2m
  {
    const n = 8, s = 256 / n;
    put('ceramic', surface(256, 1.2, (g) => {
      g.fillStyle = '#bdbdb8';
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.fillStyle = shade('#f1efe8', (r() - 0.5) * 0.04);
          g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
        }
    }, (g) => {
      g.fillStyle = '#383838';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#c8c8c8';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g.fillRect(x * s + 1.8, y * s + 1.8, s - 3.6, s - 3.6);
    }, 2.5));
  }

  // --- Acoustic ceiling tile (2'x4'), 2.4m
  {
    const S = 512, cw = S / 4, ch = S / 2;
    put('ceiling', surface(S, 2.4, (g) => {
      g.fillStyle = '#f2f0ea';
      g.fillRect(0, 0, S, S);
      speckle(g, S, S, 12000, ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.05)'], r, 1, 2);
      g.fillStyle = '#d4d1c8';
      for (let i = 0; i <= 4; i++) g.fillRect(i * cw - 3, 0, 6, S);
      for (let i = 0; i <= 2; i++) g.fillRect(0, i * ch - 3, S, 6);
    }, (g) => {
      noise(g, S, S, 16000, r, 0.5, 1, 2);
      g.fillStyle = '#202020';
      for (let i = 0; i <= 4; i++) g.fillRect(i * cw - 3, 0, 6, S);
      for (let i = 0; i <= 2; i++) g.fillRect(0, i * ch - 3, S, 6);
    }, 2));
  }

  // --- Concrete, 3m
  put('concrete', surface(256, 3.0, (g) => {
    g.fillStyle = '#a9a7a1';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 9000, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.12)'], r, 1, 3);
  }, (g) => noise(g, 256, 256, 9000, r, 0.35, 1, 4), 1.5));

  // --- Asphalt, 4m
  put('asphalt', surface(256, 4.0, (g) => {
    g.fillStyle = '#3c3e41';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 12000, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.08)', 'rgba(120,120,120,0.2)'], r, 1, 2);
  }, (g) => noise(g, 256, 256, 20000, r, 0.7, 1, 2), 2));

  // --- Grass, 6m
  put('grass', surface(512, 6.0, (g) => {
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
  }, (g) => noise(g, 512, 512, 30000, r, 0.6, 1, 3), 1.5));

  // --- Roof membrane / gravel, 4m
  put('roof', surface(256, 4.0, (g) => {
    g.fillStyle = '#9b9994';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 14000, ['rgba(0,0,0,0.16)', 'rgba(255,255,255,0.15)', 'rgba(120,100,80,0.18)'], r, 1, 3);
  }, (g) => noise(g, 256, 256, 14000, r, 0.6, 1, 3), 2));

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
    // gentle ripples as a normal map
    const hc = makeCanvas(256, 256), hg = hc.getContext('2d');
    hg.fillStyle = '#808080';
    hg.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      const gr = hg.createRadialGradient(0, 0, 0, 0, 0, 20 + r() * 30);
      gr.addColorStop(0, 'rgba(255,255,255,0.25)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      hg.save();
      hg.translate(r() * 256, r() * 256);
      hg.fillStyle = gr;
      hg.fillRect(-60, -60, 120, 120);
      hg.restore();
    }
    T.waterN = toTexture(normalFromHeight(hc, 3), 4.0, { srgb: false });
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
