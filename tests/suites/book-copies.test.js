// Book copies (core.js normalizeBookCopies, js/app/book-copies.js): one
// record per book with a copy per edition held, each with its own ISBN, ASIN
// and (audiobooks) narrator. Legacy records migrate on load; formats, isbn,
// asin and narrator stay derived; duplicates, search and the detail sheet
// read every copy.
const { launch, BASE, reporter, viaDetail, detailFact, closeDetailSheet } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const BOOKS = [
  { id: 1700000000001, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['physical', 'audio'],
    isbn: '9780441013593', asin: 'B002V1OF70', narrator: 'Scott Brick' },
  { id: 1700000000002, title: 'Hyperion', author: 'Dan Simmons', status: 'want', formats: ['ebook'], asin: 'B004G8QU3A' },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('**/covers.openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['mediaLibrary', 'videoGames', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, BOOKS);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  const book = t => page.evaluate(t => books.find(b => b.title === t), t);

  // ── 1. The model ───────────────────────────────────────────────────
  const n = await page.evaluate(() => {
    const N = x => normalizeBook({ id: 1, title: 'X', ...x });
    const legacy = N({ formats: ['physical', 'audio'], isbn: '978-0-441-01359-3', asin: 'b002v1of70', narrator: 'Scott Brick' });
    const older = b => ({ ...b, formats: ['ebook'], isbn: '0000000000' });   // an older page, editing the old fields
    const two = N({ copies: [{ id: 'h', format: 'physical', isbn: '9780441013593', edition: 'Hardback' },
                             { id: 'p', format: 'physical', isbn: '9780593099322', edition: 'Paperback' },
                             { id: 'a', format: 'audio', asin: 'B002V1OF70', narrator: ['Scott Brick', 'Simon Vance'] }] });
    return {
      legacy, legacyFormats: formatsOf(legacy), legacyNarr: bookNarrator(legacy), legacyAsin: bookAsin(legacy), twoFormats: formatsOf(two), twoNarr: bookNarrator(two), again: JSON.stringify(normalizeBook(legacy)) === JSON.stringify(legacy),
      ebookOnly: N({ formats: ['ebook'], isbn: '123', asin: 'B0X' }).copies,
      two, round: normalizeBook(older(two)), roundFormats: formatsOf(normalizeBook(older(two))),
      printNarr: N({ copies: [{ format: 'physical', narrator: 'Nope' }] }).copies[0],
      noFormat: N({ copies: [{ format: 'scroll' }, { format: 'ebook' }] }).copies.map(c => c.format),
    };
  });
  check('legacy formats become copies; the ISBN goes to print, the ASIN and narrator to the audiobook',
    J(n.legacy.copies) === J([{ id: 'physical-1', format: 'physical', isbn: '9780441013593' }, { id: 'audio-1', format: 'audio', asin: 'B002V1OF70', narrator: 'Scott Brick' }]), J(n.legacy.copies));
  check('…the old title-level fields are not stored; helpers derive them', ['formats', 'isbn', 'asin', 'narrator'].every(k => !(k in n.legacy)) &&
    J(n.legacyFormats) === '["physical","audio"]' && n.legacyNarr === 'Scott Brick' && n.legacyAsin === 'B002V1OF70', J(n));
  check('…and loading it again gives identical JSON', n.again);
  check('an e-book-only record keeps both identifiers on its one copy', J(n.ebookOnly) === J([{ id: 'ebook-1', format: 'ebook', isbn: '123', asin: 'B0X' }]), J(n.ebookOnly));
  check('two print editions keep their own ISBNs; formats lists each once', n.two.copies.length === 3 &&
    J(n.twoFormats) === '["physical","audio"]' && n.twoNarr === 'Scott Brick, Simon Vance', J(n.two));
  check('copies win over an older page editing the old fields', !('isbn' in n.round) && J(n.roundFormats) === '["physical","audio"]' && n.round.copies.length === 3, J(n.round));
  check('a print copy keeps no narrator', !('narrator' in n.printNarr));
  check('an unknown format is dropped', J(n.noFormat) === '["ebook"]');

  // ── 2. Detail, search, duplicates ──────────────────────────────────
  await viaDetail(page.locator('#booksGrid .book-card', { hasText: 'Dune' }));
  const facts = await detailFact(page, 'Copies');
  check('the detail sheet has a line per copy', /Physical · ISBN 9780441013593/.test(facts) && /Audiobook · read by Scott Brick · ASIN B002V1OF70/.test(facts), facts);
  await closeDetailSheet(page);

  // ── 3. The form ────────────────────────────────────────────────────
  await page.evaluate(() => openEditModal(1700000000001)); await page.waitForTimeout(200);
  const rows = () => page.locator('#f-copies .copy-row').evaluateAll(els => els.map(e => [e.querySelector('select').value,
    e.querySelector('[data-field="isbn"]').value, e.querySelector('[data-field="asin"]').value, e.querySelector('[data-field="narrator"]')?.value || '']));
  check('the form shows each copy with its identifiers', J(await rows()) === J([['physical', '9780441013593', '', ''], ['audio', '', 'B002V1OF70', 'Scott Brick']]), J(await rows()));
  await page.click('#modal button:has-text("Add a copy")');
  await page.selectOption('#f-copies [data-copy="2"] select', 'physical');
  await page.fill('#f-copies [data-copy="2"] [data-field="isbn"]', '978-0-593-09932-2');
  await page.fill('#f-copies [data-copy="2"] [data-field="edition"]', 'Paperback');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(300);
  const dune = await book('Dune');
  check('a second print edition saves with its own ISBN', J(dune.copies.map(c => [c.format, c.isbn || '', c.edition || ''])) ===
    J([['physical', '9780441013593', ''], ['audio', '', ''], ['physical', '9780593099322', 'Paperback']]), J(dune.copies));
  await page.fill('#searchInput', '9780593099322'); await page.waitForTimeout(400);
  check('search finds a book by any copy\'s ISBN', J(await page.locator('#booksGrid .book-title').allInnerTexts()) === '["Dune"]');
  await page.fill('#searchInput', ''); await page.waitForTimeout(300);
  const dup = await page.evaluate(() => [findDuplicate('books', { title: 'Something Else', isbn: '9780593099322' })?.title,
    findDuplicate('books', { title: 'Other', copies: [{ format: 'audio', asin: 'b002v1of70' }] })?.title]);
  check('duplicate detection matches any copy\'s ISBN or ASIN', J(dup) === '["Dune","Dune"]', J(dup));

  // a format button adds a copy; unticking removes it
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  check('a new book starts with one Physical copy', J(await rows()) === J([['physical', '', '', '']]));
  await page.click('label[for="fmt-audio"]');
  check('ticking Audiobook adds an audiobook copy', (await rows()).map(r => r[0]).join() === 'physical,audio');
  await page.click('label[for="fmt-physical"]');
  check('unticking Physical removes the print copy', (await rows()).map(r => r[0]).join() === 'audio');
  await page.click('label[for="fmt-audio"]');
  await page.fill('#f-title', 'Nothing');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(200);
  check('saving with no copy is refused, with a reason', await page.evaluate(() =>
    document.getElementById('modal').classList.contains('open') && document.getElementById('fmt-error').style.display === 'block'));
  // a scan fills the print copy
  await page.evaluate(() => { setFormats(['audio']); fillBookCopy({ format: 'physical', isbn: '9780441172719' }); });
  check('a scanned ISBN lands on a print copy, added if need be', J(await rows()) === J([['audio', '', '', ''], ['physical', '9780441172719', '', '']]), J(await rows()));
  await page.evaluate(() => closeModal());

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
