// cover-files.js — covers uploaded from this device rather than linked.
//
// A cover field (a book's or game's coverUrl, a film's posterUrl) holds either
// a link, as it always has, or "repo:covers/<kind>/<name>": an image file the
// user uploaded. Picking one resizes it to about 300px wide (a JPEG of a few
// tens of KB), keeps it in IndexedDB on this device straight away, and sends
// it to the data repo beside the library files once sync can — via
// window.ghCoverFiles in sync.js, which also encrypts it when a sync password
// is set. Another device sees the "repo:" value arrive with the record, fetches
// the file with its token the first time it shows it, and keeps its own copy.
//
// Nothing that draws a cover needs to know: every renderer writes the field
// into an <img src>, and the observer at the bottom swaps a "repo:" src for
// the image itself. A link keeps working exactly as before.

const REPO_COVER = 'repo:';
const isRepoCover = u => typeof u === 'string' && u.startsWith(REPO_COVER);
const COVER_MAX_W = 300, COVER_MAX_H = 450;
// A picked image no record ended up using (the form was cancelled) is
// dropped after this long rather than uploaded.
const COVER_UNUSED_MS = 60 * 60 * 1000;

// ─── IndexedDB: { path, bytes: ArrayBuffer, type, dirty, at } ─────────
// Bytes, not a Blob: WebKit refuses Blobs in IndexedDB in an ephemeral
// session (Safari private browsing).
let _coverDb = null;
function coverDb() {
  if (!_coverDb) {
    _coverDb = new Promise((resolve, reject) => {
      const req = indexedDB.open('booklogger-covers', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'path' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    _coverDb.catch(() => { _coverDb = null; });
  }
  return _coverDb;
}
async function coverTx(mode, fn) {
  const db = await coverDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const out = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
const coverGet = path => coverTx('readonly', s => s.get(path));
const coverPut = rec => coverTx('readwrite', s => s.put(rec));
const coverDelete = path => coverTx('readwrite', s => s.delete(path));
const coverAll = () => coverTx('readonly', s => s.getAll());
const recBlob = r => new Blob([r.bytes], { type: r.type || 'image/jpeg' });

// Whether any picked image may still be waiting to go up: lets every load
// and every sync skip IndexedDB entirely on a device that never uploaded.
const PENDING_KEY = 'booklogger.covers.pending';
const pendingFlag = on => { try { on ? localStorage.setItem(PENDING_KEY, '1') : localStorage.removeItem(PENDING_KEY); } catch {} };
const hasPending = () => { try { return localStorage.getItem(PENDING_KEY) === '1'; } catch { return true; } };

// ─── picking and resizing ─────────────────────────────────────────────
async function resizeCover(file) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    const url = URL.createObjectURL(file);
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image this browser can read')); };
    el.src = url;
  });
  const scale = Math.min(1, COVER_MAX_W / img.naturalWidth, COVER_MAX_H / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // a transparent PNG gets white, not black
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode the image')), 'image/jpeg', 0.85));
}

// Keep the picked image here and return the field value that points at it.
// A fresh name every time: a file in the repo is never rewritten, so two
// devices can never race on one, and a replaced cover is simply a new file.
async function storeCoverFile(kind, file) {
  const blob = await resizeCover(file);
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const encrypted = !!window.ghCoverFiles?.encrypted();
  const path = `covers/${kind}/${token}.${encrypted ? 'json' : 'jpg'}`;
  pendingFlag(true);
  await coverPut({ path, bytes: await blob.arrayBuffer(), type: 'image/jpeg', dirty: true, at: Date.now() });
  _coverUrls.set(path, Promise.resolve(URL.createObjectURL(blob)));
  return REPO_COVER + path;
}

// ─── uploading ────────────────────────────────────────────────────────
function referencedCoverPaths() {
  const out = new Set();
  const add = u => { if (isRepoCover(u)) out.add(u.slice(REPO_COVER.length)); };
  books.forEach(b => add(b.coverUrl));
  mediaLibrary.forEach(m => add(m.posterUrl));
  videoGames.forEach(g => add(g.coverUrl));
  return out;
}

let _coverFlushing = null, _coverFlushAgain = false;
function flushCoverUploads() {
  // One at a time; a request during a run gets one more run after it, since
  // the running one may have listed its files before the new one was saved.
  if (_coverFlushing) { _coverFlushAgain = true; return _coverFlushing; }
  if (!hasPending()) return Promise.resolve();
  _coverFlushing = (async () => {
    const bridge = window.ghCoverFiles;
    const pending = (await coverAll()).filter(r => r.dirty);
    if (!pending.length) { pendingFlag(false); return; }
    let left = 0;
    const used = referencedCoverPaths();
    for (const r of pending) {
      if (!used.has(r.path)) {
        if (Date.now() - r.at > COVER_UNUSED_MS) await coverDelete(r.path); else left++;
        continue;
      }
      if (!bridge || !bridge.canSync()) { left++; continue; }
      try {
        await bridge.put(r.path, new Uint8Array(r.bytes), r.type || 'image/jpeg');
        await coverPut({ ...r, dirty: false });
      } catch { left++; /* offline or refused: the next flush tries again */ }
    }
    if (!left) pendingFlag(false);
  })().catch(() => {}).finally(() => {
    _coverFlushing = null;
    if (_coverFlushAgain) { _coverFlushAgain = false; flushCoverUploads(); }
  });
  return _coverFlushing;
}

// ─── showing ──────────────────────────────────────────────────────────
// path -> Promise<objectURL>. A failure is forgotten, so a later render
// retries (the file may not have been uploaded by its device yet).
const _coverUrls = new Map();
// sync.js is a module, so it runs after the first render: a cover drawn
// before then waits for its bridge (briefly — without sync it never comes).
let _coverBridgeReady;
const coverBridge = () => window.ghCoverFiles ? Promise.resolve(window.ghCoverFiles)
  : (_coverBridgeReady ||= new Promise(resolve => {
      const t0 = Date.now();
      const tick = () => window.ghCoverFiles || Date.now() - t0 > 5000 ? resolve(window.ghCoverFiles || null) : setTimeout(tick, 50);
      tick();
    }));
function coverObjectUrl(path) {
  if (!_coverUrls.has(path)) {
    const p = (async () => {
      const local = await coverGet(path).catch(() => null);
      if (local) return URL.createObjectURL(recBlob(local));
      const bridge = await coverBridge();
      if (!bridge || !bridge.canSync()) throw new Error('not here, and no sync to fetch it');
      const { bytes, type } = await bridge.get(path);
      const blob = new Blob([bytes], { type: type || 'image/jpeg' });
      await coverPut({ path, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), type: blob.type, dirty: false, at: Date.now() }).catch(() => {});
      return URL.createObjectURL(blob);
    })();
    p.catch(() => _coverUrls.delete(path));
    _coverUrls.set(path, p);
  }
  return _coverUrls.get(path);
}

const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
function hydrateCover(img) {
  const src = img.getAttribute('src');
  if (!isRepoCover(src)) return;
  const path = src.slice(REPO_COVER.length);
  img.dataset.repoCover = path;
  img.src = BLANK_IMG;
  img.classList.add('cover-loading');
  coverObjectUrl(path).then(url => {
    if (img.dataset.repoCover !== path) return;
    img.src = url;
    img.classList.remove('cover-loading');
  }, () => {
    if (img.dataset.repoCover !== path) return;
    img.classList.remove('cover-loading');
    img.classList.add('cover-unavailable');
  });
}
function hydrateCoversIn(root) {
  if (root.nodeType !== 1) return;
  if (root.tagName === 'IMG') hydrateCover(root);
  else root.querySelectorAll('img[src^="repo:"]').forEach(hydrateCover);
}
new MutationObserver(muts => {
  for (const m of muts) {
    if (m.type === 'attributes') hydrateCover(m.target);
    else m.addedNodes.forEach(hydrateCoversIn);
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
hydrateCoversIn(document.documentElement);

// ─── the forms' "Upload image" button ─────────────────────────────────
// inputId: the cover field (f-coverUrl, m-posterUrl, g-coverUrl); kind names
// the repo folder (books, media, games).
function pickCoverFile(inputId, kind) {
  const picker = document.getElementById('coverFilePicker');
  picker.value = '';
  picker.onchange = async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    const msg = document.getElementById(inputId + '-msg');
    if (msg) msg.textContent = 'Preparing…';
    try {
      const value = await storeCoverFile(kind, file);
      const input = document.getElementById(inputId);
      input.value = value;
      paintCoverPreview(inputId);
      if (msg) msg.textContent = window.ghCoverFiles?.canSync()
        ? 'Uploaded image — it syncs when you save.' : 'Uploaded image — kept on this device until sync is set up.';
    } catch (err) {
      if (msg) msg.textContent = err.message || 'That image could not be used.';
    }
  };
  picker.click();
}

function paintCoverPreview(inputId) {
  const input = document.getElementById(inputId);
  const prev = document.getElementById(inputId + '-preview');
  if (!input || !prev) return;
  const v = input.value.trim();
  const msg = document.getElementById(inputId + '-msg');
  if (msg && !isRepoCover(v)) msg.textContent = '';
  if (!v) { prev.hidden = true; prev.removeAttribute('src'); delete prev.dataset.repoCover; return; }
  prev.hidden = false;
  prev.setAttribute('src', v);       // a "repo:" value is swapped by the observer
}

function clearCoverField(inputId) {
  const input = document.getElementById(inputId);
  if (input) { input.value = ''; paintCoverPreview(inputId); }
}

['f-coverUrl', 'm-posterUrl', 'g-coverUrl'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => paintCoverPreview(id));
});
