"""Build the Physics Decoded static site.

    python build.py          # regenerate every page
    python build.py --check  # only validate src/ (no files written)

Sources (edit these):
    src/content.json   site info, syllabus for each grade, list of lessons
    src/lessons/*.html one standalone HTML document per lesson (notes or MCQ)

Generated (never edit by hand, they are overwritten):
    index.html, search.html, 404.html, sitemap.xml,
    pages/grade-*.html, posts/*.html, assets/search-index.json

Only the Python standard library is used.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
GRADE_SLUG = {"XI": "grade-xi", "XII": "grade-xii"}
KIND_LABEL = {"notes": "Notes", "mcq": "MCQs"}

esc = html.escape


# ---------------------------------------------------------------- loading

def load():
    data = json.loads((SRC / "content.json").read_text(encoding="utf-8"))
    errors = []
    lesson_files = {p.stem for p in (SRC / "lessons").glob("*.html")}
    seen = set()
    for p in data["posts"]:
        slug = p["slug"]
        if slug in seen:
            errors.append(f"duplicate slug '{slug}' in content.json")
        seen.add(slug)
        if slug not in lesson_files:
            errors.append(f"'{slug}' is listed in content.json but src/lessons/{slug}.html is missing")
        if p["grade"] not in data["grades"]:
            errors.append(f"'{slug}': unknown grade '{p['grade']}'")
            continue
        if p["kind"] not in KIND_LABEL:
            errors.append(f"'{slug}': kind must be one of {list(KIND_LABEL)}")
        chapters = {c["n"] for c in data["grades"][p["grade"]]["syllabus"]}
        for n in p["chapters"]:
            if n not in chapters:
                errors.append(f"'{slug}': grade {p['grade']} has no chapter {n}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", p["date"]):
            errors.append(f"'{slug}': date must look like 2026-01-31")
    for orphan in sorted(lesson_files - seen):
        errors.append(f"src/lessons/{orphan}.html exists but is not listed in content.json")
    return data, errors


def chapter_of(data, post):
    syl = {c["n"]: c for c in data["grades"][post["grade"]]["syllabus"]}
    return [syl[n] for n in post["chapters"]]


def post_url(post):
    return f"/posts/{post['slug']}.html"


# ---------------------------------------------------------------- page shell

def shell(site, *, title, body, description=None, path="", current=None, scripts=""):
    full_title = f"{title} | {site['name']}" if title != site["name"] else site["name"]
    desc = description or site["tagline"]

    def nav(href, label, key):
        cur = ' aria-current="page"' if key == current else ""
        return f'<a href="{href}"{cur}>{label}</a>'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{site['url']}/{path}">
<meta property="og:title" content="{esc(full_title)}">
<meta property="og:description" content="{esc(desc)}">
<meta name="theme-color" content="#1a237e">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/site.css">
</head>
<body>
<header class="site-header">
  <nav class="nav" aria-label="Main">
    <a class="brand" href="/"><img src="/assets/favicon.svg" alt=""> {esc(site['name'])}</a>
    <div class="nav-links">
      {nav('/pages/grade-xi.html', 'Grade XI', 'XI')}{nav('/pages/grade-xii.html', 'Grade XII', 'XII')}{nav('/search.html', 'All lessons', 'search')}
    </div>
    <form class="nav-search" action="/search.html" role="search"><input name="q" placeholder="Search topics…" aria-label="Search topics"></form>
  </nav>
</header>
<main class="container">
{body}
</main>
{footer(site)}
{scripts}</body>
</html>
"""


def footer(site):
    return f"""<footer class="footer"><div class="footer-inner">
  <strong>{esc(site['name'])}</strong><span>by {esc(site['author'])} · {esc(site['curriculum'])}</span>
  <span class="spacer"></span>
  <a href="/pages/grade-xi.html">Grade XI</a><a href="/pages/grade-xii.html">Grade XII</a>
  <a href="{site['youtube']}" target="_blank" rel="noopener">YouTube ▶</a>
</div></footer>"""


