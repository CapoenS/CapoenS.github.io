/**
 * detailPanel.js — renders the period info panel and the species card modal.
 *
 * Both renderers are data-driven: whatever keys exist in a period's `info`
 * object or a species' `facts` object are displayed, so you can add new
 * fields in the JSON without touching this code.
 */

import { formatMa, formatRange, imageWithFallback } from "./utils.js";

/* ================= Period panel ================= */

export class PeriodPanel {
  /**
   * @param {HTMLElement} rootEl
   * @param {(period) => void} [onGlobeOpen]  — called when "View 3D Map" is clicked
   */
  constructor(rootEl, onGlobeOpen) {
    this.root        = rootEl;
    this.onGlobeOpen = onGlobeOpen ?? null;
  }

  /** Show a period (or hide the panel when period is null). */
  show(period) {
    if (!period) {
      this.root.hidden = true;
      this.root.innerHTML = "";
      return;
    }

    this.root.innerHTML = "";

    // Header: swatch, name, dates
    const header = el("div", "panel-header");
    const swatch = el("span", "panel-swatch");
    swatch.style.background = period.color ?? "#666";
    const h2 = el("h2");
    h2.append(swatch, document.createTextNode(` ${period.name}`));
    const dates = el("span", "panel-dates");
    dates.textContent = `${period.rank ?? "period"} · ${formatRange(period.startMa, period.endMa)}`;

    const headerRight = el("div", "panel-header-right");
    headerRight.append(dates);
    if (this.onGlobeOpen) {
      const globeBtn = el("button", "btn-globe");
      globeBtn.textContent = "View 3D Map";
      globeBtn.title = `Open paleogeographic globe for the ${period.name}`;
      globeBtn.addEventListener("click", () => this.onGlobeOpen(period));
      headerRight.appendChild(globeBtn);
    }

    header.append(h2, headerRight);

    // Overview: a longer free-text introduction to the era
    let overview = null;
    if (period.overview) {
      overview = el("div", "panel-overview");
      const p = el("p");
      p.textContent = period.overview;
      overview.appendChild(p);
    }

    // Body: facts (left) + images (right)
    const body = el("div", "panel-body");

    const facts = el("div", "panel-facts");
    const dl = el("dl");
    for (const [key, value] of Object.entries(period.info ?? {})) {
      const dt = el("dt");
      dt.textContent = key;
      const dd = el("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    }
    facts.appendChild(dl);

    const images = el("div", "panel-images");
    for (const src of period.images ?? []) {
      images.appendChild(imageWithFallback(src, `${period.name} landscape`));
    }

    body.append(facts, images);
    this.root.append(header, ...(overview ? [overview] : []), body);
    this.root.hidden = false;
  }
}

/* ================= Species modal ================= */

export class SpeciesModal {
  constructor({ backdropEl, contentEl, closeBtn }) {
    this.backdrop = backdropEl;
    this.content = contentEl;
    this.card = backdropEl.querySelector(".modal-card");

    closeBtn.addEventListener("click", () => this.hide());
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.hide(); // click outside the card
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
    });

    // Subtle cursor tilt (disabled when the user prefers reduced motion).
    this._reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this._tiltTimer = null;
    // --- Parallax tuning (revert to 6 / 1.06 / 8 for the subtler original) ---
    this._tiltMax = 9;      // card tilt, degrees   (was 6)
    this._imgScale = 1.14;  // image zoom/headroom  (was 1.06; keep CSS base in sync)
    this._imgShift = 18;    // image parallax nudge, px (was 8)
    // --- Click "push" tuning (set _pressScale=1 / _nudgeDeg=0 to disable) ---
    this._pressScale = 0.96; // how far the card dips in on press
    this._nudgeDeg = 5;      // extra tilt toward the click point on press

    this.cardImg = null;
    this._px = 0;            // latest cursor position within the card (-0.5..0.5)
    this._py = 0;
    this._pressed = false;

    // Compose the card transform from tilt + (optional) press dip/nudge.
    this._applyCard = () => {
      const nudge = this._pressed ? this._nudgeDeg : 0;
      const rx = -this._py * (2 * this._tiltMax + nudge);
      const ry = this._px * (2 * this._tiltMax + nudge);
      const s = this._pressed ? this._pressScale : 1;
      this.card.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`;
    };

    this._onTiltMove = (e) => {
      const r = this.card.getBoundingClientRect();
      this._px = (e.clientX - r.left) / r.width - 0.5;  // -0.5..0.5
      this._py = (e.clientY - r.top) / r.height - 0.5;
      this._applyCard();
      // Parallax: nudge the (zoomed) image with the cursor for a depth feel.
      if (this.cardImg) {
        this.cardImg.style.transform =
          `scale(${this._imgScale}) translate(${this._px * this._imgShift}px, ${this._py * this._imgShift}px)`;
      }
    };
    this._onTiltLeave = () => {
      this._pressed = false;
      this._px = 0;
      this._py = 0;
      this.card.style.transform = "";
      if (this.cardImg) this.cardImg.style.transform = `scale(${this._imgScale})`;
    };
    this._onPressDown = () => { this._pressed = true; this._applyCard(); };
    this._onPressUp = () => { this._pressed = false; this._applyCard(); };
  }

  show(species, period) {
    this.content.innerHTML = "";

    const imgWrap = el("div", "species-card-img");
    imgWrap.appendChild(imageWithFallback(species.image, species.name));
    this.cardImg = imgWrap.querySelector("img, .img-placeholder");

    const body = el("div", "species-card-body");

    const h2 = el("h2");
    h2.id = "species-modal-title";
    h2.textContent = species.name;

    const meta = el("p", "species-meta");
    meta.textContent = [
      species.group,
      formatRange(species.startMa, species.endMa),
      period ? `${period.name} period` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");

    const summary = el("p", "species-summary");
    summary.textContent = species.summary ?? "";

    const facts = el("div", "species-facts");
    for (const [key, value] of Object.entries(species.facts ?? {})) {
      // "Fun fact" is hidden for now — a richer version is planned later.
      if (/^fun facts?$/i.test(key.trim())) continue;
      const fact = el("div", "fact");
      const b = el("b");
      b.textContent = key;
      const span = el("span");
      span.textContent = value;
      fact.append(b, span);
      facts.appendChild(fact);
    }

    // Optional size-comparison image (creature silhouette next to a human).
    let sizeBlock = null;
    if (species.sizeImage) {
      sizeBlock = el("div", "species-size");
      const label = el("span", "species-size-label");
      label.textContent = "Size comparison";
      sizeBlock.append(label, imageWithFallback(species.sizeImage, `${species.name} size comparison`));
    }

    body.append(h2, meta, summary, ...(sizeBlock ? [sizeBlock] : []), facts);
    this.content.append(imgWrap, body);
    this.backdrop.hidden = false;

    const reduceMotion =
      this._reduceMotion || document.documentElement.classList.contains("no-motion");

    if (!reduceMotion && this.card) {
      // Replay the entrance every open (force reflow so the class re-triggers).
      this.card.classList.remove("opening");
      void this.card.offsetWidth;
      this.card.classList.add("opening");

      // After the entrance finishes, drop the class + attach the cursor tilt.
      // (The animation must be gone first, or its filled transform would
      // override the tilt's inline transform.)
      clearTimeout(this._tiltTimer);
      this._tiltTimer = setTimeout(() => {
        this.card.classList.remove("opening");
        this.card.addEventListener("pointermove", this._onTiltMove);
        this.card.addEventListener("pointerleave", this._onTiltLeave);
        this.card.addEventListener("pointerdown", this._onPressDown);
        this.card.addEventListener("pointerup", this._onPressUp);
        this.card.addEventListener("pointercancel", this._onPressUp);
      }, 240);
    }
  }

  hide() {
    clearTimeout(this._tiltTimer);
    if (this.card) {
      this.card.removeEventListener("pointermove", this._onTiltMove);
      this.card.removeEventListener("pointerleave", this._onTiltLeave);
      this.card.removeEventListener("pointerdown", this._onPressDown);
      this.card.removeEventListener("pointerup", this._onPressUp);
      this.card.removeEventListener("pointercancel", this._onPressUp);
      this.card.classList.remove("opening");
      this.card.style.transform = "";
    }
    this._pressed = false;
    if (this.cardImg) this.cardImg.style.transform = `scale(${this._imgScale})`;
    this.backdrop.hidden = true;
  }
}

/* ================= Event card (hover/tap popover) ================= */

export class EventCard {
  /** @param {HTMLElement} rootEl — the (hidden) #event-card container */
  constructor(rootEl) {
    this.root = rootEl;
    this._onDocClick = (e) => {
      // Dismiss a tapped-open card on the next outside click.
      if (!this.root.contains(e.target)) this.hide();
    };
    this._onEsc = (e) => {
      if (e.key === "Escape") this.hide();
    };
  }

  /** Show the card for an event, positioned above its marker. */
  show(event, anchorEl) {
    this.root.innerHTML = "";

    const imgWrap = el("div", "event-card-img");
    imgWrap.appendChild(imageWithFallback(event.image, event.name));

    const body = el("div", "event-card-body");
    const h3 = el("h3", "event-card-title");
    h3.textContent = event.name;
    const meta = el("p", "event-card-meta");
    meta.textContent = formatMa(event.ma);
    const text = el("p", "event-card-text");
    text.textContent = event.text ?? "";
    body.append(h3, meta, text);

    this.root.append(imgWrap, body);
    this.root.hidden = false;

    // Position above the marker, centered, clamped to the viewport.
    const a = anchorEl.getBoundingClientRect();
    const c = this.root.getBoundingClientRect();
    const margin = 8;
    let left = a.left + a.width / 2 - c.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - c.width - margin));
    let top = a.top - c.height - 10;
    if (top < margin) top = a.bottom + 10; // flip below if no room above
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;

    document.addEventListener("click", this._onDocClick, true);
    document.addEventListener("keydown", this._onEsc);
  }

  hide() {
    this.root.hidden = true;
    document.removeEventListener("click", this._onDocClick, true);
    document.removeEventListener("keydown", this._onEsc);
  }
}

/* ================= tiny helper ================= */

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
