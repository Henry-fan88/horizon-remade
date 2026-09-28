// Chunked terrain with 4 LOD levels + skirts. LOD0 uses the exact heightfield
// triangulation (anti-diagonal split) so wheels sit exactly on the rendered surface.
import * as THREE from 'three';
import { getSurfaceAssets } from './surface-assets.js';
import { SURF } from './worldgen.js';

const CHUNK = 64;
const STEPS = [1, 2, 4, 8];
const LOD_DIST = [260, 720, 1500];

function createFallbackTerrainMaterial(detailTex) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tDetail = { value: detailTex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 tcolor;
varying vec4 vTColor;
varying vec3 vTPos;
varying vec3 vTNrm;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTColor = tcolor;
vTPos = position;
vTNrm = normal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tDetail;
varying vec4 vTColor;
varying vec3 vTPos;
varying vec3 vTNrm;`
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec3 tcol = pow( vTColor.rgb, vec3( 2.2 ) );
float camD = length( vTPos - cameraPosition );
vec4 dA = texture2D( tDetail, vTPos.xz * 0.011 );
vec4 dB = texture2D( tDetail, vTPos.xz * 0.093 );
vec4 dC = texture2D( tDetail, vTPos.xz * 0.41 );
vec4 dD = texture2D( tDetail, vTPos.xz * 1.37 );
float fine = 1.0 - smoothstep( 40.0, 160.0, camD );
float det = ( dA.r - 0.5 ) * 0.36 + ( dB.g - 0.5 ) * 0.42 + ( dC.b - 0.5 ) * 0.34 * fine + ( dD.b - 0.5 ) * 0.28 * ( 1.0 - smoothstep( 8.0, 40.0, camD ) );
float grassy = vTColor.a;
vec3 alb = tcol * ( 1.0 + det );
// large-scale hue variation in grass: some patches lusher, some drier
alb *= mix( vec3( 1.0 ), mix( vec3( 0.86, 1.05, 0.82 ), vec3( 1.12, 1.02, 0.78 ), dA.g ), grassy * 0.8 );
// streaky grass detail near the camera
alb *= 1.0 + ( dD.a - 0.5 ) * 0.25 * grassy * fine;
float slope = 1.0 - normalize( vTNrm ).y;
float rockT = smoothstep( 0.33, 0.5, slope + ( dB.r - 0.5 ) * 0.14 );
vec3 rockCol = mix( vec3( 0.16, 0.15, 0.14 ), vec3( 0.26, 0.24, 0.22 ), dB.b ) * ( 0.85 + dC.r * 0.35 );
alb = mix( alb, rockCol, rockT * 0.85 );
float wet = 1.0 - smoothstep( 0.05, 0.9, vTPos.y );
alb *= mix( 1.0, 0.62, wet );
vec4 diffuseColor = vec4( alb, opacity );`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.32, wet ) - rockT * 0.08;`
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}

// A material-only lookup derived from the existing surface classification. The
// collision surface array and every height / vertex / LOD remain untouched.
function createBiomeMask(world, hf) {
  const data = new Uint8Array(world.surface.length * 4);
  for (let i = 0; i < world.surface.length; i++) {
    const surface = world.surface[i];
    data[i * 4] = surface === SURF.ROCK || surface === SURF.ASH ? 255 : 0;
    data[i * 4 + 1] = surface === SURF.SAND ? 255 : 0;
    data[i * 4 + 2] = surface === SURF.PAVE || surface === SURF.ROAD ? 255 : 0;
    data[i * 4 + 3] = surface === SURF.DIRT || surface === SURF.DIRTROAD || surface === SURF.VERGE ? 255 : 0;
  }
  const texture = new THREE.DataTexture(data, hf.res + 1, hf.res + 1, THREE.RGBAFormat);
  texture.name = 'terrain-biome-blend';
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// All terrain chunks share one material and one set of texture uniforms. World
// projection keeps texture scale and seams independent of chunk LOD and UVs.
export function createTerrainMaterial(detailTex, world, hf) {
  const assets = getSurfaceAssets();
  if (!assets?.grass || !assets?.dirt || !assets?.rock || !world?.surface || !hf) {
    return createFallbackTerrainMaterial(detailTex);
  }
  const biomeMask = createBiomeMask(world, hf);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
  mat.name = 'Photographic terrain';
  mat.userData.surfaceMode = 'photographic-pbr';
  mat.userData.surfaceAssets = [assets.grass.id, assets.dirt.id, assets.rock.id];
  mat.addEventListener('dispose', () => biomeMask.dispose());
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tDetail: { value: detailTex },
      tBiome: { value: biomeMask },
      terrainMaskTransform: { value: new THREE.Vector2(1 / (hf.cell * (hf.res + 1)), (hf.half / hf.cell + 0.5) / (hf.res + 1)) },
      tGrassMap: { value: assets.grass.map },
      tGrassNormal: { value: assets.grass.normalMap },
      tGrassRough: { value: assets.grass.roughnessMap },
      tDirtMap: { value: assets.dirt.map },
      tDirtNormal: { value: assets.dirt.normalMap },
      tDirtRough: { value: assets.dirt.roughnessMap },
      tRockMap: { value: assets.rock.map },
      tRockNormal: { value: assets.rock.normalMap },
      tRockRough: { value: assets.rock.roughnessMap },
      tPaveMap: { value: (assets.asphalt || assets.dirt).map },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 tcolor;
varying vec4 vTColor;
varying vec3 vTPos;
varying vec3 vTNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTColor = tcolor;
vTPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
vTNrm = normalize( mat3( modelMatrix ) * normal );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tDetail;
uniform sampler2D tBiome;
uniform vec2 terrainMaskTransform;
uniform sampler2D tGrassMap;
uniform sampler2D tGrassNormal;
uniform sampler2D tGrassRough;
uniform sampler2D tDirtMap;
uniform sampler2D tDirtNormal;
uniform sampler2D tDirtRough;
uniform sampler2D tRockMap;
uniform sampler2D tRockNormal;
uniform sampler2D tRockRough;
uniform sampler2D tPaveMap;
varying vec4 vTColor;
varying vec3 vTPos;
varying vec3 vTNrm;

const vec3 terrainLuma = vec3( 0.2126, 0.7152, 0.0722 );

vec3 terrainTriplanar( sampler2D tex, vec2 uvX, vec2 uvY, vec2 uvZ, vec3 weights ) {
  return texture2D( tex, uvX ).rgb * weights.x
    + texture2D( tex, uvY ).rgb * weights.y
    + texture2D( tex, uvZ ).rgb * weights.z;
}

// Keep the authored biome palette while retaining the scan's stones, bare soil,
// lichen and local chroma. Most detail comes from luminance, avoiding a strong
// colored overlay on naturally neutral patches in the photographs.
vec3 terrainDetailColor( vec3 sampleColor, vec3 averageColor, vec3 biome ) {
  float value = dot( sampleColor, terrainLuma ) / dot( averageColor, terrainLuma );
  vec3 detail = mix( vec3( value ), sampleColor / averageColor, 0.3 );
  return biome * clamp( detail, vec3( 0.25 ), vec3( 3.1 ) );
}

vec3 terrainGroundNormal( vec3 normalSample, vec3 baseNormal, float strength ) {
  vec3 mapNormal = normalSample * 2.0 - 1.0;
  mapNormal.xy *= strength;
  vec3 tangent = normalize( vec3( max( baseNormal.y, 0.001 ), -baseNormal.x, 0.0 ) );
  vec3 bitangent = normalize( cross( baseNormal, tangent ) );
  return normalize( tangent * mapNormal.x + bitangent * mapNormal.y + baseNormal * mapNormal.z );
}

vec3 terrainRockNormal( vec2 uvX, vec2 uvY, vec2 uvZ, vec3 weights, vec3 signs, vec3 baseNormal, float strength ) {
  vec3 nx = texture2D( tRockNormal, uvX ).xyz * 2.0 - 1.0;
  vec3 ny = texture2D( tRockNormal, uvY ).xyz * 2.0 - 1.0;
  vec3 nz = texture2D( tRockNormal, uvZ ).xyz * 2.0 - 1.0;
  // Project each map's tangent relief into world space, then add it to the
  // original surface normal. Neutral maps reproduce that normal exactly.
  vec3 detailX = vec3( 0.0, nx.y, -nx.x * signs.x );
  vec3 detailY = vec3( ny.x * signs.y, 0.0, -ny.y );
  vec3 detailZ = vec3( nz.x * signs.z, nz.y, 0.0 );
  vec3 detail = detailX * weights.x + detailY * weights.y + detailZ * weights.z;
  return normalize( baseNormal + detail * strength );
}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
vec3 terrainBaseNormal = normalize( vTNrm );
float terrainDistance = length( vTPos - cameraPosition );
float terrainFine = 1.0 - smoothstep( 35.0, 155.0, terrainDistance );
vec4 terrainBiome = texture2D( tBiome, vTPos.xz * terrainMaskTransform.x + terrainMaskTransform.y );
vec4 terrainMacro = texture2D( tDetail, vTPos.xz * 0.006 );
vec4 terrainNoise = texture2D( tDetail, vTPos.xz * 0.071 );
float terrainSlope = 1.0 - max( 0.0, terrainBaseNormal.y );
float terrainPave = terrainBiome.b;
float terrainSand = terrainBiome.g;
float terrainRock = max( terrainBiome.r, smoothstep( 0.22, 0.43, terrainSlope + ( terrainNoise.r - 0.5 ) * 0.065 ) );
terrainRock *= 1.0 - max( terrainPave, terrainSand );
float terrainGrass = smoothstep( 0.12, 0.82, vTColor.a + ( terrainNoise.g - 0.5 ) * 0.24 );
terrainGrass *= 1.0 - max( terrainBiome.a, max( terrainSand, terrainPave ) );
float terrainWet = 1.0 - smoothstep( 0.05, 0.85, vTPos.y );

vec3 terrainOriginal = pow( vTColor.rgb, vec3( 2.2 ) );
float terrainValue = dot( terrainOriginal, terrainLuma );
vec3 terrainTint = mix( vec3( terrainValue ), terrainOriginal, 0.73 );
terrainTint *= 0.94 + ( terrainMacro.r - 0.5 ) * 0.19;

// Two grass scales break up repetition between near tyre-level detail and the
// hillside. All physical material maps use the same projection as their albedo.
vec2 terrainGrassUV = vTPos.xz * vec2( 1.0, -1.0 ) / 13.0;
vec2 terrainDirtUV = vTPos.xz * vec2( 1.0, -1.0 ) / mix( 2.6, 0.85, terrainSand );
vec3 terrainSigns = sign( terrainBaseNormal + vec3( 0.0001 ) );
vec3 terrainWeights = pow( abs( terrainBaseNormal ), vec3( 4.0 ) );
terrainWeights /= max( dot( terrainWeights, vec3( 1.0 ) ), 0.0001 );
vec2 terrainRockUVX = vec2( -vTPos.z * terrainSigns.x, vTPos.y ) / 6.0;
vec2 terrainRockUVY = vec2( vTPos.x * terrainSigns.y, -vTPos.z ) / 6.0;
vec2 terrainRockUVZ = vec2( vTPos.x * terrainSigns.z, vTPos.y ) / 6.0;

vec3 terrainSoilSample = texture2D( tDirtMap, terrainDirtUV ).rgb;
vec3 terrainSoilTint = mix( terrainTint, vec3( 0.15, 0.105, 0.058 ), vTColor.a * 0.52 );
vec3 terrainSoilColor = terrainDetailColor( terrainSoilSample, vec3( 0.125, 0.084, 0.05 ), terrainSoilTint );
// Beach sand keeps its pale regional color; shrink and soften the soil scan so
// it reads as grains, rather than full-size pebbles repeated over the shoreline.
terrainSoilColor = mix( terrainSoilColor, terrainTint * ( 0.82 + dot( terrainSoilSample, terrainLuma ) * 1.75 ), terrainSand * 0.6 );
vec3 terrainAlbedo = terrainSoilColor;
if ( terrainGrass > 0.005 ) {
  vec3 grassScan = texture2D( tGrassMap, terrainGrassUV ).rgb;
  vec3 grassBroad = texture2D( tGrassMap, terrainGrassUV * 0.239 + vec2( 0.37, 0.71 ) ).rgb;
  grassScan = mix( grassScan, grassBroad, smoothstep( 18.0, 180.0, terrainDistance ) * 0.6 );
  vec3 grassColor = terrainDetailColor( grassScan, vec3( 0.168, 0.120, 0.019 ), terrainTint );
  terrainAlbedo = mix( terrainAlbedo, grassColor, terrainGrass );
}
if ( terrainRock > 0.005 ) {
  vec3 rockScan = terrainTriplanar( tRockMap, terrainRockUVX, terrainRockUVY, terrainRockUVZ, terrainWeights );
  vec3 rockTint = mix( terrainTint, vec3( terrainValue * 1.02, terrainValue, terrainValue * 0.93 ), 0.65 );
  vec3 rockColor = terrainDetailColor( rockScan, vec3( 0.120, 0.061, 0.032 ), rockTint );
  terrainAlbedo = mix( terrainAlbedo, rockColor, terrainRock );
}
// Festival / town pads and runway beds are authored gray pavement, never soil.
vec3 terrainPaveColor = terrainOriginal;
if ( terrainPave > 0.005 ) {
  vec3 paveScan = texture2D( tPaveMap, vTPos.xz / 3.0 ).rgb;
  float paveDetail = clamp( dot( paveScan, terrainLuma ) / 0.105, 0.5, 1.65 );
  float paveWear = 0.95 + ( terrainMacro.b - 0.5 ) * 0.17;
  terrainPaveColor *= mix( 1.0, paveDetail, 0.68 ) * paveWear;
}
terrainAlbedo = mix( terrainAlbedo, terrainPaveColor, terrainPave );
terrainAlbedo *= mix( 1.0, 0.63, terrainWet );
vec4 diffuseColor = vec4( terrainAlbedo, opacity );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float terrainRoughness = 0.93;
if ( terrainFine > 0.001 ) {
  float dirtRoughness = texture2D( tDirtRough, terrainDirtUV ).r;
  float grassRoughness = texture2D( tGrassRough, terrainGrassUV ).r;
  terrainRoughness = clamp( mix( dirtRoughness, grassRoughness, terrainGrass ), 0.69, 0.98 );
  if ( terrainRock > 0.005 ) {
    float rockRoughness = terrainTriplanar( tRockRough, terrainRockUVX, terrainRockUVY, terrainRockUVZ, terrainWeights ).r;
    terrainRoughness = mix( terrainRoughness, clamp( rockRoughness, 0.6, 0.96 ), terrainRock );
  }
}
roughnessFactor = mix( 0.93, terrainRoughness, terrainFine );
roughnessFactor = mix( roughnessFactor, 0.91, terrainSand );
roughnessFactor = mix( roughnessFactor, 0.88, terrainPave );
roughnessFactor = mix( roughnessFactor, 0.46, terrainWet );`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if ( terrainFine > 0.001 && terrainPave < 0.995 ) {
  vec3 soilNormal = terrainGroundNormal( texture2D( tDirtNormal, terrainDirtUV ).xyz, terrainBaseNormal, 0.38 * ( 1.0 - terrainSand * 0.7 ) );
  vec3 grassNormal = terrainGroundNormal( texture2D( tGrassNormal, terrainGrassUV ).xyz, terrainBaseNormal, 0.55 );
  vec3 mappedNormal = normalize( mix( soilNormal, grassNormal, terrainGrass ) );
  if ( terrainRock > 0.005 ) {
    vec3 rockNormal = terrainRockNormal( terrainRockUVX, terrainRockUVY, terrainRockUVZ, terrainWeights, terrainSigns, terrainBaseNormal, 0.95 );
    mappedNormal = normalize( mix( mappedNormal, rockNormal, terrainRock ) );
  }
  mappedNormal = normalize( mix( terrainBaseNormal, mappedNormal, terrainFine * ( 1.0 - terrainPave ) ) );
  normal = normalize( mat3( viewMatrix ) * mappedNormal );
}`);
  };
  mat.customProgramCacheKey = () => 'terrain-pbr-v2';
  return mat;
}

// Shadow depth material that ignores LOD skirts (they would cast acne lines at chunk seams)
export function createTerrainDepthMaterial() {
  const mat = new THREE.MeshDepthMaterial();
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float skirt;\nvarying float vSkirt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkirt = skirt;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSkirt;')
      .replace('void main() {', 'void main() {\n  if ( vSkirt > 0.0 ) discard;');
  };
  mat.customProgramCacheKey = () => 'terrain-depth-v1';
  return mat;
}

export class Terrain {
  constructor(world, hf, detailTex) {
    this.hf = hf;
    this.colors = world.colors;
    this.res = hf.res;
    this.S = hf.res + 1;
    this.cell = hf.cell;
    this.half = hf.half;
    this.n = this.res / CHUNK;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = createTerrainMaterial(detailTex, world, hf);
    this.depthMaterial = createTerrainDepthMaterial();
    this.normals = this.computeNormals();
    this.chunks = [];
    this.buildQueue = [];
    for (let cz = 0; cz < this.n; cz++)
      for (let cx = 0; cx < this.n; cx++) {
        const lods = [null];
        for (let l = 1; l < STEPS.length; l++) lods.push(this.buildGeometry(cx, cz, STEPS[l]));
        const mesh = new THREE.Mesh(lods[STEPS.length - 1], this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.customDepthMaterial = this.depthMaterial;
        mesh.matrixAutoUpdate = false;
        const bb = lods[1].boundingBox;
        const chunk = { cx, cz, lods, mesh, level: STEPS.length - 1, minY: bb.min.y, maxY: bb.max.y, x0: cx * CHUNK * this.cell - this.half, z0: cz * CHUNK * this.cell - this.half, building: false };
        this.chunks.push(chunk);
        this.group.add(mesh);
      }
  }

  computeNormals() {
    const S = this.S,
      h = this.hf.data,
      c = this.cell;
    const out = new Int8Array(S * S * 3);
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        const i = z * S + x;
        const hl = h[z * S + Math.max(0, x - 1)],
          hr = h[z * S + Math.min(S - 1, x + 1)];
        const hd = h[Math.max(0, z - 1) * S + x],
          hu = h[Math.min(S - 1, z + 1) * S + x];
        let nx = hl - hr,
          ny = 2 * c,
          nz = hd - hu;
        const l = 127 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        out[i * 3] = Math.round(nx * l);
        out[i * 3 + 1] = Math.round(ny * l);
        out[i * 3 + 2] = Math.round(nz * l);
      }
    return out;
  }

  buildGeometry(cx, cz, step) {
    const S = this.S;
    const n = CHUNK / step + 1;
    const skirtCount = 4 * n;
    const vcount = n * n + skirtCount;
    const pos = new Float32Array(vcount * 3);
    const nrm = new Int8Array(vcount * 3);
    const col = new Uint8Array(vcount * 4);
    const sk = new Uint8Array(vcount);
    const gx0 = cx * CHUNK,
      gz0 = cz * CHUNK;
    const h = this.hf.data;
    let v = 0;
    const put = (gx, gz, dy) => {
      const i = gz * S + gx;
      pos[v * 3] = gx * this.cell - this.half;
      pos[v * 3 + 1] = h[i] - dy;
      pos[v * 3 + 2] = gz * this.cell - this.half;
      nrm[v * 3] = this.normals[i * 3];
      nrm[v * 3 + 1] = this.normals[i * 3 + 1];
      nrm[v * 3 + 2] = this.normals[i * 3 + 2];
      col[v * 4] = this.colors[i * 4];
      col[v * 4 + 1] = this.colors[i * 4 + 1];
      col[v * 4 + 2] = this.colors[i * 4 + 2];
      col[v * 4 + 3] = this.colors[i * 4 + 3];
      sk[v] = dy > 0 ? 1 : 0;
      v++;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(gx0 + i * step, gz0 + j * step, 0);
    const skirt = step * 1.6 + 1.5;
    const edge = [];
    // edges in order: bottom (j=0), right (i=n-1), top (j=n-1), left (i=0)
    const edges = [
      Array.from({ length: n }, (_, k) => [k, 0]),
      Array.from({ length: n }, (_, k) => [n - 1, k]),
      Array.from({ length: n }, (_, k) => [n - 1 - k, n - 1]),
      Array.from({ length: n }, (_, k) => [0, n - 1 - k]),
    ];
    for (const e of edges) {
      const start = v;
      for (const [i, j] of e) put(gx0 + i * step, gz0 + j * step, skirt);
      edge.push({ e, start });
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i,
          b = a + 1,
          c = a + n,
          d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    for (const { e, start } of edge) {
      for (let k = 0; k < e.length - 1; k++) {
        const t0 = e[k][1] * n + e[k][0],
          t1 = e[k + 1][1] * n + e[k + 1][0];
        const s0 = start + k,
          s1 = start + k + 1;
        idx.push(t0, s0, t1, t1, s0, s1);
        idx.push(t0, t1, s0, t1, s1, s0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    g.setAttribute('tcolor', new THREE.BufferAttribute(col, 4, true));
    g.setAttribute('skirt', new THREE.BufferAttribute(sk, 1));
    g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  update(cam) {
    const size = CHUNK * this.cell;
    let built = 0;
    for (const ch of this.chunks) {
      const dx = Math.max(Math.abs(cam.x - (ch.x0 + size / 2)) - size / 2, 0);
      const dz = Math.max(Math.abs(cam.z - (ch.z0 + size / 2)) - size / 2, 0);
      const dy = Math.max(cam.y - ch.maxY, ch.minY - cam.y, 0);
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      let want = 0;
      while (want < LOD_DIST.length && d > LOD_DIST[want] * (want < ch.level ? 1.08 : 0.92)) want++;
      if (want === 0 && !ch.lods[0]) {
        if (built < 3) {
          ch.lods[0] = this.buildGeometry(ch.cx, ch.cz, 1);
          built++;
        } else want = 1;
      }
      if (want !== ch.level) {
        ch.level = want;
        ch.mesh.geometry = ch.lods[want];
      }
      // free distant high-res geometry
      if (ch.lods[0] && d > LOD_DIST[0] * 2.2 && ch.level !== 0) {
        ch.lods[0].dispose();
        ch.lods[0] = null;
      }
      ch.mesh.castShadow = d < 400;
    }
  }
}
