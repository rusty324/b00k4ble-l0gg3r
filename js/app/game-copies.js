// game-copies.js — the Games form's Copies editor: one fieldset per copy you
// hold (platform, format, store, the launcher it opens in, edition, set), in
// place of the old platform rows with format chips. The record model is in
// core.js (normalizeGameCopies); this is only the form.
//
// The platform buttons above the list stay as the quick way in: tapping one
// adds a copy on that platform, tapping it again removes that platform's
// copies. "Other…" adds a copy whose platform is typed.

let _gameCopies = [];

const GAME_EDITION_QUICK = ['Standard', 'Gold', 'Deluxe', 'Digital Deluxe', 'Definitive', 'Complete', 'Remastered', 'Game of the Year'];

function setGameCopies(copies) {
  _gameCopies = (copies || []).map(c => ({ ...c }));
  paintGamePlatformButtons();
  renderGameCopies();
}

// What saveGameItem() stores; the normalizer trims, maps and drops the rest.
const gameCopiesForSave = () => _gameCopies.filter(c => c.platform).map(({ _other, _storeOther, _opensOther, ...c }) => c);

function paintGamePlatformButtons() {
  const box = document.getElementById('g-platform-group');
  if (!box) return;
  const have = new Set(_gameCopies.map(c => c.platform));
  const plats = [...new Set([...knownGamePlatforms(), ...have])].filter(Boolean);
  box.innerHTML = plats.map(p => `<label class="radio-btn${have.has(p) ? ' active' : ''}" for="g-plat-${esc(p)}">${esc(platformLabel(p))}<input type="checkbox"
      name="g-plat-pick" id="g-plat-${esc(p)}" value="${esc(p)}"${have.has(p) ? ' checked' : ''} onchange="toggleGamePlatform(this.value)"></label>`).join('') +
    `<button type="button" class="radio-btn plat-other" onclick="addGameCopy({ platform: '', _other: true })">Other…</button>`;
}

function storeOptions(c, field) {
  const presets = field === 'store' && c.format === 'subscription' ? GAME_SUBSCRIPTIONS : GAME_STORES;
  const cur = c[field] || '';
  const keys = [...presets.map(s => s.key), ...knownGameStores()];
  if (cur && !keys.includes(cur)) keys.push(cur);
  const blank = field === 'opensIn' ? 'Same as store' : 'Not set';
  return `<option value=""${!cur ? ' selected' : ''}>${blank}</option>` +
    keys.map(k => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(storeLabel(k))}</option>`).join('') +
    `<option value="__other">Other…</option>`;
}

function renderGameCopies() {
  const box = document.getElementById('g-copies');
  if (!box) return;
  const plats = knownGamePlatforms();
  box.innerHTML = _gameCopies.length ? _gameCopies.map((c, i) => {
    const n = i + 1;
    const pc = c.platform === 'pc', sub = c.format === 'subscription';
    const platOpts = [...new Set([...plats, ...(c.platform ? [c.platform] : [])])];
    const other = c._other || (c.platform && !plats.includes(c.platform));
    return `<fieldset class="copy-row" data-copy="${i}">
      <legend><span class="copy-n">Copy ${n}</span> <span class="copy-fmt">${esc(gameCopyLine(c) || 'New copy')}</span></legend>
      <button type="button" class="copy-remove" aria-label="Remove copy ${n}" onclick="removeGameCopy(${i})">&times;</button>
      <div class="copy-fields">
        <label class="copy-field"><span>Platform</span>
          <select class="plain" data-field="platform" onchange="setGameCopyField(${i}, this)">
            <option value=""${!c.platform && !c._other ? ' selected' : ''}>Choose…</option>
            ${platOpts.map(p => `<option value="${esc(p)}"${c.platform === p && !c._other ? ' selected' : ''}>${esc(platformLabel(p))}</option>`).join('')}
            <option value="__other"${c._other ? ' selected' : ''}>Other…</option>
          </select></label>
        ${other && c._other ? `<label class="copy-field"><span>Platform name</span>
          <input type="text" class="plain" data-field="platformText" maxlength="40" placeholder="e.g. Switch" value="${esc(c.platform || '')}"
                 oninput="setGameCopyField(${i}, this)" onchange="setGameCopyField(${i}, this, true)"></label>` : ''}
        <label class="copy-field"><span>Format</span>
          <select class="plain" data-field="format" onchange="setGameCopyField(${i}, this)">
            <option value=""${!c.format ? ' selected' : ''}>Not set</option>
            ${GAME_COPY_FORMATS.map(f => `<option value="${f}"${c.format === f ? ' selected' : ''}>${esc(GAME_FORMAT_LABEL[f])}</option>`).join('')}
          </select></label>
        ${pc || sub ? `<label class="copy-field"><span>${sub ? 'Service' : 'Store'}</span>
          <select class="plain" data-field="store" onchange="setGameCopyField(${i}, this)">${storeOptions(c, 'store')}</select></label>` : ''}
        ${(pc || sub) && c._storeOther ? `<label class="copy-field"><span>Store name</span>
          <input type="text" class="plain" data-field="storeText" maxlength="40" value="${esc(c.store || '')}" onchange="setGameCopyField(${i}, this, true)"></label>` : ''}
        ${pc ? `<label class="copy-field"><span>Opens in <span class="opt">(if different)</span></span>
          <select class="plain" data-field="opensIn" onchange="setGameCopyField(${i}, this)">${storeOptions(c, 'opensIn')}</select></label>` : ''}
        ${pc && c._opensOther ? `<label class="copy-field"><span>Launcher name</span>
          <input type="text" class="plain" data-field="opensInText" maxlength="40" value="${esc(c.opensIn || '')}" onchange="setGameCopyField(${i}, this, true)"></label>` : ''}
        <label class="copy-field"><span>Edition <span class="opt">(optional)</span></span>
          <input type="text" class="plain" data-field="edition" maxlength="120" autocomplete="off" list="g-edition-list"
                 placeholder="e.g. Gold, Game of the Year" value="${esc(c.edition || '')}" oninput="setGameCopyField(${i}, this)"></label>
      </div>
      <div class="copy-quick"><span>Quick pick:</span>${GAME_EDITION_QUICK.map(q =>
        `<button type="button" class="btn btn-sm" onclick="pickGameEdition(${i}, this.textContent)">${esc(q)}</button>`).join('')}</div>
      <label class="copy-field copy-set"><span>Part of a set <span class="opt">(optional)</span></span>
        <input type="text" class="plain" data-field="set" maxlength="120" autocomplete="off"
               placeholder="e.g. a bundle or collection" value="${esc(c.set || '')}" oninput="setGameCopyField(${i}, this)"></label>
    </fieldset>`;
  }).join('') : '<p class="hint copy-none">No copies yet — tap a platform above, or add one for each disc, download or subscription.</p>';
  const sum = document.getElementById('g-copies-sum');
  if (sum) sum.textContent = gameCopiesSummary(_gameCopies);
  if (typeof dlcEditor !== 'undefined') dlcEditor.render();
}

// "PC · Steam", "PS4 · Physical", "PC · Epic via Ubisoft Connect"
function gameCopyLine(c) {
  if (!c.platform) return '';
  const bits = [platformLabel(c.platform)];
  if (c.store) bits.push(storeBadge(c.store));
  else if (c.format) bits.push(GAME_FORMAT_LABEL[c.format] || c.format);
  let s = bits.join(' · ');
  if (c.opensIn) s += ` via ${storeLabel(c.opensIn)}`;
  if (c.edition) s += ` — ${c.edition}`;
  return s;
}
function gameCopiesSummary(copies) {
  const n = new Map();
  copies.filter(c => c.platform).forEach(c => { const k = gameCopyLine({ ...c, edition: '' }); n.set(k, (n.get(k) || 0) + 1); });
  return [...n].map(([k, v]) => `${k}${v > 1 ? ` ×${v}` : ''}`).join(' · ');
}

function setGameCopyField(i, el, repaint = false) {
  const c = _gameCopies[i];
  if (!c) return;
  const f = el.dataset.field, v = el.value;
  if (f === 'platform') {
    c._other = v === '__other';
    c.platform = c._other ? '' : v;
    if (c.platform !== 'pc') { delete c.opensIn; if (c.format !== 'subscription') delete c.store; }
  } else if (f === 'platformText') {
    c.platform = v.trim().toLowerCase();
    if (!repaint) { syncGameCopySummary(); return; }
  } else if (f === 'format') {
    c.format = v;
    if (c.platform !== 'pc' && v !== 'subscription') delete c.store;
  } else if (f === 'store' || f === 'opensIn') {
    const flag = f === 'store' ? '_storeOther' : '_opensOther';
    c[flag] = v === '__other';
    c[f] = c[flag] ? '' : v;
  } else if (f === 'storeText') { c.store = normalizeStore(v); c._storeOther = false; }
  else if (f === 'opensInText') { c.opensIn = normalizeStore(v); c._opensOther = false; }
  else { c[f] = v; syncGameCopySummary(); return; }
  if (c.platform) hideGamePlatformError();
  paintGamePlatformButtons();
  renderGameCopies();
  document.querySelector(`#g-copies [data-copy="${i}"] [data-field="${f}"]`)?.focus();
}

