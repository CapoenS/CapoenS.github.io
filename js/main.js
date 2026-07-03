/**
 * main.js — entry point. Loads data, builds the timeline,
 * and wires the UI pieces together.
 *
 * Architecture in one breath:
 *   data/*.json  →  dataLoader  →  Timeline (render + interaction)
 *                                   ├─ onPeriodFocus  → PeriodPanel
 *                                   └─ onSpeciesClick → SpeciesModal
 */

import { loadData } from "./dataLoader.js";
import { Timeline } from "./timeline.js";
import { PeriodPanel, SpeciesModal, EventCard, EventModal } from "./detailPanel.js";
import { GlobeOverlay } from "./globeOverlay.js";
import { Background } from "./background.js";
import { AmbientAudio } from "./ambientAudio.js";
import { TimeTour } from "./tour.js";
import { JourneySpeciesDock } from "./journeySpecies.js"; // EXPERIMENTAL — journey species dock
import { formatMa, unitForMa } from "./utils.js";

async function init() {
  let data;
  try {
    data = await loadData();
  } catch (err) {
    showFatalError(err);
    return;
  }
  
  const lanes = document.getElementById("species-lanes");
  const toggleBtn = document.getElementById("toggle-species");
  toggleBtn.addEventListener("click", () => {
    lanes.hidden = !lanes.hidden;
    toggleBtn.textContent = lanes.hidden ? "Show species" : "Hide species";
});

  const eventMarkers = document.getElementById("event-markers");
  const eventsBtn = document.getElementById("toggle-events");
  eventsBtn?.addEventListener("click", () => {
    eventMarkers.hidden = !eventMarkers.hidden;
    eventsBtn.textContent = eventMarkers.hidden ? "Show events" : "Hide events";
  });
  
  const { periods, species, events, sources } = data;

  const background = new Background(periods);
  const ambientAudio = new AmbientAudio(periods);

  const globeOverlay = new GlobeOverlay(document.getElementById("globe-overlay"));

  const periodPanel = new PeriodPanel(
    document.getElementById("period-panel"),
    (period) => globeOverlay.show(period)
  );

  const speciesModal = new SpeciesModal({
    backdropEl: document.getElementById("species-modal"),
    contentEl: document.getElementById("species-modal-content"),
    closeBtn: document.getElementById("modal-close"),
  });

  const eventCard = new EventCard(document.getElementById("event-card"));

  const eventModal = new EventModal({
    backdropEl: document.getElementById("event-modal"),
    contentEl: document.getElementById("event-modal-content"),
    closeBtn: document.getElementById("event-modal-close"),
    // Revert the event background on close — but not during a journey, where the
    // tour owns the background until the user clicks Continue.
    onClose: () => {
      if (!document.documentElement.classList.contains("touring")) background.restore();
    },
  });

  // Ambiance (background tint + ambient audio) vs. full focus (also opens the panel).
  // The guided journey uses ambiance only; the panel narration is its caption overlay.
  const applyAmbiance = (period) => {
    background.apply(period);   // handles null (reset)
    ambientAudio.play(period);  // handles null (reset)
  };
  const applyFocus = (period) => {
    periodPanel.show(period);
    applyAmbiance(period);
  };

  const timeline = new Timeline({
    root: document.getElementById("timeline"),
    periods,
    species,
    events,
    onPeriodFocus: (period) => applyFocus(period),
    onSpeciesClick: (s) =>
      speciesModal.show(s, periods.find((p) => p.id === s.periodId)),
    onEventShow: (ev, markerEl) => eventCard.show(ev, markerEl),
    onEventHide: () => eventCard.hide(),
    onEventOpen: (ev) => {
      eventCard.hide();        // dismiss the hover preview
      eventModal.show(ev);     // open the full detail
      background.showEvent(ev); // immerse: swap the bg to the event's image
    },
    onViewChange: (view) => updateAtmosphere(view), // region-driven theme + starfield parallax
  });

  buildJumpChips(periods, timeline);

  // Tier visibility checkboxes (Eons / Eras / Periods).
  for (const rank of ["eon", "era", "period"]) {
    const box = document.getElementById(`show-${rank}`);
    box?.addEventListener("change", () => timeline.setRankVisible(rank, box.checked));
  }

  // Sound toggle (off by default; preference remembered in localStorage).
  const audioBtn = document.getElementById("toggle-audio");
  const syncAudioBtn = () => {
    audioBtn.textContent = `Sound: ${ambientAudio.isEnabled ? "On" : "Off"}`;
    audioBtn.setAttribute("aria-pressed", String(ambientAudio.isEnabled));
  };
  syncAudioBtn();
  audioBtn.addEventListener("click", () => {
    ambientAudio.toggle();
    syncAudioBtn();
  });

  // Settings popover (same open/close behavior as the Jump-to menu).
  wirePopover(
    document.getElementById("settings-toggle"),
    document.getElementById("settings-panel")
  );

  // About + Sources modals (open from the top ribbon; close via ×, backdrop, Escape).
  wireModal("about-modal", "about-toggle", "about-close");
  renderSources(sources);
  wireModal("sources-modal", "sources-toggle", "sources-close");

  // Creatures list modal (every species, grouped by period, with a name search).
  const creatures = wireModal("creatures-modal", "creatures-toggle", "creatures-close");
  buildCreatureList(species, periods, timeline, creatures?.close);

  // Events list modal (every event, grouped by the unit it falls in, searchable).
  const eventsList = wireModal("events-modal", "events-toggle", "events-close");
  buildEventList(events, periods, timeline, eventsList?.close);

  // "Journey through time" — auto-playing guided tour from 4.6 Ga to today.
  // EXPERIMENTAL: the "living creatures" dock (remove this line + the arg below to disable).
  const speciesDock = new JourneySpeciesDock(document.getElementById("journey-dock"), species);
  const tour = new TimeTour({ timeline, periods, events, applyAmbiance, eventModal, background, speciesDock });
  document.getElementById("tour-toggle")?.addEventListener("click", () => {
    periodPanel.show(null); // close any open period panel; the caption narrates instead
    // In cosmos mode the Journey starts at the Big Bang with the same funnel-expand reveal;
    // otherwise it's the Earth-only journey from the Hadean.
    const includeCosmos = document.documentElement.classList.contains("cosmos");
    if (includeCosmos) armCosmosReveal();  // clip the ribbon before the tour's first render
    tour.start({ includeCosmos });
    if (includeCosmos) fireCosmosReveal();  // burst + cleanup; the tour owns the view/interaction
  });

  // Panel opacity test slider (temporary — controls --panel-alpha).
  const opacitySlider = document.getElementById("panel-opacity");
  const opacityVal = document.getElementById("panel-opacity-val");
  opacitySlider?.addEventListener("input", () => {
    document.documentElement.style.setProperty("--panel-alpha", opacitySlider.value);
    opacityVal.textContent = `${Math.round(opacitySlider.value * 100)}%`;
  });

  // Disable-animations toggle (persisted; adds .no-motion to <html>).
  const motionBox = document.getElementById("reduce-motion");
  if (motionBox) {
    const motionOff = localStorage.getItem("deeptime-motion") === "off";
    motionBox.checked = motionOff;
    document.documentElement.classList.toggle("no-motion", motionOff);
    motionBox.addEventListener("change", () => {
      document.documentElement.classList.toggle("no-motion", motionBox.checked);
      try {
        localStorage.setItem("deeptime-motion", motionBox.checked ? "off" : "on");
      } catch (_) {}
    });
  }

  /* ---------- Cosmos reveal (the timeline back to the Big Bang) ---------- */
  const teaser = document.getElementById("cosmos-teaser");
  const returnEarthBtn = document.getElementById("return-earth");
  const bigbangEl = document.getElementById("bigbang");
  const hasCosmos = periods.some((p) => p.realm === "cosmos");
  if (teaser) teaser.hidden = !hasCosmos; // no cosmos data → no teaser, Earth-only app

  const reduceMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("no-motion");

  // Atmosphere follows the viewed region: while the cosmos is active, the purple theme +
  // starfield are on only when the view is over the space side of the 4.6 Ga seam, and the
  // starfield parallax-scrolls (slower than the 1:1 content) as you pan. Fired every render
  // (so panning, zooming and the Journey all update it). Reverts to Earth on the Earth side.
  const starfield = document.getElementById("starfield");
  const SEAM_MA = 4600;
  // Per-layer star travel in px for each *screen-width* the user pans (near→far). Because it's
  // keyed to fraction-of-a-screen panned (not absolute Ma), the stars move just as much when
  // zoomed in as when zoomed out — and zooming alone (no pan) doesn't jump them.
  const STAR_PX = [640, 540, 450, 370, 300, 250, 200, 160, 120, 85, 55];
  let starOffset = 0;        // accumulated screens panned while over the space side
  let starPrevCenter = null;
  const updateAtmosphere = (view) => {
    const center = (view.startMa + view.endMa) / 2;
    const span = Math.max(view.startMa - view.endMa, 1);
    const inSpace =
      document.documentElement.classList.contains("cosmos") && center > SEAM_MA;
    document.documentElement.classList.toggle("space-view", inSpace);
    if (!inSpace) { starPrevCenter = null; return; } // reset so re-entry doesn't lurch
    if (!reduceMotion()) {
      if (starPrevCenter !== null) starOffset += (center - starPrevCenter) / span; // screens panned
      if (starfield) {
        starfield.style.backgroundPositionX =
          STAR_PX.map((px) => `${(starOffset * px).toFixed(1)}px`).join(", ");
      }
    }
    starPrevCenter = center;
  };

  // Small eased tween over the view window (used for the glide back to Earth).
  let viewTween = null;
  const tweenView = (toStart, toEnd, ms, done) => {
    if (viewTween) cancelAnimationFrame(viewTween);
    const from = { ...timeline.view };
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min((now - t0) / ms, 1);
      const e = k * k * (3 - 2 * k); // smoothstep
      timeline.setView(
        from.startMa + (toStart - from.startMa) * e,
        from.endMa + (toEnd - from.endMa) * e
      );
      if (k < 1) viewTween = requestAnimationFrame(step);
      else { viewTween = null; done?.(); }
    };
    viewTween = requestAnimationFrame(step);
  };

  const playBigBang = () => {
    if (!bigbangEl) return;
    bigbangEl.classList.remove("playing");
    void bigbangEl.offsetWidth; // reflow → replay the burst
    bigbangEl.classList.add("playing");
  };

  // The funnel grow-in is shared by the teaser reveal and the cosmos Journey. Arm it BEFORE
  // the cosmos first renders (so the ribbon's clip starts collapsed at the apex — no
  // full-width flash), then fire it (burst + cleanup) right after the first render.
  const REVEAL_MS = 1400;
  const armCosmosReveal = () => {
    if (reduceMotion()) return;
    document.getElementById("timeline").classList.add("cosmos-revealing");
  };
  const fireCosmosReveal = (onDone) => {
    playBigBang();
    if (reduceMotion()) { onDone?.(); return; }
    const tlEl = document.getElementById("timeline");
    const ribbon = document.getElementById("period-ribbon");
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      tlEl.classList.remove("cosmos-revealing");
      ribbon.removeEventListener("animationend", done);
      onDone?.();
    };
    ribbon.addEventListener("animationend", done);
    setTimeout(done, REVEAL_MS + 250); // fallback if animationend doesn't fire
  };

  // Frame the reveal lands on: the whole cosmos with the Big Bang at the left edge
  // and the 4.6 Ga seam (a sliver of the Hadean) at the right.
  const COSMOS_VIEW = { startMa: 13800, endMa: 4000 };

  const enterCosmos = () => {
    const html = document.documentElement;
    if (html.classList.contains("cosmos")) return;
    html.classList.add("cosmos");
    returnEarthBtn?.removeAttribute("hidden");

    if (!reduceMotion()) timeline.interactive = false;
    armCosmosReveal(); // collapse the clip before the cosmos renders
    timeline.setRealm("cosmos");
    timeline.setMaxMa(13800); // raise the ceiling to the Big Bang
    timeline.setView(COSMOS_VIEW.startMa, COSMOS_VIEW.endMa); // 13.8 Ga at the left edge (the apex)
    applyAmbiance(periods.find((p) => p.id === "cosmos") ?? null);
    fireCosmosReveal(() => { timeline.interactive = true; });
  };

  const returnToEarth = () => {
    const html = document.documentElement;
    if (!html.classList.contains("cosmos")) return;
    bigbangEl?.classList.remove("playing");
    // Glide back to Earth first (still in the cosmos realm so its bands stay during the
    // glide), then flip the realm/ceiling so cosmic bands don't pop out mid-animation.
    const land = () => {
      timeline.setRealm("earth");
      timeline.setMaxMa(4600);
      html.classList.remove("cosmos");
      html.classList.remove("space-view"); // back to the Earth atmosphere
      returnEarthBtn?.setAttribute("hidden", "");
      timeline.interactive = true;
      timeline.reset(); // Earth full view + clear focus + reset background/audio
    };
    if (reduceMotion()) {
      land();
    } else {
      timeline.interactive = false;
      tweenView(4600, 0, 1200, land);
    }
  };

  teaser?.addEventListener("click", enterCosmos);
  returnEarthBtn?.addEventListener("click", returnToEarth);

  // Reset view: in cosmos mode this returns to Earth; otherwise the usual full view.
  document.getElementById("reset-view").addEventListener("click", () => {
    if (document.documentElement.classList.contains("cosmos")) returnToEarth();
    else timeline.reset();
  });

  timeline.render();
}

