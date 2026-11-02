// Physics Decoded admin: a small single-page app (no framework, no build step).
// Every save is a commit to GitHub through the Worker (/api/admin/*); Cloudflare then rebuilds the site.
// Editors validate with the same rules as the Worker and build.py (shared/validate.js), keep an
// automatic draft in this browser, and can ask the AI (llm-free-cascade) for help.
import {
  validateMcqSet, validatePaper, validateLab, validateNotes, validatePage, validateSettings, validateQuestions,
  slugify, parseFrontMatter, buildFrontMatter,
} from './shared/validate.js';
import { parseQuestions } from './shared/parse.js';

const app = document.getElementById('app');
const S = { me: null, syllabus: null, lists: {} };
const today = () => new Date().toISOString().slice(0, 10);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- helpers

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

function toast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-PD-Admin': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) { location.href = '/admin/login?next=' + encodeURIComponent('/admin/' + location.hash); throw new Error('signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; e.problems = data.problems; throw e; }
  return data;
}

/** Text input bound to obj[key]. */
function bind(obj, key, { type = 'text', rows, placeholder, onchange, cls = 'in', list, transform } = {}) {
  const get = () => (obj[key] === undefined || obj[key] === null ? '' : (list ? obj[key].join('\n') : obj[key]));
  const el = rows ? h('textarea', { class: cls, rows, placeholder }) : h('input', { class: cls, type, placeholder });
  el.value = get();
  el.addEventListener('input', () => {
    let v = el.value;
    if (list) v = v.split('\n').map(s => s.trim()).filter(Boolean);
    else if (type === 'number') v = v === '' ? undefined : Number(v);
    if (transform) v = transform(v);
    if (v === '' || v === undefined || (Array.isArray(v) && !v.length)) delete obj[key]; else obj[key] = v;
    onchange && onchange();
  });
  return el;
}
const field = (label, input, hint, wide) => h('label', { class: 'f' + (wide ? ' wide' : '') }, h('span', null, label, hint ? h('small', null, ' ', hint) : null), input);

function select(options, value, onchange) {
  const el = h('select', { class: 'in' }, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value === undefined ? '' : value;
  el.addEventListener('change', () => onchange(el.value));
  return el;
}

function dialog(title, body, actions) {
  const d = h('dialog', { class: 'a-dialog' }, h('div', { class: 'inner' }, h('h2', null, title), body, h('div', { class: 'actions' }, actions)));
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

function problemsBox(list) {
  if (!list || !list.length) return h('div', { class: 'problems ok' }, '✓ Ready to publish: no problems found.');
  return h('div', { class: 'problems', role: 'alert' }, h('strong', null, `${list.length} thing${list.length === 1 ? '' : 's'} to fix before publishing`), h('ul', null, list.slice(0, 40).map(p => h('li', null, p))));
}

function setNav() {
  const route = location.hash.split('?')[0];
  document.querySelectorAll('.a-nav a').forEach(a => {
    const href = a.getAttribute('href');
    a.toggleAttribute('aria-current', href === '#/' ? route === '#/' || route === '' : route.startsWith(href.replace(/\/$/, '')));
    if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  });
}

function chaptersOf(grade) { return S.syllabus && S.syllabus.grades[grade] ? S.syllabus.grades[grade].chapters : []; }

/** Grade select + chapter chips bound to obj.grade / obj.chapters. */
function gradeChapters(obj, onchange, { required = true } = {}) {
  const wrap = h('div', { class: 'f wide' });
  const draw = () => {
    wrap.replaceChildren(
      h('span', null, 'Grade and chapter', h('small', null, required ? ' (choose one or more chapters)' : ' (optional: links the page to its chapters)')),
      select([['XI', 'Grade XI'], ['XII', 'Grade XII']], obj.grade, v => { obj.grade = v; obj.chapters = []; draw(); onchange(); }),
      h('div', { class: 'chips' }, chaptersOf(obj.grade).map(c => h('button', {
        type: 'button', class: 'chip-toggle', 'aria-pressed': String((obj.chapters || []).includes(c.n)),
        onclick: () => {
          const set = new Set(obj.chapters || []);
          set.has(c.n) ? set.delete(c.n) : set.add(c.n);
          obj.chapters = [...set].sort((a, b) => a - b);
          draw(); onchange();
        },
      }, `${c.n}. ${c.title}`))),
    );
  };
  draw();
  return wrap;
}

// Drafts: every editor saves its work in this browser as you type, so nothing is lost on a phone.
const draftKey = path => 'pd-admin-draft:' + path;
const saveDraft = (path, data) => { try { localStorage.setItem(draftKey(path), JSON.stringify({ at: Date.now(), data })); } catch (e) { /* full */ } };
const readDraft = path => { try { return JSON.parse(localStorage.getItem(draftKey(path))); } catch (e) { return null; } };
const dropDraft = path => { try { localStorage.removeItem(draftKey(path)); } catch (e) { /* ignore */ } };

// Images: shrunk in the browser (max 1400 px, WebP) before upload, so uploads stay small on mobile data.
async function uploadImage(baseName) {
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  const file = await new Promise(resolve => { input.addEventListener('change', () => resolve(input.files[0])); input.click(); });
  if (!file) return null;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / img.width);
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.86));
  const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const name = `${slugify(baseName || file.name.replace(/\.[a-z]+$/i, ''))}-${Date.now().toString(36).slice(-4)}.webp`;
  toast('Uploading image…');
  const r = await api('/api/admin/upload', { method: 'POST', body: { name, data } });
  toast('Image uploaded. It appears on the site after the next rebuild.');
  return r.url;
}

async function ai(task, params, button) {
  if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = 'Thinking…'; }
  try {
    const r = await api('/api/admin/ai', { method: 'POST', body: { task, params } });
    return r;
  } finally {
    if (button) { button.disabled = false; button.textContent = button.dataset.label; }
  }
}

