// scan_library.py: books arrive from Calibre newest first, and the app reads
// an id as when a book was added — so the newest book must get the highest id.
const { execFileSync } = require('child_process');
const { REPO, reporter } = require('../lib');
const { check, finish, crash } = reporter();

try {
  const out = execFileSync('python3', ['-B', '-c', `
import json, scan_library as s
rows = [{'title': t, 'author': 'A', 'series': '', 'formats': ['ebook'], '_source': 'calibre'} for t in ['Newest', 'Middle', 'Oldest']]
print(json.dumps([[b['title'], b['id']] for b in s.merge_sources(rows)]))
`], { cwd: REPO, encoding: 'utf8' });
  const ids = Object.fromEntries(JSON.parse(out));
  check('the newest book gets the highest id', ids.Newest > ids.Middle && ids.Middle > ids.Oldest, out.trim());
  check('ids stay unique and consecutive', ids.Newest - ids.Oldest === 2);
  const failed = finish(); process.exit(failed ? 1 : 0);
} catch (e) { crash(e); }