/**
 * Quick-navigation popover, grouped by era. Opens/closes from the "Jump to"
 * toggle; closes on selection, outside click, or Escape.
 */
function buildJumpChips(periods, timeline) {
  const container = document.getElementById("jump-chips");
  const toggle = document.getElementById("jump-toggle");
  const byId = new Map(periods.map((p) => [p.id, p]));

  // Group periods under their parent era, preserving timeline (oldest-first) order.
  const groups = new Map(); // eraId -> { era, periods: [] }
  for (const p of periods) {
    if (p.rank !== "period") continue; // eons/eras are easy to hit on the ribbon
    const era = byId.get(p.parentId);
    const key = era?.id ?? "_other";
    if (!groups.has(key)) groups.set(key, { era, periods: [] });
    groups.get(key).periods.push(p);
  }

  for (const { era, periods: group } of groups.values()) {
    const section = document.createElement("div");
    section.className = "jump-group";
    section.dataset.realm = era?.realm ?? "earth"; // hidden until cosmos is activated (CSS)

    const h3 = document.createElement("h3");
    h3.textContent = era?.name ?? "Other";
    if (era?.color) h3.style.borderBottomColor = era.color; // colour-code the divider

    section.appendChild(h3);

    const ul = document.createElement("ul");
    for (const p of group) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "jump-row";
      btn.dataset.realm = p.realm ?? "earth";
      if (p.color) btn.style.setProperty("--row-color", p.color);

      const name = document.createElement("span");
      name.className = "jump-name";
      name.textContent = p.name;

      const when = document.createElement("span");
      when.className = "jump-when";
      when.textContent = `${formatMa(p.startMa)} – ${formatMa(p.endMa)}`;

      btn.append(name, when);
      btn.addEventListener("click", () => {
        timeline.focusPeriod(p.id);
        closeJump();
      });

      li.appendChild(btn);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    container.appendChild(section);
  }

  // Chips already wire `closeJump()`; provide it via the shared popover helper.
  const { close: closeJump } = wirePopover(toggle, container);
}

