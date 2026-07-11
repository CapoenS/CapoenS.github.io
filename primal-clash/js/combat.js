/* ============================================
   Primal Clash — combat resolution
   Declared-attack / block combat (LoR-style):
   the attacker commits lanes of attackers, the
   defender commits blockers, queued quick
   events resolve first, then all duels strike
   simultaneously. Damage math, keywords
   (Venom, Stealth, Overwhelm, Frenzy), deaths.
   ============================================ */
"use strict";

function hasAb(c, ab) {
  if (c.abilities.includes(ab)) return true;
  /* Spinosaurus (River King): Regenerate while any biome is active. */
  return ab === 'regenerate' && c.abilityId === 'river_king'
    && typeof G !== 'undefined' && !!(G && G.biome);
}

/* Tribe membership — Spinosaurus (River King) counts as Aquatic too. */
function inTribe(c, tribe) {
  return c.tribe === tribe || (tribe === 'Aquatic' && c.abilityId === 'river_king');
}

/* +1 ATK if the active biome buffs this creature's tribe. */
function biomeAtkBonus(c) {
  return (G.biome && G.biome.buffTribe && inTribe(c, G.biome.buffTribe)) ? 1 : 0;
}

/* Live rule-text abilities (the italic text zone at the bottom of a card).
   Recomputed on the fly, like biome buffs — add new ability ids here. */
function abilityAtkBonus(c) {
  if (!c.abilityId || !G) return 0;
  switch (c.abilityId) {
    case 'pack_hunter': { /* Dire Wolf: +1 ATK per other Dire Wolf in play */
      let n = 0;
      for (const p of G.players) {
        for (const b of p.board) {
          if (b !== c && !b.dying && b.tplId === c.tplId) n++;
        }
      }
      return n;
    }
    case 'river_king':   /* Spinosaurus: +2 ATK while any biome is active */
      return G.biome ? 2 : 0;
  }
  return 0;
}

/* Effective attack = current ATK (includes Evolve/Frenzy)
   + biome bonus + rule-text ability bonus + this-turn quick buffs. */
function effAtk(c) {
  return Math.max(0, c.atk + biomeAtkBonus(c) + abilityAtkBonus(c) + (c.tempAtk || 0));
}

/* Effective armor = printed armor + this-turn quick buffs (Bone Plating). */
function effArmor(c) {
  return c.armor + (c.tempArmor || 0);
}

/* Overwhelm: innate keyword or granted for the turn (Trampling Fury). */
function hasOverwhelm(c) {
  return hasAb(c, 'overwhelm') || !!c.tempOverwhelm;
}

function creatureReady(c) {
  return !c.sick && !c.frozen && !c.dying && c.attacksLeft > 0;
}

/* A unit may be assigned as a blocker: alive and not frozen.
   Sickness and exhaustion do NOT prevent blocking — defense is
   always available; attacking is what costs readiness. */
function canBlock(c) {
  return !c.frozen && !c.dying;
}

/* Resolve a uid to a live creature instance on either board,
   or null if it is gone (died, retreated, bounced). The single
   stale-reference rule: everything in G.combat stores uids and
   re-resolves at the moment of use, skipping what is gone. */
function liveByUid(uid) {
  if (uid == null || !G) return null;
  for (const p of G.players) {
    const c = p.board.find((x) => x.uid === uid);
    if (c) return c.dying ? null : c;
  }
  return null;
}

/* Whose turn it is to act within combat (ignores the busy lock).
   The combat runs in four lock-in steps:
     block        → the DEFENDER assigns blockers
     attackerCast → the ATTACKER casts quick spells (now seeing the blocks)
     defenderCast → the DEFENDER casts quick spells
     resolving    → the engine resolves; nobody acts. */
function combatActor() {
  if (!G || !G.combat) return -1;
  switch (G.combat.phase) {
    case 'block':        return 1 - G.combat.attackerIdx;
    case 'attackerCast': return G.combat.attackerIdx;
    case 'defenderCast': return 1 - G.combat.attackerIdx;
    default:             return -1;
  }
}

/* Whose input does the engine accept right now? -1 = nobody's.
   During combat this is the defender/attacker per the current phase —
   even off the acting player's own turn. This one helper replaces every
   old "G.active === 0 && !G.busy" gate in ui/dragdrop/net. */
