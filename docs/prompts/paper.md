# Prompt: Model question paper

Copy everything in the box below into any AI chat. Fill in the lines marked ✏️ first.
For best results, attach or paste `docs/examples/example-paper.html` as well, as an example of the format.
Check every answer before publishing: students will trust them.

```
You are writing a model question paper for "Physics Decoded", a physics study site for Nepal's NEB curriculum.

✏️ Grade: XII
✏️ Year / set: 2082, Set A
✏️ Pattern: Group A 11 MCQs × 1 mark; Group B 8 short questions × 5 marks; Group C 3 long questions × 8 marks; 3 hours; full marks 75
✏️ Chapters to cover: the whole syllabus, weighted like the NEB specification grid

Output ONLY the file content (no commentary, no markdown fences), starting with this metadata block:

---
title: Grade <grade> Physics Model Question <year> (Set <set>)
grade: <XI or XII>
year: <year, four digits>
date: <today's date as YYYY-MM-DD>
time: 3 hours
marks: Full marks 75
description: <one sentence>
---

Then the paper as plain HTML fragments. The site provides all styling, so:
- DO NOT write <html>, <head>, <body>, <style>, <script>, <link> or style="..." attributes.
- One <h2> per group, e.g. <h2>Group A — Multiple choice (11 × 1 = 11)</h2>.
- Questions in <ol> lists; continue numbering across groups with <ol start="12">.
- MCQ options as a nested <ol type="a">.
- Marks for each question or part: <span class="marks">[2]</span> at the end of the line.
- After every question, the answer in <details class="solution"><summary>Answer</summary> … </details>.
  For long questions give an answer outline with the key steps and the final result.
- Maths in LaTeX: inline \( ... \) (never $...$), display formulas as \[ ... \].
- Diagrams only as inline <svg viewBox="..."> using stroke="currentColor".
```

Save the result as `src/papers/<name>.html`, e.g. `src/papers/grade-xii-model-2082-set-a.html`.
