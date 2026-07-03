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
  Bird: '🦅',
  Mammal: '🐘',
};

const KEYWORD_ICONS = {
  taunt: '🛡️',
  venom: '☠️',
  stealth: '🌫️',
  swift: '⚡',
  regenerate: '💚',
  frenzy: '🔥',
  evasive: '💨',
  fearless: '😤',
  devour: '🍖',
};

const KEYWORD_HELP = {
  taunt: 'Taunt: enemies must attack this creature before the leader or other creatures (Stealth attackers may ignore it).',
  venom: 'Venom: any nonzero combat damage this creature deals or receives destroys the other creature outright.',
  stealth: "Stealth: can't be targeted by attacks or targeted event cards until it attacks for the first time.",
  swift: 'Swift: can attack the same turn it is played.',
  regenerate: 'Regenerate: heals 1 HP at the start of its owner\'s turn if damaged.',
  frenzy: 'Frenzy: gains +2 ATK permanently the first time it takes damage.',
  evasive: 'Evasive: takes no counterattack damage when it attacks.',
  fearless: 'Fearless: infinite Morale — this creature never retreats.',
  devour: 'Devour: when this creature kills another creature in combat, it feasts on it, healing HP equal to the victim\'s max HP.',
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
    { id: 'dream_conjurer', text: 'At the start of your turn, dream up a random event costing 3 or less.' }),
  defineCreature('Anomalocaris',       2, 3, 2, 0, 'Aquatic',   'Cambrian',      [], null,
    { id: 'destroy_trilobite', text: 'Destroy a Trilobite on either side of the field, regardless of its stats.' }),
  defineCreature('Meganeura',          2, 2, 1, 0, 'Arthropod', 'Carboniferous', ['evasive']),
  defineCreature('Velociraptor',       2, 3, 1, 0, 'Reptile',   'Cretaceous',    ['swift']),
  defineCreature('Dire Wolf',          2, 2, 3, 0, 'Mammal',    'Pleistocene', [],
    { id: 'pack_hunter', text: 'For each other Dire Wolf on the playing field, this creature gains +1 ATK.' }),
  defineCreature('Sea Scorpion',       3, 3, 3, 0, 'Aquatic',   'Silurian'),
  defineCreature('Pulmonoscorpius',    3, 2, 2, 0, 'Arthropod', 'Carboniferous', ['venom']),
  defineCreature('Dimetrodon',         3, 3, 4, 0, 'Reptile',   'Permian'),
  defineCreature('Pteranodon',         3, 3, 2, 0, 'Reptile',   'Cretaceous',    ['stealth']),
  defineCreature('Terror Bird',        3, 4, 2, 0, 'Bird',      'Miocene'),
  defineCreature('Cameroceras',        4, 4, 5, 0, 'Aquatic',   'Ordovician'),
  defineCreature('Arthropleura',       4, 3, 6, 1, 'Arthropod', 'Carboniferous', ['taunt']),
  defineCreature('Gorgonops',          4, 5, 3, 0, 'Reptile',   'Permian'),
  defineCreature('Stegosaurus',        4, 3, 5, 1, 'Reptile',   'Jurassic'),
  defineCreature('Smilodon',           4, 5, 3, 0, 'Mammal',    'Pleistocene',   ['stealth']),
  defineCreature('Dunkleosteus',       5, 5, 4, 2, 'Aquatic',   'Devonian'),
  defineCreature('Ankylosaurus',       5, 2, 7, 2, 'Reptile',   'Cretaceous',    ['taunt']),
  defineCreature('Megatherium',        5, 4, 7, 0, 'Mammal',    'Pleistocene',   ['regenerate']),
  defineCreature('Woolly Rhino',       5, 4, 6, 1, 'Mammal',    'Pleistocene',   ['frenzy']),
  defineCreature('Triceratops',        6, 5, 7, 1, 'Reptile',   'Cretaceous',    ['taunt']),
  defineCreature('Spinosaurus',        6, 6, 5, 0, 'Reptile',   'Cretaceous'),
  defineCreature('Woolly Mammoth',     6, 5, 8, 1, 'Mammal',    'Pleistocene'),
  defineCreature('Brachiosaurus',      7, 4, 9, 0, 'Reptile',   'Jurassic',      ['taunt']),
  defineCreature('Mosasaurus',         7, 7, 7, 0, 'Aquatic',   'Cretaceous',    [],
    { id: 'ocean_devour', text: 'Devours any Aquatic creature it kills, healing HP equal to the victim\'s max HP.' }),
  defineCreature('Megalodon',          7, 8, 6, 0, 'Aquatic',   'Miocene',       ['fearless']),
  defineCreature('Tyrannosaurus Rex',  8, 9, 8, 0, 'Reptile',   'Cretaceous',    ['fearless'], null,
    { id: 'terrify', text: 'Reduce all enemy Morale by 2.' }),
];

