"""Build the Physics Decoded static site into public/.

    python build.py            # validate src/ and build public/
    python build.py --check    # validate only (nothing is written)
    python build.py --strict   # build, but exit with an error if any file has a problem (used by CI)
    python build.py --serve    # build, then preview at http://localhost:8000 (clean URLs, like Cloudflare)

Sources (the only things anyone edits, by hand or through /admin):
    src/content.json           site info + syllabus for each grade
    src/settings.json          ads, analytics, announcement banner, feature switches
    src/lessons/<slug>.json    an MCQ set (data only)                 -> /posts/<slug>
    src/lessons/<slug>.html    notes (content-only HTML)              -> /posts/<slug>
    src/papers/<slug>.json     a model question paper (structured)    -> /papers/<slug>
    src/papers/<slug>.html     a model question paper (content HTML)  -> /papers/<slug>
    src/labs/<slug>.json       a lab practical (structured)           -> /labs/<slug>
    src/pages/<slug>.html      about, contact, privacy, terms …       -> /<slug>
    src/assets/                shared CSS, JS, images (copied as-is)
    docs/examples/             example files; example-notes.html is built to /styleguide

Every content file carries its own metadata (see docs/AUTHORING.md), so adding content means
adding one file. A file with a problem is skipped (and reported) so one bad upload cannot stop
the rest of the site from being published. Only the Python standard library is used.

URLs are extensionless (/posts/kinematics). The output is posts/kinematics.html, which
Cloudflare serves at /posts/kinematics; the old .html addresses redirect there (_redirects).
"""
import base64
import functools
import hashlib
import html
import json
import random
import re
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "public"

GRADE_URL = {"XI": "/pages/grade-xi", "XII": "/pages/grade-xii"}
PAPERS_URL = "/pages/model-questions"
LABS_URL = "/pages/labs"
SEARCH_URL = "/search"
KIND_LABEL = {"notes": "Notes", "mcq": "MCQs", "paper": "Model paper", "lab": "Lab"}
KIND_ICON = {"notes": "book", "mcq": "check", "paper": "file", "lab": "flask"}
DIFFICULTIES = {"easy", "medium", "hard"}
SLUG_RE = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
# Slugs that src/pages/ may not use, because the build already writes a page there.
RESERVED_PAGES = {"index", "search", "404", "offline", "styleguide", "feed", "sitemap", "robots", "ads", "sw",
                  "admin", "api", "posts", "papers", "labs", "pages", "assets"}
# Things content-only HTML must not contain: styling and behaviour come from the shared assets.
FORBIDDEN_IN_HTML = [
    (r"<\s*(html|head|body|!doctype)\b", "full-page tags"),
    (r"<\s*style\b", "<style> blocks"),
    (r"<\s*script\b", "<script> tags"),
    (r"<\s*link\b", "<link> tags"),
    (r"<\s*(iframe|object|embed|form)\b", "<iframe>, <object>, <embed> or <form> tags"),
    (r"\sstyle\s*=", "style=\"…\" attributes"),
    (r"\son[a-z]+\s*=", "on…=\"…\" event attributes (onclick etc.)"),
    (r"javascript\s*:", "javascript: links"),
]
MCQ_FIELDS = {"q", "options", "answer", "explanation", "difficulty", "image", "image_alt", "source"}

esc = html.escape


class Problems(list):
    def add(self, file, msg):
        self.append(f"{file}: {msg}")


# ---------------------------------------------------------------- reading content

def parse_front_matter(text, file, problems):
    """'---' / key: value lines / '---' at the top of an HTML file."""
    m = re.match(r"﻿?---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not m:
        problems.add(file, "missing front matter (the --- block with title, grade, chapters, date)")
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            problems.add(file, f"front matter line is not 'key: value': {line!r}")
            continue
        value = value.strip()
        if value[:1] in "[{":
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                problems.add(file, f"could not read {key.strip()}: {value!r} (use e.g. [4] or [7, 8])")
        meta[key.strip()] = value
    return meta, text[m.end():]


def check_date(meta, file, problems):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(meta.get("date", ""))):
        problems.add(file, "date must look like 2026-01-31")
        return
    try:
        date.fromisoformat(meta["date"])
    except ValueError:
        problems.add(file, f"date {meta['date']} does not exist")


def check_chapters(meta, file, grades, problems, required=True):
    if meta.get("grade") not in grades:
        problems.add(file, f"grade must be one of {list(grades)}, got {meta.get('grade')!r}")
        return
    chapters = meta.get("chapters")
    if chapters is None and not required:
        meta["chapters"] = []
        return
    if isinstance(chapters, int):
        chapters = meta["chapters"] = [chapters]
    if not isinstance(chapters, list) or (required and not chapters):
        problems.add(file, "chapters must be a list such as [4] or [7, 8, 9]")
        return
    valid = {c["n"] for c in grades[meta["grade"]]["syllabus"]}
    for n in chapters:
        if n not in valid:
            problems.add(file, f"grade {meta['grade']} has no chapter {n} (valid: 1–{max(valid)})")


def validate_meta(meta, file, grades, problems):
    for field in ("title", "grade", "chapters", "date"):
        if field not in meta:
            problems.add(file, f"missing '{field}'")
    check_chapters(meta, file, grades, problems)
    check_date(meta, file, problems)


def check_html(fragment, rel, problems, where=""):
    """Content-only HTML: styling and behaviour come from the shared assets."""
    if not isinstance(fragment, str):
        problems.add(rel, f"{where}must be text".strip())
        return
    prefix = f"{where}: " if where else ""
    if re.match(r"\s*<!doctype", fragment, re.I):
        problems.add(rel, prefix + "full web pages are not accepted; convert it to content-only HTML "
                                   "(docs/prompts/convert-legacy-notes.md)")
        return
    for pattern, what in FORBIDDEN_IN_HTML:
        if re.search(pattern, fragment, re.I):
            problems.add(rel, f"{prefix}must not contain {what}; the site stylesheet and scripts handle that")
    for svg in re.findall(r"<svg\b[^>]*>", fragment, re.I):
        if not re.search(r"\bviewBox=", svg):
            problems.add(rel, prefix + "every <svg> needs a viewBox so it can shrink to fit phone screens")
    for src in re.findall(r"<img\b[^>]*\bsrc=\"([^\"]+)\"", fragment, re.I):
        if not src.startswith("/assets/img/"):
            problems.add(rel, prefix + f"images must be stored in src/assets/img/ (got {src[:60]})")


def check_image_path(value, rel, problems, where):
    if not isinstance(value, str) or not re.fullmatch(r"/assets/img/[A-Za-z0-9._/-]+", value):
        problems.add(rel, f"{where}: image must be a path like /assets/img/lens-diagram.webp")
    elif not (SRC / value.lstrip("/")).is_file():
        problems.add(rel, f"{where}: {value} does not exist in src/assets/img/")


def validate_questions(qs, file, problems):
    if not isinstance(qs, list) or not qs:
        problems.add(file, "'questions' must be a non-empty list")
        return
    seen = {}
    for n, q in enumerate(qs, 1):
        where = f"question {n}"
        if not isinstance(q, dict):
            problems.add(file, f"{where} is not an object")
            continue
        extra = set(q) - MCQ_FIELDS
        if extra:
            problems.add(file, f"{where}: unknown field(s) {sorted(extra)}")
        if not isinstance(q.get("q"), str) or not q["q"].strip():
            problems.add(file, f"{where}: 'q' (the question text) is missing")
        elif q["q"].strip() in seen:
            problems.add(file, f"{where}: same question text as question {seen[q['q'].strip()]}")
        else:
            seen[q["q"].strip()] = n
        opts = q.get("options")
        if not isinstance(opts, list) or not 2 <= len(opts) <= 6 or not all(isinstance(o, str) and o.strip() for o in opts):
            problems.add(file, f"{where}: 'options' must be a list of 2–6 non-empty strings")
            continue
        if len({o.strip() for o in opts}) != len(opts):
            problems.add(file, f"{where}: two options are identical")
        a = q.get("answer")
        if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a < len(opts):
            problems.add(file, f"{where}: 'answer' must be the option number counting from 0 (0 = A, 1 = B …), got {a!r}")
        if "difficulty" in q and q["difficulty"] not in DIFFICULTIES:
            problems.add(file, f"{where}: difficulty must be easy, medium or hard")
        for field in ("explanation", "source", "image_alt"):
            if field in q and not isinstance(q[field], str):
                problems.add(file, f"{where}: '{field}' must be text")
        if "image" in q:
            check_image_path(q["image"], file, problems, where)


def load_json(f, rel, problems):
    try:
        text = f.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        problems.add(rel, "file is not saved as UTF-8 text")
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        problems.add(rel, f"invalid JSON at line {e.lineno}, column {e.colno}: {e.msg}")
        return None
    if not isinstance(data, dict):
        problems.add(rel, "the file must be one JSON object { \"title\": … }")
        return None
    return data


def load_text(f, rel, problems):
    try:
        return f.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        problems.add(rel, "file is not saved as UTF-8 text")
        return None


def check_name(f, rel, problems):
    if not SLUG_RE.fullmatch(f.stem):
        problems.add(rel, "file name must be lowercase words joined by hyphens, e.g. wave-motion.html")


def read_lesson(f, rel, grades, problems):
    if f.suffix not in (".json", ".html"):
        problems.add(rel, "only .json (MCQ) and .html (notes) files belong here")
        return None
    check_name(f, rel, problems)
    if f.suffix == ".json":
        meta = load_json(f, rel, problems)
        if meta is None:
            return None
        meta["kind"] = "mcq"
        meta["format"] = "mcq"
        validate_questions(meta.get("questions"), rel, problems)
    else:
        text = load_text(f, rel, problems)
        if text is None:
            return None
        meta, body = parse_front_matter(text, rel, problems)
        meta.update(kind="notes", format="notes", body=body)
        check_html(body, rel, problems)
    validate_meta(meta, rel, grades, problems)
    if meta.get("video") and not str(meta["video"]).startswith("https://"):
        problems.add(rel, "video must be a https:// link (e.g. a YouTube video)")
    meta.update(slug=f.stem, file=rel, url=f"/posts/{f.stem}")
    return meta


