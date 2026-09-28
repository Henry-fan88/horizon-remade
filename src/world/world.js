// World orchestrator: runs generation in a worker, builds terrain / water / roads /
// vegetation / props, and answers physics queries (height, normal, surface).
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { HeightField } from './heightfield.js';
import { SURF } from './worldgen.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { RoadNetwork, buildRoadMeshes } from './roads.js';
import { makeDetailTexture, makeWaterNormals } from './textures.js';
import { Vegetation } from './vegetation.js';
import { Grass } from './grass.js';

export { SURF };

export function generateInWorker(seed, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worldgen.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.p, m.msg);
      else if (m.type === 'done') {
        w.terminate();
        resolve(m.world);
      } else if (m.type === 'error') {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => reject(new Error(e.message || 'worker error'));
    w.postMessage({ seed: WORLD.seed });
  });
}

// Grip multipliers per surface: [asphalt-tyre grip, off-road penalty weight]
export const SURFACE_INFO = {
  [SURF.GRASS]: { grip: 0.74, rough: 0.35, dust: [0.55, 0.52, 0.4], name: 'grass', offroad: true },
  [SURF.DRY]: { grip: 0.72, rough: 0.35, dust: [0.62, 0.55, 0.4], name: 'dry', offroad: true },
  [SURF.DIRT]: { grip: 0.76, rough: 0.4, dust: [0.55, 0.45, 0.33], name: 'dirt', offroad: true },
  [SURF.SAND]: { grip: 0.66, rough: 0.25, dust: [0.85, 0.78, 0.62], name: 'sand', offroad: true },
  [SURF.ROCK]: { grip: 0.82, rough: 0.55, dust: [0.5, 0.48, 0.45], name: 'rock', offroad: true },
  [SURF.ASH]: { grip: 0.74, rough: 0.5, dust: [0.3, 0.27, 0.26], name: 'ash', offroad: true },
  [SURF.FOREST]: { grip: 0.72, rough: 0.45, dust: [0.45, 0.4, 0.3], name: 'forest', offroad: true },
  [SURF.FIELD]: { grip: 0.7, rough: 0.4, dust: [0.6, 0.52, 0.35], name: 'field', offroad: true },
  [SURF.ROAD]: { grip: 1.0, rough: 0.0, dust: [0.8, 0.8, 0.8], name: 'asphalt', offroad: false },
  [SURF.DIRTROAD]: { grip: 0.8, rough: 0.2, dust: [0.6, 0.5, 0.38], name: 'gravel', offroad: true },
  [SURF.PAVE]: { grip: 0.96, rough: 0.02, dust: [0.8, 0.8, 0.8], name: 'pavement', offroad: false },
  [SURF.VERGE]: { grip: 0.85, rough: 0.15, dust: [0.6, 0.55, 0.45], name: 'verge', offroad: true },
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.size = WORLD.size;
    this.half = WORLD.size / 2;
  }

  build(data) {
    this.data = data;
    this.hf = new HeightField(data.heights, WORLD.res, WORLD.size);
    this.network = new RoadNetwork(data.roads);
    const S = WORLD.res + 1;
    const half = new Uint16Array(S * S);
    for (let i = 0; i < S * S; i++) half[i] = THREE.DataUtils.toHalfFloat(data.heights[i]);
    this.heightTex = new THREE.DataTexture(half, S, S, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    this.detailTex = makeDetailTexture(256);
    this.terrain = new Terrain(data, this.hf, this.detailTex);
    this.scene.add(this.terrain.group);
    this.water = new Water(this.heightTex, makeWaterNormals(256), WORLD.size);
    this.scene.add(this.water.mesh);
    this.roadMeshes = buildRoadMeshes(this.network, this.hf);
    this.scene.add(this.roadMeshes);
    this.vegetation = new Vegetation(data.veg, 1);
    this.scene.add(this.vegetation.group);
    this.grass = new Grass(this, 72000, 90);
    this.scene.add(this.grass.mesh);
    this._near = {};
  }

  update(dt, camera, env) {
    this.terrain.update(camera.position);
    this.water.update(env, camera);
    this.vegetation.update(camera.position);
    this.grass.update(camera);
  }

  height(x, z) {
    return this.hf.height(x, z);
  }

  sample(x, z, n) {
    return this.hf.sample(x, z, n);
  }

  // Surface under a point (exact road test, falls back to painted surface map)
  surfaceAt(x, z) {
    const near = this.network.nearest(x, z, 24, null, this._near);
    if (near && near.dist < near.road.width / 2 + 0.25) return near.road.kind === 'dirt' ? SURF.DIRTROAD : SURF.ROAD;
    const S = WORLD.res + 1;
    const ix = Math.max(0, Math.min(WORLD.res, Math.round((x + this.half) / this.hf.cell)));
    const iz = Math.max(0, Math.min(WORLD.res, Math.round((z + this.half) / this.hf.cell)));
    const s = this.data.surface[iz * S + ix];
    return s === SURF.ROAD ? SURF.PAVE : s;
  }
}
