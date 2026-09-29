// HDR render target -> bloom -> final grade (speed blur, sharpen, ACES, colour grade, vignette).
// Bloom is a dual-filter mip chain: a thresholded half-resolution prefilter, box downsamples
// and tent upsamples accumulated back up the chain. The final grade samples the result
// directly, so no full-resolution bloom pass or extra full-screen blend is needed.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const finalFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float bloomStrength;
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
  if ( bloomStrength > 0.0 ) col += texture2D( tBloom, uv ).rgb * bloomStrength;
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

const quadVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';

// source -> half resolution: 4 bilinear taps (a 4x4 texel footprint), Karis-weighted against
// fireflies, then a soft brightness threshold
const prefilterFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
vec3 tap( vec2 uv ) {
  vec3 c = texture2D( tSrc, uv ).rgb;
  if ( any( isnan( c ) ) || any( isinf( c ) ) ) c = vec3( 0.0 );
  return min( c, vec3( 4.0 ) );
}
float karis( vec3 c ) { return 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }
void main() {
  vec3 a = tap( vUv + texel * vec2( -1.0, -1.0 ) ), b = tap( vUv + texel * vec2( 1.0, -1.0 ) );
  vec3 c = tap( vUv + texel * vec2( -1.0, 1.0 ) ), d = tap( vUv + texel * vec2( 1.0, 1.0 ) );
  float wa = karis( a ), wb = karis( b ), wc = karis( c ), wd = karis( d );
  vec3 col = ( a * wa + b * wb + c * wc + d * wd ) / ( wa + wb + wc + wd );
  float br = max( col.r, max( col.g, col.b ) );
  float soft = clamp( br - threshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee + 1e-4 );
  gl_FragColor = vec4( col * max( soft, br - threshold ) / max( br, 1e-4 ), 1.0 );
}`;

// dual-filter downsample: centre x4 + four diagonal half-texel taps
const downFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D( tSrc, vUv ).rgb * 4.0;
  s += texture2D( tSrc, vUv - texel ).rgb;
  s += texture2D( tSrc, vUv + texel ).rgb;
  s += texture2D( tSrc, vUv + vec2( texel.x, -texel.y ) ).rgb;
  s += texture2D( tSrc, vUv - vec2( texel.x, -texel.y ) ).rgb;
  gl_FragColor = vec4( s * 0.125, 1.0 );
}`;

// dual-filter (tent) upsample, blended additively onto the next level up
const upFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float weight;
varying vec2 vUv;
void main() {
  vec3 s = texture2D( tSrc, vUv + vec2( -texel.x * 2.0, 0.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( -texel.x, texel.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 0.0, texel.y * 2.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( texel.x, texel.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( texel.x * 2.0, 0.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( texel.x, -texel.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 0.0, -texel.y * 2.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( -texel.x, -texel.y ) ).rgb * 2.0;
  gl_FragColor = vec4( s / 12.0 * weight, 1.0 );
}`;

class Bloom {
  constructor() {
    this.levels = 5;
    this.startDiv = 2; // 2 = half resolution (4 for the lite version)
    this.targets = [];
    const mk = (frag, extra = {}) =>
      new FullScreenQuad(
        new THREE.ShaderMaterial({
          uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, ...extra },
          vertexShader: quadVert,
          fragmentShader: frag,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        })
      );
    this.prefilter = mk(prefilterFrag, { threshold: { value: 1.05 }, knee: { value: 0.35 } });
    this.down = mk(downFrag);
    this.up = mk(upFrag, { weight: { value: 0.85 } });
    this.up.material.blending = THREE.AdditiveBlending;
    this.up.material.transparent = true;
    this.w = this.h = 0;
  }

  setSize(w, h, lite) {
    const levels = lite ? 3 : 5;
    const div = lite ? 4 : 2;
    if (w === this.w && h === this.h && levels === this.levels && div === this.startDiv && this.targets.length) return;
    this.w = w;
    this.h = h;
    this.levels = levels;
    this.startDiv = div;
    for (const t of this.targets) t.dispose();
    this.targets = [];
    let tw = Math.max(1, Math.floor(w / div)),
      th = Math.max(1, Math.floor(h / div));
    for (let i = 0; i < levels; i++) {
      this.targets.push(new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }));
      tw = Math.max(1, tw >> 1);
      th = Math.max(1, th >> 1);
    }
  }

  // returns the half (or quarter) resolution bloom texture
  render(r, src, srcW, srcH) {
    const T = this.targets;
    // the upsample adds onto each level, so nothing may clear it in between
    const autoClear = r.autoClear;
    r.autoClear = false;
    const pf = this.prefilter.material.uniforms;
    pf.tSrc.value = src;
    pf.texel.value.set(1 / srcW, 1 / srcH);
    r.setRenderTarget(T[0]);
    this.prefilter.render(r);
    const d = this.down.material.uniforms;
    for (let i = 1; i < T.length; i++) {
      d.tSrc.value = T[i - 1].texture;
      d.texel.value.set(0.5 / T[i - 1].width, 0.5 / T[i - 1].height);
      r.setRenderTarget(T[i]);
      this.down.render(r);
    }
    const u = this.up.material.uniforms;
    for (let i = T.length - 2; i >= 0; i--) {
      u.tSrc.value = T[i + 1].texture;
      u.texel.value.set(0.5 / T[i + 1].width, 0.5 / T[i + 1].height);
      r.setRenderTarget(T[i]);
      this.up.render(r);
    }
    r.autoClear = autoClear;
    return T[0].texture;
  }
}

export class PostFX {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.msaa = opts.msaa ?? 4;
    this.scale = opts.scale ?? 1;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x * this.scale)),
      h = Math.max(1, Math.floor(size.y * this.scale));
    // depth is only needed while rendering the scene: a renderbuffer, not a sampled texture
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.msaa,
      depthBuffer: true,
    });
    this.bloom = new Bloom();
    this.bloomLite = false;
    this.bloom.setSize(w, h, false);
    this.uniforms = {
      tDiffuse: { value: null },
      tBloom: { value: null },
      bloomStrength: { value: 0 },
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
    this.bloom.setSize(W, H, this.bloomLite);
    this.uniforms.resolution.value.set(W, H);
  }

  // 'full' | 'lite' | false
  setBloom(mode) {
    this.bloomEnabled = !!mode;
    this.bloomLite = mode === 'lite';
    this.bloom.setSize(this.rt.width, this.rt.height, this.bloomLite);
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
    if (this.bloomEnabled) {
      this.uniforms.tBloom.value = this.bloom.render(r, this.rt.texture, this.rt.width, this.rt.height);
      this.uniforms.bloomStrength.value = this.bloomLite ? 0.2 : 0.22;
    } else this.uniforms.bloomStrength.value = 0;
    this.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
