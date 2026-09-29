// Loose balls you can kick around: basketballs in the gyms, soccer balls on the fields, a
// football in the stadium and a beach ball in the pool. Simple rigid spheres against the
// same box colliders the player uses: gravity, bounces, rolling friction, buoyancy.
import * as THREE from 'three';

const KINDS = {
  basket: { r: 0.12, e: 0.78, color: '#d8661e', seams: '#2a1a10', mass: 0.6, roll: 0.9 },
  soccer: { r: 0.11, e: 0.62, color: '#f4f4f4', seams: '#1b1b1b', mass: 0.43, roll: 1.1 },
  football: { r: 0.11, e: 0.45, color: '#7a3b1c', seams: '#f2efe6', mass: 0.42, roll: 1.8, stretch: 1.5 },
  beach: { r: 0.3, e: 0.7, color: '#ffffff', seams: null, mass: 0.1, roll: 0.9, stripes: true, floats: true },
};

function ballTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = kind.color;
  g.fillRect(0, 0, 256, 128);
  if (kind.stripes) {
    const cols = ['#e63946', '#f1c40f', '#2a9d8f', '#1f45a8', '#ffffff', '#f77f00'];
    for (let i = 0; i < 6; i++) {
      g.fillStyle = cols[i];
      g.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 128);
    }
  } else if (kind === KINDS.soccer) {
    g.fillStyle = kind.seams;
    for (let i = 0; i < 10; i++) {
      const x = (i % 5) * 52 + (i < 5 ? 10 : 36), y = i < 5 ? 34 : 92;
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
      }
      g.fill();
    }
  } else {
    g.strokeStyle = kind.seams;
    g.lineWidth = kind === KINDS.football ? 3 : 4;
    if (kind === KINDS.football) {
      g.beginPath();
      g.moveTo(100, 64);
      g.lineTo(156, 64);
      g.stroke();
      for (let x = 108; x <= 148; x += 8) {
        g.beginPath();
        g.moveTo(x, 58);
        g.lineTo(x, 70);
        g.stroke();
      }
    } else {
      for (const x of [0, 64, 128, 192]) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, 128);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(0, 64);
      g.lineTo(256, 64);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Balls {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.geo = new THREE.SphereGeometry(1, 24, 16);
    this.mats = {};
  }

  add(type, x, y, z) {
    const kind = KINDS[type];
    if (!this.mats[type]) this.mats[type] = new THREE.MeshStandardMaterial({ map: ballTexture(kind), roughness: type === 'beach' ? 0.35 : 0.6 });
    const mesh = new THREE.Mesh(this.geo, this.mats[type]);
    mesh.scale.set(kind.r, kind.r, kind.r * (kind.stretch || 1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (kind.stretch) mesh.rotation.order = 'YXZ';
    this.scene.add(mesh);
    const b = { kind, mesh, pos: new THREE.Vector3(x, y + kind.r, z), vel: new THREE.Vector3(), home: [x, y, z], sleep: 0 };
    mesh.position.copy(b.pos);
    this.list.push(b);
    return b;
  }

  update(dt, player) {
    const w = this.world;
    const axis = new THREE.Vector3(), q = new THREE.Quaternion();
    const pr = player.radius;
    for (const b of this.list) {
      const { kind, pos, vel } = b;
      const r = kind.r;
      // player contact: push the ball out and kick it along the player's motion
      const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = pr + r + 0.04;
      if (d < reach && pos.y - r < player.pos.y + 1.2 && pos.y + r > player.pos.y - 0.1) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        pos.x = player.pos.x + nx * reach;
        pos.z = player.pos.z + nz * reach;
        const rel = (player.vel.x - vel.x) * nx + (player.vel.z - vel.z) * nz;
        if (rel > 0) {
          const kick = 1.35 + (player.speed > 5.5 ? 0.45 : 0);
          vel.x += nx * rel * kick;
          vel.z += nz * rel * kick;
          vel.y = Math.max(vel.y, Math.min(4.5, rel * (kind.stretch ? 0.9 : 0.45)));
        }
        b.sleep = 0;
      }
      if (b.sleep > 1.5) continue;

      // integrate with a couple of substeps for fast kicks
      const steps = Math.max(1, Math.ceil((Math.hypot(vel.x, vel.y, vel.z) * dt) / (r * 0.8)));
      const h = dt / steps;
      let onGround = false;
      for (let s = 0; s < steps; s++) {
        vel.y -= 9.8 * h;
        const water = player.waterAt(pos.x, pos.z);
        if (water && pos.y < water.y + r) {
          const sub = Math.min(1, (water.y + r - pos.y) / (2 * r));
          if (kind.floats) vel.y += 9.8 * 1.8 * sub * h;
          else vel.y += 9.8 * 0.7 * sub * h;
          const drag = 1 - Math.min(1, h * 2.2 * sub);
          vel.multiplyScalar(drag);
        }
        pos.addScaledVector(vel, h);
        // walls: push the ball's circle out of boxes it overlaps at its height
        const [rx, rz] = w.resolve(pos.x, pos.z, r, pos.y - r, 2 * r, r * 0.4);
        const px = rx - pos.x, pz = rz - pos.z, pl = Math.hypot(px, pz);
        if (pl > 1e-6) {
          const nx = px / pl, nz = pz / pl;
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= (1 + kind.e) * vn * nx;
            vel.z -= (1 + kind.e) * vn * nz;
          }
          pos.x = rx;
          pos.z = rz;
        }
        // floor and ceiling
        const g = w.groundAt(pos.x, pos.z, pos.y - r, r * 0.9);
        if (pos.y - r < g) {
          pos.y = g + r;
          if (vel.y < 0) vel.y = -vel.y * kind.e;
          if (vel.y < 0.6) vel.y = 0;
          onGround = true;
        }
        const c = w.ceilingAt(pos.x, pos.z, pos.y + r * 0.5);
        if (pos.y + r > c) {
          pos.y = c - r;
          vel.y = -Math.abs(vel.y) * kind.e;
        }
      }
      if (onGround) {
        const f = Math.exp(-kind.roll * dt);
        vel.x *= f;
        vel.z *= f;
      }
      // roll the mesh (a football points along its travel and spirals instead)
      const sp = Math.hypot(vel.x, vel.z);
      if (kind.stretch) {
        if (sp > 0.3) {
          b.mesh.rotation.y = Math.atan2(vel.x, vel.z);
          b.mesh.rotation.z += (sp * dt) / r * 0.4;
        }
      } else if (sp > 1e-3) {
        axis.set(vel.z, 0, -vel.x).normalize();
        q.setFromAxisAngle(axis, (sp * dt) / r);
        b.mesh.quaternion.premultiply(q);
      }
      b.mesh.position.copy(pos);
      b.sleep = sp < 0.03 && Math.abs(vel.y) < 0.05 && onGround ? b.sleep + dt : 0;
      // lost ball (fell out of the world): put it back
      if (pos.y < -30) {
        pos.set(b.home[0], b.home[1] + r + 1, b.home[2]);
        vel.set(0, 0, 0);
      }
    }
  }
}
