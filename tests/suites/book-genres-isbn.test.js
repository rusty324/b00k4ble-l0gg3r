// ISBN shown after a scan; genres from Open Library / Google / Audible subjects.
// openlibrary.org is unreachable from this sandbox, so its responses are stubbed
// with representative subject lists of the kind it returns.
const { launch, BASE, REPO, tmp, shot } = require('../lib');
const results = []; const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
const J = JSON.stringify;

const HP_ISBN = '9780439708180';
const HP_SUBJECTS = ['Wizards', 'Magic', 'Schools', 'Juvenile fiction', 'Fantasy fiction',
  'Hogwarts School of Witchcraft and Wizardry (Imaginary organization)', 'England', 'Fiction, fantasy, general',
  'Accessible book', 'Protected DAISY', 'nyt:series_books=2007-07-22'];
const olIsbnBody = (isbn, title, subjects) => ({ [`ISBN:${isbn}`]: {
  title, authors: [{ name: 'J. K. Rowling' }], cover: { medium: 'https://covers.openlibrary.org/b/id/1-M.jpg' },
  subjects: subjects.map(name => ({ name, url: 'https://openlibrary.org/subjects/x' })) } });

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/covers.openlibrary.org/**', r => r.abort());
  const asked = [];
  await ctx.route('**/openlibrary.org/**', r => {
    const u = r.request().url(); asked.push(u);
    const json = b => r.fulfill({ status: 200, contentType: 'application/json', body: J(b) });
    if (u.includes('/api/books')) {
      const isbn = (u.match(/ISBN:(\d+)/) || [])[1];
      if (isbn === HP_ISBN) return json(olIsbnBody(isbn, "Harry Potter and the Sorcerer's Stone", HP_SUBJECTS));
      if (isbn === '9780441013593') return json(olIsbnBody(isbn, 'Dune', ['Science fiction', 'Dune (Imaginary place)', 'Fiction', 'Large type books']));
      return json({});
    }
    if (u.includes('/search.json')) return json({ docs: [{ key: '/works/OL82563W', title: 'The Hunger Games', author_name: ['Suzanne Collins'], first_publish_year: 2008 }] });
    if (u.includes('/works/OL82563W.json')) return json({ subjects: ['Young adult fiction', 'Survival', 'Television programs', 'Juvenile fiction', 'Dystopias', 'Science fiction', 'Contests'] });
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.route('**/www.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({}) }));
  await ctx.route('**/api.audnex.us/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({
    asin: 'B002V0QK4C', title: 'Leviathan Wakes', authors: [{ name: 'James S. A. Corey' }], narrators: [],
    genres: [{ asin: 'x', name: 'Science Fiction & Fantasy', type: 'genre' }, { asin: 'y', name: 'Space Opera', type: 'tag' }] }) }));

  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  // An existing library that spells it "Sci-Fi": that spelling must be reused.
  const SEED = [{ id: 1700000000000, title: 'Old', author: 'X', status: 'read', formats: ['ebook'], genre: ['Sci-Fi'] }];
  await page.addInitScript(lib => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(lib));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'books');
  }, SEED);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. The mapping ──────────────────────────────────────────────────
  const g = await page.evaluate(hp => ({
    hp: genresFromSubjects(hp),
    dune: genresFromSubjects(['Science fiction', 'Dune (Imaginary place)', 'Fiction', 'Fiction, science fiction, general', 'Large type books']),
    hunger: genresFromSubjects(['Young adult fiction', 'Survival', 'Juvenile fiction', 'Dystopias', 'Science fiction']),
    bio: genresFromSubjects(['Biography', 'Computer engineers', 'Businesspeople', 'History']),
    histfic: genresFromSubjects(['Fiction, historical, general', 'World War, 1939-1945', 'France']),
    noise: genresFromSubjects(['Accessible book', 'In library', 'Protected DAISY', 'nyt:hardcover-fiction=2008-01-06']),
    fictionOnly: genresFromSubjects(['Fiction', 'Large type books']),
    google: genresFromSubjects('Fiction / Fantasy / Epic'.split('/').map(s => s.trim())),
    objects: genresFromSubjects([{ name: 'Mystery fiction' }, { name: 'Detectives' }]),
    empty: genresFromSubjects(undefined),
  }), HP_SUBJECTS);
  check('Harry Potter: Fantasy first (most subjects point there), then Children\'s', J(g.hp) === '["Fantasy","Children\'s"]', J(g.hp));
  check('the library\'s own spelling wins: "Sci-Fi", not "Science Fiction"', J(g.dune) === '["Sci-Fi"]', J(g.dune));
  check('a teen book is Young Adult, not also Children\'s', J(g.hunger) === '["Young Adult","Dystopian","Sci-Fi"]', J(g.hunger));
  check('nonfiction maps too, capped at three', J(g.bio) === '["Biography","Technology","Business"]', J(g.bio));
  check('historical fiction is not filed as History', J(g.histfic) === '["Historical Fiction"]', J(g.histfic));
  check('catalogue noise ("Accessible book", nyt: tags) yields nothing', J(g.noise) === '[]', J(g.noise));
  check('with nothing specific, it at least says Fiction', J(g.fictionOnly) === '["Fiction"]', J(g.fictionOnly));
  check('Google Books BISAC categories map the same way', J(g.google) === '["Fantasy"]', J(g.google));
  check('Open Library {name} objects are accepted', J(g.objects) === '["Mystery"]', J(g.objects));
  check('no subjects at all is not an error', J(g.empty) === '[]');

  // ── 2. Scanning a barcode → the form ────────────────────────────────
  await page.evaluate(() => { scanKeepGoing = false; });
  await page.evaluate(code => acceptScannedCode(code), HP_ISBN); await page.waitForTimeout(600);
  const form = await page.evaluate(() => ({ open: document.getElementById('modal').classList.contains('open'),
    isbn: document.getElementById('f-isbn').value, title: document.getElementById('f-title').value, genre: getGenreValues('f-genre') }));
  check('after a scan the ISBN field shows the scanned code', form.open && form.isbn === '9780439708180', J(form));
  check('and the genre pills are filled from the lookup', J(form.genre) === '["Fantasy","Children\'s"]', J(form.genre));
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  const savedHP = await page.evaluate(code => books.find(b => b.isbn === code), HP_ISBN);
  check('saving keeps both', !!savedHP && J(savedHP.genre) === '["Fantasy","Children\'s"]', J(savedHP && { isbn: savedHP.isbn, genre: savedHP.genre }));

  // ── 3. Bulk ("keep going") scanning adds straight to the library ────
  await page.evaluate(() => { scanKeepGoing = true; });
  await page.evaluate(() => acceptScannedCode('9780441013593')); await page.waitForTimeout(600);
  const dune = await page.evaluate(() => books.find(b => b.isbn === '9780441013593'));
  check('a quick-added scan gets its genres too', !!dune && J(dune.genre) === '["Sci-Fi"]', J(dune && dune.genre));
  await page.evaluate(() => { scanKeepGoing = false; });

  // ── 4. An old cache entry without subjects is looked up again, once ──
  const before = asked.length;
  await page.evaluate(() => scanCacheSet('9780439708180', true, { title: 'old', author: '', coverUrl: '', source: 'Open Library' }));
  const relooked = await page.evaluate(() => lookupISBN('9780439708180'));
  const n1 = asked.length - before;
  await page.evaluate(() => lookupISBN('9780439708180'));
  check('a hit cached before subjects were kept is fetched again, then cached', n1 === 1 && asked.length - before === 1 && relooked.subjects.length > 0, `requests: ${asked.length - before}`);

  // ── 5. Open Library title search → pick → genres from the work ──────
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  await page.fill('#f-genre', 'Favorites'); await page.press('#f-genre', 'Enter');
  await page.fill('#f-ol', 'hunger games'); await page.waitForSelector('#ol-ac .ac-item', { timeout: 5000 });
  check('a title search does not ask for subjects (keeps every keystroke light)', !asked.some(u => u.includes('search.json') && /subject/.test(u)));
  await page.locator('#ol-ac .ac-item').first().click(); await page.waitForTimeout(700);
  const pick = await page.evaluate(() => ({ title: document.getElementById('f-title').value, genre: getGenreValues('f-genre'), hint: document.getElementById('olHint').textContent }));
  check('picking a result fetches its work record once and adds genres', asked.filter(u => u.includes('/works/OL82563W.json')).length === 1 && J(pick.genre) === '["Favorites","Young Adult","Dystopian","Sci-Fi"]', J(pick));
  check('a genre typed before the pick is kept, not replaced', pick.genre[0] === 'Favorites');
  check('the hint says which genres were added', /genre: Young Adult, Dystopian, Sci-Fi/.test(pick.hint), pick.hint);
  await page.evaluate(() => closeModal());

  // ── 6. ISBN typed into the search box ───────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  await page.fill('#f-ol', '9780441013593'); await page.waitForSelector('#ol-ac .ac-item', { timeout: 5000 });
  await page.locator('#ol-ac .ac-item').first().click(); await page.waitForTimeout(300);
  const isr = await page.evaluate(() => ({ isbn: document.getElementById('f-isbn').value, g: getGenreValues('f-genre') }));
  check('an ISBN search fills ISBN and genres', isr.isbn === '9780441013593' && JSON.stringify(isr.g) === '["Sci-Fi"]', JSON.stringify(isr));
  await page.evaluate(() => closeModal());

  // ── 7. Audible ──────────────────────────────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  await page.fill('#f-ol', 'B002V0QK4C'); await page.waitForSelector('#ol-ac .ac-item', { timeout: 5000 });
  await page.locator('#ol-ac .ac-item').first().click(); await page.waitForTimeout(300);
  const aud = await page.evaluate(() => getGenreValues('f-genre'));
  check('an Audible pick maps its categories as well', J(aud) === '["Sci-Fi","Fantasy"]', J(aud));
  await page.evaluate(() => closeModal());

  // ── 8. Cover identification fills the ISBN field too ────────────────
  await page.evaluate(() => { _identifyTarget = 'books'; _identifyResults = [{ title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719' }]; pickIdentifyResult(0); });
  await page.waitForTimeout(200);
  check('picking an identified book shows its ISBN', await page.evaluate(() => document.getElementById('f-isbn').value) === '9780441172719');
  await page.evaluate(() => closeModal());

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
