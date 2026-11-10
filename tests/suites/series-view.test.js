// The Books tab's Series view: one row per series, the completeness strip,
// gaps in words, volumes inline (desktop) or in a bottom sheet (phone),
// "Select these N books", entry sorts and the summary line.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
let nextId = 1700000000001;
const bk = (title, series, extra = {}) => ({ id: nextId++, title, author: 'Ann Writer', status: 'want', formats: ['ebook'], ...(series ? { series } : {}), ...extra });

const BOOKS = [
  bk('Gap One', 'Gappy #1'), bk('Gap Two', 'Gappy #2'), bk('Gap Five', 'Gappy #5', { status: 'read' }),
  bk('Gap Three Half', 'Gappy #3.5'),                       // a companion work: dashed, "+1 other"
  bk('Bundle', 'Bundled #1-3', { formats: ['physical'] }), bk('Bundle Four', 'Bundled #4'),
  bk('Ign One', 'Ignored #1', { ignoredGaps: [2] }), bk('Ign Three', 'Ignored #3', { ignoredGaps: [2] }),
  bk('Apos One', "Ender's Game #1", { author: 'Bea Author' }),
  bk('Apos Two', 'Ender’s Game #2', { author: 'Bea Author' }),   // typographic apostrophe: same series
  bk('Lonely Standalone', '', { author: 'Cal Solo' }),
];

async function open(browser, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('**/googleapis.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', '[]');
    localStorage.setItem('videoGames', '[]'); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, BOOKS);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  return { ctx, page, errors };
}
const rowText = (page, name) => page.locator('.series-block', { hasText: name }).first().locator('.series-row').innerText().then(t => t.replace(/\s+/g, ' ').trim());

