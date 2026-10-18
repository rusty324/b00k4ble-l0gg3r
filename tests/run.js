#!/usr/bin/env node
// Runs every suite in tests/suites against a static server it starts itself.
//   node tests/run.js                 all suites, Chromium
//   BROWSER=webkit node tests/run.js  all suites, WebKit (Safari's engine)
//   node tests/run.js dup sync        only suites whose name contains a word
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(REPO, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end();
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function run(file, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
}

(async () => {
  const filters = process.argv.slice(2);
  const suites = fs.readdirSync(path.join(__dirname, 'suites'))
    .filter(f => f.endsWith('.test.js'))
    .filter(f => !filters.length || filters.some(w => f.includes(w)))
    .sort();
  const server = await serve();
  const env = { ...process.env, BASE_URL: `http://127.0.0.1:${server.address().port}` };
  const browser = process.env.BROWSER || 'chromium';
  console.log(`Running ${suites.length} suite(s) in ${browser}\n`);

  let failed = 0;
  for (const s of suites) {
    const t = Date.now();
    const { code, out } = await run(path.join(__dirname, 'suites', s), env);
    const summary = (out.match(/(\d+)\/(\d+) checks passed/) || [])[0] || 'no summary';
    const ok = code === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${s.padEnd(30)} ${summary}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    if (!ok) {
      failed++;
      // Only what went wrong, not every passing line.
      console.log(out.split('\n').filter(l => /^FAIL|SUITE ERROR|Error|at /.test(l)).slice(0, 25).map(l => '      ' + l).join('\n'));
    }
  }
  server.close();
  console.log(`\n${suites.length - failed}/${suites.length} suites passed in ${browser}`);
  process.exit(failed ? 1 : 0);
})();
