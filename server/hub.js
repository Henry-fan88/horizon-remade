// One shared multiplayer world for Horizon Remade.
// - Everyone who opens the game joins world 1. A full world answers "full" with the next
//   world's number and the client hops there, so worlds only split once one fills up.
// - Clients send their car state when it changes (up to sendRateFor(players) Hz, stamped
//   with when it was true in server time); the world relays the fresh states at TICK_HZ,
//   each with its age, and the game predicts every car forward to "now" (src/net/sync.js).
// - Chat, emotes and online race lobbies ("Horizon Open") are relayed per world.
// Transport-agnostic: the Node server (multiplayer.js) and the Cloudflare Durable Object
// (worker/index.js) both hand it sockets that only need send(text) and close(code, reason).
import { PROTOCOL, S, STATE_LEN, sendRateFor } from './protocol.js';
import { CLIMATE_OPTIONS, pushChange, cleanLog } from '../src/world/climate.js';

export { PROTOCOL };
// A Durable Object handles roughly 1,000 messages/s; sendRateFor keeps a full world under that.
export const WORLD_CAP = 80;
export const MAX_WORLDS = 32;
const TICK_HZ = 30;
const MAX_STATE_AGE = 2000; // ms: a state claiming to be older is treated as arriving now
// Drop sockets that went silent (dead network). Hidden tabs still ping every 20-60 s.
const IDLE_MS = 120000;
const MAX_MESSAGE = 16 * 1024;
const LOBBY_MS = 20000;
const START_LEAD_MS = 6000; // from the start signal to the green light: everyone moves to the grid
const RACE_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_RACERS = 12; // grid places, players and AI opponents together
const AI_SILENT_MS = 2500; // opponents' driver this quiet mid-race: another member takes over

// AI opponents in snapshots: negative ids, unique per race and opponent
export const npcId = (raceId, i) => -(raceId * 16 + i + 1);

// When a car state was true (sender's stamp), trusted within MAX_STATE_AGE of arriving,
// never later than arrival, and always after the previous state.
const stateTime = (prev, ts, t) => Math.max(typeof ts === 'number' && isFinite(ts) ? Math.min(t, Math.max(t - MAX_STATE_AGE, ts)) : t, prev + 1);

// A car state from the wire into the snapshot layout (protocol.js S), sanitised.
function writeState(s, id, m) {
  const arr = (a, n) => (Array.isArray(a) && a.length === n ? a : null);
  const p = m.p,
    q = m.q,
    v = arr(m.v, 3) || [0, 0, 0],
    av = arr(m.av, 3) || [0, 0, 0],
    ac = arr(m.ac, 2) || [0, 0],
    w = arr(m.w, 4) || [-1, -1, -1, -1];
  const r2 = (x) => Math.round(x * 100) / 100;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  s[S.id] = id;
  s[S.pos] = r2(clampNum(p[0], -5000, 5000));
  s[S.pos + 1] = r2(clampNum(p[1], -200, 2000));
  s[S.pos + 2] = r2(clampNum(p[2], -5000, 5000));
  for (let i = 0; i < 4; i++) s[S.quat + i] = r3(clampNum(q[i], -1, 1, i === 3 ? 1 : 0));
  for (let i = 0; i < 3; i++) s[S.vel + i] = r2(clampNum(v[i], -200, 200));
  for (let i = 0; i < 3; i++) s[S.angVel + i] = r3(clampNum(av[i], -20, 20));
  for (let i = 0; i < 2; i++) s[S.acc + i] = r2(clampNum(ac[i], -40, 40));
  s[S.steer] = r2(clampNum(m.st, -1, 1));
  s[S.flags] = clampNum(m.f, 0, 255) | 0;
  s[S.rpm] = Math.round(clampNum(m.rpm, 0, 12000));
  s[S.gear] = clampNum(m.g, -1, 9) | 0;
  for (let i = 0; i < 4; i++) s[S.wheels + i] = clampNum(w[i], -1, 99999, -1) | 0;
  return s;
}

