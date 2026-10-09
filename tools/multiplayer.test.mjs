import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { World, CLOSE, MAX_WORLDS, worldNumber } from '../server/hub.js';
import { attachMultiplayer } from '../server/multiplayer.js';
import { S, sendRateFor } from '../server/protocol.js';
import { worldHour } from '../src/world/sky.js';

// A socket double that records what the world sends it.
function sock() {
  return {
    sent: [],
    closed: null,
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
    last(t) {
      return this.sent.filter((m) => m.t === t).at(-1);
    },
  };
}

function join(world, name, extra = {}) {
  const s = sock();
  const c = world.connect(s);
  world.message(c, JSON.stringify({ t: 'hello', name, car: 'gt', paint: '#123456', b: 'dev', ...extra }));
  return { s, c };
}

const state = (x, w) => JSON.stringify({ t: 's', p: [x, 2, 3], q: [0, 0, 0, 1], v: [1, 0, 0], st: 0.1, f: 2, rpm: 3000, g: 3, w });

test('players in one world see each other join, move and leave', (t) => {
  const w = new World({ id: 1 });
  t.after(() => w.stop());
  const a = join(w, 'Ann');
  const b = join(w, 'Bob');
  assert.equal(a.s.last('welcome').world, 1);
  assert.deepEqual(
    b.s.last('welcome').players.map((p) => p.name),
    ['Ann']
  );
  assert.equal(a.s.last('join').p.name, 'Bob');
  // drifting on asphalt (surface 8): rear wheels spin and slide, a front wheel is airborne
  w.message(a.c, state(10, [8012, -1, 8960, 8999]));
  w.tick();
  const snap = b.s.last('snap');
  assert.equal(snap.s.length, 1);
  assert.equal(snap.s[0][S.id], a.c.id);
  assert.equal(snap.s[0][S.pos], 10);
  assert.deepEqual(snap.s[0].slice(S.wheels, S.wheels + 4), [8012, -1, 8960, 8999], 'wheel codes for tyre smoke');
  assert.ok(snap.s[0][S.age] >= 0 && snap.s[0][S.age] < 1000, 'the state age in ms');
  // a state is only broadcast once: a silent player is not re-sent with a newer timestamp
  b.s.sent.length = 0;
  w.tick();
  assert.equal(b.s.last('snap'), undefined);
  w.disconnect(a.c);
  assert.equal(b.s.last('leave').id, a.c.id);
  assert.equal(w.size, 1);
});

test('a full world sends newcomers on to the next world', (t) => {
  const w = new World({ id: 3, cap: 2 });
  t.after(() => w.stop());
  join(w, 'A');
  join(w, 'B');
  const c = join(w, 'C');
  assert.deepEqual(c.s.last('full'), { t: 'full', world: 3, next: 4 });
  assert.equal(c.s.closed.code, CLOSE.full);
  assert.equal(w.size, 2);
  const last = new World({ id: MAX_WORLDS, cap: 0 });
  t.after(() => last.stop());
  assert.equal(join(last, 'D').s.last('full').next, null);
});

test('an older page is asked to reload, a newer page waits for the redeployed world', (t) => {
  const id = (sha, ms) => `${sha}-${ms.toString(36)}`;
  const build = id('abc1234', 1760000000000);
  const w = new World({ build });
  t.after(() => w.stop());
  const old = join(w, 'Old', { b: id('9f9f9f9', 1759990000000) });
  assert.equal(old.s.last('update').build, build);
  assert.equal(old.s.closed.code, CLOSE.update);
  // after a deploy the page can briefly be newer than the world that is being replaced
  const newer = join(w, 'Newer', { b: id('def5678-dirty', 1760000500000) });
  assert.ok(newer.s.last('wait') && !newer.s.last('update'));
  assert.equal(newer.s.closed.code, CLOSE.wait);
  assert.ok(join(w, 'Same', { b: build }).s.last('welcome'));
  assert.ok(join(w, 'Dev', { b: 'dev' }).s.last('welcome'));
  assert.equal(w.size, 2);
});

