// "What am I missing?" — series gaps, seasons not owned, wishlisted DLC.
const { launch, BASE, reporter, detailFact, closeDetailSheet, viaDetail } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const bk = (id, title, series) => ({ id, title, author: 'X', status: 'want', formats: ['ebook'], ...(series ? { series } : {}) });

const BOOKS = [
  bk(1700000000001, 'Leviathan Wakes', 'The Expanse #1'), bk(1700000000002, 'Abaddon\'s Gate', 'The Expanse #3'),
  bk(1700000000003, 'Cibola Burn', 'The Expanse #4'), bk(1700000000004, 'The Churn', 'The Expanse #4.5'),
  bk(1700000000005, 'Wyrd Sisters', 'Discworld #6'),
  bk(1700000000006, 'Mistborn', 'Mistborn #1'), bk(1700000000007, 'The Well of Ascension', 'Mistborn #2'),
  bk(1700000000008, 'Some Saga', 'Standalone Saga'), bk(1700000000009, 'No Series'),
];
const MEDIA = [
  { id: 1700000000101, title: 'Rick and Morty', type: 'tv', seasons: [1], seasonCount: 8 },
  { id: 1700000000102, title: 'Local Show', type: 'tv', seasons: [1, 3] },
  { id: 1700000000103, title: 'Untracked Show', type: 'tv' },
  { id: 1700000000104, title: 'Complete Show', type: 'tv', seasons: [1, 2], seasonCount: 2 },
  { id: 1700000000105, title: 'A Movie', type: 'movie' },
];
const GAMES = [
  { id: 1700000000201, title: 'Mass Effect 2', platforms: [{ platform: 'steam', formats: [] }],
    dlc: [{ name: 'Arrival', owned: true }, { name: 'Overlord', owned: false }, { name: 'Kasumi', owned: false }] },
  { id: 1700000000202, title: 'Hades', platforms: [{ platform: 'steam', formats: [] }], dlc: [{ name: 'Pack', owned: true }] },
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
  const sheetOpen = () => page.evaluate(() => document.getElementById('missingModal').classList.contains('open'));
  const items = () => page.locator('#missingBody .missing-item').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));

  // ── 1. Books: series gaps ───────────────────────────────────────────
  const gaps = await page.evaluate(() => seriesGaps().map(s => ({ name: s.name, missing: s.missing, have: s.have })));
  check('series gaps: The Expanse is missing #2; the #4.5 novella is not a gap', J(gaps.find(s => s.name === 'The Expanse')) === J({ name: 'The Expanse', missing: [2], have: [1, 3, 4] }), J(gaps));
  check('counted from #1: owning only Discworld #6 lists #1–5', J(gaps.find(s => s.name === 'Discworld').missing) === '[1,2,3,4,5]');
  check('a complete series and an unnumbered one are not listed', !gaps.some(s => /Mistborn|Standalone/.test(s.name)) && gaps.length === 2, J(gaps.map(s => s.name)));
  const btn = page.locator('#booksMissing .missing-btn');
  check('the Books tab shows "What am I missing?" with a count', (await btn.innerText()).replace(/\s+/g, ' ').trim() === 'What am I missing? 2', await btn.innerText());
  await btn.click(); await page.waitForTimeout(200);
  const bi = await items();
  check('its sheet lists each series, what is missing and what you have', await sheetOpen() &&
    bi.some(t => /Discworld Missing #1–#5 You have #6/.test(t)) && bi.some(t => /The Expanse Missing #2 You have #1, #3–#4/.test(t)), J(bi));
  await page.locator('#missingBody .missing-item', { hasText: 'The Expanse' }).locator('button', { hasText: 'Add #2' }).click();
  await page.waitForTimeout(200);
  check('"Add #2" opens the add form with the series and number filled in', !(await sheetOpen()) && await page.evaluate(() =>
    document.getElementById('modal').classList.contains('open') && document.getElementById('f-series').value === 'The Expanse' &&
    document.getElementById('f-seriesIndex').value === '2'));
  await page.evaluate(() => closeModal());
  await viaDetail(page.locator('#booksGrid .book-card', { hasText: "Abaddon's Gate" }));
  check("a book's detail sheet names its series' gaps", (await detailFact(page, 'Series gaps')) === 'Missing #2', await detailFact(page, 'Series gaps'));
  await closeDetailSheet(page);

  // ── 2. Movies & TV: seasons ─────────────────────────────────────────
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  const mbtn = page.locator('#altContent .missing-btn');
  check('Movies & TV counts the shows with seasons missing', (await mbtn.innerText()).replace(/\s+/g, ' ').trim() === 'What am I missing? 2', await mbtn.innerText());
  await mbtn.click(); await page.waitForTimeout(200);
  const mi = await items();
  check('against TMDb\'s total where known: Rick and Morty is missing 2–8', mi.some(t => /Rick and Morty Missing seasons 2–8 You have 1 of 8/.test(t)), J(mi));
  check('below the highest owned where not: Local Show is missing 2', mi.some(t => /Local Show Missing season 2/.test(t)), J(mi));
  check('untracked, complete shows and movies are not listed', mi.length === 2);
  await page.locator('#missingBody .missing-item', { hasText: 'Rick and Morty' }).click(); await page.waitForTimeout(200);
  check('tapping a show opens its details, which say what is missing', !(await sheetOpen()) && (await detailFact(page, 'Missing')) === 'Seasons 2–8', await detailFact(page, 'Missing'));
  await closeDetailSheet(page);

  // ── 3. Games: wishlisted DLC ────────────────────────────────────────
  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  await page.locator('#altContent .missing-btn').click(); await page.waitForTimeout(200);
  const gi = await items();
  check('Games lists only games with DLC on the wishlist, naming it', J(gi) === J(['Mass Effect 2 Overlord · Kasumi']), J(gi));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('Escape closes the sheet', !(await sheetOpen()));

  // ── 4. Nothing missing, no button ───────────────────────────────────
  await page.evaluate(() => { videoGames.forEach(g => (g.dlc || []).forEach(d => { d.owned = true; })); saveGames(); renderPage(); });
  await page.waitForTimeout(300);
  check('with nothing missing, the button is not shown', (await page.locator('#altContent .missing-btn').count()) === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
