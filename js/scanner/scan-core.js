// scan-core.js — barcode-scanning fundamentals: config constants,
// scanner state, EAN-13 checksum math, the lookup cache, and
// ISBN metadata lookup (Open Library / Google Books). Split out of
// scanner.js; loaded first.

// ─── CONFIGURATION ────────────────────────────────────────────────────
// Polyfill of the native BarcodeDetector API backed by ZXing-C++/WASM.
// Native support is absent on Firefox and Chrome/Windows+Linux, and is
// flag-gated and broken on iOS Safari, so the WASM path is the norm.
// NB: the package ships polyfill.js but no polyfill.min.js — the .min path
// only resolves via jsDelivr's on-the-fly minification and 404s elsewhere.
const SCAN_POLYFILL_URL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/polyfill.js';
const OPENLIBRARY_ISBN_URL = 'https://openlibrary.org/api/books';
const GOOGLE_BOOKS_URL     = 'https://www.googleapis.com/books/v1/volumes';
// Discs are identified from a photo of the cover, not a barcode: no free,
// CORS-enabled UPC→title database exists (UPCitemdb sends no
// Access-Control-Allow-Origin). Gemini reads the artwork; TMDb verifies it.
const GEMINI_API_BASE    = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_KEY_STORE   = 'geminiKey';
// Which models a key can reach varies by account, project and region, so the
// model is discovered from the key rather than hardcoded — a fixed id 404s
// for anyone whose account does not carry it.
const GEMINI_MODEL_STORE = 'geminiModel';
// Bumped when the ranking rules change, so a model chosen by older, worse
// rules is re-resolved once instead of being trusted forever.
const GEMINI_RESOLVER_VERSION = 2;
const GEMINI_RESOLVER_STORE   = 'geminiModelRules';
const GEMINI_MAX_EDGE  = 768;   // keeps a photo at exactly 258 image tokens
const IDENTIFY_MAX_QUERIES = 4; // parallel TMDb verifications per capture
// Open Library throttles anonymous callers at ~1 req/sec and 429s readily, so
// book verification runs fewer queries, sequentially.
const IDENTIFY_MAX_BOOK_QUERIES = 2;
const OPENLIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';

// Audible has no public API. Audnexus is the community aggregator that
// Audiobookshelf uses: it normalizes Audible's own data and, unlike Audible,
// serves CORS headers for any origin, so a static page can call it. Keyless,
// and rate-limited at 100 requests a minute — far looser than Open Library.
// ASIN lookup only; it has no title search, which is why Open Library still
// handles everything that is not an ASIN.
const AUDNEXUS_BOOK_URL = 'https://api.audnex.us/books';

// TMDb has no barcode and no image lookup, so it is used for title search:
// to verify what the vision model reports and to fill in the details.
// The key lives in localStorage, never in this repo: TMDb has no referrer or
// domain restriction, so a committed key is usable by anyone who finds it.
const TMDB_API_BASE    = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE    = 'https://image.tmdb.org/t/p/w342';
const TMDB_KEY_STORE   = 'tmdbKey';
const TMDB_GENRE_STORE = 'tmdbGenres';
const TMDB_GENRE_TTL   = 30 * 24 * 3600 * 1000;

const SCAN_CACHE_KEY   = 'scanCache';
const SCAN_HIT_TTL     = 30 * 24 * 3600 * 1000;  // 30 days
const SCAN_MISS_TTL    =      24 * 3600 * 1000;  // 1 day
const SCAN_CONFIRM     = 2;   // consecutive identical reads before accepting
const SCAN_LOOKUP_TIMEOUT = 8000;   // a waiting user must not hang on a slow network
const SCAN_FPS         = 8;

// ─── STATE ────────────────────────────────────────────────────────────
let pendingScanCode = null;   // read by saveBook / saveMediaItem / saveWishlistItem
let scanKeepGoing   = localStorage.getItem('scanKeepGoing') === '1';

let _scanStream = null, _scanTrack = null, _scanDetector = null;
let _scanLoopId = null, _scanRunning = false;
let _scanLastCode = null, _scanRepeats = 0;
let _scanLibLoaded = false, _scanTorchOn = false;
let _scanCount = 0, _scanLastAdded = null, _scanBannerTimer = null;
let _scanSuppress = null;   // code to ignore after an undo, until a different one is seen