// KaTeX for previews (same pinned files and integrity hashes as the site).
let katexReady = null;
function renderMath(el) {
  if (!/\\\(|\\\[/.test(el.textContent)) return;
  if (!katexReady) {
    const base = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
    document.head.append(h('link', { rel: 'stylesheet', href: base + 'katex.min.css', integrity: 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+', crossorigin: 'anonymous' }));
    const load = (src, integrity) => new Promise((ok, fail) => document.head.append(h('script', { src, integrity, crossorigin: 'anonymous', onload: ok, onerror: fail })));
    katexReady = load(base + 'katex.min.js', 'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg')
      .then(() => load(base + 'contrib/auto-render.min.js', 'sha384-43gviWU0YVjaDtb/GhzOouOXtZMP/7XUzwPTstBeZFe/+rCMvRwr4yROQP43s0Xk'));
  }
  katexReady.then(() => window.renderMathInElement(el, { delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false })).catch(() => {});
}

/** Shared editor frame: title bar with Publish, problems box, and the save logic. */
function editorFrame({ title, path, isNew, getContent, validate, liveUrl, onSaved }) {
  const state = { sha: null, path };
  const problems = h('div');
  const msg = h('input', { class: 'in', placeholder: 'What changed? (optional, saved in the history)' });
  const publishBtn = h('button', { class: 'btn', type: 'button' }, isNew ? 'Publish' : 'Publish changes');
  const viewLink = h('a', { class: 'btn ghost', href: liveUrl || '#', target: '_blank', rel: 'noopener', hidden: !liveUrl }, 'View live ↗');
  const del = h('button', { class: 'btn danger small', type: 'button', hidden: isNew || S.me.user.role !== 'admin' }, 'Delete');
  const refresh = () => { const p = validate(); problems.replaceChildren(problemsBox(p)); return p; };
  publishBtn.addEventListener('click', async () => {
    const p = refresh();
    if (p.length) { problems.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    publishBtn.disabled = true;
    try {
      const r = await api('/api/admin/file', { method: 'PUT', body: { path: state.path(), content: getContent(), sha: state.sha, message: msg.value } });
      state.sha = r.sha;
      dropDraft(state.path());
      msg.value = '';
      publishBtn.textContent = 'Publish changes';
      toast('Published ✓  The site updates in about a minute.', 5000);
      onSaved && onSaved();
      S.lists = {};
    } catch (e) {
      if (e.problems) problems.replaceChildren(problemsBox(e.problems));
      toast(e.message, 6000);
    }
    publishBtn.disabled = false;
  });
  del.addEventListener('click', async () => {
    if (!confirm('Delete this file from the site? (It stays in the GitHub history and can be restored.)')) return;
    try {
      await api('/api/admin/file', { method: 'DELETE', body: { path: state.path(), sha: state.sha } });
      dropDraft(state.path());
      toast('Deleted. The site updates in about a minute.');
      location.hash = '#/';
    } catch (e) { toast(e.message, 6000); }
  });
  const head = h('div', { class: 'editor-head' }, h('h1', null, title), viewLink, del, publishBtn);
  const foot = h('div', { class: 'panel', style: null }, h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, msg), publishBtn.cloneNode(true)));
  foot.querySelector('button').addEventListener('click', () => publishBtn.click());
  return { state, head, problems, foot, refresh };
}

async function loadFile(path) {
  try { return await api('/api/admin/file?path=' + encodeURIComponent(path)); } catch (e) { if (e.status === 404) return null; throw e; }
}

function draftBanner(path, onRestore) {
  const d = readDraft(path);
  if (!d) return document.createComment('no draft');
  const box = h('div', { class: 'ai-note' }, `You have unsaved changes from ${new Date(d.at).toLocaleString()}. `,
    h('button', { class: 'btn small', type: 'button', onclick: () => { onRestore(d.data); box.remove(); } }, 'Restore them'), ' ',
    h('button', { class: 'btn small ghost', type: 'button', onclick: () => { dropDraft(path); box.remove(); } }, 'Discard'));
  return box;
}

// ---------------------------------------------------------------- views

async function viewHome() {
  const me = S.me;
  const setup = [
    [me.github, 'GitHub connected (saving works)'],
    [me.db, 'D1 database connected (reports, messages, insights)'],
    [me.ai.length > 0, `AI providers: ${me.ai.length ? me.ai.join(', ') : 'none yet (add a free key)'}`],
  ];
  const status = h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Checking the latest build…'));
  const inbox = h('div', { class: 'panel' }, h('p', { class: 'muted' }, me.db ? 'Loading…' : 'Connect the D1 database to receive reports and messages.'));
  app.replaceChildren(
    h('h1', null, `Namaste, ${me.user.name.split(' ')[0]}!`),
    h('p', { class: 'muted' }, 'What would you like to add today?'),
    h('div', { class: 'cards' },
      h('a', { class: 'action-card', href: '#/edit/mcq' }, h('strong', null, '📝 New MCQ set'), h('span', { class: 'muted small' }, 'Type, paste, or generate questions with AI')),
      h('a', { class: 'action-card', href: '#/edit/notes' }, h('strong', null, '📘 New notes'), h('span', { class: 'muted small' }, 'Chapter notes with formulas and boxes')),
      h('a', { class: 'action-card', href: '#/edit/paper' }, h('strong', null, '📄 New model paper'), h('span', { class: 'muted small' }, 'NEB template with groups A, B, C')),
      h('a', { class: 'action-card', href: '#/edit/lab' }, h('strong', null, '🧪 New lab practical'), h('span', { class: 'muted small' }, 'Aim, theory, tables, viva questions')),
    ),
    h('h2', null, 'Latest site build'), status,
    h('h2', null, 'Inbox'), inbox,
    h('h2', null, 'Setup'), h('div', { class: 'panel' }, h('ul', { class: 'checklist' }, setup.map(([ok, label]) => h('li', { class: ok ? 'ok' : '' }, label)))),
  );
  if (me.github) api('/api/admin/status').then(s => {
    const ci = s.checks.length ? s.checks.map(c => h('span', { class: 'tag ' + (c.conclusion === 'success' ? 'good' : c.conclusion ? 'bad' : 'warn') }, `${c.name}: ${c.conclusion || c.status}`)) : h('span', { class: 'muted' }, 'no checks reported');
    status.replaceChildren(h('p', null, h('strong', null, s.message)), h('p', { class: 'muted small' }, `${s.author} · ${new Date(s.date).toLocaleString()} · `, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.sha.slice(0, 7))), h('div', { class: 'chips' }, ci),
      h('p', { class: 'muted small' }, 'A red check means a file has a problem: that file is left off the site until it is fixed. Open the check to see which file.'));
  }).catch(e => status.replaceChildren(h('p', { class: 'muted' }, e.message)));
  else status.replaceChildren(h('p', { class: 'muted' }, 'Set GITHUB_TOKEN to see build status and to save.'));
  if (me.db) api('/api/admin/inbox').then(r => {
    inbox.replaceChildren(h('p', null, `${r.counts.reports} open mistake report(s) · ${r.counts.messages} open message(s) `, h('a', { href: '#/inbox' }, 'Open inbox →')));
  }).catch(e => inbox.replaceChildren(h('p', { class: 'muted' }, e.message)));
}

const TYPE_INFO = {
  lessons: { title: 'Lessons (notes and MCQ sets)', newLinks: [['#/edit/mcq', 'New MCQ set'], ['#/edit/notes', 'New notes']] },
  papers: { title: 'Model question papers', newLinks: [['#/edit/paper', 'New model paper']] },
  labs: { title: 'Lab practicals', newLinks: [['#/edit/lab', 'New lab practical']] },
  pages: { title: 'Site pages (About, Privacy …)', newLinks: [['#/edit/page', 'New page']] },
};

async function list(type) {
  if (!S.lists[type]) S.lists[type] = (await api('/api/admin/content?type=' + type)).files;
  return S.lists[type];
}

function editorRoute(f) {
  if (f.path.startsWith('src/papers/') && f.name.endsWith('.json')) return '#/edit/paper?path=' + encodeURIComponent(f.path);
  if (f.path.startsWith('src/labs/')) return '#/edit/lab?path=' + encodeURIComponent(f.path);
  if (f.path.startsWith('src/pages/')) return '#/edit/page?path=' + encodeURIComponent(f.path);
  if (f.name.endsWith('.json')) return '#/edit/mcq?path=' + encodeURIComponent(f.path);
  return '#/edit/notes?path=' + encodeURIComponent(f.path);
}

async function viewList(type) {
  const info = TYPE_INFO[type];
  if (!info) { app.replaceChildren(h('p', null, 'Unknown list.')); return; }
  app.replaceChildren(h('h1', null, info.title), h('p', { class: 'muted' }, 'Loading from GitHub…'));
  const files = await list(type);
  const q = h('input', { class: 'search-in', type: 'search', placeholder: 'Filter by title or file name…' });
  const body = h('tbody');
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    body.replaceChildren(...files.filter(f => words.every(w => (f.name + ' ' + (f.title || '')).toLowerCase().includes(w))).map(f => h('tr', null,
      h('td', null, h('a', { href: editorRoute(f) }, f.title || f.name), h('div', { class: 'muted small' }, f.path)),
      h('td', null, f.kind ? h('span', { class: 'tag ' + f.kind }, f.kind) : (type === 'pages' ? h('span', { class: 'tag' }, 'page') : h('span', { class: 'tag bad', title: 'Not on the live site: the build skipped it (a problem in the file) or it is brand new.' }, 'not live'))),
      h('td', null, f.grade || ''),
      h('td', null, f.url ? h('a', { href: f.url, target: '_blank', rel: 'noopener' }, 'view ↗') : ''),
    )));
  };
  q.addEventListener('input', draw);
  app.replaceChildren(
    h('h1', null, info.title),
    h('div', { class: 'toolbar' }, q, h('span', { class: 'grow' }), info.newLinks.map(([href, label]) => h('a', { class: 'btn', href }, '+ ' + label)),
      type === 'lessons' ? h('a', { class: 'btn ghost', href: '#/list/pages', hidden: S.me.user.role !== 'admin' }, 'Site pages') : null),
    h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Title'), h('th', null, 'Type'), h('th', null, 'Grade'), h('th', null, ''))), body)),
  );
  draw();
}

// ---------------------------------------------------------------- MCQ editor

function mcqCounts(qs) {
  const d = { easy: 0, medium: 0, hard: 0, unset: 0 }, pos = [0, 0, 0, 0, 0, 0];
  qs.forEach(q => { d[q.difficulty] !== undefined ? d[q.difficulty]++ : d.unset++; if (Number.isInteger(q.answer)) pos[q.answer]++; });
  return { d, pos };
}

async function viewMcq(path) {
  const existing = path ? await loadFile(path) : null;
  if (path && !existing) { app.replaceChildren(h('p', null, 'That file was not found.')); return; }
  let set = existing ? JSON.parse(existing.content) : { title: '', grade: 'XII', chapters: [], date: today(), description: '', questions: [] };
  let slug = path ? path.split('/').pop().replace(/\.json$/, '') : '';
  const filePath = () => `src/lessons/${slug || slugify(set.title) + '-mcq'}.json`;
  const content = () => JSON.stringify(set, null, 2) + '\n';
  const validate = () => {
    const p = validateMcqSet(set, S.syllabus);
    if (!path && S.lists.lessons && S.lists.lessons.some(f => f.path === filePath())) p.unshift(`A file named ${filePath()} already exists: change the title or the file name.`);
    return p;
  };
  const ed = editorFrame({ title: path ? 'Edit MCQ set' : 'New MCQ set', isNew: !path, getContent: content, validate,
    liveUrl: path ? '/posts/' + slug : null, onSaved: () => { if (!path) { path = filePath(); slug = path.split('/').pop().replace(/\.json$/, ''); history.replaceState(null, '', '#/edit/mcq?path=' + encodeURIComponent(path)); } } });
  ed.state.path = () => path || filePath();
  ed.state.sha = existing && existing.sha;
  if (!path) list('lessons').catch(() => {});

  const stats = h('div', { class: 'stats-line' });
  const qwrap = h('div');
  const changed = () => { saveDraft(ed.state.path(), set); drawStats(); ed.refresh(); };
  function drawStats() {
    const { d, pos } = mcqCounts(set.questions);
    stats.replaceChildren(h('span', null, h('b', null, set.questions.length), ' questions'), h('span', null, `easy ${d.easy} · medium ${d.medium} · hard ${d.hard}${d.unset ? ' · not set ' + d.unset : ''}`),
      h('span', { title: 'The site shuffles options, but a balanced key is still good practice.' }, 'answers A–D: ' + pos.slice(0, 4).join(' / ')));
  }

  function qCard(q, i) {
    const bad = validateQuestions([q]).length > 0;
    const card = h('div', { class: 'qcard' + (bad ? ' bad' : '') });
    const opts = h('div');
    const drawOpts = () => {
      opts.replaceChildren(...q.options.map((o, j) => h('div', { class: 'opt-row' + (q.answer === j ? ' correct' : '') },
        h('input', { type: 'radio', name: 'ans' + i, checked: q.answer === j, 'aria-label': `Option ${'ABCDEF'[j]} is correct`, onchange: () => { q.answer = j; drawOpts(); changed(); } }),
        (() => { const inp = h('input', { class: 'in', placeholder: `Option ${'ABCDEF'[j]}` }); inp.value = o; inp.addEventListener('input', () => { q.options[j] = inp.value; changed(); }); return inp; })(),
        h('button', { class: 'btn small ghost', type: 'button', title: 'Remove option', disabled: q.options.length <= 2, onclick: () => {
          q.options.splice(j, 1); if (q.answer === j) q.answer = null; else if (q.answer > j) q.answer--; drawOpts(); changed(); } }, '✕'))),
        q.options.length < 6 ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { q.options.push(''); drawOpts(); changed(); } }, '+ option') : null);
    };
    drawOpts();
    const check = h('button', { class: 'btn small ghost', type: 'button', hidden: !S.me.ai.length }, '🤖 Check answer');
    const note = h('div');
    check.addEventListener('click', async () => {
      try {
        const r = await ai('mcq-check', { q: q.q, options: q.options, answer: q.answer }, check);
        const v = r.result;
        note.replaceChildren(h('div', { class: 'ai-note' },
          h('strong', null, v.agrees ? `✓ The AI agrees with ${'ABCDEF'[q.answer]} (${v.confidence} confidence).` : `⚠ The AI thinks the answer is ${'ABCDEF'[v.correct]}, not ${'ABCDEF'[q.answer] || '—'} (${v.confidence} confidence).`),
          v.issues ? h('p', null, 'Wording: ' + v.issues) : null, h('p', null, v.explanation),
          h('div', { class: 'toolbar' }, !q.explanation ? h('button', { class: 'btn small', type: 'button', onclick: () => { q.explanation = v.explanation; draw(); changed(); } }, 'Use this explanation') : null,
            !v.agrees ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { q.answer = v.correct; draw(); changed(); } }, `Mark ${'ABCDEF'[v.correct]} as correct`) : null),
          h('small', { class: 'muted' }, `Answered by ${r.provider}. AI can be wrong: you decide.`)));
      } catch (e) { toast(e.message, 6000); }
    });
    const move = d => { const j = i + d; if (j < 0 || j >= set.questions.length) return; [set.questions[i], set.questions[j]] = [set.questions[j], set.questions[i]]; draw(); changed(); };
    card.append(
      h('div', { class: 'qcard-head' }, h('strong', null, `Question ${i + 1}`),
        select([['', 'difficulty…'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], q.difficulty || '', v => { if (v) q.difficulty = v; else delete q.difficulty; changed(); }),
        h('button', { class: 'btn small ghost', type: 'button', title: 'Move up', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'btn small ghost', type: 'button', title: 'Move down', onclick: () => move(1) }, '↓'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { set.questions.splice(i + 1, 0, clone(q)); draw(); changed(); } }, 'Duplicate'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { if (confirm('Delete this question?')) { set.questions.splice(i, 1); draw(); changed(); } } }, 'Delete')),
      field('Question', bind(q, 'q', { rows: 2, onchange: changed }), null, true),
      h('div', { class: 'muted small' }, 'Options: tick the correct one'), opts,
      field('Explanation', bind(q, 'explanation', { rows: 2, onchange: changed, placeholder: 'Why is it correct? For numericals, show the working.' }), null, true),
      h('div', { class: 'form-grid' },
        field('Source', bind(q, 'source', { onchange: changed, placeholder: 'e.g. NEB 2079' }), '(optional)'),
        field('Diagram', h('div', { class: 'toolbar' }, bind(q, 'image', { onchange: changed, placeholder: '/assets/img/…' }),
          h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { const url = await uploadImage(set.title + '-q' + (i + 1)); if (url) { q.image = url; draw(); changed(); } } catch (e) { toast(e.message); } } }, 'Upload')), '(optional)'),
        q.image ? field('Diagram description', bind(q, 'image_alt', { onchange: changed }), '(for blind students)') : null),
      check, note);
    return card;
  }
  function draw() { qwrap.replaceChildren(...set.questions.map(qCard)); drawStats(); ed.refresh(); }

  function addQuestions(list, how) {
    set.questions.push(...list);
    draw(); changed();
    toast(`${list.length} question${list.length === 1 ? '' : 's'} added${how ? ' ' + how : ''}. Check each one before publishing.`, 5000);
  }

  const pasteBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
    const ta = h('textarea', { class: 'in code', rows: 14, placeholder: '1. The SI unit of force is\na) newton  b) joule  c) watt  d) pascal\nAns: a\nExplanation: F = ma …' });
    const out = h('div', { class: 'muted small' }, 'Works with numbered questions, a)/b)/(A)/A. options (inline or one per line), "Ans: b" lines or a * on the right option, and "Explanation:" lines.');
    const d = dialog('Paste questions (no AI needed)', h('div', null, ta, out), [
      h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const r = parseQuestions(ta.value);
        if (!r.questions.length) { out.textContent = 'No questions recognised. ' + r.warnings.join(' '); return; }
        d.close(); addQuestions(r.questions, 'from the pasted text');
        if (r.warnings.length) alert('Please check:\n\n' + r.warnings.join('\n'));
      } }, 'Add questions')]);
  } }, '📋 Paste questions');

  const aiGen = h('button', { class: 'btn ghost', type: 'button', hidden: !S.me.ai.length, onclick: () => {
    if (!set.chapters.length) { toast('Choose the chapter first.'); return; }
    const p = { count: 10, topics: '', mix: '' };
    const go = h('button', { class: 'btn', type: 'button' }, 'Generate');
    const d = dialog('Generate questions with AI', h('div', { class: 'form-grid' },
      field('How many', bind(p, 'count', { type: 'number' }), '(1–25 at a time)'),
      field('Difficulty mix', bind(p, 'mix', { placeholder: 'about 40% easy, 40% medium, 20% hard' })),
      field('Topics to cover', bind(p, 'topics', { rows: 3, placeholder: 'e.g. rms and peak values; impedance; resonance' }), '(optional)', true),
      h('p', { class: 'muted small f wide' }, 'The AI writes new questions; existing ones in this set are sent so it avoids repeating them. Read every question and its answer before publishing.')),
    [h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel'), go]);
    go.addEventListener('click', async () => {
      try {
        const r = await ai('mcq-generate', { ...p, grade: set.grade, chapter: set.chapters[0], avoid: set.questions.map(q => q.q) }, go);
        d.close(); addQuestions(r.result.questions, `by AI (${r.provider})`);
      } catch (e) { toast(e.message, 6000); }
    });
  } }, '🤖 Generate with AI');

  const aiConvert = h('button', { class: 'btn ghost', type: 'button', hidden: !S.me.ai.length, onclick: () => {
    const p = { text: '' };
    const go = h('button', { class: 'btn', type: 'button' }, 'Convert');
    const d = dialog('Convert messy text with AI', h('div', null,
      bind(p, 'text', { rows: 14, cls: 'in code', placeholder: 'Paste questions copied from a PDF, a Word file or a chat. Missing answers are solved and explanations are added.' }),
      h('p', { class: 'muted small' }, 'Use "Paste questions" first for neatly formatted text: it is instant and needs no AI.')),
    [h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel'), go]);
    go.addEventListener('click', async () => {
      try {
        const r = await ai('mcq-convert', { ...p, grade: set.grade, chapter: set.chapters[0] }, go);
        d.close(); addQuestions(r.result.questions, `by AI (${r.provider})`);
        if (r.result.dropped) toast(`${r.result.dropped} item(s) could not be converted and were left out.`, 6000);
      } catch (e) { toast(e.message, 6000); }
    });
  } }, '🤖 Convert text with AI');

  const jsonBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
    const ta = h('textarea', { class: 'in code', rows: 16 });
    ta.value = content();
    const d = dialog('Edit as JSON', ta, [h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        try { const o = JSON.parse(ta.value); set = { ...set, ...o, questions: o.questions || [] }; d.close(); viewMcqDraw(); changed(); } catch (e) { alert('That is not valid JSON: ' + e.message); }
      } }, 'Apply')]);
  } }, '{ } JSON');

  const meta = h('div');
  function viewMcqDraw() {
    meta.replaceChildren(h('div', { class: 'form-grid' },
      field('Title', bind(set, 'title', { onchange: changed, placeholder: 'Alternating Current — 40 MCQs' }), null, true),
      gradeChapters(set, changed),
      field('Date', bind(set, 'date', { type: 'date', onchange: changed })),
      field('File name', (() => { const i = h('input', { class: 'in', disabled: !!path, placeholder: 'from the title' }); i.value = slug; i.addEventListener('input', () => { slug = slugify(i.value); changed(); }); return i; })(), path ? '(fixed: it is the page address)' : '(the page address)'),
      field('Video link', bind(set, 'video', { onchange: changed, placeholder: 'https://youtu.be/…' }), '(optional)'),
      field('Description', bind(set, 'description', { rows: 2, onchange: changed }), '(one sentence shown under the title and in Google)', true)));
    draw();
  }

  const draft = draftBanner(ed.state.path(), d => { set = d; viewMcqDraw(); ed.refresh(); });
  app.replaceChildren(ed.head, draft, meta,
    h('h2', null, 'Questions'), stats, qwrap,
    h('div', { class: 'toolbar' }, h('button', { class: 'btn brand', type: 'button', onclick: () => { set.questions.push({ q: '', options: ['', '', '', ''], answer: null, difficulty: 'medium' }); draw(); changed(); qwrap.lastChild.querySelector('textarea').focus(); } }, '+ Add question'),
      pasteBtn, aiGen, aiConvert, jsonBtn),
    ed.problems, ed.foot);
  viewMcqDraw();
}

