// next-reads.js — "What to read next": the Books tab's unread books (status
// Want to read), in an order to choose from.
//
//   For you            scored against what was read most recently: the next
//                      book in a series being read, then the same author,
//                      then shared genres — recent reads count most, and
//                      well-rated ones more than poorly-rated ones. Each book
//                      says why it is there.
//   Next in series     only books that continue a series already started.
//   Waiting longest    oldest added first.   Recently added   newest first.
//   Oldest / Newest published   by `published`, the year the book first came
//                      out. Books with no year go last, and the sheet offers
//                      to look the years up on Open Library.
//
// A format filter narrows any of them to physical, e-book or audiobook. The
// chosen order and format are remembered on this device only.

const NEXT_SORTS = [
  ['foryou', 'For you'], ['series', 'Next in series'], ['waiting', 'Waiting longest'],
  ['recent', 'Recently added'], ['oldpub', 'Oldest published'], ['newpub', 'Newest published'],
];
const NEXT_FORMATS = [['all', 'All'], ['physical', '📚 Physical'], ['ebook', '📱 E-book'], ['audio', '🎧 Audio']];
const NEXT_PAGE = 25;
const NEXT_PREF = 'nextReadsPrefs';

const _next = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(NEXT_PREF)) || {}; } catch { /* first visit */ }
  return {
    sort: NEXT_SORTS.some(([v]) => v === saved.sort) ? saved.sort : 'foryou',
    format: NEXT_FORMATS.some(([v]) => v === saved.format) ? saved.format : 'all',
    shown: NEXT_PAGE,
  };
})();

const unreadBooks = () => books.filter(b => b.status === 'want');

