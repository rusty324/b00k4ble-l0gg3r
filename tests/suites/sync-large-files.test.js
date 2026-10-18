// A real-sized library must upload. Chunked encoders must be byte-identical.
const { launch, BASE, REPO, tmp, shot } = require('../lib');
const results = []; const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
const b64 = s => Buffer.from(s).toString('base64'); const unb64 = s => Buffer.from(s, 'base64').toString('utf8');
const book = i => ({ id: 1700000000000 + i, title: `Book ${i} — Café “Ünïcödé” 📚`, author: 'Some Author Name',
  series: 'A Series #3', formats: ['ebook'], status: 'want', notes: '', rating: 0, genre: ['Fantasy'] });
const LIB = Array.from({ length: 1380 }, (_, i) => book(i));

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext();
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  const remote = {}; let n = 0; const errs = [];
  await ctx.route('https://api.github.com/**', async r => {
    const req = r.request(); const path = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    if (req.method() === 'GET') { const f = remote[path];
      return f ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: f.sha, content: b64(f.text) }) })
               : r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' }); }
    const body = JSON.parse(req.postData()); const f = remote[path];
    if (f && body.sha !== f.sha) return r.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
    const sha = 's' + (++n); remote[path] = { sha, text: unb64(body.content) };
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) });
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(lib => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(lib));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('booklogger.datarepo', JSON.stringify({ owner: 'me', repo: 'data', branch: 'main' }));
    localStorage.setItem('booklogger.pat', 'ghp_test');
  }, LIB);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(1200);

  // ── 1. Byte-identical to the one-shot encoder, wherever that one could run ──
  // Checked against Node's own base64 rather than the old one-shot encoder:
  // that encoder is the bug, and in WebKit it throws on the larger samples.
  const SAMPLES = ['', 'a', 'Café 📚 “quotes” Ünïcödé', 'x'.repeat(0x8000 - 1), 'y'.repeat(0x8000),
                   'z'.repeat(0x8000 + 1), '€'.repeat(30000)];
  const got = await page.evaluate(samples => samples.map(s => {
    const b = new TextEncoder().encode(s); let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(bin);
  }), SAMPLES);
  const same = SAMPLES.every((s, i) => got[i] === Buffer.from(s, 'utf8').toString('base64'));
  check('chunked encoding matches standard base64, incl. chunk-boundary and multi-byte cases', same);

  // ── 2. The real thing: a 1,380-book library uploads ─────────────────
  await page.evaluate(() => { books[0].notes = 'edited'; save(); });
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => { const x = ghStore.syncStatus(); return { status: x.status, err: x.error && x.error.message, queue: ghStore.cache.getQueue().length }; });
  check('a 1,380-book library syncs: status ok, nothing queued', s.status === 'ok' && s.queue === 0, JSON.stringify(s));
  const up = remote['data/books.json'];
  const parsed = up ? JSON.parse(up.text) : [];
  check('the uploaded file is ~400 KB and holds every book', !!up && Buffer.byteLength(up.text) > 300000 && parsed.length === 1380, up ? `${Math.round(Buffer.byteLength(up.text)/1024)} KB, ${parsed.length} books` : 'nothing uploaded');
  check('non-ASCII survives the round trip intact', parsed[5] && parsed[5].title === 'Book 5 — Café “Ünïcödé” 📚' && parsed[0].notes === 'edited', parsed[5] && parsed[5].title);

  // ── 3. And encrypted, through crypto.js's encoder ───────────────────
  const enc = await page.evaluate(async () => {
    ghStore.setPassword('correct horse battery staple');
    await ghStore.rewriteEncryptedFiles();
    const x = ghStore.syncStatus(); return { status: x.status, err: x.error && x.error.message };
  });
  const envText = remote['data/books.json'].text;
  check('with encryption on, the same library uploads', enc.status === 'ok', JSON.stringify(enc));
  check('and what reached GitHub has no plaintext in it', !envText.includes('Some Author Name') && !envText.includes('Café'));
  const dec = await page.evaluate(async t => { const r = await ghStore.deserializeFile('data/books.json', JSON.parse(t)); return r.data ? r.data.length + ' ' + r.data[5].title : JSON.stringify(r); }, envText);
  check('and it decrypts back to every book, unicode intact', dec === '1380 Book 5 — Café “Ünïcödé” 📚', dec);

  check('no page errors', errs.length === 0, errs[0] || '');
  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
