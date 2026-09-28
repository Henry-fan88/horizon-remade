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
