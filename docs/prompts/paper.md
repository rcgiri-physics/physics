# Prompt: Model question paper

**Easiest:** open `/admin` → **New model paper** → **NEB template**, or paste an existing paper and press
**🤖 Convert pasted paper**. The prompt below is for using any AI chat by hand instead.
Check every answer before publishing: students will trust them.

```
You are writing a model question paper for "Physics Decoded", a physics study site for Nepal's NEB curriculum.

✏️ Grade: XII
✏️ Year / set: 2082, Set 1
✏️ Chapters to cover: the whole syllabus, weighted like the NEB specification grid

Pattern: Group A 11 multiple-choice questions × 1 mark; Group B 8 short questions × 5 marks;
Group C 3 long questions × 8 marks; 3 hours; full marks 75; pass marks 30. Two or three questions in
Groups B and C should have an OR alternative worth the same marks.

Output ONLY one JSON object (no commentary, no markdown fences) in exactly this shape:

{
  "title": "Grade <grade> Physics Model Question <year> (Set <n>)",
  "grade": "<XI or XII>",
  "year": <year>,
  "date": "<today as YYYY-MM-DD>",
  "time": "3 hours",
  "full_marks": 75,
  "pass_marks": 30,
  "description": "<one sentence>",
  "groups": [
    { "title": "Group A", "subtitle": "Multiple choice questions", "marks": "11 × 1 = 11",
      "instructions": "Rewrite the correct option of each question.",
      "questions": [ { "q": "<question>", "options": ["…", "…", "…", "…"], "answer": <0–3>, "solution": "<p>Why…</p>" } ] },
    { "title": "Group B", "subtitle": "Short answer questions", "marks": "8 × 5 = 40",
      "instructions": "Give short answers to the following questions.",
      "questions": [
        { "parts": [ { "q": "<part a>", "marks": 2, "solution": "<p>…</p>" }, { "q": "<part b>", "marks": 3, "solution": "<p>…</p>" } ],
          "or": { "parts": [ { "q": "…", "marks": 2, "solution": "…" }, { "q": "…", "marks": 3, "solution": "…" } ] } }
      ] },
    { "title": "Group C", "subtitle": "Long answer questions", "marks": "3 × 8 = 24",
      "instructions": "Give long answers to the following questions.", "questions": [ … ] }
  ]
}

Rules:
- Do not number the questions; the site numbers them 1–22 automatically.
- A question is either { "q", "marks", "solution" } or { "parts": [...] } (parts a, b, c each with marks), or a
  multiple-choice { "q", "options", "answer", "solution" } (1 mark).
- An "or" alternative must be worth the same marks as its question.
- Solutions may use <p>, <strong>, <sub>, <sup>, <ul>, <ol>, <li>, <br> and formulas \( … \) or
  <div class="formula">\[ … \]</div>. No style attributes and no scripts.
- Use SI units. Double-check every numerical answer and every marked option.
- The marks must add up to 75.
```

Save the answer as `src/papers/<grade>-model-<year>-set-<n>.json`, for example
`grade-xii-model-2082-set-1.json`. The build checks that the marks add up to `full_marks`.
The older content-HTML format (`docs/examples/example-paper.html`) still works too.
