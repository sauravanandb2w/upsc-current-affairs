/**
 * In-browser voice recorder widget — record, preview, upload to GitHub, delete.
 *
 * Usage:
 *   import { renderVoiceWidget, bindVoiceWidget } from "./voice-recorder.js";
 *
 *   html += renderVoiceWidget("study/items/" + itemId, []);
 *
 *   bindVoiceWidget(containerEl,
 *     (blob, name, secs) => uploadCaItemVoice(itemId, blob, name, secs, manifest),
 *     (name)             => deleteCaItemVoice(itemId, name, manifest),
 *     ()                 => fetchCaItemVoices(itemId)   // loads existing on bind
 *   );
 */

import { isGitHubConnected, isGitHubUploadAllowed } from "./github-auth.js";

const MAX_SECS = 10 * 60;

function getSupportedMimeType() {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function mimeToExt(mime) {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  return ".webm";
}

export function fmtSecs(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function nowFilename(ext) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 15);
  return `voice-${ts}${ext}`;
}

/**
 * Returns the HTML string for the voice widget.
 * Pass an empty array for voices — existing voices are loaded async by bindVoiceWidget.
 */
export function renderVoiceWidget(studyFolder, _voices = []) {
  return `<div class="voice-widget" data-study-folder="${studyFolder}">
    <div class="voice-list"></div>
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
 * Binds all behaviour to a rendered voice widget.
 *
 * @param {HTMLElement} root        Element that contains (or is) .voice-widget
 * @param {Function}    uploadFn    async (blob, filename, durationSecs) => void
 * @param {Function}    deleteFn    async (filename) => void
 * @param {Function}   [fetchFn]   async () => Array<{file,duration,date}|string>
 *                                  Called on bind to populate existing voices from manifest.
 */
export function bindVoiceWidget(root, uploadFn, deleteFn, fetchFn) {
  const w = root?.classList?.contains("voice-widget")
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
    recBtn.style.display = "";
    [stopBtn, upBtn, discBtn, ticker, preview].forEach((e) => { if (e) e.style.display = "none"; });
    if (preview) { URL.revokeObjectURL(preview.src); preview.src = ""; }
    clearInterval(timerHandle);
    chunks = []; pendingBlob = null; pendingName = null; elapsed = 0;
    if (upBtn) upBtn.disabled = false;
  }

  /** Create and append a voice entry to the list, binding its delete button */
  function addEntryToList(file, audioSrc, dur, date, isBlobUrl = false) {
    const existing = w.querySelector(`.voice-entry[data-vfile="${CSS.escape(file)}"]`);
    if (existing) return; // already rendered
    const entry = document.createElement("div");
    entry.className = "voice-entry";
    entry.dataset.vfile = file;
    entry.innerHTML = `
      <span class="voice-chip">🎙${dur ? " " + dur : ""}${date ? " · " + date : ""}</span>
      <audio class="voice-player" src="${audioSrc}" controls preload="${isBlobUrl ? "auto" : "none"}"></audio>
      <button class="voice-del btn-ghost btn-sm" data-vdel="${file}" title="Delete this recording from GitHub">🗑 Delete</button>`;
    entry.querySelector("[data-vdel]")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (!confirm(`Delete this recording from GitHub?\n\n${file}\n\nThis cannot be undone.`)) return;
      btn.disabled = true;
      try {
        await deleteFn(file);
        if (isBlobUrl) URL.revokeObjectURL(audioSrc);
        entry.remove();
        setStatus("Deleted.");
      } catch (err) {
        alert(err.message || String(err));
        btn.disabled = false;
      }
    });
    w.querySelector(".voice-list")?.appendChild(entry);
  }

  // ── Load existing voices from manifest (async, non-blocking) ────────────
  if (typeof fetchFn === "function" && isGitHubConnected()) {
    setStatus("Loading…");
    fetchFn().then((voices) => {
      setStatus("");
      if (!voices?.length) return;
      const studyFolder = w.dataset.studyFolder || "";
      voices.forEach((v) => {
        const file = typeof v === "string" ? v : v?.file;
        if (!file) return;
        const src  = studyFolder ? `${studyFolder}/${file}` : file;
        const dur  = typeof v === "object" && v?.duration != null ? fmtSecs(Math.round(v.duration)) : "";
        const date = typeof v === "object" && v?.date ? v.date : "";
        addEntryToList(file, src, dur, date, false);
      });
    }).catch(() => setStatus(""));
  }

  // ── Record ───────────────────────────────────────────────────────────────
  recBtn?.addEventListener("click", async () => {
    if (!isGitHubConnected()) { setStatus("Connect GitHub first (header button)."); return; }
    if (!(await isGitHubUploadAllowed())) { setStatus("Upload restricted to repo owner."); return; }
    if (typeof MediaRecorder === "undefined") { setStatus("MediaRecorder not supported in this browser."); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("Microphone access denied — allow it in browser settings.");
      return;
    }
    const mime = getSupportedMimeType();
    recorder   = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    chunks = []; elapsed = 0;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const finalMime = recorder.mimeType || "audio/webm";
      pendingBlob     = new Blob(chunks, { type: finalMime });
      pendingName     = nowFilename(mimeToExt(finalMime));
      preview.src     = URL.createObjectURL(pendingBlob);
      preview.style.display = "";
      stopBtn.style.display = "none";
      ticker.style.display  = "none";
      upBtn.style.display   = "";
      discBtn.style.display = "";
      setStatus(`Ready · ${fmtSecs(elapsed)} · ${(pendingBlob.size / 1024).toFixed(0)} KB`);
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
      if (elapsed >= MAX_SECS) { clearInterval(timerHandle); recorder?.stop(); }
    }, 1000);
  });

  // ── Stop ─────────────────────────────────────────────────────────────────
  stopBtn?.addEventListener("click", () => {
    clearInterval(timerHandle);
    if (recorder?.state === "recording") recorder.stop();
  });

  // ── Discard ──────────────────────────────────────────────────────────────
  discBtn?.addEventListener("click", () => { setStatus(""); reset(); });

  // ── Upload ───────────────────────────────────────────────────────────────
  upBtn?.addEventListener("click", async () => {
    if (!pendingBlob) return;
    upBtn.disabled = true;
    setStatus("Uploading…");
    const blobForEntry = pendingBlob; // capture before reset clears it
    const nameForEntry = pendingName;
    const durForEntry  = elapsed;
    try {
      await uploadFn(blobForEntry, nameForEntry, durForEntry);
      // Inject immediately using blob URL — no page reload needed
      const blobUrl = URL.createObjectURL(blobForEntry);
      addEntryToList(
        nameForEntry,
        blobUrl,
        fmtSecs(durForEntry),
        new Date().toISOString().slice(0, 10),
        true
      );
      setStatus("Uploaded ✓");
      reset();
      // NOTE: no onDone/re-render — re-rendering would destroy the injected entry
    } catch (err) {
      setStatus(err.message || String(err));
      upBtn.disabled = false;
    }
  });
}
