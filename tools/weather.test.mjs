import test from 'node:test';
import assert from 'node:assert/strict';
import {
  climateAt, Climate, skyAt, seasonWeights, slotWeather, pushChange, cleanLog, lightningStrikes,
  SEASON_MS, SLOT_MS, FADE_MS, HISTORY_MS, LOG_MAX, CLIMATE_OPTIONS,
} from '../src/world/climate.js';
import { VehiclePhysics } from '../src/vehicle/vehiclephysics.js';
import { CAR_BY_ID } from '../src/vehicle/carspecs.js';
import { SURF } from '../src/world/worldgen.js';
import { SURFACE_INFO, GROUND, weatherGrip } from '../src/world/surfaces.js';

const YEAR = 4 * SEASON_MS;
const BASE = Math.floor(1_790_000_000_000 / YEAR) * YEAR; // the start of an auto year (spring)
const AUTO = { weather: 'auto', season: 'auto' };
const KEYS = ['cloud', 'dark', 'rain', 'snow', 'fog', 'storm', 'wind', 'wet', 'puddles', 'snowCover'];
const pick = (c) => Object.fromEntries(KEYS.map((k) => [k, c[k]]));
const changed = (log, value, ms) => pushChange(log ?? null, value, ms);

test('the climate is a pure function of time and settings: every player computes the same', () => {
  for (const ms of [BASE + 1234, BASE + SEASON_MS * 2.5, BASE + YEAR - 1]) {
    const a = climateAt(ms, AUTO), b = climateAt(ms, { ...AUTO });
    assert.deepEqual(pick(a), pick(b));
    assert.deepEqual([...a.seasons], [...b.seasons]);
  }
  // the per-frame cache gives the same answer as the full computation
  const cl = new Climate();
  for (let ms = BASE; ms < BASE + 20 * 60e3; ms += 7919) assert.deepEqual(pick(cl.update(ms, AUTO)), pick(climateAt(ms, AUTO)));
});

test('auto seasons last an hour each, blend in at the start, and winter keeps snow on the ground', () => {
  const names = [];
  for (let k = 0; k < 4; k++) names.push(climateAt(BASE + k * SEASON_MS + SEASON_MS / 2, AUTO).season);
  assert.deepEqual(names, ['spring', 'summer', 'autumn', 'winter']);
  // the first minutes of a season blend in from the last one
  const w = seasonWeights(BASE + 3 * SEASON_MS + 60e3, AUTO);
  assert.ok(w[3] > 0 && w[3] < 1 && w[2] > 0, 'autumn turning into winter');
  // winter brings its first snow, and lies white all season
  assert.equal(slotWeather((BASE + 3 * SEASON_MS) / SLOT_MS), 'snow');
  const mid = climateAt(BASE + 3.5 * SEASON_MS, AUTO);
  assert.equal(mid.snowCover, 1);
  assert.equal(mid.rain, 0, 'no rain in winter: it falls as snow');
  // and it is gone by mid spring
  assert.ok(climateAt(BASE + YEAR + SEASON_MS / 2, AUTO).snowCover < 0.01);
});

test('auto weather changes gradually and draws on the season (no storms in winter)', () => {
  let prev = null, maxStep = 0;
  for (let ms = BASE; ms < BASE + YEAR; ms += 5000) {
    const c = climateAt(ms, AUTO);
    if (prev) for (const k of KEYS) maxStep = Math.max(maxStep, Math.abs(c[k] - prev[k]));
    prev = pick(c);
    if (c.seasons[3] === 1) assert.equal(c.storm, 0, 'thunderstorms turn into blizzards in winter');
  }
  assert.ok(maxStep < 0.1, `largest change per 5 s: ${maxStep.toFixed(3)}`);
  const tally = {};
  for (let s = 0; s < 20000; s++) tally[slotWeather(s, 'summer')] = (tally[slotWeather(s, 'summer')] || 0) + 1;
  assert.ok(tally.clear > tally.cloudy && !tally.snow, 'summer is mostly clear and never snows');
  for (let s = 0; s < 2000; s++) assert.notEqual(slotWeather(s, 'winter'), 'storm');
});

test('a menu change fades in over FADE_MS from whatever the sky was, even mid-fade', () => {
  const T = BASE + 1_000_000;
  let log = changed(null, 'clear', 0);
  log = changed(log, 'storm', T);
  const set = { weather: 'storm', season: 'summer', weatherLog: log };
  assert.equal(skyAt(T - 1, set).storm, 0);
  assert.ok(Math.abs(skyAt(T + FADE_MS / 2, set).storm - 0.5) < 1e-9, 'half way at half the fade');
  assert.equal(skyAt(T + FADE_MS, set).storm, 1);
  // changing again mid-fade continues from the blended sky: no jump either side of the change
  const log2 = changed(log, 'fog', T + 10e3);
  const set2 = { weather: 'fog', season: 'summer', weatherLog: log2 };
  const before = skyAt(T + 10e3 - 1, set2), after = skyAt(T + 10e3 + 1, set2);
  for (const k of ['cloud', 'dark', 'rain', 'fog', 'storm']) assert.ok(Math.abs(before[k] - after[k]) < 0.01, k);
  assert.equal(skyAt(T + 10e3 + FADE_MS, set2).fog, 1);
});

