// collection-modal.js — "Add a collection": a box set or bundle in one go.
// Name the set, its format and edition, and list the titles in it (one per
// line, "Title (1984)" for a year). Each title already in the library gets a
// copy in the set; the rest are added as new titles holding that copy.
// Opened from ⋯ and from the Movies & TV form's copies editor; from the form,
// the title being edited is listed first and its copy goes into the form.

let _collFromForm = false;

function parseCollectionLines(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    return m ? { title: m[1].trim(), year: m[2] } : { title: l, year: '' };
  }).filter(x => x.title);
}

// What Add would do with each line: [{ title, year, match }].
function collectionPlan() {
  const type = document.querySelector('input[name="coll-type"]:checked')?.value || 'movie';
  const seen = new Set();
  return parseCollectionLines(document.getElementById('coll-titles').value).map(x => {
    let match = findDuplicate('media', { ...x, type });
    if (match && seen.has(match.id)) match = null;
    if (match) seen.add(match.id);
    return { ...x, type, match };
  });
}

function paintCollectionPreview() {
  document.querySelectorAll('#collectionModal .radio-btn').forEach(l => l.classList.toggle('active', !!l.querySelector('input')?.checked));
  const plan = collectionPlan();
  const box = document.getElementById('coll-preview');
  const name = document.getElementById('coll-set').value.trim();
  box.innerHTML = plan.length ? `<ul class="coll-plan">${plan.map(p => `<li>${esc(p.title)}${p.year ? ` (${esc(p.year)})` : ''} —
      <span class="${p.match ? 'coll-have' : 'coll-new'}">${p.match ? 'adds a copy to the title you have' : 'new title'}</span></li>`).join('')}</ul>` : '';
  const btn = document.getElementById('coll-add');
  btn.disabled = !plan.length || !name;
  btn.textContent = plan.length ? `Add ${plan.length} title${plan.length === 1 ? '' : 's'}` : 'Add';
}

function openCollectionModal(fromForm = false) {
  _collFromForm = !!fromForm;
  document.getElementById('coll-set').value = '';
  document.getElementById('coll-edition').value = '';
  document.getElementById('coll-format').value = 'bluray';
  let type = 'movie', lines = '';
  if (_collFromForm) {
    type = document.querySelector('input[name="m-type"]:checked')?.value || 'movie';
    const t = document.getElementById('m-title').value.trim(), y = document.getElementById('m-year').value.trim();
    if (t) lines = `${t}${y ? ` (${y})` : ''}\n`;
  }
  document.querySelectorAll('input[name="coll-type"]').forEach(r => { r.checked = r.value === type; });
  document.getElementById('coll-titles').value = lines;
  paintCollectionPreview();
  document.getElementById('collectionModal').classList.add('open');
  document.getElementById('coll-set').focus();
}

function closeCollectionModal() {
  document.getElementById('collectionModal')?.classList.remove('open');
}
function handleCollectionBackdrop(e) {
  if (e.target === document.getElementById('collectionModal')) closeCollectionModal();
}

function saveCollection() {
  const set = document.getElementById('coll-set').value.trim();
  const plan = collectionPlan();
  if (!set || !plan.length) return;
  const format = document.getElementById('coll-format').value;
  const edition = document.getElementById('coll-edition').value.trim();
  const copy = () => ({ id: newCopyId(), format, set, ...(edition ? { edition } : {}) });
  const formTitle = _collFromForm ? textKey(document.getElementById('m-title').value) : null;
  let formHit = false;
  for (const p of plan) {
    if (_collFromForm && !formHit && textKey(p.title) === formTitle) {
      formHit = true;
      addMediaCopy({ format, set, edition });
      continue;
    }
    if (p.match) {
      const i = mediaLibrary.findIndex(m => m.id === p.match.id);
      mediaLibrary[i] = normalizeMediaItem({ ...mediaLibrary[i], copies: [...(mediaLibrary[i].copies || []), copy()] });
    } else {
      mediaLibrary.push(normalizeMediaItem({ id: newId(), title: p.title, year: p.year, type: p.type, status: 'want', copies: [copy()] }));
    }
  }
  saveMedia();
  closeCollectionModal();
  renderPage();
  if (_collFromForm) { paintMediaCopyLists(); renderMediaCopies(); }
}

document.addEventListener('input', e => {
  if (e.target.closest && e.target.closest('#collectionModal')) paintCollectionPreview();
});
document.addEventListener('change', e => {
  if (e.target.closest && e.target.closest('#collectionModal')) paintCollectionPreview();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('collectionModal')?.classList.contains('open')) { e.stopImmediatePropagation(); closeCollectionModal(); }
}, true);
