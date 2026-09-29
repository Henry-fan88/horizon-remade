import { generateWorld } from './worldgen.js';

self.onmessage = (e) => {
  const { seed } = e.data || {};
  try {
    const world = generateWorld({ seed }, (p, msg) => self.postMessage({ type: 'progress', p, msg }));
    const transfer = [world.heights.buffer, world.colors.buffer, world.surface.buffer];
    for (const r of world.roads) transfer.push(r.pts.buffer, r.bank.buffer, r.crown.buffer);
    for (const k in world.veg) transfer.push(world.veg[k].buffer);
    for (const k in world.props) transfer.push(world.props[k].buffer);
    self.postMessage({ type: 'done', world }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack ? err.stack : err) });
  }
};
