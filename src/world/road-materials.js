import * as THREE from 'three';
import { makeRoadTexture, makeDirtRoadMask } from './textures.js';
import { getSurfaceAssets } from './surface-assets.js';
import { SNOW_ROAD_LINE } from './snow-surface.js';
import { snowReliefGLSL, snowDetailTexture } from './snow-material.js';

// Lane markings follow road distance; the photographed aggregate keeps a fixed metre scale
// instead of stretching across each road type. An aerial asphalt scan adds patches, repairs
// and staining at a 30 m scale so long straights are not one uniform grey.
export function makeRoadMaterial(kind) {
  return addJunctionSurface(makeBaseRoadMaterial(kind), kind);
}

let junctionTexture;
function addJunctionSurface(material, kind) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  const key = previousKey();
  const assets = getSurfaceAssets();
  junctionTexture ||= makeRoadTexture('junction');
  material.onBeforeCompile = shader => {
    previous.call(material, shader);
    shader.uniforms.junctionAsphalt = { value: junctionTexture };
    shader.uniforms.junctionGrain = { value: assets?.asphalt?.map || junctionTexture };
    shader.uniforms.junctionMacro = { value: assets?.asphaltMacro?.map || junctionTexture };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float junctionBlend;
      varying float vJunctionBlend;
      varying vec2 vJunctionUv;
      varying vec2 vJunctionWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vJunctionBlend = junctionBlend;
        vJunctionUv = uv;
        vJunctionWorld = (modelMatrix * vec4(position, 1.0)).xz;`);
    shader.fragmentShader = `uniform sampler2D junctionAsphalt;
      uniform sampler2D junctionGrain;
      uniform sampler2D junctionMacro;
      varying float vJunctionBlend;
      varying vec2 vJunctionUv;
      varying vec2 vJunctionWorld;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec3 junctionColor = texture2D(junctionAsphalt, vJunctionWorld / 14.0).rgb;
      ${assets?.asphalt ? `float jGrain = dot(texture2D(junctionGrain, vJunctionWorld / ${assets.asphalt.tileSize.toFixed(2)}).rgb, vec3(.2126, .7152, .0722));
        junctionColor *= clamp(jGrain * 5.5 + .55, .65, 1.45);` : ''}
      ${assets?.asphaltMacro ? `float jMacro = dot(texture2D(junctionMacro, vJunctionWorld / ${assets.asphaltMacro.tileSize.toFixed(2)}).rgb, vec3(.2126, .7152, .0722));
        junctionColor *= clamp(mix(1.0, jMacro / .16, .5), .72, 1.3);` : ''}
      float junctionMix = vJunctionBlend;
      ${['road', 'street', 'highway', 'runway', 'track', 'snow'].includes(kind) ? `float edgeLine = (1.0 - smoothstep(.07, .085, min(vJunctionUv.x, 1.0 - vJunctionUv.x))) * smoothstep(.25, .65, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
        junctionMix *= 1.0 - edgeLine;` : ''}
      diffuseColor.rgb = mix(diffuseColor.rgb, junctionColor, junctionMix);
      roughnessFactor = mix(roughnessFactor, .96, vJunctionBlend);
    `);
  };
  material.customProgramCacheKey = () => `${key}-junction-v1`;
  return material;
}

function makeBaseRoadMaterial(kind) {
  const assets = getSurfaceAssets();
  if (kind === 'snow') return addMountainSnow(makeBaseRoadMaterial('road'));
  if (kind === 'mud') return makeMudRoadMaterial(assets?.dirt);
  if (kind === 'desert' && assets?.gravel) return makeGravelRoadMaterial(assets.gravel, true);
  if (kind === 'dirt' && assets?.gravel) return makeGravelRoadMaterial(assets.gravel);
  const surface = assets?.[kind === 'dirt' ? 'dirt' : 'asphalt'];
  const macro = kind === 'dirt' ? null : assets?.asphaltMacro;
  const material = new THREE.MeshStandardMaterial({
    map: makeRoadTexture(kind),
    roughness: kind === 'dirt' ? 1 : 0.96,
    metalness: 0,
    normalMap: surface?.normalMap || null,
    roughnessMap: surface?.roughnessMap || null,
    normalScale: new THREE.Vector2().setScalar(kind === 'dirt' ? 0.45 : 0.22),
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  if (surface) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.roadAggregate = { value: surface.map };
      shader.uniforms.roadMacro = { value: macro?.map || surface.map };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoadWorld;').replace('#include <uv_vertex>', `
        #include <uv_vertex>
        vRoadWorld = (modelMatrix * vec4(position, 1.0)).xz;
        vNormalMapUv = vRoadWorld / ${surface.tileSize.toFixed(2)};
        vRoughnessMapUv = vNormalMapUv;
      `);
      shader.fragmentShader = 'uniform sampler2D roadAggregate;\nuniform sampler2D roadMacro;\nvarying vec2 vRoadWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 aggregate = texture2D(roadAggregate, vNormalMapUv).rgb;
        float grain = dot(aggregate, vec3(0.2126, 0.7152, 0.0722));
        float painted = smoothstep(0.2, 0.55, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
        float roadMacroK = 1.0;
        ${macro ? `vec3 macro = texture2D(roadMacro, vRoadWorld / ${macro.tileSize.toFixed(1)}).rgb;
        roadMacroK = clamp(mix(1.0, dot(macro, vec3(0.2126, 0.7152, 0.0722)) / 0.16, 0.5), 0.72, 1.3);` : ''}
        diffuseColor.rgb *= mix(clamp(grain * ${kind === 'dirt' ? '4.0' : '5.5'} + 0.55, 0.65, 1.45) * roadMacroK, 1.0, painted * 0.75);
      `);
    };
    material.customProgramCacheKey = () => `road-pbr-${kind}-2${macro ? 'm' : ''}`;
  }
  return material;
}

