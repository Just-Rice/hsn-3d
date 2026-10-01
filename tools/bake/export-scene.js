// Runs inside the game page (after it has loaded) and returns the static scene for baking:
// every opaque mesh around the building in world space, with the lightmap UVs, vertex or
// instance colors, a flat albedo per material, and the ceiling fixtures. Used by export.mjs.
async () => {
  const THREE = await import('three');
  const g = window.__game, info = g.info, scene = g.scene;
  await g.texturesReady; // albedo comes from the final textures
  scene.updateMatrixWorld(true);
  // region: the building plus a margin
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const { r } of info.blockRects) { x0 = Math.min(x0, r[0]); z0 = Math.min(z0, r[1]); x1 = Math.max(x1, r[2]); z1 = Math.max(z1, r[3]); }
  const M = 25;
  const region = new THREE.Box3(new THREE.Vector3(x0 - M, -5, z0 - M), new THREE.Vector3(x1 + M, 40, z1 + M));
  // furniture chunks culled by distance (props.js) still block light
  scene.traverse((o) => { if (o.isInstancedMesh) o.visible = true; });
  const skip = new Set();
  g.player.char.group.traverse((o) => skip.add(o));
  for (const b of g.balls.list) skip.add(b.mesh);

  const avgCache = new Map();
  const avgColor = (tex) => {
    if (!tex || !tex.image) return [1, 1, 1];
    if (avgCache.has(tex)) return avgCache.get(tex);
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(tex.image, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    const col = new THREE.Color().setRGB(sum[0] / 64 / 255, sum[1] / 64 / 255, sum[2] / 64 / 255, THREE.SRGBColorSpace);
    const v = [col.r, col.g, col.b];
    avgCache.set(tex, v);
    return v;
  };

  const chunks = [];
  let offset = 0;
  const put = (typed) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const at = offset;
    chunks.push(bytes);
    offset += bytes.byteLength;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
    return at;
  };
  const meshes = [];
  const box = new THREE.Box3(), m4 = new THREE.Matrix4(), v = new THREE.Vector3(), col = new THREE.Color();
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || skip.has(o)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat || !mat.isMeshStandardMaterial || mat.transparent || mat.opacity < 1) return;
    if (o.geometry.isInstancedBufferGeometry) return; // grass blades follow the camera
    const geo = o.geometry, pos = geo.attributes.position;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const inst = o.isInstancedMesh ? o.count : 1;
    const positions = [], colors = [], uv1s = [], indices = [];
    const gi = geo.index ? geo.index.array : null;
    const vc = mat.vertexColors && geo.attributes.color ? geo.attributes.color : null;
    const uv1 = geo.attributes.uv1 || null;
    let base = 0;
    for (let k = 0; k < inst; k++) {
      m4.copy(o.matrixWorld);
      if (o.isInstancedMesh) {
        const im = new THREE.Matrix4();
        o.getMatrixAt(k, im);
        m4.multiply(im);
      }
      box.copy(geo.boundingBox).applyMatrix4(m4);
      if (!box.intersectsBox(region)) continue;
      const ic = o.isInstancedMesh && o.instanceColor ? (o.getColorAt(k, col), [col.r, col.g, col.b]) : [1, 1, 1];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m4);
        positions.push(v.x, v.y, v.z);
        const c = vc ? [vc.getX(i), vc.getY(i), vc.getZ(i)] : [1, 1, 1];
        colors.push(c[0] * ic[0], c[1] * ic[1], c[2] * ic[2]);
        if (uv1) uv1s.push(uv1.getX(i), uv1.getY(i));
      }
      if (gi) for (let i = 0; i < gi.length; i++) indices.push(gi[i] + base);
      else for (let i = 0; i < pos.count; i++) indices.push(i + base);
      base += pos.count;
    }
    if (!indices.length) return;
    const tex = avgColor(mat.map);
    const albedo = [mat.color.r * tex[0], mat.color.g * tex[1], mat.color.b * tex[2]];
    const at = o.name.indexOf('@');
    meshes.push({
      name: o.name || o.type,
      page: at >= 0 ? +o.name.slice(at + 1) : null,
      albedo,
      verts: positions.length / 3,
      tris: indices.length / 3,
      pos: put(new Float32Array(positions)),
      col: put(new Float32Array(colors)),
      uv1: uv1 ? put(new Float32Array(uv1s)) : null,
      idx: put(new Uint32Array(indices)),
    });
  });
  // ceiling fixtures, with the floor they light
  const L = info.level1Rects;
  const fixtures = info.lightCenters.map(([x, y, z]) => {
    const LH = g.levelH;
    const upper = y > LH + 1 && y < 2 * LH && L.some((r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]);
    return [x, y, z, upper ? LH : 0];
  });
  const blob = new Uint8Array(offset);
  let o2 = 0;
  for (const c of chunks) { blob.set(c, o2); o2 += c.byteLength; }
  // base64 in slices (large strings)
  let b64 = '';
  for (let i = 0; i < blob.length; i += 0x8000) b64 += String.fromCharCode.apply(null, blob.subarray(i, i + 0x8000));
  return {
    meta: {
      lightmap: { hash: info.lightmap.hash, pages: info.lightmap.pages, size: info.lightmap.size, texel: info.lightmap.texel, pad: info.lightmap.pad, rects: info.lightmap.rects },
      sunDir: g.sunDir.toArray(),
      region: [x0 - M, z0 - M, x1 + M, z1 + M],
      fixtures,
      meshes,
    },
    bin: btoa(b64),
  };
}
