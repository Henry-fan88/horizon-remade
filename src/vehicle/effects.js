// Particle effects (tyre smoke, dust, sparks, splashes) as instanced camera-facing
// billboards, plus skid-mark ribbons.
import * as THREE from 'three';
import { makeSmokeTexture } from '../world/textures.js';
import { fogUniforms } from '../world/sky.js';
import { SURFACE_INFO } from '../world/surfaces.js';
import { SandEffects } from './sand-effects.js';

const TYRE_SMOKE = [0.86, 0.86, 0.88];
const DUST_RATE = { dirt: 1, gravel: 1, sand: 1, dry: 0.8, ash: 0.8, field: 0.55, rock: 0.4, verge: 0.4, grass: 0.18, forest: 0.25 };

const MAX_P = 1400;

const pVert = /* glsl */ `
attribute vec4 iPos;   // xyz, size
attribute vec4 iCol;   // rgb, alpha
attribute float iRot;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vCol = iCol;
  vec4 mvPosition = viewMatrix * vec4( iPos.xyz, 1.0 );
  float c = cos( iRot ), s = sin( iRot );
  vec2 p = vec2( position.x * c - position.y * s, position.x * s + position.y * c );
  mvPosition.xy += p * iPos.w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const pFrag = /* glsl */ `
uniform sampler2D map;
uniform float additive;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D( map, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vCol.rgb * mix( 1.0, t.a * 2.0, additive ), a );
  #include <fog_fragment>
}`;

class ParticlePool {
  constructor(texture, blending, lit = true) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 4), 4);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 4), 4);
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P), 1);
    this.iPos.setUsage(THREE.DynamicDrawUsage);
    this.iCol.setUsage(THREE.DynamicDrawUsage);
    this.iRot.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iCol', this.iCol);
    g.setAttribute('iRot', this.iRot);
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), map: { value: texture }, additive: { value: blending === THREE.AdditiveBlending ? 1 : 0 } },
      vertexShader: pVert,
      fragmentShader: pFrag,
      transparent: true,
      depthWrite: false,
      blending,
      fog: lit,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.geo = g;
    this.p = [];
    for (let i = 0; i < MAX_P; i++) this.p.push({ alive: false });
    this.cursor = 0;
    this.count = 0;
  }

  spawn(x, y, z, vx, vy, vz, size, grow, life, r, g, b, a, drag = 1.5, gravity = -0.3) {
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_P;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.size = size;
    p.grow = grow;
    p.life = life;
    p.age = 0;
    p.r = r;
    p.g = g;
    p.b = b;
    p.a = a;
    p.drag = drag;
    p.gravity = gravity;
    p.rot = Math.random() * 6.28;
    p.spin = (Math.random() - 0.5) * 1.2;
  }

  update(dt, lightMul) {
    let n = 0;
    const P = this.iPos.array,
      C = this.iCol.array,
      R = this.iRot.array;
    for (const p of this.p) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      p.rot += p.spin * dt;
      const t = p.age / p.life;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      P[n * 4] = p.x;
      P[n * 4 + 1] = p.y;
      P[n * 4 + 2] = p.z;
      P[n * 4 + 3] = p.size;
      C[n * 4] = p.r * lightMul;
      C[n * 4 + 1] = p.g * lightMul;
      C[n * 4 + 2] = p.b * lightMul;
      C[n * 4 + 3] = p.a * fade * fade;
      R[n] = p.rot;
      n++;
    }
    this.geo.instanceCount = n;
    this.iPos.needsUpdate = true;
    this.iCol.needsUpdate = true;
    this.iRot.needsUpdate = true;
    this.count = n;
  }
}

// ------------------------------------------------------------------ skid marks
const MAX_SKID = 3000;
class SkidMarks {
  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_SKID * 4 * 3);
    this.alpha = new Float32Array(MAX_SKID * 4);
    const idx = new Uint32Array(MAX_SKID * 6);
    for (let i = 0; i < MAX_SKID; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), color: { value: new THREE.Color(0.02, 0.02, 0.02) } },
      vertexShader: `attribute float alpha; varying float vA;
        #include <fog_pars_vertex>
        void main(){ vA = alpha; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(color, vA);
        #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.cursor = 0;
    this.last = new Map();
  }

  // add a segment for a wheel key
  add(key, x, y, z, rx, rz, width, a) {
    const prev = this.last.get(key);
    const lx = x - rx * width * 0.5,
      lz = z - rz * width * 0.5;
    const hx = x + rx * width * 0.5,
      hz = z + rz * width * 0.5;
    if (prev && Math.hypot(prev.x - x, prev.z - z) < 4 && Math.hypot(prev.x - x, prev.z - z) > 0.25) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_SKID;
      const v = i * 4;
      const P = this.pos;
      P.set([prev.lx, prev.y, prev.lz, prev.hx, prev.y, prev.hz, lx, y, lz, hx, y, hz], v * 3);
      this.alpha[v] = this.alpha[v + 1] = prev.a;
      this.alpha[v + 2] = this.alpha[v + 3] = a;
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.alpha.needsUpdate = true;
      this.last.set(key, { x, y, z, lx, lz, hx, hz, a });
    } else if (!prev || Math.hypot(prev.x - x, prev.z - z) >= 4) {
      this.last.set(key, { x, y, z, lx, lz, hx, hz, a });
    }
  }

  lift(key) {
    this.last.delete(key);
  }
}

