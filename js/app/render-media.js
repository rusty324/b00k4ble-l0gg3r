// render-media.js — the Movies & TV tab's render, filters, sort
// and search. Split out of app.js.

// ─── MEDIA RENDERING (Movies & TV tab) ────────────────────────────────
// What the search box matches against (shared with the filters sheet's counts).
const mediaSearchText = m => [m.title, m.year, ...(m.genre || []),
  ...(m.copies || []).flatMap(c => [c.edition, c.set, c.note])].filter(Boolean).join(' ');

// A title's copies as compact badges: one per format with a count
// ("🥏 ×2"), at most three, then "+N". The tooltip lists every copy.
const copyLine = c => [MEDIA_FORMAT_LABEL[c.format] || c.format, c.seasons && `S${compressRanges(c.seasons)}`, c.edition, c.set && `set: ${c.set}`].filter(Boolean).join(' — ');
function mediaCopyBadges(m, cls = 'badge badge-media') {
  const by = new Map();
  for (const c of m.copies || []) { if (!by.has(c.format)) by.set(c.format, []); by.get(c.format).push(c); }
  const groups = [...by];
  const shown = groups.slice(0, 3).map(([f, cs]) =>
    `<span class="${cls}" title="${esc(cs.map(copyLine).join('\n'))}">${f in MEDIA_FORMAT_ICON ? ico('media', f) : esc(f)}${cs.length > 1 ? ` ×${cs.length}` : ''}</span>`);
  if (groups.length > 3) shown.push(`<span class="${cls}" title="${esc(groups.slice(3).flatMap(([, cs]) => cs.map(copyLine)).join('\n'))}">+${groups.length - 3}</span>`);
  return shown.join('');
}

