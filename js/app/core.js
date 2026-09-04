// core.js — shared, stateless utilities: config, ownership-link
// handling, sort keys, record normalization, and esc(). No app state,
// no rendering. Split out of app.js for readability; loaded first.

// ─── CONFIGURATION ────────────────────────────────────────────────────
const PAGE_SIZE = 48;


// ─── OWNERSHIP LINKS ──────────────────────────────────────────────────
// A link recorded by the user for where they own an item, in either of two
// forms. An https link (the service's own Share button) is claimed by the
// installed app via universal / app links and otherwise opens the website —
// the page cannot influence or detect which, so it is labelled "Open on X".
// An app-scheme link (`youtube://…`) goes straight to the app and does
// nothing at all without it, so it is labelled and previewed as an app link.

// esc() escapes HTML but says nothing about URL schemes, so `javascript:…`
// would survive into an href untouched. Links can also arrive via
// importData() from a shared file, so this is not purely self-inflicted.
//
// What actually matters is *which* schemes are dangerous, not whether a
// scheme is http. `javascript:` and friends run script in this page's own
// origin; an app scheme like `youtube://` is handed straight to the OS and
// can do no more than the app it opens. So deny the executable ones by name
// and let the rest through, otherwise the field refuses the very links the
// user is trying to record.
const BLOCKED_SCHEMES = new Set([
  'javascript:', 'vbscript:', 'data:', 'blob:', 'filesystem:',
  'file:', 'about:', 'view-source:', 'ws:', 'wss:',
]);

function safeUrl(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\u0000-\u0020]/g, '');   // "\u0001javascript:" is tolerated by browsers
  let u;
  try { u = new URL(cleaned); } catch { return null; }     // also rejects relative URLs
  // A scheme must look like one: URL() lowercases it, and this shuts out
  // any non-ASCII lookalike that slipped through parsing.
  if (!/^[a-z][a-z0-9+.-]*:$/.test(u.protocol)) return null;
  if (BLOCKED_SCHEMES.has(u.protocol)) return null;
  // A bare `youtube:` with nothing after it parses fine and points nowhere.
  if (!u.host && !u.pathname && !u.search && !u.hash) return null;
  return u.href;
}

function isWebLink(url) {
  return /^https?:/.test(url);
}

// Longest hostname suffix wins, so app.primevideo.com beats amazon.com.
// Never substring-match the whole URL: evil.com/?x=netflix.com must not pass.
const LINK_SERVICES = [
  ['netflix.com',       'Netflix'],      ['primevideo.com',    'Prime Video'],
  ['watch.amazon.com',  'Prime Video'],  ['disneyplus.com',    'Disney+'],
  ['max.com',           'Max'],          ['hbomax.com',        'Max'],
  ['tv.apple.com',      'Apple TV'],     ['hulu.com',          'Hulu'],
  ['paramountplus.com', 'Paramount+'],   ['peacocktv.com',     'Peacock'],
  ['bbc.co.uk',         'BBC iPlayer'],  ['itv.com',           'ITVX'],
  ['youtube.com',       'YouTube'],      ['channel4.com',      'Channel 4'],
  ['read.amazon.com',   'Kindle'],       ['audible.com',       'Audible'],
  ['audible.co.uk',     'Audible'],      ['amazon.com',        'Amazon'],
  ['amazon.co.uk',      'Amazon'],       ['kobo.com',          'Kobo'],
  ['play.google.com',   'Play Books'],   ['books.apple.com',   'Apple Books'],
  ['share.libbyapp.com','Libby'],        ['libbyapp.com',      'Libby'],
  ['overdrive.com',     'Libby'],        ['hoopladigital.com', 'hoopla'],
  ['goodreads.com',     'Goodreads'],    ['thestorygraph.com', 'StoryGraph'],
  ['spotify.com',       'Spotify'],      ['storytel.com',      'Storytel'],
  ['steampowered.com',  'Steam'],        ['playstation.com',   'PlayStation'],
  ['xbox.com',          'Xbox'],         ['steamcommunity.com', 'Steam'],
  // Valve's own URL shortener — what the Steam mobile app's share sheet
  // actually copies, so without this a shared game reads as "s.team".
  ['s.team',            'Steam'],
  // Xbox store pages live under both hosts; the Store app shares this one.
  ['microsoft.com',     'Xbox'],
];