def validate_paper_question(q, rel, problems, where, allow_or=True):
    if not isinstance(q, dict):
        problems.add(rel, f"{where} is not an object")
        return 0
    allowed = {"q", "marks", "options", "answer", "solution", "parts", "or", "image", "image_alt"}
    extra = set(q) - allowed
    if extra:
        problems.add(rel, f"{where}: unknown field(s) {sorted(extra)}")
    if "or" in q and not allow_or:
        problems.add(rel, f"{where}: an OR alternative cannot have its own OR")
    for field in ("q", "solution"):
        if field in q:
            check_html(q[field], rel, problems, f"{where} {field}")
    if "image" in q:
        check_image_path(q["image"], rel, problems, where)
    if "parts" in q:
        parts = q["parts"]
        if not isinstance(parts, list) or not parts:
            problems.add(rel, f"{where}: 'parts' must be a non-empty list")
            return 0
        total = 0
        for i, p in enumerate(parts):
            pw = f"{where} part {'abcdefgh'[i] if i < 8 else i + 1}"
            if not isinstance(p, dict) or not isinstance(p.get("q"), str) or not p["q"].strip():
                problems.add(rel, f"{pw}: needs 'q' (the question text)")
                continue
            if set(p) - {"q", "marks", "solution"}:
                problems.add(rel, f"{pw}: unknown field(s) {sorted(set(p) - {'q', 'marks', 'solution'})}")
            check_html(p["q"], rel, problems, pw)
            if "solution" in p:
                check_html(p["solution"], rel, problems, f"{pw} solution")
            if not isinstance(p.get("marks"), (int, float)) or isinstance(p.get("marks"), bool) or p["marks"] <= 0:
                problems.add(rel, f"{pw}: 'marks' must be a positive number")
            else:
                total += p["marks"]
        marks = total
    else:
        if not isinstance(q.get("q"), str) or not q["q"].strip():
            problems.add(rel, f"{where}: needs 'q' (the question text) or 'parts'")
        if "options" in q:
            opts = q["options"]
            if not isinstance(opts, list) or not 2 <= len(opts) <= 6 or not all(isinstance(o, str) and o.strip() for o in opts):
                problems.add(rel, f"{where}: 'options' must be a list of 2–6 non-empty strings")
            elif not isinstance(q.get("answer"), int) or isinstance(q.get("answer"), bool) or not 0 <= q["answer"] < len(opts):
                problems.add(rel, f"{where}: 'answer' must be the option number counting from 0 (0 = a, 1 = b …)")
            marks = q.get("marks", 1)
        else:
            marks = q.get("marks")
            if not isinstance(marks, (int, float)) or isinstance(marks, bool) or marks <= 0:
                problems.add(rel, f"{where}: 'marks' must be a positive number")
                marks = 0
    if allow_or and isinstance(q.get("or"), dict):
        alt = validate_paper_question(q["or"], rel, problems, f"{where} (OR)", allow_or=False)
        if alt and marks and alt != marks:
            problems.add(rel, f"{where}: the OR alternative is worth {alt} marks but the question is worth {marks}")
    return marks


def read_paper(f, rel, grades, problems):
    """A model question paper: structured JSON (preferred; the admin writes this) or content-only HTML."""
    if f.suffix not in (".json", ".html"):
        problems.add(rel, "model papers are .json (structured) or .html files (see docs/AUTHORING.md)")
        return None
    check_name(f, rel, problems)
    if f.suffix == ".json":
        meta = load_json(f, rel, problems)
        if meta is None:
            return None
        meta["format"] = "json"
        groups = meta.get("groups")
        if not isinstance(groups, list) or not groups:
            problems.add(rel, "'groups' must be a non-empty list (Group A, Group B …)")
        else:
            total = 0
            for gi, g in enumerate(groups, 1):
                if not isinstance(g, dict) or not g.get("title") or not isinstance(g.get("questions"), list) or not g["questions"]:
                    problems.add(rel, f"group {gi}: needs a 'title' and a non-empty 'questions' list")
                    continue
                for qi, q in enumerate(g["questions"], 1):
                    total += validate_paper_question(q, rel, problems, f"{g['title']} question {qi}")
            fm = meta.get("full_marks")
            if fm is not None and (not isinstance(fm, (int, float)) or abs(total - fm) > 1e-9):
                problems.add(rel, f"the questions add up to {total:g} marks but full_marks is {fm}")
            meta["total_marks"] = total
    else:
        text = load_text(f, rel, problems)
        if text is None:
            return None
        meta, body = parse_front_matter(text, rel, problems)
        meta.update(body=body, format="html")
        check_html(body, rel, problems)
    for field in ("title", "grade", "year", "date"):
        if field not in meta:
            problems.add(rel, f"missing '{field}'")
    if meta.get("grade") not in grades:
        problems.add(rel, f"grade must be one of {list(grades)}, got {meta.get('grade')!r}")
    if not re.fullmatch(r"\d{4}", str(meta.get("year", ""))):
        problems.add(rel, "year must be four digits, e.g. 2081")
    check_date(meta, rel, problems)
    meta.update(slug=f.stem, file=rel, kind="paper", url=f"/papers/{f.stem}")
    return meta


LAB_LISTS = ("apparatus", "procedure", "precautions", "errors")
LAB_HTML = ("aim", "theory", "calculation", "result", "conclusion")


def read_lab(f, rel, grades, problems):
    if f.suffix != ".json":
        problems.add(rel, "labs are .json files (see docs/AUTHORING.md#labs)")
        return None
    check_name(f, rel, problems)
    meta = load_json(f, rel, problems)
    if meta is None:
        return None
    allowed = {"title", "grade", "chapters", "date", "number", "description", "video", "diagram", "observations", "viva",
               *LAB_LISTS, *LAB_HTML}
    extra = set(meta) - allowed
    if extra:
        problems.add(rel, f"unknown field(s) {sorted(extra)}")
    for field in ("title", "grade", "date", "aim", "apparatus", "procedure"):
        if not meta.get(field):
            problems.add(rel, f"missing '{field}'")
    check_chapters(meta, rel, grades, problems, required=False)
    check_date(meta, rel, problems)
    for field in LAB_HTML:
        if field in meta:
            check_html(meta[field], rel, problems, field)
    for field in LAB_LISTS:
        if field in meta:
            items = meta[field]
            if not isinstance(items, list) or not all(isinstance(x, str) and x.strip() for x in items):
                problems.add(rel, f"'{field}' must be a list of text items")
            else:
                for i, x in enumerate(items, 1):
                    check_html(x, rel, problems, f"{field} item {i}")
    if "number" in meta and (not isinstance(meta["number"], int) or isinstance(meta["number"], bool)):
        problems.add(rel, "'number' (the experiment number) must be a whole number")
    if "diagram" in meta:
        d = meta["diagram"]
        if not isinstance(d, dict) or not d.get("alt"):
            problems.add(rel, "'diagram' must be {\"src\": \"/assets/img/…\", \"alt\": \"…\", \"caption\": \"…\"}")
        else:
            check_image_path(d.get("src"), rel, problems, "diagram")
    for ti, t in enumerate(meta.get("observations", []) or [], 1):
        if not isinstance(t, dict) or not isinstance(t.get("headers"), list) or not isinstance(t.get("rows"), list):
            problems.add(rel, f"observation table {ti}: needs 'headers' (list) and 'rows' (list of lists)")
            continue
        for ri, row in enumerate(t["rows"], 1):
            if not isinstance(row, list) or len(row) != len(t["headers"]):
                problems.add(rel, f"observation table {ti} row {ri}: must have {len(t['headers'])} cells like the headers")
    for vi, v in enumerate(meta.get("viva", []) or [], 1):
        if not isinstance(v, dict) or not v.get("q") or not v.get("a"):
            problems.add(rel, f"viva question {vi}: needs 'q' and 'a'")
        else:
            check_html(v["a"], rel, problems, f"viva {vi} answer")
    if meta.get("video") and not str(meta["video"]).startswith("https://"):
        problems.add(rel, "video must be a https:// link")
    meta.update(slug=f.stem, file=rel, kind="lab", url=f"/labs/{f.stem}")
    return meta


def read_page(f, rel, problems):
    if f.suffix != ".html":
        problems.add(rel, "pages are .html files with a front matter block (title, description)")
        return None
    check_name(f, rel, problems)
    if f.stem in RESERVED_PAGES:
        problems.add(rel, f"'{f.stem}' is used by the site itself; choose another file name")
    text = load_text(f, rel, problems)
    if text is None:
        return None
    meta, body = parse_front_matter(text, rel, problems)
    if not meta.get("title"):
        problems.add(rel, "missing 'title'")
    check_html(body, rel, problems)
    meta.update(body=body, slug=f.stem, file=rel, url=f"/{f.stem}")
    return meta


def read_dir(name, reader, problems, *args):
    out, folder = [], SRC / name
    for f in sorted(folder.iterdir()) if folder.is_dir() else []:
        if f.is_dir() or f.name.startswith(".") or f.name.lower() == "readme.md":
            continue
        before = len(problems)
        meta = reader(f, f"src/{name}/{f.name}", *args, problems)
        if meta is not None and len(problems) == before:
            out.append(meta)
    by_slug = {}
    for p in out:
        by_slug.setdefault(p["slug"], []).append(p)
    for s, same in by_slug.items():
        if len(same) > 1:
            problems.append(f"src/{name}: '{s}' exists as both .json and .html (both skipped)")
            out = [p for p in out if p["slug"] != s]
    return out


def load():
    problems = Problems()
    data = json.loads((SRC / "content.json").read_text(encoding="utf-8"))
    settings_file = SRC / "settings.json"
    data["settings"] = json.loads(settings_file.read_text(encoding="utf-8")) if settings_file.is_file() else {}
    grades = data["grades"]
    posts = read_dir("lessons", read_lesson, problems, grades)
    posts.sort(key=lambda p: (p.get("date", ""), p["slug"]), reverse=True)
    papers = read_dir("papers", read_paper, problems, grades)
    papers.sort(key=lambda p: (p["grade"], -int(p["year"]), p["title"]))
    labs = read_dir("labs", read_lab, problems, grades)
    labs.sort(key=lambda p: (p["grade"], p.get("number", 999), p["title"]))
    pages = read_dir("pages", lambda f, rel, problems: read_page(f, rel, problems), problems)
    return data, posts, papers, labs, pages, problems


# ---------------------------------------------------------------- helpers

def chapter_of(data, post):
    syl = {c["n"]: c for c in data["grades"][post["grade"]]["syllabus"]}
    return [syl[n] for n in post.get("chapters", [])]


def plain(s):
    return re.sub(r"<[^>]+>", "", s)


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", plain(html.unescape(text)).lower()).strip("-") or "section"


def out_path(url):
    """/posts/x -> posts/x.html; / -> index.html"""
    return "index.html" if url == "/" else url.lstrip("/") + ".html"


@functools.cache
def asset(rel):
    """URL of a shared asset with a content hash, so browsers can cache it for a year and still
    pick up every change at once (see the Cache-Control rules in _headers)."""
    digest = hashlib.sha256((SRC / "assets" / rel).read_bytes()).hexdigest()[:10]
    return f"/assets/{rel}?v={digest}"


def icon(name, cls="icon"):
    return f'<svg class="{cls}" aria-hidden="true" focusable="false"><use href="{asset("icons.svg")}#{name}"></use></svg>'


def jsonld(*objs):
    out = []
    for o in objs:
        if o:
            text = json.dumps({"@context": "https://schema.org", **o}, ensure_ascii=False, separators=(",", ":"))
            text = text.replace("</", "<\\/")
            out.append(f'<script type="application/ld+json">{text}</script>')
    return "\n".join(out)


def breadcrumb_ld(data, trail):
    """trail: [(name, url or None)], last item is the current page."""
    site = data["site"]
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i, "name": name, **({"item": site["url"] + url} if url else {})}
        for i, (name, url) in enumerate(trail, 1)]}


def crumbs_html(trail):
    parts = []
    for name, url in trail[:-1]:
        parts.append(f'<li><a href="{url}">{esc(name)}</a></li>')
    parts.append(f'<li aria-current="page">{esc(trail[-1][0])}</li>')
    return f'<nav class="crumbs" aria-label="Breadcrumb"><ol>{"".join(parts)}</ol></nav>'


