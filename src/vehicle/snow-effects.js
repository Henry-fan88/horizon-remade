// Snow powder and soft blue tread impressions, driven by actual tyre contacts.
import * as THREE from 'three';
import { fogUniforms } from '../world/sky.js';
import { SURF } from '../world/worldgen.js';
import { SandTracks } from './sand-effects.js';
import { RIBBON_LIFT } from '../world/roadprofile.js';

const MAX_CHUNKS = 2400;

class SnowChunks {
  constructor(world) {
    this.world = world;
    const base = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    this.positions = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHUNKS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHUNKS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.positions); g.setAttribute('iCol', this.colors); g.instanceCount = 0;
    const material = new THREE.ShaderMaterial({ uniforms: fogUniforms(), fog: true, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 iPos; attribute vec4 iCol; varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_vertex>
        void main(){vUv=uv;vCol=iCol;vec4 mvPosition=viewMatrix*vec4(iPos.xyz,1.0);
          mvPosition.xy+=position.xy*iPos.w;gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_fragment>
        void main(){vec2 q=(vUv-0.5)*2.0;float d=dot(q,q);
          float a=(1.0-smoothstep(0.25,1.0,d))*vCol.a;if(a<0.015)discard;
          gl_FragColor=vec4(vCol.rgb,a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, material); this.mesh.name = 'tire-snow-chunks';
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    this.particles = Array.from({ length: MAX_CHUNKS }, () => ({ alive: false }));
    this.cursor = this.count = this.emitted = 0;
  }

  ground(x, z) { return Math.max(this.world.hf.height(x, z), this.world.height?.(x, z) ?? -Infinity); }

  spawn(x, y, z, vx, vy, vz, size) {
    const p = this.particles[this.cursor]; this.cursor = (this.cursor + 1) % MAX_CHUNKS;
    Object.assign(p, { alive: true, x, y: Math.max(y, this.ground(x, z) + 0.06), z, vx, vy, vz, size,
      age: 0, life: 0.6 + Math.random() * 0.6, shade: 0.82 + Math.random() * 0.16 });
    this.emitted++;
  }

  update(dt, light) {
    let count = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += dt;
      const drag = Math.exp(-2.5 * dt);
      p.vx *= drag; p.vz *= drag; p.vy -= 9.81 * dt;
      p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
      if (p.age >= p.life || p.y < this.ground(p.x, p.z) + 0.025) { p.alive = false; continue; }
      this.positions.array.set([p.x, p.y, p.z, p.size], count * 4);
      const value = p.shade * light;
      this.colors.array.set([value * 0.91, value * 0.96, value, Math.min(1, (p.life - p.age) * 5)], count * 4);
      count++;
    }
    this.count = this.mesh.geometry.instanceCount = count;
    this.positions.needsUpdate = this.colors.needsUpdate = true;
  }
}

export class SnowTracks extends SandTracks {
  constructor(world) {
    super(world);
    this.mesh.name = 'compacted-snow-treads';
    this.material.fragmentShader = this.material.fragmentShader
      .replace('0.62+ridge*0.57-tread*0.1', '0.86+ridge*0.2-tread*0.055');
  }

  sampleColor() { return this._surfaceColor.setRGB(0.71, 0.8, 0.9); }

  segment(from, to) {
    const start = this.cursor * 12;
    super.segment(from, to);
    // Snowy road ribbons sit a few centimetres above the triangulated terrain.
    const near = this.world.network?.nearest((from.x + to.x) * 0.5, (from.z + to.z) * 0.5, 6);
    if (!near || near.dist >= near.road.width / 2 + 0.25) return;
    for (let i = start; i < start + 12; i++) {
      const x = this.position.getX(i), z = this.position.getZ(i);
      const ground = Math.max(this.world.hf.height(x, z), this.world.height(x, z));
      this.position.setY(i, Math.max(this.position.getY(i), ground + RIBBON_LIFT + 0.012));
    }
  }
}

export class SnowEffects {
  constructor(world, smoke) {
    this.world = world; this.smoke = smoke;
    this.chunks = new SnowChunks(world); this.tracks = new SnowTracks(world);
    this.group = new THREE.Group(); this.group.name = 'snow-wheel-effects';
    this.group.add(this.chunks.mesh, this.tracks.mesh);
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3();
  }

  wheel(vehicle, wheel, index, dt, intensity) {
    const p = vehicle.physics, key = vehicle.root.id * 4 + index;
    if (!wheel.contact || wheel.surface !== SURF.SNOW) { this.lift(key); return; }
    const speed = Math.hypot(p.vel.x, p.vel.z), spin = Math.min(1, wheel.spinning || 0), slip = Math.min(1, wheel.slip || 0);
    if (speed < 0.35 && spin < 0.04) { this.lift(key); return; }
    const f = this.forward.set(0, 0, 1).applyQuaternion(p.quat), r = this.right.set(1, 0, 0).applyQuaternion(p.quat);
    const c = Math.cos(wheel.steer || 0), s = Math.sin(wheel.steer || 0);
    const fx = f.x * c - r.x * s, fz = f.z * c - r.z * s;
    const rx = r.x * c + f.x * s, rz = r.z * c + f.z * s;
    const direction = Math.sign(p.forwardSpeed || wheel.omega || 1), moving = Math.min(1, speed / 15);
    const width = index < 2 ? vehicle.spec.style.wheelW : (vehicle.spec.style.wheelWr ?? vehicle.spec.style.wheelW);
    const side = (wheel.x >= 0 ? 1 : -1) * (0.6 + moving) + Math.sin(wheel.slipAngle || 0) * speed * 0.25;
    const kick = 0.5 + moving * 3.0 + spin * 6.0, at = wheel.point;
    if (speed > 0.35) this.tracks.add(key, at.x, at.z, rx, rz, width, 0.72 + slip * 0.28);
    const step = Math.min(0.05, dt), rate = (moving * 230 + spin * 420 + slip * moving * 160) * intensity;
    for (let i = 0, n = Math.floor(rate * step + Math.random()); i < n; i++) {
      const lateral = (Math.random() - 0.5) * width, energy = 0.55 + Math.random() * 0.6;
      this.chunks.spawn(at.x + rx * lateral, at.y + 0.08, at.z + rz * lateral,
        p.vel.x * 0.08 - fx * direction * kick * energy + rx * (side + (Math.random() - 0.5) * 1.4),
        0.6 + Math.random() * (1.3 + moving + spin * 2.4),
        p.vel.z * 0.08 - fz * direction * kick * energy + rz * (side + (Math.random() - 0.5) * 1.4),
        0.018 + Math.random() * (Math.random() < 0.1 ? 0.075 : 0.028));
    }
    const clouds = Math.floor((moving * 24 + spin * 45 + slip * moving * 26) * intensity * step + Math.random());
    for (let i = 0; i < clouds; i++) this.smoke.spawn(at.x, this.chunks.ground(at.x, at.z) + 0.18, at.z,
      p.vel.x * 0.1 - fx * direction * kick * 0.4 + rx * side, 0.4 + Math.random() * 0.8,
      p.vel.z * 0.1 - fz * direction * kick * 0.4 + rz * side,
      0.3 + moving * 0.24, 1.4 + slip * 1.0, 1.0 + Math.random() * 0.7,
      0.78, 0.86, 0.96, 0.2 + slip * 0.12, 2.3, -0.65);
  }

  lift(key) { this.tracks.lift(key); }
  update(dt, light) { this.chunks.update(dt, light); this.tracks.update(dt, light); }
}
