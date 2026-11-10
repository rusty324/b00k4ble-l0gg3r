// A short description in each library card's detail sheet: looked up the
// first time the sheet opens, from the right source per kind, kept on the
// record, removable, and never on the card itself.
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const LONG = 'A sprawling story of politics, religion and ecology on a desert planet. '.repeat(12);

const BOOKS = [
  { id: 1700000000001, title: 'Project Hail Mary', author: 'Andy Weir', status: 'want', formats: ['audio'], asin: 'B08G9PRS1K' },
  { id: 1700000000002, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['physical'], isbn: '9780441013593' },
  { id: 1700000000003, title: 'Piranesi', author: 'Susanna Clarke', status: 'want', formats: ['ebook'] },
  { id: 1700000000004, title: 'Unfindable Pamphlet', author: 'Nobody', status: 'want', formats: ['ebook'] },
];
const MEDIA = [
  { id: 1700000000101, title: 'Airplane!', type: 'movie', year: '1980', tmdbId: 813, status: 'want', formats: ['dvd'] },
];
const GAMES = [{ id: 1700000000201, title: 'Hades', status: 'want', platforms: [{ platform: 'steam', formats: ['digital'] }] }];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/covers.openlibrary.org/**', r => r.abort());
  const asked = [];
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: J(body) });
  await ctx.route('**/api.audnex.us/**', r => { asked.push('audible');
    return json(r, { asin: 'B08G9PRS1K', title: 'Project Hail Mary', summary: '<p>Ryland Grace is the sole survivor on a desperate, last-chance mission.</p><p>And if he fails, humanity and the Earth itself will perish.</p>' }); });
  await ctx.route('**/openlibrary.org/**', r => {
    const u = new URL(r.request().url()); asked.push('ol ' + u.pathname);
    if (u.pathname === '/isbn/9780441013593.json') return json(r, { works: [{ key: '/works/OL893415W' }] });
    if (u.pathname === '/works/OL893415W.json') return json(r, { description: { value: LONG + '\n\n----------\nAlso contained in:\n - [Dune Chronicles][1]\n\n[1]: https://openlibrary.org/x' } });
    if (u.pathname === '/search.json') return json(r, u.searchParams.get('title') === 'Piranesi'
      ? { docs: [{ key: '/works/OL20893680W', title: 'Piranesi', author_name: ['Susanna Clarke'] }] } : { docs: [] });
    if (u.pathname === '/works/OL20893680W.json') return json(r, { description: 'Piranesi lives in the House. Perhaps he always has. In his notebooks, day after day, he makes a clear and careful record of its wonders.' });
    return json(r, {}, 404);
  });
  await ctx.route('**/api.themoviedb.org/**', r => {
    const u = new URL(r.request().url()); asked.push('tmdb ' + u.pathname);
    if (u.pathname === '/3/movie/813') return json(r, { id: 813, overview: 'An ex-fighter pilot forced to take over the controls of an airliner when the flight crew succumbs to food poisoning.' });
    return json(r, { results: [] });
  });
  await ctx.route('**/en.wikipedia.org/**', r => {
    const u = new URL(r.request().url()); asked.push('wiki ' + decodeURIComponent(u.pathname) + (u.searchParams.get('srsearch') ? ' ? ' + u.searchParams.get('srsearch') : ''));
    if (u.pathname === '/w/api.php') {
      const s = u.searchParams.get('srsearch') || '';
      if (s.startsWith('Hades')) return json(r, { query: { search: [{ title: 'Hades' }, { title: 'Hades (video game)' }] } });
      return json(r, { query: { search: [] } });
    }
    if (u.pathname.endsWith('/Hades')) return json(r, { type: 'standard', description: 'Greek god of the underworld', extract: 'Hades, in the ancient Greek religion and mythology, is the god of the dead and the king of the underworld.' });
    if (u.pathname.endsWith('/Hades_(video_game)')) return json(r, { type: 'standard', description: '2020 video game', extract: 'Hades is a 2020 roguelike action role-playing game developed and published by Supergiant Games.',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Hades_(video_game)' } } });
    return json(r, {}, 404);
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card'); localStorage.setItem('tmdbKey', 'test-key');
  }, [BOOKS, MEDIA, GAMES]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);
  const open = async (kind, id) => { await page.evaluate(([k, i]) => openDetail(k, i), [kind, id]); await page.waitForTimeout(600); };
  const blurb = () => page.evaluate(() => ({
    text: document.querySelector('#blurbText')?.textContent || '',
    meta: document.querySelector('#detailBlurb .detail-blurb-meta')?.innerText.replace(/\s+/g, ' ').trim() || '',
    find: !!document.querySelector('#detailBlurb button:not(#blurbMore)') && document.querySelector('#detailBlurb').textContent.includes('Find a description'),
  }));
  const close = () => page.evaluate(() => closeDetail());

  // ── 1. Sources ──────────────────────────────────────────────────────
  check('cards themselves carry no description', await page.locator('#booksGrid .book-card .detail-blurb, #booksGrid #blurbText').count() === 0);
  const updated0 = await page.evaluate(() => localStorage.getItem('lastUpdated'));
  await open('books', 1700000000001);
  let b = await blurb();
  check('an audiobook with an ASIN gets Audible\'s summary, as plain text', b.text === 'Ryland Grace is the sole survivor on a desperate, last-chance mission.\nAnd if he fails, humanity and the Earth itself will perish.', J(b.text));
  check('…saying where it is from', /From Audible/.test(b.meta), b.meta);
  await page.screenshot({ path: shot('blurb-detail.png') }); await close();

  await open('books', 1700000000002);
  b = await blurb();
  check('a book with an ISBN gets the Open Library work\'s description', b.text.startsWith('A sprawling story of politics') && /From Open Library/.test(b.meta));
  check('…without Open Library\'s "Also contained in" tail or link syntax', !/Also contained|\[1\]|-----/.test(b.text));
  check('…cut to a few sentences', b.text.length <= 700 && /\.$/.test(b.text), String(b.text.length));
  check('a long one is clamped, with More', await page.locator('#blurbMore').isVisible());
  const h0 = await page.locator('#blurbText').evaluate(e => e.clientHeight);
  await page.click('#blurbMore');
  check('More shows it all, and becomes Less', (await page.locator('#blurbText').evaluate(e => e.clientHeight)) > h0 && (await page.locator('#blurbMore').textContent()) === 'Less');
  await close();

  await open('books', 1700000000003);
  check('a book with neither is found by title and author', (await blurb()).text.startsWith('Piranesi lives in the House'));
  await close();

  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  await open('media', 1700000000101);
  b = await blurb();
  check('a film gets TMDb\'s overview by its TMDb id', b.text.startsWith('An ex-fighter pilot') && /From TMDb/.test(b.meta) && asked.includes('tmdb /3/movie/813'), J(b));
  await close();

  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  await open('games', 1700000000201);
  b = await blurb();
  check('a game gets Wikipedia — the game, not the god it is named after', b.text.startsWith('Hades is a 2020 roguelike') && /From Wikipedia/.test(b.meta), J(b));
  check('…linking the article', (await page.locator('#detailBlurb a').getAttribute('href')) === 'https://en.wikipedia.org/wiki/Hades_(video_game)');
  await close();

  // ── 2. Kept, quietly ────────────────────────────────────────────────
  const n = asked.length;
  await open('games', 1700000000201);
  check('opening it again uses the kept one: no lookup', asked.length === n && (await blurb()).text.startsWith('Hades is'));
  await close();
  check('it is kept on the record, across a reload', await (async () => { await page.reload(); await page.waitForTimeout(800);
    return page.evaluate(() => videoGames[0].blurbSource === 'Wikipedia' && books.find(b => b.id === 1700000000002).blurb.startsWith('A sprawling')); })());
  check('finding descriptions does not count as an edit ("Last updated" unchanged)', await page.evaluate(() => localStorage.getItem('lastUpdated')) === updated0);

  // ── 3. Nothing found ────────────────────────────────────────────────
  await page.click('.tab[data-tab="books"]'); await page.waitForTimeout(300);
  await open('books', 1700000000004);
  check('nothing found: the sheet offers "Find a description"', (await blurb()).find);
  await close();
  const n2 = asked.length;
  await open('books', 1700000000004);
  check('…and does not ask again by itself', asked.length === n2);
  await close();

  // ── 4. Remove, and find again ───────────────────────────────────────
  await open('books', 1700000000003);
  await page.click('#detailBlurb button:text-is("Remove")'); await page.waitForTimeout(200);
  check('Remove takes it away', (await blurb()).find && await page.evaluate(() => {
    const b = books.find(x => x.id === 1700000000003); return !b.blurb && b.blurbSource === 'none'; }));
  check('…as a real edit, so it syncs', await page.evaluate(() => localStorage.getItem('lastUpdated')) !== updated0);
  await close();
  const n3 = asked.length;
  await open('books', 1700000000003);
  check('a removed one is not looked up again by itself', asked.length === n3 && (await blurb()).find);
  await page.click('#detailBlurb button:text-is("Find a description")'); await page.waitForTimeout(600);
  check('"Find a description" brings it back', (await blurb()).text.startsWith('Piranesi lives'));
  await close();

  // ── 5. Renaming forgets it ──────────────────────────────────────────
  await page.evaluate(() => { openEditModal(1700000000002); document.getElementById('f-title').value = 'Dune Messiah'; saveBook(); });
  check('a retitled book drops the old title\'s description', await page.evaluate(() => !books.find(b => b.id === 1700000000002).blurb));
  await page.evaluate(() => { openEditModal(1700000000003); document.getElementById('f-notes').value = 'loved it'; saveBook(); });
  check('…but any other edit keeps it', await page.evaluate(() => !!books.find(b => b.id === 1700000000003).blurb));

  // ── 6. Text cleaning ────────────────────────────────────────────────
  const c = await page.evaluate(() => [cleanBlurb('<p>One &amp; two.</p><p>Three [x](http://y).</p>'), cleanBlurb('Short.')]);
  check('cleaning: tags, entities and links become text', c[0] === 'One & two.\nThree x.', J(c));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