// Most app schemes are just the service's name (`youtube:`, `spotify:`), so
// they resolve through the domain table for free. These are the ones that
// aren't, and would otherwise be labelled with the raw scheme.
const SCHEME_ALIASES = {
  'nflx': 'netflix.com',   'aiv': 'primevideo.com',
  'vnd.youtube': 'youtube.com', 'hbomax': 'max.com',
  'ibooks': 'books.apple.com',  'itms-books': 'books.apple.com',
  'com.audible.application': 'audible.com',
  'overdrive': 'overdrive.com', 'videos': 'tv.apple.com',
  // Valve's own store buttons have used steam://run/<appid> and
  // steam://store/<appid> to launch straight into the client since Steam's
  // earliest days — a real, long-documented protocol, unlike the
  // undocumented youtube: scheme.
  'steam': 'steampowered.com',
  // The PlayStation App's own scheme, which its share sheet can emit.
  'com.scee.psxandroid': 'playstation.com',
  'playstation': 'playstation.com', 'psns': 'playstation.com',
  'ms-windows-store': 'xbox.com', 'msxbox': 'xbox.com',
};

function serviceForDomain(domain) {
  const hit = LINK_SERVICES.find(([d]) => d === domain);
  return hit ? hit[1] : null;
}

function linkServiceName(url) {
  let u;
  try { u = new URL(url); } catch { return 'link'; }

  // An app scheme has no hostname to match on — `youtube://watch?v=x` parses
  // with an empty host — so name it from the scheme instead.
  if (!isWebLink(url)) {
    const scheme = u.protocol.slice(0, -1);
    return serviceForDomain(SCHEME_ALIASES[scheme] || `${scheme}.com`)
      || scheme.replace(/^./, c => c.toUpperCase());
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let best = null;
  for (const [domain, name] of LINK_SERVICES) {
    if (host === domain || host.endsWith('.' + domain)) {
      if (!best || domain.length > best[0].length) best = [domain, name];
    }
  }
  return best ? best[1] : host;   // unknown domains still get a usable label
}

function normalizeLinks(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  const out = [];
  const seen = new Set();
  list.forEach(entry => {
    const url = safeUrl(typeof entry === 'string' ? entry : (entry && entry.url));
    if (url && !seen.has(url)) { seen.add(url); out.push(url); }
  });
  return out;
}

// Applied to the finished object rather than spread into it: the normalizers
// start from `...raw`, so an empty result has to *remove* the key the spread
// already copied, not merely decline to add one. An item with no links then
// exports exactly as it did before this feature existed.
function applyLinks(obj, raw) {
  const links = normalizeLinks(raw);
  if (links.length) obj.links = links;
  else delete obj.links;
  return obj;
}

// Same idea for the optional text fields. The modals read every input on save
// whether or not it was touched, so without this a book edited once picks up
// isbn:"", asin:"", coverUrl:"" and notes:"" for good — carried in every
// export and every push after that. An empty field is absence, not a value.
const OPTIONAL_TEXT = ['isbn', 'asin', 'coverUrl', 'posterUrl', 'notes', 'year', 'narrator'];

function dropEmpty(obj) {
  for (const k of OPTIONAL_TEXT) {
    if (obj[k] === '' || obj[k] == null) delete obj[k];
  }
  return obj;
}


// A real anchor, not a button: a phone only hands a URL to an app when the
// navigation comes from a genuine tap on an <a>, which a JS-driven
// button click does not preserve.
//
// Web links open in a new tab so the library stays put. App-scheme links
// must not: the browser cannot render `youtube://`, so a new tab would be
// left blank and orphaned whether or not the handoff worked.
function renderLinkButtons(links, compact) {
  const list = normalizeLinks(links);
  if (!list.length) return '';
  const shown = compact ? list.slice(0, 1) : list;
  return shown.map(url => {
    const name = linkServiceName(url);
    const web  = isWebLink(url);
    const tab  = web ? ' target="_blank" rel="noopener noreferrer"' : '';
    const title = web ? `Open on ${name}` : `Open in the ${name} app`;
    return `<a class="btn btn-sm link-btn${web ? '' : ' link-btn-app'}" href="${esc(url)}"${tab}
      title="${esc(title)}" onclick="event.stopPropagation()">↗ ${compact ? '' : esc(name)}</a>`;
  }).join('');
}


// Shows what each pasted line was understood as, so a typo or a blocked
// scheme is visible before saving rather than silently dropped. App-scheme
// links are marked as such: they open nothing without the app installed,
// which is a real trade-off the user should see while typing.
function previewLinks(prefix) {
  const ta  = document.getElementById(`${prefix}-links`);
  const box = document.getElementById(`${prefix}-links-preview`);
  if (!ta || !box) return;
  const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
  box.innerHTML = lines.map(line => {
    const url = safeUrl(line);
    if (!url) return `<span class="link-chip link-chip-bad">not a usable link</span>`;
    const name = esc(linkServiceName(url));
    return isWebLink(url)
      ? `<span class="link-chip">${name}</span>`
      : `<span class="link-chip link-chip-app" title="Opens only if the app is installed">${name} app</span>`;
  }).join('');
}

// Share sheets rarely copy a bare URL — YouTube's gives you
// `Watch "X" on YouTube: https://youtu.be/…` — so take the first token that
// survives safeUrl() rather than assuming the clipboard holds only a link.
//
// Scanning prose needs a stricter test than storing does. Now that any
// scheme is allowed, the `YouTube:` in that very sentence is a well-formed
// app URL and would win the race, so demand either `://` or the
// colon-separated form apps actually use (`spotify:album:…`). A plain
// English word followed by a colon has neither.
function looksLikeLink(token) {
  return token.includes('://') || (token.match(/:/g) || []).length >= 2;
}

function firstUrlIn(text) {
  for (const token of String(text || '').split(/[\s<>"'`]+/)) {
    if (!looksLikeLink(token)) continue;
    // A URL at the end of a sentence keeps the sentence's punctuation.
    // Far more common than a URL that genuinely ends in one of these.
    const url = safeUrl(token.replace(/[.,;:!?)\]]+$/, '')) || safeUrl(token);
    if (url) return url;
  }
  return null;
}

const _pasteTimers = {};

function pasteMsg(prefix, text, bad) {
  const el = document.getElementById(`${prefix}-links-msg`);
  if (!el) return;
  el.textContent = text;
  el.className = 'paste-msg' + (bad ? ' paste-msg-bad' : '');
  clearTimeout(_pasteTimers[prefix]);
  if (text) _pasteTimers[prefix] = setTimeout(() => { el.textContent = ''; }, 4000);
}

// Saves the switch back and forth: copy in the service's app, come back,
// tap once. Appends to the raw field value rather than the normalized list,
// so a half-typed line the user is still working on is not thrown away.
async function pasteLink(prefix) {
  const ta = document.getElementById(`${prefix}-links`);
  if (!ta) return;
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    return pasteMsg(prefix, 'This browser will not share the clipboard — paste into the box above.', true);
  }

  let text = '';
  try { text = await navigator.clipboard.readText(); }
  catch { return pasteMsg(prefix, 'Clipboard access was declined — paste into the box above.', true); }

  const url = firstUrlIn(text);
  if (!url) return pasteMsg(prefix, 'No link on the clipboard. Copy one from the service first.', true);

  const raw = ta.value.replace(/\s+$/, '');
  if (normalizeLinks(raw.split('\n')).includes(url)) {
    return pasteMsg(prefix, `That ${linkServiceName(url)} link is already here.`, false);
  }

  ta.value = raw ? `${raw}\n${url}` : url;
  previewLinks(prefix);
  pasteMsg(prefix, `Added ${linkServiceName(url)}.`, false);
  // A store link is the games form's one source of metadata, so act on it
  // immediately rather than waiting for the debounced input path.
  if (prefix === 'g') gameAutofillFromLinks();
}