(async () => {
  const browser = await launch();
  const errors = [];

  // ── Desktop ────────────────────────────────────────────────────────
  { const { ctx, page, errors: e } = await open(browser, { width: 1280, height: 900 }); errors.push(...e);
    check('the view toggle has card, list and series buttons on Books', await page.locator('#viewToggle [data-view]').count() === 3 &&
      await page.locator('#viewToggle [data-view="series"]').isVisible());
    await page.click('#viewToggle [data-view="series"]'); await page.waitForTimeout(200);
    check('Series is pressed and remembered', await page.getAttribute('#viewToggle [data-view="series"]', 'aria-pressed') === 'true' &&
      await page.evaluate(() => localStorage.getItem('viewMode')) === 'series');
    check('the summary line counts entries and books', (await page.innerText('#booksSummary')).trim() === '5 entries · 11 books', await page.innerText('#booksSummary'));
    check('the sort menu offers the series orders', J(await page.locator('#sortSelect option').allInnerTexts()) ===
      J(['Most books', 'Series A–Z', 'Author A–Z (surname)', 'Newest added']));
    const names = () => page.locator('#booksGrid .series-name').allInnerTexts();
    check('Most books first', J(await names()) === J(['Gappy', 'Bundled', "Ender's Game", 'Ignored', 'Lonely Standalone']), J(await names()));
    check('both apostrophes group into one series', (await names()).filter(n => /Ender/.test(n)).length === 1);

    const gappy = await rowText(page, 'Gappy');
    check('a gap row: books, range, gaps, other, missing numbers', /4 books · #1–5 · 2 gaps · \+1 other/.test(gappy) && /Missing #3–4/.test(gappy) && /1 of 4 read/.test(gappy), gappy);
    const strip = page.locator('.series-block', { hasText: 'Gappy' }).locator('.series-strip');
    check('the strip is an image with a spoken summary', await strip.getAttribute('role') === 'img' &&
      /Owned numbers 1 to 5, missing 3–4/.test(await strip.getAttribute('aria-label')), await strip.getAttribute('aria-label'));
    const bundled = await rowText(page, 'Bundled');
    check('a bundle #1-3 covers its numbers: no gaps', /2 books · #1–4 · no gaps/.test(bundled), bundled);
    const ign = await rowText(page, 'Ignored');
    check('an ignored gap is not a gap, and not printed', /#1–3 · no gaps/.test(ign) && !/Missing/.test(ign), ign);
    check('the ignored number is drawn neutral', /var\(--gray-400\)/.test(await page.locator('.series-block', { hasText: 'Ignored' }).locator('.series-strip').getAttribute('style')));

    // Expand inline
    const chev = page.locator('.series-block', { hasText: 'Gappy' }).locator('.series-chev');
    check('the chevron starts collapsed, labelled', await chev.getAttribute('aria-expanded') === 'false' && /Show volumes/.test(await chev.getAttribute('aria-label')));
    await chev.click(); await page.waitForTimeout(150);
    const chips = page.locator('.series-block', { hasText: 'Gappy' }).locator('.vol-chip');
    check('expanding shows the volumes in number order, the companion dashed', J((await chips.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())) ===
      J(['#1Gap One', '#2Gap Two', '#3.5Gap Three Half', '#5Gap Five']) &&
      await chips.nth(2).evaluate(el => getComputedStyle(el).borderStyle === 'dashed'), J(await chips.allInnerTexts()));
    check('…and the chevron says so', await page.locator('.series-block', { hasText: 'Gappy' }).locator('.series-chev').getAttribute('aria-expanded') === 'true');
    await chips.first().click(); await page.waitForTimeout(200);
    check('a volume chip opens that book\'s details', await page.evaluate(() => document.getElementById('detailModal').classList.contains('open') &&
      /Gap One/.test(document.getElementById('detailBody').innerText)));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.locator('.series-block', { hasText: 'Gappy' }).locator('[data-series-select]').click(); await page.waitForTimeout(200);
    check('"Select these 4 books" starts bulk edit with them selected', await page.evaluate(() => bulkActive() && _bulk.ids.size === 4) &&
      /4/.test(await page.innerText('#bulkBar')), await page.innerText('#bulkBar'));
    await page.evaluate(() => endBulk());

    // Standalone row opens details
    await page.locator('.series-row.is-book', { hasText: 'Lonely Standalone' }).click(); await page.waitForTimeout(200);
    check('a standalone book is a row that opens its details', await page.evaluate(() => /Lonely Standalone/.test(document.getElementById('detailBody').innerText) &&
      document.getElementById('detailModal').classList.contains('open')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);

    // Sorts
    await page.selectOption('#sortSelect', 'entries-name'); await page.waitForTimeout(150);
    check('Series A–Z', J(await names()) === J(['Bundled', "Ender's Game", 'Gappy', 'Ignored', 'Lonely Standalone']), J(await names()));
    await page.selectOption('#sortSelect', 'entries-author'); await page.waitForTimeout(150);
    check('Author A–Z by surname (Author, Solo, Writer…)', (await names())[0] === "Ender's Game" && (await names())[1] === 'Lonely Standalone', J(await names()));
    await page.selectOption('#sortSelect', 'entries-added'); await page.waitForTimeout(150);
    check('Newest added', (await names())[0] === 'Lonely Standalone', J(await names()));

    // Filters narrow: "N of M books"
    await page.fill('#searchInput', 'gap two'); await page.waitForTimeout(500);
    check('a search narrows the members: "1 of 4 books"', /1 of 4 books/.test(await rowText(page, 'Gappy')), await rowText(page, 'Gappy'));
    check('…the gaps still describe the whole series', /Missing #3–4/.test(await rowText(page, 'Gappy')));
    check('…and the summary says "of" too', / of 11 books/.test(await page.innerText('#booksSummary')), await page.innerText('#booksSummary'));
    await page.fill('#searchInput', ''); await page.waitForTimeout(500);

    // Back to card view: book sorts return, summary hides
    await page.click('#viewToggle [data-view="card"]'); await page.waitForTimeout(200);
    check('card view brings back the book sorts and cards', await page.locator('#sortSelect option[value="title-asc"]').count() === 1 &&
      await page.locator('#booksGrid .book-card').count() === 11 && await page.locator('#booksSummary').isHidden());
    // Off Books, the series button hides
    await page.click('#viewToggle [data-view="series"]'); await page.waitForTimeout(150);
    await page.evaluate(() => switchTab('media')); await page.waitForTimeout(200);
    check('off Books the series button hides and cards show', await page.locator('#viewToggle [data-view="series"]').isHidden() &&
      await page.getAttribute('#viewToggle [data-view="card"]', 'aria-pressed') === 'true');
    await page.evaluate(() => switchTab('books')); await page.waitForTimeout(200);
    check('back on Books, Series again', await page.locator('#booksGrid .series-block').count() > 0);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/series-desktop.png` });
    await ctx.close(); }

  // ── Phone ──────────────────────────────────────────────────────────
  { const { ctx, page, errors: e } = await open(browser, { width: 390, height: 844 }, true); errors.push(...e);
    await page.click('#viewToggle [data-view="series"]'); await page.waitForTimeout(200);
    const card = (await page.locator('.series-block', { hasText: 'Gappy' }).innerText()).replace(/\s+/g, ' ');
    check('a phone card: "4 books" and "2 gaps in #1–5"', /4 books/.test(card) && /2 gaps in #1–5/.test(card), card);
    const noWide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check('no sideways scroll at 390px', noWide);
    await page.locator('.series-block', { hasText: 'Gappy' }).locator('.series-name').click(); await page.waitForTimeout(250);
    check('tapping a series opens its sheet', await page.evaluate(() => document.getElementById('seriesModal').classList.contains('open')) &&
      (await page.innerText('#seriesSheetTitle')) === 'Gappy');
    const rows = (await page.locator('#seriesBody .vol-row').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    check('the sheet lists volumes and gap rows in number order', rows.length === 6 && /#1 Gap One/.test(rows[0]) && /#3 Not in your library/.test(rows[2]) &&
      /#3.5 Gap Three Half/.test(rows[3]) && /Companion work/.test(rows[3]) && /#4 Not in your library/.test(rows[4]) && /#5 Gap Five/.test(rows[5]), J(rows));
    check('the close button has focus', await page.evaluate(() => document.activeElement.classList.contains('series-sheet-close')));
    await page.locator('#seriesBody .vol-row', { hasText: 'Gap Two' }).click(); await page.waitForTimeout(250);
    check('a volume opens its details over the sheet', await page.evaluate(() => document.getElementById('detailModal').classList.contains('open') &&
      document.getElementById('seriesModal').classList.contains('open')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('Escape closes the details first, keeping the sheet', await page.evaluate(() => !document.getElementById('detailModal').classList.contains('open') &&
      document.getElementById('seriesModal').classList.contains('open')));
    await page.locator('#seriesBody [data-series-add="3"]').click(); await page.waitForTimeout(250);
    check('"Add #3" closes the sheet and opens the add form, filled in', await page.evaluate(() => !document.getElementById('seriesModal').classList.contains('open') &&
      document.getElementById('modal').classList.contains('open') && document.getElementById('f-series').value === 'Gappy' &&
      document.getElementById('f-seriesIndex').value === '3'));
    await page.evaluate(() => closeModal()); await page.waitForTimeout(150);
    await page.locator('.series-block', { hasText: 'Gappy' }).locator('.series-name').click(); await page.waitForTimeout(250);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/series-phone-sheet.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('Escape closes the sheet', await page.evaluate(() => !document.getElementById('seriesModal').classList.contains('open')));
    await page.locator('.series-block', { hasText: 'Gappy' }).locator('.series-name').click(); await page.waitForTimeout(250);
    await page.locator('#seriesBody [data-series-select]').click(); await page.waitForTimeout(200);
    check('"Select these" closes the sheet and selects them', await page.evaluate(() => !document.getElementById('seriesModal').classList.contains('open') &&
      bulkActive() && _bulk.ids.size === 4));
    await page.evaluate(() => endBulk());
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/series-phone.png` });
    await ctx.close(); }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
