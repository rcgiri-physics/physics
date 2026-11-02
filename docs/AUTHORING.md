# Writing content for Physics Decoded

There are two ways to add or change content. Both end in the same place, a file in `src/`, and both are
checked by the same rules before anything reaches students.

| | **Admin (`/admin`)** — recommended | **GitHub / files** |
|---|---|---|
| Who | Anyone with an admin account | Anyone with access to the repository |
| How | Forms, a live preview, paste-to-import and AI help, on a phone or a computer | Add or edit a file in `src/` |
| Checks | Problems are shown as you type; Publish is refused until they are fixed | `build.py` checks on every push; a bad file is skipped and CI shows a red ✗ |
| Result | A commit to GitHub (with your name), then the site rebuilds in about a minute | Same |

Content files contain **no design**: no colours, fonts, `<style>` or `<script>`. The whole site shares one
look, defined in `src/assets/css/`, so content written by hand, in the admin or by any AI looks right automatically.

| Kind | File | Address on the site |
|---|---|---|
| MCQ set | `src/lessons/<name>.json` | `/posts/<name>` |
| Notes | `src/lessons/<name>.html` | `/posts/<name>` |
| Model question paper | `src/papers/<name>.json` (or `.html`) | `/papers/<name>` |
| Lab practical | `src/labs/<name>.json` | `/labs/<name>` |
| Site page (About, Privacy…) | `src/pages/<name>.html` | `/<name>` |
| Image | `src/assets/img/<name>.webp` (`.png`, `.jpg`) | `/assets/img/<name>.webp` |

File names: lowercase words joined by hyphens, e.g. `lenses-mcq.json`. The file name is the page address,
so don't rename a published file (old addresses would break).

---

## Using the admin

Open `https://<site>/admin` and sign in (accounts: see README → *Admin accounts*).

- **New MCQ set**: choose the grade and chapter, then add questions in any of four ways:
  type them; **📋 Paste questions** (numbered questions with `a) b) c) d)` options and an `Ans:` line, from
  Word, a PDF or a chat — no AI needed); **🤖 Generate with AI**; or **🤖 Convert text with AI** for messy
  text (it solves missing answers and adds explanations). Each question has **🤖 Check answer**, which asks
  an AI to solve it independently and tells you if it disagrees.
- **New notes / pages**: buttons insert every building block (formula, definition, worked example…), with a
  live preview including the maths.
- **New model paper**: **NEB template** creates Group A (11 MCQs), B (8 × 5) and C (3 × 8); add OR
  alternatives; the marks total is checked against full marks. **🤖 Convert pasted paper** turns an existing
  paper into this format.
- **New lab practical**: write the title and press **🤖 Draft with AI**, then check and edit every section.
- **Images**: every editor has an *Upload* button. Photos are shrunk on your phone before upload.
- **Drafts** are saved in your browser as you type: if the phone dies, reopen the editor and press *Restore*.
- **Inbox**: “Report a mistake” reports from students and contact-form messages.
- **Insights**: what students study, finish and search for (searches for missing topics = ideas for new lessons).

AI never publishes anything: its output is loaded into the editor, and a person checks it and presses Publish.

---

## MCQ set (`.json`)

```json
{
  "title": "Alternating Current — 40 MCQs",
  "grade": "XII",
  "chapters": [15],
  "date": "2026-10-01",
  "description": "RMS values, reactance, impedance, resonance and power factor.",
  "video": "https://youtu.be/…",
  "questions": [
    {
      "q": "The rms value of an alternating current of peak value I₀ is:",
      "options": ["I₀/2", "I₀/√2", "√2 I₀", "2I₀/π"],
      "answer": 1,
      "explanation": "For a sinusoidal current, I_rms = I₀/√2 ≈ 0.707 I₀.",
      "difficulty": "easy"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `title`, `grade`, `chapters`, `date` | yes | `grade` is `"XI"` or `"XII"`; `chapters` from the syllabus below, e.g. `[15]`; date `YYYY-MM-DD` |
| `description` | recommended | One sentence, shown under the title and in Google results |
| `video` | no | A YouTube link; shown as a click-to-play video under the quiz |
| `questions[].q` | yes | Question text (Unicode such as ω, λ, ², √; or LaTeX inside `\( … \)`) |
| `questions[].options` | yes | 2–6 different options; 4 is normal |
| `questions[].answer` | yes | **Position of the correct option, counting from 0**: 0 = A, 1 = B, 2 = C, 3 = D |
| `questions[].explanation` | recommended | Shown after the student answers |
| `questions[].difficulty` | recommended | `"easy"`, `"medium"` or `"hard"` |
| `questions[].image`, `image_alt` | no | A diagram (`/assets/img/…`) and a description of it for blind students |
| `questions[].source` | no | e.g. `"NEB 2079"`, shown as a small tag |

Students see each set in **Practice** mode (answer and explanation at once) or **Test** mode (timed, score at the end).
Options are shown in a fixed shuffled order, so it doesn't matter where you put the correct answer; questions
with options like "None of these" keep their order.

---

## Notes (`.html`)

```html
---
title: Alternating Current
grade: XII
chapters: [15]
date: 2026-10-01
description: RMS values, phasors, LCR circuits and resonance.
video: https://youtu.be/…
---

