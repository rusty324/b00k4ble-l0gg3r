// render-games.js — the Games tab's render, filters, sort and
// search, plus the shared multi-select genre filter menu (used by
// the Books and Movies & TV tabs too — it lives here because this is
// where it was first built). Split out of app.js.

// ─── GAMES RENDERING (Video Games tab) ─────────────────────────────────
// No lookup API is wired up here — RAWG, IGDB, Giant Bomb and Steam's own
// endpoints all decline browser CORS, so every field below is typed by
// hand rather than searched, unlike the books/media tabs.
// GAME_PLATFORMS, GAME_PLATFORM_LABEL, platformLabel, GAME_FORMAT_ICON and
// GAME_FORMAT_LABEL all live in core.js, next to the normalizer that decides
// which combinations are legal.

// "PC · PS5" — the platforms alone, for the line under a title.
const gamePlatformText = g =>
  platformsOf(g).map(p => platformLabel(p.platform)).join(' · ');

// Compact badges from the copies: "PC · Steam", "PS4 · Physical", with
// "via <launcher>" when a PC copy opens elsewhere and "×2" for repeats.
// At most three, then "+N".
function gamePlatformBadges(g) {
  const copies = g.copies || [];
  if (!copies.length) return '<span class="badge badge-platform">Unknown platform</span>';
  const groups = new Map();
  for (const c of copies) {
    const key = gameCopyLine({ ...c, edition: '' });
    if (!groups.has(key)) groups.set(key, { c, n: 0 });
    groups.get(key).n++;
  }
  const list = [...groups].map(([label, { c, n }]) => {
    const fmt = c.format === 'subscription' && PS_PLATFORMS.has(c.platform) ? 'ps-plus' : c.format;
    const icon = fmt ? gameFormatIcon(fmt) : '';
    return `<span class="badge badge-platform" title="${esc(label)}">${esc(label)}${n > 1 ? ` ×${n}` : ''}${icon ? ' ' + icon : ''}</span>`;
  });
  return list.slice(0, 3).join('') + (list.length > 3 ? `<span class="badge badge-platform">+${list.length - 3}</span>` : '');
}

// "DLC 2/3" when some are only wanted, plain "DLC 3" when every one is owned —
// the fraction only earns its place when it is not 3/3. The title spells the
// names out for anyone hovering.
function gameDlcBadge(g) {
  const dlc = g.dlc || [];
  if (!dlc.length) return '';
  const owned = dlc.filter(d => d.owned).length;
  const label = owned === dlc.length ? `DLC ${dlc.length}` : `DLC ${owned}/${dlc.length}`;
  const names = dlc.map(d => d.name + (d.owned ? '' : ' (wishlist)')).join(', ');
  return `<span class="badge badge-dlc" title="${esc(names)}">${label}</span>`;
}

