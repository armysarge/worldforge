"use strict";

// ---------- rendering ----------
const BIOME_COL = [null, [214, 201, 152], [150, 175, 95], [52, 110, 60], [135, 130, 95], [128, 120, 115], [240, 242, 248], [95, 140, 120], null, [196, 178, 102]];
const ELEV = [[6, [118, 158, 86]], [200, [96, 142, 70]], [450, [140, 150, 90]], [800, [150, 135, 95]], [1200, [130, 118, 108]], [1700, [175, 170, 165]], [2200, [240, 240, 245]]];
const ZONE_COL = [null, [60, 220, 90], [240, 200, 50], [230, 60, 50]];
const REGION_COL = [null, [210, 80, 80], [225, 200, 100], [50, 140, 70], [80, 190, 215], [150, 155, 170], [175, 70, 235]];
const REGION_NAME = ['', 'Metropolitan', 'Rural belt', 'Woodland & mountain', 'Coast & ports', 'Military & science', 'Alien territory'];
const STAGE_COL = [null, [190, 150, 240], [150, 70, 215], [100, 15, 150]];
const STAGE_NAME = ['Clear', 'Seeded', 'Growing', 'Overrun'];
const MATERIAL_COL = [[219, 190, 125], [132, 164, 92], [192, 146, 69], [44, 96, 61], [134, 129, 130], [239, 242, 248], [70, 144, 132], [159, 126, 111]];
const TRAVEL_COL = [[90, 190, 90], [225, 210, 70], [235, 140, 50], [215, 50, 50]];
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let j = 1; j < stops.length; j++) if (v <= stops[j][0]) { const t = (v - stops[j - 1][0]) / (stops[j][0] - stops[j - 1][0]), a = stops[j - 1][1], b = stops[j][1]; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  return stops[stops.length - 1][1];
}
const POI_STYLE = {
  city: ['C', '#fff', '#111', 10], town: ['T', '#f5d76e', '#111', 8], village: ['', '#d0d0d0', '#111', 3.5], start: ['S', '#4ade80', '#111', 11],
  farm: ['', '#c9a24a', '#111', 3], safehouse: ['F', '#86efac', '#111', 7], radio: ['r', '#ff9f43', '#111', 6.5], outpost: ['o', '#a78bfa', '#111', 6.5],
  harbor: ['H', '#38bdf8', '#111', 7], airport: ['A', '#cbd5e1', '#111', 8], airstrip: ['a', '#cbd5e1', '#111', 5.5], airfield: ['A', '#ef4444', '#fff', 7],
  military: ['M', '#ef4444', '#fff', 8], radar: ['D', '#ef4444', '#fff', 6.5], research: ['R', '#a78bfa', '#111', 8], industrial: ['I', '#9ca3af', '#111', 6.5],
  mine: ['m', '#9ca3af', '#111', 5.5], warehouse: ['W', '#9ca3af', '#111', 5], fuel: ['G', '#facc15', '#111', 5], cabin: ['c', '#a16207', '#fff', 4.5],
  dam: ['=', '#38bdf8', '#111', 6], survivors: ['V', '#22c55e', '#111', 7.5], peak: ['▲', '#e5e7eb', '#111', 6.5], seed: ['Z', '#d946ef', '#fff', 9],
  pass: ['^', '#fbbf24', '#111', 5], bridge: ['', '#7dd3fc', '#111', 3]
};
Object.assign(POI_STYLE, {
  cityhall: ['★', '#fff', '#111', 5.5], hospital: ['✚', '#ef4444', '#fff', 5.5], clinic: ['✚', '#fca5a5', '#7f1d1d', 4.5], mall: ['$', '#fbbf24', '#111', 5.5],
  store: ['$', '#fde68a', '#111', 4.5], trader: ['$', '#22c55e', '#111', 6], police: ['P', '#3b82f6', '#fff', 5], fire: ['F', '#f97316', '#fff', 5],
  school: ['s', '#fde68a', '#111', 4.5], church: ['†', '#e5e7eb', '#111', 4.5], stadium: ['O', '#d1d5db', '#111', 6], busdepot: ['B', '#9ca3af', '#111', 4.5],
  tunnel: ['U', '#4b5563', '#fff', 5], excavation: ['X', '#d946ef', '#fff', 6.5], power: ['⚡', '#facc15', '#111', 6], substation: ['⚡', '#fef08a', '#111', 4],
  water: ['w', '#38bdf8', '#111', 5], lighthouse: ['L', '#fef3c7', '#111', 6], shipwreck: ['~', '#94a3b8', '#111', 5], dock: ['d', '#7dd3fc', '#111', 4.5],
  beach: ['b', '#fde68a', '#111', 4.5], bunker: ['■', '#78716c', '#fff', 5], lookout: ['l', '#fb923c', '#111', 5], comms: ['Y', '#f59e0b', '#111', 5],
  ranger: ['N', '#15803d', '#fff', 5], campsite: ['Δ', '#84cc16', '#111', 5], cave: ['∩', '#44403c', '#fff', 5], waterfall: ['≋', '#38bdf8', '#111', 5], logging: ['k', '#92400e', '#fff', 5],
  hut: ['h', '#e7e5e4', '#111', 5], crash: ['✕', '#f87171', '#111', 5.5], checkpoint: ['!', '#dc2626', '#fff', 5], motel: ['z', '#c4b5fd', '#111', 4.5],
  windfarm: ['✣', '#f1f5f9', '#111', 5.5], raiders: ['☠', '#7f1d1d', '#fff', 6], secret: ['?', '#111', '#e879f9', 7], weather: ['☂', '#bae6fd', '#111', 5],
  nest: ['✺', '#a21caf', '#fff', 5.5], sporefield: [':', '#c084fc', '#111', 4.5]
});
const RES_COL = { softwood: [25, 85, 55], hardwood: [95, 150, 55], stone: [155, 152, 148], clay: [180, 115, 70], sand: [235, 215, 150], crops: [225, 195, 80],
  herbs: [175, 215, 120], forage: [205, 110, 165], game: [130, 95, 50], alien: [175, 70, 235], fish: [60, 200, 205],
  ore_stone: [120, 115, 110], ore_iron: [180, 70, 40], ore_copper: [40, 175, 155], ore_silver: [215, 222, 235], ore_gold: [245, 200, 40], ore_titanium: [90, 105, 130],
  ore_diamond: [150, 240, 255], ore_uranium: [130, 210, 30], ore_coal: [25, 25, 28], ore_salt: [250, 250, 255] };
