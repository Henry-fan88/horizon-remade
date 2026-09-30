// Shared, DOM-free definitions for scenery, the map and environment inspection.
import { smoothstep, mulberry32 } from '../core/math.js';

export const CITY = { x: 1000, z: 170, extent: 560 };

// A compressed, playable interpretation of San Francisco. Different neighborhood
// alignments meet Market's diagonal; the waterfront follows the bay, not a grid.
export const CITY_STREETS = [
  ['Market Street', 18, [[-450,260],[-300,210],[-90,135],[100,55],[280,-40],[480,-125]]],
  ['Embarcadero', 16, [[420,-300],[490,-180],[510,-40],[495,90],[460,260],[355,340]]],
  ['Columbus Avenue', 12, [[100,55],[20,-25],[-60,-145],[-75,-295]]],
  ['California Street', 12, [[-420,45],[-230,20],[-65,-10],[120,-35],[300,-65],[480,-125]]],
  ['Broadway', 12, [[-360,-145],[-210,-150],[-40,-165],[150,-180],[380,-195],[490,-180]]],
  ['Grant Avenue', 10, [[-25,110],[-30,45],[-30,-25],[-25,-160],[-30,-290]]],
  ['Stockton Street', 10, [[-150,156],[-140,45],[-130,-95],[-115,-245],[-75,-295]]],
  ['Powell Street', 12, [[-300,210],[-240,100],[-220,-10],[-190,-150],[-170,-300]]],
  ['Lombard Street', 8, [[-360,-145],[-390,-210],[-350,-255],[-307,-225],[-277,-276],[-246,-234],[-210,-279],[-170,-300],[-75,-295],[-30,-290],[155,-310],[420,-300]]],
  ['Steiner Street', 10, [[-450,260],[-420,190],[-430,70],[-420,-70],[-360,-145]]],
  ['Haight Street', 11, [[-450,260],[-310,310],[-180,290],[-50,230],[75,165]]],
  ['Mission Street', 14, [[-320,350],[-200,310],[-50,250],[120,170],[290,90],[495,90]]],
  ['Howard Street', 12, [[-100,330],[55,260],[225,200],[460,260]]],
  ['Second Street', 12, [[150,-180],[170,-90],[210,0],[265,85],[325,190],[355,340]]],
  ['Third Street', 12, [[-40,-165],[70,-50],[100,55],[145,175],[190,260],[240,345]]],
  ['Vallejo Street', 10, [[-420,-70],[-240,-60],[-130,-95],[-30,-80],[90,-100],[240,-105],[300,-65]]],
  ['Battery Street', 12, [[155,-310],[265,-220],[285,-130],[300,-65],[330,20],[375,140],[410,280]]],
  ['Bay Street', 12, [[-320,350],[-100,330],[75,340],[240,345],[355,340]]],
].map(([name, width, points]) => ({ name, width, points: points.map(([x,z]) => [CITY.x+x,CITY.z+z]) }));

export const CITY_PARKS = [
  { name: 'Alamo Square', x: 641, z: 316, r: 31 },
  { name: 'Telegraph Hill', x: 1080, z: -66, r: 24 },
];
export const cityMask = (x,z) => 1 - smoothstep(.86, 1.08, Math.hypot((x-1030)/580,(z-175)/420));
export function cityTerrainHeight(x,z) {
  const hill = (cx,cz,rx,rz,h) => h * Math.exp(-(((x-cx)/rx)**2 + ((z-cz)/rz)**2));
  return 7 + hill(805,30,240,230,34) + hill(665,290,200,240,18) + hill(1060,-40,160,180,13);
}

export const forestMask = (x, z) => 1 - smoothstep(0.55, 1.05, Math.hypot((x + 885) / 550, (z + 300) / 670));
export const duneMask = (x, z) => 1 - smoothstep(0.45, 1.1, Math.hypot((x + 2440) / 420, (z - 810) / 440));
export const mudMask = (x, z) => 1 - smoothstep(0.55, 1.05, Math.hypot((x + 785) / 205, (z - 500) / 265));

