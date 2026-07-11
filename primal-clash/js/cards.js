/* ============================================
   Primal Clash — card data & deck building
   All cards are plain data objects, so adding
   new cards is just adding entries below.
   ============================================ */
"use strict";

const ERAS = [
  'Cambrian', 'Ordovician', 'Silurian', 'Devonian', 'Carboniferous',
  'Permian', 'Triassic', 'Jurassic', 'Cretaceous', 'Miocene', 'Pleistocene',
];

const TRIBE_ICONS = {
  Aquatic: '🌊',
  Arthropod: '🦂',
  Reptile: '🦖',
  Mammal: '🐘',
};

const KEYWORD_ICONS = {
  stalker: '🐾',
  overwhelm: '💥',
  venom: '☠️',
  stealth: '🌫️',
  swift: '⚡',
  regenerate: '💚',
  frenzy: '🔥',
  evasive: '💨',
  fearless: '😤',
  devour: '🍖',
  breacher: '🪓',
  energetic: '🔋',
  berserk: '💢',
};

const KEYWORD_HELP = {
  stalker: 'Stalker: when declared as an attacker, you choose which enemy creature blocks it — that creature is dragged into the lane and cannot be pulled away. (Stealthed creatures can\'t be chosen.)',
  overwhelm: "Overwhelm: when this creature kills its blocker, damage beyond the blocker's HP is dealt to the enemy leader.",
  venom: 'Venom: any nonzero combat damage this creature deals or receives destroys the other creature outright.',
  stealth: "Stealth: can't be targeted by events or Stalker, and can't be blocked. Breaks when it attacks or blocks.",
  swift: 'Swift: can attack the same turn it is played (anything may still block it).',
  regenerate: 'Regenerate: heals 1 HP at the start of its owner\'s turn if damaged.',
  frenzy: 'Frenzy: gains +2 ATK permanently the first time it takes damage.',
  evasive: 'Evasive: takes no counterattack damage when it attacks.',
  fearless: 'Fearless: infinite Morale — this creature never retreats.',
  devour: 'Devour: when this creature kills another creature in combat, it feasts on it, healing HP equal to the victim\'s max HP.',
  breacher: 'Breacher: its strikes shred armor — a creature it fights permanently loses 1 Armor (2 if this has 4+ ATK).',
  energetic: 'Energetic: can attack twice per turn — after the first combat, a second attack wave may be declared with Energetic creatures.',
  berserk: 'Berserk: every time this creature takes damage, it permanently gains +1 ATK.',
};

/* name / cost / atk / hp / armor / tribe / era / abilities / ability / onSummon
   `abilities` are the keyword skills (taunt, venom, …).
   `ability` is optional passive RULE TEXT with a live effect: { id, text }.
   The effect behind each ability id lives in abilityAtkBonus() (js/combat.js).
   `onSummon` is an optional one-shot effect that triggers when the creature
   enters the field: { id, text }. Its logic lives in the ON_SUMMON registry
   (js/game.js). Both texts share the parchment box at the card's bottom. */
/* Default Morale scales gently with cost: big beasts hold the line longer.
   Override per card with the `morale` parameter. Fearless = infinite. */
function defaultMorale(cost) {
  return cost >= 7 ? 5 : cost >= 4 ? 4 : 3;
}

function defineCreature(name, cost, atk, hp, armor, tribe, era, abilities = [], ability = null, onSummon = null, morale = null) {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    type: 'creature',
    name, cost, atk, hp, armor, tribe, era, abilities, ability, onSummon,
    morale: morale != null ? morale : defaultMorale(cost),
  };
}

