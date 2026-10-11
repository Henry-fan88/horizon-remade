# Development guide

[Back to the README](../README.md) · [Contributing](../CONTRIBUTING.md)

The browser game uses JavaScript ES modules, Three.js and Vite. World generation
runs in a Web Worker, engine synthesis runs in an AudioWorklet, and multiplayer
uses WebSockets. Most content changes involve editing code; there is no general
mod API or visual track editor yet.

## Setup and checks

Use Node.js 22.12+ in the 22.x series (`nvm use` if you use nvm), then run commands
from the repository root:

```bash
npm ci
npm run dev
```

Open the address printed by Vite. No API keys, account, Blender installation or
asset downloads are needed to run the bundled game. Blender is only needed when
rebuilding imported models.

```bash
npm test
npm run build
```

`npm test` uses Node's built-in test runner and includes localhost WebSocket tests.
The test suite covers handling, cameras, terrain/road connections, weather, snow,
asset integration, save migration and multiplayer. Browser rendering, audio,
controller compatibility and full multiplayer capacity need separate playtesting.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/config.js` | World seed, title and default settings |
| `src/game/` | Main loop, races, AI, traffic, progression, skills and weather |
| `src/vehicle/` | Car specifications, models, physics, cockpit and effects |
| `src/world/` | Terrain, roads, city, vegetation, atmosphere and climate |
| `src/core/` | Input, audio, music, math and worker helpers |
| `src/render/` | Post-processing, reflections and distant shadows |
| `src/ui/` | Menus, HUD, world map and embedded view |
| `src/net/` | Multiplayer client and motion prediction |
| `server/` | Shared multiplayer logic, protocol and Node transport |
| `worker/` | Cloudflare transport for the same multiplayer worlds |
| `public/models/` | Seven playable car assets, legacy MP4/5, traffic and credits |
| `public/environment/` | Surface textures, sources and checksums |
| `public/licenses/` | Notices shipped with the built website |
| `tools/` | Tests, performance benches, previews and asset preparation |

## Development views

These paths are available on the development server:

| URL | Purpose |
| --- | --- |
| `/?play&fps` | Skip the title and show frame rate |
| `/?play&car=gt3` | Start in a particular car |
| `/tools/car-preview.html?car=gt3` | Car studio: paint, wheels, lamps and detail levels |
| `/tools/traffic-preview.html` | Civilian traffic model viewer |
| `/?environment&view=City` | Environment inspector with lighting and travel controls |

Car IDs are `gt`, `shelby`, `gt3`, `fastback`, `f1`, `sf23` and `rb19`.
`f1` selects the modern McLaren MCL60. Development inspectors and `tools/` preview
pages are not part of the production site.

## Customising

- **Rename the game:** edit `GAME_TITLE`, `GAME_SUBTITLE` and `FESTIVAL_NAME` in `src/config.js`
  (and the `<title>` / loading logo in `index.html`). Search for other Horizon branding in menus, audio labels, metadata and preview images when publishing a renamed fork.
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
  District definitions live in `src/world/districts.js`. The city's block layout, neighbourhoods and
  sidewalk plan are in `src/world/city-layout.js`; `city-props.js` assembles the district from
  `city-buildings.js` (building types), `city-landmarks.js`, `city-street.js` (streetscape, yards),
  `city-trees.js` and `city-materials.js` (procedural facade shaders and the sign atlas), all
  instanced through `city-kit.js`. Other districts' architecture is in `src/world/district-props.js`;
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

## Weather and networking

`src/world/climate.js` computes climate from time and setting-change logs.
`src/game/weather.js` applies it in the game. The server keeps shared settings in
`server/hub.js`; online clients receive them through `src/net/net.js`.

`server/protocol.js` defines the wire format shared by server and client. Update
both sides when changing it and check build/version compatibility. Online AI is
simulated by one participating client, with handover if it leaves. Player movement
and race progress are client-reported; competitive server validation is future work.

## Car saves and asset preparation

The real-car and modern Formula 1 packs grant cars once to existing saves. Preserve
stable save IDs and test migrations when changing the roster. The legacy MP4/5 is
still bundled and attributed, but is not offered in the current garage.

See the [asset preparation guide](../tools/car-assets/README.md) for Blender commands,
source provenance and model adaptation. Keep the [third-party notices](../THIRD_PARTY_NOTICES.md)
and per-model attribution current when adding or replacing assets.
