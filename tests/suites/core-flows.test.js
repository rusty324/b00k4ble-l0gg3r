// The everyday paths on every tab: add, edit, delete, filter, search, export
// and import. Broad and shallow on purpose — a tripwire for "something basic
// broke", with the feature suites covering each area in depth.
const fs = require('fs');
const { launch, BASE, reporter, viaDetail } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const BOOKS = [
  { id: 1700000000001, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['physical'], genre: ['Sci-Fi'] },
  { id: 1700000000002, title: 'Emma', author: 'Jane Austen', status: 'want', formats: ['ebook'] },
  { id: 1700000000003, title: 'Leviathan Wakes', author: 'James S. A. Corey', status: 'reading', formats: ['audio'] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('**/covers.openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, BOOKS);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  const bookTitles = () => page.evaluate(() => [...document.querySelectorAll('#booksGrid .book-title, #booksGrid .book-row-title')].map(e => e.textContent.trim()));
  const altTitles = () => page.evaluate(() => [...document.querySelectorAll('#altContent .book-title, #altContent .book-row-title')].map(e => e.textContent.trim()));

  // ── Books ──────────────────────────────────────────────────────────
  check('books load from storage', (await bookTitles()).length === 3, J(await bookTitles()));
  const statusRow = page.locator('#booksSection .filter-row', { hasText: 'Status' });
  await statusRow.getByRole('button', { name: 'Read', exact: true }).click(); await page.waitForTimeout(250);
  check('the status filter narrows to Read', J(await bookTitles()) === '["Dune"]', J(await bookTitles()));
  await statusRow.getByRole('button', { name: 'All', exact: true }).click(); await page.waitForTimeout(250);
  await page.fill('#searchInput', 'austen'); await page.waitForTimeout(400);
  check('search matches the author', J(await bookTitles()) === '["Emma"]', J(await bookTitles()));
  await page.fill('#searchInput', ''); await page.waitForTimeout(400);

  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  await page.fill('#f-title', 'A Wizard of Earthsea'); await page.fill('#f-author', 'Ursula K. Le Guin');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('adding a book saves it and shows it', (await bookTitles()).includes('A Wizard of Earthsea'));
  check('…and it is persisted', await page.evaluate(() => JSON.parse(localStorage.getItem('myLibrary')).some(b => b.title === 'A Wizard of Earthsea')));

  await viaDetail(page.locator('#booksGrid .book-card', { hasText: 'Emma' }), 'Edit');
  await page.waitForSelector('#modal.open');
  await page.click('label[for="st-read"]');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('editing a book saves the change', await page.evaluate(() => books.find(b => b.title === 'Emma').status) === 'read');

  await viaDetail(page.locator('#booksGrid .book-card', { hasText: 'A Wizard of Earthsea' }), 'Delete');
  await page.waitForTimeout(400);
  check('deleting a book removes it', !(await bookTitles()).includes('A Wizard of Earthsea'));

  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);
  check('list view renders rows', (await page.locator('#booksGrid .book-row').count()) === 3);
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);

  // export → wipe → import
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportData())]);
  const file = await dl.path();
  const ex = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('export is { lastUpdatedOn, items } with every book', Array.isArray(ex.items) && ex.items.length === 3 && 'lastUpdatedOn' in ex);
  await page.evaluate(() => { books = []; saveLocal(); render(); });
  await page.setInputFiles('#importFile', file); await page.waitForTimeout(600);
  check('importing the export restores every book', (await bookTitles()).length === 3, J(await bookTitles()));

  // ── Movies & TV ────────────────────────────────────────────────────
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  check('switching tabs shows the Movies & TV pane', await page.evaluate(() =>
    getComputedStyle(document.getElementById('booksSection')).display === 'none' && document.getElementById('addBtnLabel').textContent === 'Add title'));
  await page.click('#addBtn'); await page.waitForSelector('#mediaModal.open');
  await page.fill('#m-title', 'Airplane!'); await page.fill('#m-year', '1980');
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(400);
  check('adding a movie shows it', J(await altTitles()) === '["Airplane!"]', J(await altTitles()));
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Airplane!' }), 'Delete'); await page.waitForTimeout(400);
  check('deleting it empties the tab', (await altTitles()).length === 0);

  // ── Games ──────────────────────────────────────────────────────────
  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.fill('#g-title', 'Hades'); await page.click('label[for="g-plat-steam"]');
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
  check('adding a game shows it', J(await altTitles()) === '["Hades"]', J(await altTitles()));

  // ── Wishlist ───────────────────────────────────────────────────────
  await page.click('.tab[data-tab="wishlist"]'); await page.waitForTimeout(300);
  await page.click('#addBtn'); await page.waitForSelector('#wishlistModal.open');
  await page.fill('#wl-title', 'Silksong'); await page.click('label[for="wl-type-game"]');
  await page.click('button[onclick="saveWishlistItem()"]'); await page.waitForTimeout(400);
  check('adding to the wishlist shows it', J(await altTitles()) === '["Silksong"]', J(await altTitles()));
  await page.locator('#wishlistListWrap .book-row', { hasText: 'Silksong' }).locator('button[title="Delete"]').click(); await page.waitForTimeout(400);
  check('deleting it removes it', (await altTitles()).length === 0);

  // ── Reload keeps everything ────────────────────────────────────────
  await page.reload(); await page.waitForTimeout(700);
  check('a reload restores the last tab and the data', await page.evaluate(() =>
    activeTab === 'wishlist' && books.length === 3 && videoGames.length === 1));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
