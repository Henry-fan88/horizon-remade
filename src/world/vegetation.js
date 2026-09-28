// Instanced vegetation: broadleaf, pine, palm, birch trees, bushes, cacti and boulders.
// Each species is one InstancedMesh (trunk + foliage groups). Instances within view range
// are re-selected when the camera moves, near ones cast shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';
import { makeFoliageTexture, makeFoliageBark } from './foliage-textures.js';
import { getSurfaceAssets } from './surface-assets.js';
import { atmo } from './sky.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _tint = new THREE.Color();

// ---------------------------------------------------------------- geometry helpers

function cardCluster(center, size, rnd, crownCenter, count = 3, normalBend = 0.75) {
  const geos = [];
  const baseRot = rnd() * Math.PI;
  for (let k = 0; k < count; k++) {
    const g = new THREE.PlaneGeometry(size, size, 1, 1);
    g.rotateY(baseRot + (k * Math.PI) / count);
    g.rotateX((rnd() - 0.5) * 0.7);
    g.rotateZ((rnd() - 0.5) * 0.7);
    g.translate(center.x, center.y, center.z);
    // bend normals outward from the crown centre for soft volumetric shading
    const pos = g.attributes.position,
      nrm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      _p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(crownCenter).normalize();
      _s.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      _s.lerp(_p, normalBend).normalize();
      nrm.setXYZ(i, _s.x, _s.y, _s.z);
    }
    geos.push(g);
  }
  return mergeGeometries(geos);
}

function trunk(h, r0, r1, sides = 7, bend = 0, segments = 4) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, segments, true);
  g.translate(0, h / 2, 0);
  if (bend) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / h;
      p.setX(i, p.getX(i) + Math.sin(y * Math.PI * 0.5) * bend);
    }
    g.computeVertexNormals();
  }
  // tile bark vertically
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * h * 0.4);
  return g;
}

function withGroups(trunkGeo, foliageGeo) {
  const merged = mergeGeometries([trunkGeo, foliageGeo], true);
  trunkGeo.dispose();
  foliageGeo.dispose();
  return merged;
}

function branchBetween(start, end, base, tip, sides = 5) {
  const direction = end.clone().sub(start);
  const geometry = new THREE.CylinderGeometry(tip, base, direction.length(), sides, 2, true);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * direction.length() * 0.75);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, direction.normalize()));
  geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return geometry;
}

function stripAttrs(g) {
  // keep only position/normal/uv so merges line up
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g.index ? g : g;
}

// Crown made of many leaf cards spread over the shells of a few overlapping clumps.
function shellCrown(rnd, clumps, cardsPerClump, cardSize, crownCenter, lod = 0) {
  const geos = [];
  for (const cl of clumps) {
    for (let k = 0; k < cardsPerClump; k++) {
      // random direction, biased away from the bottom
      let dx, dy, dz, l;
      do {
        dx = rnd() * 2 - 1;
        dy = rnd() * 2 - 1;
        dz = rnd() * 2 - 1;
        l = dx * dx + dy * dy + dz * dz;
      } while (l > 1 || l < 0.05 || dy < -0.55);
      l = Math.sqrt(l);
      dx /= l;
      dy /= l;
      dz /= l;
      const r = cl.r * (0.32 + Math.sqrt(rnd()) * 0.64);
      const c = new THREE.Vector3(cl.x + dx * r * cl.sx, cl.y + dy * r * cl.sy, cl.z + dz * r * cl.sx);
      const size = cardSize * (0.85 + rnd() * 0.4) * (lod ? 1.27 : 1);
      for (let q = 0; q < 2; q++) {
        const g = new THREE.PlaneGeometry(size, size);
        // face outward, then spin around the normal; the second card is crossed
        const twist = rnd() * Math.PI * 2;
        if (lod && k % 2 !== 0) { g.dispose(); continue; }
        g.rotateZ(twist);
        if (q === 1) g.rotateY(Math.PI / 2);
        _p.set(dx, dy * 0.6, dz).normalize();
        _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _p);
        g.applyQuaternion(_q);
        g.translate(c.x, c.y, c.z);
        const pos = g.attributes.position,
          nrm = g.attributes.normal;
        for (let i = 0; i < pos.count; i++) {
          // Soft crown normals retain volume; an upward component keeps small
          // alpha leaves from reading as pitch-black sheets in backlighting.
          _s.set(pos.getX(i) - crownCenter.x, (pos.getY(i) - crownCenter.y) * 0.8, pos.getZ(i) - crownCenter.z).normalize();
          _s.y += 0.42;
          _s.normalize();
          nrm.setXYZ(i, _s.x, _s.y, _s.z);
        }
        geos.push(stripAttrs(g));
      }
    }
  }
  return mergeGeometries(geos);
}

