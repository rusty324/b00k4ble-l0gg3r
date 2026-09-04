// ui-chrome.js — shared modal/UI chrome used across every tab: the
// cover lightbox, the body scroll lock, small form helpers (series
// fields, format/radio syncing), the author/series datalists, and
// the genre pill editor shared by the Books, Movies & TV and Games
// forms. Split out of app.js.

// ─── COVER LIGHTBOX ───────────────────────────────────────────────────

// Thumbnails are deliberately small — Open Library at -M, TMDb at w342 — so
// showing that same file full-screen would just be a blurry upscale. Both
// services key the size off the URL, so ask for a larger variant and fall
// back to the thumbnail if that variant does not exist.
function fullSizeCover(url) {
  return String(url || '')
    .replace(/^(https:\/\/covers\.openlibrary\.org\/b\/\w+\/[^/]+)-[SML]\.jpg$/i, '$1-L.jpg')
    .replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+\//i, '$1w780/');
}

function openCover(src, alt) {
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!box || !img || !src) return;

  const full = fullSizeCover(src);
  // If the larger variant 404s, drop back to the thumbnail rather than
  // leaving a broken image behind. Guarded so a failing thumbnail cannot
  // loop back onto itself.
  img.onerror = () => { if (img.src !== src) img.src = src; };
  img.src = full;
  img.alt = alt || '';
  box.classList.add('open');           // MutationObserver takes the scroll lock
}

function closeCover() {
  const box = document.getElementById('lightbox');
  if (box) box.classList.remove('open');
}

// Delegated, so it covers all four render sites and the covers that arrive
// later from the lazy-load observer, which builds its <img> in JS.
document.addEventListener('click', e => {
  const img = e.target.closest && e.target.closest('.book-card-cover, .book-row-thumb');
  if (!img) return;
  e.preventDefault();
  e.stopPropagation();
  openCover(img.getAttribute('src'), img.getAttribute('alt'));
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const box = document.getElementById('lightbox');
  if (box && box.classList.contains('open')) closeCover();
});


// ─── BODY SCROLL LOCK (while a modal is open) ─────────────────────────
// Driven by a MutationObserver rather than by each open/close function, so
// every path is covered — buttons, backdrop clicks, Escape, and the
// scanner's own teardown — with no call sites to keep in sync.
let _scrollLockY = 0;

function syncBodyScrollLock() {
  const anyOpen = !!document.querySelector('.modal-backdrop.open');
  const locked  = document.body.classList.contains('modal-open');
  if (anyOpen === locked) return;

  if (anyOpen) {
    _scrollLockY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${_scrollLockY}px`;
    document.body.classList.add('modal-open');
  } else {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    // Flush layout first: while the body was fixed the document collapsed, and
    // scrolling before it reflows can clamp short of the saved offset.
    void document.body.offsetHeight;
    window.scrollTo(0, _scrollLockY);   // instant, so the page does not jump
  }
}

document.querySelectorAll('.modal-backdrop').forEach(el => {
  new MutationObserver(syncBodyScrollLock)
    .observe(el, { attributes: true, attributeFilter: ['class'] });
});


// ─── MODAL HELPERS ────────────────────────────────────────────────────
// Stored as one "Name #N" string, edited as two inputs. Shared so the Audible
// lookup splits it exactly the way opening an existing book does.
function setSeriesFields(series) {
  const m = (series || '').match(/^(.+?)[\s#]+(\d+(?:\.\d+)?)$/);
  document.getElementById('f-series').value      = m ? m[1].trim() : (series || '');
  document.getElementById('f-seriesIndex').value = m ? m[2] : '';
}

// setFormats() replaces the whole selection; this adds one, keeping whatever
// the user already ticked. The .active class is what actually looks checked.
function tickFormat(value) {
  const cb = document.querySelector(`#f-format-group input[value="${value}"]`);
  if (!cb || cb.checked) return;
  cb.checked = true;
  cb.closest('.radio-btn').classList.add('active');
}

function setFormats(vals) {
  document.querySelectorAll('#f-format-group input[type="checkbox"]').forEach(cb => {
    cb.checked = vals.includes(cb.value);
    cb.closest('.radio-btn').classList.toggle('active', cb.checked);
  });
}

function setRadio(name, val) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
    r.checked = r.value === val;
    r.closest('.radio-btn').classList.toggle('active', r.value === val);
  });
}

