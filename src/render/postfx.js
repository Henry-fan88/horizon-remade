// HDR render target -> bloom -> final grade (speed blur, sharpen, ACES, colour grade, vignette).
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const finalFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float exposure;
uniform float time;
uniform float speedBlur;
uniform vec2 blurCenter;
uniform float vignette;
uniform float saturation;
uniform float contrast;
uniform float sharpen;
uniform float fade;
uniform vec3 fadeColor;
uniform float flash;
varying vec2 vUv;

vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 aces( vec3 color ) {
  const mat3 ACESInputMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 ACESOutputMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color = ACESInputMat * color;
  color = RRTAndODTFit( color );
  color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}
vec3 toSRGB( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

void main() {
  vec2 uv = vUv;
  vec2 px = 1.0 / resolution;
  vec3 col = texture2D( tDiffuse, uv ).rgb;
  if ( any( isnan( col ) ) || any( isinf( col ) ) ) col = vec3( 0.0 );
  if ( sharpen > 0.0 ) {
    vec3 nb = texture2D( tDiffuse, uv + vec2( px.x, 0.0 ) ).rgb + texture2D( tDiffuse, uv - vec2( px.x, 0.0 ) ).rgb
      + texture2D( tDiffuse, uv + vec2( 0.0, px.y ) ).rgb + texture2D( tDiffuse, uv - vec2( 0.0, px.y ) ).rgb;
    vec3 sharp = col + ( col - nb * 0.25 ) * sharpen;
    col = max( sharp, col * 0.5 );
  }
  if ( speedBlur > 0.001 ) {
    vec2 d = uv - blurCenter;
    float m = smoothstep( 0.12, 0.75, length( d * vec2( resolution.x / resolution.y, 1.0 ) ) );
    vec3 acc = col;
    float jitter = hash( gl_FragCoord.xy + time );
    for ( int i = 1; i < 10; i ++ ) {
      float t = ( float( i ) + jitter ) / 10.0;
      acc += texture2D( tDiffuse, uv - d * t * speedBlur * 0.085 * m ).rgb;
    }
    col = acc / 10.0;
  }
  col *= exposure;
  col = aces( col / 0.6 );
  col = toSRGB( col );
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( l ), col, saturation );
  col = ( col - 0.5 ) * contrast + 0.5;
  // split toning: warm highlights, slightly cool shadows
  col += vec3( 0.012, 0.006, -0.008 ) * smoothstep( 0.4, 1.0, l ) + vec3( -0.005, 0.0, 0.007 ) * ( 1.0 - smoothstep( 0.0, 0.4, l ) );
  vec2 vv = ( vUv - 0.5 ) * vec2( 1.0, 0.85 );
  col *= 1.0 - dot( vv, vv ) * vignette;
  col = mix( col, fadeColor, fade );
  col += flash;
  col += ( hash( gl_FragCoord.xy + fract( time ) * 100.0 ) - 0.5 ) / 255.0;
  gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}`;

export class PostFX {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.msaa = opts.msaa ?? 4;
    this.scale = opts.scale ?? 1;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x * this.scale)),
      h = Math.max(1, Math.floor(size.y * this.scale));
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.msaa,
      depthBuffer: true,
      depthTexture,
    });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.14, 0.4, 1.05);
    // guard the bloom chain against stray NaN/Inf pixels (one bad pixel would smear everywhere)
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv ); if ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 ); texel.rgb = min( texel.rgb, vec3( 4.0 ) );'
    );
    hp.needsUpdate = true;
    this.uniforms = {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(w, h) },
      exposure: { value: 1 },
      time: { value: 0 },
      speedBlur: { value: 0 },
      blurCenter: { value: new THREE.Vector2(0.5, 0.52) },
      vignette: { value: 0.28 },
      saturation: { value: 1.02 },
      contrast: { value: 1.035 },
      sharpen: { value: 0.15 },
      fade: { value: 0 },
      fadeColor: { value: new THREE.Color(0, 0, 0) },
      flash: { value: 0 },
    };
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
        fragmentShader: finalFrag,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.bloomEnabled = true;
  }

  setSize(w, h) {
    const W = Math.max(1, Math.floor(w * this.scale)),
      H = Math.max(1, Math.floor(h * this.scale));
    this.rt.setSize(W, H);
    this.bloom.setSize(W, H);
    this.uniforms.resolution.value.set(W, H);
  }

  setQuality({ msaa, scale }) {
    if (msaa !== undefined && msaa !== this.msaa) {
      this.msaa = msaa;
      this.rt.samples = msaa;
      this.rt.dispose();
    }
    if (scale !== undefined) this.scale = scale;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
  }

  render(scene, camera, dt) {
    const r = this.renderer;
    this.uniforms.time.value += dt;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    if (this.bloomEnabled) this.bloom.render(r, null, this.rt, dt, false);
    this.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
