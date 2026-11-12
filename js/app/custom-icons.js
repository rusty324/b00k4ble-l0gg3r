// custom-icons.js — your own icons in place of the built-in emoji: the
// formats of Books, Movies & TV and Games, the film/show types, and the
// Wishlist's item types.
//
// The images are yours, not the app's: they live in the private data repo
// (icons/<section>/<key>-<time>.png), never in this public repository, which
// keeps third-party artwork and trademarks out of it. They travel through the
// same path as uploaded covers (cover-files.js: IndexedDB here, uploaded once
// sync can, encrypted with a sync password, fetched with the token elsewhere).
//
// Which icon is current needs no extra file: each device lists icons/<section>/
// and the newest file per key wins. "Use the built-in" writes an empty
// <key>-<time>.none marker, which wins the same way.
//
// Uploading can remove a plain background: the colour that fills the image's
// border is flooded inward from the edges and made transparent (softly at the
// edge), then the icon is trimmed to its content and centred in a square.
//
// Drawing one: ico(section, key) gives your image or the emoji, as HTML. Static
// markup (index.html) marks an emoji with data-icon="section:key", and
// paintStaticIcons() swaps those whenever an icon changes.

const ICON_SETS = {
  books:    { label: 'Books', items: { physical: ['📚', 'Physical'], ebook: ['📱', 'E-book'], audio: ['🎧', 'Audiobook'] } },
  media:    { label: 'Movies & TV', items: { movie: ['🎬', 'Movie'], tv: ['📺', 'TV show'],
              bluray: [MEDIA_FORMAT_ICON.bluray, 'Blu-ray'], dvd: [MEDIA_FORMAT_ICON.dvd, 'DVD'],
              digital: [MEDIA_FORMAT_ICON.digital, 'Digital'], streaming: [MEDIA_FORMAT_ICON.streaming, 'Streaming'] } },
  games:    { label: 'Games', items: Object.fromEntries(GAME_FORMATS.map(f => [f, [GAME_FORMAT_ICON[f], GAME_FORMAT_LABEL[f]]])) },
  wishlist: { label: 'Wishlist', items: { book: ['📚', 'Book'], movie: ['🎬', 'Movie'], tv: ['📺', 'TV show'], game: ['🎮', 'Game'] } },
};
const ICON_KEY = 'booklogger.customIcons';      // { "section:key": { path, at } }
const ICON_SIZE = 96;                            // stored square, drawn at ~1em
const ICON_NAME = /^([a-z0-9-]+)-([a-z0-9]+)\.(png|json|none)$/;

function iconMap() {
  try { return JSON.parse(localStorage.getItem(ICON_KEY)) || {}; } catch { return {}; }
}
function setIconMap(map) {
  try { localStorage.setItem(ICON_KEY, JSON.stringify(map)); } catch { /* quota: the icons fall back to the built-ins */ }
}
// The repo path of your icon for this, or null for the built-in.
function customIcon(set, key) {
  const e = iconMap()[`${set}:${key}`];
  return e && e.path && !e.path.endsWith('.none') ? e.path : null;
}
const builtinIcon = (set, key) => ((ICON_SETS[set] || {}).items || {})[key]?.[0] || '';

// What every view draws: your image, or the built-in emoji.
function ico(set, key) {
  const p = customIcon(set, key);
  return p ? `<img class="fmt-icon" src="${REPO_COVER}${esc(p)}" alt="">` : esc(builtinIcon(set, key));
}
const gameFormatIcon = f => ico('games', f);

// The markup in index.html: <span data-icon="books:physical">📚</span>.
function paintStaticIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const [set, key] = el.dataset.icon.split(':');
    const html = ico(set, key);
    if (el.innerHTML !== html) el.innerHTML = html;
  });
}

// The paths the upload queue must keep (cover-files.js asks).
function referencedIconPaths() {
  return Object.values(iconMap()).map(e => e && e.path).filter(Boolean);
}

function iconsChanged() {
  paintStaticIcons();
  if (typeof renderPage === 'function') renderPage();
  paintIconSheet();
}

