// Privacy-friendly analytics, no cookies:
//  - Page views: Cloudflare Web Analytics (its beacon is added by build.py when settings.json has a
//    token, or by Cloudflare automatically when Web Analytics is switched on for the site).
//  - Study events: what a page view can't say (which chapter and topic area is studied, finished quizzes,
//    what students search for). They are counted, anonymously, by the site's own /api/event endpoint
//    (worker/), and shown in /admin → Insights. Locally they are printed to the console instead.
// Each page says what it is through data-* attributes on <body>, written by build.py.
(function () {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // Shared helper, also used by quiz.js, paper.js, search.js and ads.js. Never throws.
  window.pdTrack = function (name, data) {
    try {
      if (local) { console.debug('[analytics]', name, data); return; }
      const body = JSON.stringify({ name: name, data: data || {}, path: location.pathname });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }));
      else fetch('/api/event', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {});
    } catch (e) { /* analytics must never break the page */ }
  };

  document.addEventListener('DOMContentLoaded', function () {
    const d = document.body.dataset;
    if (d.kind) {
      window.pdTrack('Study', { kind: d.kind, grade: d.grade || '', chapter: d.chapter || '', area: d.area || '' });
    }
  });
})();
