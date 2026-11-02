// Admin authentication with Web Crypto only (no dependencies), modelled on Ruru Gaushala's hand-rolled
// auth: PBKDF2 password hashes, an HMAC-signed session cookie, optional TOTP two-factor codes, and
// login throttling (see db.js). Accounts live in the ADMIN_USERS secret, so there is no user database:
//
//   ADMIN_USERS = [{"username":"richesh","name":"Richesh Sharma","role":"admin",
//                   "password":"pbkdf2-sha256$100000$<salt>$<hash>","totp":"<base32, optional>"}]
//
// Create an entry with:  node scripts/admin-user.mjs <username> "<Full name>" [admin|editor]
// Roles: admin = everything; editor = create and edit content (no deletes, settings or pages).

const enc = new TextEncoder();
export const COOKIE = '__Host-pd_admin';
const SESSION_HOURS = 12;
export const PBKDF2_ITERATIONS = 100000;   // the most Cloudflare Workers allow

export function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

/** Constant-time comparison of two byte arrays or strings. */
export function safeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iters, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2-sha256' || !iters || !salt || !hash) return false;
  const got = await pbkdf2(password, fromB64url(salt), Math.min(+iters, PBKDF2_ITERATIONS));
  return safeEqual(got, fromB64url(hash));
}

// A password that is checked when the username doesn't exist, so a wrong username takes as long as a wrong password.
const DUMMY = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function loadUsers(env) {
  try {
    const list = JSON.parse(env.ADMIN_USERS || '[]');
    return Array.isArray(list) ? list.filter(u => u && u.username && u.password) : [];
  } catch (e) {
    return [];
  }
}

export async function checkLogin(env, username, password, code) {
  const user = loadUsers(env).find(u => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
  const ok = await verifyPassword(String(password || ''), user ? user.password : DUMMY);
  if (!user || !ok) return { ok: false, reason: 'Wrong username or password.' };
  if (user.totp) {
    if (!code) return { ok: false, needCode: true, reason: 'Enter the 6-digit code from your authenticator app.' };
    if (!(await verifyTotp(user.totp, String(code)))) return { ok: false, needCode: true, reason: 'That code is not right. Codes change every 30 seconds.' };
  }
  return { ok: true, user };
}

// ---------- sessions ----------

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function requireSecret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  return env.SESSION_SECRET;
}

/** The session is tied to the password hash: changing a password signs that person out everywhere. */
export async function createSession(env, user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ u: user.username, iat: now, exp: now + SESSION_HOURS * 3600, pv: user.password.slice(-12) })));
  const sig = b64url(await hmac(requireSecret(env), payload));
  return `${payload}.${sig}`;
}

export async function readSession(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE.replace(/[-]/g, '\\-')}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  let expected;
  try { expected = b64url(await hmac(requireSecret(env), payload)); } catch (e) { return null; }
  if (!safeEqual(expected, sig)) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch (e) { return null; }
  if (!data || data.exp < Date.now() / 1000) return null;
  const user = loadUsers(env).find(u => u.username === data.u);
  if (!user || user.password.slice(-12) !== data.pv) return null;
  return { username: user.username, name: user.name || user.username, role: user.role === 'admin' ? 'admin' : 'editor' };
}

export function sessionCookie(value, maxAge = SESSION_HOURS * 3600) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// ---------- TOTP (RFC 6238: SHA-1, 30 s, 6 digits, ±1 step for clock drift) ----------

export function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export async function totp(secret, step) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) { msg[i] = n & 255; n = Math.floor(n / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, '0');
}

export async function verifyTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(code.trim())) return false;
  const step = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) if (safeEqual(await totp(secret, step + d), code.trim())) return true;
  return false;
}

/** A short, one-way, daily-rotating hash of the visitor's IP, used only for rate limits. */
export async function visitorKey(env, request, salt = '') {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local';
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${ip}|${day}|${salt}|${env.SESSION_SECRET || ''}`));
  return b64url(new Uint8Array(digest)).slice(0, 22);
}
