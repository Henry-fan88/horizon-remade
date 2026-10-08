// Cloudflare hosting: the built game is served as static assets (wrangler.jsonc), and /ws
// joins a multiplayer world. Each world is one Durable Object running server/hub.js, so
// everyone in "world-1" shares a single in-memory world wherever they connect from.
import { DurableObject } from 'cloudflare:workers';
import { World as WorldHub, worldNumber, buildTime } from '../server/hub.js';

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.hub = null;
    this.clients = new Map(); // WebSocket -> hub client
    // The world lives in memory. If the object restarted while sockets stayed open, those
    // players are unknown to the new world: ask them to reconnect.
    for (const ws of ctx.getWebSockets())
      try {
        ws.close(1012, 'restart');
      } catch {}
  }

  async fetch(request) {
    // After a deploy Cloudflare can keep a busy world on its old code for minutes (code
    // updates wait for the object to go idle, and a ticking world never does). The Worker
    // in front is already on the new build: when it is newer, restart this world so every
    // player reconnects to one running the new code.
    const front = request.headers.get('X-Build') || 'dev';
    const own = this.env.BUILD_ID || 'dev';
    if (front !== 'dev' && own !== 'dev' && buildTime(front) > buildTime(own)) {
      for (const ws of this.ctx.getWebSockets())
        try {
          ws.close(1012, 'restart');
        } catch {}
      this.ctx.abort(`world replaced by build ${front}`);
    }
    if (!this.hub) {
      const id = worldNumber(new URL(request.url).searchParams.get('world'));
      const cap = Number(this.env.WORLD_CAP) || undefined;
      this.hub = new WorldHub({ id, cap, build: this.env.BUILD_ID || 'dev', log: true });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.clients.set(
      server,
      this.hub.connect({
        send: (text) => server.send(text),
        close: (code, reason) => server.close(code, reason),
      })
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    const c = this.clients.get(ws);
    if (!c) return ws.close(1012, 'restart');
    this.hub.message(c, typeof data === 'string' ? data : new TextDecoder().decode(data));
  }

  webSocketClose(ws) {
    this.drop(ws);
    try {
      ws.close(1000, 'bye');
    } catch {}
  }

  webSocketError(ws) {
    this.drop(ws);
  }

  drop(ws) {
    const c = this.clients.get(ws);
    if (!c) return;
    this.clients.delete(ws);
    this.hub.disconnect(c);
  }
}

// Pages from this site only (plus local development), so other sites can't run up the bill.
// "null" is this page inside a sandboxed frame without same-origin rights (a possible
// X post frame); only X may frame the page (FRAME_ANCESTORS).
function allowedOrigin(origin, url) {
  if (!origin || origin === 'null') return true;
  try {
    const o = new URL(origin);
    return o.host === url.host || o.hostname === 'localhost' || o.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// The page may be framed by itself and by X (the player card inside a post), nobody else.
const FRAME_ANCESTORS = "frame-ancestors 'self' https://x.com https://*.x.com https://twitter.com https://*.twitter.com";
const LINK_META = new Set(['og:url', 'og:image', 'twitter:image', 'twitter:player']);

// index.html keeps its link-preview URLs relative; X and others need them absolute.
async function page(request, env, url) {
  const res = await env.ASSETS.fetch(request);
  if (!res.headers.get('Content-Type')?.includes('text/html')) return res;
  const out = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const key = el.getAttribute('property') || el.getAttribute('name');
        const content = el.getAttribute('content');
        if (LINK_META.has(key) && content?.startsWith('/')) el.setAttribute('content', url.origin + content);
      },
    })
    .transform(res);
  const headers = new Headers(out.headers);
  headers.set('Content-Security-Policy', FRAME_ANCESTORS);
  return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html') return page(request, env, url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 });
      if (!allowedOrigin(request.headers.get('Origin'), url)) return new Response('Forbidden', { status: 403 });
      const n = worldNumber(url.searchParams.get('world'));
      url.searchParams.set('world', String(n));
      const forward = new Request(url, request);
      forward.headers.set('X-Build', env.BUILD_ID || 'dev');
      return env.WORLD.getByName(`world-${n}`).fetch(forward);
    }
    if (url.pathname === '/health') return Response.json({ ok: true, build: env.BUILD_ID || 'dev' }, { headers: { 'Cache-Control': 'no-store' } });
    return env.ASSETS.fetch(request);
  },
};
