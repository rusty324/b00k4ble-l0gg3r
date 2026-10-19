// Sync must not lose data: connecting a device that already has a library
// merges instead of replacing it (#34), and a deletion stays deleted no matter
// which device is stale (tombstones).
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

async function device(browser, seed) {
  const ctx = await browser.newContext({ acceptDownloads: true });
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

  // ── 1. #34: a device with its own library joins a repo that has another ──
  remote['data/books.json'] = { sha: 'r1', text: J([A, C], null, 2) };
  const d1 = await device(browser, { books: [A, B] });
  check('#34: the device keeps its own book and gains the repo\'s', await titles(d1.page) === 'Alpha,Bravo,Charlie', await titles(d1.page));
  check('and the repo now holds the union too', liveIds(remoteBooks()) === 'Alpha,Bravo,Charlie', liveIds(remoteBooks()));
  check('and everything is synced', J(await st(d1.page)) === J({ s: 'ok', q: 0 }), J(await st(d1.page)));

  // ── 2. Deleting leaves a tombstone in the repo, nowhere else ─────────
  await viaDetail(d1.page.locator('#booksGrid .book-card', { hasText: 'Bravo' }), 'Delete');
  await d1.page.waitForTimeout(1200);
  const tomb = remoteBooks().find(r => r.id === B.id);
  check('the deletion reaches the repo as a tombstone', !!tomb && tomb.deleted === true && tomb.deletedAt > 0 && !('title' in tomb), J(tomb));
  check('the app itself never sees it', await titles(d1.page) === 'Alpha,Charlie' &&
    await d1.page.evaluate(() => !books.some(b => b.deleted) && !JSON.parse(localStorage.getItem('myLibrary')).some(b => b.deleted)));
  const [dl] = await Promise.all([d1.page.waitForEvent('download'), d1.page.evaluate(() => exportData())]);
  const exported = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  check('exports contain no tombstones', exported.items.every(r => !r.deleted) && exported.items.length === 2, J(exported.items.map(r => r.title)));

  // ── 3. A stale device, merging: its live copy must not resurrect it ──
  const d2 = await device(browser, { books: [A, B, C] });
  check('stale device (merge path): the deleted book does not come back to the repo', liveIds(remoteBooks()) === 'Alpha,Charlie', liveIds(remoteBooks()));
  check('and disappears from the stale device too', await titles(d2.page) === 'Alpha,Charlie', await titles(d2.page));
  await d2.ctx.close();

  // ── 4. A stale device, refreshing a clean cache ─────────────────────
  const d3 = await device(browser, { books: [A, B, C], ls: {
    'booklogger.data.data/books.json': [A, B, C], 'booklogger.sha.data/books.json': 'old-sha' } });
  check('stale device (refresh path): the tombstone removes its copy', await titles(d3.page) === 'Alpha,Charlie', await titles(d3.page));
  await d3.ctx.close();

  // ── 5. A delete racing another device's edit ────────────────────────
  // Another device adds Delta; this device has not seen it and deletes Charlie.
  const theirs = [...remoteBooks(), D];
  remote['data/books.json'] = { sha: 'other-device', text: J(theirs, null, 2) };
  await viaDetail(d1.page.locator('#booksGrid .book-card', { hasText: 'Charlie' }), 'Delete');
  await d1.page.waitForTimeout(1500);
  check('the conflict merges: their addition kept, this deletion kept', liveIds(remoteBooks()) === 'Alpha,Delta', liveIds(remoteBooks()));
  check('and this device shows exactly that', await titles(d1.page) === 'Alpha,Delta', await titles(d1.page));

  // ── 6. Importing a deleted book brings it back for good ─────────────
  const fs = require('fs'), os = require('os'), path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'imp-')), 'b.json');
  fs.writeFileSync(file, J({ lastUpdatedOn: null, items: [B] }));
  await d1.page.setInputFiles('#importFile', file); await d1.page.waitForTimeout(1500);
  const revived = await d1.page.evaluate(id => books.find(b => b.title === 'Bravo'), B.id);
  check('importing a deleted book restores it, under a new id', !!revived && revived.id !== B.id, J(revived && revived.id));
  check('and the next sync does not delete it again', liveIds(remoteBooks()) === 'Alpha,Bravo,Delta' && await titles(d1.page) === 'Alpha,Bravo,Delta', liveIds(remoteBooks()));

  // ── 7. Old tombstones are pruned ────────────────────────────────────
  const pruned = await d1.page.evaluate(() => {
    const t = readTombs(); t.books = t.books || {}; t.books[1600000000000] = Date.now() - 400 * 864e5; writeTombs(t);
    books.push(normalizeBook({ id: newId(), title: 'Temp', author: 'X' })); save();
    books = books.filter(b => b.title !== 'Temp'); save();
    return Object.keys(readTombs().books);
  });
  check('a tombstone older than a year is dropped', !pruned.includes('1600000000000') && pruned.length >= 3, J(pruned));

  // ── 8. Local-only: deletions are recorded, nothing is sent ──────────
  await d1.ctx.close();      // nothing else running while the local-only device is checked
  const d4 = await device(browser, { books: [A, B], repo: false });
  await viaDetail(d4.page.locator('#booksGrid .book-card', { hasText: 'Bravo' }), 'Delete');
  await d4.page.waitForTimeout(500);
  check('without sync, a delete is still recorded for when sync is connected',
    await d4.page.evaluate(id => !!(readTombs().books || {})[id], B.id) && d4.asked.length === 0, J(d4.asked));
  await d4.ctx.close();

  check('no page errors', d1.errors.length === 0, d1.errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
