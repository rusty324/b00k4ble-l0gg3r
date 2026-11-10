// series-view.js — the Books tab's Series view: one row per series instead
// of one card per book, with a completeness strip, the gaps in words, and the
// volumes on demand (inline on wider screens, a bottom sheet on phones).
//
// Built on what "What am I missing?" already uses, so the two always agree:
// grouping by seriesKey(splitSeries(series).name), display names from
// seriesSpellings(), and the gaps from seriesStatus() over ALL of a series'
// books — gaps describe the library, not the current filter. The list itself
// is render()'s filtered, book-level _filteredCache, grouped.

const SERIES_SORTS = [
  ['entries-books', 'Most books'], ['entries-name', 'Series A–Z'],
  ['entries-author', 'Author A–Z (surname)'], ['entries-added', 'Newest added'],
];
const _openSeries = new Set();          // series expanded inline (wider screens)
let _seriesCache = { key: null, entries: [] };
let _seriesStatusCache = { at: -1, byKey: new Map() };
const phoneWidth = () => window.matchMedia && matchMedia('(max-width: 480px)').matches;

// seriesStatus() is a pass over the whole library; once per change of it.
function seriesStatusByKey() {
  if (_seriesStatusCache.at !== _booksMutation) {
    _seriesStatusCache = { at: _booksMutation, byKey: new Map(seriesStatus().map(s => [s.key, s])) };
  }
  return _seriesStatusCache.byKey;
}

const firstNumber = b => { const n = seriesNumbers(splitSeries(b.series).number); return n.length ? Math.min(...n) : Infinity; };
const isWholeOwned = b => seriesNumbers(splitSeries(b.series).number).some(n => Number.isInteger(n) && n >= 1);

// ─── grouping ─────────────────────────────────────────────────────────
// -> [{ kind: 'series' | 'book', key, name, members, ... }] in the sort's order.
function seriesEntries(filtered, sort) {
  const cacheKey = `${_filteredCacheKey}|${sort}`;
  if (_seriesCache.key === cacheKey) return _seriesCache.entries;
  const spell = seriesSpellings();
  const status = seriesStatusByKey();
  const groups = new Map();
  const entries = [];
  for (const b of filtered) {
    const name = splitSeries(b.series).name;
    if (!name) { entries.push({ kind: 'book', key: `b:${b.id}`, name: b.title, members: [b] }); continue; }
    const k = seriesKey(name);
    if (!groups.has(k)) {
      const g = { kind: 'series', key: k, name: spell.get(k) || name, members: [] };
      groups.set(k, g); entries.push(g);
    }
    groups.get(k).members.push(b);
  }
  for (const e of entries) {
    e.members.sort((a, b) => firstNumber(a) - firstNumber(b) || titleSortKey(a.title).localeCompare(titleSortKey(b.title)));
    e.added = Math.max(...e.members.map(b => b.id));
    e.firstAuthor = (e.members[0].author || '').split(', ')[0];
    if (e.kind !== 'series') continue;
    const st = status.get(e.key);
    e.all = books.filter(b => seriesKey(splitSeries(b.series).name) === e.key);
    e.max = st ? Math.max(...st.have) : 0;
    e.have = new Set(st ? st.have : []);
    e.missing = st ? st.missing : [];
    e.ignored = st ? st.ignored : [];
    e.other = e.members.filter(b => !isWholeOwned(b)).length;
  }
  const byName = (a, b) => titleSortKey(a.name).localeCompare(titleSortKey(b.name));
  const cmp = {
    'entries-books':  (a, b) => b.members.length - a.members.length || byName(a, b),
    'entries-name':   byName,
    'entries-author': (a, b) => authorSortKey(a.firstAuthor).localeCompare(authorSortKey(b.firstAuthor)) || byName(a, b),
    'entries-added':  (a, b) => b.added - a.added,
  }[sort] || ((a, b) => b.members.length - a.members.length || byName(a, b));
  entries.sort(cmp);
  _seriesCache = { key: cacheKey, entries };
  return entries;
}

// ─── pieces ───────────────────────────────────────────────────────────
// "Owned 1 to 28, missing 4, 6, 13–15" — the strip's text, for screen readers.
function stripLabel(e) {
  if (!e.max) return '';
  const parts = [`Owned numbers 1 to ${e.max}`];
  parts.push(e.missing.length ? `missing ${compressRanges(e.missing)}` : 'none missing');
  if (e.ignored.length) parts.push(`ignoring ${compressRanges(e.ignored)}`);
  return parts.join(', ');
}

