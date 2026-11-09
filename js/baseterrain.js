"use strict";

// ---------- base terrain: island outlines, mainland profiles, CPU and WebGPU height field ----------
const SHAPES = ['round', 'elongated', 'crescent', 'twin', 'branching', 'archipelago', 'hook', 'inlets', 'headlands'], LAND_FRAC = .4;
const MAINLAND = {
  rolling: { offsets: [-.32, .27], width: .13, amplitude: 85, relief: .3 },
  mountainous: { offsets: [-.32, .29], width: .095, amplitude: 2450, relief: .75 },
  plateaus: { offsets: [-.26, .32], width: .11, amplitude: 90, relief: .22 },
  coastal: { offsets: [.22, .41], width: .12, amplitude: 1250, relief: .72 }
};
const PROFILE_SIZE = 257;
function buildMainlandProfile(shape, F, ca, sa, scale) {
  const profile = new Float32Array(PROFILE_SIZE ** 2);
  for (let y = 0; y < PROFILE_SIZE; y++) for (let x = 0; x < PROFILE_SIZE; x++) {
    const u = x / (PROFILE_SIZE - 1), v = y / (PROFILE_SIZE - 1), dx = u - .5, dy = v - .5;
    const along = dx * ca + dy * sa, across = dy * ca - dx * sa;
    const broad = F(u * 3.4 * scale + 22, v * 3.4 * scale + 22, 3);
    let s;
    if (shape === 'rolling') s = .16 + .075 * broad + .095 * along;
    else if (shape === 'mountainous') {
      const valley = across + .075 * F(along * 3 + 17, 24, 3);
      s = .135 + .27 * sstep(.045, .27, Math.abs(valley)) + .055 * along + .035 * broad;
    } else if (shape === 'plateaus') {
      const terrace = .56 * Math.abs(across) + .32 * broad;
      s = .12 + .105 * along + .06 * sstep(.07, .105, terrace) + .075 * sstep(.16, .195, terrace) + .12 * sstep(.245, .28, terrace);
    } else {
      const shore = across + .145 + .12 * broad;
      s = 1.25 * shore + .095 * sstep(.008, .075, shore) * sstep(-.12, .27, broad);
    }
    profile[y * PROFILE_SIZE + x] = s;
  }
  return profile;
}
function sampleProfile(profile, u, v) {
  const x = u * (PROFILE_SIZE - 1), y = v * (PROFILE_SIZE - 1);
  const ix = Math.min(PROFILE_SIZE - 2, Math.floor(x)), iy = Math.min(PROFILE_SIZE - 2, Math.floor(y));
  const i = iy * PROFILE_SIZE + ix, t = x - ix;
  return lerp(lerp(profile[i], profile[i + 1], t), lerp(profile[i + PROFILE_SIZE], profile[i + PROFILE_SIZE + 1], t), y - iy);
}

function buildBaseTerrainCPU({ n, OC, off, ez, ranges, noise, shapeAt, frequency = 1, elevation = 1, relief = 1 }) {
  const h = new Float32Array(n * n), sMap = new Float32Array(n * n), F = (x, y, o) => fbm(noise, x, y, o);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, u = x / (n - 1), v = y / (n - 1);
    const s = shapeAt(u, v) + off;
    sMap[i] = s;
    if (s <= 0) { h[i] = s * 500 * ez * elevation; continue; }
    const inl = sstep(0, .35, s);
    let m = 0;
    for (const r of ranges) {
      let dd = 9; for (let q = 0; q < 4; q++) dd = Math.min(dd, distSeg(u, v, r.pts[q][0], r.pts[q][1], r.pts[q + 1][0], r.pts[q + 1][1]));
      m = Math.max(m, Math.exp(-((dd / r.w) ** 2)) * r.amp);
    }
    const fu = u * frequency, fv = v * frequency;
    const rid = Math.pow(clamp(1 - Math.abs(F(fu * 7 + 70, fv * 7 + 70, OC)) * 2, 0, 1), 2);
    const hills = Math.max((F(fu * 5 + 20, fv * 5 + 20, OC) + .35) * 260 * inl + F(fu * 24 + 3, fv * 24 + 3, OC - 1) * 70 * sstep(0, .15, s) + F(fu * 60 + 8, fv * 60 + 8, OC - 2) * 12, -60);
    // Metre-scale relief breaks the parallel drainage lines that form on smooth plains.
    h[i] = (((40 + 240 * Math.pow(inl, 1.3) + hills * relief) * ez + m * (.3 + .7 * rid)) * sstep(0, .06, s)
      + Math.max(0, (noise(x * .23 + 500, y * .23 + 500) * 2 + noise(x * .07 + 90, y * .07 + 90) * 4 + 3) * ez) * sstep(0, .012, s)) * elevation;
  }
  return { h, sMap };
}

