// Multiplayer client: session join, state sync + interpolation, nametags, chat, online races.
import * as THREE from 'three';
import { buildCar } from '../vehicle/carmodel.js';
import { CAR_BY_ID } from '../vehicle/carspecs.js';
import { escapeHtml } from '../game/race.js';
import { resolveVehiclePair } from '../world/colliders.js';

const SEND_HZ = 15;
const INTERP_DELAY = 140; // ms

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

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

export class NetClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.state = 'offline';
    this.id = null;
    this.sid = null;
    this.players = new Map();
    this.offset = 0;
    this.rtt = 0;
    this.chatLog = [];
    this.sendTimer = 0;
    this.pingTimer = 0;
    this.retry = 0;
    this.wantOnline = true;
    this.lobby = null;
    this.standings = null;
    this.tagLayer = document.createElement('div');
    this.tagLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    document.getElementById('ui').appendChild(this.tagLayer);
    this.banner = document.createElement('div');
    this.banner.className = 'lobby-banner';
    document.getElementById('ui').appendChild(this.banner);
    this.chatOverlay = document.createElement('div');
    this.chatOverlay.className = 'chat-overlay';
    document.getElementById('ui').appendChild(this.chatOverlay);
  }

  url() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    const env = import.meta.env?.VITE_WS_URL;
    if (env) return env;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  status() {
    const labels = { offline: 'Offline — playing solo', connecting: 'Connecting to the festival server…', connected: `Online · Session ${this.sid ?? ''} · ${Math.round(this.rtt)} ms`, error: 'No server found — playing solo' };
    return { state: this.state, label: labels[this.state], players: [...this.players.values()].map((p) => ({ name: p.name, car: p.car, paint: p.paint })) };
  }

  connect(manual = false) {
    if (this.ws && (this.state === 'connecting' || this.state === 'connected')) return;
    if (location.protocol === 'file:') return;
    this.wantOnline = true;
    this.state = 'connecting';
    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.state = 'error';
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const g = this.game;
      const cur = g.save.currentCar;
      this.send({ t: 'hello', name: g.save.data.name || 'Driver', car: cur.id, paint: cur.paint.color, v: 1 });
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
    ws.onclose = () => {
      const was = this.state;
      this.state = was === 'connected' ? 'offline' : 'error';
      this.cleanupPlayers();
      this.ws = null;
      if (was === 'connected') this.game.hud.toast('DISCONNECTED', 'Lost connection to the festival server', 'cyan');
      if (this.wantOnline && this.retry < 6) {
        this.retry++;
        setTimeout(() => this.wantOnline && this.connect(), 2000 * this.retry);
      }
    };
    ws.onerror = () => {};
    void manual;
  }

  disconnect() {
    this.wantOnline = false;
    if (this.ws) this.ws.close();
    this.state = 'offline';
    this.cleanupPlayers();
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  cleanupPlayers() {
    for (const p of this.players.values()) this.removePlayer(p.id);
    this.players.clear();
    this.lobby = null;
    this.banner.classList.remove('on');
  }

  onMessage(m) {
    const g = this.game;
    switch (m.t) {
      case 'welcome':
        this.state = 'connected';
        this.id = m.id;
        this.sid = m.sid;
        this.offset = m.now - Date.now();
        for (const p of m.players) this.addPlayer(p);
        g.hud.toast('ONLINE', `Joined festival session ${m.sid} · ${m.players.length} other driver${m.players.length === 1 ? '' : 's'}`, 'cyan', 3500);
        if (m.race) this.onLobby(m.race);
        break;
      case 'join':
        this.addPlayer(m.p);
        g.hud.toast(`${m.p.name} joined`, 'A new driver arrived at the festival', 'cyan', 2500);
        break;
      case 'leave': {
        const p = this.players.get(m.id);
        if (p) g.hud.toast(`${p.name} left`, '', 'cyan', 2000);
        this.removePlayer(m.id);
        break;
      }
      case 'snap':
        for (const s of m.s) {
          if (s[0] === this.id) continue;
          const p = this.players.get(s[0]);
          if (!p) continue;
          p.buf.push({ t: m.now, p: [s[1], s[2], s[3]], q: [s[4], s[5], s[6], s[7]], v: [s[8], s[9], s[10]], st: s[11], f: s[12], rpm: s[13], g: s[14] });
          if (p.buf.length > 30) p.buf.shift();
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

  // ------------------------------------------------------------ players
  addPlayer(info) {
    if (info.id === this.id || this.players.has(info.id)) return;
    const p = { id: info.id, name: info.name, car: info.car, paint: info.paint, buf: [], group: null, model: null, body: null, tag: null, visible: false };
    this.players.set(info.id, p);
    this.rebuildPlayer(p);
  }

  rebuildPlayer(p) {
    const g = this.game;
    if (p.group) g.scene.remove(p.group);
    const spec = CAR_BY_ID[p.car] || CAR_BY_ID.gt;
    p.spec = spec;
    const model = buildCar(spec.style, { color: p.paint });
    const group = new THREE.Group();
    model.group.position.set(0, -spec.cgH, -(spec.style.WB * spec.wf - spec.style.WB / 2));
    group.add(model.group);
    model.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    g.scene.add(group);
    group.visible = false;
    p.group = group;
    p.model = model;
    p.body = new RemoteBody(spec);
    if (!p.tag) {
      p.tag = document.createElement('div');
      p.tag.className = 'nametag';
      this.tagLayer.appendChild(p.tag);
    }
    p.tag.innerHTML = `${escapeHtml(p.name)}<small>${escapeHtml(spec.name)}</small>`;
    p.tag.style.borderBottomColor = p.paint;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.group) this.game.scene.remove(p.group);
    if (p.model) {
      p.model.dispose();
      p.model.paintMat.dispose();
    }
    p.tag?.remove();
    this.game.audio.removeEngine('net' + id);
    this.players.delete(id);
  }

  remoteGroups() {
    const out = [];
    for (const p of this.players.values()) if (p.group) out.push(p.group);
    return out;
  }

  mapPlayers() {
    const out = [];
    for (const p of this.players.values()) if (p.visible) out.push({ x: p.group.position.x, z: p.group.position.z, name: p.name, color: p.paint });
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
    // interpolate remote players
    const renderT = this.serverNow() - INTERP_DELAY;
    const cam = g.camera;
    const W = innerWidth,
      H = innerHeight;
    const nearEngines = [];
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
      const pos = p.group.position;
      if (c) {
        const k = Math.min(1, (renderT - a.t) / Math.max(1, c.t - a.t));
        pos.set(a.p[0] + (c.p[0] - a.p[0]) * k, a.p[1] + (c.p[1] - a.p[1]) * k, a.p[2] + (c.p[2] - a.p[2]) * k);
        _q.set(a.q[0], a.q[1], a.q[2], a.q[3]);
        _q2.set(c.q[0], c.q[1], c.q[2], c.q[3]);
        p.group.quaternion.slerpQuaternions(_q, _q2, k);
      } else {
        const ex = Math.min(0.35, Math.max(0, (renderT - a.t) / 1000));
        pos.set(a.p[0] + a.v[0] * ex, a.p[1] + a.v[1] * ex, a.p[2] + a.v[2] * ex);
        p.group.quaternion.set(a.q[0], a.q[1], a.q[2], a.q[3]);
      }
      const latest = b[b.length - 1];
      const stale = this.serverNow() - latest.t > 5000;
      p.visible = !stale;
      p.group.visible = !stale;
      // wheels
      const speed = Math.hypot(a.v[0], a.v[2]);
      const fwdSign = Math.sign(a.v[0] * 2 * (p.group.quaternion.x * p.group.quaternion.z + p.group.quaternion.w * p.group.quaternion.y) + a.v[2] * (1 - 2 * (p.group.quaternion.x ** 2 + p.group.quaternion.y ** 2)) || 1);
      for (const w of p.model.wheels) {
        w.spin.rotation.x += ((speed * fwdSign) / w.r) * dt;
        if (w.front) w.steer.rotation.y = -(a.st || 0);
      }
      const L = p.model.lights;
      L.tailMat.emissiveIntensity = (a.f & 2 ? 1.4 : 0.5) + (a.f & 1 ? 5 : 0);
      L.headMat.emissiveIntensity = a.f & 2 ? 6 : 1.4;
      L.revMat.emissiveIntensity = a.f & 4 ? 3 : 0;
      // kinematic body for collisions
      p.body.pos.copy(pos);
      p.body.quat.copy(p.group.quaternion);
      p.body.vel.set(a.v[0], a.v[1], a.v[2]);
      if (p.group.visible && !g.race.running) {
        const imp = resolveVehiclePair(g.player.physics, p.body, true);
        if (imp > 3) g.player.physics.lastImpact = Math.max(g.player.physics.lastImpact, imp);
      }
      // nametag
      _v.copy(pos).y += 2.1;
      const dist = _v.distanceTo(cam.position);
      _v.project(cam);
      if (p.group.visible && _v.z < 1 && dist < 450) {
        p.tag.style.display = 'block';
        p.tag.style.left = `${((_v.x + 1) / 2) * W}px`;
        p.tag.style.top = `${((1 - _v.y) / 2) * H}px`;
        p.tag.style.opacity = String(Math.max(0.3, 1 - dist / 450));
      } else p.tag.style.display = 'none';
      if (p.group.visible && dist < 160) nearEngines.push({ p, dist, rpm: a.rpm, pos });
    }
    // positional engine audio for the nearest players
    nearEngines.sort((x, y) => x.dist - y.dist);
    const keep = new Set(nearEngines.slice(0, 4).map((e) => 'net' + e.p.id));
    for (const id of [...g.audio.engines.keys()]) if (id.startsWith('net') && !keep.has(id)) g.audio.removeEngine(id);
    for (const e of nearEngines.slice(0, 4)) {
      const id = 'net' + e.p.id;
      if (!g.audio.engines.has(id)) g.audio.createEngine(id, e.p.spec.sound, true);
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
