// modals.js — every Add/Edit modal's open/save/close/delete logic:
// books, wishlist, media, and games (including the store-link
// autofill). Split out of app.js.

// ─── BOOK MODAL ───────────────────────────────────────────────────────
function openAddModal() {
  editingId     = null;
  currentRating = 0;
  document.getElementById('modalTitle').textContent = 'Add a book';

  ['f-title', 'f-author', 'f-narrator', 'f-series', 'f-seriesIndex', 'f-notes', 'f-coverUrl', 'f-isbn', 'f-asin', 'f-ol']
    .forEach(id => document.getElementById(id).value = '');
  setGenreValues('f-genre', []);
  setLinksField('f', []);
  closeOlAC();
  olHint('');

  setFormats(['physical']);
  setRadio('status', 'want');
  updateStars(0);
  document.getElementById('fmt-error').style.display = 'none';
  populateDataLists();
  syncIdentifyButtons();
  document.getElementById('modal').classList.add('open');
  resetDup('books');
  document.getElementById('f-title').focus();
}

function openEditModal(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;

  editingId     = id;
  currentRating = b.rating || 0;

  document.getElementById('modalTitle').textContent = 'Edit book';
  document.getElementById('f-title').value  = b.title;
  document.getElementById('f-author').value = b.author || '';
  document.getElementById('f-narrator').value = b.narrator || '';
  setSeriesFields(b.series);
  setGenreValues('f-genre', b.genre);
  document.getElementById('f-notes').value  = b.notes || '';
  document.getElementById('f-coverUrl').value = b.coverUrl || '';
  document.getElementById('f-isbn').value = b.isbn || '';
  document.getElementById('f-asin').value = b.asin || '';
  setLinksField('f', b.links);
  document.getElementById('f-ol').value = '';
  closeOlAC();
  olHint('');

  setFormats(b.formats || ['physical']);
  setRadio('status', b.status);
  updateStars(currentRating);
  document.getElementById('fmt-error').style.display = 'none';
  populateDataLists();
  syncIdentifyButtons();
  document.getElementById('modal').classList.add('open');
  resetDup('books');      // a warning left from an earlier add must not linger here
}

// ─── WISHLIST → LIBRARY ("Got it") ────────────────────────────────────
// Bought something on the wishlist: open the matching library tab's add form
// filled in from the wishlist item, so formats, platform, status and the rest
// can be set before saving. The wishlist entry is removed only once that save
// completes; cancelling leaves it where it was and goes back to the wishlist.
// The removal needs nothing special for sync — the save point notices the id
// has gone and leaves a tombstone, like any delete.
let _wishlistMove = null;    // { id, kind, title } while an add form is filling from one

const WISH_TARGET = { book: 'books', movie: 'media', tv: 'media', game: 'games' };
const MOVE_TITLE  = 'Add from your wishlist';

function gotWishlistItem(id) {
  const w = bookWishlist.find(x => x.id === id);
  if (!w) return;
  const kind = WISH_TARGET[w.type] || 'books';
  const set = (fid, v) => { const el = document.getElementById(fid); if (el && v) el.value = v; };
  switchTab(kind);
  if (kind === 'books') {
    openAddModal();
    set('f-title', w.title); set('f-author', w.creator); set('f-isbn', w.isbn); set('f-notes', w.notes);
    setLinksField('f', w.links || []);
    document.getElementById('modalTitle').textContent = MOVE_TITLE;
  } else if (kind === 'media') {
    openMediaModal(null);
    set('m-title', w.title); set('m-notes', w.notes);
    setMediaRadio('m-type', w.type === 'tv' ? 'tv' : 'movie');
    syncMediaSeasons();
    setLinksField('m', w.links || []);
    document.getElementById('mediaModalTitle').textContent = MOVE_TITLE;
  } else {
    openGameModal(null);
    set('g-title', w.title); set('g-notes', w.notes);
    setLinksField('g', w.links || []);
    gameAutofillSoon();        // a store link ticks its own platform
    document.getElementById('gameModalTitle').textContent = MOVE_TITLE;
  }
  // Set after the open* call, which resets the form state this lives beside.
  _wishlistMove = { id, kind, title: w.title };
  paintDup(kind);              // already in the library? say so before the save
}

// After a successful add on `kind`'s form.
function completeWishlistMove(kind) {
  const move = _wishlistMove;
  if (!move || move.kind !== kind) return;
  _wishlistMove = null;
  bookWishlist = bookWishlist.filter(w => w.id !== move.id);
  saveWishlist();
  flashBanner(`Moved “${move.title}” from your wishlist into your library.`);
}

// A form closing without that save: the wishlist keeps the item, and the
// view goes back to where the move started.
function cancelWishlistMove() {
  if (!_wishlistMove) return;
  _wishlistMove = null;
  switchTab('wishlist');
}

function closeModal() {
  pendingScanCode = null;
  document.getElementById('modal').classList.remove('open');
  cancelWishlistMove();
}

