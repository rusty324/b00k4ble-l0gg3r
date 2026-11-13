// media-copies.js — the Movies & TV form's Copies editor: one fieldset per
// disc, file or licence you hold (format, edition, set), in place of the old
// format checkboxes and one-edition-per-format boxes. The record model is in
// core.js (normalizeMediaCopies); this is only the form.
//
// _mediaCopies is the open form's working list. Typing writes straight into
// it, so the box being typed in keeps focus; only adding, removing or
// changing a format repaints.

let _mediaCopies = [];

const MEDIA_EDITION_PRESETS = ['Steelbook', "Collector's Edition", "Director's Cut", 'Extended', 'Theatrical', 'Unrated', 'Remastered'];
const MEDIA_EDITION_QUICK = ['Steelbook', "Collector's Edition", "Director's Cut", 'Extended'];

function setMediaCopies(copies) {
  _mediaCopies = (copies || []).map(c => ({ ...c }));
  paintMediaCopyLists();
  renderMediaCopies();
}

// Every set name in the library -> how many titles hold a copy in it.
function mediaSetTitles() {
  const out = new Map();
  for (const m of mediaLibrary) {
    const sets = new Set((m.copies || []).map(c => c.set).filter(Boolean).map(textKey));
    sets.forEach(k => out.set(k, (out.get(k) || 0) + 1));
  }
  return out;
}

function paintMediaCopyLists() {
  const eds = new Set(MEDIA_EDITION_PRESETS), sets = new Set();
  for (const m of mediaLibrary) for (const c of m.copies || []) {
    if (c.edition) eds.add(c.edition);
    if (c.set) sets.add(c.set);
  }
  const opt = v => `<option value="${esc(v)}"></option>`;
  const el = document.getElementById('m-edition-list'), sl = document.getElementById('m-set-list');
  if (el) el.innerHTML = [...eds].map(opt).join('');
  if (sl) sl.innerHTML = [...sets].sort().map(opt).join('');
}

// "Blu-ray ×2 · DVD"
function mediaCopiesSummary(copies) {
  const n = {};
  copies.forEach(c => { n[c.format] = (n[c.format] || 0) + 1; });
  return Object.entries(n).map(([f, k]) => `${MEDIA_FORMAT_LABEL[f] || f}${k > 1 ? ` ×${k}` : ''}`).join(' · ');
}

