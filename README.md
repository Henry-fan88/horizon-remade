# HORIZON REMADE

An open-world festival racing game for laptop and desktop browsers, inspired by the Forza Horizon series.
It has a volcanic island, a road network, a festival hub, skill chains, races against AI drivers,
PR stunts, traffic, Wheelspins, a garage, and **online multiplayer** where drivers share the world
and can race each other.

The island, roads, trees, buildings, engine sounds and radio are generated in code. Ground and road materials combine locally bundled **CC0 photographic textures**
with procedural detail; see [surface attribution](public/environment/surfaces/ATTRIBUTION.md).
Seven cars use detailed, attributed real-car models: **Ferrari 458 Italia**, **Ford Mustang Shelby GT500**, **Porsche 911 GT3**, **1967 Ford Mustang Fastback**, plus the 2023 **McLaren MCL60**, **Ferrari SF23**, and **Red Bull RB19** Formula 1 cars. The Ferrari 458 is by **vicent091036** and the three modern F1 models are by **Redgrund**,
and all seven assets are licensed under **CC BY 4.0**, with locally bundled assets, automotive materials, and animated
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

| Action | Keyboard / Mouse | Gamepad |
| --- | --- | --- |
| Accelerate / brake & reverse | W / S (or ↑ / ↓) | RT / LT |
| Steer | A / D (or ← / →) | Left stick |
| Handbrake | Space | A |
| Rewind (hold) | R | X |
| Reset car to road | T | Right-stick button |
| Change camera / look back | C / B | Y / Left-stick button |
| Look around (all cameras) | Left mouse button + drag | — |
| Manual shift up / down | E / Q | RB / LB |
| Start event | Enter | A |
| World map | M | View |
| Festival (pause) menu | Esc | Menu |
| Radio on/off · Horn · Lights | N · H · L | — |
| Join online race · Chat | J · Y | — |

Play with a keyboard and mouse, or a gamepad, in a laptop or desktop browser.
In **any driving camera**, drag with the left mouse button to look 360 degrees around
and up or down. **Chase** and **Far Chase** orbit around the car, keeping it in frame;
**Hood**, **Bumper** and **Cockpit** look from their normal camera positions. After three
seconds without drag movement, the camera smoothly returns to its normal driving view.

## Features

- **One continuous island (6 × 6 km world):** broad wooded lowlands join every environment — *Sierra Nevada*
  (snowy peaks, six-hairpin Paso Nevado), the *Autódromo Horizonte* circuit (kerbs, gravel
  traps, tyre walls, grandstands, pit building, start lights) and *Cañón Rojo* (red-rock
  canyon rally loop). Five new races: Autódromo Grand Prix, Paso Nevado Hillclimb and
  Descent, Cañón Rojo Rally and the Isla Grand Tour. The circuit has a road connection through its paddock and pit entrance.
- **Island interior:** a volcano and crater plume, beaches, a lake, jungle, farm
  fields, a dry east, a San Francisco-inspired city, an airfield and a lighthouse. Roads are routed with A*
  pathfinding and carved into the terrain, including a spiral road up the volcano.
  Junctions use shared, rounded pavement with continuous outer edge lines and clear approaches;
  road paint, crosswalks, bridge rails and roadside props follow those same junction boundaries.
  Lowland terrain, ground materials and vegetation blend gradually into each district.
- **Six environments to explore:** the San Francisco-inspired city has 347 rotated building lots,
  including Victorian hillside houses, Chinatown shops, North Beach storefronts, downtown towers,
  SoMa mixed-use blocks and an open Embarcadero promenade. Eighteen streets follow different neighborhood
  alignments, with diagonal Market/Columbus avenues, Lombard bends and real hills. Landmark
  interpretations include a pyramid tower, rounded downtown tower, Coit-style lookout, Ferry
  Building and a red suspension bridge on the eastern lowland road. This is a compact playable
  adaptation, not a surveyed street-for-street reconstruction.
  The city includes 193 shops, cafe seating, produce displays, lanterns, crossings, benches,
  parking meters, street trees, hydrants, 168 parked civilian vehicles, 240 animated pedestrians,
  and a 44-car moving civilian traffic pool. Pedestrians follow sidewalks split at intersections;
  parking and buildings are checked against the driving lanes. The **Traffic & pedestrians**
  setting controls moving traffic and pedestrians; parked vehicles remain part of the scenery. Neighborhoods can be selected directly from the map.
  Dunas Doradas adds golden dunes and a connected desert trail; Bosque Verde has dense mixed
  woodland; Valle de las Granjas has patchwork crops, barns, farmhouses and silos; Sierra Nevada
  has snowy pines, chalets and snowbanks along the pass; Marisma del Lago has a connected mud
  trail, wet soil, puddles, reeds and reduced tyre grip. Open **M → Explore the island** to
  select an environment, set a route or fast travel there.
