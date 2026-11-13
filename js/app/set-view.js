// set-view.js — a box set, collection or bundle as one sheet: every title,
// Movies & TV and Games alike, holding a copy in it, with that copy. Opened
// from a copy's "Show the set", from "in <set>" on a detail sheet, and from
// ⋯ → Sets…, which lists every set in the library.
//
// Sets are not records of their own: a set is the copies that name it,
// compared with textKey, so "Star Trek Collection" and "star trek collection"
// are one set (the first spelling met names it).

// key -> { key, name, items: [{ kind, rec, copies }] }, sorted by name.
function librarySets() {
  const sets = new Map();
  const add = (kind, rec) => {
    for (const c of rec.copies || []) {
      if (!c.set) continue;
      const key = textKey(c.set);
      if (!sets.has(key)) sets.set(key, { key, name: c.set, items: [] });
      const s = sets.get(key);
      let item = s.items.find(x => x.kind === kind && x.rec.id === rec.id);
      if (!item) s.items.push(item = { kind, rec, copies: [] });
      item.copies.push(c);
    }
  };
  mediaLibrary.forEach(m => add('media', m));
  videoGames.forEach(g => add('games', g));
  return [...sets.values()].sort((a, b) => titleSortKey(a.name).localeCompare(titleSortKey(b.name)));
}

const setByName = name => librarySets().find(s => s.key === textKey(name)) || null;

// "Blu-ray — Steelbook", "PS4 · Physical"
function setCopyText(kind, c) {
  if (kind === 'games') return gameCopyLine(c);
  return `${MEDIA_FORMAT_LABEL[c.format] || c.format}${c.edition ? ` — ${c.edition}` : ''}`;
}

const SET_CLOSE = `<button type="button" class="series-sheet-close" aria-label="Close" onclick="closeSetSheet()">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;

let _setReturn = null;

function showSetSheet(html) {
  if (!document.getElementById('setModal').classList.contains('open')) _setReturn = document.activeElement;
  document.getElementById('setBody').innerHTML = html;
  document.getElementById('setModal').classList.add('open');
  document.querySelector('#setBody .series-sheet-close')?.focus();
}

function openSetSheet(name) {
  const s = setByName(name);
  if (!s) return openSetList();
  const order = (a, b) => (String(a.rec.year || '9999')).localeCompare(String(b.rec.year || '9999')) ||
    titleSortKey(a.rec.title).localeCompare(titleSortKey(b.rec.title));
  const items = [...s.items].sort(order);
  const nCopies = items.reduce((n, x) => n + x.copies.length, 0);
  const tabs = [...new Set(items.map(x => x.kind))].map(k => (k === 'games' ? 'Games' : 'Movies & TV')).join(' and ');
  const cover = x => (x.kind === 'games' ? x.rec.coverUrl : x.rec.posterUrl);
  showSetSheet(`
    <div class="series-sheet-head">
      <div class="series-sheet-headtext">
        <h2 class="detail-title" id="setSheetTitle">${esc(s.name)}</h2>
        <div class="series-label"><strong>${items.length} title${items.length === 1 ? '' : 's'}</strong> · ${nCopies} cop${nCopies === 1 ? 'y' : 'ies'} · ${esc(tabs)}</div>
      </div>
      ${SET_CLOSE}
    </div>
    <div class="series-sheet-list set-list">
      ${items.map(x => `<button type="button" class="vol-row" data-detail="${x.kind}:${x.rec.id}">
          ${cover(x) ? `<img class="vol-row-tile" src="${esc(cover(x))}" alt="" loading="lazy">`
            : `<span class="vol-row-tile" aria-hidden="true" style="background:${tileColor(x.rec.title)}"></span>`}
          <span class="vol-row-text"><span class="vol-row-title">${esc(x.rec.title)}${x.rec.year ? ` <span class="muted">(${esc(String(x.rec.year))})</span>` : ''}</span>
          <span class="vol-row-sub">${esc(x.copies.map(c => setCopyText(x.kind, c)).join(' · '))} · ${esc(statusLabel(x.kind, x.rec.status))}</span></span>
        </button>`).join('')}
    </div>
    <button type="button" class="btn set-all-btn" onclick="openSetList()">All sets</button>`);
}

// ⋯ → Sets…: every set, with how many titles it holds.
function openSetList() {
  const sets = librarySets();
  showSetSheet(`
    <div class="series-sheet-head">
      <div class="series-sheet-headtext">
        <h2 class="detail-title" id="setSheetTitle">Sets</h2>
        <div class="series-label">${sets.length ? `${sets.length} box set${sets.length === 1 ? '' : 's'}, collection${sets.length === 1 ? '' : 's'} and bundles` : ''}</div>
      </div>
      ${SET_CLOSE}
    </div>
    ${sets.length ? `<div class="series-sheet-list set-list">${sets.map(s => `<button type="button" class="vol-row" data-set-open="${esc(s.name)}">
        <span class="vol-row-tile set-tile" aria-hidden="true">📦</span>
        <span class="vol-row-text"><span class="vol-row-title">${esc(s.name)}</span>
        <span class="vol-row-sub">${s.items.length} title${s.items.length === 1 ? '' : 's'}</span></span></button>`).join('')}</div>`
      : `<p class="muted">No sets yet. Give a copy a set name in its form ("Part of a set"), or use ⋯ → Add a collection.</p>`}`);
}

function closeSetSheet() {
  const m = document.getElementById('setModal');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  if (_setReturn && _setReturn.isConnected) _setReturn.focus();
  _setReturn = null;
}

function handleSetBackdrop(ev) {
  if (ev.target === document.getElementById('setModal')) closeSetSheet();
}

// A set name anywhere ([data-set-open]): the detail sheet's "in <set>" closes
// that sheet first, since the set sheet sits beneath it.
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-set-open]');
  if (!b) return;
  ev.preventDefault();
  if (document.getElementById('detailModal')?.classList.contains('open')) closeDetail();
  openSetSheet(b.dataset.setOpen);
});

window.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || !document.getElementById('setModal')?.classList.contains('open')) return;
  if (['detailModal', 'mediaModal', 'gameModal'].some(id => document.getElementById(id)?.classList.contains('open'))) return;
  closeSetSheet();
}, true);
