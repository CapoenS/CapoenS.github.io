# assets/

Card art lives in `assets/cards/`, **named by card id** (the `id` field in `js/cards.js`):

- Creatures & events: **1:1 square** images, e.g. `cards/velociraptor.jpg`, `cards/meteor_impact.jpg`
- Biomes: ideally **wide/landscape**, e.g. `cards/panthalassa_ocean.jpg` (shown in the arched vista banner)

The art is wired up already (`artHTML()` in `js/ui.js`): every card tries to load
`assets/cards/<id>.jpg` and silently falls back to its emoji placeholder when the
file doesn't exist — so drop images in one at a time whenever they're ready, no
code changes needed. `velociraptor.jpg` is the style reference for the set.
