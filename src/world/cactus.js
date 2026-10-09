// Ribbed, branching desert cacti. The same seeded silhouette is used for both
// LODs; close plants add actual spines and distant plants keep the skin detail.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';
import { softWeather } from './weather-surface.js';

const TAU = Math.PI * 2;

function stemRadius(t, radius, tipFraction) {
  const taper = 0.88 + Math.sin(t * Math.PI * 0.9) * 0.12;
  const cap = Math.max(0, (t - tipFraction) / (1 - tipFraction));
  return radius * taper * Math.sqrt(Math.max(0.00004, 1 - cap * cap));
}

function ribbedStem(curve, radius, ribs, segments, sides, phase, spines, rnd) {
  const frames = curve.computeFrenetFrames(segments, false);
  const length = curve.getLength();
  const capStart = 1 - Math.min(0.22, radius / length);
  const pos = [], uv = [], color = [], indices = [];
  const radial = new THREE.Vector3();
  const capRings = segments > 12 ? 5 : 3, bodyRings = segments - capRings;
  for (let j = 0; j <= segments; j++) {
    // Reserve rings for the hemispherical tip instead of ending with a cone.
    const t = j <= bodyRings ? j / bodyRings * capStart : capStart + (j - bodyRings) / capRings * (1 - capStart);
    const frame = Math.min(segments, Math.round(t * segments)), centre = curve.getPointAt(t);
    const r = stemRadius(t, radius, capStart);
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU;
      const rib = 0.91 + Math.cos(a * ribs) * 0.09;
      radial.copy(frames.normals[frame]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[frame], Math.sin(a));
      const skin = centre.clone().addScaledVector(radial, r * rib);
      pos.push(skin.x, skin.y, skin.z);
      uv.push(k / sides * ribs, t * length / 0.19);
      // Corky basal growth and small irregular scars, rather than uniform green.
      const cork = Math.max(0, 1 - centre.y / 0.52) * 0.7;
      const mottle = 0.96 + Math.sin(t * 19 + a * 3 + phase) * 0.04;
      color.push(mottle * (1 + cork * 0.2), mottle * (1 - cork * 0.2), mottle * (1 - cork * 0.28));
      if (j < segments && k < sides) {
        const q = j * (sides + 1) + k;
        indices.push(q, q + 1, q + sides + 1, q + 1, q + sides + 2, q + sides + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // Average the shared UV seam normals so the stem has no dark vertical join.
  const normals = g.attributes.normal;
  for (let j = 0; j <= segments; j++) {
    const a = j * (sides + 1), b = a + sides;
    radial.set(normals.getX(a) + normals.getX(b), normals.getY(a) + normals.getY(b), normals.getZ(a) + normals.getZ(b)).normalize();
    normals.setXYZ(a, radial.x, radial.y, radial.z);
    normals.setXYZ(b, radial.x, radial.y, radial.z);
  }
  if (spines) {
    const rows = Math.floor(length / 0.19);
    for (let row = 1; row < rows; row++) {
      const t = row * 0.19 / length;
      if (t > capStart + 0.02) continue;
      const j = Math.min(segments, Math.round(t * segments));
      const c = curve.getPointAt(t), r = stemRadius(t, radius, capStart);
      // Every second rib bears a modelled cluster; the texture supplies the rest.
      for (let rib = row % 2; rib < ribs; rib += 2) {
        const a = rib / ribs * TAU;
        radial.copy(frames.normals[j]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[j], Math.sin(a));
        const origin = c.clone().addScaledVector(radial, r + 0.002);
        const around = new THREE.Vector3().crossVectors(frames.tangents[j], radial).normalize();
        for (let k = 0; k < 3; k++) {
          const direction = radial.clone().addScaledVector(frames.tangents[j], k === 0 ? 0.45 : -0.35).addScaledVector(around, (k - 1) * 0.65).normalize();
          const tip = origin.clone().addScaledVector(direction, 0.032 + rnd() * 0.037);
          const edge = around.clone().multiplyScalar(0.0035);
          for (const point of [origin.clone().sub(edge), origin.clone().add(edge), tip]) {
            spines.pos.push(point.x, point.y, point.z);
            spines.uv.push(0, 0);
            spines.color.push(1, 1, 1);
          }
        }
      }
    }
  }
  return g;
}

export function buildCactus(seed, lod = 0) {
  const rnd = mulberry32(seed);
  const h = 3.5 + rnd() * 0.8, radius = 0.29 + rnd() * 0.055;
  const ribs = 10 + Math.floor(rnd() * 3);
  const lean = (rnd() - 0.5) * 0.2;
  const arms = 1 + Math.floor(rnd() * 3), phase = rnd() * TAU;
  // Collect all random arm parameters before the LOD-dependent spine pass.
  const branches = Array.from({ length: arms }, (_, k) => ({
    angle: phase + k * TAU / arms + (rnd() - 0.5) * 0.55,
    y: h * (0.3 + rnd() * 0.3), reach: 0.65 + rnd() * 0.35,
    rise: 0.8 + rnd() * 1.05, radius: radius * (0.57 + rnd() * 0.15),
  }));
  const spines = lod ? null : { pos: [], uv: [], color: [] };
  const trunk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.12, 0), new THREE.Vector3(lean * 0.2, h * 0.35, 0.025),
    new THREE.Vector3(lean * 0.7, h * 0.8, 0.04), new THREE.Vector3(lean, h, 0.025),
  ]);
  const pieces = [ribbedStem(trunk, radius, ribs, lod ? 10 : 24, ribs * (lod ? 2 : 4), phase, spines, rnd)];
  for (const branch of branches) {
    const { angle, y, reach, rise } = branch;
    const point = (r, height) => new THREE.Vector3(Math.cos(angle) * r + lean * y / h, height, Math.sin(angle) * r);
    // A single continuous bend replaces the old disjoint horizontal connectors.
    const curve = new THREE.CatmullRomCurve3([
      point(radius * 0.2, y), point(reach * 0.7, y + 0.05),
      point(reach, y + 0.33), point(reach * 1.02, y + rise * 0.7), point(reach * 0.96, y + rise),
    ]);
    pieces.push(ribbedStem(curve, branch.radius, ribs, lod ? 7 : 18, ribs * (lod ? 2 : 4), phase, spines, rnd));
  }
  const skin = mergeGeometries(pieces);
  pieces.forEach(g => g.dispose());
  if (!spines?.pos.length) {
    skin.addGroup(0, skin.index.count, 0);
    return skin;
  }
  const needles = new THREE.BufferGeometry();
  needles.setAttribute('position', new THREE.Float32BufferAttribute(spines.pos, 3));
  needles.setAttribute('uv', new THREE.Float32BufferAttribute(spines.uv, 2));
  needles.setAttribute('color', new THREE.Float32BufferAttribute(spines.color, 3));
  needles.computeVertexNormals();
  const plain = skin.toNonIndexed();
  const g = mergeGeometries([plain, needles], true);
  skin.dispose(); plain.dispose(); needles.dispose();
  return g;
}

