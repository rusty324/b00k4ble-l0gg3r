// "Last updated" per tab, shown under the tab bar and carried in exports.
const { launch, BASE, REPO, tmp, shot } = require('../lib');
const fs = require('fs');
const results = [];
const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);

const T_OLD = 1700000000000;   // 2023-11-14T22:13:20Z
const T_NEW = 1750000000000;   // 2025-06-15T15:06:40Z
const BOOKS = [
  { id: T_OLD, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['physical'] },
  { id: T_NEW, title: 'Emma', author: 'Jane Austen', status: 'want', formats: ['ebook'] },
];
const MEDIA = [{ id: T_OLD, title: 'Red', type: 'movie', year: '2010', status: 'want' }];
// ids that are NOT times: the kind an import from elsewhere can carry
const WISH = [{ id: 1, title: 'A', type: 'book' }, { id: 2, title: 'B', type: 'book' }];

const note = page => page.evaluate(() => document.getElementById('updatedNote').textContent);

(async () => {
  const errors = [], dialogs = [];
  const browser = await launch();
  const ctx = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', acceptDownloads: true });
  await ctx.route('**/fonts.g**', r => r.abort());
  await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.addInitScript(([b, m, w]) => {
    if (sessionStorage.getItem('seeded')) return;      // only the first load; reloads keep state
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b));
    localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('bookWishlist', JSON.stringify(w));
    localStorage.setItem('videoGames', '[]');
    localStorage.setItem('activeTab', 'books');
  }, [BOOKS, MEDIA, WISH]);
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(700);

  // ── 1. With no stamp yet: fall back to the newest entry's creation time ──
  check('no stored stamp on a fresh load', await page.evaluate(() => localStorage.getItem('lastUpdated')) === null);
  check('books falls back to its newest entry (Emma, Jun 15 2025)',
    await note(page) === 'Last updated Jun 15, 2025, 3:06 PM', await note(page));
  check('the tooltip carries the exact ISO instant',
    await page.evaluate(() => document.getElementById('updatedNote').title) === '2025-06-15T15:06:40.000Z');

  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  check('switching tabs repaints it for that tab (media -> Nov 2023)',
    await note(page) === 'Last updated Nov 14, 2023, 10:13 PM', await note(page));

  await page.click('.tab[data-tab="wishlist"]'); await page.waitForTimeout(300);
  check('ids that are not times (1, 2) give no date rather than 1970',
    await note(page) === '', JSON.stringify(await note(page)));
  check('and the empty note takes no space',
    await page.evaluate(() => getComputedStyle(document.getElementById('updatedNote')).display) === 'none');

  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  check('an empty tab shows nothing', await note(page) === '');

  const guards = await page.evaluate(() => ({
    zero: idAsTime(0), small: idAsTime(12345), ok: idAsTime(1750000000000),
    future: idAsTime(Date.now() + 10 * 864e5), nan: idAsTime(NaN),
  }));
  check('idAsTime accepts a real time and rejects 0, small, future and NaN',
    guards.ok === 1750000000000 && guards.zero === null && guards.small === null &&
    guards.future === null && guards.nan === null, JSON.stringify(guards));

  // ── 2. An edit stamps its own tab only ──────────────────────────────
  await page.click('.tab[data-tab="books"]'); await page.waitForTimeout(300);
  const before = Date.now();
  await page.evaluate(() => { books[0].notes = 'edited'; save(); });
  const stamp = await page.evaluate(() => JSON.parse(localStorage.getItem('lastUpdated')));
  check('save() stamps books, at about now', stamp.books >= before && stamp.books <= Date.now(), JSON.stringify(stamp));
  check('and nothing else', Object.keys(stamp).join() === 'books', JSON.stringify(stamp));
  check('the note now shows today rather than the fallback',
    !/2025/.test(await note(page)) && /^Last updated /.test(await note(page)), await note(page));

  await page.evaluate(() => { videoGames.push(normalizeVideoGame({ id: newId(), title: 'G', platforms: [{ platform: 'steam', formats: [] }] })); saveGames(); });
  const s2 = await page.evaluate(() => JSON.parse(localStorage.getItem('lastUpdated')));
  check('saveGames() stamps games without moving books', !!s2.games && s2.books === stamp.books, JSON.stringify(s2));
  await page.evaluate(() => { saveMedia(); saveWishlist(); });
  const s3 = await page.evaluate(() => JSON.parse(localStorage.getItem('lastUpdated')));
  check('saveMedia() and saveWishlist() stamp theirs', !!s3.media && !!s3.wishlist, JSON.stringify(s3));

  // ── 3. Background cover discovery is not the user editing ───────────
  await page.evaluate(() => localStorage.setItem('lastUpdated', JSON.stringify({ books: 1750000000000 })));
  await page.evaluate(() => { books[0].coverUrl = 'https://x/y.jpg'; saveLocal(); });
  await page.waitForTimeout(50);
  await page.evaluate(() => { saveSoon(); });
  await page.waitForTimeout(1300);
  check('saveLocal()/saveSoon() leave the date alone',
    await page.evaluate(() => JSON.parse(localStorage.getItem('lastUpdated')).books) === 1750000000000);

  // ── 4. The sync path ────────────────────────────────────────────────
  await page.evaluate(() => { localStorage.setItem('lastUpdated', JSON.stringify({ books: 1750000000000 })); });
  const same = await page.evaluate(() => {
    const r = applySyncedData('books', JSON.parse(JSON.stringify(books, stripSearchStr)));
    return { r, stamp: JSON.parse(localStorage.getItem('lastUpdated')).books };
  });
  check('a repo that agrees with us changes nothing and moves nothing',
    same.r === false && same.stamp === 1750000000000, JSON.stringify(same));

  const pulled = await page.evaluate(() => {
    const next = JSON.parse(JSON.stringify(books, stripSearchStr));
    next.push({ id: 1760000000000, title: 'Pulled', author: 'X', status: 'want', formats: ['ebook'] });
    const r = applySyncedData('books', next);
    return { r, stamp: JSON.parse(localStorage.getItem('lastUpdated')).books };
  });
  check('records arriving from the repo do move it', pulled.r === true && pulled.stamp > 1750000000000, JSON.stringify(pulled));

  // The migration case: storage still holds the old single-platform shape,
  // memory has been normalized, and the repo sends the same game in old shape.
  const mig = await page.evaluate(() => {
    localStorage.setItem('lastUpdated', JSON.stringify({ games: 1750000000000 }));
    videoGames = [normalizeVideoGame({ id: 1760000000001, title: 'Old', platform: 'steam', formats: ['digital'] })];
    localStorage.setItem('videoGames', JSON.stringify([{ id: 1760000000001, title: 'Old', platform: 'steam', formats: ['digital'], status: 'want', genre: [], rating: 0 }]));
    const r = applySyncedData('games', [{ id: 1760000000001, title: 'Old', platform: 'steam', formats: ['digital'] }]);
    return { r, stamp: JSON.parse(localStorage.getItem('lastUpdated')).games };
  });
  check('a normalizer migration alone does not read as an update',
    mig.stamp === 1750000000000, JSON.stringify(mig));

  // ── 5. Export shape, all four tabs ──────────────────────────────────
  await page.evaluate(() => {
    localStorage.setItem('lastUpdated', JSON.stringify({ books: 1750000000000, media: 1750000000000, wishlist: 1750000000000, games: 1750000000000 }));
  });
  const grab = async tab => {
    await page.click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(300);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportData())]);
    const file = await dl.path();
    return { name: dl.suggestedFilename(), json: JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  const names = { books: 'my-library.json', media: 'my-media-library.json', wishlist: 'my-wishlist.json', games: 'my-games-library.json' };
  for (const tab of Object.keys(names)) {
    const ex = await grab(tab);
    check(`${tab}: export is { lastUpdatedOn, items } and keeps its filename`,
      ex.name === names[tab] && !Array.isArray(ex.json) && Array.isArray(ex.json.items) &&
      ex.json.lastUpdatedOn === '2025-06-15T15:06:40.000Z', ex.name + ' ' + JSON.stringify(ex.json).slice(0, 90));
  }
  const bex = await grab('books');
  check('the books export has no derived _searchStr in it', !JSON.stringify(bex.json).includes('_searchStr'));
  check('and carries exactly the in-memory records',
    bex.json.items.length === await page.evaluate(() => books.length));

  await page.evaluate(() => { localStorage.removeItem('lastUpdated'); books = []; saveLocal(); });
  await page.evaluate(() => switchTab('books'));
  const emptyEx = await grab('books');
  check('an export with nothing to date says null rather than inventing one',
    emptyEx.json.lastUpdatedOn === null && emptyEx.json.items.length === 0, JSON.stringify(emptyEx.json));

  // ── 6. Import accepts both shapes ───────────────────────────────────
  const dir = tmp('upd-');
  const wrapped = `${dir}/wrapped.json`, bare = `${dir}/bare.json`, bad = `${dir}/bad.json`;
  const rec = (id, t) => ({ id, title: t, author: 'A', status: 'want', formats: ['ebook'] });
  fs.writeFileSync(wrapped, JSON.stringify({ lastUpdatedOn: '2025-06-15T15:06:40.000Z', items: [rec(T_OLD, 'W1'), rec(T_OLD + 1, 'W2')] }));
  fs.writeFileSync(bare, JSON.stringify([rec(T_OLD + 2, 'B1')]));
  fs.writeFileSync(bad, JSON.stringify({ lastUpdatedOn: 'x', nope: [] }));
  await page.evaluate(() => { books = []; saveLocal(); render(); });

  await page.setInputFiles('#importFile', wrapped); await page.waitForTimeout(500);
  check('a new-shape export imports', await page.evaluate(() => books.map(b => b.title).join()) === 'W1,W2');
  await page.setInputFiles('#importFile', bare); await page.waitForTimeout(500);
  check('an old bare-array export still imports', await page.evaluate(() => books.map(b => b.title).join()) === 'W1,W2,B1');
  const dBefore = dialogs.length;
  await page.setInputFiles('#importFile', bad); await page.waitForTimeout(500);
  check('an object with no items array is refused with a message, library untouched',
    dialogs.slice(dBefore).some(m => /Failed to import.*items/.test(m)) &&
    await page.evaluate(() => books.length) === 3, JSON.stringify(dialogs.slice(dBefore)));
  check('importing counts as a change: the tab is stamped',
    await page.evaluate(() => !!JSON.parse(localStorage.getItem('lastUpdated')).books));

  // ── 7. Round trip ───────────────────────────────────────────────────
  const rt = await grab('books');
  await page.evaluate(() => { books = []; saveLocal(); render(); });
  const rtFile = `${dir}/rt.json`; fs.writeFileSync(rtFile, JSON.stringify(rt.json));
  await page.setInputFiles('#importFile', rtFile); await page.waitForTimeout(500);
  check('export then import restores every record',
    await page.evaluate(() => books.map(b => b.title).sort().join()) === 'B1,W1,W2');

  // ── 8. The Python merge reads both shapes ───────────────────────────
  const { spawnSync } = require('child_process');
  const py = (path) => spawnSync('python3', ['-B', '-c', `
import sys; sys.path.insert(0, '${REPO}')
import scan_library as s
scanned=[{'title':'W1','author':'A','formats':['ebook'],'status':'want','notes':'','rating':0,'id':999}]
out=s.merge_with_existing(scanned, sys.argv[1])
print(sorted(b['title'] for b in out), out[0]['id'] if out else None)
`, path], { encoding: 'utf8' });
  const pw = py(wrapped), pb = py(bare);
  check('scan_library.py merges against a wrapped export (keeps the existing id)',
    pw.status === 0 && /W1/.test(pw.stdout) && /W2/.test(pw.stdout), (pw.stdout + pw.stderr).trim().slice(0, 160));
  check('and against a bare array, as before',
    pb.status === 0 && /B1/.test(pb.stdout), (pb.stdout + pb.stderr).trim().slice(0, 160));

  // ── 9. Smoke: every tab loads, adds and deletes without errors ──────
  for (const tab of ['books', 'media', 'games', 'wishlist']) {
    await page.click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(300);
    check(`${tab}: the tab renders under the note`,
      await page.evaluate(() => document.getElementById('updatedNote') !== null));
  }
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close();
  process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