const RES_NAME = { softwood: 'Softwood (conifer)', hardwood: 'Hardwood (broadleaf)', stone: 'Stone', clay: 'Clay', sand: 'Sand', crops: 'Crops', herbs: 'Medicinal herbs',
  forage: 'Forage (berries, fungi)', game: 'Game (hunting)', alien: 'Alien biomass', fish: 'Fish', ore_stone: 'Stone deposit', ore_iron: 'Iron ore', ore_copper: 'Copper ore',
  ore_silver: 'Silver ore', ore_gold: 'Gold', ore_titanium: 'Titanium sands', ore_diamond: 'Diamond', ore_uranium: 'Uranium', ore_coal: 'Coal', ore_salt: 'Salt' };
const RES_LAND = ['alien', 'crops', 'softwood', 'hardwood', 'stone', 'clay', 'sand', 'herbs', 'forage'], ORE_KEYS = ['ore_stone', 'ore_iron', 'ore_copper', 'ore_silver', 'ore_gold', 'ore_titanium', 'ore_diamond', 'ore_uranium', 'ore_coal', 'ore_salt'];
const BLD_COL = { house: '#b0705a', commercial: '#9aa3ad', industrial: '#7d8794', farm: '#8f5a3c', military: '#6b7355', shop: '#c98a5a',
  apartment: '#8d8f9e', civic: '#d8c9a3', park: '#4d8f4a', cemetery: '#86917f' };
Object.assign(POI_STYLE, {
  pub: ['p', '#d97706', '#fff', 4.5], diner: ['D', '#fb7185', '#111', 4.5], pharmacy: ['✚', '#34d399', '#111', 4.5], hardware: ['⚒', '#a8a29e', '#111', 4.5],
  postoffice: ['✉', '#fde047', '#111', 4.5], townhall: ['★', '#e5e7eb', '#111', 5], library: ['¶', '#c4b5fd', '#111', 4.5], bank: ['$', '#4ade80', '#111', 4.5],
  garage: ['g', '#94a3b8', '#111', 4.5], park: ['♣', '#22c55e', '#111', 4.5], cemetery: ['✝', '#a1a1aa', '#111', 4.5], watertower: ['⊤', '#7dd3fc', '#111', 4.5],
  silo: ['∥', '#eab308', '#111', 4.5], hall: ['⌂', '#fcd34d', '#111', 4.5],
  portal: ['∩', '#57534e', '#fff', 4.5], viaduct: ['≡', '#e5e7eb', '#111', 4.5],
  stone: ['St', '#a8a29e', '#111', 5], iron: ['Fe', '#b45309', '#fff', 5.5], copper: ['Cu', '#14b8a6', '#111', 5.5], silver: ['Ag', '#e2e8f0', '#111', 5.5],
  gold: ['Au', '#facc15', '#111', 5.5], titanium: ['Ti', '#64748b', '#fff', 5.5], diamond: ['◆', '#a5f3fc', '#0e7490', 6], uranium: ['☢', '#84cc16', '#111', 6],
  coal: ['C', '#1c1917', '#fff', 5.5], salt: ['Na', '#f8fafc', '#111', 5], spring: ['~', '#60a5fa', '#111', 4.5], fishing: ['f', '#22d3ee', '#111', 4.5],
  hunting: ['⌖', '#a16207', '#fff', 4.5], claypit: ['Cl', '#c2410c', '#fff', 4.5],
  seastack: ['▲', '#78716c', '#fff', 4.5], rig: ['#', '#f97316', '#111', 6], pickup: ['P', '#22d3ee', '#111', 6], vehicle: ['v', '#cbd5e1', '#111', 4]
});
const FIELD = [[190, 175, 95], [150, 165, 80], [172, 150, 92], [124, 150, 72]];
const hsh = i => { i = Math.imul(i ^ i >>> 16, 0x45d9f3b); i = Math.imul(i ^ i >>> 16, 0x45d9f3b); return ((i ^ i >>> 16) >>> 0) / 4294967296; };
const hsh2 = (a, b) => hsh(Math.imul(a, 73856093) ^ Math.imul(b, 19349663));
const LABELED = ['rig', 'pickup', 'lighthouse', 'secret', 'raiders', 'trader', 'excavation', 'hospital','city', 'town', 'start', 'safehouse', 'radio', 'outpost', 'harbor', 'airport', 'airfield', 'military', 'radar', 'research', 'survivors', 'dam', 'peak', 'seed'];
const cv = $('cv'), cx2 = cv.getContext('2d');

function updateMapControls() {
  const map2D = !V3.on, mode = $('mode').value, points = !!S?.pois.length;
  const labels = map2D && points && $('oPoi').checked;
  const applicable = {
    oHyd: S?.rivers.length, oRoad: S?.roads.length, oPoi: points,
    oLab: labels, oLab2: labels && $('oLab').checked, editPoi: labels,
    oBld: S?.buildings.length || S?.streets.length, oMetro: S?.metro.length,
    oCont: S && mode !== 'topographic' && mode !== 'height',
    oSlice: map2D && S?.slice, oCor: S?.corridors.length,
    oGrid: map2D && S, oTileGrid: map2D && S
  };
  for (const [id, visible] of Object.entries(applicable)) $(id).closest('label').hidden = !visible;
  $('undoPoi').hidden = !(labels && ($('editPoi').checked || poiEdits.length));
}