// One equal segment per number from #1 to the highest owned, as hard stops.
function stripStyle(e) {
  if (!e.max) return '';
  const missing = new Set(e.missing), ignored = new Set(e.ignored);
  const stops = [];
  for (let n = 1; n <= e.max; n++) {
    const c = e.have.has(n) ? 'var(--owned)' : ignored.has(n) ? 'var(--gray-400)' : missing.has(n) ? 'var(--missing)' : 'var(--owned)';
    stops.push(`${c} ${((n - 1) / e.max * 100).toFixed(3)}% ${(n / e.max * 100).toFixed(3)}%`);
  }
  return `background: linear-gradient(to right, ${stops.join(', ')})`;
}

function seriesLabel(e) {
  const total = e.all.length, shown = e.members.length;
  const books = shown === total ? `${shown} book${shown === 1 ? '' : 's'}` : `${shown} of ${total} books`;
  const bits = [`<strong>${books}</strong>`];
  if (e.max) bits.push(`#1–${e.max}`, e.missing.length ? `${e.missing.length} gap${e.missing.length === 1 ? '' : 's'}` : 'no gaps');
  if (e.other) bits.push(`+${e.other} other`);
  return bits.join(' · ');
}

// The phone card's right-hand note: "3 gaps in #1–28" or "#1–95, no gaps".
const phoneNote = e => !e.max ? '' : e.missing.length
  ? `<span class="series-gaps">${e.missing.length} gap${e.missing.length === 1 ? '' : 's'} in #1–${e.max}</span>`
  : `<span>#1–${e.max}, no gaps</span>`;

const gapText = e => e.missing.length ? `Missing ${compressRanges(e.missing, '#').replace(/–#/g, '–')}` : '';

function topAuthors(members) {
  const count = new Map();
  members.forEach(b => String(b.author || '').split(', ').filter(Boolean).forEach(a => count.set(a, (count.get(a) || 0) + 1)));
  const sorted = [...count].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  return sorted.slice(0, 2).join(', ') + (sorted.length > 2 ? ` +${sorted.length - 2}` : '');
}

