// Height field with triangle-consistent sampling. The terrain mesh uses the same
// triangulation (anti-diagonal split) so physics and visuals match exactly.

export class HeightField {
  constructor(data, res, size) {
    this.data = data;
    this.res = res;
    this.size = size;
    this.cell = size / res;
    this.inv = res / size;
    this.half = size / 2;
    this.stride = res + 1;
  }

  height(x, z) {
    const r = this.res;
    let fx = (x + this.half) * this.inv;
    let fz = (z + this.half) * this.inv;
    if (fx < 0) fx = 0;
    else if (fx > r - 1e-5) fx = r - 1e-5;
    if (fz < 0) fz = 0;
    else if (fz > r - 1e-5) fz = r - 1e-5;
    const ix = fx | 0,
      iz = fz | 0;
    const tx = fx - ix,
      tz = fz - iz;
    const s = this.stride;
    const i = iz * s + ix;
    const d = this.data;
    const h00 = d[i],
      h10 = d[i + 1],
      h01 = d[i + s],
      h11 = d[i + s + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  // Returns height, writes the (triangle) surface normal into out {x,y,z}.
  sample(x, z, out) {
    const r = this.res;
    let fx = (x + this.half) * this.inv;
    let fz = (z + this.half) * this.inv;
    if (fx < 0) fx = 0;
    else if (fx > r - 1e-5) fx = r - 1e-5;
    if (fz < 0) fz = 0;
    else if (fz > r - 1e-5) fz = r - 1e-5;
    const ix = fx | 0,
      iz = fz | 0;
    const tx = fx - ix,
      tz = fz - iz;
    const s = this.stride;
    const i = iz * s + ix;
    const d = this.data;
    const h00 = d[i],
      h10 = d[i + 1],
      h01 = d[i + s],
      h11 = d[i + s + 1];
    let h, dx, dz;
    if (tx + tz <= 1) {
      h = h00 + (h10 - h00) * tx + (h01 - h00) * tz;
      dx = (h10 - h00) * this.inv;
      dz = (h01 - h00) * this.inv;
    } else {
      h = h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
      dx = (h11 - h01) * this.inv;
      dz = (h11 - h10) * this.inv;
    }
    const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    out.x = -dx * l;
    out.y = l;
    out.z = -dz * l;
    return h;
  }

  // Smooth normal via central differences (for rendering / placement)
  smoothNormal(x, z, out) {
    const e = this.cell;
    const hl = this.height(x - e, z),
      hr = this.height(x + e, z);
    const hd = this.height(x, z - e),
      hu = this.height(x, z + e);
    let nx = hl - hr,
      ny = 2 * e,
      nz = hd - hu;
    const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    out.x = nx * l;
    out.y = ny * l;
    out.z = nz * l;
    return out;
  }

  // Grid vertex accessor
  at(ix, iz) {
    return this.data[iz * this.stride + ix];
  }
}
