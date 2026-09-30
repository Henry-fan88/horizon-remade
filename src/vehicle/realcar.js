// Authored Ferrari 458 visual, fitted to the existing car-space / suspension contract.
// Asset provenance is recorded alongside the GLB. Physics remains owned by carspecs.
//
// Draw cost: the 43 source parts are merged into 7 body meshes + one mesh per wheel. Plain
// (untextured, non-emissive) parts share one material that looks up colour, roughness and
// metalness from a per-vertex role. Two lighter LODs are built by vertex clustering for
// cars seen from a distance, and a low-poly proxy casts the shadow instead of the full car.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fitRing, steeringFrame, installInsideShading } from './cockpit.js';

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
      source = { root: gltf.scene, wheels, steering: gltf.scene.getObjectByName('steering_wheel') };
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

// ------------------------------------------------------------------ roles / materials
// Plain parts share one material; each vertex carries its role, which picks the colour,
// roughness and metalness. Rim and caliper colours come from the car's paint options.
const ROLES = ['rubber', 'rim', 'disc', 'chrome', 'metal', 'carbon', 'leather', 'redInterior', 'carpet', 'interior', 'interiorTrim', 'plastic', 'badge', 'blue', 'caliper'];
const ROLE_ID = Object.fromEntries(ROLES.map((r, i) => [r, i]));
const ROLE_PBR = {
  rubber: [0x121316, 0.93, 0],
  rim: [0xc9c9c9, 0.23, 0.95],
  disc: [0x666a70, 0.46, 0.85],
  chrome: [0xcbd0d4, 0.15, 1],
  metal: [0x5e646a, 0.33, 0.82],
  carbon: [0x14171a, 0.43, 0.15],
  leather: [0x222226, 0.88, 0],
  redInterior: [0x4d1116, 0.77, 0],
  carpet: [0x16171a, 1, 0],
  interior: [0x181a1d, 0.85, 0.05],
  interiorTrim: [0x303238, 0.63, 0.18],
  plastic: [0x1d2025, 0.7, 0.1],
  badge: [0xf4bd13, 0.35, 0.25],
  blue: [0x2874ab, 0.5, 0.2],
  caliper: [0xd01c1c, 0.32, 0.35],
};
// parts drawn with their own material (paint options, transparency or animated emission)
const OWN_MATERIAL = ['paint', 'glass', 'head', 'drl', 'tail'];
const INTERIOR = new Set(['leather', 'redInterior', 'carpet', 'interior', 'interiorTrim']);

function addGeometry(buckets, role, geometry) {
  if (!buckets.has(role)) buckets.set(role, []);
  buckets.get(role).push(geometry);
}

// keep only what the untextured materials read, tagged with a role id
function tagged(geometry, role) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.getAttribute('position'));
  g.setIndex(geometry.getIndex());
  if (geometry.getAttribute('normal')) g.setAttribute('normal', geometry.getAttribute('normal'));
  else g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  g.setAttribute('roleId', new THREE.BufferAttribute(new Float32Array(n).fill(ROLE_ID[role] ?? ROLE_ID.plastic), 1));
  return g;
}

