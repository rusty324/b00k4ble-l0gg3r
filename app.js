/*
  ═══════════════════════════════════════════════════════════════════════
  My Library — app.js
  ═══════════════════════════════════════════════════════════════════════
*/

// ─── CONFIGURATION ────────────────────────────────────────────────────
const REPO_JSON_URL          = 'data/books.json';
const REPO_MEDIA_JSON_URL    = 'data/media.json';
const REPO_WISHLIST_JSON_URL = 'data/wishlist.json';
const PAGE_SIZE = 48;


// ─── DATA NORMALIZATION ───────────────────────────────────────────────
function normalizeBook(b) {
  const author = Array.isArray(b.author)
    ? b.author.join(', ')
    : (b.author || '').replace(/[;,\s]+$/, '');

  const status = ({ 'want to read': 'want', 'reading': 'reading', 'read': 'read' }[b.status]
    || b.status
    || 'want');

  const formats = Array.isArray(b.formats) ? b.formats
    : b.formats              ? [b.formats]
    : Array.isArray(b.format) ? b.format
    : b.format               ? [b.format]
    : ['physical'];

  const tags = Array.isArray(b.tags) ? b.tags
    : (b.tags && typeof b.tags === 'string')
      ? b.tags.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  const _searchStr = [b.title || '', author, b.series || '', ...tags].join(' ').toLowerCase();

  return { ...b, author, status, formats, tags, _searchStr };
}

// Normalize wishlist items — adds 'type' (default 'book') and unifies author/creator field
function normalizeWishlistItem(item) {
  return {
    ...item,
    type: item.type || 'book',
    creator: item.creator || item.author || '',
  };
}


// ─── APPLICATION STATE ────────────────────────────────────────────────

// Books library
let books = JSON.parse(localStorage.getItem('myLibrary') || '[]').map(normalizeBook);

// Book filters / pagination
let filters = { format: 'all', status: 'all', tag: 'all' };
let currentPage = 1;
let editingId = null;
let currentRating = 0;
let searchTimer = null;
let viewMode = localStorage.getItem('viewMode') || 'card';

// Performance caches
let _filteredCache = null;
let _filteredCacheKey = '';
let _booksMutation = 0;
const _coverCache = {};

// Tab state
let activeTab = localStorage.getItem('activeTab') || 'books';
// Migrate old tab IDs that no longer exist
if (!['books', 'media', 'wishlist'].includes(activeTab)) activeTab = 'books';

// Book wishlist (combined: books, movies, TV — lightweight scratch-pad)
let bookWishlist = JSON.parse(localStorage.getItem('bookWishlist') || '[]')
  .map(normalizeWishlistItem);
let wishlistEditingId = null;
let wishlistFilters = { type: 'all' };
let wishlistSort = 'title-asc';

// Media library (movies + TV — all statuses)
let mediaLibrary = JSON.parse(localStorage.getItem('mediaLibrary') || '[]')
  .map(m => ({ ...m, status: m.status === 'watching' ? 'watched' : (m.status || 'want') }));
let mediaEditingId = null;
let mediaRating = 0;
let mediaFilters = { type: 'all', status: 'all' };
let mediaSort = 'added-desc';


// ─── PERSISTENCE ──────────────────────────────────────────────────────
function save() {
  _booksMutation++;
  localStorage.setItem('myLibrary', JSON.stringify(books));
}

function saveWishlist() {
  localStorage.setItem('bookWishlist', JSON.stringify(bookWishlist));
}

function saveMedia() {
  localStorage.setItem('mediaLibrary', JSON.stringify(mediaLibrary));
}


// ─── THEME ────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon  = theme === 'dark' ? '☀️' : '🌙';
  const label = theme === 'dark' ? 'Light mode' : 'Dark mode';
  const themeIconEl  = document.getElementById('settingsThemeIcon');
  const themeLabelEl = document.getElementById('settingsThemeLabel');
  if (themeIconEl)  themeIconEl.textContent  = icon;
  if (themeLabelEl) themeLabelEl.textContent = label;
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function toggleView() {
  viewMode = viewMode === 'card' ? 'list' : 'card';
  localStorage.setItem('viewMode', viewMode);
  document.getElementById('viewToggleBtn').textContent = viewMode === 'card' ? '⊞' : '☰';
  renderPage();
}


