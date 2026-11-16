// Write-through localStorage cache, namespaced per app so two ghsync apps
// served from the same origin (github.io) never collide. Keys:
//   <ns>.data.<path>  JSON string of the file content
//   <ns>.sha.<path>   last known remote blob sha
//   <ns>.queue        JSON array of dirty paths awaiting push
//   <ns>.shadow.<path> { id: hash } of a source-backed file (see below)
//
// `source(path)` (optional) lets the app own a file's content instead: it
// returns { get(), set(value) } for paths whose records the app already keeps
// in its own storage, or null. For those, <ns>.data.<path> holds only "1"
// ("synced on this device") rather than a second copy of the whole library,
// and a shadow of per-record hashes stands in for the old copy where the
// edit tracking needs to know what changed.

// FNV-1a, 32 bit: a fingerprint, not a security hash.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function createCache(namespace, { source = () => null } = {}) {
  const DATA = `${namespace}.data.`;
  const SHA = `${namespace}.sha.`;
  const QUEUE = `${namespace}.queue`;
  const SHADOW = `${namespace}.shadow.`;
  const IDS = `${namespace}.dirtyids`; // { path: [record ids edited since the last push] }

  // Plain closures rather than methods, so callers can destructure them
  // without losing `this`.
  function getQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE)) ?? [];
    } catch {
      return [];
    }
  }

  function allDirtyIds() {
    try {
      return JSON.parse(localStorage.getItem(IDS)) ?? {};
    } catch {
      return {};
    }
  }

  // ids: an array, or null to forget what is tracked for the path.
  function setDirtyIds(path, ids) {
    const all = allDirtyIds();
    if (ids) all[path] = ids;
    else delete all[path];
    try {
      localStorage.setItem(IDS, JSON.stringify(all));
    } catch {
      // Storage is full: stop tracking rather than track wrongly. Untracked
      // means "every local record counts as edited".
      delete all[path];
      try { localStorage.setItem(IDS, JSON.stringify(all)); } catch { localStorage.removeItem(IDS); }
    }
  }

  function writeShadow(path, records) {
    const m = {};
    for (const r of Array.isArray(records) ? records : []) {
      if (!r || r.id == null || r.id === '') { localStorage.removeItem(SHADOW + path); return; }
      m[r.id] = hash(JSON.stringify(r));
    }
    try {
      localStorage.setItem(SHADOW + path, JSON.stringify(m));
    } catch {
      localStorage.removeItem(SHADOW + path); // unknown, so edits go untracked: the safe side
    }
  }

  return {
    dataPrefix: DATA,
    getQueue,

    getData(path) {
      const raw = localStorage.getItem(DATA + path);
      if (raw == null) return null;
      const src = source(path);
      if (src) return src.get();
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    setData(path, value) {
      const src = source(path);
      if (!src) {
        localStorage.setItem(DATA + path, JSON.stringify(value));
        return;
      }
      localStorage.setItem(DATA + path, '1');
      src.set(value);
      writeShadow(path, src.get());
    },

    // { id: hash } of what a source-backed path last held here, or null
    // when unknown (never recorded, or storage was full).
    getShadow(path) {
      try {
        const s = JSON.parse(localStorage.getItem(SHADOW + path));
        return s && typeof s === 'object' ? s : null;
      } catch {
        return null;
      }
    },
    hash,
    isSourced: (path) => !!source(path),

    // An older version kept a full copy in <ns>.data.<path>. Keep what it
    // says about the last synced state (as the shadow) and drop the copy.
    // -> true when something was compacted.
    compact(path) {
      if (!source(path)) return false;
      const raw = localStorage.getItem(DATA + path);
      if (raw == null || raw === '1') return false;
      let old = null;
      try { old = JSON.parse(raw); } catch { /* unreadable: no shadow */ }
      if (Array.isArray(old)) writeShadow(path, old);
      else localStorage.removeItem(SHADOW + path);
      localStorage.setItem(DATA + path, '1');
      return true;
    },

    getSha(path) {
      return localStorage.getItem(SHA + path);
    },

    setSha(path, sha) {
      if (sha) localStorage.setItem(SHA + path, sha);
      else localStorage.removeItem(SHA + path);
    },

    markDirty(path) {
      const q = getQueue();
      if (!q.includes(path)) {
        q.push(path);
        localStorage.setItem(QUEUE, JSON.stringify(q));
      }
    },

    clearDirty(path) {
      localStorage.setItem(QUEUE, JSON.stringify(getQueue().filter((p) => p !== path)));
      setDirtyIds(path, null);
    },

    // Which records of a dirty file were edited (added, changed or removed)
    // since its last push: an array of ids, or null when that isn't known.
    // The conflict merge reads this; see store.js mergeRemote().
    getDirtyIds(path) {
      const ids = allDirtyIds()[path];
      return Array.isArray(ids) ? ids : null;
    },
    setDirtyIds,

    // Every key this cache owns — cached files, shas and the queue — and
    // nothing else in localStorage.
    clearAll() {
      const own = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(DATA) || k.startsWith(SHA) || k.startsWith(SHADOW) || k === QUEUE || k === IDS)) own.push(k);
      }
      own.forEach((k) => localStorage.removeItem(k));
    },

    isDirty(path) {
      return getQueue().includes(path);
    },
  };
}
