// gemini-api.js — cover identification's logic layer: the Gemini
// vision API client (model discovery/ranking, requests, error
// parsing) and match verification (fuzzy scoring against Open
// Library / TMDb results). No UI code. Split out of scanner.js.

// ─── COVER IDENTIFICATION (Gemini) ────────────────────────────────────
// Discs have no usable barcode route, so the cover itself is the input. A
// vision model reads the artwork — not just the text — which is what makes
// this work on stylised title logotypes that OCR cannot handle.

let _identifyResults = [];   // ranked TMDb matches awaiting the user's pick
let _identifyBusy    = false;
let _identifyTarget  = 'media';   // which form a pick should fill
let _identifyKind    = 'screen';  // 'book' | 'screen' — what we are looking at

function geminiKey() {
  try { return (localStorage.getItem(GEMINI_KEY_STORE) || '').trim(); } catch { return ''; }
}

function geminiEnabled() { return !!geminiKey(); }

function geminiModel() {
  try { return (localStorage.getItem(GEMINI_MODEL_STORE) || '').trim(); } catch { return ''; }
}

function setGeminiModel(id) {
  try {
    if (id) {
      localStorage.setItem(GEMINI_MODEL_STORE, id);
      localStorage.setItem(GEMINI_RESOLVER_STORE, String(GEMINI_RESOLVER_VERSION));
    } else {
      localStorage.removeItem(GEMINI_MODEL_STORE);
      localStorage.removeItem(GEMINI_RESOLVER_STORE);
    }
  } catch { /* storage full or blocked — discovery just repeats */ }
}

function geminiEndpoint(model) {
  return `${GEMINI_API_BASE}/models/${model}:generateContent`;
}

