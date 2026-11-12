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
      ${inSet && editing ? `<div class="copy-setinfo">In this set: ${inSet} title${inSet === 1 ? '' : 's'}.
        <button type="button" class="btn btn-sm" onclick="showMediaSet(${i})">Show the set</button></div>` : ''}
    </fieldset>`;
  }).join('') : '<p class="hint copy-none">No copies yet — add one for each disc, file or licence you hold.</p>';
  const sum = document.getElementById('m-copies-sum');
  if (sum) sum.textContent = mediaCopiesSummary(_mediaCopies);
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
const mediaCopiesForSave = () => _mediaCopies.filter(c => c.format).map(c => ({ ...c }));

// "Show the set": the set's name in the search box, the form closed.
function showMediaSet(i) {
  const set = _mediaCopies[i] && _mediaCopies[i].set;
  if (!set) return;
  closeMediaModal();
  mediaSearch = set;
  renderMedia();
  const input = document.getElementById('mediaSearchInput');
  if (input) { input.value = set; input.focus(); }
}