test('silent connections are dropped and the world stops ticking when empty', (t) => {
  let emptied = 0;
  const w = new World({ onEmpty: () => emptied++ });
  t.after(() => w.stop());
  const a = join(w, 'Idle');
  assert.ok(w.timer, 'ticks while someone is connected');
  a.c.lastSeen -= 121000;
  w.reap();
  assert.equal(a.s.closed.code, CLOSE.idle);
  assert.equal(w.size, 0);
  assert.equal(w.timer, null);
  assert.equal(emptied, 1);
  w.disconnect(a.c); // the transport's own close event later is harmless
  assert.equal(emptied, 1);
});

test('nothing but ping works before hello; garbage and floods are ignored', (t) => {
  const w = new World();
  t.after(() => w.stop());
  const s = sock();
  const c = w.connect(s);
  w.message(c, state(1));
  w.message(c, JSON.stringify({ t: 'chat', m: 'hi' }));
  w.message(c, '{not json');
  w.message(c, 'x'.repeat(20000));
  w.message(c, JSON.stringify({ t: 'ping', c: 5 }));
  assert.deepEqual(
    s.sent.map((m) => m.t),
    ['pong']
  );
  const b = join(w, 'Spam');
  for (let i = 0; i < 200; i++) w.message(b.c, JSON.stringify({ t: 'chat', m: 'spam ' + i }));
  assert.ok(b.s.sent.filter((m) => m.t === 'chat').length <= 5, 'chat is rate limited');
});

test('online race lobby still runs inside a world', (t) => {
  const w = new World();
  t.after(() => w.stop());
  const a = join(w, 'Host');
  const b = join(w, 'Guest');
  w.message(a.c, JSON.stringify({ t: 'rcreate', ev: 'costa-ring' }));
  const lobby = b.s.last('rlobby').race;
  w.message(b.c, JSON.stringify({ t: 'rjoin', id: lobby.id }));
  assert.equal(a.s.last('rlobby').race.members.length, 2);
  w.race.startAt = Date.now();
  w.tick();
  assert.deepEqual(a.s.last('rstart').grid, [a.c.id, b.c.id]);
  w.message(a.c, JSON.stringify({ t: 'rprog', cp: 9, lap: 1, d: 900, done: true, time: 61.5 }));
  w.message(b.c, JSON.stringify({ t: 'rprog', cp: 9, lap: 1, d: 900, done: true, time: 63 }));
  w.tick();
  assert.deepEqual(
    b.s.last('rend').results.map((r) => r.name),
    ['Host', 'Guest']
  );
});

test('the world clock gives every player the same hour at the old pace', () => {
  const t0 = Date.UTC(2026, 9, 7, 12);
  assert.equal(worldHour(t0), worldHour(t0), 'a pure function of time');
  // rate in game hours per real second at a given hour
  const rateAt = (hour) => {
    let t = t0;
    while (Math.abs(worldHour(t) - hour) > 0.02) t += 1000;
    return (worldHour(t + 2000) - worldHour(t)) / 2;
  };
  assert.ok(Math.abs(rateAt(12) - 1 / 60) < 1e-4, '24-minute day: a game hour is a real minute');
  assert.ok(Math.abs(rateAt(2) - 3 / 60) < 1e-4, 'nights pass 3x faster');
  // the hour only moves forward between midnights, and repeats exactly one cycle later
  const midnights = [];
  let prev = worldHour(t0);
  for (let i = 1; i <= 2 * 24 * 60 && midnights.length < 2; i++) {
    const h = worldHour(t0 + i * 1000);
    if (h < prev) midnights.push(i);
    else assert.ok(h - prev < 0.06);
    prev = h;
  }
  const cycleMs = (midnights[1] - midnights[0]) * 1000;
  assert.ok(cycleMs > 12 * 60000 && cycleMs < 24 * 60000, `a day with fast nights lasts ${cycleMs / 60000} min`);
  assert.ok(Math.abs(worldHour(t0 + cycleMs) - worldHour(t0)) < 0.02);
  const h = worldHour(-123456789);
  assert.ok(h >= 0 && h < 24, 'negative times stay in range');
});

