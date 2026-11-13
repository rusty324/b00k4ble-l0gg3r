// Pasting a cover (js/app/cover-files.js): an image on the clipboard, pasted
// with Ctrl/⌘V anywhere in an open form or through the "Paste image" button,
// goes through the same path as an upload — resized, kept on the device, the
// field set to a "repo:" cover. Text pastes are left alone.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'bookWishlist', 'videoGames']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'games'); localStorage.setItem('viewMode', 'card');
  });
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // A real PNG, drawn in the page; a paste event carrying it (clipboardData
  // set by hand, which every engine allows on a plain Event).
  const paste = (target, what) => page.evaluate(async ([target, what]) => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 90;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 60, 90);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const items = what === 'image'
      ? [{ kind: 'file', type: 'image/png', getAsFile: () => new File([blob], 'image.png', { type: 'image/png' }) }]
      : [{ kind: 'string', type: 'text/plain', getAsFile: () => null }];
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { items } });
    document.querySelector(target).dispatchEvent(e);
    return e.defaultPrevented;
  }, [target, what]);
  const cover = () => page.inputValue('#g-coverUrl');

  // ── 1. Ctrl/⌘V in the game form ─────────────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  const handled = await paste('#g-title', 'image'); await page.waitForTimeout(600);
  check('an image pasted anywhere in the game form becomes the cover', handled && /^repo:covers\/games\/[a-z0-9]+\.jpg$/.test(await cover()), await cover());
  check('…the preview shows it', await page.locator('#g-coverUrl-preview').isVisible());
  check('…and the form says so', /Image added/.test(await page.innerText('#g-coverUrl-msg')));
  await page.evaluate(() => clearCoverField('g-coverUrl'));
  check('a text paste is left to the field', !(await paste('#g-title', 'text')) && (await cover()) === '');
  await page.fill('#g-title', 'Pasted'); await page.click('label[for="g-plat-pc"]');
  await paste('#g-notes', 'image'); await page.waitForTimeout(600);
  await page.click('button[onclick="saveGameItem()"]'); await page.waitForTimeout(300);
  check('saving keeps the pasted cover', await page.evaluate(() => /^repo:/.test(videoGames.find(g => g.title === 'Pasted').coverUrl)));

  // ── 2. The Paste image button ───────────────────────────────────────
  await page.click('#addBtn'); await page.waitForSelector('#gameModal.open');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => {
      const c = document.createElement('canvas'); c.width = 40; c.height = 60;
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      return [{ types: ['text/plain', 'image/png'], getType: async () => blob }];
    } } });
  });
  await page.click('#gameModal button:has-text("Paste image")'); await page.waitForTimeout(600);
  check('"Paste image" reads the clipboard into the cover', /^repo:covers\/games\//.test(await cover()), await cover());
  await page.evaluate(() => { clearCoverField('g-coverUrl');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['x']) }] } }); });
  await page.click('#gameModal button:has-text("Paste image")'); await page.waitForTimeout(200);
  check('…and says so when the clipboard holds no image', /no image on the clipboard/.test(await page.innerText('#g-coverUrl-msg')) && (await cover()) === '');
  await page.evaluate(() => closeGameModal());

  // ── 3. The other forms too ──────────────────────────────────────────
  await page.evaluate(() => { switchTab('media'); openMediaModal(null); }); await page.waitForTimeout(200);
  await paste('#m-title', 'image'); await page.waitForTimeout(600);
  check('the Movies & TV form takes a pasted poster', /^repo:covers\/media\//.test(await page.inputValue('#m-posterUrl')));
  await page.evaluate(() => closeMediaModal());
  check('with no form open, a paste is left alone', !(await paste('body', 'image')));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