// ---------------------------------------------------------------- notes & page editor

const SNIPPETS = [
  ['H2', '<h2>Section title</h2>\n'], ['H3', '<h3>Sub-heading</h3>\n'], ['Paragraph', '<p>Text with an inline formula \\( v = u + at \\).</p>\n'],
  ['Formula', '<div class="formula">\\[ F = ma \\]<span class="where">where F is the force, m the mass and a the acceleration.</span></div>\n'],
  ['Definition', '<div class="box definition"><p><strong>Term</strong> is …</p></div>\n'], ['Law', '<div class="box law"><p>Statement of the law…</p></div>\n'],
  ['Worked example', '<div class="box example"><p><strong>Example.</strong> Question…</p>\n<details class="solution"><summary>Show solution</summary><p>Working…</p></details></div>\n'],
  ['Exam tip', '<div class="box tip"><p>Tip…</p></div>\n'], ['Common mistake', '<div class="box warning"><p>Mistake…</p></div>\n'], ['Note', '<div class="box note"><p>Note…</p></div>\n'],
  ['Key points', '<ul class="key-points">\n  <li>Point one</li>\n  <li>Point two</li>\n</ul>\n'],
  ['Table', '<table>\n  <tr><th>Quantity</th><th>Symbol</th><th>SI unit</th></tr>\n  <tr><td>Force</td><td>F</td><td>N</td></tr>\n</table>\n'],
  ['Compare', '<div class="cols">\n  <div><h4>A</h4><p>…</p></div>\n  <div><h4>B</h4><p>…</p></div>\n</div>\n'],
];

