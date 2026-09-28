import { defineConfig } from 'vite';
import { attachMultiplayer } from './server/multiplayer.js';

// The multiplayer WebSocket server is attached to Vite's own HTTP server in dev/preview,
// so `npm run dev` gives you the full online game on one port.
function multiplayerPlugin() {
  return {
    name: 'horizon-multiplayer',
    configureServer(server) {
      if (server.httpServer) attachMultiplayer(server.httpServer, { log: true });
    },
    configurePreviewServer(server) {
      if (server.httpServer) attachMultiplayer(server.httpServer, { log: true });
    },
  };
}

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  plugins: [multiplayerPlugin()],
});
