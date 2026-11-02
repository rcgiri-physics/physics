// Turn pasted text into MCQs without AI. Ported from MCQplex's utils/questionTextParser.js and adapted
// to Physics Decoded's format ({ q, options, answer (0-based), explanation }).
//
// Recognised (mixed freely in one paste):
//   numbering    "1.", "1)", "Q1.", "Q.1", "1-"
//   options      "(a)", "a)", "a.", "A)", "A."  inline ("a) x  b) y") or one per line
//   answer       a line "Ans: B" / "Answer: (c)" / "Correct: 2", or a * on the option ("*b) …" or "b) … *")
//   explanation  "Explanation:", "Exp:", "Solution:", "Sol:", "Reason:" (may continue on later lines)

const QUESTION_START = /^\s*(?:Q\s*\.?\s*)?(\d{1,3})\s*[.)\-:]\s+(.*)$/i;
const OPTION_START = /^\s*(\*?)\s*\(?\s*([a-hA-H])\s*[).:]\s+(.*)$/;
const INLINE_OPTION_SPLIT = /(?=(?:^|\s)\(?[a-hA-H][).:]\s)/;
const ANSWER_LINE = /^\s*(?:correct\s*answer|correct\s*option|answer|ans|correct|key)\s*[:.\-)]?\s*\(?\s*([a-hA-H]|[1-8])\s*\)?[\s.)]*(?:.*)?$/i;
const EXPLANATION_LINE = /^\s*(?:explanation|explain|exp|solution|sol|reason|rationale)\s*[:.\-)]\s*(.*)$/i;

function answerIndex(token) {
  const t = String(token).trim().toLowerCase().replace(/[()]/g, '');
  if (/^[a-h]$/.test(t)) return t.charCodeAt(0) - 97;
  if (/^[1-8]$/.test(t)) return Number(t) - 1;
  return null;
}

function blocks(raw) {
  const out = [];
  let cur = null;
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    if (QUESTION_START.test(line) && !OPTION_START.test(line)) { if (cur) out.push(cur); cur = [line]; }
    else if (cur) cur.push(line);
    else if (line.trim()) cur = [line];
  }
  if (cur) out.push(cur);
  return out;
}

function expandInline(line) {
  const markers = line.match(/(?:^|\s)\(?[a-hA-H][).:]\s/g);
  if (!markers || markers.length < 2) return [line];
  return line.split(INLINE_OPTION_SPLIT).map(s => s.trim()).filter(Boolean);
}

export function parseQuestions(raw) {
  const questions = [], warnings = [];
  blocks(String(raw || '')).forEach((lines, idx) => {
    const n = idx + 1;
    const first = lines[0].match(QUESTION_START);
    let stem = first ? first[2].trim() : lines[0].trim();
    // Options may start on the stem line itself: "1. What is …? a) x b) y c) z d) w"
    const stemSplit = expandInline(stem);
    const rest = [];
    if (stemSplit.length > 1 && OPTION_START.test(stemSplit[1])) { stem = stemSplit[0]; rest.push(...stemSplit.slice(1)); }
    for (const l of lines.slice(1)) rest.push(...expandInline(l));
    const options = [];
    let answer = null, explanation = null, mode = 'stem';
    for (const raw of rest) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const am = line.match(ANSWER_LINE);
      if (am && options.length) { answer = answerIndex(am[1]); mode = 'explanation'; continue; }
      const em = line.match(EXPLANATION_LINE);
      if (em) { explanation = em[1].trim(); mode = 'explanation'; continue; }
      const om = line.match(OPTION_START);
      if (om && mode !== 'explanation') {
        let text = om[3].trim(), marked = om[1] === '*';
        if (/\s\*$/.test(text)) { text = text.replace(/\s*\*$/, '').trim(); marked = true; }
        if (/^\*\s*\S/.test(text)) { text = text.replace(/^\*\s*/, ''); marked = true; }
        options.push({ i: om[2].toLowerCase().charCodeAt(0) - 97, text, marked });
        mode = 'options';
        continue;
      }
      if (mode === 'stem') stem += ' ' + line.trim();
      else if (mode === 'options' && options.length) options[options.length - 1].text += ' ' + line.trim();
      else if (mode === 'explanation' && explanation !== null) explanation += ' ' + line.trim();
    }
    if (!options.length) { warnings.push(`Question ${n}: no options found, skipped.`); return; }
    if (answer === null) { const m = options.findIndex(o => o.marked); if (m >= 0) answer = options[m].i; }
    options.sort((a, b) => a.i - b.i);
    const q = { q: stem.trim(), options: options.map(o => o.text), answer: null, difficulty: 'medium' };
    if (answer !== null) {
      const pos = options.findIndex(o => o.i === answer);
      if (pos >= 0) q.answer = pos; else warnings.push(`Question ${n}: the answer points to a missing option.`);
    } else warnings.push(`Question ${n}: no answer found; mark it before saving.`);
    if (explanation) q.explanation = explanation;
    if (options.length < 2) warnings.push(`Question ${n}: fewer than 2 options.`);
    questions.push(q);
  });
  return { questions, warnings };
}
