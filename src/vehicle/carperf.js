// Performance figures measured by driving each car's own physics on flat asphalt (standing
// start, full throttle, the default assists), so the garage shows what the car really does.
import { VehiclePhysics } from './vehiclephysics.js';
import { CARS, rateAcceleration } from './carspecs.js';
import { SURF } from '../world/worldgen.js';
import { PHYSICS_HZ } from '../config.js';

const FLAT = {
  height: () => 0,
  sample(x, z, n) {
    n.x = 0;
    n.y = 1;
    n.z = 0;
    return 0;
  },
  surfaceAt: () => SURF.ROAD,
};

// Seconds from standstill to 100 and 200 km/h (null if not reached within the time limit).
export function measureLaunch(spec, limit = 30) {
  const dt = 1 / PHYSICS_HZ;
  const p = new VehiclePhysics(spec, FLAT);
  p.reset(0, 0, 0, 0);
  p.pos.y = spec.cgH + 0.02;
  // settle on the suspension before the launch
  for (let i = 0; i < PHYSICS_HZ / 2; i++) p.step(dt);
  p.input.throttle = 1;
  let t = 0,
    t100 = null,
    t200 = null;
  while (t < limit && t200 === null) {
    p.step(dt);
    t += dt;
    const kmh = p.forwardSpeed * 3.6;
    if (t100 === null && kmh >= 100) t100 = t;
    if (kmh >= 200) t200 = t;
    if (t100 !== null && t > t100 + 4 && spec.topKmh < 205) break;
  }
  return { t100, t200 };
}

let measured = false;
export function measureAllCars() {
  if (measured) return;
  measured = true;
  for (const car of CARS) {
    const m = measureLaunch(car);
    car.zeroTo100 = m.t100;
    car.zeroTo200 = m.t200;
    rateAcceleration(car);
  }
}
