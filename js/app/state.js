// state.js — the four collections (books, mediaLibrary, videoGames,
// bookWishlist), their localStorage persistence, and the ghsync bridge.
// Split out of app.js. Depends on normalize.js/core.js (normalizeBook
// and friends), loaded just after it.

// ─── APPLICATION STATE ────────────────────────────────────────────────

// Books library
let books = JSON.parse(localStorage.getItem('myLibrary') || '[]').map(normalizeBook);

// Book filters / pagination
let filters = { format: 'all', status: 'all', genres: [] };
let currentPage = 1;
let editingId = null;
let currentRating = 0;
let searchTimer = null;
let viewMode = localStorage.getItem('viewMode') || 'card';

// Performance caches
let _filteredCache = null;
let _filteredCacheKey = '';
let _booksMutation = 0;
let _statsRenderedAt = -1;   // _booksMutation value at last genre-filter render
const _coverCache = {};

// Tab state
let activeTab = localStorage.getItem('activeTab') || 'books';
// Migrate old tab IDs that no longer exist
if (!['books', 'media', 'wishlist', 'games', 'stats'].includes(activeTab)) activeTab = 'books';

// Book wishlist (combined: books, movies, TV — lightweight scratch-pad)
let bookWishlist = JSON.parse(localStorage.getItem('bookWishlist') || '[]')
  .map(normalizeWishlistItem);
let wishlistEditingId = null;
let wishlistFilters = { type: 'all' };
let wishlistSort = 'title-asc';
let wishlistSearch = '';
let wishlistSearchTimer = null;

// Media library (movies + TV — all statuses)
let mediaLibrary = JSON.parse(localStorage.getItem('mediaLibrary') || '[]')
  .map(normalizeMediaItem);
let mediaEditingId = null;
let mediaRating = 0;
let mediaFilters = { type: 'all', status: 'all', format: 'all', genres: [] };
let mediaSort = 'added-desc';
let mediaSearch = '';
let mediaSearchTimer = null;

// Video game library (all platforms and statuses)
let videoGames = JSON.parse(localStorage.getItem('videoGames') || '[]')
  .map(normalizeVideoGame);
let gameEditingId = null;
let gameRating = 0;
let gameFilters = { platform: 'all', status: 'all', format: 'all', genres: [] };
let gameSort = 'added-desc';
let gameSearch = '';
let gameSearchTimer = null;


// ─── PERSISTENCE ──────────────────────────────────────────────────────

// _searchStr is recomputed by normalizeBook() on every load; persisting it
// adds ~25% to every localStorage write and export for no benefit.
const stripSearchStr = (k, v) => k === '_searchStr' ? undefined : v;

// ─── LAST UPDATED ─────────────────────────────────────────────────────
// One timestamp per tab, kept apart from the records. It is when this
// device's copy of the tab last changed — an edit made here, or a change
// pulled in from the data repo — which is also what "Last Updated on" in an
// export means. Records carry no such field: a deletion leaves nothing behind
// to stamp, and a per-record field would add a key to every entry in the repo.
//
// It is deliberately NOT bumped by saveLocal()/saveSoon(): background cover
// discovery goes through those, and finding artwork is not the user changing
// their library.
const UPDATED_KEY = 'lastUpdated';

function readUpdatedMap() {
  try { return JSON.parse(localStorage.getItem(UPDATED_KEY)) || {}; }
  catch { return {}; }
}

function touchTab(collection) {
  const map = readUpdatedMap();
  map[collection] = Date.now();
  try { localStorage.setItem(UPDATED_KEY, JSON.stringify(map)); } catch { /* quota: the date is cosmetic */ }
  paintUpdatedNote();
}

// Ids are Date.now() stamps for anything created here, but an imported record
// can carry any number (1, 2, 3…). Only a value that is plausibly a time
// counts: after 2001-09-09 (1e12 ms) and not in the future.
const idAsTime = id => (Number.isFinite(id) && id >= 1e12 && id <= Date.now() + 864e5) ? id : null;

