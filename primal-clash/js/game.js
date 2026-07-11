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
    attacksLeft: card.abilities.includes('energetic') ? 2 : 1,
    frenzyDone: false,
    dying: false,
    justPlayed: true,
  };
}

/* Biome auras that touch a creature the moment it enters the board. */
function applyBiomeOnEnter(inst) {
  const b = G.biome;
  if (!b) return;
  if (b.buffHp && inTribe(inst, b.buffTribe)) { inst.hp += b.buffHp; inst.maxHp += b.buffHp; }
  if (b.grantSwift && inTribe(inst, b.grantSwift)) inst.sick = false;
  /* Deep Freeze: two thaw steps = frozen through the opponent's turn AND
     the owner's next one, so the creature truly skips its first round.
     (Boolean freezes — Ice Age — still thaw after one own end-turn.) */
  if (b.freezeOthers && !inTribe(inst, b.freezeOthers)) inst.frozen = 2;
}

/* Swap the active biome (or clear it with null), moving its board-wide
   auras with it. The ATK half of buffTribe is computed live (biomeBuff,
   combat.js); only the HP half and swift are stored on the creatures. */
function setBiome(next) {
  const old = G.biome;
  G.biome = next;
  for (const pl of G.players) {
    for (const c of pl.board) {
      if (old && old.buffHp && inTribe(c, old.buffTribe)) {
        c.maxHp -= old.buffHp;
        c.hp = Math.max(1, Math.min(c.hp, c.maxHp));   // losing the aura never kills
      }
      if (next && next.buffHp && inTribe(c, next.buffTribe)) { c.maxHp += next.buffHp; c.hp += next.buffHp; }
      if (next && next.grantSwift && inTribe(c, next.grantSwift)) c.sick = false;
    }
  }
}

/* Start a game. Without `opts`: the classic solo game vs the AI.
   With opts = { p0: {name, cards}, p1: {name, cards, remote: true} }
   (online host): both decks come from the lobby exchange, player 1 is
   the remote guest, and both players carry their real display names. */
function newGame(opts) {
  GEN++;
  if (typeof clearTargetPicker === 'function') clearTargetPicker();
  if (typeof clearCombatStage === 'function') clearCombatStage();
  const mp = opts && opts.p0 ? opts : null;          // multiplayer options
  const sandbox = !!(opts && opts.sandbox);          // solo test mode
  const first = Math.random() < 0.5 ? 0 : 1;
  G = {
    gen: GEN,
    sandbox,
    players: [
      /* qmber = quick amber (3-pip bar): spent ONLY by quick events, and
         first; refills at own turn start and after every combat.
         fatigue = doubling empty-deck draw damage (1, 2, 4, …). */
      { idx: 0, name: mp ? mp.p0.name : 'You',             isAI: false, hp: 30, maxHp: 30, maxAmber: 0, amber: 0, qmber: 3, qmberMax: 3, fatigue: 0, deck: [], hand: [], board: [] },
      { idx: 1, name: mp ? mp.p1.name : 'Rival Chieftain', isAI: !mp, isRemote: !!(mp && mp.p1.remote), hp: 30, maxHp: 30, maxAmber: 0, amber: 0, qmber: 3, qmberMax: 3, fatigue: 0, deck: [], hand: [], board: [] },
    ],
    biome: null,
    active: first,
    turnCount: 0,
    over: false,
    winner: null,
    busy: false,
    combat: null,        // committed combat state (see declareAttack)
    attackUsed: false,   // one attack declaration per turn
    log: [],
  };
  if (mp) {
    G.players[0].deck = shuffle(mp.p0.cards.slice()).map(makeHandCard);
    G.players[1].deck = shuffle(mp.p1.cards.slice()).map(makeHandCard);
  } else {
    const custom = (typeof DB !== 'undefined') ? DB.getActiveDeckCards() : null;
    G.players[0].deck = (custom ? shuffle(custom.slice()) : buildRandomDeck()).map(makeHandCard);
    G.players[1].deck = buildRandomDeck().map(makeHandCard);
    log(`Your deck: ${custom ? '“' + DB.getActiveName() + '”' : 'random draft'}.`, 0);
  }
  drawCards(G.players[first], 3, true);      // going first: 3 cards
  drawCards(G.players[1 - first], 4, true);  // going second: 4 cards
  log(`A new clash begins! ${G.players[first].name} ${G.players[first].name === 'You' ? 'go' : 'goes'} first.`);
  if (sandbox) log('🧪 Sandbox mode: infinite amber, the 🧪 Cards button conjures anything, results are not recorded.');
  hideGameOver();
  startTurn();
}

