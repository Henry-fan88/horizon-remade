// Production server: serves the built game (dist/) and the multiplayer WebSocket on one port.
//   npm run build && npm start        (PORT env var, default 8080)
import http from 'node:http';
import { createReadStream, promises as fsp } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { attachMultiplayer } from './multiplayer.js';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);

let mp = null;

async function serveFile(req, res, filePath) {
  let st;
  try {
    st = await fsp.stat(filePath);
    if (st.isDirectory()) {
      filePath = join(filePath, 'index.html');
      st = await fsp.stat(filePath);
    }
  } catch {
    return false;
  }
  const ext = extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  headers.ETag = etag;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const accept = String(req.headers['accept-encoding'] || '');
  if (COMPRESSIBLE.has(ext) && st.size > 1024) {
    headers.Vary = 'Accept-Encoding';
    if (/\bbr\b/.test(accept)) {
      headers['Content-Encoding'] = 'br';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end(), true;
      createReadStream(filePath).pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })).pipe(res);
      return true;
    }
    if (/\bgzip\b/.test(accept)) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end(), true;
      createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return true;
    }
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end(), true;
  createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, build: BUILD, ...(mp ? mp.stats() : {}) }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    // resolve inside dist/ only (no path traversal)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = resolve(ROOT, rel);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (await serveFile(req, res, filePath)) return;
    // SPA fallback
    if (!extname(rel)) {
      if (await serveFile(req, res, join(ROOT, 'index.html'))) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// The build id ties the page to the server: a client from another build is asked to reload.
let BUILD = 'dev';
try {
  BUILD = JSON.parse(await fsp.readFile(join(ROOT, 'version.json'), 'utf8')).build || 'dev';
} catch {}
mp = attachMultiplayer(server, { log: true, build: BUILD });

server.listen(PORT, HOST, async () => {
  try {
    await fsp.access(join(ROOT, 'index.html'));
  } catch {
    console.warn('⚠  dist/ not found — run `npm run build` first.');
  }
  console.log(`\n  HORIZON REMADE server running`);
  console.log(`  → Game:        http://localhost:${PORT}`);
  console.log(`  → Multiplayer: ws://localhost:${PORT}/ws`);
  console.log(`  → Health:      http://localhost:${PORT}/health\n`);
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    console.log('Shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
