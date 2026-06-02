#!/usr/bin/env bash
# One-time: set GitHub OAuth secrets on the CA Supabase project (token exchange).
set -euo pipefail

PROJECT_REF="${SUPABASE_CA_PROJECT_REF:-hqrxdvrxzmlntejwojep}"
CLIENT_ID="${GITHUB_CLIENT_ID:-Ov23lih0ATmpjlWl49vn}"

if [[ -z "${GITHUB_CLIENT_SECRET:-}" ]]; then
  echo "Set GITHUB_CLIENT_SECRET from your GitHub OAuth app (NOT the Client ID)."
  echo "  GitHub → Settings → Developer settings → OAuth Apps → your CA app"
  echo "  → Client secrets → Generate new client secret → copy the long random string"
  echo ""
  echo "Then run:"
  echo "  GITHUB_CLIENT_SECRET='your_secret' bash scripts/setup-ca-github-oauth.sh"
  exit 1
fi

if [[ "$GITHUB_CLIENT_SECRET" == Ov23* ]]; then
  echo "error: GITHUB_CLIENT_SECRET looks like a Client ID (starts with Ov23)."
  echo "Use the separate Client secret from the OAuth app page (long random string)."
  exit 1
fi

cd "$(dirname "$0")/.."
supabase link --project-ref "$PROJECT_REF"
supabase secrets set \
  "GITHUB_CLIENT_ID=$CLIENT_ID" \
  "GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET"

echo "Done. Client ID: $CLIENT_ID"
echo "Test (expect GitHub token error, NOT 'not configured on server'):"
echo "  curl -s -X POST \"https://${PROJECT_REF}.supabase.co/functions/v1/github-oauth\" \\"
echo "    -H 'Content-Type: application/json' -H 'apikey: YOUR_ANON_KEY' \\"
echo "    -d '{\"code\":\"x\",\"redirect_uri\":\"https://sauravanandb2w.github.io/upsc-current-affairs/oauth/github-callback.html\"}'"