def publisher(data):
    site = data["site"]
    return {"@type": "Organization", "name": site["name"], "url": site["url"] + "/",
            "logo": {"@type": "ImageObject", "url": site["url"] + "/assets/img/icons/icon-512.png"}}


def ads_on(data):
    a = data["settings"].get("ads", {})
    return bool(a.get("enabled"))


def ad_slot(data, name, label="Advertisement"):
    """A placeholder that assets/js/ads.js fills (AdSense, else a house ad) when it scrolls near."""
    if not ads_on(data):
        return ""
    return f'<aside class="ad-slot" data-ad="{name}" aria-label="{label}"><span class="ad-label">{label}</span></aside>'


def youtube_id(url):
    m = re.search(r"(?:youtu\.be/|v=|/embed/|/shorts/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else None


def video_block(url):
    """A click-to-load YouTube player: nothing is downloaded from YouTube until the student taps it."""
    if not url:
        return ""
    vid = youtube_id(url)
    if not vid:
        return f'<p class="video-link"><a class="btn btn-ghost" href="{esc(url)}" target="_blank" rel="noopener">{icon("play")} Watch the video lesson</a></p>'
    return (f'<div class="video" data-video="{vid}"><a class="video-poster" href="https://www.youtube.com/watch?v={vid}" target="_blank" rel="noopener">'
            f'{icon("play", "icon play")}<span>Watch the video lesson</span></a></div>')


# ---------------------------------------------------------------- the page shell

def shell(data, *, title, body, description=None, path="/", current=None, css=(), scripts=(), noindex=False,
          track=None, ld=(), og_type="website", modified=None, ads=True, body_class=""):
    """track: what this page is, for analytics (kind / grade / chapter / area), read by analytics.js."""
    site, settings = data["site"], data["settings"]
    full_title = f"{title} | {site['name']}" if title != site["name"] else f"{site['name']}: Grade XI & XII Physics Notes, MCQs and Model Questions"
    desc = description or site["tagline"]
    canonical = site["url"] + ("/" if path == "/" else path)

    def nav(href, label, key, ico):
        cur = ' aria-current="page"' if key == current else ""
        return f'<a href="{href}"{cur}>{icon(ico)}<span>{label}</span></a>'

    styles = "".join(f'<link rel="stylesheet" href="{asset(f"css/{c}.css")}">\n' for c in ("tokens", "site", *css))
    page_ads = ads and ads_on(data)
    js_list = ["analytics", "site", *scripts] + (["ads"] if page_ads else [])
    js = "".join(f'<script src="{asset(f"js/{s}.js")}" defer></script>\n' for s in js_list)
    robots = '<meta name="robots" content="noindex, follow">\n' if noindex else '<meta name="robots" content="index, follow, max-image-preview:large">\n'
    track_attrs = "".join(f' data-{k}="{esc(str(v))}"' for k, v in (track or {}).items() if v)
    ver = settings.get("verification", {})
    verify = "".join(f'<meta name="{n}" content="{esc(ver[k])}">\n' for k, n in (("google", "google-site-verification"), ("bing", "msvalidate.01")) if ver.get(k))
    analytics = settings.get("analytics", {})
    cf = (f'<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{{"token": "{esc(analytics["cloudflare_token"])}"}}\'></script>\n'
          if analytics.get("cloudflare_token") else "")
    adsense_meta = ""
    if page_ads and settings["ads"].get("adsense_client"):
        adsense_meta = f'<meta name="google-adsense-account" content="{esc(settings["ads"]["adsense_client"])}">\n'
    ann = settings.get("announcement", {})
    banner = ""
    if ann.get("enabled") and ann.get("text"):
        inner = esc(ann["text"]) + (f' <a href="{esc(ann["link"])}">Read more →</a>' if ann.get("link") else "")
        banner = f'<div class="announce" role="note">{inner}</div>'
    modified_meta = f'<meta property="article:modified_time" content="{modified}">\n' if modified else ""
    body_attrs = track_attrs + (f' class="{body_class}"' if body_class else "") + (' data-ads="on"' if page_ads else "")
    year = date.today().year
    designer = site.get("designer", {})
    return f"""<!doctype html>
<html lang="{site.get('language', 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(desc)}">
{robots}<link rel="canonical" href="{canonical}">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="{esc(site['name'])}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{site['url']}/assets/img/og-default.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_US">
{modified_meta}<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#283593" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1222" media="(prefers-color-scheme: dark)">
{verify}{adsense_meta}<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="alternate" type="application/rss+xml" title="{esc(site['name'])}: new lessons" href="/feed.xml">
<script src="{asset('js/theme.js')}"></script>
{styles}{js}{cf}{jsonld(*ld)}
</head>
<body{body_attrs}>
<a class="skip" href="#main">Skip to content</a>
{banner}<header class="site-header">
  <nav class="nav" aria-label="Main">
    <a class="brand" href="/"><img src="/assets/favicon.svg" alt="" width="32" height="32"><span>{esc(site['name'])}</span></a>
    <div class="nav-links">
      {nav(GRADE_URL['XI'], 'Grade XI', 'XI', 'layers')}{nav(GRADE_URL['XII'], 'Grade XII', 'XII', 'layers')}{nav(PAPERS_URL, 'Model Questions', 'papers', 'file')}{nav(LABS_URL, 'Labs', 'labs', 'flask')}
    </div>
    <form class="nav-search" action="{SEARCH_URL}" role="search"><label class="sr-only" for="nav-q">Search topics</label>{icon('search')}<input id="nav-q" type="search" name="q" placeholder="Search topics…" autocomplete="off"></form>
    <a class="icon-btn search-btn" href="{SEARCH_URL}" aria-label="Search">{icon('search')}</a>
    <button class="icon-btn theme-btn" type="button" aria-label="Switch colour theme" title="Light / dark">{icon('sun', 'icon sun')}{icon('moon', 'icon moon')}</button>
  </nav>
</header>
<main class="container" id="main">
{body}
</main>
<p class="print-credit">Printed from {esc(site['name'])} · {canonical} · © {year} {esc(site['author'])}. For personal study only; please don't republish.</p>
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <a class="brand" href="/"><img src="/assets/favicon.svg" alt="" width="28" height="28"><span>{esc(site['name'])}</span></a>
      <p>{esc(site['tagline'])}</p>
      <p class="muted">By {esc(site['author'])} · {esc(site['curriculum'])}</p>
      <a class="btn btn-yt" href="{site['youtube']}" target="_blank" rel="noopener">{icon('play')} YouTube channel</a>
    </div>
    <nav class="footer-col" aria-label="Study">
      <h2>Study</h2>
      <a href="{GRADE_URL['XI']}">Grade XI</a><a href="{GRADE_URL['XII']}">Grade XII</a><a href="{PAPERS_URL}">Model Questions</a><a href="{LABS_URL}">Lab practicals</a><a href="{SEARCH_URL}">All lessons</a>
    </nav>
    <nav class="footer-col" aria-label="About">
      <h2>About</h2>
      <a href="/about">About us</a><a href="/contact">Contact</a><a href="/editorial-policy">Editorial policy</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms of use</a><a href="/disclaimer">Disclaimer</a>
    </nav>
  </div>
  <div class="footer-bottom">
    <span>© {year} {esc(site['author'])}. Original notes and questions; please don't copy or republish them without permission.</span>
    <span class="credit">Design By <a href="{esc(designer.get('url', 'https://mcqplex.com'))}" target="_blank" rel="noopener">{esc(designer.get('name', 'Mcqplex Tech'))}</a></span>
  </div>
</footer>
<nav class="tabbar" aria-label="Quick links">
  {nav('/', 'Home', 'home', 'home')}{nav(GRADE_URL['XI'], 'XI', 'XI', 'layers')}{nav(GRADE_URL['XII'], 'XII', 'XII', 'layers')}{nav(PAPERS_URL, 'Papers', 'papers', 'file')}{nav(LABS_URL, 'Labs', 'labs', 'flask')}
</nav>
</body>
</html>
"""


def card(data, post):
    chaps = ", ".join(c["title"] for c in chapter_of(data, post))
    kind = post["kind"]
    extra = f" · {len(post['questions'])} questions" if kind == "mcq" else ""
    if kind == "paper":
        sub = f"Grade {post['grade']} · {post['year']}"
    elif kind == "lab":
        sub = f"Grade {post['grade']} practical" + (f" · {chaps}" if chaps else "")
    else:
        sub = f"Grade {post['grade']} · {chaps}{extra}"
    return f"""<article class="card kind-{kind}" data-slug="{post['slug']}">
  <div class="card-top"><span class="kind-ico">{icon(KIND_ICON[kind])}</span><span class="badge {kind}">{KIND_LABEL[kind]}</span></div>
  <h3><a href="{post['url']}">{esc(post['title'])}</a></h3>
  <div class="meta">{esc(sub)}</div>
</article>"""


def track_of(data, post):
    ch = chapter_of(data, post)
    if not ch:
        return {"kind": post["kind"], "grade": post["grade"]}
    return {"kind": post["kind"], "grade": post["grade"], "chapter": f"{post['grade']} Ch {ch[0]['n']} {ch[0]['title']}", "area": ch[0]["area"]}


def related(posts, post):
    return [p for p in posts if p is not post and p["grade"] == post["grade"] and set(p.get("chapters", [])) & set(post.get("chapters", []))]


def lesson_trail(data, post):
    grade = data["grades"][post["grade"]]
    trail = [("Home", "/"), (grade["title"], GRADE_URL[post["grade"]])]
    ch = chapter_of(data, post)
    if ch:
        trail.append((ch[0]["title"], f"{GRADE_URL[post['grade']]}#ch-{ch[0]['n']}"))
    trail.append((post["title"], None))
    return trail


def page_tools(report=True):
    rep = f'<button type="button" class="tool" data-report>{icon("flag")}<span>Report a mistake</span></button>' if report else ""
    return (f'<div class="page-tools"><button type="button" class="tool" data-share>{icon("share")}<span>Share</span></button>'
            f'<button type="button" class="tool" data-print>{icon("print")}<span>Print</span></button>{rep}</div>')


def lesson_head(data, post, extra_badges=""):
    chaps = ", ".join(f"Ch. {c['n']} {c['title']}" for c in chapter_of(data, post))
    lead = f'<p class="lead">{esc(post["description"])}</p>' if post.get("description") else ""
    meta_bits = [b for b in (chaps, f"Updated {post['date']}") if b]
    report = data["settings"].get("features", {}).get("reports", True)
    return f"""{crumbs_html(lesson_trail(data, post))}
<header class="lesson-head">
  <div class="tags"><span class="badge {post['kind']}">{icon(KIND_ICON[post['kind']])}{KIND_LABEL[post['kind']]}</span><span class="badge">Grade {post['grade']}</span>{extra_badges}</div>
  <h1>{esc(post['title'])}</h1>
  {lead}
  <p class="meta">{esc(' · '.join(meta_bits))}</p>
  {page_tools(report)}
</header>"""


def related_block(data, posts, post, title="Also in this chapter"):
    rel = related(posts, post)
    if not rel:
        return ""
    return f"""<section class="related"><h2>{title}</h2>
<div class="grid">{''.join(card(data, p) for p in rel)}</div></section>"""


def article_ld(data, post, kind_type="Article", extra=None):
    site = data["site"]
    ch = chapter_of(data, post)
    obj = {"@type": [kind_type, "LearningResource"], "headline": post["title"], "name": post["title"],
           "description": post.get("description") or post["title"], "inLanguage": "en",
           "datePublished": post["date"], "dateModified": post["date"],
           "author": {"@type": "Person", "name": site["author"]}, "publisher": publisher(data),
           "image": site["url"] + "/assets/img/og-default.jpg", "mainEntityOfPage": site["url"] + post["url"],
           "isAccessibleForFree": True, "educationalLevel": f"Grade {post['grade']}",
           "educationalAlignment": {"@type": "AlignmentObject", "alignmentType": "educationalSubject",
                                    "educationalFramework": site["curriculum"], "targetName": "Physics"}}
    if ch:
        obj["about"] = [{"@type": "Thing", "name": c["title"]} for c in ch]
    obj.update(extra or {})
    return obj


# ---------------------------------------------------------------- lesson pages

# Options that refer to the other options must keep their place, so such questions are not shuffled.
REFERS_TO_OPTIONS = re.compile(r"\b(all|none|both|neither)\b.*\b(above|these|of them)\b|^(both|neither)\b", re.I)


def shuffled_options(post, i, q):
    """Many MCQ files put the correct answer first. Show the options in a fixed per-question random
    order (the same on every build) so the answer is not always A. Returns (options, answer index)."""
    opts = list(q["options"])
    if any(REFERS_TO_OPTIONS.search(o) for o in opts):
        return opts, q["answer"]
    order = list(range(len(opts)))
    random.Random(f"{post['slug']}:{i}:{q['q']}").shuffle(order)
    return [opts[k] for k in order], order.index(q["answer"])


SCRAMBLE_SALT = "pd-k1"


def scramble(id_, obj):
    """Light protection for answer keys: XOR the JSON with a key stream derived from the page and
    question, then base64. assets/js/unlock.js reverses it in the browser. Keeps plain-HTML scrapers
    from collecting question + answer pairs; it is obfuscation, not encryption."""
    M = 0xFFFFFFFF
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    h = 2166136261
    for b in f"{SCRAMBLE_SALT}:{id_}".encode():
        h = ((h ^ b) * 16777619) & M
    a, out = h, bytearray()
    for byte in data:
        a = (a + 0x6D2B79F5) & M
        t = ((a ^ (a >> 15)) * (1 | a)) & M
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M)) ^ t) & M
        out.append(byte ^ ((t ^ (t >> 14)) & 255))
    return base64.b64encode(bytes(out)).decode()


