// On a phone the header's three view buttons collapse to one, which opens
// the other views; the header row then has room to breathe.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await page.route('**/fonts.g**', r => r.abort());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);

  const visibleViews = () => page.evaluate(() => [...document.querySelectorAll('#viewToggle .view-btn')].filter(b => b.offsetParent).map(b => b.dataset.view));
  const rowOf = () => page.evaluate(() => [...document.querySelectorAll('.header-actions > *')].filter(e => e.offsetParent).map(e => [e.id || e.className, Math.round(e.getBoundingClientRect().left)]));
  check('collapsed, only the current view shows', (await visibleViews()).join() === 'card', (await visibleViews()).join());
  const before = await rowOf();
  await page.click('#viewToggle .view-btn[aria-pressed="true"]');
  check('tapping it shows all three views', (await visibleViews()).join() === 'card,list,series', (await visibleViews()).join());
  check('without moving anything else in the header', JSON.stringify(await rowOf()) === JSON.stringify(before), JSON.stringify(await rowOf()));
  const list = await page.locator('#viewToggle .view-btn[data-view="list"]').boundingBox();
  const add = await page.locator('#addBtn').boundingBox();
  const overlaps = list.x < add.x + add.width && list.x + list.width > add.x && list.y < add.y + add.height && list.y + list.height > add.y;
  check('the opened views do not cover Add', !overlaps);
  await page.click('#viewToggle .view-btn[data-view="list"]');
  check('picking one switches to it and closes', (await visibleViews()).join() === 'list' && await page.evaluate(() => effectiveView()) === 'list');
  await page.click('#viewToggle .view-btn[aria-pressed="true"]');
  await page.mouse.click(200, 600);
  check('a tap elsewhere closes it', (await visibleViews()).join() === 'list');

  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(100);
  check('on a wide screen all three show as before', (await visibleViews()).join() === 'card,list,series', (await visibleViews()).join());

  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
