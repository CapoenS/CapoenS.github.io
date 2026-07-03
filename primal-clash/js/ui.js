/* ============================================
   Primal Clash — rendering & interaction
   Full re-render from state after each action.
   Hand cards are played by DRAG & DROP (DND);
   attacking is click: creature then target.
   All functions no-op safely without a DOM,
   so the engine can be tested headless.
   ============================================ */
"use strict";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- interactive target picker (On Summon effects) ----------
   uiChooseTarget() returns a Promise that resolves with the clicked
   creature. While active, valid targets pulse and other input waits.
   Headless (tests): resolves immediately with the first target. */
let targetPicker = null;

function uiChooseTarget(targets, promptText) {
  if (typeof document === 'undefined') return Promise.resolve(targets[0]);
  return new Promise((resolve) => {
    targetPicker = { targets, resolve, prompt: promptText };
    render();
  });
}

function clearTargetPicker() {
  if (!targetPicker) return;
  const p = targetPicker;
  targetPicker = null;
  p.resolve(null);
}

/*
 * Card art window. Art lives at assets/cards/<template id>.jpg (1:1 for
 * creatures/events, wide for biomes). If the file is missing the <img>
 * removes itself, revealing the emoji placeholder underneath — so cards
 * keep working before their art exists. draggable=false keeps native
 * image-drag from fighting the pointer-based card drag (DND).
 */
function artHTML(tplId, placeholder, cls) {
  return `<div class="${cls}"><span class="art-ph">${placeholder}</span>` +
    `<img class="art-img" src="assets/cards/${tplId}.jpg" alt="" loading="lazy" draggable="false" onerror="this.remove()"></div>`;
}

