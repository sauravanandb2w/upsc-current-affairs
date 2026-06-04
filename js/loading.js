/** Global loading overlay — use for any slow async action before alerts/navigation. */

let depth = 0;
let creepTimer = null;
let ui = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureUi() {
  if (ui) return ui;
  let overlay = document.getElementById("caLoadingOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "caLoadingOverlay";
    overlay.className = "ca-loading hidden";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="ca-loading-card" role="status" aria-live="polite">
        <div class="ca-loading-spinner" aria-hidden="true"></div>
        <p class="ca-loading-label" id="caLoadingLabel">Loading…</p>
        <div class="ca-loading-bar-wrap" aria-hidden="true">
          <div class="ca-loading-bar" id="caLoadingBar"></div>
        </div>
        <p class="ca-loading-pct" id="caLoadingPct">0%</p>
      </div>`;
    document.body.appendChild(overlay);
  }
  ui = {
    overlay,
    label: overlay.querySelector("#caLoadingLabel"),
    bar: overlay.querySelector("#caLoadingBar"),
    pct: overlay.querySelector("#caLoadingPct"),
  };
  return ui;
}

function stopCreep() {
  if (creepTimer) {
    clearInterval(creepTimer);
    creepTimer = null;
  }
}

function readProgress() {
  const w = parseFloat(ui?.bar?.style.width || "0");
  return Number.isFinite(w) ? w : 0;
}

function startCreep() {
  stopCreep();
  creepTimer = setInterval(() => {
    const cur = readProgress();
    if (cur >= 90) return;
    const bump = cur < 40 ? 4 : cur < 70 ? 2 : 1;
    setLoadingProgress(Math.min(90, cur + bump));
  }, 220);
}

export function setLoadingLabel(label) {
  const { label: el } = ensureUi();
  if (el) el.textContent = String(label || "Loading…");
}

export function setLoadingProgress(percent, label) {
  const parts = ensureUi();
  const n = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (parts.bar) parts.bar.style.width = `${n}%`;
  if (parts.pct) parts.pct.textContent = `${n}%`;
  if (label != null) setLoadingLabel(label);
}

export function showLoading(label = "Loading…", { progress = null } = {}) {
  const parts = ensureUi();
  depth += 1;
  parts.overlay.classList.remove("hidden");
  parts.overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("ca-loading-active");
  setLoadingLabel(label);
  if (progress != null) {
    stopCreep();
    setLoadingProgress(progress);
  } else {
    setLoadingProgress(8);
    startCreep();
  }
}

export function hideLoading() {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;
  stopCreep();
  const parts = ensureUi();
  parts.overlay.classList.add("hidden");
  parts.overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("ca-loading-active");
  setLoadingProgress(0);
}

/**
 * Run async work under the global loading overlay.
 * @param {string} label
 * @param {() => Promise<any>} fn
 * @param {{ steps?: { label?: string, run: () => Promise<any> }[], button?: HTMLButtonElement }} opts
 */
export async function withLoading(label, fn, opts = {}) {
  const { steps, button } = opts;
  const prevBtn =
    button instanceof HTMLButtonElement
      ? { disabled: button.disabled, text: button.textContent }
      : null;
  if (prevBtn) button.disabled = true;

  try {
    if (steps?.length) {
      showLoading(steps[0].label || label, { progress: 0 });
      let lastResult;
      const slice = 100 / steps.length;
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        setLoadingProgress(Math.round(i * slice), step.label || label);
        lastResult = await step.run();
        setLoadingProgress(Math.round((i + 1) * slice), step.label || label);
      }
      setLoadingProgress(100, "Done");
      await sleep(140);
      return lastResult;
    }

    showLoading(label);
    const result = await fn();
    stopCreep();
    setLoadingProgress(100, "Done");
    await sleep(140);
    return result;
  } finally {
    hideLoading();
    if (prevBtn && button) {
      button.disabled = prevBtn.disabled;
      button.textContent = prevBtn.text;
    }
  }
}
