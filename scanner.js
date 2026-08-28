/*
  ═══════════════════════════════════════════════════════════════════════
  My Library — scanner.js
  Camera barcode scanning, metadata lookup, and duplicate detection.

  Loaded as a classic script before app.js; both share global scope, so
  this file reads app.js state (books, mediaLibrary, activeTab, …) and
  app.js reads `pendingScanCode` from here.
  ═══════════════════════════════════════════════════════════════════════
*/

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
const GEMINI_MAX_EDGE  = 768;   // keeps a photo at exactly 258 image tokens
const IDENTIFY_MAX_QUERIES = 4; // parallel TMDb verifications per capture

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
async function lookupISBN(isbn) {
  const cached = scanCacheGet(isbn);
  if (cached !== undefined) return cached;

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
// ─── TMDb (title search for discs) ────────────────────────────────────
function tmdbKey() {
  try { return (localStorage.getItem(TMDB_KEY_STORE) || '').trim(); } catch { return ''; }
}

function tmdbEnabled() { return !!tmdbKey(); }

function tmdbUrl(pathname, params) {
  const q = new URLSearchParams({ api_key: tmdbKey(), ...params });
  return `${TMDB_API_BASE}${pathname}?${q}`;
}

// Search results carry genre_ids, not names, so the id→name map is fetched
// once and cached; it changes very rarely.
async function tmdbGenreMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(TMDB_GENRE_STORE) || 'null');
    if (raw && Date.now() - raw.t < TMDB_GENRE_TTL) return raw.map;
  } catch { /* fall through and refetch */ }

  const map = {};
  try {
    const [mv, tv] = await Promise.all([
      fetchWithTimeout(tmdbUrl('/genre/movie/list', {})),
      fetchWithTimeout(tmdbUrl('/genre/tv/list', {})),
    ]);
    for (const res of [mv, tv]) {
      if (!res.ok) continue;
      const data = await res.json();
      (data.genres || []).forEach(g => { map[g.id] = g.name; });
    }
    if (Object.keys(map).length) {
      try { localStorage.setItem(TMDB_GENRE_STORE, JSON.stringify({ t: Date.now(), map })); }
      catch { /* quota — the map is an optimization */ }
    }
  } catch { /* genres are optional; the rest of the result is still useful */ }
  return map;
}

async function tmdbSearch(query) {
  if (!tmdbEnabled() || !query.trim()) return [];
  const res = await fetchWithTimeout(
    tmdbUrl('/search/multi', { query: query.trim(), include_adult: 'false' }));
  if (res.status === 401) throw new Error('That TMDb key was rejected.');
  if (!res.ok) throw new Error(`TMDb error (HTTP ${res.status})`);
  const data = await res.json();
  const genres = await tmdbGenreMap();

  return (data.results || [])
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 8)
    .map(r => ({
      tmdbId: r.id,
      type:  r.media_type === 'tv' ? 'tv' : 'movie',
      title: r.title || r.name || '',
      year:  String(r.release_date || r.first_air_date || '').slice(0, 4),
      posterUrl: r.poster_path ? TMDB_IMG_BASE + r.poster_path : '',
      genre: (r.genre_ids || []).map(id => genres[id]).filter(Boolean),
    }))
    .filter(r => r.title);
}

// Verifies a key before it is saved, so a typo is caught immediately.
async function tmdbTestKey(key) {
  const q = new URLSearchParams({ api_key: key, query: 'inception' });
  const res = await fetchWithTimeout(`${TMDB_API_BASE}/search/movie?${q}`);
  if (res.status === 401) throw new Error('Key rejected by TMDb.');
  if (!res.ok) throw new Error(`TMDb returned HTTP ${res.status}.`);
  return true;
}


// ─── LIBRARY / CAMERA LIFECYCLE ───────────────────────────────────────
async function ensureScannerLib() {
  if (_scanLibLoaded) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCAN_POLYFILL_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('library'));
    document.head.appendChild(s);
  });
  // Pin the WASM URL to the version the polyfill was built against, so a
  // CDN bump can't silently break decoding.
  try {
    const api = window.BarcodeDetectionAPI;
    if (api && api.prepareZXingModule) {
      const v = api.ZXING_WASM_VERSION;
      api.prepareZXingModule({
        overrides: {
          locateFile: (path, prefix) => path.endsWith('.wasm')
            ? `https://cdn.jsdelivr.net/npm/zxing-wasm@${v}/dist/reader/${path}`
            : prefix + path,
        },
      });
    }
  } catch { /* polyfill falls back to its own default URL */ }
  _scanLibLoaded = true;
}

// EAN-13 only. Book back covers carry an EAN-5 price add-on, and often a
// separate UPC-A, that a permissive scanner returns instead of the ISBN.
function scanFormatsFor() {
  return ['ean_13'];
}

function scanPromptFor() {
  return 'Point at the barcode on the back cover — tilt slightly to avoid glare.';
}

function cameraErrorMessage(err, fallback = 'You can type the barcode below.') {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Camera access was blocked. Allow it in your browser settings. ${fallback}`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No camera available. ${fallback}`;
    case 'NotReadableError':
      return `The camera is in use by another app. Close it and retry. ${fallback}`;
    default:
      return `Could not start the camera. ${fallback}`;
  }
}