// ─── background removal ───────────────────────────────────────────────
// Flood the border's colour inward and make it transparent. An image that is
// already mostly transparent at its edges is left alone.
function removePlainBackground(data, w, h, tol = 48) {
  const px = data.data;
  const at = (x, y) => (y * w + x) * 4;
  const border = [];
  for (let x = 0; x < w; x++) border.push(at(x, 0), at(x, h - 1));
  for (let y = 1; y < h - 1; y++) border.push(at(0, y), at(w - 1, y));
  if (border.filter(i => px[i + 3] < 16).length > border.length * 0.5) return;
  // The border's commonest colour, coarsely binned, then averaged.
  const bin = i => (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4);
  const bins = new Map();
  for (const i of border) if (px[i + 3] >= 16) bins.set(bin(i), (bins.get(bin(i)) || 0) + 1);
  let best = -1, bestN = 0;
  bins.forEach((n, k) => { if (n > bestN) { best = k; bestN = n; } });
  if (best < 0) return;
  let r = 0, g = 0, b = 0, n = 0;
  for (const i of border) if (bin(i) === best) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  r /= n; g /= n; b /= n;
  const dist = i => Math.hypot(px[i] - r, px[i + 1] - g, px[i + 2] - b);
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (const i of border) if (dist(i) <= tol) { seen[i / 4] = 1; stack.push(i / 4); }
  const soft = tol * 1.6;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p - x) / w;
    px[p * 4 + 3] = 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (seen[q]) continue;
      seen[q] = 1;
      const d = dist(q * 4);
      if (d <= tol) stack.push(q);
      // An anti-aliased edge pixel: partly transparent, not a hard cut.
      else if (d <= soft) px[q * 4 + 3] = Math.min(px[q * 4 + 3], Math.round(255 * (d - tol) / (soft - tol)));
    }
  }
}

// -> a square transparent PNG Blob, the content trimmed and centred.
async function processIconImage(file, removeBg) {
  if (file.size > COVER_SOURCE_MAX) throw new CoverError('too-big', `That image is ${kb(file.size)}; the limit is ${kb(COVER_SOURCE_MAX)}.`);
  const img = await new Promise((resolve, reject) => {
    const el = new Image(); const url = URL.createObjectURL(file);
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new CoverError('not-image', 'Not an image this browser can read.')); };
    el.src = url;
  });
  // Work at a modest size: plenty for an icon, quick to flood-fill.
  const work = 256, s = Math.min(1, work / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  if (removeBg) removePlainBackground(data, w, h);
  // Trim to what is left visible.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data.data[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new CoverError('not-image', 'Nothing was left after removing the background — try again with it off.');
  ctx.putImageData(data, 0, 0);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, fit = ICON_SIZE / Math.max(cw, ch);
  const out = document.createElement('canvas'); out.width = out.height = ICON_SIZE;
  out.getContext('2d').drawImage(c, x0, y0, cw, ch,
    (ICON_SIZE - cw * fit) / 2, (ICON_SIZE - ch * fit) / 2, cw * fit, ch * fit);
  return new Promise((resolve, reject) =>
    out.toBlob(b => b ? resolve(b) : reject(new CoverError('encode', 'Could not encode the image')), 'image/png'));
}

// ─── choosing ─────────────────────────────────────────────────────────
async function storeIcon(set, key, blob) {
  const at = Date.now();
  const enc = !!window.ghCoverFiles?.encrypted();
  const path = `icons/${set}/${key}-${at.toString(36)}.${enc ? 'json' : 'png'}`;
  pendingFlag(true);
  await coverPut({ path, bytes: await blob.arrayBuffer(), type: 'image/png', dirty: true, at });
  _coverUrls.set(path, Promise.resolve(URL.createObjectURL(blob)));
  setIconMap({ ...iconMap(), [`${set}:${key}`]: { path, at } });
  flushCoverUploads();
}

async function resetIcon(set, key) {
  const at = Date.now();
  const path = `icons/${set}/${key}-${at.toString(36)}.none`;
  pendingFlag(true);
  await coverPut({ path, bytes: new ArrayBuffer(0), type: 'text/plain', dirty: true, at });
  setIconMap({ ...iconMap(), [`${set}:${key}`]: { path, at } });
  flushCoverUploads();
}

