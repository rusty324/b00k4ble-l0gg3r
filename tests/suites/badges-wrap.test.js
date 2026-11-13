// A game with several copies has several badges ("PC · Steam", "PS4 · PS
// Plus", "PS5 · PS Plus"). On a phone they wrap inside the row, in the list
// and the card view, rather than running off the screen and pushing the
// whole page sideways.
const { launch, BASE, reporter, shot } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const GAMES = [
  { id: 1700000000001, title: 'Among Us', status: 'want', copies: [
    { id: 'a', platform: 'pc', format: 'digital', store: 'steam' },
    { id: 'b', platform: 'ps4', format: 'subscription', store: 'ps-plus' },
    { id: 'c', platform: 'ps5', format: 'subscription', store: 'ps-plus' }] },
  { id: 1700000000002, title: 'Alien: Isolation', status: 'completed', copies: [{ id: 'a', platform: 'pc', format: 'digital', store: 'steam' }] },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(g => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    for (const k of ['myLibrary', 'mediaLibrary', 'bookWishlist']) localStorage.setItem(k, '[]');
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('activeTab', 'games');
  }, GAMES);

  await page.goto(BASE + '/index.html'); await page.waitForTimeout(700);
  for (const view of ['list', 'card']) {
    await page.evaluate(v => setView(v), view); await page.waitForTimeout(300);
    const geo = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#gameListWrap [data-detail]')].find(r => r.textContent.includes('Among Us'));
      const box = row.getBoundingClientRect();
      const badges = [...row.querySelectorAll('.badge-platform')].map(b => b.getBoundingClientRect());
      return { page: document.documentElement.scrollWidth, vw: innerWidth, rowRight: Math.round(box.right),
        badgeRight: Math.round(Math.max(...badges.map(b => b.right))), lines: new Set(badges.map(b => Math.round(b.top))).size };
    });
    check(`${view}: the page does not scroll sideways`, geo.page <= geo.vw, J(geo));
    check(`${view}: every badge stays inside its row`, geo.badgeRight <= geo.rowRight, J(geo));
    check(`${view}: three badges wrap onto more than one line`, geo.lines > 1, J(geo));
    await page.screenshot({ path: shot(`badges-wrap-${view}.png`) });
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
