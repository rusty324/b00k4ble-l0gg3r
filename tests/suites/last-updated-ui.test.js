const { launch, BASE, REPO, tmp, shot } = require('../lib');
const results = []; const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
(async () => {
  const errors = [];
  const browser = await launch();
  for (const [name, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1200, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'en-US', timezoneId: 'UTC' });
    await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
    await ctx.route('**/api.github.com/**', r => r.abort());
    await ctx.route('**/openlibrary.org/**', r => r.abort()); await ctx.route('**/covers.openlibrary.org/**', r => r.abort());
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
      localStorage.setItem('myLibrary', JSON.stringify([{ id: 1750000000000, title: 'Emma', author: 'Jane Austen', status: 'read', formats: ['physical'] }]));
      localStorage.setItem('mediaLibrary', '[]'); localStorage.setItem('bookWishlist', '[]'); localStorage.setItem('videoGames', '[]');
      localStorage.setItem('activeTab', 'books');
    });
    await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
    await page.screenshot({ path: shot(`upd-${name}-books.png`) });

    // Real modal paths
    const stampOf = k => page.evaluate(k => (JSON.parse(localStorage.getItem('lastUpdated')) || {})[k] || 0, k);
    await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
    await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
    await page.fill('#g-title', 'Hades'); await page.click('label[for="g-plat-steam"]');
    await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
    check(`${name}: adding a game through the modal stamps games and shows it`,
      (await stampOf('games')) > 0 && /^Last updated Oct \d+, 2026/.test(await page.textContent('#updatedNote')), await page.textContent('#updatedNote'));
    await page.screenshot({ path: shot(`upd-${name}-games.png`) });

    await page.click('.tab[data-tab="books"]'); await page.waitForTimeout(300);
    const b0 = await stampOf('books');
    check(`${name}: games edit left books' stamp alone`, b0 === 0, String(b0));
    await page.click('#addBtn'); await page.waitForSelector('#addModal.open, .modal-backdrop.open');
    await page.waitForTimeout(200);
    await page.fill('#f-title', 'Persuasion'); await page.fill('#f-author', 'Jane Austen');
    await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
    check(`${name}: adding a book through the modal stamps books`, (await stampOf('books')) > 0);

    page.once('dialog', d => d.accept());
    const del = page.locator('#booksGrid .book-card', { hasText: 'Persuasion' }).locator('button', { hasText: 'Delete' });
    if (await del.count()) { const t0 = await stampOf('books'); await page.waitForTimeout(20); await del.click(); await page.waitForTimeout(400);
      check(`${name}: deleting a book moves the date too (a delete leaves no record to stamp)`, (await stampOf("books")) > t0 && !(await page.evaluate(() => books.some(b => b.title === 'Persuasion')))); }
    await ctx.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  console.log(`\n${results.filter(r => r.startsWith('PASS')).length}/${results.length} checks passed`);
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('SUITE ERROR:', e.message); process.exit(2); });
