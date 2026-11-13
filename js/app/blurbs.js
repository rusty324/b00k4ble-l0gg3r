// blurbs.js — a short description of a book, film or show, or game, shown
// in its detail sheet (never on the card). Looked up the first time a
// sheet opens without one, then kept on the record:
//
//   Movies & TV  TMDb's overview, by the record's tmdbId or a title search
//                (needs the TMDb key from ⋯), else Wikipedia.
//   Books        Audible's summary when there is an ASIN, else the Open
//                Library work's description (by ISBN, or title and author),
//                else Wikipedia.
//   Games        Wikipedia — no game database answers a browser (see
//                scan-button.js), but Wikipedia's API does.
//
// Like a discovered cover, a found description is derived data any device
// can find again, so it is saved locally only (no sync commit, no "Last
// updated") and rides up with the next real edit. Removing one is a choice,
// so that is a real save and syncs. A lookup that finds nothing is not
// repeated for 30 days; "Find a description" asks again at once.

const BLURB_MAX = 700;
const BLURB_MISSES = 'blurbMisses';
const BLURB_RETRY = 30 * 864e5;

// ─── text ─────────────────────────────────────────────────────────────
// Plain text from HTML (Audible) or Open Library's markdown-ish
// descriptions, cut at a sentence near BLURB_MAX.
function cleanBlurb(raw) {
  let t = String(raw || '')
    .replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\n-{3,}[\s\S]*$/, '')                  // OL: "----------" then "Also contained in:" etc.
    .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')            // OL: [text][1]
    .replace(/^\s*\[\d+\]:\s*\S+\s*$/gm, '')          // OL: [1]: https://…
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')          // markdown [text](url)
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  if (t.length <= BLURB_MAX) return t;
  const cut = t.slice(0, BLURB_MAX);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > BLURB_MAX * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}

const blurbFound = (text, source, url = '') => {
  const t = cleanBlurb(text);
  return t.length >= 40 ? { text: t, source, url } : null;   // a stub is not a description
};

async function getJson(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  return res.json();
}

// ─── sources ──────────────────────────────────────────────────────────
// Wikipedia: search, then try the articles whose title (minus any "(film)"-
// style qualifier) is the record's, until one is the right kind of thing —
// its one-line description ("2020 video game", "1965 novel by Frank Herbert",
// "1980 film") must match `kind`. Without that, a game called Hades would get
// the article on the god.
async function wikipediaBlurb(title, hint, kind) {
  const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${title} ${hint}`.trim(),
    srlimit: '6', format: 'json', origin: '*' });
  const found = await getJson(`https://en.wikipedia.org/w/api.php?${q}`);
  const tk = dupTitleKey(title);
  const hits = ((found && found.query && found.query.search) || [])
    .filter(r => dupTitleKey(String(r.title).replace(/\s*\([^)]*\)\s*$/, '')) === tk).slice(0, 3);
  for (const hit of hits) {
    const page = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`);
    if (!page || page.type === 'disambiguation' || !kind.test(String(page.description || ''))) continue;
    const url = (page.content_urls && page.content_urls.desktop && page.content_urls.desktop.page) || '';
    const got = blurbFound(page.extract, 'Wikipedia', url);
    if (got) return got;
  }
  return null;
}

// What a Wikipedia article's one-line description must say, per kind.
const WIKI_KIND = {
  book: /\b(novel|novella|book|memoir|collection|anthology|play|poem|comic|manga)\b/i,
  movie: /\bfilm\b/i,
  tv: /\b(television|tv|series|miniseries|sitcom)\b/i,
  game: /\bgame\b/i,
};

async function tmdbBlurb(m) {
  if (!tmdbEnabled()) return null;
  const type = m.type === 'tv' ? 'tv' : 'movie';
  let id = m.tmdbId;
  if (id == null) {
    const tk = dupTitleKey(m.title);
    const hit = (await tmdbSearch(m.title)).find(r => r.type === type && dupTitleKey(r.title) === tk && (!m.year || !r.year || String(m.year) === r.year));
    id = hit && hit.tmdbId;
  }
  if (id == null) return null;
  const d = await getJson(tmdbUrl(`/${type}/${id}`, {}));
  return d ? blurbFound(d.overview, 'TMDb') : null;
}

async function olWorkDescription(workKey) {
  if (!/^\/works\/OL\d+W$/.test(workKey || '')) return null;
  const w = await getJson(`https://openlibrary.org${workKey}.json`);
  const d = w && w.description;
  return blurbFound(typeof d === 'string' ? d : d && d.value, 'Open Library');
}

