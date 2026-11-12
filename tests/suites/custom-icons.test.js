// Your own icons (js/app/custom-icons.js): from ⋯ → Icons, upload a picture
// for any built-in icon — Books formats, Movies & TV types and formats, Games
// formats, Wishlist types — optionally with its plain background made
// transparent. Every view of that tab shows it; "Use the built-in" goes back
// to the emoji; and the choice syncs through the private data repo
// (icons/<section>/, newest file per key wins), never the app repo.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const BOOKS = [{ id: 1700000000001, title: 'A Book', author: 'A', status: 'want', formats: ['ebook', 'physical'] }];
const MEDIA = [{ id: 1700000000101, title: 'A Film', type: 'movie', status: 'want', formats: ['dvd'] }];
const GAMES = [{ id: 1700000000201, title: 'Elden Ring', status: 'want', platforms: [{ platform: 'ps5', formats: ['physical', 'ps-plus'] }] },
  { id: 1700000000202, title: 'Hades', status: 'want', platforms: [{ platform: 'steam', formats: ['digital'] }] }];
const WISH = [{ id: 1700000000301, title: 'Wanted Game', creator: '', type: 'game' }];

const remote = {}; let n = 0;
async function device(browser, synced) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('https://api.github.com/**', async r => {
    const req = r.request();
    const m = new URL(req.url()).pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.+))?$/);
    if (m && !m[1]) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"private":true}' });
    const path = m ? decodeURIComponent(m[1]) : '';
    if (req.method() === 'GET') {
      const f = remote[path];
      if (f) return r.fulfill({ status: 200, contentType: 'application/json', body: J({ sha: f.sha, content: f.content }) });
      const kids = Object.keys(remote).filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
      if (kids.length) return r.fulfill({ status: 200, contentType: 'application/json', body: J(kids.map(k => ({ name: k.split('/').pop(), path: k, sha: remote[k].sha }))) });
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    }
    const body = JSON.parse(req.postData()); const f = remote[path];
    if (f && body.sha !== f.sha) return r.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
    const sha = 's' + (++n); remote[path] = { sha, content: body.content };
    return r.fulfill({ status: 201, contentType: 'application/json', body: J({ content: { sha } }) });
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g, w, synced]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', JSON.stringify(w));
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
    if (synced) { localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' })); localStorage.setItem('booklogger.pat', 'ghp_test'); }
  }, [BOOKS, MEDIA, GAMES, WISH, synced]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(900);
  return { ctx, page, errors };
}
// A 200×200 icon: a red disc on a plain white background.
async function iconFile(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 200;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 200, 200);
    x.fillStyle = '#d22'; x.beginPath(); x.arc(100, 100, 60, 0, Math.PI * 2); x.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'icon.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}
const row = (set, key) => `.icon-row[data-icon-set="${set}"][data-icon-key="${key}"]`;
async function upload(page, set, key, removeBg = true) {
  await page.evaluate(on => { document.getElementById('iconsRemoveBg').checked = on; }, removeBg);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`${row(set, key)} button:has-text("Upload")`)]);
  await chooser.setFiles(await iconFile(page));
  await page.waitForFunction(([s, k]) => !!customIcon(s, k) && document.getElementById('iconsMsg').textContent.includes('now uses'), [set, key]);
}
// The stored icon's size and a few pixels (corner, centre), from IndexedDB.
const pixels = (page, set, key) => page.evaluate(async ([s, k]) => {
  const rec = await coverGet(customIcon(s, k));
  const img = new Image(); img.src = URL.createObjectURL(new Blob([rec.bytes], { type: rec.type })); await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const px = (a, b) => [...x.getImageData(a, b, 1, 1).data];
  return { w: img.naturalWidth, h: img.naturalHeight, type: rec.type, corner: px(1, 1), centre: px(48, 48) };
}, [set, key]);
// "img:blob:<width>" once an icon image has loaded, otherwise the element's text.
const iconIn = (page, sel) => page.locator(sel).first().evaluate(async el => {
  const i = el.querySelector('img.fmt-icon');
  if (!i) return el.textContent.trim();
  for (let k = 0; k < 30 && !(i.src.startsWith('blob:') && i.complete && i.naturalWidth); k++) await new Promise(r => setTimeout(r, 100));
  return 'img:' + i.src.slice(0, 5) + i.naturalWidth;
});
const isImg = s => /^img:blob:\d/.test(s);

