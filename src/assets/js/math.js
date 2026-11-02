// Maths: \( inline \) and \[ display \] inside any [data-math] block (notes, quizzes, papers, labs).
// KaTeX is only downloaded when the page actually contains maths, and is pinned with Subresource
// Integrity: the browser refuses the files if the CDN ever serves anything else.
(function () {
  const blocks = [...document.querySelectorAll('[data-math]')].filter(el => /\\\(|\\\[/.test(el.textContent));
  if (!blocks.length) return;
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
    .then(() => blocks.forEach(el => window.renderMathInElement(el, {
      delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
      throwOnError: false
    })))
    .catch(() => { /* offline: the raw LaTeX stays readable */ });
})();