// Sync radio active class on change — covers all modals
document.querySelectorAll('.radio-btn input[type="radio"]').forEach(r => {
  r.addEventListener('change', function() {
    this.closest('.radio-group').querySelectorAll('.radio-btn').forEach(l => l.classList.remove('active'));
    this.closest('.radio-btn').classList.add('active');
    // Picking Game live-hides the identify button. Opening the modal sets
    // the type via setRadio(), which assigns .checked directly and so does
    // not fire this event — openWishlistModal() calls syncIdentifyButtons()
    // itself right after, covering that path separately.
    if (this.name === 'wl-type') syncIdentifyButtons();
  });
});

// Sync book format checkbox styling
document.querySelectorAll('#f-format-group input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', function() {
    this.closest('.radio-btn').classList.toggle('active', this.checked);
  });
});

// Sync media format checkbox styling
document.querySelectorAll('#m-format-group input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', function() {
    this.closest('.radio-btn').classList.toggle('active', this.checked);
  });
});

// Sync game format checkbox styling
document.querySelectorAll('#g-format-group input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', function() {
    this.closest('.radio-btn').classList.toggle('active', this.checked);
  });
});


// ─── DATALISTS (author & series autocomplete) ─────────────────────────
function populateDataLists() {
  const authors = [...new Set(books.map(b => b.author).filter(Boolean))].sort();
  document.getElementById('dl-authors').innerHTML =
    authors.map(a => `<option value="${esc(a)}">`).join('');

  const seriesNames = [...new Set(
    books.map(b => {
      if (!b.series) return null;
      const m = b.series.match(/^(.+?)[\s#]+\d+(?:\.\d+)?$/);
      return m ? m[1].trim() : b.series;
    }).filter(Boolean)
  )].sort();

  document.getElementById('dl-series').innerHTML =
    seriesNames.map(s => `<option value="${esc(s)}">`).join('');
}


// ─── GENRE PILL EDITOR ─────────────────────────────────────────────────
// One implementation behind all three genre fields (and the books tab's old
// tags field before it). The input holds only the genre currently being
// typed; committing it — Enter, a comma, or picking a suggestion — turns it
// into a pill below the field and clears the input for the next one. A pill
// is a two-tap delete: the first tap arms it (shows ×), the second removes
// it, so a stray tap on a card full of pills cannot delete one by accident.
//
// Every suggestion comes from the user's own records. Nothing is seeded, so
// the list can never offer a word they did not choose themselves.
const GENRE_AC_OPTIONS = {
  'f-genre': () => allBookGenres(),
  'g-genre': () => allGameGenres(),
  'm-genre': () => allMediaGenres(),
};

// Genres, deduplicated case-insensitively with the first-seen casing kept —
// the whole point is that "Adventure" typed once becomes *the* suggestion
// afterwards, not that "adventure" accumulates alongside it.
function distinctGenres(items) {
  const seen = new Map();
  items.forEach(it => (it.genre || []).forEach(raw => {
    const value = String(raw).trim();
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function allGameGenres()  { return distinctGenres(videoGames); }
function allMediaGenres() { return distinctGenres(mediaLibrary); }

// ---- committed pills: the source of truth once a genre is no longer being
// typed. Keyed by the field's input id, same convention as GENRE_AC_OPTIONS.
const _genrePills = {};   // inputId -> string[]
const _armedPill  = {};   // inputId -> the one pill currently showing its ×

const genrePillsBox = inputId => document.getElementById(`${inputId}-pills`);

// Called when a modal opens, with what the record already has.
function setGenreValues(inputId, values) {
  _genrePills[inputId] = Array.isArray(values) ? [...values] : [];
  _armedPill[inputId] = undefined;
  const input = document.getElementById(inputId);
  if (input) input.value = '';
  renderGenrePills(inputId);
}

// Called at save time. Whatever is still sitting unsubmitted in the text box
// counts too — pressing Save is as much a commit as pressing Enter would
// have been, so a genre typed and not yet confirmed is not silently dropped.
function getGenreValues(inputId) {
  commitGenreInput(inputId, document.getElementById(inputId)?.value);
  return _genrePills[inputId] || [];
}

function renderGenrePills(inputId) {
  const box = genrePillsBox(inputId);
  if (!box) return;
  const values = _genrePills[inputId] || [];
  const armed  = _armedPill[inputId];
  box.innerHTML = values.map(v => `
    <button type="button" class="genre-pill${v === armed ? ' armed' : ''}"
            data-val="${esc(v)}" onclick="handleGenrePillClick('${inputId}', this)"
            aria-label="${armed === v ? `Remove ${esc(v)}` : esc(v)}">
      <span class="genre-pill-text">${esc(v)}</span>
      <span class="genre-pill-x" aria-hidden="true">&times;</span>
    </button>`).join('');
}

// First tap arms (shows ×, and disarms any other pill in this field); a
// second tap on the SAME pill removes it. Tapping a different pill re-arms
// there instead of removing the first one outright.
function handleGenrePillClick(inputId, el) {
  const value = el.dataset.val;
  if (_armedPill[inputId] === value) {
    _genrePills[inputId] = (_genrePills[inputId] || []).filter(v => v !== value);
    _armedPill[inputId] = undefined;
  } else {
    _armedPill[inputId] = value;
  }
  renderGenrePills(inputId);
}

// Clicking anywhere outside a field's pills disarms it — the same
// click-away-to-cancel the genre filter menu and the settings menu use.
//
// composedPath(), not e.target.closest(): the pill's own click handler
// above rebuilds the pills container's innerHTML BEFORE this bubble-phase
// listener runs, which detaches the clicked button from the document. A
// closest() lookup on a detached node can no longer find its way back up
// to the container, so an arming click would immediately read as "outside"
// and disarm itself in the same event. composedPath() is captured once at
// dispatch time and is unaffected by DOM mutations that happen in between.
document.addEventListener('click', e => {
  const path = e.composedPath();
  for (const inputId of Object.keys(_armedPill)) {
    if (_armedPill[inputId] === undefined) continue;
    const box = genrePillsBox(inputId);
    if (box && path.includes(box)) continue;
    _armedPill[inputId] = undefined;
    renderGenrePills(inputId);
  }
});

// Trimmed, non-empty, and not already present (case-insensitively — the
// same fold the suggestions and the filter menu use).
function commitGenrePill(inputId, raw) {
  const value = String(raw || '').trim();
  if (!value) return false;
  const list = _genrePills[inputId] || (_genrePills[inputId] = []);
  if (list.some(v => v.toLowerCase() === value.toLowerCase())) return false;
  list.push(value);
  return true;
}

// Commits whatever is in the box right now — used by Enter, blur-to-save,
// and the comma path below — and always clears the input and repaints.
function commitGenreInput(inputId, raw) {
  const changed = commitGenrePill(inputId, raw);
  const input = document.getElementById(inputId);
  if (input) input.value = '';
  if (changed) renderGenrePills(inputId);
  closeListAC(inputId);
  return changed;
}

let _listACIndex = -1;

// The box always sits immediately after its input, so its id is derivable.
const listACBox = inputId => document.getElementById(`${inputId}-ac`);

// Fires on every keystroke. A typed comma commits everything before it as
// pills immediately — pasting "Action, RPG, Platformer" files all three
// rather than leaving them stuck behind a comma in the text box — and
// leaves only the part after the last comma for the suggestion box to work
// against.
function genrePillInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  if (input.value.includes(',')) {
    const parts = input.value.split(',');
    const remainder = parts.pop();
    let any = false;
    parts.forEach(p => { if (commitGenrePill(inputId, p)) any = true; });
    if (any) renderGenrePills(inputId);
    input.value = remainder.replace(/^\s+/, '');
  }

  genreAC(inputId);
}

function genreAC(inputId) {
  const input = document.getElementById(inputId);
  const ac    = listACBox(inputId);
  if (!input || !ac) return;

  const query = input.value.trim().toLowerCase();
  if (!query) { closeListAC(inputId); return; }

  const already = new Set((_genrePills[inputId] || []).map(v => v.toLowerCase()));
  const matches = (GENRE_AC_OPTIONS[inputId]?.() || [])
    .filter(t => t.toLowerCase().includes(query) && !already.has(t.toLowerCase()))
    // A prefix match is what was meant far more often than a mid-word one,
    // so "adv" offers "Adventure" before "Point-and-click Adventure".
    .sort((a, b) => (a.toLowerCase().startsWith(query) ? 0 : 1)
                  - (b.toLowerCase().startsWith(query) ? 0 : 1)
                  || a.localeCompare(b));

  if (!matches.length) { closeListAC(inputId); return; }

  _listACIndex = -1;
  ac.innerHTML = matches.map(t =>
    `<div class="ac-item" data-val="${esc(t)}" onmousedown="pickGenreValue('${inputId}', this.dataset.val)">${esc(t)}</div>`
  ).join('');
  ac.style.display = 'block';
}

function genreACKey(inputId, e) {
  const ac = listACBox(inputId);
  const items = ac && ac.style.display !== 'none' ? ac.querySelectorAll('.ac-item') : [];

  if (items.length && e.key === 'ArrowDown') {
    e.preventDefault();
    _listACIndex = Math.min(_listACIndex + 1, items.length - 1);
  } else if (items.length && e.key === 'ArrowUp') {
    e.preventDefault();
    _listACIndex = Math.max(_listACIndex - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    // A highlighted suggestion wins; otherwise commit whatever was typed.
    if (items.length && _listACIndex >= 0) pickGenreValue(inputId, items[_listACIndex].dataset.val);
    else commitGenreInput(inputId, e.target.value);
    return;
  } else if (e.key === 'Escape') {
    closeListAC(inputId);
    return;
  } else {
    return;
  }
  items.forEach((el, i) => el.classList.toggle('ac-active', i === _listACIndex));
  if (items[_listACIndex]) items[_listACIndex].scrollIntoView({ block: 'nearest' });
}

// A suggestion is picked directly, unlike typed text — dedup still applies,
// since the same genre can be reached by typing it out in full.
function pickGenreValue(inputId, value) {
  commitGenreInput(inputId, value);
  document.getElementById(inputId)?.focus();
}

function closeListAC(inputId) {
  const ac = listACBox(inputId);
  if (ac) ac.style.display = 'none';
  _listACIndex = -1;
}

// Named wrappers, because the inline handlers in index.html read better as
// bookGenreAC() than as genrePillInput('f-genre').
function bookGenreAC()      { genrePillInput('f-genre'); }
function bookGenreACKey(e)  { genreACKey('f-genre', e); }
function closeBookGenreAC() { commitGenreInput('f-genre', document.getElementById('f-genre')?.value); }

function gameGenreAC()      { genrePillInput('g-genre'); }
function gameGenreACKey(e)  { genreACKey('g-genre', e); }
function closeGameGenreAC() { commitGenreInput('g-genre', document.getElementById('g-genre')?.value); }

function mediaGenreAC()      { genrePillInput('m-genre'); }
function mediaGenreACKey(e)  { genreACKey('m-genre', e); }
function closeMediaGenreAC() { commitGenreInput('m-genre', document.getElementById('m-genre')?.value); }

