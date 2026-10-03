import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { makeTextures, loadPhotoTextures } from './textures.js';
import { makeMaterials } from './materials.js';
import { CollisionWorld } from './physics.js';
import { buildBuilding } from './building.js';
import { buildFurniture } from './furniture.js';
import { buildExterior, loadCars, loadTrees, sat } from './exterior.js';
import { Character, Player, FollowCamera, DEFAULT_LOOK } from './player.js';
import { NavGrid } from './nav.js';
import { Balls } from './balls.js';
import { loadLightmaps } from './lightmap.js';
import { renderMaps, drawMinimap, drawPath, drawLayers, roomAtMap, BUILDING_VIEW, MAP_BOUNDS } from './map.js';
import { inRect } from './geo.js';
import { LEVEL_H, wx, wz, hy, STAGE, MAIN_HALL_Y } from './layout.js';

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
// Quality tiers. "high" is the full look: soft sun shadows, ambient occlusion, bloom, MSAA.
const QUALITY = {
  low: { dpr: 1, shadow: 0, post: false, ao: false, samples: 0 },
  medium: { dpr: 1.5, shadow: 2048, post: true, ao: false, samples: 4 },
  high: { dpr: 2, shadow: 4096, post: true, ao: true, samples: 4 },
};
let quality = store.get('quality', isTouch ? 'medium' : 'high');
if (!QUALITY[quality]) quality = 'high';

const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.15, 1800);
const FOG = new THREE.Color('#c6d4df');
const airFog = new THREE.FogExp2(FOG, 0.0011);
const waterFog = new THREE.FogExp2(0x2a8fb0, 0.16);
scene.fog = airFog;

// sun from the south-southeast, about 50 degrees up (world +X is north, +Z is east)
const sunDir = new THREE.Vector3(-0.5, 0.78, 0.38).normalize();

// physically based sky; its output is scaled down to sit with the scene's light levels
function makeSky(scale) {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.05;
  u.mieCoefficient.value = 0.0045;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * 0.62, 1.0 );');
  return sky;
}
const sky = makeSky(1000);
sky.material.depthWrite = false;
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

// image-based lighting: the sky (with a grass-colored ground) outdoors, a neutral room indoors
const pmrem = new THREE.PMREMGenerator(renderer);
let skyEnv = (() => {
  const s = new THREE.Scene();
  s.add(makeSky(100));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.11, 0.11, 0.1) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  s.add(ground);
  return pmrem.fromScene(s, 0.02).texture;
})();
const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = skyEnv;

