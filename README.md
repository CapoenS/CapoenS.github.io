# Deep Time — an interactive timeline of life on Earth

Description ...

---

## File structure

```
├── index.html              # page skeleton only — no content, no logic
├── css/
│   └── style.css           # all styling (design tokens at the top)
├── js/
│   ├── main.js             # entry point: wires everything together
│   ├── dataLoader.js       # fetches + validates the JSON data files
│   ├── timeline.js         # the Timeline class: rendering, zoom, pan, focus
│   ├── detailPanel.js      # PeriodPanel + SpeciesModal renderers
│   └── utils.js            # small shared helpers (formatting, fallbacks)
├── data/
│   ├── periods.json        # geologic eons/periods + environment info  ← edit me
│   └── species.json        # the species on the timeline               ← edit me
└── assets/
    └── images/
        ├── periods/        # landscape images per period (jpg)
        └── species/        # one image per species (jpg)
```

## Adding a species

Open `data/species.json`, copy a block, edit it:

```json
{
  "id": "velociraptor",
  "name": "Velociraptor",
  "group": "Dromaeosaurid dinosaur",
  "startMa": 75,
  "endMa": 71,
  "periodId": "cretaceous",
  "image": "assets/images/species/velociraptor.jpg",
  "summary": "A turkey-sized, feathered predator from Mongolia...",
  "facts": {
    "Length": "~2 m",
    "Diet": "Carnivore",
    "Found in": "Mongolia, China"
  }
}
```

Notes:
- Times are in **Ma** (million years ago); `startMa` is the older number.
- `periodId` must match an `id` in `periods.json` — it colors the bar's edge
  and links the card to the period. Optional.
- `facts` is free-form: any keys you add show up on the card automatically.
- If the image file doesn't exist yet, the card shows a neat placeholder, so
  you can add data first and pictures later.

## Adding or enriching a period

Same idea in `data/periods.json`. The `info` object is free-form too — add
`"fauna"`, `"oceans"`, `"climate"`, anything — every key is rendered in the
panel. Colors follow the official ICS chronostratigraphic chart, but they're
just hex values you can change.

## Ideas for next steps (the architecture supports them)

- An `events.json` for point events (impacts, extinctions, "first bird") drawn
  as markers on the axis — add a loader in `dataLoader.js` and a
  `renderEvents()` method in `timeline.js`.
- Sub-periods/epochs: give units a `parentId` and only render children when
  zoomed past their parent.
- Filtering species by group (dinosaurs / mammals / marine ...).
- A search box that calls `timeline.setView()` on the match.
- URL state (`#view=155,145`) so views can be shared.
- 3D interactive world map view per period
- Images of periods and species
- More view controls
- Sound clips of dinosaurs or atmospheric period sounds

## Image credits

...
