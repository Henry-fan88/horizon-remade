# Photograph-based environment surfaces

These local texture maps are **CC0 1.0 Universal** assets from Poly Haven. Poly Haven permits copying, modification, redistribution and commercial use of its assets without attribution. We retain the artist credits and provenance for the project.

- Asset license statement: https://polyhaven.com/license
- CC0 dedication: https://creativecommons.org/publicdomain/zero/1.0/
- Full legal text: https://creativecommons.org/publicdomain/zero/1.0/legalcode

| Local filename prefix | Asset and primary source | Artist | Original scanned width |
| --- | --- | --- | --- |
| `aerial_grass_rock` | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) | Rob Tuytel | 15 m |
| `dirt` | [Dirt](https://polyhaven.com/a/dirt) | Charlotte Baglioni | 2 m |
| `rock_face` | [Rock Face](https://polyhaven.com/a/rock_face) | Dario Barresi (processing), Greg Zaal (photography) | 2.4 m |
| `asphalt_02` | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Rob Tuytel | 3 m |
| `forrest_ground_01` | [Forest Ground 01](https://polyhaven.com/a/forrest_ground_01) | Rob Tuytel | 2 m |
| `dry_ground_rocks` | [Dry Ground Rocks](https://polyhaven.com/a/dry_ground_rocks) | Rob Tuytel | 4 m |
| `sand_01` | [Sand 01](https://polyhaven.com/a/sand_01) | Rob Tuytel | 1.5 m |
| `snow_02` | [Snow 02](https://polyhaven.com/a/snow_02) | Rob Tuytel | 2 m |
| `gravel_road` | [Gravel Road](https://polyhaven.com/a/gravel_road) | Amal Kumar | 2 m |
| `rock_boulder_dry` | [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry) | Dimitrios Savva, Rico Cilliers | 1.8 m |
| `aerial_asphalt_01` | [Aerial Asphalt 01](https://polyhaven.com/a/aerial_asphalt_01) (diffuse only) | Rob Tuytel | 30 m |

Each set contains the 1024 × 1024 diffuse/albedo (`diff`), OpenGL tangent-space normal (`nor_gl`), roughness (`rough`) and displacement (`disp`) map (Aerial Asphalt 01: diffuse only). `tools/fetch-surfaces.mjs` downloads, verifies and recompresses them. The API file lists and source MD5 values were checked on 2026-09-28. Source download URLs, source checksums, bundled SHA-256 checksums and byte sizes are recorded in `manifest.json`.

The downloaded JPEGs were recompressed locally for the game (84 quality for diffuse/roughness, 90 for normals). No generated imagery replaces the photographic surface data. Albedo is read in sRGB; normal and roughness maps are read as linear data. The game uses metre-scaled texture projection, biome-dependent color grading and material blending. Displacement maps only steer how layers blend (stones and tufts show through at the edges); they never move geometry, so terrain positions, silhouettes, collision and driving behavior remain the existing heightfield.

The terrain packs ten sets into two texture arrays: Aerial Grass Rock (grass), Dirt (soil), Rock Face (triplanar cliffs), Asphalt 02 (paved pads), Forest Ground 01 (forest floor), Dry Ground Rocks (dry country), Sand 01 (beaches), Snow 02 (alpine tops), Gravel Road (verges, gravel traps) and Rock Boulder Dry (red canyon cliffs, graded to the strata colours). Gravel roads use Gravel Road; paved roads add Aerial Asphalt 01 as large-scale patching over Asphalt 02. Road and prop materials can share the same cached maps. All assets are served locally with the game; no runtime request to Poly Haven is needed.
