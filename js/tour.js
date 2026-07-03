/**
 * tour.js — "Journey through time": an auto-playing guided tour.
 *
 * Drives the Timeline's view forward from ~4.6 Ga to today. As the playhead
 * crosses into each geologic unit it triggers a slow-motion "area reveal"
 * (Elden-Ring-style name flash) and morphs the background/audio; at each event
 * it stops and waits for the user to Continue. Built entirely from the existing
 * periods + events data, so new data is picked up automatically.
 */

import { clamp, formatMa, formatRange } from "./utils.js";

const TOUR_ZOOM = 0.5;       // view shows this fraction of the current unit (smaller = more zoomed in / finer)
const SECS_PER_SCREEN = 2.5; // seconds to scroll one view-width (pacing; the speed slider scales it)
const SLOWMO_MIN = 0.75;   // slowest speed factor at a unit boundary (higher = less slow)
const SLOWMO_WIN = 0.6;  // fraction of a unit, at each edge, the slow-mo dip spans
const SPAN_TAU = 350;     // ms time-constant for the span (zoom) easing
const END_MA = 0;

export class TimeTour {
  constructor({ timeline, periods, events, applyAmbiance, eventModal, background, speciesDock }) {
    this.timeline = timeline;
    this.applyAmbiance = applyAmbiance ?? (() => {});
    this.eventModal = eventModal ?? null;
    this.background = background ?? null;
    this.speciesDock = speciesDock ?? null; // EXPERIMENTAL (optional; safe to remove)

    // Leaf units (the finest subdivision tiling the timeline) + events, each sorted
    // oldest → youngest. Kept as full lists; start() picks the Earth-only or full-cosmos
    // subset, so the default Journey stays Earth-only and adding cosmos data is automatic.
    const hasChild = new Set(periods.map((p) => p.parentId).filter(Boolean));
    this._leavesAll = periods
      .filter((p) => !hasChild.has(p.id))
      .sort((a, b) => b.startMa - a.startMa);
    this._eventsAll = [...(events ?? [])].sort((a, b) => b.ma - a.ma);
    this.leaves = this._leavesAll;
    this.events = this._eventsAll;

    // Overlay DOM
    this.overlay = document.getElementById("tour-overlay");
    this.playheadEl = document.querySelector(".tour-playhead");
    this.revealEl = document.getElementById("tour-reveal");
    this.revealTitle = document.getElementById("tour-reveal-title");
    this.revealSub = document.getElementById("tour-reveal-sub");
    this.caption = document.getElementById("tour-caption");
    this.capTitle = document.getElementById("tour-caption-title");
    this.capMeta = document.getElementById("tour-caption-meta");
    this.capText = document.getElementById("tour-caption-text");
    this.detailsBtn = document.getElementById("tour-details");
    this.continueBtn = document.getElementById("tour-continue");
    this.readout = document.getElementById("tour-readout");
    this.exitBtn = document.getElementById("tour-exit");
    this.speedEl = document.getElementById("tour-speed");
    this.speedMul = parseFloat(this.speedEl?.value) || 0.7; // <1 = slower than base

    // Soft "area discovered" cue, played on each unit reveal as its name pops up.
    this._sfx = typeof Audio !== "undefined" ? new Audio("assets/audio/sfx/reveal.ogg") : null;
    if (this._sfx) { this._sfx.preload = "auto"; this._sfx.volume = 0.6; }

    this.active = false;
    this.raf = null;
    this._waiting = false;  // halted at a stop, awaiting Continue
    this._finished = false; // showing the closing caption

    this._onKey = (e) => {
      if (!this.active) return;
      // While the event detail modal is open, let it own the keys (its own Escape closes it).
      const evModal = document.getElementById("event-modal");
      if (evModal && !evModal.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); this.exit(); }
      else if ((e.key === " " || e.key === "Enter") && this._waiting) {
        e.preventDefault();
        this._advance();
      }
    };

    // Keep the cached ribbon rect (playhead anchor) fresh if the layout shifts mid-tour.
    this._onRelayout = () => {
      if (!this.active) return;
      this._positionPlayhead();
      this._syncPlayheadX();
    };