def has_math(text):
    return bool(re.search(r"\\\(|\\\[", text))


def build_mcq(data, posts, post):
    qs, math = [], False
    n = len(post["questions"])
    for i, q in enumerate(post["questions"]):
        diff = q.get("difficulty")
        options, answer = shuffled_options(post, i, q)
        math = math or has_math(q["q"] + "".join(options) + q.get("explanation", ""))
        opts = "".join(f'<li><button class="option" type="button" aria-pressed="false"><span class="letter" aria-hidden="true">{"ABCDEF"[j]}</span><span class="opt-text">{esc(o)}</span></button></li>'
                       for j, o in enumerate(options))
        key = scramble(f"{post['slug']}:{i}", {"a": answer, "e": q.get("explanation", "")})
        img = (f'<figure class="q-fig"><img src="{esc(q["image"])}" alt="{esc(q.get("image_alt", "Diagram for question " + str(i + 1)))}" loading="lazy"></figure>'
               if q.get("image") else "")
        src = f'<span class="q-source">{esc(q["source"])}</span>' if q.get("source") else ""
        qs.append(f"""<li class="question" data-i="{i}" data-k="{key}" data-difficulty="{diff or ''}">
  <div class="q-head"><p class="q-text"><span class="q-num">{i + 1}.</span> {esc(q['q'])}</p><span class="q-tags">{src}{f'<span class="diff {diff}">{diff}</span>' if diff else ''}</span></div>
  {img}<ol class="options" type="A">{opts}</ol>
  <div class="explanation" hidden role="status"><span class="verdict"></span> <span class="exp-text"></span></div>
</li>""")
        if n >= 30 and i == 14 and ads_on(data):
            qs.append(f'<li class="ad-row">{ad_slot(data, "in_article")}</li>')
    minutes = max(5, round(n * 1.0))
    body = f"""{lesson_head(data, post, f'<span class="badge">{n} questions</span>')}
<div class="quiz" data-quiz="{post['slug']}" data-minutes="{minutes}"{' data-math' if math else ''}>
  <div class="quiz-bar">
    <div class="mode" role="group" aria-label="Mode">
      <button type="button" data-mode="practice" aria-pressed="true">Practice</button><button type="button" data-mode="test" aria-pressed="false">Test</button>
    </div>
    <span class="score" aria-live="polite"></span>
    <span class="timer" hidden aria-live="off"></span>
    <span class="progress" aria-hidden="true"><span></span></span>
    <label class="filter">Show <select data-filter>
      <option value="all">All questions</option><option value="unanswered">Unanswered</option><option value="wrong">Wrong answers</option>
      <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
    </select></label>
    <button type="button" data-action="shuffle">Shuffle</button>
    <button type="button" data-action="reset">Reset</button>
    <button type="button" class="btn submit" data-action="submit" hidden>Submit test</button>
  </div>
  <p class="mode-help" data-help="practice">Practice mode: the answer and explanation appear as soon as you choose an option.</p>
  <p class="mode-help" data-help="test" hidden>Test mode: answer everything, then press <b>Submit test</b> to see your score. Suggested time: {minutes} minutes.</p>
  <ol class="questions">
{''.join(qs)}
  </ol>
  <div class="result card" hidden><div class="big"></div><p class="msg"></p><p class="result-actions"><button type="button" class="btn" data-action="review">Review wrong answers</button> <button type="button" class="btn btn-ghost" data-action="reset">Try again</button></p></div>
</div>
{video_block(post.get('video'))}
{ad_slot(data, 'end_of_content')}
{related_block(data, posts, post)}"""
    desc = post.get("description") or f"{post['title']}: Grade {post['grade']} physics MCQ practice with answers and explanations."
    # Question texts only: the answers are deliberately left out of the page source (see scramble()).
    questions_ld = [{"@type": "Question", "eduQuestionType": "Multiple choice", "text": q["q"]} for q in post["questions"]]
    quiz_ld = article_ld(data, post, "Quiz", {"learningResourceType": "Practice quiz", "hasPart": questions_ld})
    quiz_ld.pop("headline", None)
    return shell(data, title=post["title"], body=body, description=desc, path=post["url"], current=post["grade"],
                 css=("lesson",), scripts=("unlock", "quiz", "math"), track=track_of(data, post), og_type="article", modified=post["date"],
                 ld=(quiz_ld, breadcrumb_ld(data, lesson_trail(data, post))))


def add_heading_ids(body_html):
    toc, used = [], set()

    def add_id(m):
        attrs, inner = m.group(1), m.group(2)
        idm = re.search(r'\bid="([^"]+)"', attrs)
        hid = idm.group(1) if idm else slugify(inner)
        base, n = hid, 2
        while hid in used:
            hid, n = f"{base}-{n}", n + 1
        used.add(hid)
        toc.append((hid, plain(inner)))
        if not idm:
            attrs += f' id="{hid}"'
        return f"<h2{attrs}>{inner}</h2>"

    return re.sub(r"<h2([^>]*)>(.*?)</h2>", add_id, body_html, flags=re.S | re.I), toc


def insert_mid_ad(data, body_html, after_h2=3):
    """Put one ad before the n-th <h2> of a long article: between sections, never inside one."""
    if not ads_on(data):
        return body_html
    starts = [m.start() for m in re.finditer(r"<h2\b", body_html, re.I)]
    if len(starts) < after_h2 + 1:
        return body_html
    i = starts[after_h2 - 1]
    return body_html[:i] + ad_slot(data, "in_article") + "\n" + body_html[i:]


def toc_nav(toc):
    if len(toc) < 3:
        return ""
    items = "".join(f'<li><a href="#{i}">{esc(html.unescape(t))}</a></li>' for i, t in toc)
    return f'<nav aria-label="On this page"><details class="toc" open><summary>On this page ({len(toc)})</summary><ol>{items}</ol></details></nav>'


def build_notes(data, posts, post, *, path=None, noindex=False):
    body_html, toc = add_heading_ids(post["body"])
    body_html = insert_mid_ad(data, body_html)
    toc_html = toc_nav(toc)
    aside = f'<aside class="lesson-side">{toc_html}{ad_slot(data, "sidebar")}</aside>' if toc_html else ""
    body = f"""{lesson_head(data, post)}
<div class="lesson{'' if aside else ' no-toc'}">
<article class="notes-body" data-math>
{body_html.strip()}
</article>
{aside}
</div>
{video_block(post.get('video'))}
{ad_slot(data, 'end_of_content')}
{related_block(data, posts, post)}"""
    desc = post.get("description") or f"{post['title']}: Grade {post['grade']} physics notes ({data['site']['curriculum']})."
    url = path or post["url"]
    ld = () if noindex else (article_ld(data, post, "Article", {"learningResourceType": "Lecture notes"}),
                             breadcrumb_ld(data, lesson_trail(data, post)))
    return shell(data, title=post["title"], body=body, description=desc, path=url, current=post["grade"], css=("lesson",),
                 scripts=("notes", "math"), noindex=noindex, track=track_of(data, post), og_type="article",
                 modified=post["date"], ld=ld, body_class="reading")


# ---------------------------------------------------------------- model papers

def paper_trail(paper):
    return [("Home", "/"), ("Model Questions", PAPERS_URL), (f"Grade {paper['grade']}", f"{PAPERS_URL}#grade-{paper['grade'].lower()}"),
            (paper["title"], None)]


def paper_question_html(q, num, is_or=False, slug=""):
    label = f'{num}{" (OR)" if is_or else ""}.'
    def sol(text, summary="Answer"):
        return f'<details class="solution"><summary>{summary}</summary><div>{text}</div></details>' if text else ""
    def fig(q):
        return (f'<figure class="q-fig"><img src="{esc(q["image"])}" alt="{esc(q.get("image_alt", "Diagram"))}" loading="lazy"></figure>'
                if q.get("image") else "")
    if "parts" in q:
        parts = "".join(f'<li><div class="pq"><span class="pq-text">{p["q"]}</span><span class="marks">[{p["marks"]:g}]</span></div>{sol(p.get("solution"), "Solution")}</li>'
                        for p in q["parts"])
        lead = f'<p class="pq-lead">{q["q"]}</p>' if q.get("q") else ""
        inner = f'{lead}{fig(q)}<ol class="parts" type="a">{parts}</ol>'
    elif "options" in q:
        opts = "".join(f'<li><button class="option" type="button" aria-pressed="false"><span class="letter" aria-hidden="true">{"abcdef"[j]}</span><span class="opt-text">{esc(o)}</span></button></li>'
                       for j, o in enumerate(q["options"]))
        answer_txt = f'({"abcdef"[q["answer"]]}) {esc(q["options"][q["answer"]])}'
        key_id = f"{slug}:{num}{'or' if is_or else ''}"
        key = scramble(key_id, {"a": q["answer"], "s": f"<p><strong>Answer: {answer_txt}</strong></p>" + q.get("solution", "")})
        inner = (f'<p class="pq-text">{q["q"]}</p>{fig(q)}<ol class="options" type="a">{opts}</ol>'
                 f'<details class="solution"><summary>Answer</summary><div data-fill></div></details>')
        return (f'<li class="pq-item mcq" data-id="{key_id}" data-k="{key}"><span class="pq-num">{label}</span><div class="pq-body">{inner}</div></li>')
    else:
        inner = f'<div class="pq"><span class="pq-text">{q["q"]}</span><span class="marks">[{q["marks"]:g}]</span></div>{fig(q)}{sol(q.get("solution"), "Solution")}'
    return f'<li class="pq-item"><span class="pq-num">{label}</span><div class="pq-body">{inner}</div></li>'


