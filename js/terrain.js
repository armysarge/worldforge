"use strict";

// Requires core.js, hydrology.js and baseterrain.js (loaded first by index.html).

// ---------- generator ----------
const SYL = ['ar','bel','cor','dun','el','fen','gar','hol','ket','lor','mar','nor','os','pen','rav','sel','tor','ul','vin','wyn','cal','bra','dra','hen'];
const SUF = ['ton','ford','ham','wick','vale','mouth','haven','ridge','field','bury','stead','brook'];
const GREEK = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta'];
const cap = s => s[0].toUpperCase() + s.slice(1);
// ecology resistance per biome (docs: native ecological resistance 0..100)
const RESIST = [0, 50, 30, 40, 55, 75, 90, 15, 0, 25];
const ECO_CELL = 250;                       // docs: EcologyGrid, 250 m cells
const SLICE_M = 2000, DEV_M = 1225;         // docs: vertical slice ~4 km², first playable ~1.5 km²

// Settings that drive generation. Read from the form on the main thread; buildWorld itself never touches the DOM,
// so it can run in a Web Worker (js/worker.js).
const GEN_SETTING_IDS = ['seed', 'scenario', 'fp', 'shape', 'size', 'compute', 'mtn', 'lakes', 'riv', 'elevation', 'erosion', 'snowLine', 'terrainScale', 'landforms'];
const readGenSettings = () => Object.fromEntries(GEN_SETTING_IDS.map(id => [id, $(id).value]));
// river width/depth from catchment: plain functions can't cross the worker boundary, so they are rebuilt from riverT and ez
function attachRiverFns(world) {
  const { riverT: T, ez } = world;
  world.riverW = a => 2 + 2.5 * Math.sqrt(a);
  world.riverD = a => Math.min(30, 3 + 4 * Math.log2(Math.max(1, a / T))) * ez;
  return world;
}
class GenerationCancelled extends Error { constructor() { super('Generation cancelled'); this.name = 'GenerationCancelled'; } }

