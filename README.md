# UPSC Current Affairs — CA Desk

Personal **current affairs notebook**: newspaper cuttings, PIB, govt releases, magazines — with structured notes, spaced revision, flashcards, and **year-end topic reports** (e.g. all RBI MPC decisions in 2025).

**Live app:** [sauravanandb2w.github.io/upsc-current-affairs](https://sauravanandb2w.github.io/upsc-current-affairs/)

Companion to [upsc-mains-pyq](https://github.com/sauravanandb2w/upsc-mains-pyq) — **separate repo, separate Supabase project**.

---

## Ready to use?

**Yes** — for daily study on phone or laptop:

1. Open the live link above (or run locally — see below).
2. **Sign in** (email or Google) → notes, links, sources, and flashcards sync via Supabase.
3. **Connect GitHub** (header) → publish items and commit notes to your repo without the terminal.
4. After deploy updates, **hard refresh** once (`Cmd+Shift+R`) if the app shows a script error.

Works offline in the browser for reading; sign-in and GitHub need network.

---

## Features

| Area | What you get |
|------|----------------|
| **Capture** | **+ Add CA** — title, date, tags, threads, GS papers |
| **Notes** | Summary + Facts · Static · GS fit · Exam angle · Miscellaneous |
| **Rich text** | Bold, italic, underline, bullet/numbered lists — **kept on Supabase sync and in git** |
| **Note boxes** | Fixed height with **scroll**; resize all boxes with **S / M / L** in header |
| **Field lock** | Padlock on each section — **keep editing locally**; text after lock **does not go to GitHub** until unlock |
| **GitHub** | Publish draft · Save manifest · Commit `notes.md` · Refresh from GitHub · image/PDF upload |
| **Search** | Header search with autocomplete (title, tags, threads, note text) |
| **Revise** | Date-range revise view · **Mark revised today** · **Drill** flashcards |
| **Views** | Today · All items · Calendar · Monthly · Topic · Thread · Tracker · Status desk |
| **Export** | JSON or Markdown backup |

---

## Storage model

| Data | Where | Sync |
|------|--------|------|
| **Summary, links, sources** | Supabase `ca_item_notes` | Phone ↔ laptop (auto-save) |
| **Note sections while editing** | Supabase `git_notes_json` + browser | Same (instant) |
| **Facts, static, GS fit, exam angle, misc** | Git `study/items/<id>/notes.md` | **Commit notes.md → GitHub** |
| **Tags, threads, status, metadata** | Git `manifest.json` + `data/index.json` | **Save to GitHub** |
| **Cuttings / small images** | Git in item folder | GitHub upload |
| **Large magazines / PDFs** | Google Drive URL in sources | Link only (keeps repo small) |
| **Flashcards, stars, last revised** | Supabase | Same login on all devices |

Full schema: **[SCHEMA.md](./SCHEMA.md)**

---

## Day-to-day workflow (in the app)

### New item (draft → published)

1. **+ Add CA** → fill title, date, tags.
2. Write notes in the item page (Summary, Facts, etc.).
3. **Connect GitHub** if not already connected.
4. **Publish to GitHub** — creates `manifest.json`, `notes.md`, updates `data/index.json`.

### Update an existing item

| Button | Updates |
|--------|---------|
| **Save to GitHub** | Status, tags, links, sources → `manifest.json` + search index |
| **Commit notes.md → GitHub** | Summary + Facts + Exam angle + … → `notes.md` |
| **Refresh notes from GitHub** | Pull `notes.md` into this browser (other device, or after git edit) |

**Tip:** After **Commit** on the same device, you do **not** need Refresh — your notes are already here. On another device: **Sign in** (Supabase) or **Refresh notes from GitHub**.

### Lock (private notes)

- **Open padlock** → field syncs normally.
- **Closed padlock** → tinted/dashed box; you **can still type**; edits sync to **Supabase** on your account but only the **text at lock time** is sent to **GitHub** on commit.
- **Unlock** → full text goes to git on next commit.

---

## Run locally

```bash
cd upsc-current-affairs
cp js/config.example.js js/config.js   # add your Supabase + GitHub OAuth IDs
python3 -m http.server 8080
# → http://localhost:8080
```

Add `http://localhost:8080/oauth/github-callback.html` to your GitHub OAuth app callbacks for local GitHub connect.

### CLI (optional)

```bash
# Add item from terminal
python3 scripts/add-item.py "RBI MPC February" --date 2025-02-08 --tag rbi --gs 3

python3 scripts/build-index.py

# Year-end topic report
python3 scripts/topic-report.py --year 2025 --tag monetary-policy -o reports/rbi-2025.md
```

---

## Setup (one time)

| Step | Doc |
|------|-----|
| Supabase (notes sync) | **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)** — new project, run `supabase/schema.sql`, `js/config.js` |
| GitHub OAuth + publish | **[GITHUB_UPLOAD_SETUP.md](./GITHUB_UPLOAD_SETUP.md)** — OAuth app, edge function, Connect GitHub in app |
| GitHub Pages deploy | Push to `main`; enable Pages → GitHub Actions; secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` |

---

## Repo layout

```
study/items/<id>/
├── manifest.json          # tags, threads, status, links, sources
├── notes.md               # deep notes (HTML allowed)
└── *.jpg                  # optional cuttings
data/index.json            # built index (app + scripts)
data/search-index.json     # search autocomplete
scripts/                   # add-item, build-index, topic-report
supabase/schema.sql
js/                        # static app (ES modules)
```

---

## Example items

- `2025-02-08-rbi-mpc` — monetary policy / topic lens demo  
- `2025-06-02-green-hydrogen` — environment / GS III  

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Script error on load | Hard refresh `Cmd+Shift+R` (cache bust on `app.js?v=…`) |
| Notes vanished after Refresh | Update app; use **Commit** then Refresh only when needed; sign in for Supabase |
| Formatting lost | Re-commit after app update — git now stores HTML in `notes.md` |
| GitHub commit fails | **Connect GitHub**; must be repo owner |

---

## Disclaimer

For personal study. Verify facts and citations from official sources (PIB, RBI, The Hindu, etc.).
