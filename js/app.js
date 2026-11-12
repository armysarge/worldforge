"use strict";

// ---------- point-of-interest editing ----------
function buildMetro(world) {
  const stops = world.pois.filter(p => p.type === 'tunnel').sort((a, b) => a.x - b.x || a.y - b.y), links = [];
  let minZ = Infinity;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], count = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) * world.cell / 12));
    const points = Array.from({ length: count + 1 }, (_, j) => [lerp(a.x, b.x, j / count) * world.cell, lerp(a.y, b.y, j / count) * world.cell]);
    for (const [x, y] of points) minZ = Math.min(minZ, terrainAt(world.h, world.n, world.cell, x, y));
    links.push({ from: a.id, to: b.id, widthM: 8, points });
  }
  for (const link of links) for (const point of link.points) point.push(Math.floor(minZ) - 12);
  return links;
}
const ROADSIDE_POIS = new Set([
  'hospital', 'clinic', 'police', 'fire', 'school', 'tunnel', 'cityhall', 'townhall', 'church', 'store', 'trader',
  'mall', 'stadium', 'busdepot', 'fuel', 'motel', 'checkpoint', 'warehouse', 'substation', 'power', 'water',
  'garage', 'pharmacy', 'hardware', 'pub', 'diner', 'postoffice', 'library', 'bank', 'hall', 'park', 'cemetery',
  'watertower', 'silo', 'farm', 'safehouse', 'industrial', 'harbor', 'dock', 'airport', 'airfield', 'airstrip',
  'military', 'research', 'mine', 'windfarm', 'logging', 'survivors'
]);
const ANCHORED_POIS = new Set(['waterfall', 'bridge', 'portal', 'viaduct', 'pass', 'dam', 'harbor', 'dock', 'rig', 'shipwreck', 'seastack', 'peak', 'spring', 'fishing', 'claypit']);
const poiEdits = [];
function roadAccess(world, x, y, limit) {
  let result = null, closest = limit;
  const scan = (pts, scale, w, kind, deck) => {
    for (let j = 1; j < pts.length; j++) {
      if (deck && ([1, 2, 3, 6].includes(deck[j - 1]) || [1, 2, 3, 6].includes(deck[j]))) continue;
      const ax = pts[j - 1][0] * scale, ay = pts[j - 1][1] * scale, bx = pts[j][0] * scale, by = pts[j][1] * scale;
      if (x < Math.min(ax, bx) - closest || x > Math.max(ax, bx) + closest ||
          y < Math.min(ay, by) - closest || y > Math.max(ay, by) + closest) continue;
      const dx = bx - ax, dy = by - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px - x, py - y);
      if (d >= closest) continue;
      closest = d; result = { x: px, y: py, distanceM: d, angle: Math.atan2(dy, dx), w, kind };
    }
  };
  for (const r of world.roads) if (r.type !== 'trail') scan(r.pts, world.cell, r.type === 'highway' ? 12 : 7, r.type, r.deck);
  for (const r of world.streets) if (r.w >= 5) scan(r.pts, 1, r.w, 'street');
  return result;
}
function auditRoadAccess(world) {
  const misses = [];
  for (const p of world.pois) if (ROADSIDE_POIS.has(p.type)) {
    if (!p.access) p.access = roadAccess(world, p.x * world.cell, p.y * world.cell, 100);
    if (!p.access) misses.push({ id: p.id, name: p.name, type: p.type });
  }
  world.roadAccessReview = misses;
}
function movePoi(world, p, x, y) {
  if (p.radius || ANCHORED_POIS.has(p.type) || world.deposits.includes(p)) return 'This POI is anchored to the generated terrain or road network.';
  const b = world.buildings.find(b => b.poiId === p.id);
  const access = ROADSIDE_POIS.has(p.type) ? roadAccess(world, x, y, 60) : null;
  if (ROADSIDE_POIS.has(p.type) && !access) return 'Move this POI within 60 m of a surface road.';
  if (access) {
    const nx = -Math.sin(access.angle), ny = Math.cos(access.angle);
    const side = (x - access.x) * nx + (y - access.y) * ny >= 0 ? 1 : -1;
    access.distanceM = access.w / 2 + (b ? b.d / 2 : 0) + 7;
    x = access.x + nx * access.distanceM * side; y = access.y + ny * access.distanceM * side;
  }
  const { n, cell, sizeM } = world, landIndex = (mx, my) => Math.round(my / cell) * n + Math.round(mx / cell);
  const parent = b && p.parent && world.pois.find(q => q.name === p.parent && q.radius);
  if (parent && Math.hypot(x - parent.x * cell, y - parent.y * cell) > parent.radius + 80)
    return 'Keep this building within its settlement.';
  const dry = (mx, my) => mx >= 0 && my >= 0 && mx <= sizeM && my <= sizeM && world.land[landIndex(mx, my)] && !world.chanM[landIndex(mx, my)];
  if (!dry(x, y)) return 'Choose dry ground away from a river channel.';
  const z = terrainAt(world.h, n, cell, x, y);
  if (b) {
    const radius = Math.hypot(b.w, b.d) / 2, a = access?.angle ?? b.a;
    if (z < 2 || world.slope[landIndex(x, y)] > 18) return 'Choose gentler ground for the building.';
    for (const u of [-b.w / 2, b.w / 2]) for (const v of [-b.d / 2, b.d / 2]) {
      const px = x + u * Math.cos(a) - v * Math.sin(a), py = y + u * Math.sin(a) + v * Math.cos(a);
      if (!dry(px, py) || roadAccess(world, px, py, 7)?.distanceM < 5) return 'The building would overlap water or a road.';
    }
    if (world.buildings.some(other => other !== b && Math.hypot(x - other.x, y - other.y) < radius + Math.hypot(other.w, other.d) / 2))
      return 'The building would overlap an existing footprint.';
  }
  if (p.type === 'hospital' && world.pois.some(q => q !== p && q.type === 'hospital' && Math.hypot(x - q.x * cell, y - q.y * cell) < Math.max(1500, world.sizeM * .12)))
    return 'Choose a location farther from the other hospital.';
  if (p.type === 'tunnel' && world.pois.some(q => q !== p && q.type === 'tunnel' && Math.hypot(x - q.x * cell, y - q.y * cell) < 160))
    return 'Choose a location at least 160 m from another metro entrance.';
  const previous = { p, fields: { x: p.x, y: p.y, i: p.i, h: p.h, zone: p.zone, access: p.access }, b, footprint: b && {...b} };
  const i = landIndex(x, y);
  Object.assign(p, { x: x / cell, y: y / cell, i, h: z, zone: world.zone[i], access });
  if (b) Object.assign(b, { x, y, z, a: access?.angle ?? b.a });
  return previous;
}
function refreshPoiEdits() {
  const { urban, buildings, land, cell, n } = S;
  urban.fill(0);
  for (const b of buildings) if (b.urbanLevel) {
    const r = Math.max(Math.hypot(b.w, b.d) / 2 + 11, cell * .72);
    for (let y = Math.max(0, Math.ceil((b.y - r) / cell)); y <= Math.min(n - 1, Math.floor((b.y + r) / cell)); y++) {
      for (let x = Math.max(0, Math.ceil((b.x - r) / cell)); x <= Math.min(n - 1, Math.floor((b.x + r) / cell)); x++) {
        const i = y * n + x;
        if (land[i] && Math.hypot(x * cell - b.x, y * cell - b.y) <= r) urban[i] = Math.max(urban[i], b.urbanLevel);
      }
    }
  }
  S.hcache = {};
  S.metro = buildMetro(S);
  auditRoadAccess(S);
  $('undoPoi').disabled = !poiEdits.length;
  render();
  updateInfo();
}

