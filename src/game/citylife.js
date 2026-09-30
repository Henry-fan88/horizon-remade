// Ambient sidewalk life and parked civilian vehicles. No garage/race assets.
import * as THREE from 'three';
import { getTrafficModel } from '../vehicle/trafficmodels.js';
import { TRAFFIC_SPECS, TRAFFIC_COLORS } from '../vehicle/trafficspecs.js';
import { mulberry32 } from '../core/math.js';

const _m=new THREE.Matrix4(),_root=new THREE.Matrix4(),_q=new THREE.Quaternion(),_p=new THREE.Vector3(),_s=new THREE.Vector3(),_e=new THREE.Euler(),_c=new THREE.Color();
const PEOPLE=240,PARKED=168,PER_STYLE=32;
const SHIRTS=[0x4b6575,0x8c483a,0xc8b179,0x6b7260,0x39414b,0xb0b0a2,0x735c76,0xd3c6b0];
const SKIN=[0xe0b293,0xc38e6d,0x9c694c,0x6b4432,0xecc8a8];
const PANTS=[0x384959,0x565650,0x2e363e,0x88765e];

export class CityLife {
  constructor(game){
    this.game=game;this.group=new THREE.Group();this.group.name='city-life';game.scene.add(this.group);
    this.elapsed=0;this.walkers=[];this.parked=[];this.visiblePeople=0;const rnd=mulberry32(240927);
    const plan=game.props.cityStreetLife;
    // Evenly distribute parking across the whole city instead of filling the first road.
    const lots=plan.parking.map(p=>({p,key:rnd()})).sort((a,b)=>a.key-b.key).slice(0,PARKED);
    this.styles=TRAFFIC_SPECS.map(spec=>{
      const model=getTrafficModel(spec.style.trafficAsset);
      const tiers=[0,1,2].map(level=>(model?.[level]||[]).map(part=>{
        const mesh=new THREE.InstancedMesh(part.geometry,part.material,PER_STYLE);mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=level===0&&!part.material.transparent;mesh.receiveShadow=level<2;mesh.isPaint=part.isPaint;
        if(part.isPaint)for(let i=0;i<PER_STYLE;i++)mesh.setColorAt(i,_c.set(0xffffff));
        this.group.add(mesh);return mesh;
      }));return {spec,tiers,used:[0,0,0]};
    });
    for(const [i,{p}] of lots.entries()){
      const style=i%this.styles.length,spec=this.styles[style].spec;
      const rightX=Math.cos(p.yaw),rightZ=-Math.sin(p.yaw),h=game.world.height(p.x+rightX*.8,p.z+rightZ*.8)-game.world.height(p.x-rightX*.8,p.z-rightZ*.8);
      const matrix=new THREE.Matrix4().compose(new THREE.Vector3(p.x,p.y,p.z),new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch,p.yaw,Math.atan2(h,1.6),'YXZ')),new THREE.Vector3(1,1,1));
      this.parked.push({...p,style,matrix,color:TRAFFIC_COLORS[Math.floor(rnd()*TRAFFIC_COLORS.length)]});
      // Static curbside vehicles cannot be driven through. The negative angle converts
      // Three's yaw convention to the collision world's 2D rectangle convention.
      game.collision.addBox(p.x,p.z,spec.style.W/2,spec.style.L/2,-p.yaw,p.y+.16,p.y+spec.style.H,'parked-car');
    }
    const paths=plan.walks.filter(w=>w.points.length>7);
    const total=paths.reduce((a,w)=>a+w.points.length,0);
    for(let i=0;i<PEOPLE&&paths.length;i++){
      let choose=rnd()*total,path=paths[0];for(const w of paths){choose-=w.points.length;if(choose<=0){path=w;break;}}
      this.walkers.push({path,at:rnd()*(path.points.length-1),dir:rnd()<.5?-1:1,speed:.8+rnd()*.65,phase:rnd()*6.28,pause:rnd()<.17?2+rnd()*8:0,scale:.94+rnd()*.13,skin:SKIN[Math.floor(rnd()*SKIN.length)],shirt:SHIRTS[Math.floor(rnd()*SHIRTS.length)],pants:PANTS[Math.floor(rnd()*PANTS.length)],hair:[0x302823,0x6d4a32,0xb69a68,0x514842][Math.floor(rnd()*4)],bag:rnd()<.3,cap:rnd()<.2});
    }
    const fabric=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.85});
    const capsule=new THREE.CapsuleGeometry(.5,.5,3,7);capsule.scale(1,2/3,1);
    this.parts=[new THREE.BoxGeometry(1,1,1),new THREE.SphereGeometry(.5,8,6),capsule].map(geometry=>{
      const mesh=new THREE.InstancedMesh(geometry,fabric,PEOPLE*14);mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;
      for(let i=0;i<PEOPLE*14;i++)mesh.setColorAt(i,_c.set(0xffffff));this.group.add(mesh);return mesh;
    });
    this.used=[0,0,0];
  }

  part(type,x,y,z,w,h,d,color,rx=0){
    _q.setFromEuler(_e.set(rx,0,0));_m.compose(_p.set(x,y,z),_q,_s.set(w,h,d));_m.premultiply(_root);
    const mesh=this.parts[type],i=this.used[type]++;mesh.setMatrixAt(i,_m);mesh.setColorAt(i,_c.set(color));
  }

  update(dt){
    const game=this.game,cp=game.camera.position,pp=game.player.physics.pos;
    const enabled=game.settings.traffic!==false;
    // Parked vehicles remain visible because they are static collision objects.
    this.group.visible=true;
    const animate=!game.paused||game.state==='environment-inspection';if(animate)this.elapsed+=dt;
    for(const st of this.styles)st.used.fill(0);
    for(const p of this.parked){
      const distance=Math.hypot(p.x-cp.x,p.z-cp.z);if(distance>700)continue;
      const level=distance<58?0:distance<250?1:2,st=this.styles[p.style],i=st.used[level]++;
      for(const mesh of st.tiers[level]){mesh.setMatrixAt(i,p.matrix);if(mesh.isPaint)mesh.setColorAt(i,_c.set(p.color));}
    }
    for(const st of this.styles)for(let t=0;t<3;t++)for(const mesh of st.tiers[t]){mesh.count=st.used[t];if(mesh.count){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}}
    this.used.fill(0);this.visiblePeople=0;
    if(!enabled){for(const mesh of this.parts)mesh.count=0;return;}
    for(const person of this.walkers){
      const points=person.path.points;
      if(animate){
        if(person.pause>0)person.pause-=dt;
        else person.at+=person.dir*person.speed*dt/3;
        if(person.at<=0||person.at>=points.length-1){person.at=Math.max(0,Math.min(points.length-1,person.at));person.dir*=-1;person.pause=1.2+person.phase*.35;}
      }
      const index=Math.min(points.length-2,Math.floor(person.at)),f=person.at-index,a=points[index],b=points[index+1];
      let x=a.x+(b.x-a.x)*f,z=a.z+(b.z-a.z)*f;
      if(Math.hypot(x-cp.x,z-cp.z)>250)continue;
      this.visiblePeople++;
      const nearCar=Math.hypot(x-pp.x,z-pp.z)<5;
      // Pause and turn to notice the car; paths remain on their verified sidewalks.
      if(nearCar)person.pause=Math.max(person.pause,.7);
      const yaw=nearCar?Math.atan2(pp.x-x,pp.z-z):Math.atan2((b.x-a.x)*person.dir,(b.z-a.z)*person.dir);
      const moving=person.pause<=0,phase=this.elapsed*person.speed*6.4+person.phase,swing=moving?Math.sin(phase)*.46:0;
      const y=game.world.height(x,z)+.16+(moving?Math.abs(Math.sin(phase))*.015:0);
      _root.compose(_p.set(x,y,z),_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,yaw),_s.setScalar(person.scale));
      this.part(2,0,1.17,0,.43,.56,.25,person.shirt);
      this.part(0,0,.86,0,.33,.2,.22,person.pants);
      this.part(2,0,1.47,0,.11,.13,.12,person.skin);
      this.part(1,0,1.64,.006,.235,.29,.23,person.skin);
      this.part(1,0,1.73,-.022,.24,.15,.235,person.cap?person.shirt:person.hair);
      this.part(1,0,1.63,.116,.055,.07,.075,person.skin);
      if(person.cap)this.part(0,0,1.739,.125,.22,.025,.19,person.shirt);
      if(person.bag)this.part(0,0,1.15,-.18,.29,.38,.14,0x4a4139);
      for(const side of [-1,1]){
        const leg=side*swing,knee=leg-Math.max(0,-side*Math.sin(phase))*(moving?.45:0);
        const kY=.83-Math.cos(leg)*.4,kZ=-Math.sin(leg)*.4;
        this.part(2,side*.1,.83-Math.cos(leg)*.2,-Math.sin(leg)*.2,.145,.43,.17,person.pants,leg);
        this.part(2,side*.1,kY-Math.cos(knee)*.18,kZ-Math.sin(knee)*.18,.12,.39,.145,person.pants,knee);
        this.part(0,side*.1,.085,kZ-Math.sin(knee)*.34+.055,.145,.13,.28,0x30312e);
        const arm=-side*swing*.8,elbow=arm-.2;
        const eY=1.39-Math.cos(arm)*.27,eZ=-Math.sin(arm)*.27;
        this.part(2,side*.255,1.39-Math.cos(arm)*.135,-Math.sin(arm)*.135,.13,.3,.14,person.shirt,arm);
        this.part(2,side*.255,eY-Math.cos(elbow)*.12,eZ-Math.sin(elbow)*.12,.095,.26,.1,person.skin,elbow);
        this.part(1,side*.255,eY-Math.cos(elbow)*.26,eZ-Math.sin(elbow)*.26,.105,.14,.095,person.skin);
      }
    }
    for(let i=0;i<this.parts.length;i++){const mesh=this.parts[i];mesh.count=this.used[i];if(mesh.count){mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;}}
  }
}
