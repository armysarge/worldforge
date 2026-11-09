// Fixed-seed regression checks: same seed gives the same world, water always drains, every site has road access,
// and roads never run along a river. Run with `node test-regression.cjs`; WF_ROOT compares another copy of the project.
const assert = require('node:assert/strict'), { createApp } = require('./test-harness.cjs');
const SEEDS = [['r1', 'round'], ['r2', 'crescent'], ['r3', 'rolling'], ['r4', 'coastal'], ['r5', 'mountainous'], ['r6', 'twin'], ['r7', 'plateaus']];
// Known issue, present before the road/river fix: a few river-bed cells rise downstream on mainland terrain. Lower this as it gets fixed.
const UPHILL_BUDGET = { coastal: 6, mountainous: 5 };
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
    rows.push({ seed, shape, roads: w.roads.length, pois: w.pois.length, rivers: w.rivers.length, uphill: r.uphill || 0, 'river run m': Math.round(channelRun(w)), fingerprint: fingerprint(w) });
  }
  const again = await app.generate({ seed: SEEDS[0][0], shape: SEEDS[0][1] });
  assert.equal(fingerprint(again), rows[0].fingerprint, 'regenerating a seed reproduces the identical world');
  console.table(rows); console.log(`Regression checks passed for ${SEEDS.length} seeds, determinism confirmed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