test('wheel codes are sanitised; a state without them reads as airborne', (t) => {
  const w = new World();
  t.after(() => w.stop());
  const a = join(w, 'A');
  const b = join(w, 'B');
  w.message(a.c, state(1));
  w.tick();
  assert.deepEqual(b.s.last('snap').s[0].slice(S.wheels, S.wheels + 4), [-1, -1, -1, -1]);
  w.message(a.c, state(2, [1e9, 'x', -50, 3.7]));
  w.tick();
  assert.deepEqual(b.s.last('snap').s[0].slice(S.wheels, S.wheels + 4), [99999, -1, -1, 3]);
});

test('world settings: anyone can change them, everyone gets them, joiners too', (t) => {
  const saved = [];
  const w = new World({ settings: { timeOfDay: 'night', dayLength: 'bogus' }, onSettings: (s) => saved.push(s) });
  t.after(() => w.stop());
  const D = { weather: 'auto', season: 'auto' }; // the weather and the season stay automatic
  const a = join(w, 'Ann');
  assert.deepEqual(a.s.last('welcome').settings, { timeOfDay: 'night', dayLength: 40, ...D }, 'restored, invalid values fall back');
  const b = join(w, 'Bob');
  w.message(b.c, JSON.stringify({ t: 'world', timeOfDay: 'sunset' }));
  assert.deepEqual(a.s.last('world'), { t: 'world', settings: { timeOfDay: 'sunset', dayLength: 40, ...D }, by: 'Bob', id: b.c.id });
  assert.equal(b.s.last('world').settings.timeOfDay, 'sunset', 'the changer hears it back');
  assert.deepEqual(saved.at(-1), { timeOfDay: 'sunset', dayLength: 40, ...D }, 'the host can keep it');
  // too soon for Bob again, invalid values and no-op changes are ignored
  w.message(b.c, JSON.stringify({ t: 'world', timeOfDay: 'noon' }));
  w.message(a.c, JSON.stringify({ t: 'world', timeOfDay: 'midnight', dayLength: 7 }));
  w.message(a.c, JSON.stringify({ t: 'world', timeOfDay: 'sunset' }));
  assert.equal(w.settings.timeOfDay, 'sunset');
  assert.equal(saved.length, 1);
  w.message(a.c, JSON.stringify({ t: 'world', dayLength: 120 }));
  assert.deepEqual(w.settings, { timeOfDay: 'sunset', dayLength: 120, ...D });
  assert.deepEqual(join(w, 'Cat').s.last('welcome').settings, { timeOfDay: 'sunset', dayLength: 120, ...D });
  const outsider = w.connect(sock());
  w.message(outsider, JSON.stringify({ t: 'world', timeOfDay: 'noon' }));
  assert.equal(w.settings.timeOfDay, 'sunset', 'only players in the world');
});

