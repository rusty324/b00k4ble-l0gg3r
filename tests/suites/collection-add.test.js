// "Add a collection" (js/app/collection-modal.js): a set's titles in one go —
// a copy in the set for each title already held, a new title for the rest —
// from ⋯ and from the copies editor.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;
const SET = 'Star Trek: Original Motion Picture Collection';
const MEDIA = [
  { id: 1700000000401, title: 'Star Trek II: The Wrath of Khan', type: 'movie', year: '1982', status: 'watched', copies: [{ id: 'k1', format: 'dvd' }] },
  { id: 1700000000402, title: 'Star Trek III: The Search for Spock', type: 'movie', year: '1984', status: 'watched', copies: [] },
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
    localStorage.setItem('mediaLibrary', JSON.stringify(m)); localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, MEDIA);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);

  // ── 1. From ⋯ ──────────────────────────────────────────────────────
  await page.evaluate(() => { toggleSettingsMenu(); });
  await page.click('#settingsCollectionBtn'); await page.waitForTimeout(200);
  check('⋯ → Add a collection opens the sheet on Movies & TV', await page.locator('#collectionModal').evaluate(e => e.classList.contains('open')) &&
    await page.evaluate(() => activeTab) === 'media');
  check('Add is disabled until there is a name and a title', await page.locator('#coll-add').isDisabled());
  await page.fill('#coll-set', SET);
  await page.fill('#coll-titles', 'Star Trek: The Motion Picture (1979)\nStar Trek II: The Wrath of Khan (1982)\nStar Trek III: The Search for Spock\n');
  const preview = await page.innerText('#coll-preview');
  check('the preview says which are held and which are new',
    (preview.match(/adds a copy/g) || []).length === 2 && (preview.match(/new title/g) || []).length === 1, preview);
  check('the button counts them', (await page.innerText('#coll-add')) === 'Add 3 titles');
  await page.click('#coll-add'); await page.waitForTimeout(300);
  const lib = await page.evaluate(() => mediaLibrary);
  const by = t => lib.find(m => m.title === t);
  check('a held title gains a Blu-ray copy in the set beside its DVD',
    J(by('Star Trek II: The Wrath of Khan').copies.map(c => [c.format, c.set || ''])) === J([['dvd', ''], ['bluray', SET]]));
  check('a held title with no copies gets one', by('Star Trek III: The Search for Spock').copies.length === 1);
  const tmp = by('Star Trek: The Motion Picture');
  check('a new title is added with its year and the copy', tmp && tmp.year === '1979' && tmp.type === 'movie' && tmp.copies[0].set === SET, J(tmp));
  check('the sheet closed', !(await page.locator('#collectionModal').evaluate(e => e.classList.contains('open'))));

  // ── 2. From the copies editor ──────────────────────────────────────
  await page.evaluate(() => openMediaModal(1700000000402)); await page.waitForTimeout(200);
  await page.click('button:has-text("Add from a collection…")'); await page.waitForTimeout(200);
  check('from the form, the title being edited is listed first',
    (await page.inputValue('#coll-titles')).startsWith('Star Trek III: The Search for Spock (1984)'));
  await page.fill('#coll-set', 'Trilogy Box');
  await page.selectOption('#coll-format', 'dvd');
  await page.click('#coll-add'); await page.waitForTimeout(300);
  check("the edited title's copy goes into the form, not straight to the record",
    await page.locator('#m-copies .copy-row').count() === 2 &&
    await page.evaluate(() => mediaLibrary.find(m => m.id === 1700000000402).copies.length) === 1);
  await page.click('button[onclick="saveMediaItem()"]'); await page.waitForTimeout(300);
  check('…and saving the form keeps it', J(await page.evaluate(() => mediaLibrary.find(m => m.id === 1700000000402).copies.map(c => c.set || ''))) === J([SET, 'Trilogy Box']));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
