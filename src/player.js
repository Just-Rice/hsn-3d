// Player character (customizable), movement physics and follow camera.
import * as THREE from 'three';

export const DEFAULT_LOOK = {
  skin: '#e0ac86',
  hair: '#3b2616',
  shirt: '#1f45a8',
  pants: '#2f3e5c',
  shoes: '#f2f2f2',
  pack: '#aeb6c1',
};

export class Character {
  constructor(look = DEFAULT_LOOK) {
    this.group = new THREE.Group();
    this.mats = {};
    for (const k of Object.keys(DEFAULT_LOOK)) this.mats[k] = new THREE.MeshLambertMaterial({ color: look[k] || DEFAULT_LOOK[k] });
    const m = this.mats;
    const cap = (r, l, mat) => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), mat);
      mesh.castShadow = true;
      return mesh;
    };
    // hips pivot
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.group.add(this.hips);
    const torso = cap(0.2, 0.34, m.shirt);
    torso.position.y = 0.3;
    torso.scale.set(1.08, 1, 0.72);
    this.hips.add(torso);
    this.torso = torso;
    const pelvis = cap(0.17, 0.08, m.pants);
    pelvis.position.y = 0.02;
    pelvis.scale.set(1.12, 1, 0.8);
    this.hips.add(pelvis);
    // head
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.66;
    this.hips.add(this.headPivot);
    const neck = cap(0.06, 0.06, m.skin);
    neck.position.y = 0.02;
    this.headPivot.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 16), m.skin);
    head.position.y = 0.19;
    head.scale.set(1, 1.1, 1.03);
    head.castShadow = true;
    this.headPivot.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair);
    hair.position.set(0, 0.215, 0.015);
    hair.scale.set(1.02, 1.08, 1.06);
    hair.castShadow = true;
    this.headPivot.add(hair);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#1a1a1a' });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat);
      eye.position.set(s * 0.048, 0.205, -0.13);
      this.headPivot.add(eye);
    }
    // arms
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.27, 0.54, 0);
      this.hips.add(sh);
      const upper = cap(0.065, 0.26, m.shirt);
      upper.position.y = -0.16;
      sh.add(upper);
      const fore = cap(0.055, 0.22, m.skin);
      fore.position.y = -0.44;
      sh.add(fore);
      sh.rotation.z = s * 0.08;
      this.arms.push(sh);
    }
    // legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const hp = new THREE.Group();
      hp.position.set(s * 0.1, 0, 0);
      this.hips.add(hp);
      const thigh = cap(0.085, 0.36, m.pants);
      thigh.position.y = -0.24;
      hp.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hp.add(knee);
      const shin = cap(0.07, 0.34, m.pants);
      shin.position.y = -0.2;
      knee.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), m.shoes);
      shoe.position.set(0, -0.42, -0.05);
      shoe.castShadow = true;
      knee.add(shoe);
      this.legs.push({ hp, knee });
    }
    // backpack
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.16), m.pack);
    pack.position.set(0, 0.34, 0.2);
    pack.castShadow = true;
    this.hips.add(pack);
    this.phase = 0;
  }

  setLook(look) {
    for (const k of Object.keys(this.mats)) if (look[k]) this.mats[k].color.set(look[k]);
  }

  animate(dt, speed, grounded, sprint) {
    const moving = speed > 0.2;
    this.phase += dt * (moving ? speed * 2.1 : 0);
    const swing = moving ? Math.min(1, speed / 4) * (sprint ? 0.9 : 0.62) : 0;
    const k = Math.min(1, dt * 12);
    const lerp = (a, b) => a + (b - a) * k;
    const s = Math.sin(this.phase);
    if (!grounded) {
      this.legs[0].hp.rotation.x = lerp(this.legs[0].hp.rotation.x, -0.5);
      this.legs[1].hp.rotation.x = lerp(this.legs[1].hp.rotation.x, 0.3);
      this.legs[0].knee.rotation.x = lerp(this.legs[0].knee.rotation.x, 0.9);
      this.legs[1].knee.rotation.x = lerp(this.legs[1].knee.rotation.x, 0.4);
      this.arms[0].rotation.x = lerp(this.arms[0].rotation.x, -2.4);
      this.arms[1].rotation.x = lerp(this.arms[1].rotation.x, -2.4);
      this.hips.position.y = lerp(this.hips.position.y, 0.92);
      return;
    }
    this.legs[0].hp.rotation.x = lerp(this.legs[0].hp.rotation.x, s * swing);
    this.legs[1].hp.rotation.x = lerp(this.legs[1].hp.rotation.x, -s * swing);
    this.legs[0].knee.rotation.x = lerp(this.legs[0].knee.rotation.x, Math.max(0, -Math.cos(this.phase)) * swing * 1.3);
    this.legs[1].knee.rotation.x = lerp(this.legs[1].knee.rotation.x, Math.max(0, Math.cos(this.phase)) * swing * 1.3);
    this.arms[0].rotation.x = lerp(this.arms[0].rotation.x, -s * swing * 0.9);
    this.arms[1].rotation.x = lerp(this.arms[1].rotation.x, s * swing * 0.9);
    const bob = moving ? Math.abs(Math.cos(this.phase)) * 0.045 * swing : Math.sin(performance.now() / 700) * 0.006;
    this.hips.position.y = lerp(this.hips.position.y, 0.92 + bob);
    this.torso.rotation.x = lerp(this.torso.rotation.x, sprint && moving ? -0.12 : 0);
  }
}