test('weather and season changes are logged in server time so everyone fades them alike', (t) => {
  const saved = [];
  const w = new World({ onSettings: (s) => saved.push(s) });
  t.after(() => w.stop());
  const a = join(w, 'Ann');
  const b = join(w, 'Bob');
  const t0 = Date.now();
  w.message(a.c, JSON.stringify({ t: 'world', weather: 'storm' }));
  const s1 = b.s.last('world').settings;
  assert.equal(s1.weather, 'storm');
  assert.equal(s1.weatherLog.length, 2, 'the previous value and the change');
  assert.deepEqual(s1.weatherLog[0], ['auto', 0]);
  assert.equal(s1.weatherLog[1][0], 'storm');
  assert.ok(s1.weatherLog[1][1] >= t0 && s1.weatherLog[1][1] <= Date.now(), 'stamped with the server clock');
  assert.equal(s1.seasonLog, undefined, 'the season did not change');
  w.message(b.c, JSON.stringify({ t: 'world', season: 'winter', weather: 'snow' }));
  const s2 = a.s.last('world').settings;
  assert.deepEqual(s2.weatherLog.map((e) => e[0]), ['auto', 'storm', 'snow']);
  assert.deepEqual(s2.seasonLog.map((e) => e[0]), ['auto', 'winter']);
  // a joiner gets the logs too, and a restart keeps them (bad entries dropped)
  assert.deepEqual(join(w, 'Cat').s.last('welcome').settings.weatherLog, s2.weatherLog);
  const restored = new World({ settings: { ...saved.at(-1), seasonLog: [['winter', 5], ['bogus', 9]] } });
  t.after(() => restored.stop());
  assert.deepEqual(restored.settings.weatherLog, s2.weatherLog);
  assert.deepEqual(restored.settings.seasonLog, [['winter', 5]], 'unknown entries are dropped');
  const stale = new World({ settings: { ...saved.at(-1), seasonLog: [['summer', 5]] } });
  t.after(() => stale.stop());
  assert.equal(stale.settings.seasonLog, undefined, 'a log that does not end in the current value is dropped');
  w.message(a.c, JSON.stringify({ t: 'world', weather: 'drizzle' }));
  assert.equal(w.settings.weather, 'snow', 'unknown weather is ignored');
});

test('Node server keeps a world\'s settings after it empties', async (t) => {
  const server = http.createServer();
  attachMultiplayer(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const session = (fn) =>
    new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: 'S', b: 'dev' }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') {
          fn(ws, m);
          setTimeout(() => (ws.close(), resolve(m)), 100);
        }
      };
    });
  await session((ws) => ws.send(JSON.stringify({ t: 'world', timeOfDay: 'golden' })));
  await new Promise((r) => setTimeout(r, 100));
  const later = await session(() => {});
  assert.equal(later.settings.timeOfDay, 'golden');
});

test('states carry when they were true: trusted within limits, always moving forward', (t) => {
  const w = new World();
  t.after(() => w.stop());
  const a = join(w, 'A');
  const b = join(w, 'B');
  const send = (ts) => w.message(a.c, JSON.stringify({ t: 's', ts, p: [1, 2, 3], q: [0, 0, 0, 1], v: [1, 0, 0], av: [0, 0.5, 0], ac: [2, -1] }));
  const sent = () => {
    w.tick();
    const snap = b.s.last('snap');
    return { when: snap.now - snap.s[0][S.age], e: snap.s[0] };
  };
  const t0 = Date.now();
  send(t0 - 300);
  let r = sent();
  assert.ok(Math.abs(r.when - (t0 - 300)) <= 1, 'the sender stamped it 300 ms ago');
  assert.deepEqual(r.e.slice(S.angVel, S.angVel + 3), [0, 0.5, 0]);
  assert.deepEqual(r.e.slice(S.acc, S.acc + 2), [2, -1]);
  send(Date.now() + 5000);
  r = sent();
  assert.ok(r.when <= Date.now(), 'never later than it arrived');
  send(Date.now() - 60000);
  r = sent();
  assert.ok(r.when > Date.now() - 2100, 'at most 2 s old');
  const before = r.when;
  send(before - 500);
  r = sent();
  assert.ok(r.when > before, 'never earlier than the previous state');
  send(undefined);
  assert.ok(Math.abs(sent().when - Date.now()) < 50, 'no stamp: its arrival');
});

