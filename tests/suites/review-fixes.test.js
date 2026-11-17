// Fixes from the November 2026 review: a stale device no longer reverts
// another device's edit, a repo file that isn't ours is never overwritten, a
// full localStorage is reported, a blurb link is sanitised, the tab strip
// shows that it scrolls, and the app opens offline.
const { launch, BASE, reporter, viaDetail } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const b64 = s => Buffer.from(s).toString('base64');
const unb64 = s => Buffer.from(s, 'base64').toString('utf8');
const bk = (id, title) => ({ id, title, author: 'X', status: 'want', formats: ['ebook'] });
const A = bk(1700000000001, 'Alpha'), B = bk(1700000000002, 'Bravo'), C = bk(1700000000003, 'Charlie'), D = bk(1700000000004, 'Delta');

// One GitHub shared by every simulated device, with real sha semantics.
const remote = {}; let shaN = 0;
const remoteBooks = () => JSON.parse(remote['data/books.json'].text);
const liveIds = recs => recs.filter(r => !r.deleted).map(r => r.title).sort().join(',');
async function github(r) {
  const req = r.request();
  const m = new URL(req.url()).pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.+))?$/);
  if (m && !m[1]) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  const path = decodeURIComponent(m[1]);
  if (req.method() === 'GET') {
    const f = remote[path];
    return f ? r.fulfill({ status: 200, contentType: 'application/json', body: J({ sha: f.sha, content: b64(f.text) }) })
             : r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
  }
  const body = JSON.parse(req.postData()); const f = remote[path];
  if (f && !body.sha) return r.fulfill({ status: 422, contentType: 'application/json', body: '{"message":"Invalid request. \\"sha\\" wasn\'t supplied."}' });
  if (f && body.sha !== f.sha) return r.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
  const sha = 's' + (++shaN); remote[path] = { sha, text: unb64(body.content) };
  return r.fulfill({ status: 201, contentType: 'application/json', body: J({ content: { sha } }) });
}

async function device(browser, seed, ctxOpts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...ctxOpts });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('https://api.github.com/**', github);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const asked = [];      // this device's own GitHub requests
  page.on('request', q => { if (q.url().startsWith('https://api.github.com/')) asked.push(q.url()); });
  await page.addInitScript(s => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(s.books || []));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'books');
    if (s.repo !== false) {
      localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' }));
      localStorage.setItem('booklogger.pat', 'ghp_test');
    }
    for (const [k, v] of Object.entries(s.ls || {})) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, seed);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(2000);
  // A first sync with a repo that differs asks first (sync-resolver suite);
  // these scenarios take its default, "Merge both", with the repo's version
  // wherever the same entry differs.
  if (await page.locator('#resolveModal.open').count()) {
    await page.click('#resolveApply'); await page.waitForTimeout(1500);
  }
  return { ctx, page, errors, asked };
}
const titles = page => page.evaluate(() => books.map(b => b.title).sort().join(','));
const st = page => page.evaluate(() => ({ s: ghStore.syncStatus().status, q: ghStore.cache.getQueue().length }));

