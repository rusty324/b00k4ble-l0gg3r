// The guarantees ghsync/CLAUDE.md says must stay covered: nothing goes to
// GitHub before a repo AND a token exist; requests only ever target the
// configured private repo; an offline edit queues and uploads on reconnect;
// another device's change arrives on refresh.
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
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify([b]));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
  }, BOOK);
  const edit = () => page.evaluate(() => { books[0].notes = 'n' + Math.random(); save(); });
  const status = () => page.evaluate(() => ({ s: ghStore.syncStatus().status, q: ghStore.cache.getQueue().length }));

  // ── 1. Not configured: silence ──────────────────────────────────────
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  await edit(); await page.waitForTimeout(500);
  check('with no repo and no token, nothing is sent to GitHub', asked.length === 0, J(asked));
  check('and the badge says local only', (await status()).s === 'local');

  await page.evaluate(() => localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' })));
  await page.reload(); await page.waitForTimeout(700);
  await edit(); await page.waitForTimeout(500);
  check('a repo without a token still sends nothing', asked.length === 0, J(asked));

  // ── 2. Configured: only the private repo ────────────────────────────
  await page.evaluate(() => localStorage.setItem('booklogger.pat', 'ghp_test'));
  await page.reload(); await page.waitForTimeout(900);
  await edit(); await page.waitForTimeout(900);
  check('with both, the edit is uploaded', !!remote['data/books.json'] && JSON.parse(remote['data/books.json'].text)[0].title === 'Dune');
  check('every request goes to the configured repo, none to the public app repo',
    asked.length > 0 && asked.every(a => a.includes('api.github.com/repos/me/data')) && !asked.some(a => /b00k4ble-l0gg3r/.test(a)), J(asked.slice(0, 4)));
  check('and the token is never in a URL', !asked.some(a => a.includes('ghp_test')));
  check('status is synced', (await status()).s === 'ok', J(await status()));

  // ── 3. Offline: queue, then flush on reconnect ──────────────────────
  const before = asked.filter(a => a.startsWith('PUT')).length;
  await ctx.setOffline(true);
  await edit(); await page.waitForTimeout(500);
  const off = await status();
  check('offline, an edit is queued rather than lost', off.s === 'pending' && off.q === 1, J(off));
  check('and no upload was attempted', asked.filter(a => a.startsWith('PUT')).length === before);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1200);
  const on = await status();
  check('back online, the queue uploads and clears', on.s === 'ok' && on.q === 0 && asked.filter(a => a.startsWith('PUT')).length > before, J(on));

  // ── 4. Another device's change arrives on refresh ───────────────────
  const theirs = [BOOK, { id: 1700000000009, title: 'Added Elsewhere', author: 'X', status: 'want', formats: ['ebook'] }];
  remote['data/books.json'] = { sha: 'other-device', text: J(theirs, null, 2) };
  await page.evaluate(() => ghStore.refresh()); await page.waitForTimeout(600);
  check("another device's addition appears here", await page.evaluate(() => books.some(b => b.title === 'Added Elsewhere')));
  check('and is written through to local storage', await page.evaluate(() => JSON.parse(localStorage.getItem('myLibrary')).length === 2));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