test('cars may send faster in a small world, slower as it fills', (t) => {
  assert.equal(sendRateFor(1), 30);
  assert.equal(sendRateFor(30), 30);
  assert.equal(sendRateFor(45), 20);
  assert.equal(sendRateFor(80), 11);
  assert.equal(sendRateFor(500), 10);
  const w = new World({ cap: 100 });
  t.after(() => w.stop());
  const first = join(w, 'P0');
  assert.equal(first.s.last('welcome').hz, 30);
  for (let i = 1; i < 31; i++) join(w, 'P' + i);
  assert.equal(first.s.last('rate').hz, 29, 'everyone hears the new rate');
  const late = join(w, 'Late');
  assert.equal(late.s.last('welcome').hz, 28);
  w.disconnect(late.c);
  assert.equal(first.s.last('rate').hz, 29);
});

// an opponent's state as the member driving them streams it: [i, ts, ...fields]
const npcState = (i, x, ts = Date.now()) => [i, ts, x, 1, 2, 0, 0, 0, 1, 20, 0, 0, 0, 0.1, 0, 1, 0, 0.05, 0, 6000, 4, 8010, 8010, 8020, 8020];
const roster = (n) => Array.from({ length: n }, (_, i) => ({ name: 'AI ' + i, car: 'gt3', paint: '#1f5fff', skill: 0.95 }));

test('shared race: one grid of players plus the AI opponents everyone sees', (t) => {
  const w = new World();
  t.after(() => w.stop());
  const host = join(w, 'Host');
  const guest = join(w, 'Guest');
  const watcher = join(w, 'Watcher');
  w.message(host.c, JSON.stringify({ t: 'rcreate', ev: 'festival', npcs: roster(7) }));
  const lobby = guest.s.last('rlobby').race;
  assert.equal(lobby.opponents, 7);
  w.message(guest.c, JSON.stringify({ t: 'rjoin', id: lobby.id }));
  w.message(guest.c, JSON.stringify({ t: 'rgo' }));
  assert.equal(w.race.state, 'lobby', 'only the host can start early');
  w.message(host.c, JSON.stringify({ t: 'rgo' }));
  const start = watcher.s.last('rstart');
  assert.deepEqual(start.grid, [host.c.id, guest.c.id]);
  assert.equal(start.npcs.length, 6, 'two players + six opponents = the event field of eight');
  assert.equal(start.ai, host.c.id, 'the host drives the opponents');
  assert.ok(start.npcs.every((n) => n.id < 0 && n.car === 'gt3' && n.name.startsWith('AI ')));
  // only the opponents' driver may stream them; everyone in the world gets them
  w.message(guest.c, JSON.stringify({ t: 'n', s: [npcState(0, 99)] }));
  w.tick();
  assert.equal(watcher.s.last('snap'), undefined);
  w.message(host.c, JSON.stringify({ t: 'n', s: [npcState(0, 100), npcState(1, 104)] }));
  w.tick();
  const snap = watcher.s.last('snap');
  const e0 = snap.s.find((e) => e[S.id] === start.npcs[0].id);
  assert.equal(e0[S.pos], 100);
  assert.deepEqual(e0.slice(S.wheels, S.wheels + 4), [8010, 8010, 8020, 8020]);
  assert.ok(snap.s.some((e) => e[S.id] === start.npcs[1].id));
  // their progress is in the standings
  w.message(host.c, JSON.stringify({ t: 'rnpc', s: [[0, 850, 0, 0, 0, 95], [1, 900, 0, 1, 80.5, null]] }));
  w.race._lastStand = 0;
  w.tick();
  const stand = guest.s.last('rstand').race;
  assert.equal(stand.npcs[0].d, 850);
  assert.equal(stand.npcs[1].done, true);
  assert.equal(stand.npcs[1].time, 80.5);
});

