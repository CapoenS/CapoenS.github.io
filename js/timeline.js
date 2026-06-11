/**
 * timeline.js — renders the strata ribbon, time axis and species lanes,
 * and handles all interaction (wheel zoom, drag pan, click to focus).
 *
 * The Timeline owns one piece of state: the visible window
 *   view = { startMa, endMa }   (startMa > endMa; oldest on the left)
 * Everything is re-rendered from data + view, so adding features later
 * (more lanes, event markers, ...) means adding a render*() method.
 */

import { clamp, formatMa, niceTickStep } from "./utils.js";

const FULL_VIEW = { startMa: 4600, endMa: 0 };
const MIN_SPAN_MA = 0.5;        // max zoom-in
const ZOOM_FACTOR = 1.25;       // per wheel notch
const DEFAULT_BAR_COLOR = "#f0b95a";

export class Timeline {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root            — .timeline container
   * @param {Array} opts.periods               — from periods.json
   * @param {Array} opts.species               — from species.json
   * @param {(period|null) => void} opts.onPeriodFocus — fired on focus change
   * @param {(species) => void} opts.onSpeciesClick
   */
  constructor({ root, periods, species, onPeriodFocus, onSpeciesClick }) {
    this.root = root;
    this.ribbonEl = root.querySelector("#period-ribbon");
    this.axisEl = root.querySelector("#time-axis");
    this.lanesEl = root.querySelector("#species-lanes");
    this.presentEl = root.querySelector("#present-marker");

    this.periods = periods;
    this.species = species;
    this.periodById = new Map(periods.map((p) => [p.id, p]));

    this.onPeriodFocus = onPeriodFocus;
    this.onSpeciesClick = onSpeciesClick;

    this.view = { ...FULL_VIEW };
    this.focusedPeriodId = null;

    this.#bindInteraction();
    window.addEventListener("resize", () => this.render());
  }

  /* ================= public API ================= */

  /** Animate/snap the view to a given Ma range. */
  setView(startMa, endMa) {
    const span = Math.max(startMa - endMa, MIN_SPAN_MA);
    this.view = {
      startMa: clamp(startMa, span, FULL_VIEW.startMa),
      endMa: clamp(endMa, 0, FULL_VIEW.startMa - span),
    };
    this.render();
  }

  /** Zoom to a period (with a little breathing room) and mark it focused. */
  focusPeriod(periodId) {
    const p = this.periodById.get(periodId);
    if (!p) return;
    const pad = (p.startMa - p.endMa) * 0.08;
    this.focusedPeriodId = periodId;
    this.setView(p.startMa + pad, Math.max(0, p.endMa - pad));
    this.onPeriodFocus?.(p);
  }

  /** Back to the full 4.6-billion-year view. */
  reset() {
    this.focusedPeriodId = null;
    this.setView(FULL_VIEW.startMa, FULL_VIEW.endMa);
    this.onPeriodFocus?.(null);
  }

  /* ================= rendering ================= */

  render() {
    this.#renderRibbon();
    this.#renderAxis();
    this.#renderSpecies();
    this.#renderPresentMarker();
  }

