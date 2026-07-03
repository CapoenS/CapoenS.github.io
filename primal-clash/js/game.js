/* ============================================
   Primal Clash — game state & turn flow
   Player 0 = human, player 1 = AI.
   ============================================ */
"use strict";

let G = null;          // current game state
let GEN = 0;           // game generation (guards stale async AI turns)
let uidCounter = 1;
const nextUid = () => uidCounter++;

/* Append a battle-log line. `onlyForIdx` makes the line private to that
   player (hidden-hand info like draws): renderLog shows it only to its
   owner, and online snapshots never ship it to the other side. */
function log(msg, onlyForIdx) {
  if (!G) return;
  G.log.push(onlyForIdx === undefined ? msg : { t: msg, p: onlyForIdx });
  renderLog();
}

/* Copy a pool template into a unique hand/deck card. */
function makeHandCard(tpl) {
  const c = Object.assign({}, tpl);
  c.uid = nextUid();
  if (c.abilities) c.abilities = c.abilities.slice();
  return c;
}

/* Turn a creature card into a board instance. */
function makeCreatureInstance(card) {
  return {
    uid: nextUid(),
    tplId: card.id,
    type: 'creature',
    name: card.name,
    cost: card.cost,
    era: card.era,
    tribe: card.tribe,
    atk: card.atk,
    baseAtk: card.atk,
    /* a retreated, still-wounded card re-enters with its old damage */
    hp: card._wounded ? Math.max(1, Math.min(card._wounded.hp, card.hp)) : card.hp,
    maxHp: card.hp,
    armor: card.armor,
    moraleMax: card.morale || 3,
    morale: card.morale || 3,   // morale is always full when (re)summoned
    legendary: !!card.legendary,
    abilities: card.abilities.slice(),
    abilityId: card.ability ? card.ability.id : null,
    abilityText: card.ability ? card.ability.text : '',
    onSummonId: card.onSummon ? card.onSummon.id : null,
    onSummonText: card.onSummon ? card.onSummon.text : '',
    stealthed: card.abilities.includes('stealth'),
    sick: !card.abilities.includes('swift'),   // summoning sickness
    frozen: false,
    attacksLeft: 1,
    frenzyDone: false,
    dying: false,
    justPlayed: true,
  };
}

/* Start a game. Without `opts`: the classic solo game vs the AI.
   With opts = { p0: {name, cards}, p1: {name, cards, remote: true} }
   (online host): both decks come from the lobby exchange, player 1 is
   the remote guest, and both players carry their real display names. */
function newGame(opts) {
  GEN++;
  if (typeof clearTargetPicker === 'function') clearTargetPicker();
  const first = Math.random() < 0.5 ? 0 : 1;
  G = {
    gen: GEN,
    players: [
      { idx: 0, name: opts ? opts.p0.name : 'You',             isAI: false, hp: 30, maxHp: 30, maxAmber: 0, amber: 0, deck: [], hand: [], board: [] },
      { idx: 1, name: opts ? opts.p1.name : 'Rival Chieftain', isAI: !opts, isRemote: !!(opts && opts.p1.remote), hp: 30, maxHp: 30, maxAmber: 0, amber: 0, deck: [], hand: [], board: [] },
    ],
    biome: null,
    active: first,
    turnCount: 0,
    over: false,
    winner: null,
    busy: false,
    pendingEvent: null,
    selectedAttacker: null,
    log: [],
  };
  if (opts) {
    G.players[0].deck = shuffle(opts.p0.cards.slice()).map(makeHandCard);
    G.players[1].deck = shuffle(opts.p1.cards.slice()).map(makeHandCard);
  } else {
    const custom = (typeof DB !== 'undefined') ? DB.getActiveDeckCards() : null;
    G.players[0].deck = (custom ? shuffle(custom.slice()) : buildRandomDeck()).map(makeHandCard);
    G.players[1].deck = buildRandomDeck().map(makeHandCard);
    log(`Your deck: ${custom ? '“' + DB.getActiveName() + '”' : 'random draft'}.`, 0);
  }
  drawCards(G.players[first], 3, true);      // going first: 3 cards
  drawCards(G.players[1 - first], 4, true);  // going second: 4 cards
  log(`A new clash begins! ${G.players[first].name} ${G.players[first].name === 'You' ? 'go' : 'goes'} first.`);
  hideGameOver();
  startTurn();
}