function makeMudRoadMaterial(soil) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xc1a981, map: soil?.map || makeRoadTexture('dirt'),
    normalMap: soil?.normalMap || null, normalScale: new THREE.Vector2(.65, .65),
    roughness: .38, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vMudRoad;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      vMudRoad = uv;
      vMapUv = (modelMatrix * vec4(position, 1.0)).xz / 2.6;
      #ifdef USE_NORMALMAP
        vNormalMapUv = vMapUv;
      #endif`);
    shader.fragmentShader = 'varying vec2 vMudRoad;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float rut = exp(-pow((vMudRoad.x - .32) * 25.0, 2.0)) + exp(-pow((vMudRoad.x - .68) * 25.0, 2.0));
      float pooled = smoothstep(.15, .65, sin(vMudRoad.y * 3.7 + sin(vMudRoad.x * 15.0)) * sin(vMudRoad.y * 7.3 + vMudRoad.x * 7.0));
      pooled *= smoothstep(.06, .22, vMudRoad.x) * (1.0 - smoothstep(.78, .94, vMudRoad.x));
      diffuseColor.rgb *= .9 - .17 * rut;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.075, .055, .027), pooled * .8);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(.73 - rut * .3, .1, pooled);`);
  };
  material.customProgramCacheKey = () => 'wet-mud-ruts-v1';
  return material;
}

// Gravel roads: the photographed gravel as the surface, darker compacted wheel tracks with
// loose stones between them, and grass along the edges and down the middle.
function makeGravelRoadMaterial(gravel, desert = false) {
  const mask = makeDirtRoadMask();
  const material = new THREE.MeshStandardMaterial({
    color: desert ? 0xdac196 : 0xffffff,
    map: gravel.map,
    normalMap: gravel.normalMap,
    roughnessMap: gravel.roughnessMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 1,
    metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.roadMask = { value: mask };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;').replace('#include <uv_vertex>', `
      #include <uv_vertex>
      vRoadUv = uv * vec2(1.0, 0.25);
      vMapUv = (modelMatrix * vec4(position, 1.0)).xz / ${(gravel.tileSize * 1.1).toFixed(2)};
      vNormalMapUv = vMapUv;
      vRoughnessMapUv = vMapUv;
    `);
    shader.fragmentShader = 'uniform sampler2D roadMask;\nvarying vec2 vRoadUv;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        vec4 roadM = texture2D(roadMask, vRoadUv);
        diffuseColor.rgb *= roadM.r * 2.0;
        vec3 verge = vec3(0.07, 0.1, 0.035) * (0.7 + 3.0 * dot(diffuseColor.rgb, vec3(0.333)));
        diffuseColor.rgb = mix(diffuseColor.rgb, ${desert ? 'vec3(.32, .24, .14)' : 'verge'}, roadM.g * ${desert ? '.45' : '.85'});
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.92, roadM.g);
      `);
  };
  material.customProgramCacheKey = () => `road-gravel-3-${desert}`;
  return material;
}

