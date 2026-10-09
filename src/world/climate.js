// Shared weather and seasons.
//
// Like the day/night clock (sky.js worldHour), the weather and the season are pure functions
// of server time and the world's settings, so everyone in a world sees the same rain, the
// same lightning strike and the same first snow at the same moment, without extra messages.
//
// - Season: in auto, each lasts SEASON_MS (one real hour; a year every four hours). A new
//   season blends in over its first SEASON_BLEND, with snow falling as winter arrives and
//   rain as it melts.
// - Weather: in auto, the sky follows SLOT_MS slots whose type is drawn from the season's
//   odds, crossfading over the last part of each slot.
// - Anyone can set either for the whole world. The world keeps a short log of those changes
//   ([value, server ms] pairs, oldest first) and every change fades in over FADE_MS from
//   whatever the sky looked like at that moment, so a menu change never pops or strobes.
// - Wet roads, puddles and lying snow lag the sky (roads dry slowly after rain). They are
//   integrated over the last HISTORY_MS from samples on a grid aligned to absolute time, so
//   they come out the same for every player, including ones who just joined.
//
// No three.js or DOM: the server, the physics benches and the tests import this too.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
export const CLIMATE_OPTIONS = { weather: ['auto', ...WEATHERS], season: ['auto', ...SEASONS] };

export const SEASON_MS = 60 * 60 * 1000;
export const SEASON_BLEND = 0.1; // share of a season spent blending in from the last one (6 min)
export const SLOT_MS = 10 * 60 * 1000;
export const SLOT_BLEND = 0.3; // share of a weather slot spent turning into the next (3 min)
export const FADE_MS = 30 * 1000;
export const LOG_MAX = 12; // changes kept per setting
export const HISTORY_MS = 15 * 60 * 1000; // how far back lagging ground state looks
const STEP_MS = 15 * 1000; // history sample spacing (aligned to absolute time)

// What each kind of weather does to the atmosphere (all 0..1).
// cloud: cover beyond today's fair-weather clouds; dark: how much the overcast cuts the
// sunlight; rain / snow: precipitation; fog: extra haze; storm: lightning; wind: gusts.
const KEYS = ['cloud', 'dark', 'rain', 'snow', 'fog', 'storm', 'wind'];
const N = KEYS.length;
const PRESETS = {
  clear: [0, 0, 0, 0, 0, 0, 0.15],
  cloudy: [0.7, 0.36, 0, 0, 0.12, 0, 0.35],
  rain: [1, 0.62, 0.62, 0, 0.35, 0, 0.45],
  storm: [1, 0.88, 1, 0, 0.45, 1, 0.9],
  fog: [0.45, 0.3, 0, 0, 1, 0, 0.05],
  snow: [0.9, 0.5, 0, 0.75, 0.45, 0, 0.35],
};
const PRESET_VEC = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, Float64Array.from(v)]));

// Odds of each weather per season in auto (clear, cloudy, rain, storm, fog, snow).
const ODDS = {
  spring: [0.35, 0.25, 0.28, 0.05, 0.07, 0],
  summer: [0.55, 0.2, 0.05, 0.14, 0.06, 0],
  autumn: [0.22, 0.26, 0.3, 0.07, 0.15, 0],
  winter: [0.3, 0.25, 0, 0, 0.1, 0.35],
};

// ---------------------------------------------------------------- deterministic noise

