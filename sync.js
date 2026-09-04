// Wires this app to ghsync — see ghsync/CLAUDE.md for the package itself.
//
// Loaded as a module, so it runs after app.js (a classic script) has already
// parsed, initialised from localStorage and rendered. That ordering is the
// whole design: the app works standalone and stays authoritative locally,
// and this file adds a transport on top rather than replacing its storage.
//
// Data flows in exactly two directions, and never in a loop:
//   app writes  -> save() -> syncPush() -> window.ghPush -> store.save()
//   repo/tab    -> store 'changed' -> applySyncedData() -> renderPage()

import { createStore } from './ghsync/store.js';
import { syncSections, setupRows, badgeState, h } from './ghsync/settings-ui.js';

const COLLECTIONS = ['books', 'media', 'wishlist', 'games'];
const FILE_NAMES = {
  books: 'books.json', media: 'media.json',
  wishlist: 'wishlist.json', games: 'games.json',
};

// ─── which folder in the data repo ────────────────────────────────────
// The file names are fixed; the folder holding them is not, so a data repo
// can keep this app's four files somewhere other than `data/` — beside
// another app's, or at the repo root.
const FOLDER_KEY = 'booklogger.datafolder';

// '' means the repo root. Anything with a traversal segment, a backslash or
// a character GitHub would have to escape is rejected outright rather than
// quietly rewritten, so a typo cannot silently point at a different path.
function cleanFolder(raw) {
  const f = String(raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!f) return '';
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(f)) return null;
  if (f.split('/').some(seg => seg === '.' || seg === '..')) return null;
  return f;
}

function storedFolder() {
  // `data` is the default every existing install is already using, so an
  // absent setting has to keep meaning exactly that.
  const stored = localStorage.getItem(FOLDER_KEY);
  const clean = stored == null ? 'data' : cleanFolder(stored);
  return clean == null ? 'data' : clean;
}

const pathFor = (folder, collection) =>
  (folder ? `${folder}/` : '') + FILE_NAMES[collection];

const filesFor = folder => Object.fromEntries(
  COLLECTIONS.map(c => [c, pathFor(folder, c)]));

// The folder the store's paths currently point at.
let currentFolder = storedFolder();

export const store = createStore({
  appId: 'booklogger',
  files: filesFor(storedFolder()),
  // Encrypted only once the user sets a password; the data repo being
  // private is the first line of defence, this is the second.
  encrypted: COLLECTIONS,
});

// Retarget the store at a different folder, carrying the cached records
// across with it.
//
// This has to move the cache, not just the paths. ghsync keys its cache by
// repo path, so pointing `files` at an empty folder would leave store.get()
// returning [] for every collection — and applySyncedData would then write
// those empty arrays straight over the library. The records move; the shas
// do not, because a sha identifies a blob in the *old* file, so the new ones
// are cleared and the paths marked dirty to be created on the next push.
//
// `store.files` is the very object handed to createStore(), and every read
// inside the package goes through it, so mutating it in place retargets
// reads, writes, refresh and encryption together with no package change.
// -> { moved, from, to } or null when nothing changed.
function retargetFolder(folder) {
  const from = currentFolder;
  if (folder === from) return null;

  const moved = [];
  for (const collection of COLLECTIONS) {
    const oldPath = pathFor(from, collection);
    const newPath = pathFor(folder, collection);
    const records = store.cache.getData(oldPath);

    if (records != null) {
      store.cache.setData(newPath, records);
      localStorage.removeItem(store.cache.dataPrefix + oldPath);
      moved.push(collection);
    }
    store.cache.setSha(oldPath, null);
    store.cache.setSha(newPath, null);
    store.cache.clearDirty(oldPath);
    if (records != null) store.cache.markDirty(newPath);

    store.files[collection] = newPath;
  }

  currentFolder = folder;
  localStorage.setItem(FOLDER_KEY, folder);
  return { moved, from, to: folder };
}

