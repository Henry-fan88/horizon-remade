// Scripted visual checks, available only in the development capture tour. These
// drive the real physics on real sand and freeze the resulting spray for review.
import { SURF } from '../world/worldgen.js';

export function installSandStudy(game, panel, controls, sandSpot) {
  const area = document.createElement('div');
  area.className = 'sand-study';
  area.style.cssText = 'margin-top:10px;gap:6px;flex-wrap:wrap;align-items:center';
  area.innerHTML = '<button data-sand-drive>Sand acceleration</button><button data-sand-slide>Sand slide</button><button data-sand-reverse>Reverse sand</button><output aria-label="Sand test result">Sand study ready</output>';
  panel.append(area);
  const result = area.querySelector('output'), updateEffects = game.effects.update;
  let frozen = false;
  game.effects.update = function (dt, light) { if (!frozen) updateEffects.call(this, dt, light); };
  const reset = () => {
    frozen = false;
    game.player.root.visible = false;
    game.player.physics.input.throttle = 0;
    game.player.physics.input.brake = 0;
    game.player.physics.input.steer = 0;
    const { grains, tracks } = game.effects.sand;
    grains.particles.forEach(p => { p.alive = false; });
    game.effects.smoke.p.forEach(p => { p.alive = false; });
    tracks.last.clear(); tracks.cursor = tracks.count = 0;
    tracks.mesh.geometry.setDrawRange(0, 0);
  };
  const run = (mode) => {
    reset();
    const v = game.player, p = v.physics, dt = 1 / 60;
    v.place(...sandSpot); game.env.setMode('noon');
    const start = { x: p.pos.x, z: p.pos.z };
    for (let i = 0; i < 100; i++) { p.input.brake = 1; p.step(1 / 120); }
    p.input.brake = 0;
    const effects = game.effects.sand, before = effects.grains.emitted;
    let maxGrains = 0, sandContacts = 0;
    if (mode === 'reverse') { p.gear = -1; p.gearTimer = 2; }
    for (let i = 0; i < 240; i++) {
      p.input.throttle = mode === 'slide' ? 0.8 : 0.65;
      p.input.steer = mode === 'slide' && i > 50 ? 0.7 : 0;
      if (mode === 'reverse') { p.gear = -1; p.gearTimer = 2; }
      p.step(1 / 120); p.step(1 / 120);
      game.effects.vehicle(v, dt);
      updateEffects.call(game.effects, dt, 1.1);
      maxGrains = Math.max(maxGrains, effects.grains.count);
      sandContacts += p.wheels.filter(w => w.contact && game.world.surfaceAt(w.point.x, w.point.z) === SURF.SAND).length;
    }
    p.input.throttle = 0; p.input.steer = 0;
    v.syncVisual(1); v.root.visible = true;
    const forward = v.root.getWorldDirection(controls.target.clone());
    const x = p.pos.x - forward.x * 9 + forward.z * 5;
    const z = p.pos.z - forward.z * 9 - forward.x * 5;
    game.camera.position.set(x, game.world.height(x, z) + 3.4, z);
    controls.target.set(p.pos.x, p.pos.y + 0.7, p.pos.z); controls.update();
    frozen = true;
    result.textContent = `${mode}: ${Math.round(Math.hypot(p.pos.x - start.x, p.pos.z - start.z))} m · ${effects.grains.emitted - before} grains emitted · ${maxGrains} peak · ${effects.tracks.count} tread segments · ${sandContacts} sand contacts`;
    console.info('[sand study]', result.textContent);
  };
  area.querySelector('[data-sand-drive]').addEventListener('click', () => run('acceleration'));
  area.querySelector('[data-sand-slide]').addEventListener('click', () => run('slide'));
  area.querySelector('[data-sand-reverse]').addEventListener('click', () => run('reverse'));
  return { reset, dispose() { reset(); game.effects.update = updateEffects; area.remove(); } };
}