// ---------- wiring ----------
$('gen').onclick = async () => {
  if ($('gen').disabled) return;
  $('gen').disabled = $('rnd').disabled = true; $('cancelGen').hidden = false;
  try { await generate(); syncHash(); }
  catch (e) {
    if (e.name === 'GenerationCancelled') { $('status').textContent = S ? 'Generation cancelled. Showing the previous world.' : 'Generation cancelled.'; }
    else { $('status').textContent = 'Error: ' + e.message; console.error(e); }
  }
  finally { $('gen').disabled = $('rnd').disabled = false; $('cancelGen').hidden = true; }
};
$('cancelGen').onclick = cancelGeneration;
const randomSeed = () => Math.random().toString(36).slice(2, 8);
$('rnd').onclick = () => { $('seed').value = randomSeed(); $('gen').click(); };
for (const id of ['mode', 'oHyd', 'oRoad', 'oPoi', 'oLab', 'oLab2', 'oBld', 'oCont', 'oSlice', 'oCor', 'oGrid', 'oMetro']) $(id).onchange = render;
$('editPoi').onchange = updateMapControls;
const LEGEND = [
  ['Settlements', { city: 'City', town: 'Town', start: 'Start town', village: 'Village', farm: 'Farm', safehouse: 'Farm safehouse (slice)' }],
  ['Civic', { cityhall: 'City hall', hospital: 'Hospital', clinic: 'Clinic', police: 'Police', fire: 'Fire station', school: 'School', church: 'Church',
    mall: 'Mall', store: 'General store', stadium: 'Stadium', busdepot: 'Bus depot', tunnel: 'Metro tunnel', motel: 'Motel' }],
  ['Town life', { townhall: 'Town hall', pub: 'Pub', diner: 'Diner', pharmacy: 'Pharmacy', hardware: 'Hardware store', postoffice: 'Post office', library: 'Library',
    bank: 'Bank', garage: 'Garage', hall: 'Community hall', park: 'Park', cemetery: 'Cemetery', watertower: 'Water tower', silo: 'Grain silos' }],
  ['Industry & infrastructure', { industrial: 'Industrial', warehouse: 'Warehouse / depot', mine: 'Quarry', logging: 'Logging camp', power: 'Power station',
    substation: 'Substation', water: 'Water treatment', windfarm: 'Wind farm', dam: 'Reservoir dam', fuel: 'Fuel station', comms: 'Comms tower', radio: 'Radio mast' }],
  ['Coast', { harbor: 'Harbor', dock: 'Pier / dock', lighthouse: 'Lighthouse', beach: 'Beach', shipwreck: 'Shipwreck', bunker: 'Coastal bunker' }],
  ['Wilderness', { cabin: 'Cabin', hut: 'Mountain hut', ranger: 'Ranger station', lookout: 'Fire lookout', campsite: 'Campground', cave: 'Cave', waterfall: 'Waterfall', peak: 'Peak', weather: 'Weather station' }],
  ['Military & science', { airport: 'Airport / airstrip', airfield: 'Military airfield', military: 'Military base', radar: 'Radar station', checkpoint: 'Checkpoint',
    crash: 'Crash site', research: 'Research lab', outpost: 'Research outpost', secret: 'Project Desolation site' }],
  ['People', { survivors: 'Survivor holdout', trader: 'Trading post', raiders: 'Raider camp' }],
  ['Alien', { seed: 'Seed engine', nest: 'Nest', sporefield: 'Spore field', excavation: 'Excavation (under city)' }],
  ['Offshore', { seastack: 'Sea stack', rig: 'Offshore platform' }],
  ['Ores (common → rarest)', { stone: '1 Stone', iron: '2 Iron', copper: '3 Copper', silver: '4 Silver', gold: '5 Gold', titanium: '6 Titanium', diamond: '7 Diamond', uranium: '8 Uranium' }],
  ['Other resources', { coal: 'Coal seam', salt: 'Salt pans',
    spring: 'Spring (fresh water)', fishing: 'Fishing spot', hunting: 'Hunting stand', claypit: 'Clay pit' }],
  ['Routes & vehicles', { pass: 'Mountain pass', bridge: 'Bridge', portal: 'Tunnel portal', viaduct: 'Viaduct', pickup: 'Repairable pickup (slice)', vehicle: 'Abandoned vehicle' }]
];
$('legend').innerHTML = LEGEND.map(([g, o]) => `<span style="grid-column:1/3;color:#8a96a5;margin-top:6px">${g}</span>` +
  Object.entries(o).map(([k, v]) => `<i style="background:${POI_STYLE[k][1]};color:${POI_STYLE[k][2]}">${POI_STYLE[k][0]}</i><span>${v}</span>`).join('')).join('');
