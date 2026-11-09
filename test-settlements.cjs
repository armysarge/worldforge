const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appCode = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)]
  .map(([, src]) => fs.readFileSync(path.join(__dirname, src), 'utf8')).join('\n');
const settings = {seed: 'desolation', scenario: 'sandbox', size: '505', fp: '16', shape: 'random', mtn: '1', lakes: '6', riv: '1', mode: 'terrain', xres: '0', compute: 'auto'};
const elements = new Map();
const createElement = () => ({style: {}, checked: false, addEventListener() {}, getContext() {}, querySelector() { return {}; }, querySelectorAll() { return []; }, replaceChildren() {}, append() {}});
const document = {
  createElement,
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, {...createElement(), value: settings[id] || ''});
    return elements.get(id);
  }
};
const code = appCode.replace(/\nstartApp\(\);\s*$/, '\nrender = () => {}; const generateWorld = async () => { await generate(); return {world:S, data:worldData()}; }; return generateWorld().then(result => ({...result, generateWorld, gradeSites, movePoi, storeZip, buildHeightTile, exportTerrainTiles}));');
const pointOn = ([x, y], pts) => pts.some(([ax, ay], i) => {
  if (i === 0) return Math.hypot(ax - x, ay - y) < .01;
  const [bx, by] = pts[i - 1], dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t) < .01;
});
(async () => {
  let adapterRequests = 0;
  const navigator = {gpu: {requestAdapter: async () => { adapterRequests++; return null; }}};
  const {world, data, generateWorld, gradeSites, movePoi, storeZip, buildHeightTile, exportTerrainTiles} = await new Function('document', 'addEventListener', 'navigator', code)(document, () => {}, navigator);
  assert.equal(adapterRequests, 1, 'Auto mode attempts WebGPU');
  assert.equal(world.terrainBackend, 'cpu', 'generation completes without a WebGPU adapter');
  assert.equal(data.terrainBackend, 'cpu', 'the world export records the backend used');
  const settlements = new Map(world.pois.filter(p => p.radius).map(p => [p.id, p]));
  const city = [...settlements.values()].find(p => p.type === 'city');
  assert(city && world.streets.filter(s => s.town === city.id).length >= 12, 'the default city can grow multiple blocks');
  const network = world.roads.map(r => r.pts.map(([x, y]) => [x * world.cell, y * world.cell]));
  for (const street of world.streets) {
    const town = settlements.get(street.town);
    assert(town, 'street references an exported settlement ID');
    const start = street.pts[0];
    const standaloneSpine = street.main && Math.hypot(start[0] - town.x * world.cell, start[1] - town.y * world.cell) < .01;
    assert(standaloneSpine || network.some(road => pointOn(start, road)), 'local street starts on an existing road');
    network.push(street.pts);
  }
  const footprints = world.buildings.filter(b => ['house', 'apartment', 'commercial', 'shop', 'civic'].includes(b.kind));
  assert(footprints.length > 100, 'street layout has room for buildings');
  for (const b of footprints) {
    const i = Math.round(b.y / world.cell) * world.n + Math.round(b.x / world.cell);
    assert(world.land[i] && !world.chanM[i], 'buildings stay off water and river channels');
  }
  const services = world.pois.filter(p => ['hospital', 'police', 'fire', 'school', 'tunnel'].includes(p.type));
  for (const p of services) {
    assert(p.access && network.some(road => pointOn([p.access.x, p.access.y], road)), 'civic site has a street frontage');
    assert(world.buildings.some(b => b.poiId === p.id && Math.hypot(b.x - p.x * world.cell, b.y - p.y * world.cell) < .01));
  }
  const hospitals = services.filter(p => p.type === 'hospital');
  assert(hospitals.length > 0);
  assert.equal(new Set(hospitals.map(p => p.parent)).size, hospitals.length);
  for (const p of hospitals) for (const q of hospitals) if (p !== q)
    assert(Math.hypot(p.x - q.x, p.y - q.y) * world.cell >= 1920);
  assert(data.metro.length && data.metro.every(line => line.points.every(pt => pt.length === 3 && Number.isFinite(pt[2]))));
  for (const link of data.metro) for (const next of data.metro.filter(other => other.from === link.to))
    assert.deepEqual(link.points.at(-1), next.points[0], 'adjacent tunnels meet at the same underground elevation');
  assert(data.roads.flatMap(r => r.structures).some(s => s.type === 'bridge' && s.deckPoints.length > 1));
  assert.equal(typeof movePoi(world, city, 100, 100), 'string');
  const n = 11, dry = new Uint8Array(n * n).fill(1), channel = new Uint8Array(n * n);
  const testWorld = {n, sizeM: 10, cell: 1, land: dry, chanM: channel, riv: new Uint8Array(n*n), rimL: new Float32Array(n*n).fill(-Infinity), roads: [], streets: [],
    buildings: [{x: 5, y: 5, w: 4, d: 4, z: 5, a: 0, kind: 'house'}]};
  channel[5 * n + 5] = 1;
  const graded = gradeSites(new Float32Array(n*n).fill(1), n, testWorld);
  assert.equal(graded[5 * n + 4], 5, 'the pad is flat');
  assert.equal(graded[5 * n + 5], 1, 'protected river channel is left alone');
  const archive = new DataView(await (await storeZip([['test.txt', new Blob(['123456789'])]])).arrayBuffer());
  assert.equal(archive.getUint32(0, true), 0x04034b50);
  assert.equal(archive.getUint32(14, true), 0xcbf43926);
  assert.equal(archive.getUint32(archive.byteLength - 22, true), 0x06054b50);
  console.log(`Settlement and export checks passed: ${world.streets.length} streets, ${services.length} roadside civic sites, ${data.metro.length} metro links, ${world.roadAccessReview.length} other access sites flagged`);

  const N = 65, water = new Uint8Array(n * n), sampleWorld = {
    ...testWorld, seed: 'tile-seam', h: new Float32Array(n*n).fill(2), urban: water, biome: water, slope: water, roadBedM: water,
    chanM: channel.slice().fill(1, 2 * n, 3 * n),
    rivers: [[[0, 2, 1, 0], [10, 2, 1, 0]]], riverW: () => 1, riverD: () => .4,
  };
  const nw = buildHeightTile(sampleWorld, 2, N, 0, 0), ne = buildHeightTile(sampleWorld, 2, N, 1, 0), sw = buildHeightTile(sampleWorld, 2, N, 0, 1);
  for (let i = 0; i < N; i++) {
    assert.equal(nw[i * N + N - 1], ne[i * N], 'east and west edge heights match');
    assert.equal(nw[(N - 1) * N + i], sw[i], 'north and south edge heights match');
  }
  assert.equal(ne[26 * N], 0, 'the exported river cuts across the seam');
  assert.equal(ne[64 * N + 12], 5, 'the building pad is flat across the seam');
  const open = buildHeightTile({...sampleWorld, mainland: true}, 2, N, 1, 0);
  assert.equal(open[26 * N + 64], 0, 'the mainland channel reaches the exported outermost vertex');

  const readArchive = async blob => {
    const bytes = Buffer.from(await blob.arrayBuffer()), files = new Map();
    for (let off = 0; bytes.readUInt32LE(off) === 0x04034b50;) {
      const start = off + 30 + bytes.readUInt16LE(off + 26), end = start + bytes.readUInt32LE(off + 18);
      files.set(bytes.toString('utf8', off + 30, start), bytes.subarray(start, end)); off = end;
    }
    return files;
  };
  let bundle;
  const capture = blob => { bundle = blob; };
  const ue = {engine: 'unreal', count: 2, N: 1009, x: 1, y: 0};
  await exportTerrainTiles(world, ue, true, capture);
  const all = await readArchive(bundle), manifest = JSON.parse(all.get('tiles.json'));
  assert.equal(all.size, 5);
  assert.equal(manifest.fullResolution, 2017);
  assert.equal(manifest.sampleSpacingMeters, 16000 / 2016);
  assert.equal(manifest.unreal.scale[0], manifest.sampleSpacingMeters * 100);
  assert.equal(all.get('height_x1_y0.r16').length, 1009 * 1009 * 2);
  const west = all.get('height_x0_y0.r16'), east = all.get('height_x1_y0.r16'), south = all.get('height_x0_y1.r16');
  for (let i = 0; i < 1009; i++) {
    assert.equal(west.readUInt16LE((i * 1009 + 1008) * 2), east.readUInt16LE(i * 1009 * 2));
    assert.equal(west.readUInt16LE((1008 * 1009 + i) * 2), south.readUInt16LE(i * 2));
  }
  await exportTerrainTiles(world, ue, false, capture);
  const single = await readArchive(bundle);
  assert.deepEqual(single.get('height_x1_y0.r16'), east, 'selected and full-grid exports are identical');
  assert.deepEqual(JSON.parse(single.get('tiles.json')).tiles, [manifest.tiles[1]]);
  await exportTerrainTiles(world, {...ue, engine: 'unity', N: 1025}, false, capture);
  const unity = await readArchive(bundle);
  assert.equal(unity.get('Assets/Worldforge/Tiles/height_x1_y0.bytes').length, 1025 * 1025 * 2);
  assert(unity.get('Assets/Worldforge/Editor/WorldforgeTerrainImporter.cs').includes('SetNeighbors'));
  console.log('Tiled exports passed: shared borders, river and foundation continuity, Unreal bundle and Unity payload');

  const set = (id, value) => { document.getElementById(id).value = value; };
  set('compute', 'cpu');
  for (const shape of ['rolling', 'mountainous', 'plateaus', 'coastal']) {
    set('shape', shape);
    const {world: terrain, data: exported} = await generateWorld(), {n} = terrain;
    assert.equal(exported.shape, shape);
    const edges = Array.from({length: n}, (_, i) => [i, i * n, i * n + n - 1, (n - 1) * n + i]).flat();
    assert(edges.some(i => terrain.land[i]), `${shape} continues to the boundary`);
    assert.equal(terrain.ocean.some(Boolean), shape === 'coastal', 'only coastal terrain borders an ocean');
    assert.equal(terrain.reality.badEnd, 0);
    assert.equal(terrain.reality.undrained, 0);
    assert(terrain.roads.length && terrain.buildings.length && terrain.pois.some(p => p.type === 'city'));
    const outlets = terrain.rivers.filter(p => p.exitsMap);
    if (shape !== 'coastal') assert(outlets.length > 0);
    for (const p of outlets) {
      const [x, y] = p.at(-1);
      assert(x === 0 || x === n - 1 || y === 0 || y === n - 1);
    }
    assert.equal(exported.riverOutlets.length, outlets.length);
    console.log(`${shape}: ${terrain.stats.landKm2.toFixed(1)} km² land, ${outlets.length} river outlets, ${terrain.roads.length} roads`);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
