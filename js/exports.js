"use strict";

// ---------- export ----------
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
const tag = (N = S.n) => `${S.mainland ? S.shape : 'island'}_${S.seed}_${S.sizeM / 1000}km_${N}`;
const norm = v => clamp((v - S.hmin) / (S.hmax - S.hmin) * 65535, 0, 65535);
function normH(h) { const o = new Uint16Array(h.length); for (let i = 0; i < h.length; i++) o[i] = norm(h[i]); return o; }
const expN = () => +$('xres').value || S.n;
// 0..1 per grid cell: how strongly added relief is suppressed. 1 on water, roads, river channels, streets and around
// buildings, easing to 0 over about two cells, so built ground stays smooth without a hard edge where the relief starts.
function calmField(world) {
  if (world.calm) return world.calm;
  const { n, cell, land, urban, riv, roadBedM, chanM } = world, m = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) if (!land[i] || urban[i] || riv[i] || roadBedM[i] || chanM[i]) m[i] = 1;
  const dot = (xm, ym, rm) => {
    for (let y = Math.max(0, Math.floor((ym - rm) / cell)); y <= Math.min(n - 1, Math.ceil((ym + rm) / cell)); y++)
      for (let x = Math.max(0, Math.floor((xm - rm) / cell)); x <= Math.min(n - 1, Math.ceil((xm + rm) / cell)); x++) m[y * n + x] = 1;
  };
  for (const b of world.buildings) dot(b.x, b.y, Math.hypot(b.w, b.d) / 2 + 8);
  for (const st of world.streets) for (const [x, y] of st.pts) dot(x, y, st.w / 2 + 4);
  for (const r of world.roads) if (r.type !== 'trail') for (const c of r.path) m[c] = 1;
  return world.calm = blur(blur(m, n, 1), n, 1);
}
// added relief per biome (index = biome id): worked fields and beaches stay smooth, rock gets the most
const DETAIL_GAIN = [0, .3, .7, .9, 1.6, 1.6, 1.6, .35, 0, .2];
// the ground the export upsamples: the grid as it was before the river carve (grid height + carve depth). The channel is
// cut again from the river polylines at export resolution, which gives smooth banks instead of magnified grid steps.
function exportSource(world, N, quads = N - 1) {
  if (!world.carveD || (world.n - 1) / quads >= 1) return world.h;
  const h = world.h.slice(), cd = world.carveD; for (let i = 0; i < h.length; i++) h[i] += cd[i];
  return h;
}
// CPU: Catmull-Rom upsample of the grid plus fine slope-aware detail (the WebGPU version is upsampleDetailGPU)
function upsampleDetailCPU(world, N, ox, oy, quads, h, calm) {
  const { n, land, biome, slope } = world, f = (n - 1) / quads, cellH = world.sizeM / quads;
  const cr = (p0, p1, p2, p3, t) => p1 + .5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const firstRow = Math.max(0, Math.floor(oy * f) - 1), lastRow = Math.min(n - 1, Math.floor((oy + N - 1) * f) + 2);
  const tmp = new Float32Array((lastRow - firstRow + 1) * N), H = new Float32Array(N * N);
  for (let X = 0; X < N; X++) {
    const g = (ox + X) * f, i = Math.min(n - 2, Math.floor(g)), t = g - i, a = Math.max(0, i - 1), d = Math.min(n - 1, i + 2);
    for (let y = firstRow; y <= lastRow; y++) { const r = y * n; tmp[(y - firstRow) * N + X] = cr(h[r + a], h[r + i], h[r + i + 1], h[r + d], t); }
  }
  for (let Y = 0; Y < N; Y++) {
    const g = (oy + Y) * f, j = Math.min(n - 2, Math.floor(g)), t = g - j;
    const a = (Math.max(0, j - 1) - firstRow) * N, b = (j - firstRow) * N, d = (Math.min(n - 1, j + 2) - firstRow) * N;
    for (let X = 0; X < N; X++) H[Y * N + X] = cr(tmp[a + X], tmp[b + X], tmp[b + N + X], tmp[d + X], t);
  }
  const nz = mkNoise(mulberry(hashSeed(world.seed) ^ 0x9e3779b9));
  const tiled = quads > N - 1;
  for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++) {
    const gyf = (oy + Y) * f, gxf = (ox + X) * f, gi = Math.round(gyf) * n + Math.round(gxf); if (!land[gi]) continue;
    const o = Y * N + X, base = H[o]; if (base <= .3) continue;
    const cx = Math.min(n - 2, gxf | 0), cy = Math.min(n - 2, gyf | 0), tx = gxf - cx, ty = gyf - cy, ci = cy * n + cx;
    const quiet = lerp(lerp(calm[ci], calm[ci + 1], tx), lerp(calm[ci + n], calm[ci + n + 1], tx), ty), keep = 1 - sstep(.02, .45, quiet);
    if (keep <= 0) continue;
    const b = biome[gi], rock = b >= 4 && b <= 6, tan = Math.min(Math.tan(slope[gi] / 57.2958), 1.2);
    const amp = Math.min(40, cellH * (.3 + 2 * tan) * DETAIL_GAIN[b]) * sstep(0, 3, base) * keep;
    const x = (ox + X) / 24, y = (oy + Y) / 24;
    let v = tiled ? fbm(nz, .8 * x - .6 * y, .6 * x + .8 * y, 4) : fbm(nz, x, y, 4);
    if (rock) v = .5 - Math.abs(v) * 1.5;
    H[o] = Math.max(.3, base + v * amp);
  }
  return H;
}
// rivers re-cut at window resolution
function carveWindow(world, H, N, ox, oy, quads) {
  const { n } = world, f = (n - 1) / quads, cellH = world.sizeM / quads;
  carveRivers(H, N, cellH, world.rivers, 1 / f, world.riverW, world.riverD,
    I => world.rimL[Math.round((oy + (I / N | 0)) * f) * n + Math.round((ox + I % N) * f)], null, { ox, oy, quads, openEdge: world.mainland });
  return H;
}
// export-resolution heightmap window (CPU). ox, oy, quads place the window inside a larger tiled export.
function buildHeightWindow(world, N, ox = 0, oy = 0, quads = N - 1) {
  return carveWindow(world, upsampleDetailCPU(world, N, ox, oy, quads, exportSource(world, N, quads), calmField(world)), N, ox, oy, quads);
}
// the same window with the per-sample work on WebGPU when Terrain compute is Auto and a GPU is available
async function buildHeightWindowFast(world, N, ox = 0, oy = 0, quads = N - 1) {
  const source = exportSource(world, N, quads), calm = calmField(world);
  const gpu = $('compute').value === 'auto' && typeof upsampleDetailGPU === 'function' ? await upsampleDetailGPU(world, N, ox, oy, quads, source, calm) : null;
  world.exportBackend = gpu ? 'webgpu' : 'cpu';
  return carveWindow(world, gpu ?? upsampleDetailCPU(world, N, ox, oy, quads, source, calm), N, ox, oy, quads);
}
async function buildHeightTile(world, count, N, x, y) {
  const q = N - 1, ox = x * q, oy = y * q, quads = count * q;
  // shortcut: use shared base drainage until a whole-world tiled flood can reconcile outlets across seams.
  return gradeSites(await buildHeightWindowFast(world, N, ox, oy, quads), N, world, ox, oy, quads);
}
async function exportH(N, world = S) {
  if (world.hcache[N]) return world.hcache[N];
  if (N === world.n) {
    const graded = gradeSites(world.h.slice(), N, world);
    world.hcache = { [N]: graded };
    return graded;
  }
  $('status').textContent = `Building ${N}×${N} heightmap…`; await new Promise(r => setTimeout(r, 30));
  const t0 = performance.now(), { n } = world, f = (n - 1) / (N - 1), H = await buildHeightWindowFast(world, N);
  // reality rule at export resolution too: the added detail must not leave dips that would hold water. Lean priority-flood
  // fill in place (no extra full-size arrays): land is raised to its spill level; sea and lake beds are never touched.
  const gIdx = I => Math.round((I / N | 0) * f) * n + Math.round((I % N) * f), wet = I => { const g = gIdx(I); return world.ocean[g] || world.lakeId[g]; };
  let filled = 0;
  {
    const seen = new Uint8Array(N * N), q = heap(1 << 20);
    for (let I = 0; I < N * N; I++) { const x = I % N, y = I / N | 0; if (x === 0 || y === 0 || x === N - 1 || y === N - 1) { seen[I] = 1; q.push(H[I], I); } }
    while (q.size) {
      const c = q.pop(), L = q.key, cx = c % N, cy = c / N | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx; if (seen[ni]) continue; seen[ni] = 1;
        let lv = H[ni]; if (lv < L) { if (!wet(ni)) { H[ni] = L; filled++; } lv = L; }
        q.push(lv, ni);
      }
    }
  }
  gradeSites(H, N, world);
  world.hcache = { [N]: H };                     // ponytail: keeps only the latest size (65 MB at 4033)
  $('status').textContent = `${N}×${N} heightmap graded in ${((performance.now() - t0) / 1000).toFixed(1)} s (detail pass: ${world.exportBackend === 'webgpu' ? 'WebGPU' : 'CPU'}) · ${filled} detail dips filled before grading`;
  world.hiresFilled = filled;
  return H;
}
// nearest-sample a grid field to N×N (for masks at export size)
function sampleGrid(N, fn) { const n = S.n, f = (n - 1) / (N - 1), o = new Float32Array(N * N); for (let Y = 0; Y < N; Y++) { const r = Math.round(Y * f) * n; for (let X = 0; X < N; X++) o[Y * N + X] = fn(r + Math.round(X * f)); } return o; }
function grayPng(n, val, name) {
  const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'), img = x.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = val(i); img.data[4 * i + 3] = 255; }
  x.putImageData(img, 0, 0); return new Promise(r => c.toBlob(b => { save(b, name); r(); }));
}
$('xR16').onclick = async () => { if (!S) return; const N = expN(); save(new Blob([normH(await exportH(N))]), tag(N) + '.r16'); };   // uint16 little-endian, Unreal-ready
$('xPng').onclick = async () => { if (!S) return; const N = expN(), v = normH(await exportH(N)); await grayPng(N, i => v[i] >> 8, tag(N) + '_height8.png'); };
function encodeHeightLE(heights, world) {
  const range = world.hmax - world.hmin, bytes = new DataView(new ArrayBuffer(heights.length * 2));
  for (let i = 0; i < heights.length; i++) {
    const normalized = clamp((heights[i] - world.hmin) / range, 0, 1);
    bytes.setUint16(i * 2, Math.round(normalized * 65535), true);
  }
  return bytes;
}
async function exportEngineHeight(engine, emit = save) {
  const world = S;
  if (!world) return;
  const selected = expN(), N = engine === 'unity' ? [513, 1025, 2049, 4097].reduce((a, b) => Math.abs(b - selected) < Math.abs(a - selected) ? b : a) : selected;
  const name = `${tag(N)}_${engine}`, range = world.hmax - world.hmin;
  const bytes = encodeHeightLE(await exportH(N, world), world);
  const metadata = {
    engine, seed: world.seed, scenario: world.scenario, shape: world.shape, terrainSettings: world.terrainSettings, width: N, height: N, format: 'unsigned 16-bit little-endian RAW, row-major',
    footprintMeters: world.sizeM, sampleSpacingMeters: world.sizeM / (N - 1), heightMinMeters: world.hmin, heightMaxMeters: world.hmax,
    verticalRangeMeters: range, seaLevelMeters: 0,
    orientation: 'Rows run from the map north edge toward south; columns run west to east. Verify vertical flipping on import.',
    heightFormula: 'height in metres = heightMinMeters + rawValue / 65535 * verticalRangeMeters'
  };
  emit(new Blob([bytes], { type: 'application/octet-stream' }), name + '.raw');
  emit(new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), name + '.json');
  $('status').textContent = `${engine === 'unity' ? 'Unity' : 'Godot'} height data exported at ${N}×${N}`;
  return N;
}
$('xUnity').onclick = () => exportEngineHeight('unity').catch(e => { $('status').textContent = 'Export error: ' + e.message; console.error(e); });
$('xGodot').onclick = () => exportEngineHeight('godot').catch(e => { $('status').textContent = 'Export error: ' + e.message; console.error(e); });
const LAYER_NAMES = ['Sand', 'Grass', 'Farmland', 'Forest', 'Rock', 'Snow', 'Wetland', 'Urban'];
function layerFields(world) {
  const { n, land, biome, slope, moist, riv, urban } = world;
  const fields = LAYER_NAMES.map(() => new Uint8Array(n * n)), weights = new Float32Array(fields.length);
  for (let i = 0; i < n * n; i++) {
    if (!land[i]) continue;
    const b = biome[i], angle = slope[i], wet = moist[i], steep = sstep(10, 35, angle), river = riv[i] >= 2;
    weights[0] = (b === 1 ? 1 : river ? .48 : 0) * (1 - steep * .65);
    weights[1] = (b === 2 ? 1 : b === 3 || b === 4 ? .14 : b === 9 ? .12 : .025) * (1 - steep * .8);
    weights[2] = b === 9 ? .85 * (1 - sstep(5, 18, angle)) : 0;
    weights[3] = (b === 3 ? .72 + wet * .48 : b === 2 ? sstep(.62, .95, wet) * .25 : 0) * (1 - steep);
    weights[4] = (b === 5 ? 1 : b === 4 || b === 6 ? .32 : .04) + steep * 1.4;
    weights[5] = b === 6 ? 1.4 * (1 - steep * .72) : 0;
    weights[6] = (b === 7 ? 1 : river ? .55 : sstep(.68, .95, wet) * .26) * (1 - steep);
    weights[7] = urban[i] ? (urban[i] === 2 ? 3.7 : 2.4) * (1 - steep) : 0;
    let total = 0;
    for (const w of weights) total += w;
    let cumulative = 0, previous = 0;
    for (let j = 0; j < fields.length; j++) {
      cumulative += weights[j];
      const next = Math.round(cumulative / total * 255);
      fields[j][i] = next - previous; previous = next;
    }
  }
  return fields;
}
async function exportLayers(N, world, emit) {
  const { n, land } = world, f = (n - 1) / (N - 1), fields = layerFields(world);
  const c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N), d = img.data;
  for (const [j, field] of fields.entries()) {
    const name = LAYER_NAMES[j]; $('status').textContent = 'Exporting layer ' + name + '…'; await new Promise(resolve => setTimeout(resolve, 20));
    for (let Y = 0; Y < N; Y++) {
      const gy = Y * f, y = Math.min(n - 2, Math.floor(gy)), ty = sstep(0, 1, gy - y);
      for (let X = 0; X < N; X++) {
        const gx = X * f, x = Math.min(n - 2, Math.floor(gx)), tx = sstep(0, 1, gx - x), i = y * n + x;
        const area = lerp(lerp(land[i], land[i + 1], tx), lerp(land[i + n], land[i + n + 1], tx), ty);
        const weight = lerp(lerp(field[i], field[i + 1], tx), lerp(field[i + n], field[i + n + 1], tx), ty);
        const v = area ? Math.round(weight / area) : 0, o = 4 * (Y * N + X);
        d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(resolve => c.toBlob(resolve));
    if (!blob) throw Error('PNG encoding failed at this export size.');
    emit(blob, name);
  }
}
$('xLayers').onclick = async () => {
  if (!S) return;
  const N = expN(), name = tag(N);
  await exportLayers(N, S, (blob, layer) => save(blob, name + '_layer_' + layer + '.png'));
  $('status').textContent = 'Layers exported';
};
$('xWater').onclick = () => {
  if (!S) return; const N = expN(), m = sampleGrid(N, i => S.lakeId[i] || S.ocean[i] ? 1 : 0), c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'), img = x.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = m[i] * 255; img.data[4 * i + 3] = 255; }
  x.putImageData(img, 0, 0); drawRivers(x, (N - 1) / (S.n - 1), '#fff', 1); c.toBlob(b => save(b, tag(N) + '_water.png'));
};
$('xSlice').onclick = async () => {   // vertical-slice crop at the export size, same height range as the full map
  if (!S || !S.slice) return; const N = expN(), h = await exportH(N), cell = S.sizeM / (N - 1), sf = (N - 1) / (S.n - 1), half = Math.round(S.slice.size / 2 / cell), s = 2 * half + 1;
  const x0 = clamp(Math.round(S.slice.cx * sf) - half, 0, N - s), y0 = clamp(Math.round(S.slice.cy * sf) - half, 0, N - s), o = new Uint16Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) o[y * s + x] = norm(h[(y0 + y) * N + x0 + x]);
  save(new Blob([o]), `${tag(N)}_slice_${s}x${s}_at_${Math.round(x0 * cell)}_${Math.round(y0 * cell)}.r16`);
};
$('xEco').onclick = () => {
  if (!S) return; const { gw, eTer, eInf, eStage, eSeed } = S.eco, pick = a => Array.from(eTer, i => a[i]);
  save(new Blob([JSON.stringify({
    cellM: ECO_CELL, width: gw, height: gw, origin: 'NW corner, row-major',
    stages: STAGE_NAME, biomes: BN, regions: REGION_NAME, resistanceByBiome: RESIST,
    fields: {
      biome: pick(S.biome), region: pick(S.region), moisture: Array.from(eTer, i => Math.round(S.moist[i] * 100)),
      tempC: Array.from(eTer, i => +(18 - Math.max(0, S.h[i]) * .0065).toFixed(1)),
      resistance: Array.from(eTer, i => RESIST[S.biome[i]]), infestation: Array.from(eInf), stage: Array.from(eStage), seedStrength: Array.from(eSeed),
      // starting resource stock per cell (0..100) for depletion / regrowth simulation
      wood: Array.from(eTer, i => Math.round(Math.min(255, S.res.softwood[i] + S.res.hardwood[i]) / 2.55)), stone: Array.from(eTer, i => Math.round(S.res.stone[i] / 2.55)),
      ore: Array.from(eTer, i => Math.round(Math.max(...ORE_KEYS.map(k => S.res[k][i])) / 2.55)), forage: Array.from(eTer, i => Math.round(S.res.forage[i] / 2.55)),
      game: Array.from(eTer, i => Math.round(S.res.game[i] / 2.55)), fish: Array.from(eTer, i => Math.round(S.res.fish[i] / 2.55))
    }
  })], { type: 'application/json' }), tag() + '_ecology.json');
};
// ---------- Unreal / PCG helpers ----------
// Every exported coordinate (POIs, roads, CSV, masks) has the map's north-west corner at world X = 0, Y = 0, and these
// scales make world Z (cm) = terrain height (m) × 100, so sea level is Z = 0.
// Unreal's New Landscape panel places a landscape by its CENTRE: the Location typed there must be half the footprint
// (location). After the import the Landscape actor itself sits at the north-west corner (actorLocation).
function ueSetup() {
  const N = expN(), q = S.sizeM * 100 / (N - 1), cfg = { 505: [63, 1, 8], 1009: [63, 2, 8], 2017: [63, 2, 16], 4033: [63, 2, 32], 8129: [127, 2, 32] }[N] || [63, 1, (N - 1) / 63];
  const z = Math.round((S.hmin + S.hmax) / 2 * 100), half = Math.round(S.sizeM * 50);
  return { landscapeSize: N, location: [half, half, z], actorLocation: [0, 0, z], scale: [+q.toFixed(4), +q.toFixed(4), +((S.hmax - S.hmin) * 100 / 512).toFixed(4)],
    quadsPerSection: cfg[0], sectionsPerComponent: `${cfg[1]}x${cfg[1]}`, components: `${cfg[2]}x${cfg[2]}`, flipYAxis: false,
    note: 'Unreal X = metres east ×100, Y = metres south ×100 (image rows), Z = height ×100. Sea level Z = 0.',
    importSteps: [
      `Landscape mode > Manage > New > Import from File: pick the .r16 (${N} x ${N}).`,
      `Location ${half}, ${half}, ${z}. The panel places the landscape by its centre; this puts the north-west corner at 0, 0 so POIs, roads and masks line up.`,
      `Scale ${+q.toFixed(4)}, ${+q.toFixed(4)}, ${+((S.hmax - S.hmin) * 100 / 512).toFixed(4)}. Section size ${cfg[0]}x${cfg[0]} quads, ${cfg[1]}x${cfg[1]} sections per component, ${cfg[2]}x${cfg[2]} components. Flip Y Axis off.`,
      `After Import the Landscape actor should read Location 0, 0, ${z} in the Details panel.`,
      'Open World (World Partition) levels: Unreal 5.7 and 5.8 have an engine bug where a heightmap imported straight into a World Partition level shows one small piece repeated with flat ground between. Import into a Basic level, save it, then use Tools > Convert Level to turn it into a World Partition level. 5.5 and 5.6 import directly.'
    ] };
}
const ueP = (xm, ym, zm = hAt(xm, ym)) => [Math.round(xm * 100), Math.round(ym * 100), Math.round(zm * 100)];
const thin = (pts, minM, keep = () => false) => {   // drop polyline points closer than minM metres (grid-coord input)
  const o = []; let last = null;
  for (const [j, p] of pts.entries()) { const xm = p[0] * S.cell, ym = p[1] * S.cell; if (!last || j === pts.length - 1 || keep(xm, ym) || Math.hypot(xm - last[0], ym - last[1]) >= minM) { o.push([xm, ym, p, j]); last = [xm, ym]; } }
  return o;
};
const csvCell = v => typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v;
const csv = (rows) => [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(csvCell).join(','))].join('\r\n');
function poiCsv() {
  return csv(S.pois.map(p => { const [X, Y, Z] = ueP(p.x * S.cell, p.y * S.cell);
    return { Name: p.id, Type: p.start ? 'start_town' : p.type, DisplayName: p.name, X, Y, Z, RadiusCm: Math.round((p.radius || 0) * 100),
      Region: REGION_NAME[S.region[p.i]] || '', Stage: STAGE_NAME[S.stageT[p.i]], Zone: ['', 'early', 'mid', 'late'][p.zone] || '', Danger: p.danger, LootTier: p.loot,
      Resources: (p.resources || []).join(';'), Rarity: p.rarity || '', Richness: p.richness ?? '', DepositRadiusCm: p.radiusM ? p.radiusM * 100 : '', Depth: p.depth || '',
      Parent: p.parent || '' }; }));
}
function buildingCsv() {
  return csv(S.buildings.map((b, j) => { const [X, Y, Z] = ueP(b.x, b.y, b.z);
    return { Name: 'B_' + String(j + 1).padStart(5, '0'), Kind: b.kind, X, Y, Z, YawDeg: +(b.a * 57.2958).toFixed(1), WidthCm: Math.round(b.w * 100), DepthCm: Math.round(b.d * 100) }; }));
}
$('xCsv').onclick = () => { if (!S) return; save(new Blob([poiCsv()], { type: 'text/csv' }), tag() + '_pois.csv'); setTimeout(() => save(new Blob([buildingCsv()], { type: 'text/csv' }), tag() + '_buildings.csv'), 400); };

