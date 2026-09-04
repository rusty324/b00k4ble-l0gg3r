// render-wishlist.js — the Wishlist tab's render, filter, sort
// and search. Split out of app.js.

// ─── WISHLIST RENDERING ───────────────────────────────────────────────
// listOnly: replace just the results container, leaving the toolbar (and
// the focused search input inside it) intact — used by the search path.
function renderWishlist(listOnly = false) {
  const alt = document.getElementById('altContent');
  const typeIcon = { book: '📚', movie: '🎬', tv: '📺', game: '🎮' };

  // Apply filters
  let items = bookWishlist;
  if (wishlistFilters.type !== 'all') items = items.filter(w => w.type === wishlistFilters.type);
  if (wishlistSearch.trim()) {
    const q = wishlistSearch.toLowerCase().trim();
    items = items.filter(w =>
      (w.title || '').toLowerCase().includes(q) ||
      (w.creator || '').toLowerCase().includes(q) ||
      (w.notes || '').toLowerCase().includes(q)
    );
  }

  // Sort
  items = [...items].sort((a, b) => {
    switch (wishlistSort) {
      case 'title-desc':  return titleSortKey(b.title).localeCompare(titleSortKey(a.title));
      case 'added-desc':  return b.id - a.id;
      case 'added-asc':   return a.id - b.id;
      default:            return titleSortKey(a.title).localeCompare(titleSortKey(b.title)); // title-asc
    }
  });

  // Filter toolbar
  const typePills = [['all','All'],['book','📚 Books'],['movie','🎬 Movies'],
                     ['tv','📺 TV Shows'],['game','🎮 Games']].map(([v,l]) =>
    `<button class="pill${wishlistFilters.type===v?' active':''}" onclick="setWishlistFilter('type','${v}')">${l}</button>`
  ).join('');
  const sortSelect = `<select class="sort-select" aria-label="Sort wishlist" onchange="setWishlistSort(this.value)">
    <option value="title-asc"${wishlistSort==='title-asc'?' selected':''}>Title A–Z</option>
    <option value="title-desc"${wishlistSort==='title-desc'?' selected':''}>Title Z–A</option>
    <option value="added-desc"${wishlistSort==='added-desc'?' selected':''}>Newest added</option>
    <option value="added-asc"${wishlistSort==='added-asc'?' selected':''}>Oldest added</option>
  </select>`;

  const toolbar = `<div style="margin-bottom:1rem">
    <div class="search-wrap" style="margin-bottom:0.6rem">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" id="wishlistSearchInput" placeholder="Search title, author, or notes…" aria-label="Search wishlist" value="${esc(wishlistSearch)}" oninput="debouncedWishlistRender(this.value)">
    </div>
    <div class="filter-row">
      <span class="filter-label">Type</span>
      <div class="pill-group">${typePills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      ${sortSelect}
    </div>
  </div>`;

  let contentHtml;
  if (!items.length) {
    let heading, subtext;
    if (wishlistSearch.trim()) {
      heading = 'No results';
      subtext = 'Try a different search term or clear the search.';
    } else {
      const typeLabel = { book: 'books', movie: 'movies', tv: 'TV shows', game: 'games' }[wishlistFilters.type] || 'items';
      heading = wishlistFilters.type === 'all' ? 'Your wishlist is empty' : `No ${typeLabel} in your wishlist`;
      subtext = 'Click "Add to wishlist" to track things you want to read or watch.';
    }
    contentHtml = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      <h3>${heading}</h3>
      <p style="font-size:14px">${subtext}</p>
    </div>`;
  } else {
    const rows = items.map(item => {
      const icon = typeIcon[item.type] || '📚';
      return `<div class="book-row">
        <div class="book-row-initial" style="font-size:18px;background:none;color:var(--text)">${icon}</div>
        <div class="book-row-content">
          <div class="book-row-title">${esc(item.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${esc(item.creator || '')}</div>
            <div class="book-row-actions">
              <!-- Not compact: the wishlist has no card view, so a second
                   link would otherwise be reachable only by editing. -->
              ${renderLinkButtons(item.links)}
              <button class="btn btn-sm" onclick="openWishlistModal(${item.id})" title="Edit">✏</button>
              <button class="btn btn-sm btn-danger" onclick="deleteWishlistItem(${item.id})" title="Delete">🗑</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    contentHtml = `<div class="books-list">${rows}</div>`;
  }

  const wrap = document.getElementById('wishlistListWrap');
  if (listOnly && wrap) {
    wrap.innerHTML = contentHtml;
    return;
  }
  alt.innerHTML = toolbar + `<div id="wishlistListWrap">${contentHtml}</div>`;
}

function setWishlistFilter(key, val) {
  wishlistFilters[key] = val;
  renderWishlist();
}

function setWishlistSort(val) {
  wishlistSort = val;
  renderWishlist();
}

function debouncedWishlistRender(val) {
  wishlistSearch = val;
  clearTimeout(wishlistSearchTimer);
  // Guard on activeTab: a timer firing after a tab switch would otherwise
  // paint wishlist content into the pane the new tab just rendered.
  wishlistSearchTimer = setTimeout(() => { if (activeTab === 'wishlist') renderWishlist(true); }, 200);
}