function mergeAll(geometries) {
  if (!geometries.length) return null;
  const indexed = geometries.every((g) => g.index);
  const list = indexed ? geometries : geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  const g = list.length === 1 ? list[0] : mergeGeometries(list);
  if (!g) throw new Error('Ferrari geometry merge failed');
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Vertex-clustering simplification for distant LODs: vertices in the same grid cell (and
// facing the same way, and of the same role) collapse to one; degenerate triangles drop.
function clusterDecimate(geometry, cell) {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const role = geometry.getAttribute('roleId');
  const index = geometry.getIndex();
  const n = pos.count;
  const map = new Map();
  const remap = new Int32Array(n);
  const sx = [],
    sy = [],
    sz = [],
    nx = [],
    ny = [],
    nz = [],
    rr = [],
    cnt = [];
  const inv = 1 / cell;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const ax = nrm.getX(i),
      ay = nrm.getY(i),
      az = nrm.getZ(i);
    // dominant normal direction (6 buckets) keeps opposite faces of thin panels apart
    const aax = Math.abs(ax),
      aay = Math.abs(ay),
      aaz = Math.abs(az);
    const nb = aax > aay && aax > aaz ? (ax > 0 ? 0 : 1) : aay > aaz ? (ay > 0 ? 2 : 3) : az > 0 ? 4 : 5;
    const r = role ? role.getX(i) : 0;
    const key = ((((Math.floor(x * inv) + 512) * 1024 + (Math.floor(y * inv) + 512)) * 1024 + (Math.floor(z * inv) + 512)) * 8 + nb) * 32 + r;
    let c = map.get(key);
    if (c === undefined) {
      c = cnt.length;
      map.set(key, c);
      sx.push(0), sy.push(0), sz.push(0), nx.push(0), ny.push(0), nz.push(0), cnt.push(0), rr.push(r);
    }
    remap[i] = c;
    sx[c] += x;
    sy[c] += y;
    sz[c] += z;
    nx[c] += ax;
    ny[c] += ay;
    nz[c] += az;
    cnt[c]++;
  }
  const m = cnt.length;
  const P = new Float32Array(m * 3),
    N = new Float32Array(m * 3),
    R = new Float32Array(m);
  for (let c = 0; c < m; c++) {
    P[c * 3] = sx[c] / cnt[c];
    P[c * 3 + 1] = sy[c] / cnt[c];
    P[c * 3 + 2] = sz[c] / cnt[c];
    const l = Math.hypot(nx[c], ny[c], nz[c]) || 1;
    N[c * 3] = nx[c] / l;
    N[c * 3 + 1] = ny[c] / l;
    N[c * 3 + 2] = nz[c] / l;
    R[c] = rr[c];
  }
  const tris = [];
  const tn = index ? index.count : n;
  for (let t = 0; t < tn; t += 3) {
    const a = remap[index ? index.getX(t) : t],
      b = remap[index ? index.getX(t + 1) : t + 1],
      c = remap[index ? index.getX(t + 2) : t + 2];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (role) g.setAttribute('roleId', new THREE.BufferAttribute(R, 1));
  g.setIndex(m > 65535 ? new THREE.Uint32BufferAttribute(tris, 1) : new THREE.Uint16BufferAttribute(tris, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
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
  const scale = new THREE.Vector3((style.trackF / frontTrack + style.trackR / rearTrack) / 2, (radiusF + radiusR) / (2 * sourceRadius), style.WB / (rearZ - frontZ));
  const bodyMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z).multiply(turnForward).multiply(new THREE.Matrix4().makeTranslation(-centerX, 0, -centerZ));
  const wheelNodes = new Set(source.wheels);
  const buckets = new Map();
  // the steering wheel (not its column) is kept apart so the in-car view can turn it
  const steeringParts = [];
  let rim = null;
  source.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let parent = mesh.parent;
    while (parent) {
      if (wheelNodes.has(parent)) return;
      parent = parent.parent;
    }
    const geometry = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(bodyMatrix, mesh.matrixWorld));
    const role = materialRole(mesh);
    if (mesh.parent === source.steering && mesh.name !== 'steering_column') {
      steeringParts.push(tagged(geometry, role));
      if (mesh.name === 'steering_leather') rim = geometry;
      return;
    }
    if (mesh.name === 'lights_red') {
      for (const part of splitRearLamps(geometry, -style.WB / 2)) addGeometry(buckets, part.role, part.geometry);
    } else addGeometry(buckets, role, geometry);
  });
  // body: parts with their own material, plus every plain part merged into one
  const body = {};
  const plain = [],
    plainExterior = [];
  for (const [role, geometries] of buckets) {
    if (OWN_MATERIAL.includes(role)) body[role] = mergeAll(geometries.map((g) => tagged(g, 'plastic')));
    else
      for (const g of geometries) {
        const t = tagged(g, role);
        plain.push(t);
        if (!INTERIOR.has(role)) plainExterior.push(t);
      }
  }
  body.plain = mergeAll(plain);
  const bodyBounds = new THREE.Box3();
  for (const g of Object.values(body)) if (g) bodyBounds.union(g.boundingBox);
  const wheels = source.wheels.map((wheel, i) => {
    const front = i < 2;
    const r = front ? radiusF : radiusR;
    const width = front ? (style.wheelW ?? 0.26) : (style.wheelWr ?? style.wheelW ?? 0.26);
    const tire = wheel.children.find((child) => child.isMesh && child.material.name === 'Tires');
    if (!tire) throw new Error(`Ferrari ${wheelNames[i]} has no tire`);
    const box = new THREE.Box3().setFromObject(tire);
    const size = box.getSize(new THREE.Vector3());
    const sourceR = Math.max(size.y, size.z) / 2;
    const transform = new THREE.Matrix4().makeScale(width / size.x, r / sourceR, r / sourceR).multiply(turnForward).multiply(new THREE.Matrix4().makeTranslation(-centers[i].x, -centers[i].y, -centers[i].z));
    const parts = [];
    wheel.traverse((mesh) => {
      if (!mesh.isMesh) return;
      parts.push(tagged(mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, mesh.matrixWorld)), materialRole(mesh, true)));
    });
    return { geometry: mergeAll(parts), r, width, front, side: i % 2 === 0 ? 1 : -1 };
  });
  const lod = (cellBody, cellWheel) => {
    const out = { body: {}, wheels: wheels.map((w) => clusterDecimate(w.geometry, cellWheel)) };
    for (const role of OWN_MATERIAL) if (body[role]) out.body[role] = clusterDecimate(body[role], role === 'paint' || role === 'glass' ? cellBody : cellBody * 0.6);
    // the open cabin stays visible from a distance, so the interior is kept (coarser)
    out.body.plain = mergeAll([clusterDecimate(mergeAll(plainExterior.map((g) => g.clone())), cellBody), clusterDecimate(mergeAll(plain.filter((g) => !plainExterior.includes(g)).map((g) => g.clone())), cellBody * 1.6)]);
    return out;
  };
  const lods = [lod(0.035, 0.03), lod(0.09, 0.07)];
  // shadow caster: the coarse painted shell and exterior trim plus plain wheels. The glass
  // is left out so sunlight reaches the cabin through the windows (in-car camera).
  const shadowParts = [lods[1].body.paint, clusterDecimate(mergeAll(plainExterior.map((g) => g.clone())), 0.09)].filter(Boolean);
  for (const [x, z, rr] of [
    [style.trackF / 2, style.WB / 2, radiusF],
    [-style.trackF / 2, style.WB / 2, radiusF],
    [style.trackR / 2, -style.WB / 2, radiusR],
    [-style.trackR / 2, -style.WB / 2, radiusR],
  ]) {
    const c = new THREE.CylinderGeometry(rr, rr, 0.26, 10);
    c.rotateZ(Math.PI / 2);
    c.translate(x, rr, z);
    shadowParts.push(c);
  }
  const shadow = mergeGeometries(
    shadowParts.map((g) => {
      const b = new THREE.BufferGeometry();
      b.setAttribute('position', (g.index ? g.toNonIndexed() : g).getAttribute('position'));
      return b;
    })
  );
  shadow.computeBoundingSphere();
  const calipers = wheels.map((wheel) => tagged(new THREE.BoxGeometry(0.065, wheel.r * 0.65, wheel.r * 0.31), 'caliper'));
  const reverse = mergeAll(
    [-1, 1].map((side) => {
      const g = new THREE.BoxGeometry(0.095, 0.028, 0.016);
      g.translate(side * style.trackR * 0.32, (0.47 * style.wheelR) / 0.34, bodyBounds.min.z + 0.032);
      return tagged(g, 'plastic');
    })
  );
  let steering = null;
  if (steeringParts.length && rim) {
    const ring = fitRing(rim.getAttribute('position').array);
    const frame = steeringFrame(ring.center, ring.axis);
    const toLocal = frame.clone().invert();
    steering = { frame, geometry: mergeAll(steeringParts.map((g) => g.applyMatrix4(toLocal))) };
  }
  const out = { body, wheels, lods, shadow, calipers, reverse, bodyBounds, steering };
  fitted.set(key, out);
  return out;
}