function drawCards(p, n, silent) {
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      log(`${p.name} ${p.name === 'You' ? 'have' : 'has'} no cards left to draw!`);
      continue;
    }
    const card = p.deck.pop();
    if (p.hand.length >= 10) {
      log(`${p.name}'s hand is full — a card is burned!`);
    } else {
      p.hand.push(card);
      /* Draw-in animation flag (consumed by renderHand). A remote guest's
         flag is re-derived on their side from snapshot diffs instead. */
      if (!p.isAI && !p.isRemote) card._drawn = true;
      if (typeof pulseDeckPile === 'function') pulseDeckPile(p.idx);
      if (!silent && !p.isAI) log(`You draw ${card.name}.`, p.idx);
    }
  }
}

/* Hallucigenia ('dream_conjurer'): add a random event costing 3 or
   less to its owner's hand at the start of that player's turn. */
function conjureEvent(p, c) {
  const options = EVENTS.filter((e) => e.cost <= 3);
  const tpl = options[Math.floor(Math.random() * options.length)];
  if (p.hand.length >= 10) {
    log(`${c.name} conjures ${tpl.name}, but the hand is full — it fizzles.`);
    return;
  }
  const hc = makeHandCard(tpl);
  if (!p.isAI && !p.isRemote) hc._drawn = true;   // draw-in animation
  p.hand.push(hc);
  /* The conjured card goes to a hidden hand — humans get the name privately,
     the AI's conjures stay public like the rest of its visible antics. */
  if (p.isAI) log(`${c.name} dreams up ${tpl.name}!`);
  else log(`${c.name} dreams up ${tpl.name}!`, p.idx);
}

async function startTurn() {
  const p = G.players[G.active];
  G.turnCount++;
  p.maxAmber = Math.min(10, p.maxAmber + 1);   // +1 max amber, cap 10
  p.amber = p.maxAmber;                        // refill
  for (const c of p.board) {
    c.sick = false;
    c.attacksLeft = 1;
    c.justPlayed = false;
    if (hasAb(c, 'regenerate') && c.hp < c.maxHp) {
      c.hp = Math.min(c.maxHp, c.hp + 1);
      log(`${c.name} regenerates 1 HP.`);
    }
    if (c.abilityId === 'dream_conjurer' && !c.dying) conjureEvent(p, c);
  }
  /* Wounded cards recover in the safety of the hand: +1 HP per turn,
     no Regenerate needed. Fully healed cards lose the wound marker. */
  for (const hc of p.hand) {
    if (hc._wounded) {
      hc._wounded.hp = Math.min(hc.hp, hc._wounded.hp + 1);
      if (hc._wounded.hp >= hc.hp) delete hc._wounded;
    }
  }
  drawCards(p, 1);                             // draw a card
  log(`— Turn ${G.turnCount}: ${p.name} (${p.amber} amber) —`);
  if (p.isAI) {
    G.busy = true;
    render();
    await aiTakeTurn();
  } else {
    G.busy = false;
    render();
  }
}

async function endTurn() {
  if (!G || G.over) return;
  const gen = G.gen;
  const p = G.players[G.active];
  G.busy = true;
  G.pendingEvent = null;
  G.selectedAttacker = null;
  render();

  /* Volcanic Wastes: 1 damage to all creatures at end of every turn, bypassing armor. */
  if (G.biome && G.biome.burn) {
    log(`${G.biome.name} sears the battlefield!`);
    const all = [...G.players[0].board, ...G.players[1].board];
    for (const c of all) dealEventDamage(c, G.biome.burn);
    SFX.damage();
    render();
    for (const c of all) if (!c.dying) FX.floatText(elByUid(c.uid), '-' + G.biome.burn);
    await handleDeaths();
    if (!G || G.gen !== gen) return;
  }

  /* Frozen creatures thaw at the end of their owner's turn. */
  for (const c of p.board) c.frozen = false;

  G.active = 1 - G.active;
  await startTurn();
}