async function viewNotes(path, isPage) {
  const existing = path ? await loadFile(path) : null;
  if (path && !existing) { app.replaceChildren(h('p', null, 'That file was not found.')); return; }
  const parsed = existing ? parseFrontMatter(existing.content) : { meta: isPage ? { title: '', description: '', date: today() } : { title: '', grade: 'XII', chapters: [], date: today(), description: '' }, body: isPage ? '<p>…</p>' : '<h2>Introduction</h2>\n<p>…</p>\n' };
  let meta = parsed.meta;
  if (typeof meta.chapters === 'number') meta.chapters = [meta.chapters];
  let bodyHtml = parsed.body.trim();
  let slug = path ? path.split('/').pop().replace(/\.html$/, '') : '';
  const dir = isPage ? 'src/pages' : 'src/lessons';
  const filePath = () => `${dir}/${slug || slugify(meta.title)}.html`;
  const content = () => buildFrontMatter(meta, bodyHtml);
  const validate = () => isPage ? validatePage(content()) : validateNotes(content(), S.syllabus);
  const ed = editorFrame({ title: path ? (isPage ? 'Edit page' : 'Edit notes') : (isPage ? 'New page' : 'New notes'), isNew: !path, getContent: content, validate,
    liveUrl: path ? (isPage ? '/' + slug : '/posts/' + slug) : null, onSaved: () => { if (!path) { path = filePath(); history.replaceState(null, '', `#/edit/${isPage ? 'page' : 'notes'}?path=` + encodeURIComponent(path)); } } });
  ed.state.path = () => path || filePath();
  ed.state.sha = existing && existing.sha;
  const preview = h('div', { class: 'preview' });
  const ta = h('textarea', { class: 'in code', spellcheck: 'true' });
  ta.value = bodyHtml;
  let timer;
  const drawPreview = () => {
    const doc = new DOMParser().parseFromString(`<article class="notes-body">${bodyHtml}</article>`, 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, form').forEach(x => x.remove());
    doc.querySelectorAll('*').forEach(el => [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) el.removeAttribute(a.name); }));
    preview.replaceChildren(h('p', { class: 'muted small' }, 'Preview (as students will see it)'), ...doc.body.childNodes);
    renderMath(preview);
  };
  const changed = () => { saveDraft(ed.state.path(), { meta, body: bodyHtml }); ed.refresh(); clearTimeout(timer); timer = setTimeout(drawPreview, 400); };
  ta.addEventListener('input', () => { bodyHtml = ta.value; changed(); });
  const insert = text => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(text, s, e, 'end'); ta.focus(); bodyHtml = ta.value; changed(); };
  const snips = h('div', { class: 'snips' }, SNIPPETS.map(([label, text]) => h('button', { class: 'btn small ghost', type: 'button', onclick: () => insert(text) }, label)),
    h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
      try { const url = await uploadImage(meta.title || 'figure'); if (url) insert(`<figure><img src="${url}" alt="Describe the diagram"><figcaption>Caption</figcaption></figure>\n`); } catch (e) { toast(e.message); }
    } }, '🖼 Image'));
  const metaBox = h('div');
  const drawMeta = () => metaBox.replaceChildren(h('div', { class: 'form-grid' },
    field('Title', bind(meta, 'title', { onchange: changed }), null, true),
    isPage ? null : gradeChapters(meta, changed),
    field('Date', bind(meta, 'date', { type: 'date', onchange: changed })),
    field('File name', (() => { const i = h('input', { class: 'in', disabled: !!path, placeholder: 'from the title' }); i.value = slug; i.addEventListener('input', () => { slug = slugify(i.value); changed(); }); return i; })(), '(the page address)'),
    isPage ? null : field('Video link', bind(meta, 'video', { onchange: changed, placeholder: 'https://youtu.be/…' }), '(optional)'),
    field('Description', bind(meta, 'description', { rows: 2, onchange: changed }), '(shown in Google results)', true)));
  const draft = draftBanner(ed.state.path(), d => { meta = d.meta; bodyHtml = d.body; ta.value = bodyHtml; drawMeta(); changed(); });
  drawMeta();
  app.replaceChildren(ed.head, draft, metaBox, h('h2', null, 'Content'),
    h('p', { class: 'muted small' }, 'Use the buttons to insert building blocks. Formulas: \\( … \\) inline, \\[ … \\] on their own line. Every <h2> becomes an entry in "On this page". Styles and scripts are not allowed: the site design is applied automatically.'),
    snips, h('div', { class: 'split' }, ta, preview), ed.problems, ed.foot);
  drawPreview();
  ed.refresh();
}