function buildBroadleaf(seed, birch = false, lod = 0) {
  const rnd = mulberry32(seed);
  const H = birch ? 8.6 : 7.2;
  const t = trunk(H, birch ? 0.18 : 0.35, 0.035, lod ? 4 : 8, birch ? 0.3 : 0.18, lod ? 2 : 5);
  const branches = [t];
  const clumps = [];
  const nb = birch ? 7 : 6;
  const phase = rnd() * Math.PI * 2;
  for (let b = 0; b < nb; b++) {
    const a = phase + b * 2.39996 + (rnd() - 0.5) * 0.45;
    const reach = (birch ? 1.6 : 2.55) * (0.73 + rnd() * 0.38);
    const start = new THREE.Vector3(0.12, H * (0.38 + b * 0.058), 0);
    const end = new THREE.Vector3(Math.cos(a) * reach, start.y + 1.3 + rnd() * 1.0, Math.sin(a) * reach);
    const elbow = start.clone().lerp(end, 0.5);
    elbow.y -= birch ? 0.06 : 0.22;
    if (!lod) {
      branches.push(branchBetween(start, elbow, birch ? 0.073 : 0.145, birch ? 0.052 : 0.092));
      branches.push(branchBetween(elbow, end, birch ? 0.053 : 0.094, 0.018));
    }
    for (const side of [-1, 1]) {
      const fork = end.clone().add(new THREE.Vector3(Math.cos(a + side * 0.65) * 0.6, 0.58 + rnd() * 0.5, Math.sin(a + side * 0.65) * 0.6));
      if (!lod) branches.push(branchBetween(elbow.clone().lerp(end, 0.3), fork, 0.037, 0.008, 4));
    }
    clumps.push({ x: end.x, y: end.y + 0.65, z: end.z, r: (birch ? 1.25 : 1.7) * (0.8 + rnd() * 0.35), sx: 1, sy: birch ? 1.15 : 0.8 });
  }
  clumps.push({ x: 0.2, y: H + 0.05, z: 0, r: birch ? 1.25 : 1.6, sx: 1, sy: 0.9 });
  if (!lod && !birch) for (let k = 0; k < 5; k++) {
    const a = phase + k * Math.PI * 0.4;
    branches.push(branchBetween(new THREE.Vector3(0, 0.47, 0), new THREE.Vector3(Math.cos(a) * 0.8, 0.03, Math.sin(a) * 0.8), 0.13, 0.025, 5));
  }
  const crown = shellCrown(rnd, clumps, 14, birch ? 1.65 : 2.05, new THREE.Vector3(0, H * 0.78, 0), lod);
  return withGroups(mergeGeometries(branches), crown);
}

