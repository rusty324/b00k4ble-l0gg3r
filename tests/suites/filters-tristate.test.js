// Filter pills select several values, and each cycles show → hide → off
// (core.js cycleFacet): one tap shows only matches, a second hides them, a
// third clears. "All" clears the row. Books (static pills), Movies & TV,
// Games (with its Store row under PC), the Wishlist and the genre menu.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const B = (id, title, formats, status, genre) => ({ id: 1700000000000 + id, title, author: 'A', formats, status, genre });
const BOOKS = [
  B(1, 'Ebook Want', ['ebook'], 'want', ['Fantasy']),
  B(2, 'Audio Read', ['audio'], 'read', ['Mystery']),
  B(3, 'Print Reading', ['physical'], 'reading', ['Fantasy', 'Horror']),
  B(4, 'Print Want', ['physical'], 'want', []),
];
const MEDIA = [
  { id: 1700000000101, title: 'Film DVD', type: 'movie', status: 'want', copies: [{ format: 'dvd' }] },
  { id: 1700000000102, title: 'Show Stream', type: 'tv', status: 'watched', copies: [{ format: 'streaming' }] },
  { id: 1700000000103, title: 'Film Bluray', type: 'movie', status: 'watched', copies: [{ format: 'bluray' }] },
];
const GAMES = [
  { id: 1700000000201, title: 'Steam Game', status: 'want', copies: [{ platform: 'pc', store: 'steam' }] },
  { id: 1700000000202, title: 'Epic Game', status: 'want', copies: [{ platform: 'pc', store: 'epic' }] },
  { id: 1700000000203, title: 'PS5 Game', status: 'completed', copies: [{ platform: 'ps5', format: 'physical' }] },
];
const WISH = [{ id: 1700000000301, title: 'W Book', type: 'book' }, { id: 1700000000302, title: 'W Game', type: 'game' }, { id: 1700000000303, title: 'W TV', type: 'tv' }];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/openlibrary.org/**', r => r.abort()); await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g, w]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', JSON.stringify(w));
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, [BOOKS, MEDIA, GAMES, WISH]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);
  const books = () => page.locator('#booksGrid .book-title').allInnerTexts().then(a => a.sort());
  const alt = () => page.locator('#altContent .book-title, #altContent .book-row-title').allInnerTexts().then(a => a.sort());
  const pill = (group, v) => page.locator(`${group} .pill[data-facet-value="${v}"]`);
  const state = async (group, v) => (await pill(group, v).getAttribute('aria-pressed'));

  // ── Books: static pills ────────────────────────────────────────────
  await pill('#formatPills', 'physical').click(); await page.waitForTimeout(200);
  check('Books: one tap shows only that format', J(await books()) === J(['Print Reading', 'Print Want']) && await state('#formatPills', 'physical') === 'true', J(await books()));
  check('…and lifts "All"', await state('#formatPills', 'all') === 'false');
  await pill('#formatPills', 'ebook').click(); await page.waitForTimeout(200);
  check('a second value widens the selection (either format)', J(await books()) === J(['Ebook Want', 'Print Reading', 'Print Want']), J(await books()));
  await pill('#formatPills', 'physical').click(); await page.waitForTimeout(200);
  check('a second tap on a value hides it', J(await books()) === J(['Ebook Want']) && await state('#formatPills', 'physical') === 'mixed' &&
    await pill('#formatPills', 'physical').evaluate(el => el.classList.contains('excluded') && getComputedStyle(el).textDecorationLine.includes('line-through')), J(await books()));
  await pill('#formatPills', 'physical').click(); await page.waitForTimeout(200);
  check('a third tap clears it', await state('#formatPills', 'physical') === 'false' && J(await books()) === J(['Ebook Want']));
  await pill('#formatPills', 'ebook').click(); await page.waitForTimeout(200);   // it was shown: now hidden
  check('hiding alone: everything except that format', J(await books()) === J(['Audio Read', 'Print Reading', 'Print Want']), J(await books()));
  await pill('#statusPills', 'want').click(); await pill('#statusPills', 'want').click(); await page.waitForTimeout(200);
  check('rows combine: not e-book and not Want to read', J(await books()) === J(['Audio Read', 'Print Reading']), J(await books()));
  await pill('#formatPills', 'all').click(); await pill('#statusPills', 'all').click(); await page.waitForTimeout(200);
  check('"All" clears a row', (await books()).length === 4 && await state('#formatPills', 'all') === 'true' && await state('#formatPills', 'ebook') === 'false');

  // the genre menu cycles too
  await page.click('#booksGenreBtn'); await page.waitForTimeout(100);
  const gopt = g => page.locator(`#booksGenreMenu .genre-opt[data-genre="${g}"]`);
  await gopt('Fantasy').click(); await page.waitForTimeout(150);
  check('Genre: one tap shows it', J(await books()) === J(['Ebook Want', 'Print Reading']) && (await page.innerText('#booksGenreBtn')).startsWith('Fantasy'));
  await gopt('Horror').click(); await gopt('Horror').click(); await page.waitForTimeout(150);
  check('…a genre can be hidden alongside ("Fantasy, not Horror")', J(await books()) === J(['Ebook Want']) &&
    (await page.innerText('#booksGenreBtn')).startsWith('Fantasy, not Horror') && await gopt('Horror').getAttribute('aria-pressed') === 'mixed', await page.innerText('#booksGenreBtn'));
  check('…the menu stays open while choosing', await page.locator('#booksGenreMenu.open').count() === 1);
  await page.click('#booksGenreMenu .dropdown-clear'); await page.waitForTimeout(150);
  check('…and Clear resets it', (await books()).length === 4 && (await page.innerText('#booksGenreBtn')).startsWith('All'));
  await page.keyboard.press('Escape');

  // ── Movies & TV ────────────────────────────────────────────────────
  await page.evaluate(() => switchTab('media')); await page.waitForTimeout(250);
  const mt = '#altContent .filter-row:has(.filter-label:text-is("Type"))', ms = '#altContent .filter-row:has(.filter-label:text-is("Status"))';
  await pill(mt, 'tv').click(); await pill(mt, 'tv').click(); await page.waitForTimeout(150);
  check('Movies & TV: hide TV shows', J(await alt()) === J(['Film Bluray', 'Film DVD']), J(await alt()));
  await pill(ms, 'want').click(); await page.waitForTimeout(150);
  check('…and show only Want to Watch', J(await alt()) === J(['Film DVD']), J(await alt()));
  await pill(ms, 'watched').click(); await page.waitForTimeout(150);
  check('…or Watched as well', J(await alt()) === J(['Film Bluray', 'Film DVD']), J(await alt()));

  // ── Games: Store row under PC ──────────────────────────────────────
  await page.evaluate(() => switchTab('games')); await page.waitForTimeout(250);
  const gp = '#altContent .filter-row:has(.filter-label:text-is("Platform"))', gs = '#altContent .filter-row:has(.filter-label:text-is("Store"))';
  await pill(gp, 'pc').click(); await page.waitForTimeout(150);
  check('Games: showing PC brings the Store row', await page.locator(gs).count() === 1 && J(await alt()) === J(['Epic Game', 'Steam Game']));
  await pill(gs, 'epic').click(); await pill(gs, 'epic').click(); await page.waitForTimeout(150);
  check('…where a store can be hidden', J(await alt()) === J(['Steam Game']), J(await alt()));
  await pill(gp, 'pc').click(); await page.waitForTimeout(150);
  check('hiding PC drops the Store row and its choices', await page.locator(gs).count() === 0 &&
    await page.evaluate(() => !facetOn(gameFilters.store)) && J(await alt()) === J(['PS5 Game']), J(await alt()));

  // ── Wishlist ───────────────────────────────────────────────────────
  await page.evaluate(() => switchTab('wishlist')); await page.waitForTimeout(250);
  const wt = '#altContent .pill-group';
  await pill(wt, 'book').click(); await pill(wt, 'game').click(); await page.waitForTimeout(150);
  const wl = await page.locator('#altContent .book-row-title, #altContent .wish-title, #wishlistListWrap [data-detail], #wishlistListWrap .book-row').allInnerTexts();
  check('Wishlist: books and games together', wl.join(' ').includes('W Book') && wl.join(' ').includes('W Game') && !wl.join(' ').includes('W TV'), J(wl));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
