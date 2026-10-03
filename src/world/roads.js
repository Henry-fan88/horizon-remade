// Road ribbon meshes. Spatial queries live in roadnet.js (DOM-free, used by physics benches).
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { makeRoadMaterial, makeShoulderMaterial } from './road-materials.js';
import { Road, RoadNetwork } from './roadnet.js';
import { RIBBON_LIFT } from './roadprofile.js';
import { useFarShadow } from '../render/farshadow.js';
import { SURF } from './worldgen.js';
import { isSnowRoad } from './snow-surface.js';
import { roadColumns, atJunctionMouth } from './junctions.js';

export { Road, RoadNetwork };

const TEX_LEN = { highway: 16, road: 14, street: 12, dirt: 10, runway: 30, track: 16 };
const CHUNK_ROWS = 250; // ~500 m of road per mesh, so off-screen / distant stretches are culled

// Ribbons follow the same smooth ground the wheels drive on (never dipping under the
// terrain's 4 m triangles), with the normal of that smooth surface.
function groundAt(hf, x, z, g, nv) {
  const h = Math.max(hf.height(x, z), hf.sampleSmooth(x, z, g));
  const l = 1 / Math.sqrt(g.gx * g.gx + 1 + g.gz * g.gz);
  nv.x = -g.gx * l;
  nv.y = l;
  nv.z = -g.gz * l;
  return h;
}

function chunkGeometry(pos, nrm, uv, color, cols, row0, row1, flip = false, junctions = null, road = null) {
  const rows = row1 - row0 + 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(row0 * cols * 3, (row1 + 1) * cols * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(row0 * cols * 3, (row1 + 1) * cols * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv.slice(row0 * cols * 2, (row1 + 1) * cols * 2), 2));
  if (color) g.setAttribute('color', new THREE.BufferAttribute(color.slice(row0 * cols * 4, (row1 + 1) * cols * 4), 4));
  const blend = new Float32Array(rows * cols);
  if (junctions) for (let row = 0; row < rows; row++) blend.fill(junctions.blendAt(road, row + row0), row * cols, (row + 1) * cols);
  g.setAttribute('junctionBlend', new THREE.BufferAttribute(blend, 1));
  const idx = [];
  for (let row = 0; row < rows - 1; row++) {
    if (junctions?.removesRow(road, row + row0)) continue;
    for (let c = 0; c < cols - 1; c++) {
      const a = row * cols + c,
        b = a + 1,
        c2 = a + cols,
        d = c2 + 1;
      if (flip) idx.push(a, c2, b, b, c2, d);
      else idx.push(a, b, c2, b, d, c2);
    }
  }
  g.setIndex(idx);
  if (junctions) trimJunctionOverlaps(g, junctions);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// A wide/skew apron can reach the side of another road beyond that road's
// nominal mouth. Clip those partial triangles too, so no two surfaces flicker
// over each other and no stray edge stripe crosses an adjacent junction.
export function trimJunctionOverlaps(geometry, junctions) {
  const source = geometry.attributes;
  const values = Object.fromEntries(Object.entries(source).map(([key, attr]) => [key, Array.from(attr.array)]));
  const pos = source.position.array, indices = [];
  for (let k = 0; k < geometry.index.count; k += 3) {
    const ids = Array.from(geometry.index.array.slice(k, k + 3));
    const pts = ids.map(i => [pos[i * 3], pos[i * 3 + 2]]);
    const x = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, z = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
    const radius = Math.max(...pts.map(p => Math.hypot(p[0] - x, p[1] - z)));
    const nearby = junctions.nearby(x, z, radius);
    if (!nearby.length) { indices.push(...ids); continue; }
    const [a, b, c] = pts, det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(det) < 1e-8) continue;
    const difference = polygonClipping.difference([pts], ...nearby.map(j => j.polygons));
    const signedArea = ring => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - p[1] * q[0]; }, 0) / 2;
    const area = difference.reduce((s, poly) => s + poly.reduce((t, ring) => t + signedArea(ring), 0), 0);
    if (Math.abs(area - Math.abs(det) / 2) < .0001) { indices.push(...ids); continue; }
    for (const polygon of difference) {
      const rings = polygon.map(r => r.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z))), points = rings.flat();
      const start = values.position.length / 3;
      for (const p of points) {
        const u = ((p.x - a[0]) * (c[1] - a[1]) - (p.y - a[1]) * (c[0] - a[0])) / det;
        const v = ((b[0] - a[0]) * (p.y - a[1]) - (b[1] - a[1]) * (p.x - a[0])) / det;
        for (const [name, attr] of Object.entries(source)) for (let component = 0; component < attr.itemSize; component++) {
          const av = attr.array[ids[0] * attr.itemSize + component], bv = attr.array[ids[1] * attr.itemSize + component], cv = attr.array[ids[2] * attr.itemSize + component];
          values[name].push(av * (1 - u - v) + bv * u + cv * v);
        }
      }
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
        const p = points[i], q = points[j], r = points[k];
        if ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0) indices.push(start + i, start + k, start + j);
        else indices.push(start + i, start + j, start + k);
      }
    }
  }
  for (const [name, attr] of Object.entries(source)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values[name], attr.itemSize));
  geometry.setIndex(indices);
}

