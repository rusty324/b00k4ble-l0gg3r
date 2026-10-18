// bulk-edit.js — select several library items and change them at once:
// set their status, add or remove a genre, or delete them.
//
// "Select" above a tab's results starts it. While it is on, a tap on a card
// or row selects it instead of opening its details (a cover tap too — the
// full-size cover would otherwise open by accident), and an action bar sits
// on the bottom edge. Every action applies to the whole selection and saves
// once, so a sync push is one write, not one per item; deletions go through
// the same save point as any other, so they leave tombstones and sync right.

const BULK_STATUS = {
  books: [['want', 'Want to read'], ['reading', 'Reading'], ['read', 'Read']],
  media: [['want', 'Want to Watch'], ['watched', 'Watched']],
  games: [['want', 'Want to Play'], ['playing', 'Playing'], ['completed', 'Completed']],
};
const BULK_NOUN = { books: ['book', 'books'], media: ['title', 'titles'], games: ['game', 'games'] };
const BULK_SAVE = { books: () => save(), media: () => saveMedia(), games: () => saveGames() };
const BULK_NORMALIZE = { books: normalizeBook, media: normalizeMediaItem, games: normalizeVideoGame };
const BULK_GENRES = { books: () => allBookGenres(), media: () => allMediaGenres(), games: () => allGameGenres() };

// What each tab last showed after filters and search — what "Select all"
// means. Books keep theirs in _filteredCache; the others record it here.
const _shownIds = { media: [], games: [] };

let _bulk = null;   // { kind, ids: Set } while selecting

const bulkActive = () => !!_bulk;
const bulkNoun = (kind, n) => BULK_NOUN[kind][n === 1 ? 0 : 1];

function selectButton(kind) {
  return collectionArray(kind).length
    ? `<button type="button" class="btn btn-sm select-btn" onclick="startBulk('${kind}')">Select</button>` : '';
}

// Everything above a tab's results: what is missing, and Select.
const listTools = kind => missingButton(kind) + selectButton(kind);

function startBulk(kind) {
  _bulk = { kind, ids: new Set() };
  const sel = document.getElementById('bulkStatus');
  sel.innerHTML = `<option value="">Set status…</option>` +
    BULK_STATUS[kind].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  document.body.classList.add('bulk-mode');
  document.getElementById('bulkBar').hidden = false;
  paintBulk();
}

function endBulk() {
  _bulk = null;
  document.body.classList.remove('bulk-mode');
  document.getElementById('bulkBar').hidden = true;
  document.querySelectorAll('[data-detail].selected').forEach(el => el.classList.remove('selected'));
}

function toggleBulk(id) {
  if (_bulk.ids.has(id)) _bulk.ids.delete(id); else _bulk.ids.add(id);
  paintBulk();
}

function bulkSelectAll() {
  const shown = _bulk.kind === 'books' ? (_filteredCache || books).map(b => b.id) : _shownIds[_bulk.kind];
  const all = shown.length && shown.every(id => _bulk.ids.has(id));
  if (all) shown.forEach(id => _bulk.ids.delete(id)); else shown.forEach(id => _bulk.ids.add(id));
  paintBulk();
}