function elByUid(u) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-uid="${u}"]`);
}

function heroEl(pIdx) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(pIdx === 0 ? 'player-hero' : 'enemy-hero');
}

function render() {
  if (typeof document === 'undefined' || !G) return;
  renderHero(0);
  renderHero(1);
  renderBoard(0);
  renderBoard(1);
  renderAmber(0);
  renderAmber(1);
  renderDeckPiles();
  renderHand();
  renderBiome();
  renderControls();
  renderLog();
  /* Online host: every distinct render is broadcast to the guest (NET
     dedupes), so intermediate states (deaths, retreats, spawns) stream
     over as they happen — the guest's whole view of the game. */
  if (typeof NET !== 'undefined') NET.onRender();
}

/* ---------- deck piles (right edge of the battlefield) ---------- */
function renderDeckPiles() {
  for (const pIdx of [0, 1]) {
    const el = document.getElementById(pIdx === 0 ? 'player-deck' : 'enemy-deck');
    if (!el) continue;
    const n = G.players[pIdx].deck.length;
    el.title = `${G.players[pIdx].name} — ${n} card${n === 1 ? '' : 's'} left in the deck`;
    el.classList.toggle('empty', !n);
    if (!n) {
      el.innerHTML = `<span class="pile-empty">✕</span><span class="pile-count">0</span>`;
      continue;
    }
    // Pile thickness tracks how many cards are left.
    const depth = Math.min(5, Math.ceil(n / 6));
    let layers = '';
    for (let i = depth - 1; i >= 1; i--) {
      layers += `<span class="pile-layer" style="transform:translate(${i * 2}px,${i * 2}px)"></span>`;
    }
    el.innerHTML = layers + `<span class="pile-top">🦴</span><span class="pile-count">${n}</span>`;
  }
}

/* Brief glow on a deck pile when its owner draws. */
function pulseDeckPile(pIdx) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(pIdx === 0 ? 'player-deck' : 'enemy-deck');
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth; // reflow → replay
  el.classList.add('pulse');
}

/* ---------- heroes ---------- */
function renderHero(pIdx) {
  const p = G.players[pIdx];
  const el = heroEl(pIdx);
  if (!el) return;
  el.classList.toggle('active-turn', G.active === pIdx && !G.over);

  let targetable = false;
  if (pIdx === 1 && G.active === 0 && !G.busy && !G.over && G.selectedAttacker) {
    targetable = validAttackTargets(0, G.selectedAttacker).leader;
  }
  el.classList.toggle('targetable', targetable);

  el.innerHTML = `
    <div class="portrait">${pIdx === 0 ? '🧔' : '🗿'}</div>
    <div class="hero-info">
      <div class="hero-name">${p.name}</div>
      <div class="hero-hp ${p.hp <= 10 ? 'low' : ''}">❤ ${Math.max(0, p.hp)}</div>
      <div class="hero-meta">🂠 Deck: ${p.deck.length}${pIdx === 1 ? ` · ✋ Hand: ${p.hand.length}` : ''}</div>
    </div>`;
}

/* ---------- amber gem clusters ---------- */
function renderAmber(pIdx) {
  const el = document.getElementById(pIdx === 0 ? 'player-amber' : 'enemy-amber');
  if (!el) return;
  const p = G.players[pIdx];
  let gems = '';
  for (let i = 0; i < p.maxAmber; i++) {
    gems += `<span class="gem ${i < p.amber ? 'full' : 'empty'}" style="animation-delay:${(i * 0.22).toFixed(2)}s"></span>`;
  }
  el.innerHTML = gems + `<span class="amber-label">${p.amber}/${p.maxAmber}</span>`;
  el.title = `${p.name} — Amber: ${p.amber}/${p.maxAmber}`;
}

/* ---------- boards ---------- */
function renderBoard(pIdx) {
  const el = document.getElementById(pIdx === 0 ? 'player-board' : 'enemy-board');
  if (!el) return;
  el.innerHTML = '';
  for (const c of G.players[pIdx].board) el.appendChild(creatureEl(c, pIdx));
}

function creatureEl(c, pIdx) {
  const d = document.createElement('div');
  d.className = `creature ctype-creature era-${c.era.toLowerCase()} tribe-${c.tribe.toLowerCase()}`;
  for (const a of c.abilities) d.classList.add('kw-' + a);
  if (c.legendary) d.classList.add('legendary');
  if (c.frenzyDone) d.classList.add('enraged');
  d.dataset.uid = c.uid;
  if (c.dying) d.classList.add(c.retreating ? 'retreating' : 'dying');
  if (c.justPlayed) d.classList.add('spawn');
  if (c.frozen) d.classList.add('frozen');
  if (c.stealthed) d.classList.add('stealthed');
  if (pIdx === 0 && G.active === 0 && !G.busy && !G.over && creatureReady(c)) {
    d.classList.add('ready');
  }
  if (G.selectedAttacker === c) d.classList.add('selected');

  let targetable = false;
  if (targetPicker) {
    targetable = targetPicker.targets.includes(c);
  } else if (G.active === 0 && !G.busy && !G.over && G.selectedAttacker && pIdx === 1) {
    targetable = validAttackTargets(0, G.selectedAttacker).creatures.includes(c);
  }
  if (targetable) d.classList.add('targetable');

  const ruleHTML = [
    c.onSummonText ? `<b>On Summon:</b> ${c.onSummonText}` : '',
    c.abilityText || '',
  ].filter(Boolean).join('<br>');
  if (ruleHTML) d.classList.add('has-ability');

  const showAtk = effAtk(c);
  const fearless = hasAb(c, 'fearless');
  const tooltip = `${c.name} — ${c.tribe} · ${c.era}\n` +
    `${showAtk} ATK / ${c.armor} Armor / ${Math.max(0, c.hp)}/${c.maxHp} HP / ` +
    `${fearless ? '∞' : Math.max(0, c.morale) + '/' + c.moraleMax} Morale` +
    (c.legendary ? '\n★ Legendary' : '') +
    (c.onSummonText ? '\nOn Summon: ' + c.onSummonText : '') +
    (c.abilityText ? '\n' + c.abilityText : '') +
    (c.abilities.length ? '\n' + c.abilities.map((a) => KEYWORD_HELP[a]).join('\n') : '');
  d.title = tooltip;

  d.innerHTML = `
    ${c.legendary ? '<div class="legendary-frame"></div><div class="lg-star">★</div>' : ''}
    ${artHTML(c.tplId, TRIBE_ICONS[c.tribe], 'c-art')}
    <div class="c-title">
      <div class="stat-badge stat-atk ${showAtk > c.baseAtk ? 'buffed' : ''}" title="Attack">${showAtk}</div>
      <div class="c-name">${c.name}</div>
      ${c.armor ? `<div class="stat-badge stat-armor" title="Armor">${c.armor}</div>` : ''}
      <div class="stat-badge stat-hp ${c.hp < c.maxHp ? 'hurt' : ''}" title="Health">${Math.max(0, c.hp)}</div>
      <div class="stat-badge stat-morale ${!fearless && c.morale < c.moraleMax ? 'shaken' : ''}"
        title="${fearless ? 'Fearless — infinite Morale' : 'Morale — retreats to hand at 0'}">${fearless ? '∞' : Math.max(0, c.morale)}</div>
    </div>
    ${ruleHTML ? `<div class="c-ability">${ruleHTML}</div>` : ''}
    ${c.frozen ? '<div class="frost">❄</div>' : ''}`;

  d.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onCreatureClick(pIdx, c);
  });
  return d;
}

/* ---------- hand ---------- */
function renderHand() {
  const handEl = document.getElementById('hand');
  if (!handEl) return;
  handEl.innerHTML = '';
  const p = G.players[0];
  const n = p.hand.length;
  const mid = (n - 1) / 2;
  let drawSeq = 0;
  p.hand.forEach((card, i) => {
    const el = handCardEl(card, p);
    // Perspective fan: rotate + lower cards toward the edges (transform-only,
    // so layout/scrolling are untouched). Flattens as the hand fills up.
    const off = n > 1 ? i - mid : 0;
    el.style.setProperty('--fan-r', `${(off * Math.min(3.2, 18 / n)).toFixed(2)}deg`);
    el.style.setProperty('--fan-y', `${(off * off * Math.min(1.2, 7 / n)).toFixed(1)}px`);
    // Draw-in animation for cards drawn since the last render (staggered).
    if (card._drawn) {
      delete card._drawn; // consume: replays must not trigger on later renders
      el.classList.add('drawn');
      el.style.animationDelay = `${(drawSeq++) * 0.12}s`;
    }
    handEl.appendChild(el);
  });

  /* Squeeze: overlap cards when the hand is crowded so the whole hand
     always fits the tray without scrolling (tray overflow is visible
     for the hover-lift, so scrolling is no longer an option). */
  requestAnimationFrame(() => {
    const kids = [...handEl.children];
    if (kids.length < 2 || !kids[0].offsetWidth) return;
    const cw = kids[0].offsetWidth;
    const gap = 10;
    const avail = handEl.clientWidth - 30;
    const total = kids.length * cw + (kids.length - 1) * gap;
    const over = total > avail ? Math.ceil((total - avail) / (kids.length - 1)) + gap : 0;
    kids.forEach((k, i) => {
      if (i) k.style.marginLeft = over ? `-${over}px` : '';
    });
  });
}

function handCardEl(card, p) {
  const d = document.createElement('div');
  d.className = `hand-card ctype-${card.type} era-${(card.era || 'none').toLowerCase()}`;
  if (card.type === 'creature') {
    d.classList.add('tribe-' + card.tribe.toLowerCase());
    for (const a of card.abilities) d.classList.add('kw-' + a);
    if (card.legendary) d.classList.add('legendary');
    else if (card.cost >= 7) d.classList.add('apex');
  }
  d.dataset.uid = card.uid;
  const affordable = card.cost <= p.amber;
  if (G.active === 0 && !G.busy && !G.over && affordable) d.classList.add('playable');

  let body;
  if (card.type === 'creature') {
    const kws = card.abilities.map((a) =>
      `<span class="kw" title="${KEYWORD_HELP[a]}">${KEYWORD_ICONS[a]} ${cap(a)}</span>`).join(' ');
    body = `
      ${artHTML(card.id, TRIBE_ICONS[card.tribe], 'card-art')}
      <div class="card-name">${card.name}</div>
      <div class="card-text">${kws || '&nbsp;'}</div>
      ${card.onSummon || card.ability ? `<div class="ability-text">${[
        card.onSummon ? `<b>On Summon:</b> ${card.onSummon.text}` : '',
        card.ability ? card.ability.text : '',
      ].filter(Boolean).join('<br>')}</div>` : ''}
      <div class="card-sub">${card.legendary ? '★ Legendary · ' : ''}${card.tribe} · ${card.era}</div>
      <div class="stat-badge stat-atk" title="Attack">${card.atk}</div>
      <div class="stat-badge stat-armor" title="Armor">${card.armor}</div>
      <div class="stat-badge stat-hp ${card._wounded ? 'hurt' : ''}" title="${card._wounded ? 'Wounded — heals 1 HP per turn in hand' : 'Health'}">${card._wounded ? card._wounded.hp : card.hp}</div>
      <div class="stat-badge stat-morale" title="${card.abilities.includes('fearless') ? 'Fearless — infinite Morale' : 'Morale — retreats to hand at 0'}">${card.abilities.includes('fearless') ? '∞' : card.morale}</div>`;
  } else if (card.type === 'event') {
    body = `
      ${artHTML(card.id, card.icon, 'card-art sigil')}
      <div class="card-name">${card.name}</div>
      <div class="card-text">${card.text}</div>
      <div class="card-sub">⚡ Event</div>`;
  } else {
    body = `
      ${artHTML(card.id, card.icon, 'biome-vista')}
      <div class="card-name">${card.name}</div>
      <div class="card-text">${card.text}</div>
      <div class="card-sub">🌍 Biome</div>`;
  }
  d.innerHTML = `${card.legendary ? '<div class="legendary-frame"></div><div class="lg-star">★</div>' : ''}` +
    `<div class="cost" title="Amber cost">${card.cost}</div>${body}`;

  /* Drag to play. */
  d.addEventListener('pointerdown', (ev) => {
    if (ev.button === 0) DND.start(card, d, ev);
  });

  /* Cursor tilt while hovering a playable card (cleared on leave). */
  d.addEventListener('pointermove', (ev) => {
    if (!d.classList.contains('playable')) return;
    const r = d.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width - 0.5;
    const py = (ev.clientY - r.top) / r.height - 0.5;
    d.style.setProperty('--tilt-x', `${(py * -8).toFixed(2)}deg`);
    d.style.setProperty('--tilt-y', `${(px * 10).toFixed(2)}deg`);
  });
  d.addEventListener('pointerleave', () => {
    d.style.removeProperty('--tilt-x');
    d.style.removeProperty('--tilt-y');
  });
  return d;
}

/* ---------- biome banner, controls, log ---------- */
function renderBiome() {
  const el = document.getElementById('biome-banner');
  if (!el) return;
  if (G.biome) {
    el.className = 'has-biome';
    el.innerHTML = `<span class="biome-icon">${G.biome.icon}</span> <strong>${G.biome.name}</strong> — ${G.biome.text}`;
  } else {
    el.className = '';
    el.innerHTML = 'No active biome';
  }
}

function renderControls() {
  const btn = document.getElementById('end-turn-btn');
  if (btn) btn.disabled = G.active !== 0 || G.busy || G.over;
  const hint = document.getElementById('hint');
  if (!hint) return;
  if (targetPicker) hint.textContent = targetPicker.prompt;
  else if (G.over) hint.textContent = G.winner === 0 ? 'Victory! Hit New Game for another clash.' : 'Defeat… Hit New Game to try again.';
  else if (G.active !== 0 || G.busy) {
    hint.textContent = G.active !== 0
      ? (NET.inMatch() ? `${G.players[1].name} is thinking…` : 'The Rival Chieftain is plotting…')
      : 'Resolving…';
  }
  else if (G.selectedAttacker) hint.textContent = `${G.selectedAttacker.name} — click a highlighted target to attack.`;
  else hint.textContent = 'Drag a card onto the battlefield to play it · click a glowing creature to attack.';
}

function renderLog() {
  if (typeof document === 'undefined' || !G) return;
  const el = document.getElementById('log-entries');
  if (!el) return;
  /* Entries are plain strings (public) or { t, p } (private to player p —
     only player 0's private lines are shown on this screen; see log()). */
  el.innerHTML = G.log.slice(-60)
    .filter((l) => typeof l === 'string' || l.p === 0)
    .map((l) => `<div class="log-line">${typeof l === 'string' ? l : l.t}</div>`)
    .join('');
  el.scrollTop = el.scrollHeight;
}

function showGameOver() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('game-over');
  if (!el) return;
  document.getElementById('game-over-title').textContent = G.winner === 0 ? '🏆 Victory!' : '💀 Defeat';
  document.getElementById('game-over-text').textContent = G.winner === 0
    ? 'The rival tribe has fallen. The primal lands are yours!'
    : 'Your tribe has been overrun. Better luck in the next age…';
  el.classList.remove('hidden');
}

function hideGameOver() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('game-over');
  if (el) el.classList.add('hidden');
}

/* ---------- interaction ---------- */

/* Run a player action while blocking further input. */
async function guarded(fn) {
  if (!G || G.busy || G.over || G.active !== 0) return;
  G.busy = true;
  render();
  try {
    await fn();
  } finally {
    if (G && !G.over && G.active === 0) G.busy = false;
    if (G) render();
  }
}

function onCreatureClick(pIdx, creature) {
  /* On Summon target picking runs while the play action is still busy —
     handle it before any of the usual guards. */
  if (targetPicker) {
    if (targetPicker.targets.includes(creature) && !creature.dying) {
      const p = targetPicker;
      targetPicker = null;
      p.resolve(creature);
    } else {
      FX.shake(elByUid(creature.uid));
    }
    return;
  }
  if (!G || G.busy || G.over || G.active !== 0 || creature.dying) return;

  if (pIdx === 0) {
    /* Select/deselect one of my creatures as attacker. */
    if (creatureReady(creature)) {
      G.selectedAttacker = G.selectedAttacker === creature ? null : creature;
      render();
    } else {
      FX.shake(elByUid(creature.uid));
    }
  } else if (G.selectedAttacker) {
    /* Attack an enemy creature. */
    const tset = validAttackTargets(0, G.selectedAttacker);
    if (tset.creatures.includes(creature)) {
      const attacker = G.selectedAttacker;
      G.selectedAttacker = null;
      if (NET.isGuest()) { NET.sendAttack(attacker.uid, creature.uid); return; }
      guarded(() => performAttack(0, attacker, creature));
    } else {
      FX.shake(elByUid(creature.uid));
    }
  }
}

function onEnemyHeroClick(ev) {
  if (ev) ev.stopPropagation();
  if (!G || G.busy || G.over || G.active !== 0 || !G.selectedAttacker) return;
  const tset = validAttackTargets(0, G.selectedAttacker);
  if (!tset.leader) {
    FX.shake(heroEl(1));
    log('A Taunt creature is in the way!');
    return;
  }
  const attacker = G.selectedAttacker;
  G.selectedAttacker = null;
  if (NET.isGuest()) { NET.sendAttack(attacker.uid, 'leader'); return; }
  guarded(() => performAttack(0, attacker, 'leader'));
}
