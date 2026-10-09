// Lightning: a forked bolt from the cloud base down to the strike point, flickering through
// a few return strokes in a fraction of a second, and the flash that lights the sky and the
// land around it. Strikes come from climate.js lightningStrikes, so everyone in the world
// sees the same one; this only draws them.

import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

const CLOUD_BASE = 620; // m
const BOLT_RANGE = 5200; // m: farther strikes only light up the clouds
const _v = new THREE.Vector3();
const _side = new THREE.Vector3();

// a jagged path between two points by midpoint displacement
function jag(a, b, levels, spread, rnd) {
  let pts = [a.clone(), b.clone()];
  let s = spread;
  for (let l = 0; l < levels; l++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1],
        q = pts[i];
      const m = p.clone().lerp(q, 0.4 + rnd() * 0.2);
      m.x += (rnd() - 0.5) * s;
      m.z += (rnd() - 0.5) * s;
      m.y += (rnd() - 0.5) * s * 0.25;
      next.push(m, q);
    }
    pts = next;
    s *= 0.55;
  }
  return pts;
}

// a flat ribbon along the path facing the camera, width tapering towards the end
function ribbon(pts, width, cam, out) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const wa = width * (1 - (i / pts.length) * 0.5),
      wb = width * (1 - ((i + 1) / pts.length) * 0.5);
    _v.subVectors(b, a);
    _side.subVectors(a, cam).cross(_v).normalize();
    out.push(a.x - _side.x * wa, a.y - _side.y * wa, a.z - _side.z * wa, a.x + _side.x * wa, a.y + _side.y * wa, a.z + _side.z * wa, b.x - _side.x * wb, b.y - _side.y * wb, b.z - _side.z * wb);
    out.push(b.x - _side.x * wb, b.y - _side.y * wb, b.z - _side.z * wb, a.x + _side.x * wa, a.y + _side.y * wa, a.z + _side.z * wa, b.x + _side.x * wb, b.y + _side.y * wb, b.z + _side.z * wb);
  }
}

// HDR white-blue so bloom gives the bolt a glow; dimmed with distance instead of fogged grey
function boltMaterial(k) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(7 * k, 7.6 * k, 10 * k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
}

export class Lightning {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'lightning';
    scene.add(this.group);
    this.bolts = [];
    this.flash = 0; // how much the land is lit right now (0..~1.5)
    this.skyFlash = 0; // how much the clouds glow
    // an empty bolt for compiling the shader while loading (bolts share its program)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    this.warm = new THREE.Mesh(g, boltMaterial(1));
    this.warm.frustumCulled = false;
    this.warm.visible = false;
    this.group.add(this.warm);
  }

  // a strike at world x/z (ground height gy), seen from the camera at cam
  strike({ x, z, power, seed }, gy, cam) {
    const dist = Math.hypot(x - cam.x, z - cam.z);
    const rnd = mulberry32(seed % 2147483647);
    // 2-4 return strokes over a third of a second
    const strokes = [0];
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) strokes.push(strokes[strokes.length - 1] + 0.05 + rnd() * 0.11);
    const bolt = { age: 0, strokes, power, near: 1 / (1 + (dist / 1100) ** 2), mesh: null };
    if (dist < BOLT_RANGE) {
      const top = new THREE.Vector3(x + (rnd() - 0.5) * 300, CLOUD_BASE + rnd() * 120, z + (rnd() - 0.5) * 300);
      const ground = new THREE.Vector3(x, gy, z);
      const main = jag(top, ground, 7, 160, rnd);
      const pos = [];
      const width = 1.4 + Math.min(3, dist / 900);
      ribbon(main, width, cam, pos);
      // a few forks that die out before the ground
      for (let f = 0; f < 3; f++) {
        const i0 = Math.floor(main.length * (0.1 + rnd() * 0.5));
        const from = main[i0];
        const to = from.clone().add(new THREE.Vector3((rnd() - 0.5) * 260, -(80 + rnd() * 200), (rnd() - 0.5) * 260));
        ribbon(jag(from, to, 5, 70, rnd), width * 0.45, cam, pos);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bolt.mesh = new THREE.Mesh(g, boltMaterial(power * (0.35 + 0.65 * (1 - Math.min(1, dist / BOLT_RANGE)))));
      bolt.mesh.frustumCulled = false;
      this.group.add(bolt.mesh);
    }
    this.bolts.push(bolt);
    return dist;
  }

  // brightness of a bolt's strokes at its age
  static pulse(bolt) {
    let v = 0;
    for (const s of bolt.strokes) {
      const t = bolt.age - s;
      if (t >= 0) v = Math.max(v, Math.exp(-t * 22));
    }
    return v;
  }

  update(dt) {
    let flash = 0,
      sky = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      const p = Lightning.pulse(b) * b.power;
      flash += p * (0.12 + 0.88 * b.near);
      sky += p * (0.35 + 0.65 * b.near);
      if (b.mesh) b.mesh.visible = p > 0.08;
      if (b.age > b.strokes[b.strokes.length - 1] + 0.4) {
        if (b.mesh) {
          this.group.remove(b.mesh);
          b.mesh.geometry.dispose();
          b.mesh.material.dispose();
        }
        this.bolts.splice(i, 1);
      }
    }
    this.flash = Math.min(1.5, flash);
    this.skyFlash = Math.min(1.5, sky);
  }
}
