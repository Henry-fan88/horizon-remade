// Car database. Every car is a licensed, attributed real-car model (see
// public/models/*/ATTRIBUTION.md); physics comes from the specs below.
// 0-100 / 0-200 times are measured by driving the physics (see carperf.js).
import { piClass } from '../config.js';
import { IMPORTED_CARS } from './modelcatalog.js';

// ------------------------------------------------------------------ chassis + model fitting
// Car space: +Z forward, +X left (left-hand drive), +Y up, ground at y = 0, z = 0 midway
// between the axles. Dimensions drive the physics (collision box, suspension mounts), so
// they match each prepared model rather than being tuned by eye.
//   cockpit.eye      driver's eye point for the in-car camera
//   cockpit.wheel    where the steering wheel sits: centre, column axis (pointing at the
//                    driver) and rim radius; the model's wheel is cut out there so it can turn
//   cockpit.ratio    steering ratio from the front wheels to the steering wheel
//   views            hood / bumper camera points [y, z]
export const STYLES = {
  // Ferrari 458: the GLB is already at real scale (2.65 m wheelbase, 1.67 m front track).
  gt: {
    visualAsset: 'ferrari-458',
    L: 4.533, W: 1.937, H: 1.21, WB: 2.65, fo: 1.112, ro: 0.771,
    wheelR: 0.352, wheelRr: 0.358, wheelW: 0.247, wheelWr: 0.272, trackF: 1.671, trackR: 1.646, sill: 0.15,
    headlight: { y: 0.68 },
    rimColor: '#c9c9c9', caliperColor: '#c0101a',
    cockpit: { eye: [0.36, 1.0, 0.02], fov: 72, ratio: 11.5 },
    views: { hood: [0.93, 1.35], bumper: [0.45, 2.45] },
  },
  shelby: fromAsset('shelby-gt500', {
    sill: 0.171, headlight: { y: 0.805 },
    rimColor: '#2a2a2c', caliperColor: '#e05a10',
    cockpit: { eye: [0.37, 1.1, -0.26], fov: 70, ratio: 15.5 },
    views: { hood: [1.1, 1.3], bumper: [0.5, 2.31] },
  }),
  gt3: fromAsset('porsche-911-gt3', {
    sill: 0.151, headlight: { y: 0.683 },
    rimColor: '#c9c9c9', caliperColor: '#c0101a',
    cockpit: { eye: [0.36, 1.05, -0.38], fov: 72, ratio: 13.8 },
    views: { hood: [0.95, 1.3], bumper: [0.45, 2.27] },
  }),
  // Ground-effect era cars: central cockpit, halo, TV airbox camera and nose camera.
  f1: modernFormulaStyle('mclaren-mcl60', [0, .89, .28], [1.26, -.1], [0, .637, .717]),
  sf23: modernFormulaStyle('ferrari-sf23', [0, .88, .24], [1.23, -.17], [0, .62, .68]),
  rb19: modernFormulaStyle('redbull-rb19', [0, .91, .34], [1.31, -.04], [0, .653, .813]),
  fastback: fromAsset('mustang-fastback', {
    sill: 0.169, headlight: { y: 0.796 },
    rimColor: '#2a2a2c', caliperColor: '#e05a10',
    cockpit: { eye: [0.36, 1.12, -0.38], fov: 70, ratio: 17 },
    views: { hood: [1.04, 1.3], bumper: [0.5, 2.3] },
  }),
};

// Prepared Sketchfab models carry their measured dimensions (tools/car-assets/prepare.py).
function fromAsset(id, extra) {
  return { ...IMPORTED_CARS[id].geometry, visualAsset: id, ...extra };
}

function modernFormulaStyle(id, eye, tv, wheel) {
  const geometry = IMPORTED_CARS[id].geometry;
  return fromAsset(id, {
    sill: .06, headlight: { y: .36 }, openWheel: true, livery: true,
    rimColor: '#2a2a2c', caliperColor: '#2a2a2c',
    cockpit: { eye, fov: 76, ratio: 8, formulaWheel: wheel },
    views: { hood: tv, bumper: [.28, geometry.WB / 2 + geometry.fo + .04] },
  });
}

