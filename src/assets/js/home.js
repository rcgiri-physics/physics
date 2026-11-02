// Home page: "Continue where you left off", from the pages this device opened recently (site.js keeps the list).
(function () {
  const box = document.getElementById('continue');
  if (!box || !window.pdStore) return;
  const recent = window.pdStore.get('pd-recent', []).slice(0, 3);
  if (!recent.length) return;
  const progress = window.pdStore.get('pd-progress', {});
  const label = { notes: 'Notes', mcq: 'MCQs', paper: 'Model paper', lab: 'Lab' };
  const icons = { notes: 'book', mcq: 'check', paper: 'file', lab: 'flask' };
  const sprite = document.querySelector('use')?.getAttribute('href')?.split('#')[0] || '/assets/icons.svg';
  const grid = box.querySelector('[data-continue]');
  for (const r of recent) {
    const slug = r.url.split('/').pop();
    const p = progress[slug];
    const art = document.createElement('article');
    art.className = 'card kind-' + r.kind;
    art.innerHTML = `<div class="card-top"><span class="kind-ico"><svg class="icon" aria-hidden="true"><use href="${sprite}#${icons[r.kind] || 'book'}"></use></svg></span><span class="badge ${r.kind}"></span></div>
      <h3><a></a></h3><div class="meta"></div>`;
    art.querySelector('.badge').textContent = label[r.kind] || '';
    const a = art.querySelector('h3 a');
    a.href = r.url;
    a.textContent = r.title;
    art.querySelector('.meta').textContent = (r.grade ? 'Grade ' + r.grade + ' · ' : '') +
      (p && p.answered ? `${p.answered}/${p.total} answered` : 'Opened ' + new Date(r.at).toLocaleDateString());
    grid.appendChild(art);
  }
  box.hidden = false;
})();
