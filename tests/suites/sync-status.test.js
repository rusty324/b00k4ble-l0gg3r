// "pending sync" must say why, and the known permanent stalls must be gone.
const { launch, BASE, REPO, tmp, shot } = require('../lib');
const results = [];
const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
const b64 = s => Buffer.from(s).toString('base64');
const unb64 = s => Buffer.from(s, 'base64').toString('utf8');
const BOOK = { id: 1750000000000, title: 'Emma', author: 'A', status: 'read', formats: ['physical'] };
const LIB = b64(JSON.stringify([BOOK]));

// A GitHub with real sha semantics. `rules` can force a response per method.
function fakeGitHub(initial = {}, rules = {}) {
  const remote = { ...initial }; let n = 0; const log = [];
  const handler = async r => {
    const req = r.request(); const m = req.method();
    const path = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    const forced = rules[m];
    if (forced && forced.on !== false) {
      log.push(`${m} ${path} -> ${forced.status || 'abort'} (forced)`);
      if (forced.abort) return r.abort('failed');
      return r.fulfill({ status: forced.status, contentType: 'application/json', body: JSON.stringify(forced.body || {}) });
    }
    if (m === 'GET') {
      const f = remote[path]; log.push(`GET ${path} -> ${f ? 200 : 404}`);
      if (!f) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: f.sha, content: b64(f.text) }) });
    }
    const body = JSON.parse(req.postData()); const f = remote[path];
    if (f && body.sha !== f.sha) {
      log.push(`PUT ${path} -> 422`);
      return r.fulfill({ status: 422, contentType: 'application/json', body: '{"message":"Invalid request. \\"sha\\" wasn\'t supplied."}' });
    }
    const sha = 's' + (++n); remote[path] = { sha, text: unb64(body.content) };
    log.push(`PUT ${path} -> 201`);
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) });
  };
  return { remote, log, handler, rules };
}

async function open(browser, { gh, seed = {} }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('https://api.github.com/**', gh.handler);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(s => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    const d = (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    d('myLibrary', s.books || []); d('mediaLibrary', []); d('bookWishlist', []); d('videoGames', s.games || []);
    d('activeTab', 'books');
    d('booklogger.datarepo', { owner: 'me', repo: 'data', branch: 'main' }); d('booklogger.pat', 'ghp_test');
    for (const [k, v] of Object.entries(s.ls || {})) d(k, v);
  }, seed);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(900);
  return { ctx, page, errors };
}
const status = page => page.evaluate(() => { const s = ghStore.syncStatus(); return { status: s.status, err: s.error ? s.error.name + ': ' + s.error.message : null, queue: ghStore.cache.getQueue().length }; });
const problem = page => page.evaluate(() => { openSyncModal(); const b = document.getElementById('ghProblem');
  return { hidden: b.hidden, text: b.textContent, retry: !!document.getElementById('ghRetry'), tip: document.getElementById('syncBadge').title }; });
const edit = page => page.evaluate(() => { books[0].notes = 'x' + Math.random(); save(); });

