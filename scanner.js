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
const UPCITEMDB_URL        = 'https://api.upcitemdb.com/prod/trial/lookup';

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

// UPC-E (8 digits) expands to UPC-A (12) by a fixed positional rule.
function upcEToA(upce) {
  if (!/^\d{8}$/.test(upce)) return null;
  const ns = upce[0], d = upce.slice(1, 7), check = upce[7];
  if (ns !== '0' && ns !== '1') return null;
  const last = d[5];
  let mfr, prod;
  if (last === '0' || last === '1' || last === '2') {
    mfr = d[0] + d[1] + last + '00';        prod = '00' + d[2] + d[3] + d[4];
  } else if (last === '3') {
    mfr = d[0] + d[1] + d[2] + '00';        prod = '000' + d[3] + d[4];
  } else if (last === '4') {
    mfr = d[0] + d[1] + d[2] + d[3] + '0';  prod = '0000' + d[4];
  } else {
    mfr = d.slice(0, 5);                    prod = '0000' + last;
  }
  return ns + mfr + prod + check;
}

// Retail listing strings look like:
//   "The Dark Knight (Blu-ray Disc, 2008, 2-Disc Set) Christian Bale Widescreen"
//   "Breaking Bad: The Complete Series [Blu-ray] [Region Free]"
// Pull out a usable title, year, disc format, and movie/TV type.
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
// Open Library throttles anonymous callers at ~1 req/sec (the User-Agent
// that would raise that is a forbidden header in browser JS), and
// UPCitemdb's free tier is 100/day per IP — so caching matters.
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
async function fetchWithTimeout(url, ms = SCAN_LOOKUP_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
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
async function lookupUPC(upc) {
  const cached = scanCacheGet(upc);
  if (cached !== undefined) return cached;

  try {
    const res = await fetchWithTimeout(`${UPCITEMDB_URL}?upc=${upc}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const item = data.items && data.items[0];
    if (item && item.title) {
      const parsed = parseDiscTitle(item.title);
      if (parsed.title) {
        const out = { ...parsed, raw: item.title, source: 'UPCitemdb' };
        scanCacheSet(upc, true, out);
        return out;
      }
    }
    scanCacheSet(upc, false, null);   // genuine miss — worth remembering
    return null;
  } catch {
    return null;                      // transport failure — do not cache
  }
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

// Restricting formats per tab is the biggest accuracy win: book back
// covers carry an EAN-5 price add-on (and often a separate UPC-A) that a
// permissive scanner will happily return instead of the ISBN.
function scanFormatsFor(tab) {
  if (tab === 'books') return ['ean_13'];
  if (tab === 'media') return ['upc_a', 'upc_e', 'ean_13'];
  return ['ean_13', 'upc_a', 'upc_e'];
}

function scanPromptFor(tab) {
  if (tab === 'books') return 'Point at the barcode on the back cover — tilt slightly to avoid glare.';
  if (tab === 'media') return 'Point at the barcode on the case — tilt slightly to avoid glare.';
  return 'Scan a book, DVD, or Blu-ray barcode.';
}

function cameraErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow it in your browser settings, or type the barcode below.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera available. You can type the barcode below.';
    case 'NotReadableError':
      return 'The camera is in use by another app. Close it and retry, or type the barcode below.';
    default:
      return 'Could not start the camera. You can type the barcode below.';
  }
}

async function startScanCamera() {
  const video = document.getElementById('scanVideo');
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
  const torchBtn = document.getElementById('scanTorchBtn');
  torchBtn.style.display = caps.torch ? '' : 'none';
  torchBtn.classList.remove('active');
  _scanTorchOn = false;

  const wanted = scanFormatsFor(activeTab);
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
  const video = document.getElementById('scanVideo');
  if (video) video.srcObject = null;
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

function findExistingByCode(code, isBookPath) {
  if (isBookPath) {
    const b = books.find(x => x.isbn && String(x.isbn) === code);
    if (b) return { kind: 'book', item: b };
  } else {
    const m = mediaLibrary.find(x => x.upc && String(x.upc) === code);
    if (m) return { kind: 'media', item: m };
  }
  const w = bookWishlist.find(x =>
    (x.isbn && String(x.isbn) === code) || (x.upc && String(x.upc) === code));
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
  setScanStatus(scanPromptFor(activeTab));
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
  } else if (activeTab === 'media') {
    openMediaModal(null);
    if (info) {
      document.getElementById('m-title').value = info.title || '';
      if (info.year)   document.getElementById('m-year').value = info.year;
      if (info.format) setMediaFormats([info.format]);
      if (info.type)   setMediaRadio('m-type', info.type);
    }
  } else {
    openWishlistModal(null);
    if (info) {
      document.getElementById('wl-title').value  = info.title  || '';
      document.getElementById('wl-author').value = info.author || '';
    }
    setRadio('wl-type', isBookPath ? 'book' : ((info && info.type) || 'movie'));
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
  } else if (activeTab === 'media') {
    const m = normalizeMediaItem({
      id: newId(), title: info.title, type: info.type || 'movie',
      year: info.year || '', genre: [], formats: info.format ? [info.format] : [],
      status: 'want', notes: '', rating: 0, upc: code,
    });
    mediaLibrary.push(m);
    saveMedia();
    _scanLastAdded = { kind: 'media', id: m.id, code };
  } else {
    const w = normalizeWishlistItem({
      id: newId(), type: isBookPath ? 'book' : ((info && info.type) || 'movie'),
      title: info.title, creator: info.author || '', notes: '',
      ...(isBookPath ? { isbn: code } : { upc: code }),
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
  let code = String(rawCode).replace(/\D/g, '');
  if (!code) return;
  if (/^\d{8}$/.test(code)) { const a = upcEToA(code); if (a) code = a; }

  const ean13 = /^\d{12}$/.test(code) ? '0' + code : code;
  if (!eanChecksumValid(ean13)) { setScanStatus('Misread — hold steady and try again.'); return; }

  const isBook = isBookBarcode(ean13);
  if (activeTab === 'books' && !isBook) {
    setScanStatus('That is the price code — scan the wider barcode to its left.');
    return;
  }

  const isBookPath = activeTab === 'books' ? true
                   : activeTab === 'media' ? false
                   : isBook;
  // A UPC-A and its zero-padded EAN-13 are the same barcode. Canonicalise to
  // the 12-digit form so one disc matches however the reader reports it.
  const storeCode = isBookPath ? ean13
                  : (/^0\d{12}$/.test(ean13) ? ean13.slice(1) : ean13);

  // Ignore a just-undone item until something else is scanned.
  if (storeCode === _scanSuppress) return;
  _scanSuppress = null;

  pauseScanLoop();

  // Local library first: always correct, no network, never degrades.
  const dup = findExistingByCode(storeCode, isBookPath);
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
  try { info = isBookPath ? await lookupISBN(ean13) : await lookupUPC(storeCode); }
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

  if (!info) {
    scanBanner(isBookPath
      ? `No match found for ${storeCode} — enter the details manually.`
      : `Could not identify ${storeCode} — enter the details manually.`);
  }
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

  try { await startScanCamera(); }
  catch (err) { setScanStatus(cameraErrorMessage(err), true); return; }

  setScanStatus(scanPromptFor(activeTab));
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
    document.getElementById('scanTorchBtn').classList.toggle('active', next);
  } catch { /* device refused — leave the torch off */ }
}

function toggleScanKeepGoing(checked) {
  scanKeepGoing = !!checked;
  localStorage.setItem('scanKeepGoing', scanKeepGoing ? '1' : '0');
}


// ─── GLOBAL LISTENERS ─────────────────────────────────────────────────
// A live camera track keeps the device in a high-power state and can block
// a later getUserMedia, so release it whenever the page is backgrounded.
document.addEventListener('visibilitychange', () => {
  const modal = document.getElementById('scanModal');
  if (document.hidden && modal && modal.classList.contains('open') && _scanStream) {
    stopScanCamera();
    setScanStatus('Camera paused. Close and reopen the scanner to continue.');
  }
});

document.addEventListener('keydown', e => {
  const modal = document.getElementById('scanModal');
  if (e.key === 'Escape' && modal && modal.classList.contains('open')) closeScanModal();
});