def card(data, post):
    chaps = ", ".join(c["title"] for c in chapter_of(data, post))
    return f"""<article class="card kind-{post['kind']}">
  <div><span class="badge {post['kind']}">{'MCQ' if post['kind'] == 'mcq' else 'Notes'}</span></div>
  <h3><a href="{post_url(post)}">{esc(post['title'])}</a></h3>
  <div class="meta">Grade {post['grade']} · {esc(chaps)}</div>
</article>"""


# ---------------------------------------------------------------- pages

def build_index(data):
    site, posts = data["site"], data["posts"]
    n_notes = sum(p["kind"] == "notes" for p in posts)
    latest = sorted(posts, key=lambda p: p["date"], reverse=True)[:6]
    grade_cards = []
    for g, grade in data["grades"].items():
        gp = [p for p in posts if p["grade"] == g]
        covered = len({n for p in gp for n in p["chapters"]})
        grade_cards.append(f"""<a class="card grade-card" href="/pages/{GRADE_SLUG[g]}.html">
  <h3>{esc(grade['title'])}</h3>
  <p>{len(grade['syllabus'])} chapters · {covered} with lessons so far</p>
  <div class="chapter-links"><span class="chip notes">{sum(p['kind'] == 'notes' for p in gp)} Notes</span><span class="chip mcq">{sum(p['kind'] == 'mcq' for p in gp)} MCQ sets</span></div>
</a>""")
    body = f"""<section class="hero">
  <h1>{esc(site['name'])}</h1>
  <p>{esc(site['tagline'])}</p>
  <form class="hero-search" action="/search.html" role="search">
    <input name="q" placeholder="Search a topic, e.g. “surface tension”" aria-label="Search topics">
    <button class="btn">Search</button>
  </form>
  <div class="stats"><div><b>{len(posts)}</b><span>lessons</span></div><div><b>{n_notes}</b><span>note sets</span></div><div><b>{len(posts) - n_notes}</b><span>MCQ practice sets</span></div></div>
</section>
<section class="section">
  <div class="section-head"><h2>Choose your grade</h2></div>
  <div class="grade-cards">{''.join(grade_cards)}</div>
</section>
<section class="section">
  <div class="section-head"><h2>Recently added</h2><a href="/search.html">Browse all →</a></div>
  <div class="grid">{''.join(card(data, p) for p in latest)}</div>
</section>"""
    return shell(site, title=site["name"], body=body, path="")


def build_grade(data, g):
    site, grade = data["site"], data["grades"][g]
    posts = [p for p in data["posts"] if p["grade"] == g]
    out, area = [], None
    for ch in grade["syllabus"]:
        if ch["area"] != area:
            area = ch["area"]
            out.append(f'<h2 class="area">{esc(area)}</h2>')
        mine = [p for p in posts if ch["n"] in p["chapters"]]
        counts = "".join(
            f'<span class="badge {k}">{sum(p["kind"] == k for p in mine)} {KIND_LABEL[k]}</span>'
            for k in KIND_LABEL if any(p["kind"] == k for p in mine))
        links = "".join(f'<a class="chip {p["kind"]}" href="{post_url(p)}">{"📘" if p["kind"] == "notes" else "📝"} {esc(p["title"])}</a>' for p in mine)
        if not mine:
            links = '<span class="chip soon">Notes &amp; MCQs coming soon</span>'
        links += f'<a class="chip video" href="{site["youtube"]}" target="_blank" rel="noopener">▶ Videos</a>'
        topics = "".join(f"<li>{t}</li>" for t in ch["topics"])  # topics may contain inline HTML (e.g. <sub>)
        out.append(f"""<details class="chapter" id="ch-{ch['n']}"{' open' if mine else ''}>
  <summary><span class="num">{ch['n']}</span>{esc(ch['title'])}<span class="counts">{counts}</span></summary>
  <div class="chapter-body"><ul>{topics}</ul><div class="chapter-links">{links}</div></div>
</details>""")
    body = f"""<div class="crumbs"><a href="/">Home</a> › {esc(grade['title'])}</div>
<section class="hero">
  <h1>{esc(grade['title'])}</h1>
  <p>Complete {esc(site['curriculum'])} syllabus — open a chapter for its topics, notes and MCQ practice.</p>
  <div class="stats"><div><b>{len(grade['syllabus'])}</b><span>chapters</span></div><div><b>{grade['hours']}</b><span>teaching hours</span></div><div><b>{len(posts)}</b><span>lessons</span></div></div>
</section>
{''.join(out)}"""
    return shell(site, title=grade["title"], body=body, path=f"pages/{GRADE_SLUG[g]}.html", current=g,
                 description=f"{grade['title']} — NEB syllabus with notes and MCQs.")


