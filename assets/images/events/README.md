# Event images

Optional 1:1 (square) images for timeline events, named by the event's `id` from
`data/events.json`:

```
assets/images/events/kpg-impact.jpg
assets/images/events/great-oxidation.jpg
...
```

Then point an event at it with the `"image"` field in `data/events.json`:

```json
{ "id": "kpg-impact", "image": "assets/images/events/kpg-impact.jpg", ... }
```

Notes:
- Square images look best — the card crops to 1:1.
- Lowercase filenames, no spaces (GitHub Pages is case-sensitive).
- Missing files fall back to a labeled placeholder — no errors, add pictures later.
