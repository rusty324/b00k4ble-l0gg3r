// Editions on copies, TV seasons, the search ✕, and the phone zoom-out fix.
const { launch, BASE, REPO, tmp, shot, viaDetail, detailFact, closeDetailSheet } = require('../lib');
const results = []; const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
const J = JSON.stringify;
const LINKS = ['https://tv.apple.com/us/movie/airplane/umc.cmc.1', 'https://moviesanywhere.com/movie/airplane', 'https://www.vudu.com/content/movies/details/Airplane/123'];
const MEDIA = [
  { id: 1700000000001, title: 'Airplane!', type: 'movie', year: '1980', status: 'want', formats: ['dvd'], genre: ['Comedy'], links: LINKS },
  { id: 1700000000002, title: 'Rick and Morty', type: 'tv', year: '2013', status: 'watched', formats: ['bluray'], tmdbId: 60625 },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'en-US' });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/image.tmdb.org/**', r => r.abort());
  const tvAsks = [];
  await ctx.route('**/api.themoviedb.org/**', r => {
    const u = new URL(r.request().url());
    const json = b => r.fulfill({ status: 200, contentType: 'application/json', body: J(b) });
    if (/^\/3\/tv\/\d+$/.test(u.pathname)) { tvAsks.push(u.pathname); return json({ id: +u.pathname.split('/').pop(), number_of_seasons: 8 }); }
    if (u.pathname.includes('/genre/')) return json({ genres: [] });
    return json({ results: [] });
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(m => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify([{ id: 1700000000010, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['ebook'],
      links: ['https://www.amazon.com/dp/B00B7NPRY8', 'https://www.audible.com/pd/B002V1OF70', 'https://app.thestorygraph.com/books/abc'] }]));
    localStorage.setItem('bookWishlist', JSON.stringify([{ id: 1700000000020, type: 'book', title: 'Wish', creator: 'X' }]));
    localStorage.setItem('videoGames', JSON.stringify([{ id: 1700000000030, title: 'Hades', status: 'playing', platforms: [{ platform: 'steam', formats: [] }],
      links: ['https://store.steampowered.com/app/1145360/Hades/', 'https://store.playstation.com/en-us/concept/10001', 'https://www.xbox.com/en-US/games/store/hades/9p8dl6w0jbcv'] }]));
    localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('activeTab', 'media'); localStorage.setItem('viewMode', 'card'); localStorage.setItem('tmdbKey', 'test-key');
  }, MEDIA);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. The phone zoom-out ───────────────────────────────────────────
  const fits = async () => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth }));
  let w = await fits();
  check('movies: a card with three store links no longer widens the page past the screen', w.doc <= 390 && w.vw === 390, J(w));
  for (const tab of ['books', 'games']) {
    await page.click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(300);
    w = await fits();
    check(`${tab}: same for its cards`, w.doc <= 390 && w.vw === 390, J(w));
  }
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  // The store links that once widened the card now live in its detail sheet;
  // they must wrap inside it just the same.
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Airplane!' }));
  const act = await page.evaluate(() => { const s = document.querySelector('#detailModal .detail-modal').getBoundingClientRect();
    const l = document.querySelector('#detailModal .detail-links').getBoundingClientRect();
    return { linksRight: Math.round(l.right), sheetRight: Math.round(s.right), doc: document.documentElement.scrollWidth }; });
  check('the store links wrap inside the detail sheet, and the page stays phone-width', act.linksRight <= act.sheetRight && act.doc <= 390, J(act));
  await closeDetailSheet(page);

  // ── 2. Normalizer ───────────────────────────────────────────────────
  const n = await page.evaluate(() => {
    const N = x => normalizeMediaItem({ id: 1, title: 'X', ...x });
    return {
      kept:       copyEditions(N({ formats: ['dvd'], editions: { dvd: '  Shirley Edition ' } }).copies),
      orphan:     'editions' in N({ formats: ['bluray'], editions: { dvd: 'Gone' } }),
      streaming:  'editions' in N({ formats: ['streaming'], editions: { streaming: 'Nope' } }),
      blank:      'editions' in N({ formats: ['dvd'], editions: { dvd: '   ' } }),
      none:       Object.keys(N({ formats: ['dvd'] })).filter(k => ['editions', 'seasons', 'seasonCount'].includes(k)),
      seasons:    N({ type: 'tv', seasons: [3, 1, 1, '2', 0, -1, 2.5, 'x'] }).seasons,
      movieDrops: Object.keys(N({ type: 'movie', seasons: [1], seasonCount: 8 })).filter(k => k.startsWith('season')),
      count:      N({ type: 'tv', seasons: [1], seasonCount: '8' }).seasonCount,
      idem:       (() => { const a = N({ type: 'tv', formats: ['dvd'], editions: { dvd: 'E' }, seasons: [2, 1], seasonCount: 3 }); return JSON.stringify(a) === JSON.stringify(normalizeMediaItem(a)); })(),
    };
  });
  check('an edition is kept, trimmed, for a held format', J(n.kept) === '{"dvd":"Shirley Edition"}', J(n.kept));
  check('an edition for a format not held is dropped', n.orphan === false);
  check('streaming takes no edition', n.streaming === false);
  check('a blank edition is not stored', n.blank === false);
  check('a title with none of these gains no new keys', J(n.none) === '[]', J(n.none));
  check('seasons are whole, positive, unique, ascending', J(n.seasons) === '[1,2,3]', J(n.seasons));
  check('a Movie keeps no seasons', J(n.movieDrops) === '[]', J(n.movieDrops));
  check('season count is coerced to a number', n.count === 8);
  check('normalizing twice changes nothing', n.idem);

  // ── 3. Editions in the form ─────────────────────────────────────────
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Airplane!' }), 'Edit');
  await page.waitForSelector('#mediaModal.open');
  // The Copies editor (js/app/media-copies.js) replaced the format checkboxes.
  const rows = () => page.locator('#m-copies .copy-row').evaluateAll(els => els.map(e => e.querySelector('select').value));
  check('editing a DVD title shows one copy, a DVD', J(await rows()) === '["dvd"]', J(await rows()));
  await page.fill('#m-copies [data-copy="0"] [data-field="edition"]', '“Don’t Call Me Shirley!” Edition');
  check('typing keeps focus in the box (it is not rebuilt per keystroke)', await page.evaluate(() => document.activeElement && document.activeElement.dataset.field === 'edition'));
  await page.click('#mediaModal button:has-text("Add a copy")'); await page.waitForTimeout(100);
  await page.selectOption('#m-copies [data-copy="1"] select', 'streaming'); await page.waitForTimeout(100);
  check('a Streaming copy takes no edition box', await page.locator('#m-copies [data-copy="1"] [data-field="edition"]').isHidden());
  check('…and the first copy keeps what was typed', await page.inputValue('#m-copies [data-copy="0"] [data-field="edition"]') === '“Don’t Call Me Shirley!” Edition');
  await page.click('#m-copies button[aria-label="Remove copy 2"]'); await page.waitForTimeout(100);
  check('removing a copy leaves the other', J(await rows()) === '["dvd"]');
  check('the Seasons group stays hidden for a movie', await page.evaluate(() => document.getElementById('m-seasons-group').style.display === 'none'));
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(400);
  const air = await page.evaluate(() => mediaLibrary.find(m => m.id === 1700000000001));
  check('saved: the DVD edition, and no streaming copy', J(air.copies.map(c => [c.format, c.edition])) === J([['dvd', '“Don’t Call Me Shirley!” Edition']]), J(air.copies));
  const card = page.locator('#altContent .book-card', { hasText: 'Airplane!' });
  await viaDetail(card);
  check('the detail sheet spells the edition out', (await detailFact(page, 'Copy')) === '💿 DVD — “Don’t Call Me Shirley!” Edition', await detailFact(page, 'Copy'));
  await closeDetailSheet(page);
  check('and the format badge carries it on hover', await card.locator('.badge-media').first().getAttribute('title') === 'DVD — “Don’t Call Me Shirley!” Edition');

  // ── 4. Search reaches editions; the ✕ clears ────────────────────────
  const titles = () => page.evaluate(() => [...document.querySelectorAll('#mediaListWrap .book-title')].map(e => e.textContent));
  const clearVisible = sel => page.evaluate(s => { const b = document.querySelector(s).parentElement.querySelector('.search-clear'); return !!b && getComputedStyle(b).display !== 'none'; }, sel);
  check('no ✕ while the box is empty', !(await clearVisible('#mediaSearchInput')));
  await page.fill('#mediaSearchInput', 'shirley'); await page.waitForTimeout(400);
  check('searching an edition name finds the title', J(await titles()) === '["Airplane!"]', J(await titles()));
  check('the ✕ appears once there is text', await clearVisible('#mediaSearchInput'));
  // Keyboard put away (as after scrolling the results), then a real touch tap.
  await page.evaluate(() => document.activeElement.blur());
  await page.tap('#mediaSearchInput + .search-clear'); await page.waitForTimeout(400);
  check('tapping ✕ empties the box and brings every title back',
    (await page.inputValue('#mediaSearchInput')) === '' && (await titles()).length === 2 && !(await clearVisible('#mediaSearchInput')), J(await titles()));
  check('and, with the keyboard down, a tap on ✕ does not raise it again', await page.evaluate(() => document.activeElement.id !== 'mediaSearchInput'));

  // ── 5. Seasons: an existing show with a TMDb id, picked per copy ────
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Rick and Morty' }), 'Edit');
  await page.waitForSelector('#mediaModal.open'); await page.waitForTimeout(400);
  const copyChips = i => page.locator(`#m-copies [data-copy="${i}"] .copy-seasons .fmt-chip`).allTextContents().then(a => a.map(t => t.trim()));
  check('a show with a copy picks seasons on the copy, not title-wide', await page.evaluate(() => document.getElementById('m-seasons-group').style.display === 'none') &&
    await page.locator('#m-copies [data-copy="0"] .copy-seasons').count() === 1);
  check('TMDb is asked how many seasons it has, and the copy offers one chip each',
    tvAsks.includes('/3/tv/60625') && J(await copyChips(0)) === J(['1','2','3','4','5','6','7','8','All','+ Season']), J(await copyChips(0)));
  check('the copy says where the count came from', /TMDb lists 8/.test(await page.textContent('#m-copies [data-copy="0"] .copy-seasons')));
  await page.click('#m-copies [aria-label="Copy 1, season 1"]');
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(400);
  let rm = await page.evaluate(() => mediaLibrary.find(m => m.id === 1700000000002));
  check('saved: season 1 on the Blu-ray copy, 8 known', J(rm.copies[0].seasons) === '[1]' && J(rm.seasons) === '[1]' && rm.seasonCount === 8, J(rm));
  check('the card reads "Season 1 of 8"', (await page.locator('#altContent .book-card', { hasText: 'Rick and Morty' }).locator('.badge-seasons').textContent()) === 'Season 1 of 8');

  // A second copy with other seasons; "All" on a copy
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Rick and Morty' }), 'Edit');
  await page.waitForSelector('#mediaModal.open'); await page.waitForTimeout(300);
  await page.click('#mediaModal button:has-text("Add a copy")'); await page.selectOption('#m-copies [data-copy="1"] select', 'digital');
  await page.click('#m-copies [aria-label="Copy 2, season 4"]'); await page.click('#m-copies [aria-label="Copy 2, season 5"]');
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(400);
  rm = await page.evaluate(() => mediaLibrary.find(m => m.id === 1700000000002));
  check('each copy keeps its own seasons; the title holds their union',
    J(rm.copies.map(c => c.seasons)) === '[[1],[4,5]]' && J(rm.seasons) === '[1,4,5]', J(rm.copies));
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Rick and Morty' }));
  const cf = await detailFact(page, 'Copies');
  check('the detail sheet gives each copy its seasons', /Blu-ray · Season 1/.test(cf) && /Digital · Seasons 4–5/.test(cf), cf);
  await closeDetailSheet(page);
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Rick and Morty' }), 'Edit');
  await page.waitForSelector('#mediaModal.open'); await page.waitForTimeout(300);
  await page.locator('#m-copies [data-copy="0"] .season-all').click();
  check('"All" on a copy ticks every season', (await page.locator('#m-copies [data-copy="0"] .season-chip.active').count()) === 8);
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(400);
  check('…and the card says so', (await page.locator('#altContent .book-card', { hasText: 'Rick and Morty' }).locator('.badge-seasons').textContent()) === 'All 8 seasons');

  const chips = () => page.locator('#m-season-chips .fmt-chip').allTextContents().then(a => a.map(t => t.trim()));
  // ── 6. A new show from a TMDb pick ──────────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#mediaModal.open');
  await page.evaluate(() => { _tmdbResults = [{ title: 'Futurama', year: '1999', type: 'tv', tmdbId: 615, genre: [] }]; tmdbPick(0); });
  await page.waitForTimeout(400);
  check('picking a TV result shows Seasons and fetches its count', tvAsks.includes('/3/tv/615') && (await chips()).length === 10, J(await chips()));
  await page.evaluate(() => closeMediaModal());

  // ── 7. No TMDb data: "+ Season" ─────────────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#mediaModal.open');
  await page.fill('#m-title', 'Some Local Show'); await page.click('label[for="m-type-tv"]'); await page.waitForTimeout(100);
  check('with no TMDb data, a show starts with season 1 and "+ Season"', J(await chips()) === J(['1', '+ Season']), J(await chips()));
  await page.locator('#m-season-chips .season-add').click(); await page.locator('#m-season-chips .season-add').click();
  await page.locator('#m-season-chips .season-chip', { hasText: /^3$/ }).click();
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(400);
  const local = await page.evaluate(() => mediaLibrary.find(m => m.title === 'Some Local Show'));
  check('"+ Season" offers more; only the tapped one is owned', J(local.seasons) === '[3]' && !('seasonCount' in local), J(local));
  check('its card reads "Season 3" (no total known)', (await page.locator('#altContent .book-card', { hasText: 'Some Local Show' }).locator('.badge-seasons').textContent()) === 'Season 3');

  // switching a show to Movie drops its seasons
  await viaDetail(page.locator('#altContent .book-card', { hasText: 'Some Local Show' }), 'Edit');
  await page.waitForSelector('#mediaModal.open'); await page.click('label[for="m-type-movie"]'); await page.waitForTimeout(100);
  check('switching to Movie hides Seasons', await page.evaluate(() => document.getElementById('m-seasons-group').style.display === 'none'));
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(400);
  check('and saving as a Movie drops them', await page.evaluate(() => !('seasons' in mediaLibrary.find(m => m.title === 'Some Local Show'))));

  // ── 8. The ✕ on the other tabs ──────────────────────────────────────
  for (const [tab, sel] of [['books', '#searchInput'], ['games', '#gameSearchInput'], ['wishlist', '#wishlistSearchInput']]) {
    await page.click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(300);
    await page.fill(sel, 'zzz-nothing'); await page.waitForTimeout(400);
    const shown = await clearVisible(sel);
    await page.locator(sel).evaluate(i => i.parentElement.querySelector('.search-clear').click()); await page.waitForTimeout(400);
    const after = await page.evaluate(s => ({ v: document.querySelector(s).value,
      empty: !!document.querySelector('#booksGrid .empty-state, #altContent .empty-state') }), sel);
    check(`${tab}: the ✕ appears, clears the box and restores the list`, shown && after.v === '' && !after.empty, J({ shown, ...after }));
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
