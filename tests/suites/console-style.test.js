// The Console style (⋯ → Themes → Style → Console): black ground, colour-block
// tabs and cards with one rounded diagonal, status as words on blocks, and the
// Console font — chosen in one tap, kept across a reload, and undone by
// picking another style.
const { launch, BASE, reporter } = require('../lib');
const { check, finish } = reporter();

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify([{ id: 1, title: 'Leviathan Wakes', author: 'James S. A. Corey', series: 'The Expanse #1', status: 'read', rating: 5, genre: ['Science Fiction'], copies: [{ id: 'p', format: 'physical' }] }]));
    for (const k of ['mediaLibrary', 'videoGames', 'bookWishlist']) localStorage.setItem(k, '[]');
  });
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(600);
  const attr = n => page.evaluate(n => document.documentElement.getAttribute(n), n);
  const st = (sel, p) => page.evaluate(([sel, p]) => getComputedStyle(document.querySelector(sel))[p], [sel, p]);
  await page.click('#settingsBtn'); await page.click('#settingsThemeBtn'); await page.waitForTimeout(350);
  check('Console is offered as a style', await page.locator('#lookBody [data-look-style="console"]').count() === 1);
  await page.click('#lookBody [data-look-style="console"]'); await page.waitForTimeout(250);
  check('one tap sets the style, dark mode and the Console font', await attr('data-style') === 'console' && await attr('data-theme') === 'dark' && await attr('data-font') === 'console');
  check('the page is black', (await st('body', 'backgroundColor')) === 'rgb(0, 0, 0)');
  check('the active tab is a peach block', (await st('.tab.active', 'backgroundColor')) === 'rgb(255, 153, 102)', await st('.tab.active', 'backgroundColor'));
  check('a card has one rounded diagonal', await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.book-card, .book-row')); return parseFloat(c.borderTopLeftRadius) > 10 && parseFloat(c.borderTopRightRadius) < 1; }));
  check('labels use Antonio', /Antonio/.test(await st('.tab', 'fontFamily')), await st('.tab', 'fontFamily'));
  check('status is a block with its word', await page.evaluate(() => { const b = document.querySelector('.badge-read'); return !b || (/read/i.test(b.textContent) && getComputedStyle(b).backgroundColor === 'rgb(153, 204, 255)'); }));
  await page.reload(); await page.waitForTimeout(600);
  check('it is kept across a reload', await attr('data-style') === 'console' && await attr('data-font') === 'console');
  await page.click('#settingsBtn'); await page.click('#settingsThemeBtn'); await page.waitForTimeout(350);
  await page.click('#lookBody [data-look-style="sharp"]'); await page.waitForTimeout(250);
  check('leaving Console gives back the original font', await attr('data-style') === 'sharp' && await attr('data-font') === 'classic');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
