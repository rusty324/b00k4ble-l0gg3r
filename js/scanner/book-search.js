// book-search.js — the book form's lookup field: title/ISBN search
// against Open Library, and ASIN lookup against Audible/Audnexus.
// Split out of scanner.js.

// ─── OPEN LIBRARY SEARCH (book form) ──────────────────────────────────
// Keyless and CORS-enabled, so unlike the TMDb box this needs no setup.
// StoryGraph has no public API — every "storygraph-api" project is a scraper,
// which cannot run from a browser — so Open Library is the source here.

let _olResults = [];
let _olIndex   = -1;
let _olTimer   = null;
let _olSeq     = 0;

function olHint(msg, isError) {
  const el = document.getElementById('olHint');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hint-error', !!isError);
}

function closeOlAC() {
  const ac = document.getElementById('ol-ac');
  if (ac) ac.style.display = 'none';
  _olIndex = -1;
}

function isIsbnQuery(q) {
  const d = String(q).replace(/[^0-9Xx]/g, '');
  return (d.length === 10 || d.length === 13) && /^\d{9}[\dXx]$|^\d{13}$/.test(d);
}

// Audnexus validates ids as /B[\dA-Z]{9}|\d{9}(X|\d)/ — both forms Amazon
// uses for books. The second is an ISBN-10 serving as the product id, which
// is why a real Audible link can read .../pd/0593343050 with no B in sight.
const AUDIBLE_ID   = /^(?:B[0-9A-Z]{9}|\d{9}[\dX])$/i;
// A B-prefixed id is never an ISBN, so it needs no second opinion.
const AUDIBLE_ONLY = /^B[0-9A-Z]{9}$/i;