  /** Map a time (Ma) to a horizontal fraction [0..1] of the view. */
  #xFrac(ma) {
    const { startMa, endMa } = this.view;
    return (startMa - ma) / (startMa - endMa);
  }

  #renderRibbon() {
    this.ribbonEl.innerHTML = "";
    for (const p of this.periods) {
      const left = this.#xFrac(p.startMa);
      const right = this.#xFrac(p.endMa);
      if (right < 0 || left > 1) continue; // outside the view

      const band = document.createElement("button");
      band.className = "period-band";
      band.style.left = `${clamp(left, 0, 1) * 100}%`;
      band.style.width = `${(clamp(right, 0, 1) - clamp(left, 0, 1)) * 100}%`;
      band.style.background = p.color ?? "#666";
      band.title = `${p.name} · ${formatMa(p.startMa)} – ${formatMa(p.endMa)} · click to focus`;
      band.dataset.periodId = p.id;
      if (p.id === this.focusedPeriodId) band.classList.add("focused");

      // Only label bands wide enough to fit text.
      const widthPx = (clamp(right, 0, 1) - clamp(left, 0, 1)) * this.ribbonEl.clientWidth;
      if (widthPx > p.name.length * 8 + 16) {
        const label = document.createElement("span");
        label.className = "band-label";
        label.textContent = p.name;
        band.appendChild(label);
      }

      band.addEventListener("click", () => this.focusPeriod(p.id));
      this.ribbonEl.appendChild(band);
    }
  }

  #renderAxis() {
    this.axisEl.innerHTML = "";
    const { startMa, endMa } = this.view;
    const step = niceTickStep(startMa - endMa);
    const first = Math.floor(startMa / step) * step;

    for (let ma = first; ma >= endMa; ma -= step) {
      const frac = this.#xFrac(ma);
      if (frac < 0 || frac > 1) continue;
      const tick = document.createElement("div");
      tick.className = "axis-tick";
      tick.style.left = `${frac * 100}%`;
      tick.textContent = formatMa(Math.round(ma * 1000) / 1000);
      this.axisEl.appendChild(tick);
    }
  }

  #renderSpecies() {
    this.lanesEl.innerHTML = "";
    const visible = this.species.filter(
      (s) => s.startMa >= this.view.endMa && s.endMa <= this.view.startMa
    );

    // Greedy lane assignment so overlapping lifespans stack vertically.
    const laneEnds = []; // per lane: smallest endMa placed so far
    const laneHeight = this.#cssNum("--lane-height", 30);
    const laneGap = this.#cssNum("--lane-gap", 6);

    for (const s of visible) {
      let lane = laneEnds.findIndex((end) => s.startMa < end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(Infinity);
      }
      laneEnds[lane] = s.endMa;

      const left = clamp(this.#xFrac(s.startMa), 0, 1);
      const right = clamp(this.#xFrac(s.endMa), 0, 1);

      const bar = document.createElement("button");
      bar.className = "species-bar";
      bar.style.left = `${left * 100}%`;
      bar.style.width = `max(${(right - left) * 100}%, 12px)`; // always clickable
      bar.style.top = `${lane * (laneHeight + laneGap)}px`;
      bar.style.borderLeftColor =
        this.periodById.get(s.periodId)?.color ?? DEFAULT_BAR_COLOR;
      bar.textContent = s.name;
      bar.title = `${s.name} · ${formatMa(s.startMa)} – ${formatMa(s.endMa)}`;
      bar.addEventListener("click", () => this.onSpeciesClick?.(s));
      this.lanesEl.appendChild(bar);
    }

    this.lanesEl.style.height = `${Math.max(laneEnds.length, 1) * (laneHeight + laneGap)}px`;
  }

  #renderPresentMarker() {
    const frac = this.#xFrac(0);
    const show = frac >= 0 && frac <= 1;
    this.presentEl.style.display = show ? "block" : "none";
    if (show) {
      this.presentEl.style.right = "auto";
      this.presentEl.style.left = `${frac * 100}%`;
    }
  }

  #cssNum(varName, fallback) {
    const v = parseFloat(getComputedStyle(this.root).getPropertyValue(varName));
    return Number.isFinite(v) ? v : fallback;
  }

  /* ================= interaction ================= */

  #bindInteraction() {
    // Wheel: zoom, centered on the cursor.
    this.root.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = this.root.getBoundingClientRect();
        const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const { startMa, endMa } = this.view;
        const cursorMa = startMa - frac * (startMa - endMa);

        const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const newSpan = clamp(
          (startMa - endMa) * factor,
          MIN_SPAN_MA,
          FULL_VIEW.startMa
        );
        this.setView(cursorMa + frac * newSpan, cursorMa - (1 - frac) * newSpan);
      },
      { passive: false }
    );

    // Drag: pan. (Click events on bands/bars still fire if there was no drag.)
    let dragging = false;
    let lastX = 0;
    this.root.addEventListener("pointerdown", (e) => {
      dragging = true;
      lastX = e.clientX;
      this.root.classList.add("dragging");
    });
    window.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      if (Math.abs(dx) < 1) return;
      lastX = e.clientX;
      const { startMa, endMa } = this.view;
      const maPerPx = (startMa - endMa) / this.root.clientWidth;
      this.setView(startMa + dx * maPerPx, endMa + dx * maPerPx);
    });
    window.addEventListener("pointerup", () => {
      dragging = false;
      this.root.classList.remove("dragging");
    });
  }
}
