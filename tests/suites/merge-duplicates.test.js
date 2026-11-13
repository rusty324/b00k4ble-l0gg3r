// Movies & TV duplicates folded into one title (js/app/media-copies.js
// mergeMediaRecords): the add form's "Add as another copy", the wishlist
// "Got it" path through it, Find duplicates → Merge, and "Move to its own
// title" splitting a copy back out.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const MEDIA = [
  { id: 1700000000201, title: 'Alien', type: 'movie', year: '1979', status: 'want', genre: ['Horror'], notes: 'Theatrical cut',
    copies: [{ id: 'a1', format: 'bluray' }] },
  { id: 1700000000202, title: 'Alien', type: 'movie', year: '1979', status: 'watched', genre: ['Sci-Fi'], notes: 'From the box',
    copies: [{ id: 'a1', format: 'dvd', set: 'Quadrilogy' }] },
  { id: 1700000000203, title: 'Heat', type: 'movie', year: '1995', status: 'want', copies: [{ id: 'h1', format: 'dvd' }] },
];
const WISH = [{ id: 1700000000301, title: 'Heat', type: 'movie', creator: '', notes: '' }];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/themoviedb.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(([m, w]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', '[]'); localStorage.setItem('videoGames', '[]'); localStorage.setItem('bookWishlist', JSON.stringify(w));
    localStorage.setItem('mediaLibrary', JSON.stringify(m)); localStorage.setItem('activeTab', 'media'); localStorage.setItem('viewMode', 'card');
  }, [MEDIA, WISH]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  const lib = () => page.evaluate(() => mediaLibrary);

  // ── 1. Find duplicates → Merge ─────────────────────────────────────
  await page.evaluate(() => openDuplicates()); await page.waitForTimeout(200);
  check('the Movies & TV group offers Merge', await page.locator('#dupesBody button:has-text("Merge")').count() === 1);
  await page.click('#dupesBody button:has-text("Merge")'); await page.waitForTimeout(300);
  let all = await lib();
  const alien = all.filter(m => m.title === 'Alien');
  check('one Alien is left, the oldest', alien.length === 1 && alien[0].id === 1700000000201, J(alien.map(m => m.id)));
  check('…holding both copies, the clashing id renewed', alien[0].copies.length === 2 && new Set(alien[0].copies.map(c => c.id)).size === 2 &&
    J(alien[0].copies.map(c => c.format)) === '["bluray","dvd"]' && alien[0].copies[1].set === 'Quadrilogy', J(alien[0].copies));
  check('…the more advanced status kept (Watched), genres and notes joined', alien[0].status === 'watched' && J(alien[0].genre) === '["Horror","Sci-Fi"]' &&
    alien[0].notes === 'Theatrical cut\n\nFrom the box', J(alien[0]));
  check('the sheet now finds no duplicates', /No duplicates found/.test(await page.innerText('#dupesBody')));
  await page.evaluate(() => closeDuplicates());

  // ── 2. Add as another copy, via the wishlist ───────────────────────
  await page.evaluate(() => gotWishlistItem(1700000000301)); await page.waitForTimeout(300);
  check('the add form warns Heat is already there, offering "Add as another copy"',
    await page.locator('#m-dup button:has-text("Add as another copy")').isVisible());
  await page.click('#m-copies + .links-row button:has-text("Add a copy")');
  await page.selectOption('#m-copies [data-copy="0"] select', 'bluray');
  await page.click('#m-dup button:has-text("Add as another copy")'); await page.waitForTimeout(300);
  all = await lib();
  const heat = all.filter(m => m.title === 'Heat');
  check('no second Heat; the existing one gains the Blu-ray', heat.length === 1 && J(heat[0].copies.map(c => c.format)) === '["dvd","bluray"]', J(heat));
  check('the form closed and the wishlist item is gone', !(await page.evaluate(() => document.getElementById('mediaModal').classList.contains('open'))) &&
    await page.evaluate(() => bookWishlist.length) === 0);

  // ── 3. Move to its own title ───────────────────────────────────────
  await page.evaluate(() => openMediaModal(1700000000201)); await page.waitForTimeout(200);
  check('each copy of a saved title offers "Move to its own title"', await page.locator('#m-copies button:has-text("Move to its own title")').count() === 2);
  await page.click('#m-copies [data-copy="1"] button:has-text("Move to its own title")'); await page.waitForTimeout(300);
  all = await lib();
  const parts = all.filter(m => m.title === 'Alien');
  check('two Aliens now, one copy each', parts.length === 2 && parts.every(m => m.copies.length === 1), J(parts.map(m => m.copies)));
  check('…marked as not duplicates of each other', parts[0].notDuplicateOf?.includes(parts[1].id) && parts[1].notDuplicateOf?.includes(parts[0].id));
  check('the form shows the one copy left, with no split button', await page.locator('#m-copies .copy-row').count() === 1 &&
    await page.locator('#m-copies button:has-text("Move to its own title")').count() === 0);
  await page.evaluate(() => closeMediaModal());
  await page.evaluate(() => openDuplicates()); await page.waitForTimeout(200);
  check('Find duplicates leaves the split pair alone', /No duplicates found/.test(await page.innerText('#dupesBody')));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