function updateMapLegend(mode) {
  const panel = $('mapLegend'), body = $('mapLegendBody'), title = $('mode').selectedOptions[0].textContent;
  const rgb = color => `rgb(${color.join(',')})`;
  const key = entries => `<ul class="map-key">${entries.map(([label, color]) =>
    `<li><b aria-hidden="true" style="background:${rgb(color)}"></b><span>${label}</span></li>`).join('')}</ul>`;
  const gradient = (stops, low, high) => `<div class="legend-ramp" style="background:linear-gradient(to right,${stops.join(',')})"></div>
    <div class="legend-limits"><span>${low} m</span><span>${high} m</span></div>`;
  const water = [];
  if (!S.mainland || S.shape === 'coastal') water.push(['Ocean', [45, 91, 135]]);
  if (S.lakes.length) water.push(['Lake', [70, 128, 180]]);
  let html;
  switch (mode) {
    case 'height':
      html = gradient(['#000', '#fff'], S.hmin.toFixed(1), S.hmax.toFixed(1));
      break;
    case 'biome':
      html = key([...water, ...BN.flatMap((name, i) => BIOME_COL[i] ? [[name, BIOME_COL[i]]] : [])]);
      break;
    case 'materials':
      html = key([...water, ...LAYER_NAMES.map((name, i) => [name, MATERIAL_COL[i]])]) + '<p class="legend-note">Colors blend where material weights overlap.</p>';
      break;
    case 'regions':
      html = key(REGION_NAME.flatMap((name, i) => S.stats.regCnt[i] ? [[name, REGION_COL[i]]] : []));
      break;
    case 'zones':
      html = key(['Early game', 'Mid game', 'Late game'].map((name, i) => [name, ZONE_COL[i + 1]]));
      break;
    case 'ecology':
      html = key(STAGE_NAME.map((name, i) => [name, STAGE_COL[i] ?? [134, 157, 129]]));
      break;
    case 'slope':
      html = key(['Easy (<8°)', 'Moderate (8–<20°)', 'Steep (20–<30°)', 'Very steep (30°+)'].map((name, i) => [name.replaceAll('<', '&lt;'), TRAVEL_COL[i]]));
      break;
    case 'resources':
      html = key([...RES_LAND, 'fish', ...ORE_KEYS].filter(name => name !== 'alien' || S.scenario === 'desolation').map(name => [RES_NAME[name], RES_COL[name]]))
        + '<p class="legend-note">Gray areas have no dominant resource.</p>';
      break;
    default: {
      const ez = Math.min(1, S.sc ** .6), max = ELEV.at(-1)[0];
      html = gradient(ELEV.map(([height, color]) => `${rgb(color)} ${100 * height / max}%`), 0, Math.round(max * ez))
        + key(water) + (mode === 'topographic' ? `<p class="legend-note">Contours every ${S.cstep} m.</p>` : '');
    }
  }
  $('mapLegendTitle').textContent = title;
  if (body.innerHTML !== html) { body.innerHTML = html; body.scrollTop = 0; }
  panel.hidden = false;
}