/* Which events need a target, and what may they target? */
function eventNeedsTarget(card) {
  return ['ambush', 'evolve', 'tarpit', 'eruption'].includes(card.effect);
}

function eventTargets(pIdx, card) {
  const p = G.players[pIdx];
  const e = G.players[1 - pIdx];
  const alive = (arr) => arr.filter((c) => !c.dying);
  switch (card.effect) {
    case 'ambush':
      return alive(e.board).filter((c) => !c.stealthed);
    case 'evolve':
      return alive(p.board);
    case 'tarpit':
      return alive(e.board).filter((c) => !c.stealthed && effAtk(c) <= 3);
    case 'eruption':
      return [...alive(p.board), ...alive(e.board).filter((c) => !c.stealthed)];
    default:
      return null; // untargeted
  }
}

/* ---------- Morale ----------
   Every creature has Morale next to HP. It drops when allies die
   (and, later, from specific skills); at 0 the creature retreats
   back to its owner's hand — keeping its wounds, healing 1 HP per
   turn there, and returning with full Morale if replayed (for its
   full amber cost again). Fearless creatures never lose Morale. */
function loseMorale(c, n) {
  if (hasAb(c, 'fearless') || c.dying || n <= 0) return;
  c.morale = Math.max(0, c.morale - n);
  FX.floatText(elByUid(c.uid), `-${n}`, 'morale');
}

function gainMorale(c, n) {
  if (hasAb(c, 'fearless') || c.dying || n <= 0) return;
  c.morale = Math.min(c.moraleMax, c.morale + n);
}

/* Send every 0-morale creature back to its owner's hand.
   A full hand (10) means there is nowhere to flee: it is destroyed. */
async function processRetreats() {
  const retreating = [];
  for (const p of G.players) {
    for (const c of p.board) {
      if (!c.dying && !hasAb(c, 'fearless') && c.morale <= 0) retreating.push({ p, c });
    }
  }
  if (!retreating.length) return;
  SFX.freeze();
  for (const { c } of retreating) {
    c.dying = true;        // excluded from targeting/combat while animating
    c.retreating = true;   // ...but with the retreat animation, not death
    log(`${c.name} loses heart and retreats!`);
  }
  render();
  await FX.sleep(600);
  for (const { p, c } of retreating) {
    p.board = p.board.filter((x) => x !== c);
    const tpl = CARD_POOL.find((t) => t.id === c.tplId);
    if (!tpl) continue;
    if (p.hand.length >= 10) {
      log(`${p.name}'s hand is full — ${c.name} has nowhere to flee and is destroyed!`);
      continue;
    }
    const hc = makeHandCard(tpl);
    const woundHp = Math.min(c.hp, tpl.hp);
    if (woundHp < tpl.hp) hc._wounded = { hp: Math.max(1, woundHp) };
    p.hand.push(hc);
  }
  render();
}

/* ---------- On Summon effects ----------
   One-shot effects that trigger when a creature enters the field.
   Each entry: targets(pIdx, inst) -> array of legal creature targets
   (omit `targets` entirely for untargeted effects; an empty array
   makes the effect fizzle), and resolve(pIdx, inst, target). */
