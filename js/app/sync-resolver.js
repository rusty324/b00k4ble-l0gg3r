// sync-resolver.js — what happens when this device first syncs with a data
// repo that already holds a library, and the two differ.
//
// Left to itself, ghsync would merge them by id with this device winning
// wherever the same entry differs — a library that happened to be here would
// quietly override the repo's. Instead, sync.js asks syncNeedsDecision()
// before that first write; when it says yes, ghsync holds the write (nothing
// is sent) and this sheet asks, per collection:
//
//   Merge both      every entry from each side; where an entry is in both and
//                   differs, the repo's version unless chosen otherwise, one
//                   by one or all at once.
//   Use the repo's  this device takes the repo's copy; entries only here go.
//   Use this device's  the repo takes this device's copy; entries only in the
//                   repo are deleted (as tombstones, so other devices drop
//                   them too).
//
// "Decide later" leaves it held: nothing syncs for that collection until it
// is decided, and the sync panel says so.

const RESOLVE_TITLE = { books: '📚 Books', media: '🎬 Movies & TV', games: '🎮 Games', wishlist: '📋 Wishlist' };

// A record as compared: normalized the way the app would load it, so a field
// an older version wrote differently is not a "difference"; a tombstone is
// just "deleted".
function resolveKey(collection, r) {
  if (!r || r.deleted) return 'deleted';
  const spec = SYNC_COLLECTIONS[collection];
  return stableJson(spec ? spec.normalize(r) : r);
}

