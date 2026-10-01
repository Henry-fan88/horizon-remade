// Sand thrown from the real wheel contacts, with ballistic grains and compacted
// tread ribbons projected onto the rendered heightfield. No simulation forces.
import * as THREE from 'three';
import { fogUniforms } from '../world/sky.js';
import { SURF } from '../world/worldgen.js';

const MAX_GRAINS = 6000;
const MAX_TRACKS = 3600;
const CROSS = [-0.8, -0.55, -0.36, 0.36, 0.55, 0.8];

class SandGrains {
  constructor(world) {
    this.world = world;
    const base = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.positions = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GRAINS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GRAINS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.positions); g.setAttribute('iCol', this.colors);
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: fogUniforms(), fog: true, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 iPos; attribute vec4 iCol;
        varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_vertex>
        void main(){ vUv=uv; vCol=iCol;
          vec4 mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
          mvPosition.xy += position.xy * iPos.w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_fragment>
        void main(){
          vec2 q=(vUv-0.5)*2.0;
          float d=dot(q*vec2(1.0,1.25),q*vec2(1.0,1.25));
          float a=(1.0-smoothstep(0.48,1.0,d))*vCol.a;
          if(a<0.015) discard;
          gl_FragColor=vec4(vCol.rgb*(0.78+max(0.0,1.0-d)*0.35),a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'ballistic-sand-grains'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    this.particles = Array.from({ length: MAX_GRAINS }, () => ({ alive: false }));
    this.cursor = 0; this.count = 0; this.emitted = 0;
  }

  spawn(x, y, z, vx, vy, vz, size, color) {
    const p = this.particles[this.cursor]; this.cursor = (this.cursor + 1) % MAX_GRAINS;
    const ground = this.world.hf.height(x, z);
    Object.assign(p, { alive: true, x, y: Math.max(y, ground + 0.035), z, vx, vy, vz, size,
      age: 0, life: 0.75 + Math.random() * 0.6, r: color[0], g: color[1], b: color[2], ground, bounced: false });
    this.emitted++;
  }

  update(dt, light) {
    const P = this.positions.array, C = this.colors.array;
    let n = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      const drag = Math.exp(-1.15 * dt);
      p.vx *= drag; p.vz *= drag; p.vy -= 13.5 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const ground = this.world.hf.height(p.x, p.z);
      if (p.y < ground + 0.015) {
        if (p.bounced || Math.abs(p.vy) < 1.1) { p.alive = false; continue; }
        p.y = ground + 0.018; p.vy = Math.abs(p.vy) * 0.16;
        p.vx *= 0.35; p.vz *= 0.35; p.bounced = true;
      }
      P.set([p.x, p.y, p.z, p.size], n * 4);
      C.set([p.r * light, p.g * light, p.b * light, Math.min(1, (p.life - p.age) * 5)], n * 4);
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    this.positions.needsUpdate = this.colors.needsUpdate = true;
    this.count = n;
  }
}

export class SandTracks {
  constructor(world) {
    this.world = world;
    const g = new THREE.BufferGeometry(), vertices = MAX_TRACKS * CROSS.length * 2;
    this.position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.detail = new THREE.BufferAttribute(new Float32Array(vertices * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint16Array(MAX_TRACKS * (CROSS.length - 1) * 6);
    for (let i = 0; i < MAX_TRACKS; i++) for (let k = 0; k < CROSS.length - 1; k++) {
      const a = i * CROSS.length * 2 + k, b = a + CROSS.length;
      idx.set([a, b, a + 1, a + 1, b, b + 1], (i * (CROSS.length - 1) + k) * 6);
    }
    g.setAttribute('position', this.position); g.setAttribute('aDetail', this.detail); g.setAttribute('color', this.color);
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), time: { value: 0 }, light: { value: 1 } },
      fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: `attribute vec4 aDetail; attribute vec3 color;
        varying vec4 vDetail; varying vec3 vColor;
        #include <fog_pars_vertex>
        void main(){ vDetail=aDetail; vColor=color;
          vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float time; uniform float light;
        varying vec4 vDetail; varying vec3 vColor;
        #include <fog_pars_fragment>
        void main(){
          float x=abs(vDetail.x);
          float edge=1.0-smoothstep(0.58,0.8,x);
          float groove=1.0-smoothstep(0.32,0.5,x);
          float ridge=exp(-pow((x-0.52)*14.0,2.0));
          float tooth=sin(vDetail.y*54.6 + abs(vDetail.x)*6.0);
          float tread=smoothstep(-0.15-fwidth(tooth),0.15+fwidth(tooth),tooth)*groove;
          float age=time-vDetail.z;
          float fade=1.0-smoothstep(55.0,95.0,age);
          float alpha=edge*fade*vDetail.w*(0.28+groove*0.28+tread*0.14);
          if(alpha<0.006)discard;
          vec3 shade=vColor*(0.62+ridge*0.57-tread*0.1)*light;
          gl_FragColor=vec4(shade,alpha);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'sand-tire-impressions'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.last = new Map(); this.cursor = 0; this.count = 0; this.time = 0;
    this._surfaceColor = new THREE.Color();
  }

  lift(key) { this.last.delete(key); }

  sampleColor(x, z) {
    const hf = this.world.hf, colors = this.world.data?.colors;
    if (!colors) return this._surfaceColor.setRGB(0.67, 0.53, 0.32);
    const ix = Math.max(0, Math.min(hf.res, Math.round((x + hf.half) / hf.cell)));
    const iz = Math.max(0, Math.min(hf.res, Math.round((z + hf.half) / hf.cell)));
    const offset = (iz * (hf.res + 1) + ix) * 4;
    return this._surfaceColor.setRGB(colors[offset] / 255, colors[offset + 1] / 255, colors[offset + 2] / 255, THREE.SRGBColorSpace);
  }

  add(key, x, z, rx, rz, width, strength) {
    const prev = this.last.get(key);
    const distance = prev ? Math.hypot(x - prev.x, z - prev.z) : 0;
    if (prev && distance < 0.12) return;
    const next = { x, z, rx, rz, width, strength, along: (prev?.along ?? 0) + distance };
    if (prev && distance < 6) {
      // Short pieces follow dune slopes and never cut across the heightfield.
      const steps = Math.ceil(distance / 0.28);
      let from = prev;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const to = { x: prev.x + (x - prev.x) * t, z: prev.z + (z - prev.z) * t,
          rx: prev.rx + (rx - prev.rx) * t, rz: prev.rz + (rz - prev.rz) * t,
          width, strength, along: prev.along + distance * t };
        this.segment(from, to); from = to;
      }
    }
    this.last.set(key, next);
  }

  segment(from, to) {
    const start = this.cursor * CROSS.length * 2;
    this.cursor = (this.cursor + 1) % MAX_TRACKS; this.count = Math.min(MAX_TRACKS, this.count + 1);
    for (let row = 0; row < 2; row++) {
      const p = row ? to : from, col = this.sampleColor(p.x, p.z);
      for (let k = 0; k < CROSS.length; k++) {
        const cross = CROSS[k], v = start + row * CROSS.length + k;
        const x = p.x + p.rx * cross * p.width, z = p.z + p.rz * cross * p.width;
        const berm = Math.exp(-(((Math.abs(cross) - 0.52) * 14) ** 2)) * 0.022;
        this.position.array.set([x, this.world.hf.height(x, z) + 0.016 + berm, z], v * 3);
        this.detail.array.set([cross, p.along, this.time, p.strength], v * 4);
        this.color.array.set([col.r, col.g, col.b], v * 3);
      }
    }
    this.mesh.geometry.setDrawRange(0, this.count * (CROSS.length - 1) * 6);
    this.position.needsUpdate = this.detail.needsUpdate = this.color.needsUpdate = true;
  }

  update(dt, light) {
    this.time += dt;
    this.material.uniforms.time.value = this.time;
    this.material.uniforms.light.value = light;
  }
}

export class SandEffects {
  constructor(world, smoke) {
    this.world = world; this.smoke = smoke;
    this.grains = new SandGrains(world); this.tracks = new SandTracks(world);
    this.group = new THREE.Group(); this.group.name = 'sand-wheel-effects';
    this.group.add(this.grains.mesh, this.tracks.mesh);
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3();
    this._color = [0.75, 0.6, 0.37];
  }

  wheel(vehicle, wheel, index, dt, intensity) {
    const p = vehicle.physics, key = vehicle.root.id * 4 + index;
    if (!wheel.contact || wheel.surface !== SURF.SAND) { this.tracks.lift(key); return; }
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const spin = Math.min(1, wheel.spinning || 0), slip = Math.min(1, wheel.slip || 0);
    const moving = Math.min(1, speed / 12);
    if (speed < 0.35 && spin < 0.04) { this.tracks.lift(key); return; }
    const f = this.forward.set(0, 0, 1).applyQuaternion(p.quat);
    const r = this.right.set(1, 0, 0).applyQuaternion(p.quat);
    const steer = wheel.steer || 0, c = Math.cos(steer), s = Math.sin(steer);
    const fx = f.x * c + r.x * s, fz = f.z * c + r.z * s;
    const rx = r.x * c - f.x * s, rz = r.z * c - f.z * s;
    const direction = Math.sign(p.forwardSpeed || wheel.omega || 1);
    const side = wheel.x >= 0 ? 1 : -1;
    const width = index < 2 ? vehicle.spec.style.wheelW : (vehicle.spec.style.wheelWr ?? vehicle.spec.style.wheelW);
    const kick = 0.7 + Math.min(7, speed * 0.18) + spin * 7;
    const sideways = side * (0.45 + moving * 0.9) + Math.sin(wheel.slipAngle || 0) * speed * 0.23;
    const contact = wheel.point;
    const color = this.tracks.sampleColor(contact.x, contact.z);
    this._color[0] = color.r; this._color[1] = color.g; this._color[2] = color.b;
    if (speed > 0.35) this.tracks.add(key, contact.x, contact.z, rx, rz, width, 0.7 + slip * 0.3);
    const rate = (moving * 360 + spin * 560 + slip * moving * 240) * intensity;
    const count = Math.floor(rate * Math.min(0.05, dt) + Math.random());
    for (let i = 0; i < count; i++) {
      const lateral = (Math.random() - 0.5) * width;
      const energy = 0.55 + Math.random() * 0.8;
      const scale = 0.76 + Math.random() * 0.4;
      const tint = this._color.map(value => value * scale);
      this.grains.spawn(contact.x + rx * lateral - fx * direction * 0.09, contact.y + 0.04, contact.z + rz * lateral - fz * direction * 0.09,
        p.vel.x * 0.12 - fx * direction * kick * energy + rx * (sideways + (Math.random() - 0.5) * 2.7),
        0.45 + Math.random() * (1.2 + moving * 1.3 + spin * 3.2),
        p.vel.z * 0.12 - fz * direction * kick * energy + rz * (sideways + (Math.random() - 0.5) * 2.7),
        (Math.random() < 0.08 ? 0.03 : 0.009) + Math.random() * 0.024, tint);
    }
    const dustRate = (moving * 30 + spin * 50 + slip * moving * 35) * intensity;
    const clouds = Math.floor(dustRate * Math.min(0.05, dt) + Math.random());
    for (let i = 0; i < clouds; i++) {
      this.smoke.spawn(contact.x + (Math.random() - 0.5) * width, Math.max(contact.y, this.world.hf.height(contact.x, contact.z)) + 0.15, contact.z,
        p.vel.x * 0.1 - fx * direction * kick * 0.4 + rx * sideways, 0.5 + Math.random() * 0.9,
        p.vel.z * 0.1 - fz * direction * kick * 0.4 + rz * sideways,
        0.3 + moving * 0.25, 1.65 + moving * 0.7 + slip * 1.2, 1.8 + Math.random() * 1.2,
        color.r * 0.94, color.g * 0.94, color.b * 0.94, 0.2 + slip * 0.11, 1.1, -0.08);
    }
  }

  lift(key) { this.tracks.lift(key); }

  update(dt, light) { this.grains.update(dt, light); this.tracks.update(dt, light); }
}
