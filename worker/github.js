// Saving from /admin = a commit to the GitHub repository (GitHub Contents API). The repository stays the
// single source of truth: every change is versioned, can be reviewed or reverted, and CI (build.py --strict)
// checks it; Cloudflare then rebuilds the site. Needs the GITHUB_TOKEN secret: a fine-grained token with
// "Contents: read and write" (and "Checks: read" for the build status) on this one repository only.


export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToB64(bytes);
}
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export function github(env, fetchImpl = fetch) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const API = env.GITHUB_API_URL || 'https://api.github.com';   // override for GitHub Enterprise or tests
  if (!env.GITHUB_TOKEN || !repo) throw new GitHubError('GITHUB_TOKEN and GITHUB_REPO must be set to save from the admin', 503);

  async function call(method, path, body) {
    const res = await fetchImpl(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'physics-decoded-admin',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) throw new GitHubError('not found', 404);
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 || res.status === 422 && /sha/.test(data.message || '')) {
      throw new GitHubError('Someone else changed this file since you opened it. Reload it, then make your change again.', 409);
    }
    if (!res.ok) throw new GitHubError(`GitHub said: ${data.message || res.status}`, res.status >= 500 ? 502 : res.status);
    return data;
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');

  return {
    branch,
    async list(dir) {
      try {
        const items = await call('GET', `/repos/${repo}/contents/${enc(dir)}?ref=${encodeURIComponent(branch)}`);
        return (Array.isArray(items) ? items : []).filter(i => i.type === 'file').map(i => ({ name: i.name, path: i.path, sha: i.sha, size: i.size }));
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    },
    async read(path) {
      const f = await call('GET', `/repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`);
      if (Array.isArray(f) || f.type !== 'file') throw new GitHubError('not a file', 400);
      let content = f.content ? b64ToUtf8(f.content) : '';
      if (!f.content && f.size > 0) {   // files over 1 MB come without content: fetch the blob
        const blob = await call('GET', `/repos/${repo}/git/blobs/${f.sha}`);
        content = b64ToUtf8(blob.content);
      }
      return { path: f.path, sha: f.sha, content };
    },
    async write(path, { content, contentB64, sha, message, author }) {
      const body = { message, branch, content: contentB64 || utf8ToB64(content) };
      if (sha) body.sha = sha;
      if (author) body.committer = body.author = { name: author, email: 'admin@users.noreply.github.com' };
      const r = await call('PUT', `/repos/${repo}/contents/${enc(path)}`, body);
      return { sha: r.content && r.content.sha, commit: r.commit && r.commit.sha };
    },
    async remove(path, { sha, message, author }) {
      const body = { message, branch, sha };
      if (author) body.committer = body.author = { name: author, email: 'admin@users.noreply.github.com' };
      await call('DELETE', `/repos/${repo}/contents/${enc(path)}`, body);
    },
    /** Latest commit on the branch and the result of its checks (the CI build). */
    async status() {
      const c = await call('GET', `/repos/${repo}/commits/${encodeURIComponent(branch)}`);
      let checks = [];
      try {
        const r = await call('GET', `/repos/${repo}/commits/${c.sha}/check-runs?per_page=20`);
        checks = (r.check_runs || []).map(x => ({ name: x.name, status: x.status, conclusion: x.conclusion, url: x.html_url }));
      } catch (e) { /* token without Checks permission: status still works */ }
      return { sha: c.sha, message: (c.commit.message || '').split('\n')[0], date: c.commit.committer && c.commit.committer.date,
        author: c.commit.author && c.commit.author.name, url: c.html_url, checks };
    },
  };
}
