// FrameFlow Map (mobile): touch-first editor built on the Map Studio engine.
import { THEMES, TEXTURES, DEFAULT_TEXTURE, LABEL_SHAPES, LABEL_WEIGHTS, DEFAULT_LABEL_STYLE, LABEL_PRESETS, TRAVEL_ICONS, labelStyleOf, mapFontsUsed, ACTION_TYPES, PRESETS, makeAction, makeShot, newMapProject, demoMapProject, validateMapProject, buildGeo, drawMap, screenToLonLat, countryAt, project as projectPoint, lonToX, latToY } from './map-engine.mjs';
import { CITIES, REGIONS } from './map-places.mjs';
import { FONTS, FONT_GROUPS, loadFont, loadFonts } from './fonts.mjs';
import { exportMapVideo } from './map-video-export.mjs';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
const canvas = $('#canvas'), ctx = canvas.getContext('2d');
const STORE = 'frameflow-map-mobile-v1', QSTORE = 'frameflow-map-mobile-quality';
const LW = 92; // width of the sticky label column in the timeline (matches --lw in style.css)
const EASE_OPTS = [['easeInOut', 'Ease in & out'], ['linear', 'Linear'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out'], ['backOut', 'Overshoot']];
const PREVIEW_PX = { fast: 640, balanced: 960, full: 1e9 };

let proj, sel = null, frame = 0, playing = false, loop = true, raf, startTime, startFrame;
let undoStack = [], redoStack = [], geo = null, geoState = 'idle', geoError = '', pick = null, exporting = false, lastView = null;
let drag = null, scrubbing = false, tlPpf = 2, quality = 'balanced';
try { quality = localStorage.getItem(QSTORE) || 'balanced'; if (!PREVIEW_PX[quality]) quality = 'balanced'; } catch { /* ignore */ }

// ------------------------------------------------------------------ helpers
const items = () => [...proj.shots].sort((a, b) => a.start - b.start).concat(proj.actions);
const current = () => items().find(i => i.id === sel);
const isShot = it => it.kind === 'shot';
const iconOf = it => (isShot(it) ? PRESETS[it.preset].icon : ACTION_TYPES[it.type].icon);
const clsOf = it => (isShot(it) ? 'shot' : it.type);
const planes = () => proj.actions.filter(a => a.type === 'plane');

function notify(s) { const t = $('#toast'); t.textContent = s; t.classList.add('show'); clearTimeout(notify.timer); notify.timer = setTimeout(() => t.classList.remove('show'), 2600); }
function checkpoint() { undoStack.push(JSON.stringify(proj)); if (undoStack.length > 80) undoStack.shift(); redoStack = []; updateHistory(); }
function updateHistory() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }
function saveLocal() { try { localStorage.setItem(STORE, JSON.stringify(proj)); } catch { notify('Storage is full. Use Project → Save file to keep your work.'); } }
function changed() { saveLocal(); renderItems(); renderTimeline(); draw(); }
function history(dir) {
  pause();
  const from = dir === 'undo' ? undoStack : redoStack, to = dir === 'undo' ? redoStack : undoStack;
  if (!from.length) return;
  to.push(JSON.stringify(proj)); proj = JSON.parse(from.pop());
  if (!items().some(i => i.id === sel)) sel = null;
  frame = Math.min(frame, proj.frames - 1); saveLocal(); renderAll();
}
function ensureLength(end) { if (end > proj.frames) { proj.frames = Math.min(1800, Math.ceil(end + 15)); syncDuration(); } }
function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
const fileBase = () => (proj.name || 'map').replace(/[^a-z0-9 _-]/gi, '').trim() || 'map';

// ------------------------------------------------------------------ map data
async function ensureGeo() {
  if (geo || geoState === 'loading') return;
  geoState = 'loading'; draw();
  try {
    const [hi, lo] = await Promise.all(['countries-50m.json', 'countries-110m.json'].map(f => fetch('map-data/' + f).then(r => { if (!r.ok) throw Error(`${f}: HTTP ${r.status}`); return r.json(); })));
    geo = buildGeo(hi, lo); geoState = 'ready'; buildLists();
  } catch (e) { geoState = 'error'; geoError = e.message || String(e); }
  renderAll();
}
const cityKey = c => (geo && geo.byName.has(c[0]) ? `${c[0]} (city)` : c[0]);
function buildLists() {
  const opt = (v, l) => `<option value="${esc(v)}" label="${esc(l)}"></option>`, countries = geo ? geo.names.map(n => opt(n, 'Country')).join('') : '', cities = CITIES.map(c => opt(cityKey(c), `City · ${c[3]}`)).join('');
  $('#dlBorder').innerHTML = opt('All countries', 'Every border') + countries; $('#dlCountry').innerHTML = countries;
  $('#dlPlace').innerHTML = cities; $('#dlAny').innerHTML = cities + countries;
}
const locText = l => (!l ? '' : l.kind === 'all' ? 'All countries' : l.kind === 'city' && geo && geo.byName.has(l.name) ? `${l.name} (city)` : l.name);
function parseLoc(text, kinds) {
  const t = text.trim(), low = t.toLowerCase();
  if (!t) return null;
  const wantCountry = ['border', 'country', 'any'].includes(kinds), wantPlace = ['place', 'any'].includes(kinds);
  if (kinds === 'border' && (low === 'all countries' || low === 'all')) return { kind: 'all', name: 'All countries' };
  if (wantCountry && geo) { const n = geo.names.find(x => x.toLowerCase() === low); if (n) return { kind: 'country', name: n }; }
  if (wantPlace) {
    const c = CITIES.find(c => cityKey(c).toLowerCase() === low) || CITIES.find(c => c[0].toLowerCase() === low);
    if (c) return { kind: 'city', name: c[0], lat: c[1], lon: c[2] };
    const m = t.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return { kind: 'point', name: `${(+m[1]).toFixed(2)}, ${(+m[2]).toFixed(2)}`, lat: +m[1], lon: +m[2] };
  }
  return null;
}

// ------------------------------------------------------------------ drawing + playback
const seenFonts = new Set();
function syncFonts() { for (const n of mapFontsUsed(proj)) { if (seenFonts.has(n)) continue; seenFonts.add(n); loadFont(n).then(() => draw()); } }
function previewSize() { const k = Math.min(1, PREVIEW_PX[quality] / Math.max(proj.width, proj.height)); return [Math.round(proj.width * k), Math.round(proj.height * k)]; }
function draw() {
  syncFonts();
  const [w, h] = previewSize();
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ratio = `${w} / ${h}`; if (canvas.style.aspectRatio !== ratio) canvas.style.aspectRatio = ratio;
  if (!geo) {
    ctx.fillStyle = '#0d1b2a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9fb3c4'; ctx.textAlign = 'center'; ctx.font = `600 ${Math.round(h / 20)}px Arial, sans-serif`;
    ctx.fillText(geoState === 'error' ? 'Map data could not be loaded' : 'Loading map…', w / 2, h / 2);
    if (geoState === 'error') { ctx.font = `${Math.round(h / 30)}px Arial, sans-serif`; ctx.fillText('Check your connection and reload.', w / 2, h / 2 + h / 12); }
    return;
  }
  lastView = drawMap(ctx, w, h, proj, frame, geo);
}
function timecode(f) { return [Math.floor(f / proj.fps / 60), Math.floor(f / proj.fps) % 60, f % proj.fps].map(x => String(x).padStart(2, '0')).join(':'); }
function updatePlayhead() {
  const ph = $('#ph'); if (!ph) return;
  const x = LW + frame * tlPpf; ph.style.left = x + 'px';
  if (playing && $('#p-timeline').classList.contains('on')) { const t = $('#tl'); if (x < t.scrollLeft + LW || x > t.scrollLeft + t.clientWidth - 24) t.scrollLeft = Math.max(0, x - LW - 40); }
}
function setFrame(n) {
  frame = clamp(Math.round(n) || 0, 0, proj.frames - 1);
  $('#scrub').max = proj.frames - 1; $('#scrub').value = frame; $('#time').textContent = timecode(frame);
  updatePlayhead(); draw();
}
function pause() { playing = false; cancelAnimationFrame(raf); $('#play').textContent = '▶'; }
function play() {
  if (playing) { pause(); return; }
  if (frame >= proj.frames - 1) frame = 0;
  playing = true; startTime = performance.now(); startFrame = frame; $('#play').textContent = 'Ⅱ';
  const tick = t => {
    let f = startFrame + Math.floor((t - startTime) / 1000 * proj.fps);
    if (f >= proj.frames) { if (loop) f %= proj.frames; else { setFrame(proj.frames - 1); pause(); return; } }
    if (f !== frame) setFrame(f);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ tabs + add panel
function showTab(n) {
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + n));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === n));
  if (n === 'timeline') renderTimeline();
}
function buildStaticUI() {
  $('#addGrid').innerHTML = Object.entries(ACTION_TYPES).map(([k, a]) => `<button data-add="${k}"><b>${a.icon}</b><span>${a.label}</span></button>`).join('');
  $('#presetGrid').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button data-pre="${k}" title="${esc(p.hint)}"><b>${p.icon}</b><span>${p.label}</span></button>`).join('');
  $$('[data-add]').forEach(el => el.onclick = () => addAction(el.dataset.add));
  $$('[data-pre]').forEach(el => el.onclick = () => addShot(el.dataset.pre));
  $('#theme').innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
  $('#texture').innerHTML = Object.entries(TEXTURES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('#region').innerHTML = Object.entries(REGIONS).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('') + '<option value="custom">Custom</option>';
  $$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
}
function suggestTarget() {
  const c = current(), src = c && c.type ? c : [...proj.actions].reverse()[0];
  if (!src) return null;
  const t = src.type === 'border' || src.type === 'highlight' ? src.target : src.type === 'pin' ? src.place : src.type === 'plane' ? src.to : null;
  return t && t.kind !== 'all' ? clone(t) : null;
}
function addAction(type) {
  pause(); checkpoint();
  const a = makeAction(type, frame); ensureLength(a.start + a.dur);
  proj.actions.push(a); sel = a.id; saveLocal(); renderAll(); showTab('edit'); notify(`${ACTION_TYPES[type].label} added at frame ${frame}`);
}
function addShot(preset) {
  const needsPlane = PRESETS[preset].fields.includes('planeId');
  if (needsPlane && !planes().length) { notify('Add a Travel animation first'); return; }
  pause(); checkpoint();
  const c = current(), extra = {}, t = suggestTarget(); if (t) extra.target = t;
  if (needsPlane) extra.planeId = (c && c.type === 'plane' ? c : planes()[0]).id;
  const s = makeShot(preset, frame, extra); ensureLength(s.start + s.dur);
  proj.shots.push(s); sel = s.id; saveLocal(); renderAll(); showTab('edit'); notify(`${PRESETS[preset].label} camera added at frame ${frame}`);
}
function renderItems() {
  const its = items(), box = $('#itemSel');
  box.innerHTML = (sel && its.some(i => i.id === sel) ? '' : `<option value="" selected>${its.length ? 'Choose an item…' : 'Nothing yet. Use the Add tab'}</option>`) +
    its.map(it => `<option value="${esc(it.id)}" ${it.id === sel ? 'selected' : ''}>${iconOf(it)}  ${esc(it.name)} · ${it.start}</option>`).join('');
  $$('.js-dup, .js-del').forEach(b => b.disabled = !current());
}
function select(id) { sel = id; renderItems(); renderInspector(); renderTimeline(); }
function selectLight(id) { // used while dragging: keep the timeline DOM intact
  if (sel === id) return; sel = id; renderItems(); renderInspector();
  $$('.tl-row').forEach(r => r.classList.toggle('selected', r.dataset.id === id)); $$('.clip').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
}

// ------------------------------------------------------------------ inspector
const F = {
  text: (k, label, v, max = 80, ph = '') => `<label>${label}<input data-mf="${k}" data-t="text" maxlength="${max}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" autocomplete="off"></label>`,
  num: (k, label, v, min, max, step = 1) => `<label>${label}<input data-mf="${k}" data-t="num" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${Number((+v).toFixed(2))}"></label>`,
  range: (k, label, v, min, max, step, fmt = x => x) => `<label>${label} <span class="val">${fmt(v)}</span><input data-mf="${k}" data-t="range" type="range" min="${min}" max="${max}" step="${step}" value="${v}"></label>`,
  chk: (k, label, v) => `<label class="chk"><input type="checkbox" data-mf="${k}" data-t="chk" ${v ? 'checked' : ''}> ${label}</label>`,
  color: (k, label, v) => `<label>${label}<input type="color" data-mf="${k}" data-t="color" value="${esc(v)}"></label>`,
  sel: (k, label, v, opts) => `<label>${label}<select data-mf="${k}" data-t="sel">${opts.map(([o, l]) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`,
  loc: (k, label, v, kinds) => {
    const dl = { border: 'dlBorder', country: 'dlCountry', place: 'dlPlace', any: 'dlAny' }[kinds];
    const hint = kinds === 'border' ? 'Country or All countries' : kinds === 'country' ? 'Country' : 'City or lat, lon';
    return `<div class="loc"><label>${label}<input data-mf="${k}" data-t="loc" data-kinds="${kinds}" list="${dl}" value="${esc(locText(v))}" placeholder="${hint}" autocomplete="off" autocapitalize="words" spellcheck="false"></label><button type="button" data-pick="${k}" data-kinds="${kinds}" aria-label="Choose on the map" title="Choose on the map">⌖</button></div>`;
  },
};
function renderInspector() {
  const it = current(), box = $('#inspector');
  if (!it) { box.innerHTML = '<p class="muted">Pick an item above, or open the <b>Add</b> tab to create a Border, Travel, Highlight or Pin, then a camera move.</p>'; return; }
  const shot = isShot(it);
  let h = `<div class="insp-title"><span class="c-${clsOf(it)}">${iconOf(it)}</span> <em>${shot ? 'Camera move' : ACTION_TYPES[it.type].label}</em></div>` + F.text('name', 'Name', it.name, 100);
  if (shot) h += F.sel('preset', 'Camera move', it.preset, Object.entries(PRESETS).map(([k, p]) => [k, p.label]));
  h += `<div class="two">${F.num('start', 'Start frame', it.start, 0, 1799)}${F.num('dur', 'Length (frames)', it.dur, 1, 1800)}</div>` + F.sel('easing', 'Motion', it.easing, EASE_OPTS);
  if (!shot) h += F.chk('keep', 'Stay on screen after it finishes', it.keep !== false);
  h += `<div class="sep">${shot ? 'Camera' : 'Look'}</div>` + (shot ? shotFields(it) : actionFields(it) + labelFields(it));
  box.innerHTML = h; bindInspector(it);
}
function actionFields(a) {
  switch (a.type) {
    case 'border': return F.loc('target', 'Country', a.target, 'border') + F.color('color', 'Line color', a.color) + F.range('width', 'Line width', a.width, 1, 12, .5) + F.chk('glow', 'Glow', a.glow) + F.range('fillAlpha', 'Fill after drawing', a.fillAlpha, 0, .6, .02, x => Math.round(x * 100) + '%');
    case 'plane': return F.sel('icon', 'Icon', a.icon || 'plane', Object.entries(TRAVEL_ICONS).map(([k, i]) => [k, i.label])) + (a.icon === 'money' ? F.text('symbol', 'Coin symbol', a.symbol ?? '$', 4, '$  €  £  ৳  ₹  ¥') : '') + F.loc('from', 'From', a.from, 'place') + F.loc('to', 'To', a.to, 'place') + F.color('color', 'Trail color', a.color) + F.color('planeColor', 'Icon color', a.planeColor) + `<div class="two">${F.num('size', 'Icon size', a.size, 8, 80)}${F.num('lift', 'Arc height', a.lift, 0, 300)}</div>` + F.range('width', 'Trail width', a.width, 1, 12, .5) + F.chk('glow', 'Glow', a.glow) + F.chk('dashed', 'Dashed trail', a.dashed) + F.chk('showPath', 'Show planned route', a.showPath) + F.chk('showLabels', 'Show place names', a.showLabels) + (a.showLabels ? F.text('fromLabel', 'Start label text', a.fromLabel, 80, 'Uses the place name') + F.text('toLabel', 'End label text', a.toLabel, 80, 'Uses the place name') : '');
    case 'highlight': {
      const country = a.target.kind === 'country';
      return F.sel('__hmode', 'Highlight a', country ? 'country' : 'place', [['country', 'Country'], ['place', 'Place (radius)']]) + F.loc('target', country ? 'Country' : 'Place', a.target, country ? 'country' : 'place') + F.color('color', 'Color', a.color) + (country ? '' : F.num('radius', 'Radius (km)', a.radius, 5, 10000)) + F.range('dim', 'Dim the rest of the map', a.dim, 0, .85, .05, x => Math.round(x * 100) + '%') + F.chk('pulse', 'Pulse', a.pulse) + F.chk('showLabel', 'Show label', a.showLabel) + F.text('label', 'Label text', a.label, 60, 'Uses the place name');
    }
    case 'pin': return F.loc('place', 'Location', a.place, 'place') + F.color('color', 'Pin color', a.color) + F.range('size', 'Pin size', a.size, .5, 3, .1, x => x + '×') + F.chk('showLabel', 'Show label', a.showLabel) + F.text('label', 'Label text', a.label, 60, 'Uses the place name');
  }
  return '';
}
function shotFields(s) {
  const P = PRESETS[s.preset], has = k => P.fields.includes(k);
  let h = `<p class="muted">${esc(P.hint)}.</p>`;
  if (has('target')) h += F.loc('target', 'Target', s.target, 'any');
  if (has('autoFit') && s.target.kind === 'country') h += F.chk('autoFit', 'Fit the whole country in view', s.autoFit);
  if (has('planeId')) h += F.sel('planeId', 'Travel route', s.planeId, [['', 'Choose a route…'], ...planes().map(a => [a.id, `${a.name} (${a.from.name} → ${a.to.name})`])]);
  if (has('zoom') && !(has('autoFit') && s.autoFit && s.target.kind === 'country')) h += F.num('zoom', 'Zoom level', s.zoom, 1, 12, .1);
  if (has('amount')) h += F.num('amount', s.preset === 'pullBack' ? 'Zoom out by' : 'Zoom in by', s.amount, 0, 8, .1);
  if (has('degrees')) h += F.num('degrees', 'Rotate by (degrees)', s.degrees, -720, 720, 5);
  if (has('pitch')) h += F.range('pitch', 'Tilt', s.pitch, 0, 70, 1, x => x + '°');
  if (has('bearing')) h += F.num('bearing', 'Rotation (degrees)', s.bearing, -180, 180, 5);
  if (has('lockHeading')) h += F.chk('lockHeading', 'Turn with the icon', s.lockHeading);
  return h;
}
function bindInspector(it) {
  let gesture = false;
  $$('#inspector [data-mf]').forEach(el => {
    const key = el.dataset.mf, t = el.dataset.t;
    const read = () => (t === 'chk' ? el.checked : t === 'num' ? Number(el.value) : el.value);
    if (t === 'range' || t === 'color') {
      el.oninput = () => {
        if (!gesture) { checkpoint(); gesture = true; }
        const v = t === 'range' ? Number(el.value) : el.value; it[key] = v;
        const out = el.parentElement.querySelector('.val'); if (out) out.textContent = key === 'pitch' ? v + '°' : key === 'size' ? v + '×' : ['fillAlpha', 'dim'].includes(key) ? Math.round(v * 100) + '%' : v;
        draw();
      };
      el.onchange = () => { gesture = false; changed(); };
      return;
    }
    el.onchange = () => {
      if (t === 'loc') {
        const loc = parseLoc(el.value, el.dataset.kinds);
        if (!loc) { notify('Not found. Type a city, a country, or "lat, lon"'); el.value = locText(it[key]); return; }
        checkpoint(); it[key] = loc; changed(); renderInspector(); return;
      }
      let v = read(); checkpoint();
      if (key === 'name') { it.name = String(v).slice(0, 100) || 'Untitled'; changed(); return; }
      if (key === 'preset') { const old = PRESETS[it.preset].label, { dur, ...rest } = PRESETS[v].def; it.preset = v; Object.assign(it, rest); if (it.name === old) it.name = PRESETS[v].label; if (PRESETS[v].fields.includes('planeId') && !it.planeId) it.planeId = planes()[0]?.id || ''; changed(); renderInspector(); return; }
      if (key === 'icon') { const old = TRAVEL_ICONS[it.icon] || TRAVEL_ICONS.plane, nu = TRAVEL_ICONS[v]; if (!nu) return; if (it.planeColor === old.color) it.planeColor = nu.color; if (it.lift === old.lift) it.lift = nu.lift; if (['Travel', 'Plane', old.label].includes(it.name)) it.name = nu.label; it.icon = v; changed(); renderInspector(); return; }
      if (key === '__lscustom') { if (v) it.labelStyle = { ...labelStyleOf(proj) }; else delete it.labelStyle; changed(); renderInspector(); return; }
      if (key === '__hmode') { it.target = v === 'country' ? { kind: 'country', name: (lastView && geo && countryAt(geo, ...centerLonLat())) || 'Australia' } : { kind: 'city', name: 'Paris', lat: 48.8566, lon: 2.3522 }; changed(); renderInspector(); return; }
      if (t === 'num') {
        const lo = Number(el.min), hi = Number(el.max); v = clamp(Number.isFinite(v) ? v : lo, lo, hi);
        if (key === 'start' || key === 'dur') { v = Math.round(v); it[key] = v; ensureLength(it.start + it.dur); el.value = v; changed(); return; }
        el.value = v;
      }
      it[key] = v; changed(); if (key === 'autoFit' || key === 'showLabels') renderInspector();
    };
  });
  $$('#inspector [data-pick]').forEach(el => el.onclick = () => startPick(el.dataset.pick, el.dataset.kinds));
  if (!isShot(it) && it.labelStyle) bindLabelStyle($('#inspector'), () => it.labelStyle, v => { it.labelStyle = v; }, () => renderInspector());
}
function centerLonLat() { const l = screenToLonLat(lastView, canvas.width / 2, canvas.height / 2); return l ? [l.lon, l.lat] : [0, 0]; }

