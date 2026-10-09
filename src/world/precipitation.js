// Rain and snow falling around the camera.
//
// One instanced draw: every drop has a fixed random place in a box that is tiled across the
// world and wrapped around the camera in the vertex shader, so the CPU never touches a drop
// and the rain stays put in the world as the camera moves through it. Rain is drawn as
// streaks along the drop's motion relative to the camera (it rushes at the windscreen at
// speed); snow as soft flakes that drift and sway. Drops under the terrain are dropped, and
// the player's headlights light up the ones in their beams.

import * as THREE from 'three';
import { fogUniforms } from './sky.js';

const BOX = new THREE.Vector3(40, 26, 40); // metres around the camera
const MAX_DROPS = 14000;
const TIME_WRAP = 2048; // s; keeps the fall offsets small enough for float precision

const vert = /* glsl */ `
attribute vec4 seed;   // xyz: place in the box (0..1), w: per-drop random
attribute vec2 corner; // x: -1..1 across the streak, y: 0..1 along it
uniform vec3 uCam;
uniform vec3 uCamVel;
uniform vec3 uBox;
uniform float uTime;
uniform float uCount;
uniform float uSnow;
uniform vec2 uWind;
uniform float uCabin;
uniform sampler2D tHeight;
uniform float uWorld;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform float uLamp;
varying vec2 vCorner;
varying float vFade;
varying float vLit;
#include <fog_pars_vertex>
void main() {
  float id = float( gl_InstanceID );
  vFade = 0.0;
  vLit = 0.0;
  vCorner = corner;
  if ( id >= uCount ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  float r = seed.w;
  // rain falls at 7-10 m/s, snow at about 1 m/s, both carried by the wind
  float fall = mix( mix( 7.0, 10.0, r ), mix( 0.8, 1.5, r ), uSnow );
  vec3 vel = vec3( uWind.x * mix( 1.0, 1.4, uSnow ), -fall, uWind.y * mix( 1.0, 1.4, uSnow ) );
  vec3 p = seed.xyz * uBox + vel * uTime;
  // snowflakes sway as they fall
  p.xz += uSnow * vec2( sin( uTime * ( 0.9 + r ) + r * 40.0 ), cos( uTime * ( 0.7 + r * 0.8 ) + r * 25.0 ) ) * 0.45;
  p = uCam + mod( p - uCam + 0.5 * uBox, uBox ) - 0.5 * uBox;
  vec3 rel = p - uCam;
  float dist = length( rel );
  // inside the car (cockpit view), below the ground or too close to see: skip
  vec2 huv = ( p.xz + uWorld * 0.5 ) / uWorld;
  float ground = texture2D( tHeight, clamp( huv, 0.0, 1.0 ) ).r;
  if ( p.y < max( ground, 0.0 ) - 0.2 || length( rel.xz ) < uCabin || dist < 0.35 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  // seen from a moving camera the streak runs along the drop's relative motion
  vec3 relVel = vel - uCamVel;
  float shutter = mix( 0.045, 0.008, uSnow );
  vec3 a = p;
  vec3 b = p - relVel * shutter;
  vec4 va = viewMatrix * vec4( a, 1.0 );
  vec4 vb = viewMatrix * vec4( b, 1.0 );
  vec2 d = vb.xy - va.xy;
  float len = length( d );
  vec2 along = len > 1e-4 ? d / len : vec2( 0.0, -1.0 );
  vec2 side = vec2( -along.y, along.x );
  // thin streaks, widened far away so they stay about a pixel wide; round flakes for snow
  float width = mix( max( 0.0045, -va.z * 0.0011 ), mix( 0.012, 0.022, r ), uSnow );
  vec4 mv = mix( va, vb, corner.y );
  mv.xy += side * corner.x * width;
  if ( uSnow > 0.5 ) mv.xy += along * ( corner.y - 0.5 ) * width * 2.0;
  gl_Position = projectionMatrix * mv;
  // drops right at the lens would smear across the screen: fade them in from ~2 m
  vFade = ( 1.0 - smoothstep( 0.55 * uBox.x * 0.5, 0.5 * uBox.x, length( rel.xz ) ) ) * smoothstep( mix( 1.0, 0.4, uSnow ), mix( 2.6, 1.2, uSnow ), dist );
  // the player's headlight beams
  vec3 toDrop = p - uLampPos;
  float ld = length( toDrop );
  vLit = uLamp * smoothstep( 0.86, 0.96, dot( toDrop / max( ld, 1e-3 ), uLampDir ) ) * ( 1.0 - smoothstep( 4.0, 38.0, ld ) );
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform float uSnow;
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vCorner;
varying float vFade;
varying float vLit;
#include <fog_pars_fragment>
void main() {
  float a;
  if ( uSnow > 0.5 ) {
    vec2 q = vec2( vCorner.x, vCorner.y * 2.0 - 1.0 );
    a = smoothstep( 1.0, 0.25, dot( q, q ) );
  } else {
    a = smoothstep( 0.0, 0.25, vCorner.y ) * smoothstep( 1.0, 0.6, vCorner.y ) * ( 1.0 - abs( vCorner.x ) );
  }
  a *= vFade * uAlpha;
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( uColor * ( 1.0 + vLit * 6.0 ), a * ( 1.0 + vLit * 1.5 ) );
  #include <fog_fragment>
}`;

