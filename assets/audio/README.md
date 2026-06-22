# Ambient audio

Drop looping atmospheric tracks here, one per time unit, named by the unit's `id`
from `data/periods.json`:

```
assets/audio/jurassic.mp3
assets/audio/cambrian.mp3
assets/audio/cretaceous.mp3
...
```

Then point a unit at it with the optional `"audio"` field in `data/periods.json`:

```json
{ "id": "jurassic", "audio": "assets/audio/jurassic.mp3", ... }
```

Notes:

- Tracks loop seamlessly, so prefer files that loop cleanly (no hard start/end).
- `.mp3` and `.ogg` are the safest cross-browser formats.
- Audio is **off by default** — visitors enable it with the "Sound" button.
- Units without an `audio` field inherit their parent's track (era → eon); if none
  exists anywhere up the chain, focusing that unit is simply silent.
- Missing files are ignored gracefully — no errors, just no sound.
