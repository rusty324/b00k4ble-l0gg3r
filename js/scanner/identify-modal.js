// identify-modal.js — cover identification's UI layer: the
// identify camera modal, and the Gemini key settings modal.
// Split out of scanner.js.

// ─── IDENTIFY MODAL ───────────────────────────────────────────────────
function setIdentifyStatus(msg, isError) {
  const el = document.getElementById('identifyStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('scan-status-error', !!isError);
}

function identifyKindFor(target) {
  if (target === 'books') return 'book';
  if (target === 'media') return 'screen';
  const t = document.querySelector('input[name="wl-type"]:checked');
  return t && t.value === 'book' ? 'book' : 'screen';
}

async function openIdentify(target) {
  _identifyTarget  = target
    || (activeTab === 'books' ? 'books' : activeTab === 'wishlist' ? 'wishlist' : 'media');
  _identifyKind    = identifyKindFor(_identifyTarget);
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
  setIdentifyStatus(_identifyKind === 'book'
    ? 'Fill the frame with the front cover or spine, then tap Identify.'
    : 'Fill the frame with the front of the case, then tap Identify.');
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
    identified = await identifyCover(shot.base64, _identifyKind);
  } catch (err) {
    _identifyBusy = false;
    setIdentifyCaptureEnabled(true);
    setIdentifyStatus(err.message || 'Could not identify this cover.', true);
    return;
  }

  // Books verify against Open Library, which needs no key. Films need TMDb;
  // without it there is nothing to check against, so hand over the raw title.
  if (_identifyKind !== 'book' && !tmdbEnabled()) {
    finishIdentify(identified, []);
    return;
  }

  setIdentifyStatus(_identifyKind === 'book'
    ? 'Checking against Open Library…' : 'Checking against TMDb…');
  let matches = [];
  try {
    matches = _identifyKind === 'book'
      ? await verifyBookAgainstOpenLibrary(identified)
      : await verifyAgainstTmdb(identified);
  } catch { matches = []; }
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
  const isBook = _identifyKind === 'book';
  box.innerHTML = _identifyResults.map((r, i) => {
    const img = isBook ? r.coverUrl : r.posterUrl;
    const fallback = isBook ? '📚' : (r.type === 'tv' ? '📺' : '🎬');
    const sub = isBook
      ? [r.author, r.year].filter(Boolean).map(esc).join(' · ')
      : `${r.type === 'tv' ? '📺 TV' : '🎬 Movie'}${r.year ? ' · ' + esc(r.year) : ''}`;
    return `
    <div class="ac-item tmdb-item" onclick="pickIdentifyResult(${i})">
      ${img
        ? `<img class="tmdb-thumb" src="${esc(img)}" alt="" loading="lazy">`
        : `<div class="tmdb-thumb tmdb-thumb-empty">${fallback}</div>`}
      <div class="tmdb-meta">
        <div class="tmdb-title">${esc(r.title)}</div>
        <div class="tmdb-sub">${sub}</div>
      </div>
    </div>`;
  }).join('');
  box.style.display = 'block';
}

function pickIdentifyResult(i) {
  const r = _identifyResults[i];
  if (!r) return;
  stopScanCamera();
  document.getElementById('identifyModal').classList.remove('open');

  if (_identifyTarget === 'books') {
    openAddModal();
    document.getElementById('f-title').value  = r.title;
    document.getElementById('f-author').value = r.author || '';
    if (r.coverUrl) document.getElementById('f-coverUrl').value = r.coverUrl;
    // An ISBN from Open Library gives this book the same duplicate detection
    // a scanned one gets.
    if (r.isbn) pendingScanCode = r.isbn;
    return;
  }

  if (_identifyTarget === 'wishlist') {
    openWishlistModal(null);
    document.getElementById('wl-title').value = r.title;
    if (_identifyKind === 'book') {
      document.getElementById('wl-author').value = r.author || '';
      setRadio('wl-type', 'book');
    } else {
      setRadio('wl-type', r.type);
    }
    return;
  }

  openMediaModal(null);
  document.getElementById('m-title').value = r.title;
  document.getElementById('m-year').value  = r.year || '';
  if (r.genre && r.genre.length) setGenreValues('m-genre', r.genre);
  setMediaRadio('m-type', r.type);
  // Same handoff tmdbPick uses, so posters and the save path work unchanged.
  pendingTmdb = { tmdbId: r.tmdbId, posterUrl: r.posterUrl || '' };
  tmdbHint(`Identified from the cover: ${r.title}${r.year ? ' (' + r.year + ')' : ''}`);
}

function openIdentifyFallbackForm(guess, identified) {
  const first = identified.candidates[0];

  if (_identifyTarget === 'books') {
    openAddModal();
    if (guess) document.getElementById('f-title').value = guess;
    if (first && first.author) document.getElementById('f-author').value = first.author;
    return;
  }

  if (_identifyTarget === 'wishlist') {
    openWishlistModal(null);
    if (guess) document.getElementById('wl-title').value = guess;
    if (_identifyKind === 'book') {
      if (first && first.author) document.getElementById('wl-author').value = first.author;
      setRadio('wl-type', 'book');
    } else {
      setRadio('wl-type', (first && first.type) || 'movie');
    }
    return;
  }
  openMediaModal(null);
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


