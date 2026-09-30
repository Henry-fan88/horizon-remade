// Engine sound profiles for the synthesizer in engine-worklet.js.
//   fire       [position in the 720-degree cycle (0..1), exhaust bank] per cylinder, in the
//              real firing order and bank layout; the order shapes the rhythm (a cross-plane
//              V8 fires unevenly on each bank, which is its burble)
//   runners    extra header delay per cylinder (ms): unequal manifolds smear the pulses
//   pulse      exhaust pulse length as a fraction of a crank revolution (sharp .. soft)
//   pipe       tailpipe length (m): its quarter-wave resonances colour the sound
//   resonances muffler / pipe band-passes [Hz, Q, gain]
//   tone/bright content above `tone` Hz is scaled by `bright`
//   intake     induction roar band-passes and airbox resonance; mech = valvetrain ticks
//   sc         supercharger whine (drive ratio x rotor lobes per crank revolution)
//   crackle    chance per firing of an afterfire pop after lifting off at high rpm
//   cabin*     how much boom / intake reaches the driver in the cockpit mix; cabinLp is the
//              low-pass of the exhaust heard inside (a closed cabin ~600 Hz, open cockpit more)
//   shiftCrack strong pulses fired by a dual-clutch upshift's ignition cut (0 = manual box)
//   blip       rev rise of the throttle blip on a paddle downshift (fraction of rpm; 0 = none)
//   orders     optional engine-order partials: [order, weight] list, exhaust / intake formants
//              [Hz, Q, gain], level, base (off-throttle share), rise (rpm exponent), spectral
//              tilt (and how much load lifts the upper orders), random level wander (am)
export const ENGINE_PROFILES = {
  // Ferrari 458: 4.5 L flat-plane V8. Each bank fires evenly every 180 degrees (two
  // four-cylinder engines side by side): a hard rasp low down that turns into a clean,
  // metallic wail up to 9,000 rpm. The pulses give the rasp and the shift "brap"; the
  // engine-order partials carry the wail (4th order = firing frequency, 600 Hz at the
  // limiter), sweeping through the exhaust's resonances; the intake howls in the cabin.
  v8flat: {
    fire: [[0, 0], [0.125, 1], [0.25, 0], [0.375, 1], [0.5, 0], [0.625, 1], [0.75, 0], [0.875, 1]],
    runners: [0, 0.04, 0.02, 0.05, 0.01, 0.03, 0.02, 0.04],
    trim: [0.02, -0.03, 0.01, 0.03, -0.02, 0.0, 0.03, -0.01],
    pulse: 0.13, noise: 0.12, noiseLen: 0.12, drive: 0.55, jitter: 0.06, lope: 0,
    pipe: 1.35, pipeCut: 3200, feedback: 0.45, bankSkew: 1.05,
    resonances: [[240, 2.2, 0.55], [720, 2.8, 0.5], [1450, 3.2, 0.35], [2600, 4, 0.2]],
    direct: 0.55, tone: 900, bright: 1.0, crossover: 0.3,
    intake: { f1: 650, f2: 1600, box: 210, level: 0.1 },
    mech: { f: 5200, level: 0.06 },
    orders: {
      // [crank order, weight]: firing (4) and its harmonics, bank-level 2nd/6th/10th, and
      // weak odd orders from cylinder-to-cylinder spread
      list: [[1, 0.05], [2, 0.3], [3, 0.08], [4, 1], [5, 0.05], [6, 0.18], [8, 0.5], [10, 0.11], [12, 0.36], [14, 0.07], [16, 0.26], [20, 0.16], [24, 0.11], [28, 0.07], [32, 0.05]],
      formants: [[220, 1, 0.6], [560, 1.6, 0.8], [1250, 2.4, 0.55], [2500, 3, 0.4], [4000, 3.5, 0.22]],
      intakeFormants: [[360, 2, 0.8], [880, 2.6, 0.7], [1900, 3, 0.35]],
      floor: 0.25, level: 0.13, intakeLevel: 0.1, base: 0.3, rise: 1.3,
      tilt: 0.35, loadTilt: 0.55, am: 0.18, fmax: 9000,
    },
    sc: null,
    crackle: 0.22, crackleLevel: 0.7, crackleF: 2100,
    boom: 85, cabinBoom: 0.45, cabinIntake: 1.5,
    shiftCrack: 3, blip: 0.22,
    level: 1.0,
  },
  // Shelby GT500: 5.2 L supercharged cross-plane V8 (firing order 1-5-4-8-6-3-7-2, Ford
  // bank 1-4 / 5-8). Uneven pulses on each bank, big bore, supercharger whine, loud pops.
  v8sc: {
    fire: [[0, 0], [0.125, 1], [0.25, 0], [0.375, 1], [0.5, 1], [0.625, 0], [0.75, 1], [0.875, 0]],
    runners: [0.1, 0.35, 0.25, 0.05, 0.3, 0.15, 0.4, 0.2],
    trim: [0.04, -0.05, 0.02, 0.06, -0.03, 0.01, -0.06, 0.03],
    pulse: 0.2, noise: 0.22, noiseLen: 0.16, drive: 0.7, jitter: 0.1, lope: 0.08,
    pipe: 2.6, pipeCut: 1500, feedback: 0.66, bankSkew: 1.09,
    resonances: [[92, 1.4, 0.85], [185, 1.8, 0.6], [420, 2.4, 0.35], [950, 2.8, 0.18]],
    direct: 0.45, tone: 700, bright: 0.85, crossover: 0.32,
    intake: { f1: 420, f2: 1150, box: 150, level: 0.17 },
    mech: { f: 4200, level: 0.08 },
    orders: {
      // cross-plane: firing (4th) with strong 1st/2nd from the uneven bank pulses
      list: [[1, 0.25], [2, 0.5], [3, 0.12], [4, 1], [5, 0.08], [6, 0.22], [8, 0.45], [10, 0.1], [12, 0.25], [16, 0.14], [20, 0.08]],
      formants: [[110, 1, 0.7], [360, 1.5, 0.7], [880, 2.2, 0.45], [2000, 3, 0.22]],
      floor: 0.2, level: 0.07, base: 0.35, rise: 1.2,
      tilt: 0.5, loadTilt: 0.45, am: 0.25, fmax: 6000,
    },
    sc: { ratio: 2.4, lobes: 4, level: 0.07 },
    crackle: 0.3, crackleLevel: 1.0, crackleF: 1400,
    boom: 62, cabinBoom: 0.6, cabinIntake: 1.3,
    shiftCrack: 3, blip: 0.18,
    level: 1.35,
  },
  // Porsche 911 GT3: 4.0 L flat-six (firing order 1-6-2-4-3-5, banks 1-3 / 4-6), each bank
  // evenly every 240 degrees into a crossover exhaust: the metallic flat-six howl, with an
  // intake that sings at 9,000 rpm. The 3rd order is the firing frequency (450 Hz at the
  // limiter); each bank alone would be a three-cylinder at 1.5 orders.
  flat6: {
    fire: [[0, 0], [1 / 6, 1], [2 / 6, 0], [3 / 6, 1], [4 / 6, 0], [5 / 6, 1]],
    runners: [0.02, 0.06, 0.04, 0.0, 0.05, 0.03],
    trim: [0.02, -0.02, 0.03, -0.01, 0.0, 0.02],
    pulse: 0.12, noise: 0.12, noiseLen: 0.12, drive: 0.6, jitter: 0.05, lope: 0,
    pipe: 1.7, pipeCut: 2800, feedback: 0.5, bankSkew: 1.04,
    resonances: [[160, 1.6, 0.5], [610, 2.6, 0.5], [1380, 3, 0.45], [2750, 4, 0.25]],
    direct: 0.5, tone: 1100, bright: 1.05, crossover: 0.45,
    intake: { f1: 880, f2: 2300, box: 240, level: 0.12 },
    mech: { f: 6000, level: 0.08 },
    orders: {
      list: [[1, 0.04], [1.5, 0.22], [2, 0.05], [3, 1], [4.5, 0.18], [6, 0.55], [7.5, 0.1], [9, 0.42], [12, 0.3], [15, 0.2], [18, 0.14], [21, 0.09], [24, 0.06]],
      formants: [[200, 1.1, 0.55], [650, 1.8, 0.8], [1500, 2.5, 0.65], [3000, 3, 0.45], [4800, 3.5, 0.22]],
      intakeFormants: [[420, 2, 0.8], [1100, 2.5, 0.75], [2300, 3, 0.45]],
      floor: 0.25, level: 0.105, intakeLevel: 0.11, base: 0.3, rise: 1.3,
      tilt: 0.25, loadTilt: 0.55, am: 0.18, fmax: 9000,
    },
    sc: null,
    crackle: 0.12, crackleLevel: 0.55, crackleF: 2400,
    boom: 90, cabinBoom: 0.4, cabinIntake: 1.6,
    shiftCrack: 2, blip: 0.2,
    level: 1.09,
  },
  // 1967 Mustang: 289 cross-plane V8 (firing order 1-5-4-2-6-3-7-8) on cast-iron log
  // manifolds and glasspack mufflers: deep, loping and loose, a four-barrel carb that roars.
  v8classic: {
    fire: [[0, 0], [0.125, 1], [0.25, 0], [0.375, 0], [0.5, 1], [0.625, 0], [0.75, 1], [0.875, 1]],
    runners: [0.2, 0.9, 0.55, 1.1, 0.35, 0.75, 0.15, 1.0],
    trim: [0.06, -0.07, 0.03, 0.08, -0.05, 0.02, -0.08, 0.05],
    pulse: 0.24, noise: 0.3, noiseLen: 0.2, drive: 0.8, jitter: 0.14, lope: 0.4,
    pipe: 3.1, pipeCut: 1100, feedback: 0.7, bankSkew: 1.12,
    resonances: [[78, 1.2, 0.95], [158, 1.5, 0.65], [330, 2, 0.4], [700, 2.4, 0.15]],
    direct: 0.4, tone: 520, bright: 0.7, crossover: 0.18,
    intake: { f1: 300, f2: 1050, box: 120, level: 0.32 },
    mech: { f: 3500, level: 0.18 },
    sc: null,
    crackle: 0.18, crackleLevel: 0.9, crackleF: 1100,
    boom: 55, cabinBoom: 0.7, cabinIntake: 1.4,
    shiftCrack: 0,
    level: 1.2,
  },
  // Modern single-turbo V6: six firing pulses over 720 degrees, with a stronger
  // third-order rasp and less high-frequency scream than the old naturally aspirated V10.
  // A synthesized approximation, not a recording or team-specific engine simulation.
  v6f1: {
    fire: [[0, 0], [1/6, 1], [2/6, 0], [3/6, 1], [4/6, 0], [5/6, 1]],
    runners: [0, .02, .01, .03, .01, .02],
    trim: [.02, -.02, .01, -.01, .02, -.02],
    pulse: .14, noise: .13, noiseLen: .12, drive: .62, jitter: .04, lope: 0,
    pipe: .85, pipeCut: 3800, feedback: .33, bankSkew: 1.02,
    resonances: [[260, 1.6, .4], [680, 2.2, .6], [1600, 2.6, .4], [3300, 3, .18]],
    direct: .58, tone: 1100, bright: .82, crossover: .38,
    intake: { f1: 950, f2: 2500, box: 330, level: .13 },
    mech: { f: 5800, level: .06 },
    orders: {
      list: [[1, .06], [1.5, .27], [3, 1], [4.5, .2], [6, .57], [9, .36], [12, .22], [15, .14], [18, .08]],
      formants: [[300, 1.2, .6], [650, 1.8, .85], [1550, 2.4, .6], [3200, 3, .35], [5400, 3.5, .14]],
      intakeFormants: [[650, 2, .7], [1300, 2.5, .7], [2800, 3, .35]],
      floor: .25, level: .13, intakeLevel: .12, base: .25, rise: 1.4,
      tilt: .25, loadTilt: .5, am: .13, fmax: 10500,
    },
    sc: null,
    crackle: .14, crackleLevel: .7, crackleF: 2100,
    boom: 140, cabinBoom: .3, cabinIntake: 1.5, cabinLp: 2600,
    shiftCrack: 1.6, blip: .18, level: 1.0,
  },
  // McLaren MP4/5 (1989): Honda RA109E 3.5 L 72-degree V10, ~690 hp at 13,000 rpm. Even
  // firing every 72 degrees (the 5th order is the firing frequency, ~1.1 kHz at the limiter),
  // short equal-length headers straight out the back: the raw open-exhaust V10 scream.
  // Open cockpit, so the driver hears the airbox and much more of the exhaust's top end.
  v10: {
    fire: [[0, 0], [0.1, 1], [0.2, 0], [0.3, 1], [0.4, 0], [0.5, 1], [0.6, 0], [0.7, 1], [0.8, 0], [0.9, 1]],
    runners: [0, 0.01, 0.02, 0.01, 0, 0.02, 0.01, 0, 0.02, 0.01],
    trim: [0.02, -0.02, 0.01, 0.02, -0.01, 0.0, 0.02, -0.02, 0.01, -0.01],
    pulse: 0.1, noise: 0.1, noiseLen: 0.1, drive: 0.5, jitter: 0.05, lope: 0,
    pipe: 0.7, pipeCut: 5000, feedback: 0.35, bankSkew: 1.03,
    resonances: [[380, 1.5, 0.35], [1100, 2.2, 0.5], [2400, 3, 0.35], [4500, 3.5, 0.2]],
    direct: 0.6, tone: 1500, bright: 1.15, crossover: 0.2,
    intake: { f1: 1300, f2: 3000, box: 420, level: 0.1 },
    mech: { f: 7000, level: 0.07 },
    orders: {
      list: [[1, 0.03], [2, 0.03], [2.5, 0.25], [5, 1], [7.5, 0.15], [10, 0.6], [12.5, 0.1], [15, 0.45], [20, 0.32], [25, 0.22], [30, 0.15], [35, 0.1], [40, 0.07]],
      formants: [[450, 1, 0.5], [1150, 1.8, 0.85], [2400, 2.4, 0.6], [4300, 3, 0.4], [7000, 3.5, 0.2]],
      intakeFormants: [[700, 2, 0.7], [1600, 2.5, 0.8], [3300, 3, 0.45]],
      floor: 0.25, level: 0.13, intakeLevel: 0.12, base: 0.25, rise: 1.4,
      tilt: 0.2, loadTilt: 0.5, am: 0.15, fmax: 12000,
    },
    sc: null,
    crackle: 0.25, crackleLevel: 0.8, crackleF: 2800,
    boom: 120, cabinBoom: 0.25, cabinIntake: 1.6, cabinLp: 2600,
    shiftCrack: 2, blip: 0.18,
    level: 1.1,
  },
};

export function engineProfile(name, spec) {
  const base = ENGINE_PROFILES[name] || ENGINE_PROFILES.v8sc;
  return { ...base, idle: spec?.idle || 900, redline: spec?.redline || 7000 };
}