// ─── seeding ──────────────────────────────────────────────────────────
// ghsync keeps its own namespaced cache, separate from the keys app.js has
// been writing since long before sync existed. On a browser that already
// holds a library, that cache starts empty — and "Upload all local data"
// pushes the *cache*, so without this it would seed the repo with four
// empty arrays and a later refresh would then wipe the app. Seed only when
// a path has nothing: after that the two stay in step through ghPush.
function seedFromApp() {
  for (const collection of COLLECTIONS) {
    const path = store.files[collection];
    if (store.cache.getData(path) != null) continue;
    const records = window.syncSnapshot?.(collection);
    if (Array.isArray(records) && records.length) store.cache.setData(path, records);
  }
}

// ─── app -> repo ──────────────────────────────────────────────────────
let applying = false;   // suppresses the echo of our own write

window.ghPush = (collection, records) => {
  if (applying || !Array.isArray(records)) return;
  // store.save() emits 'changed' SYNCHRONOUSLY, before it awaits the network,
  // so without this guard the app's own write echoes straight back through
  // applyToApp() — re-normalizing every collection and re-rendering on every
  // keystroke-sized edit. The guard is dropped again as soon as save() reaches
  // its first await, so a later 'changed' from a real remote merge still lands.
  applying = true;
  try {
    // store.save() swallows push failures into sync status, so a rejection
    // here would be a bug rather than an offline device — but an unhandled
    // rejection in a save path is not worth risking.
    store.save(collection, records).catch(() => {});
  } finally {
    applying = false;
  }
};

// ─── repo -> app ──────────────────────────────────────────────────────
// `only` names the collection that changed. Anything else — notably the
// cross-tab 'external' event, which cannot say what moved — re-applies all
// four, which is correct but far more expensive, so it is not the default
// for the single-collection case.
function applyToApp(only) {
  if (!window.applySyncedData) return;
  applying = true;
  try {
    let changed = false;
    const list = COLLECTIONS.includes(only) ? [only] : COLLECTIONS;
    for (const collection of list) {
      if (window.applySyncedData(collection, store.get(collection))) changed = true;
    }
    if (changed) window.renderPage?.();
  } finally {
    applying = false;
  }
}

store.onChange((e) => {
  if (e.type === 'sync-status') { paintBadge(); return; }
  if (applying) return;          // our own save() echoing back
  applyToApp(e.collection);
});

// ─── settings panel ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// The app has no toast; its status banner is the closest thing and already
// carries the sync messages from the old public-repo fetch.
function toast(message, type = '') {
  const banner = $('statusBanner');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.toggle('banner-error', type === 'error');
  banner.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => banner.classList.remove('visible'), 4000);
}

function paintBadge() {
  const el = $('syncBadge');
  if (!el) return;
  const { text, cls } = badgeState(store);
  el.className = `gh-badge ${cls}`;
  el.textContent = text;
}

function renderSyncPanel() {
  const panel = $('syncPanel');
  if (!panel) return;
  panel.innerHTML = '';

  const sections = syncSections({
    store,
    toast,
    onChange: () => { paintBadge(); applyToApp(); },
    reopen: (id) => {
      const el = panel.querySelector(`.settings-section[data-section="${id}"]`);
      if (el) el.open = true;
    },
    text: {
      defaultOwner: 'rusty324',
      repoPlaceholder: 'my-library-data',
      appRepoNote: 'Use a private repo — this one is public, and anything '
                 + 'written here would be readable by anyone.',
    },
  });

  panel.appendChild(h('div', { class: 'gh-setup' }, setupRows(store, (id) => {
    const el = panel.querySelector(`.settings-section[data-section="${id}"]`);
    if (el) el.open = true;
  })));

  for (const spec of sections) {
    if (spec.id === 'datarepo') addFolderField(spec);
    panel.appendChild(h('details', { class: 'settings-section', dataset: { section: spec.id } },
      h('summary', {},
        h('span', { class: 'sec-name' }, spec.name),
        h('span', { class: 'sec-state' }, spec.state)),
      h('div', { class: 'settings-body' }, spec.body)));
  }
  paintBadge();
}

