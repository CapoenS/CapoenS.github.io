/**
 * ambientAudio.js — looping atmospheric audio that reacts to the focused unit.
 *
 * Off by default; the user enables it via a toolbar toggle (preference stored in
 * localStorage). Switching units cross-fades between looping tracks. Playback is
 * only ever started from a user gesture (toggle click / focus click), so it
 * complies with browser autoplay rules. Missing/unplayable files are silent
 * no-ops — never throw.
 *
 * Resolution (with ancestor inheritance via parentId):
 *   unit.audio → nearest ancestor's audio → silence
 */

const STORAGE_KEY = "deeptime-audio";
const FADE_MS = 800;
const MAX_VOL = 0.6;

export class AmbientAudio {
  /** @param {Array} units — all units (for ancestor lookup) */
  constructor(units) {
    this.byId = new Map(units.map((u) => [u.id, u]));
    this.enabled = localStorage.getItem(STORAGE_KEY) === "on";
    this.currentUnit = null; // last-focused unit (for enabling later)
    this.currentSrc = null;
    this.audio = null; // active HTMLAudioElement (fade handles live on the elements)
  }

  get isEnabled() {
    return this.enabled;
  }

  /** Focus a unit (or null on reset). Remembers it; plays only if enabled. */
  play(unit) {
    this.currentUnit = unit;
    if (!this.enabled) return;
    this.#switchTo(unit ? this.#resolveAudio(unit) : null);
  }

  /** Toggle sound on/off; returns the new enabled state. */
  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch (_) {}
    if (on) {
      this.#switchTo(this.currentUnit ? this.#resolveAudio(this.currentUnit) : null);
    } else {
      this.#switchTo(null);
    }
  }

  /* ---- internals ---- */

  #switchTo(src) {
    if (src === this.currentSrc) return;
    this.currentSrc = src;

    const old = this.audio;
    if (old) this.#fade(old, 0, () => old.pause());

    if (!src) {
      this.audio = null;
      return;
    }

    const next = new Audio(src);
    next.loop = true;
    next.volume = 0;
    this.audio = next;

    const start = next.play();
    if (start?.catch) start.catch(() => {}); // autoplay/404 guard
    this.#fade(next, MAX_VOL);
  }

  #fade(el, target, done) {
    // Supersede any in-flight fade on THIS element (rapid toggles/unit switches would
    // otherwise stack rAF loops fighting over volume). Per-element on purpose — a
    // crossfade legitimately runs two fades at once (old track out, new track in).
    if (el._fadeRaf) cancelAnimationFrame(el._fadeRaf);
    const from = el.volume;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min((now - t0) / FADE_MS, 1);
      el.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) {
        el._fadeRaf = requestAnimationFrame(step);
      } else {
        el._fadeRaf = null;
        if (done) done();
      }
    };
    el._fadeRaf = requestAnimationFrame(step);
  }

  #resolveAudio(unit) {
    let u = unit;
    const seen = new Set();
    while (u && !seen.has(u.id)) {
      seen.add(u.id);
      if (u.audio) return u.audio;
      u = u.parentId ? this.byId.get(u.parentId) : null;
    }
    return null;
  }
}
