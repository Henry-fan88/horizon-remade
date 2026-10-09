// Ocean / lake surface: depth-tinted turquoise shallows, animated ripples,
// sky reflection approximation, sun glints and shoreline foam.
import * as THREE from 'three';
import { atmo, fogUniforms } from './sky.js';

const vert = /* glsl */ `
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform sampler2D tHeight;
uniform sampler2D tNormal;
uniform float time;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 horizonCol;
uniform vec3 horizonSunCol;
uniform vec3 zenithCol;
uniform float lightLevel;
uniform float worldSize;
uniform float rain;
varying vec3 vWPos;
#include <fog_pars_fragment>

void main() {
  vec2 huv = ( vWPos.xz + worldSize * 0.5 ) / worldSize;
  float ground = texture2D( tHeight, clamp( huv, 0.0, 1.0 ) ).r;
  float depth = max( 0.0, -ground );
  vec3 toCam = cameraPosition - vWPos;
  float dist = length( toCam );
  vec3 V = toCam / dist;
  vec2 uv = vWPos.xz;
  vec2 n1 = texture2D( tNormal, uv * 0.011 + vec2( time * 0.0065, time * 0.004 ) ).xy * 2.0 - 1.0;
  vec2 n2 = texture2D( tNormal, uv * 0.029 + vec2( -time * 0.011, time * 0.0135 ) ).xy * 2.0 - 1.0;
  vec2 n3 = texture2D( tNormal, uv * 0.087 + vec2( time * 0.019, -time * 0.017 ) ).xy * 2.0 - 1.0;
  vec2 n4 = texture2D( tNormal, uv * 0.23 + vec2( -time * 0.03, -time * 0.024 ) ).xy * 2.0 - 1.0;
  vec2 swell = vec2(sin(dot(uv, vec2(0.07, 0.12)) + n1.x * 5.0 - time * 0.8), cos(dot(uv, vec2(-0.1, 0.045)) + n2.y * 4.0 - time * 0.55));
  // rain roughens the surface: more fine chop, strongest close by where the drops show
  vec2 nxy = n1 * 0.65 + n2 * 0.5 + n3 * 0.32 * ( 1.0 + rain * 0.8 ) + swell * 0.035 + n4 * ( 0.2 + rain * 0.55 ) * ( 1.0 - smoothstep( 20.0, 120.0, dist ) );
  float flatten = smoothstep( 150.0, 2500.0, dist );
  vec3 N = normalize( vec3( nxy.x * 0.32 * ( 1.0 - flatten * 0.75 ), 1.0, nxy.y * 0.32 * ( 1.0 - flatten * 0.75 ) ) );
  float ndv = max( dot( N, V ), 0.0 );
  float fres = 0.02 + 0.98 * pow( 1.0 - ndv, 5.0 );
  vec3 R = reflect( -V, N );
  float ry = max( R.y, 0.0 );
  vec2 rh = normalize( R.xz + 1e-5 );
  vec2 sh = normalize( sunDir.xz + 1e-5 );
  float az = pow( max( dot( rh, sh ), 0.0 ), 6.0 );
  vec3 sky = mix( mix( horizonCol, horizonSunCol, az ), zenithCol, pow( ry, 0.5 ) );
  float rs = max( dot( R, sunDir ), 0.0 );
  vec3 glint = sunColor * ( pow( rs, 1100.0 ) * 28.0 + pow( rs, 140.0 ) * 0.65 ) * step( 0.0, sunDir.y );
  // water body
  vec3 shallow = vec3( 0.035, 0.19, 0.16 );
  vec3 mid = vec3( 0.012, 0.075, 0.09 );
  vec3 deep = vec3( 0.006, 0.025, 0.047 );
  vec3 body = mix( shallow, mid, smoothstep( 0.0, 6.0, depth ) );
  body = mix( body, deep, smoothstep( 5.0, 30.0, depth ) );
  body *= lightLevel;
  // subsurface-ish brightening of wave crests facing the sun
  body += shallow * lightLevel * 0.25 * pow( max( dot( V, -sunDir ) * 0.5 + 0.5, 0.0 ), 3.0 ) * ( 1.0 - smoothstep( 0.0, 10.0, depth ) );
  vec3 col = mix( body, sky, fres ) + glint;
  // shoreline foam
  float fN = texture2D( tNormal, uv * 0.13 + vec2( time * 0.01, 0.0 ) ).r;
  float fN2 = texture2D( tNormal, uv * 0.41 - vec2( 0.0, time * 0.02 ) ).g;
  float wave = 0.5 + 0.5 * sin( time * 1.1 - depth * 5.0 + fN * 5.0 );
  float foam = smoothstep( 0.75, 0.05, depth + ( fN - 0.5 ) * 0.5 ) * smoothstep( 0.35, 0.65, fN2 * 0.6 + wave * 0.6 );
  foam += smoothstep( 0.12, 0.0, depth ) * 0.35;
  foam *= smoothstep(0.0, 0.06, depth) * (0.65 + 0.35 * fN2);
  col = mix( col, vec3( 0.7, 0.76, 0.75 ) * lightLevel, clamp( foam, 0.0, 1.0 ) * 0.7 );
  float alpha = mix( 0.42, 0.97, smoothstep( 0.0, 3.5, depth ) );
  alpha = max( alpha, fres );
  alpha = max( alpha, clamp( foam, 0.0, 1.0 ) * 0.85 );
  alpha *= smoothstep( -0.02, 0.06, depth + 0.05 );
  gl_FragColor = vec4( col, alpha );
  #include <fog_fragment>
}`;

export class Water {
  constructor(heightTex, normalTex, worldSize) {
    this.uniforms = {
      ...fogUniforms(),
      tHeight: { value: heightTex },
      tNormal: { value: normalTex },
      time: atmo.time,
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(1, 1, 1) },
      horizonCol: { value: new THREE.Color() },
      horizonSunCol: { value: new THREE.Color() },
      zenithCol: { value: new THREE.Color() },
      lightLevel: { value: 1 },
      worldSize: { value: worldSize },
      rain: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
      depthWrite: true,
    });
    const geo = new THREE.PlaneGeometry(1, 1, 32, 32);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.set(30000, 1, 30000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'water';
  }

  update(env, camera) {
    this.mesh.position.set(Math.round(camera.position.x / 50) * 50, 0, Math.round(camera.position.z / 50) * 50);
    const u = this.uniforms;
    u.sunDir.value.copy(env.sunDir);
    u.sunColor.value.copy(env.sunColor).multiplyScalar(env.nightFactor > 0.5 ? 0.15 : Math.max(0, env.sun.intensity / 3));
    u.horizonCol.value.copy(env.fogCol);
    u.horizonSunCol.value.copy(env.fogSunCol);
    // zenith colour ~ darker, bluer version of the horizon
    u.zenithCol.value.copy(env.fogCol).multiply(new THREE.Color(0.55, 0.7, 1.05));
    const sunUp = Math.max(0, env.sunDir.y);
    u.lightLevel.value = 0.05 + sunUp * 0.9 + env.fogCol.g * 2.0;
    u.rain.value = env.climate ? env.climate.rain : 0;
  }
}
