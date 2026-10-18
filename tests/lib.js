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
function launch(opts = {}) {
  const type = playwright[BROWSER];
  if (!type) throw new Error(`Unknown BROWSER "${BROWSER}"`);
  const local = BROWSER === 'chromium' && fs.existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  return type.launch({ ...local, ...opts });
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

module.exports = { launch, BASE, REPO, BROWSER, isWebKit: BROWSER === 'webkit', tmp, shot, reporter };