// The stored stamp; failing that, the newest entry's creation time, which is a
// true lower bound on when the tab last changed — so a library last touched
// before this existed still shows something honest rather than nothing. Null
// for an empty tab, or one whose ids carry no time at all.
function tabUpdatedAt(collection) {
  const stored = readUpdatedMap()[collection];
  if (Number.isFinite(stored)) return stored;
  const records = { books, media: mediaLibrary, wishlist: bookWishlist, games: videoGames }[collection] || [];
  let newest = null;
  for (const r of records) {
    const t = idAsTime(r.id);
    if (t !== null && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

function formatUpdated(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// One note, under the tab bar, repainted on a tab switch and on every stamp.
// It sits outside every tab's own render target, so a re-render never has to
// know about it.
function paintUpdatedNote() {
  const el = document.getElementById('updatedNote');
  if (!el) return;
  const ms = tabUpdatedAt(activeTab);
  el.textContent = ms === null ? '' : `Last updated ${formatUpdated(ms)}`;
  el.title = ms === null ? '' : new Date(ms).toISOString();
}

// ─── DELETIONS (tombstones) ───────────────────────────────────────────
// A deleted record has to leave something behind, or sync brings it back: a
// merge keeps any record that exists on only one side, so another device's
// stale copy — or a remote that changed while this delete was being pushed —
// would resurrect it. A tombstone `{ id, deleted: true, deletedAt }` travels
// in the synced file instead, and wins over a live copy of the same id in
// every merge (ghsync/store.js mergeRemote).
//
// Tombstones never enter the app's own arrays, so nothing that renders,
// counts, filters or exports a collection ever sees one. They live under
// their own key, are added to what is pushed (syncSnapshot), and are applied
// and filtered out of what arrives (applySyncedData).
//
// Deletions are noticed at the save choke points, by which ids have gone
// since the last save, rather than at each delete button — so every path
// that removes a record (delete, scan undo, bulk delete, moving a wishlist
// item into the library) is covered without having to remember it.
const TOMB_KEY = 'tombstones';
const TOMB_TTL = 365 * 864e5;   // a device offline for a year can resurrect; accepted

function readTombs() {
  try { return JSON.parse(localStorage.getItem(TOMB_KEY)) || {}; } catch { return {}; }
}
function writeTombs(t) {
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch { /* quota: worst case is a resurrection */ }
}
const collectionArray = c =>
  ({ books, media: mediaLibrary, wishlist: bookWishlist, games: videoGames })[c] || [];

// Ids each collection held at its last save or sync, to tell what was deleted.
const _knownIds = {};
['books', 'media', 'wishlist', 'games'].forEach(c => {
  _knownIds[c] = new Set(collectionArray(c).map(r => r.id));
});

function noteDeletions(collection) {
  const now = new Set(collectionArray(collection).map(r => r.id));
  const gone = [..._knownIds[collection]].filter(id => !now.has(id));
  _knownIds[collection] = now;
  if (!gone.length) return;
  const t = readTombs();
  const map = t[collection] || (t[collection] = {});
  const at = Date.now();
  for (const id of gone) map[id] = at;
  writeTombs(pruneTombs(t));
}

function pruneTombs(t) {
  const cutoff = Date.now() - TOMB_TTL;
  for (const c of Object.keys(t))
    for (const [id, at] of Object.entries(t[c])) if (!(at > cutoff)) delete t[c][id];
  return t;
}

const tombsFor = collection => readTombs()[collection] || {};

// What a push carries for deletions.
// Forget this device's deletions of these ids — when the user has chosen to
// keep them after all (the first-sync resolver). Otherwise the tombstones
// go on hiding the very records that were chosen.
function forgetTombs(collection, ids) {
  const t = readTombs();
  const map = t[collection];
  if (!map) return;
  let changed = false;
  for (const id of ids) if (id in map) { delete map[id]; changed = true; }
  if (changed) writeTombs(t);
}

function tombRecords(collection) {
  return Object.entries(tombsFor(collection)).map(([id, at]) => ({ id: Number(id), deleted: true, deletedAt: at }));
}

// The local half of a save, without the trip out to the data repo.
function saveLocal() {
  _booksMutation++;
  localStorage.setItem('myLibrary', JSON.stringify(books, stripSearchStr));
}

function save() {
  saveLocal();
  noteDeletions('books');
  touchTab('books');
  syncPush('books');
}

// Debounced save for background cover discovery — each save serializes the
// whole library, so coalesce the burst of writes while scrolling a page of
// uncached covers into one.
//
// Local only, deliberately: a discovered cover is derived data that any
// device can find again for itself, and scrolling a few screens would
// otherwise spend a run of GitHub commits on artwork. The next real edit
// carries whatever has been found up with everything else.
let _coverSaveTimer = null;
function saveSoon() {
  clearTimeout(_coverSaveTimer);
  _coverSaveTimer = setTimeout(saveLocal, 1000);
}

function saveWishlist() {
  localStorage.setItem('bookWishlist', JSON.stringify(bookWishlist));
  noteDeletions('wishlist');
  touchTab('wishlist');
  syncPush('wishlist');
}

function saveMedia() {
  localStorage.setItem('mediaLibrary', JSON.stringify(mediaLibrary));
  noteDeletions('media');
  touchTab('media');
  syncPush('media');
}

function saveGames() {
  localStorage.setItem('videoGames', JSON.stringify(videoGames));
  noteDeletions('games');
  touchTab('games');
  syncPush('games');
}


// ─── SYNC BRIDGE ──────────────────────────────────────────────────────
// ghsync is an ES module; this file is a classic script, because every
// inline onclick= in index.html resolves against the global scope. So the
// two talk through globals rather than imports: sync.js sets window.ghPush,
// and calls the two functions below. With sync.js absent or sync
// unconfigured, all of this is inert and the app stays exactly local.

// Records as they should reach the repo — _searchStr is derived on load and
// would only bloat the file, so it is stripped with the same replacer the
// localStorage write and the export already use.
function syncSnapshot(collection) {
  let records;
  switch (collection) {
    case 'books':    records = JSON.parse(JSON.stringify(books, stripSearchStr)); break;
    case 'media':    records = mediaLibrary; break;
    case 'wishlist': records = bookWishlist; break;
    case 'games':    records = videoGames; break;
    default:         return null;
  }
  const tombs = tombRecords(collection);
  return tombs.length ? [...records, ...tombs] : records;
}

function syncPush(collection) {
  if (window.ghPush) window.ghPush(collection, syncSnapshot(collection));
}

// Where each collection lives locally, and how a raw record becomes one.
const SYNC_COLLECTIONS = {
  books:    { key: 'myLibrary',    normalize: b => normalizeBook(b),         replacer: stripSearchStr },
  media:    { key: 'mediaLibrary', normalize: m => normalizeMediaItem(m) },
  wishlist: { key: 'bookWishlist', normalize: w => normalizeWishlistItem(w) },
  games:    { key: 'videoGames',   normalize: g => normalizeVideoGame(g) },
};

// Called by sync.js when records arrive from the data repo — a background
// refresh, or another tab. Writes through to this app's own storage rather
// than going back out through save(), which would bounce straight back to
// ghsync as a fresh push.
//
// Returns whether anything actually moved. The normalizers are idempotent, so
// re-serializing and comparing is a sound test, and it is what stops a repo
// that agrees with us from costing a full re-render.
function applySyncedData(collection, records) {
  if (!Array.isArray(records)) return false;
  const spec = SYNC_COLLECTIONS[collection];
  if (!spec) return false;

  // Deletions made elsewhere: remember them (newest wins), and drop every
  // tombstoned id from what is applied — including a live copy a stale
  // device still sends.
  const incoming = records.filter(r => r && r.deleted);
  if (incoming.length) {
    const t = readTombs();
    const map = t[collection] || (t[collection] = {});
    for (const r of incoming) if (!(map[r.id] >= r.deletedAt)) map[r.id] = r.deletedAt || Date.now();
    writeTombs(pruneTombs(t));
  }
  const tombs = tombsFor(collection);
  const next = records.filter(r => r && !r.deleted && !tombs[r.id]).map(spec.normalize);
  const json = JSON.stringify(next, spec.replacer);
  if (json === localStorage.getItem(spec.key)) return false;

  // Compared against memory, not storage: after a normalizer change the stored
  // string is still the old shape while memory is already migrated, so a repo
  // that merely agrees with us would otherwise read as "changed" and move the
  // date. Only a real difference in the records counts.
  const current = { books, media: mediaLibrary, wishlist: bookWishlist, games: videoGames }[collection];
  const reallyChanged = JSON.stringify(current, spec.replacer) !== json;

  localStorage.setItem(spec.key, json);

  switch (collection) {
    case 'books':
      books = next;
      // render()'s filter cache is keyed partly on this counter.
      _booksMutation++;
      _filteredCache = null;
      break;
    case 'media':    mediaLibrary = next; break;
    case 'wishlist': bookWishlist = next; break;
    case 'games':    videoGames   = next; break;
  }
  _knownIds[collection] = new Set(next.map(r => r.id));   // a remote removal is not a local delete
  if (reallyChanged) touchTab(collection);
  return true;
}


