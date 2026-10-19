// ghsync — a GitHub-backed private data store for static sites.
//
// One factory call gives you cache-first reads, write-through saves with
// sha-checked PUTs, an offline dirty queue, background refresh, per-record
// conflict merging, and optional password encryption. Nothing here is
// specific to any app: pass your own collections and it works.
//
// Write ownership (the reason browser/Actions conflicts can't happen):
// every repo file must have exactly one writer. The browser owns everything
// in `files`; if a workflow in the data repo writes other paths, keep those
// paths out of `files` and read them through readFile()/refreshDir().
// The merge path below only ever handles browser-vs-browser (second device
// or tab) conflicts, merged per record id with local dirty records winning.
// Note: a record deleted locally can resurrect from such a merge; accepted
// for a single-user tool.
//
// The first write of a path to a repo is different: this browser has never
// seen that file, so "local wins" would mean a library that happened to be
// here overriding the repo's. With `holdFirstMerge`, that write is held
// instead when the app says the two sides differ, and nothing is sent until
// the app decides how to combine them and calls resolve().

import { createCache } from './cache.js';
import {
  makeClient, createTokenStore, ConflictError, NotFoundError, AuthError, NotConfiguredError,
} from './github-api.js';
import { encryptJson, decryptJson, isEnvelope } from './crypto.js';

export { ConflictError, NotFoundError, AuthError, NotConfiguredError };

// A first write held for the app to decide on (see holdFirstMerge). Not a
// failure: the status stays 'pending' with this as its error, so the UI can
// say what is waiting.
export class ResolutionNeededError extends Error {
  constructor(collection) {
    super(`${collection}: this device and the data repo differ; choose how to combine them`);
    this.name = 'ResolutionNeededError';
    this.collection = collection;
  }
}

/**
 * @param {object} opts
 * @param {string}   opts.appId       localStorage namespace, e.g. 'notes'.
 * @param {object}   opts.files       collection -> repo path, all browser-owned.
 * @param {string[]} [opts.encrypted] collections encrypted when a password is set.
 * @param {(path:string)=>boolean} [opts.encryptPath] extra predicate for
 *                   app-owned paths outside `files` (e.g. month shards).
 * @param {object}   [opts.migrate]   collection -> (record)=>record, applied on read.
 * @param {object}   [opts.defaultRepo] {owner, repo, branch} or null for local-only.
 * @param {()=>string[]} [opts.extraPaths] app-owned repo paths to include when
 *                   re-encrypting or seeding a new repo.
 * @param {()=>Promise<boolean>} [opts.onRefresh] called at the end of refresh();
 *                   return true if it changed anything.
 * @param {number}   [opts.retryMs]   dirty-queue retry interval (0 disables).
 * @param {(collection:string, local:object[], remote:object[])=>boolean} [opts.holdFirstMerge]
 *                   asked before the first write of a collection to a repo
 *                   that already has that file: return true to hold it for
 *                   resolve() rather than merging automatically.
 */
