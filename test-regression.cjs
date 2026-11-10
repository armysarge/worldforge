// Fixed-seed regression checks: same seed gives the same world, water always drains, every site has road access,
// and roads never run along a river. Run with `node test-regression.cjs`; WF_ROOT compares another copy of the project.
const assert = require('node:assert/strict'), { createApp } = require('./test-harness.cjs');
const SEEDS = [['r1', 'round'], ['r2', 'crescent'], ['r3', 'rolling'], ['r4', 'coastal'], ['r5', 'mountainous'], ['r6', 'twin'], ['r7', 'plateaus']];
// River beds must never rise downstream. Per-shape allowances can go here if a known exception ever returns.
const UPHILL_BUDGET = {};   // fixed: the bed is now forced to fall (or stay level) along every river
const fingerprint = w => { let a = 2166136261; for (let i = 0; i < w.h.length; i += 5) a = Math.imul(a ^ Math.round(w.h[i] * 10), 16777619); for (const r of w.roads) a = Math.imul(a ^ r.path.length, 16777619); return [a >>> 0, w.roads.length, w.pois.length, w.lakes.length, w.rivers.length].join('/'); };
const channelRun = w => { let best = 0; for (const r of w.roads) { let run = 0; for (const c of r.path) { if (w.chanM[c] || w.riv[c]) best = Math.max(best, ++run); else run = 0; } } return best * w.cell; };
(async () => {
  const app = createApp(), rows = [];
  for (const [seed, shape] of SEEDS) {
    const w = await app.generate({ seed, shape }), r = w.reality, ms = performance.now();
    assert.equal(r.undrained, 0, `${seed}: every land cell drains`);
    assert.equal(r.badEnd, 0, `${seed}: every river ends in the sea, a lake or the map edge`);
    assert((r.uphill || 0) <= (UPHILL_BUDGET[shape] ?? 0), `${seed}: river beds rising downstream (${r.uphill}) exceed the known budget`);
    assert.equal(w.stats.unreachable.length, 0, `${seed}: every site has road access`);
    assert(channelRun(w) <= 170, `${seed}: a road follows a river for ${Math.round(channelRun(w))} m`);
    assert(w.roads.every(rd => rd.path.length > 1 && rd.pts.every(p => p.every(Number.isFinite))), `${seed}: roads are finite polylines`);
    assert(w.h.every(Number.isFinite), `${seed}: finite heights`);
    for (let i = 0; i < w.h.length; i++) if (w.floodM[i]) assert(w.land[i] && !w.chanM[i] && !w.lakeId[i], `${seed}: floodplain is land beside the channel`);
    for (const f of w.pois.filter(p => p.type === 'waterfall')) assert(w.land[f.i] && f.dropM >= 6 && / Falls$/.test(f.name), `${seed}: waterfall ${f.name}`);
    const towns = w.pois.filter(p => p.radius);
    for (let i = 0; i < w.h.length; i++) if (w.biome[i] === 9) {
      assert(!w.urban[i], `${seed}: no farmland under buildings`);
      const x = i % w.n, y = i / w.n | 0; assert(!towns.some(p => Math.hypot(p.x - x, p.y - y) * w.cell < p.radius), `${seed}: no farmland inside a settlement`);
    }
    for (const rv of w.rivers.filter(rv => rv.distributary)) assert(w.ocean[rv.end], `${seed}: delta branches reach the sea`);
    rows.push({ seed, shape, roads: w.roads.length, pois: w.pois.length, rivers: w.rivers.length, deltas: r.deltas, 'flood km²': +r.floodplainKm2.toFixed(1), falls: r.waterfalls, uphill: r.uphill || 0, 'river run m': Math.round(channelRun(w)), fingerprint: fingerprint(w) });
  }
  for (const level of ['light', 'strong']) {
    const e = await app.generate({ seed: 'r5', shape: 'mountainous', hydraulic: level }), r = e.reality;
    assert(r.erosion && r.erosion.incisedM > 0 && r.undrained === 0 && r.badEnd === 0 && e.stats.unreachable.length === 0 && e.h.every(Number.isFinite), `erosion ${level} keeps the world valid`);
  }
  app.set('hydraulic', 'off');
  const plain = await app.generate({ seed: 'r4', shape: 'coastal', landforms: 'off' });
  assert(!plain.floodM.some(Boolean) && !plain.rivers.some(rv => rv.distributary), 'River landforms off adds no floodplain or delta');
  app.set('landforms', 'on');
  const again = await app.generate({ seed: SEEDS[0][0], shape: SEEDS[0][1] });
  assert.equal(fingerprint(again), rows[0].fingerprint, 'regenerating a seed reproduces the identical world');
  console.table(rows); console.log(`Regression checks passed for ${SEEDS.length} seeds, determinism confirmed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