function handleBackdropClick(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

// ─── STAR RATING (book modal) ─────────────────────────────────────────
function setRating(val) {
  currentRating = (currentRating === val) ? 0 : val;
  updateStars(currentRating);
}

function updateStars(val) {
  document.querySelectorAll('#modal .star-btn').forEach(btn => {
    btn.classList.toggle('lit', parseInt(btn.dataset.val) <= val);
  });
}

// ─── STAR RATING (media modal) ────────────────────────────────────────
function setMediaRating(val) {
  mediaRating = (mediaRating === val) ? 0 : val;
  updateMediaStars(mediaRating);
}

function updateMediaStars(val) {
  document.querySelectorAll('#mediaModal .star-btn').forEach(btn => {
    btn.classList.toggle('lit', parseInt(btn.dataset.val) <= val);
  });
}


// ─── BOOK SAVE / DELETE ────────────────────────────────────────────────
function saveBook() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }

  const author     = document.getElementById('f-author').value.trim();
  const seriesName = document.getElementById('f-series').value.trim();
  const seriesIdx  = document.getElementById('f-seriesIndex').value.trim();
  const series     = seriesName && seriesIdx ? `${seriesName} #${seriesIdx}` : seriesName;
  const coverUrl   = document.getElementById('f-coverUrl').value.trim();
  const isbn       = document.getElementById('f-isbn').value.replace(/[^0-9Xx]/g, '');
  // Amazon prints ASINs uppercase; accept any case and store one form so
  // duplicate detection and search do not depend on how it was typed.
  const asin       = document.getElementById('f-asin').value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const links      = readLinksField('f');

  const genre = getGenreValues('f-genre');

  const formats = [...document.querySelectorAll('#f-format-group input[type="checkbox"]:checked')]
    .map(cb => cb.value);

  if (!formats.length) {
    document.getElementById('fmt-error').style.display = 'block';
    return;
  }
  document.getElementById('fmt-error').style.display = 'none';
  if (editingId === null && dupBlocksSave('books')) return;

  const status = document.querySelector('input[name="status"]:checked').value;
  const notes  = document.getElementById('f-notes').value.trim();
  // Only an audiobook has one; normalizeBook enforces the same.
  const narrator = formats.includes('audio') ? document.getElementById('f-narrator').value.trim() : '';

  if (editingId !== null) {
    const i = books.findIndex(b => b.id === editingId);
    if (i !== -1) {
      books[i] = normalizeBook({ ...books[i], title, author, narrator, series, genre, formats, status, notes, rating: currentRating, coverUrl, links,
        isbn: isbn || pendingScanCode || books[i].isbn || '', asin });
    }
  } else {
    books.push(normalizeBook({ id: newId(), title, author, narrator, series, genre, formats, status, notes, rating: currentRating, coverUrl, links,
      ...(isbn || pendingScanCode ? { isbn: isbn || pendingScanCode } : {}),
      ...(asin ? { asin } : {}) }));
  }

  save();
  if (editingId === null) completeWishlistMove('books');
  closeModal();
  render();
}

function deleteBook(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  if (!confirm(`Delete "${b.title}"?`)) return;
  books = books.filter(x => x.id !== id);
  save();
  render();
}


// ─── WISHLIST MODAL ───────────────────────────────────────────────────
function openWishlistModal(id) {
  if (id !== null) {
    const item = bookWishlist.find(x => x.id === id);
    if (!item) return;
    wishlistEditingId = id;
    document.getElementById('wishlistModalTitle').textContent = 'Edit wishlist item';
    document.getElementById('wl-title').value  = item.title   || '';
    document.getElementById('wl-author').value = item.creator || '';
    document.getElementById('wl-notes').value  = item.notes   || '';
    setLinksField('wl', item.links);
    setRadio('wl-type', item.type || 'book');
  } else {
    wishlistEditingId = null;
    document.getElementById('wishlistModalTitle').textContent = 'Add to wishlist';
    ['wl-title', 'wl-author', 'wl-notes'].forEach(fid => document.getElementById(fid).value = '');
    setLinksField('wl', []);
    // Pre-select type based on active filter (if not 'all')
    const defaultType = (wishlistFilters.type !== 'all') ? wishlistFilters.type : 'book';
    setRadio('wl-type', defaultType);
  }
  syncIdentifyButtons();
  document.getElementById('wishlistModal').classList.add('open');
  // Only when adding: focusing on edit raises the phone keyboard over the
  // form the user opened in order to read it.
  if (wishlistEditingId === null) document.getElementById('wl-title').focus();
}

function closeWishlistModal() {
  pendingScanCode = null;
  document.getElementById('wishlistModal').classList.remove('open');
}

function handleWishlistBackdrop(e) {
  if (e.target === document.getElementById('wishlistModal')) closeWishlistModal();
}

function saveWishlistItem() {
  const title = document.getElementById('wl-title').value.trim();
  if (!title) { document.getElementById('wl-title').focus(); return; }

  const type    = document.querySelector('input[name="wl-type"]:checked')?.value || 'book';
  const creator = document.getElementById('wl-author').value.trim();
  const notes   = document.getElementById('wl-notes').value.trim();
  const links   = readLinksField('wl');

  if (wishlistEditingId !== null) {
    const i = bookWishlist.findIndex(x => x.id === wishlistEditingId);
    if (i !== -1) bookWishlist[i] = normalizeWishlistItem({ ...bookWishlist[i], type, title, creator, notes, links });
  } else {
    bookWishlist.push(normalizeWishlistItem({ id: newId(), type, title, creator, notes, links,
      ...(pendingScanCode && type === 'book' ? { isbn: pendingScanCode } : {}) }));
  }

  saveWishlist();
  closeWishlistModal();
  renderWishlist();
}

