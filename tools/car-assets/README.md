# Preparing the real-car expansion

Use Blender 5.2 in a separate background process; do not run the script inside an existing scene. Download the files normally from the credited Sketchfab pages, then run from the repository root:

```sh
blender --background --factory-startup --python tools/car-assets/prepare.py -- shelby-gt500 /path/to/ford_mustang_shelby_gt500.glb public/models/shelby-gt500
blender --background --factory-startup --python tools/car-assets/prepare.py -- porsche-911-gt3 /path/to/unzipped-porsche/scene.gltf public/models/porsche-911-gt3
blender --background --factory-startup --python tools/car-assets/prepare.py -- mustang-fastback /path/to/1967_ford_mustang_fastback_-_4096px2.glb public/models/mustang-fastback
blender --background --factory-startup --python tools/car-assets/prepare.py -- mclaren-mp45 /path/to/mclaren_mp45__formula_1.glb public/models/mclaren-mp45
```

The McLaren MP4/5 is the GLB download with 4096 px textures. Its wheels come as one mesh per axle and are split into left and right; the rear ones carry their driveshafts, so each wheel's centre and width are measured from the tyre alone. Its separate steering wheel becomes the `steering` mount directly (the frame is fitted to the rim), the livery, cockpit and windscreen keep their full source detail, and its sixteen texture maps are stored as WebP (about 6 MB instead of about 36 MB of PNG).

The script produces `car.glb` and `geometry.json`, with body, four wheel mounts, stationary brakes and three LODs. For the GT500 and GT3 it also cuts the driver's steering wheel out into a `steering` mount (its local +Z is the column axis) so the in-car camera can turn it, and the GT3 keeps extra cabin detail (`STEER` and `CABIN` in the script). Copy changed measurements into `src/vehicle/modelcatalog.js` after rebuilding. Refresh the adapted file checksum in its attribution. Source downloads stay unchanged.

Runtime merges plain parts with per-vertex material parameters to reduce draw calls. Geometry and textures are shared, while paint and lamp materials are isolated per car. A failed download/decode keeps the procedural fallback drivable.

The GT500 and GT3 use representative headline power from [Ford’s 2020 specifications](https://media.ford.com/content/dam/fordmedia/North%20America/US/product/2020/mustang/2020-Mustang-Tech_Specs.pdf) and [Porsche’s GT3 press kit](https://newsroom.porsche.com/dam/jcr%3Afb50dab0-0b3d-4b2d-b4d7-70e42fc381cf/PAG_992_GT3_EN.pdf). The classic uses a 225 hp V8-inspired tune. Tyres, suspension, aerodynamic coefficients, gear spacing, prices and performance ratings are game design values, not a claim of full factory simulation.

Validation: `npm run build`; `node --test tools/car-assets/save-migration.test.mjs`; `node tools/physbench.mjs perf`; model studio (`/tools/car-preview.html?car=shelby`, `gt3`, `fastback` or `f1`) for paint, lights, steering, all three distance levels and disposal isolation. The GT3 retains its full close-range paint shell to prevent inner panels intersecting the exterior; cabin and mechanical detail are simplified.


## Modern F1 pack (2023)

The active F1 roster uses Redgrund's CC BY 4.0 McLaren MCL60, Ferrari SF23 and Red Bull RB19. Download their 4K GLBs normally from the source links in each model's attribution, then run:

```sh
blender --background --factory-startup --python tools/car-assets/prepare-modern-f1.py -- mclaren-mcl60 /path/to/mclaren_mcl60_f1_2023.glb public/models/mclaren-mcl60
blender --background --factory-startup --python tools/car-assets/prepare-modern-f1.py -- ferrari-sf23 /path/to/scuderia_ferrari_f1_sf23_2023.glb public/models/ferrari-sf23
blender --background --factory-startup --python tools/car-assets/prepare-modern-f1.py -- redbull-rb19 /path/to/oracle_red_bull_f1_car_rb19_2023.glb public/models/redbull-rb19
```

The script reconstructs connected parts from the source mesh chunks, identifies all four round tyre assemblies, keeps tyre deflectors stationary under the steering mounts, preserves UV liveries, extracts the MCL60/RB19 steering assemblies, and exports Draco/WebP with three LODs. The SF23's empty cockpit receives a supplemental generic race steering wheel in `src/vehicle/formulasteering.js`. The 3.6 m wheelbase is a representative scale; other dimensions are measured from the artwork.

The original MP4/5 assets and preparation path remain available, but are no longer preloaded or offered in the garage. Its `f1` save ID now selects the MCL60. The `modern-formula-2023` pack grants `sf23` and `rb19` once without resetting progress or regranting sold cars.

The F1 entries share a balanced game tune. The V6 layout, eight gears and 798 kg basis follow [McLaren's MCL60 specification](https://www.mclaren.com/racing/formula-1/2023/car-launch/mclaren-mcl60-technical-specification/) and [Ferrari's SF23 specification](https://www.ferrari.com/en-US/formula1/sf-23). Power, grip, gearing ratios and aero are game design values; there is no separate ERS or DRS simulation. V6 audio is synthesized rather than a team recording.

Validate with the existing save migration tests, `node --test tools/car-assets/modern-f1.test.mjs`, `node tools/physbench.mjs perf`, `node tools/enginebench.mjs /tmp/f1-audio`, and `npm run build`. Studio URLs: `/tools/car-preview.html?car=f1`, `?car=sf23`, `?car=rb19`.

## Civilian ambient traffic

`src/vehicle/trafficspecs.js` contains a separate eight-vehicle roster; it does not add cars
to ownership or race selection. `src/vehicle/trafficmodels.js` loads the shared 6.8 MB pack
and preserves body paint, glass, wheels, and lamp materials through three detail levels.
See `public/models/civilian-traffic/ATTRIBUTION.md` for source and license.

Rebuild from the Sketchfab 1k GLB download in an isolated Blender process:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python tools/car-assets/prepare-traffic.py -- /path/to/generic_passenger_car_pack.glb \
  public/models/civilian-traffic
node --test tools/car-assets/traffic.test.mjs
```

The preparation measures body size and wheel placement, keeps UV atlases, and constrains
the reduced meshes to their original bounds. Use `/tools/traffic-preview.html` to inspect
the actual instanced traffic renderer, paint variants, front/rear views, and all three LODs.
