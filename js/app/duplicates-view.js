// duplicates-view.js — ⋯ → "Find duplicates…": every group of records that
// the add form's duplicate check (sameRecord, core.js) would call the same
// thing, across Books, Movies & TV, Games and the Wishlist.
//
// The add form only stops a duplicate going in; this finds the ones already
// there — imported twice, added on two devices before they synced, or saved
// before the check existed. Each group lists its records oldest first, each
// with Open and Delete, and "Not duplicates" for a group that only looks
// alike (two different books called "Collected Stories"). That answer is
// kept on the records themselves (`notDuplicateOf`: the ids each was judged
// distinct from), so it syncs and exports like everything else.

const DUP_KINDS = [
  { kind: 'books',    title: '📚 Books',       save: () => save(),         del: id => deleteBook(id) },
  { kind: 'media',    title: '🎬 Movies & TV', save: () => saveMedia(),    del: id => deleteMediaItem(id) },
  { kind: 'games',    title: '🎮 Games',       save: () => saveGames(),    del: id => deleteGameItem(id) },
  { kind: 'wishlist', title: '📋 Wishlist',    save: () => saveWishlist(), del: id => deleteWishlistItem(id) },
];

const notDupOf = r => new Set(Array.isArray(r.notDuplicateOf) ? r.notDuplicateOf.map(Number) : []);

// The keys that can make two records the same, so only records sharing one
// are ever compared — a library of thousands is not compared pairwise.
function dupBuckets(kind, r) {
  const tk = dupTitleKey(r.title);
  switch (kind) {
    case 'books':    return [...[...bookIsbns(r)].map(x => `i:${x}`), ...[...bookAsins(r)].map(x => `a:${x}`), tk && `t:${tk}`];
    case 'media':    return [r.tmdbId != null && `m:${r.type}:${r.tmdbId}`, tk && `t:${r.type}:${tk}`];
    case 'games':    { const bk = dupTitleKey(splitEdition(r.title).base); return [bk && `t:${bk}`]; }
    case 'wishlist': return [tk && `t:${r.type}:${tk}`];
  }
  return [];
}

// Groups of two or more records that are the same thing, oldest first.
// Linked transitively: if A matches B by ISBN and B matches C by title, all
// three are one group. A pair marked "Not duplicates" is never linked.
function duplicateGroups(kind) {
  const arr = collectionArray(kind);
  const parent = arr.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const buckets = new Map();
  arr.forEach((r, i) => dupBuckets(kind, r).filter(Boolean).forEach(k => {
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  }));
  for (const idx of buckets.values()) {
    for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
      const a = arr[idx[x]], b = arr[idx[y]];
      if (find(idx[x]) === find(idx[y]) || notDupOf(a).has(b.id) || notDupOf(b).has(a.id)) continue;
      if (sameRecord(kind, a, b)) parent[find(idx[x])] = find(idx[y]);
    }
  }
  const groups = new Map();
  arr.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  });
  return [...groups.values()].filter(g => g.length > 1)
    .map(g => g.sort((a, b) => a.id - b.id))
    .sort((a, b) => titleSortKey(a[0].title).localeCompare(titleSortKey(b[0].title)));
}

// One line saying what tells the copies apart.
function dupSummary(kind, r) {
  const added = idAsTime(r.id);
  const bits = {
    books:    () => [r.author, r.series, (r.formats || []).map(f => BOOK_FORMAT_LABEL[f] || f).join(', '), r.isbn && `ISBN ${r.isbn}`],
    media:    () => [r.year, (r.copies || []).length ? mediaCopiesSummary(r.copies) : ''],
    games:    () => [gamePlatformText(r)],
    wishlist: () => [r.creator, r.type],
  }[kind]();
  if (added !== null) bits.push(`added ${new Date(added).toLocaleDateString(undefined, { dateStyle: 'medium' })}`);
  return bits.filter(Boolean).map(String).join(' · ');
}

function dupRow(kind, r) {
  return `<div class="dup-row">
      <div class="dup-row-text">
        <div class="missing-name">${esc(r.title || 'Untitled')}</div>
        <div class="missing-have">${esc(dupSummary(kind, r))}</div>
      </div>
      <div class="missing-actions">
        <button type="button" class="btn btn-sm" onclick="openDupItem('${kind}', ${r.id})">Open</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteDupItem('${kind}', ${r.id})">Delete</button>
      </div>
    </div>`;
}

function openDuplicates() {
  const sections = DUP_KINDS.map(d => ({ ...d, groups: duplicateGroups(d.kind) })).filter(d => d.groups.length);
  const total = sections.reduce((n, d) => n + d.groups.length, 0);
  document.getElementById('dupesBody').innerHTML = `
    <div class="modal-title" id="dupesTitle">Possible duplicates</div>
    ${total ? `<p class="dupes-intro">${total} group${total === 1 ? '' : 's'} of entries that look like the same thing.
      Keep one and delete the rest, or say they are different.</p>` : ''}
    ${total ? sections.map(d => `
      <h3 class="dupes-kind">${d.title}</h3>
      <div class="missing-list">${d.groups.map(g => `
        <div class="missing-item dup-group">
          ${g.map(r => dupRow(d.kind, r)).join('')}
          <div class="missing-actions">
            ${d.kind === 'media' || d.kind === 'games' ? `<button type="button" class="btn btn-sm btn-primary" onclick="openMergeDialog('${d.kind}', ${jsArg(g.map(r => r.id))})">Merge into one title</button>` : ''}
            <button type="button" class="btn btn-sm" onclick="markNotDuplicates('${d.kind}', ${jsArg(g.map(r => r.id))})">Not duplicates</button>
          </div>
        </div>`).join('')}</div>`).join('')
      : '<p class="muted">No duplicates found.</p>'}
    <div class="detail-actions"><span class="detail-spacer"></span>
      <button type="button" class="btn" onclick="closeDuplicates()">Close</button></div>`;
  document.getElementById('dupesModal').classList.add('open');
}

