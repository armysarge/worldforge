// Runs the real js/worker.js in a worker thread (with a small Web Worker shim) and checks the world it sends back
// matches the same-thread build exactly, so moving generation off the page changes nothing.
const assert = require('node:assert/strict'), path = require('node:path'), { Worker } = require('node:worker_threads'), { createApp } = require('./test-harness.cjs');
const SHIM = `
const { parentPort, workerData } = require('node:worker_threads'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
globalThis.onmessage = null;
globalThis.postMessage = (msg, transfer) => parentPort.postMessage(msg, transfer);
globalThis.importScripts = (...files) => { for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(workerData.dir, f), 'utf8'), { filename: f }); };
importScripts('worker.js');
parentPort.on('message', data => globalThis.onmessage({ data }));`;
const settings = { seed: 'worker-1', scenario: 'sandbox', fp: '16', shape: 'crescent', size: '505', compute: 'cpu', mtn: '1', lakes: '6', riv: '1', elevation: '.5', erosion: '.3', snowLine: '.8', terrainScale: '.01' };
const viaWorker = () => new Promise((resolve, reject) => {
  const w = new Worker(SHIM, { eval: true, workerData: { dir: path.join(__dirname, 'js') } }), statuses = [];
  w.on('message', m => { if (m.status) statuses.push(m.status); else { w.terminate(); m.error ? reject(new Error(m.error + '\n' + m.stack)) : resolve({ ...m.result, statuses }); } });
  w.on('error', reject); w.postMessage({ settings });
});
const same = (a, b, at = 'world') => {
  if (ArrayBuffer.isView(a)) { assert(ArrayBuffer.isView(b) && a.length === b.length, at + ' length'); for (let i = 0; i < a.length; i++) if (!(a[i] === b[i] || (a[i] !== a[i] && b[i] !== b[i]))) assert.fail(`${at}[${i}] ${a[i]} != ${b[i]}`); return; }
  if (a && typeof a === 'object') { if (a instanceof Map || a instanceof Set) return assert.equal(a.size, b.size, at); for (const k of Object.keys(a)) if (typeof a[k] !== 'function' && !/Seconds$|^stageTimes$/.test(k)) same(a[k], b?.[k], at + '.' + k); return; }
  if (!(a === b || (a !== a && b !== b))) assert.fail(`${at}: ${a} != ${b}`);
};
(async () => {
  const fromWorker = await viaWorker(), app = createApp(), inline = await app.api.buildWorld(settings);
  assert(fromWorker.statuses.length >= 10 && fromWorker.statuses[0].startsWith('1/10'), 'progress messages reach the page');
  assert.equal(fromWorker.world.riverW, undefined, 'functions are stripped before posting');
  same(inline.world, fromWorker.world);
  assert(fromWorker.world.h instanceof Float32Array && fromWorker.world.roads.length > 10);
  const pending = app.generate({ seed: 'cancel-me' }); app.api.cancelGeneration();
  await assert.rejects(pending, e => e.name === 'GenerationCancelled', 'Cancel stops a same-thread build at its next stage');
  console.log(`Worker build matches the same-thread build (${fromWorker.statuses.length} progress messages, ${fromWorker.world.roads.length} roads)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
