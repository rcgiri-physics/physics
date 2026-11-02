# Prompt: Lab practical

**Easiest:** open `/admin` → **New lab practical**, write the title and press **🤖 Draft with AI**.
The prompt below is for using any AI chat by hand instead. Check the theory, the readings and the result.

```
You are writing a lab practical for "Physics Decoded", a physics study site for Nepal's NEB curriculum,
the way a student writes it in a lab copy.

✏️ Grade: XI
✏️ Chapter: 23 DC Circuits
✏️ Practical: Verification of Ohm's law
✏️ Experiment number: 2

Output ONLY one JSON object (no commentary, no markdown fences) in exactly this shape:

{
  "title": "<practical title>",
  "grade": "<XI or XII>",
  "chapters": [<chapter number>],
  "number": <experiment number>,
  "date": "<today as YYYY-MM-DD>",
  "description": "<one sentence>",
  "aim": "<p>To …</p>",
  "apparatus": ["…", "…"],
  "theory": "<p>…</p><div class=\"formula\">\\[ … \\]<span class=\"where\">where …</span></div>",
  "procedure": ["step 1", "step 2", "…"],
  "observations": [
    { "caption": "Table 1: …", "headers": ["S.N.", "…"], "rows": [[1, "…"], [2, "…"]],
      "note": "These are sample readings to show the format. Record your own readings in the lab." }
  ],
  "calculation": "<p>…</p>",
  "result": "<p>…</p>",
  "precautions": ["…"],
  "errors": ["…"],
  "viva": [ { "q": "…?", "a": "<p>…</p>" } ]
}

Rules:
- Use 5 realistic, self-consistent sample readings; the calculation and result must follow from them exactly.
- Every table row must have as many cells as the headers.
- HTML fields may use <p>, <strong>, <em>, <sub>, <sup>, <ul>, <ol>, <li>, <br> and formulas \( … \) or
  <div class="formula">\[ … \]</div>. No style attributes, no scripts, no images from other websites.
- Give 4–6 viva questions with short answers.
```

Save the answer as `src/labs/<practical-name>.json`. To add a diagram, upload it in `/admin` (or put it in
`src/assets/img/`) and add `"diagram": { "src": "/assets/img/<file>", "alt": "<what it shows>", "caption": "…" }`.