async function buildWorld(settings, onStatus = () => {}) {
  const val = id => settings[id] ?? '';
  const scenario = val('scenario'), story = scenario === 'desolation';
  const seedStr = val('seed') || '1', R = mulberry(hashSeed(seedStr)), noise = mkNoise(R), F = (x, y, o) => fbm(noise, x, y, o);
  const FK = +val('fp'), sizeM = FK * 1000, sc = FK / 100, sq = Math.sqrt(sc);
  const ez = Math.min(1, Math.pow(sc, .6));  // elevation scale: small islands get lower, but still steep, relief
  const M = v => v * sc;                      // design distances below are authored for the 100 km footprint
  const cnt = b => Math.max(1, Math.round(b));
  const n = +val('size'), cell = sizeM / (n - 1), N2 = n * n, cellKm2 = cell * cell / 1e6;
  const OC = 5 + Math.max(0, Math.round(Math.log2((n - 1) / 504)));   // more noise octaves at finer grids
  const mtnAmp = +val('mtn'), nLakes = +val('lakes'), dens = +val('riv');
  const setting = (id, fallback) => { const v = settings[id]; return v === '' || v == null ? fallback : +v; };
  const terrainSettings = {
    elevation: setting('elevation', .5), erosion: setting('erosion', .3),
    snowLine: setting('snowLine', .8), scale: setting('terrainScale', .01)
  };
  const frequency = terrainSettings.scale * 100, elevation = .4 + 1.2 * terrainSettings.elevation;
  const snowM = (300 + 2000 * terrainSettings.snowLine) * ez;
  const useGPU = val('compute') === 'auto', landforms = val('landforms') !== 'off';   // landforms: deltas + floodplains (reshape terrain)
  const stageTimes = []; let stageName = null, stageStart = performance.now();            // seconds spent in each generation stage
  const lapStage = () => { const now = performance.now(); if (stageName) stageTimes.push([stageName, (now - stageStart) / 1000]); stageStart = now; };
  const status = m => { lapStage(); stageName = m.replace(/…$/, ''); return Promise.resolve(onStatus(m)).then(() => new Promise(r => setTimeout(r))); };   // onStatus may throw GenerationCancelled
  const pick = a => a[R() * a.length | 0];

  // 1. coastline + mountains ------------------------------------------
  await status('1/10 Base terrain…');
  // island outline = smooth union of elliptical blobs (minus cut-outs), picked per archetype
  const shape = val('shape') === 'random' ? pick(SHAPES) : val('shape');
  const A = R() * 6.2832, ca = Math.cos(A), sa = Math.sin(A), add = [], sub = [], mainland = MAINLAND[shape];
  const profile = mainland ? buildMainlandProfile(shape, F, ca, sa, frequency) : null;
  const blob = (x, y, rx, ry, ang = A) => ({ x, y, rx, ry, c: Math.cos(ang), s: Math.sin(ang), ang });
  const along = (t, o = 0) => [.5 + ca * t - sa * o, .5 + sa * t + ca * o];
  if (shape === 'round') add.push(blob(.5, .5, .37 + R() * .04, .33 + R() * .06));
  else if (shape === 'elongated') { add.push(blob(.5, .5, .46, .17 + R() * .07)); add.push(blob(...along((R() < .5 ? 1 : -1) * .26, (R() - .5) * .12), .16, .13, R() * 6.28)); }
  else if (shape === 'crescent') { add.push(blob(.5, .5, .4, .37)); sub.push(blob(...along(.3 + R() * .06), .2 + R() * .06, .17 + R() * .05)); }
  else if (shape === 'twin') { for (const t of [-.21, .21]) add.push(blob(...along(t, (R() - .5) * .12), .22 + R() * .05, .2 + R() * .05, R() * 6.28)); add.push(blob(.5, .5, .17, .06 + R() * .03)); }
  else if (shape === 'branching') { add.push(blob(.5, .5, .25, .22)); for (let j = 0, k = 3 + (R() * 2 | 0); j < k; j++) { const a = A + j * 6.2832 / k + (R() - .5) * .7; add.push(blob(.5 + Math.cos(a) * .23, .5 + Math.sin(a) * .23, .21, .07 + R() * .04, a)); } }
  else if (shape === 'hook') {
    add.push(blob(...along(-.1, -.04), .35, .23), blob(...along(.22, .05), .22, .14, A + .5), blob(...along(.3, .18), .16, .08, A + 1.1));
    sub.push(blob(...along(.2, .29), .17, .12, A + .25));
  }
  else if (shape === 'inlets') {
    add.push(blob(.5, .5, .41, .27), blob(...along(-.22, .1), .2, .13, A - .35));
    for (let j = 0; j < 3; j++) sub.push(blob(...along(-.22 + j * .19 + (R() - .5) * .04, (j % 2 ? -.25 : .25)), .045 + R() * .025, .16 + R() * .04, A + (R() - .5) * .35));
  }
  else if (shape === 'headlands') {
    add.push(blob(...along(-.1, -.04), .31, .25, A - .25), blob(...along(.21, .08), .23, .14, A + .4), blob(...along(-.22, .19), .19, .09, A - .7));
    sub.push(blob(...along(.09, -.25), .14, .1, A - .35), blob(...along(-.21, .27), .1, .08, A + .5));
  }
  else if (!mainland) { add.push(blob(.5, .5, .3, .26)); for (let j = 0, k = 3 + (R() * 3 | 0); j < k; j++) { const a = A + j * 6.2832 / k + (R() - .5) * .8, r = .35 + R() * .06; add.push(blob(.5 + Math.cos(a) * r, .5 + Math.sin(a) * r, .04 + R() * .04, .035 + R() * .03, R() * 6.28)); } }
  const bval = (b, u, v) => { const dx = u - b.x, dy = v - b.y; return 2 * Math.sqrt(b.rx * b.ry) * (1 - Math.hypot((dx * b.c + dy * b.s) / b.rx, (dy * b.c - dx * b.s) / b.ry)); };
  const shapeAt = (u, v) => {
    if (profile) return sampleProfile(profile, u, v);
    const wx = u + .13 * F(u * 3 + 5, v * 3 + 5, 3), wy = v + .13 * F(u * 3 + 40, v * 3 + 40, 3);
    let m = -9, e = 0; for (const b of add) m = Math.max(m, bval(b, wx, wy));
    for (const b of add) e += Math.exp(20 * (bval(b, wx, wy) - m));       // smooth union
    let s = m + Math.log(e) / 20;
    for (const b of sub) s = Math.min(s, -bval(b, wx, wy));
    return s + .26 * F(u * 2.2 + 9, v * 2.2 + 9, 5) - (1 - sstep(0, .08, Math.min(u, v, 1 - u, 1 - v))) * .6;
  };
  let off = 0;
  if (!mainland) { // Islands retain their calibrated land fraction.
    const samp = []; for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) samp.push(shapeAt(x / 95, y / 95));
    samp.sort((a, b) => a - b); off = -samp[Math.floor((1 - LAND_FRAC) * samp.length)];
  }

  const ranges = [], mainBlobs = add.filter(b => b.rx >= .1);
  if (mainland) {
    for (const offset of mainland.offsets) {
      const pts = [-.72, -.36, 0, .36, .72].map(t => along(t, offset + (R() - .5) * .1));
      ranges.push({ pts, w: mainland.width * (.85 + R() * .3), amp: mainland.amplitude * (.85 + R() * .3) * mtnAmp * ez });
    }
  } else for (let k = 0, rc = 2 + (R() * 2 | 0); k < rc; k++) {
    const b = pick(mainBlobs), cx = b.x + (R() - .5) * b.rx * .6, cy = b.y + (R() - .5) * b.ry * .6;
    const ang = b.rx > b.ry * 1.5 ? b.ang + (R() - .5) * .5 : R() * Math.PI, len = Math.min(.6, b.rx * 1.4) * (.6 + R() * .5), pts = [];
    for (const j of [-1, -.5, 0, .5, 1]) pts.push([cx + Math.cos(ang) * j * len / 2 + (R() - .5) * .08, cy + Math.sin(ang) * j * len / 2 + (R() - .5) * .08]);
    ranges.push({ pts, w: .045 + .04 * R(), amp: (1500 + 800 * R()) * mtnAmp * ez });
  }
  const input = { n, OC, off, ez, add, sub, ranges, noise, shapeAt, profile, frequency, elevation, relief: mainland?.relief ?? 1 };
  const baseStart = performance.now();
  const accelerated = useGPU ? await buildBaseTerrainGPU(input) : null;
  const { h, sMap } = accelerated ?? buildBaseTerrainCPU(input);
  const terrainBackend = accelerated ? 'webgpu' : 'cpu', terrainSeconds = (performance.now() - baseStart) / 1000;
  const terrainComputeLabel = accelerated ? 'WebGPU' : useGPU ? 'CPU fallback' : 'CPU';

  // lake basins carved into valleys
  await status('2/10 Lake basins…');
  const lakeSites = [], gradMax = .1 * Math.max(1, ez / sc);
  for (let tries = 0; tries < 6000 && lakeSites.length < nLakes; tries++) {
    const x = (.1 + R() * .8) * (n - 1) | 0, y = (.1 + R() * .8) * (n - 1) | 0, i = y * n + x;
    if (sMap[i] < .12 || h[i] < 60 * ez || h[i] > 500 * ez) continue;
    if (Math.abs(h[i + 1] - h[i - 1]) / (2 * cell) > gradMax || Math.abs(h[i + n] - h[i - n]) / (2 * cell) > gradMax) continue;
    if (lakeSites.some(l => Math.hypot(l.x - x, l.y - y) * cell < M(9000))) continue;
    lakeSites.push({ x, y });
    const rad = M(1200 + R() * 2200), depth = (25 + R() * 45) * ez * (mainland ? .7 : 1), rc = Math.ceil(rad / cell);
    for (let yy = Math.max(0, y - rc); yy <= Math.min(n - 1, y + rc); yy++) for (let xx = Math.max(0, x - rc); xx <= Math.min(n - 1, x + rc); xx++) {
      const d = Math.hypot(xx - x, yy - y) * cell; if (d < rad) h[yy * n + xx] -= depth * sstep(0, 1, 1 - d / rad);
    }
  }

  // 2. hydrology: priority-flood fill, flow routing, accumulation -------
  await status('3/10 Rivers & lakes…');
  const { fl, flow, order, oc } = priorityFlood(h, n);
  const acc = new Float32Array(N2);                              // catchment, km² (rain-weighted)
  for (let i = 0; i < N2; i++) acc[i] = h[i] > 0 ? cellKm2 * (1 + h[i] / (2500 * ez)) : 0;
  for (let k = oc - 1; k >= 0; k--) { const c = order[k], p = flow[c]; if (p >= 0) acc[p] += acc[c]; }

  // water classification from a filled surface: ocean = drains to the map edge below sea level; a lake = every cell of a
  // closed basin lying below that basin's spill level (so its water level is exactly where it would overflow)
  const ocean = new Uint8Array(N2), lakeId = new Uint16Array(N2), lakes = [], land = new Uint8Array(N2);
  const lakeAreaMin = (mainland ? 8 : 2.5) * sc * sc, lakeDepthMin = (mainland ? 12 : 6) * ez;
  const classifyWater = fl => {
    lakeId.fill(0); lakes.length = 0;
    for (let i = 0; i < N2; i++) ocean[i] = fl[i] <= 0 ? 1 : 0;
    const vis = new Uint8Array(N2), wet = i => fl[i] - h[i] > .05;
    for (let s0 = 0; s0 < N2; s0++) {
      if (ocean[s0] || vis[s0] || !wet(s0)) continue;
      const comp = [s0]; vis[s0] = 1; let lvl = 0, dep = 0, sx2 = 0, sy2 = 0;
      for (let q = 0; q < comp.length; q++) {
        const c = comp[q], x = c % n; lvl = Math.max(lvl, fl[c]); dep = Math.max(dep, fl[c] - h[c]); sx2 += x; sy2 += c / n | 0;
        for (const nb of [x > 0 ? c - 1 : -1, x < n - 1 ? c + 1 : -1, c - n, c + n]) {
          if (nb < 0 || nb >= N2 || vis[nb] || ocean[nb] || !wet(nb)) continue; vis[nb] = 1; comp.push(nb);
        }
      }
      if (comp.length * cellKm2 >= lakeAreaMin && dep >= lakeDepthMin) {
        const id = lakes.length + 1; for (const c of comp) lakeId[c] = id;
        lakes.push({ id, cells: comp, area: comp.length * cellKm2, level: lvl, depth: dep, x: sx2 / comp.length, y: sy2 / comp.length });
      }
    }
    for (let i = 0; i < N2; i++) land[i] = !ocean[i] && !lakeId[i] ? 1 : 0;
  };
  classifyWater(fl);
  // erosion detail: every flow line is carved a little, deeper with catchment → dendritic gullies
  // (only real drainage lines; hillslope sheet-flow cells would carve parallel D8 stripes), softened by a 1-cell blur
  const aT = Math.max(sc * sc * .05, cellKm2 * 12), ero = new Float32Array(N2), erosion = terrainSettings.erosion / .3;
  for (let i = 0; i < N2; i++) if (land[i] && acc[i] > aT) ero[i] = ez * Math.min(20, 3 * Math.log2(acc[i] / aT)) * erosion;
  const eroB = blur(ero, n, 1);
  for (let i = 0; i < N2; i++) if (land[i]) h[i] = Math.max(Math.min(h[i], .5), h[i] - Math.max(eroB[i], ero[i] * .6));

  // reality rule: water is re-solved on the eroded surface BEFORE rivers are traced. Lakes = closed basins filled exactly
  // to their spill level; every hollow too small to be a lake is filled, so all water reaches the sea or a lake.
  const reality = { pitsFilled: 0, viaducts: 0, tunnels: 0, culverts: 0 };
  {
    const r2 = priorityFlood(h, n); classifyWater(r2.fl);
    for (let i = 0; i < N2; i++) if (!ocean[i] && !lakeId[i] && r2.fl[i] > h[i]) { h[i] = r2.fl[i]; reality.pitsFilled++; }
    flow.set(r2.flow); acc.fill(0);                               // drainage + catchment on the final water surface
    for (let i = 0; i < N2; i++) acc[i] = h[i] > 0 ? cellKm2 * (1 + h[i] / (2500 * ez)) : 0;
    for (let k = r2.oc - 1; k >= 0; k--) { const c = r2.order[k], p = flow[c]; if (p >= 0) acc[p] += acc[c]; }
  }
  // lake rims: river banks and road cuts may never lower ground beside a lake below its water level (it would drain)
  const rimL = new Float32Array(N2).fill(-Infinity);
  for (const l of lakes) for (const c of l.cells) {
    const x = c % n, y = c / n | 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue; const j = yy * n + xx; if (!lakeId[j] && h[j] >= l.level && rimL[j] < l.level) rimL[j] = l.level; }   // only ground that forms the rim
  }
  const T = 8 / dens * sc * sc, riv = new Uint8Array(N2);         // 1 stream, 2 river, 3 major river
  for (let i = 0; i < N2; i++) if (land[i] && acc[i] >= T) riv[i] = acc[i] >= 35 * T ? 3 : acc[i] >= 6 * T ? 2 : 1;

  // river polylines: trace head → mouth/junction, meander through a shared warp field (so junctions stay joined),
  // smooth (Chaikin), then carve the curved channel into the heightmap so terrain matches the drawn river
  const up = new Uint8Array(N2), traced = new Uint8Array(N2), rivers = [];
  for (let i = 0; i < N2; i++) if (riv[i] && flow[i] >= 0 && riv[flow[i]]) up[flow[i]] = 1;
  const depthOf = a => Math.min(30, 3 + 4 * Math.log2(Math.max(1, a / T))) * ez, widthOf = a => 2 + 2.5 * Math.sqrt(a);   // metres
  const MF = 1 / 18;
  for (let s0 = 0; s0 < N2; s0++) {
    if (!riv[s0] || up[s0]) continue;
    let p = [], c = s0, bed = Infinity, exitsMap = false;
    for (;;) {
      const x = c % n, y = c / n | 0, a = acc[c];
      exitsMap = !!mainland && flow[c] < 0 && !!land[c];
      const grad = x > 0 && x < n - 1 && y > 0 && y < n - 1 ? (Math.abs(h[c + 1] - h[c - 1]) + Math.abs(h[c + n] - h[c - n])) / (2 * cell) : 1;
      const amp = Math.min(6, 2 + Math.sqrt(a / T) * .4) / (1 + grad * 6);     // lowland rivers meander, mountain streams stay tight
      bed = Math.min(bed, riv[c] ? Math.max(h[c] - depthOf(a), rimL[c]) : h[c]);   // at a lake outlet the bed sits at the lake's spill level
      // reality rule: a meander may only bend across ground no higher than the valley floor it belongs to (never onto a bank or rim)
      const ox = amp * (noise(x * MF + 300, y * MF + 300) + .4 * noise(x * MF * 3 + 50, y * MF * 3 + 50)), oy = amp * (noise(x * MF + 700, y * MF + 700) + .4 * noise(x * MF * 3 + 90, y * MF * 3 + 90));
      let s = 0; if (!exitsMap) for (const t of [1, .6, .3]) { const xi = Math.round(x + ox * t), yi = Math.round(y + oy * t); if (xi >= 0 && yi >= 0 && xi < n && yi < n && h[yi * n + xi] <= h[c] + .5 && !(rimL[yi * n + xi] > h[c])) { s = t; break; } }
      p.push([x + ox * s, y + oy * s, a, bed, c]);
      if (traced[c] || !riv[c]) break;
      traced[c] = 1; c = flow[c]; if (c < 0) break;
    }
    if (p.length < 2) continue;
    // beds must never rise downstream; a lake-level clamp near the mouth lifts the reach above it (no hidden basins)
    for (let j = p.length - 2; j >= 0; j--) p[j][3] = Math.max(p[j][3], p[j + 1][3]);
    const endCell = p[p.length - 1][4];
    for (let it = 0; it < 3; it++) {
      const q = [p[0]];
      for (let j = 0; j < p.length - 1; j++) { const p0 = p[j], p1 = p[j + 1]; q.push(p0.map((v, k) => v * .75 + p1[k] * .25), p0.map((v, k) => v * .25 + p1[k] * .75)); }
      q.push(p[p.length - 1]); p = q;
    }
    // the drawn (meandered) channel must run downhill too: dig it to the lowest ground met so far upstream
    // (lakes count at their water surface, the sea at 0 — never dig below those)
    let lowT = Infinity;
    for (const q of p) {
      const xi = Math.round(q[0]), yi = Math.round(q[1]); if (xi < 1 || yi < 1 || xi >= n - 1 || yi >= n - 1) continue;
      let m = Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = (yi + dy) * n + xi + dx; m = Math.min(m, lakeId[i] ? lakes[lakeId[i] - 1].level : ocean[i] ? 0 : h[i]); }
      lowT = Math.min(lowT, m); q[3] = Math.min(q[3], lowT - .2);
    }
    if (exitsMap) {
      p.at(-1)[3] = Math.min(p.at(-1)[3], p.at(-2)[3]);
      p.exitsMap = true;
    }
    p.end = endCell; rivers.push(p);
  }
  // river landforms (optional, they reshape terrain): distributary deltas where a major river meets the sea on a low
  // coastal plain, then flat floodplains along gently falling lowland reaches. Both run before the channels are carved.
  const floodM = new Uint8Array(N2); let deltaCount = 0, floodCells = 0;
  if (landforms) {
    for (const p of rivers.slice()) {
      const L = p.length, mouth = p[L - 1]; if (L < 8 || p.exitsMap || !ocean[p.end] || mouth[2] < 35 * T) continue;
      const reach = clamp(widthOf(mouth[2]) * 25, Math.max(600, 6 * cell), 3000) / cell;     // apex distance from the mouth, cells
      let k = L - 1; while (k > 0 && Math.hypot(p[k][0] - mouth[0], p[k][1] - mouth[1]) < reach) k--;
      const apex = p[k], ax = Math.round(apex[0]), ay = Math.round(apex[1]); if (k >= L - 3 || h[ay * n + ax] > 25 * ez) continue;   // deltas need a low plain
      const dx = mouth[0] - apex[0], dy = mouth[1] - apex[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, a = mouth[2] * .3;
      let made = 0;
      for (const turn of [-.55, .55]) {                                 // one distributary ~30° to each side of the main channel
        const c = Math.cos(turn), sn = Math.sin(turn), vx = ux * c - uy * sn, vy = ux * sn + uy * c, pts = [];
        let endCell = -1;
        for (let t = 0; t <= reach * 2.2; t += .5) {
          const bend = Math.sin(Math.min(1, t / (reach * 2)) * Math.PI) * reach * .15 * Math.sign(turn);   // gentle outward bow
          const x = apex[0] + vx * t - vy * bend, y = apex[1] + vy * t + vx * bend, xi = Math.round(x), yi = Math.round(y);
          if (xi < 1 || yi < 1 || xi >= n - 1 || yi >= n - 1) break;
          const i = yi * n + xi; pts.push([x, y]);
          if (ocean[i]) { endCell = i; break; }
          if (lakeId[i] || h[i] > apex[3] + Math.max(3, 8 * ez)) break;   // stays on low ground
        }
        if (endCell < 0 || pts.length < 4) continue;
        let bed = apex[3];                                               // falls from the apex bed to just below sea level, never above the ground
        const q = pts.map(([x, y], j) => { const i = Math.round(y) * n + Math.round(x); bed = Math.min(bed, lerp(apex[3], -1, j / (pts.length - 1)), ocean[i] ? -1 : h[i] - .5); return [x, y, a, Math.max(-3, bed), i]; });
        q.end = endCell; q.distributary = true; rivers.push(q); made++;
      }
      if (made) deltaCount++;
    }
    for (const p of rivers) for (let j = 0; j < p.length - 1; j++) {
      const [x0, y0, a, b0] = p[j], [x1, y1, , b1] = p[j + 1]; if (a < 6 * T) continue;
      if ((b0 - b1) / ((Math.hypot(x1 - x0, y1 - y0) || 1) * cell) > .02) continue;        // lowland reaches only (under 2% fall)
      const W = clamp(widthOf(a) * 15, 3 * cell, 1500) / cell, Wc = Math.ceil(W), sx = x1 - x0, sy = y1 - y0, wall = Math.max(8, 20 * ez);
      for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - Wc)); y <= Math.min(n - 1, Math.ceil(Math.max(y0, y1) + Wc)); y++)
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - Wc)); x <= Math.min(n - 1, Math.ceil(Math.max(x0, x1) + Wc)); x++) {
          const i = y * n + x; if (ocean[i] || lakeId[i]) continue;
          const t = clamp(((x - x0) * sx + (y - y0) * sy) / (sx * sx + sy * sy || 1), 0, 1), d = Math.hypot(x - x0 - t * sx, y - y0 - t * sy); if (d >= W) continue;
          const target = Math.max(lerp(b0, b1, t) + 1.5 + 2 * d / W, rimL[i], .6);
          if (h[i] <= target || h[i] > target + wall) continue;         // already low, or a valley wall / terrace: leave it
          const nh = lerp(h[i], target, 1 - sstep(.6, 1, d / W));
          if (nh < h[i]) { h[i] = nh; if (!floodM[i]) { floodM[i] = 1; floodCells++; } }
        }
    }
  }
  reality.deltas = deltaCount; reality.floodplainKm2 = floodCells * cellKm2;
  const chanM = new Uint8Array(N2);                               // the carved (meandered) channel: roads must bridge it, never fill it
  carveRivers(h, n, cell, rivers, 1, widthOf, depthOf, i => rimL[i], chanM, { openEdge: !!mainland });
  if (landforms) for (let i = 0; i < N2; i++) if (chanM[i] && floodM[i]) { floodM[i] = 0; floodCells--; }   // the floodplain is the land beside the channel
  reality.floodplainKm2 = floodCells * cellKm2;
  // channels follow the drainage so they never create a basin; fill any interpolation hollows they left
  { const r3 = priorityFlood(h, n); for (let i = 0; i < N2; i++) if (land[i] && r3.fl[i] > h[i]) { h[i] = r3.fl[i]; reality.pitsFilled++; } }

  // derived rasters ------------------------------------------------------
  await status('4/10 Slopes, biomes, shading…');
  const slope = new Float32Array(N2), shade = new Float32Array(N2).fill(1);
  const deriveSlope = () => {
    const margin = mainland ? 0 : 1;
    for (let y = margin; y < n - margin; y++) for (let x = margin; x < n - margin; x++) {
      const i = y * n + x, left = x > 0 ? 1 : 0, right = x < n - 1 ? 1 : 0, up = y > 0 ? 1 : 0, down = y < n - 1 ? 1 : 0;
      const gx = (h[i + right] - h[i - left]) / ((left + right) * cell), gy = (h[i + down * n] - h[i - up * n]) / ((up + down) * cell);
      slope[i] = Math.atan(Math.hypot(gx, gy)) * 57.2958;
      const ex = 4 * gx * sc / ez, ey = 4 * gy * sc / ez;          // shading exaggeration (display only) tuned per footprint
      if (land[i]) shade[i] = (.593 * ex + .593 * ey + .544) / Math.sqrt(1 + ex * ex + ey * ey) / .544;
    }
  };
  deriveSlope();
  const waterM = new Uint8Array(N2), lakeM = new Uint8Array(N2);
  for (let i = 0; i < N2; i++) { waterM[i] = !land[i] || riv[i] >= 2 ? 1 : 0; lakeM[i] = lakeId[i] ? 1 : 0; }
  const dW = chamfer(n, cell, waterM), dO = chamfer(n, cell, ocean), dL = chamfer(n, cell, lakeM);
  // 0 ocean 1 beach 2 plains 3 forest 4 highland 5 alpine 6 snow 7 wetland 8 lake 9 farmland
  const biome = new Uint8Array(N2), moist = new Float32Array(N2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; if (ocean[i]) continue; if (lakeId[i]) { biome[i] = 8; moist[i] = 1; continue; }
    const u = x / (n - 1), v = y / (n - 1), sl = slope[i];
    const m = moist[i] = clamp(.5 + .55 * F(u * 4 + 60, v * 4 + 60, 4) + .3 * Math.exp(-dW[i] / M(2500)) - h[i] / (5000 * ez), 0, 1);
    // beaches only on gentle shores, never on cliffs
    biome[i] = h[i] < 8 && dO[i] < 2.5 * cell && sl < 12 ? 1 : h[i] > snowM ? 6 : h[i] > 1300 * ez || sl > 34 ? 5 : h[i] > 700 * ez || sl > 24 ? 4
      : h[i] < 60 * ez && sl < 2 && dW[i] < M(500) && m > .6 ? 7 : m > .5 ? 3 : 2;
  }
  const flatArr = new Float32Array(N2), forArr = new Float32Array(N2), mtnArr = new Float32Array(N2), ocnArr = new Float32Array(N2);
  for (let i = 0; i < N2; i++) { flatArr[i] = land[i] && slope[i] < 4 ? 1 : 0; forArr[i] = biome[i] === 3 ? 1 : 0; mtnArr[i] = h[i] > 700 * ez ? 1 : 0; ocnArr[i] = ocean[i]; }
  const bl = {}, B = (name, arr, m) => bl[name + m] ??= blur(arr, n, Math.max(1, Math.round(m / cell)));
  const flatB = m => B('f', flatArr, m), forB = m => B('o', forArr, m), mtnB = m => B('m', mtnArr, m), ocnB = m => B('c', ocnArr, m);

  // 3. settlements -------------------------------------------------------
  await status('5/10 Settlements, farms, start region…');
  const used = new Set(), nm = () => { let s; do { s = cap(pick(SYL)) + (R() < .5 ? pick(SYL) : '') + pick(SUF); } while (used.has(s)); used.add(s); return s; };
  const short = () => cap(pick(SYL)) + pick(SYL);
  let alpha = 0;
  const NAME = {
    city: nm, town: nm, village: nm, farm: () => short() + ' Farm', safehouse: () => short() + ' Farm (safehouse)',
    harbor: () => 'Port ' + nm(), airport: () => nm() + ' Airport', airstrip: () => short() + ' Airstrip', airfield: () => short() + ' Military Airfield',
    military: () => 'Fort ' + short(), radar: () => short() + ' Radar Station', research: () => nm() + ' Research Lab', outpost: () => short() + ' Research Outpost',
    industrial: () => nm() + ' Works', mine: () => short() + ' Quarry', peak: () => 'Mt ' + short(), radio: () => short() + ' Radio Mast',
    cabin: () => short() + ' Cabin', fuel: () => short() + ' Fuel', warehouse: () => short() + ' Depot', survivors: () => short() + ' Holdout',
    dam: () => short() + ' Dam', seed: () => 'Seed Engine ' + GREEK[alpha++ % 6], pass: () => short() + ' Pass', bridge: () => '',
    cityhall: () => 'City Hall', hospital: () => short() + ' General Hospital', mall: () => short() + ' Mall', police: () => 'Police', fire: () => 'Fire Station',
    school: () => 'School', church: () => 'St ' + cap(pick(SYL)) + "'s Church", stadium: () => short() + ' Stadium', busdepot: () => 'Bus Depot',
    tunnel: () => 'Metro Tunnel ' + (++tun), excavation: () => 'Excavation Site', power: () => short() + ' Power Station', water: () => 'Water Treatment',
    clinic: () => 'Clinic', store: () => 'General Store', trader: () => short() + ' Trading Post', lighthouse: () => short() + ' Lighthouse',
    shipwreck: () => 'Wreck of the ' + short(), dock: () => short() + ' Pier', beach: () => short() + ' Beach', bunker: () => 'Bunker ' + short(),
    lookout: () => short() + ' Fire Lookout', comms: () => short() + ' Comms Tower', ranger: () => short() + ' Ranger Station', campsite: () => short() + ' Campground',
    cave: () => short() + ' Cave', logging: () => short() + ' Logging Camp', hut: () => short() + ' Mountain Hut', crash: () => 'Crash Site ' + short(),
    checkpoint: () => 'Checkpoint ' + short(), motel: () => short() + ' Motel', substation: () => short() + ' Substation', windfarm: () => short() + ' Wind Farm',
    stone: () => short() + ' Stone Outcrop', iron: () => short() + ' Iron Deposit', copper: () => short() + ' Copper Deposit', silver: () => short() + ' Silver Vein',
    gold: () => short() + ' Placer Gold', titanium: () => short() + ' Titanium Sands', diamond: () => short() + ' Diamond Pipe', uranium: () => short() + ' Uranium Deposit',
    coal: () => short() + ' Coal Seam', salt: () => short() + ' Salt Pans', spring: () => short() + ' Spring', fishing: () => short() + ' Fishing Spot',
    hunting: () => short() + ' Hunting Stand', claypit: () => short() + ' Clay Pit',
    raiders: () => short() + ' Raider Camp', secret: () => 'Project Desolation Site', weather: () => short() + ' Weather Station', nest: () => 'Alien Nest', sporefield: () => 'Spore Field'
  };
  Object.assign(NAME, {
    pub: () => 'The ' + pick(['Red Lion', 'Crown', 'Anchor', 'Plough', 'Black Horse', 'Old Mill', 'Fox & Hound', 'Rose', 'Swan', 'Bell', 'Lamb', 'Ship']),
    diner: () => cap(pick(SYL)) + "'s Diner", pharmacy: () => 'Pharmacy', hardware: () => 'Hardware', postoffice: () => 'Post Office', townhall: () => 'Town Hall',
    library: () => 'Library', bank: () => short() + ' Bank', garage: () => cap(pick(SYL)) + "'s Garage", park: () => short() + ' Park', cemetery: () => short() + ' Cemetery',
    watertower: () => 'Water Tower', silo: () => 'Grain Silos', hall: () => 'Community Hall',
    portal: () => short() + ' Tunnel Portal', viaduct: () => short() + ' Viaduct',
    seastack: () => short() + ' Stack', rig: () => short() + ' Offshore Platform', pickup: () => 'Pickup Truck (repairable)',
    vehicle: () => pick(['Abandoned Sedan', 'Burnt-out Truck', 'Crashed Van', 'Abandoned Bus', 'Military Truck', 'Police Cruiser', 'Overturned Tanker'])
  });
  let tun = 0; const PREFIX = ['police', 'clinic', 'store', 'school', 'busdepot', 'water', 'pharmacy', 'hardware', 'postoffice', 'townhall', 'library', 'watertower', 'hall', 'silo'];
  const pois = [];
  const P = (type, i, extra) => { const p = { type, i, x: i % n, y: i / n | 0, h: h[i], name: NAME[type](), ...extra }; pois.push(p); return p; };
  const dk = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * cell / 1000;
  const nearKm = (x, y, types) => { let m = Infinity; for (const p of pois) if (!types || types.includes(p.type)) m = Math.min(m, Math.hypot(p.x - x, p.y - y) * cell / 1000); return m; };
  const ctr = (x, y) => 1 - Math.hypot(x / n - .5, y / n - .5) * 2;
  const stride = Math.max(1, Math.round(n / 250)), NEG = -Infinity, reach = new Uint8Array(N2).fill(1);
  function place(type, count, score, min = 0, avoid = null, st = stride, anyCell = false) {
    const out = [];
    for (let k = 0; k < count; k++) {
      let best = NEG, bi = -1;
      for (let y = st; y < n - st; y += st) for (let x = st; x < n - st; x += st) {
        const i = y * n + x; if ((!land[i] || !reach[i]) && !anyCell) continue;
        const s = score(i, x, y) + R() * .3; if (!(s > best)) continue;
        let ok = true;
        for (const p of pois) if ((!avoid || avoid.includes(p.type)) && Math.hypot(p.x - x, p.y - y) * cell / 1000 < min) { ok = false; break; }
        if (ok) { best = s; bi = i; }
      }
      if (bi < 0) break; out.push(P(type, bi));
    }
    return out;
  }
  const SET = { city: [Math.max(M(3000), 1100), 90], town: [Math.max(M(1200), 420), 70], village: [Math.max(M(450), 170), 45] };
  const developable = Float32Array.from(land, (dry, i) => dry && !chanM[i] && h[i] >= 2 ? 1 - sstep(5, 18, slope[i]) : 0);
  const cityGround = B('developable', developable, SET.city[0]), townGround = B('developable', developable, SET.town[0]);
  const city = place('city', 1, (i, x, y) => h[i] < 4 || h[i] > 200 * ez || slope[i] > 4 || chanM[i] ? NEG :
    cityGround[i] * 9 + Math.exp(-dW[i] / M(3000)) * .75 + (dO[i] < M(3000) ? .45 : 0) + ctr(x, y) * .6)[0];
  const dcity = (x, y) => city ? Math.hypot(x - city.x, y - city.y) * cell / 1000 : 0;
  // reality rule: everything placed from here on must stand on ground connected to the city without crossing a cliff (> 48°),
  // so no site ends up in a pocket no road or path could ever reach
  if (city) {
    reach.fill(0); const st = [city.i]; reach[city.i] = 1;
    while (st.length) { const c = st.pop(), x = c % n, y = c / n | 0;
      for (let d = 0; d < 8; d++) { const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue; const ni = ny * n + nx; if (reach[ni] || !land[ni] || slope[ni] > 48) continue; reach[ni] = 1; st.push(ni); } }
  }
  place('town', cnt(2 + 4 * sq), (i, x, y) => h[i] < 2 || h[i] > 350 * ez || slope[i] > 5 || chanM[i] ? NEG : townGround[i] * 6 + Math.exp(-dW[i] / M(2500)) * .6 + ctr(x, y) * .5, M(13));
  place('village', cnt(5 + 11 * sq), (i, x, y) => h[i] > 800 * ez || slope[i] > 8 ? NEG : flatB(M(900))[i] * 2 + Math.exp(-dW[i] / M(2000)) + forB(M(2000))[i] * .5, M(5));
  // rural belt: farms near villages/towns, farmland around them
  place('farm', cnt(6 + 12 * sq), (i, x, y) => biome[i] !== 2 && biome[i] !== 3 || slope[i] > 6 ? NEG :
    flatB(M(800))[i] * 2 + Math.exp(-dW[i] / M(1500)) - nearKm(x, y, ['village', 'town']) / M(4), M(2));
  const sitePrep = new Uint8Array(N2);   // town ground levelled like a field plot (building sites), but not farmed
  // farmland: the gentle ground around farms, villages and towns has been cleared and farmed (woodlots and wet ground kept)
  {
    const src = new Uint8Array(N2); for (const p of pois) if (['farm', 'village', 'town', 'city'].includes(p.type)) src[p.i] = 1;
    const dF = chamfer(n, cell, src); let before = 0, n9 = 0;
    // settlements are built up, not farmed: keep fields outside the largest footprint each settlement can take (its final
    // radius is chosen later), plus a garden/verge margin
    const townM = new Uint8Array(N2); sitePrep.fill(0);
    for (const p of pois) { const c = SET[p.type]; if (!c) continue;
      const r = (c[0] * 1.15 + Math.max(60, cell)) / cell, rc = Math.ceil(r);
      for (let y = Math.max(0, p.y - rc); y <= Math.min(n - 1, p.y + rc); y++) for (let x = Math.max(0, p.x - rc); x <= Math.min(n - 1, p.x + rc); x++) if (Math.hypot(x - p.x, y - p.y) <= r) townM[y * n + x] = 1; }
    for (let i = 0; i < N2; i++) {
      const x = i % n, y = i / n | 0, b = biome[i];
      const FR = Math.max(M(2600), 1200);                                                          // fields reach ~1.2 km+ from farmsteads (real distance)
      if (!land[i] || riv[i] || chanM[i] || slope[i] >= 9 || h[i] > 350 * ez || dF[i] > FR) continue;
      const near = 1 - dF[i] / FR;                                                                 // the closer to a farm, the more of it is cleared
      if (b === 2 || (b === 3 && noise(x * .06 + 71, y * .06 + 71) + near * .6 > .15)) { if (townM[i]) { sitePrep[i] = 1; biome[i] = 2; continue; } biome[i] = 9; before += slope[i] < 2 ? 1 : 0; n9++; }
    }
    reality.farmKm2 = n9 * cellKm2; reality.farmSlopeBefore = n9 ? before / n9 : 0;   // share of field area under 2° before levelling
    for (let i = 0; i < N2; i++) forArr[i] = biome[i] === 3 ? 1 : 0;
    for (const key of Object.keys(bl)) if (key[0] === 'o') delete bl[key];                     // forest blurs are stale now
  }
  // farmland grading: every field plot (the same patchwork the map draws) is levelled to a near-flat plane — at most 1.5°,
  // what farm machinery works — so fields step gently down a hillside with soft banks between plots (terraces on steeper
  // ground). Rivers, drainage lines (field ditches) and lake shores are left alone; field edges feather into the ground.
  {
    const fm = new Float32Array(N2);
    for (let i = 0; i < N2; i++) fm[i] = (biome[i] === 9 || sitePrep[i]) && !riv[i] && !chanM[i] && acc[i] < aT && !(rimL[i] > -Infinity) ? 1 : 0;
    const fsz = Math.max(160, cell * 3) / cell, fc = Math.cos(.5), fsn = Math.sin(.5), MAXT = Math.tan(1.5 / 57.3);
    const plot = i => { const x = i % n, y = i / n | 0; return Math.floor((x * fc + y * fsn) / fsz) * 100003 + Math.floor((y * fc - x * fsn) / fsz); };
    const P2 = new Map();                                                                         // per plot: least-squares plane of the ground
    for (let i = 0; i < N2; i++) if (fm[i]) { const k = plot(i), x = i % n, y = i / n | 0; let a = P2.get(k); if (!a) P2.set(k, a = [0, 0, 0, 0, 0, 0, 0, 0]);
      a[0]++; a[1] += x; a[2] += y; a[3] += h[i]; a[4] += x * x; a[5] += y * y; a[6] += x * h[i]; a[7] += y * h[i]; }
    const PL = new Map(); let terraced = 0;
    for (const [k, a] of P2) {
      const c = a[0], mx = a[1] / c, my = a[2] / c, mh = a[3] / c, vx = a[4] / c - mx * mx, vy = a[5] / c - my * my;
      let gx = vx > .01 ? (a[6] / c - mx * mh) / vx / cell : 0, gy = vy > .01 ? (a[7] / c - my * mh) / vy / cell : 0;   // m per m
      const tg = Math.hypot(gx, gy); if (tg > MAXT) { gx *= MAXT / tg; gy *= MAXT / tg; } if (tg > Math.tan(4 / 57.3)) terraced += c;
      PL.set(k, [mx, my, mh, gx, gy]);
    }
    const tgt = new Float32Array(h);
    for (let i = 0; i < N2; i++) if (fm[i]) { const [mx, my, mh, gx, gy] = PL.get(plot(i)); tgt[i] = Math.max(.5, mh + ((i % n) - mx) * cell * gx + ((i / n | 0) - my) * cell * gy); }
    const soft = blur(tgt, n, 1), wB = blur(fm, n, Math.max(1, Math.round(30 / cell)));             // soft banks between plots, feathered edges
    for (let i = 0; i < N2; i++) if (fm[i]) h[i] = lerp(h[i], soft[i] * .15 + tgt[i] * .85, clamp(wB[i] * 1.6, 0, 1));   // narrow banks, mostly level plots
    reality.farmTerracedKm2 = terraced * cellKm2;
    // shaping can leave hollows: fill them so every field drains to a ditch or stream
    const rf = priorityFlood(h, n); for (let i = 0; i < N2; i++) if (land[i] && rf.fl[i] > h[i]) { h[i] = rf.fl[i]; reality.pitsFilled++; }
    deriveSlope();
    for (let i = 0; i < N2; i++) flatArr[i] = land[i] && slope[i] < 4 ? 1 : 0;
    for (const key of Object.keys(bl)) if (key[0] === 'f') delete bl[key];
    let after = 0, c9 = 0; for (let i = 0; i < N2; i++) if (biome[i] === 9) { after += slope[i] < 2 ? 1 : 0; c9++; } reality.farmSlopeAfter = c9 ? after / c9 : 0;   // share of field area under 2°
  }
  const farmArr = new Float32Array(N2); for (let i = 0; i < N2; i++) farmArr[i] = biome[i] === 9 || biome[i] === 2 ? 1 : 0;

  // start region (docs): small town + forest + farm + alien seed site, holding the vertical-slice chapter
  let start = null, bs = NEG;
  for (const p of pois) if (p.type === 'town') {
    const i = p.i, s = forB(M(3000))[i] * 3 + B('a', farmArr, M(2000))[i] * 2 + (dW[i] < M(1500) ? 1 : 0) + (dO[i] < M(5000) ? .5 : 0) - (city ? Math.abs(dk(p, city) - M(25)) / M(25) : 0);
    if (s > bs) { bs = s; start = p; }
  }
  if (!start) start = pois.find(p => p.type === 'village') || city;
  const ds = (x, y) => start ? Math.hypot(x - start.x, y - start.y) * cell / 1000 : 99;     // km
  const dsm = (x, y) => ds(x, y) * 1000;
  let slice = null, safe = null;
  if (start) {
    start.start = true;
    // chapter chain: farm safehouse → town → broadcast (radio mast) → research outpost → seeding installation
    const ring = (a, b) => (x, y) => { const d = dsm(x, y); return d >= a && d <= b; };
    const sh = safe = place('safehouse', 1, (i, x, y) => !ring(300, 800)(x, y) || slope[i] > 8 ? NEG : (biome[i] === 9 || biome[i] === 2 ? 2 : 0) + forB(400)[i], .25, null, 1)[0];
    place('radio', 1, (i, x, y) => !ring(250, 900)(x, y) ? NEG : h[i] / (100 * ez), .3, null, 1);
    place('outpost', 1, (i, x, y) => !ring(450, 900)(x, y) || slope[i] > 15 ? NEG : 1 - Math.abs(forB(300)[i] - .5) * 2, .35, null, 1);
    if (story) {
      const s0 = place('seed', 1, (i, x, y) => !ring(550, 950)(x, y) ? NEG : forB(300)[i] + (sh ? Math.hypot(x - sh.x, y - sh.y) * cell / 1000 : 0), .5, null, 1)[0];
      if (s0) { s0.strength = .35; s0.name = 'Seeding Installation (slice)'; }
    }
    const dev = sh ? [(start.x + sh.x) / 2, (start.y + sh.y) / 2] : [start.x, start.y];
    slice = { cx: start.x, cy: start.y, size: SLICE_M, dev: { cx: dev[0], cy: dev[1], size: DEV_M } };
  }

  // 4. facilities ---------------------------------------------------------
  await status('6/10 Facilities & landmarks…');
  place('harbor', cnt(1 + 2 * sq), (i, x, y) => !(dO[i] <= cell * 1.5) || slope[i] > 6 ? NEG :
    flatB(M(1500))[i] * 2 + (1 - Math.abs(ocnB(M(4000))[i] - .35) * 3) - nearKm(x, y, ['city', 'town']) / M(15), M(18), ['harbor']);
  if (sc >= .3) {
    place('airport', 1, (i, x, y) => { const d = dcity(x, y); return h[i] > 250 || d < M(4) ? NEG : flatB(M(1800))[i] * 5 - Math.abs(d - M(12)) / M(10); }, M(4));
    place('airstrip', 1, (i, x, y) => h[i] > 500 || dcity(x, y) < M(15) ? NEG : flatB(M(1200))[i] * 3, M(10), ['airstrip', 'airport']);
  }
  place('industrial', cnt(1 + sq), (i, x, y) => h[i] > 150 * ez ? NEG : flatB(M(1500))[i] * 3 + (dO[i] < M(4000) ? 1 : 0) - Math.abs(dcity(x, y) - M(6)) / M(8), M(2.5));
  place('mine', cnt(1 + sq), (i, x, y) => h[i] < 250 * ez || h[i] > 1000 * ez || slope[i] > 22 ? NEG : mtnB(M(5000))[i] * 2 - dcity(x, y) / M(60), M(12));
  // military & scientific sites: base, radar, airfield, underground labs — kept away from the start
  const remote = (x, y, c, s) => dcity(x, y) < M(c) || ds(x, y) < M(s);
  place('military', 1, (i, x, y) => h[i] < 20 * ez || h[i] > 400 * ez || remote(x, y, 22, 20) ? NEG :
    flatB(M(1500))[i] * 2.5 + Math.min(dcity(x, y), M(45)) / M(45) * 2 + (dO[i] < M(3000) ? .5 : 0), M(8));
  place('airfield', 1, (i, x, y) => h[i] > 500 * ez || remote(x, y, 20, 15) ? NEG : flatB(Math.max(M(1500), 600))[i] * 4 + Math.exp(-nearKm(x, y, ['military']) / M(8)), M(6));
  place('radar', 1, (i, x, y) => slope[i] > 25 || remote(x, y, 20, 15) ? NEG : h[i] / (1000 * ez) - nearKm(x, y, ['military']) / M(40), M(6));
  place('research', cnt(1 + sq), (i, x, y) => h[i] < 250 * ez || h[i] > 1100 * ez || remote(x, y, 22, 12) ? NEG :
    flatB(M(900))[i] * 2 + Math.exp(-dW[i] / M(2500)) + mtnB(M(6000))[i] * 1.5, M(15));
  // woodlands: isolated cabins
  place('cabin', cnt(3 + 6 * sq), (i, x, y) => h[i] > 900 * ez || slope[i] > 18 || nearKm(x, y, ['city', 'town', 'village']) < M(3) ? NEG : forB(M(1500))[i] * 3, M(4));
  place('peak', 3, i => h[i] / 1000, M(10), ['peak']);
  // coast
  const dLand = chamfer(n, cell, land), beachArr = new Float32Array(N2); for (let i = 0; i < N2; i++) beachArr[i] = biome[i] === 1 ? 1 : 0;
  place('lighthouse', cnt(2 + 2 * sq), i => !(dO[i] <= cell * 1.5) ? NEG : ocnB(M(1500))[i] * 3 + Math.min(h[i] / (60 * ez), 1), M(6), ['lighthouse']);
  place('shipwreck', cnt(2 + sq), i => !ocean[i] || dLand[i] < 2 * cell || dLand[i] > Math.max(M(1500), 5 * cell) ? NEG : 0, M(5), ['shipwreck'], stride, true);
  // offshore silhouettes (Island_and_Biomes.md): sea stacks near the shore, one platform far out
  place('seastack', cnt(3 + 3 * sq), i => !ocean[i] || dLand[i] > 3 * cell || dLand[i] < cell ? NEG : 0, M(2), ['seastack'], stride, true);
  place('rig', 1, (i, x, y) => !ocean[i] || x < n * .04 || y < n * .04 || x > n * .96 || y > n * .96 ? NEG : dLand[i] / 1000, 0, ['rig'], stride, true);
  place('dock', cnt(2 + 3 * sq), (i, x, y) => !(dO[i] <= cell * 1.5) || slope[i] > 8 ? NEG : 2 - nearKm(x, y, ['village', 'town']) / M(3), M(3), ['dock', 'harbor']);
  place('beach', cnt(2 + 2 * sq), i => biome[i] !== 1 ? NEG : B('b', beachArr, M(700))[i] * 4, M(5), ['beach']);
  place('bunker', cnt(2 + sq), i => !(dO[i] < M(900)) || h[i] < 20 * ez || slope[i] > 30 ? NEG : h[i] / (300 * ez) + ocnB(M(1500))[i], M(7), ['bunker', 'military']);
  // wilderness
  place('lookout', cnt(2 + 2 * sq), i => forB(M(2000))[i] < .3 ? NEG : h[i] / (300 * ez) + forB(M(2000))[i], M(6), ['lookout', 'radio']);
  // hilltop installations need a buildable, reachable top (< 30°), not a cliff-ringed summit
  place('comms', cnt(2 + sq), i => slope[i] > 30 ? NEG : h[i] / (400 * ez), M(7), ['comms', 'radar', 'radio']);
  place('radio', 2, i => slope[i] > 30 ? NEG : h[i] / (500 * ez), M(10), ['radio']);
  place('ranger', cnt(1 + sq), i => slope[i] > 8 ? NEG : forB(M(1500))[i] * 2 + Math.exp(-dL[i] / M(800)), M(10), ['ranger']);
  place('campsite', cnt(3 + 3 * sq), i => slope[i] > 8 || !(dL[i] < M(700) || biome[i] === 1) ? NEG : forB(M(800))[i] + 1, M(4), ['campsite']);
  place('cave', cnt(3 + 4 * sq), i => slope[i] < 22 || slope[i] > 45 ? NEG : mtnB(M(2000))[i] + R(), M(4), ['cave']);
  place('logging', cnt(1 + sq), i => slope[i] > 10 ? NEG : forB(M(3000))[i] * 3, M(8), ['logging']);
  place('hut', 2, i => h[i] < 900 * ez || slope[i] > 20 ? NEG : h[i] / (1000 * ez), M(8), ['hut', 'peak']);
  place('crash', cnt(2 + sq), (i, x, y) => nearKm(x, y, ['city', 'town', 'village']) < M(5) ? NEG : forB(M(1500))[i] + R() * 2, M(10), ['crash']);
  place('windfarm', 1, i => slope[i] > 12 || h[i] < 50 * ez ? NEG : ocnB(M(3000))[i] * 2 + h[i] / (500 * ez), M(10));
  place('weather', 1, i => slope[i] > 30 ? NEG : h[i] / (1000 * ez), M(5), ['weather', 'peak']);
  // reservoir: the largest lake gets a dam at its outlet
  const big = lakes.slice().sort((a, b) => b.area - a.area)[0];
  for (const l of lakes) l.name = short() + ' Lake';
  if (big) {
    let out = -1; for (const c of big.cells) { const f = flow[c]; if (f >= 0 && !lakeId[f] && land[f] && (out < 0 || acc[f] > acc[out])) out = f; }
    // the outlet is often a gorge: the dam's access point is the nearest gentle, reachable ground beside it (the abutment)
    if (out >= 0) {
      let ab = -1, bd = Infinity; const ox = out % n, oy = out / n | 0, rr = Math.max(3, Math.round(200 / cell));
      for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const x = ox + dx, y = oy + dy; if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) continue; const i = y * n + x; const d = Math.hypot(dx, dy);
        if (land[i] && reach[i] && slope[i] < 30 && d < bd) { bd = d; ab = i; } }
      if (ab >= 0) { big.name = big.name.replace('Lake', 'Reservoir'); big.reservoir = true; P('dam', ab).name = big.name.replace(' Reservoir', '') + ' Dam'; }
    }
  }

  // alien seeding installations (docs: seed engines; strength drives spread)
  if (story) {
    const far = (x, y) => ds(x, y) < M(30);
    const SEEDS = [
      (i, x, y) => h[i] < 1100 * ez || far(x, y) ? NEG : h[i] / (1000 * ez) - nearKm(x, y, ['research']) / M(20),
      (i, x, y) => h[i] > 600 * ez || far(x, y) ? NEG : forB(M(5000))[i] * 3,
      (i, x, y) => !(dO[i] < cell * 2) || far(x, y) || dcity(x, y) < M(20) ? NEG : flatB(M(1500))[i],
      (i, x, y) => !(dL[i] < M(1500)) || far(x, y) ? NEG : 1 + flatB(M(1500))[i]
    ].slice(0, sc < .3 ? 3 : 4);
    for (const f of SEEDS) for (const p of place('seed', 1, f, M(14), ['seed'])) p.strength = 1;
    place('survivors', 2, (i, x, y) => nearKm(x, y, ['seed']) < M(9) || dcity(x, y) < M(10) || slope[i] > 10 ? NEG :
      flatB(M(600))[i] * 1.5 + Math.exp(-dW[i] / M(1500)) + Math.min(h[i] / (600 * ez), 1) + (dO[i] < M(2000) ? .5 : 0), M(12), ['survivors', 'city', 'town', 'seed']);
    place('raiders', 2, (i, x, y) => nearKm(x, y, ['city', 'town', 'village', 'survivors']) < M(6) ? NEG : forB(M(1500))[i] * 2 + R(), M(10), ['raiders']);
    place('secret', 1, (i, x, y) => h[i] < 600 * ez || nearKm(x, y, ['city', 'town', 'village', 'research', 'military']) < M(8) ? NEG : mtnB(M(4000))[i] * 2 + h[i] / (1500 * ez), M(3));
  }

  // settlement footprints + civic POIs inside the city and towns
  for (const p of pois) { const c = SET[p.type]; if (c) { p.radius = c[0] * (.85 + R() * .3); p.block = c[1]; p.angle = R() * Math.PI / 2; } }
  const minU = Math.max(100, cell * 1.2);
  function placeNear(type, p, r0, r1, score = () => 0) {
    const rc = Math.ceil(r1 / cell); let best = NEG, bi = -1;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const x = p.x + dx, y = p.y + dy; if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) continue;
      const d = Math.hypot(dx, dy) * cell; if (d < r0 || d > r1) continue;
      const i = y * n + x; if (!land[i] || !reach[i] || slope[i] > 12) continue;
      const s = score(i, x, y) + R(); if (!(s > best)) continue;
      if (pois.some(q => Math.hypot(q.x - x, q.y - y) * cell < minU)) continue;
      best = s; bi = i;
    }
    if (bi < 0) return null;
    const q = P(type, bi, { parent: p.name }); if (PREFIX.includes(type)) q.name = p.name + ' ' + q.name; return q;
  }
  if (city) {
    const Rc = city.radius, flatS = i => flatB(200)[i] * 2;
    for (const [t, a, b, f] of [['cityhall', 0, .15], ['hospital', .2, .7], ['mall', .3, .8, flatS], ['police', .1, .6], ['fire', .1, .6],
      ['school', .3, .9], ['school', .3, .9], ['church', .1, .7], ['stadium', .5, 1, flatS], ['busdepot', .4, .9], ['tunnel', .1, .5], ['tunnel', .3, .8], ['tunnel', .5, .9]])
      placeNear(t, city, a * Rc, b * Rc, f);
    if (story) placeNear('excavation', city, .6 * Rc, 1.3 * Rc);
    placeNear('power', city, 1.1 * Rc, 2.2 * Rc, i => (dO[i] < 600 ? 2 : 0) + Math.exp(-dW[i] / 500));
    placeNear('water', city, .9 * Rc, 2 * Rc, i => riv[i] >= 2 ? NEG : Math.exp(-dW[i] / 200) * 2);
    if (dO[city.i] < Rc * 1.5) placeNear('dock', city, 0, Rc * 1.3, i => dO[i] <= cell * 1.5 ? 3 : NEG);
  }
  // towns: a core set plus a random mix, so every town reads differently; edge uses (cemetery, water tower, silos) sit at the outskirts
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = R() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const EDGE = ['cemetery', 'watertower', 'silo', 'garage'];
  const civic = (ty, p) => EDGE.includes(ty) ? placeNear(ty, p, p.radius * .65, p.radius * 1.15) : placeNear(ty, p, 0, p.radius * (ty === 'townhall' || ty === 'park' ? .3 : .8));
  for (const t of pois.filter(p => p.type === 'town')) {
    for (const ty of ['townhall', 'clinic', 'store', 'church', 'police', 'fire', 'school', ...(t.radius >= 450 ? ['hospital'] : []), ...(t.start ? ['fuel'] : [])]) civic(ty, t);
    for (const ty of shuffle(['pub', 'diner', 'pharmacy', 'hardware', 'postoffice', 'library', 'bank', 'garage', 'park', 'cemetery', 'watertower', 'hall', 'fuel', 'pub', 'silo']).slice(0, 6 + (R() * 5 | 0))) civic(ty, t);
  }
  for (const v of pois.filter(p => p.type === 'village'))
    for (const ty of shuffle(['pub', 'store', 'church', 'postoffice', 'watertower', 'silo', 'garage', 'cemetery', 'hall']).slice(0, 2 + (R() * 3 | 0))) civic(ty, v);
  { const tt = pois.filter(p => p.type === 'town' && !p.start); if (tt.length) { const t = pick(tt); placeNear('trader', t, 0, t.radius); } }

  // 5. roads, barriers, corridors -------------------------------------
  await status('7/10 Road network…');
  const base = new Float32Array(N2), cost = new Float32Array(N2);
  // reality rule: nothing is routed across cliffs (> 48°); roads and trails go around
  for (let i = 0; i < N2; i++) base[i] = land[i] && slope[i] <= 48 ? 1 + (slope[i] / 8) ** 2 + h[i] / (1500 * ez) + [0, 2, 10, 30][riv[i]] : Infinity;
  // the carved (meandered) channel strays several cells from the drainage cells in riv[], so it needs its own penalty:
  // otherwise a valley road finds the free, flat river corridor and runs along (or on top of) the river instead of bridging it
  const chanList = []; for (let i = 0; i < N2; i++) if (chanM[i]) { chanList.push(i); base[i] += 20; }
  cost.set(base);
  const G = new Float32Array(N2), FROM = new Int32Array(N2), CL = new Uint8Array(N2);
  function astar(a, b, cst, H) {
    G.fill(Infinity); FROM.fill(-1); CL.fill(0);
    const bx = b % n, by = b / n | 0, q = heap(); G[a] = 0; q.push(0, a);
    while (q.size) {
      const c = q.pop(); if (CL[c]) continue; CL[c] = 1; if (c === b) break;
      const cx = c % n, cy = c / n | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx; if (CL[ni] || !(cst[ni] < 1e8)) continue;
        const g = G[c] + (DX[d] && DY[d] ? 1.4142 : 1) * (cst[c] + cst[ni]) / 2;
        if (g < G[ni]) { G[ni] = g; FROM[ni] = c; q.push(g + H * Math.hypot(bx - nx, by - ny), ni); }   // ponytail: weighted A*, slightly suboptimal routes
      }
    }
    if (!CL[b]) return null;
    const path = []; for (let c = b; c >= 0; c = FROM[c]) path.push(c); return path.reverse();
  }
  const smooth = p => {
    const o = []; for (let j = 0; j < p.length; j++) { let sx3 = 0, sy3 = 0, c = 0; for (let d = -3; d <= 3; d++) { const q = p[j + d]; if (q === undefined) continue; sx3 += q % n; sy3 += q / n | 0; c++; } o.push([sx3 / c, sy3 / c]); }
    o[0] = [p[0] % n, p[0] / n | 0]; const e = p[p.length - 1]; o[o.length - 1] = [e % n, e / n | 0]; return o;
  };
  const roads = [], F_ROAD = { highway: .2, road: .3, trail: .6 }, linked = new Set(), reached = new Set();
  const lkey = (a, b) => { const i = pois.indexOf(a), j = pois.indexOf(b); return Math.min(i, j) + '-' + Math.max(i, j); };
  const roadCell = new Uint8Array(N2);
  // grade-aware road router. Each step is costed by its real along-road grade, so a steep slope is crossed by winding
  // (switchbacks) rather than straight up. Highways and roads may also take a straight structure edge where winding would
  // be too long: a tunnel through a ridge/spur or a viaduct across a valley, each priced like construction.
  const GRADE_MAX = { highway: .08, road: .12, trail: 1 }, JT = new Uint8Array(N2);
  // structure options per road class: tunnels only on highways (≤ 600 m), viaducts ≤ 400 m (highway) / 150 m (road); priced like
  // real construction — a tunnel ~25× a normal road per metre plus portals, a viaduct ~12× — and never two structures back to
  // back, so winding wins unless a structure clearly pays off
  const JUMPS = { highway: [250, 400], road: [150] }, VIA_MAX = { highway: 300, road: 150 }, TUNNELS = { highway: true, road: false };
  for (const k in JUMPS) JUMPS[k] = JUMPS[k].map(m => [Math.max(3, Math.round(m / cell)), m]);
  function routeRoad(a, b, type, cst) {
    const g = GRADE_MAX[type], structures = type !== 'trail';
    G.fill(Infinity); FROM.fill(-1); CL.fill(0); JT.fill(0);
    const bx = b % n, by = b / n | 0, q = heap(); G[a] = 0; q.push(0, a);
    while (q.size) {
      const c = q.pop(); if (CL[c]) continue; CL[c] = 1; if (c === b) break;
      const cx = c % n, cy = c / n | 0, hc = h[c];
      const relax = (ni, gn, jt) => { if (gn < G[ni]) { G[ni] = gn; FROM[ni] = c; JT[ni] = jt; q.push(gn + .5 * Math.hypot(bx - ni % n, by - (ni / n | 0)), ni); } };
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx; if (CL[ni] || !(cst[ni] < 1e8)) continue;
        const sd = DX[d] && DY[d] ? 1.4142 : 1, gr = Math.abs(h[ni] - hc) / (sd * cell), ex = Math.max(0, gr - g) / g;
        if (gr > 1.19) continue;                                                      // no step steeper than 50° on any road or path
        relax(ni, G[c] + sd * (cst[c] + cst[ni]) / 2 * (1 + .3 * gr / g + 10 * ex * ex), 0);    // over-grade steps get expensive (grading absorbs short ones)
      }
      if (structures && slope[c] > 8 && !JT[c]) for (let d = 0; d < 8; d++) for (const [L, Lm] of JUMPS[type]) {   // no structure straight after another
        const nx = cx + DX[d] * L, ny = cy + DY[d] * L; if (nx < 1 || ny < 1 || nx >= n - 1 || ny >= n - 1) continue;
        const ni = ny * n + nx; if (CL[ni] || !(cst[ni] < 1e8)) continue;
        const sd = (DX[d] && DY[d] ? 1.4142 : 1) * L, he = h[ni]; if (Math.abs(he - hc) / (sd * cell) > g) continue;
        let above = -Infinity, below = Infinity, ok = true;
        for (let t = 1; t < L; t += Math.max(1, L >> 3)) {
          const i = (cy + DY[d] * t) * n + cx + DX[d] * t; if (!land[i] && !riv[i]) { ok = false; break; }
          const dz = h[i] - lerp(hc, he, t / L); above = Math.max(above, dz); below = Math.min(below, dz);
        }
        if (!ok) continue;
        // structures are a last resort: only through a real ridge / over a real gorge, and priced well above a detour
        if (TUNNELS[type] && below > -2 && above > 60) relax(ni, G[c] + sd * 40 + 800, 3);          // tunnel: the line stays inside the hill
        else if (above < 2 && below < -35 && Lm <= VIA_MAX[type]) relax(ni, G[c] + sd * 20 + 400, 2); // viaduct: the line stays above the valley
      }
    }
    if (!CL[b]) return null;
    const path = [], jd = [];
    for (let c = b; c >= 0; c = FROM[c]) {
      path.push(c); jd.push(0);
      const f = FROM[c];
      if (f >= 0 && JT[c]) {                                                     // fill in the cells under/over the structure
        const x0 = f % n, y0 = f / n | 0, x1 = c % n, y1 = c / n | 0, L = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let t = L - 1; t >= 1; t--) { path.push((y0 + Math.round((y1 - y0) * t / L)) * n + x0 + Math.round((x1 - x0) * t / L)); jd.push(JT[c]); }
      }
    }
    return { path: path.reverse(), jd: jd.reverse() };
  }
  // longest unbroken run of path cells lying in a river channel: a bridge crosses one (a few cells), a road along it does not
  // a run may be as long as a diagonal crossing of that river's carved corridor (width + marking margin, ×1.25 + slack); anything longer follows it
  const chanScan = path => { let run = 0, big = 0, best = 0, excess = 0;
    const close = () => { if (run) { best = Math.max(best, run); excess = Math.max(excess, run - Math.max(5, Math.ceil((widthOf(big) / cell + 2) * 1.25) + 1)); } run = big = 0; };
    for (const c of path) { if (chanM[c] || riv[c]) { run++; big = Math.max(big, acc[c]); } else close(); } close(); return { best, excess }; };
  const chanExcess = path => chanScan(path).excess;
  function routeAvoidingChannel(a, b, type, cst) {
    let rt = routeRoad(a, b, type, cst);
    for (const pen of [100, 400, 1500]) {
      if (!rt || chanExcess(rt.path) <= 0) break;
      const saved = Float32Array.from(chanList, i => cst[i]);                         // temporarily make the channel prohibitive, reroute, restore
      for (const i of chanList) cst[i] += pen;
      const r2 = routeRoad(a, b, type, cst);
      for (let k = 0; k < chanList.length; k++) cst[chanList[k]] = saved[k];
      if (r2 && chanExcess(r2.path) < chanExcess(rt.path)) rt = r2;
    }
    if (rt && chanExcess(rt.path) > 0) reality.riverRoadRuns = (reality.riverRoadRuns || 0) + 1;   // could not avoid: reported in the stats
    return rt;
  }
  function link(a, b, type, cst = cost, extra = {}) {
    if (a === b || linked.has(lkey(a, b))) return; linked.add(lkey(a, b));
    const rt = routeAvoidingChannel(a.i, b.i, type, cst); if (!rt) return false; const path = rt.path; extra = { ...extra, jd: rt.jd };
    if (path.length < 2) { reached.add(a); reached.add(b); return true; }      // two sites in the same cell need no road
    let len = 0; for (let j = 1; j < path.length; j++) { const d = Math.abs(path[j] - path[j - 1]); len += (d === 1 || d === n ? 1 : 1.4142) * cell; }
    roads.push({ type, path, pts: smooth(path), a: a.name, b: b.name, len, ...extra }); reached.add(a); reached.add(b);
    for (const j of path) { cost[j] = Math.min(cost[j], base[j] * F_ROAD[type]); roadCell[j] = 1; }
    return true;
  }
  const nearest = (p, list) => list.filter(q => q !== p).sort((a, b) => dk(p, a) - dk(p, b));
  const major = pois.filter(p => ['city', 'town', 'harbor', 'airport'].includes(p.type));
  if (major.length > 1) {
    const inT = [major[0]], out = major.slice(1);
    while (out.length) {
      let bd = Infinity, ba, bb;
      for (const a of inT) for (const b of out) { const d = dk(a, b); if (d < bd) { bd = d; ba = a; bb = b; } }
      link(ba, bb, 'highway'); inT.push(bb); out.splice(out.indexOf(bb), 1);
    }
    // extra links so key places have an alternate route (docs: viable alternate routes)
    for (const p of major) { const q = nearest(p, major).find(q => !linked.has(lkey(p, q))); if (q && dk(p, q) < M(30) && R() < .6) link(p, q, 'highway'); }
  }
  const net = major.slice(), TRAILY = ['cabin', 'outpost', 'radio', 'bunker', 'lookout', 'comms', 'campsite', 'hut', 'raiders', 'weather'];
  const MINOR = ['village', 'farm', 'safehouse', 'industrial', 'mine', 'military', 'airfield', 'airstrip', 'radar', 'research', 'dam', 'survivors',
    'lighthouse', 'dock', 'ranger', 'logging', 'windfarm', 'secret', 'power', 'water', ...TRAILY];
  const minor = pois.filter(p => MINOR.includes(p.type)).sort((a, b) => (city ? dk(a, city) - dk(b, city) : 0));
  // roads join the road network only (never a trail-only summit tower); the target is the one needing the shortest road
  // the climb allows (length ≥ height difference / max grade), not simply the nearest
  const netRoad = major.slice(), estKm = (p, q, g) => Math.max(dk(p, q), Math.abs(p.h - q.h) / g / 1000);
  for (const p of minor) {
    const tr = TRAILY.includes(p.type), g = tr ? 1 : GRADE_MAX.road, cands = (tr ? net : netRoad).filter(o => o !== p).sort((a, b) => estKm(p, a, g) - estKm(p, b, g));
    for (const q of cands.slice(0, 4)) if (link(p, q, tr ? 'trail' : 'road')) break;       // fall back to the next target if one is unreachable
    net.push(p); if (!tr) netRoad.push(p);
  }
  const villages = pois.filter(p => p.type === 'village');
  for (const p of villages) if (R() < .4) { const q = nearest(p, villages)[0]; if (q) link(p, q, 'trail'); }
  for (const p of pois) {
    if (p.type === 'seed') { const q = nearest(p, net)[0]; if (q && dk(p, q) < M(25)) link(p, q, 'trail'); }
    if (p.type === 'peak') { const q = nearest(p, net)[0]; if (q && dk(p, q) < M(12)) link(p, q, 'trail'); }
  }

  // coastal road (Island_and_Biomes.md: coast & ports): harbors, lighthouses and piers linked around the island, hugging the shore
  if (!mainland || shape === 'coastal') {
    const cst2 = new Float32Array(N2); for (let i = 0; i < N2; i++) cst2[i] = cost[i] * (land[i] && dO[i] < Math.max(M(700), 3 * cell) ? .35 : 1);
    let mx = 0, my = 0, c0 = 0; for (let i = 0; i < N2; i += 7) if (land[i]) { mx += i % n; my += i / n | 0; c0++; } mx /= c0 || 1; my /= c0 || 1;
    const order = p => mainland ? p.x * ca + p.y * sa : Math.atan2(p.y - my, p.x - mx);
    const cs = pois.filter(p => ['harbor', 'lighthouse', 'dock'].includes(p.type)).sort((a, b) => order(a) - order(b));
    if (cs.length > 1) for (let j = 0; j < cs.length - (mainland ? 1 : 0); j++) { const a = cs[j], b = cs[(j + 1) % cs.length]; if (dk(a, b) < M(30)) link(a, b, 'road', cst2, { coastal: true }); }
  }

  // alternate routes (Island_and_Biomes.md: viable alternate routes): the city and every town get at least two road links
  {
    const deg = {}; for (const r of roads) if (r.type !== 'trail') { deg[r.a] = (deg[r.a] || 0) + 1; deg[r.b] = (deg[r.b] || 0) + 1; }
    for (const p of pois.filter(q => q.type === 'city' || q.type === 'town')) if ((deg[p.name] || 0) < 2) {
      const q = nearest(p, net).find(q => !linked.has(lkey(p, q)) && ['city', 'town', 'village', 'harbor'].includes(q.type)); if (q) link(p, q, 'road');
    }
  }

  // realistic horizontal alignment (how an engineer lays a road out): reduce the routed grid path to its real turning points,
  // then join straight tangents with circular curves of the design radius — tighter only where the ground forces it (hairpins).
  // Tunnels and viaducts stay dead straight between their portals.
  const R_DESIGN = { highway: 250, road: 60, trail: 8 }, DP_TOL = { highway: 1.6, road: 1.3, trail: .9 };
  const R_MIN = { highway: 45, road: 15, trail: 3 }, R_HAIRPIN = { highway: 25, road: 12, trail: 3 };   // absolute limits (m)
  const curves = { highway: { minR: Infinity, hairpins: 0, curves: 0 }, road: { minR: Infinity, hairpins: 0, curves: 0 }, trail: { minR: Infinity, hairpins: 0, curves: 0 } };
  const dpSimplify = (pts, tol) => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b];
      for (let i = a + 1; i < b; i++) { const d = distSeg(pts[i][0], pts[i][1], ax, ay, bx, by); if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  // every point of a laid-out curve must stand on buildable ground (no water, no cliff)
  // (trails are not graded, so a trail curve must also keep every step ≤ 50° itself)
  const curveOk = (pts, steepCap = Infinity) => { let pc = -1;
    for (let k = 0; k + 1 < pts.length; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], st = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / .4));
      for (let t = 0; t <= st; t++) { const c = Math.round(lerp(y0, y1, t / st)) * n + Math.round(lerp(x0, x1, t / st)); if (!(base[c] < 1e8)) return false;
        if (pc >= 0 && c !== pc && Math.abs(h[c] - h[pc]) / (Math.hypot(c % n - pc % n, (c / n | 0) - (pc / n | 0)) * cell) > steepCap) return false; pc = c; } } return true; };
  // try the design layout first; where it would clip water or a cliff, refit that stretch tighter; last resort the routed line
  const layStretch = (sec, type, stat) => {
    for (const f of [1, .55, .3]) { const t = { minR: Infinity, hairpins: 0, curves: 0 }, c = fillet(sec, type, t, f); if (!t.bad && curveOk(c, type === 'trail' ? 1.19 : Infinity)) { stat.minR = Math.min(stat.minR, t.minR); stat.hairpins += t.hairpins; stat.curves += t.curves; return c; } }
    if (sec.length >= 12) { const m = sec.length >> 1; return layStretch(sec.slice(0, m + 1), type, stat).concat(layStretch(sec.slice(m), type, stat).slice(1)); }   // refit each half
    stat.fallback = (stat.fallback || 0) + 1; return sec.map(([x, y]) => [x, y, -1]);   // short routed piece, already validated by the router
  };
  const fillet = (sec, type, stat, f = 1) => {
    if (sec.length < 3) return sec.slice();
    const V = dpSimplify(sec, DP_TOL[type] * f), Rg = R_DESIGN[type] * f / cell, out = [V[0]];
    for (let k = 1; k < V.length - 1; k++) {
      const [ax, ay] = V[k - 1], [bx, by] = V[k], [cx, cy] = V[k + 1], l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
      if (!l1 || !l2) continue;
      const ux = (bx - ax) / l1, uy = (by - ay) / l1, vx = (cx - bx) / l2, vy = (cy - by) / l2, th = Math.acos(clamp(ux * vx + uy * vy, -1, 1));
      if (th < .03) continue;                                                     // practically straight: drop the vertex
      let T = Rg * Math.tan(th / 2), R = Rg; const Tmax = Math.min(l1, l2) * .5;
      if (T > Tmax) { T = Tmax; R = T / Math.tan(th / 2); }                       // the ground (short legs) forces a tighter curve
      stat.curves++; stat.minR = Math.min(stat.minR, R * cell); if (th > 2.1) stat.hairpins++;
      if (R * cell < (th > 2.1 ? R_HAIRPIN[type] : R_MIN[type])) stat.bad = true;   // tighter than this road could be built
      const s = ux * vy - uy * vx > 0 ? 1 : -1, p1x = bx - ux * T, p1y = by - uy * T, ox = p1x - uy * s * R, oy = p1y + ux * s * R;
      const a0 = Math.atan2(p1y - oy, p1x - ox), steps = Math.max(2, Math.ceil(R * th / .5));
      out.push([p1x, p1y]); for (let t = 1; t <= steps; t++) { const a = a0 + s * th * t / steps; out.push([ox + Math.cos(a) * R, oy + Math.sin(a) * R]); }
    }
    out.push(V[V.length - 1]); return out;
  };
  for (const r of roads) {
    const P = r.path, L = P.length; if (L < 4) { r.pts = P.map(c => [c % n, c / n | 0]); continue; }
    const xy = P.map(c => [c % n, c / n | 0]), out = [], tmp = { minR: Infinity, hairpins: 0, curves: 0 };
    for (let j = 0; j < L;) {
      let e = j; const sj = r.jd[j]; while (e < L && !!r.jd[e] === !!sj) e++;
      if (sj) for (let q = j; q < e; q++) out.push([xy[q][0], xy[q][1], r.jd[q]]);
      else for (const [x, y, tr] of layStretch(xy.slice(j, e), r.type, tmp)) out.push([x, y, tr ? -1 : 0]);
      j = e;
    }
    // densify (≤ 0.4 cell) and map back onto terrain cells; keep the exact curve point for drawing/export
    const np = [], njd = [], npts = []; let ok = true;
    for (let k = 0; k < out.length; k++) {
      const [x0, y0, j0] = out[k], nx = k + 1 < out.length ? out[k + 1] : out[k], steps = Math.max(1, Math.ceil(Math.hypot(nx[0] - x0, nx[1] - y0) / .4));
      for (let t = 0; t < (k + 1 < out.length ? steps : 1); t++) {
        // -1 marks a trusted routed piece: walk its own cells (no corner-cutting between diagonal steps)
        const trusted = j0 < 0 && nx[2] < 0, x = trusted ? x0 : lerp(x0, nx[0], t / steps), y = trusted ? y0 : lerp(y0, nx[1], t / steps);
        const c = Math.round(y) * n + Math.round(x), jd = j0 > 0 && nx[2] > 0 ? j0 : 0;
        if (np.length && np[np.length - 1] === c) continue;
        if (!trusted && j0 === 0 && nx[2] === 0 && !(base[c] < 1e8)) { ok = false; r.alignFail = { c, land: land[c], slope: slope[c], k }; break; }
        np.push(c); njd.push(jd); npts.push([x, y, trusted]);
      }
      if (!ok) break;
    }
    r.aligned = ok && np.length >= 2 && chanExcess(np) <= Math.max(0, chanExcess(P));   // a laid-out curve may not hug a river more than the routed line did
    if (!r.aligned) { r.pts = smooth(P); continue; }
    // short routed fallback pieces: draw/export them as a smooth line (the graded cells stay where they are)
    const sp = npts.map((q, k) => { if (!q[2]) return [q[0], q[1]]; let sx = 0, sy = 0, cN = 0; for (let d = -2; d <= 2; d++) { const o = npts[k + d]; if (o) { sx += o[0]; sy += o[1]; cN++; } } return [sx / cN, sy / cN]; });
    r.path = np; r.jd = njd; r.pts = sp;
    let len = 0; for (let k = 1; k < npts.length; k++) len += Math.hypot(npts[k][0] - npts[k - 1][0], npts[k][1] - npts[k - 1][1]) * cell; r.len = len;
    const cs = curves[r.type]; cs.minR = Math.min(cs.minR, tmp.minR); cs.hairpins += tmp.hairpins; cs.curves += tmp.curves; cs.fallback = (cs.fallback || 0) + (tmp.fallback || 0);
  }
  roadCell.fill(0); for (const r of roads) for (const c of r.path) roadCell[c] = 1;
  reality.curves = curves;
  reality.maxRiverRunM = roads.reduce((m, r) => Math.max(m, chanScan(r.path).best), 0) * cell;       // longest stretch of any road lying in a river channel

  const sagM = new Uint8Array(N2);                                 // road-surface sags (drained by culverts)
  const roadBedM = new Uint8Array(N2);                             // graded road surface cells (kept smooth in hi-res exports)
  // reality rule: roads are graded (cut & fill) to a realistic maximum grade instead of riding every bump.
  // Bridges / culverts: river and drainage cells are left open so roads never dam water; lake rims are never cut.
  {
    const GRADE = { highway: .08, road: .12, trail: .8 }, RWID = { highway: 12, road: 7, trail: 2.5 }, RANK = { trail: 0, road: 1, highway: 2 };
    const bestD = new Float32Array(N2).fill(Infinity), bestT = new Float32Array(N2), orig = h.slice(), bedM = roadBedM, nearChan = new Float32Array(N2).fill(-Infinity);   // water level of a channel within 2 cells
    for (let i = 0; i < N2; i++) if (chanM[i] || riv[i]) { const x = i % n, y = i / n | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < n && yy < n) { const j = yy * n + xx; if (!(chanM[j] || riv[j])) nearChan[j] = Math.max(nearChan[j], h[i]); } } }
    for (const r of roads.slice().sort((a, b) => RANK[b.type] - RANK[a.type])) {      // highways first; later roads join their surface
      const p = r.path, L = p.length; if (L < 3) continue;
      const dist = new Float32Array(L); for (let j = 1; j < L; j++) { const d = Math.abs(p[j] - p[j - 1]); dist[j] = dist[j - 1] + (d === 1 || d === n ? 1 : 1.4142) * cell; }
      const win = r.type === 'trail' ? 0 : Math.max(1, Math.round(30 / cell)), z0 = p.map(i => h[i]);   // footpaths hug the ground
      const z = z0.map((_, j) => { let s = 0, c = 0; for (let q = Math.max(0, j - win); q <= Math.min(L - 1, j + win); q++) { s += z0[q]; c++; } return s / c; });
      const g = GRADE[r.type];
      for (let j = 1; j < L; j++) z[j] = clamp(z[j], z[j - 1] - g * (dist[j] - dist[j - 1]), z[j - 1] + g * (dist[j] - dist[j - 1]));
      for (let j = L - 2; j >= 0; j--) z[j] = clamp(z[j], z[j + 1] - g * (dist[j + 1] - dist[j]), z[j + 1] + g * (dist[j + 1] - dist[j]));
      // clearance: decks ≥ 3 m over a channel, ≥ 1 m beside one; ramps up to that at the same max grade (max of two
      // grade-limited profiles is still grade-limited)
      const cone = p.map(c => riv[c] || chanM[c] ? h[c] + 3 : nearChan[c] + 1);
      for (let j = 1; j < L; j++) cone[j] = Math.max(cone[j], cone[j - 1] - g * (dist[j] - dist[j - 1]));
      for (let j = L - 2; j >= 0; j--) cone[j] = Math.max(cone[j], cone[j + 1] - g * (dist[j + 1] - dist[j]));
      for (let j = 0; j < L; j++) z[j] = Math.max(z[j], cone[j]);
      // junctions: where this road meets an already-built road it is pinned to that surface, ramping to it within its grade
      const U = new Float32Array(L).fill(Infinity), Lo = new Float32Array(L).fill(-Infinity);
      for (let j = 0; j < L; j++) if (bedM[p[j]]) U[j] = Lo[j] = h[p[j]];
      for (let j = 1; j < L; j++) { const dd = dist[j] - dist[j - 1]; U[j] = Math.min(U[j], U[j - 1] + g * dd); Lo[j] = Math.max(Lo[j], Lo[j - 1] - g * dd); }
      for (let j = L - 2; j >= 0; j--) { const dd = dist[j + 1] - dist[j]; U[j] = Math.min(U[j], U[j + 1] + g * dd); Lo[j] = Math.max(Lo[j], Lo[j + 1] - g * dd); }
      for (let j = 0; j < L; j++) z[j] = Lo[j] > U[j] ? (Lo[j] + U[j]) / 2 : clamp(z[j], Lo[j], U[j]);
      r.profile = z; r.dist = dist;
      // structures: rivers get bridges; fills deeper than 15 m become viaducts and cuts deeper than 20 m tunnels (deck = profile).
      // Trails are not engineered: they only take light shaping (±2 m).
      // deck codes: 1 bridge (river) · 2 viaduct · 3 tunnel · 4 culvert / short span · 5 retaining wall (cut) · 6 overpass
      const deck = r.deck = new Uint8Array(L), FILL = r.type === 'trail' ? 2 : 30, CUT = r.type === 'trail' ? 2 : 40;   // real embankments reach ~30 m, cuttings ~40 m
      // 4 = culvert bridge: a gully that would need >2 m of fill keeps its channel open under a short span
      // routed tunnels/viaducts keep a straight deck between their portals
      for (let j = 0; j < L; j++) if (r.jd[j]) { let e = j; while (e < L && r.jd[e]) e++; const za = z[Math.max(0, j - 1)], zb = z[Math.min(L - 1, e)];
        for (let q = j; q < e; q++) z[q] = lerp(za, zb, (dist[q] - dist[Math.max(0, j - 1)]) / ((dist[Math.min(L - 1, e)] - dist[Math.max(0, j - 1)]) || 1)); j = e; }
      // final guarantee: after pins, clearances and straight decks, the road surface itself obeys the grade limit
      for (let j = 1; j < L; j++) z[j] = clamp(z[j], z[j - 1] - g * (dist[j] - dist[j - 1]), z[j - 1] + g * (dist[j] - dist[j - 1]));
      for (let j = L - 2; j >= 0; j--) z[j] = clamp(z[j], z[j + 1] - g * (dist[j + 1] - dist[j]), z[j + 1] + g * (dist[j + 1] - dist[j]));
      for (let j = 0; j < L; j++) { const dz = z[j] - orig[p[j]]; deck[j] = r.jd[j] ? r.jd[j] : riv[p[j]] || chanM[p[j]] ? 1 : dz > FILL ? 2 : dz < -CUT ? 3 : acc[p[j]] >= aT && dz > 2 ? 4 : 0; }
      // where this road meets an existing one too far above/below to join within its grade: grade-separated crossing (overpass)
      if (r.type !== 'trail') for (let j = 0; j < L; j++) if (!deck[j] && bedM[p[j]] && Math.abs(z[j] - h[p[j]]) > 1) { if (!deck[j - 1] || deck[j - 1] !== 6) reality.overpasses = (reality.overpasses || 0) + 1; deck[j] = 6; }
      // a deep fill or cut shorter than ~30 m is not a viaduct or tunnel: it is built as an embankment / cutting (graded normally)
      if (r.type !== 'trail') for (let j = 0; j < L; j++) if ((deck[j] === 2 || deck[j] === 3) && !r.jd[j]) {
        let e = j; while (e < L && deck[e] === deck[j] && !r.jd[e]) e++;
        if (dist[Math.min(L - 1, e)] - dist[j] < 80) for (let q = j; q < e; q++) deck[q] = 0; j = e;   // short deep spots: earthworks, not a structure
      }
      if (r.type !== 'trail') for (let j = 1; j < L; j++) {
        if (deck[j] === 2 && deck[j - 1] !== 2) { reality.viaducts++; let e = j; while (e < L && deck[e] === 2) e++; if (e - j > 2) P('viaduct', p[(j + e) >> 1]);
          reality.maxViaductM = Math.max(reality.maxViaductM || 0, dist[Math.min(L - 1, e)] - dist[j - 1]); }
        if (deck[j] === 3 && deck[j - 1] !== 3) { reality.tunnels++; let e = j; while (e < L && deck[e] === 3) e++; if (e - j > 2) { P('portal', p[j - 1]); P('portal', p[Math.min(L - 1, e)]); }
          reality.maxTunnelM = Math.max(reality.maxTunnelM || 0, dist[Math.min(L - 1, e)] - dist[j - 1]); }
      }
      const hw = Math.max(.5, RWID[r.type] / 2 / cell), touched = [];
      for (let j = 0; j < L; j++) {
        const c = p[j]; if (deck[j]) continue;                               // bridge / viaduct / tunnel: terrain left as is
        const cx = c % n, cy = c / n | 0, bank = Math.max(1, Math.abs(z[j] - orig[c]) / (.5 * cell)), R2 = Math.ceil(hw + bank);
        for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) {
          const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= n || y >= n) continue; const i = y * n + x;
          if (!land[i] || riv[i] || chanM[i]) continue;
          const d = Math.hypot(dx, dy); if (d > hw + bank || d >= bestD[i]) continue;
          if (bedM[i]) continue;                                              // never reshape a road that is already built
          if (bestD[i] === Infinity) touched.push(i);
          let t = Math.max(d <= hw ? z[j] : lerp(z[j], orig[i], sstep(0, 1, (d - hw) / bank)), rimL[i] + .3, .5);
          if (acc[i] >= aT) t = Math.min(t, orig[i]);                          // culvert: over a gully the road may cut but never dam it
          t = Math.max(t, nearChan[i] + 1);                                    // beside a river: stay ≥ 1 m above the water (a deeper cut would capture it)
          bestD[i] = d; bestT[i] = t;
        }
      }
      for (const i of touched) { h[i] = bestT[i]; if (bestD[i] <= hw) bedM[i] = 1; bestD[i] = Infinity; }
      // reconcile: wherever the ground could not take the planned surface (gully, junction, rim), a short structure carries it
      const tol = r.type === 'trail' ? 1 : .25;                                // roads must match closely; a footpath is rough
      for (let j = 0; j < L; j++) if (!deck[j] && Math.abs(h[p[j]] - z[j]) > tol) deck[j] = z[j] > h[p[j]] ? 4 : 5;   // short span / retaining wall
      if (r.type === 'trail') for (let j = 0; j < L; j++) {
        if (deck[j] === 1 && deck[j - 1] !== 1) reality.footbridges = (reality.footbridges || 0) + 1;                         // stream crossings
        else if (deck[j] > 1 && !(deck[j - 1] > 1)) reality.trailSteps = (reality.trailSteps || 0) + 1;                       // built steps / boardwalk
      }
    }
    // embankments can pond small hollows beside them: fill those. A sag in a road's own surface keeps its shape (drained by a culvert).
    const r4 = priorityFlood(h, n); let drop = 0;
    for (let i = 0; i < N2; i++) if (land[i] && r4.fl[i] > h[i] + .01) { if (bedM[i]) { reality.culverts++; sagM[i] = 1; } else { h[i] = r4.fl[i]; reality.pitsFilled++; } }
    for (const l of lakes) { let mn = Infinity; for (const c of l.cells) mn = Math.min(mn, r4.fl[c]); if (mn < l.level - .2) drop++; }
    reality.lakesDrained = drop;
    deriveSlope();
  }

  // roadside: fuel stations along highways, warehouses in the rural belt
  await status('8/10 Passes, bridges, roadside…');
  const near = (type, x, y, km) => pois.some(p => p.type === type && Math.hypot(p.x - x, p.y - y) * cell / 1000 < km);
  const hwy = new Uint8Array(N2);
  for (const r of roads) if (r.type === 'highway') {
    let run = 0;
    for (const j of r.path) {
      hwy[j] = 1; run += cell; const x = j % n, y = j / n | 0;
      if (run > Math.max(M(12000), 3500) && !near('fuel', x, y, Math.max(M(5), 2.5)) && dcity(x, y) > M(3)) { P('fuel', j); run = 0; }
    }
  }
  const dHw = chamfer(n, cell, hwy);
  place('warehouse', cnt(2 + 3 * sq), (i, x, y) => dHw[i] > Math.max(1.5 * cell, M(400)) || slope[i] > 4 || dcity(x, y) < M(6) ? NEG : flatB(M(800))[i], M(6), ['warehouse', 'city', 'town']);
  place('checkpoint', 3, (i, x, y) => !hwy[i] || dcity(x, y) < Math.max(M(4), city ? city.radius * 1.1 / 1000 : 0) ? NEG : 2 - Math.abs(dcity(x, y) - M(6)) / M(4), M(3), ['checkpoint'], 1);
  place('motel', 2, (i, x, y) => !hwy[i] || dcity(x, y) < M(8) || slope[i] > 5 ? NEG : flatB(M(300))[i], M(8), ['motel', 'fuel'], 1);
  place('substation', cnt(2 + sq), (i, x, y) => dHw[i] > Math.max(M(300), 2 * cell) || slope[i] > 5 || dcity(x, y) < M(3) ? NEG : flatB(M(300))[i], M(6), ['substation']);
  for (const p of pois) if (['fuel', 'warehouse', 'checkpoint', 'motel', 'substation'].includes(p.type)) reached.add(p);
  // vehicles (Survival_and_Progression.md: one repairable pickup first): the pickup sits by the slice safehouse, wrecks litter the roads
  if (safe) place('pickup', 1, (i, x, y) => { const d = Math.hypot(x - safe.x, y - safe.y) * cell; return d < 15 || d > 250 ? NEG : -d / 100; }, 0, ['pickup'], 1);
  place('vehicle', cnt(4 + 4 * sq), i => roadCell[i] ? 1 : NEG, M(1.5), ['vehicle', 'pickup'], 1);

  // main-menu vista (Main_Menu_and_UI.md): a farmhouse on high ground looking over a town towards a seed engine
  let menuCam = null;
  {
    let best = NEG;
    const towns = pois.filter(p => p.type === 'town' || p.type === 'city'), seedsL = pois.filter(p => p.type === 'seed');
    for (const f of pois) if (f.type === 'farm' || f.type === 'safehouse') {
      const t = nearest(f, towns)[0], sd = story ? nearest(f, seedsL)[0] : t; if (!t || !sd) continue;
      const dt = dk(f, t), s = f.h - (dt < .6 || dt > 4 ? 1e4 : 0) - dk(f, sd) * 15;
      if (s > best) { best = s; menuCam = { farm: f, t, sd }; }
    }
    if (menuCam) {
      const { farm, t, sd } = menuCam, cxm = farm.x * cell, cym = farm.y * cell, tx = (t.x + sd.x) / 2 * cell, ty = (t.y + sd.y) / 2 * cell, ch = h[farm.i] + 4;
      const th = (h[t.i] + h[sd.i]) / 2 + 30, hor = Math.hypot(tx - cxm, ty - cym);
      menuCam = { farm: farm.id, pos: [cxm, cym, ch], target: [tx, ty, th], yaw: Math.atan2(ty - cym, tx - cxm) * 57.2958, pitch: Math.atan2(th - ch, hor) * 57.2958 };
      farm.menu = true;
    }
  }

  // Street and footprint coordinates below are in metres from the northwest corner.
  const urban = new Uint8Array(N2), buildings = [], streets = [], occ = new Map(), HS = 32;
  const cellsOf = (x, y, r, f) => {
    for (let gx = Math.floor((x - r) / HS); gx <= Math.floor((x + r) / HS); gx++)
      for (let gy = Math.floor((y - r) / HS); gy <= Math.floor((y + r) / HS); gy++) if (f(gx * 100003 + gy)) return true;
    return false;
  };
  const occupy = item => cellsOf(item.x, item.y, item.r, key => {
    if (!occ.has(key)) occ.set(key, []);
    occ.get(key).push(item);
  });
  const hits = (x, y, r, test) => cellsOf(x, y, r, key => occ.get(key)?.some(test));
  const indexAt = (x, y) => Math.round(y / cell) * n + Math.round(x / cell);
  const ground = (x, y, maxSlope) => {
    if (x < 0 || y < 0 || x > sizeM || y > sizeM) return false;
    const i = indexAt(x, y);
    return land[i] && slope[i] < maxSlope && riv[i] < 2 && !chanM[i];
  };
  const paintUrban = (x, y, radius, level) => {
    const r = Math.max(radius, cell * .72);
    for (let gy = Math.max(0, Math.ceil((y - r) / cell)); gy <= Math.min(n - 1, Math.floor((y + r) / cell)); gy++) {
      for (let gx = Math.max(0, Math.ceil((x - r) / cell)); gx <= Math.min(n - 1, Math.floor((x + r) / cell)); gx++) {
        const i = gy * n + gx;
        if (land[i] && Math.hypot(x - gx * cell, y - gy * cell) <= r) urban[i] = Math.max(urban[i], level);
      }
    }
  };
  const addB = (x, y, w, d, a, kind, pad = 1, level = 0) => {
    const hw = w / 2 + pad, hd = d / 2 + pad, c = Math.cos(a), s = Math.sin(a), r = Math.hypot(hw, hd);
    const suitable = (px, py) => ground(px, py, 18) && (kind === 'industrial' || h[indexAt(px, py)] >= 2);
    if (!suitable(x, y)) return false;
    for (const u of [-hw, hw]) for (const v of [-hd, hd]) if (!suitable(x + u * c - v * s, y + u * s + v * c)) return false;
    if (hits(x, y, r, other => {
      const dx = other.x - x, dy = other.y - y;
      if (Math.hypot(dx, dy) >= r + other.r) return false;
      const u = Math.abs(dx * c + dy * s), v = Math.abs(-dx * s + dy * c);
      if (other.hw === undefined) return Math.hypot(Math.max(0, u - hw), Math.max(0, v - hd)) < other.r;
      const cos = Math.abs(c * other.c + s * other.s), sin = Math.abs(s * other.c - c * other.s);
      return u < hw + other.hw * cos + other.hd * sin && v < hd + other.hw * sin + other.hd * cos &&
        Math.abs(dx * other.c + dy * other.s) < other.hw + hw * cos + hd * sin &&
        Math.abs(-dx * other.s + dy * other.c) < other.hd + hw * sin + hd * cos;
    })) return false;
    buildings.push({ x, y, w, d, a, kind, z: terrainAt(h, n, cell, x, y), urbanLevel: level });
    occupy({ x, y, r, hw, hd, c, s });
    if (level) paintUrban(x, y, r + 10, level);
    return true;
  };
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sampleLine = (pts, deck, step = 6) => {
    const sampled = [pts[0]];
    for (let j = 1; j < pts.length; j++) {
      const a = pts[j - 1], b = pts[j], count = Math.ceil(distance(a, b) / step);
      const blocked = deck && ([1, 2, 3, 6].includes(deck[j - 1]) || [1, 2, 3, 6].includes(deck[j]));
      for (let k = 1; k <= count; k++) sampled.push([lerp(a[0], b[0], k / count), lerp(a[1], b[1], k / count), blocked]);
    }
    return sampled;
  };
  const reserveStreet = (pts, width) => {
    for (const [x, y] of pts) occupy({ x, y, r: width / 2 + 2 });
  };
  const approaches = new Map();
  const centers = new Map(pois.filter(p => p.radius).map(p => [p.name, p]));
  for (const r of roads) {
    if (!r.pts.length) continue;
    const w = r.type === 'highway' ? 12 : r.type === 'road' ? 7 : 2.5;
    const pts = sampleLine(r.pts.map(([x, y]) => [x * cell, y * cell]), r.deck);
    reserveStreet(pts, w);
    if (r.type === 'trail') continue;
    for (const name of [r.a, r.b]) if (centers.has(name)) {
      const p = centers.get(name), center = [p.x * cell, p.y * cell];
      const ordered = distance(pts[0], center) <= distance(pts.at(-1), center) ? pts : pts.slice().reverse();
      const end = ordered.findIndex(pt => distance(pt, center) > p.radius);
      const frontage = end === -1 ? ordered : ordered.slice(0, end);
      if (frontage.length < 2) continue;
      if (!approaches.has(p)) approaches.set(p, []);
      approaches.get(p).push({ pts: frontage, w, main: true });
    }
  }
  const CIVIC_SIZE = { tunnel: [12, 9], cityhall: [30, 24], hospital: [60, 40], mall: [80, 55], police: [20, 15], fire: [22, 16], school: [44, 26], church: [16, 30], stadium: [110, 80],
    busdepot: [48, 28], clinic: [18, 14], store: [16, 12], trader: [16, 10], pub: [14, 10], diner: [15, 9], pharmacy: [12, 10], hardware: [24, 16], postoffice: [12, 10],
    townhall: [24, 18], library: [18, 14], bank: [14, 12], garage: [18, 14], hall: [22, 14], watertower: [7, 7], silo: [12, 12], fuel: [20, 14], park: [50, 36], cemetery: [44, 34] };
  const PROF = {   // frontage, depth, gap between houses, front setback (m)
    city: { f: [11, 22], d: [10, 19], g: [2, 8], s: [2, 7] },
    town: { f: [9, 16], d: [8, 14], g: [4, 12], s: [3, 10] },
    village: { f: [8, 13], d: [8, 12], g: [9, 22], s: [6, 16] }
  };
  const rnd = ([a, b]) => a + R() * (b - a);
  const plans = [];
  for (const p of centers.values()) {
    const center = [p.x * cell, p.y * cell], radius = p.radius, block = p.block;
    const cityPlan = p.type === 'city', village = p.type === 'village', level = cityPlan ? 2 : 1;
    const frontages = (approaches.get(p) || []).slice(), anchors = [];
    p.layout = cityPlan ? 'connected districts' : village ? 'ribbon hamlet' : 'main street and lanes';
    plans.push({ p, center, level, frontages });
    const lane = (from, to, width, main = false, join = false) => {
      const length = distance(from, to);
      if (length < 25 || !ground(from[0], from[1], 20)) return null;
      const dx = (to[0] - from[0]) / length, dy = (to[1] - from[1]) / length;
      const count = Math.ceil(length / 5), bend = Math.min(length * .19, block * .48);
      let best = null, score = -Infinity;
      for (const bow of [bend * .45, -bend * .72, bend]) {
        const pts = [from.slice(0, 2)]; let cost = 0;
        for (let j = 1; j <= count; j++) {
          const t = j / count, bulge = bow * Math.sin(t * Math.PI);
          const x = j === count ? to[0] : lerp(from[0], to[0], t) - dy * bulge;
          const y = j === count ? to[1] : lerp(from[1], to[1], t) + dx * bulge;
          if (distance([x, y], center) > radius || !ground(x, y, 18) || h[indexAt(x, y)] < 2) break;
          const previous = pts.at(-1);
          if (distance([x, y], from) > 17 && (!join || distance([x, y], to) > 17) &&
              hits(x, y, width / 2 + 3, o => Math.hypot(x - o.x, y - o.y) < o.r + width / 2 + 3)) break;
          pts.push([x, y]);
          cost += slope[indexAt(x, y)] / 18 * distance(previous, [x, y]);
        }
        const span = distance(from, pts.at(-1)), merit = span - cost * .45;
        if (span >= 25 && (!join || pts.length === count + 1) && merit > score) { best = pts; score = merit; }
      }
      if (!best) return null;
      const street = { pts: best, w: width, main, owner: p };
      reserveStreet(best, width);
      streets.push(street); frontages.push(street);
      return street;
    };
    if (!frontages.length) {
      for (const turn of [0, .75, -.75, Math.PI]) {
        const a = p.angle + turn, length = radius * .82;
        if (lane(center, [center[0] + Math.cos(a) * length, center[1] + Math.sin(a) * length], village ? 6 : 8, true)) break;
      }
    }
    for (const spine of frontages.slice()) {
      const branches = [[], []], pts = spine.pts;
      let along = 0, next = block * .55;
      for (let j = 1; j < pts.length - 1; j++) {
        along += distance(pts[j - 1], pts[j]);
        if (along < next) continue;
        next = along + block * rnd([.85, village ? 1.8 : 1.45]);
        const at = pts[j];
        if (at[2]) continue;
        if (anchors.some(anchor => distance(anchor, at) < block * .64)) continue;
        anchors.push(at);
        const a = Math.atan2(pts[j + 1][1] - pts[j - 1][1], pts[j + 1][0] - pts[j - 1][0]);
        for (const side of [0, 1]) {
          if (!cityPlan && R() < (village ? .49 : .24)) continue;
          const direction = a + (side ? 1 : -1) * rnd([.91, 1.92]);
          const length = Math.min(radius * .67, block * (cityPlan ? rnd([1.35, 3.25]) : rnd([.75, 2.2])));
          const street = lane(at, [at[0] + length * Math.cos(direction), at[1] + length * Math.sin(direction)], cityPlan ? 8 : village ? 5 : 6);
          if (street) branches[side].push(street);
        }
      }
      // Connect neighbouring lanes where terrain permits. Gaps become yards, green space or cul-de-sacs.
      if (!village) for (const group of branches) for (let j = 1; j < group.length; j++) {
        const first = group[j - 1].pts, second = group[j].pts, a = first.at(-1), b = second.at(-1);
        if (cityPlan && distance(first[0], a) > block * 1.55 && distance(second[0], b) > block * 1.55) {
          // An inner cross street gives the deeper city districts a second row of blocks.
          const innerA = first[Math.floor(first.length * .5)], innerB = second[Math.floor(second.length * .5)];
          if (distance(innerA, innerB) <= block * 1.8) lane(innerA, innerB, 6, false, true);
        }
        if (distance(a, b) <= block * 2.3 && (cityPlan || R() < .72)) lane(a, b, cityPlan ? 7 : 6, false, true);
      }
    }
  }
  const hospitals = [], metroStops = [], omitted = new Set();
  const hospitalSpacingM = Math.max(1500, M(12000));
  for (const { p, center, level, frontages } of plans) {
    const frontagePoints = frontages.flatMap(r => r.pts.slice(0, -1).map(([x, y, blocked], j) => ({
      x, y, w: r.w, blocked: blocked || r.pts[j + 1][2], a: Math.atan2(r.pts[j + 1][1] - y, r.pts[j + 1][0] - x)
    })));
    // Surface markers and their buildings share one street-front site.
    const services = pois.filter(q => q.parent === p.name && CIVIC_SIZE[q.type]);
    const priority = q => ['hospital', 'tunnel'].includes(q.type) ? 0 : ['school', 'fire', 'police'].includes(q.type) ? 1 : 2;
    services.sort((a, b) => priority(a) - priority(b));
    for (const q of services) {
      const [w, d] = CIVIC_SIZE[q.type], kind = q.type === 'park' ? 'park' : q.type === 'cemetery' ? 'cemetery' : 'civic';
      const point = [q.x * cell, q.y * cell], spread = q.type === 'hospital' ? hospitalSpacingM : q.type === 'tunnel' ? 160 : 0;
      const neighbours = q.type === 'hospital' ? hospitals : metroStops;
      const candidates = frontagePoints.filter(pt => !pt.blocked && pt.w >= 5 && ground(pt.x, pt.y, 20))
        .map(pt => ({ pt, d: distance(point, [pt.x, pt.y]) })).sort((a, b) => a.d - b.d);
      let placed = false;
      for (const { pt } of candidates) {
        const offset = pt.w / 2 + d / 2 + 7;
        for (const side of [-1, 1]) {
          const x = pt.x - Math.sin(pt.a) * side * offset, y = pt.y + Math.cos(pt.a) * side * offset;
          if (spread && neighbours.some(site => distance(site, [x, y]) < spread)) continue;
          if (!addB(x, y, w, d, pt.a, kind, 1, level)) continue;
          q.x = x / cell; q.y = y / cell; q.i = indexAt(x, y); q.h = buildings.at(-1).z;
          q.access = { x: pt.x, y: pt.y, distanceM: offset, kind: 'street' };
          buildings.at(-1).poi = q;
          if (spread) neighbours.push([x, y]);
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (!placed) omitted.add(q);
    }
    const pr = PROF[p.type];
    for (const { pts, w, main } of frontages) for (const side of [-1, 1]) {
      let carry = rnd([3, 16]);
      for (let j = 1; j < pts.length; j++) {
        const [x, y] = pts[j - 1], [xx, yy] = pts[j], L = Math.hypot(xx - x, yy - y);
        if (!L) continue;
        const tx = (xx - x) / L, ty = (yy - y) / L, angle = Math.atan2(ty, tx);
        while (carry <= L) {
          const X = x + tx * carry, Y = y + ty * carry, edge = distance([X, Y], center) / p.radius;
          const district = noise(X / 185 + 30, Y / 185 + 30);
          let f = rnd(pr.f), d = rnd(pr.d), setback = rnd(pr.s), gap = rnd(pr.g), kind = 'house';
          if (main && p.type !== 'village' && edge < .57 && R() < .68 + district * .35) {
            kind = p.type === 'city' ? 'commercial' : 'shop';
            f *= kind === 'commercial' ? 1.4 : .9; d *= 1.25; setback = rnd([2, 4]); gap = rnd([1, 5]);
          } else if (p.type === 'city' && edge < .75 && district > .08) {
            kind = 'apartment'; f *= 1.5; d *= 1.2;
          }
          const offset = w / 2 + setback + d / 2 + 2;
          if (!pts[j][2] && R() < clamp(1.12 - edge * .58 + district * .4, .15, 1))
            addB(X - ty * side * offset, Y + tx * side * offset, f, d, angle + rnd([-.07, .07]), kind, .6, level);
          carry += f + gap + Math.max(0, district) * 5;
        }
        carry -= L;
      }
    }
  }
  for (let j = pois.length - 1; j >= 0; j--) if (omitted.has(pois[j])) pois.splice(j, 1);
  const CLUSTER = { farm: [3, 14, 'farm'], safehouse: [3, 14, 'farm'], industrial: [7, 45, 'industrial'], military: [9, 35, 'military'], research: [3, 30, 'industrial'],
    airfield: [3, 40, 'military'], harbor: [5, 30, 'industrial'], cabin: [1, 8, 'house'], logging: [3, 18, 'farm'], warehouse: [2, 40, 'industrial'], radar: [2, 18, 'military'],
    survivors: [6, 12, 'house'], raiders: [4, 9, 'farm'], motel: [2, 22, 'house'], power: [3, 40, 'industrial'], water: [3, 25, 'industrial'], ranger: [2, 12, 'house'],
    hut: [1, 8, 'house'], outpost: [2, 14, 'industrial'], lighthouse: [1, 8, 'house'], secret: [2, 25, 'military'], mine: [2, 25, 'industrial'] };
  for (const p of pois) {
    const cl = CLUSTER[p.type]; if (!cl) continue; const [k, size, kind] = cl, a = R() * Math.PI;
    for (let j = 0; j < k; j++) { const r = j ? size * (1.2 + R() * 1.5) : 0, t = R() * 6.2832; addB(p.x * cell + Math.cos(t) * r, p.y * cell + Math.sin(t) * r, size * (j ? .6 + R() * .5 : 1), size * (j ? .4 + R() * .4 : .7), a, kind); }
  }

  // natural barriers made passable: mountain passes, bridges
  for (const r of roads) {
    if (r.type === 'trail') continue;
    let mi = r.path[0]; for (const [k2, j] of r.path.entries()) if (!(r.jd && r.jd[k2]) && h[j] > h[mi]) mi = j;   // a tunnel's ridge is not a pass
    const eh = Math.max(h[r.path[0]], h[r.path[r.path.length - 1]]);
    if (h[mi] > 450 * ez && h[mi] - eh > 150 * ez && !near('pass', mi % n, mi / n | 0, M(4))) P('pass', mi);
    let inR = false;
    for (const j of r.path) { const c = riv[j] >= 2; if (c && !inR && !near('bridge', j % n, j / n | 0, M(1.5))) P('bridge', j); inR = c; }
  }
  const cc = new Float32Array(N2);
  for (let i = 0; i < N2; i++) cc[i] = ocean[i] ? Infinity : lakeId[i] ? 3 : (1 + (slope[i] / 12) ** 2) * (riv[i] ? .35 : 1);
  const corridors = [];
  if (city) for (const p of pois) if (p.type === 'seed') { const path = astar(p.i, city.i, cc, .5); if (path) corridors.push({ from: p.name, pts: smooth(path) }); }

  // built-up ground is never farmland (outlying buildings can still land on a field edge): show it as grass under the town
  { let cleared = 0; for (let i = 0; i < N2; i++) if (urban[i] && biome[i] === 9) { biome[i] = 2; cleared++; } reality.farmUrbanCleared = cleared; }

  // 6. EcologyGrid start state: spread from seed engines along valleys/rivers
  await status('9/10 EcologyGrid…');
  const gw = Math.max(2, Math.round(sizeM / ECO_CELL)), eN = gw * gw, eTer = new Int32Array(eN), eCost = new Float32Array(eN);
  for (let gy = 0; gy < gw; gy++) for (let gx = 0; gx < gw; gx++) {
    const tx = Math.min(n - 1, Math.round((gx + .5) * ECO_CELL / cell)), ty = Math.min(n - 1, Math.round((gy + .5) * ECO_CELL / cell)), i = ty * n + tx, e = gy * gw + gx;
    eTer[e] = i; eCost[e] = ocean[i] ? Infinity : lakeId[i] ? 3 : (1 + (slope[i] / 12) ** 2) * (riv[i] ? .35 : 1);
  }
  const toEco = (x, y) => Math.min(gw - 1, Math.floor(y * cell / ECO_CELL)) * gw + Math.min(gw - 1, Math.floor(x * cell / ECO_CELL));
  const eInf = new Uint8Array(eN), eStage = new Uint8Array(eN), eSeed = new Float32Array(eN), raw = new Float32Array(eN);
  for (const p of pois) if (p.type === 'seed') {
    const src = toEco(p.x, p.y), D = dijkstra(gw, eCost, src), rng = Math.max(M(8000), 1500) * p.strength;
    eSeed[src] = p.strength;
    for (let e = 0; e < eN; e++) raw[e] = Math.max(raw[e], p.strength * 120 * Math.exp(-D[e] * ECO_CELL / rng));
  }
  for (let e = 0; e < eN; e++) {
    const i = eTer[e]; if (!land[i]) continue;
    eInf[e] = clamp(Math.round(raw[e] - RESIST[biome[i]] * .4), 0, 100);
    eStage[e] = eInf[e] < 5 ? 0 : eInf[e] < 30 ? 1 : eInf[e] < 65 ? 2 : 3;
  }
  const stageT = new Uint8Array(N2);
  for (let i = 0; i < N2; i++) stageT[i] = land[i] ? eStage[toEco(i % n, i / n | 0)] : 0;
  place('nest', cnt(3 + 3 * sq), i => stageT[i] === 3 ? 1 : NEG, M(3), ['nest', 'seed']);
  place('sporefield', cnt(3 + 3 * sq), i => stageT[i] === 2 ? 1 : NEG, M(3), ['sporefield', 'nest']);

  // regions (docs): 1 metro, 2 rural belt, 3 woodland & mountain, 4 coast & ports, 5 military & science, 6 alien
  const milSrc = new Uint8Array(N2); for (const p of pois) if (['military', 'radar', 'airfield', 'research'].includes(p.type)) milSrc[p.i] = 1;
  const dMil = chamfer(n, cell, milSrc), region = new Uint8Array(N2);
  for (let i = 0; i < N2; i++) {
    if (!land[i]) continue; const x = i % n, y = i / n | 0;
    region[i] = stageT[i] >= 2 ? 6 : urban[i] === 2 || (city && dcity(x, y) < M(5)) ? 1 : dMil[i] < M(2500) ? 5 : dO[i] < M(1500) ? 4
      : [3, 4, 5, 6].includes(biome[i]) || h[i] > 500 * ez ? 3 : 2;
  }

  // progression zones around the start
  const zone = new Uint8Array(N2), zc = start || city;
  if (zc) for (let i = 0; i < N2; i++) {
    if (!land[i]) continue; const d = Math.hypot(i % n - zc.x, (i / n | 0) - zc.y) * cell / 1000;
    zone[i] = h[i] > 1400 * ez || d > M(45) ? 3 : d > M(18) ? 2 : 1;
  }

  // ---------- resources ----------
  // Natural resource areas (0..1 per cell) follow ecology: what grows/lies where it really would. Alien infestation
  // (stage 2–3) degrades native resources and leaves alien biomass instead (Alien_Terraforming.md).
  await status('Resources…');
  const RES_KEYS = ['softwood', 'hardwood', 'stone', 'clay', 'sand', 'forage', 'herbs', 'game', 'fish', 'crops', 'alien'];
  const res = {}; for (const k of RES_KEYS) res[k] = new Float32Array(N2);
  const urbSrc = new Uint8Array(N2); for (let i = 0; i < N2; i++) urbSrc[i] = urban[i] ? 1 : 0;
  const dUrb = chamfer(n, cell, urbSrc), forEdge = forB(M(300)), forBig = forB(M(2000));
  for (let i = 0; i < N2; i++) {
    const b = biome[i], hh = h[i], x = i % n, y = i / n | 0, cool = sstep(150 * ez, 450 * ez, hh), alienF = 1 - .3 * stageT[i], wild = urban[i] ? 0 : 1;
    if (land[i]) {
      const fo = b === 3 ? 1 : b === 4 ? .25 : b === 7 ? .15 : 0;                       // forest, sparse upland trees, wet woodland
      res.softwood[i] = fo * (.25 + .75 * cool) * wild * alienF;                          // conifers: cooler, higher ground
      res.hardwood[i] = fo * (1 - cool) * (.5 + .5 * moist[i]) * wild * alienF;           // broadleaf: warm, moist lowland
      res.stone[i] = clamp((b === 5 ? 1 : b === 4 ? .55 : b === 6 ? .4 : 0) + sstep(28, 42, slope[i]), 0, 1) * wild;
      res.clay[i] = hh < 80 * ez && slope[i] < 4 && dW[i] < M(400) && wild ? .4 + .6 * moist[i] : 0;   // floodplain clays
      res.sand[i] = b === 1 ? 1 : riv[i] >= 2 ? .5 : 0;                                    // beaches, river bars
      res.forage[i] = (clamp(1 - Math.abs(forEdge[i] - .5) * 2, 0, 1) * (b === 9 ? 0 : 1) + (b === 7 ? .4 : 0)) * wild * alienF;   // berries/mushrooms at forest edges
      res.herbs[i] = (b === 2 ? .6 : b === 7 ? .8 : b === 4 ? .3 : 0) * (.5 + .5 * noise(x * .08 + 33, y * .08 + 33)) * wild * alienF;
      res.game[i] = forBig[i] * sstep(M(500), M(3000), dUrb[i]) * alienF;               // deer/boar: big forests away from people
      res.crops[i] = b === 9 ? alienF : 0;
      res.alien[i] = stageT[i] >= 2 ? stageT[i] / 3 : 0;
    } else res.fish[i] = lakeId[i] ? .9 : ocean[i] && hh > -40 * ez && dLand[i] < M(1500) ? .8 : 0;   // lakes, shallow coastal shelf
    if (riv[i] >= 2) res.fish[i] = Math.max(res.fish[i], .3 + .2 * riv[i]);
  }
  // ore deposits from a simple geology model: iron in the range cores, copper on the flanks (hydrothermal, near streams),
  // silver higher on the flanks, placer gold in river gravels downstream of mountains, titanium in beach sands, diamond in an
  // inland kimberlite pipe, uranium in a range's granite core; coal in flat lowland basins and salt on coastal flats
  const axisD = (x, y) => { let m = Infinity; for (const rg of ranges) for (let q = 0; q < 4; q++) m = Math.min(m, distSeg(x / (n - 1), y / (n - 1), rg.pts[q][0], rg.pts[q][1], rg.pts[q + 1][0], rg.pts[q + 1][1]) / rg.w); return m; };
  const nearTown = i => urban[i] || dUrb[i] < M(300);
  // ores in order of rarity (1 = most common): rarer ores are fewer, smaller bodies; coal and salt are non-ore minerals
  const ORE_KINDS = ['stone', 'iron', 'copper', 'silver', 'gold', 'titanium', 'diamond', 'uranium', 'coal', 'salt'], deposits = [];
  const RARITY = { stone: 1, iron: 2, copper: 3, silver: 4, gold: 5, titanium: 6, diamond: 7, uranium: 8 };
  const SIZE = { stone: 1.2, iron: 1, copper: .9, silver: .7, gold: .6, titanium: .6, diamond: .3, uranium: .35, coal: 1, salt: .8 };
  for (const k of ORE_KINDS) res['ore_' + k] = new Float32Array(N2);
  const deposit = (kind, count, score, minKm, st) => {
    for (const p of place(kind, count, score, minKm, [kind], st)) {
      const rare = RARITY[kind] || 0;
      p.richness = +(.3 + .7 * R()).toFixed(2); p.radiusM = Math.round(Math.max(40, M(350 + R() * 550) * SIZE[kind])); p.depth = slope[p.i] > 25 ? 'outcrop' : R() < .5 ? 'shallow' : 'deep';
      if (rare) { p.rarity = rare; p.rarityLabel = ['', 'common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'very rare', 'legendary'][rare]; }
      p.resources = [kind === 'salt' ? 'salt' : kind === 'coal' ? 'coal' : 'ore_' + kind]; deposits.push(p);
      const ang = R() * Math.PI, rx = p.radiusM / cell * (kind === 'coal' ? 2 : 1), ry = p.radiusM / cell * (kind === 'coal' ? .5 : 1), rc = Math.ceil(Math.max(rx, ry) * 1.5), arr = res['ore_' + kind];
      for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {          // coal = long seam, others = rounded bodies
        const xx = p.x + dx, yy = p.y + dy; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue; const i = yy * n + xx; if (!land[i]) continue;
        const a = (dx * Math.cos(ang) + dy * Math.sin(ang)) / rx, b2 = (dy * Math.cos(ang) - dx * Math.sin(ang)) / ry, v = p.richness * Math.exp(-(a * a + b2 * b2) * 1.5);
        if (v > arr[i]) arr[i] = v;
      }
    }
  };
  // 1 stone: quarry-grade rock outcrops in hills and mountains
  deposit('stone', cnt(5 + 6 * sq), i => h[i] < 80 * ez || slope[i] < 12 || slope[i] > 45 || nearTown(i) ? NEG : res.stone[i] + mtnB(M(2000))[i], M(2.5));
  // 2 iron: in the cores of the ranges
  deposit('iron', cnt(4 + 4 * sq), (i, x, y) => h[i] < 350 * ez || slope[i] > 45 || nearTown(i) ? NEG : (axisD(x, y) < 1.3 ? 2 - axisD(x, y) : -1) + mtnB(M(3000))[i], M(3.5));
  // 3 copper: hydrothermal, on the flanks near streams
  deposit('copper', cnt(3 + 3 * sq), (i, x, y) => { const a = axisD(x, y); return a < .9 || a > 2.4 || slope[i] < 8 || slope[i] > 35 || nearTown(i) ? NEG : 1 - Math.abs(a - 1.5) + Math.exp(-dW[i] / M(800)); }, M(4));
  // 4 silver: higher veins on the flanks, often near the copper
  deposit('silver', cnt(2 + 2 * sq), (i, x, y) => { const a = axisD(x, y); return a < .6 || a > 1.8 || h[i] < 400 * ez || slope[i] > 40 || nearTown(i) ? NEG : 1 - Math.abs(a - 1.1) + Math.exp(-nearKm(x, y, ['copper']) / M(3)); }, M(5));
  // 5 gold: placer gravels in rivers downstream of mountains
  deposit('gold', cnt(1.5 + sq), i => riv[i] < 2 || mtnB(M(4000))[i] < .12 || nearTown(i) ? NEG : Math.log(acc[i] / T) * .3 + mtnB(M(4000))[i] * 2, M(5), 1);
  // 6 titanium: heavy-mineral (ilmenite/rutile) sands on beaches
  deposit('titanium', cnt(.5 + sq), i => biome[i] !== 1 || nearTown(i) ? NEG : Math.exp(-dO[i] / M(200)) + R(), M(6));
  // 7 diamond: one small kimberlite pipe on old, stable inland ground away from the ranges
  deposit('diamond', 1, i => h[i] < 60 * ez || h[i] > 450 * ez || slope[i] > 15 || mtnB(M(3000))[i] > .15 || dO[i] < M(2500) || nearTown(i) ? NEG : R(), M(6));
  // 8 uranium: rarest — one small body in the granite core of a range, remote
  deposit('uranium', 1, (i, x, y) => h[i] < 500 * ez || slope[i] > 40 || nearTown(i) || nearKm(x, y, ['city', 'town', 'village']) < M(4) ? NEG : mtnB(M(3000))[i] * 2 - axisD(x, y) + R() * .5, M(6));
  // non-ore minerals: coal seams in flat inland lowlands, salt pans on coastal flats
  deposit('coal', cnt(2 + sq), i => h[i] > 250 * ez || h[i] < 15 * ez || slope[i] > 8 || mtnB(M(4000))[i] > .1 || dO[i] < M(2000) || nearTown(i) ? NEG : flatB(M(1500))[i], M(5));
  deposit('salt', 1, i => !(biome[i] === 7 || biome[i] === 1) || h[i] > 3 || dO[i] > M(300) || slope[i] > 2 || nearTown(i) ? NEG : 1, M(5));
  for (const p of pois) if (p.type === 'mine') p.resources = ['stone', 'ore_iron'];
  // point resources: springs at river sources, fishing spots, hunting stands, clay pits
  { const heads = rivers.map(p => p[0][4]).filter(c => land[c] && reach[c]).sort((a, b) => h[b] - h[a]), got = [];
    for (const c of heads) { if (got.length >= cnt(6 + 6 * sq)) break; const x = c % n, y = c / n | 0; if (got.some(g => Math.hypot(g.x - x, g.y - y) * cell < M(1500)) || nearTown(c)) continue; got.push(P('spring', c, { resources: ['water'] })); } }
  for (const p of place('fishing', cnt(4 + 4 * sq), i => (dL[i] < cell * 1.5 ? 2 : 0) + (dO[i] < cell * 1.5 && riv[i] >= 2 ? 3 : 0) + (dO[i] < cell * 1.5 ? .5 : 0) + (riv[i] >= 3 ? 1 : 0) - (nearTown(i) ? 2 : 0), M(1.5), ['fishing', 'dock'])) p.resources = ['fish', 'water'];
  for (const p of place('hunting', cnt(2 + 2 * sq), i => res.game[i] * 3 - (slope[i] > 25 ? 2 : 0), M(4), ['hunting'])) p.resources = ['meat', 'hides'];
  for (const p of place('claypit', cnt(1 + sq), i => res.clay[i] > .5 ? res.clay[i] : NEG, M(4), ['claypit'])) p.resources = ['clay'];
  // salvage per built place (Survival_and_Progression.md materials: wood, cloth, scrap metal, chemicals, electronics, parts; + food, water, medical)
  const SALVAGE = {
    city: ['food', 'cloth', 'scrap', 'electronics', 'medical', 'parts'], town: ['food', 'cloth', 'scrap', 'parts'], village: ['food', 'cloth', 'wood'], farm: ['food', 'cloth', 'seeds', 'fuel'],
    safehouse: ['food', 'tools', 'wood'], industrial: ['scrap', 'chemicals', 'parts', 'fuel'], warehouse: ['parts', 'food', 'cloth', 'scrap'], logging: ['wood', 'tools', 'fuel'],
    fuel: ['fuel', 'food'], harbor: ['scrap', 'fuel', 'food', 'rope'], dock: ['fish', 'rope'], hospital: ['medical', 'chemicals'], clinic: ['medical'], pharmacy: ['medical', 'chemicals'],
    hardware: ['tools', 'parts', 'scrap'], garage: ['parts', 'fuel', 'tools'], military: ['ammo', 'weapons', 'electronics', 'medical', 'fuel'], airfield: ['fuel', 'parts', 'electronics'],
    airport: ['fuel', 'parts', 'electronics', 'food'], airstrip: ['fuel', 'parts'], radar: ['electronics', 'parts'], research: ['electronics', 'chemicals', 'medical'], outpost: ['electronics', 'chemicals'],
    secret: ['electronics', 'chemicals', 'alien_samples'], power: ['electronics', 'scrap', 'fuel'], substation: ['electronics', 'scrap'], comms: ['electronics'], radio: ['electronics'],
    store: ['food', 'cloth'], mall: ['food', 'cloth', 'electronics'], police: ['ammo', 'weapons', 'medical'], fire: ['tools', 'medical'], school: ['cloth', 'paper'], church: ['cloth'],
    vehicle: ['parts', 'fuel', 'scrap'], pickup: ['parts', 'fuel'], shipwreck: ['scrap', 'rope', 'cloth'], crash: ['electronics', 'parts', 'scrap', 'fuel'], cabin: ['wood', 'food', 'tools'],
    hut: ['food', 'cloth'], ranger: ['tools', 'medical', 'food'], campsite: ['food', 'cloth', 'fuel'], survivors: ['trade', 'food'], trader: ['trade'], raiders: ['ammo', 'weapons', 'food'],
    seed: ['alien_biomass', 'alien_tech'], nest: ['alien_biomass'], sporefield: ['alien_spores'], excavation: ['alien_tech', 'scrap'], lighthouse: ['fuel', 'electronics'],
    windfarm: ['electronics', 'parts'], water: ['chemicals', 'water'], dam: ['electronics', 'parts'], silo: ['food', 'seeds'], watertower: ['water'], pub: ['food'], diner: ['food'],
    motel: ['cloth', 'food'], bunker: ['ammo', 'parts'], checkpoint: ['ammo', 'weapons'], busdepot: ['parts', 'fuel', 'scrap'], stadium: ['scrap', 'cloth'], tunnel: ['scrap'],
    bank: ['scrap'], postoffice: ['paper', 'cloth'], library: ['paper'], townhall: ['paper', 'electronics'], hall: ['cloth', 'food'], cityhall: ['paper', 'electronics']
  };
  for (const p of pois) if (!p.resources) p.resources = SALVAGE[p.type] || [];
  // totals for the Info panel
  const resStats = { areaKm2: {} };
  for (const k of RES_KEYS) { let s = 0; for (let i = 0; i < N2; i++) s += res[k][i]; resStats.areaKm2[k] = s * cellKm2; }
  resStats.timberM3 = (resStats.areaKm2.softwood + resStats.areaKm2.hardwood) * 100 * 250;   // ~250 m³ standing timber per hectare
  resStats.deposits = {}; for (const p of deposits) resStats.deposits[p.type] = (resStats.deposits[p.type] || 0) + 1;

  // danger & loot per POI (Island_and_Biomes.md: mark high-risk POIs; early / mid / late regions)
  const RISKY = ['military', 'research', 'secret', 'seed', 'nest', 'sporefield', 'raiders', 'excavation', 'crash', 'airfield', 'radar', 'hospital'];
  const RICH = ['military', 'research', 'secret', 'hospital', 'airfield', 'mall', 'police', 'pharmacy', 'hardware', 'radar', 'crash'];
  for (const p of pois) {
    const z = zone[p.i] || 2, st = stageT[p.i] || 0; p.zone = z;
    p.danger = clamp(Math.round((z - 1) * .8 + st * .7 + (RISKY.includes(p.type) ? 1 : 0)), 0, 3);
    p.loot = clamp(z + (RICH.includes(p.type) ? 1 : 0), 1, 3);
  }

  // reality check: verify the rules hold on the final data (reported in Info)
  {
    const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < n && yi < n ? yi * n + xi : -1; };
    let uphill = 0, badEnd = 0;
    // (1) every river bed falls (or stays level) downstream; (2) after ALL edits, re-solve water on the final terrain:
    // Unexpected basins are undrained unless a mapped culvert drains them.
    const fin = priorityFlood(h, n); let undrained = 0;
    for (let i = 0; i < N2; i++) if (land[i] && !sagM[i] && fin.fl[i] - h[i] > .05) undrained++;
    reality.undrained = undrained;
    for (const p of rivers) {
      for (let j = 1; j < p.length; j++) if (p[j][3] > p[j - 1][3] + .001) uphill++;
      const ei = p.end; if (!(ocean[ei] || lakeId[ei] || riv[ei] || p.exitsMap)) badEnd++;
    }
    const LIM = { highway: .10, road: .155, trail: 1.2 }, steep = { highway: 0, road: 0, trail: 0 }, maxG = { highway: 0, road: 0, trail: 0 };
    for (const r of roads) {
      const p = r.path, span = Math.max(1, Math.round(40 / cell));   // grade over ~40 m of the built road (bridge decks follow the profile)
      const zz = p.map((c, j) => r.deck && r.deck[j] ? r.profile[j] : h[c]);   // on structures (incl. trail steps) you use the deck
      let g = 0; for (let j = 0; j + span < p.length; j += span) { const dd = r.dist ? r.dist[j + span] - r.dist[j] : span * cell; g = Math.max(g, Math.abs(zz[j + span] - zz[j]) / dd); }   // along-road distance
      maxG[r.type] = Math.max(maxG[r.type], g); if (g > LIM[r.type]) steep[r.type]++;
    }
    let wetB = 0, lowB = 0;
    for (const b of buildings) { const i = at(b.x / cell, b.y / cell); if (i < 0) continue; if (!land[i] || riv[i] >= 2) wetB++; if (b.kind !== 'industrial' && h[i] < 1.5) lowB++; }
    Object.assign(reality, { lakes: lakes.length, uphill, badEnd, steep, maxG, wetB, lowB });
  }

  // travel & density (Island_and_Biomes.md: use content-density and travel-time targets, not one headline size)
  const travel = { roadKm: { highway: 0, road: 0, trail: 0 } };
  {
    for (const r of roads) travel.roadKm[r.type] += r.len / 1000;
    let x0 = n, x1 = 0, y0 = n, y1 = 0; for (let i = 0; i < N2; i++) if (land[i]) { const x = i % n, y = i / n | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    travel.extentKm = Math.max(x1 - x0, y1 - y0) * cell / 1000;
    const adj = new Map(), addE = (a, b, w) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, w]); };
    for (const r of roads) { addE(r.a, r.b, r.len); addE(r.b, r.a, r.len); }
    if (start && city && start !== city) {
      const D = new Map([[start.name, 0]]), done = new Set();
      for (;;) { let u = null, du = Infinity; for (const [k2, v] of D) if (!done.has(k2) && v < du) { du = v; u = k2; } if (u === null || u === city.name) break; done.add(u);
        for (const [v, w] of adj.get(u) || []) if (du + w < (D.get(v) ?? Infinity)) D.set(v, du + w); }
      travel.startCityKm = D.has(city.name) ? D.get(city.name) / 1000 : null; travel.startCityLineKm = dk(start, city);
    }
    const deg = {}; for (const r of roads) if (r.type !== 'trail') { deg[r.a] = (deg[r.a] || 0) + 1; deg[r.b] = (deg[r.b] || 0) + 1; }
    travel.singleAccess = pois.filter(p => ['city', 'town'].includes(p.type) && (deg[p.name] || 0) < 2).map(p => p.name);   // dead-end villages are normal
  }

  // waterfalls: where a river channel drops steeply over a short run of the finished terrain. Named from their own random
  // stream so adding them leaves every other placement unchanged.
  {
    const fallR = mulberry(hashSeed(seedStr + ':falls')), FALL_MIN = Math.max(6, 12 * ez), run = Math.max(1.5 * cell, 50), cands = [];
    NAME.waterfall = () => cap(SYL[fallR() * SYL.length | 0] + SYL[fallR() * SYL.length | 0]) + ' Falls';
    for (const p of rivers) {
      if (p.distributary) continue;
      const z = p.map(q => terrainAt(h, n, cell, q[0] * cell, q[1] * cell)), s = [0];
      for (let j = 1; j < p.length; j++) s.push(s[j - 1] + Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]) * cell);
      for (let j = 0, k = 0; j < p.length - 1; j++) {
        if (p[j][2] < 2 * T) continue;
        k = Math.max(k, j + 1); while (k + 1 < p.length && s[k + 1] - s[j] <= run) k++;
        const drop = z[j] - z[k], horiz = s[k] - s[j];
        if (drop >= FALL_MIN && drop / (horiz || 1) >= .6) { const m = (j + k) >> 1, i = Math.round(p[m][1]) * n + Math.round(p[m][0]); if (land[i]) cands.push({ i, drop, width: widthOf(p[j][2]) }); }
      }
    }
    cands.sort((a, b) => b.drop - a.drop);
    const spacing = Math.max(M(3000), 8 * cell), got = [];
    for (const c of cands) {
      if (got.length >= cnt(4 + 8 * sq)) break;
      const x = c.i % n, y = c.i / n | 0; if (got.some(g => Math.hypot(g.x - x, g.y - y) * cell < spacing)) continue;
      got.push(P('waterfall', c.i, { dropM: Math.round(c.drop), riverWidthM: +c.width.toFixed(1) }));
    }
    reality.waterfalls = got.length;
  }

  // stats
  let landCells = 0, hmin = Infinity, hmax = -Infinity, rivCells = 0; const stageCnt = [0, 0, 0, 0], regCnt = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N2; i++) { if (land[i]) { landCells++; stageCnt[stageT[i]]++; regCnt[region[i]]++; } if (riv[i]) rivCells++; if (h[i] < hmin) hmin = h[i]; if (h[i] > hmax) hmax = h[i]; }
  const peakH = hmax; hmax += 15;            // headroom for the fine detail added to hi-res exports
  const ROADED = MINOR.concat(['city', 'town', 'harbor', 'airport']);
  const unreachable = pois.filter(p => ROADED.includes(p.type) && !reached.has(p)).map(p => p.name);
  for (const l of lakes) delete l.cells;
  { const c = {}; for (const p of pois) p.id = `${p.type}_${String(c[p.type] = (c[p.type] || 0) + 1).padStart(3, '0')}`; }   // stable per seed + settings
  for (const street of streets) { street.town = street.owner.id; delete street.owner; }
  for (const b of buildings) if (b.poi) { b.poiId = b.poi.id; delete b.poi; }
  const world = { ez, seed: seedStr, scenario, shape, mainland: !!mainland, terrainSettings, terrainBackend, terrainSeconds, sizeM, sc, n, k: Math.max(1, Math.round(2020 / n)), cell, h, ocean, lakeId, lakes, land, riv, acc, flow, rivers, riverW: widthOf, riverD: depthOf, riverT: T, hcache: {}, biome, moist, slope, shade, zone, region, stageT,
    pois, roads, corridors, corW: M(1500), hmin, hmax, slice, urban, buildings, streets, menuCam, reality, travel, rimL, chanM, floodM, roadBedM, resStats, deposits,
    res: Object.fromEntries(Object.entries(res).map(([k, a]) => [k, Uint8Array.from(a, v => Math.round(clamp(v, 0, 1) * 255))])),
    cstep: hmax > 1500 ? 50 : hmax > 600 ? 20 : 10,
    eco: { gw, eTer, eInf, eStage, eSeed },
    stats: { landKm2: landCells * cellKm2, riverKm: rivCells * cell / 1000, peak: peakH, stageCnt, regCnt, landCells, unreachable } };
  lapStage();
  return { world, stageTimes, terrainSeconds, terrainComputeLabel };
}