// Ask the key what it can actually use. Discovery and generation share
// GEMINI_API_BASE, so anything listed here is callable by construction.
async function geminiListModels(key) {
  let res;
  try {
    res = await fetchWithTimeout(`${GEMINI_API_BASE}/models`, 12000, {
      headers: { 'x-goog-api-key': key },
    });
  } catch (err) {
    throw new Error(err && err.name === 'AbortError'
      ? 'Google took too long to respond — try again.'
      : 'Could not reach Google. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(geminiErrorMessage(res.status, '', await geminiErrorInfo(res)));

  const data = await res.json().catch(() => ({}));
  const usable = (data.models || [])
    .filter(m => {
      const methods = m.supportedGenerationMethods;
      // Tolerate the field being absent rather than discarding the model.
      return !Array.isArray(methods) || methods.includes('generateContent');
    })
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);

  if (!usable.length) {
    throw new Error('That key works, but no models on it can generate content. ' +
                    'Check the project has Gemini access.');
  }
  return usable;
}

function geminiModelTier(id) {
  const l = String(id).toLowerCase();
  if (!l.includes('gemini')) return 0;
  // Exclude variants that cannot take an image prompt and return text.
  if (/embedding|aqa|imagen|veo|tts|audio|live/.test(l)) return 0;
  if (l.includes('flash')) return 3;
  if (l.includes('pro')) return 2;
  return 1;
}

// Google's docs are explicit that limits are "more restricted for
// experimental and preview models", and such a model often carries zero
// free-tier quota — which 429s on the very first request.
function geminiModelStable(id) {
  const l = String(id).toLowerCase();
  if (/preview|experimental|\bexp\b|-exp-|thinking/.test(l)) return 0;
  if (/-\d{2}-\d{2,4}$|-\d{6,8}$/.test(l)) return 0;   // date-stamped build
  return 1;
}

// Only models that could actually identify a cover. Offering the rest in the
// picker would just let someone select something guaranteed to fail.
function viableGeminiModels(models) {
  const viable = models.filter(id => geminiModelTier(id) > 0);
  return viable.length ? viable : models;
}

// Prefer the cheapest vision-capable tier, and a newer one over an older.
// Stability outranks everything: a stable release always beats a preview,
// even a newer one. Within a band, flash beats pro and newer beats older.
function rankGeminiModels(models) {
  const version = id => {
    const m = id.match(/(\d+)(?:\.(\d+))?/);
    return m ? parseFloat(`${m[1]}.${m[2] || 0}`) : 0;
  };
  return models
    .map(id => ({ id, s: geminiModelStable(id), t: geminiModelTier(id), v: version(id) }))
    .filter(m => m.t > 0)
    .sort((a, b) => (b.s - a.s) || (b.t - a.t) || (b.v - a.v) || a.id.localeCompare(b.id))
    .map(m => m.id);
}

function pickGeminiModel(models) {
  const ranked = rankGeminiModels(models);
  return ranked.length ? ranked[0] : models[0];
}

function geminiResolverCurrent() {
  try { return +localStorage.getItem(GEMINI_RESOLVER_STORE) === GEMINI_RESOLVER_VERSION; }
  catch { return false; }
}

async function resolveGeminiModel(key, force) {
  if (!force && geminiResolverCurrent()) {
    const cached = geminiModel();
    if (cached) return cached;
  }
  const picked = pickGeminiModel(await geminiListModels(key));
  setGeminiModel(picked);
  try { localStorage.setItem(GEMINI_RESOLVER_STORE, String(GEMINI_RESOLVER_VERSION)); }
  catch { /* re-resolves next time, which is harmless */ }
  return picked;
}

// The ranked alternatives, so a model with no quota can be stepped over.
async function geminiModelCandidates(key) {
  try { return rankGeminiModels(await geminiListModels(key)); }
  catch { return []; }
}

// Plain fetch, never the js-genai SDK: Gemini's preflight allows only
// content-type and x-goog-api-key, and the SDK adds headers that fail CORS.
// Google sends a structured reason with every failure. Read it rather than
// asserting one — an invented cause sends people looking for the wrong
// problem, which is exactly what the old hardcoded quota text did.
async function geminiErrorInfo(res) {
  let body = null;
  try { body = await res.clone().json(); } catch { /* no body, or not JSON */ }
  const err = (body && body.error) || {};
  const details = Array.isArray(err.details) ? err.details : [];

  const quota = details.find(d => String(d['@type'] || '').includes('QuotaFailure'));
  const retry = details.find(d => String(d['@type'] || '').includes('RetryInfo'));
  const violation = quota && Array.isArray(quota.violations) ? quota.violations[0] : null;

  return {
    message: err.message || '',
    violation,
    // "0" means the model carries no allowance on this plan at all, which is
    // a different problem from having used up a real quota.
    zeroQuota: !!violation && String(violation.quotaValue) === '0',
    retryDelay: (retry && retry.retryDelay) || '',
  };
}

function geminiErrorMessage(status, model, info) {
  const where = model ? ` (model ${model})` : '';
  const detail = info.message ? ` ${info.message}` : '';

  if (status === 429) {
    if (info.zeroQuota) {
      return `Your key has no quota for ${model || 'that model'}. ` +
             'Pick a different one under ⋯ → Image recognition key.';
    }
    const quotaName = info.violation && (info.violation.quotaId || info.violation.quotaMetric);
    const wait = info.retryDelay ? ` Try again in ${info.retryDelay}.` : '';
    return `Google rate limit reached${where}` +
           (quotaName ? ` — ${quotaName}.` : '.') + wait +
           (info.message && !quotaName ? ` ${info.message}` : '');
  }
  if (status === 400 || status === 401) return `That key was rejected by Google.${detail}`;
  if (status === 403) {
    return 'Google refused the key. Check it is correct and that the ' +
           `Generative Language API is enabled for its project.${detail}`;
  }
  if (status === 404) {
    return `Google does not offer ${model || 'that model'} to this key.${detail}`;
  }
  return `Google returned HTTP ${status}.${detail}`;
}

async function geminiRequest(key, model, body, timeout) {
  let res;
  try {
    res = await fetchWithTimeout(geminiEndpoint(model), timeout, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(err && err.name === 'AbortError'
      ? 'Google took too long to respond — try again.'
      : 'Could not reach Google. Check your connection and try again.');
  }
  return res;
}

async function geminiPost(key, body, timeout) {
  let model = await resolveGeminiModel(key);
  let res = await geminiRequest(key, model, body, timeout);

  if (!res.ok) {
    let info = await geminiErrorInfo(res);

    // Two recoverable cases, both meaning "this model is not usable here":
    // Google withdrew it (404), or the key carries no allowance for it (429
    // with a zero quota). Step to the next ranked model and retry once — a
    // genuine rate limit is NOT retried, since another model would not help.
    const unusable = res.status === 404 || (res.status === 429 && info.zeroQuota);
    if (unusable) {
      const next = (await geminiModelCandidates(key)).find(m => m !== model);
      if (next) {
        const first = model;
        model = next;
        res = await geminiRequest(key, model, body, timeout);
        if (res.ok) {
          setGeminiModel(model);   // remember what actually worked
        } else {
          info = await geminiErrorInfo(res);
          throw new Error(geminiErrorMessage(res.status, model, info) +
            ` (${first} was unusable too.)`);
        }
      } else {
        throw new Error(geminiErrorMessage(res.status, model, info));
      }
    } else {
      throw new Error(geminiErrorMessage(res.status, model, info));
    }
  }

  return res.json();
}

// Validating with ListModels rather than a generation call means an
// unavailable model can never masquerade as a bad key — which is exactly
// what the hardcoded id did.
async function geminiTestKey(key) {
  const all = await geminiListModels(key);
  const models = viableGeminiModels(all);
  return { models, picked: pickGeminiModel(models) };
}

// Downscale to 768px on the long edge: that is exactly one Gemini image tile
// (258 tokens) and keeps the upload small on mobile data.
function captureFrameAsJpeg(video, maxEdge = GEMINI_MAX_EDGE) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const c = document.createElement('canvas');
  c.width  = Math.max(1, Math.round(vw * scale));
  c.height = Math.max(1, Math.round(vh * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.8);
  return { base64: dataUrl.split(',')[1] || '', width: c.width, height: c.height };
}

const IDENTIFY_PROMPT_SCREEN =
  'This photo shows a DVD or Blu-ray case, or a TV title card. Identify the film ' +
  'or TV series it is. Use the artwork as well as any text. Give up to 3 ' +
  'candidates, most likely first, even if you are unsure. Do not name any people.';

const IDENTIFY_PROMPT_BOOK =
  'This photo shows the front cover or the spine of a book. Identify the book. ' +
  'Use the cover artwork and typography as well as any readable text. Give the ' +
  'title and the author for up to 3 candidates, most likely first, even if you ' +
  'are unsure.';

const IDENTIFY_SCHEMA_SCREEN = {
  type: 'OBJECT',
  properties: {
    verbatim_text: { type: 'STRING' },
    candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          year: { type: 'INTEGER' },
          type: { type: 'STRING', enum: ['movie', 'tv'] },
          confidence: { type: 'NUMBER' },
        },
        required: ['title', 'type', 'confidence'],
      },
    },
  },
  required: ['verbatim_text', 'candidates'],
};

