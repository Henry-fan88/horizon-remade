import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GameCamera, CAMERA_MODES, COCKPIT } from '../src/game/camera.js';
import { CameraLook, CameraLookInput } from '../src/game/camera-look.js';
import { WORLD } from '../src/config.js';
import { CARS } from '../src/vehicle/carspecs.js';

const DT = 1 / 60;
const world = { height: () => 0 };
const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function rig(spec = CARS[0], mode = COCKPIT, terrain = world) {
  let time = 0;
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 16000);
  const gameCam = new GameCamera(camera);
  gameCam.freeLook = new CameraLook(() => time);
  gameCam.mode = mode;
  const root = new THREE.Group();
  root.position.set(7, 3, 11);
  root.quaternion.setFromEuler(new THREE.Euler(0.13, 0.7, -0.08, 'YXZ'));
  const vehicle = { root, spec, physics: { vel: new THREE.Vector3(), angVel: new THREE.Vector3(),
    cgModel: new THREE.Vector3(0, 0.4, 0), forwardSpeed: 0, grounded: 4, offroadFactor: 0, throttleOut: 0 } };
  const update = (t = time + DT, dt = DT) => { time = t; gameCam.update(dt, vehicle, terrain); };
  update(0);
  return { camera, gameCam, vehicle, look: gameCam.freeLook, update, time: t => { time = t; } };
}

function projected(point, camera) {
  camera.updateMatrixWorld(true);
  return point.clone().project(camera);
}

test('hood, bumper and cockpit views on every car sweep 360 degrees from their normal mounts', () => {
  for (const mode of [2, 3, COCKPIT]) {
    for (const spec of CARS) {
      const { camera, look, update } = rig(spec, mode);
      const eye = camera.position.clone(), forward = camera.getWorldDirection(new THREE.Vector3());
      let previous = camera.quaternion.clone();
      for (let i = 0; i < 8; i++) {
        look.drag(100, 0, 800, 600);
        update();
        assert.ok(camera.position.distanceTo(eye) < 1e-12, spec.id);
        close(camera.quaternion.length(), 1);
        close(previous.angleTo(camera.quaternion), Math.PI / 4, 1e-7);
        previous.copy(camera.quaternion);
        if (i === 3) assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(forward) < -0.9999, 'cannot look behind');
      }
      assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(forward) < 1e-10, spec.id);
    }
  }
});

test('both chase cameras orbit the car through 360 degrees while preserving distance and framing', () => {
  for (const mode of [0, 1]) {
    for (const spec of CARS) {
      const r = rig(spec, mode), normal = rig(spec, mode);
      const carPosition = r.vehicle.root.position.clone(), carRotation = r.vehicle.root.quaternion.clone();
      const pivot = carPosition.clone().add(new THREE.Vector3(0, 0.85, 0));
      for (let i = 0; i < 8; i++) {
        r.look.drag(100, 0, 800, 600);
        r.update(); normal.update();
        const offset = r.camera.position.clone().sub(pivot);
        const normalOffset = normal.camera.position.clone().sub(pivot);
        close(offset.length(), normalOffset.length());
        close(r.camera.quaternion.length(), 1);
        assert.ok(projected(pivot, r.camera).distanceTo(projected(pivot, normal.camera)) < 1e-10, 'orbit lost car framing');
        if (i === 1) {
          assert.ok(r.camera.position.distanceTo(normal.camera.position) > 7, 'camera did not move around the car');
          close(offset.x * normalOffset.x + offset.z * normalOffset.z, 0, 1e-8);
        }
        if (i === 3) assert.ok(offset.dot(normalOffset) < 0, 'cannot inspect the front of the car');
      }
      assert.ok(r.camera.position.distanceTo(normal.camera.position) < 1e-10, spec.id);
      close(r.camera.quaternion.angleTo(normal.camera.quaternion), 0, 1e-7);
      assert.ok(r.vehicle.root.position.equals(carPosition) && r.vehicle.root.quaternion.equals(carRotation), 'drag moved the car');
      assert.ok(r.vehicle.physics.vel.length() === 0 && r.vehicle.physics.angVel.length() === 0, 'drag changed physics');
    }
  }
});

test('vertical drag looks up and down while keeping the view upright', () => {
  for (const mode of [2, 3, COCKPIT]) {
    const { camera, look, update } = rig(CARS[0], mode);
    const normalUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const normalRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    look.drag(0, -10000, 800, 600); update();
    assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(normalUp) > 0.99);
    assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).dot(normalRight) > 0.999);
    look.drag(0, 20000, 800, 600); update();
    assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(normalUp) < -0.99);
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).dot(normalUp) > 0, 'view flipped');
  }
});