// ---------------------------------------------------------------- model paper editor

function neb(grade) {
  const blank = marks => ({ q: '', marks });
  const mcq = () => ({ q: '', options: ['', '', '', ''], answer: null });
  return {
    title: `Grade ${grade} Physics Model Question ${new Date().getFullYear() + 56} (Set 1)`, grade, year: new Date().getFullYear() + 56, date: today(),
    time: '3 hours', full_marks: 75, pass_marks: 30, description: '',
    groups: [
      { title: 'Group A', subtitle: 'Multiple choice questions', marks: '11 × 1 = 11', instructions: 'Rewrite the correct option of each question.', questions: Array.from({ length: 11 }, mcq) },
      { title: 'Group B', subtitle: 'Short answer questions', marks: '8 × 5 = 40', instructions: 'Give short answers to the following questions.', questions: Array.from({ length: 8 }, () => blank(5)) },
      { title: 'Group C', subtitle: 'Long answer questions', marks: '3 × 8 = 24', instructions: 'Give long answers to the following questions.', questions: Array.from({ length: 3 }, () => blank(8)) },
    ],
  };
}

function qType(q) { return q.parts ? 'parts' : q.options ? 'mcq' : 'single'; }

function paperQuestionEditor(q, label, changed, redraw, { allowOr = true, onDelete, onMove } = {}) {
  const box = h('div', { class: 'qcard' });
  const setType = t => {
    const keep = { q: q.q, solution: q.solution, or: q.or };
    for (const k of Object.keys(q)) delete q[k];
    Object.assign(q, Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)));
    if (t === 'mcq') { q.options = ['', '', '', '']; q.answer = null; }
    if (t === 'single') q.marks = 5;
    if (t === 'parts') { q.parts = [{ q: '', marks: 2 }, { q: '', marks: 3 }]; }
    redraw(); changed();
  };
  const t = qType(q);
  box.append(h('div', { class: 'qcard-head' }, h('strong', null, label),
    select([['mcq', 'Multiple choice'], ['single', 'Single question'], ['parts', 'Parts a, b, c']], t, setType),
    onMove ? [h('button', { class: 'btn small ghost', type: 'button', onclick: () => onMove(-1) }, '↑'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => onMove(1) }, '↓')] : null,
    onDelete ? h('button', { class: 'btn small danger', type: 'button', onclick: onDelete }, 'Delete') : null));
  if (t === 'parts') {
    box.append(field('Common text', bind(q, 'q', { rows: 2, onchange: changed, placeholder: 'Optional text before the parts' }), '(optional)', true));
    q.parts.forEach((p, i) => box.append(h('div', { class: 'panel', style: null },
      h('div', { class: 'qcard-head' }, h('strong', null, `Part ${'abcdefgh'[i]}`), h('button', { class: 'btn small danger', type: 'button', disabled: q.parts.length <= 1, onclick: () => { q.parts.splice(i, 1); redraw(); changed(); } }, 'Remove part')),
      h('div', { class: 'form-grid' }, field('Question', bind(p, 'q', { rows: 2, onchange: changed }), null, true),
        field('Marks', bind(p, 'marks', { type: 'number', onchange: changed })),
        field('Solution', bind(p, 'solution', { rows: 3, onchange: changed }), '(HTML allowed; hidden until opened)', true)))));
    box.append(h('button', { class: 'btn small ghost', type: 'button', onclick: () => { q.parts.push({ q: '', marks: 1 }); redraw(); changed(); } }, '+ Part'));
  } else {
    box.append(field('Question', bind(q, 'q', { rows: 2, onchange: changed }), null, true));
    if (t === 'mcq') {
      const group = 'pa' + Math.random().toString(36).slice(2);
      q.options.forEach((o, j) => box.append(h('div', { class: 'opt-row' + (q.answer === j ? ' correct' : '') },
        h('input', { type: 'radio', name: group, checked: q.answer === j, onchange: () => { q.answer = j; redraw(); changed(); } }),
        (() => { const inp = h('input', { class: 'in', placeholder: `Option ${'abcdef'[j]}` }); inp.value = o; inp.addEventListener('input', () => { q.options[j] = inp.value; changed(); }); return inp; })(), h('span'))));
    } else {
      box.append(field('Marks', bind(q, 'marks', { type: 'number', onchange: changed })));
    }
    box.append(field(t === 'mcq' ? 'Explanation' : 'Solution', bind(q, 'solution', { rows: 3, onchange: changed }), '(HTML allowed; hidden until opened)', true));
  }
  if (allowOr) {
    const orBox = h('div', { class: 'or-box' });
    if (q.or) orBox.append(paperQuestionEditor(q.or, label + ' (OR)', changed, redraw, { allowOr: false, onDelete: () => { delete q.or; redraw(); changed(); } }));
    else orBox.append(h('button', { class: 'btn small ghost', type: 'button', onclick: () => { q.or = t === 'mcq' ? { q: '', options: ['', '', '', ''], answer: null } : t === 'parts' ? { parts: [{ q: '', marks: 2 }] } : { q: '', marks: q.marks || 5 }; redraw(); changed(); } }, '+ OR alternative'));
    box.append(orBox);
  }
  return box;
}