async function bookBlurb(b) {
  if (bookAsin(b)) {
    try {
      const a = await audnexusFetch(bookAsin(b), audnexusRegion());
      const hit = a && blurbFound(a.summary || a.description, 'Audible');
      if (hit) return hit;
    } catch { /* rate limited or down: try the next source */ }
  }
  const isbn = [...bookIsbns(b)][0] || '';
  if (isbn) {
    const ed = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
    const hit = ed && ed.works && ed.works[0] && await olWorkDescription(ed.works[0].key);
    if (hit) return hit;
  }
  const q = new URLSearchParams({ title: b.title, ...(b.author ? { author: b.author } : {}), fields: 'key,title,author_name', limit: '5' });
  const s = await getJson(`${OPENLIBRARY_SEARCH_URL}?${q}`);
  const tk = dupTitleKey(b.title);
  const doc = ((s && s.docs) || []).find(d => dupTitleKey(d.title) === tk && namesAgree(b.author, (d.author_name || [])[0]));
  const hit = doc && await olWorkDescription(doc.key);
  return hit || wikipediaBlurb(b.title, [b.author, 'novel'].filter(Boolean).join(' '), WIKI_KIND.book);
}

const BLURB_FIND = {
  books: bookBlurb,
  media: async m => (await tmdbBlurb(m)) ||
    wikipediaBlurb(m.title, [m.year, m.type === 'tv' ? 'TV series' : 'film'].filter(Boolean).join(' '),
      m.type === 'tv' ? WIKI_KIND.tv : WIKI_KIND.movie),
  games: g => wikipediaBlurb(g.title, 'video game', WIKI_KIND.game),
};

// ─── storing ──────────────────────────────────────────────────────────
const BLURB_SAVE_LOCAL = {
  books: () => saveLocal(),
  media: () => localStorage.setItem('mediaLibrary', JSON.stringify(mediaLibrary)),
  games: () => localStorage.setItem('videoGames', JSON.stringify(videoGames)),
};
const BLURB_SAVE = { books: () => save(), media: () => saveMedia(), games: () => saveGames() };
const BLURB_NORMALIZE = { books: normalizeBook, media: normalizeMediaItem, games: normalizeVideoGame };

function setBlurb(kind, id, fields, persist) {
  const arr = collectionArray(kind);
  const i = arr.findIndex(r => r.id === id);
  if (i === -1) return;
  const next = { ...arr[i], ...fields };
  for (const k of ['blurb', 'blurbSource', 'blurbUrl']) if (next[k] === undefined || next[k] === '') delete next[k];
  arr[i] = BLURB_NORMALIZE[kind](next);
  persist[kind]();
}

// Fields to spread into an edited record: a retitled record's description
// was found for its old title, so it goes (and is looked up afresh).
const renamedBlurb = (rec, title) => dupTitleKey(rec.title) === dupTitleKey(title) ? {}
  : { blurb: undefined, blurbSource: undefined, blurbUrl: undefined };

const blurbMisses = () => { try { return JSON.parse(localStorage.getItem(BLURB_MISSES)) || {}; } catch { return {}; } };
function noteBlurbMiss(kind, id, missed) {
  const m = blurbMisses();
  if (missed) m[`${kind}:${id}`] = Date.now(); else delete m[`${kind}:${id}`];
  try { localStorage.setItem(BLURB_MISSES, JSON.stringify(m)); } catch { /* asked again next time; fine */ }
}

