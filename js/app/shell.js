// shell.js — app chrome: theme toggle, the ⋯ settings dropdown, and
// tab switching. Split out of app.js.

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

  // Capture the index of the topmost partially-visible item so we can restore
  // the reading position after the layout changes.
  const headerH = document.querySelector('header')?.offsetHeight || 0;
  let topIndex = 0;
  const gridSelector = activeTab === 'books'
    ? () => document.getElementById('booksGrid')
    : () => document.getElementById('altContent')?.querySelector('.books-grid, .books-list');
  const gridBefore = gridSelector();
  if (gridBefore) {
    const kids = [...gridBefore.children];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].getBoundingClientRect().bottom > headerH) { topIndex = i; break; }
    }
  }

  renderPage();

  // Scroll so the same-indexed item in the new layout sits at the top edge.
  const target = gridSelector()?.children[topIndex];
  if (target) {
    window.scrollBy({ top: target.getBoundingClientRect().top - headerH, behavior: 'instant' });
  }
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

  // View toggle visible on books, media, and games tabs
  document.getElementById('viewToggleBtn').style.display =
    (tab === 'books' || tab === 'media' || tab === 'games') ? '' : 'none';

  const labels = {
    'books':    'Add book',
    'media':    'Add title',
    'wishlist': 'Add to wishlist',
    'games':    'Add game'
  };
  document.getElementById('addBtnLabel').textContent = labels[tab] || 'Add';

  syncScanButton();

  // Update export/import button labels to reflect active tab
  const ioLabels = {
    books:    { exp: '⬇ Export library',     imp: '⬆ Import library' },
    media:    { exp: '⬇ Export movies & TV', imp: '⬆ Import movies & TV' },
    wishlist: { exp: '⬇ Export wishlist',    imp: '⬆ Import wishlist' },
    games:    { exp: '⬇ Export games',       imp: '⬆ Import games' },
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

  // Reset search state when switching tabs
  mediaSearch = '';
  wishlistSearch = '';
  gameSearch = '';

  renderPage();
}

function handleAddClick() {
  pendingScanCode = null;
  if (activeTab === 'books')        openAddModal();
  else if (activeTab === 'media')   openMediaModal(null);
  else if (activeTab === 'wishlist') openWishlistModal(null);
  else if (activeTab === 'games')   openGameModal(null);
}

function renderPage() {
  switch (activeTab) {
    case 'books':    render();          break;
    case 'media':    renderMedia();     break;
    case 'wishlist': renderWishlist();  break;
    case 'games':    renderGames();     break;
  }
}


