"use strict";

// ---------- hydrology: depression filling, flow routing and river carving ----------
// priority-flood (Barnes et al.): fl = water surface if every basin filled to its spill point; flow = drainage parent
function priorityFlood(h, n) {
  const N2 = n * n, fl = new Float32Array(N2), flow = new Int32Array(N2).fill(-1), order = new Int32Array(N2), seen = new Uint8Array(N2), hp = heap(N2);
  let oc = 0;
  for (let i = 0; i < N2; i++) { const x = i % n, y = i / n | 0; if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { seen[i] = 1; fl[i] = h[i]; hp.push(h[i], i); } }
  while (hp.size) {
    const c = hp.pop(); order[oc++] = c; const L = fl[c], cx = c % n, cy = c / n | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx; if (seen[ni]) continue;
      seen[ni] = 1; fl[ni] = h[ni] > L ? h[ni] : L; flow[ni] = c; hp.push(fl[ni], ni);
    }
  }
  return { fl, flow, order, oc };
}
// carve river polylines (grid coords × sc → target grid) into heightmap h (n×n, cell metres)
function carveRivers(h, n, cell, rivers, sc, widthOf, depthOf, floor = null, mark = null, { ox = 0, oy = 0, quads = n - 1, openEdge = false } = {}) {
  const original = h.slice(), margin = openEdge ? 0 : 1;
  for (const p of rivers) for (let j = 0; j < p.length - 1; j++) {
    const x0 = p[j][0] * sc, y0 = p[j][1] * sc, ra = p[j][2], b0 = p[j][3], x1 = p[j + 1][0] * sc, y1 = p[j + 1][1] * sc, b1 = p[j + 1][3];
    const hw = Math.max(.5, widthOf(ra) / 2 / cell), dep = depthOf(ra), bank = Math.max(2, dep / (.2 * cell)), r = hw + bank, dx = x1 - x0, dy = y1 - y0;
    for (let y = Math.max(margin, oy, Math.floor(Math.min(y0, y1) - r)); y <= Math.min(quads - margin, oy + n - 1, Math.ceil(Math.max(y0, y1) + r)); y++)
      for (let x = Math.max(margin, ox, Math.floor(Math.min(x0, x1) - r)); x <= Math.min(quads - margin, ox + n - 1, Math.ceil(Math.max(x0, x1) + r)); x++) {
        const t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1), d = Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
        if (d >= r) continue;
        const i = (y - oy) * n + x - ox, bed = lerp(b0, b1, t);
        const fade = d <= hw ? 1 : 1 - sstep(0, 1, (d - hw) / bank);
        let tgt = Math.max(-3, lerp(original[i], bed, fade)); if (floor) tgt = Math.max(tgt, floor(i));
        if (tgt < h[i]) h[i] = tgt;
        if (mark && d <= hw + 1) mark[i] = 1;
      }
  }
}
