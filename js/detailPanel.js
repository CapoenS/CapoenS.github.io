/**
 * detailPanel.js — renders the period info panel and the species card modal.
 *
 * Both renderers are data-driven: whatever keys exist in a period's `info`
 * object or a species' `facts` object are displayed, so you can add new
 * fields in the JSON without touching this code.
 */

import { formatRange, imageWithFallback } from "./utils.js";

/* ================= Period panel ================= */

export class PeriodPanel {
  constructor(rootEl) {
    this.root = rootEl;
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
    header.append(h2, dates);

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
    this.root.append(header, body);
    this.root.hidden = false;
  }
}

/* ================= Species modal ================= */

export class SpeciesModal {
  constructor({ backdropEl, contentEl, closeBtn }) {
    this.backdrop = backdropEl;
    this.content = contentEl;

    closeBtn.addEventListener("click", () => this.hide());
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.hide(); // click outside the card
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
    });
  }

  show(species, period) {
    this.content.innerHTML = "";

    const imgWrap = el("div", "species-card-img");
    imgWrap.appendChild(imageWithFallback(species.image, species.name));

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
      const fact = el("div", "fact");
      const b = el("b");
      b.textContent = key;
      const span = el("span");
      span.textContent = value;
      fact.append(b, span);
      facts.appendChild(fact);
    }

    body.append(h2, meta, summary, facts);
    this.content.append(imgWrap, body);
    this.backdrop.hidden = false;
  }

  hide() {
    this.backdrop.hidden = true;
  }
}

/* ================= tiny helper ================= */

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
