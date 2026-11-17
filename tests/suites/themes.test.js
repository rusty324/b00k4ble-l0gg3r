// ⋯ → Themes (js/app/look.js): a panel that slides in from the right over
// the page. Mode (Light/Dark), a colour preset for that mode, an accent on
// top, a graphical style and a font — each applies at once, is saved, and is
// restored before the page paints on the next load.
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'videoGames', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('theme', 'light');   // a choice made before the panel existed
  });
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(600);
  const attr = n => page.evaluate(n => document.documentElement.getAttribute(n), n);
  const css = v => page.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v);
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  check('an older light/dark choice is kept', await attr('data-theme') === 'light');
  await page.click('#settingsBtn');
  check('the menu item says "Themes"', (await page.innerText('#settingsThemeBtn')).trim().endsWith('Themes'));
  await page.click('#settingsThemeBtn'); await page.waitForTimeout(350);
  const box = await page.locator('#lookBody').boundingBox();
  check('it opens a panel at the right edge, over the page', await page.locator('#lookPanel.open').count() === 1 &&
    Math.round(box.x + box.width) === 390 && box.x > 20 && box.height >= 840, J(box));
  check('…with Mode, Colours, Accent, Style and Font', J(await page.locator('#lookBody .look-label').allInnerTexts()).match(/MODE.*COLOURS.*ACCENT.*STYLE.*FONT/i) !== null);

  // Mode
  const lightBg = await bodyBg();
  await page.click('#lookBody [data-look-mode="dark"]'); await page.waitForTimeout(200);
  check('Dark switches the page at once', await attr('data-theme') === 'dark' && (await bodyBg()) !== lightBg);
  check('…and its own presets are listed', (await page.locator('#lookBody [data-look-palette="midnight"]').count()) === 1 &&
    (await page.locator('#lookBody [data-look-palette="sky"]').count()) === 0);

  // Palette and accent
  await page.click('#lookBody [data-look-palette="midnight"]'); await page.waitForTimeout(200);
  check('a colour preset changes the page and the accent', (await css('--bg')).toLowerCase() === '#0f1420' && /6ea8fe/i.test(await css('--amber-200')), await css('--bg'));
  check('…and is marked chosen', await page.locator('#lookBody [data-look-palette="midnight"]').getAttribute('aria-checked') === 'true');
  await page.click('#lookBody [data-look-accent="#1E9466"]'); await page.waitForTimeout(200);
  check('an accent goes on top of the preset', /1e9466/i.test(await css('--amber-200')) && (await css('--bg')).toLowerCase() === '#0f1420');

  // Style and font
  const radius = () => page.evaluate(() => getComputedStyle(document.getElementById('settingsBtn')).borderTopLeftRadius);
  await page.click('#lookBody [data-look-style="sharp"]');
  // Buttons animate their corners (transition: all), so wait for it to settle
  // rather than reading mid-way on a slow runner.
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.getElementById('settingsBtn')).borderTopLeftRadius) < 0.5, null, { timeout: 3000 }).catch(() => {});
  check('Sharp squares the corners', await attr('data-style') === 'sharp' && parseFloat(await radius()) < 0.5, await radius());
  await page.click('#lookBody [data-look-style="paper"]'); await page.waitForTimeout(150);
  check('Paper textures the page', await page.evaluate(() => getComputedStyle(document.body).backgroundImage.includes('gradient')));
  await page.selectOption('#lookFont', 'serif'); await page.waitForTimeout(150);
  check('a font applies to the page', /Georgia/.test(await page.evaluate(() => getComputedStyle(document.querySelector('.brand')).fontFamily)));
  await page.screenshot({ path: shot('themes-panel.png') });

  // Close, keep
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  check('Esc closes the panel', await page.locator('#lookPanel.open').count() === 0 && await page.locator('#lookPanel').isHidden());
  await page.reload(); await page.waitForTimeout(600);
  check('everything is kept across a reload', await attr('data-theme') === 'dark' && await attr('data-style') === 'paper' &&
    await attr('data-font') === 'serif' && /1e9466/i.test(await css('--amber-200')));
  check('…applied by the head script, before the app scripts', await page.evaluate(() => {
    const s = document.getElementById('lookStyle'); return !!s && s.compareDocumentPosition(document.querySelector('link[href="css/base.css"]')) & Node.DOCUMENT_POSITION_FOLLOWING;
  }));

  // Reset
  await page.click('#settingsBtn'); await page.click('#settingsThemeBtn'); await page.waitForTimeout(300);
  await page.click('#lookBody .look-head button:has-text("Reset")'); await page.waitForTimeout(200);
  check('Reset goes back to the original dark look', await attr('data-theme') === 'dark' && await attr('data-style') === 'classic' &&
    await attr('data-font') === 'classic' && (await css('--bg')).toLowerCase() === '#161513');
  await page.click('.look-scrim', { position: { x: 10, y: 400 } }); await page.waitForTimeout(350);
  check('tapping the page beside the panel closes it', await page.locator('#lookPanel.open').count() === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