function closeDuplicates() { document.getElementById('dupesModal')?.classList.remove('open'); }

function handleDupesBackdrop(e) {
  if (e.target === document.getElementById('dupesModal')) closeDuplicates();
}

// The wishlist has no detail sheet; its edit form shows everything.
function openDupItem(kind, id) {
  closeDuplicates();
  if (kind === 'wishlist') openWishlistModal(id);
  else openDetail(kind, id);
}

// The tab's own delete (with its confirm), then the sheet again, minus it.
function deleteDupItem(kind, id) {
  DUP_KINDS.find(d => d.kind === kind).del(id);
  if (!collectionArray(kind).some(r => r.id === id)) { renderPage(); openDuplicates(); }
}

// ─── Merge ────────────────────────────────────────────────────────────
// Movies & TV and Games: one title holding every copy. The dialog names the
// survivor, says where the entries disagreed and what wins, and offers to
// treat set-like edition text ("… Collection") as a set.
let _merge = null;   // { kind, ids }

function mergeRecs(kind, ids) {
  return ids.map(id => collectionArray(kind).find(r => r.id === id)).filter(Boolean);
}

function openMergeDialog(kind, ids) {
  const recs = mergeRecs(kind, ids);
  if (recs.length < 2) return;
  _merge = { kind, ids };
  const survivor = mergeSurvivor(recs);
  const preview = mergeRecords(kind, survivor, recs.filter(r => r !== survivor));
  const differs = (label, vals, shown, won) => new Set(vals.map(String)).size > 1
    ? `<li><strong>${label}:</strong> ${vals.map(v => esc(shown(v))).join(' vs ')} → <strong>${esc(shown(won))}</strong></li>` : '';
  const disagreements = [
    differs('Status', recs.map(r => r.status), v => statusLabel(kind, v), preview.status),
    differs('Rating', recs.map(r => r.rating || 0), v => (v ? `${v}★` : 'unrated'), preview.rating || 0),
    differs('Year', recs.map(r => r.year || ''), v => v || 'none', preview.year || ''),
  ].join('');
  const setLike = setLikeEditions(recs);
  const copies = preview.copies || [];
  document.getElementById('dupesBody').innerHTML = `
    <div class="modal-title" id="dupesTitle">Merge into one title</div>
    <p>Keeps <strong>${esc(survivor.title)}</strong>${survivor.year ? ` (${esc(String(survivor.year))})` : ''} with
      ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'}; the other ${recs.length - 1 === 1 ? 'entry is' : `${recs.length - 1} entries are`} removed.</p>
    ${disagreements ? `<p class="hint">Where they disagreed:</p><ul class="merge-diffs">${disagreements}</ul>` : ''}
    ${setLike.map(e => `<label class="merge-set"><input type="checkbox" checked data-set-edition="${esc(e)}">
      Treat “${esc(e)}” as a set, not an edition</label>`).join('')}
    <div class="detail-actions"><span class="detail-spacer"></span>
      <button type="button" class="btn" onclick="openDuplicates()">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="confirmMerge()">Merge</button></div>`;
}

function confirmMerge() {
  if (!_merge) return;
  const { kind, ids } = _merge;
  _merge = null;
  const recs = mergeRecs(kind, ids);
  if (recs.length < 2) return openDuplicates();
  const asSets = [...document.querySelectorAll('#dupesBody [data-set-edition]')].filter(b => b.checked).map(b => b.dataset.setEdition);
  const survivor = mergeSurvivor(recs);
  const merged = mergeRecords(kind, survivor, recs.filter(r => r !== survivor), { asSets });
  const drop = new Set(recs.filter(r => r !== survivor).map(r => r.id));
  const keep = list => list.filter(r => !drop.has(r.id)).map(r => (r.id === merged.id ? merged : r));
  if (kind === 'media') { mediaLibrary = keep(mediaLibrary); saveMedia(); }
  else { videoGames = keep(videoGames); saveGames(); }
  renderPage();
  openDuplicates();
}

// Kept for the media suite and any caller from before the dialog.
function mergeDuplicates(ids, kind = 'media') { openMergeDialog(kind, ids); }

// Every record in the group is marked distinct from every other, so the
// group never comes back; a new copy added later still matches as usual.
function markNotDuplicates(kind, ids) {
  const group = new Set(ids);
  const arr = collectionArray(kind);
  for (let i = 0; i < arr.length; i++) {
    if (!group.has(arr[i].id)) continue;
    const others = new Set([...notDupOf(arr[i]), ...ids.filter(id => id !== arr[i].id)]);
    arr[i] = { ...arr[i], notDuplicateOf: [...others].sort((a, b) => a - b) };
  }
  DUP_KINDS.find(d => d.kind === kind).save();
  openDuplicates();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('dupesModal')?.classList.contains('open')) closeDuplicates();
});