// listOnly: replace just the results container, leaving the toolbar (and
// the focused search input inside it) intact — used by the search path.
function renderMedia(listOnly = false) {
  const alt = document.getElementById('altContent');

  // Apply filters
  let items = mediaLibrary;
  // Each row: any shown value, and none of the hidden (core.js facetPasses).
  // A title can hold several formats, so a format is "has a copy in it".
  items = items.filter(m => facetPasses(mediaFilters.type, v => m.type === v) &&
    facetPasses(mediaFilters.status, v => m.status === v) &&
    facetPasses(mediaFilters.format, v => formatsOf(m).includes(v)) &&
    facetPasses(mediaFilters.genres, v => hasGenre(m, v)));
  if (mediaSearch.trim()) items = items.filter(m => matchesAll(mediaSearchText(m), mediaSearch));

  // Sort
  items = [...items].sort((a, b) => {
    switch (mediaSort) {
      case 'title-asc':   return titleSortKey(a.title).localeCompare(titleSortKey(b.title));
      case 'title-desc':  return titleSortKey(b.title).localeCompare(titleSortKey(a.title));
      case 'rating-desc': return (b.rating || 0) - (a.rating || 0);
      case 'added-asc':   return a.id - b.id;
      default:            return b.id - a.id; // added-desc
    }
  });
  _shownIds.media = items.map(m => m.id);   // what bulk edit's "Select all" means

  const typeIcon  = t => ico('media', t === 'tv' ? 'tv' : 'movie');   // custom-icons.js
  const seasonsBadge = m => m.type === 'tv' && m.seasons && m.seasons.length
    ? `<span class="badge badge-seasons">${esc(seasonsText(m.seasons, m.seasonCount))}</span>` : '';

  // Filter toolbar
  const typePills = facetPills(mediaFilters.type, [['movie', `${ico('media','movie')} Movies`], ['tv', `${ico('media','tv')} TV Shows`]], "setMediaFilter('type', ");
  const statusPills = facetPills(mediaFilters.status, statusPairs('media'), "setMediaFilter('status', ");
  const formatPills = facetPills(mediaFilters.format, ['bluray', 'dvd', 'digital', 'streaming'].map(f => [f, `${ico('media', f)} ${esc(MEDIA_FORMAT_LABEL[f])}`]), "setMediaFilter('format', ");
  const sortSelect = `<select class="sort-select" aria-label="Sort movies and TV shows" onchange="setMediaSort(this.value)">
    <option value="added-desc"${mediaSort==='added-desc'?' selected':''}>Newest added</option>
    <option value="added-asc"${mediaSort==='added-asc'?' selected':''}>Oldest added</option>
    <option value="title-asc"${mediaSort==='title-asc'?' selected':''}>Title A–Z</option>
    <option value="title-desc"${mediaSort==='title-desc'?' selected':''}>Title Z–A</option>
    <option value="rating-desc"${mediaSort==='rating-desc'?' selected':''}>Rating ↓</option>
  </select>`;

  const toolbar = `<div style="margin-bottom:1rem">
    <div class="search-wrap" style="margin-bottom:0.6rem">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" id="mediaSearchInput" placeholder="Search title, year, genre, or edition…" aria-label="Search movies and TV shows" value="${esc(mediaSearch)}" oninput="debouncedMediaRender(this.value)">
      <button type="button" class="search-clear" aria-label="Clear search" onclick="clearSearch(this)">&times;</button>
    </div>
    <div class="filter-row facet-row">
      <span class="filter-label">Type</span>
      <div class="pill-group">${typePills}</div>
    </div>
    <div class="filter-row facet-row">
      <span class="filter-label">Status</span>
      <div class="pill-group">${statusPills}</div>
    </div>
    <div class="filter-row facet-row">
      <span class="filter-label">Format</span>
      <div class="pill-group">${formatPills}</div>
    </div>
    <div class="facet-row">${genreFilterRow('media')}</div>
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      ${sortSelect}
      ${filtersButton('media')}
    </div>
    <div class="missing-slot">${listTools('media')}</div>
  </div>`;

  let contentHtml;
  if (!items.length) {
    const narrowed = Object.values(mediaFilters).some(facetOn);
    const emptyMsg = mediaSearch.trim()
      ? { h: 'No results', p: 'Try a different search term or clear the search.' }
      : narrowed
      ? { h: 'No matches', p: 'Nothing here has that combination — try clearing a filter.' }
      : { h: 'Nothing here yet', p: 'Click "Add title" to track movies and TV shows.' };
    contentHtml = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 3l-4 4-4-4"/>
      </svg>
      <h3>${emptyMsg.h}</h3>
      <p style="font-size:14px">${emptyMsg.p}</p>
    </div>`;
  } else if (viewMode === 'list') {
    const rows = items.map(m => {
      const icon    = typeIcon(m.type);
      const formats = mediaCopyBadges(m, 'copy-chip');
      const fmtTip  = (m.copies || []).map(copyLine).join('; ');
      return `<div class="book-row" data-detail="media:${m.id}">
        ${m.posterUrl
          ? `<img class="book-row-thumb" src="${esc(m.posterUrl)}" alt="" loading="lazy">`
          : `<div class="book-row-initial" style="font-size:18px;background:none;color:var(--text)">${icon}</div>`}
        <div class="book-row-content">
          <div class="book-row-title">${esc(m.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${m.year ? esc(String(m.year)) : ''}</div>
            <div class="book-row-badges">
              <span class="badge ${statusClass('media', m.status)}">${esc(statusLabel('media', m.status))}</span>
              ${formats ? `<span class="badge badge-media" title="${esc(fmtTip)}">${formats}</span>` : ''}
              ${seasonsBadge(m)}
            </div>
            <div class="book-row-actions">
              ${renderLinkButtons(m.links, true)}
              <button class="btn btn-sm" onclick="openMediaModal(${m.id})" title="Edit">✏</button>
              <button class="btn btn-sm btn-danger" onclick="deleteMediaItem(${m.id})" title="Delete">🗑</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    contentHtml = `<div class="books-list">${rows}</div>`;
  } else {
    const cards = items.map(m => {
      const icon      = typeIcon(m.type);
      const fmtBadges = mediaCopyBadges(m);
      const mr = Math.max(0, Math.min(5, m.rating || 0));
      const stars = mr > 0
        ? `<span class="stars">${'★'.repeat(mr)}<span class="empty">${'★'.repeat(5-mr)}</span></span>`
        : '';
      // A short horizontal card: the whole poster at the left, not a
      // full-width banner that crops a portrait poster to a strip.
      const sub = [m.type === 'tv' ? 'TV show' : 'Movie', m.year].filter(Boolean).join(' · ');
      return `<div class="book-card hcard" data-detail="media:${m.id}" tabindex="0" role="button" aria-label="${esc(m.title)} — details">
        ${hcardPoster(m.posterUrl, m.title, 'hcard-media')}
        <div class="hcard-body">
          <div class="book-title">${esc(m.title)}</div>
          <div class="hcard-sub">${esc(sub)}</div>
          <div class="book-meta">
            <span class="badge ${statusClass('media', m.status)}">${esc(statusLabel('media', m.status))}</span>
            ${fmtBadges}
            ${seasonsBadge(m)}
            ${stars}
          </div>
        </div>
      </div>`;
    }).join('');
    contentHtml = `<div class="books-grid hcard-grid">${cards}</div>`;
  }

  const wrap = document.getElementById('mediaListWrap');
  if (listOnly && wrap) {
    wrap.innerHTML = contentHtml;
    return;
  }
  alt.innerHTML = toolbar + `<div id="mediaListWrap">${contentHtml}</div>`;
}

// A pill cycles its value show → hide → off; "All" clears the row.
function setMediaFilter(key, val) {
  if (val === 'all') clearFacet(mediaFilters[key]); else cycleFacet(mediaFilters[key], val);
  renderMedia();
}

function setMediaSort(val) {
  mediaSort = val;
  renderMedia();
}

function debouncedMediaRender(val) {
  mediaSearch = val;
  clearTimeout(mediaSearchTimer);
  // Guard on activeTab: a timer firing after a tab switch would otherwise
  // paint media content into the pane the new tab just rendered.
  mediaSearchTimer = setTimeout(() => { if (activeTab === 'media') renderMedia(true); }, 200);
}


