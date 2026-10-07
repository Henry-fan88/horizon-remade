import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, SURF } from '../src/world/worldgen.js';
import { WORLD } from '../src/config.js';
import { HeightField } from '../src/world/heightfield.js';
import { RoadNetwork } from '../src/world/roadnet.js';
import { World } from '../src/world/world.js';
import { CITY, footprintsOverlap, footprintDistance, cityDestinations, districtDestinations, forestMask, duneMask, mudMask } from '../src/world/districts.js';
import { cityLayout, cityPlan, cityStreetLife } from '../src/world/city-layout.js';
import { SURFACE_INFO } from '../src/world/surfaces.js';
import { roadSnowCoverage } from '../src/world/snow-surface.js';
import { VehiclePhysics } from '../src/vehicle/vehiclephysics.js';
import { CARS } from '../src/vehicle/carspecs.js';
import { buildEvents } from '../src/game/events.js';
import { RoadGraph } from '../src/game/gps.js';
import { CONNECTOR_ROADS, ISLANDS } from '../src/world/regions.js';

const data = generateWorld({}, () => {});
const world = new World(null);
world.data = data;
world.hf = new HeightField(data.heights, WORLD.res, WORLD.size);
world.network = new RoadNetwork(data.roads);
world._near = {};
const destinations = districtDestinations(world.network);
const buildings = cityLayout(world.network, world.hf);

test('generated junctions keep roadside objects clear and provide paved turning corners', () => {
  const junctions = world.network.junctions;
  assert.ok(junctions.items.length > 80, 'junctions were only fixed in one area');
  for (const j of junctions.items) {
    assert.ok(Number.isFinite(j.radius) && j.radius < 130, 'unbounded junction apron');
    for (const arm of j.arms) {
      const k = (arm.index % arm.road.n + arm.road.n) % arm.road.n;
      const { x, z } = arm.road.pointAt(arm.road.s[k] - arm.direction * 2, {});
      assert.ok(junctions.at(x, z, .1), `${arm.road.name}: open junction mouth`);
    }
  }
  for (const [name, stride] of [['lamps', 4], ['posts', 4], ['chevrons', 5], ['fences', 4]]) {
    const values = data.props[name];
    for (let i = 0; i < values.length; i += stride) assert.ok(!junctions.at(values[i], values[i + 2], 1), `${name}: object obstructs a turn`);
  }
  const bridge = junctions.items.find(j => j.links.some(l => l.road.name === 'Puente Este'));
  assert.equal(world.surfaceAt(bridge.x, bridge.z), SURF.ROAD);
});

test('regional terrain materials blend gradually across the former island borders', () => {
  const n = WORLD.res + 1;
  let transition = 0;
  for (let z = 1; z < n; z += 3) for (let x = 1; x < n; x += 3) {
    const i = z * n + x, value = data.regionBlend[i];
    if (value > 10 && value < 245 && data.heights[i] > 2) transition++;
    for (const prev of [i - 1, i - n]) if (data.regionMap[prev] === data.regionMap[i]) {
      assert.ok(Math.abs(value - data.regionBlend[prev]) < 24, 'abrupt biome material boundary');
    }
  }
  assert.ok(transition > 1500, 'transition belts are too narrow');
});

test('all environments share one broad landmass, even with narrow crossings excluded', () => {
  const step = 16, n = WORLD.size / step + 1;
  const dry = new Uint8Array(n * n), visited = new Uint8Array(n * n);
  // Erode the coast by 128 m. A road-width causeway cannot pass this test.
  const offsets = [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128], [90, 90], [-90, 90], [90, -90], [-90, -90]];
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = ix * step - world.half, z = iz * step - world.half;
    dry[iz * n + ix] = offsets.every(([dx, dz]) => world.hf.height(x + dx, z + dz) > WORLD.seaLevel + 1);
  }
  const index = ({ x, z }) => Math.round((z + world.half) / step) * n + Math.round((x + world.half) / step);
  const start = index({ x: 250, z: 1110 });
  const queue = [start]; visited[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % n;
    for (const next of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, i - n, i + n]) {
      if (next >= 0 && next < dry.length && dry[next] && !visited[next]) {
        visited[next] = 1; queue.push(next);
      }
    }
  }
  for (const d of [...destinations, { ...ISLANDS.circuit, id: 'circuit' }]) {
    assert.ok(visited[index(d)], `${d.id}: separated by water or a narrow crossing`);
  }
  assert.ok(world.height(-520, 560) < 0, 'the inland lake was filled');
  assert.ok(world.height(2900, -1700) < 0, 'the surrounding ocean was filled');
});