export function buildRoadMeshes(network, hf) {
  const group = new THREE.Group();
  group.name = 'roads';
  const mats = {};
  const shoulderMaterial = useFarShadow(makeShoulderMaterial());
  const snowyShoulderMaterial = useFarShadow(makeShoulderMaterial(true));
  const matFor = (kind) => (mats[kind] ||= useFarShadow(makeRoadMaterial(kind)));
  const g = { gx: 0, gz: 0 };
  const nv = { x: 0, y: 1, z: 0 };
  const junctions = network.junctions;
  for (const r of network.roads) {
    const cols = roadColumns(r);
    const n = r.n;
    const rows = r.closed ? n + 1 : n;
    const pos = new Float32Array(rows * cols * 3);
    const nrm = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2);
    const hw = r.width / 2;
    const tl = TEX_LEN[r.kind] ?? 14;
    for (let row = 0; row < rows; row++) {
      const i = row % n;
      const cx = r.pts[i * 3],
        cz = r.pts[i * 3 + 2];
      const rx = -r.tan[i * 2 + 1],
        rz = r.tan[i * 2];
      const s = row < n ? r.s[i] : r.length;
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1);
        const off = -hw + u * r.width;
        const x = cx + rx * off,
          z = cz + rz * off;
        const k = row * cols + c;
        pos[k * 3] = x;
        pos[k * 3 + 1] = groundAt(hf, x, z, g, nv) + RIBBON_LIFT;
        pos[k * 3 + 2] = z;
        nrm[k * 3] = nv.x;
        nrm[k * 3 + 1] = nv.y;
        nrm[k * 3 + 2] = nv.z;
        uv[k * 2] = u;
        uv[k * 2 + 1] = s / tl;
      }
    }
    for (let row0 = 0; row0 < rows - 1; row0 += CHUNK_ROWS) {
      const look = isSnowRoad(r) ? 'snow' : r.surface === SURF.MUD ? 'mud' : ['Dunas Trail', 'Cañón Rojo Rally'].includes(r.name) ? 'desert' : r.kind;
      const mesh = new THREE.Mesh(chunkGeometry(pos, nrm, uv, null, cols, row0, Math.min(rows - 1, row0 + CHUNK_ROWS), false, junctions, r), matFor(look));
      mesh.receiveShadow = true;
      mesh.name = `road:${r.name}:${row0 / CHUNK_ROWS}`;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    // Loose aggregate softens the transition into the verge. These visual ribbons never
    // change the drivable road width or surface queries. Both sides share one mesh per chunk.
    if (r.kind === 'road' || r.kind === 'highway') {
      for (const side of [-1, 1]) {
        const vp = new Float32Array(rows * 2 * 3),
          vn = new Float32Array(rows * 2 * 3),
          vu = new Float32Array(rows * 2 * 2),
          vc = new Float32Array(rows * 2 * 4);
        for (let row = 0; row < rows; row++) {
          const i = row % n,
            s = row < n ? r.s[i] : r.length;
          const width = 0.55 + 0.17 * Math.sin(s * 0.37) + 0.09 * Math.sin(s * 1.13);
          for (let edge = 0; edge < 2; edge++) {
            const off = side * (hw - 0.025 + edge * width);
            const x = r.pts[i * 3] - r.tan[i * 2 + 1] * off;
            const z = r.pts[i * 3 + 2] + r.tan[i * 2] * off;
            const k = row * 2 + edge;
            vp[k * 3] = x;
            vp[k * 3 + 1] = groundAt(hf, x, z, g, nv) + (edge ? 0.02 : RIBBON_LIFT - 0.004);
            vp[k * 3 + 2] = z;
            vn[k * 3] = nv.x;
            vn[k * 3 + 1] = nv.y;
            vn[k * 3 + 2] = nv.z;
            vu[k * 2] = x / 2;
            vu[k * 2 + 1] = z / 2;
            vc.set([1, 1, 1, edge ? 0 : 0.82 * (1 - junctions.blendAt(r, row))], k * 4);
          }
        }
        for (let row0 = 0; row0 < rows - 1; row0 += CHUNK_ROWS) {
          const shoulder = new THREE.Mesh(chunkGeometry(vp, vn, vu, vc, 2, row0, Math.min(rows - 1, row0 + CHUNK_ROWS), side === -1, junctions, r), isSnowRoad(r) ? snowyShoulderMaterial : shoulderMaterial);
          shoulder.receiveShadow = true;
          shoulder.name = `verge:${r.name}:${side}:${row0 / CHUNK_ROWS}`;
          shoulder.matrixAutoUpdate = false;
          group.add(shoulder);
        }
      }
    }
  }
  buildJunctionMeshes(group, junctions, hf, matFor('junction'));
  // circuit kerbs: raised red-and-white strips along the marked corner edges
  const kerbMat = useFarShadow(makeKerbMaterial());
  for (const r of network.roads) if (r.kerb) buildKerbs(group, r, hf, kerbMat, g, nv, junctions);
  return group;
}