const CREATURES = [
  defineCreature('Trilobite',          1, 1, 2, 1, 'Aquatic',   'Cambrian'),
  defineCreature('Compsognathus',      1, 2, 1, 0, 'Reptile',   'Jurassic'),
  defineCreature('Hallucigenia',       3, 1, 1, 0, 'Aquatic',   'Cambrian',      [],
    { id: 'dream_conjurer', text: 'Start of turn: conjure a random event (cost ≤ 3).' }),
  defineCreature('Anomalocaris',       2, 3, 2, 0, 'Aquatic',   'Cambrian',      [], null,
    { id: 'destroy_trilobite', text: 'Destroy any Trilobite.' }),
  defineCreature('Meganeura',          2, 2, 1, 0, 'Arthropod', 'Carboniferous', ['evasive']),
  defineCreature('Velociraptor',       2, 3, 1, 0, 'Reptile',   'Cretaceous',    ['swift']),
  defineCreature('Dire Wolf',          2, 2, 3, 0, 'Mammal',    'Pleistocene', [],
    { id: 'pack_hunter', text: '+1 ATK for each other Dire Wolf in play.' }),
  defineCreature('Sea Scorpion',       3, 3, 3, 0, 'Aquatic',   'Silurian'),
  defineCreature('Ichthyosaurus',      3, 4, 2, 0, 'Aquatic',   'Jurassic'),
  defineCreature('Pulmonoscorpius',    3, 2, 2, 0, 'Arthropod', 'Carboniferous', ['venom']),
  defineCreature('Mongolarachne',      3, 3, 3, 0, 'Arthropod', 'Jurassic'),
  defineCreature('Dimetrodon',         3, 3, 4, 0, 'Reptile',   'Permian',       ['berserk']),
  defineCreature('Pteranodon',         3, 3, 2, 0, 'Reptile',   'Cretaceous',    ['stealth']),
  defineCreature('Castoroides',        3, 3, 4, 0, 'Mammal',    'Pleistocene',   ['breacher']),
  defineCreature('Cameroceras',        4, 4, 5, 0, 'Aquatic',   'Ordovician'),
  defineCreature('Plesiosaurus',       4, 4, 5, 0, 'Aquatic',   'Jurassic'),
  defineCreature('Arthropleura',       4, 3, 6, 1, 'Arthropod', 'Carboniferous', ['regenerate']),
  defineCreature('Brontoscorpio',      4, 4, 3, 0, 'Arthropod', 'Silurian',      [], null,
    { id: 'sting_execution', text: 'Destroy an enemy creature — its HP recoils as damage to your leader.' }),
  defineCreature('Meganeuropsis',      4, 3, 2, 0, 'Arthropod', 'Permian',       ['evasive']),
  defineCreature('Gorgonops',          4, 5, 3, 0, 'Reptile',   'Permian',       ['stalker']),
  defineCreature('Stegosaurus',        4, 3, 5, 1, 'Reptile',   'Jurassic'),
  defineCreature('Smilodon',           4, 5, 3, 0, 'Mammal',    'Pleistocene',   ['stealth']),
  defineCreature('Megaloceros',        4, 4, 4, 0, 'Mammal',    'Pleistocene',   ['energetic']),
  defineCreature('Homo Neanderthalensis', 4, 3, 4, 0, 'Mammal', 'Pleistocene'),
  defineCreature('Dunkleosteus',       5, 5, 4, 2, 'Aquatic',   'Devonian'),
  defineCreature('Tusoteuthis',        5, 5, 5, 0, 'Aquatic',   'Cretaceous'),
  defineCreature('Ankylosaurus',       5, 2, 7, 2, 'Reptile',   'Cretaceous',    ['fearless']),
  defineCreature('Megatherium',        5, 4, 7, 0, 'Mammal',    'Pleistocene',   ['regenerate']),
  defineCreature('Woolly Rhino',       5, 4, 6, 1, 'Mammal',    'Pleistocene',   ['frenzy']),
  defineCreature('Gigantopithecus',    5, 4, 6, 0, 'Mammal',    'Pleistocene',   [], null,
    { id: 'mammal_toss', text: 'Throw a friendly Mammal at an enemy creature — they trade combat damage.' }),
  defineCreature('Triceratops',        6, 5, 7, 1, 'Reptile',   'Cretaceous',    ['overwhelm']),
  defineCreature('Spinosaurus',        6, 6, 5, 0, 'Reptile',   'Cretaceous',    [],
    { id: 'river_king', text: 'River King: counts as Aquatic too. While a biome is active: +2 ATK and Regenerate.' }),
  defineCreature('Woolly Mammoth',     6, 5, 8, 1, 'Mammal',    'Pleistocene',   ['overwhelm']),
  defineCreature('Brachiosaurus',      7, 4, 9, 0, 'Reptile',   'Jurassic',      ['fearless']),
  defineCreature('Mosasaurus',         7, 7, 7, 0, 'Aquatic',   'Cretaceous',    [],
    { id: 'ocean_devour', text: 'Devours Aquatic creatures it kills, healing their max HP.' }),
  defineCreature('Megalodon',          7, 8, 6, 0, 'Aquatic',   'Miocene',       ['fearless']),
  defineCreature('Tyrannosaurus Rex',  8, 9, 8, 0, 'Reptile',   'Cretaceous',    ['fearless', 'overwhelm'], null,
    { id: 'terrify', text: 'Reduce all enemy Morale by 2.' }),
];