// ------------------------------------------------------------------ label style (project-wide, optional override per item)
function fontSelect(cur) {
  const known = FONTS.some(f => f.n === cur);
  return `<label>Font<select data-ls="font" data-t="sel">${FONT_GROUPS.map((g, i) => `<optgroup label="${esc(g)}">${FONTS.filter(f => f.c === i).map(f => `<option ${f.n === cur ? 'selected' : ''}>${esc(f.n)}</option>`).join('')}</optgroup>`).join('')}${known ? '' : `<option selected>${esc(cur)}</option>`}</select></label>`;
}
function labelStyleHtml(st) {
  const o = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`;
  const num = (k, label, min, max, step) => `<label>${label}<input data-ls="${k}" data-t="num" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${Number(st[k])}"></label>`;
  const chk = (k, label) => `<label class="chk"><input type="checkbox" data-ls="${k}" data-t="chk" ${st[k] ? 'checked' : ''}> ${label}</label>`;
  const color = (k, label) => `<label>${label}<input type="color" data-ls="${k}" data-t="color" value="${esc(st[k])}"></label>`;
  const range = (k, label, min, max, step, fmt) => `<label>${label} <span class="val">${fmt(st[k])}</span><input data-ls="${k}" data-t="range" type="range" min="${min}" max="${max}" step="${step}" value="${st[k]}"></label>`;
  return `<label>Start from a style<select data-lspreset><option value="">Choose a preset…</option>${Object.entries(LABEL_PRESETS).map(([k, p]) => o(k, p.label, '')).join('')}</select></label>` +
    fontSelect(st.font) +
    `<div class="two"><label>Weight<select data-ls="weight" data-t="int">${LABEL_WEIGHTS.map(([w, l]) => o(w, l, st.weight)).join('')}</select></label>${num('size', 'Size', 6, 80, 1)}</div>` +
    `<label>Shape<select data-ls="shape" data-t="sel">${Object.entries(LABEL_SHAPES).map(([k, l]) => o(k, l, st.shape)).join('')}</select></label>` +
    chk('useTheme', 'Use the map style’s label colors') + (st.useTheme ? '' : color('text', 'Text color') + (st.shape === 'none' ? '' : color('bg', 'Background color') + range('bgAlpha', 'Background opacity', 0, 1, .05, x => Math.round(x * 100) + '%'))) +
    (st.shape === 'none' ? '' : `<div class="two">${num('borderW', 'Border width', 0, 8, .5)}${color('border', 'Border color')}</div>`) +
    range('spacing', 'Letter spacing', 0, 40, 1, x => x + '%') + chk('italic', 'Italic') + chk('caps', 'ALL CAPS') + chk('halo', 'Outline around text') + chk('shadow', 'Soft shadow');
}
function bindLabelStyle(root, get, replace, rerender) {
  let gesture = false;
  const preset = root.querySelector('[data-lspreset]');
  if (preset) preset.onchange = () => { const p = LABEL_PRESETS[preset.value]; if (!p) return; checkpoint(); replace({ ...DEFAULT_LABEL_STYLE, ...p.style }); changed(); rerender(); };
  root.querySelectorAll('[data-ls]').forEach(el => {
    const key = el.dataset.ls, t = el.dataset.t, val = () => (t === 'chk' ? el.checked : ['num', 'range', 'int'].includes(t) ? Number(el.value) : el.value);
    if (t === 'range' || t === 'color') {
      el.oninput = () => { if (!gesture) { checkpoint(); gesture = true; } const v = val(); get()[key] = v; const out = el.parentElement.querySelector('.val'); if (out) out.textContent = key === 'spacing' ? v + '%' : Math.round(v * 100) + '%'; draw(); };
      el.onchange = () => { gesture = false; changed(); };
      return;
    }
    el.onchange = () => {
      let v = val(); checkpoint();
      if (t === 'num') { const lo = Number(el.min), hi = Number(el.max); v = clamp(Number.isFinite(v) ? v : lo, lo, hi); el.value = v; }
      get()[key] = v; changed(); if (key === 'useTheme' || key === 'shape') rerender();
    };
  });
}
function renderLabelPanel() {
  const box = $('#labelStyle'), wasOpen = box.querySelector('details')?.open, st = labelStyleOf(proj);
  box.innerHTML = `<details ${wasOpen ? 'open' : ''}><summary>Label style <span>Aa</span></summary><p class="muted">Applies to every place name, pin and highlight label. You can override it on any single item in the Edit tab.</p>${labelStyleHtml(st)}</details>`;
  bindLabelStyle(box, () => (proj.labelStyle ||= { ...DEFAULT_LABEL_STYLE }), v => { proj.labelStyle = v; }, renderLabelPanel);
}
function labelFields(a) {
  if (!['plane', 'highlight', 'pin'].includes(a.type)) return '';
  return '<div class="sep">Label style</div>' + F.chk('__lscustom', 'Custom style for this label', !!a.labelStyle) + (a.labelStyle ? labelStyleHtml(labelStyleOf(proj, a)) : '<p class="muted">Using the project label style (Project tab).</p>');
}