// PCG masks (grayscale, export size): sample with PCG texture data over the landscape bounds
async function exportMasks() {
  const N = expN(), { n, biome, slope, moist, acc, lakeId, ocean, stageT, cell } = S, f = (n - 1) / (N - 1), k = 1 / f, cellE = S.sizeM / (N - 1), r = Math.max(1, Math.round(k));
  $('status').textContent = 'PCG masks: exclusion…'; await new Promise(res => setTimeout(res, 20));
  // exclusion: water + roads + rivers + building footprints, drawn as vectors at export size
  const c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, N, N); x.lineCap = x.lineJoin = 'round'; x.strokeStyle = x.fillStyle = '#fff';
  for (const [type, wm] of [['highway', 16], ['road', 11], ['trail', 4]]) { x.lineWidth = Math.max(1, wm / cellE); for (const rd of S.roads) if (rd.type === type) strokePts(x, rd.pts, k); }
  drawRivers(x, k, '#fff', 1);
  for (const st of S.streets) { x.lineWidth = Math.max(1, (st.w + 2) / cellE); x.beginPath(); st.pts.forEach(([px, py], j) => j ? x.lineTo((px / cell + .5) * k, (py / cell + .5) * k) : x.moveTo((px / cell + .5) * k, (py / cell + .5) * k)); x.stroke(); }
  for (const b of S.buildings) { x.save(); x.translate((b.x / cell + .5) * k, (b.y / cell + .5) * k); x.rotate(b.a); x.fillRect(-(b.w + 4) / 2 / cellE, -(b.d + 4) / 2 / cellE, (b.w + 4) / cellE, (b.d + 4) / cellE); x.restore(); }
  const img = x.getImageData(0, 0, N, N), d = img.data, E = new Uint8Array(N * N);
  for (let Y = 0; Y < N; Y++) { const row = Math.round(Y * f) * n; for (let X = 0; X < N; X++) { const o = Y * N + X, gi = row + Math.round(X * f); E[o] = ocean[gi] || lakeId[gi] ? 255 : d[4 * o]; } }
  const m = new Float32Array(N * N), t = new Float32Array(N * N), o = new Float32Array(N * N);
  const aT = S.riverT / 8, wet = i => Math.max(biome[i] === 7 || biome[i] === 8 || !S.land[i] ? 1 : 0, clamp(Math.log2(1 + acc[i] / aT) / 10, 0, 1));
  // scree: loose rock on moderate slopes just below a cliff, computed once on the generation grid
  const scree = new Float32Array(n * n), R3 = 3;
  for (let i = 0; i < n * n; i++) {
    if (!S.land[i] || slope[i] > 38 || slope[i] < 12) continue;
    const x = i % n, y = i / n | 0; let best = 0;
    for (let dy = -R3; dy <= R3; dy++) for (let dx = -R3; dx <= R3; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue; const j = yy * n + xx;
      if (S.h[j] > S.h[i] && slope[j] > 40) best = Math.max(best, 1 - Math.hypot(dx, dy) / (R3 + 1));
    }
    scree[i] = best * sstep(12, 22, slope[i]);
  }
  const MASKS = [
    ['Exclusion', null, 1],
    ['TreeDensity', i => biome[i] === 3 ? .55 + .45 * moist[i] : biome[i] === 2 ? .08 : biome[i] === 4 ? .15 : biome[i] === 7 ? .2 : 0, r],
    ['Grass', i => (biome[i] === 2 || biome[i] === 9 ? 1 : biome[i] === 7 ? .7 : biome[i] === 3 ? .45 : biome[i] === 4 ? .35 : 0) * (1 - sstep(30, 40, slope[i])), r],
    ['Rocks', i => S.land[i] ? clamp(sstep(20, 38, slope[i]) + (biome[i] === 5 ? .6 : biome[i] === 4 ? .3 : biome[i] === 6 ? .3 : 0), 0, 1) : 0, r],
    ['Cliffs', i => S.land[i] ? sstep(32, 45, slope[i]) : 0, r],
    ['Scree', i => scree[i], r],
    ['Floodplain', i => S.floodM ? S.floodM[i] : 0, r],
    ['Wetness', wet, r],
    ['AlienStage', i => stageT[i] / 3, r],
    // data maps, as terrain tools export them: slope (white = 60° or steeper), flow (how much water drains through, log
    // scale), curvature (grey = flat, lighter = ridges and crests, darker = hollows and channels) and aspect (north-facing
    // = black, south-facing = white), for driving materials, scatter and erosion effects in the engine
    ['Data_Slope', i => clamp(slope[i] / 60, 0, 1), 0],
    ['Data_Flow', i => S.land[i] ? clamp(Math.log2(1 + acc[i] / aT) / 14, 0, 1) : 0, r],
    ['Data_Curvature', i => { const x = i % n, y = i / n | 0; if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) return .5; return .5 + clamp((4 * S.h[i] - S.h[i - 1] - S.h[i + 1] - S.h[i - n] - S.h[i + n]) / cell * 2.5, -.5, .5); }, r],
    ['Data_Aspect', i => { const y = i / n | 0; if (y < 1 || y >= n - 1) return .5; return .5 + clamp((S.h[i - n] - S.h[i + n]) / (2 * cell) * 1.5, -.5, .5); }, r],
    // resource masks (0..1 density) for PCG scatter: trees by wood type, rocks/boulders, ore outcrops, forage, herbs, game, fish
    ...['softwood', 'hardwood', 'forage', 'herbs'].map(k => ['Res_' + k, i => S.res[k][i] / 255, r, true]),
    ...['stone', 'clay', 'sand', 'crops', 'game', 'fish', 'alien', ...ORE_KEYS].map(k => ['Res_' + k, i => S.res[k][i] / 255, r]),
    ['Regions', i => S.region[i] / 6, 0],     // indexed: round(v/255*6) → region id (discovery / "explore all regions")
    ['Zones', i => S.zone[i] / 3, 0]          // indexed: round(v/255*3) → 1 early, 2 mid, 3 late
  ];
  for (const [name, fn, br, clearOut] of MASKS) {
    $('status').textContent = `PCG masks: ${name}…`; await new Promise(res => setTimeout(res, 20));
    if (fn) for (let Y = 0; Y < N; Y++) { const row = Math.round(Y * f) * n; for (let X = 0; X < N; X++) m[Y * N + X] = fn(row + Math.round(X * f)); }
    else for (let i = 0; i < N * N; i++) m[i] = E[i] / 255;
    blur(m, N, br, t, o);
    const keepOut = clearOut || name === 'TreeDensity' || name === 'Grass' || name === 'Rocks' || name === 'Scree';      // scatter masks already respect the exclusion
    for (let i = 0; i < N * N; i++) { const v = (keepOut ? o[i] * (1 - E[i] / 255) : o[i]) * 255; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
    x.putImageData(img, 0, 0); await new Promise(res => c.toBlob(b => { save(b, `${tag(N)}_pcg_${name}.png`); res(); }));
  }
  $('status').textContent = 'PCG masks exported';
}
$('xMasks').onclick = () => S && exportMasks();