(async () => {
  const browser = await launch();

  // ── 1. A conflict keeps the other device's edit ─────────────────────
  remote['data/books.json'] = { sha: 'r1', text: J([A, B], null, 2) };
  const d1 = await device(browser, { books: [] });
  check('the device pulls the repo\'s library', await titles(d1.page) === 'Alpha,Bravo', await titles(d1.page));
  // One edit of its own, so the repo holds this app's own shape of both records.
  await d1.page.evaluate(() => { books.push(normalizeBook({ id: 1700000000009, title: 'Echo', author: 'X' })); save(); });
  await d1.page.waitForTimeout(1200);
  check('and is in sync', J(await st(d1.page)) === J({ s: 'ok', q: 0 }), J(await st(d1.page)));
  // Another device marks Alpha as read. This one hasn't seen that, and edits Bravo.
  remote['data/books.json'] = { sha: 'other-device', text: J(remoteBooks().map(r => (r.id === A.id ? { ...r, status: 'read', notes: 'theirs' } : r)), null, 2) };
  await d1.page.evaluate(id => { books.find(b => b.id === id).notes = 'mine'; save(); }, B.id);
  // The conflict round trip (rejected write, re-read, merge, write again) takes
  // as long as it takes on a busy runner: wait for the merged write to land.
  for (let t = 0; t < 100; t++) {
    const r = Object.fromEntries(remoteBooks().map(x => [x.title, x]));
    if (r.Bravo && r.Bravo.notes === 'mine' && (await st(d1.page)).q === 0) break;
    await d1.page.waitForTimeout(100);
  }
  await d1.page.waitForTimeout(300);
  const after = Object.fromEntries(remoteBooks().map(r => [r.title, r]));
  check('the other device\'s edit survives the merge', after.Alpha.status === 'read' && after.Alpha.notes === 'theirs', J(after.Alpha));
  check('and so does this device\'s', after.Bravo.notes === 'mine', J(after.Bravo));
  check('this device now shows the other\'s edit too', await d1.page.evaluate(id => books.find(b => b.id === id).status, A.id) === 'read');
  check('nothing is left queued', J(await st(d1.page)) === J({ s: 'ok', q: 0 }), J(await st(d1.page)));

  // ── 2. A full localStorage is said out loud ─────────────────────────
  await d1.page.evaluate(() => {
    const real = Storage.prototype.setItem;
    window.__full = (pred) => { Storage.prototype.setItem = function (k, v) { if (pred(k)) throw new DOMException('full', 'QuotaExceededError'); return real.call(this, k, v); }; };
    window.__roomy = () => { Storage.prototype.setItem = real; };
  });
  const threw = await d1.page.evaluate((id) => {
    window.__full(k => k === 'myLibrary');
    try { books.find(b => b.id === id).notes = 'no room'; save(); return false; } catch { return true; } finally { window.__roomy(); }
  }, B.id);
  check('a full localStorage does not throw out of save()', threw === false);
  check('it says the change was not saved here', /storage is full/i.test(await d1.page.textContent('#statusBanner')) &&
    await d1.page.evaluate(() => document.getElementById('statusBanner').classList.contains('banner-error')));
  await d1.page.waitForTimeout(1200);
  const full = await d1.page.evaluate((id) => {
    window.__full(k => k.startsWith('booklogger.data.'));
    books.find(b => b.id === id).notes = 'still no room'; save();
    window.__roomy();
    const s = ghStore.syncStatus();
    return { s: s.status, e: s.error && s.error.name };
  }, B.id);
  check('when the sync copy cannot be kept, the badge is an error, not "synced"', full.s === 'error' && full.e === 'StorageFullError', J(full));
  await d1.ctx.close();

  // ── 3. A file that isn't ours is never overwritten ──────────────────
  const foreign = J({ owner: 'some other tool', shelves: { fiction: 12 } });
  remote['data/books.json'] = { sha: 'foreign', text: foreign };
  const d2 = await device(browser, { books: [A] });
  await d2.page.evaluate(() => { books.push(normalizeBook({ id: 1700000000010, title: 'Foxtrot', author: 'X' })); save(); });
  await d2.page.waitForTimeout(1500);
  check('another tool\'s books.json is left exactly as it was', remote['data/books.json'].text === foreign, remote['data/books.json'].text.slice(0, 80));
  const s2 = await d2.page.evaluate(() => { const s = ghStore.syncStatus(); return { s: s.status, e: s.error && s.error.name, q: ghStore.cache.getQueue().length }; });
  check('the problem is reported and the edit stays queued', s2.s === 'error' && s2.e === 'ShapeError' && s2.q >= 1, J(s2));
  check('the library on the device is untouched', await titles(d2.page) === 'Alpha,Foxtrot', await titles(d2.page));

  // ── 4. A blurb's source link goes through safeUrl ───────────────────
  const html = await d2.page.evaluate(() => [
    blurbSectionHtml('books', { id: 1, blurb: 'x', blurbSource: 'Evil', blurbUrl: 'javascript:alert(1)' }),
    blurbSectionHtml('books', { id: 1, blurb: 'x', blurbSource: 'Wikipedia', blurbUrl: 'https://en.wikipedia.org/wiki/X' }),
  ]);
  check('a javascript: blurb link is not rendered as a link', !/href=/.test(html[0]) && /Evil/.test(html[0]), html[0].slice(0, 200));
  check('an https one still is', /href="https:\/\/en\.wikipedia\.org\/wiki\/X"/.test(html[1]));
  await d2.ctx.close();

  // ── 5. The tab strip shows that it scrolls; the app opens offline ───
  remote['data/books.json'] = { sha: 'r9', text: J([A], null, 2) };
  const d3 = await device(browser, { books: [A] });
  await d3.page.setViewportSize({ width: 390, height: 800 });
  await d3.page.waitForTimeout(400);
  const bar = () => d3.page.evaluate(() => { const b = document.querySelector('.tab-bar'); return { r: b.classList.contains('more-right'), l: b.classList.contains('more-left'), over: b.scrollWidth > b.clientWidth }; });
  const b0 = await bar();
  check('at phone width the cut-off tab strip fades on the right', !b0.over || (b0.r && !b0.l), J(b0));
  await d3.page.evaluate(() => { const b = document.querySelector('.tab-bar'); b.scrollLeft = b.scrollWidth; });
  await d3.page.waitForTimeout(200);
  const b1 = await bar();
  check('scrolled to the end, it fades on the left instead', !b1.over || (b1.l && !b1.r), J(b1));

  // The offline check needs the service worker, which the other devices run
  // without (tests/lib.js); this one has no sync, so nothing to intercept.
  const d4 = await device(browser, { books: [A], repo: false }, { serviceWorkers: 'allow' });
  await d4.page.reload(); await d4.page.waitForTimeout(1500);
  const sw = await d4.page.evaluate(() => new Promise((resolve) => {
    if (!('serviceWorker' in navigator)) return resolve(false);
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'precached') resolve(true); });
    navigator.serviceWorker.ready.then((reg) => reg.active.postMessage({ type: 'precache', urls: [location.href.split('#')[0], ...performance.getEntriesByType('resource').map((r) => r.name)] }));
    setTimeout(() => resolve(false), 15000);
  }));
  check('the service worker has the app', sw === true);
  await d4.ctx.setOffline(true);
  await d4.page.reload(); await d4.page.waitForTimeout(2500);
  check('the app opens with no connection, library and all', await d4.page.evaluate(() => typeof books !== 'undefined' && books.length === 1 && !!document.querySelector('.tab-bar .tab')));
  await d4.ctx.setOffline(false);

  check('no page errors', d1.errors.length + d2.errors.length + d3.errors.length + d4.errors.length === 0, [...d1.errors, ...d2.errors, ...d3.errors, ...d4.errors].slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
