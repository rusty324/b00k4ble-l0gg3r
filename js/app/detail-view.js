// detail-view.js — the sheet a library card opens when tapped. Cards stay
// short (cover, title, author or year, status, rating, a few small badges);
// everything else about a record lives here: genres, notes, links, editions,
// seasons, platforms and their formats, DLC, narrator, finished month, ISBN.
//
// It is also where a phone can read what used to be hover-only — the edition
// behind a format icon, which formats a platform badge stands for — since a
// touch screen has no hover.
//
// One sheet for the three library tabs, filled per kind. Tapping a card opens
// it (delegated, so it covers every render and every later re-render);
// tapping a cover still opens the full-size cover, and buttons and links on a
// list row still do their own thing.

const BOOK_FORMAT_LABEL = { physical: '📚 Physical', ebook: '📱 E-book', audio: '🎧 Audiobook' };

let _detail = null;   // { kind, id } while open

const detailRecord = (kind, id) =>
  ({ books, media: mediaLibrary, games: videoGames })[kind]?.find(r => r.id === id) || null;

// One labelled fact, or nothing when there is nothing to say.
const fact = (label, html) => html ? `<dt>${esc(label)}</dt><dd>${html}</dd>` : '';

function detailStars(rating) {
  const r = Math.max(0, Math.min(5, rating || 0));
  return r ? `<span class="stars">${'★'.repeat(r)}<span class="empty">${'★'.repeat(5 - r)}</span></span>` : '';
}

