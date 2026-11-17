// look.js — ⋯ → Themes: a panel that slides in from the right, over the page,
// for how the app looks. Everything applies at once and is remembered.
//   Mode     Light or Dark — the base token sets in css/base.css.
//   Colours  a preset palette for that mode: page, surface and accent.
//   Accent   one colour on top of the preset (or the preset's own).
//   Style    the graphical look: corners, shadows, borders, background
//            (Classic, Soft, Sharp, Paper) — [data-style] rules in css/look.css.
//   Font     the typeface for the whole page — [data-font] rules there too.
//
// A palette is generated as CSS custom properties: the accent scale (the
// app's --amber-* tokens, which every highlight, button and title uses) is
// mixed from one accent colour with color-mix(), so a new palette is one line
// in LOOK_PALETTES. The CSS is kept in localStorage ('lookCss') so the small
// script at the top of index.html applies it before anything paints.

const LOOK_PALETTES = {
  light: [
    { key: 'classic',  label: 'Amber' },                                   // css/base.css as it is
    { key: 'sky',      label: 'Sky',      bg: '#F3F6FA', surface: '#FFFFFF', accent: '#2F6FB5' },
    { key: 'sage',     label: 'Sage',     bg: '#F3F6F1', surface: '#FFFFFC', accent: '#4E7A4A' },
    { key: 'rose',     label: 'Rose',     bg: '#FAF4F5', surface: '#FFFFFF', accent: '#B4466A' },
    { key: 'lavender', label: 'Lavender', bg: '#F5F3FA', surface: '#FFFFFF', accent: '#6E54B5' },
    { key: 'sand',     label: 'Sand',     bg: '#F6F0E4', surface: '#FFFCF5', accent: '#9A6B2F' },
    { key: 'slate',    label: 'Slate',    bg: '#F2F3F5', surface: '#FFFFFF', accent: '#4A5563' },
  ],
  dark: [
    { key: 'classic',   label: 'Amber' },
    { key: 'midnight',  label: 'Midnight',  bg: '#0F1420', surface: '#161C2B', accent: '#6EA8FE' },
    { key: 'forest',    label: 'Forest',    bg: '#0F1712', surface: '#16201A', accent: '#6CCB8A' },
    { key: 'ember',     label: 'Ember',     bg: '#1A1210', surface: '#231915', accent: '#FF8A5C' },
    { key: 'plum',      label: 'Plum',      bg: '#17111C', surface: '#201827', accent: '#C08BF2' },
    { key: 'ocean',     label: 'Ocean',     bg: '#0C1719', surface: '#122124', accent: '#4FC7D1' },
    { key: 'rose-noir', label: 'Rose noir', bg: '#1A1114', surface: '#24171C', accent: '#F07AA0' },
    { key: 'graphite',  label: 'Graphite',  bg: '#151617', surface: '#1D1F21', accent: '#A9B4C2' },
  ],
};
// The classic palettes' look, for their preview cards.
const LOOK_CLASSIC = { light: { bg: '#FAF8F4', surface: '#FFFFF8', accent: '#854F0B' }, dark: { bg: '#161513', surface: '#1f1e1b', accent: '#EF9F27' } };
const LOOK_ACCENTS = ['#D9653B', '#D14B7B', '#8358D6', '#2F6FD6', '#1E7FC4', '#169AA3', '#1E9466', '#7E9A1E', '#D9A21E', '#E0662A', '#6B7280'];
const LOOK_STYLES = [
  { key: 'classic', label: 'Classic', note: 'Rounded cards, light shadows' },
  { key: 'soft',    label: 'Soft',    note: 'Extra-round, floating cards' },
  { key: 'sharp',   label: 'Sharp',   note: 'Square corners, flat, outlined' },
  { key: 'paper',   label: 'Paper',   note: 'Textured page, bookish serif' },
];
const LOOK_FONTS = [
  { key: 'classic', label: 'Classic (DM Sans + Playfair)' },
  { key: 'system',  label: 'System' },
  { key: 'serif',   label: 'Serif' },
  { key: 'rounded', label: 'Rounded' },
  { key: 'mono',    label: 'Monospace' },
];
const LOOK_DEFAULT = { mode: 'dark', palette: 'classic', accent: '', style: 'classic', font: 'classic' };

function readLook() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('look') || '{}') || {}; } catch { /* unreadable: defaults */ }
  let theme = null;
  try { theme = localStorage.getItem('theme'); } catch { /* ignore */ }
  const look = { ...LOOK_DEFAULT, ...(theme ? { mode: theme } : {}), ...saved };
  if (!LOOK_PALETTES[look.mode]) look.mode = 'dark';
  if (!LOOK_PALETTES[look.mode].some(p => p.key === look.palette)) look.palette = 'classic';
  if (!LOOK_STYLES.some(s => s.key === look.style)) look.style = 'classic';
  if (!LOOK_FONTS.some(f => f.key === look.font)) look.font = 'classic';
  if (look.accent && !/^#[0-9a-f]{6}$/i.test(look.accent)) look.accent = '';
  return look;
}

