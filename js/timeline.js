/**
 * timeline.js — renders the strata ribbon, time axis and species lanes,
 * and handles all interaction (wheel zoom, drag pan, click to focus).
 *
 * The Timeline owns one piece of state: the visible window
 *   view = { startMa, endMa }   (startMa > endMa; oldest on the left)
 * Everything is re-rendered from data + view, so adding features later
 * (more lanes, event markers, ...) means adding a render*() method.
 */

import { clamp, formatMa, niceTickStep, unitForMa } from "./utils.js";

const FULL_VIEW = { startMa: 4600, endMa: 0 };
const MIN_SPAN_MA = 0.5;        // max zoom-in
const ZOOM_FACTOR = 1.25;       // per wheel notch
const DEFAULT_BAR_COLOR = "#f0b95a";

// Stacked ribbon rows, top to bottom. Each maps to a unit `rank`.
const RANK_ROWS = ["eon", "era", "period"];

export class Timeline {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root            — .timeline container
   * @param {Array} opts.periods               — from periods.json
   * @param {Array} opts.species               — from species.json
   * @param {(period|null) => void} opts.onPeriodFocus — fired on focus change
   * @param {(species) => void} opts.onSpeciesClick
   */
  constructor({ root, periods, species, events, onPeriodFocus, onSpeciesClick, onEventShow, onEventHide, onEventOpen, onViewChange }) {
    this.root = root;
    this.ribbonEl = root.querySelector("#period-ribbon");
    this.axisEl = root.querySelector("#time-axis");
    this.lanesEl = root.querySelector("#species-lanes");
    this.presentEl = root.querySelector("#present-marker");
    this.meEl = root.querySelector("#me-marker");
    this.eventsEl = root.querySelector("#event-markers");
    this.bigbangEl = root.querySelector("#bigbang");

    this.periods = periods;
    this.species = species;
    this.events = events ?? [];
    this.periodById = new Map(periods.map((p) => [p.id, p]));

    this.onPeriodFocus = onPeriodFocus;
    this.onSpeciesClick = onSpeciesClick;
    this.onEventShow = onEventShow;
    this.onEventHide = onEventHide;
    this.onEventOpen = onEventOpen;
    this.onViewChange = onViewChange; // fired after every render (pan/zoom/Journey) for the atmosphere + parallax

    this.view = { ...FULL_VIEW };
    this.focusedPeriodId = null;
    this.interactive = true; // set false while the guided journey drives the view

    // The axis normally tops out at Earth's formation (4.6 Ga). Revealing the cosmos
    // raises the ceiling to the Big Bang (13.8 Ga); the realm gate keeps cosmic units
    // hidden until then. Defaults leave the Earth experience untouched.
    this.maxMa = FULL_VIEW.startMa;
    this.realm = "earth"; // "earth" | "cosmos"

    // Which ribbon rows (by rank) are visible. All on by default.
    this.rankVisible = { eon: true, era: true, period: true };

    this.#refreshMetrics();
    this.#bindInteraction();
    window.addEventListener("resize", () => {
      this.#refreshMetrics();
      this.render();
    });
  }

