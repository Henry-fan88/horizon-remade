// Wind-shaped ripple relief in world metres. Derivative filtering prevents the
// fine crests/grains from shimmering when seen from a low driving camera.
export const sandReliefGLSL = /* glsl */ `
vec3 sandRelief( vec2 p, float distanceToCamera ) {
  vec2 wind = vec2( 0.8, 0.6 ), across = vec2( -0.6, 0.8 );
  float bend = dot( p, across ) * 0.42;
  float swell = dot( p, wind ) * 0.09;
  float phase = dot( p, wind ) * 23.0 + sin( bend ) * 1.7 + sin( swell ) * 1.2;
  float resolved = 1.0 - smoothstep( 0.9, 3.0, fwidth( phase ) );
  float nearRipples = 1.0 - smoothstep( 22.0, 85.0, distanceToCamera );
  vec2 direction = wind * ( 23.0 + cos( swell ) * 0.108 ) + across * cos( bend ) * 0.714;
  float slope = cos( phase ) * 0.010 + cos( phase * 2.0 + 0.6 ) * 0.0035;
  vec2 gradient = direction * slope * resolved * nearRipples;
  float crest = sin( phase ) * 0.065 + sin( phase * 2.0 + 0.6 ) * 0.022;
  vec2 grainUv = p * 9.7;
  float grains = texture2D( tDetail, grainUv ).b - 0.5;
  float grainFootprint = max( length( dFdx( grainUv ) ), length( dFdy( grainUv ) ) );
  float nearGrains = ( 1.0 - smoothstep( 0.3, 1.2, grainFootprint ) ) * ( 1.0 - smoothstep( 7.0, 24.0, distanceToCamera ) );
  return vec3( gradient, 1.0 + crest * resolved * nearRipples + grains * 0.18 * nearGrains );
}
`;
