# UPSC Current Affairs — CA Desk

Personal **current affairs notebook**: only what you study — newspaper cuttings, PIB, govt sites, magazines — with structured notes and **year-end topic reports** (e.g. all RBI monetary policy in 2025).

Companion to [upsc-mains-pyq](https://github.com/sauravanandb2w/upsc-mains-pyq) — separate repo, **separate Supabase project**.

## Storage model

| Data | Where |
|------|--------|
| **Summary**, **links**, **sources** | Supabase (sync phone ↔ laptop) |
| **Facts, static, GS fit, exam angle, misc** | Git `study/items/<id>/notes.md` |
| **Tags, threads, metadata** | Git `manifest.json` |
| **Cuttings / small images** | Git in item folder |
| **Large PDFs / magazines** | Google Drive (paste link in sources/links) |

Full schema: **[SCHEMA.md](./SCHEMA.md)**

## Quick start

```bash
cd upsc-current-affairs

# Add from laptop (git-backed)
python3 scripts/add-item.py "RBI MPC February" --date 2025-02-08 --tag rbi --tag monetary-policy --thread 2025-rbi-monetary-policy --gs 3

# Or use **+ Add CA** in the web app (saves on device; export to git from laptop)

# Rebuild index after editing manifests
python3 scripts/build-index.py

# Run locally
python3 -m http.server 8080
# → http://localhost:8080
```

### In the app

| Action | Where |
|--------|--------|
| **Add new CA** | **+ Add CA** button (header or desk) |
| **Revise by date range** | **Revise** tab → last 7/30/90 days or custom range |
| **Search** | Header search box (title, tags, notes) |
| **Status** | Open item → Status dropdown (to study / studied / revise) |

## Supabase (summary + links + sources only)

1. Create a **new** Supabase project (not PYQ).
2. Run `supabase/schema.sql`.
3. `cp js/config.example.js js/config.js` and add keys.

See **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)**

## Topic lens (year-end)

In app: **Topic lens** → year + tag (e.g. `monetary-policy`) or thread (`2025-rbi-monetary-policy`).

CLI export:

```bash
python3 scripts/topic-report.py --year 2025 --tag monetary-policy -o reports/rbi-2025.md
python3 scripts/topic-report.py --year 2025 --thread 2025-rbi-monetary-policy -o reports/rbi-thread-2025.md
```

## Deploy (GitHub Pages)

1. Push repo to GitHub as `upsc-current-affairs`.
2. Add Actions secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
3. Enable Pages → GitHub Actions.

## Repo layout

```
study/items/<id>/manifest.json   # tags, threads, gsPapers, default links/sources
study/items/<id>/notes.md        # git-only deep notes
data/index.json                  # built by scripts/build-index.py
scripts/                         # add-item, build-index, topic-report
supabase/schema.sql
js/                              # static app
```

## Example items

- `2025-02-08-rbi-mpc` — tags for monetary policy / topic lens demo
- `2025-06-02-green-hydrogen` — environment / GS III

## Roadmap

- [ ] GitHub OAuth — commit `notes.md` from app (like PYQ images)
- [ ] Flashcards + monthly revise mode
- [ ] Drive link picker helper
- [ ] Rich text toolbar on note fields
