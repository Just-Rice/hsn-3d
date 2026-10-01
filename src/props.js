// Detailed furniture modeled in Blender (tools/props/build_props.py -> assets/models/props.glb).
// furniture.js places every prop as an InstancedMesh named after its prototype; once the
// models have loaded, each one swaps in the detailed geometry and materials, keeping the
// placements and per-instance colors. Materials named "*_fixed" (chrome, rubber, laminate…)
// ignore the instance color, so a blue locker keeps a steel handle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Indoors the walls and floors get the baked light (lightmaps); the props aren't in the
// lightmaps, so they get a matching fill of indirect light instead, shaped by their own
// baked ambient occlusion. main.js sets it from how far indoors the camera is.
export const propFill = { value: new THREE.Color(0, 0, 0) };

function patch(mat, tinted) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.propFill = propFill;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 propFill;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n  irradiance += propFill;\n  radiance += propFill * 0.3; // metals have no diffuse: give their reflections the fill too');
    if (!tinted) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '');
  };
  mat.customProgramCacheKey = () => (tinted ? 'prop' : 'prop-untinted');
}

export async function loadProps(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const out = new Map();
  for (const node of gltf.scene.children) {
    const meshes = [];
    node.updateMatrixWorld(true);
    node.traverse((o) => o.isMesh && meshes.push(o));
    if (!meshes.length) continue;
    const geos = [], mats = [];
    for (const m of meshes) {
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      // keep only what every part has, so they merge
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(k)) g.deleteAttribute(k);
      geos.push(g);
      const mat = m.material;
      patch(mat, !mat.name.endsWith('_fixed'));
      if (mat.aoMap) mat.aoMapIntensity = 1;
      mats.push(mat);
    }
    const geo = mergeGeometries(geos, true);
    geo.computeBoundingSphere();
    out.set(node.name, { geometry: geo, material: mats });
  }
  return out;
}

export function upgradeProps(scene, protos) {
  let n = 0;
  scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const p = protos.get(o.name);
    if (!p) return;
    o.geometry = p.geometry;
    o.material = p.material;
    o.computeBoundingSphere();
    o.computeBoundingBox?.();
    n++;
  });
  return n;
}

// Hides furniture chunks far from the camera (indoors you rarely see more than a hallway's
// length) and chunks on the other floor, which the floor slab hides anyway.
const _c = new THREE.Vector3();
export function cullProps(meshes, cam, indoor) {
  const far = indoor ? 45 : 90;
  for (const m of meshes) {
    const bs = m.boundingSphere;
    if (!bs) continue;
    _c.copy(bs.center);
    const d = _c.distanceTo(cam) - bs.radius;
    const otherFloor = indoor && Math.abs(_c.y - cam.y) > 4.5 && bs.radius < 30;
    m.visible = d < far && !otherFloor;
  }
}
