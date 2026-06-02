/**
 * Connect GitHub + upload cuttings / PDFs from the CA app.
 */

import {
  isGitHubConnected,
  isGitHubUploadConfiguredSync,
  isGitHubUploadAllowed,
  startGitHubLogin,
  disconnectGitHub,
  initGitHubUploadConfig,
  isGitHubUploadConfigured,
} from "./github-auth.js";
import {
  uploadCaItemImage,
  uploadCaItemPdf,
  deleteCaItemImage,
  deleteCaItemPdf,
} from "./github-upload.js";

export function renderGitHubConnectHint() {
  if (!isGitHubUploadConfiguredSync()) {
    return `<p class="github-upload-note">Set up GitHub OAuth to upload from the app — <code>GITHUB_UPLOAD_SETUP.md</code></p>`;
  }
  if (isGitHubConnected()) {
    return `<p class="github-upload-note github-upload-note--ok">GitHub connected — files commit to repo (~1–2 min to appear).</p>`;
  }
  return `<p class="github-upload-note">Click <strong>Connect GitHub</strong> in the header to upload cuttings &amp; PDFs.</p>`;
}

export function renderGitHubUploadButton(kind, attrs = {}) {
  const label =
    kind === "ca-pdf" ? "Upload PDF to git" : kind === "ca-image" ? "Upload cutting / photo" : "Upload file";

  const accept = kind === "ca-pdf" ? "application/pdf,.pdf" : "image/*";
  const capture = kind === "ca-image" ? ' capture="environment"' : "";

  const dataAttrs = Object.entries(attrs)
    .map(([k, v]) => ` data-${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join("");

  return `
    <div class="github-upload-control"${dataAttrs} data-upload-kind="${kind}">
      <label class="github-upload-label btn-ghost btn-sm">
        <input type="file" accept="${accept}"${capture} class="github-upload-input" hidden />
        ${label}
      </label>
      <span class="github-upload-status" aria-live="polite"></span>
    </div>`;
}

export async function bindGitHubHeaderButton(btn, onChange) {
  if (!btn) return;

  async function refresh() {
    btn.classList.remove("hidden");
    const configured = await isGitHubUploadConfigured();

    if (!configured) {
      btn.textContent = "Connect GitHub";
      btn.title = "GitHub OAuth not configured — see GITHUB_UPLOAD_SETUP.md";
      return;
    }

    if (isGitHubConnected()) {
      const allowed = await isGitHubUploadAllowed();
      btn.textContent = allowed ? "GitHub ✓" : "GitHub ⚠";
      btn.title = allowed
        ? "Connected — click to disconnect"
        : "Wrong GitHub user — upload restricted to repo owner";
    } else {
      btn.textContent = "Connect GitHub";
      btn.title = "Upload cuttings & PDFs to git";
    }
  }

  await refresh();

  btn.addEventListener("click", async () => {
    const configured = await isGitHubUploadConfigured();
    if (!configured) {
      window.alert(
        "GitHub OAuth is not configured yet.\n\n" +
          "1. Add GITHUB_OAUTH_CLIENT_ID to js/config.js (or GH_OAUTH_CLIENT_ID repo secret for Pages).\n" +
          "2. Add this callback URL to your GitHub OAuth app:\n" +
          "   …/upsc-current-affairs/oauth/github-callback.html\n" +
          "3. Deploy github-oauth on your CA Supabase project.\n\n" +
          "See GITHUB_UPLOAD_SETUP.md for steps."
      );
      return;
    }

    if (isGitHubConnected()) {
      if (window.confirm("Disconnect GitHub on this device?")) {
        disconnectGitHub();
        await refresh();
        onChange?.();
      }
      return;
    }

    try {
      await startGitHubLogin(location.pathname + location.search);
    } catch (err) {
      window.alert(err.message || String(err));
    }
  });

  return refresh;
}

function parseManifestFallback(control) {
  try {
    return JSON.parse(control.dataset.itemManifest || "{}");
  } catch {
    return {};
  }
}

export function bindGitHubUploadControl(root, onDone) {
  const control = root.classList?.contains("github-upload-control")
    ? root
    : root.querySelector(".github-upload-control");
  if (!control) return;

  const input = control.querySelector(".github-upload-input");
  const status = control.querySelector(".github-upload-status");
  if (!input) return;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (!(await initGitHubUploadConfig())) {
      status.textContent = "OAuth not set — click Connect GitHub in header.";
      return;
    }

    if (!isGitHubConnected()) {
      status.textContent = "Connecting GitHub…";
      try {
        await startGitHubLogin(location.pathname + location.search);
      } catch (err) {
        status.textContent = err.message || "Connect GitHub first (header).";
      }
      return;
    }

    if (!(await isGitHubUploadAllowed())) {
      status.textContent = "Upload restricted to repo owner.";
      return;
    }

    const itemId = control.dataset.itemId;
    const kind = control.dataset.uploadKind;
    const fallback = parseManifestFallback(control);
    status.textContent = "Uploading…";

    try {
      if (kind === "ca-pdf") {
        await uploadCaItemPdf(itemId, file, fallback);
      } else {
        await uploadCaItemImage(itemId, file, fallback);
      }
      status.textContent = "Uploaded! Visible in ~1–2 min after deploy. Run build-index.py if new item.";
      onDone?.();
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  });
}

export function bindCaGalleryDeletes(container, itemId, fallbackManifest, onDone) {
  if (!container) return;

  container.querySelectorAll(".github-delete-btn").forEach((btn) => {
    isGitHubUploadAllowed().then((allowed) => {
      btn.classList.toggle("hidden", !isGitHubConnected() || !allowed);
    });
    if (btn.dataset.boundDelete) return;
    btn.dataset.boundDelete = "1";

    btn.addEventListener("click", async () => {
      const file = btn.dataset.file;
      const kind = btn.dataset.fileKind || "image";
      if (!file || !window.confirm(`Delete from git?\n\n${file}`)) return;

      btn.disabled = true;
      try {
        if (kind === "pdf") {
          await deleteCaItemPdf(itemId, file, fallbackManifest);
        } else {
          await deleteCaItemImage(itemId, file, fallbackManifest);
        }
        onDone?.();
      } catch (err) {
        window.alert(err.message || String(err));
        btn.disabled = false;
      }
    });
  });
}

export function bindAllMaterialsUploads(root, itemId, fallbackManifest, onDone) {
  root.querySelectorAll(".github-upload-control").forEach((el) => {
    bindGitHubUploadControl(el, onDone);
  });
  bindCaGalleryDeletes(root.querySelector(".materials-gallery"), itemId, fallbackManifest, onDone);
  bindCaGalleryDeletes(root.querySelector(".materials-pdfs"), itemId, fallbackManifest, onDone);
}
