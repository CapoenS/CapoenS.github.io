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

/* ---------- keyword terms & hover popover ----------
   Keywords appear as underlined terms — both the icon+name chip list under a
   creature's name AND any keyword word inside rule/event text. Hovering one
   shows #kw-popover with the full rules, which is what lets card text stay
   short. KEYWORD_HELP / KEYWORD_ICONS come from cards.js. */

/* A centered row of keyword emblem badges (one per ability) that rides the
   top edge of a card. Real elements, so 2+ skills sit side by side. */
function emblemsHTML(abilities) {
  if (!abilities || !abilities.length) return '';
  const badges = abilities
    .map((a) => `<span class="kw-emblem" data-kw="${a}" title="${cap(a)}">${(typeof KEYWORD_ICONS !== 'undefined' && KEYWORD_ICONS[a]) || ''}</span>`)
    .join('');
  return `<div class="kw-emblems">${badges}</div>`;
}

/* Icon + underlined name, one chip per keyword. */
function keywordChips(abilities) {
  if (!abilities || !abilities.length) return '';
  return abilities
    .map((a) => `<span class="kw kw-term" data-kw="${a}">${(typeof KEYWORD_ICONS !== 'undefined' && KEYWORD_ICONS[a]) || ''} ${cap(a)}</span>`)
    .join(' ');
}

/* Wrap keyword words in a plain (no-HTML) rule/event string as .kw-term so
   they underline and share the hover popover. Handles simple inflections
   (Devour / Devours / Devouring). */
function linkifyKeywords(text) {
  if (!text || typeof KEYWORD_HELP === 'undefined') return text || '';
  let out = String(text);
  for (const kw of Object.keys(KEYWORD_HELP)) {
    const re = new RegExp(`\\b(${kw})(s|es|ing)?\\b`, 'gi');
    out = out.replace(re, (m) => `<span class="kw-term" data-kw="${kw}">${m}</span>`);
  }
  return out;
}

/* Short keyword rule text (KEYWORD_HELP with its "Keyword:" prefix trimmed). */
function keywordHelpBody(kw) {
  const help = (typeof KEYWORD_HELP !== 'undefined' && KEYWORD_HELP[kw]) || '';
  return help.replace(new RegExp('^\\s*' + kw + '\\s*:\\s*', 'i'), '');
}

/* Place a popover next to an anchor rect, flipping to stay on-screen. */
function _placePopover(pop, r) {
  pop.classList.add('show');
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = r.left, y = r.bottom + 8;
  if (x + pw > window.innerWidth - 8) x = window.innerWidth - pw - 8;
  if (x < 8) x = 8;
  if (y + ph > window.innerHeight - 8) y = r.top - ph - 8;   // flip above
  pop.style.left = x + 'px';
  pop.style.top = Math.max(8, y) + 'px';
}

/* Two event-delegated hover panels (they survive the full re-render each
   frame): #kw-popover on a .kw-term, and #card-popover — the BIG CARD
   modal — on a field creature or a hand card. Never both at once. */
function initKeywordPopover() {
  if (typeof document === 'undefined' || document.getElementById('kw-popover')) return;
  const kwPop = document.createElement('div');
  kwPop.id = 'kw-popover';
  kwPop.className = 'game-popover';
  const cardPop = document.createElement('div');
  cardPop.id = 'card-popover';
  cardPop.className = 'game-popover';
  document.body.appendChild(kwPop);
  document.body.appendChild(cardPop);
  let hideTimer = null;
  /* Anchor tracking: pointerover BUBBLES from every child of a card, so
     without this the panel would re-render and re-place itself on every
     inner element you cross — that is the "laggy" feel. While the anchor
     is unchanged the panel stays exactly where it is. */
  let kwAnchor = null;
  let cardAnchor = null;

  const showKw = (el) => {
    if (el === kwAnchor && kwPop.classList.contains('show')) return;
    const kw = el.dataset.kw;
    if (!keywordHelpBody(kw)) return;
    kwAnchor = el;
    cardPop.classList.remove('show');
    cardAnchor = null;
    kwPop.innerHTML = `<div class="kw-pop-title">${(KEYWORD_ICONS[kw] || '')} ${kw}</div>${keywordHelpBody(kw)}`;
    _placePopover(kwPop, el.getBoundingClientRect());
  };
  const showBigCard = (card, anchorEl) => {
    if (anchorEl === cardAnchor && cardPop.classList.contains('show')) return;
    cardAnchor = anchorEl;
    kwPop.classList.remove('show');
    kwAnchor = null;
    /* ONLY the card — skill rules ride inline on the big variant. */
    cardPop.innerHTML = `<div class="big-wrap">${fullCardHTML(card, 'big-card')}</div>`;
    _placePopover(cardPop, anchorEl.getBoundingClientRect());
  };
  const showCreature = (el) => {
    const c = findBoardCreature(el.dataset.uid);
    if (c) showBigCard(instToCard(c), el);
  };
  const showHand = (el) => {
    const card = G && G.players[0].hand.find((x) => String(x.uid) === el.dataset.uid);
    if (card && !card.hidden) showBigCard(card, el);
  };
  const hideAll = () => {
    kwPop.classList.remove('show');
    cardPop.classList.remove('show');
    kwAnchor = null;
    cardAnchor = null;
  };

  document.addEventListener('pointerover', (ev) => {
    const kwEl = ev.target.closest && ev.target.closest('.kw-term');
    if (kwEl && !kwEl.closest('#card-popover')) { clearTimeout(hideTimer); showKw(kwEl); return; }
    const cEl = ev.target.closest && ev.target.closest('#battlefield .creature');
    if (cEl) { clearTimeout(hideTimer); showCreature(cEl); return; }
    const hEl = ev.target.closest && ev.target.closest('#hand .hand-card');
    if (hEl) { clearTimeout(hideTimer); showHand(hEl); }
  });
  document.addEventListener('pointerout', (ev) => {
    if (ev.target.closest && (ev.target.closest('.kw-term')
      || ev.target.closest('#battlefield .creature') || ev.target.closest('#hand .hand-card'))) {
      hideTimer = setTimeout(hideAll, 60);
    }
  });
  /* Dragging or clicking a card must never fight the modal. */
  document.addEventListener('pointerdown', () => hideAll());
  /* Touch: tap a term / field creature to show, tap elsewhere to dismiss. */
  document.addEventListener('click', (ev) => {
    const kwEl = ev.target.closest && ev.target.closest('.kw-term');
    if (kwEl) { showKw(kwEl); return; }
    const cEl = ev.target.closest && ev.target.closest('#battlefield .creature');
    if (cEl) { showCreature(cEl); return; }
    hideAll();
  });
}