// Learn other devices' choices: the newest file per key in each icons/<section>/.
let _iconsListedAt = 0;
async function refreshCustomIcons(force = false) {
  const bridge = window.ghCoverFiles;
  if (!bridge || !bridge.canSync() || !bridge.list) return false;
  if (!force && Date.now() - _iconsListedAt < 10 * 60 * 1000) return false;
  _iconsListedAt = Date.now();
  const map = iconMap();
  let changed = false;
  for (const set of Object.keys(ICON_SETS)) {
    let names;
    try { names = await bridge.list(`icons/${set}`); } catch { continue; }
    for (const name of names) {
      const m = name.match(ICON_NAME);
      if (!m || !ICON_SETS[set].items[m[1]]) continue;
      const id = `${set}:${m[1]}`, at = parseInt(m[2], 36);
      if (!map[id] || at > map[id].at) { map[id] = { path: `icons/${set}/${name}`, at }; changed = true; }
    }
  }
  if (changed) { setIconMap(map); iconsChanged(); }
  return changed;
}

// ─── the settings sheet ───────────────────────────────────────────────
function paintIconSheet() {
  const body = document.getElementById('iconsBody');
  if (!body || !document.getElementById('iconsModal')?.classList.contains('open')) return;
  const removeBg = document.getElementById('iconsRemoveBg')?.checked ?? true;
  const msg = document.getElementById('iconsMsg')?.textContent || '';
  body.innerHTML = `
    <div class="modal-title" id="iconsTitle">Icons</div>
    <p class="dupes-intro">Use your own pictures in place of the built-in icons. They are kept in your private
      data repo and sync like uploaded covers; nothing is added to the app itself.</p>
    <label class="toggle-row"><input type="checkbox" id="iconsRemoveBg" ${removeBg ? 'checked' : ''}>
      <span>Remove a plain background (make it transparent)</span></label>
    ${Object.entries(ICON_SETS).map(([set, s]) => `
      <h3 class="dupes-kind">${esc(s.label)}</h3>
      <div class="icon-rows">
        ${Object.entries(s.items).map(([key, [emoji, label]]) => {
          const custom = customIcon(set, key);
          return `<div class="icon-row" data-icon-set="${set}" data-icon-key="${key}">
            <span class="icon-preview">${custom ? `<img src="${REPO_COVER}${esc(custom)}" alt="">` : `<span class="icon-emoji">${esc(emoji)}</span>`}</span>
            <span class="icon-name">${esc(label)}<span class="muted">${custom ? 'Your image' : 'Built-in'}</span></span>
            <button type="button" class="btn btn-sm" onclick="pickIcon('${set}', '${key}')" aria-label="Upload an icon for ${esc(s.label)}: ${esc(label)}">Upload…</button>
            ${custom ? `<button type="button" class="btn btn-sm" onclick="useBuiltinIcon('${set}', '${key}')" aria-label="Use the built-in icon for ${esc(s.label)}: ${esc(label)}">Use the built-in</button>` : ''}
          </div>`;
        }).join('')}
      </div>`).join('')}
    <p class="paste-msg" id="iconsMsg" role="status">${esc(msg)}</p>
    <div class="detail-actions"><span class="detail-spacer"></span>
      <button type="button" class="btn btn-primary" onclick="closeIconSheet()">Done</button></div>`;
}

function openIconSheet() {
  document.getElementById('iconsModal').classList.add('open');
  paintIconSheet();
  refreshCustomIcons(true);
}
function closeIconSheet() { document.getElementById('iconsModal')?.classList.remove('open'); }
function handleIconsBackdrop(e) { if (e.target === document.getElementById('iconsModal')) closeIconSheet(); }
const sayIcons = t => { const m = document.getElementById('iconsMsg'); if (m) m.textContent = t; };
const iconLabel = (set, key) => `${ICON_SETS[set].label}: ${ICON_SETS[set].items[key][1]}`;

function pickIcon(set, key) {
  const picker = document.getElementById('coverFilePicker');
  picker.value = '';
  picker.onchange = async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    const removeBg = document.getElementById('iconsRemoveBg')?.checked ?? true;
    sayIcons('Preparing…');
    try {
      await storeIcon(set, key, await processIconImage(file, removeBg));
      sayIcons(`${iconLabel(set, key)} now uses your image.`);
      iconsChanged();
    } catch (err) {
      sayIcons(err.message || 'That image could not be used.');
    }
  };
  picker.click();
}

async function useBuiltinIcon(set, key) {
  await resetIcon(set, key);
  sayIcons(`${iconLabel(set, key)} is back to the built-in icon.`);
  iconsChanged();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('iconsModal')?.classList.contains('open')) closeIconSheet();
});
paintStaticIcons();