export function createStore(opts) {
  const {
    appId,
    files,
    encrypted = [],
    encryptPath = () => false,
    migrate = {},
    defaultRepo = null,
    extraPaths = () => [],
    onRefresh = async () => false,
    retryMs = 30000,
    holdFirstMerge = null,
  } = opts;

  const REPO_KEY = `${appId}.datarepo`;
  const PW_KEY = `${appId}.enc.pw`;
  const cache = createCache(appId);
  const tokens = createTokenStore(`${appId}.pat`);

  // ---------- data repository ----------
  // Personal data lives in a separate PRIVATE repo, never the public one that
  // serves the app. It's configured at runtime so switching repos needs no
  // redeploy; the client reads this getter on every call, so a change in
  // Settings takes effect immediately.

  function getDataRepo() {
    try {
      const stored = JSON.parse(localStorage.getItem(REPO_KEY));
      if (stored?.owner && stored?.repo) return { branch: 'main', ...stored };
    } catch {
      // fall through to the default
    }
    return defaultRepo;
  }

  function setDataRepo(cfg) {
    if (cfg?.owner && cfg?.repo) {
      localStorage.setItem(REPO_KEY, JSON.stringify({
        owner: cfg.owner.trim(),
        repo: cfg.repo.trim(),
        branch: (cfg.branch || 'main').trim(),
      }));
    } else {
      localStorage.removeItem(REPO_KEY);
    }
  }

  function hasDataRepo() {
    const c = getDataRepo();
    return !!(c?.owner && c?.repo);
  }

  // Remote sync needs both a token and a destination.
  const canSync = () => tokens.has() && hasDataRepo();

  const client = makeClient(getDataRepo, tokens);
  const listeners = new Set();
  let status = 'local'; // 'local' | 'ok' | 'pending' | 'error'
  let lastError = null;

  // ---------- encryption (optional password) ----------
  // When a password is set, the `encrypted` collections (and anything
  // encryptPath() claims) are written as AES-GCM envelopes — see crypto.js.
  // The local cache is always plaintext: the device is trusted, same as the PAT.

  const lockedPaths = new Set(); // envelopes we couldn't decrypt (no/wrong password)
  const held = new Map();        // path -> { collection, remote, sha, error } awaiting resolve()
  const password = () => localStorage.getItem(PW_KEY) || '';

  function setPassword(pw) {
    if (pw) localStorage.setItem(PW_KEY, pw);
    else localStorage.removeItem(PW_KEY);
  }

  function encryption() {
    return { enabled: !!password(), locked: lockedPaths.size > 0 };
  }

  const encryptedPaths = () => encrypted.map((c) => files[c]);
  function isEncryptedPath(path) {
    return encryptedPaths().includes(path) || encryptPath(path);
  }

  // Repo-file (de)serialization boundary — the ONLY place ciphertext exists.
  async function serializeFile(path, data) {
    // A collection nothing has been saved to yet is empty, not null: a literal
    // `null` in the repo is a file that parses fine and then breaks every
    // merge against it, which is a permanent "pending sync".
    const value = data ?? [];
    const body = password() && isEncryptedPath(path) ? await encryptJson(value, password()) : value;
    return JSON.stringify(body, null, 2) + '\n';
  }

  // -> { data } on success, { locked: true } when an envelope can't be opened.
  async function deserializeFile(path, parsed) {
    if (!isEnvelope(parsed)) {
      lockedPaths.delete(path);
      return { data: parsed };
    }
    if (password()) {
      try {
        const data = await decryptJson(parsed, password());
        lockedPaths.delete(path);
        return { data };
      } catch {
        // fall through to locked
      }
    }
    lockedPaths.add(path);
    return { locked: true };
  }

  function emit(event) {
    for (const fn of listeners) fn(event);
  }

  function setStatus(s, err = null) {
    status = s;
    lastError = err;
    emit({ type: 'sync-status', status: s, error: err });
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function syncStatus() {
    return { status, error: lastError, connected: canSync() };
  }

  // Recompute the badge state from current settings. Called after the token or
  // data repo changes so the UI reflects it immediately, rather than staying
  // stale until the next sync happens to run.
  function refreshStatus() {
    setStatus(canSync() ? (cache.getQueue().length ? 'pending' : 'ok') : 'local');
  }

  // ---------- reads ----------

  function get(collection) {
    const data = cache.getData(files[collection]) ?? [];
    const fn = migrate[collection];
    return fn ? data.map(fn) : data;
  }

  // ---------- writes ----------

  async function save(collection, records) {
    const path = files[collection];
    cache.setData(path, records);
    cache.markDirty(path);
    emit({ type: 'changed', collection });
    await push(path, collection);
  }

  async function upsert(collection, record) {
    const records = get(collection).slice();
    const i = records.findIndex((r) => r.id === record.id);
    if (i >= 0) records[i] = record;
    else records.push(record);
    await save(collection, records);
  }

  async function remove(collection, id) {
    await save(collection, get(collection).filter((r) => r.id !== id));
  }

  async function push(path, collection) {
    if (!canSync() || !navigator.onLine) {
      setStatus(canSync() ? 'pending' : 'local');
      return;
    }
    if (held.has(path)) { setStatus('pending', held.get(path).error); return; }
    setStatus('pending');
    try {
      // Never written to this repo from here (no sha): look before writing.
      if (holdFirstMerge && collection && cache.getSha(path) == null) {
        const first = await holdIfDifferent(path, collection);
        if (first === 'held') return;
        // Nothing to decide: merge now, which also learns the sha, so later
        // writes are checked against it rather than looking first again.
        if (first === 'merge') await mergeRemote(path, collection);
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const content = await serializeFile(path, cache.getData(path));
        try {
          const sha = await client.putFile(path, content, cache.getSha(path), `Update ${path}`);
          cache.setSha(path, sha);
          cache.clearDirty(path);
          setStatus(cache.getQueue().length ? 'pending' : 'ok');
          return;
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          await mergeRemote(path, collection);
        }
      }
      throw new Error(`Gave up pushing ${path} after repeated conflicts`);
    } catch (e) {
      // A 404 on a WRITE means the repo or branch is unreachable with this
      // token — GitHub answers 404, not 403, for a private repo the token
      // cannot see. Retrying will not change that, so it is an error the user
      // has to act on, not a "pending" that looks like it will resolve.
      // A remote file that will not parse (past the Contents API's 1 MB read
      // limit, or damaged) surfaces here when a push has to merge with it —
      // the same unretryable failure refresh() reports, so the same status.
      if (e instanceof AuthError || e instanceof NotFoundError || e instanceof SyntaxError) setStatus('error', e);
      else setStatus('pending', e); // network or transient: stays queued
    }
  }

  // -> 'held', 'merge' (nothing to decide), or 'usual': a file that is
  // absent, locked, or not a list is left to the usual path (create it,
  // report it, or write over it).
  async function holdIfDifferent(path, collection) {
    let f;
    try {
      f = await client.getFile(path);
    } catch (e) {
      if (e instanceof NotFoundError) return 'usual';
      throw e;
    }
    const res = await deserializeFile(path, JSON.parse(f.content));
    if (res.locked || !Array.isArray(res.data)) return 'usual';
    if (!holdFirstMerge(collection, cache.getData(path) ?? [], res.data)) return 'merge';
    const error = new ResolutionNeededError(collection);
    held.set(path, { collection, remote: res.data, sha: f.sha, error });
    setStatus('pending', error);
    emit({ type: 'needs-resolution', collection, path });
    return 'held';
  }

  // Held first writes, for the app to show: [{ collection, path, remote }].
  const pendingResolutions = () =>
    [...held].map(([path, h]) => ({ collection: h.collection, path, remote: h.remote }));

  // The app's decision for a held path: `records` become this device's copy,
  // checked against the sha the repo had when it was held. If they are the
  // repo's own records nothing is written; otherwise they are pushed (and a
  // repo that moved on meanwhile merges as any other conflict would).
  async function resolve(path, records) {
    const h = held.get(path);
    if (!h) return;
    held.delete(path);
    cache.setData(path, records);
    cache.setSha(path, h.sha);
    if (JSON.stringify(records) === JSON.stringify(h.remote)) cache.clearDirty(path);
    else cache.markDirty(path);
    emit({ type: 'changed', collection: h.collection });
    if (cache.isDirty(path)) await push(path, h.collection);
    else if (!held.size) setStatus(cache.getQueue().length ? 'pending' : 'ok');
  }

  async function mergeRemote(path, collection) {
    let remote = [];
    let sha = null;
    try {
      const f = await client.getFile(path);
      const res = await deserializeFile(path, JSON.parse(f.content));
      // Locked remote = encrypted under a password we don't have; merging is
      // impossible and overwriting would destroy data. Stay dirty and queued.
      if (res.locked) throw new Error(`Cannot merge ${path}: encrypted with an unknown password`);
      // A remote that is not a list (a `null` an older version wrote, or
      // anything hand-edited) has no records to merge; local simply wins.
      remote = Array.isArray(res.data) ? res.data : [];
      sha = f.sha;
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
    const local = cache.getData(path) ?? [];
    const byId = new Map();
    for (const r of remote) byId.set(r.id, r);
    for (const r of local) {
      // Local dirty records win — except over a deletion. A record with
      // `deleted: true` is a tombstone; letting a live copy beat it is how a
      // deleted record came back (a stale device, or a delete racing an edit).
      // Ids are never reused, so a deletion is always final.
      const other = byId.get(r.id);
      if (other && other.deleted && !r.deleted) continue;
      byId.set(r.id, r);
    }
    cache.setData(path, [...byId.values()]);
    cache.setSha(path, sha);
    if (collection) emit({ type: 'changed', collection });
  }

  // Retry everything still dirty (called on 'online' and on a timer).
  async function flushQueue() {
    for (const path of cache.getQueue()) {
      const collection = Object.keys(files).find((k) => files[k] === path);
      await push(path, collection);
    }
  }

  // ---------- background refresh ----------

  async function refresh() {
    if (!canSync() || !navigator.onLine) return;
    try {
      for (const [collection, path] of Object.entries(files)) {
        if (cache.isDirty(path)) continue; // don't clobber unpushed local edits
        try {
          const { content, sha } = await client.getFile(path);
          if (sha !== cache.getSha(path)) {
            const res = await deserializeFile(path, JSON.parse(content));
            if (res.locked) {
              // Keep the old cache and old sha so we retry once unlocked.
              emit({ type: 'sync-status', status, error: lastError });
              continue;
            }
            if (!Array.isArray(res.data)) {
              // Present but holding no list (a `null`, say). Treated like an
              // absent file — local records are NOT replaced with nothing —
              // except that the file does exist, so its sha is kept for the
              // next write to be checked against, and anything held locally
              // is queued to be written over it.
              cache.setSha(path, sha);
              const local = cache.getData(path);
              if (Array.isArray(local) && local.length) cache.markDirty(path);
              continue;
            }
            cache.setData(path, res.data);
            cache.setSha(path, sha);
            emit({ type: 'changed', collection });
          }
        } catch (e) {
          if (!(e instanceof NotFoundError)) throw e; // absent file = empty collection
        }
      }
      await onRefresh();
      if (!cache.getQueue().length) setStatus('ok');
    } catch (e) {
      if (e instanceof AuthError) setStatus('error', e);
      // A file that arrives but will not parse is not a flaky network: past
      // 1 MB the Contents API returns an empty body, and a hand-damaged file
      // fails the same way. Retrying cannot fix either, so it is reported
      // rather than swallowed — otherwise sync just quietly stops working.
      else if (e instanceof SyntaxError) setStatus('error', e);
      // other failures (offline, a blip): keep whatever we had cached
    }
  }

  // ---------- raw file access (for app-owned paths outside `files`) ----------

  const readFile = (path) => cache.getData(path);

  // Write an app-owned path through the same cache/queue/encryption path as a
  // collection. Used for sharded data (one file per month, say) that doesn't
  // fit the collection model.
  async function writeFile(path, data) {
    cache.setData(path, data);
    cache.markDirty(path);
    await push(path, null);
  }

  // Pull every file in a repo directory into the cache. Returns the paths seen
  // and whether anything changed. Locally-dirty paths are skipped so an
  // unpushed local write isn't clobbered by the remote.
  async function refreshDir(dir, match = () => true) {
    const paths = [];
    let changed = false;
    for (const entry of await client.listDir(dir)) {
      if (!match(entry.name)) continue;
      paths.push(entry.path);
      if (cache.isDirty(entry.path) || entry.sha === cache.getSha(entry.path)) continue;
      const { content, sha } = await client.getFile(entry.path);
      const res = await deserializeFile(entry.path, JSON.parse(content));
      if (res.locked) {
        emit({ type: 'sync-status', status, error: lastError });
        continue;
      }
      cache.setData(entry.path, res.data);
      cache.setSha(entry.path, sha);
      changed = true;
    }
    return { paths, changed };
  }

  // ---------- migrations and seeding ----------

  // Re-upload cached collections to the data repo. `collections` defaults to
  // the encryptable ones, which is what enabling/disabling a password needs;
  // pass all of `files` to seed a freshly-created repo from this browser.
  // extraPaths() are rewritten too; when one of them is Actions-owned these
  // migration writes are the documented exception, and a conflict is ignored
  // because the workflow will reconverge on its next run.
  async function rewriteEncryptedFiles(collections = encrypted) {
    if (!canSync()) return; // local mode, or no repo configured yet
    for (const collection of collections) {
      const path = files[collection];
      cache.markDirty(path);
      await push(path, collection);
    }
    for (const path of extraPaths()) {
      const data = cache.getData(path);
      if (!Array.isArray(data)) continue; // never had it decrypted — skip
      const content = await serializeFile(path, data);
      try {
        const sha = await client.putFile(path, content, cache.getSha(path), `Update ${path}`);
        cache.setSha(path, sha);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
  }

  // Seed a newly configured data repo with everything this browser holds.
  // Shas are cleared first so each file is created rather than sha-checked
  // against a different repo's history.
  async function pushAllData() {
    if (!canSync()) throw new Error('Set a data repository and a token first');
    for (const path of Object.values(files)) cache.setSha(path, null);
    for (const path of extraPaths()) cache.setSha(path, null);
    await rewriteEncryptedFiles(Object.keys(files));
  }

  // ---------- disconnecting ----------

  // Forget this device's connection: token, data repo, password, and every
  // cached file, sha and queued write, so nothing can reach GitHub again
  // until it is set up afresh. The app's own storage is not ghsync's and is
  // left alone. After this get() returns [] for every collection — that
  // means "nothing cached", not "empty library", and the app must not apply
  // it as data.
  function disconnect() {
    tokens.set('');
    setDataRepo(null);
    setPassword('');
    lockedPaths.clear();
    held.clear();
    cache.clearAll();
    setStatus('local');
  }

  // ---------- lifecycle ----------

  function init() {
    window.addEventListener('online', () => flushQueue());
    // Cross-tab: another tab wrote localStorage — re-render rather than merge later.
    window.addEventListener('storage', (e) => {
      if (e.key?.startsWith(cache.dataPrefix)) emit({ type: 'changed', collection: 'external' });
    });
    if (retryMs) {
      setInterval(() => {
        if (cache.getQueue().length) flushQueue();
      }, retryMs);
    }
    setStatus(canSync() ? (cache.getQueue().length ? 'pending' : 'ok') : 'local');
    // Fire-and-forget background load. The queue is retried straight after it,
    // not left for the 30s timer: refresh() skips dirty paths, so it is also
    // what learns their shas, and writes that were waiting on one can go now.
    refresh().then(() => { if (cache.getQueue().length) return flushQueue(); }).catch(() => {});
  }

  return {
    // configuration
    getDataRepo, setDataRepo, hasDataRepo,
    getToken: tokens.get, setToken: tokens.set, hasToken: tokens.has,
    setPassword, encryption,
    // data
    get, save, upsert, remove,
    // status and events
    onChange, emit, syncStatus, refreshStatus, canSync,
    // sync
    refresh, flushQueue, rewriteEncryptedFiles, pushAllData, init, disconnect,
    pendingResolutions, resolve,
    // escape hatches for app-owned paths
    client, cache, readFile, writeFile, refreshDir, push,
    serializeFile, deserializeFile, isEncryptedPath,
    files,
  };
}
