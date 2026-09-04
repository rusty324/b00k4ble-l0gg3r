// tmdb-autocomplete.js — the Movies & TV modal's TMDb search box,
// and the TMDb key settings modal. Split out of scanner.js.

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
  if (r.genre && r.genre.length) setGenreValues('m-genre', r.genre);
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
  ['mediaIdentifyBtn', 'bookIdentifyBtn', 'scanIdentifyBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.style.display = on ? '' : 'none';
  });
  // The wishlist button covers book and screen identification, both
  // verified against a real source (Open Library, TMDb). There is no such
  // source for games, so it hides for that type rather than guessing.
  const wlBtn = document.getElementById('wishlistIdentifyBtn');
  if (wlBtn) {
    const wlType = document.querySelector('input[name="wl-type"]:checked')?.value;
    wlBtn.style.display = (on && wlType !== 'game') ? '' : 'none';
  }
}

// From the barcode scanner, hand off to cover identification without making
// the user close and reopen: same camera, different question.
function switchToIdentify() {
  const target = activeTab === 'wishlist' ? 'wishlist' : 'books';
  stopScanCamera();
  document.getElementById('scanModal').classList.remove('open');
  document.getElementById('scanDuplicate').style.display = 'none';
  openIdentify(target);
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