const ON_SUMMON = {
  /* T-rex: untargeted — its roar shakes the whole enemy board. */
  terrify: {
    async resolve(pIdx, inst) {
      const foe = G.players[1 - pIdx];
      if (!foe.board.length) {
        log(`${inst.name} roars at an empty battlefield.`);
        return;
      }
      log(`${inst.name}'s roar terrifies the enemy (-2 Morale)!`);
      SFX.attack();
      for (const c of foe.board) loseMorale(c, 2);
      render();
      await processRetreats();
    },
  },
  destroy_trilobite: {
    targets(pIdx) {
      const me = G.players[pIdx];
      const foe = G.players[1 - pIdx];
      return [
        ...me.board.filter((c) => c.tplId === 'trilobite' && !c.dying),
        ...foe.board.filter((c) => c.tplId === 'trilobite' && !c.dying && !c.stealthed),
      ];
    },
    async resolve(pIdx, inst, target) {
      log(`${inst.name} devours ${target.name}!`);
      SFX.attack();
      target.hp = 0;
      render();
      await handleDeaths();
    },
  },
};

/* Run a freshly summoned creature's On Summon effect.
   Human players pick the target by clicking (uiChooseTarget);
   the AI picks via aiChooseOnSummonTarget. No target = fizzle. */
async function runOnSummon(pIdx, inst, presetTarget) {
  if (!inst.onSummonId) return;
  const def = ON_SUMMON[inst.onSummonId];
  if (!def) return;
  if (!def.targets) {
    await def.resolve(pIdx, inst, undefined);
    return;
  }
  const targets = def.targets(pIdx, inst).filter((t) => !t.dying);
  if (!targets.length) {
    log(`${inst.name}: On Summon found no valid target.`);
    return;
  }
  let target = presetTarget && targets.includes(presetTarget) ? presetTarget : null;
  if (!target) {
    target = G.players[pIdx].isAI
      ? aiChooseOnSummonTarget(pIdx, inst, targets)
      /* A remote guest pre-picks the target on their own screen and sends
         it with the play intent — never open the picker modal here. If the
         preset was missing or has become invalid, the effect fizzles. */
      : G.players[pIdx].isRemote
        ? null
        : await uiChooseTarget(targets, `${inst.name} — On Summon: click a highlighted target.`);
  }
  if (target && !target.dying) await def.resolve(pIdx, inst, target);
}

/*
 * Play a card from hand. `target` is required for targeted events.
 * Returns true if the card was actually played.
 */
async function playCardFromHand(pIdx, cardUid, target) {
  const p = G.players[pIdx];
  const card = p.hand.find((c) => c.uid === cardUid);
  if (!card || G.over || card.cost > p.amber) return false;
  if (card.type === 'creature' && p.board.length >= 7) {
    log('The board is full (7 creatures max).');
    return false;
  }
  if (card.type === 'event' && eventNeedsTarget(card)) {
    const valid = eventTargets(pIdx, card);
    if (!target || !valid.includes(target)) return false;
  }

  p.amber -= card.cost;
  p.hand.splice(p.hand.indexOf(card), 1);
  SFX.playCard();

  if (card.type === 'creature') {
    const inst = makeCreatureInstance(card);
    p.board.push(inst);
    log(`${p.name} play${p.name === 'You' ? '' : 's'} ${card.name}.`);
    render();
    await FX.sleep(350);
    inst.justPlayed = false;
    render();
    await runOnSummon(pIdx, inst, target);
  } else if (card.type === 'biome') {
    if (G.biome) log(`${card.name} replaces ${G.biome.name}.`);
    else log(`${p.name} play${p.name === 'You' ? '' : 's'} ${card.name}.`);
    G.biome = card;
    render();
  } else {
    log(`${p.name} play${p.name === 'You' ? '' : 's'} ${card.name}.`);
    await resolveEvent(pIdx, card, target);
  }
  return true;
}