    this.continueBtn?.addEventListener("click", () => this._advance());
    this.exitBtn?.addEventListener("click", () => this.exit());
    this.detailsBtn?.addEventListener("click", () => {
      if (this._currentEvent && this.eventModal) this.eventModal.show(this._currentEvent);
    });
    this.speedEl?.addEventListener("input", () => {
      this.speedMul = parseFloat(this.speedEl.value) || 1;
    });
  }

  get reduceMotion() {
    return (
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("no-motion")
    );
  }

  /**
   * Begin the journey.
   * @param {object} [opts]
   * @param {boolean} [opts.includeCosmos] — traverse the cosmos too (Big Bang → today).
   *   Default false → Earth-only (Hadean → today). The caller reveals the cosmos first.
   */
  start(opts = {}) {
    const includeCosmos = !!opts.includeCosmos;
    this._includeCosmos = includeCosmos;
    // Pick the realm subset for this run.
    this.leaves = this._leavesAll.filter((u) => includeCosmos || u.realm !== "cosmos");
    this.events = this._eventsAll.filter((e) => includeCosmos || e.realm !== "cosmos");

    if (this.active || !this.overlay || !this.leaves.length) return;
    this.active = true;
    this._waiting = false;
    this._finished = false;
    this._currentEvent = null;
    this._eventIdx = 0;
    this._unit = null;
    this.speciesDock?.clear(); // EXPERIMENTAL: start with an empty dock
    this.continueBtn.textContent = "Continue ▶";

    document.documentElement.classList.add("touring");
    this.timeline.interactive = false;
    this.overlay.hidden = false;
    document.addEventListener("keydown", this._onKey);
    window.addEventListener("resize", this._onRelayout);
    window.addEventListener("scroll", this._onRelayout, { passive: true });

    if (this.reduceMotion) {
      this._startSlideshow();
    } else {
      this.playhead = this.leaves[0].startMa;      // oldest leaf (Hadean ~4600, or the Big Bang 13800)
      this.span = this.leaves[0].startMa - END_MA; // full view to start
      this.targetSpan = this.span;
      this._unitEnteredAt = null;
      this._lastT = null;
      this._intro = true; // hold + zoom in before travelling (so a start-of-journey event doesn't freeze us zoomed out)
      this.timeline.setView(this.playhead, END_MA);
      this._loop();
    }
    this._positionPlayhead();
    this._syncPlayheadX();
  }

  /** Sit the "now" playhead line over the ribbon (just below the reveal). */
  _positionPlayhead() {
    const ribbon = document.getElementById("period-ribbon");
    if (!ribbon || !this.playheadEl) return;
    const r = ribbon.getBoundingClientRect();
    this._ribbonRect = r; // cached for the per-frame X sync (refreshed on resize/scroll)
    const over = 18; // overhang above AND below the ribbon, so the line is mirrored
    this.playheadEl.style.top = `${Math.round(r.top - over)}px`;
    this.playheadEl.style.bottom = "auto";
    this.playheadEl.style.height = `${Math.round(r.height + over * 2)}px`;
  }

  /* ---------------- smooth (animated) mode ---------------- */

  _loop() { this.raf = requestAnimationFrame((t) => this._tick(t)); }

  _tick(now) {
    if (!this.active || this._waiting) return;
    const dt = this._lastT == null ? 0 : Math.min(now - this._lastT, 60);
    this._lastT = now;

    // Entered a new unit? → reveal + ambiance.
    const unit = this._unitAt(this.playhead);
    if (unit && unit !== this._unit) {
      this._unit = unit;
      this.targetSpan = this._frameSpan(unit);
      this.applyAmbiance(unit);
      this._reveal(unit);
    }

    // Intro: hold the playhead at the start and zoom in first, so an event sitting at the
    // very start (e.g. the Big Bang at 13.8 Ga) doesn't hard-stop us while still zoomed out.
    // Ends once the camera has eased into the first unit's framing, then travel begins.
    if (this._intro) {
      this.span += (this.targetSpan - this.span) * (1 - Math.exp(-dt / SPAN_TAU));
      this._applyView();
      this.readout.textContent = formatMa(Math.max(0, Math.round(this.playhead)));
      if (this.span <= this.targetSpan * 1.06) this._intro = false;
      this._loop();
      return;
    }

    // Smooth slow-mo dip centred on each unit boundary: ease down approaching the
    // edge of a unit, gentlest at the crossing, ease back up to cruise after it.
    const unitSpan = this._unit ? this._unit.startMa - this._unit.endMa : 100;
    const p = this._unit ? clamp((this._unit.startMa - this.playhead) / unitSpan, 0, 1) : 0;
    const edge = Math.min(p, 1 - p); // 0 at a boundary → 0.5 mid-unit
    const factor = SLOWMO_MIN + (1 - SLOWMO_MIN) * smoothstep(clamp(edge / SLOWMO_WIN, 0, 1));
    this.playhead -= (this.targetSpan / SECS_PER_SCREEN) * factor * this.speedMul * (dt / 1000);

    // Hard stop at the next event.
    const nextEv = this.events[this._eventIdx];
    if (nextEv && this.playhead <= nextEv.ma) {
      this.playhead = nextEv.ma;
      this._applyView();
      this._eventIdx += 1;
      this._stopAtEvent(nextEv);
      return;
    }

    // Reached the present.
    if (this.playhead <= END_MA) {
      this.playhead = END_MA;
      this._finish();
      return;
    }

    // Ease the zoom toward the current unit's framing, render, tick the readout.
    this.span += (this.targetSpan - this.span) * (1 - Math.exp(-dt / SPAN_TAU));
    this._applyView();
    this.readout.textContent = formatMa(Math.max(0, Math.round(this.playhead)));
    this.speciesDock?.update(this.playhead); // EXPERIMENTAL: living-creatures dock
    this._loop();
  }

  _applyView() {
    const half = this.span / 2;
    this.timeline.setView(this.playhead + half, this.playhead - half);
    this._syncPlayheadX();
  }

  /**
   * Keep the playhead line over the *actual* playhead. Near the start/end the clamped camera
   * can't keep the playhead centred (you can't show time older than the Big Bang), so the line
   * tracks its real screen position instead of sitting frozen at centre — it sweeps in from the
   * edge as travel begins, so nothing looks like it's "waiting".
   */
  _syncPlayheadX() {
    if (!this.playheadEl || this.playhead == null) return;
    const v = this.timeline.view;
    const denom = (v.startMa - v.endMa) || 1;
    const frac = clamp((v.startMa - this.playhead) / denom, 0, 1);
    // Use the rect cached by _positionPlayhead (kept fresh via the tour's
    // resize/scroll listeners) instead of a per-frame getBoundingClientRect.
    if (!this._ribbonRect) this._positionPlayhead();
    const r = this._ribbonRect;
    if (!r) return;
    this.playheadEl.style.left = `${Math.round(r.left + frac * r.width)}px`;
  }

  _stopAtEvent(ev) {
    cancelAnimationFrame(this.raf);
    this._waiting = true;
    this._currentEvent = ev;
    this.applyAmbiance(this._unitAt(ev.ma));
    this.background?.showEvent(ev); // immerse: swap the bg to the event's image
    this.speciesDock?.clear(); // EXPERIMENTAL: clear the dock at an event stop
    this._flashMarker(ev.id);
    this._showEventCaption(ev);
  }

  /* ---------------- reduced-motion slideshow ---------------- */

  _startSlideshow() {
    this.beats = [
      ...this.leaves.map((u) => ({ type: "unit", ma: u.startMa, unit: u })),
      ...this.events.map((e) => ({ type: "event", ma: e.ma, event: e })),
    ].sort((a, b) => b.ma - a.ma);
    this.beatIdx = -1;
    this._nextBeat();
  }

  _nextBeat() {
    this.beatIdx += 1;
    const beat = this.beats[this.beatIdx];
    if (!beat) { this._finish(); return; }
    this._waiting = true;
    if (beat.type === "unit") {
      const u = beat.unit;
      this.applyAmbiance(u);
      this.speciesDock?.update(u.startMa); // EXPERIMENTAL: living-creatures dock
      const pad = (u.startMa - u.endMa) * 0.08;
      this.timeline.setView(u.startMa + pad, Math.max(0, u.endMa - pad));
      this.readout.textContent = formatRange(u.startMa, u.endMa);
      this._showUnitCaption(u);
      this._playSfx();
    } else {
      const e = beat.event;
      const span = this._frameSpan(this._unitAt(e.ma));
      this.applyAmbiance(this._unitAt(e.ma));
      this.timeline.setView(e.ma + span / 2, Math.max(0, e.ma - span / 2));
      this.background?.showEvent(e); // event image as background
      this.speciesDock?.clear(); // EXPERIMENTAL: clear the dock at an event beat
      this.readout.textContent = formatMa(e.ma);
      this._flashMarker(e.id);
      this._currentEvent = e;
      this._showEventCaption(e);
    }
  }

  /* ---------------- shared ---------------- */

  _advance() {
    if (!this._waiting) return;
    if (this._finished) { this.exit(); return; }
    this._waiting = false;
    const leftEvent = !!this._currentEvent;
    this._currentEvent = null;
    this._hideCaption();
    if (leftEvent) this.background?.restore(); // back to the current period's bg
    if (this.reduceMotion) { this._nextBeat(); return; }
    this._lastT = null;
    this._loop();
  }

  _finish() {
    cancelAnimationFrame(this.raf);
    this.speciesDock?.clear(); // EXPERIMENTAL
    this.timeline.setView(80, END_MA); // present day; the ME marker sits at 0
    this.applyAmbiance(this._unitAt(0));
    this.revealEl?.classList.remove("show");
    this.readout.textContent = "today";
    this.capTitle.textContent = "The present day";
    this.capMeta.textContent = "today";
    this.capText.textContent = this._includeCosmos
      ? "From the Big Bang to you — 13.8 billion years of cosmic and earthly history. Click the glowing ME marker to meet the author."
      : "From molten rock to you — 4.6 billion years of history. Click the glowing ME marker to meet the author.";
    this.detailsBtn.hidden = true;
    this.continueBtn.textContent = "Finish";
    this.caption.hidden = false;
    this._waiting = true;
    this._finished = true;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this._waiting = false;
    this._finished = false;
    this._currentEvent = null;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this._onKey);
    window.removeEventListener("resize", this._onRelayout);
    window.removeEventListener("scroll", this._onRelayout);
    document.documentElement.classList.remove("touring");
    this.overlay.hidden = true;
    this.caption.hidden = true;
    this.revealEl?.classList.remove("show");
    this.background?.restore(); // don't leave an event image up after exiting
    this.speciesDock?.clear(); // EXPERIMENTAL
    this.continueBtn.textContent = "Continue ▶";
    this.timeline.interactive = true;
  }

  /* ---------------- overlay helpers ---------------- */

  _reveal(unit) {
    if (!this.revealEl) return;
    this.revealTitle.textContent = unit.name;
    this.revealSub.textContent = `${cap(unit.rank ?? "")} · ${formatRange(unit.startMa, unit.endMa)}`;
    // Anchor the reveal just above the timeline ribbon (overlay is position:fixed).
    const tl = document.getElementById("timeline");
    if (tl) {
      const r = tl.getBoundingClientRect();
      this.revealEl.style.top = "auto";
      this.revealEl.style.bottom = `${Math.round(window.innerHeight - r.top + 28)}px`;
    }
    this.revealEl.classList.remove("show");
    void this.revealEl.offsetWidth; // reflow → replay the animation
    this.revealEl.classList.add("show");
    this._playSfx();
  }

  /** Play the soft reveal cue (restart if already playing). */
  _playSfx() {
    if (!this._sfx) return;
    try { this._sfx.currentTime = 0; this._sfx.play().catch(() => {}); } catch (_) {}
  }

  _showEventCaption(ev) {
    this.capTitle.textContent = ev.name;
    this.capMeta.textContent = formatMa(ev.ma);
    this.capText.textContent = ev.text ?? "";
    this.detailsBtn.hidden = false;
    this.caption.hidden = false;
  }

  _showUnitCaption(u) {
    // Slideshow only: units also wait for Continue, so they reuse the caption.
    this.capTitle.textContent = u.name;
    this.capMeta.textContent = `${cap(u.rank ?? "")} · ${formatRange(u.startMa, u.endMa)}`;
    this.capText.textContent = u.overview ?? "";
    this.detailsBtn.hidden = true;
    this.caption.hidden = false;
  }

  _hideCaption() { this.caption.hidden = true; }

  /* ---------------- tiny helpers ---------------- */

  _unitAt(ma) {
    return this.leaves.find((u) => ma <= u.startMa && ma >= u.endMa) ?? null;
  }

  _frameSpan(unit) {
    return (unit ? unit.startMa - unit.endMa : 100) * TOUR_ZOOM; // zoomed-in window
  }

  _flashMarker(id) {
    const m = document.querySelector(`#event-markers [data-event-id="${CSS.escape(id)}"]`);
    if (!m) return;
    m.classList.add("flash");
    setTimeout(() => m.classList.remove("flash"), 1600);
  }
}

function smoothstep(t) { return t * t * (3 - 2 * t); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
