// filters-sheet.js — on phones (≤480px), the filter pill rows give way to one
// "Filters" button that opens a bottom sheet with every facet of the tab.
//
// The sheet edits the same state the desktop pills do (filters, mediaFilters,
// gameFilters) and applies each tap at once, so the two can never disagree.
// A tap cycles an option show → hide → off (core.js cycleFacet); any number
// can be on. Every option shows how many items match it, counted with the
// tab's search and the OTHER facets applied. An option that matches nothing
// is disabled, not hidden — unless it is already on, which must stay
// tappable to undo. The footer button says how many results there are.
//
// Books also get a Collection facet the desktop rows don't have: in a series,
// standalone, or a series with numbering gaps (the gaps "What am I missing?"
// counts — seriesStatus(), via seriesStatusByKey() in series-view.js).

const FILTER_KINDS = {
  books: {
    state: () => filters,
    items: () => {
      const q = searchFold(document.getElementById('searchInput').value).trim();
      return q ? books.filter(b => matchesAll(b._searchStr, q)) : books;
    },
    apply: () => { currentPage = 1; render(); syncBookPills(); },
    noun: n => (viewMode === 'series' ? (n === 1 ? 'entry' : 'entries') : (n === 1 ? 'book' : 'books')),
    total: list => (viewMode === 'series' ? seriesEntryCount(list) : list.length),
    facets: () => [
      { key: 'collection', label: 'Collection', options: [['series', 'In a series'], ['standalone', 'Standalone'], ['gaps', 'Series with gaps']],
        match: bookCollectionMatch },
      { key: 'format', label: 'Format', html: true, options: () => [['ebook', 'E-book'], ['audio', 'Audio'], ['physical', 'Physical']].map(([v, l]) => [v, `${ico('books', v)} ${l}`]),
        match: (b, v) => formatsOf(b).includes(v) },
      { key: 'status', label: 'Status', options: statusPairs('books'), match: (b, v) => b.status === v },
      genreFacet(() => allBookGenres()),
    ],
  },
  media: {
    state: () => mediaFilters,
    items: () => (mediaSearch.trim() ? mediaLibrary.filter(m => matchesAll(mediaSearchText(m), mediaSearch)) : mediaLibrary),
    apply: () => renderMedia(),
    noun: n => (n === 1 ? 'title' : 'titles'),
    total: list => list.length,
    facets: () => [
      { key: 'type', label: 'Type', html: true, options: () => [['movie', 'Movies'], ['tv', 'TV Shows']].map(([v, l]) => [v, `${ico('media', v)} ${l}`]), match: (m, v) => m.type === v },
      { key: 'status', label: 'Status', options: statusPairs('media'), match: (m, v) => m.status === v },
      { key: 'format', label: 'Format', html: true, options: () => ['bluray', 'dvd', 'digital', 'streaming'].map(f => [f, `${ico('media', f)} ${esc(MEDIA_FORMAT_LABEL[f])}`]),
        match: (m, v) => formatsOf(m).includes(v) },
      genreFacet(() => allMediaGenres()),
    ],
  },
  games: {
    state: () => gameFilters,
    items: () => (gameSearch.trim() ? videoGames.filter(g => matchesAll(gameSearchText(g), gameSearch)) : videoGames),
    apply: () => renderGames(),
    noun: n => (n === 1 ? 'game' : 'games'),
    total: list => list.length,
    facets: () => [
      { key: 'platform', label: 'Platform', options: () => knownGamePlatforms().map(p => [p, platformLabel(p)]),
        match: (g, v) => platformsOf(g).some(p => p.platform === v) },
      // Only once PC is chosen: which store or launcher.
      { key: 'store', label: 'Store', options: () => (gameFilters.platform.in.includes('pc') ? pcStoresInUse().map(k => [k, storeLabel(k)]) : []),
        match: (g, v) => gameHasPcStore(g, v) },
      { key: 'status', label: 'Status', options: statusPairs('games'), match: (g, v) => g.status === v },
      { key: 'format', label: 'Format', html: true, options: () => GAME_FORMATS.map(f => [f, `${gameFormatIcon(f)} ${esc(GAME_FORMAT_LABEL[f])}`]),
        match: (g, v) => platformsOf(g).some(p => p.formats.includes(v)) },
      genreFacet(() => allGameGenres()),
    ],
  },
};

function genreFacet(all) {
  return { key: 'genres', label: 'Genre', options: () => all().map(g => [g, g]), match: (x, v) => hasGenre(x, v) };
}

function bookCollectionMatch(b, v) {
  const name = splitSeries(b.series).name;
  if (v === 'standalone') return !name;
  if (!name) return false;
  if (v === 'series') return true;
  const st = seriesStatusByKey().get(seriesKey(name));   // 'gaps'
  return !!(st && st.missing.length);
}

// What render() asks: does this book pass the Collection facet?
const passesCollection = b => facetPasses(filters.collection, v => bookCollectionMatch(b, v));

function seriesEntryCount(list) {
  const keys = new Set();
  let standalone = 0;
  for (const b of list) {
    const name = splitSeries(b.series).name;
    if (name) keys.add(seriesKey(name)); else standalone++;
  }
  return keys.size + standalone;
}

// ─── counting ─────────────────────────────────────────────────────────
const passesFacet = (item, state, f) => facetPasses(state[f.key], v => f.match(item, v));
function activeFilterCount(kind) {
  const spec = FILTER_KINDS[kind], state = spec.state();
  return spec.facets().reduce((n, f) => n + facetCount(state[f.key]), 0);
}

