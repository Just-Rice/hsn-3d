// Shared physically-based materials. Texture UVs are in meters (see geo.js), so every
// material can be used on any surface size without stretching.
import * as THREE from 'three';

export function makeMaterials(T) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const n = (s) => new THREE.Vector2(s, s);
  const M = {
    wall: std({ map: T.block, normalMap: T.blockN, normalScale: n(1.0), vertexColors: true, roughness: 0.78 }),
    brick: std({ map: T.brick, normalMap: T.brickN, normalScale: n(1.3), roughness: 0.88 }),
    floorTile: std({ map: T.tile, normalMap: T.tileN, normalScale: n(0.35), vertexColors: true, roughness: 0.26 }),
    carpet: std({ map: T.carpet, normalMap: T.carpetN, normalScale: n(0.7), vertexColors: true, roughness: 1.0 }),
    wood: std({ map: T.wood, normalMap: T.woodN, normalScale: n(0.45), vertexColors: true, roughness: 0.24 }),
    stage: std({ map: T.wood, normalMap: T.woodN, normalScale: n(0.2), vertexColors: true, roughness: 0.55 }),
    ceramic: std({ map: T.ceramic, normalMap: T.ceramicN, normalScale: n(0.6), vertexColors: true, roughness: 0.16 }),
    concrete: std({ map: T.concrete, normalMap: T.concreteN, normalScale: n(0.6), vertexColors: true, roughness: 0.88 }),
    ceiling: std({ map: T.ceiling, normalMap: T.ceilingN, normalScale: n(0.6), vertexColors: true, roughness: 0.95, emissive: '#4a4a4a', emissiveMap: T.ceiling }),
    deck: std({ color: '#79808a', roughness: 0.55, metalness: 0.35, emissive: '#1d2024' }),
    roof: std({ map: T.roof, normalMap: T.roofN, normalScale: n(0.8), roughness: 0.93 }),
    paint: std({ vertexColors: true, roughness: 0.55 }),
    satin: std({ vertexColors: true, roughness: 0.35, metalness: 0.15 }),
    frame: std({ color: '#3b3632', roughness: 0.35, metalness: 0.7 }),
    metal: std({ color: '#a3aab1', roughness: 0.28, metalness: 0.9 }),
    glass: std({ color: '#b8cdd9', roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.2 }),
    light: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.1, 2.9) }),
    grass: std({ map: T.grass, normalMap: T.grassN, normalScale: n(0.7), roughness: 0.96 }),
    asphalt: std({ map: T.asphalt, normalMap: T.asphaltN, normalScale: n(0.6), roughness: 0.82 }),
  };
  M.glass.userData.noShadow = true;
  M.light.userData.noShadow = true;
  return M;
}