def build_search(data):
    body = """<div class="crumbs"><a href="/">Home</a> › All lessons</div>
<h1>All lessons</h1>
<form id="search-form" class="search-box" role="search">
  <input id="q" type="search" placeholder="Search topics…" aria-label="Search topics" autofocus>
  <button class="btn">Search</button>
</form>
<div id="filters" class="filters">
  <button type="button" data-kind="all">All</button><button type="button" data-kind="notes">Notes</button><button type="button" data-kind="mcq">MCQs</button>
</div>
<div id="results" class="grid"></div>"""
    return shell(data["site"], title="All lessons", body=body, path="search.html", current="search",
                 scripts='<script src="/assets/js/search.js" defer></script>\n')


def build_404(data):
    # Old Blogger links like /search/label/Wave-Motion-Notes are redirected to site search.
    body = """<script>
(function () {
  var prefix = '/search/label/', path = location.pathname;
  if (path.indexOf(prefix) === 0) {
    var label = decodeURIComponent(path.slice(prefix.length)).replace(/\\/+$/, '').replace(/-/g, ' ').trim();
    location.replace('/search.html?q=' + encodeURIComponent(label));
  } else if (/^\\/[a-z0-9-]+\\.html$/.test(path)) {
    location.replace('/posts' + path);  // lessons used to be duplicated at the site root
  }
}());
</script>
<section class="hero"><h1>Page not found</h1><p>That page has moved or never existed. Try searching for the topic instead.</p>
<form class="hero-search" action="/search.html" role="search"><input name="q" placeholder="Search topics…" aria-label="Search topics"><button class="btn">Search</button></form></section>"""
    return shell(data["site"], title="Page not found", body=body, path="404.html")


def build_search_index(data):
    items = []
    for p in data["posts"]:
        chaps = chapter_of(data, p)
        words = [p["title"], p["kind"], "notes" if p["kind"] == "notes" else "mcq mcqs questions practice",
                 f"grade {p['grade']}", p["slug"].replace("-", " ")]
        for c in chaps:
            words += [c["title"], c["area"], *[re.sub(r"<[^>]+>", "", t) for t in c["topics"]]]
        items.append({"title": p["title"], "url": post_url(p), "kind": p["kind"], "grade": p["grade"],
                      "chapter": ", ".join(c["title"] for c in chaps), "date": p["date"],
                      "haystack": re.sub(r"[^a-z0-9 ]+", " ", " ".join(words).lower())})
    items.sort(key=lambda x: (x["grade"] != "XI", x["title"]))
    return json.dumps(items, ensure_ascii=False, indent=1) + "\n"


