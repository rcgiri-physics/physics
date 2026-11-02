# Physics Decoded: redesign plan

*Written 2026-11-02. Status: Phase 1 is built and in this branch; Phases 2–4 are the roadmap.*

## 1. Summary

Physics Decoded already had the hard part right: 2,000+ original, syllabus-aligned questions and 50+ note sets,
a validated static build, and a shared design. What held it back was **getting content in** (hand-editing
JSON on GitHub, with uploads silently skipped when the format was off), **missing site basics** (About,
Privacy, Contact… which AdSense and Google expect), and a **phone experience** that worked but didn't feel
like a study app.

The redesign keeps the static, Git-backed core (fast, free, impossible to "break" with one bad upload) and adds:

| Area | Before | After (Phase 1, built) |
|---|---|---|
| Adding questions | Hand-written JSON committed on GitHub | `/admin`: forms, paste-to-import, AI generate/convert/check, live validation, phone-friendly |
| Model questions | One paper, uploaded as a full web page, **never published** | Structured papers: NEB template, OR questions, marks check, timed **exam mode** |
| Lab pages | None | Lab practicals: aim → viva, observation tables, print-ready, AI draft |
| Admin login | None | Accounts with roles, PBKDF2 passwords, optional 2FA, throttling |
| Pages | No About/Privacy/Terms/Contact | About, Contact (form), Privacy, Terms, Disclaimer, Editorial policy, footer credit |
| Hosting | Vercel | Cloudflare (free): static assets + a Worker for `/admin` and `/api` |
| Ads | None | Student-friendly AdSense slots + rotating house ads, all controlled from Settings |
| Mobile | Responsive pages | Bottom tab bar, test mode, saved progress, continue-where-you-left-off, offline |
| SEO | Basic meta + sitemap | Clean URLs, JSON-LD (Quiz, LearningResource, Breadcrumbs, FAQ, SearchAction), OG image, RSS |
| Feedback loop | None | "Report a mistake" on every page/question → admin inbox; anonymous insights incl. search terms |

## 2. Audit of the site as it was

Findings from the repository on 2026-11-02:

1. **Uploads failing silently.** `src/lessons/model-xii-set-1.html` (the only model paper, 63 KB) had been
   uploaded as a full page with `<script>` and `style=` into the lessons folder, so the build skipped it since
   2026-10-13. `src/lessoacoustic-phenomena-mcq.json` (typo in the folder name) was a separate 23-question set
   that never went live. `electron-mcq.json` sat in the repository root, a copy of `new-electrons-mcq.json`.
   The README notes that 16 lessons uploaded as full pages had frozen the site for five days in October.
   → The root cause is that authors work against a raw file format with no feedback until the build log.
2. **No path for papers, labs or editors** other than writing files that match an undocumented-to-them format.
3. **No trust pages.** No About, Contact, Privacy or Terms. AdSense review and Google's quality guidelines
   (who writes this? how is it checked?) both look for these.
4. **Phones:** the quiz bar was sticky and three rows tall on a phone; navigation wrapped; no way to keep
   progress across chapters or resume.
5. **SEO:** `.html` URLs, no structured data, no share image, no feed; every page shared one description style.
6. **Measurement:** Vercel analytics events, but nothing that turned student behaviour into a to-do list.

## 3. What similar sites do, and the gap

Web searches for NEB-focused and international physics study resources (November 2026):

- **Nepali NEB sites** (e.g. College Info Nepal, NoteSwift, Pi Academy mock exams) mostly offer chapter
  notes and model questions as **PDFs or long text pages**, with solutions as separate links. A search for
  NEB-aligned MCQ banks returned mostly CBSE/NCERT material, and a search for NEB **practical (lab) write-ups
  returned nothing relevant**.
- **International revision sites** that came up (Save My Exams, Physics & Maths Tutor, Khan Academy, PhET)
  are known for a few patterns worth copying: content organised **strictly by syllabus topic**; **exam-style questions
  with mark schemes**; **progress the student can see**; **one consistent page template** per content type;
  and interactive practice rather than reading only.

**Positioning:** the free, NEB-exact, *interactive* option, which no NEB site covered well:
interactive MCQs with explanations (not PDFs), papers you can sit under a timer, lab practicals written the way
the lab copy needs them, works offline on a low-end phone, and ads that never get between a student and a question.

