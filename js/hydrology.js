"use strict";

// ---------- hydrology: depression filling, flow routing and river carving ----------
// priority-flood (Barnes et al.): fl = water surface if every basin filled to its spill point; flow = drainage parent
function priorityFlood(h, n) {
  const N2 = n * n, fl = new Float32Array(N2), flow = new Int32Array(N2).fill(-1), order = new Int32Array(N2), seen = new Uint8Array(N2), hp = heap(N2);
  let oc = 0;
  for (let i = 0; i < N2; i++) { const x = i % n, y = i / n | 0; if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { seen[i] = 1; fl[i] = h[i]; hp.push(h[i], i); } }
  // cells at or below the level being flooded (hollows, flats, filled ground) go through a plain queue instead of the heap:
  // they are already at the water level, so they need no sorting. This is the Priority-Flood variant of Barnes et al. (2014).
  const pit = new Int32Array(N2); let qh = 0, qt = 0;
  while (qh < qt || hp.size) {
    const c = qh < qt ? pit[qh++] : hp.pop(); order[oc++] = c; const L = fl[c], cx = c % n, cy = c / n | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx; if (seen[ni]) continue;
      seen[ni] = 1; flow[ni] = c;
      if (h[ni] > L) { fl[ni] = h[ni]; hp.push(h[ni], ni); } else { fl[ni] = L; pit[qt++] = ni; }
    }
  }
  return { fl, flow, order, oc };
}
// carve river polylines (grid coords × sc → target grid) into heightmap h (n×n, cell metres)
function carveRivers(h, n, cell, rivers, sc, widthOf, depthOf, floor = null, mark = null, { ox = 0, oy = 0, quads = n - 1, openEdge = false, uncut = null } = {}) {
  const original = h.slice(), margin = openEdge ? 0 : 1;
  for (const p of rivers) for (let j = 0; j < p.length - 1; j++) {
    const x0 = p[j][0] * sc, y0 = p[j][1] * sc, ra = p[j][2], b0 = p[j][3], x1 = p[j + 1][0] * sc, y1 = p[j + 1][1] * sc, b1 = p[j + 1][3];
    // bed half-width, then a bank that eases up to the ground: at least 2.5 cells (so the grid can represent it), never
    // steeper than about 1 in 5, and wider beside wide rivers
    const keep = uncut ? uncut(ra) : false;                              // marked-only reach: note where it runs, cut nothing
    const wm = widthOf(ra), hw = Math.max(.9, wm / 2 / cell), dep = depthOf(ra), bank = Math.max(2.5, dep * 5 / cell, wm * .75 / cell), r = hw + bank, dx = x1 - x0, dy = y1 - y0;
    for (let y = Math.max(margin, oy, Math.floor(Math.min(y0, y1) - r)); y <= Math.min(quads - margin, oy + n - 1, Math.ceil(Math.max(y0, y1) + r)); y++)
      for (let x = Math.max(margin, ox, Math.floor(Math.min(x0, x1) - r)); x <= Math.min(quads - margin, ox + n - 1, Math.ceil(Math.max(x0, x1) + r)); x++) {
        const t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1), d = Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
        if (d >= r) continue;
        const i = (y - oy) * n + x - ox, bed = lerp(b0, b1, t);
        const fade = d <= hw ? 1 : 1 - sstep(0, 1, (d - hw) / bank);
        let tgt = Math.max(-3, lerp(original[i], bed, fade)); if (floor) tgt = Math.max(tgt, floor(i));
        if (!keep && tgt < h[i]) h[i] = tgt;
        if (mark && d <= Math.max(.5, wm / 2 / cell) + 1) mark[i] = 1;
      }
  }
}

