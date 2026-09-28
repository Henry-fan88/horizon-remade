// Multiplayer relay for Horizon Remade.
// - Players are grouped into sessions ("festival sessions") of up to MAX_PER_SESSION.
// - Clients send their car state ~15 Hz; the server broadcasts compact snapshots at TICK_HZ.
// - Chat, emotes and online race lobbies ("Horizon Open") are relayed per session.
import { WebSocketServer } from 'ws';

export const PROTOCOL = 1;
const MAX_PER_SESSION = 16;
const TICK_HZ = 15;
const LOBBY_MS = 20000;
const RACE_TIMEOUT_MS = 12 * 60 * 1000;

const now = () => Date.now();
const clampNum = (v, lo, hi, def = 0) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const cleanText = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);

export function attachMultiplayer(httpServer, { path = '/ws', log = false } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  const hub = new Hub({ log });
  wss.on('connection', (ws, req) => hub.connect(ws, req));
  httpServer.on('close', () => hub.stop());
  return { wss, hub };
}

class Session {
  constructor(id) {
    this.id = id;
    this.clients = new Set();
    this.race = null;
  }
  send(obj, except = null) {
    const data = JSON.stringify(obj);
    for (const c of this.clients) if (c !== except && c.ws.readyState === 1) c.ws.send(data);
  }
}