// ─── SETTINGS DROPDOWN ────────────────────────────────────────────────
function toggleSettingsMenu() {
  const m = document.getElementById('settingsMenu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

function closeSettingsMenu() {
  document.getElementById('settingsMenu').style.display = 'none';
}

document.addEventListener('click', e => {
  const btn = document.getElementById('settingsBtn');
  const menu = document.getElementById('settingsMenu');
  if (btn && menu && !btn.contains(e.target) && !menu.contains(e.target)) {
    closeSettingsMenu();
  }
});


// ─── TAB NAVIGATION ───────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  localStorage.setItem('activeTab', tab);

  document.querySelectorAll('.tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  // View toggle visible on books and media tabs
  document.getElementById('viewToggleBtn').style.display =
    (tab === 'books' || tab === 'media') ? '' : 'none';

  const labels = {
    'books':    'Add book',
    'media':    'Add title',
    'wishlist': 'Add to wishlist'
  };
  document.getElementById('addBtnLabel').textContent = labels[tab] || 'Add';

  // Update export/import button labels to reflect active tab
  const ioLabels = {
    books:    { exp: '⬇ Export library',     imp: '⬆ Import library' },
    media:    { exp: '⬇ Export movies & TV', imp: '⬆ Import movies & TV' },
    wishlist: { exp: '⬇ Export wishlist',    imp: '⬆ Import wishlist' },
  };
  const io = ioLabels[tab] || ioLabels.books;
  const expEl = document.getElementById('settingsExportBtn');
  const impEl = document.getElementById('settingsImportBtn');
  if (expEl) expEl.textContent = io.exp;
  if (impEl) impEl.textContent = io.imp;

  const booksSection = document.getElementById('booksSection');
  const altContent   = document.getElementById('altContent');
  if (booksSection) booksSection.style.display = tab === 'books' ? '' : 'none';
  if (altContent)   altContent.style.display   = tab !== 'books' ? '' : 'none';

  renderPage();
}

function handleAddClick() {
  if (activeTab === 'books')        openAddModal();
  else if (activeTab === 'media')   openMediaModal(null);
  else if (activeTab === 'wishlist') openWishlistModal(null);
}

function renderPage() {
  switch (activeTab) {
    case 'books':    render();          break;
    case 'media':    renderMedia();     break;
    case 'wishlist': renderWishlist();  break;
  }
}


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
        save();
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


// ─── REPO JSON SYNC ───────────────────────────────────────────────────
async function _syncBooks() {
  const res = await fetch(REPO_JSON_URL + '?t=' + Date.now());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const existingIds = new Set(books.map(b => b.id));
  const newItems = data.map(normalizeBook).filter(b => !existingIds.has(b.id));
  if (newItems.length) { books = [...books, ...newItems]; save(); }
  return { added: newItems.length, total: books.length, noun: 'book' };
}

async function _syncMedia() {
  const res = await fetch(REPO_MEDIA_JSON_URL + '?t=' + Date.now());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const existingIds = new Set(mediaLibrary.map(m => m.id));
  const newItems = data
    .map(m => ({ ...m, status: m.status === 'watching' ? 'watched' : (m.status || 'want') }))
    .filter(m => !existingIds.has(m.id));
  if (newItems.length) { mediaLibrary = [...mediaLibrary, ...newItems]; saveMedia(); }
  return { added: newItems.length, total: mediaLibrary.length, noun: 'title' };
}

async function _syncWishlist() {
  const res = await fetch(REPO_WISHLIST_JSON_URL + '?t=' + Date.now());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const existingIds = new Set(bookWishlist.map(w => w.id));
  const newItems = data.map(normalizeWishlistItem).filter(w => !existingIds.has(w.id));
  if (newItems.length) { bookWishlist = [...bookWishlist, ...newItems]; saveWishlist(); }
  return { added: newItems.length, total: bookWishlist.length, noun: 'wishlist item' };
}

async function fetchRepoData() {
  const banner = document.getElementById('statusBanner');
  const results = await Promise.allSettled([_syncBooks(), _syncMedia(), _syncWishlist()]);

  const synced = results
    .filter(r => r.status === 'fulfilled' && r.value.added > 0)
    .map(r => `${r.value.added} new ${r.value.noun}${r.value.added !== 1 ? 's' : ''}`);

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const isEmpty   = books.length === 0 && mediaLibrary.length === 0 && bookWishlist.length === 0;

  if (synced.length) {
    banner.textContent = `✓ Synced ${synced.join(', ')} from repo.`;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 4000);
  } else if (succeeded > 0) {
    const total = results
      .filter(r => r.status === 'fulfilled')
      .reduce((s, r) => s + r.value.total, 0);
    banner.textContent = `✓ All libraries up to date (${total} item${total !== 1 ? 's' : ''}).`;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 4000);
  } else if (isEmpty) {
    banner.textContent = 'Could not reach data files — add items manually or import JSON files.';
    banner.classList.add('visible');
  }

  renderPage();
}


