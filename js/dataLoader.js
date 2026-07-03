/**
 * dataLoader.js — loads and lightly validates the JSON data files.
 *
 * All site content lives in /data. To support a new data file later
 * (events.json, extinctions.json, ...) add a loader here and consume
 * it in main.js — nothing else needs to change.
 */

const DATA_FILES = {
  periods: "data/periods.json",
  species: "data/species.json",
  events: "data/events.json",
  sources: "data/sources.json",
  cosmos: "data/cosmos.json", // optional cosmic prequel (Big Bang → 4.6 Ga); absent = Earth-only
};

/** Fetch one JSON file, throwing a readable error if it fails. */
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Could not load ${path} (HTTP ${res.status}). ` +
      `If you opened index.html directly from disk, run a local server instead — see README.md.`);
  }
  return res.json();
}

/** Fetch optional JSON; returns null (not an error) if the file is missing. */
async function fetchOptionalJson(path) {
  try {
    return await fetchJson(path);
  } catch (_) {
    return null;
  }
}

/** Tag each item with a realm (mutates a shallow copy is overkill — set the field). */
function tagRealm(items, realm) {
  for (const it of items) it.realm = it.realm ?? realm;
  return items;
}

/** Load everything the app needs. Returns { periods, species, events, sources }. */
export async function loadData() {
  const [periodsRaw, speciesRaw, eventsRaw, sourcesRaw, cosmosRaw] = await Promise.all([
    fetchJson(DATA_FILES.periods),
    fetchJson(DATA_FILES.species),
    fetchOptionalJson(DATA_FILES.events),  // optional — app works without it
    fetchOptionalJson(DATA_FILES.sources), // optional — app works without it
    fetchOptionalJson(DATA_FILES.cosmos),  // optional — absent = Earth-only timeline
  ]);

  // Earth + cosmic units share one axis. Cosmos units/events are realm-tagged so the
  // Timeline can keep them hidden until the user reveals the cosmos.
  const earthUnits = tagRealm((periodsRaw.units ?? []).filter(validatePeriod), "earth");
  const cosmosUnits = tagRealm((cosmosRaw?.units ?? []).filter(validatePeriod), "cosmos");
  const periods = [...earthUnits, ...cosmosUnits].sort((a, b) => b.startMa - a.startMa); // oldest first

  const periodIds = new Set(periods.map((p) => p.id));

  const species = tagRealm(
    (speciesRaw.species ?? []).filter((s) => validateSpecies(s, periodIds)),
    "earth"
  ).sort((a, b) => b.startMa - a.startMa);

  const earthEvents = tagRealm((eventsRaw?.events ?? []).filter(validateEvent), "earth");
  const cosmosEvents = tagRealm((cosmosRaw?.events ?? []).filter(validateEvent), "cosmos");
  const events = [...earthEvents, ...cosmosEvents].sort((a, b) => b.ma - a.ma);

  const sources = (sourcesRaw?.categories ?? []).filter((c) => c.label);

  return { periods, species, events, sources };
}

/* ---------- validation: warn (don't crash) on bad entries ---------- */

function validatePeriod(p) {
  const ok = p.id && p.name && isFiniteNum(p.startMa) && isFiniteNum(p.endMa) && p.startMa > p.endMa;
  if (!ok) console.warn("[data] Skipping invalid period entry:", p);
  return ok;
}

function validateSpecies(s, periodIds) {
  const ok = s.id && s.name && isFiniteNum(s.startMa) && isFiniteNum(s.endMa) && s.startMa >= s.endMa;
  if (!ok) {
    console.warn("[data] Skipping invalid species entry:", s);
    return false;
  }
  if (s.periodId && !periodIds.has(s.periodId)) {
    console.warn(`[data] Species "${s.id}" references unknown periodId "${s.periodId}" — it will use the default color.`);
  }
  return true;
}

function validateEvent(e) {
  const ok = e.id && e.name && isFiniteNum(e.ma);
  if (!ok) console.warn("[data] Skipping invalid event entry:", e);
  return ok;
}

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}