function readLinksField(prefix) {
  const ta = document.getElementById(`${prefix}-links`);
  return ta ? normalizeLinks(ta.value.split('\n')) : [];
}

function setLinksField(prefix, links) {
  const ta = document.getElementById(`${prefix}-links`);
  if (ta) ta.value = normalizeLinks(links).join('\n');
  // readText() is missing entirely in some browsers, so offer the button
  // only where it can work; a click still reports a refusal on its own.
  const btn = document.getElementById(`${prefix}-links-paste`);
  if (btn) btn.style.display = (navigator.clipboard && navigator.clipboard.readText) ? '' : 'none';
  pasteMsg(prefix, '');
  previewLinks(prefix);
}


// ─── SORT KEYS ────────────────────────────────────────────────────────

// Libraries file "The Hobbit" under H. Only English articles are stripped:
// to an English reader "La La Land" and "Der Untergang" are titles in their
// own right, and reshelving those under L and U would surprise more than it
// helps. \b is not enough — "An" must not match "Animal Farm" — so the
// article has to be followed by whitespace.
const LEADING_ARTICLE = /^(?:the|a|an)\s+/i;

function titleSortKey(title) {
  const t = String(title || '').trim();
  // A title that is nothing but an article still has to sort somewhere.
  return (t.replace(LEADING_ARTICLE, '') || t).toLowerCase();
}

