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

export const store = createStore({
  appId: 'booklogger',
  files: {
    books:    'data/books.json',
    media:    'data/media.json',
    wishlist: 'data/wishlist.json',
    games:    'data/games.json',
  },
  // Encrypted only once the user sets a password; the data repo being
  // private is the first line of defence, this is the second.
  encrypted: COLLECTIONS,
});

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
  // store.save() swallows push failures into sync status, so a rejection
  // here would be a bug rather than an offline device — but an unhandled
  // rejection in a save path is not worth risking.
  store.save(collection, records).catch(() => {});
};

// ─── repo -> app ──────────────────────────────────────────────────────
function applyToApp() {
  if (!window.applySyncedData) return;
  applying = true;
  try {
    let changed = false;
    for (const collection of COLLECTIONS) {
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
  applyToApp();
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
    panel.appendChild(h('details', { class: 'settings-section', dataset: { section: spec.id } },
      h('summary', {},
        h('span', { class: 'sec-name' }, spec.name),
        h('span', { class: 'sec-state' }, spec.state)),
      h('div', { class: 'settings-body' }, spec.body)));
  }
  paintBadge();
}

window.openSyncModal = () => {
  renderSyncPanel();
  $('syncModal').classList.add('open');
};

window.closeSyncModal = () => $('syncModal').classList.remove('open');

window.handleSyncBackdrop = (e) => {
  if (e.target === $('syncModal')) window.closeSyncModal();
};

// ─── start ────────────────────────────────────────────────────────────
seedFromApp();
store.init();          // background refresh, cross-tab, offline retry
paintBadge();
