// render-media.js — the Movies & TV tab's render, filters, sort
// and search. Split out of app.js.

// ─── MEDIA RENDERING (Movies & TV tab) ────────────────────────────────
// listOnly: replace just the results container, leaving the toolbar (and
// the focused search input inside it) intact — used by the search path.
function renderMedia(listOnly = false) {
  const alt = document.getElementById('altContent');

  // Apply filters
  let items = mediaLibrary;
  if (mediaFilters.type !== 'all') items = items.filter(m => m.type === mediaFilters.type);
  if (mediaFilters.status !== 'all') items = items.filter(m => m.status === mediaFilters.status);
  // An item can hold several formats, so this is "has it", not "is it".
  if (mediaFilters.format !== 'all')
    items = items.filter(m => (m.formats || []).includes(mediaFilters.format));
  // Several genres widen rather than narrow — see GENRE_FILTERS.
  if (mediaFilters.genres.length) {
    const wanted = new Set(mediaFilters.genres.map(x => x.toLowerCase()));
    items = items.filter(m => (m.genre || []).some(x => wanted.has(String(x).toLowerCase())));
  }
  if (mediaSearch.trim()) {
    const q = mediaSearch.toLowerCase().trim();
    items = items.filter(m =>
      (m.title || '').toLowerCase().includes(q) ||
      (m.year ? String(m.year) : '').includes(q) ||
      (m.genre || []).some(g => g.toLowerCase().includes(q)) ||
      Object.values(m.editions || {}).some(e => e.toLowerCase().includes(q))
    );
  }

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

  const typeIcon  = { movie: '🎬', tv: '📺' };
  const stCls     = { want: 'badge-want', watched: 'badge-watched' };
  const stLabel   = { want: 'Want to Watch', watched: 'Watched' };
  const fmtIcons  = MEDIA_FORMAT_ICON;      // shared with the form (core.js)
  // "DVD — "Don't Call Me Shirley!" Edition" on hover, plain "DVD" otherwise.
  const fmtTitle  = (m, f) => (MEDIA_FORMAT_LABEL[f] || f) + (m.editions && m.editions[f] ? ` — ${m.editions[f]}` : '');
  const seasonsBadge = m => m.type === 'tv' && m.seasons && m.seasons.length
    ? `<span class="badge badge-seasons">${esc(seasonsText(m.seasons, m.seasonCount))}</span>` : '';

  // Filter toolbar
  const typePills = [['all','All'],['movie','🎬 Movies'],['tv','📺 TV Shows']].map(([v,l]) =>
    `<button class="pill${mediaFilters.type===v?' active':''}" onclick="setMediaFilter('type','${v}')">${l}</button>`
  ).join('');
  const statusPills = [['all','All'],['want','Want to Watch'],['watched','Watched']].map(([v,l]) =>
    `<button class="pill${mediaFilters.status===v?' active':''}" onclick="setMediaFilter('status','${v}')">${l}</button>`
  ).join('');
  // Same values and icons as the form's format checkboxes.
  const formatPills = [['all','All'],['bluray','🥏 Blu-ray'],['dvd','💿 DVD'],
                       ['digital','💻 Digital'],['streaming','📡 Streaming']].map(([v,l]) =>
    `<button class="pill${mediaFilters.format===v?' active':''}" onclick="setMediaFilter('format','${v}')">${l}</button>`
  ).join('');
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
    <div class="filter-row">
      <span class="filter-label">Type</span>
      <div class="pill-group">${typePills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Status</span>
      <div class="pill-group">${statusPills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Format</span>
      <div class="pill-group">${formatPills}</div>
    </div>
    ${genreFilterRow('media')}
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      ${sortSelect}
    </div>
    <div class="missing-slot">${listTools('media')}</div>
  </div>`;

  let contentHtml;
  if (!items.length) {
    const narrowed = mediaFilters.type !== 'all' || mediaFilters.status !== 'all' ||
                     mediaFilters.format !== 'all' || mediaFilters.genres.length > 0;
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
      const icon    = typeIcon[m.type] || '🎬';
      const formats = (m.formats || []).map(f => fmtIcons[f] || '').join(' ');
      const fmtTip  = (m.formats || []).map(f => fmtTitle(m, f)).join('; ');
      return `<div class="book-row" data-detail="media:${m.id}">
        ${m.posterUrl
          ? `<img class="book-row-thumb" src="${esc(m.posterUrl)}" alt="" loading="lazy">`
          : `<div class="book-row-initial" style="font-size:18px;background:none;color:var(--text)">${icon}</div>`}
        <div class="book-row-content">
          <div class="book-row-title">${esc(m.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${m.year ? esc(String(m.year)) : ''}</div>
            <div class="book-row-badges">
              <span class="badge ${stCls[m.status] || 'badge-want'}">${stLabel[m.status] || esc(m.status)}</span>
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
      const icon      = typeIcon[m.type] || '🎬';
      const fmtBadges = (m.formats || []).map(f =>
        `<span class="badge badge-media" title="${esc(fmtTitle(m, f))}">${fmtIcons[f] || esc(f)}</span>`).join('');
      const mr = Math.max(0, Math.min(5, m.rating || 0));
      const stars = mr > 0
        ? `<span class="stars">${'★'.repeat(mr)}<span class="empty">${'★'.repeat(5-mr)}</span></span>`
        : '';
      return `<div class="book-card" data-detail="media:${m.id}" tabindex="0" role="button" aria-label="${esc(m.title)} — details">
        ${m.posterUrl
          ? `<img class="book-card-cover" src="${esc(m.posterUrl)}" alt="" loading="lazy">`
          : `<div class="media-card-placeholder">${icon}</div>`}
        <div class="book-title">${esc(m.title)}</div>
        ${m.year ? `<div class="book-author">${esc(String(m.year))}</div>` : ''}
        <div class="book-meta">
          <span class="badge ${stCls[m.status] || 'badge-want'}">${stLabel[m.status] || esc(m.status)}</span>
          ${fmtBadges}
          ${seasonsBadge(m)}
          ${stars}
        </div>
      </div>`;
    }).join('');
    contentHtml = `<div class="books-grid">${cards}</div>`;
  }

  const wrap = document.getElementById('mediaListWrap');
  if (listOnly && wrap) {
    wrap.innerHTML = contentHtml;
    return;
  }
  alt.innerHTML = toolbar + `<div id="mediaListWrap">${contentHtml}</div>`;
}

function setMediaFilter(key, val) {
  mediaFilters[key] = val;
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


