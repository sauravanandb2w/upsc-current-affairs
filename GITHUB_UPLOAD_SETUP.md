# GitHub upload — cuttings & PDFs from the app

Upload newspaper cuttings (photos) and small PDFs **from the CA app** — files commit to `study/items/<id>/` via GitHub API.

**Links & source URLs** sync via Supabase (no GitHub needed). **Images/PDFs in git** need GitHub OAuth.

---

## 1. GitHub OAuth App

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New**
2. **Homepage URL:** `https://sauravanandb2w.github.io/upsc-current-affairs/`
3. **Callback URL:**

   ```
   https://sauravanandb2w.github.io/upsc-current-affairs/oauth/github-callback.html
   ```

   Local dev also add:

   ```
   http://localhost:8080/oauth/github-callback.html
   http://127.0.0.1:8081/oauth/github-callback.html
   ```

4. Save **Client ID** and **Client secret**

You can reuse the same OAuth app as PYQ **if** you add the CA callback URLs above.

---

## 2. Supabase Edge Function (CA project)

Project ref: **`hqrxdvrxzmlntejwojep`** (upsc-current-affairs)

The `github-oauth` function is in this repo. Deploy once, then set secrets:

```bash
cd upsc-current-affairs
supabase login
supabase link --project-ref hqrxdvrxzmlntejwojep

# Same client ID + secret as your PYQ OAuth app (or regenerate secret in GitHub OAuth app settings)
GITHUB_CLIENT_SECRET='paste_secret_here' bash scripts/setup-ca-github-oauth.sh

# Or manually:
supabase secrets set GITHUB_CLIENT_ID=Ov23lih0ATmpjlWl49vn
supabase secrets set GITHUB_CLIENT_SECRET=your_client_secret
supabase functions deploy github-oauth --no-verify-jwt --use-api
```

**Symptom:** “GitHub OAuth not configured on server” after GitHub redirects back → secrets not set on this Supabase project yet.

**Symptom:** “github-oauth … not deployed” → run `supabase functions deploy` above.

---

## 3. App config

### Local `js/config.js`

```javascript
export const SUPABASE_URL = "https://YOUR_CA_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-key";
export const GITHUB_OAUTH_CLIENT_ID = "Ov23li...";
export const GITHUB_REPO_OWNER = "sauravanandb2w";
export const GITHUB_REPO_NAME = "upsc-current-affairs";
export const GITHUB_OAUTH_SCOPE = "public_repo";
```

### GitHub Actions secrets

| Secret | Value |
|--------|--------|
| `SUPABASE_URL` | CA project URL |
| `SUPABASE_ANON_KEY` | CA anon key |
| `GH_OAUTH_CLIENT_ID` | OAuth client ID |
| `GH_REPO_OWNER` | `sauravanandb2w` |
| `GH_REPO_NAME` | `upsc-current-affairs` |
| `GH_OAUTH_SCOPE` | `public_repo` (optional) |

---

## 4. In the app

1. **Sign in** (Supabase) — for summary, links, sources sync
2. **Connect GitHub** (header) — for cuttings & PDF upload
3. Open any item → **Materials** section:
   - **+ Add link** — PIB, news, govt URLs (Supabase)
   - **+ Add source** / **+ Paste PDF / Drive link** — newspaper, magazine, Drive URL
   - **Upload cutting / photo** — JPG/PNG to git
   - **Upload PDF to git** — up to 25 MB; full magazines → Drive URL in Sources

After upload, site updates in **~1–2 min**. New items: run `python3 scripts/build-index.py` and push so they appear in the desk list.

---

## Storage split

| What | Where |
|------|--------|
| Links, source URLs, summary | Supabase |
| Cuttings (photos) | Git `study/items/<id>/*.jpg` |
| Small PDFs | Git in item folder |
| Large magazine PDFs | Google Drive → paste URL in Sources |
