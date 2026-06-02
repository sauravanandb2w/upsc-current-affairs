/**
 * GitHub OAuth for uploading cuttings / PDFs to study/items/ via Contents API.
 */

import { repoBase } from "./paths.js";

const TOKEN_KEY = "upsc-ca-github-token";
const RETURN_KEY = "upsc-ca-github-oauth-return";
const STATE_KEY = "upsc-ca-github-oauth-state";
const REDIRECT_URI_KEY = "upsc-ca-github-oauth-redirect";
const GITHUB_USER_KEY = "upsc-ca-github-user";

let cachedUsername = null;
let uploadAllowedCache = null;
let cfg = null;
let configuredCache = null;

function readMetaConfig(name) {
  if (typeof document === "undefined") return "";
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";
}

function cfgVal(c, key, metaName = "") {
  const fromModule = String(c?.[key] || "").trim();
  if (fromModule) return fromModule;
  if (metaName) return readMetaConfig(metaName);
  return "";
}

async function loadCfg() {
  if (cfg) return cfg;
  try {
    cfg = await import("./config.js");
  } catch (err) {
    console.warn("js/config.js not loaded — using meta fallbacks for GitHub OAuth", err);
    cfg = {};
  }
  return cfg;
}

export function getOAuthClientIdFromConfig(c) {
  return cfgVal(c, "GITHUB_OAUTH_CLIENT_ID", "ca-github-oauth-client-id");
}

export function getSupabaseUrlFromConfig(c) {
  return cfgVal(c, "SUPABASE_URL", "ca-supabase-url");
}

export function getSupabaseAnonKeyFromConfig(c) {
  return cfgVal(c, "SUPABASE_ANON_KEY", "ca-supabase-anon-key");
}

export function inferRepoFromPagesUrl() {
  const host = location.hostname;
  if (host.endsWith(".github.io")) {
    const owner = host.replace(".github.io", "");
    const parts = location.pathname.split("/").filter(Boolean);
    const name = parts[0] || "";
    if (owner && name) return { owner, name };
  }
  return null;
}

export async function getGitHubRepo() {
  const c = await loadCfg();
  const inferred = inferRepoFromPagesUrl();
  return {
    owner: (c.GITHUB_REPO_OWNER || inferred?.owner || "").trim(),
    name: (c.GITHUB_REPO_NAME || inferred?.name || "").trim(),
  };
}

export async function isGitHubUploadConfigured() {
  const c = await loadCfg();
  const ok = Boolean(
    getOAuthClientIdFromConfig(c) &&
      getSupabaseUrlFromConfig(c) &&
      getSupabaseAnonKeyFromConfig(c)
  );
  configuredCache = ok;
  return ok;
}

export function isGitHubUploadConfiguredSync() {
  return configuredCache === true;
}

export async function initGitHubUploadConfig() {
  return isGitHubUploadConfigured();
}

export function getGitHubToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
}

export function isGitHubConnected() {
  return Boolean(getGitHubToken());
}

export function disconnectGitHub() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GITHUB_USER_KEY);
  cachedUsername = null;
  uploadAllowedCache = null;
}

function storeToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function getOAuthRedirectUri() {
  const stored = sessionStorage.getItem(REDIRECT_URI_KEY);
  if (stored) return stored;
  const base = repoBase();
  return `${location.origin}${base}/oauth/github-callback.html`.replace(/([^:]\/)\/+/g, "$1");
}

export async function startGitHubLogin(returnPath) {
  const c = await loadCfg();
  const clientId = getOAuthClientIdFromConfig(c);
  if (!clientId) {
    throw new Error(
      "GitHub OAuth client ID missing — add GITHUB_OAUTH_CLIENT_ID to js/config.js (see GITHUB_UPLOAD_SETUP.md)."
    );
  }

  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(RETURN_KEY, returnPath || location.pathname + location.search);

  const redirectUri = getOAuthRedirectUri();
  sessionStorage.setItem(REDIRECT_URI_KEY, redirectUri);
  const scope = (c.GITHUB_OAUTH_SCOPE || "public_repo").trim();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  });

  location.href = `https://github.com/login/oauth/authorize?${params}`;
}

