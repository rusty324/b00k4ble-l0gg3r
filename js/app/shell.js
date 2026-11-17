// shell.js — app chrome: theme toggle, the ⋯ settings dropdown, and
// tab switching. Split out of app.js.

// ─── THEMES ───────────────────────────────────────────────────────────
// A theme is a set of colour tokens: :root holds Light, and each other theme
// is a [data-theme="<key>"] block in css/base.css that overrides them. To add
// one, add its block there and an entry here; ⋯ → Theme… lists them all.
// `swatch` is what its card in the picker shows: background, surface, accent, text.
const THEMES = [
  { key: 'light', label: 'Light', swatch: ['#FAF8F4', '#FFFFF8', '#412402', '#2C2C2A'] },
  { key: 'dark',  label: 'Dark',  swatch: ['#161513', '#1f1e1b', '#FAC775', '#f0efe8'] },
];
const themeByKey = k => THEMES.find(t => t.key === k) || THEMES.find(t => t.key === 'dark');

function applyTheme(theme) {
  const t = themeByKey(theme);
  document.documentElement.setAttribute('data-theme', t.key);
  const label = document.getElementById('settingsThemeLabel');
  if (label) label.textContent = `Theme: ${t.label}`;
  try { localStorage.setItem('theme', t.key); } catch { /* private mode: this session only */ }
  if (document.getElementById('themeModal')?.classList.contains('open')) paintThemeSheet();
}

function paintThemeSheet() {
  const cur = document.documentElement.getAttribute('data-theme');
  document.getElementById('themeBody').innerHTML = `
    <div class="modal-title" id="themeTitle">Theme</div>
    <div class="theme-grid" role="radiogroup" aria-labelledby="themeTitle">
      ${THEMES.map(t => `<button type="button" class="theme-card${t.key === cur ? ' on' : ''}" role="radio" aria-checked="${t.key === cur}"
          data-theme-key="${t.key}" onclick="applyTheme('${t.key}')">
        <span class="theme-swatch" aria-hidden="true" style="background:${t.swatch[0]}">
          <span style="background:${t.swatch[1]};border-color:${t.swatch[3]}22"><i style="background:${t.swatch[2]}"></i><i style="background:${t.swatch[3]}"></i></span>
        </span>
        <span class="theme-name">${t.key === cur ? '✓ ' : ''}${esc(t.label)}</span></button>`).join('')}
    </div>
    <div class="detail-actions"><span class="detail-spacer"></span>
      <button type="button" class="btn" onclick="closeThemeSheet()">Done</button></div>`;
}

function openThemeSheet() {
  paintThemeSheet();
  document.getElementById('themeModal').classList.add('open');
  document.querySelector('#themeBody .theme-card.on')?.focus();
}
function closeThemeSheet() { document.getElementById('themeModal')?.classList.remove('open'); }
function handleThemeBackdrop(e) { if (e.target === document.getElementById('themeModal')) closeThemeSheet(); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('themeModal')?.classList.contains('open')) closeThemeSheet();
});
// Kept for anything still calling it: flips between Light and Dark.
function toggleTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

// The view a tab actually shows: Series exists only on Books, and the other
// tabs show cards for it — without overwriting the stored choice, so Books
// is still in Series when you come back.
const effectiveView = (tab = activeTab) =>
  viewMode === 'series' && tab !== 'books' ? 'card' : viewMode;

// The segmented card / list / series control: which buttons the tab has,
// and which is pressed. Hidden where a tab has no views.
function paintViewToggle() {
  const group = document.getElementById('viewToggle');
  if (!group) return;
  group.style.display = ['books', 'media', 'games'].includes(activeTab) ? '' : 'none';
  const cur = effectiveView();
  group.querySelectorAll('.view-btn').forEach(b => {
    b.hidden = b.dataset.view === 'series' && activeTab !== 'books';
    b.setAttribute('aria-pressed', String(b.dataset.view === cur));
  });
}

// On a phone the three view buttons collapse to the current one (CSS:
// .view-toggle:not(.open)), which frees two of the header's six slots.
// Tapping it opens the other views; picking one closes it again.
const narrowHeader = () => window.matchMedia('(max-width: 480px)').matches;
function closeViewToggle() { document.getElementById('viewToggle')?.classList.remove('open'); }
document.addEventListener('click', (e) => { if (!e.target.closest?.('#viewToggle')) closeViewToggle(); });

function setView(mode) {
  if (mode === 'series' && activeTab !== 'books') return;
  const group = document.getElementById('viewToggle');
  if (mode === effectiveView()) {
    if (narrowHeader() && group) group.classList.toggle('open');
    return;
  }
  closeViewToggle();
  viewMode = mode;
  localStorage.setItem('viewMode', viewMode);
  paintViewToggle();

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
  // A selection belongs to one tab's list; leaving the tab ends it.
  if (typeof bulkActive === 'function' && bulkActive()) endBulk();
  activeTab = tab;
  localStorage.setItem('activeTab', tab);

  document.querySelectorAll('.tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  // On a phone the tab bar scrolls sideways; keep the chosen tab in view
  // (Stats, last in the row, starts off-screen after a reload onto it).
  const activeBtn = document.querySelector(`.tab[data-tab="${tab}"]`);
  const bar = activeBtn && activeBtn.parentElement;
  if (bar && bar.scrollWidth > bar.clientWidth) {
    const left = activeBtn.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
    bar.scrollLeft = Math.max(0, left - (bar.clientWidth - activeBtn.offsetWidth) / 2);
  }

  paintViewToggle();

  const labels = {
    'books':    'Add book',
    'media':    'Add title',
    'wishlist': 'Add to wishlist',
    'games':    'Add game'
  };
  document.getElementById('addBtnLabel').textContent = labels[tab] || 'Add';
  // Stats has nothing to add, export or import: those all act on one list.
  const hasList = tab !== 'stats';
  document.getElementById('addBtn').style.display = hasList ? '' : 'none';

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
  if (expEl) { expEl.textContent = io.exp; expEl.style.display = hasList ? '' : 'none'; }
  if (impEl) { impEl.textContent = io.imp; impEl.style.display = hasList ? '' : 'none'; }

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
  paintUpdatedNote();
  switch (activeTab) {
    case 'books':    render();          break;
    case 'media':    renderMedia();     break;
    case 'wishlist': renderWishlist();  break;
    case 'games':    renderGames();     break;
    case 'stats':    renderStatsTab();  break;
  }
}




// ─── tab strip: show that it scrolls ─────────────────────────────────
// See .tab-bar.more-left / .more-right in base.css.
(function tabBarEdges() {
  const bar = document.querySelector('.tab-bar');
  if (!bar) return;
  const update = () => {
    bar.classList.toggle('more-left', bar.scrollLeft > 4);
    bar.classList.toggle('more-right', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4);
  };
  bar.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
  update();
  setTimeout(update, 300);
}());
