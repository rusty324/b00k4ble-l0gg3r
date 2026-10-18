// A game owned on several platforms, each with its own formats (PS Plus only
// on PlayStation). Guards the platform row editor in the game form.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const GAMES = [
  { id: 1700000000001, title: 'Horizon Zero Dawn', status: 'completed',
    platforms: [{ platform: 'ps4', formats: ['physical'] }, { platform: 'ps5', formats: ['ps-plus'] }] },
  // pre-list shape, as older records and exports still have it
  { id: 1700000000002, title: 'Mass Effect', platform: 'steam', formats: ['digital'], status: 'completed' },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(g => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('videoGames', JSON.stringify(g));
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
  }, GAMES);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  const names = () => page.locator('#g-platform-entries .platform-entry-name').allTextContents();
  const chips = plat => page.locator('#g-platform-entries .platform-entry', { hasText: plat }).locator('.fmt-chip');
  const active = async plat => (await page.locator('#g-platform-entries .platform-entry', { hasText: plat })
    .locator('.fmt-chip.active').allTextContents()).map(t => t.trim());
  const openEdit = async title => {
    await page.locator('#gameListWrap .book-card', { hasText: title }).locator('button', { hasText: 'Edit' }).click();
    await page.waitForSelector('#gameModal.open'); await page.waitForTimeout(150);
  };

  // normalization
  const n = await page.evaluate(() => ({
    legacy: normalizeVideoGame({ id: 1, title: 'X', platform: 'ps4', formats: ['physical'] }),
    plusOffPs: normalizeVideoGame({ id: 1, title: 'X', platforms: [{ platform: 'steam', formats: ['digital', 'ps-plus'] }] }).platforms,
    dedupe: normalizeVideoGame({ id: 1, title: 'X', platforms: [{ platform: 'steam', formats: [] }, { platform: 'Steam', formats: ['physical'] }] }).platforms,
  }));
  check('a pre-list record folds into one platform entry', J(n.legacy.platforms) === '[{"platform":"ps4","formats":["physical"]}]', J(n.legacy.platforms));
  check('and its old keys are not stored', !('platform' in n.legacy) && !('formats' in n.legacy));
  check('PS Plus is dropped off a non-PlayStation platform', J(n.plusOffPs) === '[{"platform":"steam","formats":["digital"]}]', J(n.plusOffPs));
  check('a platform listed twice collapses to one', n.dedupe.length === 1, J(n.dedupe));

  // editing a two-platform game
  await openEdit('Horizon Zero Dawn');
  check('both platforms come back as rows, in platform order', J(await names()) === '["PS4","PS5"]', J(await names()));
  check('each row keeps its own format', J(await active('PS4')) === J(['📀 Physical']) && (await active('PS5')).length === 1 && /PS Plus/.test((await active('PS5'))[0]), J([await active('PS4'), await active('PS5')]));
  check('a PlayStation row offers three formats', (await chips('PS5').count()) === 3);
  await page.click('label[for="g-plat-steam"]'); await page.waitForTimeout(100);
  check('ticking Steam adds a row, in platform order', J(await names()) === '["PS4","PS5","Steam"]', J(await names()));
  check('the Steam row offers no PS Plus', (await chips('Steam').count()) === 2);
  await chips('Steam').nth(1).click();
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
  const hz = await page.evaluate(() => videoGames.find(g => g.id === 1700000000001).platforms);
  check('all three save with their own formats', J(hz.map(p => [p.platform, p.formats])) === J([['ps4', ['physical']], ['ps5', ['ps-plus']], ['steam', ['digital']]]), J(hz));

  // removing
  await openEdit('Horizon Zero Dawn');
  await page.locator('#g-platform-entries .platform-entry', { hasText: 'Steam' }).locator('.platform-entry-remove').click();
  check("a row's × removes it and unticks its button", J(await names()) === '["PS4","PS5"]' &&
    !(await page.evaluate(() => document.getElementById('g-plat-steam').checked)));
  await page.click('label[for="g-plat-steam"]');
  check('re-ticking starts the platform over, no stale formats', (await active('Steam')).length === 0);
  await page.evaluate(() => closeGameModal());

  // at least one platform
  await openEdit('Mass Effect');
  await page.click('label[for="g-plat-steam"]');
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(300);
  check('saving with no platform is refused, with a reason', await page.evaluate(() =>
    document.getElementById('gameModal').classList.contains('open') && document.getElementById('g-plat-error').style.display === 'block'));
  await page.click('label[for="g-plat-xbox"]');
  check('picking one clears the error', await page.evaluate(() => document.getElementById('g-plat-error').style.display) === 'none');
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(400);
  check('the swap saves', J(await page.evaluate(() => videoGames.find(g => g.id === 1700000000002).platforms)) === '[{"platform":"xbox","formats":[]}]');

  // card badges
  const badges = await page.locator('#gameListWrap .book-card', { hasText: 'Horizon Zero Dawn' }).locator('.badge-platform').allTextContents();
  // Saved earlier with PS4, PS5 and Steam (the removal step closed without saving).
  check('one badge per platform, each with its own format icon',
    J(badges) === J(['PS4 📀', 'PS5 ➕️', 'Steam 💾']), J(badges));

  // a fresh add starts clean
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  check('the add form starts with no platform and no rows', (await names()).length === 0 &&
    (await page.locator('#g-platform-group .radio-btn.active').count()) === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