async function startCamera(videoId) {
  const video = document.getElementById(videoId);
  _scanStream = await navigator.mediaDevices.getUserMedia({
    // `ideal`, never `exact` — `exact` throws on front-camera-only laptops.
    // High width matters: 1D barcodes need horizontal pixel density.
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = _scanStream;
  await video.play();
  _scanTrack = _scanStream.getVideoTracks()[0];

  // Torch is Chrome-on-Android only; iOS never exposes it.
  const caps = (_scanTrack.getCapabilities && _scanTrack.getCapabilities()) || {};
  const torchBtn = document.getElementById(
    videoId === 'identifyVideo' ? 'identifyTorchBtn' : 'scanTorchBtn');
  if (torchBtn) {
    torchBtn.style.display = caps.torch ? '' : 'none';
    torchBtn.classList.remove('active');
  }
  _scanTorchOn = false;
}

async function attachBarcodeDetector() {
  const wanted = scanFormatsFor();
  let supported = [];
  try { supported = await window.BarcodeDetector.getSupportedFormats(); } catch { /* assume all */ }
  const usable = supported.length ? wanted.filter(f => supported.includes(f)) : wanted;
  _scanDetector = new window.BarcodeDetector({ formats: usable.length ? usable : wanted });
}

function stopScanCamera() {
  pauseScanLoop();
  if (_scanTrack && _scanTorchOn) {
    try { _scanTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch { /* ignore */ }
  }
  _scanTorchOn = false;
  // srcObject = null alone leaves the camera light on — every track must stop.
  if (_scanStream) {
    _scanStream.getTracks().forEach(t => t.stop());
    _scanStream = null;
  }
  _scanTrack = null;
  _scanDetector = null;
  ['scanVideo', 'identifyVideo'].forEach(id => {
    const v = document.getElementById(id);
    if (v) v.srcObject = null;
  });
}


// ─── DECODE LOOP ──────────────────────────────────────────────────────
function pauseScanLoop() {
  _scanRunning = false;
  if (_scanLoopId) { clearTimeout(_scanLoopId); _scanLoopId = null; }
}

function resumeScanLoop() {
  if (_scanStream && _scanDetector && !_scanRunning) runScanLoop();
}

function runScanLoop() {
  _scanRunning = true;
  _scanLastCode = null;
  _scanRepeats = 0;
  const video = document.getElementById('scanVideo');
  const interval = Math.round(1000 / SCAN_FPS);

  const tick = async () => {
    if (!_scanRunning) return;
    try {
      if (video && video.readyState >= 2 && _scanDetector) {
        const codes = await _scanDetector.detect(video);
        if (codes.length) onRawDetection(codes[0].rawValue);
      }
    } catch { /* transient decode failures are normal */ }
    if (_scanRunning) _scanLoopId = setTimeout(tick, interval);
  };
  tick();
}

// Require consecutive identical reads. A wrong ISBN silently adds the
// wrong book, so a few hundred ms is cheap insurance against a misread.
function onRawDetection(raw) {
  const code = String(raw || '').replace(/\D/g, '');
  if (!code) return;
  if (code === _scanLastCode) _scanRepeats++;
  else { _scanLastCode = code; _scanRepeats = 1; }
  if (_scanRepeats < SCAN_CONFIRM) return;
  _scanRepeats = 0;
  acceptScannedCode(code);
}


// ─── SCAN RESULT HANDLING ─────────────────────────────────────────────
function setScanStatus(msg, isError) {
  const el = document.getElementById('scanStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('scan-status-error', !!isError);
}

function scanBanner(msg) {
  const b = document.getElementById('statusBanner');
  if (!b) return;
  b.textContent = msg;
  b.classList.add('visible');
  clearTimeout(_scanBannerTimer);
  _scanBannerTimer = setTimeout(() => b.classList.remove('visible'), 5000);
}

function updateScanCount() {
  const el = document.getElementById('scanCount');
  if (el) el.textContent = _scanCount ? `${_scanCount} added this session` : '';
}

function findExistingByCode(code) {
  const b = books.find(x => x.isbn && String(x.isbn) === code);
  if (b) return { kind: 'book', item: b };
  const w = bookWishlist.find(x => x.isbn && String(x.isbn) === code);
  if (w) return { kind: 'wishlist', item: w };
  return null;
}

function showScanDuplicate(dup) {
  const box = document.getElementById('scanDuplicate');
  const where = { book: 'library', media: 'Movies & TV library', wishlist: 'wishlist' }[dup.kind];
  document.getElementById('scanDuplicateText').innerHTML =
    `Already in your ${esc(where)}: <strong>${esc(dup.item.title || 'Untitled')}</strong>`;
  box.dataset.kind   = dup.kind;
  box.dataset.itemId = dup.item.id;
  box.style.display  = '';
  setScanStatus('');
}

function editScannedDuplicate() {
  const box = document.getElementById('scanDuplicate');
  const kind = box.dataset.kind;
  const id   = Number(box.dataset.itemId);
  closeScanModal();
  if (kind === 'book')       openEditModal(id);
  else if (kind === 'media') openMediaModal(id);
  else                       openWishlistModal(id);
}

function dismissScanDuplicate() {
  document.getElementById('scanDuplicate').style.display = 'none';
  setScanStatus(scanPromptFor());
  resumeScanLoop();
}

// Review mode: close the camera and open the tab's normal Add form,
// pre-filled. Prefill must happen after the open call, since those
// functions blank every field.
function openPrefilledForm(code, info, isBookPath) {
  if (activeTab === 'books') {
    openAddModal();
    if (info) {
      document.getElementById('f-title').value  = info.title  || '';
      document.getElementById('f-author').value = info.author || '';
      if (info.coverUrl) document.getElementById('f-coverUrl').value = info.coverUrl;
    }
  } else {
    openWishlistModal(null);
    if (info) {
      document.getElementById('wl-title').value  = info.title  || '';
      document.getElementById('wl-author').value = info.author || '';
    }
    setRadio('wl-type', 'book');
  }
  // Set last: the open* helpers reset form state, and saveBook() builds a
  // fresh object literal that would otherwise drop the code.
  pendingScanCode = code;
}

function quickAddScanned(code, info, isBookPath) {
  if (!info || !info.title) return false;

  if (activeTab === 'books') {
    const b = normalizeBook({
      id: newId(), title: info.title, author: info.author || '', series: '',
      tags: [], formats: ['physical'], status: 'want', notes: '',
      rating: 0, coverUrl: info.coverUrl || '', isbn: code,
    });
    books.push(b);
    save();
    _scanLastAdded = { kind: 'book', id: b.id, code };
  } else {
    const w = normalizeWishlistItem({
      id: newId(), type: 'book',
      title: info.title, creator: info.author || '', notes: '',
      isbn: code,
    });
    bookWishlist.push(w);
    saveWishlist();
    _scanLastAdded = { kind: 'wishlist', id: w.id, code };
  }

  _scanCount++;
  return true;
}

function undoLastScanAdd() {
  if (!_scanLastAdded) return;
  const { kind, id, code } = _scanLastAdded;
  if (kind === 'book')       { books        = books.filter(b => b.id !== id);        save(); }
  else if (kind === 'media') { mediaLibrary = mediaLibrary.filter(m => m.id !== id); saveMedia(); }
  else                       { bookWishlist = bookWishlist.filter(w => w.id !== id); saveWishlist(); }

  // The item is still in front of the camera; without this it is re-added
  // on the very next frame.
  _scanSuppress = code || null;
  _scanLastAdded = null;
  _scanCount = Math.max(0, _scanCount - 1);
  updateScanCount();
  document.getElementById('scanUndo').style.display = 'none';
  setScanStatus('Removed. Ready for the next one.');
  resumeScanLoop();
}

async function acceptScannedCode(rawCode) {
  const code = String(rawCode).replace(/\D/g, '');
  if (!code) return;

  const ean13 = /^\d{12}$/.test(code) ? '0' + code : code;
  if (!eanChecksumValid(ean13)) { setScanStatus('Misread — hold steady and try again.'); return; }

  // A barcode is only actionable when it is a book: an EAN-13 starting
  // 978/979 IS the ISBN-13. A disc's UPC resolves to nothing, so it is
  // rejected rather than stored — discs are identified from their cover.
  if (!isBookBarcode(ean13)) {
    setScanStatus('That is not a book barcode — scan the wider one starting 978, to its left.');
    return;
  }

  const isBookPath = true;
  const storeCode = ean13;

  // Ignore a just-undone item until something else is scanned.
  if (storeCode === _scanSuppress) return;
  _scanSuppress = null;

  pauseScanLoop();

  // Local library first: always correct, no network, never degrades.
  const dup = findExistingByCode(storeCode);
  if (dup) {
    // In bulk mode a duplicate should not interrupt the run.
    if (scanKeepGoing) {
      setScanStatus(`Already in your library: “${dup.item.title || 'Untitled'}” — skipped.`);
      resumeScanLoop();
      return;
    }
    showScanDuplicate(dup);
    return;
  }

  setScanStatus('Looking up ' + storeCode + '…');
  let info = null;
  try { info = await lookupISBN(ean13); }
  catch { info = null; }

  if (scanKeepGoing && info && info.title) {
    quickAddScanned(storeCode, info, isBookPath);
    updateScanCount();
    document.getElementById('scanUndo').style.display = '';
    setScanStatus(`Added “${info.title}”. Ready for the next one.`);
    resumeScanLoop();
    return;
  }

  stopScanCamera();
  document.getElementById('scanModal').classList.remove('open');
  document.getElementById('scanDuplicate').style.display = 'none';

  if (!info) scanBanner(`No match found for ${storeCode} — enter the details manually.`);
  openPrefilledForm(storeCode, info, isBookPath);
}


// ─── MODAL CONTROL ────────────────────────────────────────────────────
async function openScanner() {
  _scanCount = 0;
  _scanLastAdded = null;

  const modal = document.getElementById('scanModal');
  modal.classList.add('open');
  document.getElementById('scanDuplicate').style.display = 'none';
  document.getElementById('scanUndo').style.display = 'none';
  document.getElementById('scanManualInput').value = '';
  document.getElementById('scanKeepGoing').checked = scanKeepGoing;
  document.getElementById('scanTorchBtn').style.display = 'none';
  updateScanCount();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setScanStatus('This browser cannot access the camera. You can type the barcode below.', true);
    return;
  }

  setScanStatus('Starting camera…');
  try { await ensureScannerLib(); }
  catch {
    setScanStatus('Could not load the barcode library. You can type the barcode below.', true);
    return;
  }

  if (!modal.classList.contains('open')) return;   // closed while loading

  try { await startCamera('scanVideo'); await attachBarcodeDetector(); }
  catch (err) { setScanStatus(cameraErrorMessage(err), true); return; }

  setScanStatus(scanPromptFor());
  runScanLoop();
}

function closeScanModal() {
  stopScanCamera();
  document.getElementById('scanModal').classList.remove('open');
  document.getElementById('scanDuplicate').style.display = 'none';
}

function handleScanBackdrop(e) {
  if (e.target === document.getElementById('scanModal')) closeScanModal();
}

function submitManualBarcode() {
  const input = document.getElementById('scanManualInput');
  const code = input.value.replace(/\D/g, '');
  if (!code) { input.focus(); return; }
  input.value = '';
  acceptScannedCode(code);
}

function manualBarcodeKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); submitManualBarcode(); }
}