export const CLOSE = { idle: 4000, update: 4001, full: 4002, wait: 4003 };

// Settings that belong to the world, not to one player: everyone sees the same sky.
// Any player may change them (the game's settings menu); the world tells everyone.
export const WORLD_OPTIONS = {
  timeOfDay: ['dynamic', 'morning', 'noon', 'golden', 'sunset', 'night'],
  dayLength: [20, 40, 60, 120],
  weather: CLIMATE_OPTIONS.weather,
  season: CLIMATE_OPTIONS.season,
};
export const WORLD_DEFAULTS = { timeOfDay: 'dynamic', dayLength: 40, weather: 'auto', season: 'auto' };
const WORLD_CHANGE_MS = 2000; // per player, so nobody can strobe the sky
// Weather and season changes fade in (src/world/climate.js). The world keeps a short log of
// them in server time ("weatherLog", "seasonLog") so every player draws the same fade, and
// the same wet roads and lying snow afterwards.
const LOGGED = ['weather', 'season'];

export function worldSettings(input) {
  const out = { ...WORLD_DEFAULTS };
  for (const [k, options] of Object.entries(WORLD_OPTIONS)) if (input && options.includes(input[k])) out[k] = input[k];
  for (const k of LOGGED) {
    const log = cleanLog(input?.[k + 'Log'], WORLD_OPTIONS[k]);
    if (log && log[log.length - 1][0] === out[k]) out[k + 'Log'] = log;
  }
  return out;
}

