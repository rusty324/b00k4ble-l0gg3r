// On PlayStation the only subscription is PS Plus: the copy's format menu
// reads "PlayStation Plus" instead of "Subscription", picking it sets the
// store to ps-plus, and no service picker is shown. PS2 is a built-in
// platform labelled "PS2", listed before PS3 (a typed "ps2" used to show as "Ps2").
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    for (const k of ['myLibrary', 'mediaLibrary', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('videoGames', JSON.stringify([{ id: 1700000000001, title: 'Okami', status: 'completed',
      copies: [{ id: 'a', platform: 'ps2', format: 'physical' }] }]));
    localStorage.setItem('activeTab', 'games');
  });
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  const plats = await page.evaluate(() => knownGamePlatforms().map(platformLabel));
  check('PS2 is labelled "PS2" and listed before PS3', plats.indexOf('PS2') >= 0 && plats.indexOf('PS2') < plats.indexOf('PS3') && !plats.includes('Ps2'), J(plats));

  await page.evaluate(() => openGameModal(1700000000001)); await page.waitForTimeout(200);
  const row = i => `#g-copies [data-copy="${i}"]`;
  check('the PS2 copy shows PS2 in its platform menu',
    (await page.locator(`${row(0)} [data-field="platform"] option:checked`).innerText()) === 'PS2');
  const fmtLabels = i => page.locator(`${row(i)} [data-field="format"] option`).allInnerTexts();
  check('…and PS2 has no PlayStation Plus format', !(await fmtLabels(0)).includes('PlayStation Plus'), J(await fmtLabels(0)));

  for (const p of ['ps4', 'ps5']) {
    await page.selectOption(`${row(0)} [data-field="platform"]`, p); await page.waitForTimeout(80);
    const labels = await fmtLabels(0);
    check(`on ${p.toUpperCase()} the format menu reads PlayStation Plus, not Subscription`,
      labels.includes('PlayStation Plus') && !labels.includes('Subscription'), J(labels));
  }
  await page.selectOption(`${row(0)} [data-field="format"]`, 'subscription'); await page.waitForTimeout(80);
  check('picking it sets the store to PS Plus, with no service picker',
    await page.locator(`${row(0)} [data-field="store"]`).count() === 0 &&
    await page.evaluate(() => gameCopiesForSave()[0].store) === 'ps-plus');
  check('…and the copy reads "PS5 · PS Plus"', /PS5 · PS Plus/.test(await page.locator(`${row(0)} .copy-fmt`).innerText()));

  await page.selectOption(`${row(0)} [data-field="platform"]`, 'ps2'); await page.waitForTimeout(80);
  await page.selectOption(`${row(0)} [data-field="platform"]`, 'ps4'); await page.waitForTimeout(80);
  check('switching platforms keeps it a PS Plus copy', await page.evaluate(() => gameCopiesForSave()[0].store) === 'ps-plus');

  await page.selectOption(`${row(0)} [data-field="platform"]`, 'pc'); await page.waitForTimeout(80);
  const pcLabels = await fmtLabels(0);
  check('on PC it is still "Subscription" with the service picker',
    pcLabels.includes('Subscription') && await page.locator(`${row(0)} [data-field="store"]`).count() === 1, J(pcLabels));

  check('no page errors', !errors.length, errors.join(' | '));
  await browser.close(); finish();
})().catch(crash);
