// Car database: body styles (for the procedural model) + physics specs.
// The GT uses a Ferrari 458 visual; the other makes/models are fictional.
// All performance specs retain the draft game's tuning, including the GT.
import { piClass } from '../config.js';

// ------------------------------------------------------------------ body styles
// All z values in metres, rear (-) to front (+), relative to the wheelbase centre.
export const STYLES = {
  supercar: {
    L: 4.7, W: 2.03, H: 1.14, WB: 2.7, fo: 1.1, ro: 0.9,
    wheelR: 0.345, wheelRr: 0.36, wheelW: 0.26, wheelWr: 0.33, trackF: 1.72, trackR: 1.7, sill: 0.14,
    top: [[-2.25, 0.84], [-2.05, 0.98], [-1.3, 1.02], [-0.5, 1.13], [0.08, 1.13], [0.95, 0.83], [1.6, 0.71], [2.05, 0.6], [2.45, 0.45]],
    belt: [[-2.25, 0.8], [-1.6, 0.97], [-0.6, 0.9], [0.4, 0.84], [1.2, 0.76], [1.9, 0.66], [2.45, 0.44]],
    width: [[-2.25, 0.93], [-1.35, 1.015], [-0.75, 0.99], [0.0, 0.96], [0.85, 0.99], [1.35, 1.0], [2.45, 0.92]],
    roofW: [[-2.25, 0.5], [-1.25, 0.6], [-0.5, 0.57], [0.1, 0.58], [0.95, 0.74], [2.45, 0.74]],
    cabin: { a: 0.97, b: 0.1, c: -0.5, d: -1.28 }, cPillar: 0.25,
    noseP: 5, tailP: 7, noseMinW: 0.5, tailMinW: 0.7, noseLift: 0.08, tailLift: 0.1,
    headlight: { type: 'slit', w: 0.44, h: 0.07, y: 0.62, inset: 0.3, back: 0.32, yaw: 0.55, pitch: -0.55, drl: true },
    taillight: { type: 'strip', h: 0.05, y: 0.84 },
    grilleW: 1.2, grilleH: 0.14, grilleY: 0.26, sideIntake: true, diffuser: true,
    exhaust: { n: 2, spread: 0.12, r: 0.05, y: 0.42 },
    rimStyle: 'split', spokes: 5, rimColor: '#1a1a1c', caliperColor: '#f0c000', plateY: 0.5,
  },
  gt: {
    visualAsset: 'ferrari-458',
    L: 4.55, W: 1.92, H: 1.29, WB: 2.55, fo: 0.95, ro: 1.05,
    wheelR: 0.34, wheelRr: 0.35, wheelW: 0.25, wheelWr: 0.3, trackF: 1.6, trackR: 1.6, sill: 0.15,
    top: [[-2.325, 0.86], [-2.12, 0.98], [-1.7, 1.02], [-1.05, 1.16], [-0.35, 1.29], [0.12, 1.28], [0.78, 0.97], [1.5, 0.84], [1.95, 0.76], [2.225, 0.6]],
    belt: [[-2.325, 0.84], [-1.6, 0.97], [-0.6, 0.92], [0.5, 0.9], [1.2, 0.84], [1.9, 0.74], [2.225, 0.6]],
    width: [[-2.325, 0.86], [-1.55, 0.96], [-0.9, 0.95], [0, 0.92], [0.9, 0.93], [1.3, 0.95], [2.225, 0.86]],
    roofW: [[-2.325, 0.45], [-1.3, 0.55], [-0.4, 0.62], [0.15, 0.62], [0.78, 0.72], [2.225, 0.72]],
    cabin: { a: 0.8, b: 0.12, c: -0.4, d: -1.35 }, cPillar: 0.2,
    noseP: 5, tailP: 5, noseMinW: 0.5, tailMinW: 0.6,
    headlight: { type: 'slit', w: 0.36, h: 0.11, y: 0.68, inset: 0.28, back: 0.3, yaw: 0.5, pitch: -0.45, drl: true },
    taillight: { type: 'pair', w: 0.36, h: 0.07, y: 0.88, inset: 0.3, yaw: -0.35 },
    grilleW: 0.9, grilleH: 0.2, grilleY: 0.33, lipSpoiler: true,
    exhaust: { n: 4, spread: 0.6, r: 0.042, y: 0.26 }, diffuser: true,
    rimStyle: 'fivespoke', spokes: 5, rimColor: '#c9c9c9', caliperColor: '#c0101a',
  },
  jdm: {
    L: 4.6, W: 1.8, H: 1.36, WB: 2.66, fo: 0.9, ro: 1.04,
    wheelR: 0.33, wheelW: 0.25, trackF: 1.51, trackR: 1.5, sill: 0.16,
    top: [[-2.37, 0.96], [-2.25, 1.04], [-1.35, 1.07], [-1.05, 1.18], [-0.5, 1.36], [0.28, 1.36], [0.92, 1.0], [1.6, 0.92], [2.1, 0.86], [2.23, 0.72]],
    belt: [[-2.37, 0.97], [-1.25, 0.99], [0.5, 0.95], [1.4, 0.9], [2.0, 0.86], [2.23, 0.72]],
    width: [[-2.37, 0.86], [-1.3, 0.9], [0, 0.885], [1.3, 0.9], [2.23, 0.86]],
    roofW: [[-2.37, 0.6], [-1.2, 0.62], [-0.5, 0.64], [0.28, 0.64], [0.92, 0.74], [2.23, 0.74]],
    cabin: { a: 0.94, b: 0.28, c: -0.5, d: -1.18 }, cPillar: 0.3,
    noseP: 8, tailP: 10, noseMinW: 0.75, tailMinW: 0.85, noseLift: 0.06, tailLift: 0.08,
    headlight: { type: 'slit', w: 0.36, h: 0.12, y: 0.78, inset: 0.26, back: 0.08, yaw: 0.25, pitch: -0.2 },
    taillight: { type: 'round', h: 0.12, y: 0.86, inset: 0.26 },
    grilleW: 0.8, grilleH: 0.14, grilleY: 0.52,
    wing: { z: -2.12, y: 1.24, chord: 0.3, spanK: 0.94 }, trimGloss: true,
    exhaust: { n: 1, r: 0.06, y: 0.28 },
    rimStyle: 'mesh', spokes: 12, rimColor: '#d9d9d9', caliperColor: '#c0101a',
  },
  muscle: {
    L: 5.0, W: 1.93, H: 1.36, WB: 2.95, fo: 0.98, ro: 1.07,
    wheelR: 0.36, wheelW: 0.26, wheelWr: 0.3, trackF: 1.62, trackR: 1.62, sill: 0.17,
    top: [[-2.545, 0.98], [-2.35, 1.04], [-1.5, 1.07], [-1.05, 1.22], [-0.5, 1.36], [0.35, 1.36], [0.95, 1.02], [1.8, 0.98], [2.3, 0.94], [2.455, 0.76]],
    belt: [[-2.545, 1.0], [-1.4, 1.02], [0.5, 1.0], [1.8, 0.97], [2.455, 0.8]],
    width: [[-2.545, 0.9], [-1.5, 0.965], [0, 0.95], [1.4, 0.955], [2.455, 0.9]],
    roofW: [[-2.545, 0.6], [-1.2, 0.62], [-0.5, 0.66], [0.35, 0.66], [0.95, 0.76], [2.455, 0.76]],
    cabin: { a: 0.97, b: 0.35, c: -0.5, d: -1.12 }, cPillar: 0.35,
    noseP: 9, tailP: 10, noseMinW: 0.8, tailMinW: 0.86, noseLift: 0.05, tailLift: 0.08, fenderRise: 0.04,
    headlight: { type: 'round', w: 0.19, h: 0.19, y: 0.8, inset: 0.2, back: 0.02, yaw: 0, pitch: 0, forward: 0.0 },
    taillight: { type: 'strip', h: 0.1, y: 0.9 },
    grilleW: 1.3, grilleH: 0.26, grilleY: 0.7, hoodScoop: true, lipSpoiler: true,
    exhaust: { n: 2, spread: 0.62, r: 0.055, y: 0.3 },
    rimStyle: 'fivespoke', spokes: 5, rimColor: '#2a2a2c', caliperColor: '#e05a10',
  },
  rally: {
    L: 4.25, W: 1.86, H: 1.46, WB: 2.62, fo: 0.88, ro: 0.75,
    wheelR: 0.33, wheelW: 0.24, trackF: 1.6, trackR: 1.6, sill: 0.24,
    top: [[-2.06, 1.02], [-1.95, 1.3], [-1.5, 1.44], [-0.6, 1.46], [0.25, 1.46], [0.95, 1.06], [1.6, 0.96], [2.05, 0.84], [2.19, 0.7]],
    belt: [[-2.06, 1.0], [-1.6, 1.04], [0.0, 1.0], [1.3, 0.95], [2.19, 0.72]],
    width: [[-2.06, 0.88], [-1.3, 0.93], [0, 0.9], [1.3, 0.93], [2.19, 0.86]],
    roofW: [[-2.06, 0.62], [-1.5, 0.64], [0.25, 0.66], [0.95, 0.76], [2.19, 0.76]],
    cabin: { a: 0.97, b: 0.25, c: -1.5, d: -1.96 }, cPillar: 0.15, bPillar: -0.45,
    noseP: 6, tailP: 12, noseMinW: 0.62, tailMinW: 0.9, noseLift: 0.06, tailLift: 0.05,
    headlight: { type: 'slit', w: 0.34, h: 0.13, y: 0.8, inset: 0.26, back: 0.18, yaw: 0.4, pitch: -0.3 },
    taillight: { type: 'pair', w: 0.14, h: 0.3, y: 1.0, inset: 0.12, yaw: 0 },
    grilleW: 0.9, grilleH: 0.2, grilleY: 0.52, roofScoop: true,
    wing: { z: -1.95, y: 1.52, chord: 0.36, spanK: 0.92, angle: 0.1 },
    exhaust: { n: 1, r: 0.06, y: 0.36 },
    rimStyle: 'offroad', spokes: 6, rimColor: '#f2f2f2', caliperColor: '#1a50ff', plateY: 0.62,
  },
  hatch: {
    L: 4.26, W: 1.8, H: 1.45, WB: 2.63, fo: 0.9, ro: 0.73,
    wheelR: 0.32, wheelW: 0.23, trackF: 1.55, trackR: 1.53, sill: 0.18,
    top: [[-2.045, 1.0], [-1.95, 1.28], [-1.45, 1.43], [-0.6, 1.45], [0.25, 1.45], [0.98, 1.02], [1.7, 0.92], [2.1, 0.82], [2.215, 0.66]],
    belt: [[-2.045, 0.98], [-1.5, 1.0], [0.0, 0.96], [1.3, 0.9], [2.215, 0.68]],
    width: [[-2.045, 0.86], [-1.3, 0.9], [0, 0.89], [1.3, 0.9], [2.215, 0.84]],
    roofW: [[-2.045, 0.6], [-1.5, 0.64], [0.25, 0.66], [0.98, 0.74], [2.215, 0.74]],
    cabin: { a: 1.0, b: 0.25, c: -1.45, d: -1.95 }, cPillar: 0.2, bPillar: -0.4,
    noseP: 6, tailP: 12, noseMinW: 0.6, tailMinW: 0.9,
    headlight: { type: 'slit', w: 0.38, h: 0.11, y: 0.76, inset: 0.24, back: 0.16, yaw: 0.35, pitch: -0.3, drl: true },
    taillight: { type: 'pair', w: 0.3, h: 0.12, y: 0.98, inset: 0.18, yaw: -0.2 },
    grilleW: 0.95, grilleH: 0.12, grilleY: 0.62, lipSpoiler: true,
    exhaust: { n: 2, spread: 0.4, r: 0.045, y: 0.28 },
    rimStyle: 'fivespoke', spokes: 10, rimColor: '#3a3a3e', caliperColor: '#c0101a',
  },
  truck: {
    L: 5.6, W: 2.2, H: 1.98, WB: 3.7, fo: 1.0, ro: 0.9,
    wheelR: 0.45, wheelW: 0.32, trackF: 1.9, trackR: 1.9, sill: 0.5, archGap: 0.08,
    top: [[-2.75, 1.4], [-1.2, 1.42], [-1.05, 1.5], [-0.85, 1.98], [0.3, 1.98], [0.95, 1.55], [2.2, 1.48], [2.75, 1.28]],
    belt: [[-2.75, 1.38], [-1.1, 1.42], [0.5, 1.46], [2.2, 1.44], [2.75, 1.26]],
    width: [[-2.75, 1.03], [-1.8, 1.1], [0, 1.08], [1.8, 1.1], [2.75, 1.02]],
    roofW: [[-2.75, 0.9], [-0.85, 0.82], [0.3, 0.84], [0.95, 0.9], [2.75, 0.9]],
    cabin: { a: 1.0, b: 0.3, c: -0.85, d: -1.02 }, cPillar: 0.1, bPillar: -0.25, rearGlass: true,
    noseP: 10, tailP: 14, noseMinW: 0.86, tailMinW: 0.92, noseLift: 0.08, tailLift: 0.06,
    headlight: { type: 'slit', w: 0.4, h: 0.16, y: 1.24, inset: 0.3, back: 0.05, yaw: 0.15, pitch: 0, drl: true },
    taillight: { type: 'pair', w: 0.12, h: 0.42, y: 1.1, inset: 0.08, yaw: 0 },
    grilleW: 1.5, grilleH: 0.42, grilleY: 1.0, lightBar: true, bedCover: true,
    exhaust: { n: 1, r: 0.065, y: 0.55 },
    rimStyle: 'offroad', spokes: 6, rimColor: '#1c1c1c', caliperColor: '#1c1c1c', plateY: 0.85,
  },
  hyper: {
    L: 4.85, W: 2.06, H: 1.08, WB: 2.75, fo: 1.12, ro: 0.98,
    wheelR: 0.345, wheelRr: 0.365, wheelW: 0.27, wheelWr: 0.34, trackF: 1.72, trackR: 1.7, sill: 0.1,
    top: [[-2.355, 0.76], [-2.15, 0.94], [-1.35, 1.0], [-0.55, 1.08], [0.05, 1.08], [0.95, 0.78], [1.65, 0.66], [2.1, 0.55], [2.495, 0.38]],
    belt: [[-2.355, 0.74], [-1.6, 0.96], [-0.6, 0.88], [0.4, 0.8], [1.2, 0.72], [1.9, 0.6], [2.495, 0.38]],
    width: [[-2.355, 0.95], [-1.4, 1.03], [-0.75, 0.98], [0.0, 0.93], [0.85, 0.98], [1.35, 1.02], [2.495, 0.9]],
    roofW: [[-2.355, 0.45], [-1.3, 0.55], [-0.55, 0.52], [0.05, 0.55], [0.95, 0.72], [2.495, 0.72]],
    cabin: { a: 0.97, b: 0.06, c: -0.55, d: -1.25 }, cPillar: 0.3, roofColor: 'trim',
    noseP: 4, tailP: 6, noseMinW: 0.45, tailMinW: 0.75, noseLift: 0.06, tailLift: 0.12,
    headlight: { type: 'slit', w: 0.36, h: 0.06, y: 0.52, inset: 0.32, back: 0.36, yaw: 0.6, pitch: -0.7, drl: true },
    taillight: { type: 'strip', h: 0.035, y: 0.86 },
    grilleW: 1.3, grilleH: 0.12, grilleY: 0.2, sideIntake: true, diffuser: true,
    wing: { z: -2.0, y: 1.17, chord: 0.36, spanK: 0.86, angle: 0.08 }, wingPaint: false,
    exhaust: { n: 1, r: 0.07, y: 0.62 },
    rimStyle: 'turbine', spokes: 10, rimColor: '#2b2b30', caliperColor: '#1f7aff',
  },
  classic: {
    L: 4.35, W: 1.72, H: 1.24, WB: 2.4, fo: 0.95, ro: 1.0,
    wheelR: 0.32, wheelW: 0.2, trackF: 1.42, trackR: 1.42, sill: 0.18,
    top: [[-2.2, 0.8], [-1.95, 0.9], [-1.3, 0.94], [-0.8, 1.1], [-0.4, 1.24], [0.1, 1.24], [0.55, 0.92], [1.3, 0.84], [1.9, 0.76], [2.15, 0.58]],
    belt: [[-2.2, 0.8], [-1.3, 0.9], [-0.3, 0.88], [0.6, 0.86], [1.4, 0.82], [2.15, 0.6]],
    width: [[-2.2, 0.78], [-1.3, 0.86], [-0.6, 0.83], [0.2, 0.82], [1.2, 0.86], [2.15, 0.74]],
    roofW: [[-2.2, 0.5], [-0.8, 0.54], [0.1, 0.58], [0.55, 0.66], [2.15, 0.66]],
    cabin: { a: 0.58, b: 0.12, c: -0.4, d: -0.95 }, cPillar: 0.1, pillarColor: 'paint',
    noseP: 3, tailP: 3, noseMinW: 0.3, tailMinW: 0.35, noseLift: 0.1, tailLift: 0.12,
    headlight: { type: 'round', w: 0.17, h: 0.17, y: 0.66, inset: 0.24, back: 0.3, yaw: 0.3, pitch: -0.2 },
    taillight: { type: 'round', h: 0.09, y: 0.76, inset: 0.2 },
    grilleW: 0.55, grilleH: 0.2, grilleY: 0.42,
    exhaust: { n: 2, spread: 0.15, r: 0.035, y: 0.25 },
    rimStyle: 'mesh', spokes: 16, rimColor: '#e0e0e0', caliperColor: '#333333',
  },
  sedan: {
    L: 4.95, W: 1.96, H: 1.44, WB: 2.96, fo: 0.95, ro: 1.04,
    wheelR: 0.35, wheelW: 0.25, trackF: 1.66, trackR: 1.66, sill: 0.15,
    top: [[-2.52, 0.98], [-2.35, 1.04], [-1.7, 1.08], [-1.05, 1.36], [-0.5, 1.44], [0.35, 1.44], [1.0, 1.02], [1.8, 0.88], [2.3, 0.78], [2.43, 0.62]],
    belt: [[-2.52, 0.98], [-1.6, 1.02], [0.3, 0.98], [1.4, 0.9], [2.43, 0.64]],
    width: [[-2.52, 0.9], [-1.5, 0.975], [0, 0.97], [1.4, 0.975], [2.43, 0.9]],
    roofW: [[-2.52, 0.55], [-1.2, 0.6], [-0.5, 0.68], [0.35, 0.68], [1.0, 0.78], [2.43, 0.78]],
    cabin: { a: 1.02, b: 0.35, c: -0.5, d: -1.62 }, cPillar: 0.25, roofColor: 'glass',
    noseP: 5, tailP: 6, noseMinW: 0.55, tailMinW: 0.65,
    headlight: { type: 'slit', w: 0.5, h: 0.06, y: 0.76, inset: 0.2, back: 0.22, yaw: 0.45, pitch: -0.4, drl: true },
    taillight: { type: 'strip', h: 0.05, y: 1.0 },
    grilleW: 1.2, grilleH: 0.1, grilleY: 0.34, plates: true,
    exhaust: { n: 0 },
    rimStyle: 'turbine', spokes: 7, rimColor: '#8d8d93', caliperColor: '#cc1111',
  },
};

