// ⋯ → Find duplicates: groups of entries already in the library that the add
// form's duplicate check would call the same thing, with Open, Delete and
// "Not duplicates".
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const bk = (id, title, author, extra = {}) => ({ id, title, author, status: 'want', formats: ['ebook'], ...extra });

const BOOKS = [
  bk(1700000000001, 'Dune', 'Frank Herbert', { isbn: '9780441013593' }),
  bk(1700000000002, 'dune', 'Herbert, Frank', { formats: ['audio'] }),               // same title, author reordered
  bk(1700000000003, 'Dune (Deluxe)', '', { isbn: '978-0-441-01359-3' }),               // same ISBN, other title: joins the group
  bk(1700000000004, 'Collected Stories', 'Gabriel García Márquez'),
  bk(1700000000005, 'Collected Stories', 'Saul Bellow'),                              // same title, other author: not a dup
  bk(1700000000006, 'Old Man’s War', 'John Scalzi'),
  bk(1700000000007, "Old Man's War", 'John Scalzi'),                                  // apostrophes differ
  bk(1700000000008, 'Emma', 'Jane Austen'),
];
const MEDIA = [
  { id: 1700000000101, title: 'Dune', type: 'movie', year: '1984', formats: ['dvd'] },
  { id: 1700000000102, title: 'Dune', type: 'movie', year: '2021', formats: ['bluray'] },   // a remake: not a dup
  { id: 1700000000103, title: 'Airplane!', type: 'movie', tmdbId: 813, formats: ['dvd'] },
  { id: 1700000000104, title: 'Flying High', type: 'movie', tmdbId: 813, formats: ['digital'] }, // same TMDb id
];
const GAMES = [
  { id: 1700000000201, title: 'Hades', platforms: [{ platform: 'steam', formats: ['digital'] }] },
  { id: 1700000000202, title: 'HADES', platforms: [{ platform: 'ps5', formats: ['physical'] }] },
];
const WISH = [
  { id: 1700000000301, type: 'book', title: 'Piranesi', creator: 'Susanna Clarke' },
  { id: 1700000000302, type: 'book', title: 'Piranesi', creator: '' },
  { id: 1700000000303, type: 'movie', title: 'Piranesi' },                            // other type: not a dup
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(([b, m, g, w]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', JSON.stringify(w));
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, [BOOKS, MEDIA, GAMES, WISH]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);
  const groups = kind => page.evaluate(k => duplicateGroups(k).map(g => g.map(r => r.id % 1000)), kind);
  const open = () => page.locator('#dupesModal.open').count().then(n => n === 1);
  const sheetGroups = () => page.locator('#dupesBody .dup-group').evaluateAll(gs =>
    gs.map(g => [...g.querySelectorAll('.dup-row .missing-name')].map(n => n.textContent)));

  // ── 1. What counts ──────────────────────────────────────────────────
  check('books: title + agreeing author, and a matching ISBN, link into one group; another author does not',
    J(await groups('books')) === J([[1, 2, 3], [6, 7]]), J(await groups('books')));
  check('movies: the same TMDb id is a duplicate; a remake (other year) is not', J(await groups('media')) === J([[103, 104]]), J(await groups('media')));
  check('games: the same title on two platforms is one game', J(await groups('games')) === J([[201, 202]]));
  check('wishlist: same type and title, a blank creator ruling nothing out', J(await groups('wishlist')) === J([[301, 302]]));

  // ── 2. The sheet ────────────────────────────────────────────────────
  await page.click('#settingsBtn'); await page.click('#settingsDupesBtn'); await page.waitForTimeout(200);
  check('⋯ → Find duplicates… opens the sheet and closes the menu', await open() &&
    await page.evaluate(() => document.getElementById('settingsMenu').style.display === 'none'));
  const kinds = await page.locator('#dupesBody .dupes-kind').allTextContents();
  check('it has a section per library with duplicates', J(kinds) === J(['📚 Books', '🎬 Movies & TV', '🎮 Games', '📋 Wishlist']), J(kinds));
  check('the intro counts the groups', /^5 groups/.test(await page.locator('#dupesBody .dupes-intro').textContent()));
  const first = await page.locator('#dupesBody .dup-group').first().locator('.dup-row').evaluateAll(rs => rs.map(r => r.innerText.replace(/\s+/g, ' ')));
  check('each row says what tells the copies apart, oldest first', /^Dune Frank Herbert · .*E-book · ISBN 9780441013593 · added /.test(first[0]) &&
    /^dune Herbert, Frank · .*Audiobook/.test(first[1]), J(first));
  await page.screenshot({ path: shot('find-duplicates-phone.png') });

  // ── 3. Delete ───────────────────────────────────────────────────────
  await page.locator('#dupesBody .dup-group').nth(1).locator('.dup-row', { hasText: "Old Man's War" }).locator('button', { hasText: 'Delete' }).click();
  await page.waitForTimeout(200);
  check('Delete removes the entry (leaving a tombstone) and the group, sheet still open',
    await page.evaluate(() => !books.some(b => b.id === 1700000000007) && !!JSON.parse(localStorage.getItem('tombstones')).books['1700000000007']) &&
    await open() && J((await sheetGroups()).slice(0, 2)) === J([['Dune', 'dune', 'Dune (Deluxe)'], ['Airplane!', 'Flying High']]), J(await sheetGroups()));

  // ── 4. Not duplicates ───────────────────────────────────────────────
  await page.locator('#dupesBody .dup-group').first().locator('button', { hasText: 'Not duplicates' }).click(); await page.waitForTimeout(200);
  check('"Not duplicates" removes the group', !(await sheetGroups()).some(g => g.includes('dune')), J(await sheetGroups()));
  const marks = await page.evaluate(() => books.filter(b => b.notDuplicateOf).map(b => [b.id % 1000, b.notDuplicateOf.map(x => x % 1000)]));
  check('…by marking each entry distinct from the others, on the records (so it syncs)', J(marks) === J([[1, [2, 3]], [2, [1, 3]], [3, [1, 2]]]), J(marks));
  check('…which survives a reload', await (async () => { await page.reload(); await page.waitForTimeout(800);
    return J(await groups('books')) === '[]'; })());
  await page.evaluate(() => { books.push(normalizeBook({ id: 1700000000009, title: 'Dune', author: 'Frank Herbert', formats: ['physical'] })); save(); });
  // #3 matched only by ISBN, which the new copy lacks, so it stays out.
  check('a new copy added later still matches', J(await groups('books')) === J([[1, 2, 9]]), J(await groups('books')));
  check('…and the add form still warns about it', await page.evaluate(() => findDuplicate('books', { title: 'Dune', author: 'Frank Herbert' })?.id % 1000 === 1));

  // ── 5. Open, empty, close ───────────────────────────────────────────
  await page.evaluate(() => openDuplicates());
  await page.locator('#dupesBody .dup-group', { hasText: 'Hades' }).locator('button', { hasText: 'Open' }).first().click(); await page.waitForTimeout(200);
  check('Open closes the sheet and opens that entry\'s details', !(await open()) && await page.locator('#detailModal.open').count() === 1 &&
    (await page.locator('#detailTitle').textContent()) === 'Hades');
  await page.evaluate(() => closeDetail());
  await page.evaluate(() => openDuplicates());
  await page.locator('#dupesBody .dup-group', { hasText: 'Piranesi' }).locator('button', { hasText: 'Open' }).first().click(); await page.waitForTimeout(200);
  check('a wishlist entry opens its edit form', await page.locator('#wishlistModal.open, #wModal.open, .modal-backdrop.open').count() >= 1 && !(await open()));
  await page.keyboard.press('Escape'); await page.evaluate(() => { document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open')); });
  await page.evaluate(() => { for (const k of ['books', 'media', 'games', 'wishlist']) duplicateGroups(k).forEach(g => markNotDuplicates(k, g.map(r => r.id))); });
  check('with none left, the sheet says so', /No duplicates found/.test(await page.locator('#dupesBody').textContent()));
  await page.keyboard.press('Escape');
  check('Escape closes it', !(await open()));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
