// The first sync with a repo that already holds a different library asks how
// to combine them, and sends nothing until answered: merge (repo's version by
// default where an entry differs, or chosen per entry), use the repo's, or
// use this device's. Nothing to decide → no question.
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const b64 = s => Buffer.from(s).toString('base64');
const unb64 = s => Buffer.from(s, 'base64').toString('utf8');
const bk = (id, title, extra = {}) => ({ id, title, author: 'X', status: 'want', formats: ['ebook'], ...extra });
const A_REPO = bk(1700000000001, 'Alpha'), A_HERE = bk(1700000000001, 'Alpha', { status: 'read', finished: '2026-01' });
const B = bk(1700000000002, 'Bravo'), C = bk(1700000000003, 'Charlie');
const G1 = { id: 1700000000201, title: 'Hades', platforms: [{ platform: 'steam', formats: ['digital'] }] };
const G2 = { id: 1700000000202, title: 'Celeste', platforms: [{ platform: 'steam', formats: ['digital'] }] };

function fakeGitHub(initial) {
  const remote = {}; let n = 0; const puts = [];
  for (const [p, v] of Object.entries(initial)) remote[p] = { sha: 'r-' + p, text: J(v) };
  const handler = async r => {
    const req = r.request();
    const m = new URL(req.url()).pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.+))?$/);
    if (m && !m[1]) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"private":true}' });
    const path = decodeURIComponent(m[1]);
    if (req.method() === 'GET') {
      const f = remote[path];
      return f ? r.fulfill({ status: 200, contentType: 'application/json', body: J({ sha: f.sha, content: b64(f.text) }) })
               : r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    }
    puts.push(path);
    const body = JSON.parse(req.postData()); const f = remote[path];
    if (f && !body.sha) return r.fulfill({ status: 422, contentType: 'application/json', body: '{"message":"Invalid request. \\"sha\\" wasn\'t supplied."}' });
    if (f && body.sha !== f.sha) return r.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
    const sha = 's' + (++n); remote[path] = { sha, text: unb64(body.content) };
    return r.fulfill({ status: 201, contentType: 'application/json', body: J({ content: { sha } }) });
  };
  return { remote, puts, handler, read: p => JSON.parse(remote[p].text) };
}

async function device(browser, gh, local) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('https://api.github.com/**', gh.handler);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(s => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(s.books || [])); localStorage.setItem('mediaLibrary', JSON.stringify(s.media || []));
    localStorage.setItem('videoGames', JSON.stringify(s.games || [])); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books');
    localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' }));
    localStorage.setItem('booklogger.pat', 'ghp_test');
    for (const [k, v] of Object.entries(s.ls || {})) localStorage.setItem(k, JSON.stringify(v));
  }, local);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(1800);
  return { ctx, page, errors };
}
const live = list => list.filter(r => !r.deleted).map(r => r.title).sort().join(',');
const sheetOpen = page => page.locator('#resolveModal.open').count().then(n => n === 1);

