// Content rules shared by the admin editors (in the browser) and the Worker (before it commits).
// They mirror build.py, which stays the final check: anything that slips through is skipped by the
// build and reported in CI, never published broken. Keep the two in step when a rule changes.

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IMG_RE = /^\/assets\/img\/[A-Za-z0-9._/-]+$/;

export const FORBIDDEN_IN_HTML = [
  [/<\s*(html|head|body|!doctype)\b/i, 'full-page tags'],
  [/<\s*style\b/i, '<style> blocks'],
  [/<\s*script\b/i, '<script> tags'],
  [/<\s*link\b/i, '<link> tags'],
  [/<\s*(iframe|object|embed|form)\b/i, '<iframe>, <object>, <embed> or <form> tags'],
  [/\sstyle\s*=/i, 'style="…" attributes'],
  [/\son[a-z]+\s*=/i, 'on…="…" event attributes (onclick etc.)'],
  [/javascript\s*:/i, 'javascript: links'],
];

export function slugify(text) {
  return String(text || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'untitled';
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = v => Number.isInteger(v);
const isText = v => typeof v === 'string' && v.trim().length > 0;

export function checkHtml(fragment, where = '') {
  const out = [];
  const pre = where ? where + ': ' : '';
  if (typeof fragment !== 'string') return [pre + 'must be text'];
  if (/^\s*<!doctype/i.test(fragment)) return [pre + 'full web pages are not accepted; paste only the content'];
  for (const [re, what] of FORBIDDEN_IN_HTML) if (re.test(fragment)) out.push(`${pre}must not contain ${what}`);
  for (const svg of fragment.match(/<svg\b[^>]*>/gi) || []) if (!/\bviewBox=/.test(svg)) out.push(pre + 'every <svg> needs a viewBox');
  for (const m of fragment.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) if (!m[1].startsWith('/assets/img/')) out.push(`${pre}images must be uploaded to /assets/img/ (got ${m[1].slice(0, 60)})`);
  return out;
}

function checkDate(meta, out) {
  if (!DATE_RE.test(String(meta.date || ''))) out.push('date must look like 2026-01-31');
}

function chapterSet(syllabus, grade) {
  const g = syllabus && syllabus.grades && syllabus.grades[grade];
  return g ? new Set(g.chapters.map(c => c.n)) : null;
}

function checkChapters(meta, syllabus, out, required = true) {
  const grades = syllabus ? Object.keys(syllabus.grades) : ['XI', 'XII'];
  if (!grades.includes(meta.grade)) { out.push(`grade must be one of ${grades.join(', ')}`); return; }
  let ch = meta.chapters;
  if (ch === undefined && !required) return;
  if (isInt(ch)) ch = [ch];
  if (!Array.isArray(ch) || (required && !ch.length)) { out.push('choose at least one chapter'); return; }
  const valid = chapterSet(syllabus, meta.grade);
  for (const n of ch) if (valid && !valid.has(n)) out.push(`grade ${meta.grade} has no chapter ${n}`);
}

export function validateQuestions(qs) {
  const out = [];
  if (!Array.isArray(qs) || !qs.length) return ['add at least one question'];
  const seen = new Map();
  const allowed = new Set(['q', 'options', 'answer', 'explanation', 'difficulty', 'image', 'image_alt', 'source']);
  qs.forEach((q, i) => {
    const w = `question ${i + 1}`;
    if (!q || typeof q !== 'object') { out.push(`${w} is not an object`); return; }
    const extra = Object.keys(q).filter(k => !allowed.has(k));
    if (extra.length) out.push(`${w}: unknown field(s) ${extra.join(', ')}`);
    if (!isText(q.q)) out.push(`${w}: the question text is missing`);
    else if (seen.has(q.q.trim())) out.push(`${w}: same question text as question ${seen.get(q.q.trim())}`);
    else seen.set(q.q.trim(), i + 1);
    const o = q.options;
    if (!Array.isArray(o) || o.length < 2 || o.length > 6 || !o.every(isText)) { out.push(`${w}: needs 2–6 non-empty options`); return; }
    if (new Set(o.map(s => s.trim())).size !== o.length) out.push(`${w}: two options are identical`);
    if (!isInt(q.answer) || q.answer < 0 || q.answer >= o.length) out.push(`${w}: mark the correct option`);
    if (q.difficulty !== undefined && !DIFFICULTIES.includes(q.difficulty)) out.push(`${w}: difficulty must be easy, medium or hard`);
    for (const f of ['explanation', 'source', 'image_alt']) if (q[f] !== undefined && typeof q[f] !== 'string') out.push(`${w}: ${f} must be text`);
    if (q.image !== undefined && !IMG_RE.test(q.image)) out.push(`${w}: image must be a path like /assets/img/diagram.webp`);
  });
  return out;
}

export function validateMcqSet(obj, syllabus) {
  const out = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['the file must be one JSON object'];
  for (const f of ['title', 'grade', 'chapters', 'date']) if (obj[f] === undefined || obj[f] === '') out.push(`missing ${f}`);
  checkChapters(obj, syllabus, out);
  checkDate(obj, out);
  if (obj.video && !/^https:\/\//.test(obj.video)) out.push('video must be a https:// link');
  return out.concat(validateQuestions(obj.questions));
}

function paperQuestion(q, w, out, allowOr = true) {
  if (!q || typeof q !== 'object') { out.push(`${w} is not an object`); return 0; }
  const allowed = new Set(['q', 'marks', 'options', 'answer', 'solution', 'parts', 'or', 'image', 'image_alt']);
  const extra = Object.keys(q).filter(k => !allowed.has(k));
  if (extra.length) out.push(`${w}: unknown field(s) ${extra.join(', ')}`);
  if (q.or && !allowOr) out.push(`${w}: an OR alternative cannot have its own OR`);
  for (const f of ['q', 'solution']) if (q[f] !== undefined) out.push(...checkHtml(q[f], `${w} ${f}`));
  let marks = 0;
  if (q.parts !== undefined) {
    if (!Array.isArray(q.parts) || !q.parts.length) { out.push(`${w}: parts must be a non-empty list`); return 0; }
    q.parts.forEach((p, i) => {
      const pw = `${w} part ${'abcdefgh'[i] || i + 1}`;
      if (!p || !isText(p.q)) { out.push(`${pw}: needs question text`); return; }
      out.push(...checkHtml(p.q, pw));
      if (p.solution !== undefined) out.push(...checkHtml(p.solution, pw + ' solution'));
      if (!isNum(p.marks) || p.marks <= 0) out.push(`${pw}: marks must be a positive number`);
      else marks += p.marks;
    });
  } else {
    if (!isText(q.q)) out.push(`${w}: needs question text or parts`);
    if (q.options !== undefined) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6 || !q.options.every(isText)) out.push(`${w}: needs 2–6 non-empty options`);
      else if (!isInt(q.answer) || q.answer < 0 || q.answer >= q.options.length) out.push(`${w}: mark the correct option`);
      marks = q.marks ?? 1;
    } else {
      marks = q.marks;
      if (!isNum(marks) || marks <= 0) { out.push(`${w}: marks must be a positive number`); marks = 0; }
    }
  }
  if (q.image !== undefined && !IMG_RE.test(q.image)) out.push(`${w}: image must be a path like /assets/img/diagram.webp`);
  if (allowOr && q.or) {
    const alt = paperQuestion(q.or, `${w} (OR)`, out, false);
    if (alt && marks && alt !== marks) out.push(`${w}: the OR alternative is worth ${alt} marks but the question is worth ${marks}`);
  }
  return marks;
}

export function validatePaper(obj, syllabus) {
  const out = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { problems: ['the file must be one JSON object'], total: 0 };
  for (const f of ['title', 'grade', 'year', 'date']) if (obj[f] === undefined || obj[f] === '') out.push(`missing ${f}`);
  const grades = syllabus ? Object.keys(syllabus.grades) : ['XI', 'XII'];
  if (!grades.includes(obj.grade)) out.push(`grade must be one of ${grades.join(', ')}`);
  if (!/^\d{4}$/.test(String(obj.year || ''))) out.push('year must be four digits, e.g. 2082');
  checkDate(obj, out);
  let total = 0;
  if (!Array.isArray(obj.groups) || !obj.groups.length) out.push('add at least one group');
  else obj.groups.forEach((g, gi) => {
    if (!g || !isText(g.title) || !Array.isArray(g.questions) || !g.questions.length) { out.push(`group ${gi + 1}: needs a title and at least one question`); return; }
    g.questions.forEach((q, qi) => { total += paperQuestion(q, `${g.title} question ${qi + 1}`, out); });
  });
  if (obj.full_marks !== undefined && obj.full_marks !== null && obj.full_marks !== '' && Math.abs(total - obj.full_marks) > 1e-9) {
    out.push(`the questions add up to ${total} marks but full marks is ${obj.full_marks}`);
  }
  return { problems: out, total };
}

const LAB_LISTS = ['apparatus', 'procedure', 'precautions', 'errors'];
const LAB_HTML = ['aim', 'theory', 'calculation', 'result', 'conclusion'];

export function validateLab(obj, syllabus) {
  const out = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['the file must be one JSON object'];
  const allowed = new Set(['title', 'grade', 'chapters', 'date', 'number', 'description', 'video', 'diagram', 'observations', 'viva', ...LAB_LISTS, ...LAB_HTML]);
  const extra = Object.keys(obj).filter(k => !allowed.has(k));
  if (extra.length) out.push(`unknown field(s) ${extra.join(', ')}`);
  for (const f of ['title', 'grade', 'date', 'aim', 'apparatus', 'procedure']) {
    if (!obj[f] || (Array.isArray(obj[f]) && !obj[f].length)) out.push(`missing ${f}`);
  }
  checkChapters(obj, syllabus, out, false);
  checkDate(obj, out);
  for (const f of LAB_HTML) if (obj[f] !== undefined) out.push(...checkHtml(obj[f], f));
  for (const f of LAB_LISTS) if (obj[f] !== undefined) {
    if (!Array.isArray(obj[f]) || !obj[f].every(isText)) out.push(`${f} must be a list of text items`);
    else obj[f].forEach((x, i) => out.push(...checkHtml(x, `${f} item ${i + 1}`)));
  }
  if (obj.number !== undefined && !isInt(obj.number)) out.push('experiment number must be a whole number');
  if (obj.diagram !== undefined && (!obj.diagram || !IMG_RE.test(obj.diagram.src || '') || !isText(obj.diagram.alt))) out.push('diagram needs an uploaded image and a description (alt text)');
  (obj.observations || []).forEach((t, i) => {
    if (!t || !Array.isArray(t.headers) || !Array.isArray(t.rows)) { out.push(`observation table ${i + 1}: needs headers and rows`); return; }
    t.rows.forEach((r, ri) => { if (!Array.isArray(r) || r.length !== t.headers.length) out.push(`observation table ${i + 1} row ${ri + 1}: must have ${t.headers.length} cells`); });
  });
  (obj.viva || []).forEach((v, i) => {
    if (!v || !isText(v.q) || !isText(v.a)) out.push(`viva question ${i + 1}: needs a question and an answer`);
    else out.push(...checkHtml(v.a, `viva ${i + 1} answer`));
  });
  if (obj.video && !/^https:\/\//.test(obj.video)) out.push('video must be a https:// link');
  return out;
}

export function parseFrontMatter(text) {
  const m = /^﻿?---\s*\n([\s\S]*?)\n---\s*\n/.exec(text);
  if (!m) return { meta: {}, body: text, problems: ['missing the --- front matter block at the top'] };
  const meta = {}, problems = [];
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) { problems.push(`front matter line is not "key: value": ${line}`); continue; }
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (/^[[{]/.test(value)) { try { value = JSON.parse(value); } catch (e) { problems.push(`could not read ${key}`); } }
    meta[key] = value;
  }
  return { meta, body: text.slice(m[0].length), problems };
}

export function buildFrontMatter(meta, body) {
  const lines = Object.entries(meta).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v).replace(/,/g, ', ') : String(v).replace(/\n/g, ' ')}`);
  return `---\n${lines.join('\n')}\n---\n\n${String(body || '').trim()}\n`;
}

export function validateNotes(text, syllabus) {
  const { meta, body, problems } = parseFrontMatter(text);
  const out = [...problems];
  for (const f of ['title', 'grade', 'chapters', 'date']) if (!meta[f]) out.push(`missing ${f}`);
  checkChapters(meta, syllabus, out);
  checkDate(meta, out);
  return out.concat(checkHtml(body));
}

export function validatePage(text) {
  const { meta, body, problems } = parseFrontMatter(text);
  const out = [...problems];
  if (!meta.title) out.push('missing title');
  return out.concat(checkHtml(body));
}

/** Where a file may be written, and how to check it. Anything else is refused by the Worker. */
export const WRITABLE = [
  { re: /^src\/lessons\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/, kind: 'mcq' },
  { re: /^src\/lessons\/([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/, kind: 'notes' },
  { re: /^src\/papers\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/, kind: 'paper' },
  { re: /^src\/labs\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/, kind: 'lab' },
  { re: /^src\/pages\/([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/, kind: 'page', admin: true },
  { re: /^src\/settings\.json$/, kind: 'settings', admin: true },
  { re: /^src\/assets\/img\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(png|jpe?g|webp)$/, kind: 'image' },
];

export function classifyPath(path) {
  for (const w of WRITABLE) if (w.re.test(path)) return w;
  return null;
}

export function validateSettings(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return ['settings must be a JSON object'];
  const ads = obj.ads || {};
  if (ads.adsense_client && !/^ca-pub-\d{10,20}$/.test(ads.adsense_client)) out.push('AdSense client must look like ca-pub-1234567890123456');
  for (const [k, v] of Object.entries(ads.slots || {})) if (v && !/^\d{6,12}$/.test(v)) out.push(`ad slot "${k}" must be the numeric slot ID from AdSense`);
  (ads.house_ads || []).forEach((h, i) => {
    if (!h.title || !/^https:\/\//.test(h.url || '')) out.push(`house ad ${i + 1}: needs a title and a https:// link`);
  });
  if (obj.announcement && obj.announcement.link && !/^(https:\/\/|\/)/.test(obj.announcement.link)) out.push('announcement link must start with https:// or /');
  return out;
}

/** Validate any file the admin can write. `text` is the file content (images are not checked here). */
export function validateFile(path, text, syllabus) {
  const w = classifyPath(path);
  if (!w) return ['this file cannot be edited from the admin'];
  const json = () => { try { return [JSON.parse(text), null]; } catch (e) { return [null, 'invalid JSON: ' + e.message]; } };
  switch (w.kind) {
    case 'mcq': { const [o, err] = json(); return err ? [err] : validateMcqSet(o, syllabus); }
    case 'paper': { const [o, err] = json(); return err ? [err] : validatePaper(o, syllabus).problems; }
    case 'lab': { const [o, err] = json(); return err ? [err] : validateLab(o, syllabus); }
    case 'settings': { const [o, err] = json(); return err ? [err] : validateSettings(o); }
    case 'notes': return validateNotes(text, syllabus);
    case 'page': return validatePage(text);
    default: return [];
  }
}