// Outlines of areas as polylines in metres (closed loops, or open where an area runs off the map edge): marching squares
// over the generation grid sampled every `step` cells, then the edge crossings are chained into lines.
function traceLoops(world, inside, step, minPts = 10) {
  const { n, cell } = world, G = Math.floor((n - 1) / step) + 1, v = new Uint8Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) v[y * G + x] = inside(Math.min(n - 1, y * step) * n + Math.min(n - 1, x * step)) ? 1 : 0;
  const adj = new Map(), link = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { let l = adj.get(p); if (!l) adj.set(p, l = []); l.push(q); } };
  for (let y = 0; y < G - 1; y++) for (let x = 0; x < G - 1; x++) {
    const a = v[y * G + x], b = v[y * G + x + 1], c = v[(y + 1) * G + x + 1], d = v[(y + 1) * G + x];
    const T = 2 * (y * G + x), R = 2 * (y * G + x + 1) + 1, B = 2 * ((y + 1) * G + x), L = 2 * (y * G + x) + 1, cross = [];
    if (a !== b) cross.push(T); if (b !== c) cross.push(R); if (c !== d) cross.push(B); if (d !== a) cross.push(L);
    if (cross.length === 2) link(cross[0], cross[1]);
    else if (cross.length === 4) { if (a) { link(T, R); link(B, L); } else { link(T, L); link(R, B); } }
  }
  const at = key => { const e = key >> 1, x = e % G, y = e / G | 0; return key & 1 ? [x * step * cell, (y + .5) * step * cell] : [(x + .5) * step * cell, y * step * cell]; };
  const seen = new Set(), out = [];
  const walk = start => { const keys = [start]; seen.add(start); for (let cur = start; ;) { const next = (adj.get(cur) || []).find(k => !seen.has(k)); if (next === undefined) break; seen.add(next); keys.push(next); cur = next; } return keys; };
  for (const [start, l] of adj) if (l.length === 1 && !seen.has(start)) { const k = walk(start); if (k.length >= minPts) out.push({ closed: false, pts: k.map(at) }); }   // open lines first
  for (const start of adj.keys()) if (!seen.has(start)) { const k = walk(start); if (k.length >= minPts) out.push({ closed: true, pts: k.map(at) }); }
  // one corner-cutting pass takes the grid look off the outline
  for (const o of out) { const p = o.pts, q = []; for (let j = 0; j < p.length - (o.closed ? 0 : 1); j++) { const a = p[j], b = p[(j + 1) % p.length]; q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } o.pts = o.closed ? q : [p[0], ...q, p.at(-1)]; }
  return out.sort((a, b) => b.pts.length - a.pts.length);
}
// Area outlines for engines: coastline, lake shores and the main land-cover zones, largest first, at most `cap` per kind.
const AREA_KINDS = [['coast', 'Coastline', w => i => !w.ocean[i], 1], ['lake', 'Lake shore', w => i => w.lakeId[i] > 0, 1], ['forest', 'Forest', w => i => w.biome[i] === 3, 2],
  ['farmland', 'Farmland', w => i => w.biome[i] === 9, 2], ['wetland', 'Wetland', w => i => w.biome[i] === 7, 2], ['beach', 'Beach', w => i => w.biome[i] === 1, 1],
  ['highland', 'Highland and alpine', w => i => w.biome[i] === 4 || w.biome[i] === 5, 2], ['snow', 'Snow', w => i => w.biome[i] === 6, 2]];
