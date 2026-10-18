// "Already in your library" on the book, Movies & TV and game add forms.
const { launch, BASE, REPO, tmp, shot } = require('../lib');
const results = []; const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
const J = JSON.stringify;

const BOOKS = [
  { id: 1750000000000, title: 'The Lord of the Rings', author: 'J.R.R. Tolkien', status: 'read', formats: ['physical'], isbn: '9780544003415' },
  { id: 1750000000001, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['ebook'], asin: 'B00B7NPRY8' },
  { id: 1750000000002, title: 'Pokémon & Friends', author: '', status: 'want', formats: ['physical'] },
];
const MEDIA = [
  { id: 1750000000010, title: 'Dune', type: 'movie', year: '2021', status: 'want', tmdbId: 438631 },
  { id: 1750000000011, title: 'The Office', type: 'tv', year: '2005', status: 'watched' },
];
const GAMES = [{ id: 1750000000020, title: 'Mass Effect', status: 'completed', platforms: [{ platform: 'steam', formats: ['digital'] }, { platform: 'xbox', formats: [] }] }];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('**/api.themoviedb.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('bookWishlist', '[]'); localStorage.setItem('videoGames', JSON.stringify(g));
    localStorage.setItem('activeTab', 'books');
  }, [BOOKS, MEDIA, GAMES]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. Matching rules ───────────────────────────────────────────────
  const m = await page.evaluate(() => {
    const id = r => r ? r.id : null;
    const B = d => id(findDuplicate('books', d)), M = d => id(findDuplicate('media', d)), G = d => id(findDuplicate('games', d));
    return {
      articleCase:   B({ title: 'lord of the rings', author: 'J.R.R. Tolkien' }),
      authorOrder:   B({ title: 'The Lord of the Rings', author: 'Tolkien, J. R. R.' }),
      authorBlank:   B({ title: 'The Lord of the Rings', author: '' }),
      authorDiffers: B({ title: 'The Lord of the Rings', author: 'Someone Else' }),
      subtitle:      B({ title: 'Dune Messiah', author: 'Frank Herbert' }),
      isbnOnly:      B({ title: 'Totally different', author: 'x', isbn: '978-0-544-00341-5' }),
      asinOnly:      B({ title: 'Other', author: 'y', asin: 'b00b7npry8' }),
      accentAmp:     B({ title: 'Pokemon and Friends', author: 'Anyone' }),
      blankTitle:    B({ title: '   ', author: '' }),
      tmdbExact:     M({ title: 'Dune: Part One', type: 'movie', year: '2021', tmdbId: 438631 }),
      tmdbWrongType: M({ title: 'x', type: 'tv', tmdbId: 438631 }),
      remake:        M({ title: 'Dune', type: 'movie', year: '1984' }),
      yearBlank:     M({ title: 'Dune', type: 'movie', year: '' }),
      tvVsMovie:     M({ title: 'The Office', type: 'movie', year: '' }),
      tvSame:        M({ title: 'office', type: 'tv', year: '2005' }),
      game:          G({ title: 'mass effect' }),
      gameOther:     G({ title: 'Mass Effect 2' }),
    };
  });
  const L = 1750000000000;
  check('books: case and a leading "The" are ignored', m.articleCase === L, J(m));
  check('books: author word order and punctuation are ignored ("Tolkien, J. R. R.")', m.authorOrder === L);
  check('books: a blank author does not rule a match out', m.authorBlank === L);
  check('books: a different author is a different book', m.authorDiffers === null);
  check('books: a subtitle is not ignored ("Dune Messiah" ≠ "Dune")', m.subtitle === null);
  check('books: same ISBN matches whatever the title, hyphens ignored', m.isbnOnly === L);
  check('books: same ASIN matches, case-insensitively', m.asinOnly === L + 1);
  check('books: accents and "&" vs "and" are ignored', m.accentAmp === L + 2);
  check('books: a blank title matches nothing', m.blankTitle === null);
  check('media: same TMDb id matches even with a different title', m.tmdbExact === L + 10);
  check('media: a TMDb id only counts within the same type (movie vs TV numbering)', m.tmdbWrongType === null);
  check('media: a remake (different year) is not a duplicate', m.remake === null);
  check('media: a blank year does not rule a match out', m.yearBlank === L + 10);
  check('media: a movie and a TV show with one title are different things', m.tvVsMovie === null && m.tvSame === L + 11);
  check('games: title match, and a sequel is not one', m.game === L + 20 && m.gameOther === null);

  // ── 2. Book form: live note, two-tap save ───────────────────────────
  const note = id => page.evaluate(id => { const b = document.getElementById(id); return { hidden: b.hidden, text: b.textContent.replace(/\s+/g, ' ').trim(), armed: b.classList.contains('armed') }; }, id);
  const count = () => page.evaluate(() => books.length);
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  check('add form opens with no note', (await note('f-dup')).hidden);
  await page.fill('#f-title', 'the lord of the rings'); await page.fill('#f-author', 'Tolkien');
  await page.waitForTimeout(300);
  let n = await note('f-dup');
  // Author "Tolkien" alone vs "J.R.R. Tolkien" — different keys, so no match: honest, not fuzzy
  check('a partial author ("Tolkien") is not treated as the same author', n.hidden, n.text);
  await page.fill('#f-author', 'J. R. R. Tolkien'); await page.waitForTimeout(300);
  n = await note('f-dup');
  check('typing a match shows the note, naming the book and when it was added',
    !n.hidden && /Already in your library: “The Lord of the Rings” by J\.R\.R\. Tolkien, added Jun 15, 2025\./.test(n.text), n.text);
  const before = await count();
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(250);
  n = await note('f-dup');
  check('first Save does not add it — it warns instead', await count() === before && !n.hidden && n.armed && /Tap Save again/.test(n.text), n.text);
  check('and the modal stays open', await page.evaluate(() => document.getElementById('modal').classList.contains('open')));
  await page.fill('#f-title', 'The Hobbit'); await page.waitForTimeout(300);
  check('changing the title to something new clears the note', (await note('f-dup')).hidden);
  await page.fill('#f-title', 'Lord of the Rings'); await page.waitForTimeout(300);
  n = await note('f-dup');
  check('coming back to the match needs confirming afresh (not still armed)', !n.hidden && !n.armed, n.text);
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(250);
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('second Save on the same match adds the extra copy', await count() === before + 1);
  check('the form closed normally after it', !(await page.evaluate(() => document.getElementById('modal').classList.contains('open'))));

  // ── 3. "Open it", and edits are never flagged ───────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  check('reopening the add form starts clean', (await note('f-dup')).hidden && !(await note('f-dup')).armed);
  await page.fill('#f-title', 'DUNE'); await page.fill('#f-author', 'herbert frank'); await page.waitForTimeout(300);
  await page.locator('#f-dup button', { hasText: 'Open it' }).click(); await page.waitForTimeout(300);
  check('"Open it" switches to editing the existing book',
    await page.evaluate(() => document.getElementById('modalTitle').textContent === 'Edit book' && document.getElementById('f-title').value === 'Dune' && editingId === 1750000000001));
  check('and no warning shows while editing it', (await note('f-dup')).hidden);
  await page.fill('#f-notes', 'reread'); await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('saving an edit goes through in one tap', await page.evaluate(() => books.find(b => b.id === 1750000000001).notes) === 'reread');

  // ── 4. No match: nothing changes about saving ───────────────────────
  const c0 = await count();
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  await page.fill('#f-title', 'A Wizard of Earthsea'); await page.fill('#f-author', 'Ursula K. Le Guin');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('a new book with no match saves in one tap, as before', await count() === c0 + 1 && (await note('f-dup')).hidden);

  // ── 5. Filled by a scan, not typed ──────────────────────────────────
  await page.evaluate(() => openPrefilledForm('9780544003415', { title: 'LOTR (scanned)', author: '' }, true)); await page.waitForTimeout(200);
  n = await note('f-dup');
  check('a scanned ISBN that is already in the library shows the note straight away', !n.hidden && /Lord of the Rings/.test(n.text), n.text);
  await page.evaluate(() => closeModal());

  // ── 6. Movies & TV: a TMDb pick ─────────────────────────────────────
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  await page.click('#addBtn'); await page.waitForSelector('#mediaModal.open');
  await page.evaluate(() => { _tmdbResults = [{ title: 'Dune: Part One', year: '2021', type: 'movie', tmdbId: 438631, genre: [] }]; tmdbPick(0); });
  await page.waitForTimeout(150);
  n = await note('m-dup');
  check('picking a TMDb result already in the library shows the note immediately', !n.hidden && /“Dune” \(Movie, 2021\)/.test(n.text), n.text);
  const mc = await page.evaluate(() => mediaLibrary.length);
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(250);
  check('first Save warns rather than adding', await page.evaluate(() => mediaLibrary.length) === mc && (await note('m-dup')).armed);
  await page.evaluate(() => { document.getElementById('m-year').value = '1984'; pendingTmdb = null; });
  await page.dispatchEvent('#m-year', 'input'); await page.waitForTimeout(300);
  check('switching to the 1984 film clears it (a remake is a different title)', (await note('m-dup')).hidden);
  await page.evaluate(() => closeMediaModal());

  // ── 7. Games: the platform hint ─────────────────────────────────────
  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.fill('#g-title', 'mass effect'); await page.waitForTimeout(300);
  n = await note('g-dup');
  check('a game already in the library names its platforms', !n.hidden && /“Mass Effect” on Steam, Xbox/.test(n.text), n.text);
  check('and points to adding a platform there instead', /Open it and tick that platform instead/.test(n.text));
  await page.locator('#g-dup button', { hasText: 'Open it' }).click(); await page.waitForTimeout(300);
  check('"Open it" opens the existing game for editing', await page.evaluate(() => gameEditingId === 1750000000020 && document.getElementById('gameModalTitle').textContent === 'Edit game'));
  await page.evaluate(() => closeGameModal());

  // ── 8. Cost at real size ────────────────────────────────────────────
  const ms = await page.evaluate(() => {
    for (let i = 0; i < 1380; i++) books.push({ id: 1600000000000 + i, title: `Filler Book ${i}`, author: `Author ${i % 97}` });
    const draft = { title: 'Something not there', author: 'Nobody' };
    const t = performance.now(); for (let k = 0; k < 20; k++) findDuplicate('books', draft); return (performance.now() - t) / 20;
  });
  // Well under a frame here (~1.5 ms); the bound is loose because CI runners are slower.
  check(`checking against ~1,400 books stays fast (${ms.toFixed(1)} ms)`, ms < 50, ms.toFixed(2) + ' ms');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.click('.tab[data-tab="books"]'); await page.waitForTimeout(200);
  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