/* `quick: true` events can be cast in your main phase AND queued during
   combat (attacker's cast window after declaring, defender's after
   blocking). They stay hidden until both players lock in. */
const EVENTS = [
  { id: 'predator_ambush',   type: 'event', name: 'Predator Ambush',   cost: 1, effect: 'ambush',   quick: true,  icon: '🗡️', text: 'Deal 2 damage to an enemy creature.' },
  { id: 'adrenaline_surge',  type: 'event', name: 'Adrenaline Surge',  cost: 1, effect: 'surge',    quick: true,  icon: '🩸', text: 'A friendly creature gets +2 ATK this turn.' },
  { id: 'bone_plating',      type: 'event', name: 'Bone Plating',      cost: 1, effect: 'plating',  quick: true,  icon: '🦴', text: 'A friendly creature gets +2 Armor this turn.' },
  { id: 'trampling_fury',    type: 'event', name: 'Trampling Fury',    cost: 2, effect: 'trample',  quick: true,  icon: '🐘', text: 'A friendly creature gains Overwhelm this turn.' },
  { id: 'rallying_cry',      type: 'event', name: 'Rallying Cry',      cost: 2, effect: 'rally',    quick: true,  icon: '📯', text: 'Restore 2 Morale to all your creatures.' },
  { id: 'primal_screech',    type: 'event', name: 'Primal Screech',   cost: 3, effect: 'screech',  quick: true,  icon: '📢', text: 'Deal 1 damage to every creature in combat.' },
  { id: 'eruption',          type: 'event', name: 'Eruption',          cost: 4, effect: 'eruption', quick: true,  icon: '🌋', text: 'Deal 4 damage to any creature.' },
  { id: 'sunder',            type: 'event', name: 'Sunder',            cost: 1, effect: 'sunder',   quick: true,  icon: '⚒️', text: 'Break 3 Armor on an enemy creature.' },
  { id: 'primal_mending',    type: 'event', name: 'Primal Mending',    cost: 2, effect: 'mend',     quick: true,  icon: '🩹', text: 'Heal a creature 4 HP.' },
  { id: 'fossil_excavation', type: 'event', name: 'Fossil Excavation', cost: 2, effect: 'excavate', icon: '⛏️', text: 'Draw 2 cards.' },
  { id: 'evolve',            type: 'event', name: 'Evolve',            cost: 2, effect: 'evolve',   icon: '🧬', text: 'A friendly creature gains +2/+2.' },
  { id: 'healing_spring',    type: 'event', name: 'Healing Spring',    cost: 2, effect: 'spring',   icon: '💧', text: 'Restore 5 HP to your leader.' },
  { id: 'healing_rain',      type: 'event', name: 'Healing Rain',      cost: 3, effect: 'rain',     icon: '🌧️', text: 'Heal all your creatures 2 HP.' },
  { id: 'tar_pit',           type: 'event', name: 'Tar Pit',           cost: 3, effect: 'tarpit',   icon: '🕳️', text: 'Destroy an enemy creature with 4 or less ATK.' },
  { id: 'ice_age',           type: 'event', name: 'Ice Age',           cost: 5, effect: 'iceage',   icon: '❄️', text: 'Freeze all enemy creatures for a turn.' },
  { id: 'meteor_impact',     type: 'event', name: 'Meteor Impact',     cost: 6, effect: 'meteor',   icon: '☄️', text: 'Deal 3 damage to all creatures.' },
  { id: 'continental_drift', type: 'event', name: 'Continental Drift', cost: 1, effect: 'drift',    icon: '🌍', text: 'Destroy the active biome.' },
];