def paper_body_json(paper, slug=""):
    out, num = [], 0
    for g in paper["groups"]:
        items = []
        for q in g["questions"]:
            num += 1
            items.append(paper_question_html(q, num, slug=slug))
            if q.get("or"):
                items.append(f'<li class="or-divider" aria-hidden="true"><span>OR</span></li>{paper_question_html(q["or"], num, True, slug)}')
        head = f'<h2 id="{slugify(g["title"])}">{esc(g["title"])}{": " + esc(g["subtitle"]) if g.get("subtitle") else ""}'
        head += f' <span class="group-marks">[{esc(g["marks"])}]</span></h2>' if g.get("marks") else "</h2>"
        instr = f'<p class="instructions">{esc(g["instructions"])}</p>' if g.get("instructions") else ""
        out.append(f'<section class="paper-group">{head}{instr}<ol class="paper-qs">{"".join(items)}</ol></section>')
    return "\n".join(out)


def paper_minutes(paper):
    t = str(paper.get("time", "")).lower()
    h = re.search(r"(\d+(?:\.\d+)?)\s*h", t)
    m = re.search(r"(\d+)\s*m", t)
    total = (float(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0)
    return int(total) or 180


def build_paper(data, papers, paper):
    others = [p for p in papers if p is not paper and p["grade"] == paper["grade"]]
    facts = []
    if paper.get("time"):
        facts.append(f"Time: {paper['time']}")
    if paper.get("full_marks"):
        facts.append(f"Full marks: {paper['full_marks']:g}")
    if paper.get("pass_marks"):
        facts.append(f"Pass marks: {paper['pass_marks']:g}")
    if paper.get("marks"):
        facts.append(str(paper["marks"]))
    lead = f'<p class="lead">{esc(paper["description"])}</p>' if paper.get("description") else ""
    more = (f'<section class="related"><h2>More Grade {paper["grade"]} papers</h2><div class="grid">'
            f'{"".join(card(data, p) for p in others)}</div></section>') if others else ""
    content = paper_body_json(paper, paper["slug"]) if paper["format"] == "json" else paper["body"].strip()
    report = data["settings"].get("features", {}).get("reports", True)
    body = f"""{crumbs_html(paper_trail(paper))}
<header class="lesson-head">
  <div class="tags"><span class="badge paper">{icon('file')}Model paper</span><span class="badge">Grade {paper['grade']}</span><span class="badge">{esc(str(paper['year']))}</span></div>
  <h1>{esc(paper['title'])}</h1>
  {lead}
  <ul class="paper-facts">{''.join(f'<li>{esc(f)}</li>' for f in facts)}</ul>
  {page_tools(report)}
</header>
<div class="exam-bar" data-minutes="{paper_minutes(paper)}">
  <div><strong>Exam mode</strong><span class="exam-help">Hide every answer and start a {paper_minutes(paper)}-minute timer, like the real exam.</span></div>
  <span class="exam-timer" hidden aria-live="off"></span>
  <button type="button" class="btn" data-exam="start">{icon('clock')} Start timed attempt</button>
  <button type="button" class="btn btn-ghost" data-exam="stop" hidden>Finish &amp; show answers</button>
  <button type="button" class="btn btn-ghost" data-exam="toggle">Show all answers</button>
</div>
<div class="lesson no-toc">
<article class="notes-body paper-body" data-math>
{content}
</article>
</div>
{ad_slot(data, 'end_of_content')}
{more}"""
    desc = paper.get("description") or f"{paper['title']}: Grade {paper['grade']} physics model question paper ({data['site']['curriculum']}) with solutions."
    ld = article_ld(data, {**paper, "chapters": []}, "Quiz", {"learningResourceType": "Model question paper",
                                                               "timeRequired": f"PT{paper_minutes(paper)}M"})
    ld.pop("headline", None)
    return shell(data, title=paper["title"], body=body, description=desc, path=paper["url"], current="papers", css=("lesson",),
                 scripts=("unlock", "paper", "math"), track={"kind": "paper", "grade": paper["grade"]}, og_type="article",
                 modified=paper["date"], ld=(ld, breadcrumb_ld(data, paper_trail(paper))))


def build_papers_page(data, papers):
    sections = []
    for g, grade in data["grades"].items():
        mine = [p for p in papers if p["grade"] == g]
        cards = "".join(card(data, p) for p in mine) or '<p class="empty">Model papers for this grade are coming soon.</p>'
        sections.append(f'<section class="section" id="grade-{g.lower()}"><div class="section-head"><h2>{esc(grade["title"])}</h2></div>'
                        f'<div class="grid">{cards}</div></section>')
    trail = [("Home", "/"), ("Model Questions", None)]
    body = f"""{crumbs_html(trail)}
<section class="hero hero-sm kind-paper">
  <h1>Model Questions</h1>
  <p>Full model question papers for Grade XI and XII ({esc(data['site']['curriculum'])}), set to the NEB exam pattern. Try a paper in exam mode with the timer, then open the solutions.</p>
  <div class="stats"><div><b>{len(papers)}</b><span>papers</span></div>{''.join(f'<div><b>{sum(p["grade"] == g for p in papers)}</b><span>Grade {g}</span></div>' for g in data['grades'])}</div>
</section>
{''.join(sections)}
{ad_slot(data, 'list')}"""
    return shell(data, title="Model Questions", body=body, path=PAPERS_URL, current="papers",
                 description="Grade XI and XII physics model question papers (NEB pattern) with full solutions and a timed exam mode.",
                 ld=(breadcrumb_ld(data, trail),))


# ---------------------------------------------------------------- labs

def lab_trail(data, lab):
    return [("Home", "/"), ("Lab practicals", LABS_URL), (f"Grade {lab['grade']}", f"{LABS_URL}#grade-{lab['grade'].lower()}"), (lab["title"], None)]


def build_lab(data, labs, lab, posts):
    def ul(items, ordered=False):
        tag = "ol" if ordered else "ul"
        return f"<{tag}>{''.join(f'<li>{x}</li>' for x in items)}</{tag}>"

    sections = []

    def sec(sid, title, ico, inner):
        if inner:
            sections.append((sid, title, f'<section class="lab-sec" id="{sid}"><h2>{icon(ico)}{esc(title)}</h2>{inner}</section>'))

    sec("aim", "Aim", "target", f"<p>{lab['aim']}</p>" if not lab["aim"].lstrip().startswith("<") else lab["aim"])
    sec("apparatus", "Apparatus required", "tool", ul(lab["apparatus"]))
    diagram = ""
    if lab.get("diagram"):
        d = lab["diagram"]
        cap = f"<figcaption>{esc(d['caption'])}</figcaption>" if d.get("caption") else ""
        diagram = f'<figure><img src="{esc(d["src"])}" alt="{esc(d["alt"])}" loading="lazy">{cap}</figure>'
    sec("theory", "Theory", "book", (lab.get("theory") or "") + diagram)
    sec("procedure", "Procedure", "list", ul(lab["procedure"], ordered=True))
    tables = []
    for t in lab.get("observations") or []:
        cap = f"<caption>{esc(t['caption'])}</caption>" if t.get("caption") else ""
        head = "".join(f"<th scope=\"col\">{esc(str(h))}</th>" for h in t["headers"])
        rows = "".join("<tr>" + "".join(f"<td>{esc(str(c))}</td>" for c in r) + "</tr>" for r in t["rows"])
        note = f'<p class="table-note">{esc(t["note"])}</p>' if t.get("note") else ""
        tables.append(f'<div class="table-wrap"><table>{cap}<thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>{note}')
    sec("observations", "Observations", "table", "".join(tables))
    sec("calculation", "Calculation", "calc", lab.get("calculation", ""))
    sec("result", "Result", "check", f'<div class="box tip" data-title="Result">{lab["result"]}</div>' if lab.get("result") else "")
    sec("conclusion", "Conclusion", "check", lab.get("conclusion", ""))
    sec("precautions", "Precautions", "shield", ul(lab["precautions"]) if lab.get("precautions") else "")
    sec("errors", "Sources of error", "alert", ul(lab["errors"]) if lab.get("errors") else "")
    if lab.get("viva"):
        viva = "".join(f'<details class="solution viva"><summary>{esc(v["q"])}</summary><div>{v["a"]}</div></details>' for v in lab["viva"])
        sec("viva", "Viva voce questions", "chat", viva)

    toc = toc_nav([(sid, t) for sid, t, _ in sections])
    blocks = [s for _, _, s in sections]
    if ads_on(data) and len(blocks) > 4:
        blocks.insert(4, ad_slot(data, "in_article"))
    number = f'<span class="badge">Experiment {lab["number"]}</span>' if lab.get("number") else ""
    rel_lessons = [p for p in posts if p["grade"] == lab["grade"] and set(p["chapters"]) & set(lab.get("chapters", []))]
    rel_html = (f'<section class="related"><h2>Study the theory</h2><div class="grid">{"".join(card(data, p) for p in rel_lessons)}</div></section>'
                if rel_lessons else "")
    others = [p for p in labs if p is not lab and p["grade"] == lab["grade"]][:6]
    more = (f'<section class="related"><h2>More Grade {lab["grade"]} practicals</h2><div class="grid">{"".join(card(data, p) for p in others)}</div></section>'
            if others else "")
    report = data["settings"].get("features", {}).get("reports", True)
    lead = f'<p class="lead">{esc(lab["description"])}</p>' if lab.get("description") else ""
    chaps = ", ".join(f"Ch. {c['n']} {c['title']}" for c in chapter_of(data, lab))
    body = f"""{crumbs_html(lab_trail(data, lab))}
<header class="lesson-head">
  <div class="tags"><span class="badge lab">{icon('flask')}Lab practical</span><span class="badge">Grade {lab['grade']}</span>{number}</div>
  <h1>{esc(lab['title'])}</h1>
  {lead}
  <p class="meta">{esc(' · '.join(b for b in (chaps, 'Updated ' + lab['date']) if b))}</p>
  {page_tools(report)}
</header>
<div class="lesson{'' if toc else ' no-toc'}">
<article class="notes-body lab-body" data-math>
{''.join(blocks)}
</article>
{f'<aside class="lesson-side">{toc}</aside>' if toc else ''}
</div>
{video_block(lab.get('video'))}
{ad_slot(data, 'end_of_content')}
{rel_html}{more}"""
    desc = lab.get("description") or f"{lab['title']}: Grade {lab['grade']} physics practical with aim, apparatus, theory, procedure, observations, result and viva questions."
    ld = article_ld(data, lab, "Article", {"learningResourceType": "Lab practical"})
    return shell(data, title=lab["title"], body=body, description=desc, path=lab["url"], current="labs", css=("lesson",),
                 scripts=("notes", "math"), track={"kind": "lab", "grade": lab["grade"]}, og_type="article",
                 modified=lab["date"], ld=(ld, breadcrumb_ld(data, lab_trail(data, lab))), body_class="reading")


def build_labs_page(data, labs):
    sections = []
    for g, grade in data["grades"].items():
        mine = [p for p in labs if p["grade"] == g]
        cards = "".join(card(data, p) for p in mine) or '<p class="empty">Practicals for this grade are coming soon.</p>'
        sections.append(f'<section class="section" id="grade-{g.lower()}"><div class="section-head"><h2>{esc(grade["title"])} practicals</h2></div>'
                        f'<div class="grid">{cards}</div></section>')
    trail = [("Home", "/"), ("Lab practicals", None)]
    body = f"""{crumbs_html(trail)}
<section class="hero hero-sm kind-lab">
  <h1>Lab practicals</h1>
  <p>Every NEB physics practical written up the way your lab copy needs it: aim, apparatus, theory, diagram, procedure, observation table, calculation, result, precautions and viva questions. Print any practical as a clean lab sheet.</p>
  <div class="stats"><div><b>{len(labs)}</b><span>practicals</span></div>{''.join(f'<div><b>{sum(p["grade"] == g for p in labs)}</b><span>Grade {g}</span></div>' for g in data['grades'])}</div>
</section>
{''.join(sections)}
{ad_slot(data, 'list')}"""
    return shell(data, title="Lab practicals", body=body, path=LABS_URL, current="labs", ld=(breadcrumb_ld(data, trail),),
                 description="Grade XI and XII physics lab practicals (NEB): aim, theory, procedure, observation tables, results and viva questions.")


# ---------------------------------------------------------------- site pages

AREA_ICON = {"Mechanics": "gear", "Heat & Thermodynamics": "flame", "Waves & Optics": "wave",
             "Electricity & Magnetism": "bolt", "Modern Physics": "atom"}

FAQ = [
    ("Is Physics Decoded free?", "Yes. Every note, MCQ set, model paper and lab practical is free to read, with no sign-up."),
    ("Which syllabus does it follow?", "The NEB Grade XI and XII physics curriculum (2076), chapter by chapter."),
    ("Does it save my progress?", "Yes, on your own device. Quiz answers and scores are stored in your browser, so you can close the page and continue later. Nothing is sent to us."),
    ("Can I use it offline?", "Pages you have opened once are saved on your phone and open without internet. You can also add the site to your home screen."),
    ("I found a mistake. What should I do?", "Press “Report a mistake” on the page. Every report is read and the page is corrected."),
]


def plural(n, word):
    return word if n == 1 else word + "s"


def hero_sample(posts):
    """A real easy question from the newest MCQ set, shown answered beside the home headline (desktop only)."""
    for p in posts:
        if p["kind"] != "mcq":
            continue
        for i, q in enumerate(p["questions"]):
            if q.get("difficulty") == "easy" and q.get("explanation") and len(q["q"]) < 140 and all(len(o) < 60 for o in q["options"]):
                options, answer = shuffled_options(p, i, q)
                lis = "".join(f'<li class="{"ok" if j == answer else ""}"><b>{"ABCDEF"[j]}</b>{esc(o)}</li>' for j, o in enumerate(options))
                return (f'<div class="hero-art" aria-hidden="true"><span class="badge mcq">{esc(p["title"].split(" — ")[0])}</span>'
                        f'<p class="q">{esc(q["q"])}</p><ol>{lis}</ol><p class="exp"><strong>✓ Correct.</strong> {esc(q["explanation"][:150])}{"…" if len(q["explanation"]) > 150 else ""}</p></div>')
    return ""


def build_index(data, posts, papers, labs):
    site = data["site"]
    n_notes = sum(p["kind"] == "notes" for p in posts)
    n_questions = sum(len(p.get("questions", [])) for p in posts)
    grade_cards = []
    for g, grade in data["grades"].items():
        gp = [p for p in posts if p["grade"] == g]
        covered = len({n for p in gp for n in p["chapters"]})
        total = len(grade["syllabus"])
        grade_cards.append(f"""<a class="card grade-card" href="{GRADE_URL[g]}">
  <span class="grade-num">{g}</span>
  <h3>{esc(grade['title'])}</h3>
  <p>{total} chapters · {covered} with lessons</p>
  <span class="meter" role="img" aria-label="{covered} of {total} chapters have lessons"><span style="width:{round(100 * covered / total)}%"></span></span>
  <div class="chips"><span class="chip notes">{sum(p['kind'] == 'notes' for p in gp)} notes</span><span class="chip mcq">{sum(p['kind'] == 'mcq' for p in gp)} MCQ sets</span></div>
</a>""")
    areas = []
    for area, ico in AREA_ICON.items():
        n = sum(1 for p in posts if any(c["area"] == area for c in chapter_of(data, p)))
        areas.append(f'<a class="area-tile" href="{SEARCH_URL}?area={area.replace(" ", "+").replace("&", "%26")}">{icon(ico)}<span>{esc(area)}</span><small>{n} lessons</small></a>')
    faq_html = "".join(f'<details class="faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in FAQ)
    body = f"""<section class="hero home-hero">
  <div class="hero-text">
    <p class="eyebrow">Grade XI &amp; XII · {esc(site['curriculum'])}</p>
    <h1>Physics, decoded for your board exam.</h1>
    <p>{esc(site['tagline'])}</p>
    <form class="hero-search" action="{SEARCH_URL}" role="search">
      <label class="sr-only" for="hero-q">Search topics</label>
      <input id="hero-q" type="search" name="q" placeholder="Search a topic, e.g. “surface tension”" autocomplete="off">
      <button class="btn">{icon('search')}<span class="label">Search</span></button>
    </form>
    <div class="stats"><div><b>{n_notes}</b><span>note sets</span></div><div><b>{len(posts) - n_notes}</b><span>MCQ sets</span></div><div><b>{n_questions:,}</b><span>practice questions</span></div><div><b>{len(papers)}</b><span>{plural(len(papers), 'model paper')}</span></div></div>
  </div>
  {hero_sample(posts)}
</section>
<section class="section continue" id="continue" hidden aria-labelledby="continue-h"><div class="section-head"><h2 id="continue-h">Continue where you left off</h2></div><div class="grid" data-continue></div></section>
<section class="section" aria-labelledby="grades-h">
  <div class="section-head"><h2 id="grades-h">Choose your grade</h2></div>
  <div class="grade-cards">{''.join(grade_cards)}</div>
</section>
<section class="section" aria-labelledby="tools-h">
  <div class="section-head"><h2 id="tools-h">Exam preparation</h2></div>
  <div class="feature-cards">
    <a class="card feature kind-paper" href="{PAPERS_URL}"><span class="kind-ico">{icon('file')}</span><h3>Model Questions</h3><p>{len(papers)} full NEB-pattern papers with solutions and a timed exam mode.</p></a>
    <a class="card feature kind-lab" href="{LABS_URL}"><span class="kind-ico">{icon('flask')}</span><h3>Lab practicals</h3><p>{len(labs)} practicals with theory, tables, results and viva questions. Print-ready.</p></a>
    <a class="card feature kind-mcq" href="{SEARCH_URL}?kind=mcq"><span class="kind-ico">{icon('check')}</span><h3>MCQ practice</h3><p>{n_questions:,} questions with explanations. Practice or timed test mode.</p></a>
  </div>
</section>
<section class="section" aria-labelledby="areas-h">
  <div class="section-head"><h2 id="areas-h">Browse by topic area</h2></div>
  <div class="area-tiles">{''.join(areas)}</div>
</section>
{ad_slot(data, 'list')}
<section class="section" aria-labelledby="new-h">
  <div class="section-head"><h2 id="new-h">Recently added</h2><a href="{SEARCH_URL}?sort=new">Browse all →</a></div>
  <div class="grid">{''.join(card(data, p) for p in posts[:6])}</div>
</section>
<section class="section yt-cta">
  <div><h2>Learn it on video too</h2><p>Every chapter is explained step by step on the YouTube channel.</p></div>
  <a class="btn btn-yt" href="{site['youtube']}" target="_blank" rel="noopener">{icon('play')} Watch on YouTube</a>
</section>
<section class="section" aria-labelledby="faq-h">
  <div class="section-head"><h2 id="faq-h">Questions students ask</h2></div>
  <div class="faqs">{faq_html}</div>
</section>"""
    ld = [
        {"@type": "WebSite", "name": site["name"], "url": site["url"] + "/", "inLanguage": "en",
         "potentialAction": {"@type": "SearchAction", "target": {"@type": "EntryPoint", "urlTemplate": site["url"] + SEARCH_URL + "?q={search_term_string}"},
                             "query-input": "required name=search_term_string"}},
        {**publisher(data), "sameAs": [site["youtube"]]},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]},
    ]
    return shell(data, title=site["name"], body=body, path="/", current="home", ld=ld, scripts=("home",),
                 description=f"Free Grade XI and XII physics notes, {n_questions:,} MCQs with explanations, NEB model questions and lab practicals ({site['curriculum']}).")


