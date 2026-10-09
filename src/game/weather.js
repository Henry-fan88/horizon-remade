// Shared weather and seasons in the game. Every frame this reads the world's climate
// (src/world/climate.js) from the shared clock and drives the rest: the sky and light
// (Environment.climate), wet surfaces and puddles (weather-surface.js), grip (surfaces.js
// GROUND), rain and snow around the camera, lightning and thunder, the sound and the grade.
import * as THREE from 'three';
import { Climate, lightningStrikes, pushChange } from '../world/climate.js';
import { weatherSurface, weatherParams } from '../world/weather-surface.js';
import { Precipitation } from '../world/precipitation.js';
import { Lightning } from '../world/lightning.js';
import { GROUND } from '../world/surfaces.js';
import { atmo } from '../world/sky.js';
import { clamp } from '../core/math.js';

// the prevailing wind, off the western sea
const WIND_DIR = new THREE.Vector2(0.92, 0.38).normalize();
const SOUND_SPEED = 343; // m/s

export const WEATHER_LABELS = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog', snow: 'Snow' };
export const SEASON_LABELS = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

export class WeatherSystem {
  constructor(game) {
    this.game = game;
    this.climate = new Climate();
    this.state = this.climate.state;
    this.precip = new Precipitation(game.world.heightTex, game.world.size);
    game.scene.add(this.precip.mesh);
    this.lightning = new Lightning(game.scene);
    this.lastMs = null;
    this.time = 0;
    this.thunder = []; // { at (this.time), dist, power }
    this.logs = {}; // offline change logs (online the world keeps them)
    this.offline = null;
    this.shown = ''; // the label on the HUD
    this._lamp = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), on: false };
    this._fwd = new THREE.Vector3();
  }

  // Online the world's settings (with its change logs); offline the player's own, with the
  // changes made in this session logged here so they fade in just like online.
  settings() {
    const g = this.game;
    const w = g.net?.worldSettings;
    if (w) return w;
    const s = g.settings;
    const o = this.offline;
    if (o && o.weather === s.weather && o.season === s.season) return o;
    const now = g.env.clock();
    for (const k of ['weather', 'season']) {
      const v = s[k] ?? 'auto';
      const log = this.logs[k];
      if (!log) this.logs[k] = [[v, 0]];
      else if (log[log.length - 1][0] !== v) this.logs[k] = pushChange(log, v, now);
    }
    return (this.offline = { weather: s.weather ?? 'auto', season: s.season ?? 'auto', weatherLog: this.logs.weather, seasonLog: this.logs.season });
  }

  // objects to show while the loading screen compiles shaders
  warmupObjects() {
    return [this.precip.mesh, this.lightning.warm];
  }

  setQuality(name) {
    this.precip.setQuality({ low: 0.35, medium: 0.6, high: 1, ultra: 1 }[name] ?? 1);
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    const ms = g.env.clock();
    const settings = this.settings();
    const c = this.climate.update(ms, settings);
    g.env.climate = c;

    // the ground: grip for the physics, wet / puddles / snow for every surface shader
    GROUND.wet = c.wet;
    GROUND.puddles = c.puddles;
    weatherSurface.x = c.wet;
    weatherSurface.y = c.puddles;
    weatherSurface.w = c.rain;
    weatherParams.x = atmo.time.value;

    // lightning: the same strikes for everyone; thunder once the sound has travelled
    if (this.lastMs !== null && ms > this.lastMs) lightningStrikes(this.lastMs, ms, settings, (s) => this.strike(s, ms));
    this.lastMs = ms;
    this.lightning.update(dt);
    g.env.flash = this.lightning.flash;
    g.env.skyFlash = this.lightning.skyFlash;
    for (let i = this.thunder.length - 1; i >= 0; i--) {
      const t = this.thunder[i];
      if (this.time < t.at) continue;
      g.audio.thunder?.(t.dist, t.power);
      this.thunder.splice(i, 1);
    }

    // rain / snow around the camera, blown by the gusting wind
    const gust = 1 + 0.3 * Math.sin(this.time * 0.63) * Math.sin(this.time * 1.71);
    const wind = (0.5 + c.wind * 6) * gust;
    const inCar = g.gameCam.inCar && g.player.interior;
    const light = clamp((1 - g.env.nightFactor) * (1 - 0.55 * c.dark) + 0.08 + this.lightning.flash * 0.5, 0, 1.5);
    this.precip.update(dt, g.camera, { rain: c.rain, snow: c.snow, windX: WIND_DIR.x * wind, windZ: WIND_DIR.y * wind, light, cabin: inCar, lamp: this.lamp() });

    // sound: rain on the land (drumming on the roof from inside), wind in the trees
    g.audio.setWeather?.(c.rain, c.snow, c.wind * gust, inCar ? 1 : 0);

    // the grade: an overcast drains colour, fog flattens contrast
    const pu = g.post.uniforms;
    pu.saturation.value = 1.02 - 0.2 * c.dark - 0.08 * c.fog;
    pu.contrast.value = 1.035 - 0.05 * c.fog;
    // rain beads on the lens of the outside cameras (in the cockpit the windscreen has it)
    pu.lensRain.value = !g.gameCam.inCar && (g.state === 'freeroam' || g.state === 'race') ? c.rain : 0;
    pu.lensWind.value = clamp((g.player?.physics.speed ?? 0) / 40, 0, 1);

    // tyre spray reads how wet the road is
    g.effects.wet = c.wet;
    this.updateLabel(c);
  }

  // the player's headlight beam (rain drops in it light up)
  lamp() {
    const p = this.game.player;
    const L = this._lamp;
    L.on = !!(this.game.env.lightsOn && p?.headLights);
    if (!L.on) return L;
    const st = p.spec.style;
    this._fwd.set(0, -0.06, 1).applyQuaternion(p.root.quaternion).normalize();
    L.dir.copy(this._fwd);
    L.pos.copy(p.root.position).addScaledVector(this._fwd, st.WB / 2 + st.fo);
    L.pos.y += 0.7;
    return L;
  }

  strike(s, ms) {
    const g = this.game;
    const cam = g.camera.position;
    const gy = g.world.height(s.x, s.z);
    const dist = this.lightning.strike(s, gy, cam);
    // the strike happened (ms - s.at) ago within this frame
    this.thunder.push({ at: this.time + dist / SOUND_SPEED - (ms - s.at) / 1000, dist, power: s.power });
  }

  // HUD: the weather and season, updated when the words change
  updateLabel(c) {
    const text = `${WEATHER_LABELS[c.weather] || ''} · ${SEASON_LABELS[c.season] || ''}`;
    if (text === this.shown) return;
    this.shown = text;
    this.game.hud.setWeather?.(c.weather, c.season, text);
  }
}