// The folder belongs beside owner / repo / branch, but ghsync builds that
// section itself and has no hook for a fourth input — so the field is added
// to the section it returns, rather than forking the package for it.
//
// Nothing here assumes the package's markup survives: if the row or the save
// button cannot be found, the field is appended with its own button instead
// of silently doing nothing.
const where = folder => folder ? `“${folder}”` : 'the repo root';

function addFolderField(spec) {
  const folderInput = h('input', { value: currentFolder, placeholder: 'data' });
  const field = h('div', { class: 'field' },
    h('label', {}, 'Folder'), folderInput);

  const note = h('p', { class: 'muted', style: 'margin:6px 0 0' },
    `The folder inside that repo holding this app's four JSON files. `
    + `Leave it as “data”, or name it anything you like — blank puts them at `
    + `the repo root.`);

  // Its own message line, not the shared status banner. ghsync's save handler
  // toasts "Data repo saved — syncing" once its own validate() returns, which
  // is a network round trip after this runs — so anything sent to the banner
  // here is overwritten a moment later, and a rejected folder name would
  // revert with no explanation at all.
  const msg = h('p', { class: 'muted gh-folder-msg', style: 'margin:6px 0 0' });
  const say = (text, bad) => {
    msg.textContent = text;
    msg.classList.toggle('hint-error', !!bad);
  };

  const applyFolder = () => {
    const folder = cleanFolder(folderInput.value);
    if (folder === null) {
      say(`“${folderInput.value.trim()}” is not a usable folder name — letters, `
        + `numbers, . _ - and / only. Still syncing to ${where(currentFolder)}.`, true);
      folderInput.value = currentFolder;
      return;
    }
    const change = retargetFolder(folder);
    if (!change) return;

    // The records live in the local cache and moved with the paths, so this
    // is a re-upload under new names, not a re-download. The old files are
    // left where they are: the Contents API client has no delete, and
    // removing someone's data as a side effect of renaming a field would be
    // the wrong call even if it did.
    say(`Moving to ${where(change.to)}…`);
    store.flushQueue()
      .then(() => say(change.moved.length
        ? `Now syncing to ${where(change.to)} — re-uploaded ${change.moved.length} `
          + `file${change.moved.length === 1 ? '' : 's'}. `
          + `The old ${where(change.from)} files are still in the repo; delete them there if you want.`
        : `Now syncing to ${where(change.to)}.`))
      .catch(() => say(`Folder saved, but the upload to ${where(change.to)} failed — `
                     + 'it will retry.', true));
  };

  const row = spec.body.querySelector('.field-row');
  const saveBtn = [...spec.body.querySelectorAll('button')]
    .find(b => /save/i.test(b.textContent));

  if (row && saveBtn) {
    row.appendChild(field);
    // Runs alongside ghsync's own handler on the same click. That one is
    // async and yields at its first await, so the folder is already in place
    // before it validates or refreshes.
    saveBtn.addEventListener('click', applyFolder);
  } else {
    spec.body.appendChild(h('div', { class: 'field-row' }, field,
      h('button', { class: 'btn', onclick: applyFolder }, 'Save folder')));
  }
  spec.body.appendChild(note);
  spec.body.appendChild(msg);

  spec.state = store.hasDataRepo()
    ? `${spec.state} · ${currentFolder || 'root'}`
    : spec.state;
}

window.openSyncModal = () => {
  renderSyncPanel();
  $('syncModal').classList.add('open');
};

window.closeSyncModal = () => $('syncModal').classList.remove('open');

window.handleSyncBackdrop = (e) => {
  if (e.target === $('syncModal')) window.closeSyncModal();
};

// Nothing in a module is reachable from the console or an inline handler, and
// this file already bridges to the app through globals. Exposing the store the
// same way is what makes a sync problem diagnosable on the device it happens
// on — `ghStore.syncStatus()`, `ghStore.files`, `ghStore.cache.getQueue()`.
window.ghStore = store;

// ─── start ────────────────────────────────────────────────────────────
seedFromApp();
store.init();          // background refresh, cross-tab, offline retry
paintBadge();