function buildPine(seed, lod = 0) {
  const rnd = mulberry32(seed);
  const H = 13;
  const woody = [trunk(H, 0.29, 0.025, lod ? 4 : 7, 0.08, lod ? 2 : 5)];
  const cards = [];
  const tiers = 9;
  for (let t = 0; t < tiers; t++) {
    const y = 2.15 + (t / tiers) * (H - 2.5) + Math.sin(seed + t * 1.9) * 0.21;
    const radius = (1 - t / tiers) ** 0.85 * 3.15 + 0.25;
    const cnt = 5;
    for (let k = 0; k < cnt; k++) {
      const a = (k / cnt) * Math.PI * 2 + t * 2.4 + rnd() * 0.5;
      const reach = radius * (0.73 + rnd() * 0.36);
      const drop = 0.15 + rnd() * 0.36;
      if (lod && (t + k) % 2) continue;
      if (!lod && t < 7) woody.push(branchBetween(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a) * reach * 0.95, y - drop, -Math.sin(a) * reach * 0.95), 0.052 * (1 - t / tiers) + 0.012, 0.009, 4));
      // Intersecting bough planes rotate around the limb's longitudinal X axis.
      // Both survive in the far LOD: a horizontal-only canopy disappears from
      // a driver's viewpoint. Taller drooping sprays overlap adjacent tiers.
      for (const pitch of [-1.08, -0.04]) {
        const g = new THREE.PlaneGeometry(reach * 1.18, reach * 0.94 + 0.35, 2, 1);
        g.rotateX(pitch);
        g.translate(reach * 0.53, -drop * 0.65, 0);
        g.rotateZ(-0.18);
        g.rotateY(a);
        g.translate(0, y, 0);
        const pos = g.attributes.position,
          nrm = g.attributes.normal;
        for (let i = 0; i < pos.count; i++) {
          _p.set(pos.getX(i) * 0.4, 1.2, pos.getZ(i) * 0.4).normalize();
          nrm.setXYZ(i, _p.x, _p.y, _p.z);
        }
        cards.push(stripAttrs(g));
      }
    }
  }
  // tip
  const tip = new THREE.PlaneGeometry(1.4, 2.4);
  tip.translate(0, H - 0.4, 0);
  const tip2 = tip.clone().rotateY(Math.PI / 2);
  cards.push(stripAttrs(tip), stripAttrs(tip2));
  return withGroups(mergeGeometries(woody), mergeGeometries(cards));
}

function buildPalm(seed, lod = 0) {
  const rnd = mulberry32(seed);
  const H = 8.5;
  // curved trunk as a tube
  const bendDir = rnd() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const off = Math.pow(t, 1.6) * 1.6;
    pts.push(new THREE.Vector3(Math.cos(bendDir) * off, t * H, Math.sin(bendDir) * off));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, lod ? 4 : 10, 0.22, lod ? 4 : 6, false);
  const uv = tube.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * 4);
  const top = pts[pts.length - 1];
  const fronds = [];
  const n = 20;
  for (let k = 0; k < n; k++) {
    const a = k * 2.39996 + rnd() * 0.3;
    const tier = k % 3;
    const len = (tier === 0 ? 3.35 : 4.2) + rnd() * 1.0;
    const segs = lod ? 3 : 6;
    const pos = [];
    const nor = [];
    const uvs = [];
    const idx = [];
    const droop = (tier === 0 ? 0.08 : tier === 1 ? 0.22 : 0.39) + rnd() * 0.13;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const x = t * len;
      const y = Math.sin(t * Math.PI * 0.6) * (tier === 0 ? 1.85 : 1.0) - t * t * len * droop;
      const w = 1.1 * Math.sin(Math.PI * Math.min(1, t * 1.04 + 0.06));
      for (const side of [-1, 1]) {
        pos.push(x, y - Math.abs(side) * 0.15 * t, side * w);
        nor.push(0, 1, 0);
        uvs.push(t, side < 0 ? 0 : 1);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a0 = s * 2;
      idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.rotateX((rnd() - 0.5) * 0.3);
    g.rotateY(a);
    g.translate(top.x, top.y, top.z);
    fronds.push(g);
  }
  return withGroups(stripAttrs(tube.toNonIndexed ? tube : tube), mergeGeometries(fronds.map(stripAttrs)));
}

