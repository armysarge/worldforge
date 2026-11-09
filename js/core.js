"use strict";
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- random / noise ----------
function hashSeed(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mkNoise(R) {
  const a = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = R() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  const p = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  for (let i = 0; i < 256; i++) { const t = R() * 6.2832; gx[i] = Math.cos(t); gy[i] = Math.sin(t); }
  const f = t => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (ix, iy, dx, dy) => { const k = p[p[ix & 255] + (iy & 255)]; return gx[k] * dx + gy[k] * dy; };
  const sample = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = f(xf), v = f(yf);
    const a0 = g(xi, yi, xf, yf), a1 = g(xi + 1, yi, xf - 1, yf), b0 = g(xi, yi + 1, xf, yf - 1), b1 = g(xi + 1, yi + 1, xf - 1, yf - 1);
    const top = a0 + (a1 - a0) * u;
    return (top + (b0 + (b1 - b0) * u - top) * v) * 1.41;
  };
  sample.tables = { p, gx, gy };
  return sample;
}
const fbm = (nz, x, y, o = 5) => { let s = 0, a = 1, t = 0, f = 1; for (let i = 0; i < o; i++) { s += a * nz(x * f + i * 17.3, y * f + i * 9.1); t += a; a *= .5; f *= 2; } return s / t; };

// ---------- data structures ----------
function heap(cap = 1 << 16) {
  let k = new Float64Array(cap), v = new Int32Array(cap), n = 0, top = 0;
  return {
    get size() { return n; },
    get key() { return top; },          // key of the item last popped
    push(key, val) {
      if (n === k.length) { const k2 = new Float64Array(n * 2); k2.set(k); k = k2; const v2 = new Int32Array(n * 2); v2.set(v); v = v2; }
      let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    },
    pop() {
      const r = v[0]; top = k[0]; const lk = k[--n], lv = v[n]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv; return r;
    }
  };
}
function blur(a, n, r, t = new Float32Array(n * n), o = new Float32Array(n * n)) {   // separable box blur, outside = 0
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let s = 0; const b = y * n;
    for (let x = 0; x <= r && x < n; x++) s += a[b + x];
    for (let x = 0; x < n; x++) { t[b + x] = s / w; if (x + r + 1 < n) s += a[b + x + r + 1]; if (x - r >= 0) s -= a[b + x - r]; }
  }
  for (let x = 0; x < n; x++) {
    let s = 0;
    for (let y = 0; y <= r && y < n; y++) s += t[y * n + x];
    for (let y = 0; y < n; y++) { o[y * n + x] = s / w; if (y + r + 1 < n) s += t[(y + r + 1) * n + x]; if (y - r >= 0) s -= t[(y - r) * n + x]; }
  }
  return o;
}
function chamfer(n, cell, src) {               // distance (m) to nearest src cell
  const D = new Float32Array(n * n).fill(1e9), a = cell, b = cell * 1.4142;
  for (let i = 0; i < n * n; i++) if (src[i]) D[i] = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let d = D[i];
    if (x > 0) { d = Math.min(d, D[i - 1] + a); if (y > 0) d = Math.min(d, D[i - n - 1] + b); }
    if (y > 0) { d = Math.min(d, D[i - n] + a); if (x < n - 1) d = Math.min(d, D[i - n + 1] + b); }
    D[i] = d;
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x; let d = D[i];
    if (x < n - 1) { d = Math.min(d, D[i + 1] + a); if (y < n - 1) d = Math.min(d, D[i + n + 1] + b); }
    if (y < n - 1) { d = Math.min(d, D[i + n] + a); if (x > 0) d = Math.min(d, D[i + n - 1] + b); }
    D[i] = d;
  }
  return D;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
function dijkstra(w, cost, src) {              // 8-neighbour cost distance on a w×w grid
  const D = new Float32Array(w * w).fill(Infinity), CL = new Uint8Array(w * w), q = heap(); D[src] = 0; q.push(0, src);
  while (q.size) {
    const c = q.pop(); if (CL[c]) continue; CL[c] = 1; const cx = c % w, cy = c / w | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
      const ni = ny * w + nx; if (CL[ni] || !(cost[ni] < 1e8)) continue;
      const g = D[c] + (DX[d] && DY[d] ? 1.4142 : 1) * (cost[c] + cost[ni]) / 2; if (g < D[ni]) { D[ni] = g; q.push(g, ni); }
    }
  }
  return D;
}
