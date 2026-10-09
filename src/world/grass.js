// GPU grass. Clumps live in 3 m world cells around the camera; each cell holds fewer clumps
// the further it is (far blades are drawn wider to keep the cover), so about a quarter as
// many clumps are processed as with a uniform tile. Heights and colour / density come from
// the terrain textures; clumps on bare ground (roads, sand, rock, water) are dropped before
// any other vertex work.
import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';
import { atmo } from './sky.js';
import { useFarShadow } from '../render/farshadow.js';
import { softWeather } from './weather-surface.js';

function clumpGeometry(rnd) {
  const pos = [],
    tip = [],
    roots = [],
    idx = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const ox = (rnd() - 0.5) * 0.38,
      oz = (rnd() - 0.5) * 0.38;
    const a = rnd() * Math.PI * 2;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    const w = 0.011 + rnd() * 0.018;
    const lean = (rnd() - 0.12) * 0.6;
    const hk = 0.54 + rnd() * 0.65;
    const base = pos.length / 3;
    const levels = [0, 0.45, 1];
    for (let l = 0; l < levels.length; l++) {
      const t = levels[l];
      const y = t * hk;
      const f = lean * t * t;
      if (l < levels.length - 1) {
        const hw = w * (1 - t * 0.8);
        for (const s of [-1, 1]) {
          const lx = s * hw,
            lz = f;
          pos.push(ox + lx * ca - lz * sa, y, oz + lx * sa + lz * ca);
          tip.push(t);
          roots.push(ox, oz);
        }
      } else {
        pos.push(ox - f * sa, y, oz + f * ca);
        tip.push(1);
        roots.push(ox, oz);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
  g.setAttribute('bladeRoot', new THREE.Float32BufferAttribute(roots, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const CELL = 3; // metres
const RADIUS = 46; // grass draw distance
const NEAR = 10; // full density inside this distance
const PEAK = 6.7; // clumps per m² at full density (the high preset)

// share of full density kept at distance d
function falloff(d) {
  return d <= NEAR ? 1 : Math.pow(NEAR / d, 1.4);
}

export class Grass {
  constructor(world, count = 72000, tile = 90) {
    void count;
    void tile;
    const clump = clumpGeometry(mulberry32(27271));
    const g = new THREE.InstancedBufferGeometry();
    g.index = clump.index;
    g.setAttribute('position', clump.attributes.position);
    g.setAttribute('normal', clump.attributes.normal);
    g.setAttribute('tip', clump.attributes.tip);
    g.setAttribute('bladeRoot', clump.attributes.bladeRoot);
    this.geometry = g;
    const S = world.data.heights ? Math.sqrt(world.data.heights.length) : 1025;
    const colorTex = new THREE.DataTexture(world.data.colors, S, S, THREE.RGBAFormat);
    colorTex.minFilter = colorTex.magFilter = THREE.LinearFilter;
    colorTex.needsUpdate = true;
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uCamCell: { value: new THREE.Vector2() },
      uCell: { value: CELL },
      uRadius: { value: RADIUS },
      uSlots: { value: 1 },
      uWorld: { value: world.size },
      tHeight: { value: world.heightTex },
      tColor: { value: colorTex },
      uTime: atmo.time,
    };
    const mat = softWeather(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 iSlot;
attribute float tip;
attribute vec2 bladeRoot;
uniform vec3 uCam;
uniform vec2 uCamCell;
uniform float uCell;
uniform float uRadius;
uniform float uSlots;
uniform float uWorld;
uniform float uTime;
uniform sampler2D tHeight;
uniform sampler2D tColor;
varying vec3 vGrassCol;
varying float vTip;
vec2 grassHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.xx + q.yz ) * q.zy );
}`
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 cell = uCamCell + iSlot.xy;
float slot = iSlot.z;
vec2 h = grassHash( cell * 1.37 + slot * 17.1 );
vec2 iRand = grassHash( cell * 3.11 - slot * 7.7 + 19.3 );
vec2 anchor = ( cell + h ) * uCell;
float dist = length( anchor - uCam.xz );
// slots kept at this distance (the last one fades in / out)
float want = uSlots * ( dist <= ${NEAR.toFixed(1)} ? 1.0 : pow( ${NEAR.toFixed(1)} / dist, 1.4 ) );
float slotKeep = clamp( want - slot, 0.0, 1.0 ) * ( 1.0 - smoothstep( uRadius * 0.82, uRadius, dist ) );
vec2 huv = ( anchor + uWorld * 0.5 ) / uWorld;
vec4 tc = texture2D( tColor, huv );
float dens = tc.a;
float meadowPatch = 0.5 + 0.5 * sin( anchor.x * 0.37 + sin( anchor.y * 0.29 ) * 1.8 ) * sin( anchor.y * 0.31 + anchor.x * 0.11 );
float keep = step( iRand.y, dens * ( 0.8 + meadowPatch * 0.3 ) ) * slotKeep * smoothstep( 0.65, 2.0, dist );
if ( keep <= 0.0 ) {
  // bare ground or thinned out: collapse the clump outside the view, skip the rest
  gl_Position = vec4( 2.0, 2.0, 0.5, 1.0 );
  return;
}
float gh = texture2D( tHeight, huv ).r;
if ( gh < 0.3 ) {
  gl_Position = vec4( 2.0, 2.0, 0.5, 1.0 );
  return;
}
float a = iRand.x * 43.7;
float ca = cos( a ), sa = sin( a );
vec2 root = vec2( ca * bladeRoot.x - sa * bladeRoot.y, sa * bladeRoot.x + ca * bladeRoot.y );
vec2 wxz = anchor + root;
// thinner cover far away is made up with wider, slightly taller clumps
float spread = 1.0 + 0.85 * smoothstep( ${NEAR.toFixed(1)}, uRadius, dist );
float hs = ( 0.17 + iRand.x * 0.27 ) * ( 0.58 + dens * 0.42 ) * ( 0.76 + meadowPatch * 0.36 ) * keep * ( 0.9 + 0.1 * spread );
vec3 p = position;
p.xz -= bladeRoot;
p.xz = vec2( ca * p.x - sa * p.z, sa * p.x + ca * p.z );
p.y *= hs;
p.xz *= ( 0.74 + hs * 0.75 ) * spread;
root *= spread;
wxz = anchor + root;
float w = sin( uTime * 1.7 + wxz.x * 0.19 + wxz.y * 0.13 ) * 0.6 + sin( uTime * 3.3 + wxz.x * 0.7 + wxz.y * 0.4 ) * 0.25;
p.x += w * 0.09 * tip * tip * hs * 2.0;
p.z += w * 0.05 * tip * tip * hs * 2.0;
vec3 transformed = vec3( wxz.x, gh - 0.018, wxz.y ) + p;
vec3 terrainAlbedo = pow( tc.rgb, vec3( 2.2 ) );
float dry = smoothstep( 0.81, 0.99, iRand.y ) * 0.27;
vGrassCol = mix( terrainAlbedo, vec3( 0.2, 0.19, 0.095 ), dry ) * ( 0.9 + iRand.y * 0.16 );
vTip = tip;`
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize( vec3( normal.x * 0.28, 0.94, normal.z * 0.28 ) );');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;\nvarying float vTip;')
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vGrassCol * mix( 0.62, 1.12, smoothstep( 0.0, 0.8, vTip ) ) * vec3( 1.01, 1.01, 0.92 ), opacity );');
    };
    mat.customProgramCacheKey = () => 'grass-cells-v1';
    useFarShadow(mat);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'grass';
    this.density = -1;
    this.setDensity(0.75);
  }

  // Lay out the slots for a density (0..1 of the ultra preset's peak): every cell offset
  // gets as many slots as it can need anywhere inside the camera's own cell.
  setDensity(q) {
    q = Math.max(0, Math.min(1, q));
    this.mesh.visible = q > 0.01;
    if (q === this.density || q <= 0.01) {
      this.density = q;
      return;
    }
    this.density = q;
    const slots = Math.max(4, Math.round((PEAK / 0.75) * q * CELL * CELL));
    this.uniforms.uSlots.value = slots;
    const r = Math.ceil(RADIUS / CELL) + 1;
    const data = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        // nearest this cell can be to the camera (camera anywhere in cell 0)
        const nx = Math.max(0, Math.abs(dx) - 1) * CELL,
          nz = Math.max(0, Math.abs(dz) - 1) * CELL;
        const dmin = Math.hypot(nx, nz);
        if (dmin > RADIUS) continue;
        const n = Math.min(slots, Math.ceil(slots * falloff(dmin)) + 1);
        for (let j = 0; j < n; j++) data.push(dx, dz, j);
      }
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(data), 3);
    this.geometry.setAttribute('iSlot', attr);
    this.geometry.instanceCount = data.length / 3;
  }

  update(camera) {
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uCamCell.value.set(Math.floor(camera.position.x / CELL), Math.floor(camera.position.z / CELL));
  }
}