function buildBush(seed, lod = 0) {
  const rnd = mulberry32(seed);
  const crownC = new THREE.Vector3(0, 0.5, 0);
  const clumps = [
    { x: 0, y: 0.7, z: 0, r: 0.95, sx: 1.2, sy: 0.75 },
    { x: 0.6, y: 0.5, z: 0.3, r: 0.7, sx: 1.1, sy: 0.8 },
    { x: -0.5, y: 0.45, z: -0.35, r: 0.65, sx: 1.1, sy: 0.8 },
  ];
  const cl = shellCrown(rnd, clumps, 12, 0.94, crownC, lod);
  const stems = [trunk(0.52, 0.05, 0.012, 4)];
  if (!lod) for (const c of clumps) stems.push(branchBetween(new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(c.x, c.y + 0.3, c.z), 0.035, 0.006, 4));
  return withGroups(mergeGeometries(stems), cl);
}

function buildCactus(seed, lod = 0) {
  void lod;
  const rnd = mulberry32(seed);
  const parts = [];
  const body = new THREE.CapsuleGeometry(0.28, 3.6, 4, 10);
  body.translate(0, 2.0, 0);
  parts.push(stripAttrs(body));
  for (let k = 0; k < 2; k++) {
    const side = k ? 1 : -1;
    const h = 1.0 + rnd() * 0.8;
    const arm = new THREE.CapsuleGeometry(0.2, h, 4, 8);
    arm.translate(side * 0.62, 1.8 + rnd() * 0.8 + h / 2, 0);
    const conn = new THREE.CylinderGeometry(0.19, 0.19, 0.62, 8);
    conn.rotateZ(Math.PI / 2);
    conn.translate(side * 0.32, 1.7 + rnd() * 0.3, 0);
    parts.push(stripAttrs(arm), stripAttrs(conn));
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  return g;
}

function buildRock(seed, lod = 0) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, lod ? 1 : 2);
  const p = g.attributes.position;
  const noise = (x, y, z) => Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 - seed * 0.3) * Math.sin(z * 3.3 + seed * 0.7);
  for (let i = 0; i < p.count; i++) {
    _p.set(p.getX(i), p.getY(i), p.getZ(i));
    // Identical shared positions receive identical displacement, preventing the
    // tiny cracks caused by random per-vertex offsets on non-indexed faces.
    const n = 1 + noise(_p.x, _p.y, _p.z) * 0.24 + noise(_p.x * 4, _p.y * 4, _p.z * 4) * 0.055;
    _p.multiplyScalar(n);
    _p.y = _p.y * 0.62 + 0.25;
    p.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- materials

function windify(mat, strength, uniformsTime) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniformsTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
#else
  vec3 ip = vec3( 0.0 );
#endif
  float hf = max( transformed.y - 1.5, 0.0 );
  float ph = ip.x * 0.07 + ip.z * 0.05;
  float sw = sin( uTime * 1.3 + ph ) * 0.6 + sin( uTime * 2.9 + ph * 1.7 ) * 0.25;
  transformed.x += sw * ${strength.toFixed(3)} * hf;
  transformed.z += cos( uTime * 1.1 + ph ) * ${(strength * 0.6).toFixed(3)} * hf;
  transformed += normal * sin( uTime * 5.0 + ph * 5.0 + transformed.y ) * 0.03;`
    );
    // foliage keeps its outward crown normal on both card faces
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '')
    );
    // leaf translucency when looking towards the sun
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#ifdef USE_FOG
  vec3 lv = normalize( vFogWorldPos - cameraPosition );
  outgoingLight += diffuseColor.rgb * fogSunColor * pow( max( dot( lv, fogSunDir ), 0.0 ), 4.0 ) * 0.35;
#endif
#include <opaque_fragment>`
    );
  };
  mat.customProgramCacheKey = () => 'botanical-wind-v2:' + strength;
}

