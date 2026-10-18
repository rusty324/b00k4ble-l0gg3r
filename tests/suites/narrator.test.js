// The narrator field on audiobooks.
const { launch, BASE, REPO, tmp, shot } = require('../lib');
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const results = []; const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
const J = JSON.stringify;

const BOOKS = [
  { id: 1700000000001, title: 'Leviathan Wakes', author: 'James S. A. Corey', status: 'read', formats: ['audio', 'ebook'], narrator: 'Jefferson Mays' },
  { id: 1700000000002, title: 'Good Omens', author: 'Terry Pratchett, Neil Gaiman', status: 'read', formats: ['audio'], narrator: 'Martin Jarvis, Stephen Fry' },
  { id: 1700000000003, title: 'Dune', author: 'Frank Herbert', status: 'want', formats: ['physical'] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('**/api.audnex.us/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({
    asin: 'B002UZMLXM', title: 'The Hobbit', authors: [{ name: 'J. R. R. Tolkien' }],
    narrators: [{ name: 'Andy Serkis' }], genres: [] }) }));
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, BOOKS);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. What is stored ───────────────────────────────────────────────
  const n = await page.evaluate(() => {
    const N = x => normalizeBook({ id: 1, title: 'X', author: 'A', ...x });
    return {
      kept:     N({ formats: ['audio'], narrator: '  Scott Brick ' }).narrator,
      list:     N({ formats: ['audio'], narrator: ['Martin Jarvis', ' Stephen Fry ', ''] }).narrator,
      noAudio:  'narrator' in N({ formats: ['ebook'], narrator: 'Someone' }),
      blank:    'narrator' in N({ formats: ['audio'], narrator: '  ' }),
      absent:   'narrator' in N({ formats: ['audio'] }),
      search:   N({ formats: ['audio'], narrator: 'Scott Brick' })._searchStr.includes('scott brick'),
      idem:     (() => { const a = N({ formats: ['audio'], narrator: 'X Y' }); return J(normalizeBook(a)) === J(a); })(),
    };
    function J(x) { return JSON.stringify(x); }
  });
  check('a narrator is kept, trimmed, on an audiobook', n.kept === 'Scott Brick', J(n));
  check('a list of narrators is joined', n.list === 'Martin Jarvis, Stephen Fry', n.list);
  check('a book that is not an audiobook keeps no narrator', n.noAudio === false);
  check('blank or missing adds no key', n.blank === false && n.absent === false);
  check('narrators are part of the search text', n.search);
  check('normalizing twice changes nothing', n.idem);

  // ── 2. Card, list, search ───────────────────────────────────────────
  const narrLine = t => page.locator('#booksGrid .book-card', { hasText: t }).locator('.book-narrator');
  check('an audiobook card says who reads it', (await narrLine('Leviathan Wakes').textContent()) === '🎙 Narrated by Jefferson Mays');
  check('a print book shows no narrator line', (await narrLine('Dune').count()) === 0);
  await page.fill('#searchInput', 'stephen fry'); await page.waitForTimeout(400);
  const found = await page.evaluate(() => [...document.querySelectorAll('#booksGrid .book-title')].map(e => e.textContent));
  check('searching a narrator finds the book', J(found) === '["Good Omens"]', J(found));
  await page.fill('#searchInput', ''); await page.waitForTimeout(400);
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);
  check('the list row shows it beside the author', (await page.locator('#booksGrid .book-row', { hasText: 'Leviathan Wakes' }).locator('.book-row-narrator').textContent()).includes('Jefferson Mays'));
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);

  // ── 3. The form ─────────────────────────────────────────────────────
  const shown = () => page.evaluate(() => document.getElementById('f-narrator-group').style.display !== 'none');
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  check('a new book (Physical by default) has no Narrator field showing', !(await shown()));
  await page.click('label[for="fmt-audio"]');
  check('ticking Audiobook shows it', await shown());
  const dl = await page.evaluate(() => [...document.querySelectorAll('#dl-narrators option')].map(o => o.value));
  check('it suggests narrators already in the library, one per name', J(dl) === J(['Jefferson Mays', 'Martin Jarvis', 'Stephen Fry']), J(dl));
  await page.fill('#f-title', 'Project Hail Mary'); await page.fill('#f-author', 'Andy Weir');
  await page.fill('#f-narrator', 'Ray Porter');
  await page.click('label[for="fmt-audio"]');
  check('unticking hides it', !(await shown()));
  await page.click('label[for="fmt-audio"]');
  check('ticking again brings back what was typed', await shown() && (await page.inputValue('#f-narrator')) === 'Ray Porter');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('saved with the narrator', await page.evaluate(() => books.find(b => b.title === 'Project Hail Mary').narrator) === 'Ray Porter');

  await page.locator('#booksGrid .book-card', { hasText: 'Project Hail Mary' }).locator('button', { hasText: 'Edit' }).click();
  await page.waitForSelector('#modal.open');
  check('editing an audiobook shows its narrator', await shown() && (await page.inputValue('#f-narrator')) === 'Ray Porter');
  // It was saved as Physical + Audiobook (Physical is ticked by default), so
  // unticking Audiobook leaves it print-only.
  check('(it is Physical + Audiobook)', await page.evaluate(() => JSON.stringify(books.find(b => b.title === 'Project Hail Mary').formats)) === '["physical","audio"]');
  await page.click('label[for="fmt-audio"]');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('switching it to print-only drops the narrator on save',
    await page.evaluate(() => !('narrator' in books.find(b => b.title === 'Project Hail Mary'))));

  await page.locator('#booksGrid .book-card', { hasText: 'Dune' }).locator('button', { hasText: 'Edit' }).click();
  await page.waitForSelector('#modal.open');
  check('editing a print book shows no Narrator field, and nothing left over', !(await shown()) && (await page.inputValue('#f-narrator')) === '');
  await page.evaluate(() => closeModal());

  // ── 4. An Audible pick fills it ─────────────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  await page.fill('#f-ol', 'B002UZMLXM'); await page.waitForSelector('#ol-ac .ac-item', { timeout: 5000 });
  await page.locator('#ol-ac .ac-item').first().click(); await page.waitForTimeout(300);
  check('picking an Audible result ticks Audiobook and fills the narrator',
    await shown() && (await page.inputValue('#f-narrator')) === 'Andy Serkis');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('…and it is saved', await page.evaluate(() => books.find(b => b.title === 'The Hobbit').narrator) === 'Andy Serkis');

  // ── 5. Export/import keeps it ───────────────────────────────────────
  const [dlf] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportData())]);
  const ex = JSON.parse(fs.readFileSync(await dlf.path(), 'utf8'));
  check('exports carry the narrator', ex.items.find(b => b.title === 'Leviathan Wakes').narrator === 'Jefferson Mays');

  // ── 6. The Audiobookshelf import script ─────────────────────────────
  const dir = tmp('abs-');
  const item = path.join(dir, 'items', 'li_1'); fs.mkdirSync(item, { recursive: true });
  fs.writeFileSync(path.join(item, 'metadata.json'), J({ metadata: { title: 'Leviathan Wakes', authors: ['James S. A. Corey'], narrators: ['Jefferson Mays'], series: [] } }));
  const item2 = path.join(dir, 'items', 'li_2'); fs.mkdirSync(item2, { recursive: true });
  fs.writeFileSync(path.join(item2, 'metadata.json'), J({ metadata: { title: 'Good Omens', authors: ['Terry Pratchett'], narrators: ['Martin Jarvis', 'Stephen Fry'] } }));
  const existing = path.join(dir, 'existing.json');
  fs.writeFileSync(existing, J({ lastUpdatedOn: null, items: [{ id: 5, title: 'Good Omens', author: 'Terry Pratchett', narrator: 'Typed By Me', formats: ['audio'], status: 'read' }] }));
  const py = spawnSync('python3', ['-B', '-c', `
import sys, json; sys.path.insert(0, '${REPO}')
import scan_library as s
abs_books = s.read_abs_metadata(sys.argv[1])
calibre = [{'_source':'calibre','title':'Leviathan Wakes','author':'James S. A. Corey','series':'','formats':['ebook'],'status':'want','notes':'','rating':0}]
merged = s.merge_sources(calibre + abs_books)
final = s.merge_with_existing(merged, sys.argv[2])
print(json.dumps({'abs': {b['title']: b.get('narrator') for b in abs_books},
                  'merged': {b['title']: [b.get('narrator'), b['formats']] for b in merged},
                  'final': {b['title']: b.get('narrator') for b in final}}))
`, dir, existing], { encoding: 'utf8' });
  const out = py.status === 0 ? JSON.parse(py.stdout.trim().split('\n').pop()) : null;
  check('the import reads narrators from Audiobookshelf metadata', out && out.abs['Good Omens'] === 'Martin Jarvis, Stephen Fry', (py.stdout + py.stderr).trim().slice(-200));
  check('merging with Calibre (which outranks it) keeps the narrator', out && J(out.merged['Leviathan Wakes']) === J(['Jefferson Mays', ['audio', 'ebook']]), out && J(out.merged));
  check('a narrator already typed in the app wins over the scan', out && out.final['Good Omens'] === 'Typed By Me', out && J(out.final));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
