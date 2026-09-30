// Engine sound synthesis (AudioWorklet). Each cylinder fires in its real firing order;
// every combustion releases an exhaust pressure pulse into its bank's headers, and the
// pulses ring through a pipe (a feedback delay with losses) and the muffler's resonances.
// Intake roar, valvetrain ticks, a supercharger whine and overrun crackles are layered on
// top, and an in-cabin mix muffles the exhaust the way a car's body does.
// Profiles may add an engine-order layer: sine partials at multiples of crank speed, each
// weighted by the exhaust's (and intake's) formants at its current frequency. Pulses alone
// turn to fizz at high rpm; the partials carry the clean wail of a high-revving engine.
// Self-contained on purpose: worklet modules are loaded as plain files.

const TAU = Math.PI * 2;

// Constant-peak-gain band-pass (RBJ cookbook), transposed direct form II.
class BandPass {
  constructor(f, q, sr) {
    const w = (TAU * f) / sr,
      alpha = Math.sin(w) / (2 * q),
      a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    this.z1 = this.z2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = -this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

// Magnitude of a sum of resonances [Hz, Q, gain] at frequency f (band-pass shapes).
function formant(list, f, floor) {
  let g = floor;
  if (list)
    for (let i = 0; i < list.length; i++) {
      const [f0, q, a] = list[i];
      const r = f / f0 - f0 / f;
      g += a / Math.sqrt(1 + q * q * r * r);
    }
  return g;
}

// One exhaust bank: pulse envelopes, header delays, pipe resonance and muffler.
class Bank {
  constructor(p, sr, skew = 1) {
    this.e1 = this.e2 = this.en = 0; // bi-exponential pulse state + combustion noise envelope
    this.hp = 0; // DC-blocking state before the pipe
    this.hpx = 0;
    this.qt = new Float64Array(32); // pending pulses (header delays): times and amplitudes
    this.qa = new Float32Array(32);
    this.qn = 0;
    const len = Math.max(8, Math.round(((p.pipe * skew) / 460) * sr)); // hot exhaust ~460 m/s
    this.buf = new Float32Array(len + 2);
    this.len = len;
    this.w = 0;
    this.lp = 0;
    this.res = p.resonances.map(([f, q]) => new BandPass(f, q, sr));
    this.boom = new BandPass(p.boom ?? 70, 1.2, sr);
  }
  schedule(t, a) {
    if (this.qn >= 32) return;
    let i = this.qn++;
    while (i > 0 && this.qt[i - 1] > t) {
      this.qt[i] = this.qt[i - 1];
      this.qa[i] = this.qa[i - 1];
      i--;
    }
    this.qt[i] = t;
    this.qa[i] = a;
  }
}

class EngineSynth extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = options.processorOptions.profile;
    const sr = sampleRate;
    this.p = p;
    this.sr = sr;
    this.t = 0; // sample clock
    this.phase = Math.random();
    this.rpm = this.targetRpm = p.idle;
    this.thr = this.targetThr = 0;
    this.gain = this.targetGain = 0;
    this.interior = this.targetInterior = 0;
    this.cut = false;
    this.pop = 0; // overrun afterfire readiness 0..1
    this.blip = 0; // seconds left of a downshift blip
    this.blipRpm = 0;
    this.lastThr = 0;
    this.lope = 0;
    this.seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    this.ord = (p.orders?.list || []).map(([k, w]) => {
      const ph = this.rand() * TAU;
      return { k, w, re: Math.cos(ph), im: Math.sin(ph), cw: 1, sw: 0, ex: 0, exT: 0, in: 0, inT: 0, am: 0, amT: 0 };
    });
    // cylinders sorted by firing position in the 720-degree cycle
    this.cyl = p.fire.map(([pos, bank], i) => ({ pos, bank, delay: (p.runners?.[i] ?? 0) / 1000, trim: 1 + (p.trim?.[i] ?? 0) })).sort((a, b) => a.pos - b.pos);
    this.next = this.cyl.findIndex((c) => c.pos > this.phase);
    if (this.next < 0) this.next = 0;
    // per-bank pipe lengths differ a little so the two sides do not phase-lock
    this.banks = [new Bank(p, sr), new Bank(p, sr, p.bankSkew ?? 1.07)];
    this.intake = [new BandPass(p.intake.f1, 1.1, sr), new BandPass(p.intake.f2, 2.2, sr)];
    this.airbox = new BandPass(p.intake.box ?? 170, 3, sr);
    this.intakeEnv = 0;
    this.mech = new BandPass(p.mech.f ?? 4200, 1.6, sr);
    this.mechEnv = 0;
    this.scPhase = 0;
    this.crackEnv = 0;
    this.crackle = new BandPass(p.crackleF ?? 1800, 1.3, sr);
    // output filters: exterior tone, cabin low-pass (two poles), DC blocker
    this.toneLp = 0;
    this.cab1 = this.cab2 = 0;
    this.dcx = [0, 0];
    this.dcy = [0, 0];
    this.port.onmessage = (e) => this.set(e.data);
    if (options.processorOptions.init) this.set(options.processorOptions.init, true);
  }

