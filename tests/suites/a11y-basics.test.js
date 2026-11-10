// Readability and keyboard basics: muted text meets WCAG AA contrast in both
// themes; phone-width inputs are 16px or larger (iOS Safari zooms the page on
// focusing a smaller one); the add/edit forms' status and format choices can
// be reached and changed from the keyboard; no flash of the wrong theme.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const BOOK = { id: 1700000000001, title: 'Dune', author: 'Frank Herbert', status: 'want', formats: ['ebook'] };

async function open(browser, viewport, theme) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, t]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify([b]));
    for (const k of ['mediaLibrary', 'videoGames', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('activeTab', 'books'); if (t) localStorage.setItem('theme', t);
  }, [BOOK, theme]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  return { ctx, page, errors };
}

// WCAG contrast of a token's colour against --surface, as the page computes them.
const contrast = (page, token) => page.evaluate(token => {
  const probe = document.createElement('div');
  probe.style.cssText = `color: var(${token}); background: var(--surface)`;
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor));
  probe.remove();
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}, token);

(async () => {
  const browser = await launch();
  const errors = [];

  // ── Q2: contrast, both themes ───────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    const d = await open(browser, { width: 1200, height: 900 }, theme); errors.push(...d.errors);
    check(`${theme} theme is applied`, await d.page.evaluate(() => document.documentElement.dataset.theme) === theme);
    for (const token of ['--text-muted', '--text-light']) {
      const c = await contrast(d.page, token);
      check(`${theme}: ${token} on the surface is at least 4.5:1`, c >= 4.5, String(c));
    }
    await d.ctx.close();
  }

  // ── Theme on first paint, no flash ──────────────────────────────────
  { const d = await open(browser, { width: 1200, height: 900 }, 'light');
    // The theme must already be right when the body starts to parse: record
    // it the moment <body> appears, on a fresh load.
    await d.page.addInitScript(() => {
      new MutationObserver((_, o) => {
        if (document.body) { window.__bodyTheme = document.documentElement.dataset.theme; o.disconnect(); }
      }).observe(document, { childList: true, subtree: true });
    });
    await d.page.reload(); await d.page.waitForTimeout(500);
    check('a light-theme user sees light from the first paint (set in <head>, before the body)',
      await d.page.evaluate(() => window.__bodyTheme) === 'light', await d.page.evaluate(() => String(window.__bodyTheme)));
    await d.ctx.close(); }

  // ── Q3: 16px inputs on a phone ──────────────────────────────────────
  { const d = await open(browser, { width: 390, height: 844 }); errors.push(...d.errors);
    // Every text-entry control on the page and in the four add forms (radios
    // and checkboxes take no text, so iOS does not zoom on them).
    const small = await d.page.evaluate(async () => {
      const out = {};
      const scan = where => document.querySelectorAll('input, select, textarea').forEach(el => {
        if (['radio', 'checkbox', 'hidden', 'file'].includes(el.type) || !el.offsetParent) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out[`${where} ${el.id || el.name || el.className || el.tagName}`] = fs;
      });
      scan('page');
      for (const [open, close, where] of [[() => openAddModal(), () => closeModal(), 'book form'],
          [() => openMediaModal(null), () => closeMediaModal(), 'media form'],
          [() => openGameModal(null), () => closeGameModal(), 'game form'],
          [() => openWishlistModal(null), () => closeWishlistModal(), 'wishlist form']]) {
        open(); scan(where); close();
      }
      return out;
    });
    check('at phone width every text input, select and textarea is at least 16px (no iOS zoom)', Object.keys(small).length === 0, J(small));
    await d.ctx.close(); }
  { const d = await open(browser, { width: 1200, height: 900 });
    check('desktop sizes are unchanged (the search box stays 14px)', await d.page.evaluate(() => getComputedStyle(document.querySelector('#searchInput')).fontSize) === '14px');
    await d.ctx.close(); }

  // ── Q4: the form's choices by keyboard ──────────────────────────────
  { const d = await open(browser, { width: 1200, height: 900 }); errors.push(...d.errors);
    const p = d.page;
    await p.evaluate(() => openEditModal(1700000000001));
    const reachable = await p.evaluate(() => {
      const r = document.querySelector('input[name="status"][value="want"]');
      const cs = getComputedStyle(r);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.tabIndex >= 0;
    });
    check('the status radios are in the tab order (not display:none)', reachable);
    await p.focus('input[name="status"]:checked');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
    check('an arrow key moves the status choice', await p.evaluate(() => document.querySelector('input[name="status"]:checked').value) === 'reading' &&
      await p.locator('label[for="st-reading"]').evaluate(l => l.classList.contains('active')));
    check('…and the focused choice shows a focus ring', await p.locator('label[for="st-reading"]').evaluate(l => getComputedStyle(l).outlineStyle !== 'none'));
    await p.focus('#f-format-group input[value="physical"]');
    await p.keyboard.press('Space'); await p.waitForTimeout(100);
    check('Space ticks a format', await p.evaluate(() => document.querySelector('#f-format-group input[value="physical"]').checked) &&
      await p.locator('#f-format-group label', { hasText: 'Physical' }).evaluate(l => l.classList.contains('active')));
    const box = await p.locator('input[name="status"][value="read"]').boundingBox();
    check('the radios stay invisible (1px, clipped)', !!box && box.width <= 1 && box.height <= 1, J(box));
    await d.ctx.close(); }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