(async () => {
  const browser = await launch();

  // ── 1. Every failure now explains itself ────────────────────────────
  const T = [
    ['404 on write: token cannot see the repo', { PUT: { status: 404, body: { message: 'Not Found' } } }, 'error', 1, /can't find me\/data.*main|can't find me\/data/, /Contents: read & write/],
    ['422 not about the sha: branch missing',   { PUT: { status: 422, body: { message: 'Branch main not found' } } }, 'pending', 1, /Branch main not found/, null],
    ['409 that never clears',                   { PUT: { status: 409, body: { message: 'does not match' } } }, 'pending', 3, /conflict/i, /Retry/],
    ['GitHub 500',                              { PUT: { status: 500, body: { message: 'Server Error' } } }, 'pending', 1, /500.*Server Error/, /Retry/],
    ['403 rate limit',                          { PUT: { status: 403, body: { message: 'API rate limit exceeded' } } }, 'error', 1, /rate limit exceeded/, /throttling requests, not a bad token/],
    ['401 bad credentials',                     { PUT: { status: 401, body: { message: 'Bad credentials' } } }, 'error', 1, /Bad credentials/, /fresh one/],
    ['network failure',                         { PUT: { abort: true } }, 'pending', 1, /didn't go through|offline/, /retries every 30 seconds/],
  ];
  for (const [name, rules, wantStatus, wantPuts, wantWhy, wantFix] of T) {
    const gh = fakeGitHub({ 'data/books.json': { sha: 'r1', text: JSON.stringify([BOOK]) } }, rules);
    const { ctx, page, errors } = await open(browser, { gh, seed: { books: [BOOK] } });
    gh.log.length = 0;
    await edit(page); await page.waitForTimeout(1500);
    const s = await status(page), p = await problem(page);
    const puts = gh.log.filter(l => l.startsWith('PUT')).length;
    check(`${name}: lands in "${wantStatus}" after ${wantPuts} attempt(s)`, s.status === wantStatus && puts === wantPuts, `${s.status}, ${puts} PUTs, ${s.err}`);
    check(`${name}: the panel says why`, !p.hidden && wantWhy.test(p.text), p.text.slice(0, 140));
    if (wantFix) check(`${name}: and what to do`, wantFix.test(p.text), p.text.slice(-120));
    check(`${name}: Retry is offered, and the badge tooltip carries the reason`, p.retry && p.tip.length > 5, p.tip);
    check(`${name}: not misdiagnosed as an unreadable/oversized file just because the path ends in .json`,
      !/1 MB|valid JSON|couldn't be read/.test(p.text + p.tip), p.tip);
    check(`${name}: no page errors`, errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  // ── 2. Healthy: no noise ────────────────────────────────────────────
  { const gh = fakeGitHub({ 'data/books.json': { sha: 'r1', text: JSON.stringify([BOOK]) } });
    const { ctx, page } = await open(browser, { gh, seed: { books: [BOOK] } });
    await edit(page); await page.waitForTimeout(1200);
    const s = await status(page), p = await problem(page);
    check('healthy: synced, queue empty, explanation hidden, no tooltip', s.status === 'ok' && s.queue === 0 && p.hidden && p.tip === '', JSON.stringify([s, p.hidden, p.tip]));
    await ctx.close(); }

  // ── 3. Retry actually recovers ──────────────────────────────────────
  { const gh = fakeGitHub({ 'data/books.json': { sha: 'r1', text: JSON.stringify([BOOK]) } }, { PUT: { status: 500, body: { message: 'Server Error' } } });
    const { ctx, page } = await open(browser, { gh, seed: { books: [BOOK] } });
    await edit(page); await page.waitForTimeout(1200);
    check('retry: stuck while GitHub is failing', (await status(page)).status === 'pending');
    gh.rules.PUT.on = false;                                   // GitHub recovers
    await page.evaluate(() => openSyncModal()); await page.click('#ghRetry'); await page.waitForTimeout(1200);
    const s = await status(page), p = await problem(page);
    check('retry: one tap drains the queue and clears the explanation', s.status === 'ok' && s.queue === 0 && p.hidden, JSON.stringify([s, p.hidden]));
    check('retry: the edit reached the remote', gh.remote['data/books.json'].text.includes('"notes"'));
    await ctx.close(); }

  // ── 4. The permanent stall: a dirty path, and `null` in the repo ────
  const GAME = { id: 1750000000000, title: 'Hades', status: 'playing', platforms: [{ platform: 'steam', formats: [] }] };
  const dirtySeed = { games: [GAME], ls: { 'booklogger.data.data/games.json': [GAME], 'booklogger.queue': ['data/games.json'] } };
  { const gh = fakeGitHub({ 'data/games.json': { sha: 'null-sha', text: 'null\n' } });
    const { ctx, page, errors } = await open(browser, { gh, seed: dirtySeed });
    await page.waitForTimeout(2500);
    const s = await status(page);
    check('null in repo + dirty local: the queue drains without waiting 30s', s.status === 'ok' && s.queue === 0, JSON.stringify(s));
    check('and the repo now holds the real list', JSON.parse(gh.remote['data/games.json'].text).some(g => g.title === 'Hades'), gh.remote['data/games.json'].text.slice(0, 50));
    check('and no "not iterable" error anywhere', errors.length === 0 && !/iterable/.test(s.err || ''), errors[0] || s.err || '');
    await ctx.close(); }

  { const gh = fakeGitHub({ 'data/games.json': { sha: 'null-sha', text: 'null\n' } });
    const { ctx, page } = await open(browser, { gh, seed: { games: [GAME] } });   // NOT dirty
    await page.waitForTimeout(2500);
    check('null in repo, local games present: the local game is NOT wiped', await page.evaluate(() => videoGames.length) === 1);
    check('and it is uploaded over the null', JSON.parse(gh.remote['data/games.json'].text).length === 1, gh.remote['data/games.json'].text.slice(0, 50));
    await ctx.close(); }

  // ── 5. Never write null again ───────────────────────────────────────
  { const gh = fakeGitHub();
    const { ctx, page } = await open(browser, { gh });                       // everything empty
    await page.evaluate(() => ghStore.pushAllData()); await page.waitForTimeout(1500);
    const texts = Object.fromEntries(Object.entries(gh.remote).map(([k, v]) => [k, v.text.trim()]));
    check('"Upload all local data" with empty tabs writes [] — never null',
      Object.values(texts).length === 4 && Object.values(texts).every(t => t === '[]'), JSON.stringify(texts));
    await ctx.close(); }

  // ── 6. The 422 split: sha conflicts still merge ─────────────────────
  { const gh = fakeGitHub({ 'data/books.json': { sha: 'theirs', text: JSON.stringify([{ ...BOOK, id: 1750000000005, title: 'Other' }]) } });
    const { ctx, page } = await open(browser, { gh, seed: { books: [BOOK], ls: { 'booklogger.data.data/books.json': [BOOK], 'booklogger.queue': ['data/books.json'] } } });
    await page.waitForTimeout(2500);
    const titles = JSON.parse(gh.remote['data/books.json'].text).map(b => b.title).sort();
    check('a genuine sha conflict still merges both sides by id', titles.join() === 'Emma,Other' && (await status(page)).status === 'ok', titles.join());
    await ctx.close(); }

  // ── 7. A file past GitHub's 1 MB read limit is reported, not swallowed ──
  { const gh = fakeGitHub({});
    gh.remote['data/books.json'] = { sha: 'big', text: '' };       // what the API sends back: empty content
    const { ctx, page } = await open(browser, { gh, seed: { books: [BOOK] } });
    await page.waitForTimeout(1500);
    const s = await status(page), p = await problem(page);
    check('an unreadable (over-1MB) file surfaces as an error instead of silence', s.status === 'error' && /SyntaxError/.test(s.err || ''), JSON.stringify(s));
    check('and the panel names the likely cause', /1 MB/.test(p.text), p.text.slice(0, 160));
    check('without having wiped the local library', await page.evaluate(() => books.length) === 1);
    await ctx.close(); }

  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