def build_grade(data, posts, papers, labs, g):
    site, grade = data["site"], data["grades"][g]
    gp = [p for p in posts if p["grade"] == g]
    gl = [p for p in labs if p["grade"] == g]
    areas = "".join(f'<a href="#{slugify(a)}">{icon(AREA_ICON.get(a, "layers"))}{esc(a)}</a>' for a in dict.fromkeys(c["area"] for c in grade["syllabus"]))
    out, area = [], None
    for ch in grade["syllabus"]:
        if ch["area"] != area:
            area = ch["area"]
            out.append(f'<h2 class="area" id="{slugify(area)}">{icon(AREA_ICON.get(area, "layers"))}{esc(area)}</h2>')
        mine = sorted((p for p in gp if ch["n"] in p["chapters"]), key=lambda p: (p["kind"] != "notes", p["title"]))
        mine_labs = [p for p in gl if ch["n"] in p.get("chapters", [])]
        counts = "".join(f'<span class="badge {k}">{sum(p["kind"] == k for p in mine)} {KIND_LABEL[k]}</span>'
                         for k in ("notes", "mcq") if any(p["kind"] == k for p in mine))
        links = "".join(f'<a class="chip {p["kind"]}" href="{p["url"]}" data-slug="{p["slug"]}">{icon(KIND_ICON[p["kind"]])}{esc(p["title"])}</a>' for p in mine + mine_labs)
        if not mine:
            links = '<span class="chip soon">Notes &amp; MCQs coming soon</span>' + links
        links += f'<a class="chip video" href="{site["youtube"]}" target="_blank" rel="noopener">{icon("play")}Videos</a>'
        topics = "".join(f"<li>{t}</li>" for t in ch["topics"])
        out.append(f"""<details class="chapter" id="ch-{ch['n']}"{' open' if mine else ''}>
  <summary><span class="num">{ch['n']}</span><span class="ch-title">{esc(ch['title'])}</span><span class="counts">{counts}</span></summary>
  <div class="chapter-body"><ul class="topics">{topics}</ul><div class="chapter-links">{links}</div></div>
</details>""")
        if ch["n"] == 8 and ads_on(data):
            out.append(ad_slot(data, "list"))
    trail = [("Home", "/"), (grade["title"], None)]
    body = f"""{crumbs_html(trail)}
<section class="hero hero-sm">
  <h1>{esc(grade['title'])}</h1>
  <p>The complete {esc(site['curriculum'])} syllabus. Open a chapter for its topics, notes, MCQ practice and practicals. Your quiz scores appear next to each set.</p>
  <div class="stats"><div><b>{len(grade['syllabus'])}</b><span>chapters</span></div><div><b>{grade['hours']}</b><span>teaching hours</span></div><div><b>{len(gp)}</b><span>lessons</span></div><div><b>{len(gl)}</b><span>practicals</span></div></div>
</section>
<nav class="filters jump" aria-label="Jump to a topic area">{areas}<a href="{PAPERS_URL}#grade-{g.lower()}">{icon('file')}Model papers</a><a href="{LABS_URL}#grade-{g.lower()}">{icon('flask')}Practicals</a></nav>
<div class="chapters">{''.join(out)}</div>"""
    return shell(data, title=grade["title"], body=body, path=GRADE_URL[g], current=g, track={"grade": g}, ld=(breadcrumb_ld(data, trail),
                 {"@type": "CollectionPage", "name": grade["title"], "url": site["url"] + GRADE_URL[g]}),
                 description=f"{grade['title']}: the full NEB syllabus with free notes, MCQ practice and practicals for every chapter.")