test('shared race: the opponents move to another member when their driver leaves or goes quiet', (t) => {
  const w = new World();
  t.after(() => w.stop());
  const a = join(w, 'A');
  const b = join(w, 'B');
  const c = join(w, 'C');
  w.message(a.c, JSON.stringify({ t: 'rcreate', ev: 'festival', npcs: roster(3) }));
  for (const p of [b, c]) w.message(p.c, JSON.stringify({ t: 'rjoin', id: w.race.id }));
  w.message(a.c, JSON.stringify({ t: 'rgo' }));
  assert.equal(w.race.npcs.length, 1, 'three players leave room for one of three opponents');
  w.raceLeave(a.c);
  assert.equal(b.s.last('rai').ai, b.c.id, 'the next member takes them');
  assert.equal(w.race.host, b.c.id, 'and hosting');
  // B goes quiet (hidden tab): after a while C takes over
  w.race.aiAt = Date.now() - 3000;
  w.tick();
  assert.equal(c.s.last('rai').ai, c.c.id);
  // C streams; B's late messages no longer count
  w.message(b.c, JSON.stringify({ t: 'n', s: [npcState(0, 1)] }));
  w.message(c.c, JSON.stringify({ t: 'n', s: [npcState(0, 2)] }));
  w.tick();
  assert.equal(b.s.last('snap').s.find((e) => e[S.id] < 0)[S.pos], 2);
});

test('shared race results: players and opponents together, unfinished by distance', (t) => {
  const w = new World();
  t.after(() => w.stop());
  const a = join(w, 'Ann');
  const b = join(w, 'Bob');
  w.message(a.c, JSON.stringify({ t: 'rcreate', ev: 'festival', npcs: roster(4) }));
  w.message(b.c, JSON.stringify({ t: 'rjoin', id: w.race.id }));
  w.message(a.c, JSON.stringify({ t: 'rgo' }));
  w.race.startAt = Date.now() - 100000; // 100 s into the race
  // opponent 0 finished first; 1 is projected to finish at 90 s (but it's 100 s already); 2 has no estimate
  w.message(a.c, JSON.stringify({ t: 'rnpc', s: [[0, 3000, 0, 1, 70, null], [1, 2900, 0, 0, 0, 90], [2, 1200, 0, 0, 0, null]] }));
  w.message(b.c, JSON.stringify({ t: 'rprog', d: 3000, done: true, time: 75 }));
  w.message(a.c, JSON.stringify({ t: 'rprog', d: 2500, done: false }));
  w.message(a.c, JSON.stringify({ t: 'rprog', d: 3000, done: true, time: 99 }));
  w.tick();
  const res = b.s.last('rend').results;
  assert.deepEqual(
    res.map((r) => r.name),
    ['AI 0', 'Bob', 'Ann', 'AI 1', 'AI 2']
  );
  assert.ok(res[3].projected && res[3].time >= 100, 'a projection is never earlier than now');
  assert.equal(res[4].time, null);
  assert.equal(res[0].npc, true);
  assert.equal(w.race, null);
});

test('world numbers are clamped', () => {
  assert.equal(worldNumber(null), 1);
  assert.equal(worldNumber('7'), 7);
  assert.equal(worldNumber('-3'), 1);
  assert.equal(worldNumber('9999'), MAX_WORLDS);
});

test('Node server: real sockets meet in world 1 and overflow into world 2', async (t) => {
  const server = http.createServer();
  const mp = attachMultiplayer(server, { cap: 1 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `ws://127.0.0.1:${server.address().port}/ws`;
  const open = (url, name) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const got = [];
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        got.push(m);
        if (m.t === 'welcome' || m.t === 'full') resolve({ ws, got, first: m });
      };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, b: 'dev' }));
      ws.onerror = reject;
    });
  const a = await open(base, 'A');
  assert.equal(a.first.world, 1);
  const b = await open(base, 'B');
  assert.deepEqual(b.first, { t: 'full', world: 1, next: 2 });
  const b2 = await open(`${base}?world=${b.first.next}`, 'B');
  assert.equal(b2.first.world, 2);
  assert.deepEqual(mp.stats().worlds.map((w) => [w.world, w.players]).sort(), [
    [1, 1],
    [2, 1],
  ]);
  a.ws.close();
  b2.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(mp.stats().players, 0);
  assert.equal(mp.worlds.size, 0, 'empty worlds are released');
});