// The poster of a short horizontal card (Movies & TV, Games): the image,
// which a tap opens full size (it keeps .book-card-cover for that), or a
// coloured tile with the title's initials. size: hcard-media | hcard-game.
const HCARD_TILES = ['#1F4E79', '#8B3A2B', '#3B3B58', '#2F4F3E', '#4A2C4A', '#2E6B8A', '#5C4A1E', '#3A2A2A', '#1D3B4F', '#6B2F2F'];
function hcardPoster(url, title, size) {
  if (url) return `<img class="book-card-cover hcard-cover ${size}" src="${esc(url)}" alt="" loading="lazy">`;
  let h = 0; for (const c of String(title || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ini = String(title || '').replace(/^(the|a|an)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  return `<span class="hcard-cover hcard-tile ${size}" aria-hidden="true" style="background:${HCARD_TILES[h % HCARD_TILES.length]}">${esc(ini)}</span>`;
}

// What the search box matches against (shared with the filters sheet's counts).
const gameSearchText = g => [g.title, gamePlatformText(g),
  ...(g.copies || []).flatMap(c => [c.store && storeLabel(c.store), c.opensIn && storeLabel(c.opensIn), c.edition, c.set]).filter(Boolean),
  ...(g.dlc || []).map(d => d.name), g.year, ...(g.genre || [])].join(' ');

// listOnly: replace just the results container, leaving the toolbar (and
// the focused search input inside it) intact — used by the search path.
function renderGames(listOnly = false) {
  const alt = document.getElementById('altContent');

  // Apply filters
  let items = videoGames;
  // A game can be on several platforms, so these are both "has one like
  // this", not "is this".
  // Each row: any shown value, and none of the hidden (core.js facetPasses).
  items = items.filter(g => facetPasses(gameFilters.platform, v => platformsOf(g).some(p => p.platform === v)) &&
    facetPasses(gameFilters.store, v => gameHasPcStore(g, v)) &&
    facetPasses(gameFilters.status, v => g.status === v) &&
    facetPasses(gameFilters.format, v => platformsOf(g).some(p => p.formats.includes(v))) &&
    facetPasses(gameFilters.genres, v => hasGenre(g, v)));
  if (gameSearch.trim()) items = items.filter(g => matchesAll(gameSearchText(g), gameSearch));

  // Sort
  items = [...items].sort((a, b) => {
    switch (gameSort) {
      case 'title-asc':   return titleSortKey(a.title).localeCompare(titleSortKey(b.title));
      case 'title-desc':  return titleSortKey(b.title).localeCompare(titleSortKey(a.title));
      case 'rating-desc': return (b.rating || 0) - (a.rating || 0);
      case 'added-asc':   return a.id - b.id;
      default:            return b.id - a.id; // added-desc
    }
  });
  _shownIds.games = items.map(g => g.id);   // what bulk edit's "Select all" means


  // Filter toolbar
  const platformPills = facetPills(gameFilters.platform, knownGamePlatforms().map(p => [p, esc(platformLabel(p))]), "setGameFilter('platform', ");
  // Only while PC is shown: which store or launcher, from the stores in use.
  const pcStores = gameFilters.platform.in.includes('pc') ? pcStoresInUse() : [];
  const storeRow = pcStores.length ? `<div class="filter-row facet-row">
      <span class="filter-label">Store</span>
      <div class="pill-group">${facetPills(gameFilters.store, pcStores.map(k => [k, esc(storeLabel(k))]), "setGameFilter('store', ")}</div>
    </div>` : '';
  const statusPills = facetPills(gameFilters.status, statusPairs('games'), "setGameFilter('status', ");
  const formatPills = facetPills(gameFilters.format, GAME_FORMATS.map(f => [f, `${gameFormatIcon(f)} ${esc(GAME_FORMAT_LABEL[f])}`]), "setGameFilter('format', ");
  const genreRow = genreFilterRow('games');

  const sortSelect = `<select class="sort-select" aria-label="Sort video games" onchange="setGameSort(this.value)">
    <option value="added-desc"${gameSort==='added-desc'?' selected':''}>Newest added</option>
    <option value="added-asc"${gameSort==='added-asc'?' selected':''}>Oldest added</option>
    <option value="title-asc"${gameSort==='title-asc'?' selected':''}>Title A–Z</option>
    <option value="title-desc"${gameSort==='title-desc'?' selected':''}>Title Z–A</option>
    <option value="rating-desc"${gameSort==='rating-desc'?' selected':''}>Rating ↓</option>
  </select>`;

  const toolbar = `<div style="margin-bottom:1rem">
    <div class="search-wrap" style="margin-bottom:0.6rem">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" id="gameSearchInput" placeholder="Search title, platform, DLC, year, or genre…" aria-label="Search video games" value="${esc(gameSearch)}" oninput="debouncedGameRender(this.value)">
      <button type="button" class="search-clear" aria-label="Clear search" onclick="clearSearch(this)">&times;</button>
    </div>
    <div class="filter-row facet-row">
      <span class="filter-label">Platform</span>
      <div class="pill-group">${platformPills}</div>
    </div>
    ${storeRow}
    <div class="filter-row facet-row">
      <span class="filter-label">Status</span>
      <div class="pill-group">${statusPills}</div>
    </div>
    <div class="filter-row facet-row">
      <span class="filter-label">Format</span>
      <div class="pill-group">${formatPills}</div>
    </div>
    <div class="facet-row">${genreRow}</div>
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      ${sortSelect}
      ${filtersButton('games')}
    </div>
    <div class="missing-slot">${listTools('games')}</div>
  </div>`;

  let contentHtml;
  if (!items.length) {
    const narrowed = Object.values(gameFilters).some(facetOn);
    const emptyMsg = gameSearch.trim()
      ? { h: 'No results', p: 'Try a different search term or clear the search.' }
      : narrowed
      ? { h: 'No matches', p: 'Nothing here has that combination — try clearing a filter.' }
      : { h: 'Nothing here yet', p: 'Click "Add game" to track what you own.' };
    contentHtml = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="8" width="18" height="10" rx="4"/>
        <path d="M8 11v4M6 13h4"/>
        <circle cx="15.5" cy="11.5" r="1"/><circle cx="18" cy="13.5" r="1"/>
      </svg>
      <h3>${emptyMsg.h}</h3>
      <p style="font-size:14px">${emptyMsg.p}</p>
    </div>`;
  } else if (viewMode === 'list') {
    const rows = items.map(g => {
      return `<div class="book-row" data-detail="games:${g.id}">
        ${g.coverUrl
          ? `<img class="book-row-thumb" src="${esc(g.coverUrl)}" alt="" loading="lazy">`
          : `<div class="book-row-initial" style="font-size:18px;background:none;color:var(--text)">🎮</div>`}
        <div class="book-row-content">
          <div class="book-row-title">${esc(g.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${g.year ? esc(String(g.year)) : ''}</div>
            <div class="book-row-badges">
              <span class="badge ${statusClass('games', g.status)}">${esc(statusLabel('games', g.status))}</span>
              ${gamePlatformBadges(g)}
              ${gameDlcBadge(g)}
            </div>
            <div class="book-row-actions">
              ${renderLinkButtons(g.links, true)}
              <button class="btn btn-sm" onclick="openGameModal(${g.id})" title="Edit">✏</button>
              <button class="btn btn-sm btn-danger" onclick="deleteGameItem(${g.id})" title="Delete">🗑</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    contentHtml = `<div class="books-list">${rows}</div>`;
  } else {
    const cards = items.map(g => {
      const gr = Math.max(0, Math.min(5, g.rating || 0));
      const stars = gr > 0
        ? `<span class="stars">${'★'.repeat(gr)}<span class="empty">${'★'.repeat(5-gr)}</span></span>`
        : '';
      return `<div class="book-card hcard" data-detail="games:${g.id}" tabindex="0" role="button" aria-label="${esc(g.title)} — details">
        ${hcardPoster(g.coverUrl, g.title, 'hcard-game')}
        <div class="hcard-body">
          <div class="book-title">${esc(g.title)}</div>
          ${g.year ? `<div class="hcard-sub">${esc(String(g.year))}</div>` : ''}
          <div class="book-meta">
            <span class="badge ${statusClass('games', g.status)}">${esc(statusLabel('games', g.status))}</span>
            ${gamePlatformBadges(g)}
            ${gameDlcBadge(g)}
            ${stars}
          </div>
        </div>
      </div>`;
    }).join('');
    contentHtml = `<div class="books-grid hcard-grid">${cards}</div>`;
  }

  const wrap = document.getElementById('gameListWrap');
  if (listOnly && wrap) {
    wrap.innerHTML = contentHtml;
    return;
  }
  alt.innerHTML = toolbar + `<div id="gameListWrap">${contentHtml}</div>`;
}

// A pill cycles its value show → hide → off; "All" clears the row. The Store
// row belongs to PC: with PC no longer shown, its choices go.
function setGameFilter(key, val) {
  if (val === 'all') clearFacet(gameFilters[key]); else cycleFacet(gameFilters[key], val);
  if (!gameFilters.platform.in.includes('pc')) clearFacet(gameFilters.store);
  renderGames();
}

// ─── GENRE FILTER MENU ────────────────────────────────────────────────
// Shared by the Games and Movies & TV tabs. Genres are open-ended, unlike
// the fixed platform/status/format sets, so this is a menu rather than a row
// of pills that would grow without bound as the library does.
//
// Like every filter row, a genre cycles show → hide → off, and several can be
// on: shown genres widen ("Adventure or RPG"), hidden ones are left out.
const GENRE_FILTERS = {
  // Books paginate, so a narrowed result has to go back to page one; the
  // other two render everything at once and have no page to reset.
  books: { state: () => filters,      all: () => allBookGenres(),
           repaint: () => { currentPage = 1; render(); } },
  games: { state: () => gameFilters,  all: () => allGameGenres(),  repaint: () => renderGames(true) },
  media: { state: () => mediaFilters, all: () => allMediaGenres(), repaint: () => renderMedia(true) },
};

const genreBtn  = key => document.getElementById(`${key}GenreBtn`);
const genreMenu = key => document.getElementById(`${key}GenreMenu`);

// What the closed button reads: the shown genres ("A or B"), then the hidden
// ("not C"), shortened to counts once it would not fit.
function genreFilterLabel(key) {
  const f = GENRE_FILTERS[key].state().genres;
  if (!facetOn(f)) return 'All';
  const shown = f.in.length === 0 ? '' : f.in.length <= 2 ? f.in.join(' or ') : `${f.in.length} genres`;
  const hidden = f.out.length === 0 ? '' : f.out.length === 1 ? `not ${f.out[0]}` : `not ${f.out.length} genres`;
  return [shown, hidden].filter(Boolean).join(', ');
}

// The whole row, or '' when the library has no genres to offer yet. Each
// genre cycles show → hide → off, like the pills.
function genreFilterRow(key) {
  const genres = GENRE_FILTERS[key].all();
  if (!genres.length) return '';
  const f = GENRE_FILTERS[key].state().genres;

  return `<div class="filter-row filter-row-menu">
      <span class="filter-label">Genre</span>
      <div class="dropdown-wrap">
        <button class="pill dropdown-btn${facetOn(f) ? ' active' : ''}"
                id="${key}GenreBtn" aria-haspopup="true" aria-expanded="false"
                onclick="toggleGenreMenu('${key}', event)">${esc(genreFilterLabel(key))} <span aria-hidden="true">▾</span></button>
        <div class="dropdown-menu" id="${key}GenreMenu" role="group" aria-label="Filter by genre">
          <div class="dropdown-head">
            <span>Tap to show, again to hide, again to clear</span>
            <button type="button" class="dropdown-clear" onclick="clearGenreFilter('${key}')"
                    ${facetOn(f) ? '' : 'disabled'}>Clear</button>
          </div>
          ${genres.map(g => genreOption(key, f, g)).join('')}
        </div>
      </div>
    </div>`;
}

function genreOption(key, f, g) {
  const m = facetMark(f, g);
  return `<button type="button" class="dropdown-opt genre-opt${m === 'in' ? ' on' : m === 'out' ? ' out' : ''}" data-genre="${esc(g)}"
      aria-pressed="${m === 'in' ? 'true' : m === 'out' ? 'mixed' : 'false'}" onclick="toggleGenre('${key}', this.dataset.genre)">
      <span class="genre-mark" aria-hidden="true">${m === 'in' ? '✓' : m === 'out' ? '✕' : ''}</span>
      <span>${esc(g)}</span>${m === 'out' ? '<span class="sr-only"> (hidden)</span>' : ''}</button>`;
}

function toggleGenreMenu(key, e) {
  if (e) e.stopPropagation();          // don't trip the close-on-outside handler
  const menu = genreMenu(key), btn = genreBtn(key);
  if (!menu || !btn) return;
  const open = menu.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(open));
}

function closeGenreMenus() {
  for (const key of Object.keys(GENRE_FILTERS)) {
    const menu = genreMenu(key), btn = genreBtn(key);
    if (menu) menu.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}

// Repaints the button and the menu's options in place rather than the row,
// since rebuilding the row would take the open menu down with it.
function paintGenreButton(key) {
  const f = GENRE_FILTERS[key].state().genres;
  const btn = genreBtn(key);
  if (btn) {
    btn.firstChild.nodeValue = genreFilterLabel(key) + ' ';
    btn.classList.toggle('active', facetOn(f));
  }
  const menu = genreMenu(key);
  if (menu) {
    const clear = menu.querySelector('.dropdown-clear');
    if (clear) clear.disabled = !facetOn(f);
    // Each option in place: replacing the node mid-click would read as a
    // click outside the menu and close it.
    menu.querySelectorAll('.genre-opt').forEach(o => {
      const m = facetMark(f, o.dataset.genre);
      o.classList.toggle('on', m === 'in');
      o.classList.toggle('out', m === 'out');
      o.setAttribute('aria-pressed', m === 'in' ? 'true' : m === 'out' ? 'mixed' : 'false');
      o.querySelector('.genre-mark').textContent = m === 'in' ? '✓' : m === 'out' ? '✕' : '';
      const sr = o.querySelector('.sr-only');
      if (m === 'out' && !sr) o.insertAdjacentHTML('beforeend', '<span class="sr-only"> (hidden)</span>');
      if (m !== 'out' && sr) sr.remove();
    });
  }
}

// Repaints the list only (see paintGenreButton).
function toggleGenre(key, value) {
  cycleFacet(GENRE_FILTERS[key].state().genres, value);
  paintGenreButton(key);
  GENRE_FILTERS[key].repaint();
  genreMenu(key)?.querySelector(`.genre-opt[data-genre="${CSS.escape(value)}"]`)?.focus();
}

function clearGenreFilter(key) {
  clearFacet(GENRE_FILTERS[key].state().genres);
  paintGenreButton(key);
  GENRE_FILTERS[key].repaint();
}

// Close on a click anywhere else, like the settings menu.
document.addEventListener('click', e => {
  for (const key of Object.keys(GENRE_FILTERS)) {
    const menu = genreMenu(key), btn = genreBtn(key);
    if (!menu || !menu.classList.contains('open')) continue;
    if (btn && btn.contains(e.target)) continue;
    if (!e.target.isConnected) continue;   // redrawn by the click itself
    if (!menu.contains(e.target)) {
      menu.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeGenreMenus();
});

function setGameSort(val) {
  gameSort = val;
  renderGames();
}

function debouncedGameRender(val) {
  gameSearch = val;
  clearTimeout(gameSearchTimer);
  // Guard on activeTab: a timer firing after a tab switch would otherwise
  // paint game content into the pane the new tab just rendered.
  gameSearchTimer = setTimeout(() => { if (activeTab === 'games') renderGames(true); }, 200);
}