def build_search(data):
    areas = dict.fromkeys(c["area"] for g in data["grades"].values() for c in g["syllabus"])
    trail = [("Home", "/"), ("All lessons", None)]
    body = f"""{crumbs_html(trail)}
<h1>All lessons</h1>
<form id="search-form" class="search-box" role="search">
  <label class="sr-only" for="q">Search topics</label>
  <input id="q" type="search" placeholder="Search topics…" autocomplete="off">
  <button class="btn">{icon('search')} Search</button>
</form>
<div id="filters" class="filter-groups">
  <div class="filters" role="group" aria-label="Type" data-group="kind">
    <button type="button" data-value="all">All types</button><button type="button" data-value="notes">Notes</button><button type="button" data-value="mcq">MCQs</button><button type="button" data-value="paper">Model papers</button><button type="button" data-value="lab">Labs</button>
  </div>
  <div class="filters" role="group" aria-label="Grade" data-group="grade">
    <button type="button" data-value="all">Both grades</button><button type="button" data-value="XI">Grade XI</button><button type="button" data-value="XII">Grade XII</button>
  </div>
  <div class="filters" role="group" aria-label="Topic area" data-group="area">
    <button type="button" data-value="all">All topics</button>{''.join(f'<button type="button" data-value="{esc(a)}">{esc(a)}</button>' for a in areas)}
  </div>
  <label class="sort">Sort <select id="sort"><option value="syllabus">Syllabus order</option><option value="new">Newest first</option><option value="az">A–Z</option></select></label>
</div>
<p id="count" class="count" aria-live="polite"></p>
<h2 class="sr-only">Results</h2>
<div id="results" class="grid"></div>
<template id="card-icons">{''.join(f'<span data-kind="{k}">{icon(v)}</span>' for k, v in KIND_ICON.items())}</template>"""
    return shell(data, title="All lessons", body=body, path=SEARCH_URL, current="search", scripts=("search",),
                 description="Search every Grade XI and XII physics note, MCQ set, model paper and lab practical.", ld=(breadcrumb_ld(data, trail),))


def contact_form():
    return f"""<form class="contact-form" data-contact>
  <div class="field"><label for="c-name">Your name</label><input id="c-name" name="name" required maxlength="80" autocomplete="name"></div>
  <div class="field"><label for="c-email">Email <span class="muted">(so we can reply; optional)</span></label><input id="c-email" name="email" type="email" maxlength="120" autocomplete="email"></div>
  <div class="field"><label for="c-msg">Message</label><textarea id="c-msg" name="message" required minlength="10" maxlength="3000" rows="6"></textarea></div>
  <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button class="btn">{icon('send')} Send message</button>
  <p class="form-status" role="status" aria-live="polite"></p>
</form>"""


def build_page(data, page):
    trail = [("Home", "/"), (page["title"], None)]
    extra = ""
    if page["slug"] == "contact" and data["settings"].get("features", {}).get("contact_form", True):
        extra = contact_form()
    site = data["site"]
    email = f'<p>Email: <a href="mailto:{esc(site["email"])}">{esc(site["email"])}</a></p>' if page["slug"] == "contact" and site.get("email") else ""
    body = f"""{crumbs_html(trail)}
<header class="lesson-head"><h1>{esc(page['title'])}</h1>{f'<p class="lead">{esc(page["description"])}</p>' if page.get("description") else ''}
{f'<p class="meta">Last updated {page["date"]}</p>' if page.get("date") else ''}</header>
<div class="lesson no-toc"><article class="notes-body page-body">
{page['body'].strip()}
{email}{extra}
</article></div>"""
    page_type = {"about": "AboutPage", "contact": "ContactPage"}.get(page["slug"], "WebPage")
    return shell(data, title=page["title"], body=body, description=page.get("description"), path=page["url"], ads=False, css=("lesson",),
                 ld=({"@type": page_type, "name": page["title"], "url": site["url"] + page["url"]}, breadcrumb_ld(data, trail)))


def build_404(data):
    body = f"""<section class="hero hero-sm"><h1>Page not found</h1><p>That page has moved or never existed. Search for the topic instead, or pick your grade below.</p>
<form class="hero-search" action="{SEARCH_URL}" role="search"><label class="sr-only" for="nf-q">Search topics</label><input id="nf-q" type="search" name="q" placeholder="Search topics…"><button class="btn">{icon('search')} Search</button></form></section>
<div class="feature-cards"><a class="card feature" href="{GRADE_URL['XI']}"><h3>Grade XI</h3><p>All chapters</p></a><a class="card feature" href="{GRADE_URL['XII']}"><h3>Grade XII</h3><p>All chapters</p></a><a class="card feature" href="{PAPERS_URL}"><h3>Model Questions</h3><p>Full papers</p></a></div>"""
    return shell(data, title="Page not found", body=body, path="/404", noindex=True, ads=False)


def build_offline(data):
    body = """<section class="hero hero-sm"><h1>You're offline</h1><p>This page hasn't been saved on this device yet. These pages are saved and open without internet:</p></section>
<div class="grid" data-offline-list><p class="empty">Looking for saved pages…</p></div>"""
    return shell(data, title="Offline", body=body, path="/offline", noindex=True, ads=False, scripts=("offline",))


def build_search_index(data, posts, papers, labs):
    items = []
    for p in posts:
        chaps = chapter_of(data, p)
        words = [p["title"], p.get("description", ""), p["kind"], "notes" if p["kind"] == "notes" else "mcq mcqs questions practice quiz",
                 f"grade {p['grade']}", p["slug"].replace("-", " ")]
        for c in chaps:
            words += [c["title"], c["area"], *[plain(t) for t in c["topics"]]]
        items.append({"title": p["title"], "url": p["url"], "slug": p["slug"], "kind": p["kind"], "grade": p["grade"],
                      "chapter": ", ".join(c["title"] for c in chaps), "date": p["date"],
                      "area": chaps[0]["area"], "order": min(p["chapters"]),
                      "count": len(p.get("questions", [])) or None,
                      "haystack": re.sub(r"[^a-z0-9 ]+", " ", " ".join(words).lower())})
    for p in papers:
        words = [p["title"], p.get("description", ""), "model question paper papers exam", f"grade {p['grade']}", str(p["year"])]
        items.append({"title": p["title"], "url": p["url"], "slug": p["slug"], "kind": "paper", "grade": p["grade"],
                      "chapter": f"Model paper {p['year']}", "date": p["date"], "area": "", "order": 999,
                      "haystack": re.sub(r"[^a-z0-9 ]+", " ", " ".join(words).lower())})
    for p in labs:
        chaps = chapter_of(data, p)
        words = [p["title"], p.get("description", ""), "lab practical experiment", f"grade {p['grade']}", plain(p["aim"])]
        for c in chaps:
            words += [c["title"], c["area"]]
        items.append({"title": p["title"], "url": p["url"], "slug": p["slug"], "kind": "lab", "grade": p["grade"],
                      "chapter": ", ".join(c["title"] for c in chaps) or "Practical", "date": p["date"],
                      "area": chaps[0]["area"] if chaps else "", "order": min(p["chapters"]) if p.get("chapters") else 500,
                      "haystack": re.sub(r"[^a-z0-9 ]+", " ", " ".join(words).lower())})
    items.sort(key=lambda x: (x["grade"] != "XI", x["title"]))
    return json.dumps([{k: v for k, v in x.items() if v is not None} for x in items], ensure_ascii=False, separators=(",", ":")) + "\n"


def build_syllabus_json(data):
    """Public syllabus (used by the admin editors and anyone who wants it)."""
    return json.dumps({"curriculum": data["site"]["curriculum"], "grades": {
        g: {"title": gr["title"], "chapters": [{"n": c["n"], "title": c["title"], "area": c["area"]} for c in gr["syllabus"]]}
        for g, gr in data["grades"].items()}}, ensure_ascii=False, indent=1) + "\n"


def all_pages(posts, papers, labs, pages):
    rows = [("/", None), (SEARCH_URL, None), *[(u, None) for u in GRADE_URL.values()], (PAPERS_URL, None), (LABS_URL, None)]
    rows += [(p["url"], p["date"]) for p in papers] + [(p["url"], p["date"]) for p in labs] + [(p["url"], p["date"]) for p in posts]
    rows += [(p["url"], p.get("date")) for p in pages]
    return rows


def build_sitemap(data, posts, papers, labs, pages):
    site = data["site"]
    newest = max((p["date"] for p in posts + papers + labs), default=None)
    urls = "".join(f"  <url><loc>{site['url']}{'/' if u == '/' else u}</loc>{f'<lastmod>{d or newest}</lastmod>' if (d or newest) else ''}</url>\n"
                   for u, d in all_pages(posts, papers, labs, pages))
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n'


