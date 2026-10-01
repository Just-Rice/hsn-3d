// Realistic player avatar: a Rocketbox character (assets/models/people) with motion-captured
// animation retargeted in Blender (tools/character). Same interface as Character in
// player.js (group, phase, animate, setLook), so it can replace the simple figure once loaded.
//
// Every clip is driven by hand (action.time and weights each frame) rather than played:
//  - walk, run and sprint share one normalized gait phase, offset per clip so the left heel
//    strikes at the same moment in all three, which lets them blend by speed without the
//    feet fighting each other. The phase advances by distance covered over stride length,
//    so the feet don't slide.
//  - the jump plays from takeoff to the top in step with the game's own jump, holds the
//    falling pose while in the air and plays the landing on touchdown.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const HEIGHT = 1.7; // 5'7", the player's height in player.js

// game speeds where each locomotion clip plays at full weight (m/s); see Player.update
const GAIT = [
  ['idle', 0],
  ['walk', 1.4],
  ['run', 3.4],
  ['sprint', 5.6],
];

export class Avatar {
  static async load(url) {
    const [gltf, meta] = await Promise.all([new GLTFLoader().loadAsync(url), fetch(url.replace(/\.glb$/, '.json')).then((r) => r.json())]);
    return new Avatar(gltf, meta);
  }

  constructor(gltf, meta) {
    this.meta = meta;
    this.group = new THREE.Group();
    const model = gltf.scene;
    // the model faces +Z; the game's characters face -Z
    model.rotation.y = Math.PI;
    const box = new THREE.Box3().setFromObject(model);
    this.scale = HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(this.scale);
    this.model = model;
    this.group.add(model);
    this.materials = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // the bind-pose bounds don't follow the animation
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.envMapIntensity = 0.8;
        this.materials.push(m);
      }
    });
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      a.paused = true; // time is set by hand
      this.actions[clip.name] = a;
    }
    this.w = Object.fromEntries(Object.keys(this.actions).map((k) => [k, k === 'idle' ? 1 : 0]));
    this.phase = 0; // gait phase in radians, as Character.phase (the camera bob reads it)
    this.gait = 0; // normalized gait phase, 0..1
    this.idleT = 0;
    this.air = null; // { t } while airborne, time since takeoff
    this.land = 1; // seconds since touchdown
    this.swimT = 0;
    this.wasGrounded = true;
  }

  setLook() {}

  // speed: horizontal m/s; grounded/sprint/swimming as in Character.animate
  animate(dt, speed, grounded, sprint, swimming = false, vy = 0) {
    const M = this.meta;
    const target = Object.fromEntries(Object.keys(this.actions).map((k) => [k, 0]));
    const at = (name, t) => {
      const a = this.actions[name];
      if (a) a.time = Math.max(0, Math.min(a.getClip().duration - 1e-4, t));
    };
    const cyc = (name, u) => at(name, (((u % 1) + 1) % 1) * M[name].duration);

    // locomotion weights from speed, between the two nearest gaits
    let lo = 0;
    while (lo < GAIT.length - 2 && speed > GAIT[lo + 1][1]) lo++;
    const [n0, s0] = GAIT[lo], [n1, s1] = GAIT[lo + 1];
    const k = Math.max(0, Math.min(1, (speed - s0) / (s1 - s0)));
    // stride length (m per cycle) of the blend, to advance the phase by distance
    const stride = (n) => (M[n] ? M[n].speed * M[n].duration : 1);
    const moving = speed > 0.15;
    if (moving) {
      const L = n0 === 'idle' ? stride(n1) : stride(n0) * (1 - k) + stride(n1) * k;
      this.gait += (dt * speed) / L;
    }
    this.phase = this.gait * Math.PI * 2;
    this.idleT += dt;

    if (swimming) {
      this.swimT += dt * (moving ? Math.max(0.8, speed / 2.3) : 0.35);
      target[moving ? 'swim' : 'idle'] = 1;
      cyc('swim', this.swimT / M.swim.duration);
      this.air = null;
    } else if (!grounded) {
      if (!this.air) this.air = { t: 0, rising: vy > 0.5 };
      this.air.t += dt;
      target.jump = 1;
      const J = M.jump;
      if (this.air.rising) {
        // the game reaches the top about 0.35 s after takeoff; the capture took ~0.23 s
        const up = Math.min(1, this.air.t / 0.35);
        at('jump', J.takeoff + up * (J.apex - J.takeoff) + (vy < 0 ? Math.min(0.15, -vy * 0.03) : 0));
      } else {
        // walked off a ledge: the falling part of the jump
        at('jump', J.apex + Math.min(0.15, this.air.t * 0.5));
      }
    } else {
      if (this.air) {
        this.land = 0;
        this.air = null;
      }
      this.land += dt;
      target[n0] = 1 - k;
      target[n1] = k;
      for (const [n] of GAIT) if (n !== 'idle' && M[n]) cyc(n, this.gait + M[n].lfoot);
      // the end of the jump capture is its landing; play it over the gait for a moment
      if (this.land < 0.35) {
        const J = M.jump;
        const f = 1 - this.land / 0.35;
        at('jump', J.land - 0.03 + this.land * 1.2);
        for (const n in target) target[n] *= 1 - f * 0.8;
        target.jump = f * 0.8;
      }
    }
    cyc('idle', this.idleT / M.idle.duration);

    // ease the weights toward their targets (fast enough that gait changes feel direct)
    const e = 1 - Math.exp(-dt * (this.air ? 18 : 12));
    let sum = 0;
    for (const n in this.w) {
      this.w[n] += (target[n] - this.w[n]) * e;
      sum += this.w[n];
    }
    for (const n in this.w) this.actions[n].setEffectiveWeight(sum > 0 ? this.w[n] / sum : 0);
    this.mixer.update(0);

    // swimming: the capture lies flat at its own hip height; float it at the surface
    // (player.js keeps the feet about 1.32 m under the water while swimming)
    const flat = this.w.swim || 0;
    this.model.position.y = flat * (1.32 - 0.12 - M.swim.hips * this.scale);
  }
}
