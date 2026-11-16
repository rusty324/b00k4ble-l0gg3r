// The library is stored once: the sync layer reads the app's own records
// instead of keeping a second copy, and an older install's copy is shrunk on
// the next load without losing what it knew about the last sync.
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

const bytes = page => page.evaluate(() => {
  let app = 0, sync = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i), n = (localStorage.getItem(k) || '').length;
    if (['myLibrary', 'mediaLibrary', 'bookWishlist', 'videoGames'].includes(k)) app += n;
    else if (k.startsWith('booklogger.data.') || k.startsWith('booklogger.shadow.')) sync += n;
  }
  return { app, sync, marker: localStorage.getItem('booklogger.data.data/books.json') };
});

(async () => {
  const browser = await launch();
  // A library big enough that a second copy would matter.
  const many = Array.from({ length: 400 }, (_, i) => bk(1700000100000 + i, `Book ${i} ${'x'.repeat(200)}`));

  // ── 1. Synced: one copy, and the sync side is small ─────────────────
  remote['data/books.json'] = { sha: 'r1', text: J(many, null, 2) };
  const d1 = await device(browser, { books: many });
  check('the device syncs', J(await st(d1.page)) === J({ s: 'ok', q: 0 }), J(await st(d1.page)));
  await d1.page.evaluate(() => { books[0].notes = 'edited'; save(); });
  await d1.page.waitForTimeout(1200);
  const b1 = await bytes(d1.page);
  check('the sync layer keeps a marker, not a copy', b1.marker === '1', String(b1.marker).slice(0, 40));
  check(`its keys are a small fraction of the library (${b1.sync} vs ${b1.app} bytes)`, b1.sync < b1.app / 5, J(b1));
  check('and the edit still reached the repo', remoteBooks().find(r => r.id === many[0].id).notes === 'edited');

  // ── 2. Conflicts still keep the other device's edit ─────────────────
  remote['data/books.json'] = { sha: 'other', text: J(remoteBooks().map(r => (r.id === many[1].id ? { ...r, notes: 'theirs' } : r)), null, 2) };
  await d1.page.evaluate(id => { books.find(b => b.id === id).notes = 'mine'; save(); }, many[2].id);
  await d1.page.waitForTimeout(1500);
  const after = Object.fromEntries(remoteBooks().map(r => [r.id, r.notes]));
  check('a conflict keeps both devices\' edits', after[many[1].id] === 'theirs' && after[many[2].id] === 'mine', J([after[many[1].id], after[many[2].id]]));
  check('and this device shows the other\'s', await d1.page.evaluate(id => books.find(b => b.id === id).notes, many[1].id) === 'theirs');
  await d1.ctx.close();

  // ── 3. An older install's full copy is shrunk on load ───────────────
  // What an older version kept there: the app's records as it pushed them.
  const shaped = await (async () => {
    const d = await device(browser, { books: [A, B, C], repo: false });
    const out = await d.page.evaluate(() => syncSnapshot('books'));
    await d.ctx.close();
    return out;
  })();
  remote['data/books.json'] = { sha: 'r5', text: J(shaped, null, 2) };
  const d2 = await device(browser, { books: shaped, ls: {
    'booklogger.data.data/books.json': shaped, 'booklogger.sha.data/books.json': 'r5' } });
  const b2 = await bytes(d2.page);
  check('the old copy becomes the marker', b2.marker === '1', String(b2.marker).slice(0, 40));
  check('with a shadow of what it held', await d2.page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('booklogger.shadow.data/books.json')) || {}).length) === 3);
  // Edits after the migration are still tracked: another device's change to
  // Alpha survives this device's edit of Bravo.
  remote['data/books.json'] = { sha: 'r6', text: J(shaped.map(r => (r.id === A.id ? { ...r, notes: 'theirs' } : r)), null, 2) };
  await d2.page.evaluate(id => { books.find(b => b.id === id).notes = 'mine'; save(); }, B.id);
  await d2.page.waitForTimeout(1500);
  const a2 = Object.fromEntries(remoteBooks().map(r => [r.title, r.notes ?? null]));
  check('edits after the migration are tracked', a2.Alpha === 'theirs' && a2.Bravo === 'mine', J(a2));
  await d2.ctx.close();

  // ── 4. Local only: nothing for the sync side to store ───────────────
  const d3 = await device(browser, { books: many, repo: false });
  const b3 = await bytes(d3.page);
  // Only the marker and a per-record hash list (kept so the first sync can
  // tell which records were edited), not the library.
  check(`a device that never synced keeps no copy either (${b3.sync} vs ${b3.app} bytes)`, b3.sync < b3.app / 10, J(b3));
  await d3.ctx.close();

  check('no page errors', d1.errors.length + d2.errors.length + d3.errors.length === 0, [...d1.errors, ...d2.errors, ...d3.errors].slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
