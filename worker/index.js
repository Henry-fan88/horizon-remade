// Cloudflare hosting: the built game is served as static assets (wrangler.jsonc), and /ws
// joins a multiplayer world. Each world is one Durable Object running server/hub.js, so
// everyone in "world-1" shares a single in-memory world wherever they connect from.
import { DurableObject } from 'cloudflare:workers';
import { World as WorldHub, worldNumber } from '../server/hub.js';

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
function allowedOrigin(origin, url) {
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === url.host || o.hostname === 'localhost' || o.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 });
      if (!allowedOrigin(request.headers.get('Origin'), url)) return new Response('Forbidden', { status: 403 });
      const n = worldNumber(url.searchParams.get('world'));
      url.searchParams.set('world', String(n));
      return env.WORLD.getByName(`world-${n}`).fetch(new Request(url, request));
    }
    if (url.pathname === '/health') return Response.json({ ok: true, build: env.BUILD_ID || 'dev' }, { headers: { 'Cache-Control': 'no-store' } });
    return env.ASSETS.fetch(request);
  },
};
