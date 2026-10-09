// Car visuals. Every car is a licensed real-car model: realcar.js adapts the Ferrari 458,
// importedcars.js the prepared Sketchfab cars. This module owns the paint materials, the
// shared builder entry point, and a plain stand-in used only if a model fails to load.
// Car space: +Z forward, +X left, +Y up, ground at y = 0, z = 0 midway between the axles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRealCar } from './realcar.js';
import { buildImportedCar } from './importedcars.js';
import { excludeFromWeather } from '../world/weather-surface.js';

export function makePaintMaterial(color, finish = 'gloss') {
  const c = new THREE.Color(color);
  if (finish === 'matte') return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.15, roughness: 0.55, clearcoat: 0.0 });
  if (finish === 'chrome') return new THREE.MeshPhysicalMaterial({ color: c, metalness: 1.0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 });
  if (finish === 'pearl') return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.6, iridescenceIOR: 1.4, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
  return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.55, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.035, envMapIntensity: 1.15 });
}

// paintMat belongs to the caller (Vehicle, thumbnails, traffic) and is disposed by them.
export function buildCar(style, paint = {}) {
  const paintMat = makePaintMaterial(paint.color ?? '#c81d25', paint.finish ?? 'gloss');
  const detailed = style.visualAsset === 'ferrari-458' ? buildRealCar(style, paint, paintMat) : buildImportedCar(style, paint, paintMat);
  const car = detailed || buildStandIn(style, paintMat);
  // puddles and snow are laid out in world space: they would slide over a moving body
  excludeFromWeather(car.group);
  return car;
}

// A plain painted block on four wheels with the same interface as the detailed cars. It
// only appears if a model file cannot be loaded or decoded, so the game stays drivable.
function buildStandIn(style, paintMat) {
  const group = new THREE.Group();
  group.name = 'car stand-in';
  const dark = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.6, metalness: 0.2 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdde8ff, emissiveIntensity: 1.4 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff1010, emissiveIntensity: 1.2 });
  const revMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0 });
  const zF = style.WB / 2 + style.fo,
    zR = -style.WB / 2 - style.ro;
  const lowH = (style.H - style.sill) * 0.55;
  const body = new THREE.Mesh(new THREE.BoxGeometry(style.W * 0.96, lowH, zF - zR), paintMat);
  body.position.set(0, style.sill + lowH / 2, (zF + zR) / 2);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(style.W * 0.78, style.H - style.sill - lowH, (zF - zR) * 0.42), dark);
  cabin.position.set(0, style.sill + lowH + (style.H - style.sill - lowH) / 2, -0.2);
  group.add(body, cabin);
  const lights = { head: [], tail: [], brake: [], reverse: [], headMat, tailMat, revMat };
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), headMat);
    head.position.set(side * style.W * 0.32, style.headlight?.y ?? 0.65, zF + 0.01);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), tailMat);
    tail.position.set(side * style.W * 0.32, style.sill + lowH * 0.8, zR - 0.01);
    group.add(head, tail);
    lights.head.push(head);
    lights.tail.push(tail);
    lights.brake.push(tail);
  }
  const wheels = [0, 1, 2, 3].map((i) => {
    const front = i < 2,
      side = i % 2 === 0 ? 1 : -1;
    const r = front ? style.wheelR : style.wheelRr ?? style.wheelR;
    const w = front ? style.wheelW : style.wheelWr ?? style.wheelW;
    const x = (side * (front ? style.trackF : style.trackR)) / 2,
      z = ((front ? 1 : -1) * style.WB) / 2;
    const steer = new THREE.Group(),
      spin = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20).rotateZ(Math.PI / 2), dark);
    spin.add(tyre);
    steer.add(spin);
    steer.position.set(x, r, z);
    group.add(steer);
    return { x, z, r, w, front, side, baseY: r, steer, spin };
  });
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return {
    group, body, merged: [body], paintMat, wheels, lights, zF, zR,
    dispose() {
      group.traverse((o) => o.isMesh && o.geometry.dispose());
      for (const m of [dark, headMat, tailMat, revMat]) m.dispose();
    },
  };
}

// Bake the currently visible meshes of a built car into one geometry per material, in car
// space with the wheels at rest (used for instanced traffic). Every vertex attribute the
// materials read (colours, per-vertex surface parameters, UVs) is kept.
export function bakeVisibleByMaterial(car) {
  const group = car.group;
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const visible = (o) => {
    for (let n = o; n && n !== group; n = n.parent) if (!n.visible) return false;
    return true;
  };
  group.traverse((o) => {
    if (!o.isMesh || !visible(o) || o.userData.cockpitOnly) return;
    const mat = o.material;
    if (Array.isArray(mat) || mat.colorWrite === false) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  });
  const out = [];
  for (const [material, list] of buckets) {
    // keep only the attributes all parts share, so the merge never fails on one odd part
    const names = Object.keys(list[0].attributes).filter((k) => list.every((g) => g.attributes[k]));
    for (const g of list) for (const k of Object.keys(g.attributes)) if (!names.includes(k)) g.deleteAttribute(k);
    const geometry = list.length === 1 ? list[0] : mergeGeometries(list);
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    out.push({ geometry, material });
  }
  return out;
}