// ------------------------------------------------------------------ cars
// powerKW, torque shape (tqPeak / tqFall), mass (kg), topKmh target, grip (tyre mu),
// downforce ClA. Power and mass are representative road-car figures; suspension, grip,
// gearing and prices are game tuning.
const FORMULA_TUNE = {
  price: 2500000, mass: 798, powerKW: 735, redline: 13000, idle: 3500,
  tqPeak: .68, tqFall: .12, turbo: true, drive: 'RWD', topKmh: 340,
  grip: 1.42, ClA: 3.2, cgH: .29, wf: .45, gears: 8, firstGear: 2.2,
  susp: 3.6, travel: .08, offroad: .02, sound: 'v6f1', formula: true,
  steerScale: .85, launchRpm: 9500,
};
const RAW = [
  { id: 'fastback', make: 'Ford', model: 'Mustang Fastback', year: 1967, style: 'fastback', color: '#20252b', price: 68000, mass: 1360, powerKW: 168, redline: 6000, tqPeak: 0.54, tqFall: 0.34, turbo: false, drive: 'RWD', topKmh: 205, grip: 0.93, ClA: 0.05, cgH: 0.54, wf: 0.55, gears: 4, susp: 1.55, travel: 0.25, offroad: 0.35, sound: 'v8classic' },
  // Ferrari 458 Italia: 4.5 L naturally aspirated flat-plane V8, 570 CV (419 kW) at 9,000 rpm,
  // 1,380 kg dry, 42/58 weight distribution, 7-speed dual clutch, top speed 325 km/h.
  { id: 'gt', make: 'Ferrari', model: '458 Italia', year: 2009, style: 'gt', color: '#c81d25', price: 145000, mass: 1380, powerKW: 419, redline: 9000, tqPeak: 0.67, tqFall: 0.14, turbo: false, drive: 'RWD', topKmh: 325, grip: 1.08, ClA: 0.6, cgH: 0.44, wf: 0.42, gears: 7, susp: 2.2, travel: 0.18, offroad: 0.25, sound: 'v8flat' },
  // Shelby GT500: 5.2 L supercharged cross-plane V8, 760 hp (567 kW), 7-speed dual clutch.
  { id: 'shelby', make: 'Ford', model: 'Mustang Shelby GT500', year: 2020, style: 'shelby', color: '#175ca6', price: 125000, mass: 1916, powerKW: 567, redline: 7500, tqPeak: 0.66, tqFall: 0.18, turbo: false, supercharged: true, drive: 'RWD', topKmh: 290, grip: 1.1, ClA: 0.65, cgH: 0.51, wf: 0.56, gears: 7, susp: 2.05, travel: 0.2, offroad: 0.25, sound: 'v8sc' },
  // 2023 V6 turbo cars. Eight gears and 798 kg follow contemporary specifications;
  // combined power, aero and tyre values are a balanced game tune, not telemetry.
  // Keep 'f1' as the McLaren ID so existing ownership, selection and records survive.
  { id: 'f1', make: 'McLaren', model: 'MCL60', year: 2023, style: 'f1', color: '#ff8000', ...FORMULA_TUNE },
  { id: 'sf23', make: 'Ferrari', model: 'SF23', year: 2023, style: 'sf23', color: '#e02129', ...FORMULA_TUNE },
  { id: 'rb19', make: 'Red Bull', model: 'RB19', year: 2023, style: 'rb19', color: '#13233e', ...FORMULA_TUNE },
  // 911 GT3 (992): 4.0 L naturally aspirated flat-six, 510 PS (375 kW), 9,000 rpm, PDK.
  { id: 'gt3', make: 'Porsche', model: '911 GT3', year: 2022, style: 'gt3', color: '#5f969e', price: 210000, mass: 1435, powerKW: 375, redline: 9000, tqPeak: 0.68, tqFall: 0.13, turbo: false, drive: 'RWD', topKmh: 318, grip: 1.16, ClA: 1.1, cgH: 0.43, wf: 0.39, gears: 7, susp: 2.35, travel: 0.17, offroad: 0.2, sound: 'flat6' },
];

// ------------------------------------------------------------------ derived specs

// Normalised torque vs rpm as a fraction of redline. peak: where torque peaks; fall: how
// much is lost from there to the redline (high-revving NA engines hold on much better).
export function torqueCurve(x, peak = 0.62, fall = 0.36) {
  if (x < peak) return 0.58 + 0.42 * Math.sin((Math.PI / 2) * (x / peak));
  return 1 - fall * Math.pow((x - peak) / (1 - peak), 1.7);
}