export class Player {
  constructor(world, character) {
    this.world = world;
    this.char = character;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; // character facing
    this.radius = 0.3;
    this.height = 1.75;
    this.step = 0.5;
    this.grounded = true;
    this.visualY = 0;
    this.speed = 0;
    this.noclip = false;
  }

  teleport(x, y, z, yaw = null) {
    this.pos.set(x, y, z);
    this.visualY = y;
    this.vel.set(0, 0, 0);
    if (yaw !== null) this.yaw = yaw;
    const g = this.world.groundAt(x, z, y + 0.3, this.step);
    this.pos.y = g;
    this.visualY = g;
  }

  // move: {x (strafe), z (forward)} in camera space, camYaw
  update(dt, move, camYaw, sprint, jump) {
    const w = this.world;
    const maxSpeed = sprint ? 7.8 : 4.2;
    // desired velocity in world space. camera looks along (-sin yaw, -cos yaw)
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * move.z + rx * move.x, dz = fz * move.z + rz * move.x;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    const accel = this.grounded ? 14 : 4;
    const tx = dx * maxSpeed, tz = dz * maxSpeed;
    this.vel.x += (tx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (tz - this.vel.z) * Math.min(1, accel * dt);

    if (len > 0.05) {
      const target = Math.atan2(-dx, -dz);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }

    // horizontal move in substeps
    const total = Math.hypot(this.vel.x, this.vel.z) * dt;
    const n = Math.max(1, Math.ceil(total / 0.15));
    for (let i = 0; i < n; i++) {
      const ox = this.pos.x, oz = this.pos.z;
      let nx = ox + (this.vel.x * dt) / n, nz = oz + (this.vel.z * dt) / n;
      if (!this.noclip) {
        [nx, nz] = w.resolve(nx, nz, this.radius, this.pos.y, this.height, this.step);
        if (w.terrainBlocked(nx, oz, this.radius, this.pos.y, this.step)) nx = ox;
        if (w.terrainBlocked(nx, nz, this.radius, this.pos.y, this.step)) nz = oz;
      }
      this.pos.x = nx;
      this.pos.z = nz;
    }

    // vertical
    const ground = w.groundAt(this.pos.x, this.pos.z, this.pos.y, this.step);
    if (jump && this.grounded) {
      this.vel.y = 5.2;
      this.grounded = false;
    }
    if (this.grounded && this.vel.y <= 0) {
      if (ground >= this.pos.y - this.step) {
        this.pos.y = ground; // follow steps up and down
        this.vel.y = 0;
      } else {
        this.grounded = false;
      }
    }
    if (!this.grounded) {
      this.vel.y -= 16 * dt;
      this.pos.y += this.vel.y * dt;
      const ceil = w.ceilingAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
      if (this.pos.y + this.height > ceil) {
        this.pos.y = ceil - this.height;
        this.vel.y = Math.min(0, this.vel.y);
      }
      const g2 = w.groundAt(this.pos.x, this.pos.z, this.pos.y, this.step);
      if (this.pos.y <= g2) {
        this.pos.y = g2;
        this.vel.y = 0;
        this.grounded = true;
      }
    }
    // smoothed visual height (stairs)
    this.visualY += (this.pos.y - this.visualY) * Math.min(1, dt * 18);
    if (Math.abs(this.pos.y - this.visualY) > 1.2) this.visualY = this.pos.y;

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.char.group.position.set(this.pos.x, this.visualY, this.pos.z);
    this.char.group.rotation.y = this.yaw;
    this.char.animate(dt, this.speed, this.grounded, sprint);
  }

  get level() {
    return this.pos.y > 3.0 ? 1 : 0;
  }
}

export class FollowCamera {
  constructor(camera, world) {
    this.cam = camera;
    this.world = world;
    this.yaw = Math.PI / 2;
    this.pitch = -0.18;
    this.dist = 4.2;
    this.curDist = 4.2;
    this.firstPerson = false;
    this.target = new THREE.Vector3();
  }
  rotate(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.35, Math.min(1.2, this.pitch - dy));
  }
  zoom(d) {
    this.dist = Math.max(1.6, Math.min(14, this.dist * (1 + d)));
  }
  update(dt, player) {
    const eyeH = this.firstPerson ? 1.62 : 1.5;
    this.target.set(player.pos.x, player.visualY + eyeH, player.pos.z);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp); // look direction
    if (this.firstPerson) {
      this.cam.position.copy(this.target).addScaledVector(dir, 0.12);
      this.cam.lookAt(this.target.clone().addScaledVector(dir, 10));
      player.char.group.visible = false;
      return;
    }
    player.char.group.visible = true;
    const want = this.dist;
    const bx = this.target.x - dir.x * want, by = this.target.y - dir.y * want, bz = this.target.z - dir.z * want;
    const f = this.world.raycast(this.target.x, this.target.y, this.target.z, bx, by, bz, 0.18);
    const d = Math.max(0.5, want * f);
    // pull in fast, ease out slow
    this.curDist += (d - this.curDist) * Math.min(1, dt * (d < this.curDist ? 20 : 4));
    this.cam.position.set(this.target.x - dir.x * this.curDist, this.target.y - dir.y * this.curDist, this.target.z - dir.z * this.curDist);
    this.cam.lookAt(this.target);
    // fade the character when the camera is very close
    player.char.group.visible = this.curDist > 0.9;
  }
}
