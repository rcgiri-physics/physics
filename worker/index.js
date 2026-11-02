// Physics Decoded Worker. Cloudflare serves the static site (public/) directly; this code only runs for
// /api/* and /admin/* (see "run_worker_first" in wrangler.jsonc), so static pages cost nothing extra.
//
//   Public API   POST /api/report    "Report a mistake"            -> D1 reports
//                POST /api/contact   contact form                  -> D1 messages
//                POST /api/event     anonymous study counters      -> D1 events
//   Admin        /admin/login, /admin/* (signed-in only), /api/admin/* (JSON, signed-in only)
import { checkLogin, createSession, readSession, sessionCookie, visitorKey } from './auth.js';
import * as db from './db.js';
import { github, GitHubError } from './github.js';
import { runTask, configuredProviders } from './ai.js';
import { classifyPath, validateFile } from '../admin/shared/validate.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const ADMIN_CSP = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
  "form-action 'self'; frame-ancestors 'none'";
const CONTENT_DIRS = { lessons: 'src/lessons', papers: 'src/papers', labs: 'src/labs', pages: 'src/pages' };
const MAX_UPLOAD = 1.5 * 1024 * 1024;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const fail = (status, error) => json({ error }, status);

async function body(request, limit = 200000) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Send JSON.');
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'That is too large.');
  try { return JSON.parse(text || '{}'); } catch (e) { throw new HttpError(400, 'Invalid JSON.'); }
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const str = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);

/** Requests that change something must come from our own pages (blocks cross-site form posts). */
function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return request.headers.get('Sec-Fetch-Site') !== 'cross-site';
  return origin === new URL(request.url).origin;
}

// ---------------------------------------------------------------- public endpoints

