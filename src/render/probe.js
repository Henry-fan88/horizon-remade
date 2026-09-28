// Real-time reflection probe for the player car: renders one cube face per frame
// (terrain, roads, water, sky only) and feeds the result to the car's paint.
import * as THREE from 'three';

export class ReflectionProbe {
  constructor(size = 128) {
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cam = new THREE.CubeCamera(0.5, 1200, this.rt);
    this.face = 0;
    this.ready = false;
    this.texture = this.rt.texture;
    this.enabled = true;
    this.hidden = [];
  }

  update(renderer, scene, pos, hide) {
    if (!this.enabled) return;
    const cam = this.cam;
    if (cam.coordinateSystem !== renderer.coordinateSystem) {
      cam.coordinateSystem = renderer.coordinateSystem;
      cam.updateCoordinateSystem();
    }
    if (this.face === 0) {
      cam.position.set(pos.x, pos.y + 1.0, pos.z);
      cam.updateMatrixWorld(true);
    }
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    renderer.setRenderTarget(this.rt, this.face);
    renderer.render(scene, cam.children[this.face]);
    hide.forEach((o, i) => (o.visible = vis[i]));
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    renderer.shadowMap.autoUpdate = prevAuto;
    this.face++;
    if (this.face >= 6) {
      this.face = 0;
      this.rt.texture.needsPMREMUpdate = true;
      this.ready = true;
    }
  }
}
