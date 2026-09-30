// Autódromo Horizonte: the circuit's furniture. Belted tyre walls behind the gravel traps,
// armco along the straights, a concrete pit wall with catch fencing, grandstands with a
// crowd, the pit building and race-control tower, a start gantry with working lights,
// the start line and grid, a footbridge over the back straight and marshal posts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLANDS, local, toWorld } from './regions.js';
import { makeTextTexture } from './textures.js';
import { mulberry32, smoothstep } from '../core/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ribbon wall along a polyline: cross-section box of width w (centred on the line) and height h
function wallGeometry(pts, w, h, uScale = 1) {
  const pos = [],
    uv = [],
    idx = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i];
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0],
      tz = b[2] - a[2];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = -tz * (w / 2),
      nz = tx * (w / 2);
    if (i) s += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][2]);
    // outer-bottom, outer-top, inner-top, inner-bottom
    pos.push(x + nx, y - 0.3, z + nz, x + nx, y + h, z + nz, x - nx, y + h, z - nz, x - nx, y - 0.3, z - nz);
    const u = s * uScale;
    uv.push(u, 0, u, 1, u, 0.5, u, 0);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 4,
      b = a + 4;
    for (const [p, q] of [[0, 1], [1, 2], [2, 3]]) idx.push(a + p, b + p, a + q, a + q, b + p, b + q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A tapered strip along a polyline at a fixed height above it: fence panels, banners.
function curtainGeometry(pts, y0, y1, uScale = 1, vScale = 0) {
  const pos = [],
    uv = [],
    idx = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i];
    if (i) s += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][2]);
    pos.push(x, y + y0, z, x, y + y1, z);
    uv.push(s * uScale, 0, s * uScale, vScale ? (y1 - y0) * vScale : 1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildCircuit(props, data) {
  const track = props.world.network.roads.find((r) => r.kind === 'track');
  if (!track) return null;
  const I = ISLANDS.circuit;
  const group = new THREE.Group();
  group.name = 'autodromo';
  const col = props.game.collision;
  const h = props.h;
  const rnd = mulberry32(4471);
  const n = track.n,
    hw = track.width / 2,
    P = track.pts;

  // ---------------------------------------------------------------- materials
  const beltTex = canvasTex(256, 64, (g, w, hh) => {
    g.fillStyle = '#141416';
    g.fillRect(0, 0, w, hh);
    // conveyor-belt facing with bolt rows and sponsor bands
    g.fillStyle = '#1d1e21';
    for (let y = 6; y < hh; y += 14) g.fillRect(0, y, w, 2);
    g.fillStyle = '#5a5c60';
    for (let x = 8; x < w; x += 32) for (let y = 10; y < hh; y += 22) g.fillRect(x, y, 3, 3);
  }, true);
  const tyreWallMat = new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.82 });
  const sponsorColors = ['#e8112d', '#f4f4f0', '#1f5fff', '#ffd21f', '#ff2d87'];
  const bandTex = canvasTex(1024, 64, (g, w, hh) => {
    const names = ['HORIZON', 'ISLA TYRES', 'PULSE', 'VELOCE OIL', 'AUTÓDROMO', 'NOVA FUEL'];
    for (let k = 0; k < 6; k++) {
      g.fillStyle = sponsorColors[k % sponsorColors.length];
      g.fillRect((k * w) / 6, 0, w / 6, hh);
      g.fillStyle = k % 5 === 1 || k % 5 === 3 ? '#15161a' : '#ffffff';
      g.font = '800 italic 38px "Barlow Condensed", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(names[k], ((k + 0.5) * w) / 6, hh / 2 + 2);
    }
  }, true);
  const bandMat = new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.55, side: THREE.DoubleSide });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.9 });
  const fenceTex = canvasTex(64, 64, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(190,196,200,0.95)';
    g.lineWidth = 2;
    for (let k = -w; k < w * 2; k += 12) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + w, w);
      g.stroke();
      g.beginPath();
      g.moveTo(k + w, 0);
      g.lineTo(k, w);
      g.stroke();
    }
  }, true);
  fenceTex.colorSpace = THREE.NoColorSpace;
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, alphaTest: 0.35, transparent: false, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8f969c, metalness: 0.7, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1f3440, metalness: 0.5, roughness: 0.08, clearcoat: 1 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xff2d87, roughness: 0.5, emissive: 0xff2d87, emissiveIntensity: 0.15 });
  props.nightMats.push({ mat: pink, day: 0.15, night: 1.2 });

  // ---------------------------------------------------------------- track analysis
  const curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 8 + n) % n,
      c = (i + 8) % n;
    const ax = P[i * 3] - P[a * 3],
      az = P[i * 3 + 2] - P[a * 3 + 2];
    const bx = P[c * 3] - P[i * 3],
      bz = P[c * 3 + 2] - P[i * 3 + 2];
    curv[i] = (ax * bz - az * bx) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1) / 16;
  }
  const at = (i, lat) => {
    const k = ((i % n) + n) % n;
    const rx = -track.tan[k * 2 + 1],
      rz = track.tan[k * 2];
    const x = P[k * 3] + rx * lat,
      z = P[k * 3 + 2] + rz * lat;
    return [x, h(x, z), z];
  };
  // the paddock side of the main straight (pit wall and fencing instead of armco)
  const pitSide = (i, side) => {
    const [x, , z] = at(i, side * (hw + 5));
    const { u, v } = local(I, x, z);
    return v > 300 && Math.abs(u) < 395;
  };
  // how far out the barrier sits: behind the gravel trap on the outside of corners
  const trapness = [new Float32Array(n), new Float32Array(n)];
  for (const [si, side] of [[0, -1], [1, 1]]) {
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = curv[i] * side < 0 ? smoothstep(1 / 300, 1 / 120, Math.abs(curv[i])) : 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = -18; k <= 18; k++) m = Math.max(m, raw[(i + k + n) % n] * (1 - Math.abs(k) / 20));
      trapness[si][i] = m;
    }
  }

  // ---------------------------------------------------------------- barriers
  const railSegs = [];
  const tyreRuns = [],
    pitRuns = [];
  for (const [si, side] of [[0, -1], [1, 1]]) {
    let run = null,
      kind = null;
    const flush = () => {
      if (run && run.length > 2) (kind === 'tyre' ? tyreRuns : kind === 'pit' ? pitRuns : railSegs).push(run);
      run = null;
    };
    for (let i = 0; i <= n; i += 2) {
      const k = i % n;
      const pit = pitSide(k, side);
      // pit entry and exit stay open so the paddock connects to the track
      const { u } = local(I, P[k * 3], P[k * 3 + 2]);
      const gap = pit && Math.abs(u) > 330;
      const t = trapness[si][k];
      const want = gap ? null : pit ? 'pit' : t > 0.2 ? 'tyre' : 'armco';
      const lat = side * (pit ? hw + 4.5 : hw + 15 + t * 14);
      if (want !== kind) {
        flush();
        kind = want;
        if (kind) run = [];
      }
      if (run) run.push(at(k, lat));
    }
    flush();
  }
  // armco: handed to the shared guard-rail builder (instancing + collision)
  const rails = [];
  for (const run of railSegs) for (let k = 0; k < run.length - 1; k++) rails.push(...run[k], ...run[k + 1]);
  props.buildRails(new Float32Array(rails));
  // tyre walls with sponsor bands, pit wall in concrete; both collide
  const tyreGeos = [],
    bandGeos = [],
    pitGeos = [],
    fenceGeos = [],
    postMs = [];
  const fenceRun = (run, y0, y1) => {
    fenceGeos.push(curtainGeometry(run, y0, y1, 1 / 1.4, 1 / 1.4));
    for (let k = 0; k < run.length; k += 2) postMs.push(new THREE.Matrix4().makeTranslation(run[k][0], run[k][1], run[k][2]));
  };
  for (const run of tyreRuns) {
    tyreGeos.push(wallGeometry(run, 1.0, 1.05, 1 / 6));
    bandGeos.push(curtainGeometry(run.map(([x, y, z]) => [x, y, z]), 1.06, 1.46, 1 / 24));
    fenceRun(run, 1.5, 4.6);
    for (let k = 0; k < run.length - 1; k++) col.addSegment(run[k][0], run[k][2], run[k + 1][0], run[k + 1][2], 0.55, run[k][1] - 1, run[k][1] + 1.2, 'rail');
  }
  for (const run of pitRuns) {
    pitGeos.push(wallGeometry(run, 0.8, 1.0, 1 / 4));
    fenceRun(run, 1.0, 4.2);
    for (let k = 0; k < run.length - 1; k++) col.addSegment(run[k][0], run[k][2], run[k + 1][0], run[k + 1][2], 0.45, run[k][1] - 1, run[k][1] + 1.1, 'wall');
  }
  const add = (geos, mat, cast = true) => {
    if (!geos.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(tyreGeos, tyreWallMat);
  add(bandGeos, bandMat, false);
  add(pitGeos, concrete);
  add(fenceGeos, fenceMat, false);
  const post = new THREE.CylinderGeometry(0.05, 0.05, 4.6, 5).translate(0, 2.3, 0);
  props.chunked(post, steel, postMs, { maxDist: 500, shadowDist: 120 });

  // ---------------------------------------------------------------- start line + grid
  // the start line sits in the middle of the main straight, in the direction of travel
  let iStart = 0,
    best = 1e9;
  for (let i = 0; i < n; i++) {
    const { u, v } = local(I, P[i * 3], P[i * 3 + 2]);
    const d = Math.abs(u) + Math.abs(v - 300) * 4;
    if (d < best) {
      best = d;
      iStart = i;
    }
  }
  const decal = (i, along, lat, len, wid, mat) => {
    const k = ((i % n) + n) % n;
    const tx = track.tan[k * 2],
      tz = track.tan[k * 2 + 1];
    const x = P[k * 3] + tx * along - tz * lat,
      z = P[k * 3 + 2] + tz * along + tx * lat;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len).rotateX(-Math.PI / 2), mat);
    m.position.set(x, props.world.height(x, z) + 0.045, z);
    m.rotation.y = Math.atan2(tx, tz);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const checker = canvasTex(256, 32, (g, w, hh) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  const decalMat = (map, color = 0xffffff) => new THREE.MeshStandardMaterial({ map, color, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  decal(iStart, 0, 0, 1.6, track.width - 0.6, decalMat(checker));
  // grid boxes where RaceManager lines the cars up (6 m behind the line, rows 8.5 m apart)
  const gridMat = decalMat(null, 0xf0f0ea);
  for (let slot = 0; slot < 12; slot++) {
    const lat = (slot % 2 ? 1 : -1) * 3;
    const back = -6 - Math.floor(slot / 2) * 8.5;
    decal(iStart, back + 2.4, lat, 0.16, 2.4, gridMat);
    for (const e of [-1.2, 1.2]) decal(iStart, back + 1.2, lat + e, 2.4, 0.14, gridMat);
  }

  // ---------------------------------------------------------------- start gantry
  const k0 = iStart;
  const tx0 = track.tan[k0 * 2],
    tz0 = track.tan[k0 * 2 + 1];
  const sx = P[k0 * 3],
    sz = P[k0 * 3 + 2],
    sy = h(sx, sz);
  const gantry = new THREE.Group();
  gantry.position.set(sx, sy, sz);
  gantry.rotation.y = Math.atan2(tx0, tz0);
  for (const side of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8.4, 0.6), steel);
    pylon.position.set(side * (hw + 1.4), 4.2, 0);
    pylon.castShadow = true;
    gantry.add(pylon);
    // the group's local +x points along (tz, -tx) in world space
    col.addCircle(sx + side * (hw + 1.4) * tz0, sz - side * (hw + 1.4) * tx0, 0.5, sy - 1, sy + 8, 'pole');
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(track.width + 3.6, 1.3, 0.9), dark);
  beam.position.y = 7.4;
  beam.castShadow = true;
  gantry.add(beam);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1), new THREE.MeshStandardMaterial({ map: makeTextTexture('AUTÓDROMO HORIZONTE', { w: 1024, h: 128, bg: '#15161a', fg: '#ffffff', font: '800 italic 96px "Barlow Condensed", sans-serif' }), roughness: 0.6 }));
  sign.position.set(0, 7.4, -0.46);
  sign.rotation.y = Math.PI;
  gantry.add(sign);
  const lampOff = new THREE.MeshStandardMaterial({ color: 0x220405, emissive: 0xff1a12, emissiveIntensity: 0, roughness: 0.3 });
  const lamps = [];
  for (let k = 0; k < 5; k++) {
    const m = lampOff.clone();
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.26, 18), m);
    lamp.position.set((k - 2) * 0.9, 6.55, -0.46);
    lamp.rotation.y = Math.PI;
    gantry.add(lamp);
    lamps.push(m);
  }
  group.add(gantry);

  // ---------------------------------------------------------------- pit building + tower
  const facing = I.angle; // local +u direction in world yaw terms
  const place = (obj, u, v, y = null) => {
    const [x, z] = toWorld(I, u, v);
    obj.position.set(x, y ?? h(x, z), z);
    // local axes: +u -> obj +x, +v -> obj -z
    obj.rotation.y = -facing;
    group.add(obj);
    return obj;
  };
  const pits = new THREE.Group();
  const pitLen = 340,
    pitDepth = 18;
  const body = new THREE.Mesh(new THREE.BoxGeometry(pitLen, 8, pitDepth), white);
  body.position.set(0, 4, 0);
  body.castShadow = body.receiveShadow = true;
  pits.add(body);
  const hospitality = new THREE.Mesh(new THREE.BoxGeometry(pitLen - 4, 3.2, 0.2), glass);
  hospitality.position.set(0, 6.1, pitDepth / 2 + 0.05);
  pits.add(hospitality);
  const roofSign = new THREE.Mesh(new THREE.BoxGeometry(pitLen, 0.9, 0.5), pink);
  roofSign.position.set(0, 8.4, pitDepth / 2 - 0.2);
  pits.add(roofSign);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.55, metalness: 0.4 });
  const doors = [];
  for (let g = 0; g < 20; g++) doors.push(new THREE.BoxGeometry(11.5, 3.6, 0.15).translate(-pitLen / 2 + 8.5 + g * 16.5, 1.9, pitDepth / 2 + 0.05));
  const doorMesh = new THREE.Mesh(mergeGeometries(doors), doorMat);
  pits.add(doorMesh);
  // pits face the track: the building's +z side looks along local -v
  const [pbx, pbz] = toWorld(I, 0, 355);
  pits.position.set(pbx, h(pbx, pbz), pbz);
  pits.rotation.y = -facing + Math.PI;
  group.add(pits);
  col.addBox(pbx, pbz, pitLen / 2, pitDepth / 2, facing, h(pbx, pbz), h(pbx, pbz) + 9, 'building');
  // race control tower at the pit exit end
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 20, 7), white);
  shaft.position.y = 10;
  shaft.castShadow = true;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 10), glass);
  cab.position.y = 22.5;
  cab.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(13, 0.8, 11), dark);
  cap.position.y = 25.4;
  const towerSign = new THREE.Mesh(new THREE.BoxGeometry(13.2, 1.4, 11.2), pink);
  towerSign.position.y = 19.4;
  tower.add(shaft, cab, cap, towerSign);
  const [twx, twz] = toWorld(I, 205, 372);
  tower.position.set(twx, h(twx, twz), twz);
  tower.rotation.y = -facing;
  group.add(tower);
  col.addBox(twx, twz, 3.6, 3.6, facing, h(twx, twz), h(twx, twz) + 26, 'building');

  // paddock trucks and motorhomes behind the pits
  const truckGeo = new THREE.BoxGeometry(2.5, 3.8, 13).translate(0, 1.9, 0);
  const truckMats = sponsorColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.3 }));
  for (let k = 0; k < 14; k++) {
    const u = -300 + k * 45 + (rnd() - 0.5) * 8;
    const truck = new THREE.Mesh(truckGeo, truckMats[k % truckMats.length]);
    truck.castShadow = true;
    const [x, z] = toWorld(I, u, 420);
    truck.position.set(x, h(x, z), z);
    truck.rotation.y = -facing; // parked nose-in, along the paddock's depth
    group.add(truck);
    col.addBox(x, z, 1.25, 6.5, facing, h(x, z), h(x, z) + 4, 'building');
  }

  // ---------------------------------------------------------------- grandstands + crowd
  const seatColors = [0xe8112d, 0x1f5fff, 0xf4f4f0, 0xffd21f].map((c) => new THREE.Color(c));
  const crowdGeo = new THREE.CapsuleGeometry(0.22, 0.55, 2, 6).translate(0, 0.5, 0);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const crowd = [],
    crowdCol = [];
  const stand = (u, v, len, rows, yawOffset = 0) => {
    const g = new THREE.Group();
    const stepGeos = [],
      seatGeos = [];
    for (let r = 0; r < rows; r++) {
      stepGeos.push(new THREE.BoxGeometry(len, 0.5 + r * 0.55, 0.9).translate(0, (0.5 + r * 0.55) / 2, -r * 0.9));
      seatGeos.push(new THREE.BoxGeometry(len - 1, 0.35, 0.45).translate(0, 0.62 + r * 0.55, -r * 0.9 + 0.15));
    }
    const steps = new THREE.Mesh(mergeGeometries(stepGeos), concrete);
    steps.castShadow = steps.receiveShadow = true;
    const seats = new THREE.Mesh(mergeGeometries(seatGeos), new THREE.MeshStandardMaterial({ color: seatColors[Math.floor(rnd() * 4)], roughness: 0.5 }));
    seats.receiveShadow = true;
    g.add(steps, seats);
    const top = 0.5 + rows * 0.55;
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, top + 3, 0.4), dark);
    back.position.set(0, (top + 3) / 2, -rows * 0.9 - 0.2);
    back.castShadow = true;
    g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.4, rows * 0.9 + 3), white);
    roof.position.set(0, top + 3.2, -rows * 0.45 + 0.6);
    roof.rotation.x = -0.06;
    roof.castShadow = true;
    g.add(roof);
    for (let c = -len / 2 + 2; c <= len / 2 - 2; c += 12) {
      const colm = new THREE.Mesh(new THREE.BoxGeometry(0.35, top + 3.2, 0.35), steel);
      colm.position.set(c, (top + 3.2) / 2, 0.6);
      g.add(colm);
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), bandMat);
    banner.position.set(0, top + 2.4, 1.3);
    g.add(banner);
    const [x, z] = toWorld(I, u, v);
    const y = h(x, z);
    g.position.set(x, y, z);
    g.rotation.y = -facing + yawOffset;
    group.add(g);
    g.updateMatrixWorld(true);
    // spectators on about two thirds of the seats
    for (let r = 0; r < rows; r++)
      for (let c = -len / 2 + 1; c < len / 2 - 1; c += 0.75) {
        if (rnd() < 0.35) continue;
        _v.set(c + (rnd() - 0.5) * 0.2, 0.62 + r * 0.55, -r * 0.9 + 0.1).applyMatrix4(g.matrixWorld);
        _q.setFromAxisAngle(_up, g.rotation.y + (rnd() - 0.5) * 0.6);
        _s.setScalar(0.9 + rnd() * 0.2);
        crowd.push(new THREE.Matrix4().compose(_v.clone(), _q.clone(), _s.clone()));
        crowdCol.push(new THREE.Color().setHSL(rnd(), 0.35 + rnd() * 0.5, 0.25 + rnd() * 0.5));
      }
    // collision box over the seating: it runs back (local -z) from the front row
    const yaw = -facing + yawOffset;
    const cx = x - Math.sin(yaw) * rows * 0.45,
      cz = z - Math.cos(yaw) * rows * 0.45;
    col.addBox(cx, cz, len / 2, rows * 0.45 + 1, facing - yawOffset, y, y + top + 3, 'building');
  };
  // main straight (infield side, facing the pits), outside T1, the hairpin; a stand's
  // front row faces local +z, which is +v at yawOffset 0
  stand(0, 262, 220, 14, 0);
  stand(706, 205, 90, 12, -Math.PI / 2 - 0.2);
  stand(-660, -305, 80, 11, Math.PI / 2 - 0.2);
  if (crowd.length) {
    const lookup = props.chunked(crowdGeo, crowdMat, crowd, { maxDist: 320, shadowDist: 0, cast: false });
    lookup.forEach(([im, k], i) => im.setColorAt(k, crowdCol[i]));
    for (const [im] of new Set(lookup.map(([im]) => im)).entries()) im.instanceColor && (im.instanceColor.needsUpdate = true);
  }

  // ---------------------------------------------------------------- footbridge over the back straight
  {
    let ib = 0,
      bb = 1e9;
    for (let i = 0; i < n; i++) {
      const { u, v } = local(I, P[i * 3], P[i * 3 + 2]);
      const d = Math.abs(u - 60) + Math.abs(v + 384) * 4;
      if (d < bb) {
        bb = d;
        ib = i;
      }
    }
    const tx = track.tan[ib * 2],
      tz = track.tan[ib * 2 + 1];
    const bx = P[ib * 3],
      bz = P[ib * 3 + 2],
      by = h(bx, bz);
    const bridge = new THREE.Group();
    bridge.position.set(bx, by, bz);
    bridge.rotation.y = Math.atan2(tx, tz);
    const span = track.width + 12;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(span / 2, 0.35, 8, 40, Math.PI), pink);
    arch.position.y = 4.5;
    arch.rotation.y = 0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.6, 3), white);
    deck.position.y = 6.4;
    deck.castShadow = true;
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(span - 2, 1.4), bandMat);
    ad.position.set(0, 7.3, 1.52);
    const ad2 = ad.clone();
    ad2.position.z = -1.52;
    ad2.rotation.y = Math.PI;
    bridge.add(arch, deck, ad, ad2);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6.4, 3), concrete);
      leg.position.set(side * span / 2, 3.2, 0);
      leg.castShadow = true;
      bridge.add(leg);
      col.addBox(bx + tz * side * (span / 2), bz - tx * side * (span / 2), 0.6, 1.5, Math.atan2(tx, tz), by, by + 6.4, 'building');
    }
    group.add(bridge);
  }

  // ---------------------------------------------------------------- marshal posts
  const postGeo = mergeGeometries([new THREE.BoxGeometry(2.2, 2.4, 2.2).translate(0, 1.2, 0), new THREE.BoxGeometry(2.8, 0.2, 2.8).translate(0, 2.5, 0)]);
  const marshal = [];
  for (let i = 0; i < n; i += 170) {
    const side = curv[i] > 0 ? -1 : 1;
    const t = trapness[side < 0 ? 0 : 1][i];
    const [x, y, z] = at(i, side * (hw + 15 + t * 14 + 4));
    marshal.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_up, Math.atan2(track.tan[i * 2], track.tan[i * 2 + 1])), new THREE.Vector3(1, 1, 1)));
  }
  props.chunked(postGeo, new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.6 }), marshal, { maxDist: 600 });

  group.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true;
  });
  props.group.add(group);
  return {
    group,
    startIndex: iStart,
    // race start lights: 0..5 lit, or -1 = all out
    setLights(count) {
      lamps.forEach((m, k) => (m.emissiveIntensity = k < count ? 6 : 0));
    },
  };
}