function syncGameCopySummary() {
  const sum = document.getElementById('g-copies-sum');
  if (sum) sum.textContent = gameCopiesSummary(_gameCopies);
}

function pickGameEdition(i, text) {
  if (!_gameCopies[i]) return;
  _gameCopies[i].edition = text;
  const input = document.querySelector(`#g-copies [data-copy="${i}"] [data-field="edition"]`);
  if (input) { input.value = text; input.focus(); }
  syncGameCopySummary();
}

function addGameCopy(prefill = {}) {
  _gameCopies.push({ id: newCopyId(), platform: '', ...prefill });
  paintGamePlatformButtons();
  renderGameCopies();
  const row = document.querySelector(`#g-copies [data-copy="${_gameCopies.length - 1}"]`);
  (row?.querySelector('[data-field="platformText"]') || row?.querySelector('select'))?.focus();
  if (prefill.platform) hideGamePlatformError();
}

function removeGameCopy(i) {
  const [gone] = _gameCopies.splice(i, 1);
  if (gone) _gameDlc.forEach(d => { if (d.via === gone.id) delete d.via; });
  paintGamePlatformButtons();
  renderGameCopies();
  const rows = document.querySelectorAll('#g-copies .copy-row');
  (rows[Math.min(i, rows.length - 1)]?.querySelector('select') || document.querySelector('#g-copies + .links-row button'))?.focus();
}

// A platform button: on adds a copy there (PC from Steam, the usual case);
// off removes that platform's copies, and any DLC "via" pointing at them.
function toggleGamePlatform(value) {
  if (_gameCopies.some(c => c.platform === value)) {
    const gone = new Set(_gameCopies.filter(c => c.platform === value).map(c => c.id));
    _gameCopies = _gameCopies.filter(c => c.platform !== value);
    _gameDlc.forEach(d => { if (gone.has(d.via)) delete d.via; });
  } else {
    _gameCopies.push({ id: newCopyId(), platform: value });
    hideGamePlatformError();
  }
  paintGamePlatformButtons();
  renderGameCopies();
  document.getElementById(`g-plat-${value}`)?.focus();
}
