// scan-button.js — the shared header camera button (scan vs.
// identify mode per tab), and the page-hidden / Escape global
// listeners. Split out of scanner.js.

// ─── HEADER CAMERA BUTTON ─────────────────────────────────────────────
// Books and Wishlist scan a barcode; Movies & TV identifies a cover, which
// needs a key, so the button is hidden there without one. Games has neither
// — no CORS-accessible game database exists to look a barcode or cover up
// against (RAWG, IGDB, Giant Bomb and Steam's own API all decline browser
// CORS) — so the button is hidden rather than opening a scanner that can
// only ever fail to identify anything.
function scanButtonMode() {
  if (activeTab === 'media') return geminiEnabled() ? 'identify' : 'none';
  if (activeTab === 'games') return 'none';
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
