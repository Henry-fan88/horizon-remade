// Dedicated civilian visuals. Nothing in this pack is offered in the player garage.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const sources = new Map();
let loading;

// Repaint only colored body panels in the author's atlas. Black trim, plates, grille,
// wheel textures and lamp colors retain their original appearance.
function paintMaterial(source) {
  const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: source.map,
    roughness: .36, metalness: .38, clearcoat: .8, clearcoatRoughness: .12 });
  material.onBeforeCompile = shader => {
    const peak = source.userData.paintPeak ?? 1;
    shader.uniforms.trafficPaintPeak = { value: Math.max(.02, new THREE.Color().setRGB(peak, peak, peak, THREE.SRGBColorSpace).r) };
    shader.uniforms.trafficDarkPaint = { value: source.userData.darkPaint ? 1 : 0 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float trafficPaintPeak;\nuniform float trafficDarkPaint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          float hi = max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b));
          float lo = min(sampledDiffuseColor.r, min(sampledDiffuseColor.g, sampledDiffuseColor.b));
          float mask = smoothstep(.12, .3, (hi - lo) / max(hi, .0001));
          if (trafficDarkPaint > .5) mask = 1.0 - smoothstep(trafficPaintPeak * 2.0, trafficPaintPeak * 5.0, hi);
          vec3 tint = diffuse;
          #ifdef USE_COLOR
            tint *= vColor.rgb;
          #endif
          diffuseColor.rgb = mix(sampledDiffuseColor.rgb, tint * clamp(hi / trafficPaintPeak, .02, 1.15), mask);
        #endif`)
      .replace('#include <color_fragment>', '');
  };
  material.customProgramCacheKey = () => 'civilian-paint-v1';
  return material;
}

function prepare(root) {
  root.updateMatrixWorld(true);
  const buckets = [new Map(), new Map(), new Map()];
  const inverse = root.matrixWorld.clone().invert();
  const materials = new Map();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const level = mesh.userData.lod;
    const role = mesh.userData.role;
    const source = mesh.material;
    if (!materials.has(source)) {
      const material = role === 'paint' ? paintMaterial(source) : source.clone();
      if (role === 'glass') {
        // Tinted exterior glass is opaque: no sorting artifacts between traffic instances.
        material.color.set(0x243642); material.transparent = false; material.opacity = 1;
        material.roughness = .18; material.metalness = .42; material.side = THREE.FrontSide;
      } else if (role === 'wheels') { material.metalness = .15; material.roughness = .72; }
      else if (role === 'lamps') {
        material.roughness = .22; material.metalness = .1;
        material.emissive.set(0xffffff); material.emissiveMap = source.map; material.emissiveIntensity = .35;
      }
      material.name = `traffic:${root.name}:${role}`;
      materials.set(source, material);
    }
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    if (!buckets[level].has(source)) buckets[level].set(source, { material: materials.get(source), isPaint: role === 'paint', geometries: [] });
    buckets[level].get(source).geometries.push(geometry);
  });
  return buckets.map(bucket => [...bucket.values()].map(({ material, isPaint, geometries }) => {
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error(`Invalid civilian geometry: ${root.name}`);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    for (const g of geometries) g.dispose();
    return { geometry, material, isPaint };
  }));
}

export function preloadTrafficCars() {
  if (loading) return loading;
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`).setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loading = loader.loadAsync(`${import.meta.env.BASE_URL}models/civilian-traffic/traffic.glb`).then(gltf => {
    for (const root of gltf.scene.children) sources.set(root.name, prepare(root));
    gltf.scene.traverse(mesh => { if (mesh.isMesh) mesh.geometry.dispose(); });
    console.info(`[horizon] ${sources.size} civilian traffic models ready`);
    return true;
  }).catch(error => {
    console.warn('[horizon] Civilian traffic pack unavailable; using civilian distance proxies.', error);
    return false;
  }).finally(() => draco.dispose());
  return loading;
}

// Geometry/materials are shared across traffic instances and retained for the game's lifetime.
export const getTrafficModel = id => sources.get(id);
