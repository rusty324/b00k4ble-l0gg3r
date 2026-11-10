// Covers can be a link or an uploaded image (js/app/cover-files.js): the image
// is resized, kept on the device in IndexedDB, uploaded to the data repo as
// covers/<kind>/<name>.jpg once sync can, fetched with the token on another
// device, encrypted when a sync password is set — and links keep working.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const b64 = s => Buffer.from(s).toString('base64');
const BOOK = { id: 1700000000001, title: 'Linked', author: 'A', status: 'want', formats: ['ebook'], coverUrl: 'https://img.example/linked.jpg' };
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// One fake GitHub shared by every "device"; content kept as base64, so it is binary-safe.
const remote = {}; const asked = []; let n = 0;
async function fakeGitHub(ctx) {
  await ctx.route('https://img.example/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }));
  await ctx.route('https://api.github.com/**', async r => {
    const req = r.request(); asked.push(`${req.method()} ${req.url()}`);
    const m = new URL(req.url()).pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.+))?$/);
    if (m && !m[1]) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"private":true}' });
    const path = m ? decodeURIComponent(m[1]) : '';
    if (req.method() === 'GET') {
      const f = remote[path];
      return f ? r.fulfill({ status: 200, contentType: 'application/json', body: J({ sha: f.sha, content: f.content }) })
               : r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    }
    const body = JSON.parse(req.postData()); const f = remote[path];
    if (f && body.sha !== f.sha) return r.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
    const sha = 's' + (++n); remote[path] = { sha, content: body.content };
    return r.fulfill({ status: 201, contentType: 'application/json', body: J({ content: { sha } }) });
  });
}