// zoom & pan: canvas is drawn at ~2000 px, CSS-scaled; zoom keeps the point under the cursor fixed
let zoom = 1, drag = null, poiDrag = null;
const mainEl = $('main');
function setZoom(z, cx, cy) {
  const r = cv.getBoundingClientRect(); cx ??= r.left + r.width / 2; cy ??= r.top + r.height / 2;
  const fx = (cx - r.left) / r.width, fy = (cy - r.top) / r.height;
  zoom = clamp(z, 1, 16);
  const base = Math.max(1, Math.min(mainEl.clientWidth - 16, mainEl.clientHeight - $('bar').offsetHeight - 16));
  cv.style.width = cv.style.height = base * zoom + 'px'; $('zLab').textContent = Math.round(zoom * 100) + '%';
  const r2 = cv.getBoundingClientRect(); mainEl.scrollLeft += r2.left + fx * r2.width - cx; mainEl.scrollTop += r2.top + fy * r2.height - cy;
  // symbols/labels shrink as you zoom so buildings stay visible; redraw once zooming settles
  scheduleOverlay();
}
mainEl.addEventListener('scroll', scheduleOverlay);
cv.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.25 : .8), e.clientX, e.clientY); }, { passive: false });
const mapPosition = e => {
  const r = cv.getBoundingClientRect();
  return [((e.clientX - r.left) * S.n / r.width - .5) * S.cell, ((e.clientY - r.top) * S.n / r.height - .5) * S.cell];
};
cv.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (S && !V3.on && $('oPoi').checked && $('editPoi').checked) {
    if ($('xUnityPack').disabled) return;
    const [x, y] = mapPosition(e), max = 14 * S.sizeM / cv.getBoundingClientRect().width;
    let closest = max, selected = null;
    for (const p of S.pois) {
      const d = Math.hypot(p.x * S.cell - x, p.y * S.cell - y);
      if (d < closest) { closest = d; selected = p; }
    }
    if (selected) { poiDrag = { world: S, p: selected, sx: e.clientX, sy: e.clientY }; $('status').textContent = 'Moving ' + selected.name; }
    else $('status').textContent = 'Drag a POI marker to move it.';
    return;
  }
  drag = [e.clientX, e.clientY, mainEl.scrollLeft, mainEl.scrollTop]; cv.classList.add('drag');
});
addEventListener('mouseup', e => {
  if (poiDrag?.world === S && !V3.on && $('oPoi').checked && $('editPoi').checked && !$('xUnityPack').disabled && Math.hypot(e.clientX - poiDrag.sx, e.clientY - poiDrag.sy) >= 3) {
    const result = movePoi(S, poiDrag.p, ...mapPosition(e));
    if (typeof result === 'string') $('status').textContent = result;
    else { poiEdits.push(result); refreshPoiEdits(); $('status').textContent = 'Moved ' + result.p.name; }
  }
  poiDrag = null; drag = null; cv.classList.remove('drag');
});
$('undoPoi').onclick = () => {
  if ($('xUnityPack').disabled) return;
  const edit = poiEdits.pop();
  if (!edit) return;
  Object.assign(edit.p, edit.fields);
  if (edit.b) Object.assign(edit.b, edit.footprint);
  refreshPoiEdits();
  $('status').textContent = 'Restored ' + edit.p.name;
};
addEventListener('mousemove', e => { if (drag) { mainEl.scrollLeft = drag[2] - (e.clientX - drag[0]); mainEl.scrollTop = drag[3] - (e.clientY - drag[1]); } });
addEventListener('resize', () => setZoom(zoom));
$('zIn').onclick = () => setZoom(zoom * 1.5); $('zOut').onclick = () => setZoom(zoom / 1.5); $('zFit').onclick = () => setZoom(1);
let S = null;