test('every camera holds for three seconds and smoothly returns to its original driving pose', () => {
  for (let mode = 0; mode < CAMERA_MODES.length; mode++) {
    const { camera, look, update, vehicle, gameCam } = rig(CARS[0], mode);
    vehicle.root.quaternion.setFromEuler(new THREE.Euler(0, 0.7, 0));
    gameCam.snap(); update(0);
    const forward = camera.quaternion.clone(), eye = camera.position.clone();
    look.drag(350, -80, 800, 600); update(0);
    const held = camera.quaternion.clone();
    update(2.999); close(camera.quaternion.angleTo(held), 0, 1e-7);
    update(3); close(camera.quaternion.angleTo(held), 0, 1e-7);
    const heldPosition = camera.position.clone();
    let previous = camera.quaternion.clone(), previousPosition = camera.position.clone(), distance = previous.angleTo(forward);
    for (let i = 1; i <= 100; i++) {
      update(3 + i * DT);
      assert.ok(previous.angleTo(camera.quaternion) < 0.2, 'return jumped');
      assert.ok(previousPosition.distanceTo(camera.position) < 1.1, 'orbit return jumped');
      if (i === 1) assert.ok(camera.position.distanceTo(heldPosition) < 0.06, 'orbit return started abruptly');
      const next = camera.quaternion.angleTo(forward);
      assert.ok(next <= distance + 1e-7, 'return moved away from forward');
      distance = next; previous.copy(camera.quaternion); previousPosition.copy(camera.position);
    }
    close(camera.quaternion.angleTo(forward), 0, 1e-7);
    assert.equal(look.yaw, 0); assert.equal(look.pitch, 0);
    assert.ok(camera.position.distanceTo(eye) < 1e-12);
  }
});

test('chase orbit continues following a moving and turning car without changing the default follow pose', () => {
  for (const mode of [0, 1]) {
    const r = rig(CARS[0], mode), normal = rig(CARS[0], mode);
    r.look.drag(200, 0, 800, 600);
    for (let i = 1; i <= 120; i++) {
      for (const current of [r, normal]) {
        current.vehicle.root.position.x += 0.15;
        current.vehicle.root.position.z += 0.3;
        current.vehicle.root.quaternion.setFromEuler(new THREE.Euler(0.13, 0.7 + i * 0.008, -0.08, 'YXZ'));
        current.vehicle.physics.vel.set(9, 0, 18);
        current.vehicle.physics.forwardSpeed = 20;
      }
      r.update(i * DT); normal.update(i * DT);
      close(r.look.yaw, -Math.PI / 2);
      assert.ok(r.gameCam.pos.distanceTo(normal.gameCam.pos) < 1e-12);
      assert.ok(r.gameCam.lookAt.distanceTo(normal.gameCam.lookAt) < 1e-12);
      const pivot = r.vehicle.root.position.clone().add(new THREE.Vector3(0, 0.85, 0));
      const ndc = projected(pivot, r.camera);
      assert.ok(Math.abs(ndc.x) < 0.8 && Math.abs(ndc.y) < 0.8 && ndc.z < 1, 'moving car left the view');
    }
    r.update(4); normal.update(4);
    assert.ok(r.camera.position.distanceTo(normal.camera.position) < 1e-12);
    close(r.camera.quaternion.angleTo(normal.camera.quaternion), 0, 1e-7);
  }
});

test('vertical chase orbit stays upright and above terrain and water at extreme drag angles', () => {
  const terrain = { height: x => x > 9 ? 6 : -20 };
  for (const mode of [0, 1]) {
    const r = rig(CARS[0], mode, terrain);
    const pivot = r.vehicle.root.position.clone().add(new THREE.Vector3(0, 0.85, 0));
    r.look.drag(0, 10000, 800, 600); r.update();
    assert.ok(r.camera.position.y > pivot.y + 5, 'drag cannot raise the chase camera');
    for (let i = 0; i < 8; i++) {
      r.look.drag(100, i % 2 ? 20000 : -20000, 800, 600); r.update();
      const p = r.camera.position;
      assert.ok(p.toArray().every(Number.isFinite));
      assert.ok(p.y >= Math.max(terrain.height(p.x, p.z), WORLD.seaLevel) + 0.6);
      assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(r.camera.quaternion).y > 0, 'orbit flipped over');
    }
  }
});

test('fresh drag restarts the idle delay and slow rendering still uses three seconds of wall time', () => {
  const { look, update, time } = rig();
  look.drag(200, 0, 800, 600);
  time(2.9); look.drag(25, 0, 800, 600);
  const held = look.yaw;
  update(5.899, 0.01); close(look.yaw, held);
  update(5.901, 0.01); assert.ok(Math.abs(look.yaw) < Math.abs(held));
  update(10, 0.01); assert.equal(look.yaw, 0, 'return counted rendered frames');
  const before = look.yaw;
  time(10); look.drag(10, 0, 800, 600);
  close(look.yaw, before - Math.PI / 40);
  const resumed = look.yaw;
  update(12.999); close(look.yaw, resumed);
});

class Canvas extends EventTarget {
  constructor() {
    super();
    this.width = 800; this.height = 600; this.captured = new Set(); this.classes = new Set();
    this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c),
      toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c) };
  }
  getBoundingClientRect() { return { width: this.width, height: this.height }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}
