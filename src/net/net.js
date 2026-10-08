// Multiplayer client: joins the shared world, state sync, nametags, chat, online races.
// Other cars are drawn where they are now: each state carries when it was true, and
// src/net/sync.js predicts forward from it and blends corrections in. The nearest players
// are drawn with their real car, farther ones as one instanced stand-in, and the farthest
// only as map dots, so a full world stays cheap.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCar } from '../vehicle/carmodel.js';
import { CAR_BY_ID } from '../vehicle/carspecs.js';
import { escapeHtml } from '../game/race.js';
import { resolveVehiclePair } from '../world/colliders.js';
import { PROTOCOL, S } from '../../server/protocol.js';
import { ServerClock, SendGate, RemoteMotion, makeState, localNow } from './sync.js';

const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const PING_MS = 1000; // clock sync; a burst right after joining settles it quickly
const PING_BURST = [60, 180, 320, 500];
const STALE_MS = 5000; // a player silent this long is hidden
const FULL_MODELS = 10; // nearest other players drawn with their real car
const FULL_DIST = 320; // m
const DRAW_DIST = 2500; // beyond this other players are map dots only
const TAG_DIST = 450;
const MAX_PROXIES = 128;
const KEEPALIVE_MS = 20000; // also runs in hidden tabs, where the frame loop stops
const HIDDEN_LEAVE_MS = 10 * 60 * 1000; // a tab left in the background gives its slot back
const FX_DIST = 180; // m: other players' tyre smoke, skid marks and sand/snow tracks
const WALL_DIST = 400; // m: nearer players' predicted paths stop at walls (collision sweep)
const AIRBORNE = [-1, -1, -1, -1];
const WORLD_LABELS = {
  timeOfDay: { dynamic: 'dynamic day/night', morning: 'morning', noon: 'midday', golden: 'golden hour', sunset: 'sunset', night: 'night' },
  dayLength: { 20: '20-minute days', 40: '40-minute days', 60: '1-hour days', 120: '2-hour days' },
};

// One number per wheel for other players' tyre effects: -1 airborne, else
// surface * 1000 + spin (0-9) * 100 + slip (0-99, slip / 0.02).
const wheelCode = (w) => (w.contact ? (w.surface | 0) * 1000 + Math.round(Math.min(1, w.spinning || 0) * 9) * 100 + Math.round(Math.min(1.98, w.slip || 0) * 50) : -1);
// what of a wheel changes the look of tyre effects: airborne, surface, smoking (slip > 0.45)
const wheelLook = (c) => (c < 0 ? 'a' : `${Math.floor(c / 1000)}${c % 100 > 22 ? 's' : ''}`);
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

// light-weight kinematic body so remote cars can be bumped into
class RemoteBody {
  constructor(spec) {
    const st = spec.style;
    this.mass = spec.mass;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.halfExtents = new THREE.Vector3(st.W / 2, (st.H - st.sill) / 2, st.L / 2);
    this.boxCenterLocal = new THREE.Vector3(0, -spec.cgH + (st.H + st.sill) / 2, 0);
  }
  invMassAt() {
    return 0;
  }
  applyImpulse() {}
}

// Distant players: a painted body, dark glasshouse and tyres in a unit box (x/z -0.5..0.5,
// y 0..1) scaled to each car, all in one instanced draw call.
function buildProxyMesh() {
  const parts = [];
  const box = (x0, x1, y0, y1, z0, z1, shade) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(shade), 3));
    parts.push(g);
  };
  box(-0.48, 0.48, 0.14, 0.58, -0.5, 0.5, 1);
  box(-0.4, 0.4, 0.58, 1, -0.28, 0.16, 0.06);
  for (const x of [-1, 1]) for (const z of [-0.32, 0.3]) box(x > 0 ? 0.4 : -0.5, x > 0 ? 0.5 : -0.4, 0, 0.3, z - 0.09, z + 0.09, 0.04);
  const mesh = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_PROXIES);
  for (const g of parts) g.dispose();
  mesh.name = 'remote players (far)';
  mesh.setColorAt(0, new THREE.Color());
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