function renderMediaCopies() {
  const box = document.getElementById('m-copies');
  if (!box) return;
  const sets = mediaSetTitles();
  const editing = typeof mediaEditingId !== 'undefined' && mediaEditingId !== null;
  box.innerHTML = _mediaCopies.length ? _mediaCopies.map((c, i) => {
    const n = i + 1, held = c.format !== 'streaming';
    const tv = typeof mediaTypeIsTv === 'function' && mediaTypeIsTv();
    const inSet = c.set ? sets.get(textKey(c.set)) || 0 : 0;
    return `<fieldset class="copy-row" data-copy="${i}">
      <legend><span class="copy-n">Copy ${n}</span> <span class="copy-fmt">${ico('media', c.format)} ${esc(MEDIA_FORMAT_LABEL[c.format] || c.format)}</span></legend>
      <button type="button" class="copy-remove" aria-label="Remove copy ${n}" onclick="removeMediaCopy(${i})">&times;</button>
      <div class="copy-fields">
        <label class="copy-field"><span>Format</span>
          <select class="plain" data-field="format" onchange="setMediaCopyField(${i}, this)">
            ${MEDIA_COPY_FORMATS.map(f => `<option value="${f}"${c.format === f ? ' selected' : ''}>${esc(MEDIA_FORMAT_LABEL[f])}</option>`).join('')}
          </select></label>
        <label class="copy-field"${held ? '' : ' hidden'}><span>Edition <span class="opt">(optional)</span></span>
          <input type="text" class="plain" data-field="edition" maxlength="120" autocomplete="off" list="m-edition-list"
                 placeholder="e.g. Steelbook, Director's Cut" value="${esc(c.edition || '')}" oninput="setMediaCopyField(${i}, this)"></label>
      </div>
      ${held ? `<div class="copy-quick"><span>Quick pick:</span>${MEDIA_EDITION_QUICK.map(q =>
        `<button type="button" class="btn btn-sm" onclick="pickMediaEdition(${i}, this.textContent)">${esc(q)}</button>`).join('')}</div>` : ''}
      <label class="copy-field copy-set"><span>Part of a set <span class="opt">(optional)</span></span>
        <input type="text" class="plain" data-field="set" maxlength="120" autocomplete="off" list="m-set-list"
               placeholder="e.g. a box set or collection" value="${esc(c.set || '')}" oninput="setMediaCopyField(${i}, this)"></label>
      ${tv ? copySeasonChips(c, i) : ''}
      ${inSet && editing ? `<div class="copy-setinfo">In this set: ${inSet} title${inSet === 1 ? '' : 's'}.
        <button type="button" class="btn btn-sm" onclick="showMediaSet(${i})">Show the set</button></div>` : ''}
      ${editing && _mediaCopies.length > 1 && mediaLibrary.some(m => m.id === mediaEditingId && (m.copies || []).some(x => x.id === c.id))
        ? `<div class="copy-split"><button type="button" class="btn btn-sm" onclick="splitMediaCopy(${i})">Move to its own title</button></div>` : ''}
    </fieldset>`;
  }).join('') : '<p class="hint copy-none">No copies yet — add one for each disc, file or licence you hold.</p>';
  const sum = document.getElementById('m-copies-sum');
  if (sum) sum.textContent = mediaCopiesSummary(_mediaCopies);
  // A TV show with copies picks seasons per copy; the title-wide picker is
  // only for a show with no copies at all.
  const group = document.getElementById('m-seasons-group');
  if (group && typeof mediaTypeIsTv === 'function') group.style.display = mediaTypeIsTv() && !_mediaCopies.length ? '' : 'none';
}

// ─── seasons, per copy (TV) ───────────────────────────────────────────
// One chip per season up to the known total (TMDb), the highest this copy
// holds, or as far as "+ Season" has been pressed for it.
function copySeasonChips(c, i) {
  const have = new Set(c.seasons || []);
  const n = Math.max(_mediaSeasonCount || 0, ...have, c._shown || 0, 1);
  c._shown = n;
  const all = n > 1 && have.size === n && Math.max(...have) === n;
  const chips = [];
  for (let s = 1; s <= n; s++) {
    const on = have.has(s);
    chips.push(`<button type="button" class="fmt-chip season-chip${on ? ' active' : ''}" aria-pressed="${on}"
      aria-label="Copy ${i + 1}, season ${s}" onclick="toggleCopySeason(${i}, ${s})">${s}</button>`);
  }
  if (n > 1) chips.push(`<button type="button" class="fmt-chip season-all${all ? ' active' : ''}" aria-pressed="${all}"
      onclick="toggleAllCopySeasons(${i})">All</button>`);
  chips.push(`<button type="button" class="fmt-chip season-add" onclick="addCopySeason(${i})">+ Season</button>`);
  return `<div class="copy-seasons"><span class="copy-field-label">Seasons on this copy${_mediaSeasonCount ? ` <span class="opt">(TMDb lists ${_mediaSeasonCount})</span>` : ''}</span>
    <div class="season-chips">${chips.join('')}</div></div>`;
}
function toggleCopySeason(i, s) {
  const c = _mediaCopies[i]; if (!c) return;
  const set = new Set(c.seasons || []);
  if (set.has(s)) set.delete(s); else set.add(s);
  c.seasons = [...set].sort((a, b) => a - b);
  renderMediaCopies();
  document.querySelector(`#m-copies [data-copy="${i}"] [aria-label="Copy ${i + 1}, season ${s}"]`)?.focus();
}
function toggleAllCopySeasons(i) {
  const c = _mediaCopies[i]; if (!c) return;
  const n = c._shown || 1, have = c.seasons || [];
  const all = have.length === n && Math.max(...have) === n;
  c.seasons = all ? [] : Array.from({ length: n }, (_, k) => k + 1);
  renderMediaCopies();
  document.querySelector(`#m-copies [data-copy="${i}"] .season-all`)?.focus();
}
function addCopySeason(i) {
  const c = _mediaCopies[i]; if (!c) return;
  c._shown = (c._shown || 1) + 1;
  renderMediaCopies();
  document.querySelector(`#m-copies [data-copy="${i}"] .season-add`)?.focus();
}

