// Ambient traffic: instanced cars following road lanes; near misses; crash → physics wreck.
import * as THREE from 'three';
import { buildCar, mergeByMaterial } from '../vehicle/carmodel.js';
import { CAR_BY_ID } from '../vehicle/carspecs.js';
import { VehiclePhysics } from '../vehicle/vehiclephysics.js';
import { resolveVehiclePair } from '../world/colliders.js';
import { clamp } from '../core/math.js';

const TRAFFIC_CARS = ['hatch', 'sedan', 'truck', 'rally'];
const COLORS = ['#e8e8ea', '#1c1f24', '#8d9096', '#b3121a', '#2b3ac4', '#d9c9ae', '#3a5a40', '#6b6f76', '#f2f2f2', '#23395b', '#7a1f2b', '#c9a227'];
const PER_STYLE = 16;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();

class KinBody {
  constructor(spec) {
    const st = spec.style;
    this.mass = spec.mass;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.halfExtents = new THREE.Vector3(st.W / 2, (st.H - st.sill) / 2, st.L / 2);
    this.boxCenterLocal = new THREE.Vector3(0, (st.H + st.sill) / 2, 0);
  }
  invMassAt() {
    return 0;
  }
  applyImpulse() {}
}

export class TrafficSystem {
  constructor(game, count = 28) {
    this.game = game;
    this.world = game.world;
    this.count = count;
    this.enabled = true;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    this.styles = TRAFFIC_CARS.map((id) => this.buildStyle(CAR_BY_ID[id]));
    this.cars = [];
    this.roads = this.world.network.roads.filter((r) => r.kind === 'road' || r.kind === 'highway' || r.kind === 'street');
    this.roadWeights = this.roads.map((r) => r.length);
    this.totalW = this.roadWeights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) this.cars.push(this.newCar(i % this.styles.length));
    game.scene.add(this.group);
    this.nearMissCooldown = 0;
  }

  buildStyle(spec) {
    const car = buildCar(spec.style, { color: '#ffffff' });
    const all = mergeByMaterial([car.group], car.group);
    const meshes = [];
    for (const m of all) {
      let mat = m.material;
      if (mat === car.paintMat) {
        mat = car.paintMat.clone();
        mat.color.set(0xffffff);
      }
      const im = new THREE.InstancedMesh(m.geometry, mat, PER_STYLE);
      im.count = 0;
      im.castShadow = !mat.transparent;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.isPaint = mat !== m.material;
      if (im.isPaint) {
        for (let k = 0; k < PER_STYLE; k++) im.setColorAt(k, _c.set(0xffffff));
      }
      this.group.add(im);
      meshes.push(im);
    }
    // model offset: car model origin is at ground centre; our transforms place the ground centre
    return { spec, meshes, used: 0 };
  }

  newCar(styleIdx) {
    const spec = this.styles[styleIdx].spec;
    return { styleIdx, spec, alive: false, body: new KinBody(spec), color: COLORS[Math.floor(Math.random() * COLORS.length)], mode: 'kin', phys: null, speed: 0, target: 0, road: null, s: 0, dir: 1, lane: 0, timer: 0, passed: new Map() };
  }

  pickRoad() {
    let x = Math.random() * this.totalW;
    for (let i = 0; i < this.roads.length; i++) {
      x -= this.roadWeights[i];
      if (x <= 0) return this.roads[i];
    }
    return this.roads[0];
  }

  spawn(car, near) {
    // pick a road point 180-650 m from the player
    for (let tries = 0; tries < 30; tries++) {
      const road = this.pickRoad();
      const s = Math.random() * road.length;
      const pt = road.pointAt(s, {});
      const d = Math.hypot(pt.x - near.x, pt.z - near.z);
      if (d < 170 || d > 680) continue;
      car.road = road;
      car.s = s;
      car.dir = Math.random() < 0.5 ? 1 : -1;
      const lanes = road.kind === 'highway' ? [0.125, 0.375] : [0.25];
      car.lane = lanes[Math.floor(Math.random() * lanes.length)] * road.width;
      car.target = (road.kind === 'highway' ? 26 + Math.random() * 8 : road.kind === 'street' ? 11 + Math.random() * 4 : 17 + Math.random() * 5) * (0.95 + Math.random() * 0.1);
      car.speed = car.target;
      car.alive = true;
      car.mode = 'kin';
      car.phys = null;
      car.timer = 0;
      car.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      car.passed.clear();
      this.place(car, 0);
      return true;
    }
    return false;
  }

  place(car, dt) {
    const road = car.road;
    const pt = road.pointAt(car.s, this._pt || (this._pt = {}));
    const tx = pt.tx * car.dir,
      tz = pt.tz * car.dir;
    // lane on the right-hand side of travel
    const rx = -tz,
      rz = tx;
    const x = pt.x + rx * car.lane,
      z = pt.z + rz * car.lane;
    const L = car.spec.style.L * 0.4;
    const hF = this.world.height(x + tx * L, z + tz * L),
      hB = this.world.height(x - tx * L, z - tz * L);
    const hL = this.world.height(x - rx * 0.8, z - rz * 0.8),
      hR = this.world.height(x + rx * 0.8, z + rz * 0.8);
    const y = (hF + hB) / 2;
    const heading = Math.atan2(tx, tz);
    const pitch = -Math.atan2(hF - hB, 2 * L);
    const roll = Math.atan2(hR - hL, 1.6);
    _e.set(pitch, heading, roll, 'YXZ');
    const b = car.body;
    if (dt > 0) b.vel.set((x - b.pos.x) / dt, 0, (z - b.pos.z) / dt);
    b.pos.set(x, y, z);
    b.quat.setFromEuler(_e);
  }

  update(dt, player) {
    const game = this.game;
    const on = this.enabled && game.settings.traffic && !game.race.running;
    const pp = player.physics.pos;
    if (!on) {
      for (const st of this.styles) for (const m of st.meshes) m.count = 0;
      for (const c of this.cars) c.alive = false;
      return;
    }
    this.nearMissCooldown -= dt;
    for (const car of this.cars) {
      if (!car.alive) {
        this.spawn(car, pp);
        continue;
      }
      const d = Math.hypot(car.body.pos.x - pp.x, car.body.pos.z - pp.z);
      if (d > 760) {
        car.alive = false;
        continue;
      }
      if (car.mode === 'dyn') {
        car.timer += dt;
        if (car.timer > 10 && d > 120) car.alive = false;
        continue;
      }
      // follow distance: car ahead in the same lane
      let limit = car.target;
      for (const o of this.cars) {
        if (o === car || !o.alive || o.road !== car.road || o.dir !== car.dir || Math.abs(o.lane - car.lane) > 1) continue;
        let ds = (o.s - car.s) * car.dir;
        if (car.road.closed) ds = ((ds % car.road.length) + car.road.length) % car.road.length;
        if (ds > 0 && ds < 28) limit = Math.min(limit, o.mode === 'dyn' ? 0 : o.speed * (ds < 12 ? 0.6 : 1));
      }
      // player ahead in our lane
      const fx = Math.sin(Math.atan2(car.body.vel.x, car.body.vel.z));
      void fx;
      const hx = car.body.pos.x,
        hz = car.body.pos.z;
      const pt = this._pt;
      const tx = pt ? 0 : 0;
      void tx;
      const heading = new THREE.Vector3(0, 0, 1).applyQuaternion(car.body.quat);
      const rpx = pp.x - hx,
        rpz = pp.z - hz;
      const ahead = rpx * heading.x + rpz * heading.z;
      const lat = Math.abs(rpx * heading.z - rpz * heading.x);
      if (ahead > 0 && ahead < 22 && lat < 2.4) limit = Math.min(limit, Math.max(0, player.physics.forwardSpeed * 0.8));
      car.speed += clamp(limit - car.speed, -9 * dt, 2.5 * dt);
      car.s += car.speed * car.dir * dt;
      if (!car.road.closed && (car.s < 0 || car.s > car.road.length)) {
        car.alive = false;
        continue;
      }
      if (car.road.closed) car.s = ((car.s % car.road.length) + car.road.length) % car.road.length;
      this.place(car, dt);
      // collisions with the player
      if (d < 12) {
        const pv = player.physics.vel.clone();
        const imp = resolveVehiclePair(player.physics, car.body, true);
        if (imp > 0) {
          player.physics.lastImpact = Math.max(player.physics.lastImpact, imp);
          if (imp > 5) this.wreck(car, pv);
        }
      }
      // near misses: player passes close at speed
      if (d < 14) {
        const rel = player.physics.vel.clone().sub(car.body.vel).length() * 3.6;
        const along = ahead;
        const key = along > 0 ? 1 : -1;
        const prev = car.passed.get('side');
        if (prev !== undefined && prev !== key && lat > 1.9 && lat < 4.2 && rel > 35 && this.nearMissCooldown <= 0) {
          game.skills.nearMiss(rel);
          this.nearMissCooldown = 0.25;
        }
        car.passed.set('side', key);
      } else car.passed.delete('side');
    }
    this.writeInstances();
  }

  wreck(car, playerVel) {
    const phys = new VehiclePhysics(car.spec, this.world);
    phys.pos.copy(car.body.pos).y += car.spec.cgH;
    phys.quat.copy(car.body.quat);
    phys.vel.copy(car.body.vel).lerp(playerVel, 0.55);
    phys.angVel.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2);
    phys.input.brake = 1;
    phys.gear = 0;
    car.phys = phys;
    car.mode = 'dyn';
    car.timer = 0;
    this.game.vehiclesDyn = this.game.vehiclesDyn || [];
    this.game.skills.add('WRECKED', 150);
  }

  // physics step for wrecked traffic (called from the fixed-step loop)
  stepPhysics(dt, player) {
    for (const car of this.cars) {
      if (!car.alive || car.mode !== 'dyn') continue;
      car.phys.step(dt);
      this.game.collision.resolveVehicle(car.phys);
      resolveVehiclePair(player.physics, car.phys, false);
      car.body.pos.copy(car.phys.pos).y -= car.spec.cgH;
      car.body.quat.copy(car.phys.quat);
    }
  }

  writeInstances() {
    for (const st of this.styles) st.used = 0;
    for (const car of this.cars) {
      if (!car.alive) continue;
      const st = this.styles[car.styleIdx];
      if (st.used >= PER_STYLE) continue;
      const k = st.used++;
      _p.copy(car.body.pos);
      if (car.mode === 'dyn') {
        // physics origin is the CG; model origin is ground centre under the CG
        _p.copy(new THREE.Vector3(0, -car.spec.cgH, -(car.spec.style.WB * car.spec.wf - car.spec.style.WB / 2)).applyQuaternion(car.body.quat).add(car.phys.pos));
      }
      _m.compose(_p, car.body.quat, _s);
      for (const m of st.meshes) {
        m.setMatrixAt(k, _m);
        if (m.isPaint) m.setColorAt(k, _c.set(car.color));
      }
    }
    for (const st of this.styles)
      for (const m of st.meshes) {
        m.count = st.used;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
  }
}
