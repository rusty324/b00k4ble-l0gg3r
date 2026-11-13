// book-copies.js — the book form's Copies editor: one fieldset per edition
// you hold (format, edition, ISBN, ASIN, and for an audiobook its narrator),
// in place of the single ISBN / ASIN / Narrator boxes. The record model is in
// core.js (normalizeBookCopies); this is only the form.
//
// The Physical / E-book / Audiobook buttons stay as the quick way in: ticking
// one adds a copy in that format, unticking removes that format's copies.
// Search, scan and Identify fill a copy through fillBookCopy().

let _bookCopies = [];

const BOOK_FORMAT_NAME = { physical: 'Physical', ebook: 'E-book', audio: 'Audiobook' };

function setBookCopies(copies) {
  _bookCopies = (copies || []).map(c => ({ ...c }));
  syncBookFormatButtons();
  renderBookCopies();
}
// The old entry point: a fresh form with these formats, one copy each.
function setFormats(vals) { setBookCopies((vals || []).map(format => ({ id: newCopyId(), format }))); }
// Adds a copy in this format unless there is one.
function tickFormat(format) {
  if (!_bookCopies.some(c => c.format === format)) { _bookCopies.push({ id: newCopyId(), format }); syncBookFormatButtons(); renderBookCopies(); }
}
function syncNarratorField() {}   // the narrator now lives on the audiobook copy

const bookCopiesForSave = () => _bookCopies.filter(c => c.format).map(c => ({ ...c }));

function syncBookFormatButtons() {
  document.querySelectorAll('#f-format-group input[type="checkbox"]').forEach(cb => {
    cb.checked = _bookCopies.some(c => c.format === cb.value);
    cb.closest('.radio-btn').classList.toggle('active', cb.checked);
  });
  if (_bookCopies.length) document.getElementById('fmt-error').style.display = 'none';
}

// A format button: on adds a copy, off removes that format's copies.
function toggleBookFormat(format, on) {
  if (on) tickFormat(format);
  else { _bookCopies = _bookCopies.filter(c => c.format !== format); syncBookFormatButtons(); renderBookCopies(); }
}

function renderBookCopies() {
  const box = document.getElementById('f-copies');
  if (!box) return;
  box.innerHTML = _bookCopies.map((c, i) => {
    const n = i + 1, audio = c.format === 'audio';
    return `<fieldset class="copy-row" data-copy="${i}">
      <legend><span class="copy-n">Copy ${n}</span> <span class="copy-fmt">${ico('books', c.format)} ${esc(BOOK_FORMAT_NAME[c.format] || c.format)}${c.edition ? ` — ${esc(c.edition)}` : ''}</span></legend>
      <button type="button" class="copy-remove" aria-label="Remove copy ${n}" onclick="removeBookCopy(${i})">&times;</button>
      <div class="copy-fields">
        <label class="copy-field"><span>Format</span>
          <select class="plain" data-field="format" onchange="setBookCopyField(${i}, this)">
            ${BOOK_COPY_FORMATS.map(f => `<option value="${f}"${c.format === f ? ' selected' : ''}>${esc(BOOK_FORMAT_NAME[f])}</option>`).join('')}
          </select></label>
        <label class="copy-field"><span>Edition <span class="opt">(optional)</span></span>
          <input type="text" class="plain" data-field="edition" maxlength="120" autocomplete="off" placeholder="e.g. Hardback, Signed, Folio"
                 value="${esc(c.edition || '')}" oninput="setBookCopyField(${i}, this)"></label>
        <label class="copy-field"><span>ISBN <span class="opt">(optional)</span></span>
          <input type="text" class="plain" data-field="isbn" inputmode="numeric" autocomplete="off" placeholder="9780441013593"
                 value="${esc(c.isbn || '')}" oninput="setBookCopyField(${i}, this)"></label>
        <label class="copy-field"><span>ASIN <span class="opt">(optional)</span></span>
          <input type="text" class="plain" data-field="asin" autocomplete="off" spellcheck="false" placeholder="B0036I54I6"
                 value="${esc(c.asin || '')}" oninput="setBookCopyField(${i}, this)"></label>
        ${audio ? `<label class="copy-field"><span>Narrator <span class="opt">(optional)</span></span>
          <input type="text" class="plain" data-field="narrator" autocomplete="off" list="dl-narrators" placeholder="e.g. Scott Brick"
                 value="${esc(c.narrator || '')}" oninput="setBookCopyField(${i}, this)"></label>` : ''}
      </div>
    </fieldset>`;
  }).join('');
}

function setBookCopyField(i, el) {
  const c = _bookCopies[i];
  if (!c) return;
  c[el.dataset.field] = el.value;
  if (el.dataset.field === 'format') {
    if (c.format !== 'audio') delete c.narrator;
    syncBookFormatButtons();
    renderBookCopies();
    document.querySelector(`#f-copies [data-copy="${i}"] [data-field="format"]`)?.focus();
  }
  if (el.dataset.field === 'isbn' || el.dataset.field === 'asin') paintDupSoon('books');
}

function addBookCopy() {
  const last = _bookCopies[_bookCopies.length - 1];
  _bookCopies.push({ id: newCopyId(), format: last ? last.format : 'physical' });
  syncBookFormatButtons();
  renderBookCopies();
  document.querySelector(`#f-copies [data-copy="${_bookCopies.length - 1}"] select`)?.focus();
}

function removeBookCopy(i) {
  _bookCopies.splice(i, 1);
  syncBookFormatButtons();
  renderBookCopies();
}

// From a search pick, a scan or Identify: the identifiers go on the copy they
// describe — an Audible result on the audiobook, a scanned ISBN on the print
// copy — adding that copy if the form has none in the format. Only fills
// blanks, so a copy already typed in is not overwritten.
function fillBookCopy({ format, isbn, asin, narrator }) {
  const want = format || (narrator ? 'audio' : isbn ? 'physical' : null);
  let c = want ? _bookCopies.find(x => x.format === want) : null;
  if (!c && !want) c = _bookCopies.find(x => x.format === 'audio' || x.format === 'ebook') || _bookCopies[0];
  if (!c && want && _bookCopies.length === 1 && !format && !_bookCopies[0].isbn && !_bookCopies[0].asin) c = _bookCopies[0];
  if (!c) { c = { id: newCopyId(), format: want || 'physical' }; _bookCopies.push(c); }
  if (isbn && !c.isbn) c.isbn = isbn;
  if (asin && !c.asin) c.asin = asin;
  if (narrator && c.format === 'audio' && !c.narrator) c.narrator = narrator;
  syncBookFormatButtons();
  renderBookCopies();
}