/**
 * Wire a toggle button to a popover element: click to open/close, and close on
 * outside-click or Escape. Returns { open, close }. The entrance animation is
 * handled in CSS (it replays whenever the element is shown).
 */
function wirePopover(toggle, panel) {
  const open = () => {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onOutside, true);
    document.addEventListener("keydown", onEsc);
  };
  const close = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("keydown", onEsc);
  };
  const onOutside = (e) => {
    if (!panel.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
      close();
    }
  };
  const onEsc = (e) => {
    if (e.key === "Escape") close();
  };
  toggle.addEventListener("click", () => (panel.hidden ? open() : close()));
  return { open, close };
}

/**
 * Wire a modal (`.modal-backdrop` + `.modal-card`) to an open button + close button.
 * Closes on the close button, backdrop click, or Escape. Replays the card "pop"
 * entrance on open unless reduced motion is requested.
 */
function wireModal(modalId, openId, closeId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const card = modal.querySelector(".modal-card");
  const open = () => {
    modal.hidden = false;
    if (card && !document.documentElement.classList.contains("no-motion")) {
      card.classList.remove("opening");
      void card.offsetWidth; // reflow → replay the pop
      card.classList.add("opening");
    }
  };
  const close = () => {
    modal.hidden = true;
    card?.classList.remove("opening");
  };
  document.getElementById(openId)?.addEventListener("click", open);
  document.getElementById(closeId)?.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });
  return { open, close };
}

