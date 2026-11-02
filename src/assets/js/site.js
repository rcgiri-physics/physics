// Shared behaviour for every page: theme switch, share / print / report tools, remembering what the
// student studied (for "Continue where you left off" and chapter scores), click-to-load videos,
// the contact form and the offline service worker. No inline scripts anywhere (Content-Security-Policy).
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  window.pdStore = store;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  window.pdToast = toast;

  // ---------- Theme ----------
  const themeBtn = $('.theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('pd-theme', root.dataset.theme); } catch (e) { /* ignore */ }
    });
  }

  // ---------- Remember what was studied ----------
  const d = document.body.dataset;
  const h1 = $('h1');
  if (d.kind && h1) {
    const recent = store.get('pd-recent', []).filter(r => r.url !== location.pathname);
    recent.unshift({ url: location.pathname, title: h1.textContent.trim(), kind: d.kind, grade: d.grade || '', at: Date.now() });
    store.set('pd-recent', recent.slice(0, 8));
  }

  // Chapter scores on grade pages and cards: pd-progress[slug] = {correct, total, answered, at}
  const progress = store.get('pd-progress', {});
  $$('[data-slug]').forEach(el => {
    const p = progress[el.dataset.slug];
    if (!p || !p.answered) return;
    const tag = document.createElement('span');
    tag.className = el.classList.contains('card') ? 'badge score score-tag' : 'progress-tag';
    tag.textContent = p.answered >= p.total ? `${p.correct}/${p.total}` : `${p.answered}/${p.total} done`;
    tag.title = 'Your score on this device';
    el.appendChild(tag);
  });

  // ---------- Share / print ----------
  function shareSheet(url, title) {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    const text = encodeURIComponent(title + ' ' + url);
    dlg.innerHTML = `<div class="sheet-inner"><h2>Share this page</h2>
      <div class="share-grid">
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${text}">WhatsApp</a>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="viber://forward?text=${text}">Viber</a>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>
        <button class="btn btn-ghost" type="button" data-copy>Copy link</button>
      </div>
      <div class="sheet-actions"><button class="btn" type="button" data-close>Done</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', e => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
      if (e.target.closest('[data-copy]')) {
        navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url));
      }
    });
    dlg.showModal();
  }

  document.addEventListener('click', e => {
    const share = e.target.closest('[data-share]');
    if (share) {
      const url = location.href.split('#')[0];
      const title = document.title;
      if (navigator.share) navigator.share({ title, url }).catch(() => {});
      else shareSheet(url, title);
      window.pdTrack && window.pdTrack('Share', { page: location.pathname });
    }
    if (e.target.closest('[data-print]')) window.print();
    const rep = e.target.closest('[data-report]');
    if (rep) reportDialog(rep.dataset.report || '');
    const poster = e.target.closest('.video-poster');
    if (poster && !e.ctrlKey && !e.metaKey) {
      // Load YouTube only when asked (privacy-enhanced domain, no cookies until play).
      e.preventDefault();
      const id = poster.parentElement.dataset.video;
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      f.title = 'Video lesson';
      f.allow = 'autoplay; encrypted-media; picture-in-picture';
      f.allowFullscreen = true;
      f.loading = 'lazy';
      poster.replaceWith(f);
    }
  });

  // Open every hidden solution while printing, so printed notes and papers include the answers.
  let reopened = [];
  addEventListener('beforeprint', () => { reopened = $$('details:not([open])'); reopened.forEach(x => { x.open = true; }); });
  addEventListener('afterprint', () => { reopened.forEach(x => { x.open = false; }); reopened = []; });

  // ---------- Report a mistake ----------
  function reportDialog(item) {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = `<form class="sheet-inner" method="dialog">
      <h2>Report a mistake</h2>
      <p class="muted">${item ? 'About <b></b>. ' : ''}Tell us what is wrong (a wrong answer, a typo, an unclear explanation). Thank you!</p>
      <label class="sr-only" for="rep-msg">What is wrong?</label>
      <textarea id="rep-msg" rows="5" required minlength="5" maxlength="2000" placeholder="e.g. The answer should be B because…"></textarea>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="form-status" role="status" aria-live="polite"></p>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn" value="send">Send report</button></div>
    </form>`;
    if (item) dlg.querySelector('b').textContent = item;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    const form = dlg.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = form.querySelector('textarea').value.trim();
      const status = form.querySelector('.form-status');
      if (msg.length < 5) { status.textContent = 'Please write a few words.'; return; }
      const btn = form.querySelector('[value="send"]');
      btn.disabled = true;
      const ok = await post('/api/report', { page: location.pathname, title: document.title, item, message: msg, website: form.website.value });
      btn.disabled = false;
      if (ok) { dlg.close(); toast('Thanks! Your report was sent.'); }
      else { status.className = 'form-status err'; status.textContent = 'Could not send right now. Please try again later or use the Contact page.'; }
    });
    dlg.showModal();
  }
  window.pdReport = reportDialog;

  async function post(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return r.ok;
    } catch (e) { return false; }
  }

  // ---------- Contact form ----------
  const contact = $('form[data-contact]');
  if (contact) {
    const shownAt = Date.now();
    contact.addEventListener('submit', async e => {
      e.preventDefault();
      const status = $('.form-status', contact);
      const btn = $('button', contact);
      btn.disabled = true;
      const f = contact.elements;
      const ok = await post('/api/contact', { name: f.name.value, email: f.email.value, message: f.message.value, website: f.website.value, elapsed: Date.now() - shownAt });
      btn.disabled = false;
      status.className = 'form-status ' + (ok ? 'ok' : 'err');
      status.textContent = ok ? 'Thank you! Your message was sent.' : 'Sorry, the message could not be sent. Please try again later.';
      if (ok) contact.reset();
    });
  }

  // Wide tables and formulas scroll sideways on phones: make them reachable with the keyboard (WCAG 2.1.1).
  function markScrollers() {
    $$('.notes-body table, .notes-body .table-wrap, .notes-body .formula, .notes-body .katex-display').forEach(el => {
      const scrolls = el.scrollWidth > el.clientWidth + 1;
      if (scrolls && !el.hasAttribute('tabindex')) { el.tabIndex = 0; el.setAttribute('role', el.getAttribute('role') || 'region'); el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Scrollable content'); }
    });
  }
  addEventListener('load', markScrollers);
  setTimeout(markScrollers, 1500);   // after maths has rendered

  // ---------- Offline support ----------
  if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
