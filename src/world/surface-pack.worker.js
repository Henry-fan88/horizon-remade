// Packs the terrain's photographic surface maps into two texture-array payloads off the
// main thread: albedo (sRGB RGB) + roughness (A), and normal (RG) + displacement (B).
// Also returns each layer's mean linear albedo, used to grade the scans per biome.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

async function pixels(url, size, ctx) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return ctx.getImageData(0, 0, size, size).data;
}

self.onmessage = async (e) => {
  const { layers, size, normalSize } = e.data;
  try {
    const albedo = new Uint8Array(size * size * 4 * layers.length);
    const normal = new Uint8Array(normalSize * normalSize * 4 * layers.length);
    const mean = new Float32Array(layers.length * 3);
    const big = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
    const small = new OffscreenCanvas(normalSize, normalSize).getContext('2d', { willReadFrequently: true });
    for (let l = 0; l < layers.length; l++) {
      const L = layers[l];
      const diff = await pixels(L.diff, size, big);
      const a0 = l * size * size * 4;
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0, n = size * size; i < n; i++) {
        albedo[a0 + i * 4] = diff[i * 4];
        albedo[a0 + i * 4 + 1] = diff[i * 4 + 1];
        albedo[a0 + i * 4 + 2] = diff[i * 4 + 2];
        if ((i & 15) === 0) {
          r += toLinear(diff[i * 4] / 255);
          g += toLinear(diff[i * 4 + 1] / 255);
          b += toLinear(diff[i * 4 + 2] / 255);
        }
      }
      const count = (size * size) / 16;
      mean.set([r / count, g / count, b / count], l * 3);
      const ro = L.rough ? await pixels(L.rough, size, big) : null;
      for (let i = 0, n = size * size; i < n; i++) albedo[a0 + i * 4 + 3] = ro ? ro[i * 4] : 230;
      const nor = L.nor ? await pixels(L.nor, normalSize, small) : null;
      const disp = L.disp ? await pixels(L.disp, normalSize, small) : null;
      const n0 = l * normalSize * normalSize * 4;
      for (let i = 0, n = normalSize * normalSize; i < n; i++) {
        normal[n0 + i * 4] = nor ? nor[i * 4] : 128;
        normal[n0 + i * 4 + 1] = nor ? nor[i * 4 + 1] : 128;
        normal[n0 + i * 4 + 2] = disp ? disp[i * 4] : 128;
        normal[n0 + i * 4 + 3] = 255;
      }
    }
    self.postMessage({ ok: true, albedo, normal, mean }, [albedo.buffer, normal.buffer, mean.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
