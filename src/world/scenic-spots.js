// Curated views, anchored to drivable roads so GPS and fast travel agree with
// the camera icons on both maps. These are destinations, not timed events.
const SCENIC_SPOTS = [
  {
    id: 'photo-volcano', name: 'Volcán Panorama', road: 'Volcán Spiral', fraction: .97,
    description: 'A high panorama over the city, countryside and southern coastline.',
    tip: 'Look southeast from the outside of the mountain bend.',
  },
  {
    id: 'photo-snow', name: 'Nevado Pass', road: 'Paso Nevado', fraction: .84,
    description: 'Snow-covered pines, mountain peaks and a winding alpine road.',
    tip: 'Look east along the pass toward the snowy ridgeline.',
  },
  {
    id: 'photo-canyon', name: 'Red Canyon', road: 'Cañón Rojo Rally', fraction: .12,
    description: 'Towering layers of red sandstone frame the canyon trail.',
    tip: 'Look north between the canyon walls. Golden hour lights up the rock.',
  },
  {
    id: 'photo-dunes', name: 'Golden Dunes', road: 'Dunas Trail', fraction: .64,
    description: 'Rippling sand, cactus silhouettes and a distant smoking volcano.',
    tip: 'Look east across the dunes for the widest view.',
  },
  {
    id: 'photo-lake', name: 'Lago & Volcán', road: 'Granja Road', fraction: .39,
    description: 'A quiet lake and patchwork farmland beneath the volcano.',
    tip: 'Look north across the fields and water toward the summit.',
  },
  {
    id: 'photo-bridge', name: 'Suspension Bridge', road: 'Puente Este', fraction: .12,
    description: 'Red towers and sweeping suspension cables above the eastern lowlands.',
    tip: 'Look east along the bridge to line up its towers.',
  },
  {
    id: 'photo-lombard', name: 'Lombard Curves', road: 'Lombard Street', fraction: .28,
    description: 'Tight hillside bends lined with pastel city homes.',
    tip: 'Look east across the switchbacks and terraced neighborhood.',
  },
  {
    id: 'photo-lighthouse', name: 'Lighthouse Bay', road: 'Costa Ring', fraction: .8812,
    description: 'A red-and-white lighthouse overlooking the bay and distant snowy mountains.',
    tip: 'Look northeast from the coast road toward the lighthouse.',
  },
];

export function buildScenicSpots(network) {
  return SCENIC_SPOTS.flatMap((spot) => {
    const road = network.roads.find((r) => r.name === spot.road);
    if (!road) return [];
    const p = road.pointAt(road.length * spot.fraction, {});
    return [{ ...spot, kind: 'scenic', type: 'camera', big: true,
      x: p.x, y: p.y, z: p.z, heading: Math.atan2(p.tx, p.tz) }];
  });
}
