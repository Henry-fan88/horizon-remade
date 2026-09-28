// Main game orchestrator: renderer, world, player, systems, state machine and loop.
import * as THREE from 'three';
import { installAtmosphere, Environment } from '../world/sky.js';
import { World, generateInWorker } from '../world/world.js';
import { PostFX } from '../render/postfx.js';
import { setMaxAnisotropy } from '../world/textures.js';
import { preloadSurfaceAssets } from '../world/surface-assets.js';
import { CollisionWorld, resolveVehiclePair } from '../world/colliders.js';
import { Props } from '../world/props.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { CAR_BY_ID } from '../vehicle/carspecs.js';
import { buildCar } from '../vehicle/carmodel.js';
import { preloadRealCar } from '../vehicle/realcar.js';
import { Effects } from '../vehicle/effects.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { Radio } from '../core/music.js';
import { GameCamera } from './camera.js';
import { SkillSystem } from './skills.js';
import { buildEvents, makeEventMarker, EVENT_COLORS } from './events.js';
import { RaceManager } from './race.js';
import { StuntSystem } from './stunts.js';
import { TrafficSystem } from './traffic.js';
import { RoadGraph, distToPolyline } from './gps.js';
import { Save, Progression } from './progression.js';
import { Rewind } from './rewind.js';
import { HUD } from '../ui/hud.js';
import { renderMapImages } from '../ui/mapimage.js';
import { Menus } from '../ui/menus.js';
import { WorldMap } from '../ui/worldmap.js';
import { TouchControls } from '../ui/touch.js';
import { NetClient } from '../net/net.js';
import { ReflectionProbe } from '../render/probe.js';
import { PHYSICS_HZ, DEFAULT_SETTINGS } from '../config.js';
import { clamp, formatNumber } from '../core/math.js';
import { LOCATIONS } from '../world/worldgen.js';

const STEP = 1 / PHYSICS_HZ;

