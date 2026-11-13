// Games copies (core.js normalizeGameCopies, js/app/game-copies.js): one
// record per game with a list of copies — platform, format, PC store and the
// launcher it opens in, edition, set. Legacy platforms migrate on load with
// derived ids; `platforms` stays derived; store links, DLC "via", filters,
// the Store row, stats tiles and bulk Set store read the copies.
const { launch, BASE, reporter, viaDetail, detailFact, closeDetailSheet } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const GAMES = [
  { id: 1700000000001, title: 'Horizon Zero Dawn', status: 'completed',
    platforms: [{ platform: 'ps4', formats: ['physical'] }, { platform: 'ps5', formats: ['ps-plus'] }] },
  // pre-list shape, as older records and exports still have it
  { id: 1700000000002, title: 'Mass Effect', platform: 'steam', formats: ['digital'], status: 'completed' },
  { id: 1700000000003, title: 'Far Cry 6', status: 'want',
    copies: [{ id: 'f1', platform: 'pc', format: 'digital', store: 'steam' }] },
  { id: 1700000000004, title: 'Fortnite', status: 'playing',
    copies: [{ id: 'e1', platform: 'pc', format: 'digital', store: 'epic' }] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  await ctx.route('**/steamstatic.com/**', r => r.abort()); await ctx.route('**/akamaihd.net/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(g => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('videoGames', JSON.stringify(g));
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
  }, GAMES);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  const card = t => page.locator('#gameListWrap .book-card', { hasText: t });
  const titles = () => page.locator('#gameListWrap .book-title').allInnerTexts().then(a => a.sort());

  // ── 1. The model ───────────────────────────────────────────────────
  const n = await page.evaluate(() => {
    const N = x => normalizeVideoGame({ id: 1, title: 'X', ...x });
    const legacy = N({ platforms: [{ platform: 'ps4', formats: ['physical', 'digital'] }, { platform: 'ps5', formats: ['ps-plus'] }, { platform: 'xbox', formats: [] }] });
    const older = g => ({ ...g, platforms: (g.platforms || []).map(p => ({ ...p })) });
    return {
      legacy, again: JSON.stringify(normalizeVideoGame(legacy)) === JSON.stringify(legacy),
      steam: N({ platform: 'steam', formats: ['digital'] }),
      aliases: ['EGS', 'Epic Games', 'Origin', 'uplay', 'blizzard', 'Star Citizen', 'steam'].map(normalizeStore),
      custom: [normalizeStore('  GOG  '), normalizeStore('x'.repeat(60)).length],
      dropped: N({ copies: [{ platform: 'ps5', format: 'physical', store: 'steam', opensIn: 'epic' }] }).copies,
      sameOpens: N({ copies: [{ platform: 'pc', format: 'digital', store: 'epic', opensIn: 'Epic Games Store' }] }).copies,
      roundTrip: normalizeVideoGame(older(N({ copies: [{ id: 'a', platform: 'pc', format: 'digital', store: 'ubisoft', opensIn: 'steam' }] }))).copies,
      via: N({ copies: [{ id: 'g', platform: 'pc', edition: 'Gold' }], dlc: [{ name: 'A', via: 'g' }, { name: 'B', via: 'gone' }] }).dlc,
      custPlat: N({ copies: [{ platform: ' Switch ', format: 'physical' }] }),
    };
  });
  check('legacy platforms become one copy per platform × format, with derived ids',
    J(n.legacy.copies) === J([{ id: 'physical-1', platform: 'ps4', format: 'physical' }, { id: 'digital-1', platform: 'ps4', format: 'digital' },
      { id: 'subscription-1', platform: 'ps5', format: 'subscription', store: 'ps-plus' }, { id: 'xbox-1', platform: 'xbox' }]), J(n.legacy.copies));
  check('…`platforms` is derived back, PS Plus and all', J(n.legacy.platforms) === J([{ platform: 'ps4', formats: ['physical', 'digital'] },
    { platform: 'ps5', formats: ['ps-plus'] }, { platform: 'xbox', formats: [] }]), J(n.legacy.platforms));
  check('…and loading it again gives identical JSON', n.again);
  check('legacy Steam is a PC copy from Steam', J(n.steam.copies) === J([{ id: 'digital-1', platform: 'pc', format: 'digital', store: 'steam' }]) &&
    !('platform' in n.steam) && J(n.steam.platforms) === '[{"platform":"pc","formats":["digital"]}]', J(n.steam));
  check('store aliases normalize to their keys', J(n.aliases) === J(['epic', 'epic', 'ea', 'ubisoft', 'battlenet', 'rsi', 'steam']), J(n.aliases));
  check('a custom store is kept, trimmed and capped at 40', n.custom[0] === 'GOG' && n.custom[1] === 40, J(n.custom));
  check('store and opens-in are dropped from a PS5 physical copy', !('store' in n.dropped[0]) && !('opensIn' in n.dropped[0]), J(n.dropped));
  check('opens-in equal to the store is not stored', !('opensIn' in n.sameOpens[0]) && n.sameOpens[0].store === 'epic', J(n.sameOpens));
  check('an older normalizer carries copies through', n.roundTrip[0].store === 'ubisoft' && n.roundTrip[0].opensIn === 'steam', J(n.roundTrip));
  check('DLC keeps "via" only for a copy still on the record', n.via[0].via === 'g' && !('via' in n.via[1]), J(n.via));
  check('a custom platform is stored lowercased and trimmed', n.custPlat.copies[0].platform === 'switch', J(n.custPlat.copies));

  const links = await page.evaluate(() => ['https://store.epicgames.com/en-US/p/alan-wake-2', 'https://www.ea.com/games/mass-effect',
    'https://store.ubisoft.com/us/far-cry-6/5e8b.html', 'https://shop.battle.net/en-us/product/diablo-iv', 'https://robertsspaceindustries.com/pledge',
    'https://store.steampowered.com/app/1145360/Hades/'].map(u => { const r = parseGameStoreLink(u); return [r.platform, r.storeKey, r.title]; }));
  check('store links name a PC store', J(links.map(l => l[1])) === J(['epic', 'ea', 'ubisoft', 'battlenet', 'rsi', 'steam']) && links.every(l => l[0] === 'pc'), J(links));
  check('…and an Epic link carries the title', links[0][2] === 'Alan Wake 2', J(links[0]));

  // ── 2. Cards and detail ────────────────────────────────────────────
  const badges = await card('Horizon Zero Dawn').locator('.badge-platform').allTextContents();
  check('cards group copies into badges', badges.length === 2 && badges[0].startsWith('PS4 · Physical') && badges[1].startsWith('PS5 · PS Plus'), J(badges));
  check('a PC copy badge names its store', (await card('Mass Effect').locator('.badge-platform').innerText()).startsWith('PC · Steam'));
  await viaDetail(card('Horizon Zero Dawn'));
  const facts = await detailFact(page, 'Copies');
  check('the detail sheet lists each copy', /PS4 · Physical/.test(facts) && /PS5 · Subscription · PlayStation Plus/.test(facts), facts);
  await closeDetailSheet(page);

  // ── 3. The editor ──────────────────────────────────────────────────
  await page.evaluate(() => openGameModal(1700000000002)); await page.waitForTimeout(200);
  const row = i => `#g-copies [data-copy="${i}"]`;
  check('the form shows the legacy Steam game as a PC copy from Steam',
    await page.inputValue(`${row(0)} [data-field="platform"]`) === 'pc' && await page.inputValue(`${row(0)} [data-field="store"]`) === 'steam');
  await page.selectOption(`${row(0)} [data-field="opensIn"]`, 'ea');
  await page.click(`${row(0)} .copy-quick button:has-text("Game of the Year")`);
  check('the PC button is lit; Opens in and an edition are set', await page.locator('label[for="g-plat-pc"].active').count() === 1 &&
    await page.inputValue(`${row(0)} [data-field="edition"]`) === 'Game of the Year');
  await page.click('label[for="g-plat-ps4"]'); await page.waitForTimeout(100);
  check('a platform button adds a copy there', await page.locator('#g-copies .copy-row').count() === 2 &&
    await page.inputValue(`${row(1)} [data-field="platform"]`) === 'ps4');
  check('…a PS4 copy offers no store', await page.locator(`${row(1)} [data-field="store"]`).count() === 0);
  await page.selectOption(`${row(1)} [data-field="format"]`, 'physical');
  // a custom platform
  await page.click('#g-platform-group button:has-text("Other…")'); await page.waitForTimeout(100);
  await page.fill(`${row(2)} [data-field="platformText"]`, 'Switch');
  await page.press(`${row(2)} [data-field="platformText"]`, 'Tab');
  await page.selectOption(`${row(2)} [data-field="format"]`, 'physical');
  // DLC included in the GOTY copy
  await page.fill('#g-dlc', 'Bring Down the Sky'); await page.press('#g-dlc', 'Enter');
  await page.selectOption('#g-dlc-entries .dlc-via', { index: 1 });
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(300);
  const me = await page.evaluate(() => videoGames.find(g => g.id === 1700000000002));
  check('saved: three copies with their own fields', J(me.copies.map(c => [c.platform, c.format || '', c.store || '', c.opensIn || '', c.edition || ''])) ===
    J([['pc', 'digital', 'steam', 'ea', 'Game of the Year'], ['ps4', 'physical', '', '', ''], ['switch', 'physical', '', '', '']]), J(me.copies));
  check('…the DLC points at the copy it came with', me.dlc[0].via === me.copies[0].id && me.dlc[0].owned, J(me.dlc));
  check('…and the badge says where it opens', (await card('Mass Effect').locator('.badge-platform').first().innerText()).includes('via EA app'));
  await page.evaluate(() => openGameModal(1700000000002)); await page.waitForTimeout(200);
  check('the custom platform now has a button of its own', await page.locator('label[for="g-plat-switch"]').count() === 1);
  await page.click(`${row(0)} button[aria-label="Remove copy 1"]`);
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(300);
  check('removing a copy clears a DLC "via" that pointed at it', await page.evaluate(() => !('via' in videoGames.find(g => g.id === 1700000000002).dlc[0])));

  // a store link on a new game
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.evaluate(() => setLinksField('g', ['https://store.epicgames.com/en-US/p/alan-wake-2'])); await page.evaluate(() => gameAutofillFromLinks());
  await page.waitForTimeout(300);
  check('an Epic link fills the title and adds a PC copy from Epic', await page.inputValue('#g-title') === 'Alan Wake 2' &&
    await page.inputValue(`${row(0)} [data-field="store"]`) === 'epic');
  await page.evaluate(() => closeGameModal());

  // at least one copy
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.fill('#g-title', 'Nothing Yet');
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(200);
  check('saving with no copy is refused, with a reason', await page.evaluate(() =>
    document.getElementById('gameModal').classList.contains('open') && document.getElementById('g-plat-error').style.display === 'block'));
  await page.evaluate(() => closeGameModal());

  // ── 4. Filters, stats, bulk ────────────────────────────────────────
  const storeRow = '#altContent .filter-row:has(.filter-label:text-is("Store"))';
  await page.click('#altContent .pill:text-is("PC")'); await page.waitForTimeout(200);
  check('PC shows a Store row from the stores in use', J(await page.locator(`${storeRow} .pill`).allInnerTexts()) ===
    J(['All', 'Steam', 'Epic Games Store']), J(await page.locator(`${storeRow} .pill`).allInnerTexts()));
  await page.click(`${storeRow} .pill:has-text("Epic")`); await page.waitForTimeout(200);
  check('…which narrows to that store', J(await titles()) === J(['Fortnite']), J(await titles()));
  await page.click('#altContent .filter-row:has(.filter-label:text-is("Platform")) .pill:text-is("All")'); await page.waitForTimeout(200);
  check('leaving PC drops the Store row and its choice', await page.locator('#altContent .filter-label:text-is("Store")').count() === 0 &&
    (await titles()).length === 4);
  check('the Switch can be filtered', await page.locator('#altContent .pill:text-is("Switch")').count() === 1);

  await page.evaluate(() => { startBulk('games', [1700000000003, 1700000000004]); });
  await page.click('#bulkStoreBtn'); await page.fill('#bulkStoreInput', 'Ubisoft Connect');
  await page.click('#bulkBody .btn-primary'); await page.waitForTimeout(200);
  check('bulk Set store moves every PC copy of the selection', J(await page.evaluate(() =>
    videoGames.filter(g => g.id >= 1700000000003).map(g => g.copies[0].store))) === '["ubisoft","ubisoft"]');
  await page.evaluate(() => endBulk());
  await page.evaluate(() => switchTab('stats')); await page.waitForTimeout(250);
  const stats = await page.locator('.stat-card').allInnerTexts();
  check('stats show a tile per PC store', stats.some(t => /PC · Ubisoft/i.test(t)), J(stats));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
