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
          height[j] = sample(x * pitch, y * pitch, height[j], j);
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
  const shaping = world.shaping || {};
  // lakes marked only: the lake bed is not exported as a hollow, the ground is level at the water line
  if (shaping.lakes === 'mark' && world.lakes && world.lakes.length) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const id = world.lakeId[Math.round((oy + y) * g) * world.n + Math.round((ox + x) * g)]; if (id) { const j = y * N + x, level = world.lakes[id - 1].level; if (height[j] < level) height[j] = level; } }
  }
  if (shaping.roads !== 'mark') {
    for (const r of world.roads) if (r.type !== 'trail') gradeLine(r.pts, r.profile, r.type === 'highway' ? 12 : 7, world.cell, r.deck);
    for (const s of world.streets) gradeLine(s.pts, s.grade, s.w, 1);
  }
  if (shaping.buildings === 'mark') return height;                         // buildings marked only: no pads
  // Building pads. Neighbouring pads on a slope sit at different levels, so they are blended rather than stamped one
  // over the other: every sample takes the weighted mean of the pads that reach it (a pad's own footprint outweighs a
  // neighbour's apron about fifty to one, so pads stay level) and moves towards that mean by the strongest pull on it.
  const slot = new Map(), sumW = [], sumWZ = [], maxW = [], cells = [];
  for (const b of world.buildings) {
    if (b.kind === 'park' || b.kind === 'cemetery') continue;
    // the pad meets the ground over an apron no steeper than about 1 in 3: wider where the footprint spans more fall,
    // and never narrower than 4 m or two height samples (a narrower apron reads as a wall around the building)
    const c = Math.cos(b.a), s = Math.sin(b.a);
    let dz = 0;
    if (world.h) for (const u of [-b.w / 2, b.w / 2]) for (const v of [-b.d / 2, b.d / 2]) dz = Math.max(dz, Math.abs(terrainAt(world.h, world.n, world.cell, b.x + u * c - v * s, b.y + u * s + v * c) - b.z));
    const apron = Math.min(30, Math.max(4, 2 * pitch, 3 * dz)), r = Math.hypot(b.w, b.d) / 2 + apron + 1;
    stamp(b.x, b.y, b.x, b.y, r, (x, y, base, j) => {
      const dx = x - b.x, dy = y - b.y;
      const ox = Math.abs(dx * c + dy * s) - b.w / 2, oy = Math.abs(-dx * s + dy * c) - b.d / 2;
      const outside = ox > 0 && oy > 0 ? Math.hypot(ox, oy) : Math.max(ox, oy);        // rounded apron corners
      const pull = 1 - sstep(0, apron, outside);
      if (pull > 0) {
        let k = slot.get(j); if (k === undefined) { slot.set(j, k = cells.length); cells.push(j); sumW.push(0); sumWZ.push(0); maxW.push(0); }
        const w = pull / (1.02 - pull); sumW[k] += w; sumWZ[k] += w * b.z; if (pull > maxW[k]) maxW[k] = pull;
      }
      return base;
    });
  }
  for (let k = 0; k < cells.length; k++) height[cells[k]] = lerp(height[cells[k]], sumWZ[k] / sumW[k], maxW[k]);
  return height;
}
