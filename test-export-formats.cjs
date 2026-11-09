// GeoJSON vectors, GLB/OBJ mesh, normal map and shareable-settings checks.
const assert = require('node:assert/strict'), { createApp } = require('./test-harness.cjs');
(async () => {
  const app = createApp(), { api } = app, world = await app.generate({ seed: 'formats-1', shape: 'rolling' });

  // GeoJSON
  const geo = api.buildGeoJson(world), kinds = {};
  for (const f of geo.features) kinds[f.properties.kind] = (kinds[f.properties.kind] || 0) + 1;
  assert.equal(geo.type, 'FeatureCollection'); assert.deepEqual(JSON.parse(JSON.stringify(geo)), geo, 'GeoJSON serialises losslessly');
  assert.equal(kinds.road, world.roads.length, 'one line per road');
  assert(kinds.river > 0 && kinds.poi === world.pois.length && kinds.lake === world.lakes.length, 'rivers, POIs and lakes are exported');
  const coords = f => f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const f of geo.features) for (const c of coords(f)) {
    assert(c.every(Number.isFinite), 'finite coordinates');
    assert(c[0] >= -1 && c[0] <= world.sizeM + 1 && c[1] >= -1 && c[1] <= world.sizeM + 1, 'inside the footprint: ' + f.properties.kind);
  }
  assert(geo.features.filter(f => f.geometry.type === 'LineString').every(f => f.geometry.coordinates.length >= 2), 'every line has at least two points (valid GeoJSON)');
  const river = geo.features.find(f => f.properties.kind === 'river');
  assert.equal(river.properties.widthM.length, river.geometry.coordinates.length, 'a width per river vertex');
  assert(river.properties.maxWidthM > 0);
  const bridges = geo.features.filter(f => f.properties.kind === 'structure');
  assert(bridges.length > 0 && bridges.every(f => f.geometry.coordinates.length > 1 && ['bridge', 'viaduct', 'tunnel', 'overpass'].includes(f.properties.type)), 'road structures become their own lines');

  // mesh
  const M = 65, mesh = api.buildTerrainMesh(world, M), count = M * M;
  assert.equal(mesh.positions.length, count * 3); assert.equal(mesh.indices.length, (M - 1) ** 2 * 6);
  assert(mesh.indices.every(i => i < count), 'indices in range');
  const P = mesh.positions; let maxX = 0, maxZ = 0;
  for (let k = 0; k < count; k++) { maxX = Math.max(maxX, P[3 * k]); maxZ = Math.max(maxZ, P[3 * k + 2]); }
  assert(Math.abs(maxX - world.sizeM) < 1e-3 && Math.abs(maxZ - world.sizeM) < 1e-3, 'mesh spans the footprint');
  for (let k = 0; k < count; k++) { const nx = mesh.normals[3 * k], ny = mesh.normals[3 * k + 1], nz = mesh.normals[3 * k + 2]; assert(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-4 && ny > 0, 'unit normals pointing up'); }
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map(o => mesh.indices[t + o] * 3), ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    assert(uz * vx - ux * vz > 0, 'triangles wind counter-clockwise seen from above');
  }
  const glb = api.encodeGlb(mesh), dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546C67, 'glTF magic'); assert.equal(dv.getUint32(8, true), glb.length, 'declared length matches'); assert.equal(glb.length % 4, 0);
  const jsonLen = dv.getUint32(12, true), gltf = JSON.parse(Buffer.from(glb.subarray(20, 20 + jsonLen)).toString('utf8'));
  assert.equal(gltf.accessors[0].count, count); assert.equal(gltf.accessors[2].count, mesh.indices.length);
  const binStart = 20 + jsonLen + 8; assert.equal(dv.getUint32(20 + jsonLen + 4, true), 0x004E4942, 'BIN chunk follows');
  assert.equal(dv.getFloat32(binStart + 4 * 3 * 7 + 4, true), P[3 * 7 + 1], 'vertex data is where the accessor says');
  assert(gltf.accessors[0].max[0] > gltf.accessors[0].min[0]);
  const obj = api.encodeObj(mesh).split('\n');
  assert.equal(obj.filter(l => l.startsWith('v ')).length, count); assert.equal(obj.filter(l => l.startsWith('vn ')).length, count); assert.equal(obj.filter(l => l.startsWith('f ')).length, (M - 1) ** 2 * 2);

  // normal map: flat ground faces straight up; ground rising to the east tilts the normal west (red below the midpoint)
  const N = 9, flat = api.normalMapPixels(new Float32Array(N * N), N, 80), ramp = api.normalMapPixels(Float32Array.from({ length: N * N }, (_, i) => (i % N) * 2), N, 80);
  assert(Math.abs(flat[4 * 40] - 127.5) < 1 && Math.abs(flat[4 * 40 + 1] - 127.5) < 1 && flat[4 * 40 + 2] > 254, 'flat normal');
  assert(ramp[4 * 40] < 120 && Math.abs(ramp[4 * 40 + 1] - 127.5) < 1, 'east-rising ramp leans west');

  // shareable settings
  const snap = api.settingsSnapshot(), hash = api.settingsToHash(snap);
  assert.deepEqual(api.settingsFromHash(hash), snap, 'a link round-trips every setting');
  assert.deepEqual(api.settingsFromHash('#seed=abc&evil=1&shape=twin'), { seed: 'abc', shape: 'twin' }, 'unknown parameters are ignored');
  app.set('seed', 'changed'); api.applySettings({ seed: 'abc', shape: 'twin', nope: 'x' });
  assert.equal(app.document.getElementById('seed').value, 'abc'); assert.equal(app.document.getElementById('shape').value, 'twin');
  console.log(`Export format checks passed: ${geo.features.length} GeoJSON features, ${bridges.length} structures, ${(mesh.indices.length / 3).toLocaleString()}-triangle mesh, GLB ${glb.length} bytes`);
})().catch(e => { console.error(e); process.exitCode = 1; });
