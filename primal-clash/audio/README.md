# audio/

This folder is intentionally empty for now.

All current sound effects are generated at runtime with the Web Audio API (see `js/audio.js`), so the game works with zero audio assets.

To use real sounds later, drop freely licensed files in here (e.g. `play.mp3`, `attack.mp3`, `damage.mp3`, `death.mp3`, `win.mp3`, `lose.mp3`) and replace the corresponding functions in `js/audio.js` with `new Audio('audio/<file>').play()` — or add Howler.js and use `new Howl({ src: ['audio/<file>'] })`.
