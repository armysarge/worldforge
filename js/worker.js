"use strict";
// Runs buildWorld off the page so the UI stays responsive. Loaded by runBuild() in terrain.js when the page is served over http(s).
importScripts('core.js', 'hydrology.js', 'baseterrain.js', 'roadcompute.js', 'terrain.js', 'grading.js');

// every typed-array buffer in the world, so they move to the page instead of being copied
function transferables(world) {
  const out = new Set(), visit = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 2) return;
    if (ArrayBuffer.isView(v)) { if (v.buffer.byteLength) out.add(v.buffer); return; }
    for (const x of Array.isArray(v) ? [] : Object.values(v)) visit(x, depth + 1);
  };
  visit(world, 0);
  return [...out];
}
onmessage = async ({ data }) => {
  try {
    const result = await buildWorld(data.settings, status => postMessage({ status }));
    delete result.world.riverW; delete result.world.riverD;          // rebuilt on the page by attachRiverFns
    postMessage({ result }, transferables(result.world));
  } catch (e) {
    postMessage({ error: e.message, stack: e.stack });
  }
};