// The custom properties for a palette and accent, or '' for Classic as is.
function lookCss(look) {
  const p = LOOK_PALETTES[look.mode].find(x => x.key === look.palette) || {};
  const base = p.bg ? p : LOOK_CLASSIC[look.mode];
  const A = look.accent || (p.bg ? p.accent : '');
  if (!p.bg && !A) return '';
  const mix = (c, pct, other) => `color-mix(in srgb, ${c} ${pct}%, ${other})`;
  const v = {};
  if (p.bg) {
    Object.assign(v, { '--bg': base.bg, '--surface': base.surface });
    if (look.mode === 'light') Object.assign(v, { '--row-tint': mix(base.bg, 70, A || base.accent), '--missing': mix(base.bg, 80, '#888') });
    else Object.assign(v, { '--row-tint': mix(base.surface, 85, A || base.accent), '--missing': mix(base.surface, 80, '#888'),
      '--gray-50': mix(base.surface, 92, '#fff'), '--gray-100': mix(base.surface, 85, '#fff'), '--gray-200': mix(base.surface, 75, '#fff') });
  }
  if (A) {
    if (look.mode === 'light') Object.assign(v, {
      '--amber-900': mix(A, 45, '#000'), '--amber-800': mix(A, 60, '#000'), '--amber-600': mix(A, 80, '#000'),
      '--amber-200': A, '--amber-100': mix(A, 40, '#fff'), '--amber-50': mix(A, 14, '#fff'),
      '--gap-text': mix(A, 80, '#000'), '--ctl-border': mix(A, 55, '#888'),
      '--border': mix(A, 14, 'transparent'), '--border-mid': mix(A, 24, 'transparent') });
    else Object.assign(v, {
      '--amber-900': mix(A, 22, '#fff'), '--amber-800': mix(A, 38, '#fff'), '--amber-600': mix(A, 75, '#fff'),
      '--amber-200': A, '--amber-100': mix(A, 45, '#000'), '--amber-50': mix(A, 22, base.bg),
      '--gap-text': mix(A, 75, '#fff'), '--ctl-border': mix(A, 45, '#777'),
      '--border': mix(A, 14, 'transparent'), '--border-mid': mix(A, 26, 'transparent') });
  }
  return `:root[data-theme="${look.mode}"]{${Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';')}}`;
}

function applyLook(look) {
  const html = document.documentElement;
  html.setAttribute('data-theme', look.mode);
  html.setAttribute('data-style', look.style);
  html.setAttribute('data-font', look.font);
  const css = lookCss(look);
  let tag = document.getElementById('lookStyle');
  if (!tag) { tag = document.createElement('style'); tag.id = 'lookStyle'; document.head.appendChild(tag); }
  tag.textContent = css;
  try {
    localStorage.setItem('look', JSON.stringify(look));
    localStorage.setItem('lookCss', css);
    localStorage.setItem('theme', look.mode);
  } catch { /* private mode: this session only */ }
  const pal = LOOK_PALETTES[look.mode].find(p => p.key === look.palette);
  const label = document.getElementById('settingsThemeLabel');
  if (label) label.textContent = 'Themes';
  if (document.getElementById('lookPanel')?.classList.contains('open')) paintLookPanel();
  return pal;
}

function setLook(change) { applyLook({ ...readLook(), ...change }); }

// The old entry points.
function applyTheme(mode) { setLook({ mode: LOOK_PALETTES[mode] ? mode : 'dark', palette: readLook().mode === mode ? readLook().palette : 'classic' }); }
function toggleTheme() { applyTheme(readLook().mode === 'dark' ? 'light' : 'dark'); }

// ─── the panel ────────────────────────────────────────────────────────
// A small picture of the app in a palette: header bar, a card, a button.
function lookPreview(mode, p, accent) {
  const base = p.bg ? p : LOOK_CLASSIC[mode];
  const A = accent || base.accent;
  const text = mode === 'dark' ? '#e8e6df' : '#2c2c2a';
  return `<span class="look-preview" aria-hidden="true" style="background:${base.bg}">
    <span class="lp-side"><i style="background:${text};opacity:.35"></i><i style="background:${A}"></i><i style="background:${text};opacity:.25"></i></span>
    <span class="lp-main"><span class="lp-card" style="background:${base.surface};border-color:${A}33">
      <i style="background:${text};opacity:.7;width:70%"></i><i style="background:${text};opacity:.35;width:45%"></i>
      <b style="background:${A}"></b></span></span></span>`;
}