function deleteWishlistItem(id) {
  const item = bookWishlist.find(x => x.id === id);
  if (!item) return;
  if (!confirm(`Remove "${item.title}" from wishlist?`)) return;
  bookWishlist = bookWishlist.filter(x => x.id !== id);
  saveWishlist();
  renderWishlist();
}


// ─── MEDIA MODAL ─────────────────────────────────────────────────────
function setMediaRadio(name, val) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
    r.checked = r.value === val;
    r.closest('.radio-btn').classList.toggle('active', r.value === val);
  });
}

function setMediaFormats(vals) {
  document.querySelectorAll('#m-format-group input[type="checkbox"]').forEach(cb => {
    cb.checked = vals.includes(cb.value);
    cb.closest('.radio-btn').classList.toggle('active', cb.checked);
  });
}

// ─── MEDIA MODAL: EDITIONS & SEASONS ─────────────────────────────────
// Working copies for the open form. Editions are kept for every format even
// while it is unticked, so ticking DVD off and on again does not lose what was
// typed; saveMediaItem() keeps only the ticked ones (and the normalizer
// enforces the same).
let _mediaEditions    = {};         // format -> edition text
let _mediaSeasons     = new Set();  // owned season numbers
let _mediaSeasonCount = null;       // the show's total, when known
let _mediaSeasonShown = 0;          // how many season chips are on offer
let _seasonSeq        = 0;

function setMediaExtras(m) {
  _mediaEditions    = { ...((m && m.editions) || {}) };
  _mediaSeasons     = new Set((m && m.seasons) || []);
  _mediaSeasonCount = (m && m.seasonCount) || null;
  _mediaSeasonShown = 0;
  _seasonSeq++;                     // a count still arriving for the last show is stale
  renderMediaEditions();
  syncMediaSeasons();
}

const checkedMediaFormats = () =>
  [...document.querySelectorAll('#m-format-group input[type="checkbox"]:checked')].map(cb => cb.value);

// Rebuilt only when the ticked formats change, never per keystroke — typing
// writes straight into _mediaEditions, so the box being typed in keeps focus.
function renderMediaEditions() {
  const box = document.getElementById('m-editions');
  if (!box) return;
  box.innerHTML = checkedMediaFormats().filter(f => EDITION_FORMATS.includes(f)).map(f => `
    <div class="edition-row">
      <span class="edition-label">${MEDIA_FORMAT_ICON[f]} ${esc(MEDIA_FORMAT_LABEL[f])} edition <span class="opt">(optional)</span></span>
      <input type="text" class="plain" data-fmt="${f}" maxlength="120" autocomplete="off"
             aria-label="${esc(MEDIA_FORMAT_LABEL[f])} edition" placeholder="e.g. Collector's Edition"
             value="${esc(_mediaEditions[f] || '')}" oninput="setMediaEdition(this)">
    </div>`).join('');
}

function setMediaEdition(el) { _mediaEditions[el.dataset.fmt] = el.value; }

function editionsForSave() {
  const out = {};
  for (const f of checkedMediaFormats()) {
    const v = (_mediaEditions[f] || '').trim();
    if (v && EDITION_FORMATS.includes(f)) out[f] = v;
  }
  return out;
}

const mediaTypeIsTv = () => document.querySelector('input[name="m-type"]:checked')?.value === 'tv';

// Shows the Seasons group for TV only, and repaints it.
function syncMediaSeasons() {
  const group = document.getElementById('m-seasons-group');
  if (!group) return;
  const tv = mediaTypeIsTv();
  group.style.display = tv ? '' : 'none';
  if (tv) renderMediaSeasons();
}

// One chip per season up to whichever is highest: the known total, the
// highest owned, or how far "+ Season" has been pressed. At least one.
function renderMediaSeasons() {
  const box = document.getElementById('m-season-chips');
  if (!box) return;
  const n = Math.max(_mediaSeasonCount || 0, ..._mediaSeasons, _mediaSeasonShown, 1);
  _mediaSeasonShown = n;
  const all = n > 1 && _mediaSeasons.size === n && Math.max(..._mediaSeasons) === n;
  const chips = [];
  for (let i = 1; i <= n; i++) {
    const on = _mediaSeasons.has(i);
    chips.push(`<button type="button" class="fmt-chip season-chip${on ? ' active' : ''}" aria-pressed="${on}"
      aria-label="Season ${i}" onclick="toggleMediaSeason(${i})">${i}</button>`);
  }
  if (n > 1) chips.push(`<button type="button" class="fmt-chip season-all${all ? ' active' : ''}" aria-pressed="${all}"
      onclick="toggleAllMediaSeasons()">All</button>`);
  chips.push(`<button type="button" class="fmt-chip season-add" onclick="addMediaSeason()">+ Season</button>`);
  box.innerHTML = chips.join('');
  const hint = document.getElementById('m-seasons-hint');
  if (hint) hint.textContent = (_mediaSeasonCount
    ? `TMDb lists ${_mediaSeasonCount} season${_mediaSeasonCount === 1 ? '' : 's'}. `
    : '') + "Tap each season you own. Leave them all off if you don't track seasons.";
}

function toggleMediaSeason(i) {
  if (_mediaSeasons.has(i)) _mediaSeasons.delete(i); else _mediaSeasons.add(i);
  renderMediaSeasons();
}

