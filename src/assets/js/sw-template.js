// Service worker (build.py fills in VERSION and CORE and writes it to /sw.js).
// Pages a student opens are saved, so they open again without internet; the newest version is always
// fetched first when online. Admin pages, the API and ads are never cached.
const VERSION = '__VERSION__';
const CORE = __CORE__;
const CORE_CACHE = 'pd-core-' + VERSION;
const PAGES = 'pd-pages-v1';
const ASSETS = 'pd-assets-v1';
const MAX_PAGES = 80;
const MAX_ASSETS = 120;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CORE_CACHE)
    .then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pd-core-') && k !== CORE_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function page(request) {
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(PAGES).then(c => c.put(key, copy)).then(() => trim(PAGES, MAX_PAGES));
    }
    return res;
  } catch (e) {
    return (await caches.match(key)) || (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match('/offline')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function asset(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
    const copy = res.clone();
    caches.open(ASSETS).then(c => c.put(request, copy)).then(() => trim(ASSETS, MAX_ASSETS));
  }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname === '/sw.js') return;
    if (req.mode === 'navigate') { event.respondWith(page(req)); return; }
    if (url.pathname.startsWith('/assets/') && !url.pathname.endsWith('.json')) { event.respondWith(asset(req)); return; }
    return;
  }
  // KaTeX (pinned version, so it never changes) is kept for offline maths.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/katex@')) event.respondWith(asset(req));
});
