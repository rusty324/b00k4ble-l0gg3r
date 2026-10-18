// render-stats.js — the Stats tab: the numbers for Books, Movies & TV and
// Games in one place, so the library tabs open straight onto their lists.
// Everything here is counted from the in-memory arrays on each render; the
// whole library is a few thousand records at most, so there is no cache.

// ─── STATS RENDERING ──────────────────────────────────────────────────
const statCard = (label, value, sub = '') => `<div class="stat-card">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(String(value))}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
  </div>`;

const statShare = (n, total) => `${total ? Math.round(n / total * 100) : 0}% of library`;

// Average of the rated items, '—' when none are.
function statRating(items) {
  const rated = items.filter(r => r.rating > 0);
  const avg = rated.length ? (rated.reduce((sum, r) => sum + r.rating, 0) / rated.length).toFixed(1) : '—';
  return statCard('Avg rating', avg, `${rated.length} rated`);
}

function bookStats() {
  const total = books.length;
  const has   = f => books.filter(b => b.formats.includes(f)).length;
  // Read this calendar year, from the finished month; and last year for scale.
  const year   = new Date().getFullYear();
  const readIn = y => books.filter(b => b.status === 'read' && (b.finished || '').startsWith(`${y}-`)).length;
  return [
    statCard('Total', total, `${books.filter(b => b.status === 'read').length} read · ${books.filter(b => b.status === 'reading').length} in progress`),
    statCard(`Read in ${year}`, readIn(year), `${readIn(year - 1)} in ${year - 1}`),
    statCard('Physical', has('physical'), statShare(has('physical'), total)),
    statCard('E-books', has('ebook'), statShare(has('ebook'), total)),
    statCard('Audiobooks', has('audio'), statShare(has('audio'), total)),
    statRating(books),
  ];
}

function mediaStats() {
  const total  = mediaLibrary.length;
  const shows  = mediaLibrary.filter(m => m.type === 'tv');
  const seasons = shows.reduce((n, m) => n + (m.seasons || []).length, 0);
  const has    = f => mediaLibrary.filter(m => (m.formats || []).includes(f)).length;
  return [
    statCard('Total', total, `${mediaLibrary.filter(m => m.status === 'watched').length} watched · ${mediaLibrary.filter(m => m.status === 'want').length} to watch`),
    statCard('Movies', total - shows.length, statShare(total - shows.length, total)),
    statCard('TV shows', shows.length, seasons ? `${seasons} season${seasons === 1 ? '' : 's'} owned` : statShare(shows.length, total)),
    ...['bluray', 'dvd', 'digital', 'streaming'].map(f => statCard(MEDIA_FORMAT_LABEL[f], has(f), statShare(has(f), total))),
    statRating(mediaLibrary),
  ];
}

function gameStats() {
  const total = videoGames.length;
  // A game on two platforms counts once on each; the known platforms come
  // first, in the form's order, then anything else that was stored.
  const onPlatform = {};
  videoGames.forEach(g => new Set((g.platforms || []).map(p => p.platform)).forEach(p => {
    if (p) onPlatform[p] = (onPlatform[p] || 0) + 1;
  }));
  const platforms = [...GAME_PLATFORMS.filter(p => onPlatform[p]),
                     ...Object.keys(onPlatform).filter(p => !GAME_PLATFORMS.includes(p)).sort()];
  const held = f => videoGames.filter(g => (g.platforms || []).some(p => (p.formats || []).includes(f))).length;
  const dlc = videoGames.flatMap(g => g.dlc || []);
  const dlcOwned = dlc.filter(d => d.owned).length;
  return [
    statCard('Total', total, `${videoGames.filter(g => g.status === 'completed').length} completed · ${videoGames.filter(g => g.status === 'playing').length} playing`),
    ...platforms.map(p => statCard(platformLabel(p), onPlatform[p], statShare(onPlatform[p], total))),
    ...GAME_FORMATS.filter(f => f !== 'ps-plus' || held(f)).map(f => statCard(GAME_FORMAT_LABEL[f], held(f), statShare(held(f), total))),
    ...(dlc.length ? [statCard('DLC owned', dlcOwned, `${dlc.length - dlcOwned} wishlisted`)] : []),
    statRating(videoGames),
  ];
}

const STATS_SECTIONS = [
  { tab: 'books', title: '📚 Books',       items: () => books,        cards: bookStats,  empty: 'No books yet.' },
  { tab: 'media', title: '🎬 Movies & TV', items: () => mediaLibrary, cards: mediaStats, empty: 'No movies or shows yet.' },
  { tab: 'games', title: '🎮 Games',       items: () => videoGames,   cards: gameStats,  empty: 'No games yet.' },
];

function renderStatsTab() {
  document.getElementById('altContent').innerHTML = STATS_SECTIONS.map(s => `
    <section class="stats-section" aria-labelledby="stats-${s.tab}">
      <div class="stats-head">
        <h2 class="stats-title" id="stats-${s.tab}">${s.title}</h2>
        <button type="button" class="btn btn-sm" onclick="switchTab('${s.tab}')">Open →</button>
      </div>
      ${s.items().length
        ? `<div class="stats-bar">${s.cards().join('')}</div>`
        : `<p class="stats-empty">${s.empty}</p>`}
    </section>`).join('');
}