- **Scenic photo spots:** eight gold camera icons mark the volcano panorama, snowy pass,
  red canyon, dunes, lake, suspension bridge, Lombard curves and lighthouse bay. Select one
  on the world map (**M**) for viewing directions, a GPS route or fast travel. Nearby spots
  also appear on the minimap, and all eight are listed under **Explore the island**.
- **Visuals:** a physically based sky with clouds, stars and moon, a dynamic day/night cycle,
  height-based aerial-perspective fog, sun shadows, bloom, ACES tone mapping, colour grading, speed
  blur, water with depth-tinted shallows and shoreline foam, instanced forests with wind sway,
  tyre smoke, dust and skid marks.
- **Driving:** 120 Hz rigid-body physics with raycast suspension, slip-based tyres, weight
  transfer, turbo lag, an automatic or manual gearbox, handbrake drifts, and aero drag and
  downforce. Assisted steering limits cornering demand to the grip at the tyres, so heading and
  travel follow the same curve. Stability control arrests excess yaw instead of forcing rotation
  into an understeering slide. Snow and loose ground still turn wider; handbrake drifts and raw
  steering remain available. Assists: steering/counter-steer, traction control and ABS.
- **Seven real cars**, all licensed models (Ferrari 458, Shelby GT500, Porsche 911 GT3, '67
  Mustang Fastback, and the 2023 McLaren MCL60, Ferrari SF23 and Red Bull RB19 with synthesized V6 turbo sound), with performance
  index classes, stats, paint, finish and rim colours (the F1 cars keep their original liveries).
  AI racers use these garage models; single-seaters race other single-seaters, and ambient traffic uses its own civilian fleet. Press **C** to reach the **Cockpit** camera: the
  steering wheel turns, the Fastback has a built '67 cabin with working gauges.
  The 458 uses the GT driving setup, with the shared handling improvements applied to all seven cars. Its displayed performance figures describe the game's tuning.
- **Horizon-style gameplay:** skill chains (drift, air, speed, near miss, wrecker, drafting,
  burnout, trade paint) with multipliers, and eight races (circuits, sprints, dirt, drag) with
  Drivatar-style AI, checkpoints and a colour-coded driving line. PR stunts (speed traps, speed
  zones, drift zones, danger-sign jumps) keep star ratings and records. There are 30 bonus boards,
  smashable fences, signs and bushes, ambient traffic, and rewind.
- **Everyday road traffic:** eight dedicated civilian models (compact, hatchback, sedan, estate,
  minivan, pickup, SUV and utility 4×4) with varied paint, independent crash specifications,
  and three instanced distance levels. These are separate from the player garage and race AI.
  Preview the fleet at `/tools/traffic-preview.html` on the development server.
- **Progression:** credits, XP, levels, Wheelspins, an Autoshow and a garage, saved in
  localStorage.
- **Online:** automatic session matchmaking (16 players per session), interpolated remote cars with
  nametags and engine sounds, chat, and **Horizon Open** online races. The host starts a lobby,
  others press J to join, and everyone gets a synchronized countdown.
- **Audio:** an AudioWorklet engine synthesizer (`src/core/engine-worklet.js`) that fires each
  cylinder in its real firing order through modelled headers, pipe and muffler resonances:
  flat-plane V8 (458), supercharged cross-plane V8 (GT500), flat-six (GT3), loping 289 V8
  (Fastback), with intake roar, overrun crackle, dual-clutch upshift "brap" and a muffled
  in-cabin mix. `node tools/enginebench.mjs` renders WAVs and spectrograms. Tyres, wind, impacts, plus **Horizon Pulse**, a
  procedural festival radio station.

## Project layout