function toggleAllMediaSeasons() {
  const n = _mediaSeasonShown;
  const all = _mediaSeasons.size === n && Math.max(..._mediaSeasons) === n;
  _mediaSeasons = new Set(all ? [] : Array.from({ length: n }, (_, k) => k + 1));
  renderMediaSeasons();
}

// Offers one more season; does not tick it — the chip is there to be tapped.
function addMediaSeason() {
  _mediaSeasonShown++;
  renderMediaSeasons();
}

// Asks TMDb how many seasons the show has. Answers that arrive after the form
// moved on (another pick, closed, switched to Movie) are dropped.
function refreshMediaSeasonCount(tmdbId) {
  if (tmdbId == null || !mediaTypeIsTv() || typeof tmdbSeasonCount !== 'function') return;
  const seq = ++_seasonSeq;
  tmdbSeasonCount(tmdbId).then(n => {
    if (seq !== _seasonSeq || !n || !mediaTypeIsTv() ||
        !document.getElementById('mediaModal').classList.contains('open')) return;
    _mediaSeasonCount = n;
    renderMediaSeasons();
  });
}

// After a TMDb or cover-identify pick has set the type and pendingTmdb.
function mediaPicked() {
  syncMediaSeasons();
  if (pendingTmdb) refreshMediaSeasonCount(pendingTmdb.tmdbId);
}

document.querySelectorAll('input[name="m-type"]').forEach(r => r.addEventListener('change', () => {
  syncMediaSeasons();
  const editing = mediaEditingId !== null ? mediaLibrary.find(x => x.id === mediaEditingId) : null;
  refreshMediaSeasonCount(pendingTmdb ? pendingTmdb.tmdbId : editing && editing.tmdbId);
}));
document.querySelectorAll('#m-format-group input[type="checkbox"]').forEach(cb =>
  cb.addEventListener('change', renderMediaEditions));

function openMediaModal(id) {
  if (id !== null && id !== undefined) {
    const m = mediaLibrary.find(x => x.id === id);
    if (!m) return;
    mediaEditingId = id;
    mediaRating    = m.rating || 0;
    document.getElementById('mediaModalTitle').textContent = 'Edit title';
    document.getElementById('m-title').value = m.title || '';
    document.getElementById('m-year').value  = m.year  || '';
    setGenreValues('m-genre', m.genre);
    document.getElementById('m-notes').value = m.notes || '';
    setLinksField('m', m.links);
    setMediaRadio('m-type',   m.type   || 'movie');
    setMediaRadio('m-status', m.status || 'want');
    setMediaFormats(m.formats || []);
    updateMediaStars(mediaRating);
    setMediaExtras(m);
    refreshMediaSeasonCount(m.tmdbId);   // a show may have gained seasons since
  } else {
    mediaEditingId = null;
    mediaRating    = 0;
    document.getElementById('mediaModalTitle').textContent = 'Add title';
    ['m-title', 'm-year', 'm-notes'].forEach(fid => document.getElementById(fid).value = '');
    setGenreValues('m-genre', []);
    setLinksField('m', []);
    setMediaFormats([]);
    updateMediaStars(0);
    setMediaRadio('m-type',   'movie');
    setMediaRadio('m-status', 'want');
    setMediaExtras(null);
  }
  pendingTmdb = null;
  syncTmdbUI();
  document.getElementById('mediaModal').classList.add('open');
  resetDup('media');
  // Only when adding, for the same reason as the wishlist form. With a key
  // set, searching is the faster path than typing every field.
  if (mediaEditingId === null) {
    const tmdbInput = document.getElementById('m-tmdb');
    if (tmdbEnabled() && tmdbInput) tmdbInput.focus();
    else document.getElementById('m-title').focus();
  }
}

function closeMediaModal() {
  pendingScanCode = null;
  pendingTmdb = null;
  closeTmdbAC();
  document.getElementById('mediaModal').classList.remove('open');
  cancelWishlistMove();
}

function handleMediaBackdrop(e) {
  if (e.target === document.getElementById('mediaModal')) closeMediaModal();
}

function saveMediaItem() {
  const title = document.getElementById('m-title').value.trim();
  if (!title) { document.getElementById('m-title').focus(); return; }
  if (mediaEditingId === null && dupBlocksSave('media')) return;

  const year    = document.getElementById('m-year').value.trim();
  const genre   = getGenreValues('m-genre');
  const notes   = document.getElementById('m-notes').value.trim();
  const links   = readLinksField('m');
  const type    = document.querySelector('input[name="m-type"]:checked')?.value   || 'movie';
  const status  = document.querySelector('input[name="m-status"]:checked')?.value || 'want';
  const formats = [...document.querySelectorAll('#m-format-group input[type="checkbox"]:checked')]
    .map(cb => cb.value);
  const editions = editionsForSave();
  const seasons  = type === 'tv' ? [..._mediaSeasons] : [];

  if (mediaEditingId !== null) {
    const i = mediaLibrary.findIndex(x => x.id === mediaEditingId);
    if (i !== -1) {
      mediaLibrary[i] = normalizeMediaItem({ ...mediaLibrary[i], title, type, year, genre, formats, status, notes, rating: mediaRating, links,
        editions, seasons, seasonCount: _mediaSeasonCount, ...(pendingTmdb || {}) });
    }
  } else {
    mediaLibrary.push(normalizeMediaItem({ id: newId(), title, type, year, genre, formats, status, notes, rating: mediaRating, links,
      editions, seasons, seasonCount: _mediaSeasonCount, ...(pendingTmdb || {}) }));
  }

  saveMedia();
  if (mediaEditingId === null) completeWishlistMove('media');
  closeMediaModal();
  renderPage();
}

