// row-editor.js — the list-of-rows control the game form uses for platforms
// and for DLC, for any field that needs the same shape: each row is a label,
// a few toggle chips, and a × to remove it.
//
// The editor owns the markup and the clicks; the caller owns the data. It
// passes functions that read its own working copy (rows, label, chips) and
// change it (onChip, onRemove); the editor repaints after either.
//
// Clicks are taken by one listener on the list, reading data- attributes,
// rather than an onclick="…" string per button. A row's label can therefore
// be any text at all — a DLC called “Kasumi's Stolen Memory” — without being
// escaped into JavaScript.
//
// Markup classes are the ones the platform rows have always used
// (.platform-entry, .fmt-chip, .platform-entry-remove), so the existing CSS,
// including the phone layout, applies unchanged.

/**
 * @param {object}   o
 * @param {string}   o.box         id of the element the rows are rendered into
 * @param {Function} o.rows        () => the caller's current array of rows
 * @param {Function} o.label       row => the row's label text
 * @param {string}   [o.labelClass] extra class for the label (e.g. free text vs a short tag)
 * @param {Function} o.chips       row => [{ key, text, on }]
 * @param {Function} o.onChip      (row, key, index) => void — a chip was tapped
 * @param {Function} o.onRemove    (row, index) => void — the row's × was tapped
 * @returns {{ render: Function }}
 */
function createRowEditor(o) {
  const box = () => document.getElementById(o.box);

  function render() {
    const el = box();
    if (!el) return;
    el.innerHTML = o.rows().map((row, i) => {
      const label = o.label(row);
      const chips = o.chips(row).map(c =>
        `<button type="button" class="fmt-chip${c.on ? ' active' : ''}" aria-pressed="${!!c.on}"
                 data-row="${i}" data-chip="${esc(c.key)}">${esc(c.text)}</button>`).join('');
      return `<div class="platform-entry">
        <span class="platform-entry-name${o.labelClass ? ' ' + o.labelClass : ''}">${esc(label)}</span>
        <div class="platform-entry-formats">${chips}</div>
        <button type="button" class="platform-entry-remove" aria-label="Remove ${esc(label)}"
                data-row="${i}" data-remove="1">&times;</button>
      </div>`;
    }).join('');
  }

  const el = box();
  if (el) el.addEventListener('click', e => {
    const btn = e.target.closest('button[data-row]');
    if (!btn || !el.contains(btn)) return;
    const i = Number(btn.dataset.row);
    const row = o.rows()[i];
    if (!row) return;
    if (btn.dataset.remove) o.onRemove(row, i);
    else o.onChip(row, btn.dataset.chip, i);
    render();
  });

  return { render };
}
