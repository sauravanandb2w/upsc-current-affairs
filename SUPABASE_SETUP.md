# Supabase setup — UPSC Current Affairs

Use a **new Supabase project** (not your PYQ project). Only **summary**, **links**, and **sources** sync here.

## 1. Create project

1. [supabase.com](https://supabase.com) → **New project** (e.g. `upsc-current-affairs`).
2. Pick region close to India.

## 2. Run schema

**SQL Editor** → paste all of `supabase/schema.sql` → **Run**.

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
| Summary | Yes |
| Links | `links_json` |
| Sources | `sources_json` |
| Facts, static, GS fit, exam angle, misc | **Git only** (`notes.md`) |
| Tags, threads | **Git** (`manifest.json`) |
