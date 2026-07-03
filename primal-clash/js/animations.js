/* ============================================
   Primal Clash — animation helpers
   DOM-level effects; all functions are safe to
   call with missing elements (they just no-op),
   which also makes the engine testable headless.
   ============================================ */
"use strict";

const FX = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

  /* Attacker lunges toward the target, target flashes. */
  async lunge(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    fromEl.style.zIndex = 50;
    fromEl.style.transition = 'transform 0.16s ease-in';
    fromEl.style.transform = `translate(${dx * 0.72}px, ${dy * 0.72}px) scale(1.08)`;
    await FX.sleep(170);
    toEl.classList.add('hit-flash');
    fromEl.style.transition = 'transform 0.18s ease-out';
    fromEl.style.transform = '';
    await FX.sleep(200);
    toEl.classList.remove('hit-flash');
    fromEl.style.zIndex = '';
    fromEl.style.transition = '';
  },

  /* Floating number/text above an element (damage, heals, buffs). */
  floatText(el, text, cls = 'dmg') {
    if (!el || typeof document === 'undefined') return;
    const r = el.getBoundingClientRect();
    const n = document.createElement('div');
    n.className = 'float-num ' + cls;
    n.textContent = text;
    n.style.left = (r.left + r.width / 2) + 'px';
    n.style.top = (r.top + r.height * 0.2) + 'px';
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1100);
  },

  /* Brief shake (invalid action, leader hit). */
  shake(el) {
    if (!el) return;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 420);
  },
};
