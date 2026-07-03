/* ============================================
   Primal Clash — AI opponent (player 1)
   Heuristic AI: plays big creatures, uses
   removal on real threats, respects taunts,
   trades favorably, goes face when safe.
   ============================================ */
"use strict";

/* Rough worth of a creature for trade decisions. */
function aiValue(c) { return c.cost + effAtk(c) + c.hp; }

/* Would attacker `a` kill target `t` this attack? */
function aiKills(a, t) {
  const d = Math.max(0, effAtk(a) - t.armor);
  return d > 0 && (hasAb(a, 'venom') || d >= t.hp);
}

/* Would attacker `a` die to the counterattack?
   Combat is simultaneous: even a dying defender strikes back,
   unless the attacker is Evasive. */
function aiDiesBack(a, t) {
  if (hasAb(a, 'evasive')) return false;
  const d = Math.max(0, effAtk(t) - a.armor);
  return d > 0 && (hasAb(t, 'venom') || d >= a.hp);
}

async function aiTakeTurn() {
  const gen = G.gen;
  await FX.sleep(700);

  /* Phase 1: play cards until nothing good is left. */
  let safety = 40;
  while (safety-- > 0 && G && !G.over && G.gen === gen) {
    const played = await aiPlayOneCard();
    if (!played) break;
    await FX.sleep(500);
  }

  /* Phase 2: attack. */
  if (G && !G.over && G.gen === gen) await aiAttackPhase(gen);

  /* Phase 3: pass. */
  if (G && !G.over && G.gen === gen) await endTurn();
}

/* Try to play the best single card; returns false when done. */
async function aiPlayOneCard() {
  const p = G.players[1];
  const affordable = p.hand.filter((c) => c.cost <= p.amber);
  if (!affordable.length) return false;

  /* 1. Events with a clearly good use right now. */
  for (const card of affordable.filter((c) => c.type === 'event')) {
    const plan = aiEvaluateEvent(card);
    if (plan) return playCardFromHand(1, card.uid, plan.target);
  }

  /* 2. Biggest affordable creature — board development first. */
  const creatures = affordable.filter((c) => c.type === 'creature');
  if (creatures.length && p.board.length < 7) {
    creatures.sort((a, b) => b.cost - a.cost || b.atk - a.atk);
    return playCardFromHand(1, creatures[0].uid);
  }

  /* 3. A biome that favors us, with leftover amber. */
  for (const card of affordable.filter((c) => c.type === 'biome')) {
    if (aiBiomeGood(card)) return playCardFromHand(1, card.uid);
  }

  return false;
}

/* Returns { target } (target may be undefined for untargeted events) or null to hold the card. */
function aiEvaluateEvent(card) {
  const p = G.players[1];
  const e = G.players[0];
  const targets = eventTargets(1, card) || [];
  const best = (arr) => arr.slice().sort((a, b) => aiValue(b) - aiValue(a))[0];

  switch (card.effect) {
    case 'ambush': { // only spend it on a kill
      const kills = targets.filter((t) => t.hp <= 2);
      return kills.length ? { target: best(kills) } : null;
    }
    case 'tarpit': { // save it for something worth destroying
      const good = targets.filter((t) => aiValue(t) >= 8);
      return good.length ? { target: best(good) } : null;
    }
    case 'eruption': { // kill a meaningful enemy creature
      const kills = targets.filter((t) => e.board.includes(t) && t.hp <= 4 && aiValue(t) >= 7);
      return kills.length ? { target: best(kills) } : null;
    }
    case 'meteor': { // needs a clearly winning board sweep
      const eDead = e.board.filter((c) => c.hp <= 3).length;
      const pDead = p.board.filter((c) => c.hp <= 3).length;
      return (eDead >= 2 && eDead > pDead) ? {} : null;
    }
    case 'iceage': { // stall a threatening board
      const threat = e.board.reduce((s, c) => s + effAtk(c), 0);
      return threat >= 8 ? {} : null;
    }
    case 'spring':
      return p.hp <= 20 ? {} : null;
    case 'rally': { // shore up a wavering board
      const shaken = p.board.filter((c) => !hasAb(c, 'fearless') && !c.dying && c.morale < c.moraleMax);
      const desperate = p.board.some((c) => !hasAb(c, 'fearless') && !c.dying && c.morale <= 1);
      return (shaken.length >= 2 || desperate) ? {} : null;
    }
    case 'excavate':
      return p.hand.length <= 3 ? {} : null;
    case 'evolve': { // only when there is nothing better to develop
      if (!p.board.length) return null;
      const canDevelop = p.hand.some((c) => c.type === 'creature' && c.cost <= p.amber);
      if (canDevelop) return null;
      const options = p.board.filter((c) => !c.dying);
      return options.length ? { target: best(options) } : null;
    }
  }
  return null;
}