// ---------- running a generation: Web Worker when the page is served, same thread otherwise ----------
let genWorker = null, workerUnavailable = false, cancelRequested = false;
const inlineBuild = settings => buildWorld(settings, m => { if (cancelRequested) throw new GenerationCancelled(); $('status').textContent = m; });
function runBuild(settings) {
  // Chrome refuses module-less workers from file:// pages, so opening index.html directly keeps generation on the page
  if (workerUnavailable || typeof Worker === 'undefined' || typeof location === 'undefined' || location.protocol === 'file:') return inlineBuild(settings);
  return new Promise((resolve, reject) => {
    try { genWorker ??= new Worker('js/worker.js'); } catch (e) { workerUnavailable = true; return resolve(inlineBuild(settings)); }
    const w = genWorker;
    w.onmessage = ({ data }) => {
      if (data.status) $('status').textContent = data.status;
      else if (data.error) reject(Object.assign(new Error(data.error), { stack: data.stack }));
      else if (data.result) resolve(data.result);
    };
    w.onerror = e => {                       // the worker script itself failed to load or crashed: fall back to this thread
      e.preventDefault?.(); console.warn('Generation worker failed. Running on the page.', e.message);
      workerUnavailable = true; w.terminate(); genWorker = null; resolve(inlineBuild(settings));
    };
    runBuild.cancel = () => { w.terminate(); genWorker = null; reject(new GenerationCancelled()); };
    w.postMessage({ settings });
  });
}
function cancelGeneration() {
  cancelRequested = true;                    // same-thread build stops at its next stage
  runBuild.cancel?.();                       // worker build stops immediately
}

