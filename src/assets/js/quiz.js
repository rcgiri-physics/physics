// Interactive MCQ quiz. The questions are already in the page HTML (rendered by build.py); this script
// adds answering, scoring, two modes, filters, shuffling, keyboard answers and remembering progress.
//   Practice: the answer and explanation show as soon as an option is chosen.
//   Test:     choose answers (changeable), a timer runs, ads and the tab bar hide; Submit reveals the score.
(function () {
  const quiz = document.querySelector('.quiz');
  if (!quiz) return;

  const slug = quiz.dataset.quiz;
  const list = quiz.querySelector('.questions');
  const items = [...list.querySelectorAll('.question')];
  const adRows = [...list.querySelectorAll('.ad-row')];
  const scoreEl = quiz.querySelector('.score');
  const timerEl = quiz.querySelector('.timer');
  const bar = quiz.querySelector('.progress span');
  const filter = quiz.querySelector('[data-filter]');
  const result = quiz.querySelector('.result');
  const submitBtn = quiz.querySelector('[data-action="submit"]');
  const total = items.length;
  const limitMs = (+quiz.dataset.minutes || total) * 60000;
  const key = 'pd-quiz-v3:' + slug;
  const canReport = !!document.querySelector('[data-report]');

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) { /* private mode */ } };
  let state = load(key, null);
  if (!state) {
    // v2 kept practice answers only (options are shown in a fixed shuffled order since 2026-10-07)
    state = { mode: 'practice', practice: load('pd-quiz-v2:' + slug, {}), test: null };
  }

  // Answers and explanations arrive scrambled (data-k, see unlock.js / build.py scramble()).
  const keys = new Map(items.map(li => [li, (window.pdUnlock && window.pdUnlock(slug + ':' + li.dataset.i, li.dataset.k)) || { a: -1, e: '' }]));
  items.forEach(li => {
    const e = keys.get(li).e;
    if (!e) return;
    const box = li.querySelector('.exp-text');
    box.append(Object.assign(document.createElement('strong'), { textContent: 'Explanation:' }), ' ' + e);
  });
  const answerOf = li => keys.get(li).a;
  const answers = () => state.mode === 'test' ? (state.test ? state.test.answers : {}) : state.practice;
  const revealed = () => state.mode === 'practice' || (state.test && state.test.submitted);
  const testRunning = () => state.mode === 'test' && state.test && !state.test.submitted;

  if (canReport) {
    items.forEach((li, n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'q-report';
      b.textContent = 'Report';
      b.addEventListener('click', () => window.pdReport && window.pdReport(`Question ${n + 1}: ${li.querySelector('.q-text').textContent.replace(/^\s*\d+\.\s*/, '').slice(0, 80)}`));
      li.querySelector('.explanation').prepend(b);
    });
  }

  function paintQuestion(li) {
    const chosen = answers()[li.dataset.i];
    const show = revealed() && chosen !== undefined;
    const answer = answerOf(li);
    li.querySelectorAll('.option').forEach((b, i) => {
      b.disabled = show;
      b.classList.toggle('selected', !show && i === chosen);
      b.classList.toggle('correct', show && i === answer);
      b.classList.toggle('wrong', show && i === chosen && i !== answer);
      b.setAttribute('aria-pressed', String(i === chosen));
    });
    const exp = li.querySelector('.explanation');
    const verdict = exp.querySelector('.verdict');
    exp.hidden = !show;
    if (show) {
      const right = chosen === answer;
      verdict.textContent = right ? '✓ Correct.' : `✗ Incorrect. The answer is ${'ABCDEFGH'[answer]}.`;
      verdict.className = 'verdict ' + (right ? 'good' : 'bad');
    }
    // In a submitted test, unanswered questions still show the right answer.
    if (state.mode === 'test' && state.test && state.test.submitted && chosen === undefined) {
      li.querySelectorAll('.option').forEach((b, i) => { b.disabled = true; b.classList.toggle('correct', i === answer); });
      exp.hidden = false;
      verdict.textContent = `Not answered. The answer is ${'ABCDEFGH'[answer]}.`;
      verdict.className = 'verdict bad';
    }
  }

  function counts() {
    const a = answers();
    const answered = items.filter(li => a[li.dataset.i] !== undefined).length;
    const correct = items.filter(li => a[li.dataset.i] === answerOf(li)).length;
    return { answered, correct };
  }

  function recordProgress(correct, answered) {
    const all = load('pd-progress', {});
    const prev = all[slug] || {};
    all[slug] = { correct, answered, total, best: Math.max(prev.best || 0, answered === total ? correct : 0), at: Date.now() };
    try { localStorage.setItem('pd-progress', JSON.stringify(all)); } catch (e) { /* ignore */ }
  }

  function paint() {
    items.forEach(paintQuestion);
    const { answered, correct } = counts();
    const test = state.mode === 'test';
    scoreEl.textContent = test && !revealed() ? `${answered}/${total} answered` : `${correct} correct · ${answered}/${total} answered`;
    bar.style.width = (100 * answered / total) + '%';
    quiz.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    quiz.querySelectorAll('[data-help]').forEach(p => { p.hidden = p.dataset.help !== state.mode; });
    submitBtn.hidden = !testRunning();
    timerEl.hidden = !test;
    document.body.classList.toggle('focus-mode', testRunning());
    const done = revealed() && (test ? state.test.submitted : answered === total);
    result.hidden = !done;
    if (done) {
      const pct = correct / total;
      result.querySelector('.big').textContent = `${correct} / ${total}`;
      const time = test ? ` Time taken: ${fmt(state.test.elapsedMs)}.` : '';
      result.querySelector('.msg').textContent = (pct >= 0.8 ? 'Excellent work!' : pct >= 0.5 ? 'Good effort. Review the ones you missed.'
        : 'Keep practising: read the explanations and try again.') + time;
    }
    applyFilter();
    tick();
  }

  function applyFilter() {
    const f = filter.value;
    const a = answers();
    items.forEach(li => {
      const chosen = a[li.dataset.i];
      li.hidden = !(f === 'all'
        || (f === 'unanswered' && chosen === undefined)
        || (f === 'wrong' && revealed() && chosen !== answerOf(li))
        || f === li.dataset.difficulty);
    });
    adRows.forEach(r => { r.hidden = f !== 'all'; });
  }

  // ---------- timer (test mode) ----------
  let timer = null;
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function elapsed() { return state.test ? state.test.elapsedMs + (testRunning() ? Date.now() - state.test.resumedAt : 0) : 0; }
  function tick() {
    if (!(state.mode === 'test' && state.test)) { clearInterval(timer); timer = null; return; }
    const ms = elapsed();
    timerEl.textContent = state.test.submitted ? `⏱ ${fmt(state.test.elapsedMs)}` : `⏱ ${fmt(ms)} / ${fmt(limitMs)}`;
    timerEl.classList.toggle('over', ms > limitMs);
    if (testRunning() && !timer) timer = setInterval(tick, 1000);
    if (!testRunning() && timer) { clearInterval(timer); timer = null; }
  }
  function pauseClock() { if (testRunning()) { state.test.elapsedMs = elapsed(); state.test.resumedAt = Date.now(); } }
  addEventListener('pagehide', () => { pauseClock(); save(); });
  document.addEventListener('visibilitychange', () => {
    if (!testRunning()) return;
    if (document.hidden) { state.test.elapsedMs = elapsed(); state.test.pausedAt = Date.now(); save(); }
    else { state.test.resumedAt = Date.now(); }
  });

  function startTest() {
    state.test = { answers: {}, elapsedMs: 0, resumedAt: Date.now(), submitted: false };
  }

  function submit() {
    const { answered, correct } = counts();
    if (answered < total && !confirm(`You have answered ${answered} of ${total}. Submit anyway?`)) return;
    pauseClock();
    state.test.submitted = true;
    save();
    recordProgress(correct, answered);
    paint();
    result.scrollIntoView({ behavior: 'smooth', block: 'center' });
    track(correct);
  }

  function track(correct) {
    if (!window.pdTrack) return;
    const pct = Math.round(100 * correct / total);
    window.pdTrack('Quiz finished', { chapter: document.body.dataset.chapter || '', mode: state.mode,
      score: pct >= 80 ? '80-100%' : pct >= 50 ? '50-79%' : '0-49%' });
  }

  // ---------- events ----------
  list.addEventListener('click', e => {
    const btn = e.target.closest('.option');
    if (!btn || btn.disabled) return;
    const li = btn.closest('.question');
    const chosen = [...li.querySelectorAll('.option')].indexOf(btn);
    if (state.mode === 'test') {
      if (!state.test || state.test.submitted) startTest();
      state.test.answers[li.dataset.i] = chosen;
      pauseClock();
    } else {
      state.practice[li.dataset.i] = chosen;
      const { answered, correct } = counts();
      recordProgress(correct, answered);
      if (answered === total) track(correct);
    }
    save();
    paint();
  });

  // Keyboard: with focus inside a question, press A–F or 1–6 to answer.
  list.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const li = e.target.closest && e.target.closest('.question');
    if (!li) return;
    const k = e.key.toLowerCase();
    const n = '123456'.indexOf(k) >= 0 ? '123456'.indexOf(k) : 'abcdef'.indexOf(k);
    const opt = li.querySelectorAll('.option')[n];
    if (n >= 0 && opt && !opt.disabled) { e.preventDefault(); opt.click(); opt.focus(); }
  });

  quiz.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === state.mode) return;
    pauseClock();
    state.mode = b.dataset.mode;
    if (state.mode === 'test') {
      if (!state.test || state.test.submitted) startTest();
      else state.test.resumedAt = Date.now();
    }
    save();
    paint();
  }));

  submitBtn.addEventListener('click', submit);
  filter.addEventListener('change', applyFilter);

  quiz.querySelectorAll('[data-action="reset"]').forEach(btn => btn.addEventListener('click', () => {
    const { answered } = counts();
    if (answered && !confirm('Clear your answers and start again?')) return;
    if (state.mode === 'test') startTest(); else state.practice = {};
    filter.value = 'all';
    save();
    paint();
    quiz.scrollIntoView({ behavior: 'smooth' });
  }));

  quiz.querySelector('[data-action="review"]').addEventListener('click', () => {
    filter.value = 'wrong';
    applyFilter();
    quiz.scrollIntoView({ behavior: 'smooth' });
  });

  quiz.querySelector('[data-action="shuffle"]').addEventListener('click', () => {
    const order = items.slice();
    for (let i = order.length - 1; i > 0; i--) {  // Fisher–Yates: every order equally likely
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((li, n) => { li.querySelector('.q-num').textContent = (n + 1) + '.'; list.appendChild(li); });
    adRows.forEach(r => { const after = list.querySelectorAll('.question')[14]; if (after) after.after(r); });
  });

  if (testRunning()) state.test.resumedAt = Date.now();  // time while the page was closed doesn't count
  paint();
})();