// ─── FILTERS (books tab) ──────────────────────────────────────────────
function setFilter(type, val, el) {
  filters[type] = val;
  const groupId = { format: 'formatPills', status: 'statusPills', tag: 'tagPills' }[type];
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
function allTags() {
  const set = new Set();
  books.forEach(b => (b.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
}

function renderTagFilter() {
  const tags = allTags();
  const row = document.getElementById('tagFilterRow');
  const container = document.getElementById('tagPills');

  if (!tags.length) { row.style.display = 'none'; return; }
  row.style.display = 'flex';

  const current = filters.tag;
  container.innerHTML = [
    `<button class="pill tag-pill ${current === 'all' ? 'active' : ''}" onclick="setFilter('tag','all',this)">All</button>`,
    ...tags.map(t =>
      `<button class="pill tag-pill ${current === t ? 'active' : ''}" onclick="setFilter('tag',${JSON.stringify(t)},this)">${esc(t)}</button>`
    )
  ].join('');
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
  renderStats();
  renderTagFilter();

  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  const sort  = document.getElementById('sortSelect').value;

  const key = `${query}|${sort}|${filters.format}|${filters.status}|${filters.tag}|${_booksMutation}`;
  if (_filteredCacheKey !== key || _filteredCache === null) {
    const fresh = books.filter(b => {
      if (filters.format !== 'all' && !b.formats.includes(filters.format)) return false;
      if (filters.status !== 'all' && b.status !== filters.status) return false;
      if (filters.tag !== 'all' && !(b.tags || []).includes(filters.tag)) return false;
      if (query && !b._searchStr.includes(query)) return false;
      return true;
    });

    fresh.sort((a, b) => {
      switch (sort) {
        case 'added-asc':  return a.id - b.id;
        case 'title-asc':  return a.title.localeCompare(b.title);
        case 'title-desc': return b.title.localeCompare(a.title);
        case 'author-asc': return (a.author || '').localeCompare(b.author || '');
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
      <p style="font-size:14px">${books.length === 0 ? 'Add a book or import a JSON file.' : 'Try adjusting your search or filters.'}</p>
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
        `<span class="badge ${fmtCls[f]}" title="${f}">${fmtIcon[f]}</span>`
      ).join('');
      return `<div class="book-row">
        ${thumbHtml}
        <div class="book-row-content">
          <div class="book-row-title">${esc(b.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${esc(b.author || '')}</div>
            <div class="book-row-badges">${fmtBadges}<span class="badge ${stCls[b.status]}">${stLabel[b.status]}</span></div>
            <div class="book-row-actions">
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
        `<span class="badge ${fmtCls[f]}">${fmtLabels[f]}</span>`).join('');
      const tagBadges = (b.tags || []).map(t =>
        `<span class="badge badge-tag">${esc(t)}</span>`).join('');
      const stars = b.rating
        ? '★'.repeat(b.rating) + `<span class="empty">${'★'.repeat(5 - b.rating)}</span>`
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
          <span class="badge ${stCls[b.status]}">${stLabel[b.status]}</span>
          ${stars ? `<span class="stars">${stars}</span>` : ''}
        </div>
        ${tagBadges ? `<div class="book-tags">${tagBadges}</div>` : ''}
        ${b.notes ? `<div class="book-notes">${esc(b.notes)}</div>` : ''}
        <div class="book-actions">
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


// ─── MEDIA RENDERING (Movies & TV tab) ────────────────────────────────
function renderMedia() {
  const alt = document.getElementById('altContent');

  // Apply filters
  let items = mediaLibrary;
  if (mediaFilters.type !== 'all') items = items.filter(m => m.type === mediaFilters.type);
  if (mediaFilters.status !== 'all') items = items.filter(m => m.status === mediaFilters.status);

  // Sort
  items = [...items].sort((a, b) => {
    switch (mediaSort) {
      case 'title-asc':   return (a.title || '').localeCompare(b.title || '');
      case 'title-desc':  return (b.title || '').localeCompare(a.title || '');
      case 'rating-desc': return (b.rating || 0) - (a.rating || 0);
      case 'added-asc':   return a.id - b.id;
      default:            return b.id - a.id; // added-desc
    }
  });

  const typeIcon  = { movie: '🎬', tv: '📺' };
  const stCls     = { want: 'badge-want', watched: 'badge-watched', watching: 'badge-watching' };
  const stLabel   = { want: 'Want to Watch', watched: 'Watched', watching: 'Watching' };
  const fmtIcons  = { bluray: '📀', dvd: '💿', digital: '💻', streaming: '📡' };

  // Filter toolbar
  const typePills = [['all','All'],['movie','🎬 Movies'],['tv','📺 TV Shows']].map(([v,l]) =>
    `<button class="pill${mediaFilters.type===v?' active':''}" onclick="setMediaFilter('type','${v}')">${l}</button>`
  ).join('');
  const statusPills = [['all','All'],['want','Want to Watch'],['watched','Watched']].map(([v,l]) =>
    `<button class="pill${mediaFilters.status===v?' active':''}" onclick="setMediaFilter('status','${v}')">${l}</button>`
  ).join('');
  const sortSelect = `<select class="sort-select" onchange="setMediaSort(this.value)">
    <option value="added-desc"${mediaSort==='added-desc'?' selected':''}>Newest added</option>
    <option value="added-asc"${mediaSort==='added-asc'?' selected':''}>Oldest added</option>
    <option value="title-asc"${mediaSort==='title-asc'?' selected':''}>Title A–Z</option>
    <option value="title-desc"${mediaSort==='title-desc'?' selected':''}>Title Z–A</option>
    <option value="rating-desc"${mediaSort==='rating-desc'?' selected':''}>Rating ↓</option>
  </select>`;

  const toolbar = `<div style="margin-bottom:1rem">
    <div class="filter-row">
      <span class="filter-label">Type</span>
      <div class="pill-group">${typePills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Status</span>
      <div class="pill-group">${statusPills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      ${sortSelect}
    </div>
  </div>`;

  if (!items.length) {
    alt.innerHTML = toolbar + `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 3l-4 4-4-4"/>
      </svg>
      <h3>Nothing here yet</h3>
      <p style="font-size:14px">Click "Add title" to track movies and TV shows.</p>
    </div>`;
    return;
  }

  let contentHtml;
  if (viewMode === 'list') {
    const rows = items.map(m => {
      const icon    = typeIcon[m.type] || '🎬';
      const formats = (m.formats || []).map(f => fmtIcons[f] || '').join(' ');
      const stars   = m.rating
        ? `<span class="stars">${'★'.repeat(m.rating)}<span class="empty">${'★'.repeat(5-m.rating)}</span></span>`
        : '';
      return `<div class="book-row">
        <div class="book-row-initial" style="font-size:18px;background:none;color:var(--text)">${icon}</div>
        <div class="book-row-content">
          <div class="book-row-title">${esc(m.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${m.year ? esc(String(m.year)) : ''}</div>
            <div class="book-row-badges">
              <span class="badge ${stCls[m.status] || 'badge-want'}">${stLabel[m.status] || m.status}</span>
              ${formats ? `<span class="badge badge-media">${formats}</span>` : ''}
            </div>
            <div class="book-row-actions">
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
      const genreTags = (m.genre || []).map(g =>
        `<span class="badge badge-tag">${esc(g)}</span>`).join('');
      const fmtBadges = (m.formats || []).map(f =>
        `<span class="badge badge-media" title="${f}">${fmtIcons[f] || f}</span>`).join('');
      const stars = m.rating
        ? `<span class="stars">${'★'.repeat(m.rating)}<span class="empty">${'★'.repeat(5-m.rating)}</span></span>`
        : '';
      return `<div class="book-card">
        <div class="media-card-placeholder">${icon}</div>
        <div class="book-title">${esc(m.title)}</div>
        ${m.year ? `<div class="book-author">${esc(String(m.year))}</div>` : ''}
        <div class="book-meta">
          <span class="badge ${stCls[m.status] || 'badge-want'}">${stLabel[m.status] || m.status}</span>
          ${fmtBadges}
          ${stars}
        </div>
        ${genreTags ? `<div class="book-tags">${genreTags}</div>` : ''}
        ${m.notes ? `<div class="book-notes">${esc(m.notes)}</div>` : ''}
        <div class="book-actions">
          <button class="btn btn-sm" onclick="openMediaModal(${m.id})">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteMediaItem(${m.id})">
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
    }).join('');
    contentHtml = `<div class="books-grid">${cards}</div>`;
  }

  alt.innerHTML = toolbar + contentHtml;
}

function setMediaFilter(key, val) {
  mediaFilters[key] = val;
  renderMedia();
}

function setMediaSort(val) {
  mediaSort = val;
  renderMedia();
}


// ─── WISHLIST RENDERING ───────────────────────────────────────────────
function renderWishlist() {
  const alt = document.getElementById('altContent');
  const typeIcon = { book: '📚', movie: '🎬', tv: '📺' };

  // Apply filters
  let items = bookWishlist;
  if (wishlistFilters.type !== 'all') items = items.filter(w => w.type === wishlistFilters.type);

  // Sort
  items = [...items].sort((a, b) => {
    switch (wishlistSort) {
      case 'title-desc':  return (b.title || '').localeCompare(a.title || '');
      case 'added-desc':  return b.id - a.id;
      case 'added-asc':   return a.id - b.id;
      default:            return (a.title || '').localeCompare(b.title || ''); // title-asc
    }
  });

  // Filter toolbar
  const typePills = [['all','All'],['book','📚 Books'],['movie','🎬 Movies'],['tv','📺 TV Shows']].map(([v,l]) =>
    `<button class="pill${wishlistFilters.type===v?' active':''}" onclick="setWishlistFilter('type','${v}')">${l}</button>`
  ).join('');
  const sortSelect = `<select class="sort-select" onchange="setWishlistSort(this.value)">
    <option value="title-asc"${wishlistSort==='title-asc'?' selected':''}>Title A–Z</option>
    <option value="title-desc"${wishlistSort==='title-desc'?' selected':''}>Title Z–A</option>
    <option value="added-desc"${wishlistSort==='added-desc'?' selected':''}>Newest added</option>
    <option value="added-asc"${wishlistSort==='added-asc'?' selected':''}>Oldest added</option>
  </select>`;

  const toolbar = `<div style="margin-bottom:1rem">
    <div class="filter-row">
      <span class="filter-label">Type</span>
      <div class="pill-group">${typePills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      ${sortSelect}
    </div>
  </div>`;

  if (!items.length) {
    const typeLabel = { book: 'books', movie: 'movies', tv: 'TV shows' }[wishlistFilters.type] || 'items';
    const heading = wishlistFilters.type === 'all' ? 'Your wishlist is empty' : `No ${typeLabel} in your wishlist`;
    alt.innerHTML = toolbar + `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      <h3>${heading}</h3>
      <p style="font-size:14px">Click "Add to wishlist" to track things you want to read or watch.</p>
    </div>`;
    return;
  }

  const rows = items.map(item => {
    const icon = typeIcon[item.type] || '📚';
    return `<div class="book-row">
      <div class="book-row-initial" style="font-size:18px;background:none;color:var(--text)">${icon}</div>
      <div class="book-row-content">
        <div class="book-row-title">${esc(item.title)}</div>
        <div class="book-row-meta">
          <div class="book-row-author">${esc(item.creator || '')}</div>
          <div class="book-row-actions">
            <button class="btn btn-sm" onclick="openWishlistModal(${item.id})" title="Edit">✏</button>
            <button class="btn btn-sm btn-danger" onclick="deleteWishlistItem(${item.id})" title="Delete">🗑</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  alt.innerHTML = toolbar + `<div class="books-list">${rows}</div>`;
}

function setWishlistFilter(key, val) {
  wishlistFilters[key] = val;
  renderWishlist();
}

function setWishlistSort(val) {
  wishlistSort = val;
  renderWishlist();
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
  currentPage = p;
  render();
  document.getElementById('booksGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ─── HTML ESCAPE ─────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ─── MODAL HELPERS ────────────────────────────────────────────────────
function setFormats(vals) {
  document.querySelectorAll('#f-format-group input[type="checkbox"]').forEach(cb => {
    cb.checked = vals.includes(cb.value);
    cb.closest('.radio-btn').classList.toggle('active', cb.checked);
  });
}

function setRadio(name, val) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
    r.checked = r.value === val;
    r.closest('.radio-btn').classList.toggle('active', r.value === val);
  });
}

// Sync radio active class on change — covers all modals
document.querySelectorAll('.radio-btn input[type="radio"]').forEach(r => {
  r.addEventListener('change', function() {
    this.closest('.radio-group').querySelectorAll('.radio-btn').forEach(l => l.classList.remove('active'));
    this.closest('.radio-btn').classList.add('active');
  });
});

// Sync book format checkbox styling
document.querySelectorAll('#f-format-group input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', function() {
    this.closest('.radio-btn').classList.toggle('active', this.checked);
  });
});

// Sync media format checkbox styling
document.querySelectorAll('#m-format-group input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', function() {
    this.closest('.radio-btn').classList.toggle('active', this.checked);
  });
});


// ─── DATALISTS (author & series autocomplete) ─────────────────────────
function populateDataLists() {
  const authors = [...new Set(books.map(b => b.author).filter(Boolean))].sort();
  document.getElementById('dl-authors').innerHTML =
    authors.map(a => `<option value="${esc(a)}">`).join('');

  const seriesNames = [...new Set(
    books.map(b => {
      if (!b.series) return null;
      const m = b.series.match(/^(.+?)[\s#]+\d+(?:\.\d+)?$/);
      return m ? m[1].trim() : b.series;
    }).filter(Boolean)
  )].sort();

  document.getElementById('dl-series').innerHTML =
    seriesNames.map(s => `<option value="${esc(s)}">`).join('');
}


// ─── TAGS AUTOCOMPLETE ────────────────────────────────────────────────
let tagsACIndex = -1;

function tagsAC() {
  const input = document.getElementById('f-tags');
  const ac    = document.getElementById('tags-ac');

  const parts = input.value.split(',');
  const query = parts[parts.length - 1].trim().toLowerCase();

  if (!query) { closeTagsAC(); return; }

  const existing = new Set(parts.slice(0, -1).map(t => t.trim().toLowerCase()));
  const matches = allTags().filter(t =>
    t.toLowerCase().includes(query) && !existing.has(t.toLowerCase())
  );

  if (!matches.length) { closeTagsAC(); return; }

  tagsACIndex = -1;
  ac.innerHTML = matches
    .map(t => `<div class="ac-item" data-val="${esc(t)}" onmousedown="pickTag('${esc(t)}')">${esc(t)}</div>`)
    .join('');
  ac.style.display = 'block';
}

function tagsACKey(e) {
  const ac    = document.getElementById('tags-ac');
  const items = ac.querySelectorAll('.ac-item');

  if (!items.length || ac.style.display === 'none') return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    tagsACIndex = Math.min(tagsACIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('ac-active', i === tagsACIndex));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    tagsACIndex = Math.max(tagsACIndex - 1, 0);
    items.forEach((el, i) => el.classList.toggle('ac-active', i === tagsACIndex));
  } else if (e.key === 'Enter' && tagsACIndex >= 0) {
    e.preventDefault();
    pickTag(items[tagsACIndex].dataset.val);
  } else if (e.key === 'Escape') {
    closeTagsAC();
  }
}

function pickTag(tag) {
  const input = document.getElementById('f-tags');
  const parts = input.value.split(',');
  parts[parts.length - 1] = ' ' + tag;
  input.value = parts.join(',').replace(/^,\s*/, '') + ', ';
  input.focus();
  closeTagsAC();
}

function closeTagsAC() {
  document.getElementById('tags-ac').style.display = 'none';
  tagsACIndex = -1;
}


// ─── BOOK MODAL ───────────────────────────────────────────────────────
function openAddModal() {
  editingId     = null;
  currentRating = 0;
  document.getElementById('modalTitle').textContent = 'Add a book';

  ['f-title', 'f-author', 'f-series', 'f-seriesIndex', 'f-tags', 'f-notes', 'f-coverUrl'].forEach(id =>
    document.getElementById(id).value = ''
  );

  setFormats(['physical']);
  setRadio('status', 'want');
  updateStars(0);
  document.getElementById('fmt-error').style.display = 'none';
  populateDataLists();
  document.getElementById('modal').classList.add('open');
  document.getElementById('f-title').focus();
}

function openEditModal(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;

  editingId     = id;
  currentRating = b.rating || 0;

  document.getElementById('modalTitle').textContent = 'Edit book';
  document.getElementById('f-title').value  = b.title;
  document.getElementById('f-author').value = b.author || '';
  const sm = (b.series || '').match(/^(.+?)[\s#]+(\d+(?:\.\d+)?)$/);
  document.getElementById('f-series').value      = sm ? sm[1].trim() : (b.series || '');
  document.getElementById('f-seriesIndex').value = sm ? sm[2] : '';
  document.getElementById('f-tags').value   = (b.tags || []).join(', ');
  document.getElementById('f-notes').value  = b.notes || '';
  document.getElementById('f-coverUrl').value = b.coverUrl || '';

  setFormats(b.formats || ['physical']);
  setRadio('status', b.status);
  updateStars(currentRating);
  document.getElementById('fmt-error').style.display = 'none';
  populateDataLists();
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

function handleBackdropClick(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

// ─── STAR RATING (book modal) ─────────────────────────────────────────
function setRating(val) {
  currentRating = (currentRating === val) ? 0 : val;
  updateStars(currentRating);
}

function updateStars(val) {
  document.querySelectorAll('#modal .star-btn').forEach(btn => {
    btn.classList.toggle('lit', parseInt(btn.dataset.val) <= val);
  });
}

// ─── STAR RATING (media modal) ────────────────────────────────────────
function setMediaRating(val) {
  mediaRating = (mediaRating === val) ? 0 : val;
  updateMediaStars(mediaRating);
}

function updateMediaStars(val) {
  document.querySelectorAll('#mediaModal .star-btn').forEach(btn => {
    btn.classList.toggle('lit', parseInt(btn.dataset.val) <= val);
  });
}


// ─── BOOK SAVE / DELETE ────────────────────────────────────────────────
function saveBook() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }

  const author     = document.getElementById('f-author').value.trim();
  const seriesName = document.getElementById('f-series').value.trim();
  const seriesIdx  = document.getElementById('f-seriesIndex').value.trim();
  const series     = seriesName && seriesIdx ? `${seriesName} #${seriesIdx}` : seriesName;
  const coverUrl   = document.getElementById('f-coverUrl').value.trim();

  const tags = document.getElementById('f-tags').value
    .split(',').map(t => t.trim()).filter(Boolean);

  const formats = [...document.querySelectorAll('#f-format-group input[type="checkbox"]:checked')]
    .map(cb => cb.value);

  if (!formats.length) {
    document.getElementById('fmt-error').style.display = 'block';
    return;
  }
  document.getElementById('fmt-error').style.display = 'none';

  const status = document.querySelector('input[name="status"]:checked').value;
  const notes  = document.getElementById('f-notes').value.trim();

  if (editingId !== null) {
    const i = books.findIndex(b => b.id === editingId);
    if (i !== -1) {
      books[i] = normalizeBook({ ...books[i], title, author, series, tags, formats, status, notes, rating: currentRating, coverUrl });
    }
  } else {
    books.push(normalizeBook({ id: Date.now(), title, author, series, tags, formats, status, notes, rating: currentRating, coverUrl }));
  }

  save();
  closeModal();
  render();
}

function deleteBook(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  if (!confirm(`Delete "${b.title}"?`)) return;
  books = books.filter(x => x.id !== id);
  save();
  render();
}


// ─── WISHLIST MODAL ───────────────────────────────────────────────────
function openWishlistModal(id) {
  if (id !== null) {
    const item = bookWishlist.find(x => x.id === id);
    if (!item) return;
    wishlistEditingId = id;
    document.getElementById('wishlistModalTitle').textContent = 'Edit wishlist item';
    document.getElementById('wl-title').value  = item.title   || '';
    document.getElementById('wl-author').value = item.creator || '';
    document.getElementById('wl-notes').value  = item.notes   || '';
    setRadio('wl-type', item.type || 'book');
  } else {
    wishlistEditingId = null;
    document.getElementById('wishlistModalTitle').textContent = 'Add to wishlist';
    ['wl-title', 'wl-author', 'wl-notes'].forEach(fid => document.getElementById(fid).value = '');
    // Pre-select type based on active filter (if not 'all')
    const defaultType = (wishlistFilters.type !== 'all') ? wishlistFilters.type : 'book';
    setRadio('wl-type', defaultType);
  }
  document.getElementById('wishlistModal').classList.add('open');
  document.getElementById('wl-title').focus();
}

function closeWishlistModal() {
  document.getElementById('wishlistModal').classList.remove('open');
}

function handleWishlistBackdrop(e) {
  if (e.target === document.getElementById('wishlistModal')) closeWishlistModal();
}

function saveWishlistItem() {
  const title = document.getElementById('wl-title').value.trim();
  if (!title) { document.getElementById('wl-title').focus(); return; }

  const type    = document.querySelector('input[name="wl-type"]:checked')?.value || 'book';
  const creator = document.getElementById('wl-author').value.trim();
  const notes   = document.getElementById('wl-notes').value.trim();

  if (wishlistEditingId !== null) {
    const i = bookWishlist.findIndex(x => x.id === wishlistEditingId);
    if (i !== -1) bookWishlist[i] = { ...bookWishlist[i], type, title, creator, notes };
  } else {
    bookWishlist.push({ id: Date.now(), type, title, creator, notes });
  }

  saveWishlist();
  closeWishlistModal();
  renderWishlist();
}

function deleteWishlistItem(id) {
  const item = bookWishlist.find(x => x.id === id);
  if (!item) return;
  if (!confirm(`Remove "${item.title}" from wishlist?`)) return;
  bookWishlist = bookWishlist.filter(x => x.id !== id);
  saveWishlist();
  renderWishlist();
}


// ─── MEDIA MODAL ─────────────────────────────────────────────────────
function setMediaRadio(name, val) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
    r.checked = r.value === val;
    r.closest('.radio-btn').classList.toggle('active', r.value === val);
  });
}

function setMediaFormats(vals) {
  document.querySelectorAll('#m-format-group input[type="checkbox"]').forEach(cb => {
    cb.checked = vals.includes(cb.value);
    cb.closest('.radio-btn').classList.toggle('active', cb.checked);
  });
}

function openMediaModal(id) {
  if (id !== null && id !== undefined) {
    const m = mediaLibrary.find(x => x.id === id);
    if (!m) return;
    mediaEditingId = id;
    mediaRating    = m.rating || 0;
    document.getElementById('mediaModalTitle').textContent = 'Edit title';
    document.getElementById('m-title').value = m.title || '';
    document.getElementById('m-year').value  = m.year  || '';
    document.getElementById('m-genre').value = (m.genre || []).join(', ');
    document.getElementById('m-notes').value = m.notes || '';
    setMediaRadio('m-type',   m.type   || 'movie');
    setMediaRadio('m-status', m.status || 'want');
    setMediaFormats(m.formats || []);
    updateMediaStars(mediaRating);
  } else {
    mediaEditingId = null;
    mediaRating    = 0;
    document.getElementById('mediaModalTitle').textContent = 'Add title';
    ['m-title', 'm-year', 'm-genre', 'm-notes'].forEach(fid => document.getElementById(fid).value = '');
    setMediaFormats([]);
    updateMediaStars(0);
    setMediaRadio('m-type',   'movie');
    setMediaRadio('m-status', 'want');
  }
  document.getElementById('mediaModal').classList.add('open');
  document.getElementById('m-title').focus();
}

function closeMediaModal() {
  document.getElementById('mediaModal').classList.remove('open');
}

function handleMediaBackdrop(e) {
  if (e.target === document.getElementById('mediaModal')) closeMediaModal();
}

function saveMediaItem() {
  const title = document.getElementById('m-title').value.trim();
  if (!title) { document.getElementById('m-title').focus(); return; }

  const year    = document.getElementById('m-year').value.trim();
  const genre   = document.getElementById('m-genre').value.split(',').map(g => g.trim()).filter(Boolean);
  const notes   = document.getElementById('m-notes').value.trim();
  const type    = document.querySelector('input[name="m-type"]:checked')?.value   || 'movie';
  const status  = document.querySelector('input[name="m-status"]:checked')?.value || 'want';
  const formats = [...document.querySelectorAll('#m-format-group input[type="checkbox"]:checked')]
    .map(cb => cb.value);

  if (mediaEditingId !== null) {
    const i = mediaLibrary.findIndex(x => x.id === mediaEditingId);
    if (i !== -1) {
      mediaLibrary[i] = { ...mediaLibrary[i], title, type, year, genre, formats, status, notes, rating: mediaRating };
    }
  } else {
    mediaLibrary.push({ id: Date.now(), title, type, year, genre, formats, status, notes, rating: mediaRating });
  }

  saveMedia();
  closeMediaModal();
  renderPage();
}

function deleteMediaItem(id) {
  const m = mediaLibrary.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Delete "${m.title}"?`)) return;
  mediaLibrary = mediaLibrary.filter(x => x.id !== id);
  saveMedia();
  renderPage();
}


// ─── IMPORT / EXPORT ─────────────────────────────────────────────────
function exportData() {
  let data, filename;
  if (activeTab === 'media') {
    data = mediaLibrary; filename = 'my-media-library.json';
  } else if (activeTab === 'wishlist') {
    data = bookWishlist; filename = 'my-wishlist.json';
  } else {
    data = books; filename = 'my-library.json';
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('Expected a JSON array');

      if (activeTab === 'media') {
        if (!confirm(`Import ${data.length} media items? Duplicates (by ID) will be skipped.`)) return;
        const existingIds = new Set(mediaLibrary.map(m => m.id));
        const newItems = data
          .filter(m => !existingIds.has(m.id))
          .map(m => ({ ...m, status: m.status === 'watching' ? 'watched' : (m.status || 'want') }));
        mediaLibrary = [...mediaLibrary, ...newItems];
        saveMedia();
        renderPage();
        alert(`Imported ${newItems.length} new titles (${data.length - newItems.length} duplicates skipped).`);
      } else if (activeTab === 'wishlist') {
        if (!confirm(`Import ${data.length} wishlist items? Duplicates (by ID) will be skipped.`)) return;
        const existingIds = new Set(bookWishlist.map(w => w.id));
        const newItems = data
          .filter(w => !existingIds.has(w.id))
          .map(normalizeWishlistItem);
        bookWishlist = [...bookWishlist, ...newItems];
        saveWishlist();
        renderPage();
        alert(`Imported ${newItems.length} new items (${data.length - newItems.length} duplicates skipped).`);
      } else {
        if (!confirm(`Import ${data.length} books? Duplicates (by ID) will be skipped.`)) return;
        const existingIds = new Set(books.map(b => b.id));
        const newBooks = data
          .filter(b => !existingIds.has(b.id))
          .map(normalizeBook);
        books = [...books, ...newBooks];
        save();
        renderPage();
        alert(`Imported ${newBooks.length} new books (${data.length - newBooks.length} duplicates skipped).`);
      }

    } catch (err) {
      alert('Failed to import: ' + err.message);
    }
  };

  reader.readAsText(file);
  e.target.value = '';
}


// ─── INIT ─────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('theme') || 'light');
document.getElementById('viewToggleBtn').textContent = viewMode === 'card' ? '⊞' : '☰';
switchTab(activeTab);
fetchRepoData();