const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x8a7f6c, 0.35);
const HEMI_OUT = [new THREE.Color(0xdfe9ff), new THREE.Color(0x8a7f6c)];
const HEMI_IN = [new THREE.Color(0xf4f1ea), new THREE.Color(0xa7a6a2)];
// Ceiling fixtures near the player get real point lights (a small pool that follows you),
// so hallways and rooms have pools of light instead of flat ambient.
const BULBS = { low: 0, medium: 4, high: 8 };
const bulbs = [];
let bulbTimer = 0;
function setupBulbs() {
  const n = BULBS[quality];
  while (bulbs.length > n) scene.remove(bulbs.pop().light);
  while (bulbs.length < n) {
    const light = new THREE.PointLight(0xf3f2ee, 0, 10, 2);
    scene.add(light);
    bulbs.push({ light, at: null, want: null, k: 0 });
  }
}
function updateBulbs(dt, p, indoor) {
  if (!bulbs.length) return;
  bulbTimer -= dt;
  if (bulbTimer <= 0) {
    bulbTimer = 0.25;
    // nearest fixtures on this floor, weighted toward where the camera looks
    const fx = p.x - Math.sin(cam.yaw) * 3, fz = p.z - Math.cos(cam.yaw) * 3;
    const near = info.lightCenters
      .filter((c) => c[1] > p.y + 1.5 && c[1] < p.y + 9)
      .map((c) => [c, (c[0] - fx) ** 2 + (c[2] - fz) ** 2])
      .filter((e) => e[1] < 26 * 26)
      .sort((a, b) => a[1] - b[1])
      .slice(0, bulbs.length)
      .map((e) => e[0]);
    const free = [];
    for (const b of bulbs) {
      if (b.at && near.includes(b.at)) { b.want = b.at; near.splice(near.indexOf(b.at), 1); }
      else free.push(b);
    }
    for (const b of free) b.want = near.shift() || null;
  }
  for (const b of bulbs) {
    if (b.want !== b.at) {
      b.k = Math.max(0, b.k - dt * 4);
      if (b.k === 0) {
        b.at = b.want;
        if (b.at) b.light.position.set(b.at[0], b.at[1] - 0.35, b.at[2]);
      }
    } else if (b.at) b.k = Math.min(1, b.k + dt * 3);
    // with baked lighting the fixtures' light is already in the walls and floors; the
    // pool of real-time light stays for the character, furniture and floor highlights
    b.light.intensity = b.at ? b.k * indoor * (b.at[1] - p.y > 5 ? 26 : 9) * (baked ? 0.25 : 1) : 0;
    b.light.distance = b.at && b.at[1] - p.y > 5 ? 16 : 10;
  }
}
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
sun.shadow.bias = -0.0003;
scene.add(sun, sun.target);
// light-space axes, for snapping the shadow camera to whole texels (no shimmering)
const sunRight = new THREE.Vector3(), sunUp = new THREE.Vector3();
function setSunDir(v) {
  sunDir.copy(v).normalize();
  sunRight.crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
  sunUp.crossVectors(sunDir, sunRight).normalize();
  sky.material.uniforms.sunPosition.value.copy(sunDir);
}
setSunDir(sunDir);
// Photographed sky (Poly Haven HDRI, CC0, see assets/sky): its sun direction and haze color
// are read before the world is built; the background and lighting stream in afterwards.
let outdoorEnvIntensity = 1.0;
async function loadSky() {
  let meta;
  try {
    meta = await (await fetch('assets/sky/sky.json')).json();
  } catch {
    return;
  }
  setSunDir(new THREE.Vector3().fromArray(meta.sunDir));
  airFog.color.set(meta.fog);
  new THREE.TextureLoader().loadAsync('assets/sky/sky_bg.jpg').then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    scene.background = t;
    scene.backgroundIntensity = 1.15;
    sky.visible = false;
  }).catch(() => {});
  new RGBELoader().loadAsync('assets/sky/sky_env.hdr').then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(t).texture;
    t.dispose();
    if (scene.environment === skyEnv) scene.environment = env;
    skyEnv = env;
    outdoorEnvIntensity = meta.envIntensity;
  }).catch(() => {});
}
const shadowCenter = new THREE.Vector3();
let shadowHalf = 0, bldgShadow = null;