(async () => {
  const browser = await launch();
  const errors = [];

  // ── 1. On this device ──────────────────────────────────────────────
  { const { ctx, page, errors: e } = await device(browser, true); errors.push(...e);
    await page.click('#settingsBtn'); await page.click('#settingsIconsBtn'); await page.waitForTimeout(200);
    const sections = await page.locator('#iconsBody h3').allInnerTexts();
    check('⋯ → Icons lists Books, Movies & TV, Games and Wishlist', J(sections) === J(['Books', 'Movies & TV', 'Games', 'Wishlist']), J(sections));
    check('…every icon on its built-in to start', await page.locator('.icon-row').count() === 16 &&
      (await page.locator('.icon-name .muted').allInnerTexts()).every(t => t === 'Built-in'));

    await upload(page, 'games', 'physical', true);
    const p = await pixels(page, 'games', 'physical');
    check('an upload becomes a 96×96 PNG', p.w === 96 && p.h === 96 && p.type === 'image/png', J(p));
    check('…with the white background made transparent', p.corner[3] === 0, J(p.corner));
    check('…and the picture itself kept, trimmed to fill it', p.centre[3] === 255 && p.centre[0] > 180 && p.centre[1] < 80, J(p.centre));
    await upload(page, 'games', 'digital', false);
    const d = await pixels(page, 'games', 'digital');
    check('with "Remove a plain background" off, the background stays', d.corner[3] === 255 && d.corner[0] > 240, J(d.corner));
    await upload(page, 'books', 'ebook');
    await upload(page, 'media', 'dvd');
    await upload(page, 'media', 'movie');
    await upload(page, 'wishlist', 'game');
    await page.click('#iconsBody .btn-primary'); await page.waitForTimeout(200);

    // Games
    check('Games: a card badge shows your icon', isImg(await iconIn(page, '#altContent .book-card:has-text("Elden Ring") .badge-platform')));
    check('…the built-in stays for a format you left alone', (await page.locator('#altContent .book-card:has-text("Elden Ring") .badge-platform').innerText()).includes('➕'));
    check('…the filter pills use it', isImg(await iconIn(page, '#altContent .pill:has-text("Physical")')));
    await page.evaluate(() => openDetail('games', 1700000000201)); await page.waitForTimeout(250);
    check('…the detail sheet uses it', await page.locator('#detailBody img.fmt-icon').count() === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.evaluate(() => openGameModal(1700000000201)); await page.waitForTimeout(200);
    check("…the form's format buttons use it", await page.locator('#g-platform-entries [data-chip="physical"] img.fmt-icon').count() === 1 &&
      await page.locator('#g-platform-entries [data-chip="ps-plus"] img.fmt-icon').count() === 0);
    await page.evaluate(() => closeGameModal());

    // Books
    await page.evaluate(() => switchTab('books')); await page.waitForTimeout(250);
    check('Books: the card badge uses your E-book icon, Physical stays built-in',
      isImg(await iconIn(page, '#booksGrid .book-card .badge-ebook')) && (await page.locator('#booksGrid .book-card .badge-physical').innerText()).includes('📚'));
    check('…so does the filter pill', isImg(await iconIn(page, '#formatPills .pill:has-text("E-book")')));
    await page.evaluate(() => openAddModal()); await page.waitForTimeout(150);
    check('…and the add form', isImg(await iconIn(page, 'label[for="fmt-ebook"]')) && (await page.innerText('label[for="fmt-physical"]')).includes('📚'));
    await page.evaluate(() => closeModal());
    await page.evaluate(() => openDetail('books', 1700000000001)); await page.waitForTimeout(250);
    check('…and the detail sheet', await page.locator('#detailBody img.fmt-icon').count() === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);

    // Movies & TV
    await page.evaluate(() => switchTab('media')); await page.waitForTimeout(250);
    check('Movies & TV: the format badge and the type/format pills use yours',
      isImg(await iconIn(page, '#altContent .book-card .badge-media')) && isImg(await iconIn(page, '#altContent .pill:has-text("DVD")')) &&
      isImg(await iconIn(page, '#altContent .pill:has-text("Movies")')) && !isImg(await iconIn(page, '#altContent .pill:has-text("TV Shows")')));
    await page.evaluate(() => openMediaModal(null)); await page.waitForTimeout(150);
    check('…and the form', isImg(await iconIn(page, 'label[for="m-fmt-dvd"]')) && isImg(await iconIn(page, 'label[for="m-type-movie"]')));
    await page.evaluate(() => closeMediaModal());

    // Wishlist
    await page.evaluate(() => switchTab('wishlist')); await page.waitForTimeout(250);
    check('Wishlist: the row and the type pill use yours', isImg(await iconIn(page, '#wishlistListWrap .wish-row .book-row-initial')) &&
      isImg(await iconIn(page, '#altContent .pill:has-text("Games")')));

    await page.waitForTimeout(1500);
    const files = Object.keys(remote).filter(k => k.startsWith('data/icons/'));
    check('every icon went to the private data repo, by section', files.length === 6 &&
      ['games/physical', 'games/digital', 'books/ebook', 'media/dvd', 'media/movie', 'wishlist/game'].every(s => files.some(f => f.startsWith(`data/icons/${s}-`) && f.endsWith('.png'))), J(files));
    check('…as real PNGs', files.every(f => Buffer.from(remote[f].content, 'base64').subarray(0, 4).toString('hex') === '89504e47'));
    await ctx.close(); }

  // ── 2. Another device picks them up ────────────────────────────────
  { const { ctx, page, errors: e } = await device(browser, true); errors.push(...e);
    await page.waitForFunction(() => !!customIcon('games', 'physical') && !!customIcon('wishlist', 'game'), null, { timeout: 10000 });
    check('another device finds your icons and shows them', isImg(await iconIn(page, '#altContent .book-card:has-text("Elden Ring") .badge-platform')));
    await page.click('#settingsBtn'); await page.click('#settingsIconsBtn'); await page.waitForTimeout(200);
    await page.click(`${row('games', 'physical')} button:has-text("Use the built-in")`); await page.waitForTimeout(300);
    check('"Use the built-in" brings the emoji back', (await page.locator('#altContent .book-card:has-text("Elden Ring") .badge-platform').innerText()).includes('📀') &&
      await page.locator('#altContent .book-card:has-text("Elden Ring") img.fmt-icon').count() === 0);
    await page.waitForTimeout(1500);
    check('…and records that in the repo too', Object.keys(remote).some(k => /data\/icons\/games\/physical-[a-z0-9]+\.none$/.test(k)));
    await ctx.close(); }

  // ── 3. …which the next device follows ──────────────────────────────
  { const { ctx, page, errors: e } = await device(browser, true); errors.push(...e);
    await page.waitForFunction(() => !!iconMap()['games:physical'], null, { timeout: 10000 });
    check('a third device sees Physical back on the built-in, the others still yours',
      await page.evaluate(() => !customIcon('games', 'physical') && !!customIcon('games', 'digital') && !!customIcon('books', 'ebook')));
    await ctx.close(); }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