function roleMaterial(paint, style) {
  const colors = ROLES.map((r) => new THREE.Color(r === 'rim' ? (paint.rim ?? style.rimColor ?? ROLE_PBR.rim[0]) : r === 'caliper' ? (paint.caliper ?? style.caliperColor ?? ROLE_PBR.caliper[0]) : ROLE_PBR[r][0]));
  const pbr = ROLES.map((r) => new THREE.Vector2(ROLE_PBR[r][1], ROLE_PBR[r][2]));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 });
  mat.name = 'Ferrari parts';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.roleColor = { value: colors };
    shader.uniforms.rolePBR = { value: pbr };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float roleId;\nflat varying int vRole;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRole = int( roleId + 0.5 );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 roleColor[ ${ROLES.length} ];\nuniform vec2 rolePBR[ ${ROLES.length} ];\nflat varying int vRole;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * roleColor[ vRole ], opacity );')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rolePBR[ vRole ].x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = rolePBR[ vRole ].y;');
  };
  mat.customProgramCacheKey = () => 'ferrari-roles-v1';
  return mat;
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
    plain: roleMaterial(paint, style),
    glass: physical({ color: 0xa8bec9, metalness: 0.05, roughness: 0.055, transparent: true, opacity: 0.24, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.25 }),
    head: physical({ color: 0xc4d1d8, emissive: 0xd4e8ff, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.13, clearcoat: 1 }),
    drl: standard({ color: 0xe4eeff, emissive: 0xe4eeff, emissiveIntensity: 2.2, roughness: 0.2 }),
    // The game boosts this to 6.9 under braking. Scale the emitted radiance so
    // red lenses keep their colour through ACES instead of clipping to amber.
    tail: physical({ color: 0x570510, emissive: new THREE.Color(0xff0610).multiplyScalar(0.2), emissiveIntensity: 0.5, metalness: 0.15, roughness: 0.18, clearcoat: 1 }),
    reverse: standard({ color: 0xb5bdc7, emissive: 0xe8f2ff, emissiveIntensity: 0, metalness: 0.15, roughness: 0.23 }),
    // writes neither colour nor depth: only its shadow shows
    shadow: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  };
}

