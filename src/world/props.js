// World dressing: festival site, town, airfield, lighthouse, turbines, lamps, rails,
// chevrons, fences, bonus boards (smashable) and the volcano plume.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOCATIONS } from './worldgen.js';
import { WORLD, GAME_TITLE, FESTIVAL_NAME } from '../config.js';
import { makeTextTexture, makeSmokeTexture } from './textures.js';
import { makeArchitecturalMaterials } from './architecture-materials.js';
import { atmo, fogUniforms } from './sky.js';
import { mulberry32 } from '../core/math.js';
import { buildCircuit } from './circuit-props.js';
import { buildDistrictLandmarks } from './district-props.js';
import { buildCity } from './city-props.js';
import { cityMask } from './districts.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...extra });
}

function instanced(geo, mat, matrices, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  matrices.forEach((m, i) => im.setMatrixAt(i, m));
  im.count = matrices.length;
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.computeBoundingSphere();
  return im;
}

function mat4(x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromAxisAngle(_up, rotY);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.clone(), new THREE.Vector3(sx, sy, sz));
}

// Small construction details share one instanced draw call per material (per area cell
// when a chunker is given, so distant trim is culled with its block).
function detailBatch(parent, chunker = null) {
  const batches = new Map();
  return {
    box(material, x, y, z, w, h, d, yaw = 0) {
      if (!batches.has(material)) batches.set(material, []);
      batches.get(material).push(mat4(x, y, z, yaw, w, h, d));
    },
    flush() {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      for (const [material, matrices] of batches) {
        if (chunker) chunker(geometry, material, matrices);
        else parent.add(instanced(geometry, material, matrices));
      }
    },
  };
}

// Island-wide instanced props are split into cells so each InstancedMesh has a tight
// bounding sphere: the camera, reflection and shadow passes cull the cells out of view,
// and Props.update() hides cells beyond the prop's draw distance.
const CHUNK = 256;

function tubeBetween(a, b, radius = .05, sides = 6) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), sides);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, delta.normalize()));
  geometry.translate(...start.add(end).multiplyScalar(.5));
  return geometry;
}

function mergedParts(parent, parts, material, cast = true) {
  if (!parts.length) return;
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function lattice(parts, start, end, width = .6, segment = 1.7) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const axis = b.clone().sub(a), length = axis.length();
  axis.normalize();
  const cross = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < .9 ? _up : new THREE.Vector3(1, 0, 0)).normalize().multiplyScalar(width / 2);
  const other = new THREE.Vector3().crossVectors(axis, cross).normalize().multiplyScalar(width / 2);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => cross.clone().multiplyScalar(x).addScaledVector(other, y));
  for (const corner of corners) parts.push(tubeBetween([...a.clone().add(corner)], [...b.clone().add(corner)], .045));
  const steps = Math.ceil(length / segment);
  for (let k = 0; k < steps; k++) {
    const p = a.clone().addScaledVector(axis, length * k / steps);
    const q = a.clone().addScaledVector(axis, length * (k + 1) / steps);
    for (let side = 0; side < 4; side++) {
      parts.push(tubeBetween([...p.clone().add(corners[side])], [...p.clone().add(corners[(side + 1) % 4])], .028));
      parts.push(tubeBetween([...p.clone().add(corners[side])], [...q.clone().add(corners[(side + 1) % 4])], .024));
    }
  }
}