// float in [0, 1) from a non-negative integer (exact up to 2^53) and a salt
export function hash01(n, salt = 0) {
  const lo = n % 4294967296,
    hi = Math.floor(n / 4294967296);
  let h = Math.imul(lo ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((hi + Math.imul(salt + 1, 0x9e3779b9)) | 0, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const mod = (a, n) => ((a % n) + n) % n;

// ---------------------------------------------------------------- change logs

// The settings a world (or an offline player) holds: the current values plus their logs.
// A missing log means "always this value".
function logOf(settings, key) {
  const log = settings?.[key + 'Log'];
  if (Array.isArray(log) && log.length) return log;
  return [[settings?.[key] ?? 'auto', 0]];
}

// Fold a change log at time ms: start from the newest change that had fully faded in, then
// blend each later change in by its own fade. `valueOf(v, ms, out)` writes one value's vector.
function blendLog(log, ms, len, valueOf, out, tmp) {
  let i0 = 0;
  for (let i = 1; i < log.length; i++) if (log[i][1] + FADE_MS <= ms) i0 = i;
  valueOf(log[i0][0], ms, out);
  for (let i = i0 + 1; i < log.length; i++) {
    const at = log[i][1];
    if (at > ms) break;
    const k = smooth01((ms - at) / FADE_MS);
    valueOf(log[i][0], ms, tmp);
    for (let j = 0; j < len; j++) out[j] += (tmp[j] - out[j]) * k;
  }
  return out;
}

// Record a change in a log (server and offline both use this): drop entries that can no
// longer matter, keep the newest one before the history window as the base.
export function pushChange(log, value, ms) {
  const out = Array.isArray(log) ? log.filter((e) => Array.isArray(e) && e[1] <= ms) : [];
  out.push([value, ms]);
  let base = 0;
  for (let i = 0; i < out.length - 1; i++) if (out[i][1] < ms - HISTORY_MS) base = i;
  const kept = out.slice(base);
  return kept.length > LOG_MAX ? kept.slice(kept.length - LOG_MAX) : kept;
}

// A log read back from storage or the network: [value, ms] pairs with known values, in order.
export function cleanLog(log, options) {
  if (!Array.isArray(log)) return null;
  const out = [];
  for (const e of log.slice(-LOG_MAX)) {
    if (!Array.isArray(e) || !options.includes(e[0]) || typeof e[1] !== 'number' || !Number.isFinite(e[1])) continue;
    if (out.length && e[1] < out[out.length - 1][1]) continue;
    out.push([e[0], e[1]]);
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- seasons

const _season = new Float64Array(4);
const _seasonTmp = new Float64Array(4);

// Weights of spring, summer, autumn and winter for one season setting.
function seasonValue(v, ms, out) {
  out.fill(0);
  const i = SEASONS.indexOf(v);
  if (i >= 0) {
    out[i] = 1;
    return out;
  }
  const p = ms / SEASON_MS;
  const s = Math.floor(p);
  const cur = mod(s, 4);
  const k = smooth01((p - s) / SEASON_BLEND);
  out[cur] = k;
  out[mod(s - 1, 4)] += 1 - k;
  return out;
}

export function seasonWeights(ms, settings, out = new Float64Array(4)) {
  return blendLog(logOf(settings, 'season'), ms, 4, seasonValue, out, _seasonTmp);
}

// The auto season at a moment (name, and how far into it: 0..1)
export function autoSeason(ms) {
  const p = ms / SEASON_MS;
  return { season: SEASONS[mod(Math.floor(p), 4)], progress: p - Math.floor(p) };
}

// ---------------------------------------------------------------- weather

// Auto weather type of a slot, given the season setting in force.
export function slotWeather(slot, seasonSetting = 'auto') {
  let season = seasonSetting;
  if (!SEASONS.includes(season)) {
    const startMs = slot * SLOT_MS;
    season = SEASONS[mod(Math.floor(startMs / SEASON_MS), 4)];
    // the first slot of auto winter brings the first snow; the first of spring, the melt rain
    const first = mod(startMs, SEASON_MS) < SLOT_MS;
    if (first && season === 'winter') return 'snow';
    if (first && season === 'spring') return 'rain';
  }
  const odds = ODDS[season];
  let r = hash01(slot, 11);
  for (let i = 0; i < WEATHERS.length; i++) {
    r -= odds[i];
    if (r < 0) return WEATHERS[i];
  }
  return 'clear';
}

function autoWeather(ms, seasonSetting, out) {
  const p = ms / SLOT_MS;
  const slot = Math.floor(p);
  const a = PRESET_VEC[slotWeather(slot, seasonSetting)];
  const k = smooth01(((p - slot) - (1 - SLOT_BLEND)) / SLOT_BLEND);
  if (k <= 0) {
    out.set(a);
    return out;
  }
  const b = PRESET_VEC[slotWeather(slot + 1, seasonSetting)];
  for (let j = 0; j < N; j++) out[j] = a[j] + (b[j] - a[j]) * k;
  return out;
}

const _w = new Float64Array(N);
const _wTmp = new Float64Array(N);
const _wAutoTmp = new Float64Array(N);
const autoWeatherOf = (seasonSetting, ms, out) => autoWeather(ms, seasonSetting, out);

// The sky's weather vector at a moment (before the season turns rain into snow). Auto
// weather depends on the season setting too, so it fades along with season changes.
function weatherVector(ms, settings, out = _w) {
  const seasonLog = logOf(settings, 'season');
  const valueOf = (v, t, o) => {
    const preset = PRESET_VEC[v];
    if (preset) o.set(preset);
    else blendLog(seasonLog, t, N, autoWeatherOf, o, _wAutoTmp);
    return o;
  };
  return blendLog(logOf(settings, 'weather'), ms, N, valueOf, out, _wTmp);
}

// Everything the renderer, physics and sound need at one moment.
export function makeClimateState() {
  return {
    season: 'summer', // the dominant season
    seasons: new Float64Array(4), // spring, summer, autumn, winter weights
    weather: 'clear', // the dominant kind of weather (for labels)
    cloud: 0,
    dark: 0,
    rain: 0,
    snow: 0,
    fog: 0,
    storm: 0,
    wind: 0.15,
    wet: 0, // how wet the ground is (lags the rain)
    puddles: 0, // standing water (fills slower, dries slower)
    snowCover: 0, // lying snow (winter, or after a snowfall)
  };
}

// Instantaneous sky at ms: the weather vector with rain turned to snow in winter and
// thunderstorms turned into blizzards.
export function skyAt(ms, settings, out = makeClimateState()) {
  const w = weatherVector(ms, settings);
  const s = seasonWeights(ms, settings, out.seasons);
  const cold = s[3];
  out.cloud = w[0];
  out.dark = w[1];
  out.rain = w[2] * (1 - cold);
  out.snow = Math.min(1, w[3] + w[2] * cold);
  out.fog = w[4];
  out.storm = w[5] * (1 - cold);
  out.wind = w[6];
  let best = 0;
  for (let i = 1; i < 4; i++) if (s[i] > s[best]) best = i;
  out.season = SEASONS[best];
  out.weather = weatherName(out);
  return out;
}

// A label for the HUD / map: the kind of weather you would say it is.
export function weatherName(c) {
  if (c.storm > 0.5) return 'storm';
  if (c.snow > 0.25) return 'snow';
  if (c.rain > 0.25) return 'rain';
  if (c.fog > 0.6) return 'fog';
  if (c.cloud > 0.45) return 'cloudy';
  return 'clear';
}

const _hist = makeClimateState();
// time constants (ms) for the ground catching up with the sky: [getting wetter, drying]
const RISE = { wet: 40e3, puddles: 180e3, snow: 120e3 };
const FALL = { wet: 240e3, puddles: 420e3, snow: 200e3 };
const follow = (x, target, dt, rise, fall) => x + (target - x) * (1 - Math.exp(-dt / (target > x ? rise : fall)));
const wetTarget = (c) => Math.min(1, c.rain * 1.6);
const fallTarget = (c) => Math.min(1, c.snow * 1.5);

// The lagging ground at a grid time t1 (a multiple of STEP_MS): integrated from HISTORY_MS
// earlier, where it is taken to match the sky of that moment.
function groundAt(t1, settings, out = { wet: 0, puddles: 0, fall: 0 }) {
  const steps = HISTORY_MS / STEP_MS;
  skyAt(t1 - steps * STEP_MS, settings, _hist);
  let wet = wetTarget(_hist),
    puddles = _hist.rain,
    fall = fallTarget(_hist);
  for (let k = steps - 1; k >= 0; k--) {
    skyAt(t1 - k * STEP_MS, settings, _hist);
    wet = follow(wet, wetTarget(_hist), STEP_MS, RISE.wet, FALL.wet);
    puddles = follow(puddles, _hist.rain, STEP_MS, RISE.puddles, FALL.puddles);
    fall = follow(fall, fallTarget(_hist), STEP_MS, RISE.snow, FALL.snow);
  }
  out.wet = wet;
  out.puddles = puddles;
  out.fall = fall;
  return out;
}

// finish a state from the sky at ms and the ground at the grid time before it
function finish(out, ground, ms, t1) {
  const dt = ms - t1;
  out.wet = follow(ground.wet, wetTarget(out), dt, RISE.wet, FALL.wet);
  out.puddles = follow(ground.puddles, out.rain, dt, RISE.puddles, FALL.puddles);
  // winter keeps snow on the ground all season; outside it, a snowfall settles for a while
  out.snowCover = Math.max(out.seasons[3], follow(ground.fall, fallTarget(out), dt, RISE.snow, FALL.snow));
  return out;
}

// Full state at ms, including the lagging ground.
export function climateAt(ms, settings, out = makeClimateState()) {
  const t1 = Math.floor(ms / STEP_MS) * STEP_MS;
  const ground = groundAt(t1, settings);
  return finish(skyAt(ms, settings, out), ground, ms, t1);
}

// climateAt for every frame: the ground history is only recomputed when the grid time or
// the settings change (pass a new settings object when they change).
export class Climate {
  constructor() {
    this.state = makeClimateState();
    this._ground = { wet: 0, puddles: 0, fall: 0 };
    this._t1 = NaN;
    this._settings = null;
  }

  update(ms, settings) {
    const t1 = Math.floor(ms / STEP_MS) * STEP_MS;
    if (t1 !== this._t1 || settings !== this._settings) {
      groundAt(t1, settings, this._ground);
      this._t1 = t1;
      this._settings = settings;
    }
    return finish(skyAt(ms, settings, this.state), this._ground, ms, t1);
  }
}

// ---------------------------------------------------------------- lightning

const STRIKE_SLOT_MS = 500;
const STRIKES_PER_SLOT = 0.17; // about one strike every 3 s somewhere on the island at full storm

// Lightning strikes in (fromMs, toMs]: fn({ at, x, z, power }) for each, in order. Positions
// are in world metres across the island, so players far from a strike see a distant flash
// and hear the thunder later.
export function lightningStrikes(fromMs, toMs, settings, fn, worldSize = 6144) {
  if (!(toMs > fromMs)) return;
  const first = Math.floor(fromMs / STRIKE_SLOT_MS);
  const last = Math.floor(toMs / STRIKE_SLOT_MS);
  if (last - first > 40) return; // a long stall: skip the backlog instead of strobing
  for (let j = first; j <= last; j++) {
    const t0 = j * STRIKE_SLOT_MS;
    const storm = weatherVector(t0, settings)[5] * (1 - seasonWeights(t0, settings, _season)[3]);
    if (storm <= 0 || hash01(j, 31) >= storm * STRIKES_PER_SLOT) continue;
    const at = t0 + hash01(j, 32) * STRIKE_SLOT_MS;
    if (at <= fromMs || at > toMs) continue;
    const half = worldSize * 0.5;
    fn({ at, x: (hash01(j, 33) * 2 - 1) * half * 0.8, z: (hash01(j, 34) * 2 - 1) * half * 0.8, power: 0.55 + 0.45 * hash01(j, 35), seed: j });
  }
}
