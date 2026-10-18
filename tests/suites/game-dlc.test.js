// DLC & expansions on the Games tab.
const { launch, BASE, REPO, tmp, shot } = require('../lib');
const results = [];
const check = (n, ok, d='') => results.push(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);
const J = JSON.stringify;

const GAMES = [
  { id: 1700000000001, title: 'Mass Effect 2', status: 'completed',
    platforms: [{ platform: 'steam', formats: ['digital'] }],
    dlc: [{ name: 'Lair of the Shadow Broker', owned: true }, { name: 'Arrival', owned: true }, { name: 'Overlord', owned: false }] },
  { id: 1700000000002, title: 'Hades', status: 'playing', platforms: [{ platform: 'steam', formats: [] }],
    dlc: [{ name: 'Season Pass', owned: true }] },
  { id: 1700000000003, title: 'Celeste', status: 'want', platforms: [{ platform: 'steam', formats: [] }] },
];
const titles = page => page.evaluate(() =>
  [...document.querySelectorAll('#gameListWrap .book-title, #gameListWrap .book-row-title')].map(e => e.textContent.trim()));
const rowNames = page => page.locator('#g-dlc-entries .dlc-name').allTextContents();
const chips = page => page.locator('#g-dlc-entries .fmt-chip').allTextContents().then(a => a.map(t => t.trim()));

