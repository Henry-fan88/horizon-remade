// Long-range sun shadows. The sun's shadow map covers ~110 m around the car; beyond it, and
// for mountains outside it, shading comes from a "shadow height" map over the whole island:
// for every 4 m cell, the height below which a point is in shadow. It is found on the GPU by
// marching toward the sun over a caster heightmap (terrain + tree canopies + buildings), and
// recomputed a quarter at a time whenever the sun has moved a little.
//
// Every shaded material fades the near shadow map out at its edge (no hard cut-off line).
// Materials that call useFarShadow() also take the far shadows (terrain, grass, trees, roads).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const placeholder = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(-1e4), THREE.DataUtils.toHalfFloat(-1e4), THREE.DataUtils.toHalfFloat(1), 0]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
placeholder.needsUpdate = true;

// shared by reference into every opted-in material's uniforms
export const FAR_SHADOW_UNIFORMS = {
  tFarShadow: { value: placeholder },
  farShadowWorld: { value: 1 / 4096 },
};

let installed = false;
// Patch the shared shadow chunks (call once, before any material compiles).
export function installShadowChunks() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.shadowmap_pars_vertex += /* glsl */ `
#if defined( FAR_SHADOW ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	varying vec3 vFarShadowPos;
#endif
`;
  C.shadowmap_vertex += /* glsl */ `
#if defined( FAR_SHADOW ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	vFarShadowPos = worldPosition.xyz;
#endif
`;
  C.shadowmap_pars_fragment += /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	// 1 well inside the sun's shadow map, easing to 0 over the outer part of it
	float nearShadowWeight( vec4 coord ) {
		vec2 c = coord.xy / coord.w;
		float e = min( min( c.x, 1.0 - c.x ), min( c.y, 1.0 - c.y ) );
		return smoothstep( 0.0, 0.16, e );
	}
	#ifdef FAR_SHADOW
		uniform sampler2D tFarShadow;
		uniform float farShadowWorld;
		varying vec3 vFarShadowPos;
		float horizonShadow( float nearS, vec4 coord ) {
			vec4 fs = texture2D( tFarShadow, vFarShadowPos.xz * farShadowWorld + 0.5 );
			float y = vFarShadowPos.y + 0.35;
			float allV = smoothstep( fs.r - fs.b, fs.r + fs.b * 0.3, y );
			float terV = smoothstep( fs.g - fs.b, fs.g + fs.b * 0.3, y );
			return mix( allV, min( nearS, terV ), nearShadowWeight( coord ) );
		}
	#else
		float horizonShadow( float nearS, vec4 coord ) {
			return mix( 1.0, nearS, nearShadowWeight( coord ) );
		}
	#endif
