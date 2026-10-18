// Series gaps: bundles ("#1-3") own every number they hold; Ignore hides a
// series's current gaps (synced on its books) and Reset ignored brings them
// back. Also: genres spelled with curly and straight apostrophes are one.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const bk = (id, title, series, extra = {}) => ({ id, title, author: 'X', status: 'want', formats: ['ebook'], ...(series ? { series } : {}), ...extra });

const BOOKS = [
  bk(1700000000001, 'The Expanse Omnibus', 'The Expanse #1-3'),
  bk(1700000000002, 'Babylon’s Ashes', 'The Expanse #6'),
  bk(1700000000003, 'First Law Trilogy', 'First Law #1 – 3'),         // en dash, spaced
  bk(1700000000004, 'Best Served Cold', 'First Law #4'),
  bk(1700000000005, 'Mistborn', 'Mistborn #1'),
  bk(1700000000006, 'The Hero of Ages', 'Mistborn #3'),
  bk(1700000000007, 'Odd Bundle', 'Weird #3-1'),                       // backwards: just its ends
  bk(1700000000010, 'A', null, { genre: ["Children's"] }),
  bk(1700000000011, 'B', null, { genre: ['Children’s'] }),
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', '[]');
    localStorage.setItem('videoGames', '[]'); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, BOOKS);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);
  const gaps = () => page.evaluate(() => seriesGaps().map(s => `${s.name}: have ${s.have.join(',')} missing ${s.missing.join(',')}`));
  const btnText = () => page.locator('#booksMissing .missing-btn').innerText().then(t => t.replace(/\s+/g, ' ').trim()).catch(() => null);
  const rows = () => page.locator('#missingBody .missing-item .missing-name').allTextContents();

  // ── 1. Bundles ──────────────────────────────────────────────────────
  const nums = await page.evaluate(() => ['1-3', '1–3', '4.5', '2', '3-1', '1-300', ''].map(seriesNumbers));
  check('seriesNumbers: ranges, dashes, half-numbers, and implausible ranges as just their ends',
    J(nums) === J([[1, 2, 3], [1, 2, 3], [4.5], [2], [1, 3], [1, 300], []]), J(nums));
  const g = await gaps();
  check('a #1-3 bundle owns 1, 2 and 3: The Expanse is missing only #4–5', g.includes('The Expanse: have 1,2,3,6 missing 4,5'), J(g));
  check('an en-dashed, spaced "#1 – 3" bundle counts too: First Law has no gaps', !g.some(s => s.startsWith('First Law')), J(g));
  check('a backwards range counts as its ends', g.includes('Weird: have 1,3 missing 2'), J(g));
  const split = await page.evaluate(() => { openEditModal(1700000000001); const r = [document.getElementById('f-series').value, document.getElementById('f-seriesIndex').value]; closeModal(); return r; });
  check('editing a bundle splits it into the series and "1-3"', J(split) === J(['The Expanse', '1-3']), J(split));
  await page.selectOption('#sortSelect', 'series-asc'); await page.waitForTimeout(300);
  const order = await page.locator('#booksGrid .book-title').allTextContents();
  check('the Series sort puts a bundle at its first number', order.indexOf('The Expanse Omnibus') < order.indexOf('Babylon’s Ashes') &&
    order.indexOf('First Law Trilogy') < order.indexOf('Best Served Cold'), J(order));
  await page.selectOption('#sortSelect', 'added-desc');

  // ── 2. Ignore ───────────────────────────────────────────────────────
  check('the button counts three series', (await btnText()) === 'What am I missing? 3', await btnText());
  await page.click('#booksMissing .missing-btn'); await page.waitForTimeout(200);
  check('no "Reset ignored" while nothing is ignored', await page.locator('#missingBody button', { hasText: 'Reset ignored' }).count() === 0);
  await page.locator('#missingBody .missing-item', { hasText: 'The Expanse' }).locator('button', { hasText: 'Ignore' }).click();
  await page.waitForTimeout(200);
  check('Ignore removes the row and leaves the sheet open', J(await rows()) === J(['Mistborn', 'Weird']) &&
    await page.locator('#missingModal.open').count() === 1, J(await rows()));
  check('…stores the gaps on every book of the series, so they sync',
    J(await page.evaluate(() => books.filter(b => /Expanse/.test(b.series)).map(b => b.ignoredGaps))) === J([[4, 5], [4, 5]]));
  check('…and survives a save round-trip in storage',
    await page.evaluate(() => JSON.parse(localStorage.getItem('myLibrary')).filter(b => b.ignoredGaps).length === 2));
  check('the footer says one series is ignored, with Reset', (await page.locator('#missingBody .missing-ignored').textContent()) === '1 series ignored' &&
    await page.locator('#missingBody button', { hasText: 'Reset ignored' }).count() === 1);
  check('the count drops to 2', (await btnText()) === 'What am I missing? 2', await btnText());
  check("the book's detail sheet no longer lists ignored gaps", await page.evaluate(() => {
    openDetail('books', 1700000000002);
    const dt = [...document.querySelectorAll('#detailModal .detail-facts dt')].find(d => d.textContent === 'Series gaps');
    closeDetail(); return !dt;
  }));

  // A new gap in an ignored series still shows.
  await page.evaluate(() => { closeMissing(); books.push(normalizeBook({ id: 1700000000020, title: 'Leviathan Falls', author: 'X', formats: ['ebook'], series: 'The Expanse #9' })); save(); renderPage(); });
  const g2 = await gaps();
  check('a gap that opens later in an ignored series is listed (#7–8), the ignored #4–5 are not',
    g2.includes('The Expanse: have 1,2,3,6,9 missing 7,8'), J(g2));
  await page.click('#booksMissing .missing-btn'); await page.waitForTimeout(200);
  const have = await page.locator('#missingBody .missing-item', { hasText: 'The Expanse' }).locator('.missing-have').textContent();
  check('its row notes what is being ignored', /ignoring #4–#5/.test(have), have);

  // Moving a book out of the series leaves its ignores behind.
  await page.evaluate(() => { closeMissing(); openEditModal(1700000000002); document.getElementById('f-series').value = 'Other'; document.getElementById('f-seriesIndex').value = '1'; saveBook(); });
  check('a book moved to another series drops the old series\'s ignores',
    await page.evaluate(() => !books.find(b => b.id === 1700000000002).ignoredGaps));
  await page.evaluate(() => { const b = books.find(b => b.id === 1700000000002); openEditModal(b.id); document.getElementById('f-series').value = 'The Expanse'; document.getElementById('f-seriesIndex').value = '6'; saveBook(); });

  // Ignore everything: the button stays, without a count, as the way back.
  await page.click('#booksMissing .missing-btn'); await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) {
    const b = page.locator('#missingBody .missing-item button', { hasText: 'Ignore' }).first();
    if (await b.count()) { await b.click(); await page.waitForTimeout(150); }
  }
  check('with every gap ignored, the sheet says so', /every gap is ignored/.test(await page.locator('#missingBody .missing-list').textContent()));
  await page.evaluate(() => closeMissing());
  check('…and the button stays, without a count', (await btnText()) === 'What am I missing?', await btnText());

  // ── 3. Reset ignored ────────────────────────────────────────────────
  await page.click('#booksMissing .missing-btn'); await page.waitForTimeout(200);
  await page.locator('#missingBody button', { hasText: 'Reset ignored' }).click(); await page.waitForTimeout(200);
  check('Reset ignored brings every series back', (await rows()).length === 3 && (await btnText()) === 'What am I missing? 3', J(await rows()));
  check('…clears the field from every book', await page.evaluate(() => !books.some(b => b.ignoredGaps)));
  check('…and hides itself', await page.locator('#missingBody button', { hasText: 'Reset ignored' }).count() === 0);
  await page.evaluate(() => closeMissing());

  // ── 4. Genres: curly and straight are one ───────────────────────────
  const genres = await page.evaluate(() => allBookGenres());
  check("Children's and Children’s are one genre in the menu and suggestions", J(genres) === J(["Children's"]), J(genres));
  await page.evaluate(() => { filters.genres = ["Children's"]; render(); });
  check('filtering by it shows both books', await page.locator('#booksGrid .book-card').count() === 2);
  await page.evaluate(() => { filters.genres = []; render(); });
  const pill = await page.evaluate(() => { openAddModal(); commitGenrePill('f-genre', 'children’s'); const v = getGenreValues('f-genre'); closeModal(); return v; });
  check('typing a variant in the genre field takes the library\'s spelling', J(pill) === J(["Children's"]), J(pill));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
