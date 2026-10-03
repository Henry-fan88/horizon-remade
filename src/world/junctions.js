// Shared, DOM-free junction footprints. Road ribbons end at the mouths of these
// polygons; terrain, paint and roadside furniture use the same footprint.
import { clamp, smoothstep } from '../core/math.js';
import polygonClipping from 'polygon-clipping';

export const roadColumns = road => ['highway', 'runway', 'track'].includes(road.kind) ? 7 : 5;
const cross = (ax, az, bx, bz) => ax * bz - az * bx;
const mod = (i, n) => ((i % n) + n) % n;
const area = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - p[1] * q[0]; }, 0)) * .5;

export function atJunctionMouth(arms, x, z, tolerance = .03) {
  return arms.some(a => Math.abs((x - a.x) * a.tx + (z - a.z) * a.tz) < tolerance && Math.abs((x - a.x) * -a.tz + (z - a.z) * a.tx) < a.road.width / 2 + tolerance);
}

function roundOutside(ring, arms) {
  let points = ring.slice(0, -1);
  // Union preserves very small bends in sampled road edges. Coalesce almost
  // straight vertices before rounding a sharp outer corner of a two-road join.
  for (let pass = 0; pass < 5; pass++) {
    const simplified = points.filter((p, i) => {
      if (atJunctionMouth(arms, ...p)) return true;
      const a = points[mod(i - 1, points.length)], b = points[(i + 1) % points.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return len < .01 || Math.abs(cross(p[0] - a[0], p[1] - a[1], b[0] - a[0], b[1] - a[1])) / len > .008;
    });
    if (simplified.length < 3 || simplified.length === points.length) break;
    points = simplified;
  }
  const output = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[mod(i - 1, points.length)], b = points[(i + 1) % points.length];
    const al = Math.hypot(a[0] - p[0], a[1] - p[1]), bl = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const turn = cross(p[0] - a[0], p[1] - a[1], b[0] - p[0], b[1] - p[1]) / (al * bl || 1);
    if (turn < .2 || atJunctionMouth(arms, ...p)) { output.push(p); continue; }
    const cut = Math.min(7, al * .42, bl * .42);
    const from = [p[0] + (a[0] - p[0]) * cut / al, p[1] + (a[1] - p[1]) * cut / al];
    const to = [p[0] + (b[0] - p[0]) * cut / bl, p[1] + (b[1] - p[1]) * cut / bl];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      output.push([u * u * from[0] + 2 * u * t * p[0] + t * t * to[0], u * u * from[1] + 2 * u * t * p[1] + t * t * to[1]]);
    }
  }
  return [...output, output[0]];
}

export function polygonDistance(points, x, z) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    distance = Math.min(distance, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return inside ? -distance : distance;
}

function sampleIndex(road, s, direction) {
  const lap = road.closed ? Math.floor(s / road.length) : 0;
  const target = road.closed ? mod(s, road.length) : clamp(s, 0, road.length);
  let lo = 0, hi = road.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (road.s[mid] <= target) lo = mid; else hi = mid - 1;
  }
  if (direction > 0 && road.s[lo] < target && (road.closed || lo < road.n - 1)) lo++;
  return lo + lap * road.n;
}