#endif
`;
  const line = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  if (!C.lights_fragment_begin.includes(line)) {
    console.warn('[horizon] shadow chunk changed; long-range shadows disabled');
    return;
  }
  C.lights_fragment_begin = C.lights_fragment_begin.replace(
    line,
    'directLight.color *= ( directLight.visible && receiveShadow ) ? horizonShadow( getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), vDirectionalShadowCoord[ i ] ) : 1.0;'
  );
}

// Opt a material into far shadows. Call from (or as) its onBeforeCompile.
export function useFarShadow(material) {
  material.defines = { ...(material.defines || {}), FAR_SHADOW: '' };
  const prev = material.onBeforeCompile;
  const own = prev && prev !== THREE.Material.prototype.onBeforeCompile ? prev : null;
  material.onBeforeCompile = (shader, renderer) => {
    if (own) own.call(material, shader, renderer);
    shader.uniforms.tFarShadow = FAR_SHADOW_UNIFORMS.tFarShadow;
    shader.uniforms.farShadowWorld = FAR_SHADOW_UNIFORMS.farShadowWorld;
  };
  return material;
}

const marchFrag = /* glsl */ `
uniform sampler2D tCaster;
uniform vec3 sunDir;
uniform float worldSize;
varying vec2 vUv;
void main() {
  vec2 p = ( vUv - 0.5 ) * worldSize;
  float hl = length( sunDir.xz );
  vec2 d = hl > 1e-4 ? sunDir.xz / hl : vec2( 1.0, 0.0 );
  float tanE = sunDir.y / max( hl, 1e-4 );
  float sAll = -1e4, sTer = -1e4, tAt = 0.0;
  float t = 7.0, stepLen = 4.0;
  for ( int i = 0; i < 150; i ++ ) {
    vec2 uv = ( p + d * t ) / worldSize + 0.5;
    if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) break;
    vec2 h = texture2D( tCaster, uv ).rg;
    float drop = t * tanE;
    if ( h.r - drop > sAll ) {
      sAll = h.r - drop;
      tAt = t;
    }
    sTer = max( sTer, h.g - drop );
    if ( drop > 460.0 ) break;
    t += stepLen;
    stepLen = min( stepLen * 1.035, 28.0 );
  }
  // penumbra widens with distance to the occluder
  gl_FragColor = vec4( sAll, sTer, 0.8 + tAt * 0.016, 1.0 );
}`;

export class FarShadow {
  constructor(renderer, world, casters, size = 1024) {
    this.renderer = renderer;
    this.worldSize = world.size;
    FAR_SHADOW_UNIFORMS.farShadowWorld.value = 1 / world.size;
    this.casterTex = buildCasterTexture(world, casters);
    this.rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tCaster: { value: this.casterTex }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, worldSize: { value: world.size } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
        fragmentShader: marchFrag,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.size = size;
    this.slice = -1; // -1 idle, 0..3 slices of a refresh in progress
    this.lastDir = new THREE.Vector3(0, -1, 0);
    this.pending = new THREE.Vector3();
    this.ready = false;
  }

  // dir: unit vector toward the light (sun or moon)
  update(dir) {
    if (this.slice < 0) {
      if (this.ready && dir.dot(this.lastDir) > Math.cos(0.004)) return;
      this.pending.copy(dir);
      this.slice = 0;
    }
    const r = this.renderer;
    const u = this.quad.material.uniforms;
    u.sunDir.value.copy(this.pending);
    const prev = r.getRenderTarget();
    const q = this.size / 4;
    // first refresh in one go; later ones a quarter per frame
    const slices = this.ready ? 1 : 4;
    for (let k = 0; k < slices; k++) {
      this.rt.scissor.set(0, this.slice * q, this.size, q);
      this.rt.scissorTest = true;
      r.setRenderTarget(this.rt);
      this.quad.render(r);
      this.slice++;
    }
    this.rt.scissorTest = false;
    r.setRenderTarget(prev);
    if (this.slice >= 4) {
      this.slice = -1;
      this.lastDir.copy(this.pending);
      if (!this.ready) {
        this.ready = true;
        FAR_SHADOW_UNIFORMS.tFarShadow.value = this.rt.texture;
      }
    }
  }
}

// R: terrain + tree canopies + buildings, G: terrain only (half floats, one texel per grid vertex)
function buildCasterTexture(world, casters) {
  const hf = world.hf;
  const S = hf.res + 1;
  const all = new Float32Array(world.data.heights);
  const cell = hf.cell;
  const splat = (x, z, r, top, dome = true) => {
    const ix0 = Math.max(0, Math.floor((x - r + hf.half) / cell)),
      ix1 = Math.min(hf.res, Math.ceil((x + r + hf.half) / cell));
    const iz0 = Math.max(0, Math.floor((z - r + hf.half) / cell)),
      iz1 = Math.min(hf.res, Math.ceil((z + r + hf.half) / cell));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = ix * cell - hf.half - x,
          dz = iz * cell - hf.half - z;
        const d2 = (dx * dx + dz * dz) / (r * r);
        if (d2 > 1.3) continue;
        const h = dome ? top - Math.min(1, d2) * r * 0.35 : top;
        const k = iz * S + ix;
        if (h > all[k]) all[k] = h;
      }
  };
  // tree crowns: height and radius per species (scaled by each instance)
  const crowns = { broadleaf: [9.5, 3.2], birch: [10.5, 2.4], pine: [12.5, 2.3], palm: [9.5, 2.6] };
  for (const [kind, [top, rad]] of Object.entries(crowns)) {
    const v = world.data.veg[kind];
    if (!v) continue;
    for (let i = 0; i < v.length; i += 5) splat(v[i], v[i + 2], Math.max(cell * 0.6, rad * v[i + 3]), v[i + 1] + top * v[i + 3]);
  }
  // buildings and landmarks from the collision world
  for (const s of casters) {
    if (s.kind !== 'building') continue;
    if (s.type === 0) splat(s.x, s.z, Math.max(cell * 0.6, s.r), s.y1, false);
    else {
      const r = Math.max(cell * 0.6, Math.hypot(s.hx, s.hz) * 0.8);
      splat(s.x, s.z, r, s.y1, false);
    }
  }
  const data = new Uint16Array(S * S * 2);
  const src = world.data.heights;
  for (let i = 0; i < S * S; i++) {
    data[i * 2] = THREE.DataUtils.toHalfFloat(all[i]);
    data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(src[i]);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