/* ---------- emote radial menu (click your own leader portrait) ---------- */
const EMOTES = ['👋', '😄', '😡', '😱', '👍', '🦖'];
let lastEmoteAt = 0;

function initEmoteMenu() {
  if (typeof document === 'undefined' || document.getElementById('emote-menu')) return;
  const menu = document.createElement('div');
  menu.id = 'emote-menu';
  menu.className = 'hidden';
  menu.innerHTML = EMOTES.map((e, i) =>
    `<button class="emote-opt" data-e="${e}" style="--i:${i};--n:${EMOTES.length}">${e}</button>`).join('');
  document.body.appendChild(menu);

  const hero = document.getElementById('player-hero');
  if (hero) {
    hero.addEventListener('click', (ev) => {
      if (!G) return;
      ev.stopPropagation();
      const r = hero.getBoundingClientRect();
      menu.style.left = (r.left + r.width / 2) + 'px';
      menu.style.top = (r.top + r.height / 2) + 'px';
      menu.classList.toggle('hidden');
    });
  }
  menu.addEventListener('click', (ev) => {
    const b = ev.target.closest('.emote-opt');
    if (!b) return;
    ev.stopPropagation();
    menu.classList.add('hidden');
    const now = Date.now();
    if (now - lastEmoteAt < 2500) return;   // gentle rate limit
    lastEmoteAt = now;
    showEmote(0, b.dataset.e);
    if (typeof NET !== 'undefined' && NET.inMatch()) NET.sendEmote(b.dataset.e);
  });
  document.addEventListener('click', () => menu.classList.add('hidden'));
}

/* An emote bubble beside a leader's panel (0 = local side, 1 = opponent). */
function showEmote(pIdx, emoji) {
  if (typeof document === 'undefined' || !emoji) return;
  const hero = heroEl(pIdx);
  if (!hero) return;
  const b = document.createElement('div');
  b.className = 'emote-bubble';
  b.textContent = emoji;
  const r = hero.getBoundingClientRect();
  b.style.left = (r.right + 8) + 'px';
  b.style.top = (r.top + r.height / 2) + 'px';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 2400);
}

/* The live board creature behind a uid (either side; lanes keep them here). */
function findBoardCreature(uid) {
  if (!G || uid == null) return null;
  for (const pl of G.players) {
    const c = pl.board.find((x) => String(x.uid) === String(uid));
    if (c) return c;
  }
  return null;
}

/* ---------- interactive target picker (On Summon effects) ----------
   uiChooseTarget() returns a Promise that resolves with the clicked
   creature. While active, valid targets pulse and other input waits.
   Headless (tests): resolves immediately with the first target. */
let targetPicker = null;

/* ---------- combat staging (local only — never enters G) ----------
   Pre-lock arrangement for declaring attacks / assigning blocks.
   Committed to the engine in one shot via declareAttack/commitBlocks.
   STAGE.mode: null | 'declare' | 'block'. */
const STAGE = {
  mode: null,
  lanes: [],          // declare: [uid, ...] in lane order
  stalkerPicks: {},   // declare: attackerUid -> enemy targetUid
  blocks: {},         // block: laneIdx -> blockerUid
  quicks: [],         // [{ cardUid, targetUid }] staged this window
};
let selectedUid = null;   // click-fallback selection (ui-local)

function clearCombatStage() {
  STAGE.mode = null;
  STAGE.lanes = [];
  STAGE.stalkerPicks = {};
  STAGE.blocks = {};
  STAGE.quicks = [];
  selectedUid = null;
}

/* Escape / backdrop click: drop the current selection (and an empty
   staging shell), keep real staged work unless Escape is hit twice. */
function uiClearSelection() {
  if (!G) return;
  if (targetPicker) { clearTargetPicker(); render(); return; }
  if (selectedUid !== null) { selectedUid = null; render(); return; }
  if (STAGE.mode) { clearCombatStage(); render(); }
}

function uiChooseTarget(targets, promptText, sourceUid) {
  if (typeof document === 'undefined') return Promise.resolve(targets[0]);
  return new Promise((resolve) => {
    targetPicker = { targets, resolve, prompt: promptText, sourceUid };
    render();
    if (sourceUid != null) drawTargetArrow();   // anchor the arrow at the source
  });
}

function clearTargetPicker() {
  if (!targetPicker) return;
  const p = targetPicker;
  targetPicker = null;
  hideTargetArrow();
  p.resolve(null);
}

/* ---------- targeting arrow (source card → cursor / hovered target) ---------- */
let arrowMouse = { x: 0, y: 0 };

function hideTargetArrow() {
  const svg = document.getElementById('target-arrow');
  if (svg) { svg.classList.remove('active'); svg.innerHTML = ''; }
}

