// A game whose title starts with an article ("A Little To The Left") is listed
// like any other: added through the form, after a reload, in either view, in
// every sort, and after a search is cleared.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const T = 'A Little To The Left';

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('videoGames', JSON.stringify([
      { id: 1700000000001, title: 'Celeste', status: 'want', copies: [{ id: 'c', platform: 'pc', store: 'steam' }] },
      { id: 1700000000002, title: 'Zelda', status: 'want', copies: [{ id: 'z', platform: 'switch' }] }]));
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
  });
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  const shown = () => page.locator('#gameListWrap .book-title, #gameListWrap .book-row-title').allInnerTexts();

  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.fill('#g-title', T); await page.click('label[for="g-plat-pc"]');
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(300);
  check('listed straight after adding', (await shown()).includes(T), J(await shown()));
  await page.reload(); await page.waitForTimeout(700);
  check('listed after a reload', (await shown()).includes(T), J(await shown()));
  for (const s of ['added-desc', 'added-asc', 'title-asc', 'title-desc', 'rating-desc']) {
    await page.selectOption('#altContent .sort-select', s); await page.waitForTimeout(150);
    check(`listed when sorted ${s}`, (await shown()).includes(T), J(await shown()));
  }
  await page.selectOption('#altContent .sort-select', 'title-asc'); await page.waitForTimeout(150);
  check('A–Z files it under "Little", as libraries do (a leading A/An/The is skipped)', J(await shown()) === J(['Celeste', T, 'Zelda']), J(await shown()));
  await page.fill('#gameSearchInput', 'little'); await page.waitForTimeout(400);
  await page.fill('#gameSearchInput', ''); await page.waitForTimeout(400);
  check('listed after a search is cleared', (await shown()).includes(T), J(await shown()));
  await page.evaluate(() => setView('list'));
  await page.waitForTimeout(200);
  check('listed in the list view', (await shown()).includes(T), J(await shown()));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
