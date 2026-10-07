// Multiplayer client: joins the shared world, state sync + interpolation, nametags, chat,
// online races. The nearest players are drawn with their real car, farther ones as one
// instanced stand-in, and the farthest only as map dots, so a full world stays cheap.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCar } from '../vehicle/carmodel.js';
import { CAR_BY_ID } from '../vehicle/carspecs.js';
import { escapeHtml } from '../game/race.js';
import { resolveVehiclePair } from '../world/colliders.js';

const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const SEND_HZ = 10;
const INTERP_DELAY = 200; // ms: two 10 Hz updates plus network jitter
const FULL_MODELS = 10; // nearest other players drawn with their real car
const FULL_DIST = 320; // m
const DRAW_DIST = 2500; // beyond this other players are map dots only
const TAG_DIST = 450;
const MAX_PROXIES = 128;
const KEEPALIVE_MS = 20000; // also runs in hidden tabs, where the frame loop stops
const HIDDEN_LEAVE_MS = 10 * 60 * 1000; // a tab left in the background gives its slot back

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
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
    this.offset = 0;
    this.rtt = 0;
    this.chatLog = [];
    this.sendTimer = 0;
    this.pingTimer = 0;
    this.retry = 0;
    this.retryTimer = null;
    this.dropTimer = null;
    this.wantOnline = true;
    this.everConnected = false;
    this.hop = false;
    this.paused = false;
    this.hiddenSince = 0;
    this.notes = { join: [], leave: [] };
    this.noteTimer = null;
    this.lobby = null;
    this.standings = null;
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
    return { state: this.state, label: labels[this.state], players: [...this.players.values()].map((p) => ({ name: p.name, car: p.car, paint: p.paint })) };
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
      this.send({ t: 'hello', name: g.save.data.name || 'Driver', car: cur.id, paint: cur.paint.color, b: BUILD, v: 2 });
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
    this.cleanupPlayers();
    // the world was full: go straight on to the next one
    if (this.hop) {
      this.hop = false;
      this.connect();
      return;
    }
    // rejoin from world 1, so after a server restart the worlds refill in order
    this.world = 1;
    if (!this.wantOnline) {
      if (this.state !== 'full' && this.state !== 'outdated') this.state = 'offline';
      return;
    }
    // Keep trying for as long as the page is open. The first retry is quick, so a server
    // restart (every deploy) passes with only a short "Reconnecting".
    this.state = this.everConnected ? 'reconnecting' : 'error';
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => this.wantOnline && this.connect(), delay);
    if (was === 'connected') {
      clearTimeout(this.dropTimer);
      this.dropTimer = setTimeout(() => {
        if (this.state === 'reconnecting') this.game.hud.toast('DISCONNECTED', 'Lost connection to the festival server — retrying', 'cyan');
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
    this.cleanupPlayers();
  }

  // Runs on a timer rather than per frame, so a hidden tab keeps its place in the world
  // for a while (the server drops silent sockets), then leaves until it is shown again.
  keepAlive() {
    if (this.state !== 'connected') return;
    if (this.hiddenSince && Date.now() - this.hiddenSince > HIDDEN_LEAVE_MS) {
      this.disconnect();
      this.paused = true;
      return;
    }
    if (document.hidden) this.send({ t: 'ping', c: Date.now() });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  cleanupPlayers() {
    for (const p of [...this.players.values()]) this.removePlayer(p.id);
    this.players.clear();
    if (this.proxies) this.proxies.count = 0;
    this.notes.join.length = this.notes.leave.length = 0;
    this.lobby = null;
    this.banner.classList.remove('on');
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
        this.offset = m.now - Date.now();
        for (const p of m.players) this.addPlayer(p);
        // a quiet rejoin after a short drop; announce first joins and world changes
        if (!this.everConnected || m.world !== this.lastWorld)
          g.hud.toast('ONLINE', `World ${m.world} · ${m.players.length} other driver${m.players.length === 1 ? '' : 's'}`, 'cyan', 3500);
        this.everConnected = true;
        this.lastWorld = m.world;
        if (m.race) this.onLobby(m.race);
        break;
      }
      case 'full':
        if (m.next) {
          this.world = m.next;
          this.hop = true;
        } else {
          this.state = 'full';
          this.wantOnline = false;
        }
        break;
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
        for (const s of m.s) {
          if (s[0] === this.id) continue;
          const p = this.players.get(s[0]);
          if (!p) continue;
          // s[15] is how long the state waited on the server, so samples keep the sender's spacing
          const t = m.now - (s[15] || 0);
          const b = p.buf;
          if (b.length && t <= b[b.length - 1].t) continue;
          b.push({ t, p: [s[1], s[2], s[3]], q: [s[4], s[5], s[6], s[7]], v: [s[8], s[9], s[10]], st: s[11], f: s[12], rpm: s[13], g: s[14] });
          if (b.length > 30) b.shift();
        }
        break;
      case 'pong': {
        const now = Date.now();
        const rtt = now - m.c;
        this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
        const off = m.now + rtt / 2 - now;
        this.offset = this.offset * 0.8 + off * 0.2;
        break;
      }
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
    const p = {
      id: info.id,
      name: info.name,
      car: info.car,
      paint: info.paint,
      buf: [],
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      vel: new THREE.Vector3(),
      color: new THREE.Color(),
      proxyLocal: new THREE.Matrix4(),
      st: 0,
      f: 0,
      rpm: 0,
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
    for (const p of this.players.values()) if (p.visible) out.push({ x: p.pos.x, z: p.pos.z, name: p.name, color: p.paint });
    return out;
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    if (this.state !== 'connected') return;
    const g = this.game;
    // send state
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / SEND_HZ) {
      this.sendTimer = 0;
      const ph = g.player.physics;
      const f = (ph.input.brake > 0.1 ? 1 : 0) | (g.env.lightsOn ? 2 : 0) | (ph.gear < 0 ? 4 : 0) | (g.race.running ? 8 : 0);
      this.send({ t: 's', p: [ph.pos.x, ph.pos.y, ph.pos.z], q: [ph.quat.x, ph.quat.y, ph.quat.z, ph.quat.w], v: [ph.vel.x, ph.vel.y, ph.vel.z], st: ph.steerAngle, f, rpm: ph.rpm, g: ph.gear });
    }
    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2;
      this.send({ t: 'ping', c: Date.now() });
    }
    const cam = g.camera;
    this.interpolate();
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
    const W = innerWidth,
      H = innerHeight;
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
      const secs = Math.max(0, Math.ceil((this.lobby.startAt - this.serverNow()) / 1000));
      const def = g.events.races.find((r) => r.id === this.lobby.ev);
      const mine = this.lobby.members.some((m) => m.id === this.id);
      this.banner.innerHTML = mine
        ? `HORIZON OPEN · ${escapeHtml(def?.name || '')} · ${this.lobby.members.length} racer${this.lobby.members.length > 1 ? 's' : ''} · starts in ${secs}s`
        : `${escapeHtml(this.lobby.hostName)} started <b>${escapeHtml(def?.name || '')}</b> · press <kbd>J</kbd> to join · ${secs}s`;
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

  // every remote car's pose at (server time - INTERP_DELAY), extrapolated briefly past the
  // newest sample; players silent for 5 s are hidden
  interpolate() {
    const renderT = this.serverNow() - INTERP_DELAY;
    for (const p of this.players.values()) {
      const b = p.buf;
      if (!b.length) continue;
      let a = null,
        c = null;
      for (let i = b.length - 1; i >= 0; i--)
        if (b[i].t <= renderT) {
          a = b[i];
          c = b[i + 1] || null;
          break;
        }
      if (!a) a = b[0];
      if (c) {
        const k = Math.min(1, (renderT - a.t) / Math.max(1, c.t - a.t));
        p.pos.set(a.p[0] + (c.p[0] - a.p[0]) * k, a.p[1] + (c.p[1] - a.p[1]) * k, a.p[2] + (c.p[2] - a.p[2]) * k);
        _q.set(a.q[0], a.q[1], a.q[2], a.q[3]);
        _q2.set(c.q[0], c.q[1], c.q[2], c.q[3]);
        p.quat.slerpQuaternions(_q, _q2, k);
      } else {
        const ex = Math.min(0.35, Math.max(0, (renderT - a.t) / 1000));
        p.pos.set(a.p[0] + a.v[0] * ex, a.p[1] + a.v[1] * ex, a.p[2] + a.v[2] * ex);
        p.quat.set(a.q[0], a.q[1], a.q[2], a.q[3]);
      }
      p.vel.set(a.v[0], a.v[1], a.v[2]);
      p.st = a.st || 0;
      p.f = a.f;
      p.rpm = a.rpm;
      p.visible = this.serverNow() - b[b.length - 1].t <= 5000;
    }
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
  createRace(evId) {
    this.send({ t: 'rcreate', ev: evId });
  }

  joinRace() {
    if (this.lobby && this.lobby.state === 'lobby') this.send({ t: 'rjoin', id: this.lobby.id });
  }

  leaveRace() {
    this.send({ t: 'rleave' });
  }

  onLobby(race) {
    const wasMine = this.lobby?.members?.some((m) => m.id === this.id);
    this.lobby = race;
    const mine = race.members.some((m) => m.id === this.id);
    if (!wasMine && mine) this.game.hud.toast('HORIZON OPEN', 'You are in the lobby — get ready!', 'purple', 3000);
    else if (!mine && race.state === 'lobby' && race.host !== this.id && !this._announced?.has(race.id)) {
      this._announced = this._announced || new Set();
      this._announced.add(race.id);
      this.game.audio.ui('notify');
    }
  }

  onRaceStart(m) {
    const g = this.game;
    const idx = m.grid.indexOf(this.id);
    this.banner.classList.remove('on');
    if (idx < 0) {
      this.lobby = { ...this.lobby, state: 'running' };
      return;
    }
    this.offset = this.offset * 0.5 + (m.now - Date.now()) * 0.5;
    const def = g.events.races.find((r) => r.id === m.ev);
    if (!def) return;
    this.lobby = { ...this.lobby, state: 'running' };
    g.startRace(def, false, { online: true, gridIndex: idx, startAt: m.startAt, gridSize: m.grid.length });
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
  }

  raceStandings() {
    if (!this.standings || !this.game.race.running || !this.game.race.active.online) return null;
    const list = [...this.standings.members].sort((a, b) => (a.done && b.done ? a.time - b.time : a.done ? -1 : b.done ? 1 : b.d - a.d));
    return list.map((m, i) => `<div class="${m.id === this.id ? 'me' : ''}"><i>${i + 1}</i>${escapeHtml(m.name)}</div>`).join('');
  }

  racePosition() {
    if (!this.standings) return 1;
    const list = [...this.standings.members].sort((a, b) => (a.done && b.done ? a.time - b.time : a.done ? -1 : b.done ? 1 : b.d - a.d));
    return Math.max(1, list.findIndex((m) => m.id === this.id) + 1);
  }
}
