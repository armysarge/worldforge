"use strict";

// ---------- terrain mesh (GLB / OBJ) and normal map export ----------
// Frame: x east, y up (elevation, metres), z south, so the map reads north-up from above. Triangles wind counter-clockwise from above.
function buildTerrainMesh(world, M) {
  const { h, n, cell, sizeM } = world, step = sizeM / (M - 1), count = M * M;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), height = new Float32Array(count);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i, z = terrainAt(h, n, cell, i * step, j * step);
    height[k] = z; positions[3 * k] = i * step; positions[3 * k + 1] = z; positions[3 * k + 2] = j * step;
  }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i, hx = height[j * M + Math.min(M - 1, i + 1)] - height[j * M + Math.max(0, i - 1)], hz = height[Math.min(M - 1, j + 1) * M + i] - height[Math.max(0, j - 1) * M + i];
    const sx = (Math.min(M - 1, i + 1) - Math.max(0, i - 1)) * step, sz = (Math.min(M - 1, j + 1) - Math.max(0, j - 1)) * step;
    const nx = -hx / sx, nz = -hz / sz, len = Math.hypot(nx, 1, nz);
    normals[3 * k] = nx / len; normals[3 * k + 1] = 1 / len; normals[3 * k + 2] = nz / len;
  }
  const indices = new Uint32Array((M - 1) * (M - 1) * 6);
  let t = 0;
  for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + M, c = a + 1, d = b + 1;
    indices[t++] = a; indices[t++] = b; indices[t++] = c; indices[t++] = c; indices[t++] = b; indices[t++] = d;
  }
  return { positions, normals, indices, size: M, sizeM };
}
function encodeGlb(mesh) {
  const { positions, normals, indices } = mesh, vertexCount = positions.length / 3;
  let minP = [Infinity, Infinity, Infinity], maxP = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const a = i % 3; minP[a] = Math.min(minP[a], positions[i]); maxP[a] = Math.max(maxP[a], positions[i]); }
  const posBytes = positions.byteLength, nrmBytes = normals.byteLength, idxBytes = indices.byteLength, binLen = posBytes + nrmBytes + idxBytes;
  const json = {
    asset: { version: '2.0', generator: 'Worldforge' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Terrain' }],
    meshes: [{ name: 'Terrain', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    buffers: [{ byteLength: binLen }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 }, { buffer: 0, byteOffset: posBytes, byteLength: nrmBytes, target: 34962 }, { buffer: 0, byteOffset: posBytes + nrmBytes, byteLength: idxBytes, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min: minP, max: maxP }, { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' }]
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (len, to = 4) => (to - len % to) % to, jsonLen = text.length + pad(text.length), total = 12 + 8 + jsonLen + 8 + binLen + pad(binLen);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546C67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);                       // 'glTF', version 2
  view.setUint32(12, jsonLen, true); view.setUint32(16, 0x4E4F534A, true); out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + jsonLen);   // JSON chunk, space padded
  let o = 20 + jsonLen; view.setUint32(o, binLen + pad(binLen), true); view.setUint32(o + 4, 0x004E4942, true); o += 8;     // BIN chunk
  out.set(new Uint8Array(positions.buffer, positions.byteOffset, posBytes), o); out.set(new Uint8Array(normals.buffer, normals.byteOffset, nrmBytes), o + posBytes);
  out.set(new Uint8Array(indices.buffer, indices.byteOffset, idxBytes), o + posBytes + nrmBytes);
  return out;
}
function encodeObj(mesh, name = 'terrain') {
  const { positions, normals, indices } = mesh, lines = [`# Worldforge terrain, metres. x east, y up, z south`, `o ${name}`];
  for (let i = 0; i < positions.length; i += 3) lines.push(`v ${positions[i].toFixed(2)} ${positions[i + 1].toFixed(2)} ${positions[i + 2].toFixed(2)}`);
  for (let i = 0; i < normals.length; i += 3) lines.push(`vn ${normals[i].toFixed(4)} ${normals[i + 1].toFixed(4)} ${normals[i + 2].toFixed(4)}`);
  for (let i = 0; i < indices.length; i += 3) { const a = indices[i] + 1, b = indices[i + 1] + 1, c = indices[i + 2] + 1; lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`); }
  return lines.join('\n') + '\n';
}
// world-space normal map from a height field: R = east, G = north (OpenGL / Unity / Godot convention), B = up. Flip G for DirectX / Unreal.
function normalMapPixels(heights, N, sizeM) {
  const cellE = sizeM / (N - 1), out = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const x0 = Math.max(0, x - 1), x1 = Math.min(N - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(N - 1, y + 1);
    const dx = (heights[y * N + x1] - heights[y * N + x0]) / ((x1 - x0) * cellE), dn = (heights[y0 * N + x] - heights[y1 * N + x]) / ((y1 - y0) * cellE), len = Math.hypot(dx, dn, 1), o = 4 * (y * N + x);
    out[o] = (-dx / len * .5 + .5) * 255; out[o + 1] = (-dn / len * .5 + .5) * 255; out[o + 2] = (1 / len * .5 + .5) * 255; out[o + 3] = 255;
  }
  return out;
}
if (typeof $ === 'function') {
  const meshRes = () => +$('xMeshRes').value || 513, fail = e => { $('status').textContent = 'Export error: ' + e.message; console.error(e); };
  const run = async (label, fn) => { if (!S) return; $('status').textContent = label + '…'; await new Promise(r => setTimeout(r, 20)); try { await fn(); } catch (e) { fail(e); } };
  $('xGlb').onclick = () => run('Building mesh', () => { const m = buildTerrainMesh(S, meshRes()); save(new Blob([encodeGlb(m)], { type: 'model/gltf-binary' }), tag(m.size) + '_mesh.glb'); $('status').textContent = `Mesh exported (${m.size}×${m.size}, ${(m.indices.length / 3).toLocaleString()} triangles)`; });
  $('xObj').onclick = () => run('Building mesh', () => { const m = buildTerrainMesh(S, meshRes()); save(new Blob([encodeObj(m)], { type: 'model/obj' }), tag(m.size) + '_mesh.obj'); $('status').textContent = `Mesh exported (${m.size}×${m.size}, ${(m.indices.length / 3).toLocaleString()} triangles)`; });
  $('xNormal').onclick = () => run('Building normal map', async () => {
    const N = expN(), heights = await exportH(N), c = document.createElement('canvas'); c.width = c.height = N;
    const ctx = c.getContext('2d'), img = ctx.createImageData(N, N); img.data.set(normalMapPixels(heights, N, S.sizeM)); ctx.putImageData(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r)); if (!blob) throw Error('PNG encoding failed at this export size.');
    save(blob, tag(N) + '_normal.png'); $('status').textContent = 'Normal map exported (G = north; flip G for Unreal)';
  });
}
