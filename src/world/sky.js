// Sky, sun, atmosphere fog and time of day.
//
// The fog chunks of every built-in material are replaced with a height-based,
// sun-tinted aerial perspective model so distant hills fade into the sky the way
// the festival vistas do. Extra fog uniforms are plain objects shared by reference.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math.js';

export const atmo = {
  sunDir: { x: 0.3, y: 0.5, z: 0.4 },
  sunFogColor: { x: 1, y: 0.8, z: 0.6 },
  fogParams: { x: 0.00022, y: 0.0045, z: 0, w: 14 }, // density, height falloff, base height, sun power
  time: { value: 0 },
};

let installed = false;
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorldPos = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunColor;
  uniform vec3 fogSunDir;
  uniform vec4 fogParams;
  varying vec3 vFogWorldPos;
  vec3 applyAtmosphere( vec3 col, vec3 worldPos ) {
    vec3 ray = worldPos - cameraPosition;
    float dist = length( ray );
    vec3 dir = ray / max( dist, 1e-4 );
    float b = fogParams.y;
    float h0 = max( cameraPosition.y - fogParams.z, 0.0 );
    float k = b * ray.y;
    float integ = abs( k ) > 1e-4 ? ( 1.0 - exp( -k ) ) / k : 1.0;
    float amt = fogParams.x * exp( -b * h0 ) * dist * integ;
    float f = 1.0 - exp( -amt );
    float s = pow( max( dot( dir, fogSunDir ), 0.0 ), fogParams.w );
    return mix( col, mix( fogColor, fogSunColor, s ), f );
  }
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere( gl_FragColor.rgb, vFogWorldPos );
#endif`;
  for (const key in THREE.ShaderLib) {
    const lib = THREE.ShaderLib[key];
    if (lib.uniforms && lib.uniforms.fogColor) Object.assign(lib.uniforms, fogExtraUniforms());
  }
}

export function fogExtraUniforms() {
  return {
    fogSunColor: { value: atmo.sunFogColor },
    fogSunDir: { value: atmo.sunDir },
    fogParams: { value: atmo.fogParams },
  };
}

// Uniforms to merge into custom ShaderMaterials that use fog
export function fogUniforms() {
  return {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...fogExtraUniforms(),
  };
}

// --------------------------------------------------------------------------
// Preetham sky, CPU port (for fog colours, sun light colour)

const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const cutoffAngle = 1.6110731556870734;
const steepness = 1.5;
const EE = 1000;
export const SKY_EXPOSURE = 0.125; // Preetham output is ~10x brighter than our sun-lit ground
const SKY_SCALE = 0.04 * SKY_EXPOSURE;

function sunIntensity(zc) {
  zc = clamp(zc, -1, 1);
  return EE * Math.max(0, 1 - Math.exp(-(cutoffAngle - Math.acos(zc)) / steepness));
}

const _betaR = [0, 0, 0];
const _betaM = [0, 0, 0];
export function skyRadiance(dir, sun, p, out = [0, 0, 0]) {
  const sunE = sunIntensity(sun.y);
  const c = 0.2 * p.turbidity * 10e-18;
  const betaR = _betaR,
    betaM = _betaM;
  for (let i = 0; i < 3; i++) {
    betaR[i] = totalRayleigh[i] * p.rayleigh;
    betaM[i] = 0.434 * c * MieConst[i] * p.mieCoefficient;
  }
  const zen = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv,
    sM = 1.25e3 * inv;
  const cosT = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(1 - 2 * g * cosT + g * g, 1.5));
  const hz = clamp(Math.pow(1 - sun.y, 5), 0, 1);
  for (let i = 0; i < 3; i++) {
    const Fex = Math.exp(-(betaR[i] * sR + betaM[i] * sM));
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    Lin *= lerp(1, Math.pow(sunE * ratio * Fex, 0.5), hz);
    const L0 = 0.1 * Fex;
    out[i] = (Lin + L0) * SKY_SCALE;
  }
  out[1] += 0.0003 * SKY_EXPOSURE;
  out[2] += 0.00075 * SKY_EXPOSURE;
  return out;
}

// --------------------------------------------------------------------------

const skyVertex = /* glsl */ `
uniform vec3 sunDirection;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
varying vec3 vDir;
varying vec3 vSunDirection;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
const float e = 2.718281828459045;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity( float zc ) {
  zc = clamp( zc, -1.0, 1.0 );
  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zc ) ) / steepness ) ) );
}
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p;
  vSunDirection = normalize( sunDirection );
  vSunE = sunIntensity( vSunDirection.y );
  vBetaR = totalRayleigh * rayleigh;
  float c = ( 0.2 * turbidity ) * 10E-18;
  vBetaM = 0.434 * c * MieConst * mieCoefficient;
}`;

