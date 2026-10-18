// The Stats tab — Books, Movies & TV and Games counted in one place, and the
// Books tab opening straight onto its list.
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const Y = new Date().getFullYear();

const BOOKS = [
  { id: 1700000000001, title: 'Dune', author: 'A', status: 'read', finished: `${Y}-02`, formats: ['physical'], rating: 5 },
  { id: 1700000000002, title: 'Emma', author: 'B', status: 'read', finished: `${Y - 1}-07`, formats: ['ebook', 'audio'], rating: 3 },
  { id: 1700000000003, title: 'Ubik', author: 'C', status: 'reading', formats: ['audio'] },
  { id: 1700000000004, title: 'Kindred', author: 'D', status: 'want', formats: ['physical'] },
];
const MEDIA = [
  { id: 1700000000101, title: 'Airplane!', type: 'movie', status: 'watched', formats: ['dvd'], rating: 4 },
  { id: 1700000000102, title: 'Rick and Morty', type: 'tv', status: 'want', formats: ['bluray', 'streaming'], seasons: [1, 2] },
  { id: 1700000000103, title: 'Alien', type: 'movie', status: 'want', formats: ['bluray'] },
];
const GAMES = [
  { id: 1700000000201, title: 'Hades', status: 'completed', rating: 5,
    platforms: [{ platform: 'steam', formats: ['digital'] }, { platform: 'ps5', formats: ['ps-plus'] }],
    dlc: [{ name: 'A', owned: true }, { name: 'B', owned: false }] },
  { id: 1700000000202, title: 'Bloodborne', status: 'playing', platforms: [{ platform: 'ps4', formats: ['physical'] }] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, [BOOKS, MEDIA, GAMES]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);

  // Every card in a section, as { label: [value, sub] }.
  const cards = tab => page.evaluate(tab => {
    const out = {};
    document.querySelectorAll(`[aria-labelledby="stats-${tab}"] .stat-card`).forEach(c => {
      out[c.querySelector('.stat-label').textContent] =
        [c.querySelector('.stat-value').textContent, (c.querySelector('.stat-sub') || {}).textContent || ''];
    });
    return out;
  }, tab);
  const shown = id => page.evaluate(id => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; }, id);

  // ── 1. Books no longer carries the stats ────────────────────────────
  check('the Books tab has no stats row', await page.locator('#booksSection .stat-card').count() === 0);
  check('it opens onto the search and the list', await shown('searchInput') && await page.locator('#booksGrid .book-card').count() === 4);

  // ── 2. The Stats tab ────────────────────────────────────────────────
  await page.click('.tab[data-tab="stats"]'); await page.waitForTimeout(200);
  const titles = await page.locator('.stats-title').allTextContents();
  check('a Stats tab with a section per library', J(titles) === J(['📚 Books', '🎬 Movies & TV', '🎮 Games']), J(titles));
  const b = await cards('books');
  check('Books: totals, read this year and last, formats, rating', J(b) === J({
    Total: ['4', '2 read · 1 in progress'], [`Read in ${Y}`]: ['1', `1 in ${Y - 1}`],
    Physical: ['2', '50% of library'], 'E-books': ['1', '25% of library'], Audiobooks: ['2', '50% of library'],
    'Avg rating': ['4.0', '2 rated'] }), J(b));
  const m = await cards('media');
  check('Movies & TV: totals, movies and shows (with seasons owned), formats, rating', J(m) === J({
    Total: ['3', '1 watched · 2 to watch'], Movies: ['2', '67% of library'], 'TV shows': ['1', '2 seasons owned'],
    'Blu-ray': ['2', '67% of library'], DVD: ['1', '33% of library'], Digital: ['0', '0% of library'],
    Streaming: ['1', '33% of library'], 'Avg rating': ['4.0', '1 rated'] }), J(m));
  const g = await cards('games');
  check('Games: totals, each platform owned on, formats, DLC, rating', J(g) === J({
    Total: ['2', '1 completed · 1 playing'], PS4: ['1', '50% of library'], PS5: ['1', '50% of library'],
    Steam: ['1', '50% of library'], Physical: ['1', '50% of library'], Digital: ['1', '50% of library'],
    'PS Plus': ['1', '50% of library'], 'DLC owned': ['1', '1 wishlisted'], 'Avg rating': ['5.0', '1 rated'] }), J(g));
  check('nothing to add, scan, export or import here', !(await shown('addBtn')) && !(await shown('scanBtn')) &&
    await page.evaluate(() => ['settingsExportBtn', 'settingsImportBtn'].every(id => document.getElementById(id).style.display === 'none')));
  await page.screenshot({ path: shot('stats-tab-phone.png'), fullPage: true });

  // ── 3. Live, remembered, and a way back ─────────────────────────────
  await page.evaluate(() => { videoGames = []; saveGames(); renderPage(); }); await page.waitForTimeout(200);
  check('an empty library says so instead of showing zeros',
    (await page.locator('[aria-labelledby="stats-games"] .stats-empty').textContent()) === 'No games yet.');
  await page.reload(); await page.waitForTimeout(800);
  check('the Stats tab is remembered across a reload', await page.locator('.tab.active').getAttribute('data-tab') === 'stats' &&
    await page.locator('.stats-title').count() === 3);
  const inView = await page.evaluate(() => {
    const t = document.querySelector('.tab[data-tab="stats"]').getBoundingClientRect(), b = document.querySelector('.tab-bar').getBoundingClientRect();
    return t.left >= b.left - 1 && t.right <= b.right + 1;
  });
  check('…with the Stats tab scrolled into view in the tab bar', inView);
  await page.locator('[aria-labelledby="stats-media"] button', { hasText: 'Open' }).click(); await page.waitForTimeout(300);
  check('"Open →" goes to that tab, with its buttons back',
    await page.locator('.tab.active').getAttribute('data-tab') === 'media' && await shown('addBtn') &&
    await page.evaluate(() => document.getElementById('settingsExportBtn').style.display === ''));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
