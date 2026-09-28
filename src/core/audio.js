// WebAudio sound engine: synthesized engines, tyres, wind, impacts, UI and a radio bus.
import { clamp, lerp } from './math.js';

const PROFILES = {
  v8: { cyl: 8, sub: 0.9, saw: 0.55, sq: 0.25, noise: 0.35, cutoff: 900, rough: 0.35, drive: 3.2 },
  v8t: { cyl: 8, sub: 0.7, saw: 0.6, sq: 0.3, noise: 0.3, cutoff: 1300, rough: 0.2, drive: 2.6 },
  v12: { cyl: 12, sub: 0.25, saw: 0.7, sq: 0.35, noise: 0.25, cutoff: 2400, rough: 0.08, drive: 2.2 },
  flat6: { cyl: 6, sub: 0.5, saw: 0.6, sq: 0.45, noise: 0.35, cutoff: 1800, rough: 0.2, drive: 2.8 },
  i6: { cyl: 6, sub: 0.35, saw: 0.65, sq: 0.25, noise: 0.25, cutoff: 1500, rough: 0.12, drive: 2.2 },
  i4: { cyl: 4, sub: 0.3, saw: 0.45, sq: 0.6, noise: 0.35, cutoff: 1400, rough: 0.2, drive: 2.6 },
  boxer: { cyl: 4, sub: 0.8, saw: 0.5, sq: 0.45, noise: 0.4, cutoff: 1100, rough: 0.6, drive: 3.0 },
  ev: { cyl: 0, sub: 0, saw: 0, sq: 0, noise: 0.05, cutoff: 4000, rough: 0, drive: 1 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vol = { master: 0.8, engine: 0.8, music: 0.45, sfx: 0.8 };
    this.engines = new Map();
  }

  // must be called from a user gesture
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = this.vol.engine;
    this.engineBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.vol.music;
    this.musicBus.connect(this.master);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.shaperCurve = makeShaper(2.5);
    this.buildEnvLoops();
    this.ready = true;
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.vol.engine, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music, t, 0.05);
  }

  noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  buildEnvLoops() {
    const ctx = this.ctx;
    // tyre squeal: band-passed noise
    const tn = this.noiseSource();
    this.squealBP = ctx.createBiquadFilter();
    this.squealBP.type = 'bandpass';
    this.squealBP.frequency.value = 1100;
    this.squealBP.Q.value = 7;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2300;
    bp2.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    tn.connect(this.squealBP).connect(this.squealGain);
    tn.connect(bp2).connect(this.squealGain);
    this.squealGain.connect(this.sfxBus);
    // gravel / dirt rumble
    const gn = this.noiseSource();
    this.gravelLP = ctx.createBiquadFilter();
    this.gravelLP.type = 'lowpass';
    this.gravelLP.frequency.value = 700;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    gn.connect(this.gravelLP).connect(this.gravelGain).connect(this.sfxBus);
    // wind
    const wn = this.noiseSource();
    this.windLP = ctx.createBiquadFilter();
    this.windLP.type = 'lowpass';
    this.windLP.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wn.connect(this.windLP).connect(this.windGain).connect(this.sfxBus);
    // road rumble (tyre on asphalt)
    const rn = this.noiseSource();
    this.roadLP = ctx.createBiquadFilter();
    this.roadLP.type = 'lowpass';
    this.roadLP.frequency.value = 180;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    rn.connect(this.roadLP).connect(this.roadGain).connect(this.sfxBus);
  }

  // --------------------------------------------------------------- engines
  createEngine(id, profileName, positional = false) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const pr = PROFILES[profileName] || PROFILES.v8;
    const out = ctx.createGain();
    out.gain.value = 0;
    let dest = this.engineBus;
    let panner = null;
    if (positional) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 8;
      panner.rolloffFactor = 1.4;
      panner.connect(this.engineBus);
      dest = panner;
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = pr.cutoff;
    lp.Q.value = 1.2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeShaper(pr.drive);
    shaper.oversample = '2x';
    const pre = ctx.createGain();
    pre.gain.value = 0.5;
    pre.connect(shaper).connect(lp).connect(out).connect(dest);
    const mk = (type, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(pre);
      o.start();
      return { o, g };
    };
    const e = { id, pr, out, lp, pre, panner, oscs: [], throttle: 0, t: 0, pops: 0 };
    if (profileName === 'ev') {
      e.oscs.push(mk('sine', 0.35), mk('triangle', 0.12), mk('sine', 0.08));
      lp.frequency.value = 5000;
    } else {
      e.oscs.push(mk('sawtooth', pr.saw), mk('sawtooth', pr.sub), mk('square', pr.sq), mk('sawtooth', pr.saw * 0.35));
      // combustion noise
      const n = this.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.value = pr.noise;
      n.connect(bp).connect(ng).connect(pre);
      e.noiseBP = bp;
      e.noiseG = ng;
      // roughness: amplitude modulation at half firing freq
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      const lfoG = ctx.createGain();
      lfoG.gain.value = pr.rough * 0.35;
      lfo.connect(lfoG).connect(pre.gain);
      lfo.start();
      e.lfo = lfo;
    }
    // turbo whistle
    const tw = ctx.createOscillator();
    tw.type = 'sine';
    const twg = ctx.createGain();
    twg.gain.value = 0;
    tw.connect(twg).connect(out);
    tw.start();
    e.turbo = { o: tw, g: twg };
    this.engines.set(id, e);
    return e;
  }

  removeEngine(id) {
    const e = this.engines.get(id);
    if (!e) return;
    try {
      e.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      setTimeout(() => {
        e.oscs.forEach((x) => x.o.stop());
        e.turbo.o.stop();
        if (e.lfo) e.lfo.stop();
        e.out.disconnect();
      }, 300);
    } catch {}
    this.engines.delete(id);
  }

  updateEngine(id, rpm, throttle, load, boost, volume = 1, pos = null, spec = null) {
    const e = this.engines.get(id);
    if (!e || !this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pr = e.pr;
    const tc = 0.02;
    if (pr.cyl === 0) {
      const f = 60 + rpm * 0.055;
      e.oscs[0].o.frequency.setTargetAtTime(f, t, tc);
      e.oscs[1].o.frequency.setTargetAtTime(f * 1.5, t, tc);
      e.oscs[2].o.frequency.setTargetAtTime(f * 3.01, t, tc);
      e.out.gain.setTargetAtTime((0.07 + throttle * 0.18) * volume, t, 0.05);
    } else {
      const f = (Math.max(rpm, 600) / 60) * (pr.cyl / 2);
      e.oscs[0].o.frequency.setTargetAtTime(f, t, tc);
      e.oscs[1].o.frequency.setTargetAtTime(f * 0.5, t, tc);
      e.oscs[2].o.frequency.setTargetAtTime(f, t, tc);
      e.oscs[3].o.frequency.setTargetAtTime(f * 2.005, t, tc);
      e.noiseBP.frequency.setTargetAtTime(f * 3.2, t, tc);
      e.noiseG.gain.setTargetAtTime(pr.noise * (0.3 + throttle * 0.9), t, 0.03);
      e.lfo.frequency.setTargetAtTime(f * 0.5, t, tc);
      const cutoff = pr.cutoff * (0.55 + throttle * 0.9) + rpm * 0.25;
      e.lp.frequency.setTargetAtTime(clamp(cutoff, 200, 9000), t, 0.03);
      const vol = (0.1 + throttle * 0.2 + (rpm / 9000) * 0.1) * volume;
      e.out.gain.setTargetAtTime(vol, t, 0.04);
      // exhaust pops when lifting at high rpm
      if (e.throttle > 0.7 && throttle < 0.15 && rpm > 4000) e.pops = 0.9;
      if (e.pops > 0 && Math.random() < 0.25) this.pop(volume * 0.7, e.panner);
      e.pops = Math.max(0, e.pops - 0.016);
    }
    // turbo whistle + blow-off
    if (boost !== undefined && boost !== null) {
      e.turbo.o.frequency.setTargetAtTime(1800 + boost * 5200, t, 0.05);
      e.turbo.g.gain.setTargetAtTime(boost * 0.03 * volume, t, 0.05);
      if (e.boost > 0.6 && throttle < 0.1) this.blowOff(volume * e.boost, e.panner);
      e.boost = throttle < 0.1 ? 0 : boost;
    }
    e.throttle = throttle;
    if (pos && e.panner) {
      if (e.panner.positionX) {
        e.panner.positionX.setTargetAtTime(pos.x, t, 0.05);
        e.panner.positionY.setTargetAtTime(pos.y, t, 0.05);
        e.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
      } else e.panner.setPosition(pos.x, pos.y, pos.z);
    }
  }

  setListener(pos, fwd, up) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // --------------------------------------------------------------- continuous env sounds
  updateEnv(speed, squeal, offroad, grounded) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.squealGain.gain.setTargetAtTime(clamp(squeal, 0, 1) * 0.16 * (1 - offroad), t, 0.04);
    this.squealBP.frequency.setTargetAtTime(900 + squeal * 500 + Math.sin(t * 13) * 60, t, 0.05);
    this.gravelGain.gain.setTargetAtTime(grounded ? clamp(speed / 30, 0, 1) * 0.22 * offroad + squeal * 0.12 * offroad : 0, t, 0.05);
    this.gravelLP.frequency.setTargetAtTime(400 + speed * 12, t, 0.1);
    const w = clamp(speed / 85, 0, 1);
    this.windGain.gain.setTargetAtTime(w * w * 0.2, t, 0.1);
    this.windLP.frequency.setTargetAtTime(300 + speed * 18, t, 0.1);
    this.roadGain.gain.setTargetAtTime(grounded ? clamp(speed / 40, 0, 1) * 0.12 * (1 - offroad) : 0, t, 0.08);
  }

  // --------------------------------------------------------------- one-shots
  burst({ freq = 800, q = 1, type = 'lowpass', dur = 0.25, gain = 0.4, dest = null, attack = 0.002 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfxBus);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  pop(vol, panner) {
    this.burst({ freq: 300 + Math.random() * 500, q: 0.8, dur: 0.07 + Math.random() * 0.05, gain: 0.5 * vol, dest: panner || this.engineBus });
  }

  blowOff(vol, panner) {
    this.burst({ freq: 3200, q: 1.5, type: 'bandpass', dur: 0.35, gain: 0.25 * vol, dest: panner || this.engineBus, attack: 0.01 });
  }

  impact(strength) {
    const s = clamp(strength / 20, 0.1, 1);
    this.burst({ freq: 380, q: 0.7, dur: 0.35 + s * 0.3, gain: 0.9 * s });
    this.burst({ freq: 2400, q: 2, type: 'bandpass', dur: 0.15, gain: 0.25 * s });
    this.tone(70, 0.25, 0.5 * s, 'sine', 40);
  }

  smash() {
    this.burst({ freq: 1600, q: 1.2, type: 'bandpass', dur: 0.25, gain: 0.35 });
    this.burst({ freq: 500, q: 0.8, dur: 0.18, gain: 0.3 });
  }

  splash() {
    this.burst({ freq: 900, q: 0.5, dur: 1.2, gain: 0.6, attack: 0.02 });
  }

  tone(freq, dur, gain = 0.2, type = 'sine', endFreq = null, delay = 0, dest = null) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  ui(kind) {
    if (!this.ready) return;
    switch (kind) {
      case 'move':
        this.tone(1400, 0.05, 0.05, 'sine');
        break;
      case 'select':
        this.tone(880, 0.08, 0.1, 'triangle');
        this.tone(1320, 0.12, 0.1, 'triangle', null, 0.06);
        break;
      case 'back':
        this.tone(700, 0.08, 0.08, 'triangle', 500);
        break;
      case 'notify':
        this.tone(1046, 0.18, 0.08, 'sine');
        this.tone(1568, 0.3, 0.07, 'sine', null, 0.08);
        break;
      case 'skill':
        this.tone(1760, 0.06, 0.05, 'square', null);
        break;
      case 'bank':
        [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.25, 0.08, 'triangle', null, i * 0.07));
        break;
      case 'fail':
        this.tone(300, 0.4, 0.12, 'sawtooth', 150);
        break;
      case 'count':
        this.tone(440, 0.35, 0.18, 'square');
        break;
      case 'go':
        this.tone(880, 0.7, 0.2, 'square');
        break;
      case 'checkpoint':
        this.tone(1318, 0.12, 0.08, 'triangle');
        this.tone(1976, 0.2, 0.07, 'triangle', null, 0.05);
        break;
      case 'levelup':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.4, 0.1, 'triangle', null, i * 0.09));
        break;
      case 'horn':
        this.tone(415, 0.5, 0.15, 'square');
        this.tone(523, 0.5, 0.12, 'square');
        break;
      case 'star':
        this.tone(1568, 0.3, 0.1, 'triangle');
        break;
      case 'wheel':
        this.tone(2000 + Math.random() * 400, 0.03, 0.05, 'square');
        break;
    }
  }
}

function makeShaper(k) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}

export function lerpVol(a, b, t) {
  return lerp(a, b, t);
}
