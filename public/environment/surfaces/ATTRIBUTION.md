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

Each set contains the 1024 × 1024 diffuse/albedo (`diff`), OpenGL tangent-space normal (`nor_gl`) and roughness (`rough`) map. The API file lists and source MD5 values were checked on 2026-09-28. Source download URLs, source checksums, bundled SHA-256 checksums and byte sizes are recorded in `manifest.json`.

The downloaded JPEGs were recompressed locally for the game (84 quality for diffuse/roughness, 90 for normals). No generated imagery replaces the photographic surface data. Albedo is read in sRGB; normal and roughness maps are read as linear data. The game uses metre-scaled texture projection, biome-dependent color grading and material blending. It does not use the assets' displacement maps, so terrain positions, silhouettes, collision and driving behavior remain the existing heightfield.

The terrain uses Aerial Grass Rock for textured ground cover, Dirt for exposed soil and fine coastal grains, Rock Face for triplanar cliff detail, and Asphalt 02 for paved pads. Road and prop materials can share the same cached maps. All assets are served locally with the game; no runtime request to Poly Haven is needed.
