// Bulk edit — select several items, then set status, add or remove a genre,
// or delete them, with one save per action.
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

// 60 books, so the list runs to two pages (48 a page); every third is Fantasy.
// Ids count down so the default newest-first order lists Book 01 first.
const bookId = i => 1700000000100 - i;
const BOOKS = Array.from({ length: 60 }, (_, i) => ({
  id: bookId(i), title: `Book ${String(i + 1).padStart(2, '0')}`, author: i < 5 ? 'Ann Leckie' : 'Someone',
  status: 'want', formats: ['ebook'], ...(i % 3 === 0 ? { genre: ['Fantasy'] } : {}),
}));
const MEDIA = [
  { id: 1700000000101, title: 'Airplane!', type: 'movie', status: 'want', formats: ['dvd'] },
  { id: 1700000000102, title: 'Rick and Morty', type: 'tv', status: 'want', formats: ['streaming'] },
  { id: 1700000000103, title: 'Alien', type: 'movie', status: 'want', formats: ['bluray'] },
];
const GAMES = [
  { id: 1700000000201, title: 'Hades', platforms: [{ platform: 'steam', formats: [] }], status: 'want' },
  { id: 1700000000202, title: 'Celeste', platforms: [{ platform: 'steam', formats: [] }], status: 'want' },
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
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);

  // Count saves: each bulk action should write once, not once per item.
  await page.evaluate(() => {
    window.__saves = 0;
    for (const n of ['save', 'saveMedia', 'saveGames']) {
      const orig = window[n]; window[n] = function () { window.__saves++; return orig.apply(this, arguments); };
    }
  });
  const saves = () => page.evaluate(() => { const n = window.__saves; window.__saves = 0; return n; });
  const barShown = () => page.evaluate(() => !document.getElementById('bulkBar').hidden);
  const count = () => page.locator('#bulkCount').innerText();
  const card = t => page.locator('#booksGrid .book-card', { hasText: t });
  const selectedTitles = () => page.locator('[data-detail].selected .book-title, [data-detail].selected .book-row-title')
    .evaluateAll(els => els.map(e => e.textContent.trim()));

  // ── 1. Entering select mode ─────────────────────────────────────────
  const sel = page.locator('#booksMissing .select-btn');
  check('the Books tab has a Select button', await sel.count() === 1);
  check('"What am I missing?" is still there when it applies', await page.locator('#booksMissing .missing-btn').count() === 0 ||
    await page.locator('#booksMissing .missing-btn').isVisible());
  await sel.click();
  check('Select shows the action bar with nothing selected', await barShown() && (await count()) === '0 books selected', await count());
  check('with nothing selected, the actions are disabled',
    await page.locator('#bulkBar .bulk-act').evaluateAll(els => els.every(b => b.disabled)));

  await card('Book 01').locator('.book-title').click();
  await card('Book 02').click();
  await page.waitForTimeout(100);
  check('a tap selects instead of opening the detail sheet', !(await page.locator('#detailModal.open').count()) &&
    J(await selectedTitles()) === J(['Book 01', 'Book 02']), J(await selectedTitles()));
  check('the count follows', (await count()) === '2 books selected');
  await card('Book 02').click();
  check('a second tap deselects', (await count()) === '1 book selected');
  await page.screenshot({ path: shot('bulk-phone.png') });

  // ── 2. Select all: what the filters show, across pages ──────────────
  await page.fill('#searchInput', 'Ann Leckie'); await page.waitForTimeout(500);
  check('Select all names the filtered count', (await page.locator('#bulkAll').innerText()) === 'Select all 5', await page.locator('#bulkAll').innerText());
  await page.click('#bulkAll');
  check('it selects the filtered set (Book 01 was already among it)', (await count()) === '5 books selected', await count());
  check('…and then offers Select none', (await page.locator('#bulkAll').innerText()) === 'Select none');
  await page.click('#bulkAll');
  check('Select none clears them', (await count()) === '0 books selected');
  await page.fill('#searchInput', ''); await page.waitForTimeout(500);
  await page.click('#bulkAll');
  check('unfiltered, Select all takes all 60, past the first page', (await count()) === '60 books selected', await count());
  await page.click('#bulkAll');

  // ── 3. Set status ───────────────────────────────────────────────────
  for (const t of ['Book 01', 'Book 02', 'Book 03']) await card(t).click();
  await page.evaluate(() => { const b = books.find(x => x.title === 'Book 03'); b.status = 'read'; b.finished = '2024-02'; });
  await saves();
  await page.selectOption('#bulkStatus', 'read'); await page.waitForTimeout(200);
  const st = await page.evaluate(() => books.filter(b => /Book 0[1-4]/.test(b.title)).map(b => [b.title, b.status, b.finished || null]));
  const ym = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  check('Set status → Read applies to the selection only', J(st.map(r => r[1]).sort()) === J(['read', 'read', 'read', 'want']), J(st));
  check('books marked Read get this month; a month already there is kept',
    st.find(r => r[0] === 'Book 01')[2] === ym && st.find(r => r[0] === 'Book 03')[2] === '2024-02', J(st));
  check('one save for the whole action', (await saves()) === 1);
  check('the selection survives the re-render', (await count()) === '3 books selected' &&
    J(await selectedTitles()) === J(['Book 01', 'Book 02', 'Book 03']), J(await selectedTitles()));
  check('the status menu goes back to its prompt', (await page.inputValue('#bulkStatus')) === '');
  check('the banner says what happened', /Set 3 books to Read/.test(await page.locator('#statusBanner').innerText()));

  // ── 4. Genres ───────────────────────────────────────────────────────
  await page.locator('#bulkBar button', { hasText: '+ Genre' }).click();
  await page.fill('#bulkGenreInput', 'fantasy'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const g1 = await page.evaluate(() => books.filter(b => /Book 0[1-3]/.test(b.title)).map(b => b.genre || []));
  check('Add genre reuses the existing spelling and does not double it', J(g1) === J([['Fantasy'], ['Fantasy'], ['Fantasy']]), J(g1));
  check('…in one save', (await saves()) === 1);
  await page.locator('#bulkBar button', { hasText: '+ Genre' }).click();
  await page.fill('#bulkGenreInput', 'Space Opera'); await page.click('#bulkBody .btn-primary'); await page.waitForTimeout(200);
  await page.locator('#bulkBar button', { hasText: '− Genre' }).click();
  const offered = await page.locator('#bulkBody .genre-pill').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  check('Remove genre offers the genres the selection has, with counts', J(offered) === J(['Fantasy 3', 'Space Opera 3']), J(offered));
  await page.locator('#bulkBody .genre-pill', { hasText: 'Fantasy' }).click(); await page.waitForTimeout(200);
  const g2 = await page.evaluate(() => [books.find(b => b.title === 'Book 01').genre, books.find(b => b.title === 'Book 04').genre]);
  check('removing it leaves the other genre, and unselected books alone', J(g2) === J([['Space Opera'], ['Fantasy']]), J(g2));
  await saves();

  // ── 5. Delete ───────────────────────────────────────────────────────
  await page.locator('#bulkBar button', { hasText: 'Delete' }).click(); await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ n: books.length, left: books.some(b => /Book 0[1-3]$/.test(b.title)),
    tombs: JSON.parse(localStorage.getItem('tombstones') || '{}') }));
  check('Delete removes the three', after.n === 57 && !after.left, J(after.n));
  check('…leaving tombstones so other devices drop them too', [0, 1, 2].every(i => JSON.stringify(after.tombs).includes(String(bookId(i)))), JSON.stringify(after.tombs).slice(0, 200));
  check('…in one save, and the selection empties', (await saves()) === 1 && (await count()) === '0 books selected');

  // ── 6. Leaving select mode ──────────────────────────────────────────
  await page.click('#bulkBar .btn-primary');
  check('Done hides the bar and clears the marks', !(await barShown()) && (await page.locator('[data-detail].selected').count()) === 0);
  await card('Book 04').click(); await page.waitForTimeout(200);
  check('afterwards a tap opens details again', await page.locator('#detailModal.open').count() === 1);
  await page.evaluate(() => closeDetail());
  await sel.click(); await page.keyboard.press('Escape');
  check('Escape ends select mode', !(await barShown()));

  // ── 7. Other tabs ───────────────────────────────────────────────────
  await sel.click(); await card('Book 04').click();
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  check('switching tabs ends select mode', !(await barShown()));
  await page.locator('#altContent .select-btn').click();
  await page.locator('#altContent [data-detail]', { hasText: 'Airplane!' }).click();
  await page.locator('#altContent [data-detail]', { hasText: 'Alien' }).click();
  await page.selectOption('#bulkStatus', 'watched'); await page.waitForTimeout(200);
  const ms = await page.evaluate(() => mediaLibrary.map(m => [m.title, m.status]));
  check('Movies & TV: Set status → Watched', J(ms) === J([['Airplane!', 'watched'], ['Rick and Morty', 'want'], ['Alien', 'watched']]), J(ms));
  check('…one save, selection kept', (await saves()) === 1 && (await count()) === '2 titles selected');
  await page.click('#altContent .pill:text-is("📺 TV Shows")'); await page.waitForTimeout(200);
  check('Select all follows the Movies & TV filters', (await page.locator('#bulkAll').innerText()) === 'Select all 1');
  await page.click('#bulkBar .btn-primary');

  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  await page.locator('#altContent .select-btn').click();
  await page.click('#bulkAll');
  await page.selectOption('#bulkStatus', 'completed'); await page.waitForTimeout(200);
  const gs = await page.evaluate(() => videoGames.map(g => g.status));
  check('Games: Select all, then Set status → Completed', J(gs) === J(['completed', 'completed']), J(gs));
  check('…one save', (await saves()) === 1);
  await page.screenshot({ path: shot('bulk-games-phone.png') });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
