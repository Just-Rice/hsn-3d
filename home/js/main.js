// Renderer, player, collision, camera, input and HUD.
import * as THREE from 'three';
import { buildHouse, updateDoors, toggleDoor } from './build.js';
import { ROOMS, GARAGE, HOUSE, LOT, PLAYER_START, SIDEWALK_Z } from './layout.js';

const WALK = 2.2, RUN = 4.2, ACCEL = 12, JUMP = 4.2, GRAV = 16;
const PLAYER_R = 0.28, PLAYER_H = 1.75;

// ---------- renderer and scene ----------

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#cfe2f3', 80, 260);

// Vertical sky gradient for the background.
{
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5f97d6');
  grad.addColorStop(0.55, '#b9d8f2');
  grad.addColorStop(1, '#e6eef4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
}

const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);

const hemi = new THREE.HemisphereLight('#dbe9ff', '#6d6252', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
sun.position.set(-30, 45, 25);
sun.target.position.set(6.5, 0, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const world = buildHouse(scene);
world.setLights(true);

// ---------- player ----------

const body = new THREE.Group();
{
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const shirt = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), mat('#1f45a8'));
  shirt.position.y = 1.05;
  shirt.castShadow = true;
  const pants = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 10), mat('#2f3e5c'));
  pants.position.y = 0.45;
  pants.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 16), mat('#e0ac86'));
  head.position.y = 1.62;
  head.castShadow = true;
  body.add(shirt, pants, head);
}
scene.add(body);

const player = {
  x: PLAYER_START.x, y: 0, z: PLAYER_START.z,
  vx: 0, vz: 0, vy: 0,
  yaw: PLAYER_START.yaw, pitch: 0.2,
  onGround: true, jumpQueued: false,
};
let firstPerson = false;
let camDist = 3.8;
let lightsOn = true;
let mapOn = true;
let helpOn = true;

// ---------- collision ----------

// Pushes the player out of every active box it overlaps. Only boxes that
// reach the player's height are checked, so the floor and the ceiling
// never block a walk.
function resolveCollisions(p) {
  for (let pass = 0; pass < 3; pass++) {
    for (const c of world.colliders) {
      if (!c.active) continue;
      if (c.min[1] > p.y + PLAYER_H || c.max[1] < p.y + 0.05) continue;
      const cx = Math.min(Math.max(p.x, c.min[0]), c.max[0]);
      const cz = Math.min(Math.max(p.z, c.min[2]), c.max[2]);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= PLAYER_R * PLAYER_R) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        const push = (PLAYER_R - d) / d;
        p.x += dx * push;
        p.z += dz * push;
      } else {
        // The center is inside the box: push out through the nearest face.
        const left = p.x - c.min[0], right = c.max[0] - p.x;
        const back = p.z - c.min[2], front = c.max[2] - p.z;
        const m = Math.min(left, right, back, front);
        if (m === left) p.x = c.min[0] - PLAYER_R;
        else if (m === right) p.x = c.max[0] + PLAYER_R;
        else if (m === back) p.z = c.min[2] - PLAYER_R;
        else p.z = c.max[2] + PLAYER_R;
      }
    }
  }
}

// Whether a point is inside any active box, for the camera.
function insideSolid(x, y, z, pad = 0.12) {
  for (const c of world.colliders) {
    if (!c.active) continue;
    if (x > c.min[0] - pad && x < c.max[0] + pad && y > c.min[1] - pad && y < c.max[1] + pad &&
        z > c.min[2] - pad && z < c.max[2] + pad) return true;
  }
  return false;
}

// ---------- input ----------

const keys = new Set();
let dragging = false;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (k === ' ') player.jumpQueued = true; // queued so a quick tap is not missed between frames
  else if (k === 'e') interact();
  else if (k === 'l') setLights(!lightsOn);
  else if (k === 'v') firstPerson = !firstPerson;
  else if (k === 'm') mapOn = !mapOn;
  else if (k === 'h') helpOn = !helpOn;
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.focus();
  if (!document.pointerLockElement && e.pointerType === 'mouse' && e.detail >= 2) canvas.requestPointerLock?.();
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (!dragging && document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0025;
  player.pitch = Math.min(0.75, Math.max(-0.5, player.pitch + e.movementY * 0.002));
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = Math.min(8, Math.max(1.6, camDist + e.deltaY * 0.004));
}, { passive: false });