test('former island channels have dry terrain well beyond the road edges and smooth road joins', () => {
  for (const connector of CONNECTOR_ROADS) {
    const road = world.network.roads.find(r => r.name === connector.name);
    for (let s = 20; s < road.length - 20; s += 12) {
      const p = road.pointAt(s, {});
      assert.ok(Math.abs(p.y - world.height(p.x, p.z)) < 0.6, `${road.name}: road/terrain step`);
      for (const offset of [-200, -100, 0, 100, 200]) {
        assert.ok(world.height(p.x - p.tz * offset, p.z + p.tx * offset) > 2, `${road.name}: water at offset ${offset}`);
      }
    }
  }
});

test('the circuit has a continuous GPS connection through the paddock entrance', () => {
  const graph = new RoadGraph(world.network), start = destinations[0];
  const track = world.network.roads.find(r => r.kind === 'track');
  const finish = track.pointAt(400, {});
  const route = graph.route(start.x, start.z, finish.x, finish.z);
  assert.ok(route.length > 30, 'the circuit is disconnected');
  for (let i = 1; i < route.length; i++) {
    assert.ok(Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]) < 50, 'GPS jumps across a gap');
    assert.ok(world.height(...route[i]) > 2, 'GPS crosses water');
  }
});

test('six environment destinations spawn on dry land, inside their connected roads', () => {
  assert.equal(destinations.length, 6);
  const graph = new RoadGraph(world.network);
  const festivalRoad = world.network.roads.find(r => r.name === 'Festival Drive');
  const start = festivalRoad.pointAt(30, {});
  for (const d of destinations) {
    assert.ok(world.height(d.x, d.z) > 2, `${d.id}: underwater spawn`);
    assert.ok(world.network.nearest(d.x, d.z, 8).dist < .01);
    assert.ok(Number.isFinite(d.heading));
    const route = graph.route(start.x, start.z, d.x, d.z);
    assert.ok(route.length > 10, `${d.id}: no GPS connection from the festival`);
    for (let i = 1; i < route.length; i++) {
      assert.ok(Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]) < 50, `${d.id}: GPS crosses a gap`);
    }
  }
  for (const name of ['Marisma Trail', 'Dunas Trail']) {
    const road = world.network.roads.find(r => r.name === name);
    for (const s of [0, road.length]) {
      const p = road.pointAt(s, {});
      const join = world.network.nearest(p.x, p.z, 5, r => r !== road);
      assert.ok(join && join.dist < 1, `${name}: disconnected endpoint`);
      assert.ok(Math.abs(join.y - p.y) < .7, `${name}: stepped junction`);
    }
  }
});

test('San Francisco neighborhoods have angled parcels, varied architecture and clear driving lanes', () => {
  assert.ok(buildings.length >= 250);
  assert.ok(buildings.filter(b => b.height > 80).length >= 15);
  assert.ok(Math.max(...buildings.map(b => b.height)) > 180);
  assert.ok(buildings.filter(b=>b.neighborhood==='victorian').length>70);
  assert.ok(buildings.filter(b=>b.neighborhood==='chinatown').length>25);
  assert.equal(world.network.roads.filter(r=>r.city).length,18);
  assert.ok(new Set(buildings.map(b=>Math.round(b.yaw*10))).size>20);
  assert.ok(world.height(805,30)-world.height(1480,120)>20,'city should have hills');
  for (const road of world.network.roads) for (let i=0;i<road.n;i+=2) {
    const x=road.pts[i*3],z=road.pts[i*3+2];
    if(Math.abs(x-CITY.x)>620||Math.abs(z-CITY.z)>440)continue;
    for(const b of buildings)assert.ok(footprintDistance(b,x,z)>road.width/2+2,`${road.name}: building in lane`);
  }
  for(let i=0;i<buildings.length;i++)for(let j=i+1;j<buildings.length;j++)assert.ok(!footprintsOverlap(buildings[i],buildings[j]),'overlapping buildings');
});

