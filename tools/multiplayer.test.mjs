import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { World, CLOSE, MAX_WORLDS, worldNumber } from '../server/hub.js';
import { attachMultiplayer } from '../server/multiplayer.js';
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
  assert.equal(snap.s[0][0], a.c.id);
  assert.equal(snap.s[0][1], 10);
  assert.deepEqual(snap.s[0][15], [8012, -1, 8960, 8999], 'wheel codes for tyre smoke');
  assert.ok(snap.s[0][16] >= 0 && snap.s[0][16] < 1000, 'last element is the state age in ms');
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
  assert.deepEqual(b.s.last('snap').s[0][15], [-1, -1, -1, -1]);
  w.message(a.c, state(2, [1e9, 'x', -50, 3.7]));
  w.tick();
  assert.deepEqual(b.s.last('snap').s[0][15], [99999, -1, -1, 3]);
});

test('world settings: anyone can change them, everyone gets them, joiners too', (t) => {
  const saved = [];
  const w = new World({ settings: { timeOfDay: 'night', dayLength: 'bogus' }, onSettings: (s) => saved.push(s) });
  t.after(() => w.stop());
  const a = join(w, 'Ann');
  assert.deepEqual(a.s.last('welcome').settings, { timeOfDay: 'night', dayLength: 40 }, 'restored, invalid values fall back');
  const b = join(w, 'Bob');
  w.message(b.c, JSON.stringify({ t: 'world', timeOfDay: 'sunset' }));
  assert.deepEqual(a.s.last('world'), { t: 'world', settings: { timeOfDay: 'sunset', dayLength: 40 }, by: 'Bob', id: b.c.id });
  assert.equal(b.s.last('world').settings.timeOfDay, 'sunset', 'the changer hears it back');
  assert.deepEqual(saved.at(-1), { timeOfDay: 'sunset', dayLength: 40 }, 'the host can keep it');
  // too soon for Bob again, invalid values and no-op changes are ignored
  w.message(b.c, JSON.stringify({ t: 'world', timeOfDay: 'noon' }));
  w.message(a.c, JSON.stringify({ t: 'world', timeOfDay: 'midnight', dayLength: 7 }));
  w.message(a.c, JSON.stringify({ t: 'world', timeOfDay: 'sunset' }));
  assert.equal(w.settings.timeOfDay, 'sunset');
  assert.equal(saved.length, 1);
  w.message(a.c, JSON.stringify({ t: 'world', dayLength: 120 }));
  assert.deepEqual(w.settings, { timeOfDay: 'sunset', dayLength: 120 });
  assert.deepEqual(join(w, 'Cat').s.last('welcome').settings, { timeOfDay: 'sunset', dayLength: 120 });
  const outsider = w.connect(sock());
  w.message(outsider, JSON.stringify({ t: 'world', timeOfDay: 'noon' }));
  assert.equal(w.settings.timeOfDay, 'sunset', 'only players in the world');
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