async function toggleScanTorch() {
  if (!_scanTrack) return;
  const next = !_scanTorchOn;
  try {
    await _scanTrack.applyConstraints({ advanced: [{ torch: next }] });
    _scanTorchOn = next;
    ['scanTorchBtn', 'identifyTorchBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.toggle('active', next);
    });
  } catch { /* device refused — leave the torch off */ }
}

function toggleScanKeepGoing(checked) {
  scanKeepGoing = !!checked;
  localStorage.setItem('scanKeepGoing', scanKeepGoing ? '1' : '0');
}


// ─── TMDb AUTOCOMPLETE (media modal) ──────────────────────────────────
let _tmdbResults = [];
let _tmdbIndex   = -1;
let _tmdbTimer   = null;
let _tmdbSeq     = 0;          // guards against out-of-order responses
let pendingTmdb  = null;       // {tmdbId, posterUrl} applied by saveMediaItem

function tmdbHint(msg, isError) {
  const el = document.getElementById('tmdbHint');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hint-error', !!isError);
}

function closeTmdbAC() {
  const ac = document.getElementById('tmdb-ac');
  if (ac) ac.style.display = 'none';
  _tmdbIndex = -1;
}

function tmdbAC() {
  const input = document.getElementById('m-tmdb');
  const query = input.value.trim();
  clearTimeout(_tmdbTimer);
  if (query.length < 2) { closeTmdbAC(); tmdbHint(''); return; }

  _tmdbTimer = setTimeout(async () => {
    const seq = ++_tmdbSeq;
    tmdbHint('Searching…');
    try {
      const results = await tmdbSearch(query);
      if (seq !== _tmdbSeq) return;         // a newer keystroke already won
      _tmdbResults = results;
      renderTmdbAC();
      tmdbHint(results.length ? '' : 'No matches on TMDb.');
    } catch (err) {
      if (seq !== _tmdbSeq) return;
      closeTmdbAC();
      tmdbHint(err.message || 'TMDb search failed.', true);
    }
  }, 300);
}