const TILE_COLORS = ['#1F4E79', '#8B3A2B', '#3B3B58', '#2F4F3E', '#4A2C4A', '#2E6B8A', '#5C4A1E', '#3A2A2A', '#1D3B4F', '#6B2F2F'];
function tileColor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TILE_COLORS[h % TILE_COLORS.length]; }
const initials = s => String(s).replace(/^(the|a|an)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

// The first member with a cover; otherwise an initials tile the lazy cover
// loader can fill in (data-book-id, see getCoverObserver).
function seriesCover(e, cls = 'series-cover') {
  const withCover = e.members.find(b => b.coverUrl || (_coverCache[b.id] && !['none', 'pending'].includes(_coverCache[b.id])));
  if (withCover) return `<img class="${cls} series-cover-img" src="${esc(withCover.coverUrl || _coverCache[withCover.id])}" alt="" loading="lazy" decoding="async">`;
  return `<span class="${cls} series-tile" data-book-id="${e.members[0].id}" aria-hidden="true" style="background:${tileColor(e.name)}">${esc(initials(e.name))}</span>`;
}

const FMT_BADGE = { physical: ['badge-physical', '📚 Physical'], ebook: ['badge-ebook', '📱 E-book'], audio: ['badge-audio', '🎧 Audiobook'] };
const formatBadges = members => [...new Set(members.flatMap(b => b.formats || []))]
  .map(f => `<span class="badge ${(FMT_BADGE[f] || [''])[0]}">${(FMT_BADGE[f] || [, esc(f)])[1]}</span>`).join('');

function volumeChip(b) {
  const n = splitSeries(b.series).number;
  return `<button type="button" class="vol-chip${isWholeOwned(b) ? '' : ' vol-other'}" data-detail="books:${b.id}">
      ${n ? `<strong>#${esc(n)}</strong>` : ''}${esc(b.title)}</button>`;
}

function seriesRow(e) {
  if (e.kind === 'book') {
    const b = e.members[0];
    return `<div class="series-row is-book" data-detail="books:${b.id}" tabindex="0" role="button" aria-label="${esc(b.title)} — details">
        ${seriesCover(e)}
        <div class="series-main"><div class="series-name">${esc(b.title)}</div><div class="series-authors">${esc(b.author || '')}</div></div>
        <div class="series-progress"></div>
        <div class="series-meta">${formatBadges(e.members)}<span class="badge ${statusClass('books', b.status)}">${esc(statusLabel('books', b.status))}</span></div>
        <span class="series-chev-space" aria-hidden="true"></span>
      </div>`;
  }
  const open = _openSeries.has(e.key) && !phoneWidth();
  const id = 'vols-' + e.key.replace(/[^a-z0-9]+/gi, '-');
  const read = e.members.filter(b => b.status === 'read').length;
  const whole = e.members.filter(isWholeOwned).length;
  return `<div class="series-block${open ? ' open' : ''}">
      <div class="series-row" data-series="${esc(e.key)}">
        ${seriesCover(e)}
        <div class="series-main"><div class="series-name">${esc(e.name)}</div><div class="series-authors">${esc(topAuthors(e.members))}</div></div>
        <div class="series-progress">
          <div class="series-label">${seriesLabel(e)}</div>
          ${e.max ? `<div class="series-strip" role="img" aria-label="${esc(stripLabel(e))}" style="${stripStyle(e)}"></div>` : ''}
          <div class="series-gaps">${esc(gapText(e))}</div>
          <div class="series-foot"><span>${e.members.length} book${e.members.length === 1 ? '' : 's'}</span>${phoneNote(e)}</div>
        </div>
        <div class="series-meta">${formatBadges(e.members)}<span class="series-read">${read} of ${e.members.length} read</span></div>
        <button type="button" class="series-chev" data-series-toggle="${esc(e.key)}" aria-expanded="${open}" aria-controls="${id}"
                aria-label="${open ? 'Hide' : 'Show'} volumes of ${esc(e.name)}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      ${open ? `<div class="series-vols" id="${id}">
        <div class="series-vols-head">
          <span>${whole} numbered${e.other ? ` · ${e.other} other (dashed)` : ''}. Tap a volume for its details.</span>
          <button type="button" class="btn" data-series-select="${esc(e.key)}">Select these ${e.members.length} book${e.members.length === 1 ? '' : 's'}</button>
        </div>
        <div class="vol-chips">${e.members.map(volumeChip).join('')}</div>
      </div>` : ''}
    </div>`;
}

// ─── render (called by render() in Series mode) ───────────────────────
function renderSeriesView(filtered, sort, grid) {
  const entries = seriesEntries(filtered, sort);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const page = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const summary = document.getElementById('booksSummary');
  if (summary) {
    const n = entries.length.toLocaleString(), shown = filtered.length.toLocaleString(), all = books.length.toLocaleString();
    summary.innerHTML = `<strong>${n} ${entries.length === 1 ? 'entry' : 'entries'}</strong> · ${filtered.length === books.length ? `${all} books` : `${shown} of ${all} books`}`;
    summary.hidden = false;
  }
  grid.className = 'series-list';
  grid.innerHTML = page.map(seriesRow).join('');
  const obs = getCoverObserver();
  grid.querySelectorAll('[data-book-id]').forEach(el => obs.observe(el));
  renderPagination(entries.length, totalPages);
}

// The sort menu offers the Series view's orders in Series mode and the
// book orders otherwise, keeping each mode's last choice.
const _sortChoice = { books: null, series: 'entries-books' };
let _sortOptionsBook = null;
function syncSortOptions() {
  const sel = document.getElementById('sortSelect');
  if (!sel) return;
  if (_sortOptionsBook === null) _sortOptionsBook = sel.innerHTML;
  const series = viewMode === 'series';
  const isSeriesNow = sel.dataset.mode === 'series';
  if (series === isSeriesNow) return;
  _sortChoice[isSeriesNow ? 'series' : 'books'] = sel.value;
  sel.innerHTML = series ? SERIES_SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') : _sortOptionsBook;
  sel.dataset.mode = series ? 'series' : 'books';
  const want = _sortChoice[series ? 'series' : 'books'];
  if (want && [...sel.options].some(o => o.value === want)) sel.value = want;
  else sel.selectedIndex = 0;
}

// ─── expanding ────────────────────────────────────────────────────────
function seriesEntryByKey(key) {
  return (_seriesCache.entries || []).find(e => e.key === key);
}

function toggleSeries(key) {
  if (phoneWidth()) { openSeriesSheet(key); return; }
  if (_openSeries.has(key)) _openSeries.delete(key); else _openSeries.add(key);
  render();
  document.querySelector(`[data-series-toggle="${CSS.escape(key)}"]`)?.focus();
}

function selectSeriesBooks(key) {
  const e = seriesEntryByKey(key);
  if (!e) return;
  closeSeriesSheet();
  startBulk('books', e.members.map(b => b.id));
}

// ─── the phone sheet ──────────────────────────────────────────────────
let _sheetKey = null, _sheetReturn = null;

function openSeriesSheet(key) {
  const e = seriesEntryByKey(key);
  if (!e) return;
  _sheetKey = key;
  _sheetReturn = document.activeElement;
  const read = e.members.filter(b => b.status === 'read').length;
  const byNumber = new Map();
  e.members.forEach(b => seriesNumbers(splitSeries(b.series).number).forEach(n => { if (!byNumber.has(n)) byNumber.set(n, b); }));
  const ignored = new Set(e.ignored);
  // Every number from #1 to the highest owned, plus whatever else the series
  // holds (#0, #3.5, unnumbered), in order.
  const rows = [];
  const seen = new Set();
  for (let n = 1; n <= e.max; n++) {
    const b = byNumber.get(n);
    if (b) { if (!seen.has(b.id)) { rows.push({ at: n, b }); seen.add(b.id); } }
    else rows.push({ at: n, gap: n, ignored: ignored.has(n) });
  }
  e.members.filter(b => !seen.has(b.id)).forEach(b => rows.push({ at: firstNumber(b), b }));
  rows.sort((x, y) => x.at - y.at);
  const sub = b => [isWholeOwned(b) ? '' : 'Companion work', statusLabel('books', b.status),
    (b.formats || []).map(f => (FMT_BADGE[f] || [, f])[1].replace(/^\S+\s/, '')).join(', ')].filter(Boolean).join(' · ');
  document.getElementById('seriesBody').innerHTML = `
    <div class="series-sheet-head">
      ${seriesCover(e, 'series-sheet-cover')}
      <div class="series-sheet-headtext">
        <h2 class="detail-title" id="seriesSheetTitle">${esc(e.name)}</h2>
        <div class="series-authors">${esc(topAuthors(e.members))}</div>
        <div class="series-label"><strong>${e.members.length} book${e.members.length === 1 ? '' : 's'}</strong> · ${read} of ${e.members.length} read</div>
      </div>
      <button type="button" class="series-sheet-close" aria-label="Close" onclick="closeSeriesSheet()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    ${e.max ? `<div class="series-strip series-strip-lg" role="img" aria-label="${esc(stripLabel(e))}" style="${stripStyle(e)}"></div>
      <div class="series-strip-ends"><span>#1</span><span class="series-gaps">${esc(gapText(e) || 'No gaps')}</span><span>#${e.max}</span></div>` : ''}
    <button type="button" class="btn series-sheet-select" data-series-select="${esc(e.key)}">Select these ${e.members.length} book${e.members.length === 1 ? '' : 's'}</button>
    <div class="series-sheet-list">
      ${rows.map(r => r.b
        ? `<button type="button" class="vol-row" data-detail="books:${r.b.id}">
             <span class="vol-row-tile" aria-hidden="true" style="background:${tileColor(r.b.title)}"></span>
             <span class="vol-row-text"><span class="vol-row-title">${splitSeries(r.b.series).number ? `<span class="vol-row-n">#${esc(splitSeries(r.b.series).number)}</span> ` : ''}${esc(r.b.title)}</span>
             <span class="vol-row-sub">${esc(sub(r.b))}</span></span></button>`
        : `<div class="vol-row vol-gap${r.ignored ? ' vol-ignored' : ''}">
             <span class="vol-row-tile" aria-hidden="true">?</span>
             <span class="vol-row-text"><span class="vol-row-title"><span class="vol-row-n">#${r.gap}</span> Not in your library</span>
             <span class="vol-row-sub">${r.ignored ? 'Gap ignored' : 'Numbering gap'}</span></span>
             ${r.ignored ? '' : `<button type="button" class="btn btn-sm" data-series-add="${r.gap}">Add #${r.gap}</button>`}
           </div>`).join('')}
    </div>`;
  document.getElementById('seriesModal').classList.add('open');
  document.querySelector('#seriesBody .series-sheet-close')?.focus();
}

function closeSeriesSheet() {
  const m = document.getElementById('seriesModal');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  _sheetKey = null;
  if (_sheetReturn && _sheetReturn.isConnected) _sheetReturn.focus();
}

function handleSeriesBackdrop(ev) {
  if (ev.target === document.getElementById('seriesModal')) closeSeriesSheet();
}

// ─── events ───────────────────────────────────────────────────────────
document.addEventListener('click', ev => {
  const t = ev.target;
  if (!t.closest) return;
  const sel = t.closest('[data-series-select]');
  if (sel) { selectSeriesBooks(sel.dataset.seriesSelect); return; }
  const add = t.closest('[data-series-add]');
  if (add) {
    const e = seriesEntryByKey(_sheetKey);
    closeSeriesSheet();
    if (e) addMissingBook(e.name, Number(add.dataset.seriesAdd));
    return;
  }
  const tog = t.closest('[data-series-toggle]');
  if (tog) { toggleSeries(tog.dataset.seriesToggle); return; }
  // The whole row expands too, except its own controls.
  const row = t.closest('.series-row[data-series]');
  if (row && !t.closest('button, a') && !(typeof bulkActive === 'function' && bulkActive())) toggleSeries(row.dataset.series);
});

// Escape closes the sheet — unless a book's details are open over it, whose
// Escape comes first (window capture runs before the detail sheet's handler).
window.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || !document.getElementById('seriesModal')?.classList.contains('open')) return;
  if (document.getElementById('detailModal')?.classList.contains('open') ||
      document.getElementById('modal')?.classList.contains('open')) return;
  closeSeriesSheet();
}, true);