// Preserve curves in the incoming roads, union their footprints, and add a
// tangent corner fillet in each gap. Boolean union also handles skew junctions,
// overlapping approaches and small traffic islands without self-crossing fans.
function makeOutline(junction) {
  const { arms } = junction, pieces = [];
  for (const { road, start, end } of junction.links) {
    const left = [], right = [];
    for (let index = start; index <= end; index++) {
      const k = mod(index, road.n), x = road.pts[k * 3], z = road.pts[k * 3 + 2];
      const nx = -road.tan[k * 2 + 1] * road.width / 2, nz = road.tan[k * 2] * road.width / 2;
      left.push([x + nx, z + nz]); right.push([x - nx, z - nz]);
    }
    if (left.length > 1) pieces.push([[...left, ...right.reverse()]]);
  }
  arms.sort((a, b) => Math.atan2(a.tz, a.tx) - Math.atan2(b.tz, b.tx));
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i], b = arms[(i + 1) % arms.length];
    const p = { x: a.x - a.tz * a.road.width / 2, z: a.z + a.tx * a.road.width / 2 };
    const q = { x: b.x + b.tz * b.road.width / 2, z: b.z - b.tx * b.road.width / 2 };
    const det = cross(a.tx, a.tz, b.tx, b.tz);
    if (Math.abs(det) < .04) continue;
    const dx = q.x - p.x, dz = q.z - p.z;
    const ta = cross(dx, dz, b.tx, b.tz) / det, tb = cross(dx, dz, a.tx, a.tz) / det;
    if (ta >= 0 || tb >= 0 || Math.max(-ta, -tb) > 120) continue;
    const c = { x: p.x + a.tx * ta, z: p.z + a.tz * ta };
    const corner = [[junction.x, junction.z], [p.x, p.z]];
    const steps = Math.max(2, Math.ceil((-ta - tb) / 1.5));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      corner.push([u * u * p.x + 2 * u * t * c.x + t * t * q.x, u * u * p.z + 2 * u * t * c.z + t * t * q.z]);
    }
    pieces.push([corner]);
  }
  // Two terminating roads form a continuous bend, not an intersection plaza.
  // Sweep one variable-width cubic curve between their mouths so both verges
  // turn smoothly instead of retaining the square end caps of the old strips.
  if (arms.length === 2 && junction.links.length === 2 && arms[0].road !== arms[1].road) {
    const [a, b] = arms, length = Math.hypot(b.x - a.x, b.z - a.z);
    const ad = clamp((a.x - junction.x) * a.tx + (a.z - junction.z) * a.tz, length * .2, length * .9) * .65;
    const bd = clamp((b.x - junction.x) * b.tx + (b.z - junction.z) * b.tz, length * .2, length * .9) * .65;
    const c = { x: a.x - a.tx * ad, z: a.z - a.tz * ad }, d = { x: b.x - b.tx * bd, z: b.z - b.tz * bd };
    const mx = (a.x + 3 * c.x + 3 * d.x + b.x) / 8, mz = (a.z + 3 * c.z + 3 * d.z + b.z) / 8;
    const flare = clamp(2 * (Math.hypot(mx - junction.x, mz - junction.z) + 1.25) - (a.road.width + b.road.width) / 2, 0, Math.min(a.road.width, b.road.width) * .6);
    const left = [], right = [], steps = Math.max(12, Math.ceil(length / 1.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t, width = a.road.width + (b.road.width - a.road.width) * smoothstep(0, 1, t) + flare * Math.sin(Math.PI * t) ** 2;
      const x = u * u * u * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t * t * t * b.x;
      const z = u * u * u * a.z + 3 * u * u * t * c.z + 3 * u * t * t * d.z + t * t * t * b.z;
      const tx = 3 * u * u * (c.x - a.x) + 6 * u * t * (d.x - c.x) + 3 * t * t * (b.x - d.x);
      const tz = 3 * u * u * (c.z - a.z) + 6 * u * t * (d.z - c.z) + 3 * t * t * (b.z - d.z);
      const scale = width / (2 * Math.hypot(tx, tz) || 1);
      left.push([x - tz * scale, z + tx * scale]); right.push([x + tz * scale, z - tx * scale]);
    }
    pieces.splice(0, pieces.length, [[...left, ...right.reverse()]]);
  }
  // Millimetre snapping prevents microscopic sliver polygons at coincident cuts.
  const snapped = pieces.map(poly => poly.map(r => r.map(p => p.map(v => Math.round(v * 1000) / 1000))));
  junction.polygons = polygonClipping.union(...snapped).filter(poly => area(poly[0]) > .01);
  junction.polygons = junction.polygons.map(([outer, ...holes]) => [roundOutside(outer, arms), ...holes]);
  junction.outline = junction.polygons[0][0].slice(0, -1).map(([x, z]) => ({ x, z }));
  junction.rings = junction.polygons.map(poly => poly.map(ring => ring.slice(0, -1).map(([x, z]) => ({ x, z }))));
  junction.radius = Math.max(...junction.rings.flat(2).map(p => Math.hypot(p.x - junction.x, p.z - junction.z)));
}

export function junctionDistance(junction, x, z) {
  let distance = Infinity;
  for (const [outer, ...holes] of junction.rings) {
    let d = polygonDistance(outer, x, z);
    for (const hole of holes) d = Math.max(d, -polygonDistance(hole, x, z));
    distance = Math.min(distance, d);
  }
  return distance;
}

