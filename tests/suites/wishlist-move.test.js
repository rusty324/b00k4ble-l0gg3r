// Wishlist "Got it": the item moves into the right library tab through its
// add form, and leaves the wishlist only when that save completes.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const WISH = [
  { id: 1700000000001, type: 'book', title: 'Piranesi', creator: 'Susanna Clarke', isbn: '9781635575637',
    notes: 'signed copy if possible', links: ['https://www.audible.com/pd/B08CKSW3BY'] },
  { id: 1700000000002, type: 'tv', title: 'Severance', creator: '' },
  { id: 1700000000003, type: 'game', title: 'Hades II', links: ['https://store.steampowered.com/app/1145350/Hades_II/'] },
  { id: 1700000000004, type: 'book', title: 'Dune', creator: 'Frank Herbert' },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/steamstatic.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(w => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify([{ id: 1600000000001, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['physical'] }]));
    localStorage.setItem('bookWishlist', JSON.stringify(w));
    for (const k of ['mediaLibrary', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'wishlist');
  }, WISH);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  const got = title => page.locator('#wishlistListWrap .book-row', { hasText: title }).locator('button', { hasText: 'Got it' }).click();
  const wishTitles = () => page.evaluate(() => bookWishlist.map(w => w.title));

  // ── A book ──────────────────────────────────────────────────────────
  await got('Piranesi'); await page.waitForSelector('#modal.open');
  const form = await page.evaluate(() => ({ tab: activeTab, heading: document.getElementById('modalTitle').textContent,
    title: document.getElementById('f-title').value, author: document.getElementById('f-author').value,
    isbn: document.getElementById('f-isbn').value, notes: document.getElementById('f-notes').value, links: document.getElementById('f-links').value }));
  check('"Got it" on a book opens the Books add form, filled in', form.tab === 'books' && form.heading === 'Add from your wishlist' &&
    form.title === 'Piranesi' && form.author === 'Susanna Clarke' && form.isbn === '9781635575637' && form.notes === 'signed copy if possible' &&
    form.links.includes('audible.com'), J(form));
  check('the wishlist still has it until the save', (await wishTitles()).includes('Piranesi'));
  await page.click('label[for="fmt-audio"]');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  const b = await page.evaluate(() => books.find(x => x.title === 'Piranesi'));
  check('saving adds it to the library with everything carried over', !!b && b.isbn === '9781635575637' && b.author === 'Susanna Clarke' && b.links.length === 1, J(b));
  check('and removes it from the wishlist', !(await wishTitles()).includes('Piranesi'), J(await wishTitles()));
  check('a banner says what happened', /Moved “Piranesi” from your wishlist/.test(await page.textContent('#statusBanner')));
  check('the removal is a recorded deletion, so sync will not bring it back',
    await page.evaluate(() => !!(readTombs().wishlist || {})[1700000000001]));

  // ── Cancelling ──────────────────────────────────────────────────────
  await page.click('.tab[data-tab="wishlist"]'); await page.waitForTimeout(300);
  await got('Severance'); await page.waitForSelector('#mediaModal.open');
  const tv = await page.evaluate(() => ({ tab: activeTab, title: document.getElementById('m-title').value,
    tv: document.getElementById('m-type-tv').checked, seasons: document.getElementById('m-seasons-group').style.display !== 'none' }));
  check('a TV show opens the Movies & TV form as a TV show, with Seasons', tv.tab === 'media' && tv.title === 'Severance' && tv.tv && tv.seasons, J(tv));
  await page.evaluate(() => closeMediaModal()); await page.waitForTimeout(300);
  check('cancelling keeps it on the wishlist and goes back there',
    (await wishTitles()).includes('Severance') && await page.evaluate(() => activeTab === 'wishlist') &&
    await page.evaluate(() => mediaLibrary.length === 0));

  // ── A game: the store link ticks the platform ───────────────────────
  await got('Hades II'); await page.waitForSelector('#gameModal.open'); await page.waitForTimeout(800);
  const g = await page.evaluate(() => ({ tab: activeTab, title: document.getElementById('g-title').value,
    steam: document.getElementById('g-plat-steam').checked }));
  check('a game opens the Games form, and its Steam link ticks Steam', g.tab === 'games' && g.title === 'Hades II' && g.steam, J(g));
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
  check('saving moves it', await page.evaluate(() => videoGames.some(x => x.title === 'Hades II') && !bookWishlist.some(w => w.title === 'Hades II')));

  // ── Already owned: the duplicate note, and "Open it" ────────────────
  await page.click('.tab[data-tab="wishlist"]'); await page.waitForTimeout(300);
  await got('Dune'); await page.waitForSelector('#modal.open'); await page.waitForTimeout(300);
  check('something already in the library says so straight away', await page.evaluate(() => !document.getElementById('f-dup').hidden));
  await page.locator('#f-dup button', { hasText: 'Open it' }).click(); await page.waitForTimeout(300);
  check('"Open it" shows the library copy, on the library tab, and leaves the wishlist alone',
    await page.evaluate(() => editingId === 1600000000001 && activeTab === 'books' && bookWishlist.some(w => w.title === 'Dune')));
  await page.evaluate(() => closeModal()); await page.waitForTimeout(200);
  check('closing that edit does not bounce back to the wishlist', await page.evaluate(() => activeTab === 'books'));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