function worldAreas(world = S, cap = 40) {
  if (world.areas) return world.areas;
  const base = Math.max(1, Math.round(world.n / 336)), out = [];
  for (const [kind, label, make, coarse] of AREA_KINDS)
    traceLoops(world, make(world), base * coarse).slice(0, cap).forEach((o, j) => out.push({ kind, name: `${label} ${j + 1}`, closed: o.closed, pts: o.pts }));
  return world.areas = out;
}
// Unreal Editor Python script: landscape transform, POI markers, PCG volumes, road + river splines, lake markers
function ueScript() {
  const U = ueSetup(), T6 = S.riverT * 6;
  const settlements = new Map(S.pois.filter(p => p.radius).map(p => [p.name, p]));
  const root = `${S.mainland ? cap(S.shape) : 'Island'}_${S.seed}`;
  const data = {
    seed: S.seed, root, landscape: U,
    pois: S.pois.filter(p => p.type !== 'bridge').map(p => [p.id, p.start ? 'start_town' : p.type, p.name, ...ueP(p.x * S.cell, p.y * S.cell), REGION_NAME[S.region[p.i]] || '',
      ['', 'early', 'mid', 'late'][p.zone] || '', p.danger, p.loot, (p.resources || []).join(';')]),
    menuCamera: S.menuCam && { pos: ueP(S.menuCam.pos[0], S.menuCam.pos[1], S.menuCam.pos[2]), pitch: +S.menuCam.pitch.toFixed(2), yaw: +S.menuCam.yaw.toFixed(2) },
    volumes: [
      ...S.pois.filter(p => p.radius).map(p => { const [X, Y, Z] = ueP(p.x * S.cell, p.y * S.cell), s = Math.round(p.radius * 200); return [`PCG_${p.id}`, X, Y, Z, s, s, 40000, ['settlement', p.type]]; }),
      ...(S.slice ? [[S.slice, 'PCG_VerticalSlice', 'slice'], [S.slice.dev, 'PCG_DevArea', 'dev']].map(([b, nm, tg]) => { const [X, Y, Z] = ueP(b.cx * S.cell, b.cy * S.cell); return [nm, X, Y, Z, b.size * 100, b.size * 100, 60000, [tg]]; }) : []),
      (() => {
        const c = S.sizeM * 50, span = (S.hmax - S.hmin) * 100 + 4000;
        return S.mainland ? ['PCG_Terrain', c, c, U.actorLocation[2], S.sizeM * 100, S.sizeM * 100, span, ['terrain']]
          : ['PCG_Island', c, c, 0, S.sizeM * 100, S.sizeM * 100, 600000, ['island']];
      })()
    ],
    // road splines follow the graded surface (deck height on bridges, viaducts and through tunnels)
    roads: [...S.roads.map(r => {
      const ends = [settlements.get(r.a), settlements.get(r.b)].filter(Boolean);
      // Keep the original bends around towns so local streets still meet their approach roads.
      const keep = (x, y) => ends.some(p => Math.hypot(x - p.x * S.cell, y - p.y * S.cell) <= p.radius + 2 * S.cell);
      return [r.type, `${r.a} - ${r.b}`, thin(r.pts, Math.max(2 * S.cell, 25), keep)
        .map(([x, y, , j]) => ueP(x, y, (r.profile ? r.profile[j] : hAt(x, y)) + .3))];
    }), ...S.streets.map(s => ['street', s.town, s.pts.map(([x, y], j) => ueP(x, y, s.grade[j] + .2))]),
      ...S.metro.map(s => ['metro', s.from + ' - ' + s.to, s.points.map(([x, y, z]) => ueP(x, y, z))])],
    rivers: S.rivers.filter(p => p.some(q => q[2] >= T6)).map(p => {
      const pts = thin(p.filter(q => q[2] >= T6), Math.max(2 * S.cell, 30));
      return pts.length < 2 ? null : [Math.round(S.riverW(pts[0][2][2])), Math.round(S.riverW(pts[pts.length - 1][2][2])), pts.map(([xm, ym, q]) => ueP(xm, ym, q[3] + S.riverD(q[2]) * .8))];
    }).filter(Boolean),
    lakes: S.lakes.map(l => [l.name, ...ueP(l.x * S.cell, l.y * S.cell, l.level), +l.area.toFixed(3), !!l.reservoir]),
    // outlines as closed splines: coastline, lake shores and land-cover zones (drive PCG, landscape layers or biome tools)
    areas: worldAreas().map(o => { const pts = []; let last = null;
      for (const [x, y] of o.pts) if (!last || Math.hypot(x - last[0], y - last[1]) >= Math.max(2 * S.cell, 20)) { pts.push(ueP(x, y, Math.max(0, hAt(x, y)) + .5)); last = [x, y]; }
      return [o.kind, o.name, o.closed, pts]; }).filter(o => o[3].length >= 4)
  };
  return `"""Worldforge import for Unreal Editor 5 - ${root}

WHAT THIS DOES
  Places everything that belongs on top of the terrain: place markers, PCG volumes, road / street / metro splines,
  rivers, lake markers, and outlines of the coast, lakes and land-cover zones (forest, farmland, wetland, ...).
  It never imports the heightmap for you. Running it again replaces what it made before (outliner folder "${root}").

STEP 1 - IMPORT THE HEIGHTMAP (once)
  Landscape mode > Manage > New > Import from File, pick the .r16, then type these values:
    Heightmap     ${U.landscapeSize} x ${U.landscapeSize}
    Section size  ${U.quadsPerSection}x${U.quadsPerSection} quads     Sections per component  ${U.sectionsPerComponent}     Components  ${U.components}
    Location      ${U.location.join(', ')}     <- the CENTRE of the map (the panel places a landscape by its centre)
    Scale         ${U.scale.join(', ')}
    Flip Y Axis   off
  Press Import. The Landscape actor should then read Location ${U.actorLocation.join(', ')} in Details, and sea level is Z = 0.
  Open World level on Unreal 5.7 or 5.8: importing straight into it is broken in the engine (one piece of terrain repeated,
  flat ground between). Import into a Basic level, save it, then Tools > Convert Level.

STEP 2 - TURN ON THE PLUGINS (once, then restart the editor)
  Edit > Plugins: "Python Editor Script Plugin" (required), "PCG" (for the volumes).

STEP 2b - MAKE THE SPLINE BLUEPRINT (once)
  Content Browser > Add > Blueprint Class > Actor, name it BP_WorldforgeSpline, put it in /Game/Worldforge.
  Open it, Add > Spline, Compile, Save. Roads, rivers and outlines are spawned from it. Without it those parts are
  skipped and the summary says so; markers, volumes and lakes do not need it.

STEP 3 - RUN THIS FILE
  Open the level with the landscape, then Tools > Execute Python Script... and pick this file.
  A summary window lists what was created and what was skipped, with the reason. The same text is in the Output Log.

IF THE EDITOR STRUGGLES
  Save the level first. Set 'streets' and 'area outlines' to False in RUN for a lighter first pass, then add them back.
  Leave USE_WATER_PLUGIN off until everything else is in: Water plugin rivers are the heaviest thing this file can make.

SETTINGS YOU MAY WANT TO CHANGE are just below: which parts to run, and the Blueprint used for splines.
"""
import unreal, json

# ---- settings -------------------------------------------------------------------------------------------------------
# Set a part to False to leave it out.
RUN = {
    'landscape check': True,   # checks the landscape position and scale (moves it only in a plain, single-landscape level)
    'place markers': True,     # one Target Point per place, tagged with id, type, region, zone, danger, loot, resources
    'PCG volumes': True,       # a PCG Volume over each settlement and over the whole terrain
    'roads': True,             # highways, gravel roads and dirt tracks as splines
    'streets': True,           # settlement streets as splines (the largest group of actors: turn off for a lighter first run)
    'metro': True,             # underground metro lines as splines
    'rivers': True,            # rivers as plain splines (see USE_WATER_PLUGIN below)
    'lakes': True,             # one marker per lake at its water level
    'area outlines': True,     # coastline, lake shores, forest / farmland / wetland / beach / highland / snow as closed splines
    'menu camera': True,       # the main-menu vista camera, when the world has one
}
# Splines are spawned from this Blueprint: an Actor with one Spline component. Make it once: Content Browser > Add >
# Blueprint Class > Actor, name it BP_WorldforgeSpline in /Game/Worldforge, open it, Add > Spline, Compile, Save.
SPLINE_BP = '/Game/Worldforge/BP_WorldforgeSpline'
# True lets the script try to create that Blueprint itself when it is missing. Off by default: it drives the Blueprint
# editor from Python, which is the least dependable call in this file.
CREATE_SPLINE_BP = False
# True spawns real Water plugin rivers instead of plain splines. Off by default: every water body re-renders the landscape
# water brush and holds GPU memory, and dozens of them at once can exhaust the graphics card and crash the editor.
# Get everything else in first, save, then turn this on (lower MAX_WATER_RIVERS if the editor struggles).
USE_WATER_PLUGIN = False
MAX_WATER_RIVERS = 12          # largest rivers first; the rest stay plain splines
# Most outlines to make per kind (largest first). 0 = all of them.
MAX_AREAS_PER_KIND = 12
# ---------------------------------------------------------------------------------------------------------------------

DATA = json.loads(r'''${JSON.stringify(data)}''')
ROOT = DATA['root']
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def V(p):
    return unreal.Vector(float(p[0]), float(p[1]), float(p[2]))


def spawn(cls, loc, label, folder, tags=()):
    a = eas.spawn_actor_from_class(cls, V(loc))
    a.set_actor_label(label)
    a.set_folder_path(ROOT + '/' + folder)
    a.tags = [unreal.Name(t) for t in tags]
    return a


def set_points(spline, pts, closed=False):
    spline.clear_spline_points(False)
    for p in pts:
        spline.add_spline_point(V(p), unreal.SplineCoordinateSpace.WORLD, False)
    spline.set_closed_loop(closed, False)
    spline.update_spline()


# remove a previous import
for a in eas.get_all_level_actors():
    folder = str(a.get_folder_path())
    if folder == ROOT or folder.startswith(ROOT + '/'):
        eas.destroy_actor(a)


def landscape():
    L = DATA['landscape']
    want_loc, want_scale = V(L['actorLocation']), V(L['scale'])
    actors = eas.get_all_level_actors()
    lands = [a for a in actors if isinstance(a, unreal.Landscape)]
    proxy_cls = getattr(unreal, 'LandscapeStreamingProxy', None)
    proxies = [a for a in actors if proxy_cls and isinstance(a, proxy_cls)]
    hint = 'import Location %s (centre), Scale %s; the actor should then read Location %s' % (L['location'], L['scale'], L['actorLocation'])
    if not lands:
        return 'SKIPPED - no Landscape in the level. Do step 1 (%s), then run this script again' % hint

    def fits(a):
        loc, sc = a.get_actor_location(), a.get_actor_scale3d()
        return (abs(loc.x - want_loc.x) < 2 and abs(loc.y - want_loc.y) < 2 and abs(loc.z - want_loc.z) < 2
                and abs(sc.x - want_scale.x) < 0.01 and abs(sc.y - want_scale.y) < 0.01 and abs(sc.z - want_scale.z) < 0.01)

    if any(fits(a) for a in lands):
        return 'OK - already at the right place and scale, sea level is Z = 0'
    if len(lands) == 1 and not proxies:
        lands[0].set_actor_location(want_loc, False, False)
        lands[0].set_actor_scale3d(want_scale)
        return 'OK - moved and scaled, sea level is Z = 0'
    # World Partition keeps the terrain in streaming proxy actors that do not follow the Landscape actor when a script
    # moves it, and a level can hold other landscapes (the Open World template has its own): never guess here.
    for a in lands:
        loc, sc = a.get_actor_location(), a.get_actor_scale3d()
        unreal.log_warning('Island import: landscape "%s" is at (%.0f, %.0f, %.0f) scale (%.3f, %.3f, %.3f)' % (a.get_actor_label(), loc.x, loc.y, loc.z, sc.x, sc.y, sc.z))
    return ('NOT MOVED - no landscape matches this world and the level is World Partition or has several landscapes. '
            'Re-import with: %s. Everything else below is still placed at the right world positions.' % hint)


def pois():
    for pid, typ, name, x, y, z, region, zone, danger, loot, resources in DATA['pois']:
        spawn(unreal.TargetPoint, (x, y, z), name or pid, 'POI/' + typ,
              ['IslandPOI', 'id:' + pid, 'type:' + typ, 'region:' + region, 'zone:' + zone, 'danger:%s' % (danger or 0), 'loot:%s' % (loot or 0)]
              + ['res:' + r for r in resources.split(';') if r])
    return 'OK - %d markers in "%s/POI"' % (len(DATA['pois']), ROOT)


def menu_camera():
    c = DATA.get('menuCamera')
    if not c:
        return 'nothing to do - this world has no menu camera'
    a = eas.spawn_actor_from_class(unreal.CineCameraActor, V(c['pos']), unreal.Rotator(roll=0.0, pitch=c['pitch'], yaw=c['yaw']))
    a.set_actor_label('MainMenu_Vista_Camera')
    a.set_folder_path(ROOT + '/MainMenu')
    a.tags = [unreal.Name('IslandMenuCamera')]
    return 'OK - MainMenu_Vista_Camera'


def volumes():
    if not hasattr(unreal, 'PCGVolume'):
        return 'SKIPPED - the PCG plugin is off (Edit > Plugins > PCG, restart, run again)'
    for label, x, y, z, sx, sy, sz, tags in DATA['volumes']:
        a = spawn(unreal.PCGVolume, (x, y, z), label, 'PCG', ['IslandPCG'] + tags)
        a.set_actor_scale3d(unreal.Vector(sx / 200.0, sy / 200.0, sz / 200.0))   # default volume brush is 200 uu
    return 'OK - %d volumes' % len(DATA['volumes'])


_spline_cls = []


def spline_class():
    """The spline Blueprint class; creates the Blueprint (Actor + one SplineComponent) the first time if it is missing."""
    if _spline_cls:
        return _spline_cls[0]
    cls = None
    try:
        if not unreal.EditorAssetLibrary.does_asset_exist(SPLINE_BP):
            if not CREATE_SPLINE_BP:
                _spline_cls.append(None)
                return None
            folder, name = SPLINE_BP.rsplit('/', 1)
            factory = unreal.BlueprintFactory()
            factory.set_editor_property('parent_class', unreal.Actor)
            bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.Blueprint, factory)
            sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
            handles = sds.k2_gather_subobject_data_for_blueprint(bp)
            sds.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=handles[0], new_class=unreal.SplineComponent, blueprint_context=bp))
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            unreal.EditorAssetLibrary.save_asset(SPLINE_BP)
            unreal.log('Worldforge import: created %s' % SPLINE_BP)
        cls = unreal.EditorAssetLibrary.load_blueprint_class(SPLINE_BP)
    except Exception as e:
        unreal.log_warning('Worldforge import: could not create or load %s: %s' % (SPLINE_BP, e))
    _spline_cls.append(cls)
    return cls


NO_SPLINE_BP = ('SKIPPED - the spline Blueprint %s does not exist yet. Make it once (Content Browser > Add > Blueprint Class > Actor, '
                'Add > Spline, Compile, Save at that path) and run again') % SPLINE_BP


def spline_actor(cls, pts, label, folder, tags, closed=False):
    a = spawn(cls, pts[0], label, folder, tags)
    sp = a.get_component_by_class(unreal.SplineComponent)
    if not sp:
        raise RuntimeError('%s has no Spline component' % SPLINE_BP)
    set_points(sp, pts, closed)
    return a


def road_splines(kinds, folder):
    cls = spline_class()
    if not cls:
        return NO_SPLINE_BP
    count = {}
    for j, (typ, label, pts) in enumerate(DATA['roads']):
        if typ not in kinds:
            continue
        spline_actor(cls, pts, '%s_%03d %s' % (typ, j + 1, label), folder + '/' + typ, ['IslandRoad', 'type:' + typ])
        count[typ] = count.get(typ, 0) + 1
    return 'OK - ' + (', '.join('%d %s' % (n, t) for t, n in sorted(count.items())) or 'none in this world')


def roads():
    return road_splines(('highway', 'road', 'trail'), 'Roads')


def streets():
    return road_splines(('street',), 'Roads')


def metro():
    return road_splines(('metro',), 'Roads')


def rivers():
    water_cls = getattr(unreal, 'WaterBodyRiver', None) if USE_WATER_PLUGIN else None
    cls = spline_class()
    if not cls and not water_cls:
        return NO_SPLINE_BP
    order = sorted(range(len(DATA['rivers'])), key=lambda j: -DATA['rivers'][j][1])     # widest at the mouth first
    as_water = set(order[:MAX_WATER_RIVERS]) if water_cls else set()
    made = [0, 0]
    for j, (w0, w1, pts) in enumerate(DATA['rivers']):
        tags = ['IslandRiver', 'widthStartM:%d' % w0, 'widthEndM:%d' % w1]
        if j in as_water:
            a = spawn(water_cls, pts[0], 'River_%03d' % (j + 1), 'Rivers', tags)
            set_points(a.get_water_spline(), pts)
            made[0] += 1
        elif cls:
            spline_actor(cls, pts, 'River_%03d' % (j + 1), 'Rivers', tags)
            made[1] += 1
    return 'OK - %d Water plugin rivers, %d plain splines (widths are in the actor tags)' % tuple(made)


def lakes():
    for name, x, y, z, area, reservoir in DATA['lakes']:
        spawn(unreal.TargetPoint, (x, y, z), name, 'Lakes', ['IslandLake', 'areaKm2:%s' % area] + (['reservoir'] if reservoir else []))
    return 'OK - %d lake markers' % len(DATA['lakes'])


def areas():
    cls = spline_class()
    if not cls:
        return NO_SPLINE_BP
    count = {}
    for kind, name, closed, pts in DATA.get('areas', []):
        if MAX_AREAS_PER_KIND and count.get(kind, 0) >= MAX_AREAS_PER_KIND:
            continue
        spline_actor(cls, pts, name, 'Areas/' + kind, ['IslandArea', 'kind:' + kind], closed)
        count[kind] = count.get(kind, 0) + 1
    return 'OK - ' + (', '.join('%d %s' % (n, k) for k, n in sorted(count.items())) or 'no outlines in this world')


STEPS = (('landscape check', landscape), ('place markers', pois), ('PCG volumes', volumes), ('roads', roads), ('streets', streets),
         ('metro', metro), ('rivers', rivers), ('lakes', lakes), ('area outlines', areas), ('menu camera', menu_camera))
report = []
with unreal.ScopedSlowTask(len(STEPS), 'Worldforge import') as task:
    task.make_dialog(True)
    for name, fn in STEPS:
        task.enter_progress_frame(1, name)
        if not RUN.get(name, True):
            report.append('%-16s turned off in RUN' % name)
            continue
        try:
            report.append('%-16s %s' % (name, fn() or 'OK'))
        except Exception as e:
            report.append('%-16s FAILED - %s' % (name, e))
        unreal.SystemLibrary.collect_garbage()       # keep editor memory flat between parts
summary = 'Worldforge import - %s\\n\\n' % ROOT + '\\n'.join(report)
unreal.log(summary)
try:
    unreal.EditorDialog.show_message('Worldforge import', summary, unreal.AppMsgType.OK)
except Exception:
    pass
`;
}
$('xPy').onclick = () => S && save(new Blob([ueScript()], { type: 'text/x-python' }), `import_${S.mainland ? S.shape : 'island'}_${S.seed}.py`);
$('xAll').onclick = async () => {     // everything Unreal needs, at the export size
  if (!S) return;
  for (const id of ['xR16', 'xLayers']) await $(id).onclick();
  await exportMasks();
  $('xWater').onclick(); await new Promise(res => setTimeout(res, 1500));
  $('xCsv').onclick(); await new Promise(res => setTimeout(res, 800));
  $('xJson').onclick(); $('xEco').onclick(); $('xPy').onclick();
  $('status').textContent = 'Unreal package exported';
};

