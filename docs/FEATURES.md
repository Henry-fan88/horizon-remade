# World and features

[Back to the README](../README.md) · [How to play](PLAYING.md)

- **One continuous island (6 × 6 km world):** broad wooded lowlands join every environment — *Sierra Nevada*
  (snowy peaks, six-hairpin Paso Nevado), the *Autódromo Horizonte* circuit (kerbs, gravel
  traps, tyre walls, grandstands, pit building, start lights) and *Cañón Rojo* (red-rock
  canyon rally loop). The expanded routes include: Autódromo Grand Prix, Paso Nevado Hillclimb and
  Descent, Cañón Rojo Rally and the Isla Grand Tour. The circuit has a road connection through its paddock and pit entrance.
- **Island interior:** a volcano and crater plume, beaches, a lake, jungle, farm
  fields, a dry east, a San Francisco-inspired city, an airfield and a lighthouse. Roads are routed with A*
  pathfinding and carved into the terrain, including a spiral road up the volcano.
  Junctions use shared, rounded pavement with continuous outer edge lines and clear approaches;
  road paint, crosswalks, bridge rails and roadside props follow those same junction boundaries.
  Lowland terrain, ground materials and vegetation blend gradually into each district.
- **Six environments to explore:** the San Francisco-inspired city has about 680 buildings on
  zero-lot-line street fronts, with commercial block interiors built up and residential blocks
  keeping planted back yards. Neighbourhoods follow the real city's logic around Market Street:
  Victorian and Edwardian rows (canted bay windows, bracketed cornices, stoops, garages, Queen Anne
  gables and corner turrets) in the Western Addition, Haight and Mission; Nob Hill apartment
  houses with curbside canopies; Chinatown balconies, pagoda eaves, blade signs and lantern-strung
  Grant Avenue behind the Dragon Gate; North Beach cafes; Financial District stone, Art Deco
  setbacks and glass towers; SoMa brick lofts with ghost signs; and pier sheds on the Embarcadero.
  Landmarks include the Transamerica Pyramid, Salesforce Tower, 555 California, Coit Tower, the
  Ferry Building and Union Square, plus a red suspension bridge on the eastern lowland road.
  Eighteen streets follow different neighborhood alignments, with diagonal Market/Columbus
  avenues, Lombard's brick switchbacks and hydrangea beds, and real hills. This is a compact
  playable adaptation, not a surveyed street-for-street reconstruction.
  Streets carry Path of Gold lamps and red transit lanes on Market, Muni trolley wires, cable car
  tracks on Powell and California, palms on the Embarcadero, London planes and ficus downtown,
  painted curbs, hydrants, all-way stop signs, corner street signs and wooden utility poles in the
  residential rows. The city includes 422 shopfronts, about 1,000 street and garden trees,
  crossings, benches, parking meters, 168 parked civilian vehicles, 240 animated pedestrians,
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
- **Weather and seasons:** changing clear skies, cloud, rain, thunderstorms, fog and snow; spring, summer, autumn and winter. Climate follows shared server time online, including transitions, lightning, road wetness and snow cover. Wet roads change braking and cornering grip.
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
- **Online:** one shared world for everyone on the site (80 per world; extra worlds open when
  one is full). Other cars are drawn where they are now rather than where they were
  (`src/net/sync.js`). Each state carries the moment it was true. Receivers predict forward
  from its velocity, acceleration and turn rate, stop the prediction at walls, and blend
  corrections in. Cars send when that prediction would drift (up to 30 Hz in a small world).
  The clock sync trusts only the fastest pings. Remote cars have nametags and engine sounds.
- **Online races:** at any race marker, **INVITE & RACE** opens a 20 s lobby for everyone in the
  world. Players join with J, and the host's J starts the race at once. Everyone races on one
  grid against the same AI opponents. One member's game drives them and streams them like
  players (everyone else, spectators included, draws them). If that member leaves or goes
  quiet, another takes the opponents over mid-race. Standings and results include the
  opponents. In online races players are ghosts to the other cars, and menus don't pause. The nearest
  ten use their real model, farther ones a single instanced stand-in, and beyond 2.5 km they
  appear only on the map. Time of day follows the server clock, so everyone shares one sky.
  Also includes chat and **Horizon Open** online races: the host starts a lobby, others press J
  to join, and everyone gets a synchronized countdown.
- **Audio:** an AudioWorklet engine synthesizer (`src/core/engine-worklet.js`) that fires each
  cylinder in its real firing order through modelled headers, pipe and muffler resonances:
  flat-plane V8 (458), supercharged cross-plane V8 (GT500), flat-six (GT3), loping 289 V8
  (Fastback), with intake roar, overrun crackle, dual-clutch upshift "brap" and a muffled
  in-cabin mix. `node tools/enginebench.mjs` renders WAVs and spectrograms. Tyres, wind, impacts, plus **Horizon Pulse**, a
  procedural festival radio station.
