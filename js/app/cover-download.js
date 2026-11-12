// cover-download.js — "Save copies of linked covers": download every cover
// that is still a link (books' and games' coverUrl, films' posterUrl) and
// keep a copy instead, through the same path as an upload (cover-files.js:
// resized, size-capped, kept in IndexedDB, uploaded to the data repo).
//
// One at a time with a short pause, so a large library doesn't hammer the
// image sites. A cover whose site refuses (CORS), is missing or too big
// keeps its link and is listed at the end with the reason. The run can be
// stopped at any point; what was saved stays saved, and a later run picks up
// only what is still a link. A record edited meanwhile is left alone: the
// copy replaces the link only if the field still holds that same link.

const COVER_DL_KINDS = {
  books: { label: 'Books',       list: () => books,        field: 'coverUrl',  save: () => save() },
  media: { label: 'Movies & TV', list: () => mediaLibrary, field: 'posterUrl', save: () => saveMedia() },
  games: { label: 'Games',       list: () => videoGames,   field: 'coverUrl',  save: () => saveGames() },
};
const COVER_DL_PAUSE_MS = 250;
const COVER_DL_SAVE_EVERY = 20;     // records written per save (and sync push)
const COVER_DL_REASON = {
  blocked: "Site doesn't allow downloads", http: 'Not found or refused by the site', 'too-big': 'Too large',
  'not-image': "Link isn't an image", offline: 'Offline', encode: "Couldn't be converted",
};

let _coverDl = null;   // { jobs, done, saved, failed: [], stop, running, dirty: Set }

function linkedCoverJobs() {
  const jobs = [];
  for (const [kind, k] of Object.entries(COVER_DL_KINDS)) {
    for (const r of k.list()) {
      if (isLinkCover(r[k.field])) jobs.push({ kind, id: r.id, url: r[k.field].trim(), title: r.title || 'Untitled' });
    }
  }
  return jobs;
}

function paintCoverDownload() {
  const body = document.getElementById('coverDlBody');
  if (!body) return;
  const st = _coverDl;
  const head = `<div class="modal-title" id="coverDlTitle">Save copies of linked covers</div>`;
  if (!st || (!st.running && !st.finished)) {
    const jobs = linkedCoverJobs();
    const per = Object.keys(COVER_DL_KINDS).map(kind => [COVER_DL_KINDS[kind].label, jobs.filter(j => j.kind === kind).length])
      .filter(([, n]) => n).map(([l, n]) => `<li>${esc(l)}: <b>${n.toLocaleString()}</b></li>`).join('');
    body.innerHTML = `${head}
      <p class="dupes-intro">Downloads each cover that is still a link and keeps a copy in your data repo instead
        (resized, at most ${kb(COVER_MAX_BYTES)} each), so it no longer depends on the site it came from.
        Some sites don't allow their images to be downloaded by another site; those covers keep their link.</p>
      ${jobs.length ? `<ul class="resolve-counts">${per}</ul>
        <p class="dupes-intro">It goes one at a time, so a large library takes a while. Keep this tab open;
          you can stop at any point and run it again later to pick up the rest.</p>`
        : '<p class="dupes-intro"><b>Every cover is already a saved copy or uploaded image.</b></p>'}
      <div class="detail-actions"><span class="detail-spacer"></span>
        <button type="button" class="btn" onclick="closeCoverDownload()">Close</button>
        ${jobs.length ? `<button type="button" class="btn btn-primary" id="coverDlStart" onclick="startCoverDownload()">Save ${jobs.length.toLocaleString()} cover${jobs.length === 1 ? '' : 's'}</button>` : ''}
      </div>`;
    return;
  }
  const total = st.jobs.length;
  const pct = total ? Math.round(st.done / total * 100) : 100;
  const groups = {};
  st.failed.forEach(f => { (groups[f.reason] ||= []).push(f); });
  const failList = Object.entries(groups).map(([reason, list]) => `<details class="resolve-list"><summary>${esc(COVER_DL_REASON[reason] || reason)} (${list.length})</summary>
      <ul>${list.slice(0, 100).map(f => `<li>${esc(f.title)} <span class="muted">— ${esc(COVER_DL_KINDS[f.kind].label)}</span></li>`).join('')}
      ${list.length > 100 ? `<li class="muted">…and ${list.length - 100} more</li>` : ''}</ul></details>`).join('');
  body.innerHTML = `${head}
    <div class="cover-dl-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${st.done}" aria-label="Covers processed">
      <div style="width:${pct}%"></div></div>
    <p class="cover-dl-status" role="status">${st.running ? 'Saving…' : st.stopped ? 'Stopped.' : 'Done.'}
      ${st.done.toLocaleString()} of ${total.toLocaleString()} · <b>${st.saved.toLocaleString()} saved</b>${st.failed.length ? ` · ${st.failed.length.toLocaleString()} kept their link` : ''}</p>
    ${failList}
    <div class="detail-actions"><span class="detail-spacer"></span>
      ${st.running ? '<button type="button" class="btn" id="coverDlStop" onclick="stopCoverDownload()">Stop</button>'
        : '<button type="button" class="btn btn-primary" onclick="closeCoverDownload()">Close</button>'}
    </div>`;
}

