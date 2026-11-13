// A set as one sheet (js/app/set-view.js): every title holding a copy in it,
// across Movies & TV and Games, with that copy; opened from a copy's "Show
// the set", from "in <set>" on a detail sheet, and from ⋯ → Sets….
const { launch, BASE, reporter, viaDetail } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const SET = 'Star Trek: Original Motion Picture Collection';
const MEDIA = [
  { id: 1700000000101, title: 'Star Trek II: The Wrath of Khan', type: 'movie', year: '1982', status: 'watched',
    copies: [{ id: 'a', format: 'bluray', set: SET }, { id: 'b', format: 'dvd' }] },
  { id: 1700000000102, title: 'Star Trek: The Motion Picture', type: 'movie', year: '1979', status: 'want',
    copies: [{ id: 'a', format: 'bluray', edition: "Director's Edition", set: 'star trek: original motion picture collection' }] },
  { id: 1700000000103, title: 'Airplane!', type: 'movie', year: '1980', status: 'want', copies: [{ id: 'a', format: 'dvd' }] },
];
const GAMES = [
  { id: 1700000000201, title: 'Halo 3', year: '2007', status: 'completed',
    copies: [{ id: 'h', platform: 'pc', format: 'digital', store: 'steam', set: 'Halo: The Master Chief Collection' }] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/themoviedb.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([m, g]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', '[]'); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('mediaLibrary', JSON.stringify(m)); localStorage.setItem('videoGames', JSON.stringify(g));
    localStorage.setItem('activeTab', 'media'); localStorage.setItem('viewMode', 'card');
  }, [MEDIA, GAMES]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  const open = () => page.evaluate(() => document.getElementById('setModal').classList.contains('open'));
  const rows = () => page.locator('#setBody .vol-row-title').allInnerTexts();

  // ── 1. ⋯ → Sets… ────────────────────────────────────────────────────
  await page.click('#settingsBtn'); await page.click('#settingsSetsBtn'); await page.waitForTimeout(200);
  check('⋯ → Sets… lists every set, across tabs, by name', J(await rows()) === J(['Halo: The Master Chief Collection', SET]), J(await rows()));
  check('…with how many titles each holds (spellings that differ only in case are one set)',
    /2 titles/.test(await page.locator('#setBody .vol-row', { hasText: SET }).innerText()));
  await page.click(`#setBody .vol-row:has-text("${SET}")`); await page.waitForTimeout(200);
  check('a set opens to its titles, oldest first, each with its copy', J(await rows()) === J(['Star Trek: The Motion Picture (1979)', 'Star Trek II: The Wrath of Khan (1982)']), J(await rows()));
  const subs = await page.locator('#setBody .vol-row-sub').allInnerTexts();
  check('…naming the copy in the set (not the title\'s other copies)', /Blu-ray — Director's Edition/.test(subs[0]) && subs[1].startsWith('Blu-ray ·') && !/DVD/.test(subs[1]), J(subs));
  check('…and counts', /2 titles · 2 copies · Movies & TV/.test(await page.innerText('#setBody .series-label')));

  // ── 2. A row opens the title; the detail's set link comes back ─────
  await page.click('#setBody .vol-row:has-text("Wrath of Khan")'); await page.waitForTimeout(250);
  check('a row opens the title over the sheet', await page.evaluate(() => document.getElementById('detailModal').classList.contains('open')) && await open());
  await page.click('#detailBody .set-link'); await page.waitForTimeout(200);
  check('"in <set>" on the detail sheet opens the set', await open() &&
    !(await page.evaluate(() => document.getElementById('detailModal').classList.contains('open'))) && (await rows()).length === 2);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check('Escape closes it', !(await open()));

  // ── 3. Games, and the form's Show the set ──────────────────────────
  await page.evaluate(() => openSetSheet('halo: the master chief collection')); await page.waitForTimeout(200);
  check('a game set lists its games with the copy', J(await rows()) === J(['Halo 3 (2007)']) &&
    /PC · Steam/.test(await page.innerText('#setBody .vol-row-sub')), await page.innerText('#setBody'));
  await page.evaluate(() => closeSetSheet());
  await page.evaluate(() => openMediaModal(1700000000101)); await page.waitForTimeout(200);
  await page.click('#m-copies [data-copy="0"] button:has-text("Show the set")'); await page.waitForTimeout(200);
  check('"Show the set" in the form closes it and opens the sheet', await open() &&
    !(await page.evaluate(() => document.getElementById('mediaModal').classList.contains('open'))));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