function stylePreview(s) {
  return `<span class="look-preview style-preview sp-${s.key}" aria-hidden="true"><span class="sp-card"><i></i><i></i><b></b></span><span class="sp-card"><i></i><i></i><b></b></span></span>`;
}

function paintLookPanel() {
  const look = readLook();
  const card = (attrs, on, inner, label, sub = '') => `<button type="button" class="look-card${on ? ' on' : ''}" role="radio" aria-checked="${on}" ${attrs}>
      ${inner}<span class="look-card-name">${esc(label)}${sub ? `<span class="look-card-sub">${esc(sub)}</span>` : ''}</span></button>`;
  document.getElementById('lookBody').innerHTML = `
    <div class="look-head">
      <h2 id="lookTitle">Themes</h2>
      <button type="button" class="btn btn-sm" onclick="resetLook()">Reset</button>
      <button type="button" class="btn btn-sm" onclick="closeLookPanel()">Close</button>
    </div>
    <div class="look-scroll">
      <section class="look-sec">
        <div class="look-label" id="lookModeLabel">Mode</div>
        <div class="look-seg" role="radiogroup" aria-labelledby="lookModeLabel">
          ${['light', 'dark'].map(m => `<button type="button" role="radio" aria-checked="${look.mode === m}" class="${look.mode === m ? 'on' : ''}"
            data-look-mode="${m}" onclick="setLook({ mode: '${m}', palette: 'classic' })">${m === 'light' ? '☀️ Light' : '🌙 Dark'}</button>`).join('')}
        </div>
      </section>
      <section class="look-sec">
        <div class="look-label" id="lookPalLabel">Colours</div>
        <div class="look-grid" role="radiogroup" aria-labelledby="lookPalLabel">
          ${LOOK_PALETTES[look.mode].map(p => card(`data-look-palette="${p.key}" onclick="setLook({ palette: '${p.key}', accent: '' })"`,
            look.palette === p.key, lookPreview(look.mode, p, look.palette === p.key ? look.accent : ''), p.label, p.key === 'classic' ? 'Original' : '')).join('')}
        </div>
      </section>
      <section class="look-sec">
        <div class="look-label" id="lookAccLabel">Accent colour <span class="opt">(on top of the colours)</span></div>
        <div class="look-swatches" role="radiogroup" aria-labelledby="lookAccLabel">
          <button type="button" class="look-swatch look-swatch-none${look.accent ? '' : ' on'}" role="radio" aria-checked="${!look.accent}"
            aria-label="The colours' own accent" title="The colours' own" onclick="setLook({ accent: '' })"></button>
          ${LOOK_ACCENTS.map(a => `<button type="button" class="look-swatch${look.accent.toLowerCase() === a.toLowerCase() ? ' on' : ''}" role="radio"
            aria-checked="${look.accent.toLowerCase() === a.toLowerCase()}" aria-label="Accent ${a}" style="background:${a}" data-look-accent="${a}"
            onclick="setLook({ accent: '${a}' })"></button>`).join('')}
          <label class="look-swatch look-swatch-custom" title="Pick any colour"><span class="sr-only">Custom accent colour</span>
            <input type="color" value="${look.accent || '#d9653b'}" onchange="setLook({ accent: this.value })"></label>
        </div>
      </section>
      <section class="look-sec">
        <div class="look-label" id="lookStyleLabel">Style</div>
        <div class="look-grid" role="radiogroup" aria-labelledby="lookStyleLabel">
          ${LOOK_STYLES.map(s => card(`data-look-style="${s.key}" onclick="setLook({ style: '${s.key}' })"`, look.style === s.key, stylePreview(s), s.label, s.note)).join('')}
        </div>
      </section>
      <section class="look-sec">
        <label class="look-label" for="lookFont">Font</label>
        <select id="lookFont" class="plain" onchange="setLook({ font: this.value })">
          ${LOOK_FONTS.map(f => `<option value="${f.key}"${look.font === f.key ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}
        </select>
      </section>
    </div>`;
}

let _lookReturn = null;
function openLookPanel() {
  _lookReturn = document.activeElement;
  paintLookPanel();
  const p = document.getElementById('lookPanel');
  p.hidden = false;
  requestAnimationFrame(() => p.classList.add('open'));
  document.querySelector('#lookBody .look-head .btn:last-child')?.focus();
}
function closeLookPanel() {
  const p = document.getElementById('lookPanel');
  if (!p || !p.classList.contains('open')) return;
  p.classList.remove('open');
  setTimeout(() => { if (!p.classList.contains('open')) p.hidden = true; }, 250);
  if (_lookReturn && _lookReturn.isConnected) _lookReturn.focus();
}
function resetLook() { applyLook({ ...LOOK_DEFAULT }); }
// Kept for the old names.
const openThemeSheet = openLookPanel, closeThemeSheet = closeLookPanel;

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('lookPanel')?.classList.contains('open')) closeLookPanel();
});

applyLook(readLook());