export class Hub {
  constructor({ log = false } = {}) {
    this.log = log;
    this.sessions = new Map();
    this.nextId = 1;
    this.nextSession = 1;
    this.nextRace = 1;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    this.pinger = setInterval(() => this.heartbeat(), 10000);
    if (this.timer.unref) this.timer.unref();
    if (this.pinger.unref) this.pinger.unref();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.pinger);
  }

  stats() {
    let players = 0;
    for (const s of this.sessions.values()) players += s.clients.size;
    return { sessions: this.sessions.size, players };
  }

  connect(ws) {
    const client = {
      id: this.nextId++,
      ws,
      name: 'Driver',
      car: 'kestrel',
      paint: '#ff2d87',
      state: null,
      session: null,
      alive: true,
      budget: 60,
      chatBudget: 5,
      lastBudget: now(),
      race: null,
    };
    ws.on('message', (data) => this.onMessage(client, data));
    ws.on('close', () => this.disconnect(client));
    ws.on('error', () => {});
    ws.on('pong', () => (client.alive = true));
  }

  heartbeat() {
    for (const s of this.sessions.values())
      for (const c of s.clients) {
        if (!c.alive) {
          try {
            c.ws.terminate();
          } catch {}
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {}
      }
  }

  pickSession() {
    for (const s of this.sessions.values()) if (s.clients.size < MAX_PER_SESSION) return s;
    const s = new Session(this.nextSession++);
    this.sessions.set(s.id, s);
    return s;
  }

  onMessage(client, data) {
    // simple token bucket rate limiting
    const t = now();
    const elapsed = (t - client.lastBudget) / 1000;
    client.lastBudget = t;
    client.budget = Math.min(60, client.budget + elapsed * 40);
    client.chatBudget = Math.min(5, client.chatBudget + elapsed * 0.5);
    if (client.budget < 1) return;
    client.budget -= 1;
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'hello':
        return this.onHello(client, msg);
      case 's':
        return this.onState(client, msg);
      case 'ping':
        return this.sendTo(client, { t: 'pong', c: clampNum(msg.c, 0, 1e15), now: now() });
      case 'chat': {
        if (!client.session || client.chatBudget < 1) return;
        client.chatBudget -= 1;
        const m = cleanText(msg.m, 120);
        if (!m) return;
        client.session.send({ t: 'chat', id: client.id, name: client.name, m });
        return;
      }
      case 'emote': {
        if (!client.session) return;
        client.session.send({ t: 'emote', id: client.id, e: cleanText(msg.e, 16) }, client);
        return;
      }
      case 'profile': {
        if (!client.session) return;
        client.car = cleanText(msg.car, 24) || client.car;
        client.paint = /^#[0-9a-fA-F]{6}$/.test(msg.paint) ? msg.paint : client.paint;
        client.session.send({ t: 'profile', id: client.id, car: client.car, paint: client.paint }, client);
        return;
      }
      case 'rcreate':
        return this.raceCreate(client, msg);
      case 'rjoin':
        return this.raceJoin(client, msg);
      case 'rleave':
        return this.raceLeave(client);
      case 'rprog':
        return this.raceProgress(client, msg);
    }
  }

  onHello(client, msg) {
    if (client.session) return;
    client.name = cleanText(msg.name, 16) || 'Driver' + client.id;
    client.car = cleanText(msg.car, 24) || 'kestrel';
    client.paint = /^#[0-9a-fA-F]{6}$/.test(msg.paint) ? msg.paint : '#ff2d87';
    const s = this.pickSession();
    client.session = s;
    const players = [...s.clients].map((c) => ({ id: c.id, name: c.name, car: c.car, paint: c.paint }));
    s.clients.add(client);
    this.sendTo(client, { t: 'welcome', id: client.id, sid: s.id, players, now: now(), protocol: PROTOCOL, race: s.race ? this.raceInfo(s.race) : null });
    s.send({ t: 'join', p: { id: client.id, name: client.name, car: client.car, paint: client.paint } }, client);
    if (this.log) console.log(`[mp] ${client.name} joined session ${s.id} (${s.clients.size} players)`);
  }

  onState(client, m) {
    if (!client.session || !Array.isArray(m.p) || !Array.isArray(m.q)) return;
    const p = m.p,
      q = m.q,
      v = Array.isArray(m.v) ? m.v : [0, 0, 0];
    const r2 = (x) => Math.round(x * 100) / 100;
    const r3 = (x) => Math.round(x * 1000) / 1000;
    client.state = [
      client.id,
      r2(clampNum(p[0], -5000, 5000)),
      r2(clampNum(p[1], -200, 2000)),
      r2(clampNum(p[2], -5000, 5000)),
      r3(clampNum(q[0], -1, 1)),
      r3(clampNum(q[1], -1, 1)),
      r3(clampNum(q[2], -1, 1)),
      r3(clampNum(q[3], -1, 1, 1)),
      r2(clampNum(v[0], -200, 200)),
      r2(clampNum(v[1], -200, 200)),
      r2(clampNum(v[2], -200, 200)),
      r2(clampNum(m.st, -1, 1)),
      clampNum(m.f, 0, 255) | 0,
      Math.round(clampNum(m.rpm, 0, 12000)),
      clampNum(m.g, -1, 9) | 0,
    ];
  }

  disconnect(client) {
    const s = client.session;
    if (!s) return;
    this.raceLeave(client);
    s.clients.delete(client);
    s.send({ t: 'leave', id: client.id });
    if (this.log) console.log(`[mp] ${client.name} left session ${s.id}`);
    if (s.clients.size === 0) this.sessions.delete(s.id);
    client.session = null;
  }

  sendTo(client, obj) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(obj));
  }

  tick() {
    const t = now();
    for (const s of this.sessions.values()) {
      const states = [];
      for (const c of s.clients) if (c.state) states.push(c.state);
      if (states.length) s.send({ t: 'snap', now: t, s: states });
      if (s.race) this.raceTick(s, t);
    }
  }

  // ---------------------------------------------------------------- races
  raceInfo(r) {
    return {
      id: r.id,
      ev: r.ev,
      host: r.host,
      hostName: r.hostName,
      state: r.state,
      startAt: r.startAt,
      members: [...r.members.values()].map((m) => ({ id: m.id, name: m.name, cp: m.cp, lap: m.lap, d: m.d, done: m.done, time: m.time })),
    };
  }

  raceCreate(client, msg) {
    const s = client.session;
    if (!s || s.race) return;
    const ev = cleanText(msg.ev, 32);
    if (!ev) return;
    const r = { id: this.nextRace++, ev, host: client.id, hostName: client.name, state: 'lobby', startAt: now() + LOBBY_MS, members: new Map(), created: now() };
    s.race = r;
    r.members.set(client.id, { id: client.id, name: client.name, cp: 0, lap: 0, d: 0, done: false, time: 0 });
    client.race = r.id;
    s.send({ t: 'rlobby', race: this.raceInfo(r) });
  }

  raceJoin(client, msg) {
    const s = client.session;
    if (!s || !s.race || s.race.id !== msg.id || s.race.state !== 'lobby') return;
    if (s.race.members.size >= 12) return;
    s.race.members.set(client.id, { id: client.id, name: client.name, cp: 0, lap: 0, d: 0, done: false, time: 0 });
    client.race = s.race.id;
    s.send({ t: 'rlobby', race: this.raceInfo(s.race) });
  }

  raceLeave(client) {
    const s = client.session;
    if (!s || !s.race || !s.race.members.has(client.id)) return;
    s.race.members.delete(client.id);
    client.race = null;
    if (s.race.members.size === 0) {
      s.send({ t: 'rend', id: s.race.id, results: [] });
      s.race = null;
    } else s.send({ t: 'rlobby', race: this.raceInfo(s.race) });
  }

  raceProgress(client, msg) {
    const s = client.session;
    if (!s || !s.race || !s.race.members.has(client.id)) return;
    const m = s.race.members.get(client.id);
    m.cp = clampNum(msg.cp, 0, 10000) | 0;
    m.lap = clampNum(msg.lap, 0, 100) | 0;
    m.d = clampNum(msg.d, 0, 1e6);
    if (msg.done && !m.done) {
      m.done = true;
      m.time = clampNum(msg.time, 0, 3600);
    }
  }

  raceTick(s, t) {
    const r = s.race;
    if (r.state === 'lobby' && t >= r.startAt - 6000) {
      r.state = 'running';
      r.startAt = t + 6000;
      const grid = [...r.members.keys()];
      s.send({ t: 'rstart', id: r.id, ev: r.ev, startAt: r.startAt, grid, now: t });
    } else if (r.state === 'running') {
      if (!r._lastStand || t - r._lastStand > 500) {
        r._lastStand = t;
        s.send({ t: 'rstand', race: this.raceInfo(r) });
      }
      const all = [...r.members.values()];
      const allDone = all.length > 0 && all.every((m) => m.done);
      if (allDone || t - r.startAt > RACE_TIMEOUT_MS) {
        const results = all.sort((a, b) => (a.done === b.done ? a.time - b.time : a.done ? -1 : 1)).map((m) => ({ id: m.id, name: m.name, time: m.done ? m.time : null }));
        s.send({ t: 'rend', id: r.id, results });
        for (const c of s.clients) if (c.race === r.id) c.race = null;
        s.race = null;
      }
    }
  }
}
