// Instancing kit for the city: unit shapes, a colour-aware batch keyed by
// (shape, material, draw range) and a building frame that places parts in
// facade coordinates (u across the front, v outward from it, h above the sidewalk).
import * as THREE from 'three';

// Draw ranges (m). Tall bodies stay visible across the island; trim fades early.
export const FAR = 3400, BODY = 2100, MID = 950, NEAR = 480, FINE = 230;

export function finishGeometry(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'facade'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  // facade materials read this; zero means "derive the mapping from the instance"
  if (!g.attributes.facade) g.setAttribute('facade', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 4), 4));
  g.computeBoundingSphere();
  return g;
}

function prism(profile, y0 = -.5, y1 = .5) {
  // extrude an XZ outline between y0 and y1; winding is fixed per triangle below
  const pos = [], nrm = [], n = profile.length;
  const cx = profile.reduce((a, p) => a + p[0], 0) / n, cz = profile.reduce((a, p) => a + p[1], 0) / n;
  const tri = (pts, normal) => {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const order = fx * normal[0] + fy * normal[1] + fz * normal[2] < 0 ? [a, c, b] : [a, b, c];
    for (const p of order) { pos.push(...p); nrm.push(...normal); }
  };
  for (let i = 0; i < n; i++) {
    const [ax, az] = profile[i], [bx, bz] = profile[(i + 1) % n];
    let nx = bz - az, nz = -(bx - ax);
    const l = Math.hypot(nx, nz);
    nx /= l; nz /= l;
    if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    tri([[ax, y0, az], [bx, y0, bz], [bx, y1, bz]], [nx, 0, nz]);
    tri([[ax, y0, az], [bx, y1, bz], [ax, y1, az]], [nx, 0, nz]);
  }
  for (let i = 1; i < n - 1; i++) {
    const [p0, p1, p2] = [profile[0], profile[i], profile[i + 1]];
    tri([[p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [p2[0], y1, p2[1]]], [0, 1, 0]);
    tri([[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p2[0], y0, p2[1]]], [0, -1, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

const flat = g => { const f = g.index ? g.toNonIndexed() : g; f.computeVertexNormals(); return f; };

export function makeShapes() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Canted bay: full width against the wall (z = -.5), 45-degree cheeks, front .5 wide.
  const bay = prism([[-.5, -.5], [.5, -.5], [.25, .5], [-.25, .5]]);
  // Gable: triangular prism, ridge along z, base at y = 0, apex at y = 1.
  const gable = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-.5, 0), new THREE.Vector2(.5, 0), new THREE.Vector2(0, 1)]), { depth: 1, bevelEnabled: false });
  gable.translate(0, 0, -.5);
  const pyramid = flat(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, .5, 0));
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
  const cyl8 = flat(new THREE.CylinderGeometry(1, 1, 1, 8, 1));
  const cone8 = flat(new THREE.ConeGeometry(1, 1, 8, 1).translate(0, .5, 0));
  const sphere = new THREE.SphereGeometry(.5, 10, 7);
  const plane = new THREE.PlaneGeometry(1, 1);
  // Half-round arch tube (arcades, portals), spanning x in [-.5, .5].
  const arch = new THREE.TorusGeometry(.5, .06, 5, 12, Math.PI);
  // Wedge: top slopes from y = .5 at the wall (z = -.5) to y = -.5 at the front.
  const wedge = prism([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]);
  {
    const p = wedge.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setY(i, -.5);
    wedge.computeVertexNormals();
  }
  const shapes = { box, bay, gable, pyramid, cyl, cyl8, cone8, sphere, plane, arch, wedge };
  for (const [k, g] of Object.entries(shapes)) shapes[k] = finishGeometry(g.index ? g.toNonIndexed() : g);
  return shapes;
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), WHITE = new THREE.Color(1, 1, 1);

export class CityBatch {
  constructor(props) { this.props = props; this.groups = new Map(); }
  add(geo, mat, x, y, z, w, h, d, yaw = 0, range = MID, color = null, pitch = 0, roll = 0) {
    const key = `${geo.uuid}:${mat.uuid}:${range}`;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { geo, mat, range, matrices: [], colors: [] }));
    _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    g.matrices.push(new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(w, h, d)));
    g.colors.push(color || WHITE);
  }
  matrix(geo, mat, matrix, range = MID, color = null) {
    const key = `${geo.uuid}:${mat.uuid}:${range}`;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { geo, mat, range, matrices: [], colors: [] }));
    g.matrices.push(matrix); g.colors.push(color || WHITE);
  }
  get count() { let n = 0; for (const g of this.groups.values()) n += g.matrices.length; return n; }
  flush() {
    for (const { geo, mat, range, matrices, colors } of this.groups.values()) {
      const big = range >= BODY;
      this.props.chunked(geo, mat, matrices, { maxDist: range, shadowDist: big ? 320 : 220, cell: big ? 512 : 256, colors, cast: range > FINE || mat.userData.castSmall });
    }
    this.groups.clear();
  }
}

// A building's local frame. u runs along the street, v points out of the front
// facade (v = d/2 is the front wall), h is height above the front sidewalk.
export class Frame {
  constructor(batch, b) {
    this.B = batch; this.b = b;
    this.c = Math.cos(b.yaw); this.s = Math.sin(b.yaw);
  }
  at(u, v) { return [this.b.x + this.c * u + this.s * v, this.b.z - this.s * u + this.c * v]; }
  put(geo, mat, u, h, v, w, hh, d, range, color, { yaw = 0, pitch = 0, roll = 0 } = {}) {
    const [x, z] = this.at(u, v);
    this.B.add(geo, mat, x, this.b.y + h, z, w, hh, d, this.b.yaw + yaw, range, color, pitch, roll);
  }
  // box whose bottom sits at h (easier for stacking)
  stack(geo, mat, u, h, v, w, hh, d, range, color, opts) { this.put(geo, mat, u, h + hh / 2, v, w, hh, d, range, color, opts); }
}