function actingSide() {
  if (!G || G.over || G.busy) return -1;
  if (G.combat) return combatActor();
  return G.active;
}

/* Zero out all this-turn quick buffs (Adrenaline Surge, Bone
   Plating, Trampling Fury). Called when combat ends and at endTurn. */
function clearTempCombatBuffs() {
  if (!G) return;
  for (const p of G.players) {
    for (const c of p.board) {
      c.tempAtk = 0;
      c.tempArmor = 0;
      c.tempOverwhelm = false;
    }
  }
}

/* Damage-taken triggers, shared by combat and event/biome damage:
   Frenzy (+2 ATK once) and Berserk (+1 ATK every single time). */
function triggerFrenzy(c, dmg) {
  if (dmg <= 0 || c.hp <= 0) return;
  if (!c.frenzyDone && hasAb(c, 'frenzy')) {
    c.frenzyDone = true;
    c.atk += 2;
    log(`${c.name} goes into a frenzy (+2 ATK)!`);
  }
  if (hasAb(c, 'berserk')) {
    c.atk += 1;
    log(`${c.name} goes berserk (+1 ATK)!`);
  }
}

/* Event/biome damage: bypasses armor, can still trigger Frenzy. */
function dealEventDamage(c, amount) {
  c.hp -= amount;
  triggerFrenzy(c, amount);
}

/* Devour: a combat killer with the Devour keyword — or Mosasaurus
   against Aquatic prey ('ocean_devour' rule text) — feasts on the
   victim, healing HP equal to the victim's max HP (capped at its own). */
function maybeDevour(killer, victim) {
  if (!killer || killer.hp <= 0 || killer.dying) return;
  const innate = hasAb(killer, 'devour');
  const oceanFeast = killer.abilityId === 'ocean_devour' && victim.tribe === 'Aquatic';
  if (!innate && !oceanFeast) return;
  const before = killer.hp;
  killer.hp = Math.min(killer.maxHp, killer.hp + victim.maxHp);
  const healed = killer.hp - before;
  log(`${killer.name} devours ${victim.name}${healed > 0 ? ` and heals ${healed} HP` : ''}!`);
  if (healed > 0) {
    SFX.heal();
    FX.floatText(elByUid(killer.uid), '+' + healed, 'heal');
  }
}

/*
 * One duel: the declared attacker and its blocker strike each other
 * simultaneously (even if one dies in the exchange).
 *   A deals max(0, A.effATK - B.effArmor) to B;
 *   B deals max(0, B.effATK - A.effArmor) back, unless A is Evasive.
 *   Venom: any nonzero combat damage destroys the other creature outright.
 * Pure damage math + logs — no deaths, no FX awaits, no render.
 * Returns { dmgToBlocker, dmgToAttacker, blockerHpBefore } (for Overwhelm).
 */
function resolveDuel(attacker, blocker) {
  const blockerHpBefore = blocker.hp;
  const dmgToBlocker = Math.max(0, effAtk(attacker) - effArmor(blocker));
  const dmgToAttacker = hasAb(attacker, 'evasive')
    ? 0                                            // Evasive: no retaliation when attacking
    : Math.max(0, effAtk(blocker) - effArmor(attacker));

  if (dmgToBlocker > 0 && hasAb(attacker, 'venom')) {
    blocker.hp = 0;
    log(`${attacker.name}'s venom destroys ${blocker.name}!`);
  } else {
    blocker.hp -= dmgToBlocker;
    log(`${attacker.name} attacks ${blocker.name} for ${dmgToBlocker}.`);
    triggerFrenzy(blocker, dmgToBlocker);
  }

  if (dmgToAttacker > 0) {
    if (hasAb(blocker, 'venom')) {
      attacker.hp = 0;
      log(`${blocker.name}'s venom destroys ${attacker.name}!`);
    } else {
      attacker.hp -= dmgToAttacker;
      log(`${blocker.name} strikes back for ${dmgToAttacker}.`);
      triggerFrenzy(attacker, dmgToAttacker);
    }
  } else if (hasAb(attacker, 'evasive') && effAtk(blocker) > 0) {
    log(`${attacker.name} darts away untouched (Evasive).`);
  }

  /* Breacher: a landed strike permanently shreds the victim's armor
     (−1, or −2 with 4+ ATK). The blocker's counter-strike shreds too,
     unless an Evasive attacker denied it. */
  const shred = (striker, victim) => {
    if (!hasAb(striker, 'breacher') || victim.armor <= 0) return;
    const n = Math.min(victim.armor, effAtk(striker) >= 4 ? 2 : 1);
    victim.armor -= n;
    log(`${striker.name} shreds ${n} Armor off ${victim.name}!`);
  };
  shred(attacker, blocker);
  if (!hasAb(attacker, 'evasive')) shred(blocker, attacker);

  /* Devour triggers for whichever side scored a kill in the exchange. */
  if (blocker.hp <= 0) maybeDevour(attacker, blocker);
  if (attacker.hp <= 0) maybeDevour(blocker, attacker);

  return { dmgToBlocker, dmgToAttacker, blockerHpBefore };
}

