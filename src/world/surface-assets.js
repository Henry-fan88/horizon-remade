// Shared local CC0 photo-scanned surface maps. Original sources and checksums:
// public/environment/surfaces/{ATTRIBUTION.md,manifest.json}.
import * as THREE from 'three';

const definitions = {
  grass: { id: 'aerial_grass_rock', tileSize: 15 },
  dirt: { id: 'dirt', tileSize: 2 },
  rock: { id: 'rock_face', tileSize: 2.4 },
  asphalt: { id: 'asphalt_02', tileSize: 3 },
};
let assets = null;
let loading = null;

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
  loading = Promise.all(Object.entries(definitions).map(async ([role, definition]) => {
    const results = await Promise.allSettled([
      loadMap(definition.id, 'diff', THREE.SRGBColorSpace),
      loadMap(definition.id, 'nor_gl', THREE.NoColorSpace),
      loadMap(definition.id, 'rough', THREE.NoColorSpace),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
      console.warn(`[horizon] ${role} surface maps unavailable; retaining procedural material.`);
      return [role, null];
    }
    const [map, normalMap, roughnessMap] = results.map((result) => result.value);
    return [role, { ...definition, map, normalMap, roughnessMap }];
  })).then((entries) => {
    assets = Object.fromEntries(entries);
    const count = entries.filter(([, set]) => set).length;
    console.info(`[horizon] ${count}/${entries.length} local PBR surface sets ready`);
    return count === entries.length;
  });
  return loading;
}

// Maps belong to this cache and are reused by terrain, roads and props. Callers
// must clone maps before altering repeat/offset, and must not dispose shared maps.
export function getSurfaceAssets() {
  return assets;
}