function render() {
  if (!S) return;
  const { n, k, h, ocean, lakeId, lakes, land, biome, slope, shade, zone, region, stageT, urban, cell, cstep } = S, W = n * k, mode = $('mode').value;
  updateMapControls();
  updateMapLegend(mode);
  const cont = $('oCont').checked || mode === 'topographic', fs = Math.max(160, cell * 3) / cell, fc = Math.cos(.5), fsn = Math.sin(.5);   // same plots the generator levels
  const materials = mode === 'materials' ? layerFields(S) : null;
  cv.width = cv.height = W;
  const off = document.createElement('canvas'); off.width = off.height = n;
  const octx = off.getContext('2d'), img = octx.createImageData(n, n), d = img.data;
  const mix = (c, o, t) => o ? [c[0] * (1 - t) + o[0] * t, c[1] * (1 - t) + o[1] * t, c[2] * (1 - t) + o[2] * t] : c;
  for (let i = 0; i < n * n; i++) {
    let c;
    if (mode === 'height') {
      const value = 255 * clamp((h[i] - S.hmin) / (S.hmax - S.hmin), 0, 1);
      c = [value, value, value];
    }
    else if (ocean[i]) {
      const t = clamp(-h[i] / (200 * Math.min(1, S.sc ** .6)), 0, 1); c = [lerp(72, 18, t), lerp(140, 42, t), lerp(185, 84, t)];
      const x = i % n;
      if ((x > 0 && land[i - 1]) || (x < n - 1 && land[i + 1]) || land[i - n] || land[i + n]) c = mix(c, [205, 228, 238], .45);
      if (mode === 'resources') c = mix(c, RES_COL.fish, S.res.fish[i] / 255 * .55);
    }
    else if (lakeId[i]) { const t = clamp((lakes[lakeId[i] - 1].level - h[i]) / 40, 0, 1); c = [lerp(100, 40, t), lerp(160, 95, t), lerp(205, 155, t)]; if (mode === 'resources') c = mix(c, RES_COL.fish, S.res.fish[i] / 255 * .55); }
    else {
      if (materials) {
        c = [0, 0, 0];
        for (let j = 0; j < materials.length; j++) {
          const w = materials[j][i] / 255, color = MATERIAL_COL[j];
          c[0] += w * color[0]; c[1] += w * color[1]; c[2] += w * color[2];
        }
      }
      else if (mode === 'biome') c = BIOME_COL[biome[i]];
      else if (mode === 'slope') { const s = slope[i]; c = TRAVEL_COL[s < 8 ? 0 : s < 20 ? 1 : s < 30 ? 2 : 3]; }
      else c = h[i] < 6 ? [205, 192, 150] : ramp(ELEV, h[i] / Math.min(1, S.sc ** .6));
      if ((mode === 'terrain' || mode === 'topographic') && S.terrainSettings.snowLine !== .8) {
        if (biome[i] === 6) c = BIOME_COL[6];
        else if (h[i] > 1900 * Math.min(1, S.sc ** .6)) c = BIOME_COL[5];
      }
      if (mode === 'terrain') {             // land cover on top of the elevation tint
        const b = biome[i], x = i % n, y = i / n | 0;
        if (b === 3) c = mix(c, [34, 72, 40], .5 + .25 * hsh(i));
        else if (b === 9) c = mix(c, FIELD[(hsh2(Math.floor((x * fc + y * fsn) / fs), Math.floor((y * fc - x * fsn) / fs)) * 4) | 0], .55);
        else if (b === 7) c = mix(c, [78, 122, 108], .5);
        if (urban[i]) c = mix(c, urban[i] === 2 ? [150, 146, 140] : [168, 160, 146], .5);
      }
      if (mode === 'resources') {                // dominant resource per cell over a grey relief; ore bodies win
        const g0 = (c[0] + c[1] + c[2]) / 3 * .8; let best = null, bv = .15;
        for (const k of RES_LAND) { const v = S.res[k][i] / 255; if (v > bv) { bv = v; best = k; } }
        for (const k of ORE_KEYS) { const v = S.res[k][i] / 255; if (v > .2 && v + .5 > bv) { bv = v + .5; best = k; } }
        c = best ? mix([g0, g0, g0], RES_COL[best], .35 + .55 * Math.min(1, bv)) : [g0, g0, g0];
      }
      if (mode === 'zones') c = mix(c, ZONE_COL[zone[i]], .5);
      if (mode === 'regions') c = mix(c, REGION_COL[region[i]], .6);
      if (mode === 'ecology') c = mix([c[0] * .8, c[1] * .8, c[2] * .8], STAGE_COL[stageT[i]], .4 + .15 * stageT[i]);
      let m = clamp(shade[i], .45, 1.5);
      if (cont) {
        const q = Math.floor(h[i] / cstep);
        if ((i % n < n - 1 && q !== Math.floor(h[i + 1] / cstep)) || (i + n < h.length && q !== Math.floor(h[i + n] / cstep))) m *= q % 5 === 0 ? .5 : .72;
      }
      c = [c[0] * m, c[1] * m, c[2] * m];
    }
    d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  cx2.imageSmoothingEnabled = true; cx2.drawImage(off, 0, 0, W, W);
  renderOverlay();
  if (V3.on) build3D();
}

// ---------- 3D view (three.js, loaded on first use) ----------
const V3 = { on: false };
const loadJs = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
function place3D() {
  const m = mainEl.getBoundingClientRect(), top = $('bar').getBoundingClientRect().bottom, box = $('box3d');
  Object.assign(box.style, { left: m.left + 'px', top: top + 'px', width: m.width + 'px', height: m.bottom - top + 'px' });
  if (V3.renderer) { V3.renderer.setSize(m.width, m.bottom - top); V3.camera.aspect = m.width / (m.bottom - top); V3.camera.updateProjectionMatrix(); }
}
async function toggle3D() {
  if (!S) return;
  const setView = on => {
    V3.on = on;
    $('box3d').hidden = !on;
    $('c3d').hidden = !on;
    $('v3d').textContent = on ? '2D map' : '3D view';
    updateMapControls();
  };
  setView(!V3.on);
  if (!V3.on) return;
  if (!window.THREE) {
    $('status').textContent = 'Loading 3D engine…';
    try { await loadJs('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'); await loadJs('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'); }
    catch (e) { $('status').textContent = e.message + ' (3D view needs an internet connection once)'; setView(false); return; }
  }
  if (!V3.renderer) {
    const r = V3.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true }); r.setPixelRatio(devicePixelRatio || 1); $('box3d').appendChild(r.domElement);
    V3.scene = new THREE.Scene(); V3.camera = new THREE.PerspectiveCamera(50, 1, 2, 1e6);
    V3.controls = new THREE.OrbitControls(V3.camera, r.domElement); V3.controls.enableDamping = true; V3.controls.maxPolarAngle = Math.PI * .49;
    const loop = () => { requestAnimationFrame(loop); if (V3.on) { V3.controls.update(); r.render(V3.scene, V3.camera); } }; loop();
  }
  place3D(); build3D(true);
  $('status').textContent = '3D view: drag to orbit, right-drag to pan, scroll to zoom';
}
function build3D(resetCam) {
  if (!S || !window.THREE || !V3.renderer) return;
  const { scene, camera, controls } = V3, size = S.sizeM, half = size / 2, ex = +$('ex3d').value, seg = Math.min(S.n - 1, 640);
  scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  scene.clear();
  const sky = new THREE.Color(0x8a9aa6); scene.background = sky; scene.fog = new THREE.Fog(sky, size * .35, size * 1.6);   // grounded, foggy mood (Game_Concept.md)
  scene.add(new THREE.HemisphereLight(0xdde6ee, 0x3a3428, .75));
  const sun = new THREE.DirectionalLight(0xfff1dc, .85); sun.position.set(-size * .6, size * .7, -size * .4); scene.add(sun);
  // terrain texture = the current 2D map (any mode) plus rivers/roads/buildings, without symbols
  const tc = document.createElement('canvas'); tc.width = tc.height = cv.width; const tx = tc.getContext('2d'); tx.drawImage(cv, 0, 0);
  const q0 = ovQ, poi = $('oPoi').checked, sl = $('oSlice').checked; ovQ = -1; $('oPoi').checked = false; $('oSlice').checked = false;   // -1: true widths, 1 px floor
  drawOverlays(tx); ovQ = q0; $('oPoi').checked = poi; $('oSlice').checked = sl;
  const tex = new THREE.CanvasTexture(tc); tex.anisotropy = V3.renderer.capabilities.getMaxAnisotropy();
  // terrain mesh: lakes shown flat at their water level, ocean floor kept for the shallows
  const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, { n, cell, lakeId, lakes } = S;
  const ground = (xm, ym) => { const gi = Math.min(n - 1, Math.round(ym / cell)) * n + Math.min(n - 1, Math.round(xm / cell)); return lakeId[gi] ? lakes[lakeId[gi] - 1].level : hAt(xm, ym); };
  const surface = new Float32Array((seg + 1) ** 2);
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) surface[j * (seg + 1) + i] = ground(i / seg * size, j / seg * size);
  gradeSites(surface, seg + 1, S);
  for (let i = 0; i < surface.length; i++) pos.setY(i, surface[i] * ex);
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex })));
  if (!S.mainland || S.shape === 'coastal') {
    const seaSize = S.mainland ? size : size * 6;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(seaSize, seaSize), new THREE.MeshPhongMaterial({ color: 0x24506e, transparent: true, opacity: .72, shininess: 80 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = 0; scene.add(sea);
  }
  if ($('oRoad').checked) {
    const vertices = [];
    for (const road of S.roads) if (road.deck && road.profile) {
      const halfWidth = road.type === 'highway' ? 6 : road.type === 'trail' ? 1.25 : 3.5;
      for (let i = 1; i < road.pts.length; i++) {
        if (![road.deck[i - 1], road.deck[i]].some(code => code === 1 || code === 2 || code === 6)) continue;
        if (road.deck[i - 1] === 3 || road.deck[i] === 3) continue;
        const [ax, ay] = road.pts[i - 1], [bx, by] = road.pts[i];
        const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
        if (!d) continue;
        const ox = -dy / d * halfWidth, oy = dx / d * halfWidth;
        const a = [ax * cell - half + ox, road.profile[i - 1] * ex + .2, ay * cell - half + oy];
        const b = [ax * cell - half - ox, a[1], ay * cell - half - oy];
        const c = [bx * cell - half + ox, road.profile[i] * ex + .2, by * cell - half + oy];
        const d2 = [bx * cell - half - ox, c[1], by * cell - half - oy];
        vertices.push(...a, ...b, ...c, ...b, ...d2, ...c);
      }
    }
    if (vertices.length) {
      const decks = new THREE.BufferGeometry();
      decks.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); decks.computeVertexNormals();
      scene.add(new THREE.Mesh(decks, new THREE.MeshLambertMaterial({ color: 0xb1a18a, side: THREE.DoubleSide })));
    }
  }
  if ($('oMetro').checked) {
    for (const link of S.metro) {
      const points = link.points.map(([x, y, z]) => new THREE.Vector3(x - half, z * ex, y - half));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({ color: 0x67d9ee, dashSize: 16, gapSize: 10, depthTest: false, depthWrite: false, transparent: true, fog: false }));
      line.computeLineDistances();
      line.renderOrder = 8;
      scene.add(line);
    }
  }
  // buildings as one instanced mesh
  if ($('oBld').checked && S.buildings.length) {
    const HT = { house: 6, shop: 7, apartment: 16, commercial: 24, civic: 10, industrial: 9, military: 6, farm: 6, park: .3, cemetery: .3 };
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), S.buildings.length), m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    S.buildings.forEach((b, j) => {
      const hgt = (HT[b.kind] || 6) * (.8 + .4 * hsh(j));
      m4.compose(new THREE.Vector3(b.x - half, b.z * ex + hgt / 2, b.y - half), qt.setFromAxisAngle(up, -b.a), new THREE.Vector3(b.w, hgt, b.d));
      im.setMatrixAt(j, m4); im.setColorAt(j, col.set(BLD_COL[b.kind] || '#999'));
    });
    scene.add(im);
  }
  // labels for the main places, constant screen size
  if ($('oPoi').checked) for (const p of S.pois) {
    const key = p.start ? 'start' : p.type; if (!['city', 'town', 'start', 'seed', 'military', 'research', 'airport', 'airfield', 'harbor', 'secret', 'survivors', 'raiders', 'peak', 'lighthouse'].includes(key)) continue;
    const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = '600 28px system-ui'; const tw = g.measureText(p.name).width + 46;
    c.width = tw; c.height = 44; g.font = '600 28px system-ui'; g.fillStyle = 'rgba(10,12,16,.7)'; g.fillRect(0, 0, tw, 44);
    g.fillStyle = POI_STYLE[key][1]; g.beginPath(); g.arc(20, 22, 11, 0, 6.2832); g.fill(); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(p.name, 38, 23);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: false }));
    sp.scale.set(.035 * tw / 44, .035, 1); sp.center.set(0, 0); sp.position.set(p.x * cell - half, hAt(p.x * cell, p.y * cell) * ex + size * .004, p.y * cell - half); sp.renderOrder = 10; scene.add(sp);
  }
  if (resetCam || !V3.placed) { camera.position.set(0, size * .55, size * .78); controls.target.set(0, 0, 0); camera.far = size * 8; camera.updateProjectionMatrix(); V3.placed = true; }
}
$('v3d').onclick = () => toggle3D();
$('ex3d').oninput = () => { $('ex3dL').textContent = +$('ex3d').value === 1 ? '1 (true scale)' : $('ex3d').value + ' (exaggerated)'; clearTimeout(V3.t); V3.t = setTimeout(() => build3D(), 120); };
addEventListener('resize', () => V3.on && place3D());
// vector layer, in base-canvas units; drawn onto the screen-resolution overlay (and onto the Map .png export)
function drawOverlays(cx2) {
  const { n, k, cell, urban } = S, W = n * k;
  const u = W / 1010, px = v => (v + .5) * k;
  const sz = v => ovQ > 0 ? v * Math.pow(zoom, .15) / ovQ : v * u;   // symbol/label size: screen px on the overlay, map px on export
  // to scale: linear features use their real width in metres; mw() is only a legibility floor (screen px) for when that is sub-pixel
  const mw = v => ovQ > 0 ? v / ovQ : ovQ < 0 ? Math.min(v, 1) : v;
  if (ovQ >= 0 && $('oGrid').checked) {
    const step = S.sizeM / 10000;
    cx2.strokeStyle = 'rgba(255,255,255,.25)'; cx2.fillStyle = 'rgba(255,255,255,.7)'; cx2.lineWidth = sz(1); cx2.font = `${sz(11)}px system-ui`; cx2.textBaseline = 'alphabetic'; cx2.beginPath();
    for (let j = 1; j < 10; j++) { const p = W * j / 10, lab = +(j * step).toFixed(1) + ' km'; cx2.moveTo(p, 0); cx2.lineTo(p, W); cx2.moveTo(0, p); cx2.lineTo(W, p); cx2.fillText(lab, p + sz(3), sz(12)); cx2.fillText(lab, sz(3), p - sz(3)); }
    cx2.stroke();
  }
  if (ovQ > 0 && $('oTileGrid').checked) {
    const { count, x, y } = tileOptions(), step = (n - 1) / count, origin = px(0), end = px(n - 1);
    cx2.save(); cx2.strokeStyle = 'rgba(112,219,241,.65)'; cx2.lineWidth = mw(1); cx2.beginPath();
    for (let i = 0; i <= count; i++) {
      const p = px(i * step);
      cx2.moveTo(p, origin); cx2.lineTo(p, end); cx2.moveTo(origin, p); cx2.lineTo(end, p);
    }
    cx2.stroke();
    cx2.fillStyle = 'rgba(112,219,241,.15)'; cx2.fillRect(px(x * step), px(y * step), step * k, step * k);
    cx2.strokeStyle = '#70dbf1'; cx2.lineWidth = mw(2); cx2.strokeRect(px(x * step), px(y * step), step * k, step * k);
    cx2.restore();
  }
  if ($('oHyd').checked) drawRivers(cx2, k, '#2f7fc1', mw(1));
  if ($('oCor').checked) for (const c of S.corridors) {
    cx2.lineCap = cx2.lineJoin = 'round'; cx2.strokeStyle = 'rgba(190,60,255,.3)'; cx2.lineWidth = S.corW / S.cell * k; strokePts(cx2, c.pts, k);
    cx2.strokeStyle = 'rgba(230,150,255,.9)'; cx2.lineWidth = mw(1.5); cx2.setLineDash([mw(6), mw(5)]); strokePts(cx2, c.pts, k); cx2.setLineDash([]);
  }
  if (ovQ >= 0 && $('oMetro').checked && S.metro.length) {
    cx2.save(); cx2.strokeStyle = '#67d9ee'; cx2.lineWidth = Math.max(mw(1.3), 8 / cell * k);
    cx2.setLineDash([mw(5), mw(3)]);
    for (const line of S.metro) strokePts(cx2, line.points.map(([x, y]) => [x / cell, y / cell]), k);
    cx2.restore();
  }
  if ($('oBld').checked) {
    // settlement streets (metres), then buildings
    cx2.lineCap = cx2.lineJoin = 'round'; cx2.strokeStyle = 'rgba(232,226,212,.8)';
    for (const st of S.streets) {
      cx2.lineWidth = Math.max(mw(.7), st.w / cell * k); cx2.beginPath();
      st.pts.forEach(([x, y], j) => j ? cx2.lineTo((x / cell + .5) * k, (y / cell + .5) * k) : cx2.moveTo((x / cell + .5) * k, (y / cell + .5) * k)); cx2.stroke();
    }
    cx2.strokeStyle = 'rgba(0,0,0,.55)'; cx2.lineWidth = .5 * u;
    for (const b of S.buildings) {
      const w = Math.max(b.w / cell * k, mw(.6)), d = Math.max(b.d / cell * k, mw(.6));
      cx2.save(); cx2.translate((b.x / cell + .5) * k, (b.y / cell + .5) * k); cx2.rotate(b.a);
      cx2.fillStyle = BLD_COL[b.kind]; cx2.fillRect(-w / 2, -d / 2, w, d); if (w > mw(4)) cx2.strokeRect(-w / 2, -d / 2, w, d);
      cx2.restore();
    }
  }
  // real carriageway widths: highway 12 m, road 7 m, trail 2.5 m (+1.5 m verge casing)
  if ($('oRoad').checked) for (const [type, wm, minPx, col] of [['trail', 2.5, 1, '#d9b77a'], ['road', 7, 1.6, '#f0eadc'], ['highway', 12, 2.4, '#f2c14e']]) {
    cx2.lineCap = cx2.lineJoin = 'round';
    for (const pass of [0, 1]) {
      const lw = Math.max(wm / cell * k, mw(minPx));
      cx2.strokeStyle = pass ? col : 'rgba(0,0,0,.65)'; cx2.lineWidth = pass ? lw : lw + Math.max(3 / cell * k, mw(1.2));
      cx2.setLineDash(type === 'trail' && pass ? [Math.max(lw * 2, mw(4)), Math.max(lw * 1.5, mw(3))] : []);
      for (const r of S.roads) if (r.type === type) strokePts(cx2, r.pts, k);
    }
    cx2.setLineDash([]);
    // structures: viaducts get a pale parapet edge, tunnels are drawn dashed dark (the road is underground there)
    for (const r of S.roads) if (r.type === type && r.deck) for (const kind of [2, 3, 6]) for (let j = 0; j < r.deck.length; j++) {
      if (r.deck[j] !== kind) continue; let e = j; while (e < r.deck.length && r.deck[e] === kind) e++;
      const seg = r.pts.slice(Math.max(0, j - 1), Math.min(r.pts.length, e + 1)), lw = Math.max(wm / cell * k, mw(minPx));
      if (kind !== 3) { cx2.strokeStyle = 'rgba(245,245,245,.95)'; cx2.lineWidth = lw + Math.max(3 / cell * k, mw(2)); strokePts(cx2, seg, k); cx2.strokeStyle = col; cx2.lineWidth = lw; strokePts(cx2, seg, k); }
      else { cx2.strokeStyle = 'rgba(30,30,34,.95)'; cx2.lineWidth = lw; cx2.setLineDash([Math.max(lw * 2, mw(5)), Math.max(lw * 1.2, mw(3))]); strokePts(cx2, seg, k); cx2.setLineDash([]); }
      j = e;
    }
  }
  if ($('oSlice').checked && S.slice) for (const [b, col, lab] of [[S.slice, '#fff', 'Vertical slice 2×2 km'], [S.slice.dev, '#4ade80', 'Dev area ~1.5 km²']]) {
    const half = b.size / 2 / S.cell, X = px(b.cx - half), Y = px(b.cy - half), Wd = 2 * half * k;
    cx2.strokeStyle = col; cx2.lineWidth = mw(1.5); cx2.setLineDash([mw(5), mw(4)]); cx2.strokeRect(X, Y, Wd, Wd); cx2.setLineDash([]);
    cx2.font = `600 ${sz(11)}px system-ui`; cx2.fillStyle = col; cx2.textAlign = 'left'; cx2.textBaseline = 'bottom'; cx2.fillText(lab, X, Y - sz(2));
  }
  if ($('oPoi').checked) {
    cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
    for (const p of S.pois) {
      const key = p.start ? 'start' : p.type, [ch, bg, fg, r] = POI_STYLE[key], X = px(p.x), Y = px(p.y), R2 = sz(r);
      cx2.beginPath(); cx2.arc(X, Y, R2, 0, 6.2832); cx2.fillStyle = bg; cx2.fill(); cx2.lineWidth = sz(1.2); cx2.strokeStyle = '#000'; cx2.stroke();
      if (ch) { cx2.fillStyle = fg; cx2.font = `700 ${R2 * 1.15}px system-ui`; cx2.fillText(ch, X, Y + .5); }
      const major = LABELED.includes(key);
      if ($('oLab').checked && p.name && (major || $('oLab2').checked)) {
        cx2.font = `${major ? 600 : 500} ${sz(major ? 12 : 10)}px system-ui`; cx2.textAlign = 'left'; cx2.lineWidth = sz(3); cx2.lineJoin = 'round';
        cx2.strokeStyle = 'rgba(0,0,0,.8)'; cx2.strokeText(p.name, X + R2 + sz(3), Y);
        cx2.fillStyle = '#fff'; cx2.fillText(p.name, X + R2 + sz(3), Y); cx2.textAlign = 'center';
      }
    }
  }
}
// overlay canvas covers the visible map area at device resolution, so text and lines stay sharp at any zoom
const ov = $('ov'), ovx = ov.getContext('2d');
let ovRaf = 0, ovQ = 0;          // ovQ: screen px per map px (0 = drawing an export)
function scheduleOverlay() { cancelAnimationFrame(ovRaf); ovRaf = requestAnimationFrame(renderOverlay); }
function renderOverlay() {
  if (!S) return;
  const m = mainEl.getBoundingClientRect(), top = $('bar').getBoundingClientRect().bottom, dpr = devicePixelRatio || 1;
  const w = mainEl.clientWidth, h = mainEl.clientHeight - (top - m.top);
  Object.assign(ov.style, { left: m.left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
  ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr);
  const r = cv.getBoundingClientRect(), s = r.width / cv.width * dpr; ovQ = r.width / cv.width;
  ovx.setTransform(s, 0, 0, s, (r.left - m.left) * dpr, (r.top - top) * dpr);
  drawOverlays(ovx);
  ovx.setTransform(dpr, 0, 0, dpr, 0, 0); drawScaleBar(ovx, S.cell / S.k / ovQ, 14, h - 14, 1);
}
// scale bar: picks a round 1/2/5 length near 140 px; mpp = metres per drawn px
function drawScaleBar(ctx, mpp, x, y, s) {
  const tgt = 140 * s * mpp, p10 = Math.pow(10, Math.floor(Math.log10(tgt))), len = [5, 2, 1].map(f => f * p10).find(v => v <= tgt) || p10, px = len / mpp;
  const lab = len >= 1000 ? len / 1000 + ' km' : len + ' m';
  ctx.save(); ctx.font = `600 ${11 * s}px system-ui`; const tw = ctx.measureText(lab).width;
  ctx.fillStyle = 'rgba(10,12,16,.7)'; ctx.fillRect(x - 6 * s, y - 22 * s, px + tw + 22 * s, 28 * s);
  for (let j = 0; j < 4; j++) { ctx.fillStyle = j % 2 ? '#111' : '#fff'; ctx.fillRect(x + px * j / 4, y - 8 * s, px / 4, 6 * s); }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * s; ctx.strokeRect(x, y - 8 * s, px, 6 * s);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillText(lab, x + px + 8 * s, y - 2 * s);
  ctx.fillText('0', x - 2 * s, y - 11 * s); ctx.restore();
}
function strokePts(ctx, pts, k) { ctx.beginPath(); pts.forEach(([x, y], j) => j ? ctx.lineTo((x + .5) * k, (y + .5) * k) : ctx.moveTo((x + .5) * k, (y + .5) * k)); ctx.stroke(); }
// u = map-symbol scale (0 → physical widths only, for masks)
function drawRivers(ctx, k, col, minPx) {   // real channel width; minPx = legibility floor (scaled by river class)
  const { sc, cell, rivers, riverW } = S, buckets = {};
  for (const p of rivers) for (let j = 0; j < p.length - 1; j++) {
    const a = p[j][2], w = Math.round(Math.max(riverW(a) / cell * k, minPx * (a >= 35 * S.riverT ? 1.8 : a >= 6 * S.riverT ? 1.3 : .8)) * 8) / 8;
    (buckets[w] ??= []).push(p[j], p[j + 1]);
  }
  ctx.strokeStyle = col; ctx.lineCap = ctx.lineJoin = 'round';
  for (const w in buckets) {
    ctx.lineWidth = w; ctx.beginPath();
    const b = buckets[w]; for (let j = 0; j < b.length; j += 2) { ctx.moveTo((b[j][0] + .5) * k, (b[j][1] + .5) * k); ctx.lineTo((b[j + 1][0] + .5) * k, (b[j + 1][1] + .5) * k); }
    ctx.stroke();
  }
}

// ---------- info / hover ----------
const BN = ['Ocean', 'Beach', 'Plains', 'Forest', 'Highland', 'Alpine rock', 'Snow', 'Wetland', 'Lake', 'Farmland'];
function updateInfo() {
  const c = {}; for (const p of S.pois) { const k = p.start ? 'start town' : p.type; c[k] = (c[k] || 0) + 1; }
  const st = S.pois.find(p => p.start), city = S.pois.find(p => p.type === 'city'), fk = S.sizeM / 1000, s = S.stats;
  const big = S.lakes.slice().sort((a, b) => b.area - a.area)[0], pct = v => (100 * v / s.landCells).toFixed(0).padStart(3) + '%';
  const chain = st ? S.pois.filter(p => ['safehouse', 'radio', 'outpost'].includes(p.type) || p.name.includes('(slice)'))
    .map(p => `  ${p.name} – ${(Math.hypot(p.x - st.x, p.y - st.y) * S.cell).toFixed(0)} m`).join('\n') : '';
  $('stats').textContent =
    `Shape     ${S.shape}\nTerrain   ${S.terrainBackend === 'webgpu' ? 'WebGPU' : 'CPU'} · ${S.terrainSeconds.toFixed(2)} s\nFootprint ${fk}×${fk} km = ${(fk * fk).toFixed(0)} km²\nLand      ${s.landKm2.toFixed(0)} km² (${(100 * s.landKm2 / (fk * fk)).toFixed(0)}% of footprint)\nPeak      ${s.peak.toFixed(0)} m\n` +
    `Lakes     ${S.lakes.length}${big ? ` (largest ${big.area.toFixed(2)} km²)` : ''}\nRivers    ${s.riverKm.toFixed(0)} km channel\nRoads     ${S.roads.length} routes\nCell size ${S.cell.toFixed(1)} m\n\n` +
    'Regions\n' + REGION_NAME.slice(1).map((r, j) => `  ${r.padEnd(20)}${pct(s.regCnt[j + 1])}`).join('\n') +
    (S.scenario === 'desolation' ? '\n\nInfestation (start)\n' + STAGE_NAME.map((r, j) => `  ${r.padEnd(20)}${pct(s.stageCnt[j])}`).join('\n') : '') +
    '\n\n' + Object.entries(c).map(([k, v]) => `${k.padEnd(12)}${v}`).join('\n') +
    (st ? `\n\nStart: ${st.name}${city ? ` (${(Math.hypot(st.x - city.x, st.y - city.y) * S.cell / 1000).toFixed(1)} km from ${city.name})` : ''}\nSlice chapter:\n${chain}` : '') +
    (S.stageTimes ? '\n\nStage times\n' + S.stageTimes.map(([k, v]) => `  ${k.padEnd(34)}${v.toFixed(2)} s`).join('\n') : '') +
    `\n\nNo road access: ${s.unreachable.length ? s.unreachable.join(', ') : 'none'}` +
    `\n\nSurface access review (within 100 m): ${S.roadAccessReview.length ? S.roadAccessReview.map(p => p.name).join(', ') : 'clear'}` +
    resourcesText() + realityText();
}
function resourcesText() {
  const rs = S.resStats, a = rs.areaKm2, f = v => v.toFixed(1).padStart(6) + ' km²', cnt = t => S.pois.filter(p => p.type === t).length;
  return '\n\nResources (effective area)\n' +
    `  Softwood        ${f(a.softwood)}\n  Hardwood        ${f(a.hardwood)}\n  Standing timber ≈ ${(rs.timberM3 / 1e6).toFixed(1)} million m³\n` +
    `  Stone           ${f(a.stone)}\n  Clay            ${f(a.clay)}\n  Sand            ${f(a.sand)}\n  Crops           ${f(a.crops)}\n` +
    `  Forage          ${f(a.forage)}\n  Herbs           ${f(a.herbs)}\n  Game range      ${f(a.game)}\n  Fishing waters  ${f(a.fish)}\n  Alien biomass   ${f(a.alien)}\n` +
    '  Deposits: ' + (Object.entries(rs.deposits).map(([k, v]) => `${v} ${k}`).join(', ') || 'none') +
    `\n  Springs ${cnt('spring')}, fishing spots ${cnt('fishing')}, hunting stands ${cnt('hunting')}, clay pits ${cnt('claypit')}`;
}
function realityText() {
  const r = S.reality, t = S.travel, ok = b => b ? '✓' : '⚠', pc = v => (v * 100).toFixed(0) + '%', landKm2 = S.stats.landKm2;
  const LIM = { highway: .10, road: .155, trail: 1.2 }, nPoi = S.pois.filter(p => !['bridge', 'pass'].includes(p.type)).length;
  return '\n\nReality check\n' +
    `  ${ok(true)} ${r.lakes} lakes, each in a closed basin at its spill level\n` +
    `  ${ok(true)} ${r.pitsFilled} undrained hollow cells filled → all water drains (${r.culverts} road-sag cells drain via culverts)\n` +
    `  ${ok(true)} roads graded (cut & fill); bridges/culverts keep every channel open\n` +
    `  ${ok(!r.riverRoadRuns)} longest road stretch inside a river channel: ${Math.round(r.maxRiverRunM || 0)} m${r.riverRoadRuns ? ` (${r.riverRoadRuns} routes could not avoid it)` : ''}\n` +
    (r.farmKm2 != null ? `  ${ok(true)} farmland ${r.farmKm2.toFixed(1)} km² levelled: fields under 2° ${(r.farmSlopeBefore * 100).toFixed(0)}% → ${(r.farmSlopeAfter * 100).toFixed(0)}%, ${r.farmTerracedKm2.toFixed(1)} km² on terraced hillsides\n` : '') +
    `  ${ok(true)} structures: ${r.viaducts} viaducts (longest ${Math.round(r.maxViaductM || 0)} m), ${r.tunnels} tunnels (longest ${Math.round(r.maxTunnelM || 0)} m), ${r.overpasses || 0} overpasses, ${r.trailSteps || 0} trail step sections, ${r.footbridges || 0} footbridges\n` +
    (r.curves ? Object.entries(r.curves).filter(([, c]) => c.curves).map(([k, c]) => `  ${ok(true)} ${k}: ${c.curves} curves, tightest ${Math.round(c.minR)} m (design ${({ highway: 250, road: 60, trail: 8 })[k]} m), ${c.hairpins} hairpins`).join('\n') + '\n' : '') +
    `  ${ok(!r.uphill)} river beds rising downstream: ${r.uphill}\n` +
    `  ${ok(!r.undrained)} land cells that can't drain (final terrain): ${r.undrained}\n` +
    `  ${ok(!r.badEnd)} rivers without a valid outlet: ${r.badEnd}\n` +
    (r.erosion ? `  ${ok(true)} erosion (${r.erosion.level}): ${r.erosion.iterations} iterations on a ${r.erosion.grid} grid\n` : '') +
    `  ${ok(true)} river landforms: ${r.deltas || 0} deltas, ${(r.floodplainKm2 || 0).toFixed(1)} km² floodplain, ${r.waterfalls || 0} waterfalls\n` +
    (S.mainland ? `  Rivers continuing off the map: ${S.rivers.filter(p => p.exitsMap).length}\n` : '') +
    `  ${ok(!r.wetB)} buildings in water: ${r.wetB}\n` +
    `  ${ok(!r.lowB)} homes below 1.5 m (flood risk): ${r.lowB}\n` +
    `  ${ok(!r.lakesDrained)} lakes drained by roads/channels: ${r.lakesDrained}\n` +
    Object.keys(LIM).map(k => `  ${ok(!r.steep[k])} ${k} max grade ${pc(r.maxG[k])} (limit ${pc(LIM[k])}), over: ${r.steep[k]}`).join('\n') +
    '\n\nScale & travel\n' +
    `  Land extent ${t.extentKm.toFixed(1)} km (walk ≈ ${(t.extentKm / 5).toFixed(1)} h at 5 km/h)\n` +
    (t.startCityKm != null ? `  Start → city ${t.startCityKm.toFixed(1)} km by road (${t.startCityLineKm.toFixed(1)} km direct), drive ≈ ${(t.startCityKm / 50 * 60).toFixed(0)} min at 50 km/h\n` : '') +
    `  Roads: highway ${t.roadKm.highway.toFixed(1)} km · road ${t.roadKm.road.toFixed(1)} km · trail ${t.roadKm.trail.toFixed(1)} km\n` +
    `  Density: ${(nPoi / landKm2).toFixed(2)} places/km², ${(S.buildings.length / landKm2).toFixed(0)} buildings/km²\n` +
    `  ${ok(!t.singleAccess.length)} single road access: ${t.singleAccess.length ? t.singleAccess.join(', ') : 'none'}`;
}
cv.addEventListener('mousemove', e => {
  if (!S) return; const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * S.n), y = Math.floor((e.clientY - r.top) / r.height * S.n);
  if (x < 0 || y < 0 || x >= S.n || y >= S.n) return; const i = y * S.n + x;
  $('hover').textContent = `${(x * S.cell / 1000).toFixed(2)}, ${(y * S.cell / 1000).toFixed(2)} km  ·  ${S.h[i].toFixed(0)} m  ·  slope ${S.slope[i].toFixed(0)}°  ·  ${BN[S.biome[i]]}` +
    (S.land[i] ? `  ·  ${REGION_NAME[S.region[i]]}  ·  ${STAGE_NAME[S.stageT[i]]}` : '') + (S.riv[i] ? ' · river' : '') + nearPoi(x, y, 10 / (r.width / S.n));
});
function nearPoi(x, y, thr) {
  let best = null, bd = thr; for (const p of S.pois) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd && p.type !== 'bridge') { bd = d; best = p; } }
  return best ? `  ·  ▸ ${best.name || best.type}` : '';
}
