// One shared multiplayer world for Horizon Remade.
// - Everyone who opens the game joins world 1. A full world answers "full" with the next
//   world's number and the client hops there, so worlds only split once one fills up.
// - Clients send their car state ~10 Hz; the world broadcasts the fresh states at TICK_HZ,
//   each stamped with its age so remote cars interpolate on the sender's timeline.
// - Chat, emotes and online race lobbies ("Horizon Open") are relayed per world.
// Transport-agnostic: the Node server (multiplayer.js) and the Cloudflare Durable Object
// (worker/index.js) both hand it sockets that only need send(text) and close(code, reason).

export const PROTOCOL = 2;
// A Durable Object handles roughly 1,000 messages/s; 80 players at 10 Hz stays under that.
export const WORLD_CAP = 80;
export const MAX_WORLDS = 32;
const TICK_HZ = 15;
// Drop sockets that went silent (dead network). Hidden tabs still ping every 20-60 s.
const IDLE_MS = 120000;
const MAX_MESSAGE = 16 * 1024;
const LOBBY_MS = 20000;
const RACE_TIMEOUT_MS = 12 * 60 * 1000;

export const CLOSE = { idle: 4000, update: 4001, full: 4002 };

const now = () => Date.now();
const clampNum = (v, lo, hi, def = 0) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const cleanText = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);

export function worldNumber(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(MAX_WORLDS, Math.max(1, n)) : 1;
}

export class World {
  constructor({ id = 1, build = 'dev', cap = WORLD_CAP, log = false, onEmpty = null } = {}) {
    this.id = id;
    this.build = build;
    this.cap = cap;
    this.log = log;
    this.onEmpty = onEmpty;
    this.sockets = new Set(); // every open connection
    this.clients = new Set(); // connections that said hello and joined the world
    this.race = null;
    this.nextId = 1;
    this.nextRace = 1;
    this.timer = null;
    this.reaper = null;
  }

  get size() {
    return this.clients.size;
  }

  stats() {
    return { world: this.id, players: this.clients.size, cap: this.cap };
  }

