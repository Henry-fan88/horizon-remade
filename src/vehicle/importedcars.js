// Prepared Sketchfab cars. Geometry/textures are cached; paint and lamps belong
// to each vehicle. The same synchronous builder serves driving and thumbnails.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { IMPORTED_CARS } from './modelcatalog.js';

const sources = new Map();
let loading;
const wheelNames = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
const controlled = new Set(['paint', 'paint-atlas', 'glass', 'glass-atlas', 'lens', 'head', 'tail']);
const own = (object, key) => {
  for (let node = object; node; node = node.parent) if (node.userData[key] !== undefined) return node.userData[key];
};

function tuneMaterial(material, role) {
  const mat = material.clone();
  const name = mat.name.toLowerCase();
  mat.side = THREE.FrontSide;
  if (/tire|rubber/.test(name)) { mat.metalness = 0; mat.roughness = .92; if (!mat.map) mat.color.set(0x141518); }
  else if (/leather|seat|carpet|interior|black_matt|blackout/.test(name)) { mat.metalness = 0; mat.roughness = .82; if (!mat.map && mat.color.getHex() === 0) mat.color.set(0x17191c); }
  else if (/chrome|silver|mirror|plate|lambert|roll/.test(name) || role === 'metal') { mat.metalness = .85; mat.roughness = .26; if (!mat.map && mat.color.getHex() === 0) mat.color.set(0x72777e); }
  else if (/gloss|shiny|black/.test(name)) { mat.metalness = .3; mat.roughness = .3; if (!mat.map && mat.color.getHex() === 0) mat.color.set(0x101215); }
  if (role === 'caliper') { mat.color.set(0xc72020); mat.metalness = .45; mat.roughness = .32; }
  if (!controlled.has(role)) { mat.emissive?.set(0); mat.transparent = false; mat.opacity = 1; }
  return mat;
}