## 4. Design thinking

**Primary user:** a Grade XI/XII student on an Android phone, often on mobile data, studying a specific
chapter, usually close to an exam. **Secondary:** a teacher sharing a link in a class Viber/WhatsApp group.
**Author:** Richesh (and helpers) adding content, often from a phone.

Principles, and where each shows up:

| Principle | Decisions |
|---|---|
| Thumb-first | Bottom tab bar (Home, XI, XII, Papers, Labs); 44 px+ targets; quiz bar not sticky on phones; test-mode bar docks at the bottom |
| Exam-first | Practice vs **Test** mode; paper **exam mode** with countdown; "Review wrong answers"; marks shown NEB-style |
| Show progress | Scores on grade pages and cards; "Continue where you left off"; all stored on the device (no account needed) |
| Respect the data plan | No web fonts; KaTeX and AdSense only load when needed; one 74 KB share image; offline cache |
| Trust | Author, editorial policy, "Updated" dates, "Report a mistake" everywhere, clearly labelled ads |
| Shareable | Native share sheet (WhatsApp/Viber/Facebook fallback), clean URLs, share image |
| Calm | Ads only between sections, hidden during tests; no pop-ups; reduced-motion respected |

## 5. Information architecture

```
/                       home: search, continue, grades, exam prep (papers, labs, MCQs), topic areas, new, FAQ
/pages/grade-xi|xii     syllabus by topic area → chapters → notes, MCQ sets, practicals, videos (+ your scores)
/pages/model-questions  papers by grade → /papers/<slug> (exam mode)
/pages/labs             practicals by grade → /labs/<slug> (print as lab sheet)
/search                 everything, filter by type / grade / topic area, sort
/posts/<slug>           notes or MCQ set
/about /contact /privacy /terms /disclaimer /editorial-policy
/admin                  authors only
```

URLs are extensionless; every old `.html` and Blogger address 301-redirects (generated `_redirects`).

## 6. Visual design system

- Kept the recognisable indigo + amber identity; refined into tokens (`tokens.css`) with a full dark theme and a
  manual switch (no flash: a 300-byte blocking `theme.js`).
- Each content type has a colour and an icon (notes blue/book, MCQ green/check, papers purple/file, labs
  teal/flask), used consistently on badges, cards and heroes.
- Fluid type scale (`--step-*`), 16 px radii, soft shadows, system fonts.
- One SVG icon sprite (`icons.svg`, 31 icons, `currentColor`), cached for a year.
- The desktop home hero shows a **real answered question** from the newest set, so first-time visitors see
  what the site does.

## 7. Content and the new way to insert questions