/* Biome mechanics (logic lives in game.js/combat.js):
   `buffTribe`    — that tribe gets +1 ATK while the biome is up (aura).
   `buffHp`       — that same tribe also gets +N HP (applied/removed as the
                    biome enters/leaves; new summons get it on entry).
   `grantSwift`   — that tribe loses summoning sickness (on play + on entry).
   `deathSpawn`   — { tribe, token }: when a creature of `tribe` dies, the
                    token creature (from TOKENS) is summoned in its place.
   `freezeOthers` — creatures NOT of that tribe enter play frozen for a
                    full round (Deep Freeze).
   `burn`         — every creature takes N damage at the end of each turn. */
const BIOMES = [
  { id: 'panthalassa_ocean',    type: 'biome', name: 'Panthalassa Ocean',    cost: 4, grantSwift: 'Aquatic', burn: 0, icon: '🌊', text: 'Aquatic creatures have Swift.' },
  { id: 'carboniferous_jungle', type: 'biome', name: 'Carboniferous Jungle', cost: 4, deathSpawn: { tribe: 'Arthropod', token: 'archimylacris' }, burn: 0, icon: '🌿', text: 'When an Arthropod dies, a 1/1 Archimylacris takes its place.' },
  { id: 'fern_prairie',         type: 'biome', name: 'Fern Prairie',         cost: 3, buffTribe: 'Reptile', buffHp: 1, burn: 0, icon: '🌾', text: 'Reptile creatures get +1/+1.' },
  { id: 'glacial_tundra',       type: 'biome', name: 'Glacial Tundra',       cost: 5, freezeOthers: 'Mammal', burn: 0, icon: '🏔️', text: 'Non-Mammals enter play frozen for a round.' },
  { id: 'volcanic_wastes',      type: 'biome', name: 'Volcanic Wastes',      cost: 6, burn: 1, icon: '🔥', text: 'All creatures take 1 damage each turn (ignores Armor).' },
];

/* Token creatures: summoned by effects, deliberately NOT in CARD_POOL —
   they can never be drafted, deck-built, or drawn. */
const TOKENS = [
  defineCreature('Archimylacris', 1, 1, 1, 0, 'Arthropod', 'Carboniferous'),
];

const CARD_POOL = [...CREATURES, ...EVENTS, ...BIOMES];

/* Deck size — single source of truth (random drafts + deck builder). */
const DECK_SIZE = 30;

/* ---------- Legendary cards ----------
   Legendary cards are limited to 1 copy per deck
   and get a special animated golden frame. */
const LEGENDARY_IDS = ['tyrannosaurus_rex', 'spinosaurus', 'hallucigenia'];
for (const c of CARD_POOL) c.legendary = LEGENDARY_IDS.includes(c.id);

/* How many copies of this card a deck may contain. */
function maxCopiesOf(tpl) { return tpl.legendary ? 1 : 2; }

/* Validate a list of card ids as a legal deck (exactly DECK_SIZE cards,
   known ids, copy limits respected). Returns the template array, or
   null if the list is not a legal deck. Used by the deck builder and
   to validate decks submitted by online opponents. */
function validateDeckIds(ids) {
  if (!Array.isArray(ids) || ids.length !== DECK_SIZE) return null;
  const counts = {};
  const cards = [];
  for (const id of ids) {
    const tpl = CARD_POOL.find((c) => c.id === id);
    counts[id] = (counts[id] || 0) + 1;
    if (!tpl || counts[id] > maxCopiesOf(tpl)) return null;
    cards.push(tpl);
  }
  return cards;
}

/* Fisher–Yates shuffle (in place) */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Random deck (DECK_SIZE cards) drafted from the pool.
   Max 2 copies of any card, 1 copy of Legendaries. */
function buildRandomDeck() {
  const bag = [];
  for (const tpl of CARD_POOL) {
    for (let i = 0; i < maxCopiesOf(tpl); i++) bag.push(tpl);
  }
  shuffle(bag);
  return bag.slice(0, DECK_SIZE);
}
