// D1 helpers. Every function copes with a missing database binding (env.DB), so the site and admin keep
// working before D1 is set up: rate limits then fall back to a per-instance memory map.

const memory = new Map();
const now = () => Math.floor(Date.now() / 1000);

/** True if `key` has been seen fewer than `limit` times in the last `windowSec` seconds (and records this hit). */
export async function allow(env, key, limit, windowSec) {
  const since = now() - windowSec;
  if (!env.DB) {
    const hits = (memory.get(key) || []).filter(t => t > since);
    if (hits.length >= limit) { memory.set(key, hits); return false; }
    hits.push(now());
    memory.set(key, hits);
    return true;
  }
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?').bind(key, since).first();
  if (row && row.n >= limit) return false;
  await env.DB.prepare('INSERT INTO hits (key, at) VALUES (?, ?)').bind(key, now()).run();
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM hits WHERE at < ?').bind(now() - 86400).run();
  return true;
}

/** Count failed logins without recording a success (successful logins don't use up the allowance). */
export async function failures(env, key, windowSec) {
  const since = now() - windowSec;
  if (!env.DB) return (memory.get(key) || []).filter(t => t > since).length;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?').bind(key, since).first();
  return row ? row.n : 0;
}
export async function recordFailure(env, key) {
  if (!env.DB) { memory.set(key, [...(memory.get(key) || []), now()]); return; }
  await env.DB.prepare('INSERT INTO hits (key, at) VALUES (?, ?)').bind(key, now()).run();
}

export async function addReport(env, r) {
  await env.DB.prepare('INSERT INTO reports (created_at, page, title, item, message) VALUES (?, ?, ?, ?, ?)')
    .bind(now(), r.page, r.title, r.item, r.message).run();
}
export async function addMessage(env, m) {
  await env.DB.prepare('INSERT INTO messages (created_at, name, email, message) VALUES (?, ?, ?, ?)')
    .bind(now(), m.name, m.email, m.message).run();
}

export const EVENT_NAMES = new Set(['Study', 'Quiz finished', 'Search', 'Share', 'House ad', 'Paper attempt']);

/** One anonymous counter per (day, event, key). The key is the most useful single dimension of each event. */
export function eventKey(name, data, path) {
  const d = data || {};
  const s = v => String(v || '').slice(0, 120);
  switch (name) {
    case 'Study': return s(d.chapter || `${d.kind || ''} ${path || ''}`);
    case 'Quiz finished': return s(`${d.chapter || path} · ${d.mode || 'practice'} · ${d.score || ''}`);
    case 'Search': return s(String(d.query || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim());
    case 'House ad': return s(d.id);
    case 'Paper attempt': return s(d.paper || path);
    default: return s(path);
  }
}
export async function countEvent(env, name, key) {
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('INSERT INTO events (day, name, key, count) VALUES (?, ?, ?, 1) ON CONFLICT (day, name, key) DO UPDATE SET count = count + 1')
    .bind(day, name, key).run();
}

export async function insights(env, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const top = async name => (await env.DB.prepare('SELECT key, SUM(count) AS n FROM events WHERE name = ? AND day >= ? GROUP BY key ORDER BY n DESC LIMIT 25')
    .bind(name, since).all()).results;
  const perDay = (await env.DB.prepare('SELECT day, SUM(count) AS n FROM events WHERE name = ? AND day >= ? GROUP BY day ORDER BY day')
    .bind('Study', since).all()).results;
  return { since, studied: await top('Study'), quizzes: await top('Quiz finished'), searches: await top('Search'),
    papers: await top('Paper attempt'), houseAds: await top('House ad'), perDay };
}

export async function inbox(env, kind, status) {
  const table = kind === 'messages' ? 'messages' : 'reports';
  return (await env.DB.prepare(`SELECT * FROM ${table} WHERE status = ? ORDER BY created_at DESC LIMIT 200`).bind(status).all()).results;
}
export async function inboxCounts(env) {
  const r = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM reports WHERE status = 'open') AS reports, (SELECT COUNT(*) FROM messages WHERE status = 'open') AS messages").first();
  return r || { reports: 0, messages: 0 };
}
export async function setStatus(env, kind, id, status) {
  const table = kind === 'messages' ? 'messages' : 'reports';
  await env.DB.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(status, id).run();
}

export async function audit(env, username, action, target) {
  if (!env.DB) return;
  await env.DB.prepare('INSERT INTO audit (at, username, action, target) VALUES (?, ?, ?, ?)').bind(now(), username, action, target || null).run();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM audit WHERE at < ?').bind(now() - 180 * 86400).run();
}
export async function auditLog(env, limit = 100) {
  return (await env.DB.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT ?').bind(limit).all()).results;
}