// ------------------------------------------------------------------ pick a location by tapping the map
function startPick(key, kinds) {
  if (!current()) return;
  pick = { key, kinds, id: sel, mode: kinds === 'country' || kinds === 'border' ? 'country' : 'place' };
  document.body.classList.add('picking'); $('#pickbar').hidden = false; $('#pickKind').hidden = kinds !== 'any';
  $$('#pickKind button').forEach(b => b.classList.toggle('active', b.dataset.pk === pick.mode));
  $('#pickMsg').textContent = pick.mode === 'country' ? 'Tap a country on the map' : 'Tap the map to choose a place';
  draw();
}
function cancelPick() { pick = null; document.body.classList.remove('picking'); $('#pickbar').hidden = true; draw(); }
canvas.addEventListener('pointerdown', e => {
  if (!pick) return;
  if (!lastView || !geo) return;
  const b = canvas.getBoundingClientRect(), sx = (e.clientX - b.left) / b.width * canvas.width, sy = (e.clientY - b.top) / b.height * canvas.height, ll = screenToLonLat(lastView, sx, sy);
  if (!ll) { notify('Tap on the map surface'); return; }
  let loc;
  if (pick.mode === 'country') {
    const n = countryAt(geo, ll.lon, ll.lat);
    if (!n) { notify('No country there. Try again'); return; }
    loc = { kind: 'country', name: n };
  } else {
    let best = null, bd = 18 * lastView.unit;
    for (const c of CITIES) {
      const X = lonToX(c[2]), p = projectPoint(lastView, X + Math.round(lastView.cx - X), latToY(c[1])), d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = c; }
    }
    loc = best ? { kind: 'city', name: best[0], lat: best[1], lon: best[2] } : { kind: 'point', name: `${ll.lat.toFixed(2)}, ${ll.lon.toFixed(2)}`, lat: +ll.lat.toFixed(4), lon: +ll.lon.toFixed(4) };
  }
  const it = items().find(i => i.id === pick.id);
  if (it) { checkpoint(); it[pick.key] = loc; changed(); notify('Location set: ' + locText(loc)); }
  cancelPick(); renderInspector();
});
$('#pickCancel').onclick = cancelPick;
$$('#pickKind button').forEach(b => b.onclick = () => { if (!pick) return; pick.mode = b.dataset.pk; $$('#pickKind button').forEach(x => x.classList.toggle('active', x === b)); $('#pickMsg').textContent = pick.mode === 'country' ? 'Tap a country on the map' : 'Tap the map to choose a place'; });