// Build ids end in their build time (tools/deploy.mjs: "<sha>-<base36 ms>"), so a world can
// tell whether a page is older than its own code or newer.
export function buildTime(build) {
  const t = parseInt(String(build).split('-').pop(), 36);
  return Number.isFinite(t) ? t : 0;
}

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
  constructor({ id = 1, build = 'dev', cap = WORLD_CAP, log = false, onEmpty = null, settings = null, onSettings = null } = {}) {
    this.id = id;
    this.build = build;
    this.cap = cap;
    this.log = log;
    this.onEmpty = onEmpty;
    this.settings = worldSettings(settings);
    this.onSettings = onSettings; // the host may keep them across restarts
    this.sockets = new Set(); // every open connection
    this.clients = new Set(); // connections that said hello and joined the world
    this.race = null;
    this.nextId = 1;
    this.nextRace = 1;
    this.timer = null;
    this.reaper = null;
    this.hz = sendRateFor(0); // how fast cars may send; lowered as the world fills
  }

  // tell everyone when the world's population changes the send rate
  retune() {
    const hz = sendRateFor(this.clients.size);
    if (hz === this.hz) return;
    this.hz = hz;
    this.broadcast({ t: 'rate', hz });
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
      budget: 160,
      chatBudget: 5,
      lastBudget: t,
      race: null,
      lastWorldChange: 0,
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
      this.retune();
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
    // simple token bucket rate limiting (own state up to 30 Hz, a race's AI opponents up to
    // 20 Hz when this player drives them, pings, race progress, the odd chat)
    const elapsed = (t - client.lastBudget) / 1000;
    client.lastBudget = t;
    client.budget = Math.min(160, client.budget + elapsed * 80);
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
      case 'world':
        return this.onWorld(client, msg, t);
      case 'profile':
        client.car = cleanText(msg.car, 24) || client.car;
        client.paint = /^#[0-9a-fA-F]{6}$/.test(msg.paint) ? msg.paint : client.paint;
        this.broadcast({ t: 'profile', id: client.id, car: client.car, paint: client.paint }, client);
        return;
      case 'rcreate':
        return this.raceCreate(client, msg);
      case 'rjoin':
        return this.raceJoin(client, msg);
      case 'rgo':
        return this.raceGo(client);
      case 'rleave':
        return this.raceLeave(client);
      case 'rprog':
        return this.raceProgress(client, msg);
      case 'n':
        return this.npcStates(client, msg, t);
      case 'rnpc':
        return this.npcProgress(client, msg);
    }
  }

  onHello(client, msg) {
    if (client.joined) return;
    // A page from an older deploy would drive on a different map: ask it to reload. A page
    // newer than this world means the world itself is about to be replaced by the new
    // deploy; that page retries shortly instead.
    const build = cleanText(msg.b, 64) || 'dev';
    if (this.build !== 'dev' && build !== 'dev' && build !== this.build) {
      if (buildTime(build) > buildTime(this.build)) {
        this.sendTo(client, { t: 'wait' });
        return this.close(client, CLOSE.wait, 'wait');
      }
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
    this.retune();
    this.sendTo(client, { t: 'welcome', id: client.id, world: this.id, cap: this.cap, hz: this.hz, players, now: now(), protocol: PROTOCOL, settings: this.settings, race: this.race ? this.raceInfo(this.race) : null });
    this.broadcast({ t: 'join', p: { id: client.id, name: client.name, car: client.car, paint: client.paint } }, client);
    if (this.log) console.log(`[mp] ${client.name} joined world ${this.id} (${this.clients.size} players)`);
  }

  onWorld(client, msg, t) {
    if (t - client.lastWorldChange < WORLD_CHANGE_MS) return;
    const next = { ...this.settings };
    for (const [k, options] of Object.entries(WORLD_OPTIONS)) if (options.includes(msg[k])) next[k] = msg[k];
    if (Object.keys(WORLD_OPTIONS).every((k) => next[k] === this.settings[k])) return;
    for (const k of LOGGED) if (next[k] !== this.settings[k]) next[k + 'Log'] = pushChange(this.settings[k + 'Log'] ?? [[this.settings[k], 0]], next[k], t);
    client.lastWorldChange = t;
    this.settings = next;
    this.broadcast({ t: 'world', settings: next, by: client.name, id: client.id });
    this.onSettings?.(next);
    if (this.log) console.log(`[mp] ${client.name} changed world ${this.id}: ${JSON.stringify(next)}`);
  }

  // A car state (layout: protocol.js S). `ts` is when it was true, in server time by the
  // sender's clock; trusted within MAX_STATE_AGE of arriving, never later than arrival, and
  // always after the previous state, so other players can predict from the right moment.
  onState(client, m) {
    if (!Array.isArray(m.p) || !Array.isArray(m.q)) return;
    writeState(client.state || (client.state = new Array(STATE_LEN).fill(0)), client.id, m);
    client.stateT = stateTime(client.stateT, m.ts, now());
    client.fresh = true;
  }

  // Each snapshot carries only states that arrived since the last tick, each with its age
  // (S.age), so a repeated or late state never moves a car backwards.
  tick() {
    const t = now();
    const states = [];
    for (const c of this.clients)
      if (c.fresh) {
        c.fresh = false;
        c.state[S.age] = t - c.stateT;
        states.push(c.state);
      }
    // a race's AI opponents, as streamed by the member driving them
    if (this.race)
      for (const n of this.race.npcs)
        if (n.fresh) {
          n.fresh = false;
          n.state[S.age] = t - n.stateT;
          states.push(n.state);
        }
    if (states.length) this.broadcast({ t: 'snap', now: t, s: states });
    if (this.race) this.raceTick(t);
  }

  // ---------------------------------------------------------------- races
  // One race at a time per world. The host opens a lobby (rcreate) with a roster of AI
  // opponents, and players join (rjoin) until it starts: when the lobby times out, or at
  // once when the host says go (rgo). The grid is then the members plus as many opponents
  // as fit. One member (r.ai, the host first) drives the opponents and streams their
  // states ('n') and progress ('rnpc'). The world relays those like players' states
  // (negative ids), so everyone in the world sees the same opponents, and the standings
  // and results include them. If that member leaves or goes quiet, another takes over ('rai').
  raceInfo(r) {
    return {
      id: r.id,
      ev: r.ev,
      host: r.host,
      hostName: r.hostName,
      state: r.state,
      startAt: r.startAt,
      opponents: r.roster.length,
      ai: r.ai,
      members: [...r.members.values()].map((m) => ({ id: m.id, name: m.name, car: m.car, cp: m.cp, lap: m.lap, d: m.d, done: m.done, time: m.time })),
      npcs: r.npcs.map((n) => ({ id: n.id, i: n.i, name: n.name, car: n.car, paint: n.paint, skill: n.skill, lap: n.lap, d: n.d, done: n.done, time: n.time })),
    };
  }

  raceCreate(client, msg) {
    if (this.race) return;
    const ev = cleanText(msg.ev, 32);
    if (!ev) return;
    const roster = (Array.isArray(msg.npcs) ? msg.npcs : []).slice(0, MAX_RACERS - 1).map((n) => ({
      name: cleanText(n?.name, 16) || 'Drivatar',
      car: cleanText(n?.car, 24) || client.car,
      paint: /^#[0-9a-fA-F]{6}$/.test(n?.paint) ? n.paint : '#c81d25',
      skill: clampNum(n?.skill, 0.8, 1.05, 0.93),
    }));
    const t = now();
    const r = { id: this.nextRace++, ev, host: client.id, hostName: client.name, state: 'lobby', startAt: t + LOBBY_MS, created: t, members: new Map(), roster, npcs: [], ai: 0, aiAt: 0 };
    this.race = r;
    this.addMember(r, client);
    this.broadcast({ t: 'rlobby', race: this.raceInfo(r) });
  }

  addMember(r, client) {
    r.members.set(client.id, { id: client.id, name: client.name, car: client.car, cp: 0, lap: 0, d: 0, done: false, time: 0 });
    client.race = r.id;
  }

  raceJoin(client, msg) {
    const r = this.race;
    if (!r || r.id !== msg.id || r.state !== 'lobby' || r.members.has(client.id)) return;
    if (r.members.size >= MAX_RACERS) return;
    this.addMember(r, client);
    this.broadcast({ t: 'rlobby', race: this.raceInfo(r) });
  }

  // the host doesn't want to wait for the lobby to time out
  raceGo(client) {
    const r = this.race;
    if (r && r.state === 'lobby' && r.host === client.id) this.raceStart(r, now());
  }

  raceStart(r, t) {
    r.state = 'running';
    r.startAt = t + START_LEAD_MS;
    const grid = [...r.members.keys()];
    // opponents fill the grid up to the roster's size (the event's usual field)
    const n = Math.max(0, Math.min(r.roster.length, r.roster.length + 1 - grid.length, MAX_RACERS - grid.length));
    r.npcs = r.roster.slice(0, n).map((o, i) => ({ i, id: npcId(r.id, i), ...o, state: null, stateT: 0, fresh: false, lap: 0, d: 0, done: false, time: 0, eta: null }));
    r.ai = r.members.has(r.host) ? r.host : grid[0];
    r.aiAt = r.startAt; // quiet is allowed until the green light
    const npcs = r.npcs.map(({ i, id, name, car, paint, skill }) => ({ i, id, name, car, paint, skill }));
    this.broadcast({ t: 'rstart', id: r.id, ev: r.ev, startAt: r.startAt, grid, npcs, ai: r.ai, now: t });
  }

  // the opponents move to the next member (round the grid)
  raceHandOff(r, t) {
    const ids = [...r.members.keys()];
    if (!ids.length) return;
    const next = ids[(ids.indexOf(r.ai) + 1) % ids.length];
    if (next === r.ai) {
      r.aiAt = t; // the only member left: it keeps them
      return;
    }
    r.ai = next;
    r.aiAt = t + 1500; // time to take the cars over
    this.broadcast({ t: 'rai', id: r.id, ai: r.ai });
  }

  raceLeave(client) {
    const r = this.race;
    if (!r || !r.members.has(client.id)) return;
    r.members.delete(client.id);
    client.race = null;
    if (r.members.size === 0) return this.raceEnd(r);
    if (r.host === client.id) {
      const next = r.members.values().next().value;
      r.host = next.id;
      r.hostName = next.name;
    }
    if (r.state === 'running' && r.ai === client.id) this.raceHandOff(r, now());
    this.broadcast({ t: r.state === 'lobby' ? 'rlobby' : 'rstand', race: this.raceInfo(r) });
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

  // opponents' car states from the member driving them: [i, ts, ...state fields]
  npcStates(client, msg, t) {
    const r = this.race;
    if (!r || r.state !== 'running' || r.ai !== client.id || !Array.isArray(msg.s)) return;
    r.aiAt = t;
    for (const a of msg.s.slice(0, r.npcs.length)) {
      if (!Array.isArray(a) || a.length < 25) continue;
      const n = r.npcs[a[0] | 0];
      if (!n) continue;
      const m = { p: a.slice(2, 5), q: a.slice(5, 9), v: a.slice(9, 12), av: a.slice(12, 15), ac: a.slice(15, 17), st: a[17], f: a[18], rpm: a[19], g: a[20], w: a.slice(21, 25) };
      writeState(n.state || (n.state = new Array(STATE_LEN).fill(0)), n.id, m);
      n.stateT = stateTime(n.stateT, a[1], t);
      n.fresh = true;
    }
  }

  // opponents' race progress: [i, distance, lap, done, time, projected finish time]
  npcProgress(client, msg) {
    const r = this.race;
    if (!r || r.state !== 'running' || r.ai !== client.id || !Array.isArray(msg.s)) return;
    for (const a of msg.s) {
      const n = Array.isArray(a) ? r.npcs[a[0] | 0] : null;
      if (!n) continue;
      n.d = clampNum(a[1], 0, 1e6);
      n.lap = clampNum(a[2], 0, 100) | 0;
      if (a[3] && !n.done) {
        n.done = true;
        n.time = clampNum(a[4], 0, 3600);
      }
      n.eta = typeof a[5] === 'number' && isFinite(a[5]) ? clampNum(a[5], 0, 7200) : null;
    }
  }

  raceTick(t) {
    const r = this.race;
    if (r.state === 'lobby') {
      if (t >= r.startAt - START_LEAD_MS) this.raceStart(r, t);
      return;
    }
    if (r.npcs.some((n) => !n.done) && (!r.members.has(r.ai) || t - r.aiAt > AI_SILENT_MS)) this.raceHandOff(r, t);
    if (!r._lastStand || t - r._lastStand > 500) {
      r._lastStand = t;
      this.broadcast({ t: 'rstand', race: this.raceInfo(r) });
    }
    const humans = [...r.members.values()];
    if ((humans.length && humans.every((m) => m.done)) || t - r.startAt > RACE_TIMEOUT_MS) this.raceEnd(r, t);
  }

  // Results: finishers by time (opponents still out get their projected time, never
  // earlier than now), then the rest by distance covered.
  raceEnd(r, t = now()) {
    const elapsed = Math.max(0, (t - r.startAt) / 1000);
    const rows = [...r.members.values()].map((m) => ({ id: m.id, name: m.name, car: m.car, time: m.done ? m.time : null, d: m.d }));
    for (const n of r.npcs) {
      const eta = n.done ? n.time : n.eta == null ? null : Math.max(n.eta, elapsed);
      rows.push({ id: n.id, name: n.name, car: n.car, npc: true, time: eta, projected: !n.done && eta != null, d: n.d });
    }
    rows.sort((a, b) => (a.time != null && b.time != null ? a.time - b.time : a.time != null ? -1 : b.time != null ? 1 : b.d - a.d));
    const results = rows.map(({ d, ...row }) => row);
    this.broadcast({ t: 'rend', id: r.id, results });
    for (const c of this.clients) if (c.race === r.id) c.race = null;
    this.race = null;
  }
}
