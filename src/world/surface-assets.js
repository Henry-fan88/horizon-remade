// Shared local CC0 photo-scanned surface maps. Original sources and checksums:
// public/environment/surfaces/{ATTRIBUTION.md,manifest.json}.
import * as THREE from 'three';
import { openWorker } from '../core/workers.js';

const definitions = {
  grass: { id: 'aerial_grass_rock', tileSize: 15 },
  dirt: { id: 'dirt', tileSize: 2 },
  rock: { id: 'rock_face', tileSize: 2.4 },
  asphalt: { id: 'asphalt_02', tileSize: 3 },
  gravel: { id: 'gravel_road', tileSize: 2 },
  snow: { id: 'snow_02', tileSize: 3 },
  // aerial asphalt: patches, repairs and staining at a 30 m scale over the road aggregate
  asphaltMacro: { id: 'aerial_asphalt_01', tileSize: 30, maps: ['diff'] },
};
let assets = null;
let loading = null;

// Terrain layers, packed into two texture arrays (see surface-pack.worker.js). The order is
// the layer index used by the terrain shader (terrain.js).
//   tile   real-world width of one texture repeat (m)
//   tint   how strongly the biome palette grades the scan (0 = the photo's own colour)
export const TERRAIN_LAYERS = [
  { key: 'grass', id: 'aerial_grass_rock', tile: 13, tint: 0.75 },
  { key: 'soil', id: 'dirt', tile: 2.6, tint: 0.55 },
  { key: 'rock', id: 'rock_face', tile: 4, tint: 0.55 },
  { key: 'pave', id: 'asphalt_02', tile: 3, tint: 0.15 },
  { key: 'forest', id: 'forrest_ground_01', tile: 2.6, tint: 0.35 },
  { key: 'dry', id: 'dry_ground_rocks', tile: 4, tint: 0.45 },
  { key: 'sand', id: 'sand_01', tile: 2.2, tint: 0.45 },
  { key: 'snow', id: 'snow_02', tile: 3, tint: 0.05 },
  { key: 'gravel', id: 'gravel_road', tile: 2.2, tint: 0.2 },
  // a pale scan: the canyon's red strata come from the biome palette
  { key: 'redrock', id: 'rock_boulder_dry', tile: 5, tint: 0.85 },
];
let terrainArrays = null;

async function packTerrainArrays(maxAnisotropy) {
  // absolute: the worker resolves relative URLs against its own file in assets/
  const base = new URL(`${import.meta.env.BASE_URL}environment/surfaces/`, location.href).href;
  const size = 1024,
    normalSize = 512;
  const layers = TERRAIN_LAYERS.map(({ id }) => ({ diff: `${base}${id}_diff_1k.jpg`, rough: `${base}${id}_rough_1k.jpg`, nor: `${base}${id}_nor_gl_1k.jpg`, disp: `${base}${id}_disp_1k.jpg` }));
  let worker;
  try {
    worker = await openWorker(
      () => new Worker(new URL('./surface-pack.worker.js', import.meta.url), { type: 'module' }),
      () => import('./surface-pack.worker.js?worker&url')
    );
  } catch (error) {
    console.warn('[horizon] terrain texture arrays unavailable', error);
    return null;
  }
  return new Promise((resolve) => {
    worker.onmessage = (e) => {
      worker.terminate();
      if (!e.data.ok) {
        console.warn('[horizon] terrain texture arrays unavailable:', e.data.error);
        return resolve(null);
      }
      const make = (data, s, srgb) => {
        const t = new THREE.DataArrayTexture(data, s, s, TERRAIN_LAYERS.length);
        t.format = THREE.RGBAFormat;
        t.type = THREE.UnsignedByteType;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = Math.min(8, maxAnisotropy);
        t.needsUpdate = true;
        return t;
      };
      const mean = [];
      for (let i = 0; i < TERRAIN_LAYERS.length; i++) mean.push(new THREE.Vector3(e.data.mean[i * 3], e.data.mean[i * 3 + 1], e.data.mean[i * 3 + 2]));
      resolve({ albedo: make(e.data.albedo, size, true), normal: make(e.data.normal, normalSize, false), mean });
    };
    worker.onerror = (err) => {
      worker.terminate();
      console.warn('[horizon] terrain texture arrays unavailable', err.message);
      resolve(null);
    };
    worker.postMessage({ layers, size, normalSize });
  });
}

// Albedo+roughness and normal+height arrays for the terrain (null if unavailable).
export function getTerrainArrays() {
  return terrainArrays;
}

// Call once before constructing the world. Each set fails independently, so a
// missing road texture does not prevent terrain maps from loading (or vice versa).
export function preloadSurfaceAssets(maxAnisotropy = 8) {
  if (loading) return loading;
  const loader = new THREE.TextureLoader();
  const base = `${import.meta.env.BASE_URL}environment/surfaces/`;
  const anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  const loadMap = async (id, suffix, colorSpace) => {
    const texture = await loader.loadAsync(`${base}${id}_${suffix}_1k.jpg`);
    texture.name = `${id}:${suffix}`;
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  const arrays = packTerrainArrays(maxAnisotropy).then((a) => (terrainArrays = a));
  loading = Promise.all(Object.entries(definitions).map(async ([role, definition]) => {
    const wanted = definition.maps || ['diff', 'nor_gl', 'rough'];
    const results = await Promise.allSettled(wanted.map((m) => loadMap(definition.id, m, m === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace)));
    if (results.some((result) => result.status === 'rejected')) {
      for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
      console.warn(`[horizon] ${role} surface maps unavailable; retaining procedural material.`);
      return [role, null];
    }
    const [map, normalMap = null, roughnessMap = null] = results.map((result) => result.value);
    return [role, { ...definition, map, normalMap, roughnessMap }];
  })).then(async (entries) => {
    assets = Object.fromEntries(entries);
    const count = entries.filter(([, set]) => set).length;
    await arrays;
    console.info(`[horizon] ${count}/${entries.length} local PBR surface sets ready; terrain arrays ${terrainArrays ? TERRAIN_LAYERS.length + ' layers' : 'unavailable'}`);
    return count === entries.length;
  });
  return loading;
}

// Maps belong to this cache and are reused by terrain, roads and props. Callers
// must clone maps before altering repeat/offset, and must not dispose shared maps.
export function getSurfaceAssets() {
  return assets;
}
