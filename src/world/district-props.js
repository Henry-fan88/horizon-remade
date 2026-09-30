// Instanced architecture and local landmarks for the six exploration districts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clearFootprint, districtDestinations, mudMask, landmarkPlots } from './districts.js';
import { mulberry32 } from '../core/math.js';
import { makeTextTexture } from './textures.js';
import { useFarShadow } from '../render/farshadow.js';

const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .78, ...options });

export function batches(props) {
  const groups = new Map();
  const box = new THREE.BoxGeometry(1, 1, 1), cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, -.5, .5, 0, -.5, 0, 1, -.5, -.5, 0, .5, .5, 0, .5, 0, 1, .5], 3));
  gable.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1, 0, 0, 1, 0, .5, 1], 2));
  gable.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
  gable.computeVertexNormals();
  function add(geo, mat, x, y, z, w, h, d, yaw = 0, roll = 0, range = 1100) {
    const key = `${geo.uuid}:${mat.uuid}:${range}`;
    if (!groups.has(key)) groups.set(key, { geo, mat, range, matrices: [] });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll, 'YXZ'));
    groups.get(key).matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d)));
  }
  return {
    mesh: add,
    box: (mat, x, y, z, w, h, d, yaw = 0, roll = 0, range = 1100) => add(box, mat, x, y, z, w, h, d, yaw, roll, range),
    cylinder: (mat, x, y, z, radius, height, range = 1100) => add(cylinder, mat, x, y, z, radius, height, radius, 0, 0, range),
    gable: (mat, x, y, z, width, rise, depth, yaw=0) => add(gable, mat, x, y, z, width, rise, depth, yaw),
    flush() {
      for (const { geo, mat, range, matrices } of groups.values()) {
        useFarShadow(mat);
        props.chunked(geo, mat, matrices, { maxDist: range, shadowDist: 240 });
      }
    },
  };
}