const IDENTIFY_SCHEMA_BOOK = {
  type: 'OBJECT',
  properties: {
    verbatim_text: { type: 'STRING' },
    candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          author: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['title', 'confidence'],
      },
    },
  },
  required: ['verbatim_text', 'candidates'],
};

async function identifyCover(base64, kind) {
  const key = geminiKey();
  if (!key) throw new Error('No image recognition key set.');
  const isBook = kind === 'book';

  const data = await geminiPost(key, {
    contents: [{ parts: [
      { inline_data: { mime_type: 'image/jpeg', data: base64 } },
      { text: isBook ? IDENTIFY_PROMPT_BOOK : IDENTIFY_PROMPT_SCREEN },
    ] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: isBook ? IDENTIFY_SCHEMA_BOOK : IDENTIFY_SCHEMA_SCREEN,
      maxOutputTokens: 512,
    },
  }, 20000);

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed) throw new Error('Could not read the response from Google.');

  return {
    kind: isBook ? 'book' : 'screen',
    verbatim: String(parsed.verbatim_text || ''),
    candidates: (parsed.candidates || [])
      .filter(c => c && c.title)
      .map(c => isBook
        ? {
            title: String(c.title),
            author: c.author ? String(c.author) : '',
            confidence: Number.isFinite(+c.confidence) ? +c.confidence : 0.5,
          }
        : {
            title: String(c.title),
            year: c.year ? String(c.year) : '',
            type: c.type === 'tv' ? 'tv' : 'movie',
            confidence: Number.isFinite(+c.confidence) ? +c.confidence : 0.5,
          }),
  };
}

// ─── MATCH VERIFICATION ───────────────────────────────────────────────
// The model's title is never trusted on its own: every candidate is checked
// against TMDb, and agreement between candidates is the strongest signal.