// ─── the button ───────────────────────────────────────────────────────
function filtersButtonLabel(kind) {
  const n = activeFilterCount(kind);
  return `Filters${n ? ` <span class="filters-count" aria-label="${n} active">${n}</span>` : ''}`;
}
// For tabs that build their toolbar as a string (Movies & TV, Games).
const filtersButton = kind =>
  `<button type="button" class="btn filters-btn" id="filtersBtn-${kind}" aria-haspopup="dialog" onclick="openFilterSheet('${kind}')">${filtersButtonLabel(kind)}</button>`;
function paintFiltersButton(kind) {
  const b = document.getElementById(`filtersBtn-${kind}`);
  if (b) b.innerHTML = filtersButtonLabel(kind);
}

// The Books tab's pills are static markup: keep their highlight in step
// when the sheet changes a facet they show.
function syncBookPills() {
  [['formatPills', filters.format], ['statusPills', filters.status]].forEach(([id, f]) => {
    document.querySelectorAll(`#${id} .pill`).forEach(p => {
      const v = p.dataset.facetValue;
      const m = v === 'all' ? (facetOn(f) ? '' : 'in') : facetMark(f, v);
      p.classList.toggle('active', m === 'in');
      p.classList.toggle('excluded', m === 'out');
      p.setAttribute('aria-pressed', m === 'in' ? 'true' : m === 'out' ? 'mixed' : 'false');
    });
  });
  paintFiltersButton('books');
}

// ─── the sheet ────────────────────────────────────────────────────────
let _filterKind = null;

function paintFilterSheet() {
  const spec = FILTER_KINDS[_filterKind], state = spec.state();
  const items = spec.items();
  const facets = spec.facets();
  const sections = facets.map(f => {
    const opts = typeof f.options === 'function' ? f.options() : f.options;
    if (!opts.length) return '';
    // Everything that passes the other facets; then count each option in it.
    const others = facets.filter(o => o !== f);
    const pool = items.filter(x => others.every(o => passesFacet(x, state, o)));
    const buttons = opts.map(([v, label]) => {
      const m = facetMark(state[f.key], v);
      const n = pool.filter(x => f.match(x, v)).length;
      const off = !n && !m;
      const tick = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
      const cross = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      return `<button type="button" class="facet-opt${m === 'in' ? ' on' : m === 'out' ? ' out' : ''}" aria-pressed="${m === 'in' ? 'true' : m === 'out' ? 'mixed' : 'false'}" ${off ? 'disabled' : ''}
          data-facet="${esc(f.key)}" data-value="${esc(v)}">${m === 'in' ? tick : m === 'out' ? cross : ''}${f.html ? label : esc(label)}${m === 'out' ? '<span class="sr-only"> (hidden)</span>' : ''}
          <span class="facet-n">${n.toLocaleString()}</span></button>`;
    }).join('');
    return `<div class="facet-group"><div class="facet-label" id="facet-${esc(f.key)}">${esc(f.label)}</div>
      <div class="facet-opts" role="group" aria-labelledby="facet-${esc(f.key)}">${buttons}</div></div>`;
  }).join('');
  const matching = items.filter(x => facets.every(f => passesFacet(x, state, f)));
  const total = spec.total(matching);
  const any = activeFilterCount(_filterKind) > 0;
  document.getElementById('filterBody').innerHTML = `
    <div class="filter-sheet-head">
      <h2 id="filterSheetTitle">Filters</h2>
      <button type="button" class="filter-clear" onclick="clearFilterSheet()" ${any ? '' : 'disabled'}>Clear all</button>
      <button type="button" class="series-sheet-close" aria-label="Close filters" onclick="closeFilterSheet()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <p class="hint filter-sheet-hint">Tap to show, again to hide, again to clear.</p>
    <div class="filter-sheet-body">${sections}</div>
    <div class="filter-sheet-foot">
      <button type="button" class="btn btn-primary filter-show" onclick="closeFilterSheet()">Show ${total.toLocaleString()} ${spec.noun(total)}</button>
    </div>`;
}

function openFilterSheet(kind) {
  if (!FILTER_KINDS[kind]) return;
  _filterKind = kind;
  paintFilterSheet();
  document.getElementById('filterModal').classList.add('open');
  document.querySelector('#filterBody .series-sheet-close')?.focus();
}

function closeFilterSheet() {
  const m = document.getElementById('filterModal');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  // The tab may have re-rendered its toolbar meanwhile: find the button anew.
  document.getElementById(`filtersBtn-${_filterKind}`)?.focus();
  _filterKind = null;
}

function handleFilterBackdrop(e) {
  if (e.target === document.getElementById('filterModal')) closeFilterSheet();
}

function setFacet(key, value) {
  const spec = FILTER_KINDS[_filterKind], state = spec.state();
  const f = spec.facets().find(x => x.key === key);
  if (!f) return;
  cycleFacet(state[key], value);
  // The Store row belongs to PC: with PC no longer shown, its choices go.
  if (_filterKind === 'games' && key === 'platform' && !state.platform.in.includes('pc')) clearFacet(state.store);
  spec.apply();
  paintFilterSheet();
  document.querySelector(`#filterBody .facet-opt[data-facet="${CSS.escape(key)}"][data-value="${CSS.escape(value)}"]`)?.focus();
}

function clearFilterSheet() {
  const spec = FILTER_KINDS[_filterKind], state = spec.state();
  spec.facets().forEach(f => clearFacet(state[f.key]));
  if (_filterKind === 'games') clearFacet(state.store);
  spec.apply();
  paintFilterSheet();
  document.querySelector('#filterBody .series-sheet-close')?.focus();
}

document.addEventListener('click', e => {
  const opt = e.target.closest && e.target.closest('#filterBody .facet-opt');
  if (opt && !opt.disabled) setFacet(opt.dataset.facet, opt.dataset.value);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('filterModal')?.classList.contains('open')) closeFilterSheet();
});
