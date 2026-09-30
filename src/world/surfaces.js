// Per-surface tyre grip, rolling roughness and dust colours. Kept free of DOM and
// three.js imports so the vehicle physics can also run in Node benches.
import { SURF } from './worldgen.js';

// Grip multipliers per surface: [asphalt-tyre grip, off-road penalty weight]
export const SURFACE_INFO = {
  [SURF.MUD]: { grip: .5, rough: .65, dust: [.29, .22, .14], name: 'mud', offroad: true },
  [SURF.GRASS]: { grip: 0.74, rough: 0.35, dust: [0.55, 0.52, 0.4], name: 'grass', offroad: true },
  [SURF.DRY]: { grip: 0.72, rough: 0.35, dust: [0.62, 0.55, 0.4], name: 'dry', offroad: true },
  [SURF.DIRT]: { grip: 0.76, rough: 0.4, dust: [0.55, 0.45, 0.33], name: 'dirt', offroad: true },
  [SURF.SAND]: { grip: 0.66, rough: 0.25, dust: [0.85, 0.78, 0.62], name: 'sand', offroad: true },
  [SURF.ROCK]: { grip: 0.82, rough: 0.55, dust: [0.5, 0.48, 0.45], name: 'rock', offroad: true },
  [SURF.ASH]: { grip: 0.74, rough: 0.5, dust: [0.3, 0.27, 0.26], name: 'ash', offroad: true },
  [SURF.FOREST]: { grip: 0.72, rough: 0.45, dust: [0.45, 0.4, 0.3], name: 'forest', offroad: true },
  [SURF.FIELD]: { grip: 0.7, rough: 0.4, dust: [0.6, 0.52, 0.35], name: 'field', offroad: true },
  [SURF.ROAD]: { grip: 1.0, rough: 0.0, dust: [0.8, 0.8, 0.8], name: 'asphalt', offroad: false },
  [SURF.DIRTROAD]: { grip: 0.8, rough: 0.2, dust: [0.6, 0.5, 0.38], name: 'gravel', offroad: true },
  [SURF.PAVE]: { grip: 0.96, rough: 0.02, dust: [0.8, 0.8, 0.8], name: 'pavement', offroad: false },
  [SURF.VERGE]: { grip: 0.85, rough: 0.15, dust: [0.6, 0.55, 0.45], name: 'verge', offroad: true },
  [SURF.SNOW]: { grip: 0.55, rough: 0.35, dust: [0.93, 0.95, 0.98], name: 'snow', offroad: true },
  // circuit gravel traps slow a car hard; kerbs grip like asphalt but drum under the tyres
  [SURF.GRAVEL]: { grip: 0.55, rough: 2.0, dust: [0.78, 0.73, 0.62], name: 'gravel trap', offroad: true },
  [SURF.KERB]: { grip: 0.94, rough: 0.12, dust: [0.8, 0.8, 0.8], name: 'kerb', offroad: false, rumble: true },
};
