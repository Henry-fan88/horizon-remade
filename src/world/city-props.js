// San Francisco-inspired neighborhood architecture and street furniture.
// Small details are instanced by material and spatial cell, like the rest of the world.
import * as THREE from 'three';
import { CITY_PARKS, cityLayout, cityStreetLife, clearFootprint } from './districts.js';
import { batches, facadeMaterial } from './district-props.js';
import { makeTextTexture } from './textures.js';
import { mulberry32 } from '../core/math.js';

const mat = (color,extra={}) => new THREE.MeshStandardMaterial({color,roughness:.78,...extra});
const SHOP_NAMES = ['NORTH BEACH COFFEE','BAY BOOKS','JADE MARKET','GOLDEN GATE DELI','PACIFIC PHARMACY','CORNER GROCERY','CITY CYCLES','VINYL & VINTAGE','MISSION TACOS','DIM SUM HOUSE','BAY CITY BAKERY','FLOWER MARKET','LAUNDROMAT','HARBOR SEAFOOD','NEIGHBORHOOD GOODS','CABLE CAR CAFE','GOLDEN TEA','LOTUS BAKERY','GRANT TRADING CO','HAPPY NOODLES'];

export function buildCity(props) {
  const B=batches(props),A=props.archMaterials,net=props.world.network,hf=props.world.hf,rnd=mulberry32(200726);
  const concrete=mat(0xbcb8ab),cream=mat(0xf0e4ca),paving=mat(0xb0aaa0),dark=mat(0x30383b),brick=mat(0x9f6151),red=mat(0x983d30),green=mat(0x335d4b),yellow=mat(0xd8ab54),white=mat(0xe5e0cc);
  const shopGlass=mat(0x3b504e,{roughness:.24,metalness:.22,emissive:0xffd5a0,emissiveIntensity:.02});
  props.nightMats.push({mat:shopGlass,day:.02,night:.32});
  const pastel=[0xd1b49b,0x8fa9a0,0xc9ab88,0xa9acb7,0xc8a5a0,0xc4ccaa].map(c=>mat(c,{map:A.plaster.map,bumpMap:A.plaster.bumpMap,bumpScale:.015}));
  const facades=[0x6b8792,0x748a87,0x536c79,0x8f8c82,0xb5b7ad,0x73695e].map((c,i)=>facadeMaterial(c,i,props));
  const awnings=[green,red,mat(0x334f6d),yellow];
  const sphere=new THREE.SphereGeometry(1,10,7),cone=new THREE.ConeGeometry(1,1,4);cone.rotateY(Math.PI/4);
  const plane=new THREE.PlaneGeometry(1,1),signMats=new Map();
  function label(text,x,y,z,w,h,yaw=0,bg='#294b48',fg='#f4e7ca') {
    const key=text+bg;
    if(!signMats.has(key)){
      const map=makeTextTexture(text,{w:512,h:96,bg,fg,font:'bold 39px Barlow Condensed'});
      const m=mat(0xffffff,{map,emissive:0xffffff,emissiveMap:map,emissiveIntensity:.12});
      props.nightMats.push({mat:m,day:.12,night:.72});signMats.set(key,m);
    }
    B.mesh(plane,signMats.get(key),x,y,z,w,h,1,yaw,0,280);
  }
  const trees=[],treeSource=props.world.vegetation.sets.find(set=>set.key==='broadleaf');
  function tree(x,y,z,scale){
    trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP,rnd()*Math.PI*2),new THREE.Vector3(scale,scale,scale)));
  }
  const buildings=cityLayout(net,hf);props.cityBuildings=buildings;
  const life=cityStreetLife(net,hf,buildings);props.cityStreetLife=life;
  let shops=0;
  for(const b of buildings){
    const {x,z,y,w,d,height:H,yaw,style,neighborhood}=b,c=Math.cos(yaw),s=Math.sin(yaw);
    const pos=(u,v)=>[x+c*u+s*v,z-s*u+c*v];
    const box=(m,u,h,v,bw,bh,bd,range=1000,roll=0)=>{const [xx,zz]=pos(u,v);B.box(m,xx,y+h,zz,bw,bh,bd,yaw,roll,range);};
    const lab=(text,u,h,v,bw,bh,bg)=>{const [xx,zz]=pos(u,v);label(text,xx,y+h,zz,bw,bh,yaw,bg);};
    const house=neighborhood==='victorian',tower=H>45;
    box(A.stone,0,(b.base-y)/2+.4,0,w,y-b.base+.8,d,1900);
    if(house){
      box(pastel[style],0,H/2,0,w,H,d,1900);
      box(cream,0,H+.15,0,w+.55,.45,d+.5,1700);
      // Narrow timber houses: projecting bay windows, lintels, cornices and front steps.
      for(let level=2;level<H-1;level+=3.1){
        box(pastel[(style+1)%6],-w*.18,level+.3,d/2+.55,w*.48,2.7,1.2,900);
        for(const u of [-w*.31,-w*.08,w*.28]){
          const bay=u<0?1.19:.07;
          box(A.warmGlass,u,level+.5,d/2+bay,1.65,1.85,.14,600);
          box(cream,u,level+1.5,d/2+bay+.11,1.95,.17,.24,700);
          box(cream,u,level-.51,d/2+bay+.11,1.95,.2,.3,700);
          box(cream,u,level+.5,d/2+bay+.11,.085,2,.1,450);
          box(cream,u,level+.5,d/2+bay+.11,1.8,.075,.1,450);
        }
        box(cream,0,level-1.1,d/2+.02,w+.25,.16,.4,850);
        for(const u of [-w*.29,w*.29])box(A.warmGlass,u,level+.5,-d/2-.04,1.8,1.8,.1,500);
      }
      const rise=2.2,roofW=w+.8;
      for(const side of [-1,1])box(dark,side*roofW/4,H+rise/2,0,Math.hypot(roofW/2,rise),.18,d+.8,1300,-side*Math.atan2(rise,roofW/2));
      const [gx,gz]=pos(0,0);B.gable(pastel[style],gx,y+H,gz,w,rise,d,yaw);
      box(cream,0,H+1.5,d/2+.06,1.1,.85,.12,700);
      box(A.wood,w*.28,1.15,d/2+.11,1.4,2.3,.22,500);
      for(let k=0;k<3;k++)box(A.stone,w*.28,.11+k*.12,d/2+.85-k*.22,1.9,.22+k*.24,.6,450);
      box(brick,-w*.28,H+.6,-d*.28,.75,3.3,.95,1400);
    } else {
      const wall=neighborhood==='chinatown'?brick:pastel[style];
      const plinth=tower?5.3:4.4;
      box(tower?concrete:wall,0,plinth/2,0,w,plinth,d,2200);
      if(b.landmark==='pyramid'){
        box(facades[4],0,H*.13+plinth,0,w*.94,H*.26,d*.94,2800);
        B.mesh(cone,facades[4],x,y+H*.26+plinth+(H*.68)/2,z,w*.66,H*.68,d*.66,yaw,0,3000);
        box(cream,0,H+5,0,.9,14,.9,3000);
      } else if(b.landmark==='crown'){
        const geo=new THREE.CylinderGeometry(1,1,1,20);
        B.mesh(geo,facades[1],x,y+H/2,z,w*.5,H,d*.5,yaw,0,3000);
        for(let k=0;k<6;k++)B.mesh(geo,facades[1],x,y+H+k*1.8,z,w*(.5-k*.048),1.9,d*(.5-k*.048),yaw,0,3000);
      } else {
        const inset=tower?1.3:0;
        box(tower?facades[style]:wall,0,plinth+(H-plinth)/2,0,w-inset*2,H-plinth,d-inset*2,2600);
        box(cream,0,H+.13,0,w+.5,.45,d+.5,2100);
        if(tower){
          for(const u of [-.34,0,.34])box(concrete,u*w,H/2+2,d/2-inset+.1,.27,H-4,.32,1700);
          if(style<2)box(facades[style],0,H+3,0,w*.68,6,d*.68,2600);
        }else{
          for(let floor=6;floor<H-1;floor+=3.2){
            // Exposed side and rear elevations also have apartments above street level.
            for(let v=-d/2+2;v<d/2-1;v+=3.4)for(const side of [-1,1]){
              box(A.warmGlass,side*(w/2+.05),floor,v,.1,1.95,1.6,750);
              box(cream,side*(w/2+.14),floor-1.04,v,.32,.17,1.9,700);
              box(cream,side*(w/2+.12),floor+1.05,v,.24,.13,1.9,700);
            }
            for(let u=-w/2+2;u<w/2-1;u+=3.3){
              box(A.warmGlass,u,floor,-d/2-.05,1.6,1.95,.1,750);
              box(cream,u,floor-1.04,-d/2-.14,1.9,.17,.32,700);
            }
            for(let u=-w/2+2;u<w/2-1;u+=3.3){
              box(A.warmGlass,u,floor,d/2+.04,1.6,1.95,.1,650);
              box(cream,u,floor+1.06,d/2+.13,1.92,.16,.25,600);
              box(cream,u,floor-1.04,d/2+.18,1.92,.19,.4,600);
            }
            if(neighborhood==='chinatown'||style===3){
              box(dark,0,floor-1.3,d/2+.5,w-.7,.14,1.35,750);
              box(green,0,floor-.55,d/2+1.13,w-.7,.07,.07,600);
              for(let u=-w/2+.8;u<w/2;u+=1.15)box(green,u,floor-.88,d/2+1.12,.055,.75,.055,450);
            }
          }
          box(cream,0,H-.4,d/2+.12,w+.4,.22,.5,1100);
          // Roof parapets, small mechanical plant and water tanks give varied rooflines.
          box(wall,0,H+.7,-d/2,w,1.1,.4,1400);
          for(const side of [-1,1])box(wall,side*w/2,H+.7,0,.4,1.1,d,1400);
        }
        box(A.aluminum,-w*.23,H+.8,-d*.17,2.4,1.3,2.5,850);
      }
      // Readable, individual ground-floor businesses with recessed doors and canopies.
      const shopIdx=neighborhood==='chinatown'?[2,9,16,17,18,19][style]:neighborhood==='waterfront'?[13,10,1,15,7,5][style]:shops%SHOP_NAMES.length;
      const shop=SHOP_NAMES[shopIdx],awning=awnings[style%4];
      box(shopGlass,0,1.8,d/2+.055,w-1.25,3.1,.15,750);
      for(let u=-w/2+.5;u<w/2;u+=3.2)box(cream,u,1.9,d/2+.19,.16,3.6,.22,650);
      box(dark,w*.23,1.6,d/2+.22,1.4,3,.11,450);
      box(A.aluminum,w*.18,1.5,d/2+.31,.07,.55,.08,300);
      box(awning,0,3.7,d/2+1,w-.65,.14,2,800,.04);
      box(awning,0,3.47,d/2+1.95,w-.65,.42,.08,600);
      lab(shop,0,4.2,d/2+.2,Math.min(w-1,16),.82,style%2?'#693d30':'#294b48');
      if(shops%4===0){
        // Cafe terrace: keep the walking strip between the terrace and curb free.
        for(const u of [-w*.27,0]){
          box(A.wood,u,.8,d/2+2,1.15,.1,.85,180);
          box(dark,u,.38,d/2+2,.08,.8,.08,180);
          for(const v of [1.35,2.68]){box(A.wood,u,.45,d/2+v,.52,.08,.5,180);box(dark,u,.23,d/2+v,.1,.45,.1,180);}
        }
      } else if(shopIdx===2||shopIdx===5||shopIdx===11){
        box(A.wood,-w*.2,.65,d/2+1.7,3.8,1.15,.9,200);
        for(let k=0;k<9;k++)box(k%2?red:yellow,-w*.2-1.5+k*.37,1.3,d/2+1.7,.26,.23,.4,170);
      }
      if(shops%3===0){box(dark,w*.36,.85,d/2+1.35,.7,1.5,.13,200);lab('OPEN',w*.36,1.15,d/2+1.43,.58,.26,'#252f2d');}
      shops++;
    }
    props.game.collision.addBox(x,z,w/2,d/2,-yaw,b.base,y+H+(house?2:0),'building');
  }
  props.cityShops=shops;

  // Continuous, terrain-conforming sidewalks, split at all crossing roads.
  const pavement=[],curbs=[];
  function ribbon(out,a,b,near,far,side,lift){
    const corners=side>0?[[a,near],[a,far],[b,near],[b,near],[a,far],[b,far]]:[[a,near],[b,near],[a,far],[b,near],[b,far],[a,far]];
    for(const [p,t] of corners){
      const x=p.x-p.tz*t*side,z=p.z+p.tx*t*side;
      out.push(x,props.h(x,z)+lift,z);
    }
  }
  for(const road of net.roads.filter(r=>r.city)) for(const side of [-1,1]){
    for(let s=2;s<road.length-4;s+=3){
      const a=road.pointAt(s,{}),b=road.pointAt(s+3,{}),off=road.width/2+4.5;
      const x=a.x-a.tz*side*off,z=a.z+a.tx*side*off;
      const other=net.nearest(x,z,24,r=>r!==road);
      if(props.h(x,z)<2.5||(other&&other.dist<other.road.width/2+2))continue;
      ribbon(pavement,a,b,road.width/2+2.9,road.width/2+(road.name==='Embarcadero'&&side===-1?13:6.65),side,.15);
      ribbon(curbs,a,b,road.width/2+2.7,road.width/2+3,side,.18);
    }
    for(let s=24;s<road.length-20;s+=34){
      const p=road.pointAt(s,{}),o=road.width/2+6;
      const x=p.x-p.tz*side*o,z=p.z+p.tx*side*o,y=props.h(x,z),yaw=Math.atan2(p.tx,p.tz);
      if(y<2.5||!clearFootprint(net,x,z,1,1,2))continue;
      if(Math.floor(s/34)%3===0){
        B.box(concrete,x,y+.2,z,1.7,.4,1.7,0,0,550);
        tree(x,y,z,.52+rnd()*.09);
      }else{
        B.cylinder(dark,x,y+2.6,z,.07,5.2,650);
        B.box(dark,x,y+5.25,z,.8,.15,.45,yaw,0,600);
        B.box(A.warmGlass,x,y+5.15,z,.65,.09,.38,yaw,0,400);
        if(Math.floor(s/34)%2===0){
          B.cylinder(green,x+.55,y+.52,z,.25,1.04,240);
          B.cylinder(dark,x+.55,y+1.05,z,.28,.09,240);
        }else{
          B.cylinder(red,x+.6,y+.4,z,.12,.8,240);
          B.box(red,x+.6,y+.58,z,.5,.16,.18,yaw,0,240);
        }
      }
      if(s<60){label(road.name.toUpperCase(),x,y+3.9,z,2.6,.42,yaw,'#244b3c');}
    }
  }
  for(const [positions,material] of [[pavement,paving],[curbs,cream]]){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,material);mesh.receiveShadow=true;props.group.add(mesh);
  }
  // Paint follows the road at every vertex; level boxes would protrude like speed
  // bumps on steep streets, and disappear into the tarmac at their other end.
  const markings=[];
  function groundMark(x,z,w,d,yaw){
    const c=Math.cos(yaw),s=Math.sin(yaw),nx=3,nz=4;
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
      const u=-w/2+i*w/nx,v=-d/2+j*d/nz;
      for(const [a,b] of [[u,v],[u,v+d/nz],[u+w/nx,v],[u+w/nx,v],[u,v+d/nz],[u+w/nx,v+d/nz]]){
        const xx=x+c*a+s*b,zz=z-s*a+c*b;
        markings.push(xx,Math.max(hf.height(xx,zz),props.h(xx,zz))+.055,zz);
      }
    }
  }
  const crossings=[];
  for(const road of net.roads.filter(r=>r.city)){
    for(let s=5;s<road.length-5;s+=2){
      const p=road.pointAt(s,{}),near=net.nearest(p.x,p.z,3,r=>r!==road,{});
      if(!near||near.dist>1.2||near.road.id>road.id)continue;
      const angle=Math.abs(p.tx*near.tz-p.tz*near.tx);
      if(angle<.4||crossings.some(v=>Math.hypot(v.x-p.x,v.z-p.z)<26))continue;
      crossings.push(p);
      for(const [r,along,otherWidth] of [[road,s,near.road.width],[near.road,near.s,road.width]]){
        for(const side of [-1,1]){
          const t=along+side*(otherWidth/2+4)/angle;if(t<5||t>r.length-5)continue;
          const q=r.pointAt(t,{}),yaw=Math.atan2(q.tx,q.tz);
          for(let u=-r.width/2+1;u<r.width/2;u+=1.15){
            const x=q.x+q.tz*u,z=q.z-q.tx*u;
            groundMark(x,z,.56,2.8,yaw);
          }
        }
      }
    }
  }
  // Curb parking stripes and meters are outside the moving lanes.
  for(const [i,p] of life.parking.entries()){
    const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    for(const v of [-3.15,3.15])groundMark(p.x+s*v,p.z+c*v,2.25,.1,p.yaw);
    if(i%3===0){const x=p.x+c*1.75,z=p.z-s*1.75,y=props.h(x,z);B.cylinder(dark,x,y+.62,z,.045,1.24,220);B.box(A.aluminum,x,y+1.28,z,.22,.32,.18,p.yaw,0,200);}
  }
  const markingGeometry=new THREE.BufferGeometry();
  markingGeometry.setAttribute('position',new THREE.Float32BufferAttribute(markings,3));markingGeometry.computeVertexNormals();
  white.polygonOffset=true;white.polygonOffsetFactor=-1;white.polygonOffsetUnits=-2;
  const markingMesh=new THREE.Mesh(markingGeometry,white);markingMesh.receiveShadow=true;props.group.add(markingMesh);
  const embarcadero=net.roads.find(r=>r.name==='Embarcadero');
  for(let s=25;s<embarcadero.length-20;s+=19){
    const p=embarcadero.pointAt(s,{}),off=embarcadero.width/2+11;
    const x=p.x+p.tz*off,z=p.z-p.tx*off,y=props.h(x,z),yaw=Math.atan2(p.tz,-p.tx);
    if(y<1.5)continue;
    B.box(A.wood,x,y+.65,z,2.2,.16,.6,yaw,0,500);
    B.box(A.wood,x-Math.sin(yaw)*.3,y+1,z-Math.cos(yaw)*.3,2.2,.68,.1,yaw,0,500);
    for(const side of [-1,1])B.box(dark,x+Math.cos(yaw)*side*.8,y+.3,z-Math.sin(yaw)*side*.8,.13,.6,.5,yaw,0,450);
  }
  // Chinatown gateways sit above the carriageway with generous vehicle clearance.
  const grant=net.roads.find(r=>r.name==='Grant Avenue');
  for(const f of [.18,.72]){
    const p=grant.pointAt(grant.length*f,{}),yaw=Math.atan2(p.tx,p.tz),c=Math.cos(yaw),s=Math.sin(yaw),half=grant.width/2+3;
    for(const side of [-1,1]){const x=p.x+c*side*half,z=p.z-s*side*half;B.cylinder(red,x,props.h(x,z)+3.8,z,.28,7.6,1000);}
    B.box(red,p.x,p.y+7.1,p.z,half*2+.6,.5,.8,yaw,0,1200);
    B.box(green,p.x,p.y+7.7,p.z,half*2+2,.35,2.5,yaw,0,1200);
    B.box(green,p.x,p.y+8.1,p.z,half*2-1,.3,1.4,yaw,0,1200);
    label('CHINATOWN',p.x,p.y+6.85,p.z+.5,4,.6,yaw,'#6b2923');
    for(let k=-3;k<=3;k++){
      const x=p.x+c*k*1.7,z=p.z-s*k*1.7;
      B.cylinder(dark,x,p.y+6.35,z,.025,1,550);
      B.mesh(sphere,red,x,p.y+5.8,z,.34,.48,.34,0,0,650);
      B.cylinder(yellow,x,p.y+5.28,z,.025,.22,450);
    }
  }
  // Neighborhood parks and a Coit-inspired lookout above the bay.
  for(const park of CITY_PARKS){
    for(let i=0;i<10;i++){
      const angle=i/10*Math.PI*2,x=park.x+Math.cos(angle)*(park.r-5),z=park.z+Math.sin(angle)*(park.r-5),y=props.h(x,z);
      if(!clearFootprint(net,x,z,3,3,3))continue;
      tree(x,y,z,.78+rnd()*.14);
      if(i%3===0){B.box(A.wood,x-3,y+.7,z,2,.16,.6,angle,0,250);B.box(A.wood,x-3,y+1.05,z+.3,2,.6,.1,angle,0,250);}
    }
    if(park.name==='Telegraph Hill'&&clearFootprint(net,park.x,park.z,10,10,4)){
      const y=props.h(park.x,park.z);B.cylinder(cream,park.x,y+17,park.z,4.5,34,2600);B.cylinder(cream,park.x,y+35,park.z,5.4,2.2,2600);
      for(let i=0;i<10;i++){const a=i/10*Math.PI*2;B.box(dark,park.x+Math.sin(a)*4.55,y+31,park.z+Math.cos(a)*4.55,.85,3,.1,a,0,1700);}
      props.game.collision.addBox(park.x,park.z,5,5,0,y,y+36,'building');
    }
  }
  // Ferry terminal at the eastern waterfront, with its slender clock tower.
  const ferry={x:1554,z:143},fy=props.h(ferry.x,ferry.z);
  if(fy>1&&clearFootprint(net,ferry.x,ferry.z,18,58,4)){
    B.box(cream,ferry.x,fy+5,ferry.z,18,10,58,0,0,2600);
    B.box(dark,ferry.x,fy+10.5,ferry.z,20,.6,60,0,0,2600);
    B.box(cream,ferry.x,fy+22,ferry.z,8,27,8,0,0,3000);
    B.mesh(cone,dark,ferry.x,fy+39,ferry.z,6,8,6,0,0,3000);
    const clock=makeTextTexture('◷',{w:128,h:128,fg:'#333a37',bg:'#eee6d5',font:'96px serif'}),clockMat=mat(0xffffff,{map:clock});
    for(const side of [-1,1])B.mesh(plane,clockMat,ferry.x+side*4.05,fy+31,ferry.z,5,5,1,side*Math.PI/2,0,1800);
    const arch=new THREE.TorusGeometry(1.58,.16,5,14,Math.PI);arch.rotateY(Math.PI/2);
    for(let dz=-24;dz<=24;dz+=6){
      B.box(A.glazing,ferry.x-9.04,fy+4,ferry.z+dz,.1,5,3,0,0,900);
      for(const side of [-1,1])B.box(concrete,ferry.x-9.3,fy+3.2,ferry.z+dz+side*1.65,.5,6.4,.35,0,0,1300);
      B.mesh(arch,concrete,ferry.x-9.35,fy+6.4,ferry.z+dz,1,1,1,0,0,1400);
    }
    for(const level of [1,8.2,9.5,10.5])B.box(concrete,ferry.x,fy+level,ferry.z,18.6,.28,59,0,0,2200);
    for(const level of [12,23,27,35])B.box(concrete,ferry.x,fy+level,ferry.z,8.5,.38,8.5,0,0,2800);
    for(const side of [-1,1]){
      for(const dz of [-2,0,2])B.box(A.glazing,ferry.x+side*4.05,fy+20,ferry.z+dz,.12,3.7,.7,0,0,1800);
      for(const u of [-1,1])B.box(concrete,ferry.x+side*4.13,fy+20,ferry.z+u*3.65,.3,17,.4,0,0,2400);
    }
    label('FERRY BUILDING',ferry.x-9.12,fy+8.3,ferry.z,19,1,-Math.PI/2,'#c9bea6','#303b37');
    props.game.collision.addBox(ferry.x,ferry.z,9,29,0,fy,fy+35,'building');
  }
  buildBayBridge(props,B,cream);
  if(treeSource)props.chunked(treeSource.far.geometry,treeSource.far.material,trees,{maxDist:1200,shadowDist:170});
  B.flush();
  return buildings;
}

