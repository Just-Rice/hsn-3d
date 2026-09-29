// Baked lighting. The building's big surfaces (walls, floors, ceilings) get a second UV set
// that packs every quad into 2048 x 2048 lightmap pages at a fixed texel size. tools/bake
// exports the scene with those UVs, bakes the light from every ceiling fixture and the sky
// (plus the sun's bounce light) in Blender, and writes lightmaps/. The game loads them when
// their geometry fingerprint matches, and falls back to real-time lighting otherwise.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';

export const LM = {
  texel: 0.16, // meters per lightmap texel
  size: 2048,
  pad: 2, // texels of padding around each quad
  keys: ['wall', 'floorTile', 'carpet', 'wood', 'ceramic', 'concrete', 'ceiling', 'deck', 'stage'],
};

// Packs the lightmapped batches of `B` (a Batches pool). Each batch is replaced by one builder
// per page, keyed `${key}@${page}`. Returns { pages, hash, rects }.
export function packLightmaps(B) {
  const { texel, size, pad } = LM;
  const items = [];
  let h = 2166136261 >>> 0; // FNV-1a over the quantized geometry and settings
  const mix = (v) => {
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 16) & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(Math.round(texel * 1000));
  mix(size);
  mix(pad);
  for (const key of LM.keys) {
    const b = B.map.get(key);
    if (!b || b.empty) continue;
    const p = b.pos;
    for (let q = 0; q < b.n / 4; q++) {
      const i = q * 12;
      const w = Math.hypot(p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]);
      const hgt = Math.hypot(p[i + 9] - p[i], p[i + 10] - p[i + 1], p[i + 11] - p[i + 2]);
      const cw = Math.max(1, Math.ceil(w / texel - 0.05)), ch = Math.max(1, Math.ceil(hgt / texel - 0.05));
      const rot = ch > cw; // lay every rect flat for shelf packing
      items.push({ key, q, cw, ch, rot, W: (rot ? ch : cw) + 2 * pad, H: (rot ? cw : ch) + 2 * pad });
      for (let k = 0; k < 12; k++) mix(Math.round(p[i + k] * 100));
    }
  }
  // shelf packing, tallest first (stable sort keeps it deterministic)
  const order = items.map((_, i) => i).sort((a, b) => items[b].H - items[a].H || items[b].W - items[a].W);
  let page = 0, x = 0, y = 0, shelfH = 0;
  const rects = [[]];
  for (const i of order) {
    const it = items[i];
    if (x + it.W > size) { x = 0; y += shelfH; shelfH = 0; }
    if (y + it.H > size) { page++; x = 0; y = 0; shelfH = 0; rects.push([]); }
    it.page = page;
    it.x = x;
    it.y = y;
    rects[page].push([x, y, it.W, it.H]);
    x += it.W;
    shelfH = Math.max(shelfH, it.H);
  }
  // write uv1 and split the batches by page
  const byKey = new Map();
  for (const it of items) {
    if (!byKey.has(it.key)) byKey.set(it.key, []);
    byKey.get(it.key).push(it);
  }
  for (const [key, list] of byKey) {
    const src = B.map.get(key);
    const outs = new Map();
    for (const it of list) {
      let g = outs.get(it.page);
      if (!g) {
        g = new GeoBuilder();
        g.uv1 = [];
        outs.set(it.page, g);
      }
      const v0 = it.q * 4, base = g.n;
      for (let k = 0; k < 4; k++) {
        const v = v0 + k;
        g.pos.push(src.pos[v * 3], src.pos[v * 3 + 1], src.pos[v * 3 + 2]);
        g.nor.push(src.nor[v * 3], src.nor[v * 3 + 1], src.nor[v * 3 + 2]);
        g.uv.push(src.uv[v * 2], src.uv[v * 2 + 1]);
        g.col.push(src.col[v * 3], src.col[v * 3 + 1], src.col[v * 3 + 2]);
      }
      const x0 = it.x + pad, y0 = it.y + pad;
      // corners: p0, p1 (along the first edge), p2, p3 (along the second edge)
      const c = it.rot
        ? [[x0, y0], [x0, y0 + it.cw], [x0 + it.ch, y0 + it.cw], [x0 + it.ch, y0]]
        : [[x0, y0], [x0 + it.cw, y0], [x0 + it.cw, y0 + it.ch], [x0, y0 + it.ch]];
      for (const [u, v] of c) g.uv1.push(u / size, v / size);
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      g.n += 4;
    }
    B.map.delete(key);
    for (const [pg, g] of [...outs].sort((a, b) => a[0] - b[0])) B.map.set(`${key}@${pg}`, g);
  }
  return { pages: page + 1, hash: h.toString(16).padStart(8, '0'), rects, texel, size, pad };
}

// Loads lightmaps/ if it was baked from this exact geometry. `mats` is [{ mat, page }].
export async function loadLightmaps(pack, mats, base = 'lightmaps/') {
  let man;
  try {
    const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    man = await res.json();
  } catch {
    return null;
  }
  if (man.hash !== pack.hash || man.pages !== pack.pages) {
    console.warn(`Lightmaps are from different geometry (${man.hash}, this build is ${pack.hash}); using real-time lighting.`);
    return null;
  }
  const loader = new THREE.TextureLoader();
  const texs = await Promise.all(man.files.map((f) => loader.loadAsync(base + f)));
  for (const t of texs) {
    t.channel = 1;
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false; // mip levels would bleed between neighboring quads
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
  }
  for (const { mat, page } of mats) {
    mat.lightMap = texs[page];
    mat.lightMapIntensity = man.intensity;
    mat.envMapIntensity = 0.3; // the bake already has the diffuse sky light; keep reflections
    mat.needsUpdate = true;
  }
  return man;
}