// ------------------------------------------------------------------ manager
export class Effects {
  constructor(scene, world) {
    const smokeTex = makeSmokeTexture();
    this.smoke = new ParticlePool(smokeTex, THREE.NormalBlending);
    this.sparks = new ParticlePool(makeSparkTexture(), THREE.AdditiveBlending, false);
    this.skids = new SkidMarks();
    this.sand = new SandEffects(world, this.smoke);
    scene.add(this.smoke.mesh, this.sparks.mesh, this.skids.mesh);
    scene.add(this.sand.group);
    this.light = 1;
    this._r = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  // per-frame wheel effects for a vehicle
  vehicle(v, dt, intensity = 1) {
    const p = v.physics;
    const speed = p.speed;
    const R = this._r;
    for (let i = 0; i < 4; i++) {
      const w = p.wheels[i];
      const key = v.root.id * 4 + i;
      if (!w.contact) {
        this.skids.lift(key);
        this.sand.lift(key);
        continue;
      }
      const surf = SURFACE_INFO[w.surface] || SURFACE_INFO[0];
      if (surf.name === 'sand') {
        this.skids.lift(key);
        this.sand.wheel(v, w, i, dt, intensity);
        continue;
      }
      this.sand.lift(key);
      const slip = w.slip;
      const paved = !surf.offroad || surf.name === 'verge';
      // skid marks on asphalt when sliding; ruts on dirt always
      const skidA = paved ? Math.max(0, slip - 0.35) * 0.9 : Math.min(0.35, speed / 60) * 0.5;
      if (skidA > 0.04 && speed > 1) {
        R.set(1, 0, 0).applyQuaternion(p.quat);
        this.skids.add(key, w.point.x, w.point.y + 0.03, w.point.z, R.x, R.z, v.spec.style.wheelW * 0.95, Math.min(0.6, skidA) * (paved ? 1 : 0.5));
      } else this.skids.lift(key);
      // smoke / dust
      let rate = 0;
      let col = surf.dust;
      if (paved) {
        rate = Math.max(0, slip - 0.45) * 60 * Math.min(1, speed / 6 + w.spinning);
        col = TYRE_SMOKE;
      } else {
        const k = DUST_RATE[surf.name] ?? 0.5;
        rate = (Math.min(1, speed / 25) * 12 + slip * 22) * k;
      }
      rate *= intensity;
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          const jitter = 0.3;
          this.smoke.spawn(
            w.point.x + (Math.random() - 0.5) * jitter,
            w.point.y + 0.25,
            w.point.z + (Math.random() - 0.5) * jitter,
            p.vel.x * 0.25 + (Math.random() - 0.5) * 2,
            0.8 + Math.random() * 1.2,
            p.vel.z * 0.25 + (Math.random() - 0.5) * 2,
            paved ? 0.9 : 0.8,
            paved ? 3.2 : 2.6,
            paved ? 2.2 + Math.random() : 1.4 + Math.random() * 0.8,
            col[0],
            col[1],
            col[2],
            paved ? 0.5 : 0.32,
            1.4,
            0.15
          );
        }
        n -= 1;
      }
    }
  }

  sparksAt(x, y, z, vx, vz, count = 20) {
    for (let i = 0; i < count; i++) {
      this.sparks.spawn(x, y, z, vx * 0.4 + (Math.random() - 0.5) * 9, Math.random() * 5 + 1, vz * 0.4 + (Math.random() - 0.5) * 9, 0.12, -0.05, 0.35 + Math.random() * 0.4, 1.0, 0.65, 0.25, 1, 0.6, -14);
    }
  }

  splash(x, y, z, speed) {
    for (let i = 0; i < 60; i++) {
      this.smoke.spawn(x + (Math.random() - 0.5) * 3, y, z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6, 3 + Math.random() * speed * 0.3, (Math.random() - 0.5) * 6, 1.2, 2.5, 1.5, 0.85, 0.92, 0.95, 0.7, 1.2, -6);
    }
  }

  // white water thrown up by a wheel or the hull pushing through water
  wake(x, y, z, vx, vz, strength = 1) {
    const n = 1 + Math.floor(Math.random() * 3 * strength);
    for (let i = 0; i < n; i++) {
      this.smoke.spawn(x + (Math.random() - 0.5) * 0.6, y + 0.05, z + (Math.random() - 0.5) * 0.6, vx * 0.35 + (Math.random() - 0.5) * 3, 1.2 + Math.random() * 2.5 * strength, vz * 0.35 + (Math.random() - 0.5) * 3, 0.5, 1.6, 0.7 + Math.random() * 0.4, 0.86, 0.92, 0.95, 0.55, 1.4, -7);
    }
  }

  debris(x, y, z, vx, vz, col = [0.5, 0.4, 0.3], count = 14) {
    for (let i = 0; i < count; i++) {
      this.smoke.spawn(x, y + 0.5, z, vx * 0.5 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, vz * 0.5 + (Math.random() - 0.5) * 6, 0.35, 0.6, 1.2 + Math.random(), col[0], col[1], col[2], 0.8, 0.8, -9);
    }
  }

  update(dt, lightLevel) {
    this.smoke.update(dt, lightLevel);
    this.sparks.update(dt, 3);
    this.sand.update(dt, lightLevel);
  }
}

function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,220,150,0.8)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  return t;
}
