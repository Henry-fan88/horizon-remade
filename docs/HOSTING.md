# Host your own game

[Back to the README](../README.md)

The browser game builds into `dist/`. Solo play needs static hosting; multiplayer
also needs a WebSocket server. The same world logic in `server/hub.js` runs on
Node.js or Cloudflare Durable Objects.

Install the locked dependencies with `npm ci` before using the commands below.

## Local multiplayer

```bash
npm run dev
```

Open Vite's printed address. Other computers on your LAN can use the printed
Network address if your firewall allows it. Do not give friends `localhost` as
your address: that points to their own computer. Use production hosting for a
public game; the Vite server is intended for development.

## Node.js

```bash
npm run build
npm start
```

The server serves the game and `/ws` from port **8080** by default. `PORT` changes
the port and `HOST` changes the listen address (default `0.0.0.0`). A host should
run `npm ci && npm run build` as its build command and `npm start` as its start
command. `/health` provides a health check.

For public hosting, put HTTPS in front of the server and forward WebSocket upgrade
requests for `/ws`. Static files and multiplayer can share one domain.

## Docker

```bash
docker build -t horizon-remade .
docker run --rm -p 8080:8080 horizon-remade
```

Then open `http://localhost:8080`. The existing Dockerfile builds the static site
and runs the Node server as a non-root user.

## Cloudflare

Use your own Cloudflare account and choose an available Worker name in
`wrangler.jsonc` before deploying a fork. Check the current platform's plan and
usage limits for Workers and Durable Objects.

```bash
npx wrangler login
npm run cf:dev    # build and test the Cloudflare setup locally
npm run deploy   # build and publish to your account
```

`wrangler.jsonc` serves the static files and routes `/ws` to one Durable Object
per world. `tools/deploy.mjs` gives the page and server a matching build ID.
Deployments restart worlds; clients reconnect and older pages are asked to reload.

World climate settings persist in Durable Object storage. The Node implementation
keeps those settings while its process runs. Neither host provides cloud saves
for player garages or progress.

## Static hosting

```bash
npm run build
```

Upload the **contents of `dist/`**, keeping the models, textures, decoder and
license files. The game supports solo play without a multiplayer server.

To connect a separately hosted multiplayer server, either set `VITE_WS_URL` at
build time or use the `server` query parameter:

```bash
VITE_WS_URL=wss://your-server.example.com/ws npm run build
```

Example page URL: `https://your-game.example.com/?server=wss://your-server.example.com/ws`.
Use `wss://` for a game served over HTTPS. The Cloudflare Worker currently allows
same-host and local-development origins; a game and Worker on different hosts
need an explicit allowed-origin change in `worker/index.js`. The Node transport
does not currently restrict origins.

## Link previews and embedding

`index.html` includes Open Graph and X player-card metadata. `/?embed=1` uses a
compact interface and a CLICK TO DRIVE overlay. The Cloudflare Worker makes
preview URLs absolute and permits framing by the site itself and X/Twitter.
Whether a third-party platform actually displays an interactive card depends on
that platform; embedding is not required to play the game.

If you rename a fork, update the title, metadata and `public/card.jpg` as well as
the in-game branding. Check the framing headers when embedding on other sites.

## Public server expectations

New players join world 1, with overflow worlds when its configured 80-player
capacity is reached. That setting is a capacity limit, not a performance guarantee.
There are no private invite codes, authenticated accounts, administrator roles or
moderation tools. Any joined player can change shared climate settings, and race
progress is reported by clients. Use the game for casual sessions; add server-side
validation before building competitive rankings on top of it.

Keep the [third-party notices](../THIRD_PARTY_NOTICES.md), asset attributions and
`licenses/` directory with redistributed builds. GitHub CI only tests and builds;
publishing is a separate action.
