// Choosing from a dropdown in a copies editor (format, store, platform)
// repaints the copy. On a touch screen the dropdown must not be focused again
// afterwards — iPhone and iPad Safari reopen a focused <select>'s picker, so
// the menu just chosen from popped straight back up. With a mouse or
// keyboard, focus returns to it so the place is kept (core.js focusField).
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();

const GAMES = [{ id: 1700000000001, title: 'Hades', status: 'want', copies: [{ id: 'h', platform: 'pc', format: 'digital', store: 'steam' }] }];
const MEDIA = [{ id: 1700000000002, title: 'Alien', type: 'movie', status: 'want', copies: [{ id: 'a', format: 'dvd' }] }];

async function device(browser, touch) {
  const ctx = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([g, m]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', '[]'); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
  }, [GAMES, MEDIA]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  return { ctx, page, errors };
}

const focusedField = page => page.evaluate(() => document.activeElement?.dataset?.field || document.activeElement?.tagName);

(async () => {
  const browser = await launch();
  for (const touch of [true, false]) {
    const name = touch ? 'touch' : 'mouse';
    const { ctx, page, errors } = await device(browser, touch);
    check(`${name}: the page sees the pointer it should`, await page.evaluate(() => touchScreen()) === touch);

    await page.evaluate(() => openGameModal(1700000000001)); await page.waitForTimeout(200);
    const row = '#g-copies [data-copy="0"]';
    await page.selectOption(`${row} [data-field="format"]`, 'subscription'); await page.waitForTimeout(100);
    check(`${name}: Games format — the copy repaints (a Service field appears)`, await page.locator(`${row} [data-field="store"] option[value="game-pass"]`).count() === 1);
    check(`${name}: …and the format dropdown is ${touch ? 'not focused again' : 'focused again'}`,
      touch ? (await focusedField(page)) !== 'format' : (await focusedField(page)) === 'format', await focusedField(page));
    await page.selectOption(`${row} [data-field="store"]`, 'game-pass'); await page.waitForTimeout(100);
    check(`${name}: Games service — ${touch ? 'not focused again' : 'focused again'}`,
      touch ? (await focusedField(page)) !== 'store' : (await focusedField(page)) === 'store', await focusedField(page));
    await page.selectOption(`${row} [data-field="platform"]`, 'ps5'); await page.waitForTimeout(100);
    check(`${name}: Games platform — ${touch ? 'not focused again' : 'focused again'}`,
      touch ? (await focusedField(page)) !== 'platform' : (await focusedField(page)) === 'platform', await focusedField(page));
    await page.click('#gameModal button:has-text("Add a copy")'); await page.waitForTimeout(100);
    check(`${name}: "Add a copy" ${touch ? 'does not open the new copy\'s dropdown' : 'puts focus in the new copy'}`,
      touch ? (await focusedField(page)) !== 'platform' : (await focusedField(page)) === 'platform', await focusedField(page));
    await page.evaluate(() => closeGameModal());

    await page.evaluate(() => { switchTab('books'); openAddModal(); }); await page.waitForTimeout(200);
    await page.selectOption('#f-copies [data-copy="0"] [data-field="format"]', 'audio'); await page.waitForTimeout(100);
    check(`${name}: Books format — the narrator field appears, dropdown ${touch ? 'not focused again' : 'focused again'}`,
      await page.locator('#f-copies [data-field="narrator"]').count() === 1 &&
      (touch ? (await focusedField(page)) !== 'format' : (await focusedField(page)) === 'format'), await focusedField(page));
    await page.evaluate(() => closeModal());

    check(`${name}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