// Selection marks and the bar's count and enabled state.
function paintBulk() {
  if (!_bulk) return;
  const { kind, ids } = _bulk;
  document.querySelectorAll('[data-detail]').forEach(el => {
    const [k, id] = el.dataset.detail.split(':');
    const on = k === kind && ids.has(Number(id));
    el.classList.toggle('selected', on);
    el.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('bulkCount').textContent = `${ids.size} ${bulkNoun(kind, ids.size)} selected`;
  document.querySelectorAll('#bulkBar .bulk-act').forEach(b => { b.disabled = ids.size === 0; });
  const shown = kind === 'books' ? (_filteredCache || books).map(b => b.id) : _shownIds[kind];
  document.getElementById('bulkAll').textContent =
    shown.length && shown.every(id => ids.has(id)) ? 'Select none' : `Select all ${shown.length}`;
}

// Applies fn to every selected record (by replacing it with its normalized
// result), saves once, re-renders, and says what happened.
function bulkApply(fn, message) {
  const { kind, ids } = _bulk;
  const arr = collectionArray(kind);
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (!ids.has(arr[i].id)) continue;
    const next = fn({ ...arr[i] });
    arr[i] = BULK_NORMALIZE[kind](next);
    n++;
  }
  BULK_SAVE[kind]();
  renderPage();
  flashBanner(message(n));
}

function bulkSetStatus(value) {
  const sel = document.getElementById('bulkStatus');
  if (!value || !_bulk || !_bulk.ids.size) { sel.value = ''; return; }
  const label = BULK_STATUS[_bulk.kind].find(([v]) => v === value)[1];
  const month = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  bulkApply(r => {
    r.status = value;
    // Marking books Read fills in this month, as the form does; a month
    // already there is kept.
    if (_bulk.kind === 'books' && value === 'read' && !r.finished) r.finished = month;
    return r;
  }, n => `Set ${n} ${bulkNoun(_bulk.kind, n)} to ${label}.`);
  sel.value = '';
}

function bulkDelete() {
  const { kind, ids } = _bulk;
  if (!ids.size || !confirm(`Delete ${ids.size} ${bulkNoun(kind, ids.size)}? This cannot be undone.`)) return;
  const n = ids.size;
  switch (kind) {
    case 'books': books        = books.filter(r => !ids.has(r.id)); break;
    case 'media': mediaLibrary = mediaLibrary.filter(r => !ids.has(r.id)); break;
    case 'games': videoGames   = videoGames.filter(r => !ids.has(r.id)); break;
  }
  BULK_SAVE[kind]();
  ids.clear();
  renderPage();
  flashBanner(`Deleted ${n} ${bulkNoun(kind, n)}.`);
  paintBulk();
}

// ── Genre: a small sheet, add (with suggestions) or remove (from the ones
// the selection actually has) ──
function openBulkGenre(mode) {
  if (!_bulk || !_bulk.ids.size) return;
  const { kind, ids } = _bulk;
  const body = document.getElementById('bulkBody');
  if (mode === 'add') {
    body.innerHTML = `
      <div class="modal-title">Add a genre to ${ids.size} ${bulkNoun(kind, ids.size)}</div>
      <input type="text" class="plain" id="bulkGenreInput" list="bulkGenreList" placeholder="Genre" autocomplete="off"
             onkeydown="if (event.key === 'Enter') { event.preventDefault(); bulkAddGenre(); }">
      <datalist id="bulkGenreList">${BULK_GENRES[kind]().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="detail-actions"><span class="detail-spacer"></span>
        <button type="button" class="btn" onclick="closeBulkSheet()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="bulkAddGenre()">Add</button></div>`;
  } else {
    const present = new Map();
    collectionArray(kind).filter(r => ids.has(r.id)).forEach(r =>
      (r.genre || []).forEach(g => { const k = textKey(g); present.set(k, { name: present.get(k)?.name || g, n: (present.get(k)?.n || 0) + 1 }); }));
    const list = [...present.values()].sort((a, b) => a.name.localeCompare(b.name));
    body.innerHTML = `
      <div class="modal-title">Remove a genre from ${ids.size} ${bulkNoun(kind, ids.size)}</div>
      ${list.length ? `<div class="bulk-genres">${list.map(g =>
        `<button type="button" class="genre-pill" data-genre="${esc(g.name)}" onclick="bulkRemoveGenre(this.dataset.genre)">${esc(g.name)} <span class="opt">${g.n}</span></button>`).join('')}</div>`
        : `<p class="muted">None of the selected ${bulkNoun(kind, 2)} has a genre.</p>`}
      <div class="detail-actions"><span class="detail-spacer"></span>
        <button type="button" class="btn" onclick="closeBulkSheet()">Cancel</button></div>`;
  }
  document.getElementById('bulkModal').classList.add('open');
  document.getElementById('bulkGenreInput')?.focus();
}

function closeBulkSheet() { document.getElementById('bulkModal').classList.remove('open'); }

function bulkAddGenre() {
  const g = (document.getElementById('bulkGenreInput')?.value || '').trim();
  if (!g) return;
  // Reuse an existing spelling, so "sci-fi" typed here joins "Sci-Fi".
  const existing = BULK_GENRES[_bulk.kind]().find(x => textKey(x) === textKey(g)) || g;
  closeBulkSheet();
  bulkApply(r => {
    const genre = r.genre || [];
    if (!genre.some(x => textKey(x) === textKey(existing))) r.genre = [...genre, existing];
    return r;
  }, n => `Added “${existing}” to ${n} ${bulkNoun(_bulk.kind, n)}.`);
}

function bulkRemoveGenre(name) {
  closeBulkSheet();
  bulkApply(r => {
    r.genre = (r.genre || []).filter(x => textKey(x) !== textKey(name));
    return r;
  }, n => `Removed “${name}” from ${n} ${bulkNoun(_bulk.kind, n)}.`);
}

function handleBulkBackdrop(e) {
  if (e.target === document.getElementById('bulkModal')) closeBulkSheet();
}

// While selecting, a tap selects. Capture phase, so it runs before — and
// stops — the detail sheet and the cover lightbox, which listen on bubble.
document.addEventListener('click', e => {
  if (!_bulk) return;
  const el = e.target.closest && e.target.closest('[data-detail]');
  if (!el) return;
  // Controls inside a list row (its own ✏ and 🗑, links) still work.
  if (e.target.closest('button, a, input, select, textarea, label')) return;
  const [kind, id] = el.dataset.detail.split(':');
  if (kind !== _bulk.kind) return;
  e.preventDefault();
  e.stopPropagation();
  toggleBulk(Number(id));
}, true);

// Selection marks survive every re-render: repaint whenever the lists change.
const _bulkObserver = new MutationObserver(() => { if (_bulk) paintBulk(); });
['booksGrid', 'altContent'].forEach(id => {
  const el = document.getElementById(id);
  if (el) _bulkObserver.observe(el, { childList: true, subtree: true });
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !_bulk) return;
  if (document.querySelector('.modal-backdrop.open')) return;   // that Escape is the sheet's
  endBulk();
});
