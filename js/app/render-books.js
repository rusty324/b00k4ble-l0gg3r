// render-books.js — the Books tab: cover-image fetch, filters,
// debounced search, the genre filter row, stats bar, the main
// render() and pagination. Split out of app.js; the series-sort
// helper and pagination were relocated here from later in the
// original file, since both are books-tab-only.

// ─── COVER IMAGE FETCH (books only) ───────────────────────────────────
async function fetchCover(book) {
  if (_coverCache[book.id] !== undefined) return _coverCache[book.id];
  _coverCache[book.id] = 'pending';
  try {
    const q = encodeURIComponent((book.title || '').slice(0, 60));
    const a = encodeURIComponent((book.author || '').slice(0, 40));
    const res = await fetch(
      `https://openlibrary.org/search.json?title=${q}&author=${a}&limit=1&fields=cover_i`
    );
    if (!res.ok) throw new Error('network');
    const data = await res.json();
    const coverId = data.docs?.[0]?.cover_i;
    if (coverId) {
      const url = `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
      _coverCache[book.id] = url;
      const i = books.findIndex(b => b.id === book.id);
      if (i !== -1 && !books[i].coverUrl) {
        books[i].coverUrl = url;
        saveSoon();
      }
      return url;
    }
    _coverCache[book.id] = 'none';
    return 'none';
  } catch {
    _coverCache[book.id] = 'none';
    return 'none';
  }
}

let _coverObserver = null;
function getCoverObserver() {
  if (_coverObserver) return _coverObserver;
  _coverObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      _coverObserver.unobserve(entry.target);
      const id = parseInt(entry.target.dataset.bookId, 10);
      const book = books.find(b => b.id === id);
      if (!book) return;
      const isList = entry.target.classList.contains('book-row-initial');
      fetchCover(book).then(url => {
        if (!url || url === 'none' || url === 'pending') return;
        const img = document.createElement('img');
        img.className = isList ? 'book-row-thumb' : 'book-card-cover';
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        if (entry.target.isConnected) entry.target.replaceWith(img);
      });
    });
  }, { rootMargin: '200px' });
  return _coverObserver;
}


// ─── FILTERS (books tab) ──────────────────────────────────────────────
function setFilter(type, val, el) {
  filters[type] = val;
  const groupId = { format: 'formatPills', status: 'statusPills' }[type];
  document.querySelectorAll('#' + groupId + ' .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  currentPage = 1;
  render();
}


// ─── DEBOUNCED SEARCH ─────────────────────────────────────────────────
function debouncedRender() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage = 1;
    render();
  }, 200);
}


// ─── TAG INDEX ────────────────────────────────────────────────────────
function allBookGenres() { return distinctGenres(books); }

// The same multi-select menu the other two tabs use, in place of the single
// -select pill row this tab had — so several genres can be shown at once,
// and a long genre list no longer stretches across the screen.
function renderBookGenreFilter() {
  const host = document.getElementById('bookGenreFilter');
  if (host) host.innerHTML = genreFilterRow('books');
}


// ─── STATS BAR ────────────────────────────────────────────────────────
function renderStats() {
  const total    = books.length;
  const read     = books.filter(b => b.status === 'read').length;
  const physical = books.filter(b => b.formats.includes('physical')).length;
  const ebook    = books.filter(b => b.formats.includes('ebook')).length;
  const audio    = books.filter(b => b.formats.includes('audio')).length;
  const rated    = books.filter(b => b.rating > 0);

  const avg = rated.length
    ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1)
    : '—';

  document.getElementById('statsBar').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">${read} read · ${books.filter(b => b.status === 'reading').length} in progress</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Physical</div>
      <div class="stat-value">${physical}</div>
      <div class="stat-sub">${total ? Math.round(physical / total * 100) : 0}% of library</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">E-books</div>
      <div class="stat-value">${ebook}</div>
      <div class="stat-sub">${total ? Math.round(ebook / total * 100) : 0}% of library</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Audiobooks</div>
      <div class="stat-value">${audio}</div>
      <div class="stat-sub">${total ? Math.round(audio / total * 100) : 0}% of library</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg rating</div>
      <div class="stat-value">${avg}</div>
      <div class="stat-sub">${rated.length} rated</div>
    </div>`;
}


// ─── MAIN RENDER (books tab) ──────────────────────────────────────────
function render() {
  // Stats and tag pills only depend on the books array, not on search/
  // filter/page state — skip the six full-library passes unless it changed.
  if (_statsRenderedAt !== _booksMutation) {
    renderStats();
    renderBookGenreFilter();
    _statsRenderedAt = _booksMutation;
  }

  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  const sort  = document.getElementById('sortSelect').value;

  const key = `${query}|${sort}|${filters.format}|${filters.status}|${filters.genres.join('\u0000')}|${_booksMutation}`;
  if (_filteredCacheKey !== key || _filteredCache === null) {
    // Several genres widen rather than narrow — see GENRE_FILTERS.
    const bookGenreFilter = filters.genres.length
      ? new Set(filters.genres.map(x => x.toLowerCase())) : null;
    const fresh = books.filter(b => {
      if (filters.format !== 'all' && !b.formats.includes(filters.format)) return false;
      if (filters.status !== 'all' && b.status !== filters.status) return false;
      if (bookGenreFilter && !(b.genre || []).some(g => bookGenreFilter.has(g.toLowerCase()))) return false;
      if (query && !b._searchStr.includes(query)) return false;
      return true;
    });

    fresh.sort((a, b) => {
      switch (sort) {
        case 'added-asc':  return a.id - b.id;
        case 'title-asc':  return titleSortKey(a.title).localeCompare(titleSortKey(b.title));
        case 'title-desc': return titleSortKey(b.title).localeCompare(titleSortKey(a.title));
        case 'author-asc': return authorSortKey(a.author).localeCompare(authorSortKey(b.author));
        case 'rating-desc': return (b.rating || 0) - (a.rating || 0);
        case 'series-asc': return seriesSort(a, b);
        default:           return b.id - a.id;
      }
    });

    _filteredCache = fresh;
    _filteredCacheKey = key;
  }
  const filtered = _filteredCache;

  const grid = document.getElementById('booksGrid');
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  if (!filtered.length) {
    grid.className = 'books-grid';
    grid.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      <h3>${books.length === 0 ? 'Your library is empty' : 'No books match your filters'}</h3>
      <p style="font-size:14px">${books.length === 0 ? 'Add a book, import a JSON file, or set up Sync &amp; backup under ⋯ to pull your library from your data repo.' : 'Try adjusting your search or filters.'}</p>
    </div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const page = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const fmtLabels = { physical: '📚 Physical', ebook: '📱 E-book', audio: '🎧 Audiobook' };
  const fmtCls    = { physical: 'badge-physical', ebook: 'badge-ebook', audio: 'badge-audio' };
  const stCls     = { read: 'badge-read', reading: 'badge-reading', want: 'badge-want' };
  const stLabel   = { read: 'Read', reading: 'Reading', want: 'Want to read' };

  let html;
  if (viewMode === 'list') {
    const fmtIcon = { physical: '📚', ebook: '📱', audio: '🎧' };
    html = page.map(b => {
      const firstLetter = esc((b.title || '?')[0].toUpperCase());
      const cachedCover = b.coverUrl || _coverCache[b.id];
      const hasValidCover = cachedCover && cachedCover !== 'none' && cachedCover !== 'pending';
      const thumbHtml = hasValidCover
        ? `<img class="book-row-thumb" src="${esc(cachedCover)}" alt="" loading="lazy">`
        : `<div class="book-row-initial" data-book-id="${b.id}">${firstLetter}</div>`;
      const fmtBadges = b.formats.map(f =>
        `<span class="badge ${fmtCls[f] || ''}" title="${esc(f)}">${fmtIcon[f] || esc(f)}</span>`
      ).join('');
      return `<div class="book-row">
        ${thumbHtml}
        <div class="book-row-content">
          <div class="book-row-title">${esc(b.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${esc(b.author || '')}</div>
            <div class="book-row-badges">${fmtBadges}<span class="badge ${stCls[b.status] || 'badge-want'}">${stLabel[b.status] || esc(b.status)}</span></div>
            <div class="book-row-actions">
              ${renderLinkButtons(b.links, true)}
              <button class="btn btn-sm" onclick="openEditModal(${b.id})" title="Edit">✏</button>
              <button class="btn btn-sm btn-danger" onclick="deleteBook(${b.id})" title="Delete">🗑</button>
            </div>
          </div>
        </div>
      </div>`;
    });
  } else {
    html = page.map(b => {
      const fmtBadges = b.formats.map(f =>
        `<span class="badge ${fmtCls[f] || ''}">${fmtLabels[f] || esc(f)}</span>`).join('');
      const tagBadges = (b.genre || []).map(t =>
        `<span class="badge badge-tag">${esc(t)}</span>`).join('');
      const r = Math.max(0, Math.min(5, b.rating || 0));
      const stars = r > 0
        ? '★'.repeat(r) + `<span class="empty">${'★'.repeat(5 - r)}</span>`
        : '';

      const firstLetter = esc((b.title || '?')[0].toUpperCase());
      const cachedCover = b.coverUrl || _coverCache[b.id];
      const hasValidCover = cachedCover && cachedCover !== 'none' && cachedCover !== 'pending';
      const coverHtml = hasValidCover
        ? `<img class="book-card-cover" src="${esc(cachedCover)}" alt="" loading="lazy">`
        : `<div class="book-card-initial" data-book-id="${b.id}">${firstLetter}</div>`;

      return `<div class="book-card">
        ${coverHtml}
        <div class="book-title">${esc(b.title)}</div>
        ${b.author ? `<div class="book-author">${esc(b.author)}</div>` : ''}
        ${b.series ? `<div class="book-series">📖 ${esc(b.series)}</div>` : ''}
        <div class="book-meta">
          ${fmtBadges}
          <span class="badge ${stCls[b.status] || 'badge-want'}">${stLabel[b.status] || esc(b.status)}</span>
          ${stars ? `<span class="stars">${stars}</span>` : ''}
        </div>
        ${tagBadges ? `<div class="book-tags">${tagBadges}</div>` : ''}
        ${b.notes ? `<div class="book-notes">${esc(b.notes)}</div>` : ''}
        <div class="book-actions">
          ${renderLinkButtons(b.links)}
          <button class="btn btn-sm" onclick="openEditModal(${b.id})">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteBook(${b.id})">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Delete
          </button>
        </div>
      </div>`;
    });
  }

  grid.className = viewMode === 'list' ? 'books-list' : 'books-grid';
  const frag = document.createDocumentFragment();
  const tmp  = document.createElement('div');
  tmp.innerHTML = html.join('');
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);
  grid.innerHTML = '';
  grid.appendChild(frag);

  const obs = getCoverObserver();
  grid.querySelectorAll('[data-book-id]').forEach(el => obs.observe(el));

  renderPagination(filtered.length, totalPages);
}


// ─── SERIES SORT HELPER ────────────────────────────────────────────────
function seriesSort(a, b) {
  function parseSeries(book) {
    if (!book.series) return null;
    const match = book.series.match(/^(.+?)[\s#]+(\d+(?:\.\d+)?)$/);
    if (match) return { name: match[1].trim().toLowerCase(), index: parseFloat(match[2]) };
    return { name: book.series.toLowerCase(), index: 0 };
  }

  const sa = parseSeries(a);
  const sb = parseSeries(b);

  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;

  const nameCmp = sa.name.localeCompare(sb.name);
  if (nameCmp !== 0) return nameCmp;
  return sa.index - sb.index;
}


// ─── PAGINATION ───────────────────────────────────────────────────────
function renderPagination(total, totalPages) {
  const pg = document.getElementById('pagination');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);

  let html = `<span class="page-info">${start}–${end} of ${total}</span>`;
  html += `<button class="btn btn-sm" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹ Prev</button>`;

  const w = 2;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - w && p <= currentPage + w)) {
      html += `<button class="btn btn-sm ${p === currentPage ? 'btn-primary' : ''}" onclick="goPage(${p})">${p}</button>`;
    } else if (p === currentPage - w - 1 || p === currentPage + w + 1) {
      html += `<span class="page-info">…</span>`;
    }
  }

  html += `<button class="btn btn-sm" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next ›</button>`;
  pg.innerHTML = html;
}

function goPage(p) {
  currentPage = Math.max(1, p);
  render();
  document.getElementById('booksGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


