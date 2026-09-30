// Global configuration for Horizon Remade.
// Rename the game here — every UI string reads from these constants.

export const GAME_TITLE = 'HORIZON';
export const GAME_SUBTITLE = 'REMADE';
export const GAME_TAGLINE = 'Open World Festival Racing';
export const FESTIVAL_NAME = 'Horizon Isla Festival';

export const WORLD = {
  seed: 20260927,
  size: 6144, // metres, world spans [-size/2, size/2] on X and Z
  res: 1536, // heightfield cells per side (4 m cells)
  seaLevel: 0,
  volcano: { x: -150, z: -560, radius: 720, height: 390, crater: 125, craterDepth: 70 },
};

// Colour palette used across HUD / menus (festival pink + friends)
export const PALETTE = {
  pink: '#ff2d87',
  pinkDeep: '#d4006a',
  orange: '#ff8a1f',
  yellow: '#ffd21f',
  cyan: '#1fd8ff',
  purple: '#8c3dff',
  dark: 'rgba(12, 12, 20, 0.72)',
};

// Performance-index classes (like the festival car classes)
export const PI_CLASSES = [
  { id: 'D', min: 100, max: 500, color: '#3fb9e8' },
  { id: 'C', min: 501, max: 600, color: '#f5c518' },
  { id: 'B', min: 601, max: 700, color: '#ff8c1a' },
  { id: 'A', min: 701, max: 800, color: '#f0413f' },
  { id: 'S1', min: 801, max: 900, color: '#a64fd8' },
  { id: 'S2', min: 901, max: 998, color: '#2f6ff0' },
  { id: 'X', min: 999, max: 999, color: '#3ed45a' },
];

export function piClass(pi) {
  for (const c of PI_CLASSES) if (pi <= c.max) return c;
  return PI_CLASSES[PI_CLASSES.length - 1];
}

export const PHYSICS_HZ = 120;

export const DEFAULT_SETTINGS = {
  quality: 'auto', // auto | low | medium | high | ultra
  dynamicRes: true,
  units: 'kmh', // kmh | mph
  timeOfDay: 'dynamic', // dynamic | morning | noon | golden | sunset | night
  dayLength: 40, // real minutes per in-game day (nights pass 3x faster)
  camera: 0,
  transmission: 'auto', // auto | manual
  drivingLine: 'race', // off | race | full
  steeringAssist: 'normal', // off | normal | full
  stability: true,
  abs: true,
  tractionControl: true,
  damage: 'cosmetic', // off | cosmetic | simulation
  masterVolume: 0.8,
  engineVolume: 0.8,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  radio: true,
  motionBlur: true,
  showFps: false,
  traffic: true,
  playerName: '',
  online: true,
};