// ------------------------------------------------------------------ project settings
function syncDuration() { $('#duration').value = +(proj.frames / proj.fps).toFixed(2); }
function renderSettings() {
  $('#projName').value = proj.name; $('#fps').value = proj.fps; syncDuration();
  const key = proj.width + ',' + proj.height, size = $('#size');
  if (![...size.options].some(o => o.value === key)) size.insertAdjacentHTML('beforeend', `<option value="${key}">Custom · ${proj.width} × ${proj.height}</option>`);
  size.value = key; $('#theme').value = proj.theme; $('#grat').checked = !!proj.graticule; $('#quality').value = quality;
  const texture = { ...DEFAULT_TEXTURE, ...proj.texture };
  $('#texture').value = texture.type; $('#texStrength').value = Math.round(texture.strength * 100); $('#texScale').value = Math.round(texture.scale * 100);
  $('#texStrengthV').textContent = Math.round(texture.strength * 100) + '%'; $('#texScaleV').textContent = texture.scale.toFixed(1) + '×';
  $('#texStrength').disabled = $('#texScale').disabled = texture.type === 'none';
  const i = proj.camera.init, match = Object.entries(REGIONS).find(([, r]) => r.lon === i.lon && r.lat === i.lat && r.zoom === i.zoom);
  $('#region').value = match ? match[0] : 'custom'; $('#startZoom').value = i.zoom; $('#startPitch').value = i.pitch; $('#startBearing').value = i.bearing;
  renderLabelPanel();
}
function bindSettings() {
  const edit = fn => e => { pause(); checkpoint(); fn(e.target); saveLocal(); renderAll(); };
  $('#projName').onchange = edit(el => proj.name = el.value.trim().slice(0, 100) || 'Untitled map');
  $('#fps').onchange = edit(el => proj.fps = +el.value);
  $('#duration').onchange = edit(el => { const s = Number(el.value); if (el.value.trim() && Number.isFinite(s)) proj.frames = clamp(Math.round(s * proj.fps), 2, 1800); frame = Math.min(frame, proj.frames - 1); });
  $('#size').onchange = edit(el => { const [w, h] = el.value.split(',').map(Number); proj.width = w; proj.height = h; });
  $('#theme').onchange = edit(el => proj.theme = el.value);
  $('#grat').onchange = edit(el => proj.graticule = el.checked);
  $('#texture').onchange = edit(el => { proj.texture = { ...DEFAULT_TEXTURE, ...proj.texture, type: el.value }; });
  for (const [id, key, lo, hi] of [['texStrength', 'strength', 0, 1], ['texScale', 'scale', .5, 3]]) {
    let editing = false;
    $('#' + id).oninput = e => {
      pause(); if (!editing) { checkpoint(); editing = true; }
      proj.texture = { ...DEFAULT_TEXTURE, ...proj.texture, [key]: clamp(+e.target.value / 100, lo, hi) };
      $('#' + id + 'V').textContent = key === 'strength' ? Math.round(proj.texture[key] * 100) + '%' : proj.texture[key].toFixed(1) + '×';
      draw();
    };
    $('#' + id).onchange = () => { editing = false; saveLocal(); renderSettings(); };
  }
  $('#region').onchange = edit(el => { const r = REGIONS[el.value]; if (r) Object.assign(proj.camera.init, { lon: r.lon, lat: r.lat, zoom: r.zoom }); });
  $('#startZoom').onchange = edit(el => proj.camera.init.zoom = clamp(+el.value || 1, 0, 12));
  $('#startPitch').onchange = edit(el => proj.camera.init.pitch = clamp(+el.value || 0, 0, 70));
  $('#startBearing').onchange = edit(el => proj.camera.init.bearing = clamp(+el.value || 0, -180, 180));
  $('#quality').onchange = e => { quality = e.target.value; try { localStorage.setItem(QSTORE, quality); } catch { /* ignore */ } draw(); };
}

