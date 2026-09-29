// Real-time reflection probe for the player car: renders one cube face per call (the game
// paces the calls) of terrain, roads, water and sky, and feeds the result to the paint.
import * as THREE from 'three';

export class ReflectionProbe {
  constructor(size = 128) {
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cam = new THREE.CubeCamera(0.5, 600, this.rt);
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
    const vis = this.hidden;
    vis.length = hide.length;
    for (let i = 0; i < hide.length; i++) {
      vis[i] = hide[i].visible;
      hide[i].visible = false;
    }
    renderer.setRenderTarget(this.rt, this.face);
    renderer.render(scene, cam.children[this.face]);
    for (let i = 0; i < hide.length; i++) hide[i].visible = vis[i];
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