// Conventionally part of the surname rather than a middle name, and the
// reason "Ursula K. Le Guin" files under L rather than G. Deliberately
// excludes Mac/Mc/O/St: those are far more often the start of a surname
// ("Mac Barnett") than a separate particle.
const NAME_PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'di', 'da', 'dos', 'du', 'des',
  'la', 'le', 'les', 'den', 'der', 'ten', 'ter', 'bin', 'ibn', 'al',
  'af', 'av', 'zu', 'ze', 'op',
]);

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq']);

// "Frank Herbert" files under H. The author field doubles as a comma-joined
// list of several authors, so only the first one decides the order — which
// also means a name already typed inverted ("Herbert, Frank") files
// correctly, since the text before the comma is the surname either way.
function authorSortKey(author) {
  const first = String(author || '').split(',')[0].trim();
  if (!first) return '';

  const parts = first.split(/\s+/);
  while (parts.length > 1 &&
         NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase().replace(/[.]/g, ''))) {
    parts.pop();
  }
  if (parts.length < 2) return first.toLowerCase();

  // Walk back over any particles so they travel with the surname.
  let i = parts.length - 1;
  while (i > 0 && NAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--;

  return `${parts.slice(i).join(' ')}, ${parts.slice(0, i).join(' ')}`.toLowerCase();
}


// ─── DATA NORMALIZATION ───────────────────────────────────────────────

// Unique numeric id — Date.now() alone can collide when two items are
// created in the same millisecond (rapid saves, batch normalization).
let _lastIssuedId = 0;
function newId() {
  const id = Math.max(Date.now(), _lastIssuedId + 1);
  _lastIssuedId = id;
  return id;
}

function hasValidId(raw) {
  return (typeof raw === 'number' && Number.isFinite(raw))
      || (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(+raw));
}

// Ids are interpolated into inline onclick handlers and compared with ===,
// so they must be finite numbers. Numeric strings are coerced; anything
// else gets a fresh id.
function normalizeId(raw) {
  return hasValidId(raw) ? +raw : newId();
}

