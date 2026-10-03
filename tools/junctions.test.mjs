import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoadNetwork } from '../src/world/roadnet.js';
import { junctionDistance, atJunctionMouth } from '../src/world/junctions.js';
import { junctionGeometry, trimJunctionOverlaps } from '../src/world/roads.js';
import { smoothLandUnion } from '../src/world/regions.js';

function segment(id, a, b, width = 12) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2), pts = [];
  for (let i = 0; i <= n; i++) pts.push(a[0] + (b[0] - a[0]) * i / n, 0, a[1] + (b[1] - a[1]) * i / n);
  return { id, name: `test-${id}`, kind: 'road', width, closed: false, pts: new Float32Array(pts) };
}
const area = ring => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0)) / 2;
const flat = { height: () => 0, sampleSmooth(x, z, g) { g.gx = g.gz = 0; return 0; } };

test('a T-junction has a rounded driveable apron and strips stop at all three mouths', () => {
  const net = new RoadNetwork([segment(0, [-100, 0], [100, 0]), segment(1, [0, 0], [0, 100])]);
  assert.equal(net.junctions.items.length, 1);
  const j = net.junctions.items[0];
  assert.equal(j.arms.length, 3);
  assert.ok(junctionDistance(j, 8, 8) < 0, 'rounded corner is missing');
  assert.ok(junctionDistance(j, 35, 35) > 0, 'apron expands into unrelated ground');
  for (const { road, start, end } of j.links) {
    assert.ok(net.junctions.removesRow(road, start));
    assert.ok(net.junctions.removesRow(road, end - 1));
    assert.ok(!net.junctions.removesRow(road, end));
    assert.equal(net.junctions.blendAt(road, end), 1, 'crossing edge paint remains');
    assert.equal(net.junctions.blendAt(road, end + 10), 0, 'paint is lost down the approach');
  }
});

test('a junction across a closed-road seam trims both ends of the ribbon', () => {
  const pts = [], n = 160;
  for (let i = 0; i < n; i++) pts.push(50 * Math.cos(i / n * Math.PI * 2), 0, 50 * Math.sin(i / n * Math.PI * 2));
  const net = new RoadNetwork([{ id: 0, kind: 'road', width: 10, closed: true, pts: new Float32Array(pts) }, segment(1, [50, 0], [140, 0])]);
  const loop = net.roads[0];
  assert.equal(net.junctions.items.length, 1);
  assert.ok(net.junctions.removesRow(loop, 0));
  assert.ok(net.junctions.removesRow(loop, n - 1));
  assert.ok(!net.junctions.removesRow(loop, n / 2));
});

test('two terminating roads form a continuous bend without a notch between end caps', () => {
  const net = new RoadNetwork([segment(0, [-100, 0], [0, 0], 10), segment(1, [0, 0], [0, 100], 10)]);
  const j = net.junctions.items[0], ring = j.rings[0][0];
  assert.ok(junctionDistance(j, 0, 0) < 0, 'the route anchor leaves the paved bend');
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length], p = ring[i], b = ring[(i + 1) % ring.length];
    if (atJunctionMouth(j.arms, p.x, p.z)) continue;
    const dot = ((p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z)) / (Math.hypot(p.x - a.x, p.z - a.z) * Math.hypot(b.x - p.x, b.z - p.z));
    assert.ok(Math.acos(Math.max(-1, Math.min(1, dot))) < .8, 'a verge has a sharp notch');
  }
});

test('skew and nearby intersections triangulate once with no overlapping fill', () => {
  for (const roads of [
    [segment(0, [-100, 0], [100, 0], 20), segment(1, [-95, -30], [95, 30])],
    [segment(0, [-100, 0], [100, 0]), segment(1, [0, -100], [0, 100]), segment(2, [-8, -100], [14, 100])],
  ]) {
    const net = new RoadNetwork(roads);
    for (const polygon of net.junctions.surfaces) {
      const expected = area(polygon[0]) - polygon.slice(1).reduce((s, ring) => s + area(ring), 0);
      const geo = junctionGeometry(polygon, flat), pos = geo.attributes.position.array, index = geo.index.array;
      let total = 0;
      for (let i = 0; i < index.length; i += 3) {
        const [a, b, c] = Array.from(index.slice(i, i + 3), v => v * 3);
        const signed = ((pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a])) / 2;
        assert.ok(signed <= 1e-5, 'a road triangle faces underground');
        total -= signed;
      }
      assert.ok(Math.abs(total - expected) < .03, `overlapping or missing fill: ${total} vs ${expected}`);
      geo.dispose();
    }
  }
});

test('terrain joins have continuous slopes and leave distant land and water intact', () => {
  const f = x => smoothLandUnion(20 + x * .2, 20 - x * .2), e = .001;
  const left = (f(0) - f(-e)) / e, right = (f(e) - f(0)) / e;
  assert.ok(Math.abs(left - right) < .001, 'the joined terrain has a crease');
  assert.equal(smoothLandUnion(80, 20), 80);
  assert.equal(smoothLandUnion(-20, -30), -20);
});

test('partial ribbon triangles are clipped out of an apron without losing the approaches', () => {
  const net = new RoadNetwork([segment(0, [-100, 0], [100, 0]), segment(1, [0, 0], [0, 100])]);
  const geo = new THREE.BufferGeometry();
  const pos = [], index = [];
  for (let x = -80; x <= 80; x += 2) pos.push(x, 0, -6, x, 0, 6);
  for (let i = 0; i < 80; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(index);
  trimJunctionOverlaps(geo, net.junctions);
  const p = geo.attributes.position.array, ix = geo.index.array;
  let remaining = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    const x = (p[a] + p[b] + p[c]) / 3, z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    assert.ok(!net.junctions.at(x, z, -.001), 'a second ribbon still covers the junction');
    remaining += Math.abs((p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c] - p[a])) / 2;
  }
  assert.ok(Math.abs(remaining - 1536) < .01, `approach area changed: ${remaining}`);
});