export const DISTRICTS = [
  { id: 'city', name: 'San Francisco', label: 'City by the bay', road: 'Market Street', fraction: .46, description: 'Hilly neighborhoods, Victorian homes, Chinatown shops, downtown towers and a curved waterfront. A San Francisco-inspired drive.' },
  { id: 'desert', name: 'Dunas Doradas', label: 'Desert', road: 'Dunas Trail', fraction: .54, description: 'Golden sand dunes, cactus scrub and red sandstone mesas on the western island.' },
  { id: 'forest', name: 'Bosque Verde', label: 'Forest', road: 'Selva Trail', fraction: .35, description: 'A winding dirt trail beneath a dense mixed woodland canopy.' },
  { id: 'rural', name: 'Valle de las Granjas', label: 'Rural countryside', road: 'Granja Road', fraction: .36, description: 'Patchwork farmland, barns, silos and quiet country lanes.' },
  { id: 'snow', name: 'Sierra Nevada', label: 'Snow', road: 'Paso Nevado', fraction: .87, description: 'Snowy pine forests, mountain chalets and a high switchback road.' },
  { id: 'mud', name: 'Marisma del Lago', label: 'Mud & wetlands', road: 'Marisma Trail', fraction: .49, description: 'A slippery lakeside mud trail with puddles, reeds and wet woodland.' },
];

export function districtDestinations(network) {
  return DISTRICTS.flatMap((district) => {
    const road = network.roads.find((r) => r.name === district.road);
    if (!road) return [];
    const p = road.pointAt(road.length * district.fraction, {});
    return [{ ...district, x: p.x, z: p.z, y: p.y, heading: Math.atan2(p.tx, p.tz), tx: p.tx, tz: p.tz }];
  });
}

export function cityDestinations(network) {
  return [
    ['painted-ladies','Painted Ladies','Steiner Street',.28,'Pastel Victorian houses overlooking the hillside neighborhood.'],
    ['chinatown','Chinatown','Grant Avenue',.42,'Lantern gateways, grocery stores, bakeries and dim sum shops.'],
    ['lombard','Lombard Street','Lombard Street',.17,'A winding hillside street above the bay.'],
    ['waterfront','Embarcadero & Ferry Building','Embarcadero',.4,'Bay views, a waterfront promenade and the ferry clock tower.'],
    ['bay-bridge','Golden Gate-inspired crossing','Puente Este',.5,'A red suspension bridge along the eastern island crossing.'],
  ].map(([id,name,roadName,fraction,description])=>{
    const road=network.roads.find(r=>r.name===roadName),p=road.pointAt(road.length*fraction,{});
    return {id,name,road:roadName,fraction,description,label:'San Francisco',x:p.x,y:p.y,z:p.z,tx:p.tx,tz:p.tz,heading:Math.atan2(p.tx,p.tz)};
  });
}

// Sample the entire footprint, not just the centre: existing highways and approach
// roads cut diagonally through several blocks. Keep sidewalks outside their lanes.
export function clearFootprint(network, x, z, w, d, margin = 4, yaw = 0) {
  const nx = Math.max(1,Math.ceil(w / 4)), nz = Math.max(1,Math.ceil(d / 4)), c = Math.cos(yaw), s = Math.sin(yaw);
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    const u = -w/2+w*ix/nx, v = -d/2+d*iz/nz;
    const near = network.nearest(x+c*u+s*v, z-s*u+c*v, 45);
    if (near && near.dist < near.road.width / 2 + margin) return false;
  }
  return true;
}

