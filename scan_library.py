#!/usr/bin/env python3
"""
scan_library.py — Generate my-library.json from Calibre and/or Audiobookshelf.

Usage examples:
    # Both sources, with ABS metadata dir (most reliable):
    python scan_library.py \
        --calibre /mnt/media/Calibre \
        --abs-metadata /mnt/audiobookshelf/config/metadata \
        --output my-library.json

    # Calibre only:
    python scan_library.py --calibre /mnt/media/Calibre --output my-library.json

    # ABS by scanning audio files (needs: pip install mutagen):
    python scan_library.py \
        --audiobookshelf /mnt/media/audiobooks \
        --output my-library.json

    # Re-scan and preserve your existing edits (status, notes, ratings):
    python scan_library.py \
        --calibre /mnt/media/ebooks/Calibre\ Library \
        --abs-metadata /mnt/docker-data/audiobookshelf/metadata \
        --merge existing-my-library.json \
        --output my-library.json

Dependencies:
    - sqlite3   (stdlib, for Calibre)
    - mutagen   (optional, pip install mutagen — for audio file tag reading)

Notes on Docker paths:
    --calibre        should point to your Calibre library on the HOST (where metadata.db lives)
    --abs-metadata   should point to your ABS config volume on the host,
                     e.g. if docker-compose has: ./abs/config:/config
                     then use: ./abs/config/metadata
    --audiobookshelf your ABS media folder on the host (fallback if no --abs-metadata)
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

AUDIO_EXTS = {'.mp3', '.m4b', '.m4a', '.flac', '.ogg', '.opus', '.aac', '.wma'}
EBOOK_EXTS = {'.epub', '.mobi', '.azw', '.azw3', '.pdf', '.cbz', '.cbr'}


# ─── Normalization ──────────────────────────────────────────────────────────

def normalize_key(title, author):
    """Case/punct-insensitive key for deduplication matching."""
    def norm(s):
        s = (s or '').lower().strip()
        s = re.sub(r'[^\w\s]', '', s)
        s = re.sub(r'\s+', ' ', s)
        return s
    return (norm(title), norm(author))


def clean_author(author):
    """Strip trailing punctuation/whitespace that Calibre sometimes leaves."""
    if not author:
        return ''
    return re.sub(r'[;,\s]+$', '', str(author)).strip()


# ─── Calibre ────────────────────────────────────────────────────────────────

def read_calibre(calibre_path):
    """
    Read all books from Calibre's metadata.db SQLite database.
    Retrieves title, author(s), series, and rating.
    Status is not stored in Calibre by default — everything comes in as 'want'.
    """
    db_path = Path(calibre_path) / 'metadata.db'
    if not db_path.exists():
        print(f"[calibre] ERROR: No metadata.db at {db_path}", file=sys.stderr)
        print(f"[calibre]   Is this the right Calibre library root?", file=sys.stderr)
        return []

    books = []
    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Pull books with authors (grouped), series, and rating.
        # Ratings are NOT a column on books — they live in a separate
        # ratings table joined via books_ratings_link.
        cur.execute("""
            SELECT
                b.id,
                b.title,
                b.timestamp,
                r.rating                     AS rating,
                GROUP_CONCAT(a.name, ' & ') AS authors,
                s.name                       AS series_name,
                b.series_index             AS series_index
            FROM books b
            LEFT JOIN books_authors_link  bal ON b.id = bal.book
            LEFT JOIN authors             a   ON bal.author = a.id
            LEFT JOIN books_series_link   bsl ON b.id = bsl.book
            LEFT JOIN series              s   ON bsl.series = s.id
            LEFT JOIN books_ratings_link  brl ON b.id = brl.book
            LEFT JOIN ratings             r   ON brl.rating = r.id
            GROUP BY b.id
            ORDER BY b.timestamp DESC
        """)

        for row in cur.fetchall():
            author = clean_author(row['authors'] or '')

            series = ''
            if row['series_name']:
                series = row['series_name']
                if row['series_index'] is not None:
                    idx = row['series_index']
                    idx_str = str(int(idx)) if float(idx) == int(idx) else str(idx)
                    series = f"{series} #{idx_str}"

            # Calibre stores rating 0–10; app uses 0–5
            rating = 0
            if row['rating']:
                rating = min(5, max(0, round(int(row['rating']) / 2)))

            books.append({
                '_source':     'calibre',
                '_calibre_id': row['id'],
                'title':       row['title'] or '',
                'author':      author,
                'series':      series,
                'formats':     ['ebook'],
                'status':      'want',
                'notes':       '',
                'rating':      rating,
            })

        conn.close()
        print(f"[calibre] {len(books)} books", file=sys.stderr)

    except sqlite3.OperationalError as e:
        print(f"[calibre] DB error: {e}", file=sys.stderr)
    except Exception as e:
        print(f"[calibre] Unexpected error: {e}", file=sys.stderr)

    return books


# ─── Audiobookshelf metadata dir ────────────────────────────────────────────

def read_abs_metadata(metadata_path):
    """
    Read Audiobookshelf item metadata from its config/metadata/items/ directory.
    ABS writes a metadata.json per library item there.

    Expected host path: your ABS config volume + /metadata
    e.g. /opt/abs/config/metadata
    """
    base = Path(metadata_path)
    items_dir = base / 'items'
    if not items_dir.exists():
        # Maybe they passed the config root, not config/metadata
        alt = base / 'metadata' / 'items'
        if alt.exists():
            items_dir = alt
        else:
            # Maybe they passed config/metadata directly and items/ doesn't exist yet
            print(f"[abs-meta] No items/ dir found under {base}", file=sys.stderr)
            print(f"[abs-meta]   Expected: {items_dir}", file=sys.stderr)
            return []

    books = []
    for mf in items_dir.rglob('metadata.json'):
        try:
            with open(mf, encoding='utf-8') as f:
                data = json.load(f)

            # ABS metadata.json has a top-level 'metadata' key
            meta = data.get('metadata', data)

            title  = (meta.get('title') or '').strip()

            # ABS stores authors as a list of strings: ["Author One", "Author Two"]
            raw_authors = meta.get('authors') or meta.get('author') or meta.get('authorName') or ''
            if isinstance(raw_authors, list):
                author = ', '.join(a.strip() for a in raw_authors if a.strip())
            else:
                author = str(raw_authors).strip()

            if not title:
                continue

            # Series: list of {name, sequence} objects
            series = ''
            series_list = meta.get('series') or []
            if series_list:
                s = series_list[0] if isinstance(series_list, list) else series_list
                if isinstance(s, dict):
                    series = (s.get('name') or '').strip()
                    seq = (s.get('sequence') or '').strip()
                    if seq:
                        series = f"{series} #{seq}"
                elif isinstance(s, str):
                    series = s

            books.append({
                '_source': 'abs_metadata',
                'title':   title,
                'author':  author,
                'series':  series,
                'formats': ['audio'],
                'status':  'want',
                'notes':   '',
                'rating':  0,
            })

        except Exception as e:
            print(f"[abs-meta] Skipping {mf}: {e}", file=sys.stderr)

    print(f"[abs-meta] {len(books)} audiobooks", file=sys.stderr)
    return books


# ─── Audio folder scan (fallback) ───────────────────────────────────────────

def scan_audio_folder(audio_path):
    """
    Scan a folder of audio files for audiobooks.

    Tries mutagen first for embedded tags (title, artist/albumartist).
    Falls back to directory structure: assumes Author/Title/ layout,
    which is what ABS uses by default.

    Install mutagen for better results: pip install mutagen
    """
    base = Path(audio_path)
    if not base.exists():
        print(f"[audio] Path not found: {base}", file=sys.stderr)
        return []

    try:
        from mutagen import File as MutagenFile
        from mutagen.easyid3 import EasyID3
        has_mutagen = True
        print("[audio] mutagen available — reading embedded tags", file=sys.stderr)
    except ImportError:
        has_mutagen = False
        print("[audio] mutagen not installed — using folder names only", file=sys.stderr)
        print("[audio]   For better results: pip install mutagen", file=sys.stderr)

    books = []
    seen_dirs = set()

    for audio_file in sorted(base.rglob('*')):
        if audio_file.suffix.lower() not in AUDIO_EXTS:
            continue

        book_dir = audio_file.parent
        if book_dir in seen_dirs:
            continue
        seen_dirs.add(book_dir)

        title  = ''
        author = ''

        if has_mutagen:
            try:
                mf = MutagenFile(audio_file, easy=True)
                if mf is not None:
                    # 'album' is more reliable than 'title' for audiobooks
                    title  = ((mf.get('album')       or mf.get('title')       or [''])[0]).strip()
                    author = ((mf.get('albumartist') or mf.get('artist')       or [''])[0]).strip()
            except Exception:
                pass

        # Fallback: parse directory structure
        if not title:
            try:
                rel   = book_dir.relative_to(base)
                parts = rel.parts
            except ValueError:
                parts = (book_dir.name,)

            if len(parts) >= 2:
                # Assume: .../Author/Title/
                author = author or parts[-2]
                title  = parts[-1]
            elif len(parts) == 1:
                title = parts[0]
            else:
                title = book_dir.name

        title = title.strip()
        if not title:
            continue

        books.append({
            '_source': 'audio_scan',
            'title':   title,
            'author':  author.strip(),
            'series':  '',
            'formats': ['audio'],
            'status':  'want',
            'notes':   '',
            'rating':  0,
        })

    print(f"[audio] {len(books)} audiobooks from folder scan", file=sys.stderr)
    return books


# ─── Merge & deduplicate ────────────────────────────────────────────────────

SOURCE_PRIORITY = {'calibre': 0, 'abs_metadata': 1, 'audio_scan': 2}



def diagnose_abs(metadata_path):
    """
    Audit the ABS metadata directory and report exactly why items are missing.
    Compares item directories against what was successfully parsed.
    """
    base = Path(metadata_path)
    items_dir = base / 'items'
    if not items_dir.exists():
        alt = base / 'metadata' / 'items'
        if alt.exists():
            items_dir = alt
        else:
            print(f"[diagnose] No items/ dir found under {base}", file=sys.stderr)
            return

    item_dirs = [d for d in items_dir.iterdir() if d.is_dir()]
    print(f"\n[diagnose] {len(item_dirs)} item directories in {items_dir}")

    no_metadata   = []
    empty_title   = []
    parse_error   = []
    ok            = []
    duplicates    = {}

    for item_dir in sorted(item_dirs):
        mf = item_dir / 'metadata.json'
        if not mf.exists():
            no_metadata.append(item_dir.name)
            continue
        try:
            with open(mf, encoding='utf-8') as f:
                data = json.load(f)
            meta  = data.get('metadata', data)
            title = (meta.get('title') or '').strip()
            if not title:
                empty_title.append(str(mf))
                continue
            raw_authors = meta.get('authors') or meta.get('author') or meta.get('authorName') or ''
            if isinstance(raw_authors, list):
                author = ', '.join(a.strip() for a in raw_authors if a.strip())
            else:
                author = str(raw_authors).strip()
            key = (title.lower(), author.lower())
            if key in duplicates:
                duplicates[key].append(title)
            else:
                duplicates[key] = [title]
            ok.append(title)
        except Exception as e:
            parse_error.append((str(mf), str(e)))

    dup_groups = {k: v for k, v in duplicates.items() if len(v) > 1}

    print(f"[diagnose] {len(ok)} parsed successfully")
    print(f"[diagnose] {len(no_metadata)} directories missing metadata.json")
    print(f"[diagnose] {len(empty_title)} items with empty/missing title")
    print(f"[diagnose] {len(parse_error)} items that failed to parse")
    print(f"[diagnose] {len(dup_groups)} duplicate title+author pairs (collapsed by dedup)")

    if no_metadata:
        print(f"\n--- Missing metadata.json ({len(no_metadata)}) ---")
        for d in no_metadata:
            print(f"  {d}")

    if empty_title:
        print(f"\n--- Empty title ({len(empty_title)}) ---")
        for p in empty_title:
            print(f"  {p}")

    if parse_error:
        print(f"\n--- Parse errors ({len(parse_error)}) ---")
        for p, e in parse_error:
            print(f"  {p}: {e}")

    if dup_groups:
        print(f"\n--- Duplicates collapsed by dedup ({len(dup_groups)} groups) ---")
        for (title, author), entries in dup_groups.items():
            print(f"  '{title}' by '{author}' appears {len(entries)}x")

    total_accounted = len(ok) - sum(len(v) - 1 for v in dup_groups.values())
    print(f"\n[diagnose] Net after dedup: {total_accounted}  (ABS reports: ?)")
    print(f"[diagnose] Unaccounted gap: {len(item_dirs) - len(ok) - len(no_metadata) - len(empty_title) - len(parse_error)}")


def merge_sources(all_books):
    """
    Merge books from all sources.
    - Same book in Calibre + ABS → one entry with formats: ['audio', 'ebook']
    - Higher-quality source wins for metadata (calibre > abs_metadata > audio_scan)
    - Formats accumulate across sources
    """
    merged = {}  # normalize_key → book dict

    for book in all_books:
        key = normalize_key(book['title'], book['author'])
        if key not in merged:
            merged[key] = dict(book)
        else:
            existing = merged[key]
            # Merge formats
            for fmt in book['formats']:
                if fmt not in existing['formats']:
                    existing['formats'].append(fmt)
            # Prefer higher-priority source for metadata
            if SOURCE_PRIORITY.get(book['_source'], 9) < SOURCE_PRIORITY.get(existing['_source'], 9):
                saved_formats = existing['formats']
                merged[key] = {**book, 'formats': saved_formats}

    # Assign stable IDs and strip internal fields
    result = []
    base_id = int(time.time() * 1000) - len(merged) * 1000
    for i, book in enumerate(merged.values()):
        result.append({
            'id':      base_id + i,
            'title':   book['title'],
            'author':  book['author'],
            'series':  book.get('series', ''),
            'formats': sorted(book['formats']),
            'status':  book.get('status', 'want'),
            'notes':   book.get('notes', ''),
            'rating':  book.get('rating', 0),
        })

    return result


def merge_with_existing(scanned, existing_path):
    """
    Merge scanned results with an existing my-library.json.

    Rules:
    - Preserve status, notes, rating from existing (your edits)
    - Preserve existing ID so your tracker doesn't lose track
    - Merge formats (existing might have 'physical' you added manually)
    - Books only in existing (e.g. physical-only) are kept as-is
    """
    try:
        with open(existing_path, encoding='utf-8') as f:
            existing = json.load(f)
    except FileNotFoundError:
        print(f"[merge] No existing file at {existing_path} — skipping merge", file=sys.stderr)
        return scanned
    except Exception as e:
        print(f"[merge] Could not read {existing_path}: {e}", file=sys.stderr)
        return scanned

    existing_map = {}
    for b in existing:
        key = normalize_key(b.get('title', ''), b.get('author', ''))
        existing_map[key] = b

    scanned_keys = set()
    for book in scanned:
        key = normalize_key(book['title'], book['author'])
        scanned_keys.add(key)
        if key in existing_map:
            ex = existing_map[key]
            book['id']     = ex.get('id', book['id'])
            book['status'] = ex.get('status', book['status'])
            book['notes']  = ex.get('notes', book['notes'])
            book['rating'] = ex.get('rating', book['rating'])
            # Merge formats — keep anything from existing (e.g. 'physical')
            for fmt in ex.get('formats', []):
                if fmt not in book['formats']:
                    book['formats'].append(fmt)
            book['formats'] = sorted(set(book['formats']))

    # Keep books from existing that weren't found in this scan
    # (manually added physical books, etc.)
    kept = 0
    for b in existing:
        key = normalize_key(b.get('title', ''), b.get('author', ''))
        if key not in scanned_keys:
            scanned.append(b)
            kept += 1

    print(f"[merge] Matched {len(existing_map)} existing · kept {kept} not-in-scan", file=sys.stderr)
    return scanned


# ─── Main ───────────────────────────────────────────────────────────────────

AUTO_CALIBRE      = '/mnt/media/ebooks/Calibre Library'
AUTO_ABS_METADATA = '/mnt/docker-data/audiobookshelf/metadata'
AUTO_OUTPUT       = 'my-library.json'


def main():
    parser = argparse.ArgumentParser(
        description='Scan Calibre + Audiobookshelf and output my-library.json',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--diagnose-abs', metavar='PATH', nargs='?', const='AUTO',
                        help='Audit ABS metadata dir and report missing/skipped items. '
                             'Uses --abs-metadata path or AUTO_ABS_METADATA if no path given.')
    parser.add_argument('--auto',           action='store_true',
                        help=f'Use default paths: Calibre={AUTO_CALIBRE}, ABS={AUTO_ABS_METADATA}, '
                             f'output={AUTO_OUTPUT}. Also auto-merges with existing output if present.')
    parser.add_argument('--calibre',        metavar='PATH', help='Calibre library root (contains metadata.db)')
    parser.add_argument('--abs-metadata',   metavar='PATH', help='ABS config/metadata dir (best for ABS)')
    parser.add_argument('--audiobookshelf', metavar='PATH', help='ABS media folder - fallback audio scan')
    parser.add_argument('--merge',          metavar='PATH', help='Existing my-library.json to merge with')
    parser.add_argument('--output',         metavar='PATH', default='my-library.json', help='Output path (default: my-library.json)')
    args = parser.parse_args()

    if args.auto:
        args.calibre      = args.calibre      or AUTO_CALIBRE
        args.abs_metadata = args.abs_metadata or AUTO_ABS_METADATA
        args.output       = AUTO_OUTPUT
        if args.merge is None and Path(AUTO_OUTPUT).exists():
            args.merge = AUTO_OUTPUT
            print(f"[auto] Merging with existing {AUTO_OUTPUT}", file=sys.stderr)

    # Handle --diagnose-abs (can be used standalone)
    if args.diagnose_abs is not None:
        diag_path = (AUTO_ABS_METADATA if args.diagnose_abs == 'AUTO'
                     else args.diagnose_abs)
        diagnose_abs(diag_path)
        if not any([args.calibre, args.abs_metadata, args.audiobookshelf]):
            return

    if not any([args.calibre, args.abs_metadata, args.audiobookshelf]):
        parser.error('Provide at least one of: --auto, --calibre, --abs-metadata, --audiobookshelf')

    all_books = []

    if args.calibre:
        all_books.extend(read_calibre(args.calibre))

    if args.abs_metadata:
        all_books.extend(read_abs_metadata(args.abs_metadata))
    elif args.audiobookshelf:
        all_books.extend(scan_audio_folder(args.audiobookshelf))

    print(f"\n[merge] Total before dedup: {len(all_books)}", file=sys.stderr)
    merged = merge_sources(all_books)
    print(f"[merge] After dedup: {len(merged)}", file=sys.stderr)

    if args.merge:
        merged = merge_with_existing(merged, args.merge)

    output_path = Path(args.output)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {len(merged)} books → {output_path}", file=sys.stderr)


if __name__ == '__main__':
    main()