// ------------------------------------------------------------------ timeline
const STEPS = [1, 2, 5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 300, 600, 900, 1800];
const frameAtX = x => clamp(Math.round((x - $('#rlane').getBoundingClientRect().left) / tlPpf), 0, proj.frames - 1);
function renderTimeline() {
  const its = items(), zoom = +$('#tlZoom').value, avail = Math.max(160, ($('#sheet').clientWidth || window.innerWidth) - LW);
  tlPpf = clamp(avail / proj.frames, .3, 30) * zoom;
  const W = proj.frames * tlPpf, step = STEPS.find(s => s * tlPpf >= 56) || 1800;
  let ticks = ''; for (let f = 0; f < proj.frames; f += step) ticks += `<i style="left:${f * tlPpf}px">${+(f / proj.fps).toFixed(1)}s</i>`;
  const rows = its.map(it => `<div class="tl-row ${it.id === sel ? 'selected' : ''}" data-id="${esc(it.id)}"><div class="tl-lbl"><span class="c-${clsOf(it)}">${iconOf(it)}</span><em>${esc(it.name)}</em></div><div class="tl-lane" style="width:${W}px"><div class="clip t-${clsOf(it)} ${it.id === sel ? 'selected' : ''}" data-id="${esc(it.id)}" style="left:${it.start * tlPpf}px;width:${Math.max(18, it.dur * tlPpf)}px"><i class="h l" data-h="l"></i><span>${esc(it.name)}</span><i class="h r" data-h="r"></i></div></div></div>`).join('');
  $('#tlInner').style.width = LW + W + 'px';
  $('#tlInner').innerHTML = `<div class="tl-ruler"><div class="tl-corner">Time</div><div class="tl-rlane" id="rlane" style="width:${W}px">${ticks}</div></div>` + (rows || '<div class="tl-empty">Nothing yet.<br>Open the <b>Add</b> tab to create an animation or a camera move.</div>') + '<div id="ph"></div>';
  updatePlayhead();
}
{
  const tl = $('#tl');
  tl.addEventListener('pointerdown', e => {
    const clipEl = e.target.closest('.clip');
    if (clipEl) {
      const it = items().find(i => i.id === clipEl.dataset.id); if (!it) return;
      e.preventDefault(); pause(); selectLight(it.id); checkpoint();
      drag = { id: it.id, el: clipEl, mode: e.target.dataset.h || 'move', x0: e.clientX, start: it.start, dur: it.dur, moved: false };
      try { clipEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    const lane = e.target.closest('.tl-rlane');
    if (lane) { e.preventDefault(); pause(); scrubbing = true; try { lane.setPointerCapture(e.pointerId); } catch { /* ignore */ } setFrame(frameAtX(e.clientX)); }
  });
  tl.addEventListener('pointermove', e => {
    if (scrubbing) { setFrame(frameAtX(e.clientX)); return; }
    if (!drag) return;
    const it = items().find(i => i.id === drag.id); if (!it) return;
    const d = Math.round((e.clientX - drag.x0) / tlPpf); if (d !== 0) drag.moved = true;
    if (drag.mode === 'move') it.start = clamp(drag.start + d, 0, proj.frames - 1);
    else if (drag.mode === 'r') it.dur = clamp(drag.dur + d, 1, 1800);
    else { const ns = clamp(drag.start + d, 0, drag.start + drag.dur - 1); it.dur = drag.start + drag.dur - ns; it.start = ns; }
    ensureLength(it.start + it.dur);
    drag.el.style.left = it.start * tlPpf + 'px'; drag.el.style.width = Math.max(18, it.dur * tlPpf) + 'px';
    const s = $('#inspector [data-mf="start"]'), l = $('#inspector [data-mf="dur"]'); if (s) s.value = it.start; if (l) l.value = it.dur;
    draw();
  });
  const end = () => {
    if (scrubbing) { scrubbing = false; return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { undoStack.pop(); updateHistory(); } else changed();
  };
  tl.addEventListener('pointerup', end); tl.addEventListener('pointercancel', end);
  tl.addEventListener('click', e => {
    if (e.target.closest('.clip') || e.target.closest('.tl-rlane')) return;
    const row = e.target.closest('.tl-row'); if (!row) return;
    pause(); if (!e.target.closest('.tl-lbl')) setFrame(frameAtX(e.clientX));
    select(row.dataset.id);
  });
  $('#tlZoom').oninput = () => renderTimeline();
}

// ------------------------------------------------------------------ save, open, export
let exportBlob = null, wake = null;
function openDlg(html) { $('#dlgBody').innerHTML = html; if (!$('#dlg').open) $('#dlg').showModal(); }
const closeDlg = () => { if ($('#dlg').open) $('#dlg').close(); };
$('#dlg').addEventListener('cancel', e => { if (exporting) { e.preventDefault(); exporting = false; } });

async function exportVideo() {
  if (exporting) return;
  pause();
  if (!geo) { notify('Map data is still loading'); return; }
  const snapshot = clone(proj), name = fileBase(); exportBlob = null;
  openDlg(`<h2>Exporting video</h2><p class="muted">${snapshot.width} × ${snapshot.height} · ${snapshot.fps} fps · ${snapshot.frames} frames. Keep this screen on and the app open until it finishes.</p><progress id="xp" max="${snapshot.frames}" value="0"></progress><p id="xs" role="status">Preparing…</p><div class="actions"><button id="xc">Cancel</button></div>`);
  $('#xc').onclick = () => { exporting = false; $('#xc').disabled = true; };
  exporting = true;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; }
  const c = document.createElement('canvas'); c.width = snapshot.width; c.height = snapshot.height;
  const ec = c.getContext('2d');
  try {
    await loadFonts(mapFontsUsed(snapshot)); await document.fonts.ready;
    const video = await exportMapVideo({
      canvas: c, fps: snapshot.fps, frames: snapshot.frames,
      draw: f => drawMap(ec, c.width, c.height, snapshot, f, geo),
      cancelled: () => !exporting,
      progress: n => { $('#xp').value = n; $('#xs').textContent = `Rendering frame ${n} of ${snapshot.frames}`; },
    });
    if (!exporting) { $('#xs').textContent = 'Export cancelled.'; $('#xc').outerHTML = '<button id="xclose">Close</button>'; $('#xclose').onclick = closeDlg; return; }
    exportBlob = video;
    const file = new File([video], name + '.webm', { type: 'video/webm' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    $('#dlgBody').innerHTML = `<h2>Video ready</h2><p class="muted">${name}.webm · ${(video.size / 1048576).toFixed(1)} MB</p><video src="${URL.createObjectURL(video)}" controls playsinline muted style="width:100%;border-radius:10px;background:#000"></video><div class="actions"><button id="xdl" class="primary">Download</button>${canShare ? '<button id="xsh">Share / Save…</button>' : ''}<button id="xclose">Close</button></div>`;
    $('#xdl').onclick = () => download(video, name + '.webm');
    if (canShare) $('#xsh').onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
    $('#xclose').onclick = closeDlg;
  } catch (e) {
    $('#xs').textContent = e.name === 'AbortError' ? 'Export cancelled.' : 'Export failed: ' + e.message;
    const b = $('#xc'); if (b) { b.outerHTML = '<button id="xclose">Close</button>'; $('#xclose').onclick = closeDlg; }
  } finally { exporting = false; try { wake?.release(); } catch { /* ignore */ } wake = null; }
}

function bindToolbar() {
  $('#undo').onclick = () => history('undo'); $('#redo').onclick = () => history('redo');
  $('#exportBtn').onclick = exportVideo;
  $('#play').onclick = play; $('#loop').onclick = () => { loop = !loop; $('#loop').classList.toggle('active', loop); };
  $('#scrub').oninput = e => { pause(); setFrame(+e.target.value); };
  $('#big').onclick = () => { document.body.classList.toggle('big'); $('#big').classList.toggle('active'); draw(); };
  $('#itemSel').onchange = e => { if (e.target.value) select(e.target.value); };
  $$('.js-dup').forEach(b => b.onclick = () => {
    const it = current(); if (!it) return; checkpoint();
    const c = clone(it); c.id = crypto.randomUUID(); c.name += ' copy'; c.start = Math.min(proj.frames - 1, it.start + 10); ensureLength(c.start + c.dur);
    (isShot(it) ? proj.shots : proj.actions).push(c); sel = c.id; saveLocal(); renderAll(); notify('Duplicated');
  });
  $$('.js-del').forEach(b => b.onclick = () => {
    const it = current(); if (!it) return; checkpoint();
    proj.shots = proj.shots.filter(s => s.id !== it.id); proj.actions = proj.actions.filter(a => a.id !== it.id);
    for (const s of proj.shots) if (s.planeId === it.id) s.planeId = '';
    sel = null; saveLocal(); renderAll(); notify('Deleted');
  });
  $('#newBtn').onclick = () => { if (!confirm('Start an empty map? You can bring back your current one with Undo.')) return; pause(); checkpoint(); proj = newMapProject(); sel = null; frame = 0; saveLocal(); renderAll(); showTab('add'); };
  $('#demoBtn').onclick = () => { if (!confirm('Load the demo map? You can bring back your current one with Undo.')) return; pause(); checkpoint(); proj = demoMapProject(); sel = null; frame = 0; saveLocal(); renderAll(); showTab('timeline'); };
  $('#saveBtn').onclick = () => { download(new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' }), fileBase() + '.framemap.json'); notify('Project file saved'); };
  $('#openBtn').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { if (f.size > 5e6) throw Error('Project is larger than 5 MB.'); const p = validateMapProject(JSON.parse(await f.text())); pause(); checkpoint(); proj = p; sel = null; frame = 0; saveLocal(); renderAll(); showTab('timeline'); notify('Project opened'); } catch (err) { notify(err.message); }
    e.target.value = '';
  };
  $('#pngBtn').onclick = () => {
    if (!geo) return; const c = document.createElement('canvas'); c.width = proj.width; c.height = proj.height;
    drawMap(c.getContext('2d'), c.width, c.height, proj, frame, geo); c.toBlob(b => download(b, `${fileBase()}-frame-${frame}.png`), 'image/png');
  };
  $('#helpBtn').onclick = () => {
    openDlg('<h2>How it works</h2><ol><li><b>Add</b> tab: pick a Border, Travel, Highlight or Pin. It lands at the playhead.</li><li><b>Edit</b> tab: choose the place. Type a city or country, enter <i>lat, lon</i>, or tap <b>⌖</b> and tap the map.</li><li>Add a <b>camera move</b> (Fly to, Cinematic swoop, Orbit, Follow traveler…). It moves the view for you.</li><li><b>Timeline</b> tab: drag a bar to retime it, drag its ends to change its length, drag the ruler to scrub.</li><li>Tap <b>Export</b> for a WebM video. Use the Project tab for portrait / Shorts size.</li></ol><div class="actions"><button id="hclose" class="primary">Got it</button></div>');
    $('#hclose').onclick = closeDlg;
  };
  $('#full').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#stage').requestFullscreen(); } catch { notify('Fullscreen is not available here'); }
  };
  if (!document.documentElement.requestFullscreen) $('#full').hidden = true;
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(draw));
  canvas.addEventListener('click', () => { if (document.fullscreenElement && !pick) play(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
  window.addEventListener('resize', () => { renderTimeline(); draw(); });
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; deferred = null; });
  $('#installBtn').onclick = async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch { /* ignore */ } deferred = null; $('#installBtn').hidden = true; };
}

function renderAll() { renderSettings(); renderItems(); renderInspector(); renderTimeline(); setFrame(frame); updateHistory(); }

// ------------------------------------------------------------------ boot
try { const saved = localStorage.getItem(STORE); proj = saved ? validateMapProject(JSON.parse(saved)) : demoMapProject(); } catch { proj = demoMapProject(); }
buildStaticUI(); buildLists(); bindSettings(); bindToolbar(); renderAll(); showTab('timeline'); ensureGeo();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
