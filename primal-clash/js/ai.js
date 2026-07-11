/* ============================================
   Primal Clash — AI opponent (player 1)
   Heuristic AI: plays big creatures, uses
   removal on real threats, declares favorable
   attacks, and blocks to survive first and
   trade up second.
   ============================================ */
"use strict";

/* Rough worth of a creature for trade decisions. */
function aiValue(c) { return c.cost + effAtk(c) + c.hp; }

/* Would attacker `a` kill target `t` this attack? */
function aiKills(a, t) {
  const d = Math.max(0, effAtk(a) - effArmor(t));
  return d > 0 && (hasAb(a, 'venom') || d >= t.hp);
}

/* Would attacker `a` die to the counterattack?
   Combat is simultaneous: even a dying defender strikes back,
   unless the attacker is Evasive. */
function aiDiesBack(a, t) {
  if (hasAb(a, 'evasive')) return false;
  const d = Math.max(0, effAtk(t) - effArmor(a));
  return d > 0 && (hasAb(t, 'venom') || d >= a.hp);
}

/* Overwhelm spill-through if `a` kills blocker `b`. */
function aiOverwhelmSpill(a, b) {
  if (!hasOverwhelm(a) || !aiKills(a, b)) return 0;
  return Math.max(0, effAtk(a) - effArmor(b) - Math.max(0, b.hp));
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
  if (!G || G.over || G.gen !== gen) return;

  /* Phase 2: declare an attack — the human blocks, and the turn
     resumes in aiResumeTurn() after the combat resolves. */
  const decl = aiDeclareAttack();
  if (decl) {
    await declareAttack(1, decl);
    return;
  }

  /* No attack worth making: pass. */
  await endTurn();
}

/* Called by resolveCombat() when the AI's declared attack has resolved:
   spend any leftover amber, then end the turn. */
async function aiResumeTurn(gen) {
  if (!G || G.over || G.gen !== gen) return;
  G.busy = true;
  render();
  await FX.sleep(400);
  let safety = 40;
  while (safety-- > 0 && G && !G.over && G.gen === gen) {
    const played = await aiPlayOneCard();
    if (!played) break;
    await FX.sleep(500);
  }
  if (G && !G.over && G.gen === gen) await endTurn();
}

/* Try to play the best single card; returns false when done. */
async function aiPlayOneCard() {
  const p = G.players[1];
  const affordable = p.hand.filter((c) => canPayCost(p, c));   // quicks count the quick bar
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
    case 'rain': { // worth it from ~4 missing HP across the board
      const missing = p.board.reduce((s, c) => s + (c.dying ? 0 : Math.min(2, c.maxHp - c.hp)), 0);
      return missing >= 4 ? {} : null;
    }
    case 'sunder': { // strip a thick hide worth attacking into
      const good = targets.filter((t) => t.armor >= 2 && aiValue(t) >= 7);
      return good.length ? { target: best(good) } : null;
    }
    case 'mend': { // patch a valuable wounded friendly
      const hurt = targets.filter((t) => p.board.includes(t) && t.maxHp - t.hp >= 3 && aiValue(t) >= 6);
      return hurt.length ? { target: best(hurt) } : null;
    }
    case 'evolve': { // only when there is nothing better to develop
      if (!p.board.length) return null;
      const canDevelop = p.hand.some((c) => c.type === 'creature' && c.cost <= p.amber);
      if (canDevelop) return null;
      const options = p.board.filter((c) => !c.dying);
      return options.length ? { target: best(options) } : null;
    }
    case 'drift': { // wipe a biome that clearly favors the human
      if (!G.biome) return null;
      if (G.biome.burn) return p.board.length > e.board.length ? {} : null;
      const tribe = biomeTribe(G.biome);
      if (!tribe) return null;
      const mine = p.board.filter((c) => c.tribe === tribe).length;
      const theirs = e.board.filter((c) => c.tribe === tribe).length;
      return theirs >= 2 && theirs > mine + 1 ? {} : null;
    }
  }
  return null;
}

/* The tribe a biome favors, whatever its mechanic (ATK/HP buff, swift,
   death-spawn, Deep Freeze exemption). null for tribe-less biomes (burn). */
function biomeTribe(card) {
  return card.buffTribe || card.grantSwift || card.freezeOthers
    || (card.deathSpawn && card.deathSpawn.tribe) || null;
}

