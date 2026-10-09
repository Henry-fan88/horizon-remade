// Rain-wet and snow-covered surfaces for every lit material in the world.
//
// Like the atmosphere (sky.js installAtmosphere), this patches three.js's shared shader
// chunks once at start-up, so every MeshStandardMaterial / MeshPhysicalMaterial (terrain,
// roads, buildings, props, trees) answers the weather through a few shared uniforms with no
// per-material code. It runs after each material's own colour, roughness and normal code,
// just before the lighting, and finds the world position in the fog varying.
//
// - Wet: rough (porous) surfaces darken, everything turns glossier, vertical faces less so.
// - Puddles: flat ground collects standing water (mirror-smooth, rain rings near the camera).
// - Snow: up-facing surfaces whiten, with a noisy edge on slopes.
//
// Materials opt out with `defines.NO_WEATHER` (cars: world-space puddles would slide over a
// moving body) or `defines.NO_WEATHER_SNOW` (terrain and roads draw their own snow).
// `defines.WEATHER_SOFT` (softWeather) marks natural ground and plants: they darken and gloss
// up a little in the rain but never turn into a mirror film or collect puddles.

import * as THREE from 'three';

// Shared by reference with every material (plain objects survive UniformsUtils.clone).
export const weatherSurface = { x: 0, y: 0, z: 0, w: 0 }; // wet, puddles, lying snow, rain
export const weatherParams = { x: 0, y: 0, z: 0, w: 0 }; // time (s)

const pars = /* glsl */ `
#if defined( USE_FOG ) && ! defined( NO_WEATHER )
#define USE_WEATHER
uniform vec4 weatherSurface;
uniform vec4 weatherParams;
float weatherHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float weatherNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( weatherHash( i ), weatherHash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( weatherHash( i + vec2( 0.0, 1.0 ) ), weatherHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// Rain rings on standing water: one drop per cell in two offset grids, each ring expanding
// and fading once a cycle at its own phase. Returns the water's surface slope (x, z).
vec2 weatherRipples( vec2 p, float t ) {
  vec2 slope = vec2( 0.0 );
  for ( int k = 0; k < 2; k ++ ) {
    float fk = float( k );
    vec2 q = p * ( 2.6 + fk * 1.1 ) + fk * 17.3;
    vec2 cell = floor( q );
    vec2 f = fract( q ) - 0.5;
    float h = weatherHash( cell + fk * 3.1 );
    vec2 c = vec2( weatherHash( cell + 1.7 ), weatherHash( cell + 4.3 ) ) * 0.5 - 0.25;
    float ph = fract( t * ( 0.9 + h * 0.6 ) + h );
    vec2 d = f - c;
    float r = length( d );
    float ring = r - ph * 0.42;
    float wave = sin( clamp( ring * 38.0, -3.1416, 3.1416 ) ) * ( 1.0 - ph ) * ( 1.0 - ph );
    slope += d / max( r, 1e-3 ) * wave * ( 1.0 - smoothstep( 0.055, 0.083, abs( ring ) ) );
  }
  return slope * 0.35;
}
void applyWeather( inout vec3 albedo, inout float rough, float metal, inout vec3 n, vec3 wp ) {
  vec4 ws = weatherSurface;
  vec3 wn = normalize( ( vec4( n, 0.0 ) * viewMatrix ).xyz ); // world-space normal
  float up = clamp( wn.y, 0.0, 1.0 );
  vec3 upView = ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
  if ( ws.x > 0.001 ) {
    float porous = ( 1.0 - metal ) * smoothstep( 0.25, 0.9, rough );
    float wet = ws.x * mix( 0.55, 1.0, up );
#ifdef WEATHER_SOFT
    // soil, grass and leaves: darker and a little glossier, never a mirror film or puddles
    albedo *= 1.0 - 0.3 * porous * wet;
    rough = mix( rough, rough * 0.7, wet );
  }
#else
    // hard porous surfaces soak up water and darken under a smooth film; walls shed it
    albedo *= 1.0 - 0.5 * porous * wet;
    rough = mix( rough, min( rough, 0.14 ), wet * mix( 0.45, 0.85, porous ) );
    // standing water on flat ground, spreading as it keeps raining; the edge is widened by
    // its own screen-space change so distant puddles don't break up into stair-steps
    float flatness = smoothstep( 0.95, 0.995, up );
    float pn = weatherNoise( wp.xz * 0.12 ) * 0.66 + weatherNoise( wp.xz * 0.5 + 7.0 ) * 0.34;
    float level = 0.82 - 0.22 * ws.y;
    float aa = fwidth( pn ) * 1.5;
    float puddle = flatness * smoothstep( level - aa, level + 0.04 + aa, pn ) * min( 1.0, ws.y * 3.0 );
    if ( puddle > 0.001 ) {
      albedo *= 1.0 - 0.3 * puddle;
      rough = mix( rough, 0.04, puddle );
      vec3 water = upView;
      // rain rings only where they are big enough on screen to read as rings
      float rings = ws.w * ( 1.0 - smoothstep( 0.012, 0.04, length( fwidth( wp.xz ) ) ) );
      if ( rings > 0.01 ) {
        vec2 s = weatherRipples( wp.xz, weatherParams.x ) * min( 1.0, rings * 1.5 );
        water = normalize( ( viewMatrix * vec4( -s.x, 1.0, -s.y, 0.0 ) ).xyz );
      }
      n = normalize( mix( n, water, puddle ) );
    }
  }
#endif
#ifndef NO_WEATHER_SNOW
  if ( ws.z > 0.001 ) {
    float sn = weatherNoise( wp.xz * 0.55 ) * 0.55 + weatherNoise( wp.xz * 2.3 + 3.0 ) * 0.45;
    float cover = ws.z * smoothstep( 0.42, 0.72, up + ( sn - 0.5 ) * 0.36 );
    albedo = mix( albedo, vec3( 0.85, 0.88, 0.93 ), cover );
    rough = mix( rough, 0.8, cover );
    n = normalize( mix( n, upView, cover * 0.55 ) );
  }
#endif
}
#endif
`;

const apply = /* glsl */ `
#ifdef USE_WEATHER
if ( weatherSurface.x + weatherSurface.z > 0.002 ) applyWeather( diffuseColor.rgb, roughnessFactor, metalnessFactor, normal, vFogWorldPos );
#endif
`;

let installed = false;
// Call after installAtmosphere (it provides the world position varying).
export function installWeatherSurfaces() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.lights_physical_pars_fragment = pars + THREE.ShaderChunk.lights_physical_pars_fragment;
  THREE.ShaderChunk.lights_physical_fragment = apply + THREE.ShaderChunk.lights_physical_fragment;
  for (const key of ['standard', 'physical']) {
    Object.assign(THREE.ShaderLib[key].uniforms, {
      weatherSurface: { value: weatherSurface },
      weatherParams: { value: weatherParams },
    });
  }
}

// Keep a model (a car) out of the weather: puddles and snow are laid out in world space.
export function excludeFromWeather(object) {
  object.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (!m.isMeshStandardMaterial || m.defines?.NO_WEATHER !== undefined) continue;
      m.defines = { ...m.defines, NO_WEATHER: '' };
      m.needsUpdate = true;
    }
  });
}

// Natural ground and plants (terrain, grass, leaves, bark): wet without a mirror film.
export function softWeather(material) {
  material.defines = { ...material.defines, WEATHER_SOFT: '' };
  return material;
}