/**
 * Top-ribbon "Creatures" modal: every species grouped by the unit it belongs to,
 * ordered oldest→youngest, with a live name-search filter. Clicking a row frames
 * that creature on the timeline and focuses its period (panel + background + audio).
 */
function buildCreatureList(species, periods, timeline, closeModal) {
  const list = document.getElementById("creature-list");
  if (!list) return;
  const byId = new Map(periods.map((p) => [p.id, p]));

  // Group by the unit each species' periodId points to (a period, or an era for LUCA).
  const groups = new Map(); // unitId -> { unit, species: [] }
  for (const s of species) {
    const unit = byId.get(s.periodId);
    const key = unit?.id ?? "_other";
    if (!groups.has(key)) groups.set(key, { unit: unit ?? null, species: [] });
    groups.get(key).species.push(s);
  }

  // Groups oldest→youngest by the unit's startMa (ungrouped "Other" sinks to the end).
  const ordered = [...groups.values()].sort(
    (a, b) => (b.unit?.startMa ?? -Infinity) - (a.unit?.startMa ?? -Infinity)
  );

  list.innerHTML = "";
  for (const { unit, species: group } of ordered) {
    group.sort((a, b) => b.startMa - a.startMa || b.endMa - a.endMa); // oldest first

    const section = document.createElement("div");
    section.className = "creature-group";

    const h3 = document.createElement("h3");
    h3.textContent = unit?.name ?? "Other";
    if (unit?.color) h3.style.borderBottomColor = unit.color; // colour-code the divider
    section.appendChild(h3);

    const ul = document.createElement("ul");
    for (const s of group) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "creature-row";
      if (unit?.color) btn.style.setProperty("--row-color", unit.color);

      const name = document.createElement("span");
      name.className = "creature-name";
      name.textContent = s.name;

      const range = document.createElement("span");
      range.className = "creature-range";
      range.textContent = `${formatMa(s.startMa)} – ${formatMa(s.endMa)}`;

      btn.append(name, range);
      btn.addEventListener("click", () => {
        // Make sure species are visible before jumping to one.
        const lanes = document.getElementById("species-lanes");
        const toggleBtn = document.getElementById("toggle-species");
        if (lanes?.hidden) {
          lanes.hidden = false;
          if (toggleBtn) toggleBtn.textContent = "Hide species";
        }
        timeline.focusSpecies(s.id);
        closeModal?.();
      });

      li.appendChild(btn);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    list.appendChild(section);
  }

  // Live name filter: hide non-matching rows and any group left empty.
  const search = document.getElementById("creature-search");
  search?.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const section of list.children) {
      let anyVisible = false;
      for (const li of section.querySelectorAll("li")) {
        const name = li.querySelector(".creature-name")?.textContent.toLowerCase() ?? "";
        const match = !q || name.includes(q);
        li.hidden = !match;
        if (match) anyVisible = true;
      }
      section.hidden = !anyVisible;
    }
  });
}

