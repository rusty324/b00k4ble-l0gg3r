// Shared by every suite: which browser, where the app is served, where the
// repo is, and where screenshots and temp files go. Suites run as plain Node
// scripts (one process each) so a crash in one cannot take the others down.
const fs = require('fs');
const os = require('os');
const path = require('path');
const playwright = require('playwright');

const BROWSER = process.env.BROWSER || 'chromium';     // chromium | webkit
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123';
const REPO = path.resolve(__dirname, '..');
const SHOT_DIR = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
fs.mkdirSync(SHOT_DIR, { recursive: true });

// Locally, Claude Code's container ships its own Chromium; CI installs the
// browsers Playwright expects, so the override applies only where it exists.
async function launch(opts = {}) {
  const type = playwright[BROWSER];
  if (!type) throw new Error(`Unknown BROWSER "${BROWSER}"`);
  const local = BROWSER === 'chromium' && fs.existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const browser = await type.launch({ ...local, ...opts });
  // The app registers a service worker (sw.js, offline start). In WebKit a
  // page under a service worker no longer goes through Playwright's routing,
  // so every suite's fake GitHub was bypassed and the requests went to the
  // real api.github.com. Suites therefore run without one; the one check that
  // is about the worker asks for it with { serviceWorkers: 'allow' } and uses
  // no sync.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (o = {}) => newContext({ serviceWorkers: 'block', ...o });
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (o = {}) => (await browser.newContext(o)).newPage();
  return browser;
}

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const shot = name => path.join(SHOT_DIR, `${BROWSER}-${name}`);

// The same reporting every suite uses: collect, print, exit non-zero on any
// failure so the runner (and CI) can tell.
function reporter() {
  const results = [];
  const check = (name, ok, detail = '') =>
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  const finish = () => {
    console.log(results.join('\n'));
    const failed = results.filter(r => r.startsWith('FAIL')).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    return failed;
  };
  const crash = e => { console.log(results.join('\n')); console.error('\nSUITE ERROR:', e.message); process.exit(2); };
  return { results, check, finish, crash };
}

// Cards are short: tapping one opens its detail sheet, where Edit and Delete
// live. `card` is a locator for a .book-card (or .book-row); `action` is the
// sheet button to press — 'Edit' or 'Delete' — or omitted to just open it.
async function viaDetail(card, action) {
  const page = card.page();
  await card.locator('.book-title, .book-row-title').first().click();
  await page.waitForSelector('#detailModal.open');
  if (action) await page.locator('#detailModal .detail-actions button', { hasText: action }).click();
}

// The text of one labelled fact in the open detail sheet ("Narrated by",
// "Formats", …), or null when the sheet has no such fact.
const detailFact = (page, label) => page.evaluate(label => {
  const dt = [...document.querySelectorAll('#detailModal .detail-facts dt')].find(d => d.textContent === label);
  return dt ? dt.nextElementSibling.innerText.trim() : null;
}, label);
const closeDetailSheet = page => page.evaluate(() => closeDetail());

// Switch the library view. On a phone the view buttons collapse to the
// current one (js/app/shell.js), so open them first when the one wanted
// is hidden.
async function pickView(page, mode) {
  const btn = page.locator(`#viewToggle [data-view="${mode}"]`);
  if (!(await btn.isVisible())) await page.click('#viewToggle .view-btn[aria-pressed="true"]');
  await btn.click();
}

module.exports = { launch, pickView, BASE, REPO, BROWSER, isWebKit: BROWSER === 'webkit', tmp, shot, reporter, viaDetail, detailFact, closeDetailSheet };