def build_feed(data, posts, papers, labs):
    site = data["site"]
    items = sorted(posts + papers + labs, key=lambda p: (p["date"], p["slug"]), reverse=True)[:40]

    def rfc822(d):
        return datetime.fromisoformat(d).replace(tzinfo=timezone.utc).strftime("%a, %d %b %Y 00:00:00 +0000")

    rows = "".join(f"""  <item><title>{esc(p['title'])}</title><link>{site['url']}{p['url']}</link><guid>{site['url']}{p['url']}</guid>
    <pubDate>{rfc822(p['date'])}</pubDate><category>{KIND_LABEL[p['kind']]}</category><description>{esc(p.get('description') or p['title'])}</description></item>
""" for p in items)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
  <title>{esc(site['name'])}</title><link>{site['url']}/</link><description>{esc(site['tagline'])}</description><language>en</language>
  <atom:link href="{site['url']}/feed.xml" rel="self" type="application/rss+xml"/>
{rows}</channel></rss>
"""


# Crawlers that collect pages to train AI models. Search engines (Googlebot, Bingbot) and the AdSense
# crawler (Mediapartners-Google) stay allowed.
AI_CRAWLERS = ["GPTBot", "ChatGPT-User", "CCBot", "Google-Extended", "anthropic-ai", "ClaudeBot", "Claude-Web",
               "PerplexityBot", "Bytespider", "Amazonbot", "Applebot-Extended", "meta-externalagent", "cohere-ai", "Diffbot",
               "ImagesiftBot", "Timpibot", "omgili", "Omgilibot", "img2dataset", "FacebookBot", "YouBot"]


def build_robots(data):
    blocked = "".join(f"User-agent: {bot}\nDisallow: /\n\n" for bot in AI_CRAWLERS)
    return f"{blocked}User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: {data['site']['url']}/sitemap.xml\n"


def build_ads_txt(data):
    client = data["settings"].get("ads", {}).get("adsense_client", "")
    if not client:
        return "# Add the AdSense publisher ID to src/settings.json (ads.adsense_client) to fill this file.\n"
    pub = client.replace("ca-", "")
    return f"google.com, {pub}, DIRECT, f08c47fec0942fa0\n"


def build_ads_config(data):
    a = data["settings"].get("ads", {})
    return json.dumps({"client": a.get("adsense_client", ""), "auto": bool(a.get("auto_ads")), "slots": a.get("slots", {}),
                       "house": [h for h in a.get("house_ads", []) if h.get("url") and h.get("title")]}, ensure_ascii=False) + "\n"


def csp(data):
    """With ads on, AdSense loads scripts and frames from Google domains that change over time, and Google
    only supports a nonce-based CSP, which a static site cannot do. So script/frame sources are only
    locked down while ads are off (see docs/REDESIGN_PLAN.md#security)."""
    common = "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests"
    if ads_on(data):
        return f"default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data:; frame-src https:; connect-src 'self' https:; {common}"
    return ("default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: https://i.ytimg.com; "
            "frame-src https://www.youtube-nocookie.com; connect-src 'self' https://cloudflareinsights.com https://cdn.jsdelivr.net; " + common)


def build_headers(data):
    return f"""# Generated by build.py. Cloudflare applies these to every static file.
/*
  Content-Security-Policy: {csp(data)}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin-allow-popups

/assets/*
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/assets/css/*
  Cache-Control: public, max-age=31536000, immutable

/assets/js/*
  Cache-Control: public, max-age=31536000, immutable

/assets/icons.svg
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache

/admin/*
  X-Robots-Tag: noindex, nofollow
"""


def build_redirects(data, posts, papers, labs, pages):
    """Old addresses keep working: the .html addresses of this site, and the Blogger-era URLs.
    Cloudflare allows 2,000 exact and 100 pattern redirects; this uses well under that."""
    lines = ["# Generated by build.py from the content. Old .html addresses -> clean addresses."]
    targets = [p["url"] for p in posts + papers + labs] + list(GRADE_URL.values()) + [PAPERS_URL]
    for u in targets:
        lines.append(f"{u}.html {u} 301")
    lines.append("/search.html /search 301")
    lines.append("/styleguide.html /styleguide 301")
    # Blogger: /p/grade-xi.html -> grade page; root copies /<slug>.html -> /posts/<slug>
    for g, u in GRADE_URL.items():
        lines.append(f"/p/{u.rsplit('/', 1)[1]}.html {u} 301")
    lines.append(f"/p/model-questions.html {PAPERS_URL} 301")
    for p in posts:
        lines.append(f"/{p['slug']}.html {p['url']} 301")
    lines += ["/posts/kinematics-grade-xi-notes.html /posts/kinematics 301",
              "/posts/kinematics-grade-xi-notes /posts/kinematics 301",
              "/posts/photon.html /posts/photons 301", "/posts/photon /posts/photons 301"]
    # Patterns (Blogger post URLs /YYYY/MM/<slug>.html, label pages, feeds)
    for year in range(2019, date.today().year + 1):
        lines.append(f"/{year}/:month/:slug /posts/:slug 301")
    lines += ["/search/label/:label /search?q=:label 301", "/feeds/* / 302", "/p/:page /pages/:page 301"]
    return "\n".join(lines) + "\n"


def build_manifest(data):
    site = data["site"]
    return json.dumps({
        "name": site["name"] + ": Grade XI & XII Physics", "short_name": site.get("short_name", site["name"]),
        "description": site["tagline"], "start_url": "/?source=pwa", "scope": "/", "display": "standalone",
        "background_color": "#f5f6fb", "theme_color": "#283593", "lang": "en", "categories": ["education"],
        "icons": [{"src": "/assets/img/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "/assets/img/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "/assets/img/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
                  {"src": "/assets/favicon.svg", "sizes": "any", "type": "image/svg+xml"}],
        "shortcuts": [{"name": "Grade XI", "url": GRADE_URL["XI"]}, {"name": "Grade XII", "url": GRADE_URL["XII"]},
                      {"name": "Model Questions", "url": PAPERS_URL}],
    }, ensure_ascii=False, indent=1) + "\n"


def build_sw(core):
    """The service worker: saves pages a student opens so they work offline. Its version is a hash of
    the core files, so a new build replaces the old cache."""
    version = hashlib.sha256("".join(core).encode()).hexdigest()[:10]
    template = (SRC / "assets" / "js" / "sw-template.js").read_text(encoding="utf-8")
    return template.replace("__VERSION__", version).replace("__CORE__", json.dumps(core))


def build_styleguide(data):
    """docs/examples/example-notes.html rendered like a real lesson, so the components can be previewed."""
    example = ROOT / "docs/examples/example-notes.html"
    problems = Problems()
    meta, body = parse_front_matter(example.read_text(encoding="utf-8"), "docs/examples/example-notes.html", problems)
    validate_meta(meta, "docs/examples/example-notes.html", data["grades"], problems)
    if problems:
        raise SystemExit("\n".join(problems))
    meta.update(slug="styleguide", kind="notes", body=body, file="docs/examples/example-notes.html", url="/styleguide")
    return build_notes(data, [], meta, path="/styleguide", noindex=True)


# ---------------------------------------------------------------- main

def write(rel, text):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def serve(port=8000):
    """Preview server with clean URLs (/posts/x serves posts/x.html), like Cloudflare."""
    import functools as ft
    import http.server

    class Handler(http.server.SimpleHTTPRequestHandler):
        def send_head(self):
            path = self.path.split("?", 1)[0].split("#", 1)[0]
            local = OUT / path.lstrip("/")
            if path != "/" and not local.exists() and (OUT / (path.lstrip("/") + ".html")).is_file():
                self.path = path + ".html" + (self.path[len(path):] if len(self.path) > len(path) else "")
            elif not local.exists() and not path.startswith("/api/"):
                self.send_response(404)
                body = (OUT / "404.html").read_bytes()
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return __import__("io").BytesIO(body)
            return super().send_head()

    print(f"Preview: http://localhost:{port}  (Ctrl+C to stop; /admin and /api need `npx wrangler dev`)")
    http.server.ThreadingHTTPServer(("", port), ft.partial(Handler, directory=str(OUT))).serve_forever()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    data, posts, papers, labs, pages, problems = load()
    if problems:
        print(f"WARNING: {len(problems)} problem(s); the files below were SKIPPED and are not on the site:")
        for p in problems:
            print("  -", p)
        if "--strict" in sys.argv or "--check" in sys.argv:
            sys.exit(1)
    if "--check" in sys.argv:
        print(f"OK: {len(posts)} lessons, {len(papers)} model papers, {len(labs)} labs and {len(pages)} pages are valid.")
        return

    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SRC / "assets", OUT / "assets", ignore=shutil.ignore_patterns("sw-template.js"))
    admin = ROOT / "admin"
    if admin.is_dir():
        shutil.copytree(admin, OUT / "admin")
        # Point the admin pages at the content-hashed site CSS/JS (those URLs are cached for a year).
        for page in (OUT / "admin").glob("*.html"):
            text = page.read_text(encoding="utf-8")
            text = re.sub(r'(href|src)="/assets/((?:css|js)/[a-z-]+\.(?:css|js))"', lambda m: f'{m.group(1)}="{asset(m.group(2))}"', text)
            page.write_text(text, encoding="utf-8", newline="\n")
    write("index.html", build_index(data, posts, papers, labs))
    write("search.html", build_search(data))
    write("404.html", build_404(data))
    write("offline.html", build_offline(data))
    write("styleguide.html", build_styleguide(data))
    write("sitemap.xml", build_sitemap(data, posts, papers, labs, pages))
    write("feed.xml", build_feed(data, posts, papers, labs))
    write("robots.txt", build_robots(data))
    write("ads.txt", build_ads_txt(data))
    write("_headers", build_headers(data))
    write("_redirects", build_redirects(data, posts, papers, labs, pages))
    write("manifest.webmanifest", build_manifest(data))
    write("assets/search-index.json", build_search_index(data, posts, papers, labs))
    write("assets/syllabus.json", build_syllabus_json(data))
    write("assets/ads-config.json", build_ads_config(data))
    write(out_path(PAPERS_URL), build_papers_page(data, papers))
    write(out_path(LABS_URL), build_labs_page(data, labs))
    for paper in papers:
        write(out_path(paper["url"]), build_paper(data, papers, paper))
    for lab in labs:
        write(out_path(lab["url"]), build_lab(data, labs, lab, posts))
    for g in GRADE_URL:
        write(out_path(GRADE_URL[g]), build_grade(data, posts, papers, labs, g))
    builders = {"mcq": build_mcq, "notes": build_notes}
    for post in posts:
        write(out_path(post["url"]), builders[post["format"]](data, posts, post))
    for page in pages:
        write(out_path(page["url"]), build_page(data, page))
    core = ["/", "/offline", asset("css/tokens.css"), asset("css/site.css"), asset("css/lesson.css"), asset("icons.svg"),
            *[asset(f"js/{s}.js") for s in ("theme", "site", "analytics", "math", "notes", "unlock", "quiz", "paper", "offline")],
            "/assets/favicon.svg", "/manifest.webmanifest"]
    write("sw.js", build_sw(core))
    formats = {f: sum(p["format"] == f for p in posts) for f in builders}
    print(f"Built {len(posts)} lessons into public/ ({formats['mcq']} MCQ sets, {formats['notes']} notes), "
          f"{len(papers)} {plural(len(papers), 'model paper')}, {len(labs)} {plural(len(labs), 'lab')} and {len(pages)} pages.")
    if "--serve" in sys.argv:
        serve(int(sys.argv[sys.argv.index("--serve") + 1]) if len(sys.argv) > sys.argv.index("--serve") + 1 and sys.argv[sys.argv.index("--serve") + 1].isdigit() else 8000)


if __name__ == "__main__":
    main()
