// Movies & TV and Games: short horizontal cards (the whole poster at the left,
// title, a sub-line, badges) instead of a full-width banner that crops
// portrait posters. Wishlist: edit and delete are 44px icon buttons with a
// spoken label, beside the title on wider screens and under it on phones.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEElEQVR42mNk+M9Qz0AEAAKmAgFbN2ZbAAAAAElFTkSuQmCC', 'base64');
const MEDIA = [
  { id: 1700000000101, title: 'Inception', type: 'movie', year: '2010', status: 'watched', formats: ['bluray'], rating: 5, posterUrl: 'https://img.example/inception.png' },
  { id: 1700000000102, title: 'The Expanse', type: 'tv', year: '2015', status: 'watched', formats: ['digital'], seasons: [1, 2] },
  { id: 1700000000103, title: 'Arrival', type: 'movie', status: 'want', formats: [] },
];
const GAMES = [
  { id: 1700000000201, title: 'Elden Ring', year: '2022', status: 'completed', platforms: [{ platform: 'ps5', formats: ['physical'] }], coverUrl: 'https://img.example/er.png' },
  { id: 1700000000202, title: 'Hades', year: '2020', status: 'playing', platforms: [{ platform: 'steam', formats: ['digital'] }] },
];
const WISH = [{ id: 1700000000301, title: 'Project Hail Mary', creator: 'Andy Weir', type: 'book' }];

async function open(browser, viewport) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width <= 480 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  await ctx.route('https://img.example/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([m, g, w]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', '[]'); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', JSON.stringify(w));
    localStorage.setItem('viewMode', 'card');
  }, [MEDIA, GAMES, WISH]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(600);
  return { ctx, page, errors };
}
const box = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
const card = (page, title) => `#altContent .book-card:has(.book-title:text-is("${title}"))`;

(async () => {
  const browser = await launch();
  const errors = [];

  // ── Desktop ────────────────────────────────────────────────────────
  { const { ctx, page, errors: e } = await open(browser, { width: 1200, height: 900 }); errors.push(...e);
    await page.evaluate(() => switchTab('media')); await page.waitForTimeout(250);
    const poster = await box(page, `${card(page, 'Inception')} .hcard-cover`), title = await box(page, `${card(page, 'Inception')} .book-title`);
    check('a film card has its poster at the left, 64×96, the title beside it', poster.w === 64 && poster.h === 96 && title.x > poster.x + poster.w && Math.abs(title.y - poster.y) < 20, J([poster, title]));
    check('the poster is the whole image (object-fit: cover), not a banner', await page.locator(`${card(page, 'Inception')} img.hcard-cover`).evaluate(i => getComputedStyle(i).objectFit === 'cover'));
    check('the sub-line says what it is and when', (await page.locator(`${card(page, 'Inception')} .hcard-sub`).innerText()) === 'Movie · 2010' &&
      (await page.locator(`${card(page, 'The Expanse')} .hcard-sub`).innerText()) === 'TV show · 2015' &&
      (await page.locator(`${card(page, 'Arrival')} .hcard-sub`).innerText()) === 'Movie');
    check('no poster: a tile with the initials, same size', (await page.locator(`${card(page, 'The Expanse')} .hcard-tile`).innerText()) === 'E' &&
      J(await box(page, `${card(page, 'The Expanse')} .hcard-tile`)).includes('"w":64,"h":96'));
    const cols = await page.locator('#altContent .hcard-grid').evaluate(g => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    check('the cards sit several to a row (minmax 260px)', cols >= 3, String(cols));
    await page.locator(`${card(page, 'Inception')} img.hcard-cover`).click(); await page.waitForTimeout(200);
    check('tapping the poster still opens it full size', await page.evaluate(() => document.getElementById('lightbox').classList.contains('open') &&
      !document.getElementById('detailModal').classList.contains('open')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.locator(`${card(page, 'Inception')} .book-title`).click(); await page.waitForTimeout(200);
    check('tapping the rest opens its details', await page.evaluate(() => document.getElementById('detailModal').classList.contains('open')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);

    await page.evaluate(() => switchTab('games')); await page.waitForTimeout(250);
    const gp = await box(page, `${card(page, 'Elden Ring')} .hcard-cover`);
    check('a game card has its cover at the left, 72×96', gp.w === 72 && gp.h === 96, J(gp));
    check('…with its year beneath the title', (await page.locator(`${card(page, 'Elden Ring')} .hcard-sub`).innerText()) === '2022');

    await page.evaluate(() => switchTab('wishlist')); await page.waitForTimeout(250);
    const row = '#wishlistListWrap .wish-row';
    const edit = page.locator(`${row} button[aria-label="Edit Project Hail Mary"]`), del = page.locator(`${row} button[aria-label="Delete Project Hail Mary"]`);
    check('Wishlist: edit and delete are labelled icon buttons', await edit.count() === 1 && await del.count() === 1 &&
      !/✏|🗑/.test(await page.locator(row).innerText()));
    const eb = await box(page, `${row} button[aria-label^="Edit"]`), db = await box(page, `${row} button[aria-label^="Delete"]`);
    check('…44px square', eb.w === 44 && eb.h === 44 && db.w === 44 && db.h === 44, J([eb, db]));
    const tb = await box(page, `${row} .book-row-title`);
    check('…beside the title on a wide screen', eb.x > tb.x + 300 && Math.abs((eb.y + eb.h / 2) - (tb.y + tb.h)) < 30, J([tb, eb]));
    await edit.click(); await page.waitForTimeout(200);
    check('…and edit opens the item', await page.evaluate(() => document.getElementById('wishlistModal').classList.contains('open')));
    await ctx.close(); }

  // ── Phone ──────────────────────────────────────────────────────────
  { const { ctx, page, errors: e } = await open(browser, { width: 390, height: 844 }); errors.push(...e);
    await page.evaluate(() => switchTab('media')); await page.waitForTimeout(250);
    const p = await box(page, `${card(page, 'Inception')} .hcard-cover`);
    check('on a phone the poster is about 58×84', p.w >= 56 && p.w <= 60 && p.h === 84, J(p));
    const cols = await page.locator('#altContent .hcard-grid').evaluate(g => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    check('…one card per row', cols === 1, String(cols));
    check('…and nothing scrolls sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => switchTab('wishlist')); await page.waitForTimeout(250);
    const row = '#wishlistListWrap .wish-row';
    const tb = await box(page, `${row} .book-row-title`), gb = await box(page, `${row} .btn-got`), eb = await box(page, `${row} button[aria-label^="Edit"]`);
    check('Wishlist on a phone: Got it and the icons drop to a row under the title', gb.y > tb.y + tb.h - 2 && Math.abs(gb.y + gb.h / 2 - (eb.y + eb.h / 2)) < 4 && gb.x < 120, J([tb, gb, eb]));
    check('…and the creator still shows', await page.locator(`${row} .book-row-author`).isVisible());
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/wishlist-phone.png` });
    await ctx.close(); }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
