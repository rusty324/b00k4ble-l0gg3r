// tmdb-client.js — the shared TMDb API client: search, key
// validation, and re-ranking short-title results. Used by disc
// verification, the media-modal search box, and cover
// identification alike. Split out of scanner.js.

// ─── TMDb (title search for discs) ────────────────────────────────────
function tmdbKey() {
  try { return (localStorage.getItem(TMDB_KEY_STORE) || '').trim(); } catch { return ''; }
}

function tmdbEnabled() { return !!tmdbKey(); }

function tmdbUrl(pathname, params) {
  const q = new URLSearchParams({ api_key: tmdbKey(), ...params });
  return `${TMDB_API_BASE}${pathname}?${q}`;
}

// Search results carry genre_ids, not names, so the id→name map is fetched
// once and cached; it changes very rarely.
async function tmdbGenreMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(TMDB_GENRE_STORE) || 'null');
    if (raw && Date.now() - raw.t < TMDB_GENRE_TTL) return raw.map;
  } catch { /* fall through and refetch */ }

  const map = {};
  try {
    const [mv, tv] = await Promise.all([
      fetchWithTimeout(tmdbUrl('/genre/movie/list', {})),
      fetchWithTimeout(tmdbUrl('/genre/tv/list', {})),
    ]);
    for (const res of [mv, tv]) {
      if (!res.ok) continue;
      const data = await res.json();
      (data.genres || []).forEach(g => { map[g.id] = g.name; });
    }
    if (Object.keys(map).length) {
      try { localStorage.setItem(TMDB_GENRE_STORE, JSON.stringify({ t: Date.now(), map })); }
      catch { /* quota — the map is an optimization */ }
    }
  } catch { /* genres are optional; the rest of the result is still useful */ }
  return map;
}

function normalizeTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

// TMDb orders by its own popularity-weighted relevance, which buries an exact
// match on a short common word — searching "Red" returns a page of titles
// merely containing it. Re-rank so an exact title wins outright.
function rankTmdbResults(query, results) {
  const q = normalizeTitle(query);
  return results
    .map((r, i) => {
      const t = normalizeTitle(r.title);
      let score = 0;
      if (t === q) score += 10;                       // exact — decisive
      else if (t.startsWith(q + ' ')) score += 3;     // "Red Dawn" for "Red"
      else if (t.startsWith(q)) score += 2;
      score += titleSimilarity(q, t) * 2;
      // Popularity breaks ties between equally good matches without being
      // able to outweigh an exact one.
      score += Math.min(2, (r.popularity || 0) / 100);
      score += Math.max(0, 1 - i * 0.05);             // TMDb's own ordering
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.r);
}

async function tmdbSearch(query) {
  if (!tmdbEnabled() || !query.trim()) return [];
  const res = await fetchWithTimeout(
    tmdbUrl('/search/multi', { query: query.trim(), include_adult: 'false' }));
  if (res.status === 401) throw new Error('That TMDb key was rejected.');
  if (!res.ok) throw new Error(`TMDb error (HTTP ${res.status})`);
  const data = await res.json();
  const genres = await tmdbGenreMap();

  const mapped = (data.results || [])
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .map(r => ({
      tmdbId: r.id,
      type:  r.media_type === 'tv' ? 'tv' : 'movie',
      title: r.title || r.name || '',
      year:  String(r.release_date || r.first_air_date || '').slice(0, 4),
      posterUrl: r.poster_path ? TMDB_IMG_BASE + r.poster_path : '',
      genre: (r.genre_ids || []).map(id => genres[id]).filter(Boolean),
      popularity: r.popularity || 0,
    }))
    .filter(r => r.title);

  // Rank the whole page before trimming — the old code sliced first, so a
  // low-ranked exact match was discarded before it could be promoted.
  return rankTmdbResults(query, mapped).slice(0, 8);
}

// Verifies a key before it is saved, so a typo is caught immediately.
async function tmdbTestKey(key) {
  const q = new URLSearchParams({ api_key: key, query: 'inception' });
  const res = await fetchWithTimeout(`${TMDB_API_BASE}/search/movie?${q}`);
  if (res.status === 401) throw new Error('Key rejected by TMDb.');
  if (!res.ok) throw new Error(`TMDb returned HTTP ${res.status}.`);
  return true;
}


