// Skill chain system: detects driving skills and builds a banked multiplier chain.
import { clamp } from '../core/math.js';

const BANK_TIME = 3.2;

function tier(value, thresholds, names) {
  let i = 0;
  while (i < thresholds.length && value >= thresholds[i]) i++;
  return names[Math.min(i, names.length - 1)];
}

export class SkillSystem {
  constructor(game) {
    this.game = game;
    this.reset();
    this.totalBanked = 0;
    this.onBank = null;
    this.onBreak = null;
    this.onSkill = null;
  }

  reset() {
    this.chain = { active: false, total: 0, count: 0, mult: 1, timer: 0, skillName: '', skillPts: 0, skills: [] };
    this.drift = { active: false, score: 0, time: 0, lowTime: 0, maxAngle: 0 };
    this.air = { time: 0, startPos: null, maxH: 0 };
    this.speedTimer = 0;
    this.burnTime = 0;
    this.draftTime = 0;
    this.wreckStreak = 0;
    this.wreckTimer = 0;
  }

  // award a skill
  add(name, pts) {
    const c = this.chain;
    if (!c.active) {
      c.active = true;
      c.total = 0;
      c.count = 0;
      c.mult = 1;
      c.skills = [];
    }
    c.total += pts;
    c.count++;
    c.mult = Math.min(10, 1 + Math.floor(c.count / 3));
    c.timer = BANK_TIME;
    c.skillName = name;
    c.skillPts = pts;
    c.skills.push(name);
    this.onSkill?.(name, pts);
  }

  // live-updating skill (e.g. drift in progress)
  live(name, pts) {
    const c = this.chain;
    if (!c.active) {
      c.active = true;
      c.total = 0;
      c.count = 0;
      c.mult = 1;
      c.skills = [];
    }
    c.skillName = name;
    c.skillPts = pts;
    c.timer = BANK_TIME;
  }

  breakChain(reason = 'CHAIN BROKEN') {
    const c = this.chain;
    if (!c.active) return;
    const lost = c.total * c.mult;
    c.active = false;
    this.drift.active = false;
    this.drift.score = 0;
    this.onBreak?.(reason, lost);
  }

  bank() {
    const c = this.chain;
    if (!c.active) return;
    const value = Math.round(c.total * c.mult);
    c.active = false;
    this.totalBanked += value;
    this.onBank?.(value, c.mult, c.count);
  }

  update(dt, v, ctx) {
    const p = v.physics;
    const c = this.chain;
    const kmh = p.speed * 3.6;
    const fwdSpeed = p.forwardSpeed;
    const grounded = p.grounded >= 3;
    // ---- crash breaks the chain
    if (ctx.impact > 9) {
      this.breakChain('CRASHED — CHAIN BROKEN');
      this.drift.active = false;
      return;
    }
    // ---- drift
    const angle = Math.abs(p.slipAngleBody);
    const d = this.drift;
    if (grounded && fwdSpeed > 9 && angle > 0.26 && angle < 1.6) {
      d.active = true;
      d.lowTime = 0;
      d.time += dt;
      d.maxAngle = Math.max(d.maxAngle, angle);
      d.score += angle * angle * kmh * dt * 9;
      const name = tier(d.score, [800, 2200, 5000], ['DRIFT', 'GREAT DRIFT', 'AWESOME DRIFT', 'UNBELIEVABLE DRIFT']);
      this.live(name, Math.round(d.score));
    } else if (d.active) {
      d.lowTime += dt;
      if (d.lowTime > 0.45 || !grounded || fwdSpeed < 5) {
        if (d.score > 120) this.add(tier(d.score, [800, 2200, 5000], ['DRIFT', 'GREAT DRIFT', 'AWESOME DRIFT', 'UNBELIEVABLE DRIFT']), Math.round(d.score));
        d.active = false;
        d.score = 0;
        d.time = 0;
        d.maxAngle = 0;
      }
    }
    // ---- air
    const a = this.air;
    if (p.grounded === 0 && p.speed > 8) {
      if (a.time === 0) a.startPos = p.pos.clone();
      a.time += dt;
      if (a.time > 0.45) this.live(a.time > 1.6 ? 'GREAT AIR' : 'AIR', Math.round(a.time * 420));
    } else if (a.time > 0) {
      if (a.time > 0.45 && a.startPos) {
        const dist = Math.hypot(p.pos.x - a.startPos.x, p.pos.z - a.startPos.z);
        const name = tier(a.time, [1.2, 2.2, 3.4], ['AIR', 'GREAT AIR', 'AWESOME AIR', 'ULTIMATE AIR']);
        this.add(name, Math.round(a.time * 420 + dist * 8));
        ctx.onAir?.(a.time, dist, a.startPos);
      }
      a.time = 0;
    }
    // ---- speed
    if (kmh > 190 && grounded) {
      this.speedTimer += dt;
      if (this.speedTimer > 2.5) {
        this.speedTimer = 0;
        this.add(kmh > 280 ? 'ULTIMATE SPEED' : kmh > 240 ? 'GREAT SPEED' : 'SPEED', Math.round(kmh * 2.2));
      }
    } else this.speedTimer = Math.max(0, this.speedTimer - dt * 2);
    // ---- burnout
    const spin = Math.max(...p.wheels.map((w) => (w.driven ? w.spinning : 0)));
    if (kmh < 25 && spin > 0.4 && p.input.throttle > 0.8) {
      this.burnTime += dt;
      if (this.burnTime > 1.2) {
        this.burnTime = 0;
        this.add('BURNOUT', 250);
      }
    } else this.burnTime = 0;
    // ---- drafting (set by race/traffic systems through ctx.drafting)
    if (ctx.drafting && kmh > 110) {
      this.draftTime += dt;
      if (this.draftTime > 1.5) {
        this.draftTime = 0;
        this.add('DRAFTING', 300);
      }
    } else this.draftTime = 0;
    // ---- wrecker streak window
    if (this.wreckTimer > 0) this.wreckTimer -= dt;
    else this.wreckStreak = 0;
    // ---- chain timer
    if (c.active && !d.active && a.time === 0) {
      c.timer -= dt;
      if (c.timer <= 0) this.bank();
    }
  }

  nearMiss(relSpeed) {
    this.add(relSpeed > 120 ? 'GREAT NEAR MISS' : 'NEAR MISS', Math.round(200 + relSpeed * 3));
  }

  wreck(kind) {
    this.wreckStreak++;
    this.wreckTimer = 2.5;
    this.add(this.wreckStreak >= 5 ? 'SUPER WRECKER' : 'WRECKER', 100 + this.wreckStreak * 20);
  }

  pass() {
    this.add('PASS', 250);
  }

  state() {
    const c = this.chain;
    const liveBonus = this.drift.active ? this.drift.score : this.air.time > 0.45 ? this.air.time * 420 : 0;
    return { active: c.active, total: Math.round(c.total + liveBonus), mult: c.mult, timer: clamp(c.timer / BANK_TIME, 0, 1), skillName: c.skillName, skillPts: c.skillPts };
  }
}
