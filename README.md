# Library Logger

A personal log of books, films and TV, games and a wishlist, as a static page
on GitHub Pages: no backend, no build step. It works on its own in one browser,
and can sync between devices through a private GitHub repository.

## What it does

- **Books, Movies & TV, Games, Wishlist, Stats** tabs, with grid, list and
  series views, filters, bulk edit, duplicate finding and merging.
- **Adding:** by hand, by search (Open Library for books, TMDb for film and
  TV), or by pointing the camera at a cover or barcode.
- **Covers:** found automatically, linked, or uploaded.
- **Import / export** as JSON. `scan_library.py` builds an import file from a
  Calibre library and/or an Audiobookshelf metadata folder.

## Where the data lives

In this browser's storage. Nothing personal is in this repository.

To sync, open **⋯ → Sync & backup** and enter a **private** data repository
and a fine-grained GitHub token (Contents: read and write on that repo only).
The library is then stored there as four JSON files, encrypted if you set a
password, and uploaded covers go beside them. Each device connects the same
way. On an iPhone, Safari and a Home Screen icon have separate storage, so
connect each one you use.

The sync layer is `ghsync/` (see `ghsync/README.md`); this app's wiring for
it is `sync.js`.

## Optional keys

Both are entered under **⋯**, stored only in this browser, and sent only to
the service they belong to:

- **TMDb API key** — film and TV search.
- **Image recognition key** (Google Gemini) — identifying a cover from a photo.

## Offline

`sw.js` keeps a copy of the app as it is fetched and serves it when there is
no connection. It is network-first, so a new deploy shows up on the next
online visit. Edits made offline queue and upload when you reconnect.

## Tests

```
cd tests && npm ci      # once
node tests/run.js       # from the repo root
```

See `CLAUDE.md` for the conventions (WebKit runs in CI).
