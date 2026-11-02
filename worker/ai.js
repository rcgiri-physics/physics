// AI help in the admin editors, through llm-free-cascade: one request goes to the first free-tier LLM
// provider that has a key (Groq, Gemini, Cerebras, Mistral, OpenRouter, Cloudflare Workers AI, …) and
// falls through to the next when one is rate-limited or down. Nothing is ever published by the AI: the
// result is loaded into the editor, where a person checks it and presses Publish.
//
// Keys are Worker secrets with the package's usual names: GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY,
// MISTRAL_API_KEY, OPENROUTER_API_KEY, … (GROQ_API_KEY_2 … _9 or comma-separated values for extra keys),
// and CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID for Workers AI. Optional: LLM_PROVIDER_ORDER=groq,gemini,
// and LLM_CUSTOM_PROVIDERS (JSON) for any OpenAI-compatible endpoint, e.g. a self-hosted gateway.
import { LLMCascade, PROVIDER_INFO, parseJsonLoose } from 'llm-free-cascade';
import { validateQuestions, validateLab, validatePaper } from '../admin/shared/validate.js';

let cached = null;   // one cascade per Worker instance, so cooldowns carry over between requests

export function keysFromEnv(env) {
  const keys = {};
  for (const [provider, info] of Object.entries(PROVIDER_INFO)) {
    if (!info.envVar) continue;
    const found = [];
    for (const part of String(env[info.envVar] || '').split(',')) if (part.trim()) found.push(part.trim());
    for (let i = 2; i <= 9; i++) if (env[`${info.envVar}_${i}`]) found.push(String(env[`${info.envVar}_${i}`]).trim());
    if (found.length) keys[provider] = [...new Set(found)];
  }
  return keys;
}

/** Extra OpenAI-compatible providers (Ollama, a gateway…) as JSON, same format as the package's LLM_CUSTOM_PROVIDERS. */
export function customFromEnv(env) {
  try { const c = JSON.parse(env.LLM_CUSTOM_PROVIDERS || '{}'); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch (e) { return {}; }
}

export function cascade(env) {
  if (cached && cached.env === env) return cached.c;
  const keys = keysFromEnv(env);
  const custom = customFromEnv(env);
  if (!Object.keys(keys).length && !Object.keys(custom).length) return null;
  const order = String(env.LLM_PROVIDER_ORDER || '').trim();
  const c = new LLMCascade({
    keys,
    custom,
    order: order ? order.split(',').map(s => s.trim().toLowerCase()) : undefined,
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    timeoutMs: 60000,
    deadlineMs: 110000,
    maxTokensLimit: 12000,
    appName: 'Physics Decoded admin',
  });
  cached = { env, c };
  return c;
}

export function configuredProviders(env) {
  return [...Object.keys(keysFromEnv(env)), ...Object.keys(customFromEnv(env))];
}

const STYLE = `You write for "Physics Decoded", a free study site for Grade XI and XII physics in Nepal (NEB curriculum 2076).
Write clear, correct, exam-focused English for 16–18 year old students. Use SI units. For symbols use Unicode
(ω, λ, μ, θ, Δ, ε₀, ², ³, √, ×, ≈, →); use LaTeX only inside \\( … \\) when a formula cannot be written in Unicode.
Double-check every numerical answer before you give it. Never invent facts about the NEB exam.
Output ONLY one JSON object, with no commentary and no markdown fences.`;

const MCQ_SHAPE = `{"questions":[{"q":"question text","options":["A","B","C","D"],"answer":<0-3, index of the correct option>,
"explanation":"1–3 sentences; for numericals show the working","difficulty":"easy"|"medium"|"hard"}]}`;

function chapterLine(syllabus, grade, chapter) {
  const ch = syllabus && syllabus.grades[grade] && syllabus.grades[grade].chapters.find(c => c.n === +chapter);
  return ch ? `Grade ${grade}, chapter ${ch.n}: ${ch.title} (${ch.area})` : `Grade ${grade}`;
}

const clip = (s, n) => String(s || '').slice(0, n);

/** Keep the questions that pass the site's rules; fail (so the next provider is tried) if none do. */
function parseQuestions(text) {
  const obj = parseJsonLoose(text);
  const list = Array.isArray(obj) ? obj : obj && obj.questions;
  if (!Array.isArray(list) || !list.length) throw new Error('no questions in the response');
  const good = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const q = { q: String(raw.q || raw.question || '').trim(), options: (raw.options || []).map(o => String(o).trim()),
      answer: Number.isInteger(raw.answer) ? raw.answer : null };
    if (raw.explanation) q.explanation = String(raw.explanation).trim();
    if (['easy', 'medium', 'hard'].includes(raw.difficulty)) q.difficulty = raw.difficulty;
    if (!validateQuestions([q]).length) good.push(q);
  }
  if (!good.length) throw new Error('none of the questions passed the checks');
  return { questions: good, dropped: list.length - good.length };
}

