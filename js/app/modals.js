// modals.js — every Add/Edit modal's open/save/close/delete logic:
// books, wishlist, media, and games (including the store-link
// autofill). Split out of app.js.

// ─── BOOK MODAL ───────────────────────────────────────────────────────
function openAddModal() {
  editingId     = null;
  currentRating = 0;
  document.getElementById('modalTitle').textContent = 'Add a book';

  ['f-title', 'f-author', 'f-series', 'f-seriesIndex', 'f-notes', 'f-coverUrl', 'f-isbn', 'f-asin', 'f-ol']
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
}

function closeModal() {
  pendingScanCode = null;
  document.getElementById('modal').classList.remove('open');
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

  const status = document.querySelector('input[name="status"]:checked').value;
  const notes  = document.getElementById('f-notes').value.trim();

  if (editingId !== null) {
    const i = books.findIndex(b => b.id === editingId);
    if (i !== -1) {
      books[i] = normalizeBook({ ...books[i], title, author, series, genre, formats, status, notes, rating: currentRating, coverUrl, links,
        isbn: isbn || pendingScanCode || books[i].isbn || '', asin });
    }
  } else {
    books.push(normalizeBook({ id: newId(), title, author, series, genre, formats, status, notes, rating: currentRating, coverUrl, links,
      ...(isbn || pendingScanCode ? { isbn: isbn || pendingScanCode } : {}),
      ...(asin ? { asin } : {}) }));
  }

  save();
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
  }
  pendingTmdb = null;
  syncTmdbUI();
  document.getElementById('mediaModal').classList.add('open');
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
}

function handleMediaBackdrop(e) {
  if (e.target === document.getElementById('mediaModal')) closeMediaModal();
}

function saveMediaItem() {
  const title = document.getElementById('m-title').value.trim();
  if (!title) { document.getElementById('m-title').focus(); return; }

  const year    = document.getElementById('m-year').value.trim();
  const genre   = getGenreValues('m-genre');
  const notes   = document.getElementById('m-notes').value.trim();
  const links   = readLinksField('m');
  const type    = document.querySelector('input[name="m-type"]:checked')?.value   || 'movie';
  const status  = document.querySelector('input[name="m-status"]:checked')?.value || 'want';
  const formats = [...document.querySelectorAll('#m-format-group input[type="checkbox"]:checked')]
    .map(cb => cb.value);

  if (mediaEditingId !== null) {
    const i = mediaLibrary.findIndex(x => x.id === mediaEditingId);
    if (i !== -1) {
      mediaLibrary[i] = normalizeMediaItem({ ...mediaLibrary[i], title, type, year, genre, formats, status, notes, rating: mediaRating, links,
        ...(pendingTmdb || {}) });
    }
  } else {
    mediaLibrary.push(normalizeMediaItem({ id: newId(), title, type, year, genre, formats, status, notes, rating: mediaRating, links,
      ...(pendingTmdb || {}) }));
  }

  saveMedia();
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
  }
  if (info.platform && !document.querySelector('input[name="g-platform"]:checked')) {
    setRadio('g-platform', info.platform);
    document.getElementById('g-plat-error').style.display = 'none';
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


// ─── GAME MODAL ──────────────────────────────────────────────────────
function setGameFormats(vals) {
  document.querySelectorAll('#g-format-group input[type="checkbox"]').forEach(cb => {
    cb.checked = vals.includes(cb.value);
    cb.closest('.radio-btn').classList.toggle('active', cb.checked);
  });
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
    setRadio('g-platform', g.platform || 'ps5');
    setRadio('g-status',   g.status   || 'want');
    setGameFormats(g.formats || []);
    updateGameStars(gameRating);
  } else {
    gameEditingId = null;
    gameRating    = 0;
    document.getElementById('gameModalTitle').textContent = 'Add game';
    ['g-title', 'g-year', 'g-notes', 'g-coverUrl'].forEach(fid => document.getElementById(fid).value = '');
    setGenreValues('g-genre', []);
    setLinksField('g', []);
    setGameFormats([]);
    updateGameStars(0);
    // No default platform: picking one is the point of the field, and a
    // pre-selected PS5 quietly mislabels anything saved without touching it.
    setRadio('g-platform', '');
    setRadio('g-status',   'want');
  }
  document.getElementById('g-plat-error').style.display = 'none';
  gameFillHint('');
  document.getElementById('gameModal').classList.add('open');
  // Only when adding: focusing on edit raises the phone keyboard over the
  // form the user opened in order to read it.
  if (gameEditingId === null) document.getElementById('g-title').focus();
}

function closeGameModal() {
  document.getElementById('gameModal').classList.remove('open');
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
  const platformEl = document.querySelector('input[name="g-platform"]:checked');
  if (!platformEl) {
    document.getElementById('g-plat-error').style.display = 'block';
    document.getElementById('g-platform-group').scrollIntoView({ block: 'center' });
    return;
  }
  document.getElementById('g-plat-error').style.display = 'none';
  const platform = platformEl.value;
  const status   = document.querySelector('input[name="g-status"]:checked')?.value   || 'want';
  const formats  = [...document.querySelectorAll('#g-format-group input[type="checkbox"]:checked')]
    .map(cb => cb.value);

  if (gameEditingId !== null) {
    const i = videoGames.findIndex(x => x.id === gameEditingId);
    if (i !== -1) {
      videoGames[i] = normalizeVideoGame({ ...videoGames[i], title, platform, year, genre, formats, status, notes, coverUrl, rating: gameRating, links });
    }
  } else {
    videoGames.push(normalizeVideoGame({ id: newId(), title, platform, year, genre, formats, status, notes, coverUrl, rating: gameRating, links }));
  }

  saveGames();
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