async function viewPaper(path) {
  const existing = path ? await loadFile(path) : null;
  if (path && !existing) { app.replaceChildren(h('p', null, 'That file was not found.')); return; }
  let paper = existing ? JSON.parse(existing.content) : neb('XII');
  let slug = path ? path.split('/').pop().replace(/\.json$/, '') : '';
  const filePath = () => `src/papers/${slug || slugify(paper.title)}.json`;
  const content = () => JSON.stringify(paper, null, 2) + '\n';
  const totalLine = h('div', { class: 'stats-line' });
  const validate = () => {
    const r = validatePaper(paper, S.syllabus);
    totalLine.replaceChildren(h('span', null, `Questions add up to `, h('b', null, r.total), ` marks`), paper.full_marks ? h('span', null, `full marks ${paper.full_marks}`) : null);
    return r.problems;
  };
  const ed = editorFrame({ title: path ? 'Edit model paper' : 'New model paper', isNew: !path, getContent: content, validate,
    liveUrl: path ? '/papers/' + slug : null, onSaved: () => { if (!path) { path = filePath(); history.replaceState(null, '', '#/edit/paper?path=' + encodeURIComponent(path)); } } });
  ed.state.path = () => path || filePath();
  ed.state.sha = existing && existing.sha;
  const changed = () => { saveDraft(ed.state.path(), paper); ed.refresh(); };
  const groupsBox = h('div');
  const metaBox = h('div');
  function draw() {
    metaBox.replaceChildren(h('div', { class: 'form-grid' },
      field('Title', bind(paper, 'title', { onchange: changed }), null, true),
      field('Grade', select([['XI', 'Grade XI'], ['XII', 'Grade XII']], paper.grade, v => { paper.grade = v; changed(); })),
      field('Year (B.S.)', bind(paper, 'year', { type: 'number', onchange: changed })),
      field('Date', bind(paper, 'date', { type: 'date', onchange: changed })),
      field('Time', bind(paper, 'time', { onchange: changed })),
      field('Full marks', bind(paper, 'full_marks', { type: 'number', onchange: changed })),
      field('Pass marks', bind(paper, 'pass_marks', { type: 'number', onchange: changed })),
      field('File name', (() => { const i = h('input', { class: 'in', disabled: !!path, placeholder: 'from the title' }); i.value = slug; i.addEventListener('input', () => { slug = slugify(i.value); changed(); }); return i; })()),
      field('Description', bind(paper, 'description', { rows: 2, onchange: changed }), null, true)));
    let n = 0;
    groupsBox.replaceChildren(...paper.groups.map((g, gi) => h('div', { class: 'group-card' },
      h('div', { class: 'qcard-head' }, h('strong', null, g.title || `Group ${gi + 1}`), h('button', { class: 'btn small danger', type: 'button', onclick: () => { if (confirm('Delete this whole group?')) { paper.groups.splice(gi, 1); draw(); changed(); } } }, 'Delete group')),
      h('div', { class: 'form-grid' }, field('Group title', bind(g, 'title', { onchange: changed })), field('Subtitle', bind(g, 'subtitle', { onchange: changed })),
        field('Marks line', bind(g, 'marks', { onchange: changed, placeholder: '8 × 5 = 40' })), field('Instructions', bind(g, 'instructions', { onchange: changed }), null, true)),
      g.questions.map((q, qi) => { n++; return paperQuestionEditor(q, `Question ${n}`, changed, draw, {
        onDelete: () => { g.questions.splice(qi, 1); draw(); changed(); },
        onMove: d => { const j = qi + d; if (j < 0 || j >= g.questions.length) return; [g.questions[qi], g.questions[j]] = [g.questions[j], g.questions[qi]]; draw(); changed(); },
      }); }),
      h('button', { class: 'btn small brand', type: 'button', onclick: () => { g.questions.push(gi === 0 ? { q: '', options: ['', '', '', ''], answer: null } : { q: '', marks: 5 }); draw(); changed(); } }, '+ Question'))));
    ed.refresh();
  }
  const tools = h('div', { class: 'toolbar' },
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { if (confirm('Replace everything with the empty NEB template (11 MCQs, 8 short, 3 long)?')) { paper = neb(paper.grade); draw(); changed(); } } }, 'NEB template'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { paper.groups.push({ title: `Group ${'ABCDEFG'[paper.groups.length] || ''}`, questions: [{ q: '', marks: 5 }] }); draw(); changed(); } }, '+ Group'),
    h('button', { class: 'btn ghost', type: 'button', hidden: !S.me.ai.length, onclick: () => {
      const p = { text: '', solve: true };
      const go = h('button', { class: 'btn', type: 'button' }, 'Convert');
      const d = dialog('Convert a pasted paper with AI', h('div', null, bind(p, 'text', { rows: 14, cls: 'in code', placeholder: 'Paste the whole question paper (with or without solutions)…' }),
        h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox', checked: true }); c.addEventListener('change', () => { p.solve = c.checked; }); return c; })(), 'Write model solutions where none are given')),
      [h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel'), go]);
      go.addEventListener('click', async () => {
        try { const r = await ai('paper-convert', p, go); paper.groups = r.result.groups; d.close(); draw(); changed(); toast(`Converted by ${r.provider}. Check every question, mark and solution.`, 6000); } catch (e) { toast(e.message, 6000); }
      });
    } }, '🤖 Convert pasted paper'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => {
      const ta = h('textarea', { class: 'in code', rows: 16 }); ta.value = content();
      const d = dialog('Edit as JSON', ta, [h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: 'btn', type: 'button', onclick: () => { try { paper = JSON.parse(ta.value); d.close(); draw(); changed(); } catch (e) { alert('Invalid JSON: ' + e.message); } } }, 'Apply')]);
    } }, '{ } JSON'));
  const draft = draftBanner(ed.state.path(), d => { paper = d; draw(); });
  app.replaceChildren(ed.head, draft, metaBox, h('h2', null, 'Questions'), tools, totalLine, groupsBox, ed.problems, ed.foot);
  draw();
}

// ---------------------------------------------------------------- lab editor

function tableEditor(t, changed) {
  const headers = h('input', { class: 'in', placeholder: 'S.N. | Length l (m) | Time t (s) | …' });
  headers.value = (t.headers || []).join(' | ');
  headers.addEventListener('input', () => { t.headers = headers.value.split('|').map(s => s.trim()).filter(Boolean); changed(); });
  const rows = h('textarea', { class: 'in code', rows: 6, placeholder: '1 | 0.60 | 31.1\n2 | 0.70 | 33.6' });
  rows.value = (t.rows || []).map(r => r.join(' | ')).join('\n');
  rows.addEventListener('input', () => { t.rows = rows.value.split('\n').filter(l => l.trim()).map(l => l.split('|').map(s => s.trim())); changed(); });
  return h('div', { class: 'panel' }, h('div', { class: 'form-grid' },
    field('Caption', bind(t, 'caption', { onchange: changed, placeholder: 'Table 1: …' }), null, true),
    field('Column headings', headers, '(separate with |)', true),
    field('Rows', rows, '(one row per line, cells separated by |)', true),
    field('Note under the table', bind(t, 'note', { onchange: changed }), '(optional)', true)));
}

