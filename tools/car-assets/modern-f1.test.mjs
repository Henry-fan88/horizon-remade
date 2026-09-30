import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARS, CAR_BY_ID } from '../../src/vehicle/carspecs.js';
import { ENGINE_PROFILES } from '../../src/core/engine-profiles.js';
import { buildFormulaSteering } from '../../src/vehicle/formulasteering.js';

for (const id of ['f1', 'sf23', 'rb19']) {
  test(`${id}: exported model supports driving, steering and all distance levels`, () => {
    const car = CAR_BY_ID[id], st = car.style;
    assert.equal(car.year, 2023);
    assert.equal(car.ratios.length, 8);
    assert.equal(car.formula, true);
    assert.ok(ENGINE_PROFILES[car.sound]);
    const bytes = readFileSync(new URL(`../../public/models/${st.visualAsset}/car.glb`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    const node = name => gltf.nodes.find(n => n.name === name);
    const levels = mount => [...new Set(mount.children.map(i => gltf.nodes[i].extras.lod))].sort();
    assert.deepEqual(levels(node('body')), [0, 1, 2]);
    for (const [i, name] of ['wheel_fl','wheel_fr','wheel_rl','wheel_rr'].entries()) {
      const wheel = node(name), front = i < 2;
      assert.ok(wheel, `missing ${name}`);
      assert.deepEqual(levels(wheel), [0, 1, 2]);
      const expected = [(i%2===0 ? 1 : -1)*(front ? st.trackF : st.trackR)/2, front ? st.wheelR : st.wheelRr, (front ? 1 : -1)*st.WB/2];
      for (let k=0;k<3;k++) assert.ok(Math.abs(wheel.translation[k]-expected[k])<.0001, `${name} mount disagrees with physics dimensions`);
      const parts = wheel.children.map(n => gltf.nodes[n]);
      assert.ok(parts.some(p => p.extras.role === 'wheel' && !p.extras.stationary));
      if(front) assert.ok(parts.some(p => p.extras.role === 'carbon' && p.extras.stationary), 'tyre deflectors must not rotate with the tyre');
    }
    for (const material of gltf.materials.filter(m => m.name.startsWith('F1_wheel'))) {
      assert.equal(material.pbrMetallicRoughness.metallicFactor, 0);
      assert.ok(material.pbrMetallicRoughness.roughnessFactor > .8);
    }
    assert.ok(gltf.images.length > 0, 'livery textures must be bundled');
    const meta = JSON.parse(readFileSync(new URL(`../../public/models/${st.visualAsset}/geometry.json`, import.meta.url)));
    assert.ok(meta.triangles[2] < meta.triangles[1] && meta.triangles[1] < meta.triangles[0]);
    assert.ok(meta.triangles[0] < 300000, 'near geometry exceeds browser budget');
    if(id !== 'sf23') assert.deepEqual(levels(node('steering')), [0,1,2]);
  });
}

test('the Ferrari supplemental steering wheel turns without moving its mount', () => {
  const wheel = buildFormulaSteering(CAR_BY_ID.sf23.style);
  const before = wheel.group.position.clone();
  wheel.steeringWheel.rotation.z = .45;
  assert.equal(wheel.steeringWheel.parent, wheel.group);
  assert.ok(wheel.group.position.equals(before));
  assert.ok(wheel.steeringWheel.children.length > 0);
  wheel.dispose();
});

test('formula races have all three team models available', () => {
  assert.deepEqual(CARS.filter(c => c.formula).map(c => c.id).sort(), ['f1', 'rb19', 'sf23']);
});
