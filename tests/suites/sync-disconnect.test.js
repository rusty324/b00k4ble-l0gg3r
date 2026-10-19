// Turning sync off. "Clear token" stops every upload; "Clear all sync
// settings" also forgets the data repo, folder, password and ghsync's cache,
// keeps the library, never wipes it in another open tab, and a later
// reconnect merges with the repo instead of being replaced by it (#34).
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const b64 = s => Buffer.from(s).toString('base64');
const unb64 = s => Buffer.from(s, 'base64').toString('utf8');
const BOOK = { id: 1700000000001, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['physical'] };

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext();
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  const remote = {}; const asked = []; let n = 0;
  await ctx.route('https://api.github.com/**', async r => {
    const req = r.request(); const url = req.url(); asked.push(`${req.method()} ${url}`);
    const m = new URL(url).pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.+))?$/);
    if (m && !m[1]) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"private":true}' });
    const path = m ? decodeURIComponent(m[1]) : '';
    if (req.method() === 'GET') {
      const f = remote[path];
      return f ? r.fulfill({ status: 200, contentType: 'application/json', body: J({ sha: f.sha, content: b64(f.text) }) })
               : r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    }
    const body = JSON.parse(req.postData()); const f = remote[path];
    if (f && body.sha !== f.sha) return r.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
    const sha = 's' + (++n); remote[path] = { sha, text: unb64(body.content) };
    return r.fulfill({ status: 201, contentType: 'application/json', body: J({ content: { sha } }) });
  });
  await ctx.addInitScript(b => {
    if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1');
    localStorage.setItem('myLibrary', JSON.stringify([b]));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' }));
    localStorage.setItem('booklogger.datafolder', 'lib');
    localStorage.setItem('booklogger.pat', 'ghp_test');
  }, BOOK);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const edit = (p = page) => p.evaluate(() => { books[0].notes = 'n' + Math.random(); save(); });
  const puts = () => asked.filter(a => a.startsWith('PUT')).length;
  const clickPanel = async label => {
    await page.evaluate(() => openSyncModal());
    await page.evaluate(l => [...document.querySelectorAll('#syncPanel button')].find(b => b.textContent === l).click(), label);
    await page.waitForTimeout(300);
  };

  await page.goto(BASE + '/index.html'); await page.waitForTimeout(1000);
  await edit(); await page.waitForTimeout(800);
  check('connected (folder "lib"), an edit uploads', !!remote['lib/books.json'], Object.keys(remote).join());

  // ── 1. Clear token alone ────────────────────────────────────────────
  await clickPanel('Clear token');
  let before = asked.length;
  await edit(); await page.waitForTimeout(800);
  check('after "Clear token", an edit sends nothing to GitHub', asked.length === before, J(asked.slice(before)));
  check('…and the badge says local only', await page.evaluate(() => ghStore.syncStatus().status === 'local'));
  await page.reload(); await page.waitForTimeout(1000);
  await edit(); await page.waitForTimeout(800);
  check('…still nothing after a reload', asked.length === before, J(asked.slice(before)));

  // ── 2. Clear all sync settings ──────────────────────────────────────
  await page.evaluate(() => localStorage.setItem('booklogger.pat', 'ghp_test'));
  await page.reload(); await page.waitForTimeout(1000);
  const tabB = await ctx.newPage(); tabB.on('pageerror', e => errors.push('B: ' + e.message));
  await tabB.goto(BASE + '/index.html'); await tabB.waitForTimeout(1000);
  await page.evaluate(() => localStorage.setItem('booklogger.enc.pw', 'secret'));
  check('the panel offers "Clear all sync settings" while connected', await page.evaluate(() => {
    openSyncModal(); return [...document.querySelectorAll('#syncPanel button')].some(b => b.textContent === 'Clear all sync settings' && !b.disabled);
  }));
  await clickPanel('Clear all sync settings');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('booklogger.')));
  check('it removes the token, data repo, folder and password', !keys.some(k => /\.(pat|datarepo|datafolder|enc\.pw)$/.test(k)), J(keys));
  check('…and every cached sha (the cache is re-seeded from the library, unsent)',
    !keys.some(k => k.startsWith('booklogger.sha.')) && keys.every(k => !k.startsWith('booklogger.data.lib/')), J(keys));
  check('…points the store back at the default folder', await page.evaluate(() => ghStore.files.books === 'data/books.json'));
  check('…keeps the library', await page.evaluate(() => books.length === 1 && JSON.parse(localStorage.getItem('myLibrary')).length === 1));
  check('…and says local only', await page.evaluate(() => ghStore.syncStatus().status === 'local'));
  const panel = await page.evaluate(() => ({
    repo: document.querySelector('#syncPanel input[placeholder="my-library-data"]')?.value,
    btn: [...document.querySelectorAll('#syncPanel button')].find(b => b.textContent === 'Clear all sync settings')?.disabled,
  }));
  check('the panel now shows no repository, and the button is disabled', panel.repo === '' && panel.btn === true, J(panel));
  await tabB.waitForTimeout(500);
  check('another open tab keeps its library (its cache keys vanished, which is not "empty")',
    await tabB.evaluate(() => books.length === 1) && await page.evaluate(() => JSON.parse(localStorage.getItem('myLibrary')).length === 1));
  before = asked.length;
  await edit(); await edit(tabB); await page.waitForTimeout(800);
  check('neither tab sends anything afterwards', asked.length === before, J(asked.slice(before)));
  await page.reload(); await page.waitForTimeout(1000);
  check('…nor after a reload, with the library intact', asked.length === before && await page.evaluate(() => books.length === 1));
  await tabB.close();

  // ── 3. Reconnecting merges, never replaces ──────────────────────────
  const theirs = { id: 1700000000009, title: 'From Another Device', author: 'X', status: 'want', formats: ['ebook'] };
  remote['data/books.json'] = { sha: 'other', text: J([theirs]) };
  await page.evaluate(() => { localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' }));
    localStorage.setItem('booklogger.pat', 'ghp_test'); });
  await page.reload(); await page.waitForTimeout(1500);
  check('reconnecting to a repo with another library asks first, sending nothing yet',
    await page.locator('#resolveModal.open').count() === 1 && !asked.some(a => a.startsWith('PUT') && asked.indexOf(a) >= before));
  await page.click('#resolveApply'); await page.waitForTimeout(1500);
  const local = await page.evaluate(() => books.map(b => b.title).sort());
  const up = JSON.parse(remote['data/books.json'].text).filter(r => !r.deleted).map(b => b.title).sort();
  check('reconnecting keeps both sides, here and in the repo', J(local) === J(['Dune', 'From Another Device']) && J(up) === J(local), J({ local, up }));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
