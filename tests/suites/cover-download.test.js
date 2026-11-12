// Saving copies of linked covers (cover-files.js, cover-download.js): the
// form's "Save a copy" button and the ⋯ menu's bulk action download a linked
// image, resize it and keep it under the size cap, and swap the link for the
// copy. A site that refuses (no CORS), a missing image or one over the source
// limit keeps its link and is reported.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const CORS = { 'Access-Control-Allow-Origin': '*' };
let NOISY = null;                    // a 900×1350 noise PNG: compresses badly, so it tests the cap
const hits = {};
// A real cross-origin image without CORS headers: the test server under its
// other host name (Playwright's fulfilled responses don't enforce CORS).
const BLOCKED = BASE.replace('127.0.0.1', 'localhost') + '/apple-touch-icon.png';

async function routes(ctx) {
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('https://ok.example/**', r => { if (r.request().resourceType() === 'fetch') hits[r.request().url()] = (hits[r.request().url()] || 0) + 1;
    return r.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: NOISY }); });
  await ctx.route('https://gone.example/**', r => r.fulfill({ status: 404, contentType: 'text/plain', headers: CORS, body: 'nope' }));
  await ctx.route('https://huge.example/**', r => r.fulfill({ status: 200, contentType: 'image/jpeg', headers: CORS, body: Buffer.alloc(26 * 1024 * 1024, 1) }));
}

async function open(browser, lib) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await routes(ctx);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', '[]');
  }, lib);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(600);
  return { ctx, page, errors };
}
// The stored copy's size and dimensions, read back from IndexedDB.
const stored = (page, value) => page.evaluate(async v => {
  const rec = await coverGet(v.slice(5));
  if (!rec) return null;
  const img = new Image(); img.src = URL.createObjectURL(new Blob([rec.bytes], { type: rec.type }));
  await img.decode();
  return { bytes: rec.bytes.byteLength, w: img.naturalWidth, h: img.naturalHeight, type: rec.type };
}, value);

const bk = (id, title, coverUrl) => ({ id: 1700000000000 + id, title, author: 'A', status: 'want', formats: ['ebook'], ...(coverUrl ? { coverUrl } : {}) });