const TERRAIN_SHADER = `
@group(0) @binding(0) var<storage, read> cfg: array<f32>;
@group(0) @binding(1) var<storage, read> tables: array<f32>;
@group(0) @binding(2) var<storage, read_write> terrain: array<f32>;

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
fn fbm(p: vec2<f32>, octaves: u32) -> f32 {
  var sum = 0.0;
  var total = 0.0;
  var amp = 1.0;
  var freq = 1.0;
  for (var i = 0u; i < octaves; i++) {
    sum += amp * noise(p * freq + f32(i) * vec2<f32>(17.3, 9.1));
    total += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / total;
}
fn blob(i: u32, p: vec2<f32>) -> f32 {
  let d = p - vec2<f32>(cfg[i], cfg[i + 1u]);
  let radii = vec2<f32>(cfg[i + 2u], cfg[i + 3u]);
  let c = cfg[i + 4u];
  let s = cfg[i + 5u];
  return 2.0 * sqrt(radii.x * radii.y) *
    (1.0 - length(vec2<f32>(d.x * c + d.y * s, d.y * c - d.x * s) / radii));
}
fn coastline(p: vec2<f32>, nAdd: u32, nSub: u32) -> f32 {
  let warped = p + 0.13 * vec2<f32>(fbm(p * 3.0 + vec2<f32>(5.0), 3u), fbm(p * 3.0 + vec2<f32>(40.0), 3u));
  var m = -9.0;
  for (var i = 0u; i < nAdd; i++) { m = max(m, blob(11u + i * 6u, warped)); }
  var e = 0.0;
  for (var i = 0u; i < nAdd; i++) { e += exp(20.0 * (blob(11u + i * 6u, warped) - m)); }
  var s = m + log(e) / 20.0;
  for (var i = nAdd; i < nAdd + nSub; i++) { s = min(s, -blob(11u + i * 6u, warped)); }
  let edge = min(min(p.x, p.y), min(1.0 - p.x, 1.0 - p.y));
  return s + 0.26 * fbm(p * 2.2 + vec2<f32>(9.0), 5u) - (1.0 - smoothstep(0.0, 0.08, edge)) * 0.6;
}
fn ridgeHeight(start: u32, count: u32, p: vec2<f32>) -> f32 {
  var m = 0.0;
  for (var r = 0u; r < count; r++) {
    let i = start + r * 12u;
    var dd = 9.0;
    for (var q = 0u; q < 4u; q++) {
      let j = i + 2u + q * 2u;
      let a = vec2<f32>(cfg[j], cfg[j + 1u]);
      let delta = vec2<f32>(cfg[j + 2u], cfg[j + 3u]) - a;
      let t = clamp(dot(p - a, delta) / max(dot(delta, delta), 1e-12), 0.0, 1.0);
      dd = min(dd, length(p - a - t * delta));
    }
    let distance = dd / cfg[i];
    m = max(m, exp(-distance * distance) * cfg[i + 1u]);
  }
  return m;
}
fn profileHeight(start: u32, side: u32, p: vec2<f32>) -> f32 {
  let xy = p * f32(side - 1u);
  let cell = min(vec2<u32>(floor(xy)), vec2<u32>(side - 2u));
  let t = xy - vec2<f32>(cell);
  let i = start + cell.y * side + cell.x;
  return mix(mix(cfg[i], cfg[i + 1u], t.x), mix(cfg[i + side], cfg[i + side + 1u], t.x), t.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = u32(cfg[0]);
  if (id.x >= n || id.y >= n) { return; }
  let i = id.y * n + id.x;
  let xy = vec2<f32>(id.xy);
  let p = xy / f32(n - 1u);
  let nAdd = u32(cfg[4]);
  let nSub = u32(cfg[5]);
  let nRidges = u32(cfg[6]);
  let ridgeStart = 11u + (nAdd + nSub) * 6u;
  let profileSide = u32(cfg[7]);
  var s: f32;
  if (profileSide > 0u) {
    s = profileHeight(ridgeStart + nRidges * 12u, profileSide, p);
  } else {
    s = coastline(p, nAdd, nSub) + cfg[2];
  }
  let ez = cfg[3];
  let elevation = cfg[9];
  terrain[n * n + i] = s;
  if (s <= 0.0) {
    terrain[i] = s * 500.0 * ez * elevation;
    return;
  }
  let inl = smoothstep(0.0, 0.35, s);
  let m = ridgeHeight(ridgeStart, nRidges, p);
  let octaves = u32(cfg[1]);
  let detail = p * cfg[8];
  let rid = clamp(1.0 - abs(fbm(detail * 7.0 + vec2<f32>(70.0), octaves)) * 2.0, 0.0, 1.0);
  let hills = max((fbm(detail * 5.0 + vec2<f32>(20.0), octaves) + 0.35) * 260.0 * inl
    + fbm(detail * 24.0 + vec2<f32>(3.0), octaves - 1u) * 70.0 * smoothstep(0.0, 0.15, s)
    + fbm(detail * 60.0 + vec2<f32>(8.0), octaves - 2u) * 12.0, -60.0);
  terrain[i] = (((40.0 + 240.0 * pow(inl, 1.3) + hills * cfg[10]) * ez + m * (0.3 + 0.7 * rid * rid)) * smoothstep(0.0, 0.06, s)
    + max(0.0, (noise(xy * 0.23 + vec2<f32>(500.0)) * 2.0 + noise(xy * 0.07 + vec2<f32>(90.0)) * 4.0 + 3.0) * ez)
    * smoothstep(0.0, 0.012, s)) * elevation;
}
`;
let terrainCompute;
async function initTerrainCompute() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter || adapter.info?.isFallbackAdapter) return null;
  const device = await adapter.requestDevice();
  try {
    const module = device.createShaderModule({ code: TERRAIN_SHADER });
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    device.lost.then(() => { terrainCompute = undefined; });
    return { device, pipeline };
  } catch (error) {
    device.destroy();
    throw error;
  }
}
async function buildBaseTerrainGPU({ n, OC, off, ez, add, sub, ranges, noise, profile, frequency = 1, elevation = 1, relief = 1 }) {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  const buffers = [];
  try {
    const gpu = await (terrainCompute ??= initTerrainCompute().catch(error => {
      terrainCompute = undefined;
      throw error;
    }));
    if (!gpu) return null;
    const { device, pipeline } = gpu, cells = n * n, bytes = cells * 8;
    if (bytes > device.limits.maxStorageBufferBindingSize) return null;
    // The CPU builds the same mainland profile for both backends.
    const header = [n, OC, off, ez, add.length, sub.length, ranges.length, profile ? PROFILE_SIZE : 0, frequency, elevation, relief,
      ...[...add, ...sub].flatMap(({ x, y, rx, ry, c, s }) => [x, y, rx, ry, c, s]),
      ...ranges.flatMap(({ w, amp, pts }) => [w, amp, ...pts.flat()])];
    const config = new Float32Array(header.length + (profile?.length ?? 0));
    config.set(header);
    if (profile) config.set(profile, header.length);
    const { p, gx, gy } = noise.tables, tables = new Float32Array(1024);
    tables.set(p); tables.set(gx, 512); tables.set(gy, 768);
    const allocate = (size, usage) => {
      const buffer = device.createBuffer({ size, usage });
      buffers.push(buffer);
      return buffer;
    };
    let read;
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('internal');
    try {
      const cfg = allocate(config.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const lookup = allocate(tables.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const out = allocate(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      read = allocate(bytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(cfg, 0, config);
      device.queue.writeBuffer(lookup, 0, tables);
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [cfg, lookup, out].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8));
      pass.end();
      encoder.copyBufferToBuffer(out, 0, read, 0, bytes);
      device.queue.submit([encoder.finish()]);
    } finally {
      const errors = await Promise.all([device.popErrorScope(), device.popErrorScope(), device.popErrorScope()]);
      const error = errors.find(Boolean);
      if (error) throw new Error(error.message);
    }
    await read.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(read.getMappedRange());
    return { h: values.slice(0, cells), sMap: values.slice(cells) };
  } catch (error) {
    console.warn('WebGPU terrain failed. Using CPU.', error);
    return null;
  } finally {
    for (const buffer of buffers) buffer.destroy();
  }
}