function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter(k => k !== '_searchStr' && v[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// What differs between this device's copy and the repo's, by id.
function syncDiff(collection, local, remote) {
  const L = new Map(local.map(r => [r.id, r]));
  const R = new Map(remote.map(r => [r.id, r]));
  const onlyLocal = local.filter(r => !r.deleted && !R.has(r.id));
  const onlyRemote = remote.filter(r => !r.deleted && !L.has(r.id));
  const differ = [];
  let same = 0;
  for (const [id, l] of L) {
    const r = R.get(id);
    if (!r) continue;
    if (resolveKey(collection, l) === resolveKey(collection, r)) { if (!l.deleted) same++; continue; }
    differ.push({ id, local: l, remote: r, fields: changedFields(collection, l, r) });
  }
  return { onlyLocal, onlyRemote, differ, same };
}

function changedFields(collection, l, r) {
  if (l.deleted) return ['deleted on this device'];
  if (r.deleted) return ['deleted in the repo'];
  const spec = SYNC_COLLECTIONS[collection];
  const a = spec ? spec.normalize(l) : l, b = spec ? spec.normalize(r) : r;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(k => k !== '_searchStr' && stableJson(a[k]) !== stableJson(b[k]));
}

// Asked by ghsync before the first write of a collection to a repo that has
// it. Only a difference this device would impose needs asking: when the repo
// already holds everything here, merging just brings the repo's extras in.
function syncNeedsDecision(collection, local, remote) {
  const d = syncDiff(collection, local, remote);
  return d.onlyLocal.length > 0 || d.differ.length > 0;
}

// The records a choice produces.
//   choice = { mode: 'merge' | 'repo' | 'device', pick: { [id]: 'repo' | 'device' } }
function resolvedRecords(collection, local, remote, choice) {
  if (choice.mode === 'repo') return remote;
  const L = new Map(local.map(r => [r.id, r]));
  if (choice.mode === 'device') {
    const now = Date.now();
    return [...local, ...remote.filter(r => !r.deleted && !L.has(r.id))
      .map(r => ({ id: r.id, deleted: true, deletedAt: now }))];
  }
  const R = new Set(remote.map(r => r.id));
  const out = remote.map(r => {
    const l = L.get(r.id);
    if (!l || resolveKey(collection, l) === resolveKey(collection, r)) return r;
    return choice.pick[r.id] === 'device' ? l : r;
  });
  for (const l of local) if (!R.has(l.id)) out.push(l);
  return out;
}

const resolveName = (...rs) => (rs.find(r => r && r.title) || {}).title || 'Untitled';
const fieldLabel = f => ({ genre: 'genres', formats: 'formats', coverUrl: 'cover', posterUrl: 'poster',
  seasonCount: 'season count', tmdbId: 'TMDb id', notDuplicateOf: 'duplicate marks', ignoredGaps: 'ignored gaps' }[f] || f);

function titleList(records, label) {
  if (!records.length) return '';
  const shown = records.slice(0, 50).map(r => `<li>${esc(resolveName(r))}</li>`).join('');
  return `<details class="resolve-list"><summary>${label}</summary><ul>${shown}${records.length > 50 ? `<li class="muted">…and ${records.length - 50} more</li>` : ''}</ul></details>`;
}

function resolveSection(p) {
  const local = ghStore.get(p.collection);
  const d = syncDiff(p.collection, local, p.remote);
  const c = p.collection;
  const n = (k, word) => `${k} ${k === 1 ? 'entry' : 'entries'}${word}`;
  return `<section class="resolve-section" data-collection="${c}">
    <h3 class="dupes-kind">${RESOLVE_TITLE[c] || esc(c)}</h3>
    <ul class="resolve-counts">
      <li>Only on this device: <b>${d.onlyLocal.length}</b></li>
      <li>Only in the repo: <b>${d.onlyRemote.length}</b></li>
      <li>In both, but different: <b>${d.differ.length}</b></li>
      <li>The same in both: <b>${d.same}</b></li>
    </ul>
    ${titleList(d.onlyLocal, 'Show what is only on this device')}
    ${titleList(d.onlyRemote, 'Show what is only in the repo')}
    <div class="resolve-options" role="radiogroup" aria-label="How to combine ${esc(RESOLVE_TITLE[c] || c)}">
      <label class="resolve-option"><input type="radio" name="rs-${c}" value="merge" checked>
        <span><b>Merge both</b> — keep every entry from each side.</span></label>
      <label class="resolve-option"><input type="radio" name="rs-${c}" value="repo">
        <span><b>Use the repo's</b> — replace this device's copy${d.onlyLocal.length ? `; ${n(d.onlyLocal.length, ' only on this device')} will be removed here` : ''}.</span></label>
      <label class="resolve-option"><input type="radio" name="rs-${c}" value="device">
        <span><b>Use this device's</b> — replace the repo's copy${d.onlyRemote.length ? `; ${n(d.onlyRemote.length, ' only in the repo')} will be deleted` : ''}.</span></label>
    </div>
    ${d.differ.length ? `<div class="resolve-differ">
      <p>Where an entry is in both but differs, keep:</p>
      <div class="field-row">
        <button type="button" class="btn btn-sm" onclick="resolvePickAll('${c}', 'repo')">The repo's, for all</button>
        <button type="button" class="btn btn-sm" onclick="resolvePickAll('${c}', 'device')">This device's, for all</button>
      </div>
      <details class="resolve-list"><summary>Choose for each (${d.differ.length})</summary>
        ${d.differ.map(x => `<div class="resolve-pick">
          <div class="resolve-pick-text"><div class="missing-name">${esc(resolveName(x.local, x.remote))}</div>
            <div class="missing-have">Differs in: ${esc(x.fields.map(fieldLabel).join(', '))}</div></div>
          <div class="resolve-pick-opts">
            <label><input type="radio" name="rp-${c}-${x.id}" value="repo" checked> Repo</label>
            <label><input type="radio" name="rp-${c}-${x.id}" value="device"> This device</label>
          </div></div>`).join('')}
      </details>
    </div>` : ''}
  </section>`;
}

function openSyncResolver() {
  const store = window.ghStore;
  const pending = store && store.pendingResolutions ? store.pendingResolutions() : [];
  if (!pending.length) { closeSyncResolver(); return; }
  document.getElementById('resolveBody').innerHTML = `
    <div class="modal-title" id="resolveTitle">This device and the data repo differ</div>
    <p class="dupes-intro">This is the first sync with this repository, and it already holds a library.
      Nothing has been uploaded yet — choose how to combine them.</p>
    ${pending.map(resolveSection).join('')}
    <div class="detail-actions"><span class="detail-spacer"></span>
      <button type="button" class="btn" onclick="closeSyncResolver()">Decide later</button>
      <button type="button" class="btn btn-primary" id="resolveApply" onclick="applySyncResolution()">Apply</button></div>`;
  document.getElementById('resolveModal').classList.add('open');
}

// Held collections arrive one push at a time, a moment apart: open once they settle.
function queueSyncResolver() {
  clearTimeout(queueSyncResolver._t);
  queueSyncResolver._t = setTimeout(openSyncResolver, 300);
}

function closeSyncResolver() { document.getElementById('resolveModal')?.classList.remove('open'); }

function handleResolveBackdrop(e) {
  if (e.target === document.getElementById('resolveModal')) closeSyncResolver();
}

function resolvePickAll(collection, side) {
  document.querySelectorAll(`#resolveBody input[type="radio"][name^="rp-${collection}-"][value="${side}"]`)
    .forEach(i => { i.checked = true; });
}

async function applySyncResolution() {
  const btn = document.getElementById('resolveApply');
  if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
  const store = window.ghStore;
  for (const p of store.pendingResolutions()) {
    const c = p.collection;
    const mode = document.querySelector(`#resolveBody input[name="rs-${c}"]:checked`)?.value || 'merge';
    const pick = {};
    document.querySelectorAll(`#resolveBody input[type="radio"][name^="rp-${c}-"]:checked`)
      .forEach(i => { pick[Number(i.name.slice(`rp-${c}-`.length))] = i.value; });
    const records = resolvedRecords(c, store.get(c), p.remote, { mode, pick });
    await store.resolve(p.path, records);
  }
  closeSyncResolver();
  flashBanner('Sync choices applied.');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('resolveModal')?.classList.contains('open')) closeSyncResolver();
});