// LOD switch distances (m from the camera): full detail, clustered, coarse
const LOD_DIST = [38, 150];

// paintMat belongs to the caller (the existing Vehicle/thumb disposal contract).
// Fitted geometries are immutable cache entries shared by every instance; only
// this instance's materials are released when it leaves the scene.
export function buildRealCar(style, paint = {}, paintMat) {
  if (!source) return null;
  const geometry = fitGeometry(style);
  const materials = makeMaterials(paint, style, paintMat);
  // in-car view: the painted shell shows dark trim on its inside, the glass turns clear
  installInsideShading(paintMat);
  paintMat.userData.cabinRole = 'shell';
  materials.glass.userData.cabinRole = 'glass';
  const group = new THREE.Group();
  group.name = 'Ferrari 458 Italia';
  group.userData.visualAsset = 'ferrari-458';
  const lights = { head: [], tail: [], brake: [], reverse: [], headMat: materials.head, tailMat: materials.tail, revMat: materials.reverse, drlMat: materials.drl };
  const levels = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
  levels.forEach((g, i) => {
    g.name = `458:lod${i}`;
    g.visible = i === 0;
    group.add(g);
  });
  const meshFor = (geo, role, level) => {
    const mesh = new THREE.Mesh(geo, materials[role]);
    mesh.name = `458:${role}:${level}`;
    mesh.castShadow = false; // the shadow proxy casts for the whole car
    mesh.receiveShadow = true;
    if (level === 0 && (role === 'head' || role === 'drl')) lights.head.push(mesh);
    if (level === 0 && role === 'tail') {
      lights.tail.push(mesh);
      lights.brake.push(mesh);
    }
    return mesh;
  };
  const bodySets = [geometry.body, geometry.lods[0].body, geometry.lods[1].body];
  bodySets.forEach((set, level) => {
    for (const role of [...OWN_MATERIAL, 'plain']) if (set[role]) levels[level].add(meshFor(set[role], role, level));
  });
  const merged = levels[0].children.slice();
  const shadow = new THREE.Mesh(geometry.shadow, materials.shadow);
  shadow.name = '458:shadow';
  shadow.castShadow = true;
  shadow.receiveShadow = false;
  group.add(shadow);
  const wheelMeshes = [[], [], []];
  const wheels = geometry.wheels.map((definition, i) => {
    const { r, width, front, side } = definition;
    const steer = new THREE.Group();
    steer.name = `${wheelNames[i]}:suspension`;
    const spin = new THREE.Group();
    spin.name = `${wheelNames[i]}:spin`;
    const geos = [definition.geometry, geometry.lods[0].wheels[i], geometry.lods[1].wheels[i]];
    geos.forEach((g, level) => {
      const m = meshFor(g, 'plain', level);
      m.visible = level === 0;
      spin.add(m);
      wheelMeshes[level].push(m);
    });
    const x = (side * (front ? style.trackF : style.trackR)) / 2;
    const z = ((front ? 1 : -1) * style.WB) / 2;
    steer.position.set(x, r, z);
    steer.add(spin);
    const caliper = new THREE.Mesh(geometry.calipers[i], materials.plain);
    caliper.name = `${wheelNames[i]}:caliper`;
    caliper.position.set(side * width * 0.24, 0, -r * 0.52);
    steer.add(caliper);
    group.add(steer);
    return { x, z, r, w: width, front, side, baseY: r, steer, spin, caliper };
  });
  // The steering wheel turns about its frame's +Z axis (see Vehicle.syncVisual).
  let steeringWheel = null;
  if (geometry.steering) {
    const mount = new THREE.Group();
    mount.name = '458:steering';
    mount.applyMatrix4(geometry.steering.frame);
    steeringWheel = new THREE.Group();
    const wheelMesh = new THREE.Mesh(geometry.steering.geometry, materials.plain);
    wheelMesh.receiveShadow = true;
    steeringWheel.add(wheelMesh);
    mount.add(steeringWheel);
    group.add(mount);
  }
  // Subtle white reversing lenses below the rear lamp clusters.
  const reverseLamps = new THREE.Mesh(geometry.reverse, materials.reverse);
  reverseLamps.name = '458:reverse';
  levels[0].add(reverseLamps);
  lights.reverse.push(reverseLamps);
  let disposed = false;
  let level = 0;
  return {
    group,
    body: merged.find((mesh) => mesh.material === paintMat),
    merged,
    paintMat,
    wheels,
    lights,
    zF: geometry.bodyBounds.max.z,
    zR: geometry.bodyBounds.min.z,
    steeringWheel,
    preparePaint: (material) => material,
    // pick the level of detail for a camera this far away (metres)
    setLodDistance(d) {
      const l = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
      if (l === level) return;
      level = l;
      levels.forEach((g, i) => (g.visible = i === l));
      wheelMeshes.forEach((list, i) => list.forEach((m) => (m.visible = i === l)));
      for (const w of wheels) w.caliper.visible = l < 2;
      if (steeringWheel) steeringWheel.visible = l < 2;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials)) if (material !== paintMat) material.dispose();
    },
  };
}
