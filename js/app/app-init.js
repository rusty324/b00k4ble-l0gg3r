// app-init.js — import/export, the scroll-to-top button, and the
// startup sequence. Must load LAST: init calls switchTab(), which
// calls into every tab's render() — all of which must already be
// defined. Split out of app.js.

// ─── IMPORT / EXPORT ─────────────────────────────────────────────────
function exportData() {
  let data, filename;
  if (activeTab === 'media') {
    data = mediaLibrary; filename = 'my-media-library.json';
  } else if (activeTab === 'wishlist') {
    data = bookWishlist; filename = 'my-wishlist.json';
  } else if (activeTab === 'games') {
    data = videoGames; filename = 'my-games-library.json';
  } else {
    data = books; filename = 'my-library.json';
  }
  const blob = new Blob([JSON.stringify(data, stripSearchStr, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('Expected a JSON array');

      if (activeTab === 'media') {
        if (!confirm(`Import ${data.length} media items? Duplicates (by ID) will be skipped.`)) return;
        const existingIds = new Set(mediaLibrary.map(m => m.id));
        const newItems = data
          .map(normalizeMediaItem)
          .filter(m => !existingIds.has(m.id));
        mediaLibrary = [...mediaLibrary, ...newItems];
        saveMedia();
        renderPage();
        alert(`Imported ${newItems.length} new titles (${data.length - newItems.length} duplicates skipped).`);
      } else if (activeTab === 'wishlist') {
        if (!confirm(`Import ${data.length} wishlist items? Duplicates (by ID) will be skipped.`)) return;
        const existingIds = new Set(bookWishlist.map(w => w.id));
        const newItems = data
          .map(normalizeWishlistItem)
          .filter(w => !existingIds.has(w.id));
        bookWishlist = [...bookWishlist, ...newItems];
        saveWishlist();
        renderPage();
        alert(`Imported ${newItems.length} new items (${data.length - newItems.length} duplicates skipped).`);
      } else if (activeTab === 'games') {
        if (!confirm(`Import ${data.length} games? Duplicates (by ID) will be skipped.`)) return;
        const existingIds = new Set(videoGames.map(g => g.id));
        const newItems = data
          .map(normalizeVideoGame)
          .filter(g => !existingIds.has(g.id));
        videoGames = [...videoGames, ...newItems];
        saveGames();
        renderPage();
        alert(`Imported ${newItems.length} new games (${data.length - newItems.length} duplicates skipped).`);
      } else {
        if (!confirm(`Import ${data.length} books? Duplicates (by ID) will be skipped.`)) return;
        const existingIds = new Set(books.map(b => b.id));
        const newBooks = data
          .map(normalizeBook)
          .filter(b => !existingIds.has(b.id));
        books = [...books, ...newBooks];
        save();
        renderPage();
        alert(`Imported ${newBooks.length} new books (${data.length - newBooks.length} duplicates skipped).`);
      }

    } catch (err) {
      alert('Failed to import: ' + err.message);
    }
  };

  reader.readAsText(file);
  e.target.value = '';
}


// ─── SCROLL TO TOP BUTTON ─────────────────────────────────────────────
window.addEventListener('scroll', () => {
  const btn = document.getElementById('scrollTopBtn');
  if (btn) btn.classList.toggle('visible', window.scrollY > 300);
}, { passive: true });


// ─── INIT ─────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('theme') || 'dark');
document.getElementById('viewToggleBtn').textContent = viewMode === 'card' ? '⊞' : '☰';
switchTab(activeTab);
