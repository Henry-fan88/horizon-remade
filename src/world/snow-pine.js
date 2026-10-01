// Snow-laden conifers: bent woody limbs, green needle sprays below them, and
// rounded snow pillows above. Both LODs use the same seeded branch skeleton.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';

const UP = new THREE.Vector3(0, 1, 0);

function colors(geometry, snow = false) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const top = snow ? Math.max(0, n.getY(i)) : 1;
    c.set(snow ? [0.72 + top * 0.28, 0.8 + top * 0.19, 0.89 + top * 0.11] : [1, 1, 1], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geometry;
}

function limb(start, end, radius, lod) {
  const d = end.clone().sub(start);
  const g = new THREE.CylinderGeometry(radius * 0.16, radius, d.length(), 5, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * d.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return colors(g);
}

function snowPillow(branch, lod) {
  const { reach, width, thick, drop, phase, angle, y } = branch;
  const rings = lod ? 3 : 7, sides = lod ? 4 : 8;
  const p = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.55);
    // Uneven scalloped edges keep a bough from reading as a smooth white bar.
    const lobes = 0.87 + 0.1 * Math.cos(t * Math.PI * 6 + phase) + 0.05 * Math.sin(t * 17 + phase);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      const z = s * width * taper * lobes;
      const crown = thick * taper * (c > 0 ? c : c * 0.21);
      p.push(reach * (0.05 + t * 0.94), -drop * t + 0.12 + crown + Math.sin(t * Math.PI) * 0.1, z);
      uv.push(t * reach / 2, z / 2);
      if (i < rings && j < sides) {
        const k = i * (sides + 1) + j, b = k + sides + 1;
        idx.push(k, k + 1, b, k + 1, b + 1, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.rotateY(angle); g.translate(0, y, 0);
  return colors(g, true);
}

function needleCards(branch, lod) {
  const { reach, drop, angle, y } = branch;
  const cards = [];
  for (const pitch of [-1.05, -0.06, ...(lod ? [] : [0.65])]) {
    const g = new THREE.PlaneGeometry(reach * 1.3, reach * 0.8 + 0.4, lod ? 1 : 3, 1);
    g.rotateX(pitch); g.rotateZ(-drop / reach);
    g.translate(reach * 0.54, -drop * 0.44 - 0.15, 0);
    g.rotateY(angle); g.translate(0, y, 0);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i) * 0.2, 0.7, p.getZ(i) * 0.2).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    cards.push(colors(g));
  }
  return cards;
}

export function buildSnowPine(seed, lod = 0) {
  const rnd = mulberry32(seed), height = 12.5 + rnd() * 1.0;
  const trunk = new THREE.CylinderGeometry(0.018, 0.3, height, lod ? 5 : 8, lod ? 2 : 7);
  trunk.translate(0, height / 2, 0);
  const p = trunk.attributes.position, uv = trunk.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / height;
    p.setX(i, p.getX(i) + Math.sin(y * 2.1) * 0.08);
    uv.setY(i, uv.getY(i) * height * 0.65);
  }
  trunk.computeVertexNormals();
  const woody = [colors(trunk)], needles = [], snow = [];
  const branches = [];
  const tiers = 11;
  for (let tier = 0; tier < tiers; tier++) {
    const progress = tier / tiers;
    const y = 2.2 + progress * (height - 2.2);
    const radius = Math.pow(1 - progress, 1.05) * 3.1 + 0.18;
    for (let k = 0; k < 6; k++) {
      const reach = radius * (0.81 + rnd() * 0.29);
      branches.push({ y: y + (rnd() - 0.5) * 0.32, reach,
        width: reach * (0.25 + rnd() * 0.055), thick: 0.16 + reach * 0.095,
        drop: reach * (0.16 + rnd() * 0.12), angle: k * Math.PI / 3 + tier * 2.39 + rnd() * 0.26,
        phase: rnd() * Math.PI * 2, radius: 0.015 + (1 - progress) * 0.055 });
    }
  }
  for (const branch of branches) {
    const { y, reach, drop, angle, radius } = branch;
    if (!lod) {
      const start = new THREE.Vector3(0, y, 0);
      const elbow = new THREE.Vector3(Math.cos(angle) * reach * 0.55, y - drop * 0.64, -Math.sin(angle) * reach * 0.55);
      const tip = new THREE.Vector3(Math.cos(angle) * reach, y - drop, -Math.sin(angle) * reach);
      woody.push(limb(start, elbow, radius, lod), limb(elbow, tip, radius * 0.55, lod));
    }
    needles.push(...needleCards(branch, lod));
    snow.push(snowPillow(branch, lod));
  }
  // Small upright sprays finish the leader without a bare pole at the summit.
  const leader = { reach: 0.42, drop: 0.03, angle: 0, y: height - 0.15, width: 0.18, thick: 0.23, phase: 0 };
  needles.push(...needleCards(leader, lod)); snow.push(snowPillow(leader, lod));
  const parts = [woody, needles, snow].map((items) => {
    const merged = mergeGeometries(items);
    items.forEach((g) => g.dispose());
    return merged;
  });
  const merged = mergeGeometries(parts, true);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}

export function makeBranchSnowMaterial(surface) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, vertexColors: true,
    map: surface?.map ?? null, normalMap: surface?.normalMap ?? null,
    normalScale: new THREE.Vector2(0.12, 0.12), roughness: 0.94, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      // Keep the photographed grains while suppressing footprints from the scan.
      diffuseColor.rgb = mix(diffuse, diffuseColor.rgb, 0.18);`);
  };
  mat.customProgramCacheKey = () => 'snow-pillows-v1';
  return mat;
}
