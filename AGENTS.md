# Notes for AI coding agents

Physics Decoded: a static study site (Python `build.py`, standard library only) plus a Cloudflare Worker
(`worker/`) for `/admin` and `/api`. Read `README.md` for the architecture and `docs/AUTHORING.md` for content.

## Commands
- `python build.py --check` validate content · `python build.py --strict` build, fail on any problem
- `python build.py --serve` preview the static site at :8000 (clean URLs)
- `npm test` unit tests · `npm run dev` Worker + admin at :8787 (needs `.dev.vars`)
- `npx wrangler deploy --dry-run --outdir .wrangler/dry-run` check the Worker bundles

## Rules that matter
- Content rules exist twice: `build.py` and `admin/shared/validate.js`. Change both together;
  `tests/shared.test.mjs` checks they agree on every file in `src/`.
- Content files (`src/lessons|papers|labs|pages`) are content-only: no `<style>`, `<script>`, `style=`,
  event attributes, iframes or external images. The design is in `src/assets/css/`.
- Never hard-code colours outside `src/assets/css/tokens.css` (light and dark blocks).
- Pages contain no inline scripts (CSP). JSON-LD blocks are the only exception (not executed).
- The Worker may only write paths matched by `WRITABLE` in `admin/shared/validate.js`.
- Static pages must not depend on the Worker or D1: every `/api` call degrades gracefully.
- Ads: placements are decided in `build.py` (`ad_slot`); never inside a question; hidden in `body.focus-mode`.
- Don't rename published content files: the file name is the URL.
- MCQ answers/explanations and paper Group A answers are scrambled into `data-k` (`scramble()` in build.py,
  decoded by `src/assets/js/unlock.js`). Never write them into pages or JSON-LD in plain text;
  `tests/protection.test.mjs` enforces this.
