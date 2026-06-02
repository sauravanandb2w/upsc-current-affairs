/** Mini calendar for uniform ISO dates (YYYY-MM-DD) across the app. */

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

export function parseIso(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date();
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayIso() {
  return toIso(new Date());
}

export function isValidIsoDate(iso) {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

/** Best date for an item — manifest date, or YYYY-MM-DD prefix from item id. */
export function effectiveItemDate(item) {
  if (isValidIsoDate(item?.date)) return item.date;
  const m = String(item?.id || "").match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : "";
}

/** Uniform display: 2 Jun 2026 */
export function formatDisplayDate(iso) {
  if (!isValidIsoDate(iso)) return "Date not set";
  return parseIso(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Uniform month display: June 2026 */
export function formatDisplayMonth(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(String(ym))) return "Pick month";
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function isBeforeMin(iso, minDate) {
  return minDate && iso < minDate;
}

function isAfterMax(iso, maxDate) {
  return maxDate && iso > maxDate;
}

/**
 * @param {HTMLElement} container
 * @param {{ value?: string, onChange?: (iso: string) => void, maxDate?: string|null, minDate?: string|null, compact?: boolean, showSelectedLine?: boolean }} opts
 */
export function mountDatePicker(
  container,
  { value = todayIso(), onChange, maxDate = null, minDate = null, compact = false, showSelectedLine = true } = {}
) {
  if (!container) return null;

  container.classList.add("date-picker");
  if (compact) container.classList.add("date-picker--compact");

  let viewDate = parseIso(value);
  let selected = value || todayIso();

  function render() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startPad = first.getDay();
    const daysInMonth = last.getDate();

    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push({ empty: true });
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = toIso(new Date(y, m, d, 12, 0, 0, 0));
      cells.push({
        day: d,
        iso,
        isToday: iso === todayIso(),
        isSelected: iso === selected,
        isDisabled: isBeforeMin(iso, minDate) || isAfterMax(iso, maxDate),
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
                c.isDisabled ? "date-picker-cell--disabled" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `<button type="button" class="${cls}" data-iso="${c.iso}" ${c.isDisabled ? "disabled" : ""} aria-pressed="${c.isSelected}">${c.day}</button>`;
            })
            .join("")}
        </div>
        ${
          showSelectedLine
            ? `<p class="date-picker-selected">${formatDisplayDate(selected)} <span class="date-picker-iso">(${selected})</span></p>`
            : ""
        }
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
      selected = iso || todayIso();
      viewDate = parseIso(selected);
      render();
    },
  };
}

/**
 * Hidden ISO input + calendar (inline or popover trigger).
 * @param {HTMLElement} container
 */
export function mountDateField(
  container,
  {
    value = todayIso(),
    onChange,
    maxDate = null,
    minDate = null,
    compact = true,
    popover = false,
  } = {}
) {
  if (!container) return null;

  container.classList.add("date-field-mount");
  const start = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();

  if (popover) {
    container.innerHTML = `
      <input type="hidden" class="date-field-value" value="${start}" />
      <button type="button" class="date-field-trigger" aria-haspopup="dialog">${formatDisplayDate(start)}</button>
      <div class="date-field-popover hidden" role="dialog"></div>`;

    const hidden = container.querySelector(".date-field-value");
    const trigger = container.querySelector(".date-field-trigger");
    const pop = container.querySelector(".date-field-popover");
    let pickerApi = null;

    const close = () => pop.classList.add("hidden");
    const open = () => {
      pop.classList.remove("hidden");
      if (!pickerApi) {
        pickerApi = mountDatePicker(pop, {
          value: hidden.value,
          maxDate,
          minDate,
          compact: true,
          showSelectedLine: false,
          onChange(iso) {
            hidden.value = iso;
            trigger.textContent = formatDisplayDate(iso);
            onChange?.(iso);
            close();
          },
        });
      } else {
        pickerApi.setValue(hidden.value);
      }
    };

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop.classList.contains("hidden")) open();
      else close();
    });

    const onDocClick = (e) => {
      if (!container.contains(e.target)) close();
    };
    document.addEventListener("click", onDocClick);

    return {
      getValue: () => hidden.value,
      setValue(iso) {
        hidden.value = iso;
        trigger.textContent = formatDisplayDate(iso);
        pickerApi?.setValue(iso);
      },
      destroy() {
        document.removeEventListener("click", onDocClick);
      },
    };
  }

  container.innerHTML = `
    <input type="hidden" class="date-field-value" value="${start}" />
    <div class="date-field-inline"></div>`;

  const hidden = container.querySelector(".date-field-value");
  const inline = container.querySelector(".date-field-inline");
  const pickerApi = mountDatePicker(inline, {
    value: start,
    maxDate,
    minDate,
    compact,
    onChange(iso) {
      hidden.value = iso;
      onChange?.(iso);
    },
  });

  return {
    getValue: () => hidden.value || pickerApi.getValue(),
    setValue(iso) {
      hidden.value = iso;
      pickerApi.setValue(iso);
    },
    destroy() {},
  };
}

/**
 * Month picker (YYYY-MM) with same nav style as calendar.
 * @param {HTMLElement} container
 */
export function mountMonthPicker(container, { value = todayIso().slice(0, 7), onChange } = {}) {
  if (!container) return null;

  container.classList.add("month-picker-mount");
  let year = Number(String(value).slice(0, 4)) || new Date().getFullYear();
  let month = Number(String(value).slice(5, 7)) || new Date().getMonth() + 1;

  const emit = () => {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    onChange?.(ym);
    return ym;
  };

  function render() {
    const label = formatDisplayMonth(`${year}-${String(month).padStart(2, "0")}`);
    container.innerHTML = `
      <div class="month-picker">
        <button type="button" class="date-picker-nav month-picker-nav" data-nav="-1" aria-label="Previous month">‹</button>
        <span class="month-picker-label">${label}</span>
        <button type="button" class="date-picker-nav month-picker-nav" data-nav="1" aria-label="Next month">›</button>
      </div>
      <p class="date-picker-selected month-picker-iso">${year}-${String(month).padStart(2, "0")}</p>`;

    container.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        month += Number(btn.dataset.nav);
        if (month < 1) {
          month = 12;
          year -= 1;
        } else if (month > 12) {
          month = 1;
          year += 1;
        }
        emit();
        render();
      });
    });
  }

  render();

  return {
    getValue: () => `${year}-${String(month).padStart(2, "0")}`,
    setValue(ym) {
      year = Number(ym.slice(0, 4));
      month = Number(ym.slice(5, 7));
      render();
    },
  };
}