const skyFragment = /* glsl */ `
varying vec3 vDir;
varying vec3 vSunDirection;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
uniform float mieDirectionalG;
uniform float time;
uniform float cloudCoverage;
uniform float cloudDensity;
uniform float night;
uniform vec3 moonDirection;
uniform vec3 groundColor;
uniform float groundMix;
uniform float showSun;
uniform vec3 horizonColor;
uniform vec3 horizonSunColor;
uniform float skyScale;
uniform float starMoon;

const float pi = 3.141592653589793;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99995;

vec2 grad2( vec2 i ) {
  vec3 p = fract( i.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.xx + p.yz ) * p.zy ) * 2.0 - 1.0;
}
float gnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float a = dot( grad2( i ), f );
  float b = dot( grad2( i + vec2( 1.0, 0.0 ) ), f - vec2( 1.0, 0.0 ) );
  float c = dot( grad2( i + vec2( 0.0, 1.0 ) ), f - vec2( 0.0, 1.0 ) );
  float d = dot( grad2( i + vec2( 1.0, 1.0 ) ), f - vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.6;
}
float fbm( vec2 p, float drift ) {
  float r = 0.0; float a = 1.0;
  for ( int i = 0; i < 5; i ++ ) { r += a * gnoise( p ); a *= 0.5; p = p * 2.03 + drift; }
  return r;
}
float hash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float rayleighPhase( float c ) { return 0.05968310365946075 * ( 1.0 + c * c ); }
float hgPhase( float c, float g ) {
  float g2 = g * g;
  return 0.07957747154594767 * ( ( 1.0 - g2 ) / pow( 1.0 - 2.0 * g * c + g2, 1.5 ) );
}

void main() {
  vec3 direction = normalize( vDir );
  vec3 dirUp = vec3( direction.x, max( direction.y, 0.0 ), direction.z );
  float zenithAngle = acos( max( 0.0, direction.y ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );
  float cosTheta = dot( direction, vSunDirection );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase( cosTheta, mieDirectionalG );
  vec3 betaMTheta = vBetaM * mPhase;
  vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.5 ) ), clamp( pow( 1.0 - vSunDirection.y, 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  float sundisc = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta ) * showSun;
  vec3 col = ( ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 ) ) * skyScale;
  col += ( 900.0 * sundisc ) * min( vSunE * Fex, 60.0 ) * 0.04 * 0.35 * skyScale;

  // night sky: deep blue gradient + stars + moon
  vec3 nightCol = mix( vec3( 0.0045, 0.0075, 0.016 ), vec3( 0.0012, 0.0022, 0.006 ), smoothstep( 0.0, 0.6, direction.y ) );
  col += nightCol * night;
  if ( starMoon > 0.5 && night > 0.01 && direction.y > 0.0 ) {
    vec3 sp = direction * 380.0;
    vec3 cell = floor( sp );
    float h = hash13( cell );
    if ( h > 0.9965 ) {
      vec3 center = cell + 0.5 + ( vec3( hash13( cell + 1.3 ), hash13( cell + 2.7 ), hash13( cell + 5.1 ) ) - 0.5 ) * 0.6;
      float d = length( sp - center );
      float tw = 0.7 + 0.3 * sin( time * ( 2.0 + h * 5.0 ) + h * 100.0 );
      col += vec3( 0.9, 0.95, 1.0 ) * smoothstep( 0.35, 0.0, d ) * ( h - 0.9965 ) * 180.0 * night * tw * smoothstep( 0.0, 0.2, direction.y );
    }
    float md = dot( direction, normalize( moonDirection ) );
    col += vec3( 0.9, 0.92, 1.0 ) * smoothstep( 0.99965, 0.99975, md ) * 1.2 * night;
    col += vec3( 0.25, 0.3, 0.45 ) * pow( max( md, 0.0 ), 60.0 ) * 0.06 * night;
  }

  // clouds
  float cloudA = 0.0;
  if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {
    vec2 uv = direction.xz / ( direction.y + 0.08 ) * 0.9;
    uv += vec2( time * 0.0035, time * 0.0012 );
    float evolve = time * 0.01;
    float n = clamp( fbm( uv * 1.6, evolve ) * 0.7 + 0.5, 0.0, 1.0 );
    float region = gnoise( uv * 0.35 ) * 0.37 + 0.5;
    float cov = clamp( cloudCoverage + ( region - 0.5 ) * 0.7, 0.0, 1.0 );
    float thr = 1.0 - cov;
    float mask = smoothstep( thr, thr + 0.28, n );
    float horizonFade = smoothstep( 0.0, 0.12, direction.y );
    mask *= horizonFade;
    float day = smoothstep( -0.1, 0.25, vSunDirection.y );
    vec3 sunCol = vSunE * Fex * 0.22 * 0.04 * skyScale;
    vec3 amb = ( Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 ) ) * skyScale;
    float depth = max( 0.0, n - thr );
    float beer = exp( depth * -4.0 );
    float powder = 1.0 - beer * beer;
    float shade = mix( 0.42, 1.0, clamp( beer * powder * 2.6, 0.0, 1.0 ) );
    float silver = clamp( 0.51 / pow( 1.49 - cosTheta * 1.4, 1.5 ), 0.0, 3.0 );
    float edge = mask * ( 1.0 - mask ) * 4.0;
    // Neutral multiple scattering gives clouds a lit body, instead of tinting
    // the entire cloud with the blue radiance sampled behind it.
    float ambientLuma = dot(amb, vec3(0.2126, 0.7152, 0.0722));
    vec3 cc = mix(amb, vec3(ambientLuma), 0.55) * 1.35 + sunCol * shade * 1.2;
    cc += sunCol * silver * edge * 0.7;
    cc *= max( day, 0.0 );
    cc += nightCol * 1.6 * night;
    float alpha = ( 1.0 - exp( depth * cloudDensity * -12.0 ) ) * horizonFade;
    vec3 aerial = mix( col, cc, clamp( Fex * 1.2, 0.0, 1.0 ) );
    col = mix( col, aerial, alpha );
    cloudA = alpha;
  }

  // Blend towards the fog colour at the horizon so terrain silhouettes melt in
  vec2 dh = direction.xz + vec2( 1e-5, 0.0 );
  vec2 sh = vSunDirection.xz + vec2( 1e-5, 0.0 );
  float s = pow( max( dot( normalize( dh ), normalize( sh ) ), 0.0 ), 6.0 );
  vec3 hz = mix( horizonColor, horizonSunColor, s );
  col = mix( col, hz, smoothstep( 0.1, -0.01, direction.y ) * 0.85 );
  if ( direction.y < 0.0 ) col = mix( hz, groundColor, groundMix * smoothstep( 0.0, -0.15, direction.y ) );
  col = max( col, vec3( 0.0 ) );
  if ( any( isnan( col ) ) ) col = hz;
  // alpha carries cloud cover, so the cached sky can hide the sun and stars behind clouds
  gl_FragColor = vec4( min( col, vec3( 2000.0 ) ), cloudA );
}`;

