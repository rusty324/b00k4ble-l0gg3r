// Movies & TV copies (core.js normalizeMediaCopies, js/app/media-copies.js):
// one record per title with a list of copies; legacy formats/editions migrate
// on load with deterministic ids; formats/editions stay derived; an older
// normalizer carries copies through untouched; the editor adds, edits and
// removes copies; cards, detail, search and filters read them.
const { launch, BASE, reporter, viaDetail, detailFact, closeDetailSheet } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const ST3 = 'Star Trek III: The Search for Spock';
const SET = 'Star Trek: Original Motion Picture Collection';
const MEDIA = [
  { id: 1700000000101, title: ST3, type: 'movie', year: '1984', status: 'watched', formats: ['bluray'], editions: { bluray: '40th Anniversary Steelbook Edition' } },
  { id: 1700000000102, title: 'Star Trek II: The Wrath of Khan', type: 'movie', year: '1982', status: 'watched',
    copies: [{ id: 'k3f9', format: 'bluray', set: SET }] },
  { id: 1700000000103, title: 'Airplane!', type: 'movie', year: '1980', status: 'want', formats: ['dvd'] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/themoviedb.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(m => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', '[]'); localStorage.setItem('videoGames', '[]'); localStorage.setItem('bookWishlist', '[]');
    localStorage.setItem('mediaLibrary', JSON.stringify(m)); localStorage.setItem('activeTab', 'media'); localStorage.setItem('viewMode', 'card');
  }, MEDIA);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. The model ───────────────────────────────────────────────────
  const n = await page.evaluate(() => {
    const N = x => normalizeMediaItem({ id: 1, title: 'X', ...x });
    const legacy = N({ formats: ['bluray', 'dvd'], editions: { bluray: 'Steelbook' } });
    const two = N({ copies: [{ id: 'a', format: 'bluray', edition: '' }, { id: 'b', format: 'bluray', edition: 'Steelbook', set: 'Box' }] });
    // An older page's normalizer, as it was: spread, then its own formats/editions.
    const older = m => ({ ...m, formats: ['dvd'], editions: normalizeEditions(m.editions, ['dvd']) });
    const roundTrip = normalizeMediaItem(older(two));
    const twoEditions = copyEditions(two.copies);
    return {
      legacy, legacyAgain: J(normalizeMediaItem(legacy)) === J(legacy),
      legacyTwiceFresh: J(N({ formats: ['bluray', 'dvd'], editions: { bluray: 'Steelbook' } })) === J(legacy),
      two, roundTrip, twoEditions, twoFormats: formatsOf(two), roundFormats: formatsOf(roundTrip),
      streaming: N({ copies: [{ format: 'streaming', edition: 'Nope' }] }).copies,
      long: N({ copies: [{ format: 'dvd', edition: 'x'.repeat(200) }] }).copies[0].edition.length,
      dupIds: N({ copies: [{ id: 'a', format: 'dvd' }, { id: 'a', format: 'dvd' }] }).copies.map(c => c.id),
      label: fieldLabel('copies'),
      tvLegacy: N({ type: 'tv', formats: ['bluray', 'dvd'], seasons: [2, 1] }),
      tvPer: N({ type: 'tv', copies: [{ id: 'a', format: 'bluray', seasons: [3, 1, 2] }, { id: 'b', format: 'digital', seasons: [4, 2] }] }),
      movieDrops: N({ type: 'movie', copies: [{ id: 'a', format: 'bluray', seasons: [1] }] }),
    };
    function J(x) { return JSON.stringify(x); }
  });
  check('legacy {formats:[bluray,dvd], editions:{bluray}} loads as two copies, ids bluray-1 and dvd-1',
    J(n.legacy.copies) === J([{ id: 'bluray-1', format: 'bluray', edition: 'Steelbook' }, { id: 'dvd-1', format: 'dvd' }]), J(n.legacy.copies));
  check('…and loading it again, or afresh, gives identical JSON', n.legacyAgain && n.legacyTwiceFresh);
  check('two Blu-ray copies are both kept; formats (derived, not stored) is [bluray]', n.two.copies.length === 2 && J(n.twoFormats) === '["bluray"]' && !('formats' in n.two) && !('editions' in n.two), J(n.two));
  check('copyEditions gives the first non-empty edition per format', J(n.twoEditions) === '{"bluray":"Steelbook"}', J(n.twoEditions));
  check('an older normalizer carries copies through, and copies win over its edited formats',
    n.roundTrip.copies.length === 2 && J(n.roundFormats) === '["bluray"]', J(n.roundTrip));
  check('a streaming copy keeps no edition', J(n.streaming) === J([{ id: 'streaming-1', format: 'streaming' }]), J(n.streaming));
  check('edition text is capped at 120 characters', n.long === 120);
  check('copy ids stay unique within a record', new Set(n.dupIds).size === 2, J(n.dupIds));
  check('TV: seasons saved before copies move onto the first copy', J(n.tvLegacy.copies.map(c => c.seasons || null)) === '[[1,2],null]' && J(n.tvLegacy.seasons) === '[1,2]', J(n.tvLegacy));
  check('…and that is stable on the next load', await page.evaluate(r => JSON.stringify(normalizeMediaItem(r)) === JSON.stringify(r), n.tvLegacy));
  check("TV: each copy keeps its seasons; the title's are their union", J(n.tvPer.copies.map(c => c.seasons)) === '[[1,2,3],[2,4]]' && J(n.tvPer.seasons) === '[1,2,3,4]', J(n.tvPer));
  check('a Movie keeps no seasons on its copies', !n.movieDrops.copies[0].seasons && !('seasons' in n.movieDrops));
  check('the sync resolver names the field', /copies/.test(n.label), n.label);

  // ── 2. Cards, detail ───────────────────────────────────────────────
  const card = t => page.locator('#altContent .book-card', { hasText: t });
  // ── 3. The editor ──────────────────────────────────────────────────
  await page.evaluate(() => openMediaModal(1700000000101)); await page.waitForTimeout(200);
  const rows = () => page.locator('#m-copies .copy-row').evaluateAll(els => els.map(e => [e.querySelector('select').value, e.querySelector('[data-field="edition"]').value, e.querySelector('[data-field="set"]').value]));
  check('the form shows the legacy record as one copy with its edition', J(await rows()) === J([['bluray', '40th Anniversary Steelbook Edition', '']]), J(await rows()));
  check('each copy is a fieldset with a legend', await page.locator('#m-copies fieldset.copy-row > legend').count() === 1);
  await page.click('#m-copies + .links-row button:has-text("Add a copy")'); await page.waitForTimeout(100);
  check('"Add a copy" adds a row and focuses its format', (await rows()).length === 2 &&
    await page.evaluate(() => document.activeElement.closest('[data-copy]')?.dataset.copy === '1'));
  await page.fill('#m-copies [data-copy="1"] [data-field="set"]', SET);
  check('the summary counts them', (await page.innerText('#m-copies-sum')) === 'Blu-ray ×2');
  await page.click('#m-copies [data-copy="1"] .copy-quick button:has-text("Steelbook")');
  check('a quick pick fills the edition', (await rows())[1][1] === 'Steelbook');
  await page.fill('#m-copies [data-copy="1"] [data-field="edition"]', '');
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(300);
  const st3 = await page.evaluate(() => mediaLibrary.find(m => m.id === 1700000000101));
  check('saved: two Blu-ray copies, one in the set', J(st3.copies.map(c => [c.format, c.edition || '', c.set || ''])) ===
    J([['bluray', '40th Anniversary Steelbook Edition', ''], ['bluray', '', SET]]) , J(st3.copies));
  check('…the migrated copy keeps its id, the new one gets a short random one', st3.copies[0].id === 'bluray-1' && /^[a-z0-9]{4,8}$/.test(st3.copies[1].id), J(st3.copies.map(c => c.id)));
  check('the card groups them into one badge, "×2"', (await card(ST3).locator('.badge-media').innerText()).includes('×2') &&
    await card(ST3).locator('.badge-media').count() === 1);
  await viaDetail(card(ST3));
  const facts = await detailFact(page, 'Copies');
  check('the detail sheet lists each copy', /Blu-ray — 40th Anniversary Steelbook Edition/.test(facts) && new RegExp(`in ${SET}`).test(facts), facts);
  await closeDetailSheet(page);

  // Remove, and the set link
  await page.evaluate(() => openMediaModal(1700000000101)); await page.waitForTimeout(200);
  check('a copy in a set says how many titles share it', /In this set: 2 titles/.test(await page.innerText('#m-copies [data-copy="1"]')));
  await page.click('#m-copies [data-copy="1"] button:has-text("Show the set")'); await page.waitForTimeout(400);
  const shown = await page.locator('#setBody .vol-row-title').allInnerTexts();
  check('"Show the set" closes the form and opens the set\'s sheet', !(await page.evaluate(() => document.getElementById('mediaModal').classList.contains('open'))) &&
    J(shown) === J(['Star Trek II: The Wrath of Khan (1982)', `${ST3} (1984)`]), J(shown));
  await page.evaluate(() => closeSetSheet());
  await page.fill('#mediaSearchInput', 'steelbook'); await page.waitForTimeout(400);
  check('search reaches editions', J(await page.locator('#altContent .book-title').allInnerTexts()) === J([ST3]));
  await page.fill('#mediaSearchInput', ''); await page.waitForTimeout(400);
  await page.evaluate(() => openMediaModal(1700000000101)); await page.waitForTimeout(200);
  await page.click('#m-copies button[aria-label="Remove copy 2"]'); await page.waitForTimeout(100);
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(300);
  check('removing a copy and saving keeps just the other', await page.evaluate(() => mediaLibrary.find(m => m.id === 1700000000101).copies.length) === 1);

  // ── 4. Filters read copies ─────────────────────────────────────────
  await page.click('#altContent .pill:has-text("DVD")'); await page.waitForTimeout(250);
  check('the DVD filter finds the title whose copy is a DVD', J(await page.locator('#altContent .book-title').allInnerTexts()) === J(['Airplane!']));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