export function makeCactusMaterials() {
  const size = 128, colors = new Uint8Array(size * size * 4), relief = colors.slice();
  const rnd = mulberry32(7319);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    const ridge = Math.cos(u * TAU) * 0.09;
    const noise = (rnd() - 0.5) * 0.045 + Math.sin(u * 53 + v * 29) * 0.018;
    const dx = Math.min(u, 1 - u), dy = Math.min(v, 1 - v);
    const dot = Math.exp(-(dx * dx / 0.0016 + dy * dy / 0.0025));
    const c = new THREE.Color().setRGB(0.21 + ridge * 0.4 + noise, 0.31 + ridge * 0.65 + noise, 0.17 + ridge * 0.5 + noise);
    c.lerp(new THREE.Color(0.49, 0.39, 0.23), dot * 0.9).convertLinearToSRGB();
    colors.set([c.r * 255, c.g * 255, c.b * 255, 255], i);
    const height = Math.min(255, Math.max(0, 124 + ridge * 320 + noise * 180 + dot * 45));
    relief.set([height, height, height, 255], i);
  }
  const texture = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  };
  return [
    softWeather(new THREE.MeshStandardMaterial({ map: texture(colors, true), bumpMap: texture(relief, false), bumpScale: 0.012, vertexColors: true, roughness: 0.89, metalness: 0 })),
    softWeather(new THREE.MeshStandardMaterial({ color: 0xc7b387, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })),
  ];
}