// ------------------------------------------------------------------ cars
// powerKW, torque (Nm), mass (kg), topKmh target, grip (tyre mu), downforce ClA
const RAW = [
  { id: 'rally', make: 'Nordhaven', model: 'Rally RS', year: 2019, style: 'rally', color: '#1f5fff', price: 38000, mass: 1330, powerKW: 221, redline: 7400, turbo: true, drive: 'AWD', split: 0.45, topKmh: 225, grip: 1.02, ClA: 0.35, cgH: 0.5, wf: 0.58, gears: 6, susp: 1.5, travel: 0.26, offroad: 0.85, sound: 'boxer' },
  { id: 'hatch', make: 'Maxwell', model: 'Volt GTI', year: 2021, style: 'hatch', color: '#e8e8ea', price: 28000, mass: 1350, powerKW: 180, redline: 6800, turbo: true, drive: 'FWD', topKmh: 245, grip: 0.98, ClA: 0.15, cgH: 0.52, wf: 0.62, gears: 6, susp: 1.9, travel: 0.2, offroad: 0.45, sound: 'i4' },
  { id: 'jdm', make: 'Arashi', model: 'GT-R34 Kaze', year: 2002, style: 'jdm', color: '#2b3ac4', price: 72000, mass: 1560, powerKW: 250, redline: 8000, turbo: true, drive: 'AWD', split: 0.35, topKmh: 262, grip: 1.03, ClA: 0.4, cgH: 0.49, wf: 0.56, gears: 6, susp: 2.0, travel: 0.2, offroad: 0.35, sound: 'i6' },
  { id: 'gt', make: 'Ferrari', model: '458 Italia', year: 2009, style: 'gt', color: '#c81d25', price: 145000, mass: 1480, powerKW: 390, redline: 7600, turbo: true, drive: 'RWD', topKmh: 312, grip: 1.08, ClA: 0.6, cgH: 0.46, wf: 0.46, gears: 7, susp: 2.2, travel: 0.18, offroad: 0.25, sound: 'v8' },
  { id: 'muscle', make: 'Brute', model: 'Hellstorm 392', year: 2022, style: 'muscle', color: '#b3121a', price: 82000, mass: 1920, powerKW: 527, redline: 6400, turbo: false, drive: 'RWD', topKmh: 318, grip: 1.0, ClA: 0.25, cgH: 0.52, wf: 0.54, gears: 6, susp: 1.9, travel: 0.2, offroad: 0.3, sound: 'v8' },
  { id: 'supercar', make: 'Veloce', model: 'Tempesta V12', year: 2024, style: 'supercar', color: '#ffb300', price: 420000, mass: 1575, powerKW: 566, redline: 8700, turbo: false, drive: 'AWD', split: 0.3, topKmh: 350, grip: 1.14, ClA: 1.1, cgH: 0.43, wf: 0.43, gears: 7, susp: 2.4, travel: 0.16, offroad: 0.2, sound: 'v12' },
  { id: 'hyper', make: 'Aurora', model: 'Zenith X', year: 2025, style: 'hyper', color: '#e21d6e', price: 2400000, mass: 1420, powerKW: 895, redline: 9000, turbo: true, drive: 'AWD', split: 0.3, topKmh: 402, grip: 1.2, ClA: 1.8, cgH: 0.41, wf: 0.42, gears: 7, susp: 2.6, travel: 0.14, offroad: 0.15, sound: 'v8t' },
  { id: 'truck', make: 'Titan', model: 'Raptor TRX', year: 2023, style: 'truck', color: '#e46b14', price: 95000, mass: 2600, powerKW: 523, redline: 6300, turbo: true, drive: 'AWD', split: 0.45, topKmh: 190, grip: 0.9, ClA: 0.0, cgH: 0.85, wf: 0.56, gears: 8, susp: 1.3, travel: 0.4, offroad: 1.0, sound: 'v8' },
  { id: 'classic', make: 'Siena', model: '250 Corsa', year: 1962, style: 'classic', color: '#a3141c', price: 180000, mass: 1050, powerKW: 175, redline: 7500, turbo: false, drive: 'RWD', topKmh: 250, grip: 0.9, ClA: 0.0, cgH: 0.46, wf: 0.5, gears: 5, susp: 1.6, travel: 0.2, offroad: 0.3, sound: 'v12' },
  { id: 'sedan', make: 'Volta', model: 'S Plaid', year: 2024, style: 'sedan', color: '#101418', price: 110000, mass: 2160, powerKW: 750, redline: 16000, turbo: false, electric: true, drive: 'AWD', split: 0.4, topKmh: 282, grip: 1.05, ClA: 0.2, cgH: 0.45, wf: 0.48, gears: 1, susp: 2.0, travel: 0.18, offroad: 0.3, sound: 'ev' },
];

