// "What to read next": unread books only, in six orders, with a reason each;
// the publication-year field and looking years up on Open Library.
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const T = (y, m) => new Date(y, m - 1, 15).getTime();     // an id that is a timestamp
const bk = (id, title, author, extra = {}) => ({ id, title, author, status: 'want', formats: ['ebook'], ...extra });

const BOOKS = [
  bk(T(2023, 1), 'Leviathan Wakes', 'James S. A. Corey', { status: 'read', finished: '2026-09', rating: 5, series: 'The Expanse #1', genre: ['Sci-Fi', 'Space Opera'] }),
  bk(T(2023, 2), 'Dune', 'Frank Herbert', { status: 'read', finished: '2026-06', rating: 4, genre: ['Sci-Fi'] }),
  bk(T(2023, 3), 'The Hobbit', 'J. R. R. Tolkien', { status: 'read', finished: '2024-01', rating: 2, genre: ['Fantasy'] }),
  bk(T(2024, 5), "Caliban's War", 'James S. A. Corey', { series: 'The Expanse #2', genre: ['Sci-Fi', 'Space Opera'], published: '2012' }),
  bk(T(2024, 6), "Abaddon's Gate", 'James S. A. Corey', { series: 'The Expanse #3', genre: ['Sci-Fi', 'Space Opera'] }),
  bk(T(2025, 1), 'Dune Messiah', 'Frank Herbert', { genre: ['Sci-Fi'], published: '1969', formats: ['audio'] }),
  bk(T(2022, 7), 'Hyperion', 'Dan Simmons', { genre: ['Sci-Fi', 'Space Opera'], isbn: '9780553283686' }),
  bk(T(2025, 8), 'The Silmarillion', 'J. R. R. Tolkien', { genre: ['Fantasy'], published: '1977' }),
  bk(T(2021, 4), 'A Cookbook', 'Someone'),
  bk(T(2025, 9), 'Foundation', 'Isaac Asimov', { status: 'reading', genre: ['Sci-Fi'] }),
];
const OL = { '9780553283686': 1989, "Abaddon's Gate": 2013 };   // what the fake Open Library knows

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/covers.openlibrary.org/**', r => r.abort());
  const olAsked = [];
  await ctx.route('**/openlibrary.org/**', r => {
    const u = new URL(r.request().url());
    if (!u.pathname.endsWith('/search.json')) return r.abort();
    const p = Object.fromEntries(u.searchParams); olAsked.push(p);
    const y = OL[p.isbn] || OL[p.title];
    const docs = y ? [{ title: p.title || 'Hyperion', author_name: [p.author || 'Dan Simmons'], first_publish_year: y }] : [];
    return r.fulfill({ status: 200, contentType: 'application/json', body: J({ docs }) });
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b));
    for (const k of ['mediaLibrary', 'videoGames', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, BOOKS);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);
  const rows = () => page.locator('#nextBody .next-item').evaluateAll(els => els.map(e =>
    [e.querySelector('.missing-name').textContent, e.querySelector('.next-reason').textContent]));
  const titles = async () => (await rows()).map(r => r[0]);
  const sort = async label => { await page.click(`#nextBody .pill:text-is("${label}")`); await page.waitForTimeout(150); };
  const open = () => page.locator('#nextModal.open').count().then(n => n === 1);

  // ── 1. The button and the sheet ─────────────────────────────────────
  check('the Books tab has "What to read next"', await page.locator('#booksMissing .next-btn').count() === 1);
  await page.click('#booksMissing .next-btn'); await page.waitForTimeout(200);
  check('it opens a sheet counting the unread books', await open() &&
    /From your 6 unread books/.test(await page.locator('#nextBody .dupes-intro').textContent()));
  const forYou = await rows();
  check('only unread books — nothing read or in progress', !forYou.some(([t]) => /Leviathan|^Dune$|Hobbit|Foundation/.test(t)) && forYou.length === 6, J(forYou.map(r => r[0])));
  check('"For you" starts with the next book in a series being read', J(forYou[0]) === J(["Caliban's War", 'Next in The Expanse — you read #1 (Sep 2026)']), J(forYou[0]));
  check('…then the same author as a recent read, saying so', J(forYou[1]) === J(['Dune Messiah', 'By Frank Herbert, like Dune (read Jun 2026)']), J(forYou[1]));
  check('…then shared genres', forYou[2][0] === 'Hyperion' && /^Sci-Fi, Space Opera — like Leviathan Wakes/.test(forYou[2][1]), J(forYou[2]));
  check('an older, poorly-rated read counts for less', forYou[3][0] === 'The Silmarillion', J(forYou.map(r => r[0])));
  check('#3 of a series waits while #2 is unread', forYou.findIndex(r => r[0] === "Abaddon's Gate") > forYou.findIndex(r => r[0] === 'The Silmarillion'), J(forYou.map(r => r[0])));
  check('a book with nothing in common comes last, with when it was added', J(forYou[5]) === J(['A Cookbook', 'Added Apr 2021']), J(forYou[5]));
  await page.screenshot({ path: shot('next-reads-phone.png') });

  // ── 2. The other orders ─────────────────────────────────────────────
  await sort('Next in series');
  check('"Next in series" lists only what continues a started series', J(await titles()) === J(["Caliban's War"]), J(await titles()));
  await sort('Waiting longest');
  check('"Waiting longest": oldest added first', J((await titles()).slice(0, 3)) === J(['A Cookbook', 'Hyperion', "Caliban's War"]), J(await titles()));
  await sort('Recently added');
  check('"Recently added": newest first', (await titles())[0] === 'The Silmarillion', J(await titles()));
  await sort('Oldest published');
  const op = await rows();
  check('"Oldest published": by year, saying how long ago', J(op.slice(0, 3).map(r => r[0])) === J(['Dune Messiah', 'The Silmarillion', "Caliban's War"]) &&
    /^First published 1969 · \d+ years ago$/.test(op[0][1]), J(op.slice(0, 3)));
  check('…books with no year last', op.slice(3).every(r => r[1] === 'No publication year yet'), J(op.slice(3)));
  check('…and an offer to look the years up', /3 unread books have no publication year/.test(await page.locator('#nextYears').textContent()));
  await sort('Newest published');
  check('"Newest published": the reverse', (await titles())[0] === "Caliban's War");

  // ── 3. Looking years up ─────────────────────────────────────────────
  await page.click('#nextYears button:text-is("Look them up")');
  await page.waitForTimeout(5500);
  const found = await page.evaluate(() => Object.fromEntries(books.filter(b => b.published).map(b => [b.title, b.published])));
  check('Open Library years are filled in (by ISBN, or by title and author)', found.Hyperion === '1989' && found["Abaddon's Gate"] === '2013', J(found));
  check('…asking by ISBN where there is one', olAsked.some(p => p.isbn === '9780553283686'));
  check('…and saved', await page.evaluate(() => JSON.parse(localStorage.getItem('myLibrary')).find(b => b.title === 'Hyperion').published === '1989'));
  check('the list re-sorts with them', (await titles())[0] === "Abaddon's Gate", J(await titles()));
  const missed = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('publishedLookupMisses')) || {}).length);
  check('books Open Library cannot place are remembered and not offered again', missed === 1 && await page.locator('#nextYears').count() === 0, String(missed));

  // ── 4. Format, remembering, Show more ───────────────────────────────
  await sort('For you');
  await page.click('#nextBody .pill:text-is("🎧 Audio")'); await page.waitForTimeout(150);
  check('the format filter narrows to audiobooks', J(await titles()) === J(['Dune Messiah']));
  await page.evaluate(() => closeNextReads()); await page.reload(); await page.waitForTimeout(800);
  await page.click('#booksMissing .next-btn'); await page.waitForTimeout(200);
  check('the order and format are remembered', await page.locator('#nextBody .pill.active').allTextContents().then(a => J(a)) === J(['For you', '🎧 Audio']));
  await page.click('#nextBody .pill:text-is("All")'); await page.waitForTimeout(150);

  // ── 5. Opening a book, and it leaving the list ──────────────────────
  await page.locator('#nextBody .next-item', { hasText: 'Hyperion' }).click(); await page.waitForTimeout(200);
  check('tapping a book opens its details over the list', await page.locator('#detailModal.open').count() === 1 && await open() &&
    (await page.locator('#detailTitle').textContent()) === 'Hyperion');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  check('Escape closes the details, leaving the list', await page.locator('#detailModal.open').count() === 0 && await open());
  await page.locator('#nextBody .next-item', { hasText: 'Hyperion' }).click(); await page.waitForTimeout(200);
  await page.click('#detailModal .detail-actions button:text-is("Edit")'); await page.waitForTimeout(200);
  check('Edit from there shows the form on top', await page.evaluate(() => {
    const top = document.elementFromPoint(195, 300); return !!top && !!top.closest('#modal');
  }));
  check('…with the publication year in it', (await page.inputValue('#f-published')) === '1989');
  await page.evaluate(() => { setRadio('status', 'reading'); saveBook(); }); await page.waitForTimeout(300);
  check('a book started from there leaves the list', !(await titles()).includes('Hyperion') && await open());
  await page.keyboard.press('Escape');
  check('Escape then closes the list', !(await open()));

  // ── 6. The field itself ─────────────────────────────────────────────
  const norm = await page.evaluate(() => ['1965', '1965-08-01', 'August 1965', ' 1849 ', 'n/a', '2999', 1977, ''].map(normalizePublished));
  check('the year is read from common shapes; nonsense and future years dropped', J(norm) === J(['1965', '1965', '1965', '1849', '', '', '1977', '']), J(norm));
  await page.evaluate(() => openEditModal(books.find(b => b.title === 'A Cookbook').id));
  await page.fill('#f-published', '2001'); await page.evaluate(() => saveBook()); await page.waitForTimeout(200);
  check('typing a year in the form saves it, and the details show it', await page.evaluate(() => {
    const b = books.find(x => x.title === 'A Cookbook'); openDetail('books', b.id);
    const dt = [...document.querySelectorAll('#detailModal dt')].find(d => d.textContent === 'First published');
    const v = dt && dt.nextElementSibling.textContent; closeDetail(); return b.published === '2001' && v === '2001';
  }));

  // ── 7. No reads yet; nothing unread ─────────────────────────────────
  await page.evaluate(() => { books.forEach(b => { if (b.status === 'read') b.status = 'want'; }); save(); render(); openNextReads(); setNextSort('foryou'); });
  check('with nothing read yet, it says so and lists longest-waiting first', /Mark books as Read/.test(await page.locator('#nextBody .dupes-intro').textContent()) &&
    (await titles())[0] === 'A Cookbook', J(await titles()));
  await page.evaluate(() => { closeNextReads(); books.forEach(b => { b.status = 'read'; }); save(); render(); });
  check('with nothing unread, there is no button', await page.locator('#booksMissing .next-btn').count() === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
