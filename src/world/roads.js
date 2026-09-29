// Road ribbon meshes. Spatial queries live in roadnet.js (DOM-free, used by physics benches).
import * as THREE from 'three';
import { makeRoadMaterial, makeShoulderMaterial } from './road-materials.js';
import { Road, RoadNetwork } from './roadnet.js';
import { RIBBON_LIFT } from './roadprofile.js';
import { useFarShadow } from '../render/farshadow.js';

export { Road, RoadNetwork };

const TEX_LEN = { highway: 16, road: 14, street: 12, dirt: 10, runway: 30 };
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

function chunkGeometry(pos, nrm, uv, color, cols, row0, row1, flip = false) {
  const rows = row1 - row0 + 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(row0 * cols * 3, (row1 + 1) * cols * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(row0 * cols * 3, (row1 + 1) * cols * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv.slice(row0 * cols * 2, (row1 + 1) * cols * 2), 2));
  if (color) g.setAttribute('color', new THREE.BufferAttribute(color.slice(row0 * cols * 4, (row1 + 1) * cols * 4), 4));
  const idx = [];
  for (let row = 0; row < rows - 1; row++)
    for (let c = 0; c < cols - 1; c++) {
      const a = row * cols + c,
        b = a + 1,
        c2 = a + cols,
        d = c2 + 1;
      if (flip) idx.push(a, c2, b, b, c2, d);
      else idx.push(a, b, c2, b, d, c2);
    }
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function buildRoadMeshes(network, hf) {
  const group = new THREE.Group();
  group.name = 'roads';
  const mats = {};
  const shoulderMaterial = useFarShadow(makeShoulderMaterial());
  const matFor = (kind) => (mats[kind] ||= useFarShadow(makeRoadMaterial(kind)));
  const g = { gx: 0, gz: 0 };
  const nv = { x: 0, y: 1, z: 0 };
  for (const r of network.roads) {
    const cols = r.kind === 'highway' || r.kind === 'runway' ? 7 : 5;
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
      const mesh = new THREE.Mesh(chunkGeometry(pos, nrm, uv, null, cols, row0, Math.min(rows - 1, row0 + CHUNK_ROWS)), matFor(r.kind));
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
            vc.set([1, 1, 1, edge ? 0 : 0.82], k * 4);
          }
        }
        for (let row0 = 0; row0 < rows - 1; row0 += CHUNK_ROWS) {
          const shoulder = new THREE.Mesh(chunkGeometry(vp, vn, vu, vc, 2, row0, Math.min(rows - 1, row0 + CHUNK_ROWS), side === -1), shoulderMaterial);
          shoulder.receiveShadow = true;
          shoulder.name = `verge:${r.name}:${side}:${row0 / CHUNK_ROWS}`;
          shoulder.matrixAutoUpdate = false;
          group.add(shoulder);
        }
      }
    }
  }
  return group;
}
