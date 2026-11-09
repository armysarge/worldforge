const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const grid = html.match(/<select id="size">([\s\S]*?)<\/select>/)[1];
assert.match(grid, /<option value="4033">/, '4033 is available as a generation grid');
const exportCode = fs.readFileSync(path.join(__dirname, 'js', 'exports.js'), 'utf8');
const source = exportCode.slice(exportCode.indexOf('function encodeHeightLE('), exportCode.indexOf("$('xUnity').onclick"));
let selected = 4033, requested, saved = [];
const world = {seed: 'test', scenario: 'sandbox', sizeM: 16000, hmin: -100, hmax: 900};
const context = {
  Blob, S: world, expN: () => selected,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  exportH: async (n, sourceWorld) => {
    assert.strictEqual(sourceWorld, world);
    requested = n;
    context.S = {hmin: 0, hmax: 1};
    return [-100, 400, 900];
  },
  tag: n => `test_${n}`, save: (blob, name) => saved.push({blob, name}), $: () => ({})
};
vm.createContext(context); vm.runInContext(source, context);
(async () => {
  await context.exportEngineHeight('unity'); assert.strictEqual(requested, 4097); assert(saved[0].name.endsWith('_unity.raw'));
  assert.deepStrictEqual(Array.from(new Uint8Array(await saved[0].blob.arrayBuffer())), [0,0,0,128,255,255]);
  const meta = JSON.parse(await saved[1].blob.text()); assert.strictEqual(meta.width, 4097); assert.strictEqual(meta.verticalRangeMeters, 1000); assert.strictEqual(meta.sampleSpacingMeters, 16000/4096); assert.strictEqual(meta.scenario, 'sandbox');
  for (const size of [4033, 8129]) {
    selected = size; context.S = world; saved = [];
    await context.exportEngineHeight('godot');
    assert.strictEqual(requested, size);
    assert(saved[0].name.endsWith('_godot.raw'));
    assert.strictEqual(JSON.parse(await saved[1].blob.text()).width, size);
  }
  console.log('Unity and Godot RAW exports: resolution, byte order and metadata passed');
})().catch(e => {console.error(e); process.exitCode=1});
