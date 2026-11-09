"use strict";

// ---------- saved worlds and shareable links ----------
// Every setting that changes the generated world. The same values reproduce the same map (CPU compute is deterministic; WebGPU may differ slightly).
const SETTING_IDS = ['seed', 'scenario', 'fp', 'shape', 'size', 'compute', 'mtn', 'lakes', 'riv', 'elevation', 'erosion', 'snowLine', 'terrainScale', 'landforms', 'hydraulic'];
const settingsSnapshot = () => Object.fromEntries(SETTING_IDS.map(id => [id, String($(id).value)]));
function applySettings(settings) {
  for (const id of SETTING_IDS) if (settings[id] != null && $(id)) $(id).value = settings[id];
}
const settingsToHash = (settings = settingsSnapshot()) => '#' + new URLSearchParams(settings).toString();
function settingsFromHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, '')), out = {};
  for (const id of SETTING_IDS) if (params.has(id)) out[id] = params.get(id);
  return out;
}
const SAVED_KEY = 'worldforge.savedWorlds';
function readSaved() {
  try { const list = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}
function writeSaved(list) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); return true; } catch { return false; } }
function savedLabel(w) { return w.name || `${w.settings.seed} · ${w.settings.shape}`; }
function refreshSaved(selectedIndex) {
  const select = $('savedList'), list = readSaved();
  select.replaceChildren(...list.map((w, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: savedLabel(w) })));
  if (list.length) select.value = String(Math.min(selectedIndex ?? list.length - 1, list.length - 1));
  $('loadSaved').disabled = $('deleteSaved').disabled = !list.length;
}
// keep the address bar on a link that recreates the current world
function syncHash() {
  if (typeof history === 'undefined' || typeof location === 'undefined' || location.protocol === 'about:') return;
  try { history.replaceState(null, '', settingsToHash()); } catch { /* sandboxed frames refuse history changes */ }
}
if (typeof $ === 'function') {
  $('saveWorld').onclick = () => {
    const settings = settingsSnapshot(), name = $('saveName').value.trim(), list = readSaved();
    const existing = list.findIndex(w => JSON.stringify(w.settings) === JSON.stringify(settings));
    if (existing >= 0) { if (name) list[existing].name = name; } else list.push({ name, settings, savedAt: Date.now() });
    const ok = writeSaved(list);
    refreshSaved(existing >= 0 ? existing : list.length - 1);
    $('status').textContent = ok ? 'Saved ' + savedLabel(list[existing >= 0 ? existing : list.length - 1]) : 'Could not save: browser storage is unavailable.';
    if (ok) $('saveName').value = '';
  };
  $('loadSaved').onclick = () => {
    const world = readSaved()[+$('savedList').value]; if (!world) return;
    applySettings(world.settings); $('gen').click();
  };
  $('deleteSaved').onclick = () => {
    const list = readSaved(), i = +$('savedList').value; if (!list[i]) return;
    const [gone] = list.splice(i, 1); writeSaved(list); refreshSaved(i); $('status').textContent = 'Removed ' + savedLabel(gone);
  };
  $('shareLink').onclick = async () => {
    const url = (typeof location !== 'undefined' ? location.href.split('#')[0] : '') + settingsToHash();
    try { await navigator.clipboard.writeText(url); $('status').textContent = 'Link copied. Opening it recreates this world.'; }
    catch { window.prompt?.('Copy this link:', url); }
  };
}
