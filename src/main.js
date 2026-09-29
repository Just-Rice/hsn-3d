import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { CollisionWorld } from './physics.js';
import { buildBuilding } from './building.js';
import { buildFurniture } from './furniture.js';
import { buildExterior } from './exterior.js';
import { Character, Player, FollowCamera, DEFAULT_LOOK } from './player.js';
import { NavGrid } from './nav.js';
import { renderMaps, drawMinimap, drawPath, MAP, roomAtMap } from './map.js';
import { inRect } from './geo.js';
import { LEVEL_H, wx, wz, STAGE } from './layout.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('wwpn3d:' + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('wwpn3d:' + k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};
const isTouch = matchMedia('(pointer: coarse)').matches;
const hot = window.claude?.hot;

// ------------------------------------------------------------------ renderer + scene
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.15, 1800);
const airFog = new THREE.Fog(0xcfdde8, 260, 1200);
const waterFog = new THREE.FogExp2(0x2a8fb0, 0.16);
scene.fog = airFog;

// sky dome
{
  const g = new THREE.SphereGeometry(1500, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color('#4f8fd0') }, mid: { value: new THREE.Color('#bcd6ec') }, bot: { value: new THREE.Color('#e9eef0') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.6)) : mix(mid, bot, clamp(-h*4.0,0.0,1.0));
      gl_FragColor = vec4(c,1.0); }`,
  });
  const sky = new THREE.Mesh(g, m);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  scene.userData.sky = sky;
}

const hemi = new THREE.HemisphereLight(0xe6f0ff, 0xa89a84, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
const sunDir = new THREE.Vector3(-0.5, 0.78, 0.38).normalize();
sun.castShadow = store.get('shadows', !isTouch);
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// ------------------------------------------------------------------ UI helpers
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
const progress = (pct, msg) => {
  $('#loadbar i').style.width = pct + '%';
  $('#loadmsg').textContent = msg;
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
};

// ------------------------------------------------------------------ build the world
let info, ext, nav, maps, world, player, character, cam;
let running = false;

async function build() {
  await progress(5, 'Mixing brick and paint…');
  const T = makeTextures();
  for (const t of Object.values(T)) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  world = new CollisionWorld();
  await progress(20, 'Raising walls from the floor plans…');
  info = buildBuilding(scene, world, T);
  await progress(45, 'Setting out desks, lockers and seats…');
  buildFurniture(scene, world, info, T);
  await progress(62, 'Paving the parking lot and lining the field…');
  ext = buildExterior(scene, world, info, T);
  await progress(78, 'Mapping hallways and stairwells…');
  nav = new NavGrid(world, info);
  maps = renderMaps(info, ext);
  await progress(92, 'Getting you ready for first period…');
  const look = { ...DEFAULT_LOOK, ...store.get('look', {}) };
  character = new Character(look);
  scene.add(character.group);
  player = new Player(world, character);
  cam = new FollowCamera(camera, world);
  initPathViz();
  await progress(100, 'Ready.');
}

// ------------------------------------------------------------------ places
const SPOTS = () => {
  const c = (rm) => [rm.cx, rm.level ? LEVEL_H : 0, rm.cz];
  const room = (name) => info.rooms.find((r) => r.name === name || r.label === name);
  const st = [(wx(STAGE[0]) + wx(STAGE[2])) / 2, 0, wz(1045)];
  const cy = info.courtyard;
  return [
    { name: 'Main entrance', sub: 'Front walk by the flagpole', p: [-8, 0, wz(774)], yaw: -Math.PI / 2 },
    { name: 'Main Hall', sub: '1st floor', p: [wx(560), 0, wz(774)], yaw: -Math.PI / 2 },
    { name: 'Main Office', sub: '1st floor', p: c(room('Main Office')), yaw: 0 },
    { name: 'Media Center', sub: '1st floor', p: c(room('Media Center')), yaw: 0 },
    { name: 'Courtyard', sub: 'Open-air, center of the A-wing', p: [(cy[0] + cy[2]) / 2, 0, (cy[1] + cy[3]) / 2], yaw: -Math.PI / 2 },
    { name: 'Theatre stage', sub: 'Face the house', p: st, yaw: 0 },
    { name: 'Pool deck', sub: 'Indoor 25-yard pool', p: [wx(860), 0, wz(728)], yaw: 0 },
    { name: 'Main Gym', sub: 'Center court', p: c(room('Main Gym')), yaw: 0 },
    { name: 'Student Dining', sub: 'Upper dining', p: c(room('Upper Student Dining')), yaw: 0 },
    { name: 'A-Wing, 2nd floor', sub: 'Hallway by A203', p: [wx(363), LEVEL_H, wz(300)], yaw: Math.PI },
    { name: '200s Hallway', sub: '2nd floor, by 214', p: [wx(520), LEVEL_H, wz(535)], yaw: -Math.PI / 2 },
    { name: 'Football stadium', sub: '50-yard line', p: [ext.stadium.x, 0, ext.stadium.z + 20], yaw: 0 },
    { name: 'Home bleachers', sub: 'Top row', p: [ext.stadium.x - 20, 6, ext.stadium.z + 61.3], yaw: 0 },
    { name: 'Tennis courts', sub: 'North of the A-wing', p: [72, 0, -36], yaw: 0 },
    { name: 'Parking lot', sub: 'Off Grovers Mill Road', p: [-60, 0, 83], yaw: -Math.PI / 2 },
  ];
};

function teleport(p, yaw = null) {
  player.teleport(p[0], p[1], p[2], yaw);
  if (yaw !== null) cam.yaw = yaw;
  cam.curDist = 0.6;
  locate();
}

// a walkable spot just inside the room's main door (room centers are often full of desks)
function roomEntry(rm) {
  const d = rm.doorList[0];
  let px = rm.cx, pz = rm.cz;
  if (d) {
    const inset = Math.min(1.3, ((d.axis === 'z' ? rm.R[3] - rm.R[1] : rm.R[2] - rm.R[0]) / 2));
    [px, pz] = d.axis === 'z' ? [d.mid, d.c - d.out * inset] : [d.c - d.out * inset, d.mid];
  }
  const id = nav.nearestFree(rm.level, px, pz, 12, rm.R);
  return id >= 0 ? nav.center(id) : [px, pz];
}
function teleportToRoom(rm) {
  const [x, z] = roomEntry(rm);
  const d = rm.doorList[0];
  const yaw = d ? (d.axis === 'z' ? (d.out > 0 ? 0 : Math.PI) : d.out > 0 ? Math.PI / 2 : -Math.PI / 2) : null;
  teleport([x, rm.level ? LEVEL_H : 0, z], yaw);
}

// ------------------------------------------------------------------ location readout + visits
const visited = new Set(store.get('visited', []));
const numbered = () => info.rooms.filter((r) => r.label && r.type !== 'stair');
let lastWhere = '';
function locate() {
  const { x, z } = player.pos;
  const y = player.pos.y;
  const lv = player.level;
  const inside = !!info.blockAt(x, z) && !inRect(info.courtyard, x, z);
  let where = '', sub = '', floor = '';
  const stair = info.stairs.find((s) => inRect(s.R, x, z));
  if (stair && inside && y > 0.3 && y < LEVEL_H - 0.3) {
    where = 'Stairwell';
    floor = 'Between floors';
  } else if (inside) {
    floor = lv ? '2nd floor' : '1st floor';
    const rm = info.rooms.find((r) => r.level === lv && inRect(r.R, x, z));
    if (rm) {
      where = rm.type === 'stair' ? 'Stairwell' : rm.label && !rm.big && /\d/.test(rm.label) ? 'Room ' + rm.label : rm.name;
      sub = { class: 'Classroom', lab: 'Lab classroom', art: 'Art room', music: 'Music room', lecture: 'Tiered lecture hall', office: 'Office', lav: 'Restroom', locker: 'Locker room', storage: 'Storage', kitchen: 'Kitchen', gym: 'Gymnasium', pool: 'Natatorium', theatre: 'Auditorium', dining: 'Cafeteria', media: 'Library', weights: 'Weight room' }[rm.type] || '';
      if (rm.label && rm.type !== 'stair') {
        const key = rm.level + ':' + rm.label;
        if (!visited.has(key)) {
          visited.add(key);
          store.set('visited', [...visited]);
          if (rm.big) toast('Welcome to the ' + rm.name);
        }
      }
    } else {
      const zn = info.zones.find((zz) => zz.level === lv && inRect(zz.R, x, z));
      where = zn ? zn.name : info.blockAt(x, z).name + ' Hallway';
    }
  } else {
    floor = 'Outside';
    const s = ext.stadium;
    if (inRect(info.courtyard, x, z)) where = 'Courtyard';
    else if (inRect([s.x - s.w / 2 - 5, s.z - s.h / 2 - 25, s.x + s.w / 2 + 5, s.z + s.h / 2 + 30], x, z)) where = 'Football Stadium';
    else if (inRect([ext.lot[0], ext.lot[1], -44, ext.lot[3]], x, z)) where = 'Student Parking';
    else if (inRect([ext.loop[0], ext.loop[1], 9, ext.loop[3]], x, z)) where = 'Front Entrance';
    else if (inRect([25, -85, 110, -35], x, z)) where = 'Tennis Courts';
    else if (x < -115 && x > -130) where = 'Grovers Mill Road';
    else if (x <= -130) where = 'Community Middle School';
    else where = 'Campus Grounds';
  }
  const total = numbered().length;
  const html = `<div class="where">${where}</div><div class="sub"><span class="pill">${floor}</span>${sub ? `<span>${sub}</span>` : ''}<span class="count">${visited.size}/${total} rooms visited</span></div>`;
  if (html !== lastWhere) {
    $('#loc').innerHTML = html;
    lastWhere = html;
  }
}

// ------------------------------------------------------------------ navigation
let navDest = null, navPath = null, navTimer = 0, navFrom = null;
let dots, beacon, beaconLabel;
function initPathViz() {
  const g = new THREE.CircleGeometry(0.17, 14);
  g.rotateX(-Math.PI / 2);
  dots = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#ff4d6d', transparent: true, opacity: 0.9, depthWrite: false }), 700);
  dots.count = 0;
  dots.frustumCulled = false;
  dots.renderOrder = 4;
  scene.add(dots);
  beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 6, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ff4d6d', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beacon.visible = false;
  scene.add(beacon);
  beaconLabel = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  beaconLabel.visible = false;
  beaconLabel.renderOrder = 5;
  scene.add(beaconLabel);
}
function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(12,22,16,0.85)';
  g.beginPath();
  g.roundRect(8, 16, 496, 96, 24);
  g.fill();
  g.strokeStyle = '#d5dde8';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 50px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66, 470);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const roomTitle = (rm) => (rm.label && !rm.big && /\d/.test(rm.label) ? 'Room ' + rm.label : rm.name);

function setDestination(rm) {
  const [x, z] = roomEntry(rm);
  navDest = { room: rm, lv: rm.level, x, z };
  navTimer = 0;
  navFrom = null;
  const base = rm.level ? LEVEL_H : 0;
  beacon.position.set(x, base + 3, z);
  beacon.visible = true;
  beaconLabel.material.map?.dispose();
  beaconLabel.material.map = labelTexture(roomTitle(rm));
  beaconLabel.material.needsUpdate = true;
  beaconLabel.position.set(x, base + 3.1, z);
  beaconLabel.scale.set(3.2, 0.8, 1);
  beaconLabel.visible = true;
  $('#navbar').hidden = false;
  updateNav(0, true);
  closeOverlays();
  toast('Follow the red dots to ' + roomTitle(rm));
}
function clearNav() {
  navDest = null;
  navPath = null;
  dots.count = 0;
  beacon.visible = false;
  beaconLabel.visible = false;
  $('#navbar').hidden = true;
}
// distance from (x,z) to the route on level lv; returns [dist, segIndex, t]
function nearestOnPath(x, z, lv) {
  let best = [Infinity, 0, 0];
  const pts = navPath ? navPath.points : [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.lv !== lv || b.lv !== lv) continue;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < best[0]) best = [d, i, t];
  }
  return best;
}
function rebuildDots() {
  dots.count = 0;
  if (!navPath) return;
  const lv = player.level;
  const m = new THREE.Matrix4();
  let n = 0;
  const pts = navPath.points;
  const [, si, st] = nearestOnPath(player.pos.x, player.pos.z, lv);
  for (let i = si; i < pts.length - 1 && n < 700; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.lv !== lv || b.lv !== lv) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const k = Math.max(1, Math.round(len / 0.9));
    for (let j = 0; j < k && n < 700; j++) {
      const t = j / k;
      if (i === si && t < st) continue;
      m.makeTranslation(a.x + (b.x - a.x) * t, a.h + (b.h - a.h) * t + 0.07, a.z + (b.z - a.z) * t);
      dots.setMatrixAt(n++, m);
    }
  }
  dots.count = n;
  dots.instanceMatrix.needsUpdate = true;
}
function updateNav(dt, force = false) {
  if (!navDest) return;
  const { x, z } = player.pos;
  navTimer -= dt;
  if (!force && navTimer > 0) return;
  navTimer = 0.4;
  const lv = player.level;
  const [off] = nearestOnPath(x, z, lv);
  const onRoute = navPath && off < 2.5;
  if (force || !onRoute || !navFrom || navFrom[2] !== lv) {
    navFrom = [x, z, lv];
    const p = nav.find(lv, x, z, navDest.lv, navDest.x, navDest.z, navDest.room.R);
    if (p) navPath = p;
  }
  rebuildDots();
  const rm = navDest.room;
  let hint = '';
  if (navPath) {
    const other = navPath.points.some((q) => q.lv !== lv);
    if (other) hint = navDest.lv > lv ? 'Take the stairs up to the 2nd floor' : 'Take the stairs down to the 1st floor';
    else hint = 'Follow the dots';
  } else hint = 'No route found from here. Try quick travel.';
  // remaining distance along the route
  let dist = 0;
  if (navPath) {
    const pts = navPath.points;
    const [d0, si, st] = nearestOnPath(x, z, lv);
    for (let i = si; i < pts.length - 1; i++) {
      const L = pts[i].lv !== pts[i + 1].lv ? 12 : Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      dist += i === si ? L * (1 - st) : L;
    }
    if (isFinite(d0)) dist += d0;
  }
  $('#navbar .t').innerHTML = `Heading to <b>${roomTitle(rm)}</b>`;
  $('#navbar .d').textContent = `${rm.level ? '2nd floor' : '1st floor'} · about ${navPath ? Math.round(dist) : '?'} m · ${hint}`;
  if (lv === navDest.lv && inRect(navDest.room.R, x, z)) {
    toast('You made it to ' + roomTitle(navDest.room) + '!');
    clearNav();
  }
}
$('#navcancel').addEventListener('click', clearNav);

// ------------------------------------------------------------------ overlays
const overlays = { map: '#mapov', find: '#findov', tp: '#tpov', char: '#charov' };
let openName = null;
function closeOverlays() {
  for (const s of Object.values(overlays)) $(s).classList.remove('on');
  openName = null;
  keys.clear();
  canvas.focus();
}
function openOverlay(name) {
  if (!running) return;
  if (openName === name) return closeOverlays();
  closeOverlays();
  openName = name;
  document.exitPointerLock?.();
  $(overlays[name]).classList.add('on');
  if (name === 'map') drawBigMap();
  if (name === 'find') {
    $('#findq').value = '';
    renderFind('');
    setTimeout(() => $('#findq').focus(), 30);
  }
  if (name === 'tp') renderTp();
  if (name === 'char') renderChar();
}
$$('[data-close]').forEach((b) => b.addEventListener('click', closeOverlays));
$$('.overlay').forEach((o) => o.addEventListener('pointerdown', (e) => { if (e.target === o && o.id !== 'start') closeOverlays(); }));
$$('#tools [data-act]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = b.dataset.act;
    if (a === 'view') toggleView();
    else openOverlay(a);
  }),
);

function toggleView() {
  cam.firstPerson = !cam.firstPerson;
  $('#crosshair').hidden = !cam.firstPerson;
  toast(cam.firstPerson ? 'First-person view' : 'Third-person view', 1200);
}

// --- big map
let mapLv = 0, mapHover = null;
const MAPVIEW = { x0: -48, z0: -14, x1: 204, z1: 160 };
function mapToWorld(ev) {
  const c = $('#bigmap');
  const r = c.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
  return [MAPVIEW.x0 + u * (MAPVIEW.x1 - MAPVIEW.x0), MAPVIEW.z0 + v * (MAPVIEW.z1 - MAPVIEW.z0)];
}
function drawBigMap() {
  const c = $('#bigmap');
  const cw = Math.min(2000, Math.round(c.clientWidth * Math.min(2, devicePixelRatio)));
  const ch = Math.round((cw * (MAPVIEW.z1 - MAPVIEW.z0)) / (MAPVIEW.x1 - MAPVIEW.x0));
  if (c.width !== cw) { c.width = cw; c.height = ch; }
  const g = c.getContext('2d');
  const k = cw / ((MAPVIEW.x1 - MAPVIEW.x0) * MAP.ppm);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cw, ch);
  g.setTransform(k, 0, 0, k, -(MAPVIEW.x0 - MAP.x0) * MAP.ppm * k, -(MAPVIEW.z0 - MAP.z0) * MAP.ppm * k);
  g.drawImage(maps.maps[mapLv], 0, 0);
  const X = (x) => (x - MAP.x0) * MAP.ppm, Z = (z) => (z - MAP.z0) * MAP.ppm;
  if (mapHover) {
    const r = mapHover.R;
    g.strokeStyle = '#1f45a8';
    g.lineWidth = 3 / k;
    g.strokeRect(X(r[0]), Z(r[1]), (r[2] - r[0]) * MAP.ppm, (r[3] - r[1]) * MAP.ppm);
  }
  if (navPath) drawPath(g, navPath, mapLv, 2.5 / k);
  if (navDest && navDest.lv === mapLv) {
    g.fillStyle = '#ff4d6d';
    g.beginPath();
    g.arc(X(navDest.x), Z(navDest.z), 6 / k, 0, Math.PI * 2);
    g.fill();
  }
  if (player.level === mapLv || !info.blockAt(player.pos.x, player.pos.z)) {
    g.save();
    g.translate(X(player.pos.x), Z(player.pos.z));
    g.rotate(-player.yaw);
    g.fillStyle = '#ffd23f';
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 2 / k;
    g.beginPath();
    const s = 1 / k;
    g.moveTo(0, -12 * s); g.lineTo(9 * s, 9 * s); g.lineTo(0, 4 * s); g.lineTo(-9 * s, 9 * s);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (mapHover) {
    const text = roomTitle(mapHover) + (mapHover.big || !/\d/.test(mapHover.label || '') ? '' : '');
    g.font = `bold ${Math.round(15 * (cw / c.clientWidth))}px system-ui, sans-serif`;
    const w = g.measureText(text).width + 20;
    g.fillStyle = 'rgba(12,22,16,0.88)';
    g.fillRect(10, 10, w, 30 * (cw / c.clientWidth));
    g.fillStyle = '#f3efe2';
    g.textBaseline = 'middle';
    g.fillText(text, 20, 10 + 15 * (cw / c.clientWidth));
  }
}
$('#bigmap').addEventListener('mousemove', (e) => {
  const [x, z] = mapToWorld(e);
  const rm = roomAtMap(info, mapLv, x, z) || null;
  if (rm !== mapHover) {
    mapHover = rm;
    drawBigMap();
  }
});
$('#bigmap').addEventListener('click', (e) => {
  const [x, z] = mapToWorld(e);
  const rm = roomAtMap(info, mapLv, x, z);
  if (rm) setDestination(rm);
});
$('#bigmap').addEventListener('dblclick', (e) => {
  const [x, z] = mapToWorld(e);
  const rm = roomAtMap(info, mapLv, x, z);
  if (rm) {
    teleportToRoom(rm);
    closeOverlays();
  } else if (mapLv === 0) {
    teleport([x, 0, z]);
    closeOverlays();
  }
});
$$('#mapfloor button').forEach((b) =>
  b.addEventListener('click', () => {
    mapLv = +b.dataset.lv;
    $$('#mapfloor button').forEach((o) => o.classList.toggle('on', o === b));
    mapHover = null;
    drawBigMap();
  }),
);

// --- find
const ALIASES = {
  library: 'Media Center', cafeteria: 'Dining', lunch: 'Dining', auditorium: 'Theatre', stage: 'Theatre', bathroom: 'Restroom', toilet: 'Restroom',
  nurse: 'Nurse', guidance: 'Guidance', counselor: 'Guidance', swim: 'Pool', natatorium: 'Pool', office: 'Office', weights: 'Weight', gym: 'Gym', locker: 'Locker',
};
function renderFind(q) {
  q = q.trim().toLowerCase();
  const list = $('#findres');
  const alias = Object.entries(ALIASES).find(([k]) => q && k.startsWith(q))?.[1]?.toLowerCase();
  const rooms = info.rooms.filter((r) => r.type !== 'stair' && (r.label || r.big || r.name !== 'Storage'));
  let res = rooms.filter((r) => {
    if (!q) return r.big || /\d/.test(r.label || '');
    const hay = [r.label, r.name, roomTitle(r)].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q) || (alias && hay.includes(alias));
  });
  res.sort((a, b) => {
    const la = (a.label || '').toLowerCase(), lb = (b.label || '').toLowerCase();
    const sa = la.startsWith(q) ? 0 : 1, sb = lb.startsWith(q) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (a.big !== b.big) return a.big ? -1 : 1;
    return (a.label || a.name).localeCompare(b.label || b.name, undefined, { numeric: true });
  });
  // de-duplicate generic names (e.g. several "Restroom") by keeping all but labeling floor
  res = res.slice(0, 90);
  list.innerHTML = '';
  if (!res.length) {
    list.innerHTML = '<div class="muted">No rooms match that. Try a number like 214 or a word like pool.</div>';
    return;
  }
  for (const r of res) {
    const b = document.createElement('button');
    b.className = 'item' + (visited.has(r.level + ':' + r.label) ? ' visited' : '');
    b.innerHTML = `${roomTitle(r)}<small>${r.level ? '2nd floor' : '1st floor'}</small>`;
    b.addEventListener('click', () => setDestination(r));
    list.appendChild(b);
  }
}
$('#findq').addEventListener('input', (e) => renderFind(e.target.value));
$('#findq').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#findres .item')?.click();
});

// --- quick travel
function renderTp() {
  const list = $('#tplist');
  list.innerHTML = '';
  for (const s of SPOTS()) {
    const b = document.createElement('button');
    b.className = 'item';
    b.innerHTML = `${s.name}<small>${s.sub}</small>`;
    b.addEventListener('click', () => {
      teleport(s.p, s.yaw);
      closeOverlays();
      toast(s.name, 1500);
    });
    list.appendChild(b);
  }
}

// --- character
const PARTS = [
  ['shirt', 'Shirt', ['#1f45a8', '#c0c7d1', '#ffffff', '#14264f', '#b8322a', '#222222', '#2f7a47']],
  ['pants', 'Pants', ['#2f3e5c', '#222222', '#6b6b6b', '#c8b48a', '#14264f', '#5a3a28']],
  ['skin', 'Skin', ['#f3d2b5', '#e0ac86', '#c68a5e', '#9a6440', '#6e4428', '#4a2c1a']],
  ['hair', 'Hair', ['#1a1410', '#3b2616', '#7a4a24', '#c7924a', '#e3c77a', '#9b2d1f', '#7c7c7c']],
  ['shoes', 'Shoes', ['#f2f2f2', '#222222', '#b8322a', '#1f45a8', '#c0c7d1']],
  ['pack', 'Backpack', ['#aeb6c1', '#1f45a8', '#222222', '#b8322a', '#14264f', '#e86fa0']],
];
function currentLook() {
  return { ...DEFAULT_LOOK, ...store.get('look', {}) };
}
function renderChar() {
  const box = $('#charsw');
  box.innerHTML = '';
  const look = currentLook();
  for (const [k, label, opts] of PARTS) {
    const l = document.createElement('div');
    l.className = 'muted';
    l.textContent = label;
    const sw = document.createElement('div');
    sw.className = 'sw';
    for (const col of opts) {
      const b = document.createElement('button');
      b.style.background = col;
      b.title = col;
      b.setAttribute('aria-label', `${label} ${col}`);
      if (look[k].toLowerCase() === col) b.classList.add('on');
      b.addEventListener('click', () => setPart(k, col));
      sw.appendChild(b);
    }
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.id = 'col-' + k;
    inp.value = look[k];
    inp.setAttribute('aria-label', `Custom ${label} color`);
    inp.addEventListener('input', () => setPart(k, inp.value, false));
    sw.appendChild(inp);
    box.append(l, sw);
  }
  $('#optshadow').checked = sun.castShadow;
}
function setPart(k, col, rerender = true) {
  const look = currentLook();
  look[k] = col;
  store.set('look', look);
  character.setLook(look);
  if (rerender) renderChar();
}
$('#charreset').addEventListener('click', () => {
  store.set('look', DEFAULT_LOOK);
  character.setLook(DEFAULT_LOOK);
  renderChar();
});
$('#optshadow').addEventListener('change', (e) => {
  sun.castShadow = e.target.checked;
  store.set('shadows', sun.castShadow);
});

// ------------------------------------------------------------------ input
const keys = new Set();
let jumpQueued = false, locked = false, dragging = false, touchSprint = false;
const joy = { x: 0, z: 0, id: null };
const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox';
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (openName) closeOverlays();
    return;
  }
  if (typing() || !running) return;
  const k = e.code;
  if (k === 'Space') {
    e.preventDefault();
    if (!e.repeat && !openName) jumpQueued = true;
  }
  if (k.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) {
    keys.add(k);
    return;
  }
  if (k === 'KeyM') openOverlay('map');
  else if (k === 'KeyF') openOverlay('find');
  else if (k === 'KeyT') openOverlay('tp');
  else if (k === 'KeyC') openOverlay('char');
  else if (k === 'KeyV' && !openName) toggleView();
  else if (k === 'KeyH') {
    const h = $('#help');
    h.hidden = !h.hidden;
    store.set('help', !h.hidden);
  } else if (k === 'Backquote') $('#fps').hidden = !$('#fps').hidden;
  if (!openName) keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

canvas.addEventListener('click', () => {
  if (!running || openName || isTouch || locked) return;
  try {
    const r = canvas.requestPointerLock?.();
    if (r && r.catch) r.catch(() => {});
  } catch {
    /* pointer lock unavailable: drag to look instead */
  }
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});
canvas.addEventListener('mousedown', (e) => {
  if (!locked) dragging = true;
  canvas.focus();
  e.preventDefault();
});
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => {
  if (!running || openName) return;
  if (locked) cam.rotate(e.movementX * 0.0022, e.movementY * 0.0022);
  else if (dragging) cam.rotate(e.movementX * 0.005, e.movementY * 0.005);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.zoom(Math.sign(e.deltaY) * 0.12);
}, { passive: false });

// touch: joystick + drag-to-look
if (isTouch) {
  $('#touch').classList.add('on');
  $('#start .keys').innerHTML = '<kbd>Left pad</kbd><span>Walk</span><kbd>Drag</kbd><span>Look around</span><kbd>RUN · JUMP</kbd><span>Buttons at the bottom right</span><kbd>Top right</kbd><span>Map, find a room, quick travel, camera, character</span>';
  $('#mapov .muted').textContent = 'Tap a room for walking directions. Double-tap to go there instantly.';
  const jz = $('#joy'), knob = $('#joy i');
  jz.addEventListener('pointerdown', (e) => {
    joy.id = e.pointerId;
    jz.setPointerCapture(e.pointerId);
    moveJoy(e);
  });
  const moveJoy = (e) => {
    if (e.pointerId !== joy.id) return;
    const r = jz.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const L = Math.hypot(dx, dy), max = r.width / 2 - 10;
    if (L > max) { dx *= max / L; dy *= max / L; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = dx / max;
    joy.z = -dy / max;
  };
  jz.addEventListener('pointermove', moveJoy);
  const endJoy = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.id = null;
    joy.x = joy.z = 0;
    knob.style.transform = '';
  };
  jz.addEventListener('pointerup', endJoy);
  jz.addEventListener('pointercancel', endJoy);
  const looks = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    looks.set(e.pointerId, [e.clientX, e.clientY]);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = looks.get(e.pointerId);
    if (!p) return;
    cam.rotate((e.clientX - p[0]) * 0.006, (e.clientY - p[1]) * 0.006);
    looks.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const endLook = (e) => looks.delete(e.pointerId);
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);
  $('#tjump').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jumpQueued = true;
  });
  $('#tsprint').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touchSprint = !touchSprint;
    $('#tsprint').classList.toggle('on', touchSprint);
  });
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (openName === 'map') drawBigMap();
});

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
const miniCtx = $('#mini').getContext('2d');
let hudTimer = 0, fpsAcc = 0, fpsN = 0, indoorK = 0;
const dotM = new THREE.Matrix4();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (!player) return;
  if (running) {
    const mv = { x: 0, z: 0 };
    if (!openName) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) mv.z += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) mv.z -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) mv.x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) mv.x += 1;
      mv.x += joy.x;
      mv.z += joy.z;
    }
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchSprint;
    player.update(dt, mv, cam.yaw, sprint, jumpQueued);
    jumpQueued = false;
    if (player.pos.y < -20) teleport(SPOTS()[0].p, SPOTS()[0].yaw);
  } else {
    // idle orbit on the title screen
    cam.yaw += dt * 0.08;
    player.update(dt, { x: 0, z: 0 }, cam.yaw, false, false);
  }
  cam.update(dt, player);

  // lighting: follow the player; soften the sun indoors
  const p = player.pos;
  sun.target.position.set(Math.round(p.x), p.y, Math.round(p.z));
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 140);
  const inside = !!info.blockAt(p.x, p.z) && !inRect(info.courtyard, p.x, p.z);
  indoorK += ((inside ? 1 : 0) - indoorK) * Math.min(1, dt * 3);
  sun.intensity = 2.6 - indoorK * 2.3;
  hemi.intensity = 1.5 + indoorK * 0.55;

  info.updateDoors(p.x, p.z, dt);
  const wm = info.water.material.map;
  wm.offset.x = (t * 0.03) % 1;
  wm.offset.y = (t * 0.017) % 1;
  if (Math.hypot(p.x + 27, p.z - 74) < 160) ext.flag.userData.wave(t);

  const uw = inRect(info.poolPit, camera.position.x, camera.position.z) && camera.position.y < -0.22;
  scene.fog = uw ? waterFog : airFog;
  scene.userData.sky.position.copy(camera.position);

  updateNav(dt);
  if (dots.count) {
    for (let i = 0; i < dots.count; i++) {
      dots.getMatrixAt(i, dotM);
      const s = 0.75 + 0.35 * Math.max(0, Math.sin(t * 5 - i * 0.45));
      const e = dotM.elements;
      const x = e[12], y = e[13], z = e[14];
      dotM.makeScale(s, 1, s).setPosition(x, y, z);
      dots.setMatrixAt(i, dotM);
    }
    dots.instanceMatrix.needsUpdate = true;
    beacon.material.opacity = 0.22 + 0.1 * Math.sin(t * 3);
  }

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.2;
    locate();
  }
  const mc = $('#mini');
  drawMinimap(miniCtx, mc.width, maps.maps[player.level], p.x, p.z, cam.yaw, player.yaw, navPath, player.level, navDest && navDest.lv === player.level ? navDest : null);
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    $('#fps').textContent = Math.round(fpsN / fpsAcc) + ' fps';
    fpsAcc = 0;
    fpsN = 0;
  }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
function start(data = {}) {
  build()
    .then(() => {
      $('#help').hidden = !store.get('help', !isTouch);
      $('#fps').hidden = true;
      const s0 = SPOTS()[0];
      if (data.pos) {
        teleport(data.pos, data.yaw ?? 0);
        cam.yaw = data.camYaw ?? cam.yaw;
      } else teleport(s0.p, s0.yaw);
      if (data.look) character.setLook(data.look);
      const go = $('#go');
      go.disabled = false;
      go.textContent = 'Walk in';
      const begin = () => {
        $('#start').classList.remove('on');
        running = true;
        canvas.focus();
        toast('Welcome back to WW-P North');
      };
      go.addEventListener('click', () => {
        begin();
        if (!isTouch) {
          try {
            const r = canvas.requestPointerLock?.();
            if (r && r.catch) r.catch(() => {});
          } catch {
            /* optional */
          }
        }
      });
      if (data.started) begin();
      hot?.snapshot?.(() => ({ pos: [player.pos.x, player.pos.y, player.pos.z], yaw: player.yaw, camYaw: cam.yaw, started: running }));
      frame();
    })
    .catch((err) => {
      console.error(err);
      $('#loadmsg').textContent = 'Something went wrong while building the school: ' + err.message;
    });
}
hot?.ready ? hot.ready(start) : start(hot?.data ?? {});

// debug hooks for automated testing
window.__game = {
  get player() { return player; },
  get cam() { return cam; },
  get info() { return info; },
  get nav() { return nav; },
  teleport: (...a) => teleport(...a),
  setDestination: (label, lv) => setDestination(info.rooms.find((r) => r.label === label && (lv === undefined || r.level === lv))),
  get navPath() { return navPath; },
  routeToRoom: (rm) => { setDestination(rm); const p = navPath; clearNav(); return p; },
  keys,
  start: () => $('#go').click(),
  renderer,
};
