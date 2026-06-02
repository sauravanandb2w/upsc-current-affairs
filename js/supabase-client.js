import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;
let configured = false;

export function isSupabaseConfigured() {
  return configured;
}

export function getSupabase() {
  return client;
}

export async function initSupabase() {
  let url = "";
  let key = "";

  try {
    const cfg = await import("./config.js");
    url = (cfg.SUPABASE_URL || "").trim();
    key = (cfg.SUPABASE_ANON_KEY || "").trim();
  } catch {
    /* config.js not created yet */
  }

  if (!url || !key || url.includes("YOUR_PROJECT") || key.includes("YOUR_ANON")) {
    const metaUrl = document.querySelector('meta[name="ca-supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="ca-supabase-anon-key"]')?.content?.trim();
    if (metaUrl && metaKey) {
      url = metaUrl;
      key = metaKey;
    }
  }

  if (!url || !key || url.includes("YOUR_PROJECT") || key.includes("YOUR_ANON")) {
    configured = false;
    client = null;
    return null;
  }

  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  configured = true;
  return client;
}

export function onAuthStateChange(callback) {
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function getSession() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

export async function signInWithEmail(email, password) {
  if (!client) throw new Error("Supabase not configured");
  return client.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email, password) {
  if (!client) throw new Error("Supabase not configured");
  return client.auth.signUp({ email, password });
}

export async function signInWithGoogle() {
  if (!client) throw new Error("Supabase not configured");
  return client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
}
