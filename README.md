# Physics Decoded

Grade XI & XII physics notes, MCQ practice, model questions and lab practicals (NEB Curriculum 2076)
by Richesh Sharma — <https://richeshsharma.com.np>

- **The site** is static: content files in `src/` go in, a small Python script (`build.py`, standard library
  only) turns them into fast HTML pages, and Cloudflare serves them for free.
- **The admin** (`/admin`) lets authors add MCQ sets, notes, model papers and lab practicals from a phone,
  with paste-to-import and AI help. Saving makes a commit to this repository, so GitHub stays the single
  source of truth: every change is versioned, checked by CI, and can be reverted.
- **A small Cloudflare Worker** runs only for `/admin` and `/api` (sign-in, saving, AI, "Report a mistake",
  the contact form and anonymous study counters).

**Writing content?** Read [docs/AUTHORING.md](docs/AUTHORING.md). **Why it is built this way, and what's
next:** [docs/REDESIGN_PLAN.md](docs/REDESIGN_PLAN.md).

## How it fits together

```
src/                         ← the only things anyone edits (by hand or through /admin)
  content.json               site name, links, and the full syllabus of each grade
  settings.json              ads, analytics, announcement banner, feature switches
  lessons/<name>.json|html   MCQ sets (data) and notes (content-only HTML)   → /posts/<name>
  papers/<name>.json         model question papers (structured)               → /papers/<name>
  labs/<name>.json           lab practicals (structured)                      → /labs/<name>
  pages/<name>.html          About, Contact, Privacy, Terms, Disclaimer …     → /<name>
  assets/                    design (css/), behaviour (js/), icons.svg, images (img/)
admin/                       the admin app (static HTML/JS; shared/ holds rules used by the Worker too)
worker/                      Cloudflare Worker: auth.js, github.js, ai.js, db.js, schema.sql
build.py                     validates src/ and builds public/ (pages, sitemap, feed, _headers, _redirects …)
wrangler.jsonc               Cloudflare configuration
tests/                       unit tests (npm test)
docs/                        authoring guide, AI prompts, examples, the redesign plan
public/                      generated site (not committed)
```

The separation is deliberate:

- **Content** has no styling or scripts, so a person, the admin or any AI only has to produce text and data.
- **Design** (`src/assets/css/`) is shared. Change `tokens.css` and every page changes.
- **Behaviour** (`src/assets/js/`) is shared. Improve `quiz.js` once and all 50+ MCQ sets improve.
- **Validation** happens three times with the same rules: in the admin as you type, in the Worker before it
  commits, and in `build.py` (CI runs `build.py --strict`). A file with a problem is **skipped** by the deploy
  build, so one bad upload can never take the site down.

## Common tasks

| Task | How |
|---|---|
| Add an MCQ set, notes, paper or lab | `/admin` → **New …** (or add a file to `src/`, see [AUTHORING](docs/AUTHORING.md)) |
| Fix a typo | `/admin` → Lessons → open it → Publish changes (or edit the file on GitHub) |
| Answer a student's report | `/admin` → Inbox |
| Turn ads on / change the banner | `/admin` → Settings (writes `src/settings.json`) |
| Change the syllabus / chapter names | Edit `grades` in `src/content.json` |
| Change colours | Edit `src/assets/css/tokens.css` |
| Preview locally | `python build.py --serve` → <http://localhost:8000> (static site only) |
| Preview with the admin | `npm install`, copy `.dev.vars.example` to `.dev.vars`, then `npm run dev` → <http://localhost:8787/admin> |
| Check files / run tests | `python build.py --check` · `npm test` |

## Deploying on Cloudflare (free)

Everything below fits Cloudflare's free plan: static pages are served free and without limit, and the Worker
(admin + small API) gets 100,000 requests a day. D1 (the small database) is free up to 5 GB.

### 1. Create the Worker (once, ~10 minutes)

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com). Note your **Account ID** (right sidebar of *Workers & Pages*).
2. Create an API token: *My Profile → API Tokens → Create Token → template "Edit Cloudflare Workers"*.
3. In this GitHub repository: *Settings → Secrets and variables → Actions*, add `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. From now on every push to `main` builds and deploys
   (`.github/workflows/deploy.yml`). Run it once by hand: *Actions → Deploy to Cloudflare → Run workflow*.
4. The site is now live at `https://physics-decoded.<your-subdomain>.workers.dev`.

(Alternative: *Workers & Pages → Create → Import a repository* also works with `wrangler.jsonc`; the GitHub
Action is recommended because the same Python and Node versions run for CI and deploy.)

### 2. Admin accounts and secrets

On your computer, in this folder (`npm install` once):

