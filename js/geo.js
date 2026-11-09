"use strict";

// ---------- GeoJSON export: roads, structures, rivers, streets, lakes and POIs as vector data ----------
// Coordinates are metres from the north-west corner (x east, y south, z elevation), the same frame as the world JSON.
// GIS tools can load the file as a local/engineering CRS; game tools can read the features directly.
function buildGeoJson(world) {
  const { cell, sizeM } = world, r1 = v => Math.round(v * 10) / 10;
  const pt = (x, y, z) => z == null ? [r1(x), r1(y)] : [r1(x), r1(y), r1(z)];
  const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties });
  const features = [], STRUCT = { 1: 'bridge', 2: 'viaduct', 3: 'tunnel', 6: 'overpass' };

  for (const r of world.roads) {
    features.push(feature({ type: 'LineString', coordinates: r.pts.map(([x, y], j) => pt(x * cell, y * cell, r.profile ? r.profile[j] : null)) },
      { kind: 'road', type: r.type, from: r.a, to: r.b, lengthM: Math.round(r.len) }));
    if (!r.deck) continue;
    for (let j = 0; j < r.deck.length; j++) if (STRUCT[r.deck[j]]) {
      let e = j; while (e < r.deck.length && r.deck[e] === r.deck[j]) e++;
      const a = Math.max(0, j - 1), b = Math.min(r.pts.length - 1, e), coordinates = r.pts.slice(a, b + 1).map(([x, y], k) => pt(x * cell, y * cell, r.profile ? r.profile[a + k] : null));
      if (coordinates.length > 1) features.push(feature({ type: 'LineString', coordinates }, { kind: 'structure', type: STRUCT[r.deck[j]], road: r.type, from: r.a, to: r.b }));
      j = e - 1;
    }
  }
  for (const rv of world.rivers) {
    const widths = rv.map(q => r1(world.riverW(q[2])));
    features.push(feature({ type: 'LineString', coordinates: rv.map(q => pt(clamp(q[0] * cell, 0, sizeM), clamp(q[1] * cell, 0, sizeM), q[3])) },   // meanders at an outlet can overshoot the edge by a few metres
      { kind: 'river', maxWidthM: Math.max(...widths), widthM: widths, leavesMap: !!rv.exitsMap }));       // z is the river bed elevation
  }
  for (const s of world.streets) features.push(feature({ type: 'LineString', coordinates: s.pts.map(([x, y]) => pt(x, y)) }, { kind: 'street', widthM: s.w, main: !!s.main, settlement: s.town }));
  for (const l of world.lakes) features.push(feature({ type: 'Point', coordinates: pt(l.x * cell, l.y * cell, l.level) }, { kind: 'lake', name: l.name, reservoir: !!l.reservoir, areaKm2: +l.area.toFixed(3), maxDepthM: +l.depth.toFixed(1) }));
  for (const p of world.pois) features.push(feature({ type: 'Point', coordinates: pt(p.x * cell, p.y * cell, p.h) },
    { kind: 'poi', type: p.start ? 'start_town' : p.type, name: p.name, id: p.id, zone: ['', 'early', 'mid', 'late'][p.zone] || null }));

  return {
    type: 'FeatureCollection',
    properties: { generator: 'Worldforge', seed: world.seed, sizeMeters: sizeM, note: 'Metres from the north-west corner: x east, y south, z elevation (river z = bed). Not geographic coordinates.' },
    features
  };
}
if (typeof $ === 'function') $('xGeo').onclick = () => { if (S) save(new Blob([JSON.stringify(buildGeoJson(S))], { type: 'application/geo+json' }), tag() + '.geojson'); };