async function resolveEvent(pIdx, card, target) {
  const p = G.players[pIdx];
  const e = G.players[1 - pIdx];
  switch (card.effect) {
    case 'ambush':
      dealEventDamage(target, 2);
      log(`Predator Ambush hits ${target.name} for 2.`);
      SFX.damage();
      render();
      FX.floatText(elByUid(target.uid), '-2');
      break;
    case 'excavate':
      drawCards(p, 2);
      render();
      break;
    case 'evolve':
      target.atk += 2;
      target.hp += 2;
      target.maxHp += 2;
      log(`${target.name} evolves (+2/+2).`);
      SFX.heal();
      render();
      FX.floatText(elByUid(target.uid), '+2/+2', 'buff');
      break;
    case 'spring':
      p.hp = Math.min(p.maxHp, p.hp + 5);
      log(`${p.name} restore${p.name === 'You' ? '' : 's'} 5 HP.`);
      SFX.heal();
      render();
      FX.floatText(heroEl(pIdx), '+5', 'heal');
      break;
    case 'rally':
      log(`${p.name === 'You' ? 'Your' : p.name + "'s"} creatures take heart (+2 Morale).`);
      for (const c of p.board) {
        if (c.dying || hasAb(c, 'fearless')) continue;
        gainMorale(c, 2);
        FX.floatText(elByUid(c.uid), '+2', 'morale');
      }
      SFX.heal();
      render();
      break;
    case 'tarpit':
      log(`${target.name} sinks into the tar pit!`);
      target.hp = 0;
      render();
      break;
    case 'eruption':
      dealEventDamage(target, 4);
      log(`Eruption scorches ${target.name} for 4.`);
      SFX.damage();
      render();
      FX.floatText(elByUid(target.uid), '-4');
      break;
    case 'iceage':
      for (const c of e.board) c.frozen = true;
      log(`Ice Age! ${e.name === 'You' ? 'Your' : e.name + "'s"} creatures are frozen.`);
      SFX.freeze();
      render();
      break;
    case 'meteor': {
      log('Meteor Impact! 3 damage to every creature.');
      const all = [...p.board, ...e.board];
      for (const c of all) dealEventDamage(c, 3);
      SFX.damage();
      render();
      for (const c of all) if (!c.dying) FX.floatText(elByUid(c.uid), '-3');
      break;
    }
  }
  await handleDeaths();
}

function checkWin() {
  if (!G || G.over) return G ? G.over : true;
  const dead0 = G.players[0].hp <= 0;
  const dead1 = G.players[1].hp <= 0;
  if (!dead0 && !dead1) return false;
  G.over = true;
  G.busy = false;
  G.winner = dead1 && !dead0 ? 0 : 1;
  if (typeof SAVE !== 'undefined') SAVE.recordResult(G.winner === 0);
  if (G.winner === 0) SFX.win(); else SFX.lose();
  render();
  showGameOver();
  return true;
}

/* ---------- boot & top-level controls ---------- */
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('new-game-btn').addEventListener('click', () => {
      NET.guardLeave(() => newGame());   // confirms first when an online match is running
    });
    document.getElementById('play-again-btn').addEventListener('click', () => {
      if (NET.inMatch()) { NET.requestRematch(); return; }
      newGame();
    });
    document.getElementById('end-turn-btn').addEventListener('click', () => {
      if (G && G.active === 0 && !G.busy && !G.over) {
        if (NET.isGuest()) { NET.sendEndTurn(); return; }
        endTurn();
      }
    });
    document.getElementById('mute-btn').addEventListener('click', (ev) => {
      const m = SFX.toggleMute();
      ev.currentTarget.textContent = m ? '🔇' : '🔊';
      ev.currentTarget.title = m ? 'Unmute' : 'Mute';
      if (typeof SAVE !== 'undefined') SAVE.setSetting('muted', m);
    });
    document.getElementById('enemy-hero').addEventListener('click', onEnemyHeroClick);
    document.getElementById('battlefield').addEventListener('click', (ev) => {
      if (ev.target.closest('.creature') || ev.target.closest('.hero')) return;
      if (G && (G.pendingEvent || G.selectedAttacker)) {
        G.pendingEvent = null;
        G.selectedAttacker = null;
        render();
      }
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && G && (G.pendingEvent || G.selectedAttacker)) {
        G.pendingEvent = null;
        G.selectedAttacker = null;
        render();
      }
    });
    initMenus();
  });
}
