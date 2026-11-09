// Roads may cross a river channel (bridge) but must never run along or on top of one.
// WF_ROOT=<dir> points the check at another copy of the project (used to compare against an older terrain.js).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = process.env.WF_ROOT || __dirname, html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appCode = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(([, src]) => fs.readFileSync(path.join(root, src), 'utf8')).join('\n');
const elements = new Map(), settings = { seed: 'x', scenario: 'sandbox', size: '505', fp: '16', shape: 'random', mtn: '1', lakes: '6', riv: '1', mode: 'terrain', xres: '0', compute: 'cpu' };
const mk = () => ({ style: {}, checked: false, addEventListener() {}, getContext() {}, querySelector() { return {}; }, querySelectorAll() { return []; }, replaceChildren() {}, append() {} });
const document = { createElement: mk, getElementById: id => (elements.has(id) || elements.set(id, { ...mk(), value: settings[id] || '' }), elements.get(id)) };
const code = appCode.replace(/\nstartApp\(\);\s*$/, '\nrender = () => {}; return async () => { await generate(); return S; };');
const set = (id, v) => { document.getElementById(id).value = v; };
const quiet = fn => async (...a) => { const t = console.table; console.table = () => {}; try { return await fn(...a); } finally { console.table = t; } };
(async () => {
  const generate = quiet(new Function('document', 'addEventListener', 'navigator', code)(document, () => {}, {}));
  let worst = 0, onChanM = 0, roadM = 0, rows = [];
  for (const [seed, shape] of [['harbor-fog', 'crescent'], ['a1', 'rolling'], ['b2', 'mountainous'], ['c3', 'plateaus'], ['d4', 'round'], ['e5', 'elongated'], ['f6', 'twin'], ['g7', 'coastal'], ['h8', 'inlets']]) {
    set('seed', seed); set('shape', shape);
    const w = await generate(), { chanM, riv, cell } = w;
    let maxRun = 0, onChan = 0, total = 0;
    for (const r of w.roads) { let run = 0; for (const c of r.path) { total++; if (chanM[c] || riv[c]) { onChan++; maxRun = Math.max(maxRun, ++run); } else run = 0; } }
    worst = Math.max(worst, maxRun * cell); onChanM += onChan * cell; roadM += total * cell;
    rows.push({ seed, shape, roads: w.roads.length, 'longest run in channel (m)': Math.round(maxRun * cell), 'road in channel %': +(100 * onChan / total).toFixed(1), unavoidable: w.reality.riverRoadRuns || 0, 'no road access': w.stats.unreachable.length });
  }
  console.table(rows); console.log(`overall: ${(100 * onChanM / roadM).toFixed(1)}% of road length lies in a river channel; longest run ${Math.round(worst)} m`);
  if (!process.env.WF_ROOT) assert(worst <= 170, 'no road may follow a river channel for more than a bridge span');
})().catch(e => { console.error(e); process.exitCode = 1; });