function openCoverDownload() {
  if (_coverDl && _coverDl.finished) _coverDl = null;    // a finished run's report was seen; start fresh
  paintCoverDownload();
  document.getElementById('coverDlModal').classList.add('open');
}

function closeCoverDownload() {
  document.getElementById('coverDlModal')?.classList.remove('open');
  // A running download carries on; reopening shows its progress.
}

function handleCoverDlBackdrop(e) {
  if (e.target === document.getElementById('coverDlModal')) closeCoverDownload();
}

function stopCoverDownload() { if (_coverDl) _coverDl.stop = true; }

function flushCoverDownloadSaves() {
  if (!_coverDl || !_coverDl.dirty.size) return;
  _coverDl.dirty.forEach(kind => COVER_DL_KINDS[kind].save());
  _coverDl.dirty.clear();
  renderPage();
}

async function startCoverDownload() {
  if (_coverDl && _coverDl.running) return;
  const st = _coverDl = { jobs: linkedCoverJobs(), done: 0, saved: 0, failed: [], stop: false, stopped: false,
    running: true, finished: false, dirty: new Set(), sinceSave: 0 };
  const byUrl = new Map();   // the same link on several entries is downloaded once
  paintCoverDownload();
  for (const job of st.jobs) {
    if (st.stop) { st.stopped = true; break; }
    try {
      if (!byUrl.has(job.url)) byUrl.set(job.url, copyCoverFromLink(job.url, job.kind));
      const value = await byUrl.get(job.url);
      const k = COVER_DL_KINDS[job.kind];
      const rec = k.list().find(r => r.id === job.id);
      if (rec && rec[k.field] && rec[k.field].trim() === job.url) {
        rec[k.field] = value;
        st.dirty.add(job.kind);
        st.saved++;
        if (++st.sinceSave >= COVER_DL_SAVE_EVERY) { flushCoverDownloadSaves(); st.sinceSave = 0; }
      }
    } catch (err) {
      byUrl.delete(job.url);
      st.failed.push({ ...job, reason: (err && err.reason) || 'blocked' });
    }
    st.done++;
    paintCoverDownload();
    await new Promise(r => setTimeout(r, COVER_DL_PAUSE_MS));
  }
  flushCoverDownloadSaves();
  st.running = false; st.finished = true;
  paintCoverDownload();
  flashBanner(`Saved ${st.saved.toLocaleString()} cover${st.saved === 1 ? '' : 's'}${st.failed.length ? `; ${st.failed.length.toLocaleString()} kept their link` : ''}.`);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('coverDlModal')?.classList.contains('open')) closeCoverDownload();
});
