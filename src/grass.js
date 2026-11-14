// Real grass blades on the lawns around you. A fixed tile of blades (one instanced blade
// mesh) wraps around the camera, so blades never pop as you walk. Where they may grow comes
// from a top-down render of the campus made once at load: the lawn material drawn white,
// everything else (walks, roads, lots, fields, roofs) black. Blades thin out with distance
// and sway in the wind; their color and normal follow the lawn texture so they melt into it.
import * as THREE from 'three';

export class Grass {
  constructor(scene, renderer, { lawnMaterial, bounds, count = 45000, radius = 16 }) {
    this.scene = scene;
    this.radius = radius;
    // ------------------------------------------------ lawn mask, rendered from above
    const [x0, z0, x1, z1] = bounds;
    const size = 2048;
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    const cam = new THREE.OrthographicCamera(-(x1 - x0) / 2, (x1 - x0) / 2, (z1 - z0) / 2, -(z1 - z0) / 2, 1, 400);
    cam.position.set((x0 + x1) / 2, 200, (z0 + z1) / 2);
    cam.up.set(0, 0, -1);
    cam.lookAt((x0 + x1) / 2, 0, (z0 + z1) / 2);
    // the ground layers are coplanar and sorted by polygon offset (the lawn behind), so the
    // stand-in materials keep that order
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const saved = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      saved.push([o, o.material, o.visible]);
      const lawn = o.material === lawnMaterial;
      o.material = lawn ? white : black;
      // see-through things (glass, tree cards, fences) shouldn't punch holes in the lawn
      const m = saved[saved.length - 1][1];
      const mm = Array.isArray(m) ? m[0] : m;
      if (!lawn && (mm?.transparent || mm?.alphaTest > 0 || o.position.y > 30)) o.visible = false;
    });
    const bg = scene.background, fog = scene.fog;
    scene.background = new THREE.Color(0);
    scene.fog = null;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    scene.background = bg;
    scene.fog = fog;
    for (const [o, m, v] of saved) {
      o.material = m;
      o.visible = v;
    }
    this.mask = rt.texture;

    // ------------------------------------------------ tufts of blades, instanced
    // each instance is a tuft of six single-triangle blades; y is 0..1 along a blade
    const BL = 6;
    const pos = [], bl = [];
    for (let k = 0; k < BL; k++) {
      const a = (k / BL) * Math.PI * 2 + 0.4 * Math.sin(k * 7.1);
      const r = 0.01 + 0.05 * ((k * 0.618) % 1); // meters from the tuft's center
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      const tw = a + 1.3; // blade faces a different way each
      const cx = Math.cos(tw) * 0.007, cz = Math.sin(tw) * 0.007; // 14 mm wide at the root
      pos.push(ox - cx, 0, oz - cz, ox + cx, 0, oz + cz, ox + Math.cos(a) * 0.035, 1, oz + Math.sin(a) * 0.035); // tip leans out
      for (let v = 0; v < 3; v++) bl.push(k / BL);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('bk', new THREE.Float32BufferAttribute(bl, 1));
    // per tuft: x, z in the tile, angle, random
    const T = radius * 2;
    const inst = new Float32Array(count * 4);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      inst[i * 4] = rnd() * T;
      inst[i * 4 + 1] = rnd() * T;
      inst[i * 4 + 2] = rnd() * Math.PI * 2;
      inst[i * 4 + 3] = rnd();
    }
    g.setAttribute('blade', new THREE.InstancedBufferAttribute(inst, 4));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.uniforms = {
      maskTex: { value: this.mask },
      maskBounds: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) },
      tile: { value: T },
      fadeR: { value: radius },
      camXZ: { value: new THREE.Vector2() },
      gtime: { value: 0 },
    };
    const U = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.5 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 blade; attribute float bk;
          uniform sampler2D maskTex; uniform vec4 maskBounds; uniform float tile, fadeR, gtime; uniform vec2 camXZ;
          varying float vH; varying float vShade;`)
        .replace('#include <begin_vertex>', `
          // the copy of this blade nearest the camera
          vec2 p = blade.xy + floor((camXZ - blade.xy) / tile + 0.5) * tile;
          float d = distance(p, camXZ);
          vec2 muv = (p - maskBounds.xy) / maskBounds.zw;
          float lawn = texture2D(maskTex, vec2(muv.x, 1.0 - muv.y)).r;
          float fade = smoothstep(fadeR, fadeR * 0.55, d);
          float rr = fract(blade.w * 13.7 + bk * 3.1);
          float h = (0.05 + 0.06 * rr) * smoothstep(0.35, 0.8, lawn) * fade;
          float a = blade.z;
          vec3 transformed = vec3(position.x, position.y * h, position.z); // tuft layout in meters
          // wind: the tip leans and wobbles
          float gust = sin(gtime * 1.7 + p.x * 0.35 + p.y * 0.21) * 0.5 + sin(gtime * 3.1 + p.x * 1.3) * 0.25;
          transformed.x += position.y * h * 0.5 * gust;
          float c = cos(a), s = sin(a);
          transformed.xz = mat2(c, -s, s, c) * transformed.xz;
          transformed.xz += p;
          vH = position.y;
          vShade = rr;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0); // shade like the ground under it');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH; varying float vShade;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 root = vec3(0.05, 0.09, 0.022), tip = mix(vec3(0.1, 0.16, 0.04), vec3(0.15, 0.17, 0.06), vShade);
          diffuseColor.rgb = mix(root, tip, vH);`);
    };
    mat.customProgramCacheKey = () => 'grass-blades';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  update(camera, t, enabled) {
    this.mesh.visible = enabled && camera.position.y < 30;
    this.uniforms.camXZ.value.set(camera.position.x, camera.position.z);
    this.uniforms.gtime.value = t;
  }

  setDensity(fraction) {
    this.mesh.geometry.instanceCount = Math.round(this.mesh.geometry.attributes.blade.count * fraction);
  }
}