$('xMap').onclick = () => {
  if (!S) return; const c = document.createElement('canvas'); c.width = c.height = cv.width; const x = c.getContext('2d');
  x.drawImage(cv, 0, 0); const q0 = ovQ; ovQ = 0; drawOverlays(x); ovQ = q0; drawScaleBar(x, S.cell / S.k, 24 * c.width / 1010, c.height - 24 * c.width / 1010, c.width / 1010); c.toBlob(b => save(b, tag() + '_map.png'));
};
function worldData() {
  const { n, cell, hmin, hmax } = S, m = (x, y) => [Math.round(x * cell), Math.round(y * cell)];
  const box = b => b && { center: m(b.cx, b.cy), sizeM: b.size };
  return {
    seed: S.seed, scenario: S.scenario, shape: S.shape, terrainSettings: S.terrainSettings, terrainBackend: S.terrainBackend, roadScreeningBackend: S.roadScreeningBackend, sizeMeters: S.sizeM, grid: n, metersPerPixel: cell, landKm2: +S.stats.landKm2.toFixed(1), heightMin: hmin, heightMax: hmax, seaLevelNorm: -hmin / (hmax - hmin),
    unreal: ueSetup(),
    note: 'r16 = uint16 little-endian row-major, (h - heightMin)/(heightMax - heightMin)*65535. Coordinates are metres from the top-left (NW) corner.',
    verticalSlice: box(S.slice), devArea: S.slice && box(S.slice.dev),
    pcgMaskEncoding: { Regions: 'round(value/255*6): ' + REGION_NAME.slice(1).map((r, j) => `${j + 1}=${r}`).join(', '), Zones: 'round(value/255*3): 1=early 2=mid 3=late', AlienStage: 'round(value/255*3): ' + STAGE_NAME.join('/') },
    mainMenuCamera: S.menuCam ? { pos: S.menuCam.pos.map(Math.round), target: S.menuCam.target.map(Math.round), fromFarm: S.menuCam.farm } : null,
    realityCheck: S.reality, travel: S.travel,
    resources: { areaKm2: Object.fromEntries(Object.entries(S.resStats.areaKm2).map(([k, v]) => [k, +v.toFixed(2)])), standingTimberM3: Math.round(S.resStats.timberM3),
      oreRarity: ['stone', 'iron', 'copper', 'silver', 'gold', 'titanium', 'diamond', 'uranium'],
      deposits: S.deposits.map(p => ({ id: p.id, kind: p.type, name: p.name, rarity: p.rarity || null, rarityLabel: p.rarityLabel || null, pos: m(p.x, p.y), radiusM: p.radiusM, richness: p.richness, depth: p.depth })),
      note: 'Area resources are the Res_* PCG masks (0..1 density). Deposit/point resources are POIs with a resources list.' },
    pois: S.pois.map(p => ({ id: p.id, resources: p.resources || [], zone: ['', 'early', 'mid', 'late'][p.zone], danger: p.danger, lootTier: p.loot, type: p.start ? 'start_town' : p.type, name: p.name, pos: m(p.x, p.y), height: Math.round(p.h), ...(p.access ? { roadAccess: p.access } : {}), ...(p.strength ? { seedStrength: p.strength } : {}), ...(p.dropM ? { dropM: p.dropM, riverWidthM: p.riverWidthM } : {}) })),
    lakes: S.lakes.map(l => ({ name: l.name, reservoir: !!l.reservoir, pos: m(l.x, l.y), areaKm2: +l.area.toFixed(3), waterLevel: +l.level.toFixed(1), maxDepth: +l.depth.toFixed(1) })),
    riverOutlets: S.rivers.filter(p => p.exitsMap).map(p => {
      const [x, y, , z] = p.at(-1);
      return { pos: m(x, y), bedElevationM: +z.toFixed(2) };
    }),
    roads: S.roads.map(r => {
      const st = []; if (r.deck) for (let j = 0; j < r.deck.length; j++) if ([1, 2, 3, 6].includes(r.deck[j])) { let e = j; while (e < r.deck.length && r.deck[e] === r.deck[j]) e++;
        st.push({ type: { 1: 'bridge', 2: 'viaduct', 3: 'tunnel', 6: 'overpass' }[r.deck[j]], from: m(...r.pts[Math.max(0, j - 1)]), to: m(...r.pts[Math.min(r.pts.length - 1, e)]), deckPoints: r.pts.slice(Math.max(0, j - 1), e + 1).map(([x, y], k) => [...m(x, y), r.profile[Math.max(0, j - 1) + k]]), lengthM: Math.round(r.dist[Math.min(r.pts.length - 1, e)] - r.dist[Math.max(0, j - 1)]) }); j = e; }
      return { type: r.type, from: r.a, to: r.b, lengthM: Math.round(r.len), pts: r.pts.map(([x, y], j) => [...m(x, y), r.profile ? +r.profile[j].toFixed(1) : null]), structures: st };
    }),
    areasFormat: 'outlines in metres from the north-west corner; closed = a loop, open = runs off the map edge', areas: worldAreas().map(o => ({ kind: o.kind, name: o.name, closed: o.closed, pts: o.pts.map(([x, y]) => [Math.round(x), Math.round(y)]) })),
    alienCorridors: S.corridors.map(c => ({ from: c.from, widthM: Math.round(S.corW), pts: c.pts.map(([x, y]) => m(x, y)) })),
    noRoadAccess: S.stats.unreachable, roadAccessReview: S.roadAccessReview, metro: S.metro,
    settlements: S.pois.filter(p => p.radius).map(p => ({ id: p.id, name: p.name, type: p.type, layout: p.layout, center: m(p.x, p.y), radiusM: Math.round(p.radius), axisAngle: +p.angle.toFixed(3), blockM: p.block })),
    streets: S.streets.map(s => ({ settlement: s.town, widthM: s.w, main: s.main, pts: s.pts.map(([x, y]) => [Math.round(x), Math.round(y)]), gradeM: s.grade })),
    buildingsFormat: '[x, y, width, depth, angleRad, kind, foundationElevationM, poiId] in metres', buildings: S.buildings.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.d), +b.a.toFixed(3), b.kind, b.z, b.poiId || null])
  };
}
$('xJson').onclick = () => { if (S) save(new Blob([JSON.stringify(worldData())], { type: 'application/json' }), tag() + '.json'); };

