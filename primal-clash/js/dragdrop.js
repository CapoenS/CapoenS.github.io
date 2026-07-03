/* ============================================
   Primal Clash — drag & drop card play
   Pointer-event based dragging: pick up a hand
   card, drop it on the battlefield (creatures,
   biomes, untargeted events) or onto a valid
   creature (targeted events). Invalid drops
   snap the card back to your hand.
   ============================================ */
"use strict";

const DND = (() => {
  let drag = null; // { card, el, ghost, offX, offY, homeX, homeY, hoverEl }

  function start(card, el, ev) {
    if (drag || !G || G.busy || G.over || G.active !== 0) return;
    if (card.cost > G.players[0].amber) { FX.shake(el); return; }
    if (card.type === 'event' && eventNeedsTarget(card)) {
      const targets = eventTargets(0, card);
      if (!targets.length) {
        log(`${card.name}: no valid target right now.`);
        FX.shake(el);
        return;
      }
    }
    ev.preventDefault();

    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('playable', 'selected');
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    document.body.appendChild(ghost);
    el.classList.add('drag-source');

    drag = {
      card, el, ghost,
      offX: ev.clientX - r.left,
      offY: ev.clientY - r.top,
      homeX: r.left,
      homeY: r.top,
      hoverEl: null,
    };
    zonesToggle(card, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  /* Highlight where this card may be dropped. */
  function zonesToggle(card, on) {
    const board = document.getElementById('player-board');
    const banner = document.getElementById('biome-banner');
    const field = document.getElementById('battlefield');
    if (card.type === 'creature') {
      if (board) board.classList.toggle('drop-ready', on);
    } else if (card.type === 'biome') {
      if (banner) banner.classList.toggle('drop-ready', on);
    } else if (!eventNeedsTarget(card)) {
      if (field) field.classList.toggle('drop-ready-soft', on);
    } else {
      for (const t of eventTargets(0, card)) {
        const tEl = elByUid(t.uid);
        if (tEl) tEl.classList.toggle('targetable', on);
      }
    }
  }

  /* What (if anything) is a legal drop at screen point x,y? */
  function dropTargetAt(card, x, y) {
    const under = document.elementFromPoint(x, y);
    if (!under) return null;
    if (card.type === 'event' && eventNeedsTarget(card)) {
      const cEl = under.closest('.creature');
      if (!cEl) return null;
      const t = eventTargets(0, card).find((c) => String(c.uid) === cEl.dataset.uid);
      return t ? { target: t, el: cEl } : null;
    }
    return under.closest('#battlefield') ? { target: undefined, el: null } : null;
  }

  function onMove(ev) {
    if (!drag) return;
    drag.ghost.style.left = (ev.clientX - drag.offX) + 'px';
    drag.ghost.style.top = (ev.clientY - drag.offY) + 'px';
    const tilt = Math.max(-8, Math.min(8, ev.movementX || 0));
    drag.ghost.style.transform = `rotate(${tilt}deg) scale(1.07)`;

    const hit = dropTargetAt(drag.card, ev.clientX, ev.clientY);
    const cur = hit && hit.el ? hit.el : null;
    if (drag.hoverEl && drag.hoverEl !== cur) drag.hoverEl.classList.remove('drag-over');
    if (cur && cur !== drag.hoverEl) cur.classList.add('drag-over');
    drag.hoverEl = cur;
    drag.ghost.classList.toggle('over-valid', !!hit);
  }

  function teardown(d) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    zonesToggle(d.card, false);
    if (d.hoverEl) d.hoverEl.classList.remove('drag-over');
  }

  function snapBack(d) {
    d.ghost.style.transition = 'left .22s ease, top .22s ease, transform .22s ease';
    d.ghost.style.left = d.homeX + 'px';
    d.ghost.style.top = d.homeY + 'px';
    d.ghost.style.transform = 'rotate(0deg) scale(1)';
    setTimeout(() => {
      d.ghost.remove();
      d.el.classList.remove('drag-source');
    }, 230);
  }

  async function onUp(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    const hit = dropTargetAt(d.card, ev.clientX, ev.clientY);
    teardown(d);
    if (hit) {
      d.ghost.remove();
      d.el.classList.remove('drag-source');
      if (typeof NET !== 'undefined' && NET.isGuest()) {
        /* Online guest: send the play as an intent to the host (which may
           first open the On Summon target picker locally). */
        NET.playCard(d.card, hit.target);
      } else {
        await guarded(() => playCardFromHand(0, d.card.uid, hit.target));
      }
    } else {
      snapBack(d);
    }
  }

  function onCancel() {
    if (!drag) return;
    const d = drag;
    drag = null;
    teardown(d);
    snapBack(d);
  }

  return { start };
})();
