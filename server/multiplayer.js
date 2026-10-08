// Node transport for the multiplayer worlds (server/hub.js): used by `npm run dev` (attached
// to Vite's server) and by the production Node server. Cloudflare uses worker/index.js.
//   ws://host/ws?world=N   (N defaults to 1; a full world sends the client on to N+1)
import { WebSocketServer } from 'ws';
import { World, worldNumber } from './hub.js';

export { PROTOCOL } from './hub.js';

export function attachMultiplayer(httpServer, { path = '/ws', log = false, build = 'dev', cap } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  const worlds = new Map();
  const saved = new Map(); // world settings outlive an empty world while the server runs
  const worldFor = (n) => {
    let w = worlds.get(n);
    if (!w) {
      w = new World({
        id: n,
        build,
        cap,
        log,
        settings: saved.get(n),
        onSettings: (s) => saved.set(n, s),
        onEmpty: (empty) => worlds.get(n) === empty && worlds.delete(n),
      });
      worlds.set(n, w);
    }
    return w;
  };
  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return;
    }
    if (url.pathname !== path) return;
    const n = worldNumber(url.searchParams.get('world'));
    wss.handleUpgrade(req, socket, head, (ws) => {
      const world = worldFor(n);
      const client = world.connect({
        send: (text) => ws.readyState === 1 && ws.send(text),
        close: (code, reason) => ws.close(code, reason),
      });
      ws.on('message', (data) => world.message(client, data.toString('utf8')));
      ws.on('close', () => world.disconnect(client));
      ws.on('error', () => {});
    });
  });
  httpServer.on('close', () => {
    for (const w of worlds.values()) w.stop();
  });
  const stats = () => {
    const list = [...worlds.values()].map((w) => w.stats());
    return { players: list.reduce((n, w) => n + w.players, 0), worlds: list };
  };
  return { wss, worlds, stats };
}