// Metre-scaled facade bays: mullions, floor slabs, glass and independently lit offices.
// This keeps thousands of windows in a handful of draw calls rather than one per pane.
export function facadeMaterial(color, style, props) {
  const mat = material(color, { metalness: .25, roughness: .38, emissive: 0xffd29a, emissiveIntensity: 0 });
  props.nightMats.push({ mat, day: 0, night: .7 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vCityWorld; varying vec3 vCityFace; varying vec3 vCityLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 cityP = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          cityP = instanceMatrix * cityP;
        #endif
        vCityLocal = position;
        #ifdef USE_INSTANCING
          vCityLocal *= vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        #endif
        vCityWorld = (modelMatrix * cityP).xyz;
        vCityFace = normal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vCityWorld; varying vec3 vCityFace; varying vec3 vCityLocal;
      float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float cityU = abs(vCityFace.x) > .5 ? vCityLocal.z : vCityLocal.x;
        vec2 cell = vec2(cityU / ${style === 3 ? '2.5' : '3.2'}, vCityLocal.y / 3.4);
        vec2 bay = fract(cell);
        float pane = smoothstep(.07, .1, bay.x) * (1.0 - smoothstep(.9, .93, bay.x));
        pane *= smoothstep(${style > 2 ? '.22, .26' : '.10, .14'}, bay.y) * (1.0 - smoothstep(.87, .9, bay.y));
        pane *= 1.0 - step(.5, abs(vCityFace.y));
        float variation = cityHash(floor(cell) + floor(vCityWorld.xz / 35.0));
        vec3 glass = diffuse * (.65 + .35 * variation) + vec3(.035, .065, .085);
        glass *= .82 + .2 * sin(vCityWorld.y * .012);
        vec3 frame = ${style > 2 ? 'diffuse * 1.65' : 'vec3(.17, .2, .21)'};
        vec4 diffuseColor = vec4(mix(frame, glass, pane), opacity);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(.79, .2 + variation * .14, pane);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(.08, .48, pane);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= pane * step(.61, variation) * (.45 + .55 * variation);`);
  };
  mat.customProgramCacheKey = () => `city-facade-${style}-v2`;
  return mat;
}

export function sign(props, text, x, y, z, width, height, yaw = 0, fg = '#f5ead8', bg = '#284344') {
  const texture = makeTextTexture(text, { w: 512, h: 128, bg, fg, font: 'bold 46px Barlow Condensed' });
  const mat = material(0xffffff, { map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: .1 });
  props.nightMats.push({ mat, day: .1, night: .65 });
  const mesh = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(width, height);
  for (const side of [-1, 1]) {
    const face = new THREE.Mesh(geometry, mat);
    face.position.z = side * .025;
    face.rotation.y = side === 1 ? 0 : Math.PI;
    mesh.add(face);
  }
  mesh.position.set(x, y, z); mesh.rotation.y = yaw;
  props.group.add(mesh);
  props.chunks.push({ mesh, x, z, r: width, maxDist: 450, shadowDist: 0, cast: false });
}

function pitchedRoof(B, mat, x, y, z, w, d, rise) {
  const pitch = Math.atan2(rise, w / 2), length = Math.hypot(w / 2, rise);
  for (const side of [-1, 1]) B.box(mat, x + side * w / 4, y + rise / 2, z, length + .45, .35, d + 1, 0, -side * pitch);
}

function cabin(props, B, x, z, snowy = false) {
  const w = snowy ? 15 : 13, d = 11;
  if (!clearFootprint(props.world.network, x, z, w + 4, d + 4, 7)) return false;
  const y = props.h(x, z), A = props.archMaterials;
  const wall = snowy ? A.wood : A.plaster, roof = snowy ? material(0xe9eff0) : A.tile;
  B.box(A.stone, x, y + .8, z, w + .3, 2.6, d + .3);
  B.box(wall, x, y + 3.8, z, w, 5.5, d);
  B.gable(wall, x, y + 6.4, z, w, 3.65, d);
  pitchedRoof(B, roof, x, y + 6.4, z, w + 1.5, d + 1, 4);
  B.box(A.stone, x + w * .25, y + 9.1, z - 2, 1.1, 4, 1.1);
  for (const dx of [-w * .29, w * .29]) for (const side of [-1, 1]) {
    B.box(A.warmGlass, x + dx, y + 3.8, z + side * (d / 2 + .04), 2.2, 2, .12, 0, 0, 650);
    B.box(A.trim, x + dx, y + 3.8, z + side * (d / 2 + .12), .09, 2.2, .08, 0, 0, 600);
    B.box(A.trim, x + dx, y + 3.8, z + side * (d / 2 + .12), 2.4, .09, .08, 0, 0, 600);
  }
  B.box(A.wood, x, y + 2, z + d / 2 + .08, 1.5, 3.4, .16);
  props.game.collision.addBox(x, z, w / 2, d / 2, 0, y - 1, y + 8, 'building');
  return true;
}

export function buildDistrictLandmarks(props) {
  const B = batches(props), A = props.archMaterials, rnd = mulberry32(28542);
  const barn = material(0x964b37), metalRoof = material(0x717977, { metalness: .4 });
  const hay = material(0xbda56b), snow = material(0xe7eceb), reed = material(0x777841);
  props.nightMats.push({ mat: A.warmGlass, day: 0, night: .8 });
  const plots = landmarkPlots(props.world.network, props.world.hf);
  const farms = [];
  for (const { x, z } of plots.farms) {
    const y = props.h(x, z), w = 26, d = 18;
    farms.push({ x, z });
    B.box(A.stone, x, y + .4, z, w + 1, 1.8, d + 1);
    B.box(barn, x, y + 4, z, w, 7.5, d);
    B.gable(barn, x, y + 7.7, z, w, 4.7, d);
    pitchedRoof(B, metalRoof, x, y + 7.7, z, w + 1.5, d + 1, 5);
    for (const dx of [-w / 2 + .2, w / 2 - .2]) B.box(A.trim, x + dx, y + 4, z + d / 2 + .04, .35, 8, .2);
    B.box(A.wood, x, y + 3, z + d / 2 + .1, 7, 5.5, .25);
    B.box(A.trim, x, y + 3, z + d / 2 + .26, .18, 5.7, .15);
    for (const side of [-1, 1]) B.box(A.trim, x + side * 1.65, y + 3, z + d / 2 + .29, .18, 6.4, .16, 0, side * .52);
    props.game.collision.addBox(x, z, w / 2, d / 2, 0, y - 1, y + 10, 'building');
    if (clearFootprint(props.world.network, x + 22, z - 3, 11, 14, 8)) {
      for (const dz of [-6, 4]) {
        const sx = x + 22, sz = z + dz, sy = props.h(sx, sz);
        B.cylinder(A.aluminum, sx, sy + 6, sz, 3.7, 12);
        B.cylinder(metalRoof, sx, sy + 12.3, sz, 4, .7);
        for (let ring = 2; ring < 12; ring += 2) B.cylinder(metalRoof, sx, sy + ring, sz, 3.75, .08);
        props.game.collision.addBox(sx, sz, 3.7, 3.7, 0, sy, sy + 13, 'building');
      }
    }
    cabin(props, B, x - 32, z + 8);
    for (let k = 0; k < 16; k++) {
      const bx = x - 45 + rnd() * 80, bz = z + 27 + rnd() * 60;
      if (props.h(bx, bz) < 2 || !clearFootprint(props.world.network, bx, bz, 3, 2, 7)) continue;
      B.box(hay, bx, props.h(bx, bz) + .75, bz, 2.8, 1.5, 1.5, rnd() * 1.5, 0, 650);
    }
    sign(props, 'GRANJA · VALLE VERDE', x, y + 6.4, z + d / 2 + .35, 12, 1.1, 0, '#e8dfc7', '#603c2b');
  }
  props.farmLocations = farms;

  const pass = props.world.network.roads.find(r => r.name === 'Paso Nevado');
  let cabins = 0;
  for (const { x, z } of plots.chalets) {
    if (cabin(props, B, x, z, true)) cabins++;
  }
  // Banks follow the graded road elevation and stay outside its safety shoulders.
  const banks = [];
  for (let s = pass.length * .68; s < pass.length - 20; s += 20) {
    const p = pass.pointAt(s, {});
    for (const side of [-1, 1]) {
      const x = p.x - p.tz * side * 7.4, z = p.z + p.tx * side * 7.4;
      const y = props.h(x, z);
      if (y < 156 || Math.abs(y - p.y) > 3) continue;
      const bank = new THREE.SphereGeometry(1, 10, 6);
      const vertices = bank.attributes.position;
      const width = 1.3 + rnd() * .5, length = 4 + rnd() * 2, height = .45 + rnd() * .4;
      for (let v = 0; v < vertices.count; v++) {
        const u = vertices.getX(v) * width, w = vertices.getZ(v) * length;
        const bx = x + p.tz * u + p.tx * w, bz = z - p.tx * u + p.tz * w;
        vertices.setXYZ(v, bx, props.h(bx, bz) + Math.max(0, vertices.getY(v)) * height - .025, bz);
      }
      bank.computeVertexNormals(); banks.push(bank);
    }
  }
  if (banks.length) {
    const geometry = mergeGeometries(banks);
    banks.forEach(g => g.dispose()); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, snow); mesh.receiveShadow = true;
    props.group.add(mesh);
    const sphere = geometry.boundingSphere;
    props.chunks.push({ mesh, x: sphere.center.x, z: sphere.center.z, r: sphere.radius, maxDist: 1100, shadowDist: 0, cast: false });
  }
  props.snowCabins = cabins;

  const marsh = props.world.network.roads.find(r => r.name === 'Marisma Trail');
  const puddleMat = new THREE.MeshPhysicalMaterial({ color: 0x493d28, roughness: .23, metalness: .08, clearcoat: .65, clearcoatRoughness: .12 });
  for (let s = 40; s < marsh.length - 20; s += 23) {
    const p = marsh.pointAt(s, {});
    for (const side of [-1, 1]) {
      const x = p.x - p.tz * side * (6 + rnd() * 10), z = p.z + p.tx * side * (6 + rnd() * 10);
      if (mudMask(x, z) < .4 || props.h(x, z) < .4) continue;
      // Low, terrain-conforming films read as shallow puddles, not floating ponds.
      const radius = 2 + rnd() * 3, geo = new THREE.CircleGeometry(radius, 24, 0, Math.PI * 2);
      geo.rotateX(-Math.PI / 2);
      const positions = geo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const px = x + positions.getX(i), pz = z + positions.getZ(i) * .57;
        positions.setXYZ(i, px, props.h(px, pz) + .07, pz);
      }
      geo.computeVertexNormals(); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, puddleMat); mesh.receiveShadow = true;
      props.group.add(mesh); props.chunks.push({ mesh, x, z, r: radius, maxDist: 650, shadowDist: 0, cast: false });
      for (let k = 0; k < 12; k++) {
        const rx = x + (rnd() - .5) * 6, rz = z + side * (2 + rnd() * 2), ry = props.h(rx, rz);
        const height = .9 + rnd() * 1.2;
        B.box(reed, rx, ry + height / 2, rz, .065, height, .065, rnd() * 6, (rnd() - .5) * .3, 300);
        B.box(hay, rx, ry + height * .87, rz, .12, .27, .12, 0, 0, 300);
      }
    }
  }
  // Trailhead boards stand clear of the road at every destination.
  for (const place of districtDestinations(props.world.network)) {
    if (place.id === 'city' || place.id === 'rural') continue;
    const x = place.x - place.tz * 9, z = place.z + place.tx * 9, y = props.h(x, z);
    if (!clearFootprint(props.world.network, x, z, 4, 1, 2)) continue;
    const yaw = place.heading;
    for (const side of [-1, 1]) B.box(A.wood, x + Math.cos(yaw) * side * 1.8, y + 1.6, z - Math.sin(yaw) * side * 1.8, .16, 3.2, .16, 0, 0, 550);
    sign(props, place.name.toUpperCase(), x, y + 2.7, z, 4.7, .95, yaw);
  }
  B.flush();
}