  /**
   * Cache layout metrics that only change on resize (or rank toggles), so the
   * per-frame render loop doesn't interleave layout reads with DOM writes.
   */
  #refreshMetrics() {
    this._laneHeight = this.#cssNum("--lane-height", 30);
    this._laneGap = this.#cssNum("--lane-gap", 6);
    this._axisTop = null; // recomputed after the next ribbon render (its height may change)
  }

  /* ================= public API ================= */

  /** Animate/snap the view to a given Ma range. */
  setView(startMa, endMa) {
    const span = Math.max(startMa - endMa, MIN_SPAN_MA);
    this.view = {
      startMa: clamp(startMa, span, this.maxMa),
      endMa: clamp(endMa, 0, this.maxMa - span),
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

  /** Frame a species' lifespan and focus its period (panel + background + audio). */
  focusSpecies(speciesId) {
    const s = this.species.find((x) => x.id === speciesId);
    if (!s) return;
    const life = Math.max(s.startMa - s.endMa, 0);
    const span = Math.max(life * 3, 12); // context around short / point lifespans
    const center = (s.startMa + s.endMa) / 2;
    const period = this.periodById.get(s.periodId);
    if (period) this.focusedPeriodId = period.id; // band renders as focused
    this.setView(center + span / 2, center - span / 2); // re-renders
    this.onPeriodFocus?.(period ?? null); // panel + background + audio
    this.#flashSpecies(speciesId); // brief highlight on the bar
  }

  /** Briefly highlight a species bar (e.g. after navigating to it from a list). */
  #flashSpecies(speciesId) {
    const bar = this.lanesEl.querySelector(`[data-species-id="${CSS.escape(speciesId)}"]`);
    if (!bar) return;
    bar.classList.add("flash");
    setTimeout(() => bar.classList.remove("flash"), 1600);
  }

  /** Frame an event's time, focus the unit it falls in, and flash its marker. */
  focusEvent(eventId) {
    const ev = this.events.find((e) => e.id === eventId);
    if (!ev) return;
    const unit = this.#unitContaining(ev.ma);
    if (unit) {
      this.focusPeriod(unit.id); // frames + focuses + fires onPeriodFocus
    } else {
      this.focusedPeriodId = null;
      this.setView(ev.ma + 50, Math.max(0, ev.ma - 50));
      this.onPeriodFocus?.(null);
    }
    this.#flashEvent(eventId);
  }

  /** The most specific unit (smallest span) whose range contains a given Ma. */
  #unitContaining(ma) {
    return unitForMa(this.periods, ma);
  }

  /** Briefly highlight an event marker after navigating to it from a list. */
  #flashEvent(eventId) {
    const marker = this.eventsEl?.querySelector(`[data-event-id="${CSS.escape(eventId)}"]`);
    if (!marker) return;
    marker.classList.add("flash");
    setTimeout(() => marker.classList.remove("flash"), 1600);
  }

  /** Back to the full 4.6-billion-year view. */
  reset() {
    this.focusedPeriodId = null;
    this.setView(FULL_VIEW.startMa, FULL_VIEW.endMa);
    this.onPeriodFocus?.(null);
  }

  /** Show or hide a ribbon row by rank ("eon" | "era" | "period"). */
  setRankVisible(rank, visible) {
    if (rank in this.rankVisible) {
      this.rankVisible[rank] = visible;
      this._axisTop = null; // ribbon height changes → re-measure the axis offset
      this.render();
    }
  }

  /** Raise/lower the oldest viewable edge (4600 = Earth only; 13800 = back to the Big Bang). */
  setMaxMa(maxMa) {
    this.maxMa = maxMa;
    this.render();
  }

  /** Switch realm ("earth" hides cosmic units; "cosmos" reveals them). */
  setRealm(realm) {
    this.realm = realm;
    this.render();
  }

  /* ================= rendering ================= */

  render() {
    // Batch every layout read up front, before any DOM writes. At the start of a
    // frame layout is clean (nothing written since the last paint), so these reads
    // don't force a reflow — unlike the old pattern of reading widths between the
    // per-layer rebuilds below.
    this._m = {
      ribbonW: this.ribbonEl.clientWidth,
      lanesW: this.lanesEl.clientWidth,
      eventsW: this.eventsEl?.clientWidth || this.root.clientWidth,
    };
    this.#renderRibbon();
    this.#renderCosmosWash(); // after the ribbon: #renderRibbon clears ribbonEl, then we prepend the wash behind the rows
    // The events layer aligns to the axis row; the axis offset only moves when the
    // ribbon's row count changes (rank toggle) or on resize — both invalidate it.
    if (this._axisTop == null) this._axisTop = this.axisEl.offsetTop;
    this.#renderAxis();
    this.#renderSpecies();
    this.#renderEvents();
    this.#renderPresentMarker();
    this.#renderMeMarker();
    this.#renderSeam();
    this.#renderBigBang();
    this.onViewChange?.(this.view);
  }

  /** Map a time (Ma) to a horizontal fraction [0..1] of the view. */
  #xFrac(ma) {
    const { startMa, endMa } = this.view;
    return (startMa - ma) / (startMa - endMa);
  }

  #renderRibbon() {
    this.ribbonEl.innerHTML = "";
    const ribbonWidth = this._m.ribbonW;
    const rows = document.createDocumentFragment();

    // On the cosmos side of the 4.6 Ga seam, the finest tier is an "epoch" (cosmology
    // term), not a geologic "period"; eon/era read fine for both realms.
    const cosmosSide =
      this.realm === "cosmos" &&
      (this.view.startMa + this.view.endMa) / 2 > FULL_VIEW.startMa;
    const tagText = { eon: "EON", era: "ERA", period: cosmosSide ? "EPOCH" : "PERIOD" };

    // One stacked row per visible rank (eon on top, period at the bottom).
    for (const rank of RANK_ROWS) {
      if (!this.rankVisible[rank]) continue;

      const row = document.createElement("div");
      row.className = `ribbon-row ribbon-row-${rank}`;

      // Left-edge tag so people know which row is which rank.
      const tag = document.createElement("span");
      tag.className = "ribbon-row-tag";
      tag.textContent = tagText[rank];
      row.appendChild(tag);

      for (const p of this.periods) {
        if (p.rank !== rank) continue;
        if (this.realm === "earth" && p.realm === "cosmos") continue; // cosmos hidden until revealed

        const left = this.#xFrac(p.startMa);
        const right = this.#xFrac(p.endMa);
        if (right < 0 || left > 1) continue; // outside the view

        const band = document.createElement("button");
        band.className = "period-band";
        band.style.left = `${clamp(left, 0, 1) * 100}%`;
        band.style.width = `${(clamp(right, 0, 1) - clamp(left, 0, 1)) * 100}%`;
        // Cosmic bands are transparent label/hit-areas over the gradient wash (no hard
        // block edges); Earth bands keep their solid ICS colour.
        if (p.realm === "cosmos") band.classList.add("cosmos");
        else band.style.background = p.color ?? "#666";
        band.style.setProperty("--band-color", p.color ?? "#666");
        band.title = `${p.name} · ${formatMa(p.startMa)} – ${formatMa(p.endMa)} · click to focus`;
        band.dataset.periodId = p.id;
        if (p.id === this.focusedPeriodId) band.classList.add("focused");

        // Only label bands wide enough to fit text.
        const widthPx = (clamp(right, 0, 1) - clamp(left, 0, 1)) * ribbonWidth;
        if (widthPx > p.name.length * 8 + 16) {
          const label = document.createElement("span");
          label.className = "band-label";
          label.textContent = p.name;
          band.appendChild(label);
        }

        band.addEventListener("click", () => this.focusPeriod(p.id));
        row.appendChild(band);
      }

      rows.appendChild(row);
    }
    this.ribbonEl.appendChild(rows);
  }

  #renderAxis() {
    this.axisEl.innerHTML = "";
    const { startMa, endMa } = this.view;
    const step = niceTickStep(startMa - endMa);
    const first = Math.floor(startMa / step) * step;

    const frag = document.createDocumentFragment();
    for (let ma = first; ma >= endMa; ma -= step) {
      const frac = this.#xFrac(ma);
      if (frac < 0 || frac > 1) continue;
      const tick = document.createElement("div");
      tick.className = "axis-tick";
      tick.style.left = `${frac * 100}%`;
      tick.textContent = formatMa(Math.round(ma * 1000) / 1000);
      frag.appendChild(tick);
    }
    this.axisEl.appendChild(frag);
  }

  #renderSpecies() {
    this.lanesEl.innerHTML = "";
    const visible = this.species.filter(
      (s) => s.startMa >= this.view.endMa && s.endMa <= this.view.startMa
    );

    // Greedy lane assignment so overlapping lifespans stack vertically.
    const laneEnds = []; // per lane: smallest endMa placed so far
    const laneHeight = this._laneHeight;
    const laneGap = this._laneGap;

    const lanesWidth = this._m.lanesW;
    const frag = document.createDocumentFragment();
    const MIN_BAR_PX = 24; // below this the bar is too small to read as a proper label — skip it

    for (const s of visible) {
      const left = clamp(this.#xFrac(s.startMa), 0, 1);
      const right = clamp(this.#xFrac(s.endMa), 0, 1);
      const widthPx = (right - left) * lanesWidth;

      // Hide specks (e.g. when fully zoomed out); they'd just clutter the axis.
      if (widthPx < MIN_BAR_PX) continue;

      let lane = laneEnds.findIndex((end) => s.startMa < end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(Infinity);
      }
      laneEnds[lane] = s.endMa;

      const bar = document.createElement("button");
      bar.className = "species-bar";
      bar.dataset.speciesId = s.id; // lets the Creatures list highlight this bar
      bar.style.left = `${left * 100}%`;
      bar.style.width = `max(${(right - left) * 100}%, 12px)`; // always clickable
      bar.style.top = `${lane * (laneHeight + laneGap)}px`;
      const barColor = this.periodById.get(s.periodId)?.color ?? DEFAULT_BAR_COLOR;
      bar.style.borderLeftColor = barColor;
      bar.style.setProperty("--bar-color", barColor);

      // Label every bar with a progressively-truncated name so it always hints
      // at its creature: full name when it fits, else as many leading letters as
      // fit (+ ellipsis), down to a compact 3-letter abbreviation on the
      // narrowest bars. Hover tooltip + click still expose everything.
      const fits = Math.floor((widthPx - 16) / 7); // chars that fit at base size
      if (fits >= s.name.length) {
        bar.textContent = s.name;
      } else if (fits >= 4) {
        bar.textContent = s.name.slice(0, fits - 1).trimEnd() + "…";
      } else {
        bar.classList.add("is-abbr"); // smaller font + tighter padding for the hint
        bar.textContent = s.name.slice(0, 3);
      }
      bar.title = `${s.name} · ${formatMa(s.startMa)} – ${formatMa(s.endMa)}`;
      bar.addEventListener("click", () => this.onSpeciesClick?.(s));
      frag.appendChild(bar);
    }

    this.lanesEl.appendChild(frag);
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

  /** Clickable "you are here" marker at present day (0 Ma). Links to me.html. */
  #renderMeMarker() {
    if (!this.meEl) return;
    const frac = this.#xFrac(0);
    const show = frac >= 0 && frac <= 1;
    this.meEl.hidden = !show;
    if (show) this.meEl.style.left = `${frac * 100}%`;
  }

  /** Subtle amber markers for point-in-time events, riding the time axis. */
  #renderEvents() {
    if (!this.eventsEl) return;
    this.eventsEl.innerHTML = "";
    // Align the layer to the axis row (offset cached; see render()).
    this.eventsEl.style.top = `${this._axisTop ?? 0}px`;

    const width = this._m.eventsW;
    const frag = document.createDocumentFragment();
    let lastX = -Infinity;
    const MIN_GAP_PX = 6; // skip near-overlapping markers when zoomed far out

    for (const ev of this.events) {
      if (this.realm === "earth" && ev.realm === "cosmos") continue; // cosmic events hidden until revealed
      const frac = this.#xFrac(ev.ma);
      if (frac < 0 || frac > 1) continue;
      const x = frac * width;
      if (x - lastX < MIN_GAP_PX) continue;
      lastX = x;

      const marker = document.createElement("button");
      marker.className = "event-marker";
      if (ev.realm === "cosmos") marker.classList.add("cosmos"); // cyan/violet styling in cosmos mode
      marker.dataset.eventId = ev.id; // lets the Events list highlight this marker
      marker.style.left = `${frac * 100}%`;
      marker.setAttribute("aria-label", `${ev.name} (${formatMa(ev.ma)})`);
      marker.title = `${ev.name} · ${formatMa(ev.ma)}`;

      marker.addEventListener("mouseenter", () => this.onEventShow?.(ev, marker));
      marker.addEventListener("focus", () => this.onEventShow?.(ev, marker));
      marker.addEventListener("mouseleave", () => this.onEventHide?.());
      marker.addEventListener("blur", () => this.onEventHide?.());
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onEventOpen?.(ev, marker);
      });

      frag.appendChild(marker);
    }
    this.eventsEl.appendChild(frag);
  }

  /**
   * The cosmic ribbon's smooth, translucent black→purple wash (cosmos mode only).
   * A single gradient layer behind the rows, built from the cosmic periods' colours
   * at their on-screen positions, so adjacent epochs blend with no hard cut-offs and
   * the starfield shimmers through. Re-laid out every render so it tracks pan/zoom.
   */
  #renderCosmosWash() {
    const existing = this.ribbonEl.querySelector("#cosmos-wash");
    if (existing) existing.remove();
    if (this.realm !== "cosmos") return;

    const units = this.periods
      .filter((p) => p.realm === "cosmos" && p.rank === "period")
      .sort((a, b) => b.startMa - a.startMa); // oldest → youngest (left → right)
    if (!units.length) return;

    const bigBangMa = units[0].startMa; // 13800 — the apex
    const leftF = this.#xFrac(bigBangMa);
    const rightF = this.#xFrac(units[units.length - 1].endMa);
    if (rightF <= 0 || leftF >= 1) return; // wash fully off-screen
    // Unclamped span — the wash element runs the true cosmic extent and the ribbon's
    // overflow:hidden clips it, so the warm Big-Bang glow stays anchored to 13.8 Ga as you pan.
    const washSpan = rightF - leftF || 1;
    const posOf = (ma) => clamp(((this.#xFrac(ma) - leftF) / washSpan) * 100, 0, 100);

    // Start the gradient at the Big Bang with the explosion colours (matching the burst),
    // fading into the dark-purple epochs.
    const stops = [
      `#ffffff ${posOf(bigBangMa).toFixed(2)}%`,
      `#ffe08a ${posOf(bigBangMa - 40).toFixed(2)}%`,
      `#ff7a2a ${posOf(bigBangMa - 110).toFixed(2)}%`,
      `#ff3b1f ${posOf(bigBangMa - 190).toFixed(2)}%`,
    ];
    // Remaining epochs (skip the Big Bang period — the warm stops cover it), at midpoints.
    for (const u of units.slice(1)) {
      stops.push(`${u.color} ${posOf((u.startMa + u.endMa) / 2).toFixed(2)}%`);
    }
    stops.push(`${units[units.length - 1].color} 100%`);

    const wash = document.createElement("div");
    wash.id = "cosmos-wash";
    wash.setAttribute("aria-hidden", "true");
    wash.style.left = `${leftF * 100}%`;
    wash.style.width = `${washSpan * 100}%`;
    wash.style.backgroundImage = `linear-gradient(to right, ${stops.join(", ")})`;
    this.ribbonEl.prepend(wash); // behind the rows; cosmos bands are transparent over it
  }

  /** The boundary veil at 4.6 Ga where the cosmos hands over to Earth (cosmos mode only). */
  #renderSeam() {
    let seam = this.root.querySelector("#cosmos-seam");
    const frac = this.#xFrac(FULL_VIEW.startMa); // 4600 — the Earth/cosmos boundary
    const show = this.realm === "cosmos" && frac > 0 && frac < 1;
    if (!show) {
      if (seam) seam.style.display = "none";
      return;
    }
    if (!seam) {
      seam = document.createElement("div");
      seam.id = "cosmos-seam";
      seam.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "cosmos-seam-label";
      label.textContent = "Earth forms · 4.6 Ga";
      seam.appendChild(label);
      this.root.appendChild(seam);
    }
    seam.style.display = "block";
    seam.style.left = `${frac * 100}%`;
  }

  /** Keep the Big Bang burst anchored at 13.8 Ga (the animation is triggered from main.js). */
  #renderBigBang() {
    if (!this.bigbangEl) return;
    const frac = this.#xFrac(13800);
    const show = frac >= 0 && frac <= 1;
    this.bigbangEl.style.display = show ? "block" : "none";
    if (show) this.bigbangEl.style.left = `${frac * 100}%`;
  }

  #cssNum(varName, fallback) {
    const v = parseFloat(getComputedStyle(this.root).getPropertyValue(varName));
    return Number.isFinite(v) ? v : fallback;
  }

  /* ================= interaction ================= */

  #bindInteraction() {
    let momentumRaf = null;
    const stopMomentum = () => {
      if (momentumRaf) cancelAnimationFrame(momentumRaf);
      momentumRaf = null;
    };
    const panByPx = (dx) => {
      const { startMa, endMa } = this.view;
      const maPerPx = (startMa - endMa) / this.root.clientWidth;
      this.setView(startMa + dx * maPerPx, endMa + dx * maPerPx);
    };

    // Wheel: zoom, centered on the cursor.
    this.root.addEventListener(
      "wheel",
      (e) => {
        if (!this.interactive) return; // frozen during the guided journey
        e.preventDefault();
        stopMomentum();
        const rect = this.root.getBoundingClientRect();
        const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const { startMa, endMa } = this.view;
        const cursorMa = startMa - frac * (startMa - endMa);

        const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const newSpan = clamp(
          (startMa - endMa) * factor,
          MIN_SPAN_MA,
          this.maxMa
        );
        this.setView(cursorMa + frac * newSpan, cursorMa - (1 - frac) * newSpan);
      },
      { passive: false }
    );

    // Drag: pan, with gentle release momentum. (Click events on bands/bars
    // still fire if there was no drag.)
    let dragging = false;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0; // px per ms, lightly smoothed

    this.root.addEventListener("pointerdown", (e) => {
      if (!this.interactive) return; // frozen during the guided journey
      dragging = true;
      lastX = e.clientX;
      lastT = performance.now();
      velocity = 0;
      stopMomentum();
      this.root.classList.add("dragging");
    });

    window.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      if (Math.abs(dx) < 1) return;
      const dt = Math.max(now - lastT, 1);
      velocity = velocity * 0.6 + (dx / dt) * 0.4; // smooth flick speed
      lastX = e.clientX;
      lastT = now;
      panByPx(dx);
    });

    window.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove("dragging");

      const reduceMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("no-motion");
      // Only glide on a deliberate flick; ignore slow/precise drags.
      if (reduceMotion || performance.now() - lastT > 80 || Math.abs(velocity) < 0.08) {
        return;
      }

      let v = clamp(velocity, -1.4, 1.4); // cap speed so it stays controllable
      const DECAY = 0.005; // gentle exponential slow-down
      let prev = performance.now();
      const step = (now) => {
        const dt = Math.min(now - prev, 50);
        prev = now;
        panByPx(v * dt);
        v *= Math.exp(-DECAY * dt);
        momentumRaf = Math.abs(v) > 0.02 ? requestAnimationFrame(step) : null;
      };
      momentumRaf = requestAnimationFrame(step);
    });
  }
}
