// Notes pages: highlight the current section in the table of contents and render LaTeX with KaTeX.
(function () {
  // Table of contents (built by build.py) — highlight the section being read.
  const links = [...document.querySelectorAll('.toc a')];
  if (links.length && 'IntersectionObserver' in window) {
    const byId = new Map(links.map(a => [a.hash.slice(1), a]));
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        links.forEach(a => a.classList.remove('active'));
        const a = byId.get(en.target.id);
        if (a) a.classList.add('active');
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    byId.forEach((_, id) => { const h = document.getElementById(id); if (h) io.observe(h); });
  }

  // Maths: \( inline \) and \[ display \] — KaTeX is only downloaded when the page contains maths.
  const notes = document.querySelector('.notes-body');
  if (!notes || !/\\\(|\\\[/.test(notes.textContent)) return;
  // Pinned version + Subresource Integrity: the browser refuses the files if the CDN ever serves anything else.
  const base = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = base + 'katex.min.css';
  css.integrity = 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+';
  css.crossOrigin = 'anonymous';
  document.head.appendChild(css);
  const load = (src, hash) => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = hash; s.crossOrigin = 'anonymous';
    s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  load(base + 'katex.min.js', 'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg')
    .then(() => load(base + 'contrib/auto-render.min.js', 'sha384-43gviWU0YVjaDtb/GhzOouOXtZMP/7XUzwPTstBeZFe/+rCMvRwr4yROQP43s0Xk'))
    .then(() => window.renderMathInElement(notes, {
      delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
      throwOnError: false
    }))
    .catch(() => { /* offline: the raw LaTeX stays readable */ });
})();
