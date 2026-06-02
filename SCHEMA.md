# UPSC Current Affairs — data schema

## Storage split

| Data | Where | Sync |
|------|--------|------|
| **Summary / story** | Supabase `ca_item_notes.summary` | Phone ↔ laptop (auto-save) |
| **Links** | Supabase `ca_item_notes.links_json` | Same |
| **Sources** (type, name, date, URL, file pointer) | Supabase `ca_item_notes.sources_json` | Same |
| **Facts, static, GS fit, exam angle, misc** | Git `study/items/<id>/notes.md` | Git push |
| **Tags, threads, title, date, status, gsPapers** | Git `manifest.json` | Git push |
| **Gallery** (cuttings) | Git (small JPG) / Drive (large PDF) | Git / Drive URL in sources |
| **Flashcards** | Supabase `ca_flashcards` (optional) | Same |

**New Supabase project** for this app only — does not share quota with `upsc-mains-pyq`.

On **Sync to git**, copy summary into `notes.md` under `## Summary / story` for year-end exports.

---

## Item folder

```
study/items/<item-id>/
├── manifest.json
├── notes.md          # git-only sections (see below)
└── *.jpg             # optional cuttings
```

### `item-id` convention

`YYYY-MM-DD-short-slug` — e.g. `2025-02-08-rbi-mpc`

---

## `manifest.json`

```json
{
  "id": "2025-02-08-rbi-mpc",
  "date": "2025-02-08",
  "title": "RBI MPC — repo rate unchanged",
  "status": "studied",
  "gsPapers": [3],
  "tags": ["rbi", "monetary-policy", "mpc"],
  "threads": ["2025-rbi-monetary-policy"],
  "images": ["hindu-cutting.jpg"],
  "sources": [],
  "links": []
}
```

- `status`: `to-study` | `studied` | `revise`
- `sources` / `links`: mirrored from Supabase when exported; app prefers Supabase when signed in

### Source object

```json
{
  "type": "newspaper",
  "name": "The Hindu",
  "date": "2025-02-08",
  "url": "https://...",
  "file": { "storage": "git", "path": "hindu-cutting.jpg" }
}
```

`type`: `newspaper` | `magazine` | `pib` | `govt-site` | `article` | `report` | `video` | `other`

`file.storage`: `git` | `drive` — for drive use `driveFileId` instead of `path`

### Link object

```json
{
  "label": "PIB — MPC statement",
  "url": "https://pib.gov.in/...",
  "kind": "pib",
  "addedAt": "2025-02-08"
}
```

`kind`: `news` | `pib` | `govt-site` | `magazine` | `article` | `video` | `report` | `other`

---

## `notes.md` (git — large text)

```markdown
## Facts
...

## Static connection
...

## GS paper fit
...

## Exam angle
...

## Miscellaneous
...
```

Optional after sync: `## Summary / story` (backup of Supabase summary).

---

## Topic lens (year-end)

Filter `data/index.json` by:

- `year` (from `date`)
- `tags` contains e.g. `monetary-policy`
- or `threads` contains e.g. `2025-rbi-monetary-policy`

CLI: `python3 scripts/topic-report.py --year 2025 --tag monetary-policy`

---

## Tag hygiene

Use consistent tags: `rbi`, `monetary-policy`, not mixed spellings. Threads group recurring themes across months.
