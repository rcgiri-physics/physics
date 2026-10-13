// Vercel Web Analytics (cookie-free). Page views are counted automatically; the events below
// add what a page view can't say: which chapter, grade and topic area is being studied,
// finished quizzes, and what students search for. Results: Vercel dashboard → Analytics.
// Each page says what it is through data-* attributes on <body>, written by build.py.
(function () {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

  // Shared helper, also used by quiz.js and search.js. Never throws.
  window.pdTrack = function (name, data) {
    try {
      if (local) { console.debug('[analytics]', name, data); return; }
      window.va('event', { name: name, data: data || {} });
    } catch (e) { /* analytics must never break the page */ }
  };

  if (!local) {
    const s = document.createElement('script');
    s.src = '/_vercel/insights/script.js';
    s.defer = true;
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const d = document.body.dataset;
    if (d.kind) {
      window.pdTrack('Study', { kind: d.kind, grade: d.grade || '', chapter: d.chapter || '', area: d.area || '' });
    }
  });
})();
