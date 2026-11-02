// Worker: authentication primitives and request handling, with stubbed bindings (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, totp, verifyTotp, createSession, readSession, COOKIE } from '../worker/auth.js';
import worker from '../worker/index.js';

const env = {
  SESSION_SECRET: 'x'.repeat(40),
  ASSETS: { fetch: async req => new Response('asset ' + new URL(req.url).pathname, { headers: { 'Content-Type': 'text/html' } }) },
};
const ctx = { waitUntil() {} };
const call = (path, init = {}) => worker.fetch(new Request('https://site.test' + path, init), env, ctx);

test('password hashing', async () => {
  const h = await hashPassword('a long passphrase', 1000);
  assert.ok(await verifyPassword('a long passphrase', h));
  assert.ok(!(await verifyPassword('wrong', h)));
  assert.ok(!(await verifyPassword('x', 'garbage')));
});

test('TOTP matches the RFC 6238 SHA-1 test vector', async () => {
  // Secret "12345678901234567890" in base32; at T = 59 s the 8-digit code is 94287082, so 6 digits = 287082.
  assert.equal(await totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
  assert.ok(await verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 59000));
  assert.ok(!(await verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '000000', 59000)));
});

test('sessions are signed and bound to the password', async () => {
  const user = { username: 'r', name: 'R', role: 'admin', password: await hashPassword('p'.repeat(12), 1000) };
  const e = { ...env, ADMIN_USERS: JSON.stringify([user]) };
  const token = await createSession(e, user);
  const req = t => new Request('https://x/', { headers: { Cookie: `${COOKIE}=${t}` } });
  assert.equal((await readSession(e, req(token))).role, 'admin');
  assert.equal(await readSession(e, req(token.slice(0, -2) + 'AA')), null, 'tampered signature');
  const changed = { ...e, ADMIN_USERS: JSON.stringify([{ ...user, password: await hashPassword('another password', 1000) }]) };
  assert.equal(await readSession(changed, req(token)), null, 'password change signs out');
});

test('static pages pass through, admin is gated, API needs a session', async () => {
  assert.equal(await (await call('/posts/x')).text(), 'asset /posts/x');
  const admin = await call('/admin/');
  assert.equal(admin.status, 302);
  assert.match(admin.headers.get('Location'), /\/admin\/login/);
  assert.equal((await call('/admin/login')).headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal((await call('/api/admin/me')).status, 401);
});

test('state-changing requests need the admin header and same origin', async () => {
  const post = (path, headers) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await post('/api/admin/login', {})).status, 403);
  assert.equal((await post('/api/admin/login', { 'X-PD-Admin': '1', Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('/api/report', { Origin: 'https://evil.test' })).status, 403);
});

test('public endpoints degrade politely without the database', async () => {
  const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site.test' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/event', { name: 'Study', data: {} })).status, 204);
  assert.equal((await post('/api/report', { message: 'A real report text' })).status, 503);
  assert.equal((await post('/api/report', { message: 'spam', website: 'http://bot' })).status, 200, 'honeypot pretends success');
});
