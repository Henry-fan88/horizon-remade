// "Horizon Pulse" — procedural festival radio. Generates endless synthwave/house tracks.
import { mulberry32 } from './math.js';

const PROGRESSIONS = [
  [0, 5, 3, 4], // i VI iv v (minor)
  [0, 3, 5, 4],
  [0, 5, 2, 6],
  [0, 4, 5, 3],
  [5, 3, 0, 4],
];
// natural minor scale degrees (semitones from root)
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const KEYS = [57, 54, 50, 52, 55, 53]; // A, F#, D, E, G, F (midi)
const TITLE_A = ['Neon', 'Golden', 'Midnight', 'Coastal', 'Volcano', 'Sunset', 'Festival', 'Endless', 'Electric', 'Horizon', 'Crimson', 'Velvet'];
const TITLE_B = ['Drive', 'Skyline', 'Heat', 'Rush', 'Lights', 'Dreams', 'Highway', 'Pulse', 'Waves', 'Summer', 'Runner', 'Signal'];
const ARTISTS = ['Solar Kid', 'Lumen Ray', 'Nova Vale', 'The Apex', 'Kilometre', 'Drift State', 'Paloma Sky', 'Vector 88'];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Radio {
  constructor(audio) {
    this.audio = audio;
    this.playing = false;
    this.onTrack = null;
    this.trackIndex = 0;
  }

  start() {
    const a = this.audio;
    if (!a.ready || this.playing) return;
    const ctx = a.ctx;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0;
    this.out.connect(a.musicBus);
    this.out.gain.setTargetAtTime(0.9, ctx.currentTime, 1.5);
    // sidechain bus for pads/bass
    this.duck = ctx.createGain();
    this.duck.connect(this.out);
    // delay for leads
    this.delay = ctx.createDelay(2);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.38;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0.3;
    this.delay.connect(this.delayFb).connect(this.delay);
    this.delay.connect(this.delayWet).connect(this.out);
    this.playing = true;
    this.newTrack();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.4);
    const o = this.out;
    setTimeout(() => o.disconnect(), 2500);
  }

  toggle() {
    if (this.playing) this.stop();
    else this.start();
    return this.playing;
  }

  newTrack() {
    const seed = (Date.now() & 0xffff) + this.trackIndex * 977;
    const r = mulberry32(seed);
    this.trackIndex++;
    this.rng = r;
    this.bpm = 112 + Math.floor(r() * 16);
    this.key = KEYS[Math.floor(r() * KEYS.length)];
    this.prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)];
    this.arpPattern = Array.from({ length: 16 }, () => Math.floor(r() * 4));
    this.arpOn = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? r() > 0.1 : r() > 0.55));
    this.bassPattern = Array.from({ length: 16 }, (_, i) => (i % 4 === 2 ? 1 : i % 2 === 0 ? (r() > 0.3 ? 1 : 0) : r() > 0.7 ? 2 : 0));
    this.leadSaw = r() > 0.5;
    this.step = 0;
    this.bar = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    // structure: [section, bars]
    this.sections = [
      ['intro', 8],
      ['verse', 16],
      ['build', 4],
      ['drop', 16],
      ['break', 8],
      ['build', 4],
      ['drop', 16],
      ['outro', 8],
    ];
    this.sectionIdx = 0;
    this.sectionBar = 0;
    this.title = `${TITLE_A[Math.floor(r() * TITLE_A.length)]} ${TITLE_B[Math.floor(r() * TITLE_B.length)]}`;
    this.artist = ARTISTS[Math.floor(r() * ARTISTS.length)];
    if (this.onTrack) this.onTrack(this.title, this.artist);
  }

  schedule() {
    if (!this.playing) return;
    const ctx = this.ctx;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        this.sectionBar++;
        if (this.sectionBar >= this.sections[this.sectionIdx][1]) {
          this.sectionBar = 0;
          this.sectionIdx++;
          if (this.sectionIdx >= this.sections.length) {
            this.newTrack();
            return;
          }
        }
      }
    }
  }

  chordNotes(bar) {
    const deg = this.prog[bar % 4];
    const root = this.key - 12 + MINOR[deg % 7];
    const third = this.key - 12 + MINOR[(deg + 2) % 7] + (deg + 2 >= 7 ? 12 : 0);
    const fifth = this.key - 12 + MINOR[(deg + 4) % 7] + (deg + 4 >= 7 ? 12 : 0);
    return [root, third, fifth];
  }

  playStep(step, t, sd) {
    const sec = this.sections[this.sectionIdx][0];
    const bar = this.bar;
    const chord = this.chordNotes(bar);
    const full = sec === 'drop';
    const drums = sec === 'verse' || sec === 'drop' || sec === 'outro';
    // kick on the beat
    if (drums && step % 4 === 0) {
      this.kick(t);
      // sidechain duck
      const g = this.duck.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.35, t);
      g.linearRampToValueAtTime(1, t + sd * 3);
    }
    if (sec === 'build') {
      // snare roll that accelerates
      const density = this.sectionBar < 2 ? 4 : this.sectionBar < 3 ? 2 : 1;
      if (step % density === 0) this.clap(t, 0.12 + (this.sectionBar / 4) * 0.2);
    }
    if (drums && (step === 4 || step === 12)) this.clap(t, 0.32);
    if ((drums || sec === 'intro' || sec === 'break') && step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.14 : 0.06, step % 4 === 2 ? 0.12 : 0.04);
    // bass
    if ((sec === 'verse' || full || sec === 'build') && this.bassPattern[step]) {
      const n = chord[0] - 12 + (this.bassPattern[step] === 2 ? 12 : 0);
      this.bass(t, mtof(n), sd * 1.6);
    }
    // pads each bar
    if (step === 0 && sec !== 'build') this.pad(t, chord, sd * 16, full ? 0.07 : 0.1);
    // arp lead in the drop (and softer in the break)
    if ((full || sec === 'break') && this.arpOn[step]) {
      const idx = this.arpPattern[step];
      const n = [chord[0], chord[1], chord[2], chord[0] + 12][idx] + 12 + (full ? 12 : 0);
      this.pluck(t, mtof(n), sd * 1.5, full ? 0.07 : 0.05);
    }
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  clap(t, gain) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.audio.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1700;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random());
    s.stop(t + 0.2);
  }

  hat(t, dur, gain) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.audio.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  bass(t, freq, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = freq * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.duck);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  pad(t, chord, dur, gain) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.25);
    g.gain.setValueAtTime(gain, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g).connect(this.duck);
    for (const n of chord)
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n + 12);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
  }

  pluck(t, freq, dur, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = this.leadSaw ? 'sawtooth' : 'square';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75;
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