function aiBiomeGood(card) {
  const p = G.players[1];
  const e = G.players[0];
  if (G.biome && G.biome.id === card.id) return false;
  if (card.burn) {
    // Volcanic Wastes: only when the enemy has clearly more on board.
    return e.board.length >= p.board.length + 2;
  }
  const mine = p.board.filter((c) => c.tribe === card.buffTribe).length
    + 0.5 * p.hand.filter((c) => c.type === 'creature' && c.tribe === card.buffTribe).length;
  const theirs = e.board.filter((c) => c.tribe === card.buffTribe).length;
  return mine >= 2 && mine > theirs + 0.5;
}

/* Target for an On Summon effect: the enemy's most valuable
   legal target, or — if forced to hit its own side — the least
   valuable friendly one. */
function aiChooseOnSummonTarget(pIdx, inst, targets) {
  const foe = G.players[1 - pIdx];
  const enemyT = targets.filter((t) => foe.board.includes(t));
  if (enemyT.length) return enemyT.slice().sort((a, b) => aiValue(b) - aiValue(a))[0];
  return targets.slice().sort((a, b) => aiValue(a) - aiValue(b))[0];
}

async function aiAttackPhase(gen) {
  let safety = 30;
  while (safety-- > 0 && G && !G.over && G.gen === gen) {
    const p = G.players[1];
    const ready = p.board.filter(creatureReady);
    if (!ready.length) break;
    const attacker = ready[0];
    const tset = validAttackTargets(1, attacker);
    const target = aiChooseTarget(attacker, tset);
    if (!target) {
      attacker.attacksLeft = 0; // deliberately hold this one back
      continue;
    }
    await performAttack(1, attacker, target);
    await FX.sleep(450);
  }
}

function aiChooseTarget(a, tset) {
  const e = G.players[0];
  const cs = tset.creatures.filter((c) => !c.dying);
  const byValue = (arr) => arr.slice().sort((x, y) => aiValue(y) - aiValue(x));

  /* Lethal: if our ready attackers can finish the leader, go face. */
  const totalReady = G.players[1].board.filter(creatureReady).reduce((s, c) => s + effAtk(c), 0);
  if (tset.leader && totalReady >= e.hp) return 'leader';

  /* Free kills: destroy without dying back. */
  const freeKills = cs.filter((t) => aiKills(a, t) && !aiDiesBack(a, t));
  if (freeKills.length) return byValue(freeKills)[0];

  /* Venom: happily hit anything big it can actually damage. */
  if (hasAb(a, 'venom')) {
    const big = cs.filter((t) => effAtk(a) > t.armor && aiValue(t) >= aiValue(a));
    if (big.length) return byValue(big)[0];
  }

  /* Value trades: kill it even if we die, when it is worth clearly more. */
  const trades = cs.filter((t) => aiKills(a, t) && aiValue(t) > aiValue(a) + 2);
  if (trades.length) return byValue(trades)[0];

  /* No taunt in the way: go face. */
  if (tset.leader) return 'leader';

  /* Forced into a taunt: chip it if we survive, or take the least-bad kill. */
  const chip = cs.filter((t) => !aiDiesBack(a, t) && effAtk(a) > t.armor);
  if (chip.length) return byValue(chip)[0];
  const desperate = cs.filter((t) => aiKills(a, t));
  if (desperate.length) return desperate[0];

  return null; // hold back rather than suicide into a taunt
}
