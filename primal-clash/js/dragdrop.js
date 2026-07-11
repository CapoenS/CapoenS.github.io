/* ============================================
   Primal Clash — drag & drop
   Pointer-event based dragging for two things:
   1. Hand cards → play them (creatures to the
      field, biomes to the banner, events onto
      targets / the battlefield).
   2. Field creatures → stage a combat: drag
      forward into your battle line to attack,
      or (as defender) drag onto a lane to block.
   Invalid drops snap back.
   ============================================ */
"use strict";

const DND = (() => {
  let drag = null; // { kind, card|creature, el, ghost, off/home, hoverEl }

  /* ---------------- hand cards ---------------- */
  function start(card, el, ev) {
    if (drag || !G || G.busy || G.over || actingSide() !== 0 || G.combat) return;
    if (card.cost > G.players[0].amber) { FX.shake(el); return; }
    if (card.type === 'event' && eventNeedsTarget(card)) {
      const targets = eventTargets(0, card);
      if (!targets.length) {
        log(`${card.name}: no valid target right now.`);
        FX.shake(el);
        return;
      }
    }
    beginDrag({ kind: 'card', card }, el, ev);
    cardZones(card, true);
  }

  /* ---------------- field creatures ---------------- */
  function startCreature(c, el, ev, mode) {
    if (drag || !G || G.busy || G.over || actingSide() !== 0) return;
    beginDrag({ kind: mode, creature: c }, el, ev);   // mode: 'declare' | 'block'
    creatureZones(mode, true);
  }

  /* Shared ghost setup. */
  function beginDrag(base, el, ev) {
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    /* `drawn`/`spawn` carry entry animations whose keyframes START far
       off-position (the deck fly-in) — a cloned node REPLAYS them, so
       the ghost would teleport right and swoop in. Strip them, along
       with the hand-fan pose vars, so the ghost starts exactly where
       the card visually is and moves only with the pointer. */
    ghost.classList.remove('playable', 'selected', 'ready', 'drawn', 'spawn', 'pre-summon');
    ghost.style.animationDelay = '';
    ghost.style.removeProperty('--fan-r');
    ghost.style.removeProperty('--fan-y');
    ghost.style.transform = 'none';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    document.body.appendChild(ghost);
    el.classList.add('drag-source');
    drag = Object.assign(base, {
      el, ghost,
      offX: ev.clientX - r.left,
      offY: ev.clientY - r.top,
      homeX: r.left,
      homeY: r.top,
      hoverEl: null,
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  /* Highlight legal drop zones. */
  function cardZones(card, on) {
    const field = document.getElementById('player-field');
    const banner = document.getElementById('biome-banner');
    const bf = document.getElementById('battlefield');
    if (card.type === 'creature') {
      if (field) field.classList.toggle('drop-ready', on);
    } else if (card.type === 'biome') {
      if (banner) banner.classList.toggle('drop-ready', on);
    } else if (!eventNeedsTarget(card)) {
      if (bf) bf.classList.toggle('drop-ready-soft', on);
    } else {
      for (const t of eventTargets(0, card)) {
        const tEl = elByUid(t.uid);
        if (tEl) tEl.classList.toggle('targetable', on);
      }
    }
  }
  function creatureZones(mode, on) {
    const battle = document.getElementById('player-battle');
    if (battle) battle.classList.toggle('drop-ready', on);
  }

  /* Resolve the drop under (x,y) into an action, or null. */
  function dropActionAt(d, x, y) {
    const under = document.elementFromPoint(x, y);
    if (!under) return null;

    if (d.kind === 'card') {
      const card = d.card;
      if (card.type === 'event' && eventNeedsTarget(card)) {
        const cEl = under.closest('.creature');
        if (!cEl) return null;
        const t = eventTargets(0, card).find((c) => String(c.uid) === cEl.dataset.uid);
        return t ? { type: 'play', target: t, el: cEl } : null;
      }
      return under.closest('#battlefield') ? { type: 'play', target: undefined, el: null } : null;
    }

    if (d.kind === 'declare') {
      if (under.closest('#player-battle')) return { type: 'stageAttack', el: document.getElementById('player-battle') };
      if (under.closest('#player-field')) return { type: 'unstageAttack', el: document.getElementById('player-field') };
      return null;
    }

    if (d.kind === 'block') {
      const slot = under.closest('.lane-slot');
      if (slot && slot.closest('#player-battle')) return { type: 'stageBlock', lane: Number(slot.dataset.lane), el: slot };
      if (under.closest('#player-field')) return { type: 'unstageBlock', el: document.getElementById('player-field') };
      return null;
    }
    return null;
  }

  function onMove(ev) {
    if (!drag) return;
    drag.ghost.style.left = (ev.clientX - drag.offX) + 'px';
    drag.ghost.style.top = (ev.clientY - drag.offY) + 'px';
    const tilt = Math.max(-8, Math.min(8, ev.movementX || 0));
    drag.ghost.style.transform = `rotate(${tilt}deg) scale(1.07)`;

    const hit = dropActionAt(drag, ev.clientX, ev.clientY);
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
    if (d.kind === 'card') cardZones(d.card, false);
    else creatureZones(d.kind, false);
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
    const hit = dropActionAt(d, ev.clientX, ev.clientY);
    teardown(d);
    if (!hit) { snapBack(d); return; }
    d.ghost.remove();
    d.el.classList.remove('drag-source');

    if (hit.type === 'play') {
      if (typeof NET !== 'undefined' && NET.isGuest()) NET.playCard(d.card, hit.target);
      else await guarded(() => playCardFromHand(0, d.card.uid, hit.target));
    } else if (hit.type === 'stageAttack' || hit.type === 'unstageAttack') {
      /* toggle: dropping a field creature forward stages it; dropping a
         staged attacker back removes it. stageToggleAttacker handles both. */
      await stageToggleAttacker(d.creature.uid);
    } else if (hit.type === 'stageBlock') {
      stageAssignBlock(hit.lane, d.creature.uid);
    } else if (hit.type === 'unstageBlock') {
      const idx = Object.keys(STAGE.blocks).find((k) => STAGE.blocks[k] === d.creature.uid);
      if (idx != null) stageAssignBlock(Number(idx), null);
      else render();
    }
  }

  function onCancel() {
    if (!drag) return;
    const d = drag;
    drag = null;
    teardown(d);
    snapBack(d);
  }

  return { start, startCreature };
})();
