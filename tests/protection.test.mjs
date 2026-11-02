// Answer-key scrambling: every built quiz and paper page must decode (in the browser's way) to exactly
// the answers and explanations in the source files, and must not contain them in plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const win = {};
vm.runInNewContext(readFileSync(root + 'src/assets/js/unlock.js', 'utf8'), { window: win, atob, TextEncoder, TextDecoder, Uint8Array, Math, JSON });
const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

test('quiz answers decode correctly and are not in the page source', () => {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [root + 'build.py'], { stdio: 'pipe' });
  let checked = 0;
  for (const name of readdirSync(root + 'src/lessons').filter(n => n.endsWith('.json'))) {
    const slug = name.replace(/\.json$/, '');
    const src = JSON.parse(readFileSync(root + 'src/lessons/' + name, 'utf8'));
    const html = readFileSync(`${root}public/posts/${slug}.html`, 'utf8');
    assert.ok(!/data-answer=/.test(html) && !/acceptedAnswer/.test(html), slug + ': plain answer key in page');
    const items = html.split('<li class="question" ').slice(1).map(chunk => {
      const m = chunk.match(/^data-i="(\d+)" data-k="([^"]+)"/);
      return [chunk.split('<div class="explanation"')[0], m[1], m[2]];
    });
    assert.equal(items.length, src.questions.length, slug);
    for (const [block, i, k] of items) {
      const q = src.questions[+i];
      const d = win.pdUnlock(`${slug}:${i}`, k);
      const shown = [...block.matchAll(/<span class="opt-text">([\s\S]*?)<\/span>/g)].map(m => unescape(m[1]));
      assert.equal(shown[d.a], q.options[q.answer], `${slug} q${+i + 1}: decoded answer`);
      assert.equal(d.e, q.explanation || '', `${slug} q${+i + 1}: decoded explanation`);
      if (q.explanation && q.explanation.length > 40) assert.ok(!html.includes(q.explanation.slice(-40).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')), `${slug} q${+i + 1}: explanation visible in source`);
      checked++;
    }
  }
  assert.ok(checked > 2000, `checked ${checked} questions`);
});

test('paper MCQ answers decode correctly', () => {
  const src = JSON.parse(readFileSync(root + 'src/papers/grade-xii-model-2082-set-1.json', 'utf8'));
  const html = readFileSync(root + 'public/papers/grade-xii-model-2082-set-1.html', 'utf8');
  const items = [...html.matchAll(/data-id="([^"]+)" data-k="([^"]+)"/g)];
  const mcqs = src.groups[0].questions;
  assert.equal(items.length, mcqs.length);
  items.forEach(([, id, k], n) => assert.equal(win.pdUnlock(id, k).a, mcqs[n].answer, id));
  assert.ok(!/data-answer=/.test(html));
});