export class NetClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.state = 'offline';
    this.id = null;
    this.world = 1;
    this.lastWorld = 0;
    this.players = new Map();
    this.clock = new ServerClock();
    this.gate = new SendGate();
    this.maxHz = 30; // the world lowers it as it fills
    this.acc = new THREE.Vector3(); // this car's smoothed horizontal acceleration
    this.prevVel = null;
    this.helloAt = 0;
    this.pinger = null;
    this.burst = [];
    this.chatLog = [];
    this.retry = 0;
    this.retryTimer = null;
    this.dropTimer = null;
    this.wantOnline = true;
    this.everConnected = false;
    this.hop = false;
    this.waiting = false;
    this.paused = false;
    this.hiddenSince = 0;
    this.notes = { join: [], leave: [] };
    this.worldSettings = null; // the world's shared settings while online (game.worldSetting)
    this.noteTimer = null;
    this.lobby = null;
    this.standings = null;
    // the world's running race: { id, ai (who drives its AI opponents), npcs (their roster) }
    this.racing = null;
    this.npcSend = new Map(); // opponent number -> send state, while this client drives them
    this.npcAt = 0;
    this.proxies = null;
    this._ranked = [];
    this.tagLayer = document.createElement('div');
    this.tagLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    document.getElementById('ui').appendChild(this.tagLayer);
    this.banner = document.createElement('div');
    this.banner.className = 'lobby-banner';
    document.getElementById('ui').appendChild(this.banner);
    this.chatOverlay = document.createElement('div');
    this.chatOverlay.className = 'chat-overlay';
    document.getElementById('ui').appendChild(this.chatOverlay);
    setInterval(() => this.keepAlive(), KEEPALIVE_MS);
    document.addEventListener('visibilitychange', () => {
      this.hiddenSince = document.hidden ? Date.now() : 0;
      if (!document.hidden && this.paused) {
        this.paused = false;
        this.connect();
      }
    });
  }

  get offset() {
    return this.clock.offset;
  }

  get rtt() {
    return this.clock.rtt;
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = new URLSearchParams(location.search).get('server') || import.meta.env?.VITE_WS_URL || `${proto}://${location.host}/ws`;
    const url = new URL(base, location.href);
    url.searchParams.set('world', String(this.world));
    return url.toString();
  }

  status() {
    const labels = {
      offline: 'Offline — playing solo',
      connecting: 'Connecting to the festival server…',
      reconnecting: 'Reconnecting to the festival…',
      connected: `Online · World ${this.world} · ${Math.round(this.rtt)} ms`,
      error: 'No server found — playing solo',
      full: 'Every world is full — playing solo',
      outdated: 'A new version is live — reload the page to go online',
    };
    return { state: this.state, label: labels[this.state], players: [...this.players.values()].filter((p) => !p.npc).map((p) => ({ name: p.name, car: p.car, paint: p.paint })) };
  }

  // other people in the world (not the AI opponents of a race)
  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.npc) n++;
    return n;
  }

  connect() {
    if (this.ws || location.protocol === 'file:') return;
    clearTimeout(this.retryTimer);
    this.wantOnline = true;
    this.paused = false;
    if (this.state !== 'reconnecting') this.state = 'connecting';
    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.state = 'error';
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      const g = this.game;
      const cur = g.save.currentCar;
      this.helloAt = localNow(); // hello -> welcome is the first clock sample
      this.send({ t: 'hello', name: g.save.data.name || 'Driver', car: cur.id, paint: cur.paint.color, b: BUILD, v: PROTOCOL });
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => {};
  }

  onClose(ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    const was = this.state;
    this.stopPinging();
    this.cleanupPlayers();
    // the world was full: go straight on to the next one
    if (this.hop) {
      this.hop = false;
      this.connect();
      return;
    }
    // this page is newer than the world's code, which a deploy is replacing: try again soon
    if (this.waiting) {
      this.waiting = false;
      this.state = this.everConnected ? 'reconnecting' : 'connecting';
      this.retryTimer = setTimeout(() => this.wantOnline && this.connect(), 2000);
      return;
    }
    // rejoin from world 1, so after a server restart the worlds refill in order
    this.world = 1;
    if (!this.wantOnline) {
      if (this.state !== 'full' && this.state !== 'outdated') this.state = 'offline';
      this.leaveWorldSettings();
      return;
    }
    // Keep trying for as long as the page is open. The first retry is quick, so a server
    // restart (every deploy) passes with only a short "Reconnecting".
    this.state = this.everConnected ? 'reconnecting' : 'error';
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => this.wantOnline && this.connect(), delay);
    if (was === 'connected') {
      clearTimeout(this.dropTimer);
      // a short drop (every deploy) keeps the world's sky; a longer one returns to your own
      this.dropTimer = setTimeout(() => {
        if (this.state !== 'reconnecting') return;
        this.game.hud.toast('DISCONNECTED', 'Lost connection to the festival server — retrying', 'cyan');
        this.leaveWorldSettings();
      }, 6000);
    }
  }

  disconnect() {
    this.wantOnline = false;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
    this.state = 'offline';
    this.stopPinging();
    this.cleanupPlayers();
    this.leaveWorldSettings();
  }

  // Pings keep the clock estimate fresh (and hidden tabs alive); they run on timers, not
  // frames. A burst right after joining finds a fast round trip within half a second.
  startPinging() {
    this.stopPinging();
    this.pinger = setInterval(() => this.ping(), PING_MS);
    this.burst = PING_BURST.map((ms) => setTimeout(() => this.ping(), ms));
  }

  stopPinging() {
    clearInterval(this.pinger);
    this.pinger = null;
    for (const t of this.burst) clearTimeout(t);
    this.burst = [];
  }

  ping() {
    if (this.state === 'connected') this.send({ t: 'ping', c: localNow() });
  }

  // offline the player's own time of day and day length apply again
  leaveWorldSettings() {
    if (!this.worldSettings) return;
    this.worldSettings = null;
    this.game.applyWorld();
  }

  setWorld(change) {
    this.send({ t: 'world', ...change });
  }

  // A hidden tab keeps its place in the world for a while (its pings keep the socket
  // alive), then leaves until it is shown again.
  keepAlive() {
    if (this.state !== 'connected') return;
    if (this.hiddenSince && Date.now() - this.hiddenSince > HIDDEN_LEAVE_MS) {
      this.disconnect();
      this.paused = true;
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  serverNow() {
    return this.clock.now();
  }

  cleanupPlayers() {
    for (const p of [...this.players.values()]) this.removePlayer(p.id);
    this.players.clear();
    if (this.proxies) this.proxies.count = 0;
    this.notes.join.length = this.notes.leave.length = 0;
    this.lobby = null;
    this.racing = null;
    this.npcSend.clear();
    // the reload banner arrives just before the server closes the socket: keep it up
    if (this.state !== 'outdated') this.banner.classList.remove('on');
  }

  onMessage(m) {
    const g = this.game;
    switch (m.t) {
      case 'welcome': {
        this.state = 'connected';
        this.id = m.id;
        this.world = m.world;
        this.retry = 0;
        clearTimeout(this.dropTimer);
        this.clock.reset();
        this.clock.sample(this.helloAt, m.now);
        this.startPinging();
        this.maxHz = m.hz || 30;
        this.gate = new SendGate(); // the first state goes out at once
        this.worldSettings = m.settings || null;
        g.applyWorld();
        for (const p of m.players) this.addPlayer(p);
        // a quiet rejoin after a short drop; announce first joins and world changes
        if (!this.everConnected || m.world !== this.lastWorld)
          g.hud.toast('ONLINE', `World ${m.world} · ${m.players.length} other driver${m.players.length === 1 ? '' : 's'}`, 'cyan', 3500);
        this.everConnected = true;
        this.lastWorld = m.world;
        if (m.race) this.onLobby(m.race);
        // a race already under way: watch its opponents too
        if (m.race?.state === 'running') {
          this.racing = { id: m.race.id, ai: m.race.ai, npcs: m.race.npcs };
          this.showOpponents(m.race.npcs);
        }
        break;
      }
      case 'rai':
        this.onRaceAI(m);
        break;
      case 'full':
        if (m.next) {
          this.world = m.next;
          this.hop = true;
        } else {
          this.state = 'full';
          this.wantOnline = false;
        }
        break;
      case 'wait':
        this.waiting = true;
        break;
      case 'rate':
        this.maxHz = m.hz || this.maxHz;
        break;
      case 'world': {
        const before = this.worldSettings || {};
        this.worldSettings = m.settings;
        g.applyWorld();
        const what = Object.keys(WORLD_LABELS)
          .filter((k) => before[k] !== m.settings[k])
          .map((k) => WORLD_LABELS[k][m.settings[k]] ?? m.settings[k]);
        if (what.length) g.hud.toast('WORLD UPDATED', `${m.id === this.id ? 'You' : m.by} set ${what.join(' and ')} for everyone`, 'cyan', 3500);
        break;
      }
      case 'update':
        this.state = 'outdated';
        this.wantOnline = false;
        this.showUpdate();
        break;
      case 'join':
        this.addPlayer(m.p);
        this.note('join', m.p.name);
        break;
      case 'leave': {
        const p = this.players.get(m.id);
        if (p) this.note('leave', p.name);
        this.removePlayer(m.id);
        break;
      }
      case 'snap':
        for (const e of m.s) {
          if (e[S.id] === this.id) continue;
          const p = this.players.get(e[S.id]);
          if (!p) continue;
          // when the state was true, in server time (the sender's own stamp)
          const ts = m.now - e[S.age];
          if (ts <= p.motion.ts) continue;
          const s = makeState();
          s.ts = ts;
          s.pos.set(e[S.pos], e[S.pos + 1], e[S.pos + 2]);
          s.quat.set(e[S.quat], e[S.quat + 1], e[S.quat + 2], e[S.quat + 3]).normalize();
          s.vel.set(e[S.vel], e[S.vel + 1], e[S.vel + 2]);
          s.angVel.set(e[S.angVel], e[S.angVel + 1], e[S.angVel + 2]);
          s.acc.set(e[S.acc], 0, e[S.acc + 1]);
          p.motion.push(s);
          p.st = e[S.steer];
          p.f = e[S.flags];
          p.rpm = e[S.rpm];
          p.w = e.slice(S.wheels, S.wheels + 4);
        }
        break;
      case 'pong':
        this.clock.sample(m.c, m.now);
        break;
      case 'chat':
        this.chatLog.push({ name: m.name, m: m.m });
        if (this.chatLog.length > 100) this.chatLog.shift();
        this.showChat(m.name, m.m);
        break;
      case 'profile': {
        const p = this.players.get(m.id);
        if (p) {
          p.car = m.car;
          p.paint = m.paint;
          this.rebuildPlayer(p);
        }
        break;
      }
      case 'emote':
        break;
      case 'rlobby':
        this.onLobby(m.race);
        break;
      case 'rstart':
        this.onRaceStart(m);
        break;
      case 'rstand':
        this.standings = m.race;
        break;
      case 'rend':
        this.hideOpponents();
        this.racing = null;
        this.npcSend.clear();
        this.onRaceEnd(m);
        break;
    }
  }

  // Joins and leaves arrive in bursts (everyone rejoins after a server restart): one toast each.
  note(kind, name) {
    this.notes[kind].push(name);
    if (!this.noteTimer)
      this.noteTimer = setTimeout(() => {
        this.noteTimer = null;
        for (const k of ['join', 'leave']) {
          const list = this.notes[k];
          if (!list.length) continue;
          const who = list.length === 1 ? list[0] : `${list[0]} and ${list.length - 1} other${list.length > 2 ? 's' : ''}`;
          this.game.hud.toast(`${who} ${k === 'join' ? 'joined' : 'left'}`, k === 'join' ? 'A new driver arrived at the festival' : '', 'cyan', 2500);
          list.length = 0;
        }
      }, 1200);
  }

  showUpdate() {
    this.game.hud.toast('NEW VERSION', 'Reload the page to rejoin the online world', 'cyan', 8000);
    this.banner.innerHTML = 'A new version of the festival is live · <b>click here to reload</b> and rejoin the online world';
    this.banner.style.pointerEvents = 'auto';
    this.banner.style.cursor = 'pointer';
    this.banner.onclick = () => location.reload();
    this.banner.classList.add('on');
  }

  // ------------------------------------------------------------ players
  addPlayer(info) {
    if (info.id === this.id || this.players.has(info.id)) return;
    const motion = new RemoteMotion();
    const p = {
      id: info.id,
      name: info.name,
      car: info.car,
      paint: info.paint,
      npc: !!info.npc, // a race's AI opponent, driven by another player's game
      motion,
      // the pose drawn (models, stand-ins, tags, effects and collisions all read these)
      pos: motion.pos,
      quat: motion.quat,
      vel: motion.vel,
      color: new THREE.Color(),
      proxyLocal: new THREE.Matrix4(),
      st: 0,
      f: 0,
      rpm: 0,
      w: AIRBORNE,
      fx: null,
      fxOn: false,
      dist: Infinity,
      visible: false,
      full: false,
      group: null,
      model: null,
      idle: 0,
      body: null,
      tag: null,
    };
    this.players.set(info.id, p);
    this.rebuildPlayer(p);
  }

  // car or paint changed (or a new player): the real model is (re)built on demand when near
  rebuildPlayer(p) {
    const spec = CAR_BY_ID[p.car] || CAR_BY_ID.gt;
    const st = spec.style;
    p.spec = spec;
    p.color.set(p.paint);
    p.body = new RemoteBody(spec);
    // how much of a predicted path is clear of walls, for a car this wide
    const rad = st.W / 2;
    p.limit = (from, to) => this.game.collision?.sweep(from.x, from.z, to.x, to.z, rad, from.y) ?? 1;
    // the shape effects.js expects of a vehicle; the id keys skid marks (id * 4 + wheel)
    if (p.fxOn) this.liftEffects(p);
    p.fx = {
      root: { id: 1e6 + p.id },
      spec,
      physics: {
        speed: 0,
        forwardSpeed: 0,
        vel: p.vel,
        quat: p.quat,
        wheels: [0, 1, 2, 3].map((i) => {
          const front = i < 2;
          return { x: ((i % 2 === 0 ? 1 : -1) * (front ? st.trackF : st.trackR)) / 2, z: ((front ? 1 : -1) * st.WB) / 2, contact: false, surface: 8, slip: 0, spinning: 0, steer: 0, omega: 0, slipAngle: 0, point: new THREE.Vector3() };
        }),
      },
    };
    // stand-in box from the car's centre of mass: ground below it, centred on the body length
    const zc = -(st.WB * spec.wf - st.WB / 2) + ((st.fo ?? 0) - (st.ro ?? 0)) / 2;
    p.proxyLocal.compose(_v.set(0, -spec.cgH, zc), _q.identity(), new THREE.Vector3(st.W, st.H, st.L));
    this.dropModel(p);
    if (!p.tag) {
      p.tag = document.createElement('div');
      p.tag.className = 'nametag';
      this.tagLayer.appendChild(p.tag);
    }
    p.tag.innerHTML = `${escapeHtml(p.name)}<small>${escapeHtml(spec.name)}</small>`;
    p.tag.style.borderBottomColor = p.paint;
  }

  buildModel(p) {
    const spec = p.spec;
    const model = buildCar(spec.style, { color: p.paint });
    const group = new THREE.Group();
    model.group.position.set(0, -spec.cgH, -(spec.style.WB * spec.wf - spec.style.WB / 2));
    group.add(model.group);
    // the authored cars bring their own low-poly shadow caster
    if (!model.group.userData.visualAsset)
      model.group.traverse((o) => {
        if (o.isMesh) o.castShadow = !o.material.transparent;
      });
    group.visible = false;
    this.game.scene.add(group);
    p.group = group;
    p.model = model;
    p.idle = 0;
  }

  dropModel(p) {
    if (!p.model) return;
    this.game.scene.remove(p.group);
    p.model.dispose();
    p.model.paintMat.dispose();
    p.model = p.group = null;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.fxOn) this.liftEffects(p);
    this.dropModel(p);
    p.tag?.remove();
    this.game.audio.removeEngine('net' + id);
    this.players.delete(id);
  }

  remoteGroups() {
    const out = [];
    for (const p of this.players.values()) if (p.group) out.push(p.group);
    if (this.proxies) out.push(this.proxies);
    return out;
  }

  mapPlayers() {
    const out = [];
    for (const p of this.players.values()) if (p.visible) out.push({ x: p.pos.x, z: p.pos.z, name: p.name, color: p.npc ? '#ffd21f' : p.paint });
    return out;
  }

  // a race's AI opponents, drawn from the states their driver streams (everyone but that driver)
  showOpponents(npcs = []) {
    for (const n of npcs) if (!this.players.has(n.id)) this.addPlayer({ id: n.id, name: n.name, car: n.car, paint: n.paint, npc: true });
  }

  hideOpponents() {
    for (const p of [...this.players.values()]) if (p.npc) this.removePlayer(p.id);
  }

  // ------------------------------------------------------------ per frame
  // this car's state, sent when others' prediction of it would drift (SendGate)
  sendState(dt) {
    const g = this.game;
    const ph = g.player.physics;
    // smoothed horizontal acceleration: lets others predict launches and braking
    if (this.prevVel && dt > 0) {
      const k = 1 - Math.exp(-dt / 0.08);
      this.acc.x += (THREE.MathUtils.clamp((ph.vel.x - this.prevVel.x) / dt, -30, 30) - this.acc.x) * k;
      this.acc.z += (THREE.MathUtils.clamp((ph.vel.z - this.prevVel.z) / dt, -30, 30) - this.acc.z) * k;
    }
    (this.prevVel ||= new THREE.Vector3()).copy(ph.vel);
    const f = (ph.input.brake > 0.1 ? 1 : 0) | (g.env.lightsOn ? 2 : 0) | (ph.gear < 0 ? 4 : 0) | (g.race.running ? 8 : 0);
    const w = ph.wheels.map(wheelCode);
    const st = (this._st ||= { acc: this.acc });
    st.pos = ph.pos;
    st.quat = ph.quat;
    st.vel = ph.vel;
    st.angVel = ph.angVel;
    st.steer = ph.steerAngle;
    st.key = `${ph.gear}|${f}|${w.map(wheelLook).join('')}`;
    const now = localNow();
    if (!this.gate.due(now, st, this.maxHz)) return;
    this.send({
      t: 's',
      ts: Math.round(this.clock.now(now)),
      p: [r2(ph.pos.x), r2(ph.pos.y), r2(ph.pos.z)],
      q: [r3(ph.quat.x), r3(ph.quat.y), r3(ph.quat.z), r3(ph.quat.w)],
      v: [r2(ph.vel.x), r2(ph.vel.y), r2(ph.vel.z)],
      av: [r3(ph.angVel.x), r3(ph.angVel.y), r3(ph.angVel.z)],
      ac: [r2(this.acc.x), r2(this.acc.z)],
      st: r2(ph.steerAngle),
      f,
      rpm: Math.round(ph.rpm),
      g: ph.gear,
      w,
    });
    this.gate.sent(now, st);
  }

  // While this client drives a race's AI opponents: their states for the world, batched
  // (at most 20 Hz), each opponent sent when the others' prediction of it would drift.
  sendOpponents(dt) {
    const A = this.game.race.active;
    if (!A?.online || !A.authority) return;
    const g = this.game;
    const hz = Math.min(20, this.maxHz);
    const now = localNow();
    const slot = now - this.npcAt >= 1000 / hz;
    const batch = [];
    for (const r of A.racers) {
      if (r.npc == null) continue;
      const ph = r.v.physics;
      let s = this.npcSend.get(r.npc);
      if (!s) this.npcSend.set(r.npc, (s = { gate: new SendGate(), acc: new THREE.Vector3(), prevVel: ph.vel.clone(), st: {} }));
      if (dt > 0) {
        const k = 1 - Math.exp(-dt / 0.08);
        s.acc.x += (THREE.MathUtils.clamp((ph.vel.x - s.prevVel.x) / dt, -30, 30) - s.acc.x) * k;
        s.acc.z += (THREE.MathUtils.clamp((ph.vel.z - s.prevVel.z) / dt, -30, 30) - s.acc.z) * k;
        s.prevVel.copy(ph.vel);
      }
      if (!slot) continue;
      const f = (ph.input.brake > 0.1 ? 1 : 0) | (g.env.lightsOn ? 2 : 0) | (ph.gear < 0 ? 4 : 0) | 8;
      const w = ph.wheels.map(wheelCode);
      Object.assign(s.st, { pos: ph.pos, quat: ph.quat, vel: ph.vel, angVel: ph.angVel, acc: s.acc, steer: ph.steerAngle, key: `${ph.gear}|${f}|${w.map(wheelLook).join('')}` });
      if (!s.gate.due(now, s.st, hz)) continue;
      // [i, ts, pos, quat, vel, angVel, acc(x z), steer, flags, rpm, gear, wheels]
      batch.push([r.npc, Math.round(this.clock.now(now)), r2(ph.pos.x), r2(ph.pos.y), r2(ph.pos.z), r3(ph.quat.x), r3(ph.quat.y), r3(ph.quat.z), r3(ph.quat.w), r2(ph.vel.x), r2(ph.vel.y), r2(ph.vel.z), r3(ph.angVel.x), r3(ph.angVel.y), r3(ph.angVel.z), r2(s.acc.x), r2(s.acc.z), r2(ph.steerAngle), f, Math.round(ph.rpm), ph.gear, ...w]);
      s.gate.sent(now, s.st);
    }
    if (!slot) return;
    this.npcAt = now;
    if (batch.length) this.send({ t: 'n', s: batch });
  }

  update(dt) {
    if (this.state !== 'connected') return;
    const g = this.game;
    this.sendState(dt);
    this.sendOpponents(dt);
    const cam = g.camera;
    // every other car where it is now (predicted from its newest state)
    const now = this.serverNow();
    for (const p of this.players.values()) {
      if (!p.motion.update(now, dt, p.dist < WALL_DIST ? p.limit : null)) continue;
      p.visible = now - p.motion.ts <= STALE_MS;
    }
    // level of detail: the nearest few get their real car (current ones keep it with some
    // margin so cars don't flicker at the edge), one new model per frame at most
    const ranked = this._ranked;
    ranked.length = 0;
    for (const p of this.players.values()) {
      p.dist = p.visible ? p.pos.distanceTo(cam.position) : Infinity;
      p.full = false;
      if (p.dist < FULL_DIST * (p.model ? 1.25 : 1)) ranked.push(p);
    }
    ranked.sort((a, b) => a.dist * (a.model ? 0.8 : 1) - b.dist * (b.model ? 0.8 : 1));
    let built = 0;
    for (let i = 0; i < ranked.length && i < FULL_MODELS; i++) {
      const p = ranked[i];
      if (!p.model && built++ === 0) this.buildModel(p);
      p.full = !!p.model;
    }
    // the tag layer's own size: the HUD is scaled down inside an X post
    const W = this.tagLayer.clientWidth || innerWidth,
      H = this.tagLayer.clientHeight || innerHeight;
    const nearEngines = [];
    let proxies = 0;
    const me = g.player.physics.pos;
    for (const p of this.players.values()) {
      if (p.model) {
        p.group.visible = p.full;
        if (p.full) {
          p.idle = 0;
          this.poseModel(p, dt);
        } else if ((p.idle += dt) > 15) this.dropModel(p);
      }
      if (p.visible && !p.full && p.dist < DRAW_DIST && proxies < MAX_PROXIES) {
        if (!this.proxies) g.scene.add((this.proxies = buildProxyMesh()));
        _m.compose(p.pos, p.quat, _one).multiply(p.proxyLocal);
        this.proxies.setMatrixAt(proxies, _m);
        this.proxies.setColorAt(proxies, p.color);
        proxies++;
      }
      // tyre smoke, skid marks and sand/snow tracks, like the player's own
      if (p.visible && p.dist < FX_DIST) this.wheelEffects(p, dt);
      else if (p.fxOn) this.liftEffects(p);
      // kinematic body for collisions
      if (p.visible && !g.race.running && p.pos.distanceToSquared(me) < 900) {
        p.body.pos.copy(p.pos);
        p.body.quat.copy(p.quat);
        p.body.vel.copy(p.vel);
        const imp = resolveVehiclePair(g.player.physics, p.body, true);
        if (imp > 3) g.player.physics.lastImpact = Math.max(g.player.physics.lastImpact, imp);
      }
      // nametag
      _v.copy(p.pos).y += 2.1;
      _v.project(cam);
      if (p.visible && _v.z < 1 && p.dist < TAG_DIST) {
        p.tag.style.display = 'block';
        p.tag.style.left = `${((_v.x + 1) / 2) * W}px`;
        p.tag.style.top = `${((1 - _v.y) / 2) * H}px`;
        p.tag.style.opacity = String(Math.max(0.3, 1 - p.dist / TAG_DIST));
      } else p.tag.style.display = 'none';
      if (p.visible && p.dist < 160) nearEngines.push({ p, dist: p.dist, rpm: p.rpm, pos: p.pos });
    }
    if (this.proxies) {
      this.proxies.count = proxies;
      this.proxies.instanceMatrix.needsUpdate = true;
      this.proxies.instanceColor.needsUpdate = true;
    }
    // positional engine audio for the nearest players
    nearEngines.sort((x, y) => x.dist - y.dist);
    const keep = new Set(nearEngines.slice(0, 4).map((e) => 'net' + e.p.id));
    for (const id of [...g.audio.engines.keys()]) if (id.startsWith('net') && !keep.has(id)) g.audio.removeEngine(id);
    for (const e of nearEngines.slice(0, 4)) {
      const id = 'net' + e.p.id;
      if (!g.audio.engines.has(id)) g.audio.createEngine(id, e.p.spec.sound, true, e.p.spec);
      g.audio.updateEngine(id, e.rpm, 0.5, 0, null, 0.8, e.pos);
    }
    // lobby banner countdown
    if (this.lobby && this.lobby.state === 'lobby') {
      const L = this.lobby;
      const secs = Math.max(0, Math.ceil((L.startAt - this.serverNow()) / 1000));
      const def = g.events.races.find((r) => r.id === L.ev);
      const n = L.members.length;
      const field = `${n} racer${n > 1 ? 's' : ''}${L.opponents ? ` + AI` : ''}`;
      if (L.host === this.id) this.banner.innerHTML = `HORIZON OPEN · ${escapeHtml(def?.name || '')} · ${field} · starts in ${secs}s · <kbd>J</kbd> start now`;
      else if (L.members.some((m) => m.id === this.id)) this.banner.innerHTML = `HORIZON OPEN · ${escapeHtml(def?.name || '')} · ${field} · you're in · starts in ${secs}s · <kbd>J</kbd> leave`;
      else this.banner.innerHTML = `${escapeHtml(L.hostName)} invites you to <b>${escapeHtml(def?.name || '')}</b> · ${field} · <kbd>J</kbd> join · ${secs}s`;
      this.banner.classList.add('on');
    } else if (!this.lobby) this.banner.classList.remove('on');
    // race progress
    if (g.race.running && g.race.active.online) {
      this.progTimer = (this.progTimer || 0) - dt;
      if (this.progTimer <= 0) {
        this.progTimer = 0.4;
        this.raceProgress(g.race, false);
      }
    }
  }

  // Other players' wheels for the shared tyre effects (effects.js, sand/snow): contact and
  // slip come from the sender, contact points from the car's pose here.
  wheelEffects(p, dt) {
    const fx = p.fx;
    const ph = fx.physics;
    const st = p.spec.style;
    const q = p.quat;
    const fwdX = 2 * (q.x * q.z + q.w * q.y),
      fwdZ = 1 - 2 * (q.x * q.x + q.y * q.y);
    ph.speed = Math.hypot(p.vel.x, p.vel.z);
    ph.forwardSpeed = p.vel.x * fwdX + p.vel.z * fwdZ;
    const cgZ = st.WB * p.spec.wf - st.WB / 2;
    for (let i = 0; i < 4; i++) {
      const w = ph.wheels[i];
      const code = p.w[i];
      w.contact = code >= 0;
      if (!w.contact) continue;
      w.surface = Math.floor(code / 1000);
      w.spinning = Math.floor((code % 1000) / 100) / 9;
      w.slip = (code % 100) / 50;
      w.steer = i < 2 ? p.st : 0;
      w.point.set(w.x, -p.spec.cgH, w.z - cgZ).applyQuaternion(q).add(p.pos);
    }
    this.game.effects.vehicle(fx, dt, 0.8);
    p.fxOn = true;
  }

  // end this player's skid marks and tracks (out of range, gone, or a new car)
  liftEffects(p) {
    const e = this.game.effects;
    for (let i = 0; i < 4; i++) {
      const key = p.fx.root.id * 4 + i;
      e.skids.lift(key);
      e.sand.lift(key);
      e.snow.lift(key);
    }
    p.fxOn = false;
  }

  poseModel(p, dt) {
    p.group.position.copy(p.pos);
    p.group.quaternion.copy(p.quat);
    p.model.setLodDistance?.(p.dist * 2.4);
    // wheels roll with the speed along the car's forward axis
    const q = p.quat;
    const fwdZ = 1 - 2 * (q.x * q.x + q.y * q.y);
    const fwdX = 2 * (q.x * q.z + q.w * q.y);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const sign = Math.sign(p.vel.x * fwdX + p.vel.z * fwdZ) || 1;
    for (const w of p.model.wheels) {
      w.spin.rotation.x += ((speed * sign) / w.r) * dt;
      if (w.front) w.steer.rotation.y = -p.st;
    }
    const L = p.model.lights;
    L.tailMat.emissiveIntensity = (p.f & 2 ? 1.4 : 0.5) + (p.f & 1 ? 5 : 0);
    L.headMat.emissiveIntensity = p.f & 2 ? 6 : 1.4;
    L.revMat.emissiveIntensity = p.f & 4 ? 3 : 0;
  }

  // ------------------------------------------------------------ chat
  chat(text) {
    this.send({ t: 'chat', m: text });
  }

  showChat(name, text) {
    const d = document.createElement('div');
    d.innerHTML = `<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}`;
    this.chatOverlay.appendChild(d);
    while (this.chatOverlay.children.length > 6) this.chatOverlay.firstChild.remove();
    setTimeout(() => d.remove(), 9500);
  }

  rename(name) {
    if (this.state === 'connected') {
      this.disconnect();
      setTimeout(() => this.connect(), 300);
    }
    void name;
  }

  profileChanged() {
    const cur = this.game.save.currentCar;
    this.send({ t: 'profile', car: cur.id, paint: cur.paint.color });
  }

  // ------------------------------------------------------------ online races
  // A shared race: the host opens a lobby for an event with a roster of AI opponents
  // (createRace), others join with J until it starts (the host's J starts it at once).
  // Every member races on one grid against the same opponents: the member the world picks
  // (racing.ai) simulates them and streams them, everyone else draws them.
  createRace(evId, npcs = []) {
    this.send({ t: 'rcreate', ev: evId, npcs });
  }

  // J: join an open lobby; in it, leave it; the host starts it now
  joinRace() {
    const L = this.lobby;
    if (!L || L.state !== 'lobby') return;
    if (L.host === this.id) this.send({ t: 'rgo' });
    else if (L.members.some((m) => m.id === this.id)) this.send({ t: 'rleave' });
    else this.send({ t: 'rjoin', id: L.id });
  }

  leaveRace() {
    this.send({ t: 'rleave' });
  }

  onLobby(race) {
    const wasMine = this.lobby?.members?.some((m) => m.id === this.id);
    this.lobby = race;
    const mine = race.members.some((m) => m.id === this.id);
    if (!wasMine && mine && race.host !== this.id) this.game.hud.toast('HORIZON OPEN', 'You are in the lobby — get ready!', 'purple', 3000);
    else if (!mine && race.state === 'lobby' && !this._announced?.has(race.id)) {
      (this._announced ||= new Set()).add(race.id);
      const def = this.game.events.races.find((r) => r.id === race.ev);
      this.game.hud.toast('RACE INVITE', `${race.hostName} is starting ${def?.name || 'a race'} — press J to join`, 'purple', 6000);
      this.game.audio.ui('notify');
    }
  }

  onRaceStart(m) {
    const g = this.game;
    this.racing = { id: m.id, ai: m.ai, npcs: m.npcs || [] };
    this.npcSend.clear();
    this.banner.classList.remove('on');
    this.lobby = { ...this.lobby, state: 'running' };
    if (m.ai !== this.id) this.showOpponents(this.racing.npcs);
    if (!m.grid.includes(this.id)) return; // watching, not racing
    const def = g.events.races.find((r) => r.id === m.ev);
    if (!def) return;
    g.startRace(def, false, { online: true, raceId: m.id, grid: m.grid, npcs: this.racing.npcs, startAt: m.startAt });
  }

  // The world moved the opponents to another member: take them over where they are
  // drawn now, or hand them back and draw them again.
  onRaceAI(m) {
    const R = this.racing;
    if (!R || R.id !== m.id) return;
    const was = R.ai === this.id;
    R.ai = m.ai;
    const g = this.game;
    const A = g.race.active;
    if (m.ai === this.id && !was && A?.online) {
      const prog = this.standings?.npcs || [];
      const cars = [];
      for (const npc of R.npcs) {
        const p = this.players.get(npc.id);
        if (!p?.motion.s) continue;
        const s = prog.find((x) => x.id === npc.id) || {};
        cars.push({ npc, pos: p.pos.clone(), quat: p.quat.clone(), vel: p.vel.clone(), d: s.d, lap: s.lap, done: s.done, time: s.time });
      }
      this.hideOpponents();
      this.npcSend.clear();
      g.race.adoptOpponents(cars);
      g.hud.toast('HORIZON OPEN', 'Your game now drives the AI opponents for everyone', 'cyan', 3000);
    } else if (was && m.ai !== this.id) {
      g.race.releaseOpponents();
      this.npcSend.clear();
      this.showOpponents(R.npcs);
    }
  }

  onRaceEnd(m) {
    const g = this.game;
    this.lobby = null;
    this.standings = null;
    if (g.race.running && g.race.active.online) g.onlineRaceEnded(m.results);
  }

  raceProgress(race, done) {
    const A = race.active;
    if (!A) return;
    const me = A.racers.find((r) => r.isPlayer);
    this.send({ t: 'rprog', cp: A.nextCp, lap: me.lap, d: me.dist, done: done || me.finished, time: me.time });
    if (A.authority) this.send({ t: 'rnpc', s: race.opponentProgress() });
  }

  // everyone in the race, players and opponents, in race order (this player's progress live)
  raceRows() {
    const st = this.standings;
    if (!st) return null;
    const me = this.game.race.active?.racers.find((r) => r.isPlayer);
    const rows = st.members.map((m) => (m.id === this.id && me ? { ...m, me: true, d: me.dist, done: me.finished || m.done, time: me.finished ? me.time : m.time } : m));
    for (const n of st.npcs || []) rows.push(n);
    return rows.sort((a, b) => (a.done && b.done ? a.time - b.time : a.done ? -1 : b.done ? 1 : b.d - a.d));
  }

  raceStandings() {
    if (!this.game.race.active?.online) return null;
    const rows = this.raceRows();
    return rows && rows.slice(0, 8).map((m, i) => `<div class="${m.me ? 'me' : ''}"><i>${i + 1}</i>${escapeHtml(m.name)}</div>`).join('');
  }

  racePosition() {
    const rows = this.raceRows();
    return rows ? Math.max(1, rows.findIndex((m) => m.me) + 1) : 1;
  }

  raceTotal() {
    const st = this.standings;
    return st ? st.members.length + (st.npcs?.length || 0) : 0;
  }
}