// Ambient civilian cars share the spec calculation, but never enter the playable roster.
export function deriveCarSpec(raw, style = STYLES[raw.style]) {
  const car = { ...raw, styleName: raw.style, style };
  const idle = raw.electric ? 0 : raw.idle ?? 900;
  car.idle = idle;
  // peak torque such that max(T * omega) == rated power
  let best = 0;
  for (let i = 1; i <= 100; i++) {
    const x = i / 100;
    const w = ((x * raw.redline) / 60) * Math.PI * 2;
    best = Math.max(best, torqueCurve(x, raw.tqPeak, raw.tqFall) * w);
  }
  car.peakTorque = raw.electric ? (raw.powerKW * 1000) / ((raw.redline * 0.3 * Math.PI * 2) / 60) : (raw.powerKW * 1000) / best;
  const topV = raw.topKmh / 3.6;
  const r = style.wheelRr ?? style.wheelR;
  // gearbox: geometric ratios, final drive to hit top speed at ~97% redline in top gear
  const n = raw.gears;
  const first = raw.electric ? 1 : raw.firstGear ?? 3.4;
  const last = raw.electric ? 1 : 0.72;
  const ratios = [];
  for (let i = 0; i < n; i++) ratios.push(n === 1 ? 1 : first * Math.pow(last / first, i / (n - 1)));
  car.ratios = ratios;
  const wRed = (raw.redline * 0.97 * Math.PI * 2) / 60;
  car.finalDrive = (wRed * r) / (topV * ratios[n - 1]);
  // drag so that power-limited top speed matches
  const eff = 0.86;
  car.CdA = (2 * raw.powerKW * 1000 * eff * 0.92) / (1.225 * topV * topV * topV);
  car.ClA = raw.ClA;
  car.brake = 1.25 + (raw.grip - 1) * 0.8;
  // stat bars; acceleration and launch are filled in from the measured 0-100 time
  const speedScore = Math.min(10, (raw.topKmh - 150) / 26);
  const handlingScore = Math.min(10, (raw.grip - 0.8) * 16 + raw.ClA * 1.6 + (1500 - raw.mass) / 600);
  const brakeScore = Math.min(10, (car.brake - 1.0) * 14 + (1600 - raw.mass) / 350);
  const offroadScore = Math.min(10, raw.offroad * 10);
  car.stats = { speed: speedScore, handling: handlingScore, acceleration: 0, launch: 0, braking: brakeScore, offroad: offroadScore };
  car.zeroTo100 = null;
  car.zeroTo200 = null;
  const kwPerTonne = raw.powerKW / (raw.mass / 1000);
  const f = Math.pow(Math.min(1, Math.max(0, (kwPerTonne - 60) / 400)), 0.7);
  const gScore = Math.min(1, Math.max(0, (raw.grip - 0.85) / 0.4 + raw.ClA * 0.1));
  const hScore = Math.min(1, Math.max(0, (raw.topKmh - 180) / 220));
  const score = 0.5 * f + 0.3 * gScore + 0.2 * hScore + (raw.offroad ?? 0) * 0.06;
  car.pi = Math.max(100, Math.min(999, Math.round(400 + score * 599)));
  car.cls = piClass(car.pi);
  car.name = `${raw.make} ${raw.model}`;
  return car;
}

// Acceleration / launch stat bars from a measured 0-100 km/h time (seconds).
export function rateAcceleration(car) {
  const accel = Math.min(10, Math.max(1, (9.5 - car.zeroTo100) * 1.45));
  car.stats.acceleration = accel;
  car.stats.launch = Math.min(10, accel * 0.7 + (car.drive === 'AWD' ? 3 : 1));
}

export const CARS = RAW.map(raw => deriveCarSpec(raw));
export const CAR_BY_ID = Object.fromEntries(CARS.map((c) => [c.id, c]));

export const PAINTS = [
  '#c81d25', '#e21d6e', '#ff5a1f', '#ffb300', '#f5e663', '#7ac943', '#1f9e5a', '#18b7c9',
  '#1f5fff', '#2b3ac4', '#6a2bd9', '#101418', '#3a3d42', '#8d9096', '#d7d9dc', '#f7f7f5',
];
export const RIM_COLORS = ['#c9c9c9', '#1a1a1c', '#d4af37', '#2b2b30', '#f2f2f2', '#b0271e'];
