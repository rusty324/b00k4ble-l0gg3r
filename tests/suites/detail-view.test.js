// Short cards, and the detail sheet a tap opens.
const { launch, BASE, reporter, viaDetail, detailFact, closeDetailSheet } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const BOOKS = [{ id: 1700000000001, title: 'Leviathan Wakes', author: 'James S. A. Corey', status: 'read', finished: '2025-06',
  formats: ['audio', 'ebook'], narrator: 'Jefferson Mays', series: 'The Expanse #1', genre: ['Sci-Fi', 'Space Opera'],
  notes: 'Best audiobook narration I have heard.', isbn: '9780316129084', rating: 5,
  links: ['https://www.audible.com/pd/B005FRGT44'], coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg' }];
const MEDIA = [{ id: 1700000000002, title: 'Airplane!', type: 'movie', year: '1980', status: 'want', formats: ['dvd'],
  editions: { dvd: '“Don’t Call Me Shirley!” Edition' }, genre: ['Comedy'], rating: 5 },
  { id: 1700000000003, title: 'Rick and Morty', type: 'tv', year: '2013', status: 'watched', formats: ['bluray'], seasons: [1], seasonCount: 8 }];
const GAMES = [{ id: 1700000000004, title: 'Horizon Zero Dawn', status: 'completed',
  platforms: [{ platform: 'ps4', formats: ['physical'] }, { platform: 'ps5', formats: ['ps-plus'] }],
  dlc: [{ name: 'The Frozen Wilds', owned: true }, { name: 'Bonus Pack', owned: false }] }];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await ctx.route('**/covers.openlibrary.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: png }));
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(([b, m, g]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, [BOOKS, MEDIA, GAMES]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);
  const open = () => page.evaluate(() => document.getElementById('detailModal').classList.contains('open'));
  const lightbox = () => page.evaluate(() => document.getElementById('lightbox').classList.contains('open'));
  const card = (scope, t) => page.locator(`${scope} .book-card`, { hasText: t });

  // ── 1. The card is short ────────────────────────────────────────────
  const lw = card('#booksGrid', 'Leviathan Wakes');
  const inCard = await lw.evaluate(c => ({ tags: c.querySelectorAll('.badge-tag').length, notes: !!c.querySelector('.book-notes'),
    buttons: c.querySelectorAll('button').length, links: c.querySelectorAll('a').length, text: c.innerText }));
  check('a card keeps title, author, series, formats, status and rating', /Leviathan Wakes/.test(inCard.text) && /Corey/.test(inCard.text) &&
    /Expanse/.test(inCard.text) && /Read · Jun 2025/.test(inCard.text) && /★/.test(inCard.text), inCard.text.replace(/\n/g, ' | '));
  check('and nothing else: no genres, notes, links or buttons', inCard.tags === 0 && !inCard.notes && inCard.buttons === 0 && inCard.links === 0, J(inCard));
  const h = await lw.evaluate(c => c.getBoundingClientRect().height);
  check(`a book card with everything filled in stays compact (${Math.round(h)}px)`, h < 360, String(Math.round(h)));

  // ── 2. Tap → sheet, with everything ─────────────────────────────────
  await lw.locator('.book-title').click(); await page.waitForTimeout(200);
  check('tapping the card opens its detail sheet', await open());
  const facts = { narr: await detailFact(page, 'Narrated by'), series: await detailFact(page, 'Series'), formats: await detailFact(page, 'Formats'),
    finished: await detailFact(page, 'Finished'), isbn: await detailFact(page, 'ISBN'), added: await detailFact(page, 'Added') };
  check('the sheet has the facts the card leaves out', facts.narr === 'Jefferson Mays' && facts.series === 'The Expanse #1' &&
    facts.formats === '🎧 Audiobook\n📱 E-book' && facts.finished === 'Jun 2025' &&
    facts.isbn === '9780316129084' && /2023/.test(facts.added), J(facts));
  check('…its genres, notes and links', await page.evaluate(() => {
    const m = document.getElementById('detailModal');
    return m.querySelectorAll('.badge-tag').length === 2 && /Best audiobook/.test(m.querySelector('.detail-notes').textContent) && !!m.querySelector('.detail-links a');
  }));
  await page.locator('#detailModal img.detail-cover').click(); await page.waitForTimeout(200);
  check('its cover opens the full-size view on top', await lightbox() && await open());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('Escape closes the cover first, leaving the sheet', !(await lightbox()) && await open());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('a second Escape closes the sheet', !(await open()));

  // ── 3. A card's cover still opens the full-size view, not the sheet ─
  await lw.locator('.book-card-cover').click(); await page.waitForTimeout(200);
  check("tapping a card's cover opens the cover, not the sheet", await lightbox() && !(await open()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // ── 4. Edit and Delete from the sheet ───────────────────────────────
  await viaDetail(lw, 'Edit'); await page.waitForTimeout(200);
  check('Edit closes the sheet and opens the edit form', !(await open()) && await page.evaluate(() =>
    document.getElementById('modal').classList.contains('open') && editingId === 1700000000001));
  await page.evaluate(() => closeModal());

  // ── 5. Movies & TV: the edition and seasons, readable on a phone ────
  await page.click('.tab[data-tab="media"]'); await page.waitForTimeout(300);
  await viaDetail(card('#altContent', 'Airplane!'));
  check('the DVD edition is spelled out — no hover needed', (await detailFact(page, 'Formats')) === '💿 DVD — “Don’t Call Me Shirley!” Edition', await detailFact(page, 'Formats'));
  await closeDetailSheet(page);
  await viaDetail(card('#altContent', 'Rick and Morty'));
  check('seasons owned are spelled out', (await detailFact(page, 'Seasons')) === 'Season 1 of 8', await detailFact(page, 'Seasons'));
  await closeDetailSheet(page);

  // ── 6. Games: each platform's formats and the DLC ───────────────────
  await page.click('.tab[data-tab="games"]'); await page.waitForTimeout(300);
  const hz = card('#gameListWrap', 'Horizon Zero Dawn');
  check('the game card holds no DLC names or notes', (await hz.locator('.dlc-owned, .dlc-want, .book-notes').count()) === 0);
  await viaDetail(hz);
  const plat = await detailFact(page, 'Platforms'), dlc = await detailFact(page, 'DLC');
  check('each platform with its formats in words', /PS4 — 📀 Physical/.test(plat) && /PS5 — .*PS Plus/.test(plat), plat);
  check('the DLC, with the wishlisted one marked', /The Frozen Wilds/.test(dlc) && /Bonus Pack \(wishlist\)/.test(dlc), dlc);
  // a phone: the sheet rises from the bottom edge
  const geo = await page.evaluate(() => { const r = document.querySelector('#detailModal .detail-modal').getBoundingClientRect();
    return { bottom: Math.round(r.bottom), width: Math.round(r.width), vh: innerHeight, vw: innerWidth }; });
  check('on a phone the sheet is full width and sits on the bottom edge', geo.width === geo.vw && Math.abs(geo.bottom - geo.vh) <= 1, J(geo));
  await page.click('#detailModal', { position: { x: 5, y: 5 } }); await page.waitForTimeout(200);
  check('tapping above the sheet closes it', !(await open()));
  await viaDetail(hz, 'Delete'); await page.waitForTimeout(300);
  check('Delete (after the confirm) removes it and closes the sheet', !(await open()) && await page.evaluate(() => videoGames.length === 0));

  // ── 7. List view: rows open it too; their own buttons do not ────────
  await page.click('.tab[data-tab="books"]'); await page.waitForTimeout(300);
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);
  const row = page.locator('#booksGrid .book-row', { hasText: 'Leviathan Wakes' });
  await row.locator('.book-row-title').click(); await page.waitForTimeout(200);
  check('tapping a list row opens the sheet', await open());
  await closeDetailSheet(page);
  await row.locator('button[title="Edit"]').click(); await page.waitForTimeout(200);
  check("a row's own ✏ goes straight to edit, without the sheet", !(await open()) && await page.evaluate(() => document.getElementById('modal').classList.contains('open')));
  await page.evaluate(() => closeModal());
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);

  // ── 8. Keyboard ─────────────────────────────────────────────────────
  await page.evaluate(() => document.querySelector('#booksGrid .book-card').focus());
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  check('a focused card opens with Enter', await open());
  await closeDetailSheet(page);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
