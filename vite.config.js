import { defineConfig } from 'vite';
import { attachMultiplayer } from './server/multiplayer.js';

// One id per build (set by tools/deploy.mjs). The page sends it when joining a world and the
// server asks pages from another build to reload, since the map may have changed between them.
const BUILD_ID = process.env.BUILD_ID || 'dev';

// The multiplayer WebSocket server is attached to Vite's own HTTP server in dev/preview,
// so `npm run dev` gives you the full online game on one port.
function multiplayerPlugin() {
  return {
    name: 'horizon-multiplayer',
    configureServer(server) {
      if (server.httpServer) attachMultiplayer(server.httpServer, { log: true });
    },
    configurePreviewServer(server) {
      if (server.httpServer) attachMultiplayer(server.httpServer, { log: true, build: BUILD_ID });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  plugins: [multiplayerPlugin()],
});
