// Fine powder grains and broad wind-packed undulations, expressed in metres.
// The grain signal fades with its screen footprint to avoid driving-camera shimmer.
import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

export const snowReliefGLSL = /* glsl */ `
vec4 snowRelief( vec2 p, float distanceToCamera ) {
  vec2 wind = vec2( 0.87, 0.49 );
  float phase = dot( p, wind ) * 3.2 + sin( dot( p, vec2( -0.49, 0.87 ) ) * 0.67 ) * 0.8;
  float driftFade = ( 1.0 - smoothstep( 0.8, 2.8, fwidth( phase ) ) ) * ( 1.0 - smoothstep( 35.0, 120.0, distanceToCamera ) );
  vec2 gradient = wind * cos( phase ) * 0.075 * driftFade;
  vec2 grainUv = p * 6.8;
  float footprint = max( length( dFdx( grainUv ) ), length( dFdy( grainUv ) ) );
  float grainFade = ( 1.0 - smoothstep( 0.18, 0.9, footprint ) ) * ( 1.0 - smoothstep( 5.0, 22.0, distanceToCamera ) );
  vec3 grain = texture2D( tDetail, grainUv ).rgb - 0.5;
  gradient += grain.rg * 0.2 * grainFade;
  float powder = texture2D( tDetail, p * 0.43 ).g;
  float value = 1.0 + sin( phase ) * 0.035 * driftFade + grain.b * 0.22 * grainFade;
  return vec4( gradient, value, mix( 0.85, 0.97, powder ) );
}
`;

let detail;
export function snowDetailTexture() {
  if (detail) return detail;
  const size = 128, rnd = mulberry32(8419), pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    pixels[i] = rnd() * 255;
    pixels[i + 1] = 128 + Math.sin(x * Math.PI / 16) * Math.cos(y * Math.PI / 32) * 66;
    pixels[i + 2] = rnd() * 255; pixels[i + 3] = 255;
  }
  detail = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.minFilter = THREE.LinearMipmapLinearFilter; detail.magFilter = THREE.LinearFilter;
  detail.generateMipmaps = true; detail.needsUpdate = true;
  return detail;
}
