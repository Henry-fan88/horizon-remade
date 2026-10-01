// Shared snow-line rules for the mountain-road material and tyre queries.
// This changes surface cover only; road profiles and terrain heights stay exact.
import { smoothstep } from '../core/math.js';
import { SURF } from './worldgen.js';

export const SNOW_ROAD_LINE = { start: 145, end: 185, contact: 165 };
export const isSnowRoad = (road) => road.name === 'Paso Nevado';
export const roadSnowCoverage = (height) => smoothstep(SNOW_ROAD_LINE.start, SNOW_ROAD_LINE.end, height);

export function roadSurfaceAt(road, height) {
  if (isSnowRoad(road) && height >= SNOW_ROAD_LINE.contact) return SURF.SNOW;
  return road.surface ?? (road.kind === 'dirt' ? SURF.DIRTROAD : SURF.ROAD);
}
