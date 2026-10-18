// missing-view.js — "What am I missing?": the gaps in each library tab.
//
//   Books        a numbered series with numbers missing — own #1, #3 and #4
//                of The Expanse and #2 is missing. Counted from #1, so owning
//                only #3 lists #1 and #2. Half-numbers (#1.5 novellas) are
//                owned extras, never gaps. A bundle ("#1-3") owns every
//                number it holds. Gaps the user chose to Ignore are left
//                out (kept on the series's books — see normalizeIgnoredGaps)
//                until "Reset ignored".
//   Movies & TV  a show with some seasons ticked but not all of them: up to
//                TMDb's total when it is known, otherwise up to the highest
//                season owned. A show with no seasons ticked is not tracked
//                and is never listed.
//   Games        DLC marked as wishlist.
//
// A missing book is by definition not in the library, so this cannot be a
// filter over cards: it is a button above each tab's results, shown only when
// there is something to list, opening a sheet of the gaps.

// Every numbered series, grouped by seriesKey (so "Old Man's War" and "Old
// Man’s War" are one): what it has, what it is missing, and which of the
// missing numbers are ignored.
function seriesStatus() {
  const bySeries = new Map();
  const spelling = seriesSpellings();
  for (const b of books) {
    const { name, number } = splitSeries(b.series);
    const nums = seriesNumbers(number).filter(n => Number.isInteger(n) && n >= 1 && n <= 500);
    if (!nums.length) continue;
    const key = seriesKey(name);
    if (!bySeries.has(key)) bySeries.set(key, { key, name: spelling.get(key) || name, have: new Set(), ignored: new Set(), books: [] });
    const s = bySeries.get(key);
    nums.forEach(n => s.have.add(n));
    (b.ignoredGaps || []).forEach(n => s.ignored.add(n));
    s.books.push(b);
  }
  const out = [];
  for (const s of bySeries.values()) {
    const top = Math.max(...s.have);
    const missing = [], ignored = [];
    for (let i = 1; i <= top; i++) if (!s.have.has(i)) (s.ignored.has(i) ? ignored : missing).push(i);
    out.push({ key: s.key, name: s.name, have: [...s.have].sort((a, b) => a - b), missing, ignored, books: s.books });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const seriesGaps = () => seriesStatus().filter(s => s.missing.length);
// Series with an ignored gap that is still a gap — what "Reset ignored" would bring back.
const ignoredSeries = () => seriesStatus().filter(s => s.ignored.length);

// Stop listing a series's current gaps. Only these numbers: a gap that opens
// later (a #6 added with #5 still unowned) is listed as usual.
function ignoreSeriesGaps(key) {
  const s = seriesStatus().find(x => x.key === key);
  if (!s || !s.missing.length) return;
  const ids = new Set(s.books.map(b => b.id));
  books = books.map(b => ids.has(b.id)
    ? normalizeBook({ ...b, ignoredGaps: [...(b.ignoredGaps || []), ...s.missing] }) : b);
  save();
  renderPage();
  openMissing('books');   // repaint the sheet without the row
}

function resetIgnoredGaps() {
  if (!books.some(b => b.ignoredGaps)) return;
  books = books.map(b => b.ignoredGaps ? normalizeBook({ ...b, ignoredGaps: [] }) : b);
  save();
  renderPage();
  openMissing('books');
}

function seasonGaps(m) {
  if (m.type !== 'tv' || !(m.seasons || []).length) return [];
  const owned = new Set(m.seasons);
  const top = m.seasonCount || Math.max(...m.seasons);
  const missing = [];
  for (let i = 1; i <= top; i++) if (!owned.has(i)) missing.push(i);
  return missing;
}

const wishlistedDlc = g => (g.dlc || []).filter(d => !d.owned).map(d => d.name);

const MISSING = {
  books: {
    list: seriesGaps,
    heading: 'Series with gaps',
    empty: 'No gaps in any numbered series.',
    row: s => `<div class="missing-item">
        <div class="missing-name">${esc(s.name)}</div>
        <div class="missing-what">Missing ${esc(compressRanges(s.missing, '#'))}</div>
        <div class="missing-have">You have ${esc(compressRanges(s.have, '#'))}${s.ignored.length ? ` · ignoring ${esc(compressRanges(s.ignored, '#'))}` : ''}</div>
        <div class="missing-actions">
          <button type="button" class="btn btn-sm" onclick="addMissingBook(${jsArg(s.name)}, ${s.missing[0]})">Add #${s.missing[0]}</button>
          <button type="button" class="btn btn-sm" onclick="ignoreSeriesGaps(${jsArg(s.key)})"
                  title="Stop listing these gaps; a new gap in this series still shows">Ignore</button>
        </div>
      </div>`,
    ignored: () => ignoredSeries().length,
    reset: 'resetIgnoredGaps()',
  },
  media: {
    list: () => mediaLibrary.map(m => ({ m, missing: seasonGaps(m) })).filter(x => x.missing.length),
    heading: 'Shows with seasons missing',
    empty: 'Every show you track has all its seasons.',
    row: ({ m, missing }) => `<button type="button" class="missing-item missing-link" onclick="openMissingItem('media', ${m.id})">
        <div class="missing-name">${esc(m.title)}</div>
        <div class="missing-what">Missing ${missing.length === 1 ? 'season' : 'seasons'} ${esc(compressRanges(missing))}</div>
        <div class="missing-have">You have ${esc(seasonsText(m.seasons, m.seasonCount).replace(/^Seasons? /, ''))}</div>
      </button>`,
  },
  games: {
    list: () => videoGames.map(g => ({ g, missing: wishlistedDlc(g) })).filter(x => x.missing.length),
    heading: 'Games with DLC on your wishlist',
    empty: 'No DLC on your wishlist.',
    row: ({ g, missing }) => `<button type="button" class="missing-item missing-link" onclick="openMissingItem('games', ${g.id})">
        <div class="missing-name">${esc(g.title)}</div>
        <div class="missing-what">${missing.map(esc).join(' · ')}</div>
      </button>`,
  },
};
// A string as a JS literal for an inline handler, made safe inside an HTML attribute.
const jsArg = v => esc(JSON.stringify(v));

const missingCount = kind => MISSING[kind] ? MISSING[kind].list().length : 0;
const ignoredCount = kind => MISSING[kind] && MISSING[kind].ignored ? MISSING[kind].ignored() : 0;

// The button above a tab's results, or nothing when there is nothing missing.
// Still shown, without a count, when everything missing is ignored — it is
// the way back to "Reset ignored".
function missingButton(kind) {
  const n = missingCount(kind);
  if (!n && !ignoredCount(kind)) return '';
  return `<button type="button" class="btn btn-sm missing-btn" onclick="openMissing('${kind}')">
      What am I missing?${n ? ` <span class="missing-count">${n}</span>` : ''}</button>`;
}

function openMissing(kind) {
  const spec = MISSING[kind];
  if (!spec) return;
  const items = spec.list();
  const ignored = ignoredCount(kind);
  const empty = ignored ? 'Nothing left to show: every gap is ignored.' : spec.empty;
  document.getElementById('missingBody').innerHTML = `
    <div class="modal-title" id="missingTitle">${esc(spec.heading)}</div>
    <div class="missing-list">${items.length ? items.map(spec.row).join('') : `<p class="muted">${esc(empty)}</p>`}</div>
    <div class="detail-actions">
      ${ignored ? `<span class="missing-ignored">${ignored} series ignored</span>
        <button type="button" class="btn btn-sm" onclick="${spec.reset}">Reset ignored</button>` : ''}
      <span class="detail-spacer"></span>
      <button type="button" class="btn" onclick="closeMissing()">Close</button></div>`;
  document.getElementById('missingModal').classList.add('open');
}

function closeMissing() { document.getElementById('missingModal')?.classList.remove('open'); }

function handleMissingBackdrop(e) {
  if (e.target === document.getElementById('missingModal')) closeMissing();
}

function openMissingItem(kind, id) {
  closeMissing();
  openDetail(kind, id);
}

// The add form, with the series and the first missing number filled in.
function addMissingBook(series, number) {
  closeMissing();
  openAddModal();
  document.getElementById('f-series').value = series;
  document.getElementById('f-seriesIndex').value = String(number);
  document.getElementById('f-title').focus();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('missingModal')?.classList.contains('open')) closeMissing();
});
