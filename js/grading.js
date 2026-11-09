"use strict";

// ---------- terrain sampling and grading ----------
function terrainAt(h, n, cell, xm, ym) {
  const gx = clamp(xm / cell, 0, n - 1.001), gy = clamp(ym / cell, 0, n - 1.001);
  const x = gx | 0, y = gy | 0, tx = gx - x, ty = gy - y, i = y * n + x;
  return lerp(lerp(h[i], h[i + 1], tx), lerp(h[i + n], h[i + n + 1], tx), ty);
}
const hAt = (x, y) => terrainAt(S.h, S.n, S.cell, x, y);

function streetGrade(world, pts) {
  const levels = pts.map(([x, y]) => terrainAt(world.h, world.n, world.cell, x, y));
  const grade = levels.map((z, i) => i === 0 || i === levels.length - 1 ? z : (levels[i - 1] + 2 * z + levels[i + 1]) / 4);
  for (let i = 1; i < grade.length; i++) {
    const step = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * .12;
    grade[i] = clamp(grade[i], grade[i - 1] - step, grade[i - 1] + step);
  }
  return grade;
}
function gradeSites(height, N, world, ox = 0, oy = 0, quads = N - 1) {
  const pitch = world.sizeM / quads, g = (world.n - 1) / quads;
  const stamp = (x0, y0, x1, y1, margin, sample) => {
    for (let y = Math.max(oy, Math.ceil((y0 - margin) / pitch)); y <= Math.min(oy + N - 1, Math.floor((y1 + margin) / pitch)); y++) {
      for (let x = Math.max(ox, Math.ceil((x0 - margin) / pitch)); x <= Math.min(ox + N - 1, Math.floor((x1 + margin) / pitch)); x++) {
        const i = Math.round(y * g) * world.n + Math.round(x * g), j = (y - oy) * N + x - ox;
        if (world.land[i] && !world.chanM[i] && !world.riv[i] && !Number.isFinite(world.rimL[i]))
          height[j] = sample(x * pitch, y * pitch, height[j]);
      }
    }
  };
  const gradeLine = (pts, z, width, scale, deck) => {
    if (!z) return;
    const hw = width / 2, feather = 5, margin = hw + feather;
    for (let i = 1; i < pts.length; i++) {
      if (deck && (deck[i - 1] || deck[i])) continue;
      const ax = pts[i - 1][0] * scale, ay = pts[i - 1][1] * scale, bx = pts[i][0] * scale, by = pts[i][1] * scale;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      stamp(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), margin, (x, y, base) => {
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
        const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
        return lerp(base, lerp(z[i - 1], z[i], t), 1 - sstep(hw, margin, d));
      });
    }
  };
  for (const r of world.roads) if (r.type !== 'trail') gradeLine(r.pts, r.profile, r.type === 'highway' ? 12 : 7, world.cell, r.deck);
  for (const s of world.streets) gradeLine(s.pts, s.grade, s.w, 1);
  for (const b of world.buildings) {
    if (b.kind === 'park' || b.kind === 'cemetery') continue;
    const c = Math.cos(b.a), s = Math.sin(b.a), r = Math.hypot(b.w, b.d) / 2 + 5;
    stamp(b.x, b.y, b.x, b.y, r, (x, y, base) => {
      const dx = x - b.x, dy = y - b.y;
      const outside = Math.max(Math.abs(dx * c + dy * s) - b.w / 2, Math.abs(-dx * s + dy * c) - b.d / 2);
      return lerp(base, b.z, 1 - sstep(0, 4, outside));
    });
  }
  return height;
}
