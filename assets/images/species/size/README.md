# Size-comparison images

Optional "size comparison" pictures for species cards — a silhouette of the creature
next to an average human (for scale), named by the species' `id` from `data/species.json`:

```
assets/images/species/size/stegosaurus.png
assets/images/species/size/brachiosaurus.png
...
```

Then point a species at it with the optional `"sizeImage"` field in `data/species.json`:

```json
{ "id": "stegosaurus", "sizeImage": "assets/images/species/size/stegosaurus.png", ... }
```

Notes:
- These are **self-contained** images (the silhouette + human + their own background, like a
  diagram). The card shows them in a compact box (max height ~200px), so a wide/landscape
  layout reads best.
- Lowercase filenames, no spaces (GitHub Pages is case-sensitive).
- Leave `sizeImage` out to hide the section for that species; a missing file falls back to a
  labeled placeholder.
