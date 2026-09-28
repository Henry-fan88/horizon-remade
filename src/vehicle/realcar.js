// Authored Ferrari 458 visual, fitted to the existing car-space / suspension contract.
// Asset provenance is recorded alongside the GLB. Physics remains owned by carspecs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let source = null;
let loading = null;
const fitted = new Map();
const wheelNames = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
const turnForward = new THREE.Matrix4().makeRotationY(Math.PI);

// Decode once before the synchronous car builders and thumbnail cache are used.
// A failed asset keeps the procedural fallback usable, including offline boot.
export function preloadRealCar() {
  if (loading) return loading;
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`).setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loading = loader.loadAsync(`${base}models/ferrari-458/ferrari.glb`)
    .then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const wheels = wheelNames.map((name) => gltf.scene.getObjectByName(name));
      if (wheels.some((wheel) => !wheel)) throw new Error('Ferrari asset is missing its four named wheel assemblies');
      source = { root: gltf.scene, wheels };
      console.info('[horizon] Ferrari 458 visual ready');
      return true;
    })
    .catch((error) => {
      console.warn('[horizon] Ferrari visual unavailable; using procedural car.', error);
      return false;
    })
    .finally(() => draco.dispose());
  return loading;
}

function materialRole(mesh, isWheel = false) {
  const name = mesh.name.toLowerCase();
  const material = mesh.material.name;
  if (isWheel) {
    if (material === 'Tires') return 'rubber';
    if (name.startsWith('brake')) return 'disc';
    if (material === 'Ferrari_Yellow') return 'badge';
    if (material === 'Interior_dark') return 'chrome';
    return 'rim';
  }
  if (material === 'Body_Color') return 'paint';
  if (material === 'Glass_Gray') return 'glass';
  if (material === 'Projector_Glass') return 'head';
  if (material === 'Turn_Signal_LED') return 'drl';
  if (material === 'Taillight_Glass') return name === 'brakes' || name === 'lights_red' ? 'tail' : 'redInterior';
  if (material === 'Tires') return 'rubber';
  if (material === 'metal_chrome') return 'chrome';
  if (material === 'metal_gray') return 'metal';
  if (material === 'Carbon_Fiber') return 'carbon';
  if (material === 'Leather_red') return 'redInterior';
  if (material === 'Leather') return 'leather';
  if (material === 'Carpet') return 'carpet';
  if (material === 'Ferrari_Yellow') return 'badge';
  if (material === '_0098_DodgerBlue') return 'blue';
  // The FBX's Interior_light / Interior_dark labels are inverted. Both need to
  // remain subdued so seat piping and dashboard trim do not look emissive.
  if (material === 'Interior_light') return 'interiorTrim';
  if (material === 'Interior_dark') return 'interior';
  return 'plastic';
}

function addGeometry(buckets, role, geometry) {
  if (!buckets.has(role)) buckets.set(role, []);
  buckets.get(role).push(geometry);
}

function mergeBuckets(buckets) {
  const parts = [];
  for (const [role, geometries] of buckets) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    if (!geometry) throw new Error(`Ferrari geometry merge failed: ${role}`);
    if (geometries.length > 1) for (const part of geometries) part.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    parts.push({ role, geometry });
  }
  return parts;
}

// Taillight_Glass is reused by the source for cabin details. Split the red glass
// at the rear axle so brake illumination never lights up the dashboard.
function splitRearLamps(geometry, rearAxle) {
  const rear = [], interior = [];
  const p = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const n = index ? index.count : p.count;
  for (let i = 0; i < n; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    ((p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3 < rearAxle ? rear : interior).push(a, b, c);
  }
  const result = [];
  for (const [role, indices] of [['tail', rear], ['redInterior', interior]]) {
    if (!indices.length) continue;
    const part = geometry.clone();
    part.setIndex(indices);
    result.push({ role, geometry: part });
  }
  geometry.dispose();
  return result;
}

function fitGeometry(style) {
  const key = [style.WB, style.trackF, style.trackR, style.wheelR, style.wheelRr, style.wheelW, style.wheelWr].join('|');
  if (fitted.has(key)) return fitted.get(key);
  const centers = source.wheels.map((wheel) => wheel.getWorldPosition(new THREE.Vector3()));
  const frontZ = (centers[0].z + centers[1].z) / 2;
  const rearZ = (centers[2].z + centers[3].z) / 2;
  const centerX = centers.reduce((sum, p) => sum + p.x, 0) / 4;
  const centerZ = (frontZ + rearZ) / 2;
  const frontTrack = Math.abs(centers[0].x - centers[1].x);
  const rearTrack = Math.abs(centers[2].x - centers[3].x);
  const radiusF = style.wheelR;
  const radiusR = style.wheelRr ?? radiusF;
  const sourceRadius = centers.reduce((sum, p) => sum + p.y, 0) / 4;
  const scale = new THREE.Vector3(
    (style.trackF / frontTrack + style.trackR / rearTrack) / 2,
    (radiusF + radiusR) / (2 * sourceRadius),
    style.WB / (rearZ - frontZ),
  );
  const bodyMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z)
    .multiply(turnForward)
    .multiply(new THREE.Matrix4().makeTranslation(-centerX, 0, -centerZ));
  const wheelNodes = new Set(source.wheels);
  const buckets = new Map();
  source.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let parent = mesh.parent;
    while (parent) {
      if (wheelNodes.has(parent)) return;
      parent = parent.parent;
    }
    const geometry = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(bodyMatrix, mesh.matrixWorld));
    const role = materialRole(mesh);
    if (mesh.name === 'lights_red') {
      for (const part of splitRearLamps(geometry, -style.WB / 2)) addGeometry(buckets, part.role, part.geometry);
    } else addGeometry(buckets, role, geometry);
  });
  const body = mergeBuckets(buckets);
  const bodyBounds = new THREE.Box3();
  for (const part of body) bodyBounds.union(part.geometry.boundingBox);
  const wheels = source.wheels.map((wheel, i) => {
    const front = i < 2;
    const r = front ? radiusF : radiusR;
    const width = front ? (style.wheelW ?? 0.26) : (style.wheelWr ?? style.wheelW ?? 0.26);
    const tire = wheel.children.find((child) => child.isMesh && child.material.name === 'Tires');
    if (!tire) throw new Error(`Ferrari ${wheelNames[i]} has no tire`);
    const box = new THREE.Box3().setFromObject(tire);
    const size = box.getSize(new THREE.Vector3());
    const sourceR = Math.max(size.y, size.z) / 2;
    const transform = new THREE.Matrix4().makeScale(width / size.x, r / sourceR, r / sourceR)
      .multiply(turnForward)
      .multiply(new THREE.Matrix4().makeTranslation(-centers[i].x, -centers[i].y, -centers[i].z));
    const wheelBuckets = new Map();
    wheel.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, mesh.matrixWorld));
      addGeometry(wheelBuckets, materialRole(mesh, true), geometry);
    });
    return { parts: mergeBuckets(wheelBuckets), r, width, front, side: i % 2 === 0 ? 1 : -1 };
  });
  // A single shared detail geometry per size; the caliper stays with the steering
  // knuckle while the authored rotor, spokes and tire spin about local X.
  const calipers = wheels.map((wheel) => new THREE.BoxGeometry(0.065, wheel.r * 0.65, wheel.r * 0.31));
  const reverseGeometry = new THREE.BoxGeometry(0.095, 0.028, 0.016);
  const out = { body, wheels, calipers, reverseGeometry, bodyBounds };
  fitted.set(key, out);
  return out;
}

function makeMaterials(paint, style, paintMat) {
  if (!paint.finish || paint.finish === 'gloss') {
    paintMat.metalness = 0.28;
    paintMat.roughness = 0.25;
    paintMat.clearcoat = 1;
    paintMat.clearcoatRoughness = 0.045;
  }
  const standard = (parameters) => new THREE.MeshStandardMaterial(parameters);
  const physical = (parameters) => new THREE.MeshPhysicalMaterial(parameters);
  return {
    paint: paintMat,
    glass: physical({ color: 0xa8bec9, metalness: 0.05, roughness: 0.055, transparent: true, opacity: 0.24, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.25 }),
    rubber: standard({ color: 0x121316, metalness: 0, roughness: 0.93 }),
    rim: standard({ color: paint.rim ?? style.rimColor ?? '#c9c9c9', metalness: 0.95, roughness: 0.23 }),
    disc: standard({ color: 0x666a70, metalness: 0.85, roughness: 0.46 }),
    caliper: physical({ color: paint.caliper ?? style.caliperColor ?? '#d01c1c', metalness: 0.35, roughness: 0.32, clearcoat: 0.5 }),
    chrome: standard({ color: 0xcbd0d4, metalness: 1, roughness: 0.15 }),
    metal: standard({ color: 0x5e646a, metalness: 0.82, roughness: 0.33 }),
    carbon: physical({ color: 0x14171a, metalness: 0.15, roughness: 0.43, clearcoat: 0.4 }),
    leather: standard({ color: 0x222226, metalness: 0, roughness: 0.88 }),
    redInterior: standard({ color: 0x4d1116, metalness: 0, roughness: 0.77 }),
    carpet: standard({ color: 0x16171a, metalness: 0, roughness: 1 }),
    interior: standard({ color: 0x181a1d, metalness: 0.05, roughness: 0.85 }),
    interiorTrim: standard({ color: 0x303238, metalness: 0.18, roughness: 0.63 }),
    plastic: standard({ color: 0x1d2025, metalness: 0.1, roughness: 0.7 }),
    badge: physical({ color: 0xf4bd13, metalness: 0.25, roughness: 0.35, clearcoat: 0.75 }),
    blue: standard({ color: 0x2874ab, metalness: 0.2, roughness: 0.5 }),
    head: physical({ color: 0xc4d1d8, emissive: 0xd4e8ff, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.13, clearcoat: 1 }),
    drl: standard({ color: 0xe4eeff, emissive: 0xe4eeff, emissiveIntensity: 2.2, roughness: 0.2 }),
    // The game boosts this to 6.9 under braking. Scale the emitted radiance so
    // red lenses keep their colour through ACES instead of clipping to amber.
    tail: physical({ color: 0x570510, emissive: new THREE.Color(0xff0610).multiplyScalar(0.2), emissiveIntensity: 0.5, metalness: 0.15, roughness: 0.18, clearcoat: 1 }),
    reverse: standard({ color: 0xb5bdc7, emissive: 0xe8f2ff, emissiveIntensity: 0, metalness: 0.15, roughness: 0.23 }),
  };
}

// paintMat belongs to the caller (the existing Vehicle/thumb disposal contract).
// Fitted geometries are immutable cache entries shared by every instance; only
// this instance's materials are released when it leaves the scene.
export function buildRealCar(style, paint = {}, paintMat) {
  if (!source) return null;
  const geometry = fitGeometry(style);
  const materials = makeMaterials(paint, style, paintMat);
  const group = new THREE.Group();
  group.name = 'Ferrari 458 Italia';
  group.userData.visualAsset = 'ferrari-458';
  const lights = { head: [], tail: [], brake: [], reverse: [], headMat: materials.head, tailMat: materials.tail, revMat: materials.reverse, drlMat: materials.drl };
  const meshFor = (part) => {
    const mesh = new THREE.Mesh(part.geometry, materials[part.role]);
    mesh.name = `458:${part.role}`;
    mesh.castShadow = part.role !== 'glass';
    mesh.receiveShadow = true;
    if (part.role === 'head' || part.role === 'drl') lights.head.push(mesh);
    if (part.role === 'tail') { lights.tail.push(mesh); lights.brake.push(mesh); }
    return mesh;
  };
  const merged = geometry.body.map(meshFor);
  group.add(...merged);
  const wheels = geometry.wheels.map((definition, i) => {
    const { r, width, front, side } = definition;
    const steer = new THREE.Group();
    steer.name = `${wheelNames[i]}:suspension`;
    const spin = new THREE.Group();
    spin.name = `${wheelNames[i]}:spin`;
    spin.add(...definition.parts.map(meshFor));
    const x = side * (front ? style.trackF : style.trackR) / 2;
    const z = (front ? 1 : -1) * style.WB / 2;
    steer.position.set(x, r, z);
    steer.add(spin);
    const caliper = new THREE.Mesh(geometry.calipers[i], materials.caliper);
    caliper.name = `${wheelNames[i]}:caliper`;
    caliper.position.set(side * width * 0.24, 0, -r * 0.52);
    caliper.castShadow = true;
    steer.add(caliper);
    group.add(steer);
    return { x, z, r, w: width, front, side, baseY: r, steer, spin };
  });
  // Subtle white reversing lenses below the rear lamp clusters. Their material
  // is distinct from both chrome and the normal rear / brake lamps.
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(geometry.reverseGeometry, materials.reverse);
    lamp.position.set(side * style.trackR * 0.32, 0.47 * style.wheelR / 0.34, geometry.bodyBounds.min.z + 0.032);
    lamp.name = '458:reverse';
    group.add(lamp);
    lights.reverse.push(lamp);
  }
  let disposed = false;
  return {
    group,
    body: merged.find((mesh) => mesh.material === paintMat),
    merged,
    paintMat,
    wheels,
    lights,
    zF: geometry.bodyBounds.max.z,
    zR: geometry.bodyBounds.min.z,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials)) if (material !== paintMat) material.dispose();
    },
  };
}
