// Vehicle = physics body + visual model + lights + visual interpolation.
import * as THREE from 'three';
import { VehiclePhysics } from './vehiclephysics.js';
import { buildCar } from './carmodel.js';
import { clamp } from '../core/math.js';

export class Vehicle {
  constructor(spec, world, paint = {}, opts = {}) {
    this.spec = spec;
    this.world = world;
    this.paint = { color: spec.color, finish: 'gloss', ...paint };
    this.physics = new VehiclePhysics(spec, world);
    this.root = new THREE.Group();
    this.root.name = 'vehicle:' + spec.id;
    this.isPlayer = !!opts.isPlayer;
    this.buildModel();
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.lightsOn = false;
    this.braking = 0;
    this.headLights = null;
    if (opts.headlights) this.addHeadlights();
  }

  buildModel() {
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.dispose();
      this.model.paintMat.dispose();
    }
    this.model = buildCar(this.spec.style, this.paint);
    this.model.group.position.copy(this.physics.cgModel).negate();
    this.root.add(this.model.group);
    // the authored car brings its own low-poly shadow caster
    if (!this.model.group.userData.visualAsset)
      this.model.group.traverse((o) => {
        if (o.isMesh) o.castShadow = !(Array.isArray(o.material) ? o.material.some((m) => m.transparent) : o.material.transparent);
      });
  }

  setPaint(paint) {
    this.paint = { ...this.paint, ...paint };
    this.buildModel();
    if (this.headLights) {
      this.model.group.add(this.headLights.group);
    }
  }

  addHeadlights() {
    const g = new THREE.Group();
    const lights = [];
    const st = this.spec.style;
    for (const sd of [-1, 1]) {
      const l = new THREE.SpotLight(0xfff1dc, 0, 90, 0.42, 0.55, 1.6);
      l.position.set(sd * (st.W / 2 - 0.35), (st.headlight?.y ?? 0.7) + 0.02, st.WB / 2 + st.fo - 0.2);
      l.target.position.set(sd * 1.2, 0, st.WB / 2 + st.fo + 25);
      g.add(l, l.target);
      lights.push(l);
    }
    this.model.group.add(g);
    this.headLights = { group: g, lights };
  }

  place(x, z, heading, y = null) {
    this.physics.reset(x, z, heading, y);
    this.prevPos.copy(this.physics.pos);
    this.prevQuat.copy(this.physics.quat);
    this.syncVisual(1);
  }

  saveState() {
    this.prevPos.copy(this.physics.pos);
    this.prevQuat.copy(this.physics.quat);
  }

  syncVisual(alpha) {
    const p = this.physics;
    this.root.position.lerpVectors(this.prevPos, p.pos, alpha);
    this.root.quaternion.slerpQuaternions(this.prevQuat, p.quat, alpha);
    const cgH = p.cgH;
    for (let i = 0; i < 4; i++) {
      const w = p.wheels[i];
      const mw = this.model.wheels[i];
      mw.steer.position.y = w.local.y - w.suspLen + cgH;
      if (w.front) mw.steer.rotation.y = -w.steer;
      mw.spin.rotation.x = w.angle;
    }
  }

  updateLights(dt, nightLights, reverse, braking) {
    const L = this.model.lights;
    this.braking += ((braking ? 1 : 0) - this.braking) * Math.min(1, dt * 18);
    L.tailMat.emissiveIntensity = (nightLights ? 1.4 : 0.5) + this.braking * 5.5;
    L.revMat.emissiveIntensity = reverse ? 3 : 0;
    L.headMat.emissiveIntensity = nightLights ? 6 : 1.4;
    if (this.headLights) for (const l of this.headLights.lights) l.intensity = nightLights ? 90 : 0;
  }

  get position() {
    return this.root.position;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.model.dispose();
    this.model.paintMat.dispose();
  }
}

export function speedKmh(v) {
  return v * 3.6;
}
export function clampSteer(s) {
  return clamp(s, -1, 1);
}
