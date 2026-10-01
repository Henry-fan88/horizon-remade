# Environment visual update — 2026-09-28

The development tour is available at `http://127.0.0.1:5173/?environment&car=gt&view=Town`.
It renders the actual game world. The scene buttons, orbit controls and time selector
are development-only; **Drive here** returns to normal gameplay without changing saved
progression or vehicle tuning.

## Delivered

- Four local photographic surface sets: ground cover, soil, rock and asphalt. The
  12 maps total 6,273,855 bytes; credits, licenses and checksums live in
  `public/environment/surfaces/`. Terrain blends use the existing biome/surface IDs.
- Metre-scaled road normals and roughness, aggregate detail, and feathered gravel shoulders.
- Branched tree models, textured bark, layered foliage, alpha-preserving mipmaps,
  fuller palms and intersecting pine boughs. Grass blades use individual ground samples.
- Fabric tents with frames/seams/counters, stage trusses and speaker drivers,
  framed Ferris cabins, town windows/doors/shutters, tiled roofs, downpipes, balconies,
  shop awnings, segmented sidewalks and kerbs; added hangar and roadside construction detail.
- More restrained color grading and bloom, neutral cloud lighting, and subtler water color/glints.

## Verification

- `npm run build` passed after the final geometry change.
- All 12 shipped texture files match their manifest SHA-256 and byte counts.
- Live WebGL inspection covered festival, town, countryside, coast and highlands;
  daylight, golden hour and night were checked. No new browser warnings or errors
  appeared after the clean validation reload and final foliage update.
- **Drive here** restored the car, HUD and normal game camera. Screenshots are saved here.
- `vehiclephysics.js`, `worldgen.js` and `heightfield.js` matched the pre-update SHA-256
  snapshots. Terrain positions, topology and LOD logic remain unchanged.
- Vegetation collider/smashable definitions and original grass anchors were preserved.
  Generated-town validation found 82 unchanged colliders and no road intrusion among
  the 2,646 new sidewalk/kerb pieces (minimum carriageway clearance about 0.50 m).

This is a visual/material and dressing update to the existing procedural island.
It does not replace the island's terrain geometry or driving simulation.

## Desert update — 2026-10-01

- Loose sand now uses metre-scaled, derivative-filtered wind ripples and fine grain
  detail; the original sand scan's compacted clumps are reduced. Relief changes
  shading only, preserving the terrain geometry and driving surface.
- Each grounded sand tire throws individual grains and dust according to speed,
  steering, slip and wheelspin. Grains fall, bounce and settle on the rendered
  dune surface. Paved or airborne tires do not emit sand.
- Sand tires leave feathered impressions with tread detail and small raised edges.
  Marks follow the terrain, break at contact/surface gaps and teleports, and fade
  after 55–95 seconds. Fixed pools cap grains at 6,000 and tread segments at 3,600.
- Cacti have three seeded silhouettes, swept curved arms, ribbed/tapered stems,
  rounded tips, textured skin, basal weathering and close-up spine clusters.
  Distant LODs retain the silhouette and skin while omitting modelled spines.
- The development environment tour adds **Sand detail** and **Cactus detail**.
  With `&capture`, acceleration/slide/reverse checks step the real physics and
  freeze the resulting visual effects. **Drive here** restores normal gameplay.

Validation: production build and 15 automated checks passed (six sand/cactus
regressions and nine existing environment checks). Live WebGL checks covered
acceleration, steering/slip, reverse, cactus detail, daylight/golden-hour/night,
and return to free roam. The four-second slide check emitted 3,828 grains and
created 599 tread segments; emission counts vary slightly with randomness.
No warnings/errors appeared in the clean final browser session. SHA-256 checks
confirmed `vehiclephysics.js`, `worldgen.js` and `heightfield.js` unchanged.

Screenshots: [sand tire reaction](desert-sand-reaction.jpg) and
[rebuilt cacti](desert-cacti.jpg).