<h2>Introduction</h2>
<p>An alternating current changes direction periodically…</p>
```

Every `<h2>` becomes an entry in the automatic "On this page" menu.

### Building blocks

| You write | You get |
|---|---|
| `<h2>`, `<h3>`, `<p>`, `<ul>`, `<ol>`, `<table>`, `<strong>`, `<em>` | Normal text styling |
| `\( E = mc^2 \)` | Inline formula (LaTeX) |
| `<div class="formula">\[ F = -kx \]<span class="where">where k is…</span></div>` | Centred display formula with an optional "where" line |
| `<div class="box definition">…</div>` | Blue **Definition** box |
| `<div class="box law">…</div>` | Indigo **Law / Principle** box |
| `<div class="box example">…</div>` | Amber **Worked example** box |
| `<div class="box tip">…</div>` | Green **Exam tip** box |
| `<div class="box warning">…</div>` | Red **Common mistake** box |
| `<div class="box note">…</div>` | Grey **Note** box |
| `<div class="box law" data-title="Newton's second law">…</div>` | Any box with a custom label |
| `<details class="solution"><summary>Show solution</summary>…</details>` | Hidden solution the student clicks to open |
| `<ul class="key-points"><li>…</li></ul>` | Tick-mark summary list |
| `<div class="cols"><div>…</div><div>…</div></div>` | Side-by-side comparison |
| `<figure><img src="/assets/img/lens.webp" alt="…"><figcaption>…</figcaption></figure>` | Image with caption |
| `<figure><svg viewBox="…">…</svg><figcaption>…</figcaption></figure>` | Inline SVG diagram (use `stroke="currentColor"` so it works in dark mode) |

**Not allowed:** `<style>`, `<script>`, `<link>`, `<iframe>`, `<form>`, `style="…"`, `onclick="…"` and other
event attributes, `javascript:` links, `<html>/<head>/<body>`, and images from other websites. The build
rejects them so that every page keeps the same look and stays safe.

**See every block in action:** `/styleguide` on the site. Its source is
[`docs/examples/example-notes.html`](examples/example-notes.html).

---

## Model question papers (`src/papers/<name>.json`)

Structured papers are what the admin writes, and what the site can do the most with: automatic numbering,
OR alternatives, clickable Group A options, a marks total check, and **exam mode** (answers hidden behind a
countdown timer).

```json
{
  "title": "Grade XII Physics Model Question 2082 (Set 1)",
  "grade": "XII", "year": 2082, "date": "2026-10-13",
  "time": "3 hours", "full_marks": 75, "pass_marks": 30,
  "description": "…",
  "groups": [
    { "title": "Group A", "subtitle": "Multiple choice questions", "marks": "11 × 1 = 11",
      "instructions": "Rewrite the correct option of each question.",
      "questions": [ { "q": "…", "options": ["…", "…", "…", "…"], "answer": 0, "solution": "<p>…</p>" } ] },
    { "title": "Group B", "subtitle": "Short answer questions", "marks": "8 × 5 = 40",
      "questions": [
        { "parts": [ { "q": "Define torque.", "marks": 2, "solution": "<p>…</p>" },
                     { "q": "…", "marks": 3, "solution": "<p>…</p>" } ],
          "or": { "q": "…", "marks": 5, "solution": "<p>…</p>" } }
      ] }
  ]
}
```

A question is one of: multiple choice (`q`, `options`, `answer`, `solution`; 1 mark), single (`q`, `marks`,
`solution`) or multi-part (`parts`: each `q`, `marks`, `solution`). Any question may have an `or` alternative
worth the same marks. If `full_marks` is given, the build checks the marks add up to it. Text and solutions
may contain the notes building blocks. Prompt: [prompts/paper.md](prompts/paper.md).

The older content-HTML format (front matter + `<h2>` per group, see
[examples/example-paper.html](examples/example-paper.html)) still works.

---

## Labs (`src/labs/<name>.json`)

```json
{
  "title": "Verification of Ohm's law",
  "grade": "XI", "chapters": [23], "number": 2, "date": "2026-11-02",
  "description": "…",
  "aim": "To verify Ohm's law and to determine the resistance of a given resistor.",
  "apparatus": ["Resistor", "Ammeter (0–1 A)", "…"],
  "theory": "<p>…</p><div class=\"formula\">\\[ V = IR \\]</div>",
  "diagram": { "src": "/assets/img/ohms-law-circuit.webp", "alt": "Circuit diagram …", "caption": "…" },
  "procedure": ["Connect the circuit …", "…"],
  "observations": [ { "caption": "Table 1: …", "headers": ["S.N.", "I (A)", "V (V)"], "rows": [[1, "0.10", "0.50"]], "note": "…" } ],
  "calculation": "<p>…</p>", "result": "<p>…</p>", "conclusion": "<p>…</p>",
  "precautions": ["…"], "errors": ["…"],
  "viva": [ { "q": "Is Ohm's law universal?", "a": "<p>No…</p>" } ],
  "video": "https://youtu.be/…"
}
```

Required: `title`, `grade`, `date`, `aim`, `apparatus`, `procedure`. `chapters` is optional but links the
practical to its chapter on the grade page. Every observation row must have as many cells as the headers.
Students can print any practical as a clean lab sheet. Prompt: [prompts/lab.md](prompts/lab.md).

---

## Site pages (`src/pages/<name>.html`)

About, Contact, Privacy, Terms, Disclaimer and Editorial policy live here, written like notes with a
front matter block of `title`, `description` and (optional) `date`. The contact page gets its form
automatically. Only admins can edit pages in `/admin`.

---

## Site settings (`src/settings.json`)

Edited in `/admin` → **Settings** (admins only): the announcement banner, ads (AdSense ID, slot IDs, house ads),
analytics, search-engine verification codes, and the report/contact switches. See README → *Ads*.

---

## Chapter numbers

Chapter numbers come from `src/content.json` (and are shown on the grade pages).

**Grade XI:** 1 Physical Quantities · 2 Vectors · 3 Kinematics · 4 Dynamics · 5 Work, Energy and Power ·
6 Circular Motion · 7 Gravitation · 8 Elasticity · 9 Heat and Temperature · 10 Thermal Expansion ·
11 Quantity of Heat · 12 Rate of Heat Flow · 13 Ideal Gas · 14 Reflection at Curved Mirrors ·
15 Refraction at Plane Surfaces · 16 Refraction through Prisms · 17 Lenses · 18 Dispersion ·
19 Electric Charges · 20 Electric Field · 21 Electric Potential · 22 Capacitor · 23 DC Circuits ·
24 Nuclear Physics · 25 Solids · 26 Recent Trends in Physics

**Grade XII:** 1 Rotational Dynamics · 2 Periodic Motion · 3 Fluid Statics and Dynamics · 4 Wave Motion ·
5 Acoustic Phenomena · 6 Nature and Propagation of Light · 7 Interference · 8 Diffraction ·
9 Polarization · 10 First Law of Thermodynamics · 11 Second Law of Thermodynamics ·
12 Electrical Circuits · 13 Magnetic Field and Properties of Materials · 14 Electromagnetic Induction ·
15 Alternating Currents · 16 Electrons and Photons · 17 Semiconductor Devices ·
18 Atomic and Nuclear Physics · 19 Recent Trends in Physics

---

## Old ("legacy") lessons

The Blogger-era lessons were complete stand-alone web pages. All of them have been converted, and the build
**rejects** full web pages. If you find an old page, convert it with
[`prompts/convert-legacy-notes.md`](prompts/convert-legacy-notes.md), or paste its questions into the admin.