function buildBayBridge(props,B,cream){
  const road=props.world.network.roads.find(r=>r.name==='Puente Este');if(!road)return;
  const steel=mat(0xb44f37,{metalness:.35,roughness:.5});
  const cableMat=mat(0x604c41,{metalness:.6,roughness:.5});
  const a=road.pointAt(0,{}),end=road.pointAt(road.length,{}),yaw=Math.atan2(end.x-a.x,end.z-a.z),rx=Math.cos(yaw),rz=-Math.sin(yaw),deck=road.width/2+3;
  for(let s=6;s<road.length-6;s+=6){
    const p=road.pointAt(s,{});
    for(const side of [-1,1]){
      const x=p.x+rx*side*(road.width/2+.4),z=p.z+rz*side*(road.width/2+.4);
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
    for(let i=0;i<=80;i++){
      const f=i/80,p=road.pointAt(road.length*f,{});
      let h;
      if(f<.27)h=9+75*(f/.27)**.7;else if(f>.73)h=9+75*((1-f)/.27)**.7;else h=22+62*((f-.5)/.23)**2;
      const x=p.x+rx*side*deck,z=p.z+rz*side*deck;
      points.push(new THREE.Vector3(x,p.y+h,z));
      if(i%3===0&&i>0&&i<80)B.cylinder(cableMat,x,p.y+h/2,z,.055,h,3000);
    }
    const geo=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),180,.21,6,false),mesh=new THREE.Mesh(geo,cableMat);mesh.castShadow=true;props.group.add(mesh);
  }
}