function drawTargetArrow() {
  const svg = document.getElementById('target-arrow');
  if (!svg) return;
  if (!targetPicker || targetPicker.sourceUid == null) { hideTargetArrow(); return; }
  const src = elByUid(targetPicker.sourceUid);
  if (!src) { hideTargetArrow(); return; }
  const r = src.getBoundingClientRect();
  const x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
  let toX = arrowMouse.x, toY = arrowMouse.y;

  /* Snap the arrowhead to a valid target when hovering one. */
  const under = document.elementFromPoint(toX, toY);
  const cEl = under && under.closest && under.closest('.creature');
  let snapped = false;
  if (cEl && targetPicker.targets.some((t) => String(t.uid) === cEl.dataset.uid)) {
    const cr = cEl.getBoundingClientRect();
    toX = cr.left + cr.width / 2; toY = cr.top + cr.height / 2;
    snapped = true;
  }

  const mx = (x1 + toX) / 2, my = (y1 + toY) / 2 - 46;   // arch the curve upward
  const ang = Math.atan2(toY - my, toX - mx);
  const ah = 15;
  const a1 = ang + Math.PI - 0.42, a2 = ang + Math.PI + 0.42;
  const col = snapped ? '#7ee081' : '#64d8ff';
  svg.innerHTML =
    `<path d="M ${x1} ${y1} Q ${mx} ${my} ${toX} ${toY}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" opacity="0.85"/>` +
    `<circle cx="${x1}" cy="${y1}" r="6" fill="${col}"/>` +
    `<polygon points="${toX},${toY} ${toX + ah * Math.cos(a1)},${toY + ah * Math.sin(a1)} ${toX + ah * Math.cos(a2)},${toY + ah * Math.sin(a2)}" fill="${col}"/>`;
  svg.classList.add('active');
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
  renderEnemyHand();
  renderField(0);
  renderField(1);
  renderBattle(0);
  renderBattle(1);
  renderAmber(0);
  renderAmber(1);
  renderDeckPiles();
  renderHand();
  renderBiome();
  renderSpellQueue();
  renderControls();
  renderLog();
  /* Online host: every distinct render is broadcast to the guest (NET
     dedupes), so intermediate states (deaths, retreats, spawns) stream
     over as they happen — the guest's whole view of the game. */
  if (typeof NET !== 'undefined') NET.onRender();
}

/* ---------- combat view (merges committed G.combat + local STAGE) ----------
   Returns { attackerIdx, lanes: [{aUid, bUid, stalkerLock}] } describing what
   to draw on the two battle rows, or null when there is nothing in combat. */
function combatView() {
  if (G.combat) {
    const lanes = G.combat.lanes.map((l) => ({ aUid: l.aUid, bUid: l.bUid, stalkerLock: l.stalkerLock }));
    /* Local defender staging overlays proposed blocks onto the lanes. */
    if (STAGE.mode === 'block') {
      for (const [laneIdx, uid] of Object.entries(STAGE.blocks)) {
        if (lanes[laneIdx] && !lanes[laneIdx].stalkerLock) lanes[laneIdx].bUid = uid;
      }
    }
    return { attackerIdx: G.combat.attackerIdx, lanes };
  }
  if (STAGE.mode === 'declare') {
    /* I (player 0) am arranging an attack that hasn't been committed. */
    return {
      attackerIdx: 0,
      lanes: STAGE.lanes.map((uid) => ({
        aUid: uid,
        bUid: STAGE.stalkerPicks[uid] || null,
        stalkerLock: !!STAGE.stalkerPicks[uid],
      })),
    };
  }
  return null;
}

/* uids that currently sit in a battle lane for player pIdx. */
function lanedUidsFor(pIdx) {
  const view = combatView();
  const set = new Set();
  if (!view) return set;
  for (const lane of view.lanes) {
    const uid = pIdx === view.attackerIdx ? lane.aUid : lane.bUid;
    if (uid != null) set.add(uid);
  }
  return set;
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

/* ---------- player side panels (left edge) ---------- */
function renderHero(pIdx) {
  const p = G.players[pIdx];
  const el = heroEl(pIdx);
  if (!el) return;
  const isAttacker = !!G.combat && G.combat.attackerIdx === pIdx;
  const isDefender = !!G.combat && G.combat.attackerIdx === 1 - pIdx;
  const actor = G.combat ? combatActor() : (G.over ? -1 : G.active);

  el.classList.toggle('active-turn', !G.combat && G.active === pIdx && !G.over);
  el.classList.toggle('attacking', isAttacker);
  el.classList.toggle('defending', isDefender);
  el.classList.toggle('to-act', actor === pIdx && !G.over);   // the side we're waiting on
  el.classList.toggle('leader-low', p.hp <= 10);

  /* A clear label of what this player is doing right now. */
  let badge = '';
  if (!G.over) {
    if (G.combat) badge = isAttacker ? '⚔ Attacking' : '🛡 Defending';
    else if (G.active === pIdx) badge = pIdx === 0 ? '▶ Your Turn' : '▶ Their Turn';
    else badge = 'Waiting';
  }

  el.innerHTML = `
    <div class="sp-turn">${badge}</div>
    <div class="portrait">${pIdx === 0 ? '🧔' : '🗿'}</div>
    <div class="sp-name">${p.name}</div>
    <div class="sp-hp ${p.hp <= 10 ? 'low' : ''}">❤ ${Math.max(0, p.hp)}</div>
    <div class="sp-meta">🂠 ${p.deck.length}${pIdx === 1 ? ` · ✋ ${p.hand.length}` : ''}</div>`;
}

/* ---------- amber gem clusters ---------- */
function renderAmber(pIdx) {
  const el = document.getElementById(pIdx === 0 ? 'player-amber' : 'enemy-amber');
  if (!el) return;
  const p = G.players[pIdx];
  /* Locally, show amber left after staged quick events would be paid. */
  const shown = pIdx === 0 && STAGE.quicks.length ? availableAmber() : p.amber;
  /* Sandbox: the local player's amber is bottomless — a full tray + ∞. */
  const infinite = G.sandbox && pIdx === 0;
  const maxShow = infinite ? 10 : p.maxAmber;
  const curShow = infinite ? 10 : shown;
  let gems = '';
  for (let i = 0; i < maxShow; i++) {
    gems += `<span class="gem ${i < curShow ? 'full' : 'empty'}" style="animation-delay:${(i * 0.22).toFixed(2)}s"></span>`;
  }
  const label = infinite ? '∞'
    : shown === p.amber ? `${p.amber}/${p.maxAmber}` : `${shown}/${p.maxAmber} (−${p.amber - shown})`;
  /* Quick-amber bar: 3 lightning pips, quick events only, drained first. */
  const q = pIdx === 0 && STAGE.quicks.length ? availableQmber() : (p.qmber || 0);
  const qmax = p.qmberMax || 3;
  let qpips = '';
  for (let i = 0; i < qmax; i++) qpips += `<span class="qpip ${i < q ? 'full' : 'empty'}"></span>`;
  el.innerHTML = gems + `<span class="amber-label">${label}</span>` +
    `<div class="quick-bar" title="Quick Amber ${q}/${qmax} — spent only by ⚡ quick events (used first). Refills on your turn AND after every combat.">⚡${qpips}</div>`;
  el.title = `${p.name} — Amber: ${infinite ? '∞' : shown + '/' + p.maxAmber}`;
}

/* ---------- center spell queue (round tokens, casting order) ----------
   Each queued quick spell shows a token: you see your own spell's icon,
   the opponent's queued spells show a '?'. Ordered by cast sequence
   (attacker's first). Includes my not-yet-committed staged spells. */
function renderSpellQueue() {
  const el = document.getElementById('spell-queue');
  if (!el) return;
  const tokens = [];
  if (G.combat) {
    for (const q of G.combat.quicks) {
      const mine = q.side === 0 && !q.hidden && q.card;   // side 0 = local player, everything else hidden
      tokens.push(mine ? { icon: q.card.icon, name: q.card.name } : { icon: '?', name: null });
    }
  }
  for (const sq of STAGE.quicks) {                        // my staged (pending) spells
    const c = G.players[0].hand.find((x) => x.uid === sq.cardUid);
    if (c) tokens.push({ icon: c.icon, name: c.name, pending: true });
  }
  el.classList.toggle('has-spells', tokens.length > 0);
  el.innerHTML = tokens.map((t, i) =>
    `<div class="spell-token ${t.name ? 'mine' : 'hidden'} ${t.pending ? 'pending' : ''}" title="${t.name || 'A hidden spell is queued'}">` +
    `<span class="st-order">${i + 1}</span><span class="st-icon">${t.icon}</span></div>`).join('');
}

/* ---------- opponent hand (face-down backs; count visible, contents hidden) ---------- */
function renderEnemyHand() {
  const el = document.getElementById('enemy-hand');
  if (!el) return;
  const n = G.players[1].hand.length;
  el.innerHTML = '';
  el.title = `${G.players[1].name} — ${n} card${n === 1 ? '' : 's'} in hand`;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'card-back';
    c.innerHTML = '<span class="card-back-mark">?</span>';
    /* Gentle fan so a full hand still fits the strip. */
    const off = n > 1 ? i - mid : 0;
    c.style.setProperty('--cb-r', `${(off * Math.min(2.4, 12 / n)).toFixed(2)}deg`);
    if (i) c.style.marginLeft = n > 8 ? '-14px' : '-6px';
    el.appendChild(c);
  }
}

