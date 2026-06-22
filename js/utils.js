/**
 * utils.js — small shared helpers.
 */

/** Clamp a number between min and max. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pick a readable text color (dark or light) for a given background hex,
 * using perceived luminance. Returns the project's ink tones.
 */
export function textColorOn(hex) {
  const h = (hex ?? "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  // Perceived luminance (sRGB-weighted), 0–255.
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? "#11161f" : "#f5f3ec";
}

/**
 * Format a time in Ma (million years ago) for humans.
 *   4600   -> "4.6 Ga"
 *   155    -> "155 Ma"
 *   2.58   -> "2.58 Ma"
 *   0.0003 -> "300 ka"
 *   0      -> "today"
 */
export function formatMa(ma) {
  if (ma === 0) return "today";
  if (ma >= 1000) return `${trimZeros((ma / 1000).toFixed(2))} Ga`;
  if (ma < 0.001) return `${Math.round(ma * 1_000_000)} years ago`;
  if (ma < 1) return `${trimZeros((ma * 1000).toFixed(0))} ka`;
  return `${trimZeros(ma.toFixed(2))} Ma`;
}

function trimZeros(str) {
  return str.includes(".") ? str.replace(/\.?0+$/, "") : str;
}

/** Format a lifespan range, e.g. "155 – 145 Ma". */
export function formatRange(startMa, endMa) {
  return `${formatMa(startMa)} → ${formatMa(endMa)}`;
}

/**
 * Pick "nice" tick spacing for an axis covering `span` Ma,
 * aiming for roughly `targetCount` ticks.
 */
export function niceTickStep(span, targetCount = 8) {
  const raw = span / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * magnitude) return m * magnitude;
  }
  return 10 * magnitude;
}

/** Build a placeholder element for a missing image. */
export function imagePlaceholder(label) {
  const div = document.createElement("div");
  div.className = "img-placeholder";
  div.textContent = `image: ${label}`;
  return div;
}

/**
 * Create an <img> that swaps itself for a placeholder if the
 * file doesn't exist (so the site works before you add images).
 */
export function imageWithFallback(src, alt) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.replaceWith(imagePlaceholder(alt));
  });
  return img;
}