/*
 * Full combat resolution. Called ONLY from commitBlocks (game.js),
 * always under G.busy = true — so every FX/SFX call here is captured
 * by the multiplayer relay and every render() streams to the guest.
 *
 * 1. Queued quick events resolve FIFO (attacker's were cast first).
 *    Per-spell deaths are intentional: a blocker killed by a spell
 *    leaves its lane open and the attacker hits the leader.
 * 2. Duels + unblocked leader hits, lane by lane (sequential FX,
 *    but no creature fights twice, so this IS the simultaneous model).
 * 3. One handleDeaths pass for all duel damage (morale aggregates once).
 */
async function resolveCombat() {
  const gen = G.gen;
  const combat = G.combat;
  const atkP = combat.attackerIdx;
  const defP = 1 - atkP;

  /* --- 1. Reveal & resolve quick events, FIFO --- */
  for (const q of combat.quicks) {
    if (!G || G.gen !== gen || G.over) return;
    const qn = G.players[q.side].name;
    log(`${qn} unleash${qn === 'You' ? '' : 'es'} ${q.card.name}!`);
    SFX.playCard();
    render();
    /* The hidden spell is revealed to the other side, big and center. */
    await FX.cardReveal(null, { side: q.side, card: q.card });
    await FX.sleep(250);
    if (!G || G.gen !== gen || G.over) return;
    if (eventNeedsTarget(q.card)) {
      const target = liveByUid(q.targetUid);
      if (!target) {
        log(`${q.card.name} fizzles — its target is gone.`);
        render();
        continue;
      }
      await resolveEvent(q.side, q.card, target);
    } else {
      await resolveEvent(q.side, q.card, undefined);
    }
    if (!G || G.gen !== gen) return;
  }

  /* --- 2. Duels & leader hits, lane by lane --- */
  for (const lane of combat.lanes) {
    if (!G || G.gen !== gen || G.over) return;
    const a = liveByUid(lane.aUid);
    if (!a) continue;                    // attacker died to a spell — lane is void
    if (a.stealthed) {
      a.stealthed = false;
      log(`${a.name} strikes from the mists!`);
    }
    const b = lane.bUid != null ? liveByUid(lane.bUid) : null;

    if (b) {
      const power = effAtk(a);
      SFX.attack();
      /* lunge resolves at contact; numbers + shockwave land on that
         frame while the attacker bounces off and glides home. Rendering
         waits for `settled` — a re-render mid-flight doubles the card. */
      const flight = await FX.lunge(elByUid(a.uid), elByUid(b.uid), power);
      if (!G || G.gen !== gen) return;
      const r = resolveDuel(a, b);
      SFX.damage();
      if (r.dmgToBlocker > 0) FX.floatText(elByUid(b.uid), '-' + r.dmgToBlocker);
      if (r.dmgToAttacker > 0) FX.floatText(elByUid(a.uid), '-' + r.dmgToAttacker);
      /* heavy hitters land harder: impact scales with damage AND raw power */
      FX.impact(elByUid(b.uid), Math.min(3, 0.6 + r.dmgToBlocker / 4 + (power >= 6 ? 0.7 : 0)));
      await FX.hitstop(power >= 6 ? 110 : 80);
      await flight.settled;
      if (!G || G.gen !== gen) return;
      render();
      /* Overwhelm: excess beyond the blocker's remaining HP hits the
         leader. Computed from real damage only — a venom instant-kill
         where the numbers fell short carries nothing through. */
      if (b.hp <= 0 && hasOverwhelm(a)) {
        const excess = Math.max(0, r.dmgToBlocker - Math.max(0, r.blockerHpBefore));
        if (excess > 0) {
          G.players[defP].hp -= excess;
          log(`${a.name} overwhelms for ${excess} damage to ${G.players[defP].name}!`);
          render();
          FX.floatText(heroEl(defP), '-' + excess);
          FX.impact(heroEl(defP), Math.min(2.5, 0.8 + excess / 4));
        }
      }
    } else {
      /* Unblocked: straight to the leader. */
      const dmg = effAtk(a);
      SFX.attack();
      const flight = await FX.lunge(elByUid(a.uid), heroEl(defP), dmg);
      if (!G || G.gen !== gen) return;
      G.players[defP].hp -= dmg;
      log(`${a.name} hits ${G.players[defP].name} for ${dmg}!`);
      SFX.damage();
      FX.floatText(heroEl(defP), '-' + dmg);
      FX.impact(heroEl(defP), Math.min(3, 0.9 + dmg / 5 + (dmg >= 6 ? 0.5 : 0)));
      await FX.hitstop(dmg >= 6 ? 110 : 80);
      await flight.settled;
      if (!G || G.gen !== gen) return;
      render();
    }
    if (checkWin()) { G.combat = null; return; }   // leader fell mid-swing
    await FX.sleep(160);
  }
  if (!G || G.gen !== gen) return;

  /* --- 3. All duel deaths at once, then back to the main phase --- */
  await handleDeaths();
  if (!G || G.gen !== gen) return;
  clearTempCombatBuffs();
  G.combat = null;
  /* Both tribes catch their breath: quick amber refills right after a
     combat — nobody waits for their own turn to cast quicks again. */
  for (const pl of G.players) pl.qmber = pl.qmberMax;
  if (!G.over) G.busy = false;
  log('The dust settles.');
  render();

  /* Solo: if the attacker was the AI, its turn now resumes. */
  if (G.players[G.active].isAI && !G.over) await aiResumeTurn(gen);
}

