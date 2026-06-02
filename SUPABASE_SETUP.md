# Supabase setup — UPSC Current Affairs

Use a **new Supabase project** (not your PYQ project). Only **summary**, **links**, and **sources** sync here.

## 1. Create project

1. [supabase.com](https://supabase.com) → **New project** (e.g. `upsc-current-affairs`).
2. Pick region close to India.

## 2. Run schema

**SQL Editor** → paste all of `supabase/schema.sql` → **Run**.

If the project already exists, also run `supabase/schema-migrate.sql` (adds locks, stars, git notes sync).

### Troubleshooting: `git_notes_json` / schema cache

If sync shows **Could not find the 'git_notes_json' column** (or `locked_fields`), your project was created before those columns existed. In **SQL Editor**, run:

```sql
alter table public.ca_item_notes
  add column if not exists locked_fields jsonb not null default '{}'::jsonb;

alter table public.ca_item_notes
  add column if not exists git_notes_json jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
```

Or paste all of `supabase/schema-migrate.sql` and **Run**. Then tap the **Sync** badge in the app again.

## 3. Auth

- **Email** provider on (optional: disable confirm email for testing).
- **Google** optional — same steps as PYQ `SUPABASE_SETUP.md`.

## 4. URL configuration

**Authentication** → **URL Configuration**:

- **Site URL:** `http://localhost:8080` (dev) or your GitHub Pages URL
- **Redirect URLs:** add localhost, `127.0.0.1`, and production URL

## 5. App config

```bash
cp js/config.example.js js/config.js
```

Edit with **this CA project’s** URL and anon key (**Project Settings** → **API**).

Do not commit `js/config.js`.

## 6. GitHub Pages secrets (after repo on GitHub)

Repository → **Settings** → **Secrets** → **Actions**:

| Secret | Value |
|--------|--------|
| `SUPABASE_URL` | CA project URL |
| `SUPABASE_ANON_KEY` | CA anon key |

## What syncs

| Field | Supabase |
|-------|----------|
| Summary | Yes (+ field locks) |
| Links | `links_json` |
| Sources | `sources_json` |
| Deep notes (Facts, etc.) — drafts only | `git_notes_json` until **Commit notes.md** (then cleared; Git holds archive) |
| Field locks | `locked_fields` |
| Stars / last revised | `ca_item_meta` |
| Flashcards | `ca_flashcards` |
| Tags, threads | **Git** (`manifest.json`) |
| Cuttings / PDF files | **Git** (GitHub upload) |
