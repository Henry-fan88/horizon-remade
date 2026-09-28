// Road graph + Dijkstra routing for the GPS line.
import { MinHeap } from '../core/math.js';

export class RoadGraph {
  constructor(network, step = 20) {
    this.nodes = []; // {x, z, road, s}
    this.adj = [];
    const nodeOf = [];
    for (const r of network.roads) {
      const ids = [];
      const n = Math.max(2, Math.ceil(r.length / step));
      const o = {};
      const count = r.closed ? n : n + 1;
      for (let k = 0; k < count; k++) {
        const s = (r.length * k) / n;
        r.pointAt(Math.min(s, r.length - 0.01), o);
        const id = this.nodes.length;
        this.nodes.push({ x: o.x, z: o.z, road: r, s });
        this.adj.push([]);
        ids.push(id);
      }
      for (let k = 0; k < ids.length - 1; k++) this.link(ids[k], ids[k + 1]);
      if (r.closed) this.link(ids[ids.length - 1], ids[0]);
      nodeOf.push(ids);
    }
    // junctions: connect nodes of different roads that are close together
    const cell = 30;
    const grid = new Map();
    this.nodes.forEach((nd, i) => {
      const k = Math.floor(nd.x / cell) * 10007 + Math.floor(nd.z / cell);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    this.grid = grid;
    this.cell = cell;
    this.nodes.forEach((nd, i) => {
      const cx = Math.floor(nd.x / cell),
        cz = Math.floor(nd.z / cell);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const arr = grid.get((cx + dx) * 10007 + (cz + dz));
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            const o = this.nodes[j];
            if (o.road === nd.road) continue;
            const d = Math.hypot(o.x - nd.x, o.z - nd.z);
            if (d < 16) this.link(i, j);
          }
        }
    });
  }

  link(a, b) {
    const d = Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z);
    this.adj[a].push([b, d]);
    this.adj[b].push([a, d]);
  }

  nearestNode(x, z) {
    let best = -1,
      bd = Infinity;
    const cx = Math.floor(x / this.cell),
      cz = Math.floor(z / this.cell);
    for (let r = 0; r < 60 && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const arr = this.grid.get((cx + dx) * 10007 + (cz + dz));
          if (!arr) continue;
          for (const i of arr) {
            const n = this.nodes[i];
            const d = (n.x - x) ** 2 + (n.z - z) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
      if (best >= 0 && r > 0) break;
    }
    return best;
  }

  route(x0, z0, x1, z1) {
    const a = this.nearestNode(x0, z0),
      b = this.nearestNode(x1, z1);
    if (a < 0 || b < 0) return [[x0, z0], [x1, z1]];
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap(256);
    dist[a] = 0;
    heap.push(a, 0);
    const tb = this.nodes[b];
    while (heap.size) {
      const u = heap.pop();
      if (u === b) break;
      const du = dist[u];
      for (const [v, w] of this.adj[u]) {
        const nd = du + w;
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          const nv = this.nodes[v];
          heap.push(v, nd + Math.hypot(nv.x - tb.x, nv.z - tb.z));
        }
      }
    }
    const path = [];
    let c = b;
    while (c >= 0) {
      path.push([this.nodes[c].x, this.nodes[c].z]);
      if (c === a) break;
      c = prev[c];
    }
    path.reverse();
    path.unshift([x0, z0]);
    path.push([x1, z1]);
    return path;
  }
}

export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i],
      [bx, bz] = pts[i + 1];
    const ex = bx - ax,
      ez = bz - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    let t = ((x - ax) * ex + (z - az) * ez) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
    if (d < best) best = d;
  }
  return best;
}