function rockMaterial() {
  const surface = getSurfaceAssets()?.rock;
  if (!surface) return new THREE.MeshStandardMaterial({ color: 0x79756e, roughness: 0.96 });
  const material = new THREE.MeshStandardMaterial({
    color: 0xd6d2c8,
    map: surface.map,
    normalMap: surface.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: surface.roughnessMap,
    roughness: 1,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
      #include <uv_vertex>
      #ifdef USE_INSTANCING
        float rockScale = (length(instanceMatrix[0].xyz) + length(instanceMatrix[2].xyz)) * 0.5;
      #else
        float rockScale = 1.0;
      #endif
      vec2 rockRepeat = vec2(2.5, 1.25) * rockScale;
      vMapUv *= rockRepeat;
      vNormalMapUv *= rockRepeat;
      vRoughnessMapUv *= rockRepeat;
    `);
  };
  material.customProgramCacheKey = () => 'scanned-boulder-v1';
  return material;
}

// ---------------------------------------------------------------- manager

const SPECIES = {
  broadleaf: { variants: 3, range: 1500, near: 170, shadow: true, collide: 0.42 },
  birch: { variants: 2, range: 1300, near: 170, shadow: true, collide: 0.3 },
  pine: { variants: 2, range: 1600, near: 170, shadow: true, collide: 0.4 },
  palm: { variants: 3, range: 1300, near: 170, shadow: true, collide: 0.3 },
  bush: { variants: 2, range: 420, near: 90, shadow: false, collide: 0 },
  cactus: { variants: 2, range: 700, near: 120, shadow: true, collide: 0.35 },
  rock: { variants: 3, range: 1400, near: 150, shadow: true, collide: 1.0 },
};

export class Vegetation {
  constructor(vegData, quality = 1) {
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.quality = quality;
    this.time = atmo.time;
    const leafBroad = makeFoliageTexture('broad');
    const leafBirch = makeFoliageTexture('birch');
    const leafPine = makeFoliageTexture('pine');
    const leafPalm = makeFoliageTexture('palm');
    const barkOak = makeFoliageBark('oak');
    const barkBirch = makeFoliageBark('birch');
    const barkPalm = makeFoliageBark('palm');
    const leafMat = (map, tint, wind) => {
      const m = new THREE.MeshStandardMaterial({ map, color: tint, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, alphaToCoverage: true });
      windify(m, wind, this.time);
      return m;
    };
    const barkMat = (textures) => new THREE.MeshStandardMaterial({ ...textures, bumpScale: 0.045, roughness: 0.98, metalness: 0 });
    this.materials = {
      broadleaf: [barkMat(barkOak), leafMat(leafBroad, 0xffffff, 0.018)],
      birch: [barkMat(barkBirch), leafMat(leafBirch, 0xf4f1da, 0.024)],
      pine: [barkMat(barkOak), leafMat(leafPine, 0xffffff, 0.012)],
      palm: [barkMat(barkPalm), leafMat(leafPalm, 0xffffff, 0.035)],
      bush: [barkMat(barkOak), leafMat(leafBroad, 0xe5e2c4, 0.02)],
      cactus: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.7 }),
      rock: rockMaterial(),
    };
    const builders = {
      broadleaf: (s, l) => buildBroadleaf(s, false, l),
      birch: (s, l) => buildBroadleaf(s, true, l),
      pine: buildPine,
      palm: buildPalm,
      bush: buildBush,
      cactus: buildCactus,
      rock: buildRock,
    };
    this.sets = [];
    this.colliders = [];
    for (const key of Object.keys(SPECIES)) {
      const data = vegData[key];
      if (!data || data.length === 0) continue;
      const sp = SPECIES[key];
      const count = data.length / 5;
      // split instances among variants deterministically
      const buckets = Array.from({ length: sp.variants }, () => []);
      for (let i = 0; i < count; i++) {
        const v = (i * 2654435761) % sp.variants >>> 0;
        buckets[v % sp.variants].push(i);
      }
      for (let v = 0; v < sp.variants; v++) {
        const seed = 1000 + v * 77 + key.length * 13;
        const geo = builders[key](seed, 0);
        const geoFar = builders[key](seed, 1);
        const idx = buckets[v];
        const inst = new Float32Array(idx.length * 5);
        idx.forEach((i, k) => inst.set(data.subarray(i * 5, i * 5 + 5), k * 5));
        const mk = (g, shadow, tag) => {
          const m = new THREE.InstancedMesh(g, this.materials[key], idx.length);
          m.count = 0;
          m.castShadow = shadow;
          m.receiveShadow = true;
          m.frustumCulled = false;
          m.name = `veg:${key}:${v}:${tag}`;
          this.group.add(m);
          return m;
        };
        const mesh = mk(geo, sp.shadow, 'near');
        const far = mk(geoFar, false, 'far');
        this.sets.push({ key, sp, mesh, far, inst, n: idx.length, dead: new Uint8Array(idx.length) });
      }
      if (sp.collide > 0) {
        for (let i = 0; i < count; i++) {
          const s = data[i * 5 + 3];
          this.colliders.push({ type: 'circle', x: data[i * 5], z: data[i * 5 + 2], y0: data[i * 5 + 1] - 1, y1: data[i * 5 + 1] + (key === 'rock' ? 1.6 * s : 12), r: sp.collide * s, kind: key });
        }
      }
    }
    this.bushes = vegData.bush;
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
  }

  // bushes can be driven through (smashed) and regrow later
  registerSmashables(collision) {
    for (const set of this.sets) {
      if (set.key !== 'bush') continue;
      for (let i = 0; i < set.n; i++) {
        const x = set.inst[i * 5],
          y = set.inst[i * 5 + 1],
          z = set.inst[i * 5 + 2],
          s = set.inst[i * 5 + 3];
        const o = { x, y, z, r: 0.8 * s, kind: 'bush', mass: 6 };
        o.onSmash = () => {
          set.dead[i] = 1;
          this.update(this.lastCam, true);
          setTimeout(() => {
            set.dead[i] = 0;
            o.alive = true;
          }, 120000);
        };
        collision.addSmashable(o);
      }
    }
  }

  update(cam, force = false) {
    if (!force && cam.distanceToSquared(this.lastCam) < 12 * 12) return;
    if (cam !== this.lastCam) this.lastCam.copy(cam);
    const q = this.quality;
    for (const set of this.sets) {
      const { inst, n, mesh, far, sp, key } = set;
      const range = sp.range * (0.6 + 0.4 * q);
      const r2 = range * range;
      const near2 = (sp.near * (0.7 + 0.3 * q)) ** 2;
      let c = 0,
        cf = 0;
      const dead = set.dead;
      for (let i = 0; i < n; i++) {
        if (dead[i]) continue;
        const x = inst[i * 5],
          y = inst[i * 5 + 1],
          z = inst[i * 5 + 2];
        const dx = x - cam.x,
          dz = z - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const s = inst[i * 5 + 3];
        const rot = inst[i * 5 + 4];
        _q.setFromAxisAngle(_up, rot);
        if (key === 'rock') _s.set(s * (0.8 + (rot % 1) * 0.5), s * (0.7 + ((rot * 3) % 1) * 0.5), s);
        else _s.set(s, s * (0.9 + ((rot * 7) % 1) * 0.25), s);
        _p.set(x, y - (key === 'rock' ? 0.3 * s : 0.05), z);
        _m.compose(_p, _q, _s);
        // Stable, modest albedo variation avoids repeating one identical green
        // across the entire forest. Matrix/placement and collision data stay exact.
        const variation = (Math.sin(x * 1.73 + z * 2.31) + 1) * 0.5;
        _tint.setRGB(0.85 + variation * 0.15, 0.89 + variation * 0.11, 0.8 + variation * 0.18);
        if (d2 < near2) { mesh.setMatrixAt(c, _m); mesh.setColorAt(c++, _tint); }
        else { far.setMatrixAt(cf, _m); far.setColorAt(cf++, _tint); }
      }
      for (const [m, cnt] of [
        [mesh, c],
        [far, cf],
      ]) {
        m.count = cnt;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        if (m.instanceMatrix.updateRanges) {
          m.instanceMatrix.clearUpdateRanges();
          m.instanceMatrix.addUpdateRange(0, cnt * 16);
        }
      }
    }
  }
}