| Step | Before | After |
|---|---|---|
| Write | Hand-write JSON (answer as a 0-based index) | Form with a radio for the correct option; or paste; or AI |
| Import existing questions | Retype or reformat | **Paste questions**: numbered text with a)–d), `Ans:` lines or `*` marks, inline or one per line (ported from MCQplex's parser) |
| Messy sources (PDF/Word/chat) | — | **Convert text with AI**: fixes formatting, solves missing answers, adds explanations |
| New questions | Copy a prompt into a chat by hand | **Generate with AI** for the chosen chapter and topics, avoiding repeats |
| Check | Read carefully | **Check answer**: a second AI solves it independently and flags disagreement |
| Validate | Build log after pushing | Live, in the editor; again in the Worker; again in CI |
| Publish | GitHub commit | **Publish** (a commit with the author's name); live in about a minute |

The same rules live in `admin/shared/validate.js` (browser + Worker) and `build.py`; a test checks that both
accept every existing file. New optional MCQ fields: `image` + `image_alt` (diagram questions), `source`
(e.g. "NEB 2079"), and `video` on any lesson.

## 8. Architecture

```
               GitHub repository (single source of truth: src/, admin/, worker/)
                 ▲  commit (Contents API)                 │ push to main
                 │                                        ▼
   ┌──────── Cloudflare Worker ────────┐        GitHub Actions: build.py --strict, npm test,
   │ /admin/*  session check → assets   │        then wrangler deploy (build.py → public/)
   │ /api/admin/*  CRUD, upload, AI,    │                       │
   │               inbox, insights      │                       ▼
   │ /api/report|contact|event → D1     │◄──── static assets (public/) served free, unlimited
   └──────┬───────────────┬─────────────┘
          │               └── llm-free-cascade → Groq / Gemini / Cerebras / OpenRouter / Workers AI …
          └── D1: reports, messages, events (anonymous counters), hits (rate limits), audit
```

Why Git-backed instead of a database CMS (as MCQplex and Ruru Gaushala use): content stays reviewable,
diffable and revertible; the public site needs no database (fast, free, can't go down with it); the build
validates everything; and backups are automatic. The Worker runs only for `/admin` and `/api`, so static
pages never count against the free request quota.

**Security model:** see README → *Design and quality → Security*. Highlights: roles (admin/editor), PBKDF2,
TOTP, signed `__Host-` cookies bound to the password hash, CSRF header + same-origin check, writable-path
allowlist, validation before commit, upload magic-byte check, strict admin CSP, audit log in D1.

## 9. AI integration (llm-free-cascade)

- The Worker builds one `LLMCascade` from whatever free keys are set as secrets and reuses it across requests,
  so cooldowns carry over. Custom/self-hosted endpoints via `LLM_CUSTOM_PROVIDERS`.
- Every task has a **parse-and-validate** step: an output that fails the site's rules counts as a provider
  failure and the next provider is tried; individual bad questions are dropped and reported.
- Tasks: `mcq-generate`, `mcq-convert`, `mcq-check`, `lab-draft`, `paper-convert`. Prompts encode the house
  style (NEB, SI units, Unicode symbols, no "all of the above", numbers double-checked).
- Guardrails: AI output only ever lands in an editor; 40 AI calls per author per hour; inputs capped;
  `maxTokensLimit` set; the Editorial policy tells readers AI is used with human review.

## 10. Ads: student-friendly and dynamic

- **Placement is ours, not Google's** (build-time slots): mid-article between sections in long notes, after
  15 questions in sets of 30+, end of content, desktop sidebar, list pages. Never inside a question, never on
  legal/404/admin pages, and **hidden during timed tests and exam mode**.
- **Dynamic:** each slot fills lazily when scrolled near; AdSense loads after first interaction; unfilled or
  blocked slots fall back to **house ads** (YouTube channel, MCQplex, future offers) rotated by weight and
  editable in Settings without a code change. Auto ads optional.
- **Compliance:** `ads.txt` and the account meta tag are generated from Settings; the privacy policy has the
  required AdSense wording; README lists the AdSense steps (blocking sensitive categories, EEA consent message).
- **Trade-off documented:** AdSense requires a nonce CSP, impossible for static pages, so script/frame CSP
  relaxes only while ads are on.

## 11. SEO plan

Technical (built): clean URLs + 301s; canonical; unique titles/descriptions; JSON-LD per type; breadcrumbs;
OG/Twitter image; sitemap with `lastmod`; RSS; `robots.txt` (search + AdSense allowed, AI trainers blocked);
fast pages (static, small, lazy assets); mobile-first; FAQ on home.

Content (roadmap): one strong notes page + MCQ set per chapter (coverage is shown on the home grade cards);
titles that match how students search ("Class 12 physics wave motion notes NEB", "… MCQ with answers");
internal links between notes ↔ MCQs ↔ labs ↔ papers (built: related sections); use **Insights → search terms**
monthly to find topics students look for that the site doesn't cover; Google Search Console for queries
and coverage.

## 12. What was reused from MCQplex and Ruru Gaushala

| From | Idea | Here |
|---|---|---|
| MCQplex `utils/questionTextParser.js` | Deterministic paste-to-questions parser | `admin/shared/parse.js` (ported, adapted, +inline/star cases) |
| MCQplex `ai.service.js` (now on llm-free-cascade) | Cascade across free LLMs, parse-and-retry, JSON tasks (extract, verify, improve) | `worker/ai.js` |
| MCQplex `ad-manager.js` / ads service | Slot hydration, AdSense lazy push, house-ad fallback, weighted pick | `src/assets/js/ads.js` (no server, config from Settings) |
| MCQplex exam engine | Client-side, drift-free, survives reload | Quiz test mode and paper exam mode (timers resume after reload) |
| MCQplex `content-import/` workflow | Pre-validated batches, licence trail | Validation in editor + Worker + CI; `source` field on questions |
| Ruru Gaushala auth (`jose` + bcrypt + TOTP) | Hand-rolled sessions, 2FA, login throttling, password change signs out everywhere | `worker/auth.js` (Web Crypto, no deps) |
| Ruru Gaushala admin | Phone-first admin, drafts, browser-side image shrink before upload, audit log, error log | `admin/admin.js`, D1 `audit` table |
| Ruru Gaushala site polish | Theme toggle, share button, print stylesheet, offline service worker, breadcrumbs JSON-LD, view transitions, legal pages | All present |

## 13. Missing elements added

About · Contact (form + honeypot + timing trap + rate limit) · Privacy (local storage, analytics, AdSense,
messages, retention) · Terms · Disclaimer (not affiliated with NEB) · Editorial policy (how content is made
and corrected, AI use) · footer with study/about columns, © line and **Design By Mcqplex Tech** · 404 with
suggestions · offline page · web app manifest and icons · share image · RSS · announcement banner · Report a
mistake · accessibility of new components (labels, focus, keyboard, dialogs).

## 14. Roadmap

### Phase 2 — content velocity (next 4–6 weeks)
1. **Fill the gaps the grade cards show:** practicals for the full NEB list (XI and XII), one model paper per
   grade per term, MCQ sets for every chapter with < 40 questions.
2. **Question bank view** in the admin: search across all questions, find duplicates across sets, bulk-move
   a question to another set.
3. **Diagram questions:** upload images per question (built) + a crop tool; convert the old interactive
   simulations (photoelectric tube, AC generator, ray tracer…; see git `0ff021b`) into shared components.
4. **Notes from AI outline:** an AI task that drafts a chapter outline + worked examples into the notes editor.
5. **Scheduled publishing** (a future `date` hides a lesson until then) and an "Updated" log on each page.

### Phase 3 — student engagement (6–10 weeks)
1. **Mixed practice tests:** pick chapters → 25 random questions across sets, timed; results by chapter.
2. **Spaced revision:** "Review your wrong answers" across all sets, from the progress already stored on device.
3. **Optional student accounts** (only if needed): sync progress across devices using D1; keep the site fully
   usable without one.
4. **Nepali-language support** for key UI and glossary terms (Ruru Gaushala's `pick()` pattern).
5. **Leaderboards / weekly challenge** reusing MCQplex's league ideas, only if accounts exist.

### Phase 4 — growth
1. Teacher pages: printable worksheets from any set; class codes that point to a fixed test.
2. MCQplex integration: "Practise this chapter on MCQplex" deep links per chapter; shared question IDs.
3. Video embeds per chapter (`video` field is built); YouTube end-screen links back to the matching page.

## 15. Launch checklist (owner)

1. Merge this branch. Vercel keeps serving the old site until DNS moves (`vercel.json` updated for clean URLs).
2. Cloudflare: token + account ID → GitHub secrets; run *Deploy to Cloudflare*.
3. `ADMIN_USERS`, `SESSION_SECRET`, `GITHUB_TOKEN` secrets; sign in at `/admin`; turn on 2FA.
4. Create D1, apply `worker/schema.sql`, uncomment the binding.
5. Add one or two free AI keys (Groq, Gemini).
6. Move the domain's nameservers to Cloudflare; add the custom domain; check; remove Vercel; delete `vercel.json`.
7. Search Console: verify (code in Settings), submit the sitemap.
8. Review the converted model paper and the two sample labs; fill `email` in `src/content.json` if you want a
   public address on the Contact page.
9. AdSense: apply → publisher ID in Settings → after approval, slot IDs + **Show ads**; block sensitive categories.

## 16. Decisions for the owner

- **Ads before or after AdSense approval?** House ads can run from day one (they promote your own channels).
- **Contact email:** public address on the Contact page, or form only (current default)?
- **Editors:** who gets an `editor` account, and should editor saves go to a review branch instead of `main`?
  (One environment variable, `GITHUB_BRANCH`, would make the admin commit to a branch for review.)
- **Student accounts:** stay account-free (current), or add optional sync in Phase 3?
