import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SandEffects } from '../src/vehicle/sand-effects.js';
import { buildCactus } from '../src/world/cactus.js';
import { SURF } from '../src/world/worldgen.js';

function fixture(speed = 12, reverse = false) {
  const world = { hf: { height: (x, z) => x * 0.05 + z * 0.025 }, data: {} };
  const clouds = [];
  const effects = new SandEffects(world, { spawn: (...args) => clouds.push(args) });
  const v = { root: { id: 1 }, spec: { style: { wheelW: 0.25, wheelWr: 0.3 } },
    physics: { vel: new THREE.Vector3(0, 0, reverse ? -speed : speed), quat: new THREE.Quaternion(), forwardSpeed: reverse ? -speed : speed } };
  const wheel = { contact: true, surface: SURF.SAND, point: new THREE.Vector3(0, 0, 0), x: 0.8, steer: 0, spinning: 0, slip: 0, slipAngle: 0, omega: reverse ? -40 : 40 };
  return { effects, v, wheel, clouds, world };
}

test('grounded sand emits grains and dust; airborne, paved and stationary wheels do not', () => {
  const { effects, v, wheel, clouds } = fixture();
  for (let i = 0; i < 20; i++) effects.wheel(v, wheel, 0, 1 / 60, 1);
  assert.ok(effects.grains.emitted > 40);
  assert.ok(clouds.length > 0);
  const emitted = effects.grains.emitted;
  wheel.contact = false;
  effects.wheel(v, wheel, 0, 1, 1);
  wheel.contact = true; wheel.surface = SURF.ROAD;
  effects.wheel(v, wheel, 0, 1, 1);
  wheel.surface = SURF.SAND; v.physics.vel.set(0, 0, 0);
  effects.wheel(v, wheel, 0, 1, 1);
  assert.equal(effects.grains.emitted, emitted);
});

test('sand is ejected behind the tire in both forward and reverse travel', () => {
  for (const reverse of [false, true]) {
    const { effects, v, wheel } = fixture(12, reverse);
    effects.wheel(v, wheel, 0, 1 / 60, 1);
    const grains = effects.grains.particles.filter(p => p.alive);
    assert.ok(grains.length > 0);
    assert.ok(grains.every(p => reverse ? p.vz > 0 : p.vz < 0));
  }
});

test('spinning stopped tires throw sand, and grains land on sloping ground and expire', () => {
  const { effects, v, wheel, world } = fixture(0);
  wheel.spinning = 0.9; wheel.slip = 1;
  for (let i = 0; i < 20; i++) effects.wheel(v, wheel, 0, 1 / 60, 1);
  assert.ok(effects.grains.emitted > 70);
  for (let i = 0; i < 180; i++) {
    effects.update(1 / 120, 1);
    for (const p of effects.grains.particles) if (p.alive) assert.ok(p.y >= world.hf.height(p.x, p.z), 'grain passed through a dune');
  }
  assert.equal(effects.grains.count, 0);
});

test('sand tread follows dune heights, clears contact gaps and does not bridge teleports', () => {
  const { effects, v, wheel, world } = fixture();
  effects.wheel(v, wheel, 0, 1 / 60, 1);
  wheel.point.z = 1.5;
  effects.wheel(v, wheel, 0, 1 / 60, 1);
  assert.ok(effects.tracks.count > 0);
  const positions = effects.tracks.position.array;
  for (let i = 0; i < effects.tracks.count * 12 * 3; i += 3) {
    assert.ok(positions[i + 1] >= world.hf.height(positions[i], positions[i + 2]));
    assert.ok(positions[i + 1] < world.hf.height(positions[i], positions[i + 2]) + 0.05);
  }
  const count = effects.tracks.count;
  wheel.contact = false; effects.wheel(v, wheel, 0, 1 / 60, 1);
  wheel.contact = true; wheel.point.z = 2; effects.wheel(v, wheel, 0, 1 / 60, 1);
  assert.equal(effects.tracks.count, count);
  wheel.point.z = 1500; effects.wheel(v, wheel, 0, 1 / 60, 1);
  assert.equal(effects.tracks.count, count);
});

test('long-frame sand emission and long driving sessions remain within fixed geometry budgets', () => {
  const { effects, v, wheel } = fixture(40);
  wheel.spinning = 1; wheel.slip = 1;
  effects.wheel(v, wheel, 0, 10, 1);
  assert.ok(effects.grains.emitted < 65, 'long frame generated an unbounded burst');
  for (let i = 0; i < 1800; i++) {
    wheel.point.z += 1;
    effects.wheel(v, wheel, 0, 1 / 60, 1);
  }
  effects.update(1 / 60, 1);
  assert.ok(effects.grains.count <= 6000);
  assert.equal(effects.tracks.count, 3600);
  assert.ok(effects.tracks.mesh.geometry.drawRange.count <= effects.tracks.mesh.geometry.index.count);
  assert.ok(Math.max(...effects.tracks.mesh.geometry.index.array) < effects.tracks.position.count);
});

test('cactus LODs preserve seed silhouettes with finite geometry and a smaller distant mesh', () => {
  for (const seed of [1078, 1155, 1232]) {
    const near = buildCactus(seed, 0), far = buildCactus(seed, 1);
    near.computeBoundingBox(); far.computeBoundingBox();
    assert.ok(Math.abs(near.boundingBox.max.y - far.boundingBox.max.y) < 0.03);
    assert.ok(near.boundingBox.min.distanceTo(far.boundingBox.min) < 0.14);
    assert.ok(near.boundingBox.max.distanceTo(far.boundingBox.max) < 0.14);
    assert.ok(far.index.count < near.attributes.position.count / 3);
    assert.equal(near.groups.length, 2);
    for (const g of [near, far]) {
      for (const name of ['position', 'normal', 'uv', 'color']) assert.ok(g.attributes[name].array.every(Number.isFinite));
      g.dispose();
    }
  }
});
