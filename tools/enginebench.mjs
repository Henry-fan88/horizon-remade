// Offline engine-sound bench (Node): renders each engine profile through the AudioWorklet
// processor and reports levels; writes WAVs and spectrogram PNGs for inspection.
//   node tools/enginebench.mjs [outDir=/tmp/enginebench]
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { engineProfile, ENGINE_PROFILES } from '../src/core/engine-profiles.js';
import { CARS } from '../src/vehicle/carspecs.js';

const SR = 48000;
globalThis.sampleRate = SR;
let Processor = null;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
};
globalThis.registerProcessor = (name, cls) => (Processor = cls);
await import('../src/core/engine-worklet.js');

const outDir = process.argv[2] || '/tmp/enginebench';
mkdirSync(outDir, { recursive: true });

function render(profile, script, seconds) {
  const proc = new Processor({ processorOptions: { profile } });
  const send = (m) => proc.port.onmessage({ data: m });
  const L = new Float32Array(SR * seconds),
    R = new Float32Array(SR * seconds);
  const block = 128;
  for (let i = 0; i < L.length; i += block) {
    const t = i / SR;
    send(script(t));
    const l = new Float32Array(block),
      r = new Float32Array(block);
    proc.process([], [[l, r]]);
    L.set(l.subarray(0, Math.min(block, L.length - i)), i);
    R.set(r.subarray(0, Math.min(block, L.length - i)), i);
  }
  return [L, R];
}

function wav(path, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

function stats(x, a, b) {
  let s = 0,
    pk = 0,
    dc = 0;
  for (let i = a; i < b; i++) {
    s += x[i] * x[i];
    pk = Math.max(pk, Math.abs(x[i]));
    dc += x[i];
  }
  const n = b - a;
  return { rms: Math.sqrt(s / n), peak: pk, dc: dc / n };
}

// radix-2 FFT magnitude spectrum of a Hann-windowed frame
function spectrum(x, off, N) {
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[off + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= N; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len)
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k),
          s = Math.sin(a * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s,
          xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
  }
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

function png(path, W, H, rgb) {
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc32 = (b) => {
    let c = -1;
    for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// spectrogram: log-frequency axis 30 Hz .. 8 kHz, dB colour map
function spectrogram(path, x, fmax = 8000) {
  const W = 600,
    H = 300,
    N = 4096;
  const img = Buffer.alloc(W * H * 3);
  const hop = Math.floor((x.length - N) / W);
  for (let col = 0; col < W; col++) {
    const mag = spectrum(x, col * hop, N);
    for (let row = 0; row < H; row++) {
      const f = 30 * Math.pow(fmax / 30, 1 - row / (H - 1));
      const bin = Math.min(N / 2 - 1, Math.round((f / SR) * N));
      const db = 20 * Math.log10(mag[bin] + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 20) / 70));
      const o = (row * W + col) * 3;
      img[o] = Math.round(255 * Math.min(1, v * 1.6));
      img[o + 1] = Math.round(255 * Math.max(0, v * 1.6 - 0.6));
      img[o + 2] = Math.round(255 * Math.max(0, 0.4 - v) * 1.5);
    }
  }
  png(path, W, H, img);
}

const bySound = Object.fromEntries(CARS.map((c) => [c.sound, c]));
for (const name of Object.keys(ENGINE_PROFILES)) {
  const spec = bySound[name] || { idle: 900, redline: 7000 };
  const p = engineProfile(name, spec);
  const red = p.redline,
    idle = p.idle;
  // 0-2 s idle, 2-8 s full-throttle sweep to redline, 8-10 s lift-off (overrun), 10-12 s cruise
  const script = (t) => {
    if (t < 2) return { rpm: idle, throttle: 0, gain: 1 };
    if (t < 8) return { rpm: idle + (red * 0.98 - idle) * ((t - 2) / 6), throttle: 1 };
    if (t < 10) return { rpm: red * 0.98 - (red * 0.6) * ((t - 8) / 2), throttle: 0 };
    return { rpm: red * 0.4, throttle: 0.35 };
  };
  const [L, R] = render(p, script, 12);
  wav(`${outDir}/${name}.wav`, L, R);
  spectrogram(`${outDir}/${name}.png`, L);
  const seg = (a, b) => stats(L, Math.floor(a * SR), Math.floor(b * SR));
  const f = (s) => `rms ${s.rms.toFixed(3)} peak ${s.peak.toFixed(2)} dc ${s.dc.toFixed(4)}`;
  console.log(name.padEnd(10), `idle ${f(seg(0.5, 2))} | wot-low ${f(seg(2.5, 4))} | wot-high ${f(seg(6.5, 8))} | overrun ${f(seg(8, 10))} | cruise ${f(seg(10.5, 12))}`);
  // the same run heard from the driver's seat
  const [Li] = render(p, (t) => ({ ...script(t), interior: 1 }), 12);
  wav(`${outDir}/${name}-cabin.wav`, Li, Li);
  const ci = (a, b) => stats(Li, Math.floor(a * SR), Math.floor(b * SR));
  console.log(''.padEnd(10), `cabin: idle ${f(ci(0.5, 2))} | wot-high ${f(ci(6.5, 8))} | cruise ${f(ci(10.5, 12))}`);
}
