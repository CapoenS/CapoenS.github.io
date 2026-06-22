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
import { PeriodPanel, SpeciesModal, EventCard } from "./detailPanel.js";
import { GlobeOverlay } from "./globeOverlay.js";
import { Background } from "./background.js";
import { AmbientAudio } from "./ambientAudio.js";
import { formatMa } from "./utils.js";

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

  const timeline = new Timeline({
    root: document.getElementById("timeline"),
    periods,
    species,
    events,
    onPeriodFocus: (period) => {
      periodPanel.show(period);
      background.apply(period);   // handles null (reset)
      ambientAudio.play(period);  // handles null (reset)
    },
    onSpeciesClick: (s) =>
      speciesModal.show(s, periods.find((p) => p.id === s.periodId)),
    onEventShow: (ev, markerEl) => eventCard.show(ev, markerEl),
    onEventHide: () => eventCard.hide(),
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

  document
    .getElementById("reset-view")
    .addEventListener("click", () => timeline.reset());

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

    if (era) {
      const heading = document.createElement("span");
      heading.className = "jump-group-label";
      heading.textContent = era.name;
      section.appendChild(heading);
    }

    const row = document.createElement("div");
    row.className = "chips";
    for (const p of group) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = p.name;
      chip.style.borderBottom = `2px solid ${p.color ?? "transparent"}`;
      chip.addEventListener("click", () => {
        timeline.focusPeriod(p.id);
        closeJump();
      });
      row.appendChild(chip);
    }
    section.appendChild(row);
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