/* ---------- field row (summon zone = p.board minus lane occupants) ---------- */
function renderField(pIdx) {
  const el = document.getElementById(pIdx === 0 ? 'player-field' : 'enemy-field');
  if (!el) return;
  el.innerHTML = '';
  const laned = lanedUidsFor(pIdx);
  /* When I'm arranging blocks, my field is a drop source; mark it. */
  el.classList.toggle('drop-ready', pIdx === 0 && STAGE.mode === 'block');
  for (const c of G.players[pIdx].board) {
    if (laned.has(c.uid)) continue;
    el.appendChild(creatureEl(c, pIdx, 'field'));
  }
}

/* ---------- battle row (combat lanes, aligned by column) ---------- */
function renderBattle(pIdx) {
  const el = document.getElementById(pIdx === 0 ? 'player-battle' : 'enemy-battle');
  if (!el) return;
  el.innerHTML = '';
  const view = combatView();
  el.classList.toggle('active-combat', !!view);
  if (!view) return;                                  // collapsed strip when idle

  const iAmActingDefender = pIdx === 0 && G.combat && G.combat.phase === 'block' && actingSide() === 0;
  view.lanes.forEach((lane, i) => {
    const uid = pIdx === view.attackerIdx ? lane.aUid : lane.bUid;
    const slot = document.createElement('div');
    slot.className = 'lane-slot';
    slot.dataset.lane = i;
    const c = uid != null ? G.players[pIdx].board.find((x) => x.uid === uid) : null;
    if (c) {
      const role = pIdx === view.attackerIdx ? 'attacking' : 'blocking';
      const cel = creatureEl(c, pIdx, role);
      if (lane.stalkerLock) cel.classList.add('stalker-locked');
      slot.appendChild(cel);
    } else {
      slot.classList.add('empty');
      /* Highlight lanes the local defender may drop a blocker into. */
      if (iAmActingDefender && !lane.stalkerLock) {
        const atk = G.players[view.attackerIdx].board.find((x) => x.uid === lane.aUid);
        if (atk && !atk.stealthed && !atk.dying) {
          slot.classList.add('blockable');
          slot.innerHTML = '<span class="lane-hint">🛡</span>';
        }
      }
    }
    if (iAmActingDefender) {
      slot.addEventListener('click', (ev) => { ev.stopPropagation(); onLaneClick(i); });
    }
    el.appendChild(slot);
  });
}