async function viewLab(path) {
  const existing = path ? await loadFile(path) : null;
  if (path && !existing) { app.replaceChildren(h('p', null, 'That file was not found.')); return; }
  let lab = existing ? JSON.parse(existing.content) : { title: '', grade: 'XI', chapters: [], date: today(), aim: '', apparatus: [], procedure: [] };
  let slug = path ? path.split('/').pop().replace(/\.json$/, '') : '';
  const filePath = () => `src/labs/${slug || slugify(lab.title)}.json`;
  const content = () => JSON.stringify(lab, null, 2) + '\n';
  const ed = editorFrame({ title: path ? 'Edit lab practical' : 'New lab practical', isNew: !path, getContent: content, validate: () => validateLab(lab, S.syllabus),
    liveUrl: path ? '/labs/' + slug : null, onSaved: () => { if (!path) { path = filePath(); history.replaceState(null, '', '#/edit/lab?path=' + encodeURIComponent(path)); } } });
  ed.state.path = () => path || filePath();
  ed.state.sha = existing && existing.sha;
  const changed = () => { saveDraft(ed.state.path(), lab); ed.refresh(); };
  const box = h('div');
  function draw() {
    const html = '(HTML allowed: <p>, <strong>, formulas \\( … \\))';
    // The diagram is optional: it is only saved once one of its fields has something in it.
    const diag = lab.diagram || {};
    const syncDiag = () => { if (diag.src || diag.alt || diag.caption) lab.diagram = diag; else delete lab.diagram; changed(); };
    box.replaceChildren(
      h('div', { class: 'form-grid' },
        field('Title', bind(lab, 'title', { onchange: changed, placeholder: 'Verification of Ohm’s law' }), null, true),
        gradeChapters(lab, changed, { required: false }),
        field('Experiment number', bind(lab, 'number', { type: 'number', onchange: changed }), '(optional)'),
        field('Date', bind(lab, 'date', { type: 'date', onchange: changed })),
        field('File name', (() => { const i = h('input', { class: 'in', disabled: !!path, placeholder: 'from the title' }); i.value = slug; i.addEventListener('input', () => { slug = slugify(i.value); changed(); }); return i; })()),
        field('Video link', bind(lab, 'video', { onchange: changed }), '(optional)'),
        field('Description', bind(lab, 'description', { rows: 2, onchange: changed }), '(one sentence)', true),
        field('Aim', bind(lab, 'aim', { rows: 2, onchange: changed }), null, true),
        field('Apparatus', bind(lab, 'apparatus', { rows: 5, list: true, onchange: changed }), '(one per line)', true),
        field('Theory', bind(lab, 'theory', { rows: 8, cls: 'in code', onchange: changed }), html, true)),
      h('h2', null, 'Diagram'),
      h('div', { class: 'form-grid' },
        field('Image', h('div', { class: 'toolbar' }, bind(diag, 'src', { onchange: syncDiag, placeholder: '/assets/img/…' }),
          h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { const u = await uploadImage(lab.title + '-diagram'); if (u) { diag.src = u; syncDiag(); draw(); } } catch (e) { toast(e.message); } } }, 'Upload'))),
        field('Description of the diagram', bind(diag, 'alt', { onchange: syncDiag }), '(for blind students)'),
        field('Caption', bind(diag, 'caption', { onchange: syncDiag }), '(optional)')),
      h('div', { class: 'form-grid' }, field('Procedure', bind(lab, 'procedure', { rows: 8, list: true, onchange: changed }), '(one step per line)', true)),
      h('h2', null, 'Observation tables'),
      (lab.observations || []).map((t, i) => h('div', null, tableEditor(t, changed), h('button', { class: 'btn small danger', type: 'button', onclick: () => { lab.observations.splice(i, 1); if (!lab.observations.length) delete lab.observations; draw(); changed(); } }, 'Remove table'))),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => { (lab.observations = lab.observations || []).push({ caption: '', headers: ['S.N.'], rows: [] }); draw(); changed(); } }, '+ Table'),
      h('div', { class: 'form-grid' },
        field('Calculation', bind(lab, 'calculation', { rows: 6, cls: 'in code', onchange: changed }), html, true),
        field('Result', bind(lab, 'result', { rows: 2, onchange: changed }), null, true),
        field('Conclusion', bind(lab, 'conclusion', { rows: 2, onchange: changed }), '(optional)', true),
        field('Precautions', bind(lab, 'precautions', { rows: 5, list: true, onchange: changed }), '(one per line)', true),
        field('Sources of error', bind(lab, 'errors', { rows: 4, list: true, onchange: changed }), '(one per line)', true)),
      h('h2', null, 'Viva questions'),
      (lab.viva || []).map((v, i) => h('div', { class: 'panel' }, h('div', { class: 'form-grid' }, field(`Question ${i + 1}`, bind(v, 'q', { onchange: changed }), null, true), field('Answer', bind(v, 'a', { rows: 2, onchange: changed }), null, true)),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { lab.viva.splice(i, 1); draw(); changed(); } }, 'Remove'))),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => { (lab.viva = lab.viva || []).push({ q: '', a: '' }); draw(); changed(); } }, '+ Viva question'));
    ed.refresh();
  }
  const aiBtn = h('button', { class: 'btn ghost', type: 'button', hidden: !S.me.ai.length }, '🤖 Draft with AI');
  aiBtn.addEventListener('click', async () => {
    if (!lab.title) { toast('Write the title first, e.g. “Verification of Ohm’s law”.'); return; }
    if ((lab.aim || lab.theory) && !confirm('Replace the current sections with an AI draft?')) return;
    try {
      const r = await ai('lab-draft', { title: lab.title, grade: lab.grade, chapter: (lab.chapters || [])[0] }, aiBtn);
      Object.assign(lab, r.result);
      draw(); changed();
      toast(`Drafted by ${r.provider}. Check the theory, the readings and the result carefully.`, 6000);
    } catch (e) { toast(e.message, 6000); }
  });
  const draft = draftBanner(ed.state.path(), d => { lab = d; draw(); });
  app.replaceChildren(ed.head, draft, h('div', { class: 'toolbar' }, aiBtn, h('span', { class: 'muted small' }, 'The AI fills every section from the title; you check and edit.')), box, ed.problems, ed.foot);
  draw();
}

// ---------------------------------------------------------------- settings, inbox, insights

async function viewSettings() {
  if (S.me.user.role !== 'admin') { app.replaceChildren(h('p', null, 'Only an admin can change settings.')); return; }
  const f = await loadFile('src/settings.json');
  let st = f ? JSON.parse(f.content) : {};
  st.announcement = st.announcement || {}; st.ads = st.ads || {}; st.ads.slots = st.ads.slots || {}; st.ads.house_ads = st.ads.house_ads || [];
  st.analytics = st.analytics || {}; st.features = st.features || {}; st.verification = st.verification || {};
  const ed = editorFrame({ title: 'Site settings', isNew: false, getContent: () => JSON.stringify(st, null, 2) + '\n', validate: () => validateSettings(st) });
  ed.state.path = () => 'src/settings.json';
  ed.state.sha = f && f.sha;
  const changed = () => ed.refresh();
  const toggle = (obj, key, label) => h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox', checked: !!obj[key] }); c.addEventListener('change', () => { obj[key] = c.checked; changed(); }); return c; })(), label);
  const houseBox = h('div');
  const drawHouse = () => houseBox.replaceChildren(...st.ads.house_ads.map((a, i) => h('div', { class: 'panel' }, h('div', { class: 'form-grid' },
    field('Title', bind(a, 'title', { onchange: changed })), field('Text', bind(a, 'text', { onchange: changed })), field('Button', bind(a, 'cta', { onchange: changed })),
    field('Link', bind(a, 'url', { onchange: changed })), field('Weight', bind(a, 'weight', { type: 'number', onchange: changed }), '(higher = shown more)'), field('ID', bind(a, 'id', { onchange: changed }))),
    h('button', { class: 'btn small danger', type: 'button', onclick: () => { st.ads.house_ads.splice(i, 1); drawHouse(); changed(); } }, 'Remove'))),
    h('button', { class: 'btn small ghost', type: 'button', onclick: () => { st.ads.house_ads.push({ id: 'promo-' + Date.now().toString(36), title: '', text: '', cta: 'Open', url: 'https://', weight: 1 }); drawHouse(); changed(); } }, '+ House ad'));
  drawHouse();
  app.replaceChildren(ed.head,
    h('h2', null, 'Announcement banner'), h('div', { class: 'panel' }, toggle(st.announcement, 'enabled', 'Show a banner at the top of every page'),
      h('div', { class: 'form-grid' }, field('Text', bind(st.announcement, 'text', { onchange: changed, placeholder: 'NEB exam routine 2083 published' }), null, true), field('Link', bind(st.announcement, 'link', { onchange: changed }), '(optional)', true))),
    h('h2', null, 'Ads'), h('div', { class: 'panel' },
      h('p', { class: 'muted small' }, 'Ads appear only between sections, never inside a question, and are hidden during timed tests. Without an AdSense ID (or when AdSense has no ad), the house ads below are shown.'),
      toggle(st.ads, 'enabled', 'Show ads'), ' ', toggle(st.ads, 'auto_ads', 'Also allow AdSense Auto ads (Google decides placement: less student-friendly)'),
      h('div', { class: 'form-grid' }, field('AdSense publisher ID', bind(st.ads, 'adsense_client', { onchange: changed, placeholder: 'ca-pub-1234567890123456' })),
        field('Slot: inside articles', bind(st.ads.slots, 'in_article', { onchange: changed }), '(numeric slot ID)'), field('Slot: end of content', bind(st.ads.slots, 'end_of_content', { onchange: changed })),
        field('Slot: sidebar', bind(st.ads.slots, 'sidebar', { onchange: changed })), field('Slot: lists', bind(st.ads.slots, 'list', { onchange: changed }))),
      h('h3', null, 'House ads'), houseBox),
    h('h2', null, 'Analytics & features'), h('div', { class: 'panel' }, h('div', { class: 'form-grid' },
      field('Cloudflare Web Analytics token', bind(st.analytics, 'cloudflare_token', { onchange: changed }), '(leave empty if Cloudflare adds it automatically)'),
      field('Google Search Console code', bind(st.verification, 'google', { onchange: changed })), field('Bing verification code', bind(st.verification, 'bing', { onchange: changed }))),
      h('div', { class: 'toolbar' }, toggle(st.analytics, 'events', 'Count anonymous study events'), toggle(st.features, 'reports', '“Report a mistake” buttons'), toggle(st.features, 'contact_form', 'Contact form'))),
    ed.problems, ed.foot);
  ed.refresh();
}