async function upgradeMaterialControls() {
  // Upgrade after the app has attached its handlers. Native controls serve as the offline UI.
  try {
    await import('https://esm.sh/@material/web@2.5.0/all.js?bundle');
    for (const native of document.querySelectorAll('button, #side input[id], #ex3d')) {
      let tag;
      if (native.matches('button')) {
        tag = native.classList.contains('go') ? 'md-filled-button' :
          native.classList.contains('secondary') ? 'md-filled-tonal-button' : 'md-outlined-button';
      } else {
        tag = { checkbox: 'md-checkbox', range: 'md-slider', text: 'md-outlined-text-field' }[native.type];
      }
      if (!tag) continue;
      const control = document.createElement(tag);
      for (const {name, value} of native.attributes) if (name !== 'type') control.setAttribute(name, value);
      control.textContent = native.textContent;
      control.disabled = native.disabled;
      control.onclick = native.onclick;
      control.onchange = native.onchange;
      control.oninput = native.oninput;
      if (native.matches('input')) {
        const label = native.getAttribute('aria-label') || native.closest('label')?.querySelector('span')?.textContent;
        if (label) control.setAttribute('aria-label', label);
        if (!native.title && native.closest('label')?.title) control.title = native.closest('label').title;
        if (tag === 'md-checkbox') control.checked = native.checked;
        else if (tag === 'md-slider') {
          control.value = native.valueAsNumber;
          control.setAttribute('labeled', '');
        } else {
          control.value = native.value;
          control.label = label || '';
        }
      }
      native.replaceWith(control);
    }
    setZoom(zoom);
  } catch (error) {
    console.warn('Material Web could not load. Using native controls.', error);
  }
}