  // parameters from the game (posted every frame); `now` skips the smoothing
  set(m, now = false) {
    {
      if (m.rpm !== undefined) this.targetRpm = m.rpm;
      if (m.throttle !== undefined) this.targetThr = m.throttle;
      if (m.gain !== undefined) this.targetGain = m.gain;
      if (m.interior !== undefined) this.targetInterior = m.interior;
      if (m.cut !== undefined) this.cut = m.cut;
      if (m.shift > 0) this.shiftPop = this.thr > 0.5 ? this.p.shiftCrack ?? 0 : 0;
      else if (m.shift < 0 && this.p.blip && this.rpm > this.p.idle * 1.5) {
        // a paddle-shift gearbox blips the throttle to match revs on the way down
        this.shiftPop = 0;
        this.blip = 0.16;
        this.blipRpm = Math.min(this.p.redline * 0.95, this.rpm * (1 + this.p.blip));
      }
      if (m.stop) this.stopped = true;
    }
    if (now) {
      this.rpm = this.targetRpm;
      this.thr = this.targetThr;
      this.gain = this.targetGain;
      this.interior = this.targetInterior;
    }
  }

  rand() {
    // xorshift32 -> [0, 1)
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  fire(c) {
    const p = this.p;
    const rel = this.rpm / p.redline;
    const idleLoad = Math.max(0, 1 - (this.rpm - p.idle) / (p.idle * 0.6)) * 0.3;
    const load = Math.max(this.thr, idleLoad);
    let a = (0.14 + 0.86 * Math.pow(load, 0.85)) * (0.72 + 0.28 * Math.min(1.2, rel)) * c.trim;
    a *= 1 + (this.rand() - 0.5) * (p.jitter + p.lope * Math.max(0, 1 - rel * 2.5));
    let crack = 0;
    if (this.cut) a *= 0.06;
    else if (this.shiftPop > 0) {
      // dual-clutch upshift: the ignition cut fires a short "brap"
      this.shiftPop--;
      a = 1.8 + this.rand();
      crack = 0.8;
    } else if (this.thr < 0.08 && this.pop > 0 && rel > 0.3 && this.rand() < p.crackle * this.pop) {
      // overrun afterfire: unburnt fuel igniting in the hot exhaust
      a = (1.1 + this.rand() * 1.6) * this.pop;
      crack = 0.6 + this.rand() * 0.6;
    }
    const b = this.banks[c.bank];
    b.schedule(this.t + c.delay * this.sr, a);
    this.intakeEnv += p.intake.level * Math.pow(this.thr, 1.4) * (0.4 + 0.6 * rel);
    this.mechEnv += p.mech.level * (0.25 + rel * rel);
    if (crack) this.crackEnv += crack;
  }

  // Per-block targets for the engine-order partials. Each partial's level is its base weight
  // times the formant response at its present frequency, so the timbre shifts as the
  // harmonics sweep through the exhaust's resonances; load lifts the upper orders.
  orderTargets(n) {
    const p = this.p,
      O = p.orders,
      sr = this.sr;
    const fc = this.rpm / 60;
    const rel = Math.min(this.rpm / p.redline, 1.1);
    const load = this.cut ? 0 : this.thr;
    const rise = Math.pow(rel, O.rise ?? 1);
    const ex = O.level * ((O.base ?? 0.25) + (1 - (O.base ?? 0.25)) * Math.pow(load, 0.8)) * rise * (this.cut ? 0.3 : 1);
    const inl = (O.intakeLevel ?? 0) * Math.pow(load, 1.3) * rise;
    const tilt = (O.tilt ?? 1) - (O.loadTilt ?? 0) * load;
    const wander = Math.min(1, (n / sr) * 30); // chance per block of a new random level
    for (const h of this.ord) {
      const f = h.k * fc;
      const w = (TAU * f) / sr;
      h.cw = Math.cos(w);
      h.sw = Math.sin(w);
      const m = 1.5 - 0.5 * (h.re * h.re + h.im * h.im); // keep the phasor on the unit circle
      h.re *= m;
      h.im *= m;
      if (f < 18 || f > (O.fmax ?? 9000)) {
        h.exT = h.inT = 0;
        continue;
      }
      if (this.rand() < wander) h.amT = this.rand() * 2 - 1;
      h.am += (h.amT - h.am) * 0.25;
      const shape = h.w * Math.pow(h.k / 4, -tilt) * (1 + (O.am ?? 0.15) * h.am);
      h.exT = ex * shape * formant(O.formants, f, O.floor ?? 0.2);
      h.inT = inl ? inl * shape * formant(O.intakeFormants, f, 0) : 0;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0],
      R = out[1] || out[0];
    const p = this.p,
      sr = this.sr;
    const n = L.length;
    // per-block coefficients (they follow rpm, which changes slowly)
    const revSec = 60 / Math.max(this.rpm, 300);
    const d1 = Math.exp(-1 / (p.pulse * revSec * sr)); // pulse decay scales with engine speed
    const d2 = Math.exp(-1 / (0.00022 * sr)); // fast attack
    const dn = Math.exp(-1 / (Math.min(0.0016, (p.noiseLen ?? 1) * revSec) * sr));
    const dIn = Math.exp(-1 / (Math.max(0.004, revSec * 0.12) * sr));
    const dMech = Math.exp(-1 / (0.00035 * sr));
    const dCrack = Math.exp(-1 / (0.009 * sr));
    const kSmooth = 1 - Math.exp(-1 / (0.012 * sr));
    const kGain = 1 - Math.exp(-1 / (0.03 * sr));
    const lossA = 1 - Math.exp((-TAU * p.pipeCut) / sr); // pipe loss low-pass
    const toneA = 1 - Math.exp((-TAU * p.tone) / sr);
    const cabA = 1 - Math.exp((-TAU * (p.cabinLp ?? 620)) / sr);
    const hpA = Math.exp((-TAU * 28) / sr);
    const fb = p.feedback;
    const cyl = this.cyl;
    // afterfire readiness: builds when the throttle snaps shut at speed, fades out
    if (this.lastThr > 0.6 && this.targetThr < 0.1 && this.rpm > p.redline * 0.4) this.pop = 1;
    this.pop = Math.max(0, this.pop - n / sr / 1.6);
    this.lastThr = this.targetThr;
    let thrTarget = this.targetThr,
      rpmTarget = this.targetRpm;
    if (this.blip > 0) {
      this.blip -= n / sr;
      thrTarget = Math.max(thrTarget, 0.85);
      rpmTarget = Math.max(rpmTarget, this.blipRpm);
      if (this.blip <= 0 && this.rpm > p.redline * 0.35) this.pop = 1; // and it crackles after
    }
    if (this.ord.length) this.orderTargets(n);
    const ord = this.ord;
    const kOrd = 1 - Math.exp(-1 / (0.008 * sr));
    // gentle idle lope for lumpy cams
    this.lope += n / sr;
    const lopeRpm = p.lope * 90 * Math.sin(this.lope * 9.4) * Math.max(0, 1 - (this.rpm - p.idle) / 800);
    for (let i = 0; i < n; i++) {
      this.rpm += (rpmTarget + lopeRpm - this.rpm) * kSmooth;
      this.thr += (thrTarget - this.thr) * kSmooth;
      this.gain += (this.targetGain - this.gain) * kGain;
      this.interior += (this.targetInterior - this.interior) * kGain;
      // crank: one 4-stroke cycle = two revolutions
      const prev = this.phase;
      let ph = prev + this.rpm / 120 / sr;
      if (ph >= 1) ph -= 1;
      this.phase = ph;
      // fire every cylinder whose position the crank passed this sample
      for (let guard = 0; guard < cyl.length; guard++) {
        const c = cyl[this.next];
        const crossed = prev <= ph ? prev < c.pos && ph >= c.pos : prev < c.pos || ph >= c.pos;
        if (!crossed) break;
        this.fire(c);
        this.next = (this.next + 1) % cyl.length;
      }
      const noise = this.rand() * 2 - 1;
      let exL = 0,
        exR = 0,
        body = 0;
      for (let k = 0; k < 2; k++) {
        const b = this.banks[k];
        while (b.qn && b.qt[0] <= this.t) {
          const a = b.qa[0];
          b.e1 += a;
          b.e2 += a;
          b.en += a;
          b.qn--;
          b.qt.copyWithin(0, 1, b.qn + 1);
          b.qa.copyWithin(0, 1, b.qn + 1);
        }
        b.e1 *= d1;
        b.e2 *= d2;
        b.en *= dn;
        let x = (b.e1 - b.e2) * 1.4 + noise * b.en * p.noise;
        x = x / (1 + Math.abs(x) * p.drive); // combustion is not linear at high load
        // DC blocker: pulses are all positive pressure
        const hx = x;
        b.hp = hpA * (b.hp + hx - b.hpx);
        b.hpx = hx;
        x = b.hp;
        // pipe: feedback delay with a lossy (low-passed) reflection
        let r = b.w - b.len;
        if (r < 0) r += b.buf.length;
        b.lp += (b.buf[r] - b.lp) * lossA;
        const y = x - fb * b.lp;
        b.buf[b.w] = y;
        if (++b.w >= b.buf.length) b.w = 0;
        // muffler / body resonances
        let s = y * p.direct;
        const res = b.res;
        for (let j = 0; j < res.length; j++) s += res[j].run(y) * p.resonances[j][2];
        body += b.boom.run(y);
        if (k === 0) exL = s;
        else exR = s;
      }
      // engine-order partials (phasors rotated per sample; exhaust and intake weights)
      let tonal = 0,
        induction = 0;
      for (let j = 0; j < ord.length; j++) {
        const h = ord[j];
        const re = h.re * h.cw - h.im * h.sw;
        h.im = h.im * h.cw + h.re * h.sw;
        h.re = re;
        h.ex += (h.exT - h.ex) * kOrd;
        h.in += (h.inT - h.in) * kOrd;
        tonal += re * h.ex;
        induction += re * h.in;
      }
      // banks to tailpipes (a crossover pipe mixes the two sides), then the exhaust tone:
      // content above `tone` Hz is scaled by `bright`
      const mono = 0.5 * (exL + exR),
        side = 0.5 * (exL - exR) * (1 - 2 * p.crossover);
      this.toneLp += (mono - this.toneLp) * toneA;
      const shaped = this.toneLp + (mono - this.toneLp) * p.bright + tonal;
      const l = shaped + side,
        r = shaped - side;
      // intake roar + airbox honk
      this.intakeEnv *= dIn;
      const ie = this.intakeEnv;
      const intake = (this.intake[0].run(noise) * 0.9 + this.intake[1].run(noise) * 0.5) * ie + this.airbox.run(noise * ie) * 1.2 + induction;
      // valvetrain ticks
      this.mechEnv *= dMech;
      const mech = this.mech.run(noise) * this.mechEnv;
      // supercharger whine
      let sc = 0;
      if (p.sc) {
        this.scPhase += (this.rpm / 60) * p.sc.ratio * p.sc.lobes / sr;
        if (this.scPhase > 1) this.scPhase -= 1;
        const a = TAU * this.scPhase;
        const rel = this.rpm / p.redline;
        sc = (Math.sin(a) + 0.35 * Math.sin(2 * a + 0.4) + 0.12 * Math.sin(3 * a)) * p.sc.level * (0.25 + 0.75 * this.thr) * rel * rel;
      }
      // afterfire crackle
      this.crackEnv *= dCrack;
      const crack = this.crackle.run(noise) * this.crackEnv * p.crackleLevel;
      // exterior mix vs. in-cabin mix (body panels swallow the highs, the cabin booms)
      const ext = 0.5 * (l + r);
      this.cab1 += (ext - this.cab1) * cabA;
      this.cab2 += (this.cab1 - this.cab2) * cabA;
      const cab = this.cab2 * 0.85 + body * p.cabinBoom + intake * p.cabinIntake + mech * 1.3 + sc * 1.1 + crack * 0.5;
      const w = this.interior;
      const extra = intake + mech + sc + crack;
      let oL = (l + extra) * (1 - w) + cab * w;
      let oR = (r + extra) * (1 - w) + cab * w;
      // DC blocker + output gain (soft limit keeps pops from clipping)
      this.dcy[0] = oL - this.dcx[0] + 0.995 * this.dcy[0];
      this.dcx[0] = oL;
      this.dcy[1] = oR - this.dcx[1] + 0.995 * this.dcy[1];
      this.dcx[1] = oR;
      oL = this.dcy[0] * this.gain * p.level;
      oR = this.dcy[1] * this.gain * p.level;
      L[i] = oL / (1 + Math.abs(oL));
      if (R !== L) R[i] = oR / (1 + Math.abs(oR));
      this.t++;
    }
    return !this.stopped;
  }
}

registerProcessor('engine-synth', EngineSynth);
