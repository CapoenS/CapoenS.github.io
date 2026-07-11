# 🦖 Primal Clash

A prehistoric-themed digital card game with Legends-of-Runeterra-style declared-attack/block combat, running entirely in your browser. Play the AI solo or a friend online (peer-to-peer, no server). Plain HTML/CSS/JS — no frameworks, no build step, no backend.

## How to run

Just open `index.html` in any modern browser (double-click it, or drag it onto a browser window). That's it.

You'll land on the **main menu**: Play (start a match), Deck Builder (build and save your own 30-card decks — saved in your browser via localStorage; the active deck is used when you hit Play, otherwise you get a random draft), Settings (placeholder for now, has a sound toggle), and Quit. In-game, the ☰ Menu button returns to the menu and Resume continues an unfinished match.

Optionally, you can serve it locally instead:

```
cd primal-clash
python -m http.server 8000
# then open http://localhost:8000
```

Click anywhere once if you don't hear sound — browsers unlock audio on first interaction.

## How to play

You and the AI "Rival Chieftain" are Tribe Leaders with **30 HP**. Reduce the enemy leader to 0 to win.

- Each turn you gain **+1 max Amber** (cap 10), refill your amber, and draw a card.
- Decks are **30 cards**, randomly drafted each game (max 2 copies of a card, ★ **Legendary** cards max 1 — currently Tyrannosaurus Rex, Spinosaurus and Hallucigenia, marked by a rotating golden frame and star seal). Going first: 3 starting cards; going second: 4.
- Your **amber** is shown as a cluster of glowing faceted gems at the bottom right of the battlefield (enemy's at the top right). Each player has a compact panel (portrait, name, HP, deck/hand counts) on the **left edge**.
- The battlefield has two zones per player: your **Field** (where summoned creatures wait) and the **Battlefield** lanes above it (where combat happens).
- **Drag a glowing card** from your hand onto your field to play it. Creatures drop onto your field, biomes onto the biome banner, untargeted events anywhere, and targeted events directly onto a highlighted creature. Invalid drops snap back.

**Combat (Legends-of-Runeterra style)** resolves in four lock-in steps:
1. The attacker declares attackers — drag ready creatures forward into the battle lanes (or click them), then hit **Attack!**
2. The defender assigns blockers — drag creatures opposite attackers, one blocker per lane. **Unblocked attackers hit the enemy leader directly.** Sick or exhausted creatures can still block; only frozen ones can't.
3. The attacker casts **quick events** (⚡) — *now that the blocks are known* — then Cast or Pass.
4. The defender casts quick events, then everything resolves.

Quick spells are hidden from your opponent until both sides lock in, then resolve in cast order (attacker's first). If a player has no quick events, their spell step is skipped automatically. Quick events can also be played normally in your main phase.
- Card shapes tell you the type at a glance: creatures are era-crowned slabs with a tribal medallion, events are angular arcane shards, biomes are arched land tablets. Keyword creatures wear distinctive frames and a top-edge badge.
- **End Turn** passes to the opponent. **New Game** reshuffles fresh random decks. **Play Online** connects you to a friend.
- 🔊 toggles sound.

### Card types

- **Creatures** — Cost, ⚔ ATK, 🛡 Armor (flat damage reduction per hit), ❤ HP, a Tribe (shown as a colored tint on the card body and art medallion — borders are reserved for keywords and Legendary status), an Era (shown in the card subtitle), and possibly keywords:
  - 🐾 **Stalker** — when declared as an attacker, you choose which enemy creature blocks it; that creature is forced into the lane and can't be pulled away (stealthed creatures can't be chosen)
  - 💥 **Overwhelm** — when it kills its blocker, damage beyond the blocker's HP carries through to the enemy leader
  - ☠️ **Venom** — any nonzero combat damage it deals or receives destroys the other creature outright
  - 🌫️ **Stealth** — can't be targeted by events or Stalker, and can't be blocked; breaks when it attacks or blocks
  - ⚡ **Swift** — can attack the turn it's played (no summoning sickness)
  - 💚 **Regenerate** — heals 1 HP at the start of its owner's turn
  - 🔥 **Frenzy** — +2 ATK permanently the first time it takes damage
  - 💨 **Evasive** — takes no counterattack damage when it attacks
  - 😤 **Fearless** — infinite Morale; this creature never retreats
  - 🍖 **Devour** — when it kills another creature in combat, it heals HP equal to the victim's max HP (Mosasaurus has a rule-text version that only triggers on Aquatic prey)
- **Events** — one-shot spells (damage, draw, buff, freeze…). Event damage **bypasses armor**. Events tagged **⚡ Quick** can also be cast mid-combat.
- **Biomes** — persistent board-wide effects; only one active at a time, a new one replaces the old.

### Morale

Every creature has a **Morale** stat (the white-blue crystal shield next to HP; defaults 3–5, scaling with cost). Each friendly death costs every surviving creature on that side 1 Morale. At 0 Morale the creature **retreats back to its owner's hand**: it keeps its wounds (shown as a red health badge on the hand card) but heals 1 HP at the start of each of its owner's turns while in hand — no Regenerate needed. Replaying it costs its full amber price again, and it returns with full Morale (and any remaining wounds). If the owner's hand is already full (10 cards max), the retreating creature has nowhere to flee and is destroyed. **Rallying Cry** (2-amber event) restores 2 Morale to all your creatures; Fearless creatures ignore Morale entirely.

### Saving your progress

Everything (decks, active deck, win/loss record, settings) autosaves to a single versioned blob in your browser's localStorage — this works fine on GitHub Pages. For backups or moving to another device, open **Settings → Save data**: export your progress as a copyable save code (`PC1.<data>.<checksum>`) or a downloadable file, and import it back on any device with the paste box or file picker. Codes carry a checksum so corrupted/truncated ones are rejected, imported decks are validated against the card pool, and old saves migrate forward automatically when the format changes.

### Tribe colors

Each creature's card is tinted by its Tribe: Aquatic ocean blue, Arthropod chitinous yellow-green, Reptile scale green, and Mammal russet fur. The tribe also matters mechanically — biome cards buff specific tribes. A creature's Era appears as text in the card subtitle and tooltip. Events and biomes have no tribe and use their own purple-shard and land-tablet looks.

### Combat math

Each duel is a **simultaneous exchange**: the attacker deals `ATK − blocker Armor` and the blocker strikes back for `ATK − attacker Armor` (both floored at 0) — even if one of them dies. Evasive attackers take no counterattack damage. Unblocked attackers deal their full ATK to the enemy leader. Overwhelm attackers push any excess (`ATK − blocker HP`) through to the leader on a kill. Armor does **not** reduce event or biome damage. All duels in an attack resolve together, so a creature only ever fights in one lane.

### Playing online

**Play Online** connects two browsers directly (peer-to-peer over WebRTC via PeerJS) — no server, no accounts, works on GitHub Pages. One player hosts and shares a short game code; the other joins with it. Both pick a saved deck (or a random draft) and play. The host runs the authoritative simulation and validates every action, so a modified client can't cheat; queued quick events stay hidden from the opponent until they resolve. You connect only to someone you share your code with. Both players must stay online for the match — refreshing ends it.

## File layout

```
primal-clash/
├── index.html          entry point — open this
├── README.md
├── css/
│   └── styles.css      all layout, card design, animations
├── js/
│   ├── cards.js        card pool data (creatures, events, biomes) + deck drafting
│   ├── menu.js         screen manager: main menu, settings, quit
│   ├── deckbuilder.js  deck builder screen + localStorage deck saving
│   ├── game.js         game state, turn flow, playing cards, events, combat commits, boot code
│   ├── combat.js       duel resolution, combat sequencer, keywords, deaths
│   ├── ai.js           heuristic AI opponent (declares attacks, assigns blocks)
│   ├── ui.js           DOM rendering + drag/click combat staging
│   ├── dragdrop.js     pointer-based drag: play cards, declare attackers, assign blockers
│   ├── net.js          online multiplayer (PeerJS, host-authoritative)
│   ├── animations.js   lunge/flash/float-number/fade helpers
│   └── audio.js        sound effects generated with the Web Audio API
├── audio/              drop real sound files here later (see audio/README.md)
└── assets/             drop real card art here later (see assets/README.md)
```

## Adding cards

Everything is plain data in `js/cards.js`. Add a creature with one line:

```js
defineCreature('Deinonychus', 3, 4, 2, 0, 'Reptile', 'Cretaceous', ['swift']),
```

Events and biomes are plain objects in the `EVENTS` / `BIOMES` arrays; new event effects need a matching case in `resolveEvent()` (`js/game.js`) and, if targeted, in `eventTargets()`.

## Notes / current placeholders

- **Art**: emoji + era-colored borders stand in for card art for now.
- **Audio**: all sounds are synthesized at runtime via the Web Audio API, so the `audio/` folder is empty by design. Swap in real files by editing `js/audio.js`.
- No fatigue damage when a deck runs out — you simply stop drawing.

## Roadmap ideas

Deck builder, more cards and keywords, hero powers, better animations, real art and sound assets, mulligan, smarter AI.
