/** Mini month calendar for Add CA and other date fields. */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseIso(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date();
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayIso() {
  return toIso(new Date());
}

/**
 * @param {HTMLElement} container
 * @param {{ value?: string, onChange?: (iso: string) => void, maxDate?: string }} opts
 */
export function mountDatePicker(container, { value = todayIso(), onChange, maxDate } = {}) {
  if (!container) return () => {};

  let viewDate = parseIso(value);
  let selected = value || todayIso();
  const max = maxDate || todayIso();

  function render() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startPad = first.getDay();
    const daysInMonth = last.getDate();

    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push({ empty: true });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toIso(new Date(y, m, d, 12, 0, 0, 0));
      cells.push({
        day: d,
        iso,
        isToday: iso === todayIso(),
        isSelected: iso === selected,
        isFuture: iso > max,
      });
    }

    container.innerHTML = `
      <div class="date-picker-inner">
        <div class="date-picker-head">
          <button type="button" class="date-picker-nav" data-nav="-1" aria-label="Previous month">‹</button>
          <span class="date-picker-title">${MONTHS[m]} ${y}</span>
          <button type="button" class="date-picker-nav" data-nav="1" aria-label="Next month">›</button>
        </div>
        <div class="date-picker-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="date-picker-grid" role="grid" aria-label="Calendar">
          ${cells
            .map((c) => {
              if (c.empty) return `<span class="date-picker-cell date-picker-cell--empty" aria-hidden="true"></span>`;
              const cls = [
                "date-picker-cell",
                c.isSelected ? "date-picker-cell--selected" : "",
                c.isToday ? "date-picker-cell--today" : "",
                c.isFuture ? "date-picker-cell--disabled" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `<button type="button" class="${cls}" data-iso="${c.iso}" ${c.isFuture ? "disabled" : ""} aria-pressed="${c.isSelected}">${c.day}</button>`;
            })
            .join("")}
        </div>
        <p class="date-picker-selected">Selected: <strong>${selected}</strong></p>
      </div>`;

    container.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewDate.setMonth(viewDate.getMonth() + Number(btn.dataset.nav));
        render();
      });
    });

    container.querySelectorAll("[data-iso]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selected = btn.dataset.iso;
        onChange?.(selected);
        render();
      });
    });
  }

  render();

  return {
    getValue: () => selected,
    setValue(iso) {
      selected = iso;
      viewDate = parseIso(iso);
      render();
    },
  };
}
