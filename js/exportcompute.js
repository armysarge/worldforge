"use strict";

// WebGPU pass for export-resolution heights: the Catmull-Rom upsample of the generation grid and the added fine relief,
// one output sample per GPU thread. This is the per-sample part of buildHeightWindow in exports.js; cutting the river
// channels, filling dips and grading roads and pads stay on the CPU because each depends on its neighbours' results.
// The arithmetic mirrors the CPU version line for line (32-bit instead of 64-bit, so heights differ by well under a millimetre).
const DETAIL_SHADER = `
@group(0) @binding(0) var<storage, read> cfg: array<f32>;
@group(0) @binding(1) var<storage, read> tables: array<f32>;
@group(0) @binding(2) var<storage, read> height: array<f32>;
@group(0) @binding(3) var<storage, read> calm: array<f32>;
@group(0) @binding(4) var<storage, read> slope: array<f32>;
@group(0) @binding(5) var<storage, read> cover: array<u32>;
@group(0) @binding(6) var<storage, read_write> result: array<f32>;

fn grad(cell: vec2<i32>, d: vec2<f32>) -> f32 {
  let k = u32(tables[u32(tables[u32(cell.x & 255)]) + u32(cell.y & 255)]);
  return tables[512u + k] * d.x + tables[768u + k] * d.y;
}
fn noise(p: vec2<f32>) -> f32 {
  let origin = floor(p);
  let cell = vec2<i32>(origin);
  let t = p - origin;
  let u = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  let a = grad(cell, t);
  let b = grad(cell + vec2<i32>(1, 0), t - vec2<f32>(1, 0));
  let c = grad(cell + vec2<i32>(0, 1), t - vec2<f32>(0, 1));
  let d = grad(cell + vec2<i32>(1, 1), t - vec2<f32>(1, 1));
  let top = a + (b - a) * u.x;
  return (top + (c + (d - c) * u.x - top) * u.y) * 1.41;
}
fn fbm4(p: vec2<f32>) -> f32 {
  var sum = 0.0;
  var total = 0.0;
  var amp = 1.0;
  var freq = 1.0;
  for (var i = 0u; i < 4u; i++) {
    sum += amp * noise(p * freq + f32(i) * vec2<f32>(17.3, 9.1));
    total += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / total;
}
fn cr(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}
fn rowAt(n: i32, y: i32, i: i32, t: f32) -> f32 {
  let r = y * n;
  return cr(height[r + max(0, i - 1)], height[r + i], height[r + i + 1], height[r + min(n - 1, i + 2)], t);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = i32(cfg[0]);
  let N = u32(cfg[1]);
  if (id.x >= N || id.y >= u32(cfg[17])) { return; }       // cfg[17] = rows in this band
  let f = cfg[4];
  let cellH = cfg[5];
  let gx = (cfg[2] + f32(id.x)) * f;
  let gy = (cfg[3] + f32(id.y)) * f;
  let i = min(n - 2, i32(floor(gx)));
  let j = min(n - 2, i32(floor(gy)));
  let tx = gx - f32(i);
  let ty = gy - f32(j);
  var h = cr(rowAt(n, max(0, j - 1), i, tx), rowAt(n, j, i, tx), rowAt(n, j + 1, i, tx), rowAt(n, min(n - 1, j + 2), i, tx), ty);
  let o = id.y * N + id.x;

  let near = min(n - 1, i32(floor(gy + 0.5))) * n + min(n - 1, i32(floor(gx + 0.5)));
  let c = cover[near];
  if ((c & 1u) == 1u && h > 0.3) {
    let ci = j * n + i;
    let quiet = mix(mix(calm[ci], calm[ci + 1], tx), mix(calm[ci + n], calm[ci + n + 1], tx), ty);
    let keep = 1.0 - smoothstep(0.02, 0.45, quiet);
    if (keep > 0.0) {
      let biome = (c >> 1u) & 15u;
      let rock = biome >= 4u && biome <= 6u;
      let tanv = min(tan(slope[near] / 57.2958), 1.2);
      let amp = min(40.0, cellH * (0.3 + 2.0 * tanv) * cfg[7u + biome]) * smoothstep(0.0, 3.0, h) * keep;
      let p = (vec2<f32>(cfg[2], cfg[3]) + vec2<f32>(id.xy)) / 24.0;
      var v = 0.0;
      if (cfg[6] > 0.0) { v = fbm4(vec2<f32>(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y)); } else { v = fbm4(p); }
      if (rock) { v = 0.5 - abs(v) * 1.5; }
      h = max(0.3, h + v * amp);
    }
  }
  result[o] = h;
}
`;

// N × N window of upsampled, detailed heights from the GPU, or null when WebGPU is unavailable, the buffers are too large
// for the device, or the pass fails (the caller then uses the CPU path).
async function upsampleDetailGPU(world, N, ox, oy, quads, source, calm) {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    const gpu = await getTerrainCompute();
    if (!gpu) return null;
    const { device } = gpu, { n } = world, cells = n * n;
    gpu.detailPipeline ??= device.createComputePipelineAsync({ layout: 'auto',
      compute: { module: device.createShaderModule({ code: DETAIL_SHADER }), entryPoint: 'main' } });
    const pipeline = await gpu.detailPipeline;
    const noise = mkNoise(mulberry(hashSeed(world.seed) ^ 0x9e3779b9)), { p, gx, gy } = noise.tables, tables = new Float32Array(1024);
    tables.set(p); tables.set(gx, 512); tables.set(gy, 768);
    world.coverGPU ??= Uint32Array.from({ length: cells }, (_, i) => (world.land[i] ? 1 : 0) | (world.biome[i] << 1));
    // The result buffer for a whole 8129 x 8129 export (264 MB) is larger than a GPU buffer binding may be, so the image is
    // computed in horizontal bands that each fit, top to bottom, and joined here.
    const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize, 1 << 27);
    const bandRows = Math.max(8, Math.min(N, globalThis.WF_GPU_BAND_ROWS || Math.floor(limit / (N * 4))));
    const out = bandRows >= N ? null : new Float32Array(N * N);
    for (let y0 = 0; y0 < N; y0 += bandRows) {
      const rows = Math.min(bandRows, N - y0);
      const config = new Float32Array([n, N, ox, oy + y0, (n - 1) / quads, world.sizeM / quads, quads > N - 1 ? 1 : 0, ...DETAIL_GAIN, rows]);
      const part = await runTerrainKernel(device, pipeline, [config, tables, source, calm, world.slope, world.coverGPU], rows * N * 4, N,
        result => new Float32Array(result.slice(0)));
      if (!part) return null;
      if (!out) return part;
      out.set(part, y0 * N);
    }
    return out;
  } catch (error) {
    console.warn('WebGPU export detail failed. Using CPU.', error);
    return null;
  }
}