(async () => {
  const browser = await launch();
  const errors = [];
  { const ctx = await browser.newContext(); const p = await ctx.newPage();
    NOISY = Buffer.from(await p.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 1350;
      const x = c.getContext('2d'); const d = x.createImageData(900, 1350);
      for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
      x.putImageData(d, 0, 0); return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await ctx.close(); }

  // ── 1. The form's "Save a copy" ────────────────────────────────────
  { const { ctx, page, errors: e } = await open(browser, [[bk(1, 'Linked', 'https://ok.example/a.png')], [], []]); errors.push(...e);
    await page.evaluate(() => openEditModal(1700000000001));
    await page.click('button:has-text("Save a copy") >> nth=0'); await page.waitForFunction(() => /^repo:/.test(document.getElementById('f-coverUrl').value), null, { timeout: 15000 });
    const v = await page.inputValue('#f-coverUrl');
    check('"Save a copy" swaps the link for a saved copy', /^repo:covers\/books\/[a-z0-9]+\.jpg$/.test(v), v);
    check('…and says the link goes when you save', /replaces the link when you save/.test(await page.innerText('#f-coverUrl-msg')));
    const s = await stored(page, v);
    check(`the copy is resized and under the 120 KB cap even for a hard image (${s && Math.round(s.bytes / 1024)} KB, ${s && s.w}×${s && s.h})`,
      !!s && s.bytes <= 120 * 1024 && s.w <= 300 && s.h <= 450 && s.type === 'image/jpeg', J(s));
    await page.evaluate(() => saveBook()); await page.waitForTimeout(200);
    check('saving the form keeps the copy', await page.evaluate(() => books[0].coverUrl.startsWith('repo:covers/books/')));

    await page.evaluate(() => openEditModal(1700000000001));
    await page.fill('#f-coverUrl', BLOCKED);
    await page.click('button:has-text("Save a copy") >> nth=0'); await page.waitForTimeout(800);
    check("a site that doesn't allow it: the link stays, and it says why", await page.inputValue('#f-coverUrl') === BLOCKED &&
      /doesn't let other sites download/.test(await page.innerText('#f-coverUrl-msg')), await page.innerText('#f-coverUrl-msg'));
    await page.fill('#f-coverUrl', 'https://huge.example/c.jpg');
    await page.click('button:has-text("Save a copy") >> nth=0'); await page.waitForTimeout(1500);
    check('an image over the 25 MB source limit is refused, link kept', await page.inputValue('#f-coverUrl') === 'https://huge.example/c.jpg' &&
      /limit is/.test(await page.innerText('#f-coverUrl-msg')), await page.innerText('#f-coverUrl-msg'));
    await page.evaluate(() => closeModal());
    await ctx.close(); }

  // ── 2. The bulk action ─────────────────────────────────────────────
  { const lib = [
      [bk(1, 'Shared A', 'https://ok.example/shared.png'), bk(2, 'Shared B', 'https://ok.example/shared.png'),
       bk(3, 'Blocked Book', BLOCKED + '?x'), bk(4, 'Gone Book', 'https://gone.example/y.png'),
       bk(5, 'Huge Book', 'https://huge.example/z.jpg'), bk(6, 'No Cover'), bk(7, 'Already', 'repo:covers/books/old.jpg')],
      [{ id: 1700000000101, title: 'A Film', type: 'movie', status: 'want', formats: [], posterUrl: 'https://ok.example/film.png' }],
      [{ id: 1700000000201, title: 'A Game', status: 'want', platforms: [{ platform: 'steam', formats: [] }], coverUrl: BLOCKED + '?g' }],
    ];
    const { ctx, page, errors: e } = await open(browser, lib); errors.push(...e);
    await page.click('#settingsBtn'); await page.click('#settingsCoverDlBtn'); await page.waitForTimeout(200);
    const intro = (await page.innerText('#coverDlBody')).replace(/\s+/g, ' ');
    check('the ⋯ menu opens it, counting linked covers per tab', /Books: 5/.test(intro) && /Movies & TV: 1/.test(intro) && /Games: 1/.test(intro) &&
      /Save 7 covers/.test(intro), intro);
    await page.click('#coverDlStart');
    await page.waitForFunction(() => _coverDl && _coverDl.finished, null, { timeout: 60000 });
    const recs = await page.evaluate(() => ({ b: books.map(b => [b.title, b.coverUrl || '']), m: mediaLibrary[0].posterUrl, g: videoGames[0].coverUrl }));
    const cov = t => recs.b.find(x => x[0] === t)[1];
    check('the downloadable ones become saved copies', /^repo:covers\/books\//.test(cov('Shared A')) && /^repo:covers\/books\//.test(cov('Shared B')) &&
      /^repo:covers\/media\//.test(recs.m), J(recs));
    check('the same link on two entries is downloaded once', hits['https://ok.example/shared.png'] === 1, J(hits));
    check('the rest keep their original link', cov('Blocked Book') === BLOCKED + '?x' && cov('Gone Book') === 'https://gone.example/y.png' &&
      cov('Huge Book') === 'https://huge.example/z.jpg' && recs.g === BLOCKED + '?g');
    check('entries with no cover or a saved one are left alone', cov('No Cover') === '' && cov('Already') === 'repo:covers/books/old.jpg');
    const report = (await page.innerText('#coverDlBody')).replace(/\s+/g, ' ');
    check('the report counts what was saved and what kept its link', /Done\. 7 of 7 · 3 saved · 4 kept their link/.test(report), report);
    check('…grouped by reason', /Site doesn't allow downloads \(2\)/.test(report) && /Not found or refused by the site \(1\)/.test(report) && /Too large \(1\)/.test(report), report);
    check('the changes were saved', await page.evaluate(() => JSON.parse(localStorage.getItem('myLibrary')).filter(b => (b.coverUrl || '').startsWith('repo:covers/books/') && b.coverUrl !== 'repo:covers/books/old.jpg').length === 2 &&
      JSON.parse(localStorage.getItem('mediaLibrary'))[0].posterUrl.startsWith('repo:')));
    const card = await page.locator('#booksGrid .book-card', { hasText: 'Shared A' }).locator('img').evaluate(async i => {
      for (let n = 0; n < 30 && !(i.src.startsWith('blob:') && i.complete && i.naturalWidth); n++) await new Promise(r => setTimeout(r, 100));
      return i.src.slice(0, 5) + ':' + i.naturalWidth; });
    check('the card shows the saved copy', /^blob:/.test(card) && !/:0$/.test(card), card);
    await page.click('#coverDlBody .btn-primary'); await page.waitForTimeout(150);
    await page.click('#settingsBtn'); await page.click('#settingsCoverDlBtn'); await page.waitForTimeout(200);
    check('run again, it offers only what is still a link', /Save 4 covers/.test(await page.innerText('#coverDlBody')));

    // Stop: the run ends after the cover in hand.
    await page.click('#coverDlStart'); await page.click('#coverDlStop');
    await page.waitForFunction(() => _coverDl && _coverDl.finished, null, { timeout: 30000 });
    check('Stop ends the run early', await page.evaluate(() => _coverDl.stopped && _coverDl.done < _coverDl.jobs.length) &&
      /Stopped\./.test(await page.innerText('#coverDlBody')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('Escape closes it', await page.evaluate(() => !document.getElementById('coverDlModal').classList.contains('open')));
    await ctx.close(); }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