(async () => {
  const browser = await launch();
  const errors = [];

  // ── 1. A device with its own library meets a repo with another ──────
  let gh = fakeGitHub({ 'data/books.json': [A_REPO, C], 'data/media.json': [{ id: 1700000000101, title: 'Alien', type: 'movie' }], 'data/games.json': [G2] });
  let d = await device(browser, gh, { books: [A_HERE, B], games: [G1] });
  errors.push(...d.errors);
  check('nothing is uploaded before deciding', gh.puts.length === 0, J(gh.puts));
  check('the resolver opens by itself', await sheetOpen(d.page));
  const sections = await d.page.locator('#resolveBody .resolve-section .dupes-kind').allTextContents();
  check('it asks about Books and Games, not Movies & TV (empty here, so nothing to lose)', J(sections) === J(['📚 Books', '🎮 Games']), J(sections));
  check('Movies & TV came straight from the repo', await d.page.evaluate(() => mediaLibrary.map(m => m.title).join()) === 'Alien');
  const counts = await d.page.locator('#resolveBody .resolve-section[data-collection="books"] .resolve-counts li').allTextContents();
  check('it counts what differs', J(counts) === J(['Only on this device: 1', 'Only in the repo: 1', 'In both, but different: 1', 'The same in both: 0']), J(counts));
  const differ = await d.page.locator('#resolveBody .resolve-pick .missing-have').allTextContents();
  check('…and says what differs in an entry', J(differ) === J(['Differs in: status, finished']), J(differ));
  check('the badge says it needs a decision', (await d.page.locator('#syncBadge').textContent()) === 'needs a decision');
  await d.page.screenshot({ path: shot('sync-resolver-phone.png'), fullPage: true });
  await d.page.evaluate(() => { document.querySelectorAll('#resolveBody details').forEach(x => { x.open = true; }); document.getElementById('resolveBody').scrollTop = 99999; });
  await d.page.screenshot({ path: shot('sync-resolver-phone-2.png') });

  // Decide later: still nothing sent; the sync panel offers the way back.
  await d.page.click('#resolveBody button:text-is("Decide later")');
  check('"Decide later" closes it and still sends nothing', !(await sheetOpen(d.page)) && gh.puts.length === 0);
  await d.page.evaluate(() => { books[0].notes = 'edited while waiting'; save(); }); await d.page.waitForTimeout(500);
  check('…even after an edit', gh.puts.length === 0, J(gh.puts));
  await d.page.evaluate(() => openSyncModal());
  check('the sync panel explains, with a Choose… button', /already holds a library that differs/.test(await d.page.locator('#ghProblem').textContent()) &&
    await d.page.locator('#ghResolve').count() === 1);
  await d.page.click('#ghResolve'); await d.page.waitForTimeout(200);
  check('which reopens the resolver', await sheetOpen(d.page));
  await d.page.evaluate(() => closeSyncModal());

  // Books: merge, but keep this device's Alpha. Games: use the repo's.
  await d.page.locator('#resolveBody .resolve-section[data-collection="books"] details summary', { hasText: 'Choose for each' }).click();
  // The app draws its own radios: tap the pill / option card, as a person would.
  await d.page.click(`#resolveBody label:has(input[name="rp-books-${A_HERE.id}"][value="device"])`);
  await d.page.click('#resolveBody label:has(input[name="rs-games"][value="repo"])');
  check('choosing a whole side hides the per-entry choices', await d.page.locator('#resolveBody .resolve-section[data-collection="games"] .resolve-differ').count() === 0 ||
    !(await d.page.locator('#resolveBody .resolve-section[data-collection="games"] .resolve-differ').isVisible()));
  await d.page.click('#resolveApply'); await d.page.waitForTimeout(1500);
  const repoBooks = gh.read('data/books.json');
  check('merge: the repo gets every entry from both', live(repoBooks) === 'Alpha,Bravo,Charlie', live(repoBooks));
  check('…with this device\'s Alpha, as chosen', repoBooks.find(b => b.id === A_HERE.id).status === 'read');
  check('…and this device matches', await d.page.evaluate(() => books.map(b => b.title).sort().join()) === 'Alpha,Bravo,Charlie' &&
    await d.page.evaluate(id => books.find(b => b.id === id).status, A_HERE.id) === 'read');
  check('"use the repo\'s": this device takes the repo\'s games, and the repo is not rewritten',
    await d.page.evaluate(() => videoGames.map(g => g.title).join()) === 'Celeste' && !gh.puts.includes('data/games.json'), J(gh.puts));
  check('everything is synced', await d.page.evaluate(() => ghStore.syncStatus().status) === 'ok' &&
    (await d.page.locator('#syncBadge').textContent()) === 'synced');
  check('the sheet closed', !(await sheetOpen(d.page)));
  await d.ctx.close();

  // ── 2. Use this device's ────────────────────────────────────────────
  gh = fakeGitHub({ 'data/books.json': [A_REPO, C] });
  d = await device(browser, gh, { books: [A_HERE, B] });
  errors.push(...d.errors);
  await d.page.click('#resolveBody label:has(input[name="rs-books"][value="device"])');
  await d.page.click('#resolveApply'); await d.page.waitForTimeout(1500);
  const after = gh.read('data/books.json');
  check('"use this device\'s": the repo holds exactly this device\'s books', live(after) === 'Alpha,Bravo' && after.find(b => b.id === A_HERE.id).status === 'read', J(after));
  check('…and Charlie, only in the repo, is deleted as a tombstone (so other devices drop it)', !!after.find(r => r.id === C.id && r.deleted));
  check('…while this device is unchanged', await d.page.evaluate(() => books.map(b => b.title).sort().join()) === 'Alpha,Bravo');
  await d.ctx.close();

  // ── 3. Default: merge, the repo's version where an entry differs ────
  gh = fakeGitHub({ 'data/books.json': [A_REPO, C] });
  d = await device(browser, gh, { books: [A_HERE, B] });
  errors.push(...d.errors);
  await d.page.click('#resolveApply'); await d.page.waitForTimeout(1500);
  check('by default: merged, and the repo\'s Alpha kept over this device\'s', live(gh.read('data/books.json')) === 'Alpha,Bravo,Charlie' &&
    gh.read('data/books.json').find(b => b.id === A_HERE.id).status === 'want' &&
    await d.page.evaluate(id => books.find(b => b.id === id).status, A_HERE.id) === 'want');
  await d.ctx.close();

  // ── 4. Nothing to decide → no question ──────────────────────────────
  gh = fakeGitHub({ 'data/books.json': [A_REPO, C] });
  d = await device(browser, gh, { books: [A_REPO] });
  errors.push(...d.errors);
  check('a device holding only what the repo has is not asked, and gains the rest', !(await sheetOpen(d.page)) &&
    await d.page.evaluate(() => books.map(b => b.title).sort().join()) === 'Alpha,Charlie');
  check('…and leaves the repo as it was', live(gh.read('data/books.json')) === 'Alpha,Charlie');
  await d.page.evaluate(() => { books[0].notes = 'later edit'; save(); }); await d.page.waitForTimeout(800);
  check('a later edit syncs normally, without asking', !(await sheetOpen(d.page)) &&
    gh.read('data/books.json').some(b => b.notes === 'later edit'));
  await d.ctx.close();

  gh = fakeGitHub({});
  d = await device(browser, gh, { books: [A_HERE, B] });
  errors.push(...d.errors);
  check('an empty repo is not asked about: this device\'s library is uploaded', !(await sheetOpen(d.page)) && live(gh.read('data/books.json')) === 'Alpha,Bravo');
  await d.ctx.close();

  // ── 5. Everything deleted here, then "use the repo's" ───────────────
  // The deletions left tombstones on this device. Choosing the repo's
  // entries must override them — not let them hide every entry again.
  const tombs = { books: { [A_REPO.id]: Date.now() - 1000, [C.id]: Date.now() - 1000 } };
  gh = fakeGitHub({ 'data/books.json': [A_REPO, C] });
  d = await device(browser, gh, { books: [], ls: { tombstones: tombs } });
  errors.push(...d.errors);
  check('a device that deleted everything is asked (its deletions differ from the repo)', await sheetOpen(d.page));
  await d.page.click('#resolveBody label:has(input[name="rs-books"][value="repo"])');
  await d.page.click('#resolveApply'); await d.page.waitForTimeout(1500);
  check('"use the repo\'s" brings every entry back', await d.page.evaluate(() => books.map(b => b.title).sort().join()) === 'Alpha,Charlie',
    await d.page.evaluate(() => books.map(b => b.title).join()));
  check('…on screen too', await d.page.locator('#booksGrid .book-card').count() === 2);
  check('…drops the local deletions it overrode', await d.page.evaluate(() => !Object.keys((JSON.parse(localStorage.getItem('tombstones')) || {}).books || {}).length));
  check('…and leaves the repo untouched', live(gh.read('data/books.json')) === 'Alpha,Charlie' && !gh.puts.includes('data/books.json'), J(gh.puts));
  await d.page.reload(); await d.page.waitForTimeout(1500);
  check('…and they are still there after a reload', await d.page.evaluate(() => books.length) === 2);
  await d.page.evaluate(() => { books[0].notes = 'after'; save(); }); await d.page.waitForTimeout(1000);
  check('a later edit syncs the entries, not deletions', live(gh.read('data/books.json')) === 'Alpha,Charlie', J(gh.read('data/books.json')));
  await d.ctx.close();

  // Merge, keeping the repo's version of an entry deleted here, restores it the same way.
  gh = fakeGitHub({ 'data/books.json': [A_REPO, C] });
  d = await device(browser, gh, { books: [C], ls: { tombstones: { books: { [A_REPO.id]: Date.now() - 1000 } } } });
  errors.push(...d.errors);
  await d.page.click('#resolveApply'); await d.page.waitForTimeout(1500);
  check('merge, with the repo\'s version of an entry deleted here: it comes back', await d.page.evaluate(() => books.map(b => b.title).sort().join()) === 'Alpha,Charlie' &&
    live(gh.read('data/books.json')) === 'Alpha,Charlie');
  await d.ctx.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
