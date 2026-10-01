// Development capture checks run the actual snow contacts and physics, then
// pause the resulting powder/track snapshot. Driving settings are restored.
import * as THREE from 'three';
import { SURF } from '../world/worldgen.js';

export function installSnowStudy(game, panel, controls, snowSpot) {
  const area = document.createElement('div');
  area.className = 'snow-study';
  area.style.cssText = 'display:flex;margin-top:10px;gap:6px;flex-wrap:wrap;align-items:center';
  area.innerHTML = '<button data-snow-drive>Snow launch</button><button data-snow-slide>Snow slide</button><button data-snow-brake>Snow braking</button><output aria-label="Snow test result">Snow study ready</output>';
  panel.append(area);
  const result = area.querySelector('output'), updateEffects = game.effects.update;
  const trafficVisible = game.traffic.group.visible;
  let frozen = false;
  game.effects.update = function(dt, light) { if (!frozen) updateEffects.call(this, dt, light); };
  function reset() {
    frozen = false; game.player.root.visible = false;
    game.traffic.group.visible = trafficVisible;
    Object.assign(game.player.physics.input, { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
    const effects = game.effects.snow;
    effects.chunks.particles.forEach(p => { p.alive = false; });
    effects.chunks.count = effects.chunks.mesh.geometry.instanceCount = 0;
    game.effects.smoke.p.forEach(p => { p.alive = false; });
    effects.tracks.last.clear(); effects.tracks.cursor = effects.tracks.count = 0;
    effects.tracks.mesh.geometry.setDrawRange(0, 0);
  }
  function run(mode) {
    reset();
    const v = game.player, p = v.physics, effects = game.effects.snow;
    const originalAuto = p.autoGear;
    v.place(...snowSpot); game.env.setMode('noon');
    game.traffic.group.visible = false;
    p.autoGear = false;
    for (let i = 0; i < 180; i++) { p.input.brake = 1; p.step(1 / 120); }
    p.input.brake = 0; p.gear = 1; p.autoGear = originalAuto;
    const start = p.pos.clone(), before = effects.chunks.emitted;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
    if (mode === 'braking' || mode === 'slide') {
      const speed = mode === 'braking' ? 50 / 3.6 : 12;
      p.vel.copy(forward).multiplyScalar(speed);
      for (const w of p.wheels) w.omega = speed / w.r;
      p.gear = 3;
    }
    let contacts = 0, peakChunks = 0, peakSlip = 0, seconds = 0;
    for (let i = 0; i < (mode === 'braking' ? 480 : mode === 'slide' ? 144 : 240); i++) {
      p.input.throttle = mode === 'braking' ? 0 : mode === 'slide' ? 0.5 : 0.75;
      p.input.brake = mode === 'braking' ? 1 : 0;
      p.input.steer = mode === 'slide' && i > 45 ? 0.35 : 0;
      p.step(1 / 120); p.step(1 / 120); seconds += 1 / 60;
      game.effects.vehicle(v, 1 / 60); updateEffects.call(game.effects, 1 / 60, 1.1);
      contacts += p.wheels.filter(w => w.contact && w.surface === SURF.SNOW).length;
      peakChunks = Math.max(peakChunks, effects.chunks.count);
      peakSlip = Math.max(peakSlip, Math.abs(p.slipAngleBody));
      if (mode === 'braking' && p.vel.length() < 0.5) break;
    }
    Object.assign(p.input, { throttle: 0, brake: 0, steer: 0 });
    v.syncVisual(1); v.root.visible = true;
    forward.set(0, 0, 1).applyQuaternion(p.quat);
    const x = p.pos.x - forward.x * 8 + forward.z * 5;
    const z = p.pos.z - forward.z * 8 - forward.x * 5;
    game.camera.position.set(x, game.world.height(x, z) + 2.8, z);
    controls.target.set(p.pos.x, p.pos.y + 0.65, p.pos.z); controls.update();
    frozen = true;
    result.textContent = `${mode}: ${Math.round(Math.hypot(p.pos.x - start.x, p.pos.z - start.z))} m · ${seconds.toFixed(1)} s · ${(peakSlip * 180 / Math.PI).toFixed(1)}° peak slip · ${effects.chunks.emitted - before} chunks · ${peakChunks} peak · ${effects.tracks.count} tread segments · ${contacts} snow contacts`;
    console.info('[snow study]', result.textContent);
  }
  area.querySelector('[data-snow-drive]').addEventListener('click', () => run('launch'));
  area.querySelector('[data-snow-slide]').addEventListener('click', () => run('slide'));
  area.querySelector('[data-snow-brake]').addEventListener('click', () => run('braking'));
  return { reset, dispose() { reset(); game.effects.update = updateEffects; area.remove(); } };
}