function merge(list) {
  const g = list.length === 1 ? list[0] : mergeGeometries(list);
  if (!g) throw new Error('Car geometry attributes do not match');
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function prepare(scene, id) {
  scene.updateMatrixWorld(true);
  const mounts = ['body', ...wheelNames].map(name => scene.getObjectByName(name));
  if (mounts.some(o => !o)) throw new Error(`${id}: missing body or four wheel assemblies`);
  const templates = new Map();
  const groups = mounts.map((mount, mountIndex) => {
    const inverse = mount.matrixWorld.clone().invert();
    const buckets = new Map();
    mount.traverse(mesh => {
      if (!mesh.isMesh) return;
      const role = own(mesh, 'role') || 'plain';
      const level = Number(own(mesh, 'lod')) || 0;
      const stationary = !!own(mesh, 'stationary');
      const original = mesh.material;
      const tuned = tuneMaterial(original, role);
      const textured = Boolean(tuned.map || tuned.normalMap || tuned.roughnessMap || tuned.metalnessMap || tuned.alphaMap);
      const materialKey = controlled.has(role) ? role : textured ? `texture:${original.uuid}:${role}` : 'plain';
      const key = `${level}|${stationary}|${materialKey}`;
      const input = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      const geometry = new THREE.BufferGeometry();
      // Non-indexed input keeps all glTF primitive layouts compatible when merging.
      const flat = input.index ? input.toNonIndexed() : input;
      for (const name of ['position', 'normal']) if (flat.attributes[name]) geometry.setAttribute(name, flat.attributes[name]);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      if (materialKey !== 'plain' && flat.attributes.uv) geometry.setAttribute('uv', flat.attributes.uv);
      if (materialKey === 'plain') {
        const n = geometry.attributes.position.count;
        const colors = new Float32Array(n * 3), surface = new Float32Array(n * 3);
        const name = original.name.toLowerCase();
        const tint = role === 'caliper' ? 2 : mountIndex && !/tire|brake/.test(name) && /silver|chrome|lambert|glossblack|body/.test(name) ? 1 : 0;
        for (let i = 0; i < n; i++) {
          tuned.color.toArray(colors, i * 3);
          surface.set([tuned.roughness, tuned.metalness, tint], i * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('surface', new THREE.BufferAttribute(surface, 3));
      } else if (!templates.has(materialKey)) templates.set(materialKey, tuned);
      if (templates.get(materialKey) !== tuned) tuned.dispose();
      if (!buckets.has(key)) buckets.set(key, { level, stationary, materialKey, geometry: [] });
      buckets.get(key).geometry.push(geometry);
    });
    return [...buckets.values()].map(part => ({ ...part, geometry: merge(part.geometry) }));
  });
  return { groups, templates };
}

export function preloadImportedCars() {
  if (loading) return loading;
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`).setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loading = Promise.all(Object.keys(IMPORTED_CARS).map(async id => {
    try {
      const gltf = await loader.loadAsync(`${base}models/${id}/car.glb`);
      sources.set(id, prepare(gltf.scene, id));
      console.info(`[horizon] ${IMPORTED_CARS[id].name} visual ready`);
      return true;
    } catch (error) {
      console.warn(`[horizon] ${id} visual unavailable; using procedural fallback.`, error);
      return false;
    }
  })).finally(() => draco.dispose());
  return loading;
}

function plainMaterial(paint, style) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
  mat.onBeforeCompile = shader => {
    shader.uniforms.rimTint = { value: new THREE.Color(paint.rim ?? style.rimColor ?? '#55585d') };
    shader.uniforms.caliperTint = { value: new THREE.Color(paint.caliper ?? style.caliperColor ?? '#c72020') };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 surface;\nvarying vec3 vSurface;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = surface;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSurface;\nuniform vec3 rimTint;\nuniform vec3 caliperTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vSurface.z > 1.5) diffuseColor.rgb = caliperTint; else if (vSurface.z > .5) diffuseColor.rgb = rimTint;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurface.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurface.y;');
  };
  mat.customProgramCacheKey = () => 'imported-car-pbr-v1';
  return mat;
}

function atlasPaint(paintMat, template) {
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) paintMat[key] = template[key];
  // The classic's atlas includes chrome, badges and lamps. Recolour only its dark
  // painted areas; preserve coloured badges, bright chrome and the original UVs.
  paintMat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
        float originalValue = max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b));
        float paintMask = 1.0 - smoothstep(0.008, 0.025, originalValue);
        diffuseColor.rgb = mix(sampledDiffuseColor.rgb, diffuse * (0.82 + originalValue * 5.0), paintMask);
      #endif`);
  };
  paintMat.customProgramCacheKey = () => 'classic-atlas-paint-v1';
}

export function buildImportedCar(style, paint, paintMat) {
  const asset = sources.get(style.visualAsset);
  if (!asset) return null;
  const group = new THREE.Group();
  group.name = IMPORTED_CARS[style.visualAsset].name;
  group.userData.visualAsset = style.visualAsset;
  const headMat = new THREE.MeshPhysicalMaterial({ color: 0xd0d8df, emissive: 0xdbeaff, emissiveIntensity: 1.4, roughness: .18, metalness: .2 });
  const tailMat = new THREE.MeshPhysicalMaterial({ color: 0x610512, emissive: new THREE.Color(0xff0610).multiplyScalar(.2), emissiveIntensity: .5, roughness: .24, clearcoat: 1 });
  const revMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, emissive: 0xe8f2ff, emissiveIntensity: 0, roughness: .25 });
  const materials = new Map([
    ['paint', paintMat], ['paint-atlas', paintMat], ['head', headMat], ['tail', tailMat], ['reverse', revMat],
    ['plain', plainMaterial(paint, style)],
    ['glass', new THREE.MeshPhysicalMaterial({ color: 0x647c88, metalness: .05, roughness: .075, transparent: true, opacity: .38, depthWrite: false, clearcoat: 1 })],
    ['lens', new THREE.MeshPhysicalMaterial({ color: 0xd4e0e5, roughness: .07, transparent: true, opacity: .16, depthWrite: false, clearcoat: 1 })],
  ]);
  if (asset.templates.has('paint-atlas')) atlasPaint(paintMat, asset.templates.get('paint-atlas'));
  for (const [key, template] of asset.templates) if (!materials.has(key)) {
    const material = template.clone();
    if (key === 'glass-atlas') { material.roughness = .14; material.metalness = .35; }
    materials.set(key, material);
  }
  const lights = { head: [], tail: [], brake: [], reverse: [], headMat, tailMat, revMat };
  const levels = [[], [], []];
  const meshFor = (part, parent) => {
    const mesh = new THREE.Mesh(part.geometry, materials.get(part.materialKey));
    mesh.name = `${part.materialKey}:lod${part.level}`;
    mesh.visible = part.level === 0; mesh.receiveShadow = true;
    levels[part.level].push(mesh); parent.add(mesh);
    if (part.materialKey === 'head') lights.head.push(mesh);
    if (part.materialKey === 'tail') { lights.tail.push(mesh); lights.brake.push(mesh); }
    return mesh;
  };
  const bodyMeshes = asset.groups[0].map(part => meshFor(part, group));
  const wheels = asset.groups.slice(1).map((parts, i) => {
    const front = i < 2, side = i%2 === 0 ? 1 : -1;
    const r = front ? style.wheelR : style.wheelRr ?? style.wheelR;
    const x = side * (front ? style.trackF : style.trackR)/2;
    const z = (front ? 1 : -1)*style.WB/2;
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.position.set(x, r, z); steer.name = wheelNames[i];
    steer.add(spin); group.add(steer);
    parts.forEach(part => meshFor(part, part.stationary ? steer : spin));
    return { x, z, r, w: front ? style.wheelW : style.wheelWr, front, side, baseY: r, steer, spin };
  });
  // Tiny lens overlays give the texture-atlas classic functional lamps as well.
  if (!asset.extras) {
    const extras = [];
    const add = (geometry, key, x, y, z) => { geometry.translate(x,y,z); extras.push({ geometry, key }); };
    const zR = -style.WB/2-style.ro;
    group.updateMatrixWorld(true);
    for (const side of [-1,1]) {
      if (style.visualAsset === 'mustang-fastback') {
        // Measured from the authored lens surfaces, including the slanted rear panel.
        add(new THREE.CircleGeometry(.073, 24), 'head', side*.725, .6983, 2.020);
        add(new THREE.CircleGeometry(.029, 20).rotateY(Math.PI), 'reverse', side*.613, .412, -2.331);
        for (let i=-1;i<=1;i++) add(new THREE.PlaneGeometry(.044,.118).rotateY(Math.PI).rotateX(.3), 'tail', side*.5715+i*.081, .649, -2.342);
      } else {
        // Seat the small reverse lens on the real rear bumper rather than at its
        // bounding-box corner, which leaves it floating on a curved body.
        const surfaces = bodyMeshes.filter(mesh => mesh.visible && !mesh.material.transparent);
        let hit;
        for (const height of [.42, .55, .65]) {
          const origin = new THREE.Vector3(side*style.W*.31, height, zR-.2);
          hit = new THREE.Raycaster(origin, new THREE.Vector3(0,0,1), 0, .9).intersectObjects(surfaces, false)[0];
          if (hit) break;
        }
        if (hit) {
          const lens = new THREE.PlaneGeometry(.095,.028);
          lens.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), hit.face.normal));
          const p = hit.point.clone().addScaledVector(hit.face.normal,.002);
          add(lens, 'reverse', p.x,p.y,p.z);
        }
      }
    }
    // Use the actual exterior silhouette with cheap tyres for contact shadows.
    const shadowParts = asset.groups[0].filter(part => part.level === 2 && /^(paint|glass)/.test(part.materialKey)).map(part => part.geometry);
    for (const wheel of wheels) shadowParts.push(new THREE.CylinderGeometry(wheel.r,wheel.r,wheel.w,12).rotateZ(Math.PI/2).translate(wheel.x,wheel.r,wheel.z));
    const shadow = merge(shadowParts.map(shape => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', (shape.index ? shape.toNonIndexed() : shape).attributes.position);
      return geometry;
    }));
    asset.extras = { extras, shadow };
  }
  for (const { geometry, key } of asset.extras.extras) {
    const mesh = new THREE.Mesh(geometry, materials.get(key)); group.add(mesh);
    (key === 'head' ? lights.head : key === 'tail' ? lights.tail : lights.reverse).push(mesh);
    levels[0].push(mesh);
  }
  const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: THREE.DoubleSide });
  materials.set('shadow', shadowMat);
  const shadow = new THREE.Mesh(asset.extras.shadow, shadowMat); shadow.castShadow = true; group.add(shadow);
  let disposed = false, currentLevel = 0;
  return {
    group, body: bodyMeshes.find(mesh => mesh.material === paintMat), merged: bodyMeshes, paintMat, wheels, lights,
    zF: style.WB/2+style.fo, zR: -style.WB/2-style.ro,
    setLodDistance(distance) {
      const level = distance < 38 ? 0 : distance < 145 ? 1 : 2;
      if (level === currentLevel) return;
      currentLevel = level;
      levels.forEach((meshes, i) => meshes.forEach(mesh => { mesh.visible = i === level; }));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of new Set(materials.values())) if (material !== paintMat) material.dispose();
    },
  };
}