test('San Francisco blocks have continuous street walls, landmark towers and back yards',()=>{
  const plan=cityPlan(world.network,world.hf);
  for(const name of ['transamerica','salesforce','bofa'])assert.ok(plan.buildings.some(b=>b.landmark===name),`${name} missing`);
  for(const kind of ['victorian','edwardian','apartment','chinatown','commercial','deco','glass','loft','modern'])assert.ok(plan.buildings.some(b=>b.kind===kind),`no ${kind} buildings`);
  // Rowhouse frontages run wall to wall: most neighbours are within a few centimetres.
  const rows=new Map();
  for(const b of plan.buildings.filter(b=>b.road&&['victorian','mission'].includes(b.neighborhood))){const k=`${b.road}:${b.side}`;if(!rows.has(k))rows.set(k,[]);rows.get(k).push(b);}
  const gaps=[];
  for(const row of rows.values()){row.sort((a,b)=>a.along-b.along);for(let i=1;i<row.length;i++)gaps.push(row[i].along-(row[i-1].along+row[i-1].w));}
  gaps.sort((a,b)=>a-b);
  assert.ok(gaps.length>100&&gaps[Math.floor(gaps.length/2)]<.1,'Victorian rows should be continuous');
  assert.ok(plan.yards.length>400,'residential blocks need back yards');
  for(const y of plan.yards){
    assert.ok(plan.buildings.every(b=>footprintDistance(b,y.x,y.z)>1.5),'yard under a building');
    const near=world.network.nearest(y.x,y.z,40);
    assert.ok(!near||near.dist>near.road.width/2+6,'yard on a street');
  }
});

test('sidewalk routes and curb parking stay clear of streets and buildings',()=>{
  const life=cityStreetLife(world.network,world.hf,buildings);
  assert.ok(life.walks.length>100);assert.ok(life.parking.length>150);
  for(const walk of life.walks)for(const p of walk.points){
    const near=world.network.nearest(p.x,p.z,30);
    assert.ok(near.dist>near.road.width/2+2,'walker in traffic');
    assert.ok(buildings.every(b=>footprintDistance(b,p.x,p.z)>=1.49),'walker inside a building');
  }
  for(const p of life.parking)assert.ok(buildings.every(b=>!footprintsOverlap(b,p)),'parking inside a building');
});

test('dunes, forest, snow and mud have substantial distinct surface coverage', () => {
  const counts = { sand: 0, forest: 0, snow: 0, mud: 0 };
  const S = WORLD.res + 1;
  for (let iz = 0; iz <= WORLD.res; iz += 4) for (let ix = 0; ix <= WORLD.res; ix += 4) {
    const x = ix * world.hf.cell - world.half, z = iz * world.hf.cell - world.half;
    const surf = data.surface[iz * S + ix];
    if (surf === SURF.SAND && duneMask(x, z) > .5) counts.sand++;
    if (surf === SURF.FOREST && forestMask(x, z) > .5) counts.forest++;
    if (surf === SURF.SNOW) counts.snow++;
    if (surf === SURF.MUD && mudMask(x, z) > .5) counts.mud++;
  }
  assert.ok(counts.sand > 700, JSON.stringify(counts));
  assert.ok(counts.forest > 1500, JSON.stringify(counts));
  assert.ok(counts.snow > 2000, JSON.stringify(counts));
  assert.ok(counts.mud > 250, JSON.stringify(counts));
  assert.ok(data.veg.pineSnow.length / 5 > 800);
});

test('the wetland tyre query agrees with the painted road and has lower grip', () => {
  const d = destinations.find(d => d.id === 'mud');
  assert.equal(world.surfaceAt(d.x, d.z), SURF.MUD);
  assert.ok(SURFACE_INFO[SURF.MUD].grip < SURFACE_INFO[SURF.DIRTROAD].grip);
  assert.ok(SURFACE_INFO[SURF.MUD].offroad);
});

