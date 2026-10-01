// World orchestrator: runs generation in a worker, builds terrain / water / roads /
// vegetation / props, and answers physics queries (height, normal, surface).
import * as THREE from 'three';
import { roadSurfaceAt, isSnowRoad } from './snow-surface.js';
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

export { SURFACE_INFO } from './surfaces.js';

export class World {
  constructor(scene) {
    this.scene = scene;
    this.size = WORLD.size;
    this.half = WORLD.size / 2;
    this._g = { gx: 0, gz: 0 };
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
    // road stretches beyond ~2.2 km are sub-pixel ribbons: skip them
    const cp = camera.position;
    for (const m of this.roadMeshes.children) {
      const b = m.geometry.boundingSphere;
      m.visible = Math.hypot(b.center.x - cp.x, b.center.z - cp.z) - b.radius < 2200;
    }
    this.terrain.update(camera.position);
    this.water.update(env, camera);
    this.vegetation.update(camera.position);
    this.grass.update(camera);
  }

  // Drivable ground: the smooth B-spline surface of the carved heightfield (roads carry
  // their graded profile, crown and banking; no 4 m facets for the suspension to buzz on).
  height(x, z) {
    return this.hf.sampleSmooth(x, z, null);
  }

  sample(x, z, n) {
    const g = this._g;
    const h = this.hf.sampleSmooth(x, z, g);
    const l = 1 / Math.sqrt(g.gx * g.gx + 1 + g.gz * g.gz);
    n.x = -g.gx * l;
    n.y = l;
    n.z = -g.gz * l;
    return h;
  }

  // Surface under a point (exact road test, falls back to painted surface map)
  surfaceAt(x, z) {
    const near = this.network.nearest(x, z, 24, null, this._near);
    if (near) {
      const hw = near.road.width / 2;
      // circuit kerbs: the last metre of the track and a little beyond on marked corners
      if (near.road.kerb && near.dist > hw - 1.1 && near.dist < hw + 0.35 && near.road.kerbAt(near.i) & (near.lateral > 0 ? 2 : 1)) return SURF.KERB;
      if (near.dist < hw + 0.25) return roadSurfaceAt(near.road, isSnowRoad(near.road) ? this.height(x, z) : 0);
    }
    const S = WORLD.res + 1;
    const ix = Math.max(0, Math.min(WORLD.res, Math.round((x + this.half) / this.hf.cell)));
    const iz = Math.max(0, Math.min(WORLD.res, Math.round((z + this.half) / this.hf.cell)));
    const s = this.data.surface[iz * S + ix];
    return s === SURF.ROAD ? SURF.PAVE : s;
  }
}