function creatureEl(c, pIdx, zone = 'field') {
  const d = document.createElement('div');
  d.className = `creature ctype-creature era-${c.era.toLowerCase()} tribe-${c.tribe.toLowerCase()}`;
  for (const a of c.abilities) d.classList.add('kw-' + a);
  if (c.legendary) d.classList.add('legendary');
  if (c.frenzyDone) d.classList.add('enraged');
  d.dataset.uid = c.uid;
  if (c.dying) d.classList.add(c.retreating ? 'retreating' : 'dying');
  if (c.justPlayed) d.classList.add('spawn');
  /* Legendary entrances: stay cloaked until FX.legendarySummon drops it in. */
  if (c.justPlayed && c.legendary) d.classList.add('pre-summon');
  if (c.frozen) d.classList.add('frozen');
  if (c.stealthed) d.classList.add('stealthed');
  if (zone === 'attacking') d.classList.add('attacking');
  if (zone === 'blocking') d.classList.add('blocking');

  /* Can I pick this creature up right now? (After the turn's attack wave,
     only Energetic creatures with an attack left may form a second one.) */
  const canDeclare = pIdx === 0 && !G.combat && actingSide() === 0
    && (!G.attackUsed || hasAb(c, 'energetic'))
    && creatureReady(c) && (STAGE.mode === null || STAGE.mode === 'declare');
  const canBlockDrag = pIdx === 0 && G.combat && G.combat.phase === 'block' && actingSide() === 0
    && zone === 'field' && canBlock(c);
  if (zone === 'field' && (canDeclare || canBlockDrag)) d.classList.add('ready');
  d.dataset.draggable = (canDeclare || canBlockDrag) ? '1' : '';

  if (selectedUid === c.uid) d.classList.add('selected');
  if (targetPicker && targetPicker.targets.includes(c)) d.classList.add('targetable');

  /* Board slabs are Hearthstone-minimal: full-bleed art + the four stat
     badges. No name, no rule text — the big card modal on hover (see
     initKeywordPopover) carries the full readout. */
  const showAtk = effAtk(c);
  const fearless = hasAb(c, 'fearless');

  d.innerHTML = `
    ${c.legendary ? '<div class="legendary-frame"></div><div class="lg-star">★</div>' : ''}
    ${emblemsHTML(c.abilities)}
    ${artHTML(c.tplId, TRIBE_ICONS[c.tribe], 'c-art')}
    <div class="stat-badge stat-atk ${showAtk > c.baseAtk ? 'buffed' : ''}" title="Attack">${showAtk}</div>
    ${c.armor ? `<div class="stat-badge stat-armor" title="Armor">${c.armor}</div>` : ''}
    <div class="stat-badge stat-hp ${c.hp < c.maxHp ? 'hurt' : ''}" title="Health">${Math.max(0, c.hp)}</div>
    <div class="stat-badge stat-morale ${!fearless && c.morale < c.moraleMax ? 'shaken' : ''}"
      title="${fearless ? 'Fearless — infinite Morale' : 'Morale — retreats to hand at 0'}">${fearless ? '∞' : Math.max(0, c.morale)}</div>
    ${c.frozen ? '<div class="frost">❄</div>' : ''}`;

  if (d.dataset.draggable === '1') {
    d.addEventListener('pointerdown', (ev) => {
      if (ev.button === 0) DND.startCreature(c, d, ev, (G.combat && G.combat.phase === 'block') ? 'block' : 'declare');
    });
  }
  d.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onCreatureClick(pIdx, c, zone);
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

/* Class list shared by hand cards, the big hover modal and the play
   reveal. `card` may be a template, a hand card, or the card-shaped view
   of a live board instance (see instToCard). */
function cardClassList(card) {
  let cls = `ctype-${card.type} era-${(card.era || 'none').toLowerCase()}`;
  if (card.type === 'creature') {
    cls += ` tribe-${card.tribe.toLowerCase()}`;
    for (const a of card.abilities) cls += ` kw-${a}`;
    if (card.legendary) cls += ' legendary';
    else if (card.cost >= 7) cls += ' apex';
  }
  if (card.type === 'event' && card.quick) cls += ' quick-event';
  return cls;
}

/* The full card face (art, name, skills, rules, stat gems) — one renderer
   for the hand, the big hover modal, and the opponent's play reveal.
   Creatures: no tribe/era line — that area lists the attack skills, one
   per line in a small font (the big modal adds each skill's rule text
   inline). All abilities share ONE parchment text field. */
function cardBodyHTML(card, big) {
  if (card.type === 'creature') {
    const kwLines = (card.abilities || []).map((a) =>
      `<div class="kw-line"><span class="kw-term" data-kw="${a}">${(typeof KEYWORD_ICONS !== 'undefined' && KEYWORD_ICONS[a]) || ''} ${cap(a)}</span>` +
      `${big ? `<span class="kw-rule"> — ${keywordHelpBody(a)}</span>` : ''}</div>`).join('');
    const hp = card._wounded ? card._wounded.hp : card.hp;
    const hurt = card._wounded || card._hurt;
    return `
      ${artHTML(card.id, TRIBE_ICONS[card.tribe], 'card-art')}
      <div class="card-name">${card.name}</div>
      <div class="kw-list">${kwLines}</div>
      ${card.onSummon || card.ability ? `<div class="ability-text">${[
        card.onSummon ? `<b>On Summon:</b> ${linkifyKeywords(card.onSummon.text)}` : '',
        card.ability ? linkifyKeywords(card.ability.text) : '',
      ].filter(Boolean).join('<br>')}</div>` : ''}
      <div class="stat-badge stat-atk ${card._buffed ? 'buffed' : ''}" title="Attack">${card.atk}</div>
      <div class="stat-badge stat-armor" title="Armor">${card.armor}</div>
      <div class="stat-badge stat-hp ${hurt ? 'hurt' : ''}" title="${card._wounded ? 'Wounded — heals 1 HP per turn in hand' : 'Health'}">${hp}</div>
      <div class="stat-badge stat-morale" title="${card.abilities.includes('fearless') ? 'Fearless — infinite Morale' : 'Morale — retreats to hand at 0'}">${card.abilities.includes('fearless') ? '∞' : card.morale}</div>`;
  }
  if (card.type === 'event') {
    return `
      ${artHTML(card.id, card.icon, 'card-art sigil' + (card.quick ? ' quick' : ''))}
      <div class="card-name">${card.name}</div>
      <div class="card-text">${linkifyKeywords(card.text)}</div>
      <div class="card-sub">${card.quick ? '⚡ Quick' : '📜 Event'}</div>`;
  }
  return `
      ${artHTML(card.id, card.icon, 'biome-vista')}
      <div class="card-name">${card.name}</div>
      <div class="card-text">${linkifyKeywords(card.text)}</div>
      <div class="card-sub">🌍 Biome</div>`;
}

/* A complete card as an HTML string (used by the hover modal + reveal).
   The big variant carries each skill's rule inline on the card itself. */
function fullCardHTML(card, extraClass = '') {
  const big = extraClass.includes('big-card');
  return `<div class="hand-card ${extraClass} ${cardClassList(card)}">` +
    `${card.legendary ? '<div class="legendary-frame"></div><div class="lg-star">★</div>' : ''}` +
    `${card.type === 'creature' ? emblemsHTML(card.abilities) : ''}` +
    `<div class="cost" title="Amber cost">${card.cost}</div>${cardBodyHTML(card, big)}</div>`;
}

/* Card-shaped view of a live board instance — the big modal shows the
   creature's CURRENT stats, not the printed ones. */
function instToCard(c) {
  return {
    id: c.tplId, type: 'creature', name: c.name, cost: c.cost,
    tribe: c.tribe, era: c.era, legendary: c.legendary,
    abilities: c.abilities,
    onSummon: c.onSummonText ? { text: c.onSummonText } : null,
    ability: c.abilityText ? { text: c.abilityText } : null,
    atk: effAtk(c), armor: c.armor, hp: Math.max(0, c.hp),
    morale: hasAb(c, 'fearless') ? c.morale : Math.max(0, c.morale),
    _buffed: effAtk(c) > c.baseAtk,
    _hurt: c.hp < c.maxHp,
  };
}

function handCardEl(card, p) {
  const d = document.createElement('div');
  d.className = `hand-card ${cardClassList(card)}`;
  d.dataset.uid = card.uid;
  const staged = STAGE.quicks.some((q) => q.cardUid === card.uid);
  const affordable = localAfford(card);
  if (staged) d.classList.add('staged-quick');
  /* Playable: normal main-phase plays, OR a quick event during a combat
     staging window. */
  else if (affordable) {
    if (!G.combat && !STAGE.mode && actingSide() === 0) d.classList.add('playable');
    else if (card.type === 'event' && card.quick && canStageQuick()) d.classList.add('playable');
  }

  d.innerHTML = `${card.legendary ? '<div class="legendary-frame"></div><div class="lg-star">★</div>' : ''}` +
    `${card.type === 'creature' ? emblemsHTML(card.abilities) : ''}` +
    `<div class="cost" title="Amber cost">${card.cost}</div>${cardBodyHTML(card)}`;

  /* Main-phase plays drag; quick events during a combat window are
     staged by click (drop targets don't exist mid-combat). */
  d.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (card.type === 'event' && card.quick && canStageQuick()) return;  // handled by click
    DND.start(card, d, ev);
  });
  d.addEventListener('click', (ev) => {
    if (card.type === 'event' && card.quick && (canStageQuick() || STAGE.quicks.some((q) => q.cardUid === card.uid))) {
      ev.stopPropagation();
      stageQuick(card);
    }
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

/* Biomes that have ground art in assets/biomes/ (see "biome field art"
   in styles.css). Only these switch the field to outline-rows + themed
   banner; the rest keep the plain table. */
const BIOME_FIELD_ART = new Set([
  'glacial_tundra', 'carboniferous_jungle', 'fern_prairie',
  'panthalassa_ocean', 'volcanic_wastes',
]);

/* The two art halves must end exactly at the banner's edges (the banner
   itself fills the middle — the halves never meet). The split point is a
   layout fact (rows flex, battle rows expand in combat), so measure it and
   hand it to CSS as --biome-split-top/-bottom. Re-measured on every render,
   on window resize, and when a battle row finishes its expand transition. */
function positionBiomeArt() {
  const stack = document.getElementById('field-stack');
  const banner = document.getElementById('biome-banner');
  if (!stack || !banner) return;
  const s = stack.getBoundingClientRect();
  const b = banner.getBoundingClientRect();
  stack.style.setProperty('--biome-split-top', Math.max(0, b.top - s.top).toFixed(1) + 'px');
  stack.style.setProperty('--biome-split-bottom', Math.max(0, s.bottom - b.bottom).toFixed(1) + 'px');
}
let biomeArtHooked = false;

function renderBiome() {
  const el = document.getElementById('biome-banner');
  if (!el) return;
  /* Biome ground art: CSS keys the two field halves' backgrounds off this
     attribute (see "biome field art" in styles.css). Fades in/out there. */
  const stack = document.getElementById('field-stack');
  if (stack) {
    stack.dataset.biome = G.biome ? G.biome.id : '';
    stack.classList.toggle('biome-art', !!G.biome && BIOME_FIELD_ART.has(G.biome.id));
    if (!biomeArtHooked) {
      biomeArtHooked = true;
      window.addEventListener('resize', positionBiomeArt);
      stack.addEventListener('transitionend', positionBiomeArt);
    }
    positionBiomeArt();
  }
  if (G.biome) {
    el.className = 'has-biome';
    el.innerHTML = `<span class="biome-icon">${G.biome.icon}</span> <strong>${G.biome.name}</strong> — ${G.biome.text}`;
  } else {
    el.className = '';
    el.innerHTML = 'No active biome';
  }
}

function renderControls() {
  const sbBtn = document.getElementById('sandbox-btn');
  if (sbBtn) sbBtn.classList.toggle('screen-hidden', !G.sandbox);
  const endBtn = document.getElementById('end-turn-btn');
  const combatBtn = document.getElementById('combat-btn');
  const cancelBtn = document.getElementById('combat-cancel-btn');
  const phase = G.combat ? G.combat.phase : null;
  const iDefend = phase === 'block' && actingSide() === 0;
  const iCast = (phase === 'attackerCast' || phase === 'defenderCast') && actingSide() === 0;

  if (endBtn) {
    endBtn.disabled = !!G.combat || STAGE.mode !== null || G.active !== 0 || G.busy || G.over;
    endBtn.classList.toggle('hidden', !!G.combat || STAGE.mode === 'block');
  }
  if (combatBtn) {
    if (STAGE.mode === 'declare') {
      combatBtn.classList.remove('hidden');
      combatBtn.textContent = `⚔ Attack! (${STAGE.lanes.length})`;
      combatBtn.disabled = STAGE.lanes.length === 0;
    } else if (iDefend) {
      combatBtn.classList.remove('hidden');
      const n = Object.keys(STAGE.blocks).length;
      combatBtn.textContent = n ? `🛡 Confirm Blocks (${n})` : '🛡 No Blocks';
      combatBtn.disabled = false;
    } else if (iCast) {
      combatBtn.classList.remove('hidden');
      combatBtn.textContent = STAGE.quicks.length ? `⚡ Cast Spells (${STAGE.quicks.length})` : '✔ Pass';
      combatBtn.disabled = false;
    } else {
      combatBtn.classList.add('hidden');
    }
  }
  if (cancelBtn) {
    const canCancel = STAGE.mode === 'declare'
      || (iDefend && Object.keys(STAGE.blocks).length)
      || (iCast && STAGE.quicks.length);
    cancelBtn.classList.toggle('hidden', !canCancel);
  }

  const hint = document.getElementById('hint');
  if (!hint) return;
  const oppName = NET.inMatch() ? G.players[1].name : 'The Rival Chieftain';
  if (targetPicker) hint.textContent = targetPicker.prompt;
  else if (G.over) hint.textContent = G.winner === 0 ? 'Victory! Hit New Game for another clash.' : 'Defeat… Hit New Game to try again.';
  else if (phase === 'resolving') hint.textContent = '⚔ Combat!';
  else if (phase === 'block') {
    hint.textContent = iDefend
      ? '🛡 Drag creatures into the lanes to block, then Confirm.'
      : `${oppName} is choosing blockers…`;
  }
  else if (phase === 'attackerCast') {
    hint.textContent = iCast
      ? '⚡ Blocks are set — cast quick spells (click them), then Cast or Pass.'
      : `${oppName} is preparing spells…`;
  }
  else if (phase === 'defenderCast') {
    hint.textContent = iCast
      ? '⚡ Last chance — cast quick spells, then Cast or Pass.'
      : `${oppName} is preparing spells…`;
  }
  else if (STAGE.mode === 'declare') hint.textContent = '⚔ Drag creatures forward into your battle line, then hit Attack!';
  else if (G.active !== 0 || G.busy) {
    hint.textContent = G.active !== 0 ? `${oppName} is ${NET.inMatch() ? 'thinking' : 'plotting'}…` : 'Resolving…';
  }
  else hint.textContent = 'Drag a card to play it · drag a glowing creature forward to attack.';
}

/* ---------- combat staging actions (local; commit via the buttons) ---------- */

/* Add or remove one of my ready creatures from the staged attack. */
async function stageToggleAttacker(uid) {
  if (G.combat || actingSide() !== 0) return;
  const c = G.players[0].board.find((x) => x.uid === uid);
  if (!c || !creatureReady(c)) return;
  if (G.attackUsed && !hasAb(c, 'energetic')) return;   // 2nd wave: Energetic only
  const at = STAGE.lanes.indexOf(uid);
  if (at >= 0) {
    STAGE.lanes.splice(at, 1);
    delete STAGE.stalkerPicks[uid];
    if (!STAGE.lanes.length && !STAGE.quicks.length) STAGE.mode = null;
    render();
    return;
  }
  if (STAGE.lanes.length >= 7) return;
  STAGE.mode = 'declare';
  /* Stalker: choose the enemy creature it drags into the lane. */
  if (hasAb(c, 'stalker')) {
    const taken = new Set(Object.values(STAGE.stalkerPicks));
    const targets = G.players[1].board.filter((t) => canBlock(t) && !t.stealthed && !taken.has(t.uid));
    if (targets.length) {
      const t = await uiChooseTarget(targets, `${c.name} — Stalker: choose the creature it hunts down.`, c.uid);
      if (!t) { if (!STAGE.lanes.length) STAGE.mode = null; render(); return; }
      STAGE.stalkerPicks[uid] = t.uid;
    }
  }
  STAGE.lanes.push(uid);
  render();
}

/* Assign one of my creatures as the blocker for a lane (or clear it). */
function stageAssignBlock(laneIdx, uid) {
  if (!G.combat || G.combat.phase !== 'block' || actingSide() !== 0) return;
  const lane = G.combat.lanes[laneIdx];
  if (!lane || lane.stalkerLock) return;
  const attacker = G.players[G.combat.attackerIdx].board.find((x) => x.uid === lane.aUid);
  if (!attacker || attacker.stealthed || attacker.dying) return;
  if (uid == null) { delete STAGE.blocks[laneIdx]; render(); return; }
  const c = G.players[0].board.find((x) => x.uid === uid);
  if (!c || !canBlock(c)) return;
  STAGE.mode = 'block';
  /* One lane per blocker: drop it from any other lane first. */
  for (const k of Object.keys(STAGE.blocks)) if (STAGE.blocks[k] === uid) delete STAGE.blocks[k];
  STAGE.blocks[laneIdx] = uid;
  selectedUid = null;
  render();
}

/* The combat button routes to the right commit for the current phase. */
function commitCombatStage() {
  if (!G) return;
  if (!G.combat && STAGE.mode === 'declare') { commitDeclareStage(); return; }
  if (!G.combat) return;
  if (G.combat.phase === 'block' && actingSide() === 0) { commitBlockStage(); return; }
  if ((G.combat.phase === 'attackerCast' || G.combat.phase === 'defenderCast') && actingSide() === 0) commitCastStage();
}

function commitDeclareStage() {
  if (STAGE.mode !== 'declare' || !STAGE.lanes.length) return;
  const decl = {
    lanes: STAGE.lanes.map((uid) => {
      const l = { uid };
      if (STAGE.stalkerPicks[uid] != null) l.stalkerTargetUid = STAGE.stalkerPicks[uid];
      return l;
    }),
  };
  clearCombatStage();
  if (NET.isGuest()) { NET.sendCombatDeclare(decl); return; }
  guarded(() => declareAttack(0, decl));
}

/* Commit my spell window (attacker or defender cast phase). */
function commitCastStage() {
  if (!G || !G.combat || actingSide() !== 0) return;
  const phase = G.combat.phase;
  const decl = { quicks: STAGE.quicks.slice() };
  clearCombatStage();
  if (NET.isGuest()) {
    if (phase === 'attackerCast') NET.sendCombatAttackerCast(decl);
    else NET.sendCombatDefenderCast(decl);
    return;
  }
  if (phase === 'attackerCast') guarded(() => commitAttackerCast(0, decl));
  else guarded(() => commitDefenderCast(0, decl));
}

/* ---------- quick-event staging (combat cast windows) ---------- */

/* Is my spell window open right now? Spells are cast only in the two
   dedicated cast phases (attacker after blocks, then defender). */
function canStageQuick() {
  if (!G || G.busy || G.over || !G.combat) return false;
  const phase = G.combat.phase;
  return (phase === 'attackerCast' || phase === 'defenderCast') && actingSide() === 0;
}

/* Staged (not yet committed) quick spells' total cost. */
function stagedQuickCost() {
  return STAGE.quicks.reduce((s, q) => {
    const c = G.players[0].hand.find((x) => x.uid === q.cardUid);
    return s + (c ? c.cost : 0);
  }, 0);
}

/* My amber / quick-amber after staged quick events would be paid.
   Staged costs drain the quick bar first, mirroring payCost(). */
function availableAmber() {
  const p = G.players[0];
  return p.amber - Math.max(0, stagedQuickCost() - (p.qmber || 0));
}
function availableQmber() {
  const p = G.players[0];
  return Math.max(0, (p.qmber || 0) - stagedQuickCost());
}

/* Can I afford this card right now (staging-aware; quicks add the bar)? */
function localAfford(card) {
  return card.cost <= availableAmber() + (isQuickCard(card) ? availableQmber() : 0);
}

/* Queue (or un-queue) a quick event for the current combat window. */
async function stageQuick(card) {
  if (!canStageQuick() || card.type !== 'event' || !card.quick) return;
  const already = STAGE.quicks.findIndex((q) => q.cardUid === card.uid);
  if (already >= 0) { STAGE.quicks.splice(already, 1); render(); return; }
  if (!localAfford(card)) { FX.shake(document.querySelector(`.hand-card[data-uid="${card.uid}"]`)); return; }
  let targetUid;
  if (eventNeedsTarget(card)) {
    const targets = eventTargets(0, card);
    if (!targets.length) { log(`${card.name}: no valid target right now.`); return; }
    const t = await uiChooseTarget(targets, `${card.name} — choose a target.`, card.uid);
    if (!t) return;
    targetUid = t.uid;
  }
  STAGE.quicks.push({ cardUid: card.uid, targetUid });
  render();
}

function commitBlockStage() {
  if (!G.combat || G.combat.phase !== 'block' || actingSide() !== 0) return;
  const decl = {
    blocks: Object.entries(STAGE.blocks).map(([lane, uid]) => ({ lane: Number(lane), uid })),
  };
  clearCombatStage();
  if (NET.isGuest()) { NET.sendCombatBlocks(decl); return; }
  guarded(() => commitBlocks(0, decl));
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
  /* Un-shatter the hero panels for the next game (FX.heroDeath hides them). */
  for (const id of ['player-hero', 'enemy-hero']) {
    const h = document.getElementById(id);
    if (h) { h.style.visibility = ''; h.classList.remove('hero-dying'); }
  }
}

/* ---------- interaction ---------- */

/* Run a player action while blocking further input. Phase-aware:
   actingSide() covers both "my turn" and "I am the defender in the
   block phase". busy is NOT reset while a combat exists — the combat
   flow (declareAttack handoff / resolveCombat) owns it then. */
async function guarded(fn) {
  if (!G || G.busy || G.over || actingSide() !== 0) return;
  G.busy = true;
  render();
  try {
    await fn();
  } finally {
    if (G && !G.over && !G.combat) G.busy = false;
    if (G) render();
  }
}

function onCreatureClick(pIdx, creature, zone = 'field') {
  /* On Summon / stalker target picking runs while other input is
     locked — handle it before any of the usual guards. */
  if (targetPicker) {
    if (targetPicker.targets.includes(creature) && !creature.dying) {
      const p = targetPicker;
      targetPicker = null;
      hideTargetArrow();
      p.resolve(creature);
    } else {
      FX.shake(elByUid(creature.uid));
    }
    return;
  }

  /* Click fallback for the drag interactions (also the touch path). */
  if (zone === 'attacking' && pIdx === 0 && STAGE.mode === 'declare') {
    stageToggleAttacker(creature.uid);       // click a staged attacker → pull it back
    return;
  }
  if (zone === 'blocking' && pIdx === 0 && STAGE.mode === 'block') {
    const idx = Object.keys(STAGE.blocks).find((k) => STAGE.blocks[k] === creature.uid);
    if (idx != null) stageAssignBlock(Number(idx), null);   // click a staged blocker → unassign
    return;
  }
  if (zone === 'field' && pIdx === 0 && !G.combat && actingSide() === 0
    && (!G.attackUsed || hasAb(creature, 'energetic')) && creatureReady(creature)) {
    stageToggleAttacker(creature.uid);       // click a ready creature → stage it
    return;
  }
  if (zone === 'field' && pIdx === 0 && G.combat && G.combat.phase === 'block' && actingSide() === 0 && canBlock(creature)) {
    selectedUid = selectedUid === creature.uid ? null : creature.uid;  // select, then click a lane
    render();
    return;
  }
}

/* Click a battle lane slot — the select-then-place blocking fallback. */
function onLaneClick(laneIdx) {
  if (!G.combat || G.combat.phase !== 'block' || actingSide() !== 0) return;
  if (selectedUid == null) return;
  stageAssignBlock(laneIdx, selectedUid);
}