function aiBiomeGood(card) {
  const p = G.players[1];
  const e = G.players[0];
  if (G.biome && G.biome.id === card.id) return false;
  if (card.burn) {
    // Volcanic Wastes: only when the enemy has clearly more on board.
    return e.board.length >= p.board.length + 2;
  }
  const tribe = biomeTribe(card);
  if (!tribe) return false;
  const mine = p.board.filter((c) => c.tribe === tribe).length
    + 0.5 * p.hand.filter((c) => c.type === 'creature' && c.tribe === tribe).length;
  const theirs = e.board.filter((c) => c.tribe === tribe).length;
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

/* ---------- declaring attacks ---------- */

/* Attacker-perspective outcome if `a` gets blocked by `b`. */
function aiDuelScore(a, b) {
  let s = 0;
  if (aiKills(a, b)) s += aiValue(b);
  if (aiDiesBack(a, b)) s -= aiValue(a);
  s += aiOverwhelmSpill(a, b);
  return s;
}

/* Stalker pick for attacker `a`: free kill > biggest kill > weakest fighter. */
function aiStalkerTarget(a, taken) {
  const candidates = G.players[0].board
    .filter((t) => canBlock(t) && !t.stealthed && !taken.has(t.uid));
  if (!candidates.length) return null;
  const byValue = (arr) => arr.slice().sort((x, y) => aiValue(y) - aiValue(x));
  const freeKills = candidates.filter((t) => aiKills(a, t) && !aiDiesBack(a, t));
  if (freeKills.length) return byValue(freeKills)[0];
  const kills = candidates.filter((t) => aiKills(a, t));
  if (kills.length) return byValue(kills)[0];
  return candidates.slice().sort((x, y) => effAtk(x) - effAtk(y))[0];
}

/* Decide the attack declaration, or null to hold everything home. */
function aiDeclareAttack() {
  const p = G.players[1];
  const e = G.players[0];
  const ready = p.board.filter(creatureReady);
  if (!ready.length) return null;
  const blockers = e.board.filter(canBlock);

  /* Pessimistic lethal check: the defender blocks our biggest hitters
     first; what still gets through (stealth + overflow) may be enough. */
  const nonStealth = ready.filter((c) => !c.stealthed)
    .sort((x, y) => effAtk(y) - effAtk(x));
  let through = ready.filter((c) => c.stealthed).reduce((s, c) => s + effAtk(c), 0);
  nonStealth.forEach((c, i) => { if (i >= blockers.length) through += effAtk(c); });
  const lethal = through >= e.hp;

  const picks = [];
  for (const a of ready) {
    if (picks.length >= 7) break;
    if (lethal || a.stealthed || !blockers.length) { picks.push(a); continue; }
    /* Worst realistic block: attack anyway if even that is acceptable. */
    const worst = Math.min(...blockers.map((b) => aiDuelScore(a, b)));
    if (worst >= 0) { picks.push(a); continue; }
    /* Overwhelm bullies chump blockers. */
    if (hasOverwhelm(a) && blockers.every((b) => aiOverwhelmSpill(a, b) >= 3)) { picks.push(a); continue; }
    /* Outnumbered defense: extra attackers get through anyway. */
    if (picks.filter((x) => !x.stealthed).length >= blockers.length) { picks.push(a); continue; }
  }
  if (!picks.length) return null;

  /* Lane order: likely-blocked bruisers first, stealth/overwhelm last. */
  picks.sort((x, y) =>
    ((x.stealthed || hasOverwhelm(x)) ? 1 : 0) - ((y.stealthed || hasOverwhelm(y)) ? 1 : 0));

  const taken = new Set();
  const lanes = picks.map((a) => {
    const lane = { uid: a.uid };
    if (hasAb(a, 'stalker')) {
      const t = aiStalkerTarget(a, taken);
      if (t) { lane.stalkerTargetUid = t.uid; taken.add(t.uid); }
    }
    return lane;
  });
  return { lanes };   // the attacker's spells are cast later, after seeing the blocks
}

/* ---------- blocking (the AI acts during the HUMAN's turn) ---------- */

/* Decide blocker assignments for the human's committed attack.
   ANTI-PEEK RULE: never read G.combat.quicks entries whose side !== 1 —
   the human's queued spells are hidden information even though they sit
   in the same process. Blocks are chosen as if the queue were unknown. */
function aiAssignBlocks() {
  const combat = G.combat;
  const p = G.players[1];
  const myHp = p.hp;
  const free = p.board.filter((c) =>
    canBlock(c) && !combat.lanes.some((l) => l.bUid === c.uid));

  /* Open lanes the AI may block (stalker locks and stealth are untouchable). */
  const open = combat.lanes
    .map((l, i) => ({ i, a: liveByUid(l.aUid), locked: l.stalkerLock }))
    .filter((x) => x.a && !x.locked && !x.a.stealthed);
  open.sort((x, y) => effAtk(y.a) - effAtk(x.a));   // biggest threat first

  const blocks = [];
  const blockedLanes = new Set();
  const assign = (laneEntry, blocker) => {
    blocks.push({ lane: laneEntry.i, uid: blocker.uid });
    blockedLanes.add(laneEntry.i);
    free.splice(free.indexOf(blocker), 1);
  };

  /* Incoming face damage with the current assignment (incl. overwhelm
     spill from blocked lanes and from stalker-locked lanes). */
  const incoming = () => {
    let dmg = 0;
    for (const x of open) {
      if (!blockedLanes.has(x.i)) { dmg += effAtk(x.a); continue; }
      const b = G.players[1].board.find((c) => c.uid === blocks.find((bb) => bb.lane === x.i).uid);
      if (b) dmg += aiOverwhelmSpill(x.a, b);
    }
    for (const l of combat.lanes) {
      if (!l.stalkerLock) continue;
      const a = liveByUid(l.aUid);
      const b = liveByUid(l.bUid);
      if (a && b) dmg += aiOverwhelmSpill(a, b);
      else if (a && !b) dmg += effAtk(a);
    }
    return dmg;
  };

  /* Pass 1 — survive: while the swing is lethal, absorb the biggest
     unblocked lane with whatever soaks/trades best. */
  let safety = 14;
  while (safety-- > 0 && incoming() >= myHp && free.length) {
    const lane = open.find((x) => !blockedLanes.has(x.i));
    if (!lane) break;
    const best = free.slice().sort((b1, b2) => {
      const soak = (b) => Math.min(effAtk(lane.a), Math.max(0, b.hp) + effArmor(b))
        + (aiKills(b, lane.a) ? 3 : 0) - aiOverwhelmSpill(lane.a, b);
      return soak(b2) - soak(b1);
    })[0];
    assign(lane, best);
  }

  /* Pass 2 — value: block when it clearly pays. */
  for (const lane of open) {
    if (blockedLanes.has(lane.i) || !free.length) continue;
    const nonLethal = incoming() < myHp;
    const scored = free.map((b) => {
      const kills = aiKills(b, lane.a);                 // blocker strikes the attacker
      const dies = aiKills(lane.a, b);                  // attacker kills the blocker
      const prevented = effAtk(lane.a) - aiOverwhelmSpill(lane.a, b);
      return { b, kills, dies, score: prevented + (kills ? aiValue(lane.a) : 0) - (dies ? aiValue(b) : 0) };
    }).sort((x, y) => y.score - x.score);
    const best = scored[0];
    if (!best || best.score <= 0) continue;
    /* Don't chump away the last body against a survivable swing. */
    if (free.length === 1 && nonLethal && best.dies && !best.kills) continue;
    assign(lane, best.b);
  }
  return blocks;
}

/* Quick-event heuristics.
   ANTI-PEEK: these may read the PUBLIC declared attack (lanes/attackers)
   but never G.combat.quicks entries with side !== 1 (the human's hidden
   queue). They only look at the board and their own hand. */

/* Attacker spell window — now cast AFTER the blocks are known, so the AI
   can see exactly which attackers get through. Conservative: pump an
   unblocked attacker with Adrenaline Surge only when it turns a
   near-lethal swing into lethal. */
function aiQuickAttack(attackers) {
  const p = G.players[1];
  const e = G.players[0];
  const surge = p.hand.find((c) => c.type === 'event' && c.quick && c.effect === 'surge' && canPayCost(p, c));
  if (!surge || !G.combat) return [];
  const unblocked = G.combat.lanes.filter((l) => l.bUid == null).map((l) => liveByUid(l.aUid)).filter(Boolean);
  const face = unblocked.reduce((s, c) => s + effAtk(c), 0);
  const biggest = unblocked.slice().sort((x, y) => effAtk(y) - effAtk(x))[0];
  if (biggest && face < e.hp && face + 2 >= e.hp) {
    return [{ cardUid: surge.uid, targetUid: biggest.uid }];
  }
  return [];
}

/* Defender window (sees the full declared attack). Spend removal quicks to
   kill the biggest attacker outright (voiding its whole lane). */
function aiQuickDefense() {
  const p = G.players[1];
  const out = [];
  let amber = p.amber + p.qmber;   // quicks drink the quick bar first
  const usable = p.hand.filter((c) => c.type === 'event' && c.quick && (c.effect === 'ambush' || c.effect === 'eruption'));
  if (!usable.length) return out;
  const attackers = G.combat.lanes
    .map((l) => liveByUid(l.aUid)).filter(Boolean)
    .filter((a) => !a.stealthed)
    .sort((x, y) => aiValue(y) - aiValue(x));
  for (const card of usable) {
    if (card.cost > amber) continue;
    const dmg = card.effect === 'ambush' ? 2 : 4;
    const legal = eventTargets(1, card) || [];
    const kill = attackers.find((a) => legal.includes(a) && a.hp <= dmg && aiValue(a) >= 6);
    if (kill) {
      out.push({ cardUid: card.uid, targetUid: kill.uid });
      amber -= card.cost;
      attackers.splice(attackers.indexOf(kill), 1);
    }
  }
  return out;
}

/* Called by advanceCombat() whenever it is the AI's turn to act within a
   combat (as attacker or defender, at whichever of the four phases). The
   AI runs inside the busy window; each commit re-asserts busy as needed. */
async function aiCombatStep(gen, side) {
  await FX.sleep(600);
  if (!G || G.gen !== gen || !G.combat || G.over) return;
  const phase = G.combat.phase;
  G.busy = false;   // the commit functions manage the lock from here
  if (phase === 'block') {
    await commitBlocks(side, { blocks: aiAssignBlocks() });
  } else if (phase === 'attackerCast') {
    const attackers = G.combat.lanes.map((l) => liveByUid(l.aUid)).filter(Boolean);
    await commitAttackerCast(side, { quicks: aiQuickAttack(attackers) });
  } else if (phase === 'defenderCast') {
    await commitDefenderCast(side, { quicks: aiQuickDefense() });
  }
}
