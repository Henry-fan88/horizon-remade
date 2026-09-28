import * as THREE from 'three';
import { makeRoadTexture } from './textures.js';
import { getSurfaceAssets } from './surface-assets.js';

// Lane markings follow road distance; the photographed aggregate keeps a fixed
// metre scale instead of stretching across the width of each road type.
export function makeRoadMaterial(kind) {
  const surface = getSurfaceAssets()?.[kind === 'dirt' ? 'dirt' : 'asphalt'];
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
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
        #include <uv_vertex>
        vNormalMapUv = (modelMatrix * vec4(position, 1.0)).xz / ${surface.tileSize.toFixed(2)};
        vRoughnessMapUv = vNormalMapUv;
      `);
      shader.fragmentShader = 'uniform sampler2D roadAggregate;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 aggregate = texture2D(roadAggregate, vNormalMapUv).rgb;
        float grain = dot(aggregate, vec3(0.2126, 0.7152, 0.0722));
        float painted = smoothstep(0.2, 0.55, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
        diffuseColor.rgb *= mix(clamp(grain * ${kind === 'dirt' ? '4.0' : '5.5'} + 0.55, 0.65, 1.45), 1.0, painted * 0.75);
      `);
    };
    material.customProgramCacheKey = () => `road-pbr-${kind}-1`;
  }
  return material;
}

export function makeShoulderMaterial() {
  const dirt = getSurfaceAssets()?.dirt;
  return new THREE.MeshStandardMaterial({
    color: 0x9e9686, map: dirt?.map || null,
    normalMap: dirt?.normalMap || null, normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: dirt?.roughnessMap || null, roughness: 1,
    vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1,
  });
}