// The sky drawn on screen: the cached scattering / clouds cube, plus the sharp parts that
// need full resolution (sun disc, moon, stars). It sits at the far plane and is drawn after
// the opaque world, so only pixels where sky is actually visible run this shader.
const skyViewVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  // Keep the sky at the far plane even in the short-range reflection camera.
  #ifdef USE_REVERSED_DEPTH_BUFFER
    gl_Position.z = 0.0;
  #else
    gl_Position.z = gl_Position.w;
  #endif
}`;

const skyViewFragment = /* glsl */ `
uniform samplerCube tSky;
uniform vec3 sunDirection;
uniform vec3 sunDiscColor;
uniform vec3 moonDirection;
uniform float night;
uniform float time;
varying vec3 vDir;
float hash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
void main() {
  vec3 direction = normalize( vDir );
  vec4 sky = textureCube( tSky, direction );
  vec3 col = sky.rgb;
  float clear = 1.0 - sky.a;
  float cosTheta = dot( direction, sunDirection );
  col += sunDiscColor * smoothstep( 0.99995, 0.99997, cosTheta ) * clear;
  if ( night > 0.01 && direction.y > 0.0 ) {
    vec3 sp = direction * 380.0;
    vec3 cell = floor( sp );
    float h = hash13( cell );
    if ( h > 0.9965 ) {
      vec3 center = cell + 0.5 + ( vec3( hash13( cell + 1.3 ), hash13( cell + 2.7 ), hash13( cell + 5.1 ) ) - 0.5 ) * 0.6;
      float d = length( sp - center );
      float tw = 0.7 + 0.3 * sin( time * ( 2.0 + h * 5.0 ) + h * 100.0 );
      col += vec3( 0.9, 0.95, 1.0 ) * smoothstep( 0.35, 0.0, d ) * ( h - 0.9965 ) * 180.0 * night * tw * smoothstep( 0.0, 0.2, direction.y ) * clear;
    }
    float md = dot( direction, normalize( moonDirection ) );
    col += vec3( 0.9, 0.92, 1.0 ) * smoothstep( 0.99965, 0.99975, md ) * 1.2 * night * clear;
    col += vec3( 0.25, 0.3, 0.45 ) * pow( max( md, 0.0 ), 60.0 ) * 0.06 * night;
  }
  gl_FragColor = vec4( col, 1.0 );
}`;

export class Sky {
  constructor() {
    this.uniforms = {
      sunDirection: { value: new THREE.Vector3(0.3, 0.5, 0.4) },
      rayleigh: { value: 1.6 },
      turbidity: { value: 3.2 },
      mieCoefficient: { value: 0.005 },
      mieDirectionalG: { value: 0.78 },
      time: atmo.time,
      cloudCoverage: { value: 0.38 },
      cloudDensity: { value: 0.55 },
      night: { value: 0 },
      moonDirection: { value: new THREE.Vector3(-0.3, 0.6, -0.5) },
      groundColor: { value: new THREE.Color(0.02, 0.025, 0.02) },
      groundMix: { value: 0 },
      showSun: { value: 1 },
      horizonColor: { value: new THREE.Color() },
      horizonSunColor: { value: new THREE.Color() },
      skyScale: { value: SKY_EXPOSURE },
      starMoon: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }
}

// The on-screen sky: samples a cube of the full sky model that is refreshed one face per
// frame (clouds drift and the sun moves slowly), so the heavy scattering and cloud noise run
// on ~150k cube texels a frame instead of every sky pixel on screen.
export class SkyView {
  constructor(size = 384) {
    this.source = new Sky();
    this.source.uniforms.showSun.value = 0;
    this.source.uniforms.starMoon.value = 0;
    this.scene = new THREE.Scene();
    this.scene.add(this.source.mesh);
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    this.cam = new THREE.CubeCamera(1, 2000, this.rt);
    this.scene.add(this.cam);
    this.face = 0;
    this.primed = false;
    this.uniforms = {
      tSky: { value: this.rt.texture },
      sunDirection: this.source.uniforms.sunDirection,
      sunDiscColor: { value: new THREE.Color() },
      moonDirection: this.source.uniforms.moonDirection,
      night: this.source.uniforms.night,
      time: this.source.uniforms.time,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyViewVertex,
      fragmentShader: skyViewFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    // a sphere just inside the far plane, beyond everything else in the world
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(15500, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.name = 'sky';
    this.uniforms = mat.uniforms;
  }

  // refresh one cube face (all six the first time, or after a jump in time of day)
  update(renderer, all = false) {
    const cam = this.cam;
    if (cam.coordinateSystem !== renderer.coordinateSystem) {
      cam.coordinateSystem = renderer.coordinateSystem;
      cam.updateCoordinateSystem();
    }
    const prev = renderer.getRenderTarget();
    const faces = all || !this.primed ? 6 : 1;
    for (let k = 0; k < faces; k++) {
      renderer.setRenderTarget(this.rt, this.face);
      renderer.render(this.scene, cam.children[this.face]);
      this.face = (this.face + 1) % 6;
    }
    renderer.setRenderTarget(prev);
    this.primed = true;
  }
}

// --------------------------------------------------------------------------
// Time of day + lighting + env map

const PRESETS = { morning: 8.2, noon: 12.5, golden: 17.35, sunset: 18.05, night: 23.0 };

export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.hour = 15.2;
    this.mode = 'dynamic';
    this.dayMinutes = 24;
    this.skyView = new SkyView();
    this.sky = this.skyView.source; // the full sky model (drawn into the cube)
    scene.add(this.skyView.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 2.5;
    this.shadowRange = 110;
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowRange;
    sc.right = this.shadowRange;
    sc.top = this.shadowRange;
    sc.bottom = -this.shadowRange;
    sc.near = 1;
    sc.far = 1200;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a3222, 0.25);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xaabbcc, 0.0002);

    // Environment map (sky + ground) captured into a cube, then prefiltered
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.uniforms.showSun.value = 0;
    this.envSky.uniforms.groundMix.value = 1;
    this.envSky.uniforms.time = this.sky.uniforms.time;
    this.envScene.add(this.envSky.mesh);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 5000, this.cubeRT);
    this.envScene.add(this.cubeCam);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envTimer = 0;
    this.lastEnvHour = -99;

    this.sunDir = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.fogCol = new THREE.Color();
    this.fogSunCol = new THREE.Color();
    this.exposure = 1;
    this.nightFactor = 0;
    this.lightsOn = false;
    this._tmp = [0, 0, 0];
  }

  setMode(mode) {
    this.mode = mode;
    if (PRESETS[mode] !== undefined) this.hour = PRESETS[mode];
    this.lastEnvHour = -99;
    this.skyView.primed = false;
  }

  computeSun(hour, out) {
    // Sunrise ~6:00, sunset ~18:30, sun arcs through the southern sky
    const a = ((hour - 6.25) / 12.5) * Math.PI;
    const elevMax = 1.1;
    const x = Math.cos(a);
    const up = Math.sin(a);
    out.set(x * 0.95, up * Math.sin(elevMax), up * Math.cos(elevMax) + 0.25).normalize();
    return out;
  }

  update(dt, focus) {
    if (this.mode === 'dynamic') {
      const nightSpeed = this.nightFactor > 0.5 ? 3 : 1;
      this.hour += (dt / 60) * (24 / this.dayMinutes) * nightSpeed;
      if (this.hour >= 24) this.hour -= 24;
    }
    atmo.time.value += dt;
    const sunDir = this.computeSun(this.hour, this.sunDir);
    const elev = sunDir.y;
    const u = this.sky.uniforms;
    // sky parameters shift through the day: hazier, redder near sunset
    const low = 1 - smoothstep(0.0, 0.45, elev);
    u.turbidity.value = lerp(4.2, 6.5, low);
    u.rayleigh.value = lerp(1.25, 2.4, low);
    u.mieCoefficient.value = lerp(0.0028, 0.0052, low);
    u.sunDirection.value.copy(sunDir);
    const night = smoothstep(0.02, -0.16, elev);
    this.nightFactor = night;
    u.night.value = night;
    // moon roughly opposite the sun
    u.moonDirection.value.set(-sunDir.x * 0.8 + 0.2, Math.max(0.25, -sunDir.y), -sunDir.z * 0.8 - 0.3).normalize();

    // horizon colours for fog (sampled from the sky model)
    const T = this._tmp2 || (this._tmp2 = { p: {}, toward: {}, away: {}, side: {}, c1: [0, 0, 0], c2: [0, 0, 0], c3: [0, 0, 0] });
    const p = T.p;
    p.rayleigh = u.rayleigh.value;
    p.turbidity = u.turbidity.value;
    p.mieCoefficient = u.mieCoefficient.value;
    p.mieDirectionalG = u.mieDirectionalG.value;
    const hs = Math.hypot(sunDir.x, sunDir.z) || 1;
    const c1 = skyRadiance(setNorm(T.away, -sunDir.x / hs, 0.06, -sunDir.z / hs), sunDir, p, T.c1);
    const c3 = skyRadiance(setNorm(T.side, -sunDir.z / hs, 0.06, sunDir.x / hs), sunDir, p, T.c3);
    const c2 = skyRadiance(setNorm(T.toward, sunDir.x / hs, 0.06, sunDir.z / hs), sunDir, p, T.c2);
    const nightFog = NIGHT_FOG;
    for (let i = 0; i < 3; i++) {
      c1[i] = lerp((c1[i] + c3[i]) * 0.5, nightFog[i], night);
      c2[i] = Math.min(c2[i], c1[i] * 1.45 + 0.01);
      c2[i] = lerp(c2[i], nightFog[i] * 1.2, night);
    }
    this.fogCol.setRGB(c1[0], c1[1], c1[2], THREE.LinearSRGBColorSpace);
    this.fogSunCol.setRGB(c2[0], c2[1], c2[2], THREE.LinearSRGBColorSpace);
    this.scene.fog.color.copy(this.fogCol);
    atmo.sunFogColor.x = c2[0];
    atmo.sunFogColor.y = c2[1];
    atmo.sunFogColor.z = c2[2];
    atmo.sunDir.x = sunDir.x;
    atmo.sunDir.y = sunDir.y;
    atmo.sunDir.z = sunDir.z;
    atmo.fogParams.x = lerp(0.00042, 0.0006, low) * (1 + night * 0.5);
    u.horizonColor.value.copy(this.fogCol);
    u.horizonSunColor.value.copy(this.fogSunCol);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'night']) this.envSky.uniforms[k].value = u[k].value;
    this.envSky.uniforms.sunDirection.value.copy(sunDir);
    this.envSky.uniforms.moonDirection.value.copy(u.moonDirection.value);
    this.envSky.uniforms.horizonColor.value.copy(this.fogCol);
    this.envSky.uniforms.horizonSunColor.value.copy(this.fogSunCol);

    // Sun light colour & intensity
    const sunUp = smoothstep(-0.04, 0.12, elev);
    const warm = 1 - smoothstep(0.03, 0.5, elev);
    this.sunColor.setRGB(1.0, lerp(0.96, 0.62, warm), lerp(0.9, 0.36, warm), THREE.SRGBColorSpace);
    let intensity = lerp(0, 3.3, sunUp) * lerp(1, 0.85, warm);
    // moonlight when the sun is down
    if (night > 0.5) {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.45 * night;
      this.sun.position.copy(u.moonDirection.value);
    } else {
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = intensity;
      this.sun.position.copy(sunDir);
    }
    // ground colour for env reflections
    const gl = 0.06 * sunUp + 0.004;
    this.envSky.uniforms.groundColor.value.setRGB(gl * 0.55, gl * 0.6, gl * 0.45);
    this.hemi.intensity = lerp(0.2, 0.09, night);
    this.hemi.color.setRGB(lerp(0.75, 0.25, night), lerp(0.85, 0.3, night), lerp(1.0, 0.5, night));
    this.hemi.groundColor.setRGB(0.25, 0.22, 0.15);
    this.scene.environmentIntensity = lerp(1.0, 0.5, night);
    this.lightsOn = elev < 0.07;
    this.exposure = lerp(1.0, 3.0, night) * lerp(1, 1.15, warm * (1 - night));

    // Shadow camera follows the focus point with texel snapping
    if (focus) {
      const L = _L.copy(this.sun.position).normalize();
      const dist = 500;
      const r = this.shadowRange;
      const texel = (2 * r) / this.sun.shadow.mapSize.x;
      // build light-space basis to snap
      const up = Math.abs(L.y) > 0.99 ? _X : _Y;
      const right = _right.crossVectors(up, L).normalize();
      const up2 = _up2.crossVectors(L, right);
      const fx = Math.round(focus.dot(right) / texel) * texel;
      const fy = Math.round(focus.dot(up2) / texel) * texel;
      const fz = focus.dot(L);
      const snapped = right.multiplyScalar(fx).add(up2.multiplyScalar(fy)).addScaledVector(L, fz);
      this.sun.target.position.copy(snapped);
      this.sun.position.copy(snapped).addScaledVector(L, dist);
      this.sun.target.updateMatrixWorld();
    }

    // colour of the sun disc drawn over the cached sky (scattering along the sun's direction)
    {
      const sunE = sunIntensity(sunDir.y);
      const zen = Math.acos(Math.max(0, sunDir.y));
      const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
      const c = 0.2 * u.turbidity.value * 10e-18;
      const disc = this._disc || (this._disc = [0, 0, 0]);
      for (let i = 0; i < 3; i++) {
        const fex = Math.exp(-(totalRayleigh[i] * u.rayleigh.value * 8.4e3 * inv + 0.434 * c * MieConst[i] * u.mieCoefficient.value * 1.25e3 * inv));
        disc[i] = 900 * Math.min(sunE * fex, 60) * 0.04 * 0.35 * SKY_EXPOSURE;
      }
      this.skyView.uniforms.sunDiscColor.value.setRGB(disc[0], disc[1], disc[2], THREE.LinearSRGBColorSpace);
    }
    this.skyView.update(this.renderer);

    // refresh env map when the sun has moved enough
    this.envTimer -= dt;
    if (Math.abs(this.hour - this.lastEnvHour) > 0.08 || this.envTimer < -20) {
      this.refreshEnvMap();
    }
  }

  refreshEnvMap() {
    this.lastEnvHour = this.hour;
    this.envTimer = 0;
    this.cubeCam.update(this.renderer, this.envScene);
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }
}

function setNorm(o, x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  o.x = x / l;
  o.y = y / l;
  o.z = z / l;
  return o;
}

const NIGHT_FOG = [0.0035, 0.0055, 0.011];
const _L = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3();
const _up2 = new THREE.Vector3();