```
server/            Node server: static hosting + WebSocket multiplayer (multiplayer.js)
src/config.js      Game title, world constants, default settings (rename the game here)
src/world/         World generation (worker), terrain, roads, sky/atmosphere, water, vegetation, props
src/vehicle/       Car specs, real-car model adapters, cockpit, physics, effects
public/models/     Five attributed car models, LODs and credits (served locally)
public/draco/      Local Draco decoder and its license
public/environment/ CC0 photographed terrain and road materials, sources and checksums
src/game/          Game loop/state, camera, skills, events, races, AI, traffic, stunts, rewind, GPS
src/ui/            HUD, menus, world map, car thumbnails
src/net/           Multiplayer client
```

URL flags that help during development: `?play` skips the title screen, `?fps` shows the frame
rate, `?car=gt3` picks a car (`gt`, `shelby`, `gt3`, `fastback`), and `?server=wss://…` sets the
multiplayer server.

## Customising

- **Rename the game:** edit `GAME_TITLE`, `GAME_SUBTITLE` and `FESTIVAL_NAME` in `src/config.js`
  (and the `<title>` / loading logo in `index.html`).
- **Cars:** add or tweak entries in `src/vehicle/carspecs.js`. Each car's `STYLES` entry holds the
  model's measured dimensions (they also drive the physics), its cockpit eye point and steering
  ratio, and the hood/bumper camera points; physics comes from power, mass, grip, top speed and
  drivetrain. `realcar.js` adapts the Ferrari; `importedcars.js` the prepared Sketchfab models
  (see `tools/car-assets/`). If a model cannot load, a plain stand-in keeps the car drivable.
  While the dev server is running, open `/tools/car-preview.html` for the same car model in a
  studio with camera, paint, wheel and lamp controls plus integration checks.
- **Engine sounds:** profiles in `src/core/engine-profiles.js` (firing order, pipe length,
  resonances, intake, crackle). `node tools/enginebench.mjs` renders each one to WAV plus a
  spectrogram in `/tmp/enginebench`.
- **World:** the island is generated from `WORLD.seed` in `src/config.js`; the district footprints,
  broad lowland connections and authored road layouts (pass, circuit, canyon loop) live in `src/world/regions.js`
  and the circuit's barriers, stands and buildings in `src/world/circuit-props.js`.
  `node tools/mapdebug.mjs` renders a top-down preview image and prints road statistics
  (`CROP="x0,z0,x1,z1"` renders one area with contour lines).
  The local PBR materials are documented in `public/environment/surfaces/ATTRIBUTION.md`.
  They preload alongside the car and world generation, with procedural fallbacks if unavailable.
  District definitions and shared building lots live in `src/world/districts.js`; their instanced
  architecture and landmarks are in `src/world/city-props.js` and `src/world/district-props.js`;
  animated pedestrians and parked cars live in `src/game/citylife.js`. `node --test tools/environment.test.mjs`
  checks broad land connectivity, road and circuit connections, rotated building clearance, sidewalk/parking placement, smooth hillside
  junctions, the rebuilt street race, biome coverage, mud grip and driving from all six environments.
  `node --test tools/handling.test.mjs` checks actual turning trajectories for all seven cars across
  eight surfaces, both steering directions, reverse, countersteering, handbrake slides and unloaded tyres.
  `node --test tools/junctions.test.mjs` checks rounded turns, closed-road seams, skew intersections,
  non-overlapping pavement triangulation, ribbon clipping and smooth terrain joins.
  In development, open `/?environment&view=City` to inspect the actual city, desert, forest,
  rural area, snow and mud (plus the existing festival, coast and highlands), orbit each scene,
  and compare daylight/golden hour/night. **Drive here**
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

The Shelby GT500, 911 GT3 and 1967 Mustang Fastback are added to **My Cars** once. The modern McLaren MCL60 replaces the classic MP4/5 under the existing `f1` save ID. The Ferrari SF23 and Red Bull RB19 are granted once through the modern F1 pack. Existing selection, paint, credits and records are preserved. Test with `?car=shelby`, `?car=gt3`, `?car=fastback`, `?car=f1`, `?car=sf23` or `?car=rb19`. The model studio at `/tools/car-preview.html` has a car selector, steering, wheel rotation, paint and lamp controls.

Source credits, licenses and checksums live in each `public/models/<asset>/ATTRIBUTION.md`; all credits are also linked in the game. See `tools/car-assets/README.md` to reproduce the asset preparation. New car performance is game tuning; acceleration figures are measured using this game’s physics, not claimed factory test results.