function setLights(on) {
  lightsOn = on;
  world.setLights(on);
  hemi.intensity = on ? 0.9 : 0.5;
}

// Nearest door within reach, if any.
function nearestDoor(maxDist = 1.8) {
  let best = null, bestD = maxDist;
  for (const d of world.doors) {
    const dist = Math.hypot(player.x - d.pos[0], player.z - d.pos[1]);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best;
}

function interact() {
  const d = nearestDoor();
  if (d) toggleDoor(d);
}

// ---------- room lookup ----------

function whereAmI() {
  const { x, z } = player;
  for (const r of ROOMS) {
    const [x0, z0, x1, z1] = r.rect;
    if (x >= x0 && x < x1 && z >= z0 && z < z1) return r.name;
  }
  if (z < SIDEWALK_Z) return 'Street';
  if (z < 0) return 'Front yard';
  if (z > HOUSE.z1) return 'Back yard';
  return 'Side yard';
}

function insideHouse() {
  const { x, z } = player;
  const inHouse = x >= HOUSE.x0 && x <= HOUSE.x1 && z >= HOUSE.z0 && z <= HOUSE.z1;
  const inGarage = x >= GARAGE.x0 && x <= GARAGE.x1 && z >= GARAGE.z0 && z <= GARAGE.z1;
  return inHouse || inGarage;
}

// ---------- HUD and map ----------

const $where = document.getElementById('where');
const $sub = document.getElementById('sub');
const $prompt = document.getElementById('prompt');
const $help = document.getElementById('help');
const $mapWrap = document.getElementById('mapwrap');
const $map = document.getElementById('map');
const mctx = $map.getContext('2d');
let lastWhere = '';

function drawMap() {
  const W = $map.width, H = $map.height;
  const x0 = -1.5, x1 = 20.5, z0 = -1.5, z1 = 13.5;
  const s = Math.min(W / (x1 - x0), H / (z1 - z0));
  const ox = (W - (x1 - x0) * s) / 2, oz = (H - (z1 - z0) * s) / 2;
  // Plan coordinates: x to the right, z up the page (north at the top).
  const px = (x) => ox + (x - x0) * s;
  const pz = (z) => oz + (z1 - z) * s;
  mctx.clearRect(0, 0, W, H);
  mctx.fillStyle = '#e9efe2';
  mctx.fillRect(0, 0, W, H);
  const fills = { carpet: '#d8d2c4', wood: '#c9a27a', tile: '#e6e8ea', concrete: '#c9c9c4' };
  for (const r of ROOMS) {
    const [a, b, c, d] = r.rect;
    mctx.fillStyle = fills[r.floor] || '#ddd';
    mctx.fillRect(px(a), pz(d), (c - a) * s, (d - b) * s);
    mctx.strokeStyle = '#4b463e';
    mctx.lineWidth = 2;
    mctx.strokeRect(px(a), pz(d), (c - a) * s, (d - b) * s);
    mctx.fillStyle = '#2a2a2a';
    mctx.font = `${Math.max(9, s * 0.42)}px system-ui`;
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillText(r.name.replace(' & Dining', '').replace('Primary ', 'Pri. '), px((a + c) / 2), pz((b + d) / 2));
  }
  // Player: a dot and a heading tick.
  const dx = px(player.x), dy = pz(player.z);
  // The map flips z (north is up), so the facing direction's y sign is flipped too.
  const hx = dx - Math.sin(player.yaw) * 14, hy = dy + Math.cos(player.yaw) * 14;
  mctx.strokeStyle = '#d33';
  mctx.lineWidth = 3;
  mctx.beginPath(); mctx.moveTo(dx, dy); mctx.lineTo(hx, hy); mctx.stroke();
  mctx.fillStyle = '#d33';
  mctx.beginPath(); mctx.arc(dx, dy, 6, 0, Math.PI * 2); mctx.fill();
}

function updateHud() {
  const where = whereAmI();
  if (where !== lastWhere) {
    $where.textContent = where;
    lastWhere = where;
  }
  const hint = insideHouse() ? 'inside' : 'outside';
  $sub.textContent = `${hint} · lights ${lightsOn ? 'on' : 'off'} · ${firstPerson ? 'first' : 'third'} person`;
  const d = nearestDoor();
  if (d) {
    $prompt.textContent = `E: ${d.open ? 'close' : 'open'} ${d.label}`;
    $prompt.hidden = false;
  } else {
    $prompt.hidden = true;
  }
  $help.hidden = !helpOn;
  $mapWrap.hidden = !mapOn;
  if (mapOn) drawMap();
}

// ---------- update ----------

function update(dt) {
  // Input is relative to where the camera looks (yaw).
  const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw), rightZ = -Math.sin(player.yaw);
  const ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const iz = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  let dirX = fwdX * iz + rightX * ix;
  let dirZ = fwdZ * iz + rightZ * ix;
  const len = Math.hypot(dirX, dirZ);
  if (len > 0) { dirX /= len; dirZ /= len; }
  const speed = (keys.has('shift') ? RUN : WALK);
  const k = Math.min(1, ACCEL * dt);
  player.vx += (dirX * speed - player.vx) * k;
  player.vz += (dirZ * speed - player.vz) * k;

  // Move one axis at a time so the player slides along walls.
  player.x += player.vx * dt;
  resolveCollisions(player);
  player.z += player.vz * dt;
  resolveCollisions(player);

  // Keep on the lot.
  player.x = Math.min(LOT.x1 - 1, Math.max(LOT.x0 + 1, player.x));
  player.z = Math.min(LOT.z1 - 1, Math.max(SIDEWALK_Z + 0.5, player.z));

  // Jump and gravity. The floor is at y = 0 everywhere.
  if (player.jumpQueued && player.onGround) {
    player.vy = JUMP;
    player.onGround = false;
  }
  player.jumpQueued = false;
  player.vy -= GRAV * dt;
  player.y += player.vy * dt;
  if (player.y <= 0) {
    player.y = 0;
    player.vy = 0;
    player.onGround = true;
  }

  // Character model: it faces the way the player walks.
  body.position.set(player.x, player.y, player.z);
  body.rotation.y = player.yaw + Math.PI;
  body.visible = !firstPerson;

  // Camera.
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  // Unit vector the player faces, flattened to the floor.
  const facingX = -Math.sin(player.yaw) * cp, facingZ = -Math.cos(player.yaw) * cp;
  if (firstPerson) {
    camera.position.set(player.x, player.y + 1.6, player.z);
    camera.lookAt(player.x + facingX, player.y + 1.6 - sp, player.z + facingZ);
  } else {
    const tx = player.x, ty = player.y + 1.4, tz = player.z;
    // Orbit behind the player; pitch raises the camera.
    const desired = [tx - facingX * camDist, ty + sp * camDist, tz - facingZ * camDist];
    // Pull the camera in front of any wall between it and the player.
    let cam = desired;
    let clipped = false;
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = [tx + (desired[0] - tx) * t, ty + (desired[1] - ty) * t, tz + (desired[2] - tz) * t];
      if (insideSolid(p[0], p[1], p[2], 0.15)) {
        const back = Math.max(0, t - 1 / steps);
        cam = [tx + (desired[0] - tx) * back, ty + (desired[1] - ty) * back, tz + (desired[2] - tz) * back];
        clipped = true;
        break;
      }
    }
    const dist = Math.hypot(cam[0] - tx, cam[2] - tz);
    if (clipped && dist < 1.0) {
      // A wall is right behind the player: look forward from the head instead.
      camera.position.set(tx, ty + 0.1, tz);
      camera.lookAt(tx + facingX, ty + 0.1 - sp, tz + facingZ);
      body.visible = false;
    } else {
      camera.position.set(cam[0], Math.max(0.3, cam[1]), cam[2]);
      camera.lookAt(tx, ty, tz);
    }
  }

  // Doors swing and the roof steps aside when you are inside.
  updateDoors(world, dt);
  world.roof.visible = !insideHouse();
}

// ---------- loop and resize ----------

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  renderer.render(scene, camera);
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handles for the browser console: step the simulation at a fixed rate, for example __home.step(2).
window.__home = {
  player, world, camera, keys, setLights, interact,
  step(seconds = 1) { for (let i = 0; i < seconds * 60; i++) update(1 / 60); },
};