// ------------------------------------------------------------------ derived specs

export function torqueCurve(x) {
  // normalised torque vs rpm fraction of redline
  if (x < 0.62) return 0.58 + 0.42 * Math.sin((Math.PI / 2) * (x / 0.62));
  return 1 - 0.36 * Math.pow((x - 0.62) / 0.38, 1.7);
}

function derive(raw) {
  const style = STYLES[raw.style];
  const car = { ...raw, styleName: raw.style, style };
  const idle = raw.electric ? 0 : 900;
  car.idle = idle;
  // peak torque such that max(T * omega) == rated power
  let best = 0;
  for (let i = 1; i <= 100; i++) {
    const x = i / 100;
    const w = ((x * raw.redline) / 60) * Math.PI * 2;
    best = Math.max(best, torqueCurve(x) * w);
  }
  car.peakTorque = raw.electric ? (raw.powerKW * 1000) / ((raw.redline * 0.3 * Math.PI * 2) / 60) : (raw.powerKW * 1000) / best;
  const topV = raw.topKmh / 3.6;
  const r = style.wheelRr ?? style.wheelR;
  // gearbox: geometric ratios, final drive to hit top speed at ~97% redline in top gear
  const n = raw.gears;
  const first = raw.electric ? 1 : raw.style === 'truck' ? 4.2 : 3.4;
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
  // estimate 0-100 km/h and PI
  const pw = (raw.powerKW * 1000) / raw.mass; // W/kg
  const tractionG = Math.min(raw.grip * (raw.drive === 'AWD' ? 1.0 : raw.drive === 'RWD' ? 0.62 : 0.6) * 9.81, (pw / 14) * 0.9);
  car.zeroTo100 = Math.max(2.0, 27.8 / tractionG + 0.3 + (raw.turbo ? 0.25 : 0));
  const speedScore = Math.min(10, (raw.topKmh - 150) / 26);
  const accelScore = Math.min(10, Math.max(1, (9.5 - car.zeroTo100) * 1.45));
  const handlingScore = Math.min(10, (raw.grip - 0.8) * 16 + raw.ClA * 1.6 + (1500 - raw.mass) / 600);
  const launchScore = Math.min(10, accelScore * 0.7 + (raw.drive === 'AWD' ? 3 : 1));
  const brakeScore = Math.min(10, (car.brake - 1.0) * 14 + (1600 - raw.mass) / 350);
  const offroadScore = Math.min(10, raw.offroad * 10);
  car.stats = { speed: speedScore, handling: handlingScore, acceleration: accelScore, launch: launchScore, braking: brakeScore, offroad: offroadScore };
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

export const CARS = RAW.map(derive);
export const CAR_BY_ID = Object.fromEntries(CARS.map((c) => [c.id, c]));

export const PAINTS = [
  '#c81d25', '#e21d6e', '#ff5a1f', '#ffb300', '#f5e663', '#7ac943', '#1f9e5a', '#18b7c9',
  '#1f5fff', '#2b3ac4', '#6a2bd9', '#101418', '#3a3d42', '#8d9096', '#d7d9dc', '#f7f7f5',
];
export const RIM_COLORS = ['#c9c9c9', '#1a1a1c', '#d4af37', '#2b2b30', '#f2f2f2', '#b0271e'];