async function viewInbox(kind = 'reports', status = 'open') {
  if (!S.me.db) { app.replaceChildren(h('h1', null, 'Inbox'), h('p', null, 'Connect the D1 database to receive mistake reports and contact messages (README → Cloudflare setup).')); return; }
  const r = await api(`/api/admin/inbox?kind=${kind}&status=${status}`);
  const tab = (k, s, label) => h('a', { class: 'btn small ' + (k === kind && s === status ? '' : 'ghost'), href: `#/inbox?kind=${k}&status=${s}` }, label);
  app.replaceChildren(h('h1', null, 'Inbox'),
    h('div', { class: 'toolbar' }, tab('reports', 'open', `Mistake reports (${r.counts.reports})`), tab('messages', 'open', `Messages (${r.counts.messages})`), tab(kind, 'done', 'Done')),
    r.items.length ? h('div', { class: 'cards' }, r.items.map(it => h('div', { class: 'panel' },
      h('p', { class: 'muted small' }, new Date(it.created_at * 1000).toLocaleString()),
      kind === 'reports' ? [h('p', null, h('a', { href: it.page, target: '_blank', rel: 'noopener' }, it.title || it.page), ' ', h('a', { href: '#/open?url=' + encodeURIComponent(it.page) }, '(edit)')), it.item ? h('p', { class: 'small' }, h('b', null, it.item)) : null]
        : h('p', null, h('b', null, it.name), it.email ? [' · ', h('a', { href: 'mailto:' + it.email }, it.email)] : null),
      h('p', null, it.message),
      h('button', { class: 'btn small ' + (status === 'open' ? '' : 'ghost'), type: 'button', onclick: async () => { await api('/api/admin/inbox', { method: 'POST', body: { kind, id: it.id, status: status === 'open' ? 'done' : 'open' } }); route(); } }, status === 'open' ? 'Mark done' : 'Reopen')))) : h('p', { class: 'muted' }, 'Nothing here. 🎉'));
}

async function viewOpen(url) {
  const slug = (url || '').split('/').pop();
  const type = url.startsWith('/papers/') ? 'papers' : url.startsWith('/labs/') ? 'labs' : 'lessons';
  const f = (await list(type)).find(x => x.slug === slug);
  if (f) location.replace(editorRoute(f)); else app.replaceChildren(h('p', null, 'Could not find the file for ' + url));
}

async function viewInsights(days = 30) {
  if (!S.me.db) { app.replaceChildren(h('h1', null, 'Insights'), h('p', null, 'Connect the D1 database to see what students study and search for. Page views are in Cloudflare → Web Analytics.')); return; }
  const r = await api('/api/admin/insights?days=' + days);
  const max = Math.max(1, ...r.perDay.map(d => d.n));
  const tbl = (title, rows, hint) => h('div', null, h('h2', null, title), hint ? h('p', { class: 'muted small' }, hint) : null,
    rows.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, h('tbody', null, rows.map(x => h('tr', null, h('td', null, x.key), h('td', null, x.n)))))) : h('p', { class: 'muted' }, 'No data yet.'));
  app.replaceChildren(h('h1', null, 'Insights'),
    h('div', { class: 'toolbar' }, [7, 30, 90].map(d => h('a', { class: 'btn small ' + (d === days ? '' : 'ghost'), href: '#/insights?days=' + d }, `Last ${d} days`))),
    h('h2', null, 'Study sessions per day'), h('div', { class: 'panel' }, r.perDay.length ? null : h('p', { class: 'muted' }, 'No data yet.'), h('div', { class: 'bars', hidden: !r.perDay.length, role: 'img', 'aria-label': 'Study sessions per day' }, r.perDay.map(d => h('span', { title: `${d.day}: ${d.n}`, style: `height:${Math.round(100 * d.n / max)}%` })))),
    h('div', { class: 'split' }, tbl('Most studied chapters', r.studied), tbl('What students search for', r.searches, 'Searches for topics you have not covered yet are ideas for new lessons.')),
    h('div', { class: 'split' }, tbl('Finished quizzes (chapter · mode · score)', r.quizzes, 'Many low scores on one chapter suggest the notes need another worked example.'), tbl('Timed paper attempts', r.papers)),
    tbl('House ad clicks', r.houseAds));
}

// ---------------------------------------------------------------- router

async function route() {
  setNav();
  const [hashPath, query] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query || '');
  const p = params.get('path');
  window.scrollTo(0, 0);
  try {
    if (hashPath === '/' || hashPath === '') await viewHome();
    else if (hashPath.startsWith('/list/')) await viewList(hashPath.slice(6));
    else if (hashPath === '/edit/mcq') await viewMcq(p);
    else if (hashPath === '/edit/notes') await viewNotes(p, false);
    else if (hashPath === '/edit/page') await viewNotes(p, true);
    else if (hashPath === '/edit/paper') await viewPaper(p);
    else if (hashPath === '/edit/lab') await viewLab(p);
    else if (hashPath === '/settings') await viewSettings();
    else if (hashPath === '/inbox') await viewInbox(params.get('kind') || 'reports', params.get('status') || 'open');
    else if (hashPath === '/insights') await viewInsights(+params.get('days') || 30);
    else if (hashPath === '/open') await viewOpen(params.get('url') || '');
    else app.replaceChildren(h('p', null, 'Page not found. '), h('a', { href: '#/' }, 'Go home'));
  } catch (e) {
    if (e.message !== 'signed out') app.replaceChildren(h('h1', null, 'Something went wrong'), h('p', null, e.message), h('p', null, h('a', { href: '#/' }, 'Back to the dashboard')));
  }
}

async function start() {
  try {
    [S.me, S.syllabus] = await Promise.all([api('/api/admin/me'), fetch('/assets/syllabus.json').then(r => r.json())]);
  } catch (e) {
    if (e.message !== 'signed out') app.replaceChildren(h('p', null, 'Could not load the admin: ' + e.message));
    return;
  }
  document.querySelector('[data-user]').textContent = S.me.user.name + (S.me.user.role === 'admin' ? '' : ' (editor)');
  document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = S.me.user.role !== 'admin'; });
  document.querySelector('[data-logout]').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.href = '/admin/login'; });
  if (S.me.db) api('/api/admin/inbox').then(r => {
    const n = r.counts.reports + r.counts.messages;
    const pill = document.querySelector('[data-inbox-count]');
    pill.textContent = n; pill.hidden = !n;
  }).catch(() => {});
  addEventListener('hashchange', route);
  route();
}
start();