export class Junctions {
  constructor(network) {
    this.items = [];
    this.byRoad = new Map();
    this.grid = new Map();
    const add = (x, z, road, s, other, os) => {
      let j = this.items.find(j => Math.hypot(j.x - x, j.z - z) < 4);
      if (!j) this.items.push(j = { x, z, links: [], arms: [] });
      for (const [r, along] of [[road, s], [other, os]]) {
        if (!j.links.some(l => l.road === r)) j.links.push({ road: r, s: clamp(along, 0, r.length) });
      }
    };
    const near = {};
    for (const road of network.roads) {
      for (let i = 0; i < road.n; i++) {
        const x = road.pts[i * 3], z = road.pts[i * 3 + 2];
        const other = network.nearest(x, z, 2, r => r.id < road.id, near);
        if (!other || other.dist > 1.05) continue;
        const tx = road.tan[i * 2], tz = road.tan[i * 2 + 1];
        const det = cross(tx, tz, other.tx, other.tz);
        const endpoint = !road.closed && (i === 0 || i === road.n - 1);
        if (Math.abs(det) < .18) {
          if (endpoint && other.dist < .3) add(x, z, road, road.s[i], other.road, other.s);
          continue;
        }
        const dx = other.x - x, dz = other.z - z;
        const t = cross(dx, dz, other.tx, other.tz) / det;
        const u = cross(dx, dz, tx, tz) / det;
        if (Math.abs(t) > 4 || Math.abs(u) > 4) continue;
        const s = road.s[i] + t, os = other.s + u;
        if (!road.closed && (s < -.15 || s > road.length + .15)) continue;
        if (!other.road.closed && (os < -.15 || os > other.road.length + .15)) continue;
        add(x + tx * t, z + tz * t, road, s, other.road, os);
      }
    }
    // Dirt-only trail forks have no crossing road paint or rigid verges.
    this.items = this.items.filter(j => j.links.some(l => l.road.kind !== 'dirt'));
    for (const j of this.items) {
      j.road = j.links.find(l => l.road.kind !== 'dirt').road;
      const halfWidth = Math.max(...j.links.map(l => l.road.width / 2));
      for (const link of j.links) {
        const { road, s } = link;
        const p = road.pointAt(s, {});
        let angle = 1;
        for (const other of j.links) if (other !== link) {
          const q = other.road.pointAt(other.s, {}), a = Math.abs(cross(p.tx, p.tz, q.tx, q.tz));
          if (a > .18) angle = Math.min(angle, a);
        }
        const cuts = [];
        for (const direction of [-1, 1]) {
          let reach = Math.min(75, (halfWidth + (road.city ? 5 : 10)) / angle);
          // Keep separate intersections separate even on short city blocks.
          for (const neighbor of this.items) if (neighbor !== j) {
            const l = neighbor.links.find(l => l.road === road);
            if (!l) continue;
            let distance = (l.s - s) * direction;
            if (road.closed) distance = mod(distance, road.length);
            if (distance > 0) reach = Math.min(reach, distance * .42);
          }
          const available = road.closed ? Infinity : direction < 0 ? s : road.length - s;
          const index = available < reach + 1 ? (direction < 0 ? 0 : road.n - 1) : sampleIndex(road, s + direction * reach, direction);
          cuts.push(index);
          if (available < reach + 1) continue;
          const k = mod(index, road.n);
          j.arms.push({ road, index, direction, x: road.pts[k * 3], y: road.pts[k * 3 + 1], z: road.pts[k * 3 + 2], tx: road.tan[k * 2] * direction, tz: road.tan[k * 2 + 1] * direction });
        }
        link.start = cuts[0]; link.end = cuts[1];
      }
      makeOutline(j);
      for (const link of j.links) {
        const n = link.road.n;
        const ranges = this.byRoad.get(link.road.id) || [];
        this.byRoad.set(link.road.id, ranges);
        for (const shift of link.road.closed ? [-n, 0, n] : [0]) {
          const start = link.start + shift, end = link.end + shift;
          if (end < 0 || start > n) continue;
          ranges.push({ start, end, junction: j });
        }
      }
      for (let z = Math.floor((j.z - j.radius - 12) / 64); z <= Math.floor((j.z + j.radius + 12) / 64); z++) {
        for (let x = Math.floor((j.x - j.radius - 12) / 64); x <= Math.floor((j.x + j.radius + 12) / 64); x++) {
          const key = `${x},${z}`, list = this.grid.get(key) || [];
          if (!list.length) this.grid.set(key, list);
          list.push(j);
        }
      }
    }
    // Neighboring junction aprons may touch on dense city blocks. Render their
    // union once, while retaining the individual mouths for road/paint trimming.
    this.surfaces = this.items.length ? polygonClipping.union(...this.items.map(j => j.polygons)).filter(poly => area(poly[0]) > .01) : [];
  }

  removesRow(road, row) {
    return (this.byRoad.get(road.id) || []).some(r => row >= r.start && row < r.end);
  }

  blendAt(road, row) {
    let blend = 0;
    for (const range of this.byRoad.get(road.id) || []) {
      const distance = Math.max(range.start - row, row - range.end, 0) * 2;
      blend = Math.max(blend, 1 - smoothstep(3, 12, distance));
    }
    return blend;
  }

  at(x, z, margin = 0) {
    for (const j of this.grid.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) || []) {
      if (Math.hypot(x - j.x, z - j.z) > j.radius + margin) continue;
      if (junctionDistance(j, x, z) <= margin) return j;
    }
    return null;
  }

  nearby(x, z, radius) {
    return (this.grid.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) || []).filter(j => Math.hypot(x - j.x, z - j.z) < j.radius + radius);
  }
}
