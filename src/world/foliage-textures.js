// Small, deterministic botanical sprites: connected twigs, individual leaf
// silhouettes and visible gaps instead of opaque circular canopy stamps.
import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

const leaves = new Map();
const barks = new Map();
const TAU = Math.PI * 2;

function canvas(size, height = size) {
  const image = document.createElement('canvas');
  image.width = size;
  image.height = height;
  return image;
}

function leaf(ctx, x, y, length, width, angle, shade, palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = `rgb(${palette[0] * shade},${palette[1] * shade},${palette[2] * shade})`;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-width, -length * 0.2, -width * 0.6, -length * 0.8, 0, -length);
  ctx.bezierCurveTo(width * 0.7, -length * 0.75, width, -length * 0.22, 0, 0);
  ctx.fill();
  ctx.strokeStyle = `rgba(186,192,112,${0.12 + shade * 0.08})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.lineTo(0, -length * 0.88);
  ctx.stroke();
  ctx.restore();
}

function twig(ctx, x0, y0, x1, y1, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function broadSpray(ctx, rnd, birch) {
  const palette = birch ? [100, 131, 54] : [73, 104, 46];
  // A central woody stem forks into alternating sprays. Leaves are attached to
  // their own fine twigs, so silhouettes remain believable at close range.
  twig(ctx, 242, 475, 273, 51, 4, '#5e5937');
  for (let row = 0; row < 7; row++) {
    const y = 405 - row * 48;
    const sx = 247 + row * 3.6;
    for (const side of [-1, 1]) {
      const reach = (130 + rnd() * 48) * (1 - row * 0.075);
      const ex = sx + side * reach;
      const ey = y - 54 - rnd() * 25;
      twig(ctx, sx, y, ex, ey, 2 - row * 0.12, '#626840');
      const count = 9 + Math.floor(rnd() * 4);
      for (let k = 0; k < count; k++) {
        const t = (k + 0.35) / count;
        const px = sx + (ex - sx) * t;
        const py = y + (ey - y) * t;
        for (const leafSide of [-1, 1]) {
          const a = Math.atan2(ey - y, ex - sx) + Math.PI / 2 + leafSide * (0.5 + rnd() * 0.65);
          const length = (birch ? 23 : 28) * (0.72 + rnd() * 0.58);
          leaf(ctx, px + (rnd() - 0.5) * 6, py + (rnd() - 0.5) * 7, length, length * (birch ? 0.43 : 0.32), a, 0.72 + rnd() * 0.53, palette);
        }
      }
      leaf(ctx, ex, ey, 22, 7, Math.atan2(ey - y, ex - sx) + Math.PI / 2, 1.1, palette);
    }
  }
  leaf(ctx, 273, 57, 27, 10, 0.05, 1.1, palette);
}

function needleSpray(ctx, rnd) {
  twig(ctx, 33, 284, 481, 232, 6, '#625e42');
  for (let k = 0; k < 21; k++) {
    const t = (k + 0.5) / 22;
    const x = 34 + t * 434;
    const y = 283 - t * 50;
    for (const side of [-1, 1]) {
      const length = (90 + rnd() * 43) * (1 - t * 0.6);
      const ex = x + length * 0.55;
      const ey = y + side * length;
      twig(ctx, x, y, ex, ey, 1.6, '#626747');
      for (let n = 0; n < 19; n++) {
        const q = n / 19;
        const px = x + (ex - x) * q;
        const py = y + (ey - y) * q;
        const needle = (12 + rnd() * 12) * (1 - q * 0.5);
        const shade = 0.7 + rnd() * 0.5;
        for (const sign of [-1, 1]) twig(ctx, px, py, px + needle * sign, py + side * needle * 0.8, 1.2 + rnd() * 0.8, `rgb(${45 * shade},${78 * shade},${48 * shade})`);
      }
    }
  }
}

function palmSpray(ctx, rnd) {
  twig(ctx, 6, 255, 506, 255, 5.5, '#807348');
  for (let k = 0; k < 48; k++) {
    const t = (k + 0.6) / 49;
    const x = 7 + t * 491;
    const length = Math.pow(Math.sin(t * Math.PI), 0.62) * 207;
    for (const side of [-1, 1]) {
      const shade = 0.75 + rnd() * 0.4;
      ctx.fillStyle = `rgb(${73 * shade},${104 * shade},${48 * shade})`;
      ctx.beginPath();
      ctx.moveTo(x - 4, 255);
      ctx.quadraticCurveTo(x + 12, 255 + side * length * 0.62, x + 39 + rnd() * 10, 255 + side * length);
      ctx.quadraticCurveTo(x + 32, 255 + side * length * 0.53, x + 5.5, 255);
      ctx.fill();
    }
  }
}

// Ordinary averaged mipmaps erase small leaves below alphaTest. Preserve the
// occupied silhouette at every level so distant trees keep the same canopy mass.
function foliageMipmaps(base, size, cutoff = 0.38) {
  const threshold = cutoff * 255;
  const coverage = (pixels, scale = 1) => {
    let occupied = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] * scale > threshold) occupied++;
    return occupied / (pixels.length / 4);
  };
  const target = coverage(base);
  const levels = [{ data: base, width: size, height: size }];
  let previous = base;
  let width = size;
  while (width > 1) {
    const nextWidth = width >> 1;
    const raw = new Uint8Array(nextWidth * nextWidth * 4);
    for (let y = 0; y < nextWidth; y++) for (let x = 0; x < nextWidth; x++) {
      const dst = (y * nextWidth + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p = ((y * 2) * width + x * 2) * 4 + c;
        raw[dst + c] = (previous[p] + previous[p + 4] + previous[p + width * 4] + previous[p + width * 4 + 4]) / 4;
      }
    }
    let lo = 0, hi = 12;
    for (let step = 0; step < 14; step++) {
      const middle = (lo + hi) / 2;
      if (coverage(raw, middle) < target) lo = middle;
      else hi = middle;
    }
    const scale = hi;
    const corrected = raw.slice();
    for (let i = 3; i < corrected.length; i += 4) corrected[i] = Math.min(255, Math.ceil(raw[i] * scale));
    levels.push({ data: corrected, width: nextWidth, height: nextWidth });
    // Downsample the unscaled signal, avoiding cumulative alpha expansion.
    previous = raw;
    width = nextWidth;
  }
  return levels;
}

export function makeFoliageTexture(kind = 'broad') {
  if (leaves.has(kind)) return leaves.get(kind);
  const size = 512;
  const image = canvas(size);
  const ctx = image.getContext('2d');
  const rnd = mulberry32({ broad: 1501, birch: 1502, pine: 1503, palm: 1504 }[kind]);
  if (kind === 'pine') needleSpray(ctx, rnd);
  else if (kind === 'palm') palmSpray(ctx, rnd);
  else {
    // Three interwoven branchlets give each card a substantial leafy silhouette,
    // with real inter-leaf gaps instead of the old empty single-twig stamp.
    for (const angle of [-0.54, 0.48, 0]) {
      ctx.save();
      ctx.translate(256, 256);
      ctx.rotate(angle);
      ctx.scale(0.9, 0.9);
      ctx.translate(-256, -256);
      broadSpray(ctx, rnd, kind === 'birch');
      ctx.restore();
    }
  }
  const pixels = ctx.getImageData(0, 0, size, size).data;
  // Opaque RGB in transparent texels prevents black mip fringes. The alpha is
  // unchanged, preserving every inter-leaf opening and the feathered outline.
  const data = new Uint8Array(pixels.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const src = (y * size + x) * 4;
    const dst = ((size - 1 - y) * size + x) * 4;
    data[dst] = pixels[src + 3] ? pixels[src] : 70;
    data[dst + 1] = pixels[src + 3] ? pixels[src + 1] : 101;
    data[dst + 2] = pixels[src + 3] ? pixels[src + 2] : 47;
    data[dst + 3] = pixels[src + 3];
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.mipmaps = foliageMipmaps(data, size);
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.userData.alphaCoverage = data.reduce((sum, value, i) => sum + (i % 4 === 3 && value > 97 ? 1 : 0), 0) / (size * size);
  leaves.set(kind, texture);
  return texture;
}

export function makeFoliageBark(kind = 'oak') {
  if (barks.has(kind)) return barks.get(kind);
  const w = 128, h = 512;
  const mapData = new Uint8Array(w * h * 4);
  const bumpData = new Uint8Array(w * h * 4);
  const rnd = mulberry32(kind === 'birch' ? 6201 : kind === 'palm' ? 6202 : 6203);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const grain = rnd() * 0.13;
    let shade, color, height;
    if (kind === 'birch') {
      const scar = Math.sin(v * TAU * 31 + Math.sin(u * TAU * 3) * 1.8) > 0.9 && Math.sin(u * TAU * 5 + Math.floor(v * 25)) > 0.15;
      shade = scar ? 0.24 + grain : 0.83 + grain;
      color = [205, 201, 188];
      height = scar ? 0.3 : 0.65 + grain;
    } else if (kind === 'palm') {
      const rings = Math.sin(v * TAU * 24 + Math.sin(u * TAU * 3) * 0.22);
      shade = 0.66 + Math.max(0, rings) * 0.29 + grain;
      color = [133, 119, 94];
      height = 0.46 + rings * 0.24;
    } else {
      const groove = Math.pow(Math.max(0, Math.sin(u * TAU * 19 + Math.sin(v * TAU * 2) * 0.8 + Math.sin(v * TAU * 11) * 0.12)), 7);
      const flakes = Math.sin(v * TAU * 26 + u * TAU * 3) * 0.045;
      shade = 0.88 - groove * 0.49 + flakes + grain;
      color = [115, 104, 88];
      height = 0.73 - groove * 0.5 + flakes;
    }
    const i = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) { mapData[i + k] = color[k] * shade; bumpData[i + k] = height * 255; }
    mapData[i + 3] = bumpData[i + 3] = 255;
  }
  const make = (data, colorSpace) => {
    const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = colorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  const result = { map: make(mapData, THREE.SRGBColorSpace), bumpMap: make(bumpData, THREE.NoColorSpace) };
  barks.set(kind, result);
  return result;
}
