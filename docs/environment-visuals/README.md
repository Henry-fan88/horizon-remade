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

## Snow update — 2026-10-01

- Snow conifers now have three seeded silhouettes, bent woody limbs, green needle
  sprays underneath, and rounded, uneven snow caps above each bough. The distant
  LOD retains the same branch skeleton with fewer than 2,200 triangles per tree.
- The local snow PBR scan now blends fine granular normals, filtered grain detail,
  wind-packed relief, and powder/compaction roughness. This changes shading only;
  the original terrain vertices, heightfield and road profiles remain unchanged.
- Upper **Paso Nevado** gains visible packed snow and four compressed wheel paths.
  Cover transitions from 145–185 m elevation; above its 165 m midpoint, the same
  road is classified as snow by the wheel-contact query. Lower roads stay dry.
- Snow tyre grip is tuned independently from dirt: a 0.34 surface multiplier, at
  most a 0.05 tread bonus, gentler lateral force buildup, less longitudinal grip,
  and greater force loss during wheelspin or locked braking. Stability control
  respects the available contact grip; ABS and traction control remain usable.
  These values are game tuning, not measured real-world tyre coefficients.
- Tyres throw white powder and small snow chunks, and leave soft blue tread
  impressions. Chunks settle on the ground; tracks follow the terrain and road
  ribbon, break at contact/teleport gaps, and fade. Fixed pools limit chunks to
  2,400 and tread segments to 3,600. Snow cover also lowers opponents' speed
  profiles and extends their braking approach. Respawns refresh tyre surfaces.
- The development tour adds **Snow detail** and **Snow forest**. With `&capture`,
  **Snow launch**, **Snow slide**, and **Snow braking** simulate real wheel contacts
  and freeze their effects for inspection. **Drive here** restores free roam.

Validation: production build and 28 automated checks passed, including snow
braking/turning/launches, all player cars on mixed snow/asphalt, surface changes on
respawn, AI approach speeds, effect pool limits, snowy pine LODs, and existing
environment/desert regressions. At 80 km/h on flat ground the Ferrari stopped in
18.7 m on asphalt, 67.2 m on snow with ABS, and 94.9 m with locked wheels. Six
asphalt acceleration/braking/steering runs matched the pre-update body-state
snapshots exactly. `worldgen.js` and `heightfield.js` retain their original hashes.

Live WebGL checks covered launch, braking and sliding on the generated mountain
road, conifers at daylight/golden hour/night, and restoration of normal driving.
The 2.4-second slide recorded 576 snow tyre contacts, about 2,059 chunks, and 572
tread segments. Emission counts vary with randomness. The clean final browser
session had no warnings or errors.

Screenshots: [snow area](snow-area.jpg) and [snow tire reaction](snow-tire-reaction.jpg).

## San Francisco city update — 2026-10-07

The city was rebuilt around the real neighbourhood structure on either side of Market Street:

- **Blocks:** zero-lot-line street walls (median gap between residential neighbours: 4 cm),
  built-up commercial block interiors, and planted back yards in the residential blocks. Block
  interiors are found by flood-filling a road raster from the city edge, so nothing is built
  outside the street grid. Clearance tests use a 1 m road-edge distance field.
- **Buildings:** twelve building types (Victorian, Edwardian, apartment, mid-century, Chinatown,
  commercial, Art Deco, glass, slab, loft, modern, waterfront shop). Facades are procedural
  shaders on instanced boxes: window grids fitted to each wall, recessed reveals, sills, blinds
  and curtains, gravel/membrane roofs and per-window night lighting. Instance colours give every
  Painted Lady its own body/trim/accent scheme without extra materials.
- **Landmarks:** Transamerica Pyramid, Salesforce Tower, 555 California, Coit Tower, the Ferry
  Building with its clock tower, four Embarcadero piers, Union Square and the Dragon Gate.
- **Streets:** Path of Gold lamps, red transit lanes and brick sidewalks on Market; Muni trolley
  wires; cable car tracks on Powell and California; Lombard's brick switchbacks and hydrangeas;
  palms, London planes, ficus and Monterey cypress; painted curbs, hydrants, all-way stops,
  street-name signs, bus shelters and utility poles. The island highway is dressed as a
  boulevard where it crosses the city.

Validation: 63 automated checks passed (including a new test for street walls, landmarks and
yards) and the production build succeeded. A scripted probe found no building, pole or parked
car intruding on any carriageway, and the AI drove the City by the Bay Circuit without impacts.
The city builds in about 0.33 s. In headless Chrome on the M5 Max, city views use 560–1,450
draw calls per frame (the old city used 710–1,580), 1.4–4.0 M triangles and 2.7–4.2 ms CPU.

Screenshots: [aerial](sf-aerial.jpg), [Victorian row](sf-painted.jpg), [Market Street](sf-market.jpg),
[Lombard Street](sf-lombard.jpg), [Ferry Building](sf-ferry.jpg), [Transamerica](sf-transamerica.jpg),
[Chinatown](sf-chinatown.jpg), [back yards from above](sf-yards-top.jpg), [night](sf-night-aerial.jpg).