test('the ground lags the sky: roads stay wet after the rain, and joiners agree', () => {
  const T = BASE + 2_000_000;
  let log = changed(null, 'clear', 0);
  log = changed(log, 'rain', T);
  log = changed(log, 'clear', T + 10 * 60e3);
  const set = { weather: 'clear', season: 'summer', weatherLog: log };
  assert.ok(climateAt(T + 2 * 60e3, set).wet > 0.9, 'soaked two minutes into the rain');
  const justAfter = climateAt(T + 10 * 60e3 + FADE_MS, set);
  assert.equal(justAfter.rain, 0);
  assert.ok(justAfter.wet > 0.8 && justAfter.puddles > 0.5, 'still wet once the rain has stopped');
  const later = climateAt(T + 22 * 60e3, set);
  assert.ok(later.wet < 0.2 && later.wet > 0, 'drying after ten minutes');
  // a player who joins later sees the same ground as one who watched it rain
  const watcher = new Climate();
  for (let ms = T; ms <= T + 12 * 60e3; ms += 997) watcher.update(ms, set);
  assert.deepEqual(pick(watcher.update(T + 12 * 60e3, set)), pick(climateAt(T + 12 * 60e3, set)));
});

test('change logs stay short, ordered and valid', () => {
  let log = null;
  for (let i = 0; i < 40; i++) log = changed(log, i % 2 ? 'rain' : 'fog', BASE + i * 1000);
  assert.ok(log.length <= LOG_MAX);
  assert.equal(log.at(-1)[0], 'rain');
  // entries older than the history window collapse to one base entry
  const old = changed(changed(changed(null, 'clear', 0), 'rain', BASE), 'fog', BASE + HISTORY_MS + 60e3);
  assert.deepEqual(old.map((e) => e[0]), ['rain', 'fog']);
  assert.deepEqual(cleanLog([['rain', 5], ['nope', 6], ['fog', 3], 'x', ['snow', 9]], CLIMATE_OPTIONS.weather), [['rain', 5], ['snow', 9]]);
  assert.equal(cleanLog('nope', CLIMATE_OPTIONS.weather), null);
});

test('lightning is the same for everyone, whatever their frame rate', () => {
  const T = BASE + 3_000_000;
  const set = { weather: 'storm', season: 'summer', weatherLog: changed(changed(null, 'clear', 0), 'storm', T) };
  const at = (step) => {
    const out = [];
    for (let t = T; t < T + 120e3; t += step) lightningStrikes(t, t + step, set, (s) => out.push(`${s.at.toFixed(1)}:${s.x.toFixed(1)}`));
    return out;
  };
  const a = at(16), b = at(33), c = at(7);
  assert.ok(a.length > 20, `${a.length} strikes in two minutes of storm`);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  const none = [];
  lightningStrikes(T, T + 60e3, { weather: 'clear', season: 'summer' }, (s) => none.push(s));
  assert.equal(none.length, 0);
});

// ---------------------------------------------------------------- driving in the wet

const DT = 1 / 120;
const flat = (surface) => ({ height: () => 10, sample(x, z, n) { Object.assign(n, { x: 0, y: 1, z: 0 }); return 10; }, surfaceAt: () => surface });
function stop(surface, speed = 100 / 3.6) {
  const p = new VehiclePhysics(CAR_BY_ID.gt, flat(surface));
  p.autoGear = false;
  p.reset(0, 0, 0);
  for (let i = 0; i < 180; i++) { p.input.brake = 1; p.step(DT); }
  p.gear = 3; p.autoGear = true; p.input.brake = 0;
  p.vel.z = speed;
  for (const w of p.wheels) w.omega = speed / w.r;
  let steps = 0;
  while (p.vel.length() > 0.5 && steps < 2400) { p.input.brake = 1; p.step(DT); steps++; }
  return p.pos.z;
}
const withGround = (g, fn) => {
  const saved = { ...GROUND };
  Object.assign(GROUND, g);
  try { return fn(); } finally { Object.assign(GROUND, saved); }
};

test('dry grip is untouched; wet roads grip less, and standing water less again at speed', () => {
  for (const s of Object.values(SURFACE_INFO)) assert.equal(weatherGrip(s, 40), 1, `${s.name} dry`);
  withGround({ wet: 1, puddles: 1 }, () => {
    const road = SURFACE_INFO[SURF.ROAD];
    assert.ok(Math.abs(weatherGrip(road, 5) - 0.83) < 1e-9, 'wet asphalt keeps ~83%');
    assert.ok(weatherGrip(road, 45) < weatherGrip(road, 5), 'aquaplaning at speed');
    assert.ok(weatherGrip(SURFACE_INFO[SURF.KERB], 10) < weatherGrip(road, 10), 'painted kerbs are slicker');
    assert.ok(weatherGrip(SURFACE_INFO[SURF.GRASS], 10) < weatherGrip(SURFACE_INFO[SURF.DIRTROAD], 10), 'wet grass is the worst');
    assert.ok(weatherGrip(SURFACE_INFO[SURF.SAND], 10) > 1, 'wet sand packs down');
    assert.equal(weatherGrip(SURFACE_INFO[SURF.SNOW], 10), 1, 'snow is snow');
  });
});

test('braking from 100 km/h takes longer on a wet road', (t) => {
  const dry = stop(SURF.ROAD);
  const wet = withGround({ wet: 1, puddles: 0 }, () => stop(SURF.ROAD));
  const flooded = withGround({ wet: 1, puddles: 1 }, () => stop(SURF.ROAD));
  t.diagnostic(`100-0 km/h: dry ${dry.toFixed(1)} m, wet ${wet.toFixed(1)} m, standing water ${flooded.toFixed(1)} m`);
  assert.ok(wet > dry * 1.1 && wet < dry * 1.45, 'noticeably, not absurdly, longer');
  assert.ok(flooded > wet);
  assert.equal(stop(SURF.ROAD), dry, 'and dry again afterwards');
});