(async () => {
  const errors = [];
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(g => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', '[]'); localStorage.setItem('mediaLibrary', '[]');
    localStorage.setItem('bookWishlist', '[]'); localStorage.setItem('videoGames', JSON.stringify(g));
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
  }, GAMES);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. Normalization ────────────────────────────────────────────────
  const n = await page.evaluate(() => {
    const d = x => normalizeVideoGame({ id: 1, title: 'X', dlc: x }).dlc;
    return {
      none: 'dlc' in normalizeVideoGame({ id: 1, title: 'X' }),
      emptyArr: 'dlc' in normalizeVideoGame({ id: 1, title: 'X', dlc: [] }),
      junk: 'dlc' in normalizeVideoGame({ id: 1, title: 'X', dlc: 'nope' }),
      defaultsOwned: d([{ name: 'A' }]),
      explicitWant: d([{ name: 'A', owned: false }]),
      strings: d(['Pack One', '  Pack Two  ']),
      dedupe: d([{ name: 'Citadel' }, { name: 'citadel', owned: false }]),
      blanks: d([{ name: '   ' }, { name: '' }, null, { name: 'Ok' }]),
      idempotent: (() => { const a = d([{ name: "A", owned: false }, "B"]); return JSON.stringify(a) === JSON.stringify(normalizeVideoGame({ id: 1, title: 'X', dlc: a }).dlc); })(),
    };
  });
  check('a game with no DLC gains no dlc key at all', n.none === false && n.emptyArr === false && n.junk === false, J(n));
  check('owned is the default; an explicit false is kept', J(n.defaultsOwned) === '[{"name":"A","owned":true}]' && J(n.explicitWant) === '[{"name":"A","owned":false}]', J([n.defaultsOwned, n.explicitWant]));
  check('plain strings are accepted and trimmed', J(n.strings) === '[{"name":"Pack One","owned":true},{"name":"Pack Two","owned":true}]', J(n.strings));
  check('a name listed twice collapses, case-insensitively, first one wins', J(n.dedupe) === '[{"name":"Citadel","owned":true}]', J(n.dedupe));
  check('blank and null entries are dropped', J(n.blanks) === '[{"name":"Ok","owned":true}]', J(n.blanks));
  check('normalizing twice changes nothing', n.idempotent);

  // ── 2. Rendering ────────────────────────────────────────────────────
  const card = t => page.locator('#gameListWrap .book-card', { hasText: t });
  check('a partly-owned set reads as a fraction (2 of 3)', (await card('Mass Effect 2').locator('.badge-dlc').textContent()) === 'DLC 2/3');
  check('a fully-owned set reads as a plain count', (await card('Hades').locator('.badge-dlc').textContent()) === 'DLC 1');
  check('no DLC, no badge and no line', (await card('Celeste').locator('.badge-dlc, .book-dlc').count()) === 0);
  check('the badge title names every item and flags the wishlisted one',
    (await card('Mass Effect 2').locator('.badge-dlc').getAttribute('title')) === 'Lair of the Shadow Broker, Arrival, Overlord (wishlist)');
  check('the card lists the names, wishlisted ones muted',
    J(await card('Mass Effect 2').locator('.book-dlc .dlc-owned').allTextContents()) === '["Lair of the Shadow Broker","Arrival"]' &&
    J(await card('Mass Effect 2').locator('.book-dlc .dlc-want').allTextContents()) === '["Overlord"]');
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);
  check('list view carries the badge too',
    (await page.locator('#gameListWrap .book-row', { hasText: 'Mass Effect 2' }).locator('.badge-dlc').textContent()) === 'DLC 2/3');
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);

  // ── 3. Search reaches into DLC names ────────────────────────────────
  await page.fill('#gameSearchInput', 'shadow broker'); await page.waitForTimeout(400);
  check('searching a DLC name finds its game', J(await titles(page)) === '["Mass Effect 2"]', J(await titles(page)));
  await page.fill('#gameSearchInput', ''); await page.waitForTimeout(300);

  // ── 4. The editor ───────────────────────────────────────────────────
  await card('Mass Effect 2').locator('button', { hasText: 'Edit' }).click();
  await page.waitForSelector('#gameModal.open'); await page.waitForTimeout(150);
  check('editing repopulates the rows in order', J(await rowNames(page)) === '["Lair of the Shadow Broker","Arrival","Overlord"]', J(await rowNames(page)));
  check('with owned/wishlist per row', J(await chips(page)) === '["✓ Owned","✓ Owned","Wishlist"]', J(await chips(page)));

  await page.fill('#g-dlc', 'Kasumi - Stolen Memory'); await page.press('#g-dlc', 'Enter');
  check('Enter adds a row, owned by default, and clears the box',
    (await rowNames(page)).includes('Kasumi - Stolen Memory') && (await chips(page)).at(-1) === '✓ Owned' && (await page.inputValue('#g-dlc')) === '');
  check('and the modal stays open (Enter did not submit)', await page.evaluate(() => document.getElementById('gameModal').classList.contains('open')));

  await page.fill('#g-dlc', 'ARRIVAL'); await page.press('#g-dlc', 'Enter');
  check('a duplicate is ignored, case-insensitively', (await rowNames(page)).length === 4, J(await rowNames(page)));
  await page.fill('#g-dlc', '   '); await page.press('#g-dlc', 'Enter');
  check('whitespace adds nothing', (await rowNames(page)).length === 4);
  await page.fill('#g-dlc', 'Awakening, Part 2'); await page.press('#g-dlc', 'Enter');
  check('a comma is part of the name, not a separator', (await rowNames(page)).includes('Awakening, Part 2'));

  await page.locator('#g-dlc-entries .platform-entry', { hasText: 'Overlord' }).locator('.fmt-chip').click();
  check('tapping the chip flips Wishlist to Owned', (await chips(page))[2] === '✓ Owned', J(await chips(page)));
  await page.locator('#g-dlc-entries .platform-entry', { hasText: 'Arrival' }).locator('.fmt-chip').click();
  check('and Owned to Wishlist', (await chips(page))[1] === 'Wishlist', J(await chips(page)));
  await page.locator('#g-dlc-entries .platform-entry', { hasText: 'Kasumi' }).locator('.platform-entry-remove').click();
  check('× removes just that row', !(await rowNames(page)).some(t => /Kasumi/.test(t)) && (await rowNames(page)).length === 4);

  // text typed but not Entered is still committed on save
  await page.fill('#g-dlc', 'Genesis'); 
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
  const saved = await page.evaluate(() => videoGames.find(g => g.title === 'Mass Effect 2').dlc);
  check('Save commits a name still sitting in the box, and keeps every change',
    J(saved) === J([
      { name: 'Lair of the Shadow Broker', owned: true }, { name: 'Arrival', owned: false },
      { name: 'Overlord', owned: true }, { name: 'Awakening, Part 2', owned: true }, { name: 'Genesis', owned: true }]), J(saved));
  check('and the card reflects it (4/5 owned)', (await card('Mass Effect 2').locator('.badge-dlc').textContent()) === 'DLC 4/5');

  // ── 5. Adding a new game; removing the last DLC ─────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open'); await page.waitForTimeout(150);
  check('a new game starts with no rows, and nothing carried over from the last edit', (await rowNames(page)).length === 0 && (await page.inputValue('#g-dlc')) === '');
  await page.fill('#g-title', 'Fresh'); await page.click('label[for="g-plat-ps5"]');
  await page.fill('#g-dlc', 'Day One Pack'); await page.press('#g-dlc', 'Enter');
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
  check('a new game saves its DLC', J(await page.evaluate(() => videoGames.find(g => g.title === 'Fresh').dlc)) === '[{"name":"Day One Pack","owned":true}]');

  await card('Fresh').locator('button', { hasText: 'Edit' }).click(); await page.waitForSelector('#gameModal.open');
  await page.locator('#g-dlc-entries .platform-entry-remove').click();
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
  check('removing the last row drops the key entirely rather than storing []',
    (await page.evaluate(() => 'dlc' in videoGames.find(g => g.title === 'Fresh'))) === false);

  // ── 6. Interaction with the platform editor, and the stamp ──────────
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.click('label[for="g-plat-ps4"]');
  check('the platform rows still work beside it', (await page.locator('#g-platform-entries .platform-entry').count()) === 1 && (await rowNames(page)).length === 0);
  await page.click('button[onclick="closeGameModal()"]');
  check('saving DLC moved the games tab date',
    await page.evaluate(() => (JSON.parse(localStorage.getItem('lastUpdated')) || {}).games > 0));

  // ── 7. Round trip through export/import keeps DLC ───────────────────
  const fs = require('fs');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportData())]);
  const ex = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check('the export carries dlc on the game that has it', J(ex.items.find(g => g.title === 'Mass Effect 2').dlc).includes('Genesis') && !('dlc' in ex.items.find(g => g.title === 'Celeste')));
  await page.evaluate(() => { videoGames = []; saveGames(); renderPage(); });
  await page.setInputFiles('#importFile', await dl.path()); await page.waitForTimeout(500);
  check('and import restores it', J(await page.evaluate(() => videoGames.find(g => g.title === 'Mass Effect 2').dlc.length)) === '5');

  // ── 8. Phone layout ─────────────────────────────────────────────────
  await card('Mass Effect 2').locator('button', { hasText: 'Edit' }).click(); await page.waitForSelector('#gameModal.open'); await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('g-dlc').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(150);
  const geo = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#g-dlc-entries .platform-entry')].map(e => Math.round(e.getBoundingClientRect().height));
    const x = document.querySelector('#g-dlc-entries .platform-entry-remove').getBoundingClientRect();
    const chip = document.querySelector('#g-dlc-entries .fmt-chip').getBoundingClientRect();
    const modal = document.querySelector('#gameModal .modal').getBoundingClientRect();
    return { rows: r, x: Math.round(x.height), chip: Math.round(chip.height), overflow: document.documentElement.scrollWidth > innerWidth, xInside: x.right <= modal.right };
  });
  check('phone: rows are a sane height (not stretched by the flex basis)', geo.rows.every(h => h < 140), J(geo));
  check('phone: chip and × meet the 44px touch target', geo.x >= 44 && geo.chip >= 44, J(geo));
  check('phone: nothing overflows the page or the modal', !geo.overflow && geo.xInside, J(geo));
  await page.screenshot({ path: shot('dlc-mobile-modal.png') });
  await page.click('button[onclick="closeGameModal()"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: shot('dlc-mobile-cards.png'), fullPage: true });

  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  console.log(results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - f}/${results.length} checks passed`);
  await browser.close(); process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); });