// Triangulate concave intersections (including traffic islands), then subdivide
// shared edges together. Every triangle follows the collision heightfield and
// adjoining triangles use the same vertices, even on steep city streets.
export function junctionGeometry(polygon, hf) {
  const rings = polygon.map(r => r.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)));
  const points = rings.flat();
  let triangles = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1));
  for (let pass = 0; pass < 12; pass++) {
    const mids = new Map(), next = [];
    const midpoint = (a, b) => {
      if (points[a].distanceToSquared(points[b]) <= 9) return -1;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!mids.has(key)) { mids.set(key, points.length); points.push(points[a].clone().add(points[b]).multiplyScalar(.5)); }
      return mids.get(key);
    };
    let split = false;
    for (const [a, b, c] of triangles) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      if (ab < 0 && bc < 0 && ca < 0) { next.push([a, b, c]); continue; }
      split = true;
      if (ab >= 0 && bc >= 0 && ca >= 0) next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      else if (ab >= 0 && bc >= 0) next.push([b, bc, ab], [a, ab, c], [ab, bc, c]);
      else if (ab >= 0 && ca >= 0) next.push([a, ab, ca], [ab, b, c], [ab, c, ca]);
      else if (bc >= 0 && ca >= 0) next.push([c, ca, bc], [a, b, ca], [b, bc, ca]);
      else if (ab >= 0) next.push([a, ab, c], [ab, b, c]);
      else if (bc >= 0) next.push([a, b, bc], [a, bc, c]);
      else next.push([a, b, ca], [b, c, ca]);
    }
    triangles = next;
    if (!split) break;
  }
  const pos = [], nrm = [], uv = [], indices = [], g = {}, nv = {};
  for (const p of points) {
    pos.push(p.x, groundAt(hf, p.x, p.y, g, nv) + RIBBON_LIFT, p.y);
    nrm.push(nv.x, nv.y, nv.z); uv.push(p.x / 14, p.y / 14);
  }
  for (const [a, b, c] of triangles) {
    const p = points[a], q = points[b], r = points[c];
    if ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('junctionBlend', new THREE.Float32BufferAttribute(new Float32Array(points.length).fill(1), 1));
  geo.setIndex(indices); geo.computeBoundingSphere();
  return geo;
}

