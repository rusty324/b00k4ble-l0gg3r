// render-games.js — the Games tab's render, filters, sort and
// search, plus the shared multi-select genre filter menu (used by
// the Books and Movies & TV tabs too — it lives here because this is
// where it was first built). Split out of app.js.

// ─── GAMES RENDERING (Video Games tab) ─────────────────────────────────
// No lookup API is wired up here — RAWG, IGDB, Giant Bomb and Steam's own
// endpoints all decline browser CORS, so every field below is typed by
// hand rather than searched, unlike the books/media tabs.
const GAME_PLATFORM_LABEL = { ps3: 'PS3', ps4: 'PS4', ps5: 'PS5', xbox: 'Xbox', steam: 'Steam' };

// listOnly: replace just the results container, leaving the toolbar (and
// the focused search input inside it) intact — used by the search path.
function renderGames(listOnly = false) {
  const alt = document.getElementById('altContent');

  // Apply filters
  let items = videoGames;
  if (gameFilters.platform !== 'all') items = items.filter(g => g.platform === gameFilters.platform);
  if (gameFilters.status !== 'all') items = items.filter(g => g.status === gameFilters.status);
  // An item can hold several formats, so this is "has it", not "is it".
  if (gameFilters.format !== 'all')
    items = items.filter(g => (g.formats || []).includes(gameFilters.format));
  // Several genres widen rather than narrow: ticking Adventure and RPG shows
  // games that are either, which is what a list of checkboxes reads as. The
  // menu says so, so it is never left to guess.
  if (gameFilters.genres.length) {
    const wanted = new Set(gameFilters.genres.map(x => x.toLowerCase()));
    items = items.filter(g => (g.genre || []).some(x => wanted.has(String(x).toLowerCase())));
  }
  if (gameSearch.trim()) {
    const q = gameSearch.toLowerCase().trim();
    items = items.filter(g =>
      (g.title || '').toLowerCase().includes(q) ||
      (GAME_PLATFORM_LABEL[g.platform] || g.platform || '').toLowerCase().includes(q) ||
      (g.year ? String(g.year) : '').includes(q) ||
      (g.genre || []).some(x => x.toLowerCase().includes(q))
    );
  }

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

  const stCls    = { want: 'badge-want', playing: 'badge-reading', completed: 'badge-watched' };
  const stLabel  = { want: 'Want to Play', playing: 'Playing', completed: 'Completed' };
  const fmtIcons = { physical: '📀', digital: '💾' };
  const fmtCls   = { physical: 'badge-physical', digital: 'badge-digital' };

  // Filter toolbar
  const platformPills = [['all','All'],['ps3','PS3'],['ps4','PS4'],['ps5','PS5'],
                         ['xbox','Xbox'],['steam','Steam']].map(([v,l]) =>
    `<button class="pill${gameFilters.platform===v?' active':''}" onclick="setGameFilter('platform','${v}')">${l}</button>`
  ).join('');
  const statusPills = [['all','All'],['want','Want to Play'],['playing','Playing'],
                       ['completed','Completed']].map(([v,l]) =>
    `<button class="pill${gameFilters.status===v?' active':''}" onclick="setGameFilter('status','${v}')">${l}</button>`
  ).join('');
  // Same values and icons as the form's format checkboxes.
  const formatPills = [['all','All'],['physical','📀 Physical'],['digital','💾 Digital']].map(([v,l]) =>
    `<button class="pill${gameFilters.format===v?' active':''}" onclick="setGameFilter('format','${v}')">${l}</button>`
  ).join('');
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
      <input type="search" id="gameSearchInput" placeholder="Search title, platform, year, or genre…" aria-label="Search video games" value="${esc(gameSearch)}" oninput="debouncedGameRender(this.value)">
    </div>
    <div class="filter-row">
      <span class="filter-label">Platform</span>
      <div class="pill-group">${platformPills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Status</span>
      <div class="pill-group">${statusPills}</div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Format</span>
      <div class="pill-group">${formatPills}</div>
    </div>
    ${genreRow}
    <div class="filter-row">
      <span class="filter-label">Sort</span>
      ${sortSelect}
    </div>
  </div>`;

  let contentHtml;
  if (!items.length) {
    const narrowed = gameFilters.platform !== 'all' || gameFilters.status !== 'all' ||
                     gameFilters.format !== 'all' || gameFilters.genres.length > 0;
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
      const plat    = GAME_PLATFORM_LABEL[g.platform] || g.platform || 'Unknown platform';
      const formats = (g.formats || []).map(f => fmtIcons[f] || '').join(' ');
      return `<div class="book-row">
        ${g.coverUrl
          ? `<img class="book-row-thumb" src="${esc(g.coverUrl)}" alt="" loading="lazy">`
          : `<div class="book-row-initial" style="font-size:18px;background:none;color:var(--text)">🎮</div>`}
        <div class="book-row-content">
          <div class="book-row-title">${esc(g.title)}</div>
          <div class="book-row-meta">
            <div class="book-row-author">${esc(plat)}</div>
            <div class="book-row-badges">
              <span class="badge ${stCls[g.status] || 'badge-want'}">${stLabel[g.status] || esc(g.status)}</span>
              ${formats ? `<span class="badge badge-media">${formats}</span>` : ''}
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
      const plat      = GAME_PLATFORM_LABEL[g.platform] || g.platform || 'Unknown platform';
      const genreTags = (g.genre || []).map(x =>
        `<span class="badge badge-tag">${esc(x)}</span>`).join('');
      const fmtBadges = (g.formats || []).map(f =>
        `<span class="badge ${fmtCls[f] || 'badge-media'}" title="${esc(f)}">${fmtIcons[f] || esc(f)}</span>`).join('');
      const gr = Math.max(0, Math.min(5, g.rating || 0));
      const stars = gr > 0
        ? `<span class="stars">${'★'.repeat(gr)}<span class="empty">${'★'.repeat(5-gr)}</span></span>`
        : '';
      return `<div class="book-card">
        ${g.coverUrl
          ? `<img class="book-card-cover" src="${esc(g.coverUrl)}" alt="" loading="lazy">`
          : `<div class="media-card-placeholder">🎮</div>`}
        <div class="book-title">${esc(g.title)}</div>
        <div class="book-author">${esc(plat)}${g.year ? ' · ' + esc(String(g.year)) : ''}</div>
        <div class="book-meta">
          <span class="badge ${stCls[g.status] || 'badge-want'}">${stLabel[g.status] || esc(g.status)}</span>
          ${fmtBadges}
          ${stars}
        </div>
        ${genreTags ? `<div class="book-tags">${genreTags}</div>` : ''}
        ${g.notes ? `<div class="book-notes">${esc(g.notes)}</div>` : ''}
        <div class="book-actions">
          ${renderLinkButtons(g.links)}
          <button class="btn btn-sm" onclick="openGameModal(${g.id})">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteGameItem(${g.id})">
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

  const wrap = document.getElementById('gameListWrap');
  if (listOnly && wrap) {
    wrap.innerHTML = contentHtml;
    return;
  }
  alt.innerHTML = toolbar + `<div id="gameListWrap">${contentHtml}</div>`;
}

function setGameFilter(key, val) {
  gameFilters[key] = val;
  renderGames();
}

// ─── GENRE FILTER MENU ────────────────────────────────────────────────
// Shared by the Games and Movies & TV tabs. Genres are open-ended, unlike
// the fixed platform/status/format sets, so this is a menu rather than a row
// of pills that would grow without bound as the library does.
//
// Several selected means "matching any": ticking Adventure and RPG shows
// titles that are either. That is what a list of checkboxes reads as, and
// the menu header says so rather than leaving it to be inferred.
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

// What the closed button reads. Two are spelled out with "or" so the widening
// behaviour is legible without opening the menu; beyond that it would not fit.
function genreFilterLabel(key) {
  const chosen = GENRE_FILTERS[key].state().genres;
  if (!chosen.length) return 'All';
  if (chosen.length === 1) return chosen[0];
  if (chosen.length === 2) return chosen.join(' or ');
  return `${chosen.length} genres`;
}

// The whole row, or '' when the library has no genres to offer yet.
function genreFilterRow(key) {
  const genres = GENRE_FILTERS[key].all();
  if (!genres.length) return '';
  const chosen = GENRE_FILTERS[key].state().genres;

  return `<div class="filter-row filter-row-menu">
      <span class="filter-label">Genre</span>
      <div class="dropdown-wrap">
        <button class="pill dropdown-btn${chosen.length ? ' active' : ''}"
                id="${key}GenreBtn" aria-haspopup="true" aria-expanded="false"
                onclick="toggleGenreMenu('${key}', event)">${esc(genreFilterLabel(key))} <span aria-hidden="true">▾</span></button>
        <div class="dropdown-menu" id="${key}GenreMenu" role="group" aria-label="Filter by genre">
          <div class="dropdown-head">
            <span>Showing anything matching <strong>any</strong> of these</span>
            <button type="button" class="dropdown-clear" onclick="clearGenreFilter('${key}')"
                    ${chosen.length ? '' : 'disabled'}>Clear</button>
          </div>
          ${genres.map(g => `<label class="dropdown-opt">
            <input type="checkbox" value="${esc(g)}"
                   ${chosen.some(x => x.toLowerCase() === g.toLowerCase()) ? 'checked' : ''}
                   onchange="toggleGenre('${key}', this.value)">
            <span>${esc(g)}</span>
          </label>`).join('')}
        </div>
      </div>
    </div>`;
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

// Repaints the button in place rather than through the row's own markup,
// since the row is only rebuilt on a full render.
function paintGenreButton(key) {
  const chosen = GENRE_FILTERS[key].state().genres;
  const btn = genreBtn(key);
  if (btn) {
    btn.firstChild.nodeValue = genreFilterLabel(key) + ' ';
    btn.classList.toggle('active', chosen.length > 0);
  }
  const clear = genreMenu(key)?.querySelector('.dropdown-clear');
  if (clear) clear.disabled = chosen.length === 0;
}

// Repaints the list only. A full render would rebuild the toolbar and take
// the open menu down with it, making a second genre impossible to tick
// without reopening — the same reason the search box uses the listOnly path.
function toggleGenre(key, value) {
  const chosen = GENRE_FILTERS[key].state().genres;
  const i = chosen.findIndex(x => x.toLowerCase() === String(value).toLowerCase());
  if (i === -1) chosen.push(value);
  else chosen.splice(i, 1);
  paintGenreButton(key);
  GENRE_FILTERS[key].repaint();
}

function clearGenreFilter(key) {
  GENRE_FILTERS[key].state().genres = [];
  genreMenu(key)?.querySelectorAll('input[type="checkbox"]')
    .forEach(cb => { cb.checked = false; });
  paintGenreButton(key);
  GENRE_FILTERS[key].repaint();
}

// Close on a click anywhere else, like the settings menu.
document.addEventListener('click', e => {
  for (const key of Object.keys(GENRE_FILTERS)) {
    const menu = genreMenu(key), btn = genreBtn(key);
    if (!menu || !menu.classList.contains('open')) continue;
    if (btn && btn.contains(e.target)) continue;
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


