// ⋯ → Theme… (js/app/shell.js): a sheet listing the themes (Light and Dark to
// start), the current one marked; picking one applies it at once, is saved,
// and is there again after a reload.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'videoGames', 'bookWishlist']) localStorage.setItem(k, '[]');
  });
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(600);
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  check('Dark is the default', await theme() === 'dark');
  const darkBg = await bg();
  await page.click('#settingsBtn'); await page.click('#settingsThemeBtn'); await page.waitForTimeout(200);
  check('⋯ → Theme… opens the sheet listing Light and Dark', await page.locator('#themeModal.open').count() === 1 &&
    (await page.locator('#themeBody .theme-card').allInnerTexts()).map(t => t.replace('✓', '').trim()).join() === 'Light,Dark');
  check('…the current theme is marked', await page.locator('#themeBody .theme-card[data-theme-key="dark"]').getAttribute('aria-checked') === 'true');
  check('…and the menu item names it', (await page.innerText('#settingsThemeLabel')) === 'Theme: Dark');
  await page.click('#themeBody .theme-card[data-theme-key="light"]'); await page.waitForTimeout(200);
  check('picking Light applies it at once', await theme() === 'light' && (await bg()) !== darkBg);
  check('…the sheet follows', await page.locator('#themeBody .theme-card[data-theme-key="light"]').getAttribute('aria-checked') === 'true' &&
    (await page.innerText('#settingsThemeLabel')) === 'Theme: Light');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check('Esc closes it', await page.locator('#themeModal.open').count() === 0);
  await page.reload(); await page.waitForTimeout(500);
  check('the choice is kept across a reload', await theme() === 'light');
  await page.evaluate(() => applyTheme('nonsense'));
  check('an unknown theme falls back to Dark', await theme() === 'dark');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