// Loose gravel shoulders beside paved roads (fades out into the verge by vertex alpha).
export function makeShoulderMaterial(snowy = false) {
  const assets = getSurfaceAssets();
  const set = assets?.gravel || assets?.dirt;
  const material = new THREE.MeshStandardMaterial({
    color: assets?.gravel ? 0xc7bfb0 : 0x9e9686, map: set?.map || null,
    normalMap: set?.normalMap || null, normalScale: new THREE.Vector2(0.4, 0.4),
    roughnessMap: set?.roughnessMap || null, roughness: 1,
    vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1,
  });
  return snowy ? addMountainSnow(material, true) : material;
}

function addMountainSnow(material, shoulder = false) {
  const snow = getSurfaceAssets()?.snow;
  const originalCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    originalCompile.call(material, shader, renderer);
    shader.uniforms.tDetail = { value: snowDetailTexture() };
    shader.uniforms.snowScan = { value: snow?.map ?? snowDetailTexture() };
    shader.uniforms.snowNormal = { value: snow?.normalMap ?? snowDetailTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld;\nvarying vec3 vSnowNormal;\nvarying vec2 vSnowRoadUv;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vSnowWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        vSnowNormal = normalize( mat3( modelMatrix ) * normal );
        vSnowRoadUv = uv;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tDetail; uniform sampler2D snowScan; uniform sampler2D snowNormal;
        varying vec3 vSnowWorld; varying vec3 vSnowNormal; varying vec2 vSnowRoadUv;
        ${snowReliefGLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float snowCover = smoothstep( ${SNOW_ROAD_LINE.start.toFixed(1)}, ${SNOW_ROAD_LINE.end.toFixed(1)}, vSnowWorld.y );
        vec4 snowR = snowRelief( vSnowWorld.xz, length( vSnowWorld - cameraPosition ) );
        float packedRut = ${shoulder ? '0.0' : `exp( -pow( ( vSnowRoadUv.x - 0.156 ) * 30.0, 2.0 ) ) + exp( -pow( ( vSnowRoadUv.x - 0.344 ) * 30.0, 2.0 ) )
          + exp( -pow( ( vSnowRoadUv.x - 0.656 ) * 30.0, 2.0 ) ) + exp( -pow( ( vSnowRoadUv.x - 0.844 ) * 30.0, 2.0 ) )`};
        float snowGrain = dot( texture2D( snowScan, vSnowWorld.xz / 3.0 ).rgb, vec3( 0.333 ) );
        vec3 snowColor = mix( vec3( 0.84, 0.88, 0.93 ), vec3( 0.52, 0.59, 0.67 ), packedRut * 0.72 );
        snowColor *= snowR.z * clamp( 1.0 + ( snowGrain - 0.4 ) * 0.4, 0.85, 1.12 );
        diffuseColor.rgb = mix( diffuseColor.rgb, snowColor, snowCover );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, snowR.w - packedRut * 0.1, snowCover );`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 snowN = texture2D( snowNormal, vSnowWorld.xz / 3.0 ).rg * 2.0 - 1.0;
        vec3 snowMapped = normalize( vSnowNormal + vec3( snowN.x * 0.12 - snowR.x, 0.0, -snowN.y * 0.12 - snowR.y ) );
        normal = normalize( mix( normal, mat3( viewMatrix ) * snowMapped, snowCover ) );`);
  };
  material.customProgramCacheKey = () => `mountain-snow-v1-${shoulder}`;
  return material;
}