function buildJunctionMeshes(group, junctions, hf, material) {
  const arms = junctions.items.flatMap(j => j.arms);
  const paint = useFarShadow(new THREE.MeshStandardMaterial({ color: 0xd5d6d0, roughness: .96, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 }));
  for (const [id, polygon] of junctions.surfaces.entries()) {
    const mesh = new THREE.Mesh(junctionGeometry(polygon, hf), material);
    mesh.name = `junction:${id}`;
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
    // Edge lines follow the outside of the shared apron, never a crossing lane.
    const positions = [], g = {}, nv = {};
    for (const closedRing of polygon) {
      const ring = closedRing.slice(0, -1), n = ring.length;
      const mouths = ring.map((p, i) => { const q = ring[(i + 1) % n]; return atJunctionMouth(arms, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); });
      const edgeNormal = i => { const p = ring[i], q = ring[(i + 1) % n], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [-(q[1] - p[1]) / l, (q[0] - p[0]) / l]; };
      const normals = ring.map((p, i) => {
        const prev = (i + n - 1) % n, a = edgeNormal(prev), b = edgeNormal(i);
        if (mouths[prev]) return b;
        if (mouths[i]) return a;
        const den = Math.max(.6, 1 + a[0] * b[0] + a[1] * b[1]);
        return [(a[0] + b[0]) / den, (a[1] + b[1]) / den];
      });
      for (let i = 0; i < n; i++) {
        if (mouths[i]) continue;
        const k = (i + 1) % n, p = ring[i], q = ring[k], a = normals[i], b = normals[k];
        const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
        for (let step = 0; step < steps; step++) for (const [t, offset] of [[step / steps, .42], [step / steps, .57], [(step + 1) / steps, .42], [step / steps, .57], [(step + 1) / steps, .57], [(step + 1) / steps, .42]]) {
          const x = p[0] + (q[0] - p[0]) * t + (a[0] + (b[0] - a[0]) * t) * offset;
          const z = p[1] + (q[1] - p[1]) * t + (a[1] + (b[1] - a[1]) * t) * offset;
          positions.push(x, groundAt(hf, x, z, g, nv) + RIBBON_LIFT + .007, z);
        }
      }
    }
    if (positions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals(); geo.computeBoundingSphere();
      const lines = new THREE.Mesh(geo, paint);
      lines.name = `junction-edge:${id}`; lines.receiveShadow = true; lines.matrixAutoUpdate = false;
      group.add(lines);
    }
  }
}

function makeKerbMaterial() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#c8141b';
  g.fillRect(0, 0, 8, 32);
  g.fillStyle = '#f1efe8';
  g.fillRect(0, 32, 8, 32);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.NearestFilter;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
}

// Kerb cross-section: [lateral offset from the road edge (m, + outward), lift (m)]
const KERB_PROFILE = [
  [-1.0, 0.035],
  [-0.62, 0.06],
  [-0.05, 0.055],
  [0.35, 0.02],
];

function buildKerbs(group, r, hf, mat, g, nv, junctions) {
  const n = r.n,
    hw = r.width / 2;
  const pos = [],
    nrm = [],
    uv = [],
    idx = [];
  for (const [bit, side] of [[1, -1], [2, 1]]) {
    let start = -1;
    const flush = (a, b) => {
      if (b - a < 3) return;
      const base = pos.length / 3;
      const cols = KERB_PROFILE.length;
      for (let k = a; k <= b; k++) {
        const i = k % n;
        const rx = -r.tan[i * 2 + 1],
          rz = r.tan[i * 2];
        for (let c = 0; c < cols; c++) {
          const [off, lift] = KERB_PROFILE[c];
          const lat = side * (hw + off);
          const x = r.pts[i * 3] + rx * lat,
            z = r.pts[i * 3 + 2] + rz * lat;
          const h = Math.max(hf.height(x, z), hf.sampleSmooth(x, z, g));
          pos.push(x, h + lift + 0.02, z);
          nrm.push(0, 1, 0);
          uv.push(c / (cols - 1), (k - a) * 2 / 2.4);
        }
      }
      const rows = b - a + 1;
      for (let row = 0; row < rows - 1; row++)
        for (let c = 0; c < cols - 1; c++) {
          const p0 = base + row * cols + c,
            p1 = p0 + 1,
            p2 = p0 + cols,
            p3 = p2 + 1;
          if (side > 0) idx.push(p0, p1, p2, p1, p3, p2);
          else idx.push(p0, p2, p1, p1, p2, p3);
        }
    };
    for (let k = 0; k <= n; k++) {
      const on = k < n && (r.kerb[k] & bit) && junctions.blendAt(r, k) < .1;
      if (on && start < 0) start = k;
      if (!on && start >= 0) {
        flush(start, k - 1);
        start = -1;
      }
    }
  }
  if (!idx.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `kerbs:${r.name}`;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
}