export const TASKS = {
  'mcq-generate': {
    maxTokens: 9000,
    build: (p, syllabus) => ({
      system: STYLE,
      user: `Write ${Math.min(Math.max(+p.count || 10, 1), 25)} new multiple-choice questions for ${chapterLine(syllabus, p.grade, p.chapter)}.
${p.topics ? `Cover these topics: ${clip(p.topics, 500)}.` : 'Cover the important topics of the chapter.'}
Difficulty mix: ${clip(p.mix || 'about 40% easy, 40% medium, 20% hard', 120)}. Include numerical problems where the chapter has them.
${p.avoid && p.avoid.length ? `Do not repeat these existing questions:\n- ${p.avoid.slice(0, 60).map(s => clip(s, 140)).join('\n- ')}` : ''}
Rules: exactly 4 options, all different, exactly one correct; spread the correct answers across positions 0–3;
no "All of the above" or "None of the above"; the explanation must agree with the marked answer.
Shape: ${MCQ_SHAPE}`,
    }),
    parse: parseQuestions,
  },
  'mcq-convert': {
    maxTokens: 10000,
    build: (p, syllabus) => ({
      system: STYLE,
      user: `Convert the multiple-choice questions pasted below into JSON for ${chapterLine(syllabus, p.grade, p.chapter)}.
Keep each question's meaning and options; fix only obvious typos, broken symbols and formatting.
If the answer is given, use it. If it is missing, solve the question and set the answer yourself.
Add a short explanation when one is missing, and set the difficulty. Skip anything that is not a complete MCQ.
Shape: ${MCQ_SHAPE}

PASTED TEXT:
"""
${clip(p.text, 24000)}
"""`,
    }),
    parse: parseQuestions,
  },
  'mcq-check': {
    maxTokens: 2500,
    build: (p) => ({
      system: STYLE,
      user: `Check this multiple-choice question independently. Solve it yourself first, then compare with the marked answer.
Question: ${clip(p.q, 2000)}
Options: ${(p.options || []).map((o, i) => `${'ABCDEF'[i]}) ${clip(o, 300)}`).join('  ')}
Marked answer: ${'ABCDEF'[p.answer] || 'none'}
Return {"correct": <index of the option you believe is correct>, "agrees": true|false, "confidence": "high"|"medium"|"low",
"explanation": "a short student-friendly explanation of the correct answer", "issues": "problems with the wording or options, or empty"}`,
    }),
    parse: text => {
      const o = parseJsonLoose(text);
      if (!o || !Number.isInteger(o.correct)) throw new Error('no verdict');
      return { correct: o.correct, agrees: !!o.agrees, confidence: String(o.confidence || ''), explanation: String(o.explanation || ''), issues: String(o.issues || '') };
    },
  },
  'lab-draft': {
    maxTokens: 9000,
    build: (p, syllabus) => ({
      system: STYLE + '\nHTML fields may use only <p>, <strong>, <em>, <sub>, <sup>, <ul>, <ol>, <li>, <br> and <div class="formula">\\[ … \\]</div>. No style attributes, no scripts.',
      user: `Write the lab practical "${clip(p.title, 200)}" for ${chapterLine(syllabus, p.grade, p.chapter)}, the way a Grade ${p.grade} student writes it in a lab copy.
Return {"aim": "html", "apparatus": ["…"], "theory": "html with the formula used", "procedure": ["step", …],
"observations": [{"caption": "Table 1: …", "headers": ["S.N.", …], "rows": [[1, …], …], "note": "These are sample readings…"}],
"calculation": "html", "result": "html", "precautions": ["…"], "errors": ["…"], "viva": [{"q": "…", "a": "html"}]}.
Use realistic, self-consistent sample readings (5 rows) and make the calculation and result follow from them exactly.
Give 4–6 viva questions.`,
    }),
    parse: text => {
      const o = parseJsonLoose(text);
      if (!o || !o.aim || !Array.isArray(o.procedure)) throw new Error('incomplete practical');
      const problems = validateLab({ title: 'x', grade: 'XI', date: '2026-01-01', ...o }, null);
      if (problems.length) throw new Error(problems[0]);
      return o;
    },
  },
  'paper-convert': {
    maxTokens: 12000,
    build: (p) => ({
      system: STYLE + '\nHTML fields may use only <p>, <strong>, <em>, <sub>, <sup>, <ul>, <ol>, <li>, <br>, <table>, <tr>, <th>, <td> and <div class="formula">…</div>.',
      user: `Convert this exam paper into JSON. Keep the wording. Number nothing yourself (the site numbers questions).
Return {"groups": [{"title": "Group A", "subtitle": "Multiple choice questions", "marks": "11 × 1 = 11", "instructions": "…",
"questions": [ MCQ: {"q": "html", "options": ["…"], "answer": <index>, "solution": "html"} |
 single: {"q": "html", "marks": 5, "solution": "html"} |
 multi-part: {"parts": [{"q": "html", "marks": 2, "solution": "html"}, …]} ;
 any question may have "or": {an alternative question with the same marks} ] }]}
${p.solve ? 'Write a concise model solution for every question that has none.' : 'Include solutions only where the text gives them.'}

PAPER:
"""
${clip(p.text, 30000)}
"""`,
    }),
    parse: text => {
      const o = parseJsonLoose(text);
      if (!o || !Array.isArray(o.groups) || !o.groups.length) throw new Error('no groups');
      const { problems } = validatePaper({ title: 'x', grade: 'XII', year: 2082, date: '2026-01-01', ...o }, null);
      if (problems.length > 3) throw new Error(problems[0]);
      return { groups: o.groups, problems };
    },
  },
};

export async function runTask(env, task, params, syllabus) {
  const def = TASKS[task];
  if (!def) return { status: 400, body: { error: 'Unknown AI task.' } };
  const c = cascade(env);
  if (!c) return { status: 503, body: { error: 'No AI keys are set. Add at least one free key (e.g. GROQ_API_KEY or GEMINI_API_KEY) as a Worker secret.' } };
  const { system, user } = def.build(params || {}, syllabus);
  try {
    const r = await c.generate({ system, user, json: true, noThinking: true, maxTokens: def.maxTokens, parse: def.parse });
    return { status: 200, body: { result: r.parsed, provider: r.provider, skipped: (r.attempts || []).map(a => a.provider) } };
  } catch (e) {
    const busy = e && e.code === 'ALL_RATE_LIMITED';
    return { status: busy ? 429 : 502, body: { error: busy ? 'Every AI provider is busy right now (free-tier limits). Try again in a minute.'
      : 'The AI could not produce valid questions this time. Try again, or with fewer questions.' } };
  }
}