function addedFact(id) {
  const t = idAsTime(id);
  return t === null ? '' : esc(new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' }));
}

function detailBook(b) {
  const status = { read: 'Read', reading: 'Reading', want: 'Want to read' }[b.status] || b.status;
  return {
    cover: b.coverUrl || (_coverCache[b.id] && !['none', 'pending'].includes(_coverCache[b.id]) ? _coverCache[b.id] : ''),
    title: b.title, sub: b.author,
    badges: `<span class="badge badge-${b.status === 'read' ? 'read' : b.status === 'reading' ? 'reading' : 'want'}">${esc(status)}</span>${detailStars(b.rating)}`,
    facts: [
      fact('Narrated by', esc(b.narrator || '')),
      fact('Series', esc(b.series || '')),
      fact('Series gaps', (() => {
        const s = seriesGaps().find(x => x.books.includes(b));
        return s ? `Missing ${esc(compressRanges(s.missing, '#'))}` : '';
      })()),
      fact('Formats', (b.formats || []).map(f => esc(BOOK_FORMAT_LABEL[f] || f)).join('<br>')),
      fact('Finished', b.status === 'read' && b.finished ? esc(finishedLabel(b.finished)) : ''),
      fact('ISBN', esc(b.isbn || '')),
      fact('ASIN', esc(b.asin || '')),
      fact('Added', addedFact(b.id)),
    ].join(''),
    genre: b.genre, notes: b.notes, links: b.links,
  };
}

function detailMedia(m) {
  const status = { want: 'Want to Watch', watched: 'Watched' }[m.status] || m.status;
  const formats = (m.formats || []).map(f => {
    const ed = m.editions && m.editions[f];
    return `${MEDIA_FORMAT_ICON[f] || ''} ${esc(MEDIA_FORMAT_LABEL[f] || f)}${ed ? ` — ${esc(ed)}` : ''}`;
  }).join('<br>');
  return {
    cover: m.posterUrl, title: m.title,
    sub: [m.type === 'tv' ? 'TV show' : 'Movie', m.year].filter(Boolean).join(' · '),
    badges: `<span class="badge ${m.status === 'watched' ? 'badge-watched' : 'badge-want'}">${esc(status)}</span>${detailStars(m.rating)}`,
    facts: [
      fact('Formats', formats),
      fact('Seasons', m.type === 'tv' ? esc(seasonsText(m.seasons, m.seasonCount)) : ''),
      fact('Missing', (() => { const gap = seasonGaps(m);
        return gap.length ? `${gap.length === 1 ? 'Season' : 'Seasons'} ${esc(compressRanges(gap))}` : ''; })()),
      fact('Added', addedFact(m.id)),
    ].join(''),
    genre: m.genre, notes: m.notes, links: m.links,
  };
}

function detailGame(g) {
  const status = { want: 'Want to Play', playing: 'Playing', completed: 'Completed' }[g.status] || g.status;
  const platforms = (g.platforms || []).map(p => {
    const f = (p.formats || []).map(x => `${GAME_FORMAT_ICON[x] || ''} ${esc(GAME_FORMAT_LABEL[x] || x)}`).join(', ');
    return `${esc(platformLabel(p.platform))}${f ? ` — ${f}` : ''}`;
  }).join('<br>');
  const dlc = (g.dlc || []).map(d =>
    `<span class="${d.owned ? 'dlc-owned' : 'dlc-want'}">${esc(d.name)}${d.owned ? '' : ' (wishlist)'}</span>`).join('<br>');
  return {
    cover: g.coverUrl, title: g.title, sub: g.year ? String(g.year) : '',
    badges: `<span class="badge ${g.status === 'completed' ? 'badge-watched' : g.status === 'playing' ? 'badge-reading' : 'badge-want'}">${esc(status)}</span>${detailStars(g.rating)}`,
    facts: [
      fact('Platforms', platforms),
      fact('DLC', dlc),
      fact('Added', addedFact(g.id)),
    ].join(''),
    genre: g.genre, notes: g.notes, links: g.links,
  };
}

const DETAIL = {
  books: { build: detailBook,  edit: id => openEditModal(id),  del: id => deleteBook(id) },
  media: { build: detailMedia, edit: id => openMediaModal(id), del: id => deleteMediaItem(id) },
  games: { build: detailGame,  edit: id => openGameModal(id),  del: id => deleteGameItem(id) },
};

function openDetail(kind, id) {
  const rec = detailRecord(kind, id);
  const spec = DETAIL[kind];
  if (!rec || !spec) return;
  const d = spec.build(rec);
  const body = document.getElementById('detailBody');
  body.innerHTML = `
    <div class="detail-head">
      ${d.cover
        ? `<img class="detail-cover" src="${esc(d.cover)}" alt="Cover — tap to enlarge">`
        : `<div class="detail-cover detail-cover-none" aria-hidden="true">${kind === 'games' ? '🎮' : kind === 'media' ? '🎬' : esc((d.title || '?')[0].toUpperCase())}</div>`}
      <div class="detail-headtext">
        <h2 class="detail-title" id="detailTitle">${esc(d.title)}</h2>
        ${d.sub ? `<div class="detail-sub">${esc(d.sub)}</div>` : ''}
        <div class="detail-badges">${d.badges}</div>
      </div>
    </div>
    ${d.facts ? `<dl class="detail-facts">${d.facts}</dl>` : ''}
    ${(d.genre || []).length ? `<div class="detail-section"><div class="detail-label">Genre</div>
      <div class="book-tags">${d.genre.map(x => `<span class="badge badge-tag">${esc(x)}</span>`).join('')}</div></div>` : ''}
    ${d.notes ? `<div class="detail-section"><div class="detail-label">Notes</div><div class="detail-notes">${esc(d.notes)}</div></div>` : ''}
    ${(d.links || []).length ? `<div class="detail-section"><div class="detail-label">Where I own this</div>
      <div class="detail-links">${renderLinkButtons(d.links)}</div></div>` : ''}
    <div class="detail-actions">
      <button type="button" class="btn btn-danger" onclick="deleteFromDetail()">Delete</button>
      <span class="detail-spacer"></span>
      <button type="button" class="btn" onclick="closeDetail()">Close</button>
      <button type="button" class="btn btn-primary" onclick="editFromDetail()">Edit</button>
    </div>`;
  _detail = { kind, id };
  document.getElementById('detailModal').classList.add('open');
}

function closeDetail() {
  _detail = null;
  document.getElementById('detailModal')?.classList.remove('open');
}

function editFromDetail() {
  if (!_detail) return;
  const { kind, id } = _detail;
  closeDetail();
  DETAIL[kind].edit(id);
}

// The tab's own delete asks for confirmation; the sheet closes only if the
// record really went.
function deleteFromDetail() {
  if (!_detail) return;
  const { kind, id } = _detail;
  DETAIL[kind].del(id);
  if (!detailRecord(kind, id)) closeDetail();
}

function handleDetailBackdrop(e) {
  if (e.target === document.getElementById('detailModal')) closeDetail();
}

// A tap on a card or list row opens its details. Not when the tap was on a
// control inside it, and not when the cover lightbox already took it.
document.addEventListener('click', e => {
  if (e.defaultPrevented) return;
  const el = e.target.closest && e.target.closest('[data-detail]');
  if (!el || e.target.closest('button, a, input, select, textarea, label')) return;
  const [kind, id] = el.dataset.detail.split(':');
  openDetail(kind, Number(id));
});

// The sheet's own cover opens the full-size view, like a card's.
document.addEventListener('click', e => {
  const img = e.target.closest && e.target.closest('img.detail-cover');
  if (img) openCover(img.getAttribute('src'), '');
});

// Cards are focusable (tabindex), so Enter or Space opens them too.
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-detail]')) {
    e.preventDefault();
    const [kind, id] = e.target.dataset.detail.split(':');
    openDetail(kind, Number(id));
  }
});

// Escape closes the sheet — but not while the full-size cover is open on top
// of it: that Escape is the cover's. Capture phase, so this sees the cover
// still open before the cover's own handler closes it.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _detail && !document.getElementById('lightbox')?.classList.contains('open')) closeDetail();
}, true);