function pointer(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
    clientX: 200, clientY: 200, ...properties });
  target.dispatchEvent(event);
  return event;
}
function inputRig(mode = COCKPIT) {
  let enabled = true;
  const r = rig(CARS[0], mode), canvas = new Canvas(), target = new EventTarget();
  const input = new CameraLookInput(canvas, r.look, () => enabled, target);
  return { ...r, canvas, target, input, enable: v => { enabled = v; input.sync(); } };
}

test('only an active left-button canvas drag changes the view, with capture through release', () => {
  const { canvas, look, input } = inputRig();
  pointer(canvas, 'pointermove', { clientX: 400 }); assert.equal(look.yaw, 0);
  pointer(canvas, 'pointerdown', { button: 2 }); assert.equal(input.pointerId, null);
  assert.ok(pointer(canvas, 'pointerdown').defaultPrevented);
  assert.ok(canvas.hasPointerCapture(1));
  pointer(canvas, 'pointermove', { pointerId: 2, clientX: 600 }); assert.equal(look.yaw, 0);
  pointer(canvas, 'pointermove', { clientX: 400 }); close(look.yaw, -Math.PI / 2);
  pointer(canvas, 'pointerup'); assert.equal(input.pointerId, null);
  assert.ok(!canvas.hasPointerCapture(1) && !canvas.classes.has('camera-dragging'));
  pointer(canvas, 'pointermove', { clientX: 700 }); close(look.yaw, -Math.PI / 2);
  input.dispose();
});

test('drag scaling follows the canvas size and UI controls do not change the view', () => {
  const { canvas, look, input } = inputRig();
  const menuButton = new EventTarget();
  pointer(menuButton, 'pointerdown', { pointerType: 'touch' });
  pointer(menuButton, 'pointermove', { pointerType: 'touch', clientX: 700 });
  assert.equal(look.yaw, 0);
  canvas.width = 400; canvas.height = 300;
  pointer(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false });
  pointer(canvas, 'pointermove', { pointerType: 'touch', pointerId: 2, clientX: 300 });
  close(look.yaw, -Math.PI / 2);
  pointer(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 3 });
  pointer(canvas, 'pointermove', { pointerType: 'touch', pointerId: 3, clientX: 400 });
  close(look.yaw, -Math.PI / 2);
  pointer(canvas, 'pointercancel', { pointerType: 'touch', pointerId: 2 });
  assert.equal(input.pointerId, null);
  input.dispose();
});

test('held pointers still recenter after motion stops and another move resumes without a jump', () => {
  const { canvas, look, update, input } = inputRig();
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientX: 400 });
  for (let i = 0; i <= 300; i++) update(i * DT);
  assert.equal(input.pointerId, 1); assert.equal(look.yaw, 0);
  pointer(canvas, 'pointermove', { clientX: 410 }); close(look.yaw, -Math.PI / 40);
  input.dispose();
});

test('pause, camera changes, respawn, lost capture and blur cannot leave a stale drag', () => {
  const { canvas, look, input, enable, target, gameCam, vehicle } = inputRig();
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientX: 400 });
  enable(false); assert.equal(look.yaw, 0); assert.equal(input.pointerId, null);
  assert.ok(!canvas.classes.has('camera-look') && !canvas.hasPointerCapture(1));
  pointer(canvas, 'pointerdown'); assert.equal(input.pointerId, null);
  enable(true); pointer(canvas, 'pointerdown'); pointer(canvas, 'lostpointercapture');
  assert.equal(input.pointerId, null);
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientX: 450 });
  target.dispatchEvent(new Event('blur')); assert.equal(look.yaw, 0); assert.equal(input.pointerId, null);
  look.drag(200, 0, 800, 600); gameCam.snap(); assert.equal(look.yaw, 0);
  look.drag(200, 0, 800, 600); gameCam.cycle(); assert.equal(look.yaw, 0);
  look.drag(200, 0, 800, 600); gameCam.orbit(DT, vehicle.root.position);
  assert.equal(look.yaw, 0);
  input.dispose(); pointer(canvas, 'pointerdown'); assert.equal(input.pointerId, null);
});

test('camera switching and car resets release a held drag in every mode, even while look stays enabled', () => {
  for (let mode = 0; mode < CAMERA_MODES.length; mode++) {
    const { canvas, look, input, gameCam } = inputRig(mode);
    for (const reset of [() => gameCam.cycle(), () => gameCam.snap()]) {
      pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientX: 400 });
      assert.ok(look.yaw !== 0 && canvas.hasPointerCapture(1));
      reset(); input.sync();
      assert.ok(input.enabled && canvas.classes.has('camera-look'));
      assert.equal(input.pointerId, null); assert.equal(look.yaw, 0);
      assert.ok(!canvas.hasPointerCapture(1) && !canvas.classes.has('camera-dragging'));
      pointer(canvas, 'pointermove', { clientX: 600 }); assert.equal(look.yaw, 0);
    }
    input.dispose();
  }
});
