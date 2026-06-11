# Deep Time — an interactive timeline of life on Earth

A static website (plain HTML/CSS/JS, no build step, no dependencies) that shows
4.6 billion years of Earth's history as an interactive ribbon. Click a geologic
period to focus on it and read about its atmosphere, terrain and flora; click a
species bar to open its card.

Built to be hosted for free on **GitHub Pages** and to be **easily expandable**:
all content lives in two JSON files.

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

**Design rule:** code never contains content. To grow the site you edit
`data/*.json` and drop images into `assets/images/` — you should rarely need
to touch the JS.

---

## Run it locally

Browsers block `fetch()` of local files, so don't open `index.html` directly —
serve the folder instead (any static server works):

```bash
# from the project root, pick one:
python3 -m http.server 8000      # then open http://localhost:8000
npx serve .                      # if you have Node installed
```

## Deploy on GitHub Pages

1. Create a new repository on GitHub (e.g. `earth-timeline`).
2. Push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Initial version: interactive Earth history timeline"
   git branch -M main
   git remote add origin https://github.com/<your-username>/earth-timeline.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: Deploy from a branch →
   Branch: `main` / folder: `/ (root)` → Save**.
4. After a minute your site is live at
   `https://<your-username>.github.io/earth-timeline/`.

Every future `git push` updates the live site automatically.

---

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

## Image credits

Add your image sources here as you add pictures (Wikimedia Commons is a good
source of freely licensed paleoart — check each file's license).
