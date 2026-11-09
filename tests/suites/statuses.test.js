// The added statuses: Not Interested on Books, Movies & TV and Games, and On
// Hold/Dropped on Games — in the form, the filter, the badges, the details,
// bulk edit, and "What to read next".
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const bk = (id, title, extra = {}) => ({ id, title, author: 'X', status: 'want', formats: ['ebook'], ...extra });

const BOOKS = [
  bk(1700000000001, 'Mistborn', { status: 'read', finished: '2026-08', series: 'Mistborn #1' }),
  bk(1700000000002, 'The Well of Ascension', { series: 'Mistborn #2' }),
  bk(1700000000003, 'The Hero of Ages', { series: 'Mistborn #3' }),
  bk(1700000000004, 'Emma'),
];
const MEDIA = [{ id: 1700000000101, title: 'Airplane!', type: 'movie', status: 'want', formats: ['dvd'] }];
const GAMES = [
  { id: 1700000000201, title: 'Hades', status: 'want', platforms: [{ platform: 'steam', formats: ['digital'] }] },
  { id: 1700000000202, title: 'Celeste', status: 'playing', platforms: [{ platform: 'steam', formats: ['digital'] }] },
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
  // The status radios only (the forms also have type, format and platform ones).
  const radios = name => page.locator(`label.radio-btn:has(input[name="${name}"])`).allTextContents().then(a => a.map(t => t.trim()));
  const badgeOf = (scope, title) => page.locator(`${scope} .book-card`, { hasText: title }).locator('.badge').filter({ hasText: /Want|Read|Reading|Watched|Playing|Completed|Hold|Interested/ }).first();

  // ── 1. Books ────────────────────────────────────────────────────────
  check('the book filter offers Not Interested', (await page.locator('#statusPills .pill').allTextContents()).includes('Not Interested'));
  await page.evaluate(() => openEditModal(1700000000002));
  check('the book form offers Not Interested', J(await radios('status')) === J(['Want to read', 'Reading', 'Read', 'Not Interested']), J(await radios('status')));
  await page.click('label[for="st-not-interested"]');
  check('choosing it leaves no Finished field', !(await page.locator('#f-finished-group').isVisible()));
  await page.evaluate(() => saveBook()); await page.waitForTimeout(200);
  check('it saves', await page.evaluate(() => books.find(b => b.id === 1700000000002).status) === 'not-interested');
  const nb = badgeOf('#booksGrid', 'The Well of Ascension');
  check('its card says Not Interested, in a muted badge', (await nb.textContent()) === 'Not Interested' && /badge-nope/.test(await nb.getAttribute('class')));
  await page.click('#statusPills .pill:text-is("Not Interested")'); await page.waitForTimeout(200);
  check('the filter shows just it', J(await page.locator('#booksGrid .book-title').allTextContents()) === J(['The Well of Ascension']));
  await page.click('#statusPills .pill:text-is("All")'); await page.waitForTimeout(200);
  check('the detail sheet says so', await page.evaluate(() => { openDetail('books', 1700000000002);
    const t = document.querySelector('#detailModal .badge').textContent; closeDetail(); return t; }) === 'Not Interested');

  // What to read next: a Not Interested book is not suggested, and does not
  // stand in the way of the next one in its series.
  await page.click('#booksMissing .next-btn'); await page.waitForTimeout(200);
  const next = await page.locator('#nextBody .next-item .missing-name').allTextContents();
  check('"What to read next" leaves it out', !next.includes('The Well of Ascension'), J(next));
  const first = await page.locator('#nextBody .next-item').first().evaluate(e =>
    [e.querySelector('.missing-name').textContent, e.querySelector('.next-reason').textContent]);
  check('…and skips past it to the next in the series', J(first) === J(['The Hero of Ages', 'Next in Mistborn — you read #1 (Aug 2026)']), J(first));
  await page.evaluate(() => closeNextReads());

  // ── 2. Movies & TV ──────────────────────────────────────────────────
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  check('the Movies & TV filter offers Not Interested', (await page.locator('#altContent .filter-row', { hasText: 'Status' }).locator('.pill').allTextContents()).includes('Not Interested'));
  await page.evaluate(() => openMediaModal(1700000000101));
  check('…and its form', J(await radios('m-status')) === J(['Want to Watch', 'Watched', 'Not Interested']), J(await radios('m-status')));
  await page.click('label[for="m-st-not-interested"]');
  await page.evaluate(() => saveMediaItem()); await page.waitForTimeout(200);
  check('it saves, and the card says so', await page.evaluate(() => mediaLibrary[0].status) === 'not-interested' &&
    (await badgeOf('#altContent', 'Airplane!').textContent()) === 'Not Interested');

  // ── 3. Games ────────────────────────────────────────────────────────
  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  const gp = await page.locator('#altContent .filter-row', { hasText: 'Status' }).locator('.pill').allTextContents();
  check('the Games filter offers On Hold/Dropped and Not Interested', J(gp) === J(['All', 'Want to Play', 'Playing', 'Completed', 'On Hold/Dropped', 'Not Interested']), J(gp));
  await page.evaluate(() => openGameModal(1700000000202));
  check('…and its form', J(await radios('g-status')) === J(['Want to Play', 'Playing', 'Completed', 'On Hold/Dropped', 'Not Interested']), J(await radios('g-status')));
  await page.screenshot({ path: shot('statuses-game-form.png') });
  await page.click('label[for="g-st-on-hold"]');
  await page.evaluate(() => saveGameItem()); await page.waitForTimeout(200);
  const hb = badgeOf('#altContent', 'Celeste');
  check('On Hold/Dropped saves, with its own badge', await page.evaluate(() => videoGames.find(g => g.id === 1700000000202).status) === 'on-hold' &&
    (await hb.textContent()) === 'On Hold/Dropped' && /badge-hold/.test(await hb.getAttribute('class')));
  await page.click('#altContent .pill:text-is("On Hold/Dropped")'); await page.waitForTimeout(200);
  check('the filter shows just it', J(await page.locator('#altContent .book-title').allTextContents()) === J(['Celeste']));
  await page.click('#altContent .filter-row:has-text("Status") .pill:text-is("All")'); await page.waitForTimeout(200);

  // ── 4. Bulk edit offers them too ────────────────────────────────────
  await page.locator('#altContent .select-btn').click();
  const opts = await page.locator('#bulkStatus option').allTextContents();
  check('bulk edit offers each tab\'s statuses', J(opts) === J(['Set status…', 'Want to Play', 'Playing', 'Completed', 'On Hold/Dropped', 'Not Interested']), J(opts));
  await page.locator('#altContent .book-card', { hasText: 'Hades' }).click();
  await page.selectOption('#bulkStatus', 'not-interested'); await page.waitForTimeout(200);
  check('…and sets them', await page.evaluate(() => videoGames.find(g => g.id === 1700000000201).status) === 'not-interested');
  await page.click('#bulkBar .btn-primary');

  // ── 5. On a phone, every filter option is on screen ─────────────────
  // The rows used to scroll sideways with no scrollbar, hiding the options
  // past the edge — exactly where the new statuses landed.
  for (const tab of ['books', 'media', 'games']) {
    await page.click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(300);
    const off = await page.evaluate(() => [...document.querySelectorAll('.filter-row .pill')]
      .filter(p => p.offsetParent).filter(p => { const r = p.getBoundingClientRect(); return r.right > innerWidth || r.left < 0; })
      .map(p => p.textContent));
    check(`${tab}: no filter option is off the edge of a phone screen`, off.length === 0, JSON.stringify(off));
  }

  // ── 6. They survive a reload ────────────────────────────────────────
  await page.reload(); await page.waitForTimeout(800);
  check('all of it is kept after a reload', J(await page.evaluate(() => [books[1].status, mediaLibrary[0].status, videoGames.map(g => g.status)])) ===
    J(['not-interested', 'not-interested', ['not-interested', 'on-hold']]));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