// post-processing chain: scene (MSAA, HDR) -> GTAO -> bloom -> vignette/grade -> tone map + sRGB
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - amount * smoothstep(0.18, 0.78, dot(d, d) * 1.6);
      // slight filmic grade: warm highlights, cool shadows
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb * vec3(0.97, 1.0, 1.04), c.rgb * vec3(1.03, 1.0, 0.96), smoothstep(0.05, 0.9, l));
      gl_FragColor = vec4(c.rgb * v, c.a);
    }`,
};
// GTAO that ignores glass, water, fences, tree cards and other see-through surfaces (its depth
// pass ignores alphaTest, so a cut-out billboard would shade as a solid rectangle)
class AOPass extends GTAOPass {
  overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      if (o.isPoints || o.isLine || o.isSprite || (o.material && (o.material.transparent || o.material.alphaTest > 0 || o.material.userData?.noAO))) o.visible = false;
    });
  }
}
let composer = null, aoPass = null, bloomPass = null;
function setupPost() {
  const q = QUALITY[quality];
  if (composer) {
    for (const ps of composer.passes) ps.dispose?.();
    composer.dispose();
  }
  composer = aoPass = bloomPass = null;
  const dpr = Math.min(devicePixelRatio, q.dpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  if (!q.post) return;
  const w = innerWidth * dpr, h = innerHeight * dpr;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.samples });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(dpr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  if (q.ao) {
    aoPass = new AOPass(scene, camera, w, h);
    aoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.15, samples: 12, screenSpaceRadius: false });
    aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    aoPass.blendIntensity = 0.85;
    composer.addPass(aoPass);
  }
  // threshold above 1 so only light sources glow, not a lit floor catching a reflection
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.55, 1.15);
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass(VignetteShader));
  composer.addPass(new OutputPass());
}
function applyQuality() {
  const q = QUALITY[quality];
  sun.castShadow = q.shadow > 0;
  if (q.shadow && sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  shadowHalf = 0;
  setupBulbs();
  scene.traverse((o) => o.material && (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)));
  setupPost();
}

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
  $('#loadbar').setAttribute('aria-valuenow', Math.round(pct));
  $('#loadmsg').textContent = msg;
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
};

// ------------------------------------------------------------------ build the world
let info, ext, nav, maps, world, player, character, cam, balls;
let baked = null; // lightmap manifest once the baked lighting has loaded
let texturesReady = Promise.resolve(0);
let running = false;

async function build() {
  await loadSky();
  await progress(5, 'Mixing brick and paint…');
  const T = makeTextures();
  for (const t of Object.values(T)) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const M = makeMaterials(T);
  // photo-scanned textures stream in and replace the procedural ones
  texturesReady = loadPhotoTextures(T).catch(() => 0);
  world = new CollisionWorld();
  await progress(20, 'Raising walls from the floor plans…');
  info = buildBuilding(scene, world, T, M);
  await progress(45, 'Setting out desks, lockers and seats…');
  buildFurniture(scene, world, info, T, M);
  await progress(62, 'Paving the lots and lining the fields…');
  ext = buildExterior(scene, world, info, T, M);
  loadCars(scene, ext).catch((e) => console.warn('car models unavailable', e));
  loadTrees(scene, ext).catch((e) => console.warn('tree sprites unavailable', e));
  await progress(78, 'Mapping hallways and stairwells…');
  nav = new NavGrid(world, info);
  maps = renderMaps(info, ext);
  // a fixed shadow frustum that covers the whole building, used while indoors
  {
    let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
    const c = new THREE.Vector3();
    for (const { r } of info.blockRects)
      for (const x of [r[0], r[2]]) for (const z of [r[1], r[3]]) for (const y of [0, 16]) {
        c.set(x, y, z);
        r0 = Math.min(r0, c.dot(sunRight)); r1 = Math.max(r1, c.dot(sunRight));
        u0 = Math.min(u0, c.dot(sunUp)); u1 = Math.max(u1, c.dot(sunUp));
      }
    const mid = new THREE.Vector3().addScaledVector(sunRight, (r0 + r1) / 2).addScaledVector(sunUp, (u0 + u1) / 2);
    bldgShadow = { center: mid, half: Math.max(r1 - r0, u1 - u0) / 2 + 2 };
  }
  await progress(92, 'Getting you ready for first period…');
  const look = { ...DEFAULT_LOOK, ...store.get('look', {}) };
  character = new Character(look);
  scene.add(character.group);
  world.waters = [{ r: info.poolPit, y: -0.22 }];
  player = new Player(world, character);
  cam = new FollowCamera(camera, world);
  // balls to kick around
  balls = new Balls(scene, world);
  for (const name of ['Main Gym', 'Auxiliary Gym']) {
    const g = info.rooms.find((r) => r.name === name);
    if (g) for (let i = 0; i < 3; i++) balls.add('basket', g.cx + (i - 1) * 1.6, 0.04, g.cz + (i % 2 ? 2.2 : -1.8));
  }
  {
    const pl = info.poolPit;
    balls.add('beach', (pl[0] + pl[2]) / 2 + 3, -0.5, (pl[1] + pl[3]) / 2);
    balls.add('football', ext.stadium.x - 6, 0.04, ext.stadium.z + 3);
    for (const [sx, sy] of [[375, 132], [494, 130], [340, 290]]) {
      const [x, z] = sat(sx, sy);
      balls.add('soccer', x, 0.02, z);
    }
    balls.add('soccer', ext.spawn[0] - 0.3, 0.05, ext.spawn[1] - 2.5); // on the walk, between the canopy's columns
  }
  initPathViz();
  applyQuality();
  // baked lighting loads in the background; the game starts with real-time lighting
  loadLightmaps(info.lightmap, info.lightmapped).then((man) => {
    if (!man) return;
    baked = man;
    applyQuality();
  });
  await progress(100, 'Ready.');
}

// ------------------------------------------------------------------ places
const SPOTS = () => {
  const c = (rm) => [rm.cx, rm.level ? LEVEL_H : 0, rm.cz];
  const room = (name) => info.rooms.find((r) => r.name === name || r.label === name);
  const st = [(wx(STAGE[0]) + wx(STAGE[2])) / 2, 0, wz(hy(1045))];
  const cy = info.courtyard;
  const s = ext.stadium, wl = ext.lots.westLot;
  const [tx, tz] = sat(212.5, 789);
  const [fx, fz] = sat(385, 130);
  const [bx, bz] = sat(640, 902);
  // yaw: 0 faces west (-Z), -PI/2 faces north (+X), PI/2 south, PI east
  return [
    { name: 'Main entrance', sub: 'Front walk off the bus loop', p: [ext.spawn[0], 0, ext.spawn[1]], yaw: -Math.PI / 2 },
    { name: 'Main Hall', sub: '1st floor', p: [wx(560), 0, wz(MAIN_HALL_Y)], yaw: -Math.PI / 2 },
    { name: 'Main Office', sub: '1st floor', p: c(room('Main Office')), yaw: 0 },
    { name: 'Media Center', sub: '1st floor', p: c(room('Media Center')), yaw: 0 },
    { name: 'Courtyard', sub: 'Open-air, center of the A-wing', p: [(cy[0] + cy[2]) / 2, 0, (cy[1] + cy[3]) / 2], yaw: -Math.PI / 2 },
    { name: 'Theatre stage', sub: 'Face the house', p: st, yaw: 0 },
    { name: 'Pool deck', sub: 'Indoor 25-yard pool', p: [wx(860), 0, wz(728)], yaw: 0 },
    { name: 'Main Gym', sub: 'Center court', p: c(room('Main Gym')), yaw: 0 },
    { name: 'Upper Dining Hall', sub: 'UDH', p: c(room('Upper Dining Hall')), yaw: 0 },
    { name: 'Lower Dining Hall', sub: 'LDH', p: c(room('Lower Dining Hall')), yaw: 0 },
    { name: 'A-Wing, 2nd floor', sub: 'Hallway by A203', p: [wx(363), LEVEL_H, wz(300)], yaw: Math.PI },
    { name: '200s Hallway', sub: '2nd floor, by 214', p: [wx(520), LEVEL_H, wz(535)], yaw: -Math.PI / 2 },
    { name: 'Football stadium', sub: '50-yard line, facing the home stands', p: [s.x - 12, 0, s.z], yaw: -Math.PI / 2 },
    { name: 'Home bleachers', sub: 'Top row, by the press box', p: [s.x + 58.4, 5.1, s.z + 14], yaw: Math.PI / 2 },
    { name: 'Tennis courts', sub: 'Six courts west of the building', p: [tx, 0, tz], yaw: -Math.PI / 2 },
    { name: 'Practice fields', sub: 'North of the stadium', p: [fx, 0, fz], yaw: -Math.PI / 2 },
    { name: 'Bus loop', sub: 'Along the south face', p: [bx, 0, bz], yaw: Math.PI },
    { name: 'Student parking', sub: 'West lot', p: [wl[0] + 2 * 18 + 9, 0, (wl[1] + wl[3]) / 2], yaw: Math.PI },
  ];
};

function teleport(p, yaw = null) {
  player.teleport(p[0], p[1], p[2], yaw);
  // snap the indoor/outdoor lighting instead of fading it in
  indoorK = info.blockAt(p[0], p[2]) && !inRect(info.courtyard, p[0], p[2]) ? 1 : 0;
  if (yaw !== null) cam.yaw = yaw;
  cam.curDist = cam.dist; // the camera's wall check pulls it in right away if needed
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
      sub = (abbr(rm) ? abbr(rm) + ' · ' : '') + ({ class: 'Classroom', lab: 'Lab classroom', art: 'Art room', music: 'Music room', lecture: 'Tiered lecture hall', office: 'Office', lav: 'Restroom', locker: 'Locker room', storage: 'Storage', kitchen: 'Kitchen', gym: 'Gymnasium', pool: 'Natatorium', theatre: 'Auditorium', dining: 'Cafeteria', media: 'Library', weights: 'Weight room' }[rm.type] || '');
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
    where = inRect(info.courtyard, x, z) ? 'Courtyard' : ext.areaAt(x, z);
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
// short names people actually use, like UDH / LDH for the dining halls
const abbr = (rm) => (rm.big && /^[A-Z]{2,4}$/.test(rm.label || '') ? rm.label : '');
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
  if (name !== 'find') $(overlays[name] + ' [data-close]').focus({ preventScroll: true });
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

// --- big map (north-up; wheel or pinch to zoom, drag to pan)
let mapLv = 0, mapHover = null;
const mapView = { cu: 0, cv: 0, k: 0 }; // center in map meters, CSS px per meter
function fitMapView() {
  const c = $('#bigmap');
  const V = BUILDING_VIEW;
  mapView.cu = (V.u0 + V.u1) / 2;
  mapView.cv = (V.v0 + V.v1) / 2;
  mapView.k = Math.min(c.clientWidth / (V.u1 - V.u0), c.clientHeight / (V.v1 - V.v0));
}
function clampMapView() {
  const c = $('#bigmap');
  const B = MAP_BOUNDS;
  const kMin = Math.min(c.clientWidth / (B.u1 - B.u0), c.clientHeight / (B.v1 - B.v0));
  mapView.k = Math.max(kMin, Math.min(30, mapView.k));
  const hw = c.clientWidth / 2 / mapView.k, hh = c.clientHeight / 2 / mapView.k;
  mapView.cu = Math.max(B.u0 + Math.min(hw, (B.u1 - B.u0) / 2), Math.min(B.u1 - Math.min(hw, (B.u1 - B.u0) / 2), mapView.cu));
  mapView.cv = Math.max(B.v0 + Math.min(hh, (B.v1 - B.v0) / 2), Math.min(B.v1 - Math.min(hh, (B.v1 - B.v0) / 2), mapView.cv));
}
function mapToWorld(ev) {
  const c = $('#bigmap');
  const r = c.getBoundingClientRect();
  const u = mapView.cu + (ev.clientX - r.left - r.width / 2) / mapView.k;
  const v = mapView.cv + (ev.clientY - r.top - r.height / 2) / mapView.k;
  return [-v, u];
}
function drawBigMap() {
  const c = $('#bigmap');
  const dpr = Math.min(2, devicePixelRatio);
  const cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  if (!mapView.k) fitMapView();
  clampMapView();
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#6f9a50';
  g.fillRect(0, 0, cw, ch);
  const k = mapView.k * dpr;
  g.setTransform(k, 0, 0, k, cw / 2 - mapView.cu * k, ch / 2 - mapView.cv * k);
  drawLayers(g, maps, mapLv);
  if (mapHover) {
    const r = mapHover.R;
    g.strokeStyle = '#1f45a8';
    g.lineWidth = 3 / k;
    g.strokeRect(r[1], -r[2], r[3] - r[1], r[2] - r[0]);
  }
  if (navPath) drawPath(g, navPath, mapLv, Math.max(0.5, 3 / k));
  if (navDest && navDest.lv === mapLv) {
    g.fillStyle = '#ff4d6d';
    g.beginPath();
    g.arc(navDest.z, -navDest.x, 6 / k, 0, Math.PI * 2);
    g.fill();
  }
  if (player.level === mapLv || !info.blockAt(player.pos.x, player.pos.z)) {
    g.save();
    g.translate(player.pos.z, -player.pos.x);
    g.rotate(-player.yaw - Math.PI / 2);
    g.scale(1 / k, 1 / k);
    g.fillStyle = '#ffd23f';
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -13); g.lineTo(10, 10); g.lineTo(0, 4); g.lineTo(-10, 10);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // compass
  g.fillStyle = 'rgba(10,16,32,0.8)';
  g.beginPath();
  g.arc(c.clientWidth - 26, 26, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 13px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('N', c.clientWidth - 26, 22);
  g.beginPath();
  g.moveTo(c.clientWidth - 26, 9); g.lineTo(c.clientWidth - 22, 15); g.lineTo(c.clientWidth - 30, 15);
  g.fill();
  if (mapHover) {
    const text = roomTitle(mapHover);
    g.font = 'bold 15px system-ui, sans-serif';
    g.textAlign = 'left';
    const w = g.measureText(text).width + 20;
    g.fillStyle = 'rgba(12,22,16,0.88)';
    g.fillRect(10, 10, w, 30);
    g.fillStyle = '#f3efe2';
    g.fillText(text, 20, 25);
  }
}
{
  const bm = $('#bigmap');
  const ptrs = new Map();
  let moved = 0, pinch = 0;
  bm.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, z] = mapToWorld(e);
    const f = Math.exp(-Math.sign(e.deltaY) * 0.18);
    const r = bm.getBoundingClientRect();
    mapView.k *= f;
    clampMapView();
    // keep the point under the cursor fixed
    mapView.cu = z - (e.clientX - r.left - r.width / 2) / mapView.k;
    mapView.cv = -x - (e.clientY - r.top - r.height / 2) / mapView.k;
    drawBigMap();
  }, { passive: false });
  bm.addEventListener('pointerdown', (e) => {
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    bm.setPointerCapture(e.pointerId);
    moved = 0;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
  });
  bm.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        const [x, z] = mapToWorld(e);
        const rm = roomAtMap(info, mapLv, x, z) || null;
        if (rm !== mapHover) {
          mapHover = rm;
          drawBigMap();
        }
      }
      return;
    }
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) mapView.k *= d / pinch;
      pinch = d;
      moved += 10;
    } else {
      moved += Math.abs(dx) + Math.abs(dy);
      mapView.cu -= dx / mapView.k;
      mapView.cv -= dy / mapView.k;
    }
    drawBigMap();
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = 0;
  };
  bm.addEventListener('pointerup', up);
  bm.addEventListener('pointercancel', up);
  bm.addEventListener('click', (e) => {
    if (moved > 6) return;
    const [x, z] = mapToWorld(e);
    const rm = roomAtMap(info, mapLv, x, z);
    if (rm) setDestination(rm);
  });
  bm.addEventListener('dblclick', (e) => {
    const [x, z] = mapToWorld(e);
    const rm = roomAtMap(info, mapLv, x, z);
    if (rm) {
      teleportToRoom(rm);
      closeOverlays();
    } else if (mapLv === 0 || !info.blockAt(x, z)) {
      teleport([x, mapLv && info.blockAt(x, z) ? LEVEL_H : 0, z]);
      closeOverlays();
    }
  });
}
$$('#mapfloor button').forEach((b) =>
  b.addEventListener('click', () => {
    mapLv = +b.dataset.lv;
    $$('#mapfloor button').forEach((o) => {
      o.classList.toggle('on', o === b);
      o.setAttribute('aria-pressed', o === b);
    });
    mapHover = null;
    drawBigMap();
  }),
);

// --- find
const ALIASES = {
  library: 'Media Center', cafeteria: 'Dining', lunch: 'Dining', 'dining hall': 'Dining', auditorium: 'Theatre', stage: 'Theatre', bathroom: 'Restroom', toilet: 'Restroom',
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
    b.innerHTML = `${roomTitle(r)}<small>${abbr(r) ? abbr(r) + ' · ' : ''}${r.level ? '2nd floor' : '1st floor'}</small>`;
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
      b.setAttribute('aria-pressed', look[k].toLowerCase() === col);
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
  $$('#optq button').forEach((b) => {
    b.classList.toggle('on', b.dataset.q === quality);
    b.setAttribute('aria-pressed', b.dataset.q === quality);
  });
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
$$('#optq button').forEach((b) =>
  b.addEventListener('click', () => {
    quality = b.dataset.q;
    store.set('quality', quality);
    applyQuality();
    renderChar();
  }),
);

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
    $('#tsprint').setAttribute('aria-pressed', touchSprint);
  });
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  composer?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (openName === 'map') drawBigMap();
});

let freeCam = null; // debug: [position, lookAt]
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
  if (freeCam) {
    camera.position.set(...freeCam[0]);
    camera.up.set(...(freeCam[2] || [0, 1, 0]));
    camera.lookAt(...freeCam[1]);
    camera.up.set(0, 1, 0);
  }
  balls.update(dt, player);

  // lighting
  const p = player.pos;
  const inside = !!info.blockAt(p.x, p.z) && !inRect(info.courtyard, p.x, p.z);
  indoorK += ((inside ? 1 : 0) - indoorK) * Math.min(1, dt * 3);
  updateSun(p, inside);
  updateBulbs(dt, p, indoorK);

  info.updateDoors(p.x, p.z, dt);
  const wm = info.water.material.map;
  wm.offset.x = (t * 0.03) % 1;
  wm.offset.y = (t * 0.017) % 1;
  if (Math.hypot(p.x - ext.flagPos[0], p.z - ext.flagPos[1]) < 160) ext.flag.userData.wave(t);

  const uw = inRect(info.poolPit, camera.position.x, camera.position.z) && camera.position.y < -0.22;
  scene.fog = uw ? waterFog : airFog;
  sky.position.copy(camera.position);

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
  drawMinimap(miniCtx, mc.width, maps, p.x, p.z, cam.yaw, player.yaw, navPath, player.level, navDest && navDest.lv === player.level ? navDest : null);
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    $('#fps').textContent = Math.round(fpsN / fpsAcc) + ' fps';
    fpsAcc = 0;
    fpsN = 0;
  }
  if (composer) composer.render(dt);
  else renderer.render(scene, camera);
}

// Sun shadows: a tight frustum around the player outdoors, one covering the whole building
// indoors (so rooms far down a hallway are still shaded by the roof). Without shadow maps
// (low quality) the sun is dimmed indoors instead, since nothing would block it.
function updateSun(p, inside) {
  const q = QUALITY[quality];
  const shadows = q.shadow > 0;
  let half, center;
  if (shadows && inside && bldgShadow) {
    half = bldgShadow.half;
    center = shadowCenter.copy(bldgShadow.center);
  } else {
    half = 42;
    const texel = (2 * half) / (q.shadow || 2048);
    center = shadowCenter.set(p.x, p.y, p.z);
    const r = Math.round(center.dot(sunRight) / texel) * texel;
    const u = Math.round(center.dot(sunUp) / texel) * texel;
    const f = center.dot(sunDir);
    center.set(0, 0, 0).addScaledVector(sunRight, r).addScaledVector(sunUp, u).addScaledVector(sunDir, f);
  }
  if (half !== shadowHalf) {
    shadowHalf = half;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 600 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = ((2 * half) / (q.shadow || 2048)) * 1.4;
  }
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunDir, 300);
  const k = shadows ? 0 : indoorK;
  sun.intensity = 3.1 * (1 - k * 0.85);
  hemi.intensity = baked ? 0.35 * (1 - indoorK) + 0.12 * indoorK : 0.35 + indoorK * 0.1;
  hemi.color.lerpColors(HEMI_OUT[0], HEMI_IN[0], indoorK);
  hemi.groundColor.lerpColors(HEMI_OUT[1], HEMI_IN[1], indoorK);
  const env = indoorK > 0.5 ? roomEnv : skyEnv;
  if (scene.environment !== env) scene.environment = env;
  scene.environmentIntensity = indoorK > 0.5 ? 0.55 : outdoorEnvIntensity;
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
        toast('Welcome back to HSN');
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
  plan: (px, py) => [wx(px), wz(py)],
  view: (p, yaw, pitch = -0.05, dist = null, fp = false) => { teleport(p, yaw); cam.yaw = yaw; cam.pitch = pitch; cam.firstPerson = fp; if (dist) cam.dist = cam.curDist = dist; },
  setDestination: (label, lv) => setDestination(info.rooms.find((r) => r.label === label && (lv === undefined || r.level === lv))),
  get navPath() { return navPath; },
  routeToRoom: (rm) => { setDestination(rm); const p = navPath; clearNav(); return p; },
  keys,
  sat,
  sunDir,
  levelH: LEVEL_H,
  scene,
  camera,
  get balls() { return balls; },
  get texturesReady() { return texturesReady; },
  freeCam: (pos, at, up) => { freeCam = pos ? [pos, at, up] : null; },
  setQuality: (q) => { quality = q; applyQuality(); },
  start: () => $('#go').click(),
  renderer,
};