// ─── BARCODE MATH ─────────────────────────────────────────────────────

// EAN-13 check digit: alternating weights 1,3 across all 13 digits.
function eanChecksumValid(code) {
  if (!/^\d{13}$/.test(code)) return true;   // only 13-digit codes are checked here
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += +code[i] * (i % 2 ? 3 : 1);
  return sum % 10 === 0;
}

// An EAN-13 beginning 978/979 IS the ISBN-13, digit for digit.
// 979-0 is ISMN (printed music), not a book.
function isBookBarcode(code) {
  return /^97[89]/.test(code) && !code.startsWith('9790');
}

// Cleans raw cover text into something TMDb can match. Originally written for
// retail listing strings; it does the same job on the verbatim text a vision
// model reads off a case, which carries the same noise:
//   "THE DARK KNIGHT  WIDESCREEN  2-DISC SPECIAL EDITION  BLU-RAY"
// Strips edition/format qualifiers, pulls a bracketed year, guesses movie/tv.
function parseDiscTitle(raw) {
  const original = String(raw || '').trim();
  if (!original) return { title: '', year: '', format: '', type: '' };

  let format = '';
  if (/\b(4k|uhd|ultra\s*hd|blu-?\s*ray|bluray)\b/i.test(original)) format = 'bluray';
  else if (/\bdvd\b/i.test(original)) format = 'dvd';

  const type = /\b(season|complete\s+series|episodes?|tv\s+series)\b/i.test(original) ? 'tv' : 'movie';

  // Only a bracketed year is metadata. A bare one is usually part of the
  // title ("Blade Runner 2049"), so it is neither extracted nor stripped.
  let year = '';
  for (const group of original.match(/[([][^)\]]*[)\]]/g) || []) {
    const m = group.match(/\b(19\d{2}|20\d{2})\b/);
    if (m) { year = m[1]; break; }
  }

  // Retail listings put the title first, then qualifiers and cast names, so
  // everything from the first bracket onward is discarded.
  let s = original.split(/[([]/)[0];
  s = s.replace(
    /\b(4k|uhd|ultra\s*hd|blu-?\s*ray|bluray|dvd|digital\s*copy|digital|widescreen|full\s*screen|fullscreen|anamorphic|region\s*free|region\s*[0-9a-c]|multi-?format|\d+\s*-?\s*disc(?:\s*set)?|steelbook|collector'?s?\s*edition|special\s*edition|deluxe\s*edition|limited\s*edition|unrated|extended\s*(?:cut|edition)|director'?s?\s*cut|remastered|import|brand\s*new|sealed|the\s*complete\s*series|complete\s*series|complete\s*season|season\s*\d+)\b/gi,
    ' '
  );
  s = s.replace(/[_]+/g, ' ')
       .replace(/\s{2,}/g, ' ')
       .replace(/^[\s\-–—:,/|]+/, '')
       .replace(/[\s\-–—:,/|]+$/, '')
       .trim();

  return { title: s, year, format, type };
}


// ─── LOOKUP CACHE ─────────────────────────────────────────────────────
// Open Library throttles anonymous callers at ~1 req/sec, and the User-Agent
// that would raise that limit is a forbidden header in browser JS — so
// caching every ISBN lookup matters.
function _scanCacheAll() {
  try { return JSON.parse(localStorage.getItem(SCAN_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function scanCacheGet(code) {
  const e = _scanCacheAll()[code];
  if (!e) return undefined;
  if (Date.now() - e.t > (e.hit ? SCAN_HIT_TTL : SCAN_MISS_TTL)) return undefined;
  return e.hit ? e.data : null;
}

function scanCacheSet(code, hit, data) {
  try {
    const all = _scanCacheAll();
    all[code] = { t: Date.now(), hit, data };
    localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded — caching is an optimization, not a requirement */ }
}


// ─── METADATA LOOKUP ──────────────────────────────────────────────────
// Bounded fetch — without this a stalled request leaves the user staring at
// "Looking up…" with no way forward.
async function fetchWithTimeout(url, ms = SCAN_LOOKUP_TIMEOUT, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}


// Open Library primary (keyless, Access-Control-Allow-Origin: *),
// Google Books fallback.
// ─── GENRES FROM SUBJECTS ─────────────────────────────────────────────
// Open Library's subjects are a librarian's cataloguing, not genres: "Fiction,
// fantasy, epic", "Juvenile fiction", "Wizards", "nyt:hardcover-fiction=2008-
// 01-06", "Accessible book". Google Books sends BISAC-style "Fiction / Fantasy
// / Epic"; Audible sends its own categories. All of it is matched against one
// fixed list of real genres, so a book gets "Fantasy", never "Fiction,
// fantasy, epic" — and noise ("Accessible book", "In library") matches nothing.
//
// Each row: the genre, spellings a library may already use for it, what in a
// subject means it, and (optionally) what rules that out.
const BOOK_GENRES = [
  ['Science Fiction', ['sci-fi', 'scifi', 'sf'], /science fiction|sci-?fi\b|space opera|cyberpunk|time travel/],
  ['Fantasy', [], /fantasy|wizards|dragons|sword and sorcery|magic\b.*fiction|fiction.*\bmagic/],
  ['Horror', [], /horror|ghost stories|vampires|zombies/],
  ['True Crime', [], /true crime/],
  ['Mystery', ['mysteries'], /myster|detective|whodunit|private investigators/],
  ['Thriller', ['thrillers', 'suspense'], /thriller|suspense|espionage|spy stories/],
  ['Romance', [], /romance|love stories/],
  ['Historical Fiction', [], /historical fiction|fiction,? historical/],
  ['Dystopian', ['dystopia'], /dystop/],
  ['Adventure', [], /adventure/],
  ['Young Adult', ['ya'], /young adult|\bteens?\b|teenagers/],
  ["Children's", ['childrens', 'children', 'kids'], /juvenile|children'?s (?:stories|books|fiction|literature)|picture books/],
  ['Graphic Novel', ['graphic novels', 'comics', 'manga'], /graphic novel|comic books|\bcomics\b|manga/],
  ['Classics', ['classic'], /\bclassics?\b/],
  ['Poetry', ['poems'], /poetry|\bpoems\b/],
  ['Short Stories', [], /short stories/],
  ['Humor', ['humour', 'comedy'], /humou?r|comedy|comic fiction/],
  ['Memoir', ['memoirs'], /memoir/],
  ['Biography', ['biographies', 'autobiography'], /biograph/],
  ['History', [], /\bhistory\b/, /fiction/],
  ['Science', [], /\b(?:science|physics|astronomy|biology|chemistry|cosmology|evolution)\b/,
    /fiction|computer science|political science|social science/],
  ['Technology', ['tech', 'programming', 'computers'], /computer|programming|software/],
  ['Philosophy', [], /philosoph/],
  ['Religion', ['spirituality'], /religio|christian|bible|theolog|spiritual|buddhis|islam|judaism/],
  ['Psychology', [], /psycholog/],
  ['Self-Help', ['self help', 'personal development'], /self-help|self help|personal growth|self-actualization/],
  ['Business', ['economics', 'finance'], /business|economics|management|investing|entrepreneur/],
  ['Politics', ['political science'], /politic/],
  ['Cooking', ['cookbooks', 'food'], /cooking|cookery|recipes|cookbooks/],
  ['Travel', [], /\btravel/],
  ['Art', ['arts'], /\bart\b|painting|photography/],
  ['Music', [], /\bmusic/],
  ['Sports', [], /sports|baseball|football|basketball|soccer/],
  ['Health', ['fitness', 'wellness'], /health|nutrition|\bdiet|fitness/],
];

// subjects: strings, or {name} objects as Open Library's ISBN API sends them.
// Returns at most `max` genres, the ones most subjects point at first. Where
// this library already uses a spelling for a genre ("Sci-Fi"), that spelling
// is returned instead of the canonical one, so the list does not split in two.
function genresFromSubjects(subjects, max = 3) {
  const list = (Array.isArray(subjects) ? subjects : [])
    .map(s => String(s && typeof s === 'object' ? s.name : s || '').toLowerCase())
    // Machine tags ("nyt:hardcover-fiction=2008-01-06") are bookkeeping, not
    // subjects; read as text, the word "fiction" in one would decide a genre.
    .filter(s => s && !/^[a-z_]+:/.test(s));
  if (!list.length) return [];

  const hits = [];                       // [row index, count, first position]
  BOOK_GENRES.forEach(([, , pat, not], row) => {
    let count = 0, first = Infinity;
    list.forEach((s, i) => {
      if (pat.test(s) && !(not && not.test(s))) { count++; first = Math.min(first, i); }
    });
    if (count) hits.push([row, count, first]);
  });
  // A teen book is usually *also* catalogued "Juvenile fiction"; YA is the
  // truer of the two, and having both says less than having one.
  const ya = BOOK_GENRES.findIndex(g => g[0] === 'Young Adult');
  const kids = BOOK_GENRES.findIndex(g => g[0] === "Children's");
  const filtered = hits.some(h => h[0] === ya) ? hits.filter(h => h[0] !== kids) : hits;

  let names = filtered.sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, max)
    .map(([row]) => BOOK_GENRES[row]);
  if (!names.length) {
    // Nothing specific: say at least which side of the shelf it is on.
    if (list.some(s => /non-?fiction/.test(s))) names = [['Nonfiction', ['non-fiction']]];
    else if (list.some(s => /\bfiction\b/.test(s))) names = [['Fiction', []]];
  }

  const have = new Map((typeof allBookGenres === 'function' ? allBookGenres() : [])
    .map(g => [textKey(g), g]));
  return names.map(([genre, aliases]) => {
    for (const k of [genre, ...aliases]) if (have.has(textKey(k))) return have.get(textKey(k));
    return genre;
  });
}

// Open Library's raw subjects, trimmed: they run to dozens for a popular book.
const subjectNames = subs => (subs || []).map(s => (s && typeof s === 'object' ? s.name : s))
  .filter(Boolean).map(String).slice(0, 60);

async function lookupISBN(isbn) {
  const cached = scanCacheGet(isbn);
  // A hit cached before subjects were kept has none to offer, so it is
  // looked up again once rather than going without genres for 30 days.
  // Misses (null) are trusted as before.
  if (cached !== undefined && (cached === null || Array.isArray(cached.subjects))) return cached;

  try {
    const res = await fetchWithTimeout(`${OPENLIBRARY_ISBN_URL}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    if (res.ok) {
      const data = await res.json();
      const rec = data[`ISBN:${isbn}`];   // a miss returns {}, not a 404
      if (rec && rec.title) {
        const out = {
          title: rec.title + (rec.subtitle ? `: ${rec.subtitle}` : ''),
          author: (rec.authors || []).map(a => a.name).filter(Boolean).join(', '),
          coverUrl: (rec.cover && (rec.cover.medium || rec.cover.large)) || '',
          subjects: subjectNames(rec.subjects),
          source: 'Open Library',
        };
        scanCacheSet(isbn, true, out);
        return out;
      }
    }
  } catch { /* fall through to Google Books */ }

  try {
    const res = await fetchWithTimeout(`${GOOGLE_BOOKS_URL}?q=isbn:${isbn}&country=US`);
    if (res.ok) {
      const data = await res.json();
      const v = data.items && data.items[0] && data.items[0].volumeInfo;
      if (v && v.title) {
        const out = {
          title: v.title + (v.subtitle ? `: ${v.subtitle}` : ''),
          author: (v.authors || []).join(', '),
          // imageLinks come back as http:// — GitHub Pages blocks mixed content
          coverUrl: ((v.imageLinks && v.imageLinks.thumbnail) || '').replace(/^http:/, 'https:'),
          // BISAC-style "Fiction / Fantasy / Epic": each level is a subject.
          subjects: (v.categories || []).flatMap(c => String(c).split('/')).map(s => s.trim()).filter(Boolean),
          source: 'Google Books',
        };
        scanCacheSet(isbn, true, out);
        return out;
      }
    }
  } catch { /* fall through to manual entry */ }

  scanCacheSet(isbn, false, null);
  return null;
}

// Discs have no ISBN-equivalent registry. UPCitemdb's free tier returns a
// retail listing string we parse heuristically. If it is unreachable —
// CORS, 429, offline — we return null and the caller falls back to manual
// entry, which is the same place a miss would land anyway.