// ─── the detail sheet's section ───────────────────────────────────────
const _blurbAsking = new Set();

function blurbSectionHtml(kind, rec) {
  if (rec.blurb) {
    const src = rec.blurbUrl
      ? `<a href="${esc(rec.blurbUrl)}" target="_blank" rel="noopener">${esc(rec.blurbSource || 'source')}</a>`
      : esc(rec.blurbSource || '');
    return `<div class="detail-blurb-text" id="blurbText">${esc(rec.blurb)}</div>
      <div class="detail-blurb-meta">
        <button type="button" class="text-btn" id="blurbMore" hidden onclick="toggleBlurb()">More</button>
        ${src ? `<span>From ${src}</span>` : ''}
        <button type="button" class="text-btn" onclick="removeBlurb()">Remove</button>
      </div>`;
  }
  if (_blurbAsking.has(`${kind}:${rec.id}`)) return `<div class="muted detail-blurb-wait">Looking for a description…</div>`;
  return `<button type="button" class="text-btn" onclick="findBlurb(true)">Find a description</button>`;
}

// Fills the sheet's description section (called by openDetail), and looks
// one up when there is none yet — unless it was removed, or found nothing
// within the last month.
function paintBlurb(kind, rec) {
  if (!BLURB_FIND[kind]) return;
  paintBlurbOnly(kind, rec);
  const missed = blurbMisses()[`${kind}:${rec.id}`];
  if (!rec.blurb && rec.blurbSource !== 'none' && !(missed && Date.now() - missed < BLURB_RETRY)) findBlurb(false);
}

async function findBlurb(asked) {
  if (!_detail) return;
  const { kind, id } = _detail;
  const key = `${kind}:${id}`;
  const rec = collectionArray(kind).find(r => r.id === id);
  if (!rec || _blurbAsking.has(key) || !navigator.onLine) return;
  _blurbAsking.add(key);
  const still = () => _detail && _detail.kind === kind && _detail.id === id;
  if (still()) paintBlurbOnly(kind, rec);
  let hit = null;
  try { hit = await BLURB_FIND[kind](rec); } catch { hit = null; }
  _blurbAsking.delete(key);
  noteBlurbMiss(kind, id, !hit);
  // Found unasked, it is derived data (saved here only); asked for — after a
  // Remove, say — it is a choice, and syncs like one.
  if (hit) setBlurb(kind, id, { blurb: hit.text, blurbSource: hit.source, blurbUrl: hit.url }, asked ? BLURB_SAVE : BLURB_SAVE_LOCAL);
  const now = collectionArray(kind).find(r => r.id === id);
  if (still() && now) {
    paintBlurbOnly(kind, now);
    if (!hit && asked) flashBanner('No description found for this one.');
  }
}

// Repaint without starting another lookup. "More" shows only when the
// clamp actually hides something.
function paintBlurbOnly(kind, rec) {
  const box = document.getElementById('detailBlurb');
  if (!box) return;
  box.innerHTML = blurbSectionHtml(kind, rec);
  const text = document.getElementById('blurbText'), more = document.getElementById('blurbMore');
  if (text && more && text.scrollHeight > text.clientHeight + 2) more.hidden = false;
}

function toggleBlurb() {
  const text = document.getElementById('blurbText');
  if (!text) return;
  const open = text.classList.toggle('open');
  document.getElementById('blurbMore').textContent = open ? 'Less' : 'More';
}

// A wrong match, or just not wanted: removed for good on every device, until
// "Find a description" is pressed.
function removeBlurb() {
  if (!_detail) return;
  const { kind, id } = _detail;
  setBlurb(kind, id, { blurb: undefined, blurbUrl: undefined, blurbSource: 'none' }, BLURB_SAVE);
  paintBlurbOnly(kind, collectionArray(kind).find(r => r.id === id));
}