function renderTmdbAC() {
  const ac = document.getElementById('tmdb-ac');
  if (!ac) return;
  if (!_tmdbResults.length) { closeTmdbAC(); return; }
  _tmdbIndex = -1;
  ac.innerHTML = _tmdbResults.map((r, i) => `
    <div class="ac-item tmdb-item" data-i="${i}" onmousedown="tmdbPick(${i})">
      ${r.posterUrl
        ? `<img class="tmdb-thumb" src="${esc(r.posterUrl)}" alt="" loading="lazy">`
        : `<div class="tmdb-thumb tmdb-thumb-empty">${r.type === 'tv' ? '📺' : '🎬'}</div>`}
      <div class="tmdb-meta">
        <div class="tmdb-title">${esc(r.title)}</div>
        <div class="tmdb-sub">${r.type === 'tv' ? '📺 TV' : '🎬 Movie'}${r.year ? ' · ' + esc(r.year) : ''}</div>
      </div>
    </div>`).join('');
  ac.style.display = 'block';
}

function tmdbACKey(e) {
  const ac = document.getElementById('tmdb-ac');
  if (!ac || ac.style.display === 'none') return;
  const items = [...ac.querySelectorAll('.ac-item')];
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _tmdbIndex = Math.min(_tmdbIndex + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _tmdbIndex = Math.max(_tmdbIndex - 1, 0);
  } else if (e.key === 'Enter' && _tmdbIndex >= 0) {
    e.preventDefault();
    tmdbPick(_tmdbIndex);
    return;
  } else if (e.key === 'Escape') {
    closeTmdbAC();
    return;
  } else {
    return;
  }
  items.forEach((el, i) => el.classList.toggle('ac-active', i === _tmdbIndex));
  if (items[_tmdbIndex]) items[_tmdbIndex].scrollIntoView({ block: 'nearest' });
}

function tmdbPick(i) {
  const r = _tmdbResults[i];
  if (!r) return;
  document.getElementById('m-title').value = r.title;
  document.getElementById('m-year').value  = r.year || '';
  if (r.genre && r.genre.length) document.getElementById('m-genre').value = r.genre.join(', ');
  setMediaRadio('m-type', r.type);
  // Carried through saveMediaItem, which builds a fresh object on insert.
  pendingTmdb = { tmdbId: r.tmdbId, posterUrl: r.posterUrl || '' };
  closeTmdbAC();
  document.getElementById('m-tmdb').value = '';
  tmdbHint(`Filled from TMDb: ${r.title}${r.year ? ' (' + r.year + ')' : ''}`);
}

// Shows the search box only when a key is present, with a pointer to where
// to add one otherwise.
function syncIdentifyButtons() {
  const on = geminiEnabled();
  ['mediaIdentifyBtn', 'wishlistIdentifyBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.style.display = on ? '' : 'none';
  });
}

function syncTmdbUI() {
  syncIdentifyButtons();
  const wrap = document.getElementById('tmdbSearchGroup');
  const none = document.getElementById('tmdbNoKey');
  if (!wrap || !none) return;
  const on = tmdbEnabled();
  wrap.style.display = on ? '' : 'none';
  none.style.display = on ? 'none' : '';
  closeTmdbAC();
  tmdbHint('');
  const input = document.getElementById('m-tmdb');
  if (input) input.value = '';
}