const EVENTS = [
  { id: 'predator_ambush',   type: 'event', name: 'Predator Ambush',   cost: 1, effect: 'ambush',   icon: '🗡️', text: 'Deal 2 damage to an enemy creature.' },
  { id: 'fossil_excavation', type: 'event', name: 'Fossil Excavation', cost: 2, effect: 'excavate', icon: '⛏️', text: 'Draw 2 cards.' },
  { id: 'evolve',            type: 'event', name: 'Evolve',            cost: 2, effect: 'evolve',   icon: '🧬', text: 'Give a friendly creature +2/+2 permanently.' },
  { id: 'healing_spring',    type: 'event', name: 'Healing Spring',    cost: 2, effect: 'spring',   icon: '💧', text: 'Restore 5 HP to your leader.' },
  { id: 'tar_pit',           type: 'event', name: 'Tar Pit',           cost: 3, effect: 'tarpit',   icon: '🕳️', text: 'Destroy an enemy creature with 3 or less current attack.' },
  { id: 'eruption',          type: 'event', name: 'Eruption',          cost: 4, effect: 'eruption', icon: '🌋', text: 'Deal 4 damage to any one creature.' },
  { id: 'ice_age',           type: 'event', name: 'Ice Age',           cost: 5, effect: 'iceage',   icon: '❄️', text: "Freeze all enemy creatures — they can't attack next turn." },
  { id: 'meteor_impact',     type: 'event', name: 'Meteor Impact',     cost: 6, effect: 'meteor',   icon: '☄️', text: 'Deal 3 damage to ALL creatures on the board.' },
  { id: 'rallying_cry',      type: 'event', name: 'Rallying Cry',      cost: 2, effect: 'rally',    icon: '📯', text: 'Restore 2 Morale to all your creatures.' },
];

const BIOMES = [
  { id: 'panthalassa_ocean',    type: 'biome', name: 'Panthalassa Ocean',    cost: 2, buffTribe: 'Aquatic',   burn: 0, icon: '🌊', text: 'Aquatic creatures get +1 ATK.' },
  { id: 'carboniferous_jungle', type: 'biome', name: 'Carboniferous Jungle', cost: 2, buffTribe: 'Arthropod', burn: 0, icon: '🌿', text: 'Arthropod creatures get +1 ATK.' },
  { id: 'fern_prairie',         type: 'biome', name: 'Fern Prairie',         cost: 2, buffTribe: 'Reptile',   burn: 0, icon: '🌾', text: 'Reptile creatures get +1 ATK.' },
  { id: 'glacial_tundra',       type: 'biome', name: 'Glacial Tundra',       cost: 2, buffTribe: 'Mammal',    burn: 0, icon: '🏔️', text: 'Mammal creatures get +1 ATK.' },
  { id: 'volcanic_wastes',      type: 'biome', name: 'Volcanic Wastes',      cost: 3, buffTribe: null,        burn: 1, icon: '🔥', text: 'All creatures take 1 damage at the end of every turn (bypasses armor).' },
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