export const QUALITY = {
  low: { pixelRatio: 0.75, msaa: 0, shadow: 1024, veg: 0.5, bloom: false, grass: 0 },
  medium: { pixelRatio: 1, msaa: 2, shadow: 2048, veg: 0.75, bloom: true, grass: 0.4 },
  high: { pixelRatio: 1.25, msaa: 4, shadow: 4096, veg: 1, bloom: true, grass: 0.75 },
  ultra: { pixelRatio: 2, msaa: 4, shadow: 4096, veg: 1.2, bloom: true, grass: 1 },
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function resolveVehiclePairSafe(a, b) {
  if (a.frozen || b.frozen) return 0;
  return resolveVehiclePair(a, b, false);
}

export class Game {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.save = new Save();
    this.settings = { ...DEFAULT_SETTINGS, aiSkill: 0.93, ...this.save.data.settings };
    this.save.data.settings = this.settings;
    this.state = 'loading';
    this.time = 0;
    this.accumulator = 0;
    this.vehicles = [];
    this.frame = 0;
    this.fps = 60;
    this.paused = false;
    this.fade = 0;
    this.fadeTarget = 0;
    this.gpsRoute = null;
    this.gpsTarget = null;
    this.drafting = false;
  }

  async start(onProgress) {
    installAtmosphere();
    const canvas = document.getElementById('game-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true, stencil: false });
    this.renderer = renderer;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      const msg = document.createElement('div');
      msg.className = 'screen dialog-screen in';
      msg.style.zIndex = 200;
      msg.innerHTML = '<div class="dialog"><div class="dialog-title">Graphics reset</div><p>The browser reset the graphics device (this can happen when the GPU runs out of memory). Your progress is saved.</p><div class="dialog-actions"><button class="btn primary" onclick="location.reload()">RELOAD</button></div></div>';
      document.getElementById('ui').appendChild(msg);
      this.save?.write(true);
    });
    addEventListener('beforeunload', () => this.save?.write(true));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 16000);
    this.env = new Environment(renderer, this.scene);
    this.post = new PostFX(renderer, { msaa: 4 });
    this.applyQuality(this.settings.quality, true);
    addEventListener('resize', () => this.resize());

    this.input = new Input();
    this.world = new World(this.scene);
    // Load local car geometry in parallel with world generation. All car builders
    // stay synchronous, including garage thumbnails and networked vehicles.
    const carAssetsReady = preloadRealCar();
    const surfaceAssetsReady = preloadSurfaceAssets(renderer.capabilities.getMaxAnisotropy());
    const data = await generateInWorker(0, (p, m) => onProgress?.(p * 0.85, m));
    onProgress?.(0.88, 'Building the world');
    await nextFrame();
    await surfaceAssetsReady;
    this.world.build(data);
    this.world.vegetation.quality = QUALITY[this.qualityName()]?.veg ?? 1;
    this.world.grass.setDensity(QUALITY[this.qualityName()]?.grass ?? 0.75);
    this.collision = new CollisionWorld();
    for (const c of this.world.vegetation.colliders) this.collision.addCircle(c.x, c.z, c.r, c.y0, c.y1, c.kind);
    this.world.vegetation.registerSmashables(this.collision);
    onProgress?.(0.91, 'Setting up the festival');
    await nextFrame();
    this.props = new Props(this, data);
    this.boards = this.props.boards;
    this.boardsTotal = this.props.boardsTotal;
    this.festivalPos = { x: LOCATIONS.festival.x, z: LOCATIONS.festival.z };
    this.viewpoint = LOCATIONS.viewpoint;

    // UI + systems
    this.mapImages = renderMapImages(this.world, 1024);
    this.ui = document.getElementById('ui');
    this.hud = new HUD(this.ui, this.mapImages);
    this.gameCam = new GameCamera(this.camera);
    this.gameCam.mode = Number(this.settings.camera) || 0;
    this.effects = new Effects(this.scene);
    this.audio = new AudioEngine();
    this.radio = new Radio(this.audio);
    this.radio.onTrack = (title, artist) => this.hud.toast('HORIZON PULSE', `Now playing: ${artist} — ${title}`, 'purple', 4500);
    this.progression = new Progression(this, this.save);
    this.skills = new SkillSystem(this);
    this.skills.onBank = (value, mult) => {
      this.hud.chainResult(`SKILL CHAIN x${mult}`, value, true);
      this.audio.ui('bank');
      this.save.data.stats.skillPts += value;
      this.progression.addXP(value / 5);
      this.progression.addCredits(Math.round(value / 10));
    };
    this.skills.onBreak = (reason, lost) => {
      this.hud.chainResult(reason, lost > 0 ? -lost : null, false);
      this.audio.ui('fail');
    };
    this.skills.onSkill = () => this.audio.ui('skill');
    this.collision.onSmash = (o, phys, speed) => this.onSmash(o, phys, speed);
    onProgress?.(0.93, 'Detailing the cars');
    await carAssetsReady;
    onProgress?.(0.94, 'Placing events');
    await nextFrame();
    this.events = buildEvents(this.world);
    this.race = new RaceManager(this);
    this.stunts = new StuntSystem(this, this.events.stunts);
    this.buildEventMarkers();
    this.graph = new RoadGraph(this.world.network);
    this.traffic = new TrafficSystem(this, 28);
    this.rewind = new Rewind(this);
    this.menus = new Menus(this);
    this.worldMap = new WorldMap(this, this.mapImages);
    this.touch = new TouchControls(this);
    if (this.touch.enabled) document.body.classList.add('touch-mode');
    this.net = new NetClient(this);
    this.probe = new ReflectionProbe(128);
    this.onStuntFinished = (st, value, stars) => {
      this.progression.addXP(250 + stars * 900);
      if (stars) this.progression.addCredits(stars * 2000);
    };

    const cur = this.save.currentCar;
    const forced = this.params.get('car');
    this.player = this.spawnPlayer(forced && CAR_BY_ID[forced] ? { id: forced, paint: {} } : cur);
    this.buildHeroCar();
    this.applySettings();
    this.resize();
    onProgress?.(0.97, 'Warming up engines');
    this.env.update(0.016, this.player.root.position);
    this.gameCam.orbit(0.016, this.player.root.position, 7, 1.4, 0.1, this.world);
    this.world.update(0, this.camera, this.env);
    const tc = performance.now();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    console.info(`[horizon] shaders ready in ${Math.round(performance.now() - tc)} ms`);
    await nextFrame();

    // audio unlocks on the first gesture
    const unlock = () => {
      this.audio.init();
      this.audio.setVolumes({ master: this.settings.masterVolume, engine: this.settings.engineVolume, music: this.settings.musicVolume, sfx: this.settings.sfxVolume });
      if (!this.audio.engines.has('player')) this.audio.createEngine('player', this.player.spec.sound);
      if (this.settings.radio && !this.radio.playing && this.state !== 'title' && this.state !== 'loading') this.radio.start();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);

    if (this.settings.online) this.net.connect();
    if (this.params.has('play')) this.enterFreeRoam();
    else this.showTitle();
    this.last = performance.now();
    renderer.setAnimationLoop(() => this.loop());
    window.__game = this;
  }

  // ---------------------------------------------------------------- setup helpers
  spawnPlayer(entry) {
    const spec = CAR_BY_ID[entry.id] || CAR_BY_ID.gt;
    const v = new Vehicle(spec, this.world, { color: spec.color, ...(entry.paint || {}) }, { isPlayer: true, headlights: true });
    this.scene.add(v.root);
    const P = this.props.festivalParking;
    v.place(P.x, P.z, Math.PI * 0.85);
    this.vehicles.push(v);
    this.configurePlayerPhysics(v);
    return v;
  }

  configurePlayerPhysics(v) {
    v.physics.steerAssist = !!this.settings.steeringAssist;
    v.physics.tractionControl = !!this.settings.tractionControl;
    v.physics.autoGear = this.settings.transmission !== 'manual';
  }

  buildHeroCar() {
    const T = this.props.turntable;
    const spec = CAR_BY_ID.gt;
    const car = buildCar(spec.style, { color: spec.color, finish: 'gloss' });
    car.group.position.set(T.x, T.y, T.z);
    this.scene.add(car.group);
    this.heroCar = car;
  }

  buildEventMarkers() {
    this.markers = [];
    for (const r of this.events.races) {
      const m = makeEventMarker(r.type, EVENT_COLORS[r.type] || '#ff2d87');
      m.position.set(r.marker.x, this.world.height(r.marker.x, r.marker.z), r.marker.z);
      this.scene.add(m);
      this.markers.push({ obj: m, def: r });
    }
    this.mapMarkers = [
      ...this.events.races.map((r) => ({ x: r.marker.x, z: r.marker.z, type: r.type === 'dirt' ? 'dirt' : r.type === 'drag' ? 'drag' : 'race' })),
      ...this.events.stunts.map((s) => ({ x: s.x, z: s.z, type: s.type })),
      { x: LOCATIONS.festival.x, z: LOCATIONS.festival.z, type: 'festival', pin: true, big: true },
    ];
  }

  // pick a sensible preset from the GPU / device when set to auto
  detectQuality() {
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      this.gpuName = gpu;
      const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
      if (mobile) return 'low';
      if (/Apple M[2-9]|Apple GPU|RTX|RX [67-9]\d{3}|Radeon Pro|Arc A7/i.test(gpu)) return 'high';
      if (/Intel|UHD|Iris|Mali|Adreno|PowerVR|Vega [0-9] |SwiftShader|llvmpipe/i.test(gpu)) return /SwiftShader|llvmpipe/i.test(gpu) ? 'low' : 'medium';
      return 'high';
    } catch {
      return 'medium';
    }
  }

  qualityName() {
    return this.settings.quality === 'auto' ? this.autoQuality || (this.autoQuality = this.detectQuality()) : this.settings.quality;
  }

  applyQuality(q, first = false) {
    if (q === 'auto') q = this.qualityName();
    const Q = QUALITY[q] || QUALITY.high;
    this.renderScale = 1;
    this.quality = Q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.env.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (this.env.sun.shadow.map) {
      this.env.sun.shadow.map.dispose();
      this.env.sun.shadow.map = null;
    }
    this.post.bloomEnabled = Q.bloom;
    this.post.setQuality({ msaa: Q.msaa, scale: 1 });
    if (!first && this.world?.vegetation) {
      this.world.vegetation.quality = Q.veg;
      this.world.vegetation.update(this.camera.position, true);
    }
    if (this.world?.grass) this.world.grass.setDensity(Q.grass);
  }

  applySettings(key = null) {
    const s = this.settings;
    const all = key === null;
    if (all || key === 'quality') this.applyQuality(s.quality, all);
    if (all || key === 'timeOfDay') this.env.setMode(s.timeOfDay === 'dynamic' ? 'dynamic' : s.timeOfDay);
    if (all || key === 'dayLength') this.env.dayMinutes = Math.max(4, Number(s.dayLength) || 40);
    if ((all || ['steeringAssist', 'tractionControl', 'transmission'].includes(key)) && this.player) this.configurePlayerPhysics(this.player);
    if (all || key === 'camera') {
      this.gameCam.mode = Number(s.camera) || 0;
      this.gameCam.snap();
    }
    if (all || /Volume/.test(key || '')) this.audio.setVolumes({ master: s.masterVolume, engine: s.engineVolume, music: s.musicVolume, sfx: s.sfxVolume });
    if (key === 'radio') {
      if (s.radio && !this.radio.playing) this.radio.start();
      if (!s.radio && this.radio.playing) this.radio.stop();
    }
    if (key === 'drivingLine' && this.race.active) this.race.active.line.visible = s.drivingLine !== 'off';
    if (key === 'units') for (const st of this.events.stunts) this.stunts.refreshSign(st);
    this.save.data.settings = s;
    this.save.write();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(s.x, s.y);
  }

  // ---------------------------------------------------------------- state flow
  showTitle() {
    this.state = 'title';
    this.hud.show(false);
    this.touch.show(false);
    this.menus.showTitle(() => this.startFromTitle());
    this.updateTitleStatus();
  }

  updateTitleStatus() {
    const el = this.menus.titleEl?.querySelector('.net-status');
    if (el) el.textContent = this.net.state === 'connected' ? `● ONLINE · ${this.net.players.size + 1} in session` : this.net.state === 'connecting' ? 'Connecting…' : '● OFFLINE · solo';
  }

  startFromTitle() {
    if (this.state !== 'title') return;
    this.state = 'naming';
    this.audio.init();
    this.audio.ui('select');
    if (!this.save.data.name) {
      const def = 'Driver' + Math.floor(1000 + Math.random() * 9000);
      this.menus.askName(def, (name) => {
        this.save.data.name = name;
        this.save.write(true);
        if (this.net.state === 'connected') this.net.rename(name);
        else if (this.settings.online) this.net.connect();
        this.enterFreeRoam(true);
      });
    } else this.enterFreeRoam();
  }

  enterFreeRoam(firstTime = false) {
    this.menus.close();
    this.state = 'freeroam';
    this.paused = false;
    this.hud.show(true);
    this.touch.show(true);
    this.gameCam.snap();
    if (this.settings.radio && this.audio.ready && !this.radio.playing) this.radio.start();
    const d = this.save.data;
    this.hud.bigMessage('WELCOME TO THE FESTIVAL', `${d.name || 'Driver'} · Level ${d.level}`, 2600, 'medium');
    if (firstTime || d.firstRun) {
      d.firstRun = false;
      this.save.write();
      setTimeout(() => this.hud.toast('HOW TO PLAY', 'W/S drive · A/D steer · SPACE handbrake · R rewind · ESC festival menu', 'info', 7000), 2800);
      setTimeout(() => this.hud.toast('FIND EVENTS', 'Drive into the glowing beacons to start races — press M for the map', 'info', 7000), 6500);
      // guide new drivers to the closest race
      const p = this.player.physics.pos;
      const first = [...this.events.races].sort((a, b) => Math.hypot(a.marker.x - p.x, a.marker.z - p.z) - Math.hypot(b.marker.x - p.x, b.marker.z - p.z))[0];
      if (first) setTimeout(() => this.setRouteTo(first.marker.x, first.marker.z, `Your first race: ${first.name}`), 1500);
    }
  }

  openPause(tab) {
    if (this.menus.open) return;
    this.paused = true;
    this.menus.openPause(tab || 'festival');
    this.onMenuClosed = () => {
      this.paused = false;
      this.onMenuClosed = null;
    };
    this.audio.ui('select');
  }

  openMap() {
    this.paused = true;
    this.worldMap.show();
    this.audio.ui('select');
  }

  closeMap() {
    this.worldMap.hide();
    this.paused = false;
    this.audio.ui('back');
  }

  quitToTitle() {
    if (this.race.running) this.quitRace();
    this.save.write(true);
    this.menus.close();
    this.radio.stop();
    this.showTitle();
  }

  // ---------------------------------------------------------------- events / races
  startRace(def, travel = false, opts = {}) {
    this.menus.close();
    this.paused = false;
    if (this.worldMap.open) this.worldMap.hide();
    const go = () => {
      if (this.race.running) this.race.cleanup();
      this.state = 'race';
      this.gpsRoute = null;
      this.gpsTarget = null;
      this.skills.bank();
      this.race.start(def, opts);
      this.rewind.clear();
      this.hud.show(true);
    };
    if (travel || opts.online) this.fadeThen(go);
    else go();
  }

  restartRace() {
    const A = this.race.active;
    if (!A) return;
    const def = A.def;
    this.menus.close();
    this.race.cleanup();
    this.startRace(def, true);
  }

  quitRace() {
    if (this.race.active?.online) this.net.leaveRace();
    this.race.cleanup();
    this.menus.close();
    this.state = 'freeroam';
    this.paused = false;
    this.hud.setPrompt('');
    this.hud.show(true);
  }

  onRaceFinished(def, pos, time, standings, A) {
    const d = this.save.data;
    const baseCr = [25000, 15000, 10000][pos - 1] ?? 5000;
    const scale = clamp(def.distance / 4000, 0.6, 1.8);
    const credits = time ? Math.round(baseCr * scale) : 1000;
    const xp = time ? Math.round(([3000, 2000, 1500][pos - 1] ?? 800) * scale) : 300;
    d.stats.racesDone++;
    if (pos === 1 && time) d.stats.racesWon++;
    const rec = d.raceRecords[def.id];
    if (time && (!rec || time < rec.time)) d.raceRecords[def.id] = { time, pos: Math.min(pos, rec?.pos ?? 99) };
    else if (rec && pos < rec.pos) rec.pos = pos;
    this.save.write();
    this.state = 'results';
    this.paused = true;
    this.hud.show(false);
    this.menus.showResults(def, pos, time, standings, { credits, xp, retry: A.online ? null : () => this.restartRace() }, () => {
      this.progression.addCredits(credits, `${def.name} · ${time ? '#' + pos : 'DNF'}`);
      this.progression.addXP(xp);
      this.race.cleanup();
      this.menus.close();
      this.state = 'freeroam';
      this.paused = false;
      this.hud.show(true);
    });
  }

  onlineRaceEnded(results) {
    const A = this.race.active;
    if (!A) return;
    const idx = results.findIndex((r) => r.id === this.net.id);
    const pos = idx >= 0 ? idx + 1 : results.length;
    const me = results[idx];
    const standings = results.map((r) => ({ name: r.name, isPlayer: r.id === this.net.id, time: r.time, finished: r.time !== null }));
    this.onRaceFinished(A.def, pos, me && me.time, standings, A);
  }

  // ---------------------------------------------------------------- travel / GPS
  fadeThen(fn) {
    this.fadeTarget = 1;
    setTimeout(() => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
      this.gameCam.snap();
      setTimeout(() => (this.fadeTarget = 0), 150);
    }, 420);
  }

  fastTravelTo(x, z, heading) {
    this.fadeThen(() => {
      const near = this.world.network.nearest(x, z, 200);
      if (near) {
        const h = Math.atan2(near.tx, near.tz);
        const side = near.road.width / 4;
        this.player.place(near.x - Math.cos(h) * side, near.z + Math.sin(h) * side, h);
      } else this.player.place(x, z, heading);
      this.rewind.clear();
    });
  }

  fastTravelFestival() {
    const P = this.props.festivalParking;
    this.fadeThen(() => {
      this.player.place(P.x, P.z, Math.PI * 0.85);
      this.rewind.clear();
    });
  }

  setRouteTo(x, z, name = 'Destination') {
    const p = this.player.physics.pos;
    this.gpsRoute = this.graph.route(p.x, p.z, x, z);
    this.gpsTarget = { x, z, name };
    this.hud.toast('ROUTE SET', name, 'info', 2500);
  }

  updateGPS(dt) {
    if (!this.gpsTarget) return;
    const p = this.player.physics.pos;
    const t = this.gpsTarget;
    if (Math.hypot(p.x - t.x, p.z - t.z) < 25) {
      this.hud.toast('DESTINATION REACHED', t.name, 'info', 2200);
      this.gpsRoute = null;
      this.gpsTarget = null;
      return;
    }
    this.gpsTimer = (this.gpsTimer || 0) - dt;
    if (this.gpsTimer <= 0) {
      this.gpsTimer = 1;
      if (distToPolyline(p.x, p.z, this.gpsRoute) > 45) this.gpsRoute = this.graph.route(p.x, p.z, t.x, t.z);
    }
  }

  // ---------------------------------------------------------------- garage
  switchCar(index) {
    const d = this.save.data;
    d.current = index;
    this.save.write(true);
    const old = this.player;
    const pos = old.physics.pos.clone(),
      heading = old.physics.heading;
    old.dispose();
    this.vehicles.splice(this.vehicles.indexOf(old), 1);
    this.player = this.spawnPlayer(this.save.currentCar);
    this.player.place(pos.x, pos.z, heading);
    this.audio.removeEngine('player');
    if (this.audio.ready) this.audio.createEngine('player', this.player.spec.sound);
    this.gameCam.snap();
    this.rewind.clear();
    this.net.profileChanged();
    this.hud.toast('NOW DRIVING', this.player.spec.name, 'gold', 2500);
  }

  applyPaint() {
    this.player.setPaint(this.save.currentCar.paint);
    this.net.profileChanged();
  }

  // ---------------------------------------------------------------- world interactions
  onSmash(o, phys, speed) {
    const isPlayer = phys === this.player.physics;
    if (isPlayer) this.audio.smash();
    const col = o.kind === 'bush' ? [0.3, 0.45, 0.2] : o.kind === 'board' ? [1.0, 0.55, 0.1] : [0.55, 0.42, 0.3];
    this.effects.debris(o.x, o.y, o.z, phys.vel.x, phys.vel.z, col, o.kind === 'board' ? 34 : 12);
    if (o.onSmash) o.onSmash(o, phys, speed);
    if (isPlayer && o.kind !== 'board') this.skills.wreck(o.kind);
  }

  onBoardSmashed(board) {
    const d = this.save.data;
    if (!d.boards.includes(board.id)) d.boards.push(board.id);
    this.save.write();
    this.progression.addXP(2000);
    this.hud.toast('BONUS BOARD SMASHED', `${d.boards.length} / ${this.boardsTotal} found · +2,000 XP`, 'gold', 3000);
    this.audio.ui('bank');
    this.skills.add('BONUS BOARD', 500);
  }

  updateEventPrompts() {
    const p = this.player.physics.pos;
    let near = null;
    for (const m of this.markers) {
      const d = Math.hypot(p.x - m.def.marker.x, p.z - m.def.marker.z);
      if (d < 9) near = m.def;
    }
    const lobby = this.net.lobby && this.net.lobby.state === 'lobby' && !this.net.lobby.members.some((x) => x.id === this.net.id);
    if (near) {
      const label = { circuit: 'ROAD RACE', sprint: 'ROAD RACE', dirt: 'DIRT RACE', drag: 'DRAG RACE' }[near.type] || 'RACE';
      this.hud.setPrompt(`<kbd>ENTER</kbd> ${label} · <span class="ev-title">${near.name}</span>`);
      if (this.input.hit('accept')) {
        this.paused = true;
        this.hud.setPrompt('');
        this.menus.eventIntro(
          near,
          () => this.startRace(near, false),
          () => {
            this.menus.close();
            this.paused = false;
          }
        );
      }
    } else if (lobby) this.hud.setPrompt('<kbd>J</kbd> JOIN THE ONLINE RACE');
    else this.hud.setPrompt('');
  }

  // ---------------------------------------------------------------- main loop
  loop() {
    try {
      this.tick();
    } catch (e) {
      // keep the game running; report each distinct error once
      const key = String(e && e.message);
      this._errs = this._errs || new Set();
      if (!this._errs.has(key)) {
        this._errs.add(key);
        console.error(e);
      }
      this.input.endFrame();
    }
  }

  tick() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.frame++;
    this.time += dt;
    const input = this.input;
    input.poll();

    const driving = (this.state === 'freeroam' || this.state === 'race') && !this.paused;
    if (this.state === 'title') {
      if (input.hit('accept') || input.padHit('accept')) this.startFromTitle();
      this.gameCam.orbit(dt, this.player.root.position, 7.2, 1.3, 0.09, this.world);
      if (this.frame % 60 === 0) this.updateTitleStatus();
    } else if (this.state === 'naming') {
      this.gameCam.orbit(dt, this.player.root.position, 7.2, 1.3, 0.09, this.world);
    } else if (this.worldMap.open) {
      this.worldMap.update(dt, input);
      if (input.hit('map') || input.hit('pause') || input.padHit('back')) this.closeMap();
    } else if (this.menus.open) {
      this.menus.handleInput(input);
    } else if (driving) {
      if (input.hit('pause')) this.openPause();
      else if (input.hit('map')) this.openMap();
      if (input.hit('radio')) {
        this.settings.radio = this.radio.toggle();
        this.hud.toast('HORIZON PULSE', this.settings.radio ? 'Radio on' : 'Radio off', 'purple', 1500);
      }
      if (input.hit('horn')) this.audio.ui('horn');
      if (input.hit('lights')) this.env.forceLights = !this.env.forceLights;
      if (input.pressed.has('KeyJ') && this.net.lobby) this.net.joinRace();
      if (input.pressed.has('KeyY') && this.net.state === 'connected') this.openChat();
    }

    if (driving && !this.paused) {
      const rewinding = !this.race.active?.online && (input.key('rewind') || !!(input.gamepad && input.padButtons[2]));
      if (rewinding && !this.rewind.active) this.rewind.start();
      if (!this.rewind.update(dt, rewinding)) this.updateDriving(dt);
    } else {
      for (const v of this.vehicles) v.syncVisual(1);
      // Physics resets with a small drop clearance. Settle only the title-screen
      // visual onto the surface; driving keeps the original physics pose.
      if (this.state === 'title' || this.state === 'naming') {
        const wheelPoint = this._titleWheelPoint || (this._titleWheelPoint = new THREE.Vector3());
        this.player.root.updateMatrixWorld(true);
        let clearance = Infinity;
        for (const wheel of this.player.model.wheels) {
          wheel.steer.getWorldPosition(wheelPoint);
          clearance = Math.min(clearance, wheelPoint.y - wheel.r - this.world.height(wheelPoint.x, wheelPoint.z));
        }
        this.player.root.position.y -= Math.max(0, Math.min(0.25, clearance));
      }
    }

    // camera
    if (this.state === 'freeroam' || this.state === 'race' || this.state === 'results') {
      const rs = this.race.active?.state;
      if (rs === 'intro') this.gameCam.orbit(dt, this.player.root.position, 12, 3.5, 0.22, this.world);
      else {
        this.gameCam.lookBack = input.key('lookBack');
        this.gameCam.update(dt, this.player, this.world);
      }
    }
    // environment + world streaming
    this.env.update(dt, this.inspectionFocus || this.player.root.position);
    if (this.env.forceLights) this.env.lightsOn = true;
    this.env.sky.mesh.position.copy(this.camera.position);
    this.world.update(dt, this.camera, this.env);
    this.props.update(dt, this.env);
    if (this.heroCar) this.heroCar.group.rotation.y += dt * 0.35;
    for (const m of this.markers) {
      m.obj.userData.beam.material.uniforms.time.value = this.time;
      m.obj.userData.icon.position.y = 5.5 + Math.sin(this.time * 2) * 0.3;
      m.obj.visible = !this.race.running && this.state !== 'environment-inspection';
    }
    for (const v of this.vehicles) v.updateLights(dt, this.env.lightsOn, v.physics.gear < 0, v.physics.input.brake > 0.1 && v.physics.gear >= 0);
    this.effects.update(dt, 0.1 + (1 - this.env.nightFactor) * 1.0);
    this.net.update(dt);
    this.updateAudio(dt);
    this.updateHUD(dt);
    // fade + post
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 9);
    this.post.uniforms.fade.value = this.fade;
    this.post.uniforms.exposure.value = this.env.exposure;
    const kmh = this.player.physics.speed * 3.6;
    this.post.uniforms.speedBlur.value = this.settings.motionBlur && this.gameCam.mode <= 1 && this.state !== 'title' ? clamp((kmh - 110) / 220, 0, 1) : 0;
    this.updateProbe();
    this.updateDynamicRes(dt);
    this.post.render(this.scene, this.camera, dt);
    input.endFrame();
  }

  // lower the internal render resolution when the frame rate drops, raise it again when there is headroom
  updateDynamicRes(dt) {
    if (!this.settings.dynamicRes || this.state === 'title') return;
    this._drT = (this._drT || 0) + dt;
    this._drN = (this._drN || 0) + 1;
    if (this._drT < 2) return;
    const fps = this._drN / this._drT;
    this._drT = 0;
    this._drN = 0;
    let s = this.renderScale ?? 1;
    if (fps < 48 && s > 0.55) s = Math.max(0.55, s - 0.1);
    else if (fps > 57 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.renderScale) {
      this.renderScale = s;
      this.post.setQuality({ scale: s });
    }
  }

  // dynamic reflections on the player's paint
  updateProbe() {
    const probe = this.probe;
    const qn = this.qualityName();
    probe.enabled = qn === 'high' || qn === 'ultra';
    if (!probe.enabled) {
      if (this.player.model.paintMat.envMap) {
        this.player.model.paintMat.envMap = null;
        this.player.model.paintMat.needsUpdate = true;
      }
      return;
    }
    if (!this._probeHide) this._probeHide = [this.world.vegetation.group, this.world.grass.mesh, this.props.group, this.traffic.group, this.stunts.group, this.effects.smoke.mesh, this.effects.sparks.mesh, ...this.markers.map((m) => m.obj)];
    const hide = [...this._probeHide, this.player.root, ...this.net.remoteGroups()];
    if (this.heroCar) hide.push(this.heroCar.group);
    probe.update(this.renderer, this.scene, this.player.root.position, hide);
    const mat = this.player.model.paintMat;
    if (probe.ready && mat.envMap !== probe.texture) {
      mat.envMap = probe.texture;
      mat.envMapIntensity = 1.05;
      mat.needsUpdate = true;
    }
  }

  openChat() {
    if (!this.chatBox) {
      this.chatBox = document.createElement('div');
      this.chatBox.className = 'chat-compose';
      this.chatBox.innerHTML = '<input maxlength="120" placeholder="Say something… (Enter to send, Esc to cancel)">';
      this.ui.appendChild(this.chatBox);
      const inp = this.chatBox.querySelector('input');
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          if (inp.value.trim()) this.net.chat(inp.value.trim());
          inp.value = '';
          inp.blur();
        } else if (e.key === 'Escape') inp.blur();
      });
      inp.addEventListener('blur', () => {
        this.chatBox.classList.remove('on');
        this.input.textFocus = false;
      });
    }
    this.chatBox.classList.add('on');
    this.input.textFocus = true;
    this.input.down.clear();
    setTimeout(() => this.chatBox.querySelector('input').focus(), 0);
  }

  updateDriving(dt) {
    const input = this.input;
    const p = this.player.physics;
    const racing = this.race.active;
    const frozen = racing && (racing.state === 'intro' || racing.state === 'countdown');
    const ctl = input.driving(dt);
    p.input.throttle = frozen ? 0 : ctl.throttle;
    p.input.brake = frozen ? 1 : ctl.brake;
    p.input.steer = ctl.steer;
    p.input.handbrake = ctl.handbrake;
    if (input.hit('shiftUp')) p.input.shiftUp = true;
    if (input.hit('shiftDown')) p.input.shiftDown = true;
    if (input.hit('camera')) this.gameCam.cycle();
    if (!frozen && (input.hit('reset') || p.upsideTimer > 2.5)) {
      if (racing) this.race.resetPlayerToTrack();
      else this.resetToRoad(this.player);
    }
    this.race.update(dt);

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 10) {
      for (const v of this.vehicles) {
        v.saveState();
        v.physics.step(STEP);
        const imp = this.collision.resolveVehicle(v.physics);
        if (imp > 0) v.physics.lastImpact = Math.max(v.physics.lastImpact, imp);
      }
      if (racing)
        for (let i = 0; i < this.vehicles.length; i++)
          for (let j = i + 1; j < this.vehicles.length; j++) {
            const imp = resolveVehiclePairSafe(this.vehicles[i].physics, this.vehicles[j].physics);
            if (imp > 2 && (this.vehicles[i] === this.player || this.vehicles[j] === this.player)) {
              this.player.physics.lastImpact = Math.max(this.player.physics.lastImpact, imp * 0.6);
              if (imp < 9) this.skills.add('TRADE PAINT', 150);
            }
          }
      this.traffic.stepPhysics(STEP, this.player);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps >= 10) this.accumulator = 0;
    const alpha = this.accumulator / STEP;
    for (const v of this.vehicles) v.syncVisual(alpha);
    this.traffic.update(dt, this.player);
    this.stunts.update(dt);
    this.rewind.record(dt);
    this.updateGPS(dt);
    if (this.state === 'freeroam') this.updateEventPrompts();

    const impact = p.lastImpact;
    if (impact > 4) {
      this.gameCam.addShake(Math.min(1, impact / 20));
      this.audio.impact(impact);
      const f = p.getForward(new THREE.Vector3());
      this.effects.sparksAt(p.pos.x + f.x * 2, p.pos.y, p.pos.z + f.z * 2, p.vel.x, p.vel.z, Math.min(40, impact * 3));
      if (impact > 9) this.save.data.stats.crashes++;
    }
    p.lastImpact = 0;
    for (const v of this.vehicles) this.effects.vehicle(v, dt, v === this.player ? 1 : 0.6);
    this.skills.update(dt, this.player, { impact, drafting: this.drafting });
    const st = this.save.data.stats;
    st.distance += p.speed * dt;
    st.topSpeed = Math.max(st.topSpeed, p.speed * 3.6);
    // splashdown
    const wh = this.world.height(p.pos.x, p.pos.z);
    if (p.pos.y < -0.2 && wh < -0.5 && !this.splashed) {
      this.splashed = true;
      this.effects.splash(p.pos.x, 0.2, p.pos.z, p.speed);
      this.audio.splash();
      this.skills.breakChain('SPLASHDOWN');
      setTimeout(() => {
        if (this.race.active) this.race.resetPlayerToTrack();
        else this.resetToRoad(this.player);
        this.splashed = false;
      }, 900);
    }
  }

  resetToRoad(v) {
    const p = v.physics;
    const near = this.world.network.nearest(p.pos.x, p.pos.z, 3000);
    if (near) {
      const lane = near.road.kind === 'highway' ? 3.6 : 2.4;
      let heading = Math.atan2(near.tx, near.tz);
      const fwd = p.getForward(new THREE.Vector3());
      if (fwd.x * near.tx + fwd.z * near.tz < 0) heading += Math.PI;
      const rx = -Math.cos(heading),
        rz = Math.sin(heading);
      v.place(near.x + rx * lane, near.z + rz * lane, heading);
    } else v.place(p.pos.x, p.pos.z, p.heading);
    this.gameCam.snap();
    this.rewind.clear();
  }

  updateAudio(dt) {
    const a = this.audio;
    if (!a.ready) return;
    const p = this.player.physics;
    const spec = this.player.spec;
    const active = (this.state === 'freeroam' || this.state === 'race') && !this.paused;
    a.updateEngine('player', p.rpm, active ? p.throttleOut : 0.08, 0, spec.turbo ? p.boost : null, active ? 1 : this.state === 'title' ? 0.25 : 0.35);
    let slip = 0,
      n = 0;
    for (const w of p.wheels)
      if (w.contact) {
        slip = Math.max(slip, w.slip > 0.4 ? (w.slip - 0.4) / 0.6 : 0);
        n++;
      }
    a.updateEnv(active ? p.speed : 0, active && p.speed > 3 ? slip : 0, p.offroadFactor, n > 0);
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    a.setListener(cam.position, fwd, new THREE.Vector3(0, 1, 0));
    if (this.race.active) {
      const near = this.race.active.racers
        .filter((r) => !r.isPlayer)
        .map((r) => ({ r, d: r.v.physics.pos.distanceTo(p.pos) }))
        .sort((x, y) => x.d - y.d);
      const keep = new Set(near.slice(0, 3).map((x) => 'ai' + x.r.v.root.id));
      for (const id of [...a.engines.keys()]) if (id.startsWith('ai') && !keep.has(id)) a.removeEngine(id);
      for (const { r } of near.slice(0, 3)) {
        const id = 'ai' + r.v.root.id;
        if (!a.engines.has(id)) a.createEngine(id, r.v.spec.sound, true);
        a.updateEngine(id, r.v.physics.rpm, r.v.physics.throttleOut, 0, null, 0.9, r.v.physics.pos);
      }
    } else for (const id of [...a.engines.keys()]) if (id.startsWith('ai')) a.removeEngine(id);
  }

  updateHUD(dt) {
    const p = this.player.physics;
    const spec = this.player.spec;
    if (p.justShifted) {
      this.hud.shiftFlash = 0.15;
      p.justShifted = 0;
    }
    if (this.frame % 15 === 0) {
      const near = this.world.network.nearest(p.pos.x, p.pos.z, 12);
      this.hud.setRoadName(near ? near.road.name : '');
      const d = this.save.data;
      const lp = this.progression.levelProgress();
      this.hud.setTopRight(
        `<div class="cr">${formatNumber(d.credits)} CR</div><div class="lvl">LEVEL ${lp.level} · ${Math.round(lp.frac * 100)}%</div>${
          this.net.state === 'connected' ? `<div class="online">● ONLINE · ${this.net.players.size + 1} DRIVERS</div>` : ''
        }`
      );
    }
    this.hud.setChain(this.skills.state());
    const others = this.net.mapPlayers().map((o) => ({ x: o.x, z: o.z, color: o.color }));
    if (this.race.active) for (const r of this.race.active.racers) if (!r.isPlayer) others.push({ x: r.v.physics.pos.x, z: r.v.physics.pos.z, color: '#ffd21f', ai: true });
    const A = this.race.active;
    this.hud.update(dt, {
      speedKmh: p.speed * 3.6,
      rpm: p.rpm,
      maxRpm: spec.electric ? spec.redline : spec.redline * 1.02,
      redline: spec.electric ? spec.redline * 2 : spec.redline,
      gear: p.gear,
      units: this.settings.units,
      boost: spec.turbo ? p.boost : undefined,
      pos: p.pos,
      heading: p.heading,
      route: A ? A.routePoly || (A.routePoly = A.route.polyline(3)) : this.gpsRoute,
      markers: A ? null : this.mapMarkers,
      others,
      fps: this.fps,
      showFps: this.settings.showFps || this.params.has('fps'),
    });
  }
}
