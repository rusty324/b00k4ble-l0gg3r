// The phone Filters sheet (js/app/filters-sheet.js), at 390px: the pill rows
// give way to one button; the sheet's counts follow the other facets and the
// search; zero-count options are disabled; Collection (books) works; Esc
// closes and focus goes back to the button; Movies & TV and Games too.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const B = (id, title, series, formats, status, genre) => ({ id: 1700000000000 + id, title, author: 'A', series, formats, status, genre });
const BOOKS = [
  B(1, 'Saga One', 'Saga #1', ['ebook'], 'want', ['Fantasy']),
  B(2, 'Saga Three', 'Saga #3', ['ebook'], 'read', ['Fantasy']),          // Saga is missing #2: a series with gaps
  B(3, 'Whole One', 'Whole #1', ['ebook', 'audio'], 'want', ['Mystery']),
  B(4, 'Whole Two', 'Whole #2', ['physical'], 'reading', []),
  B(5, 'Solo', '', ['physical'], 'want', ['Science Fiction']),
];
const MEDIA = [
  { id: 1700000000101, title: 'A Film', type: 'movie', status: 'want', formats: ['dvd'], genre: ['Drama'] },
  { id: 1700000000102, title: 'A Show', type: 'tv', status: 'watched', formats: ['streaming'], genre: ['Drama'] },
  { id: 1700000000103, title: 'Another Film', type: 'movie', status: 'watched', formats: ['bluray'], genre: ['Comedy'] },
];
const GAMES = [
  { id: 1700000000201, title: 'Steam Game', status: 'want', platforms: [{ platform: 'steam', formats: [] }] },
  { id: 1700000000202, title: 'PS5 Game', status: 'want', platforms: [{ platform: 'ps5', formats: [] }] },
];

