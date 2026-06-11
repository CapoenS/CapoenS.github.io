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
import { PeriodPanel, SpeciesModal } from "./detailPanel.js";

async function init() {
  let data;
  try {
    data = await loadData();
  } catch (err) {
    showFatalError(err);
    return;
  }
  const { periods, species } = data;

  const periodPanel = new PeriodPanel(document.getElementById("period-panel"));

  const speciesModal = new SpeciesModal({
    backdropEl: document.getElementById("species-modal"),
    contentEl: document.getElementById("species-modal-content"),
    closeBtn: document.getElementById("modal-close"),
  });

  const timeline = new Timeline({
    root: document.getElementById("timeline"),
    periods,
    species,
    onPeriodFocus: (period) => periodPanel.show(period),
    onSpeciesClick: (s) =>
      speciesModal.show(s, periods.find((p) => p.id === s.periodId)),
  });

  buildJumpChips(periods, timeline);

  document
    .getElementById("reset-view")
    .addEventListener("click", () => timeline.reset());

  timeline.render();
}

/** Quick-navigation chips for the Phanerozoic periods (where the species live). */
function buildJumpChips(periods, timeline) {
  const container = document.getElementById("jump-chips");
  for (const p of periods) {
    if (p.rank === "eon") continue; // eons are easy to hit on the ribbon already
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = p.name;
    chip.style.borderBottom = `2px solid ${p.color ?? "transparent"}`;
    chip.addEventListener("click", () => timeline.focusPeriod(p.id));
    container.appendChild(chip);
  }
}

function showFatalError(err) {
  console.error(err);
  const section = document.querySelector(".timeline-section");
  section.innerHTML = `<p class="hint" style="color:#f08a8a">⚠ ${err.message}</p>`;
}

init();
