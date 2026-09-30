// Civilian ambient roster: deliberately independent of CARS, ownership, and race AI.
import geometry from '../../public/models/civilian-traffic/geometry.json' with { type: 'json' };
import { deriveCarSpec } from './carspecs.js';

export const TRAFFIC_COLORS = ['#e8e9e7', '#242a30', '#91969b', '#b0a796', '#263e57', '#6f2530', '#455e57', '#bec7cf', '#5b6069', '#ddd3c1'];
const definitions = [
  ['compact', 'City compact', 1080, 66, 160, 'FWD', .48],
  ['hatchback', 'Family hatchback', 1280, 96, 185, 'FWD', .5],
  ['sedan', 'Family sedan', 1480, 125, 205, 'FWD', .51],
  ['estate', 'Family estate', 1580, 132, 205, 'FWD', .53],
  ['minivan', 'Family minivan', 1880, 132, 175, 'FWD', .63],
  ['pickup', 'Double-cab pickup', 2150, 160, 175, 'RWD', .68],
  ['suv', 'Family SUV', 2080, 165, 195, 'AWD', .68],
  ['offroad', 'Utility 4×4', 1850, 125, 165, 'AWD', .67],
];
export const TRAFFIC_SPECS = definitions.map(([body, model, mass, powerKW, topKmh, drive, cgH]) => {
  const style = { ...geometry[body].geometry, trafficAsset: body };
  return deriveCarSpec({
    id: `traffic-${body}`, make: 'Civilian', model, style: body, mass, powerKW, topKmh, drive, cgH,
    price: 0, redline: 6200, idle: 850, tqPeak: .5, tqFall: .3, turbo: false,
    grip: .9, ClA: .02, wf: .5, gears: 6, susp: 1.45, travel: .23,
    offroad: ['pickup','suv','offroad'].includes(body) ? .5 : .25,
  }, style);
});
