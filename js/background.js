/**
 * background.js — immersive page background that reacts to the focused time unit.
 *
 * Builds a fixed two-layer stage behind all content and cross-fades between them
 * when a unit is focused. The image is blurred + darkened (CSS) and tinted toward
 * the unit's own ICS color (inline gradient) so it reads as atmosphere, not a
 * literal slideshow. Units without an image fall back to a pure color gradient.
 *
 * Resolution (with ancestor inheritance via parentId):
 *   unit.background → unit.images[0] → nearest ancestor's image → color gradient
 */

import { unitForMa } from "./utils.js";

export class Background {
  /** @param {Array} units — all period/era/eon units (for ancestor lookup) */
  constructor(units) {
    this.byId = new Map(units.map((u) => [u.id, u]));
    this.bgColor =
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() ||
      "#0c0f16";

    this.stage = document.createElement("div");
    this.stage.id = "bg-stage";
    this.frames = [document.createElement("div"), document.createElement("div")];
    this.frames.forEach((f) => {
      f.className = "bg-frame";
      this.stage.appendChild(f);
    });

    this.scrim = document.createElement("div");
    this.scrim.id = "bg-scrim";

    document.body.prepend(this.scrim);
    document.body.prepend(this.stage);

    this.active = 0; // index of the currently-visible frame
    this.current = null; // last unit applied (so restore() can return to it after showEvent)
  }

  /** Apply a unit's background, or clear it when unit is null. */
  apply(unit) {
    this.current = unit ?? null;
    if (!unit) {
      // Reset: fade both frames out, back to the default --bg.
      this.frames.forEach((f) => f.classList.remove("active"));
      return;
    }
    this.#crossfadeTo(this.#bgValue(unit));
  }

  /** Cross-fade to an event's image (tinted by its period). Leaves `current` intact. */
  showEvent(event) {
    const img = event?.background ?? event?.image; // prefer a dedicated large bg, else the 1:1
    if (!img) return; // no image → leave the current background as-is
    const unit = this.#unitForMa(event.ma);
    const [r, g, b] = this.#hexToRgb(unit?.color ?? "#666");
    this.#crossfadeTo(
      `linear-gradient(0deg, rgba(${r},${g},${b},0.2), rgba(${r},${g},${b},0.2)), url("${img}")`
    );
  }

  /** Revert to the last applied unit (or the default) after showEvent(). */
  restore() {
    this.apply(this.current);
  }

  /* ---- helpers ---- */

  #crossfadeTo(value) {
    const next = (this.active + 1) % 2;
    const nextFrame = this.frames[next];
    nextFrame.style.backgroundImage = value;
    // Force reflow so the new image is committed before the opacity swap.
    void nextFrame.offsetWidth;
    this.frames[this.active].classList.remove("active");
    nextFrame.classList.add("active");
    this.active = next;
  }

  /** Smallest-span unit whose range contains `ma` — used for the event tint colour. */
  #unitForMa(ma) {
    return unitForMa(this.byId.values(), ma);
  }

  #bgValue(unit) {
    const image = this.#resolveImage(unit);
    const [r, g, b] = this.#hexToRgb(unit.color ?? "#666");
    if (image) {
      // Color tint over the photo.
      return `linear-gradient(0deg, rgba(${r},${g},${b},0.2), rgba(${r},${g},${b},0.2)), url("${image}")`;
    }
    // No photo: a clean gradient from the unit color into the page background.
    return `linear-gradient(160deg, rgb(${r},${g},${b}) 0%, ${this.bgColor} 85%)`;
  }

  #resolveImage(unit) {
    let u = unit;
    const seen = new Set();
    while (u && !seen.has(u.id)) {
      seen.add(u.id);
      if (u.background) return u.background;
      if (u.images?.length) return u.images[0];
      u = u.parentId ? this.byId.get(u.parentId) : null;
    }
    return null;
  }

  #hexToRgb(hex) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
}
