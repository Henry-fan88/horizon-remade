import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {TRAFFIC_SPECS} from '../../src/vehicle/trafficspecs.js';
import {CARS} from '../../src/vehicle/carspecs.js';
import {TrafficSystem} from '../../src/game/traffic.js';
import {SURF} from '../../src/world/worldgen.js';
const bytes=readFileSync(new URL('../../public/models/civilian-traffic/traffic.glb',import.meta.url));
const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
const metadata=JSON.parse(readFileSync(new URL('../../public/models/civilian-traffic/geometry.json',import.meta.url)));

test('eight distinct civilian body styles stay outside the player and race roster',()=>{
 assert.equal(TRAFFIC_SPECS.length,8);
 assert.equal(new Set(TRAFFIC_SPECS.map(s=>s.style.trafficAsset)).size,8);
 for(const spec of TRAFFIC_SPECS){assert.ok(!CARS.some(c=>c.id===spec.id));assert.ok(!spec.style.visualAsset);assert.ok(spec.mass>=1000&&spec.mass<=2200);}
});
test('all civilian models have textures, measured collision bounds and three compact detail levels',()=>{
 assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<8*1024*1024);
 assert.ok(gltf.images.length>0);
 for(const spec of TRAFFIC_SPECS){
  const root=gltf.nodes.find(n=>n.name===spec.style.trafficAsset);assert.ok(root);
  const nodes=root.children.map(i=>gltf.nodes[i]);
  assert.deepEqual([...new Set(nodes.map(n=>n.extras.lod))].sort(),[0,1,2]);
  const st=spec.style;assert.ok(st.H>1.3&&st.H<2.1);assert.ok(st.W>1.5&&st.W<2.4);
  assert.ok(Math.abs(st.WB+st.fo+st.ro-st.L)<.001);
  for(let level=0;level<3;level++){
   const parts=nodes.filter(n=>n.extras.lod===level);assert.deepEqual([...new Set(parts.map(n=>n.extras.role))].sort(),['glass','lamps','paint','wheels']);
   let minY=Infinity,maxY=-Infinity;
   for(const node of parts)for(const primitive of gltf.meshes[node.mesh].primitives){const a=gltf.accessors[primitive.attributes.POSITION];minY=Math.min(minY,a.min[1]);maxY=Math.max(maxY,a.max[1]);}
   assert.ok(minY>-.03,`${spec.id} is below ground`);assert.ok(Math.abs(maxY-st.H)<(level===0?.005:st.H*.05),`${spec.id} height mismatch`);
  }
  const counts=metadata[st.trafficAsset].triangles;assert.ok(counts[0]<8100&&counts[1]<2300&&counts[2]<600);
 }
});
test('each civilian can transition from lane following to a stable physics wreck',()=>{
 const world={network:{roads:[]},height:()=>0,sample:(x,z,n)=>{n.x=0;n.y=1;n.z=0;return 0},surfaceAt:()=>SURF.ROAD};
 const game={world,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),skills:{add(){}},collision:{resolveVehicle(){}}};
 const traffic=new TrafficSystem(game,28);assert.equal(traffic.cars.length,28);
 assert.equal(new Set(traffic.cars.map(c=>c.spec.id)).size,8);
 for(const car of traffic.cars.slice(0,8)){
  car.alive=true;car.body.vel.set(0,0,15);traffic.wreck(car,new THREE.Vector3(4,0,22));
  assert.equal(car.mode,'dyn');assert.equal(car.phys.mass,car.spec.mass);
  for(let i=0;i<240;i++)car.phys.step(1/120);
  assert.ok([...car.phys.pos,...car.phys.vel,...car.phys.quat].every(Number.isFinite),`${car.spec.id} wreck became nonfinite`);
  assert.ok(car.phys.pos.y>0&&car.phys.pos.y<2,`${car.spec.id} wreck fell through road`);
 }
});
