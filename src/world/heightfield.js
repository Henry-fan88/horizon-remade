// Height field with triangle-consistent sampling (the terrain mesh uses the same
// anti-diagonal split) plus a smooth B-spline surface for the vehicle physics.

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

  // Smooth (C2) cubic B-spline surface over the grid, with its analytic normal. The 4 m
  // triangle facets above produce slope steps at every edge, which the suspension feels as
  // a buzz at speed; this surface has none. Returns height, writes the normal into out.
  sampleSmooth(x, z, out) {
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
    // uniform cubic B-spline basis and derivatives
    const ux = 1 - tx,
      uz = 1 - tz;
    const tx2 = tx * tx,
      tz2 = tz * tz;
    const ax0 = (ux * ux * ux) / 6,
      ax1 = (3 * tx2 * tx - 6 * tx2 + 4) / 6,
      ax2 = (-3 * tx2 * tx + 3 * tx2 + 3 * tx + 1) / 6,
      ax3 = (tx2 * tx) / 6;
    const dx0 = -0.5 * ux * ux,
      dx1 = 1.5 * tx2 - 2 * tx,
      dx2 = -1.5 * tx2 + tx + 0.5,
      dx3 = 0.5 * tx2;
    const az0 = (uz * uz * uz) / 6,
      az1 = (3 * tz2 * tz - 6 * tz2 + 4) / 6,
      az2 = (-3 * tz2 * tz + 3 * tz2 + 3 * tz + 1) / 6,
      az3 = (tz2 * tz) / 6;
    const dz0 = -0.5 * uz * uz,
      dz1 = 1.5 * tz2 - 2 * tz,
      dz2 = -1.5 * tz2 + tz + 0.5,
      dz3 = 0.5 * tz2;
    const d = this.data;
    const s = this.stride;
    const x0 = ix > 0 ? ix - 1 : 0,
      x2 = ix + 1,
      x3 = ix + 2 <= r ? ix + 2 : r;
    const z0 = (iz > 0 ? iz - 1 : 0) * s,
      z1 = iz * s,
      z2 = (iz + 1) * s,
      z3 = (iz + 2 <= r ? iz + 2 : r) * s;
    let r0 = d[z0 + x0] * ax0 + d[z0 + ix] * ax1 + d[z0 + x2] * ax2 + d[z0 + x3] * ax3;
    let r1 = d[z1 + x0] * ax0 + d[z1 + ix] * ax1 + d[z1 + x2] * ax2 + d[z1 + x3] * ax3;
    let r2 = d[z2 + x0] * ax0 + d[z2 + ix] * ax1 + d[z2 + x2] * ax2 + d[z2 + x3] * ax3;
    let r3 = d[z3 + x0] * ax0 + d[z3 + ix] * ax1 + d[z3 + x2] * ax2 + d[z3 + x3] * ax3;
    const h = r0 * az0 + r1 * az1 + r2 * az2 + r3 * az3;
    const gz = (r0 * dz0 + r1 * dz1 + r2 * dz2 + r3 * dz3) * this.inv;
    r0 = d[z0 + x0] * dx0 + d[z0 + ix] * dx1 + d[z0 + x2] * dx2 + d[z0 + x3] * dx3;
    r1 = d[z1 + x0] * dx0 + d[z1 + ix] * dx1 + d[z1 + x2] * dx2 + d[z1 + x3] * dx3;
    r2 = d[z2 + x0] * dx0 + d[z2 + ix] * dx1 + d[z2 + x2] * dx2 + d[z2 + x3] * dx3;
    r3 = d[z3 + x0] * dx0 + d[z3 + ix] * dx1 + d[z3 + x2] * dx2 + d[z3 + x3] * dx3;
    const gx = (r0 * az0 + r1 * az1 + r2 * az2 + r3 * az3) * this.inv;
    if (out) {
      out.gx = gx;
      out.gz = gz;
    }
    return h;
  }

  // Grid vertex accessor
  at(ix, iz) {
    return this.data[iz * this.stride + ix];
  }
}
