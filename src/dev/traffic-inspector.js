// Development-only inspection of the actual road traffic system; no save writes.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function inspectTraffic(game) {
  game.menus.close(); game.hud.show(false); game.net.disconnect();
  game.state = 'environment-inspection'; game.paused = true; game.env.setMode('noon');
  game.vehicles.forEach(v => { v.root.visible = false; });
  const road = game.world.network.roads.find(r => r.name === 'Granja Road');
  const start = road.length * .45, origin = road.pointAt(start, {});
  game.player.place(origin.x, origin.z, Math.atan2(origin.tx, origin.tz));
  // Place one of each body style in the road lanes for a repeatable visual inspection.
  for (const [i, car] of game.traffic.cars.entries()) {
    car.alive = i < 8;
    if (!car.alive) continue;
    car.road = road; car.s = start + 20 + i * 13; car.dir = i % 2 ? 1 : -1;
    car.lane = road.width * .25; car.mode = 'kin'; car.speed = car.target = 12;
    game.traffic.place(car, 0);
  }
  const controls = new OrbitControls(game.camera, game.renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - .015;
  const pt = road.pointAt(start + 36, {}), h = game.world.height(pt.x, pt.z);
  controls.target.set(pt.x, h + 1, pt.z);
  game.camera.position.set(pt.x - pt.tx * 19 - pt.tz * 9, h + 5, pt.z - pt.tz * 19 + pt.tx * 9);
  game.camera.fov = 55; game.camera.updateProjectionMatrix(); controls.update();
  game.inspectionFocus = controls.target;
  const panel = document.createElement('aside');
  panel.innerHTML = `<style>#traffic-inspector{position:fixed;z-index:150;left:24px;top:24px;padding:18px;background:#17201eee;color:#eef1ef;border:1px solid #ffffff30;border-radius:10px;font:14px system-ui}#traffic-inspector strong{font-weight:550}#traffic-inspector p{font-size:12px;color:#b2c3bd}#traffic-inspector button{background:#31443d;color:#fff;border:1px solid #ffffff40;border-radius:5px;padding:8px;margin-right:8px;cursor:pointer}body:has(#traffic-inspector) #ui{visibility:hidden}</style><strong>CIVILIAN ROAD TRAFFIC</strong><p>Eight everyday vehicle types · actual road placement and renderer</p><button data-motion>Run traffic</button><button data-drive>Drive here</button><p><output>Inspecting parked traffic</output></p>`;
  panel.id = 'traffic-inspector'; document.body.append(panel);
  panel.addEventListener('keydown', e => e.stopPropagation()); panel.addEventListener('pointerdown', e => e.stopPropagation());
  let active = true, moving = false, last = performance.now();
  panel.querySelector('[data-motion]').onclick = e => { moving = !moving; e.target.textContent = moving ? 'Pause traffic' : 'Run traffic'; };
  panel.querySelector('[data-drive]').onclick = () => {
    active = false; controls.dispose(); panel.remove(); game.inspectionFocus = null;
    game.vehicles.forEach(v => { v.root.visible = true; }); game.gameCam.snap();
    game.state = 'freeroam'; game.paused = false; game.hud.show(true); game.env.setMode(game.settings.timeOfDay);
  };
  function frame(now) {
    if (!active) return;
    controls.update(); game.camera.updateMatrixWorld();
    if (moving) game.traffic.update(Math.min((now-last)/1000,.05), game.player);
    else game.traffic.writeInstances();
    last = now;
    const alive = game.traffic.cars.filter(c => c.alive);
    panel.querySelector('output').textContent = `${alive.length} vehicles · ${new Set(alive.map(c=>c.spec.id)).size} civilian body styles · ${moving?'Moving in road lanes':'Paused for inspection'}`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