// The example project: a 16 km crescent island on the quick 505 grid, so the app opens on a finished world in a couple of seconds.
// Its seed is replaced with a random one when it is opened (the seed here is only the fallback).
const EXAMPLE_PROJECT = { name: 'Example: Harbor Fog island', settings: { seed: 'harbor-fog', scenario: 'sandbox', fp: '16', shape: 'crescent', size: '505', compute: 'auto', mtn: '1', lakes: '5', riv: '1',
  elevation: '.5', erosion: '.2', snowLine: '.8', terrainScale: '.01', landforms: 'on', hydraulic: 'off', pois: 'full', splines: '' } };
let startNote = null;
function startApp() {
  setZoom(1);
  // What opens: the world in the address (a share link, or the last world of this tab), else the most recently saved
  // world, else the built-in example project. Nothing random is generated on opening.
  const linked = typeof location !== 'undefined' ? settingsFromHash(location.hash) : {}, saved = readSaved();
  if (Object.keys(linked).length) { applySettings(linked); startNote = 'Opened the world from the link'; }
  else if (saved.length) { const latest = saved.reduce((a, b) => (b.savedAt || 0) >= (a.savedAt || 0) ? b : a); applySettings(latest.settings); startNote = 'Opened your latest saved world: ' + savedLabel(latest); }
  else {                                                   // the example project, on a fresh random seed each time
    const seed = randomSeed(); applySettings({ ...EXAMPLE_PROJECT.settings, seed });
    startNote = `Opened the example project on a random seed (${seed}). Change anything and press Generate terrain, or pick a Preset`;
  }
  refreshSaved();
  $('gen').click();
  upgradeMaterialControls();
}

