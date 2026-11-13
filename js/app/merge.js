// merge.js — several records of the same title folded into one (Movies & TV
// and Games). Used by Find duplicates → Merge and by the add forms' "Add as
// another copy". The survivor keeps its fields; the others add their copies
// and fill its blanks. The merged-away records are then deleted by the
// caller, which leaves tombstones so other devices drop them too.

// Most advanced first; anything unlisted counts as least.
const STATUS_RANK = {
  media: ['watched', 'want', 'not-interested'],
  games: ['completed', 'playing', 'on-hold', 'want', 'not-interested'],
};
const statusRank = (kind, st) => { const i = STATUS_RANK[kind].indexOf(st); return i === -1 ? 99 : i; };

// The record with the most filled-in fields; a tie goes to the oldest.
function mergeSurvivor(recs) {
  const filled = r => Object.values(r).filter(v => v != null && v !== '' && v !== 0 && !(Array.isArray(v) && !v.length)).length;
  return [...recs].sort((a, b) => filled(b) - filled(a) || a.id - b.id)[0];
}

// Two copies that say the same thing: one is enough.
const copyKey = (kind, c) => [c.format, kind === 'games' ? c.platform : '', c.store || '', c.edition || '', c.set || ''].map(textKey).join('|');

// Editions that read like a set ("… Collection"): offered to the user as a set.
const SET_WORD_RE = new RegExp(`\\b(?:${SET_WORDS.map(w => w.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
function setLikeEditions(recs) {
  return [...new Set(recs.flatMap(r => (r.copies || []).map(c => c.edition).filter(e => e && SET_WORD_RE.test(e))))];
}

// opts.asSets: edition texts to move to `set`.
function mergeRecords(kind, target, sources, opts = {}) {
  const normalize = kind === 'games' ? normalizeVideoGame : normalizeMediaItem;
  const asSets = new Set((opts.asSets || []).map(textKey));
  const out = { ...target };
  const copies = [], keys = new Set(), ids = new Set(), remap = new Map();
  const notes = [], genre = [], links = [], dlc = [];
  const notDup = new Set();
  for (const r of [target, ...sources]) {
    // A game's own title can name its edition: copies without one take it.
    const titled = kind === 'games' ? splitEdition(r.title).edition : '';
    for (const c0 of r.copies || []) {
      let c = { ...c0 };
      if (titled && !c.edition) c.edition = titled;
      if (c.edition && asSets.has(textKey(c.edition))) { c.set = c.set || c.edition; delete c.edition; }
      const k = copyKey(kind, c);
      if (keys.has(k)) { remap.set(`${r.id}:${c0.id}`, copies.find(x => copyKey(kind, x) === k).id); continue; }
      keys.add(k);
      const id = !c.id || ids.has(c.id) ? newCopyId() : c.id;
      ids.add(id); remap.set(`${r.id}:${c0.id}`, id);
      copies.push({ ...c, id });
    }
    if (r === target) continue;
    for (const k of ['year', 'posterUrl', 'coverUrl', 'tmdbId', 'blurb']) if ((out[k] == null || out[k] === '') && r[k] != null && r[k] !== '') out[k] = r[k];
    if ((r.seasonCount || 0) > (out.seasonCount || 0)) out.seasonCount = r.seasonCount;
    if ((r.rating || 0) > (out.rating || 0)) out.rating = r.rating;
    if (statusRank(kind, r.status) < statusRank(kind, out.status)) out.status = r.status;
  }
  for (const r of [target, ...sources]) {
    const n = String(r.notes || '').trim();
    if (n && !notes.includes(n)) notes.push(n);
    for (const g of r.genre || []) if (!genre.some(x => textKey(x) === textKey(g))) genre.push(g);
    for (const l of r.links || []) if (!links.some(x => (x.url || x) === (l.url || l))) links.push(l);
    for (const d of r.dlc || []) {
      const via = d.via ? remap.get(`${r.id}:${d.via}`) : '';
      const have = dlc.find(x => textKey(x.name) === textKey(d.name));
      if (!have) dlc.push({ name: d.name, owned: d.owned !== false, ...(via ? { via } : {}) });
      else { have.owned = have.owned || d.owned !== false; if (!have.via && via) have.via = via; }
    }
    (r.notDuplicateOf || []).forEach(id => notDup.add(Number(id)));
  }
  [target, ...sources].forEach(r => notDup.delete(r.id));
  out.copies = copies;
  out.notes = notes.join('\n\n');
  out.genre = genre;
  out.links = links;
  if (kind === 'games') { if (dlc.length) out.dlc = dlc; else delete out.dlc; }
  if (notDup.size) out.notDuplicateOf = [...notDup].sort((a, b) => a - b); else delete out.notDuplicateOf;
  // TV: per-copy seasons carry the title's; the normalizer rebuilds the union.
  if (kind === 'media') {
    if (copies.length) delete out.seasons;
    else out.seasons = [...new Set([target, ...sources].flatMap(r => r.seasons || []))].sort((a, b) => a - b);
  }
  delete out.platforms;
  return normalize(out);
}
