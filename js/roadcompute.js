"use strict";

const ROAD_JUMP_SHADER = `
@group(0) @binding(0) var<storage, read> cfg: array<f32>;
@group(0) @binding(1) var<storage, read> height: array<f32>;
@group(0) @binding(2) var<storage, read> cellFlags: array<u32>;
@group(0) @binding(3) var<storage, read_write> candidates: array<u32>;

fn flags(i: u32) -> u32 {
  return (cellFlags[i >> 3u] >> ((i & 7u) * 4u)) & 15u;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = u32(cfg[0]);
  if (id.x >= n || id.y >= n) { return; }
  let i = id.y * n + id.x;
  if ((flags(i) & 4u) == 0u) { return; }

  let start = vec2<i32>(id.xy);
  let hc = height[i];
  var mask = 0u;
  for (var group = 0u; group < u32(cfg[2]); group++) {
    let j = 19u + group * 4u;
    let len = i32(cfg[j]);
    let grade = cfg[j + 1u];
    let tunnel = cfg[j + 2u] > 0.0;
    let viaduct = cfg[j + 3u] > 0.0;
    for (var d = 0u; d < 8u; d++) {
      let step = vec2<i32>(i32(cfg[3u + d]), i32(cfg[11u + d]));
      let end = start + step * len;
      if (any(end < vec2<i32>(1)) || any(end >= vec2<i32>(i32(n) - 1))) { continue; }
      let dest = u32(end.y) * n + u32(end.x);
      if ((flags(dest) & 2u) == 0u) { continue; }
      let he = height[dest];
      let span = cfg[1] * f32(len) * select(1.0, 1.4142, step.x != 0 && step.y != 0);
      // Leave rounding room so only the CPU can reject a borderline structure.
      let slack = max(0.02, max(abs(hc), abs(he)) * 0.000002);
      if (abs(he - hc) > grade * span + slack) { continue; }
      var above = -1e30;
      var below = 1e30;
      var valid = true;
      for (var t = 1; t < len; t += max(1, len >> 3u)) {
        let p = start + t * step;
        let k = u32(p.y) * n + u32(p.x);
        if ((flags(k) & 1u) == 0u) { valid = false; break; }
        let dz = height[k] - (hc + (he - hc) * f32(t) / f32(len));
        above = max(above, dz);
        below = min(below, dz);
      }
      if (valid && ((tunnel && below > -2.0 - slack && above > 60.0 - slack) ||
          (viaduct && above < 2.0 + slack && below < -35.0 + slack))) {
        mask |= 1u << (group * 8u + d);
      }
    }
  }
  candidates[i] = mask;
}
`;

async function buildRoadJumpMasks(n, cell, h, land, riv, slope, base, groups) {
  try {
    const gpu = await getTerrainCompute();
    if (!gpu) return null;
    const { device } = gpu;
    gpu.roadPipeline ??= device.createComputePipelineAsync({ layout: 'auto',
      compute: { module: device.createShaderModule({ code: ROAD_JUMP_SHADER }), entryPoint: 'main' } });
    const pipeline = await gpu.roadPipeline;
    const config = new Float32Array([n, cell, groups.length, ...DX, ...DY, ...groups.flat()]);
    const flags = new Uint32Array(Math.ceil(h.length / 8));
    for (let i = 0; i < h.length; i++) {
      const bits = (land[i] || riv[i] ? 1 : 0) | (base[i] < 1e8 ? 2 : 0) | (slope[i] > 8 ? 4 : 0);
      flags[i >> 3] |= bits << ((i & 7) * 4);
    }
    return await runTerrainKernel(device, pipeline, [config, h, flags], h.byteLength, n,
      result => new Uint32Array(result.slice(0)));
  } catch (error) {
    console.warn('WebGPU road screening failed. Using CPU.', error);
    return null;
  }
}