```bash
node scripts/admin-user.mjs richesh "Richesh Sharma" admin --totp    # asks for a password (12+ characters)
node scripts/admin-user.mjs helper "Helper Name" editor               # optional second account
```

Put the printed objects in a JSON array and save it, plus the other secrets:

```bash
npx wrangler secret put ADMIN_USERS       # paste: [{"username":"richesh",…},{"username":"helper",…}]
npx wrangler secret put SESSION_SECRET    # paste: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put GITHUB_TOKEN      # see below
```

- `--totp` adds two-factor sign-in: scan the printed secret into Google Authenticator, Aegis or 1Password.
- **Roles:** `admin` can do everything; `editor` can create and edit lessons, papers and labs, but not delete
  files, edit site pages or change settings.
- **GITHUB_TOKEN:** GitHub → *Settings → Developer settings → Fine-grained tokens → Generate*. Repository
  access: *only this repository*. Permissions: **Contents: Read and write**, **Checks: Read** (for the build
  status on the dashboard). Set an expiry and renew it when GitHub reminds you.
- If the repository is not `rcgiri-physics/physics` or the branch is not `main`, change `GITHUB_REPO` /
  `GITHUB_BRANCH` in `wrangler.jsonc`.

Sign in at `/admin`. Five wrong passwords from one network lock sign-in for 15 minutes.

### 3. AI keys (optional, free)

The admin's AI buttons use [llm-free-cascade](https://github.com/rcgiri-physics/llm-free-cascade): each request
goes to the first free-tier provider with a key and falls through to the next when one is rate-limited.
Add any you have (more keys = fewer "busy" messages):

```bash
npx wrangler secret put GROQ_API_KEY       # console.groq.com
npx wrangler secret put GEMINI_API_KEY     # aistudio.google.com
npx wrangler secret put CEREBRAS_API_KEY   # cloud.cerebras.ai
npx wrangler secret put OPENROUTER_API_KEY # openrouter.ai
# Cloudflare Workers AI: CLOUDFLARE_API_TOKEN (Workers AI permission) + CLOUDFLARE_ACCOUNT_ID
```

`npx llm-free-cascade keys` lists every supported provider and where to sign up. Optional:
`LLM_PROVIDER_ORDER=groq,gemini` (preferred order) and `LLM_CUSTOM_PROVIDERS` (any OpenAI-compatible endpoint).
Without keys the admin works fully; only the 🤖 buttons are hidden.

### 4. The database (reports, messages, insights)

```bash
npx wrangler d1 create physics-decoded          # prints a database_id
# paste it into the d1_databases block in wrangler.jsonc and uncomment the block, then:
npx wrangler d1 execute physics-decoded --remote --file=worker/schema.sql
git commit -am "Connect D1" && git push        # deploys with the database
```

Until then, "Report a mistake" and the contact form politely say they are not available, and Insights is empty.

### 5. Your domain (moving from Vercel)

1. Add the domain to Cloudflare (*Websites → Add a site*, free plan) and change the nameservers at the
   registrar to the two Cloudflare shows. For `.com.np`, update them at register.com.np.
2. *Workers & Pages → physics-decoded → Settings → Domains & Routes → Add → Custom domain*:
   `richeshsharma.com.np` and `www.richeshsharma.com.np`. HTTPS is automatic.
3. Check the site and `/admin` on the domain, then remove the project from Vercel and delete `vercel.json`
   (it only exists so the old Vercel deployment keeps working during the move).
4. *Web Analytics → Add a site* for privacy-friendly page views (automatic for proxied domains; otherwise put
   the token in Settings).
5. Google Search Console: add the domain, submit `https://richeshsharma.com.np/sitemap.xml`.

Old addresses keep working through `_redirects` (generated by `build.py`):

| Old URL | Goes to |
|---|---|
| `/posts/<slug>.html` (this site before the redesign) | `/posts/<slug>` |
| `/2026/01/<slug>.html` (Blogger) | `/posts/<slug>` |
| `/p/grade-xi.html` | `/pages/grade-xi` |
| `/search/label/Wave-Motion-MCQ` | `/search?q=Wave-Motion-MCQ` |
| `/<slug>.html` (old root copies) | `/posts/<slug>` |

## Ads (AdSense, student-friendly)

Ads are off until you switch them on in **/admin → Settings**. Where they appear is decided by `build.py`,
not by Google: at most one in the middle of a long lesson (between two sections, never inside one), one after
the content, one in the desktop sidebar and one on list pages. None inside a question, none on the legal pages,
the 404 page or the admin, and **all hidden during a timed test or exam**. Slots load only when scrolled near,
and the AdSense script only after the student first interacts, so lessons stay fast.
When AdSense is not set up, has no ad, or is blocked, a **house ad** shows instead (YouTube channel, MCQplex,
anything you add in Settings), rotated by weight.