async function generate() {
  const t0 = performance.now(), settings = readGenSettings();
  cancelRequested = false; runBuild.cancel = null;
  const { world, stageTimes, terrainSeconds, terrainComputeLabel } = await runBuild(settings);
  runBuild.cancel = null;
  S = attachRiverFns(world);
  const story = S.scenario === 'desolation', tail0 = performance.now();
  $('status').textContent = '10/10 Rendering…';
  const ecologyMode = $('mode').querySelector('[value="ecology"]');
  ecologyMode.hidden = ecologyMode.disabled = !story;
  if (!story && $('mode').value === 'ecology') $('mode').value = 'terrain';
  poiEdits.length = 0; $('undoPoi').disabled = true;
  S.metro = buildMetro(S);
  for (const street of S.streets) street.grade = streetGrade(S, street.pts);
  auditRoadAccess(S);
  stageTimes.push(['10/10 Rendering', (performance.now() - tail0) / 1000]); S.stageTimes = stageTimes; S.stageTimes.push(['Base terrain (inside stage 1)', terrainSeconds]);
  console.table(stageTimes.map(([stage, seconds]) => ({ stage, seconds: +seconds.toFixed(2) })));
  render(); updateInfo(); updateTileInfo();
  $('status').textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s · Base terrain: ${terrainComputeLabel} (${terrainSeconds.toFixed(2)} s)`;
}