export function cityLayout(network, hf) {
  const random = mulberry32(77421), buildings = [];
  for (const road of network.roads.filter(r=>r.city)) for (const side of [-1,1]) {
    if(road.name==='Embarcadero'&&side===-1)continue;
    for (let along = 17; along < road.length - 15;) {
      const p = road.pointAt(along, {});
      const neighborhood = p.x < 810 ? 'victorian' : p.x < 1060 && p.z < 255 ? 'chinatown' : p.x > 1390 ? 'waterfront' : p.z > 360 ? 'soma' : p.x > 1080 ? 'downtown' : 'northbeach';
      const house = neighborhood === 'victorian', office = neighborhood === 'downtown';
      const w = house ? 8.5+random()*4 : office ? 20+random()*15 : 13+random()*10;
      const d = house ? 14+random()*6 : office ? 23+random()*12 : 16+random()*10;
      along += w + (house ? 2.3 : 4.5+random()*4);
      const setback = road.width/2 + 7 + d/2;
      const x = p.x-p.tz*side*setback, z = p.z+p.tx*side*setback;
      const yaw = Math.atan2(p.tz*side,-p.tx*side);
      const waterfront=network.nearest(x,z,85,r=>r.name==='Embarcadero',{});
      if(waterfront&&waterfront.lateral<0)continue;
      const b = { x,z,w,d,yaw,road:road.name,along:along-w,side,neighborhood,style:Math.floor(random()*6),block:buildings.length };
      if (cityMask(x,z)<.3 || CITY_PARKS.some(v=>Math.hypot(x-v.x,z-v.z)<v.r+Math.hypot(w,d)/2)) continue;
      if (!clearFootprint(network,x,z,w+1,d+1,5,yaw) || buildings.some(a=>footprintsOverlap(a,b,1.5))) continue;
      const c=Math.cos(yaw), s=Math.sin(yaw);
      const ys=[-1,1].flatMap(u=>[-1,1].map(v=>hf.height(x+c*u*w/2+s*v*d/2,z-s*u*w/2+c*v*d/2)));
      if (Math.min(...ys)<2.5 || Math.max(...ys)-Math.min(...ys)>8) continue;
      b.y = hf.height(x+s*d/2,z+c*d/2); b.base = Math.min(...ys)-.45;
      const core = Math.max(0,1-Math.hypot((x-1220)/280,(z-180)/280));
      b.height = house ? 8.2+Math.floor(random()*2)*3.1 : office ? 23+Math.floor(8+core*(20+random()*23))*3.4 : neighborhood==='waterfront' ? 9+random()*8 : 12+Math.floor(random()*5)*3.2;
      b.core = core; buildings.push(b);
    }
  }
  const towers = buildings.filter(b=>b.neighborhood==='downtown').sort((a,b)=>b.height-a.height);
  if (towers[0]) { towers[0].landmark='pyramid'; towers[0].height=184; }
  if (towers[1]) { towers[1].landmark='crown'; towers[1].height=202; }
  return buildings;
}

export function footprintDistance(b,x,z) {
  const c=Math.cos(b.yaw||0),s=Math.sin(b.yaw||0),dx=x-b.x,dz=z-b.z;
  return Math.hypot(Math.max(0,Math.abs(c*dx-s*dz)-b.w/2),Math.max(0,Math.abs(s*dx+c*dz)-b.d/2));
}

// Separating axes for rotated lots: narrow hillside parcels never overlap corners.
export function footprintsOverlap(a,b,gap=0) {
  if (Math.hypot(a.x-b.x,a.z-b.z)>(Math.hypot(a.w,a.d)+Math.hypot(b.w,b.d))/2+gap) return false;
  const axes = q=>[[Math.cos(q.yaw||0),-Math.sin(q.yaw||0)],[Math.sin(q.yaw||0),Math.cos(q.yaw||0)]];
  const aa=axes(a),bb=axes(b);
  for (const [x,z] of [...aa,...bb]) {
    const ra=Math.abs(x*aa[0][0]+z*aa[0][1])*a.w/2+Math.abs(x*aa[1][0]+z*aa[1][1])*a.d/2;
    const rb=Math.abs(x*bb[0][0]+z*bb[0][1])*b.w/2+Math.abs(x*bb[1][0]+z*bb[1][1])*b.d/2;
    if (Math.abs((a.x-b.x)*x+(a.z-b.z)*z)>ra+rb+gap) return false;
  }
  return true;
}

