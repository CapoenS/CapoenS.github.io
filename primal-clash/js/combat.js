/* ============================================
   Primal Clash — combat resolution
   Attack legality, damage math, keywords
   (Taunt, Venom, Stealth, Frenzy), and deaths.
   ============================================ */
"use strict";

function hasAb(c, ab) { return c.abilities.includes(ab); }

/* +1 ATK if the active biome buffs this creature's tribe. */
function biomeAtkBonus(c) {
  return (G.biome && G.biome.buffTribe === c.tribe) ? 1 : 0;
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
  }
  return 0;
}

/* Effective attack = current ATK (includes Evolve/Frenzy)
   + biome bonus + rule-text ability bonus. */
function effAtk(c) {
  return Math.max(0, c.atk + biomeAtkBonus(c) + abilityAtkBonus(c));
}

function creatureReady(c) {
  return !c.sick && !c.frozen && !c.dying && c.attacksLeft > 0;
}

/*
 * Legal attack targets for `attacker` owned by player pIdx.
 * - Enemy Taunt creatures must be attacked first, unless the
 *   attacker still has Stealth (Stealth ignores Taunt).
 * - Stealthed enemy creatures can never be targeted.
 * Returns { creatures: [...], leader: bool }.
 */
function validAttackTargets(pIdx, attacker) {
  const enemy = G.players[1 - pIdx];
  const taunts = enemy.board.filter((t) => hasAb(t, 'taunt') && !t.dying);
  if (taunts.length && !attacker.stealthed) {
    return { creatures: taunts, leader: false };
  }
  return {
    creatures: enemy.board.filter((t) => !t.stealthed && !t.dying),
    leader: true,
  };
}

/* Frenzy: +2 ATK permanently the first time the creature takes damage. */
function triggerFrenzy(c, dmg) {
  if (dmg > 0 && c.hp > 0 && !c.frenzyDone && hasAb(c, 'frenzy')) {
    c.frenzyDone = true;
    c.atk += 2;
    log(`${c.name} goes into a frenzy (+2 ATK)!`);
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
 * Resolve an attack. `target` is a creature object or the string 'leader'.
 * Combat math:
 *   A deals max(0, A.effATK - B.armor) to B;
 *   if B survives, B deals max(0, B.effATK - A.armor) back to A.
 *   Venom: any nonzero combat damage destroys the other creature outright.
 */
async function performAttack(pIdx, attacker, target) {
  if (!G || G.over || !attacker || attacker.dying) return;
  const enemy = G.players[1 - pIdx];

  attacker.attacksLeft = Math.max(0, attacker.attacksLeft - 1);
  if (attacker.stealthed) {
    attacker.stealthed = false;
    log(`${attacker.name} breaks Stealth!`);
  }

  const aEl = elByUid(attacker.uid);
  const tEl = target === 'leader' ? heroEl(1 - pIdx) : elByUid(target.uid);
  SFX.attack();
  await FX.lunge(aEl, tEl);

  if (target === 'leader') {
    const dmg = effAtk(attacker);
    enemy.hp -= dmg;
    log(`${attacker.name} hits ${enemy.name} for ${dmg}!`);
    SFX.damage();
    render();
    FX.floatText(heroEl(1 - pIdx), '-' + dmg);
    FX.shake(heroEl(1 - pIdx));
    checkWin();
    return;
  }

  const dmgToTarget = Math.max(0, effAtk(attacker) - target.armor);
  const dmgToAttacker = hasAb(attacker, 'evasive')
    ? 0                                            // Evasive: no retaliation
    : Math.max(0, effAtk(target) - attacker.armor);

  /* Simultaneous exchange: both creatures strike,
     even if one of them dies in the process. */
  if (dmgToTarget > 0 && hasAb(attacker, 'venom')) {
    target.hp = 0;
    log(`${attacker.name}'s venom destroys ${target.name}!`);
  } else {
    target.hp -= dmgToTarget;
    log(`${attacker.name} attacks ${target.name} for ${dmgToTarget}.`);
    triggerFrenzy(target, dmgToTarget);
  }

  if (dmgToAttacker > 0) {
    if (hasAb(target, 'venom')) {
      attacker.hp = 0;
      log(`${target.name}'s venom destroys ${attacker.name}!`);
    } else {
      attacker.hp -= dmgToAttacker;
      log(`${target.name} strikes back for ${dmgToAttacker}.`);
      triggerFrenzy(attacker, dmgToAttacker);
    }
  } else if (hasAb(attacker, 'evasive') && effAtk(target) > 0) {
    log(`${attacker.name} darts away untouched (Evasive).`);
  }

  /* Devour triggers for whichever side scored a kill in the exchange. */
  if (target.hp <= 0) maybeDevour(attacker, target);
  if (attacker.hp <= 0) maybeDevour(target, attacker);

  SFX.damage();
  render();
  if (dmgToTarget > 0) FX.floatText(elByUid(target.uid), '-' + dmgToTarget);
  if (dmgToAttacker > 0) FX.floatText(elByUid(attacker.uid), '-' + dmgToAttacker);

  await handleDeaths();
}

/* Fade out and remove every creature at 0 HP or less.
   Fallen allies shake the survivors' resolve: each friendly death
   costs every surviving creature on that side 1 Morale — which can
   trigger retreats (handled by processRetreats afterwards). */
async function handleDeaths() {
  const deadByPlayer = [0, 0];
  const dead = [];
  for (let i = 0; i < 2; i++) {
    for (const c of G.players[i].board) {
      if (c.hp <= 0 && !c.dying) {
        c.dying = true;
        dead.push(c);
        deadByPlayer[i]++;
      }
    }
  }
  if (dead.length) {
    if (G.selectedAttacker && G.selectedAttacker.dying) G.selectedAttacker = null;
    SFX.death();
    for (const c of dead) log(`${c.name} is destroyed.`);
    render();
    await FX.sleep(600);
    for (const p of G.players) p.board = p.board.filter((c) => !c.dying);
    for (let i = 0; i < 2; i++) {
      if (!deadByPlayer[i]) continue;
      for (const c of G.players[i].board) loseMorale(c, deadByPlayer[i]);
    }
    render();
  }
  await processRetreats();
}