// "Mar 2024", from an id that is a timestamp; '' for one that is not.
const addedMonth = id => {
  const t = idAsTime(id);
  return t === null ? '' : new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
const yearsAgo = y => { const n = new Date().getFullYear() - Number(y); return n <= 0 ? 'this year' : n === 1 ? 'a year ago' : `${n} years ago`; };

// ─── what was read most recently ──────────────────────────────────────
// Up to 12 Read books, most recent first: by finished month where there is
// one, then by when they were added. Each weighs less the further back it
// is, and its rating scales it (5★ counts for more than 1★; unrated is 3★).
function recentReads() {
  return books.filter(b => b.status === 'read')
    .sort((a, b) => (b.finished || '').localeCompare(a.finished || '') || b.id - a.id)
    .slice(0, 12)
    .map((b, i) => ({ b, w: Math.pow(0.85, i) * ((b.rating || 3) / 3) }));
}

// ─── series ───────────────────────────────────────────────────────────
// For each series (by seriesKey), the numbers read and every owned book.
function seriesIndex() {
  const idx = new Map();
  for (const b of books) {
    const { name, number } = splitSeries(b.series);
    const nums = seriesNumbers(number);
    if (!name || !nums.length) continue;
    const k = seriesKey(name);
    if (!idx.has(k)) idx.set(k, { read: [], owned: [] });
    const s = idx.get(k);
    s.owned.push({ b, nums });
    if (b.status === 'read') s.read.push({ b, nums });
  }
  return idx;
}

// Whether an earlier book of `b`'s series is owned and still unread — then
// that one comes first, and `b` is not one to start now.
function laterInSeries(b, idx) {
  const { name, number } = splitSeries(b.series);
  const nums = seriesNumbers(number);
  const s = name && nums.length ? idx.get(seriesKey(name)) : null;
  if (!s) return false;
  const first = Math.min(...nums);
  return s.owned.some(o => o.b !== b && o.b.status !== 'read' && Math.min(...o.nums) < first);
}

// Whether `b` continues a series already started: something in it has been
// read, and every owned book numbered before it has been read too. -> the
// read book just before it, and any numbers between them that are not owned.
function nextInSeries(b, idx, spellings) {
  const { name, number } = splitSeries(b.series);
  const nums = seriesNumbers(number);
  if (!name || !nums.length) return null;
  const s = idx.get(seriesKey(name));
  if (!s || !s.read.length) return null;
  const first = Math.min(...nums);
  if (s.owned.some(o => o.b !== b && o.b.status !== 'read' && Math.min(...o.nums) < first)) return null;
  const before = s.read.filter(r => Math.max(...r.nums) < first);
  if (!before.length) return null;
  const last = before.reduce((a, r) => (Math.max(...r.nums) > Math.max(...a.nums) ? r : a));
  const lastNum = Math.max(...last.nums);
  const owned = new Set(s.owned.flatMap(o => o.nums));
  const missing = [];
  for (let n = Math.floor(lastNum) + 1; n < first; n++) if (!owned.has(n)) missing.push(n);
  return { name: spellings.get(seriesKey(name)) || name, last: last.b, lastNum, missing };
}

function seriesReason(n) {
  const when = n.last.finished ? ` (${finishedLabel(n.last.finished)})` : '';
  const gap = n.missing.length ? ` · you don't have ${compressRanges(n.missing, '#')}` : '';
  return `Next in ${n.name} — you read #${n.lastNum}${when}${gap}`;
}

// ─── ranking ──────────────────────────────────────────────────────────
// -> [{ b, reason }] for the sheet's current order and format.
function nextReads(sort = _next.sort, format = _next.format) {
  const pool = unreadBooks().filter(b => format === 'all' || (b.formats || []).includes(format));
  const idx = seriesIndex();
  const spellings = seriesSpellings();
  const added = b => { const m = addedMonth(b.id); return m ? `Added ${m}` : 'Added before dates were kept'; };

  if (sort === 'series') {
    return pool.map(b => ({ b, n: nextInSeries(b, idx, spellings) })).filter(x => x.n)
      .sort((x, y) => (y.n.last.finished || '').localeCompare(x.n.last.finished || '') || y.n.last.id - x.n.last.id)
      .map(x => ({ b: x.b, reason: seriesReason(x.n) }));
  }
  if (sort === 'waiting' || sort === 'recent') {
    const dir = sort === 'waiting' ? 1 : -1;
    return [...pool].sort((a, c) => dir * (a.id - c.id)).map(b => ({ b, reason: added(b) }));
  }
  if (sort === 'oldpub' || sort === 'newpub') {
    const dir = sort === 'oldpub' ? 1 : -1;
    return [...pool].sort((a, c) => (!a.published) - (!c.published) || dir * (Number(a.published) - Number(c.published)) || a.id - c.id)
      .map(b => ({ b, reason: b.published ? `First published ${b.published} · ${yearsAgo(b.published)}` : 'No publication year yet' }));
  }

  // For you.
  const recent = recentReads();
  const scored = pool.map(b => {
    const n = nextInSeries(b, idx, spellings);
    // Every match adds to the score; the reason given is the most telling
    // kind there is — a series beats an author beats a genre — and within a
    // kind, the strongest.
    let score = 0;
    const why = { series: [0, ''], author: [0, ''], genre: [0, ''] };
    const take = (kind, s, text) => { score += s; if (s > why[kind][0]) why[kind] = [s, text]; };
    if (n) {
      const r = recent.find(x => x.b === n.last);
      take('series', 3 + (r ? 2 * r.w : 0), seriesReason(n));
    }
    const ak = dupAuthorKey(b.author);
    const genres = new Set((b.genre || []).map(textKey));
    for (const { b: r, w } of recent) {
      const when = r.finished ? ` (read ${finishedLabel(r.finished)})` : '';
      if (ak && dupAuthorKey(r.author) === ak) take('author', 1.5 * w, `By ${b.author}, like ${r.title}${when}`);
      const rg = (r.genre || []).map(textKey);
      const shared = rg.filter(g => genres.has(g));
      if (shared.length) {
        const union = new Set([...genres, ...rg]).size;
        const names = (b.genre || []).filter(g => shared.includes(textKey(g))).slice(0, 2).join(', ');
        take('genre', 2 * w * shared.length / union, `${names} — like ${r.title}${when}`);
      }
    }
    // #3 while #2 sits unread is not what to start next, however well it scores.
    if (laterInSeries(b, idx)) score *= 0.1;
    return { b, score, reason: why.series[1] || why.author[1] || why.genre[1] || added(b) };
  });
  // Unscored books follow, longest-waiting first.
  return scored.sort((x, y) => y.score - x.score || x.b.id - y.b.id).map(({ b, reason }) => ({ b, reason }));
}

// ─── the sheet ────────────────────────────────────────────────────────
function nextReadsButton() {
  return unreadBooks().length
    ? `<button type="button" class="btn btn-sm next-btn" onclick="openNextReads()">📖 What to read next</button>` : '';
}

function nextRow({ b, reason }) {
  const cover = b.coverUrl || (_coverCache[b.id] && !['none', 'pending'].includes(_coverCache[b.id]) ? _coverCache[b.id] : '');
  const icons = { physical: '📚', ebook: '📱', audio: '🎧' };
  return `<button type="button" class="next-item" onclick="openDetail('books', ${b.id})">
      ${cover ? `<img class="next-thumb" src="${esc(cover)}" alt="" loading="lazy">`
              : `<span class="next-thumb next-thumb-none" aria-hidden="true">${esc((b.title || '?')[0].toUpperCase())}</span>`}
      <span class="next-text">
        <span class="missing-name">${esc(b.title)}</span>
        ${b.author ? `<span class="next-author">${esc(b.author)}${b.series ? ` · ${esc(b.series)}` : ''}</span>` : ''}
        <span class="next-reason">${esc(reason)}</span>
      </span>
      <span class="next-formats" aria-hidden="true">${(b.formats || []).map(f => icons[f] || '').join('')}</span>
    </button>`;
}

function pills(list, current, fn) {
  return list.map(([v, l]) => `<button type="button" class="pill${current === v ? ' active' : ''}" onclick="${fn}('${v}')">${l}</button>`).join('');
}

function paintNextReads() {
  const body = document.getElementById('nextBody');
  if (!body) return;
  const list = nextReads();
  const total = unreadBooks().length;
  const empty = {
    series: 'No unread book continues a series you have started.',
    foryou: 'No unread books in this format.',
  }[_next.sort] || 'No unread books in this format.';
  const noRecent = _next.sort === 'foryou' && !books.some(b => b.status === 'read');
  body.innerHTML = `
    <div class="modal-title" id="nextTitle">What to read next</div>
    <p class="dupes-intro">From your ${total} unread book${total === 1 ? '' : 's'}${noRecent
      ? '. Mark books as Read to get suggestions based on them; until then, longest-waiting first.' : '.'}</p>
    <div class="filter-row"><span class="filter-label">Order</span><div class="pill-group">${pills(NEXT_SORTS, _next.sort, 'setNextSort')}</div></div>
    <div class="filter-row"><span class="filter-label">Format</span><div class="pill-group">${pills(NEXT_FORMATS, _next.format, 'setNextFormat')}</div></div>
    ${yearNote()}
    <div class="next-list">${list.length ? list.slice(0, _next.shown).map(nextRow).join('') : `<p class="muted">${esc(empty)}</p>`}</div>
    ${list.length > _next.shown ? `<button type="button" class="btn btn-sm next-more" onclick="showMoreNext()">Show ${Math.min(NEXT_PAGE, list.length - _next.shown)} more</button>` : ''}
    <div class="detail-actions"><span class="detail-spacer"></span>
      <button type="button" class="btn" onclick="closeNextReads()">Close</button></div>`;
}

function openNextReads() {
  _next.shown = NEXT_PAGE;
  paintNextReads();
  document.getElementById('nextModal').classList.add('open');
}

function closeNextReads() { document.getElementById('nextModal')?.classList.remove('open'); }

// Called by render(): a book edited, read or deleted from its detail sheet
// should not linger in the list underneath it.
function paintNextReadsIfOpen() {
  if (document.getElementById('nextModal')?.classList.contains('open')) paintNextReads();
}

function handleNextBackdrop(e) {
  if (e.target === document.getElementById('nextModal')) closeNextReads();
}

function rememberNext() {
  try { localStorage.setItem(NEXT_PREF, JSON.stringify({ sort: _next.sort, format: _next.format })); } catch { /* not kept; fine */ }
}
function setNextSort(v) { _next.sort = v; _next.shown = NEXT_PAGE; rememberNext(); paintNextReads(); }
function setNextFormat(v) { _next.format = v; _next.shown = NEXT_PAGE; rememberNext(); paintNextReads(); }
function showMoreNext() { _next.shown += NEXT_PAGE; paintNextReads(); }

// ─── looking up publication years ─────────────────────────────────────
// Unread books with no year, for the two "published" orders. One Open
// Library request at a time, about a second apart — it throttles anonymous
// callers — saving as it goes, and cancellable. A book Open Library cannot
// place is remembered, so it is not asked about again.
const YEAR_MISSES = 'publishedLookupMisses';
const _years = { running: false, done: 0, total: 0, found: 0, stop: false, error: '' };

function yearMisses() {
  try { return JSON.parse(localStorage.getItem(YEAR_MISSES)) || {}; } catch { return {}; }
}
const yearless = () => { const miss = yearMisses(); return unreadBooks().filter(b => !b.published && !miss[b.id]); };

// Shown above the two "published" orders: progress while looking up, else
// how many have no year and the button to look them up.
function yearNoteText() {
  if (_years.running) {
    return `Looking up publication years… ${_years.done} of ${_years.total} (${_years.found} found)
      <button type="button" class="btn btn-sm" onclick="cancelYearLookup()">Stop</button>`;
  }
  const n = yearless().length;
  const msg = _years.error ? `<span class="next-years-err">${esc(_years.error)}</span> ` : '';
  if (!n) return msg;
  return `${msg}${n} unread book${n === 1 ? ' has' : 's have'} no publication year.
    <button type="button" class="btn btn-sm" onclick="lookupPublishedYears()">Look them up</button>`;
}

function yearNote() {
  if (_next.sort !== 'oldpub' && _next.sort !== 'newpub') return '';
  const text = yearNoteText();
  return text ? `<div class="next-years" id="nextYears">${text}</div>` : '';
}

async function lookupPublishedYear(b) {
  const ask = async params => {
    const q = new URLSearchParams({ ...params, fields: 'title,author_name,first_publish_year', limit: '5' });
    const res = await fetchWithTimeout(`${OPENLIBRARY_SEARCH_URL}?${q}`);
    if (!res.ok) throw new Error(`Open Library answered HTTP ${res.status}`);
    return (await res.json()).docs || [];
  };
  const isbn = dupIsbn(b);
  if (isbn) {
    const doc = (await ask({ isbn }))[0];
    if (doc && doc.first_publish_year) return normalizePublished(doc.first_publish_year);
  }
  const tk = dupTitleKey(b.title);
  const docs = await ask(b.author ? { title: b.title, author: b.author } : { title: b.title });
  const doc = docs.find(d => dupTitleKey(d.title) === tk && namesAgree(b.author, (d.author_name || [])[0]) && d.first_publish_year);
  return doc ? normalizePublished(doc.first_publish_year) : '';
}

const pause = ms => new Promise(r => setTimeout(r, ms));

async function lookupPublishedYears() {
  if (_years.running) return;
  const queue = yearless();
  Object.assign(_years, { running: true, done: 0, total: queue.length, found: 0, stop: false, error: '' });
  paintNextReadsIfOpen();
  const miss = yearMisses();
  let unsaved = 0;
  for (const b of queue) {
    if (_years.stop) break;
    try {
      const y = await lookupPublishedYear(b);
      const i = books.findIndex(x => x.id === b.id);
      if (y && i !== -1 && !books[i].published) {
        books[i] = normalizeBook({ ...books[i], published: y });
        _years.found++; unsaved++;
      } else if (!y) {
        miss[b.id] = Date.now();
      }
    } catch (e) {
      _years.error = `Stopped: ${e.message || 'Open Library did not answer'}.`;
      break;
    }
    _years.done++;
    if (unsaved >= 10) { save(); unsaved = 0; }
    const note = document.getElementById('nextYears');
    if (note) note.innerHTML = yearNoteText();
    if (_years.done < queue.length && !_years.stop) await pause(1000);
  }
  try { localStorage.setItem(YEAR_MISSES, JSON.stringify(miss)); } catch { /* asked again next time; fine */ }
  if (unsaved) save();
  _years.running = false;
  if (!_years.error) flashBanner(`Found ${_years.found} publication year${_years.found === 1 ? '' : 's'}.`);
  render();
  paintNextReadsIfOpen();
}

function cancelYearLookup() { _years.stop = true; }

// Escape closes the sheet — unless a book's details (or a cover) are open on
// top of it, whose own Escape comes first. On window, in the capture phase,
// so it runs before the detail sheet's handler has closed itself.
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !document.getElementById('nextModal')?.classList.contains('open')) return;
  if (document.getElementById('detailModal')?.classList.contains('open') ||
      document.getElementById('lightbox')?.classList.contains('open') ||
      document.getElementById('modal')?.classList.contains('open')) return;
  closeNextReads();
}, true);