function setMediaCopyField(i, el) {
  const c = _mediaCopies[i];
  if (!c) return;
  c[el.dataset.field] = el.value;
  if (el.dataset.field === 'format') renderMediaCopies();
  else if (el.dataset.field !== 'edition') return;
  const sum = document.getElementById('m-copies-sum');
  if (sum) sum.textContent = mediaCopiesSummary(_mediaCopies);
}

function pickMediaEdition(i, text) {
  if (!_mediaCopies[i]) return;
  _mediaCopies[i].edition = text;
  const input = document.querySelector(`#m-copies [data-copy="${i}"] [data-field="edition"]`);
  if (input) { input.value = text; input.focus(); }
}

function addMediaCopy(prefill = {}) {
  const last = _mediaCopies[_mediaCopies.length - 1];
  _mediaCopies.push({ id: newCopyId(), format: prefill.format || (last ? last.format : 'bluray'),
    ...(prefill.edition ? { edition: prefill.edition } : {}), ...(prefill.set ? { set: prefill.set } : {}) });
  renderMediaCopies();
  document.querySelector(`#m-copies [data-copy="${_mediaCopies.length - 1}"] select`)?.focus();
}

function removeMediaCopy(i) {
  _mediaCopies.splice(i, 1);
  renderMediaCopies();
  const rows = document.querySelectorAll('#m-copies .copy-row');
  (rows[Math.min(i, rows.length - 1)]?.querySelector('select') || document.querySelector('#m-copies + .links-row button'))?.focus();
}

// What saveMediaItem() stores; the normalizer trims, caps and drops empties.
const mediaCopiesForSave = () => _mediaCopies.filter(c => c.format).map(({ _shown, ...c }) => c);

// "Show the set": the form closes and the set's sheet opens.
function showMediaSet(i) {
  const set = _mediaCopies[i] && _mediaCopies[i].set;
  if (!set) return;
  closeMediaModal();
  openSetSheet(set);
}

// ─── splitting ────────────────────────────────────────────────────────
// (Merging is shared with Games: js/app/merge.js.)
const mergeMediaRecords = (target, sources) => mergeRecords('media', target, sources);

// "Move to its own title": the copy becomes a record of its own, marked as
// not a duplicate of this one so Find duplicates leaves the pair alone.
function splitMediaCopy(i) {
  const c = _mediaCopies[i];
  const idx = mediaLibrary.findIndex(m => m.id === mediaEditingId);
  if (!c || idx === -1 || _mediaCopies.length < 2) return;
  if (!confirm('Move this copy to a title of its own? It keeps the same title, which you can then change.')) return;
  const orig = mediaLibrary[idx];
  const { _shown, ...copy } = c;
  const id = newId();
  const notDup = ids => [...new Set([...(ids || []).map(Number)])].sort((a, b) => a - b);
  mediaLibrary.push(normalizeMediaItem({ ...orig, id, copies: [copy], seasons: [], notDuplicateOf: notDup([...(orig.notDuplicateOf || []), orig.id]) }));
  _mediaCopies.splice(i, 1);
  mediaLibrary[idx] = normalizeMediaItem({ ...orig, copies: (orig.copies || []).filter(x => x.id !== c.id), seasons: [], notDuplicateOf: notDup([...(orig.notDuplicateOf || []), id]) });
  saveMedia();
  renderMediaCopies();
  renderPage();
  document.querySelector('#m-copies .copy-row select')?.focus();
}