async function storeZip(entries) {
  const chunks = [], directory = [], encode = new TextEncoder();
  const table = Uint32Array.from({ length: 256 }, (_, v) => {
    for (let i = 0; i < 8; i++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v;
  });
  let offset = 0, directorySize = 0;
  for (const [path, blob] of entries) {
    const name = encode.encode(path), bytes = new Uint8Array(await blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc ^= 0xffffffff;
    const local = new DataView(new ArrayBuffer(30)), central = new DataView(new ArrayBuffer(46));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
    local.setUint16(12, 33, true); local.setUint32(14, crc, true);
    local.setUint32(18, blob.size, true); local.setUint32(22, blob.size, true); local.setUint16(26, name.length, true);
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
    central.setUint16(14, 33, true); central.setUint32(16, crc, true);
    central.setUint32(20, blob.size, true); central.setUint32(24, blob.size, true); central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    chunks.push(local.buffer, name, blob); directory.push(central.buffer, name);
    offset += 30 + name.length + blob.size; directorySize += 46 + name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end.buffer], { type: 'application/zip' });
}
const UNITY_IMPORTER = `using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

internal static class WorldforgeTerrainImporter
{
    private const string Root = "Assets/Worldforge";
    [Serializable] private class Settings
    {
        public int width, height;
        public float footprintMeters, heightMinMeters, verticalRangeMeters;
    }
    [Serializable] private class TileSet
    {
        public string engine;
        public int width, height, tilesPerSide;
        public float tileSizeMeters, heightMinMeters, verticalRangeMeters;
        public Tile[] tiles;
    }
    [Serializable] private class Tile
    {
        public int x, y;
        public string file;
    }

    private static Terrain CreateSurface(string path, int n, float size, float range, Vector3 position, string name)
    {
        var bytes = File.ReadAllBytes(path);
        if ((n != 513 && n != 1025 && n != 2049 && n != 4097) ||
            bytes.Length != n * n * 2 || !(size > 0) || !(range > 0))
            throw new InvalidDataException("The height data and terrain settings do not match.");
        var heights = new float[n, n];
        for (int row = 0, i = 0; row < n; row++)
            for (int col = 0; col < n; col++, i += 2)
                heights[row, col] = (bytes[i] | (bytes[i + 1] << 8)) / 65535f;
        var data = new TerrainData { heightmapResolution = n, size = new Vector3(size, range, size) };
        data.SetHeights(0, 0, heights);
        AssetDatabase.CreateAsset(data, AssetDatabase.GenerateUniqueAssetPath(Root + "/" + name + ".asset"));
        var terrain = Terrain.CreateTerrainGameObject(data);
        terrain.name = name;
        terrain.transform.position = position;
        Undo.RegisterCreatedObjectUndo(terrain, "Create Worldforge Terrain");
        return terrain.GetComponent<Terrain>();
    }

    [MenuItem("Tools/Worldforge/Create Terrain")]
    private static void CreateTerrain()
    {
        try
        {
            var s = JsonUtility.FromJson<Settings>(File.ReadAllText(Root + "/terrain.json"));
            if (s == null || s.width != s.height) throw new InvalidDataException("Expected a square heightmap.");
            Selection.activeGameObject = CreateSurface(Root + "/height.bytes", s.width, s.footprintMeters,
                s.verticalRangeMeters, new Vector3(0, s.heightMinMeters, 0), "Worldforge Island").gameObject;
        }
        catch (Exception e) { EditorUtility.DisplayDialog("Worldforge import", e.Message, "OK"); }
    }

    [MenuItem("Tools/Worldforge/Create Terrain Tiles")]
    private static void CreateTiles()
    {
        var path = EditorUtility.OpenFilePanel("Open Worldforge tiles.json", Root, "json");
        if (string.IsNullOrEmpty(path)) return;
        try
        {
            var s = JsonUtility.FromJson<TileSet>(File.ReadAllText(path));
            if (s == null || s.engine != "unity" || s.width != 1025 || s.height != 1025 ||
                s.tilesPerSide < 2 || s.tilesPerSide > 16 || !(s.tileSizeMeters > 0) ||
                !(s.verticalRangeMeters > 0) || s.tiles == null || s.tiles.Length == 0)
                throw new InvalidDataException("Expected a Worldforge Unity tile manifest.");
            var directory = Path.GetDirectoryName(path);
            var coords = new HashSet<Vector2Int>();
            foreach (var tile in s.tiles)
            {
                if (tile == null || tile.x < 0 || tile.y < 0 || tile.x >= s.tilesPerSide || tile.y >= s.tilesPerSide ||
                    !coords.Add(new Vector2Int(tile.x, tile.y)) || tile.file != $"height_x{tile.x}_y{tile.y}.bytes" ||
                    new FileInfo(Path.Combine(directory, tile.file)).Length != s.width * s.height * 2)
                    throw new InvalidDataException("Invalid or duplicate tile in the manifest.");
            }
            var terrains = new Dictionary<Vector2Int, Terrain>();
            foreach (var tile in s.tiles)
            {
                var position = new Vector3(tile.x * s.tileSizeMeters, s.heightMinMeters, tile.y * s.tileSizeMeters);
                var terrain = CreateSurface(Path.Combine(directory, tile.file), s.width, s.tileSizeMeters,
                    s.verticalRangeMeters, position, $"Worldforge x{tile.x} y{tile.y}");
                terrain.allowAutoConnect = false;
                terrains.Add(new Vector2Int(tile.x, tile.y), terrain);
            }
            foreach (var pair in terrains)
            {
                terrains.TryGetValue(pair.Key + Vector2Int.left, out var left);
                terrains.TryGetValue(pair.Key + Vector2Int.up, out var top);
                terrains.TryGetValue(pair.Key + Vector2Int.right, out var right);
                terrains.TryGetValue(pair.Key + Vector2Int.down, out var bottom);
                pair.Value.SetNeighbors(left, top, right, bottom);
            }
        }
        catch (Exception e) { EditorUtility.DisplayDialog("Worldforge tile import", e.Message, "OK"); }
    }

    [MenuItem("Tools/Worldforge/Export Unity Package")]
    private static void ExportPackage()
    {
        var path = EditorUtility.SaveFilePanel("Export Worldforge assets", "", "Worldforge", "unitypackage");
        if (!string.IsNullOrEmpty(path)) AssetDatabase.ExportPackage(Root, path, ExportPackageOptions.Recurse);
    }
}
`;
$('xUnityPack').onclick = async () => {
  const world = S, button = $('xUnityPack'), generateButton = $('gen'), roll = $('rnd');
  if (!world || button.disabled || generateButton.disabled) return;
  const prefix = 'Assets/Worldforge/', files = [], put = (path, blob) => files.push([prefix + path, blob]);
  const data = JSON.stringify(worldData()), name = tag();
  button.disabled = generateButton.disabled = roll.disabled = true;
  try {
    const N = await exportEngineHeight('unity', (blob, name) => put(name.endsWith('.raw') ? 'height.bytes' : 'terrain.json', blob));
    put('world.json', new Blob([data], { type: 'application/json' }));
    put('Editor/WorldforgeTerrainImporter.cs', new Blob([UNITY_IMPORTER]));
    await exportLayers(N, world, (blob, name) => put('Layers/' + name + '.png', blob));
    $('status').textContent = 'Packaging Unity assets…';
    save(await storeZip(files), name + '_unity.zip');
    $('status').textContent = 'Unity bundle exported';
  } catch (e) {
    $('status').textContent = 'Unity export error: ' + e.message;
    console.error(e);
  } finally {
    $('xUnityPack').disabled = $('gen').disabled = $('rnd').disabled = false;
  }
};

function tileOptions() {
  const engine = $('tileEngine').value === 'unity' ? 'unity' : 'unreal';
  const value = +$('tileCount').value, count = [2, 4, 8, 16].includes(value) ? value : 8;
  const index = id => clamp(Math.trunc(Number($(id).value) || 0), 0, count - 1);
  return { engine, count, x: index('tileX'), y: index('tileY'), N: engine === 'unity' ? 1025 : 1009 };
}
function updateTileInfo() {
  const { count, x, y, N } = tileOptions(), q = count * (N - 1);
  $('tileX').max = $('tileY').max = count - 1;
  $('tileX').value = x; $('tileY').value = y;
  const pitch = S ? ` · ${(S.sizeM / q).toFixed(2)} m between samples` : '';
  $('tileInfo').textContent = `${N} × ${N} per tile · ${q + 1} × ${q + 1} combined${pitch} · ${Math.round(count * count * N * N * 2 / 1048576)} MiB for all tiles`;
}
async function exportTerrainTiles(world, { engine, count, x, y, N }, all, emit = save) {
  const unity = engine === 'unity', quads = count * (N - 1), tileSizeMeters = world.sizeM / count;
  const sampleSpacingMeters = world.sizeM / quads, verticalRangeMeters = world.hmax - world.hmin;
  const tileList = all ? Array.from({ length: count * count }, (_, i) => [i % count, Math.floor(i / count)]) : [[x, y]];
  const metadata = {
    engine, seed: world.seed, scenario: world.scenario, shape: world.shape, terrainSettings: world.terrainSettings, terrainBackend: world.terrainBackend,
    width: N, height: N, tilesPerSide: count, fullResolution: quads + 1, tileSizeMeters,
    footprintMeters: world.sizeM, sampleSpacingMeters, heightMinMeters: world.hmin, heightMaxMeters: world.hmax,
    verticalRangeMeters, seaLevelMeters: 0, format: 'unsigned 16-bit little-endian RAW, row-major',
    orientation: 'Columns increase east (+X). Rows increase south (+Y in Unreal, +Z in Unity).',
    tiles: []
  };
  if (!unity) metadata.unreal = {
    scale: [sampleSpacingMeters * 100, sampleSpacingMeters * 100, verticalRangeMeters * 100 / 512],
    locationZCm: (world.hmin + world.hmax) * 50,
    // the import panel places the stitched landscape by its centre; this puts the north-west corner at 0, 0
    importLocationCm: [world.sizeM * 50, world.sizeM * 50, (world.hmin + world.hmax) * 50],
    quadsPerSection: 63, sectionsPerComponent: '2x2', componentsPerTile: '8x8'
  };
  const prefix = unity ? 'Assets/Worldforge/Tiles/' : '', files = [];
  const progress = $('tileProgress'); progress.max = tileList.length; progress.value = 0;
  for (const [tx, ty] of tileList) {
    $('status').textContent = `Refining tile ${metadata.tiles.length + 1} of ${tileList.length} (X ${tx}, Y ${ty})…`;
    await new Promise(resolve => setTimeout(resolve, 20));
    const file = `height_x${tx}_y${ty}.${unity ? 'bytes' : 'r16'}`;
    const bytes = encodeHeightLE(await buildHeightTile(world, count, N, tx, ty), world);
    files.push([prefix + file, new Blob([bytes])]);
    metadata.tiles.push({ x: tx, y: ty, file, eastMeters: tx * tileSizeMeters, southMeters: ty * tileSizeMeters });
    progress.value = metadata.tiles.length;
  }
  files.push([prefix + 'tiles.json', new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' })]);
  if (unity) files.push(['Assets/Worldforge/Editor/WorldforgeTerrainImporter.cs', new Blob([UNITY_IMPORTER])]);
  $('status').textContent = 'Packaging terrain tiles…';
  const suffix = all ? 'all' : `x${x}_y${y}`;
  emit(await storeZip(files), `${world.mainland ? world.shape : 'island'}_${world.seed}_${world.sizeM / 1000}km_${engine}_${count}x${count}_${suffix}.zip`);
  $('status').textContent = `Exported ${tileList.length} terrain ${all ? 'tiles' : 'tile'}`;
}
async function downloadTerrainTiles(all) {
  if (!S || $('gen').disabled) return;
  const controls = ['gen', 'rnd', 'xUnityPack', 'xTile', 'xTiles', 'xAll', 'xR16', 'xPng', 'xUnity', 'xGodot', 'xLayers', 'xWater', 'xMasks'];
  for (const id of controls) $(id).disabled = true;
  $('tileProgress').hidden = false;
  try {
    await exportTerrainTiles(S, tileOptions(), all);
  } catch (e) {
    $('status').textContent = 'Tile export error: ' + e.message;
    console.error(e);
  } finally {
    $('tileProgress').hidden = true;
    for (const id of controls) $(id).disabled = false;
  }
}
$('xTile').onclick = () => downloadTerrainTiles(false);
$('xTiles').onclick = () => downloadTerrainTiles(true);
for (const id of ['tileEngine', 'tileCount', 'tileX', 'tileY', 'oTileGrid']) $(id).onchange = () => { updateTileInfo(); if (S) scheduleOverlay(); };