To apply for AdSense:

1. The site already has what reviewers look for: About, Contact, Privacy (with the AdSense wording),
   Terms, Disclaimer and Editorial policy pages, real original content, and a sitemap.
2. Apply at [adsense.google.com](https://adsense.google.com) with the domain. Put the publisher ID
   (`ca-pub-…`) in Settings and publish: `build.py` writes `ads.txt` and the verification meta tag.
3. After approval, create four **display / in-article ad units** and paste their numeric slot IDs into Settings,
   then tick **Show ads**.
4. In AdSense → *Blocking controls*, block sensitive categories that are not right for students
   (dating, gambling, get-rich-quick, alcohol…). In *Privacy & messaging*, turn on the Google consent message
   for the EEA/UK (required there).
5. Leave *Auto ads* off for the student-friendly placements above (you can tick it in Settings if you want Google
   to add more).

**Security note:** Google only supports a nonce-based Content-Security-Policy for AdSense, which a static site
cannot generate. So while ads are on, `build.py` relaxes the script/frame part of the CSP (the other protections
stay). With ads off, the strict policy applies. The admin always runs under its own strict policy.

## Analytics

- **Page views:** Cloudflare Web Analytics (no cookies, no consent banner needed).
- **Study events** (counted by the Worker in D1, anonymous, no identifiers): which chapters are studied, finished
  quizzes with mode and score band, timed paper attempts, house-ad clicks, and **search terms** — searches for
  topics the site doesn't cover yet are the best list of what to write next. See them in **/admin → Insights**.

## Design and quality

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--brand-600` | `#3949ab` | `#3949ab` | header, hero, footer backgrounds |
| `--brand-ink` | `#3949ab` | `#aab4ff` | indigo text (headings, numbers) |
| `--accent` | `#ffb300` | `#ffb300` | primary button, focus ring |
| `--notes` / `--mcq` / `--paper` / `--lab` | blue / green / purple / teal | lighter tints | content-type badges and cards |

System fonts (no web-font downloads), light/dark following the device with a manual switch, a bottom tab bar
on phones, 44 px+ touch targets, WCAG AA contrast, skip link, visible focus ring, keyboard-operable quizzes
(A–D / 1–4 keys), reduced-motion support, print styles (notes, papers with answers, lab sheets), and an offline
service worker (pages a student opened work without internet; `/offline` lists them).

SEO: clean URLs, canonical tags, Open Graph/Twitter cards with a share image, JSON-LD (WebSite search box,
Organization, BreadcrumbList, Article/LearningResource for notes and labs, Quiz for MCQ sets and papers,
FAQPage on the home page), sitemap with `lastmod`, RSS feed (`/feed.xml`), and robots.txt that allows search
engines and the AdSense crawler but blocks AI-training crawlers.

Security: content can't contain scripts, styles, iframes, event attributes or `javascript:` links (checked in
three places); admin sessions are HMAC-signed `__Host-` cookies (HttpOnly, Secure, SameSite=Strict) that end
when the password changes; passwords are PBKDF2-SHA256 hashed; optional TOTP two-factor; login throttling;
admin requests need a custom header and same origin (CSRF protection); the Worker can write only to the content
folders, and validates every file before committing; uploads are checked by their bytes (PNG/JPEG/WebP only);
KaTeX is pinned with Subresource Integrity.

## Known content issues

- MCQ options are shown in a fixed shuffled order (`shuffled_options` in `build.py`), because most sets
  stored the correct answer as option A. Questions with options like "None of these" keep their order.
- Equations must use `\( … \)` and `\[ … \]`. `$…$` is not rendered.
- The Grade XII model paper (`src/papers/grade-xii-model-2082-set-1.json`) was uploaded as a full web page in
  `src/lessons/`, so it had been skipped since 2026-10-13; it was converted to the structured format on
  2026-11-02. Three `10³³` typos (should be `10⁻³`) in question 4's solution were corrected; please review.
- `src/lessons/acoustic-phenomena-set-2-mcq.json` was uploaded to a mistyped path (`src/lessoacoustic-…`)
  and never published; it is a different 23-question set and is now live as Set 2. A duplicate
  `electron-mcq.json` in the repository root (same questions as `new-electrons-mcq.json`) was removed.
- The two lab practicals contain **sample readings for illustration**, labelled as such. Check them before
  students rely on them.
- `thermoelectric-effect-mcq.json` question 12 originally had only one option. Three wrong unit options were
  added (A/K, W·m, Ω/K), so please review.
- Diagrams with fixed colours sit on a light panel (`<svg class="panel">`) so they stay readable in dark mode.
  New diagrams should use `currentColor` instead.