// Four gently concave sail panels give the roof tension, instead of a rigid cone.
function tentMembrane() {
  const positions = [], uvs = [], indices = [];
  const corners = [[-4.1, -4.1], [4.1, -4.1], [4.1, 4.1], [-4.1, 4.1]];
  const steps = 16;
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4], offset = positions.length / 3;
    for (let r = 0; r <= steps; r++) for (let t = 0; t <= steps; t++) {
      const u = r / steps, v = t / steps;
      const x = u * (a[0] * (1 - v) + b[0] * v), z = u * (a[1] * (1 - v) + b[1] * v);
      const y = 3.7 + 3.5 * Math.pow(1 - u, 1.65) - .25 * u * Math.sin(v * Math.PI);
      positions.push(x, y, z); uvs.push(x * .55, z * .55);
      if (r < steps && t < steps) {
        const i = offset + r * (steps + 1) + t;
        indices.push(i, i + steps + 1, i + 1, i + 1, i + steps + 1, i + steps + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function hippedRoof(hw, hd, height) {
  // Four roof planes, with metre-scaled UVs for the barrel tiles.
  const p = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw * .55, height, 0], [hw * .55, height, 0]];
  const faces = [[0, 4, 5], [0, 5, 1], [1, 5, 2], [2, 5, 4], [2, 4, 3], [3, 4, 0]];
  const positions = [], uv = [];
  for (const face of faces) for (const i of face) { positions.push(...p[i]); uv.push(p[i][0] / 4, p[i][2] / 4); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// LED wall shader for the festival stage
const ledFrag = /* glsl */ `
uniform float time;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 cell = floor( uv * vec2( 160.0, 64.0 ) );
  vec2 f = fract( uv * vec2( 160.0, 64.0 ) );
  float px = smoothstep( 0.0, 0.2, f.x ) * smoothstep( 1.0, 0.8, f.x ) * smoothstep( 0.0, 0.2, f.y ) * smoothstep( 1.0, 0.8, f.y );
  vec2 c = cell / vec2( 160.0, 64.0 );
  float w = sin( c.x * 12.0 + time * 2.0 ) * 0.5 + sin( c.y * 9.0 - time * 1.3 + c.x * 4.0 ) * 0.5;
  float sun = smoothstep( 0.32, 0.3, length( ( c - vec2( 0.5, 0.35 ) ) * vec2( 2.5, 1.0 ) ) ) * step( 0.35, c.y );
  float stripes = step( 0.5, fract( c.y * 14.0 - time * 0.5 ) ) * sun;
  vec3 col = mix( vec3( 0.1, 0.15, 0.2 ), vec3( 0.56, 0.18, 0.29 ), c.y + w * 0.2 );
  col = mix( col * 0.5, vec3( 0.82, 0.72, 0.55 ), stripes );
  col += vec3( 0.17, 0.12, 0.2 ) * smoothstep( 0.6, 1.0, w ) * 0.3;
  gl_FragColor = vec4( col * px * 1.6, 1.0 );
}`;

export class Props {
  constructor(game, data) {
    this.game = game;
    this.world = game.world;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.animated = [];
    this.nightMats = [];
    this.smashables = [];
    this.boards = [];
    this.archMaterials = makeArchitecturalMaterials();
    this.chunks = [];
    const hf = this.world.hf;
    this.h = (x, z) => hf.height(x, z);
    this.buildFestival();
    buildCity(this);
    buildDistrictLandmarks(this);
    this.buildAirfield(data.airfield);
    this.circuit = buildCircuit(this, data);
    this.buildLamps(data.props.lamps);
    this.buildPosts(data.props.posts);
    this.buildRails(data.props.rails);
    this.buildChevrons(data.props.chevrons);
    this.buildFences(data.props.fences);
    this.buildTurbines(data.props.turbines);
    this.buildBoards(data.props.boards);
    this.buildLighthouse();
    this.buildViewpoint();
    this.buildPlume();
    game.scene.add(this.group);
  }

  // Split instances by area cell. Returns, per input matrix, [mesh, index in that mesh].
  chunked(geo, mat, matrices, { cast = true, receive = true, maxDist = 900, shadowDist = 260, cell = CHUNK, colors = null } = {}) {
    const cells = new Map();
    matrices.forEach((m, i) => {
      const k = Math.floor(m.elements[12] / cell) * 4096 + Math.floor(m.elements[14] / cell);
      let c = cells.get(k);
      if (!c) cells.set(k, (c = []));
      c.push(i);
    });
    const lookup = new Array(matrices.length);
    for (const list of cells.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((i, k) => {
        im.setMatrixAt(k, matrices[i]);
        if (colors) im.setColorAt(k, colors[i]);
        lookup[i] = [im, k];
      });
      im.count = list.length;
      im.castShadow = cast;
      im.receiveShadow = receive;
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      this.group.add(im);
      const b = im.boundingSphere;
      this.chunks.push({ mesh: im, x: b.center.x, z: b.center.z, r: b.radius, maxDist, shadowDist, cast });
    }
    return lookup;
  }

  // ------------------------------------------------------------------ festival
  buildFestival() {
    const F = LOCATIONS.festival;
    const y0 = this.h(F.x, F.z);
    const G = new THREE.Group();
    G.position.set(F.x, y0, F.z);
    this.group.add(G);
    this.festival = G;
    const col = this.game.collision;
    const A = this.archMaterials;
    const metal = A.aluminum;
    const black = A.charcoal;
    const white = std(0xe3e1d8, { roughness: 0.6 });
    const pink = std(0x9f2853, { roughness: 0.63 });
    const details = detailBatch(G);
    // --- main stage (north side, facing south)
    const stage = new THREE.Group();
    stage.position.set(0, 0, -62);
    G.add(stage);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(34, 1.6, 14), black);
    deck.position.set(0, 0.8, 0);
    stage.add(deck);
    // Real four-chord aluminum trusses, with diagonal bracing at human scale.
    const trussGeo = [];
    for (const sx of [-16, 16])
      for (const sz of [-6.5, 6.5]) lattice(trussGeo, [sx, 1.6, sz], [sx, 16, sz]);
    for (const sz of [-6.5, 6.5]) lattice(trussGeo, [-16, 16, sz], [16, 16, sz], .7);
    for (const sx of [-16, 0, 16]) lattice(trussGeo, [sx, 16, -6.5], [sx, 16, 6.5], .7);
    mergedParts(stage, trussGeo, metal);
    // roof canopy
    const roof = new THREE.Mesh(new THREE.BoxGeometry(34, 0.4, 14.5), std(0x16161c));
    roof.position.y = 16.6;
    roof.castShadow = true;
    stage.add(roof);
    const stageDetail = detailBatch(stage);
    // Modular deck edge, access steps, hanging line arrays, and stage equipment.
    for (let x = -16; x < 17; x += 2) stageDetail.box(metal, x, 1.56, 7.025, 1.95, .07, .07);
    for (let step = 0; step < 5; step++) stageDetail.box(black, -13.7, .16 + step * .15, 8.8 - step * .4, 3.6, .32 + step * .3, .45);
    for (const sx of [-1, 1]) {
      stageDetail.box(black, sx * 12.7, 1.94, 4.2, 2.2, .66, 1.05);
      for (let k = 0; k < 6; k++) {
        stageDetail.box(black, sx * 13.7, 13.8 - k * .64, 5.8 + k * k * .013, 1.3, .58, 1.05);
        stageDetail.box(metal, sx * 13.7, 13.7 - k * .64, 6.34 + k * k * .013, 1.14, .04, .025);
      }
    }
    stageDetail.box(black, 0, 2.3, -1, 4.8, 1.4, 1.8);
    stageDetail.box(metal, 0, 3.04, -1, 4.85, .08, 1.84);
    stageDetail.flush();
    // LED wall
    this.ledMat = new THREE.ShaderMaterial({ uniforms: { time: atmo.time }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: ledFrag, toneMapped: false });
    const led = new THREE.Mesh(new THREE.PlaneGeometry(26, 10.5), this.ledMat);
    led.position.set(0, 8.4, -6);
    stage.add(led);
    // speaker stacks
    for (const sx of [-19.5, 19.5]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 4), black);
      sp.position.set(sx, 6, 2);
      sp.castShadow = true;
      stage.add(sp);
      // Recessed driver grilles and cabinet seams make the towers legible.
      const speakerParts = [];
      for (let k = 0; k < 6; k++) {
        const driver = new THREE.CylinderGeometry(.62, .62, .06, 20);
        driver.rotateX(Math.PI / 2);
        driver.translate(sx, 1 + k * 1.85, 4.04);
        speakerParts.push(driver);
      }
      mergedParts(stage, speakerParts, std(0x161b1e, { roughness: .92 }));
      col.addBox(F.x + sx, F.z - 62 + 2, 2, 2, 0, y0, y0 + 12, 'building');
    }
    col.addBox(F.x, F.z - 62, 17, 7, 0, y0, y0 + 17, 'building');
    // stage lights (emissive spots) on the front truss
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x77726b, emissive: 0xffcbb0, emissiveIntensity: .25 });
    this.nightMats.push({ mat: lampMat, day: .2, night: 4 });
    const lampGeo = new THREE.CylinderGeometry(0.35, 0.5, 0.8, 10);
    const lamps = [];
    for (let k = -7; k <= 7; k++) lamps.push(mat4(k * 2.1, 15.3, 6.6));
    stage.add(instanced(lampGeo, lampMat, lamps, { cast: false }));
    // --- welcome arch over the south entrance
    const arch = new THREE.Group();
    arch.position.set(20, 0, F.r - 6);
    G.add(arch);
    for (const sx of [-13, 13]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(1.6, 12, 1.6), black);
      pil.position.set(sx, 6, 0);
      pil.castShadow = true;
      arch.add(pil);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(.18, 10.8, 1.63), pink);
      stripe.position.set(sx - Math.sign(sx) * .54, 6, 0);
      arch.add(stripe);
      col.addBox(F.x + 20 + sx, F.z + F.r - 6, 0.8, 0.8, 0, y0, y0 + 12, 'building');
    }
    const signTex = makeTextTexture(`${GAME_TITLE} ISLA FESTIVAL`, { w: 1024, h: 160, bg: '#24272c', fg: '#f4f0e7', font: '800 italic 104px "Barlow Condensed", sans-serif' });
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.6 });
    this.nightMats.push({ mat: signMat, day: .12, night: 1.3 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(28, 4.4, 0.6), [black, black, black, black, signMat, signMat]);
    sign.position.y = 12.5;
    sign.castShadow = true;
    arch.add(sign);
    // --- ferris wheel (east side)
    const fw = new THREE.Group();
    fw.position.set(78, 0, -20);
    fw.rotation.y = Math.PI / 2 - 0.4;
    G.add(fw);
    const R = 22;
    const hub = 25;
    const legGeo = [];
    for (const sz of [-3, 3])
      for (const sx of [-1, 1]) {
        lattice(legGeo, [sx * 8, .3, sz], [0, hub, sz], .65, 3);
        const footing = new THREE.BoxGeometry(2.1, .6, 1.8);
        footing.translate(sx * 8, .3, sz);
        legGeo.push(footing);
      }
    mergedParts(fw, legGeo, white);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(.65, .65, 7.4, 16), metal);
    axle.rotation.x = Math.PI / 2;
    axle.position.y = hub;
    fw.add(axle);
    col.addCircle(F.x + 78 + Math.cos(0.4) * 0, F.z - 20, 4, y0, y0 + 30, 'building');
    const wheel = new THREE.Group();
    wheel.position.y = hub;
    fw.add(wheel);
    const rimMat = std(0xffffff, { roughness: 0.4, metalness: 0.4 });
    for (const sz of [-2.6, 2.6]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 64), rimMat);
      rim.position.z = sz;
      rim.castShadow = true;
      wheel.add(rim);
    }
    const spokes = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const sz of [-2.6, 2.6]) {
        const g = new THREE.BoxGeometry(0.25, R, 0.25);
        g.translate(0, R / 2, sz);
        g.rotateZ(a);
        spokes.push(g);
      }
      spokes.push(tubeBetween([Math.cos(a) * R, Math.sin(a) * R, -2.6], [Math.cos(a) * R, Math.sin(a) * R, 2.6], .12));
    }
    mergedParts(wheel, spokes, rimMat);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc8f0, emissiveIntensity: 1.5 });
    this.nightMats.push({ mat: bulbMat, day: .08, night: 4 });
    const bulbs = [];
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      bulbs.push(mat4(Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45), 2.9));
      bulbs.push(mat4(Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45), -2.9));
    }
    wheel.add(instanced(new THREE.SphereGeometry(0.22, 6, 4), bulbMat, bulbs, { cast: false }));
    const gondolas = [];
    const gcols = [0x9f2853, 0xded8c8, 0x446c72, 0xb8884e].map(color => std(color, { roughness: .45, metalness: .25 }));
    const cabinFrameParts = [];
    cabinFrameParts.push(new THREE.BoxGeometry(2.65, .18, 3.65).translate(0, -.79, 0));
    cabinFrameParts.push(new THREE.BoxGeometry(2.5, .14, 3.5).translate(0, -2.65, 0));
    for (const x of [-1.12, 1.12]) for (const z of [-1.62, 1.62]) cabinFrameParts.push(new THREE.BoxGeometry(.075, 1.46, .075).translate(x, -1.48, z));
    for (const x of [-1.13, 1.13]) cabinFrameParts.push(new THREE.BoxGeometry(.07, 1.46, .07).translate(x, -1.48, 0));
    cabinFrameParts.push(tubeBetween([0, .12, 0], [0, -.72, 0], .075));
    const cabinFrames = mergeGeometries(cabinFrameParts);
    cabinFrameParts.forEach(geometry => geometry.dispose());
    const cabinBody = new THREE.BoxGeometry(2.4, .58, 3.4).translate(0, -2.32, 0);
    const cabinGlass = new THREE.BoxGeometry(2.22, 1.2, 3.21).translate(0, -1.46, 0);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const gnd = new THREE.Mesh(cabinBody, gcols[k % 4]);
      gnd.castShadow = true;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      pivot.add(gnd, new THREE.Mesh(cabinFrames, white), new THREE.Mesh(cabinGlass, A.glazing));
      wheel.add(pivot);
      gondolas.push(pivot);
    }
    this.animated.push((dt) => {
      wheel.rotation.z += dt * 0.06;
      for (const g of gondolas) g.rotation.z = -wheel.rotation.z;
    });
    // --- tents
    const tentCols = [0x9f2853, 0x596b67, 0xb08d53, 0x526c7c];
    const rnd = mulberry32(7);
    const tentGeo = tentMembrane();
    const tentTemplate = new THREE.Group();
    const membrane = new THREE.Mesh(tentGeo, A.fabric);
    membrane.castShadow = true;
    membrane.receiveShadow = true;
    tentTemplate.add(membrane);
    const tentFrame = [], tentSeams = [], tentDeck = [], tentCanvas = [];
    for (const x of [-4.1, 4.1]) for (const z of [-4.1, 4.1]) {
      tentFrame.push(tubeBetween([x, .1, z], [x, 3.74, z], .067, 8));
      tentDeck.push(new THREE.BoxGeometry(.34, .1, .34).translate(x, .05, z));
      for (let k = 0; k < 16; k++) {
        const a = k / 16, b = (k + 1) / 16;
        tentSeams.push(tubeBetween([x * a, 3.7 + 3.5 * (1 - a) ** 1.65 + .016, z * a], [x * b, 3.7 + 3.5 * (1 - b) ** 1.65 + .016, z * b], .024));
      }
    }
    for (const side of [-1, 1]) {
      tentFrame.push(tubeBetween([-4.1, 3.42, side * 4.1], [4.1, 3.42, side * 4.1], .045));
      tentFrame.push(tubeBetween([side * 4.1, 3.42, -4.1], [side * 4.1, 3.42, 4.1], .045));
      tentFrame.push(tubeBetween([side * 4.1, 2.7, 3.9], [side * 3.4, 3.42, 3.9], .033));
      tentCanvas.push(new THREE.BoxGeometry(.035, 2.96, 7.95).translate(side * 4.05, 1.73, -.04));
      tentCanvas.push(new THREE.BoxGeometry(.035, .29, 8.24).translate(side * 4.1, 3.34, 0));
      tentCanvas.push(new THREE.BoxGeometry(8.24, .29, .035).translate(0, 3.34, side * 4.1));
    }
    tentCanvas.push(new THREE.BoxGeometry(8.1, 2.96, .035).translate(0, 1.73, -4.05));
    tentDeck.push(new THREE.BoxGeometry(8.2, .18, 8.2).translate(0, .11, 0));
    tentDeck.push(new THREE.BoxGeometry(6.7, .12, .9).translate(0, 1.17, 2.65));
    tentDeck.push(new THREE.BoxGeometry(6.5, .89, .08).translate(0, .67, 2.95));
    tentFrame.push(new THREE.BoxGeometry(.07, .97, .65).translate(-3.12, .67, 2.65));
    tentFrame.push(new THREE.BoxGeometry(.07, .97, .65).translate(3.12, .67, 2.65));
    mergedParts(tentTemplate, tentFrame, metal);
    mergedParts(tentTemplate, tentSeams, white, false);
    mergedParts(tentTemplate, tentDeck, A.wood);
    mergedParts(tentTemplate, tentCanvas, A.fabric);
    const tents = [];
    for (let k = 0; k < 7; k++) {
      const a = -0.3 + (k / 7) * Math.PI * 1.2 + Math.PI * 0.55;
      const r = F.r - 22 + rnd() * 6;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      tents.push([x, z]);
      const t = new THREE.Group();
      t.position.set(x, 0, z);
      t.rotation.y = Math.atan2(-x, -z);
      const c1 = tentCols[k % tentCols.length];
      t.add(tentTemplate.clone(true));
      const trim = new THREE.Mesh(new THREE.BoxGeometry(8.22, .13, .075), std(c1));
      trim.position.set(0, 3.25, 4.115);
      t.add(trim);
      const labelTex = makeTextTexture(['DRIVERS CLUB', 'ISLA COFFEE', 'RACE SUPPORT', 'FESTIVAL STORE'][k % 4], { w: 512, h: 96, bg: '#ede9dc', fg: '#3d4241', font: '600 42px "Barlow Condensed", sans-serif' });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(3.8, .72), new THREE.MeshStandardMaterial({ map: labelTex, roughness: .9 }));
      label.position.set(0, 2.77, -3.98);
      t.add(label);
      G.add(t);
      col.addCircle(F.x + x, F.z + z, 6, y0, y0 + 9, 'building');
    }
    // --- flags around the plaza
    const flagGeo = new THREE.PlaneGeometry(1.8, 3.2, 8, 1);
    flagGeo.translate(0.9, 0, 0);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8, vertexColors: false });
    flagMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = atmo.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3][0] * 0.3 + instanceMatrix[3][2] * 0.2;
        transformed.z += sin( uTime * 4.0 + transformed.x * 2.5 + ph ) * 0.25 * transformed.x;`
      );
    };
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 9, 6);
    poleGeo.translate(0, 4.5, 0);
    const flagM = [],
      poleM = [];
    const flagCols = [0xa92e59, 0xe5e0d2, 0xe5e0d2, 0x607c79, 0xd7c7ac];
    const flagInst = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const r = F.r - 3;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      poleM.push(mat4(x, 0, z));
      flagM.push(mat4(x, 7.2, z, (k * 0.9) % 6));
      flagInst.push(flagCols[k % flagCols.length]);
    }
    G.add(instanced(poleGeo, metal, poleM));
    const fl = instanced(flagGeo, flagMat, flagM);
    flagInst.forEach((c, i) => fl.setColorAt(i, new THREE.Color(c)));
    G.add(fl);
    // --- hero car turntable in the plaza centre
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 0.5, 48), std(0x121216, { metalness: 0.6, roughness: 0.25 }));
    plat.position.set(-30, 0.25, 10);
    plat.receiveShadow = true;
    G.add(plat);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x752140, emissive: 0xd94778, emissiveIntensity: .3, metalness: .4, roughness: .32 });
    this.nightMats.push({ mat: ringMat, day: .15, night: 2.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.045, 6, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-30, 0.52, 10);
    G.add(ring);
    const turntableJoints = [];
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12;
      turntableJoints.push(tubeBetween([-30 + Math.sin(a) * 5.8, .505, 10 + Math.cos(a) * 5.8], [-30 + Math.sin(a) * 6, .505, 10 + Math.cos(a) * 6], .014));
    }
    mergedParts(G, turntableJoints, metal, false);
    // Crash barriers sit beside the stage, leaving all existing driving lanes open.
    for (const side of [-1, 1]) for (let k = 0; k < 5; k++) {
      const x = side * (24 + k * 3.1), z = -47;
      details.box(A.stone, x, .33, z, 2.9, .66, .72);
      details.box(white, x, .94, z, 2.9, .57, .32);
      details.box(pink, x, .94, z + .168, .2, .52, .015);
    }
    col.addCircle(F.x - 30, F.z + 10, 6.2, y0, y0 + 2, 'building');
    this.turntable = { x: F.x - 30, y: y0 + 0.5, z: F.z + 10, group: null };
    // --- light towers (beams at night)
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff66cc, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamGeo = new THREE.ConeGeometry(4, 90, 16, 1, true);
    beamGeo.translate(0, -45, 0);
    beamGeo.rotateX(Math.PI);
    const beams = [];
    for (const [bx, bz] of [
      [-40, -40],
      [40, -45],
      [-60, 40],
      [55, 55],
    ]) {
      const b = new THREE.Mesh(beamGeo, beamMat);
      b.position.set(bx, 2, bz);
      G.add(b);
      beams.push(b);
    }
    this.beamMat = beamMat;
    this.animated.push((dt, t) => {
      beams.forEach((b, i) => {
        b.rotation.z = Math.sin(t * 0.5 + i) * 0.45;
        b.rotation.x = Math.cos(t * 0.37 + i * 2) * 0.35;
      });
    });
    this.festivalParking = { x: F.x - 20, z: F.z + 30 };
    details.flush();
  }

  // ------------------------------------------------------------------ town
  buildTown() {
    const T = LOCATIONS.town;
    const rnd = mulberry32(99);
    const wallCols = [0xd6c5a4, 0xc49d8d, 0xabb9ab, 0xe2dac8, 0xc3ab79, 0xbe997d, 0xb9bca5, 0xa5b6bd];
    const A = this.archMaterials;
    const byStyle = new Map();
    const col = this.game.collision;
    const streets = [
      { axis: 'x', c: T.z - 110 },
      { axis: 'x', c: T.z + 110 },
      { axis: 'z', c: T.x - 110 },
      { axis: 'z', c: T.x + 110 },
    ];
    // reject if any footprint corner (or the centre) is on or right next to a road
    const tooClose = (x, z, hw, hd) => {
      for (const [cx, cz] of [
        [x, z],
        [x - hw, z - hd],
        [x + hw, z - hd],
        [x - hw, z + hd],
        [x + hw, z + hd],
        [x, z - hd],
        [x, z + hd],
        [x - hw, z],
        [x + hw, z],
      ]) {
        const near = this.world.network.nearest(cx, cz, 30);
        if (near && near.dist < near.road.width / 2 + 2.5) return true;
      }
      return false;
    };
    const placed = [];
    for (const s of streets) {
      for (let t = -150; t <= 150; t += 15) {
        for (const side of [-1, 1]) {
          const w = 9 + rnd() * 6,
            d = 9 + rnd() * 5,
            hgt = 6.4 + Math.floor(rnd() * 3) * 3.2 + (rnd() < 0.1 ? 3.2 : 0);
          const off = 5 + 3.5 + d / 2;
          const x = s.axis === 'x' ? T.x + t : s.c + side * off;
          const z = s.axis === 'x' ? s.c + side * off : T.z + t;
          const hw = s.axis === 'x' ? w / 2 : d / 2,
            hd = s.axis === 'x' ? d / 2 : w / 2;
          if (tooClose(x, z, hw, hd)) continue;
          if (placed.some((p) => Math.abs(p.x - x) < p.hw + hw + 1 && Math.abs(p.z - z) < p.hd + hd + 1)) continue;
          if (rnd() < 0.12) continue;
          placed.push({ x, z, hw, hd, hgt, style: Math.floor(rnd() * 4), col: wallCols[Math.floor(rnd() * wallCols.length)], frontAxis: s.axis === 'x' ? 'z' : 'x', frontSign: -side });
        }
      }
    }
    for (const b of placed) {
      const y = Math.min(this.h(b.x - b.hw, b.z - b.hd), this.h(b.x + b.hw, b.z + b.hd), this.h(b.x, b.z)) - 0.5;
      if (!byStyle.has(b.style)) byStyle.set(b.style, []);
      byStyle.get(b.style).push({ ...b, y });
      col.addBox(b.x, b.z, b.hw, b.hd, 0, y, y + b.hgt + 1, 'building');
    }
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    // the whole town's trim is one cell per material: drawn together, dropped together
    const townDetails = detailBatch(this.group, (g, m, list) => this.chunked(g, m, list, { maxDist: 700, shadowDist: 260, cell: 100000 }));
    const roofParts = [];
    const shopSigns = ['CAFÉ ISLA', 'MERCADO', 'TALLER', 'CASA DEL SOL'].map((label, i) => new THREE.MeshStandardMaterial({
      map: makeTextTexture(label, { w: 512, h: 96, bg: ['#e1d6be', '#405d58', '#344148', '#b6a084'][i], fg: i === 0 ? '#42443a' : '#eae6db', font: '600 54px "Barlow Condensed", sans-serif' }), roughness: .84,
    }));
    this.nightMats.push({ mat: A.warmGlass, day: 0, night: .95 });
    // Plaster uses world-space metre UVs, while openings are actual inset surfaces
    // with protruding frames, sills and shutters that respond to the sunlight.
    for (const [style, list] of byStyle) {
      const mat = A.plaster.clone();
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBP;\nvarying vec3 vBN;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 bw = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );\nvBP = bw.xyz;\nvBN = normalize( mat3( modelMatrix * instanceMatrix ) * normal );');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBP;\nvarying vec3 vBN;')
          .replace(
            '#include <map_fragment>',
            `vec2 fuv = abs( vBN.x ) > 0.5 ? vec2( vBP.z, vBP.y ) : vec2( vBP.x, vBP.y );
             vec4 fc = texture2D( map, fuv * 0.55 );
             diffuseColor *= fc;`
          );
      };
      // Bump UVs on the unit box would stretch differently on each instance;
      // its fine plaster colour variation and the real relief do the work here.
      mat.bumpMap = null;
      const mats = list.map((b) => mat4(b.x, b.y, b.z, 0, b.hw * 2, b.hgt + .15, b.hd * 2));
      const im = instanced(boxGeo, mat, mats);
      list.forEach((b, i) => im.setColorAt(i, new THREE.Color(b.col)));
      this.group.add(im);
      for (const b of list) {
        townDetails.box(A.stone, b.x, b.y + .28, b.z, b.hw * 2 + .04, .56, b.hd * 2 + .04);
        // Shallow hipped roofs retain the exact existing collision height.
        const roof = hippedRoof(b.hw + .18, b.hd + .18, .8);
        roof.translate(b.x, b.y + b.hgt + .16, b.z);
        roofParts.push(roof);
        townDetails.box(A.trim, b.x, b.y + b.hgt + .08, b.z, b.hw * 2 + .26, .17, b.hd * 2 + .26);
        townDetails.box(A.tile, b.x, b.y + b.hgt + .96, b.z, b.hw * 1.12, .09, .22);
        // Every facade has regular bays and storeys; the street-facing middle bay
        // gets a ground-level door. A few panes glow independently at night.
        const faces = [
          { axis: 'z', sign: 1, yaw: 0, half: b.hw, depth: b.hd },
          { axis: 'z', sign: -1, yaw: Math.PI, half: b.hw, depth: b.hd },
          { axis: 'x', sign: 1, yaw: Math.PI / 2, half: b.hd, depth: b.hw },
          { axis: 'x', sign: -1, yaw: -Math.PI / 2, half: b.hd, depth: b.hw },
        ];
        for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
          const f = faces[faceIndex];
          const cos = Math.cos(f.yaw), sin = Math.sin(f.yaw);
          const faceBox = (material, x, y, out, w, h, d) => townDetails.box(material, b.x + x * cos + (f.depth + out) * sin, b.y + y, b.z - x * sin + (f.depth + out) * cos, w, h, d, f.yaw);
          const bays = Math.max(2, Math.floor(f.half * 2 / 2.8));
          const bayWidth = f.half * 2 / bays;
          const floors = Math.floor(b.hgt / 3.2);
          const streetFront = f.axis === b.frontAxis && f.sign === b.frontSign;
          if (streetFront) {
            // The generated facade is 3.5 m back from the carriageway. Keep the
            // whole footway inside that existing setback, with no road blocker.
            const slabs = Math.ceil(f.half * 2 / 1.16);
            const slabWidth = f.half * 2 / slabs;
            for (let slab = 0; slab < slabs; slab++) {
              const sx = -f.half + (slab + .5) * slabWidth;
              for (let row = 0; row < 2; row++) {
                const out = .73 + row * 1.4;
                const wx = b.x + sx * cos + (f.depth + out) * sin;
                const wz = b.z - sx * sin + (f.depth + out) * cos;
                townDetails.box(A.trim, wx, this.h(wx, wz) + .05, wz, slabWidth - .014, .1, 1.385, f.yaw);
              }
              const out = 2.9;
              const wx = b.x + sx * cos + (f.depth + out) * sin;
              const wz = b.z - sx * sin + (f.depth + out) * cos;
              townDetails.box(A.stone, wx, this.h(wx, wz) + .07, wz, slabWidth - .018, .14, .2, f.yaw);
            }
          }
          faceBox(A.trim, 0, 3.18, .055, f.half * 2 + .1, .15, .12);
          for (const edge of [-1, 1]) faceBox(A.trim, edge * (f.half - .13), b.hgt * .5, .025, .22, b.hgt - .15, .065);
          for (let floor = 0; floor < floors; floor++) for (let bay = 0; bay < bays; bay++) {
            const x = (bay + .5) * bayWidth - f.half;
            const isDoor = floor === 0 && streetFront && bay === Math.floor(bays / 2);
            const width = isDoor ? 1.42 : 1.15 + (style === 1 ? .18 : 0);
            const height = isDoor ? 2.3 : 1.65;
            const y = isDoor ? 1.42 : floor * 3.2 + 1.93;
            const glazing = (bay + floor * 3 + faceIndex * 5 + Math.round(b.x)) % 7 === 0 ? A.warmGlass : A.glazing;
            faceBox(isDoor ? A.wood : A.charcoal, x, y, .022, width + .2, height + .2, .055);
            faceBox(isDoor ? A.glazing : glazing, x, y + (isDoor ? .32 : 0), .058, width - .09, isDoor ? 1.35 : height - .06, .028);
            faceBox(A.trim, x - width * .5 - .035, y, .084, .11, height + .27, .14);
            faceBox(A.trim, x + width * .5 + .035, y, .084, .11, height + .27, .14);
            faceBox(A.trim, x, y + height * .5 + .055, .09, width + .26, .14, .18);
            faceBox(A.trim, x, y - height * .5 - .035, .13, width + .34, .14, .25);
            faceBox(A.wood, x, y, .091, .045, height, .042);
            if (!isDoor) faceBox(A.wood, x, y + .13, .091, width, .045, .042);
            if (isDoor) {
              faceBox(A.aluminum, x + .34, 1.18, .105, .035, .28, .055);
              faceBox(A.stone, x, .16, .18, width + .42, .19, .37);
              const awning = style % 2 === 0;
              if (awning) {
                faceBox(A.shutter, x, 2.84, .4, width + .74, .1, .85);
                faceBox(A.shutter, x, 2.67, .8, width + .74, .25, .04);
              }
              faceBox(shopSigns[Math.abs(Math.floor(b.x + b.z)) % shopSigns.length], x, 3.02, .095, width + .3, .36, .055);
            } else if (style === 2 || style === 3) {
              for (const side of [-1, 1]) {
                const shutterX = x + side * (width * .5 + .32);
                faceBox(A.shutter, shutterX, y, .085, .43, height + .06, .09);
                for (let slat = 0; slat < 6; slat++) faceBox(A.charcoal, shutterX, y - .65 + slat * .26, .137, .33, .019, .022);
              }
            }
            if (streetFront && floor === 1 && bay === Math.floor(bays / 2) && style < 2) {
              const balconyY = y - height * .5 - .14;
              faceBox(A.stone, x, balconyY, .34, width + .48, .14, .72);
              faceBox(A.charcoal, x, balconyY + .92, .68, width + .42, .045, .04);
              faceBox(A.charcoal, x, balconyY + .15, .68, width + .42, .04, .04);
              for (let bar = 0; bar < 7; bar++) faceBox(A.charcoal, x - (width + .35) / 2 + bar * (width + .35) / 6, balconyY + .54, .68, .025, .78, .025);
              for (const side of [-1, 1]) {
                faceBox(A.charcoal, x + side * (width + .42) / 2, balconyY + .92, .37, .04, .045, .65);
                faceBox(A.charcoal, x + side * (width + .42) / 2, balconyY + .54, .05, .035, .78, .035);
              }
            }
          }
          // Copper-grey rainwater downpipes and elbows complete the roof edge.
          faceBox(A.aluminum, f.half - .3, b.hgt * .5, .16, .075, b.hgt, .075);
          faceBox(A.charcoal, 0, b.hgt + .12, .13, f.half * 2, .1, .12);
        }
      }
    }
    townDetails.flush();
    mergedParts(this.group, roofParts, A.tile);
    // clock tower at the town centre (north of the highway)
    const tx = T.x - 40,
      tz = T.z - 55;
    const ty = this.h(tx, tz) - 0.5;
    const tower = new THREE.Group();
    tower.position.set(tx, ty, tz);
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 26, 7), A.plaster);
    body.position.y = 13;
    body.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(5.6, 8, 4), A.tile);
    cap.position.y = 30;
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    const clockTex = makeClockTexture();
    const towerDetail = detailBatch(tower);
    for (const y of [.4, 16.8, 25.5]) towerDetail.box(A.trim, 0, y, 0, 7.35, .32, 7.35);
    for (const x of [-3.25, 3.25]) for (const z of [-3.25, 3.25]) towerDetail.box(A.trim, x, 13, z, .4, 25.5, .4);
    towerDetail.flush();
    for (let k = 0; k < 4; k++) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshStandardMaterial({ map: clockTex }));
      face.position.set(Math.sin((k * Math.PI) / 2) * 3.52, 21, Math.cos((k * Math.PI) / 2) * 3.52);
      face.rotation.y = (k * Math.PI) / 2;
      tower.add(face);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(2.2, .13, 8, 48), A.trim);
      bezel.position.copy(face.position);
      bezel.rotation.copy(face.rotation);
      tower.add(bezel);
      const window = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.8, .06), A.glazing);
      window.position.set(Math.sin(k * Math.PI / 2) * 3.54, 10.5, Math.cos(k * Math.PI / 2) * 3.54);
      window.rotation.y = k * Math.PI / 2;
      tower.add(window);
    }
    tower.add(body, cap);
    this.group.add(tower);
    col.addBox(tx, tz, 3.5, 3.5, 0, ty, ty + 34, 'building');
  }

  // ------------------------------------------------------------------ airfield
  buildAirfield(AF) {
    if (!AF) return;
    const c = Math.cos(AF.angle),
      s = Math.sin(AF.angle);
    const col = this.game.collision;
    const hangarMat = std(0xb8bcc2, { metalness: 0.6, roughness: 0.45 });
    const roofMat = std(0x8a9096, { metalness: 0.7, roughness: 0.35 });
    const A = this.archMaterials;
    for (let k = -1; k <= 1; k++) {
      const u = k * 70,
        v = -AF.w / 2 - 40;
      const x = AF.x + c * u - s * v,
        z = AF.z + s * u + c * v;
      const y = this.h(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = -AF.angle;
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 40, 24, 1, false, 0, Math.PI), roofMat);
      hull.rotation.z = Math.PI / 2;
      hull.rotation.y = Math.PI / 2;
      hull.position.y = 0;
      hull.castShadow = true;
      const front = new THREE.Mesh(new THREE.CircleGeometry(14, 24, 0, Math.PI), hangarMat);
      front.position.set(0, 0, 20.01);
      g.add(hull, front);
      const ribs = [];
      for (let rib = -19.5; rib <= 20; rib += 1.5) {
        const geometry = new THREE.TorusGeometry(14.035, .055, 4, 32, Math.PI);
        geometry.translate(0, 0, rib);
        ribs.push(geometry);
      }
      mergedParts(g, ribs, A.aluminum);
      const hangarDetails = detailBatch(g);
      hangarDetails.box(A.charcoal, 0, 4.6, 20.065, 20.6, 9.2, .08);
      for (let door = -4; door <= 4; door++) {
        hangarDetails.box(hangarMat, door * 2.2, 4.5, 20.14, 2.15, 8.8, .1);
        hangarDetails.box(A.glazing, door * 2.2, 6.6, 20.205, 1.88, 1.05, .035);
        for (let panel = 1; panel < 6; panel++) hangarDetails.box(A.aluminum, door * 2.2, panel * 1.42, 20.205, 2.12, .045, .045);
      }
      hangarDetails.box(A.charcoal, 0, 9.2, 20.24, 21.1, .18, .4);
      hangarDetails.box(A.stone, 0, .12, 20.28, 21, .24, .55);
      hangarDetails.flush();
      const hangarLabel = new THREE.Mesh(new THREE.PlaneGeometry(5, .8), new THREE.MeshStandardMaterial({ map: makeTextTexture(`ISLA AIR  /  0${k + 2}`, { w: 512, h: 96, bg: '#899093', fg: '#243038', font: '600 48px sans-serif' }), roughness: .75 }));
      hangarLabel.position.set(0, 11, 20.05);
      g.add(hangarLabel);
      this.group.add(g);
      col.addBox(x, z, 20, 14, AF.angle + Math.PI / 2, y, y + 14, 'building');
    }
    // control tower
    const u = 160,
      v = -AF.w / 2 - 35;
    const x = AF.x + c * u - s * v,
      z = AF.z + s * u + c * v;
    const y = this.h(x, z);
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 18, 12), std(0xefefef));
    tw.position.set(x, y + 9, z);
    tw.castShadow = true;
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.6, 3.6, 12), new THREE.MeshPhysicalMaterial({ color: 0x223344, metalness: 0.2, roughness: 0.05 }));
    cab.position.set(x, y + 19.8, z);
    const capm = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.6, 12), std(0x333333));
    capm.position.set(x, y + 21.9, z);
    this.group.add(tw, cab, capm);
    col.addCircle(x, z, 3.2, y, y + 22, 'building');
    // runway threshold stripes
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const stripes = [];
    for (const end of [-1, 1]) {
      const u0 = end * (AF.len / 2 - 50);
      for (let k = -5; k <= 5; k++) {
        if (k === 0) continue;
        const vv = k * 2.6;
        const sx = AF.x + c * u0 - s * vv,
          sz = AF.z + s * u0 + c * vv;
        stripes.push(mat4(sx, this.h(sx, sz) + 0.08, sz, -AF.angle + Math.PI / 2, 1.2, 1, 20));
      }
    }
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.group.add(instanced(sg, stripeMat, stripes, { cast: false }));
  }

  // ------------------------------------------------------------------ roadside
  buildLamps(all) {
    // San Francisco streets carry their own fixtures (city-street.js); only their
    // night light pools are added here.
    const net = this.world.network, lamps = [];
    for (let i = 0; i < all.length; i += 4) if (!net.nearest(all[i], all[i + 2], 12)?.road.city && cityMask(all[i], all[i + 2]) < .55) lamps.push(all[i], all[i + 1], all[i + 2], all[i + 3]);
    const n = lamps.length / 4, city = this.cityLamps || [];
    if (!n) return;
    const pole = new THREE.CylinderGeometry(0.09, 0.14, 8, 6);
    pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 2.2);
    arm.translate(0, 7.9, 1.0);
    const metalGeo = mergeGeometries([pole, arm]);
    const head = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    head.translate(0, 7.8, 2.0);
    const pm = [];
    for (let i = 0; i < n; i++) pm.push(mat4(lamps[i * 4], lamps[i * 4 + 1], lamps[i * 4 + 2], lamps[i * 4 + 3]));
    this.chunked(metalGeo, std(0x3c3f45, { metalness: 0.7, roughness: 0.4 }), pm, { maxDist: 900 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffd9a0, emissiveIntensity: 0 });
    this.nightMats.push({ mat: headMat, day: 0, night: 12 });
    // lamp heads glow at night, so they stay visible further out
    this.chunked(head, headMat, pm, { cast: false, maxDist: 1800 });
    // light pools on the road at night
    const poolTex = makeGlow();
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.poolMat = poolMat;
    const pg = new THREE.PlaneGeometry(14, 14);
    pg.rotateX(-Math.PI / 2);
    const pools = [];
    for (const list of [lamps, city]) for (let i = 0; i < list.length; i += 4) {
      const r = list[i + 3];
      const x = list[i] + Math.sin(r) * 2.2,
        z = list[i + 2] + Math.cos(r) * 2.2;
      pools.push(mat4(x, this.h(x, z) + 0.12, z));
    }
    this.chunked(pg, poolMat, pools, { cast: false, receive: false, maxDist: 700 });
    const col = this.game.collision;
    for (let i = 0; i < n; i++) col.addCircle(lamps[i * 4], lamps[i * 4 + 2], 0.2, lamps[i * 4 + 1], lamps[i * 4 + 1] + 8, 'pole');
  }

  buildRails(rails) {
    const n = rails.length / 6;
    if (!n) return;
    const profile = new THREE.Shape();
    // Rolled W-section guardrail catches two narrow highlights, like steel road
    // barriers, instead of reading as a solid square fence beam.
    [[0, .45], [.04, .49], [.075, .53], [.018, .59], [.018, .65], [.075, .71], [.04, .76], [0, .79], [-.017, .775], [.021, .744], [.052, .706], [-.002, .654], [-.002, .586], [.052, .534], [.021, .507], [-.017, .467]].forEach(([x, y], i) => i ? profile.lineTo(x, y) : profile.moveTo(x, y));
    profile.closePath();
    const beam = new THREE.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, steps: 1 });
    beam.translate(0, 0, -.5);
    const post = new THREE.BoxGeometry(0.12, 0.8, 0.12);
    post.translate(0, 0.4, 0);
    const bm = [],
      pm = [];
    const col = this.game.collision;
    for (let i = 0; i < n; i++) {
      const x1 = rails[i * 6],
        y1 = rails[i * 6 + 1],
        z1 = rails[i * 6 + 2],
        x2 = rails[i * 6 + 3],
        y2 = rails[i * 6 + 4],
        z2 = rails[i * 6 + 5];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const yaw = Math.atan2(x2 - x1, z2 - z1);
      const m = new THREE.Matrix4().compose(new THREE.Vector3((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(y2 - y1, len), yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, len + 0.05));
      bm.push(m);
      pm.push(mat4(x1, y1, z1, yaw));
      col.addSegment(x1, z1, x2, z2, 0.25, Math.min(y1, y2) - 1, Math.max(y1, y2) + 1.0, 'rail');
    }
    const railMat = std(0xb9bec4, { metalness: 0.85, roughness: 0.35 });
    this.chunked(beam, railMat, bm, { maxDist: 700 });
    this.chunked(post, std(0x5a5d62, { metalness: 0.6 }), pm, { maxDist: 450 });
  }

  // Delineator posts: white, a black band and a reflector on each face along the road
  // (it catches headlights at night). They fold flat when hit and stand up again later.
  buildPosts(posts) {
    const n = (posts?.length || 0) / 4;
    if (!n) return;
    const paint = (g, c) => {
      const col = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) col.set(c, i);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const body = mergeGeometries([
      paint(new THREE.BoxGeometry(0.1, 0.8, 0.12).translate(0, 0.4, 0), [0.86, 0.86, 0.83]),
      paint(new THREE.BoxGeometry(0.104, 0.25, 0.124).translate(0, 0.905, 0), [0.03, 0.03, 0.03]),
    ]);
    const refl = mergeGeometries([new THREE.PlaneGeometry(0.05, 0.14).translate(0, 0.9, 0.063), new THREE.PlaneGeometry(0.05, 0.14).rotateY(Math.PI).translate(0, 0.9, -0.063)]);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const reflMat = new THREE.MeshStandardMaterial({ color: 0xff9a1f, emissive: 0xff8a10, emissiveIntensity: 0.1, roughness: 0.3 });
    this.nightMats.push({ mat: reflMat, day: 0.1, night: 1.4 });
    const ms = [];
    for (let i = 0; i < n; i++) ms.push(mat4(posts[i * 4], posts[i * 4 + 1] - 0.05, posts[i * 4 + 2], posts[i * 4 + 3]));
    const bodies = this.chunked(body, bodyMat, ms, { maxDist: 520, shadowDist: 120, cell: 384 });
    const lights = this.chunked(refl, reflMat, ms, { maxDist: 520, cast: false, cell: 384 });
    for (let i = 0; i < n; i++) this.addSmashable({ x: posts[i * 4], z: posts[i * 4 + 2], y: posts[i * 4 + 1], r: 0.2, kind: 'post', mass: 3, parts: [bodies[i], lights[i]], m0: ms[i] });
  }

  buildChevrons(chev) {
    const n = chev.length / 5;
    if (!n) return;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffd21f';
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      const x = 40 + k * 70;
      g.moveTo(x, 14);
      g.lineTo(x + 40, 64);
      g.lineTo(x, 114);
      g.lineTo(x + 26, 114);
      g.lineTo(x + 66, 64);
      g.lineTo(x + 26, 14);
      g.closePath();
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.PlaneGeometry(1.4, 0.7);
    board.translate(0, 1.4, 0);
    const postG = new THREE.BoxGeometry(0.08, 1.1, 0.08);
    postG.translate(0, 0.55, 0);
    const bm = [],
      pm = [];
    const mats = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15, side: THREE.DoubleSide });
    this.nightMats.push({ mat: mats, day: 0.1, night: 0.9 });
    const ms = [];
    for (let i = 0; i < n; i++) ms.push(new THREE.Matrix4().compose(new THREE.Vector3(chev[i * 5], chev[i * 5 + 1], chev[i * 5 + 2]), new THREE.Quaternion().setFromAxisAngle(_up, chev[i * 5 + 3] + Math.PI), new THREE.Vector3(chev[i * 5 + 4], 1, 1)));
    const boards = this.chunked(board, mats, ms, { maxDist: 600 });
    const posts = this.chunked(postG, std(0x444444), ms, { maxDist: 450 });
    for (let i = 0; i < n; i++) this.addSmashable({ x: chev[i * 5], z: chev[i * 5 + 2], y: chev[i * 5 + 1], r: 0.5, kind: 'sign', mass: 30, parts: [boards[i], posts[i]], m0: ms[i] });
  }

  buildFences(f) {
    const n = f.length / 4;
    if (!n) return;
    const post = new THREE.BoxGeometry(0.14, 1.2, 0.14);
    post.translate(0, 0.6, 0);
    const rail = new THREE.BoxGeometry(0.06, 0.12, 3.1);
    const railGeo = mergeGeometries([rail.clone().translate(0, 0.45, -1.5), rail.clone().translate(0, 0.95, -1.5)]);
    const wood = this.archMaterials.wood;
    const ms = [];
    for (let i = 0; i < n; i++) ms.push(mat4(f[i * 4], f[i * 4 + 1] - 0.05, f[i * 4 + 2], f[i * 4 + 3]));
    const posts = this.chunked(post, wood, ms, { maxDist: 420 });
    const rails = this.chunked(railGeo, wood, ms, { maxDist: 420 });
    for (let i = 0; i < n; i++) this.addSmashable({ x: f[i * 4], z: f[i * 4 + 2], y: f[i * 4 + 1], r: 0.7, kind: 'fence', mass: 20, parts: [posts[i], rails[i]], m0: ms[i] });
  }

  buildTurbines(t) {
    const n = t.length / 3;
    const white = std(0xf4f4f4, { roughness: 0.5 });
    const col = this.game.collision;
    const blades = [];
    for (let i = 0; i < n; i++) {
      const x = t[i * 3],
        y = t[i * 3 + 1] - 1,
        z = t[i * 3 + 2];
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = 0.9 + i * 0.2;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.1, 62, 12), white);
      tower.position.y = 31;
      tower.castShadow = true;
      const nac = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 8), white);
      nac.position.set(0, 62.5, 1.5);
      nac.castShadow = true;
      const rotor = new THREE.Group();
      rotor.position.set(0, 62.5, 5.8);
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(-.26, 1);
      bladeShape.bezierCurveTo(-.52, 3, -1.05, 5.2, -.92, 8);
      bladeShape.bezierCurveTo(-.5, 15, .1, 22.5, .45, 27);
      bladeShape.quadraticCurveTo(.56, 27.45, .67, 26.95);
      bladeShape.bezierCurveTo(.84, 20, .82, 11, .65, 6.5);
      bladeShape.bezierCurveTo(.55, 3.5, .3, 2.1, .26, 1);
      bladeShape.closePath();
      const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: .15, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .08, bevelThickness: .055, curveSegments: 10 });
      bladeGeo.translate(0, 0, -.075);
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(bladeGeo, white);
        b.rotation.z = (k * Math.PI * 2) / 3;
        b.castShadow = true;
        rotor.add(b);
      }
      const hubM = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), white);
      rotor.add(hubM);
      g.add(tower, nac, rotor);
      this.group.add(g);
      blades.push(rotor);
      col.addCircle(x, z, 2.1, y, y + 60, 'building');
    }
    this.animated.push((dt) => blades.forEach((b, i) => (b.rotation.z += dt * (0.9 + (i % 3) * 0.1))));
  }

  buildBoards(b) {
    const n = b.length / 4;
    this.boardsTotal = n;
    if (!n) return;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 512, 256);
    grd.addColorStop(0, '#ff8a1f');
    grd.addColorStop(1, '#ffd21f');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#1a0d00';
    g.font = '800 italic 92px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText(GAME_TITLE, 256, 120);
    g.font = '700 42px "Barlow Condensed", sans-serif';
    g.fillText('XP BONUS BOARD', 256, 190);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const boardGeo = new THREE.BoxGeometry(3.4, 1.8, 0.12);
    boardGeo.translate(0, 2.2, 0);
    const legGeo = mergeGeometries([new THREE.BoxGeometry(0.12, 1.4, 0.12).translate(-1.3, 0.7, 0), new THREE.BoxGeometry(0.12, 1.4, 0.12).translate(1.3, 0.7, 0)]);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xff8a1f, emissiveMap: tex, emissiveIntensity: 0.25 });
    this.nightMats.push({ mat, day: 0.25, night: 1.2 });
    const smashed = new Set(this.game.save?.data.boards || []);
    const ms = [];
    for (let i = 0; i < n; i++) ms.push(smashed.has(i) ? new THREE.Matrix4().makeScale(0, 0, 0).setPosition(b[i * 4], b[i * 4 + 1], b[i * 4 + 2]) : mat4(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]));
    const panels = this.chunked(boardGeo, mat, ms, { maxDist: 900 });
    const legs = this.chunked(legGeo, std(0x333333), ms, { maxDist: 500 });
    for (let i = 0; i < n; i++) {
      const board = { x: b[i * 4], z: b[i * 4 + 2], y: b[i * 4 + 1], id: i };
      this.boards.push(board);
      if (smashed.has(i)) {
        board.alive = false;
        continue;
      }
      board.alive = true;
      board.smash = this.addSmashable({ x: board.x, z: board.z, y: board.y, r: 1.4, kind: 'board', mass: 25, parts: [panels[i], legs[i]], board });
    }
  }

  buildLighthouse() {
    // on the north-east coast
    const ang = -0.75;
    const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang));
    let r = 1200;
    for (; r < 2000; r += 5) if (this.h(dir.x * r, dir.y * r) < 3) break;
    r -= 25;
    const x = dir.x * r,
      z = dir.y * r;
    const y = this.h(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const segs = 6;
    for (let k = 0; k < segs; k++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(3.2 - (k + 1) * 0.25, 3.2 - k * 0.25, 4, 20), std(k % 2 ? 0xc81d25 : 0xf5f5f5, { roughness: 0.6 }));
      m.position.y = 2 + k * 4;
      m.castShadow = true;
      g.add(m);
    }
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 2 }));
    lampRoom.position.y = segs * 4 + 1.3;
    this.nightMats.push({ mat: lampRoom.material, day: 0.5, night: 10 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.2, 16), std(0x222222));
    roof.position.y = segs * 4 + 3.7;
    g.add(lampRoom, roof);
    // rotating beam
    const beamGeo = new THREE.ConeGeometry(3, 120, 16, 1, true);
    beamGeo.translate(0, -60, 0);
    beamGeo.rotateZ(Math.PI / 2);
    const bm = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(beamGeo, bm);
    beam.position.y = segs * 4 + 1.3;
    g.add(beam);
    this.lighthouseBeam = bm;
    this.animated.push((dt) => (beam.rotation.y += dt * 0.6));
    this.group.add(g);
    this.game.collision.addCircle(x, z, 3.2, y, y + 30, 'building');
    this.lighthouse = { x, z };
  }

  buildViewpoint() {
    const vp = LOCATIONS.viewpoint;
    if (!vp) return;
    const y = this.h(vp.x, vp.z);
    const tex = makeTextTexture('MIRADOR DEL VOLCÁN', { w: 1024, h: 160, bg: '#3a2a1e', fg: '#f4e8d0', font: '700 88px "Barlow Condensed", sans-serif' });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 0.2), [std(0x3a2a1e), std(0x3a2a1e), std(0x3a2a1e), std(0x3a2a1e), new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex })]);
    sign.position.set(vp.x + 8, y + 2.2, vp.z);
    sign.rotation.y = Math.atan2(-vp.x - 150, -vp.z + 560) * 0;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2, 0.15), std(0x3a2a1e));
    legs.position.set(vp.x + 8, y + 1, vp.z);
    this.group.add(sign, legs);
  }

  // smoke plume rising from the volcano crater
  buildPlume() {
    const V = WORLD.volcano;
    const tex = makeSmokeTexture();
    const mat = new THREE.SpriteMaterial({ map: tex, color: 0xcfc9c4, transparent: true, depthWrite: false, opacity: 0.5, fog: true });
    const sprites = [];
    const baseY = V.height + 30;
    for (let k = 0; k < 26; k++) {
      const sp = new THREE.Sprite(mat.clone());
      sp.userData = { t: k / 26 };
      this.group.add(sp);
      sprites.push(sp);
    }
    this.animated.push((dt) => {
      for (const sp of sprites) {
        sp.userData.t = (sp.userData.t + dt * 0.012) % 1;
        const t = sp.userData.t;
        const wind = t * t * 260;
        sp.position.set(V.x + wind + Math.sin(t * 9) * 12, baseY + t * 520, V.z + wind * 0.4);
        const s = 60 + t * 260;
        sp.scale.set(s, s, 1);
        sp.material.opacity = Math.sin(t * Math.PI) * 0.45;
        sp.material.rotation = t * 2;
      }
    });
  }

  addSmashable(o) {
    this.game.collision.addSmashable(o);
    o.onSmash = (obj) => this.smashed(obj);
    this.smashables.push(o);
    return o;
  }

  smashed(o) {
    const z0 = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(o.x, o.y, o.z);
    for (const [im, k] of o.parts) {
      im.setMatrixAt(k, z0);
      im.instanceMatrix.needsUpdate = true;
    }
    if (o.board) {
      o.board.alive = false;
      this.game.onBoardSmashed?.(o.board);
    }
    // fences and signs are rebuilt after a while
    if (!o.board && o.m0) {
      setTimeout(() => {
        for (const [im, k] of o.parts) {
          im.setMatrixAt(k, o.m0);
          im.instanceMatrix.needsUpdate = true;
        }
        o.alive = true;
      }, 90000);
    }
  }

  update(dt, env) {
    // draw distance per cell; shadows only for cells near the camera
    const cam = this.game.camera.position;
    for (const c of this.chunks) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z) - c.r;
      c.mesh.visible = d < c.maxDist;
      if (c.cast) c.mesh.castShadow = d < c.shadowDist;
    }
    const t = atmo.time.value;
    for (const a of this.animated) a(dt, t);
    const night = env.nightFactor;
    const dusk = env.lightsOn ? 1 : 0;
    for (const nm of this.nightMats) nm.mat.emissiveIntensity = nm.day + (nm.night - nm.day) * Math.max(night, dusk * 0.6);
    if (this.poolMat) this.poolMat.opacity = Math.max(night, dusk * 0.5) * 0.35;
    if (this.beamMat) this.beamMat.opacity = night * 0.08;
    if (this.lighthouseBeam) this.lighthouseBeam.opacity = night * 0.12;
  }
}

function makeClockTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e3ddca'; ctx.fillRect(0, 0, 512, 512);
  ctx.translate(256, 256);
  ctx.strokeStyle = '#313b36';
  for (let k = 0; k < 60; k++) {
    const a = k * Math.PI / 30;
    const inner = k % 5 ? 208 : 194;
    ctx.lineWidth = k % 5 ? 2 : 5;
    ctx.beginPath(); ctx.moveTo(Math.sin(a) * inner, -Math.cos(a) * inner); ctx.lineTo(Math.sin(a) * 223, -Math.cos(a) * 223); ctx.stroke();
  }
  ctx.fillStyle = '#313b36'; ctx.font = '32px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const hours = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  hours.forEach((text, k) => ctx.fillText(text, Math.sin(k * Math.PI / 6) * 165, -Math.cos(k * Math.PI / 6) * 165));
  for (const [angle, length, width] of [[-Math.PI / 3, 112, 12], [Math.PI / 3, 157, 7]]) {
    ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-Math.sin(angle) * 18, Math.cos(angle) * 18); ctx.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export { FESTIVAL_NAME };