// Sidewalks are split at every intersection. Walkers reverse at the ends instead
// of wandering into live traffic. Parking occupies separate curbside pull-outs.
export function cityStreetLife(network,hf,buildings=cityLayout(network,hf)) {
  const walks=[],parking=[],random=mulberry32(50012);
  for (const road of network.roads.filter(r=>r.city)) for (const side of [-1,1]) {
    let segment=[];
    const finish=()=>{if(segment.length>=6)walks.push({road:road.name,side,points:segment});segment=[];};
    for(let s=10;s<road.length-10;s+=3){
      const p=road.pointAt(s,{}),offset=road.width/2+4.5;
      const x=p.x-p.tz*side*offset,z=p.z+p.tx*side*offset;
      const other=network.nearest(x,z,24,r=>r!==road,{});
      const own=network.nearest(x,z,24,r=>r===road,{});
      if(hf.height(x,z)<2.5 || (own&&own.dist<road.width/2+3.2) || (other&&other.dist<other.road.width/2+3) || buildings.some(b=>footprintDistance(b,x,z)<1.5)){finish();continue;}
      segment.push({x,z,y:hf.height(x,z)+.16,s,tx:p.tx,tz:p.tz});
    }
    finish();
    if(road.width<10||road.name==='Embarcadero')continue;
    for(let s=18+random()*12;s<road.length-18;s+=13+random()*9){
      if(random()<.28)continue;
      const p=road.pointAt(s,{}),offset=road.width/2+1.4;
      const x=p.x-p.tz*side*offset,z=p.z+p.tx*side*offset,yaw=Math.atan2(p.tx*side,p.tz*side);
      const lot={x,z,y:hf.height(x,z),yaw,w:2.3,d:5.8,road:road.name};
      const other=network.nearest(x,z,25,r=>r!==road,{});
      if(lot.y<2.5||!clearFootprint(network,x,z,lot.w,lot.d,.15,yaw)||(other&&other.dist<other.road.width/2+7)||buildings.some(b=>footprintsOverlap(b,lot,1)))continue;
      const a=hf.height(x+p.tx*2.5,z+p.tz*2.5),b=hf.height(x-p.tx*2.5,z-p.tz*2.5);
      lot.pitch=-Math.atan2((a-b)*side,5); lot.y=(a+b)/2;
      parking.push(lot);
    }
  }
  return {walks,parking};
}

// Use the same lots for geometry and vegetation exclusions, so trees cannot grow
// through the new barns, houses, silos or mountain chalets.
export function landmarkPlots(network, hf) {
  const farms = [], chalets = [];
  const farmRoad = network.roads.find(r => r.name === 'Granja Road');
  for (const [fraction, side] of [[.23, 1], [.36, -1], [.49, 1], [.67, -1]]) {
    const p = farmRoad.pointAt(farmRoad.length * fraction, {});
    const x = p.x - p.tz * side * 48, z = p.z + p.tx * side * 48;
    if (hf.height(x, z) > 3 && clearFootprint(network, x, z, 34, 24, 8)) farms.push({ x, z });
  }
  const pass = network.roads.find(r => r.name === 'Paso Nevado');
  for (const [fraction, side] of [[.73, 1], [.83, -1], [.9, 1], [.96, -1]]) {
    const p = pass.pointAt(pass.length * fraction, {});
    const x = p.x - p.tz * side * 27, z = p.z + p.tx * side * 27;
    if (clearFootprint(network, x, z, 19, 15, 7)) chalets.push({ x, z });
  }
  return { farms, chalets };
}
