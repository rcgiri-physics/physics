// Student-friendly ads. build.py places a few labelled <aside class="ad-slot"> between sections (never
// inside a question, never during a timed test). This script fills each slot only when it scrolls near:
//   1. Google AdSense, when src/settings.json has ads.adsense_client and a slot ID for that position;
//   2. otherwise (or when AdSense has nothing to show, or is blocked) a "house ad" from settings.json,
//      e.g. the YouTube channel or MCQplex, picked by weight so each visit sees a different one.
// The AdSense script itself is only downloaded after the student first interacts with the page or after
// a few idle seconds, so it never slows down the first view of a lesson.
(async function () {
  const slots = [...document.querySelectorAll('.ad-slot[data-ad]')];
  let cfg;
  try { cfg = await (await fetch('/assets/ads-config.json')).json(); } catch (e) { cfg = { house: [] }; }
  const client = cfg.client || '';
  const house = (cfg.house || []).slice();
  const used = new Set();

  let sdk = null;
  function loadSdk() {
    if (sdk) return sdk;
    sdk = new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
      s.onload = ok;
      s.onerror = fail;   // ad blocker or offline: house ads instead
      document.head.appendChild(s);
    });
    return sdk;
  }
  // Wait for a first interaction (or 4 s), so ads never compete with the lesson for bandwidth.
  const ready = new Promise(ok => {
    const go = () => { ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach(ev => removeEventListener(ev, go)); ok(); };
    ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, go, { once: true, passive: true }));
    setTimeout(go, 4000);
  });
  if (client && cfg.auto) ready.then(loadSdk).catch(() => {});

  function pickHouse() {
    const pool = house.filter(h => !used.has(h.id)).length ? house.filter(h => !used.has(h.id)) : house;
    if (!pool.length) return null;
    let r = Math.random() * pool.reduce((t, h) => t + (h.weight || 1), 0);
    for (const h of pool) { r -= h.weight || 1; if (r <= 0) return h; }
    return pool[0];
  }

  function showHouse(slot) {
    const h = pickHouse();
    slot.querySelectorAll('ins, .house-ad').forEach(x => x.remove());
    if (!h) { slot.dataset.state = 'empty'; return; }
    used.add(h.id);
    const a = document.createElement('a');
    a.className = 'house-ad';
    a.href = h.url;
    a.target = '_blank';
    a.rel = 'noopener sponsored';
    a.innerHTML = '<div><strong></strong><span></span></div><span class="btn btn-ghost"></span>';
    a.querySelector('strong').textContent = h.title;
    a.querySelector('div span').textContent = h.text || '';
    a.querySelector('.btn').textContent = h.cta || 'Open';
    a.addEventListener('click', () => window.pdTrack && window.pdTrack('House ad', { id: h.id }));
    slot.appendChild(a);
    slot.querySelector('.ad-label').textContent = 'Recommended';
    slot.dataset.state = 'house';
  }

  async function fill(slot) {
    if (document.body.classList.contains('focus-mode')) return;
    const id = (cfg.slots || {})[slot.dataset.ad];
    if (!client || !id) { showHouse(slot); return; }
    slot.dataset.state = 'loading';
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.dataset.adClient = client;
    ins.dataset.adSlot = id;
    ins.dataset.adFormat = slot.dataset.ad === 'in_article' ? 'fluid' : 'auto';
    if (slot.dataset.ad === 'in_article') ins.dataset.adLayout = 'in-article';
    ins.dataset.fullWidthResponsive = 'true';
    slot.appendChild(ins);
    try {
      await ready;
      await loadSdk();
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      // AdSense marks a slot it could not fill; give it a moment, then fall back.
      const check = last => {
        if (ins.dataset.adStatus === 'unfilled') showHouse(slot);
        else if (ins.dataset.adStatus === 'filled') slot.dataset.state = 'ad';
        else if (last) slot.dataset.state = 'ad';   // still loading on a slow connection: leave it
        else setTimeout(() => check(true), 8000);
      };
      setTimeout(() => check(false), 4000);
    } catch (e) {
      showHouse(slot);
    }
  }

  if (!('IntersectionObserver' in window)) { slots.forEach(fill); return; }
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { io.unobserve(en.target); fill(en.target); }
  }), { rootMargin: '600px 0px' });
  slots.forEach(s => io.observe(s));
})();
