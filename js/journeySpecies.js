/**
 * journeySpecies.js — [EXPERIMENTAL] "living creatures" dock for Journey mode.
 *
 * As the journey playhead crosses a species' lifespan, a small card (image + name)
 * slides up at the bottom of the screen; several stack while they overlap, and each
 * slides away when the playhead passes that species' end (extinction).
 *
 * Fully self-contained. To disable the experiment, remove: this file, the
 * #journey-dock element (index.html), the fenced CSS block (style.css), the two
 * construction lines (main.js), and the optional-chained `speciesDock?.` hooks in
 * tour.js. Every hook is optional-chained, so removing any part can't break the tour.
 */

import { imageWithFallback } from "./utils.js";

const EXIT_MS = 380; // must exceed the .jdock-card transition duration (see style.css)

export class JourneySpeciesDock {
  constructor(rootEl, species) {
    this.root = rootEl;
    this.species = [...(species ?? [])].sort((a, b) => b.startMa - a.startMa);
    this.shown = new Map(); // id -> card element
  }

  /** Reflect the species alive at `ma`: add the newly-alive, remove the newly-gone. */
  update(ma) {
    if (!this.root) return;
    for (const s of this.species) {
      const alive = ma <= s.startMa && ma >= s.endMa;
      const has = this.shown.has(s.id);
      if (alive && !has) this.#add(s);
      else if (!alive && has) this.#remove(s.id);
    }
  }

  /** Animate every card out (used at event stops and on exit). */
  clear() {
    for (const id of [...this.shown.keys()]) this.#remove(id);
  }

  #add(s) {
    const card = document.createElement("div");
    card.className = "jdock-card";
    const name = document.createElement("span");
    name.className = "jdock-name";
    name.textContent = s.name;
    card.append(imageWithFallback(s.image, s.name), name);
    this.root.appendChild(card);
    this.shown.set(s.id, card);
    requestAnimationFrame(() => card.classList.add("in")); // trigger the entrance
  }

  #remove(id) {
    const card = this.shown.get(id);
    if (!card) return;
    this.shown.delete(id);
    card.classList.remove("in"); // transitions back to the collapsed base state
    setTimeout(() => card.remove(), EXIT_MS);
  }
}
