// Thin GitHub Contents API client. Auth is a fine-grained PAT scoped to a
// single private data repo, kept in localStorage and never rendered back into
// the DOM. The repo it targets is configured at runtime, so a user can point
// the app at their own repo without a redeploy.

const API = 'https://api.github.com';

export class NotConfiguredError extends Error {
  constructor() {
    super('No data repository configured — set one in Settings');
    this.name = 'NotConfiguredError';
  }
}

export class ConflictError extends Error {
  constructor(path) {
    super(`Conflict writing ${path}`);
    this.name = 'ConflictError';
    this.path = path;
  }
}
export class AuthError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'AuthError';
  }
}
export class NotFoundError extends Error {
  constructor(path) {
    super(`Not found: ${path}`);
    this.name = 'NotFoundError';
    this.path = path;
  }
}

// The PAT lives under a per-app key so two ghsync apps on the same origin
// keep separate tokens (they usually have separate data repos).
export function createTokenStore(tokenKey) {
  return {
    get: () => localStorage.getItem(tokenKey) || '',
    set(t) {
      if (t) localStorage.setItem(tokenKey, t.trim());
      else localStorage.removeItem(tokenKey);
    },
    has() {
      return !!(localStorage.getItem(tokenKey) || '');
    },
  };
}

// GitHub says why in the body of every error ("Bad credentials", "API rate
// limit exceeded", "Branch main not found"). It is read so the message can
// repeat it: a bare status code left a user staring at "pending sync" with
// nothing to act on. Best-effort — an unreadable body just means no detail.
async function check(res, path) {
  if (res.ok) return res;
  let detail = '';
  try { detail = String((await res.clone().json()).message || ''); } catch { /* no body */ }
  const why = detail ? `: ${detail}` : '';
  if (res.status === 401 || res.status === 403) throw new AuthError(`GitHub auth failed (${res.status})${why}`);
  if (res.status === 404) throw new NotFoundError(path);
  if (res.status === 409) throw new ConflictError(path);
  // A 422 is a conflict only when it is about the sha ("sha wasn't supplied"):
  // that is what a stale or missing sha looks like, and what merging fixes.
  // Any other 422 (a branch that does not exist, content GitHub will not take)
  // cannot be cured by merging and re-sending, so it is reported as itself
  // rather than retried three times as a "conflict" and given up on.
  if (res.status === 422) {
    if (!detail || /sha/i.test(detail)) throw new ConflictError(path);
    throw new Error(`GitHub rejected the write to ${path} (422)${why}`);
  }
  throw new Error(`GitHub API ${res.status} for ${path}${why}`);
}

// UTF-8-safe base64 helpers (btoa alone breaks on non-ASCII text).
function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// repoCfgOrGetter: either a {owner, repo, branch} object or a function
// returning one. The getter form lets Settings retarget the data repo
// without a reload, since every call re-reads the current config.
// tokens: a token store from createTokenStore().
export function makeClient(repoCfgOrGetter, tokens) {
  const headers = () => ({
    Authorization: `Bearer ${tokens.get()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });
  const raw = () => (typeof repoCfgOrGetter === 'function' ? repoCfgOrGetter() : repoCfgOrGetter);
  const cfg = () => {
    const c = raw();
    if (!c?.owner || !c?.repo) throw new NotConfiguredError();
    return { branch: 'main', ...c };
  };
  const base = () => `${API}/repos/${cfg().owner}/${cfg().repo}/contents`;

  return {
    isConfigured() {
      try {
        cfg();
        return true;
      } catch {
        return false;
      }
    },
    target() {
      const c = raw();
      return c?.owner && c?.repo ? { branch: 'main', ...c } : null;
    },
    // -> { content: string, sha } ; throws NotFoundError if absent
    async getFile(path) {
      const res = await fetch(`${base()}/${path}?ref=${cfg().branch}`, { headers: headers() });
      await check(res, path);
      const json = await res.json();
      return { content: b64decode(json.content), sha: json.sha };
    },

    // sha: pass null on create. -> new sha. Throws ConflictError on sha mismatch.
    async putFile(path, content, sha, message) {
      const body = {
        message,
        content: b64encode(content),
        branch: cfg().branch,
      };
      if (sha) body.sha = sha;
      const res = await fetch(`${base()}/${path}`, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await check(res, path);
      const json = await res.json();
      return json.content.sha;
    },

    // -> [{ name, path, sha }] ; [] if the directory doesn't exist yet
    async listDir(path) {
      const res = await fetch(`${base()}/${path}?ref=${cfg().branch}`, { headers: headers() });
      if (res.status === 404) return [];
      await check(res, path);
      const json = await res.json();
      return Array.isArray(json) ? json.map(({ name, path: p, sha }) => ({ name, path: p, sha })) : [];
    },

    // Run a workflow in the data repo via workflow_dispatch. Only needed by
    // apps whose data repo has Actions; the PAT then also needs Actions:write.
    async dispatchWorkflow(workflowFile) {
      const res = await fetch(
        `${API}/repos/${cfg().owner}/${cfg().repo}/actions/workflows/${workflowFile}/dispatches`,
        {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: cfg().branch }),
        },
      );
      await check(res, workflowFile);
    },

    // Cheap validity probe for the settings panel.
    async validate() {
      const res = await fetch(`${API}/repos/${cfg().owner}/${cfg().repo}`, { headers: headers() });
      await check(res, 'repo');
      return true;
    },
  };
}