export async function completeGitHubLogin(code, state) {
  const expected = sessionStorage.getItem(STATE_KEY);
  if (!expected || expected !== state) {
    throw new Error("OAuth state mismatch — try connecting again.");
  }

  const c = await loadCfg();
  const supabaseUrl = getSupabaseUrlFromConfig(c);
  const anonKey = getSupabaseAnonKeyFromConfig(c);
  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase URL/key required for GitHub token exchange.");
  }

  let res;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/github-oauth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        code,
        redirect_uri: sessionStorage.getItem(REDIRECT_URI_KEY) || getOAuthRedirectUri(),
      }),
    });
  } catch {
    throw new Error(
      "Could not reach Supabase github-oauth function — deploy it (see GITHUB_UPLOAD_SETUP.md)."
    );
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    throw new Error(
      "github-oauth edge function not deployed on CA Supabase yet. Run: supabase link --project-ref hqrxdvrxzmlntejwojep && supabase secrets set GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… && supabase functions deploy github-oauth --no-verify-jwt"
    );
  }
  if (!res.ok || !data.access_token) {
    const msg = data.error || data.error_description || data.message || "GitHub login failed";
    if (String(msg).includes("not configured on server")) {
      throw new Error(
        "GitHub OAuth secrets missing on Supabase — set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on project hqrxdvrxzmlntejwojep (see GITHUB_UPLOAD_SETUP.md §2)."
      );
    }
    throw new Error(msg);
  }

  storeToken(data.access_token);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(REDIRECT_URI_KEY);
  await fetchGitHubUsername(true);
  return data.access_token;
}

export function consumeOAuthReturnPath() {
  const path = sessionStorage.getItem(RETURN_KEY) || `${repoBase()}/`.replace(/\/+/g, "/") || "/";
  sessionStorage.removeItem(RETURN_KEY);
  const base = repoBase();
  if (path.startsWith("http")) return path;
  if (base && path.startsWith(base)) return `${location.origin}${path}`;
  if (path.startsWith("/")) return `${location.origin}${path}`;
  return `${location.origin}${base}/${path}`.replace(/\/+/g, "/");
}

function githubApiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function fetchGitHubUsername(force = false) {
  if (!force && cachedUsername) return cachedUsername;

  const stored = localStorage.getItem(GITHUB_USER_KEY);
  if (!force && stored) {
    cachedUsername = stored;
    return stored;
  }

  const token = getGitHubToken();
  if (!token) return null;

  const res = await fetch("https://api.github.com/user", { headers: githubApiHeaders(token) });
  if (!res.ok) return null;

  const data = await res.json();
  cachedUsername = data.login || null;
  if (cachedUsername) localStorage.setItem(GITHUB_USER_KEY, cachedUsername);
  uploadAllowedCache = null;
  return cachedUsername;
}

export async function getAllowedUploadUser() {
  const c = await loadCfg();
  const allowed = (
    c.GITHUB_UPLOAD_ALLOWED_USER ||
    c.GITHUB_REPO_OWNER ||
    inferRepoFromPagesUrl()?.owner ||
    ""
  )
    .trim()
    .toLowerCase();
  return allowed;
}

export async function isGitHubUploadAllowed() {
  if (!isGitHubConnected()) return false;
  if (uploadAllowedCache !== null) return uploadAllowedCache;

  const allowed = await getAllowedUploadUser();
  if (!allowed) {
    uploadAllowedCache = true;
    return true;
  }

  const user = await fetchGitHubUsername();
  uploadAllowedCache = Boolean(user && user.toLowerCase() === allowed);
  return uploadAllowedCache;
}
