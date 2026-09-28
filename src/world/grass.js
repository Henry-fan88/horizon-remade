// GPU grass: a tile of blade clumps that wraps around the camera. Heights and colour/density
// come from the terrain textures, so blades stay glued to the ground and avoid roads/sand/rock.
import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';
import { atmo } from './sky.js';

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

export class Grass {
  constructor(world, count = 36000, tile = 96) {
    this.tile = tile;
    const rnd = mulberry32(31337);
    // Keep the original world-space anchors stable while giving the new blade
    // geometry its own random sequence (the former four blades used 24 draws).
    for (let i = 0; i < 24; i++) rnd();
    const clump = clumpGeometry(mulberry32(27271));
    const g = new THREE.InstancedBufferGeometry();
    g.index = clump.index;
    g.setAttribute('position', clump.attributes.position);
    g.setAttribute('normal', clump.attributes.normal);
    g.setAttribute('tip', clump.attributes.tip);
    g.setAttribute('bladeRoot', clump.attributes.bladeRoot);
    const off = new Float32Array(count * 2),
      rr = new Float32Array(count * 2);
    // stratified jitter for even coverage
    const n = Math.ceil(Math.sqrt(count));
    let k = 0;
    for (let i = 0; i < n && k < count; i++)
      for (let j = 0; j < n && k < count; j++, k++) {
        off[k * 2] = ((i + rnd()) / n) * tile;
        off[k * 2 + 1] = ((j + rnd()) / n) * tile;
        rr[k * 2] = rnd();
        rr[k * 2 + 1] = rnd();
      }
    // Quality presets draw a prefix. Shuffle whole instances so lower settings
    // thin coverage evenly, rather than removing rectangular strips of meadow.
    const shuffle = mulberry32(8167);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(shuffle() * (i + 1));
      for (let axis = 0; axis < 2; axis++) {
        const a = i * 2 + axis, b = j * 2 + axis;
        [off[a], off[b]] = [off[b], off[a]];
        [rr[a], rr[b]] = [rr[b], rr[a]];
      }
    }
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off, 2));
    g.setAttribute('iRand', new THREE.InstancedBufferAttribute(rr, 2));
    g.instanceCount = count;
    this.maxCount = count;
    const S = world.data.heights ? Math.sqrt(world.data.heights.length) : 1025;
    const colorTex = new THREE.DataTexture(world.data.colors, S, S, THREE.RGBAFormat);
    colorTex.minFilter = colorTex.magFilter = THREE.LinearFilter;
    colorTex.needsUpdate = true;
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uTile: { value: tile },
      uRadius: { value: tile * 0.5 },
      uWorld: { value: world.size },
      tHeight: { value: world.heightTex },
      tColor: { value: colorTex },
      uTime: atmo.time,
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec2 iOffset;
attribute vec2 iRand;
attribute float tip;
attribute vec2 bladeRoot;
uniform vec3 uCam;
uniform float uTile;
uniform float uRadius;
uniform float uWorld;
uniform float uTime;
uniform sampler2D tHeight;
uniform sampler2D tColor;
varying vec3 vGrassCol;
varying float vTip;`
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 rel = mod( iOffset - uCam.xz + uTile * 0.5, uTile ) - uTile * 0.5;
float a = iRand.x * 43.7;
float ca = cos( a ), sa = sin( a );
vec2 root = vec2( ca * bladeRoot.x - sa * bladeRoot.y, sa * bladeRoot.x + ca * bladeRoot.y );
vec2 wxz = uCam.xz + rel + root;
vec2 huv = ( wxz + uWorld * 0.5 ) / uWorld;
float gh = texture2D( tHeight, huv ).r;
vec4 tc = texture2D( tColor, huv );
float dens = tc.a;
float dist = length( rel );
float fade = 1.0 - smoothstep( uRadius * 0.55, uRadius * 0.97, dist );
float camD = length( wxz - uCam.xz );
float meadowPatch = 0.5 + 0.5 * sin( wxz.x * 0.37 + sin( wxz.y * 0.29 ) * 1.8 ) * sin( wxz.y * 0.31 + wxz.x * 0.11 );
float keep = step( iRand.y, dens * ( 0.8 + meadowPatch * 0.3 ) ) * fade * step( 0.3, gh ) * smoothstep( 0.65, 2.0, camD );
float hs = ( 0.17 + iRand.x * 0.27 ) * ( 0.58 + dens * 0.42 ) * ( 0.76 + meadowPatch * 0.36 ) * keep;
vec3 p = position;
p.xz -= bladeRoot;
p.xz = vec2( ca * p.x - sa * p.z, sa * p.x + ca * p.z );
p.y *= hs;
p.xz *= 0.74 + hs * 0.75;
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
    mat.customProgramCacheKey = () => 'grass-natural-v3';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'grass';
    this.geometry = g;
  }

  setDensity(q) {
    this.geometry.instanceCount = Math.floor(this.maxCount * Math.max(0, Math.min(1, q)));
    this.mesh.visible = q > 0.01;
  }

  update(camera) {
    this.uniforms.uCam.value.copy(camera.position);
  }
}