/* Fade out and remove every creature at 0 HP or less.
   Fallen allies shake the survivors' resolve: each friendly death
   costs every surviving creature on that side 1 Morale — which can
   trigger retreats (handled by processRetreats afterwards). */
async function handleDeaths() {
  const deadByPlayer = [0, 0];
  const dead = [];
  /* Carboniferous Jungle: remember each fallen arthropod's board slot so
     its Archimylacris can crawl out "in its place". The token itself never
     spawns another one (tplId guard). */
  const ds = G.biome && G.biome.deathSpawn;
  const spawns = [[], []];
  for (let i = 0; i < 2; i++) {
    for (const c of G.players[i].board) {
      if (c.hp <= 0 && !c.dying) {
        c.dying = true;
        dead.push(c);
        deadByPlayer[i]++;
        if (ds && c.tribe === ds.tribe && c.tplId !== ds.token) {
          spawns[i].push(G.players[i].board.indexOf(c));
        }
      }
    }
  }
  if (dead.length) {
    SFX.death();
    SFX.shatter();
    for (const c of dead) log(`${c.name} is destroyed.`);
    render();
    for (const c of dead) FX.deathBurst(elByUid(c.uid));
    await FX.sleep(600);
    for (const p of G.players) p.board = p.board.filter((c) => !c.dying);
    for (let i = 0; i < 2; i++) {
      if (!deadByPlayer[i]) continue;
      for (const c of G.players[i].board) loseMorale(c, deadByPlayer[i]);
    }
    const born = [];
    for (let i = 0; i < 2; i++) {
      for (const slot of spawns[i]) {
        const pl = G.players[i];
        if (pl.board.length >= 7) break;
        const inst = makeCreatureInstance(TOKENS.find((t) => t.id === ds.token));
        inst.justPlayed = false;
        applyBiomeOnEnter(inst);
        pl.board.splice(Math.min(slot, pl.board.length), 0, inst);
        log(`An ${inst.name} crawls from the remains!`);
        born.push(inst);
      }
    }
    render();
    if (born.length) {
      SFX.whoosh();
      for (const b of born) FX.dust(elByUid(b.uid));
    }
  }
  await processRetreats();
}
