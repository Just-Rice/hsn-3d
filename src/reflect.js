// Planar reflections for the floors: waxed hallway tile, the gym's finished maple, the stage.
// Every floor in the building is flat at one of a few heights, so one mirrored render of the
// scene per frame (at the height of the floor you stand on) gives true reflections of the
// ceiling lights, walls, lockers and people. Each floor material blends it in by Fresnel,
// blurs it by roughness (mip levels of the reflection) and ripples it with its normal map,
// so tile seams and wax unevenness break the reflection up the way they do in a real hall.
import * as THREE from 'three';

export class FloorReflections {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      samples: 0,
    });
    this.virtual = new THREE.PerspectiveCamera();
    this.dummy = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.dummy.needsUpdate = true;
    this.uniforms = {
      tReflect: { value: this.rt.texture },
      reflectMatrix: { value: new THREE.Matrix4() },
      reflectY: { value: -1e4 },
      reflectOn: { value: 0 },
    };
    this.scale = 0.5;
    this.enabled = false;
    this._v = {
      plane: new THREE.Plane(), n: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(), cam: new THREE.Vector3(),
      rot: new THREE.Matrix4(), look: new THREE.Vector3(0, 0, -1), target: new THREE.Vector3(), view: new THREE.Vector3(),
      clip: new THREE.Vector4(), q: new THREE.Vector4(),
    };
  }

  setSize(w, h) {
    this.rt.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
  }

  // strength: how much the surface reflects at grazing angles (waxed tile ~1, concrete ~0.2);
  // blur: roughness of the reflective top coat (wax, varnish), apart from the base material
  patch(mat, strength = 1, blur = 0.3) {
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.uniforms.reflectStrength = { value: strength };
      sh.uniforms.reflectBlur = { value: blur };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 reflectMatrix;\nvarying vec4 vReflectUv;\nvarying vec3 vReflectW;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 rw = modelMatrix * vec4(transformed, 1.0);
          vReflectW = rw.xyz;
          vReflectUv = reflectMatrix * rw;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tReflect; uniform float reflectY, reflectOn, reflectStrength, reflectBlur;
          varying vec4 vReflectUv; varying vec3 vReflectW;`)
        .replace('#include <opaque_fragment>', `
          if (reflectOn > 0.5 && abs(vReflectW.y - reflectY) < 0.06) {
            vec3 Vw = normalize(cameraPosition - vReflectW);
            // the normal map (view space) ripples the reflection
            vec2 ripple = (normal.xy - nonPerturbedNormal.xy) * 0.06;
            vec2 ruv = vReflectUv.xy / vReflectUv.w + ripple;
            float r = reflectBlur;
            vec3 refl = textureLod(tReflect, ruv, r * r * 9.0).rgb;
            float ndv = clamp(Vw.y, 0.0, 1.0);
            float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
            F *= reflectStrength * (1.0 - r * 0.85);
            // fade at the edges of the reflection image, where it has nothing to show
            vec2 e = smoothstep(0.0, 0.04, ruv) * smoothstep(1.0, 0.96, ruv);
            F *= e.x * e.y;
            outgoingLight = outgoingLight * (1.0 - F * 0.5) + refl * F;
          }
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'floorReflect';
    mat.needsUpdate = true;
  }

  // floorY: height of the floor around the camera (null: no reflection this frame)
  update(floorY) {
    const U = this.uniforms;
    const cam = this.camera, v = this._v;
    if (!this.enabled || floorY === null) {
      U.reflectOn.value = 0;
      return;
    }
    cam.updateMatrixWorld();
    v.cam.setFromMatrixPosition(cam.matrixWorld);
    if (v.cam.y <= floorY + 0.01) {
      U.reflectOn.value = 0;
      return;
    }
    U.reflectOn.value = 1;
    U.reflectY.value = floorY;
    // mirror the camera across y = floorY (as three's Reflector does)
    v.p.set(0, floorY, 0);
    v.view.x = v.cam.x;
    v.view.z = v.cam.z;
    v.view.y = 2 * floorY - v.cam.y;
    v.rot.extractRotation(cam.matrixWorld);
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.cam);
    v.target.copy(v.look);
    v.target.y = 2 * floorY - v.look.y;
    const vc = this.virtual;
    vc.position.copy(v.view);
    vc.up.set(0, 1, 0).applyMatrix4(v.rot).reflect(v.n);
    vc.lookAt(v.target);
    vc.near = cam.near;
    vc.far = Math.min(cam.far, 120);
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(cam.projectionMatrix);
    // texture matrix: world -> reflection uv
    U.reflectMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane, so nothing under the floor shows up in the reflection
    v.plane.setFromNormalAndCoplanarPoint(v.n, v.p).applyMatrix4(vc.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const P = vc.projectionMatrix.elements;
    v.q.x = (Math.sign(v.clip.x) + P[8]) / P[0];
    v.q.y = (Math.sign(v.clip.y) + P[9]) / P[5];
    v.q.z = -1.0;
    v.q.w = (1.0 + P[10]) / P[14];
    v.clip.multiplyScalar(2.0 / v.clip.dot(v.q));
    P[2] = v.clip.x;
    P[6] = v.clip.y;
    P[10] = v.clip.z + 1.0 - 0.003;
    P[14] = v.clip.w;

    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false; // reuse this frame's shadow map
    U.reflectOn.value = 0; // floors don't reflect inside the reflection
    U.tReflect.value = this.dummy; // and can't sample the texture being drawn
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, vc);
    r.setRenderTarget(prevRT);
    r.shadowMap.autoUpdate = prevShadow;
    r.xr.enabled = prevXr;
    U.tReflect.value = this.rt.texture;
    U.reflectOn.value = 1;
  }
}