async function open(browser, viewport) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width <= 480 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/openlibrary.org/**', r => r.abort()); await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, [BOOKS, MEDIA, GAMES]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  return { ctx, page, errors };
}

(async () => {
  const browser = await launch();
  const errors = [];

  // ── Desktop: unchanged ─────────────────────────────────────────────
  { const { ctx, page, errors: e } = await open(browser, { width: 1200, height: 900 }); errors.push(...e);
    check('desktop keeps its pill rows and shows no Filters button', await page.locator('#formatPills').isVisible() && await page.locator('#filtersBtn-books').isHidden());
    await ctx.close(); }

  const { ctx, page, errors: e } = await open(browser, { width: 390, height: 844 }); errors.push(...e);
  const sheetOpen = () => page.evaluate(() => document.getElementById('filterModal').classList.contains('open'));
  const opt = (facet, value) => page.locator(`#filterBody .facet-opt[data-facet="${facet}"][data-value="${value}"]`);
  const count = async (facet, value) => Number((await opt(facet, value).locator('.facet-n').innerText({ timeout: 3000 })
    .catch(() => { throw new Error(`no ${facet}:${value} option in the sheet`); })).replace(/,/g, ''));
  const cards = () => page.locator('#booksGrid .book-card .book-title').allInnerTexts();
  const show = () => page.innerText('#filterBody .filter-show');

  // ── Books ──────────────────────────────────────────────────────────
  check('at 390px the pill rows hide and a Filters button shows', await page.locator('#formatPills').isHidden() &&
    await page.locator('#bookGenreFilter').isHidden() && await page.locator('#filtersBtn-books').isVisible());
  check('…next to the sort menu, on one row', await page.evaluate(() => {
    const a = document.getElementById('sortSelect').getBoundingClientRect(), b = document.getElementById('filtersBtn-books').getBoundingClientRect();
    return Math.abs(a.top - b.top) < 8 && b.height >= 44;
  }));
  await page.click('#filtersBtn-books'); await page.waitForTimeout(200);
  check('the button opens the sheet, focus on its close button', await sheetOpen() &&
    await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Close filters'));
  check('sections: Collection, Format, Status, Genre', J(await page.locator('#filterBody .facet-label').allInnerTexts()) ===
    J(['COLLECTION', 'FORMAT', 'STATUS', 'GENRE']) || J(await page.locator('#filterBody .facet-label').allTextContents()) ===
    J(['Collection', 'Format', 'Status', 'Genre']), J(await page.locator('#filterBody .facet-label').allTextContents()));
  check('every option has a count', await count('collection', 'series') === 4 && await count('collection', 'standalone') === 1 &&
    await count('collection', 'gaps') === 2 && await count('format', 'ebook') === 3 && await count('status', 'want') === 3,
    J([await count('collection', 'series'), await count('collection', 'gaps'), await count('format', 'ebook')]));
  check('"Show 5 books" to start, "Clear all" disabled', /Show 5 books/.test(await show()) && await page.locator('#filterBody .filter-clear').isDisabled());
  check('a zero-count option is disabled', await opt('status', 'not-interested').isDisabled() &&
    await opt('status', 'not-interested').evaluate(el => getComputedStyle(el).borderStyle === 'dashed'));

  await opt('collection', 'gaps').click(); await page.waitForTimeout(250);
  check('Series with gaps narrows the list to that series', J((await cards()).sort()) === J(['Saga One', 'Saga Three']), J(await cards()));
  check('…marks the option pressed and keeps focus on it', await opt('collection', 'gaps').getAttribute('aria-pressed') === 'true' &&
    await page.evaluate(() => document.activeElement.dataset.value === 'gaps'));
  check('…and the other counts follow it', await count('format', 'ebook') === 2 && await count('format', 'physical') === 0 &&
    await opt('format', 'physical').isDisabled() && await count('status', 'read') === 1 && /Show 2 books/.test(await show()));
  check('the Collection counts ignore their own choice', await count('collection', 'standalone') === 1);

  await opt('status', 'read').click(); await page.waitForTimeout(250);
  check('facets combine', J(await cards()) === J(['Saga Three']) && /Show 1 book\b/.test(await show()));
  await opt('collection', 'gaps').click(); await page.waitForTimeout(250);
  check('tapping a shown option again hides it instead', await opt('collection', 'gaps').getAttribute('aria-pressed') === 'mixed' &&
    J(await cards()) === J([]) && /Show 0 books/.test(await show()), J(await cards()));
  await opt('collection', 'gaps').click(); await page.waitForTimeout(250);
  check('…and a third tap clears it', await opt('collection', 'gaps').getAttribute('aria-pressed') === 'false' && /Show 1 book\b/.test(await show()));
  await opt('status', 'read').click(); await page.waitForTimeout(250);
  check('hiding Read leaves everything else', /Show 4 books/.test(await show()) && !(await cards()).includes('Saga Three'), await show());
  await opt('status', 'read').click(); await page.waitForTimeout(250);

  await opt('genres', 'Fantasy').click(); await opt('genres', 'Mystery').click(); await page.waitForTimeout(250);
  check('genres are "any of"', J((await cards()).sort()) === J(['Saga One', 'Saga Three', 'Whole One']), J(await cards()));
  check('the Filters button counts what is on', (await page.innerText('#filtersBtn-books')).replace(/\s+/g, ' ').trim() === 'Filters 2');
  await opt('format', 'audio').click(); await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('Esc closes the sheet and focus returns to the Filters button', !(await sheetOpen()) &&
    await page.evaluate(() => document.activeElement.id === 'filtersBtn-books'));
  check('the desktop pills follow the sheet', await page.evaluate(() =>
    [...document.querySelectorAll('#formatPills .pill.active')].map(p => p.textContent.trim()).join() === '🎧 Audio'));

  await page.fill('#searchInput', 'whole'); await page.waitForTimeout(500);
  await page.click('#filtersBtn-books'); await page.waitForTimeout(200);
  check('the counts follow the search too', await count('collection', 'gaps') === 0 && await count('format', 'audio') === 1, J(await count('format', 'audio')));
  await page.click('#filterBody .filter-clear'); await page.waitForTimeout(250);
  check('"Clear all" clears every facet (the search stays)', await page.evaluate(() => !facetOn(filters.format) && !facetOn(filters.status) &&
    !facetOn(filters.collection) && !facetOn(filters.genres)) && /Show 2 books/.test(await show()));
  await page.click('#filterBody .filter-show'); await page.waitForTimeout(200);
  check('"Show N" closes the sheet', !(await sheetOpen()));
  await page.fill('#searchInput', ''); await page.waitForTimeout(500);

  // In the Series view the footer counts entries.
  await page.click('#viewToggle [data-view="series"]'); await page.waitForTimeout(250);
  await page.click('#filtersBtn-books'); await page.waitForTimeout(200);
  check('in the Series view the footer counts entries', /Show 3 entries/.test(await show()), await show());
  await opt('collection', 'series').click(); await page.waitForTimeout(250);
  check('…and follows the facets', /Show 2 entries/.test(await show()) && await page.locator('#booksGrid .series-block').count() === 2);
  await page.click('#filterBody .filter-clear'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.click('#viewToggle [data-view="card"]'); await page.waitForTimeout(200);

  // ── Movies & TV ────────────────────────────────────────────────────
  await page.evaluate(() => switchTab('media')); await page.waitForTimeout(250);
  check('Movies & TV: rows hidden, Filters shown', await page.locator('#altContent .facet-row').first().isHidden() && await page.locator('#filtersBtn-media').isVisible());
  await page.click('#filtersBtn-media'); await page.waitForTimeout(200);
  check('its facets: Type, Status, Format, Genre', J(await page.locator('#filterBody .facet-label').allTextContents()) === J(['Type', 'Status', 'Format', 'Genre']));
  check('with counts', await count('type', 'movie') === 2 && await count('type', 'tv') === 1 && /Show 3 titles/.test(await show()));
  await opt('type', 'tv').click(); await page.waitForTimeout(250);
  check('a facet filters the tab beneath', J(await page.locator('#altContent .book-title').allInnerTexts()) === J(['A Show']) &&
    await count('format', 'dvd') === 0 && await opt('format', 'dvd').isDisabled());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('focus returns to the re-rendered Filters button, which counts 1', await page.evaluate(() => document.activeElement.id === 'filtersBtn-media') &&
    (await page.innerText('#filtersBtn-media')).replace(/\s+/g, ' ').trim() === 'Filters 1');

  // ── Games ──────────────────────────────────────────────────────────
  await page.evaluate(() => switchTab('games')); await page.waitForTimeout(250);
  await page.click('#filtersBtn-games'); await page.waitForTimeout(200);
  check('Games: Platform facet with counts', await count('platform', 'pc') === 1 && await count('platform', 'ps5') === 1);
  await opt('platform', 'ps5').click(); await page.waitForTimeout(250);
  check('…that filters', J(await page.locator('#altContent .book-title').allInnerTexts()) === J(['PS5 Game']) && /Show 1 game\b/.test(await show()));
  await page.locator('#filterModal').click({ position: { x: 195, y: 20 } }); await page.waitForTimeout(200);
  check('a tap on the backdrop closes it', !(await sheetOpen()));
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/filters-games.png` });
  await ctx.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