function normalizeBook(b) {
  const author = Array.isArray(b.author)
    ? b.author.join(', ')
    : (b.author || '').replace(/[;,\s]+$/, '');

  const status = ({ 'want to read': 'want', 'reading': 'reading', 'read': 'read' }[b.status]
    || b.status
    || 'want');

  const formats = Array.isArray(b.formats) ? b.formats
    : b.formats              ? [b.formats]
    : Array.isArray(b.format) ? b.format
    : b.format               ? [b.format]
    : ['physical'];

  // Renamed from `tags`, which is still read so that older exports, older
  // repo files and a device running an older copy of this page all keep
  // working. Only the new name is ever written.
  const raw = b.genre != null ? b.genre : b.tags;
  const genre = Array.isArray(raw) ? raw.map(String)
    : (raw && typeof raw === 'string')
      ? raw.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  const title  = b.title  != null ? String(b.title)  : '';
  const series = b.series ? String(b.series) : '';
  const _searchStr = [title, author, series, b.isbn || '', b.asin || '', ...genre].join(' ').toLowerCase();

  // Clamp rating to 0–5; out-of-range values (e.g. from imported JSON) cause
  // '★'.repeat(5 - rating) to throw a RangeError with a negative count.
  const rating = Number.isFinite(+b.rating) ? Math.max(0, Math.min(5, Math.round(+b.rating))) : 0;

  const book = dropEmpty(applyLinks({
    ...b, id: normalizeId(b.id), title, series, author, status, formats, genre, rating, _searchStr,
    ...(b.isbn != null ? { isbn: String(b.isbn) } : {}),
    ...(b.asin != null ? { asin: String(b.asin).toUpperCase() } : {}),
  }, b.links));
  delete book.tags;   // the spread carried the old name in; only `genre` is stored
  return book;
}

// Normalize wishlist items — adds 'type' (default 'book') and unifies author/creator field
function normalizeWishlistItem(item) {
  return dropEmpty(applyLinks({
    ...item,
    id: normalizeId(item.id),
    type: item.type || 'book',
    title: item.title != null ? String(item.title) : '',
    creator: String(item.creator || item.author || ''),
    notes: item.notes != null ? String(item.notes) : '',
    ...(item.isbn != null ? { isbn: String(item.isbn) } : {}),
  }, item.links));
}

// Normalize video game items — same coercion as normalizeMediaItem, with
// platform standing in for type. No whitelist on platform, matching how
// media's own type is handled: an unrecognised value passes through rather
// than being rejected, since a future console is a config change away.
function normalizeVideoGame(g) {
  const genre = Array.isArray(g.genre) ? g.genre.map(String)
    : (g.genre && typeof g.genre === 'string')
      ? g.genre.split(',').map(x => x.trim()).filter(Boolean)
    : [];

  const formats = Array.isArray(g.formats) ? g.formats.map(String)
    : g.formats ? [String(g.formats)]
    : [];

  return dropEmpty(applyLinks({
    ...g,
    id: normalizeId(g.id),
    title: g.title != null ? String(g.title) : '',
    platform: g.platform ? String(g.platform) : '',
    status: g.status || 'want',
    genre,
    formats,
    rating: Number.isFinite(+g.rating) ? Math.max(0, Math.min(5, Math.round(+g.rating))) : 0,
    ...(g.coverUrl != null ? { coverUrl: String(g.coverUrl) } : {}),
  }, g.links));
}

// Normalize media items — coerces every field the render/sort/search paths
// call string or array methods on, so malformed imports can't freeze the tab
function normalizeMediaItem(m) {
  const genre = Array.isArray(m.genre) ? m.genre.map(String)
    : (m.genre && typeof m.genre === 'string')
      ? m.genre.split(',').map(g => g.trim()).filter(Boolean)
    : [];

  const formats = Array.isArray(m.formats) ? m.formats.map(String)
    : m.formats ? [String(m.formats)]
    : [];

  return dropEmpty(applyLinks({
    ...m,
    id: normalizeId(m.id),
    title: m.title != null ? String(m.title) : '',
    type: m.type || 'movie',
    status: m.status === 'watching' ? 'watched' : (m.status || 'want'),
    genre,
    formats,
    rating: Number.isFinite(+m.rating) ? Math.max(0, Math.min(5, Math.round(+m.rating))) : 0,
    ...(m.posterUrl != null ? { posterUrl: String(m.posterUrl) } : {}),
    ...(m.tmdbId != null ? { tmdbId: m.tmdbId } : {}),
  }, m.links));
}


// ─── HTML ESCAPE ─────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