  // The tick only runs while someone is connected, so an empty Durable Object can sleep.
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    this.reaper = setInterval(() => this.reap(), 5000);
    if (this.timer.unref) this.timer.unref();
    if (this.reaper.unref) this.reaper.unref();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.reaper);
    this.timer = this.reaper = null;
  }

  connect(socket) {
    const t = now();
    const client = {
      id: 0,
      socket,
      name: 'Driver',
      car: 'gt',
      paint: '#ff2d87',
      state: null,
      stateT: 0,
      fresh: false,
      joined: false,
      gone: false,
      lastSeen: t,
      budget: 60,
      chatBudget: 5,
      lastBudget: t,
      race: null,
    };
    this.sockets.add(client);
    this.start();
    return client;
  }

  // Close a connection from the server side. The transport's close event may call
  // disconnect() again later; that second call is a no-op.
  close(client, code, reason) {
    this.disconnect(client);
    try {
      client.socket.close(code, reason);
    } catch {}
  }

  disconnect(client) {
    if (client.gone) return;
    client.gone = true;
    this.sockets.delete(client);
    if (client.joined) {
      this.raceLeave(client);
      this.clients.delete(client);
      this.broadcast({ t: 'leave', id: client.id });
      if (this.log) console.log(`[mp] ${client.name} left world ${this.id} (${this.clients.size} players)`);
    }
    if (this.sockets.size === 0) {
      this.stop();
      this.onEmpty?.(this);
    }
  }

  reap() {
    const t = now();
    for (const c of [...this.sockets]) if (t - c.lastSeen > IDLE_MS) this.close(c, CLOSE.idle, 'idle');
  }

  sendTo(client, obj) {
    try {
      client.socket.send(JSON.stringify(obj));
    } catch {}
  }

  broadcast(obj, except = null) {
    const data = JSON.stringify(obj);
    for (const c of this.clients)
      if (c !== except)
        try {
          c.socket.send(data);
        } catch {}
  }

  message(client, data) {
    if (client.gone) return;
    const t = now();
    client.lastSeen = t;
    // simple token bucket rate limiting
    const elapsed = (t - client.lastBudget) / 1000;
    client.lastBudget = t;
    client.budget = Math.min(60, client.budget + elapsed * 40);
    client.chatBudget = Math.min(5, client.chatBudget + elapsed * 0.5);
    if (client.budget < 1) return;
    client.budget -= 1;
    const text = typeof data === 'string' ? data : data.toString('utf8');
    if (text.length > MAX_MESSAGE) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') return this.sendTo(client, { t: 'pong', c: clampNum(msg.c, 0, 1e15), now: t });
    if (msg.t === 'hello') return this.onHello(client, msg);
    if (!client.joined) return;
    switch (msg.t) {
      case 's':
        return this.onState(client, msg);
      case 'chat': {
        if (client.chatBudget < 1) return;
        client.chatBudget -= 1;
        const m = cleanText(msg.m, 120);
        if (!m) return;
        this.broadcast({ t: 'chat', id: client.id, name: client.name, m });
        return;
      }
      case 'emote':
        this.broadcast({ t: 'emote', id: client.id, e: cleanText(msg.e, 16) }, client);
        return;
      case 'profile':
        client.car = cleanText(msg.car, 24) || client.car;
        client.paint = /^#[0-9a-fA-F]{6}$/.test(msg.paint) ? msg.paint : client.paint;
        this.broadcast({ t: 'profile', id: client.id, car: client.car, paint: client.paint }, client);
        return;
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
    if (client.joined) return;
    // A page from an older deploy would drive on a different map: ask it to reload.
    const build = cleanText(msg.b, 64) || 'dev';
    if (this.build !== 'dev' && build !== 'dev' && build !== this.build) {
      this.sendTo(client, { t: 'update', build: this.build });
      return this.close(client, CLOSE.update, 'update');
    }
    if (this.clients.size >= this.cap) {
      this.sendTo(client, { t: 'full', world: this.id, next: this.id < MAX_WORLDS ? this.id + 1 : null });
      return this.close(client, CLOSE.full, 'full');
    }
    client.id = this.nextId++;
    client.name = cleanText(msg.name, 16) || 'Driver' + client.id;
    client.car = cleanText(msg.car, 24) || 'gt';
    client.paint = /^#[0-9a-fA-F]{6}$/.test(msg.paint) ? msg.paint : '#ff2d87';
    const players = [...this.clients].map((c) => ({ id: c.id, name: c.name, car: c.car, paint: c.paint }));
    client.joined = true;
    this.clients.add(client);
    this.sendTo(client, { t: 'welcome', id: client.id, world: this.id, cap: this.cap, players, now: now(), protocol: PROTOCOL, race: this.race ? this.raceInfo(this.race) : null });
    this.broadcast({ t: 'join', p: { id: client.id, name: client.name, car: client.car, paint: client.paint } }, client);
    if (this.log) console.log(`[mp] ${client.name} joined world ${this.id} (${this.clients.size} players)`);
  }

  onState(client, m) {
    if (!Array.isArray(m.p) || !Array.isArray(m.q)) return;
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
    client.stateT = now();
    client.fresh = true;
  }

  // Each snapshot carries only states that arrived since the last tick, each with its age
  // in ms (last element), so a repeated or late sample never moves a car backwards.
  tick() {
    const t = now();
    const states = [];
    for (const c of this.clients)
      if (c.fresh) {
        c.fresh = false;
        states.push([...c.state, t - c.stateT]);
      }
    if (states.length) this.broadcast({ t: 'snap', now: t, s: states });
    if (this.race) this.raceTick(t);
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
    if (this.race) return;
    const ev = cleanText(msg.ev, 32);
    if (!ev) return;
    const r = { id: this.nextRace++, ev, host: client.id, hostName: client.name, state: 'lobby', startAt: now() + LOBBY_MS, members: new Map(), created: now() };
    this.race = r;
    r.members.set(client.id, { id: client.id, name: client.name, cp: 0, lap: 0, d: 0, done: false, time: 0 });
    client.race = r.id;
    this.broadcast({ t: 'rlobby', race: this.raceInfo(r) });
  }

  raceJoin(client, msg) {
    const r = this.race;
    if (!r || r.id !== msg.id || r.state !== 'lobby') return;
    if (r.members.size >= 12) return;
    r.members.set(client.id, { id: client.id, name: client.name, cp: 0, lap: 0, d: 0, done: false, time: 0 });
    client.race = r.id;
    this.broadcast({ t: 'rlobby', race: this.raceInfo(r) });
  }

  raceLeave(client) {
    const r = this.race;
    if (!r || !r.members.has(client.id)) return;
    r.members.delete(client.id);
    client.race = null;
    if (r.members.size === 0) {
      this.broadcast({ t: 'rend', id: r.id, results: [] });
      this.race = null;
    } else this.broadcast({ t: 'rlobby', race: this.raceInfo(r) });
  }

  raceProgress(client, msg) {
    const r = this.race;
    if (!r || !r.members.has(client.id)) return;
    const m = r.members.get(client.id);
    m.cp = clampNum(msg.cp, 0, 10000) | 0;
    m.lap = clampNum(msg.lap, 0, 100) | 0;
    m.d = clampNum(msg.d, 0, 1e6);
    if (msg.done && !m.done) {
      m.done = true;
      m.time = clampNum(msg.time, 0, 3600);
    }
  }

  raceTick(t) {
    const r = this.race;
    if (r.state === 'lobby' && t >= r.startAt - 6000) {
      r.state = 'running';
      r.startAt = t + 6000;
      const grid = [...r.members.keys()];
      this.broadcast({ t: 'rstart', id: r.id, ev: r.ev, startAt: r.startAt, grid, now: t });
    } else if (r.state === 'running') {
      if (!r._lastStand || t - r._lastStand > 500) {
        r._lastStand = t;
        this.broadcast({ t: 'rstand', race: this.raceInfo(r) });
      }
      const all = [...r.members.values()];
      const allDone = all.length > 0 && all.every((m) => m.done);
      if (allDone || t - r.startAt > RACE_TIMEOUT_MS) {
        const results = all.sort((a, b) => (a.done === b.done ? a.time - b.time : a.done ? -1 : 1)).map((m) => ({ id: m.id, name: m.name, time: m.done ? m.time : null }));
        this.broadcast({ t: 'rend', id: r.id, results });
        for (const c of this.clients) if (c.race === r.id) c.race = null;
        this.race = null;
      }
    }
  }
}