test('upper Paso Nevado has snow traction where its road cover is snowy; low roads stay dry', () => {
  const pass = world.network.roads.find(r => r.name === 'Paso Nevado');
  for (const fraction of [0.1, 0.3, 0.5, 0.8, 0.87, 0.95]) {
    const p = pass.pointAt(pass.length * fraction, {}), height = world.height(p.x, p.z);
    const snowy = roadSnowCoverage(height) >= 0.5;
    assert.equal(world.surfaceAt(p.x, p.z), snowy ? SURF.SNOW : SURF.ROAD);
  }
  const snow = destinations.find(d => d.id === 'snow');
  assert.equal(world.surfaceAt(snow.x, snow.z), SURF.SNOW);
  for (const d of destinations.filter(d => !['snow', 'mud', 'desert'].includes(d.id))) {
    const road = world.network.roads.find(r => r.name === d.road);
    assert.equal(world.surfaceAt(d.x, d.z), road.surface ?? (road.kind === 'dirt' ? SURF.DIRTROAD : SURF.ROAD));
  }
});

test('new routes and city streets have finite profiles without abrupt grade changes', () => {
  for (const road of world.network.roads.filter(r => r.kind === 'street' || ['Dunas Trail', 'Marisma Trail'].includes(r.name))) {
    for (let i = 1; i < road.n; i++) {
      const ds = road.s[i] - road.s[i - 1];
      const grade = Math.abs(road.pts[i * 3 + 1] - road.pts[(i - 1) * 3 + 1]) / ds;
      assert.ok(Number.isFinite(grade) && grade < .18, `${road.name}: grade ${grade}`);
    }
  }
});

test('a player car settles and can drive forward from all six destinations', () => {
  for (const d of destinations) {
    const car = new VehiclePhysics(CARS[0], world);
    car.reset(d.x, d.z, d.heading);
    for (let i = 0; i < 600; i++) {
      car.input.throttle = i < 120 ? 0 : .25;
      car.input.brake = i < 120 ? 1 : 0;
      car.step(1 / 120);
      assert.ok(Number.isFinite(car.pos.y), `${d.id}: invalid body position`);
      assert.ok(car.pos.y > world.height(car.pos.x, car.pos.z) - .3, `${d.id}: fell through terrain`);
    }
    assert.ok(Math.hypot(car.pos.x - d.x, car.pos.z - d.z) > 2, `${d.id}: unable to leave spawn`);
    assert.ok(car.wheels.filter(w => w.contact).length >= 2, `${d.id}: lost ground contact`);
  }
});

test('hillside junctions and the rebuilt street race follow drivable ground',()=>{
  for(const road of world.network.roads.filter(r=>r.city))for(let s=5;s<road.length-5;s+=4){
    const p=road.pointAt(s,{});
    assert.ok(Math.abs(p.y-world.height(p.x,p.z))<.6,`${road.name}: surface step at ${s}`);
  }
  const event=buildEvents(world).races.find(r=>r.id==='town');
  assert.equal(event.name,'City by the Bay Circuit');
  assert.ok(event.route.length>600);
  for(let s=0;s<event.route.length;s+=3){
    const p=event.route.pointAt(s,0,0),near=world.network.nearest(p.x,p.z,30);
    assert.ok(near&&near.dist<near.road.width/2,`street race leaves road at ${s}`);
    assert.ok(buildings.every(b=>footprintDistance(b,p.x,p.z)>3),'race crosses a building');
  }
});

test('city neighborhood destinations have connected GPS routes and safe road spawns',()=>{
  const graph=new RoadGraph(world.network),start=destinations[0];
  const places=cityDestinations(world.network);assert.equal(places.length,5);
  for(const p of places){
    assert.ok(world.network.nearest(p.x,p.z,3).dist<.01);
    assert.ok(world.height(p.x,p.z)>2);
    assert.ok(graph.route(start.x,start.z,p.x,p.z).length>5,`${p.name}: disconnected`);
  }
});
