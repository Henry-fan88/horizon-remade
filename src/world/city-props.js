// San Francisco district: builds the planned blocks, landmarks and streetscape.
// Everything is instanced through CityBatch (shape x material x draw range x cell),
// with per-instance colours so a few facade materials cover every building.
import * as THREE from 'three';
import { cityPlan, cityStreetLife } from './city-layout.js';
import { makeCityMaterials, SignAtlas } from './city-materials.js';
import { CityBatch, makeShapes } from './city-kit.js';
import { BuildingKits } from './city-buildings.js';
import { buildStreets, buildYards } from './city-street.js';
import { buildLandmarks } from './city-landmarks.js';
import { buildCityTrees } from './city-trees.js';
import { batches } from './district-props.js';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .78, ...extra });

export function buildCity(props) {
  const net = props.world.network, hf = props.world.hf;
  const t0 = performance.now();
  const plan = cityPlan(net, hf);
  props.cityBuildings = plan.buildings;
  props.cityStreetLife = cityStreetLife(net, hf, plan.buildings);
  const ctx = {
    props, B: new CityBatch(props), M: makeCityMaterials(props), S: makeShapes(),
    signs: new SignAtlas(props, { cols: 2, rows: 80, cellW: 512, cellH: 56 }),
    blades: new SignAtlas(props, { cols: 16, rows: 4, cellW: 64, cellH: 256, vertical: true }),
    cutouts: new SignAtlas(props, { cols: 2, rows: 16, cellW: 512, cellH: 64, alpha: true }),
    trees: [],
  };
  const kits = new BuildingKits(ctx);
  for (const b of plan.buildings) kits.build(b);
  props.cityShops = kits.shopCount;
  buildLandmarks(ctx, plan);
  buildStreets(ctx, plan);
  buildYards(ctx, plan);
  buildCityTrees(props, ctx.trees);
  const instances = ctx.B.count;
  ctx.B.flush();
  const OB = batches(props);
  buildBayBridge(props, OB, mat(0xf0e4ca));
  OB.flush();
  console.info(`[horizon] city: ${plan.buildings.length} buildings, ${instances} instanced parts, ${ctx.signs.count}+${ctx.blades.count} signs in ${Math.round(performance.now() - t0)} ms`);
  return plan.buildings;
}

function buildBayBridge(props,B,cream){
  const road=props.world.network.roads.find(r=>r.name==='Puente Este');if(!road)return;
  const junctions=props.world.network.junctions;
  const steel=mat(0xb44f37,{metalness:.35,roughness:.5});
  const cableMat=mat(0x604c41,{metalness:.6,roughness:.5});
  const a=road.pointAt(0,{}),end=road.pointAt(road.length,{}),yaw=Math.atan2(end.x-a.x,end.z-a.z),rx=Math.cos(yaw),rz=-Math.sin(yaw),deck=road.width/2+3;
  let cableStart=32,cableEnd=road.length-32;
  while(cableStart<road.length*.2){const p=road.pointAt(cableStart,{});if(!junctions.at(p.x,p.z,10))break;cableStart+=4;}
  while(cableEnd>road.length*.8){const p=road.pointAt(cableEnd,{});if(!junctions.at(p.x,p.z,10))break;cableEnd-=4;}
  for(let s=6;s<road.length-6;s+=6){
    const p=road.pointAt(s,{});
    for(const side of [-1,1]){
      const x=p.x+rx*side*(road.width/2+.4),z=p.z+rz*side*(road.width/2+.4);
      if(junctions.at(x,z,7))continue;
      B.box(steel,x,p.y-.25,z,.8,.8,6.1,yaw,0,2600);
      B.box(steel,x,p.y+.65,z,.07,1.3,.07,yaw,0,1400);
      B.box(steel,x,p.y+1.25,z,.09,.1,6.1,yaw,0,1800);
    }
  }
  for(const f of [.27,.73]){
    const p=road.pointAt(road.length*f,{}),H=86;
    for(const side of [-1,1]){
      const x=p.x+rx*side*deck,z=p.z+rz*side*deck;
      B.box(steel,x,p.y+H/2-4,z,2.7,H+8,3.4,yaw,0,3500);
      B.box(cream,x,p.y-3,z,5,7,6,yaw,0,3000);
      props.game.collision.addBox(x,z,1.35,1.7,-yaw,p.y-5,p.y+H,'building');
    }
    for(const h of [25,48,73])B.box(steel,p.x,p.y+h,p.z,deck*2+2,2.1,2.6,yaw,0,3500);
  }
  for(const side of [-1,1]){
    const points=[];
    for(const s of [cableStart,cableEnd]){
      const p=road.pointAt(s,{}),x=p.x+rx*side*deck,z=p.z+rz*side*deck;
      B.box(cream,x,props.h(x,z)+.85,z,2.4,1.7,4.2,yaw,0,2200);
    }
    for(let i=0;i<=80;i++){
      const s=cableStart+(cableEnd-cableStart)*i/80,f=s/road.length,p=road.pointAt(s,{});
      let h;
      if(f<.27)h=1.7+82.3*((s-cableStart)/(road.length*.27-cableStart))**.7;else if(f>.73)h=1.7+82.3*((cableEnd-s)/(cableEnd-road.length*.73))**.7;else h=22+62*((f-.5)/.23)**2;
      const x=p.x+rx*side*deck,z=p.z+rz*side*deck;
      points.push(new THREE.Vector3(x,p.y+h,z));
      if(i%3===0&&i>0&&i<80&&!junctions.at(x,z,4))B.cylinder(cableMat,x,p.y+h/2,z,.055,h,3000);
    }
    const geo=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),180,.21,6,false),mesh=new THREE.Mesh(geo,cableMat);mesh.castShadow=true;props.group.add(mesh);
  }
}