// ─── TMDb KEY SETTINGS ────────────────────────────────────────────────
function openTmdbKeyModal() {
  document.getElementById('tmdbKeyInput').value = tmdbKey();
  tmdbKeyStatus('');
  document.getElementById('tmdbKeyModal').classList.add('open');
  document.getElementById('tmdbKeyInput').focus();
}

function closeTmdbKeyModal() {
  document.getElementById('tmdbKeyModal').classList.remove('open');
}

function handleTmdbKeyBackdrop(e) {
  if (e.target === document.getElementById('tmdbKeyModal')) closeTmdbKeyModal();
}

function tmdbKeyStatus(msg, isError) {
  const el = document.getElementById('tmdbKeyStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hint-error', !!isError);
}

async function saveTmdbKey() {
  const key = document.getElementById('tmdbKeyInput').value.trim();
  if (!key) { clearTmdbKey(); return; }
  tmdbKeyStatus('Checking with TMDb…');
  try {
    await tmdbTestKey(key);
  } catch (err) {
    tmdbKeyStatus(err.message || 'Could not verify the key.', true);
    return;
  }
  try {
    localStorage.setItem(TMDB_KEY_STORE, key);
    localStorage.removeItem(TMDB_GENRE_STORE);   // refetch genres under the new key
  } catch {
    tmdbKeyStatus('Could not save the key (storage is full or blocked).', true);
    return;
  }
  syncTmdbUI();
  tmdbKeyStatus('Saved. Disc search is on.');
  setTimeout(closeTmdbKeyModal, 900);
}

function clearTmdbKey() {
  try {
    localStorage.removeItem(TMDB_KEY_STORE);
    localStorage.removeItem(TMDB_GENRE_STORE);
  } catch { /* ignore */ }
  document.getElementById('tmdbKeyInput').value = '';
  syncTmdbUI();
  tmdbKeyStatus('Key removed. Disc search is off.');
}


// ─── COVER IDENTIFICATION (Gemini) ────────────────────────────────────
// Discs have no usable barcode route, so the cover itself is the input. A
// vision model reads the artwork — not just the text — which is what makes
// this work on stylised title logotypes that OCR cannot handle.

let _identifyResults = [];   // ranked TMDb matches awaiting the user's pick
let _identifyBusy    = false;
let _identifyTarget  = 'media';   // which form a pick should fill

function geminiKey() {
  try { return (localStorage.getItem(GEMINI_KEY_STORE) || '').trim(); } catch { return ''; }
}

function geminiEnabled() { return !!geminiKey(); }

function geminiModel() {
  try { return (localStorage.getItem(GEMINI_MODEL_STORE) || '').trim(); } catch { return ''; }
}

function setGeminiModel(id) {
  try {
    if (id) localStorage.setItem(GEMINI_MODEL_STORE, id);
    else localStorage.removeItem(GEMINI_MODEL_STORE);
  } catch { /* storage full or blocked — discovery just repeats */ }
}

function geminiEndpoint(model) {
  return `${GEMINI_API_BASE}/models/${model}:generateContent`;
}

// Ask the key what it can actually use. Discovery and generation share
// GEMINI_API_BASE, so anything listed here is callable by construction.
async function geminiListModels(key) {
  let res;
  try {
    res = await fetchWithTimeout(`${GEMINI_API_BASE}/models`, 12000, {
      headers: { 'x-goog-api-key': key },
    });
  } catch (err) {
    throw new Error(err && err.name === 'AbortError'
      ? 'Google took too long to respond — try again.'
      : 'Could not reach Google. Check your connection and try again.');
  }
  if (res.status === 401) throw new Error('That key was rejected by Google.');
  if (res.status === 403) {
    throw new Error('Google refused the key. Check it is correct and that the ' +
                    'Generative Language API is enabled for its project.');
  }
  if (!res.ok) throw new Error(`Google returned HTTP ${res.status}.`);

  const data = await res.json().catch(() => ({}));
  const usable = (data.models || [])
    .filter(m => {
      const methods = m.supportedGenerationMethods;
      // Tolerate the field being absent rather than discarding the model.
      return !Array.isArray(methods) || methods.includes('generateContent');
    })
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);

  if (!usable.length) {
    throw new Error('That key works, but no models on it can generate content. ' +
                    'Check the project has Gemini access.');
  }
  return usable;
}

function geminiModelTier(id) {
  const l = String(id).toLowerCase();
  if (!l.includes('gemini')) return 0;
  // Exclude variants that cannot take an image prompt and return text.
  if (/embedding|aqa|imagen|veo|tts|audio|live/.test(l)) return 0;
  if (l.includes('flash')) return 3;
  if (l.includes('pro')) return 2;
  return 1;
}

// Only models that could actually identify a cover. Offering the rest in the
// picker would just let someone select something guaranteed to fail.
function viableGeminiModels(models) {
  const viable = models.filter(id => geminiModelTier(id) > 0);
  return viable.length ? viable : models;
}

// Prefer the cheapest vision-capable tier, and a newer one over an older.
function pickGeminiModel(models) {
  const version = id => {
    const m = id.match(/(\d+)(?:\.(\d+))?/);
    return m ? parseFloat(`${m[1]}.${m[2] || 0}`) : 0;
  };
  const ranked = models
    .map(id => ({ id, t: geminiModelTier(id), v: version(id) }))
    .filter(m => m.t > 0)
    .sort((a, b) => (b.t - a.t) || (b.v - a.v) || a.id.localeCompare(b.id));
  return ranked.length ? ranked[0].id : models[0];
}

async function resolveGeminiModel(key, force) {
  if (!force) {
    const cached = geminiModel();
    if (cached) return cached;
  }
  const picked = pickGeminiModel(await geminiListModels(key));
  setGeminiModel(picked);
  return picked;
}

