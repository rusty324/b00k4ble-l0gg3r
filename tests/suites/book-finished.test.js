// The month a book was finished: year and month only, Read books only.
const { launch, BASE, reporter, viaDetail } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const Y = new Date().getFullYear();
const NOW = `${Y}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

const BOOKS = [
  { id: 1700000000001, title: 'Dune', author: 'Frank Herbert', status: 'read', formats: ['physical'], finished: `${Y}-02` },
  { id: 1700000000002, title: 'Emma', author: 'Jane Austen', status: 'read', formats: ['ebook'], finished: `${Y - 1}-11` },
  { id: 1700000000003, title: 'Hyperion', author: 'Dan Simmons', status: 'read', formats: ['ebook'], finished: `${Y}-05` },
  { id: 1700000000004, title: 'Middlemarch', author: 'George Eliot', status: 'read', formats: ['physical'] },
  { id: 1700000000005, title: 'Ulysses', author: 'James Joyce', status: 'want', formats: ['physical'] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(b => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b));
    for (const k of ['mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, BOOKS);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. What is stored ───────────────────────────────────────────────
  const n = await page.evaluate(Y => {
    const F = (finished, status = 'read') => normalizeBook({ id: 1, title: 'X', author: 'A', status, finished }).finished;
    return { ok: F('2025-06'), pad: F('2025-6'), day: F('2025-06-14'), badMonth: F('2025-13'), words: F('June 2025'),
             old: F('1800-01'), future: F(`${Y + 2}-01`), notRead: F('2025-06', 'reading'),
             noKey: 'finished' in normalizeBook({ id: 1, title: 'X', status: 'read' }),
             label: finishedLabel('2025-06'), search: normalizeBook({ id: 1, title: 'X', status: 'read', finished: '2025-06' })._searchStr.includes('2025-06') };
  }, Y);
  check('year-month is kept', n.ok === '2025-06', J(n));
  check('a single-digit month is padded; a full date is cut to its month', n.pad === '2025-06' && n.day === '2025-06');
  check('nonsense, impossible months and far-off years are dropped', [n.badMonth, n.words, n.old, n.future].every(v => v === undefined || v === ''), J(n));
  check('only a Read book keeps one', !n.notRead);
  check('a book with none gains no key', n.noKey === false);
  check('it reads as "Jun 2025"', n.label === 'Jun 2025', n.label);
  check('and is searchable', n.search);

  // ── 2. Display ──────────────────────────────────────────────────────
  const badge = t => page.locator('#booksGrid .book-card', { hasText: t }).locator('.badge-read').textContent();
  check('a Read card shows the month', (await badge('Hyperion')) === `Read · May ${Y}`, await badge('Hyperion'));
  check('a Read card with no month just says Read', (await badge('Middlemarch')) === 'Read');
  await page.click('.tab[data-tab="stats"]'); await page.waitForTimeout(200);
  const stat = await page.evaluate(Y => { const c = [...document.querySelectorAll('.stat-card')].find(c => c.textContent.includes(`Read in ${Y}`));
    return c && { v: c.querySelector('.stat-value').textContent, sub: c.querySelector('.stat-sub').textContent }; }, Y);
  check(`the Stats tab counts books read in ${Y}, with last year for scale`, !!stat && stat.v === '2' && stat.sub === `1 in ${Y - 1}`, J(stat));
  await page.click('.tab[data-tab="books"]'); await page.waitForTimeout(200);
  await page.selectOption('#sortSelect', 'finished-desc'); await page.waitForTimeout(300);
  const order = await page.evaluate(() => [...document.querySelectorAll('#booksGrid .book-title')].map(e => e.textContent));
  check('"Recently finished" sorts newest month first, undated after', J(order.slice(0, 3)) === J(['Hyperion', 'Dune', 'Emma']), J(order));
  await page.selectOption('#sortSelect', 'added-desc'); await page.waitForTimeout(200);

  // ── 3. The form ─────────────────────────────────────────────────────
  const shown = () => page.evaluate(() => document.getElementById('f-finished-group').style.display !== 'none');
  await page.click('#addBtn'); await page.waitForSelector('#modal.open');
  check('a new book (Want to read) has no Finished field', !(await shown()));
  await page.click('label[for="st-read"]');
  check('marking it Read shows the field, filled with this month', await shown() && (await page.inputValue('#f-finished')) === NOW, await page.inputValue('#f-finished'));
  await page.fill('#f-title', 'Piranesi'); await page.fill('#f-author', 'Susanna Clarke');
  await page.fill('#f-finished', '2024-08');
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('the chosen month is saved', await page.evaluate(() => books.find(b => b.title === 'Piranesi').finished) === '2024-08');

  await viaDetail(page.locator('#booksGrid .book-card', { hasText: 'Middlemarch' }), 'Edit');
  await page.waitForSelector('#modal.open');
  check('editing a Read book with no month shows the field empty — nothing invented', await shown() && (await page.inputValue('#f-finished')) === '');
  await page.evaluate(() => closeModal());

  await viaDetail(page.locator('#booksGrid .book-card', { hasText: 'Hyperion' }), 'Edit');
  await page.waitForSelector('#modal.open');
  check('editing a dated book shows its month', (await page.inputValue('#f-finished')) === `${Y}-05`);
  await page.click('label[for="st-reading"]');
  check('switching to Reading hides it', !(await shown()));
  await page.click('button[onclick="saveBook()"]'); await page.waitForTimeout(400);
  check('and saving drops the month', await page.evaluate(() => !('finished' in books.find(b => b.title === 'Hyperion'))));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
