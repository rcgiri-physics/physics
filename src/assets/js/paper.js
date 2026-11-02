// Model papers: a timed "exam mode" (answers hidden, countdown, ads and tab bar hidden), a show/hide-all
// toggle for the solutions, and clickable options for Group A multiple-choice questions.
(function () {
  const bar = document.querySelector('.exam-bar');
  const body = document.querySelector('.paper-body');
  if (!bar || !body) return;
  const key = 'pd-exam:' + location.pathname;
  const minutes = +bar.dataset.minutes || 180;
  const timerEl = bar.querySelector('.exam-timer');
  const startBtn = bar.querySelector('[data-exam="start"]');
  const stopBtn = bar.querySelector('[data-exam="stop"]');
  const toggleBtn = bar.querySelector('[data-exam="toggle"]');
  const solutions = () => [...body.querySelectorAll('details.solution')];
  let tick = null;

  const read = () => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
  const write = v => { try { v ? localStorage.setItem(key, JSON.stringify(v)) : localStorage.removeItem(key); } catch (e) { /* ignore */ } };
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600);
    return `${h ? h + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };

  function setRunning(on) {
    document.body.classList.toggle('focus-mode', on);
    startBtn.hidden = on;
    stopBtn.hidden = !on;
    toggleBtn.disabled = on;
    timerEl.hidden = !on;
  }

  function run(exam) {
    setRunning(true);
    solutions().forEach(d => { d.open = false; });
    const update = () => {
      const left = exam.endsAt - Date.now();
      timerEl.textContent = '⏱ ' + fmt(left) + ' left';
      if (left <= 0) finish(true);
    };
    update();
    clearInterval(tick);
    tick = setInterval(update, 1000);
  }

  function finish(timeUp) {
    const exam = read();
    clearInterval(tick);
    write(null);
    setRunning(false);
    body.querySelectorAll('.pq-item.mcq').forEach(revealMcq);
    if (exam) {
      const used = Math.min(Date.now(), exam.endsAt) - exam.startedAt;
      window.pdToast && window.pdToast((timeUp ? 'Time is up! ' : 'Finished. ') + 'Time used: ' + fmt(used));
      window.pdTrack && window.pdTrack('Paper attempt', { paper: location.pathname, minutes: Math.round(used / 60000) });
    }
  }

  startBtn.addEventListener('click', () => {
    if (!confirm(`Start a ${minutes}-minute timed attempt? All answers will be hidden until you finish.`)) return;
    const exam = { startedAt: Date.now(), endsAt: Date.now() + minutes * 60000 };
    write(exam);
    run(exam);
    window.scrollTo({ top: bar.offsetTop - 80, behavior: 'smooth' });
  });
  stopBtn.addEventListener('click', () => { if (confirm('Finish the attempt and show the answers?')) finish(false); });
  toggleBtn.addEventListener('click', () => {
    const open = !solutions().every(d => d.open);
    solutions().forEach(d => { d.open = open; });
    toggleBtn.textContent = open ? 'Hide all answers' : 'Show all answers';
  });

  // Group A answers arrive scrambled (data-k): fill in the hidden answer boxes now.
  const keys = new Map();
  body.querySelectorAll('.pq-item.mcq[data-k]').forEach(item => {
    const k = (window.pdUnlock && window.pdUnlock(item.dataset.id, item.dataset.k)) || { a: -1, s: '' };
    keys.set(item, k);
    const box = item.querySelector('[data-fill]');
    if (box) box.innerHTML = k.s;   // built by build.py from the paper file (content-only HTML, already validated)
  });

  // Group A multiple choice: tap an option. In exam mode the choice is only marked; otherwise it is checked at once.
  function revealMcq(item) {
    const chosen = [...item.querySelectorAll('.option')].findIndex(b => b.classList.contains('selected'));
    if (chosen < 0) return;
    const answer = (keys.get(item) || { a: -1 }).a;
    item.querySelectorAll('.option').forEach((b, i) => {
      b.classList.toggle('correct', i === answer);
      b.classList.toggle('wrong', i === chosen && i !== answer);
      b.classList.remove('selected');
      b.disabled = true;
    });
  }
  body.addEventListener('click', e => {
    const btn = e.target.closest('.pq-item.mcq .option');
    if (!btn || btn.disabled) return;
    const item = btn.closest('.pq-item');
    item.querySelectorAll('.option').forEach(b => { b.classList.toggle('selected', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    if (!document.body.classList.contains('focus-mode')) {
      revealMcq(item);
      const sol = item.querySelector('details.solution');
      if (sol) sol.open = true;
    }
  });
  // No peeking at answers while the clock runs.
  body.addEventListener('click', e => {
    if (document.body.classList.contains('focus-mode') && e.target.closest('details.solution > summary')) e.preventDefault();
  }, true);

  const saved = read();
  if (saved && saved.endsAt > Date.now()) run(saved); else if (saved) write(null);
})();
