// Development-only scene tour. It uses the real world, materials and renderer;
// no separate showcase scene or changes to saved progression/vehicle tuning.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getSurfaceAssets } from '../world/surface-assets.js';
import { districtDestinations, CITY } from '../world/districts.js';

export function inspectEnvironment(game) {
  game.menus.close(); game.hud.show(false);
  game.state = 'environment-inspection'; game.paused = true;
  game.env.setMode('noon');
  game.net.disconnect();
  game.vehicles.forEach(v => { v.root.visible = false; });
  const controls = new OrbitControls(game.camera, game.renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 2; controls.maxDistance = 800;
  controls.maxPolarAngle = Math.PI * 0.49;
  game.inspectionFocus = controls.target;
  const panel = document.createElement('aside');
  panel.id = 'environment-inspector';
  panel.innerHTML = `<style>
    body:has(#environment-inspector) #ui{visibility:hidden}
    #environment-inspector{position:fixed;z-index:150;left:24px;top:24px;color:#eef1ef;background:#17201eee;backdrop-filter:blur(12px);border:1px solid #ffffff24;border-radius:12px;padding:16px 18px;font:13px/1.4 Barlow,system-ui;max-width:calc(100vw - 48px);box-shadow:0 12px 45px #0003}
    #environment-inspector strong{font-size:18px;font-weight:600;display:block;letter-spacing:.04em}
    #environment-inspector.compact nav,#environment-inspector.compact footer,#environment-inspector.compact strong,#environment-inspector.compact p{display:none}
    #environment-inspector.compact{padding:7px}
    #environment-inspector [data-toggle]{float:right;margin-left:14px}
    #environment-inspector p{margin:5px 0 12px;color:#bac7c2}
    #environment-inspector nav{display:flex;gap:6px;flex-wrap:wrap}
    #environment-inspector button,#environment-inspector select{font:inherit;color:inherit;border:1px solid #ffffff38;border-radius:5px;background:#ffffff08;padding:7px 11px;cursor:pointer}
    #environment-inspector button[aria-pressed=true]{background:#d8e4dc;color:#17201e}
    #environment-inspector footer{display:flex;gap:14px;align-items:center;margin-top:12px}
    #environment-inspector output{font-size:11px;color:#a7b9af}
  </style><button type="button" data-toggle aria-label="Toggle scene controls">Hide controls</button><strong>ISLA / ENVIRONMENT STUDY</strong><p>Drag to orbit · scroll to explore</p>
  <nav aria-label="Scene views"></nav><footer><select aria-label="Time of day"><option value="noon">Daylight</option><option value="golden">Golden hour</option><option value="night">Night</option></select><button type="button" data-drive>Drive here</button><output aria-label="Scene status">Loading materials</output></footer>`;
  document.body.append(panel);
  panel.querySelector('[data-toggle]').addEventListener('click',e=>{const compact=panel.classList.toggle('compact');e.target.textContent=compact?'Show controls':'Hide controls';});
  // Keep inspector keystrokes out of the driving/menu input handlers.
  panel.addEventListener('keydown', e => e.stopPropagation());
  panel.addEventListener('pointerdown', e => e.stopPropagation());
  const h = (x, z) => game.world.height(x, z);
  function roadView(name, fraction, side = 14, height = 6) {
    const road = game.world.network.roads.find(r => r.name === name);
    const i = Math.floor((road.n - 1) * fraction);
    const x = road.pts[i * 3], z = road.pts[i * 3 + 2];
    const tx = road.tan[i * 2], tz = road.tan[i * 2 + 1];
    return { target: [x + tx * 18, h(x, z) + 1.5, z + tz * 18], camera: [x - tz * side - tx * 20, h(x, z) + height, z + tx * side - tz * 20], drive: [x, z, Math.atan2(tx, tz)] };
  }
  const views = {
    Festival: { target: [280, h(250, 1110) + 10, 1066], camera: [289, h(289, 1166) + 11, 1166], drive: [250, 1160, Math.PI] },
    Town: roadView('Market Street',.46,0,3.2),
    Countryside: roadView('Granja Road', 0.45, 9, 3.5),
    Coast: roadView('Costa Ring', 0.22, -18, 7),
    Highlands: roadView('Volcán Spiral', 0.5, 18, 6),
    Autódromo: roadView('Autódromo Horizonte', 0.02, 14, 6),
    'Paso Nevado': roadView('Paso Nevado', 0.62, 18, 8),
    'Cañón Rojo': roadView('Cañón Rojo Rally', 0.12, 12, 5),
  };
  const districtViews = { city: 'City', forest: 'Forest', desert: 'Desert', rural: 'Rural', snow: 'Snow', mud: 'Mud' };
  for (const d of districtDestinations(game.world.network)) {
    views[districtViews[d.id]] = roadView(d.road, d.fraction, d.id === 'forest' ? 0 : 12, d.id === 'forest' ? 3.5 : 7);
  }
  const citySpawn=roadView('Market Street',.46,0,3.2);
  views.City = { target: [1110, h(1110,170)+55, 170], camera: [550,210,690], drive: citySpawn.drive };
  views['City streets'] = citySpawn;
  views['Painted Ladies'] = roadView('Steiner Street',.28,-2,3.5);
  views.Chinatown = roadView('Grant Avenue',.42,0,2.7);
  views.Lombard = roadView('Lombard Street',.17,0,5);
  views.Waterfront = roadView('Embarcadero',.4,-3,5);
  views['Ferry Building'] = {target:[1554,h(1554,143)+14,143],camera:[1490,h(1490,195)+18,195],drive:views.Waterfront.drive};
  const bridge=game.world.network.roads.find(r=>r.name==='Puente Este');
  const mid=bridge.pointAt(bridge.length*.5,{});
  views['Bay bridge'] = { target:[mid.x,mid.y+32,mid.z],camera:[mid.x+mid.tz*250-mid.tx*120,mid.y+104,mid.z-mid.tx*250-mid.tz*120],drive:[mid.x,mid.z,Math.atan2(mid.tx,mid.tz)] };
  const farm = game.props.farmLocations[0];
  if (farm) views.Rural = { ...views.Rural, target: [farm.x, h(farm.x, farm.z) + 5, farm.z], camera: [farm.x - 70, h(farm.x - 70, farm.z + 95) + 23, farm.z + 95] };
  // Look out over the shoreline, rather than back inland along the ring road.
  const coast = roadView('Costa Ring', 0.04);
  const [cx, cz, heading] = coast.drive;
  const radialLength = Math.hypot(cx, cz), ox = cx / radialLength, oz = cz / radialLength;
  views.Coast = {
    drive: coast.drive,
    camera: [cx - ox * 12 - Math.sin(heading) * 24, h(cx, cz) + 11, cz - oz * 12 - Math.cos(heading) * 24],
    target: [cx + ox * 160, 1.5, cz + oz * 160],
  };
  let selected, active = true;
  function show(name) {
    selected = views[name];
    game.player.place(...selected.drive);
    game.camera.position.fromArray(selected.camera);
    controls.target.fromArray(selected.target); controls.update();
    game.camera.fov = 55; game.camera.updateProjectionMatrix();
    for (const button of panel.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === name));
    const url = new URL(location.href); url.searchParams.set('view', name); history.replaceState(null, '', url);
  }
  for (const name of Object.keys(views)) {
    const button = document.createElement('button'); button.textContent = name;
    button.dataset.view = name; button.addEventListener('click', () => show(name));
    panel.querySelector('nav').append(button);
  }
  panel.querySelector('select').addEventListener('change', e => game.env.setMode(e.target.value));
  panel.querySelector('[data-drive]').addEventListener('click', () => {
    active = false; controls.dispose(); panel.remove();
    game.inspectionFocus = null;
    game.vehicles.forEach(v => { v.root.visible = true; });
    game.player.place(...selected.drive); game.gameCam.snap();
    game.state = 'freeroam'; game.paused = false; game.hud.show(true);
    game.env.setMode(game.settings.timeOfDay);
  });
  let lastStatus = 0;
  function frame(now) {
    if (!active) return;
    controls.update();
    if (now - lastStatus > 1000) {
      const surfaces = getSurfaceAssets();
      panel.querySelector('output').textContent = `${Object.values(surfaces || {}).filter(Boolean).length} PBR sets · ${game.props.cityBuildings.length} buildings · ${game.props.cityShops} shops · ${game.cityLife.walkers.length} pedestrians · ${game.cityLife.parked.length} parked cars · ${Math.round(game.fps)} FPS`;
      lastStatus = now;
    }
    requestAnimationFrame(frame);
  }
  const requestedView = new URLSearchParams(location.search).get('view');
  show(views[requestedView] ? requestedView : 'Festival'); requestAnimationFrame(frame);
}