// Plain fetch, never the js-genai SDK: Gemini's preflight allows only
// content-type and x-goog-api-key, and the SDK adds headers that fail CORS.
async function geminiRequest(key, model, body, timeout) {
  let res;
  try {
    res = await fetchWithTimeout(geminiEndpoint(model), timeout, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(err && err.name === 'AbortError'
      ? 'Google took too long to respond — try again.'
      : 'Could not reach Google. Check your connection and try again.');
  }
  if (res.status === 400 || res.status === 401) throw new Error('That key was rejected by Google.');
  if (res.status === 403) {
    throw new Error('Google refused the key. Check it is correct and that the ' +
                    'Generative Language API is enabled for its project.');
  }
  if (res.status === 429) {
    throw new Error('Google rate limit reached — the free tier allows about 500 images a day.');
  }
  return res;
}

async function geminiPost(key, body, timeout) {
  let model = await resolveGeminiModel(key);
  let res = await geminiRequest(key, model, body, timeout);

  // Google withdrew or renamed the cached model — rediscover once and retry,
  // so a deprecation does not require the user to do anything.
  if (res.status === 404) {
    setGeminiModel('');
    model = await resolveGeminiModel(key, true);
    res = await geminiRequest(key, model, body, timeout);
  }

  if (!res.ok) throw new Error(`Google returned HTTP ${res.status}.`);
  return res.json();
}

// Validating with ListModels rather than a generation call means an
// unavailable model can never masquerade as a bad key — which is exactly
// what the hardcoded id did.
async function geminiTestKey(key) {
  const all = await geminiListModels(key);
  const models = viableGeminiModels(all);
  return { models, picked: pickGeminiModel(models) };
}

// Downscale to 768px on the long edge: that is exactly one Gemini image tile
// (258 tokens) and keeps the upload small on mobile data.
function captureFrameAsJpeg(video, maxEdge = GEMINI_MAX_EDGE) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const c = document.createElement('canvas');
  c.width  = Math.max(1, Math.round(vw * scale));
  c.height = Math.max(1, Math.round(vh * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.8);
  return { base64: dataUrl.split(',')[1] || '', width: c.width, height: c.height };
}

const IDENTIFY_PROMPT =
  'This photo shows a DVD or Blu-ray case, or a TV title card. Identify the film ' +
  'or TV series it is. Use the artwork as well as any text. Give up to 3 ' +
  'candidates, most likely first, even if you are unsure. Do not name any people.';

const IDENTIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verbatim_text: { type: 'STRING' },
    candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          year: { type: 'INTEGER' },
          type: { type: 'STRING', enum: ['movie', 'tv'] },
          confidence: { type: 'NUMBER' },
        },
        required: ['title', 'type', 'confidence'],
      },
    },
  },
  required: ['verbatim_text', 'candidates'],
};

async function identifyCover(base64) {
  const key = geminiKey();
  if (!key) throw new Error('No image recognition key set.');

  const data = await geminiPost(key, {
    contents: [{ parts: [
      { inline_data: { mime_type: 'image/jpeg', data: base64 } },
      { text: IDENTIFY_PROMPT },
    ] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: IDENTIFY_SCHEMA,
      maxOutputTokens: 512,
    },
  }, 20000);

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed) throw new Error('Could not read the response from Google.');

  return {
    verbatim: String(parsed.verbatim_text || ''),
    candidates: (parsed.candidates || [])
      .filter(c => c && c.title)
      .map(c => ({
        title: String(c.title),
        year: c.year ? String(c.year) : '',
        type: c.type === 'tv' ? 'tv' : 'movie',
        confidence: Number.isFinite(+c.confidence) ? +c.confidence : 0.5,
      })),
  };
}

// ─── MATCH VERIFICATION ───────────────────────────────────────────────
// The model's title is never trusted on its own: every candidate is checked
// against TMDb, and agreement between candidates is the strongest signal.

