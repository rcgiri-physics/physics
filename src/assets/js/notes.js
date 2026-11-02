// Notes and lab pages: highlight the section being read in the "On this page" menu.
(function () {
  // On phones the menu starts closed so the lesson itself is on the first screen.
  const tocBox = document.querySelector('details.toc');
  if (tocBox && innerWidth < 1000) tocBox.open = false;
  const links = [...document.querySelectorAll('.toc a')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map(a => [decodeURIComponent(a.hash.slice(1)), a]));
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      links.forEach(a => a.classList.remove('active'));
      const a = byId.get(en.target.id);
      if (a) a.classList.add('active');
    });
  }, { rootMargin: '-80px 0px -70% 0px' });
  byId.forEach((_, id) => { const h = document.getElementById(id); if (h) io.observe(h); });
})();