function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function titleSimilarity(a, b) {
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// Open Library search, used to confirm what the model read off a book cover.
// `fields` is essential — the default response is enormous.
async function searchOpenLibrary(title, author) {
  const params = new URLSearchParams({
    title, limit: '5',
    fields: 'key,title,author_name,first_publish_year,cover_i,isbn',
  });
  if (author) params.set('author', author);

  const res = await fetchWithTimeout(`${OPENLIBRARY_SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`Open Library returned HTTP ${res.status}`);
  const data = await res.json();

  return (data.docs || []).map(d => ({
    key: d.key || '',
    title: String(d.title || ''),
    author: (d.author_name || [])[0] || '',
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
    isbn: (d.isbn || [])[0] || '',
  })).filter(d => d.title);
}

async function verifyBookAgainstOpenLibrary(identified) {
  const queries = [];
  const seen = new Set();
  identified.candidates.forEach(c => {
    const k = `${c.title}|${c.author || ''}`.toLowerCase();
    if (c.title.trim().length >= 2 && !seen.has(k)) {
      seen.add(k);
      queries.push({ title: c.title.trim(), author: (c.author || '').trim(), cand: c });
    }
  });
  if (!queries.length) {
    const guess = parseDiscTitle(identified.verbatim).title;
    if (guess) queries.push({ title: guess, author: '', cand: null });
  }

  // Sequential, not parallel: Open Library throttles anonymous callers at
  // roughly one request a second and returns 429 readily.
  const byKey = new Map();
  for (const q of queries.slice(0, IDENTIFY_MAX_BOOK_QUERIES)) {
    let hits = [];
    try { hits = await searchOpenLibrary(q.title, q.author); }
    catch { continue; }
    hits.forEach((hit, rank) => {
      const authorSim = q.author && hit.author ? titleSimilarity(q.author, hit.author) : 0.5;
      const belief = q.cand ? q.cand.confidence : 0.4;
      const score =
        titleSimilarity(q.title, hit.title) * 2 +
        belief * authorSim * 2 +
        Math.max(0, 0.5 - rank * 0.1);
      const id = hit.key || `${hit.title}|${hit.author}`;
      const prev = byKey.get(id);
      if (prev) { prev.agree += 1; prev.score = Math.max(prev.score, score); }
      else byKey.set(id, { ...hit, agree: 1, score });
    });
  }

  return [...byKey.values()]
    .map(r => ({ ...r, score: r.score + 0.25 * (r.agree - 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// TMDb search is phrase/prefix matched, not fuzzy, so several phrasings are
// tried and the results merged rather than relying on any single query.
async function verifyAgainstTmdb(identified) {
  const queries = [];
  const seen = new Set();
  const push = q => {
    const t = String(q || '').trim();
    const k = t.toLowerCase();
    if (t.length >= 2 && !seen.has(k)) { seen.add(k); queries.push(t); }
  };
  identified.candidates.forEach(c => push(c.title));
  push(parseDiscTitle(identified.verbatim).title);

  const used = queries.slice(0, IDENTIFY_MAX_QUERIES);
  const settled = await Promise.allSettled(used.map(q => tmdbSearch(q)));

  // How much the model's belief transfers to a given TMDb hit. Squaring the
  // similarity makes it decay fast, so "The Dark Knight" does not lend its
  // confidence to "The Dark Knight Rises".
  const modelBelief = hit => identified.candidates.reduce((best, c) => {
    const sim = titleSimilarity(c.title, hit.title);
    const typed = c.type === hit.type ? 1 : 0.8;
    return Math.max(best, c.confidence * sim * sim * typed);
  }, 0);

  const byId = new Map();
  settled.forEach((r, qi) => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach((hit, rank) => {
      const score =
        titleSimilarity(used[qi], hit.title) * 2 +   // matches what we asked for
        modelBelief(hit) * 2 +                       // what the model actually believed
        Math.max(0, 0.5 - rank * 0.1);               // TMDb's own ordering
      const prev = byId.get(hit.tmdbId);
      if (prev) {
        prev.agree += 1;
        prev.score = Math.max(prev.score, score);
      } else {
        byId.set(hit.tmdbId, { ...hit, agree: 1, score });
      }
    });
  });

  // Agreement is a bonus, not an override: a broad query returns several
  // hits, so appearing twice is weaker evidence than matching well once.
  return [...byId.values()]
    .map(r => ({ ...r, score: r.score + 0.25 * (r.agree - 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}


