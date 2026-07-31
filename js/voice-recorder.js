/**
 * In-browser voice recorder widget — record, preview, upload to GitHub, delete.
 * Caller supplies uploadFn and deleteFn; this module handles everything else.
 *
 * Usage:
 *   import { renderVoiceWidget, bindVoiceWidget } from "./voice-recorder.js";
 *
 *   // In your render function:
 *   html += renderVoiceWidget("study/items/" + itemId, item.voices || []);
 *
 *   // After inserting into DOM:
 *   bindVoiceWidget(containerEl,
 *     (blob, name, secs) => uploadCaItemVoice(itemId, blob, name, secs, manifest),
 *     (name)             => deleteCaItemVoice(itemId, name, manifest),
 *     () => refresh()
 *   );
 */

import { isGitHubConnected, isGitHubUploadAllowed } from "./github-auth.js";

const MAX_SECS = 10 * 60; // 10-minute cap per recording

function getSupportedMimeType() {
  for (const t of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function mimeToExt(mime) {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  return ".webm";
}

function fmtSecs(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function nowFilename(ext) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 15);
  return `voice-${ts}${ext}`;
}

/**
 * Returns the HTML string for the voice widget.
 *
 * @param {string} studyFolder  Repo-relative path, e.g. "study/items/abc123"
 * @param {Array}  voices       Entries from manifest.voices (string filenames or {file, duration, date})
 */
export function renderVoiceWidget(studyFolder, voices = []) {
  const existingHtml = (voices || [])
    .map((v) => {
      const file = typeof v === "string" ? v : v?.file;
      const dur  = typeof v === "object" && v?.duration != null ? fmtSecs(Math.round(v.duration)) : "";
      const date = typeof v === "object" && v?.date ? v.date : "";
      if (!file) return "";
      // GitHub Pages serves the repo at the site root — use repo-relative path for src
      const src = `${studyFolder}/${file}`;
      return `<div class="voice-entry" data-vfile="${file}">
        <span class="voice-chip">🎙${dur ? " " + dur : ""}${date ? " · " + date : ""}</span>
        <audio class="voice-player" src="${src}" controls preload="none"></audio>
        <button class="voice-del btn-ghost btn-sm" data-vdel="${file}" title="Delete this recording from GitHub">🗑 Delete</button>
      </div>`;
    })
    .join("");

  return `<div class="voice-widget" data-study-folder="${studyFolder}">
    <div class="voice-list">${existingHtml}</div>
    <div class="voice-controls">
      <button class="voice-rec btn-ghost btn-sm" type="button">🎙 Record voice note</button>
      <span  class="voice-ticker" style="display:none">⏺ 0:00</span>
      <button class="voice-stop    btn-ghost btn-sm" type="button" style="display:none">■ Stop</button>
      <audio  class="voice-preview" controls preload="none" style="display:none"></audio>
      <button class="voice-upload  btn-sm"         type="button" style="display:none">☁️ Upload to GitHub</button>
      <button class="voice-discard btn-ghost btn-sm" type="button" style="display:none">✕ Discard</button>
    </div>
    <div class="voice-status" aria-live="polite"></div>
  </div>`;
}

/**
 * Binds recording / upload / delete behaviour to a rendered voice widget.
 *
 * @param {HTMLElement} root       Element that contains (or is) .voice-widget
 * @param {Function}    uploadFn   async (blob: Blob, filename: string, durationSecs: number) => void
 * @param {Function}    deleteFn   async (filename: string) => void
 * @param {Function}    onDone     Called after a successful upload or delete (use to refresh parent)
 */
export function bindVoiceWidget(root, uploadFn, deleteFn, onDone) {
  const w =
    root?.classList?.contains("voice-widget")
      ? root
      : root?.querySelector?.(".voice-widget");
  if (!w) return;

  const q        = (sel) => w.querySelector(sel);
  const recBtn   = q(".voice-rec");
  const stopBtn  = q(".voice-stop");
  const upBtn    = q(".voice-upload");
  const discBtn  = q(".voice-discard");
  const ticker   = q(".voice-ticker");
  const preview  = q(".voice-preview");
  const statusEl = q(".voice-status");

  let recorder = null, stream = null, chunks = [],
      elapsed = 0, timerHandle = null,
      pendingBlob = null, pendingName = null;

  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  function reset() {
    recBtn.style.display  = "";
    [stopBtn, upBtn, discBtn, ticker, preview].forEach((e) => { if (e) e.style.display = "none"; });
    if (preview) { URL.revokeObjectURL(preview.src); preview.src = ""; }
    clearInterval(timerHandle);
    chunks = []; pendingBlob = null; pendingName = null; elapsed = 0;
    if (upBtn) upBtn.disabled = false;
  }

  // ── Record ──────────────────────────────────────────────────────────────
  recBtn?.addEventListener("click", async () => {
    if (!isGitHubConnected()) { setStatus("Connect GitHub first (header button)."); return; }
    if (!(await isGitHubUploadAllowed())) { setStatus("Upload restricted to the repo owner."); return; }
    if (typeof MediaRecorder === "undefined") { setStatus("Your browser doesn't support MediaRecorder."); return; }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("Microphone access denied — allow microphone in browser settings.");
      return;
    }

    const mime = getSupportedMimeType();
    recorder   = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    chunks     = [];
    elapsed    = 0;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const finalMime = recorder.mimeType || "audio/webm";
      pendingBlob     = new Blob(chunks, { type: finalMime });
      pendingName     = nowFilename(mimeToExt(finalMime));
      preview.src     = URL.createObjectURL(pendingBlob);
      preview.style.display  = "";
      stopBtn.style.display  = "none";
      ticker.style.display   = "none";
      upBtn.style.display    = "";
      discBtn.style.display  = "";
      setStatus(
        `Ready to upload · ${fmtSecs(elapsed)} · ${(pendingBlob.size / 1024).toFixed(0)} KB`
      );
    };

    recorder.start(500);
    recBtn.style.display  = "none";
    stopBtn.style.display = "";
    ticker.style.display  = "";
    ticker.textContent    = "⏺ 0:00";
    setStatus("Recording… (max 10 min)");

    timerHandle = setInterval(() => {
      elapsed++;
      ticker.textContent = "⏺ " + fmtSecs(elapsed);
      if (elapsed >= MAX_SECS) {
        clearInterval(timerHandle);
        if (recorder?.state === "recording") recorder.stop();
      }
    }, 1000);
  });

  // ── Stop ────────────────────────────────────────────────────────────────
  stopBtn?.addEventListener("click", () => {
    clearInterval(timerHandle);
    if (recorder?.state === "recording") recorder.stop();
  });

  // ── Discard ─────────────────────────────────────────────────────────────
  discBtn?.addEventListener("click", () => { setStatus(""); reset(); });

  // ── Upload ──────────────────────────────────────────────────────────────
  upBtn?.addEventListener("click", async () => {
    if (!pendingBlob) return;
    upBtn.disabled = true;
    setStatus("Uploading to GitHub…");
    try {
      await uploadFn(pendingBlob, pendingName, elapsed);

      // Show recording instantly using a blob URL — no need to wait for Pages deploy.
      const blobUrl  = URL.createObjectURL(pendingBlob);
      const dur      = fmtSecs(elapsed);
      const date     = new Date().toISOString().slice(0, 10);
      const filename = pendingName;

      const entry = document.createElement("div");
      entry.className = "voice-entry";
      entry.dataset.vfile = filename;
      entry.innerHTML = `
        <span class="voice-chip">🎙 ${dur} · ${date}</span>
        <audio class="voice-player" src="${blobUrl}" controls preload="auto"></audio>
        <button class="voice-del btn-ghost btn-sm" data-vdel="${filename}" title="Delete this recording from GitHub">🗑 Delete</button>`;

      entry.querySelector("[data-vdel]")?.addEventListener("click", async (e) => {
        const btn  = e.currentTarget;
        const file = btn.dataset.vdel;
        if (!file || !confirm(`Delete this voice recording from GitHub?\n\n${file}\n\nThis cannot be undone.`)) return;
        btn.disabled = true;
        try {
          await deleteFn(file);
          URL.revokeObjectURL(blobUrl);
          entry.remove();
          setStatus("Recording deleted.");
        } catch (err) {
          alert(err.message || String(err));
          btn.disabled = false;
        }
      });

      w.querySelector(".voice-list")?.appendChild(entry);
      setStatus("Uploaded ✓");
      reset();
      onDone?.();
    } catch (err) {
      setStatus(err.message || String(err));
      upBtn.disabled = false;
    }
  });

  // ── Delete existing ──────────────────────────────────────────────────────
  w.querySelectorAll("[data-vdel]").forEach((btn) => {
    // Hide delete button for non-owners
    isGitHubUploadAllowed().then((ok) => {
      btn.style.display = ok && isGitHubConnected() ? "" : "none";
    });

    btn.addEventListener("click", async () => {
      const file = btn.dataset.vdel;
      if (
        !file ||
        !confirm(
          `Delete this voice recording from GitHub?\n\n${file}\n\nThis removes the file from the repo and cannot be undone.`
        )
      )
        return;

      btn.disabled = true;
      try {
        await deleteFn(file);
        btn.closest(".voice-entry")?.remove();
        setStatus("Recording deleted from GitHub.");
        onDone?.();
      } catch (err) {
        alert(err.message || String(err));
        btn.disabled = false;
      }
    });
  });
}
