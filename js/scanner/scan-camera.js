// scan-camera.js — the barcode scanner's camera lifecycle, decode
// loop, scan-result handling (duplicates, quick-add, undo), and
// the scan modal itself. Split out of scanner.js.

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
      genre: [], formats: ['physical'], status: 'want', notes: '',
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
  // An undo suppresses the code still sitting in front of the camera, but only
  // for that session: without this, reopening the scanner and deliberately
  // rescanning the book you just removed is a silent no-op.
  _scanSuppress = null;

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


