// Save data + progression (credits, XP/levels, wheelspins, garage, records).
import { DEFAULT_SETTINGS } from '../config.js';
import { CARS, CAR_BY_ID } from '../vehicle/carspecs.js';

const KEY = 'horizon-remade-save-v1';
// Cars granted once per content pack: new saves start with them, older saves receive them
// on their next load (a pack whose cars are not in this build is skipped).
const CAR_PACKS = [
  { id: 'real-cars-1', cars: ['shelby', 'gt3', 'fastback'] },
  { id: 'formula-1', cars: ['f1'] },
  { id: 'modern-formula-2023', cars: ['sf23', 'rb19'] },
]
  .map((p) => ({ ...p, cars: p.cars.filter((id) => CAR_BY_ID[id]) }))
  .filter((p) => p.cars.length);
const packEntries = (pack) => pack.cars.map((id) => ({ id, paint: { color: CAR_BY_ID[id].color, finish: 'gloss' } }));

export function xpForLevel(level) {
  return 2500 + (level - 1) * 750;
}

export class Save {
  constructor() {
    this.data = this.load();
    this._t = null;
  }

  defaults() {
    return {
      version: 1,
      contentPacks: CAR_PACKS.map((p) => p.id),
      name: '',
      credits: 45000,
      xp: 0,
      level: 1,
      wheelspins: 2,
      superWheelspins: 0,
      garage: [
        { id: 'gt', paint: { color: '#c81d25', finish: 'gloss' } },
        ...CAR_PACKS.flatMap(packEntries),
      ],
      current: 0,
      records: {},
      raceRecords: {},
      boards: [],
      stats: { distance: 0, topSpeed: 0, skillPts: 0, racesWon: 0, racesDone: 0, crashes: 0, drifts: 0 },
      settings: { ...DEFAULT_SETTINGS },
      firstRun: true,
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.version === 1) {
          const def = this.defaults();
          const out = { ...def, ...d, stats: { ...def.stats, ...d.stats }, settings: { ...def.settings, ...d.settings } };
          // Cars that are no longer in the game (the original fictional roster) leave the
          // garage; the selection follows the car the player was driving, else the Ferrari.
          const selected = Array.isArray(d.garage) ? d.garage[d.current] : null;
          out.garage = (out.garage || []).filter((g) => CAR_BY_ID[g.id]);
          if (!out.garage.length) out.garage = def.garage;
          const keep = selected ? out.garage.indexOf(selected) : -1;
          out.current = keep >= 0 ? keep : Math.max(0, out.garage.findIndex((g) => g.id === 'gt'));
          // Grant this release's cars once, preserving the selected car, credits,
          // existing paint, records and all other progress in older saves.
          out.contentPacks = Array.isArray(d.contentPacks) ? [...d.contentPacks] : [];
          for (const pack of CAR_PACKS) {
            if (out.contentPacks.includes(pack.id)) continue;
            for (const car of packEntries(pack)) if (!out.garage.some((g) => g.id === car.id)) out.garage.push(car);
            out.contentPacks.push(pack.id);
          }
          return out;
        }
      }
    } catch (e) {
      console.warn('save load failed', e);
    }
    return this.defaults();
  }

  write(now = false) {
    const doWrite = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch {}
    };
    if (now) return doWrite();
    clearTimeout(this._t);
    this._t = setTimeout(doWrite, 400);
  }

  reset() {
    this.data = this.defaults();
    this.write(true);
  }

  get currentCar() {
    return this.data.garage[this.data.current];
  }

  owns(id) {
    return this.data.garage.some((g) => g.id === id);
  }
}

export class Progression {
  constructor(game, save) {
    this.game = game;
    this.save = save;
  }

  addCredits(n, reason = '') {
    const d = this.save.data;
    d.credits = Math.max(0, Math.round(d.credits + n));
    this.save.write();
    if (n > 0 && reason) this.game.hud?.toast(`+${n.toLocaleString('en-US')} CR`, reason, 'gold', 2600);
  }

  addXP(n, reason = '') {
    const d = this.save.data;
    d.xp += Math.round(n);
    let leveled = false;
    while (d.xp >= xpForLevel(d.level)) {
      d.xp -= xpForLevel(d.level);
      d.level++;
      d.wheelspins++;
      leveled = true;
    }
    this.save.write();
    if (leveled) {
      this.game.hud?.bigMessage(`LEVEL ${d.level}`, 'Wheelspin earned!', 2600, 'pink');
      this.game.audio?.ui('levelup');
      this.game.hud?.toast('LEVEL UP', `You are now level ${d.level} · +1 Wheelspin`, 'gold', 4000);
    } else if (reason) this.game.hud?.toast(`+${Math.round(n).toLocaleString('en-US')} XP`, reason, 'info', 2200);
  }

  levelProgress() {
    const d = this.save.data;
    return { level: d.level, xp: d.xp, need: xpForLevel(d.level), frac: d.xp / xpForLevel(d.level) };
  }

  buyCar(id) {
    const spec = CAR_BY_ID[id];
    const d = this.save.data;
    if (!spec || d.credits < spec.price) return false;
    d.credits -= spec.price;
    d.garage.push({ id, paint: { color: spec.color, finish: 'gloss' } });
    this.save.write(true);
    return true;
  }

  giveCar(id) {
    const spec = CAR_BY_ID[id];
    this.save.data.garage.push({ id, paint: { color: spec.color, finish: 'gloss' } });
    this.save.write(true);
  }

  // wheelspin prizes
  rollPrize(rnd = Math.random) {
    const r = rnd();
    const owned = new Set(this.save.data.garage.map((g) => g.id));
    if (r < 0.18) {
      const pool = CARS.filter((c) => c.price < 500000);
      const car = pool[Math.floor(rnd() * pool.length)];
      return { type: 'car', id: car.id, label: car.name, rarity: car.price > 150000 ? 'legendary' : car.price > 80000 ? 'epic' : 'rare', dup: owned.has(car.id) };
    }
    const tiers = [
      { amt: 5000, rarity: 'common', p: 0.3 },
      { amt: 10000, rarity: 'common', p: 0.24 },
      { amt: 25000, rarity: 'rare', p: 0.16 },
      { amt: 50000, rarity: 'epic', p: 0.08 },
      { amt: 100000, rarity: 'epic', p: 0.03 },
      { amt: 250000, rarity: 'legendary', p: 0.01 },
    ];
    let acc = 0;
    const x = rnd() * tiers.reduce((a, t) => a + t.p, 0);
    for (const t of tiers) {
      acc += t.p;
      if (x <= acc) return { type: 'credits', amt: t.amt, label: `${t.amt.toLocaleString('en-US')} CR`, rarity: t.rarity };
    }
    return { type: 'credits', amt: 5000, label: '5,000 CR', rarity: 'common' };
  }

  applyPrize(p) {
    if (p.type === 'credits') this.addCredits(p.amt);
    else if (p.type === 'car') {
      if (p.dup) this.addCredits(Math.round(CAR_BY_ID[p.id].price * 0.25));
      else this.giveCar(p.id);
    }
  }
}
