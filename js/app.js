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
const ANCHORED_POIS = new Set(['bridge', 'portal', 'viaduct', 'pass', 'dam', 'harbor', 'dock', 'rig', 'shipwreck', 'seastack', 'peak', 'spring', 'fishing', 'claypit']);
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
$('rnd').onclick = () => { $('seed').value = Math.random().toString(36).slice(2, 8); $('gen').click(); };
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
  ['Wilderness', { cabin: 'Cabin', hut: 'Mountain hut', ranger: 'Ranger station', lookout: 'Fire lookout', campsite: 'Campground', cave: 'Cave', peak: 'Peak', weather: 'Weather station' }],
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

function startApp() {
  setZoom(1);
  if (typeof location !== 'undefined') applySettings(settingsFromHash(location.hash));   // a shared link carries its own settings
  refreshSaved();
  $('gen').click();
  upgradeMaterialControls();
}

startApp();