function deleteMediaItem(id) {
  const m = mediaLibrary.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Delete "${m.title}"?`)) return;
  mediaLibrary = mediaLibrary.filter(x => x.id !== id);
  saveMedia();
  renderPage();
}


// ─── ALREADY IN YOUR LIBRARY? ─────────────────────────────────────────
// A note under Title, in each add form, the moment what is being added
// matches something already there — typed, or filled in by a search pick,
// a scan or a store link. Saving is never refused outright: the first Save
// shows the note, a second Save adds the copy anyway, since owning two (a
// hardback and a signed copy, say) is legitimate. Edits are not checked.
const DUP_FORMS = {
  books: {
    note: 'f-dup', fields: ['f-title', 'f-author', 'f-isbn', 'f-asin'],
    adding: () => editingId === null,
    draft: () => ({
      title:  document.getElementById('f-title').value,
      author: document.getElementById('f-author').value,
      isbn:   document.getElementById('f-isbn').value || pendingScanCode || '',
      asin:   document.getElementById('f-asin').value,
    }),
    describe: b => `“${b.title}”${b.author ? ` by ${b.author}` : ''}`,
    open: id => { closeModal(); openEditModal(id); },
  },
  media: {
    note: 'm-dup', fields: ['m-title', 'm-year'],
    adding: () => mediaEditingId === null,
    draft: () => ({
      title: document.getElementById('m-title').value,
      year:  document.getElementById('m-year').value,
      type:  document.querySelector('input[name="m-type"]:checked')?.value || 'movie',
      tmdbId: pendingTmdb ? pendingTmdb.tmdbId : null,
    }),
    describe: m => `“${m.title}” (${m.type === 'tv' ? 'TV' : 'Movie'}${m.year ? ', ' + m.year : ''})`,
    open: id => { closeMediaModal(); openMediaModal(id); },
  },
  games: {
    note: 'g-dup', fields: ['g-title'],
    adding: () => gameEditingId === null,
    draft: () => ({ title: document.getElementById('g-title').value }),
    describe: g => {
      const on = (g.platforms || []).map(p => platformLabel(p.platform)).join(', ');
      return `“${g.title}”${on ? ` on ${on}` : ''}`;
    },
    // Another platform belongs on the existing game, not on a second card.
    extra: 'Got it on another platform too? Open it and tick that platform instead.',
    open: id => { closeGameModal(); openGameModal(id); },
  },
};

const _dupAck = {};     // kind -> the match a Save has already warned about
const _dupTimer = {};

// Repaints the note for `kind` and returns the matching record, or null.
function paintDup(kind) {
  const f = DUP_FORMS[kind];
  const box = document.getElementById(f.note);
  if (!box) return null;
  const dup = f.adding() ? findDuplicate(kind, f.draft()) : null;
  if (!dup) {
    box.hidden = true;
    box.textContent = '';
    box.classList.remove('armed');
    _dupAck[kind] = undefined;          // a changed draft has to be confirmed afresh
    return null;
  }
  const t = idAsTime(dup.id);
  const when = t === null ? '' : `, added ${new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
  const armed = _dupAck[kind] === dup.id;
  box.hidden = false;
  box.classList.toggle('armed', armed);
  box.innerHTML = `<div><strong>Already in your library:</strong> ${esc(f.describe(dup))}${esc(when)}.</div>
    ${f.extra ? `<div class="dup-extra">${esc(f.extra)}</div>` : ''}
    ${armed ? '<div class="dup-armed">Tap Save again to add another copy anyway.</div>' : ''}
    <button type="button" class="btn btn-sm" onclick="openDuplicate('${kind}', ${dup.id})">Open it</button>`;
  return dup;
}

function paintDupSoon(kind) {
  clearTimeout(_dupTimer[kind]);
  _dupTimer[kind] = setTimeout(() => paintDup(kind), 150);
}

// True when Save should stop to warn. The second Save on the same match
// goes through.
function dupBlocksSave(kind) {
  // Save checks for itself, so a re-check still pending from the last
  // keystroke is cancelled: left to fire after the save, it would find the
  // record that was just added and flag the closed form as a duplicate of it.
  clearTimeout(_dupTimer[kind]);
  const dup = paintDup(kind);
  if (!dup || _dupAck[kind] === dup.id) return false;
  _dupAck[kind] = dup.id;
  paintDup(kind);                          // now with the "again" line
  document.getElementById(DUP_FORMS[kind].note)?.scrollIntoView({ block: 'center' });
  return true;
}

// Choosing the existing entry ends a wishlist move without going back to the
// wishlist: the item stays there, and the library entry opens where it lives.
function openDuplicate(kind, id) { _wishlistMove = null; DUP_FORMS[kind].open(id); }

function resetDup(kind) {
  _dupAck[kind] = undefined;
  clearTimeout(_dupTimer[kind]);
  paintDup(kind);
}

for (const [kind, f] of Object.entries(DUP_FORMS)) {
  for (const id of f.fields) document.getElementById(id)?.addEventListener('input', () => paintDupSoon(kind));
}
document.querySelectorAll('input[name="m-type"]').forEach(r =>
  r.addEventListener('change', () => paintDupSoon('media')));


// ─── GAME AUTOFILL FROM A STORE LINK ──────────────────────────────────
// Every game database and storefront API — RAWG, IGDB, Giant Bomb, Steam's
// own store API — refuses cross-origin browser requests, so there is nothing
// to *ask*. What is left is what the link itself carries, which is more than
// nothing: Steam and Xbox URLs embed a title slug, Steam embeds an app id,
// and PlayStation product codes still say which console generation they are.
//
// Year and genre are genuinely not derivable this way. They stay manual until
// there is a proxy to ask a real database through (issue #32).

// Steam serves box art from a deterministic path that needs no API call, and
// an <img> is not subject to CORS at all — so this one field really can be
// filled from the id alone.
const STEAM_HEADER = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;

// A PlayStation product id reads <publisher>-<titleId>_<ver>-<sku>, e.g.
// UP2074-CUSA24024_00-HADES0000000000. The console lives in the *title id*,
// the middle segment — not at the front, which is the publisher.
//
//   NPUB/NPEB/BLUS/BLES/BCUS/BCES → PS3
//   PPSA                          → PS5 (native)
//   CUSA                          → PS4, and PS5 plays it too, so it cannot
//                                   decide between the two and says nothing
function psPlatformFromCode(productId) {
  const titleId = String(productId || '').toUpperCase().split('-')[1] || '';
  if (/^(NP[UEHJK][ABC]|BL[UE]S|BC[UE]S)/.test(titleId)) return 'ps3';
  if (/^PPSA/.test(titleId)) return 'ps5';
  return '';
}

// "Half_Life_2" -> "Half Life 2", "forza-horizon-5" -> "Forza Horizon 5".
// Lossy by construction: Steam strips apostrophes and punctuation out of its
// slugs, so this is a starting point to correct, not an authority.
function titleFromSlug(slug) {
  const words = decodeURIComponent(String(slug || ''))
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return '';
  return /[a-z]/.test(words) && words === words.toLowerCase()
    ? words.replace(/\b[a-z]/g, c => c.toUpperCase())   // an all-lowercase slug
    : words;                                            // already cased
}

// -> { platform, title, coverUrl, store } — every field optional.
function parseGameStoreLink(raw) {
  const url = safeUrl(raw);
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  const scheme = u.protocol.slice(0, -1);

  // steam://store/<id>, steam://run/<id>
  if (scheme === 'steam') {
    const id = (segs[segs.length - 1] || u.host || '').match(/^\d+$/);
    return { store: 'Steam', platform: 'steam', title: '',
             coverUrl: id ? STEAM_HEADER(id[0]) : '' };
  }

  // store.steampowered.com/app/<id>/<Slug>/  — the slug is often absent
  if (host === 'steampowered.com' || host.endsWith('.steampowered.com')) {
    const i = segs.indexOf('app');
    const id = i !== -1 ? segs[i + 1] : null;
    return { store: 'Steam', platform: 'steam',
             title: i !== -1 ? titleFromSlug(segs[i + 2]) : '',
             coverUrl: /^\d+$/.test(id || '') ? STEAM_HEADER(id) : '' };
  }
  // s.team/a/<id> is Valve's shortener for the same page.
  if (host === 's.team' || host === 'steamcommunity.com') {
    const id = segs.find(s => /^\d+$/.test(s));
    return { store: 'Steam', platform: 'steam', title: '',
             coverUrl: id ? STEAM_HEADER(id) : '' };
  }

  if (host === 'playstation.com' || host.endsWith('.playstation.com')
      || scheme === 'com.scee.psxandroid' || scheme === 'playstation') {
    const i = segs.indexOf('product');
    return { store: 'PlayStation', platform: i !== -1 ? psPlatformFromCode(segs[i + 1]) : '',
             title: '', coverUrl: '' };
  }

  if (host === 'xbox.com' || host.endsWith('.xbox.com')
      || host === 'microsoft.com' || host.endsWith('.microsoft.com')) {
    const i = segs.indexOf('store');
    // .../games/store/<slug>/<productId>
    const slug = i !== -1 && segs[i - 1] === 'games' ? segs[i + 1] : '';
    return { store: 'Xbox', platform: 'xbox', title: titleFromSlug(slug), coverUrl: '' };
  }

  return null;
}

// Only fill a field the user has left empty — a link should never overwrite
// something typed by hand.
function gameFillHint(msg) {
  const el = document.getElementById('g-fillHint');
  if (el) el.textContent = msg || '';
}

// An <img> load is the only way to ask whether Steam has art for an id
// without an API, and it is free of CORS. Resolves false rather than throwing.
function imageLoads(url, ms = 6000) {
  return new Promise(resolve => {
    const img = new Image();
    const done = ok => { clearTimeout(timer); img.onload = img.onerror = null; resolve(ok); };
    const timer = setTimeout(() => done(false), ms);
    img.onload  = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = url;
  });
}

let _gameFillTimer = null;
let _gameFillSeq = 0;

async function gameAutofillFromLinks() {
  const seq = ++_gameFillSeq;
  const links = readLinksField('g');
  let info = null;
  for (const l of links) { info = parseGameStoreLink(l); if (info) break; }
  if (!info) { gameFillHint(''); return; }

  const titleEl = document.getElementById('g-title');
  const coverEl = document.getElementById('g-coverUrl');
  const filled = [];

  if (info.title && titleEl && !titleEl.value.trim()) {
    titleEl.value = info.title;
    filled.push('title');
    paintDup('games');
  }
  // Adds to the list rather than replacing it: a Steam link on a game already
  // marked Xbox means both, which is exactly the case the list exists for.
  if (info.platform && !_gamePlatforms.some(p => p.platform === info.platform)) {
    toggleGamePlatform(info.platform);
    filled.push('platform');
  }

  if (info.coverUrl && coverEl && !coverEl.value.trim()) {
    gameFillHint(filled.length
      ? `Filled ${filled.join(' and ')} from the ${info.store} link — checking for cover art…`
      : `Checking ${info.store} for cover art…`);
    const ok = await imageLoads(info.coverUrl);
    if (seq !== _gameFillSeq) return;              // the field changed again
    if (ok && !coverEl.value.trim()) { coverEl.value = info.coverUrl; filled.push('cover'); }
  }
  if (seq !== _gameFillSeq) return;

  gameFillHint(filled.length
    ? `Filled ${filled.join(', ')} from the ${info.store} link. `
      + 'Year and genre are not in the link — no game database allows a browser to ask.'
    : `Recognised a ${info.store} link, but nothing left to fill in.`);
}

function gameAutofillSoon() {
  clearTimeout(_gameFillTimer);
  _gameFillTimer = setTimeout(gameAutofillFromLinks, 350);
}


// ─── GAME MODAL: PLATFORMS ───────────────────────────────────────────
// The form's working copy of the record's `platforms` list. Held here rather
// than read back out of the DOM at save time because a platform's formats
// have to survive it being unticked and reticked within one editing session.
let _gamePlatforms = [];   // [{ platform, formats }]

const gamePlatformsBox = () => document.getElementById('g-platform-entries');

// Known platforms in the order the buttons offer them; anything unknown that
// came in on an existing record keeps its own place at the end.
function sortGamePlatforms() {
  _gamePlatforms.sort((a, b) => {
    const ia = GAME_PLATFORMS.indexOf(a.platform), ib = GAME_PLATFORMS.indexOf(b.platform);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function setGamePlatforms(list) {
  _gamePlatforms = (Array.isArray(list) ? list : []).map(p => ({
    platform: p.platform, formats: [...(p.formats || [])],
  }));
  sortGamePlatforms();
  syncGamePlatformPicks();
  platformEditor.render();
}

// The tick boxes follow the list, not the other way round — removing a row
// with its × has to clear the button too.
function syncGamePlatformPicks() {
  document.querySelectorAll('input[name="g-plat-pick"]').forEach(cb => {
    cb.checked = _gamePlatforms.some(p => p.platform === cb.value);
    cb.closest('.radio-btn').classList.toggle('active', cb.checked);
  });
}

// The rows under the platform buttons. PS Plus is a PlayStation subscription,
// so it is only offered where it could be true — the normalizer drops it
// elsewhere regardless.
const platformEditor = createRowEditor({
  box: 'g-platform-entries',
  rows: () => _gamePlatforms,
  label: p => platformLabel(p.platform),
  chips: p => formatsFor(p.platform).map(f =>
    ({ key: f, text: `${GAME_FORMAT_ICON[f]} ${GAME_FORMAT_LABEL[f]}`, on: p.formats.includes(f) })),
  onChip: (p, f) => {
    const i = p.formats.indexOf(f);
    if (i === -1) p.formats.push(f); else p.formats.splice(i, 1);
  },
  // The × unticks the matching button too, so the two never disagree.
  onRemove: p => {
    _gamePlatforms = _gamePlatforms.filter(x => x !== p);
    syncGamePlatformPicks();
  },
});

// From a platform button. Unticking drops that platform's formats with it —
// they describe a copy the user just said they do not have.
function toggleGamePlatform(value) {
  const i = _gamePlatforms.findIndex(p => p.platform === value);
  if (i === -1) _gamePlatforms.push({ platform: value, formats: [] });
  else _gamePlatforms.splice(i, 1);
  sortGamePlatforms();
  syncGamePlatformPicks();
  platformEditor.render();
  if (_gamePlatforms.length) hideGamePlatformError();
}

// ─── GAME MODAL: DLC ─────────────────────────────────────────────────
// Working copy, like _gamePlatforms.
let _gameDlc = [];   // [{ name, owned }]

function setGameDlc(list) {
  _gameDlc = (Array.isArray(list) ? list : []).map(d => ({ name: d.name, owned: d.owned !== false }));
  const input = document.getElementById('g-dlc');
  if (input) input.value = '';
  dlcEditor.render();
}

// One row per add-on: its name, a chip that flips Owned/Wishlist, and ×.
const dlcEditor = createRowEditor({
  box: 'g-dlc-entries',
  rows: () => _gameDlc,
  label: d => d.name,
  labelClass: 'dlc-name',
  chips: d => [{ key: 'owned', text: d.owned ? '✓ Owned' : 'Wishlist', on: d.owned }],
  onChip: d => { d.owned = !d.owned; },
  onRemove: (d, i) => { _gameDlc.splice(i, 1); },
});

// Trimmed, non-empty and not already listed (case-insensitively, the same fold
// the genre pills use). Returns whether a row was added.
function commitGameDlc() {
  const input = document.getElementById('g-dlc');
  const name = (input ? input.value : '').trim();
  if (input) input.value = '';
  if (!name || _gameDlc.some(d => d.name.toLowerCase() === name.toLowerCase())) return false;
  _gameDlc.push({ name, owned: true });
  dlcEditor.render();
  return true;
}

// Enter adds, rather than submitting or doing nothing — and a comma is a name
// character here ("Awakening, Part 2"), so unlike genres it is left alone.
function gameDlcKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  commitGameDlc();
}

function hideGamePlatformError() {
  const el = document.getElementById('g-plat-error');
  if (el) el.style.display = 'none';
}

// ─── STAR RATING (game modal) ──────────────────────────────────────────
function setGameRating(val) {
  gameRating = (gameRating === val) ? 0 : val;
  updateGameStars(gameRating);
}

function updateGameStars(val) {
  document.querySelectorAll('#gameModal .star-btn').forEach(btn => {
    btn.classList.toggle('lit', parseInt(btn.dataset.val) <= val);
  });
}

function openGameModal(id) {
  if (id !== null && id !== undefined) {
    const g = videoGames.find(x => x.id === id);
    if (!g) return;
    gameEditingId = id;
    gameRating    = g.rating || 0;
    document.getElementById('gameModalTitle').textContent = 'Edit game';
    document.getElementById('g-title').value    = g.title || '';
    document.getElementById('g-year').value     = g.year  || '';
    setGenreValues('g-genre', g.genre);
    document.getElementById('g-notes').value    = g.notes || '';
    document.getElementById('g-coverUrl').value = g.coverUrl || '';
    setLinksField('g', g.links);
    setGamePlatforms(g.platforms);
    setGameDlc(g.dlc);
    setRadio('g-status',   g.status   || 'want');
    updateGameStars(gameRating);
  } else {
    gameEditingId = null;
    gameRating    = 0;
    document.getElementById('gameModalTitle').textContent = 'Add game';
    ['g-title', 'g-year', 'g-notes', 'g-coverUrl'].forEach(fid => document.getElementById(fid).value = '');
    setGenreValues('g-genre', []);
    setLinksField('g', []);
    updateGameStars(0);
    // No default platform: picking one is the point of the field, and a
    // pre-selected PS5 quietly mislabels anything saved without touching it.
    setGamePlatforms([]);
    setGameDlc([]);
    setRadio('g-status',   'want');
  }
  hideGamePlatformError();
  gameFillHint('');
  document.getElementById('gameModal').classList.add('open');
  resetDup('games');
  // Only when adding: focusing on edit raises the phone keyboard over the
  // form the user opened in order to read it.
  if (gameEditingId === null) document.getElementById('g-title').focus();
}

function closeGameModal() {
  document.getElementById('gameModal').classList.remove('open');
  cancelWishlistMove();
}

function handleGameBackdrop(e) {
  if (e.target === document.getElementById('gameModal')) closeGameModal();
}

function saveGameItem() {
  const title = document.getElementById('g-title').value.trim();
  if (!title) { document.getElementById('g-title').focus(); return; }

  const year     = document.getElementById('g-year').value.trim();
  const genre    = getGenreValues('g-genre');
  const notes    = document.getElementById('g-notes').value.trim();
  const coverUrl = document.getElementById('g-coverUrl').value.trim();
  const links    = readLinksField('g');
  if (!_gamePlatforms.length) {
    document.getElementById('g-plat-error').style.display = 'block';
    document.getElementById('g-platform-group').scrollIntoView({ block: 'center' });
    return;
  }
  hideGamePlatformError();
  if (gameEditingId === null && dupBlocksSave('games')) return;
  commitGameDlc();            // a name typed but not yet Entered still counts
  const dlc = _gameDlc.map(d => ({ name: d.name, owned: d.owned }));
  const platforms = _gamePlatforms.map(p => ({ platform: p.platform, formats: [...p.formats] }));
  const status    = document.querySelector('input[name="g-status"]:checked')?.value || 'want';

  if (gameEditingId !== null) {
    const i = videoGames.findIndex(x => x.id === gameEditingId);
    if (i !== -1) {
      // platform/formats are spread in from the stored record when it predates
      // the list; normalizeVideoGame drops them once `platforms` is present.
      videoGames[i] = normalizeVideoGame({ ...videoGames[i], title, platforms, dlc, year, genre, status, notes, coverUrl, rating: gameRating, links });
    }
  } else {
    videoGames.push(normalizeVideoGame({ id: newId(), title, platforms, dlc, year, genre, status, notes, coverUrl, rating: gameRating, links }));
  }

  saveGames();
  if (gameEditingId === null) completeWishlistMove('games');
  closeGameModal();
  renderPage();
}

function deleteGameItem(id) {
  const g = videoGames.find(x => x.id === id);
  if (!g) return;
  if (!confirm(`Delete "${g.title}"?`)) return;
  videoGames = videoGames.filter(x => x.id !== id);
  saveGames();
  renderPage();
}


