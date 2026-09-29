# Preparing the real-car expansion

Use Blender 5.2 in a separate background process; do not run the script inside an existing scene. Download the files normally from the credited Sketchfab pages, then run from the repository root:

```sh
blender --background --factory-startup --python tools/car-assets/prepare.py -- shelby-gt500 /path/to/ford_mustang_shelby_gt500.glb public/models/shelby-gt500
blender --background --factory-startup --python tools/car-assets/prepare.py -- porsche-911-gt3 /path/to/unzipped-porsche/scene.gltf public/models/porsche-911-gt3
blender --background --factory-startup --python tools/car-assets/prepare.py -- mustang-fastback /path/to/1967_ford_mustang_fastback_-_4096px2.glb public/models/mustang-fastback
```

The script produces `car.glb` and `geometry.json`, with body, four wheel mounts, stationary brakes and three LODs. Copy changed measurements into `src/vehicle/modelcatalog.js` after rebuilding. Refresh the adapted file checksum in its attribution. Source downloads stay unchanged.

Runtime merges plain parts with per-vertex material parameters to reduce draw calls. Geometry and textures are shared, while paint and lamp materials are isolated per car. A failed download/decode keeps the procedural fallback drivable.

The GT500 and GT3 use representative headline power from [Ford’s 2020 specifications](https://media.ford.com/content/dam/fordmedia/North%20America/US/product/2020/mustang/2020-Mustang-Tech_Specs.pdf) and [Porsche’s GT3 press kit](https://newsroom.porsche.com/dam/jcr%3Afb50dab0-0b3d-4b2d-b4d7-70e42fc381cf/PAG_992_GT3_EN.pdf). The classic uses a 225 hp V8-inspired tune. Tyres, suspension, aerodynamic coefficients, gear spacing, prices and performance ratings are game design values, not a claim of full factory simulation.

Validation: `npm run build`; `node --test tools/car-assets/save-migration.test.mjs`; `node tools/physbench.mjs perf`; model studio (`/tools/car-preview.html?car=shelby`, `gt3` or `fastback`) for paint, lights, steering, all three distance levels and disposal isolation. The GT3 retains its full close-range paint shell to prevent inner panels intersecting the exterior; cabin and mechanical detail are simplified.