/**
 * Top-ribbon "Events" modal: every event grouped by the geologic unit it falls in,
 * ordered oldest→youngest, with a live name-search filter. Clicking a row frames
 * that unit on the timeline, focuses it (panel + background + audio), and flashes
 * the event's marker. Mirrors buildCreatureList.
 */
function buildEventList(events, periods, timeline, closeModal) {
  const list = document.getElementById("event-list");
  if (!list) return;

  // Group by the most specific unit each event's date falls in.
  const groups = new Map(); // unitId -> { unit, events: [] }
  for (const ev of events) {
    const unit = unitForMa(periods, ev.ma);
    const key = unit?.id ?? "_other";
    if (!groups.has(key)) groups.set(key, { unit: unit ?? null, events: [] });
    groups.get(key).events.push(ev);
  }

  // Groups oldest→youngest by the unit's startMa (ungrouped "Other" sinks to the end).
  const ordered = [...groups.values()].sort(
    (a, b) => (b.unit?.startMa ?? -Infinity) - (a.unit?.startMa ?? -Infinity)
  );

  list.innerHTML = "";
  for (const { unit, events: group } of ordered) {
    group.sort((a, b) => b.ma - a.ma); // oldest first

    const section = document.createElement("div");
    section.className = "event-group";
    section.dataset.realm = unit?.realm ?? "earth"; // hidden until cosmos is activated (CSS)

    const h3 = document.createElement("h3");
    h3.textContent = unit?.name ?? "Other";
    if (unit?.color) h3.style.borderBottomColor = unit.color; // colour-code the divider
    section.appendChild(h3);

    const ul = document.createElement("ul");
    for (const ev of group) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "event-row";
      btn.dataset.realm = ev.realm ?? "earth";
      if (unit?.color) btn.style.setProperty("--row-color", unit.color);

      const name = document.createElement("span");
      name.className = "event-name";
      name.textContent = ev.name;

      const when = document.createElement("span");
      when.className = "event-when";
      when.textContent = formatMa(ev.ma);

      btn.append(name, when);
      btn.addEventListener("click", () => {
        // Make sure event markers are visible before jumping to one.
        const markers = document.getElementById("event-markers");
        const eventsBtn = document.getElementById("toggle-events");
        if (markers?.hidden) {
          markers.hidden = false;
          if (eventsBtn) eventsBtn.textContent = "Hide events";
        }
        timeline.focusEvent(ev.id);
        closeModal?.();
      });

      li.appendChild(btn);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    list.appendChild(section);
  }

  // Live name filter: hide non-matching rows and any group left empty.
  const search = document.getElementById("event-search");
  search?.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const section of list.children) {
      let anyVisible = false;
      for (const li of section.querySelectorAll("li")) {
        const name = li.querySelector(".event-name")?.textContent.toLowerCase() ?? "";
        const match = !q || name.includes(q);
        li.hidden = !match;
        if (match) anyVisible = true;
      }
      section.hidden = !anyVisible;
    }
  });
}

/** Render the data-driven Sources modal from categories of { title, url?, note? }. */
function renderSources(categories) {
  const list = document.getElementById("sources-list");
  if (!list) return;
  list.innerHTML = "";
  for (const cat of categories ?? []) {
    const section = document.createElement("div");
    section.className = "sources-cat";

    const h3 = document.createElement("h3");
    h3.textContent = cat.label;
    section.appendChild(h3);

    const ul = document.createElement("ul");
    for (const src of cat.sources ?? []) {
      if (!src.title) continue;
      const li = document.createElement("li");
      if (src.url) {
        const a = document.createElement("a");
        a.href = src.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = src.title;
        li.appendChild(a);
      } else {
        li.appendChild(document.createTextNode(src.title));
      }
      if (src.note) {
        const note = document.createElement("span");
        note.className = "source-note";
        note.textContent = ` — ${src.note}`;
        li.appendChild(note);
      }
      ul.appendChild(li);
    }
    section.appendChild(ul);
    list.appendChild(section);
  }
}

function showFatalError(err) {
  console.error(err);
  const section = document.querySelector(".timeline-section");
  section.innerHTML = `<p class="hint" style="color:#f08a8a">⚠ ${err.message}</p>`;
}

init();