def build_lesson(data, post):
    """Inject the site bar/footer into a standalone lesson document, leaving its own styles alone."""
    site = data["site"]
    doc = (SRC / "lessons" / f"{post['slug']}.html").read_text(encoding="utf-8")
    chaps = chapter_of(data, post)
    grade_url = f"/pages/{GRADE_SLUG[post['grade']]}.html"
    full_title = f"{post['title']} | {site['name']}"

    head = f"""<link rel="canonical" href="{site['url']}{post_url(post)}">
<meta name="description" content="{esc(post['title'])} — Grade {post['grade']} physics {KIND_LABEL[post['kind']].lower()} ({esc(site['curriculum'])}).">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/lesson-bar.css">
"""
    bar = f"""<div class="pd-bar" role="navigation" aria-label="Site">
<a class="pd-brand" href="/"><img src="/assets/favicon.svg" alt=""><span>{esc(site['name'])}</span></a>
<a class="pd-crumb" href="{grade_url}#ch-{chaps[0]['n']}">Grade {post['grade']} › {esc(chaps[0]['title'])}</a>
<span class="pd-spacer"></span>
<a class="pd-hide-sm" href="/pages/grade-xi.html">Grade XI</a><a class="pd-hide-sm" href="/pages/grade-xii.html">Grade XII</a><a href="/search.html">Search</a>
</div>
"""
    siblings = [p for p in data["posts"] if p is not post and p["grade"] == post["grade"]
                and set(p["chapters"]) & set(post["chapters"])]
    more = "".join(f'<a href="{post_url(p)}">{"📘" if p["kind"] == "notes" else "📝"} {esc(p["title"])}</a>' for p in siblings)
    foot = f"""<div class="pd-footer" role="contentinfo">
{f'<div class="pd-more"><span>Also in this chapter:</span>{more}</div>' if more else ''}
<a href="/">{esc(site['name'])}</a> · {esc(site['author'])} · <a href="{grade_url}">All Grade {post['grade']} chapters</a> · <a href="{site['youtube']}" target="_blank" rel="noopener">YouTube</a>
</div>
"""
    doc, n = re.subn(r"<title>.*?</title>", f"<title>{esc(full_title)}</title>", doc, count=1, flags=re.S | re.I)
    if not n:
        head = f"<title>{esc(full_title)}</title>\n" + head
    doc, n = re.subn(r"</head>", head + "</head>", doc, count=1, flags=re.I)
    if not n:
        raise SystemExit(f"src/lessons/{post['slug']}.html has no </head>")
    doc = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + bar, doc, count=1, flags=re.I)
    if re.search(r"</body>", doc, re.I):
        doc = re.sub(r"</body>(?![\s\S]*</body>)", foot + "</body>", doc, count=1, flags=re.I)
    else:  # truncated lesson: close it off so the footer still renders
        print(f"  warning: src/lessons/{post['slug']}.html has no </body> (file looks truncated)")
        doc += "\n" + foot + "</body>\n</html>\n"
    return doc


def build_sitemap(data):
    site = data["site"]
    rows = [("", None), ("search.html", None)] + [(f"pages/{s}.html", None) for s in GRADE_SLUG.values()]
    rows += [(post_url(p)[1:], p["date"]) for p in data["posts"]]
    urls = "".join(f"  <url><loc>{site['url']}/{u}</loc>{f'<lastmod>{d}</lastmod>' if d else ''}</url>\n" for u, d in rows)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n'


# ---------------------------------------------------------------- main

def write(rel, text):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def main():
    data, errors = load()
    if errors:
        print("Problems found in src/:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    if "--check" in sys.argv:
        print(f"OK: {len(data['posts'])} lessons, content.json is consistent.")
        return

    write("index.html", build_index(data))
    write("search.html", build_search(data))
    write("404.html", build_404(data))
    write("sitemap.xml", build_sitemap(data))
    write("assets/search-index.json", build_search_index(data))
    for g, slug in GRADE_SLUG.items():
        write(f"pages/{slug}.html", build_grade(data, g))
    for post in data["posts"]:
        write(f"posts/{post['slug']}.html", build_lesson(data, post))

    expected = {f"{p['slug']}.html" for p in data["posts"]}
    for stale in sorted(p for p in (ROOT / "posts").glob("*.html") if p.name not in expected):
        stale.unlink()
        print(f"  removed stale posts/{stale.name}")
    print(f"Built {len(data['posts'])} lessons, 2 grade pages, index, search, 404 and sitemap.")


if __name__ == "__main__":
    main()
