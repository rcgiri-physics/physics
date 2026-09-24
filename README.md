# Physics Decoded

Grade XI & XII physics notes and MCQ practice (NEB Curriculum 2076) by Richesh Sharma —
<https://richeshsharma.com.np>

This is a plain static site. Lessons are written as standalone HTML pages. A small
Python script (`build.py`, standard library only) wraps them with the site navigation.
It also generates the home page, grade pages, search and sitemap.

## Folder layout

```
src/                       ← EDIT THESE
  content.json             site info, syllabus of each grade, list of lessons
  lessons/<slug>.html      one complete HTML page per lesson (notes or MCQ set)

assets/                    ← shared design (edit to restyle the whole site)
  css/site.css             design tokens + styles for home / grade / search pages
  css/lesson-bar.css       top bar & footer that get added to every lesson
  js/search.js             search page logic
  favicon.svg
  search-index.json        (generated)

build.py                   generator — run after any change in src/

index.html  search.html  404.html  sitemap.xml   (generated — do not edit)
pages/grade-xi.html  pages/grade-xii.html         (generated — do not edit)
posts/<slug>.html                                  (generated — do not edit)
robots.txt
```

Generated files are committed, so the hosting setup does not change: the repository
root is still the website root and every URL stays the same.

## Adding a new lesson

1. Save the lesson as `src/lessons/<slug>.html`. Use a full HTML document with its own
   `<head>`, `<style>` and `<body>`, the same way the existing lessons are written.
   The slug becomes the URL: `/posts/<slug>.html`.
2. Add an entry to the `"posts"` list in `src/content.json`:
   ```json
   { "slug": "alternating-current-mcq", "title": "Alternating Current — 40 MCQs",
     "grade": "XII", "chapters": [15], "kind": "mcq", "date": "2026-10-01" }
   ```
   - `grade`: `"XI"` or `"XII"`
   - `chapters`: chapter number(s) from that grade's syllabus. A lesson can cover
     several chapters, e.g. `[7, 8, 9]`.
   - `kind`: `"notes"` or `"mcq"`
3. Run:
   ```
   python build.py
   ```
   The lesson now shows up automatically on the home page (“Recently added”), on its
   chapter in the grade page, in search, in the sitemap, and in the “Also in this chapter”
   links of related lessons.

`python build.py --check` validates `content.json` without writing anything. It
catches missing files, unknown chapters, duplicate slugs and bad dates.

To **edit** a lesson, change `src/lessons/<slug>.html` and rebuild. Never edit
`posts/*.html` by hand, because the next build overwrites them.

To **change the syllabus** (topics, chapter names, content areas), edit
`"grades"` in `src/content.json` and rebuild.

## Design system

All colours and sizes are CSS variables at the top of `assets/css/site.css`.

| Token | Value | Used for |
|---|---|---|
| `--brand-900 / 700 / 600` | `#1a237e` `#283593` `#3949ab` | header, hero, footer (the indigo already used in the MCQ lessons) |
| `--accent` | `#ffb300` | primary buttons, keyboard focus ring |
| `--notes` | `#1e63d6` | anything marked **Notes** |
| `--mcq` | `#1f8f47` | anything marked **MCQ** |
| `--video` | `#d93025` | YouTube links |
| `--bg / --surface / --border` | light greys | page background, cards |

Dark mode is automatic, via `prefers-color-scheme`. Font: Segoe UI / system font stack
(no external font downloads).

Lessons keep their own individual look. `lesson-bar.css` only adds the fixed top bar
and the footer. It uses `.pd-` class names so a lesson's own CSS can't break it.

## Local preview

```
python -m http.server 8000
```
Then open <http://localhost:8000>. (The custom 404 page only works on the real host.)

## Known content issues (to fix in the lesson files)

- `src/lessons/wave-motion-2.html` is **truncated**. It stops in the middle of an SVG
  diagram (section on stationary waves at t = T/4). The rest was lost before this
  repository was created and must be pasted in again from the original.
- `src/lessons/rotational-dynamics.html` loads 5 images from `image.qwenlm.ai`. They
  should be downloaded into `assets/img/` so they can't disappear.
- `heat-and-temperature` and `thermal-expansion` load `plotly-latest`, which is frozen at
  v1.58. Pin a current version (e.g. `https://cdn.plot.ly/plotly-2.35.2.min.js`).
- Grade XI has notes for chapters 9–13 only, and no MCQ sets yet. On the grade pages
  these chapters show “coming soon”.
