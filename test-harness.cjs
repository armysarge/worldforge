// Loads the browser app (index.html scripts) into Node with a stub DOM so generation and the pure export functions can be tested.
// WF_ROOT=<dir> points at another copy of the project (used to compare against an older version).
const fs = require('node:fs'), path = require('node:path');
function createApp({ root = process.env.WF_ROOT || __dirname, navigator = {} } = {}) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appCode = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(([, src]) => fs.readFileSync(path.join(root, src), 'utf8')).join('\n');
  const settings = { seed: 'x', scenario: 'sandbox', size: '505', fp: '16', shape: 'random', mtn: '1', lakes: '6', riv: '1', elevation: '.5', erosion: '.3', snowLine: '.8', terrainScale: '.01', mode: 'terrain', xres: '0', compute: 'cpu' };
  const elements = new Map(), make = () => ({ style: {}, checked: false, addEventListener() {}, getContext() {}, querySelector() { return {}; }, querySelectorAll() { return []; }, replaceChildren() {}, append() {} });
  const document = { createElement: make, getElementById: id => (elements.has(id) || elements.set(id, { ...make(), value: settings[id] ?? '' }), elements.get(id)) };
  const exported = ['buildGeoJson', 'buildTerrainMesh', 'encodeGlb', 'encodeObj', 'normalMapPixels', 'settingsSnapshot', 'settingsToHash', 'settingsFromHash', 'applySettings', 'worldData']
    .map(n => `typeof ${n} === 'function' ? ${n} : undefined`).join(', ');
  const names = ['buildWorld', 'cancelGeneration', 'buildGeoJson', 'buildTerrainMesh', 'encodeGlb', 'encodeObj', 'normalMapPixels', 'settingsSnapshot', 'settingsToHash', 'settingsFromHash', 'applySettings', 'worldData'];
  const code = appCode.replace(/\nstartApp\(\);\s*$/, `\nrender = () => {}; const fns = {}; ${names.map(n => `if (typeof ${n} === 'function') fns.${n} = ${n};`).join(' ')} return { ...fns, generateWorld: async () => { await generate(); return S; } };`);
  const api = new Function('document', 'addEventListener', 'navigator', code)(document, () => {}, navigator);
  const set = (id, value) => { document.getElementById(id).value = value; };
  const origTable = console.table;
  return { api, document, set, async generate(overrides = {}) { for (const [k, v] of Object.entries(overrides)) set(k, v); console.table = () => {}; try { return await api.generateWorld(); } finally { console.table = origTable; } } };
}
module.exports = { createApp };
