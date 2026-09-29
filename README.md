# HORIZON REMADE

An open-world festival racing game that runs in the browser, inspired by the Forza Horizon series.
It has a volcanic island, a road network, a festival hub, skill chains, races against AI drivers,
PR stunts, traffic, Wheelspins, a garage, and **online multiplayer** where drivers share the world
and can race each other.

The island, roads, trees, buildings, most cars, engine sounds and radio are generated
in code. Ground and road materials combine locally bundled **CC0 photographic textures**
with procedural detail; see [surface attribution](public/environment/surfaces/ATTRIBUTION.md).
Four cars use detailed, attributed real-car models: **Ferrari 458 Italia**, **Ford Mustang Shelby GT500**, **Porsche 911 GT3**, and **1967 Ford Mustang Fastback**. The Ferrari is by **vicent091036**,
and all four assets are licensed under **CC BY 4.0**, with locally bundled assets, automotive materials, and animated
wheels. See [model credits](public/models/credits.html). Other car makes, places
and music are fictional; no Forza game assets or logos are used.

![stack](https://img.shields.io/badge/three.js-r186-black) ![node](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-green)

---

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The dev server also runs the multiplayer server, so a second
browser tab or another device on your network joins the same online session.

## Play it online (deploy as a website)

The game is a static site plus a small Node WebSocket server for multiplayer. `npm start` serves
both from one port.

```bash
npm run build      # produces dist/
npm start          # serves dist/ + multiplayer on PORT (default 8080)
```

### Option A — one-click hosts (Render, Railway, Fly.io, Heroku-style)

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- The host provides the `PORT` environment variable. WebSockets must be enabled (they are by
  default on Render, Railway and Fly).
- Health check path: `/health`

### Option B — Docker

```bash
docker build -t horizon-remade .
docker run -p 8080:8080 horizon-remade
```

### Option C — static hosting only (GitHub Pages, Netlify, Vercel, S3…)

Upload the `dist/` folder. The game works fully in solo mode. For multiplayer, point it at any
running game server:

- build with `VITE_WS_URL=wss://your-server.example.com/ws npm run build`, **or**
- add `?server=wss://your-server.example.com/ws` to the page URL.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate / brake & reverse | W / S (or ↑ / ↓) | RT / LT |
| Steer | A / D (or ← / →) | Left stick |
| Handbrake | Space | A |
| Rewind (hold) | R | X |
| Reset car to road | T | Right-stick button |
| Change camera / look back | C / B | Y / Left-stick button |
| Manual shift up / down | E / Q | RB / LB |
| Start event | Enter | A |
| World map | M | View |
| Festival (pause) menu | Esc | Menu |
| Radio on/off · Horn · Lights | N · H · L | — |
| Join online race · Chat | J · Y | — |

On phones and tablets, touch controls appear automatically.

## Features

- **Island open world:** 16 km² with a volcano and crater plume, beaches, a lake, jungle, farm
  fields, a dry east, a pastel town, an airfield and a lighthouse. Roads are routed with A*
  pathfinding and carved into the terrain, including a spiral road up the volcano.
- **Visuals:** a physically based sky with clouds, stars and moon, a dynamic day/night cycle,
  height-based aerial-perspective fog, sun shadows, bloom, ACES tone mapping, colour grading, speed
  blur, water with depth-tinted shallows and shoreline foam, instanced forests with wind sway,
  tyre smoke, dust and skid marks.
- **Driving:** 120 Hz rigid-body physics with raycast suspension, slip-based tyres, weight
  transfer, turbo lag, an automatic or manual gearbox, handbrake drifts, and aero drag and
  downforce. Assists: steering/counter-steer, traction control and ABS.
- **Thirteen cars**, including four detailed real-car models and nine
  procedural cars, with performance index classes (D → X), stats, paint, finish and rim colours.
  The 458 uses the existing GT driving setup: handling, suspension, collision dimensions and
  progression are unchanged. Its displayed performance figures describe the game's tuning.
- **Horizon-style gameplay:** skill chains (drift, air, speed, near miss, wrecker, drafting,
  burnout, trade paint) with multipliers, and eight races (circuits, sprints, dirt, drag) with
  Drivatar-style AI, checkpoints and a colour-coded driving line. PR stunts (speed traps, speed
  zones, drift zones, danger-sign jumps) keep star ratings and records. There are 30 bonus boards,
  smashable fences, signs and bushes, ambient traffic, and rewind.
- **Progression:** credits, XP, levels, Wheelspins, an Autoshow and a garage, saved in
  localStorage.
- **Online:** automatic session matchmaking (16 players per session), interpolated remote cars with
  nametags and engine sounds, chat, and **Horizon Open** online races. The host starts a lobby,
  others press J to join, and everyone gets a synchronized countdown.
- **Audio:** a synthesized engine for each car type (V8, V12, flat-six, boxer, turbo whistle,
  blow-off valve, exhaust pops, EV whine), tyres, wind and impacts, plus **Horizon Pulse**, a
  procedural festival radio station.

## Project layout

```
server/            Node server: static hosting + WebSocket multiplayer (multiplayer.js)
src/config.js      Game title, world constants, default settings (rename the game here)
src/world/         World generation (worker), terrain, roads, sky/atmosphere, water, vegetation, props
src/vehicle/       Car specs, procedural car models, physics, effects
public/models/     Four attributed car models, LODs and credits (served locally)
public/draco/      Local Draco decoder and its license
public/environment/ CC0 photographed terrain and road materials, sources and checksums
src/game/          Game loop/state, camera, skills, events, races, AI, traffic, stunts, rewind, GPS
src/ui/            HUD, menus, world map, touch controls, car thumbnails
src/net/           Multiplayer client
```

URL flags that help during development: `?play` skips the title screen, `?fps` shows the frame
rate, `?car=supercar` picks a car, `?touch` forces touch controls, and `?server=wss://…` sets the
multiplayer server.

## Customising

- **Rename the game:** edit `GAME_TITLE`, `GAME_SUBTITLE` and `FESTIVAL_NAME` in `src/config.js`
  (and the `<title>` / loading logo in `index.html`).
- **Cars:** add or tweak entries in `src/vehicle/carspecs.js`. Body shapes are side-profile and
  plan curves in `STYLES`; physics comes from power, mass, grip, top speed and drivetrain.
  `STYLES.gt.visualAsset` selects the 458 visual adapter in `src/vehicle/realcar.js`. The original
  procedural GT remains available as a fallback if the GLB cannot load. Do not edit the chassis
  dimensions to fit an asset: those dimensions also control the physics.
  While the dev server is running, open `/tools/car-preview.html` for the same car model in a
  studio with camera, paint, wheel and lamp controls plus integration checks.
- **World:** the island is generated from `WORLD.seed` in `src/config.js`. `node tools/mapdebug.mjs`
  renders a top-down preview image of the generated island and prints road statistics.
  The local PBR materials are documented in `public/environment/surfaces/ATTRIBUTION.md`.
  They preload alongside the car and world generation, with procedural fallbacks if unavailable.
  In development, open `/?environment&car=gt` to inspect the actual festival, town, countryside,
  coast and highlands, orbit each scene, and compare daylight/golden hour/night. **Drive here**
  returns to the game. The inspector is excluded from production builds.

## A note on the name

This is an unofficial fan project. It is not affiliated with Microsoft, Xbox Game Studios or
Playground Games. "Forza" and "Forza Horizon" are their trademarks, and none of their assets,
logos, cars or music are included. If you publish the game, keep it clearly unofficial and consider
renaming it in `src/config.js`.

## Requirements

A browser with WebGL2 (current Chrome, Edge, Firefox or Safari). Development and builds require
Node.js 20.19+ within the 20.x series, or Node.js 22.12+; this matches the bundled Vite version.

### Real-car expansion

The Shelby GT500, 911 GT3 and 1967 Mustang Fastback are added to **My Cars** once for both new and existing saves. Existing cars, paint, credits and records are preserved. You can also test them with `?car=shelby`, `?car=gt3` and `?car=fastback`. The model studio at `/tools/car-preview.html` has a car selector, steering, wheel rotation, paint and lamp controls.

Source credits, licenses and checksums live in each `public/models/<asset>/ATTRIBUTION.md`; all credits are also linked in the game. See `tools/car-assets/README.md` to reproduce the asset preparation. New car performance is game tuning; acceleration figures are measured using this game’s physics, not claimed factory test results.
