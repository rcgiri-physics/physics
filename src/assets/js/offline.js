// Offline page: list the lessons this device has saved (by the service worker), so they can be opened without internet.
(async function () {
  const box = document.querySelector('[data-offline-list]');
  if (!box || !('caches' in window)) return;
  const rows = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith('pd-pages')) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const url = new URL(req.url);
      if (!/^\/(posts|papers|labs|pages)\//.test(url.pathname)) continue;
      const res = await cache.match(req);
      const html = res ? await res.text() : '';
      const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || url.pathname;
      rows.push({ url: url.pathname, title: title.replace(/<[^>]+>/g, '').trim() });
    }
  }
  box.textContent = '';
  if (!rows.length) { box.innerHTML = '<p class="empty">No saved pages yet. Pages you open while online are saved automatically.</p>'; return; }
  rows.sort((a, b) => a.title.localeCompare(b.title)).forEach(r => {
    const art = document.createElement('article');
    art.className = 'card';
    art.innerHTML = '<h3><a></a></h3>';
    const a = art.querySelector('a');
    a.href = r.url;
    a.textContent = r.title;
    box.appendChild(art);
  });
})();