function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function titleSimilarity(a, b) {
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// TMDb search is phrase/prefix matched, not fuzzy, so several phrasings are
// tried and the results merged rather than relying on any single query.
async function verifyAgainstTmdb(identified) {
  const queries = [];
  const seen = new Set();
  const push = q => {
    const t = String(q || '').trim();
    const k = t.toLowerCase();
    if (t.length >= 2 && !seen.has(k)) { seen.add(k); queries.push(t); }
  };
  identified.candidates.forEach(c => push(c.title));
  push(parseDiscTitle(identified.verbatim).title);

  const used = queries.slice(0, IDENTIFY_MAX_QUERIES);
  const settled = await Promise.allSettled(used.map(q => tmdbSearch(q)));

  // How much the model's belief transfers to a given TMDb hit. Squaring the
  // similarity makes it decay fast, so "The Dark Knight" does not lend its
  // confidence to "The Dark Knight Rises".
  const modelBelief = hit => identified.candidates.reduce((best, c) => {
    const sim = titleSimilarity(c.title, hit.title);
    const typed = c.type === hit.type ? 1 : 0.8;
    return Math.max(best, c.confidence * sim * sim * typed);
  }, 0);

  const byId = new Map();
  settled.forEach((r, qi) => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach((hit, rank) => {
      const score =
        titleSimilarity(used[qi], hit.title) * 2 +   // matches what we asked for
        modelBelief(hit) * 2 +                       // what the model actually believed
        Math.max(0, 0.5 - rank * 0.1);               // TMDb's own ordering
      const prev = byId.get(hit.tmdbId);
      if (prev) {
        prev.agree += 1;
        prev.score = Math.max(prev.score, score);
      } else {
        byId.set(hit.tmdbId, { ...hit, agree: 1, score });
      }
    });
  });

  // Agreement is a bonus, not an override: a broad query returns several
  // hits, so appearing twice is weaker evidence than matching well once.
  return [...byId.values()]
    .map(r => ({ ...r, score: r.score + 0.25 * (r.agree - 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}


// ─── IDENTIFY MODAL ───────────────────────────────────────────────────
function setIdentifyStatus(msg, isError) {
  const el = document.getElementById('identifyStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('scan-status-error', !!isError);
}

async function openIdentify(target) {
  _identifyTarget  = target || (activeTab === 'wishlist' ? 'wishlist' : 'media');
  _identifyResults = [];
  _identifyBusy    = false;

  const modal = document.getElementById('identifyModal');
  modal.classList.add('open');
  document.getElementById('identifyResults').innerHTML = '';
  document.getElementById('identifyResults').style.display = 'none';
  document.getElementById('identifyTorchBtn').style.display = 'none';
  setIdentifyCaptureEnabled(false);

  if (!geminiEnabled()) {
    setIdentifyStatus('Add an image recognition key under ⋯ to identify covers.', true);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setIdentifyStatus('This browser cannot access the camera.', true);
    return;
  }

  setIdentifyStatus('Starting camera…');
  try { await startCamera('identifyVideo'); }
  catch (err) {
    setIdentifyStatus(cameraErrorMessage(err, 'You can search by title instead.'), true);
    return;
  }
  if (!modal.classList.contains('open')) { stopScanCamera(); return; }

  setIdentifyCaptureEnabled(true);
  setIdentifyStatus('Fill the frame with the front of the case, then tap Identify.');
}

function setIdentifyCaptureEnabled(on) {
  const btn = document.getElementById('identifyCaptureBtn');
  if (btn) btn.disabled = !on;
}

async function captureAndIdentify() {
  if (_identifyBusy) return;
  const video = document.getElementById('identifyVideo');
  const shot = captureFrameAsJpeg(video);
  if (!shot || !shot.base64) { setIdentifyStatus('Camera is not ready yet.', true); return; }

  _identifyBusy = true;
  setIdentifyCaptureEnabled(false);
  setIdentifyStatus('Identifying…');

  let identified = null;
  try {
    identified = await identifyCover(shot.base64);
  } catch (err) {
    _identifyBusy = false;
    setIdentifyCaptureEnabled(true);
    setIdentifyStatus(err.message || 'Could not identify this cover.', true);
    return;
  }

  if (!tmdbEnabled()) {
    // Without TMDb there is nothing to verify against — hand over the raw
    // title and let the form take it.
    finishIdentify(identified, []);
    return;
  }

  setIdentifyStatus('Checking against TMDb…');
  let matches = [];
  try { matches = await verifyAgainstTmdb(identified); }
  catch { matches = []; }
  finishIdentify(identified, matches);
}

function finishIdentify(identified, matches) {
  _identifyBusy = false;
  _identifyResults = matches;

  if (matches.length) {
    setIdentifyStatus('Tap the right one.');
    renderIdentifyResults();
    setIdentifyCaptureEnabled(true);
    return;
  }

  // Nothing verifiable: fall back to the form with the best text we have, so
  // the user is one search away rather than starting from scratch.
  const guess = (identified.candidates[0] && identified.candidates[0].title)
             || parseDiscTitle(identified.verbatim).title;
  stopScanCamera();
  document.getElementById('identifyModal').classList.remove('open');
  scanBanner(guess
    ? `Could not confirm a match — search started from “${guess}”.`
    : 'Could not identify this cover — enter the details manually.');
  openIdentifyFallbackForm(guess, identified);
}

function renderIdentifyResults() {
  const box = document.getElementById('identifyResults');
  if (!box) return;
  box.innerHTML = _identifyResults.map((r, i) => `
    <div class="ac-item tmdb-item" onclick="pickIdentifyResult(${i})">
      ${r.posterUrl
        ? `<img class="tmdb-thumb" src="${esc(r.posterUrl)}" alt="" loading="lazy">`
        : `<div class="tmdb-thumb tmdb-thumb-empty">${r.type === 'tv' ? '📺' : '🎬'}</div>`}
      <div class="tmdb-meta">
        <div class="tmdb-title">${esc(r.title)}</div>
        <div class="tmdb-sub">${r.type === 'tv' ? '📺 TV' : '🎬 Movie'}${r.year ? ' · ' + esc(r.year) : ''}</div>
      </div>
    </div>`).join('');
  box.style.display = 'block';
}

function pickIdentifyResult(i) {
  const r = _identifyResults[i];
  if (!r) return;
  stopScanCamera();
  document.getElementById('identifyModal').classList.remove('open');

  if (_identifyTarget === 'wishlist') {
    openWishlistModal(null);
    document.getElementById('wl-title').value = r.title;
    setRadio('wl-type', r.type);
    return;
  }

  openMediaModal(null);
  document.getElementById('m-title').value = r.title;
  document.getElementById('m-year').value  = r.year || '';
  if (r.genre && r.genre.length) document.getElementById('m-genre').value = r.genre.join(', ');
  setMediaRadio('m-type', r.type);
  // Same handoff tmdbPick uses, so posters and the save path work unchanged.
  pendingTmdb = { tmdbId: r.tmdbId, posterUrl: r.posterUrl || '' };
  tmdbHint(`Identified from the cover: ${r.title}${r.year ? ' (' + r.year + ')' : ''}`);
}

function openIdentifyFallbackForm(guess, identified) {
  if (_identifyTarget === 'wishlist') {
    openWishlistModal(null);
    if (guess) document.getElementById('wl-title').value = guess;
    setRadio('wl-type', (identified.candidates[0] && identified.candidates[0].type) || 'movie');
    return;
  }
  openMediaModal(null);
  const first = identified.candidates[0];
  if (first) {
    if (first.year) document.getElementById('m-year').value = first.year;
    setMediaRadio('m-type', first.type);
  }
  const tq = document.getElementById('m-tmdb');
  if (tmdbEnabled() && tq && guess) { tq.value = guess; tmdbAC(); }
  else if (guess) document.getElementById('m-title').value = guess;
}

function closeIdentifyModal() {
  stopScanCamera();
  document.getElementById('identifyModal').classList.remove('open');
  _identifyBusy = false;
}

function handleIdentifyBackdrop(e) {
  if (e.target === document.getElementById('identifyModal')) closeIdentifyModal();
}


// ─── GEMINI KEY SETTINGS ──────────────────────────────────────────────
function openGeminiKeyModal() {
  document.getElementById('geminiKeyInput').value = geminiKey();
  geminiKeyStatus('');
  // Show the model already in use, if any; the full list needs a key check.
  const current = geminiModel();
  showGeminiModels(current ? [current] : [], current);
  document.getElementById('geminiKeyModal').classList.add('open');
  document.getElementById('geminiKeyInput').focus();
}

// Which models a key can reach differs per account, so the effective one is
// surfaced rather than hidden — and is overridable if the pick is wrong.
function showGeminiModels(models, selected) {
  const wrap = document.getElementById('geminiModelGroup');
  const sel  = document.getElementById('geminiModelSelect');
  if (!wrap || !sel) return;
  if (!models.length) { wrap.style.display = 'none'; sel.innerHTML = ''; return; }
  sel.innerHTML = models
    .map(m => `<option value="${esc(m)}"${m === selected ? ' selected' : ''}>${esc(m)}</option>`)
    .join('');
  wrap.style.display = '';
}

function closeGeminiKeyModal() {
  document.getElementById('geminiKeyModal').classList.remove('open');
}

function handleGeminiKeyBackdrop(e) {
  if (e.target === document.getElementById('geminiKeyModal')) closeGeminiKeyModal();
}

function geminiKeyStatus(msg, isError) {
  const el = document.getElementById('geminiKeyStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hint-error', !!isError);
}

async function saveGeminiKey() {
  const key = document.getElementById('geminiKeyInput').value.trim();
  if (!key) { clearGeminiKey(); return; }

  const sel = document.getElementById('geminiModelSelect');
  const keyUnchanged = key === geminiKey();
  const chosen = keyUnchanged && sel && sel.value ? sel.value : '';

  geminiKeyStatus('Checking with Google…');
  let found;
  try { found = await geminiTestKey(key); }
  catch (err) { geminiKeyStatus(err.message || 'Could not verify the key.', true); return; }

  // Keep an explicit choice if it is still offered; otherwise take the pick.
  const model = chosen && found.models.includes(chosen) ? chosen : found.picked;

  try {
    localStorage.setItem(GEMINI_KEY_STORE, key);
    setGeminiModel(model);
  } catch { geminiKeyStatus('Could not save the key (storage is full or blocked).', true); return; }

  showGeminiModels(found.models, model);
  syncScanButton();
  geminiKeyStatus(`Saved — using ${model}.`);
  setTimeout(closeGeminiKeyModal, 1400);
}

function clearGeminiKey() {
  try { localStorage.removeItem(GEMINI_KEY_STORE); } catch { /* ignore */ }
  setGeminiModel('');
  document.getElementById('geminiKeyInput').value = '';
  showGeminiModels([], '');
  syncScanButton();
  geminiKeyStatus('Key removed. Cover identification is off.');
}


// ─── HEADER CAMERA BUTTON ─────────────────────────────────────────────
// Books and Wishlist scan a barcode; Movies & TV identifies a cover, which
// needs a key, so the button is hidden there without one.
function scanButtonMode() {
  if (activeTab === 'media') return geminiEnabled() ? 'identify' : 'none';
  return 'scan';
}

function syncScanButton() {
  syncIdentifyButtons();
  const btn = document.getElementById('scanBtn');
  if (!btn) return;
  const mode = scanButtonMode();
  btn.style.display = mode === 'none' ? 'none' : '';
  const label = mode === 'identify'
    ? 'Identify a film or show from its cover'
    : 'Scan a book barcode (ISBN)';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function handleScanButton() {
  if (scanButtonMode() === 'identify') openIdentify('media');
  else openScanner();
}


// ─── GLOBAL LISTENERS ─────────────────────────────────────────────────
// A live camera track keeps the device in a high-power state and can block
// a later getUserMedia, so release it whenever the page is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !_scanStream) return;
  const scan = document.getElementById('scanModal');
  const ident = document.getElementById('identifyModal');
  if (scan && scan.classList.contains('open')) {
    stopScanCamera();
    setScanStatus('Camera paused. Close and reopen the scanner to continue.');
  } else if (ident && ident.classList.contains('open')) {
    stopScanCamera();
    setIdentifyStatus('Camera paused. Close and reopen to continue.');
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const scan = document.getElementById('scanModal');
  const ident = document.getElementById('identifyModal');
  if (scan && scan.classList.contains('open')) closeScanModal();
  else if (ident && ident.classList.contains('open')) closeIdentifyModal();
});