// ---------- hand-drawn splines ----------
// Lines sketched on the 2D map that shape the next generation: ridges, valleys, river courses and roads. They live in the
// hidden #splines field as JSON ([{ t, p: [[u, v], ...], w, a }], points in 0..1 of the map), so they are part of the world's
// settings: saved worlds and share links carry them, and the generator (buildWorld) reads them like any other setting.
const SPL = { sel: -1, drawing: null, dragPt: null, text: null, list: [] };
const SPL_COL = { ridge: '#f59e0b', valley: '#c084fc', river: '#22d3ee', road: '#f8fafc' };
// painted biomes are brush strokes stored the same way: t 'biome', b = biome id, w = brush width
const PAINT_NAME = { 1: 'Beach', 2: 'Plains', 3: 'Forest', 4: 'Highland', 5: 'Alpine rock', 6: 'Snow', 7: 'Wetland', 9: 'Farmland' };
const splineColor = q => q.t === 'biome' ? `rgb(${BIOME_COL[q.b].join(',')})` : SPL_COL[q.t] || '#fff';
const spTypeGet = () => { const [t, b] = $('spType').value.split(':'); return b ? { t, b: +b } : { t }; };
function splineList() {                       // parsed from the field, so links and saved worlds that set it are picked up
  const text = $('splines').value || '';
  if (text !== SPL.text) { SPL.text = text; try { const v = JSON.parse(text || '[]'); SPL.list = Array.isArray(v) ? v : []; } catch { SPL.list = []; } SPL.sel = Math.min(SPL.sel, SPL.list.length - 1); }
  return SPL.list;
}
function saveSplines() { SPL.text = $('splines').value = SPL.list.length ? JSON.stringify(SPL.list.map(q => ({ t: q.t, ...(q.t === 'biome' ? { b: q.b } : {}), p: q.p.map(([u, v]) => [+u.toFixed(4), +v.toFixed(4)]), w: q.w, a: q.a }))) : ''; splineInfo(); scheduleOverlay(); }
function splineLabel(q) {
  const a = q.a, km = S ? S.sizeM / 1000 : +$('fp').value, ez = Math.min(1, Math.pow(km / 100, .6)), m = Math.round(a * 100 * ez);
  if (q.t === 'biome') return `${PAINT_NAME[q.b] || 'Biome'} painted with a ${q.w} m brush`;
  return q.t === 'ridge' ? `Ridge, about ${m} m high and ${q.w} m wide` : q.t === 'valley' ? `Valley, about ${m} m deep and ${q.w} m wide`
    : q.t === 'river' ? `${a <= 3 ? 'Stream' : a <= 7 ? 'River' : 'Major river'} in a ${q.w} m wide valley` : a <= 3 ? 'Dirt track' : a <= 7 ? 'Gravel road' : 'Highway';
}
function splineInfo() {
  const list = splineList(), cur = SPL.drawing || list[SPL.sel];
  const what = cur ? splineLabel(cur) : splineLabel({ ...spTypeGet(), w: +$('spWidth').value, a: +$('spAmount').value });
  $('spInfo').textContent = (SPL.drawing ? `Drawing: ${what} (${SPL.drawing.p.length} points). Double-click or Enter to finish.` : cur ? `Selected: ${what}.` : `Next line: ${what}.`) + ` ${list.length} line${list.length === 1 ? '' : 's'} drawn.`;
  // a drawn road that had to go a long way round: say so, the sketch crosses ground too steep for that class of road
  const detours = S ? S.roads.filter(r => r.user && r.len > 2.5 * r.sketchM + 500) : [];
  if (detours.length && !SPL.drawing) $('spInfo').textContent += ` Note: ${detours.length} drawn road section${detours.length === 1 ? '' : 's'} had to detour (for example ${(detours[0].len / 1000).toFixed(1)} km for a ${(detours[0].sketchM / 1000).toFixed(1)} km sketch) because the ground on the line is too steep. Move the points onto gentler ground or draw it as a dirt track.`;
  $('spDraw').textContent = SPL.drawing ? 'Finish line' : 'Draw new line';
  cv.classList?.toggle('drawing', !!SPL.drawing);
}
function drawUserSplines(ctx) {               // on the overlay, in base-canvas units (the same space as drawOverlays)
  if (!S || V3.on) return; const W = S.n * S.k, px = 1 / (ovQ || 1), list = splineList();
  const all = SPL.drawing ? [...list, SPL.drawing] : list;
  all.forEach((q, j) => {
    if (!q.p.length) return; const sel = q === SPL.drawing || j === SPL.sel, col = splineColor(q), paint = q.t === 'biome';
    const path = () => { ctx.beginPath(); q.p.forEach(([u, v], k) => k ? ctx.lineTo(u * W, v * W) : ctx.moveTo(u * W, v * W)); };
    ctx.lineJoin = ctx.lineCap = 'round';
    if (q.t !== 'road') { ctx.globalAlpha = paint ? (sel ? .75 : .6) : sel ? .28 : .16; ctx.strokeStyle = col; ctx.lineWidth = Math.max(4 * px, q.w / S.sizeM * W); path(); ctx.stroke(); }   // the band it affects
    ctx.globalAlpha = 1; ctx.strokeStyle = '#0b0e12'; ctx.lineWidth = (sel ? 6 : 5) * px; path(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = (sel ? 3.5 : 2.5) * px; ctx.setLineDash(q.t === 'road' ? [8 * px, 5 * px] : []); path(); ctx.stroke(); ctx.setLineDash([]);
    if (sel) for (const [u, v] of q.p) { ctx.beginPath(); ctx.arc(u * W, v * W, 5 * px, 0, 6.2832); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = '#0b0e12'; ctx.stroke(); }
  });
}
const splineUV = e => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
// a finished line is not left selected, so the controls go back to setting up the next line
function finishSpline(keep = true) {
  const d = SPL.drawing; SPL.drawing = null; if (!d) return;
  if (keep && d.p.length > 1) { splineList().push(d); SPL.sel = -1; saveSplines(); $('status').textContent = 'Line added. Press Apply and regenerate to rebuild the world around it.'; }
  else { splineInfo(); scheduleOverlay(); }
}
function splineHit(e) {                        // nearest drawn point and nearest line under the pointer, in screen pixels
  const r = cv.getBoundingClientRect(), list = splineList(); let pt = null, line = -1, bp = 11, bl = 9;
  list.forEach((q, j) => q.p.forEach(([u, v], k) => {
    const x = r.left + u * r.width, y = r.top + v * r.height, d = Math.hypot(e.clientX - x, e.clientY - y); if (d < bp) { bp = d; pt = [j, k]; }
    if (k) { const [u0, v0] = q.p[k - 1], d2 = distSeg(e.clientX, e.clientY, r.left + u0 * r.width, r.top + v0 * r.height, x, y); if (d2 < bl) { bl = d2; line = j; } }
  }));
  return { pt, line };
}
// capture phase: these run before the map's own pan and POI handlers and stop them only when a line is being drawn or edited
cv.addEventListener('mousedown', e => {
  if (e.button !== 0 || !S || V3.on) return;
  if (SPL.drawing) { e.stopImmediatePropagation(); e.preventDefault(); if (e.detail > 1) { finishSpline(); return; } SPL.drawing.p.push(splineUV(e)); splineInfo(); scheduleOverlay(); return; }
  if (!$('spEdit').checked || !$('drawPanel').open) return;
  const hit = splineHit(e);
  if (hit.pt) { e.stopImmediatePropagation(); e.preventDefault(); SPL.sel = hit.pt[0]; SPL.dragPt = hit.pt; splineSync(); }
  else if (hit.line >= 0) { e.stopImmediatePropagation(); e.preventDefault(); SPL.sel = hit.line; splineSync(); }
  else if (SPL.sel >= 0) { SPL.sel = -1; splineInfo(); scheduleOverlay(); }
}, true);
addEventListener('mousemove', e => { if (SPL.dragPt && S) { const [j, k] = SPL.dragPt; if (SPL.list[j]) { SPL.list[j].p[k] = splineUV(e); scheduleOverlay(); } } });
addEventListener('mouseup', () => { if (SPL.dragPt) { SPL.dragPt = null; saveSplines(); $('status').textContent = 'Point moved. Press Apply and regenerate to rebuild.'; } });
addEventListener('keydown', e => {
  if (!SPL.drawing || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
  if (e.key === 'Enter') finishSpline(); else if (e.key === 'Escape') finishSpline(false); else if (e.key === 'Backspace') { SPL.drawing.p.pop(); splineInfo(); scheduleOverlay(); } else return;
  e.preventDefault();
});
function splineSync() {                        // show the selected line's settings in the controls
  const q = splineList()[SPL.sel]; if (q) { $('spType').value = q.t === 'biome' ? 'biome:' + q.b : q.t; $('spWidth').value = q.w; $('spAmount').value = q.a; }
  splineInfo(); scheduleOverlay();
}
$('spDraw').onclick = () => {
  if (SPL.drawing) return finishSpline();
  if (!S) return; if (V3.on) toggle3D();
  SPL.sel = -1; SPL.drawing = { ...spTypeGet(), p: [], w: +$('spWidth').value, a: +$('spAmount').value }; splineInfo();
  $('status').textContent = 'Click on the map to add points. Double-click or Enter finishes the line, Esc cancels, Backspace removes the last point.';
};
for (const id of ['spType', 'spWidth', 'spAmount']) $(id).addEventListener('input', () => {       // the controls edit the line in hand, or set up the next one
  const q = SPL.drawing || splineList()[SPL.sel];
  if (q) { delete q.b; Object.assign(q, spTypeGet()); q.w = +$('spWidth').value; q.a = +$('spAmount').value; if (!SPL.drawing) saveSplines(); }
  splineInfo(); scheduleOverlay();
});
$('spType').addEventListener('change', () => $('spType').dispatchEvent(new Event('input')));
$('spUndo').onclick = () => {
  const q = SPL.drawing || splineList()[SPL.sel]; if (!q) return; q.p.pop();
  if (!SPL.drawing) { if (q.p.length < 2) { SPL.list.splice(SPL.sel, 1); SPL.sel = -1; } saveSplines(); } else { splineInfo(); scheduleOverlay(); }
};
$('spDelete').onclick = () => { if (SPL.drawing) return finishSpline(false); if (splineList()[SPL.sel]) { SPL.list.splice(SPL.sel, 1); SPL.sel = -1; saveSplines(); } };
$('spClear').onclick = () => { SPL.drawing = null; splineList().length = 0; SPL.sel = -1; saveSplines(); };
$('spApply').onclick = () => { finishSpline(); $('gen').click(); };
splineInfo();

// ---------- material layer rules ----------
// The rule fields are read by layerFields() in exports.js; here they only need to redraw the map when it shows the layers.
for (const id of ['lyMode', 'lySand', 'lyRockSlope', 'lyRockHeight', 'lySnow', 'lyBlend']) if ($(id)) $(id).addEventListener('input', () => { if (S && $('mode').value === 'materials') render(); });
if ($('lyMode')) $('lyMode').addEventListener('change', () => { if (S && $('mode').value === 'materials') render(); });
if ($('lyPreview')) $('lyPreview').onclick = () => { if (!S) return; $('mode').value = 'materials'; render(); };

// ---------- presets ----------
// Starting points in the spirit of the template pickers in terrain tools: each one is just a set of the ordinary controls.
const PRESETS = {
  farmland: { shape: 'round', mtn: '.7', lakes: '3', riv: '.8', elevation: '.35', erosion: '.15', snowLine: '1', terrainScale: '.008', hydraulic: 'off', landforms: 'on', pois: 'full' },
  alpine: { shape: 'inlets', mtn: '1.5', lakes: '5', riv: '1.2', elevation: '.85', erosion: '.35', snowLine: '.45', terrainScale: '.012', hydraulic: 'light', landforms: 'on', pois: 'few' },
  wild: { shape: 'archipelago', mtn: '1.1', lakes: '4', riv: '1', elevation: '.55', erosion: '.25', snowLine: '.8', terrainScale: '.012', hydraulic: 'light', landforms: 'on', pois: 'none' },
  countryside: { shape: 'rolling', mtn: '.8', lakes: '4', riv: '.8', elevation: '.4', erosion: '.15', snowLine: '1', terrainScale: '.009', hydraulic: 'off', landforms: 'on', pois: 'full' },
  valleys: { shape: 'mountainous', mtn: '1.4', lakes: '6', riv: '1.3', elevation: '.8', erosion: '.3', snowLine: '.55', terrainScale: '.011', hydraulic: 'strong', landforms: 'on', pois: 'few' },
  plateau: { shape: 'plateaus', mtn: '1', lakes: '0', riv: '.2', elevation: '.6', erosion: '.1', snowLine: '1', terrainScale: '.01', hydraulic: 'off', landforms: 'off', pois: 'few' },
  cliffs: { shape: 'coastal', mtn: '1.1', lakes: '2', riv: '.7', elevation: '.6', erosion: '.2', snowLine: '.9', terrainScale: '.011', hydraulic: 'light', landforms: 'on', pois: 'full' }
};
if (typeof MutationObserver !== 'undefined' && $('status').nodeType === 1) new MutationObserver(() => { if (/^Done/.test($('status').textContent)) { splineInfo(); if (startNote) { const note = startNote; startNote = null; $('status').textContent += ' · ' + note; } } }).observe($('status'), { childList: true, characterData: true, subtree: true });
if ($('preset')) $('preset').onchange = () => { const p = PRESETS[$('preset').value]; if (!p) return; applySettings(p); $('gen').click(); };

// ---------- progress bars ----------
// Every long job reports through the status line ("3/11 Rivers & lakes…", "PCG masks: Grass…", "Tile 4 of 64"). The
// bars read that line: Overall shows how far through the whole job it is, Step names the item in hand. A step with no
// measurable inner progress shows a moving bar, so it is always clear the app is working and on what.
function progressFromStatus(text) {
  const box = $('prog'); if (!box) return;
  const busy = /…\s*$|^\d+\s*\/\s*\d+\b|\b\d+ of \d+\b/.test(text) && !/^Done|error|cancel/i.test(text);
  box.hidden = !busy; if (!busy) { progressFromStatus.items = null; return; }
  const frac = text.match(/(\d+)\s*(?:\/|of)\s*(\d+)/), all = $('pgAll'), item = $('pgItem');
  const label = text.replace(/^\d+\s*\/\s*\d+\s*/, '').replace(/…\s*$/, '');
  if (frac) { all.max = 1; all.value = Math.min(1, (+frac[1] - .5) / +frac[2]); $('pgAllL').textContent = `Overall ${frac[1]} of ${frac[2]}`; }
  else {
    // jobs that announce items by name only (masks, layers): count the items seen so far against the usual total
    const group = label.split(':')[0], seen = progressFromStatus.items && progressFromStatus.items.group === group ? progressFromStatus.items : (progressFromStatus.items = { group, n: 0, last: '' });
    if (seen.last !== label) { seen.n++; seen.last = label; }
    const total = { 'PCG masks': 30 }[group];
    if (total) { all.max = 1; all.value = Math.min(1, seen.n / total); } else all.removeAttribute('value');
    $('pgAllL').textContent = total ? `Overall ${seen.n} of about ${total}` : 'Overall';
  }
  item.removeAttribute('value'); $('pgItemL').textContent = label || 'Working';
}
if (typeof MutationObserver !== 'undefined' && $('status') && $('status').nodeType === 1)
  new MutationObserver(() => progressFromStatus($('status').textContent || '')).observe($('status'), { childList: true, characterData: true, subtree: true });
startApp();
