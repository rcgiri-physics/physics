// Shared admin rules: the JavaScript validator must agree with build.py on every real content file,
// and the paste parser must handle the common layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateFile, validateMcqSet, classifyPath, checkHtml, buildFrontMatter, parseFrontMatter, slugify } from '../admin/shared/validate.js';
import { parseQuestions } from '../admin/shared/parse.js';

const root = new URL('..', import.meta.url).pathname;
const content = JSON.parse(readFileSync(root + 'src/content.json', 'utf8'));
const syllabus = { grades: Object.fromEntries(Object.entries(content.grades).map(([g, gr]) => [g, { chapters: gr.syllabus.map(c => ({ n: c.n, title: c.title, area: c.area })) }])) };

test('every content file that build.py accepts is also accepted by the admin validator', () => {
  execFileSync('python3', [root + 'build.py', '--check'], { stdio: 'pipe' });   // throws if build.py finds problems
  for (const dir of ['lessons', 'papers', 'labs', 'pages']) {
    for (const name of readdirSync(root + 'src/' + dir)) {
      const path = `src/${dir}/${name}`;
      const problems = validateFile(path, readFileSync(root + path, 'utf8'), syllabus);
      assert.deepEqual(problems, [], path);
    }
  }
});

test('only content paths are writable', () => {
  assert.equal(classifyPath('src/lessons/waves-mcq.json').kind, 'mcq');
  assert.equal(classifyPath('src/assets/img/lens-diagram.webp').kind, 'image');
  for (const bad of ['build.py', 'src/content.json', '.github/workflows/check.yml', 'src/lessons/../build.py', 'src/lessons/Bad Name.json', 'worker/index.js']) {
    assert.equal(classifyPath(bad), null, bad);
  }
});

test('unsafe HTML is refused', () => {
  assert.ok(checkHtml('<p onclick="x()">hi</p>').length);
  assert.ok(checkHtml('<a href="javascript:alert(1)">x</a>').length);
  assert.ok(checkHtml('<iframe src="https://x"></iframe>').length);
  assert.ok(checkHtml('<img src="https://elsewhere.com/a.png">').length);
  assert.deepEqual(checkHtml('<p>Fine \\( v = u + at \\)</p><img src="/assets/img/a.webp" alt="">'), []);
});

test('MCQ rules', () => {
  const ok = { title: 'T', grade: 'XI', chapters: [3], date: '2026-01-01', questions: [{ q: 'Q?', options: ['a', 'b'], answer: 1 }] };
  assert.deepEqual(validateMcqSet(ok, syllabus), []);
  assert.match(validateMcqSet({ ...ok, chapters: [40] }, syllabus).join(), /no chapter 40/);
  assert.match(validateMcqSet({ ...ok, questions: [{ q: 'Q?', options: ['a', 'a'], answer: 0 }] }, syllabus).join(), /identical/);
  assert.match(validateMcqSet({ ...ok, questions: [{ q: 'Q?', options: ['a', 'b'], answer: 2 }] }, syllabus).join(), /correct option/);
});

test('front matter round trip', () => {
  const text = buildFrontMatter({ title: 'Waves', grade: 'XII', chapters: [4, 5], date: '2026-01-01' }, '<h2>A</h2>');
  const { meta, body } = parseFrontMatter(text);
  assert.deepEqual(meta.chapters, [4, 5]);
  assert.equal(meta.title, 'Waves');
  assert.equal(body.trim(), '<h2>A</h2>');
  assert.equal(slugify('Ohm’s Law — Verification!'), 'ohm-s-law-verification');
});

test('paste parser handles common layouts', () => {
  const r = parseQuestions(`1. The SI unit of force is
a) newton b) joule c) watt d) pascal
Ans: a
Explanation: F = ma.
2) Which is a vector?
(a) mass
(b) *velocity
(c) speed
Q3. Work is? a) scalar b) vector
Answer: (A)`);
  assert.equal(r.questions.length, 3);
  assert.deepEqual(r.questions[0].options, ['newton', 'joule', 'watt', 'pascal']);
  assert.equal(r.questions[0].answer, 0);
  assert.equal(r.questions[0].explanation, 'F = ma.');
  assert.equal(r.questions[1].answer, 1);
  assert.equal(r.questions[2].answer, 0);
  assert.deepEqual(r.warnings, []);
});