async function device(browser, { library = [BOOK], media = [], games = [], synced = false, password = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/openlibrary.org/**', r => r.abort());
  await fakeGitHub(ctx);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g, synced, pw]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
    if (synced) {
      localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' }));
      localStorage.setItem('booklogger.pat', 'ghp_test');
    }
    if (pw) localStorage.setItem('booklogger.enc.pw', pw);
  }, [library, media, games, synced, password]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(900);
  return { ctx, page, errors };
}

// A 900×1350 photo, drawn in the page, as the file the user picks.
async function photo(page) {
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1350;
    const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 900, 1350); x.fillStyle = '#33c'; x.fillRect(100, 100, 300, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}
async function upload(page, inputId, kind) {
  const file = await photo(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(([i, k]) => pickCoverFile(i, k), [inputId, kind])]);
  await chooser.setFiles(file);
  await page.waitForFunction(i => document.getElementById(i).value.startsWith('repo:'), inputId);
  await page.waitForTimeout(150);
  return page.inputValue('#' + inputId);
}
const imgInfo = (page, sel) => page.locator(sel).first().evaluate(async img => {
  for (let i = 0; i < 30 && !(img.src.startsWith('blob:') && img.complete && img.naturalWidth); i++) await new Promise(r => setTimeout(r, 100));
  return { src: img.src.slice(0, 5), w: img.naturalWidth, h: img.naturalHeight };
});
const remoteCovers = () => Object.keys(remote).filter(p => p.startsWith('data/covers/'));

(async () => {
  const browser = await launch();
  const errors = [];

  // ── 1. Local only: the image stays on the device ───────────────────
  let bookCover;
  { const { ctx, page, errors: e } = await device(browser); errors.push(...e);
    const linked = await page.locator('#booksGrid .book-card', { hasText: 'Linked' }).locator('img').getAttribute('src');
    check('a linked cover still renders from its link', linked === BOOK.coverUrl, linked);
    await page.evaluate(() => openAddModal());
    await page.fill('#f-title', 'Uploaded One'); await page.fill('#f-author', 'B');
    bookCover = await upload(page, 'f-coverUrl', 'books');
    check('picking an image fills the field with a repo: path', /^repo:covers\/books\/[a-z0-9]+\.jpg$/.test(bookCover), bookCover);
    const prev = await imgInfo(page, '#f-coverUrl-preview');
    check('the form previews it, resized to about 300px wide', prev.src === 'blob:' && prev.w === 300 && prev.h === 450, J(prev));
    check('…and says it stays here until sync is set up', /until sync is set up/.test(await page.innerText('#f-coverUrl-msg')));
    await page.evaluate(() => saveBook()); await page.waitForTimeout(300);
    const card = await imgInfo(page, '#booksGrid .book-card:has-text("Uploaded One") img');
    check('the card shows the uploaded image', card.src === 'blob:' && card.w === 300, J(card));
    check('with no repo, nothing went to GitHub', asked.length === 0, J(asked));
    await page.reload(); await page.waitForTimeout(900);
    const again = await imgInfo(page, '#booksGrid .book-card:has-text("Uploaded One") img');
    check('after a reload it comes back from this device', again.src === 'blob:' && again.w === 300, J(again));
    // Now connect sync: the waiting image goes up.
    await page.evaluate(() => { localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' })); localStorage.setItem('booklogger.pat', 'ghp_test'); });
    await page.reload(); await page.waitForTimeout(1800);
    const path = 'data/' + bookCover.slice(5);
    check('once sync is set up, the image is uploaded to the data repo', !!remote[path], J(remoteCovers()));
    check('…as a real JPEG file', remote[path] && Buffer.from(remote[path].content, 'base64').subarray(0, 2).toString('hex') === 'ffd8');
    check('…and the record carries the path', JSON.parse(Buffer.from(remote['data/books.json'].content, 'base64').toString()).some(b => b.coverUrl === bookCover));

    // A picked image the form never saved is not uploaded.
    await page.evaluate(() => openAddModal());
    const abandoned = await upload(page, 'f-coverUrl', 'books');
    await page.evaluate(() => closeModal());
    await page.evaluate(() => flushCoverUploads()); await page.waitForTimeout(500);
    check('an image picked in a cancelled form is not uploaded', !remote['data/' + abandoned.slice(5)]);
    await ctx.close(); }

  // ── 2. Another device fetches it with its token ────────────────────
  { const lib = [BOOK, { id: 1700000000002, title: 'Uploaded One', author: 'B', status: 'want', formats: ['ebook'], coverUrl: bookCover }];
    const { ctx, page, errors: e } = await device(browser, { library: lib, synced: true }); errors.push(...e);
    const card = await imgInfo(page, '#booksGrid .book-card:has-text("Uploaded One") img');
    check('another device shows the uploaded cover, fetched from the repo', card.src === 'blob:' && card.w === 300, J(card));
    check('…through the API, from the private data repo', asked.some(a => a.startsWith('GET') && a.includes('/repos/me/data/contents/data/covers/books/')));
    // (The first-sync resolver may be open here — the two devices' libraries differ — so open the sheet directly.)
    await page.evaluate(() => openDetail('books', books.find(b => b.title === 'Uploaded One').id)); await page.waitForTimeout(300);
    const det = await imgInfo(page, '#detailBody img');
    check('the detail sheet shows it too', det.src === 'blob:' && det.w > 0, J(det));
    await ctx.close(); }

  // ── 3. Movies & TV and Games ───────────────────────────────────────
  { const { ctx, page, errors: e } = await device(browser, { synced: true }); errors.push(...e);
    await page.evaluate(() => switchTab('media')); await page.waitForTimeout(200);
    await page.evaluate(() => openMediaModal(null));
    await page.fill('#m-title', 'A Film');
    const poster = await upload(page, 'm-posterUrl', 'media');
    await page.evaluate(() => saveMediaItem()); await page.waitForTimeout(1200);
    check('a film takes an uploaded poster', await page.evaluate(() => mediaLibrary.find(m => m.title === 'A Film').posterUrl) === poster && /^repo:covers\/media\//.test(poster), poster);
    const pc = await imgInfo(page, '#altContent img');
    check('…shown on its card', pc.src === 'blob:' && pc.w === 300, J(pc));
    check('…and uploaded', !!remote['data/' + poster.slice(5)], J(remoteCovers()));
    await page.evaluate(() => switchTab('games')); await page.waitForTimeout(200);
    await page.evaluate(() => openGameModal(null));
    await page.fill('#g-title', 'A Game'); await page.evaluate(() => setGamePlatforms([{ platform: 'steam', formats: [] }]));
    const gc = await upload(page, 'g-coverUrl', 'games');
    await page.evaluate(() => saveGameItem()); await page.waitForTimeout(1200);
    check('a game takes an uploaded cover, uploaded too', /^repo:covers\/games\//.test(gc) && !!remote['data/' + gc.slice(5)], gc);
    const gi = await imgInfo(page, '#altContent img');
    check('…shown on its card', gi.src === 'blob:' && gi.w === 300, J(gi));
    // A link still saves as a link.
    await page.evaluate(() => openGameModal(null));
    await page.fill('#g-title', 'Linked Game'); await page.evaluate(() => setGamePlatforms([{ platform: 'steam', formats: [] }])); await page.fill('#g-coverUrl', 'https://img.example/g.png');
    await page.evaluate(() => saveGameItem()); await page.waitForTimeout(300);
    check('a pasted link is still saved as a link', await page.evaluate(() => videoGames.find(g => g.title === 'Linked Game').coverUrl) === 'https://img.example/g.png');
    await ctx.close(); }

  // ── 4. With a sync password, the file is encrypted ─────────────────
  { const { ctx, page, errors: e } = await device(browser, { synced: true, password: 'hunter2' }); errors.push(...e);
    await page.evaluate(() => openAddModal());
    await page.fill('#f-title', 'Secret Cover'); await page.fill('#f-author', 'C');
    const sc = await upload(page, 'f-coverUrl', 'books');
    await page.evaluate(() => saveBook()); await page.waitForTimeout(1500);
    const f = remote['data/' + sc.slice(5)];
    const text = f ? Buffer.from(f.content, 'base64').toString() : '';
    check('with a password the cover is stored as an encrypted envelope', /\.json$/.test(sc) && !!f && !/ffd8/.test(Buffer.from(f.content, 'base64').subarray(0, 2).toString('hex')) && /"format":"ft-encrypted"/.test(text) && !/image\/jpeg/.test(text), text.slice(0, 80));
    await ctx.close();
    const lib = [{ id: 1700000000003, title: 'Secret Cover', author: 'C', status: 'want', formats: ['ebook'], coverUrl: sc }];
    const other = await device(browser, { library: lib, synced: true, password: 'hunter2' }); errors.push(...other.errors);
    const card = await imgInfo(other.page, '#booksGrid .book-card:has-text("Secret Cover") img');
    check('a device with the password decrypts and shows it', card.src === 'blob:' && card.w === 300, J(card));
    await other.ctx.close(); }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
