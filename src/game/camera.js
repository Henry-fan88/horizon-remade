// Chase / hood / bumper / cinematic cameras.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from '../core/math.js';

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

export const CAMERA_MODES = ['Chase', 'Far Chase', 'Hood', 'Bumper'];

export class GameCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.lag = 0;
    this.shake = 0;
    this.shakeT = 0;
    this.baseFov = 62;
    this.fov = 62;
    this.lookBack = false;
    this.initialized = false;
    this.orbitAngle = 0;
    this.pitchFollow = 0;
    this.prevVel = new THREE.Vector3();
    this.accelSmooth = 0;
    this.cinematic = null;
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.initialized = false;
  }

  addShake(a) {
    this.shake = Math.min(1.5, this.shake + a);
  }

  snap() {
    this.initialized = false;
  }

  update(dt, vehicle, world) {
    const cam = this.camera;
    const p = vehicle.root.position;
    const q = vehicle.root.quaternion;
    const phys = vehicle.physics;
    const vel = phys.vel;
    const speed = vel.length();
    _fwd.set(0, 0, 1).applyQuaternion(q);
    let heading = Math.atan2(_fwd.x, _fwd.z);
    const reversing = phys.forwardSpeed < -1.5;
    if (speed > 4 && !reversing) {
      const vh = Math.atan2(vel.x, vel.z);
      heading += clamp(wrapAngle(vh - heading), -0.9, 0.9) * 0.42;
    }
    if (this.lookBack) heading += Math.PI;
    // acceleration spring
    const acc = phys.forwardSpeed - (this._lastFwd ?? phys.forwardSpeed);
    this._lastFwd = phys.forwardSpeed;
    this.accelSmooth = damp(this.accelSmooth, clamp(acc / Math.max(dt, 1e-3), -25, 25), 3, dt);

    if (!this.initialized) {
      this.yaw = heading;
      this.pitchFollow = 0;
    }
    this.yaw = dampAngle(this.yaw, heading, this.mode >= 2 ? 30 : 5.2 + Math.min(speed, 40) * 0.05, dt);

    const kmh = speed * 3.6;
    let targetFov = this.baseFov;
    if (this.mode <= 1) {
      const dist = (this.mode === 0 ? 5.7 : 8.2) + Math.min(kmh, 300) * 0.0055 + clamp(this.accelSmooth, -8, 12) * 0.045;
      const height = (this.mode === 0 ? 1.75 : 2.45) - Math.min(kmh, 300) * 0.0012;
      // pitch follow on slopes
      this.pitchFollow = damp(this.pitchFollow, clamp(_fwd.y, -0.35, 0.35), 3, dt);
      const dx = Math.sin(this.yaw),
        dz = Math.cos(this.yaw);
      _tgt.set(p.x - dx * dist, p.y + height - this.pitchFollow * dist * 0.7, p.z - dz * dist);
      // stay above the ground and the water surface
      const ground = Math.max(world.height(_tgt.x, _tgt.z), WORLD.seaLevel) + 0.6;
      if (_tgt.y < ground) _tgt.y = ground;
      if (!this.initialized) this.pos.copy(_tgt);
      else {
        this.pos.x = damp(this.pos.x, _tgt.x, 18, dt);
        this.pos.z = damp(this.pos.z, _tgt.z, 18, dt);
        this.pos.y = damp(this.pos.y, _tgt.y, 9, dt);
        if (this.pos.y < ground) this.pos.y = ground;
      }
      _look.set(p.x + dx * 3.2, p.y + 0.85 - this.pitchFollow * 1.5, p.z + dz * 3.2);
      if (!this.initialized) this.lookAt.copy(_look);
      else this.lookAt.lerp(_look, 1 - Math.exp(-dt * 25));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.lookAt);
      targetFov = this.baseFov + clamp((kmh - 40) / 260, 0, 1) * 16;
    } else {
      // hood / bumper cams are rigidly attached with a little smoothing
      const st = vehicle.spec.style;
      const cg = phys.cgModel;
      const hoodZ = st.cabin.a + 0.25;
      if (this.mode === 2) _tgt.set(0, st.top[0] ? interpolateTop(st, hoodZ) + 0.32 - cg.y : 1.2, hoodZ - cg.z);
      else _tgt.set(0, st.sill + 0.42 - cg.y, st.WB / 2 + st.fo + 0.05 - cg.z);
      _tgt.applyQuaternion(q).add(p);
      cam.position.copy(_tgt);
      _m.lookAt(_origin, _look.set(0, 0, this.lookBack ? -1 : 1).applyQuaternion(q), _worldUp);
      // keep horizon steadier: blend roll out
      _q.setFromRotationMatrix(_m);
      cam.quaternion.copy(_q);
      targetFov = this.baseFov + 6 + clamp((kmh - 40) / 260, 0, 1) * 12;
    }
    this.initialized = true;
    // shake: speed rumble + impacts
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.shakeT += dt;
    const rumble = clamp((kmh - 150) / 250, 0, 1) * 0.012 + (phys.grounded > 0 ? phys.offroadFactor * clamp(kmh / 120, 0, 1) * 0.02 : 0);
    const sh = rumble + this.shake * 0.08;
    if (sh > 0) {
      cam.position.x += (Math.sin(this.shakeT * 37.1) + Math.sin(this.shakeT * 23.3)) * sh * 0.5;
      cam.position.y += (Math.sin(this.shakeT * 41.7) + Math.sin(this.shakeT * 19.1)) * sh * 0.5;
      cam.rotation.z += Math.sin(this.shakeT * 29.3) * sh * 0.3;
    }
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  // slow orbit around a target (menus / title / garage)
  orbit(dt, target, radius = 6.5, height = 1.3, speed = 0.12, world = null) {
    this.orbitAngle += dt * speed;
    const cam = this.camera;
    const x = target.x + Math.sin(this.orbitAngle) * radius,
      z = target.z + Math.cos(this.orbitAngle) * radius;
    let y = target.y + height;
    if (world) y = Math.max(y, Math.max(world.height(x, z), WORLD.seaLevel) + 0.5);
    cam.position.set(x, y, z);
    cam.lookAt(target.x, target.y + 0.5, target.z);
    this.fov = damp(this.fov, 42, 2, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.initialized = false;
  }
}

function interpolateTop(st, z) {
  const t = st.top;
  for (let i = 0; i < t.length - 1; i++) if (z >= t[i][0] && z <= t[i + 1][0]) return lerp(t[i][1], t[i + 1][1], (z - t[i][0]) / (t[i + 1][0] - t[i][0]));
  return t[t.length - 1][1];
}