// ---------- erosion: implicit stream-power incision + thermal relaxation ----------
// Each iteration routes drainage (priority flood), accumulates catchment area, then lowers every cell towards its receiver
// with the implicit stream-power update of Braun & Willett (2013): h_i <- (h_i + f*h_r) / (1 + f), f = K * sqrt(A) / L.
// It is unconditionally stable and processes cells downstream-first, so a whole river profile responds in one pass.
// A thermal pass then lets over-steep valley walls slump to the talus angle (slopes that were already cliffs are kept).
// Large grids are eroded on a stride-sampled 505 grid and the height change is interpolated back, so cost stays bounded.
function erodeTerrain(h, n, cell, { iterations = 20, strength = .012, talus = .84, maxN = 505 } = {}) {
  const k = n > maxN && (n - 1) % (maxN - 1) === 0 ? (n - 1) / (maxN - 1) : 1, m = (n - 1) / k + 1, mc = cell * k;
  const g = k === 1 ? h : new Float32Array(m * m);
  if (k > 1) for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) g[y * m + x] = h[y * k * n + x * k];
  const before = k > 1 ? g.slice() : null, N2 = m * m, A = new Float64Array(N2), cellKm2 = mc * mc / 1e6, refL = 30;
  // slopes already steeper than the talus angle (sea cliffs, escarpments) are landforms of the base terrain: never slump them
  const keep = new Uint8Array(N2);
  for (let i = 0; i < N2; i++) { const x = i % m, y = i / m | 0;
    for (let d = 0; d < 8; d++) { const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= m || ny >= m) continue;
      if (Math.abs(g[i] - g[ny * m + nx]) > talus * mc * (DX[d] && DY[d] ? Math.SQRT2 : 1)) { keep[i] = 1; break; } } }
  let incised = 0, slumped = 0;
  const D = new Float32Array(N2);
  for (let it = 0; it < iterations; it++) {
    const { fl, flow, order, oc } = priorityFlood(g, m);
    // drain each cell to its steepest-descent neighbour on the filled surface (the flood's own parent is just the first
    // neighbour reached, which carves parallel diagonal grooves); flats and lake floors keep the flood's routing
    for (let i = 0; i < N2; i++) {
      const x = i % m, y = i / m | 0; let best = 0, br = -1;
      for (let d = 0; d < 8; d++) { const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= m || ny >= m) continue;
        const j = ny * m + nx, s = (fl[i] - fl[j]) / (DX[d] && DY[d] ? Math.SQRT2 : 1); if (s > best) { best = s; br = j; } }
      if (br >= 0) flow[i] = br;
    }
    A.fill(cellKm2);
    for (let q = oc - 1; q >= 0; q--) { const i = order[q], r = flow[i]; if (r >= 0) A[r] += A[i]; }
    for (let q = 0; q < oc; q++) {                                   // downstream first: receivers are already updated
      const i = order[q], r = flow[i]; if (r < 0 || g[i] <= .5) continue;   // sea floor and the coast line are not incised
      const hr = g[r]; if (g[i] <= hr) continue;                          // a pit or lake floor: water spills, nothing to cut
      const diag = (i % m !== r % m) && ((i / m | 0) !== (r / m | 0)), f = strength * Math.sqrt(A[i]) * refL / (mc * (diag ? Math.SQRT2 : 1));
      const nh = Math.max((g[i] + f * hr) / (1 + f), .5);              // land stays land
      incised += g[i] - nh; g[i] = nh;
    }
    D.fill(0);
    for (let i = 0; i < N2; i++) {                                    // each pair once (east, south-west, south, south-east)
      const x = i % m, y = i / m | 0;
      for (const d of [4, 5, 6, 7]) {
        const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= m || ny >= m) continue;
        const j = ny * m + nx, hi = g[i] > g[j] ? i : j, lo = hi === i ? j : i;
        if (keep[hi] || g[hi] <= .5) continue;
        const lim = talus * mc * (DX[d] && DY[d] ? Math.SQRT2 : 1), ex = g[hi] - g[lo] - lim; if (ex <= 0) continue;
        const mv = ex * .25; D[hi] -= mv; D[lo] += mv; slumped += mv;
      }
    }
    for (let i = 0; i < N2; i++) g[i] += D[i];
  }
  if (k > 1) {                                                         // interpolate the coarse change back onto the full grid
    for (let y = 0; y < n; y++) { const gy = y / k, y0 = Math.min(m - 2, gy | 0), ty = gy - y0;
      for (let x = 0; x < n; x++) { const gx = x / k, x0 = Math.min(m - 2, gx | 0), tx = gx - x0, a = y0 * m + x0;
        const dd = (g[a] - before[a]) * (1 - tx) * (1 - ty) + (g[a + 1] - before[a + 1]) * tx * (1 - ty) + (g[a + m] - before[a + m]) * (1 - tx) * ty + (g[a + m + 1] - before[a + m + 1]) * tx * ty;
        const i = y * n + x; h[i] = h[i] > .5 ? Math.max(.5, h[i] + dd) : h[i] + Math.min(0, dd); } }
  }
  return { incisedM: incised, slumpedM: slumped, iterations, grid: m };
}

