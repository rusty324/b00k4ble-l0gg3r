// Games duplicates (core.js splitEdition / sameGame / findRemakeCandidate,
// js/app/merge.js, the add form): an edition is the same game, a remake from
// another year is not; the add form offers "Add as another copy" for the one
// and asks "Separate game, or another copy?" for the other; Find duplicates
// merges games into one title; a copy can be moved back out.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const GAMES = [
  { id: 1700000000001, title: 'Fallout 4', year: '2015', status: 'completed', rating: 4,
    copies: [{ id: 'p', platform: 'ps4', format: 'physical' }] },
  { id: 1700000000002, title: 'Fallout 4: Game of the Year Edition', year: '2017', status: 'playing', rating: 5, notes: 'All six DLC',
    copies: [{ id: 'p', platform: 'pc', format: 'digital', store: 'steam' }], dlc: [{ name: 'Far Harbor', owned: true, via: 'p' }] },
  { id: 1700000000003, title: 'Resident Evil 2', year: '1998', status: 'completed', copies: [{ id: 'r', platform: 'ps3', format: 'digital' }] },
  { id: 1700000000004, title: 'Resident Evil 2', year: '2019', status: 'want', copies: [{ id: 'r', platform: 'ps5', format: 'physical' }] },
  { id: 1700000000005, title: 'BioShock', year: '2007', status: 'completed',
    copies: [{ id: 'b', platform: 'ps4', format: 'physical', edition: 'The Collection' }] },
  { id: 1700000000006, title: 'BioShock Remastered', year: '2016', status: 'want', copies: [{ id: 'b', platform: 'pc', store: 'steam' }] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(g => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('videoGames', JSON.stringify(g));
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
  }, GAMES);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  const games = () => page.evaluate(() => videoGames);

  // ── 1. splitEdition, and what counts as the same game ──────────────
  const table = await page.evaluate(() => [
    'Fallout 4: Game of the Year Edition', 'The Last of Us Remastered', 'Skyrim Special Edition', 'Borderlands 3 (Deluxe Edition)',
    'Ultimate Chicken Horse', 'Gold Rush', 'Halo: The Master Chief Collection', 'A Little To The Left',
  ].map(t => { const r = splitEdition(t); return [r.base, r.edition, !!r.set]; }));
  check('splitEdition: the spec table', J(table) === J([
    ['Fallout 4', 'Game of the Year Edition', false], ['The Last of Us', 'Remastered', false], ['Skyrim', 'Special Edition', false],
    ['Borderlands 3', 'Deluxe Edition', false], ['Ultimate Chicken Horse', '', false], ['Gold Rush', '', false],
    ['Halo: The Master Chief Collection', '', true], ['A Little To The Left', '', false]]), J(table));
  const same = await page.evaluate(() => ({
    fallout: sameRecord('games', { title: 'Fallout 4', year: '2015' }, { title: 'Fallout 4: Game of the Year Edition', year: '2017' }),
    re2: sameRecord('games', { title: 'Resident Evil 2', year: '1998' }, { title: 'Resident Evil 2', year: '2019' }),
    noYear: sameRecord('games', { title: 'Resident Evil 2' }, { title: 'Resident Evil 2', year: '2019' }),
    halo: sameRecord('games', { title: 'Halo' }, { title: 'Halo: The Master Chief Collection' }),
  }));
  check('an edition is the same game whatever the years', same.fallout);
  check('the same name in two different years is two games (a remake)', !same.re2);
  check('…but a missing year rules nothing out', same.noYear);
  check('a set is not the game it collects', !same.halo);

  // ── 2. Find duplicates ─────────────────────────────────────────────
  await page.evaluate(() => openDuplicates()); await page.waitForTimeout(200);
  const body = await page.innerText('#dupesBody');
  check('Fallout 4 and its GOTY edition are flagged; Resident Evil 2 (1998/2019) is not',
    /Fallout 4: Game of the Year Edition/.test(body) && !/Resident Evil 2/.test(body), body);
  const falloutGroup = page.locator('#dupesBody .dup-group', { hasText: 'Fallout 4' });
  await falloutGroup.locator('button:has-text("Merge into one title")').click(); await page.waitForTimeout(200);
  const dlg = await page.innerText('#dupesBody');
  check('the merge dialog keeps the fuller record and lists disagreements',
    /Keeps Fallout 4: Game of the Year Edition/.test(dlg) && /Status: Completed vs Playing → Completed/.test(dlg) && /Rating: 4★ vs 5★ → 5★/.test(dlg), dlg);
  await page.click('#dupesBody .btn-primary:text-is("Merge")'); await page.waitForTimeout(300);
  let all = await games();
  const fo = all.filter(g => /Fallout/.test(g.title));
  check('one Fallout 4 is left, with both copies', fo.length === 1 && fo[0].copies.length === 2, J(fo));
  check('…its copy from the GOTY title is that edition; the clashing copy id renewed',
    fo[0].copies.find(c => c.platform === 'pc').edition === 'Game of the Year Edition' && new Set(fo[0].copies.map(c => c.id)).size === 2, J(fo[0].copies));
  check('…the status furthest along and the highest rating', fo[0].status === 'completed' && fo[0].rating === 5);
  check('…the DLC still points at the copy it came with', fo[0].dlc[0].via === fo[0].copies.find(c => c.platform === 'pc').id, J(fo[0]));

  // A set-like edition: the dialog offers to move it to `set`.
  await page.locator('#dupesBody .dup-group', { hasText: 'BioShock' }).locator('button:has-text("Merge into one title")').click();
  await page.waitForTimeout(200);
  check('an edition reading like a set gets a ticked "treat as a set" box',
    await page.locator('#dupesBody [data-set-edition="The Collection"]').isChecked());
  await page.click('#dupesBody .btn-primary:text-is("Merge")'); await page.waitForTimeout(300);
  all = await games();
  const bio = all.filter(g => /BioShock/.test(g.title));
  check('…and merging moves it there', bio.length === 1 && J(bio[0].copies.map(c => [c.platform, c.edition || '', c.set || ''])) ===
    J([['ps4', '', 'The Collection'], ['pc', 'Remastered', '']]), J(bio[0].copies));
  await page.evaluate(() => closeDuplicates());

  // ── 3. The add form ────────────────────────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.fill('#g-title', 'Fallout 4 Game of the Year Edition'); await page.waitForTimeout(300);
  check('an edition of a game you have: "Add as another copy"', await page.locator('#g-dup button:has-text("Add as another copy")').isVisible());
  await page.click('label[for="g-plat-xbox"]');
  await page.click('#g-dup button:has-text("Add as another copy")'); await page.waitForTimeout(300);
  all = await games();
  check('…adds the copy to that game, no second card', all.filter(g => /Fallout/.test(g.title)).length === 1 &&
    all.find(g => /Fallout/.test(g.title)).copies.some(c => c.platform === 'xbox' && c.edition === 'Game of the Year Edition'), J(all.find(g => /Fallout/.test(g.title))));

  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.fill('#g-title', 'Resident Evil 2'); await page.fill('#g-year', '2019'); await page.waitForTimeout(300);
  check('a known year still flags the 2019 game as a duplicate', /Already in your library/.test(await page.innerText('#g-dup')));
  await page.fill('#g-title', 'Resident Evil 3'); await page.fill('#g-year', '1999');
  await page.evaluate(() => videoGames.push(normalizeVideoGame({ id: 1700000000009, title: 'Resident Evil 3', year: '2020', status: 'want', copies: [{ platform: 'ps4' }] })));
  await page.fill('#g-year', '1999'); await page.dispatchEvent('#g-year', 'input'); await page.waitForTimeout(300);
  const ask = await page.innerText('#g-dup');
  check('another year asks, without blocking: "Same title as … (2020). Separate game, or another copy?"',
    /Same title as “Resident Evil 3” \(2020\)\. Separate game, or another copy\?/.test(ask), ask);
  await page.click('#g-dup button:has-text("Separate game")');
  check('…"Separate game" says so', /Will be saved as a separate game/.test(await page.innerText('#g-dup')));
  await page.click('label[for="g-plat-ps3"]');
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(300);
  all = await games();
  const re3 = all.filter(g => g.title === 'Resident Evil 3');
  check('…saves at once, and marks the two as not duplicates of each other', re3.length === 2 &&
    re3[0].notDuplicateOf?.includes(re3[1].id) && re3[1].notDuplicateOf?.includes(re3[0].id), J(re3));

  // ── 4. Move a copy back out ────────────────────────────────────────
  const foId = all.find(g => /Fallout/.test(g.title)).id;
  await page.evaluate(id => openGameModal(id), foId); await page.waitForTimeout(200);
  const pcRow = page.locator('#g-copies .copy-row', { has: page.locator('[data-field="platform"] option[value="pc"]:checked') });
  await pcRow.locator('button:has-text("Move to its own title")').click(); await page.waitForTimeout(300);
  all = await games();
  const parts = all.filter(g => /Fallout/.test(g.title));
  check('"Move to its own title" splits the copy out, its DLC with it', parts.length === 2 &&
    parts.some(g => g.copies.length === 1 && g.copies[0].platform === 'pc' && g.dlc?.[0]?.name === 'Far Harbor'), J(parts));
  await page.evaluate(() => closeGameModal());

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