function bareId(q) {
  return String(q).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

// Audible share links carry the id in the path, sometimes behind a title
// slug (/pd/Dune-Audiobook/B0036I54I6) and sometimes not (/pd/0593343050),
// with tracking parameters after it. Pulling it out beats making the user
// find it themselves.
function asinFromUrl(q) {
  let u;
  try { u = new URL(String(q).trim()); } catch { return null; }
  if (!/(?:^|\.)(?:audible|amazon)\.[a-z.]+$/i.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (AUDIBLE_ID.test(segs[i])) return segs[i].toUpperCase();
  }
  return null;
}

// Does this query reach Audible at all — on its own or alongside Open Library.
function isAsinQuery(q) {
  return !!asinFromUrl(q) || AUDIBLE_ID.test(bareId(q));
}

// Ten digits could be either a print ISBN or an Audible product id, and
// nothing about the number says which.
function isAmbiguousId(q) {
  return !asinFromUrl(q) && AUDIBLE_ID.test(bareId(q)) && !AUDIBLE_ONLY.test(bareId(q));
}

// Catalogues are per-region and an ASIN in one is usually absent from the
// others, so guess from the browser's locale rather than asking.
const AUDNEXUS_REGIONS = { GB: 'uk', CA: 'ca', AU: 'au', DE: 'de', FR: 'fr',
  JP: 'jp', IT: 'it', IN: 'in', ES: 'es', BR: 'br', US: 'us' };

function audnexusRegion() {
  const loc = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  const country = (String(loc).split('-')[1] || '').toUpperCase();
  return AUDNEXUS_REGIONS[country] || 'us';
}

async function audnexusFetch(asin, region) {
  const res = await fetchWithTimeout(`${AUDNEXUS_BOOK_URL}/${encodeURIComponent(asin)}?region=${region}`);
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('Audible lookups are rate limited right now — try again in a minute.');
  if (!res.ok) throw new Error(`Audnexus error (HTTP ${res.status})`);
  return res.json();
}

// The app's series field is "Name #N", and Audnexus splits the two.
function audnexusSeries(book) {
  const s = book.seriesPrimary;
  if (!s || !s.name) return '';
  return s.position ? `${s.name} #${String(s.position).replace(/^Book\s*/i, '')}` : s.name;
}

async function lookupASIN(raw) {
  const asin = String(raw).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const region = audnexusRegion();
  let book = await audnexusFetch(asin, region);
  // Not in the local catalogue: US is much the largest, so it is worth one
  // more request before reporting nothing.
  if (!book && region !== 'us') book = await audnexusFetch(asin, 'us');
  if (!book) return null;

  const authors = (book.authors || []).map(a => a.name).filter(Boolean);
  return {
    source: 'audible',
    title: String(book.title || ''),
    author: authors.join(', '),
    narrator: (book.narrators || []).map(n => n.name).filter(Boolean).join(', '),
    year: book.releaseDate ? String(book.releaseDate).slice(0, 4) : '',
    coverUrl: book.image || '',
    isbn: book.isbn || '',
    asin: book.asin || asin,
    series: audnexusSeries(book),
  };
}

// A bare 10/13-digit query is an ISBN, so look it up directly rather than
// treating the digits as a title.
async function olSearch(query) {
  const q = query.trim();
  if (!q) return [];

  const fromUrl = asinFromUrl(q);
  const id = fromUrl || (AUDIBLE_ID.test(bareId(q)) ? bareId(q) : null);

  // A pasted link, or a B-prefixed id: Audible is the only thing it can mean.
  if (id && (fromUrl || AUDIBLE_ONLY.test(id))) {
    const book = await lookupASIN(id);
    return book ? [book] : [];
  }

  // ISBN-10 shaped: ask both and let the badges tell them apart. allSettled,
  // so one service being down cannot hide the other's answer.
  if (id) {
    const [aud, ol] = await Promise.allSettled([lookupASIN(id), lookupISBN(id)]);
    const out = [];
    if (aud.status === 'fulfilled' && aud.value) out.push(aud.value);
    if (ol.status === 'fulfilled' && ol.value) out.push({
      source: 'ol', title: ol.value.title, author: ol.value.author, year: '',
      coverUrl: ol.value.coverUrl || '', isbn: id,
    });
    if (out.length) return out;
    if (aud.status === 'rejected' && ol.status === 'rejected') throw aud.reason;
    return [];
  }

  if (isIsbnQuery(q)) {
    const isbn = q.replace(/[^0-9Xx]/g, '');
    const info = await lookupISBN(isbn);
    return info ? [{
      source: 'ol', title: info.title, author: info.author, year: '',
      coverUrl: info.coverUrl || '', isbn,
    }] : [];
  }

  const params = new URLSearchParams({
    q, limit: '8',
    fields: 'key,title,author_name,first_publish_year,cover_i,isbn',
  });
  const res = await fetchWithTimeout(`${OPENLIBRARY_SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`Open Library error (HTTP ${res.status})`);
  const data = await res.json();

  const mapped = (data.docs || []).map(d => ({
    source: 'ol',
    title: String(d.title || ''),
    author: (d.author_name || [])[0] || '',
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
    isbn: (d.isbn || [])[0] || '',
  })).filter(d => d.title);

  // Same short-title problem TMDb has: promote an exact match.
  const nq = normalizeTitle(q);
  return mapped
    .map((r, i) => {
      const t = normalizeTitle(r.title);
      let score = (t === nq ? 10 : t.startsWith(nq) ? 2 : 0);
      score += titleSimilarity(nq, t) * 2 + Math.max(0, 1 - i * 0.05);
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.r);
}

function olAC() {
  const input = document.getElementById('f-ol');
  const query = input.value.trim();
  clearTimeout(_olTimer);
  if (query.length < 2) { closeOlAC(); olHint(''); return; }

  _olTimer = setTimeout(async () => {
    const seq = ++_olSeq;
    olHint(isAmbiguousId(query) ? 'Looking up on Audible and Open Library…'
         : isAsinQuery(query)     ? 'Looking up ASIN on Audible…'
         : isIsbnQuery(query)     ? 'Looking up ISBN…'
         : 'Searching…');
    try {
      const results = await olSearch(query);
      if (seq !== _olSeq) return;          // a newer keystroke already won
      _olResults = results;
      renderOlAC();
      olHint(results.length ? ''
        : isAmbiguousId(query) ? 'Not found on Audible or Open Library.'
        : isAsinQuery(query) ? `No Audible book with that ASIN (tried ${audnexusRegion()}${audnexusRegion() === 'us' ? '' : ' and us'}).`
        : 'No matches on Open Library.');
    } catch (err) {
      if (seq !== _olSeq) return;
      closeOlAC();
      olHint(err.message || 'Lookup failed.', true);
    }
  }, 350);   // Open Library throttles anonymous callers at ~1 req/sec
}

function renderOlAC() {
  const ac = document.getElementById('ol-ac');
  if (!ac) return;
  if (!_olResults.length) { closeOlAC(); return; }
  _olIndex = -1;
  ac.innerHTML = _olResults.map((r, i) => `
    <div class="ac-item tmdb-item" data-i="${i}" onmousedown="olPick(${i})">
      ${r.coverUrl
        ? `<img class="tmdb-thumb" src="${esc(r.coverUrl)}" alt="" loading="lazy">`
        : `<div class="tmdb-thumb tmdb-thumb-empty">📚</div>`}
      <div class="tmdb-meta">
        <div class="tmdb-title">${esc(r.title)}${r.source === 'audible' ? ' <span class="src-badge">Audible</span>' : ''}</div>
        <div class="tmdb-sub">${[r.author, r.year].filter(Boolean).map(esc).join(' · ')}</div>
        ${r.narrator ? `<div class="tmdb-sub">Read by ${esc(r.narrator)}</div>` : ''}
      </div>
    </div>`).join('');
  ac.style.display = 'block';
}

function olACKey(e) {
  const ac = document.getElementById('ol-ac');
  if (!ac || ac.style.display === 'none') return;
  const items = [...ac.querySelectorAll('.ac-item')];
  if (!items.length) return;

  if (e.key === 'ArrowDown') { e.preventDefault(); _olIndex = Math.min(_olIndex + 1, items.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _olIndex = Math.max(_olIndex - 1, 0); }
  else if (e.key === 'Enter' && _olIndex >= 0) { e.preventDefault(); olPick(_olIndex); return; }
  else if (e.key === 'Escape') { closeOlAC(); return; }
  else return;
  items.forEach((el, i) => el.classList.toggle('ac-active', i === _olIndex));
  if (items[_olIndex]) items[_olIndex].scrollIntoView({ block: 'nearest' });
}

function olPick(i) {
  const r = _olResults[i];
  if (!r) return;
  document.getElementById('f-title').value  = r.title;
  document.getElementById('f-author').value = r.author || '';
  if (r.coverUrl) document.getElementById('f-coverUrl').value = r.coverUrl;
  if (r.isbn)     document.getElementById('f-isbn').value = r.isbn;
  if (r.asin)     document.getElementById('f-asin').value = r.asin;
  if (r.series)   setSeriesFields(r.series);

  if (r.source === 'audible') {
    // An Audible result is an audiobook by definition, and its ASIN is
    // enough to build the ownership link — both land in visible fields the
    // user can undo before saving, rather than being applied at save time.
    tickFormat('audio');
    const links = document.getElementById('f-links');
    if (links && !links.value.trim() && r.asin) {
      links.value = `https://www.audible.com/pd/${r.asin}`;
      previewLinks('f');
    }
  }

  closeOlAC();
  document.getElementById('f-ol').value = '';
  olHint(`Filled from ${r.source === 'audible' ? 'Audible' : 'Open Library'}: ${r.title}${r.year ? ' (' + r.year + ')' : ''}`);
}