async function publicApi(request, env, path) {
  if (request.method !== 'POST') return fail(405, 'Use POST.');
  if (!sameOrigin(request)) return fail(403, 'Forbidden.');
  const data = await body(request, 20000);
  const key = await visitorKey(env, request, path);

  if (path === '/api/event') {
    // Analytics must never error for the visitor: everything below is best effort.
    if (!env.DB || !db.EVENT_NAMES.has(data.name)) return new Response(null, { status: 204 });
    if (!(await db.allow(env, 'ev:' + key, 120, 600))) return new Response(null, { status: 204 });
    const k = db.eventKey(data.name, data.data, str(data.path, 200));
    if (k) await db.countEvent(env, data.name, k);
    return new Response(null, { status: 204 });
  }

  if (data.website) return json({ ok: true });   // honeypot field filled in: a bot. Pretend it worked.
  if (!env.DB) return fail(503, 'Not available yet.');

  if (path === '/api/report') {
    const message = str(data.message, 2000);
    if (message.length < 5) return fail(400, 'Please describe the mistake.');
    if (!(await db.allow(env, 'rep:' + key, 10, 600))) return fail(429, 'Too many reports. Please wait a few minutes.');
    await db.addReport(env, { page: str(data.page, 200) || '/', title: str(data.title, 200), item: str(data.item, 300), message });
    return json({ ok: true });
  }
  if (path === '/api/contact') {
    const name = str(data.name, 80), message = str(data.message, 3000), email = str(data.email, 120);
    if (!name || message.length < 10) return fail(400, 'Please write your name and a message.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'That email address does not look right.');
    if (+data.elapsed > 0 && +data.elapsed < 2500) return json({ ok: true });   // filled in faster than a person can type
    if (!(await db.allow(env, 'msg:' + key, 5, 600))) return fail(429, 'Too many messages. Please wait a few minutes.');
    await db.addMessage(env, { name, email, message });
    return json({ ok: true });
  }
  return fail(404, 'Not found.');
}

// ---------------------------------------------------------------- admin pages

async function adminPage(request, env, url) {
  const user = await readSession(env, request);
  const isLogin = url.pathname === '/admin/login' || url.pathname === '/admin/login.html';
  const isAsset = /^\/admin\/(shared\/[a-z]+\.js|admin\.(css|js)|login\.js)$/.test(url.pathname);
  if (!user && !isLogin && !isAsset) {
    return Response.redirect(`${url.origin}/admin/login?next=${encodeURIComponent(url.pathname + url.hash)}`, 302);
  }
  if (user && isLogin) return Response.redirect(`${url.origin}/admin/`, 302);
  const res = await env.ASSETS.fetch(new Request(url.origin + url.pathname, { headers: request.headers }));
  const out = new Response(res.body, res);
  out.headers.set('Content-Security-Policy', ADMIN_CSP);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Referrer-Policy', 'same-origin');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  if (!isAsset) out.headers.set('Cache-Control', 'no-store');
  return out;
}

// ---------------------------------------------------------------- admin API

async function syllabus(env, origin) {
  try {
    const r = await env.ASSETS.fetch(new Request(origin + '/assets/syllabus.json'));
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

async function siteIndex(env, origin) {
  try {
    const r = await env.ASSETS.fetch(new Request(origin + '/assets/search-index.json'));
    return r.ok ? await r.json() : [];
  } catch (e) { return []; }
}

async function login(request, env) {
  const data = await body(request, 4000);
  const key = await visitorKey(env, request, 'login');
  const userKey = 'login-user:' + str(data.username, 60).toLowerCase();
  if ((await db.failures(env, 'login:' + key, 900)) >= 5 || (await db.failures(env, userKey, 900)) >= 20) {
    return fail(429, 'Too many attempts. Wait 15 minutes and try again.');
  }
  const r = await checkLogin(env, data.username, data.password, data.code);
  if (!r.ok) {
    if (!r.needCode || data.code) { await db.recordFailure(env, 'login:' + key); await db.recordFailure(env, userKey); }
    return json({ error: r.reason, needCode: !!r.needCode }, r.needCode && !data.code ? 200 : 401);
  }
  const token = await createSession(env, r.user);
  await db.audit(env, r.user.username, 'sign in');
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
}

function commitMessage(user, verb, path, note) {
  const name = path.split('/').pop();
  return `${note ? str(note, 120) : `${verb} ${name}`} (via admin, ${user.name})`;
}

async function adminApi(request, env, url, ctx) {
  const path = url.pathname;
  if (request.method !== 'GET' && !sameOrigin(request)) return fail(403, 'Forbidden.');
  // A custom header can't be sent by another site without a CORS preflight, which we never allow.
  if (request.method !== 'GET' && request.headers.get('X-PD-Admin') !== '1') return fail(403, 'Forbidden.');
  if (path === '/api/admin/login' && request.method === 'POST') return login(request, env);
  if (path === '/api/admin/logout') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });

  const user = await readSession(env, request);
  if (!user) return fail(401, 'Please sign in again.');
  const isAdmin = user.role === 'admin';

  if (path === '/api/admin/me') {
    return json({ user, repo: env.GITHUB_REPO || '', branch: env.GITHUB_BRANCH || 'main', db: !!env.DB,
      github: !!(env.GITHUB_TOKEN && env.GITHUB_REPO), ai: configuredProviders(env) });
  }

  if (path === '/api/admin/content' && request.method === 'GET') {
    const type = url.searchParams.get('type');
    if (!CONTENT_DIRS[type]) return fail(400, 'Unknown content type.');
    const [files, index] = await Promise.all([github(env).list(CONTENT_DIRS[type]), siteIndex(env, url.origin)]);
    const bySlug = new Map(index.map(i => [i.slug, i]));
    return json({ files: files.filter(f => /\.(json|html)$/.test(f.name)).map(f => {
      const slug = f.name.replace(/\.(json|html)$/, '');
      const live = type === 'pages' ? null : bySlug.get(slug);
      return { ...f, slug, title: live ? live.title : null, grade: live ? live.grade : null, kind: live ? live.kind : null, url: live ? live.url : (type === 'pages' ? '/' + slug : null) };
    }) });
  }

  if (path === '/api/admin/file') {
    const gh = github(env);
    if (request.method === 'GET') {
      const p = url.searchParams.get('path') || '';
      if (!classifyPath(p)) return fail(400, 'That file cannot be opened here.');
      return json(await gh.read(p));
    }
    const data = await body(request, 900000);
    const p = str(data.path, 200);
    const rule = classifyPath(p);
    if (!rule || rule.kind === 'image') return fail(400, 'That file cannot be saved here.');
    if (rule.admin && !isAdmin) return fail(403, 'Only an admin can change this.');
    if (request.method === 'DELETE') {
      if (!isAdmin) return fail(403, 'Only an admin can delete.');
      await gh.remove(p, { sha: data.sha, message: commitMessage(user, 'Delete', p), author: user.name });
      ctx.waitUntil(db.audit(env, user.username, 'delete', p));
      return json({ ok: true });
    }
    if (request.method === 'PUT') {
      const content = String(data.content || '');
      const problems = validateFile(p, content, await syllabus(env, url.origin));
      if (problems.length) return json({ error: 'Please fix these first.', problems }, 422);
      const r = await gh.write(p, { content, sha: data.sha || undefined, message: commitMessage(user, data.sha ? 'Update' : 'Add', p, data.message), author: user.name });
      ctx.waitUntil(db.audit(env, user.username, data.sha ? 'update' : 'create', p));
      return json({ ok: true, sha: r.sha, commit: r.commit });
    }
    return fail(405, 'Method not allowed.');
  }

  if (path === '/api/admin/upload' && request.method === 'POST') {
    const data = await body(request, MAX_UPLOAD * 1.4 + 2000);
    const name = str(data.name, 80).toLowerCase();
    const p = `src/assets/img/${name}`;
    const rule = classifyPath(p);
    if (!rule || rule.kind !== 'image') return fail(400, 'Name the image with lowercase words and hyphens, ending in .webp, .png or .jpg.');
    const b64 = String(data.data || '').replace(/^data:[^,]+,/, '');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (bytes.length > MAX_UPLOAD) return fail(413, 'Images must be under 1.5 MB.');
    const magic = [...bytes.slice(0, 12)];
    const isPng = magic[0] === 0x89 && magic[1] === 0x50, isJpg = magic[0] === 0xff && magic[1] === 0xd8;
    const isWebp = String.fromCharCode(...magic.slice(0, 4)) === 'RIFF' && String.fromCharCode(...magic.slice(8, 12)) === 'WEBP';
    if (!(isPng || isJpg || isWebp)) return fail(400, 'Only PNG, JPEG and WebP images can be uploaded.');
    const gh = github(env);
    let sha;
    try { sha = (await gh.read(p)).sha; } catch (e) { if (e.status !== 404) throw e; }
    if (sha && !data.replace) return fail(409, 'An image with this name already exists. Choose another name.');
    await gh.write(p, { contentB64: b64, sha, message: commitMessage(user, 'Upload', p), author: user.name });
    ctx.waitUntil(db.audit(env, user.username, 'upload', p));
    return json({ ok: true, url: '/' + p.replace(/^src\//, '') });
  }

  if (path === '/api/admin/status') return json(await github(env).status());

  if (path === '/api/admin/ai' && request.method === 'POST') {
    const data = await body(request, 120000);
    if (!(await db.allow(env, 'ai:' + user.username, 40, 3600))) return fail(429, 'That is a lot of AI requests for one hour. Take a short break.');
    const r = await runTask(env, str(data.task, 40), data.params || {}, await syllabus(env, url.origin));
    return json(r.body, r.status);
  }

  if (path === '/api/admin/inbox') {
    if (!env.DB) return fail(503, 'The D1 database is not connected yet (see README → Cloudflare setup).');
    if (request.method === 'GET') {
      const kind = url.searchParams.get('kind') === 'messages' ? 'messages' : 'reports';
      return json({ items: await db.inbox(env, kind, url.searchParams.get('status') === 'done' ? 'done' : 'open'), counts: await db.inboxCounts(env) });
    }
    const data = await body(request, 2000);
    await db.setStatus(env, data.kind === 'messages' ? 'messages' : 'reports', +data.id, data.status === 'open' ? 'open' : 'done');
    return json({ ok: true });
  }

  if (path === '/api/admin/insights') {
    if (!env.DB) return fail(503, 'The D1 database is not connected yet.');
    const days = Math.min(Math.max(+url.searchParams.get('days') || 30, 1), 365);
    return json(await db.insights(env, days));
  }

  if (path === '/api/admin/activity') {
    if (!env.DB) return fail(503, 'The D1 database is not connected yet.');
    if (!isAdmin) return fail(403, 'Only an admin can see the activity log.');
    return json({ items: await db.auditLog(env) });
  }

  return fail(404, 'Not found.');
}

// ---------------------------------------------------------------- entry

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/api/admin/')) return await adminApi(request, env, url, ctx);
      if (path.startsWith('/api/')) return await publicApi(request, env, path);
      if (path === '/admin') return Response.redirect(url.origin + '/admin/', 301);
      if (path.startsWith('/admin/')) return await adminPage(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError || e instanceof GitHubError) return fail(e.status || 500, e.message);
      console.error(e && e.stack || e);
      return fail(500, 'Something went wrong. Please try again.');
    }
  },
};