function drawCards(p, n, silent) {
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      /* Fatigue: drawing from an empty deck wounds the leader, and the
         wound doubles with every empty draw (1, 2, 4, 8, …). */
      p.fatigue = p.fatigue ? p.fatigue * 2 : 1;
      p.hp -= p.fatigue;
      log(`${p.name} ${p.name === 'You' ? 'have' : 'has'} no cards left — fatigue strikes for ${p.fatigue}!`);
      SFX.damage();
      render();
      FX.floatText(heroEl(p.idx), '-' + p.fatigue);
      FX.impact(heroEl(p.idx), Math.min(2.5, 0.8 + p.fatigue / 6));
      if (checkWin()) return;
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
  G.attackUsed = false;                        // fresh attack declaration each turn
  p.maxAmber = Math.min(10, p.maxAmber + 1);   // +1 max amber, cap 10
  p.amber = p.maxAmber;                        // refill
  p.qmber = p.qmberMax;                        // quick amber refills too
  if (G.sandbox && !p.isAI) {                  // sandbox: bottomless amber
    p.maxAmber = 99;
    p.amber = 99;
  }
  for (const c of p.board) {
    c.sick = false;
    c.attacksLeft = hasAb(c, 'energetic') ? 2 : 1;
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
  drawCards(p, 1);                             // draw a card (or take fatigue)
  if (G.over) return;                          // fatigue can be lethal
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
  if (G.combat) return;   // a committed combat MUST fully resolve first
  const gen = G.gen;
  const p = G.players[G.active];
  G.busy = true;
  clearTempCombatBuffs(); // this-turn quick buffs expire
  if (typeof clearCombatStage === 'function') clearCombatStage();
  render();

  /* Volcanic Wastes: 1 damage to all creatures at end of every turn, bypassing armor. */
  if (G.biome && G.biome.burn) {
    log(`${G.biome.name} sears the battlefield!`);
    const all = [...G.players[0].board, ...G.players[1].board];
    for (const c of all) dealEventDamage(c, G.biome.burn);
    SFX.damage();
    render();
    for (const c of all) {
      if (c.dying) continue;
      FX.emberBurn(elByUid(c.uid));
      FX.floatText(elByUid(c.uid), '-' + G.biome.burn);
    }
    await handleDeaths();
    if (!G || G.gen !== gen) return;
  }

  /* Frozen creatures thaw at the end of their owner's turn. Numeric
     freezes (Deep Freeze) count down one step per own end-turn instead. */
  for (const c of p.board) {
    c.frozen = typeof c.frozen === 'number' && c.frozen > 1 ? c.frozen - 1 : false;
  }

  G.active = 1 - G.active;
  await startTurn();
}

/* ---------- costs: amber + the quick-amber bar ----------
   Quick events drink from the 3-pip quick bar FIRST (it is their only
   use); anything left over comes from regular amber. */
function isQuickCard(card) { return card.type === 'event' && card.quick; }

function canPayCost(p, card) {
  return card.cost <= p.amber + (isQuickCard(card) ? p.qmber : 0);
}

function payCost(p, card) {
  let due = card.cost;
  if (isQuickCard(card)) {
    const fromQ = Math.min(p.qmber, due);
    p.qmber -= fromQ;
    due -= fromQ;
  }
  p.amber -= due;
}

/* Which events need a target, and what may they target? */
function eventNeedsTarget(card) {
  return ['ambush', 'evolve', 'tarpit', 'eruption', 'surge', 'plating', 'trample', 'sunder', 'mend'].includes(card.effect);
}

function eventTargets(pIdx, card) {
  const p = G.players[pIdx];
  const e = G.players[1 - pIdx];
  const alive = (arr) => arr.filter((c) => !c.dying);
  switch (card.effect) {
    case 'ambush':
      return alive(e.board).filter((c) => !c.stealthed);
    case 'evolve':
    case 'surge':
    case 'plating':
    case 'trample':
      return alive(p.board);                         // buff a friendly creature
    case 'tarpit':
      return alive(e.board).filter((c) => !c.stealthed && effAtk(c) <= 4);
    case 'eruption':
      return [...alive(p.board), ...alive(e.board).filter((c) => !c.stealthed)];
    case 'sunder':
      return alive(e.board).filter((c) => !c.stealthed && c.armor > 0);
    case 'mend':
      return [...alive(p.board), ...alive(e.board).filter((c) => !c.stealthed)]
        .filter((c) => c.hp < c.maxHp);
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
  for (const { c } of retreating) FX.retreatWisp(elByUid(c.uid));
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
      SFX.roar();
      FX.screenShake(14, 500);
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
  /* Gigantopithecus: a TWO-target On Summon (targets + targets2). Pick 1 =
     a friendly Mammal (the projectile), pick 2 = an enemy creature. The
     two then trade combat damage exactly as if the Mammal had attacked it
     (reuses resolveDuel, so keywords/venom/evasive/frenzy/devour apply),
     but nobody is "used up": the Mammal stays home and the target is free
     to act. */
  /* Brontoscorpio: unconditional removal with a price — the victim's
     remaining HP recoils onto YOUR leader. Can absolutely kill you. */
  sting_execution: {
    targets(pIdx) {
      return G.players[1 - pIdx].board.filter((c) => !c.dying && !c.stealthed);
    },
    aiPick(pIdx, inst, list) {
      /* Best value where the recoil leaves a comfortable HP cushion. */
      const me = G.players[pIdx];
      const safe = list.filter((t) => t.hp <= me.hp - 6);
      if (!safe.length) return null;   // never sting itself to death
      return safe.slice().sort((a, b) => aiValue(b) - aiValue(a))[0];
    },
    async resolve(pIdx, inst, target) {
      const me = G.players[pIdx];
      const recoil = Math.max(0, target.hp);
      log(`${inst.name} stings ${target.name} dead — the venom recoils for ${recoil}!`);
      SFX.attack();
      target.hp = 0;
      me.hp -= recoil;
      render();
      FX.floatText(heroEl(pIdx), '-' + recoil);
      FX.impact(heroEl(pIdx), Math.min(2.5, 0.7 + recoil / 5));
      if (checkWin()) return;
      await handleDeaths();
    },
  },
  mammal_toss: {
    prompt: (slot) => slot === 1
      ? 'On Summon: choose a friendly Mammal to hurl.'
      : 'On Summon: choose an enemy creature to hit.',
    targets(pIdx, inst) {
      return G.players[pIdx].board.filter((c) => c !== inst && c.tribe === 'Mammal' && !c.dying);
    },
    targets2(pIdx) {
      return G.players[1 - pIdx].board.filter((c) => !c.dying && !c.stealthed);
    },
    aiPick(pIdx, inst, list, slot) {
      // slot 1: throw the hardest hitter; slot 2: aim at the juiciest enemy.
      return slot === 1
        ? list.slice().sort((a, b) => effAtk(b) - effAtk(a))[0]
        : list.slice().sort((a, b) => aiValue(b) - aiValue(a))[0];
    },
    async resolve(pIdx, inst, projectile, victim) {
      log(`${inst.name} hurls ${projectile.name} at ${victim.name}!`);
      SFX.attack();
      const flight = await FX.lunge(elByUid(projectile.uid), elByUid(victim.uid), effAtk(projectile));
      if (!G) return;
      const r = resolveDuel(projectile, victim);
      SFX.damage();
      if (r.dmgToBlocker > 0) FX.floatText(elByUid(victim.uid), '-' + r.dmgToBlocker);
      if (r.dmgToAttacker > 0) FX.floatText(elByUid(projectile.uid), '-' + r.dmgToAttacker);
      FX.impact(elByUid(victim.uid), Math.min(3, 0.6 + r.dmgToBlocker / 4));
      if (flight) await flight.settled;
      render();
      await handleDeaths();
    },
  },
};

/* Pick one On Summon target for `slot` (1 or 2). `preset` is a target the
   caller already knows (a remote guest's pre-pick, or a chained value);
   otherwise the AI chooses, a remote player fizzles (never a modal), and a
   local human clicks. Returns the chosen creature or null. */
async function pickOnSummonTarget(pIdx, inst, def, slot, preset, prev) {
  const list = (slot === 1 ? def.targets(pIdx, inst) : def.targets2(pIdx, inst, prev))
    .filter((t) => !t.dying);
  if (!list.length) {
    log(`${inst.name}: On Summon found no valid target.`);
    return null;
  }
  if (preset && list.includes(preset)) return preset;
  const pl = G.players[pIdx];
  if (pl.isAI) {
    return def.aiPick ? def.aiPick(pIdx, inst, list, slot) : aiChooseOnSummonTarget(pIdx, inst, list);
  }
  /* A remote guest pre-picks on their own screen and sends the uid(s) with
     the play intent — never open the picker modal for them. */
  if (pl.isRemote) return null;
  const label = def.prompt ? def.prompt(slot) : 'On Summon: click a highlighted target.';
  return await uiChooseTarget(list, `${inst.name} — ${label}`, inst.uid);
}

/* Run a freshly summoned creature's On Summon effect. Effects with `targets`
   need one pick; effects that also declare `targets2` need a second (e.g.
   Gigantopithecus: which Mammal, then which enemy). No valid target at any
   step = fizzle. */
async function runOnSummon(pIdx, inst, presetTarget, presetTarget2) {
  if (!inst.onSummonId) return;
  const def = ON_SUMMON[inst.onSummonId];
  if (!def) return;
  if (!def.targets) {
    await def.resolve(pIdx, inst, undefined);
    return;
  }
  const t1 = await pickOnSummonTarget(pIdx, inst, def, 1, presetTarget, null);
  if (!t1 || t1.dying) return;
  if (def.targets2) {
    const t2 = await pickOnSummonTarget(pIdx, inst, def, 2, presetTarget2, t1);
    if (!t2 || t2.dying) return;
    await def.resolve(pIdx, inst, t1, t2);
    return;
  }
  await def.resolve(pIdx, inst, t1);
}

/*
 * Play a card from hand. `target` is required for targeted events; a
 * creature's On Summon may consume `target` (and `target2` for two-target
 * effects like Gigantopithecus). Returns true if the card was played.
 */
async function playCardFromHand(pIdx, cardUid, target, target2) {
  if (G.combat) return false;   // main phase only — combat quicks ride the commits
  const p = G.players[pIdx];
  const card = p.hand.find((c) => c.uid === cardUid);
  if (!card || G.over || !canPayCost(p, card)) return false;
  if (card.type === 'creature' && p.board.length >= 7) {
    log('The board is full (7 creatures max).');
    return false;
  }
  if (card.type === 'event' && card.effect === 'screech') {
    log('Primal Screech can only be unleashed during combat.');
    return false;   // combat-only quick — never a main-phase cast
  }
  if (card.type === 'event' && card.effect === 'drift' && !G.biome) {
    log('There is no active biome for Continental Drift to destroy.');
    return false;
  }
  if (card.type === 'event' && eventNeedsTarget(card)) {
    const valid = eventTargets(pIdx, card);
    if (!target || !valid.includes(target)) return false;
  }

  payCost(p, card);
  p.hand.splice(p.hand.indexOf(card), 1);
  SFX.playCard();
  /* Hearthstone-style reveal: everyone ELSE sees the played card big and
     center before it takes effect (own plays skip inside cardReveal). */
  await FX.cardReveal(null, { side: pIdx, card });

  if (card.type === 'creature') {
    const inst = makeCreatureInstance(card);
    applyBiomeOnEnter(inst);
    p.board.push(inst);
    log(`${p.name} play${p.name === 'You' ? '' : 's'} ${card.name}.`);
    render();
    if (inst.legendary) {
      /* Legendary entrance: darkness, approaching footsteps, board-
         smashing landing. Awaited — the whole table holds its breath. */
      await FX.legendarySummon(elByUid(inst.uid), { name: inst.name, kind: inst.tplId });
    } else {
      FX.dust(elByUid(inst.uid));
      await FX.sleep(350);
    }
    inst.justPlayed = false;
    render();
    await runOnSummon(pIdx, inst, target, target2);
  } else if (card.type === 'biome') {
    if (G.biome) log(`${card.name} replaces ${G.biome.name}.`);
    else log(`${p.name} play${p.name === 'You' ? '' : 's'} ${card.name}.`);
    setBiome(card);
    SFX.whoosh();
    FX.biomeSweep(null, { kind: card.id });
    render();
  } else {
    log(`${p.name} play${p.name === 'You' ? '' : 's'} ${card.name}.`);
    await resolveEvent(pIdx, card, target);
  }
  return true;
}

/* ---------- Combat commits (entry points 3 & 4) ----------
   All pre-lock arrangement lives in local UI staging; these two
   functions are the only way combat state enters G. Both validate
   all-or-nothing and return false without mutating on any illegality
   (which multiplayer maps to drop-and-resync, same as playCardFromHand). */

/* Shared: validate a requested quick-event queue [{cardUid, targetUid}].
   Returns [{side, card, targetUid}] or null if anything is illegal.
   Does NOT mutate; commitQuickQueue pays and removes afterwards. */
function buildQuickQueue(pIdx, reqs) {
  const p = G.players[pIdx];
  const out = [];
  const usedCards = new Set();
  let cost = 0;
  for (const q of reqs || []) {
    const card = p.hand.find((x) => x.uid === q.cardUid);
    if (!card || card.type !== 'event' || !card.quick || usedCards.has(card.uid)) return null;
    usedCards.add(card.uid);
    cost += card.cost;
    let targetUid = null;
    if (eventNeedsTarget(card)) {
      const t = (eventTargets(pIdx, card) || []).find((x) => x.uid === q.targetUid);
      if (!t) return null;
      targetUid = t.uid;
    }
    out.push({ side: pIdx, card, targetUid });
  }
  /* Quick events pool the quick-amber bar with regular amber. */
  return cost <= p.amber + p.qmber ? out : null;
}

function commitQuickQueue(pIdx, queue) {
  const p = G.players[pIdx];
  for (const q of queue) {
    payCost(p, q.card);   // drinks the quick bar first
    p.hand.splice(p.hand.indexOf(q.card), 1);
    log(`You ready ${q.card.name}…`, pIdx);   // secret until the reveal
  }
}

/* After any combat phase transition (except into 'resolving'), decide who
   acts next and either drive the AI, auto-skip an empty spell window, or
   unlock input for a human / remote player. The one place the four-step
   combat is sequenced. */
async function advanceCombat(gen) {
  if (!G || G.gen !== gen || !G.combat) return;
  const side = combatActor();
  if (side < 0) return;
  const phase = G.combat.phase;

  /* Auto-skip a spell window when the acting player has nothing to cast —
     so the common "no quick events" combat needs no extra clicks. The
     host runs this for a remote guest too (it holds the full state). */
  if (phase === 'attackerCast' || phase === 'defenderCast') {
    const canCast = G.players[side].hand.some((c) => c.type === 'event' && c.quick && c.cost <= G.players[side].amber);
    if (!canCast) {
      G.busy = true;
      render();
      if (phase === 'attackerCast') await commitAttackerCast(side, { quicks: [] });
      else await commitDefenderCast(side, { quicks: [] });
      return;
    }
  }

  if (G.players[side].isAI) {
    G.busy = true;    // human input stays locked while the AI decides
    render();
    await aiCombatStep(gen, side);
  } else {
    G.busy = false;   // human / remote player: their input drives the next commit
    render();
  }
}

/*
 * Entry point 3 — the attacker declares attackers (NO spells yet; the
 * attacker casts later, after seeing the blocks). decl = { lanes:
 * [{ uid, stalkerTargetUid? }] }. Creates G.combat in phase 'block'.
 */
async function declareAttack(pIdx, decl) {
  /* One attack wave per turn — except Energetic creatures, which may form
     a SECOND wave (they start with 2 attacks; wave one only spends 1). */
  if (!G || G.over || G.combat || pIdx !== G.active) return false;
  const p = G.players[pIdx];
  const foe = G.players[1 - pIdx];
  const lanes = decl && Array.isArray(decl.lanes) ? decl.lanes : [];
  if (!lanes.length || lanes.length > 7) return false;

  /* Attackers: owned, ready, distinct. Stalker picks: only on stalker
     lanes, target a live non-stealthed, non-frozen enemy, each enemy
     stalked at most once. */
  const seenA = new Set();
  const stalked = new Set();
  const built = [];
  for (const l of lanes) {
    const c = p.board.find((x) => x.uid === l.uid);
    if (!c || !creatureReady(c) || seenA.has(c.uid)) return false;
    if (G.attackUsed && !hasAb(c, 'energetic')) return false;   // 2nd wave: Energetic only
    seenA.add(c.uid);
    let bUid = null;
    let stalkerLock = false;
    if (l.stalkerTargetUid != null) {
      if (!hasAb(c, 'stalker')) return false;
      const t = foe.board.find((x) => x.uid === l.stalkerTargetUid);
      if (!t || t.stealthed || !canBlock(t) || stalked.has(t.uid)) return false;
      stalked.add(t.uid);
      bUid = t.uid;
      stalkerLock = true;
    }
    built.push({ aUid: c.uid, bUid, stalkerLock });
  }

  /* --- commit --- */
  for (const l of built) {
    const c = p.board.find((x) => x.uid === l.aUid);
    c.attacksLeft -= 1;   // committed even if spells kill it; Energetic keeps one
    if (l.stalkerLock) {
      const t = foe.board.find((x) => x.uid === l.bUid);
      log(`${c.name} stalks ${t.name} — it is forced to fight!`);
    }
  }
  G.combat = { phase: 'block', attackerIdx: pIdx, lanes: built, quicks: [] };
  G.attackUsed = true;
  log(`${p.name} declare${p.name === 'You' ? '' : 's'} an attack with ${built.length} creature${built.length === 1 ? '' : 's'}!`);
  SFX.attack();
  render();
  await advanceCombat(G.gen);
  return true;
}

/*
 * Entry point 4 — the defender assigns blockers (NO spells yet).
 * decl = { blocks: [{ lane, uid }] }. Advances to the attacker's spell
 * window ('attackerCast') so the attacker casts knowing the blocks.
 */
async function commitBlocks(pIdx, decl) {
  if (!G || G.over || !G.combat || G.combat.phase !== 'block') return false;
  if (pIdx !== 1 - G.combat.attackerIdx) return false;
  const p = G.players[pIdx];
  const blocks = decl && Array.isArray(decl.blocks) ? decl.blocks : [];

  const usedBlockers = new Set();
  const usedLanes = new Set();
  const assign = [];
  for (const b of blocks) {
    const lane = G.combat.lanes[b.lane];
    if (!lane || lane.stalkerLock || usedLanes.has(b.lane)) return false;
    const attacker = liveByUid(lane.aUid);
    if (!attacker || attacker.stealthed) return false;   // stealth = unblockable
    const c = p.board.find((x) => x.uid === b.uid);
    if (!c || !canBlock(c) || usedBlockers.has(c.uid)) return false;
    usedLanes.add(b.lane);
    usedBlockers.add(c.uid);
    assign.push({ lane, uid: c.uid });
  }

  /* --- commit --- */
  for (const a of assign) a.lane.bUid = a.uid;
  log(`${p.name} ${p.name === 'You' ? 'brace' : 'braces'} for the assault with ${assign.length} blocker${assign.length === 1 ? '' : 's'}.`);
  G.combat.phase = 'attackerCast';
  render();
  await advanceCombat(G.gen);
  return true;
}

/*
 * Entry point 5 — the attacker casts quick spells (having seen the blocks).
 * decl = { quicks: [{ cardUid, targetUid? }] }. Advances to 'defenderCast'.
 */
async function commitAttackerCast(pIdx, decl) {
  if (!G || G.over || !G.combat || G.combat.phase !== 'attackerCast') return false;
  if (pIdx !== G.combat.attackerIdx) return false;
  const qBuilt = buildQuickQueue(pIdx, decl.quicks);
  if (!qBuilt) return false;
  commitQuickQueue(pIdx, qBuilt);
  G.combat.quicks.push(...qBuilt);   // attacker's casts resolve first
  G.combat.phase = 'defenderCast';
  render();
  await advanceCombat(G.gen);
  return true;
}

/*
 * Entry point 6 — the defender casts quick spells, then everything resolves.
 * decl = { quicks: [{ cardUid, targetUid? }] }.
 */
async function commitDefenderCast(pIdx, decl) {
  if (!G || G.over || !G.combat || G.combat.phase !== 'defenderCast') return false;
  if (pIdx !== 1 - G.combat.attackerIdx) return false;
  const qBuilt = buildQuickQueue(pIdx, decl.quicks);
  if (!qBuilt) return false;
  commitQuickQueue(pIdx, qBuilt);
  G.combat.quicks.push(...qBuilt);   // defender's casts resolve after the attacker's
  G.combat.phase = 'resolving';
  G.busy = true;
  render();
  await resolveCombat();
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
      FX.slash(elByUid(target.uid));
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
      FX.sparkle(elByUid(target.uid));
      FX.floatText(elByUid(target.uid), '+2/+2', 'buff');
      break;
    case 'spring':
      p.hp = Math.min(p.maxHp, p.hp + 5);
      log(`${p.name} restore${p.name === 'You' ? '' : 's'} 5 HP.`);
      SFX.heal();
      render();
      FX.sparkle(heroEl(pIdx), { colors: ['#7ee081', '#b9f6ca', '#e8f4ff'] });
      FX.floatText(heroEl(pIdx), '+5', 'heal');
      break;
    case 'rally':
      log(`${p.name === 'You' ? 'Your' : p.name + "'s"} creatures take heart (+2 Morale).`);
      for (const c of p.board) {
        if (c.dying || hasAb(c, 'fearless')) continue;
        gainMorale(c, 2);
        FX.sparkle(elByUid(c.uid), { colors: ['#bfe3ff', '#9fd4ff', '#ffffff'], n: 9 });
        FX.floatText(elByUid(c.uid), '+2', 'morale');
      }
      SFX.heal();
      SFX.sparkleSfx();
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
      SFX.explosion();
      render();
      FX.lavaBurst(elByUid(target.uid));
      FX.floatText(elByUid(target.uid), '-4');
      break;
    case 'surge':
      target.tempAtk = (target.tempAtk || 0) + 2;
      log(`${target.name} surges with adrenaline (+2 ATK this turn).`);
      SFX.heal();
      render();
      FX.floatText(elByUid(target.uid), '+2 ATK', 'buff');
      break;
    case 'plating':
      target.tempArmor = (target.tempArmor || 0) + 2;
      log(`${target.name} hunkers behind bone plating (+2 Armor this turn).`);
      SFX.heal();
      render();
      FX.floatText(elByUid(target.uid), '+2 Armor', 'buff');
      break;
    case 'trample':
      target.tempOverwhelm = true;
      log(`${target.name} gains Overwhelm this turn!`);
      SFX.heal();
      render();
      FX.floatText(elByUid(target.uid), 'Overwhelm', 'buff');
      break;
    case 'screech': {
      const fighting = G.combat
        ? G.combat.lanes.flatMap((l) => [liveByUid(l.aUid), liveByUid(l.bUid)]).filter(Boolean)
        : [];
      if (!fighting.length) { log('Primal Screech echoes over an empty battlefield.'); break; }
      log(`Primal Screech! 1 damage to every creature in combat.`);
      for (const c of fighting) dealEventDamage(c, 1);
      SFX.damage();
      render();
      for (const c of fighting) if (!c.dying) FX.floatText(elByUid(c.uid), '-1');
      break;
    }
    case 'iceage':
      for (const c of e.board) c.frozen = true;
      log(`Ice Age! ${e.name === 'You' ? 'Your' : e.name + "'s"} creatures are frozen.`);
      SFX.freeze();
      render();
      FX.frostWash(null);   // battlefield-wide frost wash + snowfall
      break;
    case 'meteor': {
      log('Meteor Impact! 3 damage to every creature.');
      await FX.meteorStrike(null);               // sky darkens, the rock lands
      if (!G || G.over) break;
      const all = [...p.board, ...e.board];
      for (const c of all) dealEventDamage(c, 3);
      render();
      for (const c of all) {
        if (c.dying) continue;
        FX.burst(elByUid(c.uid), { n: 8, colors: ['#ff9d3c', '#ff5722'], shape: 'ember', speed: 160, grav: -80, life: 550, size: 3 });
        FX.floatText(elByUid(c.uid), '-3');
      }
      break;
    }
    case 'drift': {
      log(`Continental Drift! ${G.biome.name} is torn apart and the battlefield returns to normal.`);
      setBiome(null);
      SFX.rumble();
      FX.screenShake(20, 700);
      render();
      break;
    }
    case 'rain': {
      log(`Healing Rain washes over ${p.name === 'You' ? 'your' : p.name + "'s"} creatures.`);
      SFX.heal();
      for (const c of p.board) {
        if (c.dying || c.hp >= c.maxHp) continue;
        c.hp = Math.min(c.maxHp, c.hp + 2);
      }
      render();
      for (const c of p.board) {
        if (c.dying) continue;
        FX.floatText(elByUid(c.uid), '+2', 'heal');
        FX.sparkle(elByUid(c.uid), { colors: ['#7ee081', '#bfe3ff', '#e8f4ff'] });
      }
      break;
    }
    case 'sunder':
      target.armor = Math.max(0, target.armor - 3);
      log(`Sunder shatters ${target.name}'s armor!`);
      SFX.shatter();
      render();
      FX.impact(elByUid(target.uid), 1);
      FX.floatText(elByUid(target.uid), '-3 Armor');
      break;
    case 'mend':
      target.hp = Math.min(target.maxHp, target.hp + 4);
      log(`Primal Mending knits ${target.name}'s wounds.`);
      SFX.heal();
      render();
      FX.floatText(elByUid(target.uid), '+4', 'heal');
      FX.sparkle(elByUid(target.uid));
      break;
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
  if (typeof SAVE !== 'undefined' && !G.sandbox) SAVE.recordResult(G.winner === 0);
  if (G.winner === 0) SFX.win(); else SFX.lose();
  render();
  /* The loser's panel collapses first; the overlay waits for the dust. */
  const loserIdx = G.winner === 0 ? 1 : 0;
  const gen = G.gen;
  (async () => {
    await FX.heroDeath(heroEl(loserIdx));
    if (G && G.gen === gen && G.over) showGameOver();
  })();
  return true;
}

/* Concede the match: your leader falls on the spot. The guest routes it
   through the host; everyone else just zeroes their own leader. */
function surrender() {
  if (!G || G.over) return;   // allowed any time in a live game, even off-turn
  if (typeof NET !== 'undefined' && NET.isGuest()) { NET.sendSurrender(); return; }
  const p = G.players[0];
  log(`${p.name} raise${p.name === 'You' ? '' : 's'} the white flag!`);
  p.hp = 0;
  checkWin();
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
      if (G && !G.combat && G.active === 0 && !G.busy && !G.over) {
        if (NET.isGuest()) { NET.sendEndTurn(); return; }
        endTurn();
      }
    });
    document.getElementById('combat-btn').addEventListener('click', () => {
      if (G) commitCombatStage();
    });
    document.getElementById('combat-cancel-btn').addEventListener('click', () => {
      if (typeof clearCombatStage === 'function') { clearCombatStage(); render(); }
    });
    document.getElementById('surrender-btn').addEventListener('click', () => {
      if (!G || G.over) return;
      if (window.confirm('Raise the white flag and surrender this match?')) surrender();
    });
    document.getElementById('mute-btn').addEventListener('click', (ev) => {
      const m = SFX.toggleMute();
      ev.currentTarget.textContent = m ? '🔇' : '🔊';
      ev.currentTarget.title = m ? 'Unmute' : 'Mute';
      if (typeof SAVE !== 'undefined') SAVE.setSetting('muted', m);
    });
    document.getElementById('battlefield').addEventListener('click', (ev) => {
      if (ev.target.closest('.creature') || ev.target.closest('.lane-slot') || ev.target.closest('.side-panel')) return;
      if (typeof uiClearSelection === 'function') uiClearSelection();
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && typeof uiClearSelection === 'function') uiClearSelection();
    });
    /* Targeting arrow: follow the cursor while a source-anchored target
       picker is open (on-summon, stalker, targeted quick spells). */
    window.addEventListener('pointermove', (ev) => {
      if (typeof targetPicker !== 'undefined' && targetPicker && targetPicker.sourceUid != null) {
        arrowMouse = { x: ev.clientX, y: ev.clientY };
        drawTargetArrow();
      }
    });
    if (typeof initKeywordPopover === 'function') initKeywordPopover();
    if (typeof initEmoteMenu === 'function') initEmoteMenu();
    initMenus();
  });
}
