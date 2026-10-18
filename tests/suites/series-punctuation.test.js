// Straight and curly apostrophes (and other typographic punctuation) mean the
// same thing: "Old Man's War" and "Old Man’s War" are one series, and search
// finds either spelling with either.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const bk = (id, title, series) => ({ id, title, author: 'John Scalzi', status: 'want', formats: ['ebook'], ...(series ? { series } : {}) });

const BOOKS = [
  bk(1700000000001, "Old Man's War", "Old Man's War #1"),
  bk(1700000000002, 'The Ghost Brigades', 'Old Man’s War #2'),       // curly — typed on an iPhone
  bk(1700000000003, 'Zoe’s Tale', "old man's war #4"),               // and lowercase
  bk(1700000000004, 'Redshirts', 'Dahl’s Log #1'),
  bk(1700000000005, 'Agent to the Stars'),
];
const MEDIA = [{ id: 1700000000101, title: 'Don’t Look Up', type: 'movie', status: 'want', formats: ['streaming'] }];
const GAMES = [{ id: 1700000000201, title: "Assassin's Creed", platforms: [{ platform: 'ps4', formats: ['physical'] }], status: 'want' }];

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
  const titles = () => page.locator('#booksGrid .book-title').allTextContents();

  // ── 1. Helpers ──────────────────────────────────────────────────────
  const h = await page.evaluate(() => ({
    key: [seriesKey("Old Man's War"), seriesKey('Old Man’s War'), seriesKey('  old  man‘s war ')],
    split: [splitSeries('Old Man’s War #2'), splitSeries('Discworld 4.5'), splitSeries('Standalone'), splitSeries('')],
    fold: foldPunct('“Don’t” — it‘s 1–2'),
  }));
  check('every apostrophe, case and spacing give one series key', new Set(h.key).size === 1, J(h.key));
  check('splitSeries reads "Name #N", "Name N" and an unnumbered name', J(h.split) === J([
    { name: 'Old Man’s War', number: '2' }, { name: 'Discworld', number: '4.5' }, { name: 'Standalone', number: '' }, { name: '', number: '' }]), J(h.split));
  check('quotes and dashes fold to their plain forms', h.fold === '"Don\'t" - it\'s 1-2', h.fold);

  // ── 2. One series, wherever series are grouped ──────────────────────
  const gaps = await page.evaluate(() => seriesGaps().map(s => ({ name: s.name, have: s.have, missing: s.missing })));
  check('"What am I missing?" lists one Old Man\'s War, missing #3, under the most-used spelling',
    J(gaps.filter(s => /old man/i.test(s.name))) === J([{ name: "Old Man's War", have: [1, 2, 4], missing: [3] }]), J(gaps));
  const dl = await page.evaluate(() => { populateDataLists(); return [...document.querySelectorAll('#dl-series option')].map(o => o.value); });
  check('the series suggestions offer it once', J(dl) === J(["Dahl’s Log", "Old Man's War"]), J(dl));
  await page.selectOption('#sortSelect', 'series-asc'); await page.waitForTimeout(300);
  const sorted = await titles();
  check('the Series sort keeps it together, in order', J(sorted.slice(0, 4)) === J(['Redshirts', "Old Man's War", 'The Ghost Brigades', 'Zoe’s Tale']), J(sorted));
  await page.selectOption('#sortSelect', 'added-desc');

  // ── 3. Search finds either spelling with either ─────────────────────
  for (const q of ["man's war", 'man’s war']) {
    await page.fill('#searchInput', q); await page.waitForTimeout(400);
    const t = await titles();
    check(`searching ${q} finds all three`, t.length === 3, J(t));
  }
  await page.fill('#searchInput', "zoe's"); await page.waitForTimeout(400);
  check('a straight apostrophe finds a curly title', J(await titles()) === J(['Zoe’s Tale']), J(await titles()));
  await page.fill('#searchInput', ''); await page.waitForTimeout(400);
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  await page.fill('#mediaSearchInput', "don't"); await page.waitForTimeout(400);
  check('Movies & TV search too', await page.locator('#altContent .book-card').count() === 1);
  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  await page.fill('#gameSearchInput', 'assassin’s'); await page.waitForTimeout(400);
  check('Games search too', await page.locator('#altContent .book-card').count() === 1);
  await page.click('.tab[data-tab="books"]'); await page.waitForTimeout(300);

  // ── 4. Saving: a new variant joins the existing series ──────────────
  const addWithSeries = async (title, series, n) => {
    await page.evaluate(() => openAddModal());
    await page.fill('#f-title', title); await page.fill('#f-series', series); await page.fill('#f-seriesIndex', n);
    await page.evaluate(() => saveBook()); await page.waitForTimeout(200);
  };
  const seriesOf = t => page.evaluate(t => books.find(b => b.title === t)?.series, t);
  await addWithSeries('The Last Colony', 'OLD MAN‘S WAR', '3');
  check('a new variant takes the library\'s spelling', (await seriesOf('The Last Colony')) === "Old Man's War #3", await seriesOf('The Last Colony'));
  await addWithSeries('The Human Division', 'Old Man’s War', '5');
  check('a spelling some book already uses is kept as typed', (await seriesOf('The Human Division')) === 'Old Man’s War #5', await seriesOf('The Human Division'));
  // Editing the only book of a series to a new spelling must stick.
  await page.evaluate(() => openEditModal(1700000000004)); await page.fill('#f-series', "Dahl's Log");
  await page.evaluate(() => saveBook()); await page.waitForTimeout(200);
  check("re-spelling a series's only book sticks", (await seriesOf('Redshirts')) === "Dahl's Log #1", await seriesOf('Redshirts'));
  const after = await page.evaluate(() => seriesGaps().filter(s => /old man/i.test(s.name)).length);
  check('with #3 added, Old Man\'s War has no gaps', after === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