export class Precipitation {
  constructor(heightTex, worldSize) {
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    base.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2));
    base.setIndex([0, 1, 2, 2, 1, 3]);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('corner', base.attributes.corner);
    const seeds = new Float32Array(MAX_DROPS * 4);
    let s = 0x2468ace;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = MAX_DROPS;
    this.geometry = g;
    this.uniforms = {
      ...fogUniforms(),
      uCam: { value: new THREE.Vector3() },
      uCamVel: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uTime: { value: 0 },
      uCount: { value: 0 },
      uSnow: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uCabin: { value: 0 },
      tHeight: { value: heightTex },
      uWorld: { value: worldSize },
      uLampPos: { value: new THREE.Vector3() },
      uLampDir: { value: new THREE.Vector3(0, 0, 1) },
      uLamp: { value: 0 },
      uColor: { value: new THREE.Color(0.6, 0.62, 0.65) },
      uAlpha: { value: 0.3 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: true,
      // a streak's winding flips with the direction it moves across the screen
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'precipitation';
    this.mesh.visible = false;
    this.share = 1; // quality: share of MAX_DROPS that may be drawn
    this.time = 0;
    this._lastCam = new THREE.Vector3();
    this._vel = new THREE.Vector3();
  }

  setQuality(share) {
    this.share = Math.max(0.1, Math.min(1, share));
  }

  // rain / snow 0..1, wind as metres per second in x/z; light: how bright the sky is (0..1)
  update(dt, camera, { rain, snow, windX, windZ, light, cabin, lamp }) {
    const amount = Math.max(rain, snow);
    const u = this.uniforms;
    this.mesh.visible = amount > 0.005;
    const cp = camera.position;
    if (dt > 0) {
      // camera velocity, smoothed (teleports and respawns read as zero)
      const v = this._vel.subVectors(cp, this._lastCam).divideScalar(dt);
      if (v.lengthSq() > 120 * 120) v.set(0, 0, 0);
      u.uCamVel.value.lerp(v, Math.min(1, dt * 12));
    }
    this._lastCam.copy(cp);
    if (!this.mesh.visible) return;
    this.time = (this.time + dt) % TIME_WRAP;
    const snowy = snow > rain;
    u.uTime.value = this.time;
    u.uCam.value.copy(cp);
    u.uSnow.value = snowy ? 1 : 0;
    // snow is denser and closer; heavy rain fills the box
    const want = snowy ? 0.35 + 0.65 * snow : 0.12 + 0.88 * rain;
    u.uCount.value = Math.round(MAX_DROPS * this.share * want);
    u.uWind.value.set(windX, windZ);
    u.uCabin.value = cabin ? 1.6 : 0;
    const l = 0.12 + 0.88 * light;
    if (snowy) u.uColor.value.setRGB(0.95 * l, 0.97 * l, 1.0 * l);
    else u.uColor.value.setRGB(0.62 * l, 0.65 * l, 0.7 * l);
    u.uAlpha.value = snowy ? 0.85 : 0.22 + 0.16 * rain;
    if (lamp) {
      u.uLampPos.value.copy(lamp.pos);
      u.uLampDir.value.copy(lamp.dir);
      u.uLamp.value = lamp.on ? 1 : 0;
    } else u.uLamp.value = 0;
  }
}
